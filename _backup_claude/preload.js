const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("grab", {
  status: () => ipcRenderer.invoke("grab:status"),
  addMagnet: (payload) => ipcRenderer.invoke("grab:addMagnet", payload),
  addTorrentFile: (payload) => ipcRenderer.invoke("grab:addTorrentFile", payload),
  searchBest: (payload) => ipcRenderer.invoke("grab:searchBest", payload),
  confirmAdd: (payload) => ipcRenderer.invoke("grab:confirmAdd", payload),
  confirmAddMany: (payload) =>
    ipcRenderer.invoke("grab:confirmAddMany", payload),
  browse: (payload) => ipcRenderer.invoke("grab:browse", payload),
  sections: () => ipcRenderer.invoke("grab:sections"),
  fromUrl: (payload) => ipcRenderer.invoke("grab:fromUrl", payload),
  list: () => ipcRenderer.invoke("grab:list"),
  ftpList: (payload) => ipcRenderer.invoke("grab:ftpList", payload),
  deleteBlocked: () => ipcRenderer.invoke("grab:delete"),
});
