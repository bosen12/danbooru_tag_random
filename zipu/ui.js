/** 畫面零件：卡牌、道具、頭像、委託單、遮罩、提示。只產生 DOM，不管遊戲流程。 */
import { SUIT_INFO, ERA_ZH, artFile } from "./pool.js";
import { artSources, artUrl, applyArtSources } from "./card-art.js";
import { ENHANCEMENTS } from "./rules.js";
import { RARITY_ZH } from "./content.js";
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
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  types: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 5h14v14H5z"/><path d="M5 10h14M10 10v9"/></svg>',
  deck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="6" width="11" height="14" rx="1.5"/><path d="M8 3h10.5A1.5 1.5 0 0 1 20 4.5V17"/></svg>',
  gallery: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18"/><rect x="5" y="8" width="6" height="9" rx="1"/><rect x="13" y="8" width="6" height="9" rx="1"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9a4 4 0 0 1 0 6"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 10l4 4M21 10l-4 4"/></svg>',
};

export function iconButton(icon, label, onclick) {
  return el("button", { class: "icon-btn", type: "button", "aria-label": label, title: label, html: ICONS[icon], onclick });
}

/* ---------- 插畫 ---------- */

export function createAssets(cardManifest, artManifest) {
  const cards = new Set(Object.keys(cardManifest || {}));
  const extras = new Set(Object.keys(artManifest || {}));
  return {
    card(tag) {
      return cards.has(tag) ? artUrl({ ...cardManifest[tag], file: artFile(tag) }) : null;
    },
    /** 牌面用：有縮圖就給 srcset（web/card-art.js 的 artSources）。 */
    cardSources(tag) {
      return cards.has(tag) ? artSources({ ...cardManifest[tag], file: artFile(tag) }) : null;
    },
    extra(id) {
      return extras.has(id) ? artUrl({ ...artManifest[id], file: `${id}.webp` }, "art/") : null;
    },
    count() {
      return { cards: cards.size, extras: extras.size };
    },
  };
}

/** 牌面：有縮圖就讓瀏覽器照畫出來的大小挑（手牌、字盒很小，放大牌拿原圖）。 */
function cardImg(sources) {
  const i = applyArtSources(el("img", { alt: "", decoding: "async", draggable: "false" }), sources);
  i.addEventListener("error", () => i.remove(), { once: true });
  return i;
}

function img(src) {
  const i = el("img", { src, alt: "", decoding: "async", draggable: "false" });
  i.addEventListener("error", () => i.remove(), { once: true });
  return i;
}

/* ---------- 卡牌 ---------- */

/** 一張字。inst = {id, tag, enh}；card = world.byCard.get(tag)。 */
export function cardNode(card, inst, assets, opts = {}) {
  const len = [...card.zh].length;
  const src = card.art ? assets.card(card.tag) : null;
  const suit = SUIT_INFO[card.suit];
  const label = `${card.zh}（${card.tag}），${suit.zh}，佔 ${card.slots} 格，${card.chips} 籌碼${inst?.enh ? "，" + ENHANCEMENTS[inst.enh].zh : ""}`;
  const node = el(
    opts.static ? "div" : "button",
    {
      class: "card",
      type: opts.static ? undefined : "button",
      dataset: { suit: card.suit, id: inst ? String(inst.id) : "", tag: card.tag, enh: inst?.enh || "" },
      "aria-label": label,
      "aria-pressed": opts.static ? undefined : "false",
    },
    el(
      "span",
      { class: "card-spine" },
      el("span", { class: "card-suit", "aria-hidden": "true" }, suit.glyph),
      el("span", { class: "card-name", dataset: { len: String(Math.min(len, 7)) }, "aria-hidden": "true" }, card.zh),
      el("span", { class: "card-chips", "aria-hidden": "true" }, card.chips)
    ),
    el(
      "span",
      { class: "card-art", "aria-hidden": "true" },
      src ? cardImg(assets.cardSources ? assets.cardSources(card.tag) : { src }) : el("span", { class: "card-glyph" }, [...card.zh][0]),
      el("span", { class: "card-slots" }, Array.from({ length: card.slots }, () => el("i"))),
      inst?.enh ? el("span", { class: "card-enh" }, ENHANCEMENTS[inst.enh].zh) : null
    )
  );
  if (opts.static) node.setAttribute("role", "img");
  return node;
}

export function setFlag(node, kind, text) {
  node.querySelector(".card-flag")?.remove();
  if (!kind) return;
  node.querySelector(".card-art").append(el("span", { class: "card-flag", dataset: { kind } }, text));
}

/* ---------- 道具、印材、字模、字包 ---------- */

const GLYPH = { joker: "具", material: "材", typeface: "模", pack: "包", voucher: "升" };

export function toolNode(kind, def, assets, opts = {}) {
  const artId = kind === "joker" ? "joker-" + def.id
    : kind === "material" ? "mat-" + def.id
    : kind === "typeface" ? "typeface"
    : kind === "voucher" ? "voucher-" + def.id
    : def.id;
  const src = assets.extra(artId);
  const glyph = kind === "typeface" ? [...def.zh][0] : GLYPH[kind];
  const node = el(
    opts.static ? "div" : "button",
    {
      class: kind === "material" ? "tool mat" : "tool",
      type: opts.static ? undefined : "button",
      dataset: { kind, id: def.id, rarity: def.rarity ? String(def.rarity) : "" },
      "aria-label": `${def.zh}：${def.desc}`,
    },
    el(
      "span",
      { class: "tool-art", "aria-hidden": "true" },
      src ? img(src) : null,
      !src || kind === "typeface" ? el("span", { class: "tool-glyph" }, glyph) : null
    ),
    el("span", { class: "tool-name", "aria-hidden": "true" }, def.zh),
    opts.note ? el("span", { class: "tool-note" }, opts.note) : null
  );
  return node;
}

export function rarityZh(r) {
  return RARITY_ZH[r] || "";
}

/* ---------- 頭像與委託單 ---------- */

export function portraitNode(who, assets) {
  const src = who ? assets.extra("who-" + who.id) : null;
  return el(
    "span",
    { class: "portrait", "aria-hidden": "true" },
    src ? img(src) : el("span", { class: "tool-glyph", style: "position:static;height:100%" }, who ? [...who.zh].at(-1) : "客")
  );
}

export function slipNode(blind, assets, { onAccept, requestDone } = {}) {
  const node = el(
    "article",
    { class: "slip", dataset: { state: blind.state } },
    el(
      "div",
      { class: "slip-head" },
      portraitNode(blind.who, assets),
      el("div", {}, el("p", { class: "slip-kind" }, blind.kind), el("h3", { class: "slip-who" }, blind.who.zh))
    ),
    blind.who.hello ? el("p", { class: "slip-hello" }, "「" + blind.who.hello + "」") : null,
    blind.rules.map((b) => el("p", { class: "slip-rule" }, b.rule)),
    blind.request
      ? el(
          "p",
          { class: "slip-request", dataset: { done: requestDone ? "true" : "false" } },
          el("span", { class: "label" }, "附加"),
          el("span", {}, `${blind.request.text}（+3 兩）`)
        )
      : null,
    el(
      "div",
      { class: "slip-numbers" },
      el("span", {}, el("span", { class: "slip-kind" }, "至少 "), el("span", { class: "target" }, blind.target.toLocaleString("en-US")), el("span", { class: "slip-kind" }, " 分")),
      el("span", { class: "reward" }, "報酬 " + blind.reward + " 兩")
    ),
    blind.state === "now" && onAccept ? el("button", { class: "btn btn-primary", type: "button", onclick: onAccept }, "接單") : null,
    blind.state === "done" ? el("span", { class: "seal slip-stamp", "aria-label": "已結清" }, "結清") : null
  );
  return node;
}

/* ---------- 遮罩 ---------- */

let openOverlays = [];

export function openSheet(title, body, { wide = false, onClose, foot } = {}) {
  const lastFocus = document.activeElement;
  const titleId = "sheet-" + Math.random().toString(36).slice(2, 8);
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
  const sheet = el(
    "div",
    { class: wide ? "sheet sheet-wide" : "sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
    el("h2", { id: titleId }, title),
    iconButton("close", "關閉", close),
    body,
    foot ? el("div", { class: "sheet-foot" }, foot) : null
  );
  sheet.querySelector(".icon-btn").classList.add("sheet-close");
  // 捲動鎖在 html 上、背景設成 inert：跟排字匣、導影台、墨池同一把鎖（web/scroll-lock.js）。
  // 以前只蓋一層遮罩，底下的頁面照樣會捲，Tab 也跑得到被蓋住的按鈕。
  const overlayId = "overlay-" + titleId;
  const overlay = el("div", { class: "overlay", id: overlayId }, sheet);
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
  const first = sheet.querySelector(".sheet-foot .btn, .btn-primary") || sheet.querySelector(".sheet-close");
  first && first.focus({ preventScroll: true });
  return { close, sheet, overlay };
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
  toastTimer = setTimeout(() => {
    t.dataset.show = "false";
  }, 2200);
}

/* ---------- 滑鼠停留提示（只在有滑鼠的裝置上） ---------- */

let tip = null;
let tipTimer = null;
const FINE = typeof matchMedia === "function" && matchMedia("(hover: hover) and (pointer: fine)").matches;

/** 滑鼠停 800ms 才出現（掃過一排牌不會閃個不停）；鍵盤聚焦則立刻出現。 */
export function attachTip(node, build) {
  node.addEventListener("focus", () => {
    if (node.matches(":focus-visible")) {
      clearTimeout(tipTimer);
      showTip(node, build());
    }
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
  if (!node.isConnected || !content) return;
  if (!tip) {
    tip = el("div", { class: "hover-tip", role: "tooltip" });
    document.body.append(tip);
  }
  tip.replaceChildren(content);
  const r = node.getBoundingClientRect();
  const w = 240;
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
  tip.style.left = left + "px";
  tip.style.width = w + "px";
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

/** 卡牌的完整說明（提示框、詳情頁共用）。 */
export function cardFacts(world, card, inst) {
  const facts = [];
  facts.push(["花色", SUIT_INFO[card.suit].zh]);
  facts.push(["佔格", `${card.slots} 格・${card.chips} 籌碼`]);
  facts.push(["時代", card.eras.map((e) => ERA_ZH[e] || e).join("、")]);
  if (card.mutex) {
    const group = world.data.groupZh?.[card.group] || card.group;
    facts.push(["同類", `${group}：一版只能一張`]);
  }
  if (card.implies.length) facts.push(["附帶", card.implies.map((t) => world.byTag.get(t)?.zh || t).join("、")]);
  const pairs = [...(world.pairs.get(card.tag) || [])].slice(0, 8).map((t) => world.byCard.get(t)?.zh || t);
  if (pairs.length) facts.push(["呼應", pairs.join("、") + ((world.pairs.get(card.tag)?.size || 0) > 8 ? "……" : "")]);
  if (inst?.enh) facts.push(["加工", `${ENHANCEMENTS[inst.enh].zh}：${ENHANCEMENTS[inst.enh].desc}`]);
  return facts;
}

export function cardTip(world, card, inst) {
  const facts = cardFacts(world, card, inst);
  return el(
    "div",
    {},
    el("h4", {}, card.zh, el("span", { class: "tag-en" }, card.tag)),
    el("p", { class: "meta" }, facts.map(([k, v]) => `${k}　${v}`).join("\n")),
  );
}
