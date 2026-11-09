/**
 * 字盒：搜尋＋花色，牌一批一批往下長（捲到底再拿下一批）。
 * 收牌、搜尋、被藏起來的原因全部照墨池（mobile-bridge.js 的 library：分級、性別、只看一個時代）。
 *
 * 點牌：放進配方／拿出來。右鍵或 Alt＋點：丟廢字簍／撿回來。
 * 滑鼠停一下：浮出大牌和說明。手機長按：同一張大牌，下面兩顆按鈕。
 */
import * as B from "./mobile-bridge.js";
import { h, $, icon, popover, closePopover, debounce, num } from "./w8-dom.js";

const PAGE = 72;
const PEEK_MS = 520;
const LONG_MS = 460;

export function mountLibrary(app) {
  const root = $("#lib");
  const q = $("#lib-q", root);
  const suits = $("#lib-suits", root);
  const status = $("#lib-status", root);
  const grid = $("#lib-grid", root);
  const more = $("#lib-more", root);
  let offset = 0;
  let total = 0;
  let loading = false;
  let marks = { pinned: new Set(), banned: new Set(), clash: new Set() };

  // 花色：全部＋每一種。記在 ui.suit。
  suits.replaceChildren(
    ...[{ id: "", label: "全部", glyph: "全" }, ...app.meta.suits].map((s) =>
      h(
        "button",
        {
          class: "suit",
          type: "button",
          dataset: { suit: s.id },
          aria: { pressed: app.ui.suit === s.id },
          onclick: () => {
            app.ui.suit = s.id;
            app.saveUi();
            for (const b of suits.children) b.setAttribute("aria-pressed", String(b.dataset.suit === s.id));
            reload();
          },
        },
        s.id ? h("span", { class: "suit-glyph", dataset: { suit: s.id } }, s.glyph) : null,
        s.label
      )
    )
  );

  function tile(c) {
    return h(
      "button",
      { class: "tile", type: "button", dataset: { tag: c.tag, suit: c.suit, rating: c.rating }, "aria-label": c.zh },
      c.art
        ? h("img", { src: c.art.thumb, alt: "", loading: "lazy", decoding: "async", draggable: "false", onerror: (e) => e.target.replaceWith(h("span", { class: "tile-blank" }, c.glyph)) })
        : h("span", { class: "tile-blank" }, c.glyph),
      h("span", { class: "tile-seal", dataset: { suit: c.suit } }, c.glyph),
      h("span", { class: "tile-name" }, c.spine || c.zh),
      h("span", { class: "tile-flag", "aria-hidden": "true" })
    );
  }

  function paintMark(node) {
    const tag = node.dataset.tag;
    const pinned = marks.pinned.has(tag);
    node.setAttribute("aria-pressed", String(pinned));
    node.classList.toggle("is-banned", marks.banned.has(tag));
    node.classList.toggle("is-clash", !pinned && marks.clash.has(tag));
    node.querySelector(".tile-flag").textContent = pinned ? "已放" : marks.banned.has(tag) ? "廢字簍" : marks.clash.has(tag) ? "相剋" : "";
  }

  function refreshMarks() {
    marks = { pinned: new Set(app.core.pins), banned: new Set(app.core.bans), clash: new Set(B.autoBanned(app.core)) };
    for (const node of grid.children) paintMark(node);
  }

  function statusLine(res) {
    const query = q.value.trim();
    const bits = [];
    if (!query) bits.push(h("span", { class: "lib-count" }, `${num(res.total)} 張`));
    else if (res.mode === "guess") bits.push(h("span", { class: "lib-note" }, `找不到「${query}」，最接近的是：`));
    else if (res.mode === "any") bits.push(h("span", { class: "lib-note" }, `沒有一張同時符合，分別找到這些：`));
    else if (res.total) bits.push(h("span", { class: "lib-count" }, `找到 ${num(res.total)} 張`));
    else if (!res.hidden) bits.push(h("span", { class: "lib-note" }, `找不到「${query}」`));
    if (res.hidden) {
      bits.push(
        h(
          "span",
          { class: "lib-hidden" },
          res.hidden.count > 1 ? `${res.hidden.text}（另有 ${res.hidden.count} 張被收起來）` : res.hidden.text,
          h("button", { class: "link-btn", type: "button", onclick: () => app.act.configure(res.hidden.patch) }, res.hidden.label)
        )
      );
    }
    status.replaceChildren(...bits);
  }

  function load(reset) {
    if (loading && !reset) return;
    if (reset) {
      offset = 0;
      grid.replaceChildren();
      grid.scrollTop = 0;
      root.querySelector(".lib-scroll").scrollTop = 0;
    }
    loading = true;
    const res = B.library(app.core, { query: q.value, suit: app.ui.suit, offset, limit: PAGE });
    total = res.total;
    if (reset) statusLine(res);
    const frag = document.createDocumentFragment();
    for (const c of res.cards) {
      const node = tile(c);
      paintMark(node);
      frag.append(node);
    }
    grid.append(frag);
    offset += res.cards.length;
    more.hidden = offset >= total;
    grid.classList.toggle("is-empty", !grid.children.length);
    loading = false;
  }

  function reload() {
    closePeek();
    marks = { pinned: new Set(app.core.pins), banned: new Set(app.core.bans), clash: new Set(B.autoBanned(app.core)) };
    load(true);
  }

  new IntersectionObserver((ents) => ents.some((e) => e.isIntersecting) && offset < total && load(false), { root: root.querySelector(".lib-scroll"), rootMargin: "600px" }).observe(more);

  q.addEventListener("input", debounce(reload, 90));
  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = grid.querySelector(".tile");
      if (first) app.act.togglePin(first.dataset.tag, first);
    } else if (e.key === "Escape" && q.value) {
      e.preventDefault();
      e.stopPropagation();
      q.value = "";
      reload();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      grid.querySelector(".tile")?.focus();
    }
  });
  $("#lib-clear", root)?.addEventListener("click", () => {
    q.value = "";
    reload();
    q.focus();
  });

  // 點、右鍵、Alt＋點（用委派：牌很多）。
  let suppressClick = false;
  grid.addEventListener("click", (e) => {
    const node = e.target.closest(".tile");
    if (!node || suppressClick) return;
    closePeek();
    if (e.altKey) app.act.toggleBan(node.dataset.tag);
    else app.act.togglePin(node.dataset.tag, node);
  });
  grid.addEventListener("contextmenu", (e) => {
    const node = e.target.closest(".tile");
    if (!node) return;
    e.preventDefault();
    closePeek();
    app.act.toggleBan(node.dataset.tag);
  });

  // 方向鍵在牌之間走（一排幾張照當下的寬度算）。
  grid.addEventListener("keydown", (e) => {
    const node = e.target.closest(".tile");
    if (!node) return;
    const tiles = [...grid.children];
    const i = tiles.indexOf(node);
    const cols = Math.max(1, Math.round(grid.clientWidth / node.offsetWidth));
    const go = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (go === undefined) return;
    e.preventDefault();
    if (i + go < 0) return q.focus();
    tiles[Math.min(tiles.length - 1, i + go)]?.focus();
  });

  // 大牌：滑鼠停一下；手機長按。
  let peekTimer = 0;
  let peekFor = null;
  let pressTimer = 0;
  function closePeek() {
    clearTimeout(peekTimer);
    if (peekFor) closePopover();
    peekFor = null;
  }
  function showPeek(node, withActions) {
    const info = B.card(node.dataset.tag);
    if (!info) return;
    peekFor = node;
    const pinned = app.core.pins.includes(info.tag);
    const banned = app.core.bans.includes(info.tag);
    const facts = (info.facts || []).slice(0, 6);
    popover(
      node,
      h(
        "div",
        { class: "peek" },
        info.art ? h("img", { class: "peek-art", src: info.art.full, alt: "" }) : h("div", { class: "peek-art peek-blank" }, info.glyph),
        h(
          "div",
          { class: "peek-body" },
          h("div", { class: "peek-title" }, h("span", { class: "tile-seal", dataset: { suit: info.suit } }, info.glyph), info.zh),
          h("div", { class: "peek-tag" }, info.tag),
          facts.length ? h("dl", { class: "peek-facts" }, facts.map((f) => [h("dt", {}, f.label), h("dd", {}, f.value)])) : null,
          withActions
            ? h(
                "div",
                { class: "peek-actions" },
                h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => (closePeek(), app.act.togglePin(info.tag, node)) }, pinned ? "拿出配方" : "放進配方"),
                h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => (closePeek(), app.act.toggleBan(info.tag)) }, banned ? "撿回來" : "丟廢字簍")
              )
            : h("p", { class: "peek-hint" }, pinned ? "點一下拿出配方" : "點一下放進配方 · 右鍵丟廢字簍")
        )
      ),
      { cls: "pop-peek" + (withActions ? " is-touch" : ""), onClose: () => (peekFor = null) }
    );
  }
  grid.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const node = e.target.closest(".tile");
    if (!node || node === peekFor) return;
    clearTimeout(peekTimer);
    if (peekFor) closePeek();
    peekTimer = setTimeout(() => node.matches(":hover") && showPeek(node, false), PEEK_MS);
  });
  grid.addEventListener("pointerleave", () => closePeek());
  grid.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    const node = e.target.closest(".tile");
    if (!node) return;
    suppressClick = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      suppressClick = true;
      showPeek(node, true);
    }, LONG_MS);
  });
  for (const ev of ["pointerup", "pointercancel", "pointermove"]) {
    grid.addEventListener(ev, (e) => {
      if (ev === "pointermove" && Math.abs(e.movementX) + Math.abs(e.movementY) < 6) return;
      clearTimeout(pressTimer);
      if (ev !== "pointermove") setTimeout(() => (suppressClick = false), 60);
    });
  }

  app.on("settings", reload);
  app.on("pool", refreshMarks);
  reload();

  return {
    focusSearch() {
      if (app.isPhone()) app.setView("lib");
      q.focus();
      q.select();
    },
    tileOf: (tag) => grid.querySelector(`.tile[data-tag="${CSS.escape(tag)}"]`),
  };
}
