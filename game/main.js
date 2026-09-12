/** 狀態機與畫面。規則在 quiz.js，網路在 queue.js，這裡只把它們接起來。 */
import {
  defaultSettings,
  drawOne,
  indexLexicon,
  labelOf,
  mulberry32,
  randomSeed,
} from "./engine.js";
import { banlistFrom, makeQuestion } from "./quiz.js";
import { createQueue } from "./queue.js";
import { HEAT_PRESETS, heatsFor, load, recordRun, save } from "./store.js";

const SHEETS = 3;
const HEAT_LABELS = { mixed: "混合", tease: "撩", flash: "露", sex: "性" };

const el = (id) => document.getElementById(id);
const room = document.querySelector(".room");
const print = el("print");
const shot = el("shot");
const pins = el("pins");
const screens = { gate: el("gate"), play: el("play"), over: el("over") };

const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

function show(name) {
  for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
}

let devNow = 0;
let devRaf = 0;
let devFuse = 0;
let turnTimer = 0;

/** 一個回合同時只准有一件排定中的事。第三個答對會排下一張，
 *  緊接著的第三次答錯會排結束——兩件都跑的話，結束畫面後面會開始顯影下一張。 */
function later(fn, ms) {
  window.clearTimeout(turnTimer);
  turnTimer = window.setTimeout(fn, ms);
}

function setDev(value) {
  devNow = Math.max(0, Math.min(1, value));
  print.style.setProperty("--dev", String(devNow));
}

/** 顯影的補間自己跑。Chromium 不會替自訂屬性建立 CSS transition，
 *  宣告了也不會有動畫，所以這裡用 rAF，緩動也才握在手上。 */
function rampDev(target, ms) {
  window.cancelAnimationFrame(devRaf);
  window.clearTimeout(devFuse);
  if (calm.matches || ms <= 0) {
    setDev(target);
    return;
  }
  const from = devNow;
  const span = target - from;
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    // ease-in-out：影像先慢慢浮出來，收尾再定住
    const eased = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    setDev(from + span * eased);
    if (k < 1) {
      devRaf = window.requestAnimationFrame(step);
      return;
    }
    window.clearTimeout(devFuse);
  };
  devRaf = window.requestAnimationFrame(step);
  // 分頁被切走時瀏覽器不發畫格，rAF 就餓死了，相紙會永遠停在霧裡、
  // 這一局等於報廢。保險絲確保它最後一定定影——寧可沒有補間，也不能卡住。
  devFuse = window.setTimeout(() => setDev(target), ms + 140);
}

function setNote(text) {
  el("progress").textContent = text;
}

let lex = null;
let data = null;
let banlist = null;
let record = load(window.localStorage);
let queue = null;
let run = null;

function makeRound() {
  const settings = defaultSettings(data);
  settings.girl = true;
  settings.boy = false;
  settings.heats = heatsFor(record.heatPreset);
  const seed = randomSeed();
  const draw = drawOne(lex, settings, new Set(), new Set(), mulberry32(seed), seed);
  const question = makeQuestion(lex, draw, mulberry32(seed), banlist);
  return question ? { draw, question } : null;
}

/* ── 顯影 ─────────────────────────────────────────── */

function onGenEvent(event, payload) {
  if (!run || !run.awaiting) return;
  if (event === "queued") {
    setNote("排隊中");
    return;
  }
  if (event === "preview") {
    shot.src = payload.image;
    return;
  }
  if (event === "progress") {
    const ratio = payload.max ? payload.value / payload.max : 0;
    run.live = true;
    setNote(`顯影 ${Math.round(ratio * 100)}%`);
    // 留一截給定影那一下，別讓進度條自己走到底。
    rampDev(0.06 + ratio * 0.7, 260);
  }
}

/** 等圖進來。decode() 在沒在繪製的分頁裡可能永遠不 resolve，
 *  一局就這樣死在那裡，所以用 load 事件並且給它一個上限。 */
function imageReady(img) {
  if (img.complete && img.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      img.removeEventListener("load", done);
      img.removeEventListener("error", done);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(done, 4000);
    img.addEventListener("load", done);
    img.addEventListener("error", done);
  });
}

/** 把相紙從霧裡帶到定影。現生的接著它自己的進度走，預抽好的重播一次。 */
async function develop(src, fromFog) {
  print.classList.remove("is-spent");
  if (fromFog) setDev(0);
  shot.src = src;
  await imageReady(shot);
  rampDev(1, fromFog ? 1150 : 620);
}

/* ── 畫面 ─────────────────────────────────────────── */

function renderSheets() {
  const box = el("lives");
  box.replaceChildren();
  for (let i = 0; i < SHEETS; i += 1) {
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.dataset.spent = String(i >= run.lives);
    box.append(sheet);
  }
}

function renderCounters() {
  el("score").textContent = String(run.score);
  el("streak").textContent = String(run.streak);
}

function renderChoices() {
  const box = el("choices");
  box.replaceChildren();
  run.round.question.choices.forEach((choice, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "choice is-in";
    btn.style.setProperty("--in-delay", `${i * 42}ms`);
    btn.textContent = labelOf(lex, choice.tag);
    btn.title = choice.tag;
    btn.addEventListener("click", () => pick(btn, choice));
    box.append(btn);
  });
}

/** 答對的字從托盤飛到照片邊上的說明欄。 */
function pinAnswer(btn, tag) {
  const from = btn.getBoundingClientRect();

  const pin = document.createElement("li");
  pin.className = "pin";

  const zh = document.createElement("span");
  zh.className = "pin-zh";
  zh.textContent = labelOf(lex, tag);
  const en = document.createElement("span");
  en.className = "pin-en";
  en.textContent = tag;
  pin.append(zh, en);
  pins.append(pin);

  if (calm.matches) return;

  const to = pin.getBoundingClientRect();
  pin.animate(
    [
      {
        transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(1.06)`,
        opacity: 0.001,
      },
      { transform: "none", opacity: 1 },
    ],
    { duration: 620, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "both" }
  );
}

function flashFog() {
  if (calm.matches) return;
  room.classList.remove("is-fogging");
  void room.offsetWidth;
  room.classList.add("is-fogging");
}

/* ── 一回合 ───────────────────────────────────────── */

function pick(btn, choice) {
  if (btn.disabled || run.waiting || run.done) return;
  btn.disabled = true;

  if (choice.correct) {
    btn.dataset.state = "fixed";
    pinAnswer(btn, choice.tag);
    run.found += 1;
    run.score += 1;
    renderCounters();
    if (run.found === run.round.question.answers.length) {
      if (run.clean) run.streak += 1;
      renderCounters();
      later(nextRound, calm.matches ? 200 : 900);
    }
    return;
  }

  btn.dataset.state = "fogged";
  run.lives -= 1;
  run.clean = false;
  run.streak = 0;
  renderSheets();
  renderCounters();
  flashFog();
  if (run.lives <= 0) {
    run.done = true;
    later(finish, calm.matches ? 200 : 560);
  }
}

async function nextRound() {
  if (run.done) return;
  run.waiting = true;
  run.awaiting = true;
  run.live = false;
  pins.replaceChildren();
  el("choices").replaceChildren();
  setNote("換紙");

  let round = null;
  try {
    round = await queue.take();
  } catch (err) {
    run.awaiting = false;
    setNote("顯影失敗：" + err.message);
    return;
  }
  run.awaiting = false;

  run.round = round;
  run.found = 0;
  run.clean = true;
  await develop(round.image, !run.live);
  run.waiting = false;
  setNote("");
  renderSheets();
  renderCounters();
  renderChoices();
}

function finish() {
  const question = run.round && run.round.question;
  print.classList.add("is-spent");
  pins.replaceChildren();

  el("final-score").textContent = String(run.score);
  el("final-streak").textContent = String(run.streak);

  const list = el("answers");
  list.replaceChildren();
  for (const answer of (question && question.answers) || []) {
    const row = document.createElement("li");
    row.className = "sheet-row";
    const zh = document.createElement("span");
    zh.className = "sheet-zh";
    zh.textContent = labelOf(lex, answer.tag);
    const en = document.createElement("span");
    en.className = "sheet-en";
    en.textContent = answer.tag;
    const sec = document.createElement("span");
    sec.className = "sheet-sec";
    sec.textContent = answer.section;
    row.append(zh, en, sec);
    list.append(row);
  }

  el("positive").textContent = (run.round && run.round.draw.positive) || "";
  record = recordRun(record, { score: run.score, streak: run.streak });
  save(window.localStorage, record);
  renderLedger();
  show("over");
}

/* ── 開場 ─────────────────────────────────────────── */

function renderLedger() {
  el("best").textContent = String(record.best);
  el("best-streak").textContent = String(record.bestStreak);
}

function renderDial() {
  const dial = el("heat");
  dial.replaceChildren();
  for (const preset of HEAT_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dial-step";
    btn.textContent = HEAT_LABELS[preset];
    btn.setAttribute("aria-pressed", String(preset === record.heatPreset));
    btn.addEventListener("click", () => {
      record = { ...record, heatPreset: preset };
      save(window.localStorage, record);
      renderDial();
    });
    dial.append(btn);
  }
}

async function start() {
  window.clearTimeout(turnTimer);
  run = {
    lives: SHEETS,
    score: 0,
    streak: 0,
    found: 0,
    clean: true,
    round: null,
    waiting: true,
    awaiting: false,
    live: false,
    done: false,
  };
  room.classList.add("is-board");
  // 佇列只建一次。上一局結束時背景已經生好一張了，「再曝一張」直接接手。
  if (!queue) queue = createQueue({ makeRound, onEvent: onGenEvent });
  show("play");
  renderSheets();
  renderCounters();
  await nextRound();
}

function skip() {
  if (!run || run.waiting || run.done) return;
  run.streak = 0;
  renderCounters();
  nextRound();
}

async function boot() {
  el("start").disabled = true;
  setNote("");
  el("gate-note").textContent = "載入詞庫";

  data = await fetch("lexicon.json").then((r) => r.json());
  lex = indexLexicon(data);
  banlist = banlistFrom(await fetch("unguessable.json").then((r) => r.json()), lex);
  renderDial();
  renderLedger();

  const ping = await fetch("/api/ping")
    .then((r) => r.json())
    .catch(() => ({ ok: false }));
  if (!ping.ok) {
    el("gate-note").textContent = "ComfyUI 沒開。開起來之後重整這頁。";
    return;
  }
  el("gate-note").textContent = "";
  el("start").disabled = false;
}

el("start").addEventListener("click", start);
el("again").addEventListener("click", start);
el("skip").addEventListener("click", skip);
el("copy").addEventListener("click", async (ev) => {
  await navigator.clipboard.writeText(el("positive").textContent || "");
  const btn = ev.currentTarget;
  btn.textContent = "已複製";
  window.setTimeout(() => {
    btn.textContent = "複製 POS";
  }, 1400);
});

show("gate");
boot();
