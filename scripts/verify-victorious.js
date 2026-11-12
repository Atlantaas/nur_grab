const ftp = require("basic-ftp");

const ROOT =
  "/media/TV Shows/Victorious.iNTEGRALE.CUSTOM.MULTI.VFF.720p.WEBRip.AAC.2.0.x265-QC";

async function main() {
  const c = new ftp.Client(60000);
  await c.access({
    host: "joker.usbx.me",
    port: 21,
    user: "ryan",
    password: "Assaut_05",
    secure: true,
    secureOptions: { rejectUnauthorized: false },
  });
  await c.cd(ROOT);
  const top = await c.list();
  console.log(
    "TOP:",
    top.map((x) => x.name + (x.isDirectory ? "/" : "")).join(" | ")
  );
  for (const season of ["Season 01", "Season 02", "Season 03", "Season 04", "Season 00"]) {
    try {
      await c.cd(ROOT + "/" + season);
      const files = (await c.list()).filter((f) => !f.isDirectory && /\.mkv$/i.test(f.name));
      console.log(season + ":", files.length, "mkv");
      files
        .map((f) => f.name)
        .sort()
        .forEach((n) => console.log(" ", n));
    } catch (e) {
      console.log(season, "MISSING", e.message.split("\n")[0]);
    }
  }
  c.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
