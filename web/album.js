/** 作品冊：配方印樣、重現、套用、匯入匯出。不依賴卡片 DOM 結構以外的引擎內部。
 *
 * 這裡以前借用 LoRA 挑選器的版面：320px 的檔名側欄 ＋ 詳情頁。那個形狀是為了
 * 「從幾百個檔名裡挑一個」設計的，而作品冊要回答的是完全不同的問題 ——
 * 「我上次喜歡的那張長什麼樣」。認圖是視覺的事，翻成一排 `era · checkpoint`
 * 就等於把使用者手上唯一的線索丟掉，而 /api/recipes 每一筆本來就帶著 image。
 * 所以改成印樣：縮圖是主角，檔名退成說明。
 */

import { lockScroll, unlockScroll } from "./scroll-lock.js";
import { sourceLabel, formatTraceReason, sectionOfItem } from "./trace-copy.js";
import { ERA_LABELS } from "./engine.js";

const $ = (id) => document.getElementById(id);
const REDUCE_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;
const ICON_CLOSE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const ICON_STAR =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><polygon points="12 3 14.9 9.6 22 10.3 16.6 15.2 18.2 22.3 12 18.7 5.8 22.3 7.4 15.2 2 10.3 9.1 9.6"/></svg>';
const ICON_WARN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 1.5 21h21z"/><line x1="12" y1="10" x2="12" y2="14"/><line x1="12" y1="17.5" x2="12" y2="17.6"/></svg>';

const RATING_ZH = { general: "全年齡", sensitive: "敏感", explicit: "色情" };

/** 底模和 LoRA 都是帶資料夾的路徑，畫面上只要最後那一段。兩種分隔符都要吃。 */
function baseName(v) {
  return String(v || "").split("/").pop().split("\\").pop();
}

let hooks = {};
let items = [];
let lastFocus = null;
let query = "";
let sort = "time";
let filterCkpt = "";
let filterLora = "";
let filterEra = "";
let currentId = "";
const favIds = new Set();
// 每一格「還重現得了嗎」要問伺服器，而那個答案只有 GET /api/recipes/{id} 有。
// 一次問十二份是浪費，所以捲到才問，問過就記著。
const missCache = new Map();

// --- 純的那一半：篩選、排序、籤條選項 ---------------------------------------
// 抽出來不是為了漂亮，是因為這三件事以前全埋在 DOM 函式裡，於是
// filterCkpt／filterLora／filterEra 三個變數被讀、卻從來沒有人寫，
// 整整一組篩選器是空殼，而且沒有任何測試看得見這件事。

export function albumRows(list, { query: q = "", sort: how = "time", ckpt = "", lora = "", era = "" } = {}) {
  const needle = String(q || "").trim().toLowerCase();
  let rows = (Array.isArray(list) ? list : []).slice();
  if (needle) {
    rows = rows.filter((it) => {
      const blob = [it.name, it.checkpoint, it.era, ERA_LABELS[it.era], ...(it.loras || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(needle);
    });
  }
  if (ckpt) rows = rows.filter((it) => (it.checkpoint || "") === ckpt);
  if (lora) rows = rows.filter((it) => (it.loras || []).some((l) => String(l) === lora));
  if (era) rows = rows.filter((it) => (it.era || "") === era);
  if (how === "name") rows.sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-Hant"));
  else rows.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return rows;
}

/** 籤條只列真的存在於資料裡的值，而且照出現次數排 —— 列出一個點了會空的籤條，
 *  比不列更糟。只有一種值的維度整條不列：那條籤篩不掉任何東西。 */
export function albumChipOptions(list) {
  const rows = Array.isArray(list) ? list : [];
  const tally = (pick) => {
    const n = new Map();
    for (const it of rows) {
      for (const v of pick(it)) {
        if (!v) continue;
        n.set(v, (n.get(v) || 0) + 1);
      }
    }
    return [...n.entries()]
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
      .map(([value, count]) => ({ value, count }));
  };
  const out = {
    ckpt: tally((it) => [it.checkpoint]),
    era: tally((it) => [it.era]),
    lora: tally((it) => it.loras || []),
  };
  for (const key of Object.keys(out)) if (out[key].length < 2) out[key] = [];
  return out;
}

/** 格子底下那行說明。自動命名的配方叫「現代 · seed 2928072855」—— 說明行如果
 *  照樣再印一次時代和 seed，同一格就把同一件事講兩遍，第二遍不帶任何新消息。
 *  所以已經在名字裡的就不再講。 */
export function captionMeta(it, { showCkpt = true, eraLabels = ERA_LABELS } = {}) {
  const name = String(it?.name || "");
  const parts = [
    eraLabels[it?.era] || it?.era || "",
    RATING_ZH[it?.rating] || "",
    it?.seed || it?.seed === 0 ? "seed " + it.seed : "",
    // 全部配方都同一個底模時，每一格印一次等於印了寂寞，還會把說明行擠到截斷。
    showCkpt ? baseName(it?.checkpoint) : "",
  ];
  const out = [];
  for (const part of parts) {
    if (!part || name.includes(part) || out.includes(part)) continue;
    out.push(part);
  }
  return out.join(" · ");
}

export function recipeThumbUrl(it) {
  const file = it?.thumbnail?.file || it?.image?.file;
  return file ? "/api/recipes/files/" + encodeURIComponent(file) : "";
}

/** 缺件清單。以前是用「；」串成一句話塞進 <p>，長度一過就讀不完，
 *  而且看完還是可以按重現 —— 按下去才失敗。 */
export function missingLines(missing, rec) {
  const miss = missing || {};
  const out = [];
  if (miss.checkpoint) out.push("底模已不在：" + (rec?.checkpoint || "（未記錄）"));
  for (const l of miss.loras || []) out.push("LoRA 已不在：" + l);
  if (miss.workflow) out.push("工作流已不在：" + (rec?.workflowId || ""));
  return out;
}

/** 底模或工作流不在就重現不了；LoRA 不在只是風格會掉，圖還是生得出來。 */
export function canReproduce(missing) {
  const miss = missing || {};
  return !miss.checkpoint && !miss.workflow;
}

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
  // 版面：印樣佔滿，詳情固定在右邊 320。以前是反過來的（檔名側欄 320、詳情吃掉
  // 剩下的），那是 LoRA 挑選器的比例 —— 那邊要讀的是檔名，這邊要看的是圖。
  modal.innerHTML = `
    <div class="lora-modal-inner album-inner">
      <button class="lora-modal-close" id="album-close" aria-label="關閉 (Esc)" title="關閉 (Esc)">${ICON_CLOSE}</button>
      <div class="album-main">
        <div class="album-head">
          <h2 class="ckpt-head-title" id="album-head-title">作品冊<span class="album-count" id="album-count"></span></h2>
          <p class="ckpt-head-hint">收藏的配方。重現用當時的設定，不會偷改成面板現況。</p>
        </div>
        <div class="album-tools">
          <input id="album-q" type="search" aria-label="搜尋作品冊" placeholder="搜尋名稱、底模、LoRA…" autocomplete="off" spellcheck="false" />
          <label class="album-sort" for="album-sort">排序</label>
          <select id="album-sort">
            <option value="time">最近收藏</option>
            <option value="name">名稱</option>
          </select>
        </div>
        <div class="album-chips" id="album-chips"></div>
        <div id="album-list" class="album-grid" role="list"></div>
      </div>
      <aside class="album-side">
        <div class="lm-right-head">目前選擇</div>
        <div id="album-current" class="album-detail"></div>
        <p class="wf-msg" id="album-msg" role="status" aria-live="polite"></p>
        <div class="album-io">
          <button type="button" class="ghost mini" id="album-export">匯出 JSON</button>
          <button type="button" class="ghost mini" id="album-import">匯入 JSON…</button>
          <input id="album-file" type="file" accept="application/json,.json" hidden />
        </div>
      </aside>
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
  // 面板關了就別再問伺服器缺件。
  missGen += 1;
  window.setTimeout(() => {
    if (el._closeGen !== gen) return;
    el.classList.remove("open", "is-closing");
    delete el.dataset.closing;
    unlockScroll("album-modal");
    (lastFocus || $("album-btn"))?.focus?.();
  }, REDUCE_MOTION ? 0 : 180);
}

function chipRow(box, label, options, active, onPick) {
  if (!options.length) return;
  const row = document.createElement("div");
  row.className = "album-chip-row";
  const head = document.createElement("span");
  head.className = "album-chip-label";
  head.textContent = label;
  row.append(head);
  for (const { value, count } of options) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "album-chip";
    b.dataset.value = String(value);
    b.setAttribute("aria-pressed", active === value ? "true" : "false");
    const text = label === "時代" ? ERA_LABELS[value] || value : baseName(value);
    b.append(document.createTextNode(text));
    const n = document.createElement("span");
    n.className = "album-chip-n";
    n.textContent = String(count);
    b.append(n);
    b.title = String(value);
    // 再點一次就是取消 —— 沒有這一下，籤條按下去只能靠重開面板才回得來。
    // 讀當下的 aria-pressed，不是建立當時的那個快照：籤條不再重建，快照會過期。
    b.addEventListener("click", () => onPick(b.getAttribute("aria-pressed") === "true" ? "" : value));
    row.append(b);
  }
  box.append(row);
}

/** 按下籤條之後只重畫按壓狀態，不重建整排。重建會把剛剛按下的那顆籤換成
 *  一顆新的 DOM，鍵盤使用者的焦點當場掉回 body —— 用鍵盤連按兩條籤就不可能。 */
function paintChipStates() {
  const box = $("album-chips");
  if (!box) return;
  const active = { 底模: filterCkpt, 時代: filterEra, LoRA: filterLora };
  for (const row of box.querySelectorAll(".album-chip-row")) {
    const on = active[row.querySelector(".album-chip-label")?.textContent || ""] ?? "";
    for (const chip of row.querySelectorAll(".album-chip")) {
      chip.setAttribute("aria-pressed", chip.dataset.value === on ? "true" : "false");
    }
  }
}

function renderChips() {
  const box = $("album-chips");
  if (!box) return;
  box.replaceChildren();
  const opts = albumChipOptions(items);
  const pick = (set) => (v) => {
    set(v);
    paintChipStates();
    renderGrid();
  };
  chipRow(box, "底模", opts.ckpt, filterCkpt, pick((v) => (filterCkpt = v)));
  chipRow(box, "時代", opts.era, filterEra, pick((v) => (filterEra = v)));
  chipRow(box, "LoRA", opts.lora, filterLora, pick((v) => (filterLora = v)));
  box.hidden = !box.childElementCount;
}

function clearFilters() {
  query = "";
  filterCkpt = "";
  filterEra = "";
  filterLora = "";
  const q = $("album-q");
  if (q) q.value = "";
  paintChipStates();
  renderGrid();
}

function paintCellMiss(cell, missing) {
  const broken = !canReproduce(missing);
  const soft = !broken && (missing?.loras || []).length > 0;
  cell.classList.toggle("is-broken", broken);
  cell.classList.toggle("is-soft", soft);
  let badge = cell.querySelector(".album-badge");
  if (!broken && !soft) {
    badge?.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "album-badge";
    cell.querySelector(".album-thumb")?.append(badge);
  }
  const label = broken ? "重現不了：底模或工作流已不在" : "LoRA 已不在，風格會掉";
  badge.innerHTML = ICON_WARN;
  const sr = document.createElement("span");
  sr.className = "sr-only";
  sr.textContent = label;
  badge.append(sr);
  badge.title = label;
}

/** 缺件只有 GET /api/recipes/{id} 知道，列表那支不帶。一開面板就把每一份都問
 *  一遍，在只有幾份的機器上看不出來，幾十份就是幾十個請求同時打出去 ——
 *  所以排隊，一次四個，而且面板一關或重畫就整批放掉。問過的記著，不再問。
 *
 *  先前這裡用 IntersectionObserver（捲到才問）。換掉的理由是它把「缺件標記出不
 *  出得來」綁在瀏覽器的繪製節奏上：那在真的瀏覽器裡沒問題，但代表這條路在任何
 *  不推進繪製的環境裡都驗不到。這個面板一次撐死幾十格，省不了多少，卻換來一條
 *  量不到的路。 */
const MISS_PARALLEL = 4;
let missGen = 0;

function resolveMissing(rows) {
  const gen = ++missGen;
  const queue = rows.filter((it) => !missCache.has(it.id)).map((it) => it.id);
  let at = 0;
  const pump = async () => {
    while (at < queue.length) {
      if (gen !== missGen) return;
      const rid = queue[at++];
      const j = await getJson("/api/recipes/" + encodeURIComponent(rid));
      if (gen !== missGen) return;
      if (!j.ok) continue;
      missCache.set(rid, j.missing || {});
      paintCellById(rid);
    }
  };
  for (let i = 0; i < Math.min(MISS_PARALLEL, queue.length); i += 1) pump();
}

function paintCellById(rid) {
  const cell = document.querySelector(`#album-list .album-cell[data-id="${CSS.escape(rid)}"]`);
  if (cell) paintCellMiss(cell, missCache.get(rid) || {});
}

// 沒有圖的格子。以前這裡印時代，可是時代在下面的說明行已經有了 ——
// 同一格看到兩次「現代」，第二次不帶任何新消息。
function placeholder() {
  const ph = document.createElement("span");
  ph.className = "album-ph";
  ph.textContent = "沒有存圖";
  ph.setAttribute("aria-hidden", "true");
  return ph;
}

// 底模／時代這些欄位，只有在整本作品冊裡真的不只一種值時才值得印在格子上。
// 跟籤條同一條規則（albumChipOptions 也是少於兩種就整條不列）。
let showCkpt = true;

// 格線的項目是外面這層 <div>，不是按鈕本身。
// <button> 當 grid item 時貢獻給 auto 列的內在高度是錯的 —— 實測列高被算成
// 35.7px（只有說明文字那段），而格子實際 224px，於是每一列直接疊在上一列身上。
// 換成 div 之後列高 224px。順便讓這層擔 role=listitem，容器的 role=list 才成立。
function makeCell(it) {
  const wrap = document.createElement("div");
  wrap.className = "album-cell-wrap";
  wrap.setAttribute("role", "listitem");
  const cell = document.createElement("button");
  cell.type = "button";
  cell.className = "album-cell";
  cell.dataset.id = it.id;
  if (it.id === currentId) cell.setAttribute("aria-current", "true");

  const thumb = document.createElement("div");
  thumb.className = "album-thumb";
  const src = recipeThumbUrl(it);
  if (src) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    // 圖讀不到時不要留一塊破圖 icon，換成跟「本來就沒圖」一樣的佔位。
    img.addEventListener("error", () => {
      img.remove();
      thumb.prepend(placeholder());
    });
    thumb.append(img);
  } else {
    thumb.append(placeholder());
  }
  cell.append(thumb);

  const cap = document.createElement("span");
  cap.className = "album-cap";
  const nm = document.createElement("span");
  nm.className = "album-cap-name";
  nm.textContent = it.name;
  const meta = document.createElement("span");
  meta.className = "album-cap-meta";
  meta.textContent = captionMeta(it, { showCkpt });
  cap.append(nm, meta);
  cell.append(cap);

  cell.addEventListener("click", () => showCurrent(it.id));
  if (missCache.has(it.id)) paintCellMiss(cell, missCache.get(it.id));
  wrap.append(cell);
  return wrap;
}

function renderGrid() {
  const box = $("album-list");
  if (!box) return;
  box.replaceChildren();
  const rows = albumRows(items, { query, sort, ckpt: filterCkpt, era: filterEra, lora: filterLora });
  showCkpt = new Set(items.map((it) => it.checkpoint || "")).size > 1;
  const count = $("album-count");
  if (count) count.textContent = items.length ? `\u3000${rows.length} / ${items.length}` : "";
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "ckpt-head-hint album-empty";
    if (!items.length) {
      empty.textContent = "還沒有收藏。成品卡片右上角的星號，可以把那一張連同它的設定存成配方。";
    } else {
      empty.textContent = "沒有符合的配方。";
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "ghost mini";
      reset.textContent = "清掉篩選";
      reset.addEventListener("click", clearFilters);
      empty.append(document.createElement("br"), reset);
    }
    box.append(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const it of rows) frag.append(makeCell(it));
  box.append(frag);
  resolveMissing(rows);
}

function metaRow(box, label, value) {
  if (!value && value !== 0) return;
  const row = document.createElement("div");
  row.className = "album-meta-row";
  const k = document.createElement("span");
  k.className = "album-meta-k";
  k.textContent = label;
  const v = document.createElement("span");
  v.className = "album-meta-v";
  v.textContent = String(value);
  v.title = String(value);
  row.append(k, v);
  box.append(row);
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
  missCache.set(rec.id, miss);
  currentId = rec.id;
  for (const cell of document.querySelectorAll("#album-list .album-cell")) {
    if (cell.dataset.id === rec.id) {
      cell.setAttribute("aria-current", "true");
      paintCellMiss(cell, miss);
    } else cell.removeAttribute("aria-current");
  }
  say("");
  box.replaceChildren();

  const shot = document.createElement("div");
  shot.className = "album-detail-shot";
  const src = recipeThumbUrl({ image: rec.image, thumbnail: rec.thumbnail });
  if (src) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = rec.name;
    img.decoding = "async";
    shot.append(img);
  } else {
    shot.append(placeholder());
  }
  box.append(shot);

  const title = document.createElement("div");
  title.className = "album-detail-title";
  const strong = document.createElement("strong");
  strong.textContent = rec.name;
  const ren = document.createElement("button");
  ren.type = "button";
  ren.className = "ghost mini";
  ren.textContent = "重新命名…";
  ren.addEventListener("click", () => rename(rec));
  title.append(strong, ren);
  box.append(title);

  // 缺件先講，而且一行一件。以前是用「；」串成一句塞進 <p>，兩個 LoRA 就讀不完。
  const lines = missingLines(miss, rec);
  if (lines.length) {
    const warn = document.createElement("div");
    warn.className = canReproduce(miss) ? "album-miss is-soft" : "album-miss";
    const h = document.createElement("strong");
    h.textContent = canReproduce(miss) ? "少了東西，風格會掉" : "這份重現不了";
    warn.append(h);
    const ul = document.createElement("ul");
    for (const line of lines) {
      const li = document.createElement("li");
      li.textContent = line;
      ul.append(li);
    }
    warn.append(ul);
    box.append(warn);
  }

  const meta = document.createElement("div");
  meta.className = "album-meta";
  metaRow(meta, "seed", rec.seed);
  metaRow(meta, "尺寸", `${rec.width}\u00d7${rec.height}`);
  metaRow(meta, "時代", ERA_LABELS[rec.era] || rec.era || "未記");
  metaRow(meta, "分級", RATING_ZH[rec.rating] || rec.rating || "");
  metaRow(meta, "底模", baseName(rec.checkpoint) || "未記");
  for (const l of rec.loras || []) metaRow(meta, "LoRA", baseName(l.file || l.name));
  box.append(meta);

  const actions = document.createElement("div");
  actions.className = "album-actions";

  const go = document.createElement("button");
  go.type = "button";
  go.className = "album-go";
  go.textContent = "重現";
  if (!canReproduce(miss)) {
    // 以前這顆按得下去，按了才失敗。理由寫在鈕旁邊，不是藏在上面那段話裡。
    go.disabled = true;
    go.title = lines.join("\uff1b");
    const why = document.createElement("span");
    why.className = "album-go-why";
    why.textContent = miss.checkpoint ? "底模已不在，重現不了" : "工作流已不在，重現不了";
    actions.append(go, why);
  } else {
    go.addEventListener("click", () => hooks.generateFromRecipe?.(rec));
    actions.append(go);
  }

  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "ghost album-apply";
  apply.textContent = "套用到工作台";
  apply.addEventListener("click", () => {
    // 這一顆會把左欄的釘選、封禁、時代、尺度整組換掉，而且沒有復原。
    // 以前它跟「匯出這份」長得一模一樣，按錯就是工作臺沒了。
    if (!window.confirm(`把「${rec.name}」套到工作台？現在的釘選、關掉、時代與尺度會被換成這份配方的，沒有復原。`)) return;
    hooks.applyRecipe?.(rec);
  });
  actions.append(apply);

  const quiet = document.createElement("div");
  quiet.className = "album-actions-quiet";
  for (const [label, fn] of [
    ["複製後微調", () => duplicate(rec)],
    ["匯出這份", () => downloadJson(rec.name + ".json", { schemaVersion: 1, recipes: [rec] })],
  ]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ghost mini";
    b.textContent = label;
    b.addEventListener("click", fn);
    quiet.append(b);
  }
  const del = document.createElement("button");
  del.type = "button";
  del.className = "ghost mini album-danger";
  del.textContent = "刪除…";
  del.addEventListener("click", () => remove(rec));
  quiet.append(del);
  actions.append(quiet);
  box.append(actions);
}

async function rename(rec) {
  const next = window.prompt("配方名稱", rec.name || "");
  if (next == null) return;
  const name = next.trim().slice(0, 80);
  if (!name) {
    say("名稱不能空白。", "err");
    return;
  }
  if (name === rec.name) return;
  const j = await getJson("/api/recipes/" + encodeURIComponent(rec.id), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...rec, name }),
  });
  if (!j.ok) {
    say(j.error || "改名失敗", "err");
    return;
  }
  await refresh();
  await showCurrent(rec.id);
  // showCurrent 會把訊息區清空，所以這句要在它之後 —— 跟 remove() 同一個坑。
  say(`已改名為「${name}」`);
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
  missCache.delete(rec.id);
  if (currentId === rec.id) currentId = "";
  hooks.onFavChange?.();
  await refresh();
  $("album-current")?.replaceChildren();
  // refresh() 會把訊息區清空，所以這句要在它之後講，不然等於沒講。
  say("已刪除。若要復原，把剛才匯出的 JSON 再匯入。");
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
  // 籤條的選項是從資料長出來的，資料換了就得重算 —— 否則刪掉最後一份用某個
  // 底模的配方之後，那條籤還留在畫面上，點下去是空的。
  for (const id of [...missCache.keys()]) if (!favIds.has(id)) missCache.delete(id);
  if (filterCkpt && !items.some((it) => (it.checkpoint || "") === filterCkpt)) filterCkpt = "";
  if (filterEra && !items.some((it) => (it.era || "") === filterEra)) filterEra = "";
  if (filterLora && !items.some((it) => (it.loras || []).some((l) => String(l) === filterLora))) filterLora = "";
  renderChips();
  renderGrid();
  hooks.onFavChange?.();
}

export async function saveRecipeFromCard(card) {
  const rec = card?._recipe;
  if (!rec) return { ok: false, error: "這張卡沒有可存的配方。" };
  if (card.dataset.recipeId) {
    if (!window.confirm("取消收藏會刪除這份配方。確定？")) return { ok: true, removed: false };
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
    else if (r.removed) hooks.speak?.("已取消收藏");
    else if (r.recipe) {
      hooks.speak?.("已收藏");
      // 彈一下只在「剛按下、真的存進去」的這一刻。放在 paintFavButton 的話，
      // 重新整理或重畫卡片時每一張已收藏的都會跟著跳。
      // 取消收藏時按了確認框的「取消」，什麼都沒變，也就什麼都不說。
      btn.classList.remove("is-popping");
      void btn.offsetWidth;
      btn.classList.add("is-popping");
      btn.addEventListener("animationend", () => btn.classList.remove("is-popping"), { once: true });
    }
  });
  paintFavButton(card);
}

const SECTION_ZH = { subject: "人物", feature: "特徵", clothing: "服裝", pose: "姿勢", env: "環境", quality: "品質" };

export function paintWhy(card, lex, labelOf) {
  const meta = card?.querySelector(".meta");
  if (!meta) return;
  const btn = card.querySelector(".bar .why-btn");
  let panel = meta.querySelector(":scope > .why-panel");
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "why-panel";
    panel.hidden = true;
    meta.append(panel);
  }
  if (btn && btn.dataset.bound !== "1") {
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }
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

function cssAttr(tag) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(tag);
  return String(tag).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function locateTag(card, tag) {
  const sel = cssAttr(tag);
  const hit = card.querySelector(`.pos span[data-tag="${sel}"]`) || document.querySelector(`.tag[data-tag="${sel}"]`);
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
  let searchTimer = 0;
  $("album-q")?.addEventListener("input", () => {
    query = $("album-q").value || "";
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(renderGrid, 120);
  });
  $("album-q")?.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !$("album-q").value) return;
    // 搜尋框裡的 Esc 先清字，不要直接把整個面板關掉 —— 詞庫那邊就是這樣。
    e.stopPropagation();
    clearFilters();
  });
  $("album-sort")?.addEventListener("change", () => {
    sort = $("album-sort").value || "time";
    renderGrid();
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
}
