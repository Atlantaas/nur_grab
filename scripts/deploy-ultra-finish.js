/**
 * Finish Ultra deploy (Node already installed). Upload + nginx + start.
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");

const ROOT = path.join(__dirname, "..");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const HOST = cfg.ftpHost || "joker.usbx.me";
const USER = cfg.ftpUser || "ryan";
const PASS = cfg.ftpPass;
const REMOTE_DIR = "apps/nur_grab";
const BASE = "/grab";
const PORT = 39664; // first free port from previous probe

const SKIP = new Set(["node_modules", ".git", "scripts"]);

function connect() {
  return new Promise((resolve, reject) => {
    const c = new Client();
    c.on("ready", () => resolve(c));
    c.on("error", reject);
    c.connect({
      host: HOST,
      port: 22,
      username: USER,
      password: PASS,
      readyTimeout: 25000,
    });
  });
}

function exec(conn, cmd, echo = false) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = "";
      let errOut = "";
      stream.on("data", (d) => {
        out += d.toString();
        if (echo) process.stdout.write(d);
      });
      stream.stderr.on("data", (d) => {
        errOut += d.toString();
        if (echo) process.stderr.write(d);
      });
      stream.on("close", (code) => resolve({ code, out, errOut }));
    });
  });
}

function sftp(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, s) => (err ? reject(err) : resolve(s)));
  });
}

function mkdirp(sftpClient, remotePath) {
  const parts = remotePath.split("/").filter(Boolean);
  let cur = "";
  return parts.reduce(async (prev, part) => {
    await prev;
    cur = cur ? `${cur}/${part}` : part;
    // absolute from home-relative paths like /home/ryan/...
    const full = remotePath.startsWith("/")
      ? "/" + parts.slice(0, parts.indexOf(part) + 1).join("/")
      : cur;
    return new Promise((resolve) => {
      sftpClient.mkdir(full, () => resolve());
    });
  }, Promise.resolve());
}

function listLocalFiles(dir, base = dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules") continue;
      out.push(...listLocalFiles(full, base));
    } else {
      out.push({
        local: full,
        remote: path.relative(base, full).replace(/\\/g, "/"),
      });
    }
  }
  return out;
}

async function uploadTree(sftpClient, remoteRoot, files) {
  const dirs = new Set(
    files.map((f) => path.posix.dirname(path.posix.join(remoteRoot, f.remote)))
  );
  for (const d of [...dirs].sort((a, b) => a.length - b.length)) {
    await new Promise((resolve) => {
      const parts = d.split("/").filter(Boolean);
      let acc = "";
      const chain = parts.reduce(async (p, part) => {
        await p;
        acc += "/" + part;
        return new Promise((r) => sftpClient.mkdir(acc, () => r()));
      }, Promise.resolve());
      chain.then(resolve);
    });
  }
  let n = 0;
  for (const f of files) {
    const remote = path.posix.join(remoteRoot, f.remote);
    await new Promise((resolve, reject) => {
      sftpClient.fastPut(f.local, remote, (err) => (err ? reject(err) : resolve()));
    });
    n++;
    if (n % 5 === 0) process.stdout.write(".");
  }
  console.log(` ${n} files`);
}

const NVM =
  'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"';

async function main() {
  console.log("Connecting…");
  const conn = await connect();
  const homeR = await exec(conn, "echo $HOME");
  const HOME = homeR.out.trim();
  const remoteAbs = `${HOME}/${REMOTE_DIR}`;
  console.log("Remote", remoteAbs, "port", PORT);

  const node = await exec(conn, `bash -lc '${NVM}; node -v; which node'`);
  console.log("Node:", node.out.trim() || node.errOut.trim());
  if (!/v\d+/.test(node.out)) throw new Error("Node still missing");

  const s = await sftp(conn);
  const ultraCfg = {
    ...cfg,
    mobilePort: PORT,
    mobileBasePath: BASE,
    mobileBind: "127.0.0.1",
  };
  const tmpCfg = path.join(ROOT, ".config.ultra.tmp.json");
  fs.writeFileSync(tmpCfg, JSON.stringify(ultraCfg, null, 2) + "\n");

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  delete pkg.devDependencies;
  pkg.dependencies = pkg.dependencies || {};
  // server needs only basic-ftp (ssh2 is deploy-only local)
  pkg.scripts = { start: "node server.js" };
  const tmpPkg = path.join(ROOT, ".package.ultra.tmp.json");
  fs.writeFileSync(tmpPkg, JSON.stringify(pkg, null, 2) + "\n");

  console.log("Upload…");
  const files = listLocalFiles(ROOT).filter(
    (f) => f.remote !== "config.json" && f.remote !== "package.json"
  );
  await uploadTree(s, remoteAbs, files);
  await new Promise((resolve, reject) => {
    s.fastPut(tmpCfg, `${remoteAbs}/config.json`, (e) => (e ? reject(e) : resolve()));
  });
  await new Promise((resolve, reject) => {
    s.fastPut(tmpPkg, `${remoteAbs}/package.json`, (e) => (e ? reject(e) : resolve()));
  });
  fs.unlinkSync(tmpCfg);
  fs.unlinkSync(tmpPkg);

  console.log("npm install…");
  const npm = await exec(
    conn,
    `bash -lc '${NVM}; cd "${remoteAbs}" && npm install --omit=dev'`,
    true
  );
  if (npm.code !== 0) throw new Error("npm failed: " + npm.errOut.slice(0, 300));

  const nginxConf = `location ${BASE}/ {
    proxy_pass http://127.0.0.1:${PORT}/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $http_host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
}
`;
  const tmpNgx = path.join(ROOT, ".grab.nginx.tmp.conf");
  fs.writeFileSync(tmpNgx, nginxConf);
  const nginxPath = `${HOME}/.apps/nginx/proxy.d/grab.conf`;
  await new Promise((resolve) => {
    const parts = path.posix.dirname(nginxPath).split("/").filter(Boolean);
    let acc = "";
    parts
      .reduce(
        (p, part) =>
          p.then(
            () =>
              new Promise((r) => {
                acc += "/" + part;
                s.mkdir(acc, () => r());
              })
          ),
        Promise.resolve()
      )
      .then(resolve);
  });
  await new Promise((resolve, reject) => {
    s.fastPut(tmpNgx, nginxPath, (e) => (e ? reject(e) : resolve()));
  });
  fs.unlinkSync(tmpNgx);
  console.log("nginx written");
  await exec(conn, "app-nginx restart 2>&1", true);

  console.log("Start server…");
  await exec(
    conn,
    `bash -lc 'pkill -f "[n]ode server.js" 2>/dev/null || true; ${NVM}; cd "${remoteAbs}"; nohup node server.js > "${remoteAbs}/mobile.log" 2>&1 & sleep 2; head -30 "${remoteAbs}/mobile.log"; curl -sS -o /tmp/ng-status.json -w "\\nHTTP %{http_code}\\n" -H "X-Nur-Token: ${cfg.mobileToken}" http://127.0.0.1:${PORT}/api/status; cat /tmp/ng-status.json; echo'`,
    true
  );

  // cleaner crontab
  await exec(
    conn,
    `bash -lc 'crontab -l 2>/dev/null | grep -v nur_grab > /tmp/cron.nur || true; echo "@reboot /bin/bash -lc \\"${NVM}; cd ${remoteAbs} && exec node server.js >> ${remoteAbs}/mobile.log 2>&1\\"" >> /tmp/cron.nur; crontab /tmp/cron.nur; echo CRON_OK'`,
    true
  );

  const localCfg = { ...cfg, mobilePort: PORT, mobileBasePath: BASE };
  fs.writeFileSync(
    path.join(ROOT, "config.json"),
    JSON.stringify(localCfg, null, 2) + "\n"
  );

  const url = `https://${USER}.joker.usbx.me${BASE}/?token=${cfg.mobileToken}`;
  console.log("\n=== TEL / PC OFF ===\n" + url + "\n");

  // public HTTPS check
  await exec(
    conn,
    `bash -lc 'curl -sS -o /dev/null -w "public %{http_code}\\n" -H "X-Nur-Token: ${cfg.mobileToken}" "https://${USER}.joker.usbx.me${BASE}/api/status"'`,
    true
  );

  conn.end();
}

main().catch((e) => {
  console.error("FAIL:", e.message || e);
  process.exit(1);
});
