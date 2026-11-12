/**
 * Poster lookup — Radarr / TVMaze / IMDb suggestion / ids C411.
 */
const https = require("https");
const http = require("http");

const cache = new Map(); // key -> meta | null

function requestJson(urlStr) {
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
        headers: {
          "User-Agent": "NurGrab/1.1",
          Accept: "application/json",
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          try {
            resolve(JSON.parse(text || "null"));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(12000, () => req.destroy(new Error("timeout poster")));
    req.end();
  });
}

/** Strip release tags → searchable title + year */
function cleanReleaseTitle(raw) {
  let t = String(raw || "");
  t = t.replace(/[-.][A-Za-z0-9]+$/i, "");
  t = t.replace(/[._]/g, " ");
  t = t.replace(
    /\b(MULTI|MULTi|VFF|VFQ|VOSTFR|TRUEFRENCH|FRENCH|VO|VF2|VFI|2160p|1080p|720p|480p|4K|UHD|HDR10?\+?|DV|DOVI|BluRay|WEB[- ]?DL|WEBRip|WEB|HDTV|x265|x264|h\.?265|h\.?264|HEVC|AV1|AAC|DDP|DTS|TrueHD|Atmos|10bit|HDLight|4KLight|REMUX|COMPLETE|INTEGRALE|iNTEGRALE|CUSTOM|REPACK|PROPER)\b.*/i,
    ""
  );
  t = t.replace(/\s+/g, " ").trim();
  const yearM = t.match(/\b((19|20)\d{2})\b/);
  const year = yearM ? yearM[1] : null;
  let title = t.replace(/\b(19|20)\d{2}\b/g, "").replace(/\s+/g, " ").trim();
  title = title
    .replace(/\bS\d{1,2}E\d{1,2}\b/gi, "")
    .replace(/\bS\d{1,2}\b/gi, "")
    .replace(/\bSeason\s*\d+\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return { title, year, query: year ? `${title} ${year}` : title };
}

function cacheKey(kind, title, year, imdbId) {
  if (imdbId) return `imdb|${imdbId}`;
  return `${kind}|${(title || "").toLowerCase()}|${year || ""}`;
}

async function lookupImdbSuggestion(imdbId) {
  const id = String(imdbId || "").trim();
  if (!/^tt\d+$/i.test(id)) return null;
  const key = `imdb|${id.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const letter = id[2] || "t";
    const url = `https://v3.sg.media-imdb.com/suggestion/${letter}/${id}.json`;
    const data = await requestJson(url);
    const hit =
      (data?.d || []).find((x) => String(x.id).toLowerCase() === id.toLowerCase()) ||
      (data?.d || [])[0];
    if (!hit) {
      cache.set(key, null);
      return null;
    }
    const poster = hit.i?.imageUrl || null;
    const out = {
      poster,
      title: hit.l || hit.qid || id,
      year: hit.y || hit.yr || null,
      overview: hit.s ? String(hit.s).slice(0, 280) : "",
      imdbId: id,
      source: "imdb",
    };
    cache.set(key, out);
    return out;
  } catch (_) {
    cache.set(key, null);
    return null;
  }
}

async function lookupImdbByTitle(title, year) {
  const q = String(title || "").trim();
  if (q.length < 2) return null;
  const key = cacheKey("imdb-q", q, year);
  if (cache.has(key)) return cache.get(key);
  try {
    const slug = q
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 40);
    const letter = slug[0] || "a";
    const url = `https://v3.sg.media-imdb.com/suggestion/${letter}/${encodeURIComponent(slug)}.json`;
    const data = await requestJson(url);
    let list = data?.d || [];
    if (year) {
      const y = Number(year);
      const hit = list.find((x) => Number(x.y) === y);
      if (hit) list = [hit, ...list.filter((x) => x !== hit)];
    }
    const hit = list[0];
    if (!hit?.i?.imageUrl) {
      cache.set(key, null);
      return null;
    }
    const out = {
      poster: hit.i.imageUrl,
      title: hit.l,
      year: hit.y || year,
      overview: hit.s ? String(hit.s).slice(0, 280) : "",
      imdbId: hit.id || null,
      source: "imdb-suggest",
    };
    cache.set(key, out);
    return out;
  } catch (_) {
    cache.set(key, null);
    return null;
  }
}

async function lookupMovie(cfg, title, year, imdbId) {
  if (imdbId) {
    const byId = await lookupImdbSuggestion(imdbId);
    if (byId?.poster) return byId;
  }
  const key = cacheKey("movie", title, year, imdbId);
  if (cache.has(key) && !imdbId) return cache.get(key);

  const base = (cfg.radarrBase || "").replace(/\/$/, "");
  const apiKey = cfg.radarrApiKey;
  if (base && apiKey) {
    try {
      let url;
      if (imdbId) {
        url = `${base}/api/v3/movie/lookup/imdb?imdbId=${encodeURIComponent(imdbId)}&apikey=${apiKey}`;
      } else {
        const q = year ? `${title} ${year}` : title;
        url = `${base}/api/v3/movie/lookup?term=${encodeURIComponent(q)}&apikey=${apiKey}`;
      }
      const list = await requestJson(url);
      const arr = Array.isArray(list) ? list : list ? [list] : [];
      if (arr.length) {
        let best = arr[0];
        if (year) {
          const y = Number(year);
          const hit =
            arr.find((m) => m.year === y) ||
            arr.find((m) => Math.abs((m.year || 0) - y) <= 1);
          if (hit) best = hit;
        }
        const poster =
          best.remotePoster ||
          (best.images || []).find((i) => i.coverType === "poster")?.remoteUrl ||
          null;
        if (poster) {
          const out = {
            poster,
            title: best.title,
            year: best.year || year,
            overview: (best.overview || "").slice(0, 280),
            tmdbId: best.tmdbId || null,
            imdbId: best.imdbId || imdbId || null,
            source: "radarr",
          };
          cache.set(key, out);
          return out;
        }
      }
    } catch (_) {
      /* fall through */
    }
  }

  const imdb = await lookupImdbByTitle(title, year);
  cache.set(key, imdb);
  return imdb;
}

async function lookupTv(cfg, title, year, imdbId) {
  if (imdbId) {
    try {
      const url = `https://api.tvmaze.com/lookup/shows?imdb=${encodeURIComponent(imdbId)}`;
      const show = await requestJson(url);
      if (show) {
        const poster = show.image?.original || show.image?.medium || null;
        const out = {
          poster,
          title: show.name,
          year: (show.premiered || "").slice(0, 4) || year,
          overview: String(show.summary || "")
            .replace(/<[^>]+>/g, "")
            .slice(0, 280),
          tvmazeId: show.id || null,
          imdbId,
          source: "tvmaze-imdb",
        };
        if (poster) return out;
      }
    } catch (_) {
      /* fall through */
    }
    const byId = await lookupImdbSuggestion(imdbId);
    if (byId?.poster) return byId;
  }

  const key = cacheKey("tv", title, year);
  if (cache.has(key)) return cache.get(key);
  try {
    const url = `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(title)}`;
    const list = await requestJson(url);
    if (!Array.isArray(list) || !list.length) {
      const imdb = await lookupImdbByTitle(title, year);
      cache.set(key, imdb);
      return imdb;
    }
    let best = list[0];
    if (year) {
      const hit = list.find((x) =>
        (x.show?.premiered || "").startsWith(String(year))
      );
      if (hit) best = hit;
    }
    const show = best.show || {};
    const poster = show.image?.original || show.image?.medium || null;
    const out = {
      poster,
      title: show.name,
      year: (show.premiered || "").slice(0, 4) || year,
      overview: String(show.summary || "")
        .replace(/<[^>]+>/g, "")
        .slice(0, 280),
      tvmazeId: show.id || null,
      source: "tvmaze",
    };
    if (!poster) {
      const imdb = await lookupImdbByTitle(title, year);
      if (imdb?.poster) {
        cache.set(key, { ...out, ...imdb, title: out.title || imdb.title });
        return cache.get(key);
      }
    }
    cache.set(key, out);
    return out;
  } catch (e) {
    const imdb = await lookupImdbByTitle(title, year);
    cache.set(key, imdb);
    return imdb;
  }
}

async function lookupPoster(cfg, kind, releaseTitle, ids = {}) {
  const cleaned = cleanReleaseTitle(releaseTitle);
  if (!cleaned.title || cleaned.title.length < 2) {
    return { ...cleaned, meta: null };
  }
  const meta =
    kind === "tv"
      ? await lookupTv(cfg, cleaned.title, cleaned.year, ids.imdbId)
      : await lookupMovie(cfg, cleaned.title, cleaned.year, ids.imdbId);
  return { ...cleaned, meta };
}

/** Enrich ranked preview — posters via ids C411 puis titre. */
async function enrichWithPosters(cfg, kind, preview) {
  const unique = new Map();
  for (let i = 0; i < preview.length; i++) {
    const p = preview[i];
    const cleaned = cleanReleaseTitle(p.title);
    const k = p.imdbId
      ? `imdb|${p.imdbId}`
      : cacheKey(kind, cleaned.title, cleaned.year);
    if (!unique.has(k)) unique.set(k, { i, cleaned, imdbId: p.imdbId || null });
  }
  const entries = [...unique.entries()].slice(0, 30);
  const metas = new Map();
  await Promise.all(
    entries.map(async ([k, { cleaned, imdbId }]) => {
      const meta =
        kind === "tv"
          ? await lookupTv(cfg, cleaned.title, cleaned.year, imdbId)
          : await lookupMovie(cfg, cleaned.title, cleaned.year, imdbId);
      metas.set(k, { cleaned, meta });
    })
  );

  return preview.map((p) => {
    const cleaned = cleanReleaseTitle(p.title);
    const k = p.imdbId
      ? `imdb|${p.imdbId}`
      : cacheKey(kind, cleaned.title, cleaned.year);
    const hit = metas.get(k);
    return {
      ...p,
      cleanTitle: hit?.cleaned?.title || cleaned.title,
      cleanYear: hit?.cleaned?.year || cleaned.year,
      poster: hit?.meta?.poster || null,
      metaTitle: hit?.meta?.title || null,
      metaYear: hit?.meta?.year || null,
      overview: hit?.meta?.overview || null,
      posterSource: hit?.meta?.source || null,
    };
  });
}

module.exports = {
  cleanReleaseTitle,
  lookupPoster,
  enrichWithPosters,
  lookupMovie,
  lookupTv,
  lookupImdbSuggestion,
};
