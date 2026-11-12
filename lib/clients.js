/**
 * Ultra download clients:
 * - Films / jeux / séries → qBittorrent (savePath par kind)
 * - Transmission = fallback seulement (souvent 502 sur Ultra)
 * HARD RULE: never delete media / torrents content.
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
    const cookie =
      jar && jar.size ? [...jar].map(([k, v]) => `${k}=${v}`).join("; ") : "";
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
  return cfg;
}

function assertNoDelete(cfg) {
  if (cfg.neverDeleteMedia !== true) {
    throw new Error("BLOCKED: neverDeleteMedia must be true");
  }
}

function deleteBlocked() {
  throw new Error(
    "REFUSÉ: Nur Grab ne supprime JAMAIS de torrents/fichiers media."
  );
}

/* ---------- qBittorrent (SERIES) ---------- */

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
  assertNoDelete(cfg);
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
  if (res.status !== 200) {
    throw new Error(`qBit add magnet: ${res.status} ${res.body.toString("utf8")}`);
  }
  return res.body.toString("utf8");
}

async function qbitAddTorrentBuffer(cfg, jar, { buffer, fileName, savePath, category, tags }) {
  assertNoDelete(cfg);
  const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const name = fileName || `nur-grab-${Date.now()}.torrent`;
  const boundary = "----NurGrab" + Date.now();
  const parts = [];
  const push = (s) => parts.push(Buffer.from(s));
  push(
    `--${boundary}\r\nContent-Disposition: form-data; name="torrents"; filename="${name}"\r\nContent-Type: application/x-bittorrent\r\n\r\n`
  );
  parts.push(raw);
  push("\r\n");
  if (savePath) {
    push(
      `--${boundary}\r\nContent-Disposition: form-data; name="savepath"\r\n\r\n${savePath}\r\n`
    );
  }
  if (category) {
    push(
      `--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\n${category}\r\n`
    );
  }
  if (tags) {
    push(
      `--${boundary}\r\nContent-Disposition: form-data; name="tags"\r\n\r\n${tags}\r\n`
    );
  }
  push(
    `--${boundary}\r\nContent-Disposition: form-data; name="autoTMM"\r\n\r\nfalse\r\n`
  );
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
  if (res.status !== 200) {
    throw new Error(`qBit add torrent buf: ${res.status} ${res.body.toString("utf8")}`);
  }
  return res.body.toString("utf8");
}

async function qbitAddTorrentFile(cfg, jar, { filePath, savePath, category, tags }) {
  assertNoDelete(cfg);
  const raw = fs.readFileSync(filePath);
  const name = path.basename(filePath);
  const boundary = "----NurGrab" + Date.now();
  const parts = [];
  const push = (s) => parts.push(Buffer.from(s));
  push(
    `--${boundary}\r\nContent-Disposition: form-data; name="torrents"; filename="${name}"\r\nContent-Type: application/x-bittorrent\r\n\r\n`
  );
  parts.push(raw);
  push("\r\n");
  if (savePath) {
    push(
      `--${boundary}\r\nContent-Disposition: form-data; name="savepath"\r\n\r\n${savePath}\r\n`
    );
  }
  if (category) {
    push(
      `--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\n${category}\r\n`
    );
  }
  if (tags) {
    push(
      `--${boundary}\r\nContent-Disposition: form-data; name="tags"\r\n\r\n${tags}\r\n`
    );
  }
  push(
    `--${boundary}\r\nContent-Disposition: form-data; name="autoTMM"\r\n\r\nfalse\r\n`
  );
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
  if (res.status !== 200) {
    throw new Error(`qBit add torrent: ${res.status} ${res.body.toString("utf8")}`);
  }
  return res.body.toString("utf8");
}

async function qbitList(cfg, jar) {
  const res = await request(`${cfg.qbitBase}/api/v2/torrents/info`, { jar });
  if (res.status !== 200) throw new Error(`qBit list: ${res.status}`);
  return JSON.parse(res.body.toString("utf8"));
}

/* ---------- Transmission (MOVIES) ---------- */

class TransmissionClient {
  constructor(cfg) {
    this.cfg = cfg;
    this.sessionId = "";
    this.rpcUrl = cfg.transmissionRpc;
  }

  async call(method, arguments_ = {}) {
    const payload = JSON.stringify({ method, arguments: arguments_ });
    const auth =
      "Basic " +
      Buffer.from(
        `${this.cfg.transmissionUser}:${this.cfg.transmissionPass}`
      ).toString("base64");
    const headers = {
      "Content-Type": "application/json",
      Authorization: auth,
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
        throw new Error(
          `Transmission ${res.status}: ${res.body.toString("utf8").slice(0, 200)}`
        );
      }
      const data = JSON.parse(res.body.toString("utf8"));
      if (data.result !== "success") {
        throw new Error(`Transmission: ${data.result}`);
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
    assertNoDelete(this.cfg);
    return this.call("torrent-add", {
      filename: magnet,
      "download-dir": downloadDir,
      paused: false,
    });
  }

  async addTorrentFile({ filePath, downloadDir }) {
    assertNoDelete(this.cfg);
    const metainfo = fs.readFileSync(filePath).toString("base64");
    return this.call("torrent-add", {
      metainfo,
      "download-dir": downloadDir,
      paused: false,
    });
  }

  async addTorrentBuffer({ buffer, downloadDir }) {
    assertNoDelete(this.cfg);
    const metainfo = Buffer.isBuffer(buffer)
      ? buffer.toString("base64")
      : Buffer.from(buffer).toString("base64");
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
        "totalSize",
        "downloadDir",
        "errorString",
        "addedDate",
      ],
    });
    return a.torrents || [];
  }
}

const TX_STATUS = {
  0: "stopped",
  1: "checkWait",
  2: "checking",
  3: "downloadWait",
  4: "downloading",
  5: "seedWait",
  6: "seeding",
};

/* ---------- Prowlarr / scoring ---------- */

async function prowlarrSearch(
  cfg,
  query,
  { type = "search", limit = 50, imdbId = null, tmdbId = null } = {}
) {
  const u = new URL(`${cfg.prowlarrBase}/api/v1/search`);
  if (query) u.searchParams.set("query", query);
  u.searchParams.set("type", type);
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("apikey", cfg.prowlarrApiKey);
  if (imdbId) {
    const id = String(imdbId).replace(/^tt/i, "");
    u.searchParams.set("imdbId", id);
  }
  if (tmdbId) u.searchParams.set("tmdbId", String(tmdbId));
  const res = await request(u.toString());
  if (res.status !== 200) {
    throw new Error(`Prowlarr ${res.status}: ${res.body.toString("utf8").slice(0, 200)}`);
  }
  return JSON.parse(res.body.toString("utf8"));
}

/**
 * Ryan profile: French audio required, sweet-spot quality (4KLight / 1080p),
 * reject cams and mammoth remuxes.
 */
function scoreRelease(r) {
  const title = `${r.title || ""} ${r.fileName || ""}`.toLowerCase();
  const size = Number(r.size || 0);
  const GB = 1024 * 1024 * 1024;
  let score = 0;

  // Trash sources
  if (/\b(cam|hdcam|ts|telesync|tc|telecine|scr|screener|r5|dvdscr|hdts)\b/.test(title)) {
    return -10000;
  }

  // French audio — mandatory for Ryan
  const hasFr =
    /\b(vff|truefrench|true\.?french|vfq|vfi|vf2|vof|french|multi|mul?ti\.?(vff|vfq|truefrench)?)\b/.test(
      title
    );
  const vostOnly =
    /\b(vostfr|subfrench|english|vo(?![a-z]))\b/.test(title) &&
    !hasFr;
  if (vostOnly || !hasFr) {
    return -9000; // never auto-pick without FR
  }
  if (/\b(vff|truefrench|true\.?french)\b/.test(title)) score += 2500;
  else if (/\b(vfq|vfi|vf2)\b/.test(title)) score += 2200;
  else if (/\bmulti\b/.test(title)) score += 2000;
  else score += 1500; // other french tags

  // Sweet-spot encodes: 4KLight / Light / HDRLight beat fat remux
  const is4kLight = /\b(4k\s*light|4klight|uhd\s*light|2160p.*light|light.*2160p)\b/.test(
    title
  );
  const isLight = is4kLight || /\b(light|lite)\b/.test(title);
  const isRemux = /\bremux\b/.test(title);
  const is4k = /\b(2160p|4k|uhd)\b/.test(title);
  const is1080 = /\b1080p\b/.test(title);
  const is720 = /\b720p\b/.test(title);

  if (is4kLight) score += 5200; // king for Ryan
  else if (isLight && is4k) score += 4800;
  else if (is1080 && !isRemux) score += 4200;
  else if (is4k && !isRemux) score += 3600; // 4K encode ok
  else if (is720) score += 2200;
  else if (/\b480p\b/.test(title)) score += 400;
  else score += 800;

  // Source quality (encode > remux for size)
  if (isRemux && !isLight) score -= 1800; // fat remux = no
  else if (/\b(bluray|blu-ray|bdrip|brrip|bdremux)\b/.test(title) && !isRemux)
    score += 900;
  else if (/\b(web-?dl|webdl)\b/.test(title)) score += 1100;
  else if (/\b(webrip|web-?rip)\b/.test(title)) score += 850;
  else if (/\b(hdtv)\b/.test(title)) score += 300;

  if (/\b(x265|hevc|h\.?265)\b/.test(title)) score += 350;
  if (/\b(hdr10?\+?|dv|dovi|dolby\.?vision)\b/.test(title) && (is4kLight || isLight))
    score += 200;

  // Size sweet spot (movies / packs)
  if (size > 0) {
    const gb = size / GB;
    if (gb < 0.35) score -= 2000; // fake / sample
    else if (is4kLight || (is4k && isLight)) {
      // 4KLight ideal ~6–22 Go
      if (gb >= 6 && gb <= 22) score += 1800;
      else if (gb > 22 && gb <= 30) score += 600;
      else if (gb > 30) score -= 2500;
      else if (gb < 4) score -= 400;
    } else if (is1080) {
      // 1080p ideal ~1.5–12 Go
      if (gb >= 1.5 && gb <= 12) score += 1600;
      else if (gb > 12 && gb <= 18) score += 400;
      else if (gb > 25) score -= 2200;
    } else if (is4k && !isLight) {
      // full 4K without Light — punish giants
      if (gb > 35) score -= 3500;
      else if (gb > 25) score -= 1500;
      else if (gb >= 10 && gb <= 25) score += 200;
    }
    // Absolute ceiling: never want 50Go+ monsters
    if (gb > 45) score -= 5000;
  }

  score += Math.min(Number(r.seeders || 0), 120);
  // Popularité C411 (grabs ≈ “points” côté tracker)
  score += Math.min(Number(r.grabs || 0), 80);
  // Freeleech = jackpot ratio
  if (r.freeleech || Number(r.downloadVolumeFactor) === 0) score += 800;
  return score;
}

/** Libellé qualité court pour l’UI (Reco 4K Light, etc.). */
function qualityLabel(r) {
  const title = `${r.title || ""}`.toLowerCase();
  if (/\b(4k\s*light|4klight|uhd\s*light)\b/.test(title)) return "4K Light ★";
  if (/\b(2160p|4k|uhd)\b/.test(title) && /\b(light|lite|hdlight)\b/.test(title))
    return "4K Light";
  if (/\bremux\b/.test(title) && /\b(2160p|4k|uhd)\b/.test(title))
    return "4K Remux (lourd)";
  if (/\b(2160p|4k|uhd)\b/.test(title)) return "4K";
  if (/\b1080p\b/.test(title) && /\b(light|lite|hdlight)\b/.test(title))
    return "1080p Light";
  if (/\b1080p\b/.test(title) && !/\bremux\b/.test(title)) return "1080p";
  if (/\b1080p\b/.test(title)) return "1080p Remux";
  if (/\b720p\b/.test(title)) return "720p";
  if (/\b(integrale|intégrale|complete)\b/.test(title)) return "Pack / Intégrale";
  return "Encode";
}

function parseSeasonInfo(title) {
  const t = String(title || "").toLowerCase();
  const range =
    t.match(/\bs0?(\d{1,2})\s*[-.]?\s*s0?(\d{1,2})\b/i) ||
    t.match(/\bsaisons?\s*(\d{1,2})\s*[-àa&]\s*(\d{1,2})\b/i);
  const integrale =
    /\b(integrale|intégrale|complete|complet|pack\.?saisons?)\b/i.test(t) ||
    !!(range && Number(range[1]) === 1 && Number(range[2]) >= 2);
  const se = t.match(/\bs(\d{1,2})e(\d{1,3})\b/i);
  const sOnly =
    t.match(/\bs(\d{1,2})(?!\d|e)/i) ||
    t.match(/\bsaison\s*(\d{1,2})\b/i) ||
    t.match(/\bseason\s*(\d{1,2})\b/i);
  const season = se
    ? Number(se[1])
    : sOnly
      ? Number(sOnly[1])
      : null;
  const episode = se ? Number(se[2]) : null;
  // Pack saison = Sxx sans Exx, ou "Saison N complete", ou range
  const seasonPack =
    integrale ||
    !!(range && season == null) ||
    (season != null &&
      episode == null &&
      (/\b(saison|season|complete|complet|pack|integrale|intégrale)\b/i.test(t) ||
        /\bs\d{1,2}\b/i.test(t)));
  return {
    integrale,
    season,
    episode,
    seasonPack: seasonPack && episode == null,
    seasonFrom: range ? Number(range[1]) : null,
    seasonTo: range ? Number(range[2]) : null,
  };
}

function pickBest(results) {
  return (results || [])
    .map((r) => {
      const scored = { ...r, _score: scoreRelease(r) };
      scored.qualityLabel = qualityLabel(scored);
      scored.seasonInfo = parseSeasonInfo(scored.title);
      return scored;
    })
    .filter((r) => r._score > -5000)
    .sort((a, b) => b._score - a._score);
}

/**
 * Plan série : intégrale si dispo, sinon meilleure release par saison (packs d’abord),
 * toujours dans l’ordre S1 → S2 → S3…
 */
function planSeriesDownloads(
  results,
  { preferIntegrale = true, query = null } = {}
) {
  const scoped = filterByQuery(results, query).filter((r) =>
    hasFrenchAudio(r.title)
  );
  // Scorés même si hors sweet-spot (remux géant) — pour combler les trous
  const scoredAll = scoped.map((r) => {
    const info = parseSeasonInfo(r.title);
    return {
      ...r,
      _score: scoreRelease(r),
      qualityLabel: qualityLabel(r),
      seasonInfo: info,
    };
  });
  const ranked = scoredAll
    .filter((r) => r._score > -5000)
    .sort((a, b) => b._score - a._score);
  if (!scoredAll.length) {
    return { mode: "empty", picks: [], seasons: [], missing: [] };
  }

  if (preferIntegrale) {
    const integ = (ranked.length ? ranked : scoredAll)
      .filter(
        (r) =>
          r.seasonInfo?.integrale ||
          (r.seasonInfo?.seasonFrom === 1 &&
            (r.seasonInfo?.seasonTo || 0) >= 2)
      )
      .sort((a, b) => b._score - a._score);
    if (integ.length) {
      return {
        mode: "integrale",
        picks: [integ[0]],
        seasons: [],
        missing: [],
        reason: "Intégrale / pack complet — meilleure qualité·poids",
      };
    }
  }

  const bySeason = new Map();
  for (const r of scoredAll) {
    const info = r.seasonInfo || parseSeasonInfo(r.title);
    if (info.integrale) continue;
    const s = info.season;
    if (s == null || s < 1 || s > 40) continue;
    const isEp = info.episode != null && !info.seasonPack;
    if (!bySeason.has(s)) bySeason.set(s, []);
    bySeason.get(s).push({ ...r, seasonInfo: info, _isEp: isEp });
  }

  const seasons = [...bySeason.keys()].sort((a, b) => a - b);
  const picks = [];
  for (const s of seasons) {
    const list = bySeason.get(s);
    const packs = list.filter((x) => !x._isEp);
    let pool = packs.length ? packs : list;
    pool = [...pool].sort((a, b) => (b._score || 0) - (a._score || 0));
    let pick = pool.find((x) => (x._score || 0) > -5000) || null;
    // Fallback : seule release FR (ex. remux S05 Flash ~150 Go)
    if (!pick && pool.length) {
      pick = {
        ...pool[0],
        qualityLabel: (pool[0].qualityLabel || "Encode") + " (seul dispo)",
        _lenient: true,
      };
    }
    if (pick) picks.push(pick);
  }

  // Trous dans la séquence (ex: a 4,5 mais pas 1,2,3)
  const missing = [];
  if (seasons.length) {
    const maxS = seasons[seasons.length - 1];
    for (let s = 1; s <= maxS; s++) {
      if (!bySeason.has(s)) missing.push(s);
    }
  }

  if (picks.length) {
    const hole =
      missing.length > 0
        ? ` · manque S${missing.join(", S")} (recherche élargie…)`
        : "";
    return {
      mode: "seasons",
      picks,
      seasons,
      missing,
      reason: `Saisons ${seasons.join(", ")} — ordre S1→Sn · meilleure qualité/saison${hole}`,
    };
  }

  const fallback =
    ranked[0] ||
    [...scoredAll].sort((a, b) => b._score - a._score)[0] ||
    null;
  return {
    mode: "single",
    picks: fallback ? [fallback] : [],
    seasons: [],
    missing: [],
    reason: "Meilleure release FR (pas de découpage saison clair)",
  };
}

/**
 * Zone « titre show » d’une release — ignore le groupe (-CHiLL / -Flash)
 * et coupe avant les tags qualité (MULTI, 1080p…).
 * → Sanctuary.…-Flash ne matche plus la requête « flash ».
 */
function releaseTitleCore(raw) {
  let t = String(raw || "");
  // Groupe scene en suffixe (-GROUP / .GROUP)
  t = t.replace(/[-.][A-Za-z0-9]{2,}$/i, "");
  // Coupe dès le 1er tag technique / langue / qualité
  t = t.replace(
    /\b(MULTI|MULTi|VFF|VFQ|VFI|VF2|VOSTFR|TRUEFRENCH|FRENCH|VO|2160p|1080p|720p|480p|4K|UHD|HDR|BluRay|WEB[- ]?DL|WEBRip|WEB|HDTV|x265|x264|H\.?265|H\.?264|HEVC|REMUX|COMPLETE|INTEGRALE|iNTEGRALE|CUSTOM|REPACK|PROPER|HDLight|4KLight)\b.*/i,
    ""
  );
  return t
    .toLowerCase()
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Titre release ≈ requête (début du nom, pas le groupe scene). */
function matchesQuery(title, query) {
  const core = releaseTitleCore(title);
  const q = String(query || "")
    .toLowerCase()
    .trim()
    .replace(/[._]/g, " ");
  if (!q) return true;
  if (!core) return false;
  const tokens = q.split(/\s+/).filter((w) => w.length >= 2);
  if (!tokens.length) return true;

  const ok = tokens.every((tok) => {
    const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // frontière : flash ≠ flashback
    const re = new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`, "i");
    return re.test(core);
  });
  if (!ok) return false;

  // Mot court seul (« flash ») : en tête, suivi d’année / Sxx / fin —
  // refuse « Flash Gordon », accepte « Flash 2014 » / « The Flash ».
  if (tokens.length === 1 && tokens[0].length <= 8) {
    const tok = tokens[0];
    const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const reStrict = new RegExp(
      `^(?:the\\s+)?${esc}(?:\\s+(?:\\d{4}|s\\d{1,2}\\b|integrale|intégrale|complete|complet)\\b|\\s*$)`,
      "i"
    );
    if (!reStrict.test(core)) return false;
  }
  return true;
}

function filterByQuery(results, query) {
  const q = String(query || "").trim();
  if (!q) return results || [];
  // Jamais de fallback « tout » — sinon Sanctuary -Flash pollue Flash
  return (results || []).filter((r) => matchesQuery(r.title, q));
}

function hasFrenchAudio(title) {
  const t = String(title || "").toLowerCase();
  if (/\b(cam|hdcam|ts|telesync|tc|telecine|scr|screener)\b/.test(t)) {
    return false;
  }
  return /\b(vff|truefrench|true\.?french|vfq|vfi|vf2|vof|french|multi)\b/.test(
    t
  );
}

/** Quelles saisons ont déjà un pack FR (pas juste un épisode). */
function seasonsCoverage(results) {
  const pack = new Set();
  const any = new Set();
  let maxS = 0;
  for (const r of results || []) {
    if (!hasFrenchAudio(r.title)) continue;
    const info = r.seasonInfo || parseSeasonInfo(r.title);
    if (info.integrale && info.seasonTo) {
      for (let s = info.seasonFrom || 1; s <= info.seasonTo; s++) {
        pack.add(s);
        any.add(s);
        maxS = Math.max(maxS, s);
      }
      continue;
    }
    const s = info.season;
    if (s == null || s < 1 || s > 40) continue;
    any.add(s);
    maxS = Math.max(maxS, s);
    if (info.episode == null || info.seasonPack) pack.add(s);
  }
  return { pack, any, maxS };
}

function magnetFromResult(r) {
  for (const k of ["guid", "downloadUrl", "magnetUrl", "link"]) {
    const v = r[k];
    if (typeof v === "string" && v.startsWith("magnet:")) return v;
  }
  return null;
}

/** Route helper */
function savePathFor(cfg, kind) {
  if (kind === "tv") return cfg.savePathTv;
  if (kind === "game") {
    return cfg.savePathGames || cfg.savePathMovies;
  }
  return cfg.savePathMovies;
}

function clientLabel(kind) {
  if (kind === "tv") return "qBittorrent (séries)";
  if (kind === "game") return "qBittorrent (jeux)";
  return "qBittorrent (films)";
}

module.exports = {
  loadConfig,
  deleteBlocked,
  qbitLogin,
  qbitAddMagnet,
  qbitAddTorrentFile,
  qbitAddTorrentBuffer,
  qbitList,
  TransmissionClient,
  TX_STATUS,
  prowlarrSearch,
  scoreRelease,
  qualityLabel,
  parseSeasonInfo,
  pickBest,
  planSeriesDownloads,
  seasonsCoverage,
  matchesQuery,
  filterByQuery,
  hasFrenchAudio,
  magnetFromResult,
  savePathFor,
  clientLabel,
};
