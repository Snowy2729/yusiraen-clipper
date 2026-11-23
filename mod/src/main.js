// Yusiraen Mod — ana süreç
const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require("electron");
const path = require("path");
const fs = require("fs");
const kick = require("./kick");
const { Recorder } = require("./recorder");
const { Detector } = require("./detector");
const updater = require("./updater");
const { SessionStore } = require("./sessions");

app.setAppUserModelId("com.yusiraen.mod");
if (process.env.MOD_DATA) app.setPath("userData", process.env.MOD_DATA);
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let settings = null;
let settingsPath = null;
const detector = new Detector();
let live = null; // { slug, info, recorder }
let outQueue = [];
let flushTimer = null;
let store = null; // kayıtlı mesajlar
let metaTimer = null;
function suspectList() {
  return [...detector.users.values()].filter((u) => u.flagged > 0).map(summary);
}

const DEFAULTS = {
  lastChannel: "",
  customWords: [],
  spoiler: true,
  spoilerWords: [],
  profanity: true,
  insults: true,
  threats: true,
  spam: true,
  pollution: true,
  caps: true,
  links: true,
  fights: true,
  hidden: true,
  acrostic: true,
  ignoreMods: true,
  ignoreSubs: false,
  sound: true,
  defaultTimeout: 10,
  pusherKey: "34bf7a0ff419a2a775b9",
  pusherCluster: "us2",
};

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath, "utf8")) };
  } catch (_) {
    return { ...DEFAULTS };
  }
}
function saveSettings(patch) {
  settings = { ...settings, ...patch };
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  detector.setOptions(settings);
  return settings;
}
function send(ch, d) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, d);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1050,
    minHeight: 640,
    backgroundColor: "#0a0a0a",
    title: "Yusiraen Mod",
    icon: path.join(__dirname, "..", "assets", "logo.png"),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.whenReady().then(() => {
  settingsPath = path.join(app.getPath("userData"), "ayarlar.json");
  settings = loadSettings();
  detector.setOptions(settings);
  store = new SessionStore(path.join(app.getPath("userData"), "kayitlar"));
  createWindow();
  setTimeout(autoCheck, 8000);
  setInterval(autoCheck, 6 * 3600 * 1000);
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  if (live) {
    flushOut();
    live.recorder.stop();
    if (store) store.end(suspectList());
  }
});

// ---------------- Ayarlar ----------------
ipcMain.handle("settings:get", () => settings);
ipcMain.handle("settings:save", (_, p) => saveSettings(p));
ipcMain.handle("app:version", () => app.getVersion());
ipcMain.handle("shell:openUrl", (_, u) => shell.openExternal(u));

// ---------------- Kanala bağlan ----------------
function summary(u) {
  return {
    key: u.key,
    name: u.name,
    id: u.id,
    flagged: u.flagged,
    score: u.score,
    cats: u.cats,
    lastAt: u.lastAt,
    last: u.last ? { id: u.last.id, t: u.last.t, m: u.last.m, flags: u.last.flags, maxSev: u.last.maxSev } : null,
    partners: [...u.partners],
    msgCount: u.msgs.length,
    dismissedAt: u.dismissedAt,
  };
}

function flushOut() {
  if (!outQueue.length) return;
  const batch = outQueue.splice(0);
  const users = new Map();
  for (const b of batch) for (const u of b.users) users.set(u.key, u);
  const relabels = batch.flatMap((b) => b.relabels || []);
  send("chat:batch", { messages: batch.map((b) => b.msg), users: [...users.values()].map(summary), relabels });
  if (store) {
    store.add(batch.map((b) => b.msg));
    for (const r of relabels) store.relabel(r);
    store.flush();
  }
}

// Yayın durumu: bağlantı yayın açık ya da kapalıyken sürer; sadece etiket değişir.
let liveTimer = null;
function liveInfo() {
  const i = live.info;
  return { live: i.live, title: i.livestream && i.livestream.title, viewers: i.livestream && i.livestream.viewers };
}
function setLive(on, extra = {}) {
  const was = live.info.live;
  live.info.live = on;
  if (on) live.info.livestream = { ...(live.info.livestream || {}), ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v != null)) };
  else live.info.livestream = null;
  if (was !== on && store) store.event(on ? "live" : "offline", on ? { title: live.info.livestream && live.info.livestream.title } : {});
  send("chat:live", { ...liveInfo(), changed: was !== on });
}
async function refreshLive(rec) {
  if (!live || live.recorder !== rec) return;
  try {
    const i = await kick.getChannel(live.slug);
    if (!live || live.recorder !== rec || i.notFound) return;
    live.info.livestream = i.livestream;
    setLive(i.live, i.livestream ? { title: i.livestream.title, viewers: i.livestream.viewers } : {});
  } catch (_) {}
}

function disconnect() {
  if (!live) return;
  clearInterval(liveTimer);
  liveTimer = null;
  clearInterval(metaTimer);
  metaTimer = null;
  flushOut();
  const saved = store ? store.end(suspectList()) : null;
  live.recorder.stop();
  live = null;
  clearInterval(flushTimer);
  flushTimer = null;
  send("chat:disconnected", { saved });
}

ipcMain.handle("chat:connect", async (_, slugIn) => {
  const slug = String(slugIn || "").trim().toLowerCase().replace(/^https?:\/\/(www\.)?kick\.com\//, "").replace(/[/?#].*$/, "");
  if (!slug) return { error: "Kanal adı yaz." };
  let info;
  try {
    info = await kick.getChannel(slug);
  } catch (e) {
    return { error: "Kick'e ulaşılamadı: " + e.message };
  }
  if (info.notFound) return { error: `"${slug}" adında bir Kick kanalı bulunamadı.` };
  disconnect();
  detector.reset();
  const pk = await kick.resolvePusher({ key: settings.pusherKey, cluster: settings.pusherCluster });
  if (pk.key !== settings.pusherKey) saveSettings({ pusherKey: pk.key, pusherCluster: pk.cluster });
  const rec = new Recorder({ chatroomId: info.chatroomId, channelId: info.channelId, pusherKey: pk.key, pusherCluster: pk.cluster });
  live = { slug: info.slug, info, recorder: rec, status: "connecting" };
  rec.on("status", (s) => {
    if (live && live.recorder === rec) {
      live.status = s;
      send("chat:status", s);
    }
  });
  rec.on("keyError", async () => {
    const fresh = await kick.resolvePusher(null);
    saveSettings({ pusherKey: fresh.key, pusherCluster: fresh.cluster });
    rec.setKey(fresh.key, fresh.cluster);
    setTimeout(() => live && live.recorder === rec && rec.start(), 2000);
  });
  rec.on("message", (m) => {
    const { entry, user, touched, relabels } = detector.analyze(m);
    const msg = { id: m.id, t: entry.t, u: m.u, key: user.key, uid: m.uid, color: m.color, badges: m.badges, m: m.m, flags: entry.flags, maxSev: entry.maxSev };
    outQueue.push({ msg, users: [user, touched].filter((x) => x && x.flagged), relabels });
    if (entry.maxSev >= 3 && !win.isFocused() && Notification.isSupported()) {
      new Notification({ title: `Yusiraen Mod — ${entry.flags[0].label}`, body: `${m.u}: ${m.m.slice(0, 120)}` }).show();
    }
  });
  rec.on("modEvent", (e) => send("chat:modEvent", e));
  rec.on("streamStarted", (ls) => {
    if (!live || live.recorder !== rec) return;
    setLive(true, ls ? { title: ls.session_title || ls.title, viewers: ls.viewer_count || ls.viewers } : {});
    setTimeout(() => refreshLive(rec), 15000); // başlık/izleyici sayısını Kick'ten tazele
  });
  rec.on("streamEnded", () => live && live.recorder === rec && setLive(false));
  rec.start();
  if (store) store.start({ slug: info.slug, name: info.username, avatar: info.avatar, live: info.live, title: info.livestream && info.livestream.title });
  clearInterval(metaTimer);
  metaTimer = setInterval(() => store && store.saveMeta(suspectList()), 15000);
  clearInterval(liveTimer);
  liveTimer = setInterval(() => refreshLive(rec), 2 * 60 * 1000);
  flushTimer = setInterval(flushOut, 200);
  saveSettings({ lastChannel: info.slug });
  return { ok: true, channel: { slug: info.slug, name: info.username, avatar: info.avatar, live: info.live, title: info.livestream && info.livestream.title, viewers: info.livestream && info.livestream.viewers } };
});
ipcMain.handle("chat:disconnect", () => {
  disconnect();
  return { ok: true };
});

// ---------------- Kullanıcı detayı ----------------
ipcMain.handle("user:detail", async (_, key) => {
  const u = detector.users.get(String(key).toLowerCase());
  if (!u) return { error: "Kullanıcı bulunamadı." };
  const card = live ? await kick.userCard(live.slug, u.name) : null;
  if (card && card.id && !u.id) u.id = card.id;
  return { user: summary(u), messages: u.msgs.map((x) => ({ id: x.id, t: x.t, m: x.m, flags: x.flags, maxSev: x.maxSev })), card };
});
// ---------------- Kayıtlı mesajlar ----------------
ipcMain.handle("sessions:list", () => {
  if (store && store.id) store.saveMeta(suspectList());
  return store ? store.list() : [];
});
ipcMain.handle("sessions:open", (_, id) => {
  if (store && store.id === id) store.saveMeta(suspectList());
  return store ? store.open(String(id)) : { error: "Kayıt yok." };
});
ipcMain.handle("sessions:delete", (_, id) => (store ? store.remove(String(id)) : { error: "Kayıt yok." }));
ipcMain.handle("sessions:folder", () => store && shell.openPath(store.dir));

ipcMain.handle("user:dismiss", (_, key) => {
  const u = detector.users.get(String(key).toLowerCase());
  if (u) u.dismissedAt = Date.now();
  return { ok: true };
});

// ---------------- Güncelleme ----------------
let pendingUpdate = null;
async function autoCheck() {
  try {
    const r = await updater.check();
    if (r.available) {
      pendingUpdate = r;
      send("update:available", r);
    }
  } catch (_) {}
}
ipcMain.handle("update:check", async () => {
  try {
    const r = await updater.check();
    if (r.available) pendingUpdate = r;
    return r;
  } catch (e) {
    return { error: e.message };
  }
});
ipcMain.handle("update:install", async () => {
  if (!pendingUpdate) return { error: "Güncelleme bulunamadı." };
  try {
    const file = await updater.download(pendingUpdate, (f) => send("update:progress", f));
    disconnect();
    if (process.env.UPDATE_DRYRUN) return { ok: true, file };
    updater.installAndQuit(file);
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});
