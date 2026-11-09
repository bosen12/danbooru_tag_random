/**
 * 底模、LoRA：跟伺服器要清單（/api/checkpoints、/api/loras），記住選了什麼（mochi8.models.v1），
 * 生圖時給 payload（跟墨池 lora.js 的 currentLorasPayload 同樣的欄位），抽牌時給觸發詞。
 * 觸發詞預設是 LoRA 的第一個 trainedWords（跟墨池、MCP 一樣），可以自己改。
 */
import { h, icon, popover, closePopover, debounce } from "./w8-dom.js";
import { loadModels, saveModels } from "./w8-state.js";

const MAX_LORAS = 6;

export function createModels(onChange) {
  const sel = loadModels();
  let ckpts = null; // { items, current }
  let loras = null; // [{ folder, file, title, trainedWords, preview }]
  let lorasErr = "";

  const changed = () => {
    saveModels(sel);
    onChange?.();
  };

  async function fetchCkpts() {
    try {
      const r = await fetch("/api/checkpoints").then((x) => x.json());
      ckpts = { items: Array.isArray(r.items) ? r.items.map((x) => (typeof x === "string" ? x : x.name || x.file || "")).filter(Boolean) : [], current: r.current || "" };
    } catch {
      ckpts = { items: [], current: "" };
    }
    return ckpts;
  }
  async function fetchLoras() {
    try {
      const r = await fetch("/api/loras").then((x) => x.json());
      loras = Array.isArray(r.items) ? r.items : [];
      lorasErr = r.error || "";
    } catch (e) {
      loras = [];
      lorasErr = String(e.message || e);
    }
    return loras;
  }

  const shortName = (path) => String(path || "").split(/[\\/]/).pop().replace(/\.(safetensors|ckpt|pt)$/i, "");

  /** 生圖要送的 LoRA（強度 0 的不送）。 */
  function payload() {
    return sel.loras
      .filter((l) => l.strength > 0)
      .map((l, i) => ({ folder: l.folder || "", file: l.file, strength: l.strength, trigger: l.trigger || "", order: i }));
  }
  /** 抽牌時插在人數後面的觸發詞（跟墨池一樣；重複的只留一次）。 */
  function trigger() {
    const seen = new Set();
    const out = [];
    for (const l of sel.loras) {
      if (!(l.strength > 0)) continue;
      for (const part of String(l.trigger || "").split(",").map((s) => s.trim()).filter(Boolean)) {
        const k = part.toLowerCase();
        if (!seen.has(k)) {
          seen.add(k);
          out.push(part);
        }
      }
    }
    return out.join(", ");
  }
  const ckpt = () => sel.ckpt || "";

  function addLora(it) {
    if (sel.loras.some((l) => l.file === it.file && (l.folder || "") === (it.folder || ""))) return;
    if (sel.loras.length >= MAX_LORAS) return;
    const words = Array.isArray(it.trainedWords) ? it.trainedWords : [];
    sel.loras.push({ folder: it.folder || "", file: it.file, title: it.title || shortName(it.file), strength: 0.8, trigger: words[0] || "", words: words.slice(0, 12) });
    changed();
  }

  /** 檢視欄「模型」那一段。 */
  function render(root) {
    root.replaceChildren();
    const ckSel = h("select", { class: "select", id: "w8-ckpt", "aria-label": "底模" }, h("option", { value: "" }, "伺服器預設"));
    const fillCk = () => {
      ckSel.replaceChildren(h("option", { value: "" }, ckpts && ckpts.current ? `伺服器預設（${shortName(ckpts.current)}）` : "伺服器預設"));
      for (const it of (ckpts && ckpts.items) || []) ckSel.append(h("option", { value: it }, shortName(it)));
      if (sel.ckpt && !(ckpts?.items || []).includes(sel.ckpt)) ckSel.append(h("option", { value: sel.ckpt }, shortName(sel.ckpt) + "（找不到）"));
      ckSel.value = sel.ckpt;
    };
    fillCk();
    if (!ckpts) fetchCkpts().then(fillCk);
    ckSel.onchange = () => {
      sel.ckpt = ckSel.value;
      changed();
    };

    const list = h("div", { class: "lora-list" });
    const paint = () => {
      list.replaceChildren(
        ...sel.loras.map((l, i) => {
          const val = h("output", { class: "lora-val" }, l.strength.toFixed(2));
          const range = h("input", {
            type: "range",
            min: "0",
            max: "1.5",
            step: "0.05",
            value: String(l.strength),
            "aria-label": `${l.title} 強度`,
            oninput: (e) => {
              l.strength = Number(e.target.value);
              val.textContent = l.strength.toFixed(2);
            },
            onchange: changed,
          });
          const trig = h("input", {
            class: "input input-sm",
            value: l.trigger || "",
            placeholder: "觸發詞（沒有就空著）",
            "aria-label": `${l.title} 觸發詞`,
            onchange: (e) => {
              l.trigger = e.target.value.trim();
              changed();
            },
          });
          const words = (l.words || []).filter((w) => w !== l.trigger).slice(0, 4);
          return h(
            "div",
            { class: "lora" + (l.strength > 0 ? "" : " is-off") },
            h(
              "div",
              { class: "lora-head" },
              h("span", { class: "lora-name", title: l.file }, l.title),
              h("button", { class: "icon-btn icon-btn-sm", type: "button", "aria-label": `拿掉 ${l.title}`, onclick: () => (sel.loras.splice(i, 1), changed(), paint()) }, icon("x", 14))
            ),
            h("div", { class: "lora-strength" }, range, val),
            trig,
            words.length
              ? h(
                  "div",
                  { class: "lora-words" },
                  words.map((w) => h("button", { class: "chip chip-xs", type: "button", onclick: () => ((l.trigger = w), changed(), paint()) }, w))
                )
              : null
          );
        })
      );
    };
    paint();

    const addBtn = h("button", { class: "btn btn-ghost btn-sm", type: "button", disabled: sel.loras.length >= MAX_LORAS }, icon("plus", 14), "加 LoRA");
    addBtn.onclick = async () => {
      const q = h("input", { class: "input", placeholder: "找 LoRA：檔名、標題、資料夾", "aria-label": "找 LoRA" });
      const box = h("div", { class: "pick-list" }, h("p", { class: "muted pad" }, "讀清單中…"));
      const fill = () => {
        const term = q.value.trim().toLowerCase();
        const items = (loras || []).filter((it) => !term || `${it.title} ${it.file} ${it.folder}`.toLowerCase().includes(term)).slice(0, 80);
        if (!items.length) {
          box.replaceChildren(h("p", { class: "muted pad" }, loras && loras.length ? "找不到" : lorasErr ? `讀不到 LoRA 清單：${lorasErr}` : "沒有 LoRA（在 ComfyUI 的 loras 資料夾放檔，或在墨池設定 LoRA 路徑）"));
          return;
        }
        box.replaceChildren(
          ...items.map((it) =>
            h(
              "button",
              {
                class: "pick-item",
                type: "button",
                onclick: () => {
                  addLora(it);
                  closePopover();
                  paint();
                  addBtn.disabled = sel.loras.length >= MAX_LORAS;
                },
              },
              h("span", { class: "pick-title" }, it.title || shortName(it.file)),
              h("span", { class: "pick-sub" }, [it.folder, (it.trainedWords || [])[0]].filter(Boolean).join(" · "))
            )
          )
        );
      };
      q.oninput = debounce(fill, 60);
      popover(addBtn, h("div", { class: "pick" }, q, box), { cls: "pop-pick" });
      q.focus();
      if (!loras) await fetchLoras();
      fill();
    };

    root.append(
      h("label", { class: "field" }, h("span", { class: "field-label" }, "底模"), ckSel),
      h("div", { class: "field field-col" }, h("div", { class: "field-row" }, h("span", { class: "field-label" }, "LoRA"), addBtn), list)
    );
  }

  return { render, payload, trigger, ckpt, get loras() { return sel.loras; } };
}
