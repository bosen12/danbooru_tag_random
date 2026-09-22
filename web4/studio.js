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

export function refreshSlateLine() {
  const line = $("slate-line");
  if (!line) return;
  const bits = [currentRating(), currentHeats(), currentEra(), currentCast(), currentMode()].filter(Boolean);
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
    // 若已有 clash-box 但 warn 被搬空過，不動
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
  sum.textContent = lines.length === 1 ? `哪裡打架 · ${lines[0]}` : `哪裡打架 · ${lines.length} 條`;
  for (const line of lines) {
    const p = document.createElement("p");
    p.className = "clash-line";
    // 若之後有 reason 物件可走 clashSummary；現況沿用 boot 算出的棚內句子
    p.textContent = line;
    body.append(p);
  }
  // keep import used for future structured events
  void clashSummary;
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
