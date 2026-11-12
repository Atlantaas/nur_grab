const https = require("https");
const ftp = require("basic-ftp");
const BASE = "https://ryan.joker.usbx.me/jellyfin";
const auth =
  'MediaBrowser Client="NurGrab", Device="PC", DeviceId="nur-grab-vic", Version="1.0.0"';
const ROOT =
  "/media/TV Shows/Victorious.iNTEGRALE.CUSTOM.MULTI.VFF.720p.WEBRip.AAC.2.0.x265-QC";

function req(method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const data = body != null ? JSON.stringify(body) : null;
    const r = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
          ...headers,
        },
      },
      (resp) => {
        const d = [];
        resp.on("data", (c) => d.push(c));
        resp.on("end", () =>
          resolve({ s: resp.statusCode, b: Buffer.concat(d).toString() })
        );
      }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

async function emptyOldDirs() {
  // Only remove EMPTY leftover dirs — never touch media files
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
  for (const e of top) {
    if (!e.isDirectory) continue;
    if (/^Season /i.test(e.name)) continue;
    const p = ROOT + "/" + e.name;
    await c.cd(p);
    const kids = await c.list();
    const files = kids.filter((k) => !k.isDirectory);
    const dirs = kids.filter((k) => k.isDirectory);
    console.log("old dir", e.name, "files", files.length, "dirs", dirs.length);
    if (files.length === 0 && dirs.length === 0) {
      try {
        await c.removeDir(p);
        console.log("removed empty", e.name);
      } catch (err) {
        console.log("cannot remove", e.name, err.message.split("\n")[0]);
      }
    }
  }
  c.close();
}

(async () => {
  await emptyOldDirs();

  const login = await req(
    "POST",
    "/Users/authenticatebyname",
    { Username: "ryan", Pw: "Assaut_05" },
    { "X-Emby-Authorization": auth }
  );
  const j = JSON.parse(login.b);
  const token = j.AccessToken;
  const uid = j.User.Id;
  const h = {
    "X-Emby-Token": token,
    "X-Emby-Authorization": auth + `, Token="${token}"`,
  };
  const sid = "2d3dda677aa88bb11f6f2640c4f6fb54";

  // Full metadata replace (files untouched)
  const ref = await req(
    "POST",
    `/Items/${sid}/Refresh?Recursive=true&MetadataRefreshMode=FullRefresh&ReplaceAllMetadata=true&ImageRefreshMode=FullRefresh&ReplaceAllImages=false`,
    {},
    h
  );
  console.log("full refresh", ref.s);
  await req("POST", "/Library/Refresh", {}, h);
  console.log("waiting 8s…");
  await new Promise((r) => setTimeout(r, 8000));

  for (const sn of [0, 1, 2, 3, 4]) {
    const eps = await req(
      "GET",
      `/Shows/${sid}/Episodes?season=${sn}&userId=${uid}&Fields=Path,IndexNumber`,
      null,
      h
    );
    const items = (JSON.parse(eps.b).Items || []).sort(
      (a, b) => (a.IndexNumber || 0) - (b.IndexNumber || 0)
    );
    console.log("\n=== S" + sn + " (" + items.length + ") ===");
    items.forEach((e) => {
      console.log(
        "E" + String(e.IndexNumber ?? "?").padStart(2, "0"),
        e.Name,
        "|",
        (e.Path || "").split("/").pop()
      );
    });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
