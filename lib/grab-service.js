/**
 * Shared Grab core — used by Electron (main.js) and mobile HTTP server.
 * Talks to Ultra (C411 / qBit / Transmission / FTP / Radarr posters).
 * PC does not need to be on if this process runs on Ultra.
 */
const path = require("path");
const fs = require("fs");
const clients = require("./clients");
const { resolveUrl } = require("./resolve");
const c411 = require("./c411");
const ftp = require("./ftp");
const posters = require("./posters");
const frIndexers = require("./fr_indexers");

function createGrabService(configPath) {
  const qbitJar = new Map();
  let txClient = null;
  /** Cache recherche 3 min — évite re-spam C411 sur le même query. */
  const searchCache = new Map();
  /**
   * pickId → release complète (magnet / downloadUrl inclus).
   * Le hub Sanctuary ne transmet JAMAIS les liens au renderer : il renvoie
   * juste le pickId → on retrouve la release ici (YGG / Prowlarr inclus,
   * pas seulement les hash C411). TTL 2 h, 3000 entrées max.
   */
  const pickStore = new Map();
  const PICK_TTL_MS = 2 * 60 * 60 * 1000;
  function rememberPick(item) {
    const crypto = require("crypto");
    const id = crypto.randomBytes(8).toString("hex");
    pickStore.set(id, { at: Date.now(), item });
    if (pickStore.size > 3000) {
      for (const [k, v] of pickStore) {
        if (pickStore.size <= 2500) break;
        if (Date.now() - v.at > PICK_TTL_MS || pickStore.size > 2500) pickStore.delete(k);
      }
    }
    return id;
  }
  function recallPick(id) {
    const hit = pickStore.get(String(id || ""));
    if (!hit) return null;
    if (Date.now() - hit.at > PICK_TTL_MS) {
      pickStore.delete(id);
      return null;
    }
    return hit.item;
  }
  /** Debounce organize Series/Season après DL pack saison. */
  let lastTvOrganizeAt = 0;
  let tvOrganizeRunning = false;

  function cfg() {
    return clients.loadConfig(configPath);
  }

  function cacheGet(key) {
    const hit = searchCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > 180000) {
      searchCache.delete(key);
      return null;
    }
    return hit.payload;
  }

  function cacheSet(key, payload) {
    searchCache.set(key, { at: Date.now(), payload });
    if (searchCache.size > 40) {
      const oldest = [...searchCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) searchCache.delete(oldest[0]);
    }
  }

  async function ensureQbit() {
    const c = cfg();
    await clients.qbitLogin(c, qbitJar);
    return c;
  }

  function ensureTx() {
    const c = cfg();
    if (!txClient) txClient = new clients.TransmissionClient(c);
    return { c, tx: txClient };
  }

  function guessKindFromName(name, forced) {
    if (forced === "tv" || forced === "movie" || forced === "game") return forced;
    // magnet → lire le dn= (sinon on teste toute l’URL encodée)
    let base = String(name || "");
    const dn = base.match(/[?&]dn=([^&]+)/i);
    if (dn) {
      try {
        base = decodeURIComponent(dn[1].replace(/\+/g, " "));
      } catch (_) {
        base = dn[1];
      }
    }
    base = base.toLowerCase();
    if (/\b(pc|steam|gog|repack|fitgirl|dodi|elamigos|nsp|xci|switch|ps[345])\b/.test(base)) {
      return "game";
    }
    if (
      /\b(s\d{2}|saison|integrale|complete|season|serie|series|épisode|episode)\b/.test(
        base
      )
    ) {
      return "tv";
    }
    return "movie";
  }

  /** Films/jeux → qBit (Transmission Ultra souvent 502). Séries → qBit. */
  function qbitCategoryFor(kind) {
    if (kind === "tv") return "tv";
    if (kind === "game") return "games";
    return "movies";
  }

  async function addMagnetRouted(c, kind, magnet, tags) {
    const savePath = clients.savePathFor(c, kind);
    const category = qbitCategoryFor(kind);
    // Prefer qBit for everything — Transmission on Ultra is flaky (502).
    try {
      await ensureQbit();
      await clients.qbitAddMagnet(c, qbitJar, {
        magnet,
        savePath,
        category,
        tags: tags || `nur-grab,${category}`,
      });
      return savePath;
    } catch (qbitErr) {
      if (kind === "tv") throw qbitErr;
      // Fallback Transmission only for movie/game if qBit fails
      try {
        const { tx } = ensureTx();
        await tx.addMagnet({ magnet, downloadDir: savePath });
        return savePath;
      } catch (txErr) {
        throw new Error(
          `qBit+TX échec: ${qbitErr.message || qbitErr} / ${txErr.message || txErr}`,
        );
      }
    }
  }

  async function addTorrentBufferRouted(c, kind, buffer, fileName, tags) {
    const savePath = clients.savePathFor(c, kind);
    const category = qbitCategoryFor(kind);
    let apiOk = false;
    let apiError = null;
    try {
      await ensureQbit();
      await clients.qbitAddTorrentBuffer(c, qbitJar, {
        buffer,
        fileName,
        savePath,
        category,
        tags: tags || `nur-grab,${category}`,
      });
      apiOk = true;
    } catch (e) {
      apiError = String(e.message || e);
      if (kind !== "tv") {
        try {
          const { tx } = ensureTx();
          await tx.addTorrentBuffer({ buffer, downloadDir: savePath });
          apiOk = true;
          apiError = null;
        } catch (txErr) {
          apiError = `${apiError} / TX: ${txErr.message || txErr}`;
        }
      }
    }

    let ftpResult = null;
    try {
      ftpResult = await ftp.uploadTorrentToWatch(c, {
        kind,
        buffer,
        fileName: fileName || `nur-grab-${Date.now()}.torrent`,
      });
    } catch (e) {
      if (!apiOk) {
        throw new Error(
          `API+FTP échec: ${apiError || "?"} / FTP: ${e.message || e}`
        );
      }
      ftpResult = { ok: false, error: String(e.message || e) };
    }

    if (!apiOk && !ftpResult?.ok) {
      throw new Error(apiError || "Ajout torrent échoué");
    }

    return { savePath, apiOk, apiError, ftp: ftpResult };
  }

  function toPreviewItem(r, source, { reco = false, recoReason = null } = {}) {
    const seasonInfo = r.seasonInfo || clients.parseSeasonInfo(r.title);
    const item = {
      title: r.title,
      score: r._score,
      size: r.size,
      seeders: r.seeders,
      grabs: r.grabs || 0,
      freeleech: !!r.freeleech,
      qualityLabel: r.qualityLabel || clients.qualityLabel(r),
      season: seasonInfo.season,
      episode: seasonInfo.episode,
      integrale: !!seasonInfo.integrale,
      seasonPack: !!seasonInfo.seasonPack,
      imdbId: r.imdbId || null,
      tmdbId: r.tmdbId || null,
      reco: !!reco,
      recoReason: recoReason || null,
      indexer: r.indexer || source,
      infoHash: r.infoHash || null,
      downloadUrl: r.downloadUrl || null,
      magnet: clients.magnetFromResult(r),
      hasMagnet: !!clients.magnetFromResult(r),
      hasDownload: !!(
        r.downloadUrl ||
        r.infoHash ||
        clients.magnetFromResult(r)
      ),
      kind: r.kind || null,
    };
    if (item.hasDownload) item.pickId = rememberPick(item);
    return item;
  }

  async function downloadEnclosure(url, redirects = 5) {
    const https = require("https");
    const http = require("http");
    if (/^magnet:/i.test(String(url))) return { magnet: String(url) };
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const lib = u.protocol === "https:" ? https : http;
      const req = lib
        .get(url, (res) => {
          // Prowlarr / Jackett : 301/302 → .torrent ou directement magnet:
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            const loc = String(res.headers.location);
            if (/^magnet:/i.test(loc)) return resolve({ magnet: loc });
            if (redirects <= 0) return reject(new Error("Enclosure: trop de redirections"));
            return resolve(downloadEnclosure(new URL(loc, url).toString(), redirects - 1));
          }
          if (res.statusCode >= 400) {
            res.resume();
            return reject(new Error(`Enclosure HTTP ${res.statusCode}`));
          }
          const chunks = [];
          res.on("data", (d) => chunks.push(d));
          res.on("end", () => {
            const buffer = Buffer.concat(chunks);
            if (buffer[0] === 0x64) {
              resolve({ buffer, fileName: null });
            } else {
              const text = buffer.toString("utf8");
              const m = text.match(/magnet:\?[^\s"'<>]+/i);
              if (m) resolve({ magnet: m[0] });
              else reject(new Error("Enclosure invalide (ni .torrent ni magnet)"));
            }
          });
        })
        .on("error", reject);
      req.setTimeout(25000, () => req.destroy(new Error("Enclosure timeout")));
    });
  }

  async function addPickedRelease(c, kind, pick) {
    const client = clients.clientLabel(kind);
    const savePath = clients.savePathFor(c, kind);
    const magnet = pick.magnet || null;

    if (magnet) {
      await addMagnetRouted(c, kind, magnet, "nur-grab,confirm");
      return { ok: true, kind, client, savePath, via: "magnet" };
    }

    if (pick.infoHash) {
      const dl = await c411.downloadTorrentById(c, pick.infoHash);
      if (dl.magnet) {
        await addMagnetRouted(c, kind, dl.magnet, "nur-grab,confirm,c411");
        return { ok: true, kind, client, savePath, via: "c411-magnet" };
      }
      const fileName =
        dl.fileName ||
        `${(pick.title || "c411").slice(0, 40).replace(/[^\w.-]+/g, "_")}.torrent`;
      const added = await addTorrentBufferRouted(
        c,
        kind,
        dl.buffer,
        fileName,
        "nur-grab,confirm,c411"
      );
      return {
        ok: true,
        kind,
        client,
        savePath: added.savePath,
        ftp: added.ftp,
        via: "c411-torrent",
      };
    }

    if (pick.downloadUrl) {
      const dl = await downloadEnclosure(pick.downloadUrl);
      if (dl.magnet) {
        await addMagnetRouted(c, kind, dl.magnet, "nur-grab,confirm");
        return { ok: true, kind, client, savePath, via: "enclosure-magnet" };
      }
      const fileName = `${(pick.title || "c411")
        .slice(0, 40)
        .replace(/[^\w.-]+/g, "_")}.torrent`;
      const added = await addTorrentBufferRouted(
        c,
        kind,
        dl.buffer,
        fileName,
        "nur-grab,confirm"
      );
      return {
        ok: true,
        kind,
        client,
        savePath: added.savePath,
        ftp: added.ftp,
        via: "enclosure",
      };
    }

    throw new Error("Ce résultat n’a ni magnet ni .torrent");
  }

  /**
   * Pour une série : cherche explicitement chaque saison manquante (S01, S02…)
   * dans l’ordre, jusqu’à max détecté / plafond. Évite Flash = S4+S5 sans S1–S3.
   */
  async function fillMissingSeasons(cfg, query, baseResults, opts = {}) {
    // Défaut soft : max 3 saisons manquantes (avant = 9–15 → 429 C411).
    const forceAll = opts.forceAll === true;
    const maxProbe = Math.min(
      Number(opts.maxProbe) || (forceAll ? 8 : 3),
      forceAll ? 12 : 4,
    );
    const merged = [...(baseResults || [])];
    const seen = new Set(
      merged.map((it) =>
        (it.infoHash || it.downloadUrl || it.title || "").toLowerCase()
      )
    );
    const pushAll = (items) => {
      for (const it of items || []) {
        // Garde seulement les releases du bon titre (flash ≠ flashback)
        if (!clients.matchesQuery(it.title, query)) continue;
        const k = (it.infoHash || it.downloadUrl || it.title || "").toLowerCase();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        merged.push(it);
      }
    };

    let cov = clients.seasonsCoverage(
      clients.filterByQuery(merged, query)
    );
    // Année dominante (Flash.2014) pour cibler les saisons manquantes
    const yearCount = {};
    for (const r of clients.filterByQuery(merged, query)) {
      const m = String(r.title || "").match(/\b((?:19|20)\d{2})\b/);
      if (m) yearCount[m[1]] = (yearCount[m[1]] || 0) + 1;
    }
    const year =
      Object.entries(yearCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    // Au minimum on vise jusqu’au max déjà vu, sinon 9 (séries longues type Flash)
    let target = Math.max(cov.maxS || 0, forceAll ? 9 : 1);
    target = Math.min(target, maxProbe);

    const fetched = [];
    let rateHit = false;
    // 1) Combler les trous 1 → target (priorité packs manquants)
    for (let s = 1; s <= target; s++) {
      if (cov.pack.has(s)) continue;
      if (rateHit) break;
      try {
        const items = await c411.tvSearchSeason(cfg, query, s, {
          limit: 40,
          year,
        });
        const before = merged.length;
        pushAll(items);
        const got = clients.filterByQuery(items, query).some((it) => {
          if (!clients.hasFrenchAudio(it.title)) return false;
          const info = clients.parseSeasonInfo(it.title);
          return info.season === s && (info.episode == null || info.seasonPack);
        });
        if (merged.length > before || got) fetched.push(s);
        cov = clients.seasonsCoverage(clients.filterByQuery(merged, query));
      } catch (e) {
        if (e && (e.code === "RATE_LIMIT" || e.status === 429)) {
          rateHit = true;
          break;
        }
        /* season miss */
      }
    }

    // 2) Étendre au-delà si des saisons plus hautes existent (2 misses d’affilée = stop)
    let misses = 0;
    for (let s = target + 1; s <= maxProbe; s++) {
      if (cov.pack.has(s)) {
        misses = 0;
        continue;
      }
      try {
        const items = await c411.tvSearchSeason(cfg, query, s, {
          limit: 40,
          year,
        });
        const fr = clients.pickBest(
          clients.filterByQuery(items, query)
        );
        const hasPack = fr.some((r) => {
          const info = r.seasonInfo || clients.parseSeasonInfo(r.title);
          return info.season === s && (info.episode == null || info.seasonPack);
        });
        if (!fr.length || !hasPack) {
          misses += 1;
          if (misses >= 2) break;
          continue;
        }
        pushAll(items);
        fetched.push(s);
        misses = 0;
        cov = clients.seasonsCoverage(clients.filterByQuery(merged, query));
      } catch (e) {
        if (e && (e.code === "RATE_LIMIT" || e.status === 429)) break;
        misses += 1;
        if (misses >= 2) break;
      }
    }

    return { results: merged, fetched, coverage: cov };
  }

  async function searchAndMaybeAdd({
    query,
    kind,
    autoAdd = false,
    imdbId = null,
    tmdbId = null,
    preferC411 = true,
    /** auto | list | integrale | seasons */
    seriesMode = "auto",
    season = null,
    dryRun = false,
  }) {
    const client = clients.clientLabel(kind);
    const c = cfg();
    // dryRun = jamais pousser qBit / Transmission / Jellyfin.
    if (dryRun) autoAdd = false;
    const cacheKey = `${kind}|${seriesMode}|${season || ""}|${String(query || "")
      .trim()
      .toLowerCase()}`;
    if (!autoAdd) {
      const cached = cacheGet(cacheKey);
      if (cached) {
        return { ...cached, cached: true, dryRun: !!dryRun };
      }
    }
    let results = [];
    let source = "none";

    const bits = [];
    // 1) C411 (natif Torznab FR) — 429 = on continue avec Jackett/Prowlarr
    let rateLimited = false;
    if (preferC411 && String(c.c411ApiKey || "").trim()) {
      try {
        const c411Hits = await c411.search(c, query, {
          kind,
          limit: 80,
          season,
        });
        results = results.concat(c411Hits || []);
        if (c411Hits?.length) bits.push("c411");
      } catch (e) {
        if (e && (e.code === "RATE_LIMIT" || e.status === 429)) {
          rateLimited = true;
          bits.push("c411-429");
        } else {
          bits.push("c411-fail");
        }
        source = "c411-fail:" + (e.message || e);
      }
    }

    // 2) Torznab FR extra (YGG / Sharewood / …) + Jackett filtré FR
    try {
      const extra = await frIndexers.searchFrExtras(c, query, {
        kind,
        limit: 80,
      });
      if (extra.results?.length) {
        results = results.concat(extra.results);
        bits.push(...(extra.sources || []).filter((s) => !String(s).startsWith("fail:")));
      }
    } catch (_) {
      /* best-effort */
    }

    // 3) Prowlarr — toujours en complément, filtré indexers FR / audio FR
    try {
      const prow = await clients.prowlarrSearch(c, query, {
        type: kind === "tv" ? "tvsearch" : kind === "game" ? "search" : "movie",
        limit: 100,
        imdbId,
        tmdbId,
      });
      const filtered = frIndexers.filterProwlarrResults(prow, c).map(
        frIndexers.normalizeProwlarrHit,
      );
      if (filtered.length) {
        results = results.concat(filtered);
        bits.push("prowlarr-fr");
      } else if (Array.isArray(prow) && prow.length) {
        bits.push("prowlarr-filtered-empty");
      }
    } catch (e) {
      bits.push("prowlarr-fail");
      if (!results.length) {
        throw new Error(
          String(c.c411ApiKey || "").trim()
            ? `Recherche vide (${bits.join("+") || source}). Prowlarr: ${e.message || e}`
            : `Pas de clé C411 et Prowlarr KO: ${e.message || e}`,
        );
      }
    }

    results = frIndexers.dedupeResults(results);
    source = bits.length ? bits.join("+") : source || "none";
    if (!results.length) {
      if (rateLimited) {
        const cd = c411.cooldownStatus();
        const err = new Error(
          `C411 trop sollicité (429). Réessaie dans ~${cd.retryInSec || 30} s. `
            + "Jackett/Prowlarr Ultra n’ont pas encore d’indexers configurés "
            + "(ajoute YGG/Sharewood dans l’UI Jackett) — sinon seule C411 répond.",
        );
        err.code = "RATE_LIMIT";
        err.retryInSec = cd.retryInSec || 30;
        throw err;
      }
      throw new Error(
        `Aucun résultat (${source}). Vérifie C411 / Jackett FR / Prowlarr.`,
      );
    }

    // Séries : fill soft (max 3) en auto — forceAll seulement en mode « seasons »
    // (avant forceAll:true → 9–15 appels C411 → 429).
    let seasonsFilled = [];
    if (
      kind === "tv" &&
      seriesMode !== "list" &&
      seriesMode !== "integrale" &&
      !rateLimited &&
      String(c.c411ApiKey || "").trim()
    ) {
      const wantIntegrale = seriesMode === "integrale";
      const earlyPlan = clients.planSeriesDownloads(results, {
        preferIntegrale: wantIntegrale,
        query,
      });
      const skipFill = wantIntegrale && earlyPlan.mode === "integrale";
      if (!skipFill) {
        try {
          const filled = await fillMissingSeasons(c, query, results, {
            forceAll: seriesMode === "seasons",
            maxProbe: seriesMode === "seasons" ? 8 : 3,
          });
          results = filled.results;
          seasonsFilled = filled.fetched || [];
          if (seasonsFilled.length) source += "+seasons";
        } catch (_) {
          /* best-effort */
        }
      }
    }

    // TV : garder les remux « seuls dispo » pour le plan saisons (ex. Flash S05)
    const scopedForPlan =
      kind === "tv" ? clients.filterByQuery(results, query) : results;
    const ranked = clients.pickBest(scopedForPlan);
    if (!ranked.length && !(kind === "tv" && scopedForPlan.length)) {
      return {
        ok: false,
        error: "Aucun résultat FR propre (VFF/MULTI…)",
        results: [],
        client,
        kind,
        source,
        totalRaw: results.length,
      };
    }

    let seriesPlan = null;
    let previewSource = ranked.length ? ranked : clients.pickBest(scopedForPlan);
    let recoIndexes = new Set([0]);
    let recoReason =
      "Reco auto · FR + meilleur rapport qualité/poids (4K Light / 1080p)";

    if (kind === "tv" && seriesMode !== "list") {
      // auto / seasons → S1→Sn ordonnées ; pack complet seulement via bouton Intégrale
      if (seriesMode === "integrale") {
        seriesPlan = clients.planSeriesDownloads(scopedForPlan, {
          preferIntegrale: true,
          query,
        });
        if (seriesPlan.mode !== "integrale") {
          seriesPlan = clients.planSeriesDownloads(scopedForPlan, {
            preferIntegrale: false,
            query,
          });
          seriesPlan.reason =
            (seriesPlan.reason || "") + " (pas d’intégrale FR — saisons)";
        }
      } else {
        seriesPlan = clients.planSeriesDownloads(scopedForPlan, {
          preferIntegrale: false,
          query,
        });
      }
      if (seriesPlan?.picks?.length) {
        recoReason = seriesPlan.reason || recoReason;
        if (seasonsFilled.length) {
          recoReason += ` · complété S${seasonsFilled.join(", S")}`;
        }
        const pickKeys = new Set(
          seriesPlan.picks.map(
            (p) => (p.infoHash || p.title || "").toLowerCase()
          )
        );
        const head = seriesPlan.picks;
        const rest = (ranked.length ? ranked : scopedForPlan)
          .filter(
            (r) => !pickKeys.has((r.infoHash || r.title || "").toLowerCase())
          )
          .sort((a, b) => {
            const sa =
              (a.seasonInfo || clients.parseSeasonInfo(a.title)).season || 999;
            const sb =
              (b.seasonInfo || clients.parseSeasonInfo(b.title)).season || 999;
            if (sa !== sb) return sa - sb;
            return (b._score || 0) - (a._score || 0);
          });
        previewSource = [...head, ...rest];
        recoIndexes = new Set(head.map((_, i) => i));
      }
    }

    let preview = previewSource.slice(0, 60).map((r, i) =>
      toPreviewItem(r, source, {
        reco: recoIndexes.has(i),
        recoReason: recoIndexes.has(i) ? recoReason : null,
      })
    );
    try {
      preview = await posters.enrichWithPosters(
        c,
        kind === "game" ? "movie" : kind,
        preview,
      );
    } catch (_) {
      /* optional */
    }
    const best = preview.find((p) => p.reco) || preview[0];

    if (!autoAdd) {
      const payload = {
        ok: true,
        best,
        preview,
        added: false,
        kind,
        client,
        query,
        source,
        totalRaw: results.length,
        totalFr: ranked.length,
        variants: c411.expandQuery(query),
        seriesMode,
        seriesPlan: seriesPlan
          ? {
              mode: seriesPlan.mode,
              reason: seriesPlan.reason,
              seasons: seriesPlan.seasons,
              pickCount: seriesPlan.picks?.length || 0,
            }
          : null,
        recoReason,
        dryRun: !!dryRun,
      };
      cacheSet(cacheKey, payload);
      return payload;
    }

    // autoAdd: une release (films) ou tous les picks série
    const toAdd =
      kind === "tv" && seriesPlan?.picks?.length
        ? seriesPlan.picks.map((p) => toPreviewItem(p, source, { reco: true }))
        : [best];
    const addedList = [];
    for (const pick of toAdd) {
      const added = await addPickedRelease(c, kind, pick);
      addedList.push(added);
    }
    return {
      ok: true,
      added: true,
      ...addedList[0],
      addedCount: addedList.length,
      best,
      preview,
      query,
      source,
      seriesPlan: seriesPlan
        ? { mode: seriesPlan.mode, pickCount: toAdd.length }
        : null,
    };
  }

  async function browseSection(payload) {
    const section = String(payload?.section || "movies-new");
    const limit = Number(payload?.limit) || 40;
    const c = cfg();
    const bKey = `browse|${section}|${limit}`;
    if (!payload?.force) {
      const hit = cacheGet(bKey);
      if (hit) return { ...hit, cached: true };
    }
    try {
      const raw = await c411.browse(c, { section, limit });
      const fr = clients.pickBest(raw.items);
      let preview = fr.slice(0, 50).map((r, i) =>
        toPreviewItem(r, "c411-browse", {
          reco: i === 0,
          recoReason:
            i === 0 ? "Nouveauté · meilleure FR (qualité/poids)" : null,
        })
      );
      try {
        preview = await posters.enrichWithPosters(c, raw.kind, preview);
      } catch (_) {}
      const out = {
        ok: true,
        section: raw.section,
        label: raw.label,
        kind: raw.kind,
        preview,
        sections: c411.listBrowseSections(),
        totalFr: fr.length,
        totalRaw: (raw.items || []).length,
      };
      cacheSet(bKey, out);
      return out;
    } catch (e) {
      return {
        ok: false,
        error: String(e.message || e),
        rateLimited: !!(e && e.code === "RATE_LIMIT"),
        retryInSec: e && e.retryInSec ? e.retryInSec : null,
        sections: c411.listBrowseSections(),
      };
    }
  }

  async function status() {
    const out = {
      ok: true,
      neverDelete: true,
      qbit: null,
      transmission: null,
      ftp: null,
      c411: null,
      mobile: true,
    };
    try {
      const c = await ensureQbit();
      const list = await clients.qbitList(c, qbitJar);
      out.qbit = {
        ok: true,
        torrents: list.length,
        downloading: list.filter((t) =>
          /downloading|metaDL|stalledDL|checking/i.test(t.state)
        ).length,
      };
    } catch (e) {
      out.qbit = { ok: false, error: String(e.message || e) };
    }
    try {
      const { tx } = ensureTx();
      const ping = await tx.ping();
      const list = await tx.list();
      out.transmission = {
        ok: true,
        version: ping.version,
        torrents: list.length,
        downloading: list.filter((t) => t.status === 4 || t.status === 3)
          .length,
      };
    } catch (e) {
      out.transmission = { ok: false, error: String(e.message || e) };
    }
    try {
      out.ftp = await ftp.testFtp(cfg());
    } catch (e) {
      out.ftp = { ok: false, error: String(e.message || e) };
    }
    const key = String(cfg().c411ApiKey || "").trim();
    out.c411 = {
      ok: !!(key && key !== "CHANGE_ME"),
      base: cfg().c411Base || "https://c411.org",
      ...c411.cooldownStatus(),
    };
    out.ok = !!(out.qbit?.ok || out.transmission?.ok || out.ftp?.ok);
    return out;
  }

  async function list() {
    const items = [];
    try {
      const c = await ensureQbit();
      const listQ = await clients.qbitList(c, qbitJar);
      for (const t of listQ) {
        items.push({
          client: "qBit",
          name: t.name,
          progress: Math.round((t.progress || 0) * 1000) / 10,
          state: t.state,
          size: t.size,
          dlspeed: t.dlspeed,
          save_path: t.save_path,
          category: t.category || "tv",
          added: t.added_on || 0,
        });
      }
    } catch (e) {
      items.push({
        client: "qBit",
        name: "Erreur qBit: " + (e.message || e),
        progress: 0,
        state: "error",
        size: 0,
        dlspeed: 0,
        save_path: "",
        category: "",
        added: 0,
      });
    }
    try {
      const { tx } = ensureTx();
      const listT = await tx.list();
      for (const t of listT) {
        items.push({
          client: "Transmission",
          name: t.name,
          progress: Math.round((t.percentDone || 0) * 1000) / 10,
          state: clients.TX_STATUS[t.status] || String(t.status),
          size: t.totalSize,
          dlspeed: t.rateDownload,
          save_path: t.downloadDir,
          category: "movies",
          added: t.addedDate || 0,
        });
      }
    } catch (e) {
      items.push({
        client: "Transmission",
        name: "Erreur Transmission: " + (e.message || e),
        progress: 0,
        state: "error",
        size: 0,
        dlspeed: 0,
        save_path: "",
        category: "",
        added: 0,
      });
    }
    items.sort((a, b) => (b.added || 0) - (a.added || 0));
    // Packs S01/S02 à la racine TV → Series/Season XX (async, ne bloque pas list)
    maybeOrganizeSeasonPacks(items).catch(() => {});
    return { ok: true, torrents: items.slice(0, 50) };
  }

  async function maybeOrganizeSeasonPacks(items) {
    if (tvOrganizeRunning) return;
    if (Date.now() - lastTvOrganizeAt < 90_000) return;
    const donePack = (items || []).some((t) => {
      if (t.client !== "qBit") return false;
      if ((t.progress || 0) < 99.5) return false;
      const n = String(t.name || "");
      // Pack saison type .S01. / Season 01 — pas déjà sous Series/Season
      return /\.(S\d{2})\./i.test(n) || /[\s._-]S\d{2}[\s._-]/i.test(n);
    });
    if (!donePack) return;
    tvOrganizeRunning = true;
    lastTvOrganizeAt = Date.now();
    try {
      const { spawn } = require("child_process");
      const script = path.join(__dirname, "..", "scripts", "organize-tv-seasons.js");
      spawn(process.execPath, [script], {
        cwd: path.join(__dirname, ".."),
        detached: true,
        stdio: "ignore",
      }).unref();
    } finally {
      tvOrganizeRunning = false;
    }
  }

  function normalizeKind(k) {
    if (k === "tv" || k === "game") return k;
    return "movie";
  }

  async function searchBest(payload) {
    const query = String(payload?.query || "").trim();
    if (!query) return { ok: false, error: "Titre vide" };
    const kind = normalizeKind(payload?.kind);
    // dryRun bat autoAdd — jamais qBit/Jellyfin en mode test.
    const dryRun = payload?.dryRun === true;
    const autoAdd = !dryRun && payload?.autoAdd === true;
    const seriesMode = ["auto", "list", "integrale", "seasons"].includes(
      payload?.seriesMode
    )
      ? payload.seriesMode
      : "auto";
    const season =
      payload?.season != null && payload.season !== ""
        ? Number(payload.season)
        : null;
    try {
      return await searchAndMaybeAdd({
        query,
        kind,
        autoAdd,
        dryRun,
        preferC411: true,
        seriesMode,
        season,
      });
    } catch (e) {
      return {
        ok: false,
        error: String(e.message || e),
        rateLimited: !!(e && e.code === "RATE_LIMIT"),
        retryInSec: (e && e.retryInSec) || null,
        kind,
        client: clients.clientLabel(kind),
      };
    }
  }

  async function confirmAdd(payload) {
    const kind = normalizeKind(payload?.kind);
    const stored = payload?.pickId ? recallPick(payload.pickId) : null;
    const pick = stored || payload?.pick;
    if (!pick || !pick.title) {
      return { ok: false, error: "Aucun choix" };
    }
    try {
      const c = cfg();
      const added = await addPickedRelease(c, kind, pick);
      return { ok: true, ...added, best: pick };
    } catch (e) {
      return {
        ok: false,
        error: String(e.message || e),
        kind,
        client: clients.clientLabel(kind),
      };
    }
  }

  /** Confirme plusieurs picks (intégrale déjà 1, ou 1/saison). */
  async function confirmAddMany(payload) {
    const kind = normalizeKind(payload?.kind);
    const picks = (Array.isArray(payload?.picks) ? payload.picks : [])
      .map((p) => (p && p.pickId && recallPick(p.pickId)) || p)
      .filter((p) => p && p.title);
    if (!picks.length) return { ok: false, error: "Aucun choix" };
    const c = cfg();
    const results = [];
    for (const pick of picks) {
      try {
        const added = await addPickedRelease(c, kind, pick);
        results.push({ ok: true, title: pick.title, ...added });
      } catch (e) {
        results.push({
          ok: false,
          title: pick.title,
          error: String(e.message || e),
        });
      }
    }
    const okCount = results.filter((r) => r.ok).length;
    return {
      ok: okCount > 0,
      addedCount: okCount,
      total: picks.length,
      results,
      kind,
      client: clients.clientLabel(kind),
    };
  }

  async function addMagnet(payload) {
    const magnet = String(payload?.magnet || "").trim();
    if (!magnet.startsWith("magnet:")) {
      return { ok: false, error: "Colle un magnet: valide" };
    }
    const kind = guessKindFromName(magnet, payload?.kind);
    const client = clients.clientLabel(kind);
    try {
      const c = cfg();
      const savePath = await addMagnetRouted(c, kind, magnet, "nur-grab,manual");
      return { ok: true, kind, client, savePath };
    } catch (e) {
      return { ok: false, error: String(e.message || e), kind, client };
    }
  }

  async function fromUrl(payload) {
    const url = String(payload?.url || "").trim();
    const autoAdd = payload?.autoAdd !== false;
    const forceKind =
      payload?.kind === "tv" ||
      payload?.kind === "movie" ||
      payload?.kind === "game"
        ? payload.kind
        : null;
    try {
      const resolved = await resolveUrl(url);
      const c = cfg();

      if (resolved.site === "c411" && resolved.torrentId) {
        const dl = await c411.downloadTorrentById(c, resolved.torrentId);
        // Avant : toujours « movie » → une série collée partait dans Films.
        let kind = forceKind || c411.guessKindFromTitle(dl.name || resolved.title || "", null);
        const title = dl.name || resolved.title || null;
        if (dl.magnet && !autoAdd) {
          return { ok: true, added: false, resolved, kind, magnet: dl.magnet, source: "c411-direct" };
        }
        if (dl.magnet) {
          kind = guessKindFromName(dl.magnet, forceKind);
          const savePath = await addMagnetRouted(
            c,
            kind,
            dl.magnet,
            "nur-grab,c411-link"
          );
          return {
            ok: true,
            added: true,
            kind,
            client: clients.clientLabel(kind),
            savePath,
            resolved,
            best: { title: title || resolved.title, score: 0 },
            source: "c411-direct",
          };
        }
        if (autoAdd) {
          const added = await addTorrentBufferRouted(
            c,
            kind,
            dl.buffer,
            dl.fileName || `${resolved.torrentId.slice(0, 12)}.torrent`,
            "nur-grab,c411-link"
          );
          return {
            ok: true,
            added: true,
            kind,
            client: clients.clientLabel(kind),
            savePath: added.savePath,
            ftp: added.ftp,
            resolved,
            best: { title: title || resolved.title, score: 0 },
            source: "c411-direct",
          };
        }
        return { ok: true, added: false, resolved, kind, title, source: "c411-direct" };
      }

      const query = resolved.query || resolved.title;
      if (!query) {
        return {
          ok: false,
          error:
            "Lien C411 sans ID torrent ni recherche — colle un lien torrent ou une recherche",
          resolved,
        };
      }
      const kind = forceKind || resolved.kind || "movie";
      const result = await searchAndMaybeAdd({
        query,
        kind,
        autoAdd,
        imdbId: resolved.imdbId,
        tmdbId: resolved.tmdbId,
        preferC411: true,
      });
      return {
        ...result,
        resolved: {
          title: resolved.title,
          year: resolved.year,
          kind,
          site: resolved.site,
          imdbId: resolved.imdbId,
          tmdbId: resolved.tmdbId,
          torrentId: resolved.torrentId,
          query: resolved.query || query,
          url: resolved.url,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  async function ftpList(payload) {
    try {
      const remotePath = payload?.path || "/media";
      return await ftp.listDir(cfg(), remotePath);
    } catch (e) {
      return { ok: false, error: String(e.message || e), items: [] };
    }
  }

  async function addTorrentBuffer(kind, buffer, fileName) {
    const k = normalizeKind(kind);
    const client = clients.clientLabel(k);
    const c = cfg();
    const result = await addTorrentBufferRouted(
      c,
      k,
      buffer,
      fileName || `nur-grab-${Date.now()}.torrent`,
      "nur-grab,file"
    );
    return {
      ok: true,
      kind: k,
      client,
      savePath: result.savePath,
      ftp: result.ftp,
      apiOk: result.apiOk,
    };
  }

  return {
    cfg,
    status,
    list,
    searchBest,
    /** Exposé pour tests dry-run (jamais autoAdd côté API publique). */
    searchAndMaybeAdd,
    confirmAdd,
    confirmAddMany,
    browseSection,
    browseSections: () => ({ ok: true, sections: c411.listBrowseSections() }),
    addMagnet,
    fromUrl,
    ftpList,
    addTorrentBuffer,
    guessKindFromName,
    ensureQbit,
    ensureTx,
  };
}

function defaultConfigPath() {
  return path.join(__dirname, "..", "config.json");
}

function ensureMobileToken(configPath) {
  const p = configPath || defaultConfigPath();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    throw new Error("config.json introuvable: " + p);
  }
  let changed = false;
  if (!raw.mobileToken || raw.mobileToken === "CHANGE_ME") {
    const crypto = require("crypto");
    raw.mobileToken = crypto.randomBytes(16).toString("hex");
    changed = true;
  }
  if (!raw.mobilePin) {
    // Short PIN for phone typing (also accepts full mobileToken)
    raw.mobilePin = "384750";
    changed = true;
  }
  if (!raw.mobilePort) {
    raw.mobilePort = 3850;
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(p, JSON.stringify(raw, null, 2) + "\n", "utf8");
  }
  return {
    token: raw.mobileToken,
    pin: String(raw.mobilePin),
    port: Number(raw.mobilePort) || 3850,
  };
}

module.exports = {
  createGrabService,
  defaultConfigPath,
  ensureMobileToken,
};
