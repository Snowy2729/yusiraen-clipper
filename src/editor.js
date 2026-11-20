// Stüdyo: klip projeleri (kırpma, format, altyazı, yazı) ve son videoyu üretme.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { ffmpegPath, cutOne, hms } = require("./clipper");

const FONT_DIR = path.join(__dirname, "..", "assets", "fonts");

const DEFAULTS = {
  layout: "bulanik", // yatay | bulanik | kirp | bolunmus
  cropX: 0.5, // kırp modunda yatay odak
  camRect: { x: 0.68, y: 0.04, w: 0.3, h: 0.3 },
  gameRect: { x: 0.12, y: 0.0, w: 0.76, h: 1.0 },
  splitRatio: 0.4,
  subs: [],
  words: [],
  subStyle: "montajer", // montajer | beyaz | yusiraen
  subPos: "alt", // alt | orta | ust
  subSize: 100,
  subUpper: true,
  subWords: 3,
  hookText: "",
  watermark: true,
  watermarkText: "@yusiraen",
  title: "",
  description: "",
  tags: "",
  privacy: "private",
};

class Projects {
  constructor(root) {
    this.dir = path.join(root, "projeler");
    fs.mkdirSync(this.dir, { recursive: true });
  }
  key(sessionId, rank) {
    return `${sessionId}_${rank}`;
  }
  file(sessionId, rank) {
    return path.join(this.dir, this.key(sessionId, rank) + ".json");
  }
  baseFile(sessionId, rank) {
    return path.join(this.dir, this.key(sessionId, rank) + ".mp4");
  }
  load(sessionId, rank) {
    try {
      const p = JSON.parse(fs.readFileSync(this.file(sessionId, rank), "utf8"));
      return { ...DEFAULTS, ...p };
    } catch (_) {
      return null;
    }
  }
  save(sessionId, rank, proj) {
    const f = this.file(sessionId, rank);
    fs.writeFileSync(f + ".tmp", JSON.stringify(proj, null, 1));
    fs.renameSync(f + ".tmp", f);
    return proj;
  }
  remove(sessionId) {
    for (const f of fs.readdirSync(this.dir)) if (f.startsWith(sessionId + "_")) fs.rmSync(path.join(this.dir, f), { force: true });
  }
  exists(sessionId, rank) {
    return fs.existsSync(this.file(sessionId, rank));
  }
}

// Projeyi oluşturur: kaynak klibi (anın biraz öncesi ve sonrasıyla) VOD'dan keser
async function createProject(projects, { sessionId, rank, source, vodStart, vodEnd, defaults, onProgress }) {
  const pad = 10;
  const baseStart = Math.max(0, vodStart - pad);
  const baseEnd = vodEnd + pad;
  const base = projects.baseFile(sessionId, rank);
  await cutOne(source, baseStart, baseEnd - baseStart, base, false, onProgress);
  const proj = {
    ...DEFAULTS,
    ...defaults,
    baseFile: base,
    baseStart,
    baseDur: baseEnd - baseStart,
    trimStart: vodStart - baseStart,
    trimEnd: vodEnd - baseStart,
    createdAt: new Date().toISOString(),
  };
  return projects.save(sessionId, rank, proj);
}

// ---------- ASS altyazı ----------
const STYLES = {
  montajer: { font: "Anton", primary: "&H0000F0FF", outline: "&H00000000", ow: 0.0055, shadow: 0.002, back: "&H80000000" },
  beyaz: { font: "Poppins Black", primary: "&H00FFFFFF", outline: "&H00000000", ow: 0.004, shadow: 0.0015, back: "&H80000000" },
  yusiraen: { font: "Anton", primary: "&H00FFFFFF", outline: "&H00120D85", ow: 0.006, shadow: 0.002, back: "&H80000000" },
};

function assTime(t) {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), cs = Math.floor((t * 100) % 100);
  const p = (n) => String(n).padStart(2, "0");
  return `${h}:${p(m)}:${p(s)}.${p(cs)}`;
}
function assEsc(t) {
  return String(t).replace(/\\/g, "＼").replace(/[{}]/g, "").replace(/\r?\n/g, "\\N");
}
function upperTr(t) {
  return String(t).toLocaleUpperCase("tr-TR");
}

// libass yazı boyutunu satır yüksekliğine (winAscent+winDescent) göre ölçer; önizleme (canvas) ise em boyutuna.
// İkisinin aynı görünmesi için em boyutunu bu oranla çarpıyoruz.
const FONT_RATIO = { Anton: 1.7334, "Poppins Black": 1.762, "Poppins Bold": 1.762 };
function assSize(font, em) {
  return Math.round(em * (FONT_RATIO[font] || 1.6));
}

function outputSize(layout) {
  return layout === "yatay" ? { W: 1920, H: 1080 } : { W: 1080, H: 1920 };
}

function buildAss(proj, dur) {
  const { W, H } = outputSize(proj.layout);
  const st = STYLES[proj.subStyle] || STYLES.montajer;
  const size = assSize(st.font, H * (proj.layout === "yatay" ? 0.075 : 0.066) * (proj.subSize / 100));
  const ow = Math.max(2, Math.round(H * st.ow));
  const sh = Math.max(0, Math.round(H * st.shadow));
  const align = proj.subPos === "ust" ? 8 : proj.subPos === "orta" ? 5 : 2;
  const marginV = proj.subPos === "orta" ? 0 : Math.round(H * (proj.layout === "yatay" ? 0.08 : 0.2));
  const hookEm = H * (proj.layout === "yatay" ? 0.06 : 0.038);
  const hookSize = assSize("Poppins Black", hookEm);
  const wmSize = assSize("Poppins Bold", H * (proj.layout === "yatay" ? 0.03 : 0.018));
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Sub,${st.font},${size},${st.primary},&H000000FF,${st.outline},${st.back},0,0,0,0,100,100,0,0,1,${ow},${sh},${align},${Math.round(W * 0.06)},${Math.round(W * 0.06)},${marginV},1`,
    `Style: Hook,Poppins Black,${hookSize},&H00FFFFFF,&H000000FF,&H00000000,&H99000000,0,0,0,0,100,100,0,0,3,${Math.round(hookEm * 0.35)},0,8,${Math.round(W * 0.06)},${Math.round(W * 0.06)},${Math.round(H * 0.07)},1`,
    `Style: Mark,Poppins Bold,${wmSize},&H60FFFFFF,&H000000FF,&H80000000,&H00000000,0,0,0,0,100,100,0,0,1,${Math.max(1, Math.round(wmSize * 0.05))},0,3,${Math.round(W * 0.03)},${Math.round(W * 0.03)},${Math.round(H * 0.02)},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const t0 = proj.trimStart;
  for (const s of proj.subs || []) {
    const a = s.start - t0, b = s.end - t0;
    if (b <= 0 || a >= dur || !String(s.text).trim()) continue;
    const text = proj.subUpper ? upperTr(s.text) : s.text;
    // hafif "pop" efekti: yazı %80'den %100'e büyüyerek çıkar
    lines.push(`Dialogue: 1,${assTime(a)},${assTime(Math.min(b, dur))},Sub,,0,0,0,,{\\fscx85\\fscy85\\t(0,90,\\fscx100\\fscy100)}${assEsc(text)}`);
  }
  if (proj.hookText && proj.hookText.trim()) lines.push(`Dialogue: 2,${assTime(0)},${assTime(dur)},Hook,,0,0,0,,${assEsc(proj.hookText.trim())}`);
  if (proj.watermark && proj.watermarkText) lines.push(`Dialogue: 0,${assTime(0)},${assTime(dur)},Mark,,0,0,0,,${assEsc(proj.watermarkText)}`);
  return lines.join("\n") + "\n";
}

function f4(n) {
  return Math.max(0, Math.min(1, Number(n) || 0)).toFixed(4);
}

function layoutFilter(proj) {
  const L = proj.layout;
  if (L === "yatay") return "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1[base]";
  if (L === "kirp") return `[0:v]crop=w='min(iw,ih*9/16)':h=ih:x='(iw-min(iw,ih*9/16))*${f4(proj.cropX)}':y=0,scale=1080:1920,setsar=1[base]`;
  if (L === "bolunmus") {
    const topH = Math.round((1920 * Math.min(0.6, Math.max(0.2, proj.splitRatio))) / 2) * 2;
    const botH = 1920 - topH;
    const c = proj.camRect, g = proj.gameRect;
    const crop = (r) => `crop=w='iw*${f4(r.w)}':h='ih*${f4(r.h)}':x='iw*${f4(r.x)}':y='ih*${f4(r.y)}'`;
    return `[0:v]split=2[c][g];[c]${crop(c)},scale=1080:${topH}:force_original_aspect_ratio=increase,crop=1080:${topH}[top];[g]${crop(g)},scale=1080:${botH}:force_original_aspect_ratio=increase,crop=1080:${botH}[bot];[top][bot]vstack=inputs=2,setsar=1[base]`;
  }
  return "[0:v]split=2[a][b];[a]scale=540:960:force_original_aspect_ratio=increase,crop=540:960,boxblur=18:2,scale=1080:1920,setsar=1[bg];[b]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[base]";
}

function render(proj, outFile, onProgress) {
  return new Promise((resolve, reject) => {
    const dur = Math.max(1, proj.trimEnd - proj.trimStart);
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "yc-render-"));
    const fdir = path.join(work, "fonts");
    fs.mkdirSync(fdir);
    for (const f of fs.readdirSync(FONT_DIR)) if (/\.ttf$/i.test(f)) fs.writeFileSync(path.join(fdir, f), fs.readFileSync(path.join(FONT_DIR, f)));
    fs.writeFileSync(path.join(work, "yazi.ass"), buildAss(proj, dur), "utf8");
    const fc = `${layoutFilter(proj)};[base]subtitles=yazi.ass:fontsdir=fonts,format=yuv420p[v]`;
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const args = ["-hide_banner", "-y", "-ss", String(proj.trimStart), "-i", proj.baseFile, "-t", String(dur), "-filter_complex", fc, "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outFile];
    const p = spawn(ffmpegPath(), args, { windowsHide: true, cwd: work });
    let err = "";
    p.stderr.on("data", (d) => {
      const s = d.toString();
      err = (err + s).slice(-4000);
      const m = s.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
      if (m && onProgress) onProgress(Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / dur));
    });
    p.on("error", reject);
    p.on("close", (code) => {
      fs.rm(work, { recursive: true, force: true }, () => {});
      if (code === 0 && fs.existsSync(outFile)) resolve(outFile);
      else reject(new Error("Video üretilemedi: " + err.split("\n").filter(Boolean).slice(-3).join(" ")));
    });
  });
}

module.exports = { Projects, createProject, render, buildAss, layoutFilter, outputSize, DEFAULTS, hms };
