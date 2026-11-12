const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");

const ROOT = path.join(__dirname, "..");
const cfg = JSON.parse(
  fs.readFileSync(path.join(ROOT, "config.json"), "utf8").replace(/^\uFEFF/, "")
);

const files = [
  ["server.js", "/home/ryan/apps/nur_grab/server.js"],
  ["mobile/app.js", "/home/ryan/apps/nur_grab/mobile/app.js"],
  ["mobile/index.html", "/home/ryan/apps/nur_grab/mobile/index.html"],
];

const NODE = "/home/ryan/.nvm/versions/node/v24.21.0/bin/node";
const DIR = "/home/ryan/apps/nur_grab";

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
          process.stdout.write(local + " ");
        }
        console.log("\nrestart…");
        const script = [
          `DIR=${DIR}`,
          `NODE=${NODE}`,
          `PIDFILE=$DIR/mobile.pid`,
          `if [ -f "$PIDFILE" ]; then kill "$(cat "$PIDFILE")" 2>/dev/null || true; rm -f "$PIDFILE"; fi`,
          `fuser -k 39664/tcp 2>/dev/null || true`,
          `sleep 1`,
          `cd "$DIR"`,
          `nohup "$NODE" "$DIR/server.js" >> "$DIR/mobile.log" 2>&1 &`,
          `echo $! > "$PIDFILE"`,
          `sleep 2`,
          `curl -sS -m 5 -o /dev/null -w "app.js %{http_code} " "https://ryan.joker.usbx.me/grab/app.js?v=3"`,
          `curl -sS -m 5 "https://ryan.joker.usbx.me/grab/app.js?v=3" | grep -c apiUrl || true`,
          `echo`,
          `curl -sS -m 8 -o /dev/null -w "pin %{http_code}\\n" -H "X-Nur-Token: 384750" "https://ryan.joker.usbx.me/grab/api/status"`,
        ].join("\n");
        conn.exec(script, (e2, stream) => {
          if (e2) throw e2;
          stream.on("data", (d) => process.stdout.write(d));
          stream.stderr.on("data", (d) => process.stderr.write(d));
          stream.on("close", () => conn.end());
        });
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
