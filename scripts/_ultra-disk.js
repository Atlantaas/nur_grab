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
    "df -h /home/ryan 2>/dev/null || df -h $HOME",
    "df -h /home/ryan/media 2>/dev/null || true",
    "quota -s 2>/dev/null || true",
    "du -sh /home/ryan/media 2>/dev/null || true",
    "du -sh /home/ryan/media/Movies /home/ryan/media/'TV Shows' 2>/dev/null || true",
  ].join("; echo '----'; ");
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
