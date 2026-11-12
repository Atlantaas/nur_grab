/**
 * Copy Victorious S01E20 from LILOW (1080p) into QC Season 01 for Jellyfin.
 * Never deletes anything.
 */
const ftp = require("basic-ftp");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cfg = require("../config.json");

const QC_DEST =
  "/media/TV Shows/Victorious.iNTEGRALE.CUSTOM.MULTI.VFF.720p.WEBRip.AAC.2.0.x265-QC/Season 01/Victorious.S01E20.MULTI.VFF.1080p.WEB.x264-LILOW.mp4";

function httpsReq(url, opts = {}) {
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

async function qbitCookie() {
  const login = new URLSearchParams({
    username: cfg.qbitUser,
    password: cfg.qbitPass,
  }).toString();
  const auth = await httpsReq(cfg.qbitBase + "/api/v2/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(login),
    },
    body: login,
  });
  return (auth.h["set-cookie"] || []).map((x) => x.split(";")[0]).join("; ");
}

async function main() {
  const cookie = await qbitCookie();
  const info = await httpsReq(cfg.qbitBase + "/api/v2/torrents/info", {
    headers: { Cookie: cookie },
  });
  const list = JSON.parse(info.b.toString());
  const lilow = list.find(
    (t) => /lilow/i.test(t.name) && /victorious/i.test(t.name)
  );
  if (!lilow) throw new Error("LILOW torrent introuvable");

  const files = await httpsReq(
    cfg.qbitBase + "/api/v2/torrents/files?hash=" + lilow.hash,
    { headers: { Cookie: cookie } }
  );
  const fl = JSON.parse(files.b.toString());
  const e20 = fl.find((f) => /S01E20/i.test(f.name));
  if (!e20) throw new Error("S01E20 pas dans LILOW");
  console.log("LILOW file:", e20.name, "size", e20.size);

  // Absolute path on Ultra
  const abs = path.posix.join(
    lilow.save_path.replace(/\\/g, "/").replace(/\/$/, ""),
    e20.name.replace(/\\/g, "/")
  );
  console.log("abs path guess:", abs);
  console.log("content_path:", lilow.content_path);

  const c = new ftp.Client(300000);
  c.ftp.verbose = false;
  await c.access({
    host: cfg.ftpHost || "joker.usbx.me",
    port: 21,
    user: cfg.ftpUser || "ryan",
    password: cfg.ftpPass || "Assaut_05",
    secure: true,
    secureOptions: { rejectUnauthorized: false },
  });

  // Probe possible locations
  const candidates = [
    abs,
    lilow.content_path.replace(/\\/g, "/") +
      "/" +
      e20.name.split("/").slice(1).join("/"),
    "/media/TV Shows/" + e20.name,
    "/" + e20.name,
  ];
  // Also scan TV Shows for LILOW folder name variants
  await c.cd("/media/TV Shows");
  const tv = await c.list();
  const hits = tv.filter((x) => /victorious|lilow/i.test(x.name));
  console.log(
    "TV Shows matches:",
    hits.map((x) => x.name + (x.isDirectory ? "/" : "")).join(" | ")
  );

  let source = null;
  for (const p of candidates) {
    try {
      const size = await c.size(p);
      console.log("FOUND size", size, p);
      source = p;
      break;
    } catch (e) {
      console.log("miss", p);
    }
  }

  // Deep search under media if still missing
  if (!source) {
    for (const h of hits.filter((x) => x.isDirectory)) {
      const base = "/media/TV Shows/" + h.name;
      try {
        await c.cd(base);
        const walk = async (dir, depth) => {
          if (depth > 4) return null;
          const L = await c.list();
          for (const x of L) {
            const full = dir.replace(/\/$/, "") + "/" + x.name;
            if (x.isDirectory) {
              const r = await walk(full, depth + 1);
              if (r) return r;
            } else if (/S01E20/i.test(x.name)) {
              return full;
            }
          }
          return null;
        };
        // list is relative — reset cd
        await c.cd(base);
        const found = await (async function walk2(dir, depth) {
          await c.cd(dir);
          const L = await c.list();
          for (const x of L) {
            const full = dir + "/" + x.name;
            if (x.isDirectory) {
              const r = await walk2(full, depth + 1);
              if (r) return r;
            } else if (/S01E20/i.test(x.name)) return full;
          }
          return null;
        })(base, 0);
        if (found) {
          source = found;
          console.log("walk FOUND", source);
          break;
        }
      } catch (e) {
        console.log("walk fail", h.name, e.message.split("\n")[0]);
      }
    }
  }

  if (!source) {
    // Try downloads folder
    for (const root of ["/downloads/qbittorrent", "/Downloads"]) {
      try {
        await c.cd(root);
        console.log("listing", root);
        const L = await c.list();
        console.log(
          L.filter((x) => /vic|lilow/i.test(x.name))
            .map((x) => x.name)
            .join(" | ")
        );
      } catch (_) {}
    }
    throw new Error(
      "Fichier S01E20 LILOW invisible en FTP (qBit le voit). Re-check torrent côté Ultra ?"
    );
  }

  // Ensure dest dir + copy via download to tmp then upload (cross-folder)
  const tmp = path.join(os.tmpdir(), "Victorious.S01E20.LILOW.mp4");
  console.log("Downloading via FTPS…", (e20.size / 1e6).toFixed(0), "Mo");
  await c.downloadTo(tmp, source);
  console.log("local", fs.statSync(tmp).size);
  await c.ensureDir(
    "/media/TV Shows/Victorious.iNTEGRALE.CUSTOM.MULTI.VFF.720p.WEBRip.AAC.2.0.x265-QC/Season 01"
  );
  await c.uploadFrom(tmp, QC_DEST);
  console.log("Uploaded →", QC_DEST);
  try {
    fs.unlinkSync(tmp);
  } catch (_) {}

  // Jellyfin refresh
  const auth =
    'MediaBrowser Client="NurGrab", Device="PC", DeviceId="nur-grab-vic", Version="1.0.0"';
  const login = await httpsReq(BASE_JF() + "/Users/authenticatebyname", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Emby-Authorization": auth,
      "Content-Length": Buffer.byteLength(
        JSON.stringify({ Username: "ryan", Pw: "Assaut_05" })
      ),
    },
    body: JSON.stringify({ Username: "ryan", Pw: "Assaut_05" }),
  });
  if (login.s === 200) {
    const j = JSON.parse(login.b.toString());
    const token = j.AccessToken;
    const h = {
      "X-Emby-Token": token,
      "X-Emby-Authorization": auth + `, Token="${token}"`,
    };
    await httpsReq(
      BASE_JF() +
        "/Items/2d3dda677aa88bb11f6f2640c4f6fb54/Refresh?Recursive=true&MetadataRefreshMode=FullRefresh&ReplaceAllMetadata=false",
      { method: "POST", headers: { ...h, "Content-Length": 0 }, body: "" }
    );
    await httpsReq(BASE_JF() + "/Library/Refresh", {
      method: "POST",
      headers: { ...h, "Content-Length": 0 },
      body: "",
    });
    console.log("Jellyfin refresh kicked");
  }

  c.close();
  console.log("DONE S01E20");
}

function BASE_JF() {
  return "https://ryan.joker.usbx.me/jellyfin";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
