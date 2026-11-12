const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");
const cfg = require("../config.json");

const token = cfg.mobileToken;
const localSh = path.join(__dirname, "_restart-remote.sh");
const sh = `#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
pkill -f "node server.js" 2>/dev/null || true
cd "$HOME/apps/nur_grab" || exit 1
nohup node server.js >> mobile.log 2>&1 &
echo STARTED:$!
sleep 3
echo "=== LOG ==="
tail -40 mobile.log
echo "=== PORT ==="
(ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep 39664 || echo "port not listening"
echo "=== CURL ==="
curl -sS -m 8 -w "\\nHTTP:%{http_code}\\n" -H "X-Nur-Token: ${token}" http://127.0.0.1:39664/api/status || echo curl_fail
`;
fs.writeFileSync(localSh, sh.replace(/\r\n/g, "\n"));

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
  const remote = "/home/ryan/apps/nur_grab/_restart.sh";
  await new Promise((resolve, reject) => {
    sftp.fastPut(localSh, remote, (err) => (err ? reject(err) : resolve()));
  });
  console.log("script uploaded");
  await new Promise((resolve, reject) => {
    conn.exec(`bash ${remote}`, (err, stream) => {
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
    fs.unlinkSync(localSh);
  } catch (_) {}
})().catch((e) => {
  console.error("FAIL", e.message || e);
  process.exit(1);
});
