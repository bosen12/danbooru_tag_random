import {
  applyBan,
  applyPin,
  applyClear,
  ownedTagSet,
  snapshotPresetOwned,
  sanitizePresetOwned,
  prunePresetOwned,
  autoBannedFromPins,
  cycleTag,
  defaultSettings,
  drawOne,
  sceneModeOf,
  RATINGS,
  RATING_LABEL,
  identityPins,
  identityBans,
  isIdentityItem,
  QUOTA_SECTIONS,
  sanitizeSettings,
  HEATS,
  MIXED_HEATS,
  toggleHeat,
  heatPresetOf,
  weightsForHeats,
  ERAS,
  ERA_LABELS,
  eraMismatches,
  heatMismatches,
  handUsageWarnings,
  itemFitsHeats,
  FEMALE_COUNT,
  indexLexicon,
  labelOf,
  MALE_COUNT,
  pinMissLine,
  clashLine,
  knownTags,
  mulberry32,
  applyTagWeights,
  stepTagWeight,
  clampTagWeight,
  TAG_WEIGHT_PRESETS,
  parseWeighted,
  formatWeighted,
  formatWeight,
  insertTriggerAfterCast,
  escapeForComfy,
  jobFields,
  settleGenCard,
  randomSeed,
  tagState,
  BUILTIN_PRESETS,
  sanitizePinPresets,
  addPinPreset,
  PIN_PRESET_LIMIT,
  presetState,
  sportHeatWarnings,
  sportPinWarnings,
  sportPlacePinWarnings,
  toggleNamedPreset,
} from "./engine.js";
import {
  applyRecipeModels,
  currentCkpt,
  currentLorasPayload,
  currentTriggerText,
  handleLoraKeys,
  initLoraPicker,
  isLoraUiOpen,
} from "./lora.js";
import {
  beginRound,
  clearLive,
  countMade,
  initInfinite,
  isInfinite,
  markLive,
  placeCard,
  stopInfinite,
  resetWall,
  wallHasCards,
} from "./infinite.js";
import { initTelegram, tgHandleKeys, tgSendCard, tgUiOpen } from "./telegram.js";
import { initDiscord, dcHandleKeys, dcSendCard, dcUiOpen } from "./discord.js";
import { initServiceSettings } from "./service-settings.js";
import { applyWorkflowId, currentWorkflowId, initWorkflow, wfHandleKeys, workflowUiOpen } from "./workflow.js";
import { albumHandleKeys, ensureFavButton, initAlbum, paintFavButton, paintWhy } from "./album.js";
import { createCommands } from "./commands.js";
import { traceSummaryForRecipe } from "./trace.js";
import {
  clearAllMustDraw,
  initMustDraw,
  mustShortfall,
  mustStepper,
  syncMustDraw,
} from "./mustdraw.js";
import { drawWithSeed } from "./draw-with-seed.js";

const SECTIONS = [
  { id: "quality", title: "畫質與風格", hint: "固定畫質每張都帶。風格預設不進，釘了才進" },
  { id: "subject", title: "人數", hint: "跟左欄走。只開女就不會看到男生的字" },
  { id: "feature", title: "長相", hint: "髮、眼、身材。有男時可抽種族，同類只一個" },
  { id: "pose", title: "姿勢", hint: "先身體和鏡頭。活動／誘惑／走光會抽一格活動；性愛補體位、不抽逛街開車" },
  { id: "clothing", title: "服裝", hint: "時代服裝分開。顏色變體靠在父類旁邊" },
  { id: "env", title: "場景", hint: "先室內外、晝夜、地點" },
];

// 只列真的吃這個數字的段，清單由 engine.js 的 QUOTA_SECTIONS 決定 —— 主體段是
// 卡司，由 chooseCast 管，以前在這裡多畫了一個怎麼調都沒反應的輸入框。
const COUNT_LABELS = {
  feature: "特徵",
  pose: "姿勢",
  clothing: "服裝",
  env: "場＋光",
};

import { lockScroll, unlockScroll } from "./scroll-lock.js";
const STORE = "tag-case-v1";
const SPACE_RE = new RegExp(String.fromCharCode(92) + "s+");

let lex;
let tokenTable = null;
let settings;
let pinned = new Set();
let userBanned = new Set();
let tagWeights = new Map();
let aborting = false;
let skipping = false;
let running = false;
// 連續失敗幾張就把無限抽收掉。成功一張歸零。
const FAIL_LIMIT = 3;
let failStreak = 0;
// 伺服器在等 Comfy 的時候每 5 秒送一則心跳，所以這條 SSE 靜默這麼久就是死了。
// 留寬一點是因為換底模那下可以整整安靜一分鐘。
// 由 config.json 的 client.streamIdleMs 覆寫（透過 /api/ping 帶下來）。
let STREAM_IDLE_MS = 90000;
let genSampler = { sampler: "", scheduler: "", steps: 25, cfg: 6.5 };
// /api/ping 走到底也只要八秒（伺服器那邊對 Comfy 的 timeout 就是 8）。
const PING_TIMEOUT_MS = 10000;
// 被取消／停過之後，下一次按抽圖要把八格牆先清掉重來，不要跟上一輪的殘局混在一起。
let wallStale = false;
let lastJobError = "";
let genAbort = null;
let jobAbort = null;
let redoQueue = [];
let viewMode = "all";
let eraOnly = true;
let lastPositive = "";
const btnByTag = new Map();
let catDomIndex = { rows: [], families: [], subs: [], cats: [] };
const userOpen = new Set(["sec-quality"]);
let lastIdent = new Set();
let paintPrev = { pin: new Set(), auto: new Set(), user: new Set() };
let userPresets = [];
let presetOwned = null;

const $ = (id) => document.getElementById(id);

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "{}");
  } catch {
    return {};
  }
}

function saveStore() {
  localStorage.setItem(
    STORE,
    JSON.stringify({
      settings,
      pinned: [...pinned],
      userBanned: [...userBanned],
      tagWeights: Object.fromEntries(tagWeights),
      pinPresets: userPresets,
      presetOwned,
    })
  );
}

function speak(text) {
  $("live").textContent = text;
  $("status").textContent = text;
}

// 沒接住的錯誤以前是完全靜默的：畫面凍住、按鈕一直轉，什麼線索都不留。
// 至少要讓狀態列講一句，主控台留一份完整堆疊。
function reportCrash(where, err) {
  try {
    console.error(`[${where}]`, err);
  } catch {
    /* ignore */
  }
  const msg = String((err && (err.message || err.reason || err)) || "未知錯誤");
  try {
    speak(`${where}：${msg.split(/[\r\n]/)[0].slice(0, 160)}`);
  } catch {
    /* ignore */
  }
}

function watchForCrashes() {
  window.addEventListener("error", (e) => reportCrash("頁面出錯", e.error || e.message));
  window.addEventListener("unhandledrejection", (e) => reportCrash("背景工作出錯", e.reason));
}

// 有逾時的 Comfy 探活。原本用的是沒有上限的 fetch —— 伺服器一卡住，抽圖就停在
// 第一行 await，按鈕轉圈、連一張卡片都還沒建出來。
async function comfyUp() {
  try {
    const r = await fetch("/api/ping", { signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
    const j = await r.json();
    return !!j.ok;
  } catch {
    return false;
  }
}

async function ping() {
  const el = $("ping");
  try {
    const r = await fetch("/api/ping", { signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
    const j = await r.json();
    if (Number(j.streamIdleMs) > 0) STREAM_IDLE_MS = Number(j.streamIdleMs);
    if (j.sampler) genSampler.sampler = j.sampler;
    if (j.scheduler) genSampler.scheduler = j.scheduler;
    if (Number(j.steps) > 0) genSampler.steps = Number(j.steps);
    if (Number(j.cfg) > 0) genSampler.cfg = Number(j.cfg);
    el.dataset.ok = j.ok ? "1" : "0";
    el.querySelector("span").textContent = j.ok
      ? `Comfy ${j.version || "ok"}`
      : "Comfy 未連上";
  } catch {
    el.dataset.ok = "0";
    el.querySelector("span").textContent = "Comfy 未連上";
  }
}

function renderCounts() {
  const box = $("counts");
  box.replaceChildren();
  for (const key of QUOTA_SECTIONS) {
    const label = COUNT_LABELS[key] || key;
    const lab = document.createElement("span");
    lab.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "10";
    input.value = String(settings.counts[key] ?? 0);
    input.addEventListener("change", () => {
      settings.counts[key] = Math.max(0, Math.min(10, Number(input.value) || 0));
      saveStore();
    });
    const off = document.createElement("button");
    off.type = "button";
    off.className = "ghost mini";
    off.textContent = "不補";
    off.title = `${label}不額外補牌，必要骨架仍保留`;
    off.setAttribute("aria-label", `${label}不額外補牌`);
    off.addEventListener("click", () => {
      settings.counts[key] = 0;
      input.value = "0";
      saveStore();
    });
    box.append(lab, input, off);
  }
}

function syncSizeButtons() {
  for (const btn of $("sizes").querySelectorAll(".seg")) {
    const on =
      Number(btn.dataset.w) === settings.width &&
      Number(btn.dataset.h) === settings.height;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  $("width").value = String(settings.width);
  $("height").value = String(settings.height);
}

function renderEras() {
  const box = $("eras");
  box.replaceChildren();
  const exclusive = settings.eras.length === 1;
  const mix = document.createElement("button");
  mix.type = "button";
  mix.className = "chip-toggle";
  mix.textContent = "混合";
  mix.setAttribute("aria-pressed", exclusive ? "false" : "true");
  mix.addEventListener("click", () => {
    settings.eras = [...ERAS];
    saveStore();
    renderEras();
    renderCats("filter");
  });
  box.append(mix);
  for (const era of ERAS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip-toggle";
    btn.dataset.era = era;
    btn.textContent = ERA_LABELS[era];
    btn.setAttribute("aria-pressed", exclusive && settings.eras[0] === era ? "true" : "false");
    btn.addEventListener("click", () => {
      settings.eras = [era];
      saveStore();
      renderEras();
      renderCats("filter");
    });
    box.append(btn);
  }
  updateEraClash();
}

const HEAT_LABELS = { activity: "活動", tease: "誘惑", flash: "走光", sex: "性愛" };

// 分級滑桿會把某些尺度整個擋掉，但面板上完全看不出來。
// 實測（每格 400 張）：全年齡 + 走光 -> 情色內容 0%；全年齡 + 性愛 -> 0%。
// 使用者勾了卻一張都抽不到，而且沒有任何提示 —— 這是我加三段滑桿時漏掉的一塊，
// 舊的布林開關其實也有，只是三段之後更容易踩到。
const RATING_BLOCKS_HEAT = { general: ["flash", "sex"], sensitive: [], explicit: [] };

function ratingHeatClash() {
  const rating = RATINGS.includes(settings.rating) ? settings.rating : "explicit";
  const blocked = RATING_BLOCKS_HEAT[rating] || [];
  return (settings.heats || []).filter((h) => blocked.includes(h));
}

/**
 * 三條警告（角色／尺度／時代）的顯示與收合。
 *
 * 本來是 note.hidden 直接切 —— display:none 沒有過場，一條兩三行的警告
 * 一出現就把底下整條側欄往下推四五十像素，消失時又彈回去。改成跟釘選匣
 * 同一個模式（.tray 的 grid-template-rows: 0fr -> 1fr），高度自己長出來。
 *
 * 文字掛在裡面的 <span>，因為 0fr 的格子要有個能設 overflow:hidden 的子元素
 * 才裁得掉。收合時不清掉文字（清掉就沒東西可以收），改用 aria-hidden 讓
 * 螢幕閱讀器跳過 —— 不然收起來的舊警告還會被念出來。
 */
function clashBox(note) {
  let box = note.firstElementChild;
  if (!box) {
    box = document.createElement("span");
    note.append(box);
  }
  return box;
}

function showClash(note) {
  note.hidden = false;
  note.classList.add("is-on");
  note.setAttribute("aria-hidden", "false");
}

function hideClash(note) {
  note.hidden = false;
  note.classList.remove("is-on");
  note.setAttribute("aria-hidden", "true");
}

function updateHeatClash() {
  const note = $("heat-clash");
  if (!note) return;
  const ratingHit = ratingHeatClash();
  if (ratingHit.length) {
    showClash(note);
    clashBox(note).textContent =
      "分級選了「" +
      (RATING_LABEL[settings.rating] || settings.rating) +
      "」，但尺度勾了「" +
      ratingHit.map((h) => HEAT_LABELS[h] || h).join("、") +
      "」。這一級不會出現那種內容，這些尺度等於沒作用 —— 把分級往右拉，或改勾別的尺度。";
    return;
  }
  const sexBlock = sportHeatWarnings(lex, pinned, settings.heats);
  if (sexBlock.length) {
    showClash(note);
    clashBox(note).textContent =
      "你釘了「" +
      sexBlock[0].tags.map((t) => labelOf(lex, t)).join("、") +
      "」，這種活動跟性愛動作不能並存，所以這張抽不到性愛。把它從「必進這張圖」點掉就會有。";
    return;
  }
  const handBlock = handUsageWarnings(pinned);
  if (handBlock.length) {
    showClash(note);
    clashBox(note).textContent =
      "你同時釘了「" +
      handBlock[0].tags.map((t) => labelOf(lex, t)).join("、") +
      "」；拳擊手套會妨礙需要靈活手指的動作。明確釘選會保留，但建議拿掉其中一邊。";
    return;
  }
  const sportBlock = sportPinWarnings(lex, pinned);
  if (sportBlock.length) {
    showClash(note);
    clashBox(note).textContent =
      "你同時釘了「" +
      sportBlock[0].tags.map((t) => labelOf(lex, t)).join("、") +
      "」，它們屬於互斥的運動。明確釘選會保留，但自動抽牌不會再補衝突運動。";
    return;
  }
  const placeBlock = sportPlacePinWarnings(lex, pinned, settings);
  if (placeBlock.length) {
    showClash(note);
    clashBox(note).textContent =
      "你同時釘了「" +
      placeBlock[0].tags.map((t) => labelOf(lex, t)).join("、") +
      "」，運動器材／活動跟場地不相容。明確釘選會保留；可拿掉其中一邊，或切到奇葩模式。";
    return;
  }
  const clash = heatMismatches(lex, pinned, settings.heats);
  if (clash.length) {
    const scale = (settings.heats || []).map((h) => HEAT_LABELS[h] || h).join("／");
    showClash(note);
    clashBox(note).textContent =
      "你釘了「" +
      clash.map((t) => labelOf(lex, t)).join("、") +
      "」，尺度對不上（現在只開" +
      scale +
      "）。衣服仍會進圖，這張還是走你勾的尺度。";
  } else {
    hideClash(note);
  }
}

function updateEraClash() {
  const note = $("era-clash");
  if (!note) return;
  const era = exclusiveEra();
  const clash = era ? eraMismatches(lex, pinned, era) : [];
  if (clash.length) {
    showClash(note);
    clashBox(note).textContent =
      "你釘的「" +
      clash.map((t) => labelOf(lex, t)).join("、") +
      "」不是" +
      (ERA_LABELS[era] || era) +
      "的衣服。這張仍走" +
      (ERA_LABELS[era] || era) +
      "場景，釘選也會留在圖裡。";
  } else {
    hideClash(note);
  }
}

function identitySummary(ident) {
  if (!ident || !ident.size) return "";
  const skip = /pubic|leg hair/;
  const bits = [];
  const seen = new Set();
  for (const t of ident) {
    if (skip.test(t) || t === "colored inner hair") continue;
    const it = lex.byTag.get(t);
    if (!isIdentityItem(it)) continue;
    const lab = labelOf(lex, t);
    if (!lab || seen.has(lab)) continue;
    seen.add(lab);
    bits.push(lab);
    if (bits.length >= 5) break;
  }
  return bits.join(" · ");
}

function syncSamePerson() {
  const btn = $("same-person");
  if (!btn) return;
  const on = !!settings.samePerson;
  btn.classList.toggle("is-on", on);
  btn.setAttribute("aria-checked", on ? "true" : "false");
  const hint = $("same-person-hint");
  if (!hint) return;
  const n = Math.max(1, Number(($("n") && $("n").value) || settings.n) || 1);
  if (!on) hint.textContent = "多張鎖髮瞳胸，衣場照抽";
  else if (n < 2) hint.textContent = "已開。抽 2 張以上才會鎖臉";
  else if (lastIdent.size) {
    const sum = identitySummary(lastIdent);
    hint.textContent = sum ? "這批鎖：" + sum : "第 1 張定臉，後面跟著";
  } else hint.textContent = "第 1 張定臉，後面跟著";
}

function syncHeat() {
  const box = $("heats");
  if (!box) return;
  const on = new Set(settings.heats || []);
  const all = MIXED_HEATS.every((h) => on.has(h)) && !on.has("activity");
  for (const btn of box.querySelectorAll(".chip-toggle")) {
    const h = btn.dataset.heat;
    const pressed = h === "mixed" ? all : on.has(h);
    btn.setAttribute("aria-pressed", pressed ? "true" : "false");
  }
  updateHeatClash();
}

function syncDrawJob() {
  const btn = $("draw-job");
  if (!btn) return;
  btn.setAttribute("aria-pressed", settings.drawJob ? "true" : "false");
}

function syncSceneMode() {
  const mode = sceneModeOf(settings);
  document.querySelectorAll("[data-scene-mode]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.dataset.sceneMode === mode ? "true" : "false");
  });
}

// aria-pressed 有三態：整套都在是 true、完全沒有是 false、只剩一部分是 mixed。
// mixed 的時候再按一次會把缺的補回來。
function paintPresetBtn(btn, tags, core) {
  const state = presetState(lex, tags, pinned, core);
  btn.setAttribute("aria-pressed", state === "on" ? "true" : state === "mixed" ? "mixed" : "false");
  btn.classList.toggle("is-mixed", state === "mixed");
  if (state === "mixed") btn.title = "只剩一部分，按一下補齊整套";
  else btn.removeAttribute("title");
}

function presetWithCurrentOptions(p) {
  if (!p?.sport || !settings.pinSportActivity || !p.activity) return p;
  return { ...p, tags: [...new Set([p.activity, ...p.tags])] };
}

function makePresetBtn(p) {
  const live = presetWithCurrentOptions(p);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "chip-toggle";
  btn.dataset.preset = p.id;
  btn.textContent = p.name;
  paintPresetBtn(btn, live.tags, live.core);
  return btn;
}

function renderPresets() {
  const box = $("presets");
  if (!box || !lex) return;
  const frag = document.createDocumentFragment();
  for (const p of BUILTIN_PRESETS) {
    if (p.sport) continue;
    frag.append(makePresetBtn(p));
  }
  // 運動有 13 個，自己一組並且可以換行，不然左欄會被擠爆。
  const sports = BUILTIN_PRESETS.filter((p) => p.sport);
  if (sports.length) {
    const group = document.createElement("div");
    group.className = "preset-group";
    const label = document.createElement("span");
    label.className = "preset-group-label";
    label.id = "preset-group-sport";
    label.textContent = "運動";
    const head = document.createElement("div");
    head.className = "preset-group-head";
    const activityToggle = document.createElement("button");
    activityToggle.type = "button";
    activityToggle.id = "pin-sport-activity";
    activityToggle.className = "chip-toggle preset-option";
    activityToggle.setAttribute("aria-pressed", settings.pinSportActivity ? "true" : "false");
    activityToggle.title = "開啟後，運動動作也會和場地、器材、服裝一起加入必進 POS";
    activityToggle.textContent = "動作也必進";
    head.append(label, activityToggle);
    const row = document.createElement("div");
    row.className = "preset-group-row";
    row.setAttribute("role", "group");
    row.setAttribute("aria-labelledby", label.id);
    for (const p of sports) row.append(makePresetBtn(p));
    group.append(head, row);
    frag.append(group);
  }
  userPresets.forEach((p, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip-toggle preset-user";
    btn.dataset.user = String(i);
    paintPresetBtn(btn, p.tags);
    btn.append(document.createTextNode(p.name));
    const x = document.createElement("span");
    x.className = "preset-x";
    x.setAttribute("aria-label", "刪除");
    x.textContent = "×";
    btn.append(x);
    frag.append(btn);
  });
  box.replaceChildren(frag);
}

function syncPresets() {
  const box = $("presets");
  if (!box || !lex) return;
  for (const btn of box.querySelectorAll("[data-preset]")) {
    const p = BUILTIN_PRESETS.find((x) => x.id === btn.dataset.preset);
    if (p) {
      const live = presetWithCurrentOptions(p);
      paintPresetBtn(btn, live.tags, live.core);
    }
    else btn.setAttribute("aria-pressed", "false");
  }
  for (const btn of box.querySelectorAll("[data-user]")) {
    const i = Number(btn.dataset.user);
    const p = userPresets[i];
    if (p) paintPresetBtn(btn, p.tags);
    else btn.setAttribute("aria-pressed", "false");
  }
}

function userPresetId(p) {
  return `user:${p.name}\u0000${p.tags.join("\u0000")}`;
}

function applyNamedPreset(preset) {
  const next = toggleNamedPreset(lex, preset, pinned, presetOwned);
  pinned = next.pinned;
  presetOwned = next.presetOwned;
  // 時代組合要把時代一起套進去。單一時代是使用者的硬選擇，會贏過有衝突的釘選
  // （契約見 engine.js 的 chooseEra()），所以光釘「武士」是不夠的 ——
  // 不套時代就會畫出現代廚房裡的武士。取消組合時不動時代，使用者自己改回去。
  if (next.action !== "removed" && Array.isArray(preset.era) && preset.era.length) {
    const want = preset.era.filter((e) => ERAS.includes(e));
    if (want.length) {
      settings.eras = want;
      saveStore();
      renderEras();
      renderCats("filter");
    }
  }
  afterPin();
  if (next.action === "removed") speak("已取消釘選組合");
  else if (next.action === "completed") speak("已補齊整套");
  else if (next.action === "protected") speak("這套是舊存檔或手動釘選，為避免誤刪請從必進區個別移除");
  else speak("已套用釘選組合");
}

const RATING_HINT = {
  general: "全年齡：連暗示都沒有。情色的字整批抽不到，nsfw／explicit 在負面。",
  sensitive: "敏感：性感但不露點、不做愛、不穿內衣外出、不走光。",
  explicit: "色情：現狀，什麼都抽得到。",
};

function ratingButtons() {
  return [...document.querySelectorAll(".segmented-btn[data-rating]")];
}

// 把會滑動的色塊挪到目前選中的那一顆底下。位置用 offsetLeft／offsetWidth 量，
// 寫進 CSS 變數讓 ::before 自己去過渡（見 boot.css）。
function moveRatingThumb() {
  const group = $("rating");
  if (!group) return;
  const on = group.querySelector('.segmented-btn[aria-current="true"]');
  if (!on) return;
  const item = on.closest(".segmented-item") || on;
  // 量不到（面板收起來、還沒排版）就先不要動，免得把色塊縮成 0 寬再彈開。
  if (!item.offsetWidth) return;
  group.style.setProperty("--thumb-x", `${item.offsetLeft}px`);
  group.style.setProperty("--thumb-w", `${item.offsetWidth}px`);
  // 第一次量完才開過渡，否則載入時色塊會從左邊滑進來。
  if (!group.classList.contains("is-ready")) {
    // 先讓這一幀把位置畫出去，下一幀再允許過渡。
    requestAnimationFrame(() => group.classList.add("is-ready"));
  }
}

function syncRating() {
  const cur = RATINGS.includes(settings.rating) ? settings.rating : "explicit";
  for (const btn of ratingButtons()) {
    const on = btn.dataset.rating === cur;
    btn.setAttribute("aria-current", on ? "true" : "false");
    // roving tabindex：整組只佔一個 Tab 停點，組內用方向鍵移動。
    // 三個按鈕各自可 Tab 的話，鍵盤使用者要按三次才能離開這一個設定。
    btn.tabIndex = on ? 0 : -1;
  }
  moveRatingThumb();
  const hint = $("rating-hint");
  if (hint) hint.textContent = RATING_HINT[cur] || "";
}

function setRating(next, { speakIt = true } = {}) {
  if (!RATINGS.includes(next) || next === settings.rating) {
    syncRating();
    return;
  }
  settings.rating = next;
  // 分級會影響尺度提示（全年齡擋掉走光／性愛），改完要重算。
  updateHeatClash();
  saveStore();
  syncRating();
  // 能抽的字整批變了，詞庫面板要重畫。淡入由 renderCats("filter") 那條路
  // 走 playCatsSwap()，跟時代／角色／檢視切換是同一個過場 —— 這裡本來有一段
  // 自己的 .rating-changed 淡入，兩層疊起來會相乘，所以收掉了。
  renderCats("filter");
  if (speakIt) speak(`尺度：${RATING_LABEL[next]}`);
}

function pickHeat(h) {
  const next = toggleHeat(settings.heats, h);
  settings.heats = next;
  settings.heatPreset = heatPresetOf(next);
  settings.weights = weightsForHeats(next, lex.data.heatWeights);
  syncHeat();
  saveStore();
  syncPresets();
  renderCats("heat");
}

function tagsBanned(tags) {
  return tags.length > 0 && tags.every((t) => userBanned.has(t));
}

function toggleBanTags(tags) {
  if (!tags.length) return;
  if (tagsBanned(tags)) {
    for (const t of tags) {
      const next = applyClear(pinned, userBanned, t);
      pinned = next.pinned;
      userBanned = next.userBanned;
    }
  } else {
    for (const t of tags) {
      const next = applyBan(lex, pinned, userBanned, t);
      pinned = next.pinned;
      userBanned = next.userBanned;
    }
  }
  afterPin();
}

function closeAllBtn(label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ghost mini";
  btn.dataset.close = "1";
  btn.textContent = "關閉全部";
  btn.setAttribute("aria-label", `關閉全部：${label}`);
  return btn;
}

function exclusiveEra() {
  return settings.eras && settings.eras.length === 1 ? settings.eras[0] : null;
}

function exclusiveCast() {
  if (settings.girl && !settings.boy) return "female";
  if (settings.boy && !settings.girl) return "male";
  return null;
}

function fitsCast(item) {
  const ex = exclusiveCast();
  if (!ex) return true;
  if (item.gate && item.gate !== "any" && item.gate !== ex) return false;
  const needs = item.needs || [];
  if (ex === "female" && needs.includes("male")) return false;
  if (ex === "male" && needs.includes("female")) return false;
  return true;
}

function syncCast() {
  const ex = exclusiveCast();
  $("girl").setAttribute("aria-pressed", ex === "female" ? "true" : "false");
  $("boy").setAttribute("aria-pressed", ex === "male" ? "true" : "false");
  const any = $("cast-any");
  if (any) any.setAttribute("aria-pressed", ex ? "false" : "true");
  const note = $("cast-clash");
  if (!note) return;
  const clash = [];
  for (const t of pinned) {
    const it = lex.byTag.get(t);
    if (!it) continue;
    if (ex === "female" && (it.gate === "male" || (it.needs || []).includes("male") || MALE_COUNT.has(t))) {
      clash.push(t);
    }
    if (ex === "male" && (it.gate === "female" || (it.needs || []).includes("female") || FEMALE_COUNT.has(t))) {
      clash.push(t);
    }
  }
  if (clash.length) {
    showClash(note);
    clashBox(note).textContent =
      "你釘了「" +
      clash.map((t) => labelOf(lex, t)).join("、") +
      "」，左欄雖只開" +
      (ex === "female" ? "女" : "男") +
      "，這些仍會進圖。";
  } else {
    hideClash(note);
  }
}

function fitsEra(item) {
  const era = exclusiveEra();
  if (!era) return true;
  const e = item.era;
  if (!e || !e.length || e.includes("any")) return true;
  return e.includes(era);
}

function fitsHeat(item) {
  return itemFitsHeats(item, settings.heats);
}

function sortItems(list) {
  return list.slice().sort((a, b) => {
    const wa = a.tag.split(" ").length;
    const wb = b.tag.split(" ").length;
    if (wa !== wb) return wa - wb;
    const za = a.zh || labelOf(lex, a.tag);
    const zb = b.zh || labelOf(lex, b.tag);
    return za.localeCompare(zb, "zh-Hant");
  });
}

const COLOR_WORD = new Set([
  "white",
  "black",
  "blue",
  "green",
  "red",
  "pink",
  "purple",
  "brown",
  "aqua",
  "orange",
  "yellow",
  "grey",
  "gray",
]);

function parentKey(item, inSet) {
  if (item.section !== "clothing") return null;
  const okParent = (p) => {
    const parent = lex.byTag.get(p);
    if (!parent || parent.section !== "clothing") return false;
    if (item.mutex && parent.mutex && parent.mutex === item.mutex) return false;
    return true;
  };
  const parts = String(item.tag || "").split(" ");
  if (parts.length >= 2 && COLOR_WORD.has(parts[0])) {
    const rest = parts.slice(1).join(" ");
    if (inSet.has(rest) && okParent(rest)) return rest;
  }
  const implied = (item.implies || []).filter((p) => inSet.has(p) && p !== item.tag && okParent(p));
  if (implied.length) {
    implied.sort((a, b) => b.length - a.length);
    return implied[0];
  }
  return null;
}

function clusterItems(list, auto) {
  const inSet = new Set(list.map((i) => i.tag));
  const parentOf = new Map();
  for (const item of list) {
    const p = parentKey(item, inSet);
    if (p) parentOf.set(item.tag, p);
  }
  const rootOf = (tag) => {
    let cur = tag;
    const seen = new Set();
    while (parentOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = parentOf.get(cur);
    }
    return cur;
  };
  const children = new Map();
  const roots = [];
  for (const item of list) {
    const r = rootOf(item.tag);
    if (r === item.tag) {
      roots.push(item);
      continue;
    }
    if (!children.has(r)) children.set(r, []);
    children.get(r).push(item);
  }
  for (const [p, kids] of children) children.set(p, sortItems(kids));
  return { roots, children };
}

function isFixedTag(tag) {
  if (!lex) return true;
  if ((lex.data.quality || []).includes(tag)) return true;
  if ((lex.data.alwaysEnv || []).includes(tag)) return true;
  if ((lex.data.nsfwTail || []).includes(tag)) return true;
  return !lex.byTag.has(tag);
}

function showPos(positive) {
  lastPositive = String(positive || "").trim();
  renderTray();
}

function tagWeightOf(tag) {
  const w = Number(tagWeights.get(tag));
  return Number.isFinite(w) && w > 0 ? Math.round(w * 10) / 10 : 1;
}

function ensureWeightFlag(el) {
  el.querySelector(":scope > .w-ctl")?.remove();
  let flag = el.querySelector(":scope > .w-flag");
  if (!flag) {
    flag = document.createElement("span");
    flag.className = "w-flag";
    flag.setAttribute("role", "button");
    flag.setAttribute("aria-haspopup", "dialog");
    el.append(flag);
  }
  return flag;
}

function paintWeightMark(el, tag) {
  const w = tagWeightOf(tag);
  const shown = formatWeighted(tag, w);
  el.dataset.en = shown;
  const flag = ensureWeightFlag(el);
  const shownW = formatWeight(w);
  flag.textContent = shownW;
  flag.setAttribute("aria-label", `調整權重，目前 ${shownW}`);
  flag.title = `權重 ${shownW} · 點開調整`;
  if (w === 1) {
    if (el.dataset.weight) delete el.dataset.weight;
  } else {
    el.dataset.weight = shownW;
  }
  const base = isFixedTag(tag) ? tag : "點文字釘選／關掉";
  el.title = `${base} · 點右上角數字調權重 · 目前 ${shownW}`;
}

let weightPopTag = "";
let weightPopAnchor = null;
// 從哪個字牌開的。彈窗裡的 ↑↓ ＋ − Esc 早就做好了，但關掉之後焦點掉在 body，
// 鍵盤使用者要從頭 Tab 回來 —— 大圖檢視器用 VIEW_RETURN 解過同一件事。
let weightPopReturn = null;

function ensureWeightPop() {
  let pop = $("w-pop");
  if (pop) return pop;
  pop = document.createElement("div");
  pop.id = "w-pop";
  pop.className = "w-pop";
  pop.tabIndex = -1;
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-hidden", "true");
  pop.setAttribute("aria-label", "調整權重");
  pop.innerHTML = `
    <div class="w-pop-kicker">權重</div>
    <div class="w-pop-name" id="w-pop-name"></div>
    <div class="w-pop-en" id="w-pop-en"></div>
    <div class="w-pop-meter">
      <button type="button" class="w-pop-step" data-w-step="-1" aria-label="降低 0.1">−</button>
      <div class="w-pop-val" id="w-pop-val" aria-live="polite">1.0</div>
      <button type="button" class="w-pop-step" data-w-step="1" aria-label="提高 0.1">+</button>
    </div>
    <div class="w-pop-presets" id="w-pop-presets"></div>
    <button type="button" class="w-pop-reset" id="w-pop-reset">恢復 1.0</button>`;
  const presets = pop.querySelector("#w-pop-presets");
  for (const p of TAG_WEIGHT_PRESETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "w-pop-preset";
    b.dataset.wSet = String(p);
    b.textContent = formatWeight(p);
    presets.appendChild(b);
  }
  pop.addEventListener("click", (e) => {
    e.stopPropagation();
    const tag = weightPopTag;
    if (!tag) return;
    const step = e.target.closest("[data-w-step]");
    if (step) {
      onTagWeight(tag, Number(step.dataset.wStep) < 0 ? -1 : 1);
      return;
    }
    const preset = e.target.closest("[data-w-set]");
    if (preset) {
      setTagWeight(tag, Number(preset.dataset.wSet));
      return;
    }
    if (e.target.closest("#w-pop-reset")) setTagWeight(tag, 1);
  });
  document.body.appendChild(pop);
  return pop;
}

function weightPopOpen() {
  const pop = $("w-pop");
  return !!(pop && pop.classList.contains("is-open"));
}

function paintWeightPop() {
  const pop = $("w-pop");
  if (!pop || !weightPopTag) return;
  const w = tagWeightOf(weightPopTag);
  const shownW = formatWeight(w);
  const name = $("w-pop-name");
  const en = $("w-pop-en");
  const val = $("w-pop-val");
  if (name) name.textContent = lex ? labelOf(lex, weightPopTag) : weightPopTag;
  if (en) en.textContent = weightPopTag;
  if (val) val.textContent = shownW;
  for (const b of pop.querySelectorAll("[data-w-set]")) {
    b.setAttribute("aria-pressed", Number(b.dataset.wSet) === w ? "true" : "false");
  }
  const reset = $("w-pop-reset");
  if (reset) reset.hidden = w === 1;
  if (weightPopAnchor) placeWeightPop(weightPopAnchor);
}

function placeWeightPop(anchor) {
  const pop = $("w-pop");
  if (!pop || !anchor) return;
  const r = anchor.getBoundingClientRect();
  const pad = 8;
  const dock = document.querySelector(".dock");
  const dockH = dock ? Math.ceil(dock.getBoundingClientRect().height) : 0;
  const pw = pop.offsetWidth || 220;
  const ph = pop.offsetHeight || 180;
  let left = r.right - pw;
  if (left < pad) left = r.left;
  if (left + pw > window.innerWidth - pad) left = window.innerWidth - pw - pad;
  const floor = window.innerHeight - pad - dockH;
  let top = r.bottom + 8;
  let origin = "top right";
  if (top + ph > floor) {
    top = r.top - ph - 8;
    origin = "bottom right";
  }
  if (top < pad) top = pad;
  pop.style.left = `${Math.max(pad, left)}px`;
  pop.style.top = `${top}px`;
  pop.style.transformOrigin = origin;
}

function openWeightPop(host) {
  const tag = host?.dataset?.tag;
  if (!tag) return;
  const pop = ensureWeightPop();
  document.querySelectorAll(".is-w-open").forEach((el) => el.classList.remove("is-w-open"));
  host.classList.add("is-w-open");
  weightPopTag = tag;
  weightPopReturn = host;
  weightPopAnchor = host.querySelector(":scope > .w-flag") || host;
  pop.setAttribute("aria-hidden", "false");
  paintWeightPop();
  placeWeightPop(weightPopAnchor);
  const open = () => {
    pop.classList.add("is-open");
    placeWeightPop(weightPopAnchor);
    pop.focus({ preventScroll: true });
  };
  if (reduceMotion()) open();
  else requestAnimationFrame(open);
}

// keepFocus：點到別處而關掉的那一條路要傳 true。pointerdown 比焦點移動早一步，
// 這時彈窗仍然持有焦點，照常還回字牌就等於把人從他正要點的地方拉回來。
function closeWeightPop({ keepFocus = false } = {}) {
  const pop = $("w-pop");
  if (!pop || !pop.classList.contains("is-open")) return;
  const back = weightPopReturn;
  const hadFocus = !keepFocus && pop.contains(document.activeElement);
  pop.classList.remove("is-open");
  pop.setAttribute("aria-hidden", "true");
  document.querySelectorAll(".is-w-open").forEach((el) => el.classList.remove("is-w-open"));
  weightPopTag = "";
  weightPopAnchor = null;
  weightPopReturn = null;
  if (hadFocus && back && back.isConnected && back.focus) back.focus({ preventScroll: true });
}

function paintTrayChip(btn, tag, auto) {
  const raw = parseWeighted(tag).tag;
  btn.dataset.tag = raw;
  let lab = btn.querySelector(":scope > .label");
  if (!lab) {
    lab = document.createElement("span");
    lab.className = "label";
    btn.prepend(lab);
  }
  lab.textContent = labelOf(lex, raw);
  if (isFixedTag(raw)) {
    btn.dataset.state = "pinned";
    btn.dataset.locked = "1";
    delete btn.dataset.ban;
    paintWeightMark(btn, raw);
    return;
  }
  delete btn.dataset.locked;
  const st = tagState(raw, pinned, userBanned, auto);
  btn.dataset.state = st;
  if (st === "banned") btn.dataset.ban = auto.has(raw) && !userBanned.has(raw) ? "mutex" : "user";
  else delete btn.dataset.ban;
  paintWeightMark(btn, raw);
}

// 複製的確認。原本這段六行邏輯在四個地方各抄了一次，而且都只換文字不換樣子；
// 連點兩下還會提早還原、把按鈕留在錯的字上（第二次的 timeout 蓋不掉第一次的）。
// 這裡順手把那兩件事一起收掉：記住原本的字、每次重設計時器、加上看得見的確認。
function confirmCopy(btn, ms = 1200) {
  if (!btn) return;
  const back = btn.dataset.copyLabel || btn.textContent;
  btn.dataset.copyLabel = back;
  btn.textContent = "已複製";
  btn.classList.add("is-copied");
  window.clearTimeout(Number(btn.dataset.copyTimer) || 0);
  btn.dataset.copyTimer = String(
    window.setTimeout(() => {
      btn.textContent = back;
      btn.classList.remove("is-copied");
    }, ms)
  );
}

function renderTray() {
  const tray = $("tray");
  const box = $("tray-pins");
  const count = $("tray-count");
  if (!tray || !box) return;
  const auto = lex ? autoBannedFromPins(lex, pinned) : new Set();
  const tags = lastPositive
    ? lastPositive.split(", ").map((t) => t.trim()).filter(Boolean)
    : knownTags(lex, pinned);
  tray.classList.toggle("is-on", tags.length > 0);
  tray.hidden = false;
  const head = tray.querySelector(".tray-head");
  const title = head && head.querySelector("strong");
  if (title) title.textContent = lastPositive ? "這張 POS" : "必進這張圖";
  if (head && lastPositive && !head.querySelector(".copy-pos")) {
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "ghost mini copy-pos";
    copy.textContent = "複製";
    copy.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!lastPositive) return;
      await navigator.clipboard.writeText(escapeForComfy(weightedPos(lastPositive)));
      confirmCopy(copy);
    });
    head.append(copy);
  }
  if (!tags.length) {
    box.replaceChildren();
    if (count) count.textContent = "";
    return;
  }
  if (count) count.textContent = lastPositive ? `${tags.length} 個 · 點文字釘／關 · 點數字調權重` : `${pinned.size} 個`;
  const prev = [...box.querySelectorAll(":scope > .tag")];
  const same = prev.length === tags.length && prev.every((el, i) => el.dataset.tag === tags[i]);
  if (same) {
    for (let i = 0; i < prev.length; i++) paintTrayChip(prev[i], tags[i], auto);
    return;
  }
  const frag = document.createDocumentFragment();
  tags.forEach((tag, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tag";
    btn.style.setProperty("--i", String(Math.min(i, 16)));
    paintTrayChip(btn, tag, auto);
    frag.append(btn);
  });
  box.replaceChildren(frag);
}

function syncViewFilters() {
  const bar = $("view-filters");
  if (!bar) return;
  for (const btn of bar.querySelectorAll("[data-view]")) {
    btn.setAttribute("aria-pressed", btn.dataset.view === viewMode ? "true" : "false");
  }
  const eraBtn = $("era-only");
  if (eraBtn) {
    eraBtn.hidden = !exclusiveEra();
    eraBtn.setAttribute("aria-pressed", eraOnly ? "true" : "false");
  }
}

function sectionItems(sec) {
  if (sec.id === "quality") {
    const fixed = new Set(lex.data.quality || []);
    const locked = (lex.data.quality || []).map((tag) => ({
      tag,
      section: "quality",
      group: "fixed",
      zh: (lex.data.zh || {})[tag],
    }));
    const extra = (lex.bySection.quality || []).filter((item) => !fixed.has(item.tag));
    return [...locked, ...extra];
  }
  return lex.bySection[sec.id] || [];
}

function isLockedQuality(tag) {
  return (lex.data.quality || []).includes(tag);
}

function chipShouldShow(item, auto, q) {
  if (isLockedQuality(item.tag)) {
    if (viewMode === "pinned" || viewMode === "banned") return false;
    if (q) {
      const zh = (item.zh || labelOf(lex, item.tag) || "").toLowerCase();
      if (!item.tag.toLowerCase().includes(q) && !zh.includes(q)) return false;
    }
    return true;
  }
  const st = tagState(item.tag, pinned, userBanned, auto);
  if (viewMode === "pinned" && st !== "pinned") return false;
  if (viewMode === "banned" && st !== "banned") return false;
  if (eraOnly && exclusiveEra() && !fitsEra(item) && st !== "pinned") return false;
  if (!fitsCast(item) && st !== "pinned") return false;
  if (q) {
    const zh = (item.zh || labelOf(lex, item.tag) || "").toLowerCase();
    if (!item.tag.toLowerCase().includes(q) && !zh.includes(q)) return false;
  }
  return true;
}

function catalogItem(tag) {
  const item = lex.byTag.get(tag);
  if (item) return item;
  if ((lex.data.quality || []).includes(tag)) {
    return { tag, section: "quality", zh: (lex.data.zh || {})[tag] };
  }
  return null;
}

function applyCatOpen(wrap, opened) {
  wrap.classList.toggle("is-open", opened);
  const toggle = wrap.querySelector(":scope > header .cat-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", opened ? "true" : "false");
  const body = wrap.querySelector(":scope > .cat-body");
  if (body) body.inert = !opened;
}

function hintFor(sec, vis) {
  if (sec.id === "subject") {
    const ex = exclusiveCast();
    return (
      vis.length +
      " · " +
      (ex === "female" ? "只開女，男生的字已收起" : ex === "male" ? "只開男，女生的字已收起" : "男女都可能出現")
    );
  }
  return `${vis.length} · ${sec.hint}`;
}

function setData(el, key, val) {
  if (!val) {
    if (el.dataset[key]) delete el.dataset[key];
    return;
  }
  if (el.dataset[key] !== val) el.dataset[key] = val;
}

function applyTagState(btn, item, auto, secId) {
  if (isLockedQuality(item.tag) || btn.dataset.locked === "1") return;
  const st = tagState(item.tag, pinned, userBanned, auto);
  const zh = item.zh || labelOf(lex, item.tag);
  const mutexBan = st === "banned" && auto.has(item.tag) && !userBanned.has(item.tag);
  const ban = st === "banned" ? (mutexBan ? "mutex" : "user") : "";
  const label =
    st === "banned" ? `${zh} (${item.tag}) ${mutexBan ? "與釘選互斥" : "已關閉"}` : `${zh} (${item.tag})`;
  setData(btn, "state", st);
  setData(btn, "ban", ban);
  setData(btn, "offEra", !fitsEra(item) && st !== "pinned" ? "1" : "");
  setData(btn, "offCast", !fitsCast(item) && st !== "pinned" ? "1" : "");
  setData(btn, "offHeat", secId !== "subject" && !fitsHeat(item) && st === "pool" ? "1" : "");
  if (btn.getAttribute("aria-label") !== label) btn.setAttribute("aria-label", label);
  paintWeightMark(btn, item.tag);
}

function rememberBtn(tag, btn) {
  let list = btnByTag.get(tag);
  if (!list) {
    list = [];
    btnByTag.set(tag, list);
  }
  list.push(btn);
}

function paintDirty(auto, dirty) {
  for (const tag of dirty) {
    const item = lex.byTag.get(tag);
    if (!item) continue;
    for (const btn of btnByTag.get(tag) || []) applyTagState(btn, item, auto, item.section);
  }
}

function paintAll(auto) {
  for (const [tag, btns] of btnByTag) {
    const item = lex.byTag.get(tag);
    if (!item) continue;
    for (const btn of btns) applyTagState(btn, item, auto, item.section);
  }
}

function collectDirty(auto) {
  const dirty = new Set();
  const mark = (cur, prev) => {
    for (const t of cur) if (!prev.has(t)) dirty.add(t);
    for (const t of prev) if (!cur.has(t)) dirty.add(t);
  };
  mark(pinned, paintPrev.pin);
  mark(auto, paintPrev.auto);
  mark(userBanned, paintPrev.user);
  return dirty;
}

function indexCatDom(root) {
  const rows = [];
  for (const [tag, btns] of btnByTag) {
    const item = catalogItem(tag);
    if (!item) continue;
    for (const btn of btns) {
      rows.push({ item, btn, fam: btn.closest(".family"), sub: btn.closest(".sub"), cat: btn.closest(".cat") });
    }
  }
  const families = [...root.querySelectorAll(".family")];
  const subs = [...root.querySelectorAll(".sub")].map((el) => ({
    el,
    closer: el.querySelector(":scope > .sub-head .ghost.mini"),
    buttons: [...el.querySelectorAll(".tag[data-tag]")],
  }));
  const cats = [...root.querySelectorAll(".cat")].map((el) => ({
    el,
    sec: SECTIONS.find((section) => el.id === "sec-" + section.id),
    hint: el.querySelector(".cat-actions > span"),
    closer: el.querySelector(":scope > header .ghost.mini"),
    buttons: [...el.querySelectorAll(".tag[data-tag]")],
  }));
  catDomIndex = { rows, families, subs, cats };
}

function syncVisibility(auto) {
  const root = $("cats");
  if (!root) return;
  const q = ($("q").value || "").trim().toLowerCase();
  const famShow = new Map();
  const subShow = new Map();
  const catN = new Map();
  for (const { item, btn, fam, sub, cat } of catDomIndex.rows) {
    const show = chipShouldShow(item, auto, q);
    if (btn.hidden !== !show) btn.hidden = !show;
    if (!show) continue;
    if (fam) famShow.set(fam, true);
    if (sub) subShow.set(sub, true);
    if (cat) catN.set(cat, (catN.get(cat) || 0) + 1);
  }
  for (const fam of catDomIndex.families) fam.hidden = !famShow.get(fam);
  for (const { el: sub } of catDomIndex.subs) sub.hidden = !subShow.get(sub);
  const filtering = !!q || viewMode !== "all";
  let any = false;
  for (const { el: wrap, sec, hint, closer, buttons } of catDomIndex.cats) {
    const n = catN.get(wrap) || 0;
    wrap.hidden = n === 0;
    if (n) any = true;
    const shouldOpen = filtering ? n > 0 : userOpen.has(wrap.id);
    applyCatOpen(wrap, shouldOpen);
    if (hint && sec) hint.textContent = hintFor(sec, { length: n });
    if (closer) {
      const tags = [];
      for (const btn of buttons) {
        if (!btn.hidden) tags.push(btn.dataset.tag);
      }
      const closed = tagsBanned(tags);
      closer.textContent = closed ? "開啟全部" : "關閉全部";
    }
  }
  for (const { closer, buttons } of catDomIndex.subs) {
    if (!closer) continue;
    const tags = [];
    for (const btn of buttons) if (!btn.hidden) tags.push(btn.dataset.tag);
    const closed = tagsBanned(tags);
    closer.textContent = closed ? "開啟全部" : "關閉全部";
  }
  let empty = root.querySelector(":scope > .empty-filter");
  if (!any) {
    if (!empty) {
      empty = document.createElement("p");
      empty.className = "hint empty-filter";
      root.append(empty);
    }
    empty.hidden = false;
    // 切到「釘選」卻一個都沒釘，是最容易撞到的空畫面 —— 六個分類一次全部消失。
    // 泛用的那句「這個篩選下沒有 tag」在這裡等於沒說：使用者要的是下一步怎麼做。
    empty.textContent = q
      ? "沒有符合的字。"
      : viewMode === "pinned"
        ? "還沒釘住任何字。回到「全部」點一下 tag 就會釘住它。"
        : viewMode === "banned"
          ? "還沒封禁任何字。釘住的 tag 再點一下就會封禁。"
          : "這個篩選下沒有 tag。";
  } else if (empty) empty.hidden = true;
}

function renderCats(mode = "auto") {
  if (!btnByTag.size) {
    buildCats();
    return;
  }
  const auto = autoBannedFromPins(lex, pinned);
  if (mode === "heat" || mode === "filter") paintAll(auto);
  else if (mode !== "search") {
    const dirty = collectDirty(auto);
    if (dirty.size) paintDirty(auto, dirty);
  }
  paintPrev = { pin: new Set(pinned), auto, user: new Set(userBanned) };
  if (mode !== "heat") syncVisibility(auto);
  syncViewFilters();
  if (mode === "filter" || mode === "heat") playCatsSwap();
}

let catsSwapTimer = 0;
let catsSwapGen = 0;

/**
 * 切換檢視時讓分類淡入，不要讓上千個晶片瞬間閃動。
 *
 * 切到「釘選」會讓 1086 個晶片同時消失（實測），而它們是用 hidden 也就是
 * display:none 切的 —— 沒有任何過場可言。但**不能**去動畫那上千個元素：
 * 逐個做不只是效能問題，畫面上也會變成一片雜訊。
 *
 * 動的是六個分類容器，只碰 opacity 與 transform，用既有的 --i 錯開慣例
 * （.tray .tag 已經在用 calc(var(--i) * 12ms)）。切換本身實測 1–3 毫秒，
 * 所以淡入不會蓋住任何等待，純粹是讓改變看得出是「換了一批」而不是閃一下。
 *
 * 由呼叫端決定要不要放，而不是這裡看 mode —— 因為「釘選／封禁／只看該時代」
 * 那三顆按鈕走的是 renderCats("search")（它們只改可見性，不需要重繪顏色，
 * 所以共用了搜尋那條快路徑），跟真正的搜尋輸入從 mode 上分不出來。
 *
 * 搜尋輸入刻意不放：那是連續輸入（每 120 毫秒觸發一次），每打一個字閃一下
 * 只會更吵。這就是「動效要有目的」那條 —— 刻意的切換才給過場，連續輸入不給。
 */
function playCatsSwap() {
  const root = $("cats");
  if (!root) return;
  if (reduceMotion()) return;
  root.classList.remove("is-swapping");
  // 同一幀移除再加上不會重播動畫，中間要讀一次版面逼瀏覽器結算。
  void root.offsetWidth;
  let i = 0;
  // 空狀態也算一格：整片空掉的時候它是畫面上唯一的東西，最不該是硬跳出來的。
  for (const cat of root.querySelectorAll(":scope > .cat, :scope > .empty-filter")) {
    if (cat.hidden) continue;
    cat.style.setProperty("--i", String(i));
    i += 1;
  }
  root.classList.add("is-swapping");
  // 跑完要把 class 拿掉。留著的話，之後任何一個分類由 hidden 轉可見都會
  // **重新符合這個選擇器**而再放一次動畫 —— 搜尋正好會這樣：實測打字篩掉
  // 四個分類、再清空，六個分類全部 cats-swap-in@running。那正是這一段
  // 刻意要避開的「每打一個字閃一下」，只是繞過 mode 從另一邊回來了。
  const cs = getComputedStyle(root);
  // 跟 CSS --cats-swap-dur 對齊（現在是 opacity-only 的 --dur-move）。
  const dur = parseFloat(cs.getPropertyValue("--cats-swap-dur")) || parseFloat(cs.getPropertyValue("--dur-move")) || 320;
  const step = parseFloat(cs.getPropertyValue("--cats-stagger")) || 20;
  const gen = (catsSwapGen += 1);
  window.clearTimeout(catsSwapTimer);
  catsSwapTimer = window.setTimeout(() => {
    if (gen !== catsSwapGen) return;
    root.classList.remove("is-swapping");
  }, dur + i * step + 60);
}

function buildCats() {
  btnByTag.clear();
  const auto = autoBannedFromPins(lex, pinned);
  paintPrev = { pin: new Set(pinned), auto, user: new Set(userBanned) };
  const root = $("cats");
  const frag = document.createDocumentFragment();
  syncViewFilters();

  for (const sec of SECTIONS) {
    const wrap = document.createElement("section");
    wrap.className = "cat" + (sec.id === "quality" ? " quality" : "");
    wrap.id = "sec-" + sec.id;
    const opened = userOpen.has(wrap.id) || location.hash === "#" + wrap.id;
    if (opened) userOpen.add(wrap.id);
    const head = document.createElement("header");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "cat-toggle";
    toggle.setAttribute("aria-expanded", opened ? "true" : "false");
    const title = document.createElement("strong");
    title.textContent = sec.title;
    toggle.append(title);
    const items = sectionItems(sec);
    const hint = document.createElement("span");
    hint.textContent = hintFor(sec, { length: sec.id === "quality" ? items.length : 0 });
    const actions = document.createElement("div");
    actions.className = "cat-actions";
    actions.append(hint);
    if (sec.id !== "quality") actions.append(closeAllBtn(sec.title));
    head.append(toggle, actions);
    wrap.append(head);
    const body = document.createElement("div");
    body.className = "cat-body";
    body.id = wrap.id + "-body";
    toggle.setAttribute("aria-controls", body.id);
    wrap.append(body);
    applyCatOpen(wrap, opened);
    const order = (lex.data.groupOrder && lex.data.groupOrder[sec.id]) || ["other"];
    const zhMap = lex.data.groupZh || {};
    const buckets = new Map();
    for (const item of items) {
      const g = item.group || "other";
      if (!buckets.has(g)) buckets.set(g, []);
      buckets.get(g).push(item);
    }
    const keys = [...order.filter((g) => buckets.has(g)), ...[...buckets.keys()].filter((g) => !order.includes(g))];
    for (const g of keys) {
      const sub = document.createElement("div");
      sub.className = "sub";
      const subHead = document.createElement("div");
      subHead.className = "sub-head";
      const h = document.createElement("h3");
      h.textContent = zhMap[g] || g;
      const acts = document.createElement("div");
      acts.className = "sub-acts";
      if (sec.id !== "quality") acts.append(mustStepper(sub, sec.id, g, zhMap[g] || g));
      if (sec.id !== "quality" || g !== "fixed") acts.append(closeAllBtn(zhMap[g] || g));
      subHead.append(h, acts);
      const box = document.createElement("div");
      box.className = "tags";
      const sorted = sortItems(buckets.get(g));
      const { roots, children } = clusterItems(sorted, auto);
      for (const item of sortItems(roots)) {
        const kids = children.get(item.tag) || [];
        if (!kids.length) {
          box.append(makeTagBtn(item, sec, auto));
          continue;
        }
        const fam = document.createElement("div");
        fam.className = "family";
        fam.append(makeTagBtn(item, sec, auto));
        const nest = document.createElement("div");
        nest.className = "tags nested";
        for (const kid of kids) nest.append(makeTagBtn(kid, sec, auto));
        fam.append(nest);
        box.append(fam);
      }
      sub.append(subHead, box);
      body.append(sub);
    }
    frag.append(wrap);
  }
  root.replaceChildren(frag);
  indexCatDom(root);
  syncVisibility(auto);
}

function tagButtons(tag) {
  return btnByTag.get(tag) || [];
}

// 釘選與封禁各給一次確認。差別在方向：釘選那圈往外擴（收進來），
// 封禁那圈往內收（推開去）。同一個語彙的兩個方向，比放兩次一樣的漣漪清楚。
// 在這之前只有釘選會確認，封禁點下去沒有任何回應。
function flashTag(tag, kind) {
  if (reduceMotion()) return;
  const cls = kind === "ban" ? "is-ban-flash" : "is-pin-flash";
  for (const el of tagButtons(tag)) {
    el.classList.remove(cls);
    // 先拿掉再加回去才會重播，中間要讓瀏覽器真的重算一次樣式。
    // 這裡用 offsetWidth 而不是 requestAnimationFrame：rAF 在分頁沒有焦點時
    // 會被節流到幾乎不跑（實測 1.7 秒才一格），動效就這樣卡著不放。
    void el.offsetWidth;
    el.classList.add(cls);
    window.setTimeout(() => el.classList.remove(cls), 560);
  }
}

function flashPin(tag) {
  flashTag(tag, "pin");
}

function pinsAtDrawOf(card) {
  try {
    const raw = JSON.parse(card.dataset.pinsAtDraw || "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

// 卡片上的一行警告。兩種：釘選沒進圖、以及這張圖自己打架。
// 形狀一樣，只差算的是什麼，所以共用同一個進出邏輯。
function paintCardWarn(card, cls, line) {
  const meta = card.querySelector(".meta");
  if (!meta) return;
  let warn = meta.querySelector(`:scope > .warn.${cls}`);
  if (!line) {
    warn?.remove();
    return;
  }
  if (!warn) {
    warn = document.createElement("p");
    warn.className = `warn ${cls}`;
    meta.append(warn);
  }
  warn.textContent = line;
}

function paintPinMiss(card) {
  const pos = card.dataset.bare || "";
  paintCardWarn(card, "pin-miss", pos ? pinMissLine(lex, pos, pinned, pinsAtDrawOf(card)) : "");
  // 引擎每次抽完都算 contradictions()，但在這之前**沒有任何地方讀它** ——
  // 「這張圖同時是室內又室外」被算出來然後丟掉。自然抽取撞不到（實測 8640 張
  // 0 次），要兩個互相矛盾的釘選才會（釘露營配更衣室），而那正是最需要說一聲
  // 的時候：兩個都是使用者明確釘的，引擎照留，但他得知道圖為什麼會怪。
  paintCardWarn(card, "pos-clash", pos ? clashLine(lex, pos) : "");
}

// 清除釘選的復原窗要在使用者又動了釘選時收掉 —— 否則七秒內新釘的字會被
// 「復原」連帶抹掉，那是拿一個資料損失換另一個。bindUi 會把收尾函式掛上來。
let onPinsTouched = null;

function afterPin() {
  if (onPinsTouched) onPinsTouched();
  presetOwned = prunePresetOwned(presetOwned, pinned, lex);
  saveStore();
  renderCats();
  renderTray();
  updateEraClash();
  updateHeatClash();
  syncCast();
  syncPresets();
  const auto = autoBannedFromPins(lex, pinned);
  for (const span of document.querySelectorAll(".pos span[data-tag]")) {
    if (span.dataset.locked === "1") continue;
    span.dataset.state = tagState(span.dataset.tag, pinned, userBanned, auto);
  }
  for (const card of document.querySelectorAll(".card")) paintPinMiss(card);
}

function recipeFromDraw(drawn, sent, seedNum) {
  return {
    name: (ERA_LABELS[drawn.era] || drawn.era || "配方") + " · seed " + seedNum,
    positive: drawn.positive,
    positiveWeighted: sent,
    seed: seedNum,
    width: settings.width,
    height: settings.height,
    checkpoint: currentCkpt() || "",
    loras: (currentLorasPayload() || []).map((l, i) => ({
      ...l,
      order: i,
    })),
    workflowId: currentWorkflowId(),
    sampler: genSampler.sampler,
    scheduler: genSampler.scheduler,
    steps: genSampler.steps,
    cfg: genSampler.cfg,
    rating: settings.rating || "explicit",
    heats: [...(settings.heats || [])],
    era: drawn.era || "",
    sceneMode: sceneModeOf(settings),
    counts: { ...(settings.counts || {}) },
    mustDraw: { ...(settings.mustDraw || {}) },
    pinned: [...pinned],
    userBanned: [...userBanned],
    presetOwned: snapshotPresetOwned(presetOwned),
    traceSummary: traceSummaryForRecipe(drawn.trace || { kept: [], rejected: [] }),
  };
}

async function applyRecipeToBench(recipe) {
  if (!recipe) return;
  pinned = new Set(recipe.pinned || []);
  userBanned = new Set(recipe.userBanned || []);
  presetOwned = prunePresetOwned(sanitizePresetOwned(recipe.presetOwned, lex), new Set(recipe.pinned || []), lex);
  settings = sanitizeSettings(
    {
      ...settings,
      rating: recipe.rating,
      heats: recipe.heats,
      sceneMode: recipe.sceneMode,
      counts: recipe.counts,
      mustDraw: recipe.mustDraw,
      width: recipe.width,
      height: recipe.height,
      eras: recipe.era ? [recipe.era] : settings.eras,
    },
    lex.data,
  );
  saveStore();
  applyWorkflowId(recipe.workflowId || "");
  const missing = await applyRecipeModels({ checkpoint: recipe.checkpoint, loras: recipe.loras });
  afterPin();
  syncRating();
  syncHeat();
  syncSceneMode();
  renderCounts();
  renderEras();
  syncSizeButtons();
  syncMustDraw();
  syncDrawJob();
  if (missing && missing.length) speak("已套用，但缺少：" + missing.join("、"));
  else speak("已套用到工作台，尚未生圖");
}

async function generateFromRecipe(recipe) {
  if (!recipe) return;
  if (running) {
    speak("正在抽圖，這一張結束後再重現");
    return;
  }
  if (!(await comfyUp())) {
    speak("ComfyUI 連不上，先開本機 8188");
    return;
  }
  const payload = {
    positive: recipe.positiveWeighted || recipe.positive,
    width: recipe.width,
    height: recipe.height,
    seed: recipe.seed,
    loras: recipe.loras,
    ckpt: recipe.checkpoint,
    rating: recipe.rating,
    workflowId: recipe.workflowId != null ? recipe.workflowId : "",
  };
  const card = placeCard(cardSkeleton(recipe.width, recipe.height));
  markLive(card);
  card.dataset.seed = String(recipe.seed);
  card.dataset.era = recipe.era || "";
  card.dataset.bare = recipe.positive || "";
  card.dataset.positive = payload.positive || "";
  card.dataset.rating = recipe.rating || "explicit";
  card.dataset.loras = JSON.stringify(recipe.loras || []);
  card.dataset.ckpt = recipe.checkpoint || "";
  card.dataset.workflowId = recipe.workflowId != null ? String(recipe.workflowId) : "";
  card._recipe = recipe;
  if (recipe.id) card.dataset.recipeId = recipe.id;
  showPos(payload.positive);
  setPosLine(card, payload.positive);
  setLive(card, { status: "依配方重現…" });
  running = true;
  aborting = false;
  skipping = false;
  genAbort = new AbortController();
  $("go").disabled = true;
  $("go").setAttribute("aria-busy", "true");
  $("cancel").hidden = false;
  try {
    await streamCardJob(card, recipe.seed, {
      positive: payload.positive,
      era: recipe.era,
      eraClash: [],
      loras: recipe.loras,
      ckpt: recipe.checkpoint,
      rating: recipe.rating,
      workflowId: payload.workflowId,
      width: recipe.width,
      height: recipe.height,
    });
  } finally {
    clearLive(card);
    running = false;
    $("go").disabled = false;
    $("go").removeAttribute("aria-busy");
    $("cancel").hidden = true;
  }
}

function weightedPos(positive) {
  return applyTagWeights(positive, tagWeights);
}

function refreshWeights() {
  saveStore();
  for (const [tag, btns] of btnByTag) {
    for (const btn of btns) paintWeightMark(btn, tag);
  }
  const auto = lex ? autoBannedFromPins(lex, pinned) : new Set();
  const box = $("tray-pins");
  if (box) {
    for (const btn of box.querySelectorAll(":scope > .tag[data-tag]")) {
      paintTrayChip(btn, btn.dataset.tag, auto);
    }
  }
  for (const card of document.querySelectorAll(".card[data-bare]")) {
    const bare = card.dataset.bare || "";
    // 抽的時候 dataset.positive 是「權重 + LoRA 觸發詞」，這裡重算只放了權重，
    // 觸發詞會被洗掉 —— 之後「重抽這張」讀的就是這個欄位，等於掛著 LoRA 卻沒有
    // 觸發詞。draw 時已經把觸發詞留在 dataset.trigger，照原樣補回去。
    card.dataset.positive = insertTriggerAfterCast(weightedPos(bare), card.dataset.trigger || "");
    for (const span of card.querySelectorAll(".pos span[data-tag]")) {
      paintWeightMark(span, span.dataset.tag);
    }
  }
  if (lastPositive) {
    const copy = document.querySelector(".copy-pos");
    if (copy) copy.dataset.pos = escapeForComfy(weightedPos(lastPositive));
  }
}

function setTagWeight(tag, value) {
  if (!tag) return;
  const next = clampTagWeight(value);
  if (next === 1) tagWeights.delete(tag);
  else tagWeights.set(tag, next);
  refreshWeights();
  paintWeightPop();
  speak(`${labelOf(lex, tag)} 權重 ${formatWeight(next)}`);
}

// .w-flag 是 <button> 裡的 span[role=button] —— 按鈕不准包互動元素，所以它
// 永遠拿不到焦點（boot.css 那條 .w-flag:focus-visible 一直是死規則）。
// 唯一能補的位置是字牌自己身上：焦點在字牌上按 W 就開它的權重。
function openWeightPopFromFocus() {
  if (weightPopOpen()) {
    closeWeightPop();
    return true;
  }
  const host = document.activeElement?.closest?.(".tag[data-tag], .pos span[data-tag]");
  if (!host || !host.dataset.tag) return false;
  openWeightPop(host);
  return true;
}

function onTagWeight(tag, dir = 1) {
  if (!tag) return;
  setTagWeight(tag, stepTagWeight(tagWeightOf(tag), dir));
}

function onTagClick(tag) {
  const next = cycleTag(lex, pinned, userBanned, tag);
  const becamePin = next.pinned.has(tag) && !pinned.has(tag);
  const becameBan = next.userBanned.has(tag) && !userBanned.has(tag);
  pinned = next.pinned;
  userBanned = next.userBanned;
  afterPin();
  if (becamePin) flashTag(tag, "pin");
  else if (becameBan) flashTag(tag, "ban");
}

function makeTagBtn(item, sec, auto) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tag";
  const zh = item.zh || labelOf(lex, item.tag);
  const lab = document.createElement("span");
  lab.className = "label";
  lab.textContent = zh;
  btn.append(lab);
  btn.dataset.tag = item.tag;
  btn.dataset.en = item.tag;
  btn.title = item.tag;
  btn.setAttribute("aria-label", `${zh} (${item.tag})`);
  if (isLockedQuality(item.tag)) {
    btn.dataset.state = "pinned";
    btn.dataset.locked = "1";
    btn.disabled = true;
    paintWeightMark(btn, item.tag);
    rememberBtn(item.tag, btn);
    return btn;
  }
  applyTagState(btn, item, auto, sec.id);
  paintWeightMark(btn, item.tag);
  rememberBtn(item.tag, btn);
  return btn;
}

function reduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function pop(el) {
  if (!el || reduceMotion()) return;
  el.animate(
    [
      { transform: "scale(0.97)", opacity: 0.92 },
      { transform: "scale(1)", opacity: 1 },
    ],
    { duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
  );
}

function cardSkeleton(width, height) {
  const el = document.createElement("article");
  el.className = "card is-wait";
  el.style.setProperty("--shot-w", String(width || 1024));
  el.style.setProperty("--shot-h", String(height || 1024));
  el.innerHTML = `<div class="shot"><div class="skel" aria-hidden="true"></div><img class="shot-img" alt="" width="${width || 1024}" height="${height || 1024}"><div class="meter" hidden><i></i><span></span></div><button type="button" class="skip-shot" aria-label="跳過這張，接著下一張" title="跳過這張"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button><button type="button" class="redo-shot" aria-label="重新生成這張" title="重新生成"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.3"/><polyline points="21 3 21 9 15 9"/></svg></button><button type="button" class="fav-shot" aria-pressed="false" aria-label="收藏這張" title="收藏"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><polygon points="12 3 14.9 9.6 22 10.3 16.6 15.2 18.2 22.3 12 18.7 5.8 22.3 7.4 15.2 2 10.3 9.1 9.6"/></svg></button></div><div class="meta"><div class="bar">排隊中…</div><div class="pos"></div></div>`;
  return el;
}

// 卡片上就顯示「幾個字、幾個 token」，不加警示、不加門檻。
//
// 原本這裡盯著「CLIP 一塊 75 token」並且超過就標紅，那是錯的重點：
// r42 的 400 條 prompt 有 400 條超過 75 token（中位數 141），警告永遠亮等於沒資訊；
// 而 Illustrious 論文（arXiv 2409.19946）根本沒給最大 token 長度，社群實測可用長度
// 在 248 左右，我們最長 166。論文寫明的是標籤順序（§3.1.2）與「越後面越被稀釋」——
// 是漸變不是斷崖。真要有基準的是標籤數量：2026-09-16 抽樣 3000 篇 Danbooru post，
// 一般標籤中位數 32、p95 是 61，我們中位數 51。數字擺著讓人自己判斷就好。
//
// token 數由 scripts/token_counts.py 用真的 CLIP tokenizer 預先算好，因為瀏覽器
// 裡沒有 tokenizer，為了這個塞一份 BPE 詞表進來不划算。逐字相加再補上分隔符，
// 實測 300 條有 92% 與整串 tokenize 完全一致，其餘 8% 高估 1 個（BPE 在逗號處
// 合併）。當指示器用綽綽有餘，但別拿它當精確值。
function promptCost(positive) {
  const parts = String(positive || "").split(", ").filter(Boolean);
  if (!tokenTable || !tokenTable.counts) return { tags: parts.length, tokens: null };
  const sep = Number(tokenTable.sep) || 1;
  let tokens = 0;
  for (const part of parts) {
    // 權重語法不用算錢：ComfyUI 是先把 `(tag:1.2)` 解析掉、只把 tag 本身丟進
    // tokenizer 的（comfy/sd1_clip.py 先 token_weights() 再 unescape_important()
    // 才 tokenize）。跳脫用的反斜線同理。所以查的是脫掉外衣的那個字。
    const { tag } = parseWeighted(part);
    const n = tokenTable.counts[tag];
    // 查不到的字（LoRA 觸發詞、或新加的還沒重產表）用字數粗估，不要讓整個顯示壞掉
    tokens += Number.isFinite(n) ? n : tag.split(SPACE_RE).length;
  }
  tokens += sep * Math.max(0, parts.length - 1);
  return { tags: parts.length, tokens };
}

function setPosLine(el, positive) {
  const pos = el.querySelector(".pos");
  if (!pos) return;
  pos.replaceChildren();
  const auto = autoBannedFromPins(lex, pinned);
  for (const part of String(positive || "").split(",")) {
    const { tag } = parseWeighted(part);
    if (!tag) continue;
    const span = document.createElement("span");
    const lab = document.createElement("span");
    lab.className = "label";
    lab.textContent = labelOf(lex, tag);
    span.append(lab);
    span.dataset.tag = tag;
    if (isFixedTag(tag)) span.dataset.locked = "1";
    else span.dataset.state = tagState(tag, pinned, userBanned, auto);
    paintWeightMark(span, tag);
    pos.append(span, document.createTextNode(" · "));
  }
  if (pos.lastChild) pos.lastChild.remove();
}

function hideMeter(el) {
  const meter = el.querySelector(".meter");
  if (meter) meter.remove();
}

function setLive(el, ev) {
  if (el.classList.contains("is-done") || el.classList.contains("is-fail")) return;
  const bar = el.querySelector(".bar");
  const meter = el.querySelector(".meter");
  const fill = meter && meter.querySelector("i");
  const label = meter && meter.querySelector("span");
  const img = el.querySelector(".shot-img");
  const skel = el.querySelector(".skel");
  if (ev.status && bar) bar.textContent = ev.status;
  if (ev.max && meter && fill && label) {
    meter.hidden = false;
    const p = Math.max(0, Math.min(1, Number(ev.value || 0) / Number(ev.max)));
    fill.style.transform = `scaleX(${p})`;
    label.textContent = `${ev.value} / ${ev.max}`;
  }
  if (ev.image && img) {
    img.src = ev.image;
    img.classList.add("is-on");
    if (skel) skel.classList.add("is-behind");
  }
}

function endGenCard(el) {
  el.classList.remove("is-gen");
}

function failCard(el, err) {
  endGenCard(el);
  el.classList.remove("is-wait", "is-done");
  el.classList.add("is-fail");
  hideMeter(el);
  const skel = el.querySelector(".skel");
  if (skel) skel.remove();
  const bar = el.querySelector(".bar");
  if (!bar) return;
  const bits = [err];
  if (el.dataset.seed) bits.push("seed " + el.dataset.seed);
  if (el.dataset.era && ERA_LABELS[el.dataset.era]) bits.push(ERA_LABELS[el.dataset.era]);
  const label = document.createElement("span");
  label.textContent = bits.join(" · ");
  bar.replaceChildren(label);
  if (el.dataset.positive) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost copy";
    btn.textContent = "複製 POS";
    btn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(escapeForComfy(el.dataset.positive));
      speak("已複製 POS");
      confirmCopy(btn);
    });
    bar.append(btn);
  }
}

function skipCard(el) {
  if (el.classList.contains("is-skip")) return;
  endGenCard(el);
  el.classList.remove("is-wait", "is-done", "is-fail");
  el.classList.add("is-skip");
  hideMeter(el);
  const bar = el.querySelector(".bar");
  if (!bar) return;
  const bits = ["已跳過"];
  if (el.dataset.seed) bits.push("seed " + el.dataset.seed);
  bar.textContent = bits.join(" · ");
}

function fillCard(el, job, err) {
  endGenCard(el);
  el.classList.remove("is-wait");
  if (err) {
    failCard(el, err);
    return;
  }
  el.classList.add("is-done");
  hideMeter(el);
  const img = el.querySelector(".shot-img");
  const skel = el.querySelector(".skel");
  // 有圖可放的時候，骨架的退場歸 reveal() 管（等 decode 之後跟圖一起交接）；
  // 沒圖可放（失敗、跳過）才在下面直接拔掉。用旗標宣告所有權，不要去問
  // class 有沒有被加上 —— decode() 是非同步的，同步那行問的時候還沒加上。
  let skelHandled = false;
  if (img && job.image) {
    img.alt = "";
    if (job.width && job.height) {
      el.style.setProperty("--shot-w", String(job.width));
      el.style.setProperty("--shot-h", String(job.height));
      img.width = job.width;
      img.height = job.height;
    }
    img.addEventListener(
      "error",
      () => {
        if (el.classList.contains("is-fail") || el.classList.contains("is-img-fail")) return;
        el.classList.add("is-img-fail");
        const meta = el.querySelector(".meta");
        if (meta && !meta.querySelector(".img-fail")) {
          const note = document.createElement("p");
          note.className = "warn img-fail";
          note.textContent = "圖片載入失敗，Comfy 可能已關閉或輸出被清掉。POS 仍在下面。";
          meta.append(note);
        }
      },
      { once: true }
    );
    img.src = job.image;
    // 等真的有像素了才開始淡入。原本 is-on 是跟 src 同一行加上去的，
    // 於是 320ms 的淡入在還沒有圖的空盒子上就跑完了，圖真的到的時候是硬跳出來的；
    // 而骨架又在下面幾行被直接 remove()，中間那段就是一個空盒子。
    // decode() 解決的正是這件事：它 resolve 的時候畫面已經可以直接畫，不會卡一下。
    skelHandled = true;
    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      img.classList.add("is-on");
      if (skel) {
        skel.classList.add("is-gone");
        window.setTimeout(() => skel.remove(), 420);
      }
    };
    // 失敗也要交接 —— 圖破了有另外的 error handler 處理，但骨架不能永遠留著。
    // 再加一個保底 timeout：decode() 在某些情況下不會 settle。
    if (typeof img.decode === "function") img.decode().then(reveal, reveal);
    else reveal();
    window.setTimeout(reveal, 3000);
    if (!String(job.image).startsWith("data:")) {
      try {
        const fn = new URL(job.image, location.href).searchParams.get("filename");
        if (fn) img.alt = fn;
      } catch {
        /* ignore */
      }
    }
  }
  if (skel && !skelHandled) skel.remove();
  const shot = el.querySelector(".shot");
  if (shot) {
    shot.setAttribute("role", "button");
    shot.tabIndex = 0;
    shot.title = "放大查看";
    shot.setAttribute("aria-label", "放大查看這張圖");
  }
  let meta = el.querySelector(".meta");
  if (!meta) {
    meta = document.createElement("div");
    meta.className = "meta";
    el.append(meta);
  }
  const bar = document.createElement("div");
  bar.className = "bar";
  const cost = promptCost(job.positive);
  const costTxt = cost.tokens == null ? `${cost.tags} 字` : `${cost.tags} 字 · ${cost.tokens} token`;
  bar.innerHTML =
    `<span>seed ${job.seed}${job.era ? " · " + (ERA_LABELS[job.era] || job.era) : ""}` +
    ` · <span class="cost">${costTxt}</span></span>` +
    `<span class="bar-actions">` +
    `<button type="button" class="ghost why-btn" aria-expanded="false">為什麼是這些？</button>` +
    `<button type="button" class="ghost copy">複製 POS</button>` +
    `</span>`;
  setPosLine(el, job.positive);
  const pos = el.querySelector(".pos");
  bar.querySelector(".copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(escapeForComfy(job.positive));
    speak("已複製 POS");
    confirmCopy(bar.querySelector(".copy"));
  });
  meta.replaceChildren(bar, pos || document.createElement("div"));
  paintPinMiss(el);
  ensureFavButton(el);
  paintFavButton(el);
  paintWhy(el, lex, labelOf);
  if (job.eraClash && job.eraClash.length) {
    const warn = document.createElement("p");
    warn.className = "warn";
    warn.textContent =
      "釘選年代不同：" +
      job.eraClash.map((t) => labelOf(lex, t)).join("、") +
      "（這張仍是" +
      (ERA_LABELS[job.era] || job.era) +
      "）";
    meta.append(warn);
  }
}

const REDUCE_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;

function overlayOpen(el) {
  if (!el) return;
  el._closeGen = (el._closeGen || 0) + 1;
  delete el.dataset.closing;
  el.classList.remove("is-closing");
  el.inert = false;
  el.classList.add("open");
  lockScroll(el.id || "overlay");
}
function overlayClose(el, onDone) {
  if (!el || !el.classList.contains("open") || el.dataset.closing === "1") return;
  const gen = (el._closeGen = (el._closeGen || 0) + 1);
  el.dataset.closing = "1";
  el.classList.add("is-closing");
  el.inert = true;
  const ms = REDUCE_MOTION ? 0 : 180;
  setTimeout(() => {
    if (el._closeGen !== gen) return;
    delete el.dataset.closing;
    el.classList.remove("open", "is-closing");
    unlockScroll(el.id || "overlay");
    if (onDone) onDone();
  }, ms);
}

function ensureViewer() {
  if ($("shot-viewer")) return;
  const ov = document.createElement("div");
  ov.id = "shot-viewer";
  ov.className = "shot-viewer";
  ov.inert = true;
  ov.setAttribute("role", "dialog");
  ov.setAttribute("aria-modal", "true");
  ov.setAttribute("aria-label", "放大圖片");
  ov.innerHTML = `
    <div class="shot-viewer-inner" id="shot-viewer-inner">
      <button type="button" class="shot-viewer-close" id="shot-viewer-close" aria-label="關閉 (Esc)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
      </button>
      <button type="button" class="shot-viewer-nav prev" id="shot-viewer-prev" aria-label="上一張">‹</button>
      <button type="button" class="shot-viewer-nav next" id="shot-viewer-next" aria-label="下一張">›</button>
      <div class="shot-viewer-stage"><img id="shot-viewer-img" alt=""></div>
      <div class="shot-viewer-info" id="shot-viewer-info"></div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener("click", (e) => {
    if (e.target.id === "shot-viewer") closeViewer();
  });
  $("shot-viewer-close").addEventListener("click", closeViewer);
  $("shot-viewer-prev").addEventListener("click", (e) => {
    e.stopPropagation();
    navViewer(-1);
  });
  $("shot-viewer-next").addEventListener("click", (e) => {
    e.stopPropagation();
    navViewer(1);
  });
}

function doneCards() {
  return [...document.querySelectorAll("#results .card.is-done")].filter((c) => c.querySelector(".shot-img.is-on"));
}

function loraSummary(card) {
  let loras = [];
  try {
    loras = JSON.parse(card.dataset.loras || "[]");
  } catch {
    loras = [];
  }
  if (!loras.length) return "無";
  return loras
    .map((l) => {
      const name = (l.file || "").replace(/\.safetensors$/i, "");
      const str = l.strength != null ? `@${Number(l.strength).toFixed(2)}` : "";
      return (l.folder ? l.folder + "/" : "") + name + str;
    })
    .join("、");
}

let VIEW_INDEX = -1;
let VIEW_RETURN = null;

let VIEW_NAV_GEN = 0;

/**
 * 換到上一張／下一張。dir>0 是下一張，0 是第一次開啟（不做動效）。
 *
 * 舊寫法是直接 `vImg.src = img.src` —— 兩個問題：
 * 一是新圖若還沒解碼，img 會空一幀再跳出來，那個閃就是「生硬」的來源；
 * 二是換完之後畫面上沒有任何東西說明方向，按 › 跟按 ‹ 看起來一模一樣。
 *
 * 所以先在旁邊解碼好再換（圖通常已經在卡片上畫過，這一步幾乎是同步的），
 * 換完再放一段有方向的滑入。連按時用 gen 擋住較早那幾張，免得非同步的
 * decode 回來的順序跟按鍵順序不同，畫面倒著跳。
 */
function fillViewer(card, dir = 0) {
  const img = card.querySelector(".shot-img");
  const vImg = $("shot-viewer-img");
  const nextSrc = img.src;
  const gen = (VIEW_NAV_GEN += 1);
  let painted = false;
  const paint = () => {
    if (painted || gen !== VIEW_NAV_GEN) return;
    painted = true;
    vImg.src = nextSrc;
    vImg.alt = img.alt || "生成圖";
    fillViewerInfo(card);
    // 先清乾淨再決定要不要放：關掉再開（dir=0）也要把上一次的方向清掉，
    // 不然那兩個 class 會一直留在 img 上。
    const box = $("shot-viewer-info");
    vImg.classList.remove("nav-l", "nav-r");
    box.classList.remove("nav-in");
    if (!dir || REDUCE_MOTION) return;
    // 同一幀移除再加上不會重播，中間要讀一次版面逼瀏覽器結算。
    void vImg.offsetWidth;
    vImg.classList.add(dir > 0 ? "nav-r" : "nav-l");
    box.classList.add("nav-in");
  };
  if (dir && !REDUCE_MOTION) {
    const pre = new Image();
    pre.src = nextSrc;
    if (typeof pre.decode === "function") pre.decode().then(paint, paint);
    else paint();
    // decode() 不保證會 settle —— 分頁在背景時實測就不會（卡片淡入那段也踩過，
    // 所以那裡有 3000ms 保底）。沒有保底的話按鈕會變成死的：按了什麼都不動。
    // 這裡等的是「已經畫在卡片上的圖」，200 毫秒還沒好就直接換，
    // 最多閃一幀，比按鈕沒反應好。
    window.setTimeout(paint, 200);
  } else paint();
}

function fillViewerInfo(card) {
  const info = $("shot-viewer-info");
  const rows = [
    ["seed", card.dataset.seed || "—"],
    ["時代", ERA_LABELS[card.dataset.era] || card.dataset.era || "—"],
    ["LoRA", loraSummary(card)],
    ["觸發詞", card.dataset.trigger || "無"],
  ];
  info.replaceChildren();
  for (const [k, v] of rows) {
    const row = document.createElement("div");
    row.className = "gi-row";
    const kk = document.createElement("span");
    kk.className = "gi-k";
    kk.textContent = k;
    const vv = document.createElement("span");
    vv.className = "gi-v";
    vv.textContent = v;
    row.append(kk, vv);
    info.append(row);
  }
  const posLab = document.createElement("div");
  posLab.className = "gi-k";
  posLab.textContent = "POS";
  const pos = document.createElement("div");
  pos.className = "shot-viewer-pos";
  pos.textContent = card.dataset.positive || "";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "shot-viewer-copy";
  copy.textContent = "複製 POS";
  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(escapeForComfy(card.dataset.positive || ""));
    speak("已複製 POS");
    confirmCopy(copy);
  });
  info.append(posLab, pos, copy);
  const list = doneCards();
  const n = list.length;
  $("shot-viewer-prev").hidden = n < 2;
  $("shot-viewer-next").hidden = n < 2;
}

function openViewer(card) {
  if (!card || !card.classList.contains("is-done")) return;
  ensureViewer();
  const list = doneCards();
  VIEW_INDEX = list.indexOf(card);
  if (VIEW_INDEX < 0) return;
  VIEW_RETURN = document.activeElement;
  fillViewer(card);
  overlayOpen($("shot-viewer"));
  $("shot-viewer-close").focus();
}

function closeViewer() {
  overlayClose($("shot-viewer"), () => {
    const el = VIEW_RETURN;
    VIEW_RETURN = null;
    if (el && el.focus) el.focus();
  });
}

function navViewer(dir) {
  const list = doneCards();
  if (list.length < 2) return;
  VIEW_INDEX = (VIEW_INDEX + dir + list.length) % list.length;
  fillViewer(list[VIEW_INDEX], dir);
}

function isViewerOpen() {
  const el = $("shot-viewer");
  return !!(el && el.classList.contains("open") && el.dataset.closing !== "1");
}

function isTyping() {
  const el = document.activeElement;
  return !!el && (/^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable);
}

function handleViewerKeys(e) {
  if (!isViewerOpen()) return false;
  if (e.key === "Escape" || e.key === "Enter") {
    e.preventDefault();
    closeViewer();
    return true;
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    navViewer(-1);
    return true;
  }
  if (e.key === "ArrowRight") {
    e.preventDefault();
    navViewer(1);
    return true;
  }
  return true;
}

async function streamGen(body, onEvent, signal) {
  // 唯一送出提示詞的出口，括號跳脫放這裡就不會有哪條路徑漏掉。
  body = { ...body, positive: escapeForComfy(body.positive) };
  const res = await fetch("/api/gen", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal,
  });
  const ctype = res.headers.get("content-type") || "";
  if (!ctype.includes("event-stream")) {
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || "gen failed");
    onEvent("done", j);
    return;
  }
  if (!res.body) throw new Error("no stream");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      buf = buf.replace(/\r\n/g, "\n");
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let event = "message";
        const dataLines = [];
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) continue;
        let data;
        try {
          data = JSON.parse(dataLines.join(""));
        } catch {
          // 壞掉的一則不該賠掉整條串流 —— 下一則照收。
          continue;
        }
        onEvent(event, data);
        if (event === "done" || event === "error") return;
      }
    }
  } finally {
    // 提早 return（收到 done）也要把 body 收掉，連線才還得回瀏覽器的連線池。
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
}

function skipCurrentGen() {
  if (!running || aborting || skipping) return;
  // 兩張之間沒有正在跑的工作：這時把 skipping 立起來，只會被下一張在入口重設掉，
  // 使用者聽到「跳過這張」卻什麼也沒跳。
  if (!jobAbort) return;
  skipping = true;
  speak("跳過這張");
  try {
    jobAbort?.abort();
  } catch {
    /* ignore */
  }
}

function ensureMeter(el) {
  if (!el || el.querySelector(".meter")) return;
  const shot = el.querySelector(".shot");
  if (!shot) return;
  const meter = document.createElement("div");
  meter.className = "meter";
  meter.hidden = true;
  meter.innerHTML = "<i></i><span></span>";
  const skip = shot.querySelector(".skip-shot");
  if (skip) shot.insertBefore(meter, skip);
  else shot.append(meter);
}

function cancelRedoQueue() {
  const pending = redoQueue.splice(0, redoQueue.length);
  for (const card of pending) failCard(card, "已取消");
}

function resetCardForRedo(el) {
  el.classList.remove("is-done", "is-fail", "is-skip", "is-img-fail", "is-gen");
  el.classList.add("is-wait");
  const shot = el.querySelector(".shot");
  if (shot) {
    shot.removeAttribute("role");
    shot.removeAttribute("tabIndex");
    shot.removeAttribute("title");
    shot.removeAttribute("aria-label");
  }
  ensureMeter(el);
  const bar = el.querySelector(".bar");
  if (bar) bar.textContent = "排隊中…";
}

function queueRedo(card) {
  if (!card || !card.dataset.positive) return;
  if (card.classList.contains("is-gen")) return;
  if (redoQueue.includes(card)) return;
  resetCardForRedo(card);
  setLive(card, { status: "排隊中…" });
  if (running) {
    redoQueue.push(card);
    speak("已排到下一張");
    return;
  }
  speak("重新生成");
  runRedoSolo(card);
}

async function drainRedoQueue() {
  while (redoQueue.length && !aborting) {
    const card = redoQueue.shift();
    if (!card || !card.dataset.positive) continue;
    // 排隊期間可能已經被八格牆換掉了，重生一張看不到的卡是白做工。
    if (!card.isConnected) continue;
    await regenerateCard(card);
  }
}

// POS 的中文版本，送 Telegram 用。
function posZh(positive) {
  const out = [];
  for (const part of String(positive || "").split(",")) {
    const { tag } = parseWeighted(part);
    if (tag) out.push(labelOf(lex, tag));
  }
  return out.join("、");
}

function paintMustWarn(card, report) {
  const text = mustShortfall(report, (g) => (lex.data.groupZh || {})[g] || g);
  if (!text) return;
  const meta = card.querySelector(".meta");
  if (!meta || meta.querySelector(".must-miss")) return;
  const note = document.createElement("p");
  note.className = "warn must-miss";
  note.textContent = text + "（互斥或尺度擋住了，沒有硬湊）";
  meta.append(note);
}


/** §1／§2 進度回呼：只更新 status，不碰 results／POS。取消則回 { cancel: true }。 */
function drawStageHooks() {
  return {
    signal: genAbort ? genAbort.signal : undefined,
    onStage(event) {
      if (aborting || (genAbort && genAbort.signal.aborted)) return { cancel: true };
      if (event && event.stage === "intent") {
        const intent = event.intent || {};
        const bits = [intent.heat, intent.era].filter(Boolean);
        speak(bits.length ? `整理規則…（${bits.join(" · ")}）` : "整理規則…");
      } else if (event && event.stage === "composition") {
        speak("安排構圖…");
      }
      return aborting || (genAbort && genAbort.signal.aborted) ? { cancel: true } : undefined;
    },
  };
}

function finishBatch() {
  running = false;
  $("go").disabled = false;
  $("go").removeAttribute("aria-busy");
  $("cancel").hidden = true;
}

// 立刻斷：無限抽的「停」和左欄的「取消」共用這一條。
function stopNow(reason) {
  aborting = true;
  wallStale = true;
  stopInfinite(reason || "已停");
  cancelRedoQueue();
  speak(reason || "取消中…");
  try {
    genAbort?.abort();
  } catch {
    /* ignore */
  }
  // 這條是使用者自己按「停」／「取消」，全域中斷是對的：他要的就是現在停掉。
  fetch("/api/interrupt", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {
    /* ignore */
  });
}

async function streamCardJob(card, seedNum, extra) {
  let shot = null;
  skipping = false;
  jobAbort = new AbortController();
  card.classList.add("is-gen");
  card.classList.remove("is-wait");
  const stopJob = () => {
    try {
      jobAbort?.abort();
    } catch {
      /* ignore */
    }
  };
  // 看門狗。伺服器每 5 秒至少有一則心跳，所以靜默超過 STREAM_IDLE_MS 就是那條
  // 執行緒真的死了。沒有這個，await reader.read() 會無限期等下去 —— 畫面上是
  // 「抽並生圖」一直轉、進度條停在原地、沒有錯誤、失敗計數也不會動，整晚就這樣掛著。
  let stalled = false;
  let watchdog = 0;
  let jobPromptId = null;
  const kick = () => {
    window.clearTimeout(watchdog);
    watchdog = window.setTimeout(() => {
      stalled = true;
      stopJob();
    }, STREAM_IDLE_MS);
  };
  if (genAbort.signal.aborted) stopJob();
  else genAbort.signal.addEventListener("abort", stopJob, { once: true });
  try {
    let finished = false;
    let hadError = false;
    kick();
    // 哪些欄位屬於卡片、哪些屬於即時設定，統一由 jobFields() 決定 ——
    // 散在這裡寫就會像 rating 那樣漏掉一個沒人發現。
    // 下面這個物件裡除了 width / height / seed 之外都必須是 job.xxx，
    // test_client_contracts.mjs 會讀這段原始碼守住這件事。
    const job = jobFields(extra, {
      loras: currentLorasPayload(),
      ckpt: currentCkpt(),
      rating: settings.rating,
      workflowId: currentWorkflowId(),
    });
    await streamGen(
      {
        positive: job.positive,
        width: extra.width || settings.width,
        height: extra.height || settings.height,
        seed: seedNum,
        loras: job.loras,
        ckpt: job.ckpt,
        // 伺服器要靠這個決定負面詞。
        rating: job.rating,
        workflowId: job.workflowId,
      },
      (event, data) => {
        kick();
        // Comfy 的 /interrupt 不帶 prompt_id 就是全域中斷，會砍掉它當下正在跑
        // 的任何東西。記下這張是哪一個，中斷時才砍得準。
        if (data && data.prompt_id) jobPromptId = data.prompt_id;
        if (event === "queued") {
          setLive(card, { status: `排隊中 · seed ${data.seed || seedNum}` });
        } else if (event === "progress") {
          const max = data.max || 25;
          const value = data.value || 0;
          setLive(card, {
            status: `繪製 ${value}/${max}`,
            value,
            max,
          });
        } else if (event === "preview") {
          setLive(card, { image: data.image, status: "預覽…" });
        } else if (event === "done") {
          finished = true;
          if (skipping) skipCard(card);
          else {
            shot = { ...data, ...extra };
            fillCard(card, shot);
          }
        } else if (event === "error") {
          finished = true;
          hadError = true;
          lastJobError = String(data.error || "Comfy 報錯");
          if (skipping) skipCard(card);
          else failCard(card, lastJobError);
        }
      },
      jobAbort.signal
    );
    const kind = settleGenCard({ aborting, skipping, finished, hadError });
    if (kind === "skip") skipCard(card);
    else if (kind === "interrupt") throw new Error("生圖中斷");
  } catch (err) {
    if (stalled) {
      // 看門狗開的槍。算失敗（不是取消），連三張就會把無限抽收掉。
      lastJobError = `Comfy 靜默超過 ${Math.round(STREAM_IDLE_MS / 1000)} 秒，這張放棄`;
      failCard(card, lastJobError);
    } else {
      const kind = settleGenCard({ aborting, skipping, errName: err.name, finished: false });
      if (kind === "skip") skipCard(card);
      else if (kind === "cancel") failCard(card, "已取消");
      else {
        lastJobError = String(err.message || err);
        failCard(card, lastJobError);
      }
    }
  } finally {
    window.clearTimeout(watchdog);
    genAbort.signal.removeEventListener("abort", stopJob);
    endGenCard(card);
    const skipNow = skipping;
    skipping = false;
    jobAbort = null;
    if (skipNow || stalled) {
      try {
        await fetch("/api/interrupt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(jobPromptId ? { prompt_id: jobPromptId } : {}),
        });
      } catch {
        /* ignore */
      }
    }
  }
  // 投 Telegram 放在這裡，所以一般抽、重抽佇列、單張重新生成三條路都會送。
  // 不 await —— 伺服器收下就回，送圖再慢也不拖抽圖。
  if (shot) {
    const zh = posZh(extra.positive);
    tgSendCard(card, shot, zh);
    dcSendCard(card, shot, zh);
  }
  return shot;
}

async function regenerateCard(card) {
  const seedNum = randomSeed();
  card.dataset.seed = String(seedNum);
  let loras = currentLorasPayload();
  try {
    if (card.dataset.loras) loras = JSON.parse(card.dataset.loras);
  } catch {
    /* keep current */
  }
  const extra = {
    positive: card.dataset.positive,
    era: card.dataset.era,
    eraClash: [],
    loras,
    ckpt: card.dataset.ckpt || currentCkpt(),
    rating: card.dataset.rating || "",
    workflowId: card.dataset.workflowId != null ? card.dataset.workflowId : currentWorkflowId(),
  };
  showPos(extra.positive);
  setLive(card, { status: "重新生成…" });
  await streamCardJob(card, seedNum, extra);
}

async function runRedoSolo(card) {
  if (running) {
    if (!redoQueue.includes(card)) redoQueue.push(card);
    return;
  }
  if (!(await comfyUp())) {
    speak("ComfyUI 連不上，先開本機 8188");
    failCard(card, "ComfyUI 連不上");
    return;
  }
  running = true;
  aborting = false;
  skipping = false;
  genAbort = new AbortController();
  $("go").disabled = true;
  $("go").setAttribute("aria-busy", "true");
  $("cancel").hidden = false;
  try {
    await regenerateCard(card);
    await drainRedoQueue();
  } finally {
    if (aborting) cancelRedoQueue();
    running = false;
    $("go").disabled = false;
    $("go").removeAttribute("aria-busy");
    $("cancel").hidden = true;
  }
}


function freezeIntentSnap(settingsObj, pinnedSet, bannedSet) {
  return JSON.stringify({
    settings: {
      rating: settingsObj.rating,
      heats: [...(settingsObj.heats || [])],
      eras: [...(settingsObj.eras || [])],
      n: settingsObj.n,
      width: settingsObj.width,
      height: settingsObj.height,
      samePerson: !!settingsObj.samePerson,
      drawJob: !!settingsObj.drawJob,
      counts: { ...(settingsObj.counts || {}) },
      mustDraw: { ...(settingsObj.mustDraw || {}) },
      lockScene: settingsObj.lockScene !== false,
      sceneMode: sceneModeOf(settingsObj),
    },
    pinned: [...pinnedSet],
    banned: [...bannedSet],
  });
}

async function runSameSeedFromCard(card) {
  if (!card || running) {
    speak(running ? "正在抽圖，結束後再同種子重抽" : "找不到成片");
    return;
  }
  let snap;
  try {
    snap = JSON.parse(card.dataset.intentSnap || "");
  } catch {
    snap = null;
  }
  if (!snap || !snap.settings || card.dataset.seed == null || card.dataset.seed === "") {
    speak("這張沒留下場記，不能同種子重抽");
    return;
  }
  const seedNum = Number(card.dataset.seed) >>> 0;
  if (!(await comfyUp())) {
    speak("Comfy 連不上，先開本機 8188");
    return;
  }
  running = true;
  aborting = false;
  skipping = false;
  genAbort = new AbortController();
  $("go").disabled = true;
  $("go").setAttribute("aria-busy", "true");
  $("cancel").hidden = false;
  try {
    const frozenSettings = { ...settings, ...snap.settings };
    const drawn = drawWithSeed(
      lex,
      frozenSettings,
      new Set(snap.pinned || []),
      new Set(snap.banned || []),
      seedNum,
      {
        trace: true,
        presetOwned: ownedTagSet(presetOwned),
        ...drawStageHooks(),
      }
    );
    if (drawn.cancelled) {
      speak("已取消");
      return;
    }
    if (!drawn.positive) {
      speak("同種子重抽得到空 POS");
      return;
    }
    card.dataset.bare = drawn.positive;
    card.dataset.era = drawn.era || card.dataset.era || "";
    const pos = weightedPos(drawn.positive);
    const trigger = currentTriggerText();
    const sent = insertTriggerAfterCast(pos, trigger);
    card.dataset.positive = sent;
    card.dataset.trigger = trigger;
    card._recipe = recipeFromDraw(drawn, sent, seedNum);
    showPos(sent);
    setPosLine(card, sent);
    setLive(card, { status: `同種子重抽 · seed ${seedNum}` });
    paintMustWarn(card, drawn.mustReport);
    paintPinMiss(card);
    await streamCardJob(card, seedNum, {
      positive: sent,
      era: drawn.era,
      eraClash: drawn.eraClash,
      loras: currentLorasPayload(),
      ckpt: currentCkpt(),
      workflowId: currentWorkflowId(),
    });
    speak(card.classList.contains("is-done") ? "同種子重抽完成" : "同種子重抽未完成");
  } catch (err) {
    speak("同種子重抽失敗");
    reportCrash("同種子重抽", err);
  } finally {
    finishBatch();
  }
}

async function runBatch() {
  if (running) return;
  running = true;
  aborting = false;
  skipping = false;
  genAbort = new AbortController();
  $("go").disabled = true;
  $("go").setAttribute("aria-busy", "true");
  $("cancel").hidden = false;
  pop($("go"));

  // 這些要活在 try 外面，finally 才收得乾淨。
  let done = 0;
  let skipped = 0;
  let failed = 0;
  let stoppedByFail = false;
  let crashed = false;

  // 整段包 try/finally。以前這裡是裸的 —— drawOne()、placeCard()、任何一處丟例外，
  // finishBatch() 就永遠跑不到：running 卡在 true、「抽並生圖」永遠 disabled 又
  // aria-busy（就是那個一直轉但不生圖的狀態）、無限抽的續跑也接不上，只能重整頁面。
  try {
    const n = Math.max(1, Math.floor(Number($("n").value) || 1));
    settings.n = n;
    saveStore();

    if (!(await comfyUp())) {
      speak("ComfyUI 連不上，先開本機 8188");
      stopInfinite("Comfy 連不上");
      return;
    }

    // 上一輪是被取消掉的話，這次從乾淨的牆開始，不要留著半成品。
    if (wallStale) {
      resetWall();
      wallStale = false;
    }
    beginRound();
    // 八格牆平常是連續的：不再每輪清空。只有牆是空的才把畫面捲過去。
    if (!wallHasCards()) $("results").scrollIntoView({ behavior: "smooth", block: "start" });

    let ident = new Set();

    let identBan = new Set();

    for (let i = 0; i < n; i++) {
      if (aborting) {
        speak("已取消");
        cancelRedoQueue();
        break;
      }
      await drainRedoQueue();
      if (aborting) {
        speak("已取消");
        cancelRedoQueue();
        break;
      }
      speak(`生圖 ${i + 1}/${n}`);
      const seedNum = randomSeed();
      const rng = mulberry32(seedNum);
      const pinForDraw =
        settings.samePerson && ident.size ? new Set([...pinned, ...ident]) : pinned;
      // 釘住第一張有的，同時禁掉第一張沒有的 —— 只做前者的話，第一張留空的欄位
      // 在後面幾張會被自由補上，同一個人會突然長出呆毛或變得肌肉發達。
      const banForDraw =
        settings.samePerson && identBan.size
          ? new Set([...userBanned, ...identBan])
          : userBanned;
      const drawn = drawOne(lex, settings, pinForDraw, banForDraw, rng, seedNum, {
        trace: true,
        presetOwned: ownedTagSet(presetOwned),
        ...drawStageHooks(),
      });
      // 取消停在 Intent／Composition：不建卡、不暴露半套 POS。
      if (drawn.cancelled) {
        speak("場記取消，不成片");
        const results = $("results");
        if (results) {
          results.classList.remove("is-slating");
          delete results.dataset.slate;
        }
        cancelRedoQueue();
        break;
      }
      if (settings.samePerson && ident.size === 0) {
        ident = identityPins(lex, drawn.positive);
        identBan = identityBans(lex, drawn.positive);
        lastIdent = ident;
        syncSamePerson();
      }
      // 卡片是現做的，不再預先建 n 張 —— 一次幾張已經沒有上限。
      const card = placeCard(cardSkeleton(settings.width, settings.height));
      markLive(card);
      card.dataset.seed = String(drawn.seed);
      card.dataset.intentSnap = freezeIntentSnap(settings, pinForDraw, banForDraw);
      card.dataset.era = drawn.era || "";
      card.dataset.bare = drawn.positive;
      card.dataset.pinsAtDraw = JSON.stringify([...pinned]);
      const pos = weightedPos(drawn.positive);
      const trigger = currentTriggerText();
      const sent = insertTriggerAfterCast(pos, trigger);
      card.dataset.positive = sent;
      card.dataset.trigger = trigger;
      card.dataset.rating = settings.rating || "explicit";
      card.dataset.loras = JSON.stringify(currentLorasPayload());
      card.dataset.ckpt = currentCkpt() || "";
      card.dataset.workflowId = currentWorkflowId();
      card._recipe = recipeFromDraw(drawn, sent, seedNum);
      if (settings.samePerson && i > 0) {
        card.dataset.same = "1";
        const shot = card.querySelector(".shot");
        if (shot && !shot.querySelector(".same-mark")) {
          const mark = document.createElement("span");
          mark.className = "same-mark";
          mark.textContent = "同 #1";
          shot.append(mark);
        }
      }
      showPos(sent);
      setPosLine(card, sent);
      setLive(card, { status: `抽好了，生圖 ${i + 1}/${n}…` });
      lastJobError = "";
      await streamCardJob(card, seedNum, {
        positive: sent,
        era: drawn.era,
        eraClash: drawn.eraClash,
        loras: currentLorasPayload(),
        ckpt: currentCkpt(),
        workflowId: currentWorkflowId(),
      });
      clearLive(card);

      if (card.classList.contains("is-done")) {
        done += 1;
        failStreak = 0;
        paintMustWarn(card, drawn.mustReport);
      } else if (card.classList.contains("is-skip")) {
        skipped += 1;
      } else if (!aborting) {
        failed += 1;
        failStreak += 1;
      }

      // 連續三張失敗就收工，免得 Comfy 掛了還空轉一整晚。一次幾張已經沒有上限，
      // 所以一般批次也適用 —— 但兩種情況都要明講，不能安靜地少抽一堆。
      if (failStreak >= FAIL_LIMIT) {
        stoppedByFail = true;
        const why = lastJobError || "Comfy 沒回";
        cancelRedoQueue();
        if (stopInfinite(`連續 ${FAIL_LIMIT} 張失敗，已停`)) {
          speak(`連續 ${FAIL_LIMIT} 張失敗，無限抽已停：${why}`);
        } else {
          speak(`連續 ${FAIL_LIMIT} 張失敗，剩下的 ${n - i - 1} 張不抽了：${why}`);
        }
        break;
      }

      if (!aborting) await drainRedoQueue();
    }
    if (!aborting && !stoppedByFail) await drainRedoQueue();
    if (aborting) cancelRedoQueue();
  } catch (err) {
    crashed = true;
    stoppedByFail = true;
    cancelRedoQueue();
    stopInfinite("抽圖出錯，已停");
    reportCrash("抽圖中斷", err);
  } finally {
    countMade(done);
    finishBatch();
  }

  if (!crashed && !aborting && !stoppedByFail) {
    const bits = [`完成 ${done} 張`];
    if (skipped) bits.push(`跳過 ${skipped} 張`);
    if (failed) bits.push(`失敗 ${failed} 張`);
    speak(bits.join("，"));
  }

  // 還開著就接下一輪。用 setTimeout 排隊而不是遞迴，呼叫堆疊不會累積。
  if (isInfinite() && !aborting) queueNextRound();
}

// 續跑。舊寫法是 `if (isInfinite() && !running) runBatch()` —— running 剛好還沒放掉
// （有人在這個空檔按了單張重新生成）就直接放棄，開關還亮著「停」，但整晚不會再抽一張。
// 現在會等，而且等不到就講清楚為什麼停。
function queueNextRound(tries = 0) {
  window.setTimeout(
    () => {
      if (!isInfinite() || aborting) return;
      if (running) {
        if (tries < 600) queueNextRound(tries + 1);
        else stopInfinite("等不到上一張做完，已停");
        return;
      }
      runBatch();
    },
    tries ? 500 : 0
  );
}

function bindUi() {
  const tagSel = ".tag[data-tag], .pos span[data-tag]";
  const onWeightClick = (e) => {
    const flag = e.target.closest(".w-flag");
    if (!flag) return false;
    const host = flag.closest(tagSel);
    if (!host || !host.dataset.tag) return false;
    e.preventDefault();
    e.stopPropagation();
    if (weightPopTag === host.dataset.tag && weightPopOpen()) closeWeightPop();
    else openWeightPop(host);
    return true;
  };
  $("cats").addEventListener("click", (e) => {
    if (onWeightClick(e)) return;
    const closer = e.target.closest("[data-close]");
    if (closer) {
      const scope = closer.closest(".sub") || closer.closest(".cat");
      const tags = [];
      if (scope) {
        for (const btn of scope.querySelectorAll(".tag[data-tag]")) {
          if (!btn.hidden && btn.dataset.locked !== "1") tags.push(btn.dataset.tag);
        }
      }
      toggleBanTags(tags);
      return;
    }
    const tagBtn = e.target.closest(".tag[data-tag]");
    if (tagBtn && !tagBtn.disabled && tagBtn.dataset.locked !== "1") {
      onTagClick(tagBtn.dataset.tag);
      return;
    }
    const toggle = e.target.closest(".cat-toggle");
    if (toggle) {
      const cat = toggle.closest(".cat");
      const opened = !cat.classList.contains("is-open");
      applyCatOpen(cat, opened);
      if (opened) userOpen.add(cat.id);
      else userOpen.delete(cat.id);
    }
  });
  const trayPins = $("tray-pins");
  if (trayPins) {
    trayPins.addEventListener("click", (e) => {
      if (onWeightClick(e)) return;
      const btn = e.target.closest(".tag[data-tag]");
      if (!btn || btn.disabled || btn.dataset.locked === "1") return;
      const tag = btn.dataset.tag;
      // 在「必進這張圖」裡點掉一個字 = 取消必進，不是封鎖它。之後它仍然可以被隨機
      // 抽到。要封鎖請到下面的詞庫點第二下，這裡不替使用者決定。
      if (pinned.has(tag)) {
        ({ pinned, userBanned } = applyClear(pinned, userBanned, tag));
        afterPin();
        speak(`已取消必進：${labelOf(lex, tag)}`);
        return;
      }
      onTagClick(tag);
    });
  }
  $("results").addEventListener("click", (e) => {
    if (e.target.closest(".skip-shot")) {
      e.preventDefault();
      e.stopPropagation();
      skipCurrentGen();
      return;
    }
    if (e.target.closest(".redo-shot")) {
      e.preventDefault();
      e.stopPropagation();
      queueRedo(e.target.closest(".card"));
      return;
    }
    if (e.target.closest(".same-seed")) {
      e.preventDefault();
      e.stopPropagation();
      runSameSeedFromCard(e.target.closest(".card"));
      return;
    }
    if (onWeightClick(e)) return;
    if (e.target.closest(".copy")) return;
    const card = e.target.closest(".card.is-done");
    if (card && e.target.closest(".shot")) {
      openViewer(card);
      return;
    }
    const span = e.target.closest(".pos span[data-tag]");
    if (!span || span.dataset.locked === "1") return;
    onTagClick(span.dataset.tag);
  });
  $("results").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.closest(".redo-shot") || e.target.closest(".skip-shot")) return;
    const shot = e.target.closest(".card.is-done .shot");
    if (!shot) return;
    e.preventDefault();
    e.stopPropagation();
    openViewer(shot.closest(".card"));
  });
  document.addEventListener("pointerdown", (e) => {
    const pop = $("w-pop");
    if (!pop || !pop.classList.contains("is-open")) return;
    if (pop.contains(e.target) || e.target.closest(".w-flag")) return;
    closeWeightPop({ keepFocus: true });
  });
  document.addEventListener("keydown", (e) => {
    const pop = $("w-pop");
    if (!pop || !pop.classList.contains("is-open") || !weightPopTag) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeWeightPop();
      return;
    }
    if (isTyping()) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeWeightPop();
      return;
    }
    if (e.key === "ArrowUp" || e.key === "+" || e.key === "=") {
      e.preventDefault();
      e.stopImmediatePropagation();
      onTagWeight(weightPopTag, 1);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "-") {
      e.preventDefault();
      e.stopImmediatePropagation();
      onTagWeight(weightPopTag, -1);
    }
  });
  // 這兩個都帶著事件物件呼叫，不能直接掛 closeWeightPop（第一個參數會變成 Event）。
  const closeWeightPopOnViewport = () => closeWeightPop();
  window.addEventListener("scroll", closeWeightPopOnViewport, true);
  window.addEventListener("resize", closeWeightPopOnViewport);
  $("n").addEventListener("change", () => {
    settings.n = Math.max(1, Math.min(10, Number($("n").value) || 1));
    syncSamePerson();
    saveStore();
  });
  const sameBtn = $("same-person");
  if (sameBtn) {
    sameBtn.addEventListener("click", () => {
      settings.samePerson = !settings.samePerson;
      if (settings.samePerson && settings.n < 2) {
        settings.n = 2;
        $("n").value = "2";
        speak("一次改成 2 張，鎖同一張臉");
      }
      if (!settings.samePerson) lastIdent = new Set();
      syncSamePerson();
      saveStore();
    });
  }
  for (const nav of document.querySelectorAll(".jump")) {
    nav.addEventListener("click", (e) => {
      const a = e.target.closest("a[href^='#sec-']");
      if (!a) return;
      e.preventDefault();
      const wrap = document.getElementById(a.hash.slice(1));
      if (!wrap) return;
      // 手機上多了一個「規則」跳點，指的是設定欄，不是分類區塊。
      if (!wrap.classList.contains("cat")) {
        wrap.scrollIntoView({ block: "start" });
        return;
      }
      userOpen.add(wrap.id);
      applyCatOpen(wrap, true);
      if (location.hash !== a.hash) location.hash = a.hash;
      else wrap.scrollIntoView({ block: "start" });
    });
  }
  $("girl").addEventListener("click", () => {
    settings.girl = true;
    settings.boy = false;
    saveStore();
    syncCast();
    renderCats("filter");
  });
  $("boy").addEventListener("click", () => {
    settings.girl = false;
    settings.boy = true;
    saveStore();
    syncCast();
    renderCats("filter");
  });
  $("cast-any").addEventListener("click", () => {
    settings.girl = true;
    settings.boy = true;
    saveStore();
    syncCast();
    renderCats("filter");
  });
  $("sizes").addEventListener("click", (e) => {
    const btn = e.target.closest(".seg");
    if (!btn) return;
    settings.width = Number(btn.dataset.w);
    settings.height = Number(btn.dataset.h);
    syncSizeButtons();
    saveStore();
  });
  for (const id of ["width", "height"]) {
    $(id).addEventListener("change", () => {
      settings.width = Math.max(256, Math.min(2048, Number($("width").value) || 1024));
      settings.height = Math.max(256, Math.min(2048, Number($("height").value) || 1024));
      syncSizeButtons();
      saveStore();
    });
  }
  $("heats").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-heat]");
    if (btn) pickHeat(btn.dataset.heat);
  });
  let searchTimer = 0;
  window.addEventListener("hashchange", () => {
    const wrap = location.hash ? document.getElementById(location.hash.slice(1)) : null;
    if (!wrap || !wrap.classList.contains("cat")) return;
    userOpen.add(wrap.id);
    applyCatOpen(wrap, true);
  });
  $("q").addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => renderCats("search"), 120);
  });
  $("q").addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("q").value) return;
    $("q").value = "";
    renderCats("search");
    playCatsSwap();
  });
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (handleViewerKeys(e)) return;
    if (tgHandleKeys(e)) return;
    if (dcHandleKeys(e)) return;
    if (wfHandleKeys(e)) return;
    if (albumHandleKeys(e)) return;
    if (handleLoraKeys(e)) return;
    if (isTyping()) return;
    if (e.key === "i" || e.key === "I") {
      e.preventDefault();
      $("infinite")?.click();
      return;
    }
    if (e.key === "w" || e.key === "W") {
      if (!openWeightPopFromFocus()) return;
      e.preventDefault();
      return;
    }
    if (e.key === "/") {
      e.preventDefault();
      $("q").focus();
      return;
    }
    if (e.key === "Enter") {
      if (isLoraUiOpen() || isViewerOpen() || tgUiOpen() || dcUiOpen() || workflowUiOpen() || running) return;
      e.preventDefault();
      runBatch();
    }
  });
  $("view-filters").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (btn) {
      viewMode = btn.dataset.view;
      renderCats("search");
      playCatsSwap();
      return;
    }
    if (e.target.closest("#era-only")) {
      eraOnly = !eraOnly;
      renderCats("search");
      playCatsSwap();
    }
  });
  // 這顆鈕一直同時清掉釘選和封禁，字面卻只講釘選；而且隔壁兩顆清除都會出聲，
  // 只有它靜悄悄。一次按錯就是幾十個字沒了，所以除了正名和播報，再給一個復原窗：
  // 按完原地變成「復原」，七秒內按得回來。快照只留一份，不做多層 undo。
  const clearPins = $("clear-pins");
  const clearPinsLabel = clearPins.textContent;
  let clearedSnapshot = null;
  let clearedTimer = 0;
  // 清除本身和復原本身都會呼叫 afterPin，那兩次不算「使用者又動了釘選」。
  let clearing = false;
  let restoring = false;
  onPinsTouched = () => {
    if (clearing || restoring || !clearedSnapshot) return;
    endClearUndo();
  };
  const endClearUndo = () => {
    window.clearTimeout(clearedTimer);
    clearedTimer = 0;
    clearedSnapshot = null;
    clearPins.textContent = clearPinsLabel;
    delete clearPins.dataset.undo;
  };
  clearPins.addEventListener("click", () => {
    if (clearedSnapshot) {
      pinned = new Set(clearedSnapshot.pinned);
      userBanned = new Set(clearedSnapshot.userBanned);
      presetOwned = clearedSnapshot.presetOwned;
      endClearUndo();
      restoring = true;
      afterPin();
      restoring = false;
      speak("已復原");
      return;
    }
    const nPin = pinned.size;
    const nBan = userBanned.size;
    if (!nPin && !nBan) {
      speak("本來就沒有釘選或關掉的字");
      return;
    }
    clearedSnapshot = { pinned: new Set(pinned), userBanned: new Set(userBanned), presetOwned };
    pinned = new Set();
    userBanned = new Set();
    clearing = true;
    afterPin();
    clearing = false;
    const bits = [];
    if (nPin) bits.push(`${nPin} 個釘選`);
    if (nBan) bits.push(`${nBan} 個關掉`);
    speak(`已清除 ${bits.join("、")}，七秒內可以按同一顆鈕復原`);
    clearPins.textContent = "復原清除";
    clearPins.dataset.undo = "1";
    window.clearTimeout(clearedTimer);
    clearedTimer = window.setTimeout(endClearUndo, 7000);
  });
  const drawJobBtn = $("draw-job");
  if (drawJobBtn) {
    drawJobBtn.addEventListener("click", () => {
      settings.drawJob = !settings.drawJob;
      syncDrawJob();
      saveStore();
    });
  }
  document.querySelectorAll("[data-scene-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.sceneMode;
      settings.sceneMode = mode;
      settings.lockScene = mode !== "weird";
      syncSceneMode();
      saveStore();
    });
  });
  const presetBox = $("presets");
  if (presetBox) {
    presetBox.addEventListener("click", (e) => {
      const activityToggle = e.target.closest("#pin-sport-activity");
      if (activityToggle) {
        settings.pinSportActivity = !settings.pinSportActivity;
        saveStore();
        renderPresets();
        updateHeatClash();
        speak(settings.pinSportActivity ? "運動動作會一起加入必進" : "運動動作改為依尺度自動抽取");
        return;
      }
      const x = e.target.closest(".preset-x");
      if (x) {
        const wrap = x.closest("[data-user]");
        const i = Number(wrap && wrap.dataset.user);
        if (Number.isInteger(i) && i >= 0) {
          userPresets = userPresets.filter((_, j) => j !== i);
          saveStore();
          renderPresets();
        }
        return;
      }
      const builtin = e.target.closest("[data-preset]");
      if (builtin) {
        const p = BUILTIN_PRESETS.find((x) => x.id === builtin.dataset.preset);
        if (p) applyNamedPreset(presetWithCurrentOptions(p));
        return;
      }
      const user = e.target.closest("[data-user]");
      if (user) {
        const i = Number(user.dataset.user);
        const p = userPresets[i];
        if (p) applyNamedPreset({ id: userPresetId(p), tags: p.tags });
      }
    });
  }
  const savePreset = $("save-preset");
  if (savePreset) {
    savePreset.addEventListener("click", () => {
      const tags = [...pinned];
      if (!tags.length) {
        speak("先釘幾個字再存");
        return;
      }
      const name = window.prompt("組合名稱", "");
      if (name == null) return;
      // sanitize 會把空白名稱、重名、第 17 組默默丟掉。以前這裡不看結果就喊
      // 「已存」，於是最容易撞到的三種情形全都是「畫面說存好了，其實沒有」。
      const res = addPinPreset(userPresets, { name, tags }, lex);
      if (!res.ok) {
        speak(
          res.reason === "empty"
            ? "組合要有名字才存得起來"
            : res.reason === "duplicate"
              ? `已經有一組叫「${res.name}」了，換個名字`
              : res.reason === "full"
                ? `最多 ${PIN_PRESET_LIMIT} 組，先按 × 刪掉一組`
                : "這些字不在詞庫裡，存不起來",
        );
        return;
      }
      userPresets = res.list;
      saveStore();
      renderPresets();
      speak(`已存「${res.name}」`);
    });
  }
  const weightsBtn = $("clear-weights");
  if (weightsBtn && !$("clear-must") && weightsBtn.parentNode) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost";
    btn.id = "clear-must";
    btn.textContent = "清除必抽";
    btn.addEventListener("click", () => {
      const n = clearAllMustDraw();
      speak(n ? `已清除 ${n} 個必抽` : "本來就沒有必抽");
    });
    weightsBtn.parentNode.insertBefore(btn, weightsBtn.nextSibling);
  }
  const clearW = $("clear-weights");
  if (clearW) {
    clearW.addEventListener("click", () => {
      tagWeights = new Map();
      refreshWeights();
      paintWeightPop();
      speak("權重已清掉");
    });
  }
  $("go").addEventListener("click", () => {
    stopInfinite();
    runBatch();
  });
  $("cancel").addEventListener("click", () => stopNow("取消中…"));
}

function bootNote(text, cls) {
  const stage = $("cats") || document.body;
  const p = document.createElement("p");
  p.className = cls;
  if (cls === "boot-error") p.setAttribute("role", "alert");
  p.textContent = text;
  stage.prepend(p);
  return p;
}

// 手機上分類列要能一路跟著，不只在詞庫那一段有效。
// sticky 只在父層的框裡有效，而 .jump 原本住在 .filter-bar 裡（整個只有 165px 高），
// 所以一滑進設定區就消失。窄螢幕時把它搬到 .shell 前面當頁面層的 sticky，寬螢幕再搬回去。
function pinJumpNav() {
  const jump = document.querySelector(".jump");
  const bar = document.querySelector(".filter-bar");
  const shell = document.querySelector(".shell");
  if (!jump || !bar || !shell || !shell.parentElement) return;
  const mq = matchMedia("(max-width: 900px)");
  const apply = () => {
    if (mq.matches) {
      if (jump.parentElement !== shell.parentElement) {
        shell.parentElement.insertBefore(jump, shell);
      }
      jump.classList.add("is-pinned");
    } else {
      if (jump.parentElement !== bar) bar.insertBefore(jump, bar.firstChild);
      jump.classList.remove("is-pinned");
    }
  };
  apply();
  mq.addEventListener("change", apply);
}

// 頂欄與底欄的高度是算出來的，不是猜的：頂欄在手機上會換行，底欄按鈕也會折成兩排。
// 之前 CSS 裡寫死 3.4rem / 72px，一換行就對不上，篩選列會鑽到頂欄底下、最後一列內容會被底欄蓋住。
function trackChrome() {
  const root = document.documentElement;
  const mast = document.querySelector(".mast");
  const dock = document.querySelector(".dock");
  const filter = document.querySelector(".filter-bar");
  const jump = document.querySelector(".jump");
  const measure = () => {
    if (mast) root.style.setProperty("--mast-h", `${Math.round(mast.offsetHeight)}px`);
    if (dock) root.style.setProperty("--dock-h", `${Math.round(dock.offsetHeight)}px`);
    // 分類標題要跳到篩選列底下，不是跳到被它蓋住的位置。
    if (filter) root.style.setProperty("--filter-h", `${Math.round(filter.offsetHeight)}px`);
    if (jump) root.style.setProperty("--jump-h", `${Math.round(jump.offsetHeight)}px`);
  };
  measure();
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(measure);
    if (mast) ro.observe(mast);
    if (dock) ro.observe(dock);
    if (filter) ro.observe(filter);
    if (jump) ro.observe(jump);
  } else {
    addEventListener("resize", measure);
  }
  // 網頁字體晚到，到了以後行高會變。
  document.fonts?.ready?.then(measure);
}

// 開機期間把過場關掉，等狀態都套上去再打開。理由與收尾時機寫在 boot.css 的
// html.is-booting 那一段。保底的 timeout 是必要的：main() 中途丟例外時，
// 沒有它整站的動效會永久關死。
function startBooting() {
  const root = document.documentElement;
  root.classList.add("is-booting");
  const done = () => root.classList.remove("is-booting");
  // 保底：main() 中途丟例外時，沒有這個整站動效會永久關死。
  window.setTimeout(done, 4000);
  return () => {
    // rAF 是首選（保證「下一次真的上畫面之後」才開），但分頁在背景時 rAF 會被
    // 節流甚至完全不跑 —— 實測在隱藏的分頁裡兩個 frame 一直沒來，動效就這樣卡著。
    // 所以配一個短 timeout 一起搶，誰先到算誰的。remove 是冪等的，搶兩次沒差。
    requestAnimationFrame(() => requestAnimationFrame(done));
    window.setTimeout(done, 60);
  };
}

async function main() {
  const bootingDone = startBooting();
  watchForCrashes();
  // lexicon.json is ~340 KB, so say something instead of showing an empty shell.
  const loading = bootNote("詞庫載入中…", "boot-load");
  let data;
  try {
    const r = await fetch("lexicon.json");
    if (!r.ok) throw new Error("lexicon.json HTTP " + r.status);
    data = await r.json();
    if (!data || !Array.isArray(data.tags)) throw new Error("lexicon.json 格式不對");
  } catch (err) {
    loading.remove();
    bootNote("詞庫載入失敗：" + (err && err.message ? err.message : String(err)), "boot-error");
    return;
  }
  // CLIP token 數。算不出來不該擋住抽圖，失敗就靜靜降級成只顯示標籤數。
  try {
    const rt = await fetch("token_counts.json");
    if (rt.ok) tokenTable = await rt.json();
  } catch {
    tokenTable = null;
  }
  loading.remove();
  lex = indexLexicon(data);
  settings = defaultSettings(data);
  const saved = loadStore();
  if (saved.settings) settings = sanitizeSettings(saved.settings, data);
  if (Array.isArray(saved.pinned)) pinned = new Set(knownTags(lex, saved.pinned));
  presetOwned = prunePresetOwned(sanitizePresetOwned(saved.presetOwned, lex), pinned, lex);
  userPresets = sanitizePinPresets(saved.pinPresets, lex);
  if (Array.isArray(saved.userBanned)) userBanned = new Set(knownTags(lex, saved.userBanned));
  if (saved.tagWeights && typeof saved.tagWeights === "object") {
    tagWeights = new Map(
      Object.entries(saved.tagWeights).filter(
        ([t, w]) => lex.byTag.has(t) && Number.isFinite(Number(w)) && Number(w) > 0 && Number(w) !== 1
      )
    );
  }
  saveStore();

  $("n").value = String(settings.n);
  syncSamePerson();
  syncCast();
  renderCounts();
  syncSizeButtons();
  syncHeat();
  syncDrawJob();
  syncSceneMode();
  renderPresets();
  initMustDraw({
    get: (key) => Number(settings.mustDraw?.[key]) || 0,
    set: (key, n) => {
      if (!settings.mustDraw || typeof settings.mustDraw !== "object") settings.mustDraw = {};
      if (n > 0) settings.mustDraw[key] = n;
      else delete settings.mustDraw[key];
      saveStore();
    },
  });
  renderEras();
  renderCats();
  renderTray();
  bindUi();
  initLoraPicker();
  {
    const group = $("rating");
    const btns = ratingButtons();
    for (const btn of btns) {
      btn.addEventListener("click", () => setRating(btn.dataset.rating));
    }
    // 方向鍵在組內移動並直接套用（分段控制項的慣例：移到哪就是選到哪）。
    group?.addEventListener("keydown", (e) => {
      const list = ratingButtons();
      const at = list.indexOf(document.activeElement);
      if (at < 0) return;
      let to = -1;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") to = (at - 1 + list.length) % list.length;
      else if (e.key === "ArrowRight" || e.key === "ArrowDown") to = (at + 1) % list.length;
      else if (e.key === "Home") to = 0;
      else if (e.key === "End") to = list.length - 1;
      if (to < 0) return;
      e.preventDefault();
      setRating(list[to].dataset.rating);
      // setRating 之後 tabindex 才會更新，所以聚焦要放在後面。
      list[to].focus();
    });
    // 欄寬變了色塊就要跟著重量 —— 側欄會隨視窗縮放，字體載入完成也會改變按鈕寬度。
    if (group && typeof ResizeObserver === "function") {
      new ResizeObserver(() => moveRatingThumb()).observe(group);
    }
    // 網頁字體晚一點才到，到了之後寬度會變。
    document.fonts?.ready?.then(() => moveRatingThumb());
  }
  syncRating();
  pinJumpNav();
  trackChrome();
  initTelegram();
  initDiscord();
  initServiceSettings();
  initWorkflow();
  initAlbum({
    speak,
    applyRecipe: applyRecipeToBench,
    generateFromRecipe,
    onFavChange() {
      for (const card of document.querySelectorAll(".card")) paintFavButton(card);
    },
  });
  window.tagCaseCommands = createCommands({
    pin(tag) {
      const next = applyPin(lex, pinned, userBanned, tag);
      pinned = next.pinned;
      userBanned = next.userBanned;
      afterPin();
    },
    ban(tag) {
      const next = applyBan(lex, pinned, userBanned, tag);
      pinned = next.pinned;
      userBanned = next.userBanned;
      afterPin();
    },
    applyRecipe: applyRecipeToBench,
    generate: generateFromRecipe,
  });
  initInfinite({
    onStart: () => {
      failStreak = 0;
      if (!running) runBatch();
    },
    onStop: () => stopNow("已停"),
  });
  syncMustDraw();
  // 狀態都套上去了，從下一個 frame 起才讓過場生效。
  bootingDone();
  ping();
  setInterval(ping, 15000);
}

main();
