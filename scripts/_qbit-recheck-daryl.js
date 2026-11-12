/**
 * Fichiers Daryl effacés par Jellyfin DELETE — recheck qBit pour re-DL.
 * Puis (manuel) organize-tv-seasons.js quand progress=1.
 */
const cfg = require("../config.json");
const clients = require("../lib/clients");
const http = require("http");
const https = require("https");
const { URL } = require("url");

function request(urlStr, { method = "GET", headers = {}, body = null, jar } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === "https:" ? https : http;
    const cookie =
      jar && jar.size ? [...jar].map(([k, v]) => `${k}=${v}`).join("; ") : "";
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
      },
      (res) => {
        if (jar && res.headers["set-cookie"]) {
          for (const c of res.headers["set-cookie"]) {
            const [pair] = c.split(";");
            const eq = pair.indexOf("=");
            if (eq > 0)
              jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
          }
        }
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

(async () => {
  const jar = new Map();
  await clients.qbitLogin(cfg, jar);
  const list = await clients.qbitList(cfg, jar);
  const daryl = list.filter((t) => /daryl\.dixon/i.test(t.name || ""));
  if (!daryl.length) throw new Error("no daryl torrents in qbit");
  const hashes = daryl.map((t) => t.hash).join("|");
  console.log(
    "recheck",
    daryl.map((t) => t.name),
  );

  // Recheck → missing files → download again
  let res = await request(`${cfg.qbitBase}/api/v2/torrents/recheck`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `hashes=${encodeURIComponent(hashes)}`,
    jar,
  });
  console.log("recheck", res.status, res.body.toString("utf8").slice(0, 100));

  res = await request(`${cfg.qbitBase}/api/v2/torrents/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `hashes=${encodeURIComponent(hashes)}`,
    jar,
  });
  console.log("resume", res.status);

  await new Promise((r) => setTimeout(r, 3000));
  const list2 = await clients.qbitList(cfg, jar);
  for (const t of list2.filter((x) => /daryl\.dixon/i.test(x.name || ""))) {
    console.log({
      name: t.name,
      state: t.state,
      progress: Math.round((t.progress || 0) * 1000) / 10 + "%",
      amount_left: t.amount_left,
    });
  }
  console.log(
    "OK — laisse qBit re-télécharger, puis: node scripts/organize-tv-seasons.js",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
