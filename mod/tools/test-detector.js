// Algılayıcı regresyon testi: node tools/test-detector.js
const { Detector } = require("../src/detector.js");
let t = Date.now(), fail = 0, n = 0;
const flags = (m) => new Detector({ ignoreMods: false }).analyze({ t: (t += 60000), u: "u" + Math.random(), m }).entry.flags.map((f) => f.cat);
const expect = (m, cat) => { n++; const f = flags(m); const ok = cat ? f.includes(cat) : f.filter((c) => c !== "caps").length === 0; if (!ok) { fail++; console.log(`✗ "${m}" beklenen: ${cat || "temiz"}, çıkan: ${f.join(",") || "temiz"}`); } };
// yakalanmalı
for (const [m, c] of [["siktir git", "kufur"], ["s.i.k.t.i.r", "kufur"], ["siiiiktir", "kufur"], ["s1kt1r", "kufur"], ["SIKTIR LAN", "kufur"], ["4mk", "kufur"], ["a.m.k", "kufur"], ["oç", "kufur"], ["o.ç", "kufur"], ["göt", "kufur"],
  ["ananı sikeyim", "kufur"], ["An@nı sipim", "kufur"], ["Djdkdksmdösmxyarrakjdmsjsldms", "gizli"], ["ksldkPİÇsldk", "gizli"], ["dkslOÇskdl", "gizli"], ["KSDLKSamkSDKLS", "gizli"],
  ["Orolpu cocu", "gizli"], ["Purna", "mustehcen"], ["sjdkalsporno sdlak", "mustehcen"], ["sen salaksın", "hakaret"], ["mal mısın lan", "hakaret"], ["seni bulurum", "tehdit"], ["öldürürüm seni", "tehdit"],
  ["discord.gg/abc gelin", "link"], ["Yarın akşam rakı alıp kaçalım mı", "akrostis"]]) expect(m, c);
// temiz kalmalı
for (const m of ["DKSLDKSJLSDJSKDJDK", "ksldkskflskdlsk", "asdasdasd", "Çekoslovakyalılaştıramadıklarımızdanmışsınız", "yaprakları topladık", "yarar sağladı", "kahve içelim", "adamcık ne yapıyor", "Başak geldi mi",
  "sıkıntı yok kanka", "sikinti yok", "şık bir elbise", "SIK SIK GELİRİM", "seksen yaşında", "pustul çıkmış", "dalaman tatili", "rane abi naber", "Rraene", "âmin inşallah", "got it bro", "malzeme lazım",
  "bu oyun beni öldürecek", "hayvan gibi oynadı", "zurna çalıyor", "kick.com/rraenee", "@veli kardeşim nasılsın"]) expect(m, null);
// akrostiş (6 mesaj)
const d = new Detector({ ignoreMods: false }); let last;
for (const m of ["Ya bugün çok güzel", "Artık burdayım", "Rane", "Rraene", "Abim nasılsın", "Karar ver artık"]) last = d.analyze({ t: (t += 4000), u: "akro", m, id: "a" + t });
n++; if (!last.entry.flags.some((f) => f.cat === "akrostis")) { fail++; console.log("✗ akrostiş YARRAK yakalanmadı"); }
console.log(`${n - fail}/${n} doğru`);
process.exit(fail ? 1 : 0);
