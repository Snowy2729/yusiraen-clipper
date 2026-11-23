// Algılayıcı regresyon testi: node tools/test-detector.js
const { Detector, dictSize } = require("../src/detector.js");
// sözlük gerçekten yüklendi mi? (Windows'ta satır sonu sorunu olursa burada durur)
if (dictSize() < 100000) { console.log(`✗ sözlük yüklenemedi (${dictSize()} kelime)`); process.exit(1); }
let t = Date.now(), fail = 0, n = 0;
const flags = (m) => new Detector({ ignoreMods: false }).analyze({ t: (t += 60000), u: "u" + Math.random(), m }).entry.flags.map((f) => f.cat);
const expect = (m, cat) => { n++; const f = flags(m); const ok = cat ? f.includes(cat) : f.filter((c) => c !== "caps").length === 0; if (!ok) { fail++; console.log(`✗ "${m}" beklenen: ${cat || "temiz"}, çıkan: ${f.join(",") || "temiz"}`); } };
// yakalanmalı
for (const [m, c] of [["siktir git", "kufur"], ["s.i.k.t.i.r", "kufur"], ["siiiiktir", "kufur"], ["s1kt1r", "kufur"], ["SIKTIR LAN", "kufur"], ["4mk", "kufur"], ["a.m.k", "kufur"], ["oç", "kufur"], ["o.ç", "kufur"], ["göt", "kufur"],
  ["ananı sikeyim", "kufur"], ["An@nı sipim", "kufur"], ["Djdkdksmdösmxyarrakjdmsjsldms", "gizli"], ["ksldkPİÇsldk", "gizli"], ["dkslOÇskdl", "gizli"], ["KSDLKSamkSDKLS", "gizli"],
  ["Orolpu cocu", "gizli"], ["Purna", "mustehcen"], ["sjdkalsporno sdlak", "mustehcen"], ["sen salaksın", "hakaret"], ["mal mısın lan", "hakaret"], ["seni bulurum", "tehdit"], ["öldürürüm seni", "tehdit"],
  ["discord.gg/abc gelin", "link"], ["onelamk", "kufur"], ["harbiaq", "kufur"], ["naber mk", "kufur"], ["oyuna başlayın artıkmk", "kufur"],
  ["poç", "supheli"], ["soç", "supheli"], ["boç", "supheli"], ["loç", "supheli"], ["bapiç", "supheli"], ["sapiç", "supheli"], ["gapiç", "supheli"], ["piçler", "supheli"],
  ["kfakgjaoçaokfdakdg", "supheli"], ["agşladgkpiçadgşkadjkg", "supheli"], ["ksldksikdlsk", "supheli"], ["naberoç", "supheli"], ["kahvesik", "supheli"], ["p0ç", "supheli"], ["Yarın akşam rakı alıp kaçalım mı", "akrostis"]]) expect(m, c);
// temiz kalmalı
for (const m of ["DKSLDKSJLSDJSKDJDK", "ksldkskflskdlsk", "asdasdasd", "Çekoslovakyalılaştıramadıklarımızdanmışsınız", "yaprakları topladık", "yarar sağladı", "kahve içelim", "adamcık ne yapıyor", "Başak geldi mi",
  "sıkıntı yok kanka", "sikinti yok", "şık bir elbise", "SIK SIK GELİRİM", "seksen yaşında", "pustul çıkmış", "dalaman tatili", "rane abi naber", "Rraene", "âmin inşallah", "got it bro", "malzeme lazım",
  "bu oyun beni öldürecek", "hayvan gibi oynadı", "zurna çalıyor", "kick.com/rraenee", "@veli kardeşim nasılsın",
  "abi hediyeler bugün herkes açıkmı", "koç", "koçum", "Koçlar yine kazandı", "İskoçya", "doçent", "kerpiç", "göç", "toplayarak para", "koyarak", "oynayarak", "eksik", "klasik müzik",
  "bisiklet", "bisikelt", "sikayet ettim", "çoçuk", "seviyoçuz", "elektrsik", "fasikül", "ışık", "Işık", "sikke", "zamk", "Iraq", "kahve içelim", "yaprakları topladık"]) expect(m, null);
// akrostiş (6 mesaj)
const d = new Detector({ ignoreMods: false }); let last;
for (const m of ["Ya bugün çok güzel", "Artık burdayım", "Rane", "Rraene", "Abim nasılsın", "Karar ver artık"]) last = d.analyze({ t: (t += 4000), u: "akro", m, id: "a" + t });
n++; if (!last.entry.flags.some((f) => f.cat === "akrostis")) { fail++; console.log("✗ akrostiş YARRAK yakalanmadı"); }
// spam: aynı / benzer mesajı tekrar yazmak (15 sn arayla); hepsi işaretlenmeli
for (const seq of [["abi gta geçelim artık", "abi gta geçelim artık", "abi gta geçelim artık", "abi gta geçelim artık"],
  ["abi bugün yayında gta 6 girer miyiz", "abi gta 6 giricez mi", "abi gta girecek miyiz bugün yayında", "bugün gta 6 var mı abi"]]) {
  const sd = new Detector({ ignoreMods: false }); const u = "sp" + Math.random();
  seq.forEach((m, i) => sd.analyze({ t: (t += 15000), u, m, id: u + i }));
  n++; const marked = sd.users.get(u.toLowerCase()).msgs.filter((e) => e.flags.some((f) => f.cat === "spam")).length;
  if (marked !== seq.length) { fail++; console.log(`✗ spam: ${seq[0]} → ${marked}/${seq.length} işaretli`); }
}
// farklı konularda konuşan kişi spam sayılmamalı
{ const sd = new Detector({ ignoreMods: false }); let any = false;
  for (const m of ["selam abi", "abi gta ne zaman", "bugün maç var mı", "sesi biraz aç abi", "abi gta 6 bugün mü", "yarın gta 6 var mı", "helal olsun güzel oynadın"]) any = any || sd.analyze({ t: (t += 15000), u: "konuskan", m }).entry.flags.some((f) => f.cat === "spam");
  n++; if (any) { fail++; console.log("✗ normal sohbet spam sanıldı"); } }
for (const [m, c] of [["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "kirlilik"], ["bekirrrrrrrrrrrrrrrr", "kirlilik"], ["abi abi abi abi abi abi abi abi abi abi", "kirlilik"], ["abiiiiiiiiiiiiiiiiiiiiiiii", "kirlilik"]]) expect(m, c);
for (const m of ["https://kick.com/rraenee/clips/clip_01M7WYSZ8HFKBMXQJP8P1QAARN", "bak bu çok iyi https://kick.com/rraenee/clips/clip_01M7WYSZ8HFKBMXQJP8P1QAARN", "https://kick.com/rraenee?clip=clip_01JABCSIKAMK", "kick.com/rraenee/videos/abc"]) expect(m, null);
expect("https://kick.com/rraenee/clips/clip_01ABC discord.gg/xyz", "link");
{ const sd = new Detector({ ignoreMods: false }); const C = "https://kick.com/rraenee/clips/clip_01M7WYSZ8HFKBMXQJP8P1QAARN";
  for (let i = 0; i < 4; i++) sd.analyze({ t: (t += 15000), u: "clipci", m: C, id: "cl" + i });
  n++; const k = sd.users.get("clipci").msgs.filter((e) => e.flags.some((f) => f.cat === "spam")).length; if (k !== 4) { fail++; console.log(`✗ aynı clip linki 4 kez → ${k}/4 spam`); } }
// GTA 6 spoiler
for (const m of ["Lucia sonunda ölüyor", "brian hain çıkıyor", "jasonu cal öldürüyor", "oyunun sonunda herkes ölüyor", "son görevde raul ihanet ediyor", "spoiler: lucia aslında polis çıkıyor", "Boobie ölecek", "dre quan ölüyor", "Jason hapse giriyor sonunda", "Lucia ile Jason evleniyor"]) expect(m, "spoiler");
for (const m of ["spoiler vermeyin lütfen", "abi öldün yine", "jason öldün abi", "lucia ölüyor mu?", "lucia çok güzel", "şarkıyı çal", "son görev neydi abi", "oyunun sonu ne zaman bitecek", "spoiler var mı", "raul kimdi abi", "ölüyorum gülmekten"]) expect(m, null);
{ const sd = new Detector({ ignoreMods: false, spoilerWords: ["Kayıp Hazine"] }); n++;
  if (!sd.analyze({ t: (t += 1000), u: "sp", m: "kayıp hazine görevini yaptın mı" }).entry.flags.some((f) => f.cat === "spoiler")) { fail++; console.log("✗ spoiler kelimesi yakalanmadı"); } }
for (const m of ["abiii naber", "gooool", "bekirrr gel", "çok iyi oynadın abi helal"]) expect(m, null);
console.log(`${n - fail}/${n} doğru`);
process.exit(fail ? 1 : 0);
