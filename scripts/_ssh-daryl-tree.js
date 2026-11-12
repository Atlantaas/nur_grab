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
  const series = "/home/ryan/media/TV Shows/The Walking Dead Daryl Dixon";
  const cmd = [
    `ls -la ${JSON.stringify(series)}`,
    `for d in ${JSON.stringify(series)}/Season*; do echo "-- $d"; ls -1 "$d" 2>/dev/null | wc -l; ls -1 "$d" 2>/dev/null | head -4; done`,
    `du -sh ${JSON.stringify(series)}`,
  ].join("; ");
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
