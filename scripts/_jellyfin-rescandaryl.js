const https = require("https");
const { Client } = require("ssh2");
const cfg = require("../config.json");

const BASE = "https://ryan.joker.usbx.me/jellyfin";
const authHeader =
  'MediaBrowser Client="NurGrab", Device="PC", DeviceId="nur-d4", Version="1.0.0"';

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
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on("ready", resolve);
    conn.on("error", reject);
    conn.connect({
      host: cfg.ftpHost,
      port: 22,
      username: cfg.ftpUser,
      password: cfg.ftpPass,
      readyTimeout: 20000,
    });
  });
  await new Promise((resolve, reject) => {
    conn.exec(
      'ls -la "/home/ryan/media/TV Shows/The Walking Dead - Daryl Dixon"; find "/home/ryan/media/TV Shows/The Walking Dead - Daryl Dixon" -name "*.mkv" | wc -l',
      (err, stream) => {
        if (err) return reject(err);
        stream.on("data", (d) => process.stdout.write(d));
        stream.stderr.on("data", (d) => process.stderr.write(d));
        stream.on("close", () => resolve());
      },
    );
  });
  conn.end();

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

  await request("POST", "/Library/Refresh", {}, h);
  console.log("Library/Refresh");
  await new Promise((r) => setTimeout(r, 20000));

  const s = await request(
    "GET",
    `/Users/${j.User.Id}/Items?searchTerm=Daryl&IncludeItemTypes=Series,Folder&Recursive=true&Fields=Path`,
    null,
    h,
  );
  const items = JSON.parse(s.body).Items || [];
  console.log("hits", items.length);
  for (const it of items) {
    console.log(it.Type, it.Name, it.Path || "");
    if (it.Type === "Series") {
      const seasons = await request(
        "GET",
        `/Shows/${it.Id}/Seasons?userId=${j.User.Id}`,
        null,
        h,
      );
      if (seasons.status === 200) {
        for (const season of JSON.parse(seasons.body).Items || []) {
          console.log(
            "  S",
            season.IndexNumber,
            season.Name,
            "child",
            season.ChildCount,
          );
        }
      }
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
