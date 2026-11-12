/** Liste indexers Jackett FR + remplit config.frTorznab */
const { Client } = require("ssh2");
const fs = require("fs");
const path = require("path");
const https = require("https");
const cfg = require("../config.json");

const PREFERRED = [
  "c411",
  "ygg",
  "yggtorrent",
  "yggcookie",
  "sharewood",
  "darkiworld",
  "torrent9",
  "oxtorrent",
  "tiramiaou",
  "cpasbien",
  "mesfilms",
];

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }),
        );
      })
      .on("error", reject);
  });
}

(async () => {
  const base = String(cfg.jackettBase || "").replace(/\/$/, "");
  const key = cfg.jackettApiKey;
  const url = `${base}/api/v2.0/indexers?apikey=${encodeURIComponent(key)}`;
  let indexers = [];
  try {
    const res = await get(url);
    console.log("jackett status", res.status, "len", res.body.length);
    if (res.status === 200) {
      indexers = JSON.parse(res.body);
    } else {
      console.log(res.body.slice(0, 300));
    }
  } catch (e) {
    console.error("jackett list fail", e.message);
  }

  const fr = [];
  for (const ix of indexers) {
    const id = String(ix.id || ix.ID || "").toLowerCase();
    const name = String(ix.name || ix.Name || id);
    const configured = ix.configured ?? ix.Configured ?? true;
    if (!configured) continue;
    const hit = PREFERRED.some((p) => id.includes(p) || name.toLowerCase().includes(p));
    if (!hit) continue;
    fr.push({
      id,
      name,
      base: `${base}/api/v2.0/indexers/${ix.id || ix.ID}/results/torznab`,
      apikey: key,
    });
    console.log("FR", id, name);
  }

  // Always add Jackett « all » as fallback entry for merge path
  if (!fr.length && key && key !== "CHANGE_ME") {
    fr.push({
      id: "jackett-all",
      name: "Jackett FR filter",
      base: `${base}/api/v2.0/indexers/all/results/torznab`,
      apikey: key,
    });
    console.log("fallback jackett-all");
  }

  const cfgPath = path.join(__dirname, "..", "config.json");
  const j = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  j.frTorznab = fr;
  j.jackettApiKey = key;
  fs.writeFileSync(cfgPath, JSON.stringify(j, null, 2) + "\n");
  console.log("frTorznab count", fr.length);
  console.log("NOTE: frTorznab n'est PAS dans le repo GitHub Jackett — c'est une liste Torznab dans config.json Nur Grab.");
})();
