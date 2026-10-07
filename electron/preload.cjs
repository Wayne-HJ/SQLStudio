const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  invoke: (method, args) => ipcRenderer.invoke("database", method, args),
  pickFile: () => ipcRenderer.invoke("pick-file"),
  setLanguage: (language) => ipcRenderer.invoke("set-language", language),
  platform: process.platform,
});
