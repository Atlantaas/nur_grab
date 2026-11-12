/**
 * Organise les packs saison à la racine de TV Shows → Series/Season XX/
 * Usage: node scripts/organize-tv-seasons.js [--dry]
 */
const { Client } = require("ssh2");
const cfg = require("../config.json");
const { planMoves, buildShellScript } = require("../lib/tv-organize");

const dry = process.argv.includes("--dry");
const TV = cfg.savePathTv || "/home/ryan/media/TV Shows";

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

  const listOut = await exec(
    conn,
    `ls -1 ${shellQuote(TV)} 2>/dev/null`,
  );
  const dirs = listOut
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const moves = planMoves(dirs);
  console.log("candidates", moves.length);
  for (const m of moves) {
    console.log(`- ${m.folder}`);
    console.log(`  → ${m.series}/${m.destSeason}`);
  }
  if (!moves.length) {
    console.log("Rien à regrouper.");
    conn.end();
    return;
  }
  if (dry) {
    console.log("DRY RUN — pas de mv");
    conn.end();
    return;
  }
  const script = buildShellScript(TV, moves);
  const result = await exec(conn, script);
  console.log(result);
  conn.end();
  console.log("DONE organize");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = "";
      stream.on("data", (d) => {
        out += d.toString();
      });
      stream.stderr.on("data", (d) => {
        out += d.toString();
      });
      stream.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`exit ${code}: ${out.slice(0, 500)}`));
        } else resolve(out);
      });
    });
  });
}
