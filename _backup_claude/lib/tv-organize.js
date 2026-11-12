/**
 * Regroupe les packs saison à la racine TV Shows en :
 *   Series Name/Season XX/*.mkv
 * pour que Jellyfin voie UNE série (pas 1 série par pack).
 */
const path = require("path");
const { parseSeasonInfo } = require("./clients");

const SCENE_TAGS =
  /\b(multi|vff|vf2|vostfr|webrip|web-dl|bluray|hdtv|x265|x264|hevc|avc|eac3|ddp|dts|aac|pmtp|proper|repack|internal|amzn|nf|hulu|dsnp|hdtv|10bit|4klight|hdr|dv|remux|1080p|720p|2160p|uhd|bdrip|hdrip)\b/gi;

function cleanSeriesName(folderName) {
  let n = String(folderName || "");
  // Coupe avant S01 / Saison 1
  n = n.replace(/[\s._-]*[Ss](\d{1,2})(?:[\s._-]*[Ee]\d{1,3})?[\s._-]*.*$/, "");
  n = n.replace(/[\s._-]*[Ss]aison[\s._-]*\d{1,2}[\s._-]*.*$/i, "");
  n = n.replace(/[\s._-]*Season[\s._-]*\d{1,2}[\s._-]*.*$/i, "");
  n = n.replace(SCENE_TAGS, " ");
  n = n.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  // "The Walking Dead Daryl Dixon" → tirets propres
  n = n.replace(/\s+-\s+/g, " - ").replace(/\s{2,}/g, " ").trim();
  return n || folderName;
}

function seasonDir(n) {
  return `Season ${String(n).padStart(2, "0")}`;
}

/**
 * @param {string[]} topLevelDirs noms de dossiers (basename) sous TV Shows
 * @returns {{ series: string, season: number, folder: string }[]}
 */
function planMoves(topLevelDirs) {
  const out = [];
  for (const folder of topLevelDirs) {
    // Déjà organisé : "Something / Season 01" n'apparaît pas ici (top-level only)
    if (/^Season\s*\d+/i.test(folder)) continue;
    const info = parseSeasonInfo(folder);
    // Pack saison (S01 sans E) ou dossier release Sxx — pas intégrale S01-SXX seule sans numéro clair
    if (info.season == null) continue;
    if (info.episode != null) continue; // épisode isolé à la racine = autre cas
    // Ignore "Show Name" sans tag saison (déjà une vraie série)
    if (
      !/\b[Ss]\d{1,2}\b/.test(folder) &&
      !/\b(saison|season)\s*\d/i.test(folder)
    ) {
      continue;
    }
    const series = cleanSeriesName(folder);
    if (!series || series.length < 2) continue;
    // Si le dossier EST déjà "Series Name" sans release junk, skip
    if (series === folder.replace(/[._]/g, " ").trim() && !/\bS\d{2}\b/i.test(folder)) {
      continue;
    }
    out.push({
      series,
      season: info.season,
      folder,
      destSeason: seasonDir(info.season),
    });
  }
  return out;
}

/** Script shell remote pour appliquer un plan (paths absolus). */
function buildShellScript(tvRoot, moves) {
  const lines = ["set -e", `TV=${shellQuote(tvRoot)}`];
  for (const m of moves) {
    const from = `${tvRoot}/${m.folder}`;
    const seriesDir = `${tvRoot}/${m.series}`;
    const dest = `${seriesDir}/${m.destSeason}`;
    lines.push(`# ${m.folder} → ${m.series}/${m.destSeason}`);
    lines.push(`mkdir -p ${shellQuote(dest)}`);
    lines.push(
      `if [ -d ${shellQuote(from)} ]; then ` +
        `find ${shellQuote(from)} -maxdepth 1 -type f \\( -iname '*.mkv' -o -iname '*.mp4' -o -iname '*.avi' -o -iname '*.m4v' \\) -exec mv -n {} ${shellQuote(dest)}/ \\; ; ` +
        // sous-dossiers éventuels
        `find ${shellQuote(from)} -mindepth 2 -type f \\( -iname '*.mkv' -o -iname '*.mp4' \\) -exec mv -n {} ${shellQuote(dest)}/ \\; ; ` +
        `rmdir ${shellQuote(from)} 2>/dev/null || rm -rf ${shellQuote(from)}; ` +
        `echo OK ${shellQuote(m.destSeason)}; ` +
        `else echo SKIP missing; fi`,
    );
  }
  return lines.join("\n");
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

module.exports = {
  cleanSeriesName,
  seasonDir,
  planMoves,
  buildShellScript,
  parseSeasonInfo,
};
