/**
 * Transmission RPC for Ultra.cc
 * HARD RULE: never delete torrents or media files.
 */
const http = require("http");
const https = require("https");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");

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
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
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
  if (!fs.existsSync(p)) throw new Error("config.json manquant");
  const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
  cfg.neverDeleteMedia = true;
  cfg.client = "transmission";
  return cfg;
}

function basicAuth(user, pass) {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

class TransmissionClient {
  constructor(cfg) {
    this.cfg = cfg;
    this.sessionId = "";
    this.rpcUrl = cfg.transmissionRpc || `${cfg.transmissionBase}/rpc`;
  }

  async call(method, arguments_ = {}) {
    const payload = JSON.stringify({ method, arguments: arguments_ });
    const headers = {
      "Content-Type": "application/json",
      Authorization: basicAuth(
        this.cfg.transmissionUser || this.cfg.qbitUser || "ryan",
        this.cfg.transmissionPass || this.cfg.qbitPass
      ),
      "Content-Length": Buffer.byteLength(payload),
    };
    if (this.sessionId) headers["X-Transmission-Session-Id"] = this.sessionId;

    for (let i = 0; i < 3; i++) {
      const res = await request(this.rpcUrl, {
        method: "POST",
        headers,
        body: payload,
      });
      if (res.status === 409) {
        this.sessionId =
          res.headers["x-transmission-session-id"] ||
          res.headers["X-Transmission-Session-Id"];
        headers["X-Transmission-Session-Id"] = this.sessionId;
        continue;
      }
      if (res.status !== 200) {
        throw new Error(`Transmission ${res.status}: ${res.body.toString("utf8").slice(0, 200)}`);
      }
      const data = JSON.parse(res.body.toString("utf8"));
      if (data.result !== "success") {
        throw new Error(`Transmission error: ${data.result}`);
      }
      return data.arguments || {};
    }
    throw new Error("Transmission session failed");
  }

  async ping() {
    const a = await this.call("session-get");
    return { version: a.version, downloadDir: a["download-dir"] };
  }

  async addMagnet({ magnet, downloadDir }) {
    if (this.cfg.neverDeleteMedia !== true) {
      throw new Error("BLOCKED: neverDeleteMedia");
    }
    return this.call("torrent-add", {
      filename: magnet,
      "download-dir": downloadDir,
      paused: false,
    });
  }

  async addTorrentFile({ filePath, downloadDir }) {
    if (this.cfg.neverDeleteMedia !== true) {
      throw new Error("BLOCKED: neverDeleteMedia");
    }
    const metainfo = fs.readFileSync(filePath).toString("base64");
    return this.call("torrent-add", {
      metainfo,
      "download-dir": downloadDir,
      paused: false,
    });
  }

  async list() {
    const a = await this.call("torrent-get", {
      fields: [
        "id",
        "name",
        "status",
        "percentDone",
        "rateDownload",
        "rateUpload",
        "totalSize",
        "downloadDir",
        "errorString",
        "addedDate",
        "peersConnected",
      ],
    });
    return a.torrents || [];
  }

  deleteBlocked() {
    throw new Error(
      "REFUSÉ: Nur Grab ne supprime JAMAIS de torrents/fichiers. (Transmission delete bloqué)"
    );
  }
}

/* ---- Prowlarr / scoring (shared) ---- */

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
  if (/\b(cam|hdcam|ts|telesync|tc|telecine|scr|screener|r5|dvdscr)\b/.test(title)) {
    return -10000;
  }
  if (/\b(2160p|4k|uhd)\b/.test(title)) score += 4000;
  else if (/\b1080p\b/.test(title)) score += 3000;
  else if (/\b720p\b/.test(title)) score += 2000;
  else if (/\b480p\b/.test(title)) score += 500;

  if (/\b(remux)\b/.test(title)) score += 1500;
  else if (/\b(bluray|blu-ray|bdrip|brrip)\b/.test(title)) score += 1200;
  else if (/\b(web-?dl|webdl)\b/.test(title)) score += 1000;
  else if (/\b(webrip|web-?rip)\b/.test(title)) score += 800;
  else if (/\b(hdtv)\b/.test(title)) score += 400;

  if (/\b(remux|atmos|truehd|dts-?hd)\b/.test(title)) score += 200;
  if (/\b(vff|truefrench|multi|vfq|french)\b/.test(title)) score += 300;

  const seeds = Number(r.seeders || 0);
  score += Math.min(seeds, 200);
  const size = Number(r.size || 0);
  if (size > 0 && size < 200 * 1024 * 1024) score -= 500;
  return score;
}

function pickBest(results) {
  return (results || [])
    .map((r) => ({ ...r, _score: scoreRelease(r) }))
    .filter((r) => r._score > -5000)
    .sort((a, b) => b._score - a._score);
}

function magnetFromResult(r) {
  for (const k of ["guid", "downloadUrl", "magnetUrl", "link"]) {
    const v = r[k];
    if (typeof v === "string" && v.startsWith("magnet:")) return v;
  }
  return null;
}

const STATUS = {
  0: "stopped",
  1: "checkWait",
  2: "checking",
  3: "downloadWait",
  4: "downloading",
  5: "seedWait",
  6: "seeding",
};

module.exports = {
  loadConfig,
  TransmissionClient,
  prowlarrSearch,
  scoreRelease,
  pickBest,
  magnetFromResult,
  STATUS,
};
