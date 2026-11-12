/**
 * Deploy grab-service + clients (films → qBit) and restart Ultra grab.
 */
const path = require("path");
const { Client } = require("ssh2");
const cfg = require("../config.json");

const files = [
  ["lib/grab-service.js", "/home/ryan/apps/nur_grab/lib/grab-service.js"],
  ["lib/clients.js", "/home/ryan/apps/nur_grab/lib/clients.js"],
];

const remoteSh = `#!/bin/bash
set -e
echo === MOVIES ===
ls -lt "$HOME/media/Movies" 2>/dev/null | head -12 || true
echo === WATCH TX ===
ls -lt "$HOME/watch/transmission" 2>/dev/null | head -15 || true
echo === WATCH QBIT ===
ls -lt "$HOME/watch/qbittorrent" 2>/dev/null | head -10 || true
echo === TX PROC ===
pgrep -af transmission | head -5 || echo no-tx
echo === RESTART GRAB ===
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
pkill -f "node server.js" 2>/dev/null || true
cd "$HOME/apps/nur_grab" || exit 1
nohup node server.js >> mobile.log 2>&1 &
sleep 3
curl -sS -m 8 -H "X-Nur-Token: ${cfg.mobileToken}" http://127.0.0.1:39664/api/status | head -c 700
echo
`;

(async () => {
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on("ready", resolve);
    conn.on("error", reject);
    conn.connect({
      host: cfg.ftpHost,
      port: 22,
      username: cfg.ftpUser,
      password: cfg.ftpPass,
      readyTimeout: 25000,
    });
  });
  console.log("SSH OK");
  const sftp = await new Promise((resolve, reject) => {
    conn.sftp((err, s) => (err ? reject(err) : resolve(s)));
  });

  for (const [localRel, remote] of files) {
    const local = path.join(__dirname, "..", localRel);
    await new Promise((resolve, reject) => {
      sftp.fastPut(local, remote, (err) => (err ? reject(err) : resolve()));
    });
    console.log("uploaded", localRel);
  }

  const remotePath = "/home/ryan/apps/nur_grab/_deploy-qbit-movies.sh";
  const localSh = path.join(__dirname, "_deploy-qbit-movies.sh");
  require("fs").writeFileSync(localSh, remoteSh.replace(/\r\n/g, "\n"));
  await new Promise((resolve, reject) => {
    sftp.fastPut(localSh, remotePath, (err) => (err ? reject(err) : resolve()));
  });
  console.log("script uploaded");

  await new Promise((resolve, reject) => {
    conn.exec(`bash ${remotePath}`, (err, stream) => {
      if (err) return reject(err);
      stream.on("data", (d) => process.stdout.write(d));
      stream.stderr.on("data", (d) => process.stderr.write(d));
      stream.on("close", (code) => {
        console.log("exit", code);
        resolve();
      });
    });
  });
  conn.end();
  try {
    require("fs").unlinkSync(localSh);
  } catch (_) {}
})().catch((e) => {
  console.error("FAIL", e.message || e);
  process.exit(1);
});
