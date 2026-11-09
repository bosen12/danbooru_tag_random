/**
 * 配方：放進來的牌（每一張圖都一定有），份量五檔，廢字簍。
 * 空的時候給三組起手（web6 starters.js，跟墨池同一份；分級、廢字簍擋掉的組合不出）。
 */
import * as B from "./mobile-bridge.js";
import { pickStarters } from "./starters.js";
import { h, $, icon, popover, closePopover } from "./w8-dom.js";

export function mountRecipe(app) {
  const root = $("#recipe");
  const tray = $("#recipe-tray", root);
  const count = $("#recipe-count", root);
  const bansBtn = $("#recipe-bans", root);
  const clearBtn = $("#recipe-clear", root);
  let starters = [];

  const allowed = (tag) => {
    const c = B.cards([tag])[0];
    return !!c && !app.core.bans.includes(tag) && !app.hiddenByRating(c);
  };

  const fmtW = (w) => (w === 1 ? "" : w.toFixed(1));

  function chip(c, tag) {
    const w = app.core.weights[tag] ?? 1;
    const node = h(
      "div",
      { class: "rc", dataset: { tag, suit: c ? c.suit : "" }, role: "listitem" },
      h(
        "div",
        { class: "rc-art" },
        c && c.art ? h("img", { src: c.art.thumb, alt: "", draggable: "false" }) : h("span", { class: "tile-blank" }, c ? c.glyph : "？"),
        h("span", { class: "tile-seal", dataset: { suit: c ? c.suit : "" } }, c ? c.glyph : ""),
        w !== 1 ? h("span", { class: "rc-weight", title: "份量" }, "×" + fmtW(w)) : null
      ),
      h("div", { class: "rc-name", title: tag }, c ? c.zh : tag),
      h(
        "div",
        { class: "rc-tools" },
        h("button", { class: "rc-btn", type: "button", "aria-label": `${c ? c.zh : tag} 份量少一點`, disabled: w <= 0.7, onclick: () => app.act.weigh(tag, -1) }, icon("minus", 13)),
        h("button", { class: "rc-btn", type: "button", "aria-label": `${c ? c.zh : tag} 份量多一點`, disabled: w >= 1.4, onclick: () => app.act.weigh(tag, 1) }, icon("plus", 13)),
        h("button", { class: "rc-btn rc-x", type: "button", "aria-label": `拿掉 ${c ? c.zh : tag}`, onclick: () => app.act.unpin(tag) }, icon("x", 13))
      )
    );
    return node;
  }

  function emptyState() {
    if (!starters.length || !starters.every((s) => s.tags.every(allowed))) starters = pickStarters(allowed, starters.map((s) => s.name));
    return h(
      "div",
      { class: "rc-empty" },
      h("p", { class: "rc-empty-title" }, "點字盒的牌放進來"),
      h("p", { class: "rc-empty-sub" }, "放進來的牌每一張圖都一定有，其他的交給引擎抽。或從這裡起手："),
      h(
        "div",
        { class: "rc-starters" },
        starters.map((s) =>
          h("button", { class: "chip chip-starter", type: "button", onclick: () => app.act.useTags(s.tags, {}, `起手：${s.name}`) }, s.name)
        ),
        h(
          "button",
          {
            class: "chip chip-ghost",
            type: "button",
            "aria-label": "換一組起手",
            onclick: () => {
              starters = pickStarters(allowed, starters.map((s) => s.name));
              render();
            },
          },
          icon("redo", 13),
          "換一組"
        )
      )
    );
  }

  function render() {
    const pins = app.core.pins;
    const cards = B.cards(pins);
    count.textContent = pins.length ? `${pins.length} 張` : "";
    clearBtn.hidden = !pins.length;
    const nb = app.core.bans.length;
    bansBtn.hidden = !nb;
    bansBtn.querySelector(".n").textContent = nb;
    tray.classList.toggle("is-empty", !pins.length);
    tray.replaceChildren(...(pins.length ? pins.map((tag, i) => chip(cards[i], tag)) : [emptyState()]));
  }

  bansBtn.addEventListener("click", () => {
    const list = h("div", { class: "ban-list" });
    const fill = () => {
      const bans = app.core.bans;
      if (!bans.length) return closePopover();
      const cards = B.cards(bans);
      list.replaceChildren(
        ...bans.map((tag, i) =>
          h(
            "div",
            { class: "ban-row" },
            h("span", { class: "ban-name" }, cards[i] ? cards[i].zh : tag),
            h("button", { class: "link-btn", type: "button", onclick: () => (app.act.unban(tag), fill()) }, "撿回來")
          )
        )
      );
    };
    fill();
    popover(bansBtn, h("div", { class: "bans" }, h("div", { class: "pop-title" }, "廢字簍", h("span", { class: "muted" }, "這些牌不會被抽到")), list), { align: "end" });
  });
  clearBtn.addEventListener("click", () => app.act.clearPool());

  app.on("pool", render);
  app.on("settings", render);
  render();

  /** 某張牌在配方裡的位置（飛過來的終點）；還沒畫好就給整條的位置。 */
  return {
    slotRect(tag) {
      const node = tray.querySelector(`.rc[data-tag="${CSS.escape(tag)}"] .rc-art`);
      return (node || tray).getBoundingClientRect();
    },
  };
}
