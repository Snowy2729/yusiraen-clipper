// Sohbet analizi: sohbetin patladığı anları bulur.
// messages: [{t (ms), u, m}] (zamana göre sıralı), startMs: yayının başlangıcı

const LAUGH_EMOTE = /kek|lul|laugh|icant|xd|haha|lmao|rofl|pepela|joy/i;
const LAUGH_TEXT =
  /(ha){2,}|(ah){2,}|(he){3,}|(sj){2,}|(js){2,}|(sk){2,}|\bx+d+\b|😂|🤣|💀|😹|\bkek|\blol\b|\blmao\b|öldüm|ölü?yorum|kopt|ajsj|asjd|aksj/i;
const HYPE_TEXT = /^\?{1,}$|^o{3,}|^a{3,}|^w+$|^l+$|^😮|^😱|^🔥|vay|nasıl ya|noluyo|ne oluyo|wtf|efsane|gol+/i;
const VOWELS = /[aeıioöuüAEIİOÖUÜ]/g;

function emoteNames(m) {
  const out = [];
  m.replace(/\[emote:\d+:([^\]]+)\]/g, (_, n) => out.push(n));
  return out;
}
function keyboardSmash(m) {
  for (const w of m.split(/\s+/)) {
    if (w.length >= 6 && /^[a-zçğışöü]+$/i.test(w)) {
      if ((w.match(VOWELS) || []).length / w.length < 0.25) return true;
    }
  }
  return false;
}
function classify(m) {
  const em = emoteNames(m);
  const text = m.replace(/\[emote:\d+:[^\]]+\]/g, " ").trim();
  const laugh = em.some((e) => LAUGH_EMOTE.test(e)) || LAUGH_TEXT.test(text) || keyboardSmash(text);
  const hype = !laugh && (HYPE_TEXT.test(text) || (text === "" && em.length > 0));
  return { laugh, hype };
}
function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}
function topMessages(list, n) {
  const map = new Map();
  for (const m of list) {
    const clean = m.replace(/\[emote:\d+:([^\]]+)\]/g, "$1").trim().slice(0, 80);
    if (!clean) continue;
    const k = clean.toLowerCase();
    const e = map.get(k) || { text: clean, n: 0 };
    e.n++;
    map.set(k, e);
  }
  return [...map.values()].sort((a, b) => b.n - a.n).slice(0, n).map((e) => (e.n > 1 ? `${e.text} ×${e.n}` : e.text));
}

// Türkçe karakterleri sadeleştir: "Tuğkan" = "tugkan"
function norm(t) {
  return String(t)
    .toLocaleLowerCase("tr-TR")
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c").replace(/â/g, "a");
}

function analyze(messages, startMs, opt = {}) {
  const o = {
    bucketSec: 10,
    momentCount: 25,
    minGapSec: 90,
    clipBefore: 60,
    clipAfter: 15,
    chatDelay: 8,
    minScore: 3,
    keywords: [],
    ...opt,
  };
  const kws = (o.keywords || []).map((k) => ({ label: String(k).trim(), n: norm(String(k).trim()) })).filter((k) => k.n.length >= 2);
  const kwRe = kws.map((k) => new RegExp("(^|[^a-z0-9])" + k.n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  if (messages.length < 30) return { moments: [], perMinute: [], tooFew: true };
  const bucket = o.bucketSec * 1000;
  const first = Math.min(startMs, messages[0].t);
  const n = Math.floor((messages[messages.length - 1].t - first) / bucket) + 1;
  const B = Array.from({ length: n }, () => ({ c: 0, laugh: 0, hype: 0, users: new Set(), sample: [], kw: kws.map(() => 0), kwUsers: kws.map(() => new Set()) }));
  for (const msg of messages) {
    const i = Math.floor((msg.t - first) / bucket);
    if (i < 0 || i >= n) continue;
    const b = B[i];
    const k = classify(msg.m);
    b.c++;
    if (k.laugh) b.laugh++;
    if (k.hype) b.hype++;
    b.users.add(msg.u);
    if (b.sample.length < 40) b.sample.push(msg.m);
    if (kws.length) {
      const nm = norm(msg.m.replace(/\[emote:\d+:[^\]]+\]/g, " "));
      kwRe.forEach((re, k) => {
        if (re.test(nm)) {
          b.kw[k]++;
          b.kwUsers[k].add(msg.u);
        }
      });
    }
  }
  const win = Math.round(300 / o.bucketSec);
  const counts = B.map((b) => b.c);
  const base = counts.map((_, i) => median(counts.slice(Math.max(0, i - win), i + win + 1)));
  const raw = B.map((b, i) => {
    const part = Math.min(b.c, b.users.size * 1.5);
    const v = part + 1.5 * Math.min(b.laugh, b.users.size) + 0.5 * b.hype;
    return (v - base[i]) / Math.sqrt(base[i] + 1);
  });
  const score = raw.map((_, i) => 0.25 * (raw[i - 1] ?? raw[i]) + 0.5 * raw[i] + 0.25 * (raw[i + 1] ?? raw[i]));

  const gap = Math.round(o.minGapSec / o.bucketSec);
  const order = score.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]);
  const picked = [];
  for (const [s, i] of order) {
    if (s < o.minScore || picked.length >= o.momentCount) break;
    if (picked.some((j) => Math.abs(j - i) < gap)) continue;
    picked.push(i);
  }
  const tagsAt = (i) => {
    const g = [B[i - 1], B[i], B[i + 1]].filter(Boolean);
    return kws.filter((_, k) => g.reduce((s, b) => s + b.kw[k], 0) >= 3).map((k) => k.label);
  };
  const moments = picked.map((i, rank) => {
    const g = [B[i - 1], B[i], B[i + 1]].filter(Boolean);
    const c = g.reduce((s, b) => s + b.c, 0);
    const laugh = g.reduce((s, b) => s + b.laugh, 0);
    const hype = g.reduce((s, b) => s + b.hype, 0);
    const peak = Math.max(0, Math.round((first + i * bucket - startMs) / 1000) - o.chatDelay);
    let type = "patlama";
    if (laugh / c >= 0.25) type = "gulme";
    else if (hype / c >= 0.3) type = "hype";
    return {
      rank: rank + 1,
      peak,
      start: Math.max(0, peak - o.clipBefore),
      end: peak + o.clipAfter,
      score: Math.round(score[i] * 10) / 10,
      type,
      count: c,
      samples: topMessages(g.flatMap((b) => b.sample), 5),
      tags: tagsAt(i),
      bucket: i,
    };
  });

  // İsim / kelime anları: bir ismin kısa sürede çok kişi tarafından yazıldığı yerler
  const keywordStats = [];
  kws.forEach((k, ki) => {
    const sum = B.map((_, i) => [i - 1, i, i + 1].reduce((s, j) => s + (B[j] ? B[j].kw[ki] : 0), 0));
    const users = B.map((_, i) => new Set([i - 1, i, i + 1].flatMap((j) => (B[j] ? [...B[j].kwUsers[ki]] : []))).size);
    const kbase = sum.map((_, i) => median(sum.slice(Math.max(0, i - win), i + win + 1)));
    const cand = sum.map((v, i) => [v, i]).filter(([v, i]) => v >= 5 && users[i] >= 3 && v >= 4 * (kbase[i] + 0.5)).sort((a, b) => b[0] - a[0]);
    const chosen = [];
    for (const [v, i] of cand) {
      if (chosen.length >= 10) break;
      if (chosen.some((j) => Math.abs(j - i) < gap)) continue;
      chosen.push(i);
    }
    keywordStats.push({ label: k.label, total: B.reduce((s, b) => s + b.kw[ki], 0), peaks: chosen.length });
    for (const i of chosen) {
      // zaten genel bir an varsa ona etiket ekle, yoksa yeni "isim anı" oluştur
      const near = moments.find((m) => Math.abs(m.bucket - i) <= Math.round(60 / o.bucketSec));
      if (near) {
        if (!near.tags.includes(k.label)) near.tags.push(k.label);
        continue;
      }
      const g = [B[i - 1], B[i], B[i + 1]].filter(Boolean);
      const peak = Math.max(0, Math.round((first + i * bucket - startMs) / 1000) - o.chatDelay);
      moments.push({
        rank: 0,
        peak,
        start: Math.max(0, peak - o.clipBefore),
        end: peak + o.clipAfter,
        score: sum[i],
        type: "isim",
        keyword: k.label,
        count: g.reduce((s, b) => s + b.c, 0),
        samples: topMessages(g.flatMap((b) => b.sample), 5),
        tags: [k.label],
        bucket: i,
      });
    }
  });
  moments.forEach((m, idx) => (m.rank = idx + 1));
  const perMinute = [];
  for (const msg of messages) {
    const d = Math.floor((msg.t - startMs) / 60000);
    if (d >= 0) perMinute[d] = (perMinute[d] || 0) + 1;
  }
  for (let i = 0; i < perMinute.length; i++) perMinute[i] = perMinute[i] || 0;
  return {
    moments,
    perMinute,
    users: new Set(messages.map((m) => m.u)).size,
    keywords: keywordStats,
    analyzedAt: new Date().toISOString(),
  };
}

module.exports = { analyze, classify };
