const https = require("https");
const BASE = "https://ryan.joker.usbx.me/jellyfin";
const authH =
  'MediaBrowser Client="NurGrab", Device="PC", DeviceId="nur-d3", Version="1.0.0"';
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
  const seasons = await req(
    "GET",
    `/Shows/${SERIES_ID}/Seasons?userId=${j.User.Id}`,
    null,
    h,
  );
  console.log("seasons", seasons.status);
  for (const s of JSON.parse(seasons.body).Items || []) {
    console.log("Season", s.IndexNumber, s.Name, "eps", s.ChildCount);
    const eps = await req(
      "GET",
      `/Shows/${SERIES_ID}/Episodes?seasonId=${s.Id}&userId=${j.User.Id}`,
      null,
      h,
    );
    const items = JSON.parse(eps.body).Items || [];
    console.log(
      "  listed",
      items.length,
      items
        .slice(0, 2)
        .map((e) => e.Name)
        .join(" | "),
    );
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
