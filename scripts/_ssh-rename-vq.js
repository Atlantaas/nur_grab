const { Client } = require("ssh2");
const cfg = require("../config.json");

// Align folder name with existing Jellyfin series "VisionQuest"
const cmd = [
  'if [ -d "/home/ryan/media/TV Shows/Vision Quest" ]; then mv -v "/home/ryan/media/TV Shows/Vision Quest" "/home/ryan/media/TV Shows/VisionQuest"; fi',
  'mkdir -p "/home/ryan/media/TV Shows/VisionQuest/Season 01"',
  'ls -la "/home/ryan/media/TV Shows/VisionQuest/"',
  'ls -la "/home/ryan/media/TV Shows/VisionQuest/Season 01/"',
].join(" && ");

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
  await new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      stream.on("data", (d) => process.stdout.write(d));
      stream.stderr.on("data", (d) => process.stderr.write(d));
      stream.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`exit ${code}`)),
      );
    });
  });
  conn.end();
  console.log("DONE rename");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
