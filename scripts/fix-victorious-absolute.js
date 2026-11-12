/**
 * Victorious → Absolute / DVD (3 seasons):
 *   S01 = Official S01 (E01…)
 *   S02 = Official S02
 *   S03 = Official S03 + Official S04 (S04E01 → S03E13, …)
 * NEVER deletes media — rename/move only.
 */
const ftp = require("basic-ftp");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT =
  "/media/TV Shows/Victorious.iNTEGRALE.CUSTOM.MULTI.VFF.720p.WEBRip.AAC.2.0.x265-QC";

const DRY = process.argv.includes("--dry");

function pad(n) {
  return String(n).padStart(2, "0");
}

function safeName(s) {
  return String(s)
    .replace(/[<>:"|?*]/g, "")
    .replace(/\s+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.+|\.+$/g, "");
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

  async function ensureDir(p) {
    await c.ensureDir(p);
  }

  async function renameRemote(from, to) {
    if (DRY) {
      console.log("DRY rename:", from, "→", to);
      return;
    }
    // basic-ftp rename is relative to cwd — use absolute via RNFR/RNTO
    await c.rename(from, to);
    console.log("OK", path.posix.basename(from), "→", path.posix.basename(to));
  }

  // Discover season folders
  const top = await list(ROOT);
  const seasonDirs = {};
  for (const e of top) {
    if (!e.isDirectory) continue;
    const m = e.name.match(/\.S0(\d)\./i) || e.name.match(/^S0(\d)$/i);
    if (m) seasonDirs[Number(m[1])] = ROOT + "/" + e.name;
    if (/extra/i.test(e.name)) seasonDirs.extra = ROOT + "/" + e.name;
  }
  console.log("Found:", seasonDirs);
  if (!seasonDirs[1] || !seasonDirs[2] || !seasonDirs[3] || !seasonDirs[4]) {
    throw new Error("Missing S01–S04 folders — abort");
  }

  const target = {
    1: ROOT + "/Season 01",
    2: ROOT + "/Season 02",
    3: ROOT + "/Season 03",
    0: ROOT + "/Season 00",
  };

  for (const p of Object.values(target)) {
    await ensureDir(p);
  }

  const plan = [];

  // --- S01: files like "101 Victorious ....mkv" or already S01Exx
  {
    const files = (await list(seasonDirs[1])).filter((f) => !f.isDirectory);
    let ep = 0;
    const sorted = files.slice().sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const f of sorted) {
      if (!/\.mkv$/i.test(f.name)) continue;
      const se = f.name.match(/S01E(\d{2})/i);
      const num = f.name.match(/^(\d{3})\b/);
      let n;
      if (se) n = Number(se[1]);
      else if (num) n = Number(num[1]) % 100; // 101 → 1
      else n = ++ep;
      if (!se && !num) {
        /* sequential fallback already set */
      } else {
        ep = Math.max(ep, n);
      }
      const dest =
        target[1] +
        "/Victorious.S01E" +
        pad(n) +
        ".MULTI.VFF.720p.WEBRip.x265-QC.mkv";
      plan.push({
        from: seasonDirs[1] + "/" + f.name,
        to: dest,
        tag: "S01E" + pad(n),
      });
    }
  }

  // --- S02: already mostly S02Exx
  {
    const files = (await list(seasonDirs[2])).filter((f) => !f.isDirectory);
    for (const f of files) {
      if (!/\.mkv$/i.test(f.name)) continue;
      const se = f.name.match(/S02E(\d{2})/i);
      if (!se) {
        console.warn("S02 skip (no S02Exx):", f.name);
        continue;
      }
      const dest =
        target[2] +
        "/Victorious.S02E" +
        se[1] +
        ".MULTI.VFF.720p.WEBRip.x265-QC.mkv";
      plan.push({
        from: seasonDirs[2] + "/" + f.name,
        to: dest,
        tag: "S02E" + se[1],
      });
    }
  }

  // --- S03 official → Absolute S03E01–E12
  {
    const files = (await list(seasonDirs[3])).filter((f) => !f.isDirectory);
    for (const f of files) {
      if (!/\.mkv$/i.test(f.name)) continue;
      const se = f.name.match(/S03E(\d{2})/i);
      if (!se) {
        console.warn("S03 skip:", f.name);
        continue;
      }
      const dest =
        target[3] +
        "/Victorious.S03E" +
        se[1] +
        ".MULTI.VFF.720p.WEBRip.x265-QC.mkv";
      plan.push({
        from: seasonDirs[3] + "/" + f.name,
        to: dest,
        tag: "S03E" + se[1],
      });
    }
  }

  // --- S04 official → Absolute S03E13–E25
  {
    const files = (await list(seasonDirs[4])).filter((f) => !f.isDirectory);
    const sorted = files.slice().sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const f of sorted) {
      if (!/\.mkv$/i.test(f.name)) continue;
      const se = f.name.match(/S04E(\d{2})/i);
      const num = f.name.match(/^(\d{3})\b/);
      let offEp;
      if (se) offEp = Number(se[1]);
      else if (num) offEp = Number(num[1]) % 100; // 401 → 1
      else {
        console.warn("S04 skip:", f.name);
        continue;
      }
      const absEp = 12 + offEp; // S04E01 → S03E13
      const dest =
        target[3] +
        "/Victorious.S03E" +
        pad(absEp) +
        ".MULTI.VFF.720p.WEBRip.x265-QC.mkv";
      plan.push({
        from: seasonDirs[4] + "/" + f.name,
        to: dest,
        tag: "S03E" + pad(absEp) + " (was S04E" + pad(offEp) + ")",
      });
    }
  }

  // --- Extras → Season 00
  if (seasonDirs.extra) {
    const files = (await list(seasonDirs.extra)).filter((f) => !f.isDirectory);
    let i = 1;
    for (const f of files) {
      if (!/\.mkv$/i.test(f.name)) continue;
      const dest =
        target[0] +
        "/Victorious.S00E" +
        pad(i) +
        "." +
        safeName(f.name.replace(/\.mkv$/i, "")) +
        ".mkv";
      plan.push({
        from: seasonDirs.extra + "/" + f.name,
        to: dest,
        tag: "S00E" + pad(i),
      });
      i++;
    }
  }

  console.log("\nPLAN", plan.length, "moves");
  plan.forEach((p) => console.log(p.tag, "←", path.posix.basename(p.from)));

  // Counts check
  const c1 = plan.filter((p) => p.tag.startsWith("S01")).length;
  const c2 = plan.filter((p) => p.tag.startsWith("S02")).length;
  const c3 = plan.filter((p) => /^S03E/.test(p.tag)).length;
  const c0 = plan.filter((p) => p.tag.startsWith("S00")).length;
  console.log("\nCounts S01/S02/S03/S00:", c1, c2, c3, c0);
  console.log("Absolute S3 expected ~25 (12+13); got", c3);

  if (DRY) {
    console.log("\nDRY RUN — no changes. Re-run without --dry to apply.");
    c.close();
    return;
  }

  // Execute renames (ftp rename needs paths relative or absolute depending on server)
  for (const p of plan) {
    try {
      // Prefer rename within same FS
      await c.rename(p.from, p.to);
      console.log("OK", p.tag);
    } catch (e) {
      // fallback: download+upload would be huge — try cd tricks
      console.error("FAIL", p.tag, e.message.split("\n")[0]);
      // try RNFR with cwd /
      try {
        await c.cd("/");
        await c.rename(p.from, p.to);
        console.log("OK2", p.tag);
      } catch (e2) {
        console.error("FAIL2", p.tag, e2.message.split("\n")[0]);
      }
    }
  }

  // Write a marker nfo for jellyfin
  const nfo = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<tvshow>
  <title>Victorious</title>
  <plot>Absolute / DVD order — 3 seasons (S03 merges Official S03+S04).</plot>
</tvshow>
`;
  const tmp = path.join(os.tmpdir(), "victorious-tvshow.nfo");
  fs.writeFileSync(tmp, nfo, "utf8");
  try {
    await c.uploadFrom(tmp, ROOT + "/tvshow.nfo");
    console.log("Uploaded tvshow.nfo");
  } catch (e) {
    console.warn("nfo upload:", e.message.split("\n")[0]);
  }

  c.close();
  console.log("\nDONE. Next: Jellyfin refresh + DisplayOrder=Absolute");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
