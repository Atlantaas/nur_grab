/**
 * Prioritize LILOW S01E20 download, wait, copy into QC Season 01, refresh Jellyfin.
 */
const ftp = require("basic-ftp");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cfg = require("../config.json");

const HASH_WAIT_MS = 3 * 60 * 1000;
const POLL = 8000;

function req(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: opts.method || "GET",
        headers: opts.headers || {},
      },
      (resp) => {
        const d = [];
        resp.on("data", (c) => d.push(c));
        resp.on("end", () =>
          resolve({ s: resp.statusCode, b: Buffer.concat(d), h: resp.headers })
        );
      }
    );
    r.on("error", reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

async function qbit() {
  const login = new URLSearchParams({
    username: cfg.qbitUser,
    password: cfg.qbitPass,
  }).toString();
  const auth = await req(cfg.qbitBase + "/api/v2/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(login),
    },
    body: login,
  });
  const cookie = (auth.h["set-cookie"] || [])
    .map((x) => x.split(";")[0])
    .join("; ");
  const post = async (apiPath, body) => {
    const b = typeof body === "string" ? body : new URLSearchParams(body).toString();
    return req(cfg.qbitBase + apiPath, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(b),
      },
      body: b,
    });
  };
  const get = async (apiPath) =>
    req(cfg.qbitBase + apiPath, { headers: { Cookie: cookie } });
  return { cookie, post, get };
}

async function main() {
  const qb = await qbit();
  const info = JSON.parse((await qb.get("/api/v2/torrents/info")).b.toString());
  const lilow = info.find(
    (t) => /lilow/i.test(t.name) && /victorious/i.test(t.name)
  );
  if (!lilow) throw new Error("LILOW introuvable");
  const hash = lilow.hash;

  let files = JSON.parse(
    (await qb.get("/api/v2/torrents/files?hash=" + hash)).b.toString()
  );
  const e20 = files.find((f) => /S01E20/i.test(f.name));
  if (!e20) throw new Error("S01E20 introuvable dans LILOW");
  console.log("E20 index", e20.index, "progress", e20.progress, "size", e20.size);

  // Pause other files? Better: set E20 priority max (7), others normal/low for S01 only
  // Set all to 0 (don't download) then E20 to 7 — too aggressive if user wants full pack.
  // Instead: priority 7 for E20, resume torrent.
  await qb.post("/api/v2/torrents/filePrio", {
    hash,
    id: String(e20.index),
    priority: "7",
  });
  await qb.post("/api/v2/torrents/setShareLimits", {
    hashes: hash,
    ratioLimit: -2,
    seedingTimeLimit: -2,
    inactiveSeedingTimeLimit: -2,
  }).catch(() => {});
  await qb.post("/api/v2/torrents/resume", { hashes: hash });
  // sequential download helps get first files faster sometimes
  await qb.post("/api/v2/torrents/toggleSequentialDownload", {
    hashes: hash,
  }).catch(() => {});
  console.log("Priority max on S01E20 + resume");

  const deadline = Date.now() + HASH_WAIT_MS;
  while (Date.now() < deadline) {
    files = JSON.parse(
      (await qb.get("/api/v2/torrents/files?hash=" + hash)).b.toString()
    );
    const f = files.find((x) => x.index === e20.index);
    const t = JSON.parse((await qb.get("/api/v2/torrents/info")).b.toString()).find(
      (x) => x.hash === hash
    );
    console.log(
      "…",
      Math.round((f.progress || 0) * 100) + "%",
      "torrent",
      t.state,
      Math.round((t.dlspeed || 0) / 1024) + " KiB/s"
    );
    if (f.progress >= 1) {
      console.log("S01E20 COMPLETE");
      break;
    }
    await new Promise((r) => setTimeout(r, POLL));
  }

  files = JSON.parse(
    (await qb.get("/api/v2/torrents/files?hash=" + hash)).b.toString()
  );
  const done = files.find((x) => x.index === e20.index);
  if (!done || done.progress < 1) {
    console.log(
      "Pas encore fini (" +
        Math.round((done?.progress || 0) * 100) +
        "%). qBit continue en fond — relance ce script plus tard."
    );
    process.exit(2);
  }

  const src =
    "/media/TV Shows/Victorious.INTEGRALE.MULTI.VFF.1080p.WEB.AAC.2.0.x264-LILOW/Victorious.S01.MULTI.VFF.1080p.WEB.AAC.2.0.x264-LILOW/Victorious.S01E20.MULTI.VFF.1080p.WEB.AAC.2.0.x264-LILOW.mp4";
  const destDir =
    "/media/TV Shows/Victorious.iNTEGRALE.CUSTOM.MULTI.VFF.720p.WEBRip.AAC.2.0.x265-QC/Season 01";
  const dest =
    destDir + "/Victorious.S01E20.MULTI.VFF.1080p.WEB.x264-LILOW.mp4";

  const c = new ftp.Client(600000);
  await c.access({
    host: "joker.usbx.me",
    port: 21,
    user: "ryan",
    password: "Assaut_05",
    secure: true,
    secureOptions: { rejectUnauthorized: false },
  });
  const tmp = path.join(os.tmpdir(), "vic-s01e20.mp4");
  console.log("FTPS copy…");
  await c.downloadTo(tmp, src);
  console.log("downloaded", fs.statSync(tmp).size);
  await c.ensureDir(destDir);
  await c.uploadFrom(tmp, dest);
  console.log("uploaded", dest);
  try {
    fs.unlinkSync(tmp);
  } catch (_) {}
  c.close();

  // Jellyfin refresh
  const auth =
    'MediaBrowser Client="NurGrab", Device="PC", DeviceId="nur-grab-vic", Version="1.0.0"';
  const body = JSON.stringify({ Username: "ryan", Pw: "Assaut_05" });
  const login = await req(
    "https://ryan.joker.usbx.me/jellyfin/Users/authenticatebyname",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "X-Emby-Authorization": auth,
      },
      body,
    }
  );
  if (login.s === 200) {
    const j = JSON.parse(login.b.toString());
    const h = {
      "X-Emby-Token": j.AccessToken,
      "X-Emby-Authorization": auth + `, Token="${j.AccessToken}"`,
    };
    await req(
      "https://ryan.joker.usbx.me/jellyfin/Items/2d3dda677aa88bb11f6f2640c4f6fb54/Refresh?Recursive=true&MetadataRefreshMode=FullRefresh",
      { method: "POST", headers: { ...h, "Content-Length": 0 }, body: "" }
    );
    await req("https://ryan.joker.usbx.me/jellyfin/Library/Refresh", {
      method: "POST",
      headers: { ...h, "Content-Length": 0 },
      body: "",
    });
    console.log("Jellyfin refreshed");
  }
  console.log("DONE");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
