/** Tag-case draw: cast → heat → era → gated pools → commit mutex/bind/imply → reconcile. */

const HEATS = ["tease", "flash", "sex"];
export const ERAS = [
  "modern",
  "ancient_china",
  "ancient_greece",
  "medieval",
  "edo",
  "victorian",
];
export const ERA_LABELS = {
  modern: "現代",
  ancient_china: "古中國",
  ancient_greece: "古希臘",
  medieval: "中世紀",
  edo: "江戶",
  victorian: "維多利亞",
};

const SEX_ACT = new Set([
  "vaginal",
  "anal",
  "cowgirl position",
  "reverse cowgirl position",
  "doggystyle",
  "standing doggystyle",
  "missionary",
  "mating press",
  "standing sex",
  "sex from behind",
  "full nelson",
  "amazon position",
  "prone bone",
  "spooning",
  "suspended congress",
  "spitroast",
  "double penetration",
  "69",
  "paizuri",
  "paizuri under clothes",
  "fellatio",
  "deepthroat",
  "irrumatio",
  "cunnilingus",
  "anilingus",
  "handjob",
  "footjob",
  "facesitting",
  "tribadism",
  "girl on top",
  "oral",
  "squatting cowgirl position",
  "perpendicular paizuri",
  "vaginal object insertion",
  "imminent fellatio",
]);

const NEEDS_MALE = new Set([
  "fellatio",
  "deepthroat",
  "irrumatio",
  "handjob",
  "paizuri",
  "paizuri under clothes",
  "ejaculation",
  "erection",
  "penis",
  "large penis",
  "huge penis",
  "veiny penis",
  "testicles",
  "creampie",
  "cum in pussy",
  "cum in mouth",
  "facial",
  "guided penetration",
  "imminent penetration",
  "vaginal",
  "anal",
  "cowgirl position",
  "reverse cowgirl position",
  "doggystyle",
  "standing doggystyle",
  "missionary",
  "mating press",
  "standing sex",
  "sex from behind",
  "full nelson",
  "prone bone",
  "spitroast",
  "double penetration",
]);

const NEEDS_FEMALE = new Set([
  "vaginal",
  "paizuri",
  "paizuri under clothes",
  "cunnilingus",
  "upskirt",
  "pussy",
  "pussy focus",
  "pussy juice",
  "spread pussy",
  "cowgirl position",
  "reverse cowgirl position",
  "missionary",
  "mating press",
  "after vaginal",
  "cum in pussy",
  "female ejaculation",
  "tribadism",
  "huge breasts",
  "large breasts",
  "gigantic breasts",
  "medium breasts",
  "small breasts",
  "sagging breasts",
  "nipples",
  "areolae",
  "milf",
  "mature female",
]);

const NEEDS_PAIR = new Set([
  "sex",
  "kiss",
  "kissing",
  "french kiss",
  "looking at another",
  "hug from behind",
  "sitting on lap",
  "spitroast",
  "double penetration",
  "69",
  "clothed sex",
  "public sex",
  "cowgirl position",
  "reverse cowgirl position",
  "doggystyle",
  "missionary",
  "mating press",
  "standing sex",
  "fellatio",
  "cunnilingus",
  "paizuri",
  "handjob",
  "facesitting",
  "tribadism",
]);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}

function pickWeighted(map, rand) {
  const entries = Object.entries(map).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (!total) return null;
  let x = rand() * total;
  for (const [key, w] of entries) {
    x -= w;
    if (x <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

function shuffle(list, rand) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function erasOf(item) {
  const e = item?.era;
  if (!e || !e.length || e.includes("any")) return null;
  return e;
}

function erasIntersect(a, b) {
  if (!a || !b) return true;
  return a.some((x) => b.includes(x));
}

function extraMutex(item) {
  if (item._mx) return item._mx;
  const groups = [];
  if (item.mutex) groups.push(item.mutex);
  if (SEX_ACT.has(item.tag) && item.mutex !== "sex_act") groups.push("sex_act");
  item._mx = groups;
  return groups;
}

function relOf(item) {
  if (item._rel) return item._rel;
  const rel = new Set();
  for (const x of item.bind || []) rel.add(x);
  for (const x of item.implies || []) rel.add(x);
  item._rel = rel;
  return rel;
}

function parentChild(lex, a, b) {
  const A = lex.byTag.get(a);
  const B = lex.byTag.get(b);
  if (A && relOf(A).has(b)) return true;
  if (B && relOf(B).has(a)) return true;
  return false;
}

export function indexLexicon(data) {
  const byTag = new Map();
  const bySection = { subject: [], feature: [], pose: [], clothing: [], env: [] };
  const mutexOf = new Map();
  const byMutex = new Map();
  const byGroup = new Map();
  for (const item of data.tags) {
    extraMutex(item);
    relOf(item);
    byTag.set(item.tag, item);
    if (bySection[item.section]) bySection[item.section].push(item);
    for (const g of extraMutex(item)) {
      if (!mutexOf.has(g)) mutexOf.set(g, []);
      mutexOf.get(g).push(item.tag);
    }
    if (item.mutex) {
      const k = item.section + ":" + item.mutex;
      if (!byMutex.has(k)) byMutex.set(k, []);
      byMutex.get(k).push(item);
    }
    if (item.group) {
      const k = item.section + ":" + item.group;
      if (!byGroup.has(k)) byGroup.set(k, []);
      byGroup.get(k).push(item);
    }
  }
  const siblings = new Map();
  const lexStub = { byTag };
  for (const item of data.tags) {
    const related = new Set([item.tag, ...relOf(item)]);
    const out = new Set();
    for (const g of extraMutex(item)) {
      for (const t of mutexOf.get(g) || []) {
        if (related.has(t) || parentChild(lexStub, item.tag, t)) continue;
        out.add(t);
      }
    }
    siblings.set(item.tag, [...out]);
  }
  return { data, byTag, bySection, mutexOf, siblings, byMutex, byGroup };
}

export function mutexSiblings(lex, tag) {
  const cached = lex.siblings && lex.siblings.get(tag);
  if (cached) return cached;
  const item = lex.byTag.get(tag);
  if (!item) return [];
  const related = new Set([tag, ...relOf(item)]);
  const out = new Set();
  for (const g of extraMutex(item)) {
    for (const t of lex.mutexOf.get(g) || []) {
      if (related.has(t) || parentChild(lex, tag, t)) continue;
      out.add(t);
    }
  }
  return [...out];
}

function eraCompatible(lex, tagA, tagB) {
  const a = erasOf(lex.byTag.get(tagA));
  const b = erasOf(lex.byTag.get(tagB));
  return erasIntersect(a, b);
}

export function applyPin(lex, pinned, userBanned, tag) {
  const nextPin = new Set(pinned);
  const nextBan = new Set(userBanned);
  nextBan.delete(tag);
  for (const sib of mutexSiblings(lex, tag)) nextPin.delete(sib);
  for (const other of [...nextPin]) {
    if (other !== tag && !eraCompatible(lex, tag, other)) nextPin.delete(other);
  }
  nextPin.add(tag);
  const item = lex.byTag.get(tag);
  if (item) {
    for (const b of item.bind || []) {
      nextPin.add(b);
      nextBan.delete(b);
    }
    for (const i of item.implies || []) {
      nextPin.add(i);
      nextBan.delete(i);
    }
  }
  return { pinned: nextPin, userBanned: nextBan };
}

export function applyBan(lex, pinned, userBanned, tag) {
  const nextPin = new Set(pinned);
  const nextBan = new Set(userBanned);
  nextPin.delete(tag);
  const item = lex.byTag.get(tag);
  if (item) {
    for (const b of item.bind || []) nextPin.delete(b);
  }
  nextBan.add(tag);
  return { pinned: nextPin, userBanned: nextBan };
}

export function applyClear(pinned, userBanned, tag) {
  const nextPin = new Set(pinned);
  const nextBan = new Set(userBanned);
  nextPin.delete(tag);
  nextBan.delete(tag);
  return { pinned: nextPin, userBanned: nextBan };
}

export function autoBannedFromPins(lex, pinned) {
  const banned = new Set();
  for (const tag of pinned) {
    for (const sib of mutexSiblings(lex, tag)) {
      if (!pinned.has(sib)) banned.add(sib);
    }
  }
  return banned;
}

export function tagState(tag, pinned, userBanned, autoBanned) {
  if (pinned.has(tag)) return "pinned";
  if (userBanned.has(tag) || autoBanned.has(tag)) return "banned";
  return "pool";
}

export function cycleTag(lex, pinned, userBanned, tag) {
  const auto = autoBannedFromPins(lex, pinned);
  const state = tagState(tag, pinned, userBanned, auto);
  if (state === "pool" || (state === "banned" && auto.has(tag) && !userBanned.has(tag))) {
    return applyPin(lex, pinned, userBanned, tag);
  }
  if (state === "pinned") return applyBan(lex, pinned, userBanned, tag);
  return applyClear(pinned, userBanned, tag);
}

function hasFemale(cast) {
  return cast.some((t) => t.includes("girl"));
}
function hasMale(cast) {
  return cast.some((t) => t.includes("boy"));
}
function personCount(cast) {
  let n = 0;
  for (const t of cast) {
    const m = t.match(/^(\d+)/);
    if (m) n += Number(m[1]);
    else if (t === "multiple girls" || t === "multiple boys") n += 2;
  }
  return n;
}

function heatOk(item, heat) {
  return (item.heat || HEATS).includes(heat);
}

const HISTORICAL = new Set(["ancient_china", "ancient_greece", "medieval", "edo"]);

function eraOk(item, era) {
  const eras = item.era;
  const isAny = !eras || !eras.length || eras.includes("any");
  if (isAny) {
    if (
      HISTORICAL.has(era) &&
      item.section === "clothing" &&
      item.layer === "garment" &&
      (item.mutex === "onepiece" || item.mutex === "top" || item.mutex === "bottom")
    ) {
      return false;
    }
    return true;
  }
  return eras.includes(era);
}

function eraSpecific(item, era) {
  const eras = item.era;
  return Array.isArray(eras) && eras.length && !eras.includes("any") && eras.includes(era);
}

function gateOk(item, female, male) {
  if (item.gate === "female") return female;
  if (item.gate === "male") return male;
  return true;
}

function castOk(item, female, male, people) {
  const t = item.tag;
  const needs = new Set(item.needs || []);
  if ((NEEDS_PAIR.has(t) || needs.has("pair")) && people < 2) return false;
  if ((NEEDS_MALE.has(t) || needs.has("male")) && !male) return false;
  if ((NEEDS_FEMALE.has(t) || needs.has("female")) && !female) return false;
  return true;
}

function pinContext(lex, pinned) {
  let needFemale = false;
  let needMale = false;
  let needPair = false;
  const heatLists = [];
  const eraLists = [];
  for (const tag of pinned) {
    const item = lex.byTag.get(tag);
    if (!item) continue;
    if (
      item.gate === "female" ||
      NEEDS_FEMALE.has(tag) ||
      (item.needs || []).includes("female") ||
      (item.section === "subject" && tag.includes("girl"))
    ) {
      needFemale = true;
    }
    if (
      item.gate === "male" ||
      NEEDS_MALE.has(tag) ||
      (item.needs || []).includes("male") ||
      (item.section === "subject" && tag.includes("boy"))
    ) {
      needMale = true;
    }
    if (NEEDS_PAIR.has(tag) || (item.needs || []).includes("pair")) needPair = true;
    heatLists.push(item.heat && item.heat.length ? item.heat : HEATS);
    const e = erasOf(item);
    if (e) eraLists.push(e);
  }
  return { needFemale, needMale, needPair, heatLists, eraLists };
}

function intersectOrUnion(lists) {
  if (!lists.length) return null;
  let acc = lists[0].slice();
  for (const hs of lists.slice(1)) {
    const hit = acc.filter((h) => hs.includes(h));
    if (!hit.length) {
      const u = new Set();
      for (const L of lists) for (const x of L) u.add(x);
      return [...u];
    }
    acc = hit;
  }
  return acc;
}

function chooseCast(lex, settings, pinned, banned, rand) {
  const ctx = pinContext(lex, pinned);
  const forced = [];
  for (const t of ["1girl", "2girls", "3girls", "4girls", "1boy", "2boys", "3boys"]) {
    if (pinned.has(t) && !banned.has(t)) forced.push(t);
  }
  let parts;
  if (forced.length) {
    parts = [...forced];
  } else {
    let girl = settings.girl;
    let boy = settings.boy;
    if (ctx.needFemale) girl = true;
    if (ctx.needMale) boy = true;
    let table;
    if (girl && boy) {
      table = lex.data.castWeights.mixed;
      if ((settings.heats || []).length === 1 && settings.heats[0] === "sex") {
        table = {
          "1girl,1boy": 0.64,
          "2girls,1boy": 0.16,
          "2girls": 0.12,
          "1girl": 0.08,
        };
      }
    } else if (boy && !girl) table = lex.data.castWeights.boy_only;
    else if (girl && !boy) table = lex.data.castWeights.girl_only;
    else table = lex.data.castWeights.mixed;
    const usable = {};
    for (const [k, w] of Object.entries(table)) {
      const bits = k.split(",").map((s) => s.trim());
      if (bits.some((b) => banned.has(b))) continue;
      usable[k] = w;
    }
    const key = pickWeighted(usable, rand) || (girl || !boy ? "1girl" : "1boy");
    parts = key.split(",").map((s) => s.trim());
  }
  if (ctx.needFemale && !hasFemale(parts)) parts.push("1girl");
  if (ctx.needMale && !hasMale(parts)) parts.push("1boy");
  if (ctx.needPair && personCount(parts) < 2) {
    if (!hasFemale(parts)) parts.push("1girl");
    if (!hasMale(parts)) parts.push("1boy");
    if (personCount(parts) < 2) parts.push("1girl");
  }
  const n = personCount(parts);
  if (n === 1 && !banned.has("solo") && !ctx.needPair) parts.push("solo");
  if (n > 1) parts = parts.filter((t) => t !== "solo");
  if (pinned.has("solo") && n > 1 && !ctx.needPair) {
    parts = parts.filter(
      (t) =>
        !/^(\d+)girls$/.test(t) &&
        !/^(\d+)boys$/.test(t) &&
        t !== "multiple girls" &&
        t !== "multiple boys"
    );
    if (ctx.needFemale || settings.girl !== false) parts.unshift("1girl");
    else parts.unshift("1boy");
    parts.push("solo");
  }
  parts.push("adult");
  return [...new Set(parts)];
}

function chooseHeat(settings, pinned, lex, rand) {
  const enabled = HEATS.filter((h) => settings.heats.includes(h));
  const ctx = pinContext(lex, pinned);
  const fromPins = intersectOrUnion(ctx.heatLists);
  let allowed = enabled.length ? enabled : ["tease"];
  if (fromPins && fromPins.length) {
    const hit = allowed.filter((h) => fromPins.includes(h));
    allowed = hit.length ? hit : fromPins;
  }
  const weights = { ...settings.weights };
  const filtered = {};
  for (const h of allowed) filtered[h] = weights[h] > 0 ? weights[h] : 1;
  return pickWeighted(filtered, rand) || allowed[0];
}

function chooseEra(settings, pinned, lex, rand) {
  let pool = (settings.eras || ERAS).filter((e) => ERAS.includes(e));
  if (!pool.length) pool = ["modern"];
  if (pool.length === 1) return pool[0];
  const ctx = pinContext(lex, pinned);
  const fromPins = intersectOrUnion(ctx.eraLists);
  if (fromPins && fromPins.length) {
    const hit = pool.filter((e) => fromPins.includes(e));
    pool = hit.length ? hit : fromPins.filter((e) => ERAS.includes(e));
    if (!pool.length) pool = fromPins;
  }
  const weights = {};
  for (const e of pool) weights[e] = e === "modern" ? 1.4 : 1;
  return pickWeighted(weights, rand) || pool[0];
}

export function eraMismatches(lex, pinned, era) {
  const out = [];
  for (const t of pinned) {
    const item = lex.byTag.get(t);
    const e = item?.era;
    if (!e || !e.length || e.includes("any")) continue;
    if (!e.includes(era)) out.push(t);
  }
  return out;
}

function mutexBusy(lex, mutexTaken, tag) {
  const item = lex.byTag.get(tag);
  if (!item) return false;
  for (const g of extraMutex(item)) {
    if (mutexTaken.has(g) && mutexTaken.get(g) !== tag) return true;
  }
  return false;
}

function dependents(lex, tag) {
  const item = lex.byTag.get(tag);
  if (!item) return [];
  return [...(item.bind || []), ...(item.implies || [])];
}

function depAllowed(lex, tag, era) {
  const item = lex.byTag.get(tag);
  if (!item) return false;
  if (era && !eraOk(item, era)) return false;
  return true;
}

function makeCommit(lex, used, mutexTaken, banned, era) {
  const occupy = (tag) => {
    const item = lex.byTag.get(tag);
    if (item) {
      for (const g of extraMutex(item)) {
        const old = mutexTaken.get(g);
        if (old && old !== tag && !parentChild(lex, tag, old)) used.delete(old);
        mutexTaken.set(g, tag);
      }
    }
    used.add(tag);
  };
  return function commit(tag) {
    if (!tag || used.has(tag) || banned.has(tag)) return false;
    if (mutexBusy(lex, mutexTaken, tag)) return false;
    for (const d of dependents(lex, tag)) {
      if (banned.has(d) || used.has(d) || !depAllowed(lex, d, era)) continue;
      if (mutexBusy(lex, mutexTaken, d) && !parentChild(lex, tag, d)) return false;
    }
    occupy(tag);
    for (const d of dependents(lex, tag)) {
      if (banned.has(d) || used.has(d) || !depAllowed(lex, d, era)) continue;
      if (mutexBusy(lex, mutexTaken, d) && !parentChild(lex, tag, d)) continue;
      occupy(d);
    }
    return true;
  };
}

const COLOR_WORD = new Set([
  "white",
  "black",
  "blue",
  "green",
  "red",
  "pink",
  "purple",
  "brown",
  "aqua",
  "orange",
  "yellow",
  "grey",
  "gray",
]);

function isColorVariant(item) {
  const parts = String(item.tag || "").split(" ");
  return parts.length >= 2 && COLOR_WORD.has(parts[0]);
}

function takeFromPool(pool, count, rand, commit, prefer) {
  let buckets;
  if (Array.isArray(prefer) && prefer.length) {
    const seen = new Set();
    buckets = [];
    for (const fn of prefer) {
      const b = [];
      for (const item of pool) {
        if (seen.has(item.tag) || !fn(item)) continue;
        seen.add(item.tag);
        b.push(item);
      }
      buckets.push(b);
    }
    buckets.push(pool.filter((item) => !seen.has(item.tag)));
  } else if (typeof prefer === "function") {
    buckets = [pool.filter(prefer), pool.filter((item) => !prefer(item))];
  } else {
    buckets = [pool];
  }
  let n = 0;
  for (const bucket of buckets) {
    for (const item of shuffle(bucket, rand)) {
      if (n >= count) break;
      if (commit(item.tag)) n += 1;
    }
    if (n >= count) break;
  }
}

export function reconcile(lex, used, female, male, people, pinned = new Set()) {
  const order = { subject: 0, feature: 1, pose: 2, clothing: 3, env: 4 };
  const items = [...used].map(
    (t) => lex.byTag.get(t) || { tag: t, section: "env", layer: "normal" }
  );
  const pinItems = items.filter((i) => pinned.has(i.tag));
  const rest = items
    .filter((i) => !pinned.has(i.tag))
    .sort((a, b) => (order[a.section] ?? 9) - (order[b.section] ?? 9));

  const taken = new Map();
  let keep = [];
  for (const item of pinItems) {
    keep.push(item);
    for (const g of extraMutex(item)) taken.set(g, item.tag);
  }
  for (const item of rest) {
    if (!castOk(item, female, male, people) && item.section !== "subject") continue;
    let ok = true;
    for (const g of extraMutex(item)) {
      if (taken.has(g) && taken.get(g) !== item.tag && !parentChild(lex, taken.get(g), item.tag)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    keep.push(item);
    for (const g of extraMutex(item)) taken.set(g, item.tag);
  }

  const isNudeItem = (i) =>
    i.tag === "nude" ||
    i.tag === "completely nude" ||
    (i.section === "clothing" && i.layer === "skin");
  const nudePinned = keep.some((i) => pinned.has(i.tag) && isNudeItem(i));
  const garmentPinned = keep.some(
    (i) => pinned.has(i.tag) && i.section === "clothing" && i.layer === "garment"
  );
  const nude = keep.some(isNudeItem);
  if (nude && !garmentPinned) {
    keep = keep.filter(
      (i) =>
        pinned.has(i.tag) ||
        i.section !== "clothing" ||
        i.layer === "skin" ||
        i.layer === "accessory"
    );
  } else if (nude && garmentPinned && !nudePinned) {
    keep = keep.filter((i) => !isNudeItem(i) || pinned.has(i.tag));
  } else if (taken.has("onepiece")) {
    keep = keep.filter(
      (i) =>
        pinned.has(i.tag) ||
        i.section !== "clothing" ||
        (i.mutex !== "top" && i.mutex !== "bottom") ||
        i.layer === "accessory"
    );
  }

  if (people > 1) keep = keep.filter((i) => i.tag !== "solo" || pinned.has("solo"));
  if (people === 1 && !keep.some((i) => i.tag === "solo")) {
    const solo = lex.byTag.get("solo");
    if (solo) keep.push(solo);
  }

  return new Set(keep.map((i) => i.tag));
}

export function contradictions(lex, tags) {
  const items = tags.map((t) => lex.byTag.get(t)).filter(Boolean);
  const found = [];
  const seen = new Map();
  for (const item of items) {
    for (const g of extraMutex(item)) {
      if (seen.has(g) && seen.get(g) !== item.tag) {
        if (!parentChild(lex, seen.get(g), item.tag)) {
          found.push([g, seen.get(g), item.tag]);
        }
      } else seen.set(g, item.tag);
    }
  }
  const names = new Set(tags);
  if (names.has("solo") && (names.has("2girls") || names.has("3girls") || names.has("2boys"))) {
    found.push(["solo_count", "solo", "2+"]);
  }
  const nude = names.has("nude") || names.has("completely nude");
  if (nude && (names.has("dress") || names.has("sundress") || names.has("jeans"))) {
    found.push(["nude_garment", "nude", "garment"]);
  }
  if (names.has("indoors") && names.has("outdoors")) found.push(["in_out", "indoors", "outdoors"]);
  if (names.has("day") && names.has("night")) found.push(["day_night", "day", "night"]);
  for (const t of tags) {
    const impl = lex.byTag.get(t)?.implies || [];
    if (impl.includes("indoors") && names.has("outdoors")) found.push(["in_out", t, "outdoors"]);
    if (impl.includes("outdoors") && names.has("indoors")) found.push(["in_out", t, "indoors"]);
  }
  return found;
}

export function drawOne(lex, settings, pinned, userBanned, rand, seed) {
  const autoBan = autoBannedFromPins(lex, pinned);
  const banned = new Set([...userBanned, ...autoBan]);
  const used = new Set();
  const mutexTaken = new Map();

  const heat = chooseHeat(settings, pinned, lex, rand);
  const era = chooseEra(settings, pinned, lex, rand);
  const commit = makeCommit(lex, used, mutexTaken, banned, era);
  const cast = chooseCast(lex, settings, pinned, banned, rand);
  let female = hasFemale(cast);
  let male = hasMale(cast);
  let people = personCount(cast);

  for (const t of cast) commit(t);

  const forcePin = (tag) => {
    if (!tag || used.has(tag)) return;
    if (userBanned.has(tag) && !pinned.has(tag)) return;
    const item = lex.byTag.get(tag);
    if (item) {
      for (const g of extraMutex(item)) {
        const old = mutexTaken.get(g);
        if (old && old !== tag && !pinned.has(old) && !parentChild(lex, tag, old)) {
          used.delete(old);
        }
      }
    }
    used.add(tag);
    if (item) {
      for (const g of extraMutex(item)) mutexTaken.set(g, tag);
      for (const d of dependents(lex, tag)) {
        if (used.has(d)) continue;
        if (banned.has(d) && !pinned.has(d)) continue;
        if (!pinned.has(d) && !depAllowed(lex, d, era)) continue;
        if (mutexBusy(lex, mutexTaken, d) && !pinned.has(d) && !parentChild(lex, tag, d)) {
          continue;
        }
        used.add(d);
        const di = lex.byTag.get(d);
        if (di) for (const g of extraMutex(di)) mutexTaken.set(g, d);
      }
    }
  };

  for (const tag of pinned) forcePin(tag);

  const subjectNow = [...used].filter((t) => {
    const it = lex.byTag.get(t);
    return it && it.section === "subject";
  });
  if (subjectNow.length) {
    female = hasFemale(subjectNow);
    male = hasMale(subjectNow);
    people = personCount(subjectNow);
  }

  const allow = (item) => {
    if (banned.has(item.tag) || used.has(item.tag)) return false;
    if (!heatOk(item, heat) || !eraOk(item, era) || !gateOk(item, female, male)) return false;
    if (!castOk(item, female, male, people)) return false;
    for (const g of extraMutex(item)) {
      if (mutexTaken.has(g)) return false;
    }
    return true;
  };

  const counts = settings.counts;
  const clothingPrefer = [
    (item) =>
      eraSpecific(item, era) &&
      item.layer === "garment" &&
      !isColorVariant(item) &&
      (item.mutex === "onepiece" || item.mutex === "top" || item.mutex === "bottom"),
    (item) => eraSpecific(item, era) && item.layer === "garment" && !isColorVariant(item),
    (item) =>
      item.layer === "garment" &&
      !isColorVariant(item) &&
      (item.mutex === "onepiece" || item.mutex === "top" || item.mutex === "bottom"),
    (item) => item.layer === "garment" && !isColorVariant(item),
    (item) => item.layer === "garment",
  ];
  const posePrefer = [
    (item) => item.mutex === "body_pose" || item.mutex === "camera" || item.mutex === "gaze",
    (item) => item.group === "face",
    (item) => heat === "sex" && (item.mutex === "sex_act" || item.group === "sex"),
    (item) => heat === "flash" && (item.mutex === "clothes_action" || item.group === "flash"),
    (item) => heat === "tease" && item.group === "tease",
  ];
  const countSection = (section) => {
    let n = 0;
    for (const t of used) {
      if (lex.byTag.get(t)?.section === section) n += 1;
    }
    return n;
  };
  const someUsed = (fn) => {
    for (const t of used) {
      const it = lex.byTag.get(t);
      if (it && fn(it, t)) return true;
    }
    return false;
  };

  const fill = (section, extraFilter) => {
    const need = Math.max(0, (counts[section] || 0) - countSection(section));
    if (need <= 0) return;
    const pool = lex.bySection[section].filter(
      (item) => allow(item) && (!extraFilter || extraFilter(item))
    );
    let prefer = null;
    if (section === "clothing") prefer = clothingPrefer;
    else if (section === "env") prefer = (item) => eraSpecific(item, era);
    else if (section === "pose") prefer = posePrefer;
    takeFromPool(pool, need, rand, commit, prefer);
  };

  const stampAnchors = (section) => {
    for (const t of lex.data.eraAnchors?.[era] || []) {
      const item = lex.byTag.get(t);
      if (!item || item.section !== section) continue;
      if (used.has(t) || banned.has(t)) continue;
      commit(t);
    }
  };

  const fillSlot = (section, mutexName) => {
    if (mutexTaken.has(mutexName)) return;
    const indexed = lex.byMutex && lex.byMutex.get(section + ":" + mutexName);
    const pool = (indexed || lex.bySection[section].filter((item) => item.mutex === mutexName)).filter(
      (item) => allow(item)
    );
    let prefer = null;
    if (section === "clothing") prefer = clothingPrefer;
    else if (section === "env") prefer = (item) => eraSpecific(item, era);
    takeFromPool(pool, 1, rand, commit, prefer);
  };

  const fillGroup = (section, groupName) => {
    if (someUsed((it) => it.group === groupName)) return;
    const indexed = lex.byGroup && lex.byGroup.get(section + ":" + groupName);
    const pool = (indexed || lex.bySection[section].filter((item) => item.group === groupName)).filter(
      (item) => allow(item)
    );
    takeFromPool(pool, 1, rand, commit);
  };

  fillSlot("feature", "hair_length");
  fillSlot("feature", "hair_color");
  fillSlot("feature", "eye_color");
  fillGroup("feature", "hair_style");
  if (female) fillSlot("feature", "breast_size");
  if (male && rand() < 0.38) fillSlot("feature", "race");
  fill("feature", (item) => item.mutex !== "race");

  const clothingPinned = someUsed((it, t) => it.section === "clothing" && pinned.has(t));
  const nudePinned = someUsed((it) => it.section === "clothing" && it.layer === "skin");
  let forceNude = nudePinned;
  if (!clothingPinned && !nudePinned) {
    if (heat === "sex" && rand() < 0.42) forceNude = true;
    else if (heat === "flash" && rand() < 0.22) forceNude = true;
  }
  if (forceNude) {
    const skin = lex.bySection.clothing.filter((item) => item.layer === "skin" && allow(item));
    if (skin.length && !nudePinned) takeFromPool(skin, 1, rand, commit);
  }
  const gotNude = someUsed((it) => it.section === "clothing" && it.layer === "skin");
  const hasBodyGarment = () =>
    someUsed((it, t) => {
      if (it.section !== "clothing") return false;
      if (it.layer === "skin") return true;
      if (it.layer === "garment" && (it.mutex === "onepiece" || it.mutex === "top" || it.mutex === "bottom")) {
        return true;
      }
      return (
        t === "chinese clothes" ||
        t === "japanese clothes" ||
        t === "ancient greek clothes" ||
        t === "kimono" ||
        t === "hanfu" ||
        t === "armor"
      );
    });
  if (gotNude) {
    fill("clothing", (item) => item.layer === "accessory" || item.layer === "skin");
  } else {
    stampAnchors("clothing");
    if (!hasBodyGarment()) {
      const pool = lex.bySection.clothing.filter(
        (item) =>
          allow(item) &&
          item.layer === "garment" &&
          (item.mutex === "onepiece" || item.mutex === "top" || item.mutex === "bottom")
      );
      takeFromPool(pool, 1, rand, commit, clothingPrefer);
    }
    fill("clothing", (item) => {
      if (item.layer === "skin") return false;
      if (item.layer === "garment" && !item.mutex) {
        return someUsed((it) => relOf(it).has(item.tag));
      }
      if (item.mutex === "onepiece" || item.mutex === "top" || item.mutex === "bottom") {
        if (mutexTaken.has("onepiece") || item.mutex === "onepiece") return false;
        if (mutexTaken.has(item.mutex)) return false;
        return true;
      }
      return true;
    });
  }

  fillSlot("pose", "body_pose");
  fillSlot("pose", "camera");
  fillSlot("pose", "gaze");
  if (heat === "sex" && people >= 2) {
    const acts = lex.bySection.pose.filter(
      (item) => allow(item) && (item.mutex === "sex_act" || item.tag === "sex")
    );
    takeFromPool(acts, 1, rand, commit);
  }
  fill("pose");
  stampAnchors("env");
  fillSlot("env", "place");
  fillSlot("env", "in_out");
  fillSlot("env", "day_night");
  fill("env");

  const kept = reconcile(lex, used, female, male, people, pinned);

  const quality = lex.data.quality.slice();
  const subject = [];
  const feature = [];
  const pose = [];
  const clothing = [];
  const env = lex.data.alwaysEnv.slice();
  const bucket = { subject, feature, pose, clothing, env };

  for (const t of cast) {
    if (kept.has(t) && !subject.includes(t)) subject.push(t);
  }
  if (people === 1 && !subject.includes("solo")) subject.push("solo");
  if (!subject.includes("adult")) subject.push("adult");

  for (const tag of kept) {
    const item = lex.byTag.get(tag);
    if (!item) continue;
    if (item.section === "subject") {
      if (!subject.includes(tag)) subject.push(tag);
    } else if (bucket[item.section] && !bucket[item.section].includes(tag)) {
      bucket[item.section].push(tag);
    }
  }
  if (!env.includes("soft lighting")) env.unshift("soft lighting");

  const nsfw = lex.data.nsfwTail;
  const ordered = [...quality, ...subject, ...feature, ...pose, ...clothing, ...env, ...nsfw];
  const seen = new Set();
  const positive = [];
  for (const t of ordered) {
    if (seen.has(t)) continue;
    seen.add(t);
    positive.push(t);
  }

  return {
    heat,
    era,
    female,
    male,
    people,
    seed,
    sections: { quality, subject, feature, pose, clothing, env, nsfw },
    positive: positive.join(", "),
    conflicts: contradictions(lex, positive),
    eraClash: eraMismatches(lex, pinned, era),
  };
}

export function defaultSettings(data) {
  const d = data.defaults;
  return {
    n: d.n,
    width: d.width,
    height: d.height,
    counts: { ...d.counts },
    girl: d.girl,
    boy: d.boy,
    heats: [...d.heats],
    heatPreset: d.heatPreset,
    weights: { ...data.heatWeights[d.heatPreset] },
    eras: d.eras ? [...d.eras] : [...ERAS],
  };
}

export function missingPins(positive, pinned) {
  const have = new Set(
    String(positive || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return [...pinned].filter((t) => !have.has(t));
}

export function labelOf(lex, tag) {
  const item = lex.byTag.get(tag);
  if (item?.zh) return item.zh;
  if (lex.data.zh && lex.data.zh[tag]) return lex.data.zh[tag];
  return tag;
}
