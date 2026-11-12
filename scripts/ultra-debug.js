const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");
const cfg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8")
);

function connect() {
  return new Promise((resolve, reject) => {
    const c = new Client();
    c.on("ready", () => resolve(c));
    c.on("error", reject);
    c.connect({
      host: cfg.ftpHost,
      port: 22,
      username: cfg.ftpUser,
      password: cfg.ftpPass,
      readyTimeout: 25000,
    });
  });
}

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = "";
      stream.on("data", (d) => (out += d.toString()));
      stream.stderr.on("data", (d) => (out += d.toString()));
      stream.on("close", (code) => resolve({ code, out }));
    });
  });
}

const NVM =
  'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"';
const DIR = "$HOME/apps/nur_grab";
const PORT = cfg.mobilePort || 39664;

(async () => {
  const conn = await connect();
  const cmds = [
    `bash -lc 'ls -la ${DIR} | head -30'`,
    `bash -lc 'cat ${DIR}/mobile.log 2>/dev/null | tail -40; echo ---; ls ${DIR}/lib | head'`,
    `bash -lc '${NVM}; cd ${DIR}; node -e "console.log(require(\\"./config.json\\").mobilePort)"'`,
    `bash -lc 'ss -lntp 2>/dev/null | grep ${PORT} || netstat -lntp 2>/dev/null | grep ${PORT} || echo NO_LISTEN'`,
    `bash -lc 'ps aux | grep -E "[n]ode.*server" || echo NO_PROC'`,
    `bash -lc 'cat $HOME/.apps/nginx/proxy.d/grab.conf'`,
    `bash -lc '${NVM}; cd ${DIR}; node server.js'`,
  ];
  // last one starts in foreground briefly — instead use timeout
  for (const c of cmds.slice(0, 6)) {
    console.log("\n>>", c.slice(0, 80));
    const r = await exec(conn, c);
    console.log(r.out.slice(0, 2000));
  }
  console.log("\n>> start background");
  const start = await exec(
    conn,
    `bash -lc 'pkill -f "${DIR}/server.js" 2>/dev/null; pkill -f "node server.js" 2>/dev/null; sleep 1; ${NVM}; cd ${DIR}; nohup node server.js >> ${DIR}/mobile.log 2>&1 & echo PID:$!; sleep 2; cat ${DIR}/mobile.log | tail -20; curl -sS -m 5 -H "X-Nur-Token: ${cfg.mobileToken}" http://127.0.0.1:${PORT}/api/status; echo; curl -sS -m 8 -o /dev/null -w "pub %{http_code}\\n" -H "X-Nur-Token: ${cfg.mobileToken}" https://ryan.joker.usbx.me/grab/api/status'`
  );
  console.log(start.out);
  conn.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
