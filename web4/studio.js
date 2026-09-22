/** 導影台殼層：場記條＋釘選台／詞庫 sheet。不碰 engine／drawOne。 */
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
  // eras 是 boot 動態填的
  const eras = $("eras");
  if (eras && typeof MutationObserver === "function") {
    new MutationObserver(() => refreshSlateLine()).observe(eras, { childList: true, subtree: true, attributes: true });
  }
  refreshSlateLine();
  // boot 套完 localStorage 後再刷一次
  window.setTimeout(refreshSlateLine, 80);
  window.setTimeout(refreshSlateLine, 400);
}

bindSheets();
bindSlateWatch();
