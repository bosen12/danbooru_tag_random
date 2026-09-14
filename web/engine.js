/** Tag-case draw: cast → heat → era → gated pools → commit mutex/bind/imply → reconcile. */

import {
  supportCandidateAllowed,
  validateSupportShadow,
} from "./shadow-validator.js";
import {
  SPORT_ACT_PLACE,
  SPORT_GEAR_IDENTITY,
  SPORT_BUTTONS,
  SPORT_IDENTITY,
  SPORT_MOVE_ACTS,
  SPORT_NEUTRAL_GEAR,
  SPORT_PRESETS,
  sportGearIdsOf,
  sportIdsOf,
  sportPresetTags,
  sportTagAllowed,
} from "./sports.js";

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
// 坐著或跪著做不了的活動。清單從 sports.js 算出來，不手抄，免得加新運動時失同步。
// 例外寫在 SEATED_OK_SPORT：跪射是合理的姿勢；騎車和游泳本來就有自己的姿勢規則。
const SEATED_OK_SPORT = new Set(["archery", "riding bicycle", "swimming", "skiing"]);
const SEATED_BAD_SPORT = new Set([
  "playing sports",
  "training",
  "exercising",
  ...SPORT_MOVE_ACTS.filter((a) => !SEATED_OK_SPORT.has(a)),
]);
const MOVE_ACT = new Set([
  "swimming",
  "hiking",
  "horseback riding",
  "riding bicycle",
  "playing sports",
  "exercising",
  "training",
  "dancing",
  "jogging",
  "skiing",
  "diving",
  "weightlifting",
]);
const STAND_OK_MOVE = new Set([
  "exercising",
  "training",
  "playing sports",
  "weightlifting",
  "hiking",
  "skiing",
]);
for (const act of SPORT_MOVE_ACTS) {
  MOVE_ACT.add(act);
  STAND_OK_MOVE.add(act);
}
const AWAKE_ACT = new Set([
  ...MOVE_ACT,
  "fishing",
  "wading",
  "carrying",
  "cooking",
  "cleaning",
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
  "diving",
  "weightlifting",
]);
/**
 * 同一個概念的兩種寫法。詞庫兩個都留著是刻意的 —— 同一個概念有兩張抽獎券，
 * 雙人情境要的就是這個加權 —— 但最後只該吐一個字出來。提示詞本來就超過 75 token，
 * 同義詞佔兩格純粹是白費。
 *
 * 這裡只放真的是別名的。general/specific 的父子對（extreme close-up → close-up、
 * high ponytail → ponytail）不算重複，Danbooru 本來就那樣疊，交給 parentChild()。
 */
/**
 * 性愛的三個時序階段：即將 / 進行中 / 已結束。這些字多半沒有 mutex，硬桶時代因為
 * 桶 2 根本輪不到所以碰不上，放開之後就會疊出「imminent penetration + after vaginal」
 * 這種同一張圖既還沒開始又已經結束的東西（實測 1.4%）。
 *
 * 只擋「即將」對「已結束」。進行中和任何一邊都說得通 —— 正在做的時候可以剛結束
 * 上一輪，也可以即將換下一個動作。
 */
const SEX_PHASE_BEFORE = new Set([
  "imminent penetration",
  "imminent vaginal",
  "imminent fellatio",
]);
const SEX_PHASE_AFTER = new Set([
  "after vaginal",
  "after sex",
  "after fellatio",
  "after paizuri",
  "afterglow",
  "cum drip",
]);

function sexPhaseClash(tag, used) {
  if (SEX_PHASE_BEFORE.has(tag)) {
    for (const t of used) if (SEX_PHASE_AFTER.has(t)) return true;
  }
  if (SEX_PHASE_AFTER.has(tag)) {
    for (const t of used) if (SEX_PHASE_BEFORE.has(t)) return true;
  }
  return false;
}

const SYNONYM_GROUPS = [
  new Set(["panting", "heavy breathing"]),
  new Set(["kissing", "kiss"]),
];

function synonymClash(tag, used) {
  for (const g of SYNONYM_GROUPS) {
    if (!g.has(tag)) continue;
    for (const t of used) if (t !== tag && g.has(t)) return true;
  }
  return false;
}

const FACELESS_CAM = new Set(["head out of frame", "lower body"]);
const FACE_NEED_TAGS = new Set([
  "closed eyes",
  "facial",
  "cum in mouth",
  "cum on face",
  "licking penis",
  "covering own mouth",
  "french kiss",
  "finger to mouth",
  "eating",
  "drinking",
  "selfie",
  "taking picture",
  "69",
  "kissing",
  "reading",
  "studying",
  "writing",
  "washing hair",
  "adjusting hair",
  "cunnilingus",
  "oral",
  "fellatio",
  "irrumatio",
  "head tilt",
  "after fellatio",
  "after paizuri",
  "closed mouth",
  "kiss",
  "paizuri",
  "breast focus",
  "talking on phone",
  "breast sucking",
  "singing",
  "karaoke",
  "smoking",
  "painting (action)",
  "tongue",
  "teeth",
  "playing games",
  "playing video games",
]);
const CHEST_NEED_TAGS = new Set([
  "breast hold",
  "breastfeeding",
  "spread cleavage",
  "paizuri gesture",
  "cum on breasts",
  "nipple tweak",
  "breast press",
  "arms under breasts",
  "arm under breasts",
  "breasts on table",
  "breasts on glass",
  "grabbing own breast",
  "breast bondage",
  "between breasts",
  "clothes between breasts",
  "breasts out",
  "hands on own breasts",
  "hand on own chest",
  "bouncing breasts",
  "guided breast grab",
  "nipple slip",
  "areola slip",
  "breast suppress",
  "tweaking own nipple",
  "breast rest",
  "breast lift",
  "hanging breasts",
  "breasts apart",
  "breasts squeezed together",
]);
const BED_PLACE = new Set(["bedroom", "bed", "hotel room", "love hotel", "futon"]);
const SKY_EXTRA = new Set(["sky", "blue sky", "orange sky"]);
const DAY_MARK = new Set(["day", "sunrise", "sunlight", "sunbathing", "blue sky", "orange sky"]);
const NIGHT_MARK = new Set(["night", "starry sky", "moonlight", "night market"]);
const SLEEP_BAD_POSE = new Set([
  "washing body",
  "partially submerged",
  "washing hair",
  "splashing",
  "breasts on table",
  "breasts on glass",
  "over shoulder",
  "grabbing own breast",
  "bent over",
  "presenting",
  "grinding",
  "hand on own crotch",
  "presenting ass",
  "masturbation through clothes",
  "female masturbation",
  "fingering",
]);
const SLEEP_BAD_EXPR = new Set([
  "shy",
  "come hither",
  "scared",
  "angry",
  "naughty face",
  "ahegao",
  "seductive smile",
  "smug",
  "surprised",
  "embarrassed",
  "nervous",
]);
const EYE_EXTRA = new Set(["wink", "empty eyes", "sparkling eyes", "half-closed eyes", "rolling eyes"]);
const MOUTH_EXTRA = new Set([
  "open mouth",
  "clenched teeth",
  "biting own lip",
  "tongue out",
  "parted lips",
  "licking lips",
  "drooling",
  "panting",
  "moaning",
]);
const OUTDOOR_LEFTOVER = new Set([
  "tree",
  "bush",
  "sky",
  "blue sky",
  "orange sky",
  "starry sky",
  "snow",
  "water",
  "cherry blossoms",
  "campfire",
]);

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
      act === "smoking" ||
      act === "bathing" ||
      act === "showering" ||
      act === "shared bathing" ||
      act === "swimming" ||
      act === "wading" ||
      act === "diving" ||
      act === "shopping" ||
      act === "weightlifting" ||
      act === "washing body" ||
      act === "washing hair")
  ) {
    return false;
  }
  if ([...body].some((t) => STILL_BODY.has(t)) && MOVE_ACT.has(act)) return false;
  if (body.has("standing") && MOVE_ACT.has(act) && !STAND_OK_MOVE.has(act)) return false;
  if (act === "driving" && [...body].some((t) => t !== "sitting")) {
    return false;
  }
  if ([...body].some((t) => LOCKED_SIT.has(t)) && (MOVE_ACT.has(act) || act === "wading")) return false;
  if ([...body].some((t) => LOCKED_SIT.has(t)) && (act === "yoga" || act === "stretching")) return false;
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
      act === "sunbathing" ||
      act === "yoga" ||
      act === "stretching" ||
      act === "weightlifting" ||
      act === "shopping")
  ) {
    return false;
  }
  if ([...body].some((t) => STILL_BODY.has(t) || LOCKED_SIT.has(t)) && act === "shopping") return false;
  if (SEATED_BAD_SPORT.has(act) && (body.has("sitting") || body.has("kneeling"))) {
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
        t === "dancing" ||
        t === "sitting" ||
        LIE_BODY.has(t)
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
  if (
    (act === "swimming" || act === "diving") &&
    (body.has("standing") ||
      body.has("squatting") ||
      body.has("kneeling") ||
      body.has("on one knee") ||
      body.has("sitting") ||
      [...body].some((t) => LIE_BODY.has(t) || GROUND_BODY.has(t)))
  ) {
    return false;
  }
  if (
    act === "wading" &&
    (body.has("squatting") ||
      body.has("kneeling") ||
      body.has("on one knee") ||
      body.has("sitting") ||
      [...body].some((t) => LOCKED_SIT.has(t) || LIE_BODY.has(t) || GROUND_BODY.has(t)))
  ) {
    return false;
  }
  if (
    (act === "hiking" || act === "playing sports" || act === "riding bicycle" || act === "jogging" || act === "skiing") &&
    (body.has("kneeling") || body.has("on one knee"))
  ) {
    return false;
  }
  if (act === "riding bicycle" && body.has("squatting")) return false;
  if (
    (act === "jogging" || act === "skiing" || act === "hiking") &&
    (body.has("sitting") || body.has("squatting"))
  ) {
    return false;
  }
  if (
    act === "weightlifting" &&
    [...body].some((t) => STILL_BODY.has(t) || LOCKED_SIT.has(t))
  ) {
    return false;
  }
  if (
    (act === "jogging" || act === "skiing" || act === "hiking") &&
    (body.has("sitting") || body.has("facesitting"))
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
const WATER_ACT = new Set(["swimming", "wading", "floating", "fishing", "bathing", "showering", "shared bathing", "diving"]);
// floating 也可以是漂浮在空中，不能單獨替 splashing / washing 類細節證明有水。
const WATER_SOURCE_ACT = new Set([...WATER_ACT].filter((tag) => tag !== "floating"));
const WATER_DETAIL = new Set([
  "partially submerged",
  "splashing",
  "washing body",
  "washing hair",
  "washing another's back",
]);
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
  "hard hat",
  "stethoscope",
  "lab coat",
]);

function isBathBadCloth(tag) {
  if (BATH_BAD_CLOTHES.has(tag)) return true;
  if (
    /\b(armor|suit|necktie|sneakers|boots|geta|zouri|shoes|hakama|blazer|sandals|hard hat|stethoscope|helmet|high heels|pantyhose|track jacket)\b/.test(
      tag
    )
  ) {
    return true;
  }
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
  "airplane interior",
  "cockpit",
  "bus interior",
  "movie theater",
  "convenience store",
  "supermarket",
  "internet cafe",
  "dormitory",
  "prison",
  "casino",
  "nightclub",
  "laboratory",
  "church",
  "dojo",
  "barn",
  "karaoke box",
  "apartment",
  "bowling alley",
  "boxing ring",
  "izakaya",
  "tavern",
  "ryokan",
  "fitness gym",
  "school gym",
]);
const INDOOR_PROP = new Set([
  "shoji",
  "carpet",
  "curtains",
  "bed sheet",
  "window",
  "tatami",
  "office chair",
  "gaming chair",
  "swivel chair",
]);
const SPORT_PLACE = new Set([
  "fitness gym",
  "school gym",
  "park",
  "beach",
  "courtyard",
  "poolside",
  "rooftop",
  "pool",
  "basketball court",
  "tennis court",
  "soccer field",
  "baseball stadium",
  "bowling alley",
  "boxing ring",
  "running track",
  "sports court",
  "golf course",
  "stadium",
  "dojo",
]);
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
const INDOOR_FURN = new Set(["on bed", "on chair", "office chair", "gaming chair", "swivel chair", "bunk bed"]);
const DESK_PLACE = new Set(["library", "bedroom", "living room", "cafe", "classroom", "office", "park bench", "garden", "shrine", "pavilion"]);
const HOME_PLACE = new Set(["bedroom", "living room", "hotel room", "futon"]);
const MEAL_PLACE = new Set(["restaurant", "cafe", "kitchen", "living room", "park", "garden", "beach", "courtyard"]);
const ACT_PLACE = {
  bathing: new Set([...BATH_PLACE]),
  showering: new Set(["bathroom", "shower (place)"]),
  swimming: new Set(["pool", "ocean", "beach", "underwater"]),
  wading: new Set(["beach", "ocean", "pool", "poolside", "lotus pond"]),
  floating: new Set(["pool", "ocean", "bathtub", "ofuro", "onsen", "open-air bath", "bubble bath"]),
  "shared bathing": new Set(["onsen", "sento", "ofuro", "open-air bath", "bath"]),
  eating: new Set([...MEAL_PLACE, "movie theater", "airplane interior", "convenience store", "izakaya", "festival", "market"]),
  drinking: new Set(["cafe", "bar (place)", "restaurant", "kitchen", "living room", "movie theater", "airplane interior", "izakaya", "festival", "market"]),
  reading: new Set([...DESK_PLACE, "train", "train interior"]),
  cooking: new Set(["kitchen", "great hall", "castle", "palace"]),
  shopping: new Set(["street", "city", "cityscape", "fitting room", "convenience store", "supermarket", "night market", "market", "festival"]),
  singing: new Set(["living room", "bar (place)", "park", "rooftop", "karaoke box", "church", "shrine", "festival"]),
  karaoke: new Set(["bar (place)", "living room", "karaoke box"]),
  "playing guitar": new Set(["bedroom", "living room", "park", "rooftop", "balcony", "garden"]),
  "playing games": new Set([...HOME_PLACE, "internet cafe"]),
  "playing video games": new Set([...HOME_PLACE, "internet cafe"]),
  "playing sports": SPORT_PLACE,
  studying: DESK_PLACE,
  writing: DESK_PLACE,
  "drawing (action)": new Set(["bedroom", "living room", "classroom", "cafe", "park", "garden"]),
  "painting (action)": new Set(["bedroom", "living room", "garden", "park", "courtyard", "pavilion"]),
  dancing: new Set(["living room", "park", "rooftop", "school gym", "bar (place)", "fitness gym"]),
  stretching: new Set(["bedroom", "living room", "fitness gym", "park", "rooftop", "beach"]),
  yoga: new Set(["bedroom", "living room", "fitness gym", "park", "rooftop", "beach"]),
  exercising: SPORT_PLACE,
  training: SPORT_PLACE,
  fishing: FISH_PLACE,
  camping: new Set(["forest", "park", "bamboo forest", "garden", "ruins", "tent", "river", "field"]),
  picnic: new Set(["park", "garden", "beach", "forest", "courtyard"]),
  hiking: new Set(["forest", "park", "bamboo forest", "garden", "mountain", "river", "bridge", "field"]),
  jogging: new Set(["park", "street", "running track", "stadium", "garden", "city", "cityscape", "alley"]),
  skiing: new Set(["mountain"]),
  diving: new Set(["ocean", "underwater", "pool"]),
  weightlifting: new Set(["fitness gym", "school gym"]),
  sunbathing: new Set(["beach", "poolside", "rooftop", "balcony", "park"]),
  sleeping: new Set([
    "bedroom",
    "hotel room",
    "love hotel",
    "living room",
    "bed",
    "apartment",
    "dormitory",
    "onsen",
    "ryokan",
    "tent",
    "train interior",
    "futon",
    "airplane interior",
  ]),
  smoking: new Set(["balcony", "rooftop", "street", "alley", "bar (place)", "cafe", "izakaya", "bridge", "courtyard"]),
  cleaning: new Set(["living room", "kitchen", "bedroom", "bathroom", "hallway", "office", "classroom", "church", "hospital", "prison"]),
  "talking on phone": new Set([
    "living room",
    "bedroom",
    "street",
    "office",
    "cafe",
    "balcony",
    "airplane interior",
    "airport",
    "cockpit",
    "hospital",
    "clinic",
    "church",
    "prison",
    "construction site",
    "movie theater",
    "convenience store",
    "car interior",
  ]),
  selfie: new Set([
    "living room",
    "bedroom",
    "park",
    "beach",
    "cafe",
    "rooftop",
    "church",
    "shrine",
    "airplane interior",
    "office",
    "hospital",
    "clinic",
    "prison",
    "dojo",
    "movie theater",
    "convenience store",
    "construction site",
    "car interior",
  ]),
  "taking picture": new Set(["park", "garden", "beach", "street", "shrine", "cafe", "church", "dojo"]),
  driving: DRIVE_PLACE,
  "horseback riding": new Set(["forest", "park", "garden", "courtyard", "ruins"]),
  "riding bicycle": new Set(["street", "park", "city", "alley"]),
};
// 從 sports.js 補進新運動的場地，免得射箭掉進臥室、自行車掉到床上。
for (const [act, places] of Object.entries(SPORT_ACT_PLACE)) {
  ACT_PLACE[act] = new Set([...(ACT_PLACE[act] || []), ...places]);
}
const ACT_PROP = {
  "playing guitar": ["guitar"],
  reading: ["book"],
  studying: ["book"],
  writing: ["pen"],
  "talking on phone": ["cellphone"],
  selfie: ["cellphone"],
  "taking picture": ["cellphone"],
  smoking: ["cigarette"],
  cooking: ["frying pan"],
  shopping: ["shopping bag"],
  cleaning: ["broom"],
  fishing: ["fishing rod"],
  "playing video games": ["game controller"],
  "painting (action)": ["paintbrush"],
  karaoke: ["microphone"],
  singing: ["microphone"],
};
const JOB_PLACE = {
  "office lady": new Set(["office"]),
  salaryman: new Set(["office"]),
  nurse: new Set(["clinic", "hospital"]),
  doctor: new Set(["clinic", "hospital"]),
  teacher: new Set(["classroom", "library", "school gym"]),
  waitress: new Set(["restaurant", "cafe", "bar (place)", "izakaya"]),
  barista: new Set(["cafe", "restaurant"]),
  policewoman: new Set(["street", "city", "cityscape", "alley", "office", "prison"]),
  maid: new Set(["mansion", "kitchen", "living room", "bedroom", "hotel room", "palace"]),
  "flight attendant": new Set(["airplane interior", "airport", "cockpit"]),
  firefighter: new Set(["street", "city", "cityscape"]),
  scientist: new Set(["laboratory"]),
  farmer: new Set(["farm", "barn", "rice paddy"]),
  "construction worker": new Set(["construction site"]),
  janitor: new Set(["hallway", "classroom", "office", "hospital", "school gym", "living room"]),
  "race queen": new Set(["stadium", "street", "city"]),
  soldier: new Set(["ruins", "street", "city", "forest"]),
};
const RAPE_BAD_PLACE = new Set(["classroom", "bedroom", "living room", "kitchen", "bed", "futon"]);
// 運動互斥全部從 web/sports.js 那份單一資料來源算出來。以前這裡自己列球、球拍、
// 制服和 SPORT_KIT 四份清單，改一個地方就會跟其他三份失同步。
//
// 判斷方式是「運動身分」：每個帶身分的 tag 記著哪些運動用得到它，場上所有這種 tag
// 的交集如果空了就是混到別的運動。所以 tennis racket + tennis ball 本來就共存
// （兩個都只屬於網球），但 basketball court + soccer ball 交集是空的，擋掉。
// 球鞋、運動服這類通用裝備不帶身分，不會害任何運動互斥。
const SPORT_VENUES = new Set();
const SPORT_ACTS = new Set();
for (const p of SPORT_PRESETS) {
  for (const v of p.venue || []) SPORT_VENUES.add(v);
  if (p.activity) SPORT_ACTS.add(p.activity);
}

function sportFieldOf(used) {
  for (const t of used) {
    if (SPORT_VENUES.has(t)) return t;
  }
  return null;
}

function sportKitOk(item, used) {
  return sportTagAllowed(item.tag, used);
}

/**
 * 運動器材本身就限定場地：球拍、腳踏車、弓在浴室裡不成立。
 *
 * 活動 tag 不再釘死之後（改由尺度決定），沒有場地的運動就失去了 ACT_PLACE 的約束，
 * 自行車會掉進浴室。這裡補回來：場上看得出是哪個運動，場地就必須是那個運動的
 * 場地，或它的活動本來就允許的場地。查不到場地資訊的運動不限制。
 */
function compatibleSportPlaces(ids) {
  const okPlaces = new Set();
  if (!ids || !ids.size) return okPlaces;
  for (const sp of SPORT_PRESETS) {
    if (!ids.has(sp.id)) continue;
    for (const v of sp.venue || []) okPlaces.add(v);
    for (const pl of ACT_PLACE[sp.activity] || []) okPlaces.add(pl);
  }
  return okPlaces;
}

/**
 * 一組運動身分與一組場地是否相容。候選 gate 與釘選 warning 共用這個純函式，
 * 避免兩邊各抄一份場地清單後逐漸失同步。
 */
export function sportIdsFitPlaces(ids, places) {
  if (!ids || !ids.size || !places || !places.size) return true;
  const okPlaces = compatibleSportPlaces(ids);
  if (!okPlaces.size) return true;
  for (const place of places) if (okPlaces.has(place)) return true;
  return false;
}

function sportPlaceOk(item, used) {
  if (item.mutex !== "place" && item.group !== "place") return true;
  // 只看器材，不看服裝：穿排球服在廚房是可以的，浴室騎腳踏車不行。
  return sportIdsFitPlaces(sportGearIdsOf(used), new Set([item.tag]));
}

// sportPlaceOk() 的反向。上面那支只在「候選是場地」時擋，所以場地先定、器材後抽
// 就整個繞過去了 —— 客廳抽到網球拍就是這樣來的（網球服先進場給了運動身分，
// 球拍再跟著合法進來）。意圖在 sportPlaceOk 的註解裡寫得很清楚：浴室騎腳踏車不行。
// 兩個方向都要擋，規則才不會被抽取順序左右。
//
// SPORT_GEAR_IDENTITY 裡的不只是手持器材，還包含活動與場地本身 —— 這是刻意的：
// 補牌補回來的活動在場地定了之後，要受同一個方向的檢查。它唯一排除的是服裝，
// 所以穿網球服待在客廳可以，把球拍或「打網球」這個動作放進客廳不行。
function sportGearPlaceOk(item, used, lex) {
  const own = SPORT_GEAR_IDENTITY.get(item.tag);
  if (!own || !own.size) return true;
  return sportIdsFitPlaces(own, usedPlaces(used, lex));
}

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
  "kitchen",
]);
const PUBLIC_SEX_PLACE = new Set(["street", "city", "cityscape", "alley", "park", "beach", "ocean", "rooftop"]);

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

function placeFitsJob(place, jobs, used) {
  if (jobs.size) {
    for (const j of jobs) {
      const ok = JOB_PLACE[j];
      if (ok && !ok.has(place)) return false;
    }
    return true;
  }
  if (used && used.has("maid") && JOB_PLACE.maid && !JOB_PLACE.maid.has(place)) {
    if (isSwimScene(used) || isBathScene(used)) return true;
    return false;
  }
  return true;
}

export function placeFitsActs(place, acts, realistic = false) {
  if (!acts.size) return true;
  if (realistic) {
    let listed = 0;
    for (const a of acts) {
      const ok = ACT_PLACE[a];
      if (!ok) continue;
      listed += 1;
      if (!ok.has(place)) return false;
    }
    if (listed === acts.size) return true;
  }
  if (acts.has("fishing")) return FISH_PLACE.has(place);
  if ([...acts].some((a) => WATER_ACT.has(a))) return WATER_PLACE.has(place);
  if (acts.has("horseback riding")) return !INDOOR_ROOM.has(place) && !BATH_PLACE.has(place);
  if (acts.has("driving")) return DRIVE_PLACE.has(place);
  if (acts.has("cooking")) {
    return place === "kitchen" || place === "great hall" || place === "castle" || place === "palace";
  }
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
  if (acts.has("skiing")) return place === "mountain";
  if (acts.has("karaoke")) {
    if (realistic) return place === "bar (place)" || place === "living room" || place === "karaoke box";
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

function actFitsSomePlaces(act, places, realistic = false) {
  if (!places.size) return true;
  return [...places].some((p) => placeFitsActs(p, new Set([act]), realistic));
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
    if (BATH_ACT.has(t)) return true;
  }
  for (const t of used) {
    if (t === "bathroom") continue;
    if (BATH_PLACE.has(t)) return true;
  }
  return false;
}

function isSwimAct(used) {
  return used.has("swimming") || used.has("diving");
}

function isSwimScene(used) {
  if (used.has("fishing") && !isSwimAct(used) && !used.has("wading")) {
    return false;
  }
  if (isSwimAct(used) || used.has("wading")) return true;
  for (const t of used) {
    if (t === "pool" || t === "poolside" || t === "beach" || t === "ocean" || t === "underwater") return true;
  }
  return false;
}

function isSwimClothItem(item) {
  if (!item || item.section !== "clothing") return false;
  if (item.layer === "skin" || item.layer === "accessory") return true;
  if (item.tag === "wet clothes") return true;
  if (/\b(swimsuit|bikini)\b/.test(item.tag)) return true;
  if ((item.implies || []).some((d) => /\b(swimsuit|bikini)\b/.test(d))) return true;
  return false;
}

function pinnedNonSwimGarment(used, pinned, lex) {
  for (const t of pinned) {
    const it = lex.byTag.get(t);
    if (it && it.section === "clothing" && it.layer === "garment" && !isSwimClothItem(it)) return true;
  }
  return false;
}

function swimwearLocked(used, pinned, lex, era, realistic) {
  return realistic && isSwimScene(used) && !pinnedNonSwimGarment(used, pinned, lex);
}

function garmentOkForSwim(item, era) {
  if (isSwimClothItem(item)) return true;
  if (/\b(armor|suit|maid)\b/.test(item.tag)) return false;
  if (era === "modern") return false;
  return true;
}

function sceneClothKind(used) {
  if (isSwimAct(used) || used.has("underwater")) return "swim";
  if (used.has("changing room") || used.has("locker room") || used.has("fitting room")) return "dressing";
  if (isBathScene(used)) return "bath";
  if (
    !isSwimAct(used) &&
    (used.has("beach") || used.has("poolside") || used.has("ocean") || used.has("pool"))
  ) {
    return "shore";
  }
  if (used.has("office lady") || used.has("salaryman") || used.has("office")) return "office";
  if (used.has("nurse")) return "nurse";
  if (used.has("maid")) return "maid";
  if (used.has("policewoman") || used.has("police uniform")) return "police";
  if (used.has("classroom") || used.has("school uniform")) return "school";
  if (used.has("kitchen") || used.has("cooking")) return "kitchen";
  if (used.has("flight attendant") || used.has("airplane interior") || used.has("cockpit")) return "cabin";
  if (used.has("skiing")) return "sport";
  if (used.has("firefighter")) return "fire";
  if (used.has("scientist") || used.has("laboratory")) return "lab";
  if (used.has("construction worker") || used.has("construction site")) return "site";
  if (used.has("nun") || used.has("church")) return "church";
  if (used.has("prison")) return "prison";
  if (used.has("dojo")) return "dojo";
  if (used.has("driving") || used.has("car interior") || used.has("car")) return "drive";
  if (used.has("sleeping")) return "sleep";
  if (used.has("shopping") || used.has("convenience store") || used.has("supermarket")) return "shop";
  if (used.has("karaoke") || used.has("karaoke box") || used.has("singing")) return "indoor";
  if (
    sportFieldOf(used) ||
    [...used].some((t) => SPORT_ACTS.has(t)) ||
    used.has("fitness gym") ||
    used.has("school gym") ||
    used.has("exercising") ||
    used.has("training") ||
    used.has("weightlifting")
  ) {
    return "sport";
  }
  if (used.has("indoors") && !isSwimScene(used) && !isBathScene(used)) return "indoor";
  return null;
}

const SCENE_BAD_CLOTH = {
  office: /\b(swimsuit|bikini|armor|hakama|maid|kimono|yukata|school swimsuit|evening gown|wedding dress)\b/,
  school: /\b(swimsuit|bikini|armor|maid|evening gown|police uniform|wedding dress|hard hat|soccer uniform|basketball uniform|tennis uniform|volleyball uniform)\b/,
  nurse: /\b(swimsuit|bikini|armor|maid|school uniform|serafuku|evening gown|hakama|police|wedding dress|baseball uniform|soccer uniform|tennis uniform|volleyball uniform|basketball uniform|cheerleader)\b/,
  maid: /\b(swimsuit|bikini|armor|school uniform|police|evening gown|hakama|lab coat)\b/,
  police: /\b(swimsuit|bikini|maid|school swimsuit|evening gown|hakama|armor)\b/,
  kitchen: /\b(swimsuit|bikini|armor|evening gown|hakama|police)\b/,
  cabin: /\b(swimsuit|bikini|armor|maid|wedding dress|yukata|hakama|kimono|cheerleader)\b/,
  fire: /\b(swimsuit|bikini|wedding dress|maid|yukata|evening gown)\b/,
  lab: /\b(swimsuit|bikini|armor|maid|wedding dress)\b/,
  site: /\b(swimsuit|bikini|wedding dress|evening gown|yukata|maid)\b/,
  church: /\b(swimsuit|bikini|armor|maid|police uniform)\b/,
  prison: /\b(wedding dress|evening gown|swimsuit|bikini|playboy bunny|idol clothes|cheerleader|maid)\b/,
  sport: /\b(armor|maid|wedding dress|evening gown|hakama|yukata|kimono|lab coat)\b/,
  dojo: /\b(swimsuit|bikini|basketball uniform|tennis uniform|soccer uniform|volleyball uniform|cheerleader|maid)\b/,
  drive: /\b(swimsuit|bikini|armor|evening gown|wedding dress|hakama|school swimsuit|cheerleader|maid)\b/,
  dressing: /\b(armor|suit|evening gown|wedding dress|hakama|lab coat)\b/,
  shore: /\b(armor|suit|maid|evening gown|wedding dress|lab coat|hakama)\b/,
  sleep: /\b(swimsuit|bikini|armor|cheerleader|wedding dress|evening gown|school swimsuit)\b/,
  shop: /\b(swimsuit|bikini|armor|evening gown|wedding dress|school swimsuit)\b/,
  indoor: /\b(swimsuit|bikini|armor|school swimsuit|cheerleader)\b/,
};

// 不使用 onepiece/bottom mutex、但畫面上確實遮到下半身的服裝。engine 早期只認
// 三個 body mutex，於是 kimono、ancient greek clothes 這種整套服裝和
// underwear_bottom 的 loincloth 在補救邏輯眼中等於沒穿。
const LOWER_COVER_TAGS = new Set([
  "dress",
  "school uniform",
  "leotard",
  "bodysuit",
  "skirt",
  "shorts",
  "pants",
  "swimsuit",
  "bikini",
  "one-piece swimsuit",
  "panties",
  "underwear",
  "chinese clothes",
  "ancient greek clothes",
  "armor",
  "chainmail",
  "kimono",
  "japanese clothes",
  "yukata",
  "sportswear",
  "loincloth",
]);

const BODY_GARMENT_SLOTS = new Set(["onepiece", "top", "bottom"]);

function bodyGarmentSlot(item) {
  if (!item || item.section !== "clothing" || item.layer !== "garment") return null;
  if (BODY_GARMENT_SLOTS.has(item.mutex)) return item.mutex;
  if (BODY_GARMENT_SLOTS.has(item.group)) return item.group;
  return null;
}

function isBodyGarment(item) {
  return Boolean(bodyGarmentSlot(item)) || LOWER_COVER_TAGS.has(item?.tag);
}

function coversLowerBody(item) {
  const slot = bodyGarmentSlot(item);
  return slot === "onepiece" || slot === "bottom" || LOWER_COVER_TAGS.has(item?.tag);
}

function isBathOkGarment(item) {
  if (!item || item.section !== "clothing") return true;
  if (item.layer === "skin") return true;
  const t = item.tag;
  return (
    t === "wet clothes" ||
    t === "naked towel" ||
    t === "bathrobe" ||
    t === "yukata" ||
    t === "bath yukata" ||
    t === "fundoshi" ||
    t === "loincloth" ||
    t === "japanese clothes" ||
    t === "chinese clothes" ||
    t === "hanfu" ||
    t === "ruqun" ||
    t === "ancient greek clothes" ||
    // 亞麻襯衣提供中世紀／維多利亞女性浴場的非裸體選項。
    t === "chemise"
  );
}

const SCENE_BAD_ACC = {
  office: /\b(police hat|nurse cap|hard hat|helmet|stethoscope|innertube|beach umbrella)\b/,
  school: /\b(police hat|nurse cap|hard hat|helmet|stethoscope|innertube|beach umbrella)\b/,
  nurse: /\b(police hat|hard hat|helmet|innertube|beach umbrella)\b/,
  maid: /\b(police hat|nurse cap|hard hat|helmet|stethoscope|innertube|beach umbrella)\b/,
  police: /\b(nurse cap|hard hat|helmet|stethoscope|innertube|beach umbrella)\b/,
  kitchen: /\b(innertube|beach umbrella|hard hat|police hat|nurse cap|helmet)\b/,
  swim: /\b(necktie|bowtie|microphone|clipboard|hard hat|helmet|police hat|nurse cap|stethoscope)\b/,
  bath: /\b(necktie|bowtie|police hat|nurse cap|hard hat|helmet|stethoscope|microphone|clipboard|innertube|beach umbrella|umbrella|high heels)\b/,
};

function accessoryOkForKind(item, kind) {
  if (!item || item.layer !== "accessory") return true;
  const re = SCENE_BAD_ACC[kind];
  return !(re && re.test(item.tag));
}

function garmentOkForKind(item, kind, era) {
  if (!item || item.section !== "clothing") return true;
  if (item.layer === "accessory") return accessoryOkForKind(item, kind);
  if (kind === "school" && item.tag === "school swimsuit") return true;
  if (kind === "indoor" && /\barmor\b/.test(item.tag) && (era === "medieval" || era === "edo")) return true;
  if (kind === "swim") {
    if (item.layer === "skin") return true;
    return garmentOkForSwim(item, era);
  }
  if (kind === "bath") {
    if (item.layer === "skin") return true;
    return isBathOkGarment(item);
  }
  if (item.layer === "skin") return true;
  const re = SCENE_BAD_CLOTH[kind];
  if (re && re.test(item.tag)) return false;
  return true;
}

function sceneClothLocked(used, pinned, lex, era, lockOn) {
  if (!lockOn) return null;
  return sceneClothKind(used);
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

const LEAN_POSE = new Set(["leaning forward", "leaning back"]);
const ARM_POSE = new Set([
  "arms behind back",
  "arms behind head",
  "crossed arms",
  "heart hands",
  "v",
  "reaching towards viewer",
  "hands on own hips",
  "hand on hip",
  "hands on own breasts",
  "hand in pocket",
  "index fingers together",
  "beckoning",
]);
const LIE_BODY = new Set(["lying", "on back", "on stomach", "on side", "reclining"]);
const LEG_EXTRA = new Set(["crossed legs", "legs up", "one knee up", "m legs", "leg lift"]);
const HAIR_TEXTURE = new Set(["straight hair", "wavy hair", "curly hair"]);
const PENIS_SIZE = new Set(["small penis", "large penis", "huge penis"]);
const HANDS_BUSY_ACT = new Set([
  "playing guitar",
  "talking on phone",
  "writing",
  "drawing (action)",
  "painting (action)",
  "cooking",
  "eating",
  "weightlifting",
  "drinking",
  "selfie",
  "fishing",
  "taking picture",
  "washing hair",
  "washing body",
  "playing games",
  "playing video games",
  "recording",
  "smoking",
  "driving",
  "riding bicycle",
  "washing another's back",
  "shopping",
  "cleaning",
  "singing",
  "karaoke",
  "picnic",
]);
// Only worn blockers belong here. A racket/bat/bow in the scene does not prove somebody is holding it.
const HANDS_OCCUPIED = new Set(["boxing gloves"]);
const NEEDS_FREE_HAND = new Set([
  "handjob",
  "fingering",
  "masturbation",
  "female masturbation",
  "male masturbation",
  "masturbation through clothes",
]);
const HANDS_BUSY_BODY = new Set(["crawling", "all fours", "top-down bottom-up", "bondage", "restrained", "handcuffs"]);
const BOTH_ARMS = new Set([
  "arms behind back",
  "arms behind head",
  "crossed arms",
  "heart hands",
  "hands on own hips",
  "hands on own breasts",
  "index fingers together",
  "paizuri gesture",
  "spread cleavage",
  "breast hold",
  "arms under breasts",
]);
const HAND_GESTURE = new Set([
  "finger to mouth",
  "hand on hip",
  "hand on own chest",
  "hand on own hip",
  "adjusting hair",
  "adjusting clothes",
  "clothes tug",
  "paizuri gesture",
  "breast hold",
  "hands on own breasts",
  "pointing at viewer",
  "ojou-sama pose",
  "grabbing own breast",
  "holding hands",
  "recording",
  "spread cleavage",
  "breasts squeezed together",
  "clothes pull",
  "panty pull",
  "bra pull",
  "wedgie",
  "self fondling",
]);

function extraMutex(item) {
  if (item._mx) return item._mx;
  const groups = [];
  if (item.mutex) groups.push(item.mutex);
  for (const g of item.mutexExtra || []) {
    if (g && !groups.includes(g)) groups.push(g);
  }
  if (LEAN_POSE.has(item.tag)) groups.push("lean");
  if (ARM_POSE.has(item.tag)) groups.push("arms");
  if (BOTH_ARMS.has(item.tag)) groups.push("both_arms");
  if (LEG_EXTRA.has(item.tag)) groups.push("legs");
  if (HAIR_TEXTURE.has(item.tag)) groups.push("hair_texture");
  if (PENIS_SIZE.has(item.tag)) groups.push("penis_size");
  if (HAND_GESTURE.has(item.tag) && item.tag !== "holding hands") groups.push("hand_g");
  if (item.tag === "navel" || item.tag === "covered navel") groups.push("navel");
  if (item.tag === "pale skin" || item.tag === "dark skin" || item.tag === "very dark skin") groups.push("skin_tone");
  if (item.tag === "nipples" || item.tag === "covered nipples") groups.push("nipple_show");
  if (/\b(necktie|bowtie)\b/.test(item.tag)) groups.push("neckwear");
  if (item.mutex === "held_prop" || item.mutex === "sport_prop") groups.push("held");
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
  { id: "cabin", name: "空姐機艙", tags: ["flight attendant", "airplane interior"] },
  { id: "cinema", name: "電影院", tags: ["movie theater"] },
  { id: "conveni", name: "便利商店", tags: ["convenience store"] },
  { id: "church-nun", name: "教堂修女", tags: ["nun", "church"] },
  { id: "shrine", name: "神社巫女", tags: ["miko", "shrine"] },
  { id: "wedding", name: "婚禮", tags: ["wedding dress", "church"] },
  { id: "site", name: "工地", tags: ["construction worker", "construction site"] },
  { id: "fire", name: "消防員", tags: ["firefighter"] },
  { id: "prison", name: "監獄", tags: ["prison"] },
  { id: "xmas", name: "聖誕", tags: ["santa costume"] },
  { id: "ski", name: "滑雪", tags: ["skiing"] },
  { id: "dojo", name: "道場", tags: ["dojo"] },
  // 運動組合全部由 web/sports.js 產生：按鈕寫運動名稱，一次帶進活動、場地、器材、服裝。
  ...SPORT_BUTTONS.map((p) => ({
    id: p.id,
    name: p.name,
    tags: sportPresetTags(p),
    // 活動不進必進 POS，抽牌時按尺度自動帶上。留著只是給 UI 說明用。
    activity: p.activity || null,
    // core 是「這套的識別性成員」。球鞋、運動服這種跨運動通用的裝備不算，
    // 否則換到網球之後籃球會因為共用球鞋而一直顯示半亮。
    core: sportPresetTags(p).filter((t) => !SPORT_NEUTRAL_GEAR.has(t)),
    sport: true,
  })),
];

export function applyPresetTags(lex, tags, existing = new Set()) {
  const presetMutex = new Set();
  const seen = new Set();
  const mark = (tag) => {
    if (seen.has(tag)) return;
    seen.add(tag);
    const item = lex.byTag.get(tag);
    if (!item) return;
    for (const g of extraMutex(item)) presetMutex.add(g);
    for (const d of [...(item.implies || []), ...(item.bind || [])]) mark(d);
  };
  for (const t of tags || []) mark(t);
  const clearsClothes = [...seen].some((t) => {
    const it = lex.byTag.get(t);
    if (!it) return false;
    return (
      it.section === "env" ||
      it.section === "clothing" ||
      it.mutex === "place" ||
      it.mutex === "activity" ||
      it.mutex === "job"
    );
  });
  let pinned = new Set();
  for (const t of existing) {
    const item = lex.byTag.get(t);
    if (!item) continue;
    if (clearsClothes && item.section === "clothing" && item.layer === "garment") continue;
    if ([...extraMutex(item)].some((g) => presetMutex.has(g))) continue;
    pinned.add(t);
  }
  let banned = new Set();
  for (const tag of tags || []) {
    if (!lex.byTag.has(tag)) continue;
    const next = applyPin(lex, pinned, banned, tag);
    pinned = next.pinned;
    banned = next.userBanned;
  }
  return pinned;
}

export function presetOwnedTags(lex, tags) {
  const seen = new Set();
  const mark = (tag) => {
    if (!tag || seen.has(tag)) return;
    const item = lex.byTag.get(tag);
    if (!item) return;
    seen.add(tag);
    for (const d of [...(item.implies || []), ...(item.bind || [])]) mark(d);
  };
  for (const t of tags || []) mark(t);
  return seen;
}

/**
 * "on" 全在、"mixed" 只剩一部分、"off" 一個都不在。
 *
 * core 是選填的「識別性成員」清單：只要 core 一個都不在就算 off，即使還有共用
 * 裝備留著。這樣換運動之後舊運動不會因為共用球鞋而一直顯示半亮。
 */
export function presetState(lex, tags, pinned, core) {
  const need = (tags || []).filter((t) => lex.byTag.has(t));
  if (!need.length) return "off";
  if (Array.isArray(core) && core.length) {
    const anyCore = core.some((t) => lex.byTag.has(t) && pinned.has(t));
    if (!anyCore) return "off";
  }
  let have = 0;
  for (const t of need) if (pinned.has(t)) have += 1;
  if (!have) return "off";
  return have === need.length ? "on" : "mixed";
}

export function presetActive(lex, tags, pinned, core) {
  return presetState(lex, tags, pinned, core) === "on";
}

/**
 * 使用者自己釘了互相矛盾的運動時回報一下。專案既有政策是保留明確釘選並顯示 warning，
 * 不靜默刪掉使用者要的東西 —— 這裡只負責講，不動 pinned。
 */
/**
 * 釘著的活動會不會擋掉性愛動作。engine 的規則是「會動的活動」跟性愛不能並存
 * （游泳、泡澡那些在 SEX_OK_ACTIVITY 白名單裡例外）。這裡只負責講，不動 pinned ——
 * 使用者自己釘的東西不靜默刪掉。
 */
export function sportHeatWarnings(lex, pinned, heats) {
  if (!(heats || []).includes("sex")) return [];
  const blocking = [];
  for (const t of pinned) {
    const it = lex.byTag.get(t);
    if (!it || it.mutex !== "activity") continue;
    if (MOVE_ACT.has(t) && !SEX_OK_ACTIVITY.has(t)) blocking.push(t);
  }
  return blocking.length ? [{ kind: "sexActivity", tags: blocking }] : [];
}

/** Explicit user pins are preserved, but surface worn-hand/free-finger conflicts. */
export function handUsageWarnings(pinned) {
  const occupied = [...pinned].filter((tag) => HANDS_OCCUPIED.has(tag));
  const needsFree = [...pinned].filter((tag) => NEEDS_FREE_HAND.has(tag));
  return occupied.length && needsFree.length
    ? [{ kind: "hands", tags: [...occupied, ...needsFree] }]
    : [];
}

export function sportPinWarnings(lex, pinned) {
  const ids = sportIdsOf(pinned);
  if (ids === null || ids.size > 0) return [];
  const tags = [...pinned].filter((t) => SPORT_IDENTITY.has(t));
  return tags.length > 1 ? [{ kind: "sport", tags }] : [];
}

/** Explicit place + sport-gear/activity pins survive, but normal/diverse surfaces the clash. */
export function sportPlacePinWarnings(lex, pinned, settings) {
  if (!lockSceneOn(settings)) return [];
  const places = usedPlaces(pinned, lex);
  if (!places.size) return [];
  const gear = [...pinned].filter((tag) => SPORT_GEAR_IDENTITY.has(tag) && !places.has(tag));
  const bad = [];
  if (gear.length) {
    const ids = sportGearIdsOf(gear);
    // Cross-sport explicit pins have their own, more specific warning.
    if (ids && ids.size && !sportIdsFitPlaces(ids, places)) bad.push(...gear);
  }
  // Generic `playing sports` intentionally carries no sport identity, but it is still an activity
  // with a declared SPORT_PLACE dependency and therefore must participate in the pin warning.
  for (const tag of pinned) {
    if (!SPORT_ACTS.has(tag) || SPORT_GEAR_IDENTITY.has(tag)) continue;
    const allowed = ACT_PLACE[tag];
    if (allowed && ![...places].some((place) => allowed.has(place))) bad.push(tag);
  }
  return bad.length ? [{ kind: "sportPlace", tags: [...places, ...bad] }] : [];
}

export function clearPresetTags(lex, tags, existing = new Set()) {
  const drop = presetOwnedTags(lex, tags);
  const keep = [];
  for (const t of existing) {
    if (!drop.has(t)) keep.push(t);
  }
  let pinned = new Set();
  let banned = new Set();
  for (const t of keep) {
    if (!lex.byTag.has(t)) continue;
    const next = applyPin(lex, pinned, banned, t);
    pinned = next.pinned;
    banned = next.userBanned;
  }
  return pinned;
}

function sameTagList(a, b) {
  const A = new Set(a || []);
  const B = new Set(b || []);
  if (A.size !== B.size) return false;
  for (const t of A) if (!B.has(t)) return false;
  return true;
}

export function togglePresetTags(lex, tags, existing = new Set(), others) {
  if (presetActive(lex, tags, existing)) return clearPresetTags(lex, tags, existing);
  const lists = others || BUILTIN_PRESETS.map((p) => p.tags);
  let pinned = existing;
  for (const ot of lists) {
    if (sameTagList(ot, tags)) continue;
    pinned = clearPresetTags(lex, ot, pinned);
  }
  return applyPresetTags(lex, tags, pinned);
}

/** Persisted ownership for the last named preset. Missing legacy state is deliberately not inferred. */
export function sanitizePresetOwned(raw, lex) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id.trim()) return null;
  if (!Array.isArray(raw.tags)) return null;
  const tags = [...new Set(knownTags(lex, raw.tags))];
  return tags.length ? { id: raw.id.trim(), tags } : null;
}

/** Keep ownership aligned after the user removes or bans one of the preset-added tags. */
export function prunePresetOwned(raw, pinned, lex) {
  const owned = sanitizePresetOwned(raw, lex);
  if (!owned) return null;
  const tags = owned.tags.filter((tag) => pinned.has(tag));
  return tags.length ? { id: owned.id, tags } : null;
}

/**
 * Toggle one named preset without guessing which pre-existing pins belong to it.
 * Only the exact tags introduced by this helper are later eligible for removal.
 */
export function toggleNamedPreset(lex, preset, existing = new Set(), rawOwned = null) {
  if (!preset || typeof preset.id !== "string" || !Array.isArray(preset.tags)) {
    return { pinned: new Set(existing), presetOwned: prunePresetOwned(rawOwned, existing, lex), action: "noop" };
  }
  const id = preset.id;
  const owned = prunePresetOwned(rawOwned, existing, lex);
  const state = presetState(lex, preset.tags, existing, preset.core);

  if (state === "on") {
    // A legacy/manual full kit has no provable ownership. Preserve it rather than deleting user data.
    if (!owned || owned.id !== id) {
      return { pinned: new Set(existing), presetOwned: owned, action: "protected" };
    }
    const drop = new Set(owned.tags);
    return {
      pinned: new Set([...existing].filter((tag) => !drop.has(tag))),
      presetOwned: null,
      action: "removed",
    };
  }

  let base = new Set(existing);
  let keptOwned = [];
  if (owned && owned.id === id) {
    keptOwned = owned.tags.filter((tag) => base.has(tag));
  } else if (owned) {
    const drop = new Set(owned.tags);
    base = new Set([...base].filter((tag) => !drop.has(tag)));
  }

  const pinned = applyPresetTags(lex, preset.tags, base);
  const added = [...pinned].filter((tag) => !base.has(tag));
  const tags = [...new Set([...keptOwned, ...added])].filter((tag) => pinned.has(tag));
  return {
    pinned,
    presetOwned: tags.length ? { id, tags } : null,
    action: state === "mixed" ? "completed" : "applied",
  };
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
    // 同一個概念要用同一套規則：itemFitsHeats() 把「heat 含 tease」的 tag 視為
    // 活動尺度也能用，這裡不能改拿原始陣列硬比，否則詞庫裡 987 個 tease/flash/sex
    // 的 tag 只要被釘到一個，「活動」就永遠選不到。
    const fits = (h) => fromPins.includes(h) || (h === "activity" && fromPins.includes("tease"));
    const hit = allowed.filter(fits);
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

function makeCommit(lex, used, mutexTaken, banned, era, allowDep) {
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
    // Validate dependencies in the context they will actually enter. A nurse makes nurse cap valid,
    // a doctor makes stethoscope valid, etc.; validating the dependent before its source existed made
    // every such source structurally unreachable. This temporary source is always rolled back before
    // the real atomic occupy pass below.
    used.add(tag);
    try {
      for (const d of deps) {
        if (used.has(d) || !depAllowed(lex, d, era)) continue;
        if (banned.has(d)) return false;
        if (mutexOccupants(lex, mutexTaken, d).some((occ) => !parentChild(lex, occ, d))) return false;
        const di = lex.byTag.get(d);
        if (di?.mutex === "body_pose") {
          for (const a of usedActs(used, lex)) {
            if (!activityFitsBody(a, new Set([d]))) return false;
          }
        }
        if (allowDep && di && di.mutex !== "held_prop" && !allowDep(di)) {
          // 上面那個暫時的 used.add(tag) 是為了讓「護士在場，聽診器才合法」成立，
          // 但父子同屬一個排他集合時會反咬自己：karaoke 和它 implies 的 singing
          // 都算忙手活動，驗 singing 的時候撞到剛放進去的 karaoke，整條 commit 被拒。
          // 所以再問一次「把父字拿掉還是不合法嗎」—— 只有跟別的東西衝突才真的拒絕。
          // 一個字不該跟它自己 implies 的字打架。
          used.delete(tag);
          const blockedByOthers = !allowDep(di);
          used.add(tag);
          if (blockedByOthers) return false;
        }
      }
    } finally {
      used.delete(tag);
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
  if (prefer && Array.isArray(prefer.softTiers) && prefer.softTiers.length) {
    const candidates = [...pool];
    const tiers = prefer.softTiers;
    const weights = prefer.weights || [];
    const weightOf = (item) => {
      const tier = tiers.findIndex((fn) => fn(item));
      const index = tier < 0 ? tiers.length : tier;
      return Math.max(0.01, Number(weights[index]) || 1);
    };
    let n = 0;
    while (n < count && candidates.length) {
      let total = 0;
      for (const item of candidates) total += weightOf(item);
      let cursor = rand() * total;
      let index = candidates.length - 1;
      for (let i = 0; i < candidates.length; i += 1) {
        cursor -= weightOf(candidates[i]);
        if (cursor <= 0) {
          index = i;
          break;
        }
      }
      const [item] = candidates.splice(index, 1);
      if (allow && !allow(item)) continue;
      if (commit(item.tag)) n += 1;
    }
    return n;
  } else if (Array.isArray(prefer) && prefer.length) {
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
  return n;
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

  if (lockScene) {
    const tags = new Set(keep.map((i) => i.tag));
    if (isBathScene(tags)) {
      keep = keep.filter((i) => pinned.has(i.tag) || !isBathBadCloth(i.tag));
    }
    if (isSwimAct(tags) || tags.has("wading") || tags.has("underwater")) {
      keep = keep.filter(
        (i) =>
          pinned.has(i.tag) ||
          !/\b(armor|suit|blazer|lab coat|hakama|necktie|boots|sneakers|high heels)\b/.test(i.tag)
      );
    }
    // 水上細節可能先靠一個 activity 通過 allow()，但該 activity 又在上面的場景
    // reconcile 被移除。用最終集合再驗一次，避免留下 splashing 卻沒有任何水源。
    const finalTags = new Set(keep.map((i) => i.tag));
    const hasWater = [...finalTags].some(
      (tag) => WATER_PLACE.has(tag) || BATH_PLACE.has(tag) || WATER_SOURCE_ACT.has(tag) || BATH_ACT.has(tag)
    );
    if (!hasWater) {
      keep = keep.filter((i) => pinned.has(i.tag) || !WATER_DETAIL.has(i.tag));
    }
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
  let allow = () => true;
  const commit = makeCommit(lex, used, mutexTaken, banned, era, (item) => allow(item));
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
  allow = (item, opts) => {
    if (banned.has(item.tag) || used.has(item.tag)) return false;
    // loincloth 是中世紀男性浴場的可辨識替代衣著，不是每張中世紀圖的制服。
    // 服裝先於自然場景抽取，故一般 fill 先略過；場景確定為浴場後的 repair 仍可選。
    // forcePin 不走 allow，因此使用者明確釘選在任何場景都會完整保留。
    if (item.tag === "loincloth" && !pinned.has(item.tag) && !isBathScene(used)) return false;
    // 同義詞只留一個。這條天生對稱 —— 不管誰先進場，後來那個都會被擋。
    if (synonymClash(item.tag, used)) return false;
    // 同一張圖不能既還沒開始又已經結束。天生對稱，誰先進場都擋得住。
    if (sexPhaseClash(item.tag, used)) return false;
    // 裸手性愛是單人 sex 場景的主要可用活動；非運動情境不要隨機抽入拳擊手套
    // 把整個 sex_act 槽堵死。使用者或拳擊 preset 明確釘選時仍完整尊重。
    if (item.tag === "boxing gloves" && heat === "sex" && !pinned.has(item.tag)) return false;
    if (NEEDS_FREE_HAND.has(item.tag) && [...used].some((tag) => HANDS_OCCUPIED.has(tag))) return false;
    if (HANDS_OCCUPIED.has(item.tag) && [...used].some((tag) => NEEDS_FREE_HAND.has(tag))) return false;
    if (!supportCandidateAllowed({
      used,
      candidate: item.tag,
      pinned,
      mode: sceneModeOf(settings),
      people,
    })) return false;
    if (!heatOk(item, heat) || !gateOk(item, female, male)) return false;
    // 必抽（opts.skipEra）只繞過時代這一關。互斥、尺度、性別、物理支撐照擋。
    if (!(opts && opts.skipEra) && !eraOk(item, era)) return false;
    if (!castOk(item, female, male, people, genderCount(used, true), genderCount(used, false))) return false;
    if (used.has("bald") && (item.mutex === "hair_color" || item.group === "hair_style" || item.group === "hair_color")) return false;
    if (item.tag === "bald" && someUsed((it) => it.group === "hair_color" || it.group === "hair_style")) return false;
    if (item.tag === "fat" && used.has("skinny")) return false;
    if (item.tag === "skinny" && used.has("fat")) return false;
    if (item.tag === "long sleeves" && used.has("short sleeves")) return false;
    if (item.tag === "short sleeves" && used.has("long sleeves")) return false;
    if (item.tag === "shota" && used.has("adult")) return false;
    if (item.tag === "adult" && used.has("shota")) return false;
    if (
      (item.mutex === "clothes_action" || item.group === "flash") &&
      actionFitsWorn(item) === 0
    ) {
      return false;
    }
    if (needsBodyClothes(item.tag) && (actionFitsWorn(item) === 0 || !wearsBodyClothes())) return false;
    if (item.tag === "mixed-sex bathing" && (!male || !female)) return false;
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
      item.mutex === "eye_color" ||
      item.group === "face" ||
      item.group === "eyes" ||
      FACE_NEED_TAGS.has(item.tag) ||
      item.tag === "glasses" ||
      item.tag === "tears" ||
      item.tag === "wink" ||
      /^looking /.test(item.tag);
    if (needsFace && [...used].some((t) => FACELESS_CAM.has(t))) return false;
    if ([...used].some((t) => FACELESS_CAM.has(t))) {
      for (const d of item.implies || []) {
        const di = lex.byTag.get(d);
        if (
          FACE_NEED_TAGS.has(d) ||
          di?.mutex === "gaze" ||
          di?.mutex === "eye_color" ||
          di?.group === "eyes" ||
          /^looking /.test(d)
        ) {
          return false;
        }
      }
    }
    if (FACELESS_CAM.has(item.tag)) {
      for (const t of used) {
        const it = lex.byTag.get(t);
        if (
          it &&
          (it.mutex === "gaze" ||
            it.mutex === "expression" ||
            it.mutex === "eye_color" ||
            it.group === "face" ||
            it.group === "eyes" ||
            FACE_NEED_TAGS.has(t) ||
            t === "glasses" ||
            t === "tears" ||
            t === "wink" ||
            t === "lipstick" ||
            /^looking /.test(t))
        ) {
          return false;
        }
      }
    }
    // 只有「嚴格白天」和「嚴格夜側」互斥，而且兩邊對稱。
    // sunset / dusk 是日夜過渡，兩側都相容，刻意不參與這條硬擋 —— 黃昏看見星星或
    // 月光本來就合理，夜市在日落時分開張也是。它們和 day / night 同屬 day_night
    // 互斥，該擋的那一半互斥系統已經擋掉了。
    if (NIGHT_MARK.has(item.tag) && [...used].some((t) => DAY_MARK.has(t))) return false;
    if (DAY_MARK.has(item.tag) && [...used].some((t) => NIGHT_MARK.has(t))) return false;
    if (heat === "flash" && item.tag === "sleeping" && !pinned.has("sleeping")) return false;
    if (used.has("sleeping") && SLEEP_BAD_POSE.has(item.tag)) return false;
    if (item.tag === "sleeping" && [...used].some((t) => SLEEP_BAD_POSE.has(t))) return false;
    if (used.has("sleeping") && SLEEP_BAD_EXPR.has(item.tag)) return false;
    if (item.tag === "sleeping") {
      if ([...used].some((t) => lex.byTag.get(t)?.mutex === "gaze" || /^looking /.test(t) || t === "kissing")) {
        return false;
      }
    }
    if (used.has("sleeping")) {
      if (item.mutex === "gaze" || /^looking /.test(item.tag) || item.tag === "kissing") return false;
      for (const d of item.implies || []) {
        if (lex.byTag.get(d)?.mutex === "gaze") return false;
      }
      if (
        item.section === "pose" &&
        !pinned.has(item.tag) &&
        item.mutex !== "camera" &&
        item.mutex !== "body_pose" &&
        item.mutex !== "expression" &&
        item.mutex !== "clothes_action" &&
        item.group !== "flash"
      ) {
        return false;
      }
    }
    if (EYE_EXTRA.has(item.tag) && [...used].some((t) => EYE_EXTRA.has(t))) return false;
    if (MOUTH_EXTRA.has(item.tag) && [...used].some((t) => MOUTH_EXTRA.has(t))) return false;
    if (used.has("sleeping") && (EYE_EXTRA.has(item.tag) || MOUTH_EXTRA.has(item.tag))) return false;
    if (used.has("closed eyes")) {
      if (EYE_EXTRA.has(item.tag) || item.mutex === "gaze" || /^looking /.test(item.tag)) return false;
      for (const d of item.implies || []) {
        if (lex.byTag.get(d)?.mutex === "gaze") return false;
      }
    }
    if (
      (used.has("closed mouth") || used.has("covering own mouth")) &&
      MOUTH_EXTRA.has(item.tag)
    ) {
      return false;
    }
    if ((item.tag === "closed mouth" || item.tag === "covering own mouth") && [...used].some((t) => MOUTH_EXTRA.has(t))) {
      return false;
    }
    if (SKY_EXTRA.has(item.tag) && [...used].some((t) => SKY_EXTRA.has(t))) return false;
    if ((item.tag === "on bed" || item.tag === "bed sheet") && usedPlaces(used, lex).size && ![...usedPlaces(used, lex)].some((p) => BED_PLACE.has(p))) {
      return false;
    }
    if (
      WATER_DETAIL.has(item.tag) &&
      ![...used].some(
        (t) => WATER_PLACE.has(t) || BATH_PLACE.has(t) || WATER_SOURCE_ACT.has(t) || BATH_ACT.has(t)
      )
    ) {
      return false;
    }
    if (used.has("indoors") && OUTDOOR_LEFTOVER.has(item.tag)) return false;
    if (used.has("outdoors") && INDOOR_PROP.has(item.tag)) return false;
    // 反向。單看這兩行擋不到東西 —— indoors／outdoors 多半是場地「暗示」進來的
    // （futon → indoors、open-air bath → outdoors）。但 commit() 現在會把暗示鏈
    // 的每一個字送進 allow()，所以這兩行是那條路徑真正的閘門：少了它們，釘一個
    // 戶外景物之後 indoors 照樣補得進來（釘 tree、seed 700005 → tree, futon, indoors）。
    if (item.tag === "indoors" && [...used].some((t) => OUTDOOR_LEFTOVER.has(t))) return false;
    if (item.tag === "outdoors" && [...used].some((t) => INDOOR_PROP.has(t))) return false;
    if (used.has("outdoors") && item.tag === "bunk bed") return false;
    if (item.tag === "outdoors" && used.has("bunk bed")) return false;
    if (
      (used.has("jogging") || used.has("skiing") || used.has("hiking")) &&
      (item.tag === "facesitting" || item.tag === "sitting")
    ) {
      return false;
    }
    if (
      (item.tag === "jogging" || item.tag === "skiing" || item.tag === "hiking") &&
      (used.has("facesitting") || used.has("sitting"))
    ) {
      return false;
    }
    if (
      item.tag === "on chair" &&
      [...used].some(
        (t) =>
          GROUND_BODY.has(t) ||
          LOCKED_SIT.has(t) ||
          LIE_BODY.has(t) ||
          t === "floating" ||
          t === "squatting" ||
          t === "kneeling" ||
          t === "on one knee" ||
          t === "driving" ||
          t === "jogging" ||
          t === "skiing" ||
          t === "hiking" ||
          t === "horseback riding" ||
          t === "standing" ||
          t === "dancing" ||
          t === "suspended congress"
      )
    ) {
      return false;
    }
    if (
      used.has("on chair") &&
      (GROUND_BODY.has(item.tag) ||
        LOCKED_SIT.has(item.tag) ||
        LIE_BODY.has(item.tag) ||
        item.tag === "floating" ||
        item.tag === "squatting" ||
        item.tag === "kneeling" ||
        item.tag === "on one knee" ||
        item.tag === "driving" ||
        item.tag === "jogging" ||
        item.tag === "skiing" ||
        item.tag === "hiking" ||
        item.tag === "horseback riding" ||
        item.tag === "standing" ||
        item.tag === "dancing" ||
        item.tag === "suspended congress")
    ) {
      return false;
    }
    if (
      item.tag === "contrapposto" &&
      [...used].some(
        (t) =>
          STILL_BODY.has(t) ||
          GROUND_BODY.has(t) ||
          LOCKED_SIT.has(t) ||
          t === "sitting" ||
          t === "squatting" ||
          t === "kneeling" ||
          t === "on one knee"
      )
    ) {
      return false;
    }
    if (
      used.has("contrapposto") &&
      item.mutex === "body_pose" &&
      item.tag !== "standing" &&
      item.tag !== "dancing"
    ) {
      return false;
    }
    if (item.tag === "legs up" && [...used].some((t) => LOCKED_SIT.has(t))) return false;
    if (LOCKED_SIT.has(item.tag) && used.has("legs up")) return false;
    if (item.tag === "spread legs" && [...used].some((t) => LOCKED_SIT.has(t))) return false;
    if (LOCKED_SIT.has(item.tag) && used.has("spread legs")) return false;
    {
      const legClashBody = (t) =>
        GROUND_BODY.has(t) ||
        LOCKED_SIT.has(t) ||
        t === "kneeling" ||
        t === "on one knee" ||
        t === "squatting" ||
        t === "dancing";
      if (LEG_EXTRA.has(item.tag) && [...used].some(legClashBody)) return false;
      if (legClashBody(item.tag) && [...used].some((t) => LEG_EXTRA.has(t))) return false;
      if ((item.tag === "legs up" || item.tag === "m legs") && used.has("standing")) return false;
      if (item.tag === "standing" && (used.has("legs up") || used.has("m legs"))) return false;
    }
    if (LEAN_POSE.has(item.tag) && [...used].some((t) => LIE_BODY.has(t))) return false;
    if (LIE_BODY.has(item.tag) && [...used].some((t) => LEAN_POSE.has(t))) return false;
    if (item.tag === "leaning back" && [...used].some((t) => GROUND_BODY.has(t))) return false;
    if (GROUND_BODY.has(item.tag) && used.has("leaning back")) return false;
    if (item.tag === "bent over" && [...used].some((t) => LIE_BODY.has(t))) return false;
    if (LIE_BODY.has(item.tag) && used.has("bent over")) return false;
    if (item.tag === "m legs" && (used.has("on stomach") || used.has("on side"))) return false;
    if (item.tag === "crossed legs" && used.has("on stomach")) return false;
    if (item.tag === "on stomach" && used.has("crossed legs")) return false;
    if ((item.tag === "on stomach" || item.tag === "on side") && used.has("m legs")) return false;
    if (
      (item.tag === "breasts on table" || item.tag === "breasts on glass") &&
      [...used].some((t) => LIE_BODY.has(t) || GROUND_BODY.has(t))
    ) {
      return false;
    }
    if (
      (LIE_BODY.has(item.tag) || GROUND_BODY.has(item.tag)) &&
      (used.has("breasts on table") || used.has("breasts on glass"))
    ) {
      return false;
    }
    if (item.tag === "hand in pocket" && (used.has("nude") || used.has("completely nude"))) return false;
    if ((item.tag === "nude" || item.tag === "completely nude") && used.has("hand in pocket")) return false;
    if (item.tag === "hand in pocket" && [...used].some((t) => /\b(bikini|swimsuit)\b/.test(t))) return false;
    if (/\b(bikini|swimsuit)\b/.test(item.tag) && used.has("hand in pocket")) return false;
    if (
      BOTH_ARMS.has(item.tag) &&
      (used.has("fingering") ||
        used.has("female masturbation") ||
        used.has("masturbation") ||
        used.has("masturbation through clothes"))
    ) {
      return false;
    }
    if (
      (item.tag === "fingering" ||
        item.tag === "female masturbation" ||
        item.tag === "masturbation" ||
        item.tag === "masturbation through clothes") &&
      [...used].some((t) => BOTH_ARMS.has(t))
    ) {
      return false;
    }
    if (
      used.has("lower body") &&
      (BOTH_ARMS.has(item.tag) || HAND_GESTURE.has(item.tag) || ARM_POSE.has(item.tag) || HANDS_BUSY_ACT.has(item.tag))
    ) {
      return false;
    }
    if (
      item.tag === "lower body" &&
      [...used].some((t) => BOTH_ARMS.has(t) || HAND_GESTURE.has(t) || ARM_POSE.has(t) || HANDS_BUSY_ACT.has(t))
    ) {
      return false;
    }
    if (item.tag === "playing guitar" && used.has("on stomach")) return false;
    if (item.tag === "on stomach" && used.has("playing guitar")) return false;
    if (item.tag === "washing another's back" && used.has("on stomach")) return false;
    if (item.tag === "on stomach" && used.has("washing another's back")) return false;
    if (
      (item.tag === "breasts on table" || item.tag === "breasts on glass") &&
      (used.has("dancing") ||
        used.has("diving") ||
        used.has("suspended congress") ||
        [...used].some((t) => WATER_ACT.has(t) || t === "wading"))
    ) {
      return false;
    }
    if (
      (item.tag === "dancing" ||
        item.tag === "diving" ||
        item.tag === "suspended congress" ||
        WATER_ACT.has(item.tag) ||
        item.tag === "wading") &&
      (used.has("breasts on table") || used.has("breasts on glass"))
    ) {
      return false;
    }
    if (item.tag === "amazon position" && used.has("top-down bottom-up")) return false;
    if (item.tag === "top-down bottom-up" && used.has("amazon position")) return false;
    if (item.tag === "sitting" && used.has("floating")) return false;
    if (item.tag === "floating" && used.has("sitting")) return false;
    if (
      item.tag === "floating" &&
      (used.has("against glass") || used.has("against window") || used.has("against wall"))
    ) {
      return false;
    }
    if (
      (item.tag === "against glass" || item.tag === "against window" || item.tag === "against wall") &&
      used.has("floating")
    ) {
      return false;
    }
    if (item.tag === "horseback riding" && used.has("legs up")) return false;
    if (item.tag === "legs up" && used.has("horseback riding")) return false;
    if (item.tag === "hanging breasts" && [...used].some((t) => LIE_BODY.has(t) || t === "on stomach")) return false;
    if ((LIE_BODY.has(item.tag) || item.tag === "on stomach") && used.has("hanging breasts")) return false;
    if (item.tag === "amazon position" && [...used].some((t) => LIE_BODY.has(t) || t === "on side" || t === "on stomach")) {
      return false;
    }
    if ((LIE_BODY.has(item.tag) || item.tag === "on side" || item.tag === "on stomach") && used.has("amazon position")) {
      return false;
    }
    if (item.tag === "driving" && [...used].some((t) => BOTH_ARMS.has(t))) return false;
    if (BOTH_ARMS.has(item.tag) && used.has("driving")) return false;
    if (item.tag === "cooking" && used.has("sitting")) return false;
    if (item.tag === "sitting" && used.has("cooking")) return false;
    if (
      (item.tag === "sitting on lap" || item.tag === "straddling") &&
      (used.has("cooking") || used.has("cleaning") || used.has("riding bicycle"))
    ) {
      return false;
    }
    if (
      (item.tag === "cooking" || item.tag === "cleaning" || item.tag === "riding bicycle") &&
      (used.has("sitting on lap") || used.has("straddling"))
    ) {
      return false;
    }
    if (item.tag === "cooking" && used.has("on chair")) return false;
    if (item.tag === "on chair" && used.has("cooking")) return false;
    if (item.tag === "carrying" && used.has("on one knee")) return false;
    if (item.tag === "on one knee" && used.has("carrying")) return false;
    if (item.tag === "carrying" && (used.has("squatting") || used.has("kneeling"))) return false;
    if ((item.tag === "squatting" || item.tag === "kneeling") && used.has("carrying")) return false;
    if (item.tag === "on back" && (used.has("against wall") || used.has("against window") || used.has("against glass"))) {
      return false;
    }
    if (
      (item.tag === "against wall" || item.tag === "against window" || item.tag === "against glass") &&
      used.has("on back")
    ) {
      return false;
    }
    if (item.tag === "hard hat" && used.has("helmet")) return false;
    if (item.tag === "helmet" && used.has("hard hat")) return false;
    if (item.tag === "panties aside" && used.has("masturbation through clothes")) return false;
    if (item.tag === "masturbation through clothes" && used.has("panties aside")) return false;
    if (item.tag === "leaning back" && used.has("breasts on glass")) return false;
    if (item.tag === "breasts on glass" && used.has("leaning back")) return false;
    if (MOVE_ACT.has(item.tag) && used.has("ojou-sama pose")) return false;
    if (item.tag === "ojou-sama pose" && [...used].some((t) => MOVE_ACT.has(t))) return false;
    if (MOVE_ACT.has(item.tag) && used.has("spread legs")) return false;
    if (item.tag === "spread legs" && [...used].some((t) => MOVE_ACT.has(t))) return false;
    if (item.tag === "hat" && [...used].some((t) => FACELESS_CAM.has(t))) return false;
    if (
      (item.tag === "necktie" || item.tag === "bowtie") &&
      [...used].some((t) => WATER_ACT.has(t) && t !== "fishing")
    ) {
      return false;
    }
    if (
      WATER_ACT.has(item.tag) &&
      item.tag !== "fishing" &&
      (used.has("necktie") ||
        used.has("bowtie") ||
        used.has("boots") ||
        used.has("sneakers") ||
        used.has("high heels"))
    ) {
      return false;
    }
    if (
      (item.tag === "boots" || item.tag === "sneakers") &&
      [...used].some((t) => WATER_ACT.has(t) && t !== "fishing")
    ) {
      return false;
    }
    if (item.tag === "on stomach" && (used.has("against window") || used.has("against glass") || used.has("against wall"))) {
      return false;
    }
    if (
      (item.tag === "against window" || item.tag === "against glass" || item.tag === "against wall") &&
      used.has("on stomach")
    ) {
      return false;
    }
    if (item.tag === "carrying" && used.has("sitting on lap")) return false;
    if (item.tag === "sitting on lap" && used.has("carrying")) return false;
    if (item.tag === "singing" && used.has("on stomach")) return false;
    if (item.tag === "on stomach" && used.has("singing")) return false;
    if (item.tag === "amazon position" && used.has("all fours")) return false;
    if (item.tag === "all fours" && used.has("amazon position")) return false;
    if (item.tag === "hanging breasts" && used.has("sleeping")) return false;
    if (item.tag === "sleeping" && used.has("hanging breasts")) return false;
    if (item.tag === "hanging breasts" && used.has("flat chest")) return false;
    if (item.tag === "flat chest" && used.has("hanging breasts")) return false;
    if (item.tag === "dancing" && [...used].some((t) => HANDS_BUSY_ACT.has(t))) return false;
    if (HANDS_BUSY_ACT.has(item.tag) && used.has("dancing")) return false;
    if (
      (item.tag === "masturbation" || item.tag === "female masturbation" || item.tag === "male masturbation") &&
      [...used].some((t) => HANDS_BUSY_ACT.has(t))
    ) {
      return false;
    }
    if (
      HANDS_BUSY_ACT.has(item.tag) &&
      (used.has("masturbation") || used.has("female masturbation") || used.has("male masturbation"))
    ) {
      return false;
    }
    if (
      (item.tag === "riding bicycle" || item.tag === "driving") &&
      [...usedPlaces(used, lex)].some((p) => INDOOR_ROOM.has(p) && p !== "car interior")
    ) {
      return false;
    }
    if (
      (item.mutex === "place" || item.group === "place") &&
      INDOOR_ROOM.has(item.tag) &&
      item.tag !== "car interior" &&
      (used.has("riding bicycle") || used.has("driving")) &&
      !pinned.has(item.tag)
    ) {
      return false;
    }
    if (item.tag === "diving" && used.has("washing hair")) return false;
    if (item.tag === "washing hair" && used.has("diving")) return false;
    if (item.tag === "singing" && used.has("all fours")) return false;
    if (item.tag === "all fours" && used.has("singing")) return false;
    if (item.tag === "school uniform" && used.has("gym uniform")) return false;
    if (item.tag === "gym uniform" && used.has("school uniform")) return false;
    if (item.tag === "school uniform" && used.has("cheerleader")) return false;
    if (item.tag === "cheerleader" && used.has("school uniform")) return false;
    if (item.tag === "lying" && (used.has("against window") || used.has("against glass") || used.has("against wall"))) {
      return false;
    }
    if (
      (item.tag === "against window" || item.tag === "against glass" || item.tag === "against wall") &&
      used.has("lying")
    ) {
      return false;
    }
    if (item.tag === "eating" && used.has("on back")) return false;
    if (item.tag === "on back" && used.has("eating")) return false;
    if (item.tag === "closed eyes" && used.has("reading")) return false;
    if (item.tag === "reading" && used.has("closed eyes")) return false;
    if (MOVE_ACT.has(item.tag) && used.has("hand on own crotch")) return false;
    if (item.tag === "hand on own crotch" && [...used].some((t) => MOVE_ACT.has(t))) return false;
    if (item.tag === "sweater pull" && [...used].some((t) => HANDS_BUSY_ACT.has(t))) return false;
    if (HANDS_BUSY_ACT.has(item.tag) && used.has("sweater pull")) return false;
    if (item.tag === "masturbation through clothes" && [...used].some((t) => MOVE_ACT.has(t))) return false;
    if (MOVE_ACT.has(item.tag) && used.has("masturbation through clothes")) return false;
    if (
      ((WATER_ACT.has(item.tag) && item.tag !== "fishing") || used.has("pool") || used.has("ocean")) &&
      item.tag === "high heels"
    ) {
      return false;
    }
    if (item.tag === "high heels" && [...used].some((t) => WATER_ACT.has(t) && t !== "fishing")) return false;
    if (item.tag === "showering" && [...used].some((t) => LIE_BODY.has(t))) return false;
    if (LIE_BODY.has(item.tag) && used.has("showering")) return false;
    if (item.tag === "riding bicycle" && used.has("on chair")) return false;
    if (item.tag === "on chair" && used.has("riding bicycle")) return false;
    if (item.tag === "candlelight" && (used.has("underwater") || used.has("swimming") || used.has("diving"))) return false;
    if ((item.tag === "underwater" || item.tag === "swimming" || item.tag === "diving") && used.has("candlelight")) {
      return false;
    }
    // 同理的反向：靠窗／靠玻璃先進場，outdoors 就不能再從暗示鏈補進來。
    if (
      item.tag === "outdoors" &&
      !used.has("indoors") &&
      (used.has("against window") || used.has("against glass"))
    ) {
      return false;
    }
    if ((item.tag === "against window" || item.tag === "against glass") && used.has("outdoors") && !used.has("indoors")) {
      return false;
    }
    if (item.tag === "restrained" && (used.has("fingering") || used.has("female masturbation") || used.has("masturbation"))) {
      return false;
    }
    if ((item.tag === "fingering" || item.tag === "female masturbation" || item.tag === "masturbation") && used.has("restrained")) {
      return false;
    }
    if (item.tag === "come hither" && [...used].some((t) => HANDS_BUSY_ACT.has(t))) return false;
    if (HANDS_BUSY_ACT.has(item.tag) && used.has("come hither")) return false;
    if (item.tag === "breasts on table" && used.has("leaning back")) return false;
    if (item.tag === "leaning back" && used.has("breasts on table")) return false;
    if (
      (item.tag === "breasts on table" || item.tag === "breasts on glass") &&
      used.has("outdoors") &&
      !used.has("indoors")
    ) {
      return false;
    }
    if (
      item.tag === "outdoors" &&
      (used.has("breasts on table") || used.has("breasts on glass")) &&
      !used.has("indoors")
    ) {
      return false;
    }
    if (
      (used.has("breasts on table") || used.has("breasts on glass")) &&
      (item.implies || []).includes("outdoors")
    ) {
      return false;
    }
    if (
      (item.tag === "breasts on table" || item.tag === "breasts on glass") &&
      [...used].some((t) => (lex.byTag.get(t)?.implies || []).includes("outdoors"))
    ) {
      return false;
    }
    if (item.tag === "hand in panties" && [...used].some((t) => MOVE_ACT.has(t))) return false;
    if (MOVE_ACT.has(item.tag) && used.has("hand in panties")) return false;
    if (
      item.tag === "floating" &&
      (used.has("leaning forward") || used.has("leaning back") || used.has("contrapposto") || used.has("crossed legs"))
    ) {
      return false;
    }
    if (
      (item.tag === "leaning forward" ||
        item.tag === "leaning back" ||
        item.tag === "contrapposto" ||
        item.tag === "crossed legs") &&
      used.has("floating")
    ) {
      return false;
    }
    if (BOTH_ARMS.has(item.tag) && [...used].some((t) => MOVE_ACT.has(t))) return false;
    if (MOVE_ACT.has(item.tag) && [...used].some((t) => BOTH_ARMS.has(t))) return false;
    if (item.tag === "amazon position" && (used.has("crawling") || used.has("seiza") || used.has("wariza"))) return false;
    if ((item.tag === "crawling" || item.tag === "seiza" || item.tag === "wariza") && used.has("amazon position")) {
      return false;
    }
    if (item.tag === "crossed legs" && (used.has("horseback riding") || [...used].some((t) => MOVE_ACT.has(t)))) {
      return false;
    }
    if ((item.tag === "horseback riding" || MOVE_ACT.has(item.tag)) && used.has("crossed legs")) return false;
    {
      const plantedTease = (t) =>
        t === "against window" ||
        t === "against glass" ||
        t === "against wall" ||
        t === "contrapposto" ||
        t === "leaning back" ||
        t === "leaning forward" ||
        t === "arched back";
      if (plantedTease(item.tag) && [...used].some((t) => MOVE_ACT.has(t))) return false;
      if (MOVE_ACT.has(item.tag) && [...used].some(plantedTease)) return false;
    }
    if (item.tag === "microphone" && !used.has("singing") && !used.has("karaoke")) return false;
    if (
      item.tag === "bunk bed" &&
      ![...used].some((t) => t === "bedroom" || t === "dormitory" || t === "hotel room" || t === "kids room")
    ) {
      return false;
    }
    {
      const shortHair = (t) =>
        t === "pixie cut" || t === "short hair" || t === "very short hair" || t === "bob cut";
      const longStyle = (t) =>
        t === "twintails" ||
        t === "high ponytail" ||
        t === "ponytail" ||
        t === "side ponytail" ||
        t === "drill hair" ||
        t === "twin braids" ||
        t === "braid" ||
        t === "hime cut" ||
        t === "hair over shoulder" ||
        t === "hair bun" ||
        t === "single hair bun" ||
        t === "double bun";
      if (shortHair(item.tag) && [...used].some(longStyle)) return false;
      if (longStyle(item.tag) && [...used].some(shortHair)) return false;
    }
    if (item.tag === "legs up" && used.has("driving")) return false;
    if (item.tag === "driving" && used.has("legs up")) return false;
    {
      const waterPlantAct = (t) => t === "swimming" || t === "diving";
      const waterPlantBody = (t) =>
        t === "standing" ||
        t === "squatting" ||
        t === "kneeling" ||
        t === "on one knee" ||
        t === "standing sex" ||
        t === "contrapposto";
      if (waterPlantBody(item.tag) && [...used].some(waterPlantAct)) return false;
      if (waterPlantAct(item.tag) && [...used].some(waterPlantBody)) return false;
    }
    if (item.mutex === "held_prop") {
      const acts = usedActs(used, lex);
      if (![...acts].some((a) => (ACT_PROP[a] || []).includes(item.tag))) return false;
    }
    if (item.tag === "beach umbrella" && ![...used].some((t) => t === "beach" || t === "poolside" || t === "ocean")) {
      return false;
    }
    if (item.tag === "innertube" && ![...used].some((t) => WATER_PLACE.has(t) || WATER_ACT.has(t) || BATH_PLACE.has(t))) {
      return false;
    }
    if (item.tag === "stethoscope" && ![...used].some((t) => t === "nurse" || t === "doctor" || t === "clinic" || t === "hospital")) {
      return false;
    }
    if (item.tag === "hard hat" && ![...used].some((t) => t === "construction worker" || t === "construction site")) {
      return false;
    }
    if (item.tag === "lab coat" && ![...used].some((t) => t === "scientist" || t === "laboratory" || t === "doctor")) {
      return false;
    }
    if (item.tag === "police hat" && !used.has("policewoman") && !used.has("police uniform")) return false;
    if (item.tag === "nurse cap" && !used.has("nurse")) return false;
    if (
      item.tag === "helmet" &&
      !used.has("riding bicycle") &&
      !used.has("construction worker") &&
      !used.has("construction site") &&
      !used.has("skiing")
    ) {
      return false;
    }
    if (item.tag === "tsurime" && used.has("tareme")) return false;
    if (item.tag === "tareme" && used.has("tsurime")) return false;
    if (
      item.tag === "closed eyes" &&
      (used.has("playing video games") ||
        used.has("playing games") ||
        used.has("painting (action)") ||
        used.has("writing") ||
        used.has("drawing (action)") ||
        used.has("studying"))
    ) {
      return false;
    }
    if (
      (item.tag === "playing video games" ||
        item.tag === "playing games" ||
        item.tag === "painting (action)" ||
        item.tag === "writing" ||
        item.tag === "drawing (action)" ||
        item.tag === "studying") &&
      used.has("closed eyes")
    ) {
      return false;
    }
    if (item.tag === "umbrella" && !used.has("rain") && !used.has("overcast")) return false;
    if (item.tag === "parasol" && !used.has("beach") && !used.has("garden") && !used.has("park") && !used.has("poolside")) {
      return false;
    }
    if (item.tag === "wading" && (used.has("legs up") || used.has("m legs"))) return false;
    if ((item.tag === "legs up" || item.tag === "m legs") && used.has("wading")) return false;
    if (
      (item.tag === "swimming" || item.tag === "diving") &&
      (used.has("legs up") || used.has("m legs") || used.has("leg lift") || used.has("one knee up") || used.has("on chair"))
    ) {
      return false;
    }
    if (
      (item.tag === "legs up" ||
        item.tag === "m legs" ||
        item.tag === "leg lift" ||
        item.tag === "one knee up" ||
        item.tag === "on chair") &&
      (used.has("swimming") || used.has("diving"))
    ) {
      return false;
    }
    if (item.tag === "footjob" && used.has("feet out of frame")) return false;
    if (item.tag === "feet out of frame" && used.has("footjob")) return false;
    if (item.tag === "footjob" && used.has("upper body")) return false;
    if (item.tag === "upper body" && used.has("footjob")) return false;
    if (item.tag === "pussy focus" && used.has("upper body")) return false;
    if (item.tag === "upper body" && used.has("pussy focus")) return false;
    if (item.tag === "wading" && used.has("on chair")) return false;
    if (item.tag === "on chair" && used.has("wading")) return false;
    if (item.tag === "facesitting" && used.has("on chair")) return false;
    if (item.tag === "on chair" && used.has("facesitting")) return false;
    if (item.tag === "bald" && used.has("wet hair")) return false;
    if (item.tag === "wet hair" && used.has("bald")) return false;
    if (item.tag === "cooking" && used.has("squatting")) return false;
    if (item.tag === "squatting" && used.has("cooking")) return false;
    if (item.tag === "cleaning" && used.has("sitting")) return false;
    if (item.tag === "sitting" && used.has("cleaning")) return false;
    if (item.tag === "hanging breasts" && used.has("leaning back")) return false;
    if (item.tag === "leaning back" && used.has("hanging breasts")) return false;
    if (item.tag === "selfie" && [...used].some((t) => BOTH_ARMS.has(t))) return false;
    if (BOTH_ARMS.has(item.tag) && used.has("selfie")) return false;
    if (item.tag === "lipstick" && [...used].some((t) => FACELESS_CAM.has(t))) return false;
    if (item.tag === "sunbathing" && used.has("rain")) return false;
    if (item.tag === "rain" && used.has("sunbathing")) return false;
    if (item.tag === "facing away" && (used.has("wink") || used.has("selfie") || used.has("looking at viewer"))) return false;
    if ((item.tag === "wink" || item.tag === "selfie" || item.tag === "looking at viewer") && used.has("facing away")) {
      return false;
    }
    if (item.tag === "breasts squeezed together" && used.has("breasts apart")) return false;
    if (item.tag === "breasts apart" && used.has("breasts squeezed together")) return false;
    if (item.tag === "horseback riding" && used.has("m legs")) return false;
    if (item.tag === "m legs" && used.has("horseback riding")) return false;
    if (item.tag === "cooking" && used.has("kneeling")) return false;
    if (item.tag === "kneeling" && used.has("cooking")) return false;
    if (item.tag === "cooking" && used.has("on one knee")) return false;
    if (item.tag === "on one knee" && used.has("cooking")) return false;
    if (item.tag === "closed eyes" && (used.has("taking picture") || used.has("selfie"))) return false;
    if ((item.tag === "taking picture" || item.tag === "selfie") && used.has("closed eyes")) return false;
    if (item.tag === "amazon position" && used.has("standing")) return false;
    if (item.tag === "standing" && used.has("amazon position")) return false;
    if (MOVE_ACT.has(item.tag) && (used.has("legs up") || used.has("leg lift"))) return false;
    if ((item.tag === "legs up" || item.tag === "leg lift") && [...used].some((t) => MOVE_ACT.has(t))) return false;
    if (item.tag === "horseback riding" && used.has("on one knee")) return false;
    if (item.tag === "on one knee" && used.has("horseback riding")) return false;
    if (item.tag === "singing" && used.has("paizuri gesture")) return false;
    if (item.tag === "paizuri gesture" && used.has("singing")) return false;
    if (item.tag === "skiing" && used.has("looking at mirror")) return false;
    if (item.tag === "looking at mirror" && used.has("skiing")) return false;
    if (item.tag === "breasts on table" && (used.has("bathtub") || used.has("beach") || used.has("ocean") || used.has("pool"))) {
      return false;
    }
    if (
      item.tag === "driving" &&
      (used.has("breasts on table") ||
        used.has("breasts on glass") ||
        used.has("against wall") ||
        used.has("against window") ||
        used.has("against glass"))
    ) {
      return false;
    }
    if (
      (item.tag === "breasts on table" ||
        item.tag === "breasts on glass" ||
        item.tag === "against wall" ||
        item.tag === "against window" ||
        item.tag === "against glass") &&
      used.has("driving")
    ) {
      return false;
    }
    if (item.tag === "carrying" && used.has("sitting")) return false;
    if (item.tag === "sitting" && used.has("carrying")) return false;
    if (item.tag === "indian style" && used.has("amazon position")) return false;
    if (item.tag === "amazon position" && used.has("indian style")) return false;
    if (
      (item.tag === "breasts on table" || item.tag === "breasts on glass") &&
      ([...used].some((t) => MOVE_ACT.has(t)) || used.has("horseback riding"))
    ) {
      return false;
    }
    if (
      (MOVE_ACT.has(item.tag) || item.tag === "horseback riding") &&
      (used.has("breasts on table") || used.has("breasts on glass"))
    ) {
      return false;
    }
    if ((item.tag === "yoga" || item.tag === "stretching") && [...used].some((t) => STILL_BODY.has(t))) return false;
    if (STILL_BODY.has(item.tag) && (used.has("yoga") || used.has("stretching"))) return false;
    if (item.mutex === "sex_act" || item.group === "sex") {
      const acts = usedActs(used, lex);
      if ([...acts].some((a) => MOVE_ACT.has(a) && !SEX_OK_ACTIVITY.has(a))) return false;
    }
    if (MOVE_ACT.has(item.tag) && !SEX_OK_ACTIVITY.has(item.tag)) {
      if ([...used].some((t) => lex.byTag.get(t)?.mutex === "sex_act" || lex.byTag.get(t)?.group === "sex")) {
        return false;
      }
    }
    if (used.has("closed eyes") && item.tag === "glowing eyes") return false;
    if (item.tag === "closed eyes" && used.has("glowing eyes")) return false;
    if (
      item.tag === "after bathing" &&
      [...used].some(
        (t) =>
          BATH_ACT.has(t) ||
          (WATER_ACT.has(t) && t !== "fishing") ||
          t === "washing body" ||
          t === "washing hair" ||
          t === "splashing" ||
          t === "partially submerged"
      )
    ) {
      return false;
    }
    if (
      used.has("after bathing") &&
      (BATH_ACT.has(item.tag) ||
        (WATER_ACT.has(item.tag) && item.tag !== "fishing") ||
        item.tag === "washing body" ||
        item.tag === "washing hair" ||
        item.tag === "splashing" ||
        item.tag === "partially submerged")
    ) {
      return false;
    }
    if (
      item.tag === "overcast" &&
      (used.has("blue sky") || used.has("starry sky") || used.has("orange sky") || used.has("sunlight"))
    ) {
      return false;
    }
    if (
      (item.tag === "blue sky" || item.tag === "starry sky" || item.tag === "orange sky" || item.tag === "sunlight") &&
      used.has("overcast")
    ) {
      return false;
    }
    if (item.tag === "rain" && used.has("starry sky")) return false;
    if (item.tag === "starry sky" && used.has("rain")) return false;
    if (item.tag === "lower body" && [...used].some((t) => CHEST_NEED_TAGS.has(t))) return false;
    if (CHEST_NEED_TAGS.has(item.tag) && used.has("lower body")) return false;
    if (
      used.has("expressionless") &&
      (item.tag === "wink" || EYE_EXTRA.has(item.tag) || item.tag === "clenched teeth" || item.tag === "fucked silly")
    ) {
      return false;
    }
    if (
      item.tag === "expressionless" &&
      (used.has("wink") ||
        used.has("clenched teeth") ||
        used.has("fucked silly") ||
        [...used].some((t) => EYE_EXTRA.has(t)))
    ) {
      return false;
    }
    if (
      used.has("expressionless") &&
      (item.tag === "licking lips" || item.tag === "tongue out" || item.tag === "biting own lip")
    ) {
      return false;
    }
    if (
      item.tag === "expressionless" &&
      (used.has("licking lips") || used.has("tongue out") || used.has("biting own lip"))
    ) {
      return false;
    }
    if (
      used.has("closed eyes") &&
      (item.tag === "reading" ||
        item.tag === "studying" ||
        item.tag === "taking picture" ||
        item.tag === "writing" ||
        item.tag === "drawing (action)" ||
        item.tag === "playing games" ||
        item.tag === "playing video games" ||
        item.tag === "painting (action)")
    ) {
      return false;
    }
    if (
      (item.tag === "reading" ||
        item.tag === "studying" ||
        item.tag === "taking picture" ||
        item.tag === "writing" ||
        item.tag === "drawing (action)" ||
        item.tag === "playing games" ||
        item.tag === "playing video games" ||
        item.tag === "painting (action)") &&
      used.has("closed eyes")
    ) {
      return false;
    }
    if (item.tag === "clenched teeth" || item.tag === "biting own lip" || item.tag === "licking lips") {
      const acts = usedActs(used, lex);
      if (
        acts.has("eating") ||
        acts.has("singing") ||
        acts.has("karaoke") ||
        acts.has("drinking") ||
        acts.has("talking on phone") ||
        acts.has("smoking")
      ) {
        return false;
      }
    }
    if (
      (item.tag === "eating" ||
        item.tag === "singing" ||
        item.tag === "karaoke" ||
        item.tag === "drinking" ||
        item.tag === "talking on phone" ||
        item.tag === "smoking") &&
      (used.has("clenched teeth") || used.has("biting own lip") || used.has("licking lips"))
    ) {
      return false;
    }
    {
      const handsBusy = [...used].some((t) => HANDS_BUSY_ACT.has(t) || HANDS_BUSY_BODY.has(t));
      if (ARM_POSE.has(item.tag) && !pinned.has(item.tag) && handsBusy) return false;
      if (BOTH_ARMS.has(item.tag) && !pinned.has(item.tag) && handsBusy) return false;
      if (HANDS_BUSY_ACT.has(item.tag) && [...used].some((t) => BOTH_ARMS.has(t))) return false;
      if (ARM_POSE.has(item.tag) && [...used].some((t) => BOTH_ARMS.has(t)) && !BOTH_ARMS.has(item.tag)) return false;
      if (BOTH_ARMS.has(item.tag) && [...used].some((t) => ARM_POSE.has(t) && !BOTH_ARMS.has(t))) return false;
      if (HAND_GESTURE.has(item.tag) && !pinned.has(item.tag) && handsBusy) return false;
      if (HANDS_BUSY_ACT.has(item.tag) && [...used].some((t) => ARM_POSE.has(t))) return false;
      if (HANDS_BUSY_ACT.has(item.tag) && [...used].some((t) => HAND_GESTURE.has(t))) return false;
      if (HANDS_BUSY_BODY.has(item.tag) && [...used].some((t) => ARM_POSE.has(t))) return false;
      if (HANDS_BUSY_ACT.has(item.tag) && [...used].some((t) => HANDS_BUSY_BODY.has(t))) return false;
      if (HANDS_BUSY_ACT.has(item.tag) && [...used].some((t) => HANDS_BUSY_ACT.has(t))) return false;
      if (HANDS_BUSY_BODY.has(item.tag) && [...usedActs(used, lex)].some((a) => HANDS_BUSY_ACT.has(a))) return false;
      if (HAND_GESTURE.has(item.tag) && [...used].some((t) => BOTH_ARMS.has(t) || HANDS_BUSY_BODY.has(t))) return false;
      {
        const BOOK_ACT = new Set(["reading", "studying"]);
        if (BOOK_ACT.has(item.tag) && [...used].some((t) => BOTH_ARMS.has(t) || HAND_GESTURE.has(t))) return false;
        if ((BOTH_ARMS.has(item.tag) || HAND_GESTURE.has(item.tag)) && [...used].some((t) => BOOK_ACT.has(t))) {
          return false;
        }
      }
      if (
        (BOTH_ARMS.has(item.tag) || HANDS_BUSY_BODY.has(item.tag)) &&
        [...used].some((t) => HAND_GESTURE.has(t))
      ) {
        return false;
      }
    }
    {
      const DRY_NO_WATER = new Set([
        "airplane interior",
        "cockpit",
        "movie theater",
        "church",
        "classroom",
        "office",
        "library",
        "living room",
        "bedroom",
        "hotel room",
        "basketball court",
        "tennis court",
        "soccer field",
        "baseball stadium",
        "bowling alley",
        "boxing ring",
        "dojo",
        "fitness gym",
        "school gym",
        "running track",
        "bathroom",
        "prison",
        "colonnade",
        "train interior",
        "hallway",
        "elevator",
      ]);
      const places = usedPlaces(used, lex);
      const acts = usedActs(used, lex);
      if (WATER_ACT.has(item.tag) && [...places].some((p) => DRY_NO_WATER.has(p))) return false;
      if (DRY_NO_WATER.has(item.tag) && [...acts].some((a) => WATER_ACT.has(a)) && !pinned.has(item.tag)) {
        return false;
      }
      if (item.tag === "horseback riding" && [...places].some((p) => DRY_NO_WATER.has(p) || p === "movie theater")) {
        return false;
      }
      if (
        (item.mutex === "place" || item.group === "place") &&
        (DRY_NO_WATER.has(item.tag) || item.tag === "movie theater") &&
        used.has("horseback riding") &&
        !pinned.has(item.tag)
      ) {
        return false;
      }
    }
    if (lockSceneOn(settings) && !sportKitOk(item, used)) return false;
    if (lockSceneOn(settings) && !sportPlaceOk(item, used)) return false;
    if (lockSceneOn(settings) && !sportGearPlaceOk(item, used, lex)) return false;
    if (
      lockSceneOn(settings) &&
      (item.mutex === "sport_ball" || item.mutex === "sport_prop") &&
      sportIdsOf(used) === null
    ) {
      return false;
    }
    if (realisticOn(settings)) {
      if (item.tag === "rape" && [...used].some((t) => RAPE_BAD_PLACE.has(t))) return false;
      if (RAPE_BAD_PLACE.has(item.tag) && used.has("rape")) return false;
    }
    if (lockSceneOn(settings)) {
      const acts = usedActs(used, lex);
      const places = usedPlaces(used, lex);
      const real = realisticOn(settings);
      if ((item.mutex === "place" || item.group === "place") && !placeFitsActs(item.tag, acts, real)) return false;
      if (item.mutex === "activity" && !actFitsPlaces(item.tag, places, real)) return false;
      if (item.section === "clothing" && isBathScene(used) && isBathBadCloth(item.tag)) return false;
      {
        const kind = sceneClothLocked(used, pinned, lex, era, true);
        if (
          kind &&
          item.section === "clothing" &&
          (item.layer === "garment" || item.layer === "accessory") &&
          !garmentOkForKind(item, kind, era) &&
          !pinned.has(item.tag)
        ) {
          return false;
        }
      }
      if (
        (used.has("breasts on table") || used.has("breasts on glass")) &&
        (item.mutex === "place" || item.group === "place") &&
        !INDOOR_ROOM.has(item.tag)
      ) {
        return false;
      }
      if (used.has("outdoors") && INDOOR_PROP.has(item.tag)) return false;
      if (used.has("outdoors") && item.tag === "on bed") return false;
      if (used.has("outdoors") && item.tag === "bunk bed") return false;
      if (used.has("indoors") && item.tag === "starry sky") return false;
      if (
        INDOOR_FURN.has(item.tag) &&
        [...used].some((t) => t === "underwater" || t === "ocean" || t === "pool" || t === "car interior" || BATH_PLACE.has(t))
      ) {
        return false;
      }
    }
    if (realisticOn(settings)) {
      if (used.has("sleeping") && (item.tag === "city" || item.tag === "cityscape" || item.tag === "street")) {
        return false;
      }
      if ((item.tag === "city" || item.tag === "cityscape" || item.tag === "street") && used.has("sleeping")) {
        return false;
      }
      if (
        used.has("sleeping") &&
        (item.mutex === "place" || item.group === "place") &&
        ACT_PLACE.sleeping &&
        !ACT_PLACE.sleeping.has(item.tag)
      ) {
        return false;
      }
      if (item.mutex === "race" && !pinned.has(item.tag)) return false;
      if (item.tag === "dark-skinned male" && !pinned.has(item.tag)) return false;
      const jobs = usedJobs(used, lex);
      if ((item.mutex === "place" || item.group === "place") && !placeFitsJob(item.tag, jobs, used)) {
        return false;
      }
      if (item.mutex === "activity") {
        const jp = jobPlacesOf(jobs);
        if (jp.size && !actFitsSomePlaces(item.tag, jp, true)) return false;
        if (!jobs.size && used.has("maid") && !actFitsSomePlaces(item.tag, JOB_PLACE.maid, true)) return false;
      }
      for (const d of item.implies || []) {
        const dit = lex.byTag.get(d);
        if (!dit || (dit.mutex !== "place" && dit.group !== "place")) continue;
        if (!placeFitsJob(d, jobs, used)) return false;
      }
      if (heat === "sex" && (item.mutex === "place" || item.group === "place")) {
        const acts = usedActs(used, lex);
        const water = [...acts].some((a) => WATER_ACT.has(a) || BATH_ACT.has(a));
        if (water) {
          if (!WATER_PLACE.has(item.tag) && !BATH_PLACE.has(item.tag)) return false;
        } else if (!jobs.size) {
          if (!PRIVATE_SEX_PLACE.has(item.tag)) return false;
        } else if (PUBLIC_SEX_PLACE.has(item.tag)) {
          return false;
        }
      }
      if (item.tag === "outdoors" && [...jobPlacesOf(jobs)].some((p) => INDOOR_ROOM.has(p))) return false;
    }
    for (const g of extraMutex(item)) {
      if (mutexTaken.has(g)) return false;
    }
    return true;
  };

  const counts = settings.counts;
  // 衣著需要「偏好」而不是「硬分桶」。硬分桶會先把高順位抽到滿才看下一桶，
  // top／bottom／onepiece 各只有一格時，顏色變體的實際機率因此永遠是 0。
  // 權重保留年代合身、完整服裝優先，同時讓低順位衣著仍有非零機會。
  const clothingPrefer = {
    softTiers: [
      (item) =>
        eraSpecific(item, era) &&
        item.layer === "garment" &&
        !isColorVariant(item) &&
        (item.mutex === "onepiece" || item.mutex === "top" || item.mutex === "bottom"),
      (item) => eraSpecific(item, era) && item.layer === "garment" && !isColorVariant(item),
      // 顏色變體也可能是這個時代專屬的 —— blue shirt 就是 modern 專屬。
      // 舊的階梯用 !isColorVariant 把它們一路壓到最底層，等於自己把時代訊號丟掉：
      // 這一層加回來之後，現代的時代衣服從 5.32 升到 6.21（比硬桶時期的 5.79 還高），
      // 同時可達的顏色款式從 26 種變成 52 種。古代時代沒有顏色變體，完全不受影響。
      (item) => eraSpecific(item, era) && item.layer === "garment",
      (item) =>
        item.layer === "garment" &&
        !isColorVariant(item) &&
        (item.mutex === "onepiece" || item.mutex === "top" || item.mutex === "bottom"),
      (item) => item.layer === "garment" && !isColorVariant(item),
      (item) => item.layer === "garment",
    ],
    // 前兩層是「這件衣服屬於這個時代」，權重和後面拉開一個量級 —— 時代對不對是
    // 正確性，顏色夠不夠多樣是豐富度，正確性要壓過豐富度。
    //
    // 這裡本來是硬桶（前一桶抽乾才輪到下一桶），改成軟權重是為了救色彩變體
    // （blue shirt 這類本身是 modern 專屬，卻因為 !isColorVariant 被壓在最低層，
    // 硬桶下機率恆為 0）。但 12:1 的差距不夠，時代專屬的衣服跟著掉了 12–24%：
    // 中世紀 2.18 → 1.66、江戶 3.33 → 2.57，古代本來就沒幾件，掉一件就看不出年代。
    // 40:6 把時代還原到硬桶水準（古中國和維多利亞甚至更好），色彩變體仍有 24 種可達。
    weights: [40, 30, 20, 6, 4, 2, 1],
  };
  // 硬桶會抽乾前一桶才看下一桶，而桶 1（臉部）有 18 個 mutex=null 的字可以無限疊。
  // 姿勢槽扣掉專用格只剩約 6 格，臉部全吃光，桶 2 永遠輪不到 —— 結果是 28 個 sex 字
  // 結構性不可達（有專用 fill 的 sex_act 活著，mutex=null 的那些全死），姿勢字種數
  // 也卡在 149。改軟權重之後 284 種，核心內容從 1.78 上到 3.85。
  //
  // 臉部從 5.2 降到 1.9 是代價。孤立提示詞裡臉部字確實會複合出表情強度，但完整
  // 提示詞有性愛情境撐著，同 seed 對照圖的表情沒有變弱（docs/compare-pose/）。
  const posePrefer = {
    softTiers: [
      (item) => item.mutex === "body_pose" || item.mutex === "camera" || item.mutex === "gaze",
      (item) => item.group === "face",
      (item) => heat === "sex" && (item.mutex === "sex_act" || item.group === "sex"),
      (item) => heat === "flash" && (item.mutex === "clothes_action" || item.group === "flash"),
      (item) => heat === "tease" && item.group === "tease",
    ],
    weights: [8, 8, 10, 10, 10, 3],
  };
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
    const want = Math.max(0, Math.min(10, Number(counts[section]) || 0));
    const need = want - countSection(section);
    if (need <= 0) return;
    const pool = lex.bySection[section].filter(
      (item) => allow(item) && (!extraFilter || extraFilter(item))
    );
    let prefer = null;
    if (section === "clothing") prefer = clothingPrefer;
    else if (section === "pose") prefer = posePrefer;
    // env 刻意不給 prefer。takeFromPool 的桶是「抽乾桶 0 才輪到桶 1」，而 lighting
    // 之類的互斥只有一格 —— 舊的 (eraSpecific && mutex) 會讓桶 0 每次都先把那一格
    // 拿走，light 群裡 10 個 era:["any"] 的字機率恆為 0。era:["any"] 的意思是每個
    // 時代都能用，不是次等候選；真正不屬於當代的字 eraOk() 已經擋掉了。
    // 年代骨架與主場地由 stampAnchors("env") 和 fillSlot("env", "place") 負責。
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

  // 場上已經看得出是哪個運動時，活動欄優先挑那個運動自己的活動（排球場 → 做運動，
  // 而不是逛街）。抽不到也沒關係，場地本來就會把不合的活動擋掉。
  const sportActivityPrefer = () => {
    const ids = sportIdsOf(used);
    if (!ids || !ids.size) return null;
    const wanted = new Set();
    for (const sp of SPORT_PRESETS) {
      if (sp.activity && ids.has(sp.id)) wanted.add(sp.activity);
    }
    if (!wanted.size) return null;
    return (item) => wanted.has(item.tag);
  };

  const fillGroup = (section, groupName) => {
    if (someUsed((it) => it.group === groupName)) return;
    const indexed = lex.byGroup && lex.byGroup.get(section + ":" + groupName);
    const pool = (indexed || lex.bySection[section].filter((item) => item.group === groupName)).filter(
      (item) => allow(item)
    );
    takeFromPool(pool, 1, rand, commit, null, allow);
  };

  // 必抽：使用者在小分類旁指定「這一類至少要 N 個」。跑在骨架與通用補牌之前，
  // 所以它佔到的名額會被 countSection() 算進去，left rail 的「每段抽幾個」自動扣掉。
  // 權限比時代大（skipEra），但互斥、尺度、女／男、已關閉、已選都照擋 —— 互斥由
  // commit() 的 mutexBusy() 把關，所以必抽 2 絕不會給出兩個互斥的 tag。
  const mustWants = [];
  // 必抽抽到的字（含它帶進來的相依字）要跟釘選一樣受保護，否則最後的 reconcile()
  // 會被後committed 的字擠掉，性愛的全裸規則也會把必抽的衣服整排剝光。
  const mustLocked = new Set();
  const mustAllow = (item) => {
    if (!allow(item, { skipEra: true })) return false;
    // commit() 的 implyChain 只檢查時代，所以必抽有機會靠相依字把尺度／性別牆繞過去
    // （例如 spooning 在誘惑也能用，但它 implies sex）。這裡先把整條鏈驗過再說。
    for (const dep of implyChain(lex, item.tag)) {
      const it = lex.byTag.get(dep);
      if (!it) continue;
      if (!heatOk(it, heat) || !gateOk(it, female, male)) return false;
    }
    return true;
  };
  const mustSpec =
    settings.mustDraw && typeof settings.mustDraw === "object" ? settings.mustDraw : null;
  if (mustSpec) {
    for (const key of Object.keys(mustSpec)) {
      const sep = key.indexOf(":");
      if (sep <= 0) continue;
      const section = key.slice(0, sep);
      const group = key.slice(sep + 1);
      const want = Math.max(0, Math.min(MUST_MAX, Math.floor(Number(mustSpec[key])) || 0));
      if (!want || section === "quality" || !lex.bySection[section]) continue;
      mustWants.push({ key, section, group, want });
      let have = 0;
      for (const t of used) {
        const it = lex.byTag.get(t);
        if (it && it.section === section && it.group === group) have += 1;
      }
      if (have >= want) continue;
      const indexed = lex.byGroup && lex.byGroup.get(key);
      const pool = (
        indexed || lex.bySection[section].filter((item) => item.group === group)
      ).filter((item) => mustAllow(item));
      const before = new Set(used);
      takeFromPool(pool, want - have, rand, commit, null, mustAllow);
      for (const t of used) if (!before.has(t)) mustLocked.add(t);
    }
  }
  // 「使用者明講要什麼」這一層，必抽比照釘選：場景服裝規則和最後的 reconcile 都讓路。
  // sceneClothLocked() 本來就是這樣對待釘選的。真正的互斥、以及身體姿勢對不上（例如
  // 性愛體位跟雙手抱胸）仍然照擋，抽不到就在 mustReport 如實回報。
  const mustPins = () => (mustLocked.size ? new Set([...pinned, ...mustLocked]) : pinned);

  fillSlot("feature", "hair_length");
  fillSlot("feature", "eye_color");
  if (!used.has("bald")) {
    fillSlot("feature", "hair_color");
    fillGroup("feature", "hair_style");
  }
  if (female) fillSlot("feature", "breast_size");
  if (male && !realisticOn(settings) && rand() < 0.38) fillSlot("feature", "race");
  if (settings.drawJob && !used.has("maid")) fillSlot("feature", "job");
  if (heat !== "sex" && !someUsed((it) => it.mutex === "sex_act" || it.tag === "sex")) {
    fillSlot("pose", "activity", sportActivityPrefer() || undefined);
  }
  fill("feature", (item) => {
    if (item.mutex === "race") return false;
    if (item.mutex === "job" && (!settings.drawJob || used.has("maid"))) return false;
    return true;
  });

  const clothingPinned = someUsed((it, t) => it.section === "clothing" && pinned.has(t));
  const garmentPinned = someUsed(
    (it, t) => pinned.has(t) && it.section === "clothing" && it.layer === "garment"
  );
  const nudePinned = someUsed((it) => it.section === "clothing" && it.layer === "skin");
  if (
    !garmentPinned &&
    !nudePinned &&
    heat !== "flash" &&
    !mutexTaken.has("onepiece") &&
    !mutexTaken.has("top") &&
    !mutexTaken.has("bottom")
  ) {
    const kind = sceneClothKind(pinned);
    let nudeChance = 0;
    if (kind === "bath") nudeChance = 0.34;
    else if (kind === "swim") nudeChance = 0.18;
    else if (heat === "sex") nudeChance = 0.2;
    if (nudeChance && rand() < nudeChance) {
      const skins = lex.bySection.clothing.filter(
        (item) => allow(item) && (item.tag === "nude" || item.tag === "completely nude")
      );
      takeFromPool(skins, 1, rand, commit, null, allow);
    }
  }
  if (
    heat === "sex" &&
    !clothingPinned &&
    !nudePinned &&
    !someUsed((it) => it.section === "clothing" && it.layer === "skin") &&
    !mutexTaken.has("onepiece") &&
    !mutexTaken.has("top") &&
    !mutexTaken.has("bottom")
  ) {
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
    someUsed((it) => {
      if (it.section !== "clothing") return false;
      if (it.layer === "skin") return true;
      return isBodyGarment(it);
    });
  if (gotNude) {
    fill("clothing", (item) => {
      if (!(item.layer === "accessory" || item.layer === "skin")) return false;
      if (!lockSceneOn(settings)) return true;
      if (item.layer === "skin") return true;
      if (item.tag === "stethoscope" || item.tag === "nurse cap") return used.has("nurse") || used.has("doctor");
      if (item.tag === "hard hat") return used.has("construction worker") || used.has("construction site");
      if (item.tag === "police hat") return used.has("policewoman") || used.has("police uniform");
      if (item.tag === "lab coat") return used.has("scientist") || used.has("doctor") || used.has("laboratory");
      const outfit = new Set(["jewelry", "eyewear", "neckwear", "hands", "headwear", "feet"]);
      if (outfit.has(item.mutex) && !mutexTaken.has(item.mutex)) return true;
      return false;
    });
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
        if (item.group === "fabric") return true;
        return someUsed((it) => relOf(it).has(item.tag));
      }
      if (item.mutex === "onepiece" || item.mutex === "top" || item.mutex === "bottom") {
        if (mutexTaken.has("onepiece") || item.mutex === "onepiece") return false;
        if (mutexTaken.has(item.mutex)) return false;
        return true;
      }
      if (lockSceneOn(settings)) {
        if (item.layer === "garment" && someUsed((it) => relOf(it).has(item.tag))) return true;
        if (item.tag === "stethoscope" || item.tag === "nurse cap") return used.has("nurse") || used.has("doctor");
        if (item.tag === "hard hat") return used.has("construction worker") || used.has("construction site");
        if (item.tag === "police hat") return used.has("policewoman") || used.has("police uniform");
        if (item.tag === "lab coat") return used.has("scientist") || used.has("doctor") || used.has("laboratory");
        const outfit = new Set([
          "feet",
          "legs",
          "jewelry",
          "eyewear",
          "neckwear",
          "underwear_top",
          "underwear_bottom",
          "outer",
          "hands",
          "headwear",
        ]);
        if (outfit.has(item.mutex) && !mutexTaken.has(item.mutex)) return true;
        return false;
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
  // camera 排在臉部特徵之後，所以 head out of frame / lower body 這兩個禁止眼睛
  // 特徵的鏡頭，自動抽取永遠選不到（釘選仍然可用）。試過把這一槽移到臉部之前：
  // 兩個鏡頭確實變成各約 4.5% 可達，但同時打破四條既有承諾 —— lower body 會擋掉
  // 手臂動作和忙手活動，於是「活動尺度一定有活動」「全裸單人性愛一定有自慰動作」
  // 「flash 一定有衣服」全部失效。這兩個構圖和這工具的多數保證天生不相容，
  // 留給明確釘選比較誠實。詳見 docs/pose-tag-deep-review.md §2。
  fillSlot("pose", "camera");
  fillSlot("pose", "gaze");
  fillSlot("pose", "expression");
  const hasSexAct = someUsed((it) => it.mutex === "sex_act" || it.tag === "sex");
  if (heat !== "sex" && !hasSexAct) fillSlot("pose", "activity", sportActivityPrefer() || undefined);
  const stampActProps = () => {
    for (const a of usedActs(used, lex)) {
      for (const prop of ACT_PROP[a] || []) {
        if (used.has(prop) || banned.has(prop)) continue;
        const item = lex.byTag.get(prop);
        if (!item) continue;
        if (!eraOk(item, era) || !heatOk(item, heat)) continue;
        commit(prop);
        break;
      }
    }
  };
  stampActProps();
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
  stampAnchors("env");
  fillSlot("env", "place");
  if (realisticOn(settings) && !usedPlaces(used, lex).size) {
    for (const a of usedActs(used, lex)) {
      for (const p of ACT_PLACE[a] || []) {
        const item = lex.byTag.get(p);
        if (!item) continue;
        if (!allow(item)) continue;
        if (commit(p)) break;
      }
      if (usedPlaces(used, lex).size) break;
    }
  }
  fillSlot("env", "in_out");
  fillSlot("env", "day_night");
  // 時代風味：非現代的時代，畫面上至少要有一個看得出年代的環境字。
  //
  // 場地那一格幫不上忙 —— 場地必須配合先抽的活動，而活動幾乎全是時代中性的現代
  // 動作，所以中性場地每次都贏（中世紀最常抽到 bedroom、park、beach，castle 只有
  // 15/400，連 eraAnchors 都被擋掉）。結果是古代場景有 95–97% 的環境字是中性的，
  // 而 park、bedroom 這種字在 WAI 裡預設就畫成現代的：江戶場景配電線桿和公園長椅。
  //
  // 這一格挑的優先是「不佔互斥格的景物」（拱門、石牆、竹子、紙燈籠）—— 它們不是
  // 場地，所以不必配合活動，也不會跟已經選好的場地打架。補詞庫只能把中世紀從
  // 0.10 拉到 0.19；真正缺的是這一格。
  //
  // 已經看得出年代就不做事，所以不會在有城堡的圖上再疊一座塔。
  if (era && era !== "modern" && !someUsed((it) => it.section === "env" && eraSpecific(it, era))) {
    const flavour = lex.bySection.env.filter((item) => eraSpecific(item, era) && allow(item));
    takeFromPool(flavour, 1, rand, commit, (item) => !item.mutex, allow);
  }
  // 環境段無條件補到目標數。以前這裡只在非正常模式跑，而正常模式是預設 ——
  // 左欄「環境」那個數字 2/4/10 給出一模一樣的結果，是個死的控制項。
  // fill() 算的是 want - countSection()，骨架已經達標時本來就不會多塞，
  // 所以預設值 4 的畫面幾乎不變；使用者拉到 10 才會拿到額外的環境細節，
  // 而且每一個都還是要過 allow() 的時代、室內外、場地與日夜這幾關。
  fill("env");
  stampActProps();

  if (lockSceneOn(settings)) {
    const places = usedPlaces(used, lex);
    const real = realisticOn(settings);
    const needsPlace = (act) =>
      !!ACT_PLACE[act] ||
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
      if (places.size && !actFitsPlaces(t, places, real)) {
        used.delete(t);
        if (mutexTaken.get("activity") === t) mutexTaken.delete("activity");
      }
    }
    if (
      heat !== "sex" &&
      !usedActs(used, lex).size &&
      !someUsed((it) => it.mutex === "sex_act" || it.tag === "sex")
    ) {
      fillSlot("pose", "activity");
    }
    stampActProps();
  }

  {
    const guard = mustPins();
    const kind = sceneClothLocked(used, guard, lex, era, lockSceneOn(settings));
    if (kind) {
      const pinRel = new Set();
      for (const p of guard) {
        const pit = lex.byTag.get(p);
        if (pit) for (const r of relOf(pit)) pinRel.add(r);
      }
      for (const t of [...used]) {
        if (guard.has(t) || pinRel.has(t)) continue;
        const it = lex.byTag.get(t);
        if (
          it &&
          it.section === "clothing" &&
          (it.layer === "garment" || it.layer === "accessory") &&
          !garmentOkForKind(it, kind, era)
        ) {
          used.delete(t);
          for (const g of extraMutex(it)) {
            if (mutexTaken.get(g) === t) mutexTaken.delete(g);
          }
        }
      }
      if (!someUsed((it) => it.section === "clothing" && it.layer === "skin") && !hasBodyGarment()) {
        // 服裝是在場地之前決定的，場地選到浴場之後上面那圈掃描會把衣服刪掉，
        // 這裡再補一件。池子必須包含裸標，以及不使用三種 body mutex 的完整
        // 服裝；只收 onepiece/top/bottom 曾讓部分時代的浴場補救池變成空集合。
        const pool = lex.bySection.clothing.filter(
          (item) =>
            allow(item) &&
            (item.layer === "skin" || isBodyGarment(item)) &&
            garmentOkForKind(item, kind, era)
        );
        takeFromPool(pool, 1, rand, commit, clothingPrefer, allow);
      }
      for (const t of [...used]) {
        if (pinned.has(t)) continue;
        const it = lex.byTag.get(t);
        if (!it) continue;
        const cloth = [];
        for (const x of used) {
          if (lex.byTag.get(x)?.section === "clothing") cloth.push(x);
        }
        const badAction =
          (it.mutex === "clothes_action" || it.group === "flash" || needsBodyClothes(t)) &&
          actionFitsClothes(t, cloth) === 0;
        if (!badAction) continue;
        used.delete(t);
        for (const g of extraMutex(it)) {
          if (mutexTaken.get(g) === t) mutexTaken.delete(g);
        }
      }
      if (heat === "flash" && !someUsed((it) => it.mutex === "clothes_action" || it.group === "flash")) {
        fillSlot("pose", "clothes_action", [
          (item) => actionFitsWorn(item) === 2,
          (item) => actionFitsWorn(item) === 1,
        ]);
        if (!someUsed((it) => it.mutex === "clothes_action" || it.group === "flash")) {
          fillGroup("pose", "flash");
        }
      }
      if (heat === "sex" && people === 1 && !someUsed((it) => soloSex(it.tag))) {
        const acts = lex.bySection.pose.filter((item) => allow(item) && soloSex(item.tag));
        takeFromPool(acts, 1, rand, commit, null, allow);
      }
    }
  }

  {
    // 上衣有了、下著沒有。hasBodyGarment() 看到一件 top 就算通過，所以沒有任何
    // 一步會去補裙子；victorian 有六件上衣、bottom 池卻只有一條真裙子，畫出來
    // 就是上半身穿好、下半身什麼都沒交代。
    const lowerMut = new Set();
    let lowerSkin = false;
    for (const t of used) {
      const it = lex.byTag.get(t);
      if (!it || it.section !== "clothing") continue;
      if (it.layer === "skin") lowerSkin = true;
      const slot = bodyGarmentSlot(it);
      if (slot) lowerMut.add(slot);
    }
    const lowerCovered =
      lowerMut.has("bottom") ||
      lowerMut.has("onepiece") ||
      someUsed((it) => coversLowerBody(it));
    if (!lowerSkin && lowerMut.has("top") && !lowerCovered) {
      const kind = sceneClothLocked(used, mustPins(), lex, era, lockSceneOn(settings));
      const pool = lex.bySection.clothing.filter(
        (item) =>
          allow(item) &&
          item.layer === "garment" &&
          bodyGarmentSlot(item) === "bottom" &&
          (!kind || garmentOkForKind(item, kind, era))
      );
      takeFromPool(pool, 1, rand, commit, clothingPrefer, allow);
    }
  }

  fill("pose", (item) => {
    if (people >= 2 && soloSex(item.tag)) return false;
    if ((heat === "sex" || hasSexAct) && item.mutex === "activity" && !SEX_OK_ACTIVITY.has(item.tag)) return false;
    return true;
  });
  if (heat === "sex" && people === 1 && !someUsed((it) => soloSex(it.tag))) {
    for (const t of [...used]) {
      if (pinned.has(t)) continue;
      if (!BOTH_ARMS.has(t)) continue;
      const it = lex.byTag.get(t);
      used.delete(t);
      if (it) {
        for (const g of extraMutex(it)) {
          if (mutexTaken.get(g) === t) mutexTaken.delete(g);
        }
      }
    }
    const acts = lex.bySection.pose.filter((item) => allow(item) && soloSex(item.tag));
    takeFromPool(acts, 1, rand, commit, null, allow);
  }

  if (
    [...usedActs(used, lex)].some(
      (a) => WATER_ACT.has(a) && a !== "fishing" && a !== "wading"
    )
  ) {
    for (const t of [...used]) {
      if (pinned.has(t)) continue;
      if (
        t === "boots" ||
        t === "sneakers" ||
        t === "high heels" ||
        t === "shoes" ||
        t === "necktie" ||
        t === "bowtie" ||
        t === "armor" ||
        t === "plate armor" ||
        t === "japanese armor" ||
        t === "suit" ||
        t === "blazer" ||
        t === "lab coat"
      ) {
        const it = lex.byTag.get(t);
        used.delete(t);
        if (it) {
          for (const g of extraMutex(it)) {
            if (mutexTaken.get(g) === t) mutexTaken.delete(g);
          }
        }
      }
    }
    if (used.has("swimming") || used.has("diving")) {
      for (const t of [...used]) {
        if (pinned.has(t)) continue;
        if (t === "sandals" || t === "one knee up") used.delete(t);
      }
    }
  }
  if (lockSceneOn(settings) && used.has("cooking") && !used.has("kitchen")) {
    const kit = lex.byTag.get("kitchen");
    if (kit && eraOk(kit, era)) {
      for (const t of [...used]) {
        if (pinned.has(t)) continue;
        const it = lex.byTag.get(t);
        if (!it) continue;
        if (it.mutex === "place" || it.group === "place" || t === "outdoors") {
          used.delete(t);
          for (const g of extraMutex(it)) {
            if (mutexTaken.get(g) === t) mutexTaken.delete(g);
          }
        }
      }
      if (allow(kit)) commit("kitchen");
    }
  }
  if (
    lockSceneOn(settings) &&
    (used.has("breasts on table") || used.has("breasts on glass")) &&
    used.has("outdoors") &&
    !used.has("indoors")
  ) {
    for (const t of [...used]) {
      if (pinned.has(t)) continue;
      const it = lex.byTag.get(t);
      if (t === "outdoors" || (it?.implies || []).includes("outdoors")) {
        used.delete(t);
        if (it) {
          for (const g of extraMutex(it)) {
            if (mutexTaken.get(g) === t) mutexTaken.delete(g);
          }
        }
      }
    }
    const inn = lex.byTag.get("indoors");
    if (inn && allow(inn)) commit("indoors");
  }
  {
    const places = usedPlaces(used, lex);
    const onBed = used.has("on bed") || used.has("bed sheet");
    if (onBed && places.size && ![...places].some((p) => BED_PLACE.has(p))) {
      for (const t of ["on bed", "bed sheet"]) {
        if (pinned.has(t) || !used.has(t)) continue;
        const it = lex.byTag.get(t);
        used.delete(t);
        if (it) {
          for (const g of extraMutex(it)) {
            if (mutexTaken.get(g) === t) mutexTaken.delete(g);
          }
        }
      }
    }
  }
  {
    const acts = usedActs(used, lex);
    const needed = new Set();
    for (const a of acts) {
      for (const p of ACT_PROP[a] || []) needed.add(p);
    }
    for (const [act, props] of Object.entries(ACT_PROP)) {
      if (acts.has(act)) continue;
      for (const p of props) {
        if (pinned.has(p) || needed.has(p)) continue;
        const it = lex.byTag.get(p);
        used.delete(p);
        if (it) {
          for (const g of extraMutex(it)) {
            if (mutexTaken.get(g) === p) mutexTaken.delete(g);
          }
        }
      }
    }
  }

  const kept = reconcile(lex, used, female, male, people, mustPins(), lockSceneOn(settings));

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
  const shadowViolations = validateSupportShadow({
    tags: positive,
    pinned,
    mode: sceneModeOf(settings),
    people,
  });

  const mustReport = mustWants.map(({ key, section, group, want }) => {
    let got = 0;
    for (const t of positive) {
      const it = lex.byTag.get(t);
      if (it && it.section === section && it.group === group) got += 1;
    }
    return { key, section, group, want, got };
  });

  return {
    heat,
    era,
    female,
    male,
    people,
    seed,
    mustReport,
    sections: { quality, style, subject, feature, pose, clothing, env, nsfw },
    positive: positive.join(", "),
    shadowViolations,
    conflicts: contradictions(lex, positive),
    eraClash: eraMismatches(lex, pinned, era),
    heatClash: heatMismatches(lex, pinned, settings.heats),
  };
}

/**
 * 真的會吃「每段目標數」的段。左欄的輸入框照這份清單生成。
 *
 * 主體段刻意不在裡面：那一段整段就是卡司（人數、solo、adult），由 chooseCast()
 * 依 castWeights 決定，drawOne() 從頭到尾沒有 fill("subject")。以前 UI 照樣為它
 * 畫了一個輸入框，使用者從 0 調到 10 什麼都不會變。要改卡司請用左欄的男／女開關，
 * 或直接把 1girl／2girls 這類字釘起來。
 */
export const QUOTA_SECTIONS = ["feature", "pose", "clothing", "env"];

export const MUST_MAX = 20;

// settings.mustDraw is keyed "section:group" -> how many that group must contribute.
export function sanitizeMustDraw(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of Object.keys(raw)) {
    const sep = key.indexOf(":");
    if (sep <= 0 || sep === key.length - 1) continue;
    if (key.slice(0, sep) === "quality") continue;
    const n = Math.floor(Number(raw[key]));
    if (!Number.isFinite(n) || n <= 0) continue;
    out[key] = Math.min(MUST_MAX, n);
  }
  return out;
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
    pinSportActivity: false,
    lockScene: true,
    sceneMode: "normal",
    mustDraw: {},
  };
}

export function sanitizeSettings(raw, data) {
  const base = defaultSettings(data);
  if (!raw || typeof raw !== "object") return base;
  const counts = { ...base.counts };
  const incoming = raw.counts && typeof raw.counts === "object" ? raw.counts : {};
  for (const key of Object.keys(counts)) {
    if (incoming[key] === undefined || incoming[key] === null) continue;
    counts[key] = Math.max(0, Math.min(10, Number(incoming[key]) || 0));
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
    n: Math.max(1, Math.floor(Number(raw.n) || base.n)),
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
    pinSportActivity: raw.pinSportActivity === true,
    sceneMode,
    lockScene: sceneMode !== "weird",
    mustDraw: sanitizeMustDraw(raw.mustDraw),
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

export const TAG_WEIGHT_MIN = 0.6;
export const TAG_WEIGHT_MAX = 1.5;
export const TAG_WEIGHT_PRESETS = [0.6, 0.8, 1, 1.2, 1.5];

export function clampTagWeight(weight) {
  const n = Number(weight);
  let t = Math.round((Number.isFinite(n) ? n : 1) * 10);
  if (t > 15) t = 15;
  if (t < 6) t = 6;
  return t / 10;
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
  const cur = Math.round(clampTagWeight(weight) * 10);
  return clampTagWeight((cur + (dir < 0 ? -1 : 1)) / 10);
}

export function settleGenCard({ aborting = false, skipping = false, errName = "", finished = false, hadError = false } = {}) {
  if (skipping) return "skip";
  if (aborting || errName === "AbortError") return "cancel";
  if (hadError) return "error";
  if (finished) return "ok";
  return "interrupt";
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
