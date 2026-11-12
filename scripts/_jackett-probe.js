const https = require("https");
const http = require("http");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");
const cfg = require("../config.json");

function request(urlStr, redirects = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: "GET",
        headers: { Accept: "application/json", "User-Agent": "NurGrab/1" },
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirects < 5
        ) {
          const next = new URL(res.headers.location, urlStr).toString();
          res.resume();
          return resolve(request(next, redirects + 1));
        }
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
            finalUrl: urlStr,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  // Read BasePath from ServerConfig via SSH
  const c = new Client();
  const basePath = await new Promise((resolve) => {
    c.on("ready", () => {
      c.exec(
        "python3 -c \"import json;print(json.load(open('/home/ryan/.apps/jackett/Jackett/ServerConfig.json')).get('BasePathOverride') or '')\"",
        (e, s) => {
          let o = "";
          s.on("data", (d) => (o += d));
          s.on("close", () => {
            c.end();
            resolve(o.trim());
          });
        },
      );
    });
    c.on("error", () => resolve(""));
    c.connect({
      host: cfg.ftpHost,
      port: 22,
      username: cfg.ftpUser,
      password: cfg.ftpPass,
      readyTimeout: 30000,
    });
  });
  console.log("BasePathOverride:", JSON.stringify(basePath));

  const key = cfg.jackettApiKey;
  const candidates = [
    `https://ryan.joker.usbx.me/jackett/api/v2.0/indexers?apikey=${key}`,
    `https://ryan.joker.usbx.me/jackett/api/v2.0/indexers/all/results/torznab/api?apikey=${key}&t=search&q=test&limit=3`,
    basePath
      ? `https://ryan.joker.usbx.me${basePath}/api/v2.0/indexers?apikey=${key}`
      : null,
  ].filter(Boolean);

  for (const u of candidates) {
    try {
      const r = await request(u);
      console.log("\nURL", u.replace(key, "***"));
      console.log("status", r.status, "final", r.finalUrl.replace(key, "***"));
      console.log("body", r.body.slice(0, 200));
      if (r.status === 200 && r.body.startsWith("[")) {
        const list = JSON.parse(r.body);
        const PREFERRED = [
          "c411",
          "ygg",
          "sharewood",
          "darki",
          "torrent9",
          "oxtorrent",
          "tiramiaou",
          "cpasbien",
        ];
        const fr = [];
        for (const ix of list) {
          const id = String(ix.id || "").toLowerCase();
          const name = String(ix.name || id);
          if (!(ix.configured ?? true)) continue;
          if (!PREFERRED.some((p) => id.includes(p) || name.toLowerCase().includes(p)))
            continue;
          fr.push({
            id,
            name,
            base: `https://ryan.joker.usbx.me/jackett/api/v2.0/indexers/${ix.id}/results/torznab`,
            apikey: key,
          });
          console.log("FR", id, name);
        }
        const cfgPath = path.join(__dirname, "..", "config.json");
        const j = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        if (fr.length) j.frTorznab = fr;
        else
          j.frTorznab = [
            {
              id: "jackett-all",
              name: "Jackett all (filtre FR côté Grab)",
              base: "https://ryan.joker.usbx.me/jackett/api/v2.0/indexers/all/results/torznab",
              apikey: key,
            },
          ];
        fs.writeFileSync(cfgPath, JSON.stringify(j, null, 2) + "\n");
        console.log("saved frTorznab", j.frTorznab.length);
      }
    } catch (e) {
      console.log("fail", u.replace(key, "***"), e.message);
    }
  }
})();
