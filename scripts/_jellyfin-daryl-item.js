const https = require("https");
const BASE = "https://ryan.joker.usbx.me/jellyfin";
const authH =
  'MediaBrowser Client="NurGrab", Device="PC", DeviceId="nur-d4", Version="1.0.0"';
const SERIES_ID = "4da46ab47437983c581e0dacac96de32";

function req(method, path, body, headers = {}) {
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
      (res) => {
        const c = [];
        res.on("data", (d) => c.push(d));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: Buffer.concat(c).toString() }),
        );
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const auth = await req(
    "POST",
    "/Users/authenticatebyname",
    { Username: "ryan", Pw: "Assaut_05" },
    { "X-Emby-Authorization": authH },
  );
  const j = JSON.parse(auth.body);
  const h = {
    "X-Emby-Token": j.AccessToken,
    "X-Emby-Authorization": `${authH}, Token="${j.AccessToken}"`,
  };

  const item = await req("GET", `/Users/${j.User.Id}/Items/${SERIES_ID}`, null, h);
  console.log("item", item.status);
  const it = JSON.parse(item.body);
  console.log({
    Name: it.Name,
    Type: it.Type,
    Path: it.Path,
    ChildCount: it.ChildCount,
    RecursiveItemCount: it.RecursiveItemCount,
  });

  const refresh = await req(
    "POST",
    `/Items/${SERIES_ID}/Refresh?Recursive=true&MetadataRefreshMode=FullRefresh&ImageRefreshMode=Default&ReplaceAllMetadata=false`,
    {},
    h,
  );
  console.log("item refresh", refresh.status);

  await new Promise((r) => setTimeout(r, 20000));

  const seasons = await req(
    "GET",
    `/Shows/${SERIES_ID}/Seasons?userId=${j.User.Id}`,
    null,
    h,
  );
  const sItems = JSON.parse(seasons.body).Items || [];
  console.log("seasons after refresh", sItems.length);
  for (const s of sItems) {
    console.log("Season", s.IndexNumber, "eps", s.ChildCount, s.Path || "");
  }

  const children = await req(
    "GET",
    `/Users/${j.User.Id}/Items?ParentId=${SERIES_ID}&Recursive=true`,
    null,
    h,
  );
  const kids = JSON.parse(children.body).Items || [];
  console.log("children", kids.length);
  for (const k of kids.slice(0, 15)) {
    console.log(k.Type, k.Name, k.Path || "");
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
