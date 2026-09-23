/**
 * 抽完了，但新的那張在畫面外。
 *
 * 八格牆第二輪之後刻意不自動捲 —— 使用者可能正捲在詞庫深處挑字，硬把畫面拉走
 * 是在搶東西。可是第 9 張起新卡原地蓋掉最舊那格，可能在牆上任何位置；實測捲到
 * 詞庫中段按只抽牌，新卡在 y = -376，唯一的回饋是 dock 一行「抽牌完成 1 張」。
 *
 * 所以只「指」不「拉」：dock 中間出現一顆「↑ 看新的一張」，按了才捲過去，
 * 新卡自己進到畫面就收起來。焦點跟著落在新卡上，鍵盤使用者不會被丟在原地。
 */

let pill = null;
let pillWin = null;
let target = null;
let io = null;

export function prefersReducedMotion(win = globalThis.window) {
  try {
    return !!win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** 要滑還是直接跳：減少動態的人不該被畫面拖著走。 */
export function scrollBehavior(win = globalThis.window) {
  return prefersReducedMotion(win) ? "auto" : "smooth";
}

function ensurePill(doc, win) {
  if (pill) return pill;
  const status = doc.getElementById("status");
  if (!status) return null;
  pill = doc.createElement("button");
  pill.type = "button";
  pill.className = "ghost mini new-card-cue";
  pill.hidden = true;
  pillWin = win;
  pill.addEventListener("click", (e) => {
    e?.preventDefault?.();
    jump();
  });
  status.before(pill);
  return pill;
}

function jump() {
  const card = target;
  hideNewCardCue();
  if (!card || !card.isConnected) return;
  card.scrollIntoView({ behavior: scrollBehavior(pillWin), block: "center" });
  if (card.getAttribute("tabindex") == null) card.setAttribute("tabindex", "-1");
  card.focus({ preventScroll: true });
}

export function hideNewCardCue() {
  if (pill) pill.hidden = true;
  if (io) {
    io.disconnect();
    io = null;
  }
  target = null;
}

/** 新卡在畫面內就什麼都不做；在畫面外就在 dock 指一下方向。回傳有沒有提示。 */
export function cueNewCard(card, { doc = globalThis.document, win = globalThis.window } = {}) {
  if (!card || !card.isConnected || !doc) return false;
  const r = card.getBoundingClientRect();
  const vh = win?.innerHeight || doc.documentElement?.clientHeight || 0;
  if (r.bottom > 0 && r.top < vh) {
    hideNewCardCue();
    return false;
  }
  const p = ensurePill(doc, win);
  if (!p) return false;
  hideNewCardCue();
  target = card;
  p.textContent = r.bottom <= 0 ? "↑ 看新的一張" : "↓ 看新的一張";
  p.setAttribute("aria-label", "捲到剛抽好的那張");
  p.hidden = false;
  const IO = win?.IntersectionObserver;
  if (typeof IO === "function") {
    io = new IO((entries) => {
      if (entries.some((e) => e.isIntersecting)) hideNewCardCue();
    });
    io.observe(card);
  }
  return true;
}

/** 測試用：丟掉快取的按鈕，下一次重新建立。 */
export function resetNewCardCue() {
  hideNewCardCue();
  pill = null;
  pillWin = null;
}
