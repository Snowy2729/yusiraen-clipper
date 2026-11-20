// Seçilen anları yayın kaydından (VOD) ffmpeg ile keser.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function ffmpegPath() {
  let p = null;
  try {
    p = require("ffmpeg-static");
  } catch (_) {}
  if (p) p = p.replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);
  if (p && fs.existsSync(p)) return p;
  return "ffmpeg";
}

function hms(sn, sep = ":") {
  sn = Math.max(0, Math.round(sn));
  const h = Math.floor(sn / 3600), m = Math.floor((sn % 3600) / 60), s = sn % 60;
  const p = (n) => String(n).padStart(2, "0");
  return `${h}${sep}${p(m)}${sep}${p(s)}`;
}

function safeName(s) {
  return String(s || "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || "yayin";
}

const TYPE_NAME = { gulme: "gulme", hype: "hype", patlama: "patlama" };

function cutOne(src, start, dur, out, precise, onTime) {
  return new Promise((resolve, reject) => {
    const args = ["-hide_banner", "-y", "-ss", String(start), "-i", src, "-t", String(dur)];
    if (precise) args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k");
    else args.push("-c", "copy", "-avoid_negative_ts", "make_zero");
    args.push("-movflags", "+faststart", out);
    const p = spawn(ffmpegPath(), args, { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => {
      const s = d.toString();
      err = (err + s).slice(-3000);
      const m = s.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
      if (m && onTime) onTime(Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / dur));
    });
    p.on("error", (e) => reject(e));
    p.on("close", (code) => {
      if (code === 0 && fs.existsSync(out) && fs.statSync(out).size > 1000) resolve(out);
      else reject(new Error("ffmpeg hata verdi: " + err.split("\n").filter(Boolean).slice(-2).join(" ")));
    });
  });
}

// moments: [{rank, start, end, type}], offset: saniye kaydırma
async function makeClips({ source, session, moments, folder, offset = 0, precise = false, onProgress }) {
  const d = new Date(session.startTime || session.recordStart);
  const p = (n) => String(n).padStart(2, "0");
  const dateStr = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const dir = path.join(folder, safeName(session.streamer), `${dateStr} ${safeName(session.title)}`);
  fs.mkdirSync(dir, { recursive: true });
  const results = [];
  for (let i = 0; i < moments.length; i++) {
    const m = moments[i];
    const start = Math.max(0, m.start + offset);
    const dur = Math.max(5, m.end - m.start);
    const out = path.join(dir, `${p(m.rank)}_${hms(m.peak + offset, "-")}_${TYPE_NAME[m.type] || "an"}.mp4`);
    onProgress && onProgress({ index: i, total: moments.length, frac: 0, rank: m.rank });
    try {
      await cutOne(source, start, dur, out, precise, (f) => onProgress && onProgress({ index: i, total: moments.length, frac: f, rank: m.rank }));
      results.push({ rank: m.rank, ok: true, file: out });
    } catch (e) {
      results.push({ rank: m.rank, ok: false, error: e.message });
    }
  }
  onProgress && onProgress({ index: moments.length, total: moments.length, frac: 1, done: true });
  return { dir, results };
}

module.exports = { makeClips, ffmpegPath, hms };
