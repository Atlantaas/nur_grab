/**
 * Attend fin DL Daryl (qBit) puis organize-tv-seasons + Jellyfin Refresh (sans DELETE fichiers).
 */
const { spawnSync } = require("child_process");
const path = require("path");
const cfg = require("../config.json");
const clients = require("../lib/clients");
const http = require("http");
const https = require("https");
const { URL } = require("url");

function request(urlStr, { method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks) }),
        );
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function isDaryl(t) {
  return /daryl\.dixon/i.test(t.name || "");
}

async function jellyfinRefreshLibrary() {
  const base = (cfg.jellyfinBase || "").replace(/\/$/, "");
  const key = cfg.jellyfinApiKey || cfg.jellyfinKey;
  if (!base || !key) {
    console.warn("skip jellyfin refresh: missing base/key");
    return;
  }
  // Library refresh only — NEVER DELETE /Items (that wiped files last time)
  const res = await request(
    `${base}/Library/Refresh?api_key=${encodeURIComponent(key)}`,
    { method: "POST", headers: { "X-Emby-Token": key } },
  );
  console.log("jellyfin Library/Refresh", res.status);
}

(async () => {
  const jar = new Map();
  await clients.qbitLogin(cfg, jar);
  let n = 0;
  for (;;) {
    n++;
    let list;
    try {
      list = await clients.qbitList(cfg, jar);
    } catch (e) {
      console.warn("list fail", e.message || e);
      await new Promise((r) => setTimeout(r, 15000));
      continue;
    }
    const daryl = list.filter(isDaryl);
    if (!daryl.length) throw new Error("no daryl torrents");
    const done = daryl.every(
      (t) => (t.progress || 0) >= 0.999 || t.state === "uploading" || t.state === "stalledUP" || t.state === "pausedUP" || t.state === "queuedUP",
    );
    const snap = daryl.map((t) => ({
      s: (t.name.match(/S0?(\d+)/i) || [])[1],
      p: Math.round((t.progress || 0) * 1000) / 10 + "%",
      st: t.state,
    }));
    console.log(new Date().toISOString(), "tick", n, snap);
    if (done) break;
    await new Promise((r) => setTimeout(r, 20000));
  }

  console.log("DL complete → organize-tv-seasons");
  const org = spawnSync(
    process.execPath,
    [path.join(__dirname, "organize-tv-seasons.js")],
    { cwd: path.join(__dirname, ".."), encoding: "utf8" },
  );
  console.log(org.stdout || "");
  if (org.stderr) console.error(org.stderr);
  if (org.status !== 0) process.exit(org.status || 1);

  await jellyfinRefreshLibrary();
  console.log("DONE — Series/Season layout + JF refresh (no DELETE)");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
