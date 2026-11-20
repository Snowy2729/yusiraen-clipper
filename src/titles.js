// Ücretsiz başlık / açıklama / hashtag önerileri (şablon tabanlı, internet gerektirmez)
function up(t) {
  return String(t || "").toLocaleUpperCase("tr-TR");
}
function cap(t) {
  t = String(t || "");
  return t.charAt(0).toLocaleUpperCase("tr-TR") + t.slice(1);
}
function slugTag(t) {
  return "#" + String(t || "").toLocaleLowerCase("tr-TR").replace(/[^a-z0-9çğıöşü]+/gi, "");
}
function pickSnippet(subs) {
  // altyazıdan en "vurucu" kısa cümle: 3-7 kelime, mümkünse ünlem/soru içeren
  const texts = (subs || []).map((s) => s.text.trim()).filter(Boolean);
  if (!texts.length) return "";
  const joined = texts.join(" ").replace(/\s+/g, " ");
  const sentences = joined.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter((s) => s.split(" ").length >= 2);
  const score = (s) => (/[!?]/.test(s) ? 3 : 0) + (s.split(" ").length >= 3 && s.split(" ").length <= 8 ? 2 : 0) - Math.max(0, s.length - 45) / 10;
  const best = (sentences.length ? sentences : [joined]).sort((a, b) => score(b) - score(a))[0];
  const words = best.split(" ").slice(0, 8).join(" ");
  return words.replace(/[.,;:]+$/, "");
}

function suggest({ streamer, slug, streamTitle, moment, subs, vertical, baseTags }) {
  const S = streamer || slug || "Yayıncı";
  const kw = moment && (moment.keyword || (moment.tags || [])[0]);
  const type = moment ? moment.type : "patlama";
  const snip = pickSnippet(subs);
  const emo = type === "gulme" ? "😂" : type === "hype" ? "😱" : kw ? "🔥" : "🔥";
  const titles = [];
  if (snip) titles.push(`"${cap(snip)}" ${emo} | ${S}`);
  if (type === "gulme") titles.push(`${up(S)} GÜLMEKTEN KOPTU ${emo}`, `${S} Bu Anı Unutamayacak ${emo}`, `Sohbet Bu Ana Çıldırdı ${emo} | ${S}`);
  else if (type === "hype") titles.push(`${up(S)} BUNA İNANAMADI ${emo}`, `Bunu Kimse Beklemiyordu... ${emo} | ${S}`, `${S}'nin En Şok Anı ${emo}`);
  else if (type === "isim" || kw) titles.push(`${S} ve ${cap(kw)} ${emo} | Limon Tayfa`, `${up(kw)} GELİNCE ORTALIK KARIŞTI ${emo}`, `${S} x ${cap(kw)} Efsane An ${emo}`);
  else titles.push(`${up(S)} YAYININDA EFSANE AN ${emo}`, `${S} Yayınında Ortalık Karıştı ${emo}`, `Sohbet Bu Anı Konuşuyor ${emo} | ${S}`);
  if (kw && type !== "isim") titles.push(`${S} ve ${cap(kw)} ${emo} | Limon Tayfa`);

  const tagSet = new Set();
  const add = (t) => t && tagSet.add(slugTag(t.replace(/^#/, "")));
  (baseTags || []).forEach(add);
  add(slug || S);
  if (kw) add(kw);
  for (const t of moment && moment.tags ? moment.tags : []) add(t);
  add("limontayfa");
  add("kick");
  if (type === "gulme") add("komikanlar");
  if (vertical) add("shorts");
  const hashtags = [...tagSet].filter((t) => t.length > 1).slice(0, 12);

  const hook = snip ? up(snip).split(" ").slice(0, 5).join(" ") + " " + emo : type === "gulme" ? `${up(S)} KOPTU ${emo}` : `BUNU İZLE ${emo}`;
  const description = [
    `${S} yayınından ${type === "gulme" ? "komik" : "efsane"} bir an ${emo}`,
    streamTitle ? `Yayın: "${streamTitle}"` : "",
    slug ? `Canlı yayın: https://kick.com/${slug}` : "",
    "",
    "Daha fazla Limon Tayfa anı için abone ol! 🍋",
    "",
    hashtags.join(" "),
  ]
    .filter((l, i, a) => l !== "" || (a[i - 1] && a[i - 1] !== ""))
    .join("\n");
  return { titles: [...new Set(titles)].slice(0, 5).map((t) => t.slice(0, 100)), hashtags, description, hook };
}

module.exports = { suggest };
