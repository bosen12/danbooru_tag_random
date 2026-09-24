#!/usr/bin/env node
/**
 * 字鋪的平衡模擬：一個貪心的機器人照規則打完整局，統計它走到第幾章。
 *
 *   node scripts/sim_zipu.mjs            # 每副字盒 60 局
 *   node scripts/sim_zipu.mjs 200 daily  # 指定局數、字盒
 *
 * 機器人不用印材、不懂道具的連動，只會「挑眼前最高分的一版」和「買得起就買道具」。
 * 所以它的成績是地板：真人應該打得比它好。目標是它平均走到第 4～5 章、偶爾打穿。
 */
import { loadWorld } from "./zipu_pool.mjs";
import {
  newRun, startRound, preview, play, discard, collect, buyItem, buyVoucher, leaveShop, blindsOf,
  limits, cardById,
} from "../zipu/run.js";
import { JOKER, TYPEFACE, VOUCHER, DECKS, FINAL_ANTE } from "../zipu/content.js";

const world = loadWorld();
const N = Number(process.argv[2]) || 60;
const decks = process.argv[3] ? [process.argv[3]] : DECKS.map((d) => d.id);

function subsets(ids, capacity, run) {
  const out = [];
  const n = ids.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const pickIds = [];
    let slots = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        pickIds.push(ids[i]);
        slots += world.byCard.get(cardById(run, ids[i]).tag).slots;
      }
    }
    if (slots <= capacity) out.push(pickIds);
  }
  return out;
}

function bestPlay(run) {
  const r = run.round;
  let best = null;
  for (const ids of subsets(r.hand, r.capacity, run)) {
    const { res } = preview(world, run, ids);
    if (!best || res.total > best.total) best = { ids, total: res.total };
  }
  return best;
}

function roundTurn(run) {
  const r = run.round;
  const best = bestPlay(run);
  const need = (r.target - r.score) / r.hands;
  if (r.discards > 0 && best.total < need && r.hands > 1) {
    const keep = new Set(best.ids);
    const toss = r.hand.filter((id) => !keep.has(id)).slice(0, 5);
    if (toss.length && discard(world, run, toss)) return;
  }
  play(world, run, best.ids);
}

function shopTurn(run) {
  const s = run.shop;
  const order = s.items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => !it.sold)
    .sort((a, b) => b.it.price - a.it.price);
  for (const { it, i } of order) {
    if (it.kind === "joker") buyItem(world, run, i);
  }
  const fav = Object.entries(run.stats.typeCount).sort((a, b) => b[1] - a[1])[0];
  s.items.forEach((it, i) => {
    if (!it.sold && it.kind === "typeface" && fav && TYPEFACE[it.id].type === fav[0]) buyItem(world, run, i);
  });
  if (s.voucher && !s.voucher.sold && run.money >= VOUCHER[s.voucher.id].price + 5) buyVoucher(world, run);
  leaveShop(world, run);
}

function playRun(seed, deck) {
  const run = newRun(world, { seed, deck });
  let guard = 0;
  while (guard++ < 5000) {
    if (run.phase === "select") startRound(world, run);
    else if (run.phase === "round") roundTurn(run);
    else if (run.phase === "cashout") collect(world, run);
    else if (run.phase === "shop") shopTurn(run);
    else break;
  }
  return run;
}

for (const deck of decks) {
  const reached = [];
  let wins = 0;
  let best = 0;
  const types = {};
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const run = playRun(1000 + i, deck);
    const ante = run.phase === "won" ? FINAL_ANTE + 1 : run.ante + run.blind / 3;
    reached.push(ante);
    if (run.phase === "won") wins++;
    best = Math.max(best, run.stats.bestHand?.total || 0);
    for (const [k, v] of Object.entries(run.stats.typeCount)) types[k] = (types[k] || 0) + v;
  }
  reached.sort((a, b) => a - b);
  const avg = reached.reduce((s, v) => s + v, 0) / N;
  const hist = {};
  for (const a of reached) hist[Math.floor(a)] = (hist[Math.floor(a)] || 0) + 1;
  console.log(
    `${deck}: avg ante ${avg.toFixed(2)}  median ${reached[N >> 1].toFixed(2)}  wins ${wins}/${N}  best hand ${best}  (${((Date.now() - t0) / N).toFixed(0)}ms/run)`
  );
  console.log("  reached", JSON.stringify(hist));
  const total = Object.values(types).reduce((s, v) => s + v, 0);
  console.log("  types", Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${((v / total) * 100).toFixed(0)}%`).join("  "));
}
