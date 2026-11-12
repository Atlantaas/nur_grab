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
    `echo '==== find daryl ===='`,
    `find /home/ryan -iname '*daryl*' 2>/dev/null | head -60`,
    `echo '==== trash ===='`,
    `ls -la /home/ryan/.local/share/Trash/files 2>/dev/null | head -20 || true`,
    `find /home/ryan/.local/share/Trash -iname '*daryl*' 2>/dev/null | head -20 || true`,
    `echo '==== jellyfin trash ===='`,
    `find /home/ryan -path '*jellyfin*' -iname '*daryl*' 2>/dev/null | head -20 || true`,
    `echo '==== qbit ===='`,
    `ls /home/ryan/.config/qBittorrent 2>/dev/null | head -5 || true`,
    `echo '==== TV Shows recent ===='`,
    `ls -lt "/home/ryan/media/TV Shows" | head -25`,
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
