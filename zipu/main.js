/**
 * 字鋪：進入點。畫面路由、選牌、付印、換字、結帳、逛店、存檔。
 *
 * 規則在 rules.js / run.js，這裡只把狀態畫出來、把玩家的手勢翻成 run.js 的呼叫。
 * 每個會改狀態的動作結束後都存檔 —— 重新整理不會掉局。
 */
import {
  ACT_PLACE,
  NEEDS_CONTEXT,
  CTX_PULLS_ACC,
  CTX_PULLS_GEAR,
  indexLexicon,
  contradictions,
} from "./engine.js";
import { ratingBlocked } from "./rules/rating.js";
import { SPORT_PRESETS, SPORT_NEUTRAL_GEAR } from "./sports.js";
import { buildWorld, SUIT_INFO, SUITS, ERA_ZH } from "./pool.js";
import { HAND_TYPE, HAND_TYPES, typeValue, slotsOf } from "./rules.js";
import * as R from "./run.js";
import {
  JOKER, MATERIAL, TYPEFACE, VOUCHER, PACK, DECKS, DECK, FINAL_ANTE, BLINDS, RARITY_ZH,
} from "./content.js";
import * as S from "./store.js";
import {
  sfx, sleep, setSound, setSpeed, setHurry, pop, bump, shake, flipFrom, dealIn, fadeAway, countTo, fmt, fmtMult,
} from "./fx.js";
import {
  el, iconButton, createAssets, cardNode, setFlag, toolNode, portraitNode, slipNode, openSheet, anyOverlay, toast,
  attachTip, hideTip, cardFacts, cardTip, ICONS,
} from "./ui.js";
import { createPrinter, PRINT_STATUS_ZH, comfyOnline } from "./print.js";
import { mountSeedControl } from "./seed-control.js";
import { playScoring } from "./stage.js";

const app = document.getElementById("app");
const screen = document.getElementById("screen");

let world = null;
let assets = null;
let run = null;
let settings = S.loadSettings();
let printer = null;
let comfyUp = null;

/** 一局裡的畫面狀態（不存檔）。 */
const ui = {
  selected: [],
  busy: false,
  sort: "suit",
  T: null, // 工作台的節點
  cashoutSheet: null,
};

/* ================= 開機 ================= */

async function fetchJSON(url, fallback) {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

async function boot() {
  setSound(settings.sound);
  setSpeed(settings.fast);
  screen.replaceChildren(el("p", { class: "stage-hint", style: "padding-top:40dvh" }, "開鋪中……"));
  try {
    const [data, tokens, cardMan, artMan] = await Promise.all([
      fetchJSON("lexicon.json"),
      fetchJSON("token_counts.json", { counts: {} }),
      fetchJSON("cards/manifest.json", {}),
      fetchJSON("art/manifest.json", {}),
    ]);
    world = buildWorld(data, {
      ratingBlocked,
      tokenCounts: tokens.counts || {},
      ACT_PLACE,
      NEEDS_CONTEXT,
      CTX_PULLS_ACC,
      CTX_PULLS_GEAR,
      SPORT_PRESETS,
      SPORT_NEUTRAL_GEAR,
      indexLexicon,
      contradictions,
    });
    assets = createAssets(cardMan, artMan);
  } catch (err) {
    screen.replaceChildren(
      el("section", { class: "end-screen" }, el("h2", {}, "字盒打不開"), el("p", { class: "lede" }, "讀不到詞庫（lexicon.json）。確認是用 start-zipu.bat 開的，而不是直接點 HTML 檔。"), el("p", { class: "tag-en" }, String(err)))
    );
    return;
  }

  const saved = S.loadRun();
  if (saved && saved.deck?.every((c) => world.byCard.has(c.tag))) run = saved;
  // 上次關掉時正在印的那張，連線已經斷了：放回佇列重印。
  if (run) for (const p of run.prints) if (p.status === "printing") p.status = "queued";

  printer = createPrinter({
    getRun: () => run,
    enabled: () => settings.autoPrint,
    onChange: (p) => {
      refreshPrintViews(p);
      S.saveRun(run);
    },
    onDone: (p) => {
      S.addToGallery(p, run?.seed);
      const rec = S.loadRecords();
      rec.prints += 1;
      S.saveRecords(rec);
      S.saveRun(run);
      refreshPrintViews(p);
    },
  });
  if (run) printer.kick();
  comfyOnline().then((ok) => {
    comfyUp = ok;
    if (app.dataset.screen === "title") showTitle();
  });

  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", () => {
    if (ui.T) {
      layoutHand();
      sizeStage();
    }
  });
  showTitle();
}

function setScreen(name, bg) {
  hideTip();
  app.dataset.screen = name;
  const src = bg ? assets.extra(bg) : null;
  app.style.setProperty("--bg-art", src ? `url("${src}")` : "none");
  if (name !== "round") ui.T = null;
  window.scrollTo(0, 0);
}

function save() {
  if (run) S.saveRun(run);
}

/* ================= 招牌 ================= */

function showTitle() {
  setScreen("title", "bg-street");
  const rec = S.loadRecords();
  const resumable = run && run.phase !== "over";
  const art = assets.count();
  screen.replaceChildren(
    el(
      "section",
      { class: "title-screen" },
      el(
        "div",
        { class: "signboard enter" },
        el("h1", { class: "signboard-plank" }, "字鋪"),
        el(
          "div",
          { class: "signboard-side" },
          el("span", { class: "seal", "aria-hidden": "true" }, "夜"),
          el("p", {}, "深夜的活字鋪。客人上門下委託，你從字盒揀字、排進手盒、付印。"),
          el("p", {}, "每一單成交，那一版字就真的印成一張畫。")
        )
      ),
      el(
        "div",
        { class: "title-actions enter", style: "--i:2" },
        resumable
          ? el("button", { class: "btn btn-primary", type: "button", onclick: resume }, `續局・第 ${run.ante} 章`)
          : null,
        el("button", { class: resumable ? "btn" : "btn btn-primary", type: "button", onclick: showPicker }, "開新的一局"),
        el("button", { class: "btn btn-ghost", type: "button", onclick: () => showGallery() }, "作品牆"),
        el("button", { class: "btn btn-ghost", type: "button", onclick: showHowTo }, "怎麼玩")
      ),
      rec.runs
        ? el(
            "p",
            { class: "records enter", style: "--i:3" },
            el("span", {}, "開過 ", el("b", {}, rec.runs), " 局"),
            el("span", {}, "最遠 ", el("b", {}, "第 " + rec.bestAnte + " 章")),
            el("span", {}, "最高一版 ", el("b", {}, fmt(rec.bestHand)), " 分"),
            el("span", {}, "印過 ", el("b", {}, rec.prints), " 張"),
            rec.wins ? el("span", {}, "金字招牌 ", el("b", {}, rec.wins), " 塊") : null
          )
        : null,
      recentPrints(),
      el(
        "p",
        { class: "comfy-note enter", style: "--i:4" },
        comfyUp === false
          ? "印刷機（ComfyUI）沒開：照樣能玩，成交的作品會排隊，等它開了再印。"
          : comfyUp
            ? "印刷機（ComfyUI）已就位。每一單成交都會印出一張作品。"
            : "",
        art.cards < 100 ? el("span", {}, el("br"), "卡面插畫還沒烘焙完，沒有圖的牌先用鉛字版。") : null
      ),
      // 印作品用的種子：隨機，或固定一顆（每一單都用同一顆雜訊）。
      el("div", { class: "seed-slot enter", style: "--i:5" }, seedNode || (seedNode = mountSeedControl(null, { fixedNote: "每一單都用這顆種子印；委託和牌照樣隨機", randomNote: "每一單隨機。填一個數字就固定下來" })))
    )
  );
}

let seedNode = null;

/** 招牌底下掛最近印好的幾張：一打開就看得到自己攢下來的作品。 */
function recentPrints() {
  const done = S.loadGallery().filter((p) => p.image).slice(0, 6);
  if (!done.length) return null;
  return el(
    "div",
    { class: "title-wall enter", style: "--i:3", "aria-label": "最近印的作品" },
    done.map((p, i) =>
      el(
        "button",
        { class: "title-sheet", type: "button", style: `--r:${(i % 2 ? 1 : -1) * (1 + (i % 3))}deg`, onclick: () => showPrint(p), "aria-label": `${p.who}的作品` },
        el("img", { src: p.image, alt: "", loading: "lazy" })
      )
    )
  );
}

function resume() {
  if (!run) return;
  routeByPhase();
}

function routeByPhase() {
  switch (run.phase) {
    case "select":
      return showSelect();
    case "round":
      return showRound();
    case "cashout":
      showRound();
      return showCashout();
    case "shop":
      return showShop();
    case "won":
      return showWon();
    default:
      return showOver();
  }
}

/* ================= 挑字盒 ================= */

function showPicker() {
  setScreen("picker", "bg-table");
  let chosen = "daily";
  const choices = DECKS.map((d) => {
    const sample = SUITS.map((s) => d.tags.find((t) => world.byCard.get(t)?.suit === s && world.byCard.get(t)?.art)).filter(Boolean);
    const btn = el(
      "button",
      { class: "deck-choice", type: "button", "aria-pressed": d.id === chosen ? "true" : "false", onclick: () => pick(d.id) },
      el("h3", {}, d.zh),
      el("div", { class: "deck-fan", "aria-hidden": "true" }, sample.map((t) => cardNode(world.byCard.get(t), null, assets, { static: true }))),
      el("p", {}, d.desc)
    );
    btn.dataset.deck = d.id;
    return btn;
  });
  function pick(id) {
    chosen = id;
    sfx.clack();
    for (const c of choices) c.setAttribute("aria-pressed", c.dataset.deck === id ? "true" : "false");
  }
  const daily = el("input", { type: "checkbox", id: "daily-seed" });
  const today = new Date();
  const ymd = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  screen.replaceChildren(
    el(
      "section",
      { class: "picker" },
      el("h2", { class: "enter" }, "挑一盒字開鋪"),
      el("div", { class: "deck-choices enter", style: "--i:1" }, choices),
      el(
        "label",
        { class: "daily-toggle enter", for: "daily-seed", style: "--i:2" },
        daily,
        el("span", {}, `今日字盒（${ymd}）：今天每一局的委託、商店、抽牌順序都一樣，可以一直重打同一局`)
      ),
      el(
        "div",
        { class: "picker-actions enter", style: "--i:2" },
        el("button", { class: "btn btn-ghost", type: "button", onclick: showTitle }, "回招牌"),
        el("button", { class: "btn btn-primary", type: "button", onclick: () => newGame(chosen, daily.checked ? (Math.imul(ymd, 2654435761) >>> 0) : undefined) }, "開鋪")
      )
    )
  );
}

function newGame(deck, seed) {
  printer.stop();
  run = R.newRun(world, seed === undefined ? { deck } : { deck, seed });
  const rec = S.loadRecords();
  rec.runs += 1;
  S.saveRecords(rec);
  save();
  sfx.stamp();
  showSelect();
}

/* ================= 接單 ================= */

function showSelect() {
  setScreen("select", "bg-shop");
  const blinds = R.blindsOf(run);
  const last = run.ante === FINAL_ANTE && !run.endless;
  screen.replaceChildren(
    el(
      "section",
      { class: "select-screen" },
      el(
        "header",
        { class: "chapter-head enter" },
        el(
          "div",
          {},
          el("h2", {}, `第 ${run.ante} 章${last ? "・最後一章" : run.endless ? "・加班" : ""}`),
          el("p", {}, last ? "東家親自來了。撐過這一章，字鋪就掛上金字招牌。" : "三張委託單，一張一張接。第三位是貴客，會出難題。")
        ),
        el("div", { class: "ledger-menu" }, el("span", { class: "money", style: "align-self:center;font-size:1.25rem" }, run.money), ...menuButtons())
      ),
      ownedShelf(),
      el(
        "div",
        { class: "slips" },
        blinds.map((b, i) => {
          const s = slipNode(b, assets, { onAccept: () => begin() });
          s.classList.add("enter");
          s.style.setProperty("--i", String(i + 2));
          return s;
        })
      )
    )
  );
  screen.querySelector(".slip[data-state='now'] .btn")?.focus({ preventScroll: true });
}

function begin() {
  R.startRound(world, run);
  ui.selected = [];
  save();
  sfx.clack();
  showRound({ dealAll: true });
  // 第一次坐上工作台：攤開規則一次。之後想看再從帳房按「怎麼玩」。
  if (!settings.seenHowTo) {
    settings.seenHowTo = true;
    S.saveSettings(settings);
    setTimeout(showHowTo, 700);
  }
}

function menuButtons() {
  return [
    iconButton("types", "牌型表", showTypes),
    iconButton("deck", "字盒", showDeck),
    iconButton("gallery", "作品牆", () => showGallery()),
    iconButton("menu", "選單", showMenu),
  ];
}

function ownedShelf() {
  if (!run.jokers.length && !run.consumables.length) return null;
  return el(
    "div",
    { class: "shop-owned enter", style: "--i:1" },
    el("div", { class: "shop-owned-group" }, el("span", {}, `道具 ${run.jokers.length}/${run.jokerSlots}`), el("div", { class: "shop-owned-row" }, jokerNodes({ where: "select" }))),
    run.consumables.length
      ? el("div", { class: "shop-owned-group" }, el("span", {}, `印材 ${run.consumables.length}/${run.consumableSlots}`), el("div", { class: "shop-owned-row" }, matNodes({ where: "select" })))
      : null
  );
}

/* ================= 工作台 ================= */

function showRound({ dealAll = false } = {}) {
  setScreen("round", "bg-shop");
  const b = R.currentBlind(run);
  const T = {};
  ui.T = T;
  ui.selected = ui.selected.filter((id) => run.round?.hand.includes(id));

  T.scoreNow = el("span", { class: "num score-now" }, fmt(run.round.score));
  T.progress = el("i");
  T.readout = makeReadout();
  T.mini = makeMiniReadout();
  T.counters = {
    hands: el("span", { class: "num" }, run.round.hands),
    discards: el("span", { class: "num" }, run.round.discards),
    money: el("span", { class: "num money" }, run.money),
  };
  T.request = b.request
    ? el("p", { class: "ledger-request", dataset: { done: run.round.requestDone ? "true" : "false" } }, `附加：${b.request.text}（+3 兩）`)
    : null;

  const ledger = el(
    "section",
    { class: "ledger", "aria-label": "帳房" },
    el(
      "div",
      { class: "ledger-top" },
      portraitNode(b.who, assets),
      el("div", { class: "ledger-who" }, el("h2", {}, b.who.zh), el("p", {}, `第 ${run.ante} 章・${b.kind}`)),
      el("div", { class: "ledger-menu" }, iconButton("menu", "選單", showMenu))
    ),
    b.rules.length ? el("p", { class: "ledger-rules" }, b.rules.map((r) => r.rule).join("；")) : null,
    T.request,
    el(
      "div",
      { class: "score-card" },
      el("div", { class: "score-row" }, el("span", { class: "label" }, "本單"), T.scoreNow),
      el("div", { class: "score-row" }, el("span", { class: "label" }, "至少"), el("span", { class: "num score-target" }, fmt(run.round.target))),
      el("div", { class: "progress", "aria-hidden": "true" }, T.progress)
    ),
    T.readout.root,
    el(
      "div",
      { class: "counters" },
      el("div", { class: "counter", dataset: { kind: "hands" } }, el("span", { class: "label" }, "付印"), T.counters.hands),
      el("div", { class: "counter", dataset: { kind: "discards" } }, el("span", { class: "label" }, "換字"), T.counters.discards),
      el("div", { class: "counter" }, el("span", { class: "label" }, "兩"), T.counters.money)
    ),
    el(
      "div",
      { class: "ledger-links" },
      el("button", { class: "btn btn-small btn-ghost", type: "button", onclick: showTypes }, "牌型表"),
      el("button", { class: "btn btn-small btn-ghost", type: "button", onclick: showDeck }, "字盒"),
      el("button", { class: "btn btn-small btn-ghost", type: "button", onclick: showHowTo }, "怎麼玩")
    )
  );

  T.tools = el("div", { class: "tools-row", "aria-label": "道具" });
  T.mats = el("div", { class: "mats-row", "aria-label": "印材" });
  T.rack = el("button", { class: "rack", type: "button", "aria-label": "晾紙架：這一局印的作品", onclick: () => showGallery(true) });
  const shelf = el("section", { class: "shelf" }, el("span", { class: "shelf-label", "aria-hidden": "true" }, "道具"), T.tools, T.mats, T.rack);

  T.threads = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  T.threads.setAttribute("class", "threads");
  T.threads.setAttribute("aria-hidden", "true");
  T.hint = el(
    "p",
    { class: "stage-hint" },
    "點牌排進手盒。",
    el("b", {}, "同一類只能一張"),
    "（兩種髮色會撞字），",
    el("b", {}, "四種花色湊齊"),
    "是全版，東西配得上地方就有",
    el("b", {}, "呼應"),
    "。"
  );
  T.stage = el("div", { class: "stage", "aria-live": "polite" }, T.hint);
  T.rail = el("div", { class: "stick-rail", "aria-hidden": "true" });
  T.railLabel = el("span", { class: "stick-label" });
  T.stick = el("div", { class: "stick" }, T.rail, T.railLabel);
  const bench = el("section", { class: "bench", "aria-label": "排版台" }, el("div", { class: "stage-wrap" }, T.threads, T.stage), T.stick);

  T.hand = el("div", { class: "hand", role: "group", "aria-label": "手牌" });
  T.playBtn = el("button", { class: "btn btn-primary", type: "button", onclick: onPlay }, "付印", el("span", { class: "count" }, ""));
  T.discardBtn = el("button", { class: "btn", type: "button", onclick: onDiscard }, "換字", el("span", { class: "count" }, ""));
  T.sortBtns = ["suit", "slots"].map((k) =>
    el("button", { type: "button", "aria-pressed": ui.sort === k ? "true" : "false", onclick: () => doSort(k) }, k === "suit" ? "花色" : "格數")
  );
  T.deckCount = el("button", { class: "deck-count", type: "button", onclick: showDeck, "aria-label": "字盒" }, el("b", {}, ""), "字盒");
  const handZone = el(
    "section",
    { class: "hand-zone" },
    T.mini.root,
    T.hand,
    el("div", { class: "actions" }, el("div", { class: "sorter", role: "group", "aria-label": "排序" }, T.sortBtns), T.discardBtn, T.playBtn, T.deckCount)
  );

  T.cards = new Map();
  screen.replaceChildren(el("div", { class: "table" }, ledger, shelf, bench, handZone));
  renderShelf();
  renderRack();
  renderHand({ animate: dealAll ? "all" : "none" });
  renderLedger();
  renderSelection();
  if (dealAll) sfx.deal();
}

function makeReadout() {
  const type = el("span", {}, "—");
  const lv = el("span", { class: "lv" });
  const chips = el("span", { class: "chip-box" }, "0");
  const mult = el("span", { class: "mult-box" }, "0");
  const hint = el("p", { class: "readout-hint" });
  const total = el("p", { class: "readout-total", "aria-live": "polite" });
  const root = el(
    "div",
    { class: "readout" },
    el("p", { class: "readout-type" }, type, lv),
    el("div", { class: "readout-math" }, chips, el("span", { class: "times" }, "×"), mult),
    hint,
    total
  );
  return { root, type, lv, chips, mult, hint, total };
}

function makeMiniReadout() {
  const type = el("span", { class: "name" }, "");
  const chips = el("span", { class: "chip-box" }, "0");
  const mult = el("span", { class: "mult-box" }, "0");
  const total = el("span", { class: "num", style: "color:var(--color-brass)" });
  const root = el("div", { class: "mini-readout", "aria-hidden": "true" }, type, chips, el("span", { class: "times" }, "×"), mult, total);
  return { root, type, chips, mult, total };
}

function renderLedger() {
  const T = ui.T;
  if (!T || !run.round) return;
  T.scoreNow.textContent = fmt(run.round.score);
  T.progress.style.setProperty("--p", String(Math.min(1, run.round.score / run.round.target)));
  T.counters.hands.textContent = run.round.hands;
  T.counters.discards.textContent = run.round.discards;
  T.counters.money.textContent = run.money;
  T.playBtn.querySelector(".count").textContent = run.round.hands;
  T.discardBtn.querySelector(".count").textContent = run.round.discards;
  T.deckCount.querySelector("b").textContent = `${run.round.draw.length}/${run.deck.length}`;
  if (T.request) T.request.dataset.done = run.round.requestDone ? "true" : "false";
}

function renderShelf() {
  const T = ui.T;
  if (!T) return;
  T.jokerNodes = jokerNodes({ where: "round" });
  const empties = Math.max(0, run.jokerSlots - run.jokers.length);
  T.tools.replaceChildren(...T.jokerNodes, ...Array.from({ length: empties }, () => el("span", { class: "tool-empty", "aria-hidden": "true", style: "--tool-w:var(--empty-w,58px)" })));
  T.mats.replaceChildren(...matNodes({ where: "round" }));
}

function jokerNodes({ where }) {
  return run.jokers.map((j, i) => {
    const def = JOKER[j.id];
    const note = def.note ? def.note(j) : "";
    const node = toolNode("joker", def, assets, { note: note.replace("目前 ", "") });
    node.addEventListener("click", () => showJoker(i, where));
    attachTip(node, () => el("div", {}, el("h4", {}, def.zh, el("span", { class: "tag-en" }, RARITY_ZH[def.rarity])), el("p", {}, def.desc), note ? el("p", { class: "meta" }, note) : null));
    return node;
  });
}

function matNodes({ where }) {
  return run.consumables.map((c, i) => {
    const def = MATERIAL[c.id];
    const node = toolNode("material", def, assets);
    node.addEventListener("click", () => showMaterial(i, where));
    attachTip(node, () => el("div", {}, el("h4", {}, def.zh), el("p", {}, def.desc)));
    return node;
  });
}

function renderRack() {
  const T = ui.T;
  if (!T) return;
  const recent = run.prints.slice(-4);
  T.rack.hidden = !recent.length;
  T.rack.replaceChildren(
    ...recent.map((p, i) => {
      const src = p.status === "done" ? p.image : printer.preview(p.id);
      return el("span", { class: "rack-sheet", dataset: { status: p.status, id: p.id }, style: `--r:${(i % 2 ? 2 : -2) + i}deg` }, src ? el("img", { src, alt: "" }) : null);
    })
  );
}

function refreshPrintViews(p) {
  if (ui.T) renderRack();
  if (ui.cashoutSheet && ui.cashoutSheet.printId === p.id) ui.cashoutSheet.update();
  const shopLast = document.querySelector(".shop-last-print");
  if (shopLast && shopLast.dataset.printId === p.id) shopLast.replaceChildren(printFrame(p));
}

/* ---------- 手牌 ---------- */

function cardOf(id) {
  const inst = R.cardById(run, id);
  return inst ? world.byCard.get(inst.tag) : null;
}

function renderHand({ animate = "none" } = {}) {
  const T = ui.T;
  const before = new Set(T.cards.keys());
  const keep = new Map();
  const nodes = [];
  let fresh = 0;
  for (const id of run.round.hand) {
    let node = T.cards.get(id);
    const inst = R.cardById(run, id);
    const card = world.byCard.get(inst.tag);
    if (!node || node.dataset.tag !== inst.tag || node.dataset.enh !== (inst.enh || "")) {
      node = cardNode(card, inst, assets);
      wireCard(node, id);
    }
    keep.set(id, node);
    nodes.push(node);
    if (animate === "all" || (animate === "new" && !before.has(id))) dealIn(node, fresh++);
  }
  T.cards = keep;
  T.hand.replaceChildren(...nodes);
  layoutHand();
}

function wireCard(node, id) {
  let pressTimer = null;
  let longPressed = false;
  node.addEventListener("click", (e) => {
    if (longPressed) {
      longPressed = false;
      e.preventDefault();
      return;
    }
    toggleCard(id);
  });
  node.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showCardDetail(id);
  });
  node.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    longPressed = false;
    pressTimer = setTimeout(() => {
      longPressed = true;
      showCardDetail(id);
    }, 480);
  });
  const cancel = () => clearTimeout(pressTimer);
  node.addEventListener("pointerup", cancel);
  node.addEventListener("pointercancel", cancel);
  node.addEventListener("pointerleave", cancel);
  attachTip(node, () => {
    const inst = R.cardById(run, id);
    return inst ? cardTip(world, world.byCard.get(inst.tag), inst) : null;
  });
}

/** 手牌寬度：放得下就並排，放不下就像撲克牌一樣疊起來，只露出左邊的書脊。 */
function layoutHand() {
  const T = ui.T;
  if (!T) return;
  const n = T.hand.children.length;
  const W = T.hand.clientWidth || window.innerWidth;
  const wide = window.innerWidth >= 960;
  const tablet = !wide && window.innerWidth >= 600;
  const tallLimit = Math.max(64, (window.innerHeight * (wide ? 0.24 : 0.2)) / 1.462);
  const cardW = Math.round(Math.max(60, Math.min(wide ? 124 : tablet ? 118 : 96, W / (wide ? 6.4 : 4.7), tallLimit)));
  const need = n * cardW;
  const overlap = n > 1 && need > W ? Math.ceil((need - W) / (n - 1)) + 2 : n > 1 ? -Math.min(8, (W - need) / (n - 1)) : 0;
  T.hand.style.setProperty("--card-w", cardW + "px");
  T.hand.style.setProperty("--overlap", overlap + "px");
  [...T.hand.children].forEach((node, i) => {
    const mid = (n - 1) / 2;
    node.style.setProperty("--tilt", `${((i - mid) * (wide ? 1.1 : 1.6)).toFixed(2)}deg`);
    node.style.zIndex = String(i + 1);
  });
  const empties = T.tools.querySelectorAll(".tool-empty");
  empties.forEach((e) => e.style.setProperty("--empty-w", wide ? "86px" : "58px"));
}

function toggleCard(id) {
  if (ui.busy || run.phase !== "round") return;
  const i = ui.selected.indexOf(id);
  if (i >= 0) {
    ui.selected.splice(i, 1);
    sfx.deal();
  } else {
    const next = [...ui.selected, id];
    const slots = next.reduce((s, x) => s + (cardOf(x)?.slots || 1), 0);
    if (slots > run.round.capacity) {
      shake(ui.T.stick);
      sfx.error();
      toast(`手盒只有 ${run.round.capacity} 格，放不下了`);
      return;
    }
    ui.selected = next;
    sfx.clack();
  }
  renderSelection();
}

function renderSelection() {
  const T = ui.T;
  if (!T || !run.round) return;
  const sel = ui.selected;
  for (const [id, node] of T.cards) {
    node.setAttribute("aria-pressed", sel.includes(id) ? "true" : "false");
    setFlag(node, null);
    node.dataset.debuff = "false";
  }
  // 貴客擋掉的牌，沒選也看得出來
  const pv = sel.length ? R.preview(world, run, sel) : null;
  const all = R.preview(world, run, run.round.hand);
  for (const it of all.ev.items) {
    if (it.status === "debuff") {
      const node = T.cards.get(it.inst.id);
      if (node) {
        node.dataset.debuff = "true";
        setFlag(node, "debuff", "不計分");
      }
    }
  }
  if (pv) {
    for (const it of pv.ev.items) {
      const node = T.cards.get(it.inst.id);
      if (!node) continue;
      if (it.status === "clash") setFlag(node, "clash", "撞字");
      else if (it.status === "era") setFlag(node, "era", "不合時代");
    }
    // 還沒選的牌裡，跟已選的字有呼應的，標出來：玩家不用背組合，看得到就學得會。
    const chosen = sel.map((id) => cardOf(id)?.tag).filter(Boolean);
    for (const [id, node] of T.cards) {
      if (sel.includes(id) || node.dataset.debuff === "true") continue;
      const tag = cardOf(id)?.tag;
      const mine = tag && world.pairs.get(tag);
      if (mine && chosen.some((t) => mine.has(t))) setFlag(node, "pair", "呼應");
    }
  }

  // 手盒的格子
  const cap = run.round.capacity;
  const cells = [];
  for (const id of sel) {
    const c = cardOf(id);
    for (let k = 0; k < (c?.slots || 1); k++) cells.push(c?.suit || "");
  }
  T.rail.replaceChildren(...Array.from({ length: cap }, (_, k) => el("i", { dataset: { suit: cells[k] || "" } })));
  T.railLabel.textContent = `手盒 ${cells.length}/${cap} 格`;
  T.stick.dataset.full = cells.length >= cap ? "true" : "false";

  // 牌型預覽：只給底數，實際分數付印了才知道
  const views = [T.readout, T.mini];
  if (!pv) {
    views.forEach((v) => {
      v.type.textContent = "—";
      if (v.lv) v.lv.textContent = "";
      v.chips.textContent = "0";
      v.mult.textContent = "0";
      if (v.total) v.total.textContent = "";
    });
    T.readout.hint.textContent = "選牌排進手盒";
  } else {
    const lvl = run.levels[pv.ev.type] || 1;
    const base = typeValue(pv.ev.type, lvl);
    views.forEach((v) => {
      v.type.textContent = HAND_TYPE[pv.ev.type].zh;
      if (v.lv) v.lv.textContent = "Lv " + lvl;
      v.chips.textContent = fmt(base.chips);
      v.mult.textContent = fmtMult(base.mult);
      if (v.total) v.total.textContent = "";
    });
    const bits = [];
    if (pv.ev.burned) bits.push(`撞字 ${pv.ev.burned} 張`);
    if (pv.ev.pairs.length) bits.push(`呼應 ${pv.ev.pairs.length} 組`);
    const ghosts = pv.ev.scoring.reduce((s, it) => s + it.ghosts.length, 0);
    if (ghosts) bits.push(`附帶 ${ghosts} 字`);
    if (pv.ev.era && pv.ev.era !== "modern") bits.push(ERA_ZH[pv.ev.era]);
    if (pv.zero) bits.push(pv.zero);
    T.readout.hint.textContent = bits.join("・") || HAND_TYPE[pv.ev.type].desc;
  }
  const can = R.canPlay(world, run, sel);
  T.playBtn.disabled = !can || ui.busy;
  T.discardBtn.disabled = !sel.length || run.round.discards <= 0 || ui.busy;
}

function doSort(by) {
  if (ui.busy) return;
  ui.sort = by;
  R.sortHand(world, run, by);
  for (const b of ui.T.sortBtns) b.setAttribute("aria-pressed", b.textContent === (by === "suit" ? "花色" : "格數") ? "true" : "false");
  const rects = new Map([...ui.T.cards].map(([id, n]) => [id, n.getBoundingClientRect()]));
  renderHand();
  for (const [id, n] of ui.T.cards) flipFrom(n, rects.get(id), 260);
  renderSelection();
  save();
}

function lock(on) {
  ui.busy = on;
  const T = ui.T;
  if (!T) return;
  T.playBtn.disabled = on || !R.canPlay(world, run, ui.selected);
  T.discardBtn.disabled = on || !ui.selected.length || run.round.discards <= 0;
  T.playBtn.dataset.busy = on ? "true" : "false";
}

/** 排版台上的牌：數量多就縮小，不讓一版字擠出畫面。 */
function sizeStage() {
  const T = ui.T;
  if (!T) return;
  const cards = T.stage.querySelectorAll(".card").length;
  const ghosts = T.stage.querySelectorAll(".ghost-slug").length;
  if (!cards) return;
  const W = T.stage.parentElement.clientWidth - 16;
  const H = T.stage.parentElement.clientHeight - 24;
  const items = cards + ghosts;
  const units = cards + ghosts * 0.62;
  // 一行放得下就一行；放不下就分兩、三行，挑牌面最大的那種排法。
  let w = 0;
  for (let rows = 1; rows <= 3; rows++) {
    const perRow = Math.ceil(items / rows);
    const byW = (W - perRow * 8) / Math.min(units, perRow);
    const byH = (H - (rows - 1) * 12) / rows / 1.462;
    w = Math.max(w, Math.min(132, byW, byH));
  }
  w = Math.max(40, Math.floor(w));
  T.stage.style.setProperty("--stage-w", w + "px");
  T.stage.querySelectorAll(".card").forEach((c) => c.style.setProperty("--card-w", w + "px"));
  T.stage.querySelectorAll(".ghost-slug").forEach((g) => (g.style.width = w * 0.62 + "px"));
}

/* ---------- 付印 ---------- */

async function onPlay() {
  if (ui.busy || !R.canPlay(world, run, ui.selected)) return;
  const T = ui.T;
  lock(true);
  hideTip();
  setHurry(false);
  const ids = [...ui.selected];
  const rects = new Map(ids.map((id) => [id, T.cards.get(id).getBoundingClientRect()]));
  const scoreBefore = run.round.score;
  const level = run.levels[R.preview(world, run, ids).ev.type] || 1;
  const result = R.play(world, run, ids);
  ui.selected = [];
  if (!result) {
    lock(false);
    return;
  }
  save();

  const hurry = () => setHurry(true);
  document.addEventListener("pointerdown", hurry);

  T.hint.remove();
  T.threads.replaceChildren();
  const stageNodes = new Map();
  for (const id of ids) {
    const node = T.cards.get(id);
    T.cards.delete(id);
    node.setAttribute("aria-pressed", "false");
    node.dataset.debuff = "false";
    setFlag(node, null);
    node.disabled = true;
    node.style.removeProperty("--tilt");
    node.style.zIndex = "";
    node.style.marginLeft = "0";
    T.stage.append(node);
    stageNodes.set(id, node);
  }
  sizeStage();
  for (const [id, node] of stageNodes) flipFrom(node, rects.get(id), 380);
  layoutHand();
  renderSelectionIdle();
  sfx.clack();
  await sleep(420);

  await playScoring(world, result.ev, result.res, {
    stage: T.stage,
    threads: T.threads,
    nodes: stageNodes,
    jokers: T.jokerNodes,
    readout: [T.readout, T.mini],
    onGrow: sizeStage,
  }, level);

  document.removeEventListener("pointerdown", hurry);
  countTo(T.scoreNow, scoreBefore, run.round.score, 520);
  T.progress.style.setProperty("--p", String(Math.min(1, run.round.score / run.round.target)));
  if (result.requestJustMet) {
    if (T.request) T.request.dataset.done = "true";
    toast("附加委託達成：結帳時多 3 兩");
    sfx.coin();
  }
  await sleep(640);
  setHurry(false);

  for (const node of T.stage.children) fadeAway(node, 40);
  T.threads.replaceChildren();
  await sleep(260);
  T.stage.replaceChildren(T.hint);

  if (result.outcome === "won") {
    bigStamp("成交");
    sfx.win();
    await sleep(1100);
    clearBigStamp();
    lock(false);
    showCashout();
    return;
  }
  if (result.outcome === "lost") {
    bigStamp("打烊");
    sfx.lose();
    await sleep(1300);
    clearBigStamp();
    lock(false);
    finishRun();
    return;
  }
  renderHand({ animate: "new" });
  renderLedger();
  lock(false);
  renderSelection();
  sfx.deal();
}

function renderSelectionIdle() {
  const T = ui.T;
  T.rail.replaceChildren(...Array.from({ length: run.round?.capacity || 10 }, () => el("i")));
  T.railLabel.textContent = "付印中……點一下畫面可以加速";
  T.playBtn.disabled = true;
  T.discardBtn.disabled = true;
}

async function onDiscard() {
  if (ui.busy || !ui.selected.length) return;
  const T = ui.T;
  const ids = [...ui.selected];
  if (!R.discard(world, run, ids)) return;
  lock(true);
  ui.selected = [];
  save();
  for (const id of ids) {
    const node = T.cards.get(id);
    if (node) fadeAway(node, 70);
  }
  sfx.deal();
  await sleep(240);
  for (const id of ids) T.cards.delete(id);
  renderHand({ animate: "new" });
  renderLedger();
  lock(false);
  renderSelection();
}

let stampNode = null;
function bigStamp(text) {
  clearBigStamp();
  stampNode = el("div", { class: "seal big-stamp", role: "status" }, text);
  document.body.append(stampNode);
  sfx.stamp();
}
function clearBigStamp() {
  if (stampNode) stampNode.remove();
  stampNode = null;
}

/* ================= 結帳 ================= */

function printFrame(p) {
  const src = p ? (p.status === "done" ? p.image : printer.preview(p.id)) : null;
  const status = p ? p.status : "none";
  const frame = el(
    "figure",
    { class: "print-frame", style: "margin:0", dataset: { printId: p ? p.id : "" } },
    el(
      "div",
      { class: "print-sheet", dataset: { status } },
      src
        ? el("img", { src, alt: p ? `${p.who}的作品` : "" })
        : el(
            "div",
            { class: "print-empty" },
            !p ? "這一單沒有印" : status === "offline" ? "印刷機（ComfyUI）沒開。開了之後按「再印一次」。" : status === "failed" ? `印壞了：${p.error || ""}` : "排隊等印……"
          )
    ),
    el(
      "figcaption",
      { class: "print-caption" },
      p ? el("b", {}, `${p.who}・${HAND_TYPE[p.type]?.zh || ""} ${fmt(p.total)} 分`) : null,
      p ? el("br") : null,
      p ? `${PRINT_STATUS_ZH[p.status] || ""}${p.status === "printing" ? ` ${Math.round(printer.progress(p.id) * 100)}%` : ""}` : "",
      p && (status === "offline" || status === "failed")
        ? el("button", { class: "linkish", type: "button", onclick: () => printer.retry() }, "　再印一次")
        : null
    )
  );
  return frame;
}

function showCashout() {
  const c = run.cashout;
  if (!c) return;
  const p = run.prints.find((x) => x.id === c.printId) || null;
  printer.kick();
  const frameHolder = el("div", {}, printFrame(p));
  const body = el(
    "div",
    { class: "receipt" },
    el(
      "div",
      { class: "receipt-lines" },
      el("p", { class: "slip-kind" }, `本單 ${fmt(c.score)} 分（至少 ${fmt(c.target)}）`),
      c.lines.map((l, i) => el("div", { class: "receipt-line", style: `--i:${i}` }, el("span", {}, l.label), el("b", {}, "+" + l.amount))),
      el("div", { class: "receipt-total", style: `--i:${c.lines.length}` }, el("span", {}, "合計"), el("b", {}, c.total + " 兩"))
    ),
    frameHolder
  );
  let done = false;
  const take = () => {
    if (done) return;
    done = true;
    ui.cashoutSheet = null;
    if (run.phase !== "cashout") return;
    R.collect(world, run);
    save();
    sfx.coin();
    if (run.phase === "won") showWon();
    else showShop();
  };
  const sheet = openSheet(
    "成交",
    body,
    {
      wide: true,
      onClose: take,
      foot: [el("button", { class: "btn btn-brass", type: "button", onclick: () => sheet.close() }, `收下 ${c.total} 兩`)],
    }
  );
  ui.cashoutSheet = {
    printId: p ? p.id : null,
    update() {
      const cur = run.prints.find((x) => x.id === c.printId);
      frameHolder.replaceChildren(printFrame(cur));
    },
  };
}

/* ================= 字鋪（商店） ================= */

function showShop() {
  setScreen("shop", "bg-shop");
  const s = run.shop;
  const next = R.blindsOf(run)[run.blind];
  const lastPrint = run.prints.at(-1) || null;

  const wares = s.items.map((it, i) => wareNode(it, i));
  const packs = s.packs.map((p, i) => packNode(p, i));
  const voucher = s.voucher ? voucherNode(s.voucher) : null;

  screen.replaceChildren(
    el(
      "section",
      { class: "shop-screen" },
      el(
        "header",
        { class: "shop-head enter" },
        el(
          "div",
          {},
          el("h2", {}, `字鋪・第 ${run.ante} 章`),
          el(
            "p",
            { class: "slip-hello" },
            `下一單：${next.kind}・${next.who.zh}，至少 ${fmt(next.target)} 分`,
            next.rules.length ? `。貴客的規矩：${next.rules.map((r) => r.rule).join("；")}` : ""
          )
        ),
        el("div", { class: "ledger-menu" }, el("span", { class: "money", style: "align-self:center;font-size:1.5rem" }, run.money), ...menuButtons())
      ),
      el(
        "div",
        { class: "shop-owned enter", style: "--i:1" },
        el("div", { class: "shop-owned-group" }, el("span", {}, `道具 ${run.jokers.length}/${run.jokerSlots}（點一下可以賣）`), el("div", { class: "shop-owned-row" }, run.jokers.length ? jokerNodes({ where: "shop" }) : el("span", { class: "wall-empty" }, "還沒有道具"))),
        el("div", { class: "shop-owned-group" }, el("span", {}, `印材 ${run.consumables.length}/${run.consumableSlots}`), el("div", { class: "shop-owned-row" }, run.consumables.length ? matNodes({ where: "shop" }) : el("span", { class: "wall-empty" }, "—"))),
        lastPrint
          ? el(
              "div",
              { class: "shop-owned-group", style: "width:6.5rem" },
              el("span", {}, "剛印的"),
              el(
                "button",
                { class: "wall-item shop-last-print", type: "button", dataset: { printId: lastPrint.id }, onclick: () => showGallery(true), "aria-label": "看這一局的作品" },
                printFrame(lastPrint)
              )
            )
          : null
      ),
      el(
        "div",
        { class: "counter-top enter", style: "--i:2" },
        el("div", { class: "wares" }, el("h3", {}, "櫃上"), el("div", { class: "wares-row" }, wares)),
        el("div", { class: "wares" }, el("h3", {}, "字包與升級"), el("div", { class: "wares-row" }, packs, voucher))
      ),
      el(
        "div",
        { class: "shop-services enter", style: "--i:3" },
        el(
          "div",
          { class: "left" },
          el("button", { class: "btn", type: "button", onclick: doReroll, disabled: run.money < R.rerollCost(run) }, "重擺櫃上", el("span", { class: "count" }, R.rerollCost(run) + " 兩")),
          el("button", { class: "btn", type: "button", onclick: showMelt, disabled: s.melted || run.money < R.MELT_PRICE || run.deck.length <= 20 }, s.melted ? "這次熔過了" : "熔掉一個字", s.melted ? null : el("span", { class: "count" }, R.MELT_PRICE + " 兩"))
        ),
        el("button", { class: "btn btn-primary", type: "button", onclick: leaveShop }, "接下一單")
      )
    )
  );
}

function wareNode(it, i) {
  const def = it.kind === "joker" ? JOKER[it.id] : it.kind === "typeface" ? TYPEFACE[it.id] : MATERIAL[it.id];
  const kindZh = it.kind === "joker" ? `道具・${RARITY_ZH[def.rarity]}` : it.kind === "typeface" ? `字模・${HAND_TYPE[def.type].zh} Lv ${run.levels[def.type] || 1} → ${(run.levels[def.type] || 1) + 1}` : "印材";
  const node = toolNode(it.kind, def, assets, { static: true });
  return el(
    "article",
    { class: "ware", dataset: { sold: it.sold ? "true" : "false" } },
    node,
    el("p", { class: "ware-name" }, def.zh),
    el("p", { class: "ware-kind" }, kindZh),
    el("p", { class: "ware-desc" }, def.desc),
    el(
      "button",
      { class: "btn btn-small btn-brass", type: "button", disabled: it.sold || run.money < it.price, onclick: () => doBuy(i) },
      it.sold ? "已售出" : `買 ${it.price} 兩`
    )
  );
}

function packNode(p, i) {
  const def = PACK[p.id];
  return el(
    "article",
    { class: "ware", dataset: { sold: p.sold ? "true" : "false" } },
    toolNode("pack", def, assets, { static: true }),
    el("p", { class: "ware-name" }, def.zh),
    el("p", { class: "ware-kind" }, "字包"),
    el("p", { class: "ware-desc" }, def.desc),
    el("button", { class: "btn btn-small btn-brass", type: "button", disabled: p.sold || run.money < p.price, onclick: () => doPack(i) }, p.sold ? "已拆" : `拆 ${p.price} 兩`)
  );
}

function voucherNode(v) {
  const def = VOUCHER[v.id];
  return el(
    "article",
    { class: "ware", dataset: { sold: v.sold ? "true" : "false" } },
    toolNode("voucher", def, assets, { static: true }),
    el("p", { class: "ware-name" }, def.zh),
    el("p", { class: "ware-kind" }, "鋪子升級・這一章限一次"),
    el("p", { class: "ware-desc" }, def.desc),
    el("button", { class: "btn btn-small btn-brass", type: "button", disabled: v.sold || run.money < def.price, onclick: doVoucher }, v.sold ? "已升級" : `升級 ${def.price} 兩`)
  );
}

function doBuy(i) {
  const it = run.shop.items[i];
  const r = R.buyItem(world, run, i);
  if (!r.ok) {
    sfx.error();
    toast(r.why || "買不了");
    return;
  }
  sfx.coin();
  // 道具、印材買了就出現在上面那排，不必再說一次；字模升級看不到，才講。
  if (it.kind === "typeface") {
    const t = TYPEFACE[it.id].type;
    toast(`「${HAND_TYPE[t].zh}」升到 Lv ${run.levels[t]}`);
  }
  save();
  showShop();
}

function doVoucher() {
  const r = R.buyVoucher(world, run);
  if (!r.ok) {
    sfx.error();
    toast(r.why || "買不了");
    return;
  }
  sfx.stamp();
  save();
  showShop();
}

function doReroll() {
  if (!R.reroll(world, run)) {
    sfx.error();
    return;
  }
  sfx.deal();
  save();
  showShop();
}

function doPack(i) {
  const r = R.buyPack(world, run, i);
  if (!r.ok) {
    sfx.error();
    toast(r.why || "買不了");
    return;
  }
  sfx.clack();
  save();
  showPackOpen();
}

function showPackOpen() {
  const open = run.shop.open;
  if (!open) return;
  const def = PACK[open.pack];
  let chosen = false;
  const body = el(
    "div",
    { class: "pack-choices" },
    open.choices.map((c, i) => {
      let face;
      let name;
      let desc;
      if (c.kind === "card") {
        const card = world.byCard.get(c.tag);
        face = cardNode(card, { id: -1 - i, tag: c.tag, enh: null }, assets, { static: true });
        name = card.zh;
        desc = `${SUIT_INFO[card.suit].zh}・${card.slots} 格・${card.chips} 籌碼${card.rare ? "・稀有" : ""}`;
      } else if (c.kind === "typeface") {
        const t = TYPEFACE[c.id];
        face = toolNode("typeface", t, assets, { static: true });
        name = t.zh;
        desc = `「${HAND_TYPE[t.type].zh}」Lv ${run.levels[t.type] || 1} → ${(run.levels[t.type] || 1) + 1}`;
      } else {
        const m = MATERIAL[c.id];
        face = toolNode("material", m, assets, { static: true });
        name = m.zh;
        desc = m.desc;
      }
      return el(
        "div",
        { class: "pack-choice" },
        face,
        el("p", { class: "ware-name" }, name),
        el("p", { class: "desc" }, desc),
        el("button", {
          class: "btn btn-small btn-primary",
          type: "button",
          onclick: () => {
            const r = R.choosePack(world, run, i);
            if (!r.ok) {
              sfx.error();
              toast(r.why || "拿不了");
              return;
            }
            chosen = true;
            sfx.stamp();
            save();
            sheet.close();
          },
        }, "拿這個")
      );
    })
  );
  const sheet = openSheet(`拆開「${def.zh}」・挑一個`, body, {
    wide: true,
    onClose: () => {
      if (!chosen) R.skipPack(world, run);
      save();
      showShop();
    },
    foot: [el("button", { class: "btn btn-ghost", type: "button", onclick: () => sheet.close() }, "都不要")],
  });
}

function showMelt() {
  let pickId = null;
  const confirm = el("button", { class: "btn btn-primary", type: "button", disabled: true }, "熔掉這個字（3 兩）");
  const grid = el(
    "div",
    { class: "deck-grid deck-grid-pickable" },
    sortedDeck().map((inst) => {
      const node = cardNode(world.byCard.get(inst.tag), inst, assets);
      node.addEventListener("click", () => {
        pickId = inst.id;
        for (const n of grid.children) n.setAttribute("aria-pressed", n === node ? "true" : "false");
        confirm.disabled = false;
        sfx.clack();
      });
      return node;
    })
  );
  confirm.addEventListener("click", () => {
    if (pickId === null) return;
    const inst = R.cardById(run, pickId);
    if (!R.melt(world, run, pickId)) {
      sfx.error();
      return;
    }
    sfx.burn();
    toast(`「${world.byCard.get(inst.tag).zh}」熔掉了，字盒剩 ${run.deck.length} 個字`);
    save();
    sheet.close();
  });
  const sheet = openSheet("熔掉一個字", el("div", {}, el("p", { class: "prose", style: "margin-bottom:1rem" }, "字盒越精，抽到好牌的機會越大。每次逛店可以熔一個（字盒至少留 20 個）。"), grid), {
    wide: true,
    onClose: () => showShop(),
    foot: [el("button", { class: "btn btn-ghost", type: "button", onclick: () => sheet.close() }, "算了"), confirm],
  });
}

function leaveShop() {
  R.leaveShop(world, run);
  save();
  sfx.clack();
  showSelect();
}

/* ================= 道具、印材的詳情 ================= */

function showJoker(index, where) {
  const j = run.jokers[index];
  if (!j) return;
  const def = JOKER[j.id];
  const note = def.note ? def.note(j) : "";
  const body = el(
    "div",
    { class: "detail" },
    toolNode("joker", def, assets, { static: true }),
    el(
      "div",
      {},
      el("p", { class: "slip-kind" }, `道具・${RARITY_ZH[def.rarity]}`),
      el("p", { class: "desc" }, def.desc),
      note ? el("p", { class: "readout-hint", style: "text-align:left" }, note) : null,
      el("p", { class: "readout-hint", style: "text-align:left;margin-top:0.75rem" }, "道具照擺放的順序觸發：先加的再乘，乘的放越右邊越划算。")
    )
  );
  const sellable = where !== "round" || !ui.busy;
  const sheet = openSheet(def.zh, body, {
    foot: [
      index > 0 ? el("button", { class: "btn btn-small", type: "button", onclick: () => { R.moveJoker(run, index, index - 1); save(); sheet.close(); rerender(where); } }, "往左移") : null,
      index < run.jokers.length - 1 ? el("button", { class: "btn btn-small", type: "button", onclick: () => { R.moveJoker(run, index, index + 1); save(); sheet.close(); rerender(where); } }, "往右移") : null,
      sellable
        ? el("button", {
            class: "btn btn-small btn-brass",
            type: "button",
            onclick: () => {
              R.sellJoker(world, run, index);
              sfx.coin();
              toast(`${def.zh}賣了 ${R.sellPrice(j)} 兩`);
              save();
              sheet.close();
              rerender(where);
            },
          }, `賣掉 ${R.sellPrice(j)} 兩`)
        : null,
    ],
  });
  sheet.sheet.querySelector(".detail .tool").style.setProperty("--tool-w", "100%");
}

function showMaterial(index, where) {
  const c = run.consumables[index];
  if (!c) return;
  const def = MATERIAL[c.id];
  const inRound = where === "round" && run.phase === "round";
  const canUse = !ui.busy && (def.target === 0 || inRound);
  const body = el(
    "div",
    { class: "detail" },
    toolNode("material", def, assets, { static: true }),
    el(
      "div",
      {},
      el("p", { class: "slip-kind" }, "印材"),
      el("p", { class: "desc" }, def.desc),
      def.target > 0
        ? el("p", { class: "readout-hint", style: "text-align:left;margin-top:0.75rem" }, inRound ? `先在手牌選好 ${def.target === 1 ? "1 張" : "1 到 " + def.target + " 張"}，再按「用」。目前選了 ${ui.selected.length} 張。` : "在委託裡對著手牌才能用。")
        : null
    )
  );
  const sheet = openSheet(def.zh, body, {
    foot: [
      el("button", {
        class: "btn btn-small",
        type: "button",
        onclick: () => {
          R.sellConsumable(world, run, index);
          sfx.coin();
          save();
          sheet.close();
          rerender(where);
        },
      }, "賣掉 1 兩"),
      canUse
        ? el("button", {
            class: "btn btn-small btn-primary",
            type: "button",
            onclick: () => {
              const r = R.useMaterial(world, run, index, [...ui.selected]);
              if (!r.ok) {
                sfx.error();
                toast(r.why || "用不了");
                return;
              }
              sfx.stamp();
              if (def.id === "purse") toast(`錢袋打開了：現在 ${run.money} 兩`);
              ui.selected = [];
              save();
              sheet.close();
              rerender(where, true);
            },
          }, "用")
        : null,
    ],
  });
  sheet.sheet.querySelector(".detail .tool").style.setProperty("--tool-w", "100%");
}

function rerender(where, handChanged = false) {
  if (where === "shop") showShop();
  else if (where === "select") showSelect();
  else if (ui.T) {
    renderShelf();
    if (handChanged) renderHand({ animate: "new" });
    renderLedger();
    renderSelection();
  }
}

function showCardDetail(id) {
  const inst = R.cardById(run, id);
  if (!inst) return;
  const card = world.byCard.get(inst.tag);
  const facts = cardFacts(world, card, inst);
  const src = card.art ? assets.card(card.tag) : null;
  const body = el(
    "div",
    { class: "detail" },
    src ? el("div", { class: "detail-art" }, el("img", { src, alt: card.zh })) : cardNode(card, inst, assets, { static: true }),
    el(
      "div",
      {},
      el("p", { class: "tag-en" }, card.tag),
      el("dl", {}, facts.map(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]))
    )
  );
  const selected = ui.selected.includes(id);
  const sheet = openSheet(card.zh, body, {
    foot: run.phase === "round" && run.round?.hand.includes(id)
      ? [el("button", { class: "btn btn-primary", type: "button", onclick: () => { sheet.close(); toggleCard(id); } }, selected ? "拿出手盒" : "排進手盒")]
      : null,
  });
}

/* ================= 各種表 ================= */

function showTypes() {
  const rows = run ? R.typeRows(run) : HAND_TYPES.map((t) => ({ ...t, level: 1, played: 0 }));
  const body = el(
    "div",
    {},
    el(
      "table",
      { class: "type-table" },
      el("thead", {}, el("tr", {}, el("th", {}, "牌型"), el("th", {}, "等級"), el("th", {}, "籌碼 × 倍率"), el("th", {}, "條件"), el("th", {}, "打過"))),
      el(
        "tbody",
        {},
        rows.map((t) => {
          const v = typeValue(t.key, t.level);
          return el("tr", {}, el("td", {}, t.zh), el("td", {}, "Lv " + t.level), el("td", { class: "cm" }, el("b", {}, v.chips), " × ", el("b", {}, v.mult)), el("td", { class: "desc" }, t.desc), el("td", {}, t.played));
        })
      )
    ),
    el("p", { class: "readout-hint", style: "text-align:left;margin-top:1rem" }, "一版同時符合好幾種時，算最上面那一種。字模可以把牌型升級。另外：每組呼應 +2 倍率，每個附帶的字 +4 籌碼。")
  );
  openSheet("牌型表", body, { wide: true });
}

function sortedDeck() {
  const order = { look: 0, wear: 1, pose: 2, scene: 3 };
  return [...run.deck].sort((a, b) => {
    const ca = world.byCard.get(a.tag);
    const cb = world.byCard.get(b.tag);
    return order[ca.suit] - order[cb.suit] || ca.slots - cb.slots || a.id - b.id;
  });
}

function showDeck() {
  if (!run) return;
  const inDraw = new Set(run.round ? run.round.draw : run.deck.map((c) => c.id));
  const counts = SUITS.map((s) => {
    const all = run.deck.filter((c) => world.byCard.get(c.tag).suit === s);
    const left = all.filter((c) => inDraw.has(c.id)).length;
    return `${SUIT_INFO[s].zh} ${left}/${all.length}`;
  });
  const grid = el(
    "div",
    { class: "deck-grid" },
    sortedDeck().map((inst) => {
      const node = cardNode(world.byCard.get(inst.tag), inst, assets);
      node.dataset.used = run.round && !inDraw.has(inst.id) ? "true" : "false";
      node.addEventListener("click", () => {
        const card = world.byCard.get(inst.tag);
        toast(`${card.zh}：${cardFacts(world, card, inst).map(([k, v]) => k + " " + v).slice(0, 4).join("；")}`);
      });
      return node;
    })
  );
  openSheet(
    `字盒・${run.deck.length} 個字`,
    el("div", {}, el("p", { class: "readout-hint", style: "text-align:left;margin-bottom:0.75rem" }, (run.round ? "淡掉的是這一單已經抽出來的。" : "") + counts.join("　")), grid),
    { wide: true }
  );
}

function showGallery(runOnly = false) {
  const saved = S.loadGallery();
  const live = run ? run.prints.filter((p) => p.status !== "done") : [];
  const list = runOnly && run ? run.prints.slice().reverse() : [...live.slice().reverse(), ...saved];
  const wall = list.length
    ? el(
        "div",
        { class: "wall" },
        list.map((p) =>
          el(
            "button",
            { class: "wall-item", type: "button", onclick: () => showPrint(p) },
            printFrame(p)
          )
        )
      )
    : el("p", { class: "wall-empty" }, "還沒有作品。成交一單，那一版字就會印成一張。");
  openSheet(runOnly ? "晾紙架・這一局的作品" : "作品牆", el("div", {}, wall), {
    wide: true,
    foot: run && run.prints.some((p) => p.status === "offline" || p.status === "failed")
      ? [el("button", { class: "btn btn-small", type: "button", onclick: () => printer.retry() }, "把沒印成的再印一次")]
      : null,
  });
}

function showPrint(p) {
  const src = p.status === "done" || p.image ? p.image : printer.preview(p.id);
  const copy = el("button", {
    class: "btn btn-small",
    type: "button",
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(p.positive);
        toast("POS 複製好了，可以貼回排字匣");
      } catch {
        toast("複製不了，請手動選取");
      }
    },
  }, "複製 POS");
  openSheet(
    `${p.who}・${HAND_TYPE[p.type]?.zh || ""} ${fmt(p.total)} 分`,
    el(
      "div",
      { class: "lightbox" },
      src ? el("img", { src, alt: `${p.who}的作品` }) : printFrame(p),
      el(
        "div",
        {},
        el("p", { class: "slip-kind" }, `第 ${p.ante} 章${p.date ? "・" + p.date : ""}`),
        el("p", { class: "prose", style: "margin:0.5rem 0" }, (p.tags || []).map((t) => world.byCard.get(t)?.zh || t).join("、")),
        el("pre", {}, p.positive),
        el("div", { class: "sheet-foot", style: "justify-content:flex-start" }, copy, src && (p.status === "done" || p.image) ? el("a", { class: "btn btn-small", href: src, target: "_blank", rel: "noopener" }, "開原圖") : null)
      )
    ),
    { wide: true }
  );
}

function showHowTo() {
  const b = (t) => el("b", {}, t);
  const body = el(
    "div",
    { class: "prose" },
    el("p", {}, "每一章有三位客人：", b("散客"), "、", b("熟客"), "和出難題的", b("貴客"), "。每一單都有分數門檻，在", b("付印"), "次數用完前湊到就成交。"),
    el("p", {}, "手上有 8 張字。點牌排進", b("手盒"), "（容量看格子，字越長越佔位），按「付印」計分；不想要的按「換字」丟掉重抽。"),
    el("p", {}, b("分數 = 籌碼 × 倍率"), "。牌型給底數，每張計分的字加籌碼，道具加倍率或直接乘。"),
    el("p", {}, "四種花色：", b("容"), "長相、", b("衣"), "服裝、", b("姿"), "姿勢、", b("景"), "場景。四種湊齊是", b("全版"), "；三張以上同一個古代是", b("同代"), "；運動場地加上器材是", b("成套"), "。"),
    el("p", {}, b("撞字"), "：同一類只能一張（兩種髮色、兩個地點），後放進去的那張燒掉不計分。", b("不合時代"), "：一版字投票決定年代，跟它不合的字也燒掉。"),
    el("p", {}, b("順序"), "：先點的字排在前面，計分也從前面算起。撞字時燒的是後放的那張；「印刷學徒」看第一張、「反字鏡」看最後一張。道具也照擺放順序觸發，點道具可以左右移。"),
    el("p", {}, b("呼應"), "：東西配得上地方（閱讀＋圖書館、雨＋雨傘），每組 +2 倍率。", b("附帶"), "：有些字會自己帶字（和服帶出和服類），每個 +4 籌碼。"),
    el("p", {}, "成交後逛字鋪：買道具、字模（升級牌型）、印材（加工手牌），或熔掉不要的字。撐過第 ", String(FINAL_ANTE), " 章的東家，就掛上金字招牌。"),
    el("p", {}, "每成交一單，那一單最完整（三個字以上）、分數最高的一版會送去 ComfyUI 印成一張作品，掛在晾紙架上。"),
    el("p", {}, "鍵盤：", b("1–8"), " 選牌、", b("Enter"), " 付印、", b("D"), " 換字、", b("S"), " 換排序、", b("Esc"), " 清掉選取。手機上長按一張牌看說明。")
  );
  openSheet("怎麼玩", body, { wide: true });
}

function showMenu() {
  const toggles = [
    ["sound", "音效"],
    ["fast", "快速動畫"],
    ["autoPrint", "成交時自動印作品（用 ComfyUI）"],
  ].map(([k, label]) => {
    const input = el("input", { type: "checkbox", id: "set-" + k });
    input.checked = !!settings[k];
    input.addEventListener("change", () => {
      settings[k] = input.checked;
      S.saveSettings(settings);
      setSound(settings.sound);
      setSpeed(settings.fast);
      if (k === "autoPrint" && input.checked) printer.kick();
    });
    return el("label", { for: "set-" + k, style: "display:flex;gap:0.6rem;align-items:center;min-height:40px" }, input, label);
  });
  let armed = false;
  const giveUp = el("button", {
    class: "btn btn-small btn-ghost",
    type: "button",
    onclick: () => {
      if (!armed) {
        armed = true;
        giveUp.textContent = "再按一次：真的收攤";
        return;
      }
      sheet.close();
      if (run) {
        run.phase = "over";
        run.over = { ante: run.ante, blind: run.blind, score: run.round?.score || 0, target: run.round?.target || 0, gaveUp: true };
        finishRun();
      }
    },
  }, "放棄這一局");
  const sheet = openSheet(
    "選單",
    el(
      "div",
      {},
      el("div", { style: "display:grid;gap:0.25rem" }, toggles),
      run ? el("p", { class: "readout-hint", style: "text-align:left;margin-top:1rem" }, `這一局的種子：${run.seed}・${DECK[run.deckId]?.zh || ""}`) : null
    ),
    {
      foot: [
        el("button", { class: "btn btn-small btn-ghost", type: "button", onclick: () => { sheet.close(); showHowTo(); } }, "怎麼玩"),
        el("button", { class: "btn btn-small btn-ghost", type: "button", onclick: () => { sheet.close(); showTitle(); } }, "回招牌（會存檔）"),
        run && run.phase !== "over" && run.phase !== "won" ? giveUp : null,
      ],
    }
  );
}

/* ================= 打烊與金字招牌 ================= */

function finishRun() {
  const rec = S.loadRecords();
  rec.bestAnte = Math.max(rec.bestAnte, run.ante);
  rec.bestHand = Math.max(rec.bestHand, run.stats.bestHand?.total || 0);
  S.saveRecords(rec);
  save();
  showOver();
}

function endStats() {
  const best = run.stats.bestHand;
  return [
    el(
      "div",
      { class: "end-stats" },
      el("div", {}, el("span", {}, "走到"), el("b", {}, `第 ${run.phase === "won" ? FINAL_ANTE : run.ante} 章`)),
      el("div", {}, el("span", {}, "付印"), el("b", {}, run.stats.hands + " 次")),
      el("div", {}, el("span", {}, "成交"), el("b", {}, run.stats.rounds + " 單")),
      el("div", {}, el("span", {}, "最高一版"), el("b", {}, fmt(best?.total || 0)))
    ),
    best
      ? el("p", { class: "best-line" }, `最高的一版：${HAND_TYPE[best.type]?.zh}・${best.tags.map((t) => world.byCard.get(t)?.zh || t).join("、")}`)
      : null,
    run.prints.length
      ? el("div", { class: "wall" }, run.prints.map((p) => el("button", { class: "wall-item", type: "button", onclick: () => showPrint(p) }, printFrame(p))))
      : null,
  ];
}

function showOver() {
  setScreen("over", "bg-street");
  const o = run.over || {};
  screen.replaceChildren(
    el(
      "section",
      { class: "end-screen" },
      el("span", { class: "seal end-stamp enter" }, "打烊"),
      el("h2", { class: "enter", style: "--i:1" }, o.gaveUp ? "今晚先收攤" : "這一單沒談成"),
      el(
        "p",
        { class: "lede enter", style: "--i:2" },
        o.gaveUp ? "字盒收好，明晚再開。" : `差 ${fmt(Math.max(0, (o.target || 0) - (o.score || 0)))} 分。${o.score ? `湊到 ${fmt(o.score)}，客人要 ${fmt(o.target)}。` : ""}`
      ),
      endStats(),
      el(
        "div",
        { class: "picker-actions" },
        el("button", { class: "btn btn-ghost", type: "button", onclick: () => { S.clearRun(); run = null; showTitle(); } }, "回招牌"),
        el("button", { class: "btn btn-primary", type: "button", onclick: () => { S.clearRun(); showPicker(); } }, "再開一局")
      )
    )
  );
}

function showWon() {
  setScreen("won", "bg-street");
  const rec = S.loadRecords();
  if (!run.recordedWin) {
    run.recordedWin = true;
    rec.wins += 1;
    rec.bestAnte = Math.max(rec.bestAnte, FINAL_ANTE);
    rec.bestHand = Math.max(rec.bestHand, run.stats.bestHand?.total || 0);
    S.saveRecords(rec);
    save();
    sfx.win();
  }
  screen.replaceChildren(
    el(
      "section",
      { class: "end-screen" },
      el("span", { class: "seal end-stamp enter", style: "color:var(--color-brass)" }, "金字"),
      el("h2", { class: "enter", style: "--i:1" }, "掛上金字招牌"),
      el("p", { class: "lede enter", style: "--i:2" }, "東家點了頭。字鋪在這條街上站穩了。"),
      endStats(),
      el(
        "div",
        { class: "picker-actions" },
        el("button", { class: "btn btn-ghost", type: "button", onclick: () => { S.clearRun(); run = null; showTitle(); } }, "回招牌"),
        el("button", { class: "btn", type: "button", onclick: () => { R.goEndless(world, run); save(); showShop(); } }, "繼續加班（無盡）"),
        el("button", { class: "btn btn-primary", type: "button", onclick: () => { S.clearRun(); showPicker(); } }, "再開一局")
      )
    )
  );
}

/* ================= 鍵盤 ================= */

function onKey(e) {
  if (anyOverlay() || e.metaKey || e.ctrlKey || e.altKey) return;
  if (app.dataset.screen !== "round" || !ui.T || !run?.round) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (/^[1-9]$/.test(e.key)) {
    const id = run.round.hand[Number(e.key) - 1];
    if (id !== undefined) {
      e.preventDefault();
      toggleCard(id);
    }
  } else if (e.key === "Enter" && !(document.activeElement instanceof HTMLButtonElement && document.activeElement !== ui.T.playBtn)) {
    e.preventDefault();
    onPlay();
  } else if (e.key === "d" || e.key === "D") {
    onDiscard();
  } else if (e.key === "s" || e.key === "S") {
    doSort(ui.sort === "suit" ? "slots" : "suit");
  } else if (e.key === "Escape") {
    ui.selected = [];
    renderSelection();
  }
}

// ?debug：給測試腳本用的把手，平常不掛。
if (new URLSearchParams(location.search).has("debug")) {
  window.zipu = {
    run: () => run,
    world: () => world,
    route: () => routeByPhase(),
    save,
    R,
  };
}

boot();
