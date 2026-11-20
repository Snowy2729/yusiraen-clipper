// Kayıtlar ve ayarlar (bilgisayarda, uygulama veri klasöründe tutulur)
const fs = require("fs");
const path = require("path");

class Store {
  constructor(root, defaultClipFolder) {
    this.root = root;
    this.sessDir = path.join(root, "kayitlar");
    fs.mkdirSync(this.sessDir, { recursive: true });
    this.indexPath = path.join(root, "index.json");
    this.settingsPath = path.join(root, "ayarlar.json");
    this.index = this._read(this.indexPath, { sessions: [] });
    this.settings = {
      channels: ["rraenee"],
      clipFolder: defaultClipFolder,
      clipBefore: 45,
      clipAfter: 15,
      momentCount: 25,
      autoSelect: 10,
      chatDelay: 8,
      offset: 0,
      precise: false,
      keywords: ["bedir", "tuğkan", "nemesis"],
      clipFormat: "yatay",
      verticalStyle: "bulanik",
      closeToTray: true,
      startWithWindows: true,
      autoConnect: true,
      pusherKey: "34bf7a0ff419a2a775b9",
      pusherCluster: "us2",
      ...this._read(this.settingsPath, {}),
    };
    if (this.settings.pusherKey === "32cbd69e4b950bf97679") this.settings.pusherKey = "34bf7a0ff419a2a775b9";
  }
  _read(p, def) {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (_) {
      return def;
    }
  }
  _write(p, o) {
    const tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(o, null, 2));
    fs.renameSync(tmp, p);
  }
  saveIndex() {
    this._write(this.indexPath, this.index);
  }
  saveSettings(s) {
    this.settings = { ...this.settings, ...s };
    this._write(this.settingsPath, this.settings);
    return this.settings;
  }
  file(id) {
    return path.join(this.sessDir, id + ".jsonl");
  }
  get(id) {
    return this.index.sessions.find((s) => s.id === id);
  }
  create(meta) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const s = { id, messageCount: 0, analysis: null, parts: [], ...meta };
    this.index.sessions.push(s);
    fs.writeFileSync(this.file(id), "");
    this.saveIndex();
    return s;
  }
  update(id, patch) {
    const s = this.get(id);
    if (s) Object.assign(s, patch);
    this.saveIndex();
    return s;
  }
  remove(id) {
    this.index.sessions = this.index.sessions.filter((s) => s.id !== id);
    try {
      fs.unlinkSync(this.file(id));
    } catch (_) {}
    this.saveIndex();
  }
  appendMessages(id, msgs) {
    if (!msgs.length) return;
    fs.appendFileSync(this.file(id), msgs.map((m) => JSON.stringify(m)).join("\n") + "\n");
  }
  readMessages(id) {
    const out = [];
    let txt = "";
    try {
      txt = fs.readFileSync(this.file(id), "utf8");
    } catch (_) {}
    for (const line of txt.split("\n")) {
      if (!line) continue;
      try {
        const o = JSON.parse(line);
        if (o.m !== undefined) out.push(o);
      } catch (_) {}
    }
    return out.sort((a, b) => a.t - b.t);
  }
  // Aynı yayıncının, devamı olabilecek önceki kaydı
  findResumeCandidate(slug, livestreamId) {
    const list = this.index.sessions.filter((s) => s.slug === slug).sort((a, b) => (b.recordEnd || "").localeCompare(a.recordEnd || ""));
    const same = list.find((s) => livestreamId && s.livestreamId === livestreamId);
    if (same) return same;
    const recent = list[0];
    if (recent && recent.recordEnd && Date.now() - Date.parse(recent.recordEnd) < 6 * 3600 * 1000) return recent;
    return null;
  }
}

module.exports = { Store };
