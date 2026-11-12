const https = require("https");
const BASE = "https://ryan.joker.usbx.me/jellyfin";
const authHeader =
  'MediaBrowser Client="NurGrab", Device="PC", DeviceId="nur-daryl3", Version="1.0.0"';

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
  const j = JSON.parse(auth.body);
  const h = {
    "X-Emby-Token": j.AccessToken,
    "X-Emby-Authorization": `${authHeader}, Token="${j.AccessToken}"`,
  };
  const userId = j.User.Id;

  const search = await request(
    "GET",
    `/Users/${userId}/Items?searchTerm=Daryl%20Dixon&IncludeItemTypes=Series&Recursive=true&Fields=Path`,
    null,
    h,
  );
  const items = JSON.parse(search.body).Items || [];
  for (const it of items) {
    console.log("BEFORE", it.Id, it.Name, it.Path || "(no path)");
  }

  // Delete all old series entries (metadata only — files stay on disk)
  for (const it of items) {
    const del = await request(
      "DELETE",
      `/Items/${it.Id}`,
      null,
      h,
    );
    console.log("delete", it.Id, del.status);
  }

  // Full library refresh
  const libs = JSON.parse(
    (await request("GET", "/Library/VirtualFolders", null, h)).body,
  );
  const tv = (libs || []).find((f) => f.CollectionType === "tvshows");
  if (tv) {
    await request(
      "POST",
      `/Items/${tv.ItemId}/Refresh?Recursive=true&MetadataRefreshMode=FullRefresh&ImageRefreshMode=Default&ReplaceAllMetadata=false`,
      {},
      h,
    );
    console.log("TV FullRefresh kicked", tv.ItemId);
  }

  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const s2 = await request(
      "GET",
      `/Users/${userId}/Items?searchTerm=Daryl%20Dixon&IncludeItemTypes=Series&Recursive=true&Fields=Path`,
      null,
      h,
    );
    const found = JSON.parse(s2.body).Items || [];
    console.log(`try ${i + 1}: ${found.length} series`);
    for (const it of found) {
      console.log(" ", it.Name, it.Path || "");
      const seasons = await request(
        "GET",
        `/Shows/${it.Id}/Seasons?userId=${userId}`,
        null,
        h,
      );
      if (seasons.status === 200) {
        for (const s of JSON.parse(seasons.body).Items || []) {
          console.log("   S", s.IndexNumber, "children", s.ChildCount);
        }
      }
    }
    if (
      found.length === 1 &&
      /Daryl Dixon/i.test(found[0].Path || found[0].Name || "")
    ) {
      console.log("OK merged");
      break;
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
