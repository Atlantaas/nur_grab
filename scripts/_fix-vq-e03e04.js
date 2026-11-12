/**
 * Move Vision Quest S01E03/E04 into the same series folder + Jellyfin refresh.
 */
const { Client } = require("ssh2");
const https = require("https");
const cfg = require("../config.json");

const TV = "/home/ryan/media/TV Shows";
const SERIES = `${TV}/Vision Quest`;
const SEASON = `${SERIES}/Season 01`;

const moves = [
  [
    `${TV}/VisionQuest.S01E03.MULTi.VFF.1080p.WEBRip.10.bits.EAC3.5.1.x265-GL0P.mkv`,
    `${SEASON}/Vision Quest - S01E03.mkv`,
  ],
  [
    `${TV}/VisionQuest.S01E04.MULTi.VFF.1080p.WEBRip.10.bits.EAC3.5.1.x265-GL0P.mkv`,
    `${SEASON}/Vision Quest - S01E04.mkv`,
  ],
];

const BASE = "https://ryan.joker.usbx.me/jellyfin";
const authHeader =
  'MediaBrowser Client="NurGrab", Device="PC", DeviceId="nur-vq-e34", Version="1.0.0"';

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

async function sshExec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = "";
      stream.on("data", (d) => {
        out += d;
        process.stdout.write(d);
      });
      stream.stderr.on("data", (d) => {
        out += d;
        process.stderr.write(d);
      });
      stream.on("close", (code) =>
        code === 0 ? resolve(out) : reject(new Error(`exit ${code}: ${out}`)),
      );
    });
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
      readyTimeout: 25000,
    });
  });
  console.log("SSH OK");

  const cmd = [
    `mkdir -p "${SEASON}"`,
    ...moves.map(
      ([from, to]) =>
        `if [ -f "${from}" ]; then mv -v "${from}" "${to}"; elif [ -f "${to}" ]; then echo "already ${to}"; else echo "MISSING ${from}"; fi`,
    ),
    `echo "=== Season 01 now ==="`,
    `ls -la "${SEASON}"`,
    `echo "=== loose left? ==="`,
    `ls -la "${TV}" | grep -i vision || true`,
  ].join(" && ");

  await sshExec(conn, cmd);
  conn.end();
  console.log("DONE folder layout");

  // Jellyfin: auth + find series + refresh (no DELETE)
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

  const search = await request(
    "GET",
    `/Users/${userId}/Items?searchTerm=${encodeURIComponent("Vision Quest")}&Recursive=true&IncludeItemTypes=Series`,
    null,
    h,
  );
  const seriesList = JSON.parse(search.body).Items || [];
  console.log(
    "series hits",
    seriesList.map((s) => `${s.Name} ${s.Id} ${s.Path}`),
  );
  const series =
    seriesList.find((s) => /vision\s*quest/i.test(s.Name || "")) ||
    seriesList[0];
  if (!series) throw new Error("Vision Quest series not found in Jellyfin");

  const seriesId = series.Id;
  const refresh = await request(
    "POST",
    `/Items/${seriesId}/Refresh?Recursive=true&MetadataRefreshMode=FullRefresh&ImageRefreshMode=FullRefresh&ReplaceAllMetadata=false`,
    {},
    h,
  );
  console.log("refresh", refresh.status, seriesId);

  // Also library scan path
  const libs = JSON.parse(
    (await request("GET", "/Library/VirtualFolders", null, h)).body,
  );
  const tvLib = (libs || []).find(
    (L) =>
      (L.Locations || []).some((p) => /TV Shows/i.test(p)) ||
      /tv/i.test(L.CollectionType || ""),
  );
  if (tvLib?.ItemId) {
    const scan = await request(
      "POST",
      `/Items/${tvLib.ItemId}/Refresh?Recursive=true&MetadataRefreshMode=Default&ImageRefreshMode=Default&ReplaceAllMetadata=false`,
      {},
      h,
    );
    console.log("tv lib refresh", scan.status, tvLib.Name);
  }

  // Wait a bit then list episodes
  await new Promise((r) => setTimeout(r, 4000));
  const seasons = JSON.parse(
    (
      await request(
        "GET",
        `/Shows/${seriesId}/Seasons?userId=${userId}`,
        null,
        h,
      )
    ).body,
  );
  for (const s of seasons.Items || []) {
    console.log("Season", s.IndexNumber, s.Name, "child", s.ChildCount);
    const eps = JSON.parse(
      (
        await request(
          "GET",
          `/Shows/${seriesId}/Episodes?seasonId=${s.Id}&userId=${userId}`,
          null,
          h,
        )
      ).body,
    );
    for (const e of eps.Items || []) {
      console.log(
        "  E",
        e.IndexNumber,
        e.Name,
        e.Path,
        e.LocationType,
      );
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
