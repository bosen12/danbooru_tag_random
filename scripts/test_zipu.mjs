#!/usr/bin/env node
/** 字鋪：牌池、計分、流程的回歸測試。失敗就印出來並 exit 1。秒跑完，不需要 ComfyUI。 */
import { loadWorld } from "./zipu_pool.mjs";
import { artPrompt, EXCLUDE_TAGS } from "../zipu/pool.js";
import { evaluate, score, printPositive, HAND_TYPES } from "../zipu/rules.js";
import { JOKERS, JOKER, DECKS, BOSSES, CUSTOMERS, MATERIALS, TYPEFACES } from "../zipu/content.js";
import {
  newRun, startRound, play, discard, collect, buyItem, leaveShop, preview, useMaterial, limits,
  blindsOf, cardById, canPlay,
} from "../zipu/run.js";

const world = loadWorld();
let failed = 0;
function ok(name, cond, detail) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL ${name}${detail ? "\n  " + detail : ""}`);
  } else console.log(`ok   ${name}`);
}
let nextId = 1;
const inst = (...tags) => tags.map((tag) => ({ id: nextId++, tag, enh: null }));
const ev = (...tags) => evaluate(world, inst(...tags));
const status = (e) => e.items.map((it) => `${it.card?.tag}:${it.status}`).join(" ");

/* ---------- 牌池 ---------- */
{
  ok("pool has cards in every suit", ["look", "wear", "pose", "scene"].every((s) => world.cards.some((c) => c.suit === s)));
  ok("excluded tags never become cards", [...EXCLUDE_TAGS].every((t) => !world.byCard.has(t)));
  ok("loli is not a card", !world.byCard.has("loli"));
  ok("male-only tags are not cards", world.cards.every((c) => world.byTag.get(c.tag).gate !== "male"));
  ok("every card has chips and 1-5 slots", world.cards.every((c) => c.chips > 0 && c.slots >= 1 && c.slots <= 5));
  for (const d of DECKS) {
    const missing = d.tags.filter((t) => !world.byCard.has(t));
    ok(`starter deck ${d.id} is all real cards`, missing.length === 0, missing.join(", "));
    ok(`starter deck ${d.id} has 9 of each suit`, ["look", "wear", "pose", "scene"].every((s) => d.tags.filter((t) => world.byCard.get(t)?.suit === s).length === 9));
  }
  const p = artPrompt(world, world.byCard.get("basketball court"));
  ok("art prompt carries what the card implies", p.includes("outdoors"), p);
  ok("object cards are drawn as still life", artPrompt(world, world.byCard.get("teapot")).includes("still life"));
  ok("art prompts are general-rated", world.cards.every((c) => artPrompt(world, c).includes("sfw, general")));
}

/* ---------- 撞字、時代、附帶 ---------- */
{
  let e = ev("black hair", "red hair");
  ok("same mutex group: the later card burns", e.items[0].status === "ok" && e.items[1].status === "clash", status(e));
  ok("burned card points at who it clashed with", e.items[1].clashWith === e.items[0].inst.id);

  e = ev("red hair", "red hair");
  ok("the same word twice burns the second", e.items[1].status === "clash", status(e));

  e = ev("basketball court", "library");
  ok("two places clash", e.items[1].status === "clash", status(e));

  e = ev("day", "night");
  ok("day and night clash", e.items[1].status === "clash", status(e));

  e = ev("kimono", "hoodie", "cafe");
  ok("era vote: the modern majority burns the edo card", e.era === "modern" && e.items[0].status === "era", status(e));

  e = ev("kimono", "shrine", "umbrella");
  ok("era vote: edo wins, any-era cards stay", e.era === "edo" && e.items.every((it) => it.status === "ok"), status(e));

  e = ev("kimono");
  ok("implied words ride along as ghosts", e.items[0].ghosts.includes("japanese clothes"), JSON.stringify(e.items[0].ghosts));
}

/* ---------- 牌型 ---------- */
{
  ok("four suits make 全版", ev("red hair", "dress", "smile", "library").type === "full");
  ok("three suits make 三拼", ev("red hair", "dress", "smile").type === "trio");
  ok("one card is 散字", ev("red hair").type === "loose");
  ok("four of one suit make 一色", ev("red hair", "long hair", "ponytail", "blue eyes").type === "mono");
  const era = ev("kimono", "yukata", "geta", "shrine");
  ok("three edo cards make 同代", era.type === "era" || era.type === "eraFull", `${era.type} ${status(era)}`);
  const eraFull = ev("hime cut", "kimono", "geta", "seiza", "torii");
  ok("four suits + three edo cards make 時代全版", eraFull.type === "eraFull", `${eraFull.type} era=${eraFull.era} n=${eraFull.eraCount} ${status(eraFull)}`);
  const set = ev("tennis court", "tennis racket", "tennis ball");
  ok("venue + gear make 成套", set.type === "set", `${set.type} ${status(set)}`);
  const pair = ev("reading", "library");
  ok("reading + library is a 呼應", pair.pairs.length === 1);
  ok("rain + umbrella is a 呼應", ev("rain", "umbrella").pairs.length === 1);
  ok("hand types are ordered strongest first", HAND_TYPES[0].key === "eraFull" && HAND_TYPES.at(-1).key === "loose");
}

/* ---------- 計分 ---------- */
{
  const e = ev("red hair", "dress", "reading", "library");
  const r = score(world, e, {});
  const fin = r.steps.at(-1);
  ok("total is floor(chips × mult)", r.total === Math.floor(r.chips * r.mult) && fin.total === r.total);
  const cardChips = e.scoring.reduce((s, it) => s + it.card.chips, 0);
  const ghostChips = e.scoring.reduce((s, it) => s + it.ghosts.length * 4, 0);
  ok("chips = type + cards + ghosts", r.chips === 30 + cardChips + ghostChips, `${r.chips} vs ${30 + cardChips + ghostChips}`);
  ok("mult = type + pairs", r.mult === 3 + 2 * e.pairs.length, `${r.mult}`);

  const withJoker = score(world, e, { jokers: [{ id: "vermilion", def: JOKER.vermilion, state: {} }] });
  ok("朱墨 adds 4 mult", withJoker.mult === r.mult + 4);
  const x = score(world, e, { jokers: [{ id: "folio", def: JOKER.folio, state: {} }] });
  ok("四開版 multiplies a 全版 by 1.5", Math.abs(x.mult - r.mult * 1.5) < 1e-9);
  const mirror = score(world, e, { jokers: [{ id: "mirror", def: JOKER.mirror, state: {} }] });
  ok("反字鏡 scores the last card twice", mirror.chips === r.chips + e.scoring.at(-1).card.chips);
  const zero = score(world, e, { zero: "test" });
  ok("a boss zero wipes the hand", zero.total === 0);

  const burned = ev("black hair", "red hair");
  const br = score(world, burned, {});
  ok("burned cards don't score", br.steps.filter((s) => s.at === "card").length === 1);

  const pos = printPositive(world, e);
  ok("print POS starts with the cast and ends with the quality tail", pos.startsWith("1girl, solo, adult, red hair") && pos.endsWith("amazing quality"), pos);
  ok("print POS is general-rated", pos.includes("sfw, general"));
}

/* ---------- 內容 ---------- */
{
  ok("jokers have unique ids", new Set(JOKERS.map((j) => j.id)).size === JOKERS.length);
  ok("every joker does something", JOKERS.every((j) => j.card || j.hand || j.passive || j.payout || j.retrigger));
  ok("bosses each have one rule", BOSSES.every((b) => b.rule && (b.debuff || b.mod || b.zeroIf)));
  ok("customers have portraits", CUSTOMERS.every((c) => c.portrait && c.hello));
  ok("materials and typefaces exist", MATERIALS.length >= 5 && TYPEFACES.length === HAND_TYPES.length);
}

/* ---------- 流程 ---------- */
{
  const a = newRun(world, { seed: 42, deck: "daily" });
  const b = newRun(world, { seed: 42, deck: "daily" });
  startRound(world, a);
  startRound(world, b);
  ok("same seed deals the same hand", JSON.stringify(a.round.hand) === JSON.stringify(b.round.hand));
  ok("hand is 8 cards", a.round.hand.length === 8);
  ok("first commission targets 300", a.round.target === 300);

  const ids = a.round.hand.slice(0, 3);
  const pv = preview(world, a, ids);
  const res = play(world, a, ids);
  ok("preview matches the real score when no dice are rolled", pv.res.total === res.res.total, `${pv.res.total} vs ${res.res.total}`);
  ok("playing spends a hand", a.round.hands === 3);
  ok("hand refills to 8", a.round.hand.length === 8);

  const before = a.round.discards;
  discard(world, a, a.round.hand.slice(0, 2));
  ok("discarding spends a discard", a.round.discards === before - 1 && a.round.hand.length === 8);

  const saved = JSON.parse(JSON.stringify(a));
  ok("a run survives a JSON round trip", JSON.stringify(saved) === JSON.stringify(a));

  // 打到過關：直接把分數灌滿，確認流程走到結算、商店、下一個委託。
  a.round.score = a.round.target - 1;
  const again = play(world, a, a.round.hand.slice(0, 1));
  ok("reaching the target wins the commission", again.outcome === "won" && a.phase === "cashout");
  ok("a won commission queues a print", a.prints.length === 1 && a.prints[0].positive.includes("sfw, general"));
  const money = a.money;
  collect(world, a);
  ok("collecting pays out and opens the shop", a.phase === "shop" && a.money > money && a.shop.items.length === 3);
  a.money = 100;
  const j = a.shop.items.findIndex((it) => it.kind === "joker");
  if (j >= 0) {
    buyItem(world, a, j);
    ok("buying a joker puts it in the slots", a.jokers.length === 1);
  }
  leaveShop(world, a);
  ok("leaving the shop goes to the next commission", a.phase === "select" && a.blind === 1);

  const c = newRun(world, { seed: 7 });
  c.consumables.push({ id: "gold" });
  startRound(world, c);
  const target = c.round.hand[0];
  const used = useMaterial(world, c, 0, [target]);
  ok("金箔 gilds the chosen card", used.ok && cardById(c, target).enh === "gold");

  const d = newRun(world, { seed: 9 });
  d.blind = 2;
  const boss = blindsOf(d)[2];
  ok("the third commission is a boss", boss.rules.length >= 1 && boss.target === 600);
  d.base.capacity = 3;
  ok("capacity never drops below 4", limits(d).capacity >= 4);
  startRound(world, d);
  const huge = d.round.hand.slice(0, 8);
  const slots = huge.reduce((s, id) => s + world.byCard.get(cardById(d, id).tag).slots, 0);
  ok("can't play past the stick's capacity", slots <= d.round.capacity || !canPlay(world, d, huge));
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall zipu tests passed");
