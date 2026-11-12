const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");

const ROOT = path.join(__dirname, "..");
const cfgPath = path.join(ROOT, "config.json");
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
cfg.mobilePin = "384750";
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");

const files = [
  ["server.js", "/home/ryan/apps/nur_grab/server.js"],
  ["lib/grab-service.js", "/home/ryan/apps/nur_grab/lib/grab-service.js"],
  ["mobile/app.js", "/home/ryan/apps/nur_grab/mobile/app.js"],
  ["mobile/index.html", "/home/ryan/apps/nur_grab/mobile/index.html"],
  ["mobile/styles.css", "/home/ryan/apps/nur_grab/mobile/styles.css"],
  ["config.json", "/home/ryan/apps/nur_grab/config.json"],
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
        console.log("\nuploaded — restarting…");
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
          `echo STARTED:$(cat "$PIDFILE")`,
          `curl -sS -m 5 -H "X-Nur-Token: 384750" http://127.0.0.1:39664/api/status`,
          `echo`,
          `curl -sS -m 10 -o /dev/null -w "pub_pin %{http_code}\\n" -H "X-Nur-Token: 384750" https://ryan.joker.usbx.me/grab/api/status`,
          `curl -sS -m 10 -o /dev/null -w "pub_tok %{http_code}\\n" -H "X-Nur-Token: ${cfg.mobileToken}" https://ryan.joker.usbx.me/grab/api/status`,
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
