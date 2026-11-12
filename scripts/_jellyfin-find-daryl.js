const https = require("https");
const BASE = "https://ryan.joker.usbx.me/jellyfin";
const authHeader =
  'MediaBrowser Client="NurGrab", Device="PC", DeviceId="nur-daryl", Version="1.0.0"';

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
  const search = await request(
    "GET",
    `/Users/${userId}/Items?searchTerm=Daryl%20Dixon&IncludeItemTypes=Series,Season,Episode,Folder&Recursive=true`,
    null,
    h,
  );
  const items = JSON.parse(search.body).Items || [];
  console.log("count", items.length);
  for (const it of items) {
    console.log(
      it.Type,
      it.Name,
      it.Id,
      `S${it.ParentIndexNumber ?? "?"}E${it.IndexNumber ?? "?"}`,
      it.Path || "",
    );
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
