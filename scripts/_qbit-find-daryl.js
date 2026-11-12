const cfg = require("../config.json");
const clients = require("../lib/clients");

(async () => {
  const jar = await clients.qbitLogin(cfg);
  const list = await clients.qbitList(cfg, jar);
  const items = Array.isArray(list) ? list : list?.torrents || list || [];
  console.log("torrents", items.length);
  for (const t of items) {
    const name = t.name || t.dlspeed || "";
    const n = String(t.name || "");
    if (/daryl|dixon/i.test(n) || /daryl|dixon/i.test(String(t.save_path || ""))) {
      console.log({
        name: t.name,
        state: t.state,
        progress: t.progress,
        save_path: t.save_path,
        content_path: t.content_path,
        hash: t.hash,
        size: t.size,
      });
    }
  }
  // also print any missing files torrents
  const missing = items.filter(
    (t) =>
      /daryl|dixon/i.test(String(t.name || "")) ||
      String(t.state || "").includes("missing"),
  );
  console.log("daryl matches", missing.length);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
