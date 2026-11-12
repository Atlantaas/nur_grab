const https = require("https");
const BASE = "https://ryan.joker.usbx.me/jellyfin";
const authHeader =
  'MediaBrowser Client="NurGrab", Device="PC", DeviceId="nur-vq3", Version="1.0.0"';

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

  const seriesId = "b058605af9aaccc8ff668a2cb8069938";
  const detail = await request("GET", `/Users/${userId}/Items/${seriesId}`, null, h);
  console.log("series detail", detail.status);
  const series = JSON.parse(detail.body);
  console.log({
    Name: series.Name,
    Path: series.Path,
    ProviderIds: series.ProviderIds,
    ChildCount: series.ChildCount,
  });

  const seasons = await request(
    "GET",
    `/Shows/${seriesId}/Seasons?userId=${userId}`,
    null,
    h,
  );
  console.log("seasons", seasons.status);
  for (const s of JSON.parse(seasons.body).Items || []) {
    console.log("Season", s.IndexNumber, s.Name, s.Id, s.Path, "child", s.ChildCount);
    const eps = await request(
      "GET",
      `/Shows/${seriesId}/Episodes?seasonId=${s.Id}&userId=${userId}`,
      null,
      h,
    );
    for (const e of JSON.parse(eps.body).Items || []) {
      console.log(
        "  E",
        e.IndexNumber,
        e.Name,
        e.Id,
        e.Path,
        e.LocationType,
      );
    }
  }

  // Also check orphan episodes
  for (const id of [
    "3ccf2fc52f63bdfe29c105e812e036fa",
    "4937b4814db7e62297384789d84f84c7",
  ]) {
    const ep = JSON.parse(
      (await request("GET", `/Users/${userId}/Items/${id}`, null, h)).body,
    );
    console.log("orphan?", {
      Name: ep.Name,
      SeriesName: ep.SeriesName,
      SeriesId: ep.SeriesId,
      Path: ep.Path,
      ParentId: ep.ParentId,
      IndexNumber: ep.IndexNumber,
      ParentIndexNumber: ep.ParentIndexNumber,
      LocationType: ep.LocationType,
    });
  }

  // Refresh series + apply metadata Vision Quest 2026
  const refresh = await request(
    "POST",
    `/Items/${seriesId}/Refresh?Recursive=true&MetadataRefreshMode=FullRefresh&ImageRefreshMode=FullRefresh&ReplaceAllMetadata=true`,
    {},
    h,
  );
  console.log("refresh", refresh.status);

  // Rename display name
  const updated = {
    ...series,
    Name: "Vision Quest",
    SortName: "Vision Quest",
    ForcedSortName: "Vision Quest",
    ProviderIds: {
      ...(series.ProviderIds || {}),
      Imdb: "tt23112594",
    },
  };
  // Jellyfin update often wants a trimmed POST body
  const postBody = {
    Id: seriesId,
    Name: "Vision Quest",
    SortName: "Vision Quest",
    ForcedSortName: "Vision Quest",
    Overview: series.Overview,
    Genres: series.Genres,
    Tags: series.Tags,
    Studios: series.Studios,
    ProviderIds: {
      ...(series.ProviderIds || {}),
      Imdb: "tt23112594",
    },
    PremiereDate: series.PremiereDate,
    ProductionYear: 2026,
    OfficialRating: series.OfficialRating,
    CustomRating: series.CustomRating,
    DateCreated: series.DateCreated,
    Path: series.Path,
  };
  const upd = await request("POST", `/Items/${seriesId}`, postBody, h);
  console.log("rename", upd.status, upd.body.slice(0, 300));

  console.log("USERID", userId);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
