// 工作流彈窗：跟選 LoRA / 底模同一套置中 overlay。

import { lockScroll, unlockScroll } from "./scroll-lock.js";
import { invalidateModelLists } from "./lora.js";

const $ = (id) => document.getElementById(id);
const REDUCE_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;
const STORE = "yz-workflow";
const ICON_CLOSE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

let WORKFLOW_ID = "";
try {
  WORKFLOW_ID = localStorage.getItem(STORE) || "";
} catch {
  WORKFLOW_ID = "";
}

let profiles = [];
let current = null;
let lastFocus = null;

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

function previewLine(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "（空）";
  return t.length > 96 ? t.slice(0, 95) + "…" : t;
}

function ensureDom() {
  const tools = $("mast-tools");
  if (tools && !$("wf-pick-btn")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost";
    btn.id = "wf-pick-btn";
    btn.title = "工作流";
    btn.setAttribute("aria-haspopup", "dialog");
    btn.innerHTML = `<span class="gen-pick-label">工作流</span>`;
    const ckpt = $("ckpt-pick-btn");
    if (ckpt) ckpt.after(btn);
    else {
      const ping = $("ping");
      if (ping && ping.parentNode === tools) tools.insertBefore(btn, ping);
      else tools.appendChild(btn);
    }
  }
  if ($("wf-modal")) return;
  const modal = document.createElement("div");
  modal.id = "wf-modal";
  modal.className = "lora-modal wf-modal";
  modal.inert = true;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "wf-head-title");
  modal.innerHTML = `
    <div class="lora-modal-inner">
      <button class="lora-modal-close" id="wf-close" aria-label="關閉 (Esc)" title="關閉 (Esc)">${ICON_CLOSE}</button>
      <div class="lm-left">
        <div class="ckpt-head">
          <div class="ckpt-head-title" id="wf-head-title">工作流</div>
          <p class="ckpt-head-hint">沒選就是內建。要自己的圖，匯入 ComfyUI「匯出工作流 (API)」的 JSON。</p>
        </div>
        <div id="wf-list" class="lm-list"></div>
        <button type="button" class="wf-drop" id="wf-drop">匯入 API JSON…<br>拖進來或點這裡選檔</button>
        <input id="wf-file" type="file" accept="application/json,.json" hidden />
      </div>
      <div class="lm-right">
        <div class="lm-right-head">目前選擇</div>
        <div class="wf-url-row">
          <input id="wf-url" type="url" autocomplete="off" spellcheck="false" aria-label="ComfyUI 網址" placeholder="http://127.0.0.1:8188" />
          <button type="button" class="ghost" id="wf-url-save">存位址</button>
        </div>
        <div id="wf-current" class="lm-current"></div>
        <p class="wf-msg" id="wf-msg" role="status"></p>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function renderPickBtn() {
  const btn = $("wf-pick-btn");
  if (!btn) return;
  const lab = btn.querySelector(".gen-pick-label");
  const p = profiles.find((x) => x.id === WORKFLOW_ID);
  if (lab) lab.textContent = p ? p.name : "工作流";
  btn.classList.toggle("has", !!WORKFLOW_ID);
  btn.title = p ? `工作流：${p.name}` : "工作流：內建";
  btn.setAttribute("aria-expanded", workflowUiOpen() ? "true" : "false");
}

function renderList() {
  const box = $("wf-list");
  if (!box) return;
  box.replaceChildren();
  const add = (id, title, sub) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "lora-row" + ((id || "") === (WORKFLOW_ID || "") ? " on" : "");
    if ((id || "") === (WORKFLOW_ID || "")) row.setAttribute("aria-current", "true");
    const ph = document.createElement("span");
    ph.className = "ph";
    const rn = document.createElement("span");
    rn.className = "rn";
    const rt = document.createElement("span");
    rt.className = "rt";
    rt.textContent = title;
    const rf = document.createElement("span");
    rf.className = "rf";
    rf.textContent = sub;
    rn.append(rt, rf);
    row.append(ph, rn);
    row.addEventListener("click", () => selectWorkflow(id));
    box.append(row);
  };
  add("", "內建", "排字匣那套 Illustrious 流程");
  for (const p of profiles) add(p.id, p.name || p.id, "匯入的 API workflow");
  if (WORKFLOW_ID && !profiles.some((p) => p.id === WORKFLOW_ID)) {
    WORKFLOW_ID = "";
    saveId();
  }
  renderPickBtn();
}

async function selectWorkflow(id) {
  WORKFLOW_ID = id || "";
  saveId();
  renderList();
  await loadCurrent();
}

function pickedNode(field) {
  const mapped = current?.mapping?.[field] || {};
  if (mapped.mode === "keep") return "";
  if (mapped.node) return String(mapped.node);
  const sug = current?.suggested?.[field] || {};
  if (sug.mode === "keep") return "";
  return String(sug.node || "");
}

function pickedLoraIds() {
  const specs = Array.isArray(current?.mapping?.loras) ? current.mapping.loras : current?.suggested?.loras;
  if (!Array.isArray(specs)) return [];
  return specs.filter((s) => s && s.mode === "control" && s.node).map((s) => String(s.node));
}

function heading(text) {
  const el = document.createElement("div");
  el.className = "wf-sec";
  el.textContent = text;
  return el;
}

function nodeButton(item, on, onClick, badge) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "wf-prompt" + (on ? " on" : "");
  const wrap = document.createElement("span");
  const strong = document.createElement("strong");
  strong.textContent = `${item.title || item.class_type || "節點"} · #${item.id}${badge ? " · " + badge : ""}`;
  const em = document.createElement("em");
  em.textContent = previewLine(item.preview);
  wrap.append(strong, em);
  b.append(wrap);
  b.addEventListener("click", onClick);
  return b;
}

function keepButton(on, label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "wf-prompt" + (on ? " on" : "");
  const strong = document.createElement("strong");
  strong.textContent = label;
  b.append(strong);
  b.addEventListener("click", onClick);
  return b;
}

function renderCurrent() {
  const box = $("wf-current");
  if (!box) return;
  box.replaceChildren();
  if (!WORKFLOW_ID) {
    const t = document.createElement("div");
    t.className = "lm-cur-title";
    t.textContent = "內建";
    const h = document.createElement("p");
    h.className = "ckpt-cur-hint";
    h.textContent = "正向、負向、LoRA 都由排字匣組裝。";
    box.append(t, h);
    return;
  }
  if (!current) {
    const h = document.createElement("p");
    h.className = "ckpt-cur-hint";
    h.textContent = "讀取中…";
    box.append(h);
    return;
  }
  const t = document.createElement("div");
  t.className = "lm-cur-title";
  t.textContent = current.name || WORKFLOW_ID;
  const h = document.createElement("p");
  h.className = "ckpt-cur-hint";
  h.textContent = current.ready ? "下面三欄決定排字匣要改哪些節點。沒選的會保留 workflow 原值。" : "至少選一個正向節點才能生圖。";
  box.append(t, h);

  const prompts = current.prompts || [];
  const sugPos = String(current.suggested?.positive?.node || "");
  const sugNeg = String(current.suggested?.negative?.node || "");
  const posId = pickedNode("positive");
  box.append(heading("正向"));
  for (const item of prompts) {
    box.append(nodeButton(item, item.id === posId, () => savePrompt("positive", item), item.id === sugPos ? "建議" : ""));
  }

  const negId = pickedNode("negative");
  box.append(heading("負向"));
  box.append(keepButton(!negId, "不改，保留 workflow 原值", () => savePrompt("negative", null)));
  for (const item of prompts) {
    box.append(nodeButton(item, item.id === negId, () => savePrompt("negative", item), item.id === sugNeg ? "建議" : ""));
  }

  const loras = current.loraNodes || [];
  const loraOn = new Set(pickedLoraIds());
  box.append(heading("LoRA"));
  if (!loras.length) {
    const none = document.createElement("p");
    none.className = "ckpt-cur-hint";
    none.textContent = "這張圖沒有 LoRA 節點。";
    box.append(none);
  } else {
    box.append(keepButton(loraOn.size === 0, "不改，保留 workflow 裡的 LoRA", () => saveLoras([])));
    for (const item of loras) {
      box.append(
        nodeButton(item, loraOn.has(item.id), () => {
          const next = new Set(loraOn);
          if (next.has(item.id)) next.delete(item.id);
          else if (next.size >= 2) {
            say("最多對兩個 LoRA 節點，跟排字匣槽數一樣。", "err");
            return;
          } else next.add(item.id);
          saveLoras([...next], loras);
        })
      );
    }
  }

  const del = document.createElement("button");
  del.type = "button";
  del.className = "ghost wf-del";
  del.textContent = "刪掉這套";
  del.addEventListener("click", deleteCurrent);
  box.append(del);
}

function baseMapping() {
  return { ...(current?.suggested || {}), ...(current?.mapping || {}) };
}

async function putMapping(mapping, note) {
  if (!WORKFLOW_ID) return;
  const j = await getJson("/api/workflows/" + encodeURIComponent(WORKFLOW_ID), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapping }),
  });
  if (!j.ok) {
    say(j.error || "存不起來", "err");
    return;
  }
  current = j;
  renderCurrent();
  if (note) say(note, "err");
  else say(j.ready ? "已存。" : "還要選正向節點。", j.ready ? "" : "err");
}

async function savePrompt(field, item) {
  const mapping = baseMapping();
  let note = "";
  if (!item) {
    if (mapping[field]) mapping[field] = { ...mapping[field], mode: "keep" };
    else delete mapping[field];
  } else {
    mapping[field] = { node: item.id, input: item.input || "text", mode: "control" };
    const other = field === "positive" ? "negative" : "positive";
    if (mapping[other] && String(mapping[other].node) === String(item.id) && mapping[other].mode === "control") {
      mapping[other] = { ...mapping[other], mode: "keep" };
      note = "正向／負向不能是同一個節點，另一邊改成不改。";
    }
  }
  await putMapping(mapping, note);
}

async function saveLoras(ids, nodes) {
  const mapping = baseMapping();
  const byId = Object.fromEntries((nodes || current?.loraNodes || []).map((n) => [n.id, n]));
  mapping.loras = ids.map((id) => {
    const n = byId[id] || {};
    return {
      node: id,
      input: n.input || "lora_name",
      strengthInput: n.strengthInput || "strength_model",
      mode: "control",
    };
  });
  await putMapping(mapping);
}

async function loadCurrent() {
  current = null;
  if (!WORKFLOW_ID) {
    renderCurrent();
    return;
  }
  const j = await getJson("/api/workflows/" + encodeURIComponent(WORKFLOW_ID));
  if (!j.ok) {
    WORKFLOW_ID = "";
    saveId();
    current = null;
    renderList();
    renderCurrent();
    say(j.error || "讀不到，已改回內建。", "err");
    return;
  }
  current = j;
  renderCurrent();
  if (!j.ready) say("選右邊一個 CLIP 節點。", "err");
  else say("");
}

async function refreshList() {
  const j = await getJson("/api/workflows");
  profiles = j.items || [];
  renderList();
  await loadCurrent();
}

async function refreshComfy() {
  const j = await getJson("/api/comfy");
  if (!j.ok) {
    say(j.error || "讀不到 ComfyUI 設定", "err");
    return;
  }
  const input = $("wf-url");
  if (input && document.activeElement !== input) input.value = j.saved || j.api || "";
  if (j.note) say(j.note, "err");
}

async function saveComfy() {
  const j = await getJson("/api/comfy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api: $("wf-url")?.value || "" }),
  });
  if (!j.ok) {
    say(j.error || "ComfyUI 網址存不起來", "err");
    return;
  }
  invalidateModelLists();
  if ($("wf-url")) $("wf-url").value = j.saved || j.api || "";
  say(j.note || "ComfyUI 網址已儲存。", j.note ? "err" : "");
}

async function importWorkflow(data, name) {
  say("匯入中…");
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
  profiles = (await getJson("/api/workflows")).items || profiles;
  current = j;
  renderList();
  renderCurrent();
  say(j.ready ? `已匯入「${j.name}」。` : "已匯入。選 tags 要寫進哪個節點。", j.ready ? "" : "err");
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
  await importWorkflow(data, String(file.name || "").replace(/\.json$/i, "") || "Workflow");
}

async function deleteCurrent() {
  if (!WORKFLOW_ID) return;
  if (!window.confirm("刪掉這套自己匯入的 workflow？內建還在。")) return;
  const r = await fetch("/api/workflows/" + encodeURIComponent(WORKFLOW_ID), { method: "DELETE" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !j.ok) {
    say(j.error || "刪除失敗", "err");
    return;
  }
  WORKFLOW_ID = "";
  current = null;
  saveId();
  await refreshList();
  say("已刪除，改回內建。");
}

function openModal() {
  ensureDom();
  lastFocus = document.activeElement;
  const el = $("wf-modal");
  el._closeGen = (el._closeGen || 0) + 1;
  delete el.dataset.closing;
  el.classList.remove("is-closing");
  el.inert = false;
  el.classList.add("open");
  lockScroll("wf-modal");
  renderPickBtn();
  $("wf-close")?.focus();
  say("");
  Promise.all([refreshList(), refreshComfy()]).catch((e) => say(String(e.message || e), "err"));
}

function closeModal() {
  const el = $("wf-modal");
  if (!el || !el.classList.contains("open") || el.dataset.closing === "1") return;
  const gen = (el._closeGen = (el._closeGen || 0) + 1);
  el.dataset.closing = "1";
  el.classList.add("is-closing");
  el.inert = true;
  window.setTimeout(
    () => {
      if (el._closeGen !== gen) return;
      el.classList.remove("open", "is-closing");
      delete el.dataset.closing;
      unlockScroll("wf-modal");
      renderPickBtn();
      (lastFocus || $("wf-pick-btn"))?.focus?.();
    },
    REDUCE_MOTION ? 0 : 180
  );
}

export function initWorkflow() {
  ensureDom();
  renderPickBtn();
  $("wf-pick-btn")?.addEventListener("click", openModal);
  $("wf-close")?.addEventListener("click", closeModal);
  $("wf-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "wf-modal") closeModal();
  });
  $("wf-drop")?.addEventListener("click", () => $("wf-file")?.click());
  $("wf-url-save")?.addEventListener("click", saveComfy);
  $("wf-url")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveComfy();
    }
  });
  $("wf-file")?.addEventListener("change", () => {
    const file = $("wf-file").files?.[0];
    $("wf-file").value = "";
    if (file) importFile(file);
  });
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
    const file = [...(e.dataTransfer?.files || [])].find((f) => /\.json$/i.test(f.name) || f.type.includes("json"));
    if (!file) say("請拖入 .json 檔。", "err");
    else importFile(file);
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
