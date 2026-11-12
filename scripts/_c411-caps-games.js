const fs = require("fs");
const https = require("https");
const path = require("path");

const cfg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8"),
);
const u = new URL(`${cfg.c411Base}/api/torznab`);
u.searchParams.set("apikey", cfg.c411ApiKey);
u.searchParams.set("t", "caps");

https
  .get(u, (res) => {
    let d = "";
    res.on("data", (c) => (d += c));
    res.on("end", () => {
      const cats = [
        ...d.matchAll(/<category[^>]*id="(\d+)"[^>]*name="([^"]+)"/gi),
      ].map((m) => ({ id: m[1], name: m[2] }));
      const subs = [
        ...d.matchAll(/<subcat[^>]*id="(\d+)"[^>]*name="([^"]+)"/gi),
      ].map((m) => ({ id: m[1], name: m[2] }));
      const all = [...cats, ...subs];
      const games = all.filter((c) =>
        /game|jeu|pc|console|rom|nintendo|playstation|xbox|switch|steam|application/i.test(
          c.name,
        ),
      );
      console.log("cats", cats.length, "subs", subs.length);
      console.log(JSON.stringify(games.length ? games : all.slice(0, 60), null, 2));
    });
  })
  .on("error", (e) => console.error(e));
