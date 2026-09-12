// 運動的單一資料來源。
//
// 以前運動規則散在 BUILTIN_PRESETS、SPORT_KIT、SPORT_BALL、SPORT_PROP、SPORT_UNIFORMS
// 五個常數裡，改一個地方就會跟其他四個失同步。現在只有這一份，其餘全部由它算出來：
// 釘選組合的 tags、抽牌時的運動互斥、活動能配哪些場地、測試案例。
//
// tag 全部用專案內的空格格式，且都通過 Danbooru API 核實（category=0、post_count>0、
// 非 deprecated）。核實腳本：scripts/verify_danbooru_tags.mjs。
//
// 刻意不用的 tag，理由記在這裡免得以後有人「順手補回去」：
//   basketball / baseball          deprecated
//   volleyball                     已 alias 到 2026 年的新名稱
//   volleyball court               post_count 0
//   baseball glove                 alias，正解是 baseball mitt
//   cycling / golf uniform         post_count 0
//   tennis shoes / archery range   post_count 0
//   ice rink                       post_count 0
//   arrow / yumi                   deprecated，正解是 arrow (projectile)
//   basketball (sport) 等三個      2026 年才建立，WAI Illustrious 的舊 Danbooru 語彙吃不到

// 跨運動通用的裝備。這些**不代表運動身分**，所以不參與互斥判斷
// （球鞋、運動服、護膝、蛙鏡、棒球帽在非運動圖裡也很常見）。
export const SPORT_NEUTRAL_GEAR = new Set([
  "sneakers",
  "sportswear",
  "goggles",
  "knee pads",
  "baseball cap",
]);

// preset: false 的項目不會出現在釘選組合按鈕上，只是讓抽牌時的運動互斥認得它們。
export const SPORT_PRESETS = [
  {
    id: "hoops", // 舊 id，保留相容
    name: "籃球",
    activity: "playing sports",
    venue: ["basketball court"],
    equipment: ["basketball (object)"],
    clothing: ["basketball uniform", "sneakers"],
    optionalEquipment: [],
  },
  {
    id: "tennis",
    name: "網球",
    // 有自己的 activity tag，就不要再疊 playing sports —— 兩個 activity 會互斥。
    activity: "tennis",
    venue: ["tennis court"],
    equipment: ["tennis racket", "tennis ball"],
    clothing: ["tennis uniform", "sneakers"],
    optionalEquipment: [],
  },
  {
    id: "soccer",
    name: "足球",
    activity: "soccer",
    venue: ["soccer field"],
    equipment: ["soccer ball"],
    clothing: ["soccer uniform", "cleats"],
    optionalEquipment: [],
  },
  {
    id: "baseball",
    name: "棒球",
    activity: "playing sports",
    venue: ["baseball stadium"],
    // 球棒進、手套不進：單人構圖同時拿棒子和守備手套會變成打者兼守備員。
    equipment: ["baseball (object)", "baseball bat"],
    clothing: ["baseball uniform", "baseball cap", "cleats"],
    optionalEquipment: ["baseball mitt"],
  },
  {
    id: "volleyball",
    name: "排球",
    activity: "playing sports",
    // volleyball court 的 post_count 是 0，用綜合球場。
    venue: ["sports court"],
    equipment: ["volleyball (object)"],
    clothing: ["volleyball uniform", "knee pads", "sneakers"],
    optionalEquipment: [],
  },
  {
    id: "badminton",
    name: "羽球",
    activity: "badminton",
    venue: ["sports court"],
    equipment: ["badminton racket", "shuttlecock"],
    // Danbooru 沒有堪用的 badminton uniform，不發明。
    clothing: ["sportswear", "sneakers"],
    optionalEquipment: [],
  },
  {
    id: "tabletennis",
    name: "桌球",
    activity: "table tennis",
    venue: [],
    // 球拍是 table tennis paddle，不是 post_count 0 的 table tennis racket。
    equipment: ["table tennis paddle", "table tennis ball"],
    clothing: ["sportswear", "sneakers"],
    optionalEquipment: [],
  },
  {
    id: "swim",
    name: "游泳",
    activity: "swimming",
    venue: ["pool"],
    equipment: [],
    clothing: ["competition swimsuit", "swim cap", "goggles"],
    optionalEquipment: [],
  },
  {
    id: "boxing",
    name: "拳擊",
    activity: "boxing",
    venue: ["boxing ring"],
    equipment: ["boxing gloves"],
    clothing: ["boxing shorts"],
    optionalEquipment: [],
  },
  {
    id: "track", // 舊 id，保留相容
    name: "田徑",
    activity: "track and field",
    venue: ["running track"],
    equipment: [],
    // relay baton 只代表接力賽，不該是每張田徑圖的必進項目。
    clothing: ["track uniform", "sneakers"],
    optionalEquipment: [],
  },
  {
    id: "golf",
    name: "高爾夫",
    activity: "golf",
    venue: ["golf course"],
    equipment: ["golf club", "golf ball"],
    // golf uniform 的 post_count 是 0。
    clothing: ["sportswear"],
    optionalEquipment: [],
  },
  {
    id: "cycling",
    name: "自行車",
    activity: "riding bicycle",
    venue: [],
    equipment: ["bicycle"],
    clothing: ["bicycle helmet", "sportswear", "sneakers"],
    optionalEquipment: [],
  },
  {
    id: "archery",
    name: "射箭",
    activity: "archery",
    venue: [],
    equipment: ["bow (weapon)", "arrow (projectile)"],
    clothing: ["sportswear"],
    optionalEquipment: [],
  },

  // 以下沒有按鈕，只是讓互斥規則認得既有的滑雪和保齡球。
  {
    id: "ski",
    name: "滑雪",
    preset: false,
    activity: "skiing",
    venue: ["ski slope"],
    equipment: [],
    clothing: [],
    optionalEquipment: [],
  },
  {
    id: "bowling",
    name: "保齡球",
    preset: false,
    activity: null,
    venue: ["bowling alley"],
    equipment: ["bowling ball"],
    clothing: [],
    optionalEquipment: [],
  },
];

/** 這個 preset 的「必進 POS」完整清單，順序固定：活動 → 場地 → 器材 → 服裝。 */
export function sportPresetTags(p) {
  if (!p) return [];
  return [
    ...(p.activity ? [p.activity] : []),
    ...(p.venue || []),
    ...(p.equipment || []),
    ...(p.clothing || []),
  ];
}

/** 會出現在釘選組合列上的運動。 */
export const SPORT_BUTTONS = SPORT_PRESETS.filter((p) => p.preset !== false);

export const SPORT_BY_ID = new Map(SPORT_PRESETS.map((p) => [p.id, p]));

/**
 * tag → 有哪些運動可以合理使用它。只收「帶運動身分」的 tag：
 * 通用裝備（SPORT_NEUTRAL_GEAR）不進來，所以球鞋不會害籃球跟網球互斥。
 */
export const SPORT_IDENTITY = (() => {
  const m = new Map();
  const add = (tag, id) => {
    if (!tag || SPORT_NEUTRAL_GEAR.has(tag)) return;
    if (!m.has(tag)) m.set(tag, new Set());
    m.get(tag).add(id);
  };
  for (const p of SPORT_PRESETS) {
    for (const t of sportPresetTags(p)) add(t, p.id);
    for (const t of p.optionalEquipment || []) add(t, p.id);
  }
  return m;
})();

/** preset 擁有的 tag（含選配器材）—— 用來判斷「這個 tag 是不是這個運動的」。 */
export function sportOwnedTags(p) {
  return new Set([...sportPresetTags(p), ...(p.optionalEquipment || [])]);
}

/**
 * 從一堆 tag 推出還剩哪些運動說得通。
 * 回 null＝完全沒有運動線索，不構成限制；回空集合＝已經自相矛盾。
 */
export function sportIdsOf(tags) {
  let ids = null;
  for (const t of tags) {
    const own = SPORT_IDENTITY.get(t);
    if (!own) continue;
    if (ids === null) {
      ids = new Set(own);
      continue;
    }
    for (const id of [...ids]) if (!own.has(id)) ids.delete(id);
  }
  return ids;
}

/** 這個 tag 能不能和已經在場上的東西共存（同一個運動才行）。 */
export function sportTagAllowed(tag, used) {
  const own = SPORT_IDENTITY.get(tag);
  if (!own) return true; // 不帶運動身分的字一律放行
  const ids = sportIdsOf(used);
  if (ids === null) return true; // 場上還沒有運動線索
  for (const id of own) if (ids.has(id)) return true;
  return false;
}

/** 活動 → 合理場地。給 engine 的 ACT_PLACE 用，讓自行車不會出現在臥室。 */
export const SPORT_ACT_PLACE = {
  tennis: ["tennis court", "sports court"],
  soccer: ["soccer field", "stadium", "park"],
  badminton: ["sports court", "school gym", "fitness gym"],
  "table tennis": ["sports court", "school gym", "fitness gym"],
  boxing: ["boxing ring", "fitness gym"],
  "track and field": ["running track", "stadium"],
  golf: ["golf course"],
  archery: ["dojo", "sports court", "stadium", "courtyard", "school gym"],
  "riding bicycle": [
    "street",
    "city",
    "cityscape",
    "alley",
    "park",
    "running track",
    "stadium",
    "forest",
    "mountain",
    "garden",
    "courtyard",
    "beach",
  ],
};

/** 新加的運動活動 tag。engine 要把它們一起當成「會動的活動」處理。 */
export const SPORT_MOVE_ACTS = [
  "tennis",
  "soccer",
  "badminton",
  "table tennis",
  "boxing",
  "track and field",
  "golf",
  "archery",
];
