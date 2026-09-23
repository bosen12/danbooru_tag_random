/**
 * 成片先看圖。
 *
 * 成片卡原本在圖下面直接攤開整串 tag（一張卡的 .meta 量到 843px 高），八格牆看起來
 * 是八張字條，不是八張片。導影台的工作是看片：有圖的卡片只留圖和一行資訊，
 * tag 收在「POS · N」後面，要看再展開。
 *
 * 只抽牌的卡沒有圖，字就是成果，照樣攤開 —— 有圖看圖，沒圖看字。
 *
 * 這支會被 #results 的 MutationObserver 反覆叫到，而 studio.js 也在看同一個節點：
 * 只要重複處理同一張卡時又動了 DOM，兩個觀察者就會互相觸發到分頁卡死（那個洞修過一次）。
 * 所以每一步都先檢查「已經好了」就不碰。
 */

function tagCount(card) {
  return String(card.dataset?.positive || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean).length;
}

function ensurePosToggle(card, doc) {
  if (card.dataset?.posOnly === "1") return;
  // 還在生圖時資訊列只有狀態字，動作鈕是完成後才長出來的；到時觀察者會再叫一次。
  const actions = card.querySelector(".bar-actions");
  if (!actions || actions.querySelector(".pos-toggle")) return;
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = "ghost pos-toggle";
  btn.textContent = `POS · ${tagCount(card)}`;
  btn.setAttribute("aria-expanded", card.classList.contains("is-pos-open") ? "true" : "false");
  btn.setAttribute("title", "展開／收起這張的 tag");
  btn.addEventListener("click", () => {
    const open = card.classList.toggle("is-pos-open");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });
  actions.prepend(btn);
}

/**
 * 圖上方的「這張 POS」托盤也是整串攤開（實測 269px），圖被推到畫面中段才開始。
 * 預設收成一條：標題、字數、複製；要看或要從這裡釘字時再展開。
 */
export function ensureTrayToggle(tray, doc = globalThis.document) {
  if (!tray) return;
  const head = tray.querySelector(".tray-head");
  if (!head || head.querySelector(".tray-toggle")) return;
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = "ghost mini tray-toggle";
  const open = tray.classList.contains("is-pins-open");
  btn.textContent = open ? "收起" : "展開";
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  btn.setAttribute("aria-controls", "tray-pins");
  btn.addEventListener("click", () => {
    const now = tray.classList.toggle("is-pins-open");
    btn.setAttribute("aria-expanded", now ? "true" : "false");
    btn.textContent = now ? "收起" : "展開";
  });
  head.append(btn);
}

export function enhanceShots(results, doc = globalThis.document) {
  if (!results) return;
  for (const card of results.querySelectorAll(".card")) ensurePosToggle(card, doc);
}

function watch() {
  ensureTrayToggle(document.getElementById("tray"), document);
  const results = document.getElementById("results");
  if (!results || typeof MutationObserver !== "function") return;
  let queued = false;
  const run = () => {
    queued = false;
    enhanceShots(results, document);
  };
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(run);
  }).observe(results, { childList: true, subtree: true });
  run();
}

if (typeof document !== "undefined" && typeof document.getElementById === "function") watch();
