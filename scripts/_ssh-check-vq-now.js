const { Client } = require("ssh2");
const cfg = require("../config.json");

const cmd = [
  'echo "=== TV root VQ ==="',
  'ls -la "/home/ryan/media/TV Shows/" | grep -i vision || true',
  'echo "=== Season Vision Quest ==="',
  'ls -la "/home/ryan/media/TV Shows/Vision Quest/Season 01/" 2>/dev/null || echo "no Vision Quest season"',
  'echo "=== Season VisionQuest ==="',
  'ls -la "/home/ryan/media/TV Shows/VisionQuest/Season 01/" 2>/dev/null || echo "no VisionQuest season"',
  'echo "=== find vision* ==="',
  'find "/home/ryan/media/TV Shows" -maxdepth 3 \\( -iname "*vision*quest*" -o -iname "*VisionQuest*" \\) 2>/dev/null',
  'echo "=== downloads ==="',
  'find /home/ryan/downloads /home/ryan/incomplete /home/ryan/media -maxdepth 4 -iname "*vision*quest*" 2>/dev/null | head -50',
].join("; ");

const conn = new Client();
conn
  .on("ready", () => {
    console.log("SSH OK");
    conn.exec(cmd, (err, stream) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      stream.on("data", (d) => process.stdout.write(d));
      stream.stderr.on("data", (d) => process.stderr.write(d));
      stream.on("close", (code) => {
        conn.end();
        process.exit(code || 0);
      });
    });
  })
  .on("error", (e) => {
    console.error(e);
    process.exit(1);
  })
  .connect({
    host: cfg.ftpHost,
    port: 22,
    username: cfg.ftpUser,
    password: cfg.ftpPass,
    readyTimeout: 25000,
  });
