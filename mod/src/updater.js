// Otomatik güncelleme (Yusiraen Mod): GitHub'daki en son mod-v sürümünü kontrol eder, indirir ve sessizce kurar.
const { app, net } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const REPO = "Snowy2729/yusiraen-clipper";
// Yusiraen Mod sürümleri aynı depoda "mod-v1.2.3" etiketiyle yayınlanır
const TAG_PREFIX = "mod-v";
const LIST_URL = process.env.UPDATE_URL || `https://api.github.com/repos/${REPO}/releases?per_page=30`;

function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map((n) => parseInt(n) || 0);
  const pb = String(b).replace(/^v/, "").split(".").map((n) => parseInt(n) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

async function check() {
  const r = await net.fetch(LIST_URL, { headers: { Accept: "application/vnd.github+json", "User-Agent": "YusiraenMod" } });
  if (!r.ok) throw new Error("GitHub yanıtı: " + r.status);
  const list = await r.json();
  const j = (Array.isArray(list) ? list : []).find((x) => !x.draft && !x.prerelease && String(x.tag_name || "").startsWith(TAG_PREFIX));
  if (!j) return { available: false, current: app.getVersion(), noRelease: true };
  const latest = String(j.tag_name).slice(TAG_PREFIX.length);
  const asset = (j.assets || []).find((a) => /\.exe$/i.test(a.name));
  const current = app.getVersion();
  if (!latest || !asset || cmpVersion(latest, current) <= 0) return { available: false, current, latest };
  return { available: true, current, version: latest, notes: j.body || "", url: asset.browser_download_url, size: asset.size };
}

async function download(info, onProgress) {
  const file = path.join(os.tmpdir(), `YusiraenMod-Guncelleme-${info.version}.exe`);
  const r = await net.fetch(info.url, { headers: { "User-Agent": "YusiraenMod" } });
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
