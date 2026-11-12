const https = require("https");

const BASE = "https://ryan.joker.usbx.me/jellyfin";
const authHeader =
  'MediaBrowser Client="NurGrab", Device="PC", DeviceId="nur-vq", Version="1.0.0"';

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const data = body != null ? JSON.stringify(body) : null;
    const req = https.request(
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
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  let token = null;
  let userId = null;
  for (const [user, pass] of [
    ["ryan", "Assaut_05"],
    ["Astro", "Assaut_05"],
  ]) {
    const r = await request(
      "POST",
      "/Users/authenticatebyname",
      { Username: user, Pw: pass },
      { "X-Emby-Authorization": authHeader },
    );
    console.log("auth", user, r.status);
    if (r.status === 200) {
      const j = JSON.parse(r.body);
      token = j.AccessToken;
      userId = j.User?.Id;
      console.log("logged", j.User?.Name, userId);
      break;
    }
  }
  if (!token) throw new Error("no jellyfin login");

  const h = {
    "X-Emby-Token": token,
    "X-Emby-Authorization": `${authHeader}, Token="${token}"`,
  };

  const refresh = await request("POST", "/Library/Refresh", {}, h);
  console.log("Library/Refresh", refresh.status);

  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const search = await request(
      "GET",
      `/Users/${userId}/Items?searchTerm=Vision%20Quest&IncludeItemTypes=Series,Episode&Recursive=true`,
      null,
      h,
    );
    const items = JSON.parse(search.body).Items || [];
    console.log(`try ${i + 1}: ${items.length} items`);
    for (const it of items) {
      console.log(
        "-",
        it.Type,
        it.Name,
        it.Id,
        `S${it.ParentIndexNumber ?? "?"}E${it.IndexNumber ?? "?"}`,
        it.Path || "",
      );
    }
    const series = items.find(
      (it) => it.Type === "Series" && /vision\s*quest/i.test(it.Name),
    );
    if (series) {
      const meta = await request(
        "POST",
        `/Items/${series.Id}/Refresh?Recursive=true&ImageRefreshMode=FullRefresh&MetadataRefreshMode=FullRefresh&ReplaceAllMetadata=true`,
        {},
        h,
      );
      console.log("series FullRefresh", series.Id, meta.status);

      // Apply TMDB/IMDB if missing
      const remote = await request(
        "GET",
        `/Items/RemoteSearch/Series?searchTerm=Vision%20Quest`,
        null,
        h,
      );
      console.log("remote search status", remote.status);
      try {
        const remotes = JSON.parse(remote.body);
        const hit = (Array.isArray(remotes) ? remotes : []).find(
          (r) =>
            /vision\s*quest/i.test(r.Name || "") &&
            String(r.ProductionYear || "") === "2026",
        );
        if (hit) {
          console.log("remote hit", hit.Name, hit.ProviderIds);
          const apply = await request(
            "POST",
            "/Items/RemoteSearch/Apply/" + series.Id + "?ReplaceAllImages=true",
            {
              ProviderIds: hit.ProviderIds,
              ItemId: series.Id,
              SearchProviderName: hit.SearchProviderName,
            },
            h,
          );
          console.log("apply remote", apply.status, apply.body.slice(0, 200));
        }
      } catch (e) {
        console.log("remote parse skip", e.message);
      }

      const seasons = await request(
        "GET",
        `/Shows/${series.Id}/Seasons?userId=${userId}`,
        null,
        h,
      );
      if (seasons.status === 200) {
        for (const s of JSON.parse(seasons.body).Items || []) {
          console.log("Season", s.IndexNumber, s.Name, "children", s.ChildCount);
        }
      }
      console.log("USERID", userId);
      return;
    }
  }
  console.log("USERID", userId);
  console.log("Series not found after scans — check folder permissions");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
