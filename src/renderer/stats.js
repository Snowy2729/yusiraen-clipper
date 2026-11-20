// ---------- İSTATİSTİKLER ----------
let statsData = null;
let vidSort = { key: "publishedAt", dir: -1 };

function kfmt(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(".", ",") + " Mn";
  if (n >= 1e4) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(".", ",") + " B";
  return num(n);
}
function durFmt(s) {
  s = Math.round(s || 0);
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

async function renderStats(refresh) {
  const body = $("statsBody");
  const ys = await api.ytStatus();
  if (!ys.connected) {
    body.innerHTML = `<div class="empty-card"><h2 style="margin-top:0">YouTube istatistikleri</h2>
      <p class="muted">Kanalının abone, izlenme ve video istatistiklerini burada görmek için YouTube hesabını bağla. Ücretsiz, bir kerelik 5 dakikalık kurulum.</p>
      <button class="btn primary" id="stGoSet">Ayarlar'dan YouTube'u bağla</button></div>`;
    $("stGoSet").onclick = () => showView("settings");
    return;
  }
  if (!statsData && !refresh) {
    const c = (settings && settings.ytStatsCache) || null;
    if (c) statsData = c;
  }
  if (statsData) drawStats(statsData, !refresh);
  else body.innerHTML = `<div class="empty">İstatistikler yükleniyor...</div>`;
  if (refresh || !statsData || Date.now() - Date.parse(statsData.fetchedAt) > 10 * 60 * 1000) {
    const r = await api.ytStats();
    if (r.error) {
      if (!statsData) body.innerHTML = `<div class="empty-card"><p>${esc(r.error)}</p><button class="btn" id="stRetry">Tekrar dene</button></div>`;
      else toast(r.error, 4000);
      const b = $("stRetry");
      if (b) b.onclick = () => renderStats(true);
      return;
    }
    statsData = r;
    drawStats(r);
  }
}

function drawStats(d) {
  const ch = d.channel;
  const daily = d.daily || [];
  const sum = (k) => daily.reduce((s, x) => s + (Number(x[k]) || 0), 0);
  const v28 = sum("views"), sg = sum("subsGained") - sum("subsLost"), min28 = sum("minutes");
  const vids = [...d.videos].sort((a, b) => {
    const A = a[vidSort.key], B = b[vidSort.key];
    return (A > B ? 1 : A < B ? -1 : 0) * vidSort.dir;
  });
  const th = (k, l, cls = "") => `<th class="${cls}" data-k="${k}">${l}${vidSort.key === k ? (vidSort.dir < 0 ? " ▼" : " ▲") : ""}</th>`;
  $("statsBody").innerHTML = `
    <div class="ch-head">
      ${ch.thumb ? `<img src="${esc(ch.thumb)}" alt="">` : ""}
      <div style="flex:1"><h2>${esc(ch.title)}</h2><div class="muted">Son güncelleme: ${new Date(d.fetchedAt).toLocaleString("tr-TR")}</div></div>
      <button class="btn" id="stRefresh">Yenile</button>
    </div>
    <div class="stat-tiles">
      <div class="tile"><b>${ch.hiddenSubs ? "gizli" : kfmt(ch.subscribers)}</b><small>abone</small></div>
      <div class="tile"><b>${kfmt(ch.views)}</b><small>toplam izlenme</small></div>
      <div class="tile"><b>${num(ch.videos)}</b><small>video</small></div>
      <div class="tile"><b>${daily.length ? kfmt(v28) : "—"}</b><small>son 28 gün izlenme</small></div>
      <div class="tile"><b>${daily.length ? (sg >= 0 ? "+" : "") + num(sg) : "—"}</b><small>son 28 gün abone${daily.length ? ` · ${kfmt(Math.round(min28 / 60))} saat izlendi` : ""}</small></div>
    </div>
    <div class="chart"><canvas id="stChart"></canvas></div>
    ${d.analyticsError ? `<div class="notice">Günlük grafik alınamadı: ${esc(d.analyticsError)}<br><span class="muted">Google Cloud projende "YouTube Analytics API"nin etkin olduğundan emin ol.</span></div>` : ""}
    <h3>Son videolar</h3>
    ${vids.length ? `<table class="vid-table"><thead><tr><th></th>${th("title", "Başlık")}${th("publishedAt", "Tarih")}${th("duration", "Süre", "n")}${th("views", "İzlenme", "n")}${th("likes", "Beğeni", "n")}${th("comments", "Yorum", "n")}</tr></thead><tbody>
      ${vids.map((v) => `<tr><td>${v.thumb ? `<img src="${esc(v.thumb)}" alt="">` : ""}</td>
        <td><a href="#" data-url="https://youtu.be/${esc(v.id)}">${esc(v.title)}</a> ${v.duration <= 180 ? '<span class="badge short">Shorts</span>' : ""} ${v.privacy && v.privacy !== "public" ? `<span class="badge">${v.privacy === "private" ? "gizli" : "liste dışı"}</span>` : ""}</td>
        <td class="muted">${new Date(v.publishedAt).toLocaleDateString("tr-TR")}</td>
        <td class="n">${durFmt(v.duration)}</td><td class="n">${num(v.views)}</td><td class="n">${num(v.likes)}</td><td class="n">${num(v.comments)}</td></tr>`).join("")}
    </tbody></table>` : `<div class="empty">Kanalda henüz video yok.</div>`}`;
  $("stRefresh").onclick = () => renderStats(true);
  document.querySelectorAll(".vid-table th[data-k]").forEach((t) => (t.onclick = () => {
    vidSort = { key: t.dataset.k, dir: vidSort.key === t.dataset.k ? -vidSort.dir : -1 };
    drawStats(d);
  }));
  document.querySelectorAll(".vid-table a[data-url]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); api.openUrl(a.dataset.url); }));
  drawDaily(daily);
}

function drawDaily(daily) {
  const c = $("stChart");
  if (!c) return;
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr;
  c.height = h * dpr;
  const g = c.getContext("2d");
  g.scale(dpr, dpr);
  g.font = "11px Segoe UI";
  if (!daily.length) {
    g.fillStyle = "#777";
    g.fillText("Günlük veri yok", 10, 20);
    return;
  }
  const maxV = Math.max(1, ...daily.map((x) => x.views));
  const maxS = Math.max(1, ...daily.map((x) => Math.abs(x.subsGained - x.subsLost)));
  const bottom = h - 22, top = 18, bw = w / daily.length;
  g.fillStyle = "#8b8b8b";
  g.fillText("Günlük izlenme", 4, 12);
  g.fillStyle = "#ff8a8a";
  g.fillText("— abone değişimi", 100, 12);
  daily.forEach((x, i) => {
    const bh = (x.views / maxV) * (bottom - top);
    g.fillStyle = "rgba(163,20,27,.75)";
    g.fillRect(i * bw + 2, bottom - bh, Math.max(1, bw - 4), bh);
    if (i % Math.ceil(daily.length / 7) === 0) {
      g.fillStyle = "#777";
      g.fillText(x.day.slice(5).replace("-", "."), i * bw + 2, h - 6);
    }
  });
  g.beginPath();
  daily.forEach((x, i) => {
    const y = bottom - ((x.subsGained - x.subsLost + maxS) / (2 * maxS)) * (bottom - top);
    i ? g.lineTo(i * bw + bw / 2, y) : g.moveTo(i * bw + bw / 2, y);
  });
  g.strokeStyle = "#ff8a8a";
  g.lineWidth = 2;
  g.stroke();
}
window.addEventListener("resize", () => statsData && $("view-stats").classList.contains("active") && drawDaily(statsData.daily || []));

// ---------- Ayarlar: YouTube bağlantısı ----------
async function fillYtSettings() {
  const s = await api.ytStatus();
  $("ytCid").value = s.clientId || "";
  $("ytSecret").placeholder = s.hasClient ? "•••••••• (kayıtlı)" : "";
  $("ytStatusLine").innerHTML = s.connected
    ? `✅ Bağlı: <b>${esc((s.channel && s.channel.title) || "YouTube kanalı")}</b>`
    : s.hasClient ? "Bilgiler kayıtlı, henüz bağlanmadı." : "Bağlı değil";
  $("ytDisconnect").classList.toggle("hidden", !s.connected);
  $("ytConnectBtn").textContent = s.connected ? "Yeniden bağlan" : "Kaydet ve YouTube'u bağla";
}
$("ytConnectBtn").onclick = async () => {
  const cid = $("ytCid").value.trim();
  const sec = $("ytSecret").value.trim();
  const cur = await api.ytStatus();
  if (!cid || (!sec && !cur.hasClient)) return ($("ytMsg").textContent = "Client ID ve Client Secret gerekli.");
  if (sec || cid !== cur.clientId) await api.ytSetClient({ clientId: cid, clientSecret: sec || undefined });
  $("ytMsg").textContent = "Tarayıcıda Google girişi açıldı, izin ver...";
  $("ytConnectBtn").disabled = true;
  const r = await api.ytConnect();
  $("ytConnectBtn").disabled = false;
  $("ytSecret").value = "";
  if (r.error) $("ytMsg").textContent = r.error;
  else {
    $("ytMsg").textContent = "";
    toast("YouTube bağlandı ✓");
    statsData = null;
  }
  fillYtSettings();
};
$("ytDisconnect").onclick = async () => {
  const ok = await modal("YouTube bağlantısı kesilsin mi?", "İstatistikler ve yükleme, tekrar bağlanana kadar çalışmaz.", [
    { label: "Vazgeç", value: false, kind: "ghost" },
    { label: "Bağlantıyı kes", value: true, kind: "danger" },
  ]);
  if (!ok) return;
  await api.ytDisconnect();
  statsData = null;
  fillYtSettings();
};
fillYtSettings();
