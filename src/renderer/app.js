const $ = (id) => document.getElementById(id);

let settings = null;
let currentStreamer = null;
let selectedStream = null;
let detailId = null;
let detailData = null;
let sortBy = "score";

// ---------- yardımcılar ----------
function hms(sn) {
  sn = Math.max(0, Math.round(sn || 0));
  const h = Math.floor(sn / 3600), m = Math.floor((sn % 3600) / 60), s = sn % 60, p = (n) => String(n).padStart(2, "0");
  return `${h}:${p(m)}:${p(s)}`;
}
function since(iso) {
  return iso ? (Date.now() - Date.parse(iso)) / 1000 : 0;
}
function esc(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }) + " · " + d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}
function dur(a, b) {
  const s = Math.max(0, (Date.parse(b) - Date.parse(a)) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} sa ${m} dk` : `${m} dk`;
}
function num(n) {
  return (n || 0).toLocaleString("tr-TR");
}
let toastT;
function toast(t, ms = 2600) {
  const el = $("toast");
  el.textContent = t;
  el.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove("show"), ms);
}
function copy(t) {
  navigator.clipboard.writeText(t).then(() => toast(t + " kopyalandı", 1400)).catch(() => {});
}
function avatarHtml(el, name, url) {
  el.style.backgroundImage = url ? `url("${url}")` : "";
  el.textContent = url ? "" : (name || "?")[0].toUpperCase();
}
function modal(title, bodyHtml, buttons, column = false) {
  return new Promise((resolve) => {
    $("mTitle").textContent = title;
    $("mBody").innerHTML = bodyHtml;
    const box = $("mBtns");
    box.className = "m-btns" + (column ? " col" : "");
    box.innerHTML = "";
    for (const b of buttons) {
      const btn = document.createElement("button");
      btn.className = "btn " + (b.kind || "");
      btn.textContent = b.label;
      btn.onclick = () => {
        $("modal").classList.add("hidden");
        resolve(b.value);
      };
      box.appendChild(btn);
    }
    $("modal").classList.remove("hidden");
  });
}

// ---------- sekmeler ----------
function showView(v) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === v));
  document.querySelectorAll(".view").forEach((s) => s.classList.toggle("active", s.id === "view-" + v));
  if (v === "sessions") renderSessions();
  if (v === "stats") renderStats();
  if (v === "settings") fillYtSettings();
}
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => showView(t.dataset.view)));

// ---------- CANLI ----------
let liveList = [];
let liveMax = 3;
let selectedLive = "new";

function renderChips() {
  $("followChips").innerHTML = settings.channels.map((c) => `<span class="chip" data-c="${esc(c)}">${esc(c)}</span>`).join("");
  document.querySelectorAll(".chip").forEach((c) => (c.onclick = () => ($("slugInput").value = c.dataset.c)));
}

function setMsg(t, info = false) {
  const el = $("connectMsg");
  el.textContent = t || "";
  el.classList.toggle("info", info);
}

// Tek bir kanala bağlanır (gerekirse devam sorusunu sorar). true = bağlandı
async function connectOne(ch) {
  setMsg(`${ch.username} yayınına bağlanılıyor...`, true);
  let res = await api.liveConnect({ slug: ch.slug });
  if (res.needDecision) {
    const c = res.candidate;
    const body = `<b>${esc(ch.username)}</b> için daha önce kaydettiğin bir yayın var:<br><br>
      <div style="background:#0e0e0e;border:1px solid #242424;border-radius:8px;padding:10px 14px">
      <b>${esc(c.title)}</b><br><span class="muted">${fmtDate(c.recordStart)} · ${num(c.messageCount)} mesaj</span></div><br>
      ${res.sameStream ? "Kick'e göre bu <b>aynı yayın</b>, büyük ihtimalle devamı." : "Şu anki yayının başlığı: <b>" + esc(res.info.livestream.title) + "</b>"}<br>
      Bu yeni bir yayın mı, yoksa öncekinin devamı mı?`;
    const choice = await modal("Yeni yayın mı, devamı mı?", body, [
      { label: "Vazgeç", value: null, kind: "ghost" },
      { label: "Yeni yayın", value: "new" },
      { label: "Devamı — birleştir", value: "continue", kind: "primary" },
    ]);
    if (!choice) return false;
    res = await api.liveConnect({ slug: ch.slug, mode: choice, targetId: c.id });
  }
  if (res.error) {
    setMsg(res.error);
    return false;
  }
  selectedLive = res.slug;
  applyLive(res.state);
  return true;
}

async function connectFlow() {
  const btn = $("connectBtn");
  if (liveList.length >= liveMax) return setMsg(`Aynı anda en fazla ${liveMax} yayın kaydedilebilir. Önce birini bitir.`);
  btn.disabled = true;
  setMsg("Yayınlar kontrol ediliyor...", true);
  try {
    const typed = $("slugInput").value.trim();
    const r = await api.liveCheck(typed || null);
    if (r.allRecording) return setMsg("Takip listendeki kanalların hepsi zaten kaydediliyor.");
    if (!r.live.length) {
      const parts = [];
      if (r.already && r.already.length) parts.push(`${r.already.join(", ")} zaten kaydediliyor.`);
      if (r.offline.length) parts.push(`${r.offline.join(", ")} şu an yayında değil.`);
      if (r.notFound.length) parts.push(`Bulunamayan kanal: ${r.notFound.join(", ")}`);
      if (r.errors.length) parts.push(`Kick'e ulaşılamadı (${r.errors.join("; ")})`);
      setMsg(parts.join(" ") || "Açık yayın bulunamadı.");
      return;
    }
    let targets = [r.live[0]];
    if (r.live.length > 1) {
      const free = r.free;
      const buttons = r.live.map((l) => ({ label: `${l.username} — ${l.livestream.title || ""}`.slice(0, 70), value: l.slug, kind: "primary" }));
      if (free >= 2) buttons.push({ label: `Hepsine bağlan (${Math.min(free, r.live.length)})`, value: "*" });
      buttons.push({ label: "Vazgeç", value: null, kind: "ghost" });
      const pick = await modal("Birden fazla yayın açık", `Hangisine bağlanmak istersin?${r.live.length > free ? `<br><span class="muted">Boş yer: ${free} (aynı anda en fazla ${liveMax} yayın)</span>` : ""}`, buttons, true);
      if (!pick) return setMsg("");
      targets = pick === "*" ? r.live.slice(0, free) : [r.live.find((l) => l.slug === pick)];
    }
    let ok = 0;
    for (const t of targets) if (await connectOne(t)) ok++;
    if (ok) {
      setMsg("");
      $("slugInput").value = "";
    }
  } catch (e) {
    setMsg("Hata: " + e.message);
  } finally {
    btn.disabled = false;
  }
}
$("connectBtn").onclick = connectFlow;
$("slugInput").onkeydown = (e) => { if (e.key === "Enter") connectFlow(); };

function renderLiveTabs() {
  const tabs = liveList
    .map((l) => `<button class="ltab ${selectedLive === l.slug ? "on" : ""}" data-s="${esc(l.slug)}"><span class="lav" data-n="${esc(l.streamer)}" data-a="${esc(l.avatar || "")}"></span><span class="ln">${esc(l.streamer)}</span><span class="lc">${num(l.messageCount)}</span>${l.status === "silent" || l.status === "keyError" ? '<span class="lw">!</span>' : '<i class="ldot"></i>'}</button>`)
    .join("");
  const full = liveList.length >= liveMax;
  $("liveTabs").innerHTML = tabs + `<button class="ltab add ${selectedLive === "new" ? "on" : ""}" data-s="new" ${full ? 'title="En fazla 3 yayın"' : ""}>+ Yayın ekle <span class="muted">${liveList.length}/${liveMax}</span></button>`;
  $("liveTabs").classList.toggle("hidden", !liveList.length);
  $("liveTabs").querySelectorAll(".lav").forEach((el) => avatarHtml(el, el.dataset.n, el.dataset.a));
  $("liveTabs").querySelectorAll(".ltab").forEach((b) => (b.onclick = () => ((selectedLive = b.dataset.s), applyLive({ max: liveMax, list: liveList }, true))));
}

const STATUS_TEXT = { connecting: "· bağlanıyor...", connected: "· bağlandı", listening: "· dinleniyor", reconnecting: "· bağlantı koptu, yeniden bağlanıyor...", keyError: "· Kick sohbet anahtarı reddedildi, yenisi alınıyor...", silent: "· ⚠ 90 sn'dir sohbetten mesaj gelmiyor (sohbet çok sakin olabilir ya da Kick bağlantıyı değiştirmiş olabilir)" };
let lastAvatar = null;
function applyLive(st, forceTabs) {
  liveList = (st && st.list) || [];
  liveMax = (st && st.max) || 3;
  if (selectedLive !== "new" && !liveList.find((l) => l.slug === selectedLive)) selectedLive = liveList.length ? liveList[0].slug : "new";
  renderLiveTabs();
  const s = liveList.find((l) => l.slug === selectedLive);
  $("connectCard").classList.toggle("hidden", !!s);
  $("livePanel").classList.toggle("hidden", !s);
  $("recPill").classList.toggle("hidden", !liveList.length);
  $("recPillText").textContent = liveList.length > 1 ? `${liveList.length} KAYITTA` : "KAYITTA";
  const full = liveList.length >= liveMax;
  $("connectBtn").disabled = full;
  if (full && !s) setMsg(`Aynı anda en fazla ${liveMax} yayın kaydedilebilir. Yeni yayın için birini bitir.`, true);
  if (!s) return;
  $("liveName").textContent = s.streamer;
  $("liveTitle").textContent = s.title || "(başlıksız)";
  $("liveMeta").textContent = [s.category, s.viewers ? num(s.viewers) + " izleyici" : ""].filter(Boolean).join(" · ");
  if (lastAvatar !== s.avatar + s.streamer) {
    avatarHtml($("liveAvatar"), s.streamer, s.avatar);
    lastAvatar = s.avatar + s.streamer;
  }
  $("mergedNote").classList.toggle("hidden", !s.merged);
  $("tMsgs").textContent = num(s.messageCount);
  $("tRate").textContent = num(s.rate);
  $("tUptime").textContent = hms(since(s.startTime));
  $("tRec").textContent = hms(since(s.recordStart));
  $("connStatus").textContent = STATUS_TEXT[s.status] || "";
  $("chatFeed").innerHTML = (s.recent || []).map((r) => `<div><b>${esc(r.u)}</b>${esc(r.m)}</div>`).join("");
}
api.onLiveUpdate((st) => applyLive(st));

$("stopBtn").onclick = async () => {
  const s = liveList.find((l) => l.slug === selectedLive);
  if (!s) return;
  const ok = await modal(`${s.streamer} — yayın bitti mi?`, "Bu yayının kaydı burada bitecek ve <b>Yayınlar</b> bölümüne eklenecek. Diğer kayıtlar devam eder.", [
    { label: "Vazgeç", value: false, kind: "ghost" },
    { label: "Evet, kaydı bitir", value: true, kind: "primary" },
  ]);
  if (ok) await api.liveStop(s.slug);
};

api.onLiveEnded(async ({ reason, session }) => {
  applyLive(await api.liveState());
  if (session) {
    if (selectedLive === "new") setMsg(`${session.streamer} kaydı bitti (${reason}) — ${num(session.messageCount)} mesaj. Yayınlar bölümünde.`, true);
    toast(`Kayıt bitti: ${session.streamer} — ${session.title}`);
  }
});

// ---------- GÜNCELLEME ----------
let updateInfo = null;
function showUpdate(info) {
  updateInfo = info;
  $("updateText").innerHTML = `Yeni sürüm hazır: <b>v${esc(info.version)}</b>`;
  $("updateBar").classList.remove("hidden");
}
api.onUpdateAvailable(showUpdate);
$("updateLater").onclick = () => $("updateBar").classList.add("hidden");
$("updateNotes").onclick = () =>
  modal(`v${updateInfo.version} — Yenilikler`, `<div style="white-space:pre-wrap;max-height:50vh;overflow:auto">${esc(updateInfo.notes || "Açıklama yok.")}</div>`, [{ label: "Tamam", value: 1, kind: "primary" }]);
api.onUpdateProgress((f) => ($("updateText").innerHTML = `Güncelleme indiriliyor... %${Math.round(f * 100)}`));
async function doUpdate() {
  if (liveList.length) {
    const ok = await modal("Kayıt devam ediyor", `Şu an ${liveList.length} yayın kaydediliyor. Güncelleme için uygulama kapanıp açılacak ve <b>kayıtlar burada bitecek</b>.<br><br>Yayınlar bittikten sonra güncellemen daha iyi olur.`, [
      { label: "Sonra güncelle", value: false, kind: "primary" },
      { label: "Kayıtları bitir ve güncelle", value: true, kind: "ghost" },
    ]);
    if (!ok) return;
  }
  $("updateBar").classList.remove("hidden");
  $("updateNow").disabled = true;
  $("updateText").textContent = "Güncelleme indiriliyor...";
  const r = await api.updateInstall();
  if (r.error) {
    $("updateNow").disabled = false;
    $("updateText").textContent = "Güncelleme indirilemedi: " + r.error;
  } else $("updateText").textContent = "Kuruluyor, uygulama birazdan yeniden açılacak...";
}
$("updateNow").onclick = doUpdate;
$("checkUpdateBtn").onclick = async () => {
  $("updateMsg").textContent = "Kontrol ediliyor...";
  const r = await api.updateCheck();
  if (r.error) $("updateMsg").textContent = "Kontrol edilemedi: " + r.error;
  else if (r.available) {
    $("updateMsg").textContent = `Yeni sürüm var: v${r.version}`;
    showUpdate(r);
  } else $("updateMsg").textContent = "Güncelsin ✓";
};

// ---------- YAYINLAR ----------
async function renderSessions() {
  const list = await api.sessionsList();
  const groups = new Map();
  for (const s of list) {
    if (!groups.has(s.slug)) groups.set(s.slug, { name: s.streamer, avatar: s.avatar, items: [] });
    const g = groups.get(s.slug);
    g.items.push(s);
    if (s.avatar) g.avatar = s.avatar;
  }
  const sl = $("streamerList");
  if (!groups.size) {
    sl.innerHTML = "";
    $("streamsTitle").textContent = "";
    $("streamList").innerHTML = `<div class="empty">Henüz kayıt yok.<br>Canlı sekmesinden bir yayına bağlanınca burada görünecek.</div>`;
    return;
  }
  if (!currentStreamer || !groups.has(currentStreamer)) currentStreamer = [...groups.keys()][0];
  sl.innerHTML = [...groups.entries()]
    .map(([slug, g]) => `<div class="streamer ${slug === currentStreamer ? "active" : ""}" data-s="${esc(slug)}"><div class="avatar" data-n="${esc(g.name)}" data-a="${esc(g.avatar || "")}"></div><div><div class="n">${esc(g.name)}</div><small>${g.items.length} yayın</small></div></div>`)
    .join("");
  sl.querySelectorAll(".avatar").forEach((a) => avatarHtml(a, a.dataset.n, a.dataset.a));
  sl.querySelectorAll(".streamer").forEach((el) => {
    const open = () => {
      currentStreamer = el.dataset.s;
      renderSessions();
    };
    el.onclick = open;
    el.ondblclick = open;
  });
  const g = groups.get(currentStreamer);
  $("streamsTitle").textContent = `${g.name} · kayıtlı yayınlar`;
  const items = g.items.sort((a, b) => b.recordStart.localeCompare(a.recordStart));
  $("streamList").innerHTML =
    items
      .map((s) => {
        const live = s.recording;
        return `<div class="stream ${selectedStream === s.id ? "sel" : ""}" data-id="${s.id}">
        <div class="grow"><div class="t">${esc(s.title)}</div>
        <div class="d">${fmtDate(s.startTime || s.recordStart)} · ${dur(s.recordStart, s.recordEnd)} kayıt · ${num(s.messageCount)} mesaj</div></div>
        ${live ? '<span class="badge rec">KAYITTA</span>' : ""}
        ${s.partCount > 1 ? `<span class="badge mer">${s.partCount} kısım</span>` : ""}
        ${s.analyzed ? '<span class="badge ok">Analiz edildi</span>' : '<span class="badge">Analiz yok</span>'}
      </div>`;
      })
      .join("") + `<div class="hint">Yayını açmak için çift tıkla.</div>`;
  $("streamList").querySelectorAll(".stream").forEach((el) => {
    el.onclick = () => {
      selectedStream = el.dataset.id;
      $("streamList").querySelectorAll(".stream").forEach((x) => x.classList.toggle("sel", x === el));
    };
    el.ondblclick = () => openDetail(el.dataset.id);
  });
}
api.onSessionsChanged(() => {
  if ($("view-sessions").classList.contains("active") && $("detail").classList.contains("hidden")) renderSessions();
});

// ---------- DETAY ----------
const TYPE = { gulme: "😂 Gülme", hype: "😮 Şok / Hype", patlama: "🔥 Sohbet patlaması", isim: "🏷 İsim" };
let momentFilter = "all";

async function openDetail(id) {
  detailId = id;
  detailData = await api.sessionGet(id);
  if (!detailData) return;
  $("sessionsLayout").classList.add("hidden");
  $("detail").classList.remove("hidden");
  $("clipProgress").classList.add("hidden");
  renderDetail();
}
function closeDetail() {
  detailId = null;
  $("detail").classList.add("hidden");
  $("sessionsLayout").classList.remove("hidden");
  renderSessions();
}
$("backBtn").onclick = closeDetail;

function renderDetail() {
  const d = detailData;
  $("dTitle").textContent = d.title;
  $("dMeta").textContent = `${d.streamer} · ${fmtDate(d.startTime || d.recordStart)} · ${dur(d.recordStart, d.recordEnd)} kayıt · ${num(d.messageCount)} mesaj${d.partCount > 1 ? ` · ${d.partCount} kısım birleştirildi` : ""}`;
  $("analyzeBtn").textContent = d.analysis ? "Yeniden Analiz Et" : "Analiz Et";
  const a = d.analysis;
  const body = $("detailBody");
  if (!a) {
    $("clipBtn").disabled = true;
    body.innerHTML = `<div class="empty">Bu yayın henüz analiz edilmedi.<br>Yukarıdaki <b>Analiz Et</b> butonuna basınca sohbetin patladığı anlar bulunur.${d.recording ? "<br><br>Not: Bu yayın hâlâ kaydediliyor, şimdi analiz edersen o ana kadarki kısım analiz edilir." : ""}</div>`;
    return;
  }
  const sel = new Set(a.selected || []);
  $("clipBtn").disabled = !sel.size;
  $("clipBtn").textContent = sel.size ? `Seçilenleri Klip Al (${sel.size})` : "Seçilenleri Klip Al";
  let ms = [...a.moments];
  if (sortBy === "time") ms.sort((x, y) => x.peak - y.peak);
  const kwList = [...new Set(a.moments.flatMap((m) => m.tags || []))];
  if (momentFilter !== "all" && !TYPE[momentFilter] && !kwList.includes(momentFilter)) momentFilter = "all";
  if (momentFilter in TYPE) ms = ms.filter((m) => m.type === momentFilter);
  else if (momentFilter !== "all") ms = ms.filter((m) => (m.tags || []).includes(momentFilter));
  const cnt = (f) => a.moments.filter(f).length;
  const chips = [["all", "Tümü", a.moments.length], ...Object.keys(TYPE).map((t) => [t, TYPE[t], cnt((m) => m.type === t)]).filter((x) => x[2]), ...kwList.map((k) => [k, "🏷 " + k, cnt((m) => (m.tags || []).includes(k))])];
  const vs = (m) => (m.adjStart != null ? m.adjStart : m.vodStart ?? m.start);
  const ve = (m) => (m.adjStart != null ? m.adjEnd : m.vodEnd ?? m.end);
  body.innerHTML = `
    <div class="chart"><canvas id="chart"></canvas></div>
    <div class="toolbar">
      <span class="seg"><button data-s="score" class="${sortBy === "score" ? "on" : ""}">Puana göre</button><button data-s="time" class="${sortBy === "time" ? "on" : ""}">Zamana göre</button></span>
      <button class="btn ghost" id="selAll">Tümünü seç</button><button class="btn ghost" id="selNone">Temizle</button>
      <span class="sp"></span><span class="muted">${a.moments.length} an · ${num(a.users)} farklı kişi · zamana tıkla = kopyala</span>
    </div>
    <div class="filters">${chips.map(([k, l, c]) => `<span class="chip ${momentFilter === k ? "on" : ""}" data-f="${esc(k)}">${esc(l)} <b>${c}</b></span>`).join("")}</div>
    ${a.moments.length ? "" : '<div class="empty">Belirgin bir sohbet patlaması bulunamadı.</div>'}
    ${ms
      .map(
        (m) => `<div class="moment ${sel.has(m.rank) ? "on" : ""}" data-r="${m.rank}">
      <input type="checkbox" ${sel.has(m.rank) ? "checked" : ""}>
      <div class="rk">#${m.rank}</div>
      <div><div class="tm" data-c="${hms(m.vodPeak ?? m.peak)}">${hms(m.vodPeak ?? m.peak)}</div><div class="rg">${hms(vs(m))} → ${hms(ve(m))}${m.adjStart != null ? '<span class="adj-mark" title="Elle ayarlandı">✎</span>' : ""}${m.part ? ` · ${m.part + 1}. kısım` : ""}</div></div>
      <div><span class="ty">${TYPE[m.type] || m.type}${m.keyword ? ": " + esc(m.keyword) : ""}</span>${(m.tags || []).filter((t) => t !== m.keyword).map((t) => `<span class="tag">🏷 ${esc(t)}</span>`).join("")}<span class="sc">puan ${m.score} · ${m.count} mesaj</span>
        <div class="samples">${m.samples.map((x) => `<span>${esc(x)}</span>`).join("")}</div></div>
      <div class="pvb" style="display:flex;flex-direction:column;gap:6px"><button class="btn small" data-pv="${m.rank}">▶ Önizle</button><button class="btn small primary" data-ed="${m.rank}">✂ Düzenle${(d.editedRanks || []).includes(m.rank) ? " ✎" : ""}</button></div>
    </div>`
      )
      .join("")}
    <details style="margin-top:14px"><summary class="muted" style="cursor:pointer">VOD otomatik bulunamazsa: yayın kaydının linkini yapıştır</summary>
      <div class="vod-row"><input id="vodUrl" placeholder="https://kick.com/${esc(d.slug)}/videos/..." spellcheck="false"></div>
    </details>`;
  body.querySelectorAll(".seg button").forEach((b) => (b.onclick = () => ((sortBy = b.dataset.s), renderDetail())));
  body.querySelectorAll(".filters .chip").forEach((c) => (c.onclick = () => ((momentFilter = c.dataset.f), renderDetail())));
  const saveSel = () => {
    a.selected = [...sel];
    api.sessionSelect({ id: d.id, selected: a.selected });
    $("clipBtn").disabled = !sel.size;
    $("clipBtn").textContent = sel.size ? `Seçilenleri Klip Al (${sel.size})` : "Seçilenleri Klip Al";
  };
  $("selAll").onclick = () => (a.moments.forEach((m) => sel.add(m.rank)), saveSel(), renderDetail());
  $("selNone").onclick = () => (sel.clear(), saveSel(), renderDetail());
  body.querySelectorAll(".moment").forEach((el) => {
    el.onclick = (e) => {
      if (e.target.classList.contains("tm")) return copy(e.target.dataset.c);
      if (e.target.dataset.pv) return openPreview(Number(e.target.dataset.pv));
      if (e.target.dataset.ed) return openStudio(detailId, Number(e.target.dataset.ed));
      const r = Number(el.dataset.r);
      sel.has(r) ? sel.delete(r) : sel.add(r);
      el.classList.toggle("on", sel.has(r));
      el.querySelector("input").checked = sel.has(r);
      saveSel();
    };
  });
  drawChart(a);
}

function drawChart(a) {
  const c = $("chart");
  if (!c) return;
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr;
  c.height = h * dpr;
  const g = c.getContext("2d");
  g.scale(dpr, dpr);
  const d = a.perMinute.length ? a.perMinute : [0];
  const maks = Math.max(1, ...d), bottom = h - 20;
  const x = (i) => (i / Math.max(1, d.length - 1)) * w, y = (v) => bottom - (v / maks) * (bottom - 8);
  g.font = "11px Segoe UI";
  for (let s = 0; s * 60 <= d.length; s++) {
    const xx = x(s * 60);
    g.strokeStyle = "#232323";
    g.beginPath(); g.moveTo(xx, 0); g.lineTo(xx, bottom); g.stroke();
    g.fillStyle = "#777";
    g.fillText(s + " sa", Math.min(xx + 3, w - 30), h - 5);
  }
  const grad = g.createLinearGradient(0, 0, 0, bottom);
  grad.addColorStop(0, "rgba(163,20,27,.55)");
  grad.addColorStop(1, "rgba(163,20,27,0)");
  g.beginPath(); g.moveTo(0, bottom); d.forEach((v, i) => g.lineTo(x(i), y(v))); g.lineTo(w, bottom); g.closePath();
  g.fillStyle = grad; g.fill();
  g.beginPath(); d.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))));
  g.strokeStyle = "#b3161e"; g.lineWidth = 1.5; g.stroke();
  const sel = new Set(a.selected || []);
  for (const m of a.moments) {
    const i = m.peak / 60, v = Math.max(d[Math.floor(i)] || 0, d[Math.ceil(i)] || 0, d[Math.ceil(i) + 1] || 0);
    g.beginPath(); g.arc(x(i), y(v), sel.has(m.rank) ? 5 : 3.5, 0, 7);
    g.fillStyle = sel.has(m.rank) ? "#ff5a5a" : "#ddd"; g.fill();
  }
  c.onclick = (e) => {
    const sn = (e.offsetX / w) * Math.max(1, d.length - 1) * 60;
    if (!a.moments.length) return;
    const m = a.moments.reduce((b, q) => (Math.abs(q.peak - sn) < Math.abs(b.peak - sn) ? q : b));
    const el = document.querySelector(`.moment[data-r="${m.rank}"]`);
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.style.outline = "1px solid #ff5a5a"; setTimeout(() => (el.style.outline = ""), 1500); }
  };
}
window.addEventListener("resize", () => detailData && detailData.analysis && drawChart(detailData.analysis));

$("analyzeBtn").onclick = async () => {
  $("analyzeBtn").disabled = true;
  $("analyzeBtn").textContent = "Analiz ediliyor...";
  const r = await api.sessionAnalyze(detailId);
  $("analyzeBtn").disabled = false;
  if (r.error) {
    $("analyzeBtn").textContent = detailData.analysis ? "Yeniden Analiz Et" : "Analiz Et";
    return modal("Analiz yapılamadı", esc(r.error), [{ label: "Tamam", value: 1, kind: "primary" }]);
  }
  detailData = await api.sessionGet(detailId);
  renderDetail();
  toast(`${r.analysis.moments.length} an bulundu, en iyi ${r.analysis.selected.length} tanesi seçildi.`);
};

$("clipBtn").onclick = async () => {
  const a = detailData.analysis;
  if (!a || !a.selected.length) return;
  const vodUrl = ($("vodUrl") && $("vodUrl").value.trim()) || null;
  $("clipBtn").disabled = true;
  $("analyzeBtn").disabled = true;
  $("clipProgress").classList.remove("hidden");
  $("clipBar").style.width = "0%";
  $("clipText").textContent = "Başlıyor...";
  const r = await api.sessionClip({ id: detailId, ranks: a.selected, vodUrl });
  $("clipBtn").disabled = false;
  $("analyzeBtn").disabled = false;
  $("clipProgress").classList.add("hidden");
  if (r.error) {
    if (r.needVodUrl) {
      const det = document.querySelector("#detailBody details");
      if (det) det.open = true;
    }
    return modal("Klip alınamadı", esc(r.error), [{ label: "Tamam", value: 1, kind: "primary" }]);
  }
  const failTxt = r.failed.length ? `<br><br>${r.failed.length} klip alınamadı:<br><span class="muted">${r.failed.map((f) => "#" + f.rank + ": " + esc(f.error)).join("<br>")}</span>` : "";
  const go = await modal("Klipler hazır", `${r.made} klip kaydedildi:<br><span class="muted">${esc(r.dir)}</span>${failTxt}`, [
    { label: "Kapat", value: false, kind: "ghost" },
    { label: "Klasörü aç", value: true, kind: "primary" },
  ]);
  if (go) api.openPath(r.dir);
};

api.onClipProgress((p) => {
  if (p.phase === "vod") $("clipText").textContent = p.text;
  if (p.phase === "cut") {
    const total = ((p.index + (p.frac || 0)) / p.total) * 100;
    $("clipBar").style.width = total.toFixed(1) + "%";
    $("clipText").textContent = `Klip ${Math.min(p.index + 1, p.total)} / ${p.total} (#${p.rank})`;
  }
});

$("openClipsBtn").onclick = () => api.openPath(settings.clipFolder);
$("deleteBtn").onclick = async () => {
  const ok = await modal("Kayıt silinsin mi?", `<b>${esc(detailData.title)}</b> kaydı ve analizi silinecek. Aldığın klipler silinmez.`, [
    { label: "Vazgeç", value: false, kind: "ghost" },
    { label: "Sil", value: true, kind: "danger" },
  ]);
  if (!ok) return;
  const r = await api.sessionDelete(detailId);
  if (r.error) return toast(r.error);
  closeDetail();
  toast("Kayıt silindi");
};

// ---------- ÖNİZLEME ----------
const pv = { hls: null, m: null, start: 0, end: 0, w0: 0, w1: 1, stopAt: null };
function pvRender() {
  const span = pv.w1 - pv.w0;
  const pct = (t) => ((t - pv.w0) / span) * 100;
  $("pvSel").style.left = pct(pv.start) + "%";
  $("pvSel").style.width = Math.max(0.5, pct(pv.end) - pct(pv.start)) + "%";
  $("pvStart").textContent = hms(pv.start);
  $("pvEnd").textContent = hms(pv.end);
  $("pvT0").textContent = hms(pv.w0);
  $("pvT1").textContent = hms(pv.w1);
  $("pvLen").textContent = `Klip uzunluğu: ${Math.round(pv.end - pv.start)} sn`;
}
function pvSetWindow() {
  pv.w0 = Math.max(0, Math.min(pv.start, pv.m.vodPeak ?? pv.m.peak) - 45);
  pv.w1 = Math.max(pv.end, pv.m.vodPeak ?? pv.m.peak) + 45;
}
async function openPreview(rank) {
  const a = detailData.analysis;
  const m = a.moments.find((x) => x.rank === rank);
  if (!m) return;
  pv.m = m;
  pv.start = m.adjStart != null ? m.adjStart : m.vodStart ?? m.start;
  pv.end = m.adjStart != null ? m.adjEnd : m.vodEnd ?? m.end;
  pvSetWindow();
  $("pvTitle").textContent = `#${m.rank} · ${TYPE[m.type] || ""}${m.keyword ? ": " + m.keyword : ""} · ${hms(m.vodPeak ?? m.peak)}`;
  $("preview").classList.remove("hidden");
  $("pvMsg").textContent = "Yayın kaydı (VOD) yükleniyor...";
  pvRender();
  const vodUrl = ($("vodUrl") && $("vodUrl").value.trim()) || null;
  const r = await api.sessionVod({ id: detailId, part: m.part || 0, vodUrl });
  if (r.error) {
    $("pvMsg").textContent = r.error;
    if (r.needVodUrl) { const det = document.querySelector("#detailBody details"); if (det) det.open = true; }
    return;
  }
  const v = $("pvVideo");
  if (pv.hls) { pv.hls.destroy(); pv.hls = null; }
  const seekStart = () => { v.currentTime = pv.start; $("pvMsg").textContent = ""; };
  if (window.Hls && Hls.isSupported() && /\.m3u8/i.test(r.source)) {
    pv.hls = new Hls({ startPosition: pv.start, maxBufferLength: 30 });
    pv.hls.loadSource(r.source);
    pv.hls.attachMedia(v);
    pv.hls.on(Hls.Events.MANIFEST_PARSED, seekStart);
    pv.hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) $("pvMsg").textContent = "Video yüklenemedi: " + (d.details || d.type); });
  } else {
    v.src = r.source;
    v.onloadedmetadata = seekStart;
  }
}
function closePreview() {
  const v = $("pvVideo");
  v.pause();
  if (pv.hls) { pv.hls.destroy(); pv.hls = null; }
  v.removeAttribute("src");
  v.load();
  $("preview").classList.add("hidden");
}
$("pvClose").onclick = closePreview;
$("pvVideo").ontimeupdate = () => {
  const v = $("pvVideo");
  const t = v.currentTime;
  if (t < pv.w0 || t > pv.w1) { pv.w0 = Math.max(0, Math.min(pv.w0, t - 10)); pv.w1 = Math.max(pv.w1, t + 10); pvRender(); }
  $("pvPlayhead").style.left = ((t - pv.w0) / (pv.w1 - pv.w0)) * 100 + "%";
  if (pv.stopAt != null && t >= pv.stopAt) { v.pause(); pv.stopAt = null; }
};
document.querySelectorAll("[data-adj]").forEach((b) => (b.onclick = () => {
  const [w, d] = b.dataset.adj.split(":");
  if (w === "s") pv.start = Math.max(0, Math.min(pv.end - 1, pv.start + Number(d)));
  else pv.end = Math.max(pv.start + 1, pv.end + Number(d));
  pvRender();
  $("pvVideo").currentTime = w === "s" ? pv.start : Math.max(pv.start, pv.end - 3);
}));
$("pvSetStart").onclick = () => { pv.start = Math.min($("pvVideo").currentTime, pv.end - 1); pvRender(); };
$("pvSetEnd").onclick = () => { pv.end = Math.max($("pvVideo").currentTime, pv.start + 1); pvRender(); };
$("pvPlaySel").onclick = () => { const v = $("pvVideo"); v.currentTime = pv.start; pv.stopAt = pv.end; v.play().catch(() => {}); };
$("pvReset").onclick = async () => {
  await api.sessionAdjust({ id: detailId, rank: pv.m.rank, start: null });
  delete pv.m.adjStart; delete pv.m.adjEnd;
  pv.start = pv.m.vodStart ?? pv.m.start; pv.end = pv.m.vodEnd ?? pv.m.end;
  pvRender(); renderDetail(); toast("Otomatik zamanlara dönüldü");
};
$("pvSave").onclick = async () => {
  const r = await api.sessionAdjust({ id: detailId, rank: pv.m.rank, start: pv.start, end: pv.end });
  if (r.error) return toast(r.error);
  pv.m.adjStart = r.moment.adjStart; pv.m.adjEnd = r.moment.adjEnd;
  renderDetail();
  closePreview();
  toast(`#${pv.m.rank} kaydedildi: ${hms(pv.start)} → ${hms(pv.end)}`);
};
// Zaman çubuğu: tıkla = git, kenarları sürükle = başlangıç/bitiş
(() => {
  const track = $("pvTrack");
  const toT = (x) => { const r = track.getBoundingClientRect(); return pv.w0 + Math.min(1, Math.max(0, (x - r.left) / r.width)) * (pv.w1 - pv.w0); };
  let drag = null;
  $("pvHL").onmousedown = (e) => { drag = "s"; e.stopPropagation(); e.preventDefault(); };
  $("pvHR").onmousedown = (e) => { drag = "e"; e.stopPropagation(); e.preventDefault(); };
  track.onmousedown = (e) => { if (!drag) $("pvVideo").currentTime = toT(e.clientX); };
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const t = toT(e.clientX);
    if (drag === "s") pv.start = Math.max(0, Math.min(t, pv.end - 1));
    else pv.end = Math.max(t, pv.start + 1);
    pvRender();
  });
  window.addEventListener("mouseup", () => {
    if (drag) $("pvVideo").currentTime = drag === "s" ? pv.start : Math.max(pv.start, pv.end - 3);
    drag = null;
  });
})();

// ---------- AYARLAR ----------
function fillSettings() {
  $("sChannels").value = settings.channels.join(", ");
  $("sFolder").value = settings.clipFolder;
  $("sBefore").value = settings.clipBefore;
  $("sAfter").value = settings.clipAfter;
  $("sCount").value = settings.momentCount;
  $("sAutoSel").value = settings.autoSelect;
  $("sKeywords").value = (settings.keywords || []).join(", ");
  $("sFormat").value = settings.clipFormat || "yatay";
  $("sVStyle").value = settings.verticalStyle || "bulanik";
  $("sTray").checked = !!settings.closeToTray;
  $("sStartup").checked = !!settings.startWithWindows;
  $("sAuto").checked = !!settings.autoConnect;
  $("sWQ").value = settings.whisperQuality || "kaliteli";
  $("sDefLayout").value = settings.defaultLayout || "bulanik";
  $("sBaseTags").value = (settings.baseTags || []).join(" ");
  $("sDelay").value = settings.chatDelay;
  $("sOffset").value = settings.offset;
  $("sPrecise").checked = !!settings.precise;
}
$("pickFolderBtn").onclick = async () => {
  const p = await api.pickFolder();
  if (p) $("sFolder").value = p;
};
$("saveBtn").onclick = async () => {
  const n = (id, def) => (isNaN(parseInt($(id).value)) ? def : parseInt($(id).value));
  settings = await api.settingsSave({
    channels: $("sChannels").value.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean),
    clipFolder: $("sFolder").value,
    clipBefore: n("sBefore", 45),
    clipAfter: n("sAfter", 15),
    momentCount: n("sCount", 25),
    autoSelect: n("sAutoSel", 10),
    keywords: $("sKeywords").value.split(",").map((s) => s.trim()).filter(Boolean),
    clipFormat: $("sFormat").value,
    verticalStyle: $("sVStyle").value,
    closeToTray: $("sTray").checked,
    startWithWindows: $("sStartup").checked,
    autoConnect: $("sAuto").checked,
    whisperQuality: $("sWQ").value,
    defaultLayout: $("sDefLayout").value,
    baseTags: $("sBaseTags").value.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean).map((t) => (t.startsWith("#") ? t : "#" + t)),
    chatDelay: n("sDelay", 8),
    offset: n("sOffset", 0),
    precise: $("sPrecise").checked,
  });
  renderChips();
  $("saveMsg").textContent = "Kaydedildi ✓";
  setTimeout(() => ($("saveMsg").textContent = ""), 2000);
};

api.onSettingsChanged((st) => {
  settings = st;
  fillSettings();
});
api.onAutoConnected(({ streamer }) => toast(`${streamer} yayına girdi, kayıt otomatik başladı`));

// ---------- başlat ----------
(async () => {
  settings = await api.settingsGet();
  fillSettings();
  renderChips();
  applyLive(await api.liveState());
  $("appVersion").textContent = "v" + (await api.appVersion());
})();
