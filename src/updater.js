// Otomatik güncelleme: GitHub'daki en son sürümü kontrol eder, indirir ve sessizce kurar.
const { app, net } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const REPO = "Snowy2729/yusiraen-clipper";
const LATEST_URL = process.env.UPDATE_URL || `https://api.github.com/repos/${REPO}/releases/latest`;

function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map((n) => parseInt(n) || 0);
  const pb = String(b).replace(/^v/, "").split(".").map((n) => parseInt(n) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

async function check() {
  const r = await net.fetch(LATEST_URL, { headers: { Accept: "application/vnd.github+json", "User-Agent": "YusiraenClipper" } });
  if (r.status === 404) return { available: false, current: app.getVersion(), noRelease: true };
  if (!r.ok) throw new Error("GitHub yanıtı: " + r.status);
  const j = await r.json();
  const latest = String(j.tag_name || "").replace(/^v/, "");
  const asset = (j.assets || []).find((a) => /\.exe$/i.test(a.name));
  const current = app.getVersion();
  if (!latest || !asset || cmpVersion(latest, current) <= 0) return { available: false, current, latest };
  return { available: true, current, version: latest, notes: j.body || "", url: asset.browser_download_url, size: asset.size };
}

async function download(info, onProgress) {
  const file = path.join(os.tmpdir(), `YusiraenClipper-Guncelleme-${info.version}.exe`);
  const r = await net.fetch(info.url, { headers: { "User-Agent": "YusiraenClipper" } });
  if (!r.ok || !r.body) throw new Error("İndirme başarısız: " + r.status);
  const total = Number(r.headers.get("content-length")) || info.size || 0;
  const out = fs.createWriteStream(file);
  const reader = r.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(Buffer.from(value))) await new Promise((res) => out.once("drain", res));
    if (onProgress && total) onProgress(got / total);
  }
  await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
  if (info.size && fs.statSync(file).size !== info.size) throw new Error("İndirilen dosya eksik, tekrar dene.");
  return file;
}

// Kurulumu sessiz başlatır; kurulum bitince uygulama kendiliğinden yeniden açılır.
function installAndQuit(file) {
  const child = spawn(file, ["/S"], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  setTimeout(() => app.quit(), 300);
}

module.exports = { check, download, installAndQuit, cmpVersion, REPO };
