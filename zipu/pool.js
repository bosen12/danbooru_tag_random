/**
 * 字鋪的牌池：從詞庫挑出能當卡牌的字，算出花色、格數、籌碼、呼應，以及卡面插畫的 prompt。
 *
 * 零 import。詞庫以外的東西（分級過濾、引擎的情境表、運動組合）由呼叫端注入，
 * 這樣瀏覽器（靠 server 的 SHARED 回退拿 engine.js）和 node（測試、烘焙腳本）
 * 用的是同一份程式 —— game/quiz.js 也是這樣做的，理由一樣。
 */

export const SUITS = ["look", "wear", "pose", "scene"];
export const SUIT_INFO = {
  look: { zh: "長相", glyph: "容" },
  wear: { zh: "服裝", glyph: "衣" },
  pose: { zh: "姿勢", glyph: "姿" },
  scene: { zh: "場景", glyph: "景" },
};

const SECTION_SUIT = { feature: "look", clothing: "wear", pose: "pose", env: "scene" };
// 職業在詞庫裡歸「特徵」，但放上檯面它就是一身行頭。
const GROUP_SUIT = { job: "wear" };

export const HISTORIC_ERAS = ["edo", "victorian", "medieval", "ancient_china", "ancient_greece"];
export const ERA_ZH = {
  any: "不限時代",
  modern: "現代",
  edo: "江戶",
  victorian: "維多利亞",
  medieval: "中世紀",
  ancient_china: "古中國",
  ancient_greece: "古希臘",
};

/*
 * 詞庫裡通過全年齡、卻不適合做成一張卡的字。這是遊戲的選品，不是詞庫的判斷 ——
 * 詞庫要服務的是生圖，這裡要服務的是一副會被翻來翻去、印成作品的牌。
 *   身體部位特寫、學生制服、兩個人才成立的動作、脫衣場所：卡面插畫會變味，或單人畫不出來。
 */
export const EXCLUDE_GROUPS = new Set(["body_f", "body_m"]);
export const EXCLUDE_TAGS = new Set([
  "loli", "pregnant", "petite", "love hotel", "playboy bunny", "saliva trail", "tongue",
  "bruise", "bruise on face", "grabbing another's hair", "size difference", "belly", "covered navel",
  "kiss", "hug", "hug from behind", "sitting on lap", "cuddling", "holding hands", "eye contact",
  "looking at another", "shared bathing", "bathing", "showering", "washing back", "washing hair",
  "after bathing", "partially submerged", "sunbathing",
  "school uniform", "serafuku", "sailor dress", "school swimsuit", "gym uniform", "buruma",
  "babydoll", "latex", "leotard", "bodysuit", "blue bodysuit", "black bodysuit",
  "bikini", "string bikini", "blue bikini", "side-tie bikini bottom",
  "all fours", "top-down bottom-up", "arched back", "navel piercing",
  "animal collar", "black collar", "red collar",
  "shiny skin", "body blush", "wet", "sweat", "tanlines", "body freckles",
  "head out of frame", "lower body", "pov",
  "pelvic curtain", "dudou", "chemise", "petticoat",
  "bath", "bathroom", "bathtub", "shower (place)", "sauna", "changing room", "locker room",
  "fitting room", "onsen", "bathhouse", "ofuro", "bubble bath",
]);

// 卡面插畫表達不出來的字：畫出來跟任何一張都一樣。這些直接用純字版。
export const NO_ART = new Set(["looking at viewer", "looking ahead", "closed mouth", "straight-on"]);

// 稀有：時代服裝、職業、活動、種族，以及只屬於某個古代的字。
const RARE_GROUPS = new Set(["era", "job", "activity", "race"]);

/* 呼應：兩張放在同一版會互相成全的字。大部分直接讀引擎的情境表（活動↔地點、
 * 器材↔場合、運動成套），下面這幾組是引擎沒有、但畫面上顯然成立的。 */
const CURATED_PAIRS = [
  // 職業 ↔ 地點
  ["nurse", "hospital"], ["doctor", "hospital"], ["scientist", "laboratory"], ["teacher", "classroom"],
  ["office lady", "office"], ["barista", "cafe"], ["waitress", "cafe"], ["waitress", "restaurant"],
  ["barmaid", "tavern"], ["barmaid", "bar (place)"], ["knight", "castle"], ["princess", "castle"],
  ["princess", "ballroom"], ["princess", "palace"], ["dancer", "ballroom"], ["priestess", "temple"],
  ["priestess", "church"], ["priest", "church"], ["monk", "temple"], ["samurai", "shrine"],
  ["onmyouji", "shrine"], ["miko", "shrine"], ["ninja", "forest"], ["witch", "forest"],
  ["farmer", "field"], ["farmer", "village"], ["pilot", "airplane interior"],
  ["flight attendant", "airplane interior"], ["policewoman", "street"], ["police", "city"],
  ["soldier", "battlefield"], ["military", "battlefield"], ["gladiator", "ruins"],
  ["detective", "alley"], ["detective", "city"], ["idol", "microphone"], ["oiran", "paper lantern"],
  ["blacksmith", "village"], ["viking", "ocean"], ["firefighter", "city"], ["construction worker", "city"],
  // 職業 ↔ 行頭
  ["nurse", "nurse cap"], ["doctor", "stethoscope"], ["doctor", "lab coat"], ["scientist", "lab coat"],
  ["policewoman", "police hat"], ["police", "police uniform"], ["policewoman", "police uniform"],
  ["knight", "armor"], ["knight", "plate armor"], ["samurai", "japanese armor"], ["samurai", "hakama"],
  ["office lady", "business suit"], ["office lady", "pencil skirt"], ["teacher", "glasses"],
  ["witch", "broom"], ["miko", "hakama"], ["oiran", "kimono"], ["princess", "gown"],
  ["construction worker", "hard hat"], ["gladiator", "shoulder armor"], ["idol", "frills"],
  // 服裝 ↔ 場合
  ["apron", "kitchen"], ["maid", "kitchen"], ["wedding dress", "church"], ["veil", "church"],
  ["bride", "church"], ["evening gown", "ballroom"], ["gown", "ballroom"], ["pajamas", "bedroom"],
  ["nightgown", "bedroom"], ["swimsuit", "beach"], ["one-piece swimsuit", "pool"],
  ["yukata", "festival"], ["kimono", "shrine"], ["hanfu", "palace"], ["chinese clothes", "palace"],
  ["toga", "ruins"], ["chiton", "ruins"], ["qipao", "restaurant"], ["lab coat", "laboratory"],
  ["business suit", "office"], ["suit", "office"], ["cheerleader", "stadium"],
  ["hooded cloak", "forest"], ["cloak", "forest"], ["cape", "castle"], ["armor", "castle"],
  // 天光 ↔ 天光
  ["night", "full moon"], ["night", "moonlight"], ["night", "city lights"], ["night", "lantern"],
  ["night", "starry sky"], ["night", "neon lights"], ["night", "lamppost"], ["night", "candlelight"],
  ["sunset", "orange sky"], ["dusk", "orange sky"], ["evening", "orange sky"], ["day", "blue sky"],
  ["day", "sunlight"], ["rain", "overcast"], ["rain", "umbrella"], ["snow", "overcast"],
  ["cherry blossoms", "shrine"], ["cherry blossoms", "park"], ["fog", "forest"],
  ["candlelight", "candle"], ["fireplace", "living room"], ["chandelier", "ballroom"],
  ["desk lamp", "studying"], ["window light", "window"], ["paper lantern", "festival"],
  ["stone lantern", "shrine"], ["torch", "castle"],
];

/** 詞庫原始資料 + 注入的依賴 → 牌池世界。 */
export function buildWorld(data, deps) {
  const {
    ratingBlocked,
    tokenCounts = {},
    ACT_PLACE = {},
    NEEDS_CONTEXT = {},
    CTX_PULLS_ACC = [],
    CTX_PULLS_GEAR = [],
    SPORT_PRESETS = [],
    SPORT_NEUTRAL_GEAR = new Set(),
    indexLexicon,
    contradictions,
  } = deps || {};

  const byTag = new Map(data.tags.map((t) => [t.tag, t]));
  const lex = indexLexicon ? indexLexicon(data) : null;
  const cards = [];
  const byCard = new Map();

  for (const item of data.tags) {
    const suit = GROUP_SUIT[item.group] || SECTION_SUIT[item.section];
    if (!suit) continue;
    if (item.gate === "male") continue;
    if (EXCLUDE_GROUPS.has(item.group) || EXCLUDE_TAGS.has(item.tag)) continue;
    if (ratingBlocked && ratingBlocked(item, "general")) continue;
    const slots = Math.max(1, Math.min(5, tokenCounts[item.tag] || 1));
    const eras = (item.era || ["any"]).filter(Boolean);
    const card = {
      tag: item.tag,
      zh: item.zh || item.tag,
      suit,
      group: item.group,
      mutex: item.mutex || null,
      eras,
      slots,
      chips: chipsFor(slots),
      rare: RARE_GROUPS.has(item.group) || (eras.length && eras.every((e) => HISTORIC_ERAS.includes(e))),
      implies: [...(item.implies || []), ...(item.bind || [])].filter((t) => byTag.has(t)),
      art: !NO_ART.has(item.tag),
    };
    cards.push(card);
    byCard.set(card.tag, card);
  }

  // 呼應是對稱的：A 成全 B，B 就成全 A。
  const pairs = new Map();
  const link = (a, b) => {
    if (a === b || !byCard.has(a) || !byCard.has(b)) return;
    if (!pairs.has(a)) pairs.set(a, new Set());
    if (!pairs.has(b)) pairs.set(b, new Set());
    pairs.get(a).add(b);
    pairs.get(b).add(a);
  };
  for (const [act, places] of Object.entries(ACT_PLACE)) for (const p of places) link(act, p);
  for (const [item, ctx] of Object.entries(NEEDS_CONTEXT)) for (const c of ctx) link(item, c);
  for (const [ctx, item] of [...CTX_PULLS_ACC, ...CTX_PULLS_GEAR]) link(ctx, item);
  for (const [a, b] of CURATED_PAIRS) link(a, b);

  // 運動成套：場地、器材、服裝、動作。通用裝備（球鞋、運動服）不代表任何一項運動。
  const sets = [];
  for (const p of SPORT_PRESETS) {
    const own = [...(p.venue || []), ...(p.equipment || []), ...(p.clothing || [])]
      .filter((t) => byCard.has(t) && !SPORT_NEUTRAL_GEAR.has(t));
    if (p.activity && byCard.has(p.activity)) own.push(p.activity);
    const venue = (p.venue || []).filter((t) => byCard.has(t));
    if (own.length < 3 || !venue.length) continue;
    sets.push({ id: p.id, name: p.name, tags: new Set(own), venue: new Set(venue) });
    for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++) link(own[i], own[j]);
  }

  // 撞不撞，交給引擎判斷：互斥群、室內外、晝夜……跟排字匣抽牌用的是同一套。
  // contradictions() 的每一條規則都是兩兩比對，所以逐對問、記下來，選牌時的即時預覽才跑得動。
  const memo = new Map();
  const clashPair = (a, b) => {
    if (!lex || !contradictions || a === b) return false;
    const key = a < b ? a + "\u0000" + b : b + "\u0000" + a;
    let v = memo.get(key);
    if (v === undefined) {
      v = contradictions(lex, [a, b]).length > 0;
      memo.set(key, v);
    }
    return v;
  };

  return { data, lex, byTag, cards, byCard, pairs, sets, actPlace: ACT_PLACE, clashPair };
}

/** 格數越多籌碼越多，但每一格的效率越低 —— 短字划算，長字在有空位時補分。 */
export function chipsFor(slots) {
  return [0, 5, 9, 13, 17, 20][Math.min(5, slots)];
}

export function pairsOf(world, tag) {
  return world.pairs.get(tag) || new Set();
}

/* ---------- 卡面插畫 ---------- */

// 每一類字用一種鏡頭，讓那個字成為畫面的主角。試生 20 張後定下來的。
const PERSON_FRAME = {
  hair_color: "upper body",
  hair_style: "upper body",
  hair_len: "full body",
  eyes: "portrait",
  makeup: "portrait",
  skin: "upper body",
  other: "upper body",
  race: "upper body",
  face: "portrait",
  gaze: "upper body",
  camera: "",
  body: "full body",
  tease: "full body",
  job: "full body, standing",
  onepiece: "full body, standing",
  era: "full body, standing",
  bottom: "full body, standing",
  legs: "full body, standing",
  feet: "full body, standing",
  top: "cowboy shot, standing",
  outer: "cowboy shot, standing",
  fabric: "cowboy shot, standing",
  acc: "upper body",
};

// 單獨畫會怪的字，補一個道具。
const ART_EXTRA = {
  sitting: "chair",
  "crossed legs": "sitting, chair",
  "indian style": "floor",
  "against wall": "wall",
  "against glass": "window",
  "looking at mirror": "mirror",
  "looking outside": "window",
  sleeping: "bed, pillow",
  lying: "bed",
  "on back": "bed",
  "on side": "bed",
  reclining: "couch",
  "hair flower": "portrait",
  "hair scrunchie": "ponytail",
  bride: "full body, wedding dress",
  umbrella: "full body, holding umbrella",
  bag: "cowboy shot",
  cape: "full body",
  "hooded cloak": "full body",
  cloak: "full body",
  boots: "full body",
  "high heels": "full body",
};

// 場景節裡其實是「人在某處」的字。
const SCENE_WITH_PERSON = new Set(["furniture"]);

// 場景節裡的物件：用風景去畫，物件會小到看不見（試生時茶壺變成一片森林）。改畫靜物。
const STILL_LIFE = new Set([
  "incense burner", "incense", "folding fan", "hand fan", "scroll", "calligraphy", "guqin", "erhu",
  "teapot", "teacup", "folding screen", "lotus", "chrysanthemum", "silk", "beads", "spear", "polearm",
  "shield", "drum", "table", "amphora", "grapes", "wine glass", "lyre", "olive", "trident",
  "pocket watch", "cane", "birdcage", "violin", "lace", "rose", "clock", "pillow", "bed sheet", "chair",
  "swivel chair", "office chair", "gaming chair", "shower head", "innertube", "mirror",
  "full-length mirror", "tissue box", "basketball (object)", "soccer ball", "tennis ball",
  "volleyball (object)", "baseball (object)", "bowling ball", "golf ball", "tennis racket",
  "baseball bat", "golf club", "badminton racket", "table tennis paddle", "baseball mitt",
  "bow (weapon)", "shuttlecock", "table tennis ball", "arrow (projectile)", "guitar", "book", "pen",
  "cellphone", "cigarette", "frying pan", "shopping bag", "broom", "fishing rod", "game controller",
  "paintbrush", "kiseru", "smoking pipe", "cigar", "calligraphy brush", "quill", "pencil", "newspaper",
  "mop", "bucket", "ladle", "camera", "desk", "nightstand", "whiteboard", "microphone stand",
  "tea set", "crystal ball", "ofuda", "lamp", "oil lamp", "candelabra", "candle", "desk lamp",
  "microphone", "stethoscope",
]);

export const ART_SEED = 1383;
export const ART_SIZE = { width: 832, height: 1216 };
const ART_TAIL = "sfw, general, masterpiece, best quality, amazing quality";

export function artPrompt(world, card) {
  const item = world.byTag.get(card.tag) || {};
  const extra = [ART_EXTRA[card.tag], ...card.implies].filter(Boolean);
  let parts;
  if (STILL_LIFE.has(card.tag)) {
    parts = ["no humans", "still life", card.tag, ...extra, "simple background"];
  } else if (card.suit === "scene" && !SCENE_WITH_PERSON.has(card.group)) {
    parts = ["no humans", "scenery", card.tag, ...extra];
  } else if (card.group === "activity") {
    const place = firstOf(world.actPlace[card.tag]);
    parts = ["1girl", "solo", "adult", card.tag, ...extra, place || "simple background"];
  } else if (item.section === "env") {
    parts = ["1girl", "solo", "adult", card.tag, ...extra, "full body"];
  } else {
    const framed = extra.some((e) => /\b(body|shot|portrait)\b/.test(e));
    const frame = framed ? "" : PERSON_FRAME[card.group] ?? "upper body";
    const bg = card.group === "camera" ? "simple background" : "simple background, white background";
    parts = ["1girl", "solo", "adult", card.tag, ...extra, frame, bg];
  }
  return uniq(parts.filter(Boolean).join(", ").split(", ")).join(", ") + ", " + ART_TAIL;
}

export function artFile(tag) {
  return tag.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase() + ".webp";
}

function firstOf(set) {
  if (!set) return "";
  for (const v of set) return v;
  return "";
}

function uniq(list) {
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))];
}
