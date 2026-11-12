const https = require("https");
const BASE = "https://ryan.joker.usbx.me/jellyfin";
const authHeader =
  'MediaBrowser Client="NurGrab", Device="PC", DeviceId="nur-vq4", Version="1.0.0"';

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
  const id = "b058605af9aaccc8ff668a2cb8069938";
  const s = JSON.parse(
    (await request("GET", `/Users/${j.User.Id}/Items/${id}`, null, h)).body,
  );
  console.log(
    JSON.stringify(
      {
        Name: s.Name,
        Path: s.Path,
        ChildCount: s.ChildCount,
        ProviderIds: s.ProviderIds,
      },
      null,
      2,
    ),
  );
  const eps =
    JSON.parse(
      (
        await request(
          "GET",
          `/Shows/${id}/Episodes?userId=${j.User.Id}`,
          null,
          h,
        )
      ).body,
    ).Items || [];
  for (const e of eps) {
    console.log(`E${e.IndexNumber}`, e.Name, e.SeriesName, e.Path);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
