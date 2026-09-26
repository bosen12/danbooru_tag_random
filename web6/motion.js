/**
 * 墨池、疊印台共用的小動作：分段選項的滑塊、數字增減的滾動、清單增減時旁邊的讓位（FLIP）。
 *
 * 前兩個是自動的：initMotion() 之後，頁面上任何 .segmented 和 .stepper output 改了，
 * 這裡看得到（MutationObserver）就補上動作，各個 render 函式不必各自記得呼叫。
 * 這兩個房間的控制項大多是「點了就整組重畫」，所以滑塊記的是上一次的位置（依那一組的
 * aria-label），新畫出來的那一組從舊位置滑過去。
 */

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- 分段選項：選到的那一格底下有一塊會滑的底 ---------- */

const thumbAt = new Map();

function segKey(seg) {
  return seg.getAttribute("aria-label") || seg.dataset.kind || [...seg.children].map((b) => b.textContent).join("|");
}

function syncThumbs(root = document) {
  for (const seg of root.querySelectorAll(".segmented")) {
    const on = seg.querySelector(':scope > [aria-checked="true"], :scope > [aria-pressed="true"]');
    let thumb = seg.querySelector(":scope > .seg-thumb");
    if (!on || !seg.offsetWidth) {
      thumb?.remove();
      continue;
    }
    const key = segKey(seg);
    const to = { x: on.offsetLeft, w: on.offsetWidth, h: on.offsetHeight, y: on.offsetTop };
    const fresh = !thumb;
    if (fresh) {
      thumb = document.createElement("span");
      thumb.className = "seg-thumb";
      thumb.setAttribute("aria-hidden", "true");
      seg.prepend(thumb);
      seg.classList.add("has-thumb");
      const from = thumbAt.get(key);
      if (from && !reducedMotion()) {
        place(thumb, from, false);
        void thumb.offsetWidth;
      } else place(thumb, to, false);
    }
    thumb.dataset.v = on.dataset.v || "";
    const at = thumbAt.get(key);
    if (fresh || !at || at.x !== to.x || at.w !== to.w) place(thumb, to, !reducedMotion());
    thumbAt.set(key, to);
  }
}

function place(thumb, r, animate) {
  thumb.style.transition = animate ? "" : "none";
  thumb.style.width = r.w + "px";
  thumb.style.height = r.h + "px";
  thumb.style.transform = `translate(${r.x}px, ${r.y}px)`;
}

/* ---------- 數字增減：往上加從底下滾上來，往下減從上面滾下來 ---------- */

const stepAt = new Map();

function stepKey(out) {
  return out.closest(".stepper")?.querySelector(".stepper-label")?.textContent || out.getAttribute("aria-label") || "";
}

function syncSteppers(root = document) {
  for (const out of root.querySelectorAll(".stepper output")) {
    const key = stepKey(out);
    const v = Number(out.textContent);
    const was = stepAt.get(key);
    stepAt.set(key, v);
    if (was === undefined || Number.isNaN(v) || v === was || reducedMotion()) continue;
    const up = v > was;
    out.animate(
      [
        { transform: `translateY(${up ? 60 : -60}%)`, opacity: 0 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 220, easing: EASE }
    );
  }
}

/* ---------- 自動：DOM 一變就補上 ---------- */

let queued = false;
function schedule() {
  if (queued) return;
  queued = true;
  // 不用 rAF：分頁不在前面時 rAF 幾乎不跑，滑塊會停在半路。微任務在同一輪畫面前就做完。
  queueMicrotask(() => {
    queued = false;
    syncThumbs();
    syncSteppers();
  });
}

export function initMotion() {
  new MutationObserver(schedule).observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-checked", "aria-pressed"],
  });
  window.addEventListener("resize", () => {
    thumbAt.clear();
    for (const t of document.querySelectorAll(".seg-thumb")) t.remove();
    schedule();
  });
  schedule();
}

/* ---------- FLIP：清單增減時，旁邊的東西滑到新位置，不是一格一格跳 ---------- */

/**
 * flip(container, () => { ...改 DOM... })：改之前量一次每個子元素的位置，改完再量一次，
 * 位置變了的從舊位置滑過去。新加進來的不管（呼叫端自己決定它怎麼進場）。
 */
export function flip(container, mutate, { duration = 320 } = {}) {
  if (!container || reducedMotion()) {
    mutate();
    return;
  }
  const before = new Map();
  for (const n of container.children) before.set(n, n.getBoundingClientRect());
  mutate();
  for (const n of container.children) {
    const a = before.get(n);
    if (!a) continue;
    const b = n.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration, easing: EASE });
  }
}

/**
 * flipBy：整塊重畫（replaceChildren）也能讓位 —— 節點換了新的，就用 key（牌名）認人。
 * 重畫前記下每張的位置，重畫後同一張從舊位置滑到新位置。
 * alias(key) 回傳「沒有舊位置時可以借用的 key」：疊印台的影子被收下變成正式的牌，
 * 就從影子的位置滑進去。
 */
export function flipBy(container, selector, key, mutate, { duration = 320, alias = null } = {}) {
  if (!container || reducedMotion()) {
    mutate();
    return;
  }
  const before = new Map();
  for (const n of container.querySelectorAll(selector)) {
    const k = key(n);
    if (k && !before.has(k)) before.set(k, n.getBoundingClientRect());
  }
  mutate();
  if (!before.size) return;
  for (const n of container.querySelectorAll(selector)) {
    const k = key(n);
    const a = before.get(k) || (alias && before.get(alias(k)));
    if (!a) continue;
    const b = n.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration, easing: EASE });
  }
}

/** 一個東西離場：縮一點、淡掉，結束後才真的拿掉（done 裡做 DOM 移除，通常配 flip）。 */
export function leave(node, done, { duration = 200 } = {}) {
  if (!node || reducedMotion()) {
    done();
    return;
  }
  const a = node.animate(
    [
      { transform: "none", opacity: 1 },
      { transform: "scale(0.92)", opacity: 0 },
    ],
    { duration, easing: "cubic-bezier(0.55, 0, 1, 0.45)", fill: "forwards" }
  );
  let finished = false;
  const end = () => {
    if (finished) return;
    finished = true;
    done();
  };
  a.onfinish = end;
  a.oncancel = end;
  setTimeout(end, duration + 150);
}

/** 一個東西進場：從上面一點浮下來。 */
export function enter(node, { delay = 0 } = {}) {
  if (!node || reducedMotion()) return;
  node.animate(
    [
      { transform: "translateY(-12px) scale(0.97)", opacity: 0 },
      { transform: "none", opacity: 1 },
    ],
    { duration: 380, delay, easing: EASE, fill: "backwards" }
  );
}

/** 按鈕自己說「好了」：字換成 done 一下子再換回來（複製、存檔這種看不到結果的動作）。 */
export function confirmButton(btn, done = "已複製", ms = 1400) {
  if (!btn) return;
  if (!btn.dataset.label) btn.dataset.label = btn.textContent;
  btn.textContent = done;
  btn.classList.add("is-confirmed");
  clearTimeout(btn._confirmTimer);
  btn._confirmTimer = setTimeout(() => {
    btn.textContent = btn.dataset.label;
    btn.classList.remove("is-confirmed");
  }, ms);
}
