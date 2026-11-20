const { app, BrowserWindow, ipcMain, dialog, shell, Notification, Tray, Menu, nativeImage, session: eSession } = require("electron");
const path = require("path");
const fs = require("fs");
const { Store } = require("./store");
const { Recorder } = require("./recorder");
const kick = require("./kick");
const { analyze } = require("./analyzer");
const { makeClips } = require("./clipper");

app.setAppUserModelId("com.yusiraen.clipper");
if (process.env.CLIPPER_DATA) app.setPath("userData", process.env.CLIPPER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let store = null;
let clipping = false;
let tray = null;
const startHidden = process.argv.includes("--hidden");

function send(ch, data) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, data);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#0a0a0a",
    title: "Yusiraen Clipper",
    icon: path.join(__dirname, "..", "assets", "logo.png"),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  if (!startHidden) win.once("ready-to-show", () => win.show());
  win.on("close", (e) => {
    if (app.isQuitting) return;
    if (store.settings.closeToTray) {
      e.preventDefault();
      win.hide();
      if (!store.settings.trayHintShown) {
        store.saveSettings({ trayHintShown: true });
        notify("Yusiraen Clipper arka planda çalışıyor. Saatin yanındaki simgeden açabilir ya da kapatabilirsin.");
      }
      return;
    }
    if (actives.size) {
      const r = dialog.showMessageBoxSync(win, {
        type: "question",
        buttons: ["Kayıtları bitir ve kapat", "Vazgeç"],
        defaultId: 1,
        title: "Yusiraen Clipper",
        message: `Şu an ${actives.size} yayın kaydediliyor. Kapatırsan kayıtlar burada biter.`,
      });
      if (r === 1) return e.preventDefault();
      finishAll("Uygulama kapatıldı");
    }
    app.isQuitting = true;
  });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function notify(body) {
  if (Notification.isSupported()) {
    const n = new Notification({ title: "Yusiraen Clipper", body, icon: path.join(__dirname, "..", "assets", "logo.png") });
    n.on("click", showWindow);
    n.show();
  }
}

function quitFromTray() {
  if (actives.size) {
    showWindow();
    const r = dialog.showMessageBoxSync(win, {
      type: "question",
      buttons: ["Kayıtları bitir ve çık", "Vazgeç"],
      defaultId: 1,
      title: "Yusiraen Clipper",
      message: `Şu an ${actives.size} yayın kaydediliyor. Çıkarsan kayıtlar burada biter.`,
    });
    if (r === 1) return;
  }
  finishAll("Uygulama kapatıldı");
  app.isQuitting = true;
  app.quit();
}

function updateTray() {
  if (!tray) return;
  const list = [...actives.values()];
  tray.setToolTip(list.length ? `Yusiraen Clipper — ${list.length} yayın kaydediliyor` : "Yusiraen Clipper");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Yusiraen Clipper'ı aç", click: showWindow },
      { type: "separator" },
      ...(list.length ? list.map((a) => ({ label: `● ${a.info.username} kaydediliyor`, enabled: false })) : [{ label: "Kayıt yok", enabled: false }]),
      { type: "separator" },
      { label: "Otomatik kayıt", type: "checkbox", checked: !!store.settings.autoConnect, click: (i) => { store.saveSettings({ autoConnect: i.checked }); send("settings:changed", store.settings); } },
      { label: "Çıkış", click: quitFromTray },
    ])
  );
}

function applyLoginItem() {
  if (process.platform !== "win32" || !app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!store.settings.startWithWindows, args: ["--hidden"] });
}

app.on("second-instance", () => showWindow());

app.whenReady().then(() => {
  store = new Store(app.getPath("userData"), path.join(app.getPath("videos"), "Yusiraen Clipper"));
  // Önizleme için: Kick'in video sunucusundan gelen yanıtlara uygulamanın erişmesine izin ver
  eSession.defaultSession.webRequest.onHeadersReceived((d, cb) => {
    const h = d.responseHeaders || {};
    if (d.resourceType === "xmlhttprequest" || d.resourceType === "media" || d.resourceType === "other") {
      const has = Object.keys(h).some((k) => k.toLowerCase() === "access-control-allow-origin");
      if (!has) h["Access-Control-Allow-Origin"] = ["*"];
    }
    cb({ responseHeaders: h });
  });
  createWindow();
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, "..", "assets", "logo.png")).resize({ width: 16, height: 16 });
    tray = new Tray(img);
    tray.on("double-click", showWindow);
    tray.on("click", showWindow);
    updateTray();
  } catch (_) {}
  applyLoginItem();
  setTimeout(autoConnectTick, 15000);
  setInterval(autoConnectTick, 2 * 60 * 1000);
});
app.on("before-quit", () => {
  app.isQuitting = true;
  finishAll("Uygulama kapatıldı");
});
app.on("window-all-closed", () => app.quit());

// ---------------- Ayarlar ----------------
ipcMain.handle("settings:get", () => store.settings);
ipcMain.handle("settings:save", (_, s) => {
  const r = store.saveSettings(s);
  applyLoginItem();
  updateTray();
  return r;
});
ipcMain.handle("settings:pickFolder", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"], defaultPath: store.settings.clipFolder });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("shell:open", (_, p) => {
  if (p && fs.existsSync(p)) shell.openPath(p);
  else if (p) {
    fs.mkdirSync(p, { recursive: true });
    shell.openPath(p);
  }
});
ipcMain.handle("shell:openUrl", (_, u) => shell.openExternal(u));

// ---------------- Canlı yayın (aynı anda en fazla 3) ----------------
const MAX_LIVE = 3;
const actives = new Map(); // slug -> kayıt durumu

function activeForSession(id) {
  for (const a of actives.values()) if (a.session.id === id) return a;
  return null;
}

function sessionSummary(s) {
  if (!s) return null;
  const { id, streamer, slug, title, category, startTime, recordStart, recordEnd, messageCount, parts } = s;
  return { id, streamer, slug, title, category, startTime, recordStart, recordEnd, messageCount, partCount: (parts || []).length, analyzed: !!s.analysis, avatar: s.avatar, recording: !!activeForSession(id) };
}

function oneState(a) {
  const now = Date.now();
  a.times = a.times.filter((t) => now - t < 60000);
  return {
    slug: a.info.slug,
    sessionId: a.session.id,
    status: a.status === "listening" && a.listenSince && now - Math.max(a.lastMsg, a.listenSince) > 90000 ? "silent" : a.status,
    streamer: a.info.username,
    avatar: a.info.avatar,
    title: a.info.livestream ? a.info.livestream.title : a.session.title,
    category: a.info.livestream ? a.info.livestream.category : "",
    viewers: a.info.livestream ? a.info.livestream.viewers : 0,
    startTime: a.session.startTime,
    recordStart: a.partStart,
    messageCount: a.session.messageCount + a.buffer.length,
    rate: a.times.length,
    recent: a.recent,
    merged: a.merged,
  };
}

function liveState() {
  return { max: MAX_LIVE, list: [...actives.values()].map(oneState) };
}

let uiTimer = null;
function ensureUiTimer() {
  if (actives.size && !uiTimer) uiTimer = setInterval(() => send("live:update", liveState()), 1000);
  if (!actives.size && uiTimer) {
    clearInterval(uiTimer);
    uiTimer = null;
    send("live:update", liveState());
  }
}

ipcMain.handle("live:state", () => liveState());

function cleanSlug(x) {
  return String(x || "").trim().toLowerCase().replace(/^https?:\/\/(www\.)?kick\.com\//, "").replace(/[/?#].*$/, "");
}

// Takip listesindeki (veya yazılan) kanallardan hangisi açık?
ipcMain.handle("live:check", async (_, slugInput) => {
  const slugs = slugInput ? [cleanSlug(slugInput)] : store.settings.channels.filter((c) => !actives.has(c));
  if (!slugs.length) return { live: [], offline: [], notFound: [], errors: [], allRecording: true };
  const res = await Promise.all(
    slugs.map(async (slug) => {
      try {
        return await kick.getChannel(slug);
      } catch (e) {
        return { slug, error: e.message };
      }
    })
  );
  return {
    live: res.filter((r) => r.live && !actives.has(r.slug)),
    already: res.filter((r) => r.live && actives.has(r.slug)).map((r) => r.username),
    offline: res.filter((r) => !r.live && !r.error && !r.notFound).map((r) => r.username || r.slug),
    notFound: res.filter((r) => r.notFound).map((r) => r.slug),
    errors: res.filter((r) => r.error).map((r) => `${r.slug}: ${r.error}`),
    free: MAX_LIVE - actives.size,
  };
});

// mode: undefined (önce sor) | "new" | "continue"
ipcMain.handle("live:connect", (_, a) => connectChannel(a));

async function connectChannel({ slug, mode, targetId, auto }) {
  slug = cleanSlug(slug);
  if (actives.has(slug)) return { error: "Bu yayın zaten kaydediliyor." };
  if (actives.size >= MAX_LIVE) return { error: `Aynı anda en fazla ${MAX_LIVE} yayın kaydedilebilir. Önce birini bitir.` };
  let info;
  try {
    info = await kick.getChannel(slug);
  } catch (e) {
    return { error: "Kick'e ulaşılamadı: " + e.message };
  }
  if (info.notFound) return { error: `"${slug}" adında bir Kick kanalı bulunamadı.` };
  if (!info.live || !info.livestream) return { error: `${info.username} şu an yayında değil.` };
  if (actives.has(info.slug)) return { error: "Bu yayın zaten kaydediliyor." };

  if (!mode) {
    const cand = store.findResumeCandidate(info.slug, info.livestream.id);
    if (cand && !activeForSession(cand.id)) {
      // Otomatik bağlanmada soru sorulamaz: Kick'e göre aynı yayınsa birleştir, değilse yeni kayıt
      if (auto) {
        if (cand.livestreamId === info.livestream.id) {
          mode = "continue";
          targetId = cand.id;
        } else mode = "new";
      } else return { needDecision: true, candidate: sessionSummary(cand), sameStream: cand.livestreamId === info.livestream.id, info };
    } else mode = "new";
  }

  const ls = info.livestream;
  const nowIso = new Date().toISOString();
  let session;
  let merged = false;
  if (mode === "continue" && targetId && store.get(targetId) && !activeForSession(targetId)) {
    session = store.get(targetId);
    session.parts.push({ livestreamId: ls.id, startTime: ls.startTime, from: nowIso });
    session.analysis = null;
    store.update(session.id, {});
    merged = true;
  } else {
    session = store.create({
      streamer: info.username,
      slug: info.slug,
      avatar: info.avatar,
      title: ls.title || "(başlıksız yayın)",
      category: ls.category,
      livestreamId: ls.id,
      startTime: ls.startTime || nowIso,
      recordStart: nowIso,
      recordEnd: nowIso,
      parts: [{ livestreamId: ls.id, startTime: ls.startTime || nowIso, from: nowIso }],
    });
  }

  const pk = await kick.resolvePusher({ key: store.settings.pusherKey, cluster: store.settings.pusherCluster });
  if (pk.key !== store.settings.pusherKey || pk.cluster !== store.settings.pusherCluster) store.saveSettings({ pusherKey: pk.key, pusherCluster: pk.cluster });
  const rec = new Recorder({ chatroomId: info.chatroomId, channelId: info.channelId, pusherKey: pk.key, pusherCluster: pk.cluster });
  const a = { session, recorder: rec, info, buffer: [], recent: [], times: [], status: "connecting", partStart: nowIso, merged, lastMsg: 0, listenSince: 0, keyRetries: 0 };
  actives.set(info.slug, a);

  rec.on("status", (st) => {
    a.status = st;
    if (st === "listening" && !a.listenSince) a.listenSince = Date.now();
  });
  rec.on("keyError", async () => {
    if (actives.get(info.slug) !== a) return;
    a.status = "keyError";
    if (a.keyRetries++ >= 3) return;
    const fresh = await kick.resolvePusher(null);
    if (actives.get(info.slug) !== a) return;
    store.saveSettings({ pusherKey: fresh.key, pusherCluster: fresh.cluster });
    rec.setKey(fresh.key, fresh.cluster);
    setTimeout(() => actives.get(info.slug) === a && rec.start(), 3000);
  });
  rec.on("message", (m) => {
    a.lastMsg = Date.now();
    a.buffer.push(m);
    a.times.push(Date.now());
    a.recent.push({ u: m.u, m: m.m.replace(/\[emote:\d+:([^\]]+)\]/g, "$1") });
    if (a.recent.length > 14) a.recent.shift();
  });
  rec.on("streamEnded", () => finishRecording(info.slug, "Yayın kapandı"));
  rec.start();

  a.flushTimer = setInterval(() => flush(a), 2000);
  a.infoTimer = setInterval(async () => {
    try {
      const fresh = await kick.getChannel(info.slug);
      if (fresh.livestream) a.info = fresh;
    } catch (_) {}
  }, 3 * 60 * 1000);
  ensureUiTimer();
  updateTray();
  send("sessions:changed");
  return { ok: true, slug: info.slug, state: liveState(), merged };
}

// Takip listesinden biri yayına girince kendiliğinden kayda başla
const manuallyStopped = new Set(); // "slug:livestreamId" — elle bitirilen yayınlara tekrar bağlanma
let autoBusy = false;
async function autoConnectTick() {
  if (!store || !store.settings.autoConnect || autoBusy) return;
  autoBusy = true;
  try {
    for (const slug of store.settings.channels) {
      if (actives.size >= MAX_LIVE) break;
      if (actives.has(slug)) continue;
      let info;
      try {
        info = await kick.getChannel(slug);
      } catch (_) {
        continue;
      }
      if (!info.live || !info.livestream || actives.has(info.slug)) continue;
      if (manuallyStopped.has(`${info.slug}:${info.livestream.id}`)) continue;
      const r = await connectChannel({ slug: info.slug, auto: true });
      if (r.ok) {
        notify(`${info.username} yayına girdi, kayıt otomatik başladı${r.merged ? " (önceki kayda eklendi)" : ""}.`);
        send("live:autoConnected", { slug: r.slug, streamer: info.username });
      }
    }
  } finally {
    autoBusy = false;
  }
}

function flush(a) {
  if (!a || !a.buffer.length) return;
  const msgs = a.buffer.splice(0);
  store.appendMessages(a.session.id, msgs);
  store.update(a.session.id, { messageCount: a.session.messageCount + msgs.length, recordEnd: new Date().toISOString() });
}

function finishRecording(slug, reason) {
  const a = actives.get(slug);
  if (!a) return null;
  flush(a);
  a.recorder.stop();
  clearInterval(a.flushTimer);
  clearInterval(a.infoTimer);
  const last = a.session.parts[a.session.parts.length - 1];
  if (last) last.to = new Date().toISOString();
  store.update(a.session.id, { recordEnd: new Date().toISOString() });
  actives.delete(slug);
  if (reason === "Yayın Bitti'ye basıldı" && a.info.livestream) manuallyStopped.add(`${slug}:${a.info.livestream.id}`);
  ensureUiTimer();
  updateTray();
  send("live:ended", { slug, reason, session: sessionSummary(a.session) });
  send("sessions:changed");
  if (reason !== "Uygulama kapatıldı" && reason !== "Güncelleme için kapatıldı") notify(`${a.session.streamer} kaydı bitti (${reason}). ${a.session.messageCount} mesaj kaydedildi.`);
  return sessionSummary(a.session);
}

function finishAll(reason) {
  for (const slug of [...actives.keys()]) finishRecording(slug, reason);
}

ipcMain.handle("live:stop", (_, slug) => finishRecording(slug, "Yayın Bitti'ye basıldı"));

// ---------------- Kayıtlar ----------------
ipcMain.handle("sessions:list", () => store.index.sessions.map(sessionSummary));

ipcMain.handle("sessions:get", (_, id) => {
  const s = store.get(id);
  if (!s) return null;
  return { ...sessionSummary(s), parts: s.parts, analysis: s.analysis };
});

ipcMain.handle("sessions:delete", (_, id) => {
  if (activeForSession(id)) return { error: "Bu yayın şu an kaydediliyor." };
  store.remove(id);
  send("sessions:changed");
  return { ok: true };
});

ipcMain.handle("sessions:rename", (_, { id, title }) => {
  store.update(id, { title });
  send("sessions:changed");
  return { ok: true };
});

// Bir anın hangi yayın parçasına (VOD'a) düştüğünü bulur
function partFor(session, absMs) {
  const parts = session.parts && session.parts.length ? session.parts : [{ livestreamId: session.livestreamId, startTime: session.startTime }];
  let chosen = parts[0];
  for (const p of parts) if (Date.parse(p.from || p.startTime) <= absMs) chosen = p;
  return { part: chosen, index: parts.indexOf(chosen) };
}

ipcMain.handle("sessions:analyze", (_, id) => {
  flush(activeForSession(id));
  const s = store.get(id);
  if (!s) return { error: "Kayıt bulunamadı" };
  const msgs = store.readMessages(id);
  const st = store.settings;
  const startMs = Date.parse(s.startTime);
  const res = analyze(msgs, startMs, {
    momentCount: st.momentCount,
    clipBefore: st.clipBefore,
    clipAfter: st.clipAfter,
    chatDelay: st.chatDelay,
    keywords: st.keywords || [],
  });
  if (res.tooFew) return { error: `Bu kayıtta sadece ${msgs.length} mesaj var, analiz için çok az.` };
  // Birleştirilmiş kayıtlarda her anın kendi VOD'undaki zamanını hesapla
  for (const m of res.moments) {
    const abs = startMs + m.peak * 1000;
    const { part, index } = partFor(s, abs);
    const shift = (Date.parse(part.startTime || s.startTime) - startMs) / 1000;
    m.part = index;
    m.vodPeak = Math.max(0, m.peak - shift);
    m.vodStart = Math.max(0, m.start - shift);
    m.vodEnd = Math.max(0, m.end - shift);
  }
  res.selected = res.moments.filter((m) => m.type !== "isim").slice(0, st.autoSelect).map((m) => m.rank);
  res.messageCount = msgs.length;
  store.update(id, { analysis: res });
  send("sessions:changed");
  return { ok: true, analysis: res };
});

ipcMain.handle("sessions:select", (_, { id, selected }) => {
  const s = store.get(id);
  if (s && s.analysis) {
    s.analysis.selected = selected;
    store.update(id, {});
  }
  return { ok: true };
});

// Önizleme için anın düştüğü yayın kaydının (VOD) adresi
ipcMain.handle("sessions:vod", async (_, { id, part, vodUrl }) => {
  const s = store.get(id);
  if (!s) return { error: "Kayıt bulunamadı" };
  s.vodCache = s.vodCache || {};
  if (!vodUrl && s.vodCache[part || 0]) return { source: s.vodCache[part || 0].source };
  const parts = s.parts && s.parts.length ? s.parts : [{ livestreamId: s.livestreamId, startTime: s.startTime }];
  const p = parts[part || 0] || parts[0];
  try {
    const vod = await kick.findVod(s.slug, p.livestreamId, p.startTime, vodUrl || null);
    if (!vod) return { error: "Bu yayının kaydı (VOD) Kick'te henüz yok. Yayın bittikten sonra tekrar dene, ya da VOD linkini yapıştır.", needVodUrl: true };
    s.vodCache[part || 0] = vod;
    store.update(id, {});
    return { source: vod.source };
  } catch (e) {
    return { error: "VOD bulunamadı: " + e.message, needVodUrl: true };
  }
});

// Bir anın başlangıç/bitişini elle ayarla (null = sıfırla)
ipcMain.handle("sessions:adjust", (_, { id, rank, start, end }) => {
  const s = store.get(id);
  if (!s || !s.analysis) return { error: "Kayıt bulunamadı" };
  const m = s.analysis.moments.find((x) => x.rank === rank);
  if (!m) return { error: "An bulunamadı" };
  if (start == null) {
    delete m.adjStart;
    delete m.adjEnd;
  } else {
    m.adjStart = Math.max(0, Math.round(start * 10) / 10);
    m.adjEnd = Math.max(m.adjStart + 1, Math.round(end * 10) / 10);
  }
  store.update(id, {});
  return { ok: true, moment: m };
});

ipcMain.handle("sessions:clip", async (_, { id, ranks, vodUrl }) => {
  if (clipping) return { error: "Zaten klip alınıyor." };
  const s = store.get(id);
  if (!s || !s.analysis) return { error: "Önce analiz et." };
  const st = store.settings;
  const chosen = s.analysis.moments.filter((m) => ranks.includes(m.rank));
  if (!chosen.length) return { error: "Hiç an seçilmedi." };
  clipping = true;
  try {
    // Parçalara göre grupla (her parçanın kendi VOD'u var)
    const groups = new Map();
    for (const m of chosen) {
      const k = m.part || 0;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(m);
    }
    const parts = s.parts && s.parts.length ? s.parts : [{ livestreamId: s.livestreamId, startTime: s.startTime }];
    const all = [];
    let dir = null;
    let done = 0;
    for (const [pi, list] of groups) {
      const part = parts[pi] || parts[0];
      send("clip:progress", { phase: "vod", text: "Yayın kaydı (VOD) aranıyor..." });
      let vod;
      try {
        vod = (!vodUrl && s.vodCache && s.vodCache[pi]) || (await kick.findVod(s.slug, part.livestreamId, part.startTime, groups.size === 1 ? vodUrl : null));
      } catch (e) {
        return { error: "VOD bulunamadı: " + e.message, needVodUrl: true };
      }
      if (!vod) return { error: "Bu yayının kaydı (VOD) Kick'te henüz yok ya da yayıncı kaydı kapatmış. VOD linkini aşağıya yapıştırıp tekrar dene.", needVodUrl: true };
      const moments = list.map((m) =>
        m.adjStart != null
          ? { ...m, start: m.adjStart, end: m.adjEnd, peak: m.vodPeak ?? m.peak, adjusted: true }
          : { ...m, start: m.vodStart ?? m.start, end: m.vodEnd ?? m.end, peak: m.vodPeak ?? m.peak }
      );
      const r = await makeClips({
        source: vod.source,
        session: s,
        moments,
        folder: st.clipFolder,
        offset: Number(st.offset) || 0,
        precise: !!st.precise,
        format: st.clipFormat || "yatay",
        verticalStyle: st.verticalStyle || "bulanik",
        onProgress: (p) => send("clip:progress", { phase: "cut", index: done + p.index, total: chosen.length, frac: p.frac, rank: p.rank }),
      });
      done += list.length;
      dir = r.dir;
      all.push(...r.results);
    }
    const ok = all.filter((r) => r.ok).length;
    send("clip:progress", { phase: "done" });
    return { ok: true, dir, made: ok, failed: all.filter((r) => !r.ok) };
  } finally {
    clipping = false;
  }
});

// ---------------- Güncelleme ----------------
const updater = require("./updater");
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
app.whenReady().then(() => {
  setTimeout(autoCheck, 8000);
  setInterval(autoCheck, 6 * 3600 * 1000);
});
ipcMain.handle("app:version", () => app.getVersion());
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
    finishAll("Güncelleme için kapatıldı");
    app.isQuitting = true;
    if (process.env.UPDATE_DRYRUN) return { ok: true, file };
    updater.installAndQuit(file);
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});
