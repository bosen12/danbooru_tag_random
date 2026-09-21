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
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// 反斜線在這個專案的編輯路徑上被吃掉過太多次，換行一律用碼點組，不寫字面值。
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);

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
  // children 也要給：彈窗開著時背景要進 inert，那條規則掃的就是 body 的直系子節點。
  body: { style: { overflow: "" }, children: [] },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
};

const { JOB_CARD_FIELDS, jobFields, addPinPreset } = await import("../web/engine.js");
const { lockScroll, unlockScroll, scrollLockCount } = await import("../web/scroll-lock.js");
const {
  joinTriggerParts,
  slotTriggerText,
  loraPollDelay,
  loraStrengthFromSpec,
  applyRecipeModels,
  currentLorasPayload,
  currentTriggerText,
  invalidateModelLists,
} = await import("../web/lora.js");

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
    workflowId: "my-wai",
  };
  const LIVE = {
    loras: [{ folder: "z", file: "later.safetensors", strength: 0.2 }],
    ckpt: "now.safetensors",
    rating: "general",
    workflowId: "other",
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
      fellBack.rating === LIVE.rating &&
      fellBack.workflowId === LIVE.workflowId,
    JSON.stringify(fellBack)
  );

  // 空陣列是有意義的：那張卡就是沒掛 LoRA，不可以被現在掛著的蓋過去。
  const noLora = jobFields({ positive: "x", loras: [] }, LIVE);
  ok("卡片的 loras 是空陣列時不被即時設定蓋過去", noLora.loras.length === 0, JSON.stringify(noLora.loras));
  const builtinCard = jobFields({ positive: "x", workflowId: "" }, LIVE);
  ok("卡片的 workflowId 空字串是內建，不被即時設定蓋過去", builtinCard.workflowId === "", JSON.stringify(builtinCard));

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

// --- Discord 面板的兩種連接方式 ---
// webhook 模式的重點是「少一樣東西」：不必建 bot。但面板上多一個模式，就多一個
// 「加了欄位卻忘記送上去」的失敗方式 —— 那正是這份契約檔開頭講的 rating 出事的樣子。
{
  const src = readFileSync(join(ROOT, "web", "discord.js"), "utf8");
  ok(
    "Discord 面板有兩種連接方式的按鈕",
    src.includes('id="dc-mode-bot"') && src.includes('id="dc-mode-hook"')
  );
  ok("Discord 面板有 webhook 網址欄位", src.includes('id="dc-webhook"'));
  // webhook 網址整條就是憑證（token 在路徑最後一段），跟 bot token 一樣不能是明碼欄位。
  ok(
    "webhook 網址是密碼欄位",
    src.includes('id="dc-webhook" type="password"'),
    "它是憑證，不該用 type=text"
  );
  // 存設定時兩個新欄位都要真的送出去，否則伺服器永遠停在 bot 模式。
  // 要看的是 save() 那一段，不是 refresh() 的 GET —— 兩處打同一個網址，
  // 這條的第一版就切錯視窗、誤報了一次，所以改成從函式本身找起。
  const at = src.indexOf("async function save()");
  const saveBody = at >= 0 ? src.slice(at, at + 900) : "";
  ok("找得到 save() 這一段", at >= 0, "切視窗的錨點不見了，下面兩條會失去意義");
  ok("存設定會把 mode 送上去", saveBody.includes("mode:"), "save() 的 body 裡沒有 mode");
  ok("存設定會把 webhook 送上去", saveBody.includes("webhook:"), "save() 的 body 裡沒有 webhook");

  // 送上去的必須是**面板上選著的**模式，不是伺服器回來的那個。第一版寫成
  // status.mode，於是點了 Webhook 也存不進去（存的還是舊模式），而且狀態列會
  // 立刻改用新模式描述舊資料 —— 面板對使用者說謊。
  ok(
    "存設定送的是面板上選的模式",
    // 只搜 "uiMode" 不夠：save() 的成功分支裡也有一行 uiMode = ...，
    // 整段搜尋照樣命中，把判斷改回 status.mode 也不會紅（第一版就是這樣假綠的）。
    saveBody.includes("mode: uiMode"),
    "save() 送的是 status.mode 的話，切模式永遠存不進去"
  );

  // 連接方式是「你在哪一邊」的選擇，不是「按了會做事」的動作，所以用全站那組
  // 分段控制（方／直／橫 用的 .seg），不要用 primary／ghost 那種動作鈕。
  const modeRow = src.slice(src.indexOf('id="dc-modes"'), src.indexOf('id="dc-modes"') + 420);
  ok("連接方式用全站的分段控制", modeRow.split('class="seg"').length - 1 === 2, modeRow.slice(0, 160));
  ok("分段控制標得出目前選哪一個", src.includes('aria-pressed'), "選中狀態是 .seg[aria-pressed=true] 畫的");
}

// --- 8. 切換畫面的動效：掛對地方，而且不會變成死按鈕 ------------------------
// 這一段守的三件事，都是這一輪真的踩到的，不是預防性的。
{
  const src = readFileSync(join(ROOT, "web", "boot.js"), "utf8");
  const html = readFileSync(join(ROOT, "web", "index.html"), "utf8");
  const css = readFileSync(join(ROOT, "web", "boot.css"), "utf8");

  // (1) 動畫掛在呼叫端，不是掛在 renderCats 的 mode 上。
  //     第一版寫成 `if (mode === "filter") playCatsSwap()`，結果三顆檢視按鈕
  //     完全沒動效 —— 因為「釘選／封禁／只看該時代」走的是 renderCats("search")
  //     （它們只改可見性，共用搜尋那條快路徑），mode 上跟真的搜尋分不出來。
  //     瀏覽器實測才看出 class 從來沒被加上去。
  const vAt = src.indexOf('$("view-filters").addEventListener');
  const vBody = vAt >= 0 ? src.slice(vAt, vAt + 700) : "";
  ok("找得到檢視按鈕的處理函式", vAt >= 0, "切視窗的錨點不見了，下面兩條會失去意義");
  ok(
    "檢視按鈕自己叫動效，不靠 renderCats 的 mode",
    (vBody.match(/playCatsSwap\(\)/g) || []).length === 2,
    "[data-view] 與 #era-only 兩個分支各要一次；靠 mode 判斷的話這三顆按鈕沒有動效"
  );

  // (1b) 動效跑完必須把 is-swapping 拿掉。留著的話，之後任何一個分類由
  //      hidden 轉可見都會**重新符合選擇器**而再放一次 —— 搜尋正好會這樣，
  //      於是「搜尋不給動效」從另一邊被繞過去。實測打字篩掉四個分類再清空，
  //      六個分類全部 cats-swap-in@running。這條擋的是那個。
  const pAt = src.indexOf("function playCatsSwap()");
  const pBody = pAt >= 0 ? src.slice(pAt, src.indexOf("function buildCats()")) : "";
  ok("找得到 playCatsSwap()", pAt >= 0);
  ok(
    "動效跑完會把 class 拿掉",
    pBody.includes("setTimeout") && pBody.split('remove("is-swapping")').length - 1 === 2,
    "要兩次：一次重播前清掉，一次跑完收尾。少了收尾那次，搜尋會跟著閃"
  );
  // 錯開的間隔只能有一份。CSS 算 animation-delay、JS 算「什麼時候跑完」，
  // 兩邊各寫一個數字遲早走散：CSS 改大、JS 提早收尾，動畫會被切斷。
  ok("錯開間隔是共用的 token", pBody.includes("--cats-stagger") && css.includes("--cats-stagger:"));

  // (2) 搜尋輸入刻意不給動效。連續輸入每 120 毫秒觸發一次，每打一個字閃一下
  //     只會更吵 —— 「動效要有目的」那條。這裡守住它不會被順手加回去。
  const qAt = src.indexOf('$("q").addEventListener("input"');
  const qBody = qAt >= 0 ? src.slice(qAt, qAt + 260) : "";
  ok("找得到搜尋輸入的處理函式", qAt >= 0);
  ok("搜尋輸入不放動效", !qBody.includes("playCatsSwap"), "連續輸入每打一個字閃一下會更吵");

  // (3) 檢視器換圖的 decode 要有保底。decode() 不保證 settle（分頁在背景時
  //     實測就不會），沒有保底的話 ‹ › 兩顆按鈕是**死的** —— 按三下、等三秒，
  //     seed 完全不動。卡片淡入那段早就踩過同一個坑，所以那裡有 3000ms 保底。
  const fAt = src.indexOf("function fillViewer(");
  const fBody = fAt >= 0 ? src.slice(fAt, src.indexOf("function fillViewerInfo(")) : "";
  ok("找得到 fillViewer()", fAt >= 0);
  ok("換圖前先解碼", fBody.includes(".decode()"), "直接換 src 會空一幀，那就是「硬跳」");
  ok(
    "解碼有保底，按鈕不會變死的",
    /setTimeout\(paint/.test(fBody),
    "decode() 不 settle 的時候（分頁在背景）上一張／下一張會完全沒反應"
  );
  ok("連按時只畫最後一張", fBody.includes("VIEW_NAV_GEN"), "非同步 decode 回來的順序可能跟按鍵順序不同");

  // (4) 三條警告改成收合式之後，任何一條分支再寫 hidden = true 就會變回硬跳。
  const cAt = src.indexOf("function updateHeatClash()");
  const cEnd = src.indexOf("function identitySummary(");
  const cBody = cAt >= 0 && cEnd > cAt ? src.slice(cAt, cEnd) : "";
  ok("找得到三條警告那一段", cBody.length > 0);
  ok(
    "警告用收合，不用 display:none",
    cBody.length > 0 && !cBody.includes("note.hidden = true"),
    "hidden 沒有過場：一條兩三行的警告一出現就把底下整條側欄推開幾十像素"
  );

  // 收合靠的是 .clash > span 能被裁掉。少了 overflow:hidden，0fr 的格子
  // 會被子元素的 min-content 撐開，收不回去。span 在 HTML 裡也要存在。
  //
  // 下面三條要切出**規則本體**再看宣告，不能整份搜字串 —— 這兩條的第一版就是
  // 這樣假綠的：搜 "grid-template-rows" 會命中同一條規則裡的 transition，
  // 搜 ".clash.is-on" 會命中下面那條 `.clash.is-on > span`。把 0fr 整行刪掉、
  // 把展開規則改名，兩條都照樣通過。
  const rule = (sel) => {
    const at = css.indexOf(sel + " {");
    return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
  };
  ok(
    "警告的收合軌道還在",
    rule(".clash").includes("grid-template-rows: 0fr"),
    "沒有 0fr 就沒有收合，警告會用原本的高度直接卡在那裡"
  );
  ok(
    "展開狀態還在",
    rule(".clash.is-on").includes("grid-template-rows: 1fr"),
    "沒有 1fr 就展不開，警告永遠是 0 高、等於看不見"
  );
  ok(
    "裡層裁得掉",
    rule(".clash > span").includes("overflow: hidden"),
    "少了 overflow:hidden，0fr 的格子會被子元素的 min-content 撐開，收不回去"
  );
  ok(
    "三條警告的 HTML 都有裡層",
    (html.match(/class="hint clash" id="[a-z-]+" hidden><span><\/span>/g) || []).length === 3,
    "少了 <span> 就沒有能裁的子元素"
  );

  // (5) 分級變動原本有自己的 .rating-changed .cats 淡入。那個意圖已經由
  //     cats-swap-in 承接，兩個都留會相乘（外層 0.45→1 疊內層 0→1，中段
  //     亮度掉到 0.67），而且收尾時間不同，看起來像慢了一拍。
  ok("分級的那層淡入已經收掉", !css.includes("rating-fade"), "兩層淡入會相乘");
  // 守的是**程式碼**不是註解：setRating 裡留著一句「這裡本來有一段
  // .rating-changed 淡入」，那是該留的說明。第一版整份搜字串，被自己的
  // 註解絆倒了 —— 契約要問「有沒有人再加這個 class」，不是「有沒有人提到它」。
  ok(
    "對應的 class 也沒人再加",
    !src.includes('classList.add("rating-changed")'),
    "CSS 收掉了，JS 這邊會變成死碼；兩層淡入也會回來"
  );
}

// --- 9. 引擎算出來的矛盾要真的顯示出來 --------------------------------------
// drawOne() 每次都算 contradictions() 並放進回傳值的 conflicts。2026-09-18 之前
// **沒有任何地方讀它** —— `grep -rn conflicts web/*.js` 只命中 engine.js 自己。
// 引擎知道「這張圖同時是室內又室外」，然後把結論丟掉。
//
// 這一條守的是那條線接著：boot.js 要呼叫 clashLine 並畫到卡片上。
{
  const src = readFileSync(join(ROOT, "web", "boot.js"), "utf8");
  const eng = readFileSync(join(ROOT, "web", "engine.js"), "utf8");
  ok("engine 匯出 clashLine", eng.includes("export function clashLine("));
  ok("boot.js 匯入 clashLine", src.includes("clashLine,"));
  ok("boot.js 真的呼叫它", src.includes("clashLine(lex,"));
  // 畫在卡片上，跟「釘選未入」同一個位置。只有匯入沒有畫等於沒接。
  const at = src.indexOf("function paintPinMiss(");
  const body = at >= 0 ? src.slice(at, at + 900) : "";
  ok("找得到卡片警告那一段", at >= 0);
  ok("矛盾畫成卡片上的一行警告", body.includes("pos-clash"), "沒有 .warn.pos-clash 就是算了不顯示");
  ok("釘選未入那一行還在", body.includes("pin-miss"));
}

// --- 10. 頂欄通知設定：一個入口、兩個服務 -----------------------------------
// Telegram 和 Discord 各放一顆頂欄按鈕時，狀態分散又擠壓小螢幕的工具列。
// 這裡不測某個 CSS 像素值，而是守住互動的結構：一個設定入口、兩個可辨識
// 的服務選項，並要求選單切換只走 compositor-friendly 的屬性。
{
  const servicePath = join(ROOT, "web", "service-settings.js");
  const src = existsSync(servicePath) ? readFileSync(servicePath, "utf8") : "";
  const tg = readFileSync(join(ROOT, "web", "telegram.js"), "utf8");
  const dc = readFileSync(join(ROOT, "web", "discord.js"), "utf8");
  const lora = readFileSync(join(ROOT, "web", "lora.js"), "utf8");
  const css = readFileSync(join(ROOT, "web", "boot.css"), "utf8");

  ok("通知設定有共用模組", src.length > 0, "缺少 web/service-settings.js，頂欄會回到兩顆分散按鈕");
  ok(
    "通知設定只有一個齒輪入口",
    (src.match(/id="service-settings-btn"/g) || []).length === 1 && src.includes('aria-label="通知設定"'),
    "入口應該是一顆具名的設定按鈕，不是 Telegram／Discord 各一顆"
  );
  ok(
    "通知選單保留 Telegram 與 Discord 兩個品牌選項",
    src.includes('data-service="telegram"') && src.includes('data-service="discord"') && src.includes("TELEGRAM_ICON") && src.includes("DISCORD_ICON"),
    "服務不能只剩文字或其中一個品牌圖示"
  );
  ok(
    "Telegram 與 Discord 不再自行注入頂欄按鈕",
    !tg.includes('id = "tg-btn"') && !dc.includes('id = "dc-btn"'),
    "留下舊按鈕會重新出現兩個入口"
  );
  ok(
    "服務選單的開關只轉場透明度與位移",
    css.includes(".service-menu") && css.includes("opacity var(--dur-ui)") && css.includes("transform var(--dur-ui)") && !css.includes(".service-menu {\n  transition: height"),
    "切換若動畫高度會推動頂欄，造成畫面跳動"
  );
  ok(
    "底模按鈕使用模型層疊圖示，不再誤用齒輪",
    lora.includes("ckpt-layers") && !lora.includes("ckpt-gear"),
    "底模應使用 layers 語意圖示，避免與通知設定齒輪混淆"
  );
}

// --- 11. Workflow 面板保留 ComfyUI 位址設定 --------------------------------
// README 對使用者承諾可以從畫面改 ComfyUI 位址。Workflow 面板改版時若只留下
// profile 選擇，遠端／區網 Comfy 就只能回頭改設定檔，且既有 /api/comfy 入口變死碼。
{
  const src = readFileSync(join(ROOT, "web", "workflow.js"), "utf8");
  ok("workflow 面板有 ComfyUI 網址欄位", src.includes('id="wf-url"') && src.includes('id="wf-url-save"'));
  ok("workflow 面板會讀取 ComfyUI 網址", src.includes('getJson("/api/comfy")'));
  ok("workflow 面板會儲存 ComfyUI 網址", src.includes('getJson("/api/comfy", {') && src.includes('method: "POST"'));
  const openAt = src.indexOf("function openModal(");
  const closeAt = src.indexOf("function closeModal(", openAt);
  const openBody = openAt >= 0 && closeAt > openAt ? src.slice(openAt, closeAt) : "";
  ok("workflow 面板開啟後把焦點移進 dialog", openBody.includes('$("wf-close")?.focus()'));
  ok(
    "workflow API 有逾時，不會永遠卡在讀取中",
    src.includes("AbortSignal.timeout") && src.includes("連線逾時"),
    "fetch 必須有截止時間，且要把逾時轉成畫面可讀的錯誤"
  );
  ok(
    "快速切換 workflow 會丟棄舊回應",
    src.includes("workflowRequestGeneration") && src.includes("requestedId !== WORKFLOW_ID"),
    "舊 profile 回應不可覆蓋使用者後選的新 profile"
  );
  ok(
    "mapping 寫入會依序執行",
    src.includes("mappingWrite") && src.includes("mappingWrite.then"),
    "連點 mapping 不可讓舊回應最後寫回"
  );
  ok(
    "大型 workflow 在讀入記憶體前就被拒絕",
    src.indexOf("file.size") >= 0 && src.indexOf("file.size") < src.indexOf("file.text()"),
    "必須先檢查 5 MB 上限再呼叫 file.text()"
  );
  ok(
    "workflow dialog 會攔住 Tab 焦點",
    src.includes('e.key === "Tab"') && src.includes("focusable"),
    "鍵盤焦點不可跑到 modal 背後"
  );

  const css = readFileSync(join(ROOT, "web", "lora.css"), "utf8");
  const mobileAt = css.indexOf("@media (max-width: 760px)");
  const mobileCss = mobileAt >= 0 ? css.slice(mobileAt) : "";
  ok(
    "手機版 workflow selector 能覆蓋桌面雙欄",
    mobileCss.includes(".wf-modal .lora-modal-inner") && mobileCss.includes("grid-template-columns: 1fr"),
    "手機 selector specificity 必須至少等於桌面規則"
  );
  ok(
    "手機 ComfyUI 網址輸入不觸發 iOS 自動縮放",
    mobileCss.includes(".wf-url-row input") && mobileCss.includes("font-size: 16px"),
    "mobile input font-size 必須至少 16px"
  );
}

// --- 9. 左欄搜尋：重用建表時的 DOM 索引，不在每次輸入重走祖先與選擇器 ----------
{
  const src = readFileSync(join(ROOT, "web", "boot.js"), "utf8");
  const at = src.indexOf("function syncVisibility(");
  const end = src.indexOf("function renderCats(", at);
  const body = at >= 0 && end > at ? src.slice(at, end) : "";
  ok("找得到左欄可見性同步函式", body.length > 0);
  ok(
    "搜尋熱路徑使用預先建立的 DOM 索引",
    body.includes("catDomIndex") && !body.includes(".closest(") && !body.includes("querySelectorAll("),
    "每打一個字都對上千個 tag 做 closest/querySelectorAll，會製造同步 layout 與大量 DOM traversal"
  );
}

{
  ok("前景輪詢是 2500ms", loraPollDelay(false, 8000) === 2500);
  ok("背景輪詢會拉長", loraPollDelay(true, 2500) === 4000);
  ok("背景輪詢有上限", loraPollDelay(true, 30000) === 30000);
}

{
  const src = readFileSync(join(ROOT, "web", "boot.js"), "utf8");
  const album = readFileSync(join(ROOT, "web", "album.js"), "utf8");
  ok("抽牌會開 trace", src.includes("trace: true"));
  ok("卡片有收藏按鈕", src.includes("fav-shot"));
  ok("有作品冊入口", existsSync(join(ROOT, "web", "album.js")));
  ok("有 commands 介面", existsSync(join(ROOT, "web", "commands.js")));
  ok("有 trace 模組", existsSync(join(ROOT, "web", "trace.js")));
  ok("有 rating 規則模組", existsSync(join(ROOT, "web", "rules", "rating.js")));
  ok(
    "commands pin 用 applyPin，不會誤切成封禁",
    /pin\(tag\) \{[\s\S]{0,180}applyPin\(lex/.test(src),
    "onTagClick 會在釘選上再點一次變成封禁",
  );
  ok(
    "配方重現時若正在抽圖就先退出",
    /async function generateFromRecipe[\s\S]{0,400}if \(running\)/.test(src),
  );
  ok(
    "為什麼入口做在卡片 bar 裡，收合不加高",
    src.includes("why-btn") && src.includes("複製 POS") && src.includes("ghost why-btn"),
  );
  ok("作品冊打開才拉清單", album.includes("function openModal") && /function openModal\(\) \{[\s\S]*refresh\(/.test(album));
  ok(
    "initAlbum 啟動時不預先打 /api/recipes",
    !/export function initAlbum[\s\S]*refresh\(\)\.catch/.test(album),
  );
  ok(
    "抽圖把 presetOwned 交給 ownedTagSet，不當 Set 展開物件",
    src.includes("ownedTagSet(") && !src.includes("new Set(presetOwned || [])"),
  );
  ok(
    "套用配方會重畫時代與尺寸按鈕",
    /async function applyRecipeToBench[\s\S]{0,900}renderEras\(\)/.test(src) &&
      /async function applyRecipeToBench[\s\S]{0,900}syncSizeButtons\(\)/.test(src),
  );
  ok(
    "卡片取消收藏要確認",
    album.includes("window.confirm") && /dataset.recipeId[\s\S]{0,400}confirm/.test(album),
  );
  ok(
    "配方 LoRA 觸發詞不把兩槽合成一串再寫進每一槽",
    !/trigger:\s*currentTriggerText\(\)/.test(src),
  );
}

{
  ok("強度 0 要保留", typeof loraStrengthFromSpec === "function" && loraStrengthFromSpec({ strength: 0 }) === 0);
  ok("缺強度時用 0.8", typeof loraStrengthFromSpec === "function" && loraStrengthFromSpec({}) === 0.8);
  ok("強度 1 原樣", typeof loraStrengthFromSpec === "function" && loraStrengthFromSpec({ strength: 1 }) === 1);

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/api/loras")) {
      return {
        json: async () => ({
          items: [
            { file: "a.safetensors", name: "a", folder: "style", trainedWords: ["alpha", "beta"] },
            { file: "b.safetensors", name: "b", folder: "style", trainedWords: ["gamma", "delta"] },
          ],
        }),
      };
    }
    if (u.includes("/api/checkpoints")) {
      return { json: async () => ({ items: [{ ckpt_name: "wai.safetensors", file: "wai.safetensors", title: "wai" }] }) };
    }
    throw new Error("unexpected fetch " + u);
  };
  invalidateModelLists();
  const missing = await applyRecipeModels({
    loras: [
      { file: "a.safetensors", name: "a", strength: 0.5, trigger: "beta" },
      { file: "b.safetensors", name: "b", strength: 1, trigger: "gamma" },
    ],
  });
  globalThis.fetch = prevFetch;
  ok("套用配方時清單都找得到", Array.isArray(missing) && missing.length === 0, JSON.stringify(missing));
  const payload = currentLorasPayload();
  ok(
    "套用後每槽觸發詞跟配方一樣",
    payload[0]?.trigger === "beta" && payload[1]?.trigger === "gamma",
    JSON.stringify(payload),
  );
  ok(
    "套用後強度跟配方一樣",
    payload[0]?.strength === 0.5 && payload[1]?.strength === 1,
    JSON.stringify(payload),
  );
  ok("currentTriggerText 是兩槽分開組的", currentTriggerText() === "beta, gamma", currentTriggerText());
}

// --- 介面與交互的六道守衛 -----------------------------------------------------
// 這六條各自對應一個量到的洞，不是泛用的可及性清單。寫在這裡的理由跟檔頭一樣：
// 能抽成純函式的就抽（存組合、背景 inert），抽不動的就守原始碼的形狀。

// 1. 生圖失敗不是斷頭路：重抽鈕在 .card.is-done 以外也要露出來。
//    redo 的機制（resetCardForRedo 會清掉 is-fail）本來就吃得下失敗的卡片，
//    擋住它的一直只有這幾條 CSS 選擇器。
{
  // 工作目錄的行尾是 CRLF（.gitattributes 是 text=auto），跨行比對前先正規化，
  // 不然這條守衛會因為 git 換了一次行尾就無聲地變成永遠綠。
  const css = readFileSync(join(ROOT, "web", "boot.css"), "utf8").split(CR).join("");
  ok(
    "失敗的卡片看得到重抽鈕",
    css.includes(".card.is-fail .redo-shot") && css.includes(".card.is-img-fail .redo-shot"),
    "boot.css 只讓 .card.is-done 顯示 .redo-shot",
  );
  // display:grid 只讓它進版面，.redo-shot 的基準是 opacity:0 / pointer-events:none。
  // 少了這一組就是畫出來卻永遠透明、按不到。
  // 同一組選擇器出現兩次：一次開 display，一次開 opacity。要的是後者。
  const sel = ".card.is-fail .redo-shot," + NL + ".card.is-img-fail .redo-shot {";
  let alwaysOn = false;
  for (let at = css.indexOf(sel); at >= 0; at = css.indexOf(sel, at + 1)) {
    const body = css.slice(at, css.indexOf("}", at));
    if (body.includes("opacity: 1;") && body.includes("pointer-events: auto;")) alwaysOn = true;
  }
  ok("失敗卡片的重抽鈕不必滑過就看得見、按得到", alwaysOn, "只有 display:grid，沒有把 opacity／pointer-events 打開");
  const touchBlock = css.slice(css.indexOf("@media (hover: none) {"));
  ok(
    "觸控裝置上失敗卡片的重抽鈕直接常亮",
    touchBlock.includes(".card.is-fail .redo-shot"),
    "手機沒有 hover，不常亮就等於沒有",
  );
}

// 2.「清除釘選」會連封禁一起清掉 —— 那就得說出口，而且要收得回來。
{
  const html = readFileSync(join(ROOT, "web", "index.html"), "utf8");
  const src = readFileSync(join(ROOT, "web", "boot.js"), "utf8");
  ok(
    "清除鈕的字面說得出它也清封禁",
    /id="clear-pins"[^>]*>[^<]*關掉/.test(html) || /id="clear-pins"[^>]*>[^<]*封禁/.test(html),
    "按鈕只寫「清除釘選」，但 handler 同時清掉 userBanned",
  );
  ok("清除釘選有復原窗", src.includes("clearedSnapshot"), "清掉就沒了，沒有任何回頭路");
  ok(
    "復原窗開著時又動了釘選，窗要收掉",
    src.includes("onPinsTouched") && /onPinsTouched = \(\) => \{[\s\S]{0,200}?endClearUndo\(\)/.test(src),
    "七秒內新釘的字會被「復原」連帶抹掉",
  );
  ok(
    "清除釘選會出聲（跟清除權重／清除必抽一致）",
    /clear-pins[\s\S]{0,900}?speak\(/.test(src),
    "隔壁兩顆都有 speak()，只有這顆靜悄悄",
  );
}

// 3. 存釘選組合：sanitize 丟掉的時候不准還說「已存」。
{
  // knownTags 查的是 lex.byTag，兩個字夠了。
  const lexStub = { byTag: new Map([["a", {}], ["b", {}]]) };
  const base = [{ name: "有的", tags: ["a"] }];
  const blank = addPinPreset(base, { name: "   ", tags: ["a"] }, lexStub);
  ok("空白名稱存不進去，而且說得出原因", blank.ok === false && blank.reason === "empty", JSON.stringify(blank));
  const dup = addPinPreset(base, { name: "有的", tags: ["b"] }, lexStub);
  ok("重名存不進去，而且說得出原因", dup.ok === false && dup.reason === "duplicate", JSON.stringify(dup));
  const full = Array.from({ length: 16 }, (_, i) => ({ name: "n" + i, tags: ["a"] }));
  const over = addPinPreset(full, { name: "第十七個", tags: ["b"] }, lexStub);
  ok("滿 16 組之後存不進去，而且說得出原因", over.ok === false && over.reason === "full", JSON.stringify(over));
  const good = addPinPreset(base, { name: "新的", tags: ["b"] }, lexStub);
  ok("正常的存得進去", good.ok === true && good.list.length === 2, JSON.stringify(good));
  ok("存進去不會動到原本那份", base.length === 1, JSON.stringify(base));
  const src = readFileSync(join(ROOT, "web", "boot.js"), "utf8");
  ok("存組合的 handler 走 addPinPreset", src.includes("addPinPreset("), "還在自己 push 完就無條件說已存");
}

// 4. 權重要有鍵盤進得去的路。.w-flag 是 <button> 裡的 span[role=button]，
//    永遠拿不到焦點 —— 唯一能補的位置是字牌自己身上的一個按鍵。
{
  const src = readFileSync(join(ROOT, "web", "boot.js"), "utf8");
  ok("字牌上有按鍵可以打開權重彈窗", src.includes("openWeightPopFromFocus"), "權重只有滑鼠進得去");
  const help = readFileSync(join(ROOT, "web", "lora.js"), "utf8");
  const panelStart = help.indexOf("shortcuts-panel");
  const panel = help.slice(panelStart, help.indexOf("document.body.appendChild(ov)", panelStart));
  ok("快捷鍵面板列了開權重那顆鍵", panel.includes(">W<"), "加了鍵卻沒寫在說明裡，等於沒加");
  ok("快捷鍵面板也列了無限抽的 I", panel.includes(">I<"), "I 早就綁了，面板一直沒寫");
}

// 5. 權重彈窗關掉要把焦點還回去 —— 大圖檢視器（VIEW_RETURN）做對了，這裡漏了。
{
  const src = readFileSync(join(ROOT, "web", "boot.js"), "utf8");
  ok("權重彈窗記得從哪裡開的", src.includes("weightPopReturn"), "關掉之後焦點掉到 body，Tab 要從頭來過");
}

// 6. 彈窗開著時背景要 inert —— 七個疊層都是 aria-modal，但背後的 .shell／.dock
//    還在 tab 序裡，Tab 會直接走出去。共同的掛勾是 lockScroll：七個都呼叫它。
{
  const style = document.documentElement.style;
  const prevKids = document.body.children;
  style.overflow = "clip";
  const mk = (id) => ({ id, tagName: "DIV", inert: false });
  const mast = mk("mast");
  const shell = mk("shell");
  const dock = mk("dock");
  const live = mk("live");
  const loraModal = mk("lora-modal");
  const tarot = mk("lora-tarot");
  const closedModal = mk("tg-modal");
  closedModal.inert = true;
  document.body.children = [mast, shell, dock, live, loraModal, tarot, closedModal];

  loraModal.inert = false;
  lockScroll("lora-modal");
  ok(
    "彈窗開著時背景進 inert",
    mast.inert === true && shell.inert === true && dock.inert === true,
    `mast=${mast.inert} shell=${shell.inert} dock=${dock.inert}`,
  );
  ok("開著的那個彈窗自己不會被 inert", loraModal.inert === false, String(loraModal.inert));
  ok("aria-live 區不能被 inert，不然彈窗裡的播報會消失", live.inert === false, String(live.inert));

  tarot.inert = false;
  lockScroll("lora-tarot");
  ok("疊第二層時兩層都是活的", loraModal.inert === false && tarot.inert === false, `${loraModal.inert} ${tarot.inert}`);

  unlockScroll("lora-tarot");
  ok("關掉第二層，第一層還是活的、背景還鎖著", loraModal.inert === false && shell.inert === true, `${loraModal.inert} ${shell.inert}`);

  unlockScroll("lora-modal");
  ok(
    "全部關掉，背景放出來",
    mast.inert === false && shell.inert === false && dock.inert === false,
    `mast=${mast.inert} shell=${shell.inert} dock=${dock.inert}`,
  );
  ok(
    "本來就關著的彈窗不會被順手打開",
    closedModal.inert === true,
    "解鎖時不分青紅皂白清 inert，會把關著的彈窗放回 tab 序",
  );
  document.body.children = prevKids;
  style.overflow = "clip";
}

if (failed) {
  console.error(NL + failed + " failed");
  process.exit(1);
}
console.log(NL + "ok");
