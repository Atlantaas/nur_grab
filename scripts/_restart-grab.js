const { Client } = require("ssh2");
const cfg = require("../config.json");
const port = cfg.mobilePort || 39664;
const c = new Client();
c.on("ready", () => {
  const cmd = `bash -lc 'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; pkill -f "node server.js" 2>/dev/null || true; sleep 1; cd "$HOME/apps/nur_grab" || exit 1; nohup node server.js > mobile.log 2>&1 & echo PID:$!; sleep 2; curl -sS -o /dev/null -w "HTTP:%{http_code}\\n" -H "X-Nur-Token: ${cfg.mobileToken}" http://127.0.0.1:${port}/api/status; tail -n 15 mobile.log'`;
  c.exec(cmd, (e, s) => {
    if (e) {
      console.error(e);
      c.end();
      return;
    }
    let o = "";
    s.on("data", (d) => (o += d));
    s.stderr.on("data", (d) => (o += d));
    s.on("close", (code) => {
      console.log(o);
      console.log("exit", code);
      c.end();
    });
  });
});
c.on("error", (e) => console.error(e.message));
c.connect({
  host: cfg.ftpHost,
  port: 22,
  username: cfg.ftpUser,
  password: cfg.ftpPass,
  readyTimeout: 30000,
});
