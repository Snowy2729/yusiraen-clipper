// Yusiraen Mod — sohbet algılayıcı
// Küfür, hakaret, tehdit, spam/flood, caps, link, kavga ve kullanıcının eklediği özel kelimeleri yakalar.
// Kaçamakları da yakalar: "s.i.k.t.i.r", "siiiktir", "4mk", "S İ K"...

// ---------- Normalizasyon ----------
const FOLD = { ç: "c", ğ: "g", ı: "i", i̇: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u", é: "e", ä: "a" };
const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b", "@": "a", $: "s", "€": "e", "|": "i" };

function stripEmotes(t) {
  return String(t || "").replace(/\[emote:\d+:([^\]]*)\]/g, " ");
}
function fold(t) {
  return String(t)
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşüâîûéä]|i̇/g, (c) => FOLD[c] || c);
}
// Tek harfleri ayıran noktalama/boşlukları birleştir: "s.i.k.t.i.r" / "s i k" -> "sik..."
function joinSpaced(t) {
  return t.replace(/(?:^|(?<=\s))((?:[a-z0-9@$*][\s.\-_*+|,'"]+){1,}[a-z0-9@$*])(?=\s|$)/g, (m) => m.replace(/[\s.\-_+|,'"]+/g, ""));
}
function leet(tok) {
  // sadece harfle karışık sayılarda çevir (ör. "4mk", "s1kt1r"); saf sayıları ellemez
  if (!/[a-z]/.test(tok)) return tok;
  return tok.replace(/[0134578@$€|]/g, (c) => LEET[c] || c).replace(/\*/g, "i");
}
function collapse(tok) {
  return tok.replace(/([a-z])\1+/g, "$1");
}
function normalize(text) {
  const base = joinSpaced(fold(stripEmotes(text)));
  const tokens = base
    .split(/[^a-z0-9@$*€|]+/)
    .filter(Boolean)
    .map((t) => collapse(leet(t)));
  return { tokens, flat: " " + tokens.join(" ") + " " };
}

// ---------- Sözlük ----------
// Kökler "collapse" edilmiş halde yazılır (yarrak -> yarak, taşşak -> tasak)
const PROFANITY_PREFIX = [
  "amina", "aminak", "amcik", "amcig", "aminiz", "aminako", "orospu", "orosbu", "orspu", "orsbu", "yarak", "yarag", "dalyarak", "dalyarag",
  "kahpe", "pezevenk", "pezeveng", "gavat", "kaltak", "ibne", "pust", "surtuk", "surtug", "yavsak", "tasak", "tasag", "kancik", "kancig", "kevase",
  "gotveren", "gotlek", "gotos", "gotun", "gotune", "gotunu", "dalama", "sikis", "siktir", "sikim", "sikik", "sikeyim", "sikerim", "siker", "sikecem", "sikicem",
  "sikiyim", "siktig", "siktim", "sikmis", "sikmek", "sikti", "sikin", "sikini", "sikimi", "sikimin", "sikiy", "pickurus", "piclik",
];
const PROFANITY_EXACT = ["amk", "amq", "aq", "amk", "mk", "oc", "pic", "sik", "amcik", "yarak", "got", "amin_kodugum", "awk", "amaq", "sg", "siktr", "sktr", "skm", "skrm", "skym"];
// "sık-" ile başlayan masum kelimelerin ASCII yazımları
const SIK_WHITELIST = /^sik(inti|il|ici|ica|istir|isik|isma|ist|ca|ma$|i$|isi$|isin|ilan|ilma|ilmak|iyor|ildi|ildim|iliyor|ilan)/;
// "amin" (âmin) gibi masum kelimeler
const SAFE_EXACT = new Set(["amin", "amine", "got_it", "sikke", "sikh"]);

const INSULT_EXACT = [
  "salak", "aptal", "gerizekali", "gerzek", "mal", "dangalak", "serefsiz", "haysiyetsiz", "karaktersiz", "beyinsiz", "embesil", "ahmak", "okuz",
  "ezik", "lavuk", "angut", "ucube", "hiyar", "esek", "kopek", "hayvan", "pislik", "sersem", "odun", "keko", "yobaz", "cahil", "denyo",
  "mankafa", "gerizekalisin", "salaksin", "aptalsin", "malsin", "ibnesin", "serefsizsin", "ezikler", "salaklar", "aptallar", "mallar",
];
const INSULT_PREFIX = ["gerizekal", "serefsiz", "haysiyetsiz", "dangalak", "embesil", "beyinsiz", "salak", "aptal"];
// Bu kelimeler ancak birine söylenince (sen/lan/@kullanıcı) hakaret sayılır: "hayvan gibi oynadı" övgü olabilir
const WEAK_INSULTS = new Set(["mal", "hayvan", "kopek", "esek", "odun", "cahil", "pislik", "keko", "hiyar", "okuz", "sersem", "yobaz", "ucube", "ezik"]);

const THREAT_RE = /\b(oldur(ur|ece|ecem|icem|eyim)|gebert|kafan(i|izi) (kir|kopar|ez)|seni (bul(ur|aca|ac)|gebert|oldur)|adresini (bul|bili)|dov(er|ece|ecem|icem)|bicak(lar|la)|vurur(um|uz)|kafana sik|evini bas|ananin evine)/;
const DIRECT_TOKENS = new Set(["sen", "seni", "senin", "sana", "lan", "olum", "oglum", "len", "ula", "lyn", "siz", "sizin", "size", "aga"]);
const LINK_RE = /(https?:\/\/|www\.|discord\.gg|\b[a-z0-9-]{2,}\.(com|net|org|gg|tv|xyz|ru|io|me|link|site|live|shop|store|app)\b)/i;
const KICK_LINK_RE = /(^|\W)(kick\.com)(\/|\b)/i;

const SEV = { 1: "düşük", 2: "orta", 3: "yüksek" };
const CATS = {
  kufur: "Küfür",
  hakaret: "Hakaret",
  tehdit: "Tehdit",
  kavga: "Kavga",
  spam: "Spam",
  flood: "Flood",
  caps: "Caps",
  link: "Link",
  ozel: "Özel kelime",
};

function matchProfanity(tokens, rawLower) {
  const hits = [];
  for (const t of tokens) {
    if (SAFE_EXACT.has(t)) continue;
    if (t.startsWith("sik")) {
      // "sık" (ı ile) yazılmışsa masum kelimedir: sıkıntı, sıkıldım, sıkı...
      if (/sık/.test(rawLower) && !/sik/.test(rawLower)) continue;
      if (SIK_WHITELIST.test(t)) continue;
    }
    if (t === "got" && !/göt/.test(rawLower)) continue; // ingilizce "got"
    if (PROFANITY_EXACT.includes(t) || PROFANITY_PREFIX.some((p) => t.startsWith(p))) hits.push(t);
  }
  return hits;
}

function insultRoot(t) {
  if (INSULT_EXACT.includes(t) || INSULT_PREFIX.some((p) => t.startsWith(p))) return t;
  // ek atılmış hali: hayvansın, köpekler, salaklığı, malın...
  const r = t.replace(/(siniz|sunuz|sin|sun|lar|ler|ligi|lugu|lik|luk|lig|ga|ge|in|un|i|u|a|e)$/, "");
  return r.length >= 3 && INSULT_EXACT.includes(r) ? r : null;
}
function matchInsult(tokens) {
  return tokens.map(insultRoot).filter(Boolean);
}

function capsInfo(raw) {
  const t = stripEmotes(raw).replace(/https?:\/\/\S+/g, "").replace(/@\S+/g, "");
  const letters = t.match(/\p{L}/gu) || [];
  if (letters.length < 8) return { caps: false, letters: letters.length };
  const up = letters.filter((c) => c !== c.toLocaleLowerCase("tr-TR") && c === c.toLocaleUpperCase("tr-TR")).length;
  return { caps: up / letters.length >= 0.8, letters: letters.length };
}

// ---------- Algılayıcı ----------
class Detector {
  constructor(opts = {}) {
    this.users = new Map(); // username(küçük) -> kullanıcı durumu
    this.edges = []; // kavga takibi: {from, to, t}
    this.setOptions(opts);
  }

  setOptions(o) {
    this.opt = {
      profanity: true,
      insults: true,
      threats: true,
      spam: true,
      caps: true,
      links: true,
      fights: true,
      ignoreMods: true,
      ignoreSubs: false,
      customWords: [],
      ...this.opt,
      ...o,
    };
    this.custom = (this.opt.customWords || [])
      .map((w) => String(w).trim())
      .filter((w) => w.length >= 2)
      .map((w) => ({ word: w, norm: normalize(w).tokens.join(" ") }))
      .filter((c) => c.norm.length >= 2);
  }

  reset() {
    this.users.clear();
    this.edges = [];
  }

  user(name, id) {
    const k = String(name).toLowerCase();
    let u = this.users.get(k);
    if (!u) {
      u = { key: k, name, id, msgs: [], flagged: 0, score: 0, cats: {}, last: null, lastAt: 0, dismissedAt: 0, partners: new Set() };
      this.users.set(k, u);
    }
    if (id && !u.id) u.id = id;
    return u;
  }

  // msg: {id, t, u, uid, m, badges: []}
  analyze(msg) {
    const now = msg.t || Date.now();
    const u = this.user(msg.u, msg.uid);
    const badges = (msg.badges || []).map((b) => String(b).toLowerCase());
    const isMod = badges.some((b) => /moderator|broadcaster|staff/.test(b));
    const isSub = badges.some((b) => /subscriber|founder|og|vip/.test(b));
    const raw = String(msg.m || "");
    const rawLower = raw.toLocaleLowerCase("tr-TR");
    const { tokens, flat } = normalize(raw);
    const flags = [];
    const add = (cat, sev, match) => flags.push({ cat, label: CATS[cat], sev, match });
    const skip = (isMod && this.opt.ignoreMods) || (isSub && this.opt.ignoreSubs);

    if (!skip) {
      // özel kelimeler (öncelikli)
      for (const c of this.custom) {
        const hit = c.norm.includes(" ") ? flat.includes(" " + c.norm + " ") || flat.replace(/ /g, "").includes(c.norm.replace(/ /g, "")) : tokens.some((t) => t === c.norm || (c.norm.length >= 4 && t.startsWith(c.norm)));
        if (hit) add("ozel", 3, c.word);
      }
      const directed = /@\w/.test(raw) || tokens.some((t) => DIRECT_TOKENS.has(t));
      if (this.opt.profanity) {
        const p = matchProfanity(tokens, rawLower);
        const anan = /\b(anan|anani|ananin|anana|bacini|bacin|bacina|sulaleni|sulaleni)\b/.test(flat) && /\b(sik|am|koy|kodug)/.test(flat);
        if (p.length || anan) add("kufur", directed || anan ? 3 : 2, anan ? "ana/bacı küfrü" : p.slice(0, 3).join(", "));
      }
      if (this.opt.insults) {
        const ins = matchInsult(tokens).filter((w) => directed || !WEAK_INSULTS.has(w));
        if (ins.length) add("hakaret", directed ? 2 : 1, ins.slice(0, 3).join(", "));
      }
      if (this.opt.threats && THREAT_RE.test(flat)) add("tehdit", 3, flat.match(THREAT_RE)[0].trim());
      if (this.opt.links && LINK_RE.test(raw) && !(KICK_LINK_RE.test(raw) && !/discord|http(?!s:\/\/kick\.com)/i.test(raw.replace(KICK_LINK_RE, "")))) add("link", 2, (raw.match(LINK_RE) || [""])[0]);

      // spam / flood / caps (kullanıcı geçmişine bakar)
      const recent = u.msgs.filter((x) => now - x.t < 60000);
      if (this.opt.spam) {
        const normText = tokens.join(" ");
        const same = normText.length >= 3 ? recent.filter((x) => x.norm === normText).length : 0;
        const inner = /(.)\1{14,}/.test(raw) || hasWordRepeat(tokens, 6);
        if (same >= 2) add("spam", same >= 4 ? 2 : 1, `aynı mesaj ${same + 1}. kez`);
        else if (inner) add("spam", 1, "tekrar eden karakter/kelime");
        const last10 = u.msgs.filter((x) => now - x.t < 10000).length;
        if (last10 >= 5) add("flood", 2, `10 sn'de ${last10 + 1} mesaj`);
      }
      if (this.opt.caps) {
        const c = capsInfo(raw);
        if (c.caps) {
          const capsRecent = u.msgs.filter((x) => x.caps && now - x.t < 120000).length;
          if (capsRecent >= 2 || c.letters >= 30) add("caps", 1, capsRecent >= 2 ? `${capsRecent + 1}. caps mesajı` : "uzun caps");
        }
      }
      // kavga: kişiye yönelik küfür/hakaret ve karşılıklılık
      if (this.opt.fights && flags.some((f) => f.cat === "kufur" || f.cat === "hakaret" || f.cat === "tehdit")) {
        const targets = new Set();
        for (const m of raw.matchAll(/@([\w.-]+)/g)) targets.add(m[1].toLowerCase());
        for (const t of tokens) if (t.length >= 3 && this.users.has(t) && t !== u.key) targets.add(t);
        for (const to of targets) {
          if (to === u.key) continue;
          this.edges.push({ from: u.key, to, t: now });
          const back = this.edges.find((e) => e.from === to && e.to === u.key && now - e.t < 180000);
          if (back) {
            add("kavga", 3, `${this.users.get(to) ? this.users.get(to).name : to} ile`);
            u.partners.add(to);
            const other = this.users.get(to);
            if (other) {
              other.partners.add(u.key);
              if (!other.cats.kavga) {
                other.cats.kavga = (other.cats.kavga || 0) + 1;
                other.score += 3;
                other.flagged++;
                other.lastAt = now;
                const lastMsg = [...other.msgs].reverse().find((x) => x.flags.length) || other.msgs[other.msgs.length - 1];
                if (lastMsg && !lastMsg.flags.some((f) => f.cat === "kavga")) {
                  lastMsg.flags.push({ cat: "kavga", label: CATS.kavga, sev: 3, match: `${u.name} ile` });
                  lastMsg.maxSev = 3;
                }
                other.last = lastMsg || other.last;
                this._kavgaTouched = other;
              }
            }
          }
        }
        this.edges = this.edges.filter((e) => now - e.t < 600000);
      }
    }

    const entry = { id: msg.id, t: now, m: raw, norm: tokens.join(" "), caps: capsInfo(raw).caps, flags, maxSev: flags.reduce((s, f) => Math.max(s, f.sev), 0), isMod, isSub };
    u.msgs.push(entry);
    if (u.msgs.length > 400) u.msgs.splice(0, u.msgs.length - 400);
    if (flags.length) {
      u.flagged++;
      u.score += flags.reduce((s, f) => s + f.sev, 0);
      for (const f of flags) u.cats[f.cat] = (u.cats[f.cat] || 0) + 1;
      u.last = entry;
      u.lastAt = now;
    }
    const touched = this._kavgaTouched;
    this._kavgaTouched = null;
    return { entry, user: u, touched };
  }
}

function hasWordRepeat(tokens, n) {
  const c = {};
  for (const t of tokens) if ((c[t] = (c[t] || 0) + 1) >= n) return true;
  return false;
}

module.exports = { Detector, normalize, CATS, SEV };
