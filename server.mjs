// Pixel Claude Usage — a tiny server that shows your Claude plan usage on your phone.
// No dependencies. Run: node server.mjs
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const CONFIG_FILE = path.join(ROOT, "config.json");
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const MIN_FETCH_INTERVAL_MS = 60_000; // never hit the API more than once a minute
const REFRESH_COOLDOWN_MS = 20 * 60_000; // at most one token refresh attempt per 20 minutes
const REFRESH_EARLY_MS = 5 * 60_000; // refresh a little before the token actually expires

// ---------- config ----------
const newKey = () => crypto.randomBytes(12).toString("base64url");

function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch {}
  let changed = false;
  if (!cfg.key) { cfg.key = newKey(); changed = true; }
  if (!cfg.port) { cfg.port = 8790; changed = true; }
  if (!Array.isArray(cfg.accounts)) cfg.accounts = [];
  if (changed) saveConfig(cfg);
  return cfg;
}
function saveConfig(cfg) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)); }

let config = loadConfig();
let configMtime = 0;
const PORT = Number(process.env.PORT || config.port);

// Re-read config.json when it changes, so "add-account" works while the server is running.
function currentConfig() {
  try {
    const m = fs.statSync(CONFIG_FILE).mtimeMs;
    if (m !== configMtime) { configMtime = m; config = loadConfig(); }
  } catch {}
  return config;
}

// ---------- accounts ----------
// "me" is the owner of this computer: its login is found automatically.
// Other accounts (friends) each have their own Claude Code config folder under accounts/<name>,
// their own key, and can only see their own numbers.
function accounts() {
  const cfg = currentConfig();
  return [
    { name: "me", key: process.env.USAGE_KEY || cfg.key, configDir: null },
    ...cfg.accounts.map((a) => ({ ...a, configDir: path.resolve(ROOT, a.configDir) })),
  ];
}
const accountByKey = (key) => (key ? accounts().find((a) => a.key === key) : null);

// ---------- credentials ----------
// Claude Code keeps its login in <config dir>/.credentials.json. Several config dirs may
// exist (e.g. a launcher profile plus ~/.claude); use the freshest unexpired token.
function credentialCandidates(account) {
  if (account.configDir) return [path.join(account.configDir, ".credentials.json")];
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

function readToken(account) {
  let best = null;
  for (const file of credentialCandidates(account)) {
    try {
      const o = JSON.parse(fs.readFileSync(file, "utf8")).claudeAiOauth;
      if (!o?.accessToken) continue;
      // a login without a refresh token is dead once it expires; prefer ones that can renew
      const score = (t) => (t.refreshToken ? 1e15 : 0) + (t.expiresAt || 0);
      if (!best || score(o) > score(best)) best = { ...o, file };
    } catch {}
  }
  return best;
}

// ---------- token refresh ----------
// The access token only lives a few hours. Claude Code renews it whenever it runs, so when
// it's about to expire we run Claude Code once with a one-word Haiku prompt. Claude Code
// itself does the renewal and writes the new login back, so we never touch the refresh
// token ourselves (doing that could race with Claude Code and log you out).
// Costs a tiny bit of usage a few times a day. Turn off with "autoRefresh": false.
const states = new Map(); // account name -> { cache, lastRefreshAttempt, tokenRejected }
function stateOf(account) {
  if (!states.has(account.name)) {
    states.set(account.name, { cache: { data: null, fetchedAt: 0, error: null }, lastRefreshAttempt: 0, tokenRejected: false });
  }
  return states.get(account.name);
}

// Environment for running Claude Code against one config folder.
function claudeEnv(dir) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("CLAUDECODE") || k.startsWith("CLAUDE_CODE_")) delete env[k];
  // ~/.claude is Claude Code's default; pointing CLAUDE_CONFIG_DIR at it makes it look for
  // .claude.json in the wrong place, so leave the variable unset in that case.
  if (path.resolve(dir) === path.resolve(os.homedir(), ".claude")) delete env.CLAUDE_CONFIG_DIR;
  else env.CLAUDE_CONFIG_DIR = dir;
  return env;
}

function refreshViaClaudeCode(account, tok) {
  const st = stateOf(account);
  if (currentConfig().autoRefresh === false) return Promise.resolve(false);
  if (Date.now() - st.lastRefreshAttempt < REFRESH_COOLDOWN_MS) return Promise.resolve(false);
  st.lastRefreshAttempt = Date.now();
  const dir = path.dirname(tok.file);
  const env = claudeEnv(dir);
  const args = ["-p", "--model", "haiku", "--output-format", "json", "--tools", "",
    "--setting-sources", "", "--no-session-persistence", "--system-prompt", "Reply with 1"];
  console.log(`[${new Date().toLocaleString()}] [${account.name}] token expiring, asking Claude Code to renew it`);
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(currentConfig().claudePath || "claude", args, { env, cwd: os.tmpdir(), windowsHide: true });
    const timer = setTimeout(() => child.kill(), 90_000);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", (e) => { clearTimeout(timer); console.log("  ! could not run claude:", e.message); resolve(false); });
    child.on("close", () => {
      clearTimeout(timer);
      let ok = false;
      try { const j = JSON.parse(out); ok = !j.is_error; if (!ok) console.log("  !", j.result); } catch {}
      if (ok) console.log("  token renewed");
      resolve(ok);
    });
    child.stdin.end("1");
  });
}

// ---------- remote usage ----------
async function fetchUsage(account, force = false) {
  const st = stateOf(account);
  if (!force && Date.now() - st.cache.fetchedAt < MIN_FETCH_INTERVAL_MS) return st.cache;
  const fail = (error) => (st.cache = { ...st.cache, error, fetchedAt: Date.now() });
  let tok = readToken(account);
  if (tok && (st.tokenRejected || (tok.expiresAt && tok.expiresAt - REFRESH_EARLY_MS < Date.now()))) {
    if (await refreshViaClaudeCode(account, tok)) { tok = readToken(account); st.tokenRejected = false; }
  }
  if (!tok) return fail("找不到 Claude Code 登入資料 / No Claude Code login found");
  if (st.tokenRejected || (tok.expiresAt && tok.expiresAt < Date.now())) {
    return fail(account.configDir
      ? "登入憑證失效，請電腦主人重新幫你登入 / Login expired — ask the host to log you in again"
      : "登入憑證過期且自動更新失敗，請在電腦上開一次 Claude Code / Token expired and auto-renew failed — open Claude Code once");
  }
  try {
    const r = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${tok.accessToken}`, "anthropic-beta": "oauth-2025-04-20" },
      signal: AbortSignal.timeout(10_000),
    });
    if (r.status === 401) { st.tokenRejected = true; st.lastRefreshAttempt = 0; } // revoked early: renew next round
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const raw = await r.json();
    st.cache = { data: shapeUsage(raw, tok), fetchedAt: Date.now(), error: null };
  } catch (e) {
    fail(`讀取失敗 / Fetch failed: ${e.message}`);
  }
  return st.cache;
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
const localCaches = new Map();

function localStats(account) {
  const hit = localCaches.get(account.name);
  if (hit && Date.now() - hit.at < 60_000) return hit.data;
  const projectsDir = path.join(account.configDir || path.join(os.homedir(), ".claude"), "projects");
  if (!fs.existsSync(projectsDir)) return null;
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
  const data = { today: totals, outputByModel: byModel };
  localCaches.set(account.name, { at: Date.now(), data });
  return data;
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

// Which account a request belongs to: the key in the URL, else the key in the cookie.
function requestAccount(req, url) {
  const fromUrl = accountByKey(url.searchParams.get("k"));
  if (fromUrl) return fromUrl;
  const c = (req.headers.cookie || "").split(/;\s*/).find((p) => p.startsWith("k="));
  return accountByKey(c && decodeURIComponent(c.slice(2)));
}

const urlsFor = (account) => lanAddresses().map((ip) => `http://${ip}:${PORT}/?k=${account.key}`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const isLocal = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);

  if (url.pathname === "/pair" && isLocal) {
    res.writeHead(200, { "Content-Type": TYPES[".html"] });
    return res.end(pairPage(accounts()));
  }

  const account = requestAccount(req, url);

  // The installed app may not share cookies with the browser (iOS), so bake the key
  // into start_url when the request already proves it knows the key.
  if (url.pathname === "/manifest.webmanifest") {
    const m = JSON.parse(fs.readFileSync(path.join(PUBLIC, "manifest.webmanifest"), "utf8"));
    if (account) m.start_url = `./?k=${account.key}`;
    res.writeHead(200, { "Content-Type": TYPES[".webmanifest"], "Cache-Control": "no-cache" });
    return res.end(JSON.stringify(m));
  }

  // static files that don't need the key (icon, service worker)
  const openFiles = ["/icon.svg", "/sw.js"];
  if (!openFiles.includes(url.pathname) && !account) {
    res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("需要金鑰。請在電腦上開 http://localhost:" + PORT + "/pair 掃 QR code。\nKey required. Open /pair on the PC and scan the QR code.");
  }
  const setCookie = account && url.searchParams.get("k") === account.key
    ? { "Set-Cookie": `k=${account.key}; Max-Age=31536000; Path=/; SameSite=Lax; HttpOnly` } : {};

  // iPhone widget script with this person's panel address already filled in,
  // so it can be copied straight into Scriptable.
  if (url.pathname === "/widget.js") {
    let js;
    try { js = fs.readFileSync(path.join(ROOT, "widgets", "ios", "ClaudeUsage.js"), "utf8"); }
    catch { res.writeHead(404); return res.end("not found"); }
    js = js.replace(/^const PANEL_URL = .*$/m, `const PANEL_URL = "http://${req.headers.host}/?k=${account.key}";`);
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(js);
  }

  if (url.pathname === "/api/usage") {
    const c = await fetchUsage(account, url.searchParams.get("force") === "1");
    let local = null;
    try { local = localStats(account); } catch {}
    res.writeHead(200, { "Content-Type": TYPES[".json"], "Cache-Control": "no-store", ...setCookie });
    return res.end(JSON.stringify({ ...c.data, account: account.name, local, fetchedAt: c.fetchedAt, error: c.error }));
  }

  const file = path.normalize(path.join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache", ...setCookie });
    res.end(buf);
  });
});

function pairPage(accts) {
  const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  const list = accts.map((a) => `<h3>${esc(a.name === "me" ? "我 / me" : a.name)}</h3>` +
    urlsFor(a).map((u) => `<div class="u"><div class="qr" data-u="${esc(u)}"></div><code>${esc(u)}</code></div>`).join("")).join("<hr>");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pair phone</title>
<style>body{font-family:system-ui;background:#111;color:#eee;padding:24px;text-align:center}.u{margin:24px auto}.qr{background:#fff;display:inline-block;padding:12px}h3{margin-top:28px;color:#d97757}hr{border:0;border-top:1px solid #333;margin:28px 0}code{display:block;margin-top:8px;word-break:break-all}</style>
<h2>用手機掃描 / Scan with your phone</h2><p>手機要跟這台電腦在同一個 Wi-Fi（或用 Tailscale）。每個人只能掃自己的 QR code。<br>Phone must be on the same Wi-Fi as this PC (or use Tailscale). Each person scans only their own code.</p>${lanAddresses().length ? list : "<p>找不到區網 IP / No LAN IP found</p>"}
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>document.querySelectorAll('.qr').forEach(el=>new QRCode(el,{text:el.dataset.u,width:220,height:220}))</script>`;
}

function startServer() {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Pixel Claude Usage running on port ${PORT}`);
    console.log(`  QR codes: http://localhost:${PORT}/pair`);
    for (const a of accounts()) {
      console.log(`  [${a.name}] http://localhost:${PORT}/?k=${a.key}`);
      fetchUsage(a, true).then((c) => console.log(`  [${a.name}] ${c.error ? "! " + c.error : "usage API OK"}`));
    }
    // keep tokens fresh and numbers warm even when no phone is looking
    setInterval(() => { for (const a of accounts()) fetchUsage(a).catch(() => {}); }, 5 * 60_000);
  });
}

// ---------- account commands ----------
// node server.mjs add-account <name>     log a friend in and give them their own link
// node server.mjs remove-account <name>  log them out and delete their login from this PC
// node server.mjs list-accounts          show everyone's links
function runClaude(args, dir) {
  return new Promise((resolve) => {
    const child = spawn(currentConfig().claudePath || "claude", args, { env: claudeEnv(dir), stdio: "inherit" });
    child.on("error", (e) => { console.error("could not run claude:", e.message); resolve(1); });
    child.on("close", (code) => resolve(code));
  });
}

async function addAccount(name) {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(name || "") || name === "me") {
    console.error("用法 / usage: node server.mjs add-account <name>   (英數字、- 或 _，不能叫 me)");
    process.exit(1);
  }
  const cfg = currentConfig();
  if (cfg.accounts.some((a) => a.name === name)) { console.error(`已經有 ${name} 了 / ${name} already exists`); process.exit(1); }
  const rel = path.join("accounts", name);
  const dir = path.join(ROOT, rel);
  fs.mkdirSync(dir, { recursive: true });
  console.log(`請 ${name} 登入他自己的 Claude 帳號（跟著下面的指示做）。`);
  console.log(`Have ${name} log in to their own Claude account (follow the prompts below).\n`);
  await runClaude(["auth", "login"], dir);
  if (!fs.existsSync(path.join(dir, ".credentials.json"))) {
    console.error("\n沒有登入成功，沒有新增帳號。 / Login did not finish; account not added.");
    process.exit(1);
  }
  cfg.accounts.push({ name, key: newKey(), configDir: rel });
  saveConfig(cfg);
  const a = accounts().find((x) => x.name === name);
  console.log(`\n已新增 ${name}。把這個連結傳給他（只給他本人）：/ Added. Send this link to them only:`);
  for (const u of urlsFor(a)) console.log("  " + u);
  console.log(`伺服器在跑的話會自動讀到，不用重開。QR code 在 http://localhost:${PORT}/pair`);
}

async function removeAccount(name) {
  const cfg = currentConfig();
  const a = cfg.accounts.find((x) => x.name === name);
  if (!a) { console.error(`找不到 ${name} / no account named ${name}`); process.exit(1); }
  const dir = path.resolve(ROOT, a.configDir);
  await runClaude(["auth", "logout"], dir);
  cfg.accounts = cfg.accounts.filter((x) => x.name !== name);
  saveConfig(cfg);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`已移除 ${name}，他的登入資料已從這台電腦刪除。 / Removed ${name} and deleted their login from this PC.`);
}

function listAccounts() {
  for (const a of accounts()) {
    console.log(`${a.name}${a.configDir ? "" : " (this PC's owner)"}`);
    for (const u of urlsFor(a)) console.log("  " + u);
  }
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "add-account") addAccount(arg);
else if (cmd === "remove-account") removeAccount(arg);
else if (cmd === "list-accounts") listAccounts();
else if (cmd) { console.error("指令 / commands: add-account <name> | remove-account <name> | list-accounts"); process.exit(1); }
else startServer();
