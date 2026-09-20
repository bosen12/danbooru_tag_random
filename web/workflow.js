// Comfy URL + 使用者 API workflow profile。內建 7 節點圖仍是預設；匯入只 overlay。

import { lockScroll, unlockScroll } from "./scroll-lock.js";
import { invalidateModelLists } from "./lora.js";

const $ = (id) => document.getElementById(id);
const REDUCE_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;
const STORE = "yz-workflow";
const FIELDS = [
  { key: "positive", label: "Positive Prompt", required: true },
  { key: "negative", label: "Negative Prompt" },
  { key: "seed", label: "Seed" },
  { key: "checkpoint", label: "Checkpoint" },
];

let WORKFLOW_ID = "";
try {
  WORKFLOW_ID = localStorage.getItem(STORE) || "";
} catch {
  WORKFLOW_ID = "";
}

let profiles = [];
let current = null;
let comfyCfg = { api: "http://127.0.0.1:8188", fromEnv: false, saved: "" };
let models = { checkpoints: 0, loras: 0 };

export function currentWorkflowId() {
  return WORKFLOW_ID || "";
}

export function workflowUiOpen() {
  return $("wf-modal")?.classList.contains("open") && $("wf-modal")?.dataset.closing !== "1";
}

function saveId() {
  try {
    localStorage.setItem(STORE, WORKFLOW_ID || "");
  } catch {
    /* ignore */
  }
}

async function getJson(url, init) {
  const r = await fetch(url, init);
  let j = {};
  try {
    j = await r.json();
  } catch {
    j = {};
  }
  if (typeof j.ok !== "boolean") j.ok = r.ok;
  if (!j.ok && !j.error) j.error = r.statusText || "request failed";
  return j;
}

function say(text, kind) {
  const el = $("wf-msg");
  if (!el) return;
  el.textContent = text || "";
  el.dataset.kind = kind || "";
}

function ensureDom() {
  if ($("wf-modal")) return;
  const tools = $("mast-tools");
  if (tools && !$("wf-pick-btn")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost";
    btn.id = "wf-pick-btn";
    btn.title = "ComfyUI 與 workflow";
    btn.setAttribute("aria-haspopup", "dialog");
    btn.innerHTML = `<span class="gen-pick-label">工作流</span>`;
    const ckpt = $("ckpt-pick-btn");
    if (ckpt && ckpt.nextSibling) tools.insertBefore(btn, ckpt.nextSibling);
    else if (ckpt) ckpt.after(btn);
    else {
      const ping = $("ping");
      if (ping && ping.parentNode === tools) tools.insertBefore(btn, ping);
      else tools.appendChild(btn);
    }
  }
  const wrap = document.createElement("div");
  wrap.className = "wf-modal";
  wrap.id = "wf-modal";
  wrap.innerHTML = `
    <div class="wf-inner" role="dialog" aria-modal="true" aria-labelledby="wf-title">
      <header class="wf-head">
        <div>
          <h2 id="wf-title">ComfyUI 與 workflow</h2>
          <p class="wf-state" id="wf-state">讀取中…</p>
        </div>
        <button type="button" class="ghost wf-close" id="wf-close" aria-label="關閉">✕</button>
      </header>
      <div class="wf-body">
        <label class="wf-field">
          <span>ComfyUI 網址</span>
          <input id="wf-url" type="url" autocomplete="off" spellcheck="false" placeholder="http://127.0.0.1:8188" />
          <em id="wf-url-hint">預設本機 8188。區網 GPU 填 http://192.168.x.x:8188。不必填安裝路徑。</em>
        </label>
        <div class="wf-actions">
          <button type="button" class="primary" id="wf-url-save"><span>存網址</span></button>
          <button type="button" class="ghost" id="wf-refresh">重新整理清單</button>
        </div>
        <p class="wf-counts" id="wf-counts"></p>
        <label class="wf-field">
          <span>Workflow</span>
          <select id="wf-select"></select>
          <em>沒選就是內建 Illustrious 流程。匯入的 JSON 只改你 mapping 的欄位。</em>
        </label>
        <div class="wf-actions">
          <button type="button" class="ghost" id="wf-import">匯入 JSON</button>
          <button type="button" class="ghost" id="wf-delete">刪除</button>
          <input id="wf-file" type="file" accept="application/json,.json" hidden />
        </div>
        <div class="wf-drop" id="wf-drop" tabindex="0">
          把 ComfyUI API workflow JSON 拖進來，或點「匯入 JSON」。
        </div>
        <div id="wf-map"></div>
        <p class="wf-msg" id="wf-msg" role="status"></p>
      </div>
    </div>`;
  document.body.append(wrap);
}

function renderSelect() {
  const sel = $("wf-select");
  if (!sel) return;
  const keep = WORKFLOW_ID;
  sel.replaceChildren();
  const builtin = document.createElement("option");
  builtin.value = "";
  builtin.textContent = "內建（目前這套）";
  sel.append(builtin);
  for (const p of profiles) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name || p.id;
    sel.append(opt);
  }
  if (keep && !profiles.some((p) => p.id === keep)) {
    WORKFLOW_ID = "";
    saveId();
  }
  sel.value = WORKFLOW_ID || "";
  renderPickBtn();
  $("wf-delete").disabled = !WORKFLOW_ID;
}

function renderPickBtn() {
  const btn = $("wf-pick-btn");
  if (!btn) return;
  const label = btn.querySelector(".gen-pick-label");
  const p = profiles.find((x) => x.id === WORKFLOW_ID);
  if (label) label.textContent = p ? p.name : "工作流";
  btn.classList.toggle("has", !!WORKFLOW_ID);
}

function widgetInputs(node) {
  return (node?.inputs || []).filter((i) => i.kind === "widget");
}

function fieldSpec(mapping, key) {
  const spec = (mapping || {})[key] || {};
  return {
    node: String(spec.node || ""),
    input: String(spec.input || ""),
    mode: spec.mode || (key === "positive" ? "control" : "keep"),
  };
}

function collectMapping() {
  if (!current) return {};
  const mapping = {};
  for (const field of FIELDS) {
    const node = $("wf-node-" + field.key)?.value || "";
    const input = $("wf-input-" + field.key)?.value || "";
    const mode = field.required ? "control" : $("wf-mode-" + field.key)?.dataset.mode || "keep";
    if (!node || !input) continue;
    mapping[field.key] = { node, input, mode };
  }
  const loras = [];
  for (const node of current.nodes || []) {
    if (node.class_type !== "LoraLoader") continue;
    const mode = $("wf-lora-mode-" + node.id)?.dataset.mode || "keep";
    const inputEl = $("wf-lora-input-" + node.id);
    const input = inputEl?.value || "lora_name";
    loras.push({ node: node.id, input, strengthInput: "strength_model", mode });
  }
  if (loras.length) mapping.loras = loras;
  return mapping;
}

function modeToggle(id, mode, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "wf-mode";
  wrap.id = id;
  wrap.dataset.mode = mode;
  for (const [val, label] of [
    ["keep", "Keep workflow value"],
    ["control", "由排字匣控制"],
  ]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ghost wf-mode-btn" + (mode === val ? " on" : "");
    b.textContent = label;
    b.addEventListener("click", () => {
      wrap.dataset.mode = val;
      wrap.querySelectorAll(".wf-mode-btn").forEach((x) => x.classList.toggle("on", x === b));
      if (onChange) onChange();
    });
    wrap.append(b);
  }
  return wrap;
}

function fillInputSelect(sel, nodeId, preferred) {
  sel.replaceChildren();
  const node = (current?.nodes || []).find((n) => n.id === nodeId);
  const widgets = widgetInputs(node);
  if (!widgets.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = nodeId ? "這個節點沒有可寫入的欄位" : "先選節點";
    sel.append(opt);
    return;
  }
  for (const w of widgets) {
    const opt = document.createElement("option");
    opt.value = w.name;
    opt.textContent = w.name;
    sel.append(opt);
  }
  sel.value = widgets.some((w) => w.name === preferred) ? preferred : widgets[0].name;
}

function renderMapping() {
  const box = $("wf-map");
  if (!box) return;
  box.replaceChildren();
  if (!WORKFLOW_ID || !current) {
    const p = document.createElement("p");
    p.className = "wf-hint";
    p.textContent = "使用內建 workflow：Positive / Negative / Seed / Checkpoint / LoRA 都由排字匣組裝。";
    box.append(p);
    return;
  }
  if (!current.ready) {
    const warn = document.createElement("p");
    warn.className = "wf-warn";
    warn.textContent = "還不能生圖：請指定 Positive Prompt 要寫進哪個節點。";
    box.append(warn);
  }
  for (const field of FIELDS) {
    const spec = fieldSpec(current.mapping, field.key);
    const row = document.createElement("fieldset");
    row.className = "wf-map-row";
    const legend = document.createElement("legend");
    legend.textContent = field.label + (field.required ? "（必填）" : "");
    row.append(legend);
    const nodeSel = document.createElement("select");
    nodeSel.id = "wf-node-" + field.key;
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "（未指定）";
    nodeSel.append(blank);
    for (const n of current.nodes || []) {
      const opt = document.createElement("option");
      opt.value = n.id;
      opt.textContent = `#${n.id} ${n.title || n.class_type}`;
      nodeSel.append(opt);
    }
    nodeSel.value = spec.node;
    const inputSel = document.createElement("select");
    inputSel.id = "wf-input-" + field.key;
    fillInputSelect(inputSel, spec.node, spec.input);
    nodeSel.addEventListener("change", () => fillInputSelect(inputSel, nodeSel.value, spec.input));
    row.append(nodeSel, inputSel);
    if (!field.required) {
      const tog = modeToggle("wf-mode-" + field.key, spec.mode);
      row.append(tog);
    }
    box.append(row);
  }
  const loraNodes = (current.nodes || []).filter((n) => n.class_type === "LoraLoader");
  if (loraNodes.length) {
    const h = document.createElement("h3");
    h.className = "wf-sub";
    h.textContent = "LoRA";
    box.append(h);
    const mapped = Array.isArray(current.mapping?.loras) ? current.mapping.loras : [];
    for (const n of loraNodes) {
      const spec = mapped.find((x) => String(x.node) === n.id) || { mode: "keep", input: "lora_name" };
      const row = document.createElement("fieldset");
      row.className = "wf-map-row";
      const legend = document.createElement("legend");
      legend.textContent = `#${n.id} ${n.title || "LoraLoader"}`;
      const inputSel = document.createElement("select");
      inputSel.id = "wf-lora-input-" + n.id;
      fillInputSelect(inputSel, n.id, spec.input || "lora_name");
      row.append(legend, inputSel, modeToggle("wf-lora-mode-" + n.id, spec.mode || "keep"));
      box.append(row);
    }
  }
  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.id = "wf-map-save";
  save.innerHTML = "<span>存 mapping</span>";
  save.addEventListener("click", saveMapping);
  box.append(save);
}

async function saveMapping() {
  if (!WORKFLOW_ID) return;
  const mapping = collectMapping();
  const j = await getJson("/api/workflows/" + encodeURIComponent(WORKFLOW_ID), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapping }),
  });
  if (!j.ok) {
    say(j.error || "mapping 存檔失敗", "err");
    return;
  }
  current = j;
  renderMapping();
  say(j.ready ? "mapping 已存，可以生圖。" : "已存，但還需要指定 Positive Prompt 節點。", j.ready ? "" : "err");
}

async function loadCurrent() {
  current = null;
  if (!WORKFLOW_ID) {
    renderMapping();
    return;
  }
  const j = await getJson("/api/workflows/" + encodeURIComponent(WORKFLOW_ID));
  if (!j.ok) {
    WORKFLOW_ID = "";
    saveId();
    renderSelect();
    renderMapping();
    say(j.error || "這個 profile 讀不到，已改回內建。", "err");
    return;
  }
  current = j;
  renderMapping();
}

async function refreshList() {
  const j = await getJson("/api/workflows");
  profiles = j.items || [];
  renderSelect();
  await loadCurrent();
}

async function refreshComfy() {
  const cfg = await getJson("/api/comfy");
  if (cfg && cfg.api) comfyCfg = cfg;
  const url = $("wf-url");
  if (url && document.activeElement !== url) url.value = comfyCfg.saved || comfyCfg.api || "";
  const hint = $("wf-url-hint");
  if (hint) {
    hint.dataset.pending = comfyCfg.fromEnv ? "1" : "0";
    hint.textContent = comfyCfg.fromEnv
      ? "目前被環境變數 COMFY_API 鎖定。畫面存的值下次沒設環境變數才會生效。"
      : "預設本機 8188。區網 GPU 填 http://192.168.x.x:8188。不必填安裝路徑。";
  }
  const ping = await getJson("/api/ping");
  const st = $("wf-state");
  if (st) {
    st.dataset.ok = ping.ok ? "1" : "0";
    st.textContent = ping.ok ? `Connected · ${ping.version || "ok"} · ${ping.base || comfyCfg.api}` : `Disconnected · ${ping.base || comfyCfg.api}`;
  }
  let ck = { count: 0 },
    lr = { count: 0 };
  if (ping.ok) {
    ck = await getJson("/api/models?kind=checkpoints");
    lr = await getJson("/api/models?kind=loras");
  }
  models = { checkpoints: ck.count || 0, loras: lr.count || 0 };
  invalidateModelLists();
  const counts = $("wf-counts");
  if (counts) {
    counts.textContent = ping.ok
      ? `Checkpoints: ${models.checkpoints}　LoRAs: ${models.loras}`
      : "Comfy 未連上時仍可抽 tag、複製 POS，但不能生圖。";
  }
}

async function saveUrl() {
  const api = $("wf-url")?.value || "";
  const j = await getJson("/api/comfy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api }),
  });
  if (!j.ok) {
    say(j.error || "網址無效", "err");
    return;
  }
  say(j.note || "已存 ComfyUI 網址。", j.note ? "err" : "");
  await refreshComfy();
}

async function importWorkflow(data, name) {
  const j = await getJson("/api/workflows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name || "Workflow", workflow: data }),
  });
  if (!j.ok) {
    say(j.error || "匯入失敗", "err");
    return;
  }
  WORKFLOW_ID = j.id;
  saveId();
  await refreshList();
  say(j.ready ? "已匯入。" : "已匯入。請指定 Positive Prompt 要寫進哪個節點。", j.ready ? "" : "err");
}

async function importFile(file) {
  let text;
  try {
    text = await file.text();
  } catch (e) {
    say("讀不到檔案：" + e.message, "err");
    return;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    say("不是有效的 JSON。", "err");
    return;
  }
  const name = String(file.name || "").replace(/\.json$/i, "") || "Workflow";
  await importWorkflow(data, name);
}

async function deleteCurrent() {
  if (!WORKFLOW_ID) return;
  if (!window.confirm("刪掉這個 workflow profile？內建流程不會受影響。")) return;
  const r = await fetch("/api/workflows/" + encodeURIComponent(WORKFLOW_ID), { method: "DELETE" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !j.ok) {
    say(j.error || "刪除失敗", "err");
    return;
  }
  WORKFLOW_ID = "";
  saveId();
  await refreshList();
  say("已刪除，改回內建 workflow。");
}

function openModal() {
  ensureDom();
  const el = $("wf-modal");
  el.classList.remove("is-closing");
  delete el.dataset.closing;
  el.inert = false;
  el.classList.add("open");
  lockScroll("wf-modal");
  say("");
  refreshComfy();
  refreshList();
  $("wf-url")?.focus();
}

function closeModal() {
  const el = $("wf-modal");
  if (!el || !el.classList.contains("open") || el.dataset.closing === "1") return;
  el.dataset.closing = "1";
  el.classList.add("is-closing");
  el.inert = true;
  window.setTimeout(
    () => {
      el.classList.remove("open", "is-closing");
      delete el.dataset.closing;
      unlockScroll("wf-modal");
    },
    REDUCE_MOTION ? 0 : 160
  );
}

function bindPing() {
  const ping = $("ping");
  if (!ping || ping.dataset.wfBound === "1") return;
  ping.dataset.wfBound = "1";
  ping.tabIndex = 0;
  ping.setAttribute("role", "button");
  ping.title = "ComfyUI 與 workflow 設定";
  ping.addEventListener("click", openModal);
  ping.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openModal();
    }
  });
}

function onDrop(e) {
  const file = [...(e.dataTransfer?.files || [])].find((f) => /\.json$/i.test(f.name) || f.type.includes("json"));
  if (!file) {
    say("請拖入 .json 檔。", "err");
    return;
  }
  importFile(file);
}

export function initWorkflow() {
  ensureDom();
  bindPing();
  renderPickBtn();
  $("wf-pick-btn")?.addEventListener("click", openModal);
  $("wf-close")?.addEventListener("click", closeModal);
  $("wf-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "wf-modal") closeModal();
  });
  $("wf-url-save")?.addEventListener("click", saveUrl);
  $("wf-refresh")?.addEventListener("click", () => {
    refreshComfy();
    refreshList();
  });
  $("wf-select")?.addEventListener("change", () => {
    WORKFLOW_ID = $("wf-select").value || "";
    saveId();
    renderPickBtn();
    $("wf-delete").disabled = !WORKFLOW_ID;
    loadCurrent();
  });
  $("wf-import")?.addEventListener("click", () => $("wf-file")?.click());
  $("wf-file")?.addEventListener("change", () => {
    const file = $("wf-file").files?.[0];
    $("wf-file").value = "";
    if (file) importFile(file);
  });
  $("wf-delete")?.addEventListener("click", deleteCurrent);
  const drop = $("wf-drop");
  drop?.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.dataset.over = "1";
  });
  drop?.addEventListener("dragleave", () => {
    delete drop.dataset.over;
  });
  drop?.addEventListener("drop", (e) => {
    e.preventDefault();
    delete drop.dataset.over;
    onDrop(e);
  });
  document.addEventListener("keydown", (e) => {
    if (!workflowUiOpen()) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
    }
  });
  refreshList().catch(() => {});
}

export function wfHandleKeys(e) {
  if (!workflowUiOpen()) return false;
  if (e.key === "Escape") {
    e.preventDefault();
    closeModal();
    return true;
  }
  return true;
}
