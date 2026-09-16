#!/usr/bin/env node
/**
 * 前端這一側的契約。web/boot.js 有 3065 行、web/lora.js 有 1364 行，
 * 在這支之前**一條自動測試都沒有** —— 而最近找到的四個 bug 四個都在那裡：
 * 括號沒跳脫、token 數把權重算錯、改權重洗掉 LoRA 觸發詞、重抽拿新分級配舊正面。
 * engine.js 有 2600 條斷言、同期一個新 bug 都沒有。那不是巧合。
 *
 * 這支不引進 jsdom —— 這個專案沒有 package.json 也沒有 node_modules，
 * 為了測試把它變成有依賴的專案，是對專案形狀的決定，不該由測試順手做掉。
 * 作法是兩條：
 *   1. 把「哪個欄位屬於卡片、哪個屬於即時設定」抽成 engine.js 的純函式來測。
 *   2. 讀 boot.js 的原始碼，守住那個物件字面值的形狀 —— 這條才抓得到
 *      「有人加了新欄位卻忘了表態」，也就是 rating 當初出事的那個樣子。
 * lora.js 在載入時會碰 matchMedia / location / IntersectionObserver /
 * localStorage，所以下面補了四個最小的替身。那不是為了繞過什麼，
 * 是把「這個模組載入時到底碰了哪些瀏覽器介面」寫下來。
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// 反斜線在這個專案的編輯路徑上被吃掉過太多次，換行一律用碼點組，不寫字面值。
const NL = String.fromCharCode(10);

globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.location = { href: "http://127.0.0.1:8787/", origin: "http://127.0.0.1:8787", search: "", hash: "", pathname: "/" };
globalThis.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
{
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

// scroll-lock 只碰 document.documentElement.style.overflow，一個最小替身就夠。
globalThis.document = {
  documentElement: { style: { overflow: "" } },
  // body 也要給，而且要真的能寫 —— 少了它，「鎖錯元素」會變成當場拋例外，
  // 那是崩潰不是紅燈，斷言等於沒在守。有了它才量得出「body 有沒有被動過」。
  body: { style: { overflow: "" } },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
};

const { JOB_CARD_FIELDS, jobFields } = await import("../web/engine.js");
const { lockScroll, unlockScroll, scrollLockCount } = await import("../web/scroll-lock.js");
const { joinTriggerParts, slotTriggerText } = await import("../web/lora.js");

let failed = 0;
function ok(name, cond, detail) {
  if (cond) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}` + (detail ? NL + "  " + detail : ""));
  }
}

// --- 1. 重抽要用卡片抽的時候那組條件 ----------------------------------------
// 每一個欄位都要「卡片的值贏過即時設定」。少顧一個就是重抽會混用兩組條件，
// rating 就是這樣漏了四十幾個 commit 沒人發現。
{
  const CARD = {
    positive: "1girl, solo, nsfw, explicit",
    loras: [{ folder: "a", file: "b.safetensors", strength: 0.8 }],
    ckpt: "drawn.safetensors",
    rating: "explicit",
  };
  const LIVE = {
    loras: [{ folder: "z", file: "later.safetensors", strength: 0.2 }],
    ckpt: "now.safetensors",
    rating: "general",
  };

  const wrong = [];
  for (const key of JOB_CARD_FIELDS) {
    const got = jobFields(CARD, LIVE)[key];
    const want = CARD[key];
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      wrong.push(`${key}: 卡片是 ${JSON.stringify(want)} 但送出 ${JSON.stringify(got)}`);
    }
  }
  ok(`卡片有值時每個欄位都用卡片的（${JOB_CARD_FIELDS.length} 個）`, wrong.length === 0, wrong.join("; "));

  // 卡片沒有的欄位才退回即時設定。
  const fellBack = jobFields({ positive: "x" }, LIVE);
  ok(
    "卡片沒存的欄位退回即時設定",
    JSON.stringify(fellBack.loras) === JSON.stringify(LIVE.loras) &&
      fellBack.ckpt === LIVE.ckpt &&
      fellBack.rating === LIVE.rating,
    JSON.stringify(fellBack)
  );

  // 空陣列是有意義的：那張卡就是沒掛 LoRA，不可以被現在掛著的蓋過去。
  const noLora = jobFields({ positive: "x", loras: [] }, LIVE);
  ok("卡片的 loras 是空陣列時不被即時設定蓋過去", noLora.loras.length === 0, JSON.stringify(noLora.loras));

  // 兩邊都沒有時要有安全的預設，不能吐出 undefined 讓伺服器自己猜。
  const bare = jobFields(null, null);
  ok(
    "兩邊都沒有時 rating 預設 explicit、loras 是陣列、positive 是字串",
    bare.rating === "explicit" && Array.isArray(bare.loras) && typeof bare.positive === "string",
    JSON.stringify(bare)
  );
}

// --- 2. 送出去的那個物件，每個欄位都要表過態 --------------------------------
// 這條讀的是 boot.js 的原始碼。用意不是檢查寫法漂不漂亮，而是讓「加了新欄位
// 卻直接寫 settings.xxx」這件事當場紅燈 —— rating 當初就是這樣混進去的，
// 因為那個判斷散在兩個函式裡，沒有任何一個地方需要把清單寫完整。
{
  // 這三個本來就該用送出當下的值：畫布尺寸跟 seed 不屬於「那張卡抽的時候」。
  const LIVE_OK = new Set(["width", "height", "seed"]);
  const src = readFileSync(join(ROOT, "web", "boot.js"), "utf8");
  const at = src.indexOf("await streamGen(");
  const open = src.indexOf("{", at);
  const close = src.indexOf(NL + "      },", open);
  ok("在 boot.js 裡找得到送出 payload 的那個物件", at >= 0 && open > at && close > open);

  if (at >= 0 && close > open) {
    const lines = src.slice(open + 1, close).split(NL);
    const keys = [];
    const bad = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("//")) continue;
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const key = line.slice(0, colon).trim();
      let val = line.slice(colon + 1).trim();
      if (val.endsWith(",")) val = val.slice(0, -1).trim();
      keys.push(key);
      if (LIVE_OK.has(key)) continue;
      if (val !== `job.${key}`) {
        bad.push(`${key} 的值是 ${val}，應該是 job.${key}（或加進 LIVE_OK 並說明為什麼）`);
      }
    }
    ok(`payload 的欄位數合理（找到 ${keys.length} 個：${keys.join(", ")}）`, keys.length >= 5, keys.join(", "));
    ok("payload 裡除了畫布與 seed 之外都經過 jobFields", bad.length === 0, bad.join("; "));

    const missing = JOB_CARD_FIELDS.filter((k) => !keys.includes(k));
    ok("JOB_CARD_FIELDS 宣告的欄位都真的被送出去", missing.length === 0, missing.join(", "));
  }
}

// --- 3. LoRA 觸發詞的組裝 ---------------------------------------------------
// 觸發詞漏了或組錯，掛上去的 LoRA 等於沒生效，而圖看起來只是「風格沒出來」，
// 很難聯想到是這裡。1364 行的 lora.js 在這之前沒有任何斷言。
{
  const cases = [
    [["a", "b"], "a, b", "兩段用逗號接起來"],
    [["a", ""], "a", "空字串不佔位置"],
    [[" a ", " b "], "a, b", "前後空白要去掉"],
    [["a,", "b"], "a, b", "已經有逗號結尾就不再加一個"],
    [[], "", "全空回空字串"],
    [[null, undefined, "c"], "c", "null / undefined 跳過"],
  ];
  const bad = cases
    .filter(([input, want]) => joinTriggerParts(input) !== want)
    .map(([input, want]) => `${JSON.stringify(input)} 應該是 ${JSON.stringify(want)}，實際 ${JSON.stringify(joinTriggerParts(input))}`);
  ok(`joinTriggerParts 逐例正確（${cases.length} 例）`, bad.length === 0, bad.join("; "));

  const slots = [
    [{ lora: null, twPicks: new Set() }, "", "沒選 LoRA 就沒有觸發詞"],
    [{ lora: { trainedWords: [] }, twPicks: new Set() }, "", "LoRA 沒有觸發詞"],
    [{ lora: { trainedWords: ["only"] }, twPicks: new Set() }, "only", "只有一個觸發詞時不看勾選"],
    [{ lora: { trainedWords: ["x", "y", "z"] }, twPicks: new Set([2, 0]) }, "x, z", "多個時照原順序出，不是照勾選順序"],
    [{ lora: { trainedWords: ["x", "y"] }, twPicks: new Set() }, "", "多個但一個都沒勾＝不給觸發詞"],
  ];
  const bad2 = slots
    .filter(([slot, want]) => slotTriggerText(slot) !== want)
    .map(([slot, want, why]) => `${why}：應該是 ${JSON.stringify(want)}，實際 ${JSON.stringify(slotTriggerText(slot))}`);
  ok(`slotTriggerText 逐例正確（${slots.length} 例）`, bad2.length === 0, bad2.join("; "));
}

// --- 4. 鎖背景捲動：鎖對元素，而且要開幾個就解幾個 --------------------------
// 這一段守的是一個真的發生過的 bug：三個彈窗各自寫 `body.style.overflow = "hidden"`，
// 各自維護一份「還有沒有別的彈窗開著」的選擇器清單（telegram 漏了兩個、
// discord 漏了一個、lora 根本沒鎖）。而且鎖錯了元素 —— boot.css 給 html 設了
// overflow-x: clip，body 的 overflow 就不會往視窗傳遞，所以背景照捲；
// body 反而自己變成捲動容器，把 .rail 的 position: sticky 打斷：
// 捲到 900 開彈窗，左欄往上跳 900px，關掉又跳回來。
{
  const style = document.documentElement.style;
  const bodyStyle = document.body.style;
  style.overflow = "clip";
  bodyStyle.overflow = "";
  const log = [];
  lockScroll("a");
  const bodyUntouched = bodyStyle.overflow === "";
  log.push(["開第一個", style.overflow, scrollLockCount()]);
  lockScroll("b");
  log.push(["開第二個", style.overflow, scrollLockCount()]);
  unlockScroll("a");
  log.push(["關掉第一個", style.overflow, scrollLockCount()]);
  unlockScroll("b");
  log.push(["關掉第二個", style.overflow, scrollLockCount()]);

  ok(
    "鎖的是 documentElement 不是 body",
    log[0][1] === "hidden" && bodyUntouched,
    `html=${log[0][1]} body=${JSON.stringify(bodyStyle.overflow)}`
  );
  ok(
    "還有別的彈窗開著時不能解鎖",
    log[2][1] === "hidden" && log[2][2] === 1,
    JSON.stringify(log[2])
  );
  ok(
    "全部關掉才還原成原本的值（不是清成空字串）",
    log[3][1] === "clip" && log[3][2] === 0,
    JSON.stringify(log[3])
  );

  // 同一個 key 重複開關都不該把帳算錯 —— 這是用集合而不是計數器的理由。
  style.overflow = "clip";
  lockScroll("x");
  lockScroll("x");
  unlockScroll("x");
  const dbl = style.overflow;
  unlockScroll("x");
  unlockScroll("沒開過的");
  ok("同一個 key 開兩次，關一次就解得開", dbl === "clip" && scrollLockCount() === 0, dbl);
  ok("解一把沒開過的鎖不會有事", style.overflow === "clip", style.overflow);
}

if (failed) {
  console.error(NL + failed + " failed");
  process.exit(1);
}
console.log(NL + "ok");
