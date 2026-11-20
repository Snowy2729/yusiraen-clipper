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

const TYPE_NAME = { gulme: "gulme", hype: "hype", patlama: "patlama", isim: "isim" };

// Yatay klipten dikey (9:16) klip üretir. style: "bulanik" (arka plan bulanık, görüntü ortada) | "kirp" (ortadan kırp)
function makeVertical(input, out, style, onTime, dur) {
  return new Promise((resolve, reject) => {
    const vf =
      style === "kirp"
        ? "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,format=yuv420p[v]"
        : "[0:v]split=2[a][b];[a]scale=540:960:force_original_aspect_ratio=increase,crop=540:960,boxblur=18:2,scale=1080:1920,setsar=1[bg];[b]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]";
    const args = ["-hide_banner", "-y", "-i", input, "-filter_complex", vf, "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out];
    const p = spawn(ffmpegPath(), args, { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => {
      const s = d.toString();
      err = (err + s).slice(-3000);
      const m = s.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
      if (m && onTime && dur) onTime(Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / dur));
    });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 && fs.existsSync(out) ? resolve(out) : reject(new Error("Dikey klip yapılamadı: " + err.split("\n").filter(Boolean).slice(-2).join(" ")))));
  });
}

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
// format: "yatay" | "dikey" | "ikisi"
async function makeClips({ source, session, moments, folder, offset = 0, precise = false, format = "yatay", verticalStyle = "bulanik", onProgress }) {
  const d = new Date(session.startTime || session.recordStart);
  const p = (n) => String(n).padStart(2, "0");
  const dateStr = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const dir = path.join(folder, safeName(session.streamer), `${dateStr} ${safeName(session.title)}`);
  fs.mkdirSync(dir, { recursive: true });
  const results = [];
  for (let i = 0; i < moments.length; i++) {
    const m = moments[i];
    // Elle ayarlanmış anlarda kaydırma uygulanmaz (kullanıcı tam saniyeyi seçti)
    const off = m.adjusted ? 0 : offset;
    const start = Math.max(0, m.start + off);
    const dur = Math.max(3, m.end - m.start);
    const base = path.join(dir, `${p(m.rank)}_${hms(m.peak + off, "-")}_${(m.keyword ? "isim-" + safeName(m.keyword) : TYPE_NAME[m.type]) || "an"}`);
    const wantH = format !== "dikey";
    const wantV = format !== "yatay";
    const hOut = wantH ? base + ".mp4" : base + "_gecici.mp4";
    const prog = (f) => onProgress && onProgress({ index: i, total: moments.length, frac: f, rank: m.rank });
    prog(0);
    try {
      await cutOne(source, start, dur, hOut, precise, (f) => prog(wantV ? f * 0.5 : f));
      const files = [];
      if (wantH) files.push(hOut);
      if (wantV) {
        const vOut = base + "_dikey.mp4";
        await makeVertical(hOut, vOut, verticalStyle, (f) => prog(0.5 + f * 0.5), dur);
        files.push(vOut);
        if (!wantH) fs.unlink(hOut, () => {});
      }
      results.push({ rank: m.rank, ok: true, file: files[0], files });
    } catch (e) {
      results.push({ rank: m.rank, ok: false, error: e.message });
    }
  }
  onProgress && onProgress({ index: moments.length, total: moments.length, frac: 1, done: true });
  return { dir, results };
}

module.exports = { makeClips, makeVertical, cutOne, ffmpegPath, hms };
