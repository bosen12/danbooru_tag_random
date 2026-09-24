/**
 * 字鋪的一局：開局、接單、付印、換字、結算、逛店、用印材。
 *
 * 整局狀態是一個可以 JSON 化的物件 —— 存檔就是 JSON.stringify(run)。
 * 亂數也存在裡面（run.rng），所以同一顆 seed、同一串操作，結果一模一樣。
 * 這裡不碰 DOM、不碰網路；生圖是 print.js 的事，它只讀 run.prints。
 */
import { evaluate, score, printPositive, HAND_TYPES } from "./rules.js";
import {
  JOKER, JOKERS, MATERIAL, MATERIALS, TYPEFACE, TYPEFACES, VOUCHER, VOUCHERS, PACK, PACKS,
  CUSTOMERS, CUSTOMER, BOSSES, BOSS, FINAL_BOSS, DECK, BLINDS, FINAL_ANTE, anteBase,
  makeRequest, requestMet, REQUEST_BONUS,
} from "./content.js";

export const SAVE_VERSION = 1;
export const INTEREST_CAP = 5;
export const REROLL_BASE = 5;
export const MELT_PRICE = 3;

/** mulberry32，狀態存在 run.rng 裡。 */
export function rand(run) {
  let t = (run.rng = (run.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (run, list) => list[Math.floor(rand(run) * list.length)];
function shuffle(run, list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand(run) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function newRun(world, { seed = (Math.random() * 2 ** 32) >>> 0, deck = "daily" } = {}) {
  const run = {
    v: SAVE_VERSION,
    seed,
    rng: seed >>> 0,
    deckId: DECK[deck] ? deck : "daily",
    ante: 1,
    blind: 0,
    phase: "select",
    money: 4,
    deck: [],
    nextId: 1,
    jokers: [],
    jokerSlots: 5,
    consumables: [],
    consumableSlots: 2,
    levels: {},
    vouchers: [],
    base: { hands: 4, discards: 3, handSize: 8, capacity: 10 },
    antes: {},
    round: null,
    cashout: null,
    shop: null,
    prints: [],
    stats: { hands: 0, bestHand: null, rounds: 0, typeCount: {} },
    endless: false,
  };
  for (const tag of DECK[run.deckId].tags) {
    if (world.byCard.has(tag)) run.deck.push({ id: run.nextId++, tag, enh: null });
  }
  planAnte(world, run);
  return run;
}

/* ---------- 章與委託 ---------- */

// 第一章的貴客不能太兇：只挑「某一種花色不計分」這類看得懂又躲得開的。
const GENTLE = ["critic", "tailor", "diva", "comprador", "fortune", "myopic"];

export function planAnte(world, run) {
  const a = run.ante;
  if (run.antes[a]) return;
  const used = new Set(Object.values(run.antes).flatMap((p) => p.bossRules));
  let bossRules;
  if (a === FINAL_ANTE) {
    const pool = BOSSES.filter((b) => b.id !== "fickle").map((b) => b.id);
    const first = pick(run, pool);
    const second = pick(run, pool.filter((id) => id !== first && !(BOSS[id].mod && BOSS[first].mod)));
    bossRules = [first, second];
  } else {
    const pool = (a === 1 ? GENTLE : BOSSES.map((b) => b.id)).filter((id) => !used.has(id));
    bossRules = [pick(run, pool.length ? pool : BOSSES.map((b) => b.id))];
  }
  const recent = new Set(Object.values(run.antes).flatMap((p) => p.customers).slice(-6));
  const fresh = CUSTOMERS.filter((c) => !recent.has(c.id));
  const c1 = pick(run, fresh);
  const c2 = pick(run, fresh.filter((c) => c.id !== c1.id));
  const tags = run.deck.map((c) => c.tag);
  run.antes[a] = {
    bossRules,
    boss: a === FINAL_ANTE ? FINAL_BOSS.id : bossRules[0],
    customers: [c1.id, c2.id],
    requests: [makeRequest(world, tags, () => rand(run)), makeRequest(world, tags, () => rand(run)), null],
  };
}

/** 這一章的三個委託，給「接單」畫面用。 */
export function blindsOf(run, ante = run.ante) {
  const plan = run.antes[ante];
  return BLINDS.map((b, i) => {
    const boss = i === 2;
    const who = boss
      ? plan.boss === FINAL_BOSS.id
        ? FINAL_BOSS
        : BOSS[plan.boss]
      : CUSTOMER[plan.customers[i]];
    return {
      index: i,
      key: b.key,
      kind: b.zh,
      who,
      rules: boss ? plan.bossRules.map((id) => BOSS[id]) : [],
      target: Math.round(anteBase(ante) * b.mult),
      reward: b.reward,
      request: plan.requests[i],
      state: i < run.blind ? "done" : i === run.blind ? "now" : "later",
    };
  });
}

export function currentBlind(run) {
  return blindsOf(run)[run.blind];
}

function activeRules(run) {
  return run.blind === 2 ? run.antes[run.ante].bossRules.map((id) => BOSS[id]) : [];
}

/** 付印次數、換字次數、手牌、手盒容量：底數 + 升級 + 道具 + 貴客。 */
export function limits(run, { withBoss = true } = {}) {
  const m = { ...run.base };
  const add = (mod) => {
    if (!mod) return;
    for (const k of Object.keys(m)) if (mod[k]) m[k] += mod[k];
  };
  for (const v of run.vouchers) add(VOUCHER[v]?.mod);
  for (const j of run.jokers) add(JOKER[j.id]?.passive);
  if (withBoss) for (const b of activeRules(run)) add(b.mod);
  m.hands = Math.max(1, m.hands);
  m.discards = Math.max(0, m.discards);
  m.handSize = Math.max(5, m.handSize);
  m.capacity = Math.max(4, m.capacity);
  return m;
}

export function cardById(run, id) {
  return run.deck.find((c) => c.id === id) || null;
}

/* ---------- 一個委託 ---------- */

export function startRound(world, run) {
  if (run.phase !== "select") return;
  const b = currentBlind(run);
  const lim = limits(run);
  run.round = {
    target: b.target,
    score: 0,
    hands: lim.hands,
    discards: lim.discards,
    handSize: lim.handSize,
    capacity: lim.capacity,
    draw: shuffle(run, run.deck.map((c) => c.id)),
    hand: [],
    pile: [],
    handIndex: 0,
    typesPlayed: [],
    requestDone: false,
    best: null,
    log: [],
  };
  run.phase = "round";
  drawTo(run);
}

/** 補牌。字盒抽空了就「歸字」：印過的鉛字洗回盒裡再抽 —— 活字鋪本來就是這樣周轉的。 */
function drawTo(run) {
  const r = run.round;
  while (r.hand.length < r.handSize) {
    if (!r.draw.length) {
      if (!r.pile.length) break;
      r.draw = shuffle(run, r.pile);
      r.pile = [];
      r.redistributed = (r.redistributed || 0) + 1;
    }
    r.hand.push(r.draw.shift());
  }
}

function debuffFor(run) {
  const rules = activeRules(run).filter((b) => b.debuff);
  if (!rules.length) return null;
  return (card) => {
    for (const b of rules) {
      const why = b.debuff(card);
      if (why) return why;
    }
    return "";
  };
}

function jokerRefs(run) {
  return run.jokers.map((j) => ({ ...j, def: JOKER[j.id] })).filter((j) => j.def);
}

/** 選牌時的即時預覽。不動狀態、不擲骰（籤筒這種要擲骰的，預覽時當 ×1）。 */
export function preview(world, run, ids) {
  const r = run.round;
  const stick = ids.map((id) => cardById(run, id)).filter(Boolean);
  const ev = evaluate(world, stick, { debuff: debuffFor(run) });
  const zero = zeroReason(run, ev);
  const res = score(world, ev, {
    levels: run.levels,
    jokers: jokerRefs(run).filter((j) => j.id !== "lots"),
    rng: () => 0,
    run,
    handIndex: r ? r.handIndex : 0,
    capacity: r ? r.capacity : limits(run).capacity,
    zero,
  });
  return { ev, res, zero };
}

function zeroReason(run, ev) {
  for (const b of activeRules(run)) {
    if (!b.zeroIf) continue;
    const why = b.zeroIf(ev, run.round);
    if (why) return why;
  }
  return "";
}

export function canPlay(world, run, ids) {
  const r = run.round;
  if (!r || run.phase !== "round" || !ids.length || r.hands <= 0) return false;
  if (!ids.every((id) => r.hand.includes(id))) return false;
  const slots = ids.reduce((s, id) => s + (world.byCard.get(cardById(run, id)?.tag)?.slots || 1), 0);
  return slots <= r.capacity;
}

export function play(world, run, ids) {
  if (!canPlay(world, run, ids)) return null;
  const r = run.round;
  const stick = ids.map((id) => cardById(run, id));
  const ev = evaluate(world, stick, { debuff: debuffFor(run) });
  const zero = zeroReason(run, ev);
  const res = score(world, ev, {
    levels: run.levels,
    jokers: jokerRefs(run),
    rng: () => rand(run),
    run,
    handIndex: r.handIndex,
    capacity: r.capacity,
    zero,
  });
  r.score += res.total;
  r.hands -= 1;
  r.handIndex += 1;
  r.typesPlayed.push(ev.type);
  const entry = {
    ids: [...ids],
    tags: ev.scoring.map((it) => it.card.tag),
    type: ev.type,
    total: res.total,
    positive: printPositive(world, ev),
  };
  r.log.push(entry);
  if (ev.scoring.length && betterPrint(entry, r.best)) r.best = entry;

  let requestJustMet = false;
  const req = run.antes[run.ante].requests[run.blind];
  if (req && !r.requestDone && requestMet(req, ev)) {
    r.requestDone = true;
    requestJustMet = true;
  }

  const s = run.stats;
  s.hands += 1;
  s.typeCount[ev.type] = (s.typeCount[ev.type] || 0) + 1;
  if (!s.bestHand || res.total > s.bestHand.total) s.bestHand = { ...entry, ante: run.ante };

  r.hand = r.hand.filter((id) => !ids.includes(id));
  r.pile.push(...ids);

  let outcome = "continue";
  if (r.score >= r.target) {
    outcome = "won";
    finishRound(world, run);
  } else if (r.hands <= 0) {
    outcome = "lost";
    run.phase = "over";
    run.over = { ante: run.ante, blind: run.blind, score: r.score, target: r.target };
  } else {
    drawTo(run);
  }
  return { ev, res, outcome, requestJustMet, zero };
}

/** 哪一版拿去印：三個字以上的才畫得成一張圖，先比這個，再比分數。 */
function betterPrint(entry, best) {
  if (!best) return true;
  const full = entry.tags.length >= 3;
  const bestFull = best.tags.length >= 3;
  if (full !== bestFull) return full;
  return entry.total >= best.total;
}

export function discard(world, run, ids) {
  const r = run.round;
  if (!r || run.phase !== "round" || r.discards <= 0 || !ids.length) return false;
  if (!ids.every((id) => r.hand.includes(id))) return false;
  r.discards -= 1;
  r.hand = r.hand.filter((id) => !ids.includes(id));
  r.pile.push(...ids);
  drawTo(run);
  return true;
}

/** 委託完成：算錢、排一張作品去印。錢在 collect() 才真正入帳，讓結算畫面有東西演。 */
function finishRound(world, run) {
  const r = run.round;
  const b = currentBlind(run);
  const lines = [{ label: `${b.kind}・${b.who.zh}的報酬`, amount: b.reward }];
  if (r.hands > 0) lines.push({ label: `剩下 ${r.hands} 次付印`, amount: r.hands });
  if (r.requestDone) lines.push({ label: "附加委託", amount: REQUEST_BONUS });
  const interest = Math.min(INTEREST_CAP, Math.floor(run.money / 5));
  if (interest > 0) lines.push({ label: "利息（每 5 兩 1 兩）", amount: interest });
  for (const j of jokerRefs(run)) {
    const pay = j.def.payout ? j.def.payout(j, run) : 0;
    if (pay) lines.push({ label: j.def.zh, amount: pay });
  }
  const printId = r.best ? queuePrint(run, r.best, b) : null;
  for (const j of run.jokers) {
    const def = JOKER[j.id];
    if (printId && def?.onPrint) def.onPrint(j);
  }
  run.stats.rounds += 1;
  run.cashout = { lines, total: lines.reduce((s, l) => s + l.amount, 0), printId, score: r.score, target: r.target };
  run.phase = "cashout";
}

function queuePrint(run, best, blind) {
  const id = `p${run.ante}-${run.blind}-${run.seed}`;
  run.prints.push({
    id,
    ante: run.ante,
    blind: run.blind,
    who: blind.who.zh,
    whoId: blind.who.id,
    type: best.type,
    total: best.total,
    tags: best.tags,
    positive: best.positive,
    seed: (run.seed ^ (run.ante * 7919 + run.blind * 104729)) >>> 0,
    status: "queued",
    image: null,
  });
  return id;
}

/** 收錢，前往商店。打完最後一章的貴客就是贏了。 */
export function collect(world, run) {
  if (run.phase !== "cashout") return;
  run.money += run.cashout.total;
  const wasBoss = run.blind === 2;
  const finalWin = wasBoss && run.ante === FINAL_ANTE && !run.endless;
  run.round = null;
  if (wasBoss) {
    run.ante += 1;
    run.blind = 0;
  } else {
    run.blind += 1;
  }
  run.cashout = null;
  if (finalWin) {
    run.phase = "won";
    return;
  }
  planAnte(world, run);
  openShop(world, run);
}

/** 贏了之後繼續開鋪：沒有終點，門檻一路往上。 */
export function goEndless(world, run) {
  if (run.phase !== "won") return;
  run.endless = true;
  planAnte(world, run);
  openShop(world, run);
}

/* ---------- 商店 ---------- */

function rollJoker(run, exclude) {
  const r = rand(run);
  const rarity = r < 0.7 ? 1 : r < 0.95 ? 2 : 3;
  let pool = JOKERS.filter((j) => j.rarity === rarity && !exclude.has(j.id));
  if (!pool.length) pool = JOKERS.filter((j) => !exclude.has(j.id));
  return pool.length ? pick(run, pool) : null;
}

function rollItem(run, taken) {
  const r = rand(run);
  if (r < 0.62) {
    const j = rollJoker(run, taken);
    if (j) {
      taken.add(j.id);
      return { kind: "joker", id: j.id, price: j.price };
    }
  }
  if (r < 0.84) {
    const pool = TYPEFACES.filter((t) => !taken.has(t.id));
    const t = pick(run, pool.length ? pool : TYPEFACES);
    taken.add(t.id);
    return { kind: "typeface", id: t.id, price: t.price };
  }
  const pool = MATERIALS.filter((m) => !taken.has(m.id));
  const m = pick(run, pool.length ? pool : MATERIALS);
  taken.add(m.id);
  return { kind: "material", id: m.id, price: m.price };
}

function openShop(world, run) {
  const taken = new Set(run.jokers.map((j) => j.id));
  const voucherPool = VOUCHERS.filter((v) => !run.vouchers.includes(v.id));
  const prev = run.shop && run.shop.ante === run.ante ? run.shop.voucher : null;
  run.shop = {
    ante: run.ante,
    items: [0, 1, 2].map(() => rollItem(run, taken)),
    packs: [pick(run, PACKS).id, pick(run, PACKS).id].map((id) => ({ id, price: PACK[id].price, sold: false })),
    voucher: prev !== null ? prev : voucherPool.length ? { id: pick(run, voucherPool).id, sold: false } : null,
    rerolls: 0,
    melted: false,
    open: null,
  };
  if (run.shop.voucher && run.vouchers.includes(run.shop.voucher.id)) run.shop.voucher.sold = true;
  run.phase = "shop";
}

export function rerollCost(run) {
  return REROLL_BASE + (run.shop ? run.shop.rerolls : 0);
}

export function reroll(world, run) {
  const s = run.shop;
  if (!s || s.open) return false;
  const cost = rerollCost(run);
  if (run.money < cost) return false;
  run.money -= cost;
  s.rerolls += 1;
  const taken = new Set(run.jokers.map((j) => j.id));
  s.items = [0, 1, 2].map(() => rollItem(run, taken));
  return true;
}

export function buyItem(world, run, index) {
  const s = run.shop;
  const it = s && s.items[index];
  if (!it || it.sold || s.open || run.money < it.price) return { ok: false, why: "錢不夠" };
  if (it.kind === "joker" && run.jokers.length >= run.jokerSlots) return { ok: false, why: "道具欄滿了" };
  if (it.kind === "material" && run.consumables.length >= run.consumableSlots) return { ok: false, why: "印材欄滿了" };
  run.money -= it.price;
  it.sold = true;
  if (it.kind === "joker") run.jokers.push({ id: it.id, state: {} });
  if (it.kind === "material") run.consumables.push({ id: it.id });
  if (it.kind === "typeface") levelUp(run, TYPEFACE[it.id].type);
  return { ok: true };
}

export function levelUp(run, type) {
  run.levels[type] = (run.levels[type] || 1) + 1;
}

export function buyVoucher(world, run) {
  const v = run.shop && run.shop.voucher;
  if (!v || v.sold || run.shop.open) return { ok: false };
  const def = VOUCHER[v.id];
  if (run.money < def.price) return { ok: false, why: "錢不夠" };
  run.money -= def.price;
  v.sold = true;
  run.vouchers.push(v.id);
  return { ok: true };
}

export function buyPack(world, run, index) {
  const s = run.shop;
  const p = s && s.packs[index];
  if (!p || p.sold || s.open || run.money < p.price) return { ok: false, why: "錢不夠" };
  run.money -= p.price;
  p.sold = true;
  const def = PACK[p.id];
  let choices = [];
  if (def.kind === "cards") {
    for (let i = 0; i < def.show; i++) {
      const rare = rand(run) < 0.3;
      const pool = world.cards.filter((c) => c.rare === rare);
      choices.push({ kind: "card", tag: pick(run, pool).tag });
    }
  } else if (def.kind === "typefaces") {
    choices = shuffle(run, TYPEFACES).slice(0, def.show).map((t) => ({ kind: "typeface", id: t.id }));
  } else {
    choices = shuffle(run, MATERIALS).slice(0, def.show).map((m) => ({ kind: "material", id: m.id }));
  }
  s.open = { pack: p.id, choices };
  return { ok: true };
}

export function choosePack(world, run, index) {
  const s = run.shop;
  if (!s || !s.open) return { ok: false };
  const c = s.open.choices[index];
  if (!c) return { ok: false };
  if (c.kind === "material" && run.consumables.length >= run.consumableSlots) return { ok: false, why: "印材欄滿了" };
  if (c.kind === "card") run.deck.push({ id: run.nextId++, tag: c.tag, enh: null });
  if (c.kind === "typeface") levelUp(run, TYPEFACE[c.id].type);
  if (c.kind === "material") run.consumables.push({ id: c.id });
  s.open = null;
  return { ok: true, choice: c };
}

export function skipPack(world, run) {
  if (run.shop) run.shop.open = null;
}

export function sellPrice(j) {
  return Math.max(1, Math.floor((JOKER[j.id]?.price || 2) / 2));
}

export function sellJoker(world, run, index) {
  const j = run.jokers[index];
  if (!j) return false;
  run.money += sellPrice(j);
  run.jokers.splice(index, 1);
  return true;
}

export function sellConsumable(world, run, index) {
  const c = run.consumables[index];
  if (!c) return false;
  run.money += 1;
  run.consumables.splice(index, 1);
  return true;
}

export function moveJoker(run, from, to) {
  if (from === to || from < 0 || to < 0 || from >= run.jokers.length || to >= run.jokers.length) return;
  const [j] = run.jokers.splice(from, 1);
  run.jokers.splice(to, 0, j);
}

export function melt(world, run, cardId) {
  const s = run.shop;
  if (!s || s.melted || run.money < MELT_PRICE || run.deck.length <= 20) return false;
  const i = run.deck.findIndex((c) => c.id === cardId);
  if (i < 0) return false;
  run.money -= MELT_PRICE;
  run.deck.splice(i, 1);
  s.melted = true;
  return true;
}

export function leaveShop(world, run) {
  if (run.phase !== "shop" || (run.shop && run.shop.open)) return;
  run.phase = "select";
}

/* ---------- 印材 ---------- */

export function useMaterial(world, run, index, ids = []) {
  const c = run.consumables[index];
  const def = c && MATERIAL[c.id];
  if (!def) return { ok: false };
  if (def.target > 0) {
    if (run.phase !== "round") return { ok: false, why: "在委託裡才能用在手牌上" };
    if (!ids.length || ids.length > def.target || !ids.every((id) => run.round.hand.includes(id))) {
      return { ok: false, why: def.target === 1 ? "先選 1 張手牌" : `先選 1 到 ${def.target} 張手牌` };
    }
  }
  const cards = ids.map((id) => cardById(run, id));
  switch (def.id) {
    case "gold":
    case "seal":
    case "bronze":
      cards[0].enh = def.id;
      break;
    case "dup": {
      const copy = { id: run.nextId++, tag: cards[0].tag, enh: cards[0].enh };
      run.deck.push(copy);
      run.round.hand.push(copy.id);
      break;
    }
    case "recut": {
      const card = world.byCard.get(cards[0].tag);
      const same = world.cards.filter((o) => o.tag !== card.tag && (card.mutex ? o.mutex === card.mutex : o.group === card.group));
      if (!same.length) return { ok: false, why: "這個字沒有同類可以改" };
      cards[0].tag = pick(run, same).tag;
      break;
    }
    case "melt":
      for (const card of cards) {
        run.deck = run.deck.filter((o) => o.id !== card.id);
        run.round.hand = run.round.hand.filter((id) => id !== card.id);
      }
      break;
    case "purse":
      run.money += Math.min(20, run.money);
      break;
    default:
      return { ok: false };
  }
  run.consumables.splice(index, 1);
  return { ok: true, def };
}

/* ---------- 其他 ---------- */

export function typeRows(run) {
  return HAND_TYPES.map((t) => ({ ...t, level: run.levels[t.key] || 1, played: run.stats.typeCount[t.key] || 0 }));
}

export function drawPileCount(run) {
  return run.round ? run.round.draw.length : run.deck.length;
}

export function sortHand(world, run, by) {
  const r = run.round;
  if (!r) return;
  const order = { look: 0, wear: 1, pose: 2, scene: 3 };
  const key = (id) => {
    const card = world.byCard.get(cardById(run, id)?.tag);
    if (!card) return [9, 0];
    return by === "slots" ? [card.slots, order[card.suit]] : [order[card.suit], card.slots];
  };
  r.hand.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || a - b;
  });
}
