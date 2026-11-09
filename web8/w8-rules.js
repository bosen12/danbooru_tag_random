/**
 * 檢視欄的「規則」：尺度、人物、時代、尺寸、每段張數、場景、進階開關、模型。
 * 每個改動都走 mobile-bridge.js 的 configure（跟墨池同一套：分級擋掉的尺度不能按、骨架跟著張數熄亮）。
 */
import * as B from "./mobile-bridge.js";
import { h, $, icon } from "./w8-dom.js";

const TOGGLES = [
  ["samePerson", "同一個人", "一次抽好幾張時，長相照第一張"],
  ["drawCharacter", "抽角色", "引擎會抽作品裡的角色"],
  ["drawJob", "抽職業", "引擎會抽職業"],
  ["pinCompanions", "放牌時帶附帶的牌", "例如放「泳池」會一起帶「泳裝」"],
  ["pinMutex", "放牌時換掉互斥的", "同一格只留一張；關掉就兩張都留"],
];

export function mountRules(app, models) {
  const root = $("#rules");
  const body = h("div", { class: "rules-body" });
  const modelBox = h("div", { class: "rules-models" });
  root.replaceChildren(body, h("section", { class: "rs" }, h("h3", { class: "rs-title" }, "模型"), modelBox));
  models.render(modelBox);

  const seg = (items, cur, on, label) =>
    h(
      "div",
      { class: "seg", role: "radiogroup", "aria-label": label },
      items.map((it) =>
        h(
          "button",
          { class: "seg-btn", type: "button", role: "radio", "aria-checked": String(it.id === cur), disabled: !!it.blocked, title: it.why || "", onclick: () => on(it.id) },
          it.icon || null,
          it.label
        )
      )
    );

  const sizeIcon = (w, hgt) => {
    const k = 14 / Math.max(w, hgt);
    return h("span", { class: "size-ico", style: { width: Math.round(w * k) + "px", height: Math.round(hgt * k) + "px" } });
  };

  function render() {
    const r = B.rules(app.core);
    const s = app.core.settings || {};
    const size = app.meta.sizes.find((x) => x.width === r.width && x.height === r.height)?.id || "";
    body.replaceChildren(
      h(
        "section",
        { class: "rs" },
        h("h3", { class: "rs-title" }, "尺度", h("span", { class: "rs-hint" }, "可以複選；分級擋掉的按不了")),
        h(
          "div",
          { class: "heat-row" },
          r.heats.map((x) =>
            h(
              "button",
              { class: "chip chip-heat", type: "button", "aria-pressed": String(x.on), disabled: x.blocked, title: x.why, dataset: { heat: x.id }, onclick: () => app.act.configure({ heat: x.id }) },
              x.label
            )
          )
        )
      ),
      h(
        "section",
        { class: "rs rs-grid" },
        h("span", { class: "field-label" }, "人物"),
        seg(app.meta.who, r.who, (id) => app.act.configure({ who: id }), "人物"),
        h("span", { class: "field-label" }, "時代"),
        h(
          "select",
          { class: "select", "aria-label": "時代", onchange: (e) => app.act.configure({ era: e.target.value }) },
          app.meta.eraChoices.map((e) => h("option", { value: e.id, selected: e.id === r.era }, e.label))
        ),
        h("span", { class: "field-label" }, "尺寸"),
        seg(
          app.meta.sizes.map((x) => ({ ...x, label: x.label.split(" ")[0], icon: sizeIcon(x.width, x.height) })),
          size,
          (id) => app.act.configure({ size: id }),
          "尺寸"
        ),
        h("span", { class: "field-label" }, "場景"),
        seg(app.meta.sceneModes, r.sceneMode, (id) => app.act.configure({ sceneMode: id }), "場景")
      ),
      h(
        "section",
        { class: "rs" },
        h("h3", { class: "rs-title" }, "每段張數", h("span", { class: "rs-hint" }, "引擎在每一段最多抽幾張（配方裡的另算）")),
        h(
          "div",
          { class: "counts" },
          app.meta.counts.map((c) => {
            const n = Number((r.counts || {})[c.id] ?? 0);
            return h(
              "div",
              { class: "count" },
              h("span", { class: "count-label" }, c.label),
              h(
                "div",
                { class: "stepper" },
                h("button", { class: "step-btn", type: "button", "aria-label": `${c.label}少一張`, disabled: n <= 0, onclick: () => app.act.configure({ count: [c.id, n - 1] }) }, icon("minus", 14)),
                h("output", { class: "step-n" }, n),
                h("button", { class: "step-btn", type: "button", "aria-label": `${c.label}多一張`, disabled: n >= c.max, onclick: () => app.act.configure({ count: [c.id, n + 1] }) }, icon("plus", 14))
              )
            );
          })
        )
      ),
      h(
        "details",
        { class: "rs rs-more", open: app.ui.moreOpen || undefined, ontoggle: (e) => (app.ui.moreOpen = e.target.open) },
        h("summary", { class: "rs-title" }, "進階"),
        h(
          "div",
          { class: "toggles" },
          TOGGLES.map(([key, label, hint]) =>
            h(
              "label",
              { class: "toggle" },
              h("input", { type: "checkbox", checked: s[key] === true || (s[key] !== false && (key === "pinCompanions" || key === "pinMutex")), onchange: (e) => app.act.configure({ [key]: e.target.checked }) }),
              h("span", { class: "toggle-ui", "aria-hidden": "true" }),
              h("span", { class: "toggle-text" }, label, h("small", {}, hint))
            )
          )
        )
      )
    );
  }

  app.on("settings", render);
  render();
}
