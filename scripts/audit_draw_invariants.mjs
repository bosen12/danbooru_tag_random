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
