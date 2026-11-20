// Kayıtlı mesajlar: her bağlantı (kanal + başlangıç zamanı) diske kaydedilir.
//   <id>.ndjson  → her satır bir mesaj; ayrıca {relabel}, {ev:"live"|"offline"} satırları
//   <id>.json    → özet + şüpheliler (periyodik ve bağlantı bitince güncellenir)
const fs = require("fs");
const path = require("path");

function stamp(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
const SAFE_ID = /^[a-z0-9_.-]+-\d{8}-\d{6}$/i;

class SessionStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.cur = null;
  }

  start(info) {
    this.end();
    const t = Date.now();
    const id = `${String(info.slug).replace(/[^a-z0-9_.-]/gi, "")}-${stamp(t)}`;
    this.cur = {
      meta: { id, slug: info.slug, name: info.name, avatar: info.avatar || null, startedAt: t, endedAt: null, wasLive: !!info.live, liveAtStart: !!info.live, title: info.title || null, msgCount: 0, flagCount: 0, suspectCount: 0 },
      buf: [],
      suspects: [],
    };
    return id;
  }

  get id() {
    return this.cur && this.cur.meta.id;
  }

  // mesajları biriktir; flush ile dosyaya yazılır
  add(msgs) {
    if (!this.cur) return;
    for (const m of msgs) {
      this.cur.buf.push(JSON.stringify({ id: m.id, t: m.t, u: m.u, key: m.key, color: m.color || null, badges: m.badges || [], m: m.m, flags: m.flags, maxSev: m.maxSev }));
      this.cur.meta.msgCount++;
      if (m.maxSev > 0) this.cur.meta.flagCount++;
    }
  }
  relabel(r) {
    if (this.cur) this.cur.buf.push(JSON.stringify({ relabel: r }));
  }
  event(ev, extra = {}) {
    if (!this.cur) return;
    if (ev === "live") {
      this.cur.meta.wasLive = true;
      if (extra.title) this.cur.meta.title = extra.title;
    }
    this.cur.buf.push(JSON.stringify({ ev, t: Date.now(), ...extra }));
  }

  flush() {
    if (!this.cur || !this.cur.buf.length) return;
    try {
      fs.appendFileSync(path.join(this.dir, this.cur.meta.id + ".ndjson"), this.cur.buf.join("\n") + "\n");
      this.cur.buf = [];
    } catch (_) {}
  }

  saveMeta(suspects) {
    if (!this.cur) return;
    this.flush();
    if (!this.cur.meta.msgCount) return; // boş bağlantıyı kaydetme
    if (suspects) this.cur.suspects = suspects;
    this.cur.meta.suspectCount = this.cur.suspects.length;
    try {
      fs.writeFileSync(path.join(this.dir, this.cur.meta.id + ".json"), JSON.stringify({ meta: this.cur.meta, suspects: this.cur.suspects }));
    } catch (_) {}
  }

  end(suspects) {
    if (!this.cur) return null;
    this.cur.meta.endedAt = Date.now();
    this.saveMeta(suspects);
    const meta = this.cur.meta;
    this.cur = null;
    return meta.msgCount ? meta : null;
  }

  list() {
    const out = [];
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(this.dir, f), "utf8"));
        const m = j.meta;
        let bytes = 0;
        try {
          bytes = fs.statSync(path.join(this.dir, m.id + ".ndjson")).size;
        } catch (_) {}
        out.push({ ...m, bytes, active: !!(this.cur && this.cur.meta.id === m.id) });
      } catch (_) {}
    }
    return out.sort((a, b) => b.startedAt - a.startedAt);
  }

  open(id) {
    if (!SAFE_ID.test(id)) return { error: "Geçersiz kayıt." };
    if (this.cur && this.cur.meta.id === id) this.flush();
    let j;
    try {
      j = JSON.parse(fs.readFileSync(path.join(this.dir, id + ".json"), "utf8"));
    } catch (_) {
      return { error: "Kayıt bulunamadı." };
    }
    if (this.cur && this.cur.meta.id === id) j.meta = { ...this.cur.meta };
    const messages = [];
    const byId = new Map();
    let txt = "";
    try {
      txt = fs.readFileSync(path.join(this.dir, id + ".ndjson"), "utf8");
    } catch (_) {}
    for (const line of txt.split(/\r?\n/)) {
      if (!line) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch (_) {
        continue;
      }
      if (o.relabel) {
        for (const mid of o.relabel.ids || []) {
          const m = byId.get(mid);
          if (m && !m.flags.some((f) => f.cat === o.relabel.flag.cat)) {
            m.flags.push(o.relabel.flag);
            m.maxSev = Math.max(m.maxSev || 0, o.relabel.flag.sev);
          }
        }
      } else if (o.ev) {
        messages.push({ sys: o.ev, t: o.t, title: o.title || null });
      } else {
        messages.push(o);
        if (o.id) byId.set(o.id, o);
      }
    }
    return { meta: j.meta, suspects: j.suspects || [], messages };
  }

  remove(id) {
    if (!SAFE_ID.test(id)) return { error: "Geçersiz kayıt." };
    if (this.cur && this.cur.meta.id === id) return { error: "Şu an kaydedilen bağlantı silinemez. Önce kanaldan ayrıl." };
    for (const ext of [".json", ".ndjson"]) {
      try {
        fs.unlinkSync(path.join(this.dir, id + ext));
      } catch (_) {}
    }
    return { ok: true };
  }
}

module.exports = { SessionStore };
