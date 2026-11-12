const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");
const cfg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8")
);

const NODE = "/home/ryan/.nvm/versions/node/v24.21.0/bin/node";
const DIR = "/home/ryan/apps/nur_grab";

const conn = new Client();
conn
  .on("ready", () => {
    // Write a start wrapper (no pkill string pitfalls), then crontab @reboot
    const wrapper = `#!/bin/bash
DIR="${DIR}"
NODE="${NODE}"
PIDFILE="$DIR/mobile.pid"
cd "$DIR" || exit 1
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  exit 0
fi
nohup "$NODE" "$DIR/server.js" >> "$DIR/mobile.log" 2>&1 &
echo $! > "$PIDFILE"
`;
    const b64 = Buffer.from(wrapper).toString("base64");
    const script = `
echo '${b64}' | base64 -d > ${DIR}/start-mobile.sh
chmod +x ${DIR}/start-mobile.sh
# clean old nur_grab cron lines, keep others
crontab -l 2>/dev/null | grep -v nur_grab | grep -v start-mobile > /tmp/cron.new || true
echo "@reboot ${DIR}/start-mobile.sh" >> /tmp/cron.new
crontab /tmp/cron.new
echo "=== crontab ==="
crontab -l
echo "=== wrapper ==="
cat ${DIR}/start-mobile.sh
`;
    conn.exec(script, (err, stream) => {
      if (err) throw err;
      stream.on("data", (d) => process.stdout.write(d));
      stream.stderr.on("data", (d) => process.stderr.write(d));
      stream.on("close", () => conn.end());
    });
  })
  .connect({
    host: cfg.ftpHost,
    port: 22,
    username: cfg.ftpUser,
    password: cfg.ftpPass,
  });
