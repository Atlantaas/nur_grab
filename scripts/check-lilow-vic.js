const ftp = require("basic-ftp");
const https = require("https");
const cfg = require("../config.json");

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
          resolve({
            s: resp.statusCode,
            b: Buffer.concat(d),
            h: resp.headers,
          })
        );
      }
    );
    r.on("error", reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

async function main() {
  // qBit cookie
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
  const cookie = (auth.h["set-cookie"] || [])
    .map((x) => x.split(";")[0])
    .join("; ");

  const info = await httpsReq(cfg.qbitBase + "/api/v2/torrents/info", {
    headers: { Cookie: cookie },
  });
  const list = JSON.parse(info.b.toString());
  const lilow = list.find((t) => /lilow/i.test(t.name) && /victorious/i.test(t.name));
  if (!lilow) {
    console.log("LILOW torrent not in qBit");
  } else {
    console.log("LILOW progress", lilow.progress, "state", lilow.state);
    console.log("content_path", lilow.content_path);
    const files = await httpsReq(
      cfg.qbitBase + "/api/v2/torrents/files?hash=" + lilow.hash,
      { headers: { Cookie: cookie } }
    );
    const fl = JSON.parse(files.b.toString());
    const bySeason = {};
    for (const f of fl) {
      if (!/\.(mkv|mp4)$/i.test(f.name)) continue;
      const m = f.name.match(/S(\d{2})E(\d{2})/i);
      if (!m) continue;
      const k = "S" + m[1];
      bySeason[k] = bySeason[k] || [];
      bySeason[k].push("E" + m[2] + " " + f.name.split("/").pop());
    }
    for (const [k, v] of Object.entries(bySeason).sort()) {
      v.sort();
      console.log(k, v.length);
      v.forEach((x) => console.log(" ", x));
    }
  }

  // FTP probe
  const c = new ftp.Client(60000);
  await c.access({
    host: "joker.usbx.me",
    port: 21,
    user: "ryan",
    password: "Assaut_05",
    secure: true,
    secureOptions: { rejectUnauthorized: false },
  });
  const paths = [
    "/media/TV Shows/Victorious.INTEGRALE.MULTI.VFF.1080p.WEB.AAC.2.0.x264-LILOW",
    "/home/ryan/media/TV Shows/Victorious.INTEGRALE.MULTI.VFF.1080p.WEB.AAC.2.0.x264-LILOW",
  ];
  for (const p of paths) {
    try {
      await c.cd(p);
      const L = await c.list();
      console.log("FTP OK", p, L.length, "entries");
      console.log(L.map((x) => x.name).join(" | "));
    } catch (e) {
      console.log("FTP miss", p, e.message.split("\n")[0]);
    }
  }
  c.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
