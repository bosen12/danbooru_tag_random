/**
 * 墨池：排字匣的卡牌版。
 *
 * 字盒裡每個字是一張牌。拖進合成池 = 釘選；拖進廢字簍 = 封鎖。
 * 按「抽並生圖」，引擎用同一套抽牌邏輯（engine.js 的 drawOne，跟原版、暗房、中控室共用）
 * 把合成池以外的格子補齊，送 ComfyUI。每張成品底下攤開這張用了哪些牌：
 * 你放進池子的、引擎抽到的（附帶、時代錨、補位也標出來），都可以再拖回池子或丟進簍子。
 *
 * 這裡不寫任何抽牌規則。釘選、封鎖、互斥換位全部呼叫 engine 的 applyPin / applyBan。
 */
import {
  indexLexicon,
  sanitizeSettings,
  applyPin,
  applyBan,
  identityPins,
  identityBans,
  insertTriggerAfterCast,
  randomSeed,
  ERAS,
  ERA_LABELS,
} from "./engine.js";
import { drawWithSeed } from "./draw-with-seed.js";
import { ratingBlocked, RATING_LABEL } from "./rules/rating.js";
import { HEATS, toggleHeat } from "./heats.js";
import { SCENE_MODES, SCENE_MODE_LABELS, heatBlockedByRating } from "./scene-policy.js";
import { initLoraPicker, currentLorasPayload, currentTriggerText, currentCkpt, handleLoraKeys } from "./lora.js";
import { initWorkflow, currentWorkflowId, wfHandleKeys } from "./workflow.js";
import { HARD_BANNED, applyArtSources } from "./card-art.js";
import { buildLibrary, createAssets, cardNode, setCardFlag, cardFacts, CARD_SUIT_INFO, CARD_SUITS, RATING_ZH } from "./cards.js";
import { el, openSheet, anyOverlay, toast, ICONS } from "./ui.js";
import { createDrag, inkRing } from "./drag.js";
import { createGenerator, comfyOnline, viewSrc, tabTitle } from "./gen.js";
import { genSeed, mountSeedControl, seedUseButton } from "./seed-control.js";
import { attachPeek } from "./card-peek.js";
import * as S from "./store.js";

const HEAT_ZH = { activity: "活動", tease: "誘惑", flash: "走光", sex: "性愛" };
const SIZES = [
  { id: "square", zh: "方 1024²", w: 1024, h: 1024 },
  { id: "portrait", zh: "直 832×1216", w: 832, h: 1216 },
  { id: "landscape", zh: "橫 1216×832", w: 1216, h: 832 },
];
const SRC_ZH = { implies: "附帶", bind: "附帶", era_anchor: "時代", repair: "補位", must_draw: "必抽", preset: "組合", fixed: "固定" };
const SECTION_ORDER = ["subject", "feature", "clothing", "pose", "env", "style", "quality"];

let data = null;
let lex = null;
let lib = null;
let assets = null;
let settings = null;
let pool = new Set();
let bans = new Set();
let shots = [];
let infinite = false;
let stopAsked = false;
// 無限抽印完一輪、還沒排下一輪的那一小段空檔：照樣算「在忙」，「停」不能在這時候閃掉。
let looping = false;
const ui = { suit: "all", group: "", query: "", eraOnly: true, collapsed: false, ...S.loadUi() };
const $ = (id) => document.getElementById(id);

/* ================= 開機 ================= */

async function boot() {
  try {
    const [lexicon, manifest] = await Promise.all([
      fetch("lexicon.json").then((r) => r.json()),
      fetch("cards/manifest.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    data = lexicon;
    lex = indexLexicon(data);
    lib = buildLibrary(data, { ratingBlocked });
    assets = createAssets(manifest);
  } catch (err) {
    $("work").replaceChildren(el("p", { class: "pool-empty" }, "讀不到詞庫。請用 start-web6.bat 開，而不是直接點 HTML。", el("br"), String(err)));
    return;
  }

  const stored = S.loadSettings();
  settings = sanitizeSettings(stored || { rating: "general" }, data);
  // 池子不存：重新整理就是空的；只收疊印台剛交過來的那一版。
  pool = new Set(S.takePool().filter((t) => lib.byTag.has(t)));
  bans = new Set(S.loadBans().filter((t) => lib.byTag.has(t)));
  shots = S.loadShots();
  // 上次畫到一半就重新整理（或關掉分頁）的那張：伺服器還留著一陣子，接回去。
  const resumable = shots.filter((s) => s.live && s.job);
  for (const s of resumable) s.status = "queued";

  initLoraPicker();
  initWorkflow();
  pingLoop();

  renderRating();
  renderLibraryChrome();
  renderLibrary();
  renderPool();
  renderRules();
  renderGoBar();
  renderWall();
  renderTrash();
  for (const s of resumable) generator.resume(s);
  for (const root of [$("lib-grid"), $("pool-well"), $("wall")]) attachPeek(root, ".card[data-tag]", peekInfo);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", () => {
    for (const node of document.querySelectorAll(".shot")) layoutFans(node);
  });
}

function saveSettings() {
  S.saveSettings(settings);
}

function setSettings(patch) {
  settings = sanitizeSettings({ ...settings, ...patch }, data);
  saveSettings();
}

function saveUi() {
  S.saveUi({ suit: ui.suit, group: ui.group, eraOnly: ui.eraOnly, collapsed: ui.collapsed });
}

/* ================= 分級與 Comfy ================= */

function renderRating() {
  const box = $("rating");
  box.replaceChildren(
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
            renderLibrary();
            renderPool();
            renderRules();
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
  p.dataset.ok = ok ? "1" : "0";
  p.querySelector("span").textContent = ok ? "Comfy 已連" : "Comfy 未連";
  setTimeout(pingLoop, ok ? 15000 : 6000);
}

/* ================= 字盒 ================= */

function renderLibraryChrome() {
  const tabs = $("suit-tabs");
  tabs.replaceChildren(
    el("button", { class: "suit-tab", type: "button", "aria-pressed": ui.suit === "all" ? "true" : "false", onclick: () => pickSuit("all") }, "全部"),
    ...CARD_SUITS.map((s) =>
      el(
        "button",
        { class: "suit-tab", type: "button", style: `--suit: var(--suit-${s})`, "aria-pressed": ui.suit === s ? "true" : "false", onclick: () => pickSuit(s) },
        el("b", { "aria-hidden": "true" }, CARD_SUIT_INFO[s].glyph),
        CARD_SUIT_INFO[s].zh
      )
    )
  );
  const q = $("lib-q");
  q.value = ui.query;
  q.oninput = () => {
    ui.query = q.value.trim();
    renderLibrary();
  };
  $("lib-toggle").onclick = () => {
    ui.collapsed = !ui.collapsed;
    saveUi();
    syncCollapse();
  };
  syncCollapse();
}

function syncCollapse() {
  $("library").dataset.collapsed = ui.collapsed ? "true" : "false";
  $("lib-toggle").textContent = ui.collapsed ? "打開字盒" : "收起字盒";
  $("lib-toggle").setAttribute("aria-expanded", ui.collapsed ? "false" : "true");
}

function pickSuit(s) {
  ui.suit = s;
  ui.group = "";
  saveUi();
  renderLibraryChrome();
  renderLibrary();
}

/** 字盒裡看不看得到：分級擋掉的、性別不合的、（只看這時代時）時代不合的收起來。釘選的字永遠看得到。 */
function visible(card) {
  if (pool.has(card.tag)) return true;
  if (ratingBlocked(card.item, settings.rating)) return false;
  if (card.gate === "male" && !settings.boy) return false;
  if (card.gate === "female" && !settings.girl) return false;
  if (ui.eraOnly && settings.eras.length === 1) {
    const e = settings.eras[0];
    if (!card.eras.includes("any") && !card.eras.includes(e)) return false;
  }
  return true;
}

function renderLibrary() {
  const q = ui.query.toLowerCase();
  const inSuit = lib.cards.filter((c) => (ui.suit === "all" || c.suit === ui.suit) && visible(c));
  // 小分類晶片：只在選了某一種花色時出現
  const chips = $("group-chips");
  if (ui.suit === "all") {
    chips.hidden = true;
  } else {
    const groups = [...new Map(inSuit.map((c) => [c.group, [c.groupZh, c.seal]])).entries()];
    chips.hidden = groups.length < 2;
    chips.replaceChildren(
      el("button", { class: "group-chip", type: "button", "aria-pressed": ui.group === "" ? "true" : "false", onclick: () => pickGroup("") }, "全部"),
      ...groups.map(([g, [zh, seal]]) =>
        el(
          "button",
          { class: "group-chip", type: "button", "aria-pressed": ui.group === g ? "true" : "false", onclick: () => pickGroup(g) },
          seal ? el("b", { class: "chip-seal", "aria-hidden": "true" }, seal) : null,
          zh
        )
      )
    );
  }
  const list = inSuit.filter((c) => (!ui.group || c.group === ui.group) && (!q || c.zh.toLowerCase().includes(q) || c.tag.includes(q)));
  $("lib-count").textContent = `${list.length} / ${lib.cards.length}`;
  const grid = $("lib-grid");
  if (!list.length) {
    grid.replaceChildren(el("p", { class: "lib-empty" }, q ? `字盒裡沒有「${ui.query}」。可能被分級、性別或時代收起來了。` : "這一格沒有字。"));
    return;
  }
  libList = list;
  libShown = 0;
  grid.replaceChildren();
  moreLibrary(LIB_FIRST);
}

// 字盒一次畫 821 張牌（每張六七個節點＋一張圖）載入時會卡住主執行緒約 270ms，
// 而一開始看得到的只有二三十張。先畫一個畫面的份量，捲到快見底再接下一批。
const LIB_FIRST = 48;
const LIB_PAGE = 96;
let libList = [];
let libShown = 0;
let libObserver = null;

function moreLibrary(n = LIB_PAGE) {
  const grid = $("lib-grid");
  grid.querySelector(".lib-more")?.remove();
  const slice = libList.slice(libShown, libShown + n);
  libShown += slice.length;
  grid.append(...slice.map((c) => libCard(c)));
  if (libShown >= libList.length) return;
  const more = el("span", { class: "lib-more", "aria-hidden": "true" });
  grid.append(more);
  if (!libObserver) {
    libObserver = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) moreLibrary();
    }, { rootMargin: "600px 0px" });
  }
  libObserver.disconnect();
  libObserver.observe(more);
}

function pickGroup(g) {
  ui.group = g;
  saveUi();
  renderLibrary();
}

function libCard(card) {
  const node = cardNode(card, assets);
  paintState(node, card.tag);
  node.addEventListener("click", () => {
    if (pool.has(card.tag)) unpin(card.tag);
    else if (bans.has(card.tag)) showCard(card.tag, "library");
    else {
      const from = node.getBoundingClientRect();
      pin(card.tag);
      flyInto(card.tag, from);
    }
  });
  node.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showCard(card.tag, "library");
  });
  node.addEventListener("keydown", (e) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      ban(card.tag);
    }
  });
  drag.attach(node, () => ({ tag: card.tag, from: pool.has(card.tag) ? "pool" : "library" }));
  return node;
}

/** 字盒裡點一下：那張牌從原地飛進合成池。 */
function flyInto(tag, from) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const target = [...$("pool-well").querySelectorAll(".card")].find((n) => n.dataset.tag === tag);
  if (!target) return;
  target.classList.remove("dropped");
  const to = target.getBoundingClientRect();
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const s = from.width / Math.max(1, to.width);
  target.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(-6deg)`, opacity: 0.6 },
      { transform: "translate(0, 0) scale(1.06) rotate(1deg)", opacity: 1, offset: 0.75 },
      { transform: "none", opacity: 1 },
    ],
    { duration: 420, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
  );
  // 落定的那一刻散一圈墨（跟拖曳放下同一個效果）。
  setTimeout(() => inkRing(target), 330);
}

/** 浮空放大卡要的資料。 */
function peekInfo(node) {
  const card = lib.byTag.get(node.dataset.tag);
  if (!card) return null;
  const facts = cardFacts(card, lex, data).filter(([k]) => k !== "分級");
  if (pool.has(card.tag)) facts.unshift(["狀態", "在合成池裡：每張圖都會有"]);
  else if (bans.has(card.tag)) facts.unshift(["狀態", "在廢字簍裡：不會抽到"]);
  return {
    zh: card.zh,
    tag: card.tag,
    glyph: CARD_SUIT_INFO[card.suit].glyph,
    seal: card.seal,
    sealTitle: card.groupZh,
    suitColor: `var(--suit-${card.suit})`,
    art: assets.art(card.tag),
    rating: card.rating,
    facts: facts.slice(0, 5),
  };
}

function paintState(node, tag) {
  if (pool.has(tag)) {
    node.dataset.state = "pinned";
    setCardFlag(node, { kind: "pool", text: "池中" });
  } else if (bans.has(tag)) {
    node.dataset.state = "banned";
    setCardFlag(node, { kind: "ban", text: "封鎖" });
  } else {
    node.dataset.state = "";
    setCardFlag(node, null);
  }
}

function repaintLibrary() {
  for (const node of $("lib-grid").querySelectorAll(".card")) paintState(node, node.dataset.tag);
}


/* ================= 釘選與封鎖（全部走 engine） ================= */

function pin(tag) {
  if (HARD_BANNED.includes(tag)) return;
  const before = new Set(pool);
  const next = applyPin(lex, pool, bans, tag);
  pool = next.pinned;
  bans = next.userBanned;
  const gone = [...before].filter((t) => !pool.has(t));
  // 被擠掉的牌要看得到它離開：先記下它在池裡的位置，重畫之後在原地讓它掀起來飄走。
  const leaving = gone.map(poolNode).filter(Boolean).map((n) => ({ node: n, rect: n.getBoundingClientRect() }));
  // 後果寫在池子底下，不是右下角的提示：發生在哪裡就說在哪裡，旁邊給「換回」。
  poolNote = gone.length ? replaceNote(tag, gone) : null;
  commitPins(tag);
  leaving.forEach(liftOut);
  if (gone.length) announce(poolNote.text);
}

/** 換下來的原因：同一格（互斥）還是時代對不上。 */
function replaceNote(tag, gone) {
  const item = lex.byTag.get(tag);
  const eraOf = (it) => (it?.era || []).filter((e) => e !== "any");
  const clash = (o) => {
    const a = eraOf(item);
    const b = eraOf(lex.byTag.get(o));
    return a.length && b.length && !a.some((e) => b.includes(e));
  };
  const era = gone.filter(clash);
  const slot = gone.filter((o) => !clash(o));
  const bits = [];
  if (slot.length) bits.push(`同一格只留一張：${slot.map((t) => `「${zh(t)}」`).join("")}換成「${zh(tag)}」`);
  if (era.length) bits.push(`${era.map((t) => `「${zh(t)}」`).join("")}跟「${zh(tag)}」不是同一個時代，先拿下來了`);
  return { text: bits.join("；"), back: gone[0] };
}

let poolNote = null;

function renderPoolNote() {
  let box = $("pool-note");
  if (!box) {
    box = el("p", { class: "pool-note", id: "pool-note" });
    $("pool-well").after(box);
  }
  box.hidden = !poolNote;
  if (!poolNote) return box.replaceChildren();
  const back = poolNote.back;
  box.replaceChildren(
    el("span", {}, poolNote.text),
    back && lib.byTag.has(back)
      ? el("button", { class: "link-btn", type: "button", onclick: () => { poolNote = null; pin(back); } }, "換回")
      : null
  );
}

const poolNode = (tag) => [...$("pool-well").querySelectorAll(".card")].find((n) => n.dataset.tag === tag);

/** 被擠出池子的牌：從原本的位置掀起來、往下飄走。跟疊印台的換下同一個動作。 */
function liftOut({ node, rect }) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !rect.width) return;
  const ghost = node.cloneNode(true);
  Object.assign(ghost.style, { position: "fixed", left: rect.left + "px", top: rect.top + "px", width: rect.width + "px", margin: "0", zIndex: "80", pointerEvents: "none" });
  ghost.style.setProperty("--card-w", rect.width + "px");
  document.body.append(ghost);
  ghost.animate(
    [
      { transform: "none", opacity: 1 },
      { transform: "translate(-18px, 26px) rotate(-10deg)", opacity: 0 },
    ],
    { duration: 380, easing: "cubic-bezier(0.7, 0, 0.84, 0)", fill: "forwards" }
  );
  setTimeout(() => ghost.remove(), 400);
}

/** 給螢幕閱讀器的一句話（畫面上的回饋已經在發生的地方了）。 */
function announce(text) {
  const t = $("toast");
  if (!t) return;
  t.dataset.show = "false";
  t.textContent = "";
  setTimeout(() => (t.textContent = text), 30);
}

function unpin(tag) {
  pool.delete(tag);
  for (const b of lex.byTag.get(tag)?.bind || []) pool.delete(b);
  commitPins();
}

function ban(tag) {
  if (!lib.byTag.has(tag)) return;
  const next = applyBan(lex, pool, bans, tag);
  pool = next.pinned;
  bans = next.userBanned;
  commitPins();
  renderTrash(true);
}

function unban(tag) {
  bans.delete(tag);
  commitPins();
  renderTrash();
}

function commitPins(fresh) {
  S.saveBans(bans);
  // 說明只講「剛剛那一步」：再動一次池子，舊的換下說明就收掉。
  if (!fresh) poolNote = null;
  renderPool(fresh);
  renderPoolNote();
  repaintLibrary();
  renderTrash();
  renderGoFloat();
}

function zh(tag) {
  return lib.byTag.get(tag)?.zh || lex.byTag.get(tag)?.zh || tag;
}

/* ================= 合成池 ================= */

function renderPool(fresh) {
  const well = $("pool-well");
  const tags = [...pool].filter((t) => lib.byTag.has(t));
  $("pool-count").textContent = tags.length ? `${tags.length} 張會一定進圖` : "";
  $("pool-clear").hidden = !tags.length;
  if (!tags.length) {
    well.replaceChildren(
      el(
        "div",
        { class: "pool-empty" },
        el("b", {}, "把字拖進來"),
        el("span", {}, "放進合成池的字，每一張圖都一定有。其他格子由引擎照規則抽牌補齊。"),
        el("span", {}, "字盒裡點一下也能放進來；池裡的字拖回字盒或點 × 就拿出來。")
      )
    );
    return;
  }
  well.replaceChildren(
    ...tags.map((t) => {
      const card = lib.byTag.get(t);
      const blocked = ratingBlocked(card.item, settings.rating);
      const node = cardNode(card, assets, { flag: blocked ? { kind: "ban", text: "分級擋掉" } : null });
      if (t === fresh) node.classList.add("dropped");
      node.addEventListener("click", () => showCard(t, "pool"));
      drag.attach(node, { tag: t, from: "pool" });
      return el(
        "div",
        { class: "pool-slot" },
        node,
        el("button", { class: "pool-x", type: "button", "aria-label": `把「${card.zh}」拿出合成池`, onclick: () => unpin(t) }, "×")
      );
    })
  );
}

/* ================= 規則 ================= */

function renderRules() {
  const box = $("rules");
  const heatRow = el(
    "div",
    { class: "rule-field", role: "group", "aria-label": "尺度" },
    HEATS.map((h) =>
      el(
        "button",
        {
          class: "chip-toggle",
          type: "button",
          dataset: { heat: h },
          "aria-pressed": settings.heats.includes(h) && !heatBlockedByRating(h, settings.rating) ? "true" : "false",
          // 分級擋掉的尺度跟主工具一樣變灰：這一級根本抽不到那種畫面。
          disabled: heatBlockedByRating(h, settings.rating),
          title: heatBlockedByRating(h, settings.rating) ? `${RATING_LABEL[settings.rating]}不會出現${HEAT_ZH[h]}` : undefined,
          onclick: () => {
            setSettings({ heats: toggleHeat(settings.heats, h) });
            renderRules();
          },
        },
        HEAT_ZH[h]
      )
    )
  );
  const eraSel = el(
    "select",
    { class: "select", "aria-label": "時代" },
    el("option", { value: "mixed" }, "混合（每張隨機）"),
    ERAS.map((e) => el("option", { value: e }, ERA_LABELS[e]))
  );
  eraSel.value = settings.eras.length === 1 ? settings.eras[0] : "mixed";
  eraSel.onchange = () => {
    setSettings({ eras: eraSel.value === "mixed" ? [...ERAS] : [eraSel.value] });
    renderLibrary();
  };
  const who = settings.girl && settings.boy ? "any" : settings.boy ? "boy" : "girl";
  const whoRow = el(
    "div",
    { class: "segmented", role: "radiogroup", "aria-label": "畫面裡有誰" },
    [
      ["girl", "女"],
      ["boy", "男"],
      ["any", "不限"],
    ].map(([k, label]) =>
      el(
        "button",
        {
          type: "button",
          role: "radio",
          "aria-checked": who === k ? "true" : "false",
          onclick: () => {
            setSettings({ girl: k !== "boy", boy: k !== "girl" });
            renderRules();
            renderLibrary();
          },
        },
        label
      )
    )
  );
  const counts = el(
    "div",
    { class: "rule-field", role: "group", "aria-label": "每段抽幾個" },
    [
      ["feature", "長相"],
      ["clothing", "服裝"],
      ["pose", "姿勢"],
      ["env", "場景"],
    ].map(([k, label]) =>
      stepper(label, settings.counts[k], 0, 10, (v) => {
        setSettings({ counts: { ...settings.counts, [k]: v } });
      })
    )
  );
  const sizeSel = el("select", { class: "select", "aria-label": "尺寸" }, SIZES.map((s) => el("option", { value: s.id }, s.zh)));
  sizeSel.value = (SIZES.find((s) => s.w === settings.width && s.h === settings.height) || SIZES[0]).id;
  sizeSel.onchange = () => {
    const s = SIZES.find((x) => x.id === sizeSel.value);
    setSettings({ width: s.w, height: s.h });
  };
  const sceneSel = el("select", { class: "select", "aria-label": "場景合理度" }, SCENE_MODES.map((m) => el("option", { value: m }, SCENE_MODE_LABELS[m])));
  sceneSel.value = settings.sceneMode;
  sceneSel.onchange = () => setSettings({ sceneMode: sceneSel.value });
  const job = switchBox("抽職業", settings.drawJob, (v) => setSettings({ drawJob: v }));
  const eraOnly = switchBox("字盒只看這個時代", ui.eraOnly, (v) => {
    ui.eraOnly = v;
    saveUi();
    renderLibrary();
  });

  box.replaceChildren(
    el("div", { class: "rule-row" }, el("span", { class: "rule-label" }, "尺度"), heatRow, el("span", { class: "rule-label" }, "時代"), eraSel, el("span", { class: "rule-label" }, "人物"), whoRow),
    el(
      "details",
      { class: "more-rules" },
      el("summary", {}, "更多規則：每段張數、尺寸、場景、職業"),
      el(
        "div",
        {},
        el("div", { class: "rule-row" }, el("span", { class: "rule-label" }, "每段抽幾個"), counts),
        el("div", { class: "rule-row" }, el("span", { class: "rule-label" }, "尺寸"), sizeSel, el("span", { class: "rule-label" }, "場景"), sceneSel, job, eraOnly)
      )
    )
  );
}

function stepper(label, value, min, max, onChange) {
  let v = value;
  const out = el("output", {}, v);
  const minus = el("button", { type: "button", "aria-label": `${label}少一個` }, "−");
  const plus = el("button", { type: "button", "aria-label": `${label}多一個` }, "＋");
  const sync = () => {
    out.textContent = v;
    minus.disabled = v <= min;
    plus.disabled = v >= max;
  };
  minus.onclick = () => {
    v = Math.max(min, v - 1);
    sync();
    onChange(v);
  };
  plus.onclick = () => {
    v = Math.min(max, v + 1);
    sync();
    onChange(v);
  };
  sync();
  return el("span", { class: "stepper" }, el("span", { class: "stepper-label" }, label), minus, out, plus);
}

function switchBox(label, on, onChange) {
  const input = el("input", { type: "checkbox", role: "switch" });
  input.checked = !!on;
  input.onchange = () => onChange(input.checked);
  return el("label", { class: "switch" }, input, label);
}

/* ================= 抽牌與生圖 ================= */

const tabNote = tabTitle();

const generator = createGenerator({
  payload: (shot) => ({
    width: shot.width,
    height: shot.height,
    loras: shot.loras,
    ckpt: shot.ckpt,
    rating: shot.rating,
    workflowId: shot.workflowId,
  }),
  update: (shot) => {
    tabNote.shot(shot, generator.pending);
    updateShot(shot);
    // 拿到伺服器的工作編號就先存一次：畫到一半重新整理也接得回來。
    const newJob = shot.job && shot._savedJob !== shot.job;
    if (newJob) shot._savedJob = shot.job;
    if (newJob || shot.status === "done" || shot.status === "failed" || shot.status === "cancelled") S.saveShots(shots);
    renderGoBar();
  },
  idle: () => {
    looping = infinite && !stopAsked;
    renderGoBar();
    if (!looping) return;
    setTimeout(() => {
      looping = false;
      if (infinite && !stopAsked) drawBatch(true);
      else renderGoBar();
    }, 60);
  },
  stopped: (why) => {
    infinite = false;
    toast(why);
    renderGoBar();
  },
});

// 生圖種子那一組只建一次，每次重畫合成池底下那排時把同一個節點搬回去（輸入到一半不會被洗掉）。
let seedNode = null;

function renderGoBar() {
  const bar = $("go-bar");
  const busy = generator.busy || looping;
  const n = settings.n;
  bar.replaceChildren(
    ...[
    stepper("一次", n, 1, 50, (v) => setSettings({ n: v })),
    switchBox("無限抽", infinite, (v) => {
      infinite = v;
      if (!v) stopAsked = true;
    }),
    switchBox("同一個人", settings.samePerson, (v) => setSettings({ samePerson: v })),
    el(
      "span",
      { class: "go-status", "aria-live": "polite" },
      busy ? `${generator.pending ? `印製中，還有 ${generator.pending} 張` : "下一輪…"}${infinite ? "・無限抽開著" : ""}` : ""
    ),
    el("span", { class: "spacer" }),
    busy ? el("button", { class: "btn", type: "button", onclick: stopAll }, "停") : null,
    el("button", { class: "btn btn-pool", type: "button", onclick: () => drawBatch(false), title: "只抽牌，不送 Comfy（P）" }, "只抽牌"),
    el("button", { class: "btn btn-primary", type: "button", onclick: () => drawBatch(true), title: "抽並生圖（G）" }, "抽並生圖", el("span", { class: "count" }, `×${n}`)),
    // 自己一行，放在按鈕底下：不要把「抽並生圖」擠到下一行去。
    seedNode || (seedNode = mountSeedControl(null, { compact: true })),
    ].filter(Boolean)
  );
  renderGoFloat();
}

/* 捲到成品牆看圖時，合成池那排按鈕早就捲出畫面了。這條浮在底部，跟上面那排是同一組動作。 */
let goBarVisible = true;

function renderGoFloat() {
  const float = $("go-float");
  // IntersectionObserver 第一次回報可能比 boot() 讀完設定還早。
  if (!float || !settings) return;
  const busy = generator.busy || looping;
  const show = !goBarVisible && (shots.length > 0 || pool.size > 0);
  float.dataset.show = show ? "true" : "false";
  float.inert = !show;
  float.replaceChildren(
    ...[
      el("span", { class: "go-float-state" }, busy ? (generator.pending ? `印製中・還有 ${generator.pending} 張` : "無限抽・下一輪…") : pool.size ? `池裡 ${pool.size} 張` : "池子是空的，全靠抽"),
      busy ? el("button", { class: "btn btn-small", type: "button", onclick: stopAll }, "停") : null,
      el("button", { class: "btn btn-small btn-pool", type: "button", onclick: () => drawBatch(false), title: "只抽牌（P）" }, "只抽牌"),
      el("button", { class: "btn btn-small btn-primary", type: "button", onclick: () => drawBatch(true), title: "抽並生圖（G）" }, "抽並生圖", el("span", { class: "count" }, `×${settings.n}`)),
    ].filter(Boolean)
  );
}

function watchGoBar() {
  const bar = $("go-bar");
  if (!bar || typeof IntersectionObserver !== "function") return;
  new IntersectionObserver(
    (entries) => {
      goBarVisible = entries.some((e) => e.isIntersecting);
      renderGoFloat();
    },
    { rootMargin: "-56px 0px 0px 0px" }
  ).observe(bar);
}

function stopAll() {
  infinite = false;
  stopAsked = true;
  looping = false;
  generator.stop();
  renderGoBar();
}

let shotSeq = Date.now();

/** 抽一輪。合成池的字一定進；同一個人時，第二張起鎖住第一張的長相。 */
function drawBatch(gen) {
  stopAsked = false;
  const n = settings.n;
  let first = null;
  const made = [];
  for (let i = 0; i < n; i++) {
    const pins = new Set(pool);
    const banned = new Set([...bans, ...HARD_BANNED]);
    if (settings.samePerson && first) {
      for (const t of identityPins(lex, first)) pins.add(t);
      for (const t of identityBans(lex, first)) if (!pins.has(t)) banned.add(t);
    }
    const seed = randomSeed();
    const drawn = drawWithSeed(lex, settings, pins, banned, seed, { trace: true });
    if (!drawn.positive || !String(drawn.positive).trim()) continue;
    if (!first) first = drawn.positive;
    // 抽牌種子每張隨機；送 ComfyUI 的種子看「生圖種子」設定（固定就整批同一顆）。
    const shot = makeShot(drawn, genSeed(seed), new Set(pool));
    shots.unshift(shot);
    made.push(shot);
  }
  if (!made.length) {
    toast("這一輪抽不出東西：合成池的字可能互相卡住，換一兩張試試");
    return;
  }
  const wall = $("wall");
  for (const shot of made.slice().reverse()) {
    const node = shotNode(shot, true);
    wall.prepend(node);
    layoutFans(node);
  }
  $("wall-empty").hidden = true;
  trimWall();
  S.saveShots(shots);
  if (gen) for (const shot of made) generator.enqueue(shot);
  renderGoBar();
  document.getElementById("wall-head").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function makeShot(drawn, seed, poolAtDraw) {
  const source = new Map(((drawn.trace && drawn.trace.kept) || []).map((k) => [k.tag, k.source]));
  const inPos = new Set(String(drawn.positive).split(",").map((s) => s.trim()));
  const mine = [];
  const got = [];
  for (const sec of SECTION_ORDER) {
    for (const t of drawn.sections[sec] || []) {
      if (!lib.byTag.has(t)) continue;
      if (poolAtDraw.has(t)) mine.push(t);
      else got.push({ tag: t, src: source.get(t) || "random" });
    }
  }
  const missing = [...poolAtDraw].filter((t) => !inPos.has(t));
  const trigger = currentTriggerText();
  return {
    id: "s" + shotSeq++,
    seed,
    positive: insertTriggerAfterCast(drawn.positive, trigger),
    mine,
    drawn: got,
    missing,
    era: drawn.era,
    heat: drawn.heat,
    width: settings.width,
    height: settings.height,
    rating: settings.rating,
    loras: currentLorasPayload(),
    ckpt: currentCkpt(),
    workflowId: currentWorkflowId(),
    status: "drawn",
    note: "",
    image: null,
    at: new Date().toISOString(),
  };
}

function trimWall() {
  if (shots.length <= 80) return;
  const drop = shots.splice(80);
  for (const s of drop) document.querySelector(`.shot[data-id="${s.id}"]`)?.remove();
}

/* ================= 成品牆 ================= */

function setAllOpen(open) {
  for (const node of $("wall").children) node._setOpen && node._setOpen(open);
}

function renderWall() {
  const tools = $("wall-tools");
  tools.replaceChildren(
    el("button", { class: "btn btn-small btn-ghost", type: "button", onclick: () => setAllOpen(true) }, "全部展開"),
    el("button", { class: "btn btn-small btn-ghost", type: "button", onclick: () => setAllOpen(false) }, "全部收起")
  );
  const wall = $("wall");
  wall.replaceChildren(...shots.map((s) => shotNode(s, false)));
  $("wall-empty").hidden = shots.length > 0;
  requestAnimationFrame(() => {
    for (const node of wall.children) layoutFans(node);
  });
  setTimeout(() => {
    for (const node of wall.children) layoutFans(node);
  }, 80);
}

/**
 * 一張成品。有圖看圖、沒圖看字（跟導影台的成片卡同一個道理）：
 * 要送去印的，牌先收在「牌 · N」後面；只抽牌的沒有圖，牌就是成果，直接攤開。
 */
function shotNode(shot, deal) {
  const frame = el("div", { class: "shot-frame", style: `aspect-ratio: ${shot.width} / ${shot.height}` });
  // 點圖就放大（跟疊印台點成品一樣）。只點圖本身才算：只抽牌的那張沒有圖，點到牌扇不會誤開。
  frame.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest("img")) showShot(shot);
  });
  const status = el("span", { class: "status" });
  // 沒有圖可看的（只抽牌、印壞、被停掉）直接攤開；有圖的牌收著，要看再點。
  const open = !shot.image && REPRINTABLE.has(shot.status);
  // 收著的那疊牌第一次打開才建：一張成品底下三十張牌、兩百個節點，
  // 牆上四十張就是七千多個看不到的節點，載入時白白排版一次（實測 50＋126ms 的長任務）。
  let cards = open ? shotCards(shot, false) : el("div", { class: "shot-cards" });
  let built = open;
  cards.id = "cards-" + shot.id;
  let userToggled = false;
  cards.hidden = !open;
  const ensureCards = () => {
    if (built) return;
    built = true;
    const full = shotCards(shot, false);
    full.id = cards.id;
    full.hidden = cards.hidden;
    cards.replaceWith(full);
    cards = full;
  };
  let dealtOnce = !deal && open;
  const total = shot.mine.length + shot.drawn.length;
  const suits = CARD_SUITS.filter((s) => shot.drawn.some((d) => lib.byTag.get(d.tag)?.suit === s) || shot.mine.some((t) => lib.byTag.get(t)?.suit === s));
  const toggle = el(
    "button",
    { class: "shot-toggle", type: "button", "aria-expanded": open ? "true" : "false", "aria-controls": cards.id, title: "展開／收起這張用到的牌" },
    el("span", { class: "mini", "aria-hidden": "true" }, suits.map((s) => el("i", { style: `--suit: var(--suit-${s})` }))),
    `牌 · ${total}`,
    el("span", { class: "chev", "aria-hidden": "true" })
  );
  const setOpen = (now) => {
    if (now) ensureCards();
    cards.hidden = !now;
    toggle.setAttribute("aria-expanded", now ? "true" : "false");
    if (now) {
      if (!dealtOnce) {
        dealtOnce = true;
        [...cards.querySelectorAll(".card")].forEach((c, i) => {
          c.classList.remove("dealt");
          void c.offsetWidth;
          c.style.setProperty("--i", String(i));
          c.classList.add("dealt");
        });
      }
      layoutFans(node);
    }
  };
  toggle.addEventListener("click", () => {
    userToggled = true;
    setOpen(cards.hidden);
  });
  const node = el(
    "article",
    { class: "shot", dataset: { id: shot.id, status: shot.status } },
    frame,
    el(
      "div",
      { class: "shot-meta" },
      status,
      el("code", {}, seedUseButton(shot.seed)),
      el("span", {}, [ERA_LABELS[shot.era] || "", heatBlockedByRating(shot.heat, shot.rating) ? "" : HEAT_ZH[shot.heat] || ""].filter(Boolean).join("・"))
    ),
    cards,
    el(
      "div",
      { class: "shot-actions" },
      toggle,
      el("button", { class: "btn btn-small btn-ghost", type: "button", onclick: () => showShot(shot) }, "放大"),
      el("button", { class: "btn btn-small btn-ghost", type: "button", onclick: () => copyPos(shot) }, "複製 POS"),
      el("button", { class: "btn btn-small btn-ghost", type: "button", onclick: () => reprint(shot), title: "同樣的 POS、同一顆種子再送一次" }, "同種子重印"),
      el("button", { class: "btn btn-small btn-ghost", type: "button", onclick: () => removeShot(shot) }, "撤下")
    )
  );
  node._setOpen = setOpen;
  // 就地送去印的那張，圖一出來就把自動攤開的牌收起來（使用者自己點開的不動）。
  node._imageArrived = () => {
    if (!userToggled && !cards.hidden) setOpen(false);
  };
  if (open && deal) setOpen(true);
  paintShot(node, shot);
  return node;
}

function shotCards(shot, deal) {
  let i = 0;
  const dealt = (n) => {
    if (deal) {
      n.classList.add("dealt");
      n.style.setProperty("--i", String(i++));
    }
    return n;
  };
  const mineCards = shot.mine.map((t) => dealt(resultCard(t, null)));
  const missCards = (shot.missing || []).filter((t) => lib.byTag.has(t)).map((t) => {
    const n = resultCard(t, null, { kind: "ban", text: "沒進圖" });
    n.dataset.state = "gone";
    return dealt(n);
  });
  const bySuit = new Map();
  for (const d of shot.drawn) {
    const card = lib.byTag.get(d.tag);
    if (!card) continue;
    if (!bySuit.has(card.suit)) bySuit.set(card.suit, []);
    bySuit.get(card.suit).push(d);
  }
  const fans = CARD_SUITS.filter((s) => bySuit.has(s)).map((s) =>
    el("div", { class: "fan", dataset: { suit: s }, "aria-label": CARD_SUIT_INFO[s].zh }, bySuit.get(s).map((d) => dealt(resultCard(d.tag, SRC_ZH[d.src] || null))))
  );
  return el(
    "div",
    { class: "shot-cards" },
    el("p", { class: "deal-label", dataset: { kind: "mine" } }, el("b", {}, "你選的"), shot.mine.length ? `${shot.mine.length} 張` : "這張沒有放字，全部是抽的"),
    mineCards.length || missCards.length ? el("div", { class: "deal-row" }, mineCards, missCards) : null,
    el("p", { class: "deal-label" }, el("b", {}, "抽到的"), `${shot.drawn.length} 張・拖進合成池就釘住，丟進廢字簍就封鎖`),
    el("div", { class: "fans" }, fans)
  );
}

function resultCard(tag, src, flag) {
  const card = lib.byTag.get(tag);
  const node = cardNode(card, assets, { src, flag });
  node.addEventListener("click", () => showCard(tag, "shot"));
  drag.attach(node, { tag, from: "shot" });
  return node;
}

/** 扇形：一種花色疊成一把，放不下就疊得更緊，只露出書脊。 */
function layoutFans(shotEl) {
  for (const fan of shotEl.querySelectorAll(".fan")) {
    const n = fan.children.length;
    if (n < 2) continue;
    const W = fan.clientWidth;
    const w = fan.children[0].getBoundingClientRect().width || 60;
    const natural = n * (w + 4);
    const overlap = natural > W ? -Math.ceil((n * w - W) / (n - 1)) : 4;
    fan.style.setProperty("--fan-overlap", `${Math.min(4, overlap)}px`);
  }
}

function paintShot(node, shot) {
  node.dataset.status = shot.status;
  const frame = node.querySelector(".shot-frame");
  const src = viewSrc(shot.image) || shot.preview;
  let img = frame.querySelector("img");
  if (src) {
    if (!img) {
      img = el("img", { alt: "成品", decoding: "async" });
      frame.prepend(img);
    }
    if (img.getAttribute("src") !== src) {
      // 剛印好（上一幀還是預覽或空的）：像相紙泡進顯影液，由上往下浮出來。
      const developing = shot.status === "done" && node.dataset.shown !== "done" && node.dataset.shown !== undefined;
      img.src = src;
      if (developing && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        frame.classList.remove("is-developing");
        void frame.offsetWidth;
        frame.classList.add("is-developing");
        setTimeout(() => frame.classList.remove("is-developing"), 1300);
      }
    }
  } else if (img) img.remove();
  node.dataset.shown = shot.status;
  let empty = frame.querySelector(".shot-empty");
  const words = {
    drawn: "只抽了牌，還沒送去印",
    queued: shot.note || "排隊等印",
    running: shot.note || "印製中",
    failed: shot.note || "印壞了",
    cancelled: shot.note || "取消了",
    stopped: shot.note || "上次中斷了",
  };
  if (!src) {
    if (!empty) {
      empty = el("div", { class: "shot-empty" });
      frame.append(empty);
    }
    // paintShot 每一格進度都會呼叫；狀態和字沒變就不要重建那一手牌。
    const key = shot.status + "|" + (words[shot.status] || "");
    if (empty.dataset.key !== key) {
      empty.dataset.key = key;
      empty.replaceChildren(...draftFace(shot, words[shot.status] || ""));
    }
  } else if (empty) empty.remove();
  let bar = frame.querySelector(".shot-progress");
  if (shot.status === "running") {
    if (!bar) {
      bar = el("div", { class: "shot-progress" }, el("i"));
      frame.append(bar);
    }
    bar.style.setProperty("--p", String(shot.progress || 0));
  } else if (bar) bar.remove();
  const status = node.querySelector(".shot-meta .status");
  status.dataset.kind = shot.status === "failed" ? "err" : "";
  status.textContent =
    shot.status === "done" ? "印好了" : shot.status === "running" ? shot.note || "印製中" : shot.status === "drawn" ? "只抽牌" : words[shot.status] || "";
}

const REPRINTABLE = new Set(["drawn", "failed", "cancelled", "stopped"]);

/** 沒有圖的畫框：只抽牌的攤一手牌，印壞的給一顆再印。 */
function draftFace(shot, text) {
  const out = [];
  if (shot.status === "drawn") out.push(draftHand(shot));
  out.push(el("p", {}, text));
  if (REPRINTABLE.has(shot.status)) {
    out.push(
      el(
        "button",
        { class: "btn btn-small " + (shot.status === "drawn" ? "btn-primary" : "btn-pool"), type: "button", onclick: () => printInPlace(shot) },
        shot.status === "drawn" ? "送去印這張" : "再印一次"
      )
    );
  }
  return out;
}

/** 一手牌：你放的先，再每種花色挑一張抽到的，最多七張，像握在手上那樣扇開。 */
function draftHand(shot) {
  const pick = [];
  const seen = new Set();
  const add = (t) => {
    if (pick.length >= 7 || seen.has(t) || !lib.byTag.has(t)) return;
    seen.add(t);
    pick.push(t);
  };
  for (const t of shot.mine.slice(0, 3)) add(t);
  for (const suit of CARD_SUITS) {
    const d = shot.drawn.find((x) => lib.byTag.get(x.tag)?.suit === suit && !seen.has(x.tag));
    if (d) add(d.tag);
  }
  for (const d of shot.drawn) add(d.tag);
  const n = pick.length;
  return el(
    "div",
    { class: "hand", "aria-hidden": "true" },
    pick.map((t, i) => {
      const card = lib.byTag.get(t);
      const art = assets.art(t);
      const off = i - (n - 1) / 2;
      return el(
        "span",
        { class: "hand-card", style: `--o:${off};--y:${off * off};--suit:var(--suit-${card.suit})` },
        art ? applyArtSources(el("img", { alt: "", decoding: "async", draggable: "false" }), assets.sources(t)) : el("b", {}, [...card.zh][0]),
        el("i", {}, card.zh)
      );
    })
  );
}

/** 同一張就地送去印（只抽牌的、印壞的、被停掉的），不另開一張新的。 */
function printInPlace(shot) {
  if (!REPRINTABLE.has(shot.status)) return;
  shot.note = "";
  shot.preview = null;
  generator.enqueue(shot);
  updateShot(shot);
  S.saveShots(shots);
  renderGoBar();
}

function updateShot(shot) {
  const node = document.querySelector(`.shot[data-id="${shot.id}"]`);
  if (node) paintShot(node, shot);
  if (node && shot.status === "done" && shot.image) node._imageArrived && node._imageArrived();
}

async function copyPos(shot) {
  try {
    await navigator.clipboard.writeText(shot.positive);
    toast("POS 複製好了");
  } catch {
    toast("複製不了，請到「放大」裡手動選取");
  }
}

function reprint(shot) {
  const copy = { ...shot, id: "s" + shotSeq++, status: "drawn", image: null, preview: null, note: "", at: new Date().toISOString() };
  shots.unshift(copy);
  const node = shotNode(copy, true);
  $("wall").prepend(node);
  layoutFans(node);
  generator.enqueue(copy);
  renderGoBar();
}

function removeShot(shot) {
  if (shot.status === "running" || shot.status === "queued") {
    toast("這張還在印，先按「停」");
    return;
  }
  shots = shots.filter((s) => s.id !== shot.id);
  document.querySelector(`.shot[data-id="${shot.id}"]`)?.remove();
  $("wall-empty").hidden = shots.length > 0;
  S.saveShots(shots);
  renderGoFloat();
}

function showShot(shot) {
  const src = viewSrc(shot.image) || shot.preview;
  openSheet(
    `seed ${shot.seed}`,
    el(
      "div",
      { class: "lightbox" },
      src ? el("img", { src, alt: "成品" }) : el("p", { class: "pool-empty" }, "這張還沒有圖。"),
      el(
        "div",
        {},
        el("p", { class: "tag-en" }, [shot.width + "×" + shot.height, RATING_ZH[shot.rating], ERA_LABELS[shot.era]].filter(Boolean).join("・")),
        el("pre", { class: "pos-text" }, shot.positive)
      )
    ),
    {
      wide: true,
      foot: [
        el("button", { class: "btn btn-small", type: "button", onclick: () => copyPos(shot) }, "複製 POS"),
        shot.image ? el("a", { class: "btn btn-small", href: shot.image, target: "_blank", rel: "noopener" }, "開原圖") : null,
      ],
    }
  );
}

/* ================= 單張牌的詳情 ================= */

function showCard(tag, from) {
  const card = lib.byTag.get(tag);
  if (!card) return;
  const art = assets.art(tag);
  const facts = cardFacts(card, lex, data);
  const inPool = pool.has(tag);
  const banned = bans.has(tag);
  const sheet = openSheet(
    card.zh,
    el(
      "div",
      { class: "detail" },
      art ? el("div", { class: "detail-art" }, el("img", { src: art, alt: card.zh })) : cardNode(card, assets, { tagName: "div" }),
      el("div", {}, el("p", { class: "tag-en" }, card.tag), el("dl", {}, facts.map(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])))
    ),
    {
      foot: [
        banned
          ? el("button", { class: "btn", type: "button", onclick: () => { unban(tag); sheet.close(); } }, "從廢字簍撿回來")
          : el("button", { class: "btn", type: "button", onclick: () => { ban(tag); sheet.close(); } }, "丟進廢字簍（不再抽到）"),
        inPool
          ? el("button", { class: "btn btn-pool", type: "button", onclick: () => { unpin(tag); sheet.close(); } }, "拿出合成池")
          : el("button", { class: "btn btn-primary", type: "button", onclick: () => { pin(tag); sheet.close(); } }, "放進合成池"),
      ],
    }
  );
  void from;
}

/* ================= 廢字簍 ================= */

function renderTrash(bump) {
  const t = $("trash");
  t.querySelector("b").textContent = bans.size;
  t.setAttribute("aria-label", `廢字簍：封鎖了 ${bans.size} 個字，點開可以撿回來`);
  if (bump && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    t.animate([{ transform: "scale(1)" }, { transform: "scale(1.15)" }, { transform: "scale(1)" }], { duration: 260, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
  }
}

function showBans() {
  const list = [...bans].filter((t) => lib.byTag.has(t));
  const grid = list.length
    ? el(
        "div",
        { class: "ban-grid" },
        list.map((t) => {
          const node = cardNode(lib.byTag.get(t), assets);
          node.addEventListener("click", () => {
            unban(t);
            node.remove();
          });
          return node;
        })
      )
    : el("p", { class: "pool-empty" }, "廢字簍是空的。把不想再看到的字拖進來，以後就不會抽到。");
  const sheet = openSheet(`廢字簍・${list.length} 個字`, el("div", {}, list.length ? el("p", { class: "tag-en", style: "margin-bottom:0.75rem" }, "點一張就撿回來（之後又可能抽到）。") : null, grid), {
    wide: true,
    foot: list.length
      ? [
          el("button", {
            class: "btn",
            type: "button",
            onclick: () => {
              bans = new Set();
              commitPins();
              sheet.close();
            },
          }, "全部撿回來"),
        ]
      : null,
  });
}

/* ================= 拖曳 ================= */

const libCardNode = (tag) => [...$("lib-grid").querySelectorAll(".card")].find((n) => n.dataset.tag === tag) || null;

const drag = createDrag({
  zones: () => [
    { id: "pool", el: $("pool-well"), accepts: (p) => p.from !== "pool" },
    // 丟進廢字簍：影子縮小、轉著被吸進去（drag.js 的 sink）。
    { id: "trash", el: $("trash"), accepts: () => true, sink: true },
    { id: "library", el: $("library"), accepts: (p) => p.from === "pool" },
  ],
  // 回傳落點：影子飛到那張牌的位置落下（drag.js）。
  onDrop: (p, zone) => {
    if (zone === "pool") {
      if (bans.has(p.tag)) bans.delete(p.tag);
      pin(p.tag);
      return poolNode(p.tag);
    }
    if (zone === "trash") {
      // 廢字簍自己會跳一下、數字加一；畫面上不用再多一個提示。
      ban(p.tag);
      announce(`「${zh(p.tag)}」丟進廢字簍了，之後不會抽到`);
      return null;
    }
    if (zone === "library") {
      unpin(p.tag);
      return libCardNode(p.tag);
    }
    return null;
  },
});

/* ================= 鍵盤 ================= */

function onKey(e) {
  if (handleLoraKeys(e) || wfHandleKeys(e)) return;
  if (anyOverlay() || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
  if (e.key === "g" || e.key === "G") {
    e.preventDefault();
    drawBatch(true);
  } else if (e.key === "p" || e.key === "P") {
    e.preventDefault();
    drawBatch(false);
  } else if (e.key === "Escape" && generator.busy) {
    stopAll();
  } else if (e.key === "/") {
    e.preventDefault();
    $("lib-q").focus();
  }
}

watchGoBar();
$("trash").addEventListener("click", showBans);
$("trash").innerHTML = ICONS.trash + "<b>0</b><span>廢字簍</span>";
$("pool-clear").addEventListener("click", () => {
  pool = new Set();
  commitPins();
});

// ?debug：給測試腳本用的把手
if (new URLSearchParams(location.search).has("debug")) {
  window.mochi = { get pool() { return pool; }, get bans() { return bans; }, get shots() { return shots; }, get settings() { return settings; }, pin, ban, drawBatch, lib: () => lib };
}

boot();
