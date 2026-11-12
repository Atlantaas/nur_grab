const { Client } = require("ssh2");
const cfg = require("../config.json");
const c = new Client();
c.on("ready", () => {
  const cmd = `bash -lc 'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; cd "$HOME/apps/nur_grab"; ls -la server.js lib/fr_indexers.js lib/grab-service.js 2>&1; echo ====LOG====; tail -n 80 mobile.log 2>&1; echo ====TRY====; node -e "require(\\"./lib/fr_indexers\\"); require(\\"./lib/grab-service\\"); console.log(\\"ok-load\\")" 2>&1; node server.js &'`;
  c.exec(cmd, { pty: true }, (e, s) => {
    let o = "";
    s.on("data", (d) => (o += d));
    s.stderr.on("data", (d) => (o += d));
    setTimeout(() => {
      console.log(o.slice(-4000));
      c.end();
    }, 8000);
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
