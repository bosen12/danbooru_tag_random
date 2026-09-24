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
import { fileURLToPath, pathToFileURL } from "url";

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
const { albumRows, albumChipOptions, captionMeta, recipeThumbUrl, missingLines, canReproduce } =
  await import("../web/album.js");
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
  // role="radiogroup" 對螢幕閱讀器的承諾：Tab 只停在選著的那一個，方向鍵換選項。
  // 以前兩顆都在 Tab 順序裡、方向鍵沒反應 —— 宣告了 radio 卻表現得像兩顆普通按鈕。
  ok("連接方式只有選著的那個在 Tab 順序裡", /el\.tabIndex = on \? 0 : -1/.test(src));
  ok("連接方式用方向鍵切換", /\$\("dc-modes"\)\?\.addEventListener\("keydown"[\s\S]{0,400}Arrow/.test(src));
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

// --- 底模預覽只在底模視窗打開時才載 ------------------------------------------
// 實測：預設底模 waiIllustriousSDXL_v170 的預覽是 2048×2688、5.9 MB 的 PNG，
// 顯示成 55×55。開機時 fetchCkpts() 順手 renderCkptCurrent()，把它塞進**關著的**
// 底模視窗 —— 佔每次開頁總傳輸的 95%，快取命中也要再解碼一次（約 42 ms、21 MB）。
// 套用作品冊配方走 selectCkpt()，還會連整份清單（17 列、8.7 MB）一起畫。
// 打開視窗的 openCkptModal() 本來就會重畫，所以關著的時候什麼都不必畫。
{
  const loads = [];
  let modalOpen = false;
  const fakeEl = (id) => {
    const el = {
      id,
      value: "",
      dataset: {},
      style: {},
      children: [],
      classList: {
        contains: (c) => id === "ckpt-modal" && c === "open" && modalOpen,
        add() {},
        remove() {},
        toggle() {},
      },
      setAttribute() {},
      addEventListener() {},
      querySelector: () => fakeEl(""),
      append(...xs) { el.children.push(...xs); },
      appendChild(x) { el.children.push(x); return x; },
      replaceChildren() { el.children = []; },
    };
    let src = "";
    Object.defineProperty(el, "src", {
      get: () => src,
      set: (v) => {
        src = String(v);
        loads.push({ src, lazy: el.loading === "lazy" });
      },
    });
    return el;
  };
  const prevDoc = { get: document.getElementById, create: document.createElement };
  document.getElementById = (id) => (id === "lora-toast" ? null : fakeEl(id));
  document.createElement = () => fakeEl("");
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/api/checkpoints")) {
      return {
        json: async () => ({
          items: [
            { ckpt_name: "wai.safetensors", file: "wai.safetensors", title: "wai", preview: "wai.preview.png" },
            { ckpt_name: "hsk.safetensors", file: "hsk.safetensors", title: "hsk", preview: "hsk.preview.png" },
          ],
        }),
      };
    }
    if (u.includes("/api/loras")) return { json: async () => ({ items: [] }) };
    throw new Error("unexpected fetch " + u);
  };

  invalidateModelLists();
  await applyRecipeModels({ checkpoint: "hsk.safetensors" });
  const closedLoads = loads.filter((l) => l.src.includes("ckpt-preview"));
  ok(
    "底模視窗關著時不載任何預覽圖",
    closedLoads.length === 0,
    `關著的視窗裡載了 ${closedLoads.length} 張：${closedLoads.map((l) => l.src).join("、")}`,
  );

  loads.length = 0;
  modalOpen = true;
  await applyRecipeModels({ checkpoint: "wai.safetensors" });
  const openLoads = loads.filter((l) => l.src.includes("ckpt-preview"));
  ok("底模視窗打開時照常畫預覽", openLoads.length > 0, "修過頭：打開視窗也看不到預覽");
  const eagerRows = openLoads.filter((l) => !l.lazy && l.src.includes("hsk"));
  ok(
    "清單裡非目前底模的縮圖延後載入",
    eagerRows.length === 0,
    `${eagerRows.length} 張清單縮圖沒有 loading="lazy"，一打開視窗就全部下載`,
  );

  globalThis.fetch = prevFetch;
  document.getElementById = prevDoc.get;
  document.createElement = prevDoc.create;
  invalidateModelLists();
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

// --- 作品冊：印樣、篩選、缺件 -------------------------------------------------
// 這一組守的是「重新設計之後不要又退回檔名列表」。三個篩選變數以前被讀、
// 卻從來沒有人寫，整組篩選器是空殼而且沒有任何測試看得見 —— 所以先把純的
// 那一半（篩選、排序、籤條選項、說明行）抽出來，讓它們有斷言可守。

const ALBUM_FIXTURE = [
  { id: "a", name: "江戶 · 煮飯", era: "edo", rating: "explicit", seed: 1, checkpoint: "m/wai17.safetensors", loras: ["s/film.safetensors"], updatedAt: "2026-09-03T00:00:00Z", image: { file: "a.png" } },
  { id: "b", name: "泳池 · 逆光", era: "modern", rating: "sensitive", seed: 2, checkpoint: "m/wai17.safetensors", loras: [], updatedAt: "2026-09-05T00:00:00Z" },
  { id: "c", name: "維多利亞舞會", era: "victorian", rating: "general", seed: 3, checkpoint: "m/wai14.safetensors", loras: ["s/film.safetensors", "c/nurse.safetensors"], updatedAt: "2026-09-01T00:00:00Z", image: { file: "c.png" }, thumbnail: { file: "c-thumb.png" } },
];

{
  const names = (rows) => rows.map((r) => r.id).join("");

  ok("沒有篩選就是全部", names(albumRows(ALBUM_FIXTURE, {})) === "bac", names(albumRows(ALBUM_FIXTURE, {})));
  ok(
    "預設照 updatedAt 由新到舊",
    names(albumRows(ALBUM_FIXTURE, { sort: "time" })) === "bac",
    names(albumRows(ALBUM_FIXTURE, { sort: "time" })),
  );
  ok("照名稱排是用 zh-Hant 的規則", albumRows(ALBUM_FIXTURE, { sort: "name" }).length === 3);

  // 搜得到中文時代名，是這次才加的：詞庫裡存的是 edo／victorian，
  // 畫面上寫的是江戶／維多利亞，使用者搜的一定是後者。
  ok(
    "搜尋吃得下中文時代名",
    names(albumRows(ALBUM_FIXTURE, { query: "江戶" })) === "a",
    names(albumRows(ALBUM_FIXTURE, { query: "江戶" })),
  );
  ok("搜尋吃得下底模檔名", names(albumRows(ALBUM_FIXTURE, { query: "wai14" })) === "c");
  ok("搜尋不分大小寫", names(albumRows(ALBUM_FIXTURE, { query: "WAI14" })) === "c");
  ok("搜不到就是空的，不是全部", albumRows(ALBUM_FIXTURE, { query: "zzz" }).length === 0);

  // 這三條以前都是死的：變數被讀，沒有任何一行寫進去。
  ok(
    "底模籤條篩得動",
    names(albumRows(ALBUM_FIXTURE, { ckpt: "m/wai17.safetensors" })) === "ba",
    names(albumRows(ALBUM_FIXTURE, { ckpt: "m/wai17.safetensors" })),
  );
  ok("底模是整條比對，不是字串包含", albumRows(ALBUM_FIXTURE, { ckpt: "wai17.safetensors" }).length === 0);
  ok("時代籤條篩得動", names(albumRows(ALBUM_FIXTURE, { era: "victorian" })) === "c");
  ok(
    "LoRA 籤條篩得動",
    names(albumRows(ALBUM_FIXTURE, { lora: "s/film.safetensors" })) === "ac",
    names(albumRows(ALBUM_FIXTURE, { lora: "s/film.safetensors" })),
  );
  ok("兩條籤疊起來是交集", names(albumRows(ALBUM_FIXTURE, { ckpt: "m/wai17.safetensors", era: "edo" })) === "a");
  ok("篩不到任何一筆就回空陣列", albumRows(ALBUM_FIXTURE, { ckpt: "m/wai14.safetensors", era: "edo" }).length === 0);
  ok("傳進來的陣列不會被就地排序", ALBUM_FIXTURE[0].id === "a", ALBUM_FIXTURE.map((r) => r.id).join(""));
}

{
  const opts = albumChipOptions(ALBUM_FIXTURE);
  ok(
    "底模籤條照出現次數排",
    opts.ckpt.map((o) => `${o.value}:${o.count}`).join(" ") === "m/wai17.safetensors:2 m/wai14.safetensors:1",
    JSON.stringify(opts.ckpt),
  );
  ok("LoRA 籤條把每一個都算進去", opts.lora.length === 2 && opts.lora[0].count === 2, JSON.stringify(opts.lora));
  ok("時代籤條三種各一", opts.era.length === 3, JSON.stringify(opts.era));

  // 只有一種值的那條籤，按下去篩不掉任何東西 —— 列出來只是佔掉印樣的高度。
  const same = ALBUM_FIXTURE.map((it) => ({ ...it, checkpoint: "only.safetensors" }));
  ok("整本只有一個底模時整條籤不列", albumChipOptions(same).ckpt.length === 0, JSON.stringify(albumChipOptions(same).ckpt));
  ok("空的作品冊不會炸", albumChipOptions([]).era.length === 0 && albumChipOptions(null).ckpt.length === 0);
}

{
  // 自動命名是「現代 · seed 2928072855」。說明行再印一次時代和 seed，
  // 同一格就把同一件事講兩遍，第二遍不帶任何新消息。
  const auto = { name: "現代 · seed 2928072855", era: "modern", rating: "explicit", seed: 2928072855, checkpoint: "m/wai17.safetensors" };
  const line = captionMeta(auto);
  ok("說明行不重複名字裡已經有的時代", !line.includes("現代"), line);
  ok("說明行不重複名字裡已經有的 seed", !line.includes("seed"), line);
  ok("說明行留下名字沒講的分級", line.includes("色情"), line);
  ok("底模只留最後一段路徑", line.includes("wai17.safetensors") && !line.includes("m/"), line);
  ok(
    "整本同一個底模時說明行不印底模",
    !captionMeta(auto, { showCkpt: false }).includes("wai17"),
    captionMeta(auto, { showCkpt: false }),
  );
  const named = captionMeta({ name: "我自己取的", era: "edo", rating: "general", seed: 7, checkpoint: "a.safetensors" });
  ok("名字沒提到的就照常印出來", named === "江戶 · 全年齡 · seed 7 · a.safetensors", named);
}

{
  ok("有縮圖就用縮圖", recipeThumbUrl(ALBUM_FIXTURE[2]) === "/api/recipes/files/c-thumb.png", recipeThumbUrl(ALBUM_FIXTURE[2]));
  ok("沒縮圖就退回原圖", recipeThumbUrl(ALBUM_FIXTURE[0]) === "/api/recipes/files/a.png");
  ok("兩個都沒有就給空字串，不是 undefined", recipeThumbUrl(ALBUM_FIXTURE[1]) === "");
  ok("檔名要跳脫，不能直接串進網址", recipeThumbUrl({ image: { file: "a b&c.png" } }).includes("a%20b%26c.png"));
}

{
  // 底模或工作流不在就真的生不出來；LoRA 不在只是風格會掉。
  ok("底模不在就重現不了", canReproduce({ checkpoint: true, loras: [], workflow: false }) === false);
  ok("工作流不在就重現不了", canReproduce({ checkpoint: false, loras: [], workflow: true }) === false);
  ok("只有 LoRA 不在仍然重現得了", canReproduce({ checkpoint: false, loras: ["x"], workflow: false }) === true);
  ok("什麼都不缺當然可以", canReproduce({}) === true && canReproduce(null) === true);

  const lines = missingLines({ checkpoint: true, loras: ["a.safetensors", "b.safetensors"], workflow: false }, { checkpoint: "gone.safetensors" });
  ok("缺件是一行一件，不是用分號串成一句", lines.length === 3, JSON.stringify(lines));
  ok("缺件講得出是哪一個底模", lines[0].includes("gone.safetensors"), lines[0]);
  ok("沒缺件就回空陣列", missingLines({}, {}).length === 0);
}

{
  const src = readFileSync(join(ROOT, "web", "album.js"), "utf8");
  ok("印樣真的畫圖出來，不是印檔名", src.includes('createElement("img")') && src.includes("recipeThumbUrl("), "作品冊又變回檔名列表了");
  ok("縮圖延後載入", src.includes('img.loading = "lazy"'), "一次把幾十張原圖全塞進去");
  // <button> 當 grid item 時貢獻給 auto 列的高度是錯的，每一列會疊在上一列身上。
  ok("格線的項目是外層 div 不是按鈕", src.includes('wrap.className = "album-cell-wrap"'), "列高會被算錯，格子互相重疊");
  ok("容器 role=list 的話項目要有 role=listitem", src.includes('wrap.setAttribute("role", "listitem")'));
  ok("重現不了的時候那顆鈕按不下去", /go\.disabled = true/.test(src), "以前按得下去，按了才失敗");
  ok("套用到工作台會先問過", /album-apply[\s\S]{0,400}?window\.confirm\(/.test(src) || /apply\.addEventListener[\s\S]{0,400}?window\.confirm\(/.test(src), "這顆會把工作臺整組換掉且不能復原");
  ok("籤條真的寫得進那三個篩選變數", /filterCkpt = v/.test(src) && /filterEra = v/.test(src) && /filterLora = v/.test(src), "篩選器又變回空殼");
  ok("按籤條不重建整排（不然焦點會掉）", src.includes("paintChipStates"), "用鍵盤連按兩條籤會掉焦點");
  ok("改得了名字", src.includes("async function rename("), "只能靠「複製後微調」改名");

  const css = readFileSync(join(ROOT, "web", "lora.css"), "utf8").split(CR).join("");
  ok("作品冊有自己的版面，不再借 LoRA 挑選器的比例", css.includes(".album-modal .album-inner"), "又回去用 320px 檔名側欄");
  ok("印樣是格線", css.includes(".album-grid {") && css.includes("grid-template-columns: repeat(auto-fill"), "");
  ok("標題／工具列／籤條不准被壓縮", /\.album-head,\s*\n\.album-tools,\s*\n\.album-chips \{\s*\n\s*flex: 0 0 auto;/.test(css), "籤條會被 max-height 壓扁並溢出容器");
  ok("印樣自己捲，不會蓋到右邊詳情", /\.album-main \{[\s\S]*?overflow: hidden;/.test(css), "手機版格子會畫到「目前選擇」上面");
}

// --- 卡片與左欄的版面：量到的四個洞 -------------------------------------------
{
  const strip = (t) => t.split(CR).join("");
  const boot = strip(readFileSync(join(ROOT, "web", "boot.css"), "utf8"));
  const web = strip(readFileSync(join(ROOT, "web", "styles.css"), "utf8"));
  const w4 = strip(readFileSync(join(ROOT, "web4", "styles.css"), "utf8"));
  const block = (css, sel) => {
    const out = [];
    let at = css.indexOf(sel + " {");
    while (at >= 0) {
      out.push(css.slice(at, css.indexOf("}", at) + 1));
      at = css.indexOf(sel + " {", at + 1);
    }
    return out.join(NL);
  };

  // 只抽牌的 .shot 原本寫 min-height: 4.5rem 想要一條窄帶，但基本樣式的 aspect-ratio
  // 照樣生效，實測 299×299 的空白方框只寫「只抽牌 · 無圖」，真正的輸出（tag）被推到下面。
  ok(
    "只抽牌卡片的圖片區是窄帶，不是空白方框",
    /aspect-ratio:\s*auto/.test(block(boot, '.card[data-pos-only="1"] .shot')),
    "基本樣式的 aspect-ratio 會把窄帶撐成正方形",
  );

  // 權重小標 15×15，::before 只往外擴 3px（21×21），低於 24px 的最小點擊範圍。
  const flagHit = block(boot, ".w-flag::before").match(/inset:\s*-(\d+)px/);
  ok("權重小標的點擊範圍至少 24px", !!flagHit && 15 + 2 * Number(flagHit[1]) >= 24, flagHit ? `15 + 2×${flagHit[1]}` : "找不到 inset");

  // 左欄 224px 放不下五顆 52px 的尺度鈕：3+2 折行、時代七顆寬度 52～78 不等排成三行。
  // 對齊到同一個三欄格線，每一列看起來就是刻意排的。
  ok("排字匣左欄的選項列對齊三欄格線", /\.step > \.row \{[^}]*grid-template-columns:\s*repeat\(3,/.test(web), "");
  ok("導影台左欄的選項列對齊三欄格線", /\.step > \.row \{[^}]*grid-template-columns:\s*repeat\(3,/.test(w4), "");

  // 還沒有成片時「拷貝 POS／放大成片」按下去只會說「還沒有成片」。
  ok(
    "導影台沒有成片時不顯示成片工具",
    /\.stage:has\(\.results:empty\) \.stage-tools \{[^}]*display:\s*none/.test(w4),
    "按鈕看起來能按，按了才告訴你沒東西",
  );

  // 導影台的卡片把每個 tag 畫成有框的方塊（flex），boot.js 在中間放的 " · " 文字節點
  // 因此各自變成一個孤立的 flex 項目，換行時掛在行尾。有框就不需要分隔點。
  ok(
    "導影台卡片的 tag 之間沒有孤立的分隔點",
    /\.studio \.card \.pos \{[^}]*font-size:\s*0/.test(w4) && /\.studio \.card \.pos > \[data-tag\] \{[^}]*font-size:\s*var\(--text-sm\)/.test(w4),
    "text node 的「·」在 flex 裡會掛在行尾",
  );

  // 導影台在手機寬度（390px）頂欄不換行：工具區只分到 166px，裡面的鈕比那寬，
  // justify-content:flex-end 讓溢出往左跑，整排工具壓在「導影台」三個字上。
  // 排字匣早就修過同一個洞（web/styles.css 的 .mast-tools 註解），導影台沒帶上。
  const narrow = w4.slice(w4.indexOf("@media (max-width: 900px)"));
  ok(
    "導影台窄螢幕頂欄會換行，工具不壓在標題上",
    /\.studio-mast \{[^}]*flex-wrap:\s*wrap/.test(narrow) && /\.studio-mast \.mast-tools \{[^}]*flex:\s*1 1 auto/.test(narrow),
    "390px 寬時工具按鈕疊在品牌字上",
  );

  // 換到第二列之後還有下一個洞：工具區本身不換行、靠右對齊，七顆鈕 511px 塞進 366px，
  // 多的往左溢出、沒有捲軸。實測兩個版面第一顆（通知設定齒輪）都在 x = -129／-133，
  // 手機上根本按不到。
  const webNarrow = web.slice(web.indexOf("@media (max-width: 900px)"));
  const toolsRule = (css, sel) => {
    const at = css.indexOf(sel + " {");
    return at < 0 ? "" : css.slice(at, css.indexOf("}", at) + 1);
  };
  for (const [name, css, sel] of [["排字匣", webNarrow, ".mast-tools"], ["導影台", narrow, ".studio-mast .mast-tools"]]) {
    const rule = toolsRule(css, sel);
    ok(
      `${name}窄螢幕工具列換行、靠左，齒輪不會跑出畫面`,
      /flex-wrap:\s*wrap/.test(rule) && /justify-content:\s*flex-start/.test(rule),
      "第一顆鈕在畫面左緣外面：" + (rule || "找不到規則"),
    );
  }
}

// --- 複製在非安全環境也要能用 ---------------------------------------------------
// start.bat 印的 Tailscale 網址是 http://100.x.x.x —— 不是 HTTPS 也不是 localhost，
// 瀏覽器在那裡根本不提供 navigator.clipboard。專案裡六個「複製」全部直接呼叫
// navigator.clipboard.writeText，在手機上按下去是 TypeError：沒複製、沒回饋。
{
  const clipPath = join(ROOT, "web", "clipboard.js");
  const have = existsSync(clipPath);
  ok("有剪貼簿備援模組", have, "缺 web/clipboard.js");
  const boot = readFileSync(join(ROOT, "web", "boot.js"), "utf8");
  ok("boot.js 第一個載入剪貼簿備援", /^\s*import\s+["']\.\/clipboard\.js["'];/m.test(boot.split("\n").slice(0, 3).join("\n")), "要在其他模組碰剪貼簿之前裝好");

  if (have) {
    const { installClipboardFallback } = await import("../web/clipboard.js");
    const fakeDoc = (execResult) => {
      const log = { appended: 0, removed: 0, selected: false, cmd: null };
      const doc = {
        body: {
          append(el) { log.appended += 1; el._in = true; },
        },
        createElement() {
          return {
            style: {},
            setAttribute() {},
            select() { log.selected = true; },
            setSelectionRange() { log.selected = true; },
            remove() { log.removed += 1; },
            focus() {},
          };
        },
        execCommand(cmd) { log.cmd = cmd; return execResult; },
        activeElement: null,
        getSelection: () => null,
      };
      return { doc, log };
    };

    // 1. 非安全環境：沒有 navigator.clipboard
    {
      const nav = {};
      const { doc, log } = fakeDoc(true);
      installClipboardFallback(nav, doc);
      ok("沒有 clipboard 時會補上 writeText", typeof nav.clipboard?.writeText === "function");
      let resolved = false;
      await nav.clipboard.writeText("1girl, solo").then(() => { resolved = true; });
      ok("補上的 writeText 用 execCommand('copy') 複製", resolved && log.cmd === "copy" && log.selected);
      ok("暫用的 textarea 用完就拿掉", log.appended === 1 && log.removed === 1);
    }
    // 2. execCommand 也失敗時要 reject，讓呼叫端知道
    {
      const nav = {};
      const { doc } = fakeDoc(false);
      installClipboardFallback(nav, doc);
      let rejected = false;
      await nav.clipboard.writeText("x").catch(() => { rejected = true; });
      ok("execCommand 失敗時 reject，不假裝成功", rejected);
    }
    // 3. 原生存在但被拒（沒權限、文件沒焦點）時改走備援
    {
      const nav = { clipboard: { writeText: () => Promise.reject(new Error("NotAllowedError")) } };
      const { doc, log } = fakeDoc(true);
      installClipboardFallback(nav, doc);
      let resolved = false;
      await nav.clipboard.writeText("x").then(() => { resolved = true; });
      ok("原生 writeText 被拒時改走 execCommand", resolved && log.cmd === "copy");
    }
    // 4. 原生正常時不碰備援
    {
      let nativeCalls = 0;
      const nav = { clipboard: { writeText: () => { nativeCalls += 1; return Promise.resolve(); } } };
      const { doc, log } = fakeDoc(true);
      installClipboardFallback(nav, doc);
      await nav.clipboard.writeText("x");
      ok("原生正常時只用原生", nativeCalls === 1 && log.cmd === null);
    }
  }
}

// --- 收藏星星：看起來能按就要能按，按了要有回應 --------------------------------------
{
  const bootJs = readFileSync(join(ROOT, "web", "boot.js"), "utf8");
  const albumJs = readFileSync(join(ROOT, "web", "album.js"), "utf8");
  const css = readFileSync(join(ROOT, "web", "boot.css"), "utf8").split(CR).join("");

  // 只抽牌的卡片也顯示星星（.card.is-done .fav-shot），card._recipe 也有，
  // 但 ensureFavButton() 只在生圖那條路徑呼叫 —— 按下去什麼都不會發生。
  const posOnlyBranch = bootJs.slice(bootJs.indexOf('card.dataset.posOnly = "1";'), bootJs.indexOf("} else {", bootJs.indexOf('card.dataset.posOnly = "1";')));
  ok("只抽牌的卡片也綁上收藏", /ensureFavButton\(card\)/.test(posOnlyBranch), "星星畫出來了但沒有 click handler");

  ok("收藏星星有按壓回饋", /\.fav-shot:active/.test(css), "skip／redo 都有 :active，只有星星沒有");
  ok(
    "已收藏的星星用強調色，不只靠實心與否",
    /\.fav-shot\.is-on\s*\{[^}]*color:\s*var\(--color-accent\)/.test(css),
    "只差填色，暗底上很難一眼看出",
  );
  ok("收藏成功時彈一下", /@keyframes fav-pop/.test(css) && /\.fav-shot\.is-popping/.test(css));
  ok(
    "彈跳只在按下時觸發，不是每次重畫都跳",
    /is-popping/.test(albumJs) && !/is-popping/.test(albumJs.slice(albumJs.indexOf("export function paintFavButton"), albumJs.indexOf("export function ensureFavButton"))),
    "寫進 paintFavButton 的話，重新整理時每張已收藏的都會跳",
  );
  const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  ok("減少動態時不彈", /\.fav-shot\.is-popping[^{]*\{[^}]*animation:\s*none/.test(css), "prefers-reduced-motion 沒關掉 fav-pop");
}

// --- 抽完了，新的那張在畫面外 ---------------------------------------------------
// 八格牆第二輪之後不自動捲（刻意的：使用者可能正捲在詞庫深處挑字），而且第 9 張起
// 原地蓋掉最舊那格，新卡可能在牆上任何位置。實測捲到詞庫中段按只抽牌：新卡在
// y = -376、完全在畫面外，唯一的回饋是 dock 一行「抽牌完成 1 張」。
{
  const cuePath = join(ROOT, "web", "new-card-cue.js");
  const have = existsSync(cuePath);
  ok("有「看新的一張」提示模組", have, "缺 web/new-card-cue.js");
  const bootJs = readFileSync(join(ROOT, "web", "boot.js"), "utf8");
  const done = bootJs.slice(bootJs.indexOf("抽牌完成 ${done} 張"), bootJs.indexOf("queueNextRound();", bootJs.indexOf("抽牌完成 ${done} 張")));
  ok("抽完之後會提示新卡", /cueNewCard\(/.test(done), "runBatch 結束時沒呼叫 cueNewCard");
  ok("第一次抽的自動捲動也看減少動態", !/scrollIntoView\(\{ behavior: "smooth"/.test(bootJs), "smooth 寫死，prefers-reduced-motion 的人也會被滑動");
  const css = readFileSync(join(ROOT, "web", "boot.css"), "utf8").split(CR).join("");
  ok("提示鈕有樣式與進場", /\.new-card-cue\s*\{/.test(css) && /@keyframes cue-in/.test(css));
  ok("減少動態時提示鈕不做進場", /\.new-card-cue[^{]*\{[^}]*animation:\s*none/.test(css));

  if (have) {
    const mod = await import("../web/new-card-cue.js");
    const mkEnv = (reduced = false) => {
      const observers = [];
      const status = { parent: null, before(el) { this.parent.kids.unshift(el); el.parentNode = this.parent; } };
      const dock = { kids: [status] };
      status.parent = dock;
      const doc = {
        documentElement: { clientHeight: 768 },
        getElementById: (id) => (id === "status" ? status : null),
        createElement: () => {
          const el = {
            hidden: true,
            textContent: "",
            className: "",
            type: "",
            attrs: {},
            listeners: {},
            classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
            setAttribute(k, v) { this.attrs[k] = v; },
            addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
            click() { for (const fn of this.listeners.click || []) fn({ preventDefault() {} }); },
          };
          return el;
        },
      };
      const win = {
        innerHeight: 768,
        matchMedia: (q) => ({ matches: reduced && /reduce/.test(q) }),
        IntersectionObserver: class {
          constructor(cb) { this.cb = cb; this.targets = []; observers.push(this); }
          observe(t) { this.targets.push(t); }
          disconnect() { this.targets = []; }
        },
      };
      const card = (top) => ({
        isConnected: true,
        scrolled: null,
        focused: null,
        attrs: {},
        getBoundingClientRect: () => ({ top, bottom: top + 300 }),
        getAttribute(k) { return this.attrs[k] ?? null; },
        setAttribute(k, v) { this.attrs[k] = v; },
        scrollIntoView(o) { this.scrolled = o; },
        focus(o) { this.focused = o; },
      });
      return { doc, win, dock, observers, card };
    };

    {
      const env = mkEnv();
      mod.resetNewCardCue();
      const shown = mod.cueNewCard(env.card(100), { doc: env.doc, win: env.win });
      const pill = env.dock.kids.find((k) => k !== env.dock.kids.at(-1));
      ok("新卡在畫面內就不提示", shown === false && (!pill || pill.hidden));
    }
    {
      const env = mkEnv();
      mod.resetNewCardCue();
      const c = env.card(-376);
      const shown = mod.cueNewCard(c, { doc: env.doc, win: env.win });
      const pill = env.dock.kids[0];
      ok("新卡在畫面上方時出現提示，箭頭朝上", shown === true && pill && !pill.hidden && /↑/.test(pill.textContent));
      pill.click();
      ok("按提示會捲到那張新卡（平滑）", c.scrolled && c.scrolled.behavior === "smooth" && c.scrolled.block === "center");
      ok("捲過去之後焦點落在新卡上", c.focused && c.focused.preventScroll === true && c.attrs.tabindex === "-1");
      ok("按完提示就收起來", pill.hidden === true);
    }
    {
      const env = mkEnv();
      mod.resetNewCardCue();
      mod.cueNewCard(env.card(1200), { doc: env.doc, win: env.win });
      const pill = env.dock.kids[0];
      ok("新卡在畫面下方時箭頭朝下", !pill.hidden && /↓/.test(pill.textContent));
      const io = env.observers.at(-1);
      io.cb([{ isIntersecting: true, target: io.targets[0] }]);
      ok("新卡自己捲進畫面時提示消失", pill.hidden === true);
    }
    {
      const env = mkEnv(true);
      mod.resetNewCardCue();
      const c = env.card(-376);
      mod.cueNewCard(c, { doc: env.doc, win: env.win });
      env.dock.kids[0].click();
      ok("減少動態時直接跳過去，不滑動", c.scrolled && c.scrolled.behavior === "auto");
    }
  }
}

// --- 導影台：詞庫置中變大，成片先看圖 ----------------------------------------------
// 1024px 寬時詞庫是右側 430px 的抽屜：「畫質與風格」標題折成兩行，一千三百多個字擠在窄欄。
// 成片卡圖片下面直接攤開整串 tag（一張卡的 .meta 量到 843px 高），看圖要一直往下捲。
{
  const w4css = readFileSync(join(ROOT, "web4", "styles.css"), "utf8").split(CR).join("");
  const wide = w4css.slice(w4css.lastIndexOf("@media (min-width: 901px)"));
  const rule = (css, sel) => {
    const at = css.indexOf(sel + " {");
    return at < 0 ? "" : css.slice(at, css.indexOf("}", at) + 1);
  };
  const panel = rule(wide, ".lex-panel");
  ok("詞庫在寬螢幕是置中的大面板", /width:\s*min\(1120px/.test(panel) && /left:\s*50%/.test(panel) && /top:\s*50%/.test(panel), panel || "找不到寬螢幕的 .lex-panel");
  ok("詞庫左邊是一條分類脊", /\.lex-panel \.filter-bar\s*\{[^}]*display:\s*contents/.test(wide) && /\.lex-panel \.jump\s*\{[^}]*flex-direction:\s*column/.test(wide));
  ok("只有字庫區捲動，標題與搜尋不動", /\.lex-panel \.cats\s*\{[^}]*overflow:\s*auto/.test(wide) && /\.lex-panel\s*\{[^}]*overflow:\s*hidden/.test(wide));
  ok("置中的詞庫關閉時縮回去，不是往右滑", /\.lex-sheet\.is-closing \.lex-panel\s*\{[^}]*sheet-pop-out/.test(wide));
  const narrowClose = w4css.slice(0, w4css.indexOf("@media (min-width: 901px) {\n  .lex-sheet.is-closing"));
  ok("手機詞庫從底部上來、也往底部下去", /\.lex-sheet\.is-closing \.lex-panel\s*\{\s*animation:\s*sheet-up-out/.test(narrowClose), "手機是底部 sheet，關閉卻往右滑出");

  ok("托盤預設收起 tag", /\.studio \.tray:not\(\.is-pins-open\) #tray-pins\s*\{[^}]*display:\s*none/.test(w4css));
  ok("有圖的成片預設收起 tag", /\.studio \.card:not\(\[data-pos-only="1"\]\):not\(\.is-pos-open\) \.meta > \.pos\s*\{[^}]*display:\s*none/.test(w4css));
  const app = readFileSync(join(ROOT, "web4", "app.js"), "utf8");
  ok("導影台載入成片模組", /import\s+["']\.\/shots\.js["']/.test(app));

  const shotsPath = join(ROOT, "web4", "shots.js");
  ok("有成片模組", existsSync(shotsPath));
  if (existsSync(shotsPath)) {
    const { enhanceShots } = await import("../web4/shots.js");
    let writes = 0;
    const mkEl = (tag = "div") => {
      const el = {
        tagName: tag.toUpperCase(),
        children: [],
        attrs: {},
        dataset: {},
        listeners: {},
        className: "",
        _text: "",
        classList: {
          _s: new Set(),
          add(c) { this._s.add(c); },
          remove(c) { this._s.delete(c); },
          contains(c) { return this._s.has(c); },
          toggle(c, on) { const v = on === undefined ? !this._s.has(c) : on; if (v) this._s.add(c); else this._s.delete(c); return v; },
        },
        set textContent(v) { writes += 1; this._text = v; },
        get textContent() { return this._text; },
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return this.attrs[k] ?? null; },
        addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
        prepend(x) { writes += 1; this.children.unshift(x); x.parent = this; },
        append(x) { writes += 1; this.children.push(x); x.parent = this; },
        querySelector(sel) {
          const want = sel.replace(/^:scope > /, "").replace(/^\./, "");
          const walk = (n) => { for (const c of n.children || []) { if (c.className.split(" ").includes(want)) return c; const d = walk(c); if (d) return d; } return null; };
          return walk(this);
        },
        click() { for (const fn of this.listeners.click || []) fn({ preventDefault() {} }); },
      };
      return el;
    };
    const doc = { createElement: (t) => mkEl(t) };
    const mkCard = ({ posOnly = false, positive = "1girl, solo, smile" } = {}) => {
      const card = mkEl();
      card.className = "card is-done";
      card.dataset.positive = positive;
      if (posOnly) card.dataset.posOnly = "1";
      const meta = mkEl(); meta.className = "meta";
      const bar = mkEl(); bar.className = "bar";
      const actions = mkEl(); actions.className = "bar-actions";
      bar.children.push(actions);
      meta.children.push(bar);
      card.children.push(meta);
      return { card, actions };
    };
    const img = mkCard();
    const pos = mkCard({ posOnly: true });
    const results = { querySelectorAll: () => [img.card, pos.card] };
    enhanceShots(results, doc);
    const btn = img.actions.children.find((c) => c.className.includes("pos-toggle"));
    ok("有圖的成片多一顆 POS 切換鈕", !!btn && btn.getAttribute("aria-expanded") === "false" && /3/.test(btn.textContent), btn ? btn.textContent : "沒有");
    ok("只抽牌的卡片不加（沒有圖，字就是成果）", !pos.actions.children.some((c) => c.className.includes("pos-toggle")));
    btn.click();
    ok("按了展開 tag", img.card.classList.contains("is-pos-open") && btn.getAttribute("aria-expanded") === "true");
    btn.click();
    ok("再按收起", !img.card.classList.contains("is-pos-open") && btn.getAttribute("aria-expanded") === "false");
    const before = writes;
    enhanceShots(results, doc);
    enhanceShots(results, doc);
    ok("重複處理同一批卡片不再動 DOM（不然觀察者會自己觸發自己）", writes === before, `多寫了 ${writes - before} 次`);

    // 圖上方的「這張 POS」托盤也是整串攤開（實測 269px），圖被推到畫面中段才開始。
    const { ensureTrayToggle } = await import("../web4/shots.js");
    ok("有托盤展開函式", typeof ensureTrayToggle === "function");
    if (typeof ensureTrayToggle === "function") {
    const tray = mkEl();
    tray.className = "tray is-on";
    const head = mkEl(); head.className = "tray-head";
    tray.children.push(head);
    ensureTrayToggle(tray, doc);
    const tbtn = head.children.find((c) => c.className.includes("tray-toggle"));
    ok("托盤標題列多一顆展開鈕，預設收起", !!tbtn && tbtn.getAttribute("aria-expanded") === "false" && !tray.classList.contains("is-pins-open"));
    tbtn.click();
    ok("按了托盤展開", tray.classList.contains("is-pins-open") && tbtn.getAttribute("aria-expanded") === "true");
    const w0 = writes;
    ensureTrayToggle(tray, doc);
    ok("托盤鈕只加一次", writes === w0 && head.children.filter((c) => c.className.includes("tray-toggle")).length === 1);
    }
  }
}

// --- 詞庫分類脊：捲到哪一類就亮哪一類 -------------------------------------------------
{
  const spinePath = join(ROOT, "web4", "lexicon-spine.js");
  ok("有分類脊模組", existsSync(spinePath));
  const app = readFileSync(join(ROOT, "web4", "app.js"), "utf8");
  ok("導影台載入分類脊模組", /import\s+["']\.\/lexicon-spine\.js["']/.test(app));
  if (existsSync(spinePath)) {
    const { sectionAt, paintSpine } = await import("../web4/lexicon-spine.js");
    const secs = [
      { id: "sec-quality", top: -900 },
      { id: "sec-subject", top: -120 },
      { id: "sec-feature", top: 40 },
      { id: "sec-pose", top: 700 },
    ];
    ok("頂端還沒碰到下一類時，亮的是正在看的那一類", sectionAt(secs, 24) === "sec-subject");
    ok("下一類的標題一捲過門檻就換過去", sectionAt(secs, 60) === "sec-feature");
    ok("一類都還沒捲到時亮第一類", sectionAt([{ id: "sec-quality", top: 300 }], 24) === "sec-quality");
    ok("沒有分類時不亮", sectionAt([], 24) === null);
    const mk = (hash) => ({ hash, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } });
    const links = [mk("#sec-quality"), mk("#sec-subject"), mk("#sec-feature")];
    links[0].attrs["aria-current"] = "true";
    paintSpine(links, "sec-feature");
    ok("只有目前那一類是 aria-current", !links[0].attrs["aria-current"] && !links[1].attrs["aria-current"] && links[2].attrs["aria-current"] === "true");
  }
}

// --- 導影台 hallmark audit：3 major · 3 minor ----------------------------------------
{
  const html = readFileSync(join(ROOT, "web4", "index.html"), "utf8");
  const tok = readFileSync(join(ROOT, "web4", "tokens.css"), "utf8");
  const css = readFileSync(join(ROOT, "web4", "styles.css"), "utf8").split(CR).join("");
  // major 1：Syne 沒有中文字，導影台／場記／詞庫全部退回系統預設字，標題字體等於沒設。
  const display = (tok.match(/--font-display:\s*([^;]+);/) || [])[1] || "";
  ok("標題字體鏈裡有中文字體", /Noto Serif TC/.test(display) && display.indexOf("Syne") < display.indexOf("Noto Serif TC"), display);
  ok("中文標題字體有真的載入", /family=Noto\+Serif\+TC/.test(html));
  // major 2：Intent／Lexicon／Pins 只是把下面的中文標題用英文再講一次。
  ok("沒有裝飾用的英文小標", !/class="eyebrow"/.test(html), "每一區上面都有一行大寫英文，跟標題講同一件事");
  // major 3：顏色要走 token，不能在規則裡直接寫 oklch(...)。
  const raw = css.match(/oklch\(/g) || [];
  ok("styles.css 沒有寫死的顏色值", raw.length === 0, `還有 ${raw.length} 處 oklch(…)`);
  // minor 4：面板本身 94% 不透明，背後的模糊看不到，只是白付 GPU。
  const panelRule = css.slice(css.indexOf(".lex-panel,\n.pin-panel {"), css.indexOf("}", css.indexOf(".lex-panel,\n.pin-panel {")));
  ok("詞庫／釘選面板不再疊毛玻璃", panelRule.length > 0 && !/backdrop-filter/.test(panelRule));
  // minor 5：陰影與遮罩帶底色的色相（250 左右），不是中性純黑。
  ok("陰影與遮罩的 token 帶藍色調", /--color-scrim:\s*oklch\([^)]*\s2[45]\d\s*\//.test(tok) && /--shadow-float:/.test(tok));
  // minor 6：分類脊的目前項目用左側色條 —— side-stripe。
  const spine = css.slice(css.indexOf('.lex-panel .jump a[aria-current="true"]'));
  // 卡片的動作鈕用 44px 的大鈕，300px 寬的卡片裡排成三列（POS／為什麼｜複製｜同種子重抽）。
  {
    const at = css.indexOf(".studio .card .same-seed {");
    const cardBtn = at < 0 ? "" : css.slice(css.lastIndexOf(".studio .card .bar-actions .ghost,", at), css.indexOf("}", at));
    ok("成片卡的動作鈕是緊湊尺寸", /min-height:\s*32px/.test(cardBtn), cardBtn || "找不到 .studio .card .bar-actions .ghost / .same-seed 的規則");
  }
  ok("分類脊目前項目不用側邊色條", !/inset 2px 0 0/.test(spine.slice(0, spine.indexOf("}"))));
}

// --- 排字匣 hallmark audit ---------------------------------------------------------
{
  const html = readFileSync(join(ROOT, "web", "index.html"), "utf8");
  const tok = readFileSync(join(ROOT, "web", "tokens.css"), "utf8");
  const css = readFileSync(join(ROOT, "web", "styles.css"), "utf8");
  // Bricolage Grotesque 沒有中文字：「排字匣」和所有分類標題都退回系統字。
  // 排字匣是鉛字排版的字盒，活字就是宋體 —— 用 Chiron Sung HK，跟導影台的粗明體分開。
  const display = (tok.match(/--font-display:\s*([^;]+);/) || [])[1] || "";
  ok("排字匣的標題字體鏈裡有宋體", /Chiron Sung HK/.test(display) && display.indexOf("Bricolage") < display.indexOf("Chiron Sung HK"), display);
  ok("排字匣的宋體有真的載入", /family=Chiron\+Sung\+HK/.test(html));
  const raw = css.match(/oklch\(/g) || [];
  ok("web/styles.css 沒有寫死的顏色值", raw.length === 0, `還有 ${raw.length} 處 oklch(…)`);
  // 空的成片區：以前是一大片空白、兩行小字。排字匣是字盒，空的時候畫一格格的分隔。
  ok("排字匣空的成片區是一格格的字盒", /\.stage \.results:empty\s*\{[^}]*var\(--color-case-line\)/.test(css) && /--color-case-line:/.test(tok));
}

// --- 開視窗時背景不能跳 ---------------------------------------------------------------
// 1. 導影台的詞庫用 body { overflow: hidden } 鎖捲動。html 有 overflow-x: clip，body 的
//    overflow 不會傳到視窗，body 反而變成自己的捲動容器（scroll-lock.js 的註解寫過這個坑），
//    黏在頂端的頂欄改對齊 body：頁面捲了 24px 再開詞庫，頂欄實測從 y=0 跳到 y=-24
//    （上面 24px 被切掉，看起來像縮短），關掉又跳回來。
// 2. 右上角的視窗（LoRA／底模／工作流／作品冊）鎖 html 是對的，但捲軸被拿掉，
//    頁面實測從 1009 變 1024px 寬，頂欄跟著變寬 15px、工具列位移。
{
  const w4 = readFileSync(join(ROOT, "web4", "styles.css"), "utf8").split(CR).join("");
  const boot = readFileSync(join(ROOT, "web", "boot.css"), "utf8").split(CR).join("");
  ok("導影台開詞庫不再鎖 body（會讓頂欄跳位）", !/body\.studio\.sheet-open\s*\{[^}]*overflow:\s*hidden/.test(w4));
  ok("導影台開詞庫改鎖 html", /html:has\(body\.studio\.sheet-open\)\s*\{[^}]*overflow:\s*hidden/.test(w4));
  ok("捲軸位置永遠保留，鎖捲動時寬度不變", /html\s*\{[^}]*scrollbar-gutter:\s*stable/.test(boot));
}

// --- 微互動：每個控制項都要有滑過、按下、停用的樣子 ---------------------------------------
// 逐一盤點排字匣 38 種可互動元件（樣式表裡有沒有對應的 :hover／:active／:disabled 規則）：
// 開關三顆滑過、按下都沒變化；19 個輸入框滑過沒變化；作品冊格子、分類展開、42 個必抽 +、
// 99 列 LoRA 按下沒有回饋；而 .ghost／.seg／.chip-toggle 停用時滑上去照樣浮起來、變色。
{
  const css = readFileSync(join(ROOT, "web", "boot.css"), "utf8").split(CR).join("");
  const has = (re) => re.test(css);
  ok("開關滑過時圓鈕往要去的方向挪", has(/\.same-switch:hover \.same-knob i\s*\{[^}]*translate:/));
  ok("開關按下時圓鈕拉長", has(/\.same-switch:active \.same-knob i\s*\{[^}]*scale:/));
  ok("開關滑過時外框有反應", has(/\.same-switch:hover:not\(\.is-on\)\s*\{[^}]*border-color/));
  ok("輸入框滑過時邊框有反應", has(/input\[type="search"\]:hover:not\(:focus\)[\s\S]{0,200}?\{[^}]*border-color/));
  const press = (css.match(/:is\(([^)]*)\):active:not\(:disabled\)\s*\{[^}]*scale:/) || [])[1] || "";
  for (const cls of [".cat-toggle", ".must-add", ".lora-row", ".album-cell", ".lm-cat", ".album-chip", ".w-flag"]) {
    ok(`${cls} 按下有回饋`, press.includes(cls), press ? `按壓規則裡沒有 ${cls}` : "找不到共用的按壓規則");
  }
  ok("停用的按鈕游標是 not-allowed", has(/:is\(:disabled, \[aria-disabled="true"\]\)[^{]*\{[^}]*cursor:\s*not-allowed/));
  // 用 :where() 包住排除條件：權重不變，.ghost.mini:hover 這類更具體的覆蓋仍然有效。
  ok("停用的 ghost 滑過不會浮起來", has(/\.ghost:hover:where\(:not\(:disabled\):not\(\[aria-disabled="true"\]\)\)/));
  ok("停用的 seg／chip 滑過不會浮起來", has(/\.chip-toggle:hover:where\(:not\(:disabled\)/));
  ok("減少動態時開關圓鈕不做形變", has(/prefers-reduced-motion[\s\S]{0,400}\.same-knob i\s*\{[^}]*(translate|scale):\s*none/));
}

// 導影台釘選台「每段目標數」整列可點，滑過卻毫無變化，「展開」一直是灰字。
{
  const css = readFileSync(join(ROOT, "web4", "styles.css"), "utf8").split(CR).join("");
  ok("每段目標數滑過整列有反應", /\.pin-row-more > summary:hover\s*\{[^}]*background/.test(css));
  ok("每段目標數滑過時「展開」變亮", /\.pin-row-more > summary:hover::after\s*\{[^}]*color:\s*var\(--color-ink\)/.test(css));
  ok("每段目標數按下有回饋", /\.pin-row-more > summary:active\s*\{[^}]*scale:/.test(css));
  // 卡片的「POS · N」有會翻的小箭頭，托盤的「展開」沒有 —— 同一種操作要同一種樣子。
  ok("托盤展開鈕跟 POS 鈕用同一個箭頭", /\.studio \.pos-toggle::after,\s*\.studio \.tray-toggle::after/.test(css) && /\.tray-toggle\[aria-expanded="true"\]::after/.test(css));
  ok("每段目標數展開時內容淡入", /\.pin-row-more\[open\] \.count-grid\s*\{[^}]*animation:\s*pos-reveal/.test(css));
}

// 每段目標數：旁邊的「特徵」「姿勢」是 <span>，沒接到輸入框上 —— 螢幕閱讀器只念得出
// 「數字欄位 3」，四個一模一樣。另外打 99 會存成 10，框裡卻還寫 99。
{
  const src = readFileSync(join(ROOT, "web", "boot.js"), "utf8").split(CR).join("");
  const at = src.indexOf("function renderCounts(");
  const body = at < 0 ? "" : src.slice(at, src.indexOf(NL + "}" + NL, at));
  ok("每段目標數的輸入框有名字", /input\.setAttribute\("aria-label", `\$\{label\}/.test(body));
  ok("超出範圍的數字存進去之後框裡也改成實際的值", /input\.value = String\(settings\.counts\[key\]\)/.test(body));

  // 「一次幾張」沒有上限是刻意的（infinite.js 開頁就拿掉 max：無限抽一輪可能想排很多張）。
  // 但 change 還留著舊的 min(10)：打 99 → settings 存 10、框裡寫 99、開拍時又從框裡讀
  // 到 99 並存回去 —— 同一個數字三個地方三種說法。統一成一條規則，框裡寫的就是會送的。
  ok("一次幾張只有一條規則（整數、至少 1）", /function clampBatch\([^)]*\)\s*\{[^}]*Math\.max\(1, Math\.floor\(/.test(src));
  const run = src.slice(src.indexOf("// 整段包 try/finally"), src.indexOf("// 整段包 try/finally") + 600);
  ok("開拍時的張數走同一條規則", /const n = clampBatch\(\$\("n"\)\.value\)/.test(run), run.slice(0, 300));
  const nChange = src.slice(src.indexOf('$("n").addEventListener("change"'), src.indexOf('$("n").addEventListener("change"') + 300);
  ok("一次幾張改完框裡寫實際的值", /settings\.n = clampBatch\(/.test(nChange) && /\$\("n"\)\.value = String\(settings\.n\)/.test(nChange) && !/Math\.min\(10/.test(nChange));
  // SDXL 的潛空間是 1/8：ComfyUI 收到 1000 會默默變成 1000//8*8。框裡寫的要是實際出圖的尺寸。
  // 通知設定的齒輪宣告了 role="menu"：螢幕閱讀器會告訴使用者「用方向鍵」，但方向鍵完全
  // 沒反應，焦點也從來不會進選單 —— 用鍵盤只能靠 Tab 碰運氣。照 APG 的 menu button 做。
  const svc = readFileSync(join(ROOT, "web", "service-settings.js"), "utf8").split(CR).join("");
  ok("用鍵盤打開通知選單時焦點進到第一項", /focusItem\(0\)/.test(svc) && /ArrowDown/.test(svc));
  ok("通知選單裡上下鍵、Home、End 會移動", /ArrowUp/.test(svc) && /"Home"/.test(svc) && /"End"/.test(svc));
  ok("Tab 離開通知選單時選單收起來", /e\.key === "Tab"[\s\S]{0,80}setOpen\(false\)/.test(svc));
  ok("選單項目不在 Tab 順序裡（選單內靠方向鍵）", /tabindex="-1"[^>]*data-service="telegram"|data-service="telegram"[^>]*tabindex="-1"/.test(svc));
  // 自動傳送的狀態只是一顆有顏色的點；點上掛的 aria-label 在沒有 role 的 <span> 上會被忽略，
  // 螢幕閱讀器完全不知道它開著還是關著。狀態要寫進選項本身的名字。
  ok("通知選單的項目名字裡有自動傳送開著還是關著", /choice\.setAttribute\("aria-label", `[^`]*自動傳送\$\{active \? "開著" : "關著"\}/.test(svc));
  ok("狀態點本身不再掛沒用的 aria-label", !/class="service-dot" aria-label=/.test(svc));
  ok("寬高對齊 8 的倍數",/function clampSide\([^)]*\)\s*\{[^}]*\/ 8\)\s*\*\s*8/.test(src));
}

// 底模選單、快捷鍵說明（還有 LoRA 的兩個浮層）按 Esc 關掉之後，焦點留在已經藏起來的
// 搜尋框／關閉鈕上 —— 鍵盤使用者被丟在一個看不見的地方。作品冊、工作流是對的（會回到開它的鈕）。
{
  const lora = readFileSync(join(ROOT, "web", "lora.js"), "utf8").split(CR).join("");
  const open = lora.slice(lora.indexOf("function overlayOpen("), lora.indexOf("function fadeCloseOverlay("));
  const close = lora.slice(lora.indexOf("function fadeCloseOverlay("), lora.indexOf("let _toastT"));
  ok("LoRA 這一族浮層打開時記住焦點在哪", /_returnFocus = /.test(open) && /document\.activeElement/.test(open));
  ok("關掉時焦點回到打開它的地方", /_returnFocus/.test(close) && /\.focus\(/.test(close));
  // 浮層開著時背景（頂欄，開它的鈕就在裡面）是 inert 的，對它 focus() 會靜靜失敗。
  // 第一版在關閉一開始就還焦點，實測完全沒用 —— 要等 unlockScroll 把背景放回來之後才還。
  ok("還焦點在背景解除 inert 之後", close.indexOf(".focus(") > close.indexOf("unlockScroll("));
}

// 導影台的詞庫／釘選台寫了 aria-modal="true"，卻：Esc 關掉後焦點留在已經藏起來的搜尋框；
// 釘選台打開時焦點不進去；而且背景沒關出 tab 序，Tab 幾下就掉到被蓋住的頁面裡。
// 排字匣那邊的彈窗全靠 scroll-lock.js 解決這件事，這裡接同一把鎖。
{
  const w4 = readFileSync(join(ROOT, "web4", "studio.js"), "utf8").split(CR).join("");
  const at = w4.indexOf("function setSheet(");
  const body = at < 0 ? "" : w4.slice(at, w4.indexOf(NL + "}" + NL, at));
  ok("導影台的 sheet 接 scroll-lock（背景關出 tab 序）", /import \{[^}]*lockScroll[^}]*\} from "\.\/scroll-lock\.js"/.test(w4) && /lockScroll\(el\.id\)/.test(body) && /unlockScroll\(el\.id\)/.test(body));
  ok("導影台的 sheet 打開時記住焦點在哪", /_returnFocus = /.test(body));
  ok("導影台的 sheet 關掉時焦點回去", /_returnFocus[\s\S]*\.focus\(/.test(body));
  // 背景還是 inert 的時候對它 focus() 會靜靜失敗（排字匣那邊第一版就栽在這裡）。
  ok("還焦點在解鎖之後", body.lastIndexOf("unlockScroll(el.id)") >= 0 && body.indexOf(".focus(", body.indexOf("unlockScroll(el.id)")) > 0);
  ok("打開釘選台時焦點進到面板裡", /function openPins\(\)[\s\S]{0,200}\.focus\(/.test(w4));
}

// 打開詞庫、底模、LoRA、作品冊時直接把焦點塞進搜尋框：桌機很方便，手機上卻是一打開就
// 彈出螢幕鍵盤，蓋掉半個底部抽屜 —— 使用者多半只是想看看。觸控時焦點給關閉鈕。
{
  const fe = join(ROOT, "web", "focus-entry.js");
  ok("有共用的 focusEntry", existsSync(fe));
  if (existsSync(fe)) {
    const { focusEntry } = await import(pathToFileURL(fe).href);
    const hit = [];
    const el = (name) => ({ focus: () => hit.push(name) });
    const prev = globalThis.matchMedia;
    globalThis.matchMedia = (q) => ({ matches: /pointer:\s*coarse/.test(q) });
    focusEntry(el("search"), el("close"));
    globalThis.matchMedia = () => ({ matches: false });
    focusEntry(el("search"), el("close"));
    focusEntry(null, el("close"));
    globalThis.matchMedia = prev;
    ok("觸控時焦點給關閉鈕、桌機給搜尋框、沒有搜尋框時退回關閉鈕", hit.join(",") === "close,search,close", hit.join(","));
  }
  const uses = [
    ["導影台詞庫", "web4/studio.js", /focusEntry\(\$\("q"\)/],
    ["LoRA 選單", "web/lora.js", /focusEntry\(\$\("lm-search"\)/],
    ["底模選單", "web/lora.js", /focusEntry\(\$\("ckpt-search"\)/],
    ["作品冊", "web/album.js", /focusEntry\(\$\("album-q"\)/],
  ];
  for (const [name, file, re] of uses) {
    const src = readFileSync(join(ROOT, ...file.split("/")), "utf8");
    ok(`${name}打開時走 focusEntry`, re.test(src));
  }
}

// web5（中控室）：boot.js 直接用 id 找的元素、boot.css 直接用的 CSS 變數，
// 兩份契約都是從「排字匣」canonical 版反推出來的（見 web/index.html、web/boot.css），
// 這裡改成量它們自己、不是把清單寫死——契約本身變了，測試才會跟著變，不必兩邊改兩次。
// 動態元素（w-pop、shot-viewer、infinite…）boot.js 自己 createElement，不在這份清單裡；
// 用「排字匣本身也沒有這些 id」反過來篩掉它們，不用整理一份「哪些是動態的」名單。
{
  const idsOf = (html) => new Set([...html.matchAll(/\sid="([a-zA-Z0-9_-]+)"/g)].map((m) => m[1]));
  const refHtml = readFileSync(join(ROOT, "web", "index.html"), "utf8");
  const w5Html = readFileSync(join(ROOT, "web5", "index.html"), "utf8");
  const refIds = idsOf(refHtml);
  const w5Ids = idsOf(w5Html);
  const missing = [...refIds].filter((id) => !w5Ids.has(id));
  ok("web5 有排字匣的每一個靜態 id（boot.js 用 $() 直接找）", missing.length === 0, missing.join("、"));

  const bootCss = readFileSync(join(ROOT, "web", "boot.css"), "utf8");
  const w5Tokens = readFileSync(join(ROOT, "web5", "tokens.css"), "utf8");
  const usedVars = new Set(
    [...bootCss.matchAll(/var\(--([a-zA-Z0-9_-]+)/g)]
      .map((m) => m[1])
      // JS 逐格塞進 style 的（--thumb-x、--shot-w…），tokens.css 本來就不會有，篩掉。
      .filter((name) => !/^(i|thumb-x|thumb-w|shot-w|shot-h|cats-stagger|cats-swap-dur)$/.test(name)),
  );
  const definedVars = new Set([...w5Tokens.matchAll(/^\s*--([a-zA-Z0-9_-]+):/gm)].map((m) => m[1]));
  const missingVars = [...usedVars].filter((v) => !definedVars.has(v));
  ok("web5 的 tokens.css 定義了 boot.css 用到的每個變數", missingVars.length === 0, missingVars.map((v) => "--" + v).join("、"));

  const w5Css = readFileSync(join(ROOT, "web5", "styles.css"), "utf8");
  ok("web5 有自己的 Hallmark 印章", /Hallmark · genre:.*macrostructure:.*theme:/.test(w5Css));
  const w5App = readFileSync(join(ROOT, "web5", "app.js"), "utf8");
  ok("web5 的 app.js 掛了 boot.js", /import\s+"\.\/boot\.js"/.test(w5App));
  ok("web5 掛了自己的訊號讀出條（panel-fx.js，不是照抄別套 app.js）", /import\s+"\.\/panel-fx\.js"/.test(w5App));
  ok("讀出條會補上重建過的控制項（不是只看屬性變化）", /childList:\s*true/.test(readFileSync(join(ROOT, "web5", "panel-fx.js"), "utf8")));
}

if (failed) {
  console.error(NL + failed + " failed");
  process.exit(1);
}
console.log(NL + "ok");
