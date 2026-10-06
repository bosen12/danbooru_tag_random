/**
 * 卡冊：每張牌進過幾張圖。
 *
 * 次數由墨池、疊印台記（usage.js）：墨池每抽出一張、疊印台每付印一張，用到的牌各加一。
 * 這一頁只讀、排、看：
 *   - 多到少／少到多，花色、細分類、找字、只看用過的。
 *   - 換排序、換花色時，還在畫面上的牌從舊位置滑到新位置（FLIP），新來的錯開浮上來。
 *   - 點一張牌：牌飛進詳情，大數字從 0 數上來，看你親手放幾次、引擎補幾次、最近一次。
 *     「帶去墨池」把它放進墨池的合成池（store.js 的交接便條）再換版過去。
 *   - 別的分頁抽完牌：這裡的數字跟著跳一下（storage 事件），排序不自己亂動，給一顆「重新排序」。
 */
import { indexLexicon } from "./engine.js";
import { ratingBlocked, RATING_LABEL } from "./rules/rating.js";
import { buildLibrary, groupChips, createAssets, cardNode, cardFacts, CARD_SUIT_INFO, CARD_SUITS } from "./cards.js";
import { el, openSheet, toast } from "./ui.js";
import { initMotion, settleMotion, seat, refuse, reducedMotion, CURVE, DUR, css } from "./motion.js";
import { watchLink, LINK_LABEL } from "./gen.js";
import { getSfx } from "./sfx.js";
import { attachPeek } from "./card-peek.js";
import * as S from "./store.js";
import { USAGE_KEY, loadUsage, seedUsage } from "./usage.js";

const sfx = getSfx();
const $ = (id) => document.getElementById(id);
const UI_KEY = "mochi.book.v1";
// 一次畫幾張：上千張一次畫完會卡；捲到底附近再接著畫（跟字盒同一套）。
const CHUNK = 72;
const ORDER_ZH = { desc: "多到少", asc: "少到多" };

let data = null;
let lex = null;
let lib = null;
let assets = null;
let usage = null;
let rating = "general";
let list = [];
let shown = 0;
// 牌的節點留著重用：換排序時同一張牌是同一個節點，才滑得過去，圖也不必重載。
const cells = new Map();
const ui = { suit: "all", group: "", query: "", order: "desc", usedOnly: false, ...readUi() };

function readUi() {
  try {
    const u = JSON.parse(localStorage.getItem(UI_KEY) || "{}");
    return u && typeof u === "object" ? u : {};
  } catch {
    return {};
  }
}
function saveUi() {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({ suit: ui.suit, group: ui.group, order: ui.order, usedOnly: ui.usedOnly }));
  } catch {
    /* 存不了就算了 */
  }
}

const countOf = (tag) => usage.counts[tag] || 0;
const lastOf = (tag) => usage.last[tag] || 0;
const fmt = (n) => n.toLocaleString("zh-TW");

/* ================= 開機 ================= */

async function boot() {
  initMotion();
  try {
    const [lexicon, manifest] = await Promise.all([
      fetch(document.querySelector('link[rel="preload"][href^="lexicon.json"]')?.href || "lexicon.json").then((r) => r.json()),
      fetch(document.querySelector('link[rel="preload"][href^="cards/manifest.json"]')?.href || "cards/manifest.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    data = lexicon;
    lex = indexLexicon(data);
    lib = buildLibrary(data, { ratingBlocked });
    assets = createAssets(manifest);
  } catch (err) {
    $("book").replaceChildren(el("p", { class: "book-empty" }, "讀不到詞庫。請用 start-web6.bat 開，而不是直接點 HTML。", el("br"), String(err)));
    return;
  }
  rating = (S.loadSettings() || {}).rating || "general";
  // 第一次打開：從成品牆、晾紙繩補算（只做一次）。
  usage = seedUsage((t) => lib.byTag.has(t));
  if (!["desc", "asc"].includes(ui.order)) ui.order = "desc";

  renderRating();
  renderSort();
  renderUsedToggle();
  renderSuits();
  wireSearch();
  render({ animate: false, deal: true });
  renderSummary({ count: true });
  pingLoop();
  wireSound();
  watchOtherTabs();
  // 滑鼠停在牌上：跟墨池、疊印台同一張浮空放大卡，多一行用過幾次。
  attachPeek($("book-grid"), ".card[data-tag]", peekInfo);
  settleMotion();
}

/* ================= 頂欄 ================= */

function renderRating() {
  const box = $("rating");
  box.replaceChildren(
    ...["general", "sensitive", "explicit"].map((r) =>
      el(
        "button",
        {
          type: "button",
          role: "radio",
          "aria-checked": rating === r ? "true" : "false",
          dataset: { v: r },
          onclick: (e) => {
            if (rating === r) return;
            const focused = document.activeElement === e.currentTarget;
            rating = r;
            // 跟墨池同一個尺度：這裡換了，回墨池也是這一檔。
            S.saveSettings({ ...(S.loadSettings() || {}), rating: r });
            renderRating();
            const selected = box.querySelector('[aria-checked="true"]');
            if (focused) selected?.focus({ preventScroll: true });
            seat(selected);
            renderSuits();
            render();
            renderSummary();
          },
        },
        RATING_LABEL[r]
      )
    )
  );
}

function pingLoop() {
  watchLink((st) => {
    const p = $("ping");
    const changed = p.dataset.ok !== (st === "ok" ? "1" : "0") || p.dataset.link !== st;
    p.dataset.ok = st === "ok" ? "1" : "0";
    p.dataset.link = st;
    if (changed) p.querySelector("span").textContent = LINK_LABEL[st];
    if (changed) seat(p);
  });
}

function wireSound() {
  const snd = $("sound-btn");
  const sync = () => {
    snd.setAttribute("aria-pressed", sfx.on ? "true" : "false");
    const label = sfx.on ? "聲音：開（點一下關掉）" : "聲音：關（點一下打開）";
    snd.setAttribute("aria-label", label);
    snd.title = label;
    snd.innerHTML = sfx.on
      ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>`
      : `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9.5l5 5M22 9.5l-5 5"/></svg>`;
  };
  sync();
  snd.addEventListener("click", () => {
    sfx.on = !sfx.on;
    sync();
    if (sfx.on) sfx.deal(3);
  });
}

/* ================= 摘要：用過幾張、共幾次 ================= */

let sumShown = { used: 0, total: 0 };
function renderSummary({ count = false } = {}) {
  const pool = lib.cards.filter(visibleCard);
  const used = pool.filter((c) => countOf(c.tag) > 0).length;
  const total = pool.reduce((n, c) => n + countOf(c.tag), 0);
  const box = $("book-sum");
  const paint = (u, t) => {
    box.replaceChildren(
      el("b", { class: "book-sum-n" }, fmt(u)),
      el("span", {}, ` ／ ${fmt(pool.length)} 張用過`),
      el("span", { class: "book-sum-dot", "aria-hidden": "true" }, "・"),
      el("span", {}, "共 "),
      el("b", { class: "book-sum-n" }, fmt(t)),
      el("span", {}, " 次")
    );
  };
  const from = count ? { used: 0, total: 0 } : sumShown;
  sumShown = { used, total };
  if (reducedMotion() || (from.used === used && from.total === total)) return paint(used, total);
  // 數字從舊值數到新值（開頁時從 0）：用計時器不用 rAF，分頁在背景也會停在對的數字。
  const t0 = performance.now();
  const dur = count ? DUR.develop : DUR.long;
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  clearInterval(box._tick);
  box._tick = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / dur);
    const e = ease(k);
    paint(Math.round(from.used + (used - from.used) * e), Math.round(from.total + (total - from.total) * e));
    if (k >= 1) clearInterval(box._tick);
  }, 33);
}

/* ================= 工具列：花色、排序、只看用過的、找字 ================= */

function renderSuits() {
  const tabs = $("book-suits");
  const pool = lib.cards.filter(visibleCard);
  const usedIn = (s) => pool.filter((c) => (s === "all" || c.suit === s) && countOf(c.tag) > 0).length;
  tabs.replaceChildren(
    el("button", { class: "suit-tab pressable", type: "button", "aria-pressed": ui.suit === "all" ? "true" : "false", onclick: (e) => pickSuit("all", e.currentTarget) }, "全部"),
    ...CARD_SUITS.map((s) =>
      el(
        "button",
        {
          class: "suit-tab pressable",
          type: "button",
          style: `--suit: var(--suit-${s})`,
          "aria-pressed": ui.suit === s ? "true" : "false",
          title: `${CARD_SUIT_INFO[s].zh}：用過 ${usedIn(s)} 張`,
          onclick: (e) => pickSuit(s, e.currentTarget),
        },
        el("b", { "aria-hidden": "true" }, CARD_SUIT_INFO[s].glyph),
        CARD_SUIT_INFO[s].zh
      )
    )
  );
  renderGroups();
}

function pickSuit(s, from) {
  if (ui.suit === s) return;
  const focused = document.activeElement === from;
  ui.suit = s;
  ui.group = "";
  saveUi();
  renderSuits();
  const selected = $("book-suits").querySelector('[aria-pressed="true"]');
  if (focused) selected?.focus({ preventScroll: true });
  seat(selected);
  render();
}

function renderGroups() {
  const box = $("book-groups");
  if (ui.suit === "all") {
    box.hidden = true;
    return box.replaceChildren();
  }
  const runs = groupChips(lib.cards.filter((c) => c.suit === ui.suit && visibleCard(c)));
  if (ui.group && !runs.some((r) => r.items.some((i) => i.g === ui.group))) ui.group = "";
  box.hidden = runs.reduce((n, r) => n + r.items.length, 0) < 2;
  const chip = (i, inRun) =>
    el(
      "button",
      { class: "group-chip pressable", type: "button", "aria-pressed": ui.group === i.g ? "true" : "false", "aria-label": i.short === i.zh ? null : i.zh, onclick: (e) => pickGroup(i.g, e.currentTarget) },
      i.seal && !inRun ? el("b", { class: "chip-seal", "aria-hidden": "true" }, i.seal) : null,
      i.short
    );
  box.replaceChildren(
    el("button", { class: "group-chip pressable", type: "button", "aria-pressed": ui.group === "" ? "true" : "false", onclick: (e) => pickGroup("", e.currentTarget) }, "全部"),
    ...runs.map((r) =>
      r.fam
        ? el(
            "span",
            { class: "chip-run" },
            el("span", { class: "chip-fam", "aria-hidden": "true" }, r.seal ? el("b", { class: "chip-seal" }, r.seal) : null, r.fam),
            ...r.items.map((i) => chip(i, true))
          )
        : chip(r.items[0], false)
    )
  );
}

function pickGroup(g, from) {
  if (ui.group === g) return;
  ui.group = g;
  saveUi();
  renderGroups();
  const selected = [...$("book-groups").querySelectorAll(".group-chip")].find((b) => b.getAttribute("aria-pressed") === "true");
  if (from && document.activeElement === from) selected?.focus({ preventScroll: true });
  seat(selected);
  render();
}

function renderSort() {
  const box = $("book-sort");
  box.replaceChildren(
    ...["desc", "asc"].map((o) =>
      el(
        "button",
        {
          type: "button",
          role: "radio",
          "aria-checked": ui.order === o ? "true" : "false",
          onclick: (e) => {
            if (ui.order === o) return;
            const focused = document.activeElement === e.currentTarget;
            ui.order = o;
            saveUi();
            renderSort();
            const selected = box.querySelector('[aria-checked="true"]');
            if (focused) selected?.focus({ preventScroll: true });
            seat(selected);
            // 換排序：先回到頂端，讓「最多／最少」的那幾張在眼前排好。
            const top = $("book").getBoundingClientRect().top + scrollY - 8;
            if (scrollY > top) scrollTo({ top, behavior: "instant" });
            render({ shuffle: true });
          },
        },
        o === "desc" ? el("span", { class: "sort-arrow", "aria-hidden": "true" }, "↓") : el("span", { class: "sort-arrow", "aria-hidden": "true" }, "↑"),
        ORDER_ZH[o]
      )
    )
  );
}

function renderUsedToggle() {
  const b = $("book-used");
  b.setAttribute("aria-pressed", ui.usedOnly ? "true" : "false");
  b.onclick = () => {
    ui.usedOnly = !ui.usedOnly;
    saveUi();
    b.setAttribute("aria-pressed", ui.usedOnly ? "true" : "false");
    seat(b);
    render();
  };
}

function wireSearch() {
  const q = $("book-q");
  q.value = ui.query;
  let timer = 0;
  q.addEventListener("input", () => {
    clearTimeout(timer);
    // 打字時等一下下再排：每打一個字就整片滑一次太吵。
    timer = setTimeout(() => {
      ui.query = q.value.trim();
      render();
    }, 140);
  });
  q.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && q.value) {
      q.value = "";
      ui.query = "";
      render();
    } else if (e.key === "Enter") {
      const first = $("book-grid").querySelector(".card");
      if (first) first.click();
      else refuse(q);
    }
  });
  addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && !document.querySelector(".overlay")) {
      e.preventDefault();
      q.focus();
    }
  });
}

/* ================= 牌格 ================= */

function visibleCard(card) {
  return !ratingBlocked(card.item, rating);
}

function listNow() {
  const q = ui.query.toLowerCase();
  const order = new Map(lib.cards.map((c, i) => [c.tag, i]));
  const out = lib.cards.filter(
    (c) =>
      visibleCard(c) &&
      (ui.suit === "all" || c.suit === ui.suit) &&
      (!ui.group || c.group === ui.group) &&
      (!ui.usedOnly || countOf(c.tag) > 0) &&
      (!q || c.zh.toLowerCase().includes(q) || c.tag.includes(q))
  );
  // 次數一樣時：多到少看誰最近用過，少到多照字盒的順序（花色 → 細分類）。
  if (ui.order === "desc") out.sort((a, b) => countOf(b.tag) - countOf(a.tag) || lastOf(b.tag) - lastOf(a.tag) || order.get(a.tag) - order.get(b.tag));
  else out.sort((a, b) => countOf(a.tag) - countOf(b.tag) || order.get(a.tag) - order.get(b.tag));
  return out;
}

/** 一張牌的格子：牌＋底下的次數。名次（前三）、沒用過的樣子每次排完重上。 */
function cellOf(card) {
  let cell = cells.get(card.tag);
  if (!cell) {
    const node = cardNode(card, assets);
    node.addEventListener("click", () => openCard(card, node));
    const n = el("b", { class: "book-n" });
    const meta = el("span", { class: "book-meta" }, n, el("span", { class: "book-unit" }));
    cell = el("div", { class: "book-cell", role: "listitem", dataset: { tag: card.tag } }, node, meta);
    cells.set(card.tag, cell);
  }
  return cell;
}

function paintCell(cell, card, rank) {
  const c = countOf(card.tag);
  cell.dataset.unused = c ? "false" : "true";
  const n = cell.querySelector(".book-n");
  const unit = cell.querySelector(".book-unit");
  n.textContent = c ? fmt(c) : "—";
  unit.textContent = c ? "次" : "未使用";
  const old = cell.querySelector(".book-rank");
  if (rank) {
    if (!old || old.textContent !== String(rank)) {
      old?.remove();
      const seal = el("span", { class: "book-rank", dataset: { r: String(rank) }, "aria-label": `第 ${rank} 名` }, String(rank));
      cell.querySelector(".card").append(seal);
      cell._stampRank = true;
    }
  } else old?.remove();
  cell.querySelector(".card").setAttribute("aria-description", c ? `用過 ${c} 次${rank ? `，第 ${rank} 名` : ""}` : "還沒用過");
}

let more = null;
let observer = null;

/**
 * 依目前的篩選與排序畫牌。
 *   animate：還在畫面上的牌從舊位置滑過去（FLIP），新來的錯開浮上來。
 *   shuffle：換排序的那一下，連移動也錯開一點點，看得出「重新洗過」。
 *   deal：第一次畫（開頁）：交給開版動畫，不另外動。
 */
function render({ animate = true, shuffle = false, deal = false } = {}) {
  const grid = $("book-grid");
  const motion = animate && !reducedMotion();
  // 改之前：畫面上（含上下各一點）的牌在哪。
  const before = new Map();
  if (motion) {
    for (const cell of grid.querySelectorAll(".book-cell")) {
      const r = cell.getBoundingClientRect();
      if (r.bottom > -80 && r.top < innerHeight + 80) before.set(cell.dataset.tag, r);
    }
  }
  list = listNow();
  shown = Math.min(list.length, CHUNK);
  const frag = document.createDocumentFragment();
  list.slice(0, shown).forEach((card, i) => {
    const cell = cellOf(card);
    paintCell(cell, card, rankAt(card, i));
    frag.append(cell);
  });
  if (!list.length) frag.append(emptyNote());
  more = el("span", { class: "book-more", "aria-hidden": "true" });
  frag.append(more);
  grid.replaceChildren(frag);
  // 有沒有任何使用紀錄：有的話沒用過的牌才褪色；一筆都沒有就在上面放一行引導。
  const any = Object.values(usage.counts).some((n) => n > 0);
  grid.dataset.any = any ? "true" : "false";
  $("book-hint").hidden = any;
  watchMore();
  if (!motion) return;
  if (deal) return;
  let entering = 0;
  let moving = 0;
  for (const cell of grid.querySelectorAll(".book-cell")) {
    const r = cell.getBoundingClientRect();
    if (r.top > innerHeight + 40) break;
    if (r.bottom < -40) continue;
    const was = before.get(cell.dataset.tag);
    if (was) {
      const dx = was.left - r.left;
      const dy = was.top - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      // 走得越遠走得越久一點，但不拖：420～600ms。
      const dist = Math.hypot(dx, dy);
      cell.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: Math.min(DUR.long + dist * 0.15, 600), delay: shuffle ? Math.min(moving++, 16) * 12 : 0, easing: css(CURVE.travel), fill: "backwards" }
      );
    } else {
      cell.animate(
        [{ opacity: 0, transform: "translateY(14px) scale(0.96)" }, { opacity: 1, transform: "none" }],
        { duration: DUR.medium, delay: Math.min(entering++, 18) * 18, easing: css(CURVE.out), fill: "backwards" }
      );
    }
  }
  // 名次章新蓋上去的那一下：跟池子裡蓋章同一個手感。
  for (const cell of grid.querySelectorAll(".book-cell")) {
    if (!cell._stampRank) continue;
    cell._stampRank = false;
    const seal = cell.querySelector(".book-rank");
    seal?.animate(
      [{ transform: "scale(1.8) rotate(-18deg)", opacity: 0 }, { transform: "scale(0.92) rotate(-8deg)", opacity: 1, offset: 0.7 }, { transform: "rotate(-8deg)", opacity: 1 }],
      { duration: DUR.medium, delay: DUR.short, easing: css(CURVE.out), fill: "backwards" }
    );
  }
  if (shuffle && moving + entering > 3) sfx.deal(Math.min(6, 2 + Math.round((moving + entering) / 10)));
}

/** 前三名蓋章：只在「多到少」、而且真的用過的時候。看全部花色時是總名次，選了花色是花色裡的名次。 */
function rankAt(card, i) {
  return ui.order === "desc" && i < 3 && countOf(card.tag) > 0 ? i + 1 : 0;
}

function emptyNote() {
  const any = Object.keys(usage.counts).length;
  return el(
    "div",
    { class: "book-empty" },
    el("b", {}, ui.usedOnly && !any ? "還沒有使用紀錄" : "沒有符合的牌"),
    el(
      "span",
      {},
      ui.usedOnly && !any
        ? "去墨池抽幾張、或在疊印台付印一張，用到的牌就會記在這裡。"
        : "換個花色、清掉搜尋，或關掉「只看用過的」。"
    ),
    ui.usedOnly && !any ? el("a", { class: "btn btn-small", href: "./" }, "去墨池") : null
  );
}

function watchMore() {
  if (typeof IntersectionObserver !== "function") return;
  if (!observer) {
    observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) moreCells();
    }, { rootMargin: "600px" });
  }
  observer.disconnect();
  if (shown < list.length && more) observer.observe(more);
}

function moreCells() {
  if (shown >= list.length) return;
  const grid = $("book-grid");
  const next = list.slice(shown, shown + CHUNK);
  const frag = document.createDocumentFragment();
  next.forEach((card, k) => {
    const cell = cellOf(card);
    paintCell(cell, card, rankAt(card, shown + k));
    frag.append(cell);
  });
  shown += next.length;
  grid.insertBefore(frag, more);
  watchMore();
}

function peekInfo(node) {
  const card = lib.byTag.get(node.dataset.tag);
  if (!card) return null;
  const c = countOf(card.tag);
  const facts = cardFacts(card, lex, data).filter(([k]) => k !== "分級");
  facts.unshift(["用過", c ? `${fmt(c)} 次・最近 ${ago(lastOf(card.tag))}` : "還沒用過"]);
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

/* ================= 單張牌的詳情 ================= */

function rankIn(card, cards) {
  const c = countOf(card.tag);
  if (!c) return 0;
  return cards.filter((x) => countOf(x.tag) > c).length + 1;
}

function ago(ms) {
  if (!ms) return "還沒用過";
  const d = Date.now() - ms;
  const m = Math.round(d / 60000);
  if (m < 1) return "剛剛";
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小時前`;
  const days = Math.round(h / 24);
  if (days < 31) return `${days} 天前`;
  return new Date(ms).toLocaleDateString("zh-TW");
}

function openCard(card, srcNode) {
  // 翻開一張牌：跟墨池開詳情同一個聲音。
  sfx.tap?.();
  const c = countOf(card.tag);
  const mine = usage.mine[card.tag] || 0;
  const pool = lib.cards.filter(visibleCard);
  const all = rankIn(card, pool);
  const inSuit = rankIn(card, pool.filter((x) => x.suit === card.suit));
  const art = assets.art(card.tag);
  const big = el("b", { class: "book-big-n" }, c ? "0" : "—");
  const stats = el(
    "dl",
    { class: "book-stats" },
    el("dt", {}, "名次"),
    el("dd", {}, c ? `全部第 ${all} 名・${CARD_SUIT_INFO[card.suit].zh}第 ${inSuit} 名` : "還沒上榜"),
    el("dt", {}, "你親手放"),
    el("dd", {}, `${mine} 次`),
    el("dt", {}, "引擎補的"),
    el("dd", {}, `${Math.max(0, c - mine)} 次`),
    el("dt", {}, "最近一次"),
    el("dd", {}, ago(usage.last[card.tag] || 0))
  );
  const share = c && sumShown.total ? Math.min(1, c / Math.max(...pool.map((x) => countOf(x.tag)), 1)) : 0;
  const sheet = openSheet(
    card.zh,
    el(
      "div",
      { class: "detail book-detail" },
      art ? el("div", { class: "detail-art" }, el("img", { src: art, alt: card.zh })) : cardNode(card, assets, { tagName: "div" }),
      el(
        "div",
        {},
        el("p", { class: "tag-en" }, card.tag),
        el(
          "div",
          { class: "book-big", style: `--share: ${share}` },
          big,
          el("span", {}, c ? "張圖用過它" : "還沒進過任何一張圖"),
          // 跟用最多的那張比的長條：一眼看出它算常用還是冷門。
          c ? el("i", { class: "book-bar-fill", "aria-hidden": "true" }) : null
        ),
        stats,
        el("dl", {}, cardFacts(card, lex, data).map(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]))
      )
    ),
    {
      foot: [
        el(
          "button",
          {
            class: "btn btn-primary",
            type: "button",
            onclick: (e) => {
              // 交接便條：墨池下次打開時把它放進合成池（30 分鐘內有效，見 store.js）。
              S.handOffPool([card.tag]);
              sfx.tap?.();
              e.currentTarget.textContent = "帶過去了…";
              setTimeout(() => (location.href = "./"), reducedMotion() ? 0 : DUR.short);
            },
          },
          "帶去墨池合成池"
        ),
      ],
    }
  );
  flyToDetail(srcNode, sheet.sheet || document.querySelector(".overlay:last-of-type .sheet"));
  if (c) countUp(big, c);
}

/** 大數字從 0 數上去（牌飛進來的同時）。 */
function countUp(node, to) {
  if (reducedMotion()) return void (node.textContent = fmt(to));
  const t0 = performance.now() + DUR.short;
  const dur = Math.min(DUR.story, 300 + to * 40);
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  const tick = setInterval(() => {
    const k = Math.max(0, Math.min(1, (performance.now() - t0) / dur));
    node.textContent = fmt(Math.round(to * ease(k)));
    if (k >= 1) {
      clearInterval(tick);
      node.animate([{ transform: "scale(1.12)" }, { transform: "none" }], { duration: DUR.short, easing: css(CURVE.settle) });
    }
  }, 33);
}

/** 牌從格子飛進詳情的大圖（跟墨池的詳情同一個手法：落點放複製品，FLIP 縮放過去）。 */
function flyToDetail(src, sheetEl) {
  if (!src || !sheetEl || reducedMotion()) return;
  const dst = sheetEl.querySelector(".detail-art, .detail > .card");
  const from = (src.querySelector(".card-art") || src).getBoundingClientRect();
  if (!dst || !from.width || from.bottom < 0 || from.top > innerHeight) return;
  const anims = sheetEl.getAnimations();
  for (const a of anims) a.currentTime = a.effect.getComputedTiming().endTime;
  const to = dst.getBoundingClientRect();
  for (const a of anims) a.currentTime = 0;
  if (!to.width) return;
  const f = (src.querySelector(".card-art") || src).cloneNode(true);
  Object.assign(f.style, { position: "fixed", left: to.left + "px", top: to.top + "px", width: to.width + "px", height: to.height + "px", margin: "0", zIndex: "200", pointerEvents: "none", overflow: "hidden", borderRadius: "6px", transformOrigin: "0 0", willChange: "transform" });
  document.body.append(f);
  dst.style.visibility = "hidden";
  const anim = f.animate(
    [
      { transform: `translate(${(from.left - to.left).toFixed(1)}px, ${(from.top - to.top).toFixed(1)}px) scale(${(from.width / to.width).toFixed(4)}, ${(from.height / to.height).toFixed(4)})` },
      { transform: "none" },
    ],
    { duration: DUR.long, easing: css(CURVE.out), fill: "forwards" }
  );
  const land = () => {
    f.remove();
    dst.style.visibility = "";
  };
  anim.onfinish = land;
  setTimeout(land, 700);
}

/* ================= 別的分頁抽完牌 ================= */

function watchOtherTabs() {
  addEventListener("storage", (e) => {
    if (e.key !== USAGE_KEY) return;
    const before = usage;
    usage = loadUsage();
    // 數字原地跳一下；排序不自己動（牌在手底下跑掉很煩），給一顆「重新排序」。
    let changed = 0;
    for (const cell of $("book-grid").querySelectorAll(".book-cell")) {
      const t = cell.dataset.tag;
      if ((before.counts[t] || 0) === countOf(t)) continue;
      changed += 1;
      const card = lib.byTag.get(t);
      paintCell(cell, card, rankAt(card, list.indexOf(card)));
      if (!reducedMotion()) {
        cell.querySelector(".book-meta").animate(
          [{ transform: "translateY(-6px) scale(1.25)", color: "var(--color-accent)" }, { transform: "none" }],
          { duration: DUR.long, easing: css(CURVE.settle) }
        );
      }
    }
    renderSummary();
    renderSuits();
    // 提示算的是全部變了的牌（不只畫面上那幾張）。
    const bumped = Object.keys(usage.counts).filter((t) => (before.counts[t] || 0) !== countOf(t)).length;
    if (bumped) {
      toast(`剛剛又記了 ${bumped} 張牌的使用次數`, { action: { label: "重新排序", run: () => render({ shuffle: true }) } });
    }
    void changed;
  });
}

boot();
