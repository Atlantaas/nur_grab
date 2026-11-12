/**
 * Nur Grab — Electron shell.
 * Toute la logique métier = lib/grab-service.js (même code que Mobile / Ultra).
 */
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const {
  createGrabService,
  defaultConfigPath,
} = require("./lib/grab-service");
const clients = require("./lib/clients");

const grab = createGrabService(defaultConfigPath());
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 780,
    minHeight: 600,
    backgroundColor: "#0e1116",
    title: "Nur Grab",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("grab:status", () => grab.status());
ipcMain.handle("grab:list", () => grab.list());
ipcMain.handle("grab:searchBest", (_e, payload) => grab.searchBest(payload));
ipcMain.handle("grab:confirmAdd", (_e, payload) => grab.confirmAdd(payload));
ipcMain.handle("grab:confirmAddMany", (_e, payload) =>
  grab.confirmAddMany(payload)
);
ipcMain.handle("grab:browse", (_e, payload) => grab.browseSection(payload));
ipcMain.handle("grab:sections", () => grab.browseSections());
ipcMain.handle("grab:addMagnet", (_e, payload) => grab.addMagnet(payload));
ipcMain.handle("grab:fromUrl", (_e, payload) => grab.fromUrl(payload));
ipcMain.handle("grab:ftpList", (_e, payload) => grab.ftpList(payload));
ipcMain.handle("grab:delete", async () => ({
  ok: false,
  error: "Suppression médias désactivée (neverDelete)",
}));

ipcMain.handle("grab:addTorrentFile", async (_e, payload) => {
  const kind = payload?.kind === "tv" ? "tv" : "movie";
  const r = await dialog.showOpenDialog(win, {
    title: "Choisir un .torrent",
    filters: [{ name: "Torrent", extensions: ["torrent"] }],
    properties: ["openFile"],
  });
  if (r.canceled || !r.filePaths?.[0]) {
    return { ok: false, error: "annulé" };
  }
  const filePath = r.filePaths[0];
  const buffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  try {
    return await grab.addTorrentBuffer(kind, buffer, fileName);
  } catch (e) {
    return {
      ok: false,
      error: String(e.message || e),
      kind,
      client: clients.clientLabel(kind),
    };
  }
});
