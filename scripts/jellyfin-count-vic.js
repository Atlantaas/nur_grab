const https = require("https");
const BASE = "https://ryan.joker.usbx.me/jellyfin";
const auth =
  'MediaBrowser Client="NurGrab", Device="PC", DeviceId="nur-grab-vic", Version="1.0.0"';

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

(async () => {
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
  await req(
    "POST",
    `/Items/${sid}/Refresh?Recursive=true&MetadataRefreshMode=FullRefresh&ReplaceAllMetadata=false`,
    {},
    h
  );
  await new Promise((r) => setTimeout(r, 4000));
  for (const sn of [0, 1, 2, 3, 4]) {
    const eps = await req(
      "GET",
      `/Shows/${sid}/Episodes?season=${sn}&userId=${uid}`,
      null,
      h
    );
    const items = JSON.parse(eps.b).Items || [];
    console.log("S" + sn, items.length, "eps");
    if (items.length) {
      const first = items[0];
      const last = items[items.length - 1];
      console.log(
        "  first E" + first.IndexNumber,
        first.Name,
        (first.Path || "").split("/").pop()
      );
      console.log(
        "  last  E" + last.IndexNumber,
        last.Name,
        (last.Path || "").split("/").pop()
      );
    }
  }
  await req("POST", "/Library/Refresh", {}, h);
  console.log("library refresh kicked");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
