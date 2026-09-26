#!/usr/bin/env node
/** Fixed-seed POS / RNG / draw timing baselines. Failures print and exit 1. */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { defaultSettings, drawOne, indexLexicon, mulberry32 } from "../web/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web/lexicon.json"), "utf8"));
const lex = indexLexicon(data);
const settings = defaultSettings(data);

let failed = 0;
function ok(name, cond, detail) {
  if (cond) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? "\n  " + detail : ""}`);
  }
}

const GOLD = {
  // 2026-09-26：詞庫加進背景、用色、打光、畫面特效、構圖共 47 個字，場地前面多了一格
  // 「背景」（現代、沒有活動時 12% 改用素色／圖樣背景），env 的候選池也跟著變大 ——
  // 五張全部換過一次。見 merge_lexicon.extra_look_tags 與 engine 的 BACKGROUND_CHANCE。
  1: {
    rng: 309,
    pos: "1girl, solo, pixie cut, purple eyes, green hair, wavy hair, small breasts, tusks, hair between eyes, skinny, school swimsuit, one-piece swimsuit, swimsuit, boots, green jacket, jacket, female masturbation, seiza, from behind, looking at mirror, serious, nipple tweak, grey background, simple background, spotlight, fantasy, sparkle, chromatic aberration, nsfw, explicit, masterpiece, best quality, amazing quality",
  },
  42: {
    rng: 311,
    pos: "1girl, solo, very short hair, aqua eyes, blue hair, straight hair, huge breasts, mature female, hair between eyes, blush, sweater, black skirt, skirt, kneehighs, white bra, bra, open cardigan, cardigan, masturbation, standing, upper body, looking ahead, happy, smile, white background, simple background, light rays, confetti, smoke, nsfw, explicit, masterpiece, best quality, amazing quality",
  },
  100: {
    rng: 380,
    pos: "1girl, solo, medium hair, purple eyes, red hair, ahoge, flat chest, two-tone hair, toned, armpits, qipao, sleeves rolled up, coat, fishnet thighhighs, thighhighs, sneakers, eating, indian style, profile, looking at breasts, angry, bouncing, living room, indoors, sunset, chinese new year, nsfw, explicit, masterpiece, best quality, amazing quality",
  },
  999: {
    rng: 366,
    pos: "1girl, solo, long hair, grey eyes, orange hair, parted bangs, medium breasts, breast bondage, body freckles, curvy, playboy bunny, open coat, coat, black panties, panties, white socks, socks, bra, female masturbation, reclining, from below, looking around, happy, smile, love hotel, indoors, on bed, day, reflection, nsfw, explicit, masterpiece, best quality, amazing quality",
  },
  // 2026-09-23：走光補抽改成「所有成立的走光動作同一池、衣服吻合的權重 10」之後，
  // 這張的走光動作從 exhibitionism 換成 cameltoe（她穿 thong，吻合），場景跟著換。
  // 見 test_clothing_reachability.mjs 的走光段落與討論區同日那輪。
  2026: {
    rng: 373,
    pos: "1girl, solo, bob cut, grey eyes, black hair, straight hair, medium breasts, hair flower, hair scrunchie, hair over one eye, nightgown, coat, thong, kneehighs, white bra, bra, drinking, reclining, facing away, looking at mirror, naughty face, cameltoe, living room, indoors, sunrise, ceiling light, silhouette, confetti, nsfw, explicit, masterpiece, best quality, amazing quality",
  },
};

function drawCounted(seed, opts) {
  let n = 0;
  const base = mulberry32(seed);
  const rand = () => {
    n += 1;
    return base();
  };
  const drawn = drawOne(lex, settings, new Set(), new Set(), rand, seed, opts);
  return { n, pos: drawn.positive, drawn };
}

for (const seed of Object.keys(GOLD).map(Number)) {
  const a = drawCounted(seed);
  const b = drawCounted(seed);
  ok(`seed ${seed} POS matches baseline`, a.pos === GOLD[seed].pos, a.pos);
  ok(`seed ${seed} RNG count matches baseline`, a.n === GOLD[seed].rng, String(a.n));
  ok(`seed ${seed} is deterministic`, a.pos === b.pos && a.n === b.n);
}

{
  const times = [];
  for (let i = 0; i < 30; i += 1) {
    const t0 = performance.now();
    drawOne(lex, settings, new Set(), new Set(), mulberry32(i), i);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  ok("drawOne median under 80ms", median < 80, `median=${median.toFixed(2)} p95=${p95.toFixed(2)}`);
  const t0 = performance.now();
  for (let i = 0; i < 100; i += 1) {
    drawOne(lex, settings, new Set(), new Set(), mulberry32(1000 + i), 1000 + i);
  }
  const batch = performance.now() - t0;
  ok("100 draws under 8s", batch < 8000, `batch100=${batch.toFixed(1)}ms`);
  console.log(`perf drawOne median=${median.toFixed(2)}ms p95=${p95.toFixed(2)}ms batch100=${batch.toFixed(1)}ms`);
}


// --- 情境矩陣的指紋 ---------------------------------------------------------
// 上面那五個金標只鎖住「預設設定」這一條路徑。要證明「這次只是把 allow() 裡的
// 判斷式重排、行為完全沒動」，一條路徑不夠 —— 重排會不會改變結果，要看的是
// 各種情境下每一張圖的每一個 byte。
//
// 不把四千條 POS 寫進檔案（那會讓這支測試變成一本字典）。改成把整個矩陣雜湊成
// 一個指紋：只要任何一張圖的 POS 或 NEG 差一個 byte，指紋就變。
//
// 這條守衛的用法跟金標一樣：真的要改抽取行為時，它會紅，那時候人要看過差異、
// 確認那是想要的改變，再把新指紋寫回來。它抓的是「以為自己沒改到東西」。
const MATRIX_CONTEXTS = [
  {},
  { sceneMode: "weird", lockScene: false },
  { sceneMode: "diverse" },
  { heats: ["sex"] },
  { heats: ["activity"] },
  { heats: ["tease"] },
  { eras: ["edo"] },
  { eras: ["victorian"] },
  { eras: ["ancient_greece"] },
  { drawJob: true },
  { girl: false, boy: true },
  { girl: true, boy: true },
];
const MATRIX_SEEDS = 200;
// 8d903972 是重排 allow() 之前算的，重排之後一模一樣。
// 2026-09-23 刻意改了抽取行為，換成 31cc5db8。改之前逐張比對過 2405 張：
//   不同的 41 張 = 1 張走光（補抽改成同一池）+ 40 張性愛；
//   只把 rules/clothing.js 換回舊版時，只剩那 1 張走光不同，
//   其餘 203 張性愛／2001 張誘惑／200 張活動逐字相同。
// 那 40 張性愛是 sports bra lift（原本任何胸罩都算）和 downblouse（原本只認 blouse）
// 兩個衣服條件修正後，allow() 過濾出的候選池大小變了，同一個亂數挑到不同位置 ——
// 這 40 張裡一次都沒出現那兩個字本身。
// 2026-09-23 第二次：現代的鞋子與布料不再吃時代專屬加權（sneakers 47%→、latex 53%→），
// 換成 2d85ba0f，seed 100／999／2026 跟著換。逐張比過 2405 張：不同 1570 張，全部是現代；
// 古代 0 張不同。對照組 —— 同一份新引擎只把 MODERN_PLAIN_SLOTS 清空 —— 2405 張逐字相同，
// 所以差異 100% 來自這一條。其中 184 張新舊都沒有鞋子／布料的字：衣服補抽時整個候選池的
// 總權重變了，同一個亂數落在別件衣服上，後面整張岔開。
// 2026-09-26：詞庫加進背景／用色／打光／畫面特效／構圖 47 個字，場地前面多一格「背景」，
// 純色背景擋掉天空、天氣、景物與場景光。env 的候選池變大、RNG 呼叫次數跟著變。
// 背景格不走有專屬場地的職業、運動、泡澡游泳（test_engine「sex+pin firefighter always has a
// place」抓到的），那些情境不再擲背景那一顆骰子，所以矩陣裡的職業／運動情境跟著岔開，換成 4e0df84a。
// 新規則另外用 2000 張隨機＋各種釘選掃過：背景配場地／室內外／時段／天空／場景光 0、
// 室內落葉 0、夜晚陽光 0、同時兩個畫面特效 0。
const MATRIX_GOLD = "4e0df84a";

function matrixSettings(over) {
  const s = defaultSettings(data);
  s.sceneMode = "normal";
  s.lockScene = true;
  s.eras = ["modern"];
  s.heats = ["mixed"];
  s.girl = true;
  s.boy = false;
  s.counts = { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 };
  return Object.assign(s, over);
}

// FNV-1a：不引 node:crypto，這裡只要「差一個 byte 就不同」，不需要密碼學強度。
function fingerprint(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= (text.charCodeAt(i) >> 8) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

{
  let acc = "";
  let n = 0;
  for (const over of MATRIX_CONTEXTS) {
    const s = matrixSettings(over);
    for (let seed = 42; seed < 42 + MATRIX_SEEDS; seed += 1) {
      const out = drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed);
      acc += out.positive + "\u0000" + out.negative + "\u0001";
      n += 1;
      if (acc.length > 200000) {
        acc = fingerprint(acc);
      }
    }
  }
  const got = fingerprint(acc);
  ok(
    `情境矩陣 ${MATRIX_CONTEXTS.length} 種 × seed 42..${41 + MATRIX_SEEDS}（${n} 張）逐字指紋`,
    got === MATRIX_GOLD,
    `指紋 ${got}，金標 ${MATRIX_GOLD} —— 有東西改到抽取結果了`,
  );
}

// --- allow() 的關卡順序 -----------------------------------------------------
// 量到的事實：allow() 有 272 道關卡、每抽一張被呼叫 2141 次，而 66% 的拒絕來自
// 三道 O(1)、只看候選字自己的純判斷式 —— 它們原本排在第 9、第 10、和最後一位。
// 排在它們前面的 supportCandidateAllowed 每次呼叫配置一個物件，佔總時間 6.5%，
// 由那 66% 一起埋單。把三道搬到最前面，量到快 27%，而且四千張逐字相同。
//
// 這條守衛守的是「別再被搬回去」。它不檢查快不快（那會是一條看機器心情的測試），
// 只檢查順序 —— 順序才是那 27% 的來源。
{
  const CR = String.fromCharCode(13);
  const src = readFileSync(join(ROOT, "web", "engine.js"), "utf8").split(CR).join("");
  const at = src.indexOf("  allow = (item, opts) => {");
  const body = src.slice(at, src.indexOf(String.fromCharCode(10) + "  };", at));
  const posOf = (needle) => body.indexOf(needle);
  const heat = posOf("!heatOk(item, heat) || !gateOk(item, female, male)");
  const era = posOf("!(opts && opts.skipEra) && !eraOk(item, era)");
  const mutex = posOf("for (const g of extraMutex(item))");
  const support = posOf("supportCandidateAllowed({");
  ok("allow() 裡三道便宜的關卡都還在", heat > 0 && era > 0 && mutex > 0 && support > 0);
  ok(
    "尺度／人選／時代排在 supportCandidateAllowed 前面",
    heat < support && era < support,
    `heat=${heat} era=${era} support=${support}`,
  );
  ok(
    "互斥格排在 supportCandidateAllowed 前面，不是留在最後一關",
    mutex < support,
    `mutex=${mutex} support=${support} —— 每抽一張有 195 個候選字走完 270 關才被它擋掉`,
  );
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("all ok");
