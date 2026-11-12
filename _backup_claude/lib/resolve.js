/**
 * Resolve a page URL → metadata for search / download.
 * Primary: C411 (c411.com / c411.org). Secondary: IMDb/TMDB/etc.
 */
const http = require("http");
const https = require("https");
const { URL } = require("url");
const c411 = require("./c411");

function fetchText(urlStr, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("Trop de redirections"));
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
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
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
          return resolve(fetchText(next, redirects + 1));
        }
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            url: urlStr,
            html: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(20000, () => {
      req.destroy(new Error("Timeout fetch"));
    });
    req.end();
  });
}

function meta(html, prop) {
  const patterns = [
    new RegExp(
      `<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+name=["']${prop}["'][^>]+content=["']([^"']+)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${prop}["']`,
      "i"
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decode(m[1]);
  }
  return null;
}

function decode(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTitle(raw) {
  let t = decode(raw);
  t = t
    .replace(/\s*[\|–—-]\s*(IMDb|TMDB|AlloCiné|Allocine|Wikipedia|C411).*$/i, "")
    .replace(/\s*·.*$/, "")
    .replace(/\s*:\s*Allociné.*$/i, "")
    .trim();
  return t;
}

function extractYear(text) {
  const m = String(text || "").match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : null;
}

function parseKnownIds(urlStr) {
  const u = new URL(urlStr);
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const path = u.pathname;

  const c411Parsed = c411.parseC411Url(urlStr);
  if (c411Parsed) {
    return {
      site: "c411",
      kind: null,
      torrentId: c411Parsed.torrentId,
      query: c411Parsed.query,
    };
  }

  const imdb = path.match(/\/title\/(tt\d{5,})/i);
  if (host.includes("imdb.com") && imdb) {
    return { site: "imdb", imdbId: imdb[1], kind: null };
  }

  const tmdbMovie = path.match(/\/movie\/(\d+)/);
  if (host.includes("themoviedb.org") && tmdbMovie) {
    return { site: "tmdb", tmdbId: tmdbMovie[1], kind: "movie" };
  }
  const tmdbTv = path.match(/\/tv\/(\d+)/);
  if (host.includes("themoviedb.org") && tmdbTv) {
    return { site: "tmdb", tmdbId: tmdbTv[1], kind: "tv" };
  }

  if (host.includes("allocine.fr")) {
    if (/\/series\//i.test(path) || /\/serie\//i.test(path)) {
      return { site: "allocine", kind: "tv" };
    }
    if (/\/film\//i.test(path)) {
      return { site: "allocine", kind: "movie" };
    }
  }

  if (host.includes("senscritique.com")) {
    if (/\/serie\//i.test(path)) return { site: "senscritique", kind: "tv" };
    if (/\/film\//i.test(path)) return { site: "senscritique", kind: "movie" };
  }

  return { site: "generic", kind: null };
}

function guessKindFromHtml(html, fallback) {
  if (fallback) return fallback;
  const type = (meta(html, "og:type") || "").toLowerCase();
  if (type.includes("tv") || type.includes("video.tv")) return "tv";
  if (type.includes("movie") || type.includes("video.movie")) return "movie";
  const body = html.slice(0, 8000).toLowerCase();
  if (/\b(tvseries|tv series|série télévisée|serie televisee)\b/.test(body)) {
    return "tv";
  }
  return "movie";
}

async function resolveUrl(urlStr) {
  let url = String(urlStr || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Colle une URL http(s) complète");
  }
  try {
    const u = new URL(url);
    u.hash = "";
    url = u.toString();
  } catch {
    throw new Error("URL invalide");
  }

  const known = parseKnownIds(url);

  // C411: don't need to scrape the private page — Torznab uses id / query
  if (known.site === "c411") {
    let title = known.query || null;
    if (!title && known.torrentId) {
      title = `c411:${known.torrentId.slice(0, 10)}`;
    }
    return {
      url,
      site: "c411",
      kind: known.kind,
      title: title || "C411",
      year: null,
      query: known.query || null,
      torrentId: known.torrentId || null,
      imdbId: null,
      tmdbId: null,
    };
  }

  const page = await fetchText(url);
  if (page.status >= 400) {
    throw new Error(`Page inaccessible (${page.status})`);
  }
  const html = page.html;

  let title =
    meta(html, "og:title") ||
    meta(html, "twitter:title") ||
    meta(html, "title");
  if (!title) {
    const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    title = m ? m[1] : null;
  }
  if (!title) throw new Error("Titre introuvable sur la page");

  title = cleanTitle(title);
  let year = extractYear(title);
  const imdbYear = title.match(/\((\d{4})\)/);
  if (imdbYear) year = imdbYear[1];

  let searchTitle = title
    .replace(/\(\d{4}\)/g, "")
    .replace(/\(TV Series[^)]*\)/gi, "")
    .replace(/\(TV Mini Series[^)]*\)/gi, "")
    .replace(/\(Video[^)]*\)/gi, "")
    .trim();

  const kind = guessKindFromHtml(html, known.kind);

  const orig2 = html.match(
    /"originalTitleText"\s*:\s*\{\s*"text"\s*:\s*"([^"]+)"/
  );
  if (orig2) searchTitle = decode(orig2[1]);

  const imdbId =
    known.imdbId ||
    (html.match(/\/title\/(tt\d{5,})/i) || [])[1] ||
    null;
  const tmdbId = known.tmdbId || null;
  const query = year ? `${searchTitle} ${year}` : searchTitle;

  return {
    url,
    site: known.site,
    kind,
    title: searchTitle,
    year,
    query,
    torrentId: null,
    imdbId,
    tmdbId,
  };
}

module.exports = { resolveUrl, parseKnownIds, cleanTitle };
