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
    `find /home/ryan/media/TV\\ Shows -maxdepth 3 \\( -iname '*daryl*' -o -iname '*dixon*' \\) 2>/dev/null | head -80`,
    `echo '===='`,
    `ls -la /home/ryan/media/TV\\ Shows/ | grep -iE 'daryl|dixon' || true`,
    `echo '===='`,
    `find /home/ryan/media -maxdepth 4 -iname '*daryl*' 2>/dev/null | head -40`,
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
