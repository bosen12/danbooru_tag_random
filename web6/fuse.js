/**
 * 墨池 · 疊印台。
 *
 * 一張牌是一層墨。放上「版」的牌依花色疊進六個套版（罩色、姿勢、服裝、長相、人物、底色），
 * 中間那張「校樣」立刻跟著變：底色牌的風景鋪底，主版那張的人用 multiply 疊上去
 * （疊印本來就是這樣：墨疊墨），風格牌變成罩在上面的濾鏡。
 *
 * 校樣是用牌自己的插畫拼出來的，不花 ComfyUI 一秒鐘。真正會送出去的 POS
 * 由 engine 跑四張「試印」：同一批種子，每疊一張牌就重跑一次（一次 ~25ms），所以看得到
 * 「加了這張，引擎補的字怎麼變」；也看得到你的牌有沒有真的上墨（四張裡進了幾張）。
 * 挑一張試印按付印，才送 ComfyUI；成品夾到上面的晾紙繩，點它可以回到那一版。
 *
 * 抽牌規則一條都不在這裡：同格互斥、時代衝突、附帶是 engine 的 applyPin；
 * 相剋是 engine 的 contradictions；補字是 engine 的 drawWithSeed。規則、廢字簍跟墨池工作臺共用。
 */
import {
  indexLexicon,
  sanitizeSettings,
  applyPin,
  contradictions,
  heatMismatches,
  insertTriggerAfterCast,
  randomSeed,
  ACT_PLACE,
  ERAS,
  ERA_LABELS,
} from "./engine.js";
import { drawWithSeed } from "./draw-with-seed.js";
import { ratingBlocked, RATING_LABEL } from "./rules/rating.js";
import { HEATS, toggleHeat } from "./heats.js";
import { heatBlockedByRating } from "./scene-policy.js";
import { initLoraPicker, currentLorasPayload, currentTriggerText, currentCkpt, handleLoraKeys } from "./lora.js";
import { initWorkflow, currentWorkflowId, wfHandleKeys } from "./workflow.js";
import { HARD_BANNED, applyArtSources } from "./card-art.js";
import { buildLibrary, createAssets, cardNode, cardFacts, CARD_SUIT_INFO, CARD_SUITS, RATING_ZH, ERA_ZH } from "./cards.js";
import { el, openSheet, anyOverlay } from "./ui.js";
import { createDrag } from "./drag.js";
import { createGenerator, comfyOnline } from "./gen.js";
import { attachPeek, hidePeek } from "./card-peek.js";
import * as S from "./store.js";
import { REGISTERS, REGISTER_ROLE, emptyBed, sanitizeBed, placeCard, removeCard, setLead, relationsOf, proofLayers, canLead } from "./fuse-bed.js";
import { createSfx } from "./fuse-sfx.js";
import { genSeed, isFixedSeed, mountSeedControl, onSeedChange, seedUseButton, useSeed } from "./seed-control.js";

const $ = (id) => document.getElementById(id);
const LETTERS = ["A", "B", "C", "D"];
const TRIALS = 4;
const GHOST_MAX = 3;
const PAGE = 90;
const PRINT_MAX = 40;
const HISTORY_MAX = 60;
const RATING_RANK = { general: 0, sensitive: 1, explicit: 2 };
const HEAT_ZH = { activity: "活動", tease: "誘惑", flash: "走光", sex: "性愛" };
const SIZES = [
  { id: "square", zh: "方", w: 1024, h: 1024 },
  { id: "portrait", zh: "直", w: 832, h: 1216 },
  { id: "landscape", zh: "橫", w: 1216, h: 832 },
];
const SECTION_ORDER = ["subject", "feature", "clothing", "pose", "env", "style", "quality"];
const FK = { bed: "mochi.fuse.bed.v1", seeds: "mochi.fuse.seeds.v1", picked: "mochi.fuse.picked.v1", prints: "mochi.fuse.prints.v1", tab: "mochi.fuse.tab.v1" };

// 風格牌 → 罩在校樣上的濾鏡。沒列到的風格給一個很淡的預設，讓人看得出「罩了東西」。
const FINISH = {
  monochrome: "grayscale(1) contrast(1.08)",
  greyscale: "grayscale(1)",
  "limited palette": "saturate(0.45)",
  lineart: "grayscale(1) contrast(1.8) brightness(1.08)",
  sketch: "grayscale(1) contrast(1.5) brightness(1.1)",
  "watercolor (medium)": "saturate(0.75) brightness(1.05) blur(0.4px)",
  "flat color": "saturate(1.25) contrast(1.05)",
  "anime coloring": "saturate(1.2) contrast(1.08)",
  "cel shading": "contrast(1.2) saturate(1.1)",
  "1990s (style)": "sepia(0.3) saturate(0.85) contrast(0.95)",
  "2000s (style)": "saturate(1.1) hue-rotate(-6deg)",
  "retro artstyle": "sepia(0.45) saturate(0.8)",
  screentones: "grayscale(1) contrast(1.35)",
  sepia: "sepia(0.8)",
  "thick outlines": "contrast(1.3)",
};
const FINISH_DEFAULT = "saturate(0.9) contrast(1.05)";

// 第一次打開的起手式：三組一點就疊好的版。只收詞庫裡有、這個尺度看得到的。
const STARTERS = [
  { name: "春日和服", tags: ["kimono", "cherry blossoms", "smile"] },
  { name: "雨夜街角", tags: ["umbrella", "rain", "night", "street"] },
  { name: "書房午後", tags: ["reading", "library", "glasses"] },
  { name: "海邊黃昏", tags: ["sundress", "beach", "sunset"] },
  { name: "咖啡店", tags: ["apron", "cafe", "smile"] },
];

let data = null;
let lex = null;
let lib = null;
let assets = null;
let manifest = {};
let settings = null;
let bans = new Set();
let bed = emptyBed();
let seeds = [];
let picked = 0;
let trials = [];
let prints = [];
let history = [];
let view = "print";
let comfyOk = null;
let rowNotes = {};
let plateNotice = null;
let lastRelKeys = new Set();
let caseTab = "all";
let caseQuery = "";
let caseList = [];
let caseShown = 0;
let lastPointer = "mouse";
const sfx = createSfx();
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ================= 小工具 ================= */

function readJ(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJ(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 存不了就算了：版還在畫面上 */
  }
}

const cardOf = (tag) => lib.byTag.get(tag);
const suitOf = (tag) => cardOf(tag)?.suit || null;
const zh = (tag) => cardOf(tag)?.zh || lex.byTag.get(tag)?.zh || tag;
const cssEsc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"'));

/** 插畫鏡頭多寬：主版優先挑畫得完整的。 */
function frameOf(tag) {
  const p = manifest[tag]?.positive || "";
  if (/\bfull body\b/.test(p)) return 3;
  if (/\bcowboy shot\b/.test(p)) return 2;
  if (/\bupper body\b/.test(p)) return 1;
  return 0;
}

/** 把一串子節點換上去，null／false 略過（replaceChildren 會把 null 印成字）。 */
function put(node, ...kids) {
  node.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
}

/** 這張牌的插畫畫的是什麼：有人（能當主版）、風景（能當底色）、靜物（道具）。 */
function kindOf(tag) {
  const m = manifest[tag];
  if (!m || !m.positive) return null;
  if (/\bno humans\b/.test(m.positive)) {
    if (/\bscenery\b/.test(m.positive)) return "ground";
    if (/\bstill life\b/.test(m.positive)) return "prop";
    return null;
  }
  return "figure";
}

function rankOk(card) {
  return (RATING_RANK[card.rating] ?? 2) <= (RATING_RANK[settings.rating] ?? 0);
}

function announce(text) {
  const live = $("live");
  live.textContent = "";
  setTimeout(() => (live.textContent = text), 30);
}

function haptic(ms) {
  if (lastPointer === "touch" && navigator.vibrate) navigator.vibrate(ms);
}

/* ================= 開機 ================= */

async function boot() {
  try {
    const [lexicon, man] = await Promise.all([
      fetch("lexicon.json").then((r) => r.json()),
      fetch("cards/manifest.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    data = lexicon;
    lex = indexLexicon(data);
    lib = buildLibrary(data, { ratingBlocked });
    manifest = man || {};
    assets = createAssets(manifest);
  } catch (err) {
    $("proofing").replaceChildren(el("p", { class: "boot-fail" }, "讀不到詞庫。請用 start-web6.bat 開，而不是直接點 HTML。", el("br"), String(err)));
    return;
  }
  settings = sanitizeSettings(S.loadSettings() || { rating: "general" }, data);
  bans = new Set(S.loadBans().filter((t) => lib.byTag.has(t)));
  bed = sanitizeBed(readJ(FK.bed, null), (t) => lib.byTag.has(t));
  const s = readJ(FK.seeds, null);
  seeds = Array.isArray(s) && s.length === TRIALS && s.every((n) => Number.isFinite(n)) ? s : freshSeeds();
  picked = Math.min(TRIALS - 1, Math.max(0, Number(readJ(FK.picked, 0)) || 0));
  caseTab = readJ(FK.tab, "all") || "all";
  prints = loadPrints();

  initLoraPicker();
  initWorkflow();
  pingLoop();
  wireChrome();

  buildProofShell();
  buildTrialShells();
  renderRating();
  renderCaseTabs();
  retrial();
  renderAll();
  renderCase();
  renderLine();
  attachPeek($("case-grid"), ".card[data-tag]", peekInfo);
  // 生圖種子一換，同一張試印對應的成品就不一樣了：校樣、付印那條、試印上的「已印」都要重畫。
  onSeedChange(() => {
    renderProof([]);
    renderTrials();
    renderPrintBar();
  });
  attachPeek($("registers"), ".card[data-tag]", peekInfo);
  watchMiniProof();

  if (new URLSearchParams(location.search).has("debug")) {
    window.fuse = { get bed() { return bed; }, get trials() { return trials; }, get prints() { return prints; }, place, remove, undo, pick, reroll, printNow };
  }
}

function freshSeeds() {
  return Array.from({ length: TRIALS }, () => randomSeed());
}

function setSettings(patch) {
  settings = sanitizeSettings({ ...settings, ...patch }, data);
  S.saveSettings(settings);
  retrial();
  renderAll();
  renderCase();
}

/* ================= 試印：engine 真的會怎麼補 ================= */

function retrial() {
  const pins = new Set(bed.pins);
  const banned = new Set([...bans, ...HARD_BANNED]);
  trials = seeds.map((seed, i) => {
    const d = drawWithSeed(lex, settings, pins, banned, seed, { trace: true });
    const inPos = new Set(String(d.positive || "").split(",").map((x) => x.trim()));
    const extra = [];
    for (const sec of SECTION_ORDER) {
      for (const t of d.sections[sec] || []) if (lib.byTag.has(t) && !pins.has(t) && !extra.includes(t)) extra.push(t);
    }
    return {
      letter: LETTERS[i],
      seed,
      positive: d.positive || "",
      era: d.era,
      heat: d.heat,
      mine: bed.pins.filter((t) => inPos.has(t)),
      missing: bed.pins.filter((t) => !inPos.has(t)),
      extra,
      eraClash: d.eraClash || [],
    };
  });
}

const takeOf = (tag) => trials.filter((t) => t.mine.includes(tag)).length;

function missReason(tag) {
  const item = lex.byTag.get(tag);
  if (item && ratingBlocked(item, settings.rating)) return `${RATING_LABEL[settings.rating]}抽不到它`;
  if (trials.some((t) => t.eraClash.includes(tag))) return "跟那一張的時代對不上";
  if (heatMismatches(lex, [tag], settings.heats).length) return "目前勾的情境不收它";
  return "被同一格或相剋的字擠掉";
}

// 試印的 seed 是抽牌用的；送 ComfyUI 的那顆看「生圖種子」（固定就換成固定的那顆）。
const printSeedOf = (t) => genSeed(t.seed);
const sigOf = (t) => (t ? `${printSeedOf(t)}|${settings.width}x${settings.height}|${t.positive}` : "");

function printFor(sig) {
  return sig ? prints.find((p) => p.sig === sig) : null;
}

/* ================= 動作：放、拿、撤回 ================= */

const deps = () => ({ lex, applyPin });

function commit(next, label, events = []) {
  history.push({ bed, label });
  if (history.length > HISTORY_MAX) history.shift();
  bed = next;
  writeJ(FK.bed, bed);
  rowNotes = {};
  plateNotice = null;
  for (const e of events) {
    if (e.kind !== "replace") continue;
    const suit = suitOf(e.out);
    rowNotes[suit] = {
      text: e.why === "era" ? `「${zh(e.out)}」跟「${zh(e.by)}」不是同一個時代，先拿下來了` : `同一格只留一張：「${zh(e.out)}」換成「${zh(e.by)}」`,
      back: e.out,
    };
  }
  retrial();
  renderAll(events);
  syncCaseStates();
  if (caseTab === "match") renderCase();
}

function place(tag, sourceEl) {
  if (!lib.byTag.has(tag)) return;
  if (bed.pins.includes(tag)) return;
  const from = sourceEl && sourceEl.isConnected ? sourceEl.getBoundingClientRect() : null;
  const { bed: next, events } = placeCard(bed, tag, deps());
  if (!events.length) return;
  const leaving = events.filter((e) => e.kind === "replace").map((e) => plateNode(e.out)).filter(Boolean).map(snapshot);
  commit(next, `放上「${zh(tag)}」`, events);
  const carried = events.filter((e) => e.kind === "carry").map((e) => e.tag);
  flyIn(tag, from);
  carried.forEach((t, i) => popIn(t, 140 + i * 90));
  leaving.forEach((snap) => liftAway(snap, "aside"));
  bloom(suitOf(tag));
  sfx.stamp();
  if (carried.length) sfx.carry();
  if (leaving.length) setTimeout(() => sfx.lift(), 90);
  haptic(8);
  const bits = [`放上「${zh(tag)}」`];
  if (carried.length) bits.push(`帶上${carried.map((t) => `「${zh(t)}」`).join("")}`);
  for (const e of events) if (e.kind === "replace") bits.push(`「${zh(e.out)}」${e.why === "era" ? "時代不合拿下" : "被換下"}`);
  announce(bits.join("，"));
}

function remove(tag) {
  if (!bed.pins.includes(tag)) return;
  const { bed: next, events } = removeCard(bed, tag);
  const snaps = (events[0]?.tags || [tag]).map((t) => plateNode(t)).filter(Boolean).map(snapshot);
  commit(next, `拿下「${zh(tag)}」`, events);
  snaps.forEach((s) => liftAway(s, "up"));
  sfx.lift();
  haptic(6);
  const also = (events[0]?.tags || []).filter((t) => t !== tag);
  announce(`拿下「${zh(tag)}」${also.length ? `，連同它帶上來的${also.map((t) => `「${zh(t)}」`).join("")}` : ""}`);
}

function toggle(tag, sourceEl) {
  if (bed.pins.includes(tag)) remove(tag);
  else place(tag, sourceEl);
}

function lead(tag) {
  const next = setLead(bed, tag);
  commit(next, next.lead ? `「${zh(tag)}」當主版` : "主版交回自動", []);
  bloom(suitOf(tag));
  sfx.carry();
  announce(next.lead ? `主版換成「${zh(tag)}」` : "主版改回自動挑");
}

function startWith(starter) {
  let next = bed;
  const events = [];
  for (const t of starter.tags) {
    const r = placeCard(next, t, deps());
    next = r.bed;
    events.push(...r.events);
  }
  commit(next, `起手：${starter.name}`, events);
  starter.tags.forEach((t, i) => popIn(t, i * 120));
  starter.tags.forEach((t, i) => setTimeout(() => (bloom(suitOf(t)), sfx.stamp()), i * 120));
  announce(`起手：${starter.name}，疊上${starter.tags.map((t) => `「${zh(t)}」`).join("")}`);
}

function undo() {
  const h = history.pop();
  if (!h) return;
  bed = h.bed;
  writeJ(FK.bed, bed);
  rowNotes = {};
  plateNotice = null;
  retrial();
  renderAll([]);
  syncCaseStates();
  if (caseTab === "match") renderCase();
  sfx.lift();
  announce(`撤回：${h.label}`);
}

function clearBed() {
  if (!bed.pins.length) return;
  const snaps = bed.pins.map((t) => plateNode(t)).filter(Boolean).map(snapshot);
  commit(emptyBed(), "清版", []);
  snaps.forEach((s, i) => setTimeout(() => liftAway(s, "up"), i * 25));
  sfx.lift();
  announce("清版了。按撤回可以拿回來");
}

function pick(i, { quiet = false } = {}) {
  if (i < 0 || i >= trials.length || i === picked) return;
  picked = i;
  writeJ(FK.picked, picked);
  renderProof([]);
  renderPlate([]);
  renderTrials();
  renderPrintBar();
  if (!quiet) sfx.carry();
  announce(`換到試印 ${LETTERS[i]}`);
}

function reroll() {
  seeds = freshSeeds();
  writeJ(FK.seeds, seeds);
  retrial();
  const box = $("trials");
  if (!reduced()) {
    box.classList.remove("is-shuffling");
    void box.offsetWidth;
    box.classList.add("is-shuffling");
    setTimeout(() => box.classList.remove("is-shuffling"), 520);
  }
  renderAll([]);
  if (caseTab === "match") renderCase();
  sfx.shuffle();
  announce("換了一批試印");
}

/* ================= 付印 ================= */

const generator = createGenerator({
  payload: (p) => ({ width: p.width, height: p.height, loras: p.loras, ckpt: p.ckpt, rating: p.rating, workflowId: p.workflowId }),
  update: (p) => {
    paintLineItem(p);
    const t = trials[picked];
    if (t && p.sig === sigOf(t)) {
      renderProofPrint(p);
      renderPrintBar();
      renderCaption();
    }
    if (p.status === "done") {
      sfx.done();
      haptic(14);
      savePrints();
    } else if (p.status === "failed") {
      sfx.fail();
      savePrints();
    } else if (p.status === "cancelled") savePrints();
  },
  stopped: (msg) => {
    plateNotice = { kind: "err", text: msg };
    renderPlateNotice();
  },
});

function printNow() {
  const t = trials[picked];
  if (!t) return;
  const sig = sigOf(t);
  const same = printFor(sig);
  if (same && (same.status === "queued" || same.status === "running")) {
    announce("這一張已經在印了");
    return;
  }
  if (comfyOk === false) {
    const bar = $("print-bar");
    bar.classList.remove("is-nudged");
    void bar.offsetWidth;
    bar.classList.add("is-nudged");
    announce("印刷機（ComfyUI）沒開，先不送");
    return;
  }
  const p = {
    id: "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    sig,
    seed: printSeedOf(t),
    fixedSeed: isFixedSeed(),
    positive: insertTriggerAfterCast(t.positive, currentTriggerText()),
    width: settings.width,
    height: settings.height,
    rating: settings.rating,
    loras: currentLorasPayload(),
    ckpt: currentCkpt(),
    workflowId: currentWorkflowId(),
    bed: { pins: [...bed.pins], lead: bed.lead, carried: { ...bed.carried } },
    seeds: [...seeds],
    picked,
    letter: t.letter,
    mine: [...t.mine],
    era: t.era,
    status: "drawn",
    image: null,
    note: "",
    at: new Date().toISOString(),
  };
  prints.unshift(p);
  while (prints.length > PRINT_MAX) prints.pop();
  view = "print";
  generator.enqueue(p);
  savePrints();
  renderLine();
  renderProof([]);
  renderPrintBar();
  rollPress();
  sfx.roll();
  haptic(18);
  announce(`付印試印 ${t.letter}`);
}

function reprint(p) {
  if (p.status === "queued" || p.status === "running") return;
  p.note = "";
  p.preview = null;
  generator.enqueue(p);
  savePrints();
}

function stopPrinting() {
  generator.stop();
}

function loadPrints() {
  const list = readJ(FK.prints, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((p) => p && p.id && p.positive)
    .map((p) => ({ ...p, status: p.status === "done" ? "done" : p.status === "failed" ? "failed" : "stopped", preview: null, progress: p.status === "done" ? 1 : 0 }));
}

function savePrints() {
  writeJ(
    FK.prints,
    prints.slice(0, PRINT_MAX).map((p) => ({
      id: p.id,
      sig: p.sig,
      seed: p.seed,
      positive: p.positive,
      width: p.width,
      height: p.height,
      rating: p.rating,
      loras: p.loras,
      ckpt: p.ckpt,
      workflowId: p.workflowId,
      bed: p.bed,
      fixedSeed: !!p.fixedSeed,
      seeds: p.seeds,
      picked: p.picked,
      letter: p.letter,
      mine: p.mine,
      era: p.era,
      status: p.status === "done" ? "done" : p.status === "failed" ? "failed" : "stopped",
      image: p.image || null,
      note: p.status === "done" ? "" : p.note || "",
      at: p.at,
    }))
  );
}

function restorePrint(p) {
  history.push({ bed, label: "回到舊版之前" });
  bed = sanitizeBed(p.bed, (t) => lib.byTag.has(t));
  if (Array.isArray(p.seeds) && p.seeds.length === TRIALS) seeds = [...p.seeds];
  // 當時是用固定種子印的：把那顆也帶回來，否則同一版會對不上那張成品。
  if (p.fixedSeed) useSeed(p.seed);
  picked = Number.isInteger(p.picked) ? p.picked : 0;
  if (p.width && p.height && (p.width !== settings.width || p.height !== settings.height)) {
    settings = sanitizeSettings({ ...settings, width: p.width, height: p.height }, data);
    S.saveSettings(settings);
  }
  writeJ(FK.bed, bed);
  writeJ(FK.seeds, seeds);
  writeJ(FK.picked, picked);
  rowNotes = {};
  plateNotice = null;
  view = "print";
  retrial();
  renderAll([]);
  syncCaseStates();
  sfx.stamp();
  const t = trials[picked];
  announce(t && sigOf(t) === p.sig ? "回到這一版了" : "回到這一版了。規則改過，試印可能跟當時不一樣");
}

/* ================= 畫面：全部 ================= */

function renderAll(events = []) {
  renderProof(events);
  renderPlate(events);
  renderTrials();
  renderPrintBar();
  renderUndo();
}

/* ================= 校樣 ================= */

let proofSheet = null;
let miniSheet = null;

function makeSheet(mini) {
  const root = el("div", { class: mini ? "sheet sheet-mini" : "sheet" });
  const ground = el("div", { class: "p-ground" });
  const figure = el("div", { class: "p-figure" });
  const props = el("div", { class: "p-props" });
  const print = el("div", { class: "p-print" });
  const blooms = el("div", { class: "p-blooms" });
  root.append(ground, figure, props, print, blooms);
  return { root, ground, figure, props, print, blooms };
}

function buildProofShell() {
  proofSheet = makeSheet(false);
  const frame = el(
    "div",
    { class: "sheet-frame" },
    el("span", { class: "crop tl" }),
    el("span", { class: "crop tr" }),
    el("span", { class: "crop bl" }),
    el("span", { class: "crop br" }),
    el("span", { class: "reg-target", "aria-hidden": "true" }),
    proofSheet.root
  );
  proofSheet.empty = el("div", { class: "p-empty" });
  proofSheet.roller = el("div", { class: "p-roller" }, el("i"));
  proofSheet.root.append(proofSheet.empty, proofSheet.roller);
  $("proof").replaceChildren(frame);
  miniSheet = makeSheet(true);
  miniSheet.count = el("b", { class: "mini-count" });
  $("mini-proof").replaceChildren(miniSheet.root, miniSheet.count);
}

function swapImg(host, src, cls) {
  const cur = host.querySelector("img:not([data-leaving])");
  if ((cur?.getAttribute("src") || "") === (src || "")) return;
  if (cur) {
    cur.dataset.leaving = "1";
    cur.style.opacity = "0";
    setTimeout(() => cur.remove(), 360);
  }
  if (!src) return;
  const img = el("img", { alt: "", decoding: "async", draggable: "false", class: cls });
  img.style.opacity = "0";
  const show = () => setTimeout(() => (img.style.opacity = ""), 20);
  img.addEventListener("load", show, { once: true });
  img.addEventListener("error", () => img.remove(), { once: true });
  img.src = src;
  host.append(img);
  if (img.complete) show();
}

function finishFilter(finish) {
  if (!finish.length) return "none";
  return finish.map((f) => FINISH[f.tag] || FINISH_DEFAULT).join(" ");
}

function paintSheet(sheet, layers, era) {
  sheet.root.style.setProperty("--ar", `${settings.width} / ${settings.height}`);
  sheet.root.style.setProperty("--finish", finishFilter(layers.finish));
  sheet.root.dataset.era = era || "any";
  sheet.ground.dataset.src = layers.ground?.src || "";
  sheet.figure.dataset.src = layers.figure?.src || "";
  swapImg(sheet.ground, layers.ground ? assets.art(layers.ground.tag) : null);
  swapImg(sheet.figure, layers.figure ? assets.art(layers.figure.tag) : null);
  const propSrcs = layers.props.map((p) => assets.art(p.tag)).filter(Boolean);
  const have = [...sheet.props.children].map((n) => n.getAttribute("src"));
  if (have.join("|") !== propSrcs.join("|")) {
    sheet.props.replaceChildren(...propSrcs.map((src) => el("img", { src, alt: "", decoding: "async", draggable: "false" })));
  }
}

function layersFor(t) {
  return proofLayers({ bed, extra: t ? t.extra : [], suitOf, kindOf, frameOf });
}

const BLANK = { figure: null, ground: null, props: [], finish: [] };

function renderProof(events = []) {
  const t = trials[picked];
  // 空白的版就給一張白紙，不要把引擎自己抽的影子跟說明字疊在一起。
  const layers = bed.pins.length ? layersFor(t) : BLANK;
  paintSheet(proofSheet, layers, bed.pins.length ? t?.era : "any");
  proofSheet.root.parentElement.style.setProperty("--arn", String(settings.width / settings.height));
  paintSheet(miniSheet, layers, t?.era);
  miniSheet.count.textContent = String(bed.pins.length);
  renderEmpty();
  renderProofPrint(printFor(sigOf(t)));
  renderCaption();
  renderColophon(layers, t);
  void events;
}

function renderEmpty() {
  const box = proofSheet.empty;
  if (bed.pins.length) {
    box.hidden = true;
    proofSheet.root.dataset.empty = "false";
    return;
  }
  proofSheet.root.dataset.empty = "true";
  box.hidden = false;
  const starters = STARTERS.filter((s) => s.tags.every((t) => lib.byTag.has(t) && rankOk(cardOf(t)) && !bans.has(t))).slice(0, 3);
  put(box,
    el("p", { class: "p-empty-lead" }, "空白的版"),
    el("p", { class: "p-empty-body" }, "從字盒挑一張牌放上來：點一下，或拖到這張紙上。每疊一張，這張校樣就多一層墨。"),
    starters.length
      ? el(
          "div",
          { class: "starters" },
          el("span", { class: "starters-label" }, "或者從這裡起手"),
          starters.map((s) =>
            el(
              "button",
              { class: "starter", type: "button", onclick: () => startWith(s) },
              el("span", { class: "starter-arts", "aria-hidden": "true" }, s.tags.slice(0, 3).map((tg) => (assets.art(tg) ? applyArtSources(el("img", { alt: "" }), assets.sources(tg)) : null))),
              el("span", { class: "starter-name" }, s.name),
              el("span", { class: "starter-tags" }, s.tags.map(zh).join("・"))
            )
          )
        )
      : null
  );
}

function renderProofPrint(p) {
  const host = proofSheet.print;
  const roller = proofSheet.roller;
  const showPrint = p && (p.image || p.preview) && view === "print";
  const src = showPrint ? p.image || p.preview : null;
  const developing = p && p.status === "running";
  host.dataset.state = p ? p.status : "";
  const prevSrc = host.querySelector("img")?.getAttribute("src") || "";
  if (src) {
    let img = host.querySelector("img");
    if (!img) {
      img = el("img", { alt: "成品", decoding: "async", draggable: "false" });
      host.append(img);
    }
    if (img.getAttribute("src") !== src) img.src = src;
    // 成品剛好在眼前印好：像紙從滾筒下出來，由上往下顯影。
    if (p.status === "done" && prevSrc && prevSrc !== src && !reduced()) {
      host.classList.remove("is-developing");
      void host.offsetWidth;
      host.classList.add("is-developing");
      setTimeout(() => host.classList.remove("is-developing"), 1300);
    }
  } else host.replaceChildren();
  host.style.setProperty("--print-o", developing ? String(0.35 + 0.6 * (p.progress || 0)) : "1");
  roller.hidden = !(p && (p.status === "running" || p.status === "queued"));
  roller.style.setProperty("--p", String(p && p.status === "running" ? p.progress || 0 : 0));
  roller.dataset.state = p ? p.status : "";
  renderViewToggle(p);
}

function renderViewToggle(p) {
  const box = $("view-toggle");
  const can = !!(p && p.image);
  box.hidden = !can;
  if (!can) return;
  put(
    box,
    ...[
      ["proof", "校樣"],
      ["print", "成品"],
    ].map(([v, label]) =>
      el(
        "button",
        {
          type: "button",
          role: "radio",
          "aria-checked": view === v ? "true" : "false",
          onclick: () => {
            view = v;
            renderProofPrint(p);
          },
        },
        label
      )
    )
  );
}

function renderCaption() {
  const t = trials[picked];
  const cap = $("proof-caption");
  if (!t) return (cap.textContent = "");
  const p = printFor(sigOf(t));
  const state = !p
    ? "還沒付印"
    : p.status === "queued"
      ? "排隊等印"
      : p.status === "running"
        ? `印製中 ${Math.round((p.progress || 0) * 100)}%`
        : p.status === "done"
          ? "印好了"
          : p.status === "failed"
            ? "印壞了"
            : "停了";
  put(cap,
    el("b", { class: "cap-letter" }, t.letter),
    el("span", {}, bed.pins.length ? `校樣・你疊了 ${bed.pins.length} 層，引擎補了 ${t.extra.length} 個字` : `校樣・引擎自己抽了 ${t.extra.length} 個字`),
    el("span", { class: "cap-state", dataset: { state: p ? p.status : "none" } }, state)
  );
}

function renderColophon(layers, t) {
  const bit = (label, slot) =>
    el(
      "span",
      { class: "col-bit", dataset: { src: slot ? slot.src : "none" } },
      el("i", {}, label),
      slot ? zh(slot.tag) : "—",
      slot && slot.src === "engine" ? el("small", {}, "引擎") : null
    );
  const finish = layers.finish.length ? { tag: layers.finish.map((f) => f.tag)[0], src: layers.finish[0].src } : null;
  put($("colophon"),
    bit("底色", layers.ground),
    bit("主版", layers.figure),
    bit("罩色", finish),
    el("span", { class: "col-bit" }, el("i", {}, "時代"), t ? ERA_ZH[t.era] || ERA_LABELS[t.era] || t.era : "—"),
    el("span", { class: "col-bit col-seed" }, el("i", {}, isFixedSeed() ? "生圖 seed（固定）" : "seed"), t ? String(printSeedOf(t)) : "—")
  );
}

function bloom(suit) {
  if (!suit || reduced()) return;
  for (const sheet of [proofSheet, miniSheet]) {
    const b = el("span", { class: "bloom", style: `--c: var(--suit-${suit})` });
    sheet.blooms.append(b);
    setTimeout(() => b.remove(), 950);
  }
}

function rollPress() {
  if (reduced()) return;
  const r = el("span", { class: "press-roll" });
  proofSheet.blooms.append(r);
  setTimeout(() => r.remove(), 900);
}

/* ================= 試印條 ================= */

let trialNodes = [];

function buildTrialShells() {
  const box = $("trials");
  trialNodes = LETTERS.map((letter, i) => {
    const sheet = makeSheet(true);
    const meta = el("span", { class: "trial-meta" });
    const picks = el("span", { class: "trial-picks", "aria-hidden": "true" });
    const node = el(
      "button",
      { class: "trial", type: "button", role: "radio", dataset: { i: String(i) }, onclick: () => pick(i) },
      el("span", { class: "trial-sheet" }, sheet.root),
      el("span", { class: "trial-letter" }, letter),
      meta,
      picks
    );
    node.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const j = (i + d + TRIALS) % TRIALS;
      pick(j);
      trialNodes[j].node.focus();
    });
    return { node, sheet, meta, picks };
  });
  box.replaceChildren(...trialNodes.map((n) => n.node));
}

function renderTrials() {
  trials.forEach((t, i) => {
    const n = trialNodes[i];
    paintSheet(n.sheet, layersFor(t), t.era);
    n.node.setAttribute("aria-checked", i === picked ? "true" : "false");
    n.node.tabIndex = i === picked ? 0 : -1;
    const p = printFor(sigOf(t));
    n.node.dataset.printed = p && p.status === "done" ? "true" : "false";
    put(n.meta,
      el("span", {}, `+${t.extra.length}`),
      el("span", {}, ERA_ZH[t.era] || ""),
      t.missing.length ? el("span", { class: "trial-miss", title: `沒進這張：${t.missing.map(zh).join("、")}` }, `缺 ${t.missing.length}`) : null,
      p && p.status === "done" ? el("span", { class: "trial-done" }, "已印") : null
    );
    const show = trialHighlights(t);
    put(
      n.picks,
      show.map((tag) =>
        el(
          "span",
          { class: "trial-pick", title: zh(tag), style: `--suit: var(--suit-${suitOf(tag)})` },
          assets.art(tag) ? applyArtSources(el("img", { alt: "", decoding: "async" }), assets.sources(tag)) : el("b", {}, [...zh(tag)][0])
        )
      )
    );
    n.node.setAttribute(
      "aria-label",
      `試印 ${t.letter}：引擎補 ${t.extra.length} 個字，${ERA_ZH[t.era] || ""}${t.missing.length ? `，有 ${t.missing.length} 張你的牌沒進去` : ""}`
    );
  });
}

/** 一張試印裡引擎補的、最看得出差別的幾張：先挑你沒放的那幾套，每套一張。 */
function trialHighlights(t) {
  const filled = new Set(bed.pins.map(suitOf));
  const order = ["look", "wear", "pose", "scene", "cast", "style"].sort((a, b) => filled.has(a) - filled.has(b));
  const out = [];
  for (const suit of order) {
    const hit = t.extra.find((x) => suitOf(x) === suit && assets.art(x) && !out.includes(x));
    if (hit) out.push(hit);
    if (out.length >= 4) break;
  }
  return out;
}

/* ================= 版 ================= */

const plateNode = (tag) => $("registers").querySelector(`.plate-card[data-tag="${cssEsc(tag)}"]`);

function renderPlate(events = []) {
  const box = $("registers");
  const t = trials[picked];
  const effLead = layersFor(t).figure;
  const leadTag = effLead && effLead.src === "mine" ? effLead.tag : null;
  const rows = REGISTERS.map((suit) => {
    const mine = bed.pins.filter((x) => suitOf(x) === suit);
    // 空白的版不列引擎的影子：還沒有東西可以對照，只會讓人以為版上已經有牌。
    const ghosts = bed.pins.length && t ? t.extra.filter((x) => suitOf(x) === suit) : [];
    const info = CARD_SUIT_INFO[suit];
    const cards = [
      ...mine.map((tag) => plateCard(tag, tag === leadTag)),
      ...ghosts.slice(0, GHOST_MAX).map((tag) => ghostCard(tag, t)),
    ];
    if (ghosts.length > GHOST_MAX) cards.push(el("span", { class: "ghost-more", title: ghosts.slice(GHOST_MAX).map(zh).join("、") }, `+${ghosts.length - GHOST_MAX}`));
    const note = rowNotes[suit];
    return el(
      "section",
      { class: "register", dataset: { suit, filled: mine.length ? "true" : "false" }, "aria-label": `${info.zh}：${mine.length} 張` },
      el(
        "header",
        { class: "reg-head" },
        el("span", { class: "reg-glyph", "aria-hidden": "true" }, info.glyph),
        el("span", { class: "reg-role" }, REGISTER_ROLE[suit]),
        el("span", { class: "reg-count" }, mine.length ? String(mine.length) : "")
      ),
      el(
        "div",
        { class: "reg-cards" },
        cards.length ? cards : el("span", { class: "reg-empty" }, suit === "style" ? "不罩色" : bed.pins.length ? "空著" : "空著：引擎會補")
      ),
      note
        ? el(
            "p",
            { class: "reg-note" },
            note.text,
            " ",
            el("button", { class: "link-btn", type: "button", onclick: () => place(note.back) }, "換回")
          )
        : null
    );
  });
  box.replaceChildren(...rows);
  $("plate-sub").textContent = bed.pins.length ? `${bed.pins.length} 張牌，${REGISTERS.filter((s) => bed.pins.some((x) => suitOf(x) === s)).length} 層` : "還沒有牌";
  $("clear").disabled = !bed.pins.length;
  renderPlateNotice();
  requestRelations(events);
}

/** 牌底下四個小點：四張試印各一個，這張牌有進那一張就上墨。 */
function inkDots(tag) {
  return el(
    "span",
    { class: "ink", "aria-hidden": "true" },
    trials.map((tr, i) => el("i", { dataset: { on: tr.mine.includes(tag) ? "1" : "0", pick: i === picked ? "1" : "0" } }))
  );
}

function plateCard(tag, isLead) {
  const card = cardOf(tag);
  const node = cardNode(card, assets, {
    flag: isLead ? { kind: "lead", text: "主" } : null,
    src: bed.carried[tag] ? "附帶" : null,
  });
  const take = takeOf(tag);
  node.classList.add("plate-card");
  node.dataset.ink = take === trials.length ? "full" : take === 0 ? "none" : "part";
  node.append(inkDots(tag));
  const why = take < trials.length ? `，${take}/${trials.length} 張試印有它：${missReason(tag)}` : "";
  node.setAttribute("aria-label", `${card.zh}（${card.tag}）${isLead ? "・主版" : ""}${bed.carried[tag] ? `・跟著「${zh(bed.carried[tag])}」上來` : ""}${why}。Enter 看選項，Delete 拿掉`);
  node.addEventListener("click", () => openPop(node, tag, "plate"));
  node.addEventListener("keydown", (e) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      focusAfterRemoval(node);
      remove(tag);
    } else if ((e.key === "l" || e.key === "L") && canLead(tag, { suitOf, kindOf })) {
      e.preventDefault();
      e.stopPropagation();
      lead(tag);
      plateNode(tag)?.focus();
    }
  });
  drag.attach(node, { tag, from: "plate" });
  return node;
}

function ghostCard(tag, t) {
  const card = cardOf(tag);
  const node = cardNode(card, assets, {});
  node.classList.add("ghost-card");
  node.setAttribute("aria-label", `${card.zh}（${card.tag}）：引擎在試印 ${t.letter} 補的。按一下可以收下`);
  node.addEventListener("click", () => openPop(node, tag, "ghost"));
  drag.attach(node, { tag, from: "ghost" });
  return node;
}

function focusAfterRemoval(node) {
  const all = [...$("registers").querySelectorAll(".plate-card")];
  const i = all.indexOf(node);
  const nextTag = (all[i + 1] || all[i - 1])?.dataset.tag;
  setTimeout(() => {
    const n = nextTag && plateNode(nextTag);
    (n || $("case-q")).focus({ preventScroll: true });
  }, 30);
}

function renderPlateNotice() {
  const head = $("plate").querySelector(".plate-head");
  head.querySelector(".plate-notice")?.remove();
  if (!plateNotice) return;
  head.append(el("p", { class: "plate-notice", dataset: { kind: plateNotice.kind } }, plateNotice.text));
}

function renderUndo() {
  const b = $("undo");
  const last = history.at(-1);
  b.disabled = !last;
  b.title = last ? `撤回：${last.label}（Z）` : "沒有可以撤回的";
  b.setAttribute("aria-label", last ? `撤回：${last.label}` : "撤回");
}

/* ---------- 關係：校對記號 ---------- */

let relTimer = 0;

function requestRelations(events) {
  clearTimeout(relTimer);
  relTimer = setTimeout(() => drawRelations(events), 16);
}

const REL_ZH = { carry: "附帶", echo: "呼應", clash: "相剋" };

function drawRelations(events = []) {
  const box = $("registers");
  box.querySelector(".rel-layer")?.remove();
  const rels = relationsOf(bed, { lex, contradictions, actPlace: ACT_PLACE });
  const keys = new Set(rels.map((r) => r.kind + "|" + r.a + "|" + r.b));
  const fresh = rels.filter((r) => !lastRelKeys.has(r.kind + "|" + r.a + "|" + r.b));
  lastRelKeys = keys;
  if (!rels.length) return;
  const base = box.getBoundingClientRect();
  const layer = el("div", { class: "rel-layer", "aria-hidden": "true" });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(box.scrollWidth));
  svg.setAttribute("height", String(box.scrollHeight));
  layer.append(svg);
  const labels = [];
  // 跨套版的線走右邊的留白（版的右邊特意空了 3rem），像校對稿邊上的記號，不壓到牌。
  const gutter = box.clientWidth - 24;
  for (const r of rels) {
    const na = plateNode(r.a);
    const nb = plateNode(r.b);
    if (!na || !nb) continue;
    const ra = na.getBoundingClientRect();
    const rb = nb.getBoundingClientRect();
    const A = { x: ra.right - base.left, y: ra.top - base.top + ra.height * 0.32 };
    const B = { x: rb.right - base.left, y: rb.top - base.top + rb.height * 0.32 };
    let d;
    let mid;
    if (Math.abs(A.y - B.y) < 12) {
      // 同一個套版裡的兩張：在牌的上緣拱一道小弧。
      A.x = ra.left + ra.width / 2 - base.left;
      B.x = rb.left + rb.width / 2 - base.left;
      A.y = B.y = ra.top - base.top + 2;
      const C = { x: (A.x + B.x) / 2, y: A.y - 16 };
      d = `M${A.x},${A.y} Q${C.x},${C.y} ${B.x},${B.y}`;
      mid = { x: C.x, y: A.y - 8 };
    } else {
      const gx = Math.max(gutter, A.x + 12, B.x + 12);
      d = `M${A.x},${A.y} C${gx},${A.y} ${gx},${B.y} ${B.x},${B.y}`;
      mid = { x: 0.25 * A.x + 0.75 * gx - 2, y: (A.y + B.y) / 2 };
    }
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("class", "rel rel-" + r.kind);
    const isFresh = fresh.includes(r);
    if (isFresh && !reduced()) path.classList.add("is-fresh");
    svg.append(path);
    labels.push(el("span", { class: "rel-tag", dataset: { kind: r.kind }, style: `left:${mid.x}px;top:${mid.y}px` }, REL_ZH[r.kind]));
    if (isFresh && r.kind === "clash") {
      for (const n of [na, nb]) {
        n.classList.remove("is-clashing");
        void n.offsetWidth;
        n.classList.add("is-clashing");
      }
      if (events.length) setTimeout(() => sfx.clash(), 120);
      plateNotice = { kind: "clash", text: `相剋：「${zh(r.a)}」跟「${zh(r.b)}」同時成立不了，引擎會擠掉其中一個` };
      renderPlateNotice();
    }
    if (isFresh && r.kind === "echo" && events.length) {
      plateNotice = { kind: "echo", text: `呼應：「${zh(r.a)}」配「${zh(r.b)}」，這個地方做這件事剛好` };
      renderPlateNotice();
    }
  }
  layer.append(...labels);
  box.append(layer);
}

/* ---------- 牌的小選單 ---------- */

let pop = null;

function closePop({ focus = false } = {}) {
  if (!pop) return;
  const back = pop._anchorTag;
  const from = pop._from;
  pop.remove();
  pop = null;
  document.removeEventListener("pointerdown", onPopOutside, true);
  if (focus && back) (from === "plate" ? plateNode(back) : null)?.focus({ preventScroll: true });
}

function onPopOutside(e) {
  if (pop && !pop.contains(e.target)) closePop();
}

function openPop(anchor, tag, from) {
  closePop();
  hidePeek();
  const card = cardOf(tag);
  const t = trials[picked];
  const lines = [];
  if (from === "plate") {
    const take = takeOf(tag);
    lines.push(
      take === trials.length
        ? ["上墨", `四張試印都有它`]
        : take === 0
          ? ["沒上墨", missReason(tag)]
          : ["上墨", `${take}/${trials.length} 張試印有它；其他張${missReason(tag)}`]
    );
    if (bed.carried[tag]) lines.push(["附帶", `跟著「${zh(bed.carried[tag])}」上來的`]);
    for (const r of relationsOf(bed, { lex, contradictions, actPlace: ACT_PLACE })) {
      if (r.a !== tag && r.b !== tag) continue;
      const other = r.a === tag ? r.b : r.a;
      if (r.kind === "carry" && r.a === tag) lines.push(["附帶", `帶上了「${zh(other)}」`]);
      if (r.kind === "echo") lines.push(["呼應", `跟「${zh(other)}」`]);
      if (r.kind === "clash") lines.push(["相剋", `跟「${zh(other)}」同時成立不了`]);
    }
  } else {
    lines.push(["引擎", `試印 ${t.letter} 補的。收下就固定在版上，每張都會有`]);
  }
  const acts = [];
  if (from === "plate") {
    if (canLead(tag, { suitOf, kindOf })) {
      acts.push(el("button", { class: "btn btn-small", type: "button", onclick: () => (closePop(), lead(tag)) }, bed.lead === tag ? "主版交回自動" : "當主版"));
    }
    acts.push(
      el(
        "button",
        {
          class: "btn btn-small",
          type: "button",
          onclick: () => {
            closePop();
            remove(tag);
          },
        },
        "拿下來"
      )
    );
  } else {
    acts.push(
      el(
        "button",
        {
          class: "btn btn-small btn-primary",
          type: "button",
          onclick: () => {
            closePop();
            place(tag, anchor);
          },
        },
        "收下這張"
      )
    );
  }
  pop = el(
    "div",
    { class: "pop", role: "dialog", "aria-label": card.zh },
    el("p", { class: "pop-title" }, el("b", {}, card.zh), el("code", {}, card.tag)),
    el("dl", { class: "pop-lines" }, lines.map(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])),
    el("div", { class: "pop-acts" }, acts)
  );
  pop._anchorTag = tag;
  pop._from = from;
  pop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closePop({ focus: true });
    }
  });
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  let left = r.left - w - 10;
  if (left < 8) left = Math.min(window.innerWidth - w - 8, r.right + 10);
  let top = Math.max(8, Math.min(window.innerHeight - h - 8, r.top + r.height / 2 - h / 2));
  pop.style.left = Math.max(8, left) + "px";
  pop.style.top = top + "px";
  setTimeout(() => document.addEventListener("pointerdown", onPopOutside, true), 0);
  pop.querySelector(".pop-acts button")?.focus({ preventScroll: true });
}

/* ---------- 動態：飛進版、掀起、壓印 ---------- */

function snapshot(node) {
  return { node, rect: node.getBoundingClientRect() };
}

function flyIn(tag, from) {
  const target = plateNode(tag);
  if (!target) return;
  const to = target.getBoundingClientRect();
  const visible = to.bottom > 0 && to.top < window.innerHeight && to.width > 0;
  if (!from || reduced() || !visible) {
    stamp(target);
    return;
  }
  const clone = target.cloneNode(true);
  clone.classList.add("flying");
  Object.assign(clone.style, { left: to.left + "px", top: to.top + "px", width: to.width + "px" });
  clone.style.setProperty("--card-w", to.width + "px");
  document.body.append(clone);
  target.style.visibility = "hidden";
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const s = from.width / to.width;
  clone.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 1 },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 26}px) scale(${(s + 1) / 2}) rotate(-4deg)`, opacity: 1, offset: 0.55 },
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
    ],
    { duration: 420, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" }
  );
  // 不等 animation.finished：分頁在背景時它可能永遠不 resolve。
  setTimeout(() => {
    clone.remove();
    const n = plateNode(tag);
    if (n) {
      n.style.visibility = "";
      stamp(n);
    }
  }, 430);
}

function popIn(tag, delay) {
  setTimeout(() => {
    const n = plateNode(tag);
    if (n) stamp(n, "is-carried");
  }, delay);
}

function stamp(node, cls = "is-stamped") {
  if (reduced()) return;
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
  setTimeout(() => node.classList.remove(cls), 560);
}

function liftAway(snap, dir) {
  if (reduced() || !snap.rect.width) return;
  const clone = snap.node.cloneNode(true);
  clone.classList.add("flying");
  Object.assign(clone.style, { left: snap.rect.left + "px", top: snap.rect.top + "px", width: snap.rect.width + "px" });
  clone.style.setProperty("--card-w", snap.rect.width + "px");
  document.body.append(clone);
  const to = dir === "aside" ? "translate(-34px, 18px) rotate(-9deg)" : "translate(0, -22px) rotate(4deg)";
  clone.animate(
    [
      { transform: "none", opacity: 1 },
      { transform: to, opacity: 0 },
    ],
    { duration: 340, easing: "cubic-bezier(0.7, 0, 0.84, 0)", fill: "forwards" }
  );
  setTimeout(() => clone.remove(), 360);
}

/* ================= 付印那一條 ================= */

let seedNode = null;

function renderPrintBar() {
  const bar = $("print-bar");
  const t = trials[picked];
  if (!t) return bar.replaceChildren();
  const p = printFor(sigOf(t));
  const busy = p && (p.status === "queued" || p.status === "running");
  const offline = comfyOk === false;
  let label = "付印";
  let disabled = false;
  if (busy) {
    label = p.status === "queued" ? "排隊等印…" : `印製中 ${Math.round((p.progress || 0) * 100)}%`;
    disabled = true;
  } else if (p && p.status === "done") {
    label = "這張印好了";
    disabled = true;
  } else if (p && p.status === "failed") label = "再印一次";
  const summary = [
    `你的 ${bed.pins.length} 張`,
    `引擎補 ${t.extra.length} 字`,
    ERA_ZH[t.era] || "",
    RATING_ZH[settings.rating],
    (SIZES.find((s) => s.w === settings.width && s.h === settings.height) || SIZES[0]).zh,
  ].filter(Boolean);
  put(
    bar,
    el(
      "div",
      { class: "pb-top" },
      el("span", { class: "pb-letter", "aria-hidden": "true" }, t.letter),
      el(
        "div",
        { class: "pb-text" },
        el("p", { class: "pb-title" }, `試印 ${t.letter}`),
        el("p", { class: "pb-sum" }, summary.join("・"))
      )
    ),
    t.missing.length ? el("p", { class: "pb-warn" }, `這張沒收到：${t.missing.map(zh).join("、")}`) : null,
    el(
      "div",
      { class: "pb-acts" },
      el(
        "button",
        {
          class: "btn btn-primary pb-go",
          type: "button",
          disabled: disabled || undefined,
          onclick: () => (p && p.status === "failed" ? reprint(p) : printNow()),
          title: "付印（P）",
        },
        label
      ),
      busy ? el("button", { class: "btn", type: "button", onclick: stopPrinting }, "停") : null
    ),
    seedNode || (seedNode = mountSeedControl(null, { compact: true })),
    offline ? el("p", { class: "pb-hint" }, "印刷機（ComfyUI）沒開。可以繼續疊版、挑試印，開了再付印。") : null,
    p && p.status === "failed" ? el("p", { class: "pb-hint", dataset: { kind: "err" } }, p.note || "印壞了") : null,
    el(
      "p",
      { class: "pb-links" },
      el("button", { class: "link-btn", type: "button", onclick: showPos }, "看 POS"),
      el("button", { class: "link-btn", type: "button", onclick: sendToPool, disabled: !bed.pins.length || undefined }, "把這一版放進墨池的合成池")
    )
  );
}

function showPos() {
  const t = trials[picked];
  if (!t) return;
  openSheet(
    `試印 ${t.letter} 的 POS`,
    el(
      "div",
      {},
      el("p", { class: "tag-en" }, `seed ${t.seed}・${ERA_ZH[t.era] || ""}・${settings.width}×${settings.height}`),
      el("pre", { class: "pos-text" }, insertTriggerAfterCast(t.positive, currentTriggerText()))
    ),
    {
      wide: true,
      foot: [
        el(
          "button",
          {
            class: "btn btn-small",
            type: "button",
            onclick: async (e) => {
              try {
                await navigator.clipboard.writeText(insertTriggerAfterCast(t.positive, currentTriggerText()));
                e.target.textContent = "複製好了";
              } catch {
                e.target.textContent = "複製不了，請手動選取";
              }
            },
          },
          "複製 POS"
        ),
      ],
    }
  );
}

function sendToPool() {
  if (!bed.pins.length) return;
  S.savePool(bed.pins);
  const b = $("print-bar").querySelector(".pb-links button:last-child");
  if (b) b.textContent = "放好了：回墨池工作臺就看得到";
  announce("這一版的牌放進墨池的合成池了");
}

/* ================= 晾紙繩 ================= */

function renderLine() {
  const list = $("line-list");
  list.replaceChildren(...prints.map((p) => el("li", {}, lineItem(p))));
  $("line-empty").hidden = prints.length > 0;
}

function lineItem(p) {
  const face = el("span", { class: "print-face", style: `aspect-ratio: ${p.width} / ${p.height}` });
  const node = el(
    "button",
    { class: "print", type: "button", dataset: { id: p.id, status: p.status }, onclick: () => openPrint(p) },
    el("span", { class: "print-pin", "aria-hidden": "true" }),
    face,
    el("span", { class: "print-ring", "aria-hidden": "true" })
  );
  paintLineNode(node, p);
  return node;
}

const STATUS_ZH = { drawn: "排隊", queued: "排隊", running: "印製中", done: "印好了", failed: "印壞了", cancelled: "取消了", stopped: "停了" };

function paintLineNode(node, p) {
  node.dataset.status = p.status;
  const face = node.querySelector(".print-face");
  const src = p.image || p.preview;
  const img = face.querySelector("img");
  if (src) {
    if (!img) face.replaceChildren(el("img", { src, alt: "", decoding: "async", draggable: "false" }));
    else if (img.getAttribute("src") !== src) img.src = src;
  } else face.replaceChildren(el("span", { class: "print-state" }, STATUS_ZH[p.status] || ""));
  node.style.setProperty("--p", String(p.status === "running" ? p.progress || 0 : p.status === "done" ? 1 : 0));
  node.setAttribute("aria-label", `試印 ${p.letter || ""}・${STATUS_ZH[p.status] || ""}・你的 ${p.mine?.length || 0} 張牌。點開看，或回到這一版`);
}

function paintLineItem(p) {
  const node = $("line-list").querySelector(`.print[data-id="${cssEsc(p.id)}"]`);
  if (node) paintLineNode(node, p);
  else renderLine();
}

function openPrint(p) {
  const src = p.image || p.preview;
  const mine = (p.mine && p.mine.length ? p.mine : p.bed?.pins || []).filter((t) => lib.byTag.has(t));
  let sheet = null;
  const foot = [
    el(
      "button",
      {
        class: "btn btn-small btn-primary",
        type: "button",
        onclick: () => {
          sheet.close();
          restorePrint(p);
        },
      },
      "回到這一版"
    ),
    p.status === "failed" || p.status === "stopped" || p.status === "cancelled"
      ? el("button", { class: "btn btn-small", type: "button", onclick: () => (sheet.close(), reprint(p)) }, "再印一次")
      : null,
    p.image ? el("a", { class: "btn btn-small", href: p.image, target: "_blank", rel: "noopener" }, "開原圖") : null,
    el(
      "button",
      {
        class: "btn btn-small",
        type: "button",
        onclick: () => {
          if (p.status === "queued" || p.status === "running") return;
          prints = prints.filter((x) => x !== p);
          savePrints();
          renderLine();
          renderAll([]);
          sheet.close();
          announce("撤下了這一張");
        },
      },
      "從繩上撤下"
    ),
  ];
  sheet = openSheet(
    `試印 ${p.letter || ""}・${STATUS_ZH[p.status] || ""}`,
    el(
      "div",
      { class: "print-view" },
      src ? el("img", { class: "print-view-img", src, alt: "成品" }) : el("p", { class: "print-view-empty" }, p.note || STATUS_ZH[p.status] || ""),
      el(
        "div",
        { class: "print-view-side" },
        el(
          "p",
          { class: "tag-en" },
          seedUseButton(p.seed),
          "・" + [ERA_ZH[p.era] || "", `${p.width}×${p.height}`, RATING_ZH[p.rating] || ""].filter(Boolean).join("・")
        ),
        el("p", { class: "print-view-label" }, `這一版的牌（${mine.length}）`),
        el("div", { class: "print-view-cards" }, mine.map((t) => cardNode(cardOf(t), assets, { tagName: "div" }))),
        el("details", { class: "print-view-pos" }, el("summary", {}, "POS"), el("pre", { class: "pos-text" }, p.positive))
      )
    ),
    { wide: true, foot }
  );
}

/* ================= 字盒 ================= */

function renderCaseTabs() {
  const box = $("case-tabs");
  const tabs = [
    ["all", "全部", null],
    ["match", "相配", null],
    ...CARD_SUITS.map((s) => [s, CARD_SUIT_INFO[s].zh, s]),
  ];
  box.replaceChildren(
    ...tabs.map(([id, label, suit]) =>
      el(
        "button",
        {
          class: "case-tab",
          type: "button",
          dataset: { tab: id, suit: suit || "" },
          title: suit ? `${label}（${CARD_SUIT_INFO[suit].glyph}）` : undefined,
          "aria-pressed": caseTab === id ? "true" : "false",
          onclick: () => {
            caseTab = id;
            writeJ(FK.tab, id);
            renderCaseTabs();
            renderCase();
          },
        },
        suit ? el("i", { class: "tab-dot", "aria-hidden": "true" }, CARD_SUIT_INFO[suit].glyph) : label,
        suit ? el("span", { class: "sr-only" }, label) : null
      )
    )
  );
}

function visibleCard(card) {
  if (!rankOk(card) || bans.has(card.tag)) return false;
  if (card.gate === "male" && !settings.boy) return false;
  if (card.gate === "female" && !settings.girl) return false;
  return true;
}

function affinities() {
  const out = new Map();
  const has = new Set(bed.pins);
  for (const a of bed.pins) {
    const places = ACT_PLACE[a];
    if (!places) continue;
    for (const p of places) if (lib.byTag.has(p) && !has.has(p) && !out.has(p)) out.set(p, "呼應");
  }
  for (const [act, places] of Object.entries(ACT_PLACE)) {
    if (!lib.byTag.has(act) || has.has(act) || out.has(act)) continue;
    if (bed.pins.some((p) => places.has(p))) out.set(act, "呼應");
  }
  const freq = new Map();
  for (const t of trials) for (const x of t.extra) freq.set(x, (freq.get(x) || 0) + 1);
  [...freq]
    .filter(([x, c]) => c >= 2 && !out.has(x))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 36)
    .forEach(([x, c]) => out.set(x, `常補 ${c}/4`));
  return out;
}

function renderCase() {
  const q = caseQuery.trim().toLowerCase();
  let list;
  let reasons = null;
  if (caseTab === "match") {
    reasons = affinities();
    list = [...reasons.keys()].map(cardOf).filter(Boolean);
  } else {
    list = lib.cards.filter((c) => caseTab === "all" || c.suit === caseTab);
  }
  list = list.filter(visibleCard);
  if (q) list = list.filter((c) => c.zh.toLowerCase().includes(q) || c.tag.includes(q) || (c.groupZh || "").includes(q));
  caseList = list;
  caseShown = 0;
  const grid = $("case-grid");
  grid.replaceChildren();
  grid._reasons = reasons;
  $("case-count").textContent = `${list.length} 張`;
  if (!list.length) {
    grid.append(
      el(
        "p",
        { class: "case-empty" },
        caseTab === "match" && !bed.pins.length ? "放一張牌上版，這裡會列出跟它呼應的牌，和引擎常常補進來的牌。" : "沒有符合的牌。"
      )
    );
    return;
  }
  moreCase();
}

let caseObserver = null;

function moreCase() {
  const grid = $("case-grid");
  grid.querySelector(".case-more")?.remove();
  const slice = caseList.slice(caseShown, caseShown + PAGE);
  caseShown += slice.length;
  const reasons = grid._reasons;
  const has = new Set(bed.pins);
  for (const card of slice) {
    const node = cardNode(card, assets, { src: reasons ? reasons.get(card.tag) : null });
    node.tabIndex = grid.querySelector(".card") ? -1 : 0;
    if (has.has(card.tag)) node.dataset.state = "pinned";
    node.setAttribute("aria-pressed", has.has(card.tag) ? "true" : "false");
    node.addEventListener("click", () => toggle(card.tag, node));
    drag.attach(node, { tag: card.tag, from: "case" });
    grid.append(node);
  }
  if (caseShown < caseList.length) {
    const more = el("span", { class: "case-more", "aria-hidden": "true" });
    grid.append(more);
    if (!caseObserver) {
      caseObserver = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) moreCase();
      }, { rootMargin: "400px" });
    }
    caseObserver.disconnect();
    caseObserver.observe(more);
  }
}

function syncCaseStates() {
  const has = new Set(bed.pins);
  for (const node of $("case-grid").querySelectorAll(".card[data-tag]")) {
    const on = has.has(node.dataset.tag);
    if (on) node.dataset.state = "pinned";
    else delete node.dataset.state;
    node.setAttribute("aria-pressed", on ? "true" : "false");
  }
}

/** 字盒用方向鍵走：整片只佔一個 Tab 停點。 */
function caseKeys(e) {
  const grid = $("case-grid");
  const cards = [...grid.querySelectorAll(".card")];
  const i = cards.indexOf(document.activeElement);
  if (i < 0) return;
  let cols = 1;
  const top = cards[0].offsetTop;
  while (cols < cards.length && cards[cols].offsetTop === top) cols++;
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -i, End: cards.length - 1 - i }[e.key];
  if (step === undefined) return;
  e.preventDefault();
  const j = Math.max(0, Math.min(cards.length - 1, i + step));
  cards[i].tabIndex = -1;
  cards[j].tabIndex = 0;
  cards[j].focus();
  if (j >= cards.length - 3 && caseShown < caseList.length) moreCase();
}

function peekInfo(node) {
  const card = cardOf(node.dataset.tag);
  if (!card || document.body.dataset.dragging === "true" || pop) return null;
  const facts = cardFacts(card, lex, data).filter(([k]) => k !== "分級").slice(0, 4);
  if (bed.pins.includes(card.tag)) {
    const take = takeOf(card.tag);
    facts.unshift(["上墨", take === trials.length ? "四張試印都有它" : `${take}/${trials.length} 張試印有它`]);
  }
  return {
    zh: card.zh,
    tag: card.tag,
    glyph: CARD_SUIT_INFO[card.suit].glyph,
    suitColor: getComputedStyle(document.documentElement).getPropertyValue(`--suit-${card.suit}`).trim(),
    art: assets.art(card.tag),
    rating: card.rating,
    facts,
  };
}

/* ================= 拖曳 ================= */

const drag = createDrag({
  zones: () => [
    { id: "plate", el: $("plate"), accepts: (p) => p.from !== "plate" },
    { id: "proof", el: $("proof"), accepts: (p) => p.from !== "plate" },
    { id: "case", el: $("case"), accepts: (p) => p.from === "plate" },
  ],
  onDrop: (p, zone) => {
    if (zone === "case") remove(p.tag);
    else place(p.tag, null);
  },
});

/* ================= 桅杆、規則 ================= */

function renderRating() {
  $("rating").replaceChildren(
    ...["general", "sensitive", "explicit"].map((r) =>
      el(
        "button",
        {
          type: "button",
          role: "radio",
          "aria-checked": settings.rating === r ? "true" : "false",
          dataset: { v: r },
          onclick: () => {
            setSettings({ rating: r });
            renderRating();
          },
        },
        RATING_LABEL[r]
      )
    )
  );
}

async function pingLoop() {
  const p = $("ping");
  const ok = await comfyOnline();
  const changed = ok !== comfyOk;
  comfyOk = ok;
  p.dataset.ok = ok ? "1" : "0";
  p.querySelector("span").textContent = ok ? "Comfy 已連" : "Comfy 未連";
  if (changed && trials.length) renderPrintBar();
  setTimeout(pingLoop, ok ? 15000 : 6000);
}

function segmented(label, options, current, onPick) {
  return el(
    "div",
    { class: "segmented", role: "radiogroup", "aria-label": label },
    options.map(([v, text]) =>
      el(
        "button",
        {
          type: "button",
          role: "radio",
          "aria-checked": current === v ? "true" : "false",
          onclick: (e) => {
            onPick(v);
            for (const b of e.currentTarget.parentNode.children) b.setAttribute("aria-checked", b === e.currentTarget ? "true" : "false");
          },
        },
        text
      )
    )
  );
}

function openRules() {
  const size = (SIZES.find((s) => s.w === settings.width && s.h === settings.height) || SIZES[0]).id;
  const who = settings.girl && settings.boy ? "any" : settings.boy ? "boy" : "girl";
  const eraSel = el(
    "select",
    { class: "select", "aria-label": "時代" },
    el("option", { value: "mixed" }, "混合（每張隨機）"),
    ERAS.map((e) => el("option", { value: e }, ERA_LABELS[e]))
  );
  eraSel.value = settings.eras.length === 1 ? settings.eras[0] : "mixed";
  eraSel.onchange = () => setSettings({ eras: eraSel.value === "mixed" ? [...ERAS] : [eraSel.value] });
  const heats = el(
    "div",
    { class: "rule-chips", role: "group", "aria-label": "情境" },
    HEATS.map((h) => {
      const blocked = heatBlockedByRating(h, settings.rating);
      return el(
        "button",
        {
          class: "chip-toggle",
          type: "button",
          "aria-pressed": settings.heats.includes(h) && !blocked ? "true" : "false",
          disabled: blocked || undefined,
          title: blocked ? `${RATING_LABEL[settings.rating]}不會出現${HEAT_ZH[h]}` : undefined,
          onclick: (e) => {
            setSettings({ heats: toggleHeat(settings.heats, h) });
            e.currentTarget.setAttribute("aria-pressed", settings.heats.includes(h) ? "true" : "false");
          },
        },
        HEAT_ZH[h]
      );
    })
  );
  const row = (label, control) => el("div", { class: "rule-row" }, el("span", { class: "rule-label" }, label), control);
  let sheet = null;
  sheet = openSheet(
    "規則",
    el(
      "div",
      { class: "rules-sheet" },
      el("p", { class: "rules-note" }, "跟墨池工作臺共用同一組規則。改了之後四張試印會立刻重印。"),
      row(
        "尺寸",
        segmented(
          "尺寸",
          SIZES.map((s) => [s.id, `${s.zh} ${s.w}×${s.h}`]),
          size,
          (v) => {
            const s = SIZES.find((x) => x.id === v);
            setSettings({ width: s.w, height: s.h });
          }
        )
      ),
      row(
        "畫面裡有誰",
        segmented(
          "畫面裡有誰",
          [
            ["girl", "女"],
            ["boy", "男"],
            ["any", "不限"],
          ],
          who,
          (v) => setSettings({ girl: v !== "boy", boy: v !== "girl" })
        )
      ),
      row("時代", eraSel),
      row("情境", heats)
    ),
    { foot: [el("button", { class: "btn btn-primary", type: "button", onclick: () => sheet && sheet.close() }, "好了")] }
  );
}

function wireChrome() {
  $("rules-btn").addEventListener("click", openRules);
  const snd = $("sound-btn");
  const syncSound = () => {
    snd.setAttribute("aria-pressed", sfx.on ? "true" : "false");
    snd.textContent = sfx.on ? "聲音 開" : "聲音 關";
  };
  syncSound();
  snd.addEventListener("click", () => {
    sfx.on = !sfx.on;
    syncSound();
    if (sfx.on) sfx.carry();
  });
  $("undo").addEventListener("click", undo);
  $("clear").addEventListener("click", clearBed);
  $("reroll").addEventListener("click", reroll);
  const q = $("case-q");
  let qTimer = 0;
  q.addEventListener("input", () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      caseQuery = q.value;
      renderCase();
    }, 120);
  });
  $("case-grid").addEventListener("keydown", caseKeys);
  $("mini-proof").addEventListener("click", () => $("proof").scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" }));
  document.addEventListener("pointerdown", (e) => (lastPointer = e.pointerType || "mouse"), true);
  document.addEventListener("keydown", onKey);
  let rTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(rTimer);
    rTimer = setTimeout(() => {
      closePop();
      drawRelations([]);
    }, 120);
  });
  $("plate-scroll").addEventListener("scroll", () => closePop(), { passive: true });
}

function onKey(e) {
  if (handleLoraKeys(e) || wfHandleKeys(e)) return;
  if (anyOverlay() || e.altKey) return;
  const t = e.target;
  const typing = t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA");
  if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
    if (typing) return;
    e.preventDefault();
    undo();
    return;
  }
  if (e.ctrlKey || e.metaKey) return;
  if (e.key === "Escape") {
    if (pop) closePop({ focus: true });
    else if (typing && t.id === "case-q") t.blur();
    return;
  }
  if (typing) return;
  if (e.key === "/") {
    e.preventDefault();
    $("case-q").focus();
  } else if (e.key === "z" || e.key === "Z") {
    e.preventDefault();
    undo();
  } else if (e.key >= "1" && e.key <= "4") {
    e.preventDefault();
    pick(Number(e.key) - 1);
  } else if (e.key === "r" || e.key === "R") {
    e.preventDefault();
    reroll();
  } else if (e.key === "p" || e.key === "P") {
    e.preventDefault();
    printNow();
  }
}

/* ================= 手機：校樣捲出畫面時，角落留一張小的 ================= */

function watchMiniProof() {
  const mini = $("mini-proof");
  if (typeof IntersectionObserver !== "function") return;
  const narrow = matchMedia("(max-width: 68.74rem)");
  let proofVisible = true;
  const sync = () => {
    const show = narrow.matches && !proofVisible;
    mini.hidden = !show;
  };
  new IntersectionObserver((entries) => {
    proofVisible = entries.some((e) => e.isIntersecting);
    sync();
  }, { threshold: 0.15 }).observe($("proof"));
  narrow.addEventListener("change", sync);
}

boot();
