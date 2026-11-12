/** Search dry-run via Ultra public API — jamais autoAdd. */
const https = require("https");
const cfg = require("../config.json");

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: "ryan.joker.usbx.me",
        path: `/grab${path}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          "X-Nur-Token": cfg.mobileToken,
        },
        timeout: 90000,
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode, raw: raw.slice(0, 300) });
          }
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  for (const t of [
    { query: "Dune", kind: "movie", seriesMode: "auto", autoAdd: false },
    { query: "The Boys", kind: "tv", seriesMode: "list", autoAdd: false },
  ]) {
    console.log(`\n=== Ultra ${t.kind} « ${t.query} » ===`);
    const r = await post("/api/search", t);
    const j = r.json || {};
    console.log({
      http: r.status,
      ok: j.ok,
      source: j.source,
      totalRaw: j.totalRaw,
      preview: (j.preview || []).slice(0, 2).map((p) =>
        String(p.title || "").slice(0, 60),
      ),
      error: j.error || null,
    });
  }
  console.log("\nOK — aucun add (autoAdd:false).");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
