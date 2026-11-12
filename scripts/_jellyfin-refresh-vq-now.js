const https = require("https");
const BASE = "https://ryan.joker.usbx.me/jellyfin";
const authHeader =
  'MediaBrowser Client="NurGrab", Device="PC", DeviceId="nur-vq-ref", Version="1.0.0"';
const SERIES_ID = "b058605af9aaccc8ff668a2cb8069938";

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
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  const auth = await request(
    "POST",
    "/Users/authenticatebyname",
    { Username: "ryan", Pw: "Assaut_05" },
    { "X-Emby-Authorization": authHeader },
  );
  if (auth.status !== 200) {
    console.error("auth fail", auth.status, auth.body.slice(0, 200));
    process.exit(1);
  }
  const j = JSON.parse(auth.body);
  const token = j.AccessToken;
  const userId = j.User.Id;
  const h = {
    "X-Emby-Token": token,
    "X-Emby-Authorization": `${authHeader}, Token="${token}"`,
  };

  // Library folders
  const libs = JSON.parse(
    (await request("GET", "/Library/VirtualFolders", null, h)).body,
  );
  for (const L of libs || []) {
    console.log("LIB", L.Name, L.CollectionType, L.ItemId);
  }

  // Try known series id
  let seriesId = SERIES_ID;
  const detail = await request(
    "GET",
    `/Users/${userId}/Items/${SERIES_ID}`,
    null,
    h,
  );
  console.log("known series", detail.status);
  if (detail.status === 200) {
    const s = JSON.parse(detail.body);
    console.log({ Name: s.Name, Path: s.Path, ChildCount: s.ChildCount });
  } else {
    // Fallback search
    const q = await request(
      "GET",
      `/Items?Recursive=true&IncludeItemTypes=Series&SearchTerm=${encodeURIComponent("Vision")}&userId=${userId}`,
      null,
      h,
    );
    const items = JSON.parse(q.body).Items || [];
    console.log(
      "search Vision",
      items.map((i) => `${i.Name}|${i.Id}|${i.Path}`),
    );
    const hit = items.find((i) => /vision/i.test(i.Name || ""));
    if (!hit) {
      // Full library scan then wait
      const tv = (libs || []).find((L) =>
        (L.Locations || []).some((p) => /TV/i.test(p)),
      );
      if (tv?.ItemId) {
        console.log("scanning TV lib", tv.Name, tv.ItemId);
        await request(
          "POST",
          `/Items/${tv.ItemId}/Refresh?Recursive=true&MetadataRefreshMode=Default&ImageRefreshMode=Default&ReplaceAllMetadata=false`,
          {},
          h,
        );
      }
      await request("POST", "/Library/Refresh", {}, h);
      console.log("full library refresh triggered, waiting 12s...");
      await new Promise((r) => setTimeout(r, 12000));
      const q2 = await request(
        "GET",
        `/Items?Recursive=true&IncludeItemTypes=Series&SearchTerm=${encodeURIComponent("Vision")}&userId=${userId}`,
        null,
        h,
      );
      const items2 = JSON.parse(q2.body).Items || [];
      console.log(
        "search2",
        items2.map((i) => `${i.Name}|${i.Id}|${i.Path}`),
      );
      const hit2 = items2.find((i) => /vision/i.test(i.Name || ""));
      if (!hit2) throw new Error("still no Vision Quest series");
      seriesId = hit2.Id;
    } else {
      seriesId = hit.Id;
    }
  }

  const refresh = await request(
    "POST",
    `/Items/${seriesId}/Refresh?Recursive=true&MetadataRefreshMode=FullRefresh&ImageRefreshMode=FullRefresh&ReplaceAllMetadata=false`,
    {},
    h,
  );
  console.log("series refresh", refresh.status, seriesId);

  // Path-based: also refresh parent TV folder if we can find by path
  await request("POST", "/Library/Refresh", {}, h);
  console.log("waiting 8s for scan...");
  await new Promise((r) => setTimeout(r, 8000));

  const seasons = JSON.parse(
    (
      await request(
        "GET",
        `/Shows/${seriesId}/Seasons?userId=${userId}`,
        null,
        h,
      )
    ).body,
  );
  for (const s of seasons.Items || []) {
    console.log("Season", s.IndexNumber, s.Name, "child", s.ChildCount, s.Id);
    const eps = JSON.parse(
      (
        await request(
          "GET",
          `/Shows/${seriesId}/Episodes?seasonId=${s.Id}&userId=${userId}`,
          null,
          h,
        )
      ).body,
    );
    for (const e of eps.Items || []) {
      console.log("  E", e.IndexNumber, e.Name, e.Path);
    }
  }

  // Also list any orphan VisionQuest movies/episodes
  const orphans = JSON.parse(
    (
      await request(
        "GET",
        `/Items?Recursive=true&SearchTerm=${encodeURIComponent("VisionQuest")}&userId=${userId}`,
        null,
        h,
      )
    ).body,
  );
  console.log(
    "orphan hits",
    (orphans.Items || []).map(
      (i) => `${i.Type}|${i.Name}|${i.Id}|${i.Path || ""}`,
    ),
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
