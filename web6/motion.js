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

/* ---------- 動態詞彙：兩個房間的曲線與時間（跟 tokens.css 的 --ease-*／--dur-* 同一套） ---------- */

/**
 * out     進場、落定、回彈之後的收尾：一開始就快、長長地停下來。
 * in      離場（長的、≥ 300ms）：慢慢起步、越走越快，走的時候不拖泥帶水。
 * exit    短的離場（< 250ms）：in 太陡，短時間裡前半段幾乎不動、最後一下才消失；這條一開始就在走。
 * inOut   原地的狀態轉換（展開、收合）。
 * travel  牌飛越畫面：從靜止加速（不會瞬間移位），大半段在減速、輕輕落下。
 * settle  落地那一下的回彈（略過頭再回來）。
 */
export const CURVE = {
  out: [0.16, 1, 0.3, 1],
  in: [0.7, 0, 0.84, 0],
  exit: [0.4, 0, 1, 1],
  inOut: [0.65, 0, 0.35, 1],
  travel: [0.22, 0.06, 0.08, 1],
  settle: [0.34, 1.4, 0.64, 1],
};
export const DUR = { micro: 120, short: 220, medium: 320, long: 420 };
export const css = (c) => `cubic-bezier(${c.join(", ")})`;

/** cubic-bezier 曲線 → 函式 t(0..1) → 進度。JS 自己算位置的動畫（飛行）跟 CSS 用同一條曲線。 */
export function bezier([x1, y1, x2, y2]) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-5) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 24; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-5) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

/** 飛行要多久：照距離，近的快、遠的慢一點（300px 約 350ms，1000px 約 500ms）。 */
export function travelTime(dist) {
  return Math.round(Math.max(320, Math.min(540, 280 + dist * 0.22)));
}

/**
 * 牌飛過去（會追落點）：影子 ghost 從 from 飛到 target() 「現在」的位置。
 * 每一格重量一次落點，所以路上版面動了（整列重排、托盤變寬、捲動）也剛好落在牌上，
 * 不會飛到舊位置、落地再跳一下。路徑往上拱成弧、途中微微轉、中段稍微放大（像被拿起來），
 * 兩端都是正的、原尺寸。ghost 由呼叫端做好（通常是那張牌的複製），落地後這裡拿掉。
 *
 * from：{ left, top, width[, height] }。target：() => Element 或 rect（拿不到就沿用上一次的）。
 * 選項：duration（預設照距離）、delay、curve、arc（弧高 px）、tilt（最大轉角）、
 *       endScale（落地大小／落點寬）、endOpacity、zIndex、onLand。回傳 { cancel }。
 */
export function flight(ghost, from, target, opts = {}) {
  const { delay = 0, curve = CURVE.travel, arc = 34, tilt = -5, lift = 0.05, endScale = 1, endOpacity = 1, zIndex = 90, onLand = null } = opts;
  const fh = from.height || from.width * 1.4625;
  Object.assign(ghost.style, {
    position: "fixed",
    left: from.left + "px",
    top: from.top + "px",
    width: from.width + "px",
    margin: "0",
    zIndex: String(zIndex),
    pointerEvents: "none",
    transformOrigin: "50% 50%",
    willChange: "transform, opacity",
  });
  ghost.style.setProperty("--card-w", from.width + "px");
  ghost.setAttribute("aria-hidden", "true");
  let last = null;
  const resolve = () => {
    const n = typeof target === "function" ? target() : target;
    const r = n && (typeof n.getBoundingClientRect === "function" ? (n.isConnected ? n.getBoundingClientRect() : null) : n);
    if (r && r.width) last = { left: r.left, top: r.top, width: r.width, height: r.height || r.width * 1.4625 };
    return last;
  };
  const first = resolve() || { left: from.left, top: from.top, width: from.width, height: fh };
  const fcx = from.left + from.width / 2;
  const fcy = from.top + fh / 2;
  const duration = opts.duration || travelTime(Math.hypot(first.left + first.width / 2 - fcx, first.top + first.height / 2 - fcy));
  const ease = bezier(curve);
  let done = false;
  let raf = 0;
  let t0 = null;
  // 瞄準點：跟著落點走但有阻尼（落點突然跳一大段，影子不會跟著瞬移），最後一段完全換成真的落點，
  // 所以一定剛好落在牌上。
  let aim = { ...first };
  let lastNow = null;
  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    ghost.remove();
    if (onLand) onLand();
  };
  const paint = (p, dt = 16) => {
    const e = ease(p);
    const raw = resolve() || first;
    const k = 1 - Math.exp(-dt / 70);
    for (const key of ["left", "top", "width", "height"]) aim[key] += (raw[key] - aim[key]) * k;
    const w = e * e * e * e;
    const to = {};
    for (const key of ["left", "top", "width", "height"]) to[key] = aim[key] + (raw[key] - aim[key]) * w;
    const tcx = to.left + to.width / 2;
    const tcy = to.top + to.height / 2;
    const bump = Math.sin(Math.PI * p);
    const x = fcx + (tcx - fcx) * e - fcx;
    const y = fcy + (tcy - fcy) * e - arc * bump - fcy;
    const s = (1 + ((to.width * endScale) / from.width - 1) * e) * (1 + lift * bump);
    ghost.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${(tilt * bump).toFixed(2)}deg) scale(${s.toFixed(4)})`;
    // 影子跟著高度：飛到弧頂最深最散，落地前收回貼著桌面的那一層。
    ghost.style.boxShadow = `0 1px 0 var(--color-shine) inset, 0 ${(6 + 18 * bump).toFixed(1)}px ${(14 + 22 * bump).toFixed(1)}px var(--color-shade)`;
    if (endOpacity !== 1) ghost.style.opacity = String(1 + (endOpacity - 1) * Math.max(0, (e - 0.6) / 0.4));
  };
  paint(0);
  document.body.append(ghost);
  const frame = (now) => {
    if (done) return;
    if (t0 === null) t0 = now + delay;
    const p = Math.max(0, Math.min(1, (now - t0) / duration));
    paint(p, lastNow === null ? 16 : Math.max(1, now - lastNow));
    lastNow = now;
    if (p >= 1) return finish();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  // 分頁在背景時 rAF 不跑：時間到了直接落地，不會卡一張影子在畫面上。
  setTimeout(finish, delay + duration + 300);
  return { cancel: finish, duration };
}

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

/**
 * 一疊牌收回去：先從各自的位置滑到 pile 疊成一疊（每張錯開一點、歪一點），
 * 再整疊一起飛到 home 縮小淡掉。一張張各飛各的回字盒，牌多的時候路線交叉、看起來在亂飛；
 * 收成一疊再一起走，是「把桌上的牌掃成一堆收起來」。
 *
 * snaps：[{ node, rect }]（拿掉之前量的）。pile、home：{ x, y } 視窗座標（中心點）；home 可以是 null
 * （字盒不在畫面上）：那就疊好之後原地淡掉。cls：飛行影子要加的 class（疊印台是 "flying"）。
 * 回傳整段要多久（毫秒），呼叫端用來排「字盒收下」那一下。
 */
export function gatherHome(snaps, pile, home, { cls = "", duration = 560 } = {}) {
  if (reducedMotion() || !snaps.length || !pile) return 0;
  const n = snaps.length;
  snaps.forEach((snap, i) => {
    const r = snap.rect;
    if (!r.width) return;
    const g = snap.node.cloneNode(true);
    if (cls) g.classList.add(cls);
    g.classList.remove("is-related", "is-stamped", "is-clash", "is-returned");
    Object.assign(g.style, { position: "fixed", left: r.left + "px", top: r.top + "px", width: r.width + "px", margin: "0", zIndex: String(80 + i), pointerEvents: "none" });
    g.style.setProperty("--card-w", r.width + "px");
    document.body.append(g);
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // 疊成一疊：越後面的越往上一點、角度錯開（像手收牌）。
    const k = i - (n - 1) / 2;
    const px = pile.x - cx + k * 1.5;
    const py = pile.y - cy - i * 1.2;
    const rot = k * 3;
    const s1 = Math.min(1, 96 / r.width);
    // 兩段各用各的曲線（整段只給一條曲線會把兩段一起扭曲）：
    // 聚攏＝減速停進那一疊（out，視覺上大約 110ms 就疊好）；收走＝帶一點初速離開、進字盒前放慢。
    // 中間不另外停：out 的尾巴本身就是那一拍「疊好了」。
    const frames = [
      { transform: "none", opacity: 1, easing: css(CURVE.out) },
      { transform: `translate(${px}px, ${py}px) scale(${s1}) rotate(${rot}deg)`, opacity: 1, offset: 0.3, easing: css([0.3, 0.1, 0.4, 1]) },
      // 飛的路上是實的，快進字盒才淡掉（只寫 opacity：transform 照上下兩格接著走）。
      { opacity: 1, offset: 0.78 },
    ];
    if (home) {
      frames.push({ transform: `translate(${home.x - cx}px, ${home.y - cy}px) scale(${s1 * 0.35}) rotate(${rot - 12}deg)`, opacity: 0 });
    } else {
      frames.push({ transform: `translate(${px}px, ${py + 10}px) scale(${s1 * 0.9}) rotate(${rot}deg)`, opacity: 0 });
    }
    // 聚攏那段各自出發（最多差 80ms），之後同一時間一起走。
    const delay = Math.min(80, i * 14);
    g.animate(frames, { duration: duration - delay, delay, easing: "linear", fill: "both" });
    setTimeout(() => g.remove(), duration + 40);
  });
  return duration;
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
