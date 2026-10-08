#!/usr/bin/env node
/**
 * 墨池的實機示範影片：無頭 Edge 開真的頁面、真的連你的 ComfyUI 出一張圖，一邊截圖，最後用 ffmpeg 接成 mp4。
 *
 *   node scripts/record_demo.mjs [輸出.mp4] [伺服器，預設 http://127.0.0.1:8907] [--probe] [--keep 資料夾]
 *
 * 伺服器請另外開在一份乾淨的資料夾（用它自己的 data/），不要用你平常的：這支會真的按「生成」。
 * 等圖的那段時間會加速（畫面上看起來幾秒就好），其他動作照真實速度。
 * --probe：只跑到出圖、存幾張截圖看版面，不輸出影片。
 * 需要：ffmpeg 在 PATH 上；Edge 或 Chrome。
 */
import { spawn, spawnSync } from "child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";

const args = process.argv.slice(2);
const has = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};
const flag = (name, def) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const PROBE = has("--probe");
const KEEP = flag("--keep", "");
const SEED = flag("--seed", "");
const SCOUT = flag("--scout", ""); // 逗號分隔的種子：只出圖、把每張存起來挑，不輸出影片
const OUT = args[0] || join(homedir(), "Desktop", "mochi-demo.mp4");
const BASE = args[1] || "http://127.0.0.1:8907";
const W = 1440;
const H = 810;
const FPS = 30;

const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
const browser = BROWSERS.find((p) => existsSync(p));
if (!browser) throw new Error("找不到 Edge 或 Chrome");
if (spawnSync("ffmpeg", ["-version"]).status !== 0) throw new Error("找不到 ffmpeg（要在 PATH 上）");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const work = KEEP ? KEEP : mkdtempSync(join(tmpdir(), "mochi-demo-"));
mkdirSync(join(work, "frames"), { recursive: true });
const port = 9500 + Math.floor(Math.random() * 300);
const proc = spawn(browser, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${join(work, "profile")}`,
  `--window-size=${W},${H}`,
  "--hide-scrollbars",
  "--mute-audio",
  "--force-device-scale-factor=1",
  "about:blank",
], { stdio: "ignore" });

let target = null;
for (let i = 0; i < 120 && !target; i++) {
  await sleep(250);
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
  } catch {}
}
if (!target) throw new Error("瀏覽器沒有啟動");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const js = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed");
  return r.result?.result?.value;
};

// ---- 截圖：每一張記下當下的時間；「加速」時一秒當成 1/speed 秒 ----
const frames = [];
let speed = 1;
let t0 = Date.now();
let n = 0;
async function shot() {
  const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
  const file = join(work, "frames", String(n++).padStart(5, "0") + ".jpg");
  writeFileSync(file, Buffer.from(r.result.data, "base64"));
  frames.push({ file, t: (Date.now() - t0) / 1000, speed });
}
/** 一邊等一邊截圖，約 ms 毫秒。 */
async function film(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await shot();
    await sleep(15);
  }
}

// ---- 滑鼠：畫一個看得見的游標，點擊時用真的滑鼠事件 ----
let mx = W / 2;
let my = H / 2;
async function installCursor() {
  await js(`(() => {
    if (document.getElementById("demo-cursor")) return;
    const c = document.createElement("div");
    c.id = "demo-cursor";
    c.style.cssText = "position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transition:none;translate:-3px -2px";
    c.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l7.5 18 2.6-7.4L20.5 10z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.append(c);
    const ring = document.createElement("div");
    ring.id = "demo-ring";
    ring.style.cssText = "position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:3px solid #ff6a4d;z-index:2147483646;pointer-events:none;opacity:0;scale:.4;transition:opacity .35s ease-out,scale .35s ease-out";
    document.documentElement.append(ring);
  })()`);
}
/** 畫面左下的小字說明（沒有旁白，靠它講現在在做什麼）。 */
let captionText = "";
async function caption(text) {
  captionText = text;
  await js(`(() => {
    let c = document.getElementById("demo-caption");
    if (!c) {
      c = document.createElement("div");
      c.id = "demo-caption";
      c.style.cssText = "position:fixed;left:28px;bottom:26px;z-index:2147483645;pointer-events:none;padding:11px 20px;border-radius:999px;background:rgba(10,14,20,.92);border:1px solid rgba(255,255,255,.22);color:#f3efe6;font:600 20px/1.2 system-ui,'Segoe UI',sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.5);transition:opacity .3s";
      document.documentElement.append(c);
    }
    c.textContent = ${JSON.stringify(text)};
    c.style.opacity = ${text ? 1 : 0};
  })()`);
}
async function setCursor(x, y) {
  mx = x;
  my = y;
  await js(`(() => { const c = document.getElementById("demo-cursor"); if (c) c.style.transform = "translate(${x}px,${y}px)"; const r = document.getElementById("demo-ring"); if (r) { r.style.left = "${x}px"; r.style.top = "${y}px"; } })()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
}
async function moveTo(x, y, ms = 650) {
  const x0 = mx;
  const y0 = my;
  const steps = Math.max(6, Math.round(ms / 45));
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // ease in-out
    await setCursor(x0 + (x - x0) * e, y0 + (y - y0) * e);
    await shot();
  }
}
const center = async (selector) => {
  const box = await js(`(() => { const e = ${selector}; if (!e) return null; e.scrollIntoView({block: "center"}); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  if (!box) throw new Error("找不到：" + selector);
  return box;
};
async function click(selector, ms = 650) {
  const [x, y] = await center(selector);
  await moveTo(x, y, ms);
  await js(`(() => { const r = document.getElementById("demo-ring"); r.style.transition = "none"; r.style.opacity = "1"; r.style.scale = ".4"; void r.offsetWidth; r.style.transition = "opacity .35s ease-out, scale .35s ease-out"; r.style.opacity = "0"; r.style.scale = "1.5"; })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await film(450);
}
async function type(selector, text, perKey = 95) {
  await click(selector, 500);
  for (const ch of text) {
    await send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    await film(perKey);
  }
}
async function press(key, code, vk) {
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
}

async function finish(code) {
  try { await send("Browser.close"); } catch {}
  try { ws.close(); } catch {}
  proc.kill();
  if (!KEEP && code === 0 && !SCOUT) rmSync(work, { recursive: true, force: true });
  process.exit(code);
}

try {
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  // 先開一次，把語言（英文）和「導覽」「提示」這類第一次才出現的東西標成看過，再重新載入。
  await send("Page.navigate", { url: BASE + "/" });
  await sleep(1500);
  await js(`(() => {
    localStorage.setItem("mochi.language.v1", "en");
    for (const room of ["mochi", "fuse", "book", "album"]) localStorage.setItem("mochi.tour." + room + ".v1", "1");
    return 1;
  })()`);
  await send("Page.navigate", { url: BASE + "/" });
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    if (await js(`!!document.getElementById("lib-q") && document.querySelectorAll("#lib-grid .card").length > 8`).catch(() => false)) break;
  }
  await sleep(800);
  await installCursor();
  await setCursor(W * 0.62, H * 0.5);
  t0 = Date.now();
  frames.length = 0;
  await caption("Mochi · Danbooru tags as cards for ComfyUI");
  await film(1800);

  // ---- 1. 內容尺度選最保守的「Activity」 ----
  await caption("1  Pick a content level");
  const level = (name) => `[...document.querySelectorAll("button")].find((b) => b.offsetParent && b.textContent.trim() === "${name}")`;
  await click(level("Suggestive"));
  await click(level("Activity"), 400);
  await film(600);

  // ---- 2. 搜尋、Enter 釘牌 ----
  await caption("2  Search and pin a few cards");
  for (const word of ["long hair", "medium breasts", "school uniform", "standing", "smile", "cherry blossoms"]) {
    await js(`document.getElementById("lib-q").value = ""; document.getElementById("lib-q").dispatchEvent(new Event("input", {bubbles: true}))`);
    await type(`document.getElementById("lib-q")`, word);
    await film(500);
    const first = await js(`document.querySelector("#lib-grid .card[data-tag]")?.dataset.tag`);
    if (first !== word) console.log(`warn: "${word}" 搜出來的第一張是 "${first}"`);
    await press("Enter", "Enter", 13);
    await film(900);
  }
  if (PROBE) {
    await shot();
    const f = frames.at(-1).file;
    console.log("probe frame:", f);
  }

  const setSeed = async (seed) => {
    await click(`[...document.querySelectorAll("button")].find((b) => b.offsetParent && b.textContent.trim() === "Fixed")`, 500);
    await js(`(() => { const i = document.querySelector(".seed-ctl-input"); i.focus(); i.value = "${seed}"; i.dispatchEvent(new Event("input", {bubbles: true})); i.dispatchEvent(new Event("change", {bubbles: true})); i.blur(); })()`);
    await film(500);
  };
  const generate = async () => {
    const before = await js(`document.querySelectorAll(".shot").length`);
    await click(`[...document.querySelectorAll("button")].find((b) => b.offsetParent && /Draw & generate/.test(b.textContent))`);
    const t = Date.now();
    while (Date.now() - t < 240000) {
      await sleep(700);
      if (await js(`document.querySelectorAll(".shot").length > ${before} && document.querySelector(".shot").dataset.status === "done"`).catch(() => false)) return true;
    }
    return false;
  };
  if (SCOUT) {
    for (const seed of SCOUT.split(",")) {
      await setSeed(seed);
      const ok = await generate();
      await sleep(900);
      const box = await js(`(() => { const f = document.querySelector(".shot .shot-frame"); f.scrollIntoView({block: "center"}); const r = f.getBoundingClientRect(); return {x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height}; })()`);
      await sleep(400);
      const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 85, clip: { ...box, scale: 1 } });
      const file = join(work, `scout-${seed}.jpg`);
      writeFileSync(file, Buffer.from(r.result.data, "base64"));
      console.log(seed, ok ? "ok" : "timeout", file);
    }
    await finish(0);
  }

  // ---- 3. 按「Draw & generate」 ----
  await caption("3  The engine fills the rest. Your ComfyUI draws it");
  if (SEED) await setSeed(SEED);
  await click(`[...document.querySelectorAll("button")].find((b) => b.offsetParent && /Draw & generate/.test(b.textContent))`);
  await film(1500);
  speed = 6;
  const waitStart = Date.now();
  let done = false;
  while (Date.now() - waitStart < 240000) {
    await shot();
    await sleep(900);
    done = await js(`document.querySelector(".shot")?.dataset.status === "done"`).catch(() => false);
    if (done) break;
  }
  speed = 1;
  console.log("出圖：", done ? ((Date.now() - waitStart) / 1000).toFixed(0) + " 秒" : "逾時");
  await film(1800);

  // ---- 4. 往下捲到那張圖，攤開「引擎補了哪些牌」 ----
  const scrollTo = async (selector, offset = 90) => {
    const target = await js(`(() => { const e = ${selector}; const r = e.getBoundingClientRect(); return Math.max(0, scrollY + r.top - ${offset}); })()`);
    const from = await js("scrollY");
    for (let i = 1; i <= 24; i++) {
      const k = i / 24;
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      await js(`scrollTo(0, ${from + (target - from) * e})`);
      await shot();
      await sleep(25);
    }
  };
  await scrollTo(`document.querySelector(".shot")`, 70);
  await caption("Your pins, plus the cards the engine added");
  await film(1800);
  // 圖下面是釘的牌和引擎補的牌：慢慢往下看，再往上收起來。
  const y0 = await js("scrollY");
  for (let i = 1; i <= 40; i++) {
    const k = i / 40;
    await js(`scrollTo(0, ${y0 + 520 * (k * k * (3 - 2 * k))})`);
    await shot();
    await sleep(30);
  }
  await film(1800);
  await scrollTo(`document.querySelector(".shot")`, 70);
  await film(600);
  await click(`document.querySelector(".shot .shot-actions button")`);
  await film(1200);

  // ---- 5. 收藏進作品冊、打開作品冊 ----
  await caption("4  Save it. Gallery keeps its own copy");
  await click(`document.querySelector(".shot .fav-btn")`);
  await film(1800);
  await click(`document.querySelector('a[href="album.html"]')`);
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    if (await js(`location.pathname.endsWith("album.html") && document.readyState === "complete" && document.querySelectorAll("img").length > 0`).catch(() => false)) break;
  }
  await installCursor();
  await setCursor(mx, my);
  await caption("Free and open source · github.com/bosen12/danbooru_tag_mochi");
  await film(3200);
  await shot();
  if (PROBE) {
    console.log("last frame:", frames.at(-1).file);
    console.log(await js(`[...document.querySelectorAll("#results *, [class*=result]")].slice(0, 12).map((e) => e.tagName + "." + e.className).join(" | ")`));
    console.log("work dir kept at", work);
    await finish(0);
  }

  // ---- 輸出 ----
  const list = join(work, "list.txt");
  const lines = [];
  for (let i = 0; i < frames.length; i++) {
    const cur = frames[i];
    const next = frames[i + 1];
    const dur = next ? Math.max(0.02, (next.t - cur.t) / cur.speed) : 1.5;
    lines.push(`file '${cur.file.replace(/\\/g, "/")}'`, `duration ${dur.toFixed(4)}`);
  }
  lines.push(`file '${frames.at(-1).file.replace(/\\/g, "/")}'`);
  writeFileSync(list, lines.join("\n"));
  const ff = spawnSync("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
    "-vf", `fps=${FPS},scale=${W}:${H}:flags=lanczos,format=yuv420p`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-movflags", "+faststart", OUT,
  ], { stdio: "inherit" });
  if (ff.status !== 0) throw new Error("ffmpeg 失敗");
  console.log(`${OUT}  ${(statSync(OUT).size / 1e6).toFixed(1)} MB`);
  await finish(0);
} catch (err) {
  console.error(err);
  await finish(1);
}
