/** JSON disk quota Ultra — consommé par Sanctuary hub. */
const { Client } = require("ssh2");
const cfg = require("../config.json");

function parseQuota(out) {
  // Disk quotas for user ryan … /dev/sdl1   3440G   3725G   3725G
  const m = String(out).match(
    /\/dev\/\S+\s+(\d+(?:\.\d+)?)([KMGT]?)\s+(\d+(?:\.\d+)?)([KMGT]?)\s+(\d+(?:\.\d+)?)([KMGT]?)/i,
  );
  if (!m) return null;
  const toGb = (n, u) => {
    const v = Number(n);
    const unit = (u || "G").toUpperCase();
    if (unit === "T") return v * 1024;
    if (unit === "M") return v / 1024;
    if (unit === "K") return v / (1024 * 1024);
    return v;
  };
  const usedGb = toGb(m[1], m[2]);
  const quotaGb = toGb(m[3], m[4]);
  const freeGb = Math.max(0, quotaGb - usedGb);
  return {
    usedGb: Math.round(usedGb * 10) / 10,
    quotaGb: Math.round(quotaGb * 10) / 10,
    freeGb: Math.round(freeGb * 10) / 10,
    usedPct: quotaGb > 0 ? Math.round((usedGb / quotaGb) * 1000) / 10 : null,
  };
}

(async () => {
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on("ready", resolve);
    conn.on("error", reject);
    conn.connect({
      host: cfg.ftpHost,
      port: 22,
      username: cfg.ftpUser,
      password: cfg.ftpPass,
      readyTimeout: 20000,
    });
  });
  const out = await new Promise((resolve, reject) => {
    let buf = "";
    conn.exec(
      "quota -s 2>/dev/null; echo ----; df -h /home/ryan 2>/dev/null | tail -1; echo ----; du -sh /home/ryan/media 2>/dev/null",
      (err, stream) => {
        if (err) return reject(err);
        stream.on("data", (d) => {
          buf += d.toString();
        });
        stream.stderr.on("data", (d) => {
          buf += d.toString();
        });
        stream.on("close", () => resolve(buf));
      },
    );
  });
  conn.end();
  const parts = out.split("----").map((s) => s.trim());
  const quota = parseQuota(parts[0] || "");
  const dfLine = (parts[1] || "").split(/\s+/);
  // Filesystem Size Used Avail Use% Mounted
  const df =
    dfLine.length >= 5
      ? {
          size: dfLine[1],
          used: dfLine[2],
          avail: dfLine[3],
          usePct: dfLine[4],
        }
      : null;
  const media = (parts[2] || "").split(/\s+/)[0] || null;
  const result = {
    ok: !!quota,
    host: cfg.ftpHost,
    quota,
    df,
    mediaUsed: media,
    fetchedAt: new Date().toISOString(),
    consoleUrl: "https://cp.ultra.cc/",
  };
  process.stdout.write(JSON.stringify(result));
})().catch((e) => {
  process.stdout.write(
    JSON.stringify({ ok: false, error: String(e.message || e) }),
  );
  process.exit(1);
});
