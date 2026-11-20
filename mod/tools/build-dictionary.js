// Türkçe + İngilizce kelime listesinden algılayıcının kullandığı sözlüğü üretir.
// Kullanım: node tools/build-dictionary.js tdk.txt tr2.txt freq.txt en.txt > assets/sozluk.txt
// Küfürler sözlükten çıkarılır (yoksa "gerçek kelime" sanılıp beyaz listeye girerler).
const fs = require("fs");
const L = require("../src/lexicon");

function fold(t) {
  return String(t)
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşüâîûéä]|i̇/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u", é: "e", ä: "a" }[c] || "i"));
}
const collapse = (t) => t.replace(/([a-z])\1+/g, "$1");

function profane(w) {
  if (L.EXACT.includes(w) || L.ADULT_EXACT.includes(w)) return true;
  if (L.PREFIX.some((p) => w.startsWith(p)) || L.ADULT_PREFIX.some((p) => w.startsWith(p))) return true;
  // Not: içinde kök geçen ama gerçek olan kelimeler (adamcık, hıyarağa, kalkancık) sözlükte KALIR
  return false;
}

const words = new Set();
const removed = new Set();
for (const f of process.argv.slice(2)) {
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const first = line.split(/\s+\d+$/)[0]; // frekans listesinde "kelime 123"
    for (const raw of first.split(/[\s/,'’-]+/)) {
      const w = collapse(fold(raw));
      if (!/^[a-z]{2,24}$/.test(w)) continue;
      if (profane(w)) removed.add(w);
      else words.add(w);
    }
  }
}
process.stderr.write(`sözlük: ${words.size} kelime, çıkarılan küfür: ${removed.size}\n`);
process.stderr.write("çıkarılanlardan örnek: " + [...removed].slice(0, 40).join(", ") + "\n");
process.stdout.write([...words].sort().join("\n") + "\n");
