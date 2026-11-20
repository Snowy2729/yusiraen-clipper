// ---------- STÜDYO (editör) ----------
const st = { sessionId: null, rank: null, proj: null, moment: null, session: null, dur: 0, raf: 0, saveT: 0, subsEdited: false, lastExport: null, dirty: true, stopAt: null };
const SUB_COLORS = {
  montajer: { fill: "#FFF000", stroke: "#000000", ow: 0.0055, font: "Anton" },
  beyaz: { fill: "#FFFFFF", stroke: "#000000", ow: 0.004, font: "Poppins Black" },
  yusiraen: { fill: "#FFFFFF", stroke: "#850D12", ow: 0.006, font: "Anton" },
};
const LAYOUT_HELP = {
  bulanik: "Görüntü ortada, arka planı aynı görüntünün bulanık hali. Her yayına uyar.",
  bolunmus: "Soldaki videoda <b style='color:#ff6b6b'>kırmızı kutuyu</b> yayıncının kamerasına, <b style='color:#6bb6ff'>mavi kutuyu</b> oyuna taşı. Köşedeki beyaz kare ile boyutlandır.",
  kirp: "Soldaki videoda <b style='color:#ffd34a'>sarı kadrajı</b> sağa sola kaydırarak neyin görüneceğini seç.",
  yatay: "Normal YouTube videosu (16:9). Altyazı ve yazılar yine eklenir.",
};

function relT(t) {
  const r = t - (st.proj ? st.proj.trimStart : 0);
  const sgn = r < 0 ? "−" : "";
  const a = Math.abs(r);
  return `${sgn}${Math.floor(a / 60)}:${String(Math.floor(a % 60)).padStart(2, "0")}.${Math.floor((a * 10) % 10)}`;
}

async function openStudio(sessionId, rank) {
  Object.assign(st, { sessionId, rank, proj: null, subsEdited: false, lastExport: null, dirty: true, stopAt: null });
  showView("studio");
  $("stGrid").classList.add("hidden");
  $("stLoading").classList.remove("hidden");
  $("stLoadBar").style.width = "0%";
  $("stLoadText").textContent = "Klip hazırlanıyor (yayın kaydından kesiliyor)...";
  $("stTitle").textContent = "Stüdyo";
  $("stSub").textContent = "";
  const vodUrl = ($("vodUrl") && $("vodUrl").value.trim()) || null;
  const r = await api.editorOpen({ sessionId, rank, vodUrl });
  if (r.error) {
    $("stLoading").classList.add("hidden");
    await modal("Stüdyo açılamadı", esc(r.error), [{ label: "Tamam", value: 1, kind: "primary" }]);
    return closeStudio();
  }
  st.proj = r.project;
  st.moment = r.moment;
  st.session = r.session;
  st.lastExport = r.project.lastExport || null;
  st.dirty = !st.lastExport;
  $("stTitle").textContent = `#${r.moment.rank} · ${TYPE[r.moment.type] || ""}${r.moment.keyword ? ": " + r.moment.keyword : ""} · ${r.session.streamer}`;
  $("stSub").textContent = r.session.title;
  $("stModelNote").textContent = r.whisper.model.ready ? "" : `İlk seferde Türkçe konuşma modeli indirilecek (${r.whisper.model.size}), sonra hep bilgisayarında kalır.`;
  const v = $("stVideo");
  v.src = r.baseUrl;
  v.onloadedmetadata = () => {
    st.dur = v.duration || st.proj.baseDur;
    v.currentTime = st.proj.trimStart;
    $("stLoading").classList.add("hidden");
    $("stGrid").classList.remove("hidden");
    fillStudio();
    startDraw();
  };
  v.onerror = () => {
    $("stLoadText").textContent = "Klip açılamadı.";
  };
}

function closeStudio() {
  cancelAnimationFrame(st.raf);
  st.raf = 0;
  const v = $("stVideo");
  v.pause();
  if (st.proj) flushSave();
  showView("sessions");
  if (detailId) openDetail(detailId);
}
$("stBack").onclick = closeStudio;
$("stReset").onclick = async () => {
  const ok = await modal("Baştan başla?", "Bu anın kaynak klibi ve tüm düzenlemeleri (altyazı, yazılar) silinecek, klip yayın kaydından yeniden kesilecek. Oluşturduğun videolar silinmez.", [
    { label: "Vazgeç", value: false, kind: "ghost" },
    { label: "Baştan başla", value: true, kind: "danger" },
  ]);
  if (!ok) return;
  clearTimeout(st.saveT);
  const { sessionId, rank } = st;
  st.proj = null;
  $("stVideo").pause();
  $("stVideo").removeAttribute("src");
  await api.editorReset({ sessionId, rank });
  openStudio(sessionId, rank);
};

function saveSoon() {
  st.dirty = true;
  $("stSaved").textContent = "Kaydediliyor...";
  clearTimeout(st.saveT);
  st.saveT = setTimeout(flushSave, 600);
}
async function flushSave() {
  clearTimeout(st.saveT);
  if (!st.proj) return;
  await api.editorSave({ sessionId: st.sessionId, rank: st.rank, project: st.proj });
  $("stSaved").textContent = "Kaydedildi ✓";
}

// ---- sekmeler ----
document.querySelectorAll(".st-tab").forEach((b) => (b.onclick = () => {
  document.querySelectorAll(".st-tab").forEach((x) => x.classList.toggle("on", x === b));
  for (const t of ["format", "subs", "text", "share"]) $("tp-" + t).classList.toggle("hidden", t !== b.dataset.t);
  if (b.dataset.t === "share") openShare();
}));

function fillStudio() {
  const p = st.proj;
  document.querySelectorAll(".lay").forEach((b) => b.classList.toggle("on", b.dataset.l === p.layout));
  $("stSplit").value = p.splitRatio;
  $("fSplit").classList.toggle("hidden", p.layout !== "bolunmus");
  $("fHelp").innerHTML = LAYOUT_HELP[p.layout] || "";
  $("stHook").value = p.hookText || "";
  $("stWm").checked = !!p.watermark;
  $("stWmText").value = p.watermarkText || "";
  setSeg("sStyle", p.subStyle);
  setSeg("sPos", p.subPos);
  $("sSize").value = p.subSize;
  $("sWords").value = String(p.subWords || 3);
  $("sUpper").checked = !!p.subUpper;
  renderSubs();
  positionRects();
  renderTrim();
  sizeCanvas();
  $("stExpDone").classList.toggle("hidden", !st.lastExport);
  if (st.lastExport) $("stExpFile").textContent = st.lastExport;
}
function setSeg(id, v) {
  $(id).querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
}
document.querySelectorAll(".lay").forEach((b) => (b.onclick = () => {
  st.proj.layout = b.dataset.l;
  fillStudio();
  saveSoon();
}));
$("stSplit").oninput = (e) => {
  st.proj.splitRatio = Number(e.target.value);
  saveSoon();
};
for (const id of ["sStyle", "sPos"]) {
  $(id).querySelectorAll("button").forEach((b) => (b.onclick = () => {
    if (id === "sStyle") st.proj.subStyle = b.dataset.v;
    else st.proj.subPos = b.dataset.v;
    setSeg(id, b.dataset.v);
    saveSoon();
  }));
}
$("sSize").oninput = (e) => {
  st.proj.subSize = Number(e.target.value);
  saveSoon();
};
$("sUpper").onchange = (e) => {
  st.proj.subUpper = e.target.checked;
  saveSoon();
};
$("sWords").onchange = async (e) => {
  const n = Number(e.target.value);
  if (!st.proj.words || !st.proj.words.length) {
    st.proj.subWords = n;
    return saveSoon();
  }
  if (st.subsEdited) {
    const ok = await modal("Satırlar yeniden bölünsün mü?", "Altyazıda elle yaptığın düzeltmeler kaybolacak.", [
      { label: "Vazgeç", value: false, kind: "ghost" },
      { label: "Yeniden böl", value: true, kind: "primary" },
    ]);
    if (!ok) return (e.target.value = String(st.proj.subWords || 3));
  }
  st.proj.subWords = n;
  st.proj.subs = await api.editorRegroup({ words: st.proj.words, maxWords: n });
  st.subsEdited = false;
  renderSubs();
  saveSoon();
};
$("stHook").oninput = (e) => {
  st.proj.hookText = e.target.value;
  saveSoon();
};
$("stWm").onchange = (e) => {
  st.proj.watermark = e.target.checked;
  saveSoon();
};
$("stWmText").oninput = (e) => {
  st.proj.watermarkText = e.target.value;
  saveSoon();
};
$("stHookSuggest").onclick = async () => {
  const s = await api.editorSuggest({ sessionId: st.sessionId, rank: st.rank, project: st.proj });
  st.proj.hookText = s.hook;
  $("stHook").value = s.hook;
  saveSoon();
};

// ---- altyazı ----
function renderSubs() {
  const p = st.proj;
  const has = (p.subs || []).length > 0;
  $("subEmpty").classList.toggle("hidden", has);
  $("subEdit").classList.toggle("hidden", !has);
  if (!has) return;
  $("subList").innerHTML = p.subs
    .map((s, i) => `<div class="sub-row" data-i="${i}"><span class="tt" data-seek="${s.start}">${relT(s.start)}</span><input value="${esc(s.text)}" data-i="${i}" spellcheck="false"><button class="x" data-del="${i}" title="Sil">×</button></div>`)
    .join("");
  $("subList").querySelectorAll("input").forEach((inp) => (inp.oninput = () => {
    p.subs[Number(inp.dataset.i)].text = inp.value;
    st.subsEdited = true;
    saveSoon();
  }));
  $("subList").querySelectorAll("[data-seek]").forEach((el) => (el.onclick = () => ($("stVideo").currentTime = Number(el.dataset.seek))));
  $("subList").querySelectorAll("[data-del]").forEach((el) => (el.onclick = () => {
    p.subs.splice(Number(el.dataset.del), 1);
    st.subsEdited = true;
    renderSubs();
    saveSoon();
  }));
}
$("subAdd").onclick = () => {
  const t = $("stVideo").currentTime;
  const p = st.proj;
  p.subs.push({ start: Math.round(t * 100) / 100, end: Math.round((t + 1.2) * 100) / 100, text: "yazı" });
  p.subs.sort((a, b) => a.start - b.start);
  st.subsEdited = true;
  renderSubs();
  saveSoon();
  const i = p.subs.findIndex((s) => Math.abs(s.start - Math.round(t * 100) / 100) < 0.01);
  const inp = $("subList").querySelector(`input[data-i="${i}"]`);
  if (inp) { inp.focus(); inp.select(); }
};
async function doTranscribe() {
  $("stTranscribe").disabled = true;
  $("subRedo").disabled = true;
  $("stModelNote").textContent = "Başlıyor...";
  await flushSave();
  const r = await api.editorTranscribe({ sessionId: st.sessionId, rank: st.rank, maxWords: Number($("sWords").value) || 3 });
  $("stTranscribe").disabled = false;
  $("subRedo").disabled = false;
  if (r.error) {
    $("stModelNote").textContent = "";
    return modal("Altyazı oluşturulamadı", esc(r.error), [{ label: "Tamam", value: 1, kind: "primary" }]);
  }
  st.proj.words = r.words;
  st.proj.subs = r.subs;
  st.subsEdited = false;
  st.dirty = true;
  $("stModelNote").textContent = "";
  renderSubs();
  toast(r.subs.length ? `${r.subs.length} satır altyazı oluşturuldu` : "Klipte konuşma bulunamadı");
}
$("stTranscribe").onclick = doTranscribe;
$("subRedo").onclick = async () => {
  const ok = await modal("Altyazı yeniden oluşturulsun mu?", "Mevcut altyazı ve düzeltmelerin silinecek.", [
    { label: "Vazgeç", value: false, kind: "ghost" },
    { label: "Yeniden oluştur", value: true, kind: "primary" },
  ]);
  if (ok) {
    st.proj.subs = [];
    renderSubs();
    $("subEmpty").classList.remove("hidden");
    doTranscribe();
  }
};
const PHASE = { model: "Konuşma modeli indiriliyor", ses: "Ses ayrıştırılıyor", yazi: "Konuşma yazıya dökülüyor", kaynak: "Klip yayın kaydından kesiliyor", render: "Video oluşturuluyor" };
api.onEditorProgress((p) => {
  const pct = Math.round((p.frac || 0) * 100);
  if (p.phase === "kaynak") {
    $("stLoadBar").style.width = pct + "%";
    $("stLoadText").textContent = `${PHASE.kaynak}... %${pct}`;
  } else if (p.phase === "render") {
    $("stExpBar").style.width = pct + "%";
    $("stExpText").textContent = `${PHASE.render}... %${pct}`;
  } else if (PHASE[p.phase]) {
    $("stModelNote").textContent = `${PHASE[p.phase]}... ${p.frac ? "%" + pct : ""}`;
  }
});

// ---- kırpma çubuğu ----
function renderTrim() {
  const p = st.proj;
  const d = st.dur || p.baseDur || 1;
  $("stSel").style.left = (p.trimStart / d) * 100 + "%";
  $("stSel").style.width = Math.max(0.5, ((p.trimEnd - p.trimStart) / d) * 100) + "%";
  $("stLen").textContent = `${(p.trimEnd - p.trimStart).toFixed(1)} sn`;
}
(() => {
  const track = $("stTrack");
  const toT = (x) => {
    const r = track.getBoundingClientRect();
    return Math.min(1, Math.max(0, (x - r.left) / r.width)) * (st.dur || 1);
  };
  let drag = null;
  $("stHL").onmousedown = (e) => { drag = "s"; e.stopPropagation(); e.preventDefault(); };
  $("stHR").onmousedown = (e) => { drag = "e"; e.stopPropagation(); e.preventDefault(); };
  track.onmousedown = (e) => { if (!drag) $("stVideo").currentTime = toT(e.clientX); };
  window.addEventListener("mousemove", (e) => {
    if (!drag || !st.proj) return;
    const t = toT(e.clientX);
    if (drag === "s") st.proj.trimStart = Math.max(0, Math.min(t, st.proj.trimEnd - 1));
    else st.proj.trimEnd = Math.min(st.dur, Math.max(t, st.proj.trimStart + 1));
    $("stVideo").currentTime = drag === "s" ? st.proj.trimStart : Math.max(st.proj.trimStart, st.proj.trimEnd - 0.5);
    renderTrim();
  });
  window.addEventListener("mouseup", () => {
    if (drag) { saveSoon(); renderSubs(); }
    drag = null;
  });
})();
$("stSetIn").onclick = () => {
  st.proj.trimStart = Math.min($("stVideo").currentTime, st.proj.trimEnd - 1);
  renderTrim(); renderSubs(); saveSoon();
};
$("stSetOut").onclick = () => {
  st.proj.trimEnd = Math.max($("stVideo").currentTime, st.proj.trimStart + 1);
  renderTrim(); saveSoon();
};
$("stPlay").onclick = () => {
  const v = $("stVideo");
  if (!v.paused) return v.pause();
  if (v.currentTime < st.proj.trimStart || v.currentTime >= st.proj.trimEnd - 0.1) v.currentTime = st.proj.trimStart;
  st.stopAt = st.proj.trimEnd;
  v.play().catch(() => {});
};
$("stVideo").onplay = () => ($("stPlay").textContent = "⏸ Durdur");
$("stVideo").onpause = () => ($("stPlay").textContent = "▶ Oynat");
$("stVideo").ontimeupdate = () => {
  const v = $("stVideo");
  const t = v.currentTime;
  $("stTime").textContent = relT(t);
  $("stPlayhead").style.left = (t / (st.dur || 1)) * 100 + "%";
  if (st.stopAt != null && t >= st.stopAt) { v.pause(); st.stopAt = null; }
  const rows = $("subList").querySelectorAll(".sub-row");
  (st.proj.subs || []).forEach((s, i) => rows[i] && rows[i].classList.toggle("on", t >= s.start && t < s.end));
};

// ---- kamera / oyun / kadraj kutuları ----
function positionRects() {
  const p = st.proj;
  const show = (id, on) => $(id).classList.toggle("hidden", !on);
  show("rCam", p.layout === "bolunmus");
  show("rGame", p.layout === "bolunmus");
  show("rCrop", p.layout === "kirp");
  const put = (id, r) => Object.assign($(id).style, { left: r.x * 100 + "%", top: r.y * 100 + "%", width: r.w * 100 + "%", height: r.h * 100 + "%" });
  if (p.layout === "bolunmus") { put("rCam", p.camRect); put("rGame", p.gameRect); }
  if (p.layout === "kirp") {
    const w = (9 / 16) / (16 / 9);
    put("rCrop", { x: (1 - w) * p.cropX, y: 0, w, h: 1 });
  }
  $("stRectNote").innerHTML = p.layout === "bolunmus" ? "Kutuları sürükleyerek taşı, sağ alt köşeden boyutlandır." : p.layout === "kirp" ? "Sarı kadrajı sağa sola sürükle." : "";
}
function rectDrag(id, key) {
  const el = $(id);
  const box = $("stSrc");
  let mode = null, sx = 0, sy = 0, orig = null;
  el.onmousedown = (e) => {
    mode = e.target.classList.contains("rz") ? "rz" : "mv";
    sx = e.clientX; sy = e.clientY;
    orig = key === "crop" ? { cropX: st.proj.cropX } : { ...st.proj[key] };
    e.preventDefault(); e.stopPropagation();
  };
  window.addEventListener("mousemove", (e) => {
    if (!mode) return;
    const b = box.getBoundingClientRect();
    const dx = (e.clientX - sx) / b.width, dy = (e.clientY - sy) / b.height;
    if (key === "crop") {
      const w = (9 / 16) / (16 / 9);
      const x0 = (1 - w) * orig.cropX;
      st.proj.cropX = Math.min(1, Math.max(0, (x0 + dx) / (1 - w)));
    } else {
      const r = st.proj[key];
      if (mode === "mv") {
        r.x = Math.min(1 - r.w, Math.max(0, orig.x + dx));
        r.y = Math.min(1 - r.h, Math.max(0, orig.y + dy));
      } else {
        r.w = Math.min(1 - r.x, Math.max(0.05, orig.w + dx));
        r.h = Math.min(1 - r.y, Math.max(0.05, orig.h + dy));
      }
    }
    positionRects();
  });
  window.addEventListener("mouseup", () => {
    if (mode) saveSoon();
    mode = null;
  });
}
rectDrag("rCam", "camRect");
rectDrag("rGame", "gameRect");
rectDrag("rCrop", "crop");

// ---- canlı önizleme (son videoyla aynı düzen) ----
function sizeCanvas() {
  const c = $("stCanvas");
  const vert = st.proj.layout !== "yatay";
  const cw = vert ? 300 : 356, ch = vert ? 533 : 200;
  c.style.width = cw + "px";
  c.style.height = ch + "px";
  c.width = cw * 2;
  c.height = ch * 2;
}
function coverDraw(g, v, sx, sy, sw, sh, dx, dy, dw, dh) {
  // kaynak bölgeyi hedefi dolduracak şekilde ortadan kırp
  const sa = sw / sh, da = dw / dh;
  if (sa > da) { const nw = sh * da; sx += (sw - nw) / 2; sw = nw; } else { const nh = sw / da; sy += (sh - nh) / 2; sh = nh; }
  g.drawImage(v, sx, sy, sw, sh, dx, dy, dw, dh);
}
function wrapLines(g, text, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}
function drawFrame() {
  const c = $("stCanvas"), g = c.getContext("2d"), v = $("stVideo"), p = st.proj;
  if (!p) return;
  const W = c.width, H = c.height, vw = v.videoWidth, vh = v.videoHeight;
  g.fillStyle = "#000";
  g.fillRect(0, 0, W, H);
  if (vw && vh) {
    if (p.layout === "yatay") {
      const s = Math.min(W / vw, H / vh);
      g.drawImage(v, (W - vw * s) / 2, (H - vh * s) / 2, vw * s, vh * s);
    } else if (p.layout === "kirp") {
      const cw = Math.min(vw, (vh * 9) / 16);
      g.drawImage(v, (vw - cw) * p.cropX, 0, cw, vh, 0, 0, W, H);
    } else if (p.layout === "bolunmus") {
      const topH = Math.round(H * p.splitRatio);
      const r = (q) => [q.x * vw, q.y * vh, q.w * vw, q.h * vh];
      coverDraw(g, v, ...r(p.camRect), 0, 0, W, topH);
      coverDraw(g, v, ...r(p.gameRect), 0, topH, W, H - topH);
    } else {
      g.save();
      g.filter = `blur(${Math.round(W / 40)}px)`;
      coverDraw(g, v, 0, 0, vw, vh, -W * 0.05, -H * 0.05, W * 1.1, H * 1.1);
      g.restore();
      const fh = (W / vw) * vh;
      g.drawImage(v, 0, (H - fh) / 2, W, fh);
    }
  }
  const vert = p.layout !== "yatay";
  const t = v.currentTime;
  const sub = (p.subs || []).find((s) => t >= s.start && t < s.end);
  if (sub && sub.text.trim()) {
    const sc = SUB_COLORS[p.subStyle] || SUB_COLORS.montajer;
    const size = Math.round(H * (vert ? 0.066 : 0.075) * (p.subSize / 100));
    g.font = `${size}px "${sc.font}"`;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.lineJoin = "round";
    const text = p.subUpper ? sub.text.toLocaleUpperCase("tr-TR") : sub.text;
    const lines = wrapLines(g, text, W * 0.88);
    const lh = size * 1.15;
    const total = lh * lines.length;
    let y0;
    if (p.subPos === "ust") y0 = H * (vert ? 0.2 : 0.08) + size;
    else if (p.subPos === "orta") y0 = H / 2 - total / 2 + size * 0.85;
    else y0 = H - H * (vert ? 0.2 : 0.08) - total + size * 0.85;
    lines.forEach((ln, i) => {
      const y = y0 + i * lh;
      g.lineWidth = Math.max(3, H * sc.ow * 2);
      g.strokeStyle = sc.stroke;
      g.strokeText(ln, W / 2, y);
      g.fillStyle = sc.fill;
      g.fillText(ln, W / 2, y);
    });
  }
  if (p.hookText && p.hookText.trim()) {
    const hs = Math.round(H * (vert ? 0.038 : 0.06));
    g.font = `${hs}px "Poppins Black"`;
    g.textAlign = "center";
    const lines = wrapLines(g, p.hookText.trim(), W * 0.84);
    const pad = hs * 0.35, lh = hs * 1.2;
    let y = H * 0.07;
    lines.forEach((ln) => {
      const w = g.measureText(ln).width;
      g.fillStyle = "rgba(0,0,0,.6)";
      g.fillRect(W / 2 - w / 2 - pad, y - pad * 0.3, w + pad * 2, lh + pad * 0.6);
      g.fillStyle = "#fff";
      g.textBaseline = "top";
      g.fillText(ln, W / 2, y + hs * 0.08);
      y += lh + pad * 0.6;
    });
  }
  if (p.watermark && p.watermarkText) {
    const ws = Math.round(H * (vert ? 0.018 : 0.03));
    g.font = `${ws}px "Poppins Bold"`;
    g.textAlign = "right";
    g.textBaseline = "bottom";
    g.fillStyle = "rgba(255,255,255,.62)";
    g.fillText(p.watermarkText, W - W * 0.03, H - H * 0.02);
  }
}
function startDraw() {
  cancelAnimationFrame(st.raf);
  const loop = () => {
    if (!$("view-studio").classList.contains("active")) return;
    drawFrame();
    st.raf = requestAnimationFrame(loop);
  };
  document.fonts.load('40px "Anton"').then(() => document.fonts.load('40px "Poppins Black"')).finally(loop);
}

// ---- paylaş: dışa aktar + YouTube ----
async function doExport() {
  await flushSave();
  $("stExport").disabled = true;
  $("stExpProg").classList.remove("hidden");
  $("stExpBar").style.width = "0%";
  $("stExpText").textContent = "Video oluşturuluyor...";
  const r = await api.editorExport({ sessionId: st.sessionId, rank: st.rank, project: st.proj });
  $("stExport").disabled = false;
  $("stExpProg").classList.add("hidden");
  if (r.error) {
    await modal("Video oluşturulamadı", esc(r.error), [{ label: "Tamam", value: 1, kind: "primary" }]);
    return null;
  }
  st.lastExport = r.file;
  st.dirty = false;
  $("stExpDone").classList.remove("hidden");
  $("stExpFile").textContent = r.file;
  toast("Video hazır ✓");
  return r.file;
}
$("stExport").onclick = doExport;
$("stShowFile").onclick = () => st.lastExport && api.showItem(st.lastExport);
$("ytGoSettings").onclick = (e) => {
  e.preventDefault();
  showView("settings");
};

async function openShare() {
  const ys = await api.ytStatus();
  $("ytNo").classList.toggle("hidden", ys.connected);
  $("ytUpload").disabled = !ys.connected;
  $("ytPrivacy").disabled = !ys.connected;
  const sug = await api.editorSuggest({ sessionId: st.sessionId, rank: st.rank, project: st.proj });
  const p = st.proj;
  if (!p.title) p.title = sug.titles[0] || "";
  if (!p.description) p.description = sug.description;
  if (!p.tags) p.tags = sug.hashtags.map((h) => h.replace(/^#/, "")).join(", ");
  $("ytTitle").value = p.title;
  $("ytDesc").value = p.description;
  $("ytTags").value = p.tags;
  $("ytPrivacy").value = p.privacy || "private";
  $("ytTitleSug").innerHTML = sug.titles.map((t) => `<span class="chip" title="Bu başlığı kullan">${esc(t)}</span>`).join("");
  $("ytTitleSug").querySelectorAll(".chip").forEach((c) => (c.onclick = () => {
    p.title = c.textContent;
    $("ytTitle").value = p.title;
    saveSoon();
  }));
  const ups = p.uploads || [];
  $("ytDone").innerHTML = ups.length ? `<div class="muted small-note">Daha önce yüklendi: ${ups.map((u) => `<a href="#" data-url="${esc(u.url)}">${esc(u.url)}</a>`).join(", ")}</div>` : "";
  $("ytDone").querySelectorAll("a").forEach((a) => (a.onclick = (e) => { e.preventDefault(); api.openUrl(a.dataset.url); }));
}
$("cpTitle").onclick = () => copy(st.proj.title || "");
$("cpDesc").onclick = () => { navigator.clipboard.writeText(st.proj.description || "").then(() => toast("Açıklama kopyalandı", 1400)); };
$("cpShow").onclick = async () => {
  let file = st.lastExport;
  if (!file || st.dirty) { toast("Önce son hali ile video oluşturuluyor..."); file = await doExport(); }
  if (file) api.showItem(file);
};
$("openStudioYt").onclick = () => api.openUrl("https://studio.youtube.com");
$("ytTitle").oninput = (e) => { st.proj.title = e.target.value; saveSoon(); };
$("ytDesc").oninput = (e) => { st.proj.description = e.target.value; saveSoon(); };
$("ytTags").oninput = (e) => { st.proj.tags = e.target.value; saveSoon(); };
$("ytPrivacy").onchange = (e) => { st.proj.privacy = e.target.value; saveSoon(); };
$("ytUpload").onclick = async () => {
  const p = st.proj;
  if (!p.title.trim()) return toast("Başlık yaz");
  let file = st.lastExport;
  if (!file || st.dirty) {
    toast("Önce son hali ile video oluşturuluyor...");
    file = await doExport();
    if (!file) return;
  }
  $("ytUpload").disabled = true;
  $("ytProg").classList.remove("hidden");
  $("ytBar").style.width = "0%";
  $("ytProgText").textContent = "Yükleniyor...";
  const r = await api.ytUpload({
    sessionId: st.sessionId,
    rank: st.rank,
    file,
    meta: { title: p.title.trim(), description: p.description || "", tags: (p.tags || "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 30), privacy: p.privacy || "private" },
  });
  $("ytUpload").disabled = false;
  $("ytProg").classList.add("hidden");
  if (r.error) return modal("Yüklenemedi", esc(r.error), [{ label: "Tamam", value: 1, kind: "primary" }]);
  p.uploads = [...(p.uploads || []), { url: r.url }];
  const locked = r.requested !== "private";
  const go = await modal("YouTube'a yüklendi 🎉", `<a href="#">${esc(r.url)}</a>${locked ? "<br><br><span class='muted'>Not: Uygulama Google denetiminden geçene kadar YouTube bu videoyu <b>gizli</b> tutabilir. Öyleyse YouTube Studio'dan tekrar yüklemen gerekir.</span>" : ""}`, [
    { label: "Kapat", value: false, kind: "ghost" },
    { label: "Videoyu aç", value: true, kind: "primary" },
  ]);
  if (go) api.openUrl(r.url);
  openShare();
};
api.onYtProgress((f) => {
  $("ytBar").style.width = Math.round(f * 100) + "%";
  $("ytProgText").textContent = `Yükleniyor... %${Math.round(f * 100)}`;
});
window.addEventListener("keydown", (e) => {
  if (!$("view-studio").classList.contains("active") || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (e.code === "Space") { e.preventDefault(); $("stPlay").click(); }
});
