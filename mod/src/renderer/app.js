const $ = (id) => document.getElementById(id);
let settings = null;
let connected = null; // {channel}
const suspects = new Map(); // key -> özet
let susFilter = "all";
let susSort = "new";
let selectedKey = null;
let drawerKey = null;
let drawerData = null;
let paused = false;
let pausedNew = 0;
let msgCount = 0;
let flagCount = 0;
const MAX_FEED = 500;
const CAT_LABEL = { kufur: "Küfür", gizli: "Gizli küfür", supheli: "Şüpheli kelime", akrostis: "Akrostiş", mustehcen: "+18", hakaret: "Hakaret", tehdit: "Tehdit", kavga: "Kavga", spam: "Spam", kirlilik: "Sohbet kirliliği", flood: "Flood", caps: "Caps", link: "Link", ozel: "Özel kelime", spoiler: "Spoiler" };
const CAT_SEV = { spoiler: 3, kufur: 3, gizli: 3, akrostis: 3, tehdit: 3, kavga: 3, ozel: 3, mustehcen: 2, supheli: 2, hakaret: 2, link: 2, flood: 2, spam: 1, kirlilik: 1, caps: 1 };

// ---------- yardımcılar ----------
function esc(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtMsg(t) {
  return esc(t).replace(/\[emote:\d+:([^\]]*)\]/g, (_, n) => `<span class="em">:${n}:</span>`);
}
function hhmmss(t) {
  return new Date(t).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function ago(t) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s} sn` : s < 3600 ? `${Math.floor(s / 60)} dk` : `${Math.floor(s / 3600)} sa`;
}
function nameColor(n, c) {
  if (c) return c;
  let h = 0;
  for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h},65%,65%)`;
}
function avatar(el, name, url) {
  el.style.backgroundImage = url ? `url("${url}")` : "";
  el.textContent = url ? "" : (name || "?")[0].toUpperCase();
}
let toastT;
function toast(text) {
  $("toastText").textContent = text;
  $("toast").classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => $("toast").classList.remove("show"), 2800);
}
function modal(title, html, buttons) {
  return new Promise((res) => {
    $("mTitle").textContent = title;
    $("mBody").innerHTML = html;
    $("mBtns").innerHTML = "";
    for (const b of buttons) {
      const el = document.createElement("button");
      el.className = "btn " + (b.kind || "");
      el.textContent = b.label;
      el.onclick = () => {
        const inp = $("mBody").querySelector("input");
        $("modal").classList.add("hidden");
        res(b.value === "input" ? (inp ? inp.value : "") : b.value);
      };
      $("mBtns").appendChild(el);
    }
    $("modal").classList.remove("hidden");
    const inp = $("mBody").querySelector("input");
    if (inp) setTimeout(() => inp.focus(), 50);
  });
}
let actx = null;
function beep() {
  if (!settings || !settings.sound) return;
  try {
    actx = actx || new AudioContext();
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.08, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.25);
    o.connect(g).connect(actx.destination);
    o.start();
    o.stop(actx.currentTime + 0.26);
  } catch (_) {}
}

// ---------- sekmeler ----------
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => showView(t.dataset.view)));
function showView(v) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === v));
  document.querySelectorAll(".view").forEach((s) => s.classList.toggle("active", s.id === "view-" + v));
  if (v === "settings") fillSettings();
  if (v === "saved") loadSavedList();
}

// ---------- panel durumu ----------
function renderPanelState() {
  $("connectCard").classList.toggle("hidden", !!connected);
  $("board").classList.toggle("hidden", !connected);
  $("chanBox").classList.toggle("hidden", !connected);
  if (!connected && settings) {
    $("lastChips").innerHTML = settings.lastChannel ? `<span class="chip" data-c="${esc(settings.lastChannel)}">${esc(settings.lastChannel)}</span>` : "";
    $("lastChips").querySelectorAll(".chip").forEach((c) => (c.onclick = () => (($("slugInput").value = c.dataset.c), doConnect())));
  }
}

// ---------- bağlan ----------
async function doConnect() {
  const slug = $("slugInput").value.trim() || (settings && settings.lastChannel) || "";
  if (!slug) return;
  $("connectBtn").disabled = true;
  $("connectMsg").className = "status-msg info";
  $("connectMsg").textContent = "Bağlanılıyor...";
  const r = await api.connect(slug);
  $("connectBtn").disabled = false;
  if (r.error) {
    $("connectMsg").className = "status-msg";
    $("connectMsg").textContent = r.error;
    return;
  }
  $("connectMsg").textContent = "";
  connected = r;
  suspects.clear();
  $("feed").innerHTML = "";
  msgCount = flagCount = 0;
  $("feedStats").textContent = "0 mesaj · 0 işaretli";
  $("pausedPill").classList.add("hidden");
  avatar($("chanAvatar"), r.channel.name, r.channel.avatar);
  $("chanName").textContent = r.channel.name;
  showLive(r.channel);
  renderSuspects();
  renderPanelState();
}
function showLive(c) {
  $("chanLive").classList.toggle("hidden", !c.live);
  $("chanOff").classList.toggle("hidden", !!c.live);
  $("chanSub").textContent = c.live
    ? [c.viewers != null ? `${Number(c.viewers).toLocaleString("tr-TR")} izleyici` : "", c.title || ""].filter(Boolean).join(" · ")
    : "Yayın kapalı · chat dinleniyor";
  $("chanSub").title = c.live && c.title ? c.title : "";
}
api.onLive((c) => {
  if (!connected) return;
  showLive(c);
  if (c.changed) feed.insertAdjacentHTML("beforeend", `<div class="sysline"><span>${c.live ? "🔴 Yayın başladı" : "Yayın bitti"} · ${hhmmss(Date.now())}</span></div>`);
  if (c.changed) toast(c.live ? "🔴 Yayın başladı — tarama devam ediyor" : "Yayın bitti — yayın dışı bağlantıda dinlemeye devam");
});
$("connectBtn").onclick = doConnect;
$("slugInput").onkeydown = (e) => { if (e.key === "Enter") doConnect(); };
$("leaveBtn").onclick = async () => {
  await api.disconnect();
};
api.onDisconnected((d) => {
  if (d && d.saved) toast(`Önceki bağlantı "Kayıtlı mesajlar"a kaydedildi (${d.saved.msgCount.toLocaleString("tr-TR")} mesaj)`);
  connected = null;
  closeDrawer();
  renderPanelState();
});
const ST = { connecting: "· bağlanıyor", connected: "· bağlandı", listening: "· dinleniyor", reconnecting: "· yeniden bağlanıyor..." };
api.onStatus((s) => ($("connStatus").textContent = ST[s] || ""));

// ---------- canlı akış ----------
const feed = $("feed");
feed.addEventListener("mouseenter", () => { paused = true; pausedNew = 0; });
feed.addEventListener("mouseleave", () => {
  paused = false;
  $("pausedPill").classList.add("hidden");
  feed.scrollTop = feed.scrollHeight;
});
function msgHtml(m) {
  const sev = m.maxSev || 0;
  const bd = (m.badges || []).map((b) => (/broadcaster/i.test(b) ? "🎥" : /moderator/i.test(b) ? "🛡" : /vip/i.test(b) ? "💎" : /subscriber|founder/i.test(b) ? "★" : "")).join("");
  const fl = (m.flags || []).map((f) => `<span class="fl s${f.sev} c-${f.cat}" title="${esc(f.match || "")}">${esc(f.label)}</span>`).join("");
  return `<div class="msg ${sev ? "f" + sev : ""}" data-id="${esc(m.id || "")}"><span class="tm">${hhmmss(m.t)}</span>${bd ? `<span class="bd">${bd}</span>` : ""}<span class="un" data-k="${esc(m.key)}" style="color:${nameColor(m.u, m.color)}">${esc(m.u)}</span>${fmtMsg(m.m)}${fl}</div>`;
}
feed.addEventListener("click", (e) => {
  const k = e.target.dataset && e.target.dataset.k;
  if (k) openDrawer(k);
});

api.onBatch(({ messages, users, relabels }) => {
  if (!connected) return;
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
  feed.insertAdjacentHTML("beforeend", messages.map(msgHtml).join(""));
  while (feed.childElementCount > MAX_FEED) feed.firstElementChild.remove();
  msgCount += messages.length;
  const newFlags = messages.filter((m) => m.maxSev > 0);
  flagCount += newFlags.length;
  if (paused) {
    pausedNew += messages.length;
    $("pausedNew").textContent = pausedNew;
    $("pausedPill").classList.remove("hidden");
  } else if (atBottom || true) feed.scrollTop = feed.scrollHeight;
  $("feedStats").textContent = `${msgCount.toLocaleString("tr-TR")} mesaj · ${flagCount} işaretli`;
  const fresh = new Set();
  for (const u of users) {
    const prev = suspects.get(u.key);
    if (!prev || u.lastAt > prev.lastAt) fresh.add(u.key);
    suspects.set(u.key, u);
  }
  // akrostiş / spam: daha önce akmış mesajları da geriye dönük işaretle
  for (const r of relabels || []) relabelIn(feed, r);
  if (newFlags.some((m) => m.maxSev >= 3)) beep();
  renderSuspects(fresh);
  if (drawerKey && !drawerSaved && (users.some((u) => u.key === drawerKey) || messages.some((m) => m.key === drawerKey))) loadDrawer(drawerKey, true);
});

function relabelIn(container, r) {
  for (const id of r.ids) {
    const el = container.querySelector(`.msg[data-id="${CSS.escape(id)}"]`);
    if (el && !el.querySelector(".fl.c-" + r.flag.cat)) {
      const cur = Math.max(0, ...[1, 2, 3].filter((n) => el.classList.contains("f" + n)));
      if (r.flag.sev > cur) {
        el.classList.remove("f1", "f2", "f3");
        el.classList.add("f" + r.flag.sev);
      }
      el.insertAdjacentHTML("beforeend", `<span class="fl s${r.flag.sev} c-${r.flag.cat}" title="${esc(r.flag.match)}">${esc(r.flag.label)}</span>`);
    }
  }
}
api.onModEvent((e) => {
  if (e.type === "MessageDeletedEvent" && e.data && e.data.message) {
    const el = feed.querySelector(`.msg[data-id="${CSS.escape(e.data.message.id)}"]`);
    if (el) el.classList.add("deleted");
  }
});

// ---------- şüpheliler ----------
// Gizli küfür / akrostiş / +18 için "neden yakalandı" açıklaması: "≈ porno", "→ yarak", "YARRAK (6 mesajın ilk harfi)"
function hintFor(last) {
  if (!last || !last.flags) return "";
  const f = last.flags.find((x) => x.cat === "gizli" || x.cat === "supheli" || x.cat === "spoiler" || x.cat === "akrostis" || x.cat === "mustehcen" || (x.cat === "kufur" && /→/.test(x.match || "")));
  if (!f || !f.match) return "";
  const m = f.cat === "akrostis" ? f.match : (f.match.match(/[→≈]\s*(.+)$/) || [null, f.match])[1];
  const sym = f.cat === "akrostis" ? "" : /≈/.test(f.match) ? "≈ " : "→ ";
  return ` <span class="why">${esc(sym + m)}</span>`;
}
function visibleSuspects() {
  return [...suspects.values()].filter((u) => u.flagged > 0 && !(u.dismissedAt && u.lastAt <= u.dismissedAt));
}
function filterChipsHtml(all, filter) {
  const counts = {};
  for (const u of all) for (const c of Object.keys(u.cats)) counts[c] = (counts[c] || 0) + 1;
  return [["all", "Tümü", all.length], ...Object.keys(CAT_LABEL).filter((c) => counts[c]).map((c) => [c, CAT_LABEL[c], counts[c]])]
    .map(([k, l, n]) => `<span class="chip ${filter === k ? "on" : ""}" data-f="${k}">${l} ${n}</span>`)
    .join("");
}
function susCardsHtml(list, { sel, fresh = new Set(), live = true, now = Date.now() }) {
  return list
    .slice(0, 300)
    .map((u) => {
      const sev = u.last ? u.last.maxSev : 1;
      const cats = Object.entries(u.cats).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `<span class="fl s${CAT_SEV[c] || 2}">${CAT_LABEL[c] || c}${n > 1 ? " ×" + n : ""}</span>`).join("");
      const when = u.lastAt ? (live ? ago(u.lastAt) : hhmmss(u.lastAt)) : "";
      return `<div class="sus ${sel === u.key ? "sel" : ""} ${fresh.has(u.key) ? "new" : ""}" data-k="${esc(u.key)}">
        <i class="bar s${sev}"></i>
        <div style="min-width:0"><div class="top"><span class="nm">${esc(u.name)}</span><span class="x">${u.flagged}×</span>${cats}<span class="ago">${when}</span></div>
        <div class="lm">${u.last ? fmtMsg(u.last.m) : ""}${hintFor(u.last)}</div></div>
        <div class="acts"><button class="btn small" data-a="cp" title="Kullanıcı adını kopyala">Kopyala</button>${live ? `<button class="btn small ghost" data-a="ok" title="Temiz, listeden çıkar">✓</button>` : ""}</div>
      </div>`;
    })
    .join("");
}
function sortSus(list, sort) {
  return list.sort((a, b) => (sort === "sev" ? b.score - a.score || b.lastAt - a.lastAt : b.lastAt - a.lastAt));
}
function renderSuspects(fresh = new Set()) {
  const all = visibleSuspects();
  $("susFilters").innerHTML = filterChipsHtml(all, susFilter);
  $("susFilters").querySelectorAll(".chip").forEach((c) => (c.onclick = () => ((susFilter = c.dataset.f), renderSuspects())));
  const list = sortSus(susFilter === "all" ? all : all.filter((u) => u.cats[susFilter]), susSort);
  $("susCount").textContent = all.length;
  if (!list.length) {
    $("susList").innerHTML = `<div class="empty">${all.length ? "Bu filtrede kimse yok." : "Henüz kimse yakalanmadı. Sohbet temiz 👌"}</div>`;
    return;
  }
  $("susList").innerHTML = susCardsHtml(list, { sel: selectedKey, fresh });
  $("susList").querySelectorAll(".sus").forEach((el) => {
    el.onclick = (e) => {
      const a = e.target.dataset.a;
      const k = el.dataset.k;
      if (a === "cp") return copyName(k);
      if (a === "ok") return doDismiss(k);
      selectedKey = k;
      $("susList").querySelectorAll(".sus").forEach((x) => x.classList.toggle("sel", x === el));
    };
    el.ondblclick = (e) => {
      if (!e.target.dataset.a) openDrawer(el.dataset.k);
    };
  });
}
$("susSort").querySelectorAll("button").forEach((b) => (b.onclick = () => {
  susSort = b.dataset.v;
  $("susSort").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  renderSuspects();
}));
setInterval(() => connected && renderSuspects(), 15000);

// ---------- işlemler ----------
function nameOf(k) {
  if (drawerSaved && drawerSaved.user.key === k) return drawerSaved.user.name;
  const sv = saved && saved.suspects.find((x) => x.key === k);
  if (sv && !suspects.get(k)) return sv.name;
  const u = suspects.get(k);
  return u ? u.name : (drawerData && drawerData.user && drawerData.user.key === k ? drawerData.user.name : k);
}
function copyName(k) {
  navigator.clipboard.writeText(nameOf(k)).then(() => toast(`"${nameOf(k)}" kopyalandı`));
}
async function doDismiss(k) {
  await api.userDismiss(k);
  const u = suspects.get(k);
  if (u) u.dismissedAt = Date.now();
  renderSuspects();
  if (drawerKey === k) closeDrawer();
}

// ---------- kullanıcı detayı (çekmece) ----------
let drawerSaved = null; // kayıtlı yayından açıldıysa {user, messages}
function openDrawer(k, saved = null) {
  drawerKey = k;
  drawerSaved = saved;
  $("drDismiss").classList.toggle("hidden", !!saved);
  $("drawer").classList.remove("hidden");
  $("drawerBg").classList.remove("hidden");
  $("drMsgs").innerHTML = `<div class="empty">Yükleniyor...</div>`;
  loadDrawer(k);
}
function closeDrawer() {
  drawerKey = null;
  $("drawer").classList.add("hidden");
  $("drawerBg").classList.add("hidden");
}
$("drClose").onclick = closeDrawer;
$("drawerBg").onclick = closeDrawer;
window.addEventListener("keydown", (e) => e.key === "Escape" && closeDrawer());
let drawerLoading = false;
async function loadDrawer(k, quiet) {
  if (drawerLoading && quiet) return;
  drawerLoading = true;
  const d = drawerSaved ? drawerSaved : await api.userDetail(k);
  drawerLoading = false;
  if (drawerKey !== k) return;
  if (d.error) return ($("drMsgs").innerHTML = `<div class="empty">${esc(d.error)}</div>`);
  drawerData = d;
  const u = d.user, c = d.card || {};
  avatar($("drAvatar"), u.name, c.avatar);
  $("drName").textContent = u.name;
  $("drBadges").textContent = (c.badges || []).join(" · ") || "izleyici";
  $("drInfo").classList.toggle("hidden", !!drawerSaved);
  const days = c.createdAt ? Math.floor((Date.now() - Date.parse(c.createdAt)) / 86400000) : null;
  const fol = c.followingSince ? Math.floor((Date.now() - Date.parse(c.followingSince)) / 86400000) : null;
  $("drInfo").innerHTML = `
    <div class="${days != null && days < 7 ? "warn" : ""}"><b>${days == null ? "—" : days < 1 ? "bugün" : days + " gün"}</b><small>hesap yaşı${days != null && days < 7 ? " ⚠ yeni" : ""}</small></div>
    <div><b>${fol == null ? "takip etmiyor" : fol < 1 ? "bugün" : fol + " gün"}</b><small>takip</small></div>
    <div><b>${c.subscribedFor ? c.subscribedFor + " ay" : "—"}</b><small>abonelik</small></div>
    <div class="${c.banned ? "warn" : ""}"><b>${c.banned ? (c.banned.permanent === false || c.banned.expires_at ? "timeout'ta" : "banlı") : "aktif"}</b><small>durum</small></div>`;
  $("drCats").innerHTML = Object.entries(u.cats).map(([cat, n]) => `<span class="fl s${CAT_SEV[cat] || 2}">${CAT_LABEL[cat]} ×${n}</span>`).join("") + (u.partners.length ? `<span class="muted xs">Kavga ettiği: ${u.partners.map(esc).join(", ")}</span>` : "");
  const only = $("drOnlyFlag").checked;
  const msgs = (only ? d.messages.filter((m) => m.flags.length) : d.messages).slice().reverse();
  $("drMsgCount").textContent = `${d.messages.length} mesaj · ${d.messages.filter((m) => m.flags.length).length} işaretli`;
  $("drMsgs").innerHTML = msgs.length
    ? msgs.map((m) => `<div class="msg ${m.maxSev ? "f" + m.maxSev : ""}"><span class="tm">${hhmmss(m.t)}</span><span class="tx">${fmtMsg(m.m)}${m.flags.map((f) => `<span class="fl s${f.sev}" title="${esc(f.match || "")}">${esc(f.label)}</span>`).join("")}${hintFor(m)}</span></div>`).join("")
    : `<div class="empty">Mesaj yok.</div>`;
}
$("drOnlyFlag").onchange = () => drawerKey && loadDrawer(drawerKey);
$("drCopy").onclick = () => drawerKey && copyName(drawerKey);
$("drOpenKick").onclick = () => drawerKey && api.openUrl(`https://kick.com/${encodeURIComponent(nameOf(drawerKey).toLowerCase())}`);
$("drDismiss").onclick = () => drawerKey && doDismiss(drawerKey);

// ---------- kayıtlı mesajlar ----------
let saved = null; // {meta, suspects, messages}
let savedFilter = "all", savedSort = "new", savedShown = 1500, savedSel = null;
function fmtDur(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  return m < 60 ? `${m} dk` : `${Math.floor(m / 60)} sa ${m % 60} dk`;
}
function fmtDate(t) {
  return new Date(t).toLocaleString("tr-TR", { day: "numeric", month: "long", weekday: "short", hour: "2-digit", minute: "2-digit" });
}
function fmtSize(b) {
  return b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
}
async function loadSavedList() {
  $("savedBoard").classList.add("hidden");
  $("savedList").classList.remove("hidden");
  saved = null;
  const list = await api.sessionsList();
  $("savedTotal").textContent = list.length ? `${list.length} kayıt · ${fmtSize(list.reduce((s, x) => s + (x.bytes || 0), 0))}` : "";
  if (!list.length) {
    $("savedItems").innerHTML = `<div class="empty">Henüz kayıt yok. Bir kanala bağlandığında mesajlar burada birikir.</div>`;
    return;
  }
  const groups = new Map();
  for (const x of list) {
    if (!groups.has(x.slug)) groups.set(x.slug, []);
    groups.get(x.slug).push(x);
  }
  $("savedItems").innerHTML = [...groups.values()]
    .map((g) => `<div class="sv-group"><h3><span class="avatar sm" data-av="${esc(g[0].avatar || "")}" data-nm="${esc(g[0].name)}"></span>${esc(g[0].name)} <span class="muted xs">${g.length} kayıt</span></h3>
      ${g.map((x) => `<div class="sv-item" data-id="${esc(x.id)}">
        <div class="sv-main"><div class="sv-date">${fmtDate(x.startedAt)} ${x.active ? `<span class="tag now">● ŞU AN KAYITTA</span>` : ""} ${x.wasLive ? `<span class="tag live">YAYIN</span>` : `<span class="tag off">YAYIN DIŞI</span>`}</div>
          <div class="sv-title">${esc(x.title || "")}${x.title ? " · " : ""}${fmtDur((x.endedAt || Date.now()) - x.startedAt)}</div></div>
        <div class="sv-nums"><b>${x.msgCount.toLocaleString("tr-TR")}</b> mesaj · <b class="red">${x.suspectCount}</b> şüpheli<br><span class="xs">${fmtSize(x.bytes || 0)}</span></div>
        ${x.active ? "" : `<button class="btn small ghost" data-del="${esc(x.id)}" title="Bu kaydı sil">Sil</button>`}
      </div>`).join("")}</div>`)
    .join("");
  $("savedItems").querySelectorAll("[data-av]").forEach((el) => avatar(el, el.dataset.nm, el.dataset.av || null));
  $("savedItems").querySelectorAll(".sv-item").forEach((el) => {
    el.onclick = async (e) => {
      const del = e.target.dataset.del;
      if (del) {
        const ok = await modal("Kaydı sil", `<p>Bu kayıttaki tüm mesajlar ve şüpheliler kalıcı olarak silinecek. Geri alınamaz.</p>`, [{ label: "Vazgeç", value: false }, { label: "Sil", value: true, kind: "primary" }]);
        if (ok) {
          const r = await api.sessionsDelete(del);
          if (r.error) toast(r.error);
          loadSavedList();
        }
        return;
      }
      openSaved(el.dataset.id);
    };
  });
}
async function openSaved(id) {
  const r = await api.sessionsOpen(id);
  if (r.error) return toast(r.error);
  saved = r;
  savedFilter = "all";
  savedShown = 1500;
  savedSel = null;
  $("savedSearch").value = "";
  $("savedOnlyFlag").checked = false;
  $("savedList").classList.add("hidden");
  $("savedBoard").classList.remove("hidden");
  const m = r.meta;
  $("savedTitle").textContent = m.name;
  $("savedSub").textContent = `· ${fmtDate(m.startedAt)} · ${fmtDur((m.endedAt || Date.now()) - m.startedAt)}${m.wasLive ? "" : " · yayın dışı"}`;
  renderSavedFeed();
  renderSavedSus();
}
function savedMsgs() {
  const q = $("savedSearch").value.trim().toLocaleLowerCase("tr-TR");
  const only = $("savedOnlyFlag").checked;
  return saved.messages.filter((x) => {
    if (x.sys) return !q && !only;
    if (only && !x.maxSev) return false;
    return !q || x.m.toLocaleLowerCase("tr-TR").includes(q) || String(x.u).toLocaleLowerCase("tr-TR").includes(q);
  });
}
function renderSavedFeed() {
  const all = savedMsgs();
  const real = saved.messages.filter((x) => !x.sys);
  $("savedStats").textContent = `${real.length.toLocaleString("tr-TR")} mesaj · ${real.filter((x) => x.maxSev).length} işaretli`;
  const part = all.slice(-savedShown);
  const html = part.map((x) => (x.sys ? `<div class="sysline"><span>${x.sys === "live" ? "🔴 Yayın başladı" : "Yayın bitti"} · ${hhmmss(x.t)}${x.title ? " · " + esc(x.title) : ""}</span></div>` : msgHtml(x))).join("");
  $("savedFeed").innerHTML = (all.length > part.length ? `<button class="btn small more" id="savedMore">Daha eski ${Math.min(1500, all.length - part.length).toLocaleString("tr-TR")} mesajı göster (${(all.length - part.length).toLocaleString("tr-TR")} kaldı)</button>` : "") + (html || `<div class="empty">Mesaj yok.</div>`);
  if ($("savedMore")) $("savedMore").onclick = () => {
    const h = $("savedFeed").scrollHeight;
    savedShown += 1500;
    renderSavedFeed();
    $("savedFeed").scrollTop = $("savedFeed").scrollHeight - h;
  };
  else $("savedFeed").scrollTop = $("savedFeed").scrollHeight;
}
function savedUserDetail(k) {
  const u = saved.suspects.find((x) => x.key === k);
  const messages = saved.messages.filter((x) => !x.sys && x.key === k);
  const name = u ? u.name : (messages[0] && messages[0].u) || k;
  const cats = {};
  for (const x of messages) for (const f of x.flags || []) cats[f.cat] = (cats[f.cat] || 0) + 1;
  return { user: { key: k, name, cats: u ? u.cats : cats, partners: (u && u.partners) || [] }, messages, card: null };
}
function renderSavedSus() {
  const all = saved.suspects.filter((u) => u.flagged > 0);
  $("savedFilters").innerHTML = filterChipsHtml(all, savedFilter);
  $("savedFilters").querySelectorAll(".chip").forEach((c) => (c.onclick = () => ((savedFilter = c.dataset.f), renderSavedSus())));
  const list = sortSus(savedFilter === "all" ? all.slice() : all.filter((u) => u.cats[savedFilter]), savedSort);
  $("savedSusCount").textContent = all.length;
  $("savedSusList").innerHTML = list.length ? susCardsHtml(list, { sel: savedSel, live: false }) : `<div class="empty">${all.length ? "Bu filtrede kimse yok." : "Bu yayında kimse yakalanmadı."}</div>`;
  $("savedSusList").querySelectorAll(".sus").forEach((el) => {
    el.onclick = (e) => {
      if (e.target.dataset.a === "cp") return copyName(el.dataset.k);
      savedSel = el.dataset.k;
      $("savedSusList").querySelectorAll(".sus").forEach((x) => x.classList.toggle("sel", x === el));
    };
    el.ondblclick = (e) => {
      if (!e.target.dataset.a) openDrawer(el.dataset.k, savedUserDetail(el.dataset.k));
    };
  });
}
$("savedFeed").addEventListener("click", (e) => {
  const k = e.target.dataset && e.target.dataset.k;
  if (k && saved) openDrawer(k, savedUserDetail(k));
});
let searchT = null;
$("savedSearch").oninput = () => {
  clearTimeout(searchT);
  searchT = setTimeout(() => saved && ((savedShown = 1500), renderSavedFeed()), 200);
};
$("savedOnlyFlag").onchange = () => saved && ((savedShown = 1500), renderSavedFeed());
$("savedBack").onclick = loadSavedList;
$("savedFolder").onclick = () => api.sessionsFolder();
$("savedSort").querySelectorAll("button").forEach((b) => (b.onclick = () => {
  savedSort = b.dataset.v;
  $("savedSort").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  if (saved) renderSavedSus();
}));

// ---------- ayarlar ----------
async function fillSettings() {
  settings = await api.settingsGet();
  $("wordsIn").value = (settings.customWords || []).join("\n");
  $("spoilerIn").value = (settings.spoilerWords || []).join("\n");
  $("chapterIn").value = settings.chapterNow || 0;
  const map = { cSpoiler: "spoiler", cPollution: "pollution", cHidden: "hidden", cAcrostic: "acrostic", cProfanity: "profanity", cInsults: "insults", cThreats: "threats", cFights: "fights", cSpam: "spam", cCaps: "caps", cLinks: "links", cIgnoreMods: "ignoreMods", cIgnoreSubs: "ignoreSubs", cSound: "sound" };
  for (const [id, k] of Object.entries(map)) $(id).checked = !!settings[k];
  $("verTxt").textContent = "v" + (await api.appVersion());
}
$("saveDet").onclick = async () => {
  settings = await api.settingsSave({
    customWords: $("wordsIn").value.split(/\n|,/).map((s) => s.trim()).filter(Boolean),
    spoilerWords: $("spoilerIn").value.split(/\n|,/).map((s) => s.trim()).filter(Boolean),
    spoiler: $("cSpoiler").checked,
    chapterNow: Math.max(0, Math.min(99, parseInt($("chapterIn").value, 10) || 0)),
    hidden: $("cHidden").checked, acrostic: $("cAcrostic").checked,
    profanity: $("cProfanity").checked, insults: $("cInsults").checked, threats: $("cThreats").checked, fights: $("cFights").checked,
    spam: $("cSpam").checked, pollution: $("cPollution").checked, caps: $("cCaps").checked, links: $("cLinks").checked,
    ignoreMods: $("cIgnoreMods").checked, ignoreSubs: $("cIgnoreSubs").checked, sound: $("cSound").checked,
  });
  $("detMsg").textContent = "Kaydedildi ✓ (yeni mesajlara uygulanır)";
  setTimeout(() => ($("detMsg").textContent = ""), 2500);
};

// ---------- güncelleme ----------
api.onUpdateAvailable((info) => {
  $("updateText").innerHTML = `Yeni sürüm hazır: <b>v${esc(info.version)}</b>`;
  $("updateBar").classList.remove("hidden");
});
api.onUpdateProgress((f) => ($("updateText").textContent = `Güncelleme indiriliyor... %${Math.round(f * 100)}`));
$("updateLater").onclick = () => $("updateBar").classList.add("hidden");
$("updateNow").onclick = async () => {
  $("updateNow").disabled = true;
  const r = await api.updateInstall();
  if (r.error) { $("updateNow").disabled = false; $("updateText").textContent = "Güncellenemedi: " + r.error; }
  else $("updateText").textContent = "Kuruluyor, uygulama birazdan yeniden açılacak...";
};
$("checkUpd").onclick = async () => {
  $("updMsg").textContent = "Kontrol ediliyor...";
  const r = await api.updateCheck();
  $("updMsg").textContent = r.error ? "Kontrol edilemedi: " + r.error : r.available ? `Yeni sürüm var: v${r.version}` : "Güncelsin ✓";
  if (r.available) { $("updateText").innerHTML = `Yeni sürüm hazır: <b>v${esc(r.version)}</b>`; $("updateBar").classList.remove("hidden"); }
};

// ---------- başlat ----------
(async () => {
  settings = await api.settingsGet();
  renderPanelState();
})();
