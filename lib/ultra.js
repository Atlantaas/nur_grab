/**
 * Ultra.cc helpers — qBittorrent + Prowlarr.
 * HARD RULE: never delete media files / torrents content.
 */
const http = require("http");
const https = require("https");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");

function request(urlStr, { method = "GET", headers = {}, body = null, jar } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === "https:" ? https : http;
    const cookie = jar && jar.size ? [...jar].map(([k, v]) => `${k}=${v}`).join("; ") : "";
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: {
          ...headers,
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (res) => {
        if (jar && res.headers["set-cookie"]) {
          for (const c of res.headers["set-cookie"]) {
            const [pair] = c.split(";");
            const eq = pair.indexOf("=");
            if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
          }
        }
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({ status: res.statusCode, headers: res.headers, body: buf });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function loadConfig(configPath) {
  const p = configPath || path.join(__dirname, "..", "config.json");
  if (!fs.existsSync(p)) {
    throw new Error("config.json manquant — copie config.example.json");
  }
  const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
  if (cfg.neverDeleteMedia !== true) {
    cfg.neverDeleteMedia = true; // force
  }
  return cfg;
}

async function qbitLogin(cfg, jar) {
  const body = new URLSearchParams({
    username: cfg.qbitUser,
    password: cfg.qbitPass,
  }).toString();
  const res = await request(`${cfg.qbitBase}/api/v2/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    jar,
  });
  const text = res.body.toString("utf8");
  if (res.status !== 200 || !/ok/i.test(text)) {
    throw new Error(`qBit login failed: ${res.status} ${text}`);
  }
  return true;
}

async function qbitAddMagnet(cfg, jar, { magnet, savePath, category, tags }) {
  if (cfg.neverDeleteMedia !== true) {
    throw new Error("BLOCKED: neverDeleteMedia must be true");
  }
  const params = new URLSearchParams();
  params.set("urls", magnet);
  if (savePath) params.set("savepath", savePath);
  if (category) params.set("category", category);
  if (tags) params.set("tags", tags);
  params.set("autoTMM", "false");
  const res = await request(`${cfg.qbitBase}/api/v2/torrents/add`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    jar,
  });
  const text = res.body.toString("utf8");
  if (res.status !== 200) throw new Error(`add magnet failed: ${res.status} ${text}`);
  return text;
}

async function qbitAddTorrentFile(cfg, jar, { filePath, savePath, category, tags }) {
  if (cfg.neverDeleteMedia !== true) {
    throw new Error("BLOCKED: neverDeleteMedia must be true");
  }
  const raw = fs.readFileSync(filePath);
  const name = path.basename(filePath);
  const boundary = "----NurGrab" + Date.now();
  const parts = [];
  const push = (s) => parts.push(Buffer.from(s));
  push(`--${boundary}\r\nContent-Disposition: form-data; name="torrents"; filename="${name}"\r\nContent-Type: application/x-bittorrent\r\n\r\n`);
  parts.push(raw);
  push("\r\n");
  if (savePath) {
    push(`--${boundary}\r\nContent-Disposition: form-data; name="savepath"\r\n\r\n${savePath}\r\n`);
  }
  if (category) {
    push(`--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\n${category}\r\n`);
  }
  if (tags) {
    push(`--${boundary}\r\nContent-Disposition: form-data; name="tags"\r\n\r\n${tags}\r\n`);
  }
  push(`--${boundary}\r\nContent-Disposition: form-data; name="autoTMM"\r\n\r\nfalse\r\n`);
  push(`--${boundary}--\r\n`);
  const body = Buffer.concat(parts);
  const res = await request(`${cfg.qbitBase}/api/v2/torrents/add`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": body.length,
    },
    body,
    jar,
  });
  const text = res.body.toString("utf8");
  if (res.status !== 200) throw new Error(`add torrent failed: ${res.status} ${text}`);
  return text;
}

async function qbitList(cfg, jar, filter = "") {
  const q = filter ? `?filter=${encodeURIComponent(filter)}` : "";
  const res = await request(`${cfg.qbitBase}/api/v2/torrents/info${q}`, { jar });
  if (res.status !== 200) throw new Error(`list failed: ${res.status}`);
  return JSON.parse(res.body.toString("utf8"));
}

/** Refuse any delete API — hard guard. */
function qbitDeleteBlocked() {
  throw new Error(
    "REFUSÉ: Nur Grab ne supprime jamais de torrents/fichiers media. Fais-le toi à la main si besoin."
  );
}

async function prowlarrSearch(cfg, query, { type = "search", limit = 40 } = {}) {
  const u = new URL(`${cfg.prowlarrBase}/api/v1/search`);
  u.searchParams.set("query", query);
  u.searchParams.set("type", type);
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("apikey", cfg.prowlarrApiKey);
  const res = await request(u.toString());
  if (res.status !== 200) {
    throw new Error(`Prowlarr ${res.status}: ${res.body.toString("utf8").slice(0, 200)}`);
  }
  return JSON.parse(res.body.toString("utf8"));
}

function scoreRelease(r) {
  const title = `${r.title || ""} ${r.fileName || ""}`.toLowerCase();
  let score = 0;

  // trash sources
  if (/\b(cam|hdcam|ts|telesync|tc|telecine|scr|screener|r5|dvdscr)\b/.test(title)) {
    return -10000;
  }

  // resolution
  if (/\b(2160p|4k|uhd)\b/.test(title)) score += 4000;
  else if (/\b1080p\b/.test(title)) score += 3000;
  else if (/\b720p\b/.test(title)) score += 2000;
  else if (/\b480p\b/.test(title)) score += 500;

  // source quality
  if (/\b(remux)\b/.test(title)) score += 1500;
  else if (/\b(bluray|blu-ray|bdrip|brrip)\b/.test(title)) score += 1200;
  else if (/\b(web-?dl|webdl)\b/.test(title)) score += 1000;
  else if (/\b(webrip|web-?rip)\b/.test(title)) score += 800;
  else if (/\b(hdtv)\b/.test(title)) score += 400;

  // codec preference (hevc ok if good source)
  if (/\b(remux|atmos|truehd|dts-?hd)\b/.test(title)) score += 200;
  if (/\b(x265|hevc|h\.?265)\b/.test(title)) score += 50;
  if (/\b(x264|h\.?264|avc)\b/.test(title)) score += 40;

  // french audio bonus for Ryan
  if (/\b(vff|truefrench|multi|vfq|french)\b/.test(title)) score += 300;

  // seeders
  const seeds = Number(r.seeders || 0);
  score += Math.min(seeds, 200);

  // size soft preference (avoid tiny fakes)
  const size = Number(r.size || 0);
  if (size > 0 && size < 200 * 1024 * 1024) score -= 500; // <200MB suspicious for movie
  if (size > 40 * 1024 * 1024 * 1024) score -= 100; // huge remux still ok but slight

  return score;
}

function pickBest(results, { kind = "movie" } = {}) {
  const scored = (results || [])
    .map((r) => ({ ...r, _score: scoreRelease(r) }))
    .filter((r) => r._score > -5000)
    .sort((a, b) => b._score - a._score);
  return scored;
}

function magnetFromResult(r) {
  if (r.guid && String(r.guid).startsWith("magnet:")) return r.guid;
  if (r.downloadUrl && String(r.downloadUrl).startsWith("magnet:")) return r.downloadUrl;
  if (r.magnetUrl) return r.magnetUrl;
  // some indexers put magnet in other fields
  for (const k of ["guid", "downloadUrl", "link", "magnetUrl"]) {
    const v = r[k];
    if (typeof v === "string" && v.startsWith("magnet:")) return v;
  }
  return null;
}

module.exports = {
  loadConfig,
  request,
  qbitLogin,
  qbitAddMagnet,
  qbitAddTorrentFile,
  qbitList,
  qbitDeleteBlocked,
  prowlarrSearch,
  scoreRelease,
  pickBest,
  magnetFromResult,
};
