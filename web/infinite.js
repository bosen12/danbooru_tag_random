// 無限抽：一直抽到按停，成品落在固定八格的牆上，第 9 張原地蓋掉第 1 格。
//
// 這支只管兩件事：還要不要再抽一輪、這張卡放哪一格。它不知道 Telegram 存在，
// 也不知道抽牌規則，boot.js 負責把它跟 runBatch() 接起來。

const $ = (id) => document.getElementById(id);

export const WALL_SLOTS = 8;

const slots = new Array(WALL_SLOTS).fill(null);
let seq = 0;
let on = false;
let rounds = 0;
let made = 0;
let onStart = null;
let onStop = null;

function ensureSwitch() {
  if ($("infinite")) return $("infinite");
  const row = document.querySelector(".batch-row");
  if (!row) return null;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "same-switch inf-switch";
  btn.id = "infinite";
  btn.setAttribute("role", "switch");
  btn.setAttribute("aria-checked", "false");
  btn.setAttribute("aria-describedby", "infinite-hint");
  btn.title = "無限抽（I）";
  btn.innerHTML =
    '<span class="same-knob" aria-hidden="true"><i></i></span>' +
    '<span class="same-copy">' +
    '<strong id="infinite-label">無限抽</strong>' +
    '<em id="infinite-hint">一直抽到你喊停</em>' +
    "</span>";
  row.append(btn);
  return btn;
}

function paint() {
  const btn = $("infinite");
  if (!btn) return;
  btn.classList.toggle("is-on", on);
  btn.setAttribute("aria-checked", on ? "true" : "false");
  const label = $("infinite-label");
  if (label) label.textContent = on ? "停" : "無限抽";
  const hint = $("infinite-hint");
  if (!hint) return;
  if (!on) {
    hint.textContent = "一直抽到你喊停";
    return;
  }
  hint.textContent = made
    ? `第 ${rounds} 輪 · 已出 ${made} 張`
    : `第 ${rounds} 輪 · 按這裡立刻停`;
}

export function isInfinite() {
  return on;
}

// 使用者按下開關。開＝立刻開跑；關＝立刻斷（呼叫端負責 abort）。
function toggle() {
  if (on) {
    on = false;
    paint();
    onStop?.("已停");
    return;
  }
  on = true;
  rounds = 0;
  made = 0;
  paint();
  onStart?.();
}

// 非使用者操作的關閉：連續失敗、按取消、Comfy 連不上。
export function stopInfinite(reason) {
  if (!on) return false;
  on = false;
  paint();
  if (reason) {
    const hint = $("infinite-hint");
    if (hint) hint.textContent = reason;
  }
  return true;
}

export function beginRound() {
  if (!on) return;
  rounds += 1;
  paint();
}

export function countMade(n) {
  made += n;
  // 已經停了就不要再重畫 —— stopInfinite() 寫在副標的停止原因要留著給人看。
  if (on) paint();
}

export function initInfinite(hooks) {
  onStart = hooks && hooks.onStart;
  onStop = hooks && hooks.onStop;
  const btn = ensureSwitch();
  if (btn) btn.addEventListener("click", toggle);
  // 一次幾張解除上限——無限抽時使用者可能想一輪就排很多張。
  const n = $("n");
  if (n) n.removeAttribute("max");
  paint();
}

// —— 八格牆 ——

export function markLive(card) {
  if (card) card.classList.add("is-live");
}

export function clearLive(card) {
  if (card) card.classList.remove("is-live");
}

// 第 9 張起原地蓋掉最舊那格：replaceWith 保留 DOM 位置，所以版面不動，只有一格在換。
export function placeCard(card) {
  const wall = $("results");
  if (!wall) return card;
  wall.classList.add("is-wall");
  const i = seq % WALL_SLOTS;
  seq += 1;
  const old = slots[i];
  if (old && old.isConnected && old.parentNode === wall) {
    // 入場動畫交給各版面自己的 .card.is-wait —— 抽籤棚的卡片靠 transform 斜掛在衣繩上，
    // 這裡再疊一層 transform 動畫會把傾斜吃掉。
    old.replaceWith(card);
  } else {
    wall.append(card);
  }
  slots[i] = card;
  return card;
}

export function wallCards() {
  return slots.filter((c) => c && c.isConnected);
}

export function wallHasCards() {
  return wallCards().length > 0;
}
