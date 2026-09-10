/** Tag-case draw: cast → heat → era → gated pools → commit mutex/bind/imply → reconcile. */

export const HEATS = ["activity", "tease", "flash", "sex"];
export const MIXED_HEATS = ["tease", "flash", "sex"];

export function toggleHeat(heats, heat) {
  const on = new Set((heats || []).filter((h) => HEATS.includes(h)));
  if (heat === "mixed") return MIXED_HEATS.slice();
  if (!HEATS.includes(heat)) return HEATS.filter((h) => on.has(h));
  if (on.has(heat)) {
    if (on.size <= 1) return HEATS.filter((h) => on.has(h));
    on.delete(heat);
  } else {
    on.add(heat);
  }
  return HEATS.filter((h) => on.has(h));
}

export function heatPresetOf(heats) {
  const h = HEATS.filter((x) => (heats || []).includes(x));
  if (h.length === 3 && MIXED_HEATS.every((x) => h.includes(x))) return "mixed";
  if (h.length === 1) return h[0];
  return "custom";
}

export function weightsForHeats(heats, heatWeights) {
  const h = HEATS.filter((x) => (heats || []).includes(x));
  if (!h.length) return { activity: 0, tease: 1, flash: 0, sex: 0 };
  if (h.length === 3 && MIXED_HEATS.every((x) => h.includes(x)) && heatWeights && heatWeights.mixed) {
    return { activity: 0, tease: 0, flash: 0, sex: 0, ...heatWeights.mixed };
  }
  const w = { activity: 0, tease: 0, flash: 0, sex: 0 };
  const share = 1 / h.length;
  for (const x of h) w[x] = share;
  return w;
}
const SEX_OK_ACTIVITY = new Set([
  "bathing",
  "showering",
  "swimming",
  "wading",
  "floating",
  "shared bathing",
]);

const STILL_BODY = new Set(["sleeping", "lying", "on back", "on stomach", "on side", "reclining"]);
const LOCKED_SIT = new Set(["seiza", "wariza", "indian style"]);
const GROUND_BODY = new Set(["all fours", "crawling", "top-down bottom-up"]);
const MOVE_ACT = new Set([
  "swimming",
  "wading",
  "hiking",
  "horseback riding",
  "riding bicycle",
  "playing sports",
  "exercising",
  "training",
  "dancing",
  "carrying",
  "cooking",
  "cleaning",
  "fishing",
]);
const AWAKE_ACT = new Set([
  ...MOVE_ACT,
  "eating",
  "reading",
  "drawing (action)",
  "painting (action)",
  "singing",
  "karaoke",
  "shopping",
  "driving",
  "writing",
  "picnic",
  "playing games",
  "playing video games",
  "playing guitar",
  "selfie",
  "talking on phone",
  "taking picture",
  "stretching",
  "yoga",
  "studying",
  "sunbathing",
  "smoking",
  "drinking",
  "floating",
  "bathing",
  "showering",
  "shared bathing",
]);
const FACELESS_CAM = new Set(["head out of frame", "lower body"]);
const FACE_NEED_TAGS = new Set(["closed eyes", "facial", "cum in mouth", "cum on face"]);
const DAY_MARK = new Set(["day", "sunrise", "sunlight", "sunbathing", "blue sky", "orange sky"]);
const NIGHT_MARK = new Set(["night", "starry sky", "moonlight"]);
const SLEEP_BAD_POSE = new Set(["washing body", "partially submerged"]);

function usedMutexTags(used, lex, mutex) {
  const s = new Set();
  for (const t of used) {
    if (lex.byTag.get(t)?.mutex === mutex) s.add(t);
  }
  return s;
}

function activityFitsBody(act, body) {
  if (body.has("sleeping") && AWAKE_ACT.has(act)) return false;
  if (
    body.has("dancing") &&
    act !== "dancing" &&
    (MOVE_ACT.has(act) ||
      act === "reading" ||
      act === "eating" ||
      act === "picnic" ||
      act === "playing games" ||
      act === "playing video games" ||
      act === "drawing (action)" ||
      act === "painting (action)" ||
      act === "playing guitar" ||
      act === "floating" ||
      act === "studying" ||
      act === "writing" ||
      act === "drinking" ||
      act === "yoga" ||
      act === "stretching" ||
      act === "sunbathing" ||
      act === "smoking")
  ) {
    return false;
  }
  if ([...body].some((t) => STILL_BODY.has(t)) && MOVE_ACT.has(act)) return false;
  if (
    act === "driving" &&
    [...body].some((t) => t === "on stomach" || t === "on back" || t === "on side" || t === "sleeping" || GROUND_BODY.has(t))
  ) {
    return false;
  }
  if ([...body].some((t) => LOCKED_SIT.has(t)) && MOVE_ACT.has(act)) return false;
  if (
    [...body].some((t) => GROUND_BODY.has(t)) &&
    (MOVE_ACT.has(act) ||
      act === "eating" ||
      act === "picnic" ||
      act === "reading" ||
      act === "drawing (action)" ||
      act === "painting (action)" ||
      act === "playing guitar" ||
      act === "studying" ||
      act === "writing" ||
      act === "drinking" ||
      act === "playing games" ||
      act === "playing video games" ||
      act === "floating" ||
      act === "driving" ||
      act === "sunbathing")
  ) {
    return false;
  }
  if (
    act === "floating" &&
    [...body].some(
      (t) =>
        GROUND_BODY.has(t) ||
        LOCKED_SIT.has(t) ||
        t === "squatting" ||
        t === "kneeling" ||
        t === "on one knee" ||
        t === "standing" ||
        t === "dancing"
    )
  ) {
    return false;
  }
  if (
    act === "horseback riding" &&
    (body.has("standing") ||
      body.has("squatting") ||
      body.has("kneeling") ||
      body.has("on one knee") ||
      [...body].some((t) => STILL_BODY.has(t) || LOCKED_SIT.has(t) || GROUND_BODY.has(t)))
  ) {
    return false;
  }
  return true;
}

const WATER_PLACE = new Set([
  "pool",
  "poolside",
  "beach",
  "ocean",
  "underwater",
  "lotus pond",
  "onsen",
  "bath",
  "bathroom",
  "bathtub",
  "shower (place)",
  "sento",
  "ofuro",
  "open-air bath",
  "bubble bath",
]);
const WATER_ACT = new Set(["swimming", "wading", "floating", "fishing", "bathing", "showering", "shared bathing"]);
const BATH_PLACE = new Set([
  "onsen",
  "bath",
  "bathroom",
  "bathtub",
  "shower (place)",
  "sento",
  "ofuro",
  "open-air bath",
  "bubble bath",
  "sauna",
]);
const BATH_ACT = new Set(["bathing", "showering", "shared bathing"]);
const BATH_BAD_CLOTHES = new Set([
  "geta",
  "zouri",
  "boots",
  "sneakers",
  "shoes",
  "hakama",
  "armor",
  "plate armor",
  "suit",
  "necktie",
  "blazer",
  "japanese armor",
  "sandals",
]);

function isBathBadCloth(tag) {
  if (BATH_BAD_CLOTHES.has(tag)) return true;
  if (/\barmor\b/.test(tag)) return true;
  if (/\bsuit\b/.test(tag)) return true;
  return false;
}
const INDOOR_ROOM = new Set([
  "bedroom",
  "bed",
  "hotel room",
  "love hotel",
  "kitchen",
  "living room",
  "office",
  "classroom",
  "library",
  "changing room",
  "locker room",
  "train",
  "train interior",
  "car interior",
  "elevator",
  "hallway",
  "cafe",
  "bar (place)",
  "fitting room",
  "restaurant",
  "clinic",
  "hospital",
  "great hall",
  "mansion",
  "palace",
  "futon",
  "couch",
]);
const INDOOR_PROP = new Set(["shoji", "carpet", "curtains", "bed sheet", "window"]);
const SPORT_PLACE = new Set(["fitness gym", "school gym", "park", "beach", "courtyard", "poolside", "rooftop", "pool"]);
const DRIVE_PLACE = new Set(["car", "car interior", "street", "city", "cityscape", "alley"]);

function usedPlaces(used, lex) {
  const s = new Set();
  for (const t of used) {
    const it = lex.byTag.get(t);
    if (it && (it.mutex === "place" || it.group === "place")) s.add(t);
  }
  return s;
}

function usedActs(used, lex) {
  const s = new Set();
  for (const t of used) {
    if (lex.byTag.get(t)?.mutex === "activity") s.add(t);
  }
  return s;
}

const FISH_PLACE = new Set(["beach", "ocean", "lotus pond", "poolside", "pool"]);
const INDOOR_FURN = new Set(["on bed", "on chair", "office chair", "gaming chair", "swivel chair"]);
const JOB_PLACE = {
  "office lady": new Set(["office"]),
  salaryman: new Set(["office"]),
  nurse: new Set(["clinic", "hospital"]),
  doctor: new Set(["clinic", "hospital"]),
  teacher: new Set(["classroom", "library", "school gym"]),
  waitress: new Set(["restaurant", "cafe", "bar (place)"]),
  barista: new Set(["cafe", "restaurant"]),
  policewoman: new Set(["street", "city", "cityscape", "alley", "office"]),
};
const PRIVATE_SEX_PLACE = new Set([
  "bedroom",
  "hotel room",
  "love hotel",
  "bath",
  "bathroom",
  "bathtub",
  "shower (place)",
  "ofuro",
  "onsen",
  "sento",
  "open-air bath",
  "bubble bath",
  "changing room",
  "locker room",
  "living room",
]);

export const SCENE_MODES = ["normal", "diverse", "weird"];
export const SCENE_MODE_LABELS = { normal: "正常", diverse: "多元", weird: "奇葩" };

export function sceneModeOf(settings) {
  const m = settings && settings.sceneMode;
  if (SCENE_MODES.includes(m)) return m;
  if (settings && settings.lockScene === false) return "weird";
  return "normal";
}

function lockSceneOn(settings) {
  const m = sceneModeOf(settings);
  if (m === "weird") return false;
  if (m === "normal" || m === "diverse") return true;
  return settings.lockScene !== false;
}

function realisticOn(settings) {
  return sceneModeOf(settings) === "normal";
}

function usedJobs(used, lex) {
  const s = new Set();
  for (const t of used) {
    if (lex.byTag.get(t)?.mutex === "job") s.add(t);
  }
  return s;
}

function placeFitsJob(place, jobs) {
  if (!jobs.size) return true;
  for (const j of jobs) {
    const ok = JOB_PLACE[j];
    if (ok && !ok.has(place)) return false;
  }
  return true;
}

function placeFitsActs(place, acts, realistic = false) {
  if (!acts.size) return true;
  if (acts.has("fishing")) return FISH_PLACE.has(place);
  if ([...acts].some((a) => WATER_ACT.has(a))) return WATER_PLACE.has(place);
  if (acts.has("horseback riding")) return !INDOOR_ROOM.has(place) && !BATH_PLACE.has(place);
  if (acts.has("driving")) return DRIVE_PLACE.has(place);
  if (acts.has("cooking")) return place === "kitchen";
  if (acts.has("picnic")) {
    return (
      !INDOOR_ROOM.has(place) &&
      !BATH_PLACE.has(place) &&
      place !== "underwater" &&
      place !== "ocean" &&
      place !== "pool"
    );
  }
  if (acts.has("camping")) {
    return (
      ["forest", "park", "bamboo forest", "garden", "ruins"].includes(place) ||
      (!INDOOR_ROOM.has(place) && place !== "cityscape" && place !== "city" && place !== "street" && !BATH_PLACE.has(place))
    );
  }
  if (acts.has("playing sports") || acts.has("exercising") || acts.has("training")) return SPORT_PLACE.has(place);
  if (acts.has("hiking")) return !INDOOR_ROOM.has(place) && !BATH_PLACE.has(place);
  if (acts.has("karaoke")) {
    if (realistic) return place === "bar (place)" || place === "living room";
    return place !== "elevator" && !BATH_PLACE.has(place);
  }
  if (acts.has("playing guitar")) return !BATH_PLACE.has(place);
  if (acts.has("playing video games") || acts.has("playing games")) return !BATH_PLACE.has(place);
  if (acts.has("shopping")) return !BATH_PLACE.has(place) && place !== "bedroom";
  if (acts.has("sunbathing")) return !INDOOR_ROOM.has(place) && !BATH_PLACE.has(place);
  if (acts.has("studying") || acts.has("writing")) return !BATH_PLACE.has(place) && place !== "bar (place)";
  return true;
}

function actFitsPlaces(act, places, realistic = false) {
  if (!places.size) return true;
  return [...places].every((p) => placeFitsActs(p, new Set([act]), realistic));
}

function jobPlacesOf(jobs) {
  const s = new Set();
  for (const j of jobs) {
    for (const p of JOB_PLACE[j] || []) s.add(p);
  }
  return s;
}

function isBathScene(used) {
  for (const t of used) {
    if (BATH_PLACE.has(t) || BATH_ACT.has(t)) return true;
  }
  return false;
}

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
  for (const g of item.mutexExtra || []) {
    if (g && !groups.includes(g)) groups.push(g);
  }
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
  const bySection = { quality: [], subject: [], feature: [], pose: [], clothing: [], env: [] };
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

function implyChain(lex, tag) {
  const out = [];
  const seen = new Set();
  const q = [tag];
  while (q.length) {
    const cur = q.shift();
    const item = lex.byTag.get(cur);
    if (!item) continue;
    for (const d of [...(item.implies || []), ...(item.bind || [])]) {
      if (seen.has(d) || d === tag) continue;
      seen.add(d);
      out.push(d);
      q.push(d);
    }
  }
  return out;
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
    for (const i of implyChain(lex, tag)) {
      nextPin.add(i);
      nextBan.delete(i);
      for (const sib of mutexSiblings(lex, i)) nextPin.delete(sib);
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

export const IDENTITY_MUTEX = new Set([
  "hair_length",
  "hair_color",
  "eye_color",
  "breast_size",
  "race",
  "male_build",
]);

export function isIdentityItem(item) {
  if (!item) return false;
  return IDENTITY_MUTEX.has(item.mutex) || item.group === "hair_style";
}

export function identityPins(lex, positive) {
  let pinned = new Set();
  let banned = new Set();
  for (const t of String(positive || "")
    .split(",")
    .map((s) => parseWeighted(s).tag)
    .filter(Boolean)) {
    if (!isIdentityItem(lex.byTag.get(t))) continue;
    const next = applyPin(lex, pinned, banned, t);
    pinned = next.pinned;
    banned = next.userBanned;
  }
  return pinned;
}

export const BUILTIN_PRESETS = [
  { id: "ol-office", name: "OL 辦公室", tags: ["office lady", "office"] },
  { id: "onsen", name: "溫泉", tags: ["onsen", "bathing"] },
  { id: "pool", name: "泳池", tags: ["pool", "swimming"] },
  { id: "beach", name: "海邊", tags: ["beach"] },
  { id: "classroom", name: "教室", tags: ["classroom", "school uniform"] },
  { id: "nurse", name: "護士", tags: ["nurse"] },
  { id: "maid", name: "女僕", tags: ["maid"] },
  { id: "police", name: "女警", tags: ["policewoman"] },
];

export function applyPresetTags(lex, tags) {
  let pinned = new Set();
  let banned = new Set();
  for (const tag of tags || []) {
    if (!lex.byTag.has(tag)) continue;
    const next = applyPin(lex, pinned, banned, tag);
    pinned = next.pinned;
    banned = next.userBanned;
  }
  return pinned;
}

export function sanitizePinPresets(raw, lex) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const p of raw) {
    if (!p || typeof p.name !== "string") continue;
    const name = p.name.trim().slice(0, 20);
    if (!name || seen.has(name)) continue;
    const tags = knownTags(lex, Array.isArray(p.tags) ? p.tags : []);
    if (!tags.length) continue;
    seen.add(name);
    out.push({ name, tags });
    if (out.length >= 16) break;
  }
  return out;
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

export const FEMALE_COUNT = new Set(["1girl", "2girls", "3girls", "4girls", "multiple girls"]);
export const MALE_COUNT = new Set(["1boy", "2boys", "3boys", "multiple boys"]);
const COUNT_NUM = {
  "1girl": 1,
  "2girls": 2,
  "3girls": 3,
  "4girls": 4,
  "multiple girls": 2,
  "1boy": 1,
  "2boys": 2,
  "3boys": 3,
  "multiple boys": 2,
};

export function hasFemale(cast) {
  return cast.some((t) => FEMALE_COUNT.has(t));
}
export function hasMale(cast) {
  return cast.some((t) => MALE_COUNT.has(t));
}
export function personCount(cast) {
  let n = 0;
  for (const t of cast) {
    const add = COUNT_NUM[t];
    if (add) n += add;
  }
  return n;
}

const FEMALE_SEQ = ["1girl", "2girls", "3girls", "4girls"];
const MALE_SEQ = ["1boy", "2boys", "3boys"];

function genderCount(cast, female) {
  const keys = female ? FEMALE_COUNT : MALE_COUNT;
  let n = 0;
  for (const t of cast) {
    if (keys.has(t)) n += COUNT_NUM[t] || 0;
  }
  return n;
}

function bumpGender(parts, female, want) {
  const seq = female ? FEMALE_SEQ : MALE_SEQ;
  const extra = female ? "multiple girls" : "multiple boys";
  if (genderCount(parts, female) >= want) return parts;
  const pick = seq.find((t) => COUNT_NUM[t] >= want) || seq[seq.length - 1];
  return [...parts.filter((t) => t !== extra && !seq.includes(t)), pick];
}

function ensureCast(parts, settings, ctx) {
  let out = parts.slice();
  if (ctx.needFemale && !hasFemale(out)) out.push("1girl");
  if (ctx.needMale && !hasMale(out)) out.push("1boy");
  if (ctx.need2Female) out = bumpGender(out, true, 2);
  if (ctx.need2Male) out = bumpGender(out, false, 2);
  const min = ctx.needCrowd ? 4 : ctx.needGroup ? 3 : ctx.needPair ? 2 : 1;
  const canGirl = settings.girl !== false;
  const canBoy = settings.boy !== false;
  let guard = 0;
  while (personCount(out) < min && guard++ < 6) {
    const g = genderCount(out, true);
    const b = genderCount(out, false);
    if (canGirl && canBoy) {
      if (g === 0) out.push("1girl");
      else if (b === 0) out.push("1boy");
      else if (g <= b) out = bumpGender(out, true, g + 1);
      else out = bumpGender(out, false, b + 1);
    } else if (canGirl) out = bumpGender(out, true, g + 1);
    else if (canBoy) out = bumpGender(out, false, b + 1);
    else break;
  }
  return out;
}

export function itemFitsHeats(item, heats) {
  if (!item) return false;
  const hs = item.heat && item.heat.length ? item.heat : MIXED_HEATS;
  const enabled = HEATS.filter((h) => (heats || []).includes(h));
  if (!enabled.length) return true;
  return enabled.some((h) => {
    if (h === "activity") return hs.includes("tease") || hs.includes("activity");
    return hs.includes(h);
  });
}

function heatOk(item, heat) {
  return itemFitsHeats(item, [heat]);
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

function castOk(item, female, male, people, girls = 0, boys = 0) {
  const needs = item.needs || [];
  if (needs.includes("pair") && people < 2) return false;
  if (needs.includes("group") && people < 3) return false;
  if (needs.includes("crowd") && people < 4) return false;
  if (needs.includes("male") && !male) return false;
  if (needs.includes("female") && !female) return false;
  if (needs.includes("2male") && boys < 2) return false;
  if (needs.includes("2female") && girls < 2) return false;
  if (needs.includes("yuri") && male) return false;
  return true;
}

function pinContext(lex, pinned) {
  let needFemale = false;
  let needMale = false;
  let needPair = false;
  let needGroup = false;
  let needCrowd = false;
  let need2Male = false;
  let need2Female = false;
  const heatLists = [];
  const eraLists = [];
  for (const tag of pinned) {
    const item = lex.byTag.get(tag);
    if (!item) continue;
    const needs = item.needs || [];
    if (item.gate === "female" || needs.includes("female") || FEMALE_COUNT.has(tag)) {
      needFemale = true;
    }
    if (item.gate === "male" || needs.includes("male") || MALE_COUNT.has(tag)) {
      needMale = true;
    }
    if (needs.includes("pair")) needPair = true;
    if (needs.includes("group")) needGroup = true;
    if (needs.includes("crowd")) needCrowd = true;
    if (needs.includes("2male")) {
      needMale = true;
      need2Male = true;
    }
    if (needs.includes("2female")) {
      needFemale = true;
      need2Female = true;
    }
    heatLists.push(item.heat && item.heat.length ? item.heat : MIXED_HEATS);
    const e = erasOf(item);
    if (e) eraLists.push(e);
  }
  return { needFemale, needMale, needPair, needGroup, needCrowd, need2Male, need2Female, heatLists, eraLists };
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

function chooseCast(lex, settings, pinned, banned, rand, ctx) {
  ctx = ctx || pinContext(lex, pinned);
  const povLock = pinned.has("pov") || pinned.has("pov crotch");
  const forced = [];
  for (const t of ["1girl", "2girls", "3girls", "4girls", "1boy", "2boys", "3boys"]) {
    if (pinned.has(t) && !banned.has(t)) forced.push(t);
  }
  let parts;
  if (forced.length) {
    parts = [...forced];
  } else if (povLock) {
    let girl = settings.girl;
    let boy = settings.boy;
    if (ctx.needFemale) girl = true;
    if (boy && !girl) parts = ["1boy"];
    else parts = ["1girl"];
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
  if (!povLock) parts = ensureCast(parts, settings, ctx);
  const n = personCount(parts);
  if (n === 1 && !banned.has("solo") && (!ctx.needPair || povLock)) parts.push("solo");
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

function chooseHeat(settings, pinned, lex, rand, ctx) {
  const enabled = HEATS.filter((h) => settings.heats.includes(h));
  ctx = ctx || pinContext(lex, pinned);
  const fromPins = intersectOrUnion(ctx.heatLists);
  let allowed = enabled.length ? enabled : ["tease"];
  if (fromPins && fromPins.length) {
    const hit = allowed.filter((h) => fromPins.includes(h));
    if (hit.length) allowed = hit;
  }
  const weights = { ...settings.weights };
  const filtered = {};
  for (const h of allowed) filtered[h] = weights[h] > 0 ? weights[h] : 1;
  return pickWeighted(filtered, rand) || allowed[0];
}

function chooseEra(settings, pinned, lex, rand, ctx) {
  let pool = (settings.eras || ERAS).filter((e) => ERAS.includes(e));
  if (!pool.length) pool = ["modern"];
  if (pool.length === 1) return pool[0];
  ctx = ctx || pinContext(lex, pinned);
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

export function heatMismatches(lex, pinned, heats) {
  const enabled = HEATS.filter((h) => (heats || []).includes(h));
  if (!enabled.length) return [];
  const out = [];
  for (const t of pinned) {
    const item = lex.byTag.get(t);
    if (!item) continue;
    if (!itemFitsHeats(item, enabled)) out.push(t);
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

function mutexOccupants(lex, mutexTaken, tag) {
  const item = lex.byTag.get(tag);
  const out = [];
  if (!item) return out;
  for (const g of extraMutex(item)) {
    const old = mutexTaken.get(g);
    if (old && old !== tag) out.push(old);
  }
  return out;
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
    const deps = implyChain(lex, tag);
    for (const d of deps) {
      if (used.has(d) || !depAllowed(lex, d, era)) continue;
      if (banned.has(d)) return false;
      if (mutexOccupants(lex, mutexTaken, d).some((occ) => !parentChild(lex, occ, d))) return false;
    }
    occupy(tag);
    for (const d of deps) {
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

const GARMENT_KEYS = [
  "shirt",
  "dress",
  "skirt",
  "sweater",
  "bikini",
  "swimsuit",
  "bra",
  "panties",
  "panty",
  "leotard",
  "coat",
  "jacket",
  "kimono",
  "yukata",
  "pants",
  "shorts",
  "jeans",
  "hoodie",
  "blouse",
  "towel",
];

const KEY_WEAR = {
  panty: ["panties", "thong", "panty"],
  panties: ["panties", "thong", "panty"],
  pants: ["pants", "jeans", "shorts"],
  jeans: ["jeans", "pants"],
  shorts: ["shorts"],
};

function tagTokens(tag) {
  return String(tag || "")
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];
}

export function actionGarmentKeys(actionTag) {
  const toks = new Set(tagTokens(actionTag));
  const keys = GARMENT_KEYS.filter((g) => toks.has(g));
  if (/blouse/.test(actionTag) && !keys.includes("blouse")) keys.push("blouse");
  if (/upskirt/.test(actionTag)) {
    if (!keys.includes("skirt")) keys.push("skirt");
    if (!keys.includes("dress")) keys.push("dress");
  }
  if (/(cameltoe|wedgie)/.test(actionTag) && !keys.includes("panty")) keys.push("panty");
  return keys;
}

export function needsBodyClothes(actionTag) {
  const t = String(actionTag || "").toLowerCase();
  return (
    /through clothes|under clothes/.test(t) ||
    t === "clothed sex" ||
    t === "clothed female nude male" ||
    t === "clothes lift" ||
    t === "clothes pull" ||
    t === "clothing aside" ||
    t === "undressing" ||
    t === "upskirt" ||
    t === "cameltoe" ||
    t === "wedgie" ||
    t === "strap slip" ||
    t === "areola slip" ||
    t === "nipple slip" ||
    t === "one breast out" ||
    t === "flashing" ||
    t === "erection under clothes" ||
    t === "bulge" ||
    t === "adjusting clothes" ||
    t === "clothes tug"
  );
}

export function clothingWearsKey(clothingTag, key) {
  const tag = String(clothingTag || "").toLowerCase();
  if (!tag || tag.startsWith("no ")) return false;
  const aliases = KEY_WEAR[key] || [key];
  const toks = new Set(tagTokens(tag));
  return aliases.some((w) => {
    if (tag === w || tag.endsWith(" " + w) || tag.endsWith(w)) return true;
    return tagTokens(w).every((t) => toks.has(t));
  });
}

const CLOTHES_ACCESSORY = new Set([
  "towel",
  "belt",
  "earrings",
  "kanzashi",
  "necklace",
  "bracelet",
  "choker",
  "ring",
  "hairband",
  "hair ornament",
]);

function wornBodyGarments(clothingTags) {
  return (clothingTags || []).filter((t) => {
    if (!t || t.startsWith("no ") || t === "nude" || t === "completely nude") return false;
    if (CLOTHES_ACCESSORY.has(t)) return false;
    return GARMENT_KEYS.some((k) => k !== "towel" && clothingWearsKey(t, k));
  });
}

export function actionFitsClothes(actionTag, clothingTags) {
  const worn = (clothingTags || []).filter(Boolean);
  const keys = actionGarmentKeys(actionTag);
  if (needsBodyClothes(actionTag)) {
    if (worn.some((t) => t === "nude" || t === "completely nude")) return 0;
    if (keys.length) return keys.some((k) => worn.some((c) => clothingWearsKey(c, k))) ? 2 : 0;
    return wornBodyGarments(worn).length ? 2 : 0;
  }
  if (!keys.length) return 1;
  return keys.some((k) => worn.some((c) => clothingWearsKey(c, k))) ? 2 : 0;
}

function takeFromPool(pool, count, rand, commit, prefer, allow) {
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
      if (allow && !allow(item)) continue;
      if (commit(item.tag)) n += 1;
    }
    if (n >= count) break;
  }
}

export function reconcile(lex, used, female, male, people, pinned = new Set(), lockScene = true) {
  const order = { subject: 0, feature: 1, clothing: 2, pose: 3, env: 4 };
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
    if (
      !castOk(item, female, male, people, genderCount(used, true), genderCount(used, false)) &&
      item.section !== "subject"
    ) {
      continue;
    }
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

  if (lockScene && keep.some((i) => BATH_PLACE.has(i.tag) || BATH_ACT.has(i.tag))) {
    keep = keep.filter((i) => pinned.has(i.tag) || !isBathBadCloth(i.tag));
  }

  if (people > 1) keep = keep.filter((i) => i.tag !== "solo" || pinned.has("solo"));
  if (people === 1 && !keep.some((i) => i.tag === "solo")) {
    const solo = lex.byTag.get("solo");
    if (solo) keep.push(solo);
  }

  if (keep.some((i) => i.tag === "bald")) {
    keep = keep.filter((i) => {
      if (pinned.has(i.tag) || i.tag === "bald") return true;
      if (i.mutex === "hair_color" || i.group === "hair_style") return false;
      return true;
    });
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

  const ctx = pinContext(lex, pinned);
  const heat = chooseHeat(settings, pinned, lex, rand, ctx);
  const era = chooseEra(settings, pinned, lex, rand, ctx);
  const commit = makeCommit(lex, used, mutexTaken, banned, era);
  const cast = chooseCast(lex, settings, pinned, banned, rand, ctx);
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
        if (banned.has(d) && !pinned.has(d)) continue;
        if (!pinned.has(d) && era && !depAllowed(lex, d, era)) continue;
        forcePin(d);
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

  const actionFitsWorn = (item) => {
    const cloth = [];
    for (const t of used) {
      const it = lex.byTag.get(t);
      if (it && it.section === "clothing") cloth.push(t);
    }
    return actionFitsClothes(item.tag, cloth);
  };
  const wearsBodyClothes = () => {
    if (
      someUsed(
        (it) =>
          it.tag === "nude" ||
          it.tag === "completely nude" ||
          (it.section === "clothing" && it.layer === "skin")
      )
    ) {
      return false;
    }
    return someUsed(
      (it) =>
        it.section === "clothing" &&
        it.layer === "garment" &&
        (it.mutex === "onepiece" || it.mutex === "top" || it.mutex === "bottom")
    );
  };
  const allow = (item) => {
    if (banned.has(item.tag) || used.has(item.tag)) return false;
    if (!heatOk(item, heat) || !eraOk(item, era) || !gateOk(item, female, male)) return false;
    if (!castOk(item, female, male, people, genderCount(used, true), genderCount(used, false))) return false;
    if (used.has("bald") && (item.mutex === "hair_color" || item.group === "hair_style")) return false;
    if (
      (item.mutex === "clothes_action" || item.group === "flash") &&
      actionFitsWorn(item) === 0
    ) {
      return false;
    }
    if (needsBodyClothes(item.tag) && !wearsBodyClothes()) return false;
    if (item.mutex === "activity" && !activityFitsBody(item.tag, usedMutexTags(used, lex, "body_pose"))) return false;
    if (item.mutex === "body_pose") {
      const acts = usedActs(used, lex);
      for (const a of acts) {
        if (!activityFitsBody(a, new Set([item.tag]))) return false;
      }
    }
    const needsFace =
      item.mutex === "gaze" ||
      item.mutex === "expression" ||
      item.group === "face" ||
      FACE_NEED_TAGS.has(item.tag);
    if (needsFace && [...used].some((t) => FACELESS_CAM.has(t))) return false;
    if (FACELESS_CAM.has(item.tag)) {
      for (const t of used) {
        const it = lex.byTag.get(t);
        if (
          it &&
          (it.mutex === "gaze" ||
            it.mutex === "expression" ||
            it.group === "face" ||
            FACE_NEED_TAGS.has(t))
        ) {
          return false;
        }
      }
    }
    if (NIGHT_MARK.has(item.tag) && [...used].some((t) => DAY_MARK.has(t) || t === "sunset")) return false;
    if (DAY_MARK.has(item.tag) && [...used].some((t) => NIGHT_MARK.has(t))) return false;
    if (used.has("sleeping") && SLEEP_BAD_POSE.has(item.tag)) return false;
    if (lockSceneOn(settings)) {
      const acts = usedActs(used, lex);
      const places = usedPlaces(used, lex);
      const real = realisticOn(settings);
      if ((item.mutex === "place" || item.group === "place") && !placeFitsActs(item.tag, acts, real)) return false;
      if (item.mutex === "activity" && !actFitsPlaces(item.tag, places, real)) return false;
      if (item.section === "clothing" && isBathScene(used) && isBathBadCloth(item.tag)) return false;
      if (used.has("outdoors") && INDOOR_PROP.has(item.tag)) return false;
      if (used.has("outdoors") && item.tag === "on bed") return false;
      if (used.has("indoors") && item.tag === "starry sky") return false;
      if (INDOOR_FURN.has(item.tag) && [...used].some((t) => t === "underwater" || t === "ocean" || t === "pool")) {
        return false;
      }
    }
    if (realisticOn(settings)) {
      if (item.mutex === "race" && !pinned.has(item.tag)) return false;
      const jobs = usedJobs(used, lex);
      if ((item.mutex === "place" || item.group === "place") && !placeFitsJob(item.tag, jobs)) {
        return false;
      }
      if (item.mutex === "activity") {
        const jp = jobPlacesOf(jobs);
        if (jp.size && !actFitsPlaces(item.tag, jp, true)) return false;
      }
      if (
        heat === "sex" &&
        (item.mutex === "place" || item.group === "place") &&
        !jobs.size &&
        !PRIVATE_SEX_PLACE.has(item.tag)
      ) {
        return false;
      }
    }
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
    const want = Math.max(0, Math.min(40, Number(counts[section]) || 0));
    const need = want - countSection(section);
    if (need <= 0) return;
    const pool = lex.bySection[section].filter(
      (item) => allow(item) && (!extraFilter || extraFilter(item))
    );
    let prefer = null;
    if (section === "clothing") prefer = clothingPrefer;
    else if (section === "env") prefer = (item) => eraSpecific(item, era) && item.mutex;
    else if (section === "pose") prefer = posePrefer;
    takeFromPool(pool, need, rand, commit, prefer, allow);
  };

  const stampAnchors = (section) => {
    for (const t of lex.data.eraAnchors?.[era] || []) {
      const item = lex.byTag.get(t);
      if (!item || item.section !== section) continue;
      if (used.has(t) || banned.has(t)) continue;
      if (!allow(item)) continue;
      commit(t);
    }
  };

  const fillSlot = (section, mutexName, preferOverride) => {
    if (mutexTaken.has(mutexName)) return;
    const indexed = lex.byMutex && lex.byMutex.get(section + ":" + mutexName);
    let pool = (indexed || lex.bySection[section].filter((item) => item.mutex === mutexName)).filter(
      (item) => allow(item)
    );
    if (section === "pose" && mutexName === "camera" && people >= 2) {
      pool = pool.filter((item) => item.tag !== "pov" && item.tag !== "pov crotch");
    }
    let prefer = preferOverride;
    if (prefer == null) {
      if (section === "clothing") prefer = clothingPrefer;
      else if (section === "env") prefer = (item) => eraSpecific(item, era);
    }
    takeFromPool(pool, 1, rand, commit, prefer, allow);
  };

  const fillGroup = (section, groupName) => {
    if (someUsed((it) => it.group === groupName)) return;
    const indexed = lex.byGroup && lex.byGroup.get(section + ":" + groupName);
    const pool = (indexed || lex.bySection[section].filter((item) => item.group === groupName)).filter(
      (item) => allow(item)
    );
    takeFromPool(pool, 1, rand, commit, null, allow);
  };

  fillSlot("feature", "hair_length");
  fillSlot("feature", "eye_color");
  if (!used.has("bald")) {
    fillSlot("feature", "hair_color");
    fillGroup("feature", "hair_style");
  }
  if (female) fillSlot("feature", "breast_size");
  if (male && !realisticOn(settings) && rand() < 0.38) fillSlot("feature", "race");
  if (settings.drawJob) fillSlot("feature", "job");
  fill("feature", (item) => {
    if (item.mutex === "race") return false;
    if (item.mutex === "job" && !settings.drawJob) return false;
    return true;
  });

  const clothingPinned = someUsed((it, t) => it.section === "clothing" && pinned.has(t));
  const nudePinned = someUsed((it) => it.section === "clothing" && it.layer === "skin");
  if (heat === "sex" && !clothingPinned && !nudePinned && !mutexTaken.has("onepiece") && !mutexTaken.has("top") && !mutexTaken.has("bottom")) {
    const cover = lex.bySection.clothing.filter(
      (item) =>
        allow(item) &&
        (item.layer === "skin" ||
          (item.layer === "garment" && (item.mutex === "onepiece" || item.mutex === "top" || item.mutex === "bottom")))
    );
    takeFromPool(cover, 1, rand, commit, clothingPrefer, allow);
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
      takeFromPool(pool, 1, rand, commit, clothingPrefer, allow);
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

  const soloSex = (tag) =>
    tag === "masturbation" ||
    tag === "female masturbation" ||
    tag === "male masturbation" ||
    tag === "fingering" ||
    tag === "masturbation through clothes";
  if (heat === "sex" && people >= 2) {
    const acts = lex.bySection.pose.filter(
      (item) => allow(item) && (item.mutex === "sex_act" || item.tag === "sex")
    );
    takeFromPool(acts, 1, rand, commit, null, allow);
  }
  if (heat === "sex" && people === 1) {
    const acts = lex.bySection.pose.filter((item) => allow(item) && soloSex(item.tag));
    takeFromPool(acts, 1, rand, commit, null, allow);
  }
  fillSlot("pose", "body_pose");
  fillSlot("pose", "camera");
  fillSlot("pose", "gaze");
  fillSlot("pose", "expression");
  const hasSexAct = someUsed((it) => it.mutex === "sex_act" || it.tag === "sex");
  if (heat !== "sex" && !hasSexAct) fillSlot("pose", "activity");
  if (heat === "flash") {
    const hasAct = someUsed((it) => it.mutex === "clothes_action" || it.group === "flash");
    if (!hasAct) {
      fillSlot("pose", "clothes_action", [
        (item) => actionFitsWorn(item) === 2,
        (item) => actionFitsWorn(item) === 1,
      ]);
      if (!someUsed((it) => it.mutex === "clothes_action" || it.group === "flash")) {
        fillGroup("pose", "flash");
      }
    }
  }
  fill("pose", (item) => {
    if (people >= 2 && soloSex(item.tag)) return false;
    if ((heat === "sex" || hasSexAct) && item.mutex === "activity" && !SEX_OK_ACTIVITY.has(item.tag)) return false;
    return true;
  });
  stampAnchors("env");
  fillSlot("env", "place");
  fillSlot("env", "in_out");
  fillSlot("env", "day_night");
  fill("env");

  if (lockSceneOn(settings)) {
    const places = usedPlaces(used, lex);
    const real = realisticOn(settings);
    const needsPlace = (act) =>
      act === "cooking" ||
      act === "driving" ||
      WATER_ACT.has(act) ||
      act === "horseback riding" ||
      act === "playing sports" ||
      act === "exercising" ||
      act === "training";
    for (const t of [...used]) {
      if (pinned.has(t)) continue;
      const it = lex.byTag.get(t);
      if (!it || it.mutex !== "activity") continue;
      if (!actFitsPlaces(t, places, real)) used.delete(t);
      else if (!places.size && needsPlace(t)) used.delete(t);
    }
  }

  const kept = reconcile(lex, used, female, male, people, pinned, lockSceneOn(settings));

  const quality = lex.data.quality.slice();
  const style = [];
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
    } else if (item.section === "quality") {
      if (!quality.includes(tag) && !style.includes(tag)) style.push(tag);
    } else if (bucket[item.section] && !bucket[item.section].includes(tag)) {
      bucket[item.section].push(tag);
    }
  }
  if (female) {
    const feel = ["soft breasts", "natural breasts"];
    const after = feature.findLastIndex((t) => lex.byTag.get(t)?.mutex === "breast_size");
    let at = after >= 0 ? after + 1 : feature.length;
    for (const t of feel) {
      if (userBanned.has(t) || feature.includes(t)) continue;
      feature.splice(at, 0, t);
      at += 1;
    }
  }
  if (!env.includes("soft lighting")) env.unshift("soft lighting");

  const nsfw = lex.data.nsfwTail;
  const ordered = [...subject, ...feature, ...clothing, ...pose, ...env, ...nsfw, ...style, ...quality];
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
    sections: { quality, style, subject, feature, pose, clothing, env, nsfw },
    positive: positive.join(", "),
    conflicts: contradictions(lex, positive),
    eraClash: eraMismatches(lex, pinned, era),
    heatClash: heatMismatches(lex, pinned, settings.heats),
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
    samePerson: false,
    drawJob: false,
    lockScene: true,
    sceneMode: "normal",
  };
}

export function sanitizeSettings(raw, data) {
  const base = defaultSettings(data);
  if (!raw || typeof raw !== "object") return base;
  const counts = { ...base.counts };
  const incoming = raw.counts && typeof raw.counts === "object" ? raw.counts : {};
  for (const key of Object.keys(counts)) {
    if (incoming[key] === undefined || incoming[key] === null) continue;
    counts[key] = Math.max(0, Math.min(20, Number(incoming[key]) || 0));
  }
  const girl = raw.girl === true || raw.girl === false ? raw.girl : base.girl;
  const boy = raw.boy === true || raw.boy === false ? raw.boy : base.boy;
  const heats = Array.isArray(raw.heats) ? raw.heats.filter((h) => HEATS.includes(h)) : [];
  const selected = heats.length ? HEATS.filter((h) => heats.includes(h)) : [...base.heats];
  const heatPreset = heatPresetOf(selected);
  const weights = weightsForHeats(selected, data.heatWeights);
  if (raw.weights && typeof raw.weights === "object") {
    for (const h of HEATS) {
      const w = Number(raw.weights[h]);
      if (Number.isFinite(w) && w >= 0) weights[h] = w;
    }
  }
  const eras = Array.isArray(raw.eras) ? raw.eras.filter((e) => ERAS.includes(e)) : [];
  let sceneMode = SCENE_MODES.includes(raw.sceneMode) ? raw.sceneMode : null;
  if (!sceneMode) sceneMode = raw.lockScene === false ? "weird" : "normal";
  return {
    n: Math.max(1, Math.min(10, Number(raw.n) || base.n)),
    width: Math.max(256, Math.min(2048, Number(raw.width) || base.width)),
    height: Math.max(256, Math.min(2048, Number(raw.height) || base.height)),
    counts,
    girl: girl || boy ? girl : true,
    boy: girl || boy ? boy : true,
    heats: selected,
    heatPreset,
    weights,
    eras: eras.length ? eras : [...base.eras],
    samePerson: raw.samePerson === true,
    drawJob: raw.drawJob === true,
    sceneMode,
    lockScene: sceneMode !== "weird",
  };
}

const WEIGHT_STEPS = [10, 11, 12, 13, 14, 15, 6, 7, 8, 9];

export function parseWeighted(part) {
  const s = String(part || "").trim();
  const m = s.match(/^\((.+):(\d+(?:\.\d+)?)\)$/);
  if (m) {
    const weight = Number(m[2]);
    return { tag: m[1].trim(), weight: Number.isFinite(weight) ? weight : 1 };
  }
  return { tag: s, weight: 1 };
}

export function formatWeight(w) {
  const n = Math.round((Number(w) || 1) * 10) / 10;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function formatWeighted(tag, weight) {
  if (!tag) return "";
  const n = Math.round((Number(weight) || 1) * 10) / 10;
  if (n === 1) return tag;
  return `(${tag}:${formatWeight(n)})`;
}

const CAST_PREFIX = new Set([...FEMALE_COUNT, ...MALE_COUNT, "solo", "adult"]);

export function insertTriggerAfterCast(positive, trigger) {
  const trig = String(trigger || "").trim();
  const pos = String(positive || "").trim();
  if (!trig) return pos;
  if (!pos) return trig;
  const parts = pos.split(",").map((s) => s.trim()).filter(Boolean);
  const extra = trig.split(",").map((s) => s.trim()).filter(Boolean);
  let i = 0;
  while (i < parts.length) {
    const { tag } = parseWeighted(parts[i]);
    if (!CAST_PREFIX.has(tag)) break;
    i += 1;
  }
  parts.splice(i, 0, ...extra);
  return parts.join(", ");
}

export function nextTagWeight(weight) {
  let t = Math.round((Number(weight) || 1) * 10);
  if (!WEIGHT_STEPS.includes(t)) t = 10;
  const i = WEIGHT_STEPS.indexOf(t);
  return WEIGHT_STEPS[(i + 1) % WEIGHT_STEPS.length] / 10;
}

export function stepTagWeight(weight, dir) {
  let t = Math.round((Number(weight) || 1) * 10);
  t += dir < 0 ? -1 : 1;
  if (t > 15) t = 15;
  if (t < 6) t = 6;
  return t / 10;
}

export function applyTagWeights(positive, weights) {
  const map = weights instanceof Map ? weights : new Map(Object.entries(weights || {}));
  const out = [];
  for (const part of String(positive || "").split(",")) {
    const parsed = parseWeighted(part);
    if (!parsed.tag) continue;
    const w = map.has(parsed.tag) ? Number(map.get(parsed.tag)) : parsed.weight;
    out.push(formatWeighted(parsed.tag, w));
  }
  return out.join(", ");
}

export function missingPins(positive, pinned) {
  const have = new Set(
    String(positive || "")
      .split(",")
      .map((s) => parseWeighted(s).tag)
      .filter(Boolean)
  );
  return [...pinned].filter((t) => !have.has(t));
}

export function pinMissLine(lex, positive, pinned, pinsAtDraw) {
  const scope = pinsAtDraw
    ? [...pinned].filter((t) => pinsAtDraw.has(t))
    : pinned;
  const miss = missingPins(positive, scope);
  if (!miss.length) return "";
  return "釘選未入：" + miss.map((t) => labelOf(lex, t)).join("、");
}

export function knownTags(lex, tags) {
  return [...(tags || [])].filter((t) => typeof t === "string" && t && lex.byTag.has(t));
}

export function labelOf(lex, tag) {
  const item = lex.byTag.get(tag);
  if (item?.zh) return item.zh;
  if (lex.data.zh && lex.data.zh[tag]) return lex.data.zh[tag];
  return tag;
}
