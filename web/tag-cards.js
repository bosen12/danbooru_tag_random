/**
 * 排字匣的「卡牌」樣子：下方字盒裡的每個字變成一張小牌（插畫、花色、字名），
 * 滑鼠停上去浮出放大牌（跟墨池、LoRA 面板的預覽同一套手感）。
 *
 * 只換外觀，不碰流程：按鈕還是 boot.js 做的那顆 .tag，點擊、權重、釘選／封鎖
 * 全部照舊，這裡只往按鈕裡塞一格插畫。切回「字條」就是把 html 上的
 * data-tag-style 拿掉，插畫那格用 CSS 藏起來 —— 不重畫、不重綁。
 *
 * 字盒被 buildCats() 整片換掉時，用 MutationObserver 把新按鈕補上插畫。
 * 插畫來自 web/cards（scripts/bake_card_art.py 烤的），沒有的字就用字形當封面。
 */
import { CARD_SUIT_INFO, HARD_BANNED, cardSuit, groupSeal, artSources, artUrl, applyArtSources } from "./card-art.js";
import { attachPeek } from "./card-peek.js";

const KEY = "paizixia.tagStyle";
const STYLES = ["card", "chip"];
const HARD = new Set(HARD_BANNED);
const SEC_ZH = { quality: "畫質與風格", subject: "人數", feature: "長相", pose: "姿勢", clothing: "服裝", env: "場景" };
const RATING_ZH = { sensitive: "敏感", explicit: "限制級" };
const RATING_RANK = { general: 0, sensitive: 1, explicit: 2 };
const root = document.documentElement;

let byTag = new Map();
let groupZh = {};
let manifest = {};
let observer = null;
let decorated = false;

function readStyle() {
  try {
    const v = localStorage.getItem(KEY);
    if (STYLES.includes(v)) return v;
  } catch {
    /* 私密視窗讀不到就用預設 */
  }
  return "card";
}

function saveStyle(v) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* 存不了就只在這次有效 */
  }
}

// 越早設越好：字盒還沒畫出來之前就要知道是哪種樣子，才不會先閃一下字條。
let style = readStyle();
root.dataset.tagStyle = style;

// 插畫跟著左欄的尺度分級走：選了全年齡，色情字的牌就蓋起來只露字形，圖連抓都不抓。
// 字盒本來就會列出（淡掉）超過尺度的字，字條只是字，換成插畫就不一樣了。
// 還沒讀到分級之前先當全年齡，寧可先蓋著。
root.dataset.cardRating = "general";

function currentRating() {
  const on = document.querySelector('#rating .segmented-btn[data-rating][aria-current="true"]');
  return on && RATING_RANK[on.dataset.rating] !== undefined ? on.dataset.rating : null;
}

function syncRating() {
  const r = currentRating();
  if (r) root.dataset.cardRating = r;
}

function veiled(tag) {
  const r = manifest[tag]?.rating || "general";
  return (RATING_RANK[r] || 0) > (RATING_RANK[root.dataset.cardRating] || 0);
}

function suitColor(suit) {
  return suit ? `var(--tc-${suit})` : "var(--color-neutral)";
}

function artSrc(tag) {
  const m = manifest[tag];
  if (!m || !m.file || HARD.has(tag)) return "";
  return artUrl(m);
}

function decorate(btn) {
  if (btn.dataset.tc || btn.dataset.locked === "1" || !btn.dataset.tag) return;
  const tag = btn.dataset.tag;
  const item = byTag.get(tag);
  const suit = cardSuit(item);
  btn.dataset.tc = suit || "none";
  const zh = btn.querySelector(":scope > .label")?.textContent || tag;
  const art = document.createElement("span");
  art.className = "tc-art";
  art.setAttribute("aria-hidden", "true");
  art.style.setProperty("--tc-suit", suitColor(suit));
  const src = artSrc(tag);
  const glyph = () => {
    const g = document.createElement("span");
    g.className = "tc-glyph";
    g.textContent = [...zh][0] || "字";
    return g;
  };
  const rating = manifest[tag]?.rating;
  if (rating && rating !== "general") btn.dataset.artR = rating;
  if (src) {
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    img.draggable = false;
    // 字盒一格 80～92px：有縮圖就拿縮圖（約 9KB），整本打開從 50MB 降到 12MB 左右。
    applyArtSources(img, artSources(manifest[tag]) || { src });
    img.addEventListener("error", () => img.replaceWith(glyph()), { once: true });
    art.append(img);
    // 超過目前尺度時蓋上的那面（CSS 決定哪一面露出來）。
    if (btn.dataset.artR) {
      const veil = glyph();
      veil.classList.add("tc-veil");
      art.append(veil);
    }
  } else {
    art.append(glyph());
  }
  if (suit) {
    const s = document.createElement("span");
    s.className = "tc-suit";
    s.textContent = CARD_SUIT_INFO[suit].glyph;
    art.append(s);
  }
  const seal = groupSeal(item);
  if (seal) {
    // 小分類的一字章（鏡、表、上…）：跟墨池、疊印台的牌同一個字。
    const g = document.createElement("span");
    g.className = "tc-seal";
    g.textContent = seal;
    art.append(g);
  }
  if (rating && rating !== "general") {
    const r = document.createElement("span");
    r.className = "tc-rate";
    r.dataset.r = rating;
    r.textContent = rating === "explicit" ? "色" : "敏";
    art.append(r);
  }
  btn.prepend(art);
}

function decorateIn(node) {
  if (!(node instanceof Element)) return;
  if (node.matches(".tag")) decorate(node);
  for (const btn of node.querySelectorAll(".tag")) decorate(btn);
}

/**
 * 只裝飾打開著的分類。分類預設全部收著，一次裝飾全部 1383 張等於多出五千多個節點、
 * 載入時白做 20ms；分類打開（.cat 多了 is-open）的那一刻才補插畫。
 * MutationObserver 的回呼在下一次畫面之前跑，所以打開時不會先閃一下字條。
 */
function decorateOpen(root) {
  if (root.matches?.(".cat.is-open")) decorateIn(root);
  for (const cat of root.querySelectorAll(".cat.is-open")) decorateIn(cat);
}

function startDecorating() {
  const cats = document.getElementById("cats");
  if (!cats || decorated) return;
  decorated = true;
  decorateOpen(cats);
  observer = new MutationObserver((records) => {
    for (const rec of records) {
      if (rec.type === "attributes") {
        if (rec.target.matches?.(".cat.is-open")) decorateIn(rec.target);
        continue;
      }
      for (const n of rec.addedNodes) {
        if (!(n instanceof Element)) continue;
        const cat = n.closest(".cat");
        if (cat) {
          if (cat.classList.contains("is-open")) decorateIn(n);
        } else decorateOpen(n);
      }
    }
  });
  observer.observe(cats, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
}

function stateLine(btn) {
  const st = btn.dataset.state;
  if (st === "pinned") return ["狀態", "釘選中，每張都會有。再點一下改成封鎖"];
  if (st === "banned" && btn.dataset.ban === "mutex") return ["狀態", "同一格已經釘了別的字。點一下換成這個"];
  if (st === "banned") return ["狀態", "你封鎖的，不會抽到。再點一下放回去"];
  return ["點一下", "釘選：每張圖都一定有它"];
}

function peekInfo(btn) {
  if (root.dataset.tagStyle !== "card" || btn.dataset.locked === "1") return null;
  const tag = btn.dataset.tag;
  const item = byTag.get(tag);
  const suit = btn.dataset.tc && btn.dataset.tc !== "none" ? btn.dataset.tc : cardSuit(item);
  const zh = btn.querySelector(":scope > .label")?.textContent || tag;
  const sec = btn.closest(".cat")?.id?.replace(/^sec-/, "");
  const where = [SEC_ZH[sec], item && item.group ? groupZh[item.group] : null].filter(Boolean).join(" · ");
  const facts = [];
  if (where) facts.push(["分類", where]);
  facts.push(stateLine(btn));
  if (btn.dataset.weight) facts.push(["權重", btn.dataset.weight]);
  if (btn.dataset.offEra === "1") facts.push(["時代", "不是這個時代的字，這時代不會抽到"]);
  if (btn.dataset.offHeat === "1") facts.push(["尺度", "目前勾的尺度不會抽到它"]);
  const rating = manifest[tag]?.rating;
  if (rating && RATING_ZH[rating]) facts.push(["分級", RATING_ZH[rating]]);
  return {
    zh,
    tag,
    glyph: suit ? CARD_SUIT_INFO[suit].glyph : "",
    suitColor: suit ? getComputedStyle(root).getPropertyValue(`--tc-${suit}`).trim() : "",
    art: veiled(tag) ? "" : artSrc(tag),
    rating,
    seal: groupSeal(item),
    sealTitle: item && item.group ? groupZh[item.group] : "",
    facts,
  };
}

function setStyle(next) {
  if (!STYLES.includes(next)) return;
  style = next;
  root.dataset.tagStyle = next;
  saveStyle(next);
  if (next === "card") startDecorating();
  syncSwitch();
}

let switchEl = null;

function syncSwitch() {
  if (!switchEl) return;
  for (const b of switchEl.querySelectorAll("[data-tag-style]")) {
    b.setAttribute("aria-pressed", String(b.dataset.tagStyle === style));
  }
}

function mountSwitch() {
  const row = document.querySelector("#filter-bar .filter-row");
  if (!row || document.getElementById("tag-style")) return;
  switchEl = document.createElement("div");
  switchEl.className = "tc-switch";
  switchEl.id = "tag-style";
  switchEl.setAttribute("role", "group");
  switchEl.setAttribute("aria-label", "字盒的樣子");
  for (const [v, label, hint] of [
    ["chip", "字條", "原本的字條：一格一個字，最省空間"],
    ["card", "卡牌", "每個字一張小牌，有插畫；滑鼠停上去看大牌"],
  ]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "seg";
    b.dataset.tagStyle = v;
    b.title = hint;
    b.textContent = label;
    switchEl.append(b);
  }
  switchEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tag-style]");
    if (b) setStyle(b.dataset.tagStyle);
  });
  row.append(switchEl);
  syncSwitch();
}

async function loadJson(url) {
  try {
    const r = await fetch(url);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

async function init() {
  mountSwitch();
  syncRating();
  const ratingEl = document.getElementById("rating");
  if (ratingEl) {
    new MutationObserver(syncRating).observe(ratingEl, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-current"] });
  }
  const [lexData, man] = await Promise.all([loadJson("lexicon.json"), loadJson("cards/manifest.json")]);
  if (lexData && Array.isArray(lexData.tags)) {
    byTag = new Map(lexData.tags.map((t) => [t.tag, t]));
    groupZh = lexData.groupZh || {};
  }
  manifest = man || {};
  if (style === "card") startDecorating();
  attachPeek(document.getElementById("cats"), ".tag[data-tag]:not([data-locked='1'])", peekInfo);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
