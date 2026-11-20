// YouTube: hesabı bağlama (OAuth), kanal ve video istatistikleri, video yükleme.
// Ücretsiz: kullanıcının kendi Google Cloud projesinin "Masaüstü uygulaması" OAuth istemcisiyle çalışır.
const { net, shell, safeStorage } = require("electron");
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const E = {
  auth: process.env.GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth",
  token: process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token",
  revoke: process.env.GOOGLE_REVOKE_URL || "https://oauth2.googleapis.com/revoke",
  api: process.env.YT_API_BASE || "https://www.googleapis.com/youtube/v3",
  upload: process.env.YT_UPLOAD_BASE || "https://www.googleapis.com/upload/youtube/v3",
  analytics: process.env.YT_ANALYTICS_BASE || "https://youtubeanalytics.googleapis.com/v2",
};
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

class YouTube {
  constructor(root) {
    this.file = path.join(root, "youtube.json");
    this.data = this._load();
  }
  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (raw.enc && safeStorage.isEncryptionAvailable()) return JSON.parse(safeStorage.decryptString(Buffer.from(raw.enc, "base64")));
      return raw.plain || {};
    } catch (_) {
      return {};
    }
  }
  _save() {
    const s = JSON.stringify(this.data);
    const out = safeStorage.isEncryptionAvailable() ? { enc: safeStorage.encryptString(s).toString("base64") } : { plain: this.data };
    fs.writeFileSync(this.file, JSON.stringify(out));
  }
  setClient(clientId, clientSecret) {
    const changed = clientId !== this.data.clientId;
    this.data.clientId = (clientId || "").trim();
    if (clientSecret) this.data.clientSecret = clientSecret.trim();
    else if (changed) this.data.clientSecret = "";
    if (changed) {
      delete this.data.refreshToken;
      delete this.data.accessToken;
      delete this.data.channel;
    }
    this._save();
  }
  status() {
    return {
      hasClient: !!(this.data.clientId && this.data.clientSecret),
      clientId: this.data.clientId || "",
      connected: !!this.data.refreshToken,
      channel: this.data.channel || null,
    };
  }

  // Tarayıcıda Google girişini açar, izin verilince kodu yerel bir adrese alır
  connect() {
    if (!this.data.clientId || !this.data.clientSecret) return Promise.reject(new Error("Önce Client ID ve Client Secret gir."));
    const verifier = crypto.randomBytes(48).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const state = crypto.randomBytes(16).toString("hex");
    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        const u = new URL(req.url, "http://127.0.0.1");
        if (u.pathname !== "/") return res.end();
        const code = u.searchParams.get("code");
        const err = u.searchParams.get("error");
        const page = (msg) => `<!doctype html><meta charset="utf-8"><body style="background:#0a0a0a;color:#eee;font-family:Segoe UI,sans-serif;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#c22">Yusiraen Clipper</h2><p>${msg}</p></div></body>`;
        if (err || !code || u.searchParams.get("state") !== state) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(page("Bağlantı iptal edildi ya da başarısız oldu. Bu sekmeyi kapatabilirsin."));
          server.close();
          clearTimeout(timer);
          return reject(new Error(err === "access_denied" ? "İzin verilmedi." : "Google girişi başarısız oldu."));
        }
        try {
          const port = server.address().port;
          const tok = await this._tokenRequest({ code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: `http://127.0.0.1:${port}` });
          this.data.refreshToken = tok.refresh_token || this.data.refreshToken;
          this._setAccess(tok);
          this._save();
          await this.fetchChannel().catch(() => {});
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(page("✅ YouTube hesabın bağlandı. Uygulamaya dönebilirsin."));
          resolve(this.status());
        } catch (e) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(page("Bağlanırken hata oluştu: " + String(e.message).replace(/</g, "&lt;")));
          reject(e);
        } finally {
          server.close();
          clearTimeout(timer);
        }
      });
      const timer = setTimeout(() => {
        server.close();
        reject(new Error("Zaman aşımı: 5 dakika içinde giriş yapılmadı."));
      }, 5 * 60 * 1000);
      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        const q = new URLSearchParams({
          client_id: this.data.clientId,
          redirect_uri: `http://127.0.0.1:${port}`,
          response_type: "code",
          scope: SCOPES.join(" "),
          code_challenge: challenge,
          code_challenge_method: "S256",
          access_type: "offline",
          prompt: "consent",
          state,
        });
        const url = `${E.auth}?${q}`;
        this.lastAuthUrl = url;
        if (process.env.YT_TEST_AUTOAUTH) net.fetch(url).catch(() => {});
        else shell.openExternal(url);
      });
    });
  }

  async disconnect() {
    const t = this.data.refreshToken;
    if (t) net.fetch(`${E.revoke}?token=${encodeURIComponent(t)}`, { method: "POST" }).catch(() => {});
    delete this.data.refreshToken;
    delete this.data.accessToken;
    delete this.data.channel;
    this._save();
    return this.status();
  }

  async _tokenRequest(params) {
    const body = new URLSearchParams({ client_id: this.data.clientId, client_secret: this.data.clientSecret, ...params });
    const r = await net.fetch(E.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (j.error === "invalid_grant") {
        delete this.data.refreshToken;
        this._save();
        throw new Error("YouTube bağlantısının süresi doldu, Ayarlar'dan tekrar bağlan.");
      }
      throw new Error("Google: " + (j.error_description || j.error || r.status));
    }
    return j;
  }
  _setAccess(tok) {
    this.data.accessToken = tok.access_token;
    this.data.accessExp = Date.now() + (tok.expires_in || 3600) * 1000 - 60000;
  }
  async token() {
    if (!this.data.refreshToken) throw new Error("YouTube hesabı bağlı değil.");
    if (this.data.accessToken && Date.now() < this.data.accessExp) return this.data.accessToken;
    const tok = await this._tokenRequest({ refresh_token: this.data.refreshToken, grant_type: "refresh_token" });
    this._setAccess(tok);
    this._save();
    return tok.access_token;
  }
  async get(base, pathQ) {
    const t = await this.token();
    const r = await net.fetch(base + pathQ, { headers: { Authorization: `Bearer ${t}` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(apiError(j, r.status));
    return j;
  }

  async fetchChannel() {
    const j = await this.get(E.api, "/channels?part=snippet,statistics,contentDetails&mine=true");
    const c = j.items && j.items[0];
    if (!c) throw new Error("Bu Google hesabında YouTube kanalı bulunamadı.");
    this.data.channel = {
      id: c.id,
      title: c.snippet.title,
      thumb: c.snippet.thumbnails && (c.snippet.thumbnails.default || {}).url,
      uploads: c.contentDetails && c.contentDetails.relatedPlaylists && c.contentDetails.relatedPlaylists.uploads,
    };
    this._save();
    return { ...this.data.channel, stats: c.statistics };
  }

  // Kanal özeti + son videolar + son 28 gün grafiği
  async stats() {
    const ch = await this.fetchChannel();
    let videos = [];
    if (ch.uploads) {
      const pl = await this.get(E.api, `/playlistItems?part=contentDetails&maxResults=50&playlistId=${encodeURIComponent(ch.uploads)}`);
      const ids = (pl.items || []).map((i) => i.contentDetails.videoId).filter(Boolean);
      if (ids.length) {
        const v = await this.get(E.api, `/videos?part=snippet,statistics,contentDetails,status&id=${ids.join(",")}`);
        videos = (v.items || []).map((x) => ({
          id: x.id,
          title: x.snippet.title,
          publishedAt: x.snippet.publishedAt,
          thumb: x.snippet.thumbnails && (x.snippet.thumbnails.medium || x.snippet.thumbnails.default || {}).url,
          duration: isoDur(x.contentDetails.duration),
          privacy: x.status && x.status.privacyStatus,
          views: +x.statistics.viewCount || 0,
          likes: +x.statistics.likeCount || 0,
          comments: +x.statistics.commentCount || 0,
        }));
      }
    }
    let daily = null, analyticsError = null;
    try {
      const end = new Date(Date.now() - 86400000);
      const start = new Date(end.getTime() - 27 * 86400000);
      const d = (x) => x.toISOString().slice(0, 10);
      const a = await this.get(E.analytics, `/reports?ids=channel==MINE&startDate=${d(start)}&endDate=${d(end)}&metrics=views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes&dimensions=day&sort=day`);
      daily = (a.rows || []).map((r) => ({ day: r[0], views: r[1], minutes: r[2], subsGained: r[3], subsLost: r[4], likes: r[5] }));
    } catch (e) {
      analyticsError = e.message;
    }
    const s = ch.stats || {};
    return {
      channel: { id: ch.id, title: ch.title, thumb: ch.thumb, subscribers: +s.subscriberCount || 0, hiddenSubs: !!s.hiddenSubscriberCount, views: +s.viewCount || 0, videos: +s.videoCount || 0 },
      videos,
      daily,
      analyticsError,
      fetchedAt: new Date().toISOString(),
    };
  }

  // Devam ettirilebilir (resumable) yükleme
  async upload(file, meta, onProgress) {
    const t = await this.token();
    const size = fs.statSync(file).size;
    const body = {
      snippet: { title: meta.title.slice(0, 100), description: (meta.description || "").slice(0, 5000), tags: meta.tags || [], categoryId: meta.categoryId || "20", defaultLanguage: "tr", defaultAudioLanguage: "tr" },
      status: { privacyStatus: meta.privacy || "private", selfDeclaredMadeForKids: false },
    };
    const init = await net.fetch(`${E.upload}/videos?uploadType=resumable&part=snippet,status`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": String(size), "X-Upload-Content-Type": "video/mp4" },
      body: JSON.stringify(body),
    });
    if (!init.ok) throw new Error(apiError(await init.json().catch(() => ({})), init.status));
    const loc = init.headers.get("location");
    if (!loc) throw new Error("YouTube yükleme adresi vermedi.");
    const CHUNK = 8 * 1024 * 1024;
    const fd = fs.openSync(file, "r");
    try {
      let offset = 0;
      for (;;) {
        const len = Math.min(CHUNK, size - offset);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, offset);
        const tk = await this.token();
        const r = await net.fetch(loc, {
          method: "PUT",
          headers: { Authorization: `Bearer ${tk}`, "Content-Range": `bytes ${offset}-${offset + len - 1}/${size}` },
          body: buf,
        });
        if (r.status === 308) {
          const range = r.headers.get("range");
          offset = range ? Number(range.split("-")[1]) + 1 : offset + len;
          onProgress && onProgress(offset / size);
          continue;
        }
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(apiError(j, r.status));
        onProgress && onProgress(1);
        return { id: j.id, url: `https://youtu.be/${j.id}`, privacy: j.status && j.status.privacyStatus, requested: body.status.privacyStatus };
      }
    } finally {
      fs.closeSync(fd);
    }
  }
}

function apiError(j, status) {
  const e = j && j.error;
  const reason = e && e.errors && e.errors[0] && e.errors[0].reason;
  if (reason === "quotaExceeded") return "YouTube günlük kotası doldu, yarın tekrar dene.";
  if (reason === "uploadLimitExceeded") return "YouTube yükleme sınırına ulaşıldı.";
  if (status === 401) return "YouTube oturumu geçersiz, Ayarlar'dan tekrar bağlan.";
  if (status === 403 && /has not been used|disabled/i.test((e && e.message) || "")) return "Google Cloud projesinde gerekli API açık değil: " + e.message;
  return "YouTube: " + ((e && e.message) || status);
}

function isoDur(s) {
  const m = String(s || "").match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

module.exports = { YouTube, isoDur };
