/**
 * Victorious — Official 4 seasons.
 * Fix broken names (101… / 401…) → SxxExx. Never delete media.
 */
const ftp = require("basic-ftp");
const path = require("path");

const ROOT =
  "/media/TV Shows/Victorious.iNTEGRALE.CUSTOM.MULTI.VFF.720p.WEBRip.AAC.2.0.x265-QC";
const DRY = process.argv.includes("--dry");

function pad(n) {
  return String(n).padStart(2, "0");
}

async function main() {
  const c = new ftp.Client(180000);
  c.ftp.verbose = false;
  await c.access({
    host: "joker.usbx.me",
    port: 21,
    user: "ryan",
    password: "Assaut_05",
    secure: true,
    secureOptions: { rejectUnauthorized: false },
  });

  async function list(p) {
    await c.cd(p);
    return c.list();
  }

  const top = await list(ROOT);
  const seasonDirs = {};
  for (const e of top) {
    if (!e.isDirectory) continue;
    const m = e.name.match(/\.S0(\d)\./i);
    if (m) seasonDirs[Number(m[1])] = ROOT + "/" + e.name;
    if (/extra/i.test(e.name)) seasonDirs.extra = ROOT + "/" + e.name;
  }
  console.log("Found seasons", Object.keys(seasonDirs));

  const targets = {
    1: ROOT + "/Season 01",
    2: ROOT + "/Season 02",
    3: ROOT + "/Season 03",
    4: ROOT + "/Season 04",
    0: ROOT + "/Season 00",
  };
  for (const p of Object.values(targets)) {
    if (!DRY) await c.ensureDir(p);
    else console.log("DRY ensure", p);
  }

  const plan = [];

  function addPlan(fromDir, season, files) {
    const sorted = files
      .filter((f) => !f.isDirectory && /\.mkv$/i.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, "en"));

    for (const f of sorted) {
      let ep = null;
      const se = f.name.match(new RegExp(`S0?${season}E(\\d{2})`, "i"));
      const triple = f.name.match(/^(\d{3})\b/);
      if (se) ep = Number(se[1]);
      else if (triple) {
        const n = Number(triple[1]);
        // 101 → S01E01, 401 → S04E01
        if (Math.floor(n / 100) === season) ep = n % 100;
      }
      if (!ep) {
        console.warn("SKIP (no ep#):", f.name);
        continue;
      }
      const dest =
        targets[season] +
        `/Victorious.S${pad(season)}E${pad(ep)}.MULTI.VFF.720p.WEBRip.x265-QC.mkv`;
      plan.push({
        from: fromDir + "/" + f.name,
        to: dest,
        tag: `S${pad(season)}E${pad(ep)}`,
      });
    }
  }

  for (const season of [1, 2, 3, 4]) {
    if (!seasonDirs[season]) throw new Error("Missing season " + season);
    const files = await list(seasonDirs[season]);
    addPlan(seasonDirs[season], season, files);
  }

  if (seasonDirs.extra) {
    const files = (await list(seasonDirs.extra)).filter(
      (f) => !f.isDirectory && /\.mkv$/i.test(f.name)
    );
    let i = 1;
    for (const f of files.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const dest =
        targets[0] +
        `/Victorious.S00E${pad(i)}.SPECIAL.mkv`;
      plan.push({
        from: seasonDirs.extra + "/" + f.name,
        to: dest,
        tag: `S00E${pad(i)}`,
      });
      i++;
    }
  }

  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 0: 0 };
  for (const p of plan) {
    const m = p.tag.match(/S(\d{2})/);
    counts[Number(m[1])]++;
    console.log(p.tag, "←", path.posix.basename(p.from));
  }
  console.log("\nCounts Official:", counts);
  console.log("Expected ~ S01:20 S02:13 S03:12 S04:13 (S01 may be 19 in this pack)");

  if (DRY) {
    console.log("\nDRY — no changes");
    c.close();
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const p of plan) {
    try {
      await c.cd("/");
      await c.rename(p.from, p.to);
      console.log("OK", p.tag);
      ok++;
    } catch (e) {
      console.error("FAIL", p.tag, e.message.split("\n")[0]);
      fail++;
    }
  }
  console.log("\nDone OK", ok, "FAIL", fail);
  c.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
