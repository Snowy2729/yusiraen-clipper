// Yusiraen Mod — küfür sözlüğü
// Tüm kökler normalize edilmiş halde yazılır: Türkçe karakterler sadeleşmiş (ç→c, ş→s, ı→i...),
// art arda tekrarlanan harfler teke inmiş (yarrak → yarak, taşşak → tasak).

// Tam kelime olarak geçerse küfür
const EXACT = ["amk", "amq", "aq", "amaq", "mk", "oc", "pic", "sik", "got", "sg", "siktr", "sktr", "skm", "skrm", "skym", "awk", "amcik", "yarak", "pust", "pusta", "pustun", "aminakoyim", "amkoyim"];

// Akrostişte (mesajların ilk harflerinden) aranacak kelimeler
const ACRO_STRONG = ["yarak", "orospu", "orosbu", "amcik", "porno", "kahpe", "siktir", "pezevenk", "kaltak", "gavat", "ibne", "pust", "porn", "yavsak", "surtuk", "kancik", "aminako", "sikerim", "sikeyim", "dalyarak"];
const ACRO_WEAK = ["sik", "amk", "pic", "got", "sex", "mk", "aq", "oc"];

// Bu köklerle başlayan kelimeler küfür (siktir, siktiğim, orospuluk...)
const PREFIX = [
  "amina", "aminak", "amcik", "amcig", "aminiz", "aminako", "orospu", "orosbu", "orspu", "orsbu", "yarak", "yarag", "dalyarak", "dalyarag",
  "kahpe", "pezevenk", "pezeveng", "gavat", "kaltak", "ibne", "pustlar", "pustluk", "surtuk", "surtug", "yavsak", "tasak", "tasag", "kancik", "kancig", "kevase",
  "gotveren", "gotlek", "gotos", "gotun", "gotune", "gotunu", "sikis", "siktir", "sikim", "sikik", "sikeyim", "sikerim", "siker", "sikecem", "sikicem",
  "sikiyim", "siktig", "siktim", "sikmis", "sikmek", "sikti", "sikimi", "sikimin", "sikiy", "pickurus", "piclik",
];

// Müstehcen (+18)
const ADULT_EXACT = ["porno", "porn", "sex", "seks", "nude", "nudes", "xxx", "onlyfans", "pornhub"];
const ADULT_PREFIX = ["porno", "pornog", "pornhub", "onlyfans"];

// Bir kelimenin İÇİNDE gizlenmiş olabilecek güçlü kökler (rastgele harflerin arasına saklama)
const STRONG_SUB = [
  "yarak", "yarag", "siktir", "siktig", "sikerim", "sikeyim", "sikiyim", "orospu", "orosbu", "orspu", "amcik", "aminak", "aminako",
  "pezevenk", "kahpe", "kaltak", "surtuk", "yavsak", "gotveren", "kancik", "kevase", "dalyarak", "porno", "pornhub",
];
// Sadece anlamsız harf yığınlarının (klavye ezmesi) içinde aranır
// (3 harfli kökler — sik, amk, piç — Türkçe klavyede rastgele yazınca tesadüfen çok çıkar; onlar sadece büyük/küçük harf farkıyla yakalanır)
const MEDIUM_SUB = ["ibne", "pust", "seks", "porn", "gavat", "tasak", "sikis", "amina", "siktr"];
// İki harfliler: harf yığınında ancak büyük/küçük harf farkıyla ya da özel harfle (ç) belirginse
const TWO_SUB = ["oc"];

// Harf değiştirmeyle yazılmış hallerini (purna → porno, sipim → sikim) yakalamak için
const FUZZY = [
  ["porno", "mustehcen"], ["siktir", "kufur"], ["sikerim", "kufur"], ["sikeyim", "kufur"], ["sikiyim", "kufur"], ["sikim", "kufur"], ["sikik", "kufur"],
  ["orospu", "kufur"], ["orosbu", "kufur"], ["amcik", "kufur"], ["yarak", "kufur"], ["pezevenk", "kufur"], ["kahpe", "kufur"], ["kaltak", "kufur"],
  ["gavat", "kufur"], ["surtuk", "kufur"], ["yavsak", "kufur"], ["gotveren", "kufur"], ["kancik", "kufur"], ["kevase", "kufur"], ["aminako", "kufur"],
  ["dalyarak", "kufur"], ["siktigim", "kufur"],
];

// "ananı ... sikeyim" türü: iki parçanın da harf değiştirilmiş hali yakalanır
const ANAN = ["anan", "anani", "ananin", "anana", "anasini", "anasinin", "bacini", "bacin", "bacina", "sulaleni", "avradini"];
const SIKLIKE = ["sik", "sikim", "sikeyim", "sikerim", "sikiyim", "sikem", "koyim", "koyayim", "koyarim", "koydugum", "sokim", "sokayim", "sokarim"];

// Kelime içinde geçince ŞÜPHELİ sayılan kısa kökler (Türkçe harfleriyle; "oç"/"piç" mutlaka ç ile, "sik" noktalı i ile)
const SHORT_ROOTS = ["piç", "oç", "sik"];
// İçinde "oç" / "piç" geçen gerçek kelimeler (TDK ve sohbet sıklık listelerinden); bunlarla başlayan kelimeler masum
// (koç, koçum, doçent, kerpiç, İskoçya...). "göç" yanlışlıkla "goç" yazılabildiği için o da var.
const C_INNOCENT = ["biyoçeşitlilik", "doçent", "foça", "goç", "iskoç", "kamboçya", "karakoçan", "karoça", "kaçgoç", "kerpiç", "konargoçer", "koç", "köygoçüren", "loça", "malkoç", "mikroçip", "troçkici", "zangoç", "şereflikoçhisar"];

module.exports = { SHORT_ROOTS, C_INNOCENT, ACRO_STRONG, ACRO_WEAK, EXACT, PREFIX, ADULT_EXACT, ADULT_PREFIX, STRONG_SUB, MEDIUM_SUB, TWO_SUB, FUZZY, ANAN, SIKLIKE };

// Sohbette sık geçen, sözlükte olmayan masum kelimeler (argo, kısaltma, yayıncı adları)
const CHAT_WORDS = ["slm", "mrb", "nbr", "naber", "kanka", "kanki", "aga", "abi", "abim", "abla", "xd", "xdd", "kekw", "lol", "gg", "wp", "pog", "poggers", "omg", "lan", "len",
  "ya", "yaa", "ok", "tmm", "tm", "eyv", "eyvallah", "sa", "as", "selamun", "aleykum", "hg", "bb", "gn", "iyi", "rane", "rraene", "rraenee", "raene", "elraen", "elraenn",
  "cordiseps", "nemesis", "bedir", "tugkan", "mert", "baboli", "limon", "limontayfa", "tayfa", "kick", "yusiraen", "jahrein", "pqueen", "wtcn", "kendine", "muzisyen",
  "hahaha", "haha", "ahaha", "sjsj", "ajsj", "kdsm", "kardo", "bro", "bruh", "lmao", "lmfao", "wtf", "idk", "pls", "plz", "thx", "ty", "np", "gl", "hf", "afk", "brb"];
module.exports.CHAT_WORDS = CHAT_WORDS;
