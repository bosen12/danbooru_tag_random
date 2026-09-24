/**
 * 字鋪的計分：一版字 → 牌型、撞字、附帶、呼應 → 一串計分步驟 → 分數。
 *
 * 純函式，不碰 DOM、不碰網路、不自己擲骰（要亂數就由呼叫端傳 rng）。
 * 畫面上的計分動畫就是照著 steps 一格一格播，所以「動畫演的」和「實際算的」不可能不一致。
 */
import { HISTORIC_ERAS, ERA_ZH, SUIT_INFO } from "./pool.js";

export const HAND_TYPES = [
  { key: "eraFull", zh: "時代全版", chips: 80, mult: 7, lvChips: 40, lvMult: 4, desc: "四種花色都有，而且三張以上出自同一個古代" },
  { key: "set", zh: "成套", chips: 60, mult: 6, lvChips: 35, lvMult: 3, desc: "同一項運動的三樣東西，其中一樣是場地" },
  { key: "era", zh: "同代", chips: 40, mult: 4, lvChips: 25, lvMult: 3, desc: "三張以上出自同一個古代（江戶、維多利亞、中世紀、古中國、古希臘）" },
  { key: "mono", zh: "一色", chips: 35, mult: 4, lvChips: 25, lvMult: 2, desc: "四張以上，全部同一種花色" },
  { key: "full", zh: "全版", chips: 30, mult: 3, lvChips: 25, lvMult: 2, desc: "長相、服裝、姿勢、場景四種花色都有" },
  { key: "trio", zh: "三拼", chips: 20, mult: 2, lvChips: 20, lvMult: 2, desc: "三種花色" },
  { key: "duo", zh: "兩拼", chips: 10, mult: 2, lvChips: 15, lvMult: 1, desc: "兩種花色" },
  { key: "loose", zh: "散字", chips: 5, mult: 1, lvChips: 10, lvMult: 1, desc: "只有一種花色" },
];
export const HAND_TYPE = Object.fromEntries(HAND_TYPES.map((t) => [t.key, t]));

export const GHOST_CHIPS = 4;
export const PAIR_MULT = 2;
export const ENHANCEMENTS = {
  gold: { zh: "燙金", desc: "計分時 +30 籌碼" },
  seal: { zh: "朱印", desc: "計分時 +4 倍率" },
  bronze: { zh: "銅模", desc: "計分時 ×1.5 倍率" },
};

export function typeValue(key, level = 1) {
  const t = HAND_TYPE[key];
  const up = Math.max(0, level - 1);
  return { chips: t.chips + t.lvChips * up, mult: t.mult + t.lvMult * up };
}

export function slotsOf(world, stick) {
  let n = 0;
  for (const inst of stick) n += (world.byCard.get(inst.tag) || { slots: 1 }).slots;
  return n;
}

/**
 * 判一版字。stick 是牌的實例（{id, tag, enh}），順序就是排進手盒的順序 ——
 * 撞字時燒掉的是後排進去的那張。
 *
 * opts.debuff(card) 回傳字串就代表這張被貴客擋掉（字串是理由）。
 */
export function evaluate(world, stick, opts = {}) {
  const items = stick.map((inst) => ({
    inst,
    card: world.byCard.get(inst.tag) || null,
    status: "ok",
    reason: "",
    clashWith: null,
    ghosts: [],
  }));

  const accepted = [];
  const owner = new Map();
  const mutexOwner = new Map();
  for (const it of items) {
    const card = it.card;
    if (!card) {
      it.status = "void";
      continue;
    }
    const why = opts.debuff ? opts.debuff(card, it.inst) : "";
    if (why) {
      it.status = "debuff";
      it.reason = why;
      continue;
    }
    if (owner.has(card.tag)) {
      burn(it, "clash", owner.get(card.tag), "重複的字");
      continue;
    }
    if (card.mutex && mutexOwner.has(card.mutex)) {
      const other = mutexOwner.get(card.mutex);
      burn(it, "clash", other, `跟「${zhOf(world, other.tag)}」撞字`);
      continue;
    }
    const ghosts = card.implies.filter((t) => !owner.has(t) && t !== card.tag);
    const mine = [card.tag, ...ghosts];
    const culprit = accepted.find((t) => mine.some((m) => world.clashPair(t, m)));
    if (culprit) {
      burn(it, "clash", owner.get(culprit), `跟「${zhOf(world, culprit)}」矛盾`);
      continue;
    }
    it.ghosts = ghosts;
    for (const t of mine) {
      accepted.push(t);
      owner.set(t, it.inst);
      const m = t === card.tag ? card.mutex : world.byTag.get(t)?.mutex;
      if (m && !mutexOwner.has(m)) mutexOwner.set(m, it.inst);
    }
  }

  // 時代：留下來的牌投票，票最多的年代就是這張圖的年代；同票時先排進去的贏。
  const votes = new Map();
  for (const it of items) {
    if (it.status !== "ok") continue;
    for (const e of it.card.eras) if (e !== "any") votes.set(e, (votes.get(e) || 0) + 1);
  }
  let era = null;
  let best = 0;
  for (const it of items) {
    if (it.status !== "ok") continue;
    for (const e of it.card.eras) {
      if (e !== "any" && votes.get(e) > best) {
        best = votes.get(e);
        era = e;
      }
    }
  }
  if (era) {
    for (const it of items) {
      if (it.status !== "ok") continue;
      const e = it.card.eras;
      if (!e.includes("any") && !e.includes(era)) {
        it.status = "era";
        it.reason = `不合${ERA_ZH[era]}`;
        it.ghosts = [];
      }
    }
  }

  const scoring = items.filter((it) => it.status === "ok");
  const suits = new Set(scoring.map((it) => it.card.suit));
  const historic = era && HISTORIC_ERAS.includes(era);
  const eraCount = historic ? scoring.filter((it) => it.card.eras.includes(era)).length : 0;

  const present = new Set();
  for (const it of scoring) for (const t of [it.card.tag, ...it.ghosts]) present.add(t);
  let set = null;
  for (const s of world.sets) {
    const have = [...present].filter((t) => s.tags.has(t));
    if (have.length >= 3 && have.some((t) => s.venue.has(t))) {
      set = s;
      break;
    }
  }

  const pairs = [];
  for (let i = 0; i < scoring.length; i++) {
    const mine = world.pairs.get(scoring[i].card.tag);
    if (!mine) continue;
    for (let j = i + 1; j < scoring.length; j++) {
      if (mine.has(scoring[j].card.tag)) pairs.push([scoring[i].inst.id, scoring[j].inst.id]);
    }
  }

  const full = suits.size === 4;
  const isEra = eraCount >= 3;
  let type = "loose";
  if (full && isEra) type = "eraFull";
  else if (set) type = "set";
  else if (isEra) type = "era";
  else if (scoring.length >= 4 && suits.size === 1) type = "mono";
  else if (full) type = "full";
  else if (suits.size === 3) type = "trio";
  else if (suits.size === 2) type = "duo";

  return {
    items,
    scoring,
    type,
    era,
    eraCount,
    suits,
    set,
    pairs,
    slots: slotsOf(world, stick),
    burned: items.filter((it) => it.status === "clash" || it.status === "era").length,
  };
}

function burn(it, status, other, reason) {
  it.status = status;
  it.clashWith = other ? other.id : null;
  it.reason = reason;
}

function zhOf(world, tag) {
  return world.byTag.get(tag)?.zh || tag;
}

/**
 * 算分。ctx：
 *   levels     {typeKey: level}
 *   jokers     [{def, state}]  道具，照擺放順序觸發
 *   rng        () => [0,1)，只有需要擲骰的道具會用
 *   run        目前這局的狀態（道具要看錢、看已印張數時用）
 *   handIndex  這個委託裡第幾次付印（0 起算）
 *   capacity   手盒容量
 *   zero       貴客判這版不計分時給理由字串
 */
export function score(world, ev, ctx = {}) {
  const levels = ctx.levels || {};
  const jokers = ctx.jokers || [];
  const base = typeValue(ev.type, levels[ev.type] || 1);
  let chips = base.chips;
  let mult = base.mult;
  const steps = [{ at: "type", type: ev.type, chips, mult }];

  const apply = (step, eff) => {
    if (!eff) return;
    if (eff.chips) chips += eff.chips;
    if (eff.mult) mult += eff.mult;
    if (eff.xmult) mult *= eff.xmult;
    steps.push({ ...step, ...eff, total: { chips, mult } });
  };

  const hctx = { world, ev, run: ctx.run || {}, rng: ctx.rng || Math.random, handIndex: ctx.handIndex || 0, capacity: ctx.capacity || 10 };

  ev.scoring.forEach((it, index) => {
    const isFirst = index === 0;
    const isLast = index === ev.scoring.length - 1;
    let times = 1;
    for (const j of jokers) times += (j.def.retrigger && j.def.retrigger(j, { it, index, isFirst, isLast }, hctx)) || 0;
    for (let n = 0; n < times; n++) {
      apply({ at: "card", id: it.inst.id, again: n > 0 }, { chips: it.card.chips });
      const enh = it.inst.enh;
      if (enh === "gold") apply({ at: "enh", id: it.inst.id, enh }, { chips: 30 });
      if (enh === "seal") apply({ at: "enh", id: it.inst.id, enh }, { mult: 4 });
      if (enh === "bronze") apply({ at: "enh", id: it.inst.id, enh }, { xmult: 1.5 });
      for (let k = 0; k < jokers.length; k++) {
        const j = jokers[k];
        if (!j.def.card) continue;
        apply({ at: "joker", idx: k, id: it.inst.id }, j.def.card(j, { it, index, isFirst, isLast }, hctx));
      }
    }
    for (const g of it.ghosts) apply({ at: "ghost", id: it.inst.id, tag: g }, { chips: GHOST_CHIPS });
  });

  for (const [a, b] of ev.pairs) apply({ at: "pair", a, b }, { mult: PAIR_MULT });

  for (let k = 0; k < jokers.length; k++) {
    const j = jokers[k];
    if (!j.def.hand) continue;
    apply({ at: "joker", idx: k }, j.def.hand(j, hctx));
  }

  let total = Math.floor(chips * mult);
  if (ctx.zero) {
    steps.push({ at: "zero", reason: ctx.zero });
    total = 0;
  }
  steps.push({ at: "final", chips, mult, total });
  return { chips, mult, total, steps };
}

/** 付印後真正送去生圖的 POS：人數 → 長相 → 服裝 → 姿勢 → 場景 → 分級 → 畫質，跟排字匣同一個順序。 */
export function printPositive(world, ev) {
  const order = ["look", "wear", "pose", "scene"];
  const tags = [];
  for (const suit of order) {
    for (const it of ev.scoring) {
      if (it.card.suit !== suit) continue;
      tags.push(it.card.tag, ...it.ghosts);
    }
  }
  const data = world.data || {};
  const quality = data.quality || ["masterpiece", "best quality", "amazing quality"];
  const tail = data.sfwTail || ["sfw", "general"];
  return [...new Set(["1girl", "solo", "adult", ...tags, ...tail, ...quality])].join(", ");
}

export function suitZh(suit) {
  return SUIT_INFO[suit]?.zh || suit;
}
