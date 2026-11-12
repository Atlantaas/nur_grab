const https = require("https");

const auth =
  'MediaBrowser Client="NurGrab", Device="PC", DeviceId="x", Version="1"';

function req(method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL("https://ryan.joker.usbx.me/jellyfin" + path);
    const data = body != null ? JSON.stringify(body) : null;
    const r = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
          ...headers,
        },
      },
      (resp) => {
        const d = [];
        resp.on("data", (c) => d.push(c));
        resp.on("end", () =>
          resolve({ s: resp.statusCode, b: Buffer.concat(d).toString() })
        );
      }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const login = await req(
    "POST",
    "/Users/authenticatebyname",
    { Username: "ryan", Pw: "Assaut_05" },
    { "X-Emby-Authorization": auth }
  );
  const j = JSON.parse(login.b);
  const h = {
    "X-Emby-Token": j.AccessToken,
    "X-Emby-Authorization": auth + `, Token="${j.AccessToken}"`,
  };

  const search = JSON.parse(
    (
      await req(
        "GET",
        `/Items?searchTerm=Victorious.S01E20&Recursive=true&IncludeItemTypes=Episode&Fields=Path,ParentId`,
        null,
        h
      )
    ).b
  ).Items;
  const ep = search.find((i) =>
    /Victorious\.S01E20/i.test(i.Path || i.Name || "")
  );
  if (!ep) throw new Error("Episode S01E20 introuvable");
  console.log("found", ep.Id, ep.Name, ep.Path);

  // Get full item
  const full = JSON.parse(
    (await req("GET", `/Items/${ep.Id}?userId=${j.User.Id}`, null, h)).b
  );

  full.Name = "Freak the Freak Out (Partie 2)";
  full.IndexNumber = 20;
  full.ParentIndexNumber = 1;
  full.ForcedSortName = "S01E20";

  const upd = await req("POST", `/Items/${ep.Id}`, full, h);
  console.log("update", upd.s, upd.b.slice(0, 200));

  // Also try series refresh
  await req(
    "POST",
    `/Items/2d3dda677aa88bb11f6f2640c4f6fb54/Refresh?Recursive=true&MetadataRefreshMode=None`,
    {},
    h
  );
  await new Promise((r) => setTimeout(r, 3000));

  const eps = JSON.parse(
    (
      await req(
        "GET",
        `/Shows/2d3dda677aa88bb11f6f2640c4f6fb54/Episodes?season=1&userId=${j.User.Id}&Fields=Path`,
        null,
        h
      )
    ).b
  ).Items;
  console.log("S1 count now", eps.length);
  eps
    .sort((a, b) => (a.IndexNumber || 0) - (b.IndexNumber || 0))
    .forEach((e) =>
      console.log(
        "E" + String(e.IndexNumber ?? "?").padStart(2, "0"),
        e.Name,
        "|",
        (e.Path || "").split("/").pop()
      )
    );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
