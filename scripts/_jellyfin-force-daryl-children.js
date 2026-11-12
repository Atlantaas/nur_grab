/**
 * Series stub Path OK mais ChildCount 0 — force rescan fichiers sans DELETE.
 */
const https = require("https");
const { Client } = require("ssh2");
const cfg = require("../config.json");
const BASE = "https://ryan.joker.usbx.me/jellyfin";
const authH =
  'MediaBrowser Client="NurGrab", Device="PC", DeviceId="nur-d5", Version="1.0.0"';
const SERIES_ID = "4da46ab47437983c581e0dacac96de32";
const SERIES_PATH =
  "/home/ryan/media/TV Shows/The Walking Dead Daryl Dixon";

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

async function ssh(cmd) {
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on("ready", resolve);
    conn.on("error", reject);
    conn.connect({
      host: cfg.ftpHost,
      port: 22,
      username: cfg.ftpUser,
      password: cfg.ftpPass,
      readyTimeout: 25000,
    });
  });
  const out = await new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let s = "";
      stream.on("data", (d) => (s += d.toString()));
      stream.stderr.on("data", (d) => (s += d.toString()));
      stream.on("close", (code) =>
        code === 0 ? resolve(s) : reject(new Error(s || "exit " + code)),
      );
    });
  });
  conn.end();
  return out;
}

(async () => {
  // Touch seasons so scanner sees mtime change; list mkv
  const disk = await ssh(
    [
      `find ${JSON.stringify(SERIES_PATH)} -type f -name '*.mkv' | wc -l`,
      `find ${JSON.stringify(SERIES_PATH)} -type f -name '*.mkv' -exec touch {} +`,
      `find ${JSON.stringify(SERIES_PATH)} -type d -exec touch {} +`,
      `ls -la ${JSON.stringify(SERIES_PATH)}`,
      `find ${JSON.stringify(SERIES_PATH)} -name '*.mkv' | head -5`,
    ].join("; "),
  );
  console.log(disk);

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

  // Build Updates for every season + sample files
  const mkvs = disk
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith(".mkv"));
  const updates = [
    { Path: SERIES_PATH, UpdateType: "Modified" },
    { Path: SERIES_PATH + "/Season 01", UpdateType: "Created" },
    { Path: SERIES_PATH + "/Season 02", UpdateType: "Created" },
    { Path: SERIES_PATH + "/Season 03", UpdateType: "Created" },
    ...mkvs.slice(0, 20).map((p) => ({ Path: p, UpdateType: "Created" })),
  ];
  const up = await req("POST", "/Library/Media/Updated", { Updates: updates }, h);
  console.log("Media/Updated", up.status, "updates", updates.length);

  // FullRefresh on series
  const r = await req(
    "POST",
    `/Items/${SERIES_ID}/Refresh?Recursive=true&MetadataRefreshMode=FullRefresh&ImageRefreshMode=FullRefresh&ReplaceAllMetadata=true&ReplaceAllImages=false`,
    {},
    h,
  );
  console.log("series FullRefresh", r.status);

  // Also refresh TV root
  const libs = JSON.parse(
    (await req("GET", "/Library/VirtualFolders", null, h)).body,
  );
  const tv = (libs || []).find((f) => f.CollectionType === "tvshows");
  if (tv) {
    const tr = await req(
      "POST",
      `/Items/${tv.ItemId}/Refresh?Recursive=true&MetadataRefreshMode=Default&ImageRefreshMode=Default&ReplaceAllMetadata=false`,
      {},
      h,
    );
    console.log("TV lib refresh", tr.status);
  }

  await new Promise((x) => setTimeout(x, 25000));
  const item = JSON.parse(
    (await req("GET", `/Users/${j.User.Id}/Items/${SERIES_ID}`, null, h)).body,
  );
  console.log({
    ChildCount: item.ChildCount,
    RecursiveItemCount: item.RecursiveItemCount,
    Path: item.Path,
  });
  const seasons = JSON.parse(
    (
      await req(
        "GET",
        `/Shows/${SERIES_ID}/Seasons?userId=${j.User.Id}`,
        null,
        h,
      )
    ).body,
  );
  console.log(
    "seasons",
    (seasons.Items || []).map((s) => ({
      n: s.IndexNumber,
      eps: s.ChildCount,
    })),
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
