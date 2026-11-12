const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");
const cfg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8")
);

const conn = new Client();
conn
  .on("ready", () => {
    const script = `
DIR=/home/ryan/apps/nur_grab
echo "=== remote config token/port ==="
node -e "const c=require('$DIR/config.json'); console.log('token='+c.mobileToken); console.log('port='+c.mobilePort); console.log('bind='+c.mobileBind)"
echo "=== pid ==="
cat $DIR/mobile.pid 2>/dev/null; echo
if [ -f $DIR/mobile.pid ]; then kill -0 $(cat $DIR/mobile.pid) 2>/dev/null && echo ALIVE || echo DEAD; fi
echo "=== listen ==="
ss -lntp 2>/dev/null | grep 39664 || echo NO_LISTEN
echo "=== log tail ==="
tail -40 $DIR/mobile.log 2>/dev/null
echo "=== nginx ==="
cat $HOME/.apps/nginx/proxy.d/grab.conf 2>/dev/null
echo "=== local curl ==="
curl -sS -m 5 -H "X-Nur-Token: $(node -e "console.log(require('$DIR/config.json').mobileToken)")" http://127.0.0.1:39664/api/status || echo LOCAL_FAIL
echo
echo "=== public curl ==="
curl -sS -m 10 -w "\\nHTTP %{http_code}\\n" -H "X-Nur-Token: $(node -e "console.log(require('$DIR/config.json').mobileToken)")" https://ryan.joker.usbx.me/grab/api/status || echo PUB_FAIL
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
