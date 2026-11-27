// 無限抽越印越卡的回歸測試（2026-11-27 專案主：一次抽兩張、印到兩百張，網頁卡死、CPU 近 100%、有些一直「排隊中」）。
// 真的 web6 頁面、假伺服器（假的出圖會送進度、預覽、成品），不連 ComfyUI；/api/interrupt 一律擋。
//
//   node scripts/test_web6_loop_browser.mjs
//   BASE=<git 版本> node scripts/test_web6_loop_browser.mjs   # 拿那一版的 web6 對照（修之前應該紅）
//
// 驗的事：
//   1. 開兩個墨池分頁，在後開的那頁送圖、還排著就重新整理：排著的接著印完，不會永遠「排隊中」
//      （以前只有最早開的分頁接著印，重新整理那頁存檔裡排著的沒人接，又算「在跑」不能裁，牆滿時反把剛印好的裁掉）。
//   2. 印了好幾張之後，已經拿掉的元素上沒有還在算的動畫（合牌的星火、牌、光演完 fill: forwards 掛著，
//      拿掉了還沒回收前每一格都要照顧，越印越卡）。
//   1b. 另一個墨池頁後來才開：讀進來排著的，在印的那頁印好之後也跟著變成印好（以前永遠「等前面的印完」）。
//   1c. 後開那頁之後存一次檔：不能把送圖那頁印好的改回「等前面的印完」（2026-11-27 專案主截圖：送圖那頁一排印好的寫著排隊中）。
//   3. 成品牆上沒有毛玻璃（backdrop-filter）：以前每張的按鈕列、牌·N 都帶，滿牆 425 個合成圖層；
//      只給滑鼠底下那張也不行：按鈕列淡入時毛玻璃糊不到底下的圖，按鈕先黑、淡入完才變灰（閃一下）。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  for (const p of [process.env.PLAYWRIGHT_MODULE, "playwright", resolve(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")].filter(Boolean)) {
    try {
      return require(p);
    } catch {}
  }
  throw new Error("Install Playwright or set PLAYWRIGHT_MODULE");
})();
const root = resolve(import.meta.dirname, "..");
const BASE = {};
if (process.env.BASE) {
  const files = execFileSync("git", ["ls-tree", "--name-only", process.env.BASE, "web6/"], { cwd: root }).toString().split("\n").filter((f) => /\.(js|css|html)$/.test(f));
  for (const f of files) BASE[f.slice(5)] = execFileSync("git", ["show", `${process.env.BASE}:${f}`], { cwd: root, maxBuffer: 2 ** 27 });
}
// 一張 2×3 的 PNG 當成品（長寬比對得上就好）。
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAEklEQVR4nGNkYPjPwMDAxMAAAA0/AQRVbqVUAAAAAElFTkSuQmCC", "base64");
const PREVIEW = "data:image/png;base64," + PNG.toString("base64");
const PER = 240;
let jobs = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    if (p.startsWith("/api/")) {
      for await (const _ of req);
      if (p === "/api/interrupt") return res.writeHead(403).end();
      if ((p === "/api/gen" && req.method === "POST") || p === "/api/gen/attach") {
        const id = ++jobs;
        res.writeHead(200, { "Content-Type": "text/event-stream", "X-Gen-Job": "j" + id });
        for (let i = 1; i <= 3; i++) {
          await sleep(PER / 3);
          res.write(`event: progress\ndata: {"value":${i},"max":3}\n\n`);
          res.write(`event: preview\ndata: ${JSON.stringify({ image: PREVIEW })}\n\n`);
        }
        return res.end("event: done\ndata: " + JSON.stringify({ ok: true, image: `/api/image?filename=t${id}.png&type=output`, seed: id, width: 832, height: 1216, positive: "x" }) + "\n\n");
      }
      if (p === "/api/image") return res.writeHead(200, { "Content-Type": "image/png" }).end(PNG);
      const data = {
        "/api/ping": { ok: true, comfy: true },
        "/api/gen/active": { ok: true, jobs: [] },
        "/api/recipes": { ok: true, items: [] },
        "/api/usage": { counts: {}, mine: {}, last: {} },
        "/api/decks": { ok: true, decks: [] },
        "/api/lora-push": { version: 0 },
        "/api/discord/config": { ok: true, configured: false, enabled: false, mode: "webhook" },
        "/api/card-groups": { ok: true, groups: [] },
        "/api/face/status": { ready: true },
        "/api/loras": { items: [], categories: [] },
        "/api/sampling": { ok: true, base: { steps: 28, cfg: 5, sampler_name: "euler", scheduler: "normal" }, hires: { fast: {}, deep: {} } },
        "/api/genlog": { ok: true, items: [] },
      }[p] || { ok: true, items: [] };
      return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(data));
    }
    const name = decodeURIComponent(p).replace(/^\//, "") || "index.html";
    if (name.includes("..")) return res.writeHead(403).end();
    const type = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png" }[extname(name)] || "application/octet-stream";
    if (BASE[name]) return res.writeHead(200, { "Content-Type": type }).end(BASE[name]);
    const file = [resolve(root, "web6", name), resolve(root, "web", name)].find((f) => existsSync(f));
    if (!file) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": type }).end(await readFile(file));
  } catch {
    try {
      res.writeHead(500).end();
    } catch {}
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ["--disable-features=Prerender2,SpeculationRulesPrefetchProxy"] });
let failed = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond || !detail ? "" : "\n     " + String(detail).slice(0, 600)}`);
  if (!cond) failed++;
};
const errors = [];
async function context(n = 2) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  await c.route(/\/api\/interrupt(?:\?|$)/, (r) => r.abort());
  await c.addInitScript((n) => {
    if (location.protocol !== "http:") return;
    localStorage.setItem("mochi.language.v1", "zh-Hant");
    localStorage.setItem("mochi.tour.declined.v1", "99");
    if (!localStorage.getItem("mochi.settings.v1")) localStorage.setItem("mochi.settings.v1", JSON.stringify({ n }));
    // 記下每一個 element.animate() 的動畫（留著參照，不被回收）：之後看哪些的元素拿掉了、動畫還沒放掉。
    window.__anims = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const a = animate.apply(this, args);
      window.__anims.push(a);
      return a;
    };
  }, n);
  return c;
}
// 本機的連接埠一陣一陣被系統擋（ERR_NETWORK_ACCESS_DENIED），不是程式壞了：等一下再試。
async function open(c) {
  const p = await c.newPage();
  p.setDefaultTimeout(30000);
  p.on("pageerror", (e) => errors.push(e.message));
  for (let i = 0; ; i++) {
    try {
      await p.goto(origin + "/");
      break;
    } catch (e) {
      if (i >= 4 || !/ERR_NETWORK_ACCESS_DENIED|ERR_CONNECTION_REFUSED/.test(String(e))) throw e;
      await sleep(1500);
    }
  }
  try {
    await p.locator("#go-bar .btn-primary").waitFor({ timeout: 20000 });
  } catch (e) {
    console.log("開頁沒看到抽並生圖", await p.evaluate(() => { const g = document.querySelector("#go-bar"); const b = g?.querySelector(".btn-primary"); return { g: !!g, b: !!b, r: b ? JSON.stringify(b.getBoundingClientRect()) : "", d: g ? getComputedStyle(g).display + "/" + getComputedStyle(g).visibility + "/" + g.hidden : "", t: document.body.innerText.slice(0, 160) }; }), errors.slice(0, 3));
    throw e;
  }
  await sleep(800);
  return p;
}
const statuses = (p) =>
  p.evaluate(() => {
    const o = {};
    for (const n of document.querySelectorAll("#wall > .shot")) o[n.dataset.status] = (o[n.dataset.status] || 0) + 1;
    return o;
  });
const until = async (fn, ms) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v.ok || Date.now() > end) return v;
    await sleep(250);
  }
};

try {
  // 1. 兩個墨池分頁：後開的那頁送圖、還排著就重新整理。
  {
    const c = await context(6);
    const a = await open(c);
    const b = await open(c);
    await b.bringToFront();
    await b.locator("#go-bar .btn-primary").click();
    await until(async () => ({ ok: ((await statuses(b)).queued || 0) >= 3 }), 5000);
    const before = await statuses(b);
    await b.reload();
    await b.locator("#go-bar .btn-primary").waitFor();
    const after = await until(async () => {
      const s = await statuses(b);
      return { ok: (s.done || 0) === 6, s };
    }, 15000);
    ok("1. 另一個墨池分頁開著、這頁重新整理：排著的接著印完", after.ok, `重新整理前 ${JSON.stringify(before)}，之後 ${JSON.stringify(after.s)}`);
    void a;
    await c.close();
  }

  // 1b. 一個墨池分頁在印、另一個分頁後來才開（專案主常常同時開好幾個墨池頁）：後開的那頁從存檔讀進來的排著的幾張，
  //     那邊印好之後這邊也要跟著變成印好。以前讀進來再序列化少了 reserved，對不上存檔，永遠「等前面的印完」。
  {
    const c = await context(8);
    const a = await open(c);
    await a.locator("#go-bar .btn-primary").click();
    await until(async () => ({ ok: ((await statuses(a)).queued || 0) >= 4 }), 5000);
    const b = await open(c);
    const mid = await statuses(b);
    const done = await until(async () => {
      const sa = await statuses(a);
      return { ok: (sa.done || 0) === 8, sa };
    }, 20000);
    await sleep(1500);
    const sb = await statuses(b);
    ok("1b. 後開的墨池頁：讀進來排著的幾張，那邊印好這邊也跟著印好", done.ok && (mid.queued || 0) + (mid.running || 0) > 0 && !sb.queued && !sb.running, `後開那頁剛開 ${JSON.stringify(mid)}，在印的那頁 ${JSON.stringify(done.sa)}，後開那頁最後 ${JSON.stringify(sb)}`);
    // 1c. 後開那頁之後存一次檔（撤下一張）：不能用它手上舊的「排著」蓋掉在印那頁的「印好了」。
    //     以前會：送圖的那頁自己已經印好的又變回「等前面的印完」，印圖的程序早就做完它，永遠卡在牆上。
    await a.bringToFront();
    await b.evaluate(() => [...document.querySelectorAll('#wall > .shot[data-status="done"] .shot-remove')].pop()?.click());
    await sleep(2000);
    const sa2 = await statuses(a);
    ok("1c. 後開那頁存檔之後，送圖那頁印好的不會被改回排隊中", !sa2.queued && !sa2.running && (sa2.done || 0) >= 7, JSON.stringify(sa2));
    await c.close();
  }

  // 2、3. 印幾輪（每輪 2 張，合牌動畫要在畫面上演）。
  {
    const c = await context(2);
    const p = await open(c);
    // 數合牌演了幾次（.shot-merge 那一層）：沒演就測不到，這一項不算數。
    await p.evaluate(() => {
      window.__merges = 0;
      new MutationObserver((list) => {
        for (const m of list) for (const n of m.addedNodes) if (n.classList?.contains("shot-merge")) window.__merges++;
      }).observe(document.getElementById("wall"), { childList: true, subtree: true });
    });
    for (let round = 0; round < 6; round++) {
      // 成品牆在畫面上才演合牌（畫面外的直接收掉）。
      await p.evaluate(() => document.getElementById("wall-head").scrollIntoView({ block: "start", behavior: "instant" }));
      await p.locator("#go-bar .btn-primary").click();
      await until(async () => {
        const s = await statuses(p);
        return { ok: !s.queued && !s.running && (s.done || 0) >= (round + 1) * 2 };
      }, 10000);
      await sleep(400);
    }
    await sleep(2500); // 合牌的那一層演完、拿掉
    // 元素已經不在頁面上、動畫還有作用（在演、或演完停在最後一格）的：拿掉了還掛在時間軸上，每一格都要照顧。
    const r = { result: { value: await p.evaluate(() => {
      const m = {};
      let n = 0;
      for (const a of window.__anims) {
        const t = a.effect && a.effect.target;
        if (!t || t.isConnected || a.playState === "idle") continue;
        // 演完、沒有 fill 的不算（瀏覽器演完就不再管它）；還在演、暫停、演完停在最後一格（forwards／both）的才算。
        const fill = a.effect.getComputedTiming().fill;
        if (a.playState === "finished" && fill !== "forwards" && fill !== "both") continue;
        n++;
        const k = a.playState + " " + t.tagName.toLowerCase() + "." + (typeof t.className === "string" ? t.className.split(" ")[0] : "");
        m[k] = (m[k] || 0) + 1;
      }
      return { n, m };
    }) } };
    const shots = await statuses(p);
    const merges = await p.evaluate(() => window.__merges);
    ok("2. 印了 12 張、合牌演了幾次：拿掉的元素上沒有還在算的動畫", (shots.done || 0) >= 12 && merges >= 4 && r.result.value.n === 0, `成品 ${JSON.stringify(shots)}，合牌 ${merges} 次，殘留 ${r.result.value.n}：${JSON.stringify(r.result.value.m)}`);

    // 3. 滑鼠不在牆上：沒有毛玻璃。
    await p.mouse.move(5, 5);
    await sleep(500);
    const blur = await p.evaluate(() => {
      const list = [...document.querySelectorAll("#wall *")].filter((n) => {
        const f = getComputedStyle(n).backdropFilter;
        return f && f !== "none";
      });
      return { n: list.length, who: [...new Set(list.map((n) => n.className))].slice(0, 5) };
    });
    ok("3. 成品牆上沒有毛玻璃（12 張成品、滑鼠不在牆上：0 個）", blur.n === 0, JSON.stringify(blur));
    // 滑鼠移上一張：按鈕列浮出來，也沒有毛玻璃（有的話淡入時按鈕先黑後灰、閃一下）。
    const box = await p.locator("#wall > .shot").first().boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(500);
    const hover = await p.evaluate(() => {
      const shots = [...document.querySelectorAll("#wall > .shot")];
      const has = (s) => [...s.querySelectorAll("*")].some((n) => (getComputedStyle(n).backdropFilter || "none") !== "none");
      return { shown: getComputedStyle(shots[0].querySelector(".shot-actions")).opacity, blurred: shots.filter(has).length };
    });
    ok("3. 滑鼠移上一張：按鈕列浮出來、沒有毛玻璃", hover.shown === "1" && hover.blurred === 0, JSON.stringify(hover));
    await c.close();
  }
} finally {
  await browser.close();
  server.close();
}
ok("沒有頁面錯誤", errors.length === 0, errors.slice(0, 3).join("\n"));
if (failed) {
  console.log(`\n${failed} 項沒過`);
  process.exit(1);
}
console.log("\n無限抽回歸測試全過");
