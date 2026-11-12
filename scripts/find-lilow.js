const ftp = require("basic-ftp");
const https = require("https");
const cfg = require("../config.json");

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

(async () => {
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
  const info = JSON.parse(
    (
      await req(cfg.qbitBase + "/api/v2/torrents/info", {
        headers: { Cookie: cookie },
      })
    ).b.toString()
  );
  const lilow = info.find(
    (t) => /lilow/i.test(t.name) && /victorious/i.test(t.name)
  );
  console.log({
    name: lilow.name,
    progress: lilow.progress,
    state: lilow.state,
    save: lilow.save_path,
    content: lilow.content_path,
    total: lilow.total_size,
  });

  const body = "hashes=" + lilow.hash;
  await req(cfg.qbitBase + "/api/v2/torrents/recheck", {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body),
    },
    body,
  });
  console.log("recheck launched — wait 6s");
  await new Promise((r) => setTimeout(r, 6000));

  const info2 = JSON.parse(
    (
      await req(cfg.qbitBase + "/api/v2/torrents/info", {
        headers: { Cookie: cookie },
      })
    ).b.toString()
  );
  const l2 = info2.find((t) => t.hash === lilow.hash);
  console.log("after recheck", {
    progress: l2.progress,
    state: l2.state,
    content: l2.content_path,
  });

  const files = JSON.parse(
    (
      await req(cfg.qbitBase + "/api/v2/torrents/files?hash=" + lilow.hash, {
        headers: { Cookie: cookie },
      })
    ).b.toString()
  );
  const e20 = files.find((f) => /S01E20/i.test(f.name));
  console.log("E20", e20);

  const c = new ftp.Client(60000);
  await c.access({
    host: "joker.usbx.me",
    port: 21,
    user: "ryan",
    password: "Assaut_05",
    secure: true,
    secureOptions: { rejectUnauthorized: false },
  });
  await c.cd("/media/TV Shows");
  const tv = await c.list();
  for (const x of tv) {
    if (/vic|lilow/i.test(x.name)) {
      console.log("TV", x.name, x.isDirectory ? "DIR" : "FILE", x.size);
    }
  }
  // try exact content_path without /home/ryan prefix variants
  const tries = [
    l2.content_path,
    l2.content_path.replace(/^\/home\/ryan/, ""),
    "/media/TV Shows/" + l2.name,
  ];
  for (const p of tries) {
    try {
      await c.cd(p);
      console.log("CD OK", p);
      console.log((await c.list()).map((x) => x.name).slice(0, 10));
    } catch (e) {
      console.log("CD fail", p, e.message.split("\n")[0]);
    }
  }
  c.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
