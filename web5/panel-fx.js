// 中控室的訊號讀出條：不碰抽牌邏輯，純讀畫面上既有的 aria-pressed／aria-current／
// input value，組成一行 mono 字串貼回 #readout-line。跟 boot.js 完全解耦 —— 拔掉這支
// 檔案，設定照樣運作，只是儀表板上的那一行讀數不會動。
//
// 同一套「MutationObserver 進來先排微任務、避免同一輪疊很多次」的作法，
// 跟 web4 的 trayWatch 是同一個理由：aria-pressed 一次點擊常常牽動好幾個
// 按鈕（分段控制滑動、互斥的性別／時代按鈕互相切換），逐一處理只會算出
// 中間態、又立刻被下一個 mutation 蓋掉。

const $ = (id) => document.getElementById(id);

function pressedText(container, sel) {
  if (!container) return null;
  const hit = [...container.querySelectorAll(sel)].filter((el) => el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-current") === "true");
  if (!hit.length) return null;
  return hit.map((el) => el.textContent.trim()).filter(Boolean).join("＋");
}

function buildReadout() {
  const parts = [];
  const rating = pressedText($("rating"), ".segmented-btn");
  if (rating) parts.push(rating);

  const cast = pressedText($("sec-rules"), "#girl, #boy, #cast-any");
  if (cast) parts.push(cast);

  const heat = pressedText($("heats"), ".chip-toggle");
  if (heat) parts.push(heat);

  const scene = pressedText($("scene-modes"), ".chip-toggle");
  if (scene && scene !== "正常") parts.push(scene);

  const job = $("draw-job");
  if (job?.getAttribute("aria-pressed") === "true") parts.push("抽職業");

  const era = pressedText($("eras"), ".chip-toggle");
  if (era) parts.push(era);

  const w = $("width")?.value;
  const h = $("height")?.value;
  if (w && h) parts.push(`${w}×${h}`);

  const n = $("n")?.value;
  if (n) {
    const same = $("same-person")?.getAttribute("aria-checked") === "true";
    parts.push(`×${n}${same ? "（鎖臉）" : ""}`);
  }

  return parts.join(" · ") || "—";
}

function initReadout() {
  const line = $("readout-line");
  const rules = $("sec-rules");
  if (!line || !rules) return;

  let queued = false;
  const paint = () => {
    queued = false;
    line.textContent = buildReadout();
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(paint);
  };

  // 時代／組合這幾格不是就地改屬性——boot.js 整批 replaceChildren 再重建按鈕
  // （renderEras 之類），所以舊按鈕直接從樹上消失，只看 attributes 會漏掉這種换法。
  // childList 補上這一半。
  const mo = new MutationObserver(schedule);
  mo.observe(rules, {
    attributes: true,
    attributeFilter: ["aria-pressed", "aria-current", "aria-checked"],
    subtree: true,
    childList: true,
  });
  rules.addEventListener("input", schedule);
  rules.addEventListener("change", schedule);
  queueMicrotask(paint);
}

// 讀出條自己的高度量進 --readout-h，篩選列疊在它下面才不會擋到（跟 boot.js
// 量 --mast-h／--dock-h 是同一套作法，只是這個元素是 web5 自己加的，boot.js
// 不知道它存在）。
function watchHeight() {
  const el = $("readout");
  if (!el) return;
  const root = document.documentElement;
  const set = () => root.style.setProperty("--readout-h", `${Math.round(el.offsetHeight)}px`);
  set();
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(set).observe(el);
  } else {
    window.addEventListener("resize", set);
  }
}

initReadout();
watchHeight();
