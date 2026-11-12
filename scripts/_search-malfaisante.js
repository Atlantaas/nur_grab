const cfg = require("../config.json");
const { createGrabService } = require("../lib/grab-service");
const { searchBest } = createGrabService(cfg);

(async () => {
  for (const q of [
    "Malfaisante",
    "Malfaisante 2026",
    "Other Mommy",
    "Other Mommy 2026",
    "Other.Mommy",
  ]) {
    console.log("\n===", q, "===");
    try {
      const r = await searchBest({
        query: q,
        kind: "movie",
        limit: 15,
        dryRun: true,
      });
      console.log(
        "ok",
        r.ok,
        "totalRaw",
        r.totalRaw,
        "totalFr",
        r.totalFr,
        "source",
        r.source,
        "err",
        r.error || "",
      );
      for (const p of (r.preview || []).slice(0, 8)) {
        const t = String(p.title || "");
        const hit = /malfaisante|other.?mommy/i.test(t);
        console.log(
          hit ? " HIT" : "  -",
          p.indexer,
          p.seeders,
          "s",
          t.slice(0, 100),
        );
      }
    } catch (e) {
      console.log("ERR", e.message);
    }
  }
})();
