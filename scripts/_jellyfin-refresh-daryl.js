const https = require("https");
const BASE = "https://ryan.joker.usbx.me/jellyfin";
const authHeader =
  'MediaBrowser Client="NurGrab", Device="PC", DeviceId="nur-daryl2", Version="1.0.0"';

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
  const h = {
    "X-Emby-Token": j.AccessToken,
    "X-Emby-Authorization": `${authHeader}, Token="${j.AccessToken}"`,
  };
  const userId = j.User.Id;

  // Refresh TV library
  const libs = JSON.parse(
    (await request("GET", "/Library/VirtualFolders", null, h)).body,
  );
  const tv = (libs || []).find((f) => f.CollectionType === "tvshows");
  if (tv) {
    const r = await request(
      "POST",
      `/Items/${tv.ItemId}/Refresh?Recursive=true&MetadataRefreshMode=Default&ImageRefreshMode=Default&ReplaceAllMetadata=false`,
      {},
      h,
    );
    console.log("refresh TV lib", r.status);
  } else {
    await request("POST", "/Library/Refresh", {}, h);
    console.log("Library/Refresh kicked");
  }

  await new Promise((r) => setTimeout(r, 8000));
  const search = await request(
    "GET",
    `/Users/${userId}/Items?searchTerm=Daryl%20Dixon&IncludeItemTypes=Series&Recursive=true`,
    null,
    h,
  );
  const items = JSON.parse(search.body).Items || [];
  for (const it of items) {
    console.log("Series", it.Name, it.Id, it.Path || "");
    const seasons = await request(
      "GET",
      `/Shows/${it.Id}/Seasons?userId=${userId}`,
      null,
      h,
    );
    if (seasons.status === 200) {
      for (const s of JSON.parse(seasons.body).Items || []) {
        console.log(
          "  Season",
          s.IndexNumber,
          s.Name,
          "eps",
          s.ChildCount ?? "?",
        );
      }
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
