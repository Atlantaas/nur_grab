const https = require("https");

const BASE = "https://ryan.joker.usbx.me/jellyfin";

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
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const authHeader =
  'MediaBrowser Client="NurGrab", Device="PC", DeviceId="nur-grab-vic", Version="1.0.0"';

async function main() {
  const tries = [
    ["Astro", "Assaut_05"],
    ["ryan", "Assaut_05"],
    ["Astro", "astro"],
    ["admin", "Assaut_05"],
  ];
  let token = null;
  let userId = null;
  for (const [user, pass] of tries) {
    const r = await request(
      "POST",
      "/Users/authenticatebyname",
      { Username: user, Pw: pass },
      { "X-Emby-Authorization": authHeader }
    );
    console.log("auth", user, r.status);
    if (r.status === 200) {
      const j = JSON.parse(r.body);
      token = j.AccessToken;
      userId = j.User?.Id;
      console.log("logged as", j.User?.Name, userId);
      break;
    }
  }
  if (!token) {
    console.log("No Jellyfin login — refresh manually in UI");
    return;
  }
  const h = {
    "X-Emby-Token": token,
    "X-Emby-Authorization": authHeader + `, Token="${token}"`,
  };

  const search = await request(
    "GET",
    `/Users/${userId}/Items?searchTerm=Victorious&IncludeItemTypes=Series&Recursive=true`,
    null,
    h
  );
  console.log("search", search.status);
  const items = JSON.parse(search.body).Items || [];
  for (const it of items) {
    console.log("-", it.Name, it.Id, "Path?", it.Path);
  }
  const series = items.find((i) => /victorious/i.test(i.Name));
  if (!series) {
    console.log("Series not found — trigger library scan");
    await request("POST", "/Library/Refresh", {}, h);
    console.log("Library refresh kicked");
    return;
  }

  // Prefer aired/official order (4 seasons)
  const update = await request(
    "POST",
    `/Items/${series.Id}`,
    {
      Id: series.Id,
      Name: series.Name,
      DisplayOrder: "aired",
      ProviderIds: series.ProviderIds,
    },
    h
  );
  console.log("update DisplayOrder aired", update.status, update.body.slice(0, 200));

  const refresh = await request(
    "POST",
    `/Items/${series.Id}/Refresh?Recursive=true&ImageRefreshMode=Default&MetadataRefreshMode=FullRefresh&ReplaceAllMetadata=false`,
    {},
    h
  );
  console.log("refresh series", refresh.status);

  const seasons = await request(
    "GET",
    `/Shows/${series.Id}/Seasons?userId=${userId}`,
    null,
    h
  );
  if (seasons.status === 200) {
    const s = JSON.parse(seasons.body).Items || [];
    for (const season of s) {
      console.log(
        "Season",
        season.IndexNumber,
        season.Name,
        "eps?",
        season.ChildCount
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
