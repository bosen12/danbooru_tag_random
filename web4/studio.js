/** 導影台殼層：場記條＋釘選台／詞庫 sheet＋成片卡呈現。不碰 engine／drawOne。
 * 文案跟棚內控制台走，不講賦能／一鍵／完美。 */

import { clashSummary } from "./reason-copy.js";

const $ = (id) => document.getElementById(id);

const RATING_ZH = { general: "全年齡", sensitive: "敏感", explicit: "色情" };
const HEAT_ZH = { mixed: "混合", activity: "活動", tease: "誘惑", flash: "走光", sex: "性愛" };
const MODE_ZH = { normal: "正常", diverse: "多元", weird: "奇葩" };

function pressed(sel) {
  return [...document.querySelectorAll(sel)].filter((el) => el.getAttribute("aria-pressed") === "true");
}

function currentRating() {
  const on = document.querySelector('#rating .segmented-btn[aria-current="true"]');
  return on ? RATING_ZH[on.dataset.rating] || on.textContent.trim() : "";
}

function currentCast() {
  if ($("girl")?.getAttribute("aria-pressed") === "true") return "女";
  if ($("boy")?.getAttribute("aria-pressed") === "true") return "男";
  if ($("cast-any")?.getAttribute("aria-pressed") === "true") return "不限";
  return "";
}

function currentHeats() {
  const heats = pressed("#heats .chip-toggle[data-heat]");
  if (!heats.length) return "";
  return heats.map((b) => HEAT_ZH[b.dataset.heat] || b.textContent.trim()).join("+");
}

function currentEra() {
  const on = document.querySelector('#eras .chip-toggle[aria-pressed="true"], #eras button[aria-pressed="true"]');
  if (!on) return "";
  return (on.textContent || "").trim();
}

function currentMode() {
  const on = document.querySelector('[data-scene-mode][aria-pressed="true"]');
  return on ? MODE_ZH[on.dataset.sceneMode] || on.textContent.trim() : "";
}

function uniqueTagCount(sel) {
  const seen = new Set();
  for (const el of document.querySelectorAll(sel)) {
    const t = el.dataset.tag;
    if (t) seen.add(t);
  }
  return seen.size;
}

export function refreshSlateLine() {
  const line = $("slate-line");
  if (!line) return;
  const bits = [currentRating(), currentHeats(), currentEra(), currentCast(), currentMode()].filter(Boolean);
  const pins = uniqueTagCount("#tray-pins .tag[data-tag]");
  const bans = uniqueTagCount('.tag[data-ban="user"][data-tag]');
  bits.push(`釘 ${pins}`);
  bits.push(`封 ${bans}`);
  line.textContent = bits.join(" · ") || "尚未設定";
}

function setSheet(el, open) {
  if (!el) return;
  el.hidden = !open;
  el.classList.toggle("is-open", open);
  document.body.classList.toggle("sheet-open", open);
}

function openLex() {
  setSheet($("pin-sheet"), false);
  setSheet($("lex-sheet"), true);
  $("q")?.focus();
}

function openPins() {
  setSheet($("lex-sheet"), false);
  setSheet($("pin-sheet"), true);
}

function closeSheets() {
  setSheet($("lex-sheet"), false);
  setSheet($("pin-sheet"), false);
}

function bindSheets() {
  $("open-lexicon")?.addEventListener("click", openLex);
  $("open-pinsheet")?.addEventListener("click", openPins);
  document.querySelectorAll("[data-close-lex]").forEach((el) => el.addEventListener("click", () => setSheet($("lex-sheet"), false)));
  document.querySelectorAll("[data-close-pins]").forEach((el) => el.addEventListener("click", () => setSheet($("pin-sheet"), false)));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSheets();
  });
}

function bindSlateWatch() {
  const root = $("sec-rules") || document.body;
  root.addEventListener("click", () => queueMicrotask(refreshSlateLine));
  root.addEventListener("change", () => queueMicrotask(refreshSlateLine));
  const eras = $("eras");
  if (eras && typeof MutationObserver === "function") {
    new MutationObserver(() => refreshSlateLine()).observe(eras, { childList: true, subtree: true, attributes: true });
  }
  const tray = $("tray-pins");
  if (tray && typeof MutationObserver === "function") {
    new MutationObserver(() => refreshSlateLine()).observe(tray, { childList: true, subtree: true });
  }
  const cats = $("cats");
  if (cats && typeof MutationObserver === "function") {
    new MutationObserver(() => refreshSlateLine()).observe(cats, { attributes: true, subtree: true, attributeFilter: ["data-state", "data-ban"] });
  }
  refreshSlateLine();
  window.setTimeout(refreshSlateLine, 80);
  window.setTimeout(refreshSlateLine, 400);
}

/** 把既有 .warn 收成可展開「哪裡打架」；不改因果文案。 */
function enhanceCard(card) {
  if (!(card instanceof HTMLElement) || !card.classList.contains("card")) return;
  const meta = card.querySelector(".meta");
  if (!meta) return;

  const warns = [...meta.querySelectorAll(":scope > .warn")];
  if (!warns.length) {
    ensureSameSeedBtn(card);
    return;
  }

  let box = meta.querySelector(":scope > .clash-box");
  if (!box) {
    box = document.createElement("details");
    box.className = "clash-box";
    const sum = document.createElement("summary");
    sum.className = "clash-sum";
    box.append(sum);
    const body = document.createElement("div");
    body.className = "clash-body";
    box.append(body);
    meta.append(box);
  }
  const sum = box.querySelector(".clash-sum");
  const body = box.querySelector(".clash-body");
  body.replaceChildren();

  const lines = warns.map((w) => (w.textContent || "").trim()).filter(Boolean);
  warns.forEach((w) => w.remove());

  if (!lines.length) {
    box.remove();
    return;
  }
  lines.sort((a, b) => clashSeverity(a) - clashSeverity(b));
  // 摘要最重一條；展開內文必須留齊，不吃掉較輕互斥。
  sum.textContent =
    lines.length === 1 ? `哪裡打架 · ${lines[0]}` : `哪裡打架 · ${lines[0]}（另有 ${lines.length - 1} 條）`;
  for (const line of lines) {
    const p = document.createElement("p");
    p.className = "clash-line";
    p.textContent = line;
    body.append(p);
  }
  void clashSummary;
  ensureSameSeedBtn(card);
}

function ensureSameSeedBtn(card) {
  const meta = card.querySelector(".meta");
  if (!meta) return;
  let btn = meta.querySelector(":scope > .same-seed");
  const hasSnap = !!(card.dataset.intentSnap && card.dataset.seed);
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost same-seed";
    meta.append(btn);
  }
  btn.textContent = "同種子重抽";
  btn.title = hasSnap
    ? "同一意圖快照＋同一 seed，驗規則穩不穩"
    : "這張沒留下場記，不能同種子重抽";
  btn.disabled = !hasSnap || !!card.classList.contains("is-gen");
  btn.setAttribute("aria-disabled", btn.disabled ? "true" : "false");
}

/** 分級牆／矛盾 pin 置頂；一般互斥靠後。 */
function clashSeverity(line) {
  const s = String(line || "");
  if (/分級牆|分級不/.test(s)) return 0;
  if (/並存不了|釘選互斥|矛盾/.test(s)) return 1;
  if (/必進|沒進圖|釘選/.test(s)) return 2;
  if (/互斥|打架/.test(s)) return 3;
  return 4;
}

function watchResults() {
  const root = $("results");
  if (!root || typeof MutationObserver !== "function") return;
  let scheduled = false;
  const run = () => {
    scheduled = false;
    for (const card of root.querySelectorAll(".card")) enhanceCard(card);
  };
  const kick = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(run);
  };
  new MutationObserver(kick).observe(root, { childList: true, subtree: true });
  run();
}

bindSheets();
bindSlateWatch();
watchResults();

/** 抽樣尚未出卡時，成片區只標「場記中」——不准假骨架。 */
function syncSlating() {
  const go = $("go");
  const results = $("results");
  if (!go || !results) return;
  const busy = go.getAttribute("aria-busy") === "true" || go.disabled;
  const hasCard = !!results.querySelector(".card");
  results.classList.toggle("is-slating", busy && !hasCard);
  if (busy && !hasCard) {
    results.dataset.slate = "場記中";
  } else {
    delete results.dataset.slate;
  }
}

function watchSlating() {
  const go = $("go");
  if (!go || typeof MutationObserver !== "function") return;
  const kick = () => queueMicrotask(syncSlating);
  new MutationObserver(kick).observe(go, { attributes: true, attributeFilter: ["aria-busy", "disabled"] });
  const results = $("results");
  if (results) new MutationObserver(kick).observe(results, { childList: true });
  syncSlating();
}

watchSlating();

function latestDoneCard() {
  const cards = [...document.querySelectorAll("#results .card.is-done")];
  return cards.length ? cards[cards.length - 1] : null;
}

async function copyLastPos() {
  const card = latestDoneCard();
  const pos = card?.dataset?.positive || "";
  if (!pos) {
    const status = $("status");
    if (status) status.textContent = "還沒有可拷的 POS";
    return;
  }
  await navigator.clipboard.writeText(pos);
  const status = $("status");
  if (status) status.textContent = "已拷貝 POS";
}

function openLastShot() {
  const card = latestDoneCard();
  const shot = card?.querySelector(".shot");
  if (!shot) {
    const status = $("status");
    if (status) status.textContent = "還沒有成片可放大";
    return;
  }
  shot.click();
}

function bindStageTools() {
  $("copy-last-pos")?.addEventListener("click", () => {
    copyLastPos().catch(() => {});
  });
  $("open-last-shot")?.addEventListener("click", openLastShot);
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
    if (e.key.toLowerCase() !== "c") return;
    e.preventDefault();
    copyLastPos().catch(() => {});
  });
}

bindStageTools();


function bindCancelClear() {
  const cancel = $("cancel");
  if (!cancel) return;
  cancel.addEventListener("click", () => {
    const results = $("results");
    if (!results) return;
    // 立刻拿掉場記中，不留幽靈字
    results.classList.remove("is-slating");
    delete results.dataset.slate;
  });
}
bindCancelClear();
