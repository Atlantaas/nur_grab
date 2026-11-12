const { Client } = require("ssh2");
const fs = require("fs");
const path = require("path");
const cfg = require("../config.json");

const c = new Client();
c.on("ready", () => {
  const cmd = [
    "find /home/ryan/.apps/jackett -type f | head -80",
    "echo ===",
    "ls -laR /home/ryan/.apps/jackett | head -100",
    "echo ===",
    "find /home/ryan/.apps/jackett -name ServerConfig.json -exec echo FOUND:{} \\; -exec python3 -c \"import json,sys; print(json.load(open(sys.argv[1])).get('APIKey',''))\" {} \\;",
    "echo ===PROWLARR===",
    'curl -s -H "X-Api-Key: ff9dd8420bf6496ca4876db65a389c49" "https://ryan.joker.usbx.me/prowlarr/api/v1/indexer" -o /tmp/pr.json',
    "python3 -c \"import json; d=json.load(open('/tmp/pr.json')); print('count',len(d));",
    "[print(i.get('id'), i.get('name'), i.get('protocol'), i.get('enable')) for i in d]\"",
  ].join("; ");
  c.exec(`bash -lc ${JSON.stringify(cmd)}`, (e, s) => {
    let o = "";
    s.on("data", (d) => (o += d));
    s.stderr.on("data", (d) => (o += d));
    s.on("close", () => {
      console.log(o);
      const lines = o.split(/\r?\n/);
      let key = null;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith("FOUND:") && lines[i + 1] && /^[a-zA-Z0-9]{16,}$/.test(lines[i + 1].trim())) {
          key = lines[i + 1].trim();
          break;
        }
      }
      if (key) {
        const cfgPath = path.join(__dirname, "..", "config.json");
        const j = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        j.jackettApiKey = key;
        fs.writeFileSync(cfgPath, JSON.stringify(j, null, 2) + "\n");
        console.log("UPDATED jackettApiKey", key);
      } else {
        console.log("NO_KEY — will rely on Prowlarr FR + C411");
      }
      c.end();
    });
  });
});
c.on("error", (e) => console.error(e.message));
c.connect({
  host: cfg.ftpHost,
  port: 22,
  username: cfg.ftpUser,
  password: cfg.ftpPass,
  readyTimeout: 45000,
});
