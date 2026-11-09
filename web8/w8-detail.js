/**
 * 檢視欄的「這張」：選中的那張用了哪些牌（釘選、附帶、隨機…）、放了卻沒抽到的、引擎拿掉的和原因、提示詞。
 * 點一張牌：放進配方或丟廢字簍，改完再抽。
 */
import { h, $, fill, icon, popover, closePopover, copyText, toast } from "./w8-dom.js";

const SECTION_ZH = { subject: "人物", feature: "長相", clothing: "服裝", pose: "姿勢", env: "場景", style: "風格", quality: "品質" };
const STATUS_ZH = { drawn: "只抽了牌", queued: "排隊中", running: "印製中", done: "印好了", failed: "印壞了", cancelled: "取消了" };

export function mountDetail(app) {
  const root = $("#detail");

  function cardChip(c) {
    const from = c.from === "pin" ? "pin" : c.from === "random" ? "random" : "linked";
    const node = h(
      "button",
      { class: "dc", type: "button", dataset: { from }, title: c.parent ? `${c.label}：因為「${c.parent}」` : c.label },
      h("span", { class: "dc-name" }, c.zh),
      c.weight && c.weight !== 1 ? h("span", { class: "dc-w" }, "×" + c.weight.toFixed(1)) : null,
      from !== "random" ? h("span", { class: "dc-src" }, c.label) : null
    );
    node.addEventListener("click", () => {
      const pinned = app.core.pins.includes(c.tag);
      const banned = app.core.bans.includes(c.tag);
      popover(
        node,
        h(
          "div",
          { class: "dc-pop" },
          h("div", { class: "pop-title" }, c.zh, h("span", { class: "muted mono" }, c.tag)),
          c.parent ? h("p", { class: "muted" }, `${c.label}：因為「${c.parent}」`) : null,
          h(
            "div",
            { class: "peek-actions" },
            c.isCard
              ? h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => (closePopover(), app.act.togglePin(c.tag)) }, pinned ? "拿出配方" : "放進配方")
              : null,
            c.isCard
              ? h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => (closePopover(), app.act.toggleBan(c.tag)) }, banned ? "撿回來" : "下次不要（丟廢字簍）")
              : h("p", { class: "muted" }, "這個字不是詞庫裡的牌（觸發詞、自製字）。")
          )
        )
      );
    });
    return node;
  }

  function render() {
    const s = app.selected();
    root.dataset.status = s ? s.status : "";
    root.dataset.id = s ? s.id : "";
    if (!s) {
      root.replaceChildren(
        h("div", { class: "empty-note" }, h("p", { class: "empty-title" }, "還沒有選中的圖"), h("p", { class: "muted" }, "生圖或只抽牌之後，這裡會說它用了哪些牌、哪些沒抽到、為什麼。"))
      );
      return;
    }
    const groups = new Map();
    for (const c of s.cards || []) {
      if (!groups.has(c.section)) groups.set(c.section, []);
      groups.get(c.section).push(c);
    }
    const counts = { pin: 0, linked: 0, random: 0 };
    for (const c of s.cards || []) counts[c.from === "pin" ? "pin" : c.from === "random" ? "random" : "linked"]++;

    const actions = [];
    if (s.status === "drawn" || s.status === "failed" || s.status === "cancelled") actions.push(h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => app.act.print(s) }, s.status === "drawn" ? "印這張" : "再試一次"));
    if (s.status === "done") actions.push(h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => app.act.reprint(s) }, icon("redo", 14), "同提示再印"));
    actions.push(
      h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => app.act.useShot(s) }, icon("layers", 14), "這組牌放回配方"),
      h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => app.act.remove(s) }, icon("trash", 14), "撤下")
    );

    fill(
      root,
      h(
        "div",
        { class: "dt-head" },
        h("span", { class: "cv-status", dataset: { status: s.status } }, STATUS_ZH[s.status] || s.status),
        h("span", { class: "muted" }, [s.eraLabel, `${s.width}×${s.height}`].filter(Boolean).join(" · ")),
        h(
          "button",
          { class: "chip chip-xs mono", type: "button", title: "複製種子", onclick: async () => toast((await copyText(String(s.seed))) ? "種子複製好了" : "複製不了", { key: "copy" }) },
          "seed " + s.seed
        )
      ),
      h("div", { class: "dt-actions" }, actions),
      h(
        "div",
        { class: "dt-legend" },
        h("span", { dataset: { from: "pin" } }, `釘選 ${counts.pin}`),
        h("span", { dataset: { from: "linked" } }, `跟著來 ${counts.linked}`),
        h("span", { dataset: { from: "random" } }, `引擎抽 ${counts.random}`)
      ),
      [...groups].map(([sec, list]) => h("section", { class: "dt-sec" }, h("h3", { class: "dt-sec-title" }, SECTION_ZH[sec] || sec), h("div", { class: "dt-cards" }, list.map(cardChip)))),
      s.missing && s.missing.length
        ? h("div", { class: "dt-warn" }, h("b", {}, "放了但沒抽到："), s.missing.map((m) => `「${m.zh}」`).join(""), h("p", { class: "muted" }, "通常是跟別的牌互斥、或這次的時代、分級用不了。"))
        : null,
      s.removed && s.removed.length
        ? h("details", { class: "dt-removed" }, h("summary", {}, `引擎拿掉的牌（${s.removed.length}）`), h("ul", {}, s.removed.slice(0, 40).map((r) => h("li", {}, r))))
        : null,
      h(
        "section",
        { class: "dt-sec" },
        h(
          "div",
          { class: "dt-sec-row" },
          h("h3", { class: "dt-sec-title" }, "提示詞"),
          h("button", { class: "link-btn", type: "button", onclick: async () => toast((await copyText(s.positive)) ? "提示詞複製好了" : "複製不了", { key: "copy" }) }, icon("copy", 13), "複製")
        ),
        h("pre", { class: "dt-prompt" }, s.positive)
      ),
      s.ckpt || (s.loras && s.loras.length)
        ? h("p", { class: "muted dt-models" }, [s.ckpt ? "底模 " + String(s.ckpt).split(/[\\/]/).pop() : "", ...(s.loras || []).map((l) => `LoRA ${String(l.file).replace(/\.safetensors$/i, "")} ${l.strength}`)].filter(Boolean).join(" · "))
        : null
    );
  }

  app.on("select", render);
  app.on("shots", (s) => {
    // 進度一直跳，只有選中的那張換狀態才重畫。
    const cur = app.selected();
    if (!cur) return root.dataset.id && render();
    if (s && s.id !== cur.id) return;
    if (root.dataset.status !== cur.status || root.dataset.id !== cur.id) render();
  });
  render();
  return { render };
}
