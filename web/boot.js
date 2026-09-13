import {
  applyBan,
  applyClear,
  autoBannedFromPins,
  cycleTag,
  defaultSettings,
  drawOne,
  sceneModeOf,
  identityPins,
  isIdentityItem,
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
  itemFitsHeats,
  FEMALE_COUNT,
  indexLexicon,
  labelOf,
  MALE_COUNT,
  pinMissLine,
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
  settleGenCard,
  randomSeed,
  tagState,
  BUILTIN_PRESETS,
  sanitizePinPresets,
  presetState,
  sportHeatWarnings,
  togglePresetTags,
} from "./engine.js";
import {
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
  wallHasCards,
} from "./infinite.js";
import { initTelegram, tgHandleKeys, tgSendCard, tgUiOpen } from "./telegram.js";
import { initMustDraw, mustShortfall, mustStepper, syncMustDraw } from "./mustdraw.js";

const SECTIONS = [
  { id: "quality", title: "畫質與風格", hint: "固定畫質每張都帶。風格預設不進，釘了才進" },
  { id: "subject", title: "人數", hint: "跟左欄走。只開女就不會看到男生的字" },
  { id: "feature", title: "長相", hint: "髮、眼、身材。有男時可抽種族，同類只一個" },
  { id: "pose", title: "姿勢", hint: "先身體和鏡頭。活動／誘惑／走光會抽一格活動；性愛補體位、不抽逛街開車" },
  { id: "clothing", title: "服裝", hint: "時代服裝分開。顏色變體靠在父類旁邊" },
  { id: "env", title: "場景", hint: "先室內外、晝夜、地點" },
];

const COUNT_LABELS = {
  subject: "主體",
  feature: "特徵",
  pose: "姿勢",
  clothing: "服裝",
  env: "場＋光",
};

const STORE = "tag-case-v1";

let lex;
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
let lastJobError = "";
let genAbort = null;
let jobAbort = null;
let redoQueue = [];
let viewMode = "all";
let eraOnly = true;
let lastPositive = "";
const btnByTag = new Map();
const userOpen = new Set(["sec-quality"]);
let lastIdent = new Set();
let paintPrev = { pin: new Set(), auto: new Set(), user: new Set() };
let userPresets = [];

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
    })
  );
}

function speak(text) {
  $("live").textContent = text;
  $("status").textContent = text;
}

async function ping() {
  const el = $("ping");
  try {
    const r = await fetch("/api/ping");
    const j = await r.json();
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
  for (const [key, label] of Object.entries(COUNT_LABELS)) {
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
    off.setAttribute("aria-label", `${label}不補`);
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

function updateHeatClash() {
  const note = $("heat-clash");
  if (!note) return;
  const sexBlock = sportHeatWarnings(lex, pinned, settings.heats);
  if (sexBlock.length) {
    note.hidden = false;
    note.textContent =
      "你釘了「" +
      sexBlock[0].tags.map((t) => labelOf(lex, t)).join("、") +
      "」，這種活動跟性愛動作不能並存，所以這張抽不到性愛。把它從「必進這張圖」點掉就會有。";
    return;
  }
  const clash = heatMismatches(lex, pinned, settings.heats);
  if (clash.length) {
    const scale = (settings.heats || []).map((h) => HEAT_LABELS[h] || h).join("／");
    note.hidden = false;
    note.textContent =
      "你釘了「" +
      clash.map((t) => labelOf(lex, t)).join("、") +
      "」，尺度對不上（現在只開" +
      scale +
      "）。衣服仍會進圖，這張還是走你勾的尺度。";
  } else {
    note.hidden = true;
    note.textContent = "";
  }
}

function updateEraClash() {
  const note = $("era-clash");
  if (!note) return;
  const era = exclusiveEra();
  const clash = era ? eraMismatches(lex, pinned, era) : [];
  if (clash.length) {
    note.hidden = false;
    note.textContent =
      "你釘的「" +
      clash.map((t) => labelOf(lex, t)).join("、") +
      "」不是" +
      (ERA_LABELS[era] || era) +
      "的衣服。這張仍走" +
      (ERA_LABELS[era] || era) +
      "場景，釘選也會留在圖裡。";
  } else {
    note.hidden = true;
    note.textContent = "";
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
// 運動的「活動」tag（做運動、打網球…）只有在尺度選了「活動」時才進必進 POS。
// 誘惑／走光／性愛要的是球衣和球場，不是「正在打球」這個動作 —— 而且 engine 規定
// 會動的活動跟性愛動作不能並存，帶著它會讓性愛整個抽不到。
function presetTagsFor(p) {
  if (!p) return [];
  if (!p.sport || !p.activity) return p.tags;
  if ((settings.heats || []).includes("activity")) return p.tags;
  return p.tags.filter((t) => t !== p.activity);
}

function presetCoreFor(p) {
  if (!p || !p.core) return undefined;
  const tags = presetTagsFor(p);
  return p.core.filter((t) => tags.includes(t));
}

function paintPresetBtn(btn, tags, core) {
  const state = presetState(lex, tags, pinned, core);
  btn.setAttribute("aria-pressed", state === "on" ? "true" : state === "mixed" ? "mixed" : "false");
  btn.classList.toggle("is-mixed", state === "mixed");
  if (state === "mixed") btn.title = "只剩一部分，按一下補齊整套";
  else btn.removeAttribute("title");
}

function makePresetBtn(p) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "chip-toggle";
  btn.dataset.preset = p.id;
  btn.textContent = p.name;
  paintPresetBtn(btn, presetTagsFor(p), presetCoreFor(p));
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
    const row = document.createElement("div");
    row.className = "preset-group-row";
    row.setAttribute("role", "group");
    row.setAttribute("aria-labelledby", label.id);
    for (const p of sports) row.append(makePresetBtn(p));
    group.append(label, row);
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
    if (p) paintPresetBtn(btn, presetTagsFor(p), presetCoreFor(p));
    else btn.setAttribute("aria-pressed", "false");
  }
  for (const btn of box.querySelectorAll("[data-user]")) {
    const i = Number(btn.dataset.user);
    const p = userPresets[i];
    if (p) paintPresetBtn(btn, p.tags);
    else btn.setAttribute("aria-pressed", "false");
  }
}

function applyNamedPreset(tags, core) {
  const was = presetState(lex, tags, pinned, core);
  const others = [...BUILTIN_PRESETS.map((p) => p.tags), ...userPresets.map((p) => p.tags)];
  pinned = togglePresetTags(lex, tags, pinned, others);
  afterPin();
  if (was === "on") speak("已取消釘選組合");
  else if (was === "mixed") speak("已補齊整套");
  else speak("已套用釘選組合");
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
    note.hidden = false;
    note.textContent =
      "你釘了「" +
      clash.map((t) => labelOf(lex, t)).join("、") +
      "」，左欄雖只開" +
      (ex === "female" ? "女" : "男") +
      "，這些仍會進圖。";
  } else {
    note.hidden = true;
    note.textContent = "";
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

function closeWeightPop() {
  const pop = $("w-pop");
  if (!pop || !pop.classList.contains("is-open")) return;
  pop.classList.remove("is-open");
  pop.setAttribute("aria-hidden", "true");
  document.querySelectorAll(".is-w-open").forEach((el) => el.classList.remove("is-w-open"));
  weightPopTag = "";
  weightPopAnchor = null;
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
      await navigator.clipboard.writeText(weightedPos(lastPositive));
      copy.textContent = "已複製";
      window.setTimeout(() => {
        copy.textContent = "複製";
      }, 1200);
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

function syncVisibility(auto) {
  const root = $("cats");
  if (!root) return;
  const q = ($("q").value || "").trim().toLowerCase();
  const famShow = new Map();
  const subShow = new Map();
  const catN = new Map();
  for (const [tag, btns] of btnByTag) {
    const item = catalogItem(tag);
    if (!item) continue;
    const show = chipShouldShow(item, auto, q);
    for (const btn of btns) {
      if (btn.hidden !== !show) btn.hidden = !show;
      if (!show) continue;
      const fam = btn.closest(".family");
      const sub = btn.closest(".sub");
      const cat = btn.closest(".cat");
      if (fam) famShow.set(fam, true);
      if (sub) subShow.set(sub, true);
      if (cat) catN.set(cat, (catN.get(cat) || 0) + 1);
    }
  }
  for (const fam of root.querySelectorAll(".family")) fam.hidden = !famShow.get(fam);
  for (const sub of root.querySelectorAll(".sub")) sub.hidden = !subShow.get(sub);
  const filtering = !!q || viewMode !== "all";
  let any = false;
  for (const wrap of root.querySelectorAll(".cat")) {
    const n = catN.get(wrap) || 0;
    wrap.hidden = n === 0;
    if (n) any = true;
    const shouldOpen = filtering ? n > 0 : userOpen.has(wrap.id);
    applyCatOpen(wrap, shouldOpen);
    const sec = SECTIONS.find((s) => wrap.id === "sec-" + s.id);
    const hint = wrap.querySelector(".cat-actions > span");
    if (hint && sec) hint.textContent = hintFor(sec, { length: n });
    const closer = wrap.querySelector(":scope > header .ghost.mini");
    if (closer) {
      const tags = [];
      for (const btn of wrap.querySelectorAll(".tag[data-tag]")) {
        if (!btn.hidden) tags.push(btn.dataset.tag);
      }
      const closed = tagsBanned(tags);
      closer.textContent = closed ? "開啟全部" : "關閉全部";
    }
    for (const sub of wrap.querySelectorAll(":scope .sub")) {
      const subClose = sub.querySelector(":scope > .sub-head .ghost.mini");
      if (!subClose) continue;
      const tags = [];
      for (const btn of sub.querySelectorAll(".tag[data-tag]")) {
        if (!btn.hidden) tags.push(btn.dataset.tag);
      }
      const closed = tagsBanned(tags);
      subClose.textContent = closed ? "開啟全部" : "關閉全部";
    }
  }
  let empty = root.querySelector(":scope > .empty-filter");
  if (!any) {
    if (!empty) {
      empty = document.createElement("p");
      empty.className = "hint empty-filter";
      root.append(empty);
    }
    empty.hidden = false;
    empty.textContent = q ? "沒有符合的字。" : "這個篩選下沒有 tag。";
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
  syncVisibility(auto);
}

function tagButtons(tag) {
  return btnByTag.get(tag) || [];
}

function flashPin(tag) {
  if (reduceMotion()) return;
  for (const el of tagButtons(tag)) {
    el.classList.remove("is-pin-flash");
    requestAnimationFrame(() => {
      el.classList.add("is-pin-flash");
      window.setTimeout(() => el.classList.remove("is-pin-flash"), 560);
    });
  }
}

function pinsAtDrawOf(card) {
  try {
    const raw = JSON.parse(card.dataset.pinsAtDraw || "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function paintPinMiss(card) {
  const meta = card.querySelector(".meta");
  if (!meta) return;
  const pos = card.dataset.bare || "";
  let warn = meta.querySelector(":scope > .warn.pin-miss");
  if (!pos) {
    warn?.remove();
    return;
  }
  const line = pinMissLine(lex, pos, pinned, pinsAtDrawOf(card));
  if (!line) {
    warn?.remove();
    return;
  }
  if (!warn) {
    warn = document.createElement("p");
    warn.className = "warn pin-miss";
    meta.append(warn);
  }
  warn.textContent = line;
}

function afterPin() {
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
    card.dataset.positive = weightedPos(bare);
    for (const span of card.querySelectorAll(".pos span[data-tag]")) {
      paintWeightMark(span, span.dataset.tag);
    }
  }
  if (lastPositive) {
    const copy = document.querySelector(".copy-pos");
    if (copy) copy.dataset.pos = weightedPos(lastPositive);
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

function onTagWeight(tag, dir = 1) {
  if (!tag) return;
  setTagWeight(tag, stepTagWeight(tagWeightOf(tag), dir));
}

function onTagClick(tag) {
  const next = cycleTag(lex, pinned, userBanned, tag);
  const becamePin = next.pinned.has(tag) && !pinned.has(tag);
  pinned = next.pinned;
  userBanned = next.userBanned;
  afterPin();
  if (becamePin) flashPin(tag);
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
  el.innerHTML = `<div class="shot"><div class="skel" aria-hidden="true"></div><img class="shot-img" alt="" width="${width || 1024}" height="${height || 1024}"><div class="meter" hidden><i></i><span></span></div><button type="button" class="skip-shot" aria-label="跳過這張，接著下一張" title="跳過這張"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button><button type="button" class="redo-shot" aria-label="重新生成這張" title="重新生成"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.3"/><polyline points="21 3 21 9 15 9"/></svg></button></div><div class="meta"><div class="bar">排隊中…</div><div class="pos"></div></div>`;
  return el;
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
      await navigator.clipboard.writeText(el.dataset.positive);
      speak("已複製 POS");
      btn.textContent = "已複製";
      setTimeout(() => {
        btn.textContent = "複製 POS";
      }, 1200);
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
    img.classList.add("is-on");
    if (!String(job.image).startsWith("data:")) {
      try {
        const fn = new URL(job.image, location.href).searchParams.get("filename");
        if (fn) img.alt = fn;
      } catch {
        /* ignore */
      }
    }
  }
  if (skel) skel.remove();
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
  bar.innerHTML = `<span>seed ${job.seed}${job.era ? " · " + (ERA_LABELS[job.era] || job.era) : ""}</span><button type="button" class="ghost copy">複製 POS</button>`;
  setPosLine(el, job.positive);
  const pos = el.querySelector(".pos");
  bar.querySelector(".copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(job.positive);
    speak("已複製 POS");
    const btn = bar.querySelector(".copy");
    btn.textContent = "已複製";
    setTimeout(() => {
      btn.textContent = "複製 POS";
    }, 1200);
  });
  meta.replaceChildren(bar, pos || document.createElement("div"));
  paintPinMiss(el);
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
  document.body.style.overflow = "hidden";
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
    if (
      !$("shot-viewer")?.classList.contains("open") &&
      !$("lora-modal")?.classList.contains("open") &&
      !$("shortcuts-overlay")?.classList.contains("open")
    ) {
      document.body.style.overflow = "";
    }
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

function fillViewer(card) {
  const img = card.querySelector(".shot-img");
  const vImg = $("shot-viewer-img");
  vImg.src = img.src;
  vImg.alt = img.alt || "生成圖";
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
    await navigator.clipboard.writeText(card.dataset.positive || "");
    speak("已複製 POS");
    copy.textContent = "已複製";
    setTimeout(() => {
      copy.textContent = "複製 POS";
    }, 1200);
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
  fillViewer(list[VIEW_INDEX]);
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
      const data = JSON.parse(dataLines.join(""));
      onEvent(event, data);
      if (event === "done" || event === "error") return;
    }
  }
}

function skipCurrentGen() {
  if (!running || aborting || skipping) return;
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

function finishBatch() {
  running = false;
  $("go").disabled = false;
  $("go").removeAttribute("aria-busy");
  $("cancel").hidden = true;
}

// 立刻斷：無限抽的「停」和左欄的「取消」共用這一條。
function stopNow(reason) {
  aborting = true;
  stopInfinite(reason || "已停");
  cancelRedoQueue();
  speak(reason || "取消中…");
  try {
    genAbort?.abort();
  } catch {
    /* ignore */
  }
  fetch("/api/interrupt", { method: "POST", body: "{}" }).catch(() => {
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
  if (genAbort.signal.aborted) stopJob();
  else genAbort.signal.addEventListener("abort", stopJob, { once: true });
  try {
    let finished = false;
    let hadError = false;
    await streamGen(
      {
        positive: extra.positive,
        width: settings.width,
        height: settings.height,
        seed: seedNum,
        loras: extra.loras || currentLorasPayload(),
        ckpt: extra.ckpt || currentCkpt(),
      },
      (event, data) => {
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
    const kind = settleGenCard({ aborting, skipping, errName: err.name, finished: false });
    if (kind === "skip") skipCard(card);
    else if (kind === "cancel") failCard(card, "已取消");
    else {
      lastJobError = String(err.message || err);
      failCard(card, lastJobError);
    }
  } finally {
    genAbort.signal.removeEventListener("abort", stopJob);
    endGenCard(card);
    const skipNow = skipping;
    skipping = false;
    jobAbort = null;
    if (skipNow) {
      try {
        await fetch("/api/interrupt", { method: "POST", body: "{}" });
      } catch {
        /* ignore */
      }
    }
  }
  // 投 Telegram 放在這裡，所以一般抽、重抽佇列、單張重新生成三條路都會送。
  // 不 await —— 伺服器收下就回，送圖再慢也不拖抽圖。
  if (shot) tgSendCard(card, shot, posZh(extra.positive));
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
  const pingNow = await fetch("/api/ping").then((r) => r.json()).catch(() => ({ ok: false }));
  if (!pingNow.ok) {
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
  const n = Math.max(1, Math.floor(Number($("n").value) || 1));
  settings.n = n;
  saveStore();

  const pingNow = await fetch("/api/ping").then((r) => r.json()).catch(() => ({ ok: false }));
  if (!pingNow.ok) {
    speak("ComfyUI 連不上，先開本機 8188");
    stopInfinite("Comfy 連不上");
    finishBatch();
    return;
  }

  beginRound();
  // 八格牆是連續的：不再每輪清空。只有第一次抽才把畫面捲過去。
  if (!wallHasCards()) $("results").scrollIntoView({ behavior: "smooth", block: "start" });

  let ident = new Set();
  let done = 0;
  let skipped = 0;
  let failed = 0;
  let stoppedByFail = false;

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
    const drawn = drawOne(lex, settings, pinForDraw, userBanned, rng, seedNum);
    if (settings.samePerson && ident.size === 0) {
      ident = identityPins(lex, drawn.positive);
      lastIdent = ident;
      syncSamePerson();
    }
    // 卡片是現做的，不再預先建 n 張 —— 一次幾張已經沒有上限。
    const card = placeCard(cardSkeleton(settings.width, settings.height));
    markLive(card);
    card.dataset.seed = String(drawn.seed);
    card.dataset.era = drawn.era || "";
    card.dataset.bare = drawn.positive;
    card.dataset.pinsAtDraw = JSON.stringify([...pinned]);
    const pos = weightedPos(drawn.positive);
    const trigger = currentTriggerText();
    const sent = insertTriggerAfterCast(pos, trigger);
    card.dataset.positive = sent;
    card.dataset.trigger = trigger;
    card.dataset.loras = JSON.stringify(currentLorasPayload());
    card.dataset.ckpt = currentCkpt() || "";
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

  countMade(done);
  finishBatch();

  if (!aborting && !stoppedByFail) {
    const bits = [`完成 ${done} 張`];
    if (skipped) bits.push(`跳過 ${skipped} 張`);
    if (failed) bits.push(`失敗 ${failed} 張`);
    speak(bits.join("，"));
  }

  // 還開著就接下一輪。用 setTimeout 排隊而不是遞迴，呼叫堆疊不會累積。
  if (isInfinite() && !aborting) {
    window.setTimeout(() => {
      if (isInfinite() && !running) runBatch();
    }, 0);
  }
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
    closeWeightPop();
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
  window.addEventListener("scroll", closeWeightPop, true);
  window.addEventListener("resize", closeWeightPop);
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
      if (!wrap || !wrap.classList.contains("cat")) return;
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
  });
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (handleViewerKeys(e)) return;
    if (tgHandleKeys(e)) return;
    if (handleLoraKeys(e)) return;
    if (isTyping()) return;
    if (e.key === "i" || e.key === "I") {
      e.preventDefault();
      $("infinite")?.click();
      return;
    }
    if (e.key === "/") {
      e.preventDefault();
      $("q").focus();
      return;
    }
    if (e.key === "Enter") {
      if (isLoraUiOpen() || isViewerOpen() || tgUiOpen() || running) return;
      e.preventDefault();
      runBatch();
    }
  });
  $("view-filters").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (btn) {
      viewMode = btn.dataset.view;
      renderCats("search");
      return;
    }
    if (e.target.closest("#era-only")) {
      eraOnly = !eraOnly;
      renderCats("search");
    }
  });
  $("clear-pins").addEventListener("click", () => {
    pinned = new Set();
    userBanned = new Set();
    afterPin();
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
        if (p) applyNamedPreset(presetTagsFor(p), presetCoreFor(p));
        return;
      }
      const user = e.target.closest("[data-user]");
      if (user) {
        const i = Number(user.dataset.user);
        const p = userPresets[i];
        if (p) applyNamedPreset(p.tags);
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
      userPresets = sanitizePinPresets([...userPresets, { name, tags }], lex);
      saveStore();
      renderPresets();
      speak("已存釘選組合");
    });
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

async function main() {
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
  loading.remove();
  lex = indexLexicon(data);
  settings = defaultSettings(data);
  const saved = loadStore();
  if (saved.settings) settings = sanitizeSettings(saved.settings, data);
  if (Array.isArray(saved.pinned)) pinned = new Set(knownTags(lex, saved.pinned));
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
  initTelegram();
  initInfinite({
    onStart: () => {
      failStreak = 0;
      if (!running) runBatch();
    },
    onStop: () => stopNow("已停"),
  });
  syncMustDraw();
  ping();
  setInterval(ping, 15000);
}

main();
