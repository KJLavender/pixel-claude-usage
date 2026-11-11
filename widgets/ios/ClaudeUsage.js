// Claude Usage — home screen widget for Scriptable (iOS).
// 1. Install "Scriptable" from the App Store, add a new script, paste this file in.
// 2. Put your panel address below (the same link the QR code opens), or long-press the
//    widget → Edit Widget → Parameter and paste it there instead.
// 3. Add a Scriptable widget to your home screen and pick this script.

const PANEL_URL = "http://192.168.0.16:8790/?k=YOUR_KEY";

// ---------------------------------------------------------------------------
const C = {
  bg: new Color("#14121f"), panel: new Color("#1f1b30"), ink: new Color("#f2ead8"),
  dim: new Color("#8d86a8"), empty: new Color("#2b2643"), accent: new Color("#d97757"),
  ok: new Color("#7bd88f"), warn: new Color("#ffcb57"), bad: new Color("#ff6b6b"),
};
const pctColor = (p) => (p >= 80 ? C.bad : p >= 50 ? C.warn : C.ok);
const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), "claude-usage-cache.json");

function parsePanel(raw) {
  const m = (raw || "").trim().match(/^(https?:\/\/[^/?#]+)[^?#]*(?:\?[^#]*?\bk=([^&#]+))?/);
  if (!m) return null;
  return { base: m[1], key: m[2] ? decodeURIComponent(m[2]) : "", panel: raw.trim() };
}

async function getData(cfg) {
  try {
    const req = new Request(`${cfg.base}/api/usage?k=${encodeURIComponent(cfg.key)}`);
    req.timeoutInterval = 10;
    const d = await req.loadJSON();
    if (d.fiveHour || d.sevenDay) {
      fm.writeString(cachePath, JSON.stringify(d));
      return { d, stale: false, error: d.error };
    }
    throw new Error(d.error || "no data");
  } catch (e) {
    const old = fm.fileExists(cachePath) ? JSON.parse(fm.readString(cachePath)) : null;
    return { d: old, stale: true, error: "連不到電腦" };
  }
}

// Once the reset time passes the window is back to 0%, even with old data.
const isReset = (w) => w && w.resetsAt && new Date(w.resetsAt) <= new Date();
const livePct = (w) => (!w ? null : isReset(w) ? 0 : w.percent);

function countdown(iso) {
  if (!iso) return "--";
  let s = Math.max(0, (new Date(iso) - new Date()) / 1000);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  return d ? `${d}天${h}時` : h ? `${h}時${m}分` : `${m}分`;
}

// Pixel bar drawn as an image: n blocks with small gaps.
function barImage(pct, width, height, n) {
  const gap = 2;
  const ctx = new DrawContext();
  ctx.size = new Size(width, height);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const bw = (width - gap * (n - 1)) / n;
  const filled = Math.round((Math.min(100, pct) / 100) * n);
  for (let i = 0; i < n; i++) {
    ctx.setFillColor(i < filled ? pctColor(pct) : C.empty);
    ctx.fillRect(new Rect(Math.round(i * (bw + gap)), 0, Math.ceil(bw), height));
  }
  return ctx.getImage();
}

function addWindow(w, label, win, size) {
  const small = size === "small";
  const box = w.addStack();
  box.layoutVertically();
  const top = box.addStack();
  top.centerAlignContent();
  const l = top.addText(label);
  l.font = Font.boldMonospacedSystemFont(small ? 10 : 11);
  l.textColor = C.dim;
  top.addSpacer();
  const p = livePct(win);
  const t = top.addText(p == null ? "--%" : `${p}%`);
  t.font = Font.heavyMonospacedSystemFont(small ? 18 : 20);
  t.textColor = p == null ? C.dim : pctColor(p);
  box.addSpacer(3);
  const barW = small ? 130 : 290;
  const img = box.addImage(barImage(p || 0, barW, small ? 7 : 8, small ? 14 : 24));
  img.imageSize = new Size(barW, small ? 7 : 8);
  box.addSpacer(3);
  const r = box.addText(!win ? " " : isReset(win) ? "已重置" : `${countdown(win.resetsAt)}後重置 · 剩${100 - p}%`);
  r.font = Font.mediumMonospacedSystemFont(small ? 9 : 10);
  r.textColor = C.dim;
}

async function build() {
  const cfg = parsePanel(args.widgetParameter || PANEL_URL);
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(12, 14, 12, 14);
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  const size = config.widgetFamily || "medium";

  if (!cfg || cfg.key === "YOUR_KEY") {
    const t = w.addText("請先在腳本裡填上面板網址");
    t.textColor = C.warn; t.font = Font.mediumSystemFont(12);
    return w;
  }
  w.url = cfg.panel; // tapping the widget opens the full panel

  const { d, stale, error } = await getData(cfg);

  const head = w.addStack();
  head.centerAlignContent();
  const title = head.addText("■ CLAUDE");
  title.font = Font.heavyMonospacedSystemFont(size === "small" ? 10 : 11);
  title.textColor = C.accent;
  head.addSpacer();
  if (d && d.plan && size !== "small") {
    const plan = head.addText(d.plan.toUpperCase());
    plan.font = Font.boldMonospacedSystemFont(9);
    plan.textColor = C.dim;
  }
  w.addSpacer(8);

  addWindow(w, "5H", d && d.fiveHour, size);
  w.addSpacer(8);
  addWindow(w, "WEEK", d && d.sevenDay, size);
  w.addSpacer();

  const foot = w.addText(
    stale || error ? `⚠ ${error || "資料可能過時"}` : `更新 ${new Date().toTimeString().slice(0, 5)}`
  );
  foot.font = Font.mediumMonospacedSystemFont(8);
  foot.textColor = stale || error ? C.warn : C.dim;
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
