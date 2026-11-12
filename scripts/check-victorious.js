const ftp = require("basic-ftp");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function main() {
  const c = new ftp.Client(120000);
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
    try {
      await c.cd(p);
      return await c.list();
    } catch (e) {
      console.log("fail list", p, e.message.split("\n")[0]);
      return [];
    }
  }

  async function walk(p, depth, acc) {
    if (depth > 5) return acc;
    const L = await list(p);
    for (const x of L) {
      const full = p.replace(/\/$/, "") + "/" + x.name;
      if (x.isDirectory) {
        if (depth <= 2) console.log("DIR", full);
        await walk(full, depth + 1, acc);
      } else {
        acc.push({ path: full, size: x.size || 0, name: x.name });
      }
    }
    return acc;
  }

  const bases = [
    "/media/TV Shows/Victorious.iNTEGRALE.CUSTOM.MULTI.VFF.720p.WEBRip.AAC.2.0.x265-QC",
    "/media/TV Shows/Victorious.INTEGRALE.MULTI.VFF.1080p.WEB.AAC.2.0.x264-LILOW",
  ];

  for (const base of bases) {
    console.log("\n========", base, "========");
    const files = await walk(base, 0, []);
    console.log("TOTAL FILES", files.length);
    const byExt = {};
    for (const f of files) {
      const m = f.name.match(/\.(\w+)$/);
      const ext = m ? m[1].toLowerCase() : "none";
      byExt[ext] = (byExt[ext] || 0) + 1;
    }
    console.log("byExt", byExt);

    const video = files.filter((f) =>
      /\.(mkv|mp4|avi|m4v|ts|m2ts)$/i.test(f.name)
    );
    console.log("videos", video.length);

    // group by parent folder
    const groups = {};
    for (const f of video) {
      const parent = f.path.split("/").slice(-2, -1)[0];
      groups[parent] = groups[parent] || [];
      groups[parent].push(f.name);
    }
    for (const [k, v] of Object.entries(groups)) {
      console.log("---", k, v.length);
      v.sort().forEach((n) => console.log(" ", n));
    }
  }

  // Jellyfin API key from users
  const tmp = path.join(os.tmpdir(), "jf-vic");
  fs.mkdirSync(tmp, { recursive: true });
  const users = await list("/.apps/jellyfin/users");
  console.log(
    "\njellyfin users dirs",
    users.map((u) => u.name).join(", ")
  );

  c.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
