// Kick hesabıyla giriş (OAuth 2.1 + PKCE). Sadece kimlik doğrulama için: kullanıcının kanalda moderatör olduğunu kontrol ederiz.
const { net, shell, safeStorage } = require("electron");
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const E = {
  auth: process.env.KICK_AUTH_URL || "https://id.kick.com/oauth/authorize",
  token: process.env.KICK_TOKEN_URL || "https://id.kick.com/oauth/token",
  revoke: process.env.KICK_REVOKE_URL || "https://id.kick.com/oauth/revoke",
  api: process.env.KICK_API_BASE || "https://api.kick.com/public/v1",
};
const PORT = Number(process.env.KICK_REDIRECT_PORT) || 53682;
const REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPES = ["user:read"];

class KickAuth {
  constructor(root) {
    this.file = path.join(root, "kick-hesap.json");
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
    fs.writeFileSync(this.file, JSON.stringify(safeStorage.isEncryptionAvailable() ? { enc: safeStorage.encryptString(s).toString("base64") } : { plain: this.data }));
  }
  setClient(clientId, clientSecret) {
    const changed = (clientId || "").trim() !== this.data.clientId;
    this.data.clientId = (clientId || "").trim();
    if (clientSecret) this.data.clientSecret = clientSecret.trim();
    if (changed) {
      delete this.data.refreshToken;
      delete this.data.accessToken;
      delete this.data.me;
    }
    this._save();
  }
  // Diğer modlarla paylaşmak için: uygulama bilgilerini tek bir kod halinde ver / al
  exportCode() {
    if (!this.data.clientId || !this.data.clientSecret) return null;
    return "YMOD-" + Buffer.from(JSON.stringify({ c: this.data.clientId, s: this.data.clientSecret })).toString("base64url");
  }
  importCode(code) {
    const m = String(code || "").trim().match(/^YMOD-([A-Za-z0-9_-]+)$/);
    if (!m) throw new Error("Geçersiz ekip kodu.");
    const j = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
    if (!j.c || !j.s) throw new Error("Geçersiz ekip kodu.");
    this.setClient(j.c, j.s);
  }
  status() {
    return { hasClient: !!(this.data.clientId && this.data.clientSecret), clientId: this.data.clientId || "", loggedIn: !!this.data.refreshToken, me: this.data.me || null, redirect: REDIRECT, scopes: SCOPES };
  }

  login() {
    if (!this.data.clientId || !this.data.clientSecret) return Promise.reject(new Error("Önce Ayarlar'dan Kick uygulama bilgilerini (ya da ekip kodunu) gir."));
    const verifier = crypto.randomBytes(48).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const state = crypto.randomBytes(16).toString("hex");
    return new Promise((resolve, reject) => {
      const page = (msg) => `<!doctype html><meta charset="utf-8"><body style="background:#0a0a0a;color:#eee;font-family:Segoe UI,sans-serif;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#c22">Yusiraen Mod</h2><p>${msg}</p></div></body>`;
      const server = http.createServer(async (req, res) => {
        const u = new URL(req.url, `http://localhost:${PORT}`);
        if (u.pathname !== "/callback") {
          res.writeHead(404);
          return res.end();
        }
        const done = (ok, msg) => {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(page(msg));
          server.close();
          clearTimeout(timer);
        };
        const code = u.searchParams.get("code");
        if (!code || u.searchParams.get("state") !== state) {
          done(false, "Giriş iptal edildi ya da başarısız oldu. Bu sekmeyi kapatabilirsin.");
          return reject(new Error(u.searchParams.get("error") === "access_denied" ? "İzin verilmedi." : "Kick girişi başarısız oldu."));
        }
        try {
          const tok = await this._token({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT });
          this.data.refreshToken = tok.refresh_token;
          this._setAccess(tok);
          this._save();
          await this.fetchMe();
          done(true, "✅ Kick hesabınla giriş yapıldı. Uygulamaya dönebilirsin.");
          resolve(this.status());
        } catch (e) {
          done(false, "Giriş sırasında hata: " + String(e.message).replace(/</g, "&lt;"));
          reject(e);
        }
      });
      const timer = setTimeout(() => {
        server.close();
        reject(new Error("Zaman aşımı: 5 dakika içinde giriş yapılmadı."));
      }, 5 * 60 * 1000);
      server.on("error", (e) => reject(new Error(e.code === "EADDRINUSE" ? `Giriş için ${PORT} portu kullanımda. Uygulamayı kapatıp açmayı dene.` : e.message)));
      server.listen(PORT, "127.0.0.1", () => {
        const q = new URLSearchParams({ response_type: "code", client_id: this.data.clientId, redirect_uri: REDIRECT, scope: SCOPES.join(" "), code_challenge: challenge, code_challenge_method: "S256", state });
        const url = `${E.auth}?${q}`;
        if (process.env.KICK_TEST_AUTOAUTH) net.fetch(url).catch(() => {});
        else shell.openExternal(url);
      });
    });
  }

  async logout() {
    const t = this.data.accessToken;
    if (t) net.fetch(`${E.revoke}?token=${encodeURIComponent(t)}&token_hint_type=access_token`, { method: "POST" }).catch(() => {});
    delete this.data.refreshToken;
    delete this.data.accessToken;
    delete this.data.me;
    this._save();
    return this.status();
  }

  async _token(params) {
    const body = new URLSearchParams({ client_id: this.data.clientId, client_secret: this.data.clientSecret, ...params });
    const r = await net.fetch(E.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: body.toString() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (params.grant_type === "refresh_token") {
        delete this.data.refreshToken;
        this._save();
        throw new Error("Kick oturumunun süresi doldu, tekrar giriş yap.");
      }
      throw new Error("Kick: " + (j.error_description || j.error || j.message || r.status));
    }
    return j;
  }
  _setAccess(tok) {
    this.data.accessToken = tok.access_token;
    this.data.accessExp = Date.now() + (tok.expires_in || 3600) * 1000 - 60000;
    if (tok.refresh_token) this.data.refreshToken = tok.refresh_token;
  }
  async token() {
    if (!this.data.refreshToken && !this.data.accessToken) throw new Error("Kick hesabıyla giriş yapılmadı.");
    if (this.data.accessToken && Date.now() < this.data.accessExp) return this.data.accessToken;
    const tok = await this._token({ grant_type: "refresh_token", refresh_token: this.data.refreshToken });
    this._setAccess(tok);
    this._save();
    return this.data.accessToken;
  }
  async api(method, p, body) {
    const t = await this.token();
    const r = await net.fetch(E.api + p, {
      method,
      headers: { Authorization: `Bearer ${t}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await r.text();
    let j = {};
    try {
      j = txt ? JSON.parse(txt) : {};
    } catch (_) {}
    if (!r.ok) {
      const msg = j.message || j.error || txt.slice(0, 120) || r.status;
      if (r.status === 401) throw new Error("Kick oturumu geçersiz, tekrar giriş yap.");
      throw new Error("Kick: " + msg);
    }
    return j;
  }
  async fetchMe() {
    const j = await this.api("GET", "/users");
    const me = (j.data && j.data[0]) || j.data || {};
    this.data.me = { id: me.user_id || me.id, name: me.name || me.username, avatar: me.profile_picture || null };
    this._save();
    return this.data.me;
  }
}

module.exports = { KickAuth, REDIRECT, SCOPES };
