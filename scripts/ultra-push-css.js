const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");

const ROOT = path.join(__dirname, "..");
const cfg = JSON.parse(
  fs.readFileSync(path.join(ROOT, "config.json"), "utf8").replace(/^\uFEFF/, "")
);

const files = [
  ["mobile/styles.css", "/home/ryan/apps/nur_grab/mobile/styles.css"],
  ["mobile/app.js", "/home/ryan/apps/nur_grab/mobile/app.js"],
  ["mobile/index.html", "/home/ryan/apps/nur_grab/mobile/index.html"],
];

const conn = new Client();
conn
  .on("ready", () => {
    conn.sftp((err, sftp) => {
      if (err) throw err;
      (async () => {
        for (const [local, remote] of files) {
          await new Promise((resolve, reject) => {
            sftp.fastPut(path.join(ROOT, local), remote, (e) =>
              e ? reject(e) : resolve()
            );
          });
          console.log("ok", local);
        }
        conn.exec(
          "grep -n 'auth-gate\\[hidden\\]' /home/ryan/apps/nur_grab/mobile/styles.css; grep -n 'style.display' /home/ryan/apps/nur_grab/mobile/app.js | head -5",
          (e2, stream) => {
            stream.on("data", (d) => process.stdout.write(d));
            stream.stderr.on("data", (d) => process.stderr.write(d));
            stream.on("close", () => conn.end());
          }
        );
      })().catch((e) => {
        console.error(e);
        conn.end();
        process.exit(1);
      });
    });
  })
  .connect({
    host: cfg.ftpHost,
    port: 22,
    username: cfg.ftpUser,
    password: cfg.ftpPass,
  });
