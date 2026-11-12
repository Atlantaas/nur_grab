/**
 * Agrégateur Torznab FR (style C411) — sites FR privés / publics via Torznab.
 * Sources : C411 (natif) + frTorznab[] + Jackett (filtre indexers FR) + Prowlarr (filtre).
 */
const http = require("http");
const https = require("https");
const { URL } = require("url");

/** Noms / slugs d’indexeurs FR « propres » (type C411). */
const PREFERRED_FR = [
  "c411",
  "ygg",
  "yggtorrent",
  "yggcookie",
  "sharewood",
  "darkiworld",
  "darki",
  "tortuga",
  "torrent9",
  "cpasbien",
  "oxtorrent",
  "tiramiaou",
  "mesfilms",
  "french",
  "hd-espace",
  "hdespace",
  "emulotorrent",
];

function requestRaw(urlStr, { method = "GET", headers = {}, timeout = 22000 } = {}) {
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
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          Accept: "application/xml,application/json,*/*",
          ...headers,
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, urlStr).toString();
          res.resume();
          return resolve(requestRaw(next, { method, headers, timeout }));
        }
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks),
            headers: res.headers,
          }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(timeout, () => req.destroy(new Error("timeout fr_indexers")));
    req.end();
  });
}

function stripApiKeyFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(String(url));
    u.searchParams.delete("apikey");
    u.searchParams.delete("api_key");
    u.searchParams.delete("passkey");
    return u.toString();
  } catch (_) {
    return String(url).replace(/([?&])(apikey|api_key|passkey)=[^&]*/gi, "");
  }
}

function isPreferredFrIndexer(name) {
  const n = String(name || "").toLowerCase().replace(/\s+/g, "");
  if (!n) return false;
  return PREFERRED_FR.some((p) => n.includes(p));
}

function preferredList(cfg) {
  const custom = Array.isArray(cfg.preferredFrIndexers)
    ? cfg.preferredFrIndexers.map((s) => String(s).toLowerCase())
    : [];
  return [...new Set([...PREFERRED_FR, ...custom])];
}

function filterProwlarrResults(results, cfg) {
  const list = Array.isArray(results) ? results : [];
  const prefs = preferredList(cfg);
  const frOnly = cfg.frIndexersOnly !== false;
  if (!frOnly) return list;
  const filtered = list.filter((r) => {
    const idx = String(
      r.indexer || r.Indexer || r.indexerId || r.IndexerId || "",
    ).toLowerCase();
    if (prefs.some((p) => idx.includes(p))) return true;
    // Titre clairement FR même si indexer générique
    const title = String(r.title || r.Title || "");
    return /\b(vff|truefrench|vfq|vfi|multi|french)\b/i.test(title);
  });
  // Si filtre trop sévère (Prowlarr vide / indexers mal nommés) → garde FR audio
  if (!filtered.length && list.length) {
    return list.filter((r) =>
      /\b(vff|truefrench|vfq|vfi|multi|french)\b/i.test(
        String(r.title || r.Title || ""),
      ),
    );
  }
  return filtered;
}

function parseTorznabXml(xml, indexerLabel) {
  const items = [];
  const blocks = String(xml || "").split(/<item>/i).slice(1);
  for (const block of blocks) {
    const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) ||
      block.match(/<title>(.*?)<\/title>/i) || [])[1];
    if (!title) continue;
    const link = (block.match(/<link><!\[CDATA\[(.*?)\]\]><\/link>/i) ||
      block.match(/<link>(.*?)<\/link>/i) || [])[1];
    const guid = (block.match(/<guid[^>]*><!\[CDATA\[(.*?)\]\]><\/guid>/i) ||
      block.match(/<guid[^>]*>(.*?)<\/guid>/i) || [])[1];
    const size = Number(
      (block.match(/name="size"[^>]*>(\d+)/i) ||
        block.match(/<size>(\d+)/i) || [])[1] || 0,
    );
    const seeders = Number(
      (block.match(/name="seeders"[^>]*>(\d+)/i) || [])[1] || 0,
    );
    const grabs = Number(
      (block.match(/name="grabs"[^>]*>(\d+)/i) ||
        block.match(/name="downloadvolumefactor"[^>]*>/i) || [])[1] || 0,
    );
    const dlFac = Number(
      (block.match(/name="downloadvolumefactor"[^>]*>([0-9.]+)/i) || [])[1],
    );
    const freeleech = dlFac === 0;
    const magnet = (block.match(/(magnet:\?[^\s"'<>]+)/i) || [])[1] || null;
    const infoHash =
      (block.match(/name="infohash"[^>]*>([0-9a-f]{40})/i) ||
        (guid || "").match(/([0-9a-f]{40})/i) ||
        (link || "").match(/([0-9a-f]{40})/i) || [])[1] || null;
    const downloadUrl =
      (block.match(/url="([^"]+)"[^>]*length="/i) ||
        block.match(/<enclosure[^>]+url="([^"]+)"/i) || [])[1] ||
      link ||
      null;
    const jackettIx =
      (block.match(/name="jackettindexer"[^>]*value="([^"]+)"/i) ||
        block.match(/name="jackettindexer"[^>]*>([^<]+)/i) ||
        [])[1] || null;
    items.push({
      title: title.replace(/&amp;/g, "&").replace(/&lt;/g, "<").trim(),
      size,
      seeders,
      grabs,
      freeleech,
      downloadVolumeFactor: Number.isFinite(dlFac) ? dlFac : 1,
      infoHash: infoHash ? String(infoHash).toLowerCase() : null,
      downloadUrl,
      magnet,
      indexer: jackettIx || indexerLabel || "Torznab",
      guid: guid || null,
    });
  }
  return items;
}

function normalizeProwlarrHit(r) {
  return {
    title: r.title || r.Title || "",
    size: Number(r.size || r.Size || 0),
    seeders: Number(r.seeders || r.Seeders || 0),
    grabs: Number(r.grabs || r.Grabs || 0),
    freeleech:
      r.freeleech === true ||
      Number(r.downloadVolumeFactor ?? r.DownloadVolumeFactor) === 0,
    downloadVolumeFactor: Number(
      r.downloadVolumeFactor ?? r.DownloadVolumeFactor ?? 1,
    ),
    infoHash: (r.infoHash || r.InfoHash || "").toLowerCase() || null,
    downloadUrl: r.downloadUrl || r.DownloadUrl || r.guid || r.Guid || null,
    magnet: r.magnetUrl || r.MagnetUrl || null,
    indexer: r.indexer || r.Indexer || "Prowlarr",
    imdbId: r.imdbId || r.ImdbId || null,
    tmdbId: r.tmdbId || r.TmdbId || null,
  };
}

async function searchTorznabEndpoint(endpoint, query, { cat, limit = 80 } = {}) {
  const base = String(endpoint.base || endpoint.url || "").replace(/\/$/, "");
  const key = String(endpoint.apikey || endpoint.apiKey || "").trim();
  if (!base || !key || key === "CHANGE_ME") return [];
  const label = endpoint.name || endpoint.id || "Torznab";
  const u = new URL(`${base}/api`);
  u.searchParams.set("t", "search");
  u.searchParams.set("apikey", key);
  u.searchParams.set("q", query || "");
  u.searchParams.set("limit", String(Math.min(limit, 100)));
  if (cat) u.searchParams.set("cat", String(cat));
  const res = await requestRaw(u.toString());
  if (res.status >= 400) {
    throw new Error(`${label} ${res.status}`);
  }
  return parseTorznabXml(res.body.toString("utf8"), label);
}

/** Jackett « all » Torznab — filtre ensuite les indexers FR. */
async function searchJackett(cfg, query, { type = "search", limit = 80 } = {}) {
  const base = String(cfg.jackettBase || "").replace(/\/$/, "");
  const key = String(cfg.jackettApiKey || "").trim();
  if (!base || !key || key === "CHANGE_ME") return [];
  const path = `/api/v2.0/indexers/all/results/torznab/api`;

  async function once(tMode) {
    const u = new URL(`${base}${path}`);
    u.searchParams.set("apikey", key);
    u.searchParams.set("t", tMode);
    u.searchParams.set("q", query || "");
    u.searchParams.set("limit", String(Math.min(limit, 100)));
    const res = await requestRaw(u.toString());
    if (res.status >= 400) throw new Error(`Jackett ${res.status}`);
    const body = res.body.toString("utf8");
    // Jackett « all » refuse souvent tvsearch (error 201) → caller retente search.
    if (/<error\b/i.test(body) && /does not support/i.test(body)) {
      const err = new Error("jackett-mode-unsupported");
      err.code = "JACKETT_MODE";
      throw err;
    }
    return parseTorznabXml(body, "Jackett");
  }

  let items = [];
  try {
    items = await once(type === "tvsearch" ? "tvsearch" : "search");
  } catch (e) {
    if (e && e.code === "JACKETT_MODE" && type === "tvsearch") {
      items = await once("search");
    } else {
      throw e;
    }
  }
  // Filtre FR : nom d’indexer Jackett OU audio FR dans le titre.
  const frHits = items.filter((it) => {
    const idx = String(it.indexer || "");
    if (isPreferredFrIndexer(idx)) return true;
    return /\b(vff|truefrench|vfq|vfi|multi|french|fr\b)/i.test(it.title || "");
  });
  if (frHits.length) return frHits;
  return items;
}

function dedupeResults(list) {
  const seen = new Set();
  const out = [];
  for (const r of list || []) {
    const k = (
      r.infoHash ||
      r.downloadUrl ||
      r.magnet ||
      r.title ||
      ""
    ).toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/**
 * Recherche multi-sources FR (hors C411 natif — appelé en complément).
 */
async function searchFrExtras(cfg, query, { kind = "movie", limit = 80 } = {}) {
  const cat =
    kind === "tv"
      ? "5000"
      : kind === "game"
        ? "4050,4000,1000"
        : "2000";
  const tasks = [];
  const sources = [];

  const endpoints = Array.isArray(cfg.frTorznab) ? cfg.frTorznab : [];
  for (const ep of endpoints) {
    tasks.push(
      searchTorznabEndpoint(ep, query, { cat, limit }).then((items) => {
        sources.push(ep.name || ep.id || "torznab");
        return items;
      }).catch((e) => {
        sources.push(`fail:${ep.name || "?"}:${e.message || e}`);
        return [];
      }),
    );
  }

  tasks.push(
    searchJackett(cfg, query, {
      type: kind === "tv" ? "tvsearch" : "search",
      limit,
    })
      .then((items) => {
        if (items.length) sources.push("jackett-fr");
        return items;
      })
      .catch((e) => {
        sources.push(`fail:jackett:${e.message || e}`);
        return [];
      }),
  );

  const chunks = await Promise.all(tasks);
  return {
    results: dedupeResults(chunks.flat()),
    sources,
  };
}

module.exports = {
  PREFERRED_FR,
  preferredList,
  isPreferredFrIndexer,
  filterProwlarrResults,
  normalizeProwlarrHit,
  searchFrExtras,
  searchJackett,
  stripApiKeyFromUrl,
  dedupeResults,
};
