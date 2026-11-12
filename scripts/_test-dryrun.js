/**
 * Tests dry-run Grab : search film + série, JAMAIS add qBit / Jellyfin.
 */
const path = require("path");
const { createGrabService } = require("../lib/grab-service");

const configPath = path.join(__dirname, "..", "config.json");
const grab = createGrabService(configPath);

(async () => {
  const tests = [
    { query: "Dune Part Two", kind: "movie", seriesMode: "auto" },
    { query: "The Boys", kind: "tv", seriesMode: "list" },
    { query: "The Boys", kind: "tv", seriesMode: "auto" },
  ];
  for (const t of tests) {
    process.stdout.write(
      `\n=== ${t.kind} « ${t.query} » mode=${t.seriesMode} ===\n`,
    );
    try {
      const r = await grab.searchAndMaybeAdd({
        ...t,
        autoAdd: false,
        dryRun: true,
      });
      const preview = (r.preview || []).slice(0, 3).map((p) => ({
        title: String(p.title || "").slice(0, 72),
        reco: !!p.reco,
        size: p.sizeHuman || p.size,
        indexer: p.indexer || p.site,
      }));
      console.log(
        JSON.stringify(
          {
            ok: r.ok !== false,
            cached: !!r.cached,
            dryRun: !!r.dryRun,
            source: r.source,
            totalRaw: r.totalRaw,
            totalFr: r.totalFr ?? (r.preview || []).length,
            preview,
            seriesPlan: r.seriesPlan
              ? {
                  mode: r.seriesPlan.mode,
                  pickCount: r.seriesPlan.pickCount,
                  reason: r.seriesPlan.reason,
                }
              : null,
            error: r.error || null,
          },
          null,
          2,
        ),
      );
    } catch (e) {
      console.log("FAIL", e.message || e);
    }
  }
  console.log("\nDone — aucun torrent ajouté (dryRun / autoAdd:false).");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
