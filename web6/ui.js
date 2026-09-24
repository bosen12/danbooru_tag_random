/** 墨池的畫面零件：建元素、遮罩、提示、滑鼠停留說明。只產生 DOM，不管流程。 */
import { lockScroll, unlockScroll } from "./scroll-lock.js";

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "style") node.style.cssText = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const ICONS = {
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>',
};

/* ---------- 遮罩 ---------- */

let openOverlays = [];

export function openSheet(title, body, { wide = false, onClose, foot } = {}) {
  const lastFocus = document.activeElement;
  const titleId = "sheet-" + Math.random().toString(36).slice(2, 8);
  const closeBtn = el("button", { class: "sheet-close", type: "button", "aria-label": "關閉", html: ICONS.close });
  const sheet = el(
    "div",
    { class: wide ? "sheet sheet-wide" : "sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
    el("h2", { id: titleId }, title),
    closeBtn,
    body,
    foot && foot.filter(Boolean).length ? el("div", { class: "sheet-foot" }, foot) : null
  );
  // 捲動鎖在 html 上、背景設成 inert —— 跟排字匣、導影台同一把鎖（web/scroll-lock.js），
  // 開彈窗時背景不會跳，鍵盤也 Tab 不到被蓋住的東西。
  const overlayId = "overlay-" + titleId;
  const overlay = el("div", { class: "overlay", id: overlayId }, sheet);
  const close = () => {
    if (!overlay.isConnected || overlay.dataset.closing) return;
    overlay.dataset.closing = "true";
    document.removeEventListener("keydown", onKey, true);
    openOverlays = openOverlays.filter((o) => o !== overlay);
    unlockScroll(overlayId);
    setTimeout(() => overlay.remove(), 170);
    if (lastFocus && lastFocus.isConnected) lastFocus.focus({ preventScroll: true });
    onClose && onClose();
  };
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  const onKey = (e) => {
    if (openOverlays.at(-1) !== overlay) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      const f = [...sheet.querySelectorAll("button, [href], input, select, [tabindex]:not([tabindex='-1'])")].filter((n) => !n.disabled);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f.at(-1).focus();
      } else if (!e.shiftKey && document.activeElement === f.at(-1)) {
        e.preventDefault();
        f[0].focus();
      }
    }
  };
  document.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
  openOverlays.push(overlay);
  lockScroll(overlayId);
  (sheet.querySelector(".sheet-foot .btn-primary") || closeBtn).focus({ preventScroll: true });
  return { close, sheet };
}

export function anyOverlay() {
  return openOverlays.length > 0;
}

/* ---------- 提示 ---------- */

let toastTimer = null;
export function toast(text) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = text;
  t.dataset.show = "true";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.dataset.show = "false"), 2600);
}

/* ---------- 滑鼠停留說明：滑鼠停 800ms，鍵盤聚焦立刻 ---------- */

let tip = null;
let tipTimer = null;
const FINE = typeof matchMedia === "function" && matchMedia("(hover: hover) and (pointer: fine)").matches;

export function attachTip(node, build) {
  node.addEventListener("focus", () => {
    if (node.matches(":focus-visible")) showTip(node, build());
  });
  node.addEventListener("blur", hideTip);
  if (!FINE) return;
  node.addEventListener("pointerenter", () => {
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => showTip(node, build()), 800);
  });
  node.addEventListener("pointerleave", hideTip);
  node.addEventListener("pointerdown", hideTip);
}

function showTip(node, content) {
  if (!node.isConnected || !content || document.body.dataset.dragging === "true") return;
  if (!tip) {
    tip = el("div", { class: "hover-tip", role: "tooltip" });
    document.body.append(tip);
  }
  tip.replaceChildren(content);
  const r = node.getBoundingClientRect();
  const w = 240;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  tip.style.left = left + "px";
  tip.dataset.show = "true";
  const h = tip.offsetHeight;
  let top = r.top - h - 10;
  if (top < 8) top = r.bottom + 10;
  tip.style.top = top + "px";
}

export function hideTip() {
  clearTimeout(tipTimer);
  if (tip) tip.dataset.show = "false";
}
