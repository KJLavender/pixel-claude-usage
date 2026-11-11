// Pixel Claude Usage — a tiny server that shows your Claude plan usage on your phone.
// No dependencies. Run: node server.mjs
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const CONFIG_FILE = path.join(ROOT, "config.json");
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const MIN_FETCH_INTERVAL_MS = 60_000; // never hit the API more than once a minute

// ---------- config ----------
function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch {}
  let changed = false;
  if (!cfg.key) { cfg.key = crypto.randomBytes(12).toString("base64url"); changed = true; }
  if (!cfg.port) { cfg.port = 8790; changed = true; }
  if (changed) fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  return cfg;
}
const config = loadConfig();
const PORT = Number(process.env.PORT || config.port);
const KEY = process.env.USAGE_KEY || config.key;

// ---------- credentials ----------
// Claude Code keeps its login in <config dir>/.credentials.json. Several config dirs may
// exist (e.g. a launcher profile plus ~/.claude); use the freshest unexpired token.
function credentialCandidates() {
  const dirs = new Set();
  if (process.env.CLAUDE_CONFIG_DIR) dirs.add(process.env.CLAUDE_CONFIG_DIR);
  dirs.add(path.join(os.homedir(), ".claude"));
  for (const d of config.extraConfigDirs || []) dirs.add(d);
  // Orca launcher profiles (Windows)
  const orca = path.join(process.env.APPDATA || "", "orca", "claude-profiles");
  try {
    for (const p of fs.readdirSync(orca)) dirs.add(path.join(orca, p, "home"));
  } catch {}
  return [...dirs].map((d) => path.join(d, ".credentials.json"));
}

function readToken() {
  let best = null;
  for (const file of credentialCandidates()) {
    try {
      const o = JSON.parse(fs.readFileSync(file, "utf8")).claudeAiOauth;
      if (!o?.accessToken) continue;
      if (!best || (o.expiresAt || 0) > (best.expiresAt || 0)) best = { ...o, file };
    } catch {}
  }
  return best;
}

// ---------- remote usage ----------
let cache = { data: null, fetchedAt: 0, error: null };

async function fetchUsage(force = false) {
  if (!force && Date.now() - cache.fetchedAt < MIN_FETCH_INTERVAL_MS) return cache;
  const tok = readToken();
  if (!tok) {
    cache = { ...cache, error: "找不到 Claude Code 登入資料 / No Claude Code login found", fetchedAt: Date.now() };
    return cache;
  }
  if (tok.expiresAt && tok.expiresAt < Date.now()) {
    cache = { ...cache, error: "登入憑證過期，開一下 Claude Code 就會更新 / Token expired — open Claude Code once to refresh it", fetchedAt: Date.now() };
    return cache;
  }
  try {
    const r = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${tok.accessToken}`, "anthropic-beta": "oauth-2025-04-20" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const raw = await r.json();
    cache = { data: shapeUsage(raw, tok), fetchedAt: Date.now(), error: null };
  } catch (e) {
    cache = { ...cache, error: `讀取失敗 / Fetch failed: ${e.message}`, fetchedAt: Date.now() };
  }
  return cache;
}

function shapeUsage(raw, tok) {
  const win = (w) => (w ? { percent: Math.round(w.utilization ?? 0), resetsAt: w.resets_at } : null);
  const limits = (raw.limits || []).map((l) => ({
    kind: l.kind,
    label:
      l.kind === "session" ? "5H SESSION" :
      l.kind === "weekly_all" ? "WEEKLY" :
      `WEEKLY ${(l.scope?.model?.display_name || l.scope?.surface || "").toUpperCase()}`.trim(),
    percent: Math.round(l.percent ?? 0),
    severity: l.severity,
    resetsAt: l.resets_at,
  }));
  return {
    plan: tok.subscriptionType || null,
    fiveHour: win(raw.five_hour),
    sevenDay: win(raw.seven_day),
    limits,
    breakdown: raw.seven_day_breakdown?.rows?.map((r) => ({ name: r.display_name, percent: r.percent })) || [],
    extraUsage: raw.extra_usage?.is_enabled ? raw.extra_usage : null,
  };
}

// ---------- local token stats (today, from Claude Code transcripts) ----------
let localCache = { at: 0, data: null };

function localStats() {
  if (Date.now() - localCache.at < 60_000 && localCache.data) return localCache.data;
  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const since = start.getTime();
  const seen = new Set();
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, messages: 0 };
  const byModel = {};
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith(".jsonl")) {
        let st; try { st = fs.statSync(p); } catch { continue; }
        if (st.mtimeMs < since) continue;
        let text; try { text = fs.readFileSync(p, "utf8"); } catch { continue; }
        for (const line of text.split("\n")) {
          if (!line.includes('"usage"')) continue;
          let j; try { j = JSON.parse(line); } catch { continue; }
          const u = j.message?.usage;
          if (!u || !j.timestamp || Date.parse(j.timestamp) < since) continue;
          const id = `${j.message.id}:${j.requestId}`; // same reply is logged once per content block
          if (seen.has(id)) continue;
          seen.add(id);
          totals.input += u.input_tokens || 0;
          totals.output += u.output_tokens || 0;
          totals.cacheRead += u.cache_read_input_tokens || 0;
          totals.cacheWrite += u.cache_creation_input_tokens || 0;
          totals.messages++;
          const m = (j.message.model || "unknown").replace(/^claude-/, "").replace(/-\d{8}$/, "");
          byModel[m] = (byModel[m] || 0) + (u.output_tokens || 0);
        }
      }
    }
  };
  walk(projectsDir, 0);
  localCache = { at: Date.now(), data: { today: totals, outputByModel: byModel } };
  return localCache.data;
}

// ---------- http ----------
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json", ".png": "image/png",
};

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
}

function authorized(req, url) {
  if (url.searchParams.get("k") === KEY) return true;
  const cookie = req.headers.cookie || "";
  return cookie.split(/;\s*/).includes(`k=${KEY}`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const isLocal = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);

  if (url.pathname === "/pair" && isLocal) {
    const urls = lanAddresses().map((ip) => `http://${ip}:${PORT}/?k=${KEY}`);
    res.writeHead(200, { "Content-Type": TYPES[".html"] });
    return res.end(pairPage(urls));
  }

  // The installed app may not share cookies with the browser (iOS), so bake the key
  // into start_url when the request already proves it knows the key.
  if (url.pathname === "/manifest.webmanifest") {
    const m = JSON.parse(fs.readFileSync(path.join(PUBLIC, "manifest.webmanifest"), "utf8"));
    if (authorized(req, url)) m.start_url = `./?k=${KEY}`;
    res.writeHead(200, { "Content-Type": TYPES[".webmanifest"], "Cache-Control": "no-cache" });
    return res.end(JSON.stringify(m));
  }

  // static files that don't need the key (icon, service worker)
  const openFiles = ["/icon.svg", "/sw.js"];
  if (!openFiles.includes(url.pathname) && !authorized(req, url)) {
    res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("需要金鑰。請在電腦上開 http://localhost:" + PORT + "/pair 掃 QR code。\nKey required. Open /pair on the PC and scan the QR code.");
  }
  const setCookie = url.searchParams.get("k") === KEY
    ? { "Set-Cookie": `k=${KEY}; Max-Age=31536000; Path=/; SameSite=Lax; HttpOnly` } : {};

  if (url.pathname === "/api/usage") {
    const c = await fetchUsage(url.searchParams.get("force") === "1");
    let local = null;
    try { local = localStats(); } catch {}
    res.writeHead(200, { "Content-Type": TYPES[".json"], "Cache-Control": "no-store", ...setCookie });
    return res.end(JSON.stringify({ ...c.data, local, fetchedAt: c.fetchedAt, error: c.error }));
  }

  const file = path.normalize(path.join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache", ...setCookie });
    res.end(buf);
  });
});

function pairPage(urls) {
  const list = urls.map((u) => `<div class="u"><div class="qr" data-u="${u}"></div><code>${u}</code></div>`).join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pair phone</title>
<style>body{font-family:system-ui;background:#111;color:#eee;padding:24px;text-align:center}.u{margin:24px auto}.qr{background:#fff;display:inline-block;padding:12px}code{display:block;margin-top:8px;word-break:break-all}</style>
<h2>用手機掃描 / Scan with your phone</h2><p>手機要跟這台電腦在同一個 Wi-Fi。<br>Phone must be on the same Wi-Fi as this PC.</p>${list || "<p>找不到區網 IP / No LAN IP found</p>"}
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>document.querySelectorAll('.qr').forEach(el=>new QRCode(el,{text:el.dataset.u,width:220,height:220}))</script>`;
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Pixel Claude Usage running on port ${PORT}`);
  console.log(`  This PC:  http://localhost:${PORT}/?k=${KEY}`);
  for (const ip of lanAddresses()) console.log(`  Phone:    http://${ip}:${PORT}/?k=${KEY}`);
  console.log(`  QR code:  http://localhost:${PORT}/pair`);
  fetchUsage(true).then((c) => console.log(c.error ? `  ! ${c.error}` : "  Usage API OK"));
});
