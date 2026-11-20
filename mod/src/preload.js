const { contextBridge, ipcRenderer } = require("electron");
const invoke = (ch) => (arg) => ipcRenderer.invoke(ch, arg);
const on = (ch) => (cb) => {
  const h = (_, d) => cb(d);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld("api", {
  settingsGet: invoke("settings:get"),
  settingsSave: invoke("settings:save"),
  appVersion: invoke("app:version"),
  openUrl: invoke("shell:openUrl"),
  authStatus: invoke("auth:status"),
  authSetClient: invoke("auth:setClient"),
  authExportCode: invoke("auth:exportCode"),
  authImportCode: invoke("auth:importCode"),
  authLogin: invoke("auth:login"),
  authLogout: invoke("auth:logout"),
  connect: invoke("chat:connect"),
  disconnect: invoke("chat:disconnect"),
  userDetail: invoke("user:detail"),
  userDismiss: invoke("user:dismiss"),
  updateCheck: invoke("update:check"),
  updateInstall: invoke("update:install"),
  onBatch: on("chat:batch"),
  onStatus: on("chat:status"),
  onDisconnected: on("chat:disconnected"),
  onModEvent: on("chat:modEvent"),
  onUpdateAvailable: on("update:available"),
  onUpdateProgress: on("update:progress"),
});
