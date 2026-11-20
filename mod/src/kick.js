// Kick API erişimi. Kick bot korumasını geçmek için Chromium'un ağ katmanını
// (net.fetch) kullanır; o da engellenirse gizli bir tarayıcı penceresinde açar.
const { net, BrowserWindow } = require("electron");

const BASE = process.env.KICK_BASE || "https://kick.com";

async function viaFetch(url) {
  const r = await net.fetch(url, {
    headers: { Accept: "application/json, text/plain, */*", "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8" },
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const txt = await r.text();
  return JSON.parse(txt);
}

async function viaHiddenWindow(url) {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false, javascript: true } });
  try {
    await win.loadURL(url).catch(() => {});
    const until = Date.now() + 20000;
    while (Date.now() < until) {
      const txt = await win.webContents.executeJavaScript("document.body ? document.body.innerText : ''").catch(() => "");
      const t = (txt || "").trim();
      if (t.startsWith("{") || t.startsWith("[")) return JSON.parse(t);
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("Kick yanıt vermedi");
  } finally {
    win.destroy();
  }
}

async function kickGet(path) {
  const url = BASE + path;
  try {
    return await viaFetch(url);
  } catch (e) {
    if (/HTTP 404/.test(e.message)) throw e;
    return await viaHiddenWindow(url);
  }
}

function toIso(s) {
  if (!s) return null;
  const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(s);
  const d = new Date(s.replace(" ", "T") + (hasZone ? "" : "Z"));
  return isNaN(d) ? null : d.toISOString();
}

async function getChannel(slug) {
  let j;
  try {
    j = await kickGet(`/api/v2/channels/${encodeURIComponent(slug)}`);
  } catch (e) {
    if (/404/.test(e.message)) return { notFound: true, slug };
    throw e;
  }
  if (!j || !j.chatroom) return { notFound: true, slug };
  const ls = j.livestream;
  return {
    slug: j.slug || slug,
    channelId: j.id,
    chatroomId: j.chatroom.id,
    username: (j.user && j.user.username) || j.slug || slug,
    userId: j.user_id || (j.user && j.user.id) || null,
    avatar: (j.user && j.user.profile_pic) || null,
    live: !!(ls && (ls.is_live === undefined || ls.is_live)),
    livestream: ls
      ? {
          id: ls.id,
          title: ls.session_title || "",
          startTime: toIso(ls.start_time || ls.created_at),
          viewers: ls.viewer_count || 0,
          category: (ls.categories && ls.categories[0] && ls.categories[0].name) || "",
        }
      : null,
  };
}

// Yayın kaydının (VOD) video adresini bulur
async function findVod(slug, livestreamId, startTime, manualUrl) {
  if (manualUrl) {
    const m = manualUrl.match(/videos\/([0-9a-f-]{36})/i);
    if (manualUrl.includes(".m3u8")) return { source: manualUrl };
    if (m) {
      const v = await kickGet(`/api/v1/video/${m[1]}`);
      const src = v.source || (v.livestream && v.livestream.source);
      if (src) return { source: src, startTime: toIso(v.livestream && (v.livestream.start_time || v.livestream.created_at)) };
    }
    throw new Error("Bu linkten video bulunamadı");
  }
  const list = await kickGet(`/api/v2/channels/${encodeURIComponent(slug)}/videos`);
  const arr = Array.isArray(list) ? list : list.data || [];
  let hit = arr.find((v) => v.id === livestreamId);
  if (!hit && startTime) {
    const t = Date.parse(startTime);
    hit = arr
      .map((v) => ({ v, d: Math.abs(Date.parse(toIso(v.start_time || v.created_at)) - t) }))
      .filter((x) => x.d < 15 * 60 * 1000)
      .sort((a, b) => a.d - b.d)
      .map((x) => x.v)[0];
  }
  if (!hit || !hit.source) return null;
  return { source: hit.source, startTime: toIso(hit.start_time || hit.created_at) };
}

// Kick'in o an kullandığı sohbet (Pusher) anahtarını sorar.
// Kick anahtarı değiştirirse uygulama güncelleme gerektirmeden yenisini alır.
const OLD_KEYS = ["32cbd69e4b950bf97679"];
const FALLBACK = { key: "34bf7a0ff419a2a775b9", cluster: "us2" };
async function resolvePusher(saved) {
  try {
    const id = require("crypto").randomUUID();
    const url = process.env.KICK_REALTIME_URL || "https://web.kick.com/api/v1/realtime/connection";
    const body = JSON.stringify({ client: { id, type: "web" }, capabilities: { accepted_providers: [{ provider: "pusher" }] } });
    let r = null;
    try {
      r = await net.fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body });
    } catch (_) {}
    if (!r || !r.ok) {
      // Chromium ağı olmazsa Node'un kendi fetch'i ile dene
      r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Origin: "https://kick.com", Referer: "https://kick.com/" }, body });
    }
    if (r.ok) {
      const j = await r.json();
      const d = (j && j.data) || {};
      let key = null, cluster = null;
      const conn = (d.connections || []).find((c) => c.provider === "pusher");
      if (conn && conn.credentials) ({ app_key: key, cluster } = conn.credentials);
      else if (d.pusher) ({ key, cluster } = d.pusher);
      if (/^[a-z0-9]{10,40}$/i.test(key || "") && /^[a-z0-9-]{2,12}$/i.test(cluster || "")) return { key, cluster, source: "kick" };
    }
  } catch (_) {}
  if (saved && saved.key && !OLD_KEYS.includes(saved.key)) return { ...saved, source: "kayitli" };
  return { ...FALLBACK, source: "yedek" };
}

// Kullanıcının bu kanaldaki kartı: moderatör mü, yayıncı mı, banlı mı, hesap yaşı, takip/abonelik
async function userCard(slug, username) {
  try {
    const j = await kickGet(`/api/v2/channels/${encodeURIComponent(slug)}/users/${encodeURIComponent(String(username).toLowerCase())}`);
    return {
      id: j.id,
      username: j.username,
      avatar: j.profile_pic || null,
      isOwner: !!j.is_channel_owner,
      isMod: !!j.is_moderator,
      isStaff: !!j.is_staff,
      badges: (j.badges || []).map((b) => b.text || b.type),
      createdAt: j.created_at || null,
      followingSince: j.following_since || null,
      subscribedFor: j.subscribed_for || 0,
      banned: j.banned || null,
    };
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = { getChannel, toIso, resolvePusher, userCard, kickGet };
