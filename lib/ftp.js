/**
 * Ultra FTPS — same host as FileZilla (joker.usbx.me).
 * NEVER delete remote media.
 */
const ftp = require("basic-ftp");
const fs = require("fs");
const os = require("os");
const path = require("path");

function ftpCfg(cfg) {
  return {
    host: cfg.ftpHost || "joker.usbx.me",
    port: Number(cfg.ftpPort) || 21,
    user: cfg.ftpUser || cfg.qbitUser,
    password: cfg.ftpPass || cfg.qbitPass,
    secure: cfg.ftpSecure !== false,
    secureOptions: { rejectUnauthorized: false },
  };
}

async function withFtp(cfg, fn) {
  const client = new ftp.Client(60_000);
  client.ftp.verbose = false;
  try {
    await client.access(ftpCfg(cfg));
    return await fn(client);
  } finally {
    client.close();
  }
}

async function testFtp(cfg) {
  return withFtp(cfg, async (client) => {
    const pwd = await client.pwd();
    const root = await client.list();
    return {
      ok: true,
      pwd,
      host: ftpCfg(cfg).host,
      entries: root.length,
      hasMedia: root.some((e) => e.name === "media" && e.isDirectory),
      hasWatch: root.some((e) => e.name === "watch" && e.isDirectory),
    };
  });
}

async function listDir(cfg, remotePath = "/media") {
  return withFtp(cfg, async (client) => {
    const target = remotePath.startsWith("/") ? remotePath : "/" + remotePath;
    await client.cd(target);
    const list = await client.list();
    return {
      ok: true,
      path: target,
      items: list
        .map((e) => ({
          name: e.name,
          dir: !!e.isDirectory,
          size: e.size || 0,
          modified: e.modifiedAt ? e.modifiedAt.toISOString() : null,
        }))
        .sort((a, b) => {
          if (a.dir !== b.dir) return a.dir ? -1 : 1;
          return a.name.localeCompare(b.name, "fr");
        }),
    };
  });
}

function watchPathFor(cfg, kind) {
  if (kind === "tv") {
    return cfg.ftpWatchTv || "/watch/qbittorrent";
  }
  // Jeux → même watch Transmission que les films (sauf override)
  if (kind === "game") {
    return cfg.ftpWatchGames || cfg.ftpWatchMovies || "/watch/transmission";
  }
  return cfg.ftpWatchMovies || "/watch/transmission";
}

/**
 * Upload a local .torrent (or buffer) into Ultra watch folder.
 * qBit / Transmission pick it up — never deletes anything.
 */
async function uploadTorrentToWatch(cfg, { kind, filePath, buffer, fileName }) {
  const remoteDir = watchPathFor(cfg, kind);
  const name = fileName || (filePath ? path.basename(filePath) : "nur-grab.torrent");
  if (!/\.torrent$/i.test(name)) {
    throw new Error("Fichier .torrent requis pour le watch FTP");
  }
  const tmp =
    buffer != null
      ? path.join(os.tmpdir(), `nur-grab-${Date.now()}-${name}`)
      : filePath;
  if (buffer != null) {
    fs.writeFileSync(tmp, buffer);
  }
  try {
    return await withFtp(cfg, async (client) => {
      await client.ensureDir(remoteDir);
      const remote = `${remoteDir.replace(/\/$/, "")}/${name}`;
      await client.uploadFrom(tmp, remote);
      return { ok: true, remote, watch: remoteDir, kind };
    });
  } finally {
    if (buffer != null) {
      try {
        fs.unlinkSync(tmp);
      } catch (_) {}
    }
  }
}

module.exports = {
  testFtp,
  listDir,
  uploadTorrentToWatch,
  watchPathFor,
  withFtp,
};
