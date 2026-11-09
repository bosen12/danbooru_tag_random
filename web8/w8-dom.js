/**
 * web8 的小工具：建節點、提示條、彈出層、減少動態。
 * 跟 web6 的 ui.js 分開寫：web8 的畫面自己一套，不帶 web6 的樣式假設。
 */

/**
 * h("button", { class: "x", onclick, dataset: { tag }, aria: { pressed: true } }, "字", node, [陣列], null)
 * 屬性名照 DOM：class、style（字串或物件）、dataset、aria、on*（事件）、其他照 setAttribute。
 */
export function h(tag, props, ...kids) {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "style") {
        if (typeof v === "string") node.style.cssText = v;
        else for (const [sk, sv] of Object.entries(v)) sk.startsWith("--") ? node.style.setProperty(sk, sv) : (node.style[sk] = sv);
      } else if (k === "dataset") Object.assign(node.dataset, v);
      else if (k === "aria") for (const [ak, av] of Object.entries(v)) node.setAttribute("aria-" + ak, String(av));
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (k === "text") node.textContent = v;
      else if (k in node && typeof v !== "string") node[k] = v;
      else node.setAttribute(k, v === true ? "" : String(v));
    }
  }
  append(node, kids);
  return node;
}

function append(node, kids) {
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false) continue;
    if (Array.isArray(kid)) append(node, kid);
    else node.append(kid instanceof Node ? kid : String(kid));
  }
}

/** 換掉 node 的內容：kids 可以是巢狀陣列、null（replaceChildren 不會攤平陣列，會把它變成字串）。 */
export function fill(node, ...kids) {
  node.replaceChildren();
  append(node, kids);
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const reduced = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

export function debounce(fn, ms) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** 小圖示（線條，跟著文字顏色）。 */
const PATHS = {
  search: "M11 4a7 7 0 1 1 0 14a7 7 0 0 1 0-14zm9 16l-4.2-4.2",
  x: "M6 6l12 12M18 6L6 18",
  minus: "M6 12h12",
  plus: "M12 6v12M6 12h12",
  stop: "M7 7h10v10H7z",
  copy: "M9 9h10v10H9zM5 15V5h10",
  open: "M14 5h5v5M19 5l-8 8M18 14v5H5V6h5",
  redo: "M4 12a8 8 0 0 1 14-5.3M20 4v5h-5M20 12a8 8 0 0 1-14 5.3M4 20v-5h5",
  dice: "M5 5h14v14H5zM9 9h.01M15 15h.01M15 9h.01M9 15h.01",
  trash: "M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12",
  grid: "M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6z",
  stage: "M4 6h16v12H4zM8 21h8",
  sliders: "M5 7h9M18 7h1M5 17h3M12 17h7M14 5v4M8 15v4",
  check: "M5 12l4 4l10-10",
  chevron: "M9 6l6 6l-6 6",
  rooms: "M4 5h7v6H4zM13 5h7v14h-7zM4 13h7v6H4z",
  key: "M7 14a3 3 0 1 1 0-6a3 3 0 0 1 0 6zm3-3h10M17 11v3M20 11v2",
  ban: "M6 6l12 12M12 3a9 9 0 1 1 0 18a9 9 0 0 1 0-18",
  layers: "M12 4l8 4l-8 4l-8-4zM4 12l8 4l8-4M4 16l8 4l8-4",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6",
};
export function icon(name, size = 18) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "ico");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", PATHS[name] || "");
  svg.append(p);
  return svg;
}

/**
 * 提示條：右下角（手機在生圖鈕上面）一則一則疊。action 給一顆按鈕（復原、看一下）。
 * 同一個 key 的新提示蓋掉舊的，連按好幾次不會堆成一串。
 */
const live = new Map();
export function toast(text, { action, onAction, tone = "", ms = 3600, key } = {}) {
  const host = document.getElementById("toasts");
  if (!host || !text) return;
  if (key && live.has(key)) live.get(key).remove();
  const node = h(
    "div",
    { class: "toast" + (tone ? " is-" + tone : ""), role: "status" },
    h("span", { class: "toast-text" }, text),
    action
      ? h("button", {
          class: "toast-act",
          type: "button",
          onclick: () => {
            onAction?.();
            close();
          },
        }, action)
      : null
  );
  let timer = 0;
  const close = () => {
    clearTimeout(timer);
    if (key && live.get(key) === node) live.delete(key);
    if (!node.isConnected) return;
    if (reduced()) return node.remove();
    node.classList.add("is-leaving");
    setTimeout(() => node.remove(), 220);
  };
  node.addEventListener("pointerenter", () => clearTimeout(timer));
  node.addEventListener("pointerleave", () => (timer = setTimeout(close, 1600)));
  host.append(node);
  while (host.children.length > 4) host.firstElementChild.remove();
  if (key) live.set(key, node);
  timer = setTimeout(close, ms);
  return close;
}

/**
 * 彈出層（貼著某顆按鈕）：點外面、Esc 就關。同時只開一個。
 * place(anchor) 依按鈕位置放；畫面不夠時往上翻。
 */
let openPop = null;
export function popover(anchor, content, { cls = "", onClose, align = "start" } = {}) {
  closePopover();
  const node = h("div", { class: "pop " + cls, role: "dialog" }, content);
  document.body.append(node);
  const place = () => {
    const r = anchor.getBoundingClientRect();
    const w = node.offsetWidth;
    const hgt = node.offsetHeight;
    let left = align === "end" ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    let top = r.bottom + 8;
    if (top + hgt > innerHeight - 8 && r.top - hgt - 8 > 8) top = r.top - hgt - 8;
    top = Math.max(8, Math.min(top, innerHeight - hgt - 8));
    node.style.left = left + "px";
    node.style.top = top + "px";
  };
  place();
  const away = (e) => {
    if (!node.contains(e.target) && !anchor.contains(e.target)) closePopover();
  };
  const key = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closePopover();
      anchor.focus?.();
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", away, true), 0);
  document.addEventListener("keydown", key, true);
  addEventListener("resize", place);
  openPop = {
    node,
    close() {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key, true);
      removeEventListener("resize", place);
      node.remove();
      onClose?.();
    },
  };
  return openPop;
}
export function closePopover() {
  const p = openPop;
  openPop = null;
  p?.close();
}
export const popoverOpen = () => !!openPop;

/** 全螢幕的層（大圖、快捷鍵說明）。 */
export function sheet(content, { cls = "", label = "" } = {}) {
  closePopover();
  const prev = document.activeElement;
  const close = () => {
    document.removeEventListener("keydown", key, true);
    if (reduced()) node.remove();
    else {
      node.classList.add("is-leaving");
      setTimeout(() => node.remove(), 200);
    }
    prev?.focus?.();
  };
  const key = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  const node = h(
    "div",
    { class: "sheet " + cls, role: "dialog", "aria-modal": "true", "aria-label": label, onclick: (e) => e.target === node && close() },
    h("div", { class: "sheet-body" }, content, h("button", { class: "sheet-x icon-btn", type: "button", "aria-label": "關閉", onclick: close }, icon("x")))
  );
  document.body.append(node);
  document.addEventListener("keydown", key, true);
  node.querySelector("button, [tabindex]")?.focus();
  return close;
}

/** 從 a 飛到 b 的影子（牌從字盒進配方）。from、to 是 DOMRect；src 是圖。 */
export function fly(src, from, to, { ms = 420 } = {}) {
  if (reduced() || !from || !to || !src) return;
  const ghost = h("img", { class: "fly-ghost", src, alt: "" });
  Object.assign(ghost.style, { left: from.left + "px", top: from.top + "px", width: from.width + "px", height: from.height + "px" });
  document.body.append(ghost);
  const dx = to.left - from.left;
  const dy = to.top - from.top;
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  const anim = ghost.animate(
    [
      { transform: "translate(0,0) scale(1)", opacity: 1, filter: "brightness(1)" },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.35 - 40}px) scale(${(1 + sx) / 2}) rotate(-4deg)`, opacity: 1, offset: 0.55, filter: "brightness(1.15)" },
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.2, filter: "brightness(1)" },
    ],
    { duration: ms, easing: "cubic-bezier(.2,.7,.2,1)" }
  );
  anim.onfinish = () => ghost.remove();
  anim.oncancel = () => ghost.remove();
}

/** 複製到剪貼簿（不支援時退回選取文字）。 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h("textarea", { style: "position:fixed;opacity:0;top:0" });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** 數字加千分位（6,583）。 */
export const num = (n) => Number(n || 0).toLocaleString("en-US");
