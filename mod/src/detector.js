// Yusiraen Mod — sohbet algılayıcı
// Küfür, hakaret, tehdit, +18, spam/flood, caps, link, kavga, özel kelimeler ve GİZLENMİŞ küfürler:
//  • kaçamak yazım: "s.i.k.t.i.r", "siiiktir", "4mk", "An@nı"
//  • rastgele harflerin arasına saklama: "djdkdksmdösmxyarrakjdms", "ksldkPİÇsldk"
//  • harf değiştirme: "purna" → porno, "sipim" → sikim, "orolpu" → orospu
//  • akrostiş: art arda mesajların ilk harfleri Y-A-R-R-A-K
// Yanlış alarmı önlemek için 109 bin kelimelik Türkçe/İngilizce sözlük kullanır.
const fs = require("fs");
const path = require("path");
const L = require("./lexicon");

// ---------- Normalizasyon ----------
const FOLD = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u", é: "e", ä: "a" };
const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b", "@": "a", $: "s", "€": "e", "|": "i" };
const VOWELS = new Set(["a", "e", "i", "o", "u"]);

function stripEmotes(t) {
  return String(t || "").replace(/\[emote:\d+:([^\]]*)\]/g, " ");
}
function fold(t) {
  return String(t)
    .toLocaleLowerCase("tr-TR")
    .replace(/i̇/g, "i")
    .replace(/[çğıöşüâîûéä]/g, (c) => FOLD[c] || c);
}
function joinSpaced(t) {
  // "s.i.k.t.i.r" / "s i k" / "o.ç" -> tek kelime
  return t.replace(/(?:^|(?<=\s))((?:[a-z0-9@$*][\s.\-_*+|,'"]+){1,}[a-z0-9@$*])(?=\s|$)/g, (m) => m.replace(/[\s.\-_+|,'"]+/g, ""));
}
function leet(tok) {
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
function vowelRatio(t) {
  if (!t.length) return 1;
  let v = 0;
  for (const c of t) if (VOWELS.has(c)) v++;
  return v / t.length;
}
function maxConsonantRun(t) {
  let best = 0, cur = 0;
  for (const c of t) {
    if (/[a-z]/.test(c) && !VOWELS.has(c)) best = Math.max(best, ++cur);
    else cur = 0;
  }
  return best;
}

// ---------- Sözlük ----------
let DICT = null;
function dict() {
  if (DICT) return DICT;
  DICT = new Set();
  try {
    const txt = fs.readFileSync(path.join(__dirname, "..", "assets", "sozluk.txt"), "utf8");
    for (const w of txt.split("\n")) if (w) DICT.add(w);
  } catch (_) {}
  for (const w of L.CHAT_WORDS) DICT.add(collapse(fold(w)));
  return DICT;
}
// Kelime sözlükte var mı, ya da sözlükteki bir kelime + Türkçe ek mi? (geliyorsunuz, kahveler, yaprakları)
function explained(t) {
  const D = dict();
  if (D.has(t)) return true;
  for (let k = Math.min(t.length - 1, 16); k >= 4; k--) {
    if (D.has(t.slice(0, k))) {
      const rest = t.slice(k);
      return rest.length <= 10 && vowelRatio(rest) >= 0.25 && maxConsonantRun(rest) <= 2;
    }
  }
  return false;
}
// Klavye ezmesi / anlamsız harf yığını mı? ("ksldkskflskdlsk", "djdkdksmdösmx...")
function isGibberish(foldedTok) {
  const t = foldedTok.replace(/[^a-z]/g, "");
  if (t.length < 7) return false;
  if (explained(collapse(t))) return false;
  return vowelRatio(t) < 0.3 || maxConsonantRun(t) >= 4;
}

// ---------- Harf değiştirme: ağırlıklı benzerlik ----------
const SIMILAR = [["b", "p"], ["d", "t"], ["c", "j"], ["g", "k"], ["k", "q"], ["s", "z"], ["v", "w"], ["f", "v"], ["x", "k"]];
const SIM = new Set(SIMILAR.flatMap(([a, b]) => [a + b, b + a]));
function subCost(a, b) {
  if (a === b) return 0;
  if (VOWELS.has(a) && VOWELS.has(b)) return 0.5;
  if (SIM.has(a + b)) return 0.5;
  return 1;
}
function insCost(c) {
  return VOWELS.has(c) ? 0.7 : 1;
}
function wdist(a, b) {
  const n = a.length, m = b.length;
  const d = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) d[i][0] = d[i - 1][0] + insCost(a[i - 1]);
  for (let j = 1; j <= m; j++) d[0][j] = d[0][j - 1] + insCost(b[j - 1]);
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(d[i - 1][j] + insCost(a[i - 1]), d[i][j - 1] + insCost(b[j - 1]), d[i - 1][j - 1] + subCost(a[i - 1], b[j - 1]));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 0.8);
    }
  return d[n][m];
}
function fuzzyLimit(len) {
  return len <= 5 ? 1.0 : len <= 7 ? 1.5 : 2.0;
}
// Kelime (ya da ek almış hali) köke harf değiştirilerek mi yazılmış?
function fuzzyMatch(t, root, limit = fuzzyLimit(root.length)) {
  if (t.length < 4 && root.length >= 4) return null;
  if (t[0] !== root[0] && subCost(t[0], root[0]) > 0.5) return null; // ilk harf aynı ya da çok benzer olmalı
  let best = Infinity;
  for (let cut = Math.max(3, root.length - 1); cut <= Math.min(t.length, root.length + 2); cut++) {
    const rest = t.slice(cut);
    if (rest.length > 4 && vowelRatio(rest) < 0.3) continue;
    best = Math.min(best, wdist(t.slice(0, cut), root) + (rest.length > 6 ? 1 : 0));
  }
  return best <= limit && best > 0 ? best : null;
}

// ---------- Kategoriler ----------
const SEV = { 1: "düşük", 2: "orta", 3: "yüksek" };
const CATS = {
  kufur: "Küfür",
  gizli: "Gizli küfür",
  akrostis: "Akrostiş",
  mustehcen: "+18",
  hakaret: "Hakaret",
  tehdit: "Tehdit",
  kavga: "Kavga",
  spam: "Spam",
  flood: "Flood",
  caps: "Caps",
  link: "Link",
  ozel: "Özel kelime",
};

const INSULT_EXACT = [
  "salak", "aptal", "gerizekali", "gerzek", "mal", "dangalak", "serefsiz", "haysiyetsiz", "karaktersiz", "beyinsiz", "embesil", "ahmak", "okuz",
  "ezik", "lavuk", "angut", "ucube", "hiyar", "esek", "kopek", "hayvan", "pislik", "sersem", "odun", "keko", "yobaz", "cahil", "denyo", "mankafa",
];
const INSULT_PREFIX = ["gerizekal", "serefsiz", "haysiyetsiz", "dangalak", "embesil", "beyinsiz", "salak", "aptal"];
const WEAK_INSULTS = new Set(["mal", "hayvan", "kopek", "esek", "odun", "cahil", "pislik", "keko", "hiyar", "okuz", "sersem", "yobaz", "ucube", "ezik"]);
// Tehdit: ya açık tehdit kalıbı, ya da birinci tekil "öldürürüm / döverim / gebertirim" + kişiye yönelik (seni, @kullanıcı, lan)
// ("bu oyun beni öldürecek" gibi abartılar tehdit sayılmaz)
const THREAT_PHRASE = /\b(seni|sizi|onu) (bul(ur|ac|aca)\w*|gebert\w*|oldur\w*|keser\w*|dov\w*|vurur\w*|bicak\w*)|adresini (bul|bili)\w*|evini (bas|bul)\w*|kafana (sik|kursun)\w*|kafani (kir|kopar|ez|kes)\w*|ananin evine|olum tehdidi/;
const THREAT_VERB = /\b(oldurur(um|uz)|olduruce(gim|m)|oldurce(m|gim)|oldurece(gim|giz)|gebertir(im|iz)|gebertece(gim|m)|gebertcem|dover(im|iz)|dovece(gim|m)|dovcem|vurur(um|uz)|bicaklar(im|iz)|keser(im|iz))\b/;
const DIRECT_TOKENS = new Set(["sen", "seni", "senin", "sana", "lan", "olum", "oglum", "len", "ula", "lyn", "siz", "sizin", "size", "aga"]);
const LINK_RE = /(https?:\/\/|www\.|discord\.gg|\b[a-z0-9-]{2,}\.(com|net|org|gg|tv|xyz|ru|io|me|link|site|live|shop|store|app)\b)/i;
const KICK_LINK_RE = /(^|\W)(kick\.com)(\/|\b)/i;

function insultRoot(t) {
  if (INSULT_EXACT.includes(t) || INSULT_PREFIX.some((p) => t.startsWith(p))) return t;
  const r = t.replace(/(siniz|sunuz|sin|sun|lar|ler|ligi|lugu|lik|luk|lig|ga|ge|in|un|i|u|a|e)$/, "");
  return r.length >= 3 && INSULT_EXACT.includes(r) ? r : null;
}
function isProfaneWord(t) {
  return L.EXACT.includes(t) || L.PREFIX.some((p) => t.startsWith(p));
}
function isAdultWord(t) {
  return L.ADULT_EXACT.includes(t) || L.ADULT_PREFIX.some((p) => t.startsWith(p));
}

// Büyük/küçük harf farkıyla öne çıkarılmış parçalar: "ksldkPİÇsldk" -> "PİÇ", "DKSLyarakSKD" -> "yarak"
function caseIslands(rawTok) {
  const out = [];
  const isUp = (c) => c !== c.toLocaleLowerCase("tr-TR") && c === c.toLocaleUpperCase("tr-TR");
  const isLow = (c) => c !== c.toLocaleUpperCase("tr-TR") && c === c.toLocaleLowerCase("tr-TR");
  const chars = [...rawTok];
  let i = 0;
  while (i < chars.length) {
    const up = isUp(chars[i]);
    if (!up && !isLow(chars[i])) { i++; continue; }
    let j = i;
    while (j < chars.length && (up ? isUp(chars[j]) : isLow(chars[j]))) j++;
    if (i > 0 && j < chars.length && j - i >= 2 && j - i <= 12) out.push(chars.slice(i, j).join(""));
    i = j;
  }
  return out;
}

// Adacık sadece kelimenin geri kalanı belirgin biçimde tek tip (hep küçük ya da hep büyük) ise anlamlıdır;
// rastgele karışık harflerde (SsİdSGfhJ) tesadüfi adacıklar oluşur, onlar sayılmaz.
function uniformIslands(rawTok) {
  const letters = [...rawTok].filter((c) => /\p{L}/u.test(c));
  if (letters.length < 6) return [];
  const up = letters.filter((c) => c !== c.toLocaleLowerCase("tr-TR")).length;
  const islands = caseIslands(rawTok);
  const islandLen = islands.reduce((s, x) => s + [...x].length, 0);
  const majorityUp = up > letters.length / 2;
  const other = majorityUp ? letters.length - up : up; // azınlıktaki harf sayısı
  // azınlıktaki harflerin tamamı tek bir adacıkta toplanmalı (bilerek yazılmış)
  if (other !== islandLen || islands.length !== 1) return [];
  return islands;
}

function skeleton(t) {
  return t.replace(/[aeiou]/g, "");
}
// Harf değiştirme şüphesi gerçek bir kelimenin yazım hatası olabilir mi? (kahresin → kahretsin)
// sameSkel: sadece ünsüzleri aynı olan gerçek kelimeleri say (purna/porno: ünsüzler P-R-N aynı, zurna farklı)
let BYLEN = null;
function nearRealWord(t, maxD, sameSkel) {
  if (!BYLEN) {
    BYLEN = new Map();
    for (const w of dict()) {
      if (!BYLEN.has(w.length)) BYLEN.set(w.length, []);
      BYLEN.get(w.length).push(w);
    }
  }
  for (let len = Math.max(2, t.length - 2); len <= t.length + 2; len++) {
    for (const w of BYLEN.get(len) || []) {
      if (Math.abs(w.charCodeAt(0) - t.charCodeAt(0)) > 0 && subCost(w[0], t[0]) > 0.5 && wdist(t.slice(0, 2), w.slice(0, 2)) > 1) continue;
      if (sameSkel && skeleton(w) !== skeleton(t)) continue;
      if (wdist(t, w) <= maxD) return w;
    }
  }
  return null;
}

// Normalize edilmiş bir kelimenin ham metindeki karşılıkları
function rawToksFor(raw, t) {
  return stripEmotes(raw)
    .split(/[^\p{L}0-9@$*€|.]+/u)
    .filter((w) => w && collapse(leet(fold(w).replace(/[^a-z0-9@$*€|]/g, ""))) === t);
}

// ---------- Tek mesajı küfür açısından tara ----------
function scanProfanity(raw) {
  const hits = [];
  const add = (cat, sev, match) => hits.push({ cat, sev, match });
  const rawLower = raw.toLocaleLowerCase("tr-TR");
  const { tokens, flat } = normalize(raw);
  const rawToks = stripEmotes(raw).split(/\s+/).filter(Boolean);
  const gib = new Set();

  // 1) açık / kaçamaklı yazılmış küfür
  const prof = [];
  for (const t of tokens) {
    if (t === "amin" || t === "amine" || t === "sikke") continue;
    if (t.startsWith("sik")) {
      // "şık", "sık", "sıkıntı", "sıkıldım": ham kelimede ş ya da ı varsa masumdur
      const src = rawToksFor(raw, t);
      // bilinçli küçük "ı" ya da "ş" ile yazılmış: şık, sık, sıkıntı → masum
      if (src.length && src.every((w) => /[ışŞ]/.test(w.slice(0, 3)))) continue;
      // tek başına büyük "SIK" (noktasız I) belirsiz: "SIK SIK GELİRİM"
      if (t === "sik" && src.length && src.every((w) => /^SIK$/.test(w))) continue;
      if (/^sik(inti|il|ici|ica|istir|isik|isma|ist|ca|ma$|i$|isi$|isin|ilan|ilma|ilmak|iyor|ildi|ildim|iliyor)/.test(t)) continue;
    }
    if (t === "got" && !/göt/.test(rawLower)) continue;
    if (isProfaneWord(t)) prof.push(t);
    else if (isAdultWord(t)) add("mustehcen", 2, t);
  }
  if (prof.length) add("kufur", 2, prof.slice(0, 3).join(", "));

  // 2) gizlenmiş: harf yığını içinde, büyük/küçük harf adacıkları, harf değiştirme
  const found = new Set(prof);
  for (const rt of rawToks) {
    const folded = fold(rt);
    const letters = collapse(leet(folded.replace(/[^a-z0-9@$€|*]/g, "")));
    if (letters.length < 4 || found.has(letters)) continue;
    if (isProfaneWord(letters) || isAdultWord(letters)) continue; // 1. adımda yakalandı
    const gibber = isGibberish(folded);
    if (gibber) gib.add(rt);
    const known = explained(letters);
    // a) büyük/küçük harf adacığı (kelimenin geri kalanı tek tip harfle yazılmışsa: "ksldkPİÇsldk", "DKSLDyarakSKD")
    for (const isl of uniformIslands(rt)) {
      const w = collapse(fold(isl));
      if ((w.length >= 3 && isProfaneWord(w)) || L.TWO_SUB.includes(w)) {
        add("gizli", 3, `${rt} → ${isl}`);
        found.add(letters);
      } else if (isAdultWord(w)) {
        add("mustehcen", 2, `${rt} → ${isl}`);
        found.add(letters);
      }
    }
    if (found.has(letters)) continue;
    // b) güçlü kök kelimenin içinde (sözlükte olmayan kelimelerde)
    if (!known && letters.length >= 6) {
      const r = L.STRONG_SUB.find((p) => letters.includes(p) && letters !== p);
      if (r) {
        add(r.startsWith("porn") ? "mustehcen" : "gizli", 3, `${rt} → ${r}`);
        found.add(letters);
        continue;
      }
    }
    // c) orta kökler sadece anlamsız harf yığınlarında
    if (gibber) {
      const r = L.MEDIUM_SUB.find((p) => letters.includes(p));
      if (r) {
        add(/^(sex|seks|porn)/.test(r) ? "mustehcen" : "gizli", 2, `${rt} → ${r}`);
        found.add(letters);
        continue;
      }
    }
    // d) harf değiştirme (purna, sipim, orolpu) — sadece gerçek kelime olmayanlarda
    if (!known && !gibber && letters.length >= 4 && letters.length <= 14 && /^[a-z]+$/.test(letters)) {
      let best = null;
      for (const [root, cat] of L.FUZZY) {
        const d = fuzzyMatch(letters, root);
        if (d != null && (!best || d < best.d)) best = { d, root, cat };
      }
      // ünsüzleri birebir aynıysa (sadece ünlüler değişmiş) kılık değiştirmenin güçlü işareti
      const skelSame = best && skeleton(letters.slice(0, best.root.length + 1)).startsWith(skeleton(best.root)) && skeleton(best.root).length >= 3;
      if (best && !nearRealWord(letters, best.d, skelSame)) {
        add(best.cat === "mustehcen" ? "mustehcen" : "gizli", 2, `${rt} ≈ ${best.root}`);
        found.add(letters);
      }
    }
  }

  // 3) ana/bacı küfrü (harf değiştirilmiş halleri dahil): "An@nı sipim"
  const ananTok = tokens.find((t) => L.ANAN.some((a) => t === a || (t.length >= 4 && wdist(t, a) <= 1.0)) || /^anne(n|ni|nin|ne)$/.test(t));
  if (ananTok) {
    const sikTok = tokens.find((t) => t !== ananTok && L.SIKLIKE.some((s) => t === s || t.startsWith(s) || (s.length >= 4 ? wdist(t, s) <= 1.0 : wdist(t, s) <= 0.5)));
    if (sikTok) add("kufur", 3, `${ananTok} ${sikTok}`);
  }
  return { hits, tokens, flat, gib };
}

function capsInfo(raw, skip) {
  const t = stripEmotes(raw)
    .replace(/https?:\/\/\S+/g, "")
    .split(/\s+/)
    .filter((w) => w && !w.startsWith("@") && !(skip && skip.has(w)))
    .join(" ");
  const letters = t.match(/\p{L}/gu) || [];
  if (letters.length < 8) return { caps: false, letters: letters.length };
  const up = letters.filter((c) => c !== c.toLocaleLowerCase("tr-TR") && c === c.toLocaleUpperCase("tr-TR")).length;
  return { caps: up / letters.length >= 0.8, letters: letters.length };
}

function firstLetter(raw) {
  const t = stripEmotes(raw).replace(/https?:\/\/\S+/g, " ").replace(/@\S+/g, " ").trim();
  const m = t.match(/\p{L}/u);
  return m ? collapse(fold(m[0])) : null;
}
function wordCount(raw) {
  return stripEmotes(raw).split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
}

// ---------- Algılayıcı ----------
class Detector {
  constructor(opts = {}) {
    this.users = new Map();
    this.edges = [];
    this.setOptions(opts);
    dict();
  }

  setOptions(o) {
    this.opt = { profanity: true, insults: true, threats: true, spam: true, caps: true, links: true, fights: true, hidden: true, acrostic: true, ignoreMods: true, ignoreSubs: false, customWords: [], ...this.opt, ...o };
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
      u = { key: k, name, id, msgs: [], flagged: 0, score: 0, cats: {}, last: null, lastAt: 0, dismissedAt: 0, partners: new Set(), acro: [] };
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
    const flags = [];
    const add = (cat, sev, match) => flags.push({ cat, label: CATS[cat], sev, match });
    const skip = (isMod && this.opt.ignoreMods) || (isSub && this.opt.ignoreSubs);
    let relabel = null;
    const { tokens, flat } = normalize(raw);
    let gib = new Set();

    if (!skip) {
      // özel kelimeler (öncelikli; harf değiştirilmiş ve harf yığınına saklanmış halleri de)
      for (const c of this.custom) {
        const multi = c.norm.includes(" ");
        const hit = multi
          ? flat.includes(" " + c.norm + " ") || flat.replace(/ /g, "").includes(c.norm.replace(/ /g, ""))
          : tokens.some((t) => t === c.norm || (c.norm.length >= 4 && (t.startsWith(c.norm) || (t.length >= 6 && t.includes(c.norm)) || (c.norm.length >= 5 && fuzzyMatch(t, c.norm, 1.0) != null))));
        if (hit) add("ozel", 3, c.word);
      }
      const directed = /@\w/.test(raw) || tokens.some((t) => DIRECT_TOKENS.has(t));
      if (this.opt.profanity) {
        const sc = scanProfanity(raw);
        gib = sc.gib;
        for (const h of sc.hits) {
          if ((h.cat === "gizli" || h.cat === "mustehcen") && this.opt.hidden === false) continue;
          add(h.cat, h.cat === "kufur" && directed ? 3 : h.sev, h.match);
        }
      }
      if (this.opt.insults) {
        const ins = tokens.map(insultRoot).filter(Boolean).filter((w) => directed || !WEAK_INSULTS.has(w));
        if (ins.length) add("hakaret", directed ? 2 : 1, ins.slice(0, 3).join(", "));
      }
      if (this.opt.threats) {
        const ph = flat.match(THREAT_PHRASE);
        const vb = flat.match(THREAT_VERB);
        if (ph) add("tehdit", 3, ph[0].trim());
        else if (vb && directed) add("tehdit", 3, vb[0].trim());
      }
      if (this.opt.links && LINK_RE.test(raw) && !(KICK_LINK_RE.test(raw) && !/discord|http(?!s:\/\/kick\.com)/i.test(raw.replace(KICK_LINK_RE, "")))) add("link", 2, (raw.match(LINK_RE) || [""])[0]);

      // akrostiş: art arda mesajların ilk harfleri ve tek mesajda kelimelerin ilk harfleri
      if (this.opt.acrostic) {
        const fl = firstLetter(raw);
        if (fl) {
          u.acro.push({ ch: fl, t: now, id: msg.id, short: wordCount(raw) <= 4 });
          u.acro = u.acro.filter((a) => now - a.t < 150000).slice(-14);
          for (let s = u.acro.length - 2; s >= 0; s--) {
            const win = u.acro.slice(s);
            const word = collapse(win.map((a) => a.ch).join(""));
            const strong = L.ACRO_STRONG.includes(word);
            const weak = !strong && L.ACRO_WEAK.includes(word) && win.length >= 3 && win.every((a) => a.short) && now - win[0].t < 45000;
            if (strong || weak) {
              const shown = win.map((a) => a.ch.toLocaleUpperCase("tr-TR")).join("");
              add("akrostis", strong ? 3 : 2, `${shown} (${win.length} mesajın ilk harfi)`);
              relabel = { ids: win.slice(0, -1).map((a) => a.id).filter(Boolean), flag: { cat: "akrostis", label: CATS.akrostis, sev: strong ? 3 : 2, match: shown } };
              for (const e of u.msgs) if (relabel.ids.includes(e.id) && !e.flags.some((f) => f.cat === "akrostis")) { e.flags.push(relabel.flag); e.maxSev = Math.max(e.maxSev, relabel.flag.sev); }
              u.acro = [];
              break;
            }
          }
        }
        const words = stripEmotes(raw).split(/\s+/).filter((w) => /\p{L}/u.test(w));
        if (words.length >= 4 && !flags.some((f) => f.cat === "akrostis")) {
          const ini = words.map((w) => collapse(fold((w.match(/\p{L}/u) || [""])[0])));
          outer: for (let a = 0; a < ini.length; a++)
            for (let b = a + 4; b <= Math.min(ini.length, a + 12); b++) {
              const w = collapse(ini.slice(a, b).join(""));
              if (w.length >= 4 && L.ACRO_STRONG.includes(w)) {
                add("akrostis", 3, `${w.toLocaleUpperCase("tr-TR")} (kelimelerin ilk harfi)`);
                break outer;
              }
            }
        }
      }

      // spam / flood / caps
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
        const c = capsInfo(raw, gib); // anlamsız büyük harf yığınları caps sayılmaz
        if (c.caps) {
          const capsRecent = u.msgs.filter((x) => x.caps && now - x.t < 120000).length;
          if (capsRecent >= 2 || c.letters >= 30) add("caps", 1, capsRecent >= 2 ? `${capsRecent + 1}. caps mesajı` : "uzun caps");
        }
      }
      // kavga
      if (this.opt.fights && flags.some((f) => ["kufur", "gizli", "hakaret", "tehdit"].includes(f.cat))) {
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
                other.cats.kavga = 1;
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

    const entry = { id: msg.id, t: now, m: raw, norm: tokens.join(" "), caps: capsInfo(raw, gib).caps, flags, maxSev: flags.reduce((s, f) => Math.max(s, f.sev), 0), isMod, isSub };
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
    return { entry, user: u, touched, relabel };
  }
}

function hasWordRepeat(tokens, n) {
  const c = {};
  for (const t of tokens) if ((c[t] = (c[t] || 0) + 1) >= n) return true;
  return false;
}

module.exports = { Detector, normalize, CATS, SEV, isGibberish, explained, fuzzyMatch, scanProfanity };
