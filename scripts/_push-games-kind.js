/** Push game-kind patches to Ultra + restart Grab. */
const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");

const ROOT = path.join(__dirname, "..");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const REMOTE = "apps/nur_grab";

const FILES = [
  "lib/c411.js",
  "lib/clients.js",
  "lib/ftp.js",
  "lib/fr_indexers.js",
  "lib/grab-service.js",
];

function connect() {
  return new Promise((resolve, reject) => {
    const c = new Client();
    c.on("ready", () => resolve(c));
    c.on("error", reject);
    c.connect({
      host: cfg.ftpHost,
      port: 22,
      username: cfg.ftpUser,
      password: cfg.ftpPass,
      readyTimeout: 30000,
    });
  });
}

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = "";
      stream.on("data", (d) => (out += d));
      stream.stderr.on("data", (d) => (out += d));
      stream.on("close", (code) => resolve({ code, out }));
    });
  });
}

function sftp(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, s) => (err ? reject(err) : resolve(s)));
  });
}

async function main() {
  const conn = await connect();
  const home = (await exec(conn, "echo $HOME")).out.trim();
  const remoteRoot = `${home}/${REMOTE}`;
  console.log("Remote", remoteRoot);
  const s = await sftp(conn);
  for (const rel of FILES) {
    const local = path.join(ROOT, rel);
    const remote = `${remoteRoot}/${rel.replace(/\\/g, "/")}`;
    await new Promise((resolve, reject) => {
      s.fastPut(local, remote, (err) => (err ? reject(err) : resolve()));
    });
    console.log("OK", rel);
  }
  // patch savePathGames in remote config if missing
  const patch = await exec(
    conn,
    `bash -lc 'cd "${remoteRoot}" && node -e "
const fs=require(\\"fs\\");
const p=\\"config.json\\";
const c=JSON.parse(fs.readFileSync(p,\\"utf8\\"));
if(!c.savePathGames){c.savePathGames=\\"/home/ryan/media/Games\\";fs.writeFileSync(p,JSON.stringify(c,null,2)+\\"\\\\n\\");console.log(\\"config+savePathGames\\");}
else console.log(\\"config ok\\");
"'`,
  );
  console.log(patch.out.trim());
  const port = cfg.mobilePort || 39664;
  const restart = await exec(
    conn,
    `bash -lc 'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; pkill -f "node server.js" 2>/dev/null || true; sleep 1; cd "$HOME/${REMOTE}" || exit 1; nohup node server.js > mobile.log 2>&1 & sleep 2; curl -sS -o /dev/null -w "HTTP:%{http_code}\\n" -H "X-Nur-Token: ${cfg.mobileToken}" http://127.0.0.1:${port}/api/status; curl -sS -H "X-Nur-Token: ${cfg.mobileToken}" "http://127.0.0.1:${port}/api/browse?section=games-pc&limit=3" | head -c 400; echo'`,
  );
  console.log(restart.out.trim());
  conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
