/**
 * Nur Grab Mobile — HTTP API + PWA.
 * Same Ultra backends as the Electron app.
 * Run on Ultra (24/7) → works when PC is off.
 * Run on PC → phone on same Wi‑Fi / Tailscale.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const {
  createGrabService,
  defaultConfigPath,
  ensureMobileToken,
} = require("./lib/grab-service");

const ROOT = __dirname;
const MOBILE_DIR = path.join(ROOT, "mobile");
const CONFIG = defaultConfigPath();
const {
  token: MOBILE_TOKEN,
  pin: MOBILE_PIN,
  port: PORT,
} = ensureMobileToken(CONFIG);
const grab = createGrabService(CONFIG);
const fullCfg = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
const BIND = fullCfg.mobileBind || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

const crypto = require("crypto");
/**
 * Anti brute-force :
 *  - 8 essais ratés / IP → IP bloquée 10 min ;
 *  - > 40 ratés toutes IP confondues en 10 min → le PIN court (6 chiffres)
 *    est coupé 10 min ; le lien avec le token complet marche toujours
 *    (Ryan ne peut pas être verrouillé dehors).
 */
const authFails = new Map();
const AUTH_MAX_FAILS = 8;
const AUTH_LOCK_MS = 10 * 60 * 1000;
const GLOBAL_MAX_FAILS = 40;
let globalFails = [];
let pinDisabledUntil = 0;

function clientIp(req) {
  // Derrière nginx (Ultra) : la DERNIÈRE entrée X-Forwarded-For est celle
  // ajoutée par le proxy — la première est falsifiable par le client.
  const xff = String(req.headers["x-forwarded-for"] || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return String(xff[xff.length - 1] || req.socket.remoteAddress || "?");
}

function safeEq(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function isLocked(ip) {
  const f = authFails.get(ip);
  return !!(f && f.lockedUntil && Date.now() < f.lockedUntil);
}

function noteAuth(ip, ok) {
  if (ok) {
    authFails.delete(ip);
    return;
  }
  const now = Date.now();
  globalFails = globalFails.filter((t) => now - t < AUTH_LOCK_MS);
  globalFails.push(now);
  if (globalFails.length > GLOBAL_MAX_FAILS) {
    pinDisabledUntil = now + AUTH_LOCK_MS;
    globalFails = [];
    console.warn("[auth] trop d’échecs globaux — PIN court désactivé 10 min");
  }
  if (authFails.size > 5000) authFails.clear();
  const f = authFails.get(ip) || { n: 0, lockedUntil: 0 };
  f.n += 1;
  if (f.n >= AUTH_MAX_FAILS) {
    f.lockedUntil = Date.now() + AUTH_LOCK_MS;
    f.n = 0;
  }
  authFails.set(ip, f);
}

function presentedSecret(req, url) {
  const h = req.headers.authorization || "";
  const bearer = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  const q = url.searchParams.get("token") || url.searchParams.get("pin") || "";
  const headerTok = String(req.headers["x-nur-token"] || req.headers["x-nur-pin"] || "").trim();
  return String(bearer || headerTok || q).trim();
}

function hasFullToken(req, url) {
  const got = presentedSecret(req, url);
  return !!got && safeEq(got, MOBILE_TOKEN);
}

function checkAuth(req, url) {
  const h = req.headers.authorization || "";
  const bearer = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  const q =
    url.searchParams.get("token") ||
    url.searchParams.get("pin") ||
    "";
  const headerTok = String(
    req.headers["x-nur-token"] || req.headers["x-nur-pin"] || ""
  ).trim();
  const got = String(bearer || headerTok || q).trim();
  if (!got) return false;
  if (safeEq(got, MOBILE_TOKEN)) return true;
  if (Date.now() < pinDisabledUntil) return false;
  return safeEq(got, MOBILE_PIN);
}

function serveStatic(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res, url) {
  const ip = clientIp(req);
  // Le token complet passe toujours (même IP partagée derrière nginx).
  if (isLocked(ip) && !hasFullToken(req, url)) {
    sendJson(res, 429, { ok: false, error: "Trop d’essais — réessaie dans 10 min." });
    return;
  }
  const authed = checkAuth(req, url);
  noteAuth(ip, authed);
  if (!authed) {
    sendJson(res, 401, { ok: false, error: "Token invalide — ouvre le lien avec ?token=…" });
    return;
  }

  const route = url.pathname.replace(/^\/api/, "") || "/";

  try {
    if (req.method === "GET" && route === "/status") {
      return sendJson(res, 200, await grab.status());
    }
    if (req.method === "GET" && route === "/list") {
      return sendJson(res, 200, await grab.list());
    }
    if (req.method === "GET" && route === "/sections") {
      return sendJson(res, 200, grab.browseSections());
    }
    if (req.method === "GET" && route === "/browse") {
      return sendJson(
        res,
        200,
        await grab.browseSection({
          section: url.searchParams.get("section") || "movies-new",
          limit: Number(url.searchParams.get("limit")) || 40,
        })
      );
    }
    if (req.method === "GET" && route === "/ftp") {
      const remote = url.searchParams.get("path") || "/media";
      return sendJson(res, 200, await grab.ftpList({ path: remote }));
    }

    if (req.method === "POST") {
      const raw = await readBody(req);
      let payload = {};
      if (raw.length) {
        try {
          payload = JSON.parse(raw.toString("utf8"));
        } catch {
          return sendJson(res, 400, { ok: false, error: "JSON invalide" });
        }
      }

      if (route === "/search") {
        return sendJson(res, 200, await grab.searchBest(payload));
      }
      if (route === "/browse") {
        return sendJson(res, 200, await grab.browseSection(payload));
      }
      if (route === "/confirm") {
        return sendJson(res, 200, await grab.confirmAdd(payload));
      }
      if (route === "/confirm-many") {
        return sendJson(res, 200, await grab.confirmAddMany(payload));
      }
      if (route === "/magnet") {
        return sendJson(res, 200, await grab.addMagnet(payload));
      }
      if (route === "/from-url") {
        return sendJson(res, 200, await grab.fromUrl(payload));
      }
    }

    sendJson(res, 404, { ok: false, error: "Route inconnue" });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String(e.message || e) });
  }
}

const server = http.createServer(async (req, res) => {
  const host = req.headers.host || `127.0.0.1:${PORT}`;
  const url = new URL(req.url || "/", `http://${host}`);

  if (url.pathname.startsWith("/api/")) {
    return handleApi(req, res, url);
  }

  // Inject token/pin into boot page once — client stores it
  if (url.pathname === "/" || url.pathname === "/index.html") {
    let html = fs.readFileSync(path.join(MOBILE_DIR, "index.html"), "utf8");
    const qTok =
      url.searchParams.get("token") || url.searchParams.get("pin") || "";
    if (qTok) {
      html = html.replace(
        "/*__BOOT_TOKEN__*/",
        `window.__NUR_TOKEN__=${JSON.stringify(qTok)};`
      );
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(html);
    return;
  }

  const safe = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(MOBILE_DIR, safe);
  if (!filePath.startsWith(MOBILE_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  serveStatic(res, filePath);
});

server.listen(PORT, BIND, () => {
  const os = require("os");
  const ifs = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifs)) {
    for (const i of ifs[name] || []) {
      if (i.family === "IPv4" && !i.internal) ips.push(i.address);
    }
  }
  const base = String(fullCfg.mobileBasePath || "").replace(/\/$/, "");
  console.log("");
  console.log("  Nur Grab Mobile");
  console.log(`  Bind   ${BIND}:${PORT}`);
  console.log(`  Local  http://127.0.0.1:${PORT}/?token=${MOBILE_TOKEN}`);
  if (base) {
    console.log(
      `  Ultra  https://ryan.joker.usbx.me${base}/?token=${MOBILE_TOKEN}`
    );
  }
  for (const ip of ips) {
    console.log(`  Tel    http://${ip}:${PORT}/?token=${MOBILE_TOKEN}`);
  }
  console.log("");
});
