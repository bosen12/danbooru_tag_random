/** 作品冊：配方列表、重現、套用、匯入匯出。不依賴卡片 DOM 結構以外的引擎內部。 */

import { lockScroll, unlockScroll } from "./scroll-lock.js";
import { sourceLabel, formatTraceReason, sectionOfItem } from "./trace-copy.js";

const $ = (id) => document.getElementById(id);
const REDUCE_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;
const ICON_CLOSE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const ICON_STAR =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><polygon points="12 3 14.9 9.6 22 10.3 16.6 15.2 18.2 22.3 12 18.7 5.8 22.3 7.4 15.2 2 10.3 9.1 9.6"/></svg>';

let hooks = {};
let items = [];
let lastFocus = null;
let query = "";
let sort = "time";
let filterCkpt = "";
let filterLora = "";
let filterEra = "";
const favIds = new Set();

export function albumUiOpen() {
  return $("album-modal")?.classList.contains("open") && $("album-modal")?.dataset.closing !== "1";
}

export function isRecipeSaved(id) {
  return !!id && favIds.has(id);
}

async function getJson(url, init = {}) {
  let r;
  try {
    r = await fetch(url, { ...init, signal: init.signal || AbortSignal.timeout(15000) });
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
  let j = {};
  try {
    j = await r.json();
  } catch {
    j = {};
  }
  if (typeof j.ok !== "boolean") j.ok = r.ok;
  return j;
}

function say(text, kind) {
  const el = $("album-msg");
  if (!el) return;
  el.textContent = text || "";
  el.dataset.kind = kind || "";
}

function ensureDom() {
  const tools = $("mast-tools");
  if (tools && !$("album-btn")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost";
    btn.id = "album-btn";
    btn.title = "作品冊";
    btn.setAttribute("aria-haspopup", "dialog");
    btn.innerHTML = `<span class="gen-pick-label">作品冊</span>`;
    const wf = $("wf-pick-btn");
    if (wf) wf.after(btn);
    else {
      const ping = $("ping");
      if (ping && ping.parentNode === tools) tools.insertBefore(btn, ping);
      else tools.appendChild(btn);
    }
  }
  if ($("album-modal")) return;
  const modal = document.createElement("div");
  modal.id = "album-modal";
  modal.className = "lora-modal album-modal";
  modal.inert = true;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "album-head-title");
  modal.innerHTML = `
    <div class="lora-modal-inner">
      <button class="lora-modal-close" id="album-close" aria-label="關閉 (Esc)" title="關閉 (Esc)">${ICON_CLOSE}</button>
      <div class="lm-left">
        <div class="ckpt-head">
          <div class="ckpt-head-title" id="album-head-title">作品冊</div>
          <p class="ckpt-head-hint">收藏的配方。重現用當時的設定，不會偷改成面板現況。</p>
        </div>
        <div class="album-tools">
          <input id="album-q" type="search" placeholder="搜尋名稱、checkpoint、LoRA…" autocomplete="off" spellcheck="false" />
          <label class="album-sort">排序
            <select id="album-sort">
              <option value="time">時間</option>
              <option value="name">名稱</option>
            </select>
          </label>
        </div>
        <div id="album-list" class="lm-list"></div>
        <div class="album-io">
          <button type="button" class="ghost" id="album-export">匯出 JSON</button>
          <button type="button" class="ghost" id="album-import">匯入 JSON…</button>
          <input id="album-file" type="file" accept="application/json,.json" hidden />
        </div>
      </div>
      <div class="lm-right">
        <div class="lm-right-head">目前選擇</div>
        <div id="album-current" class="lm-current"></div>
        <p class="wf-msg" id="album-msg" role="status"></p>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function openModal() {
  ensureDom();
  const el = $("album-modal");
  if (!el) return;
  lastFocus = document.activeElement;
  el.inert = false;
  el.classList.add("open");
  lockScroll("album-modal");
  $("album-btn")?.setAttribute("aria-expanded", "true");
  refresh().then(() => $("album-q")?.focus());
}

function closeModal() {
  const el = $("album-modal");
  if (!el || !el.classList.contains("open") || el.dataset.closing === "1") return;
  const gen = (el._closeGen = (el._closeGen || 0) + 1);
  el.dataset.closing = "1";
  el.classList.add("is-closing");
  el.inert = true;
  $("album-btn")?.setAttribute("aria-expanded", "false");
  window.setTimeout(() => {
    if (el._closeGen !== gen) return;
    el.classList.remove("open", "is-closing");
    delete el.dataset.closing;
    unlockScroll("album-modal");
    (lastFocus || $("album-btn"))?.focus?.();
  }, REDUCE_MOTION ? 0 : 180);
}

function filtered() {
  const q = query.trim().toLowerCase();
  let rows = items.slice();
  if (q) {
    rows = rows.filter((it) => {
      const blob = [it.name, it.checkpoint, it.era, ...(it.loras || [])].join(" ").toLowerCase();
      return blob.includes(q);
    });
  }
  if (filterCkpt) rows = rows.filter((it) => (it.checkpoint || "") === filterCkpt);
  if (filterLora) rows = rows.filter((it) => (it.loras || []).some((l) => String(l).includes(filterLora)));
  if (filterEra) rows = rows.filter((it) => (it.era || "") === filterEra);
  if (sort === "name") rows.sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-Hant"));
  else rows.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return rows;
}

function renderList() {
  const box = $("album-list");
  if (!box) return;
  box.replaceChildren();
  const rows = filtered();
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "ckpt-head-hint";
    empty.textContent = items.length ? "沒有符合篩選的配方。" : "還沒有收藏。卡片上的星號可以把成品存成配方。";
    box.append(empty);
    return;
  }
  for (const it of rows) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "lora-row";
    row.dataset.id = it.id;
    const rt = document.createElement("span");
    rt.className = "rt";
    rt.textContent = it.name;
    const rf = document.createElement("span");
    rf.className = "rf";
    rf.textContent = [it.era, it.checkpoint, (it.loras || [])[0]].filter(Boolean).join(" · ") || "無 checkpoint";
    const rn = document.createElement("span");
    rn.className = "rn";
    rn.append(rt, rf);
    row.append(rn);
    row.addEventListener("click", () => showCurrent(it.id));
    box.append(row);
  }
}

async function showCurrent(id) {
  const j = await getJson("/api/recipes/" + encodeURIComponent(id));
  const box = $("album-current");
  if (!box) return;
  if (!j.ok || !j.recipe) {
    say(j.error || "讀不到這份配方。", "err");
    return;
  }
  const rec = j.recipe;
  const miss = j.missing || {};
  box.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = rec.name;
  box.append(title);
  const meta = document.createElement("p");
  meta.className = "ckpt-head-hint";
  meta.textContent = `seed ${rec.seed} · ${rec.width}×${rec.height} · ${rec.era || "時代未記"}`;
  box.append(meta);
  if (miss.checkpoint || (miss.loras && miss.loras.length) || miss.workflow) {
    const warn = document.createElement("p");
    warn.className = "warn";
    const bits = [];
    if (miss.checkpoint) bits.push("checkpoint 已不存在：" + (rec.checkpoint || ""));
    for (const l of miss.loras || []) bits.push("LoRA 已不存在：" + l);
    if (miss.workflow) bits.push("workflow 已不存在：" + rec.workflowId);
    warn.textContent = bits.join("；");
    box.append(warn);
  }
  const actions = [
    ["重現", () => hooks.generateFromRecipe?.(rec)],
    ["套用到工作台", () => hooks.applyRecipe?.(rec)],
    ["複製後微調", () => duplicate(rec)],
    ["匯出這份", () => downloadJson(rec.name + ".json", { schemaVersion: 1, recipes: [rec] })],
    ["刪除…", () => remove(rec)],
  ];
  for (const [label, fn] of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost";
    btn.textContent = label;
    btn.addEventListener("click", fn);
    box.append(btn);
  }
}

async function duplicate(rec) {
  const copy = { ...rec };
  delete copy.id;
  copy.name = (rec.name || "配方") + " 副本";
  const j = await getJson("/api/recipes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(copy) });
  if (!j.ok) {
    say(j.error || "複製失敗", "err");
    return;
  }
  say("已複製成新配方，可再微調。");
  await refresh();
  showCurrent(j.recipe.id);
}

async function remove(rec) {
  if (!window.confirm(`刪除「${rec.name}」？可在匯出備份後復原。`)) return;
  const j = await getJson("/api/recipes/" + encodeURIComponent(rec.id), { method: "DELETE" });
  if (!j.ok) {
    say(j.error || "刪除失敗", "err");
    return;
  }
  favIds.delete(rec.id);
  say("已刪除。若要復原，把剛才匯出的 JSON 再匯入。");
  hooks.onFavChange?.();
  await refresh();
  $("album-current")?.replaceChildren();
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function refresh() {
  const j = await getJson("/api/recipes");
  if (!j.ok) {
    say(j.error || "讀不到作品冊。", "err");
    return;
  }
  items = j.items || [];
  favIds.clear();
  for (const it of items) favIds.add(it.id);
  renderList();
  hooks.onFavChange?.();
}

export async function saveRecipeFromCard(card) {
  const rec = card?._recipe;
  if (!rec) return { ok: false, error: "這張卡沒有可存的配方。" };
  if (card.dataset.recipeId) {
    const gone = await getJson("/api/recipes/" + encodeURIComponent(card.dataset.recipeId), { method: "DELETE" });
    if (gone.ok) {
      favIds.delete(card.dataset.recipeId);
      delete card.dataset.recipeId;
      paintFavButton(card);
      hooks.onFavChange?.();
      return { ok: true, removed: true };
    }
  }
  const j = await getJson("/api/recipes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rec),
  });
  if (!j.ok) return j;
  card.dataset.recipeId = j.recipe.id;
  card._recipe = { ...rec, id: j.recipe.id };
  favIds.add(j.recipe.id);
  paintFavButton(card);
  if (card.dataset.imageFile || (card.querySelector(".shot-img")?.src || "").includes("/api/image")) {
    const src = card.querySelector(".shot-img")?.src || "";
    try {
      const u = new URL(src, location.href);
      await getJson("/api/recipes/" + encodeURIComponent(j.recipe.id) + "/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: u.searchParams.get("filename"), subfolder: u.searchParams.get("subfolder"), type: u.searchParams.get("type") }),
      });
    } catch {
      /* image copy is optional */
    }
  }
  hooks.onFavChange?.();
  return j;
}

export function paintFavButton(card) {
  const btn = card?.querySelector(".fav-shot");
  if (!btn) return;
  const on = isRecipeSaved(card.dataset.recipeId);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.setAttribute("aria-label", on ? "取消收藏" : "收藏這張");
  btn.title = on ? "取消收藏" : "收藏";
  btn.classList.toggle("is-on", on);
}

export function ensureFavButton(card) {
  const shot = card?.querySelector(".shot");
  const btn = shot?.querySelector(".fav-shot");
  if (!btn || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const r = await saveRecipeFromCard(card);
    if (!r.ok) hooks.speak?.(r.error || "收藏失敗");
    else hooks.speak?.(r.removed ? "已取消收藏" : "已收藏");
  });
  paintFavButton(card);
}

const SECTION_ZH = { subject: "人物", feature: "特徵", clothing: "服裝", pose: "姿勢", env: "環境", quality: "品質" };

export function paintWhy(card, lex, labelOf) {
  const meta = card?.querySelector(".meta");
  if (!meta) return;
  let wrap = meta.querySelector(".why-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "why-wrap";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost why-btn";
    btn.setAttribute("aria-expanded", "false");
    btn.textContent = "為什麼是這些？";
    const panel = document.createElement("div");
    panel.className = "why-panel";
    panel.hidden = true;
    btn.addEventListener("click", () => {
      const open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    wrap.append(btn, panel);
    meta.append(wrap);
  }
  const panel = wrap.querySelector(".why-panel");
  const trace = card._recipe?.traceSummary;
  if (!trace) {
    panel.replaceChildren();
    const p = document.createElement("p");
    p.textContent = "這張沒有抽取紀錄。";
    panel.append(p);
    return;
  }
  panel.replaceChildren();
  const groups = { subject: [], feature: [], clothing: [], pose: [], env: [], quality: [] };
  for (const ev of trace.kept || []) {
    const item = lex?.byTag?.get(ev.tag);
    const sec = sectionOfItem(item, ev.tag);
    (groups[sec] || groups.env).push(ev);
  }
  for (const sec of Object.keys(groups)) {
    if (!groups[sec].length) continue;
    const h = document.createElement("h3");
    h.textContent = SECTION_ZH[sec] || sec;
    panel.append(h);
    const ul = document.createElement("ul");
    for (const ev of groups[sec]) {
      ul.append(whyItem(ev, lex, labelOf, card));
    }
    panel.append(ul);
  }
  const unused = trace.rejected || [];
  if (unused.length) {
    const h = document.createElement("h3");
    h.textContent = "未採用";
    panel.append(h);
    const ul = document.createElement("ul");
    for (const ev of unused) ul.append(whyItem(ev, lex, labelOf, card));
    panel.append(ul);
  }
}

function whyItem(ev, lex, labelOf, card) {
  const li = document.createElement("li");
  const zh = labelOf ? labelOf(lex, ev.tag) : ev.tag;
  const name = document.createElement("button");
  name.type = "button";
  name.className = "why-tag";
  name.dataset.tag = ev.tag;
  name.textContent = `${zh} · ${ev.tag}`;
  name.addEventListener("click", () => locateTag(card, ev.tag));
  const why = document.createElement("span");
  why.className = "why-reason";
  why.textContent = ev.status === "rejected"
    ? formatTraceReason(ev, { labelOf: (t) => (labelOf ? labelOf(lex, t) : t) })
    : sourceLabel(ev.source);
  li.append(name, why);
  for (const rel of ev.related || []) {
    const rbtn = document.createElement("button");
    rbtn.type = "button";
    rbtn.className = "why-rel";
    rbtn.dataset.tag = rel;
    rbtn.textContent = labelOf ? labelOf(lex, rel) : rel;
    rbtn.addEventListener("click", () => locateTag(card, rel));
    li.append(rbtn);
  }
  return li;
}

function locateTag(card, tag) {
  const hit = card.querySelector(`.pos span[data-tag="${CSS.escape(tag)}"]`) || document.querySelector(`.tag[data-tag="${CSS.escape(tag)}"]`);
  if (!hit) return;
  hit.scrollIntoView({ block: "nearest", inline: "nearest" });
  hit.classList.add("is-locate");
  window.setTimeout(() => hit.classList.remove("is-locate"), 900);
}

export function albumHandleKeys(e) {
  if (!albumUiOpen()) return false;
  if (e.key === "Escape") {
    e.preventDefault();
    closeModal();
    return true;
  }
  return true;
}

export function initAlbum(nextHooks) {
  hooks = nextHooks || {};
  ensureDom();
  $("album-btn")?.addEventListener("click", openModal);
  $("album-close")?.addEventListener("click", closeModal);
  $("album-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "album-modal") closeModal();
  });
  $("album-q")?.addEventListener("input", () => {
    query = $("album-q").value || "";
    renderList();
  });
  $("album-sort")?.addEventListener("change", () => {
    sort = $("album-sort").value || "time";
    renderList();
  });
  $("album-export")?.addEventListener("click", async () => {
    const j = await getJson("/api/recipes/export");
    if (!j.ok) say(j.error || "匯出失敗", "err");
    else downloadJson("recipes.json", j.payload || j);
  });
  $("album-import")?.addEventListener("click", () => $("album-file")?.click());
  $("album-file")?.addEventListener("change", async () => {
    const file = $("album-file").files?.[0];
    $("album-file").value = "";
    if (!file) return;
    const text = await file.text();
    const j = await getJson("/api/recipes/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: text,
    });
    if (!j.ok) say(j.error || "匯入失敗", "err");
    else {
      say(`已匯入 ${ (j.items || []).length } 份。`);
      await refresh();
    }
  });
  refresh().catch(() => {});
}
