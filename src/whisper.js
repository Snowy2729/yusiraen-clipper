// Otomatik altyazı: whisper.cpp ile bilgisayarda (internet/ücret olmadan) konuşmayı yazıya döker.
const { app, net } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { ffmpegPath } = require("./clipper");

const MODELS = {
  hizli: { file: "ggml-base-q5_1.bin", size: "60 MB" },
  kaliteli: { file: "ggml-small-q5_1.bin", size: "190 MB" },
};
const MODEL_BASE = process.env.WHISPER_MODEL_BASE || "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";

function binPath() {
  if (process.env.WHISPER_BIN) return process.env.WHISPER_BIN;
  const exe = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
  const packaged = path.join(process.resourcesPath || "", "whisper", exe);
  if (fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, "..", "vendor", "whisper", exe);
}

function modelDir() {
  const d = path.join(app.getPath("userData"), "whisper");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function modelInfo(quality) {
  const m = MODELS[quality] || MODELS.kaliteli;
  const file = path.join(modelDir(), m.file);
  return { ...m, path: file, ready: fs.existsSync(file) && fs.statSync(file).size > 1e6 };
}

function status(quality) {
  return { binary: fs.existsSync(binPath()), model: modelInfo(quality) };
}

async function downloadModel(quality, onProgress) {
  const m = modelInfo(quality);
  if (m.ready) return m.path;
  const tmp = m.path + ".indiriliyor";
  const r = await net.fetch(MODEL_BASE + m.file);
  if (!r.ok || !r.body) throw new Error("Model indirilemedi (HTTP " + r.status + ")");
  const total = Number(r.headers.get("content-length")) || 0;
  const out = fs.createWriteStream(tmp);
  const reader = r.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(Buffer.from(value))) await new Promise((res) => out.once("drain", res));
    if (onProgress && total) onProgress(got / total);
  }
  await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
  if (total && fs.statSync(tmp).size !== total) throw new Error("Model eksik indi, tekrar dene.");
  fs.renameSync(tmp, m.path);
  return m.path;
}

function run(cmd, args, onLine, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, cwd });
    let err = "";
    const feed = (d) => {
      const s = d.toString();
      err = (err + s).slice(-4000);
      if (onLine) s.split(/\r?\n/).forEach(onLine);
    };
    p.stdout.on("data", feed);
    p.stderr.on("data", feed);
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.split("\n").filter(Boolean).slice(-3).join(" ")))));
  });
}

// Klibin sesini yazıya döker. Dönen: [{start, end, text}] kelime kelime (saniye)
async function transcribe(videoFile, { quality = "kaliteli", from = 0, to = null, onProgress } = {}) {
  const bin = binPath();
  if (!fs.existsSync(bin)) throw new Error("Altyazı motoru bulunamadı. Uygulamayı güncellemeyi dene.");
  const model = await downloadModel(quality, (f) => onProgress && onProgress({ phase: "model", frac: f }));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "yc-altyazi-"));
  const wav = path.join(work, "ses.wav");
  const args = ["-hide_banner", "-y"];
  if (from) args.push("-ss", String(from));
  args.push("-i", videoFile);
  if (to != null) args.push("-t", String(Math.max(1, to - from)));
  args.push("-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav);
  onProgress && onProgress({ phase: "ses", frac: 0 });
  await run(ffmpegPath(), args);
  onProgress && onProgress({ phase: "yazi", frac: 0 });
  const threads = String(Math.max(2, Math.min(8, os.cpus().length - 1)));
  const outBase = path.join(work, "sonuc");
  await run(bin, ["-m", model, "-f", wav, "-l", "tr", "-t", threads, "-ml", "1", "-sow", "-oj", "-of", outBase, "-pp", "-np"], (line) => {
    const m = line.match(/progress\s*=\s*(\d+)%/);
    if (m && onProgress) onProgress({ phase: "yazi", frac: Number(m[1]) / 100 });
  });
  const j = JSON.parse(fs.readFileSync(outBase + ".json", "utf8"));
  fs.rmSync(work, { recursive: true, force: true });
  const words = [];
  for (const seg of j.transcription || []) {
    const text = String(seg.text || "").trim();
    if (!text || /^\[.*\]$|^\(.*\)$/.test(text)) continue; // [Müzik] gibi işaretleri at
    const s = seg.offsets.from / 1000 + from;
    const e = seg.offsets.to / 1000 + from;
    // whisper bazen noktalamayı ayrı segment verir: önceki kelimeye ekle
    if (/^[.,!?…:;]+$/.test(text) && words.length) {
      words[words.length - 1].text += text;
      words[words.length - 1].end = e;
      continue;
    }
    words.push({ start: s, end: Math.max(e, s + 0.05), text });
  }
  return words;
}

// Kelimeleri ekranda gösterilecek parçalara böl (kısa, okunaklı satırlar)
function groupWords(words, maxWords = 3, maxChars = 20) {
  const out = [];
  let cur = null;
  for (const w of words) {
    const gap = cur ? w.start - cur.end : 0;
    const wouldBe = cur ? (cur.text + " " + w.text).length : w.text.length;
    if (!cur || cur.n >= maxWords || wouldBe > maxChars || gap > 0.6 || /[.!?]$/.test(cur.text)) {
      if (cur) out.push(cur);
      cur = { start: w.start, end: w.end, text: w.text, n: 1 };
    } else {
      cur.text += " " + w.text;
      cur.end = w.end;
      cur.n++;
    }
  }
  if (cur) out.push(cur);
  return out.map(({ start, end, text }) => ({ start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100, text }));
}

module.exports = { transcribe, groupWords, status, downloadModel, MODELS };
