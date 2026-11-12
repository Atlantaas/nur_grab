/**
 * Deploy Nur Grab Mobile to Ultra (SSH/SFTP).
 * Uses assigned app-ports + nginx /grab/ reverse proxy.
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

const SKIP = new Set([
  "node_modules",
  ".git",
  "scripts",
  "Lancer Nur Grab.bat",
  "Lancer Nur Grab Mobile.bat",
]);

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
      readyTimeout: 20000,
      tryKeyboard: true,
    });
  });
}

function exec(conn, cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, { pty: opts.pty || false }, (err, stream) => {
      if (err) return reject(err);
      let out = "";
      let errOut = "";
      stream.on("data", (d) => {
        out += d.toString();
        if (opts.echo) process.stdout.write(d);
      });
      stream.stderr.on("data", (d) => {
        errOut += d.toString();
        if (opts.echo) process.stderr.write(d);
      });
      stream.on("close", (code) => {
        resolve({ code, out, errOut });
      });
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
  let cur = remotePath.startsWith("/") ? "/" : "";
  return parts.reduce(async (prev, part) => {
    await prev;
    cur = cur === "/" ? `/${part}` : cur ? `${cur}/${part}` : part;
    return new Promise((resolve) => {
      sftpClient.mkdir(cur, (err) => resolve()); // ignore exists
    });
  }, Promise.resolve());
}

function listLocalFiles(dir, base = dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    if (name === "electron" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules") continue;
      out.push(...listLocalFiles(full, base));
    } else {
      // skip huge / local-only
      if (name === "package-lock.json") continue;
      out.push({
        local: full,
        remote: path.relative(base, full).replace(/\\/g, "/"),
      });
    }
  }
  return out;
}

async function uploadTree(sftpClient, remoteRoot, files) {
  // ensure dirs
  const dirs = new Set();
  for (const f of files) {
    const d = path.posix.dirname(path.posix.join(remoteRoot, f.remote));
    dirs.add(d);
  }
  for (const d of [...dirs].sort()) {
    await mkdirp(sftpClient, d);
  }
  for (const f of files) {
    const remote = path.posix.join(remoteRoot, f.remote);
    await new Promise((resolve, reject) => {
      sftpClient.fastPut(f.local, remote, (err) => (err ? reject(err) : resolve()));
    });
    process.stdout.write(".");
  }
  console.log("");
}

async function main() {
  console.log(`Connecting ${USER}@${HOST}…`);
  const conn = await connect();
  console.log("SSH OK");

  // home
  const homeR = await exec(conn, "echo $HOME");
  const HOME = homeR.out.trim() || `/home/${USER}`;
  const remoteAbs = `${HOME}/${REMOTE_DIR}`;
  console.log("Remote:", remoteAbs);

  // ports
  let freePort = null;
  const ports = await exec(conn, "app-ports free 2>/dev/null || true");
  console.log("app-ports free:\n" + ports.out.trim().slice(0, 500));
  const portMatches = ports.out.match(/\b(\d{4,5})\b/g) || [];
  // prefer existing mobilePort if in free list, else first free
  if (portMatches.includes(String(cfg.mobilePort))) {
    freePort = Number(cfg.mobilePort);
  } else if (portMatches.length) {
    freePort = Number(portMatches[0]);
  }
  if (!freePort) {
    // fallback: try show and pick unused-looking
    const show = await exec(conn, "app-ports show 2>/dev/null || true");
    console.log("app-ports show:\n" + show.out.trim().slice(0, 800));
    throw new Error("Aucun port libre Ultra (app-ports free).");
  }
  console.log("Using port:", freePort);

  // node
  let nodeCheck = await exec(
    conn,
    'bash -lc \'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; which node; node -v; which npm\''
  );
  console.log("Node check:\n" + (nodeCheck.out || nodeCheck.errOut).trim());
  if (!/v\d+/.test(nodeCheck.out)) {
    console.log("Installing Node via Ultra script (non-interactive attempt)…");
    // Download installer and try; interactive menus may fail — check again
    await exec(
      conn,
      'bash -lc \'wget -qO /tmp/node-installer.sh https://scripts.ultra.cc/util-v2/LanguageInstaller/Node-Installer/main.sh; yes 1 | bash /tmp/node-installer.sh\'',
      { echo: true }
    );
    nodeCheck = await exec(
      conn,
      'bash -lc \'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; which node; node -v\''
    );
    console.log("Node after install:\n" + nodeCheck.out.trim());
    if (!/v\d+/.test(nodeCheck.out)) {
      throw new Error("Node.js introuvable sur Ultra — installe-le via UCP/SSH (Node Installer).");
    }
  }

  // upload
  console.log("Uploading…");
  const s = await sftp(conn);
  await mkdirp(s, remoteAbs);
  // write ultra-specific config (same secrets, assigned port)
  const ultraCfg = {
    ...cfg,
    mobilePort: freePort,
    mobileBasePath: BASE,
    mobileBind: "127.0.0.1",
  };
  const tmpCfg = path.join(ROOT, ".config.ultra.tmp.json");
  fs.writeFileSync(tmpCfg, JSON.stringify(ultraCfg, null, 2) + "\n");

  const files = listLocalFiles(ROOT).filter((f) => {
    // don't upload local config — use ultra one
    if (f.remote === "config.json") return false;
    if (f.remote === "config.example.json") return true;
    // skip electron dep in package — still upload package.json
    return true;
  });
  await uploadTree(s, remoteAbs, files);
  await new Promise((resolve, reject) => {
    s.fastPut(tmpCfg, `${remoteAbs}/config.json`, (err) =>
      err ? reject(err) : resolve()
    );
  });
  fs.unlinkSync(tmpCfg);
  console.log("Upload done");

  // package.json without electron for server-only install
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  delete pkg.devDependencies;
  pkg.scripts = { start: "node server.js", mobile: "node server.js" };
  const tmpPkg = path.join(ROOT, ".package.ultra.tmp.json");
  fs.writeFileSync(tmpPkg, JSON.stringify(pkg, null, 2) + "\n");
  await new Promise((resolve, reject) => {
    s.fastPut(tmpPkg, `${remoteAbs}/package.json`, (err) =>
      err ? reject(err) : resolve()
    );
  });
  fs.unlinkSync(tmpPkg);

  // npm install
  console.log("npm install…");
  const npm = await exec(
    conn,
    `bash -lc 'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; cd "${remoteAbs}" && npm install --omit=dev'`,
    { echo: true }
  );
  if (npm.code !== 0) {
    throw new Error("npm install failed: " + npm.errOut.slice(0, 400));
  }

  // nginx proxy
  const nginxDir = `${HOME}/.apps/nginx/proxy.d`;
  const nginxConf = `location ${BASE}/ {
    proxy_pass http://127.0.0.1:${freePort}/;
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
  await mkdirp(s, nginxDir);
  await new Promise((resolve, reject) => {
    s.fastPut(tmpNgx, `${nginxDir}/grab.conf`, (err) =>
      err ? reject(err) : resolve()
    );
  });
  fs.unlinkSync(tmpNgx);
  console.log("nginx grab.conf written");

  await exec(conn, "app-nginx restart 2>&1 || true", { echo: true });

  // stop old + start
  console.log("Starting server…");
  await exec(
    conn,
    `bash -lc 'pkill -f "node server.js" 2>/dev/null || true; mkdir -p "${HOME}/apps"; export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; cd "${remoteAbs}"; nohup node server.js > "${remoteAbs}/mobile.log" 2>&1 & echo $!; sleep 1; head -20 "${remoteAbs}/mobile.log"'`,
    { echo: true }
  );

  // crontab @reboot
  await exec(
    conn,
    `bash -lc '(crontab -l 2>/dev/null | grep -v nur_grab; echo "@reboot bash -lc \\"export NVM_DIR=\\\\$HOME/.nvm; [ -s \\\\\\$NVM_DIR/nvm.sh ] && . \\\\\\$NVM_DIR/nvm.sh; cd ${remoteAbs} && node server.js >> ${remoteAbs}/mobile.log 2>&1\\"") | crontab -'`,
    { echo: true }
  );

  // local config remember port
  const localCfg = { ...cfg, mobilePort: freePort, mobileBasePath: BASE };
  fs.writeFileSync(
    path.join(ROOT, "config.json"),
    JSON.stringify(localCfg, null, 2) + "\n"
  );

  const url = `https://${USER}.joker.usbx.me${BASE}/?token=${cfg.mobileToken}`;
  console.log("\n=== READY ===");
  console.log(url);
  console.log("==============\n");

  // quick remote curl
  await exec(
    conn,
    `bash -lc 'curl -sS -o /dev/null -w "%{http_code}" -H "X-Nur-Token: ${cfg.mobileToken}" http://127.0.0.1:${freePort}/api/status'`,
    { echo: true }
  );

  conn.end();
}

main().catch((e) => {
  console.error("DEPLOY FAIL:", e.message || e);
  process.exit(1);
});
