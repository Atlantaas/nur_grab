const { Client } = require("ssh2");
const fs = require("fs");
const path = require("path");
const cfg = require("../config.json");

const c = new Client();
c.on("ready", () => {
  const cmd = `bash -lc 'set +e
find "$HOME" -name ServerConfig.json 2>/dev/null | head -30
echo ---
for d in "$HOME/.config/Jackett" "$HOME/Jackett" "$HOME/.local/share/Jackett" "$HOME/apps/jackett" "$HOME/.apps/jackett" "$HOME/bin/Jackett"; do
  if [ -f "\$d/ServerConfig.json" ]; then echo FOUND:\$d; python3 -c "import json;print(json.load(open(\\"\$d/ServerConfig.json\\")).get(\\"APIKey\\",\\"\\\"))" 2>/dev/null || grep -o "APIKey[^,]*" "\$d/ServerConfig.json" | head -1; fi
done
echo ---
ls "$HOME/.apps" 2>/dev/null | head -40
ls "$HOME/apps" 2>/dev/null | head -40
'`;
  c.exec(cmd, (e, s) => {
    let o = "";
    s.on("data", (d) => (o += d));
    s.stderr.on("data", (d) => (o += d));
    s.on("close", () => {
      console.log(o);
      // Try extract APIKey from dump
      const m = o.match(/APIKey["\s:=]+([a-zA-Z0-9_-]{8,})/);
      if (m) {
        const key = m[1];
        console.log("EXTRACTED_KEY", key);
        const cfgPath = path.join(__dirname, "..", "config.json");
        const j = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        j.jackettApiKey = key;
        j.jackettBase = j.jackettBase || "https://ryan.joker.usbx.me/jackett";
        fs.writeFileSync(cfgPath, JSON.stringify(j, null, 2) + "\n");
        console.log("config.json updated with jackettApiKey");
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
  readyTimeout: 35000,
});
