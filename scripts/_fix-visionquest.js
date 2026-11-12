/**
 * Regroupe Vision Quest S01E01/E02 en série Jellyfin (dossier + refresh).
 */
const { Client } = require("ssh2");
const cfg = require("../config.json");

const TV = "/home/ryan/media/TV Shows";
const SERIES = `${TV}/Vision Quest`;
const SEASON = `${SERIES}/Season 01`;

const moves = [
  [
    `${TV}/VisionQuest - S01E01 - Sans attaches 2160p.DV.HDR.x265-Amen.mkv`,
    `${SEASON}/Vision Quest - S01E01 - Sans attaches.mkv`,
  ],
  [
    `${TV}/VisionQuest - S01E02 - Thésée 2160p.DV.HDR.x265-Amen.mkv`,
    `${SEASON}/Vision Quest - S01E02 - Thésée.mkv`,
  ],
];

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
    `ls -la "${SEASON}"`,
  ].join(" && ");

  await new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      stream.on("data", (d) => process.stdout.write(d));
      stream.stderr.on("data", (d) => process.stderr.write(d));
      stream.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`exit ${code}`)),
      );
    });
  });

  conn.end();
  console.log("DONE folder layout");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
