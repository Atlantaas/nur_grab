/**
 * C411 (c411.org / c411.com) — Torznab API.
 * Paste torrent page URL → download .torrent, or search → best quality.
 */
const http = require("http");
const https = require("https");
const { URL } = require("url");

const DEFAULT_BASE = "https://c411.org";
const INFOHASH_RE = /([0-9a-fA-F]{40})/;

function requestRaw(urlStr, { method = "GET", headers = {}, body = null } = {}) {
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
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
          Accept: "*/*",
          ...headers,
        },
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          const next = new URL(res.headers.location, urlStr).toString();
          res.resume();
          return resolve(requestRaw(next, { method, headers, body }));
        }
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
            url: urlStr,
          });
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(25000, () => req.destroy(new Error("Timeout C411")));
    if (body) req.write(body);
    req.end();
  });
}

function isC411Host(hostname) {
  const h = String(hostname || "")
    .replace(/^www\./, "")
    .toLowerCase();
  return (
    h === "c411.com" ||
    h === "c411.org" ||
    h === "c411.my" ||
    h === "c411.run" ||
    h.endsWith(".c411.org") ||
    h.endsWith(".c411.com")
  );
}

function parseC411Url(urlStr) {
  let u;
  try {
    u = new URL(String(urlStr || "").trim());
  } catch {
    return null;
  }
  if (!isC411Host(u.hostname)) return null;

  const path = u.pathname || "";
  const hash =
    (path.match(INFOHASH_RE) || [])[1] ||
    (u.searchParams.get("id") || "").match(INFOHASH_RE)?.[1] ||
    null;

  // /torrents/<hash> or /torrent/<id>
  const torrentPath = path.match(/\/torrents?\/([^/?#]+)/i);
  let torrentId = hash;
  if (!torrentId && torrentPath) {
    const slug = decodeURIComponent(torrentPath[1]);
    torrentId = (slug.match(INFOHASH_RE) || [])[1] || slug;
  }

  const q =
    u.searchParams.get("q") ||
    u.searchParams.get("search") ||
    u.searchParams.get("query") ||
    null;

  return {
    site: "c411",
    host: u.hostname.replace(/^www\./, ""),
    url: u.toString(),
    torrentId,
    query: q ? String(q).trim() : null,
    path,
  };
}

function apiBase(cfg) {
  return String(cfg.c411Base || DEFAULT_BASE).replace(/\/$/, "");
}

function requireKey(cfg) {
  const key = String(cfg.c411ApiKey || "").trim();
  if (!key || key === "CHANGE_ME") {
    throw new Error(
      "Clé API C411 manquante — sur c411.org → Intégrations / API, copie la clé dans config.json (c411ApiKey)"
    );
  }
  return key;
}

function attr(chunk, name) {
  const re1 = new RegExp(
    `name=["']${name}["'][^>]*value=["']([^"']*)["']`,
    "i"
  );
  const re2 = new RegExp(
    `value=["']([^"']*)["'][^>]*name=["']${name}["']`,
    "i"
  );
  return (chunk.match(re1) || chunk.match(re2) || [])[1] || null;
}

function parseTorznabXml(xml) {
  const items = [];
  const blocks = String(xml).split(/<item>/i).slice(1);
  for (const block of blocks) {
    const chunk = block.split(/<\/item>/i)[0] || "";
    const title = (chunk.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1];
    const size =
      (chunk.match(/<size>(\d+)/i) || [])[1] || attr(chunk, "size");
    const enclosure =
      (chunk.match(/<enclosure[^>]+url=["']([^"']+)["']/i) || [])[1] ||
      (chunk.match(/url=["']([^"']+\.torrent[^"']*)["']/i) || [])[1];
    const link = (chunk.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i) || [])[1];
    const seeders = attr(chunk, "seeders");
    const peers = attr(chunk, "peers");
    const grabs = attr(chunk, "grabs");
    const infohash = attr(chunk, "infohash");
    const category = attr(chunk, "category");
    const imdbRaw = attr(chunk, "imdbid") || attr(chunk, "imdb");
    const tmdbRaw = attr(chunk, "tmdbid") || attr(chunk, "tmdb");
    const dlFactor = attr(chunk, "downloadvolumefactor");
    const upFactor = attr(chunk, "uploadvolumefactor");
    const freeleechAttr = attr(chunk, "freeleech");
    if (!title) continue;
    const imdbId = imdbRaw
      ? String(imdbRaw).startsWith("tt")
        ? String(imdbRaw)
        : `tt${String(imdbRaw).replace(/\D/g, "")}`
      : null;
    const tmdbId = tmdbRaw ? Number(String(tmdbRaw).replace(/\D/g, "")) || null : null;
    const downloadVolumeFactor =
      dlFactor != null && dlFactor !== "" ? Number(dlFactor) : 1;
    const freeleech =
      freeleechAttr === "1" ||
      freeleechAttr === "true" ||
      downloadVolumeFactor === 0;
    items.push({
      title: decodeXml(title.trim()),
      size: Number(size || 0),
      seeders: Number(seeders || 0),
      peers: Number(peers || 0),
      grabs: Number(grabs || 0),
      downloadUrl: enclosure ? decodeXml(enclosure.trim()) : null,
      guid: link ? decodeXml(link.trim()) : null,
      infoHash: infohash ? infohash.toLowerCase() : null,
      indexer: "C411",
      categories: category ? [Number(category)] : [],
      imdbId,
      tmdbId,
      freeleech,
      downloadVolumeFactor,
      uploadVolumeFactor:
        upFactor != null && upFactor !== "" ? Number(upFactor) : 1,
    });
  }
  return items;
}

function decodeXml(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** Broaden "spiderman" → spider-man / spider man / etc. */
function expandQuery(query) {
  const q = String(query || "").trim();
  if (!q) return [];
  const out = new Set();
  const add = (s) => {
    const t = String(s || "").trim().replace(/\s+/g, " ");
    if (t.length >= 2) out.add(t);
  };
  add(q);
  add(q.replace(/[-_./]+/g, " "));
  add(q.replace(/\s+/g, "-"));
  add(q.replace(/[-_\s]+/g, ""));

  const spaced = q.replace(/[-_./]+/g, " ").toLowerCase();
  add(spaced);
  add(spaced.replace(/\s+/g, "-"));
  add(spaced.replace(/\s+/g, ""));

  // Glue words: spiderman → spider man / spider-man
  const glued = spaced.replace(/\s+/g, "");
  const hero = glued.match(
    /^(spider|bat|iron|ant|super|aqua|wonder|cat|hawk|sand|doctor|captain)(man|woman|girl|boy|america|strange|eye)?(.*)$/i
  );
  if (hero) {
    const head = [hero[1], hero[2]].filter(Boolean).join(" ");
    const tail = (hero[3] || "").replace(/^[\s\-]+/, "");
    const full = (head + (tail ? " " + tail : "")).trim();
    add(full);
    add(full.replace(/\s+/g, "-"));
    add(hero[1] + "-" + (hero[2] || "") + (tail ? "-" + tail : ""));
  }

  // Title Case
  const title = (s) =>
    s
      .split(/([\s-])/)
      .map((w) =>
        /^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w
      )
      .join("");
  for (const v of [...out]) add(title(v.toLowerCase()));

  return [...out];
}

/** Anti-429 : gap min entre appels + cooldown global après 429. */
let _c411LastAt = 0;
let _c411CooldownUntil = 0;
const C411_MIN_GAP_MS = 2200;
const C411_COOLDOWN_MS = 40000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function torznabSearch(cfg, { t, q, cat, limit, offset = 0 }) {
  const now = Date.now();
  if (now < _c411CooldownUntil) {
    const waitSec = Math.ceil((_c411CooldownUntil - now) / 1000);
    const err = new Error(
      `C411 rate-limit — attends encore ~${waitSec} s (cooldown).`,
    );
    err.code = "RATE_LIMIT";
    err.status = 429;
    throw err;
  }
  const gap = C411_MIN_GAP_MS - (now - _c411LastAt);
  if (gap > 0) await sleep(gap);
  _c411LastAt = Date.now();

  const key = requireKey(cfg);
  const base = apiBase(cfg);
  const u = new URL(`${base}/api/torznab`);
  u.searchParams.set("apikey", key);
  u.searchParams.set("t", t);
  if (q) u.searchParams.set("q", q);
  if (cat) u.searchParams.set("cat", cat);
  u.searchParams.set("limit", String(limit));
  if (offset) u.searchParams.set("offset", String(offset));
  const res = await requestRaw(u.toString());
  if (res.status === 401) throw new Error("C411 API key invalide (401)");
  if (res.status === 429) {
    _c411CooldownUntil = Date.now() + C411_COOLDOWN_MS;
    const err = new Error(
      "C411 trop de requêtes (429) — cooldown 35 s. Réessaie, ou configure YGG dans Jackett.",
    );
    err.code = "RATE_LIMIT";
    err.status = 429;
    throw err;
  }
  if (res.status >= 400) {
    const snippet = res.body
      .toString("utf8")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    throw new Error(
      `C411 search ${res.status}${snippet ? ` · ${snippet}` : ""}`,
    );
  }
  return parseTorznabXml(res.body.toString("utf8"));
}

const BROWSE_SECTIONS = {
  "movies-new": {
    label: "Films · nouveautés",
    kind: "movie",
    cat: "2030",
  },
  "movies-all": {
    label: "Films · tout",
    kind: "movie",
    cat: "2000,2010,2030,2060,2070,2080",
  },
  "tv-new": {
    label: "Séries · nouveautés",
    kind: "tv",
    cat: "5000",
  },
  "tv-all": {
    label: "Séries · tout",
    kind: "tv",
    cat: "5000,5070,5080,5060",
  },
  anime: {
    label: "Animé",
    kind: "movie",
    cat: "2060,5070",
  },
  docs: {
    label: "Docs / émissions",
    kind: "movie",
    cat: "2070,5080",
  },
  sport: {
    label: "Sport",
    kind: "tv",
    cat: "5060",
  },
  "games-pc": {
    label: "Jeux · PC",
    kind: "game",
    cat: "4050,4000",
  },
  "games-console": {
    label: "Jeux · Console",
    kind: "game",
    cat: "1000,1040,1030,1080,1090",
  },
  "games-all": {
    label: "Jeux · tout",
    kind: "game",
    cat: "4050,4000,1000,1040,1030,1080,1090",
  },
};

function listBrowseSections() {
  return Object.entries(BROWSE_SECTIONS).map(([id, s]) => ({
    id,
    label: s.label,
    kind: s.kind,
  }));
}

/** Dernières sorties C411 (q vide + catégorie). */
async function browse(cfg, { section = "movies-new", limit = 50 } = {}) {
  const sec = BROWSE_SECTIONS[section] || BROWSE_SECTIONS["movies-new"];
  const items = await torznabSearch(cfg, {
    t: "search",
    q: "",
    cat: sec.cat,
    limit: Math.min(Number(limit) || 50, 100),
  });
  // drop site banner junk
  return {
    section,
    label: sec.label,
    kind: sec.kind,
    items: (items || []).filter(
      (it) => it.title && !/^torrent\s*c411$/i.test(it.title)
    ),
  };
}

async function tvSearchSeason(
  cfg,
  query,
  season,
  { ep = null, limit = 80, year = null } = {}
) {
  const key = requireKey(cfg);
  const base = apiBase(cfg);
  const cat = "5000,5070,5080,5060";
  const q = String(query || "").trim();
  const sNum = Number(season);
  if (!q || !Number.isFinite(sNum) || sNum < 1) return [];

  const pad = String(sNum).padStart(2, "0");
  const yearBit = year ? ` ${year}` : "";

  const seen = new Set();
  const out = [];
  const pushAll = (items) => {
    for (const it of items || []) {
      const k = (it.infoHash || it.downloadUrl || it.title || "").toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(it);
    }
  };

  // 3 req max / saison — tvsearch + "Title S0N" + "Title YEAR S0N"
  const jobs = [
    (async () => {
      const u = new URL(`${base}/api/torznab`);
      u.searchParams.set("apikey", key);
      u.searchParams.set("t", "tvsearch");
      u.searchParams.set("q", q);
      u.searchParams.set("season", String(sNum));
      if (ep != null && ep !== "") u.searchParams.set("ep", String(ep));
      u.searchParams.set("cat", cat);
      u.searchParams.set("limit", String(limit));
      const res = await requestRaw(u.toString());
      if (res.status >= 400) return [];
      return parseTorznabXml(res.body.toString("utf8"));
    })(),
    torznabSearch(cfg, {
      t: "search",
      q: `${q} S${pad}`,
      cat,
      limit,
    }),
  ];
  if (yearBit) {
    jobs.push(
      torznabSearch(cfg, {
        t: "search",
        q: `${q}${yearBit} S${pad}`,
        cat,
        limit,
      })
    );
  } else if (q.split(/\s+/).length === 1) {
    // "flash" → aussi "the flash S05"
    jobs.push(
      torznabSearch(cfg, {
        t: "search",
        q: `the ${q} S${pad}`,
        cat,
        limit,
      })
    );
  }

  const settled = await Promise.allSettled(jobs);
  for (const s of settled) {
    if (s.status === "fulfilled") pushAll(s.value);
  }
  return out;
}

async function search(
  cfg,
  query,
  { kind = "movie", limit = 100, season = null, ep = null } = {}
) {
  const variants = expandQuery(query);
  const cat =
    kind === "tv"
      ? "5000,5070,5080,5060"
      : kind === "game"
        ? "4050,4000,1000,1040,1030,1080,1090"
        : "2000,2010,2030,2060,2070,2080";
  // Jeux : pas de t=movie/tvsearch — search générique + cats PC/Console
  const typed = kind === "tv" ? "tvsearch" : kind === "game" ? null : "movie";
  const seen = new Set();
  const merged = [];

  const pushAll = (items) => {
    for (const it of items || []) {
      const key = (it.infoHash || it.downloadUrl || it.title || "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(it);
    }
  };

  const plan = [];
  const primary = variants[0];
  const alts = variants
    .filter((v) => v.toLowerCase() !== primary.toLowerCase())
    .slice(0, 3);
  plan.push({ t: "search", q: primary, cat, limit: 100 });
  if (typed) plan.push({ t: typed, q: primary, cat, limit: 100 });
  plan.push({ t: "search", q: primary, cat, limit: 100, offset: 100 });
  // Saison ciblée (Torznab tv-search)
  if (kind === "tv" && season != null && season !== "") {
    plan.push({
      __fn: () => tvSearchSeason(cfg, primary, season, { ep, limit: 100 }),
    });
  }
  for (const v of alts) {
    plan.push({ t: "search", q: v, cat, limit: 100 });
  }

  for (let i = 0; i < plan.length; i += 2) {
    const chunk = plan.slice(i, i + 2);
    const settled = await Promise.allSettled(
      chunk.map((p) => (p.__fn ? p.__fn() : torznabSearch(cfg, p)))
    );
    for (const s of settled) {
      if (s.status === "fulfilled") pushAll(s.value);
    }
  }
  if (!merged.length) {
    throw new Error("C411: aucun résultat pour « " + query + " »");
  }
  return merged;
}

async function downloadTorrentById(cfg, torrentId) {
  const key = requireKey(cfg);
  const id = String(torrentId || "").trim();
  if (!id) throw new Error("ID torrent C411 manquant");
  const base = apiBase(cfg);
  const u = new URL(`${base}/api/torznab`);
  u.searchParams.set("apikey", key);
  u.searchParams.set("t", "get");
  u.searchParams.set("id", id);
  const res = await requestRaw(u.toString());
  if (res.status === 401) throw new Error("C411 API key invalide (401)");
  if (res.status >= 400) {
    throw new Error(`C411 get ${res.status}: ${res.body.toString("utf8").slice(0, 180)}`);
  }
  const ct = String(res.headers["content-type"] || "");
  const buf = res.body;
  // bencode starts with "d"
  if (buf[0] === 0x64 || /bittorrent|octet-stream/i.test(ct)) {
    return { buffer: buf, fileName: `${id.slice(0, 12)}.torrent` };
  }
  // Sometimes returns magnet in XML/text
  const text = buf.toString("utf8");
  const magnet = (text.match(/magnet:\?[^\s"'<>]+/i) || [])[0];
  if (magnet) return { magnet, fileName: null, buffer: null };
  throw new Error("Réponse C411: pas un .torrent (vérifie l’ID / la clé API)");
}

function guessKindFromTitle(title, forced) {
  if (forced === "tv" || forced === "movie" || forced === "game") return forced;
  const t = String(title || "").toLowerCase();
  if (/\b(s\d{2}e\d{2}|s\d{2}\b|saison|season|integrale|compl[eè]te|serie|series|épisode|episode)\b/.test(t)) {
    return "tv";
  }
  if (/\b(pc|steam|gog|epic|xbox|ps[345]|switch|nsw|nsp|xci|rom|repack|fitgirl)\b/.test(t)) {
    return "game";
  }
  return "movie";
}

function kindFromCategories(cats, title, forced) {
  if (forced === "tv" || forced === "movie" || forced === "game") return forced;
  const list = cats || [];
  if (list.some((c) => c >= 5000 && c < 6000)) return "tv";
  if (list.some((c) => (c >= 1000 && c < 2000) || (c >= 4000 && c < 5000)))
    return "game";
  if (list.some((c) => c >= 2000 && c < 3000)) return "movie";
  return guessKindFromTitle(title, forced);
}

module.exports = {
  isC411Host,
  parseC411Url,
  expandQuery,
  search,
  tvSearchSeason,
  browse,
  listBrowseSections,
  BROWSE_SECTIONS,
  downloadTorrentById,
  guessKindFromTitle,
  kindFromCategories,
  requireKey,
};
