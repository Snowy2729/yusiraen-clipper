// Kick sohbetini Pusher WebSocket üzerinden dinler.
const { EventEmitter } = require("events");
const WS = typeof WebSocket !== "undefined" ? WebSocket : require("ws");

class Recorder extends EventEmitter {
  constructor({ chatroomId, channelId, pusherKey, pusherCluster }) {
    super();
    this.chatroomId = chatroomId;
    this.channelId = channelId;
    this.setKey(pusherKey, pusherCluster);
    this.stopped = false;
    this.retry = 2000;
    this.seen = new Set();
  }

  setKey(key, cluster) {
    this.url = process.env.PUSHER_URL
      ? process.env.PUSHER_URL.replace("{key}", key)
      : `wss://ws-${cluster}.pusher.com/app/${key}?protocol=7&client=js&version=8.4.0&flash=false`;
  }

  start() {
    this.stopped = false;
    this._connect();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.ping);
    try {
      this.ws && this.ws.close();
    } catch (_) {}
  }

  _connect() {
    const ws = new WS(this.url);
    this.ws = ws;
    ws.onopen = () => this.emit("status", "connected");
    ws.onmessage = (ev) => this._onMessage(ev.data);
    ws.onclose = () => {
      clearInterval(this.ping);
      if (this.stopped) return;
      this.emit("status", "reconnecting");
      setTimeout(() => !this.stopped && this._connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 30000);
    };
    ws.onerror = () => {};
  }

  _send(o) {
    try {
      this.ws.send(JSON.stringify(o));
    } catch (_) {}
  }

  _onMessage(raw) {
    let p;
    try {
      p = JSON.parse(typeof raw === "string" ? raw : raw.toString());
    } catch (_) {
      return;
    }
    if (p.event === "pusher:connection_established") {
      this.retry = 2000;
      const chans = [`chatrooms.${this.chatroomId}.v2`, `chatroom_${this.chatroomId}`];
      if (this.channelId) chans.push(`channel.${this.channelId}`);
      for (const c of chans) this._send({ event: "pusher:subscribe", data: { auth: "", channel: c } });
      clearInterval(this.ping);
      this.ping = setInterval(() => this._send({ event: "pusher:ping", data: {} }), 60000);
      return;
    }
    if (p.event === "pusher:ping") return this._send({ event: "pusher:pong", data: {} });
    if (p.event === "pusher:error") {
      let d = p.data;
      if (typeof d === "string") { try { d = JSON.parse(d); } catch (_) {} }
      const code = d && d.code;
      if (code === 4001 || code === 4003 || code === 4004) {
        // Anahtar geçersiz: dışarıya haber ver, yeni anahtarla yeniden bağlanılacak
        this.stopped = true;
        try { this.ws.close(); } catch (_) {}
        this.emit("keyError", d);
      }
      return;
    }
    if (p.event === "pusher_internal:subscription_succeeded") {
      if (String(p.channel).startsWith("chatrooms.")) this.emit("status", "listening");
      return;
    }
    let d = p.data;
    if (typeof d === "string") {
      try {
        d = JSON.parse(d);
      } catch (_) {}
    }
    if (p.event === "App\\Events\\ChatMessageEvent" && d && d.content !== undefined) {
      if (d.id) {
        if (this.seen.has(d.id)) return;
        this.seen.add(d.id);
        if (this.seen.size > 5000) this.seen.delete(this.seen.values().next().value);
      }
      const t = Date.parse(d.created_at) || Date.now();
      this.emit("message", { t, u: (d.sender && d.sender.username) || "?", m: String(d.content) });
    } else if (p.event === "App\\Events\\StopStreamBroadcast") {
      this.emit("streamEnded");
    } else if (p.event === "App\\Events\\StreamerIsLive") {
      this.emit("streamStarted", d && d.livestream);
    }
  }
}

module.exports = { Recorder };
