const { Client } = require("ssh2");
const cfg = require("../config.json");
const c = new Client();
c.on("ready", () => {
  const cmd = [
    "find ~ -name ServerConfig.json 2>/dev/null | head -8",
    "ls ~/apps 2>/dev/null | head -40",
  ].join("; echo '---'; ");
  c.exec(cmd, (e, s) => {
    let o = "";
    s.on("data", (d) => (o += d));
    s.stderr.on("data", (d) => (o += d));
    s.on("close", () => {
      console.log(o);
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
  readyTimeout: 25000,
});
