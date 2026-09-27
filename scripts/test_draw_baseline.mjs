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
  // 2026-09-27：精液類改成必須有男性。預設是單人女性，這些字離開性愛與走光的候選池，
  // 池子變小，同一顆亂數落到別的字。seed 100 是誘惑，池子沒變。五張都沒有陰莖或精液。
  // 2026-09-27 第二次：加 30 個色情字。單人女性能進池的（側乳、連身襪、乳貼、破損過膝襪、
  // 潮吹的愛液、觸手、肛塞這類）讓候選池變大，五張都換過。要一男一女的字沒有進這五張。
  // 2026-09-28：鳥瞰、貼地仰視進鏡頭池（誘惑、走光、性愛都進）。用過的保險套從三檔收成只有性愛，
  // 誘惑和走光的衣服池少一個字。要一男一女的粗暴類不進單人女性的池。五張仍是 1girl solo，
  // 沒有陰莖或粗暴。seed 42 不再出現 hand in panties，是鏡頭池和衣服池挪動了亂數，不是那個洞補上了。
  // 2026-09-28 第二次：現代、三檔都進的新衣服進了單人女性的衣服池（過膝靴、太陽眼鏡、髮帶這類）。
  // 女巫帽是中世紀／維多利亞，廚師職業預設不抽，這兩條不進預設池。五張仍是單人女性、沒有男生。
  // seed 1 抽到過膝靴。seed 100 變成 solo focus，是因為這張有 crowd，人只有一個時本來就會加。
  // 2026-09-28 第三次：舉手、走路、跑步、跳躍、四種髮型，以及瑪麗珍鞋、及膝靴、格裙進了單人女性的池。
  // 立乳不進誘惑。內射受孕和抓手腕要一男一女，不進這五張。五張仍是 1girl solo。
  // seed 100 抽到格裙。seed 2026 抽到內彎鬢髮。seed 100 這次沒有 crowd，所以是 solo 不是 solo focus。
  // 2026-09-28 第四次：第三輪 22 個新字進了單人女性的池。抓頭髮本來就在詞庫，沒有再加一筆。
  // 五張仍是 1girl solo，沒有男生。seed 999 抽到踮腳，連帶站著。seed 2026 抽到咧嘴笑。
  // 2026-09-28 第五次：loli 離開候選池（NEVER_DRAW，shota 一起，釘選也拿掉）。
  // 沒有水的濕、雪配泳衣、騎車配走跑跳、跳水配走跑劈腿、漂浮配走跑、被褥配直立、
  // 全身動作配半身構圖、沒有怪物的獠牙，這些組合不再成立。現代外套不再吃時代加權，
  // 聚光燈不再吃打光的時代加權。基本負面詞多了 loli, child, aged down，drawOne 不回傳
  // negative，這五張的 POS 不含那一串。五張仍是 1girl solo，沒有男生。
  1: {
    rng: 355,
    pos: "1girl, solo, pixie cut, purple eyes, green hair, swept bangs, small breasts, arm under breasts, bruise, hanging breasts, school uniform, no bra, panties aside, white coat, coat, kneehighs, female masturbation, seiza, wide shot, looking up, seductive smile, deep penetration, bamboo forest, outdoors, sunset, spotlight, rubble, christmas, nsfw, explicit, masterpiece, best quality, amazing quality",
  },
  42: {
    rng: 348,
    pos: "1girl, solo, very short hair, aqua eyes, blue hair, blunt bangs, large breasts, thighs, tanlines, collarbone, bathrobe, tiptoes, standing, worm's eye view, from below, looking around, dazed, masturbation, ofuro, bath, indoors, night, spotlight, curtains, nsfw, explicit, masterpiece, best quality, amazing quality",
  },
  100: {
    rng: 384,
    pos: "1girl, solo, medium hair, purple eyes, red hair, side ponytail, ponytail, gigantic breasts, muscular, bruise, pink shirt, shirt, jeans, pants, table tennis, standing split, worm's eye view, from below, looking at viewer, exhausted, school gym, indoors, day, silhouette, bubble, table tennis paddle, table tennis ball, nsfw, explicit, masterpiece, best quality, amazing quality",
  },
  999: {
    rng: 366,
    pos: "1girl, solo, long hair, grey eyes, orange hair, twin braids, braid, flat chest, saliva, tears, nude, earrings, female masturbation, lying, from above, looking to the side, seductive smile, one eye closed, bubble bath, bath, indoors, sunrise, sunbeam, silhouette, nsfw, explicit, masterpiece, best quality, amazing quality",
  },
  // 2026-09-23：走光補抽改成「所有成立的走光動作同一池、衣服吻合的權重 10」之後，
  // 這張的走光動作從 exhibitionism 換成 cameltoe（她穿 thong，吻合），場景跟著換。
  // 見 test_clothing_reachability.mjs 的走光段落與討論區同日那輪。
  2026: {
    rng: 400,
    pos: "1girl, solo, bob cut, grey eyes, black hair, hair intakes, large breasts, underboob, lactation, midriff, black pants, pants, bra visible through clothes, sleeveless shirt, shirt, torn thighhighs, thighhighs, reading, on one knee, worm's eye view, from below, looking back, surprised, shirt pull, book, shrine, outdoors, night, lamppost, chinese new year, nsfw, explicit, masterpiece, best quality, amazing quality",
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
// 2026-09-26 第二次：no humans／scenery／solo focus／people 進詞庫（只能釘），人群不進私人場地；
// 候選池多了被擋掉的字，同一顆亂數落點岔開，換成 b71e9966。
// 2026-09-27：精液類必須有男性才進池，四人性愛補上 foursome，雙手被佔的姿勢不再配手交。
// 單人女性的性愛／走光池變小；男性和兩邊都開的情境多了新字。指紋換成 a6b607a5。
// 2026-09-27 第二次：30 個色情字。單人女性能進的池子變大，男女都開的情境多了對象是女生的字。
// 只開男生的 200 張逐字沒變（b5ceecd7）。五張預設金標都仍是 1girl solo，沒有陰莖或精液。
// 指紋換成 98f71f39。
// 2026-09-28：鳥瞰與貼地仰視進鏡頭池（三檔都進），誘惑的鏡頭洗牌跟著變。
// 用過的保險套從三檔收成只有性愛，誘惑和走光的衣服池少一個字。
// 要一男一女的粗暴類在單人女性的池裡過不了 allow()，不進這條矩陣的抽取。
// 五張預設金標仍是 1girl solo，沒有陰莖或粗暴。指紋 98f71f39 → 9438e336。
// 2026-09-28 第二次：現代、三檔都進的新衣服進了單人女性的衣服池。
// 女巫帽不在現代，廚師職業預設關閉，這兩條自己不動預設矩陣。
// 開職業的那一格會抽到廚師。指紋 9438e336 → a578a1ef。
// 2026-09-28 第三次：舉手、走路、跑步、跳躍和四種髮型，以及瑪麗珍鞋、及膝靴、格裙進了單人女性的池。
// 立乳不進誘惑。未釘選的走路／跑步／跳躍在性愛熱度直接略過。
// 內射受孕、抓手腕要一男一女，女生單人的性愛抽不到；穴口滴精只要求女生，進得了。
// 指紋 a578a1ef → 9252d4cb。
// 2026-09-28 第四次：第三輪 22 個新字進池。抓頭髮本來是三檔的特徵，改成只有性愛、
// 要一男一女的姿勢，沒有另加同名的第二筆。單人女性的五張因此換過。
// 未釘選的站立劈腿在性愛直接略過。踮腳在性愛仍可抽。股縫和掩私處不進誘惑。
// 按住頭、抓頭髮要一男一女。指紋 9252d4cb → fff3a5d4。
// 2026-09-28 第五次：loli 離開候選池，亂數落點跟著挪。品質規則再改一次池子：
// 沒有水的濕拿掉、雪不配泳衣、騎車擋走跑跳、跳水擋走跑劈腿、漂浮擋走跑、
// 被褥擋直立、全身動作不配半身構圖、獠牙要先有怪物。現代外套從權重 30／20
// 降到普通衣服的 4／2，聚光燈從打光時代階的 4 降到 1。基本負面詞加了
// loli, child, aged down，drawOne 不回傳 negative，指紋不含那一串。
// 指紋 fff3a5d4 → a188bd33。
const MATRIX_GOLD = "a188bd33";

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
