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

const LIVES = 3;
const HEAT_LABELS = { mixed: "混合", tease: "撩", flash: "露", sex: "性" };

const el = (id) => document.getElementById(id);
const screens = { gate: el("gate"), play: el("play"), over: el("over") };

function show(name) {
  for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
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

function onGenEvent(event, payload) {
  if (!run || !run.waiting) return;
  if (event === "queued") el("progress").textContent = "排隊中…";
  if (event === "progress") el("progress").textContent = `生圖中 ${payload.value}/${payload.max}`;
  if (event === "preview") el("shot").src = payload.image;
}

function renderHud() {
  el("lives").textContent = "●".repeat(run.lives) + "○".repeat(LIVES - run.lives);
  el("score").textContent = String(run.score);
  el("streak").textContent = String(run.streak);
}

function renderChoices() {
  const box = el("choices");
  box.replaceChildren();
  for (const choice of run.round.question.choices) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn choice";
    btn.textContent = labelOf(lex, choice.tag);
    btn.title = choice.tag;
    btn.addEventListener("click", () => pick(btn, choice));
    box.append(btn);
  }
}

function pick(btn, choice) {
  if (btn.disabled || run.waiting) return;
  btn.disabled = true;
  if (choice.correct) {
    btn.dataset.state = "hit";
    run.found += 1;
    run.score += 1;
    renderHud();
    if (run.found === run.round.question.answers.length) {
      if (run.clean) run.streak += 1;
      renderHud();
      nextRound();
    }
    return;
  }
  btn.dataset.state = "miss";
  run.lives -= 1;
  run.clean = false;
  run.streak = 0;
  renderHud();
  if (run.lives <= 0) finish();
}

async function nextRound() {
  run.waiting = true;
  el("choices").replaceChildren();
  el("shot").removeAttribute("src");
  el("progress").textContent = "準備下一題…";
  let round = null;
  try {
    round = await queue.take();
  } catch (err) {
    el("progress").textContent = "生不出圖：" + err.message;
    return;
  }
  run.round = round;
  run.waiting = false;
  run.found = 0;
  run.clean = true;
  el("shot").src = round.image;
  el("progress").textContent = "";
  renderHud();
  renderChoices();
}

function finish() {
  const question = run.round && run.round.question;
  el("final-score").textContent = String(run.score);
  el("final-streak").textContent = String(run.streak);
  const box = el("answers");
  box.replaceChildren();
  for (const answer of (question && question.answers) || []) {
    const row = document.createElement("div");
    row.className = "answer";
    const zh = document.createElement("span");
    zh.className = "zh";
    zh.textContent = labelOf(lex, answer.tag);
    const en = document.createElement("span");
    en.className = "en";
    en.textContent = answer.tag;
    const sec = document.createElement("span");
    sec.className = "sec";
    sec.textContent = answer.section;
    row.append(zh, en, sec);
    box.append(row);
  }
  el("positive").textContent = (run.round && run.round.draw.positive) || "";
  record = recordRun(record, { score: run.score, streak: run.streak });
  save(window.localStorage, record);
  renderRecords();
  show("over");
}

function renderRecords() {
  el("best").textContent = String(record.best);
  el("best-streak").textContent = String(record.bestStreak);
}

function renderHeats() {
  const row = el("heat");
  row.replaceChildren();
  for (const preset of HEAT_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.textContent = HEAT_LABELS[preset];
    btn.setAttribute("aria-pressed", String(preset === record.heatPreset));
    btn.addEventListener("click", () => {
      record = { ...record, heatPreset: preset };
      save(window.localStorage, record);
      renderHeats();
    });
    row.append(btn);
  }
}

async function start() {
  run = { lives: LIVES, score: 0, streak: 0, found: 0, clean: true, round: null, waiting: true };
  // 佇列只建一次。上一局結束時背景已經生好一題了，「再來」直接接手，不浪費那張圖。
  if (!queue) queue = createQueue({ makeRound, onEvent: onGenEvent });
  show("play");
  renderHud();
  await nextRound();
}

function skip() {
  if (!run || run.waiting) return;
  run.streak = 0;
  renderHud();
  nextRound();
}

async function boot() {
  el("start").disabled = true;
  el("gate-note").textContent = "載入詞庫…";
  data = await fetch("lexicon.json").then((r) => r.json());
  lex = indexLexicon(data);
  banlist = banlistFrom(await fetch("unguessable.json").then((r) => r.json()), lex);
  renderHeats();
  renderRecords();

  const ping = await fetch("/api/ping")
    .then((r) => r.json())
    .catch(() => ({ ok: false }));
  if (!ping.ok) {
    el("gate-note").textContent = "ComfyUI 連不上。先把它開起來再重整。";
    return;
  }
  el("gate-note").textContent = "";
  el("start").disabled = false;
}

el("start").addEventListener("click", start);
el("again").addEventListener("click", start);
el("skip").addEventListener("click", skip);
el("copy").addEventListener("click", () => {
  navigator.clipboard.writeText(el("positive").textContent || "");
});
show("gate");
boot();
