/**
 * 疊印台的「版」：你放上來的牌、它們彼此的關係、哪一張當主版。純資料，不碰 DOM。
 *
 * 零 import（跟字鋪的 pool.js 同一個做法）：engine 的 applyPin、contradictions、ACT_PLACE
 * 由呼叫端傳進來，所以瀏覽器和 node 測試（scripts/test_fuse.mjs）用的是同一份，
 * 也不會另長一套抽牌規則 —— 同格互斥、時代衝突、附帶全部是 engine 說了算。
 *
 *   bed = { pins: [tag…]（放上來的順序）, lead: tag|null, carried: { tag: 帶它上來的那張 } }
 */

/** 六個套版，由上而下：罩色在最上面，底色在最下面，跟真的疊印一樣。 */
export const REGISTERS = ["style", "pose", "wear", "look", "cast", "scene"];
export const REGISTER_ROLE = {
  style: "罩色",
  pose: "姿勢",
  wear: "服裝",
  look: "長相",
  cast: "人物",
  scene: "底色",
};

/** 主版（校樣上那個人）從哪一套挑：姿勢最能代表畫面，其次衣服、長相、人數。 */
const LEAD_ORDER = ["pose", "wear", "look", "cast"];

export function emptyBed() {
  return { pins: [], lead: null, carried: {} };
}

export function sanitizeBed(raw, has) {
  if (!raw || !Array.isArray(raw.pins)) return emptyBed();
  const pins = [...new Set(raw.pins.filter((t) => typeof t === "string" && has(t)))];
  const set = new Set(pins);
  const carried = {};
  for (const [t, from] of Object.entries(raw.carried || {})) if (set.has(t) && set.has(from)) carried[t] = from;
  return { pins, lead: set.has(raw.lead) ? raw.lead : null, carried };
}

function erasOf(item) {
  const e = item && item.era;
  return !e || !e.length || e.includes("any") ? null : e;
}

function eraClash(a, b) {
  const x = erasOf(a);
  const y = erasOf(b);
  return !!(x && y && !x.some((e) => y.includes(e)));
}

/**
 * 放一張牌上版。回傳新的版和這一步造成的事件：
 *   place   放上來的那張
 *   carry   被它帶上來的（詞庫的 implies／bind）
 *   replace 被它擠下去的（同一格只留一張，或時代對不上）
 */
export function placeCard(bed, tag, { lex, applyPin }) {
  if (bed.pins.includes(tag)) return { bed, events: [] };
  const prev = new Set(bed.pins);
  const { pinned } = applyPin(lex, prev, new Set(), tag);
  const item = lex.byTag.get(tag);
  const removed = bed.pins.filter((t) => !pinned.has(t));
  const added = [...pinned].filter((t) => !prev.has(t) && t !== tag);
  const events = [{ kind: "place", tag }];
  for (const t of removed) events.push({ kind: "replace", out: t, by: tag, why: eraClash(item, lex.byTag.get(t)) ? "era" : "slot" });
  for (const t of added) events.push({ kind: "carry", tag: t, from: tag });
  const carried = {};
  for (const [t, from] of Object.entries(bed.carried)) if (pinned.has(t) && pinned.has(from)) carried[t] = from;
  for (const t of added) carried[t] = tag;
  delete carried[tag];
  const pins = [...bed.pins.filter((t) => pinned.has(t)), tag, ...added];
  return { bed: { pins, lead: bed.lead && pinned.has(bed.lead) ? bed.lead : null, carried }, events };
}

/** 拿掉一張。被它帶上來的牌一起拿掉（它們本來就是跟著它來的）。 */
export function removeCard(bed, tag) {
  if (!bed.pins.includes(tag)) return { bed, events: [] };
  const drop = new Set([tag]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [t, from] of Object.entries(bed.carried)) {
      if (drop.has(from) && !drop.has(t)) {
        drop.add(t);
        grew = true;
      }
    }
  }
  const pins = bed.pins.filter((t) => !drop.has(t));
  const carried = {};
  for (const [t, from] of Object.entries(bed.carried)) if (!drop.has(t) && !drop.has(from)) carried[t] = from;
  return {
    bed: { pins, lead: drop.has(bed.lead) ? null : bed.lead, carried },
    events: [{ kind: "remove", tag, tags: [...drop].filter((t) => bed.pins.includes(t)) }],
  };
}

export function setLead(bed, tag) {
  if (!bed.pins.includes(tag)) return bed;
  return { ...bed, lead: bed.lead === tag ? null : tag };
}

/**
 * 版上的牌彼此的關係，畫成校對記號：
 *   carry 附帶：A 把 B 帶上來
 *   echo  呼應：活動配上它的地點（engine 的 ACT_PLACE）
 *   clash 相剋：同時成立不了（engine 的 contradictions：晝夜、室內外、全裸配衣服…）
 */
export function relationsOf(bed, { lex, contradictions, actPlace }) {
  const has = new Set(bed.pins);
  const out = [];
  const seen = new Set();
  const push = (kind, a, b) => {
    if (!a || !b || a === b || !has.has(a) || !has.has(b)) return;
    const key = kind + "|" + [a, b].sort().join("|");
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, a, b });
  };
  for (const [t, from] of Object.entries(bed.carried)) push("carry", from, t);
  for (const a of bed.pins) {
    const places = actPlace[a];
    if (!places) continue;
    for (const b of bed.pins) if (places.has(b)) push("echo", a, b);
  }
  for (const [kind, x, y] of contradictions(lex, bed.pins)) {
    let a = x;
    let b = y;
    if (kind === "solo_count") b = ["2girls", "3girls", "2boys"].find((t) => has.has(t));
    if (kind === "nude_garment") {
      a = has.has("completely nude") ? "completely nude" : "nude";
      b = ["dress", "sundress", "jeans"].find((t) => has.has(t));
    }
    push("clash", a, b);
  }
  return out;
}

/**
 * 校樣怎麼疊：主版（人）、底色（風景）、道具（靜物）、罩色（風格）。
 * mine 是你的牌，extra 是引擎在這一張試印裡補的；你的優先，你沒放的那一層才用引擎的。
 * kindOf(tag) → "figure" | "ground" | "prop" | null（看那張牌的插畫畫的是什麼）。
 * frameOf(tag) → 插畫的鏡頭有多寬（全身 3、七分 2、半身 1、臉 0）。
 * 主版挑畫得最完整的那張：和服（全身）比微笑（臉部特寫）更能代表整張圖；
 * 一樣寬時照 姿勢 > 服裝 > 長相 > 人數，再一樣就挑最後放的。
 */
export function proofLayers({ bed, extra = [], suitOf, kindOf, frameOf = () => 0 }) {
  const mine = bed.pins;
  const pickFigure = (list) => {
    let best = null;
    let bestScore = -Infinity;
    list.forEach((t, i) => {
      if (kindOf(t) !== "figure") return;
      const rank = LEAD_ORDER.indexOf(suitOf(t));
      if (rank < 0) return;
      // 被帶上來的牌（和服 → 和服類）不跟你親手放的搶主版。
      const carried = bed.carried[t] ? 50 : 0;
      const score = frameOf(t) * 100 - rank * 10 - carried + i / (list.length + 1);
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    });
    return best;
  };
  const lastOf = (list, kind) => {
    for (let i = list.length - 1; i >= 0; i--) if (kindOf(list[i]) === kind) return list[i];
    return null;
  };
  const leadMine = bed.lead && kindOf(bed.lead) === "figure" ? bed.lead : pickFigure(mine);
  const figure = leadMine ? { tag: leadMine, src: "mine" } : wrap(pickFigure(extra), "engine");
  // 底色也一樣：圖書館帶上來的「室內」不該蓋過圖書館本身。
  const groundMine = lastOf(mine.filter((t) => !bed.carried[t]), "ground") || lastOf(mine, "ground");
  const ground = groundMine ? { tag: groundMine, src: "mine" } : wrap(lastOf(extra, "ground"), "engine");
  const props = mine.filter((t) => kindOf(t) === "prop").slice(-2).map((t) => ({ tag: t, src: "mine" }));
  const finishMine = mine.filter((t) => suitOf(t) === "style");
  const finish = (finishMine.length ? finishMine : extra.filter((t) => suitOf(t) === "style")).map((t) => ({
    tag: t,
    src: finishMine.length ? "mine" : "engine",
  }));
  return { figure, ground, props, finish };
}

function wrap(tag, src) {
  return tag ? { tag, src } : null;
}

/** 可以當主版的牌：插畫裡有人、而且屬於人的那幾套。 */
export function canLead(tag, { suitOf, kindOf }) {
  return kindOf(tag) === "figure" && LEAD_ORDER.includes(suitOf(tag));
}
