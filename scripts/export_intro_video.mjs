#!/usr/bin/env node
/**
 * 把介紹影片（web6/intro.html，三分鐘版；--page intro-cards.html 是兩分鐘的墨池・疊印台版）輸出成 1080p60 的 .mp4。
 * 不是螢幕錄影：一格一格精準算。
 *
 *   node scripts/export_intro_video.mjs [輸出.mp4] [伺服器，預設 http://127.0.0.1:8796] [--fps 60] [--from 秒] [--to 秒] [--page intro-cards.html]
 *
 * 畫面：無頭 Edge（或 Chrome）開 1920×1080 的頁面，每一格用 __intro.seek(t) 畫出那一刻再截圖，
 *       直接灌進 ffmpeg（不存暫存圖片）。一格都不會掉、時間完全準。
 * 聲音：同一套合成器用 OfflineAudioContext 離線算整首（__intro.renderAudio），存成 WAV 再混進去。
 * 需要：ffmpeg 在 PATH 上；Edge 或 Chrome；墨池的伺服器開著。
 */
import { spawn, spawnSync } from "child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync, statSync } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const FPS = +flag("--fps", 60);
const FROM = +flag("--from", 0);
// --page intro-cards.html：只有墨池、疊印台的版本。
const PAGE = flag("--page", "intro.html");
const TO_ARG = flag("--to", null);
const OUT = args[0] || join(homedir(), "Desktop", PAGE === "intro-cards.html" ? "墨池疊印台-介紹影片-1080p60.mp4" : "排字匣-介紹影片-3分鐘-1080p60.mp4");
const BASE = args[1] || "http://127.0.0.1:8796";
const W = 1920;
const H = 1080;

const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
const browser = BROWSERS.find((p) => existsSync(p));
if (!browser) throw new Error("找不到 Edge 或 Chrome");
if (spawnSync("ffmpeg", ["-version"]).status !== 0) throw new Error("找不到 ffmpeg（要在 PATH 上）");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const work = mkdtempSync(join(tmpdir(), "intro-export-"));
const port = 9500 + Math.floor(Math.random() * 300);
const proc = spawn(browser, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${join(work, "profile")}`,
  `--window-size=${W},${H}`,
  "--hide-scrollbars",
  "--mute-audio",
  "--force-device-scale-factor=1",
  // 三分鐘版的星河是 WebGL：沒有顯示卡可用時退回軟體算（慢一點，但畫得出來）。
  "--ignore-gpu-blocklist",
  "--enable-unsafe-swiftshader",
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

try {
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${BASE}/${PAGE}` });
  process.stdout.write("載入中…");
  for (let i = 0; i < 240; i++) {
    await sleep(250);
    if (await js("!!window.__intro && !document.getElementById('play').disabled").catch(() => false)) break;
  }
  if (!(await js("!!window.__intro"))) throw new Error("影片頁沒有載好");
  const LENGTH = await js("__intro.length");
  const TO = TO_ARG === null ? LENGTH : Math.min(LENGTH, +TO_ARG);
  // 閘門、控制列、游標都不要入鏡。
  await js("document.getElementById('gate').style.display='none'; document.getElementById('bar').style.display='none'; document.body.style.cursor='none'; 1");
  console.log(" 好了");

  // ---- 聲音 ----
  process.stdout.write("配樂離線合成…");
  const parts = await js("__intro.renderAudio()");
  const chunks = [];
  for (let i = 0; i < parts; i++) chunks.push(Buffer.from(await js(`__intro.wavChunk(${i})`), "base64"));
  const wav = join(work, "score.wav");
  writeFileSync(wav, Buffer.concat(chunks));
  console.log(` ${(statSync(wav).size / 1e6).toFixed(1)} MB`);

  // ---- 畫面 → ffmpeg ----
  const total = Math.round((TO - FROM) * FPS);
  const ff = spawn(
    "ffmpeg",
    [
      "-y", "-loglevel", "error",
      "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
      "-ss", String(FROM), "-t", String(TO - FROM), "-i", wav,
      "-map", "0:v", "-map", "1:a",
      "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-profile:v", "high", "-r", String(FPS),
      // 最響的那幾下（撞擊、鼓）會碰到 0 dBFS，壓縮成 AAC 之後可能破音：限到約 −1.5 dB。
      "-af", "alimiter=limit=0.84:attack=2:release=60:level=false",
      "-c:a", "aac", "-b:a", "256k",
      "-shortest", "-movflags", "+faststart",
      OUT,
    ],
    { stdio: ["pipe", "inherit", "inherit"] }
  );
  const ffDone = new Promise((r) => ff.on("close", r));
  const t0 = Date.now();
  for (let f = 0; f < total; f++) {
    const t = FROM + f / FPS;
    await js(`__intro.seek(${t.toFixed(5)}); 1`);
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 95, clip: { x: 0, y: 0, width: W, height: H, scale: 1 }, optimizeForSpeed: false });
    const buf = Buffer.from(shot.result.data, "base64");
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (f % FPS === 0 || f === total - 1) {
      const el = (Date.now() - t0) / 1000;
      const eta = (el / (f + 1)) * (total - f - 1);
      process.stdout.write(`\r畫面 ${f + 1}/${total}（${t.toFixed(1)}s）  已用 ${el.toFixed(0)}s  剩約 ${eta.toFixed(0)}s   `);
    }
  }
  ff.stdin.end();
  const code = await ffDone;
  console.log("");
  if (code !== 0) throw new Error(`ffmpeg 結束碼 ${code}`);
  console.log(`輸出：${OUT}（${(statSync(OUT).size / 1e6).toFixed(1)} MB）`);
} finally {
  // Edge 的啟動程序會把真正的瀏覽器交出去就結束，只殺 proc 那一支會留下一整組無頭 Edge
  // 停在影片頁一直畫（三分鐘版的星河是 WebGL，一組就吃好幾趴 GPU）。先請瀏覽器自己關。
  try {
    await Promise.race([send("Browser.close"), sleep(3000)]);
  } catch {}
  try {
    ws.close();
  } catch {}
  spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  try {
    proc.kill();
  } catch {}
  await sleep(500);
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {}
}
