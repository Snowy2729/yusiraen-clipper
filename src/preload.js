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
  pickFolder: invoke("settings:pickFolder"),
  openPath: invoke("shell:open"),
  openUrl: invoke("shell:openUrl"),
  liveState: invoke("live:state"),
  liveCheck: invoke("live:check"),
  liveConnect: invoke("live:connect"),
  liveStop: invoke("live:stop"),
  sessionsList: invoke("sessions:list"),
  sessionGet: invoke("sessions:get"),
  sessionDelete: invoke("sessions:delete"),
  sessionRename: invoke("sessions:rename"),
  sessionAnalyze: invoke("sessions:analyze"),
  sessionSelect: invoke("sessions:select"),
  sessionClip: invoke("sessions:clip"),
  appVersion: invoke("app:version"),
  updateCheck: invoke("update:check"),
  updateInstall: invoke("update:install"),
  onUpdateAvailable: on("update:available"),
  onUpdateProgress: on("update:progress"),
  onLiveUpdate: on("live:update"),
  onLiveEnded: on("live:ended"),
  onSessionsChanged: on("sessions:changed"),
  onClipProgress: on("clip:progress"),
});
