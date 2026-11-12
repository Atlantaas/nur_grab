const { Client } = require("ssh2");
const cfg = require("../config.json");
const port = cfg.mobilePort || 39664;
const token = cfg.mobileToken;
const script = `#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
cd "$HOME/apps/nur_grab" || exit 1
pkill -f "node server.js" || true
sleep 1
nohup node server.js > mobile.log 2>&1 &
sleep 2
echo "LISTEN:"
(ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null) | grep ${port} || true
echo "CURL:"
curl -sS -m 8 -H "X-Nur-Token: ${token}" "http://127.0.0.1:${port}/api/status" | head -c 400
echo
app-nginx restart 2>&1 | tail -8
`;

const c = new Client();
c.on("ready", () => {
  c.sftp((err, sftp) => {
    if (err) {
      console.error(err);
      c.end();
      return;
    }
    const remote = "/home/ryan/apps/nur_grab/_start.sh";
    const buf = Buffer.from(script, "utf8");
    const ws = sftp.createWriteStream(remote, { mode: 0o755 });
    ws.on("close", () => {
      c.exec(`bash ${remote}`, (e2, stream) => {
        let o = "";
        stream.on("data", (d) => (o += d));
        stream.stderr.on("data", (d) => (o += d));
        stream.on("close", () => {
          console.log(o);
          c.end();
        });
      });
    });
    ws.end(buf);
  });
});
c.on("error", (e) => console.error(e.message));
c.connect({
  host: cfg.ftpHost,
  port: 22,
  username: cfg.ftpUser,
  password: cfg.ftpPass,
  readyTimeout: 35000,
});
