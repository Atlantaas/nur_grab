/**
 * Regroupe Daryl Dixon S01/S02/S03 en une seule série Jellyfin.
 */
const { Client } = require("ssh2");
const cfg = require("../config.json");

const TV = "/home/ryan/media/TV Shows";
const SERIES = `${TV}/The Walking Dead - Daryl Dixon`;

const seasons = [
  [
    `${TV}/The.Walking.Dead.Daryl.Dixon.S01.MULTI.1080p.WEBRip.PMTP.x265.EAC3.5.1-Amen`,
    "Season 01",
  ],
  [
    `${TV}/The.Walking.Dead.Daryl.Dixon.S02.MULTI.1080p.WEBRip.PMTP.x265.EAC3.5.1-Amen`,
    "Season 02",
  ],
  [
    `${TV}/The.Walking.Dead.Daryl.Dixon.S03.MULTI.1080p.WEBRip.PMTP.x265.EAC3.5.1-Amen`,
    "Season 03",
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
      readyTimeout: 30000,
    });
  });
  console.log("SSH OK");

  const lines = [
    `mkdir -p "${SERIES}/Season 01" "${SERIES}/Season 02" "${SERIES}/Season 03"`,
  ];
  for (const [from, season] of seasons) {
    const dest = `${SERIES}/${season}`;
    lines.push(
      `if [ -d '${from.replace(/'/g, "'\\''")}' ]; then ` +
        `mv -n '${from.replace(/'/g, "'\\''")}'/*.mkv '${dest.replace(/'/g, "'\\''")}/' 2>/dev/null; ` +
        `rmdir '${from.replace(/'/g, "'\\''")}' 2>/dev/null || rm -rf '${from.replace(/'/g, "'\\''")}'; ` +
        `echo MOVED ${season}; ` +
        `else echo MISS ${season}; fi`,
    );
  }
  lines.push(`echo '==== files ===='; find "${SERIES}" -type f -name '*.mkv' | sort`);
  lines.push(`echo '==== tree ===='; ls -la "${SERIES}"; for d in "${SERIES}"/Season*; do echo "-- $d"; ls -1 "$d" | wc -l; done`);

  const cmd = lines.join("; ");
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
  console.log("DONE regroup");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
