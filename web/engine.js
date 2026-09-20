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
// 可以跟性愛動作並存的活動。其餘會動的活動（打球、騎馬、跑步）跟性愛互斥 ——
// 那是物理，不是尺度。
//
// diving 是 2026-09-16 補的：它跟 swimming／wading／floating 一樣在 WATER_ACT
// 裡，中文是「潛水」不是「跳水」，泡在水裡這件事跟游泳同一類。漏掉它沒有理由，
// 結果是「游泳可以、潛水不行」。WATER_ACT 裡只剩 fishing 不在這裡，那個有道理：
// 釣魚是手上拿著竿子站在岸上，不是泡在水裡。
const SEX_OK_ACTIVITY = new Set([
  "bathing",
  "showering",
  "swimming",
  "wading",
  "floating",
  "shared bathing",
  "diving",
]);

// 不是「活動」但一樣會讓性愛抽不到的身體姿勢。
// sleeping 的互斥寫在 allow() 裡（睡著時整段 pose 只留鏡頭／身體／表情／脫衣），
// 所以它不是 mutex="activity"，sportHeatWarnings 本來看不到它 ——
// 使用者釘了「睡著」再選性愛，會一張都抽不到而且**畫面上完全沒有提示**。
const SEX_BLOCKING_BODY = new Set(["sleeping"]);

const STILL_BODY = new Set(["sleeping", "lying", "on back", "on stomach", "on side", "reclining"]);
const LOCKED_SIT = new Set(["seiza", "wariza", "indian style"]);
const GROUND_BODY = new Set(["all fours", "crawling", "top-down bottom-up"]);
// 站著、走著、跑著的人不會同時「在沙發上」。on bed／on chair 這幾個字原本是
// body_pose，被改成 env/furniture 之後就脫離了姿勢相容那一整套檢查，於是
// 「standing + on couch」這種組合一直畫得出來（基準線 4/24，六分之一）。
const UPRIGHT_BODY = new Set(["standing", "walking", "running", "jumping", "standing split"]);

// 「只穿一件」的字。naked coat 的意思就是**除了大衣什麼都沒穿**，所以它跟任何
// 主衣、內衣都是矛盾的。這件事以前完全沒有被擋：實測 1500 張裡出現這六個字的
// 190 張，**190 張身上都還穿著別的衣服**（naked coat 配 idol clothes、
// naked jacket 配 evening gown 加運動內衣）。
//
// 會漏掉是因為互斥格不夠用：naked sweater／naked apron／naked towel 的格子是
// onepiece，擋得住別的主衣但擋不住內衣；而 naked coat／naked jacket 的格子是
// outer —— 外套格當然擋不住洋裝。這是語意問題，不是格子問題，所以要一條規則。
const NAKED_ONLY = new Set([
  "naked sweater", "naked shirt", "naked apron", "naked towel", "naked coat", "naked jacket",
]);
// 會被「只穿一件」排除的：身上的主要衣物與內衣。外套不算（naked coat 自己就是外套），
// 襪子鞋子也不算（光腳穿大衣跟穿著襪子穿大衣都成立）。
const BODY_WORN_GROUP = new Set(["onepiece", "top", "bottom", "underwear", "era"]);
// 「只穿內衣」的方向跟 NAKED_ONLY 相反：那邊是連內衣都不能有，這邊是**只能**有內衣。
//
// Danbooru wiki 寫得很明確：「Wearing only underwear by itself, such as a bra and
// panties, lingerie, boxers, etc. ... Thighhighs or socks may be worn」——
// 襪類明文放行，外套與主要衣物不行。共現率也對得上（underwear only 共 80,742 張）：
//
//     panties 87.0%、bra 63.4%、thighhighs 25.5%、garter belt 6.9%、socks 4.1%
//     jacket 1.2%、coat 0.25%
//
// 修之前釘住「只穿內衣」抽 600 張，**79.5% 身上穿著非內衣的衣服** ——
// 夾克 178、大衣 157、開襟衫 69。標著只穿內衣卻套著大衣，那個字等於沒作用。
const UNDERWEAR_ONLY_BAD = new Set(["onepiece", "top", "bottom", "outer", "era"]);
// 袖子描述預設身上有一件「有袖子的衣服」，只穿內衣時沒有那一件。
// fabric 那一組不能整組擋 —— see-through clothes／fishnets／latex 可以是在講內衣本身。
const SLEEVE_WORD = new Set([
  "long sleeves", "short sleeves", "wide sleeves", "puffy sleeves",
  "detached sleeves", "sleeves rolled up",
]);
const underwearOnlyClash = (item) =>
  !!item &&
  item.section === "clothing" &&
  (UNDERWEAR_ONLY_BAD.has(item.group) || SLEEVE_WORD.has(item.tag));

// 泳衣底下不穿內衣。比基尼配運動內褲是穿兩層。
const isSwimGarment = (item) =>
  !!item && item.section === "clothing" && item.layer === "garment" &&
  (item.tag.includes("bikini") || item.tag.includes("swimsuit"));
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
  new Set(["heavy breathing"]),
  new Set(["kiss"]),
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
const NIGHT_MARK = new Set(["night", "starry sky", "moonlight", "market stall"]);
// 這些光源本身就交代了「天是暗的」：篝火、火把、燭光、油燈、街燈。
// 它們不在 NIGHT_MARK 裡，因為 NIGHT_MARK 的成員彼此互斥（一張圖只能有一個
// 夜的講法），而光源是另一個槽，可以和 night 並存 —— 只是不能和白天並存。
const DARK_LIGHT = new Set([
  "city lights",
  "bonfire",
  "torch",
  "candlelight",
  "candle",
  "lantern",
  "oil lamp",
  "fireplace",
  "chandelier",
  "candelabra",
  "lamppost",
]);
const SLEEP_BAD_POSE = new Set([
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
const EYE_EXTRA = new Set(["one eye closed", "empty eyes", "sparkling eyes", "half-closed eyes", "rolling eyes"]);
const MOUTH_EXTRA = new Set([
  "open mouth",
  "clenched teeth",
  "biting own lip",
  "tongue out",
  "parted lips",
  "licking lips",
  "drooling",
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
  "horse",
  "bonfire",
  // 路燈是街上的東西。
  "lamppost",
  "pine tree",
  "willow",
  "rice paddy",
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
    (body.has("sitting") || body.has("sitting on face"))
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
  "onsen",
  "bath",
  "bathroom",
  "bathtub",
  "shower (place)",
  "bathhouse",
  "ofuro",
  "bubble bath",
]);
const WATER_ACT = new Set(["swimming", "wading", "floating", "fishing", "bathing", "showering", "shared bathing", "diving"]);
// floating 也可以是漂浮在空中，不能單獨替 splashing / washing 類細節證明有水。
const WATER_SOURCE_ACT = new Set([...WATER_ACT].filter((tag) => tag !== "floating"));
const WATER_DETAIL = new Set([
  "partially submerged",
  "splashing",
  "washing hair",
  "washing back",
]);
const BATH_PLACE = new Set([
  "onsen",
  "bath",
  "bathroom",
  "bathtub",
  "shower (place)",
  "bathhouse",
  "ofuro",
  "bubble bath",
  "sauna",
]);
const BATH_ACT = new Set(["bathing", "showering", "shared bathing"]);
// 洗澡**當下**不會穿的東西。isBathOkGarment() 收的是「浴場」的衣服，那對更衣室、
// 洗完、泡湯前後都對，但對「正在洗」太寬 —— 浴袍是洗完才披上的。
//
// Danbooru（分母是該動作的總數）：
//   bathing 18,182   裸 67.2%  towel 28.9%  naked towel 10.6%  wet clothes 1.6%
//                    浴袍 0.1%  浴衣 0.4%  bath yukata 0.2%  褌 0.2%  chemise 0.0%
//   showering 6,606  裸 64.6%  towel 9.5%   浴袍 0.1%
// 整個袍子／和服那一類都在 0.0～0.4%，是同一個現象，所以整類一起處理。
const NOT_WHILE_WASHING = new Set(["bathrobe", "yukata", "bath yukata", "fundoshi", "chemise"]);
function washingNow(used) {
  for (const t of used) if (BATH_ACT.has(t)) return true;
  return false;
}
// steam 掛在 mutex:"weather" 底下，但它不是天氣：Danbooru 上它在室內（15.0%）比在
// 室外（9.0%）多，而且 12.4% 跟 onsen 同框 —— 那是浴場的蒸氣。跟著天氣那格在室外
// 抽出來會擺錯地方，所以它要有自己的場合。
// 分兩檔，因為 Danbooru 上「這個場合有幾成帶蒸氣」差很多：
//   onsen 37.8%、sauna 43.0%、bathing 28.6%、shared bathing 26.7%
//   bathroom 14.3%、bathtub 14.6%
// 熱水池和洗澡間不是同一件事，用一個數字蓋過去會讓浴室霧茫茫。
const STEAM_HOT = new Set([
  "onsen", "sauna", "hot spring", "bathing", "shared bathing", "steaming body",
]);
const STEAM_MILD = new Set([
  "bath", "bathroom", "bathtub", "shower (place)", "bathhouse", "ofuro", "bubble bath",
  "showering", "after bathing",
]);
const STEAM_CTX = new Set([...STEAM_HOT, ...STEAM_MILD]);
// 真正的天氣只在室外。天氣那一格自己有室外判斷，但通用的 fill("env") 在張數調高時
// 也搆得到 mutex:"weather"，那裡沒有任何室內外檢查 —— 實測 seed 3「抽好抽滿」抽出
// 「sauna, indoors, ... fog」，三溫暖裡起霧。所以閘要放在 allow()，兩條路徑一起擋。
// in_out 在 fillSlot("env","in_out") 就定了，排在天氣那格和 fill("env") 前面，
// 所以這裡問得到答案。（Danbooru 佐證：snow 在室內只有 2.1%、cherry blossoms 2.5%。）
const OUTDOOR_WEATHER = new Set(["rain", "overcast", "snow", "fog", "cherry blossoms"]);
// ---------------------------------------------------------------- SFW 模式
// 關掉色情模式之後，哪些字不能出現。
//
// heat 欄位幫不上忙：1304 個字裡有 1092 個都是 ["tease","flash","sex"]，
// 從 blue sky 到 bra 全在同一格。所以這裡另外定一套規則，而且是「留下來的要
// 逐個看過」而不是「擋掉的列一列就算」—— 漏掉一個就是一張不該出現的圖。
//
// 身體「尺寸」是體型描述（large breasts），留著；對身體「做什麼」一律擋。
const SFW_NSFW_RE =
  /\b(nipples?|areolae?|pussy|pussies|penis|testicl|cum\w*|anus|anal|sex|erections?|bulge|masturbat|fellatio|paizuri|cunnilingus|orgasm|ahegao|condoms?|dildos?|vibrators?|bondage|bdsm|rape|molest|groping|lewd|cameltoe|upskirt|downblouse|crotch|cleavage|naked|nude|topless|bottomless|panties|panty|bra|lingerie|underwear|thong|garter|fundoshi|pubic|drool|ejaculat|lactation)\b/i;

// 這幾個字會被上面的規則誤傷，但它們本身不情色：流汗、淋濕、蒸氣。
const SFW_KEEP = new Set(["sweat", "wet", "wet hair", "steam"]);

// regex 抓不到、但一樣不該出現的。
const SFW_EXTRA = new Set([
  // 這兩個本來全年齡就抽得到，但實測帶著 3 倍於基準的成人圖，
  // 語意上也確實是「性感取向」而不是中性 —— 往上挪一層到敏感。
  "biting own lip",      // 3.1x
  "legs up",             // 3.2x
  "thigh gap",
  "mole on breast",
  "wet shirt",
  "spread cleavage",
  "breast focus",
  "pov crotch",
  "collar",
  "leash",
  "pet play",
  "torn clothes",
  "wardrobe malfunction",
  "public indecency",
  "exhibitionism",
  "saliva",
  "heart-shaped pupils",
  "fucked silly",
  "rolling eyes",
  // 實際抽 4320 張之後看出來的漏網：規則對了，但這些字規則抓不到。
  // 透視與極度暴露的衣著
  "see-through shirt",
  "micro bikini",
  "slingshot swimsuit",
  "revealing clothes",
  "tight clothes",
  "microskirt",
  "unbuttoned shirt",
  "wet clothes",
  // 臀部特寫
  "ass",
  "huge ass",
  "ass ripple",
  "grabbing another's ass",
  "hand on own ass",
  // 挑逗的表情與動作
  "naughty face",
  "seductive smile",
  "licking lips",
  "clothes tug",
  "come hither",
  "cheating (relationship)",
  // 全年齡＝連暗示都沒有。這幾個沒有露點，但畫面上讀起來就是性感取向 ——
  // 兩段制的時候它們待在「關掉色情」那一檔，正是那時候會生出
  // 網襪＋極短洋裝＋背向蹲姿的原因。現在它們有 sensitive 可以去。
  "fishnet thighhighs",
  "fishnets",
  "short dress",
  "garter belt",
  "thigh strap",
  "bare shoulders",
  "off shoulder",
]);

// 三段分級，對齊 Danbooru 自己的 rating 階梯。
//
//   general    全年齡：連暗示都沒有
//   sensitive  敏感：性感，但沒有露點、沒有性行為、沒有內衣外穿、沒有走光
//   explicit   色情：現狀
//
// 中間這段是為了解掉一個兩段制解不掉的問題：兩段的時候「關掉色情」同時要
// 負責「乾淨」和「不色情」，結果兩件事都做不好 —— 實測會生出網襪＋極短洋裝＋
// 背向蹲姿的圖，沒有露點卻明顯是性感取向。
//
// group="flash" 這一組混了兩種東西，不能整組處理：
//   掀裙、拉衣、走光、滑落  -> 那是脫衣，只有 explicit 能有
//   彎腰、張腿、跪趴、跨坐  -> 穿著衣服擺姿勢，正是 sensitive 的內容
// 這正是「規則掛錯層級」那條教訓：group 不等於概念。
const FLASH_UNDRESS_RE =
  /\b(lift|pull|aside|slip|undress|flashing|exhibitionism|wedgie|grab|tweak|chikan|nude|spread pussy)\b/i;

// 這些不是暴露，是明講的性 —— 不管穿多少都只能在 explicit。
const EXPLICIT_ONLY_EXTRA = new Set([
  // 2026-09-15 逐字對 Danbooru 的實際 rating 分布查過之後補的。
  // 判準是「相對全站基準的倍率」而不是原始百分比 —— 全站有 20.2% 的圖是 q+e，
  // 所以一個字帶著 20% 成人圖只代表它很普通。第一版直接看百分比，
  // 把 v（比 YA）、head tilt（歪頭）都判成敏感，明顯是被基準騙了。
  //
  // 收進來的只有語意上本來就是「露出／性器／性行為／高潮狀態」的字，
  // 純粹的身體姿勢（spread legs、m legs、straddling、bent over）留在敏感 ——
  // 那些字配上穿著整齊的衣服仍然成立，是不是色情由衣服決定。
  "one breast out",      // 4.9x，字面就是露出來了
  // 2026-09-18 補的四個，全部是這張表當初漏掉的同族。
  //
  // 漏掉的後果看得見：「只勾活動＝日常」那一檔是**借 tease 的池子**再靠
  // hasExplicitContent() 把情色扣掉（見下面 2820 行那段），而這四個掛在
  // feature/body_f，group 看不見、EXPLICIT_RE 也咬不到，於是整批溜進日常。
  // 實測色情分級只勾活動抽 4200 張：breasts out 96 次、grabbing own breast 54、
  // guided breast grab 46、grabbing another's ass 41 —— 面板上那句
  //「沒有走光或做愛」被打臉。
  //
  // 比例照這張表原本的判準量（相對全站 20.2% 基準的倍率）：
  "breasts out",          // 4.89x（e98.7%）—— one breast out 的複數，同一個意思卻漏了
  "guided breast grab",   // 4.85x（e98.0%）
  "grabbing another's ass", // 4.78x（e96.6%）—— 跟已收的 grabbing another's breast 同級
  "grabbing own breast",  // 4.22x（e85.3%）—— 比已收的 hand on own crotch 4.1x 還高
  //
  // **刻意不收**的對照組，它們是形狀不是動作，照這張表的規矩留在敏感：
  //   unaligned breasts 4.15x、breasts apart 3.68x、breast suppress 3.04x、
  //   breast rest 1.96x、arm under breasts 1.63x
  // grabbing another's hair 3.84x 也不收：倍率在範圍內，但抓頭髮本身不是
  // 露出／性器／性行為，收它就等於只看數字不看語意。
  "covering breasts",    // 3.5x，遮胸的前提是沒穿
  "covering crotch",     // 3.9x，同上
  "bulge",               // 4.1x，性器輪廓
  "hand on own crotch",  // 4.1x
  "grinding",            // 5.0x，性行為
  "moaning",             // 5.0x，e98%
  "fucked silly",        // 4.9x，e98%
  "rolling eyes",        // 4.8x，e94%，翻白眼是 ahegao 的一部分
  "aroused",             // 4.5x
  "heavy breathing",     // 3.9x
  // 3.9x
  "see-through shirt",
  "micro bikini",
  "slingshot swimsuit",
  "naked coat",
  "naked jacket",
  "pussy focus",
  "cameltoe",
  "masturbation through clothes",
  "groping",
  "netorare",
  "cheating (relationship)",
  "voyeurism",
  "breastfeeding",
  "used condom",
  "dildo",
  "condom",
]);

// 只有 explicit 能出現：真正的性、裸露、脫衣走光、內衣當外衣。
// explicit 專屬的字眼。比 general 那條窄：cleavage、crotch、彎腰張腿這些
// 「穿著衣服的性感」要留給 sensitive，所以不在這條裡面。
// 字根要吃得下複數與複合字：加了字界的 nipple 配不到 "puffy nipples"，
// 加了字界的 cum 配不到 "cumdrip" —— 兩個都真的漏過。
const EXPLICIT_RE = new RegExp(
  "\\b(nipples?|areolae?|pussy|pussies|penis|testicl|cum\\w*|anus|anal|sex|erections?|" +
    "masturbat|fellatio|cunnilingus|orgasm|ahegao|condom|dildo|vibrator|" +
    "bondage|bdsm|rape|molest|nude|naked|topless|bottomless|panties|panty|bra|" +
    "lingerie|underwear|thong|garter|fundoshi|pubic|ejaculat|lactation|" +
    "upskirt|downblouse|cameltoe)\\b",
  "i"
);

export function explicitOnly(item) {
  if (!item) return false;
  const tag = item.tag;
  if (SFW_KEEP.has(tag)) return false;
  if (item.layer === "skin") return true;
  // 用 group 不用 mutex：ejaculation、cumdrip、masturbation 都是 group="sex"
  // 但 mutex 是 null，寫成 mutex === "sex_act" 的話它們會整批從旁邊走過去
  // 混進 sensitive。這是這個 session 第四次踩到「規則掛錯層級」。
  if (item.group === "sex" || item.mutex === "sex_act") return true;
  // 脫衣動作是 explicit，但「穿著衣服擺姿勢」不是 —— 所以不用 heat 判斷。
  // flash 那一檔的姿勢（彎腰、張腿、跨坐）heat 裡本來就沒有 tease，
  // 拿 heat 當鑰匙會把整個 sensitive 檔位掏空。
  if (item.mutex === "clothes_action") return true;
  if (item.mutex === "underwear_top" || item.mutex === "underwear_bottom") return true;
  if (item.group === "flash" && FLASH_UNDRESS_RE.test(tag)) return true;
  if (EXPLICIT_ONLY_EXTRA.has(tag)) return true;
  if (EXPLICIT_RE.test(tag)) return true;
  return false;
}

// 畫面上真的有什麼，決定這張圖是哪一級 —— 而不是滑桿說了算。
//
// Danbooru 的 rating 是從內容推出來的，WAI 也是照那個對應訓練的。滑桿只代表
// 「我最多接受到哪一級」，不代表「每張都要標到那一級」。兩者混為一談的後果是：
// 滑桿放色情、尺度選「活動」，一張全身穿好、在超市買東西的圖照樣被寫上
// nsfw, explicit —— 那個組合在訓練集裡不存在，模型只能往色情的方向硬拉。
//
// 實測（每格 400 張，六個時代都一樣）：
//   尺度=活動 或 誘惑 -> 100% 的圖沒有任何情色內容，卻都標著 explicit
//   預設尺度（誘惑＋走光＋性愛）-> 29%
//   走光、性愛 -> 0%（這兩個本來就名副其實）
//
// 判準只認畫面上的東西，不碰 heat/gate 那些「能不能抽」的欄位 ——
// 我一開始拿 explicitOnly() 來當判準是錯的：那是閘不是分類器，
// 只要一個字的 heat 沒有 tease 就回 true，連 shopping 都被算成情色內容。
// 這裡用的是 Danbooru 的**內容**階梯，不是本程式的**權限**階梯。兩者不一樣：
//   權限階梯（ratingBlocked / EXPLICIT_RE）說「敏感級不准出現內衣」—— 那是使用者
//   自己訂的門檻，加了字界的 bra 連 sports bra 都算。
//   內容階梯說「看得見內衣 = sensitive，露點與性行為 = explicit」—— 那是訓練集
//   實際的標法，也是這條尾巴要對齊的東西。
// 拿權限階梯當內容判準，穿運動內衣做健身會被標成 explicit。
const EXPLICIT_CONTENT_RE = new RegExp(
  "\\b(pussy|pussies|penis|testicl|cum\\w*|anus|anal|sex|erections?|" +
    "masturbat|fellatio|paizuri|cunnilingus|orgasm|ahegao|fucked|" +
    "rape|molest|groping|ejaculat|lactation|nude|naked|topless|bottomless|" +
    "nipples?|areolae?|pubic|dildos?|vibrators?|condoms?)\\b",
  "i"
);

// 看得出尺度但還沒到露點的：內衣外露、泳裝、透視、乳溝、走光。
const SENSITIVE_CONTENT_RE = new RegExp(
  "\\b(panty|panties|bra|lingerie|underwear|thong|garter|fundoshi|" +
    "bikini|swimsuit|see-through|wet clothes|cleavage|underboob|sideboob|" +
    "cameltoe|upskirt|downblouse|crotch|bulge|revealing)\\b",
  "i"
);

function hasExplicitContent(item) {
  if (!item) return false;
  // sweat / wet / steam 會被字面規則誤傷，沿用既有的例外名單。
  if (SFW_KEEP.has(item.tag)) return false;
  if (item.layer === "skin") return true;
  if (item.mutex === "sex_act" || item.group === "sex") return true;
  if (item.mutex === "clothes_action") return true;
  if (EXPLICIT_ONLY_EXTRA.has(item.tag)) return true;
  // group="flash" 混了脫衣跟穿著衣服擺姿勢，不能整組算。但光看
  // FLASH_UNDRESS_RE 會漏掉 masturbation through clothes、hand on own crotch
  // 這種同屬 flash 卻明確情色的字 —— 實測就出過「masturbation through clothes
  // + fucked silly」被標成 sfw, general 的圖，比原本的問題還糟。
  return EXPLICIT_CONTENT_RE.test(item.tag);
}

function hasSensitiveContent(item) {
  if (!item) return false;
  if (SFW_KEEP.has(item.tag)) return false;
  if (item.mutex === "underwear_top" || item.mutex === "underwear_bottom") return true;
  if (item.group === "flash") return true;
  return SENSITIVE_CONTENT_RE.test(item.tag);
}

// 照畫面推一級出來，再被滑桿壓上限（滑桿是天花板，不是目標）。
export function ratingOfDrawnTags(items, cap) {
  let level = "general";
  for (const it of items) {
    if (hasExplicitContent(it)) { level = "explicit"; break; }
    if (hasSensitiveContent(it)) level = "sensitive";
  }
  const order = { general: 0, sensitive: 1, explicit: 2 };
  return order[level] <= order[cap] ? level : cap;
}

export const RATINGS = ["general", "sensitive", "explicit"];
export const RATING_LABEL = { general: "全年齡", sensitive: "敏感", explicit: "色情" };

export function ratingOf(settings) {
  const r = settings && settings.rating;
  return RATINGS.includes(r) ? r : "explicit";
}

// 某個字在某一級之下能不能出現。
// general 沿用已經逐字審過、實抽 4320 張驗證過的 sfwBlocked()，不重寫。
export function ratingBlocked(item, rating) {
  if (rating === "explicit") return false;
  if (rating === "sensitive") return explicitOnly(item);
  // 全年齡是階梯的最底層，所以「敏感擋掉的，這裡一定也擋」。
  //
  // 以前這兩層各用各的判準：敏感看 explicitOnly()（含 EXPLICIT_ONLY_EXTRA 名單），
  // 全年齡看 sfwBlocked()（字面 regex）。兩邊沒有任何東西保證是階梯，於是
  // netorare、voyeurism、breastfeeding 在敏感被擋、在全年齡卻放行 ——
  // 因為那三個字裡沒有任何一個 regex 認得的詞。實抽 2800 張全年齡的圖，
  // netorare 47 次、voyeurism 72 次。
  //
  // 補名單只能修掉這三個，補階梯才是修掉這一類。
  return sfwBlocked(item) || explicitOnly(item);
}

export function sfwBlocked(item) {
  if (!item) return false;
  const tag = item.tag;
  if (SFW_KEEP.has(tag)) return false;
  if (item.layer === "skin") return true;
  if (item.mutex === "sex_act") return true;
  if (item.group === "flash") return true;
  if (item.mutex === "clothes_action") return true;
  if (item.mutex === "underwear_top" || item.mutex === "underwear_bottom") return true;
  const heat = item.heat && item.heat.length ? item.heat : MIXED_HEATS;
  // 只在 flash/sex 才出現的字，本來就是為了那兩檔而存在的。
  if (!heat.includes("tease")) return true;
  if (SFW_EXTRA.has(tag)) return true;
  // 胸部：mutex=breast_size 是體型，其餘（抓、托、夾、特寫）都擋。
  if (/\bbreasts?\b/i.test(tag) && item.mutex !== "breast_size") return true;
  if (SFW_NSFW_RE.test(tag)) return true;
  return false;
}

// 舊的布林開關還留著給既有呼叫端用：非 explicit 就代表要過濾。
export function sfwOn(settings) {
  return ratingOf(settings) !== "explicit";
}

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
  // 光源那一格裝的多半是「東西」而不是「光的性質」：WAI 會照著畫出一根蠟燭、
  // 一盞吊燈。以前光源幾乎抽不到所以看不出來，改成每張都填之後就露餡了 ——
  // 生出來的圖裡有一根蠟燭立在運動場草地上。這幾樣只能在室內。
  "candle",
  "candelabra",
  "chandelier",
  "fireplace",
  // 天花板燈裝在天花板上，窗光是從窗戶照進「室內」的光 —— 兩個都不可能在戶外。
  // 這兩個是舊有的問題，但光源以前只有 3% 機率抽到所以看不出來；改成每張都填
  // 之後，2400 張裡就有 23 張天花板燈在戶外、75 張人在戶外卻打著窗光。
  "ceiling light",
  "window light",
  // 搬不出去的室內物件。lamp 是桌燈／立燈（不是路燈，路燈是 lamppost），
  // folding screen 是屏風 —— 室內隔間用的。
  //
  // 注意：statue、arch、stone wall 我本來也以為是戶外的，量完才發現它們在
  // 室內完全合理（宮殿大廳的雕像、廳堂的拱門、城堡內側的石牆），所以沒有動它們。
  "lamp",
  "folding screen",
  "piano",
  "clock",
  "birdcage",
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

const FISH_PLACE = new Set(["beach", "ocean", "poolside", "pool"]);
// 煮飯的場地以前有兩份：ACT_PLACE.cooking 一份、placeFitsActs() 裡又寫死一份。
// 釣魚和開車都是共用 FISH_PLACE／DRIVE_PLACE，只有煮飯把清單抄成字面值，所以
// 兩邊會各自漂移 —— 寫實模式走 ACT_PLACE、非寫實模式走那份寫死的，同一個時代
// 能不能煮飯要看模式。合成一份之後就不可能再不同步。
//
// 補 courtyard 是因為古希臘原本一格煮飯的場地都沒有：kitchen 是維多利亞之後才有
// 的場地，castle／palace 又都不屬於古希臘，所以「煮飯」在那個時代是一個連場地都
// 排不進去的活動 —— 開了 lockScene 會被整個刪掉，沒開就畫出一張沒有場地的圖。
// 庭院爐灶補上之後，古希臘、中世紀、古中國都有地方煮飯了（江戶本來就有 castle）。
//
// 古希臘那次只補 courtyard，因為它的 era 不含 modern：現代的抽法一個字都不會變。
// tent / food stall 含 modern，補下去會跟「lockScene 的煮飯就是要在廚房」打架。
// field 不收：曠野生火最弱。
//
// ryokan 是後來為了江戶 × 性愛 × 煮飯才加的。COOK_PLACE ∩ PRIVATE_SEX_PLACE ∩ edo
// 以前是空的：castle 是江戶唯一的煮飯場地但不在私密清單，kitchen 在私密清單
// 但 era 沒有 edo。開了 lockScene 又抽到性愛，釘煮飯的圖 100% 沒有場地。
// 旅館會開飯、era 含 edo、已經在 PRIVATE_SEX_PLACE。它也含 modern，但 lockScene
// 仍會把現代的煮飯換成廚房，所以現代的測試一個字都不會變。不把 courtyard
// 再加進女僕場地：那會讓女僕去運動，見 JOB_PLACE.maid。
const COOK_PLACE = new Set(["kitchen", "castle", "palace", "courtyard", "ryokan"]);
const INDOOR_FURN = new Set(["on bed", "on chair", "office chair", "gaming chair", "swivel chair", "bunk bed", "on couch"]);
// 能坐下來讀書寫字的地方。原本這三組只列了現代的房間，而正常模式下
// 「有 ACT_PLACE 表的活動必須把場地列進去」—— 沒被列到的場地等於做不了那件事。
// 結果是 130 個場地裡有 39 個只配得到一個活動（carrying），73 個配不到 4 個：
// 釘「宮殿」的人有 52% 會拿到平底鍋，因為煮飯是少數列了 palace 的活動。
const DESK_PLACE = new Set([
  "library", "bedroom", "living room", "cafe", "classroom", "office",
  "park bench", "garden", "shrine", "pavilion", "east asian architecture",
  // 住得下人、坐得下來的地方，古今都有
  // 補的是「坐得下來看書寫字的地方」。城堡、大廳、酒館、舞廳、神殿刻意不補 ——
  // 既有測試 "normal studying never castle/beach/onsen" 明講不要在城堡唸書，
  // 那是有意的內容契約，我一開始把 castle 加進來就是把它撞掉了。
  "apartment", "hotel room", "mansion", "palace", "throne",
  "ryokan", "balcony", "courtyard", "futon", "tent",
]);
const HOME_PLACE = new Set([
  "bedroom", "living room", "hotel room", "futon",
  "apartment", "mansion", "palace", "ryokan", "castle",
]);
const MEAL_PLACE = new Set([
  "restaurant", "cafe", "kitchen", "living room", "park", "garden", "beach", "courtyard",
  "apartment", "hotel room", "mansion", "palace", "throne",
  "balcony", "pavilion", "east asian architecture", "rooftop", "tent", "field", "izakaya",
  "castle", "tavern", "ryokan", "ballroom",
]);
// 「活動在某個時代一個場地都排不進去」是結構性的洞：開了 lockScene 會把活動整個
// 刪掉，沒開就畫出一張沒有場地的圖。把活動×時代窮舉一遍，只有四對中獎：古希臘的
// drinking／cooking、中世紀的 singing、維多利亞的 archery —— 前三個的場地清單整份
// 都是現代或日式場地，最後一個只有體育場館（射箭場、體育館、道場）。
// 補的是那個時代真的有的場地：會飲的中庭與柱廊、酒館裡的吟遊、草坪上的射箭。
//
// 這不是放寬規則 —— scripts/test_draw_contracts.mjs 有一條窮舉的守門檢查，
// 任何活動在任何時代只要連半個合時代的場地都排不進去就會紅燈。
export const ACT_PLACE = {
  bathing: new Set([...BATH_PLACE]),
  showering: new Set(["bathroom", "shower (place)"]),
  swimming: new Set(["pool", "ocean", "beach", "underwater"]),
  wading: new Set(["beach", "ocean", "pool", "poolside"]),
  floating: new Set(["pool", "ocean", "bathtub", "ofuro", "onsen", "bubble bath"]),
  "shared bathing": new Set(["onsen", "bathhouse", "ofuro", "bath"]),
  eating: new Set([...MEAL_PLACE, "movie theater", "airplane interior", "convenience store", "izakaya", "festival", "market", "ryokan", "tavern"]),
  drinking: new Set(["cafe", "bar (place)", "restaurant", "kitchen", "living room", "movie theater", "airplane interior", "izakaya", "festival", "market", "ryokan", "tavern", "ballroom", "courtyard", "garden", "balcony", "colonnade", "village"]),
  reading: new Set([...DESK_PLACE, "train", "train interior"]),
  cooking: COOK_PLACE,
  shopping: new Set([
    "street",
    "city",
    "cityscape",
    "fitting room",
    "changing room",
    "convenience store",
    "supermarket",
    "market stall",
    "market",
    "festival",
    "village",
  ]),
  singing: new Set(["living room", "bar (place)", "park", "rooftop", "karaoke box", "church", "shrine", "festival", "ballroom", "ryokan", "colonnade", "tavern", "market", "courtyard", "castle"]),
  karaoke: new Set(["bar (place)", "living room", "karaoke box"]),
  "playing guitar": new Set(["bedroom", "living room", "park", "rooftop", "balcony", "garden"]),
  "playing games": new Set([...HOME_PLACE, "internet cafe"]),
  "playing video games": new Set([...HOME_PLACE, "internet cafe"]),
  "playing sports": SPORT_PLACE,
  studying: DESK_PLACE,
  writing: DESK_PLACE,
  "drawing (action)": new Set(["bedroom", "living room", "classroom", "cafe", "park", "garden"]),
  "painting (action)": new Set(["bedroom", "living room", "garden", "park", "courtyard", "pavilion", "east asian architecture"]),
  dancing: new Set(["living room", "park", "rooftop", "school gym", "bar (place)", "fitness gym", "ballroom", "palace", "colonnade", "ryokan", "festival"]),
  stretching: new Set(["bedroom", "living room", "fitness gym", "park", "rooftop", "beach"]),
  yoga: new Set(["bedroom", "living room", "fitness gym", "park", "rooftop", "beach"]),
  exercising: SPORT_PLACE,
  training: new Set([...SPORT_PLACE, "battlefield", "dojo", "castle", "colonnade"]),
  archery: new Set(["garden", "park", "forest"]),
  fishing: FISH_PLACE,
  camping: new Set(["forest", "park", "bamboo forest", "garden", "ruins", "tent", "river", "field", "cave", "jungle", "rural"]),
  picnic: new Set(["park", "garden", "beach", "forest", "courtyard", "rural", "village"]),
  hiking: new Set(["forest", "park", "bamboo forest", "garden", "mountain", "river", "bridge", "field", "battlefield", "ruins", "colonnade", "cave", "jungle", "rural"]),
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
    "onsen",
    "ryokan",
    "tent",
    "train interior",
    "futon",
    "airplane interior",
    "canopy bed",
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
// 時代招牌場地（castle / east asian architecture）出現在多少比例的圖上。
// 舊行為是無條件蓋章，等於 100%，而且會把唯一的場地格佔滿。
const PLACE_ANCHOR_CHANCE = 0.35;

// 活動定下來之後蓋一個道具上去。每一項是**候選集合**，不是優先序 ——
// stampActProps() 會先用 eraOk／heatOk 篩掉不合的，再從剩下的隨機挑一個。
//
// 早期每一項都只有一個字，於是 12 個活動的道具是 100% 固定的：實測 9600 張，
// 每一張 cooking 都是平底鍋、每一張 cleaning 都是掃把、每一張 writing 都是原子筆。
// 而那個「唯一」在非現代時代還是錯的 —— 江戶抽菸 22/22 拿香菸、古中國寫字
// 50/50 拿原子筆。時代分支靠的是各道具自己的 era 欄（見 merge_lexicon.py），
// 不是寫死在這張表裡：這裡列出所有可能，篩選交給既有的 eraOk。
const ACT_PROP = {
  "playing guitar": ["guitar"],
  reading: ["book", "newspaper"],
  studying: ["book"],
  writing: ["calligraphy brush", "quill", "pen", "pencil"],
  "talking on phone": ["cellphone"],
  selfie: ["cellphone"],
  "taking picture": ["cellphone", "camera"],
  smoking: ["kiseru", "smoking pipe", "cigar", "cigarette"],
  cooking: ["frying pan", "ladle"],
  shopping: ["shopping bag"],
  driving: ["steering wheel"],
  cleaning: ["broom", "mop", "bucket"],
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
  // 女僕原本只有六個場地，而其中 mansion 是維多利亞、palace 是古中國／中世紀，
  // 所以**現代的女僕實際上只有四個地方可去**：釘 maid 抽 3000 張，只看得到
  // living room 1583、hotel room 682、kitchen 641、bedroom 94 —— 一半以上都在客廳。
  // 女僕是很常抽到的一件衣服，每次都長一樣。補完是 9 種、客廳從 53% 降到 34%。
  //
  // 補的都還是「女僕會在的地方」，不是把限制拿掉：走廊（janitor 本來就有它）、
  // 庭園、陽台、溫室、書房。
  //
  // **刻意不補 courtyard**，儘管它看起來跟庭園一樣合理。路徑是這樣的：
  //
  //   1. courtyard 在 SPORT_PLACE 裡（見上面那個 Set），而 playing sports／
  //      exercising／training 的場地清單就是 SPORT_PLACE。
  //   2. 下面 allow() 有一條（搜 actFitsSomePlaces(item.tag, JOB_PLACE.maid)）：
  //      場上有女僕又沒有真正的職業 tag 時，**活動候選**必須至少能在女僕的某個
  //      場地發生。補了 courtyard，這一關對運動活動就變成通過 —— 於是運動活動
  //      開始跟女僕裝一起抽出來。
  //   3. 但那一關**不看時代**。預設時代是現代，而 courtyard 的 era 只有
  //      古中國／古希臘／中世紀。放行的理由（可以在中庭運動）在現代根本不存在，
  //      所以場地那一格誰也排不進去。
  //
  // 實測：補 courtyard 之後釘 maid 的 3000 張裡冒出 178 張運動圖，而且**每一張都
  // 沒有場地**（0 -> 178）。少補這一個就完全沒有這條路。
  maid: new Set([
    "mansion", "kitchen", "living room", "bedroom", "hotel room", "palace",
    "hallway", "balcony", "greenhouse", "library", "garden",
  ]),
  "flight attendant": new Set(["airplane interior", "airport", "cockpit"]),
  firefighter: new Set(["street", "city", "cityscape"]),
  scientist: new Set(["laboratory"]),
  farmer: new Set(["farm", "barn", "rice paddy"]),
  "construction worker": new Set(["construction site"]),
  janitor: new Set(["hallway", "classroom", "office", "hospital", "school gym", "living room"]),
  "race queen": new Set(["stadium", "street", "city"]),
  soldier: new Set(["ruins", "street", "city", "forest"]),
  butler: new Set(["mansion", "living room", "hallway", "ballroom", "palace"]),
  detective: new Set(["office", "street", "city", "cityscape", "alley", "library"]),
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

// 床不是 place，但它就是床。usedPlaces() 只收 mutex==="place"／group==="place"，
// 而 on bed 的 mutex 是 furniture，所以運動器材的場地檢查從**兩個方向**都漏掉它。
// 以前沒人發現，是因為 bicycle 和 on bed 在舊的 env 配額下都抽不到；配額調到 6
// 之後第一次跑就抽出「自行車 + on bed」—— 床上騎腳踏車。
// "on sofa" 在這裡放了很久，但**詞庫裡從來沒有那個字** —— Danbooru 的正規名是
// on couch（on sofa 是它的別名），而我們收的是 couch。也就是說這條防護對沙發
// 一次都沒有生效過。on couch 現在補進詞庫了，這裡跟著指對。
const SPORT_BAD_FURNITURE = new Set(["on bed", "bunk bed", "on couch"]);

function sportPlaceOk(item, used) {
  const placeLike =
    item.mutex === "place" || item.group === "place" || SPORT_BAD_FURNITURE.has(item.tag);
  if (!placeLike) return true;
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
  const places = usedPlaces(used, lex);
  for (const t of used) if (SPORT_BAD_FURNITURE.has(t)) places.add(t);
  return sportIdsFitPlaces(own, places);
}

const PRIVATE_SEX_PLACE = new Set([
  // 廁所隔間沒有對應的活動，所以在一般的場地那一格永遠排不進去（實測 0/4800）。
  // 它的天然用途本來就是私密場景，放這裡才是它該在的地方。
  "toilet stall",
  "bedroom",
  "hotel room",
  "love hotel",
  "bath",
  "bathroom",
  "bathtub",
  "shower (place)",
  "ofuro",
  "onsen",
  "bathhouse",
  "bubble bath",
  "changing room",
  "locker room",
  "living room",
  "kitchen",
  // 上面十六個是照現代想像寫的，十二個是浴室或臥室的變體，一個歷史時代的
  // 場地都沒有 —— 於是 sex heat 一開，古中國／古希臘／中世紀只剩 bedroom
  // 和 bath 各一半，江戶只剩 onsen 和 open-air bath。其他三種 heat 這些時代
  // 都抽得到十四到二十六種場地，落差全出在這張表。
  // east asian architecture 也不收：它是建築外觀的泛稱，不是「能不被打擾」的地方。
  // 試著收過，結果古中國的性愛場地有 44% 都是它（既有測試「沒有單一場地佔掉
  // 三分之一以上」直接紅）—— 這個時代的私密場地本來就少，補一個泛稱就會蓋掉其他的。
  // 收錄標準是「能不被打擾」，所以 market / festival / street / shrine /
  // temple 這類公共場所仍然不在裡面。
  "bed",
  "futon",
  "ryokan",
  "balcony",
  "library",
  "garden",
  "forest",
  "bamboo forest",
  "courtyard",
  "pavilion",
  "ruins",
  "colonnade",
  "pillar",
  "fountain",
  "palace",
  "throne",
  "tavern",
  "dojo",
  "mansion",
  "carriage",
  "greenhouse",
  "ballroom",
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
  if (acts.has("cooking")) return COOK_PLACE.has(place);
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

/**
 * 把一份場地清單收斂成「這個時代真的存在的那些」。
 *
 * 場地清單（JOB_PLACE、ACT_PLACE）都是不分時代寫的，拿它們做可行性判斷時必須先
 * 過這一關，否則會用一個當下根本不存在的場地去證明「有地方可去」。
 */
export function placesInEra(places, lex, era) {
  const out = new Set();
  for (const p of places) {
    const it = lex.byTag.get(p);
    if (it && eraOk(it, era)) out.add(p);
  }
  return out;
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
  // 沒有人披著斗篷游泳。歷史時代一件泳裝都沒有，底下那句 return true 等於
  // 讓整套外衣跟著下水 —— 古希臘有九成七的游泳畫面裹著 himation。
  if (item.mutex === "outer") return false;
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

// 本身就已經含外衣的整套服裝。再疊一件休閒外套就變成兩件外套 ——
// 使用者回報的就是這個：釘了軍服，結果圖裡「military uniform, blue jacket, jacket」。
//
// 實測釘下去之後身上多一件外套的比例：女僕裝 92%、軍服／警服／西裝 75%、
// 婚紗 66%、水手服 66%。不是偶發。
//
// 這裡只收「整套本來就有外衣」或「整套是完整造型」的。洋裝、泳裝、比基尼
// 不在內 —— 洋裝配大衣、比基尼配罩衫都是正常搭配，那一格要留著。
const OUTFIT_HAS_OUTER = new Set([
  "military uniform",
  "police uniform",
  "business suit",
  "suit",
  "tuxedo",
  "gakuran",
  "nun",
  "bathrobe",
  "maid",
  "santa costume",
  "miko",
  "plate armor",
  "japanese armor",
  "chinese armor",
  "leather armor",
  "power armor",
]);

// 整套的時代服裝：底下不該再塞別的時代的上下身衣服。
// 和服配襯衫配裙子不是搭配，是三件不相干的衣服疊在一起（實測釘和服有 32% 配襯衫、
// 26% 配裙子）。值得注意的是這不是時代判斷錯 —— 和服出現在現代場景很正常，
// 廟會就是這樣穿；錯的是**底下那件**。
// 對應的時代寫在值裡，所以同時代的搭配仍然成立（和服配袴、漢服配襦裙）。
const ERA_OUTFIT_ERA = new Map([
  ["kimono", "edo"],
  ["yukata", "edo"],
  ["white kimono", "edo"],
  ["blue kimono", "edo"],
  ["purple kimono", "edo"],
  ["bath yukata", "edo"],
  ["japanese clothes", "edo"],
  ["hanfu", "ancient_china"],
  ["ruqun", "ancient_china"],
  ["tangzhuang", "ancient_china"],
  ["chinese clothes", "ancient_china"],
  ["toga", "ancient_greece"],
  ["chiton", "ancient_greece"],
  ["peplos", "ancient_greece"],
  ["ancient greek clothes", "ancient_greece"],
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

// 需要場合才成立的配件。沒有對應的活動／場地／身分就不該出現。
//
// 以前這些是在 allow() 裡一條一條手寫的 if，寫到哪擋到哪：stethoscope、hard hat、
// police hat、lab coat 有，goggles、swim cap、boxing gloves、microphone 沒有 ——
// 結果辦公室裡有人戴蛙鏡、教堂裡有人拿麥克風、溫泉裡有人戴拳擊手套。
export const NEEDS_CONTEXT = {
  "beach umbrella": new Set(["beach", "poolside"]),
  innertube: new Set(["swimming", "wading", "floating", "pool", "poolside", "beach", "ocean"]),
  goggles: new Set([
    "swimming", "diving", "pool", "poolside", "underwater", "ocean", "skiing",
    "laboratory", "scientist", "construction site", "construction worker",
  ]),
  "swim cap": new Set(["swimming", "diving", "pool", "poolside", "underwater", "ocean"]),
  "boxing gloves": new Set(["boxing", "fitness gym", "stadium", "training", "exercising"]),
  "knee pads": new Set([
    "playing sports", "exercising", "training", "skiing", "basketball", "volleyball",
    "skating", "stadium", "school gym", "fitness gym",
  ]),
  microphone: new Set(["singing", "karaoke"]),
  clipboard: new Set([
    "office", "office lady", "salaryman", "teacher", "classroom", "nurse", "doctor",
    "clinic", "hospital", "laboratory", "scientist", "construction site",
  ]),
  // 這四個是原本手寫規則允許的範圍，原樣搬過來。騎士配頭盔照理也說得通，
  // 但那是擴大行為、不是修這個 bug，這次不動。
  helmet: new Set(["riding bicycle", "skiing", "construction site", "construction worker"]),
  "bicycle helmet": new Set(["riding bicycle", "street", "city", "park", "stadium"]),
  "shoulder armor": new Set([
    "armor", "plate armor", "leather armor", "chinese armor", "japanese armor",
    "knight", "samurai", "gladiator", "viking", "battlefield", "castle",
  ]),
  // 寵物／拘束類的東西要有那個情境，不能當成一般飾品隨便出現
  "animal collar": new Set(["pet play", "leash", "bondage", "bdsm"]),
  leash: new Set(["pet play", "animal collar", "collar", "bondage", "bdsm"]),
  handcuffs: new Set(["bondage", "bdsm", "prison", "policewoman", "police uniform"]),
  "o-ring": new Set(["bondage", "bdsm", "lingerie", "swimsuit", "bikini"]),
  // 桌子底下要先有桌子。少了這條，「under table」會變成傢俱那一格最好填的字
  // （它幾乎不跟任何姿勢衝突），實測佔掉那一格的 64%，還把 on bed 從 8 擠到 3 ——
  // 而且畫面上根本沒有桌子。on desk 同理。
  "under table": new Set(["table", "desk", "poker table", "counter", "kotatsu"]),
  // 我從語料加進來的那批道具，原本一個前提都沒寫，於是它們散落到任何地方 ——
  // 實測 4200 張裡 desk lamp 有 93% 出現在沒有桌子、書房、臥室的場合（它掛在
  // lighting 互斥格，而那一格 100% 的圖都會填，所以它會去照亮海灘和溫泉），
  // nightstand／poker table／sink／steering wheel／whiteboard 更是 100%。
  // 這正是這張表上面 cleats 那條註解在講的同一件事：沒有那個場合就不該出現。
  "desk lamp": new Set(["desk", "on desk", "office", "bedroom", "classroom", "library", "hotel room", "studying", "writing", "reading"]),
  nightstand: new Set(["bedroom", "hotel room", "love hotel", "bed", "on bed"]),
  "poker table": new Set(["casino", "nightclub", "bar (place)"]),
  sink: new Set(["bathroom", "kitchen", "clinic", "hospital"]),
  counter: new Set(["kitchen", "cafe", "bar (place)", "restaurant", "convenience store", "supermarket", "izakaya"]),
  "steering wheel": new Set(["car", "car interior", "driving", "cockpit", "airplane interior", "racing suit"]),
  "shopping cart": new Set(["supermarket", "convenience store", "shopping", "market"]),
  "microphone stand": new Set(["singing", "karaoke", "karaoke box", "bar (place)", "livestream"]),
  whiteboard: new Set(["classroom", "office", "teacher", "laboratory", "studying"]),
  "christmas tree": new Set(["christmas", "winter", "living room"]),
  "on desk": new Set(["desk", "table", "classroom", "office", "whiteboard"]),
  // 沙發要有個放沙發的地方。這一格六個字裡，on bed 有 BED_PLACE、bunk bed 要
  // 臥室或旅館房間、on desk 與 under table 有這張表、on chair 有一串動作衝突 ——
  // 只有 on couch 什麼前提都沒有，於是它在傢俱這一格佔到 53～57%，
  // 剛好在稽核那條 55% 集中度上下翻面。補上前提之後跟其他五個對稱。
  //
  // 名單取「會擺沙發的室內場所」。Danbooru 上 couch 有 77,265 張但只有 866 張
  // 同時標 living room —— 那是因為多數沙發圖根本沒標房間，不是沙發不在客廳，
  // 所以這裡按語意列，不按共現率剪。
  "on couch": new Set([
    "living room", "hotel room", "love hotel", "apartment", "mansion",
    "cafe", "bar (place)", "office", "internet cafe", "karaoke box",
    "nightclub", "casino", "movie theater", "clinic", "ryokan",
  ]),
  shibari: new Set(["bondage", "bdsm", "restrained"]),
  "bound wrists": new Set(["bondage", "bdsm", "restrained", "handcuffs"]),
  "ball gag": new Set(["bondage", "bdsm", "restrained"]),
  "nipple clamps": new Set(["bondage", "bdsm", "restrained"]),
  "remote control vibrator": new Set(["bondage", "bdsm", "restrained", "sex toy", "vibrator"]),

  // 衣服也適用同一條規則。這張表本來只收配件，但「沒有那個場合就不該出現」
  // 跟它是配件還是衣服無關 —— 實測釘女僕裝會配到足球釘鞋 33%，全庫 2800 張裡
  // cleats 出現 274 次而其中 90% 身上沒有任何運動場合。
  // 與其另開一張衣服專用的表，不如把這張表的名字改對（本來就沒有濾 layer）。
  cleats: new Set([
    "playing sports", "exercising", "training", "soccer", "track and field",
    "baseball", "jogging", "stadium", "sports court", "running track",
    "school gym", "fitness gym", "field",
  ]),
  "swim briefs": new Set(["swimming", "diving", "pool", "poolside", "ocean", "beach", "underwater"]),
  "gym uniform": new Set([
    "playing sports", "exercising", "training", "school gym", "stadium",
    "sports court", "running track", "fitness gym",
  ]),
  "track uniform": new Set([
    "track and field", "jogging", "running track", "stadium", "playing sports",
    "exercising", "training", "school gym",
  ]),

  // 三把傘原本是 allow() 裡各自一行的 if。但傘要看的天氣和場地都排在衣服後面才填，
  // 在 allow() 問「有沒有下雨」永遠是沒有 —— 三個字於是全部抽不到。實測 rain 自然
  // 出現 65/600 張而 umbrella 0 次，把 rain 釘起來（釘選在衣服之前就進 used）立刻
  // 變 29 次。這就是上面那段註解在講的同一個坑，跟 animal collar、leash、clipboard
  // 那一輪一模一樣，只是這三個當時沒搬乾淨。
  //
  // 場合集合原樣沿用舊的手寫規則，不趁機擴大 —— 擴大是另一件事，不是修這個 bug。
  umbrella: new Set(["rain", "overcast"]),
  parasol: new Set(["beach", "garden", "park", "poolside"]),
  "beach umbrella": new Set(["beach", "poolside", "ocean"]),
};

// 上面那張表只做了負向的一半：沒有場合就刪掉。
// 少了正向的一半，配件就只能靠「瞎抽剛好碰上場合」存活 —— 實測釘住 pet play
// 抽 400 張，leash 出現 0 次；釘 boxing，拳擊手套 4 次；釘 armor，肩甲 0 次。
// 對照 microphone 釘 singing 是 400/400，因為 ACT_PROP 會在活動定下來之後
// 把麥克風拉進來。負向擋、正向拉，兩半要齊。
//
// 只收「有那個場合就幾乎一定有那個東西」的配對，而且是擲骰子不是必定 ——
// stampActProps() 無條件蓋章正是之前宮廷裡 52% 都在拿平底鍋的原因。
export const CTX_PULLS_ACC = [
  ["pet play", "animal collar", 0.8],
  ["pet play", "leash", 0.4],
  ["bondage", "handcuffs", 0.4],
  ["bondage", "shibari", 0.45],
  ["bondage", "bound wrists", 0.35],
  ["bdsm", "ball gag", 0.3],
  ["bdsm", "nipple clamps", 0.2],
  // 這一條是補漏：remote control vibrator 有 NEEDS_CONTEXT 擋著卻沒有任何正向拉取，
  // 於是兩邊都是 0 —— 正是上面那段註解在講的「只擋不拉，出現率就是零」。
  ["restrained", "remote control vibrator", 0.25],
  ["boxing", "boxing gloves", 0.85],
  ["playing sports", "knee pads", 0.25],
  ["riding bicycle", "bicycle helmet", 0.45],
  ["armor", "shoulder armor", 0.5],
  ["plate armor", "shoulder armor", 0.5],
  // Danbooru 實測：標了 rain 的圖有 31.9% 同時有 umbrella（15,598／48,876），
  // 跟 knee pads 0.25、bicycle helmet 0.45 同一個量級，照量到的數字給 0.3。
  ["rain", "umbrella", 0.3],
];

// 運動的器材。跟 CTX_PULLS_ACC 同一件事，但**不能**放進那張表 —— 那個迴圈外面
// 包著 `clothBudget > 0`（配件屬於衣服，使用者把服裝設成 0 就是不要衣服），
// 而球拍是 env、跟衣服的額度無關：全裸打網球一樣該有球拍。
//
// 修之前釘住運動抽 300 張的實測，器材幾乎不存在：
//
//   tennis        球拍 2、球 3        soccer      球 6
//   badminton     球拍 5、羽球 2      golf        球桿 3、球 7
//   table tennis  球拍 5、球 2        archery     弓 3
//
// 也就是 300 張網球圖裡有 298 張沒有球拍。原因跟天氣、光源、傢俱當初一樣：
// 器材在詞庫裡，但只能在通用的 fill("env") 裡跟三百多個字搶剩餘配額。
// 那三格是補專屬的 fillSlot，這裡不行 —— 器材是「這個運動的」而不是「每張圖
// 都該有一個」，所以走 CTX_PULLS_ACC 那種「有場合才拉」的形式。
//
// 機率全部取自 Danbooru 共現率，跟 rain -> umbrella 那條同一套作法：
export const CTX_PULLS_GEAR = [
  ["table tennis", "table tennis paddle", 0.9],   // 560/605
  ["archery", "bow (weapon)", 0.88],              // 1722/1947
  ["tennis", "tennis racket", 0.79],              // 728/926
  ["golf", "golf club", 0.79],                    // 279/355
  ["badminton", "badminton racket", 0.78],        // 130/167
  ["soccer", "soccer ball", 0.51],                // 950/1874
  ["table tennis", "table tennis ball", 0.51],    // 306/605
  ["tennis", "tennis ball", 0.47],                // 438/926
  ["badminton", "shuttlecock", 0.41],             // 68/167
  ["golf", "golf ball", 0.28],                    // 99/355
];

// 沒有收進上表的：clipboard、o-ring，以及 beach umbrella 和 parasol。
// 後兩個量過：beach -> beach umbrella 只有 8.8%（11,711／133,200），
// garden -> parasol 2.0%、park -> parasol 0.3%。海灘不代表有遮陽傘，公園不代表有陽傘 ——
// 硬拉只是為了讓數字不是 0，跟下面這兩個的理由一樣。
// 辦公室不代表有寫字板，比基尼不代表有 O 環 —— 那是我自己想出來的關聯，不是那個
// 場合本來就有的東西。硬收進來只是為了讓數字不是 0，那是在替指標作答。
// 代價是這兩個字現在幾乎抽不到（4320 張裡各 1 次）。這是刻意的：它們以前是
// 「沒場合也會出現」，現在是「有場合才出現、而那個場合很少」—— 後者才是對的。

const SCENE_BAD_ACC = {
  office: /\b(police hat|nurse cap|hard hat|helmet|stethoscope|innertube|beach umbrella)\b/,
  school: /\b(police hat|nurse cap|hard hat|helmet|stethoscope|innertube|beach umbrella)\b/,
  nurse: /\b(police hat|hard hat|helmet|innertube|beach umbrella)\b/,
  maid: /\b(police hat|nurse cap|hard hat|helmet|stethoscope|innertube|beach umbrella)\b/,
  police: /\b(nurse cap|hard hat|helmet|stethoscope|innertube|beach umbrella)\b/,
  kitchen: /\b(innertube|beach umbrella|hard hat|police hat|nurse cap|helmet)\b/,
  swim: /\b(necktie|bowtie|microphone|clipboard|hard hat|helmet|police hat|nurse cap|stethoscope)\b/,
  // 沙灘／池畔／海邊（sceneClothKind 叫它 "shore"）原本**整個沒有條目** ——
  // accessoryOkForKind() 查不到 kind 就直接放行，於是海邊什麼配件都能戴。
  // 以前看不出來，是因為 necktie／bowtie 這些字的 mutex 是空的、在 normal
  // 模式根本抽不到；補上互斥格之後第一次跑就抽出「沙灘 + 領帶」。
  // 沿用 swim 的名單：海邊可以穿著衣服，但辦公室和工地的東西不該出現。
  shore: /\b(necktie|bowtie|microphone|clipboard|hard hat|helmet|police hat|nurse cap|stethoscope)\b/,
  bath: /\b(necktie|bowtie|police hat|nurse cap|hard hat|helmet|stethoscope|microphone|clipboard|innertube|beach umbrella|umbrella|high heels)\b/,
};

// 泡澡與游泳的配件改用白名單。
//
// 原本 SCENE_BAD_ACC.bath 是一份 13 樣的黑名單，於是沒被列到的東西全部從洞裡
// 走過去：600 張溫泉圖裡 collar 428 次、gloves 275、goggles 195、baseball cap 147，
// 還有拳擊手套和寵物項圈 —— 泡溫泉戴著手套、棒球帽和項圈。
//
// 黑名單在這裡註定有洞：配件有 79 個，而「下水時會脫掉什麼」是開放集合。
// 白名單是封閉的：只留真的會戴著下水的東西（綁起來的頭髮、戒指耳環、眼鏡、毛巾）。
// 使用者自己釘的配件不受影響 —— allow() 與場景掃描都有 pinned 例外。
const BATH_OK_ACC = new Set([
  "barefoot",
  "towel",
  // 泡湯把頭髮盤起來，這幾樣正是拿來盤頭髮的
  "hair ornament",
  "hairpin",
  "hair stick",
  "kanzashi",
  // 戒指耳環多半不會為了泡澡特地拔掉
  "ring",
  "wedding ring",
  "earrings",
  "stud earrings",
  "hoop earrings",
  "glasses",
]);

// 游泳多了泳具；泡澡不該有蛙鏡和泳帽。
const SWIM_OK_ACC = new Set([...BATH_OK_ACC, "goggles", "swim cap", "innertube"]);

function accessoryOkForKind(item, kind) {
  if (!item || item.layer !== "accessory") return true;
  if (kind === "bath") return BATH_OK_ACC.has(item.tag);
  if (kind === "swim") return SWIM_OK_ACC.has(item.tag);
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
  "hand on own hip",
  "hands on own breasts",
  "hand in pocket",
  "index fingers together",
  "beckoning",
]);
const LIE_BODY = new Set(["lying", "on back", "on stomach", "on side", "reclining"]);
const LEG_EXTRA = new Set(["crossed legs", "legs up", "m legs", "leg lift"]);
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
  "playing games",
  "playing video games",
  "recording",
  "smoking",
  "driving",
  "riding bicycle",
  "washing back",
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
  "hand on own hip",
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

// 「同一個人」要鎖住的另一半。
//
// identityPins() 只把第一張抽到的身分特徵釘起來，於是第一張沒有的欄位在後面幾張
// 仍然是空的、可以自由補 —— 實測 960 批裡有 685 批，第三張突然多了一撮呆毛、
// 一個馬尾，或是整個人變得肌肉發達。第一張的特徵一次都沒掉（0 次），
// 問題從頭到尾是「多出來」。
//
// 同一個人就是同一個人：身分特徵要剛好等於第一張那一組，多的一律不准。
// 被釘選連帶帶出來的父標籤已經在 pins 裡，所以不會誤禁到它們。
export function identityBans(lex, positive) {
  const keep = identityPins(lex, positive);
  const out = new Set();
  for (const item of lex.data.tags) {
    if (!isIdentityItem(item)) continue;
    if (keep.has(item.tag)) continue;
    out.add(item.tag);
  }
  return out;
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
  // 時代組合。每一組自己帶 era：單一時代是使用者的硬選擇，會贏過有衝突的釘選
  // （契約見 chooseEra() 的註解），所以不能指望「釘了武士就自動變江戶」——
  // 按鈕按下去時要把時代一起套進設定，否則會畫出現代廚房裡的武士。
  // 身分＋場地兩個字就夠，其餘讓它自己抽，才不會每次按下去都長一樣。
  { id: "samurai", name: "武士", tags: ["samurai", "dojo"], era: ["edo"] },
  { id: "ninja", name: "忍者", tags: ["ninja", "bamboo forest"], era: ["edo"] },
  { id: "oiran", name: "花魁", tags: ["oiran", "ryokan"], era: ["edo"] },
  { id: "knight", name: "騎士", tags: ["knight", "castle"], era: ["medieval"] },
  { id: "gladiator", name: "角鬥士", tags: ["gladiator", "colonnade"], era: ["ancient_greece"] },
  { id: "battlefield", name: "戰場", tags: ["battlefield", "banner"], era: ["ancient_china", "medieval", "edo"] },
  { id: "hanfu", name: "漢服庭園", tags: ["hanfu", "courtyard"], era: ["ancient_china"] },
  { id: "palace", name: "宮廷", tags: ["princess", "palace"], era: ["ancient_china", "medieval"] },
  { id: "ballroom", name: "維多利亞舞會", tags: ["ballroom", "evening gown"], era: ["victorian"] },
  { id: "witch", name: "女巫", tags: ["witch", "forest"], era: ["medieval", "victorian"] },
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
    if (!it) continue;
    // 兩種都要收：會動的活動，以及 sleeping 這種不是 activity 的身體姿勢。
    // 只看 mutex==="activity" 的話，睡著就會變成無聲歸零。
    if (it.mutex === "activity" && MOVE_ACT.has(t) && !SEX_OK_ACTIVITY.has(t)) blocking.push(t);
    else if (SEX_BLOCKING_BODY.has(t)) blocking.push(t);
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
    if (h === "activity") {
      // 詞庫裡**沒有任何**一個字的 heat 含 "activity"（實測 337 件衣服、355 個
      // 姿勢、295 個特徵全都沒有），所以「活動」這一檔本來就只能借 tease 的池子。
      // 但整池照收就把面板上那句「只勾活動＝日常，沒有走光或做愛」變成假的：
      // 只勾活動抽 1200 張，naked coat 90 次、netorare 5 次、groping 6 次、
      // paizuri gesture 4 次、pink nipples 25 次。
      //
      // 所以借池子照借，情色內容扣掉 —— 短裙去買菜沒問題，裸身外套去買菜不是日常。
      if (!hs.includes("tease") && !hs.includes("activity")) return false;
      // 裸體是例外，要放行。泡溫泉、洗澡本來就沒穿衣服，那是場景決定的，不是尺度 ——
      // 場景那一套（sceneClothKind / 浴場脫衣）已經在管什麼時候該裸。
      // 我第一版把 layer=skin 一起擋掉，結果「正常模式 溫泉 活動」變成 0/80 永遠不裸，
      // 被既有測試抓到。擋的應該是「日常不會發生的事」，不是「沒穿衣服」。
      if (item.layer === "skin") return true;
      return !hasExplicitContent(item);
    }
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

// 這個活動在這個時代有沒有「私密又合時代」的場地。性愛熱度平常只准
// PRIVATE_SEX_PLACE；交集為空時（購物的場館全是大街、網球只有球場）
// 釘住該活動會 100% 沒場地。allow() 那一關拿這個判斷要不要放行 ACT_PLACE。
function actHasPrivatePlace(act, era, lex) {
  const set = ACT_PLACE[act];
  if (!set) return false;
  for (const p of set) {
    if (!PRIVATE_SEX_PLACE.has(p)) continue;
    const it = lex.byTag.get(p);
    if (it && eraOk(it, era)) return true;
  }
  return false;
}

// 這個職業在這個時代的場地是不是「有地方可去、而且全是公開性愛場地」。
// 場上有職業時，性愛會擋掉 PUBLIC_SEX_PLACE；消防員的清單全是大街，
// 擋完就 100% 沒場地。偵探有辦公室，不是這個洞，不能放行。
function jobHasOnlyPublicPlaces(job, era, lex) {
  const set = JOB_PLACE[job];
  if (!set) return false;
  let any = false;
  for (const p of set) {
    const it = lex.byTag.get(p);
    if (!it || !eraOk(it, era)) continue;
    any = true;
    if (!PUBLIC_SEX_PLACE.has(p)) return false;
  }
  return any;
}

// 職業場地全是室外時，室內專用姿勢（胸壓桌／玻璃）會先佔場，場地格再填
// 就 100% 空。allow() 本來就擋「已經有 outdoors」的這兩個姿勢；釘消防員時
// outdoors 是場地暗示進來的，場地還沒抽，這一關看不見。
function jobHasOnlyOutdoorPlaces(job, era, lex) {
  const set = JOB_PLACE[job];
  if (!set) return false;
  let any = false;
  for (const p of set) {
    const it = lex.byTag.get(p);
    if (!it || !eraOk(it, era)) continue;
    any = true;
    if (INDOOR_ROOM.has(p)) return false;
  }
  return any;
}

// 職業場地全是室內時才擋 outdoors。舊寫法是「清單裡有一個室內就擋」，
// 偵探同時有辦公室和大街，抽菸／騎車只能去街上，街上 implies outdoors，
// 場地格就空了（實測 tease 14/40）。OL 只有辦公室，仍然擋。
function jobHasOnlyIndoorPlaces(job, era, lex) {
  const set = JOB_PLACE[job];
  if (!set) return false;
  let any = false;
  for (const p of set) {
    const it = lex.byTag.get(p);
    if (!it || !eraOk(it, era)) continue;
    any = true;
    if (!INDOOR_ROOM.has(p)) return false;
  }
  return any;
}

function jobHasSleepPlace(job, era, lex) {
  const set = JOB_PLACE[job];
  const sleepAt = ACT_PLACE.sleeping;
  if (!set || !sleepAt) return false;
  for (const p of set) {
    if (!sleepAt.has(p)) continue;
    const it = lex.byTag.get(p);
    if (it && eraOk(it, era)) return true;
  }
  return false;
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
        // 這張表以前寫死在這裡，跟詞庫的 castWeights 各走各的 —— 補了詞庫那邊的
        // 「一女兩男」之後，勾純性愛照樣抽不到兩男，因為走的是這張寫死的。
        // 現在以詞庫為唯一來源，找不到才退回 mixed。
        table = lex.data.castWeights.sex || table;
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
  // 單一時代是使用者的硬選擇，贏過有衝突的釘選 —— 這條有測試在守
  // （"exclusive medieval beats bikini pin for era"）。所以「釘武士就變江戶」
  // 不能走這裡實作，得由組合按鈕自己帶時代（BUILTIN_PRESETS 的 era 欄位）。
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
  const rating = ratingOf(settings);
  const sfw = rating !== "explicit";
  const blockedByRating = (item) => ratingBlocked(item, rating);
  // 釘選會繞過 allow()（forcePin 就是為了「使用者說了算」而存在的），所以光在
  // allow() 擋是不夠的：關掉色情模式之前釘的 nude、sex 會原封不動留在圖上，
  // 實測 60/60。關掉色情模式時，這些釘選一律當作不存在 —— 這是整個模式的
  // 保證，不能有例外。使用者原本的釘選沒有被改掉，重新打開就回來了。
  if (sfw) {
    const cleaned = new Set();
    for (const t of pinned) {
      if (!blockedByRating(lex.byTag.get(t))) cleaned.add(t);
    }
    pinned = cleaned;
  }
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
    // 關掉色情模式：情色的字一個都不准進場。放在最前面，後面所有補救邏輯
    // （浴場補衣、上衣補下著、必抽）也都走 allow，所以不會有人從側門把它們塞回來。
    if (sfw && blockedByRating(item)) return false;
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
    // shota 不進自動抽牌，只有明確釘選才留。
    //
    // 這條原本寫成「shota 與 adult 互斥」，而 adult 是無條件塞進每一張圖的，
    // 所以效果就是 shota 永遠抽不到（實測 8400 張 0 次）。2026-09-18 拿掉 adult
    // （Danbooru 上是 0 張、模型沒把它當 tag 學過）之後，那個效果會連帶消失 ——
    // 這裡把它改寫成直接的規則，行為一格都不動，只是不再靠一個死字繞一圈。
    if (item.tag === "shota" && !pinned.has(item.tag)) return false;
    if (
      (item.mutex === "clothes_action" || item.group === "flash") &&
      actionFitsWorn(item) === 0
    ) {
      return false;
    }
    // 這一關是給動作用的（needsBodyClothes 的參數就叫 actionTag）：掀裙子要先有裙子。
    // 但那條 /through clothes/ 正規表達式也會抓到衣服，而衣服不必再去找一件自己。
    // bra visible through clothes 的 garment key 就是 bra，於是它被要求身上另外有
    // 一件 bra —— 可是所有的 bra 都跟它搶同一個 underwear_top 格：先有 bra 就沒
    // 格子，沒 bra 就不給進。它是 underwear_top 十個字裡唯一抽不到的那個（實測
    // 0/1500；把剛好不佔格的 bra 釘起來才變 79/800，釘 sports bra 佔走格子又回到 0）。
    //
    // 它真正需要的是「身上有衣服可以透出來」，那就是 wearsBodyClothes()。隔壁的
    // see-through clothes 沒有 garment key，本來走的就是這條路 —— 詞庫裡只有這兩個
    // 衣服會被那條正規表達式抓到，所以這個例外只影響這一個字。
    const selfIsTheGarment = item.section === "clothing";
    if (
      needsBodyClothes(item.tag) &&
      ((!selfIsTheGarment && actionFitsWorn(item) === 0) || !wearsBodyClothes())
    ) {
      return false;
    }
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
      item.tag === "one eye closed" ||
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
            t === "one eye closed" ||
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
    // 正午的篝火、白天的街燈。天生對稱：光源先進場或白天先進場都擋得住。
    if (DARK_LIGHT.has(item.tag) && [...used].some((t) => DAY_MARK.has(t))) return false;
    if (DAY_MARK.has(item.tag) && [...used].some((t) => DARK_LIGHT.has(t))) return false;
    if (heat === "flash" && item.tag === "sleeping" && !pinned.has("sleeping")) return false;
    if (used.has("sleeping") && SLEEP_BAD_POSE.has(item.tag)) return false;
    if (item.tag === "sleeping" && [...used].some((t) => SLEEP_BAD_POSE.has(t))) return false;
    if (used.has("sleeping") && SLEEP_BAD_EXPR.has(item.tag)) return false;
    if (item.tag === "sleeping") {
      if ([...used].some((t) => lex.byTag.get(t)?.mutex === "gaze" || /^looking /.test(t) || t === "kiss")) {
        return false;
      }
    }
    if (used.has("sleeping")) {
      if (item.mutex === "gaze" || /^looking /.test(item.tag) || item.tag === "kiss") return false;
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
      (item.tag === "sitting on face" || item.tag === "sitting")
    ) {
      return false;
    }
    if (
      (item.tag === "jogging" || item.tag === "skiing" || item.tag === "hiking") &&
      (used.has("sitting on face") || used.has("sitting"))
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
    if (item.tag === "washing back" && used.has("on stomach")) return false;
    if (item.tag === "on stomach" && used.has("washing back")) return false;
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
    if (item.tag === "breasts on table" || item.tag === "breasts on glass") {
      const listed = [...usedJobs(used, lex)].filter((j) => JOB_PLACE[j]);
      if (listed.length > 0 && listed.every((j) => jobHasOnlyOutdoorPlaces(j, era, lex))) return false;
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
    if (
      item.tag === "bunk bed" &&
      // kids room 不在詞庫裡，Danbooru 上也是 0 張 —— 懸空的條件，拿掉。
      ![...used].some((t) => t === "bedroom" || t === "hotel room")
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
    // 這兩個是 env prop，而且 mustDraw 跑在一般場景 fill 之前。只靠最後的
    // NEEDS_CONTEXT cleanup 不夠：mustDraw 會把抽中的字鎖住，錯場也不能刪。
    // 因此在已釘／已選的水域情境不存在時，候選階段就不讓它們進池。
    if (
      (item.tag === "beach umbrella" || item.tag === "innertube") &&
      ![...used].some((t) => NEEDS_CONTEXT[item.tag].has(t))
    ) {
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
    // 整套制服已經自帶外衣，不要再疊第二件。使用者明確釘的不受影響。
    if (item.group === "outer" && !pinned.has(item.tag)) {
      for (const t of used) {
        if (OUTFIT_HAS_OUTER.has(t)) return false;
      }
    }
    // 整套的時代服裝底下，不要塞別的時代的上下身衣服。
    // 同時代的照樣可以（和服配袴），所以比的是時代不是「有沒有穿」。
    if (!pinned.has(item.tag)) {
      // 外衣也算：和服該配羽織，不是配現代夾克（羽織是 edo，所以照樣過得去）。
      const slot = bodyGarmentSlot(item) || (item.group === "outer" ? "outer" : null);
      if (slot === "top" || slot === "bottom" || slot === "outer") {
        for (const t of used) {
          const era0 = ERA_OUTFIT_ERA.get(t);
          if (!era0) continue;
          const eras = item.era || [];
          // era:["any"] 是「每個時代都能用」，不是「哪個時代都不屬於」。
          // 少了這一句，topless female / topless male / bottomless（都是 any）
          // 會在和服、漢服、托加在場時被擋掉 —— 但「和服褪到腰間」是正常的畫法，
          // 那三個字講的是身體狀態，本來就跟時代無關。
          if (eras.includes("any")) continue;
          if (!eras.includes(era0)) return false;
        }
      }
    }
    if (item.tag === "police hat" && !used.has("policewoman") && !used.has("police uniform")) return false;
    if (item.tag === "nurse cap" && !used.has("nurse")) return false;
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
    // 場地在 fillSlot("env","place") 就定了，排在天氣那一格前面，所以這條問得到答案，
    // 放 allow() 是對的（而不是事後刪除）—— 這樣天氣那一格也不會把名額浪費在
    // 一個注定要被刪掉的 steam 上。
    if (item.tag === "steam" && ![...used].some((t) => STEAM_CTX.has(t))) return false;
    // 時代符號最多三個。以前這件事是靠 env 配額小而「隱性」成立的 —— 配額從 4 放到
    // 6 之後，中世紀 300 張裡有 28 張塞了四個以上（城堡＋火把＋掛毯＋旗幟…），
    // 整張圖變成年代符號展示。既有測試「不會塞一整排時代字」抓到的就是這個。
    //
    // **現代不套這條。** 在現代，「時代專屬」等於「現代的東西」：283 個 env 裡有 120 個
    // 掛著 era:["modern"]，而中性的只有 70 個。枕頭和鏡子不是年代符號，拿同一把尺去量
    // 等於把現代的道具整批壓回三個，剛剛放寬的配額又被自己收回去 —— 實測就是這樣，
    // 高爾夫球桿、籃球那批運動器材又變回抽不到。
    // 那條既有測試自己也只跑中世紀，註解還寫著「現代不該被硬塞（它本來就有一堆專屬場地）」。
    if (item.section === "env" && era !== "modern" && eraSpecific(item, era)) {
      let n = 0;
      for (const t of used) {
        const it = lex.byTag.get(t);
        if (it && it.section === "env" && eraSpecific(it, era)) n += 1;
      }
      if (n >= 3) return false;
    }
    if (OUTDOOR_WEATHER.has(item.tag) && used.has("indoors") && !used.has("outdoors")) return false;
    if (item.tag === "wading" && (used.has("legs up") || used.has("m legs"))) return false;
    if ((item.tag === "legs up" || item.tag === "m legs") && used.has("wading")) return false;
    if (
      (item.tag === "swimming" || item.tag === "diving") &&
      (used.has("legs up") || used.has("m legs") || used.has("leg lift") || used.has("on chair"))
    ) {
      return false;
    }
    if (
      (item.tag === "legs up" ||
        item.tag === "m legs" ||
        item.tag === "leg lift" ||
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
    if (item.tag === "sitting on face" && used.has("on chair")) return false;
    if (item.tag === "on chair" && used.has("sitting on face")) return false;
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
    if (item.tag === "facing away" && (used.has("one eye closed") || used.has("selfie") || used.has("looking at viewer"))) return false;
    if ((item.tag === "one eye closed" || item.tag === "selfie" || item.tag === "looking at viewer") && used.has("facing away")) {
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
      (item.tag === "one eye closed" || EYE_EXTRA.has(item.tag) || item.tag === "clenched teeth" || item.tag === "fucked silly")
    ) {
      return false;
    }
    if (
      item.tag === "expressionless" &&
      (used.has("one eye closed") ||
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
      if (item.section === "clothing") {
        // 「只穿一件」：兩個方向都要擋，因為服裝那一段的填入順序不固定。
        if (NAKED_ONLY.has(item.tag)) {
          for (const t of used) {
            const it = lex.byTag.get(t);
            if (it && it.section === "clothing" && BODY_WORN_GROUP.has(it.group)) return false;
          }
        } else if (BODY_WORN_GROUP.has(item.group)) {
          if ([...used].some((t) => NAKED_ONLY.has(t))) return false;
        }
        // 只穿內衣：外套、上衣、下身、整套、時代服裝與袖子描述都不能並存。
        if (item.tag === "underwear only") {
          for (const t of used) {
            if (underwearOnlyClash(lex.byTag.get(t))) return false;
          }
        } else if (used.has("underwear only") && underwearOnlyClash(item)) {
          return false;
        }
        // 泳衣與內衣二選一。
        if (isSwimGarment(item)) {
          for (const t of used) {
            if (lex.byTag.get(t)?.group === "underwear") return false;
          }
        } else if (item.group === "underwear") {
          if ([...used].some((t) => isSwimGarment(lex.byTag.get(t)))) return false;
        }
      }
      // 傢俱：室內才有，而且人得在上面 —— 站著的人不會「在沙發上」。
      // 這一格從 pose 搬到 env 之後就漏掉了姿勢相容檢查，而通用的 fill("env")
      // 也不管室內外（基準線裡 24 張有傢俱的圖，8 張是室外、4 張配站姿）。
      if (item.mutex === "furniture") {
        if (used.has("outdoors")) return false;
        if ([...used].some((t) => UPRIGHT_BODY.has(t))) return false;
      }
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
      // 辦公室／大街都不在睡覺場地裡。自動抽睡著會讓釘偵探／OL 的場地格空掉。
      // 明確釘睡著仍可自相衝突。清潔工的客廳在清單裡，還是可以睡。
      if (item.tag === "sleeping" && !pinned.has("sleeping")) {
        const listed = [...usedJobs(used, lex)].filter((j) => JOB_PLACE[j]);
        if (listed.length > 0 && listed.every((j) => !jobHasSleepPlace(j, era, lex))) return false;
      }
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
        (item.tag === "breasts on table" || item.tag === "breasts on glass") &&
        !pinned.has(item.tag)
      ) {
        // 這兩個構圖會把後續場地限制為室內。若場上的職業／活動只剩戶外交集，
        // 先收下它們會讓 place 池變空（例如 detective + taking picture 只交集 street）。
        // 自動特徵應讓路；使用者明確釘選仍由上面的 pinned 例外保留。
        const jobs = usedJobs(used, lex);
        const acts = usedActs(used, lex);
        const places = usedPlaces(used, lex);
        const currentPlaceWorks =
          places.size > 0 && [...places].some((place) => INDOOR_ROOM.has(place));
        const canStillPickIndoorPlace = lex.bySection.env.some(
          (candidate) =>
            (candidate.mutex === "place" || candidate.group === "place") &&
            INDOOR_ROOM.has(candidate.tag) &&
            !banned.has(candidate.tag) &&
            eraOk(candidate, era) &&
            heatOk(candidate, heat) &&
            gateOk(candidate, female, male) &&
            placeFitsActs(candidate.tag, acts, realisticOn(settings)) &&
            placeFitsJob(candidate.tag, jobs, used) &&
            sportPlaceOk(candidate, used) &&
            sportGearPlaceOk(candidate, used, lex)
        );
        if (
          (places.size > 0 && !currentPlaceWorks) ||
          (used.has("outdoors") && !used.has("indoors")) ||
          (!places.size && !canStillPickIndoorPlace)
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
      // 釘 on bed 時場地／in_out 還沒填。outdoors → 床已擋，反向沒擋，
      // 實測釘床／椅／沙發 15～20/40 張自動 outdoors。bunk bed 本來就雙向。
      if (used.has("outdoors") && INDOOR_FURN.has(item.tag)) return false;
      if (item.tag === "outdoors" && [...used].some((t) => INDOOR_FURN.has(t))) return false;
      if (
        (item.implies || []).includes("outdoors") &&
        [...used].some((t) => INDOOR_FURN.has(t))
      ) {
        return false;
      }
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
      // 正常模式不抽男人人種。這條本來寫成 `item.mutex === "race"`，但 monster boy
      // 是那一組的傘狀父標籤（goblin 等等 implies 它），mutex 是 null —— 於是它
      // 從規則旁邊溜過去，正常模式每 800 張還是會有 41 張冒出一個光禿禿的
      // 「怪物男」。改看 group 才擋得住整組。
      if (item.group === "race" && !pinned.has(item.tag)) return false;
      if (item.tag === "dark-skinned male" && !pinned.has(item.tag)) return false;
      const jobs = usedJobs(used, lex);
      if ((item.mutex === "place" || item.group === "place") && !placeFitsJob(item.tag, jobs, used)) {
        return false;
      }
      if (item.mutex === "activity") {
        // 可行性檢查要套時代濾鏡。這一關問的是「這個活動至少有一個地方可以做」，
        // 但場地清單是不分時代的：清單裡唯一撐住這個活動的場地若不屬於當前時代，
        // 「有地方可去」就是假的 —— 活動被放行，場地那一格卻誰也填不進去。
        // （courtyard 補進 maid 時就是這樣：中庭同時是女僕場地也是運動場地，
        // 運動活動因此過關，但中庭不是現代的字，於是 178 張運動圖全都沒有場地。）
        // 清單為空代表那個職業在這個時代一個場地都沒有 —— 今天沒有這種職業
        // （查過，0 組），真的出現的話活動也一定排不進去，擋掉是對的。
        const jp = jobPlacesOf(jobs);
        if (jp.size) {
          const usable = placesInEra(jp, lex, era);
          if (!usable.size || !actFitsSomePlaces(item.tag, usable, true)) return false;
        }
        if (!jobs.size && used.has("maid")) {
          const usable = placesInEra(JOB_PLACE.maid, lex, era);
          if (!usable.size || !actFitsSomePlaces(item.tag, usable, true)) return false;
        }
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
          if (!PRIVATE_SEX_PLACE.has(item.tag)) {
            // 自動抽的性愛仍進臥室／溫泉。只有「場上已有活動、且那些活動在這個
            // 時代一個私密場地都沒有」才放行 ACT_PLACE —— 否則釘購物／開車／網球
            // 開著性愛會 100% 沒場地（實測各 40/40）。
            const listed = [...acts].filter(
              (a) => ACT_PLACE[a] && !WATER_ACT.has(a) && !BATH_ACT.has(a)
            );
            const noPrivateVenue =
              listed.length > 0 && listed.every((a) => !actHasPrivatePlace(a, era, lex));
            if (!noPrivateVenue) return false;
          }
        } else if (PUBLIC_SEX_PLACE.has(item.tag)) {
          // 自動抽的有職業性愛仍避開大街。只有「場上已有職業、且那些職業在這個
          // 時代的場地全是公開場所」才放行 —— 否則釘消防員開著性愛會 100% 沒場地
          // （實測 40/40）。偵探的辦公室不在公開清單，繼續走室內。
          const listed = [...jobs].filter((j) => JOB_PLACE[j]);
          const onlyPublic =
            listed.length > 0 && listed.every((j) => jobHasOnlyPublicPlaces(j, era, lex));
          if (!onlyPublic) return false;
        }
      }
      if (item.tag === "outdoors") {
        const listed = [...jobs].filter((j) => JOB_PLACE[j]);
        if (listed.length > 0 && listed.every((j) => jobHasOnlyIndoorPlaces(j, era, lex))) return false;
      }
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

  // 泡澡／游泳本來就沒什麼好穿的，但服裝段的目標數不知道這件事：衣服被場景掃掉
  // 之後，那個額度會整批轉去補配件 —— 溫泉圖平均 4.6 件配件、0.8 件衣服，
  // 而一般場景是 0.7 件配件、5.4 件衣服。
  //
  // 以前那些額度填的是項圈、手套、棒球帽（黑名單沒列到的），改成白名單之後填的
  // 變成髮飾、眼鏡、耳環，每張都有 —— 問題從來不是「填什麼」，是「不該填那麼多」。
  //
  // 這個上限一定要下在 want，不能下在 fill 的過濾函式：那個函式是先把整池篩完
  // 才開始 commit，計數在裡面永遠是 0（我第一版就是這樣寫的，完全沒有作用）。
  const WATER_CLOTH_WANT = 3;
  const clothingWant = (base) => {
    const kind = sceneClothLocked(used, mustPins(), lex, era, lockSceneOn(settings));
    if (kind !== "bath" && kind !== "swim") return base;
    return Math.min(base, WATER_CLOTH_WANT);
  };

  const fill = (section, extraFilter) => {
    let want = Math.max(0, Math.min(10, Number(counts[section]) || 0));
    if (section === "clothing") want = clothingWant(want);
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

  // 佔住 place 這一格的時代錨，改成「偏好」而不是「無條件蓋章」。
  //
  // 六個時代裡只有兩個錨是場地：castle（medieval）和 chinese architecture
  // （ancient_china）。它們一蓋下去就把唯一的場地格佔滿，接著
  // fillSlot("env","place") 看到 mutexTaken 有 place 就直接 return ——
  // 那一格等於不存在。
  //
  // 結果是反過來的：奇葩模式 castle 佔 100%，多元 62%，正常反而只有 19%。
  // 正常模式之所以最鬆，是因為 allow() 會用 placeFitsActs 擋掉不合活動的城堡，
  // 剛好把格子讓回來。**規則放得越鬆、畫面反而越單調**，跟面板上寫的
  // 「多元＝只鎖場景配對與物理，奇葩＝只鎖物理」正好相反。
  //
  // 其他四個時代的錨不佔場地格（armor、japanese clothes、modern…），
  // 它們的場地本來就很散（edo dojo 10%、victorian park 9%），這也反過來說明
  // 問題出在「佔格子」而不是「錨」本身。
  const stampAnchors = (section) => {
    for (const t of lex.data.eraAnchors?.[era] || []) {
      // 錨點可以有一組同義的替代字（chinese clothes / hanfu）。每次隨機挑一個，
      // 否則同一個時代的每一張圖都由同一個字開頭。挑到的字被擋下來時，
      // 同組其他字還有機會，所以不會因為換寫法就少掉時代訊號。
      const alts = lex.data.eraAnchorAlts?.[t] || [t];
      const pool = [];
      for (const alt of alts) {
        const item = lex.byTag.get(alt);
        if (!item || item.section !== section) continue;
        if (used.has(alt) || banned.has(alt)) continue;
        if (!allow(item)) continue;
        pool.push(item);
      }
      if (!pool.length) continue;
      const pick = pool[Math.floor(rand() * pool.length)];
      // 場地錨改成擲骰子。不用「軟權重」是因為 takeFromPool 的權重是**逐個字**算的，
      // 不是逐層：castle 一個字權重 6，要跟十幾個中世紀場地（各 3）和十六個中性
      // 場地（各 1）比，算出來只有 9%。想調到某個比例就得把權重寫成 37 這種數字，
      // 而那個數字會隨著詞庫長大而失準 —— 那是在對著池子大小調參，不是在表達意圖。
      // 機率直接就是意圖：這個時代有多少比例的圖用它的招牌場地。
      if (pick.mutex === "place") {
        if (rand() >= PLACE_ANCHOR_CHANCE) continue;
      }
      commit(pick.tag);
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

  // 少量 tease 畫面先決定「無臉構圖」，再讓後續 feature/pose 配合它。
  //
  // 這兩個 camera 以前排在眼睛、表情與活動後面，所以 allow() 每次都看到衝突，
  // 自然抽取是 0。單純把所有 camera 提前又會讓 lower body 擋掉 flash/sex 必須有的
  // 手部與胸部動作；因此只在沒有核心活動保證的 tease 尺度建立低機率 profile。
  // pin 與 mustDraw 若已佔 camera，使用者意圖優先，不再擲這次 profile。
  //
  // 構圖 profile 使用由 seed 派生的獨立亂數流。若在主 rand() 多抽一次，所有 tease
  // 結果（包括職業場地、衣服與姿勢）都會整串位移；新增一個 camera 不該改寫其餘
  // 94% 畫面的既有行為。UI 與正式測試都會傳數字 seed，fallback 僅供外部呼叫者。
  const compositionRand = Number.isFinite(seed)
    ? mulberry32(((seed >>> 0) ^ 0x0051f15e) >>> 0)
    : rand;
  if (heat === "tease" && !mutexTaken.has("camera") && compositionRand() < 0.06) {
    const faceless = ["head out of frame", "lower body"]
      .map((tag) => lex.byTag.get(tag))
      .filter((item) => item && allow(item));
    takeFromPool(faceless, 1, compositionRand, commit, null, allow);
  }

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
    // 同上：一般補牌也要看 group，否則傘狀的 monster boy 會自己被補進來。
    // 具體人種由上面的 fillSlot("feature", "race") 負責，它會連帶 implies 出父標籤。
    if (item.group === "race") return false;
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
        // waist 是新加的格子（obi／sash／belt）。腰上的東西以前 mutex 是空的，
        // 於是在這條路徑上一律被擋 —— 江戶的 obi 在 3000 張裡是 0。
        const outfit = new Set([
          "feet",
          "waist",
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

  // 這裡曾經有一段「只穿內衣就補兩格內衣」。量過之後拿掉了：A/B 跑同一批 seed，
  // 有沒有那段的結果**逐字相同**（400 張都留下 318 張）。原因是通用的
  // fill("clothing") 本來就會把內衣填上，而填不上的那些是被浴場事後脫掉的 ——
  // 在這個位置補也會被脫。真正有效的是下面那條「沒有內衣就把這個字拿掉」。
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
  // 一般 camera 仍放在臉部特徵後；只有上方 tease profile 會先保留無臉構圖。
  // 這可讓 head out of frame / lower body 自然可達，又不會讓它們擋掉 flash/sex
  // 必須保證的手臂、胸部或性愛動作。詳見 docs/pose-tag-deep-review.md §2。
  fillSlot("pose", "camera");
  fillSlot("pose", "gaze");
  fillSlot("pose", "expression");
  const hasSexAct = someUsed((it) => it.mutex === "sex_act" || it.tag === "sex");
  if (heat !== "sex" && !hasSexAct) fillSlot("pose", "activity", sportActivityPrefer() || undefined);
  const stampActProps = () => {
    for (const a of usedActs(used, lex)) {
      const props = ACT_PROP[a] || [];
      // 這個活動已經有道具了就不要再來一次。stampActProps() 一張圖裡會跑三次，
      // 而 karaoke implies singing、兩個都在 ACT_PROP 裡 —— 少了這一關，
      // 第二輪會為同一件事再擲一次骰子（擲了也白擲，held_prop 那一格已經被佔）。
      if (props.some((p) => used.has(p))) continue;
      const fit = props.filter((p) => {
        if (banned.has(p)) return false;
        const item = lex.byTag.get(p);
        return !!item && eraOk(item, era) && heatOk(item, heat);
      });
      if (!fit.length) continue;
      // 從合格的裡面隨機挑。舊寫法是 `commit(prop); break;` 取第一個 ——
      // 那是無條件 break，清單一旦有多個字，第一個被 commit 拒絕（互斥格已被
      // 別的活動佔走）就整個放棄，後面的字連試都不會試到。
      const start = Math.floor(rand() * fit.length);
      for (let k = 0; k < fit.length; k += 1) {
        if (commit(fit[(start + k) % fit.length])) break;
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
  // 場地也改成軟權重，理由跟燈光那一格一模一樣。
  //
  // fillSlot 的 env 預設偏好是硬桶：時代專屬的抽乾了才輪到 era:["any"]。而場地
  // 只有一格，所以「輪到」幾乎不會發生 —— 實測現代 86 個時代專屬場地拿走 95%，
  // 16 個中性場地（沙灘、海洋、森林、山）合計只有 5%，beach 在 18000 張裡是 0。
  // 古中國 67% 都是 chinese architecture，中世紀 70% 都是 castle。
  //
  // 這件事這個檔案自己已經想通過一次：fill(section) 那裡的註解寫著
  // 「era:["any"] 的意思是每個時代都能用，不是次等候選」，所以 fill("env") 早就
  // 拿掉了 prefer。漏掉的是場地這一格。燈光那一格也是同一個病，用 4:1 修好的。
  //
  // 四比一改成十四比一（2026-09-17）。原本的說法是「時代味不靠這一格扛，底下的
  // 『時代風味』那一格（不佔互斥格的景物）才是」—— 但實測那個設計撐不住：
  //
  //   古中國 4000 張，時代訊號由誰扛：服裝＋場地 60.9%、**只有服裝 34.9%**、
  //   只有場地 3.5%、兩個都沒有 0.7%。
  //
  // 也就是三分之一的圖，時代感只靠衣服撐著 —— 人一脫光就什麼都不剩，只剩
  // 紙燈籠、珠子那種小道具，而那撐不起一張圖。專案主回報的正是這種：
  // 「nude + underwater + paper lantern」完全看不出古中國。
  //
  // 十四比一之後：只靠衣服 34.9% -> 26.3%，兩個都沒有 0.7% -> 0.3%。
  // 中性場地沒有被餓死（這正是當初設成四比一要防的）：歷史時代的場地種類
  // 52 -> 50、中性種類 13 -> 12，beach 155 -> 123，仍然抽得到。
  //
  // 再往上加幾乎沒有用：二十五比一也只到 24.1%，因為剩下的中性場地多半是
  // 情境規則塞進來的（做愛要私密場地、泡澡要浴場），不是這一格抽出來的。
  // 要再往下就得去查「為什麼時代專屬場地在那些情境被擋掉」，那是另一件事。
  fillSlot("env", "place", {
    softTiers: [(item) => eraSpecific(item, era)],
    weights: [14, 1],
  });
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
  // 天氣。這一格以前完全沒人填，而通用的 fill("env") 在預設張數下一格預算都不剩
  // （place / in_out / day_night / lighting 四格，加上場地免費帶進來的 indoors／
  // outdoors，把當時預設的 env:4 用完；那個預設後來調到 6），所以
  // rain、snow、fog、overcast、cherry blossoms 這幾個字在預設設定下是 0 —— 不是
  // 抽得少，是結構性抽不到。跟光源當初一模一樣的病。
  //
  // 但不能照抄光源那格的做法。光源是每張圖都有，天氣不是：Danbooru 上六個天氣字
  // 加起來最多只佔室外圖的 6.6%（rain 2.00%、snow 2.89%、cherry blossoms 2.37%、
  // steam 0.84%、fog 0.46%、overcast 0.39%）。無條件填等於每張圖都在下雨，而且
  // 室內也會下。所以這裡是「室外才擲骰子」。
  //
  // 15% 比 Danbooru 的基礎比例略高 —— 這是隨機器，看得到才有意義 —— 但仍在同一個
  // 量級。室外約佔六成，所以全體大約 9% 的圖會有天氣。
  //
  // 蒸氣跟天氣互斥（同一個 mutex），所以兩者在這裡二選一：有浴場就是蒸氣，
  // 否則室外才擲天氣。
  //
  // 蒸氣**不能**放進 CTX_PULLS_ACC —— 那個迴圈外面包著 kind !== "bath" &&
  // kind !== "swim"（「泡澡游泳不拉，那邊的配件本來就要少」），所以一進浴場整段
  // 就被跳過，寫在那裡是死碼。我第一版就是寫在那裡，實測釘 onsen 抽 400 張
  // steam 是 0 才發現。
  //
  // commit() 只驗相依字、不驗這個字本身，所以 allow() 這一關要自己過 ——
  // 跟 CTX_PULLS_ACC 那邊同樣的理由。
  const steamItem = lex.byTag.get("steam");
  const steamChance = [...used].some((t) => STEAM_HOT.has(t))
    ? 0.35
    : [...used].some((t) => STEAM_MILD.has(t))
      ? 0.15
      : 0;
  if (steamChance > 0 && steamItem && !used.has("steam") && eraOk(steamItem, era) &&
      heatOk(steamItem, heat) && gateOk(steamItem, female, male) && allow(steamItem)) {
    if (rand() < steamChance) commit("steam");
  } else if (steamChance === 0 && used.has("outdoors") && rand() < 0.15) {
    fillSlot("env", "weather");
  }
  // 傢俱。跟天氣當初一樣的病：place／in_out／weather／day_night／lighting 都有
  // 專屬的 fillSlot，只有 furniture 沒有 —— 那六個字（on bed／on chair／on couch／
  // bunk bed／on desk／under table）只能在通用的 fill("env") 裡跟另外三百多個 env
  // 字搶剩餘配額，結果整格只有 0.4% 的圖填得到，連 on bed 這種最基本的概念在
  // 5184 張的面板掃描裡都是 0。
  //
  // 同樣不能無條件填：不是每張圖都有人坐在什麼東西上。室內才擲骰子，
  // 跟天氣「室外才擲」對稱。
  //
  // **不套用 env 預設的「時代專屬優先」偏好。** 那個偏好是為了時代訊號而存在
  // （寶塔說這是古中國），但傢俱不是時代訊號 —— 沙發不會告訴人這是哪個年代，
  // 時代限制由各字自己的 era 欄過濾就夠了。套上去的後果是：現代這一格裡
  // 「時代專屬」的只有 bunk bed／on couch／on desk 三個，而前兩者之外
  // on couch 是**唯一沒有前提條件**的（on bed 要臥室類場地、bunk bed 要
  // 臥室或旅館房間、on desk 與 under table 有 NEEDS_CONTEXT），於是它把
  // 現代那一整份掃走 —— 實測佔掉這一格 53～57%，剛好在稽核那條
  //「沒有任何一格被單一個字吃掉」的 55% 上下翻面。
  //
  // 這正是那條守衛自己寫的病徵：「把一個『永遠成立』的字放進一個『有優先序』
  // 的格子，等於把那一格關掉」。拿掉偏好，六個字按各自的資格公平競爭。
  if (used.has("indoors") && rand() < 0.2) {
    fillSlot("env", "furniture", () => false);
  }
  fillSlot("env", "day_night");
  // 光源。以前沒有人明確填這一格，lighting 只能在剩下的 fill("env") 裡跟道具、
  // 天氣、天空搶名額，14 個光源 tag 加起來只有大約 3% 的機率出現 —— 而且每張
  // 圖都被無條件加上同一句 soft lighting，所以光其實都一樣。那句固定尾巴後來
  // 也拿掉了（Danbooru 0 篇，也不在 Illustrious 的訓練字彙裡），現在打光完全
  // 靠這一格真的抽到。fillSlot 的 env 預設偏好就是「時代專屬優先」，所以古代
  // 會先拿到燭光、油燈、火把。
  // 偏好用軟權重不用硬桶：fillSlot 的 env 預設偏好是硬排序（時代專屬先抽完才輪到
  // 中性），而歷史時代現在有五到九個時代光源，硬排序會把 window light、
  // sidelighting 這些中性光源整個餓死 —— 既有測試「era:[any] 燈光抽得到」
  // 就是在守這件事。四比一：時代光源仍然是主角，中性光源留得下來。
  fillSlot("env", "lighting", {
    softTiers: [(item) => eraSpecific(item, era)],
    weights: [4, 1],
  });
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
  // 時代道具：一件那個年代的東西。
  //
  // 上面那一格挑的是「場景」（石牆、拱門、竹林），這一格挑的是「東西」（香爐、
  // 古琴、戰旗、茶壺）。special_prompts 裡那三包古中國（Grok 寫的 495 個檔）每一張
  // 都同時有這兩樣，而我們原本只有場景 —— 道具雖然在詞庫裡，卻因為 env 的名額
  // 先被場地／室內外／日夜／光源用掉，每個道具只剩大約 1% 的機率露臉。
  //
  // 只在歷史時代跑：現代的「道具」是手機和遊戲手把，那本來就不缺。
  //
  // 把環境拉到 0 的人要的是最少的環境字，畫面上也寫著「不做額外隨機補牌，
  // 必要骨架仍保留」。場地、室內外、日夜、光源是骨架（每張圖都得有），
  // 一件年代道具是裝飾 —— 所以它跟著 counts 走。
  // 不這樣做的話，我加的這一格會讓環境滑桿在 0~5 之間完全沒有效果。
  if (era && era !== "modern" && Number(counts.env) > 0) {
    const props = lex.bySection.env.filter(
      (item) => item.group === "other" && !item.mutex && eraSpecific(item, era) && allow(item)
    );
    takeFromPool(props, 1, rand, commit, null, allow);
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
      // 袍子類只有在「拿掉之後還穿得上別的」時才排除。
      //
      // 第一版沒有這個條件，結果把不准裸體的情境逼到只剩裸標：維多利亞男性浴場
      // 240 張裡 226 張全裸、只勾活動也冒出 21 張裸標、tease 也被迫裸一次。
      // 袍子在那些情境是**唯一的有穿選項**，不是多餘的 —— 它對「浴場」是對的，
      // 只是對「正在洗」不對。兩者都要顧，所以條件是「有替代品才排除」。
      const dropRobes =
        washingNow(used) &&
        lex.bySection.clothing.some(
          (item) =>
            item.layer !== "skin" &&
            !NOT_WHILE_WASHING.has(item.tag) &&
            isBodyGarment(item) &&
            garmentOkForKind(item, kind, era) &&
            // 這裡不能用 allow()：要拿掉的那件袍子**此刻還佔著 onepiece 格**，
            // allow() 會因此否決所有 onepiece 的替代品，條件永遠不成立、修法整個空轉。
            // 要問的是「這個字在這個時代／熱度／性別下本來能不能用」，不是「現在這一格空不空」。
            eraOk(item, era) &&
            heatOk(item, heat) &&
            gateOk(item, female, male)
        );
      for (const t of [...used]) {
        if (guard.has(t) || pinRel.has(t)) continue;
        const it = lex.byTag.get(t);
        if (
          it &&
          it.section === "clothing" &&
          (it.layer === "garment" || it.layer === "accessory") &&
          (!garmentOkForKind(it, kind, era) ||
            (dropRobes && NOT_WHILE_WASHING.has(it.tag)))
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
        // 正在洗就把袍子類排掉 —— 但只在還留得下「有穿的」選項時。
        // 光看 narrowed.length 不夠：那個池子含裸標，袍子拿掉之後可能只剩裸標，
        // 於是不准裸的情境被逼著裸。要看的是「還有沒有非裸標的選項」。
        if (dropRobes) {
          const narrowed = pool.filter((item) => !NOT_WHILE_WASHING.has(item.tag));
          if (narrowed.some((item) => item.layer !== "skin")) {
            pool.length = 0;
            pool.push(...narrowed);
          }
        }
        // 只勾「活動」時畫面上說好的是日常，沒有走光或做愛 —— 補救時就不該
        // 拿裸體交差。有衣服可穿就穿衣服，真的一件都沒有才退回裸標
        //（不然浴場又會變回什麼都沒交代）。實測這條沒加之前，
        // 只勾活動的 3000 張裡會漏出兩張全裸。
        // 池子空了的退路：一條浴巾。
        //
        // 中世紀男性在全年齡尺度下，浴場的每一個選項都被擋掉：wet clothes／
        // naked towel／nude 被分級擋、loincloth 和 fundoshi 也被分級擋、chemise 是
        // female-only、bathrobe 和 yukata 的時代不對。於是 4.25% 的圖**整張沒有任何
        // 衣物或裸標**（實測 85/2000，三個例子全是 bathing）。
        //
        // 唯一活得下來的是 towel：era any、gate any、全年齡不擋。但它 layer=accessory、
        // mutex 是空的，normal 模式的 fill("clothing") 根本挑不到它（那是先前查到的
        // 34 個「mutex 空的配件抽不到」之一）。
        //
        // 只在 pool 真的空的時候才補，所以其他情境一個都不受影響 —— 那些情境的
        // pool 本來就不是空的。
        if (!pool.length) {
          const towel = lex.byTag.get("towel");
          if (towel && allow(towel)) pool.push(towel);
        }
        const dressed = pool.filter((item) => item.layer !== "skin");
        const rescue = heat === "activity" && dressed.length ? dressed : pool;
        // 先照真實比例擲一次裸體，再退回服裝池。
        //
        // 上面 4800 多行那段本來就有「浴場 34% 裸」的意圖，但它問的是
        // sceneClothKind(**pinned**) —— 服裝在場地之前就決定了，那時候 used 裡還沒有
        // 浴場，所以作者只能拿 pinned 當依據。結果是：**只有使用者自己釘了浴場才會
        // 觸發**，自然抽到浴場的永遠不會。
        //
        // 實測後果（8000 張，正在洗澡的 213 張）：
        //     裸 0%      Danbooru 是 67%
        //     浴巾 6.6%  Danbooru 是 40%
        //     浴袍 23.5% Danbooru 是 0.09%   <- 浴袍是洗完才穿的
        //
        // 這裡是場地已經定了的地方，所以同一個意圖放這裡才會真的生效。
        // 機率沿用作者原本寫的 0.34，不自己另外發明一個數字。
        // 只勾「活動」時仍然不准拿裸體交差（上面那條既有規則）。
        const skins = rescue.filter((item) => item.layer === "skin");
        if (kind === "bath" && heat !== "activity" && skins.length && rand() < 0.34) {
          takeFromPool(skins, 1, rand, commit, null, allow);
        } else {
          takeFromPool(rescue, 1, rand, commit, clothingPrefer, allow);
        }
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
        if (t === "sandals") used.delete(t);
      }
    }
  }
  // 全裸的人不會有「被遮住的乳頭」或「被遮住的肚臍」。
  //
  // 這兩個字是 feature，在 clothing 之前就抽好了，所以候選那一關問不到「後面會不會
  // 抽到裸體」—— 跟 5236 行記的那個順序陷阱同一類，只能在這裡反向清掉。
  // 實測：出現「隔著衣服」類字的 217 張裡有 8 張身上根本沒有遮身體的衣服，
  // 而那 8 張全部是 covered nipples 配 nude／completely nude。
  if (used.has("nude") || used.has("completely nude")) {
    for (const t of ["covered nipples", "covered navel"]) {
      if (used.has(t) && !pinned.has(t)) used.delete(t);
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
  // ===========================================================================
  // 收尾階段：全部填完、reconcile() 之前。
  //
  // 「這個字配不配得上場面」的規則要放這裡，不要放 allow()。
  //
  // 原因是順序：allow() 在每一格被填的當下呼叫，而那時候後面的格子還沒填。
  // 服裝在 fill("clothing") 就定了，場地 fillSlot("env","place")、
  // 活動 fillSlot("pose","activity")、脫衣動作都排在它後面 —— 所以在 allow() 裡
  // 問「身上有沒有那個場合」，答案永遠是沒有。
  //
  // 這個坑這一輪踩了兩次：
  //   配件的場合檢查寫進 allow()，五個字直接變成永遠抽不到，六套測試全綠。
  //   內衣的「看不看得見」需要知道有沒有脫衣動作，那也是之後才決定的。
  //
  // 辨認方法：規則要看的東西，是不是在這個字被抽的當下就已經定了？
  //   已經定了（互斥格、性別、時代、熱度）-> allow()
  //   要等別的格子（場地、活動、姿勢、脫衣）-> 這裡
  //
  // 這裡的每一段都要：用 mustPins() 當護身符（釘選與必抽不能刪），
  // 刪字時一併清掉 mutexTaken，並且量「還抽不抽得到」而不是只量「壞的不見了」。
  // ===========================================================================

  // 一男一女又真的在做，就補上 hetero。
  //
  // Danbooru 上標了「1girl 1boy sex」的圖有 **98.9%** 同時帶 hetero
  // （282,780 / 285,992），所以模型看那組字的時候，hetero 幾乎一定在場。
  // 我們一直沒給，等於少了它最熟悉的那一個配對訊號。
  //
  // 之所以會漏，是因為 hetero 的 section 是 subject，而 drawOne() 刻意沒有
  // fill("subject")（主體段整段由 chooseCast 決定人數，見 QUOTA_SECTIONS 的註解）。
  // 那個設計對「人數」是對的，但把 hetero 這種**配對描述**一起排除掉了。
  //
  // yuri 不比照辦理：同樣查過，「2girls sex」只有 6.6% 帶 yuri，
  // 跟 hetero 完全不是同一個量級，自動補上會是錯的。
  //
  // 只在有性行為時補。純粹一男一女同框（沒有性）在 Danbooru 上是 58%，
  // 不夠高到可以無條件加。
  if (female && male && !used.has("hetero") && lex.byTag.has("hetero")) {
    const doingIt = [...used].some((t) => {
      const it = lex.byTag.get(t);
      return it && (it.mutex === "sex_act" || it.group === "sex");
    });
    if (doingIt) commit("hetero");
  }

  // 正向的一半：場合已經定了，把跟它成對的配件拉進來。
  // 泡澡游泳不拉 —— 那邊的配件本來就要少，不是要多。
  {
    const kind = sceneClothLocked(used, mustPins(), lex, era, lockSceneOn(settings));
    // 使用者把服裝目標數設成 0，就是不要衣服。這一段是在額度花完之後才 commit 的，
    // 不擋的話會直接跨過那個 0（實測釘住場合時 1000 張裡有 442 張冒出配件）。
    //
    // 旁邊的 stampActProps() 有同樣的問題 —— 釘 singing、服裝設 0，microphone
    // 照樣 300/300 出現，新舊版都一樣。那是既有行為，不在這次動的範圍，
    // 但新加的東西不該拿它當藉口。
    const clothBudget = Math.max(0, Math.min(10, Number(counts.clothing) || 0));
    if (clothBudget > 0 && kind !== "bath" && kind !== "swim") {
      for (const [ctx, acc, chance] of CTX_PULLS_ACC) {
        if (!used.has(ctx) || used.has(acc)) continue;
        const item = lex.byTag.get(acc);
        if (!item) continue;
        if (!eraOk(item, era) || !heatOk(item, heat) || !gateOk(item, female, male)) continue;
        // 用 allow() 而不是自己再寫一遍條件。commit() 只驗相依字、不驗這個字本身，
        // 所以這一關得自己過 —— 但要過的是既有那一關，不是我另外寫的一關。
        // （例如 allow() 裡有「性愛熱度不要隨機抽入拳擊手套」那條，自己寫會漏掉。）
        if (!allow(item)) continue;
        if (rand() < chance) commit(acc);
      }
    }
  }

  // 運動器材。刻意**不掛**任何額度：器材跟 stampActProps() 蓋的道具是同一件事
  // （這個活動需要的那個東西），而平底鍋也不看 counts。實測 counts.env 設 0
  // 時場地、晝夜、光源、傢俱全部照常出現（它們走 fillSlot，本來就繞過額度），
  // 所以那個數字的語意是「通用補牌要補幾個」，不是「env 字上限」——
  // 把球拍掛上去等於用一個管不到別人的閘門去管它。
  {
    for (const [act, gear, chance] of CTX_PULLS_GEAR) {
      if (!used.has(act) || used.has(gear)) continue;
      const item = lex.byTag.get(gear);
      if (!item) continue;
      if (!eraOk(item, era) || !heatOk(item, heat) || !gateOk(item, female, male)) continue;
      // 跟上面那個迴圈同樣的理由：要過的是既有的 allow()，不是我另外寫的一關。
      // 運動那邊的 sportKitOk／sportGearPlaceOk／「沒有運動身分就不給器材」
      // 都在裡面，自己寫一定會漏。
      if (!allow(item)) continue;
      if (rand() < chance) commit(gear);
    }
  }

  // 全身穿好了還標著內衣，而且沒有任何脫衣或裸露的動作 —— 那件內衣看不見。
  //
  // Danbooru 上標 panties 的意思是「畫面上看得見」，所以「軍服＋panties」在訓練集
  // 裡代表掀起來或脫一半，不是「裡面穿著內褲」。實測釘女僕裝 600 張，100% 帶著內衣，
  // 其中 31% 連一個脫衣/裸露的動作都沒有。
  //
  // 跟配件那一段同樣的理由放在這裡而不是 allow()：脫衣動作是在服裝之後才決定的，
  // 在 allow() 裡看不到。
  {
    const guard = mustPins();
    const exposed = [...used].some((t) => {
      const it = lex.byTag.get(t);
      if (!it) return false;
      return it.mutex === "clothes_action" || it.group === "flash" ||
             it.group === "sex" || it.layer === "skin";
    });
    if (!exposed) {
      // 「是不是內衣」兩邊必須用同一個判準，否則同一件衣服會既算遮蔽物又算被遮的內衣，
      // 然後把自己刪掉。loincloth 就是這樣：mutex=underwear_bottom 但 group=era，
      // 於是「遮蔽物要排除 group==underwear」放它過關，「要刪的內衣看 mutex」又抓住它。
      // 中世紀浴場只剩兜襠布當身體交代時，它把自己刪光，圖裡就沒人說身上有什麼了 ——
      // 既有測試「只勾活動時浴場仍然交代得出身體」抓到的就是這一張。
      const isUnderwearItem = (it) =>
        !!it && (it.mutex === "underwear_top" || it.mutex === "underwear_bottom" ||
                 it.group === "underwear");
      const covered = [...used].some((t) => {
        const it = lex.byTag.get(t);
        return it && coversLowerBody(it) && !isUnderwearItem(it);
      });
      if (covered) {
        for (const t of [...used]) {
          if (guard.has(t)) continue;
          const it = lex.byTag.get(t);
          if (!it || it.section !== "clothing") continue;
          if (!isUnderwearItem(it)) continue;
          used.delete(t);
          for (const g of extraMutex(it)) {
            if (mutexTaken.get(g) === t) mutexTaken.delete(g);
          }
        }
      }
    }
  }

  // 配件的場合檢查要放在這裡，不能放在 allow()。
  //
  // 我第一版放在 allow() 裡，結果 animal collar 86->0、leash 19->0、clipboard 15->0、
  // knee pads 13->0、handcuffs 14->0 —— 全部變成永遠抽不到。原因是順序：
  // 衣服在 fill("clothing") 就填完了，而場地 fillSlot("env","place") 和活動
  // fillSlot("pose","activity") 都在那之後才跑。allow() 看到的 used 裡根本還沒有
  // 場地和活動，「沒有場合」這個條件於是永遠成立。
  //
  // police hat 要 policewoman、nurse cap 要 nurse 之所以沒事，純粹是因為那兩個是
  // 職業，在 fillSlot("feature","job") 就定了 —— 剛好排在衣服前面。我照抄那個寫法，
  // 卻沒注意到它依賴的是排序而不是規則本身。
  //
  // 這裡是全部填完、reconcile() 之前，該知道的都知道了。旁邊的 ACT_PROP 收尾
  // 用的就是同一個位置和同一個手法。
  {
    // mustPins() 而不是 pinned：必抽抽到的字跟釘選一樣不能被刪掉。
    const guard = mustPins();
    for (const [tag, need] of Object.entries(NEEDS_CONTEXT)) {
      if (!used.has(tag) || guard.has(tag)) continue;
      if ([...used].some((t) => need.has(t))) continue;
      const it = lex.byTag.get(tag);
      used.delete(tag);
      if (it) {
        for (const g of extraMutex(it)) {
          if (mutexTaken.get(g) === tag) mutexTaken.delete(g);
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

  // NEEDS_CONTEXT 要在 reconcile **之後**再掃一次。
  //
  // 上面那次掃在 reconcile 之前，該知道的都知道了 —— 但 reconcile 自己還會再刪東西
  // （最明顯的是 lockScene 會刪掉沒有場地的活動），於是前提在掃完之後才消失，
  // 道具就變成孤兒。這正是 test_draw_contracts.mjs 契約一開頭描述的那一類：
  // 「擋在候選階段，但最終 POS 是 reconcile() 之後才定案的」。
  //
  // 實測是 desk lamp 露出來的：它的前提多半是 studying／reading 這類活動，
  // 而那些活動被 lockScene 刪掉之後，檯燈就留在浴缸和餐廳裡。
  // 掃第二次只會刪掉真的沒有前提的字，所以對其餘十八條也只有好處。
  {
    const guard = mustPins();
    for (const [tag, need] of Object.entries(NEEDS_CONTEXT)) {
      if (!kept.has(tag) || guard.has(tag)) continue;
      if ([...kept].some((t) => need.has(t))) continue;
      kept.delete(tag);
    }
  }

  // 「只穿內衣」沒有內衣就是一句空話。
  //
  // 浴場與性愛場景會把內衣脫掉（那是對的 —— 沒有人穿內衣泡澡），但那個字留了下來，
  // 畫面上就變成「只穿內衣」卻一件內衣都沒有。實測釘住它抽 600 張有 114 張這樣，
  // 全部是現代的浴場（bathing／bubble bath）或性愛場景。
  //
  // 這裡連明確釘選一起清，所以不能走上面那個 NEEDS_CONTEXT 迴圈（它有 mustPins()
  // 護著）。理由跟「洗澡當下不再穿袍子」同一條：場景說了算，而卡片上的
  // 「釘選未入」會把這件事告訴使用者，不是無聲吃掉。
  if (kept.has("underwear only")) {
    const stillUnderwear = [...kept].some((t) => lex.byTag.get(t)?.group === "underwear");
    if (!stillUnderwear) kept.delete("underwear only");
  }

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
  // 尾巴就是滑桿選的那一級。選色情就寫 nsfw, explicit。
  //
  // 這裡曾經是「照實際抽到的內容推一級出來，滑桿只當上限」，動機是實測到
  // 尺度=活動 時 100% 的圖沒有任何情色內容卻都標著 explicit —— 一張穿好衣服在
  // 超市買東西的圖配上 nsfw, explicit，那個組合在訓練標註裡不存在。
  //
  // 但那個設計的代價更大，而且是專案主自己發現的：預設尺度（混合）在色情模式下，
  // 2000 張裡只有 22% 真的寫了 explicit，57% 寫成 sfw, general。選了色情卻拿到
  // 全年齡的標註，比偶爾標過頭難接受得多 —— 而且判準本身還會漏字（breast bondage、
  // breasts on glass、grabbing another's breast 都被判成 general）。
  //
  // 漏字那件事仍然值得修，但那是詞庫分類的問題；尾巴該不該由內容決定是另一回事，
  // 這裡照專案主的決定走：滑桿說了算。
  const shownRating = rating;
  const nsfw =
    shownRating === "explicit"
      ? lex.data.nsfwTail
      : shownRating === "sensitive"
        ? lex.data.sensitiveTail || []
        : lex.data.sfwTail || [];
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
 * 主體段刻意不在裡面：那一段整段就是卡司（人數、solo），由 chooseCast()
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
    rating: "explicit",
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
    // 舊存檔存的是布林 sfw，沿用時對應到全年齡。
    rating: RATINGS.includes(raw.rating)
      ? raw.rating
      : raw.sfw === true
        ? "general"
        : "explicit",
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

const CAST_PREFIX = new Set([...FEMALE_COUNT, ...MALE_COUNT, "solo"]);

// Danbooru 的消歧義標籤自帶括號（bow (weapon)、arrow (projectile)、1990s (style)），
// 而括號在 ComfyUI 的提示詞語法裡是「加權群組」。實測（comfy/sd1_clip.py 的
// token_weights + escape_important，直接跑使用者本機那份）：
//
//   "1girl, solo, 1990s (style)"  ->  1.0 "1girl, solo, 1990s "  /  1.1 "style"
//
// 括號被吃掉、裡面的字還被意外加重 1.1 倍。送到模型的不是 `bow (weapon)`（武器）
// 而是 `bow`（緞帶蝴蝶結）加上一個被加重的 `weapon` —— 消歧義標籤的用途正好被
// 反過來用。實測 5400 張裡有 23% 至少含一個這種標籤。
//
// ComfyUI 認 `\(` `\)` 當字面括號，所以送出去之前把標籤本身的括號跳脫掉。
// 我們自己加的權重語法 `(tag:1.2)` 不能跳脫，所以逐段拆開、只跳脫標籤文字，
// 再用 formatWeighted 把權重包回去。
// 先還原再跳脫，所以重複呼叫不會把 `\(` 變成 `\\(`。出口只有兩個、
// 來源都是沒跳脫的正規形式，但這個函式很容易被誤加在第三個地方。
export function escapeForComfy(positive) {
  const esc = (t) =>
    t
      .split("\\(").join("(")
      .split("\\)").join(")")
      .replace(/[()]/g, (c) => "\\" + c);
  const out = [];
  for (const part of String(positive || "").split(",")) {
    const { tag, weight } = parseWeighted(part);
    if (!tag) continue;
    out.push(formatWeighted(esc(tag), weight));
  }
  return out.join(", ");
}

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

// 「重新生成這張」要重現的是這張卡**抽的時候**那組條件，不是面板現在停在哪裡。
//
// 每一個會影響出圖的欄位都必須在這裡表態：屬於卡片，還是屬於即時設定。
// rating 當初沒表態，於是重抽會拿新分級的負面去配舊分級的正面 —— 同一個字
// 同時出現在正面與負面。loras 和 ckpt 一直都是對的，只有 rating 漏了，
// 因為這個判斷散在兩個函式裡、沒有一個地方需要把清單寫完整。
//
// 抽到這裡來的用意就是「有一個地方需要寫完整」：欄位少一個，測試會紅。
export const JOB_CARD_FIELDS = ["positive", "loras", "ckpt", "rating"];

export function jobFields(card, live) {
  const c = card || {};
  const l = live || {};
  return {
    positive: String(c.positive || ""),
    // 空陣列是有意義的 —— 那張卡就是沒掛 LoRA。所以只有「根本不是陣列」
    // （卡片沒存、或存的 JSON 壞了）才退回即時值。
    loras: Array.isArray(c.loras) ? c.loras : Array.isArray(l.loras) ? l.loras : [],
    ckpt: c.ckpt || l.ckpt || "",
    rating: c.rating || l.rating || "explicit",
  };
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

/**
 * 這張圖自己打架的地方，講成人話。空字串代表沒問題。
 *
 * `contradictions()` 早就在算這件事，而且 drawOne() 每次都把結果放進回傳值的
 * `conflicts` —— 但**沒有任何地方讀它**（改這個之前 `grep -rn conflicts web/*.js`
 * 只命中 engine.js 自己）。也就是說引擎知道「這張圖同時是室內又室外」，
 * 然後把結論丟掉，使用者拿到一張壞圖卻沒有任何提示。
 *
 * 自然抽取不會撞到（實測 8640 張 0 次，單一釘選 11080 張也是 0），
 * 要兩個互相矛盾的釘選才會 —— 例如釘「露營」配「更衣室」：前者 implies
 * outdoors、後者 implies indoors，兩個都是明確釘選所以都會留下。
 * 那是「使用者說了算」的正確行為，但**至少要告訴他**。
 * 實測 2500 組隨機配對抽 9996 張，撞到 14 張。
 *
 * 左欄那三條 clash 提示（角色／尺度／時代）是從**釘選**算的、在抽之前；
 * 這一條是從**抽完的 POS** 算的，跟 pinMissLine 同一個位置、同一個形狀。
 */
export function clashLine(lex, tags) {
  const list = Array.isArray(tags) ? tags : String(tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  const found = contradictions(lex, list);
  if (!found.length) return "";
  const L = (t) => labelOf(lex, t);
  // 室內外會被 implies 那一圈重複報好幾筆（indoors/outdoors 本身一筆、每個
  // implies 到它們的字各一筆）。先把具名的那些收起來，最後只講一句 ——
  // 而且要講**具體的字**（露營、更衣室），字面上的 indoors／outdoors 沒有資訊。
  const inOutNamed = new Set();
  let inOut = false;
  const seen = new Set();
  const parts = [];
  for (const [kind, a, b] of found) {
    if (kind === "in_out") {
      inOut = true;
      for (const t of [a, b]) if (t !== "indoors" && t !== "outdoors") inOutNamed.add(t);
      continue;
    }
    const key = kind === "day_night" ? kind : kind + "|" + a + "|" + b;
    if (seen.has(key)) continue;
    seen.add(key);
    if (kind === "day_night") parts.push("同時是白天和夜晚");
    else if (kind === "solo_count") parts.push("寫著單人卻有兩個以上的人");
    else if (kind === "nude_garment") parts.push("說全裸卻還穿著衣服");
    else parts.push(`${L(a)} 和 ${L(b)} 不能同時成立`);
  }
  if (inOut) {
    parts.unshift(
      inOutNamed.size
        ? `同時是室內和室外（${[...inOutNamed].map(L).join("、")}）`
        : "同時是室內和室外"
    );
  }
  return "這張圖自己打架：" + parts.join("；");
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
