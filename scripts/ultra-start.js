const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");
const cfg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8")
);

const NODE = "/home/ryan/.nvm/versions/node/v24.21.0/bin/node";
const DIR = "/home/ryan/apps/nur_grab";
const PORT = cfg.mobilePort || 39664;
const TOKEN = cfg.mobileToken;

const conn = new Client();
conn
  .on("ready", () => {
    // Avoid pkill -f matching this remote shell command line.
    const script = `
DIR="${DIR}"
NODE="${NODE}"
PORT="${PORT}"
PIDFILE="$DIR/mobile.pid"
cd "$DIR" || exit 1
if [ -f "$PIDFILE" ]; then
  kill "$(cat "$PIDFILE")" 2>/dev/null || true
  rm -f "$PIDFILE"
fi
fuser -k \${PORT}/tcp 2>/dev/null || true
sleep 1
nohup "$NODE" "$DIR/server.js" >> "$DIR/mobile.log" 2>&1 &
echo $! > "$PIDFILE"
echo STARTED:$(cat "$PIDFILE")
sleep 2
if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then echo ALIVE; else echo DEAD; fi
tail -30 "$DIR/mobile.log"
echo "--- local ---"
curl -sS -m 5 -H "X-Nur-Token: ${TOKEN}" "http://127.0.0.1:\${PORT}/api/status" || echo CURL_FAIL
echo
echo "--- public ---"
curl -sS -m 12 -o /dev/null -w "pub %{http_code}\\n" -H "X-Nur-Token: ${TOKEN}" "https://ryan.joker.usbx.me/grab/api/status" || echo PUB_FAIL
`;
    conn.exec(script, (err, stream) => {
      if (err) throw err;
      stream.on("data", (d) => process.stdout.write(d));
      stream.stderr.on("data", (d) => process.stderr.write(d));
      stream.on("close", (code) => {
        console.log("\nexit", code);
        conn.end();
      });
    });
  })
  .connect({
    host: cfg.ftpHost,
    port: 22,
    username: cfg.ftpUser,
    password: cfg.ftpPass,
  });
