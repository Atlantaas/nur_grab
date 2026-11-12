const https = require("https");
const BASE = "https://ryan.joker.usbx.me/jellyfin";
const authHeader =
  'MediaBrowser Client="NurGrab", Device="PC", DeviceId="nur-vq-n", Version="1.0.0"';
const SERIES_ID = "b058605af9aaccc8ff668a2cb8069938";

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
  const auth = JSON.parse(
    (
      await request(
        "POST",
        "/Users/authenticatebyname",
        { Username: "ryan", Pw: "Assaut_05" },
        { "X-Emby-Authorization": authHeader },
      )
    ).body,
  );
  const token = auth.AccessToken;
  const userId = auth.User.Id;
  const h = {
    "X-Emby-Token": token,
    "X-Emby-Authorization": `${authHeader}, Token="${token}"`,
  };

  const series = JSON.parse(
    (await request("GET", `/Users/${userId}/Items/${SERIES_ID}`, null, h)).body,
  );
  const postBody = {
    Id: SERIES_ID,
    Name: "Vision Quest",
    SortName: "Vision Quest",
    ForcedSortName: "Vision Quest",
    Overview: series.Overview,
    Genres: series.Genres,
    Tags: series.Tags,
    Studios: series.Studios,
    ProviderIds: { ...(series.ProviderIds || {}), Imdb: "tt23112594" },
    PremiereDate: series.PremiereDate,
    ProductionYear: 2026,
    OfficialRating: series.OfficialRating,
    CustomRating: series.CustomRating,
    DateCreated: series.DateCreated,
    Path: series.Path,
    LockedFields: series.LockedFields || [],
    LockData: false,
  };
  const up = await request("POST", `/Items/${SERIES_ID}`, postBody, h);
  console.log("rename", up.status, up.body.slice(0, 120));

  const eps = JSON.parse(
    (
      await request(
        "GET",
        `/Shows/${SERIES_ID}/Episodes?userId=${userId}`,
        null,
        h,
      )
    ).body,
  );
  console.log("episode count", (eps.Items || []).length);
  for (const e of eps.Items || []) {
    const path =
      e.Path ||
      (e.MediaSources && e.MediaSources[0] && e.MediaSources[0].Path) ||
      "?";
    console.log(`E${e.IndexNumber} ${e.Name} → ${path}`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
