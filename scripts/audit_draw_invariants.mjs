#!/usr/bin/env node
/**
 * 抽取不變式稽核。跑大量 drawOne()，檢查輸出有沒有違反下面這份**人工維護**的語意規格。
 *
 *   node scripts/audit_draw_invariants.mjs          預設 2000 張，進 test.bat
 *   node scripts/audit_draw_invariants.mjs 20000    手動深度稽核
 *
 * 設計上的三條規矩（Codex 2026-09-13 裁決）：
 *
 * 1. **規格不從 production 原始碼反射。** 前一版探針用正規表達式把 engine.js 裡的
 *    常數挖出來再拿去驗同一批常數 —— 那只能證明實作自洽，不能證明規則正確。實際
 *    後果是暮光語意改掉之後，探針還在報「market stall 撞 dusk」，因為它繼承了舊的
 *    二元分類。所以下面每一條的 tag 清單都是這裡自己寫的，production 改了規則，
 *    這份規格就會產生一個需要人審的 diff。
 *
 * 2. **hard 和 soft 分開。** hard＝畫面上真的矛盾，違反就紅燈。soft＝罕見但說得過去
 *    （黃昏的星空、室內的傘），只統計不擋版。把 soft 當 hard 是上一版最大的錯。
 *
 * 3. **失敗訊息要能一行重播。** 印出 seed、模式、熱度、時代、釘選和完整 POS。
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  ERAS,
  applyPin,
  contradictions,
  defaultSettings,
  drawOne,
  indexLexicon,
  mulberry32,
} from "../web/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web", "lexicon.json"), "utf8"));
const lex = indexLexicon(data);

// ---------------------------------------------------------------------------
// 語意規格（人工維護，改這裡等於改產品承諾）
// ---------------------------------------------------------------------------

/** 嚴格白天：畫面明確是白天。 */
const DAY = ["day", "sunrise", "sunlight", "sunbathing", "blue sky", "orange sky"];
/** 嚴格夜側：畫面明確是夜晚。 */
const NIGHT = ["night", "starry sky", "moonlight", "market stall"];
/** 日夜過渡：兩側都相容，刻意不參與硬互斥（Codex 2026-09-13）。 */
const TWILIGHT = ["sunset", "dusk"];

/** 看不到臉的鏡頭。 */
const FACELESS = ["head out of frame", "lower body"];
/** 需要看得到臉才成立的字（只列不靠 mutex／group 就能判斷的）。 */
const FACE_NEEDED = [
  "closed eyes", "covering own mouth", "closed mouth", "french kiss", "kiss",
  "finger to mouth", "eating", "drinking", "smoking", "singing", "talking on phone",
  "tongue out", "lipstick", "glasses", "tears", "one eye closed", "ahegao",
];
/** 同一張臉上只能有一個的眼部細節。 */
const EYE_ONE_OF = ["one eye closed", "empty eyes", "sparkling eyes", "half-closed eyes", "rolling eyes"];
/** 同一張臉上只能有一個的嘴部細節。 */
const MOUTH_ONE_OF = [
  "open mouth", "clenched teeth", "biting own lip", "tongue out",
  "parted lips", "licking lips", "drooling", "moaning",
];
/**
 * 一張圖只能有一種「有描述的」天空。
 * 泛稱的 sky 不列進來：sky + starry sky 是籠統配具體，是贅詞不是矛盾，
 * Danbooru 本來就這樣疊。真正互斥的是藍天／橘空／星空三選一。
 */
const SKY_ONE_OF = ["blue sky", "orange sky", "starry sky"];
/** 睡著就不可能在做的事。 */
const SLEEP_IMPOSSIBLE = [
  "washing hair", "splashing", "partially submerged",
  "bent over", "presenting", "grinding", "presenting ass", "fingering",
  "ahegao", "surprised", "angry", "scared", "smug",
];
/** 需要水的動作。 */
const WATER_ACTS = ["partially submerged", "splashing", "washing back"];
/**
 * 算得上有水的場地、天氣或動作。人工從詞庫挑出來的完整清單 —— 第一版只憑印象
 * 寫了一半，把「open-air bath + bathing + splashing」這種完全合理的畫面誤報成違規。
 */
const WATER_SOURCES = [
  // 場地
  "onsen", "bath", "bathroom", "bathtub", "shower (place)", "sauna", "beach", "ocean",
  "poolside", "pool", "pool ladder", "underwater", "open-air bath", "bubble bath",
  "waterfall", "beach towel", "river", "lake", "hot spring", "fountain", "puddle",
  // 天氣與物件
  "rain", "steam", "water", "shower head",
  // 釣魚不是泡水，但畫面裡一定有水
  "fishing", "fishing rod",
  // 動作與狀態（自己就代表畫面裡有水）
  "bathing", "showering", "swimming", "shared bathing", "diving", "wading", "partially submerged",
  "after bathing", "wet", "wet hair", "wet clothes", "steaming body",
];

/** 這些字明確在室外。 */
const OUTDOOR_ONLY = ["tree", "bush", "sky", "blue sky", "starry sky", "ocean", "mountain"];

// 天氣那一格是新加的（室外 15% 擲骰），這兩條是它的護欄。
//
// 清單照這個檔案的規矩自己手寫，不從 engine.js 反射 —— 那邊改了規則，這裡就會
// 產生一個需要人審的 diff，而不是跟著一起錯。
const WEATHER_OUTDOOR = ["rain", "overcast", "snow", "fog", "cherry blossoms"];
const STEAM_NEEDS = [
  "onsen", "sauna", "open-air bath", "hot spring", "bathing", "shared bathing",
  "steaming body", "bath", "bathroom", "bathtub", "shower (place)", "bathhouse",
  "ofuro", "bubble bath", "showering", "after bathing",
];

// 一張圖只能在做一件事。這份清單是**手寫**的，不從 engine.js 的 mutex 反射 ——
// 這條的重點正是要抓「某個性行為忘了掛 sex_act 互斥格」，從 production 反射出來
// 就等於跟著一起漏掉。實際抓到過：licking penis 被採集歸成 feature/body_m，沒有
// 互斥格，於是 8000 張裡 58 次出現中有 23 次同時還有別的性行為，包括
// 「licking penis + cowgirl position」（一邊騎乘一邊舔）。
const SEX_ACTS = [
  "vaginal", "anal", "fellatio", "deepthroat", "irrumatio", "cunnilingus", "anilingus",
  "licking penis", "handjob", "footjob", "paizuri", "paizuri under clothes",
  "cowgirl position", "reverse cowgirl position", "doggystyle", "standing doggystyle",
  "missionary", "mating press", "standing sex", "amazon position", "spooning",
  "prone bone", "sex from behind", "sitting on face", "69", "spitroast",
  "double penetration", "tribadism", "full nelson", "suspended congress",
];

const HARD = [
  {
    name: "全裸卻說被遮住",
    why: "covered nipples／covered navel 的語意前提就是身上有東西遮著。它們是 feature，在 clothing 之前就抽好了，所以候選那一關問不到後面會不會抽到裸體 —— 只能在後段反向清掉，而這條就是在守那個清理有沒有在做事。",
    check: (n) => {
      if (!n.has("nude") && !n.has("completely nude")) return "";
      const c = ["covered nipples", "covered navel"].filter((t) => n.has(t));
      return c.length ? `${c.join("+")} 撞 ${n.has("completely nude") ? "completely nude" : "nude"}` : "";
    },
  },
  {
    name: "同時做兩件性事",
    why: "一張圖只能在做一件事。兩個性行為同框代表其中一個沒有掛上 sex_act 互斥格。",
    check: (n) => {
      const acts = SEX_ACTS.filter((t) => n.has(t));
      return acts.length > 1 ? acts.join(" + ") : "";
    },
  },
  {
    name: "室內下雨",
    why: "天氣那一格只在室外擲。室內出現真正的天氣（雨雪霧陰櫻）代表那道室外判斷破了。",
    check: (n) => {
      if (!n.has("indoors") || n.has("outdoors")) return "";
      const w = WEATHER_OUTDOOR.filter((t) => n.has(t));
      return w.length ? `indoors 撞 ${w.join("+")}` : "";
    },
  },
  {
    name: "沒有浴場的蒸氣",
    why: "steam 掛在 weather 互斥格底下，但它是浴場的蒸氣不是天氣（Danbooru 上室內 15.0% 比室外 9.0% 多）。沒有浴場就不該有它。",
    check: (n) => (n.has("steam") && !STEAM_NEEDS.some((t) => n.has(t)) ? "steam 沒有任何浴場情境" : ""),
  },
  {
    name: "晝夜同框",
    why: "嚴格白天和嚴格夜側不能同時成立。暮光(sunset/dusk)兩側相容，不算。",
    check: (n) => {
      const d = DAY.filter((t) => n.has(t));
      const g = NIGHT.filter((t) => n.has(t));
      return d.length && g.length ? `${d.join("+")} 撞 ${g.join("+")}` : "";
    },
  },
  {
    name: "看不到臉卻有臉部細節",
    why: "鏡頭切掉頭之後，臉上的東西畫不出來。",
    check: (n) => {
      const cam = FACELESS.filter((t) => n.has(t));
      if (!cam.length) return "";
      const face = FACE_NEEDED.filter((t) => n.has(t));
      return face.length ? `${cam.join("+")} 撞 ${face.join("+")}` : "";
    },
  },
  { name: "兩個眼部細節", why: "一雙眼睛只能有一種狀態。", check: oneOf(EYE_ONE_OF) },
  { name: "兩個嘴部細節", why: "一張嘴只能有一種狀態。", check: oneOf(MOUTH_ONE_OF) },
  { name: "兩種天空", why: "抬頭只有一片天。", check: oneOf(SKY_ONE_OF) },
  {
    name: "閉眼還在看",
    why: "closed eyes 和任何注視方向互斥。",
    check: (n) => {
      if (!n.has("closed eyes")) return "";
      const bad = [...n].filter(
        (t) => t !== "closed eyes" && (/^looking /.test(t) || lex.byTag.get(t)?.mutex === "gaze")
      );
      return bad.length ? bad.join("+") : "";
    },
  },
  {
    name: "閉嘴還張嘴",
    why: "closed mouth 和張嘴類的字互斥。",
    check: (n) =>
      n.has("closed mouth") ? MOUTH_ONE_OF.filter((t) => t !== "closed mouth" && n.has(t)).join("+") : "",
  },
  {
    name: "睡著還在做事",
    why: "sleeping 不能配主動動作或清醒表情。",
    check: (n) => (n.has("sleeping") ? SLEEP_IMPOSSIBLE.filter((t) => n.has(t)).join("+") : ""),
  },
  {
    name: "泡水動作但畫面沒有水",
    why: "沒有水源的話這些動作畫不出來。",
    check: (n) => {
      const acts = WATER_ACTS.filter((t) => n.has(t));
      if (!acts.length) return "";
      return WATER_SOURCES.some((t) => n.has(t)) ? "" : acts.join("+");
    },
  },
  {
    name: "室內卻有室外景物",
    why: "indoors 之後就看不到樹和天空了。",
    check: (n) => (n.has("indoors") ? OUTDOOR_ONLY.filter((t) => n.has(t)).join("+") : ""),
  },
  {
    name: "室內室外同時成立",
    why: "同一張圖不可能兩者皆是。",
    check: (n) => (n.has("indoors") && n.has("outdoors") ? "indoors+outdoors" : ""),
  },
  {
    name: "engine 自己的 contradictions()",
    why: "互斥表、solo 人數、全裸配衣服、室內外暗示。",
    check: (n, arr) => {
      const c = contradictions(lex, arr);
      return c.length ? c.map((x) => x.join(":")).join(" / ") : "";
    },
  },
];

// soft：罕見但說得過去，只統計不擋版。
const SOFT = [
  {
    name: "暮光配夜景",
    why: "黃昏看見星星或月光合理，Codex 2026-09-13 明確裁定不該擋。",
    check: (n) => {
      const t = TWILIGHT.filter((x) => n.has(x));
      const g = NIGHT.filter((x) => n.has(x));
      return t.length && g.length ? `${t.join("+")} + ${g.join("+")}` : "";
    },
  },
  {
    name: "室內拿著傘",
    why: "玄關收傘、室內攝影棚道具都說得過去。",
    check: (n) =>
      n.has("indoors") && (n.has("umbrella") || n.has("parasol")) ? "indoors + umbrella" : "",
  },
];

function oneOf(list) {
  return (n) => {
    const hit = list.filter((t) => n.has(t));
    return hit.length > 1 ? hit.join("+") : "";
  };
}

// ---------------------------------------------------------------------------

const SCENARIOS = [
  { label: "預設", over: {} },
  { label: "全熱度", over: { heats: ["activity", "tease", "flash", "sex"] } },
  { label: "奇葩", over: { sceneMode: "weird", heats: ["activity", "tease", "flash", "sex"] } },
  { label: "多元", over: { sceneMode: "diverse", heats: ["activity", "tease", "flash", "sex"] } },
  {
    label: "抽好抽滿",
    over: {
      heats: ["activity", "tease", "flash", "sex"],
      boy: true,
      counts: { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 },
    },
  },
  {
    label: "古代高環境",
    over: {
      eras: ["medieval"],
      heats: ["activity", "tease", "flash", "sex"],
      counts: { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 },
    },
  },
];

const total = Number(process.argv[2] || 2000);
const per = Math.max(1, Math.floor(total / SCENARIOS.length));
const base = defaultSettings(data);

const hardHits = new Map();
const softHits = new Map();
const firstFail = new Map();
let drawn = 0;

for (const sc of SCENARIOS) {
  const s = Object.assign(JSON.parse(JSON.stringify(base)), sc.over, {
    girl: true,
    counts: Object.assign({ ...base.counts }, sc.over.counts),
  });
  for (let i = 1; i <= per; i++) {
    const seed = i;
    const out = drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed);
    const arr = out.positive
      .split(",")
      .map((x) => x.trim().replace(/^\(/, "").replace(/:[\d.]+\)$/, ""))
      .filter(Boolean);
    const names = new Set(arr);
    drawn += 1;
    for (const [rules, tally] of [[HARD, hardHits], [SOFT, softHits]]) {
      for (const rule of rules) {
        const why = rule.check(names, arr);
        if (!why) continue;
        tally.set(rule.name, (tally.get(rule.name) || 0) + 1);
        if (rules === HARD && !firstFail.has(rule.name)) {
          firstFail.set(rule.name, {
            seed,
            scenario: sc.label,
            mode: s.sceneMode,
            heats: s.heats.join("/"),
            eras: (s.eras || []).join("/"),
            era: out.era || "(無)",
            pins: "(無)",
            why,
            pos: out.positive,
          });
        }
      }
    }
  }
}

console.log(`抽取不變式稽核：${drawn} 張（${SCENARIOS.length} 種設定 × ${per}）`);
console.log(`規格：${HARD.length} 條 hard、${SOFT.length} 條 soft（人工維護，非從 engine.js 反射）`);
console.log();

if (softHits.size) {
  console.log("soft（可共存，僅統計）：");
  for (const rule of SOFT) {
    const n = softHits.get(rule.name) || 0;
    console.log(`  ${String(n).padStart(5)}  ${rule.name} —— ${rule.why}`);
  }
  console.log();
}

// --- 針對性複查：性行為互斥 --------------------------------------------------
//
// 上面那輪掃描是廣的，對稀有組合取樣不足：licking penis 缺互斥格那個 bug，在預設的
// 2000 張底下**掃不出來**，要 20000 張才會紅 6 次。與其把整輪掃描放大（所有人跑
// test.bat 都變慢），不如針對這一條開一小輪把條件調到它該出現的地方。
//
// heats=["sex"]、一男一女、預設張數：bug 還在的時候 3000 張抓到 36 次，
// 所以 1500 張仍有大約 18 次的預期命中，很穩。
{
  const N = 1500;
  let bad = 0;
  const examples = [];
  for (let i = 0; i < N; i += 1) {
    const s = defaultSettings(data);
    s.girl = true;
    s.boy = true;
    s.heats = ["sex"];
    const seed = 600000 + i;
    const pos = drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed).positive;
    const names = new Set(pos.split(",").map((t) => t.trim()));
    const acts = SEX_ACTS.filter((t) => names.has(t));
    if (acts.length > 1) {
      bad += 1;
      if (examples.length < 3) examples.push(`seed=${seed} ${acts.join(" + ")}`);
    }
  }
  if (bad === 0) {
    console.log(`ok   性行為互斥：${N} 張色情抽取沒有一張同時做兩件事`);
  } else {
    console.log(`
FAIL 性行為互斥  ×${bad}/${N}`);
    console.log("  規格：一張圖只能在做一件事；兩個性行為同框代表其中一個沒掛 sex_act 互斥格。");
    for (const e of examples) console.log(`  重播：${e}`);
    console.log("");
    console.log("1 條 hard 不變式被違反");
    process.exit(1);
  }
}

// --- 針對性複查：預設設定下撿得到景物道具 ------------------------------------
//
// drawOne() 明確填了四格 env（place / in_out / day_night / lighting），而
// countSection() 連 implies 帶進來的字一起算 —— indoors／outdoors 幾乎每張圖都被
// 場地免費帶進來，又佔掉一格。配額不夠的時候通用的 fill("env") 一格都撈不到，
// 天空、家具、攝影感、運動器材整批變成永遠抽不到。
//
// 這條守的是那件事，而且刻意用 defaultSettings()：實測配額 4 的時候這十個道具在
// 2000 張裡出現 **0** 次，配額 6 的時候 250 次。門檻取「十個裡至少看到五個」，
// 離實測（十個裡九個）有餘裕，但離壞掉的狀態（零個）非常遠。
{
  const PROPS = [
    "starry sky", "blue sky", "curtains", "tree", "mirror",
    "depth of field", "chair", "pillow", "bush", "on bed",
  ];
  const N = 1500;
  const hits = new Set();
  for (let i = 0; i < N; i += 1) {
    const s = defaultSettings(data);
    s.eras = [...ERAS];
    s.boy = true;
    const seed = 770000 + i;
    const names = new Set(
      drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed).positive.split(",").map((t) => t.trim())
    );
    for (const t of PROPS) if (names.has(t)) hits.add(t);
  }
  if (hits.size >= 5) {
    console.log(`ok   預設設定撿得到景物道具：${N} 張看到 ${hits.size}/${PROPS.length} 種（${[...hits].join("、")}）`);
  } else {
    console.log("");
    console.log(`FAIL 預設設定下景物道具被餓死  只看到 ${hits.size}/${PROPS.length} 種`);
    console.log("  規格：env 配額要留得下通用 fill(\"env\") 的預算，否則天空、家具、運動器材整批抽不到。");
    console.log(`  看到的：${[...hits].join("、") || "（一個都沒有）"}`);
    console.log("");
    console.log("1 條 hard 不變式被違反");
    process.exit(1);
  }
}

// --- 針對性複查：配件家族沒有整族死掉 ----------------------------------------
//
// normal 模式（預設）的 fill("clothing") 只放行 outfit 白名單裡的互斥格，mutex 是
// 空的配件一律回 false。所以配件掉了互斥格就等於被判死刑 —— 而父標籤（necklace、
// bowtie、gloves、necktie）照 UMBRELLA 的設計本來就是 mutex=None，只能靠子標籤
// implies 進場。子標籤自己再沒有格子，整個家族就一起死。
//
// 實際發生過：79 個配件裡 47 個 mutex 是空的，其中 34 個在預設模式完全抽不到；
// necklace 和 bowtie 整族是 0，而同類的 ring／stud earrings／choker 都活得好好的。
//
// 這條守的是「整族不能一起死」。門檻取十二個裡至少八個 —— 實測十二個全部看得到，
// 而壞掉的時候是零。
{
  const FAMILIES = [
    "necklace", "cross necklace", "bead necklace", "tooth necklace",
    "watch", "black gloves", "gloves",
    "bowtie", "black bowtie", "necktie", "blue necktie", "black necktie",
  ];
  const N = 1500;
  const hits = new Set();
  for (let i = 0; i < N; i += 1) {
    const s = defaultSettings(data);
    const seed = 770000 + i;
    const names = new Set(
      drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed).positive.split(",").map((t) => t.trim())
    );
    for (const t of FAMILIES) if (names.has(t)) hits.add(t);
  }
  if (hits.size >= 8) {
    console.log(`ok   配件家族沒有整族死掉：${N} 張看到 ${hits.size}/${FAMILIES.length} 種`);
  } else {
    console.log("");
    console.log(`FAIL 配件家族被餓死  只看到 ${hits.size}/${FAMILIES.length} 種`);
    console.log("  規格：配件掉了互斥格在 normal 模式就抽不到；父標籤靠子標籤 implies 進場，子標籤沒格子會整族一起死。");
    console.log(`  看到的：${[...hits].join("、") || "（一個都沒有）"}`);
    console.log("");
    console.log("1 條 hard 不變式被違反");
    process.exit(1);
  }
}

// --- 針對性複查：只勾性愛時抽得到兩男 ----------------------------------------
//
// spitroast／double penetration／mmf threesome／reverse spitroast 四個姿勢都要
// group(3人) + 2male，而 castWeights 裡**沒有任何組合同時滿足** —— 原本 mixed 有
// 「兩女一男」卻沒有「一女兩男」，四個字因此全死。Danbooru 上 1girl 2boys 有
// 96,530 篇，是 2girls 1boy（124,384）的 78%，同一個量級卻只收一邊。
//
// 更麻煩的是同一份分佈有兩個來源：只勾性愛時走的是 chooseCast() 裡**寫死**的另一張
// 表，補了詞庫那張照樣沒用。現在寫死那張已經搬進詞庫（castWeights.sex），
// 這條同時守「兩男抽得到」和「唯一來源沒有被繞過」。
{
  const sexCast = (data.castWeights || {}).sex;
  if (!sexCast || !Object.keys(sexCast).some((k) => k.split(",").length > 1 && /2boys/.test(k))) {
    console.log("");
    console.log("FAIL 詞庫缺少 castWeights.sex 的兩男組合");
    console.log("  規格：只勾性愛時的人數表要從詞庫來（唯一來源），而且要含兩男組合。");
    console.log("");
    console.log("1 條 hard 不變式被違反");
    process.exit(1);
  }
  const ACTS = ["spitroast", "double penetration", "mmf threesome", "reverse spitroast"];
  const N = 3000;
  let twoBoys = 0;
  const seenActs = new Set();
  for (let i = 0; i < N; i += 1) {
    const s = defaultSettings(data);
    s.girl = true;
    s.boy = true;
    s.heats = ["sex"];
    const seed = 850000 + i;
    const names = new Set(
      drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed).positive.split(",").map((t) => t.trim())
    );
    if (names.has("2boys")) twoBoys += 1;
    for (const a of ACTS) if (names.has(a)) seenActs.add(a);
  }
  // 兩男在只勾性愛時實測約 12%，取 N=3000 的期望值約 360；門檻取 50 是大幅留餘裕，
  // 但壞掉的時候是 0，離得非常遠。
  if (twoBoys >= 50 && seenActs.size >= 2) {
    console.log(`ok   只勾性愛抽得到兩男：${N} 張裡 2boys ${twoBoys} 次，兩男姿勢看到 ${seenActs.size}/4 種`);
  } else {
    console.log("");
    console.log(`FAIL 只勾性愛抽不到兩男  2boys ${twoBoys}/${N}，兩男姿勢只看到 ${seenActs.size}/4 種`);
    console.log("  規格：castWeights 要有能同時滿足 group(3人)+2male 的組合，否則那四個姿勢永遠抽不到。");
    console.log(`  看到的：${[...seenActs].join("、") || "（一個都沒有）"}`);
    console.log("");
    console.log("1 條 hard 不變式被違反");
    process.exit(1);
  }
}

// --- 針對性複查：正在洗澡時穿的東西 ------------------------------------------
//
// 這條是用 Danbooru 當「合不合理」的裁判找出來的：把我們常抽在一起的跨語意域配對
// 拿去查真實共現率，最低的一批幾乎全是浴袍配洗澡。
//
// Danbooru（分母是該動作的總數）：
//   bathing 18,182   裸 67.2%  towel 28.9%  naked towel 10.6%
//                    浴袍 0.1%  浴衣 0.4%  褌 0.2%  chemise 0.0%
// 修之前：現代 flash 的浴場 339 張裡，袍子 100% 起跳、裸 0、浴巾 0。
//
// **守的是「有替代品時就不准穿袍子」，不是「任何情況都不准」。**
// 袍子在沒有替代品的情境（tease／只勾活動／歷史時代）是唯一的有穿選項，
// 硬拿掉會把畫面逼成全裸 —— 第一版就是這樣，維多利亞男性浴場 240 張裡 226 張全裸、
// 只勾活動冒出 21 張裸標。所以規則是「有替代品才排除」，這條測試也照同樣的邊界驗。
//
// 現代 + flash 是替代品確定存在的組合（naked towel 是 modern/flash、裸體也允許）。
{
  const WASH = ["bathing", "showering", "shared bathing"];
  const ROBE = ["bathrobe", "yukata", "bath yukata", "fundoshi", "chemise"];
  const N = 4000;
  let washN = 0, robeN = 0, coveredN = 0;
  const examples = [];
  for (let i = 0; i < N; i += 1) {
    const s = defaultSettings(data);
    s.eras = ["modern"];
    s.girl = true;
    s.heats = ["flash"];
    const seed = 520000 + i;
    const names = new Set(
      drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed).positive.split(",").map((t) => t.trim())
    );
    if (!WASH.some((t) => names.has(t))) continue;
    washN += 1;
    const robe = ROBE.filter((t) => names.has(t));
    if (robe.length) {
      robeN += 1;
      if (examples.length < 3) examples.push(`seed=${seed} ${robe.join("+")}`);
    }
    if (names.has("nude") || names.has("completely nude") || names.has("towel") || names.has("naked towel")) {
      coveredN += 1;
    }
  }
  // 取樣要夠，否則這條是空轉。實測 4000 張約有 339 張洗澡圖。
  const enough = washN >= 80;
  // 有替代品時袍子必須是 0；而且身體仍然要交代得出來（裸或浴巾），
  // 不能靠「什麼都不穿也不說」來讓袍子歸零。實測 coveredN 約佔九成以上。
  if (enough && robeN === 0 && coveredN >= washN * 0.5) {
    console.log(`ok   有替代品時洗澡不穿袍子：${washN} 張洗澡圖，袍子 0，裸或浴巾 ${coveredN}`);
  } else {
    console.log("");
    console.log(`FAIL 洗澡穿袍子  洗澡 ${washN} 張，袍子 ${robeN} 張，裸或浴巾 ${coveredN} 張`);
    if (!enough) console.log("  取樣不足，這條會空轉 —— 先確認現代 flash 抽得到洗澡場景");
    console.log("  規格：浴袍／浴衣／褌是洗完或更衣室才穿的（Danbooru 0.0～0.4%）。");
    console.log("        有別的可穿時就不該選它；沒有替代品的情境才允許，那是刻意的。");
    for (const e of examples) console.log(`  重播：${e}`);
    console.log("");
    console.log("1 條 hard 不變式被違反");
    process.exit(1);
  }
}

// --- 針對性複查：歷史時代的浴場也有袍子以外的選擇 ----------------------------
//
// naked towel 本來被鎖在 era=["modern"]，於是歷史時代的浴場只剩浴袍／浴衣／褌那一類
// —— 而 Danbooru 說那一類洗澡時只佔 0.0～0.4%。內部也對不起來：bath／bathing／
// shared bathing／towel 這四個本來就是 era any，只有 naked towel 被鎖在現代，
// 而它跟 towel 是同一條毛巾。證據：naked_towel 全站 18,421 張，33.2% 在 onsen。
//
// 放寬之後歷史時代 flash 的浴場：袍子 37% -> 22%，裸 0 -> 25，浴巾 0 -> 31。
// 這條守的是「歷史時代的浴場交代身體時，不是只能靠袍子」。
{
  const WASH = ["bathing", "showering", "shared bathing"];
  const ROBE = ["bathrobe", "yukata", "bath yukata", "fundoshi", "chemise"];
  const N = 4000;
  const older = ERAS.filter((e) => e !== "modern");
  let washN = 0, nonRobeN = 0;
  for (let i = 0; i < N; i += 1) {
    const s = defaultSettings(data);
    s.eras = [...older];
    s.girl = true;
    s.heats = ["flash"];
    const seed = 610000 + i;
    const names = new Set(
      drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed).positive.split(",").map((t) => t.trim())
    );
    if (!WASH.some((t) => names.has(t))) continue;
    washN += 1;
    const dressedInRobe = ROBE.some((t) => names.has(t));
    const covered =
      names.has("nude") || names.has("completely nude") ||
      names.has("towel") || names.has("naked towel");
    if (!dressedInRobe && covered) nonRobeN += 1;
  }
  // 取樣要夠，否則空轉。實測 4000 張約 180 張洗澡圖，其中非袍子的約 28 張。
  const enough = washN >= 60;
  // 門檻取 8：離實測 28 有三倍餘裕，離壞掉的 0 非常遠。
  if (enough && nonRobeN >= 8) {
    console.log(`ok   歷史時代浴場不是只能穿袍子：${washN} 張洗澡圖，非袍子交代 ${nonRobeN} 張`);
  } else {
    console.log("");
    console.log(`FAIL 歷史時代浴場只剩袍子  洗澡 ${washN} 張，非袍子交代 ${nonRobeN} 張`);
    if (!enough) console.log("  取樣不足，這條會空轉 —— 先確認歷史時代 flash 抽得到洗澡場景");
    console.log("  規格：毛巾不是現代才有的東西；bath／bathing／towel 都是 era any，");
    console.log("        naked towel 不該被鎖在現代，否則歷史時代的浴場只剩袍子可穿。");
    console.log("");
    console.log("1 條 hard 不變式被違反");
    process.exit(1);
  }
}

// --- 針對性複查：歷史時代的時代感不能只靠衣服 --------------------------------
//
// 專案主回報：古中國抽到「nude, diving, underwater, beads, paper lantern」——
// 完全看不出古中國。查下去發現不是偶發：
//
//   古中國 4000 張，時代訊號由誰扛（嚴格定義：時代專屬的場地或服裝）
//     服裝＋場地 60.9%   **只有服裝 34.9%**   只有場地 3.5%   兩個都沒有 0.7%
//
// 三分之一的圖，時代感只靠衣服撐著 —— 人一脫光就只剩紙燈籠、珠子那種小道具。
// 我原本量成「100% 看得出年代」，是因為把小道具也算成訊號，量法太寬鬆。
//
// 場地那一格的軟權重從 4:1 調到 14:1 之後：只靠衣服 34.9% -> 26.3%。
// 這條守的就是那個上限，門檻取 30%：4:1 的 34.9% 會紅，14:1 的 26.3% 會過，
// 中間留了緩衝，不是貼著實測值訂的。
{
  const era = "ancient_china";
  const spec = (it) => {
    const e = it && it.era;
    return Array.isArray(e) && e.length && !e.includes("any") && e.includes(era);
  };
  const N = 3000;
  let strong = 0, clothOnly = 0, none = 0;
  for (let i = 0; i < N; i += 1) {
    const s = defaultSettings(data);
    s.eras = [era];
    s.girl = true;
    s.boy = true;
    const seed = 310000 + i;
    const tags = drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed)
      .positive.split(",").map((t) => t.trim());
    let place = false, cloth = false;
    for (const t of tags) {
      const it = lex.byTag.get(t);
      if (!it || !spec(it)) continue;
      if (it.section === "env" && (it.mutex === "place" || it.group === "place")) place = true;
      else if (it.section === "clothing") cloth = true;
    }
    if (place) strong += 1;
    else if (cloth) clothOnly += 1;
    else none += 1;
  }
  const clothPct = (100 * clothOnly) / N;
  const nonePct = (100 * none) / N;
  if (clothPct <= 30 && nonePct <= 1.5) {
    console.log(`ok   古中國的時代感不是只靠衣服：只靠衣服 ${clothPct.toFixed(1)}%、完全沒訊號 ${nonePct.toFixed(1)}%`);
  } else {
    console.log("");
    console.log(`FAIL 古中國時代感太依賴衣服  只靠衣服 ${clothPct.toFixed(1)}%（上限 30%）、完全沒訊號 ${nonePct.toFixed(1)}%（上限 1.5%）`);
    console.log("  規格：歷史時代的時代訊號要有場地在扛，不能全押在衣服上 ——");
    console.log("        人一脫光就只剩小道具，那撐不起一張圖。");
    console.log("");
    console.log("1 條 hard 不變式被違反");
    process.exit(1);
  }
}

// --- 針對性複查：時代招牌場地真的抽得到 --------------------------------------
//
// 專案主回報「古中國應該要配合中式建築」。查下去發現古中國的**招牌場地錨從來沒有
// 生效過**：stampAnchors() 以 PLACE_ANCHOR_CHANCE(0.35) 擲骰要把它蓋上去，但
// allow() 在 1500 張裡擋掉了 1494 張。
//
// 原因是招牌場地不在任何一張「活動 -> 可用場地」的相容表裡（ACT_PLACE／DESK_PLACE／
// MEAL_PLACE…）。姿勢和活動在場地之前就抽好了，而它們會限制場地；名字沒出現在那些
// 表裡的場地就等於被全部擋掉。實測 east asian architecture 在 engine.js 出現 0 次，
// 而同類的 courtyard 出現 9 次、castle 7 次、pavilion 4 次。
//
// 補進三張表之後：8/3000 -> 151/3000。（PRIVATE_SEX_PLACE 刻意不補，見那邊的註解。）
{
  const N = 2000;
  const want = "east asian architecture";
  let hit = 0;
  for (let i = 0; i < N; i += 1) {
    const s = defaultSettings(data);
    s.eras = ["ancient_china"];
    s.girl = true;
    const seed = 310000 + i;
    const names = drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed)
      .positive.split(",").map((t) => t.trim());
    if (names.includes(want)) hit += 1;
  }
  // 實測約 5%（2000 張約 100 次）。門檻取 20：離實測有五倍餘裕，離壞掉的
  // 「1500 張只有 3 次」非常遠。
  if (hit >= 20) {
    console.log(`ok   古中國的招牌場地抽得到：${want} ${hit}/${N}`);
  } else {
    console.log("");
    console.log(`FAIL 古中國的招牌場地抽不到  ${want} 只有 ${hit}/${N}`);
    console.log("  規格：時代錨的場地要真的蓋得上去。它必須出現在活動-場地相容表裡，");
    console.log("        否則姿勢一旦先抽好就會把它全部擋掉（這就是它以前 0.3% 的原因）。");
    console.log("");
    console.log("1 條 hard 不變式被違反");
    process.exit(1);
  }
}

// --- 針對性複查：全年齡的中世紀男性浴場要交代身體 ----------------------------
//
// 面板組合全掃（405 種 x 800 張）掃出來的：只有 medieval 有異常，而且集中在男性。
// 追下去是全年齡尺度 + 中世紀 + 男性 + 洗澡時，**每一個浴場衣物都被擋掉**：
//   wet clothes / naked towel / nude   -> 分級擋
//   loincloth / fundoshi               -> 分級擋
//   chemise                            -> female-only
//   bathrobe / yukata                  -> 時代不對
// 唯一活得下來的是 towel（era any、gate any、全年齡不擋），但它 layer=accessory、
// mutex 是空的，normal 模式的 fill("clothing") 挑不到它。
// 結果 85/2000 的圖**整張沒有任何衣物或裸標**。這是既有問題（b324de1 時是 86/2000）。
//
// 補救池空了的時候退回 towel，只影響這個池子真的空掉的情境。
{
  const N = 2000;
  let noBody = 0;
  const ex = [];
  for (let i = 0; i < N; i += 1) {
    const s = defaultSettings(data);
    s.eras = ["medieval"];
    s.girl = false;
    s.boy = true;
    s.rating = "general";
    s.heats = ["activity"];
    const seed = 770000 + i;
    const pos = drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed).positive;
    const tags = pos.split(",").map((t) => t.trim());
    const body = tags.some((t) => {
      const it = lex.byTag.get(t);
      return it && it.section === "clothing" &&
        (it.layer === "garment" || it.layer === "skin" || t === "towel");
    });
    if (!body) { noBody += 1; if (ex.length < 2) ex.push(`seed=${seed}`); }
  }
  if (noBody === 0) {
    console.log(`ok   全年齡中世紀男性浴場交代得出身體：${N} 張全部有衣物或浴巾`);
  } else {
    console.log("");
    console.log(`FAIL 全年齡中世紀男性有 ${noBody}/${N} 張沒交代身體`);
    console.log("  規格：每張圖都要說得出身上有什麼。那個組合下所有浴場衣物都被分級或性別擋掉，");
    console.log("        唯一剩下的 towel 又因為沒有互斥格而抽不到 —— 補救池空了要退回 towel。");
    for (const e of ex) console.log(`  重播：${e}`);
    console.log("");
    console.log("1 條 hard 不變式被違反");
    process.exit(1);
  }
}

// --- 針對性複查：腰上的東西抽得到 --------------------------------------------
//
// obi／sash／belt 全是 layer=accessory 且 mutex 空的，而 normal 模式的
// fill("clothing") 只放行 outfit 白名單裡的互斥格 —— 白名單沒有腰這一格，
// 所以它們一律抽不到。實測江戶 3000 張：obi 0、sash 0（weird 模式才有 82／69）。
// obi 偏偏是江戶最具代表性的配件。
//
// 給它們一個 waist 格（腰帶本來就一次只繫一條），並把 waist 放進白名單。
{
  const N = 3000;
  const want = ["obi", "sash"];
  const hit = Object.fromEntries(want.map((t) => [t, 0]));
  for (let i = 0; i < N; i += 1) {
    const s = defaultSettings(data);
    s.eras = ["edo"];
    s.girl = true;
    const seed = 880000 + i;
    const names = new Set(
      drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed).positive.split(",").map((t) => t.trim())
    );
    for (const t of want) if (names.has(t)) hit[t] += 1;
  }
  // 實測 obi 46、sash 43。門檻取 10：離實測有四倍餘裕，離壞掉的 0 非常遠。
  if (want.every((t) => hit[t] >= 10)) {
    console.log(`ok   江戶的腰部配件抽得到：${want.map((t) => `${t} ${hit[t]}`).join("、")}`);
  } else {
    console.log("");
    console.log(`FAIL 江戶的腰部配件抽不到  ${want.map((t) => `${t} ${hit[t]}`).join("、")}（各需 >=10）`);
    console.log("  規格：mutex 空的配件在 normal 模式一律抽不到。腰上的東西要有 waist 格，");
    console.log("        而且 waist 要在 fill(\"clothing\") 的 outfit 白名單裡。");
    console.log("");
    console.log("1 條 hard 不變式被違反");
    process.exit(1);
  }
}

// --- 針對性複查：全年齡的中世紀男性浴場要交代身體 ----------------------------
//
// 面板組合全掃（405 種 x 800 張）掃出來的：異常只集中在 medieval，而且是男性。
// 追下去是全年齡 + 中世紀 + 男性 + 洗澡時，每一個浴場衣物都被擋掉：
//   wet clothes / naked towel / nude -> 分級擋；loincloth / fundoshi -> 分級擋；
//   chemise -> female-only；bathrobe / yukata -> 時代不對。
// 唯一活得下來的是 towel（era any、gate any、全年齡不擋），但它 layer=accessory、
// mutex 空，normal 模式的 fill("clothing") 挑不到 —— 於是 85/2000 的圖整張沒有
// 任何衣物或裸標。既有問題（loop 之前是 86/2000）。
{
  const N = 2000;
  let noBody = 0;
  const ex = [];
  for (let i = 0; i < N; i += 1) {
    const s = defaultSettings(data);
    s.eras = ["medieval"];
    s.girl = false;
    s.boy = true;
    s.rating = "general";
    s.heats = ["activity"];
    const seed = 770000 + i;
    const tags = drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed)
      .positive.split(",").map((t) => t.trim());
    const body = tags.some((t) => {
      const it = lex.byTag.get(t);
      return it && it.section === "clothing" &&
        (it.layer === "garment" || it.layer === "skin" || t === "towel");
    });
    if (!body) { noBody += 1; if (ex.length < 2) ex.push("seed=" + seed); }
  }
  if (noBody === 0) {
    console.log("ok   全年齡中世紀男性浴場交代得出身體：" + N + " 張全部有衣物或浴巾");
  } else {
    console.log("");
    console.log("FAIL 全年齡中世紀男性有 " + noBody + "/" + N + " 張沒交代身體");
    console.log("  規格：每張圖都要說得出身上有什麼。那個組合下浴場衣物全被分級或性別擋掉，");
    console.log("        唯一剩的 towel 又沒有互斥格 —— 補救池空了要退回 towel。");
    for (const e of ex) console.log("  重播：" + e);
    console.log("");
    console.log("1 條 hard 不變式被違反");
    process.exit(1);
  }
}

// --- 針對性複查：腰上的東西抽得到 --------------------------------------------
//
// obi／sash／belt 都是 layer=accessory 且 mutex 空，而 normal 模式的
// fill("clothing") 只放行 outfit 白名單裡的互斥格 —— 白名單沒有腰這一格，
// 所以它們一律抽不到。實測江戶 3000 張 obi 0、sash 0（weird 模式才有 82／69）。
// obi 偏偏是江戶最具代表性的配件。給它們 waist 格（腰帶本來一次只繫一條）。
{
  const N = 3000;
  const want = ["obi", "sash"];
  const hit = Object.fromEntries(want.map((t) => [t, 0]));
  for (let i = 0; i < N; i += 1) {
    const s = defaultSettings(data);
    s.eras = ["edo"];
    s.girl = true;
    const seed = 880000 + i;
    const names = new Set(
      drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed).positive.split(",").map((t) => t.trim())
    );
    for (const t of want) if (names.has(t)) hit[t] += 1;
  }
  // 實測 obi 46、sash 43。門檻取 10：離實測四倍餘裕，離壞掉的 0 非常遠。
  if (want.every((t) => hit[t] >= 10)) {
    console.log("ok   江戶的腰部配件抽得到：" + want.map((t) => t + " " + hit[t]).join("、"));
  } else {
    console.log("");
    console.log("FAIL 江戶的腰部配件抽不到  " + want.map((t) => t + " " + hit[t]).join("、") + "（各需 >=10）");
    console.log("  規格：mutex 空的配件在 normal 模式抽不到。腰上的東西要有 waist 格，");
    console.log("        而且 waist 要在 outfit 白名單裡。");
    console.log("");
    console.log("1 條 hard 不變式被違反");
    process.exit(1);
  }
}

// 女僕：場地要夠多元，而且不會被丟去運動。
//
// 這兩條是同一次改動的正反面。女僕原本只有六個場地，其中兩個是歷史時代限定，
// 所以現代的女僕只有四個地方可去、一半以上在客廳 —— 一件很常抽到的衣服每次都長一樣。
// 補了走廊／陽台／溫室／書房／庭園之後是九種，客廳從 53% 降到 34%。
//
// 反面是：**補場地會改變這件衣服跟哪些活動相容**。我第一版連 courtyard 一起補，
// 而 courtyard 是 sports.js 的運動場地，於是女僕突然跟運動場合相容，
// playing sports／training／exercising 開始跟女僕裝一起抽出來，而那些活動真正的
// 場地清單裡沒有 courtyard —— 3000 張裡冒出 178 張運動圖，每一張都沒有場地。
// 所以多元那條要配一條「沒有把不相容的活動一起放進來」才算數。
{
  const N = 1500;
  const SPORTY = ["training", "exercising", "playing sports"];
  const pinMaid = applyPin(lex, new Set(), new Set(), "maid").pinned;
  const kinds = new Set();
  let sporty = 0;
  let firstSporty = null;
  for (let i = 0; i < N; i += 1) {
    const s = defaultSettings(data);
    s.girl = true;
    const seed = 451000 + i;
    const names = drawOne(lex, s, pinMaid, new Set(), mulberry32(seed), seed)
      .positive.split(",").map((t) => t.trim());
    if (!names.includes("maid")) continue;
    for (const t of names) {
      const it = lex.byTag.get(t);
      if (it && (it.mutex === "place" || it.group === "place")) kinds.add(t);
    }
    if (SPORTY.some((t) => names.includes(t))) {
      sporty += 1;
      if (!firstSporty) firstSporty = { seed, pos: names.join(", ") };
    }
  }
  // 實測九種（壞掉的版本是四種）。門檻取 7：離實測有餘裕，離壞掉的很遠。
  if (kinds.size >= 7 && sporty === 0) {
    console.log(`ok   女僕的場地夠多元且沒混進運動：${kinds.size} 種場地、運動 0/${N}`);
  } else {
    console.log("");
    if (kinds.size < 7) {
      console.log(`FAIL 女僕的場地不夠多元  只有 ${kinds.size} 種（需要 >=7）：${[...kinds].join("、")}`);
      console.log("  規格：女僕是很常抽到的一件衣服，場地不能只剩客廳。JOB_PLACE.maid 裡");
      console.log("        屬於現代的項目太少時就會這樣 —— mansion 是維多利亞、palace 是古代。");
    }
    if (sporty > 0) {
      console.log(`FAIL 女僕被丟去運動  ${sporty}/${N} 張`);
      console.log("  規格：allow() 裡有一條「場上有女僕時，活動候選必須至少能在女僕的某個");
      console.log("        場地發生」。JOB_PLACE.maid 只要收進一個同時屬於 SPORT_PLACE 的字，");
      console.log("        運動活動就通過那一關、跟女僕裝一起抽出來；但那一關不看時代，");
      console.log("        所以放行理由在現代不成立時，場地那一格誰也排不進去。");
      console.log("        courtyard 就是這樣的一個字（era 只有古代），刻意沒有補進 maid。");
      console.log(`  重播：seed=${firstSporty.seed}`);
      console.log(`  POS：${firstSporty.pos}`);
    }
    console.log("");
    console.log("1 條 hard 不變式被違反");
    process.exit(1);
  }
}

// 沒有任何一格被單一個字吃掉。
//
// 可達性測試對這種問題是全盲的：那個字不但抽得到，還抽爆了。實際發生過兩次，
// 都是我加字時把一個「永遠成立」的字放進一個「有優先序」的格子：
//
//   lifting own clothes 放進 clothes_action（那一格是給 shirt pull 這種
//   需要特定衣服的動作用的），engine 在 flash 會先填那一格、填成功就不再走
//   多樣的 flash 群 —— 於是它佔掉 flash 暴露動作的 88.1%，種類從 52 掉到 40。
//
//   under table 放進 furniture，它幾乎不跟任何姿勢衝突，佔掉那一格的 64%，
//   還把 on bed 從 8 擠到 3 —— 而且畫面上根本沒有桌子。
//
// 下面的豁免清單是**手寫**的，只放「本來就該集中」的格子：人數格就是該以
// 1girl 為主、室內外只有兩個值、裸露和 feature/sex 各只有兩三個字。
// 其餘每一格都不准被單一個字吃掉超過門檻。
{
  const N = 220;
  const EXEMPT = new Set([
    "subject/count_f", // 1girl 本來就該是大宗
    "subject/count_m",
    "subject/extra", // adult 是預設年齡
    "env/inout", // 只有 indoors / outdoors
    "feature/sex", // 整組只有兩個字
    "clothing/nude", // 整組只有三個字
  ]);
  // 實測最高的非豁免格是 clothing/bottom 41.3%（skirt），而出過事的兩次是
  // 88.1% 和 64%。門檻取 55：離實測有餘裕，離兩次事故都很遠。
  const CAP = 0.55;
  const perGroup = new Map();
  let drew = 0;
  for (const era of ERAS) {
    for (const heats of [["activity"], ["tease"], ["flash"], ["sex"]]) {
      for (let i = 0; i < N; i += 1) {
        const s = defaultSettings(data);
        s.eras = [era];
        s.girl = true;
        s.boy = true;
        s.heats = heats;
        s.weights = { activity: 0, tease: 0, flash: 0, sex: 0 };
        s.weights[heats[0]] = 1;
        const seed = 480000 + i;
        drew += 1;
        for (const t of drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed)
          .positive.split(",")
          .map((x) => x.trim())) {
          const it = lex.byTag.get(t);
          if (!it || it.section === "quality") continue;
          const g = `${it.section}/${it.group}`;
          if (EXEMPT.has(g)) continue;
          if (!perGroup.has(g)) perGroup.set(g, new Map());
          const m = perGroup.get(g);
          m.set(t, (m.get(t) || 0) + 1);
        }
      }
    }
  }
  const bad = [];
  let checked = 0;
  for (const [g, m] of perGroup) {
    const list = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const tot = list.reduce((sum, r) => sum + r[1], 0);
    if (tot < 40) continue; // 樣本太少的格子講不出比例
    checked += 1;
    const share = list[0][1] / tot;
    if (share > CAP) bad.push(`${g} 的 ${list[0][0]} 佔 ${(share * 100).toFixed(1)}%（共 ${list.length} 種）`);
  }
  if (!bad.length && checked >= 15) {
    console.log(`ok   沒有任何一格被單一個字吃掉（掃了 ${checked} 格、${drew} 張）`);
  } else {
    console.log("");
    if (bad.length) {
      console.log(`FAIL 有格子被單一個字吃掉  ${bad.length} 格`);
      for (const b of bad) console.log(`  ${b}`);
      console.log("  規格：把一個「永遠成立」的字放進一個「有優先序」的格子，等於把那一格關掉。");
      console.log("        可達性測試抓不到 —— 那個字不但抽得到，還抽爆了。");
    }
    if (checked < 15) {
      console.log(`FAIL 這條掃到的格子太少（${checked}），等於沒檢查`);
    }
    console.log("");
    console.log("1 條 hard 不變式被違反");
    process.exit(1);
  }
}

// 傢俱：抽得到，而且人真的在上面、而且在室內。
//
// 這一格本來是結構性餓死的：place／in_out／weather／day_night／lighting 都有
// 專屬的 fillSlot，只有 furniture 沒有，那六個字只能在通用的 fill("env") 裡跟
// 另外三百多個 env 字搶剩餘配額 —— 整格只有 0.4% 的圖填得到，連 on bed 這種
// 最基本的概念在 5184 張的面板掃描裡都是 0。跟天氣當初一模一樣的病。
//
// 而少數填得到的那些還不一定成立：基準線 24 張有傢俱的圖裡，8 張在室外、
// 4 張配著站姿。on bed／on chair 原本是 body_pose，搬到 env/furniture 之後
// 就脫離了姿勢相容那一整套檢查。
//
// 所以這條要同時守兩件事：**填得到**，而且**填得對**。只守其中一邊都會漏 ——
// 只守「填得到」會放過站在沙發上的人，只守「填得對」的話整格是空的也算通過。
{
  const N = 260;
  const FURN = ["on bed", "on chair", "on couch", "bunk bed", "on desk", "under table"];
  const UPRIGHT = ["standing", "walking", "running", "jumping", "standing split"];
  let drew = 0;
  let withFurn = 0;
  let upright = 0;
  let outdoor = 0;
  const kinds = new Set();
  let firstBad = null;
  for (const era of ERAS) {
    for (const heats of [["activity"], ["tease"], ["flash"], ["sex"]]) {
      for (let i = 0; i < N; i += 1) {
        const s = defaultSettings(data);
        s.eras = [era];
        s.girl = true;
        s.boy = true;
        s.heats = heats;
        s.weights = { activity: 0, tease: 0, flash: 0, sex: 0 };
        s.weights[heats[0]] = 1;
        const seed = 530000 + i;
        drew += 1;
        const names = drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed)
          .positive.split(",").map((x) => x.trim());
        const f = names.filter((t) => FURN.includes(t));
        if (!f.length) continue;
        withFurn += 1;
        for (const x of f) kinds.add(x);
        const up = names.filter((t) => UPRIGHT.includes(t));
        if (up.length) {
          upright += 1;
          if (!firstBad) firstBad = { seed, why: `${f.join("+")} 配 ${up.join("+")}`, pos: names.join(", ") };
        }
        if (names.includes("outdoors")) {
          outdoor += 1;
          if (!firstBad) firstBad = { seed, why: `${f.join("+")} 配 outdoors`, pos: names.join(", ") };
        }
      }
    }
  }
  // 實測約 112/6240（1.8%）、六種都出現過。門檻取 40 張與 4 種：
  // 離實測有餘裕，離「結構性餓死」的 24 張／基準線很遠。
  const enough = withFurn >= 40 && kinds.size >= 4;
  if (enough && upright === 0 && outdoor === 0) {
    console.log(`ok   傢俱抽得到且成立：${withFurn}/${drew} 張、${kinds.size} 種、站姿 0、室外 0`);
  } else {
    console.log("");
    if (!enough) {
      console.log(`FAIL 傢俱這一格又餓死了  只有 ${withFurn}/${drew} 張、${kinds.size} 種（需要 >=40 張且 >=4 種）`);
      console.log("  規格：env 的每一格都要有人填。furniture 沒有專屬的 fillSlot 時，");
      console.log("        它得跟三百多個 env 字搶剩餘配額，整格會掉到 0.4%。");
    }
    if (upright || outdoor) {
      console.log(`FAIL 傢俱上的人站著或人在室外  站姿 ${upright}、室外 ${outdoor}`);
      console.log("  規格：站著的人不會「在沙發上」，室外也沒有沙發。on bed／on chair");
      console.log("        原本是 body_pose，搬到 env/furniture 之後脫離了姿勢相容檢查。");
      if (firstBad) {
        console.log(`  重播：seed=${firstBad.seed}  ${firstBad.why}`);
        console.log(`  POS：${firstBad.pos}`);
      }
    }
    console.log("");
    console.log("1 條 hard 不變式被違反");
    process.exit(1);
  }
}

// 穿著要說得通：主衣只有一件、「只穿一件」名副其實、泳衣底下不穿內衣。
//
// 三個都是專案主回報「釘比基尼卻配上襯衫加裙子」之後查出來的，而且互相獨立：
//
// 1. 傘狀父項沒有互斥格。UMBRELLA 把 bikini／dress／shirt 這些通用詞的 mutex
//    清成 None，理由是「父項靠子項 implies 進場，父子不該搶同一格」。那對
//    「子項被抽到」是對的，但漏了「父項自己被抽到或被釘選」—— 那一格沒人佔，
//    引擎就以為主衣還空著。實測釘 bikini：shirt 261、skirt 258、pants 142。
//    對照組 white dress／micro bikini（有格子）一件上衣下身都不會有。
//
// 2. 「只穿一件」從來沒有生效過。naked coat 的意思是除了大衣什麼都沒穿，
//    但它的格子是 outer，擋不住洋裝和內衣。實測出現這六個字的 190 張，
//    **190 張身上都還穿著別的衣服**。
//
// 3. 泳衣底下穿內衣。比基尼配運動內褲是穿兩層。
{
  const N = 220;
  const NAKED_ONLY = ["naked sweater", "naked shirt", "naked apron", "naked towel", "naked coat", "naked jacket"];
  const BODY_GROUP = new Set(["onepiece", "top", "bottom", "underwear", "era"]);
  const isSwim = (t) => t.includes("bikini") || t.includes("swimsuit");
  let drew = 0;
  let twoMain = 0;
  let nakedBad = 0;
  let swimUnder = 0;
  let firstBad = null;
  const note = (why, seed, names) => {
    if (!firstBad) firstBad = { why, seed, pos: names.join(", ") };
  };
  for (const era of ERAS) {
    for (const heats of [["activity"], ["tease"], ["flash"], ["sex"]]) {
      for (let i = 0; i < N; i += 1) {
        const s = defaultSettings(data);
        s.eras = [era];
        s.girl = true;
        s.boy = true;
        s.heats = heats;
        s.weights = { activity: 0, tease: 0, flash: 0, sex: 0 };
        s.weights[heats[0]] = 1;
        const seed = 620000 + i;
        drew += 1;
        const names = drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed)
          .positive.split(",").map((x) => x.trim());
        const worn = names.filter((t) => {
          const it = lex.byTag.get(t);
          return it && it.section === "clothing" && it.layer === "garment";
        });
        // （主衣只有一件那一條改用釘選驗，見這個區塊下面 —— 隨機抽圖看不到它。）
        // 「只穿一件」：身上不該還有別的主衣或內衣（它自己 implies 的父項不算）。
        const nk = names.filter((t) => NAKED_ONLY.includes(t));
        if (nk.length) {
          const kin = new Set(nk.flatMap((t) => lex.byTag.get(t)?.implies || []));
          const other = worn.filter((t) => !nk.includes(t) && !kin.has(t) && BODY_GROUP.has(lex.byTag.get(t)?.group));
          if (other.length) { nakedBad += 1; note(`${nk.join("+")} 卻還穿著 ${other.join("、")}`, seed, names); }
        }
        // 泳衣底下不穿內衣。
        if (worn.some((t) => isSwim(t))) {
          const u = worn.filter((t) => lex.byTag.get(t)?.group === "underwear");
          if (u.length) { swimUnder += 1; note(`泳衣配內衣 ${u.join("、")}`, seed, names); }
        }
      }
    }
  }
  // 主衣只有一件 —— **必須用釘選來驗**。
  //
  // 第一版寫在上面的隨機抽圖迴圈裡，結果是假綠：換回沒有互斥格的舊詞庫照樣通過。
  // 原因是通用詞（bikini／dress）平常很少被抽成主衣（bikini 在 2400 張裡只有 2 次），
  // 所以隨機掃描根本碰不到那個洞。專案主是**釘選比基尼**才發現的，
  // 那就照他發現它的方式測。
  const PIN_MAIN = ["bikini", "dress", "swimsuit", "leotard"];
  let pinBad = 0;
  let firstPin = null;
  for (const want of PIN_MAIN) {
    const pin = applyPin(lex, new Set(), new Set(), want).pinned;
    for (let i = 0; i < 200; i += 1) {
      const s2 = defaultSettings(data);
      s2.girl = true;
      s2.boy = false;
      const seed = 640000 + i;
      const names = drawOne(lex, s2, pin, new Set(), mulberry32(seed), seed)
        .positive.split(",").map((x) => x.trim());
      if (!names.includes(want)) continue;
      const clash = names.filter((t) => {
        const it = lex.byTag.get(t);
        return it && it.section === "clothing" && it.layer === "garment" &&
               (it.group === "top" || it.group === "bottom");
      });
      if (clash.length) {
        pinBad += 1;
        if (!firstPin) firstPin = { want, seed, clash: clash.join("、"), pos: names.join(", ") };
      }
    }
  }
  if (!twoMain && !nakedBad && !swimUnder && !pinBad) {
    console.log(`ok   穿著說得通：${drew} 張 + 釘主衣 ${PIN_MAIN.length}×200，整套配單件 0、只穿一件卻沒有 0、泳衣配內衣 0`);
  } else {
    console.log("");
    console.log(`FAIL 穿著矛盾  釘主衣卻配上單件 ${pinBad}、兩件主衣 ${twoMain}、只穿一件卻還穿別的 ${nakedBad}、泳衣配內衣 ${swimUnder}`);
    if (firstPin) {
      console.log(`  釘 ${firstPin.want} 卻同時穿著 ${firstPin.clash}（seed=${firstPin.seed}）`);
      console.log(`  POS：${firstPin.pos}`);
    }
    console.log("  規格：主衣一次一件；「只穿一件」要名副其實；泳衣不是內衣外面再穿一層。");
    if (firstBad) {
      console.log(`  重播：seed=${firstBad.seed}  ${firstBad.why}`);
      console.log(`  POS：${firstBad.pos}`);
    }
    console.log("");
    console.log("1 條 hard 不變式被違反");
    process.exit(1);
  }
}

// 手上拿的東西要對得上時代，而且不要每一張都一樣。
//
// 兩半都要守，理由跟服裝那條一樣：只守「不錯置」的話，把整張 ACT_PROP 清空
// 也會通過（沒有道具就沒有錯置）；只守「夠多元」的話，江戶人拿著香菸跟雪茄
// 交替出現也算過關。
//
// 錯置那一半是實測出來的，不是假想：修之前每格 700 張，江戶抽菸 22/22 拿香菸、
// 維多利亞 62/62 也是；古中國、古希臘、中世紀、江戶寫字 50/50 拿原子筆。
// 原因是 cigarette 與 pen 掛著 era=["any"]，而 ACT_PROP 每一項只有一個字，
// 所以它們贏遍所有時代。
//
// 下面兩張表都是**這裡自己寫的**，不從 lexicon 的 era 欄反射 —— 反射的話，
// 把 cigarette 改回 era=["any"] 這條就會跟著鬆掉，等於沒在守。
{
  const N = 700;
  // 哪個時代不該出現哪個道具。理由寫在旁邊，改這裡等於改產品承諾。
  const WRONG_ERA = [
    ["edo", "cigarette", "江戶抽的是煙管，紙菸是明治以後的事"],
    ["edo", "pen", "江戶寫字用毛筆"],
    ["edo", "pencil", "同上"],
    ["ancient_china", "pen", "古中國寫字用毛筆"],
    ["ancient_china", "pencil", "同上"],
    ["ancient_china", "cigarette", "菸草是新大陸作物"],
    ["ancient_greece", "pen", "原子筆在古希臘是穿越"],
    ["ancient_greece", "pencil", "同上"],
    ["ancient_greece", "cigarette", "同上"],
    ["medieval", "pen", "中世紀寫字用羽毛筆"],
    ["medieval", "pencil", "同上"],
    ["medieval", "cigarette", "菸草還沒傳進歐洲"],
    ["ancient_china", "mop", "拖把是現代清潔用具"],
    ["ancient_greece", "mop", "同上"],
    ["medieval", "mop", "同上"],
    ["edo", "mop", "同上"],
    ["ancient_china", "newspaper", "報紙是近代產物"],
    ["ancient_greece", "newspaper", "同上"],
    ["medieval", "newspaper", "同上"],
    ["edo", "newspaper", "同上"],
  ];
  // 哪個時代的哪個活動要看得到不只一種道具。數字是「至少要出現幾種」。
  const WANT_VARIETY = [
    ["modern", "writing", ["pen", "pencil"], 2],
    ["modern", "cleaning", ["broom", "mop", "bucket"], 3],
    ["victorian", "smoking", ["cigarette", "cigar", "smoking pipe"], 3],
    ["victorian", "writing", ["pen", "quill"], 2],
    ["medieval", "cooking", ["frying pan", "ladle"], 2],
  ];
  // 哪個時代的哪個活動一定要拿到那個對的東西（正向的一半）。
  const WANT_RIGHT = [
    ["edo", "smoking", "kiseru"],
    ["edo", "writing", "calligraphy brush"],
    ["ancient_china", "writing", "calligraphy brush"],
    ["medieval", "writing", "quill"],
  ];
  const wrongHits = [];
  const seen = new Map();   // era|act -> Set(道具)
  const actOf = new Map();  // 道具 -> 活動（只為了報錯時講得清楚）
  let drew = 0;
  for (const era of ERAS) {
    for (const heats of [["activity"], ["tease"]]) {
      for (let i = 0; i < N; i += 1) {
        const s = defaultSettings(data);
        s.eras = [era];
        s.girl = true;
        s.boy = true;
        s.heats = heats;
        s.weights = { activity: 0, tease: 0, flash: 0, sex: 0 };
        s.weights[heats[0]] = 1;
        const seed = 640000 + i;
        drew += 1;
        const names = drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed)
          .positive.split(",").map((x) => x.trim());
        const has = new Set(names);
        for (const [e, prop, why] of WRONG_ERA) {
          if (e === era && has.has(prop)) {
            wrongHits.push({ era, prop, why, seed, pos: names.join(", ") });
          }
        }
        for (const [e, act, props] of [...WANT_VARIETY, ...WANT_RIGHT.map((r) => [r[0], r[1], [r[2]]])]) {
          if (e !== era || !has.has(act)) continue;
          const k = era + "|" + act;
          if (!seen.has(k)) seen.set(k, new Set());
          for (const p of props) if (has.has(p)) { seen.get(k).add(p); actOf.set(p, act); }
        }
      }
    }
  }
  const thin = [];
  for (const [era, act, props, want] of WANT_VARIETY) {
    const got = seen.get(era + "|" + act) || new Set();
    if (got.size < want) thin.push(`${era} 的 ${act} 只看到 ${got.size} 種（${[...got].join("、") || "一種都沒有"}），要 ${want} 種：${props.join("、")}`);
  }
  const missing = [];
  for (const [era, act, prop] of WANT_RIGHT) {
    const got = seen.get(era + "|" + act) || new Set();
    if (!got.has(prop)) missing.push(`${era} 的 ${act} 從來沒拿到 ${prop}`);
  }
  if (!wrongHits.length && !thin.length && !missing.length) {
    console.log(`ok   道具對得上時代且不只一種：${drew} 張，錯置 0、${WANT_VARIETY.length} 組多元達標、${WANT_RIGHT.length} 組正解都抽得到`);
  } else {
    console.log("");
    if (wrongHits.length) {
      const f = wrongHits[0];
      console.log(`FAIL 道具穿越了  ${wrongHits.length} 次`);
      console.log(`  規格：${f.era} 不該出現 ${f.prop} —— ${f.why}`);
      console.log(`  重播：seed=${f.seed}`);
      console.log(`  POS：${f.pos}`);
    }
    if (thin.length) {
      console.log(`FAIL 道具永遠是同一個  ${thin.length} 組`);
      for (const t of thin) console.log("  " + t);
      console.log("  規格：ACT_PROP 的每一項是候選集合，stampActProps() 要從合格的裡面隨機挑。");
    }
    if (missing.length) {
      console.log(`FAIL 該時代的正解抽不到  ${missing.length} 組`);
      for (const m of missing) console.log("  " + m);
      console.log("  規格：擋掉錯的還不夠，對的那個要真的進得來（負向擋、正向拉，兩半要齊）。");
    }
    console.log("");
    console.log("1 條 hard 不變式被違反");
    process.exit(1);
  }
}

// 釘住一項運動，那項運動的器材就該在畫面裡。
//
// 修之前釘住運動各抽 300 張的實測：網球拍 2、足球 6、羽球拍 5、桌球拍 5、
// 高爾夫球桿 3、弓 3 —— **300 張網球圖裡有 298 張沒有球拍**。
// 器材在詞庫裡，但只能在通用的 fill("env") 裡跟三百多個 env 字搶剩餘配額，
// 跟天氣、光源、傢俱當初是同一種結構性餓死。
//
// 門檻刻意訂在實測值的一半上下（實測 52–88%），離壞掉的狀態（1–2%）非常遠，
// 但也不是隨便給個 1 次就算過 —— 那樣把機率調成 0.01 也會通過。
//
// 上限那一半同樣要守：器材不該是 100%。Danbooru 上網球圖也只有 78.6% 有球拍，
// 硬給 1.0 等於把「有時候鏡頭裡就是沒拍到球拍」這件事消掉。
{
  const CASES = [
    // 活動, 器材, 下限, 上限（比例）
    ["tennis", "tennis racket", 0.5, 0.95],
    ["tennis", "tennis ball", 0.25, 0.75],
    ["soccer", "soccer ball", 0.3, 0.8],
    ["golf", "golf club", 0.5, 0.95],
    ["badminton", "badminton racket", 0.5, 0.95],
    ["table tennis", "table tennis paddle", 0.6, 0.99],
    ["archery", "bow (weapon)", 0.6, 0.99],
    ["boxing", "boxing gloves", 0.5, 0.99],
  ];
  const N = 250;
  const bad = [];
  const lines = [];
  for (const [act, gear, lo, hi] of CASES) {
    const r = applyPin(lex, new Set(), new Set(), act);
    let got = 0;
    let withAct = 0;
    for (let i = 0; i < N; i += 1) {
      const s = defaultSettings(data);
      s.eras = ["modern"];
      s.girl = true;
      s.boy = true;
      s.heats = ["activity"];
      s.weights = { activity: 1, tease: 0, flash: 0, sex: 0 };
      const seed = 660000 + i;
      const has = new Set(
        drawOne(lex, s, r.pinned, r.userBanned, mulberry32(seed), seed).positive.split(",").map((t) => t.trim())
      );
      if (has.has(act)) withAct += 1;
      if (has.has(gear)) got += 1;
    }
    const pct = got / N;
    lines.push(`${act} -> ${gear} ${Math.round(pct * 100)}%`);
    if (withAct < N * 0.9) bad.push(`釘了 ${act} 卻只有 ${withAct}/${N} 張真的有它 —— 這條的前提壞了`);
    else if (pct < lo) bad.push(`${act} 只有 ${got}/${N}（${Math.round(pct * 100)}%）帶到 ${gear}，下限 ${Math.round(lo * 100)}%`);
    else if (pct > hi) bad.push(`${act} 有 ${got}/${N}（${Math.round(pct * 100)}%）帶到 ${gear}，上限 ${Math.round(hi * 100)}%`);
  }
  if (!bad.length) {
    console.log(`ok   釘運動就有器材：${CASES.length} 項各 ${N} 張（${lines.join("、")}）`);
  } else {
    console.log("");
    console.log(`FAIL 運動器材不在畫面裡  ${bad.length} 項`);
    for (const b of bad) console.log("  " + b);
    console.log("  規格：器材只靠通用 fill(\"env\") 搶配額是搶不到的（實測 300 張網球只有 2 張有球拍），");
    console.log("        要有 CTX_PULLS_GEAR 那樣的正向拉取；機率取自 Danbooru 共現率。");
    console.log("");
    console.log("1 條 hard 不變式被違反");
    process.exit(1);
  }
}

if (!hardHits.size) {
  console.log("hard：全部通過。");
  console.log("\nok");
  process.exit(0);
}

console.log("hard 違規：");
for (const [name, n] of [...hardHits.entries()].sort((a, b) => b[1] - a[1])) {
  const f = firstFail.get(name);
  const rule = HARD.find((r) => r.name === name);
  console.log(`\nFAIL ${name}  ×${n}`);
  console.log(`  規格：${rule.why}`);
  console.log(`  違反：${f.why}`);
  console.log(`  重播：seed=${f.seed} 設定=${f.scenario} mode=${f.mode} heats=${f.heats} eras=${f.eras} 抽中時代=${f.era} pins=${f.pins}`);
  console.log(`  POS：${f.pos}`);
}
console.log(`\n${hardHits.size} 條 hard 不變式被違反`);
process.exit(1);
