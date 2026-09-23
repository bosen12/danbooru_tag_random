import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  defaultSettings,
  drawOne,
  indexLexicon,
  mulberry32,
} from "../web/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web", "lexicon.json"), "utf8"));
const lex = indexLexicon(data);
const settings = defaultSettings(data);
settings.girl = true;
settings.boy = true;
settings.heats = ["tease"];
settings.eras = ["modern"];
settings.sceneMode = "weird";
settings.lockScene = false;
settings.drawJob = true;
settings.counts = { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 };

const families = {
  top: new Set(["white shirt", "blue shirt", "black shirt", "green shirt", "pink shirt", "red shirt"]),
  bottom: new Set(["black skirt", "blue skirt", "brown skirt", "white skirt", "blue pants", "black pants"]),
  onepiece: new Set(["white dress", "blue dress", "red dress", "green dress", "pink dress", "purple dress"]),
};
const seen = new Map(Object.keys(families).map((key) => [key, new Set()]));
const fabrics = new Set(["wide sleeves", "frills", "long sleeves", "short sleeves", "sleeves rolled up", "detached sleeves", "puffy sleeves"]);
const jobs = new Set(["nurse", "doctor", "scientist", "construction worker"]);
const jobGear = new Set(["nurse cap", "lab coat", "stethoscope", "hard hat"]);
const seenFabric = new Set();
const seenJobs = new Set();
const seenJobGear = new Set();
let sleeveClashes = 0;

for (let i = 0; i < 1200; i += 1) {
  const seed = 920000 + i;
  const out = drawOne(lex, settings, new Set(), new Set(), mulberry32(seed), seed);
  const tags = new Set(out.positive.split(",").map((raw) => raw.trim()));
  for (const [family, wanted] of Object.entries(families)) {
    for (const tag of wanted) if (tags.has(tag)) seen.get(family).add(tag);
  }
  for (const tag of fabrics) if (tags.has(tag)) seenFabric.add(tag);
  for (const tag of jobs) if (tags.has(tag)) seenJobs.add(tag);
  for (const tag of jobGear) if (tags.has(tag)) seenJobGear.add(tag);
  if (tags.has("long sleeves") && tags.has("short sleeves")) sleeveClashes += 1;
}

let failed = 0;
for (const [family, tags] of seen) {
  if (tags.size) {
    console.log(`ok   clothing ${family} color variants are reachable: ${[...tags].join(", ")}`);
  } else {
    failed += 1;
    console.error(`FAIL clothing ${family} color variants are structurally starved`);
  }
}

if (seenFabric.size) console.log(`ok   fabric details are reachable: ${[...seenFabric].join(", ")}`);
else {
  failed += 1;
  console.error("FAIL clothing fabric details are structurally starved");
}
if (sleeveClashes === 0) console.log("ok   long sleeves and short sleeves never coexist");
else {
  failed += 1;
  console.error(`FAIL long sleeves and short sleeves coexist: ${sleeveClashes}/1200`);
}
if (seenJobs.size === jobs.size) console.log(`ok   jobs with implied gear are reachable: ${[...seenJobs].join(", ")}`);
else {
  failed += 1;
  console.error(`FAIL jobs with implied gear are blocked: missing ${[...jobs].filter((tag) => !seenJobs.has(tag)).join(", ")}`);
}
if (seenJobGear.size === jobGear.size) console.log(`ok   implied job gear lands: ${[...seenJobGear].join(", ")}`);
else {
  failed += 1;
  console.error(`FAIL implied job gear is missing: ${[...jobGear].filter((tag) => !seenJobGear.has(tag)).join(", ")}`);
}

// --- 用「預設設定」再量一次 ------------------------------------------------
//
// 上面那一段用的是 counts=10、weird 場景 —— 那是放大鏡，不是使用者拿到的東西
// （預設是 env:4、clothing:5、normal 場景）。放大鏡可以用來看訊號，但不能拿來
// 判定對錯：實測就發生過同一個修法在 counts=10 底下漂亮、在預設設定下完全是 0。
//
// 所以這一段刻意只用 defaultSettings()，只改必要的時代／性別。
{
  const reach = (label, tag, mut, N = 1500) => {
    let hit = 0;
    for (let i = 0; i < N; i += 1) {
      const s = defaultSettings(data);
      if (mut) mut(s);
      const seed = 480000 + i;
      const out = drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed);
      if (out.positive.split(",").some((t) => t.trim() === tag)) hit += 1;
    }
    if (hit > 0) {
      console.log(`ok   ${label}（預設設定下 ${hit}/${N}）`);
    } else {
      failed += 1;
      console.error(`FAIL ${label} is unreachable at default settings (0/${N})`);
    }
  };

  // chainmail 以前 mutex 是空的，於是跟 plate armor／leather armor 不一樣，
  // 永遠抽不到。補上 onepiece 之後才跟兩個手足並排。
  reach("chainmail is reachable", "chainmail", (s) => { s.eras = ["medieval"]; });

  // bra visible through clothes 以前被 needsBodyClothes() 的 /through clothes/
  // 抓成動作，要求身上另外有一件 bra —— 而所有 bra 都跟它搶同一個 underwear_top
  // 格，先有就沒格子、沒有就不給進。它是那一家十個字裡唯一抽不到的。
  reach("bra visible through clothes is reachable", "bra visible through clothes", null);

  // 傘要看天氣，而天氣自己在預設 env:4 底下就排不進去（place/in_out/day_night/
  // lighting 四格剛好把預設預算用完）。所以這裡刻意把 env 調高才驗 —— 驗的是
  // 「閘搬到 NEEDS_CONTEXT 之後真的通了」，不是「預設設定下看得到傘」。
  // 預設設定下看不看得到，要等天氣那格怎麼處理拍板，見討論區。
  //
  // 兩個方向都要驗，而且第二個方向**必須在奇葩模式下驗**。
  //
  // 傘有兩條入場路徑，各由這次修法的一半負責，而它們在不同模式才活著：
  //   normal —— 配件 mutex 是空的，通用的 fill("clothing") 根本挑不到它（那裡有一份
  //             outfit 白名單），所以唯一入口是 CTX_PULLS_ACC 的 rain -> umbrella，
  //             那條自己就帶著天氣，NEEDS_CONTEXT 永遠不會被觸發。
  //   weird  —— lockScene 關掉之後 fill("clothing") 會自由挑配件，傘於是可能在沒有
  //             天氣的情況下進場，這時才輪到 NEEDS_CONTEXT 把它刪掉。
  //
  // 實際量過（weird，2000 張）：進場 219 次、被 NEEDS_CONTEXT 刪掉 167 次、留下 52 次。
  // 第一版守衛把這條寫在 normal 模式，於是把 NEEDS_CONTEXT 整條刪掉它也不會紅 ——
  // 因為那條路徑在 normal 底下本來就沒在跑。這個註解是為了下一個人不要再踩一次。
  {
    const N = 1500;
    let hit = 0;
    const orphan = [];
    for (let i = 0; i < N; i += 1) {
      const s = defaultSettings(data);
      s.counts = { ...s.counts, env: 8, clothing: 10 };
      s.sceneMode = "weird";
      s.lockScene = false;
      const seed = 490000 + i;
      const tags = drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed)
        .positive.split(",").map((t) => t.trim());
      if (!tags.includes("umbrella")) continue;
      hit += 1;
      if (!tags.includes("rain") && !tags.includes("overcast")) orphan.push(seed);
    }
    if (hit > 0) {
      console.log(`ok   umbrella is reachable once the weather can be drawn（${hit}/${N}）`);
    } else {
      failed += 1;
      console.error(`FAIL umbrella is unreachable even with env raised (0/${N})`);
    }
    if (orphan.length === 0) {
      console.log("ok   umbrella never shows up without rain or overcast");
    } else {
      failed += 1;
      console.error(`FAIL umbrella appears with no weather: ${orphan.length}/${hit} (seeds ${orphan.slice(0, 3).join(", ")})`);
    }
  }
}

// --- 走光：要特定衣服的動作，衣服在場時要抽得到 ---------------------------------
// 走光補抽原本先填 clothes_action 那一格，而那一格只有 shirt pull／dress pull 這類字；
// 同樣要衣服、卻屬於 flash 群的 shirt lift／dress lift／skirt lift／upskirt／panty pull
// 只能等那一格失敗才輪得到。實測 3000 張現代走光：shirt pull 17.8%、dress pull 9.8%，
// shirt lift 0、dress lift 0，其餘這類 ≤0.3%。討論區 2026-09-21 那輪留下的待查項
// 「pose/flash 那七個有沒有真的被抽到」就是這個。
{
  const { actionFitsClothes } = await import("../web/rules/clothing.js");
  const report = (name, cond, detail) => {
    if (cond) console.log(`ok   ${name}`);
    else {
      failed += 1;
      console.error(`FAIL ${name}${detail ? " — " + detail : ""}`);
    }
  };
  // downblouse 是從領口往下看，任何上衣都成立；舊規則的 /blouse/ 子字串比對讓它
  // 只認 blouse 這一件（3000 張只有 42 張穿 blouse → 2 次）。
  report("downblouse 穿襯衫就成立", actionFitsClothes("downblouse", ["white shirt"]) === 2);
  report("downblouse 穿洋裝也成立", actionFitsClothes("downblouse", ["blue dress"]) === 2);
  report("downblouse 全裸不成立", actionFitsClothes("downblouse", ["nude"]) === 0);

  const flash = { ...defaultSettings(data), girl: true, boy: false, heats: ["flash"], eras: ["modern"], rating: "explicit" };
  const N = 1500;
  const acts = new Map();
  for (let i = 0; i < N; i += 1) {
    const seed = 930000 + i;
    const out = drawOne(lex, flash, new Set(), new Set(), mulberry32(seed), seed);
    for (const raw of out.sections.pose) acts.set(raw, (acts.get(raw) || 0) + 1);
  }
  const n = (t) => acts.get(t) || 0;
  report("shirt lift 抽得到", n("shirt lift") > 0, `0/${N}`);
  report("dress lift 抽得到", n("dress lift") > 0, `0/${N}`);
  const garmentFlash = ["shirt lift", "dress lift", "skirt lift", "sweater lift", "upskirt", "downblouse", "panty pull", "bra pull", "pants pull"];
  const total = garmentFlash.reduce((a, t) => a + n(t), 0);
  report(
    "要衣服的 flash 群動作合計至少 5%",
    total / N >= 0.05,
    `${total}/${N} = ${((total / N) * 100).toFixed(1)}%：${garmentFlash.map((t) => `${t} ${n(t)}`).join("、")}`,
  );
  // 反方向也要守：「要衣服的先抽」會讓 cameltoe／panty pull 永遠成立（內褲幾乎每張都在），
  // 不要衣服的四十幾個動作實測從 56.9% 掉到 18.9%。
  const { actionGarmentKeys } = await import("../web/rules/clothing.js");
  const flashTags = data.tags.filter((t) => t.group === "flash" || t.mutex === "clothes_action");
  const noGarment = flashTags.filter((t) => actionGarmentKeys(t.tag).length === 0).reduce((a, t) => a + n(t.tag), 0);
  report(
    "不要衣服的走光動作沒被擠掉（≥ 40%）",
    noGarment / N >= 0.4,
    `${noGarment}/${N} = ${((noGarment / N) * 100).toFixed(1)}%`,
  );
  const [topTag, topN] = flashTags.map((t) => [t.tag, n(t.tag)]).sort((a, b) => b[1] - a[1])[0];
  report("沒有哪個走光動作超過 10%", topN / N <= 0.1, `${topTag} ${((topN / N) * 100).toFixed(1)}%`);
  report("sports bra lift 只認 sports bra", actionFitsClothes("sports bra lift", ["white bra"]) === 0 && actionFitsClothes("sports bra lift", ["sports bra"]) === 2);
  report(
    "shirt pull 不再一家獨大（< 12%）",
    n("shirt pull") / N < 0.12,
    `shirt pull ${n("shirt pull")}/${N} = ${((n("shirt pull") / N) * 100).toFixed(1)}%`,
  );
}

// --- 現代的鞋子與布料：時代專屬加權不該讓一兩個字獨佔 ---------------------------------
// clothingPrefer 讓「這個時代專屬」的衣服權重 30／20、其他 4。古代這是對的（江戶該穿木屐）。
// 但現代的鞋子格只有 sneakers／cleats／high heels 是現代專屬，布料格只有 latex／fishnets，
// 加權全壓在它們身上：實測現代 3000 張 sneakers 佔鞋子 47%、latex 佔布料 53%。
// 涼鞋、靴子、襪子本來就是現代的東西，在現代不需要靠加權「顯示年代」。
{
  const report = (name, cond, detail) => {
    if (cond) console.log(`ok   ${name}`);
    else {
      failed += 1;
      console.error(`FAIL ${name}${detail ? " — " + detail : ""}`);
    }
  };
  const by = new Map(data.tags.map((t) => [t.tag, t]));
  const share = (era, mutex, N) => {
    const m = new Map();
    let total = 0;
    const casts = [{ girl: true, boy: false }, { girl: false, boy: true }, { girl: true, boy: true }];
    const heats = [["activity"], ["tease"], ["flash"], ["sex"], ["tease", "flash", "sex"]];
    for (let i = 0; i < N; i += 1) {
      const s = {
        ...defaultSettings(data),
        ...casts[i % 3],
        heats: heats[i % 5],
        eras: [era],
        rating: "explicit",
        sceneMode: ["normal", "diverse", "weird"][Math.floor(i / 3) % 3],
      };
      const seed = 940000 + i;
      const out = drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed);
      for (const t of out.sections.clothing) {
        if (by.get(t)?.mutex !== mutex) continue;
        m.set(t, (m.get(t) || 0) + 1);
        total += 1;
      }
    }
    const [top, n] = [...m].sort((a, b) => b[1] - a[1])[0] || ["-", 0];
    return { top, pct: total ? n / total : 0, m, total };
  };
  const feet = share("modern", "feet", 1500);
  report("現代的鞋子沒有一雙超過 35%", feet.pct < 0.35, `${feet.top} ${(feet.pct * 100).toFixed(0)}%`);
  report("現代的 sneakers 不再獨佔（< 25%）", (feet.m.get("sneakers") || 0) / feet.total < 0.25, `sneakers ${(((feet.m.get("sneakers") || 0) / feet.total) * 100).toFixed(0)}%`);
  const fabric = share("modern", "fabric", 1500);
  report("現代的 latex 不再獨佔（< 25%）", (fabric.m.get("latex") || 0) / fabric.total < 0.25, `latex ${(((fabric.m.get("latex") || 0) / fabric.total) * 100).toFixed(0)}%`);
  // 反方向：古代的時代專屬加權照舊 —— 江戶的鞋子仍以木屐／草履為主。
  const edo = share("edo", "feet", 900);
  const edoOwn = ["geta", "zouri"].reduce((a, t) => a + (edo.m.get(t) || 0), 0) / edo.total;
  report("江戶的鞋子仍以木屐／草履為主（≥ 60%）", edoOwn >= 0.6, `${(edoOwn * 100).toFixed(0)}%`);
}

if (failed) process.exit(1);
