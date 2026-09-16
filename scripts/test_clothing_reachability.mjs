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

if (failed) process.exit(1);
