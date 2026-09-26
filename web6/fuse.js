/**
 * 墨池 · 疊印台。
 *
 * 一張牌是一層墨。中間的「卡池」照花色分成六列套版（罩色、姿勢、服裝、長相、人物、底色），
 * 你放的牌是實牌；同一列後面排著灰色的影子，是選中那張試印裡引擎替你補的牌 ——
 * 整個卡池就是那一張圖的配方，每一張都能點、能拖、能收下或拿掉。
 *
 * 真正會送出去的 POS 由 engine 跑四張「試印」：同一批種子，每疊一張牌就重跑一次
 * （一次 ~25ms），所以看得到「加了這張，引擎補的牌怎麼變」；也看得到你的牌有沒有真的上墨
 * （牌角四個點，四張試印裡進了幾張）。挑一張試印按付印，才送 ComfyUI；成品出現在右欄上方，
 * 也夾一張到上面的晾紙繩，點它可以回到那一版。
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
import { createDrag, inkRing } from "./drag.js";
import { createGenerator, comfyOnline, viewSrc, tabTitle, watchLink, LINK_LABEL } from "./gen.js";
import { attachPeek, hidePeek } from "./card-peek.js";
import * as S from "./store.js";
import { REGISTERS, REGISTER_ROLE, emptyBed, sanitizeBed, placeCard, removeCard, relationsOf } from "./fuse-bed.js";
import { createSfx } from "./fuse-sfx.js";
import { genSeed, isFixedSeed, mountSeedControl, onSeedChange, seedUseButton, useSeed } from "./seed-control.js";

const $ = (id) => document.getElementById(id);
const LETTERS = ["A", "B", "C", "D"];
const TRIALS = 4;
// 字盒一次長出幾張：第一眼只看得到十幾張，捲到接近底部（IntersectionObserver，提早 400px）再補下一批。
const PAGE = 40;
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
// 卡池、試印的種子、挑哪一張都不存：重新整理就是空白的版和一批新種子。
// 晾紙繩（付印過的作品）留著，點「回到這一版」可以把當時的卡池叫回來。
const FK = { prints: "mochi.fuse.prints.v1", tab: "mochi.fuse.tab.v1" };
const FK_OLD = ["mochi.fuse.bed.v1", "mochi.fuse.seeds.v1", "mochi.fuse.picked.v1"];

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
let settings = null;
let bans = new Set();
let bed = emptyBed();
let seeds = [];
let picked = 0;
let trials = [];
let prints = [];
let history = [];
let expanded = new Set();
let comfyOk = null;
// 最近一次探到的連線狀態（見 gen.js linkState）：斷的是網路還是 ComfyUI，提示要分開講。
let linkNow = "ok";
let rowNotes = {};
let plateNotice = null;
let lastRelKeys = new Set();
let caseTab = "all";
let caseGroup = "";
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

/** 把一串子節點換上去，null／false 略過（replaceChildren 會把 null 印成字）。 */
function put(node, ...kids) {
  node.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
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
      fetch("cards/manifest.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    data = lexicon;
    lex = indexLexicon(data);
    lib = buildLibrary(data, { ratingBlocked });
    assets = createAssets(man || {});
  } catch (err) {
    $("registers").replaceChildren(el("p", { class: "boot-fail" }, "讀不到詞庫。請用 start-web6.bat 開，而不是直接點 HTML。", el("br"), String(err)));
    return;
  }
  settings = sanitizeSettings(S.loadSettings() || { rating: "general" }, data);
  bans = new Set(S.loadBans().filter((t) => lib.byTag.has(t)));
  bed = emptyBed();
  seeds = freshSeeds();
  picked = 0;
  for (const k of FK_OLD) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* 舊版存下的版：刪不了也不會再讀 */
    }
  }
  caseTab = readJ(FK.tab, "all") || "all";
  prints = loadPrints();

  initLoraPicker();
  initWorkflow();
  pingLoop();
  wireChrome();

  buildPreview();
  buildTrialShells();
  renderRating();
  renderCaseTabs();
  retrial();
  renderAll();
  renderCase();
  renderLine();
  for (const p of prints) if (p.status === "queued" && p.live && p.job) generator.resume(p);
  attachPeek($("case-grid"), ".card[data-tag]", peekInfo);
  // 生圖種子一換，同一張試印對應的成品就不一樣了：成品、付印那條、試印上的小圖都要重畫。
  onSeedChange(() => {
    renderPreview();
    renderTrials();
    renderPrintBar();
  });
  attachPeek($("registers"), ".card[data-tag]", peekInfo);
  watchPoolPill();

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

/**
 * 放一張牌上版。viaDrag：是拖進來的 —— 飛過去、落地由 drag.js 演，這裡不另外飛；
 * 蓋章聲、那一列的墨、被帶上來的牌跳出來，都等影子落地才做（回傳 { landed }）。
 */
function place(tag, sourceEl, { viaDrag = false } = {}) {
  if (!lib.byTag.has(tag)) return;
  if (bed.pins.includes(tag)) return;
  const from = sourceEl && sourceEl.isConnected ? sourceEl.getBoundingClientRect() : null;
  const { bed: next, events } = placeCard(bed, tag, deps());
  if (!events.length) return;
  const leaving = events.filter((e) => e.kind === "replace").map((e) => plateNode(e.out)).filter(Boolean).map(snapshot);
  commit(next, `放上「${zh(tag)}」`, events);
  const carried = events.filter((e) => e.kind === "carry").map((e) => e.tag);
  const settle = (lag) => {
    carried.forEach((t, i) => popIn(t, lag + i * 90));
    inkRow(suitOf(tag));
    sfx.stamp();
    if (carried.length) sfx.carry();
    haptic(8);
  };
  // 被擠掉的牌現在就離開（新的那張正飛過來）。
  leaving.forEach((snap) => liftAway(snap, "aside"));
  if (leaving.length) setTimeout(() => sfx.lift(), 90);
  let result;
  if (viaDrag) {
    // 目的地先藏著等影子落下；被帶上來的牌也先別跳出來。
    carried.forEach((t) => {
      const n = plateNode(t);
      if (n) n.style.visibility = "hidden";
    });
    result = {
      landed: () => {
        carried.forEach((t) => {
          const n = plateNode(t);
          if (n) n.style.visibility = "";
        });
        settle(60);
      },
    };
  } else {
    flyIn(tag, from);
    settle(140);
  }
  const bits = [`放上「${zh(tag)}」`];
  if (carried.length) bits.push(`帶上${carried.map((t) => `「${zh(t)}」`).join("")}`);
  for (const e of events) if (e.kind === "replace") bits.push(`「${zh(e.out)}」${e.why === "era" ? "時代不合拿下" : "被換下"}`);
  announce(bits.join("，"));
  return result;
}

/** 拿下一張。viaDrag：拖回字盒的那張由 drag.js 飛回去，這裡只讓它帶上來的牌掀起來。 */
function remove(tag, { viaDrag = false } = {}) {
  if (!bed.pins.includes(tag)) return;
  const { bed: next, events } = removeCard(bed, tag);
  const snaps = (events[0]?.tags || [tag]).filter((t) => !(viaDrag && t === tag)).map((t) => plateNode(t)).filter(Boolean).map(snapshot);
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
  starter.tags.forEach((t, i) => setTimeout(() => (inkRow(suitOf(t)), sfx.stamp()), i * 120));
  announce(`起手：${starter.name}，疊上${starter.tags.map((t) => `「${zh(t)}」`).join("")}`);
}

function undo() {
  const h = history.pop();
  if (!h) return;
  // 撤掉的牌先記下位置（重畫之後原地掀起飄走），回來的牌重畫之後一張一張落回去。
  const back = new Set(h.bed.pins);
  const was = new Set(bed.pins);
  const leaving = bed.pins.filter((t) => !back.has(t)).map(plateNode).filter(Boolean).map(snapshot);
  const returning = h.bed.pins.filter((t) => !was.has(t));
  bed = h.bed;
  rowNotes = {};
  plateNotice = null;
  retrial();
  renderAll([]);
  syncCaseStates();
  if (caseTab === "match") renderCase();
  leaving.forEach((s) => liftAway(s, "up"));
  returning.forEach((t, i) => popIn(t, 40 + i * 70));
  sfx.lift();
  if (returning.length) setTimeout(() => sfx.stamp(), 60);
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
  renderPlate([]);
  swapGhosts();
  renderPreview();
  renderTrials();
  renderPrintBar();
  if (!quiet) sfx.carry();
  announce(`換到試印 ${LETTERS[i]}`);
}

function reroll() {
  seeds = freshSeeds();
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

const tabNote = tabTitle();

const generator = createGenerator({
  payload: (p) => ({ width: p.width, height: p.height, loras: p.loras, ckpt: p.ckpt, rating: p.rating, workflowId: p.workflowId }),
  update: (p) => {
    tabNote.shot(p, generator.pending);
    paintLineItem(p);
    // 拿到伺服器的工作編號就先存一次：畫到一半重新整理也接得回來。
    if (p.job && p._savedJob !== p.job) {
      p._savedJob = p.job;
      savePrints();
    }
    paintTrialFacesFor(p.sig);
    const t = trials[picked];
    if (t && p.sig === sigOf(t)) {
      renderPreview({ develop: p.status === "done" });
      renderPrintBar();
    } else if (p._shownStatus !== p.status) {
      // 別張開始印、印完了：成品區那行「晾紙繩上還有一張在印」要跟著出現或拿掉（進度每一格不必重畫）。
      renderPreview();
    }
    p._shownStatus = p.status;
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
  // 網路斷了：佇列停在原地等，回來就接著印。提示只收自己放的那一則，別人的不動。
  waiting: (on) => {
    if (on) plateNotice = { kind: "err", text: NET_WAIT_TEXT };
    else if (plateNotice && plateNotice.text === NET_WAIT_TEXT) plateNotice = null;
    renderPlateNotice();
  },
});
const NET_WAIT_TEXT = "連不到主機（網路斷了？），網路回來就接著印";

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
    announce(linkNow === "net" ? "連不到主機（網路斷了？），接上再送" : "印刷機（ComfyUI）沒開，先不送");
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
    bed: { pins: [...bed.pins], carried: { ...bed.carried } },
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
  // 先夾上繩子再交給佇列：enqueue 會馬上回報狀態，那時繩上要已經有這張，
  // 不然它會自己重畫一次繩子，這裡再畫一次就把「剛夾上去晃一晃」蓋掉了。
  renderLine();
  generator.enqueue(p);
  savePrints();
  // 新的一張夾在最左邊：繩子已經往右捲的話捲回去，才看得到它開始印。
  $("line-list").scrollTo({ left: 0, behavior: reduced() ? "auto" : "smooth" });
  renderPreview();
  renderTrials();
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
    .map((p) => ({
      ...p,
      // 畫到一半就重新整理的那張：標成排隊，開機時用 generator.resume() 接回去。
      status: p.status === "done" ? "done" : p.status === "failed" ? "failed" : p.live && p.job ? "queued" : "stopped",
      preview: null,
      progress: p.status === "done" ? 1 : 0,
    }));
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
      job: p.job || null,
      live: !!p.job && (p.status === "running" || p.status === "queued"),
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
  // 尺寸、尺度一起回到印的那時候：色情尺度印的那一版，在全年齡底下根本抽不到當時的牌。
  const ratingBack = p.rating && p.rating !== settings.rating && RATING_RANK[p.rating] !== undefined;
  const sizeBack = p.width && p.height && (p.width !== settings.width || p.height !== settings.height);
  if (ratingBack || sizeBack) {
    settings = sanitizeSettings(
      { ...settings, ...(sizeBack ? { width: p.width, height: p.height } : {}), ...(ratingBack ? { rating: p.rating } : {}) },
      data
    );
    S.saveSettings(settings);
  }
  rowNotes = {};
  retrial();
  const t = trials[picked];
  const same = t && sigOf(t) === p.sig;
  const bits = [ratingBack ? `尺度切回「${RATING_LABEL[p.rating]}」` : "", sizeBack ? "尺寸也換回當時的" : ""].filter(Boolean);
  // 看得見的說明：尺度換了、或是規則改過對不上當時那張，都寫在卡池上面。
  plateNotice =
    bits.length || !same
      ? { kind: same ? "info" : "err", text: `回到這一版${bits.length ? "：" + bits.join("，") : ""}${same ? "" : "。規則（時代、情境、人物…）改過，試印跟當時不一樣"}` }
      : null;
  if (ratingBack) {
    renderRating();
    renderCase();
  }
  renderAll([]);
  syncCaseStates();
  sfx.stamp();
  announce(plateNotice ? plateNotice.text : "回到這一版了");
}

/* ================= 畫面：全部 ================= */

function renderAll(events = []) {
  renderPlate(events);
  renderPreview();
  renderTrials();
  renderPrintBar();
  renderUndo();
}

/* ================= 成品：選中的那張試印印出來的樣子 ================= */

let pv = null;

function buildPreview() {
  const sheet = el("button", {
    class: "pv-sheet",
    type: "button",
    onclick: () => {
      const p = printFor(sigOf(trials[picked]));
      if (p && (p.image || p.preview)) openPrint(p);
    },
  });
  const blank = el("span", { class: "pv-blank" });
  const roller = el("span", { class: "pv-roller", "aria-hidden": "true" }, el("i"));
  sheet.append(blank, roller);
  const frame = el(
    "div",
    { class: "pv-frame" },
    ["tl", "tr", "bl", "br"].map((c) => el("span", { class: "crop " + c, "aria-hidden": "true" })),
    sheet
  );
  const cap = el("p", { class: "pv-cap" });
  $("preview").replaceChildren(frame, cap);
  pv = { frame, sheet, blank, roller, cap };
}

/** 別張（不是選中這張試印的）還在印或排隊：改了卡池之後，成品區換成新的試印，但舊的那張還在跑。 */
function otherPrinting() {
  return prints.some((x) => x.status === "running" || x.status === "queued" || x.status === "drawn");
}

function previewState(p) {
  if (!p) return "還沒付印";
  if (p.status === "running") return `印製中 ${Math.round((p.progress || 0) * 100)}%`;
  if (p.status === "queued" || p.status === "drawn") return "排隊等印…";
  return STATUS_ZH[p.status] || "";
}

function renderPreview({ develop = false } = {}) {
  const t = trials[picked];
  if (!pv || !t) return;
  const p = printFor(sigOf(t));
  const w = p ? p.width : settings.width;
  const h = p ? p.height : settings.height;
  pv.frame.style.setProperty("--arn", String(w / h));
  pv.sheet.style.setProperty("--ar", `${w} / ${h}`);
  const state = p ? p.status : "none";
  pv.sheet.dataset.state = state;
  const src = p ? viewSrc(p.image) || p.preview : null;
  let img = pv.sheet.querySelector("img");
  if (src) {
    if (!img) {
      img = el("img", { alt: "", decoding: "async", draggable: "false" });
      pv.sheet.prepend(img);
    }
    if (img.getAttribute("src") !== src) img.src = src;
    img.alt = `試印 ${t.letter} 的成品`;
  } else img?.remove();
  // 印製中的預覽幀越印越濃，印好才是全濃度。
  pv.sheet.style.setProperty("--print-o", state === "running" ? String(0.4 + 0.6 * (p.progress || 0)) : "1");
  if (develop && src && !reduced()) {
    // 成品剛好在眼前印好：像紙從滾筒下出來，由上往下顯影。
    pv.sheet.classList.remove("is-developing");
    void pv.sheet.offsetWidth;
    pv.sheet.classList.add("is-developing");
    setTimeout(() => pv.sheet.classList.remove("is-developing"), 1300);
  }
  pv.sheet.disabled = !src;
  pv.sheet.setAttribute("aria-label", src ? `試印 ${t.letter} 的成品，點開看大圖` : `試印 ${t.letter}：${previewState(p)}`);
  pv.blank.hidden = !!src;
  if (!src) {
    put(
      pv.blank,
      el("b", { class: "pv-letter", "aria-hidden": "true" }, t.letter),
      el("span", { class: "pv-state" }, previewState(p)),
      !p ? el("span", { class: "pv-hint" }, otherPrinting() ? "晾紙繩上還有一張在印；這一版挑好也可以先付印，會排在它後面。" : "挑好就付印。印好的圖出現在這裡，也會夾一張到上面的繩子。") : null,
      p && p.status === "failed" && p.note ? el("span", { class: "pv-hint" }, p.note) : null
    );
  }
  pv.roller.hidden = !(state === "running" || state === "queued" || state === "drawn");
  pv.roller.dataset.state = state;
  pv.roller.style.setProperty("--p", String(state === "running" ? p.progress || 0 : 0));
  put(
    pv.cap,
    el("b", { class: "pv-cap-letter" }, `試印 ${t.letter}`),
    el("span", { class: "pv-cap-state", dataset: { state } }, previewState(p)),
    el("span", { class: "pv-cap-seed" }, `${isFixedSeed() ? "固定 seed" : "seed"} ${p ? p.seed : printSeedOf(t)}`)
  );
}

/** 付印：一條滾筒的陰影從成品那張紙上壓過去。 */
function rollPress() {
  if (reduced() || !pv) return;
  const r = el("span", { class: "press-roll", "aria-hidden": "true" });
  pv.sheet.append(r);
  setTimeout(() => r.remove(), 900);
}

/* ================= 試印 ================= */

let trialNodes = [];

function buildTrialShells() {
  const box = $("trials");
  trialNodes = LETTERS.map((letter, i) => {
    const face = el("span", { class: "trial-face", "aria-hidden": "true" }, el("b", { class: "trial-letter" }, letter));
    const meta = el("span", { class: "trial-meta" });
    const picks = el("span", { class: "trial-picks", "aria-hidden": "true" });
    const node = el(
      "button",
      { class: "trial", type: "button", role: "radio", dataset: { i: String(i) }, onclick: () => pick(i) },
      face,
      el("span", { class: "trial-body" }, meta, picks)
    );
    node.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const j = (i + d + TRIALS) % TRIALS;
      pick(j);
      trialNodes[j].node.focus();
    });
    return { node, face, meta, picks };
  });
  box.replaceChildren(...trialNodes.map((n) => n.node));
}

function renderTrials() {
  trials.forEach((t, i) => {
    const n = trialNodes[i];
    n.node.setAttribute("aria-checked", i === picked ? "true" : "false");
    n.node.tabIndex = i === picked ? 0 : -1;
    const p = printFor(sigOf(t));
    put(
      n.meta,
      el("span", {}, `補 ${t.extra.length}`),
      el("span", {}, ERA_ZH[t.era] || ""),
      t.missing.length ? el("span", { class: "trial-miss", title: `沒進這張：${t.missing.map(zh).join("、")}` }, `缺 ${t.missing.length}`) : null
    );
    // 牌沒變就不重建：換試印、印製進度都會叫到這裡，不要讓小圖一直重載。
    const show = trialHighlights(t);
    const key = show.join("|");
    if (n.picks.dataset.key !== key) {
      n.picks.dataset.key = key;
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
    }
    paintTrialFace(i, p);
    n.node.setAttribute(
      "aria-label",
      `試印 ${t.letter}：引擎補 ${t.extra.length} 張，${ERA_ZH[t.era] || ""}${t.missing.length ? `，有 ${t.missing.length} 張你的牌沒進去` : ""}${p ? `，${previewState(p)}` : ""}`
    );
  });
}

/** 試印左邊那一格：印過就放成品的小圖，沒印過就是字母。 */
function paintTrialFace(i, p = printFor(sigOf(trials[i]))) {
  const n = trialNodes[i];
  if (!n) return;
  const src = p ? viewSrc(p.image) || p.preview : null;
  n.node.dataset.printed = p ? p.status : "none";
  let img = n.face.querySelector("img");
  if (src) {
    if (!img) n.face.prepend((img = el("img", { alt: "", decoding: "async", draggable: "false" })));
    if (img.getAttribute("src") !== src) img.src = src;
  } else img?.remove();
  n.face.style.setProperty("--p", String(p && p.status === "running" ? p.progress || 0 : 0));
}

function paintTrialFacesFor(sig) {
  trials.forEach((t, i) => {
    if (sigOf(t) === sig) paintTrialFace(i);
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

/* ================= 卡池：六個套版 ================= */

const plateNode = (tag) => $("registers").querySelector(`.plate-card[data-tag="${cssEsc(tag)}"]`);

/* ---------- 卡池跟著視窗大小：牌多大、每列放幾張影子 ----------
 * 寬螢幕上卡池有固定的高度：挑一個最大的牌寬，讓六列剛好一次放進去不用捲（放不下才捲）。
 * 每一列的影子排到那一排放滿就停，放不完的收成「+N」—— 視窗越寬，看得到的影子越多。
 * 窄螢幕整頁往下捲，牌寬只看寬度：一排大約四張。
 * 先用算的（牌的比例、間距都是 CSS 裡的固定值），畫上去之後再量一次，真的溢出就再縮一點。 */

const CARD_AR = 702 / 480;
const GHOST_SCALE = 0.76;
const GAP_X = 10;
const GAP_Y = 12;
const FIT_MIN = 56;
const FIT_MAX = 176;
const wideLayout = typeof matchMedia === "function" ? matchMedia("(min-width: 68.75rem)") : { matches: true };
let poolFit = { w: 0, planW: 0, caps: {}, cardsW: 0, headH: 0 };

function planPool(t, empty) {
  // 空白的版不用算（牌寬交回 CSS 的預設）。也別去量寬度：開機時卡池一定是空的，
  // 這時候一量就逼整頁提早排版一次（字盒幾十張牌還在往裡塞），白白多花一百多毫秒。
  if (empty) return { w: 0, caps: {}, cardsW: 0 };
  const box = $("registers");
  const cs = getComputedStyle(box);
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const wide = wideLayout.matches;
  const cardsW =
    box.querySelector(".reg-cards")?.clientWidth ||
    Math.max(160, box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - (wide ? 5 : 3.2) * rem);
  const rows = REGISTERS.map((suit) => ({
    suit,
    mine: bed.pins.filter((x) => suitOf(x) === suit).length,
    ghosts: t ? t.extra.filter((x) => suitOf(x) === suit).length : 0,
    note: !!rowNotes[suit],
  }));
  const headH = poolFit.headH || 2.2 * rem;
  const padY = 1.35 * rem;
  const noteH = 1.7 * rem;
  const moreW = 3 * rem;
  const splitW = 9;
  const tail = parseFloat(cs.paddingBottom) + (REGISTERS.length - 1);
  const sim = (w, withExpanded) => {
    const gw = w * GHOST_SCALE;
    const h = w * CARD_AR;
    const gh = gw * CARD_AR;
    const caps = {};
    let total = tail;
    for (const r of rows) {
      let x = 0;
      let lines = 0;
      let lineH = 0;
      let height = 0;
      const push = (iw, ih) => {
        if (!lines) {
          lines = 1;
          x = iw;
          lineH = ih;
        } else if (x + GAP_X + iw > cardsW + 0.5) {
          height += lineH + GAP_Y;
          lines++;
          x = iw;
          lineH = ih;
        } else {
          x += GAP_X + iw;
          lineH = Math.max(lineH, ih);
        }
      };
      const room = (iw) => !lines || x + GAP_X + iw <= cardsW + 0.5;
      for (let i = 0; i < r.mine; i++) push(w, h);
      if (r.ghosts) {
        if (r.mine) push(splitW, 0);
        // 至少給一張影子；之後排到這一排放滿為止，還要留位置給「+N」——
        // 硬塞第二張的話，手機上「+N」會自己掉到下一排，白白多佔一整排的高度。
        let cap = 0;
        while (cap < r.ghosts) {
          const more = r.ghosts - cap > 1;
          if (cap >= 1 && !room(gw + (more ? GAP_X + moreW : 0))) break;
          push(gw, gh);
          cap++;
        }
        caps[r.suit] = cap;
        if (cap < r.ghosts) {
          if (withExpanded && expanded.has(r.suit)) for (let i = cap; i < r.ghosts; i++) push(gw, gh);
          push(moreW, 32);
        }
      }
      const content = lines ? height + lineH : 1.3 * rem;
      total += padY + Math.max(headH, content, w * 0.5) + (r.note ? noteH : 0);
    }
    return { caps, total };
  };
  let w;
  if (wide) {
    // 展開的那一列不算進去：點開「+N」不該讓整池的牌一起縮小，那一列多出來的就捲。
    const H = $("plate-scroll").clientHeight;
    w = FIT_MIN;
    for (let c = FIT_MAX; c >= FIT_MIN; c -= 2) {
      if (sim(c, false).total <= H) {
        w = c;
        break;
      }
    }
  } else {
    w = Math.round(Math.max(60, Math.min(96, (cardsW - 3 * GAP_X) / 4)));
  }
  return { w, caps: sim(w, false).caps, cardsW };
}

function applyFit(plan) {
  const box = $("registers");
  box.querySelector(".rel-layer")?.remove();
  poolFit.caps = plan.caps;
  poolFit.planW = plan.w;
  poolFit.cardsW = plan.cardsW;
  let w = plan.w;
  if (!w) {
    box.style.removeProperty("--pool-card");
    poolFit.w = 0;
    return;
  }
  box.style.setProperty("--pool-card", w + "px");
  const head = box.querySelector(".reg-head");
  if (head && head.offsetHeight) poolFit.headH = head.offsetHeight;
  // 算的跟畫出來的對不上（第一次畫、欄寬剛變）：等一下照實際的寬再排一次。
  const real = box.querySelector(".reg-cards")?.clientWidth;
  if (real && Math.abs(real - plan.cardsW) > 2) scheduleFit();
  if (wideLayout.matches && !expanded.size) {
    const sc = $("plate-scroll");
    let guard = 0;
    while (sc.scrollHeight > sc.clientHeight + 1 && w > FIT_MIN && guard++ < 16) {
      w -= 2;
      box.style.setProperty("--pool-card", w + "px");
    }
  }
  poolFit.w = w;
}

const sameCaps = (a, b) => REGISTERS.every((s) => (a[s] ?? -1) === (b[s] ?? -1));

let fitTimer = 0;

function scheduleFit() {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(refitPool, 60);
}

/** 視窗（或卡池那一欄）大小變了：影子張數變了就重排，只是牌寬變了就只改寬度、重畫記號。 */
function refitPool() {
  if (!lib || !trials.length) return;
  const plan = planPool(trials[picked], !bed.pins.length);
  if (!sameCaps(plan.caps, poolFit.caps)) {
    closePop();
    renderPlate([]);
    return;
  }
  if (plan.w === poolFit.planW && Math.abs(plan.cardsW - poolFit.cardsW) <= 2) return;
  closePop();
  applyFit(plan);
  requestRelations([]);
}

function renderPlate(events = []) {
  const box = $("registers");
  const t = trials[picked];
  const empty = !bed.pins.length;
  relFocus = null;
  renderPlateNotice();
  const plan = planPool(t, empty);
  const rows = REGISTERS.map((suit) => {
    const mine = bed.pins.filter((x) => suitOf(x) === suit);
    // 空白的版不列引擎的影子：還沒有東西可以對照，只會讓人以為版上已經有牌。
    const ghosts = !empty && t ? t.extra.filter((x) => suitOf(x) === suit) : [];
    const cap = plan.caps[suit] ?? ghosts.length;
    const open = expanded.has(suit);
    const shown = open ? ghosts : ghosts.slice(0, cap);
    const info = CARD_SUIT_INFO[suit];
    const cards = mine.map((tag) => plateCard(tag));
    // 你的牌跟引擎補的中間隔一條細線：左邊是版上的，右邊是這一張試印的影子。
    if (mine.length && shown.length) cards.push(el("span", { class: "reg-split", "aria-hidden": "true" }));
    cards.push(...shown.map((tag) => ghostCard(tag, t)));
    if (ghosts.length > cap) {
      cards.push(
        el(
          "button",
          {
            class: "ghost-more",
            type: "button",
            "aria-expanded": open ? "true" : "false",
            title: open ? undefined : ghosts.slice(cap).map(zh).join("、"),
            "aria-label": open ? `收起${REGISTER_ROLE[suit]}的影子` : `再看 ${ghosts.length - cap} 張引擎補的${REGISTER_ROLE[suit]}`,
            onclick: () => {
              if (open) expanded.delete(suit);
              else expanded.add(suit);
              renderPlate([]);
              box.querySelector(`.register[data-suit="${suit}"] .ghost-more`)?.focus({ preventScroll: true });
            },
          },
          open ? "收起" : `+${ghosts.length - cap}`
        )
      );
    }
    const note = rowNotes[suit];
    return el(
      "section",
      {
        class: "register",
        dataset: { suit, filled: mine.length ? "true" : "false" },
        "aria-label": `${REGISTER_ROLE[suit]}（${info.zh}）：你的 ${mine.length} 張${ghosts.length ? `，引擎補 ${ghosts.length} 張` : ""}`,
      },
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
        cards.length ? cards : el("span", { class: "reg-empty" }, suit === "style" ? "不罩色" : empty ? "空著：引擎會補" : "空著")
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
  put(box, empty ? startBlock() : null, rows);
  box.dataset.empty = empty ? "true" : "false";
  $("plate-sub").textContent = empty
    ? "還沒有牌"
    : t
      ? `試印 ${t.letter}：你的 ${bed.pins.length} 張，引擎補 ${t.extra.length} 張`
      : `你的 ${bed.pins.length} 張`;
  $("clear").disabled = empty;
  applyFit(plan);
  renderPill();
  requestRelations(events);
}

function startBlock() {
  const starters = STARTERS.filter((s) => s.tags.every((t) => lib.byTag.has(t) && rankOk(cardOf(t)) && !bans.has(t))).slice(0, 3);
  return el(
    "div",
    { class: "pool-start" },
    el("p", { class: "pool-start-lead" }, "空白的版"),
    el(
      "p",
      { class: "pool-start-body" },
      "從字盒挑牌放進來：點一下，或拖進這一區。牌照花色落進自己那一列；右邊四張試印跟著重抽，引擎替你補的牌會以灰色的影子排在同一列。"
    ),
    starters.length
      ? el(
          "div",
          { class: "starters" },
          el("span", { class: "starters-label" }, "或者從這裡起手"),
          starters.map((s) =>
            el(
              "button",
              { class: "starter", type: "button", onclick: () => startWith(s) },
              el(
                "span",
                { class: "starter-arts", "aria-hidden": "true" },
                s.tags.slice(0, 3).map((tg) => (assets.art(tg) ? applyArtSources(el("img", { alt: "" }), assets.sources(tg)) : null))
              ),
              el("span", { class: "starter-name" }, s.name),
              el("span", { class: "starter-tags" }, s.tags.map(zh).join("・"))
            )
          )
        )
      : null
  );
}

/** 牌落進哪一列，那一列就暈開一下它花色的墨。 */
function inkRow(suit) {
  if (!suit || reduced()) return;
  const row = $("registers").querySelector(`.register[data-suit="${suit}"]`);
  if (!row) return;
  row.classList.remove("is-inked");
  void row.offsetWidth;
  row.classList.add("is-inked");
  setTimeout(() => row.classList.remove("is-inked"), 900);
}

/** 換一張試印：影子那幾張換成那一張補的，淡入一下讓人看得出換了。 */
function swapGhosts() {
  if (reduced()) return;
  const box = $("registers");
  box.classList.remove("ghosts-in");
  void box.offsetWidth;
  box.classList.add("ghosts-in");
  setTimeout(() => box.classList.remove("ghosts-in"), 420);
}

/** 牌底下四個小點：四張試印各一個，這張牌有進那一張就上墨。 */
function inkDots(tag) {
  return el(
    "span",
    { class: "ink", "aria-hidden": "true" },
    trials.map((tr, i) => el("i", { dataset: { on: tr.mine.includes(tag) ? "1" : "0", pick: i === picked ? "1" : "0" } }))
  );
}

function plateCard(tag) {
  const card = cardOf(tag);
  const node = cardNode(card, assets, { src: bed.carried[tag] ? "附帶" : null });
  const take = takeOf(tag);
  node.classList.add("plate-card");
  node.dataset.ink = take === trials.length ? "full" : take === 0 ? "none" : "part";
  node.append(inkDots(tag));
  const why = take < trials.length ? `，${take}/${trials.length} 張試印有它：${missReason(tag)}` : "";
  node.setAttribute("aria-label", `${card.zh}（${card.tag}）${bed.carried[tag] ? `・跟著「${zh(bed.carried[tag])}」上來` : ""}${why}。Enter 看選項，Delete 拿掉`);
  node.addEventListener("click", () => openPop(node, tag, "plate"));
  node.addEventListener("keydown", (e) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      focusAfterRemoval(node);
      remove(tag);
    }
  });
  drag.attach(node, { tag, from: "plate" });
  return node;
}

function ghostCard(tag, t) {
  const card = cardOf(tag);
  const node = cardNode(card, assets, {});
  node.classList.add("ghost-card");
  node.setAttribute("aria-label", `${card.zh}（${card.tag}）：引擎在試印 ${t.letter} 補的。Enter 看選項，可以收下`);
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

/** 卡池裡用方向鍵走：左右是同一列的下一張，上下跳到隔壁那一列。 */
function poolKeys(e) {
  const box = $("registers");
  const cards = [...box.querySelectorAll(".card")];
  const i = cards.indexOf(document.activeElement);
  if (i < 0) return;
  let j = -1;
  if (e.key === "ArrowRight") j = i + 1;
  else if (e.key === "ArrowLeft") j = i - 1;
  else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const regs = [...box.querySelectorAll(".register")];
    const d = e.key === "ArrowDown" ? 1 : -1;
    for (let k = regs.indexOf(cards[i].closest(".register")) + d; k >= 0 && k < regs.length; k += d) {
      const c = regs[k].querySelector(".card");
      if (c) {
        j = cards.indexOf(c);
        break;
      }
    }
  } else return;
  e.preventDefault();
  if (j >= 0 && j < cards.length) cards[j].focus();
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
let relFocus = null;

function requestRelations(events) {
  clearTimeout(relTimer);
  relTimer = setTimeout(() => drawRelations(events), 16);
}

const REL_ZH = { carry: "附帶", echo: "呼應", clash: "相剋" };

function drawRelations(events = []) {
  const box = $("registers");
  box.querySelector(".rel-layer")?.remove();
  relFocus = null;
  box.dataset.relFocus = "false";
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
  const drawIn = [];
  // 跨列的線像校對稿上的引線：從牌的上緣出發，沿著牌上面那條空隙走到右邊的留白
  // （卡池右邊特意空了一條），沿留白下到另一列，再從那一列的空隙回到另一張牌。一張牌都不壓。
  const gutter = box.clientWidth - 26;
  const R = 6;
  rels.forEach((r, k) => {
    const na = plateNode(r.a);
    const nb = plateNode(r.b);
    if (!na || !nb) return;
    const ra = na.getBoundingClientRect();
    const rb = nb.getBoundingClientRect();
    const ax = ra.left + ra.width / 2 - base.left;
    const bx = rb.left + rb.width / 2 - base.left;
    const aTop = ra.top - base.top;
    const bTop = rb.top - base.top;
    let d;
    let mid;
    if (Math.abs(aTop - bTop) < 12) {
      // 同一列、同一排的兩張：在牌的上緣拱一道小弧。
      const y = aTop + 2;
      const cx = (ax + bx) / 2;
      d = `M${ax},${y} Q${cx},${y - 16} ${bx},${y}`;
      mid = { x: cx, y: y - 8 };
    } else {
      // 幾條線同時走時錯開一點，不要疊成一條。
      const off = (k % 3) * 3;
      const ay = aTop - 6 - off;
      const by = bTop - 6 - off;
      const gx = Math.max(gutter - (k % 4) * 5, ax + 2 * R, bx + 2 * R);
      const dir = by > ay ? 1 : -1;
      d =
        `M${ax},${aTop} L${ax},${ay + R} Q${ax},${ay} ${ax + R},${ay} L${gx - R},${ay} Q${gx},${ay} ${gx},${ay + dir * R} ` +
        `L${gx},${by - dir * R} Q${gx},${by} ${gx - R},${by} L${bx + R},${by} Q${bx},${by} ${bx},${by + R} L${bx},${bTop}`;
      mid = { x: gx, y: (ay + by) / 2 };
    }
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("class", "rel rel-" + r.kind);
    path.dataset.a = r.a;
    path.dataset.b = r.b;
    const isFresh = fresh.includes(r);
    if (isFresh && !reduced()) drawIn.push(path);
    svg.append(path);
    labels.push(el("span", { class: "rel-tag", dataset: { kind: r.kind, a: r.a, b: r.b }, style: `left:${mid.x}px;top:${mid.y}px` }, REL_ZH[r.kind]));
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
  });
  layer.append(...labels);
  box.append(layer);
  // 新出現的線一筆畫出來；畫完把虛線樣式還給 CSS（附帶、相剋本來就是虛線）。
  for (const path of drawIn) {
    const len = Math.ceil(path.getTotalLength());
    path.style.strokeDasharray = String(len);
    path.style.strokeDashoffset = String(len);
    path.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 600, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" });
    setTimeout(() => {
      path.getAnimations().forEach((a) => a.cancel());
      path.style.strokeDasharray = "";
      path.style.strokeDashoffset = "";
    }, 640);
  }
}

/** 指著（或 Tab 到）一張牌：它的關係線亮起來，其他的淡下去，另一端那張也描一圈。 */
function setRelFocus(tag) {
  if (tag === relFocus) return;
  relFocus = tag;
  const box = $("registers");
  const partners = new Set();
  for (const n of box.querySelectorAll(".rel-layer [data-a]")) {
    const on = !!tag && (n.dataset.a === tag || n.dataset.b === tag);
    n.classList.toggle("is-lit", on);
    if (on) partners.add(n.dataset.a === tag ? n.dataset.b : n.dataset.a);
  }
  box.dataset.relFocus = partners.size ? "true" : "false";
  for (const c of box.querySelectorAll(".plate-card")) c.classList.toggle("is-partner", partners.has(c.dataset.tag));
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
  // 卡池在中間：選單開在牌的右邊，右邊放不下才開左邊。
  let left = r.right + 10;
  if (left + w > window.innerWidth - 8) left = r.left - w - 10;
  left = Math.min(window.innerWidth - w - 8, left);
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
    // 手機上卡池捲出畫面了：牌飛進角落那顆「卡池」，看得到它確實放進去了。
    const pill = $("pool-pill");
    if (from && !visible && !pill.hidden && !reduced()) flyToPill(target, from, pill);
    else stamp(target);
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
      inkRing(n);
    }
  }, 430);
}

function flyToPill(target, from, pill) {
  const to = pill.getBoundingClientRect();
  const clone = target.cloneNode(true);
  clone.classList.add("flying");
  Object.assign(clone.style, { left: from.left + "px", top: from.top + "px", width: from.width + "px" });
  clone.style.setProperty("--card-w", from.width + "px");
  document.body.append(clone);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  clone.animate(
    [
      { transform: "none", opacity: 1 },
      { transform: `translate(${dx * 0.3}px, ${dy * 0.3 - 30}px) scale(0.8) rotate(-5deg)`, opacity: 1, offset: 0.4 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.22)`, opacity: 0.3 },
    ],
    { duration: 460, easing: "cubic-bezier(0.45, 0, 0.7, 1)", fill: "forwards" }
  );
  setTimeout(() => {
    clone.remove();
    stamp(pill, "is-bumped");
  }, 470);
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
    `引擎補 ${t.extra.length} 張`,
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
          dataset: { wide: [...label].length <= 2 ? "true" : "false", busy: busy ? "true" : "false" },
          style: busy ? `--p: ${p.status === "running" ? p.progress || 0 : 0}` : undefined,
          onclick: () => (p && p.status === "failed" ? reprint(p) : printNow()),
          title: "付印（P）",
        },
        label
      ),
      busy ? el("button", { class: "btn", type: "button", onclick: stopPrinting }, "停") : null
    ),
    seedNode || (seedNode = mountSeedControl(null, { compact: true })),
    offline
      ? el("p", { class: "pb-hint" }, linkNow === "net" ? "連不到主機（網路斷了？）。可以繼續疊版、挑試印，接上了再付印。" : "印刷機（ComfyUI）沒開。可以繼續疊版、挑試印，開了再付印。")
      : null,
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
  S.handOffPool(bed.pins);
  const b = $("print-bar").querySelector(".pb-links button:last-child");
  if (b) b.textContent = "放好了：回墨池工作臺就看得到";
  announce("這一版的牌放進墨池的合成池了");
}

/* ================= 晾紙繩 ================= */

let lineSeen = null;

function renderLine() {
  const list = $("line-list");
  const items = prints.map((p) => el("li", {}, lineItem(p)));
  list.replaceChildren(...items);
  // 新夾上去的那張：往下一落、左右晃幾下才停，像紙剛夾上繩子。開機那一次不晃。
  if (lineSeen && !reduced()) {
    items.forEach((li, i) => {
      if (!lineSeen.has(prints[i].id)) li.firstChild.classList.add("is-hung");
    });
  }
  lineSeen = new Set(prints.map((p) => p.id));
  $("line-empty").hidden = prints.length > 0;
  // 等這一輪的畫面都放好再量（量捲動寬度會逼瀏覽器當場排版；開機時字盒還在長）。
  clearTimeout(lineFadeTimer);
  lineFadeTimer = setTimeout(syncLineFade, 0);
}

let lineFadeTimer = 0;

/** 捲軸平常是隱形的：哪一邊還捲得過去，繩子那一頭就淡出，看得出後面還有作品。 */
function syncLineFade() {
  const list = $("line-list");
  const max = list.scrollWidth - list.clientWidth;
  const more = [];
  if (list.scrollLeft > 2) more.push("left");
  if (list.scrollLeft < max - 2) more.push("right");
  list.dataset.more = more.join(" ");
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
  // 剛印好：紙抖一下（每張只抖一次）。
  if (p.status === "done" && node.dataset.status && node.dataset.status !== "done" && !reduced()) {
    node.classList.remove("is-hung", "is-dried");
    void node.offsetWidth;
    node.classList.add("is-dried");
  }
  node.dataset.status = p.status;
  const face = node.querySelector(".print-face");
  const src = viewSrc(p.image) || p.preview;
  const img = face.querySelector("img");
  if (src) {
    // loading 要排在 src 前面：先設 src 的話圖已經開始下載，lazy 就沒用了。
    // 繩子捲不到的作品等捲過去才下載。
    if (!img) face.replaceChildren(el("img", { loading: "lazy", src, alt: "", decoding: "async", draggable: "false" }));
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

/* 晾紙繩上的作品只有指甲大：滑鼠停在上面，底下浮出一張大一點的（點下去照舊打開大圖）。 */
let linePeek = null;
let linePeekTimer = 0;

function showLinePeek(node) {
  const p = prints.find((x) => x.id === node.dataset.id);
  const src = p && (viewSrc(p.image) || p.preview);
  if (!src || !node.isConnected) return hideLinePeek();
  if (!linePeek) {
    linePeek = el("div", { class: "print-peek", "aria-hidden": "true", hidden: true }, el("img", { alt: "", decoding: "async" }), el("p", { class: "print-peek-cap" }));
    document.body.append(linePeek);
  }
  const img = linePeek.querySelector("img");
  if (img.getAttribute("src") !== src) img.src = src;
  img.style.aspectRatio = `${p.width} / ${p.height}`;
  linePeek.querySelector(".print-peek-cap").textContent = [`試印 ${p.letter || ""}`, STATUS_ZH[p.status] || "", `seed ${p.seed}`].filter(Boolean).join("・");
  const wasHidden = linePeek.hidden;
  linePeek.hidden = false;
  const r = node.getBoundingClientRect();
  const w = linePeek.offsetWidth;
  const h = linePeek.offsetHeight;
  linePeek.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
  linePeek.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, r.bottom + 10)) + "px";
  if (wasHidden && !reduced()) {
    linePeek.classList.remove("is-in");
    void linePeek.offsetWidth;
    linePeek.classList.add("is-in");
  }
}

function hideLinePeek() {
  clearTimeout(linePeekTimer);
  if (linePeek) linePeek.hidden = true;
}

function openPrint(p) {
  hideLinePeek();
  const src = viewSrc(p.image) || p.preview;
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
            caseGroup = "";
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

/** 選了某一種花色時，下面多一排小分類（鏡頭、表情、視線…），前面是牌面上那個一字章。 */
function renderCaseGroups(inSuit) {
  const box = $("case-groups");
  const suitTab = CARD_SUITS.includes(caseTab);
  const groups = suitTab ? [...new Map(inSuit.map((c) => [c.group, [c.groupZh, c.seal]])).entries()] : [];
  if (caseGroup && !groups.some(([g]) => g === caseGroup)) caseGroup = "";
  box.hidden = groups.length < 2;
  if (box.hidden) return box.replaceChildren();
  const chip = (g, label, seal) =>
    el(
      "button",
      {
        class: "group-chip",
        type: "button",
        "aria-pressed": caseGroup === g ? "true" : "false",
        onclick: () => {
          caseGroup = g;
          renderCase();
        },
      },
      seal ? el("b", { class: "chip-seal", "aria-hidden": "true" }, seal) : null,
      label
    );
  box.replaceChildren(chip("", "全部", null), ...groups.map(([g, [zh, seal]]) => chip(g, zh, seal)));
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
  renderCaseGroups(list);
  if (caseGroup) list = list.filter((c) => c.group === caseGroup);
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
    seal: card.seal,
    sealTitle: card.groupZh,
    suitColor: getComputedStyle(document.documentElement).getPropertyValue(`--suit-${card.suit}`).trim(),
    art: assets.art(card.tag),
    rating: card.rating,
    facts,
  };
}

/* ================= 拖曳 ================= */

const caseCard = (tag) => $("case-grid").querySelector(`.card[data-tag="${cssEsc(tag)}"]`);
let dropRow = null;

const drag = createDrag({
  zones: () => [
    { id: "plate", el: $("plate"), accepts: (p) => p.from !== "plate" },
    // 手機上卡池捲走了，角落那顆「卡池」也收牌：影子縮小被吸進去。
    { id: "pill", el: $("pool-pill"), accepts: (p) => p.from === "case" && !$("pool-pill").hidden, sink: true },
    { id: "case", el: $("case"), accepts: (p) => p.from === "plate" },
  ],
  // 拖著經過卡池：它會落到的那一列先亮起來。
  onOver: (zone, p) => {
    dropRow?.classList.remove("is-drop-target");
    dropRow = null;
    if (zone !== "plate") return;
    dropRow = $("registers").querySelector(`.register[data-suit="${suitOf(p.tag)}"]`);
    dropRow?.classList.add("is-drop-target");
  },
  onDrop: (p, zone) => {
    if (zone === "case") {
      remove(p.tag, { viaDrag: true });
      return caseCard(p.tag);
    }
    const r = place(p.tag, null, { viaDrag: true });
    if (zone === "pill") {
      return {
        landed: () => {
          r?.landed();
          stamp($("pool-pill"), "is-bumped");
        },
      };
    }
    return { el: plateNode(p.tag), landed: r?.landed };
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

function pingLoop() {
  watchLink((st) => {
    const ok = st === "ok";
    const changed = ok !== comfyOk;
    comfyOk = ok;
    linkNow = st;
    const p = $("ping");
    p.dataset.ok = ok ? "1" : "0";
    p.querySelector("span").textContent = LINK_LABEL[st];
    if (changed && trials.length) renderPrintBar();
  });
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
  // 晾紙繩只會橫著捲：滑鼠滾輪上下滾也讓它左右走（滑鼠大多只有直向滾輪）。捲到頭就把滾輪還給頁面。
  const line = $("line-list");
  line.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const max = line.scrollWidth - line.clientWidth;
      if (max <= 0) return;
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const next = Math.max(0, Math.min(max, line.scrollLeft + dy));
      if (next === line.scrollLeft) return;
      e.preventDefault();
      line.scrollLeft = next;
    },
    { passive: false }
  );
  line.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const n = e.target.closest ? e.target.closest(".print") : null;
    if (!n) return;
    clearTimeout(linePeekTimer);
    // 第一張等一下再出來（滑鼠只是路過就不跳）；已經開著時換到隔壁那張就直接換。
    linePeekTimer = setTimeout(() => showLinePeek(n), linePeek && !linePeek.hidden ? 0 : 160);
  });
  line.addEventListener("pointerleave", hideLinePeek);
  line.addEventListener("pointerdown", hideLinePeek);
  line.addEventListener(
    "scroll",
    () => {
      hideLinePeek();
      syncLineFade();
    },
    { passive: true }
  );
  $("pool-pill").addEventListener("click", () => $("plate").scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" }));
  const regs = $("registers");
  const relTarget = (e) => (e.target.closest ? e.target.closest(".plate-card")?.dataset.tag || null : null);
  regs.addEventListener("pointerover", (e) => setRelFocus(relTarget(e)));
  regs.addEventListener("pointerleave", () => setRelFocus(null));
  regs.addEventListener("focusin", (e) => setRelFocus(relTarget(e)));
  regs.addEventListener("focusout", () => setRelFocus(null));
  regs.addEventListener("keydown", poolKeys);
  // 卡池那一欄大小一變（拉視窗、上面多一行提示、晾紙繩多了第一張），牌就重新配一次大小。
  if (typeof ResizeObserver === "function") new ResizeObserver(scheduleFit).observe($("plate-scroll"));
  wideLayout.addEventListener?.("change", scheduleFit);
  document.addEventListener("pointerdown", (e) => (lastPointer = e.pointerType || "mouse"), true);
  document.addEventListener("keydown", onKey);
  let rTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(rTimer);
    rTimer = setTimeout(() => {
      closePop();
      drawRelations([]);
      syncLineFade();
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

/* ================= 手機：卡池捲出畫面時，角落留一顆「卡池」 ================= */

function renderPill() {
  const pill = $("pool-pill");
  put(
    pill,
    el(
      "span",
      { class: "pill-arts", "aria-hidden": "true" },
      bed.pins.slice(-3).map((tg) =>
        assets.art(tg)
          ? applyArtSources(el("img", { alt: "", decoding: "async" }), assets.sources(tg))
          : el("b", { style: `--suit: var(--suit-${suitOf(tg)})` }, [...zh(tg)][0])
      )
    ),
    el("span", { class: "pill-label" }, "卡池"),
    el("b", { class: "pill-count" }, String(bed.pins.length))
  );
  pill.setAttribute("aria-label", `回到卡池（${bed.pins.length} 張）`);
}

function watchPoolPill() {
  const pill = $("pool-pill");
  if (typeof IntersectionObserver !== "function") return;
  const narrow = matchMedia("(max-width: 68.74rem)");
  let poolVisible = true;
  const sync = () => {
    pill.hidden = !(narrow.matches && !poolVisible);
  };
  new IntersectionObserver((entries) => {
    poolVisible = entries.some((e) => e.isIntersecting);
    sync();
  }, { threshold: 0.04 }).observe($("plate"));
  narrow.addEventListener("change", sync);
}

boot();
