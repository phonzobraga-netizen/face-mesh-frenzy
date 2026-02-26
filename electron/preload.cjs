const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("focusGuard", {
  openRedirect: () => ipcRenderer.invoke("focusguard:open-redirect"),
  closeRedirect: () => ipcRenderer.invoke("focusguard:close-redirect"),
  getRedirectState: () => ipcRenderer.invoke("focusguard:get-redirect-state"),
});
