/**
 * Force Jellyfin to notice Series/Season layout — Refresh only, jamais DELETE.
 */
const https = require("https");
const BASE = "https://ryan.joker.usbx.me/jellyfin";
const authHeader =
  'MediaBrowser Client="NurGrab", Device="PC", DeviceId="nur-daryl-scan", Version="1.0.0"';
const SERIES_PATH =
  "/home/ryan/media/TV Shows/The Walking Dead Daryl Dixon";

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
  if (!j.AccessToken) throw new Error("auth failed: " + auth.body.slice(0, 200));
  const h = {
    "X-Emby-Token": j.AccessToken,
    "X-Emby-Authorization": `${authHeader}, Token="${j.AccessToken}"`,
  };
  const userId = j.User.Id;

  // Notify path update (add) then full TV refresh
  const updated = await request(
    "POST",
    "/Library/Media/Updated",
    {
      Updates: [
        { Path: SERIES_PATH, UpdateType: "Created" },
        {
          Path: SERIES_PATH + "/Season 01",
          UpdateType: "Created",
        },
        {
          Path: SERIES_PATH + "/Season 02",
          UpdateType: "Created",
        },
        {
          Path: SERIES_PATH + "/Season 03",
          UpdateType: "Created",
        },
      ],
    },
    h,
  );
  console.log("Media/Updated", updated.status, updated.body.slice(0, 120));

  const libs = JSON.parse(
    (await request("GET", "/Library/VirtualFolders", null, h)).body,
  );
  const tv = (libs || []).find((f) => f.CollectionType === "tvshows");
  if (tv) {
    const r = await request(
      "POST",
      `/Items/${tv.ItemId}/Refresh?Recursive=true&MetadataRefreshMode=FullRefresh&ImageRefreshMode=FullRefresh&ReplaceAllMetadata=false&ReplaceAllImages=false`,
      {},
      h,
    );
    console.log("TV refresh", r.status, "folder", tv.Name, tv.ItemId);
  }

  await new Promise((r) => setTimeout(r, 15000));

  for (const term of ["Daryl", "Walking Dead Daryl", "Daryl Dixon"]) {
    const search = await request(
      "GET",
      `/Users/${userId}/Items?searchTerm=${encodeURIComponent(term)}&IncludeItemTypes=Series,Folder&Recursive=true`,
      null,
      h,
    );
    const items = JSON.parse(search.body).Items || [];
    console.log("search", term, "→", items.length);
    for (const it of items) {
      console.log(" ", it.Type, it.Name, it.Path || it.Id);
      if (it.Type === "Series") {
        const seasons = await request(
          "GET",
          `/Shows/${it.Id}/Seasons?userId=${userId}`,
          null,
          h,
        );
        if (seasons.status === 200) {
          for (const s of JSON.parse(seasons.body).Items || []) {
            console.log(
              "   Season",
              s.IndexNumber,
              "eps",
              s.ChildCount ?? "?",
            );
          }
        }
      }
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
