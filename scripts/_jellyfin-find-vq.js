const https = require("https");
const BASE = "https://ryan.joker.usbx.me/jellyfin";
const authHeader =
  'MediaBrowser Client="NurGrab", Device="PC", DeviceId="nur-vq2", Version="1.0.0"';

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const data = body != null ? JSON.stringify(body) : null;
    const req = https.request(
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
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  const auth = await request(
    "POST",
    "/Users/authenticatebyname",
    { Username: "ryan", Pw: "Assaut_05" },
    { "X-Emby-Authorization": authHeader },
  );
  const j = JSON.parse(auth.body);
  const token = j.AccessToken;
  const userId = j.User.Id;
  const h = {
    "X-Emby-Token": token,
    "X-Emby-Authorization": `${authHeader}, Token="${token}"`,
  };

  const libs = await request("GET", "/Library/VirtualFolders", null, h);
  console.log("libs", libs.status);
  for (const L of JSON.parse(libs.body) || []) {
    console.log(
      "LIB",
      L.Name,
      L.CollectionType,
      L.ItemId,
      (L.Locations || []).join("|"),
    );
  }

  for (const term of ["Vision", "VisionQuest", "Sans attaches", "Thésée"]) {
    const s = await request(
      "GET",
      `/Users/${userId}/Items?searchTerm=${encodeURIComponent(term)}&Recursive=true&IncludeItemTypes=Series,Episode,Movie,Folder`,
      null,
      h,
    );
    const items = JSON.parse(s.body).Items || [];
    console.log(`\nsearch "${term}" => ${items.length}`);
    for (const it of items.slice(0, 12)) {
      console.log(
        " ",
        it.Type,
        it.Name,
        it.Id,
        it.Path || it.ContainingFolderPath || "",
      );
    }
  }

  // Force scan of TV Shows library if found
  const folders = JSON.parse(libs.body) || [];
  const tv = folders.find(
    (f) =>
      /tv|series|shows/i.test(f.Name || "") ||
      f.CollectionType === "tvshows",
  );
  if (tv) {
    console.log("\nRefresh library", tv.Name, tv.ItemId);
    const r = await request(
      "POST",
      `/Items/${tv.ItemId}/Refresh?Recursive=true&MetadataRefreshMode=FullRefresh&ImageRefreshMode=Default&ReplaceAllMetadata=false`,
      {},
      h,
    );
    console.log("refresh tv lib", r.status);
  }

  console.log("USERID", userId);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
