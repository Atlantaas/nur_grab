const { Client } = require("ssh2");
const cfg = require("../config.json");

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
  const cmd = [
    'ls -la "/home/ryan/media/TV Shows/Vision Quest/Season 01/"',
    'find /home/ryan/media -maxdepth 3 -iname "*vision*" 2>/dev/null',
    'docker ps --format "{{.Names}} {{.Image}}" | head -20',
    'ls -la /home/ryan/.config/jellyfin 2>/dev/null | head -5 || true',
  ].join("; echo ----; ");
  await new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      stream.on("data", (d) => process.stdout.write(d));
      stream.stderr.on("data", (d) => process.stderr.write(d));
      stream.on("close", () => resolve());
    });
  });
  conn.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
