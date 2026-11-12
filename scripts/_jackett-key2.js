const { Client } = require("ssh2");
const fs = require("fs");
const path = require("path");
const cfg = require("../config.json");

const c = new Client();
c.on("ready", () => {
  const cmd = `bash -lc 'set +e
echo "== find ServerConfig =="
find /home/ryan -name ServerConfig.json 2>/dev/null | head -40
echo "== apps jackett =="
ls -la /home/ryan/.apps/jackett 2>/dev/null | head -25
ls -la /home/ryan/.apps/jackett/config 2>/dev/null | head -25
ls -la /home/ryan/.config/Jackett 2>/dev/null | head -25
echo "== docker =="
command -v docker >/dev/null && docker ps --format "{{.Names}}" 2>/dev/null | head -40
echo "== cat candidates =="
for f in \
  /home/ryan/.apps/jackett/ServerConfig.json \
  /home/ryan/.apps/jackett/config/ServerConfig.json \
  /home/ryan/.config/Jackett/ServerConfig.json \
  /home/ryan/Jackett/ServerConfig.json \
  /config/Jackett/ServerConfig.json; do
  if [ -f "\$f" ]; then
    echo FOUND:\$f
    python3 -c "import json;print(json.load(open(\\"\$f\\")).get(\\"APIKey\\",\\"\\\"))" 2>/dev/null
  fi
done
# recursive dump first hit
HIT=\$(find /home/ryan -name ServerConfig.json 2>/dev/null | head -1)
if [ -n "\$HIT" ]; then
  echo HIT:\$HIT
  python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get(\\"APIKey\\",\\"\\\"))" "\$HIT" 2>/dev/null
fi
echo "== prowlarr indexers =="
curl -s -H "X-Api-Key: ff9dd8420bf6496ca4876db65a389c49" \
  "https://ryan.joker.usbx.me/prowlarr/api/v1/indexer" \
  | python3 -c "import sys,json
try:
 d=json.load(sys.stdin)
 print(\"count\",len(d))
 for i in d:
  print(i.get(\"id\"), i.get(\"name\"), i.get(\"protocol\"), i.get(\"enable\"), (i.get(\"fields\") or [{}])[0].get(\"value\",\"\")[:40] if False else \"\")
except Exception as e:
 print(\"err\",e)
"
'`;
  c.exec(cmd, (e, s) => {
    let o = "";
    s.on("data", (d) => (o += d));
    s.stderr.on("data", (d) => (o += d));
    s.on("close", () => {
      console.log(o);
      const m = o.match(/EXTRACTED|APIKey["\s:=]+([a-zA-Z0-9]{16,})/i) ||
        o.match(/\b([a-z0-9]{24,40})\b/);
      // Prefer explicit python print after FOUND/HIT
      const lines = o.split(/\r?\n/);
      let key = null;
      for (let i = 0; i < lines.length; i++) {
        if (/^(FOUND|HIT):/.test(lines[i]) && lines[i + 1] && /^[a-zA-Z0-9]{16,}$/.test(lines[i + 1].trim())) {
          key = lines[i + 1].trim();
          break;
        }
      }
      if (!key) {
        const km = o.match(/APIKey["\s:=]+([a-zA-Z0-9]{16,})/i);
        if (km) key = km[1];
      }
      if (key && key !== "CHANGE_ME") {
        console.log("EXTRACTED_KEY", key);
        const cfgPath = path.join(__dirname, "..", "config.json");
        const j = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        j.jackettApiKey = key;
        j.jackettBase = j.jackettBase || "https://ryan.joker.usbx.me/jackett";
        fs.writeFileSync(cfgPath, JSON.stringify(j, null, 2) + "\n");
        console.log("config.json updated");
      } else {
        console.log("NO_KEY_FOUND");
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
