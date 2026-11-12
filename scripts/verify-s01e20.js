const ftp = require("basic-ftp");
const https = require("https");

const DEST =
  "/media/TV Shows/Victorious.iNTEGRALE.CUSTOM.MULTI.VFF.720p.WEBRip.AAC.2.0.x265-QC/Season 01";

function req(method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL("https://ryan.joker.usbx.me/jellyfin" + path);
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

(async () => {
  const c = new ftp.Client(60000);
  await c.access({
    host: "joker.usbx.me",
    port: 21,
    user: "ryan",
    password: "Assaut_05",
    secure: true,
    secureOptions: { rejectUnauthorized: false },
  });
  await c.cd(DEST);
  const files = await c.list();
  const vids = files.filter((f) => /\.(mkv|mp4)$/i.test(f.name));
  console.log("Season 01 files:", vids.length);
  vids
    .map((f) => f.name)
    .sort()
    .forEach((n) => console.log(" ", n));
  c.close();

  const auth =
    'MediaBrowser Client="NurGrab", Device="PC", DeviceId="x", Version="1"';
  const login = await req(
    "POST",
    "/Users/authenticatebyname",
    { Username: "ryan", Pw: "Assaut_05" },
    { "X-Emby-Authorization": auth }
  );
  const j = JSON.parse(login.b);
  const h = {
    "X-Emby-Token": j.AccessToken,
    "X-Emby-Authorization": auth + `, Token="${j.AccessToken}"`,
  };
  const sid = "2d3dda677aa88bb11f6f2640c4f6fb54";
  await req(
    "POST",
    `/Items/${sid}/Refresh?Recursive=true&MetadataRefreshMode=FullRefresh&ReplaceAllMetadata=true`,
    {},
    h
  );
  await req("POST", "/Library/Refresh", {}, h);
  await new Promise((r) => setTimeout(r, 8000));

  const eps = JSON.parse(
    (
      await req(
        "GET",
        `/Shows/${sid}/Episodes?season=1&userId=${j.User.Id}&Fields=Path`,
        null,
        h
      )
    ).b
  ).Items;
  console.log("\nJellyfin S1:", eps.length);
  eps
    .sort((a, b) => (a.IndexNumber || 0) - (b.IndexNumber || 0))
    .forEach((e) =>
      console.log(
        "E" + String(e.IndexNumber ?? "?").padStart(2, "0"),
        e.Name,
        "|",
        (e.Path || "").split("/").pop()
      )
    );

  // search for S01E20 filename in library
  const search = JSON.parse(
    (
      await req(
        "GET",
        `/Users/${j.User.Id}/Items?searchTerm=S01E20&Recursive=true&Fields=Path`,
        null,
        h
      )
    ).b
  ).Items;
  console.log("\nSearch S01E20 hits:", search.length);
  search.forEach((i) => console.log(i.Type, i.Name, i.Path));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
