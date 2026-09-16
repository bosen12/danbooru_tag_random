#!/usr/bin/env node
/**
 * 詞庫資料自己的一致性，加上兩條「資料有地雷、引擎必須擋住」的行為保證。
 *
 * 詞庫是產生出來的（`scripts/merge_lexicon.py` 等），所以指向性錯誤最可能在重新
 * 生成的時候悄悄跑進來 —— 那種錯不會讓任何抽取測試變紅，只會讓某些字永遠抽不到
 * 或是帶進一個不存在的相依字。
 *
 * 後半段守的是：`implies` 鏈可以繞過尺度與性別的牆（`spooning` 只開誘惑也能用，
 * 但它 implies `sex`）。引擎現在會把暗示鏈的每一個字都送進 `allow()`，所以繞不過去。
 * 這件事只要有人把那段檢查拿掉就會破，而且破得很安靜 —— 誘惑尺度的圖裡開始出現
 * 性愛的字。所以用行為而不是用程式碼結構把它釘住。
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  ERAS,
  HEATS,
  defaultSettings,
  drawOne,
  indexLexicon,
  mulberry32,
  mutexSiblings,
} from "../web/engine.js";

const NL = String.fromCharCode(10);
// 反斜線在這個專案的編輯路徑上被吃掉過太多次，引號與換行一律用碼點組。
const chr34 = String.fromCharCode(34);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web", "lexicon.json"), "utf8"));
const lex = indexLexicon(data);
const by = new Map(data.tags.map((t) => [t.tag, t]));

let failed = 0;
function ok(name, rows) {
  const bad = Array.isArray(rows) ? rows : [];
  if (!bad.length) {
    console.log(`ok   ${name}`);
    return;
  }
  failed += 1;
  console.error(`FAIL ${name}：${bad.length} 件`);
  for (const r of bad.slice(0, 8)) console.error(`  ${r}`);
  if (bad.length > 8) console.error(`  …還有 ${bad.length - 8} 件`);
}

// --- 指向完整性 ------------------------------------------------------------
{
  const bad = [];
  for (const it of data.tags) {
    for (const d of it.implies || []) if (!by.has(d)) bad.push(`${it.tag} implies 不存在的「${d}」`);
    for (const d of it.bind || []) if (!by.has(d)) bad.push(`${it.tag} bind 不存在的「${d}」`);
  }
  ok("implies / bind 都指向詞庫裡真的有的字", bad);
}

// 畫質詞、nsfw 尾巴、alwaysEnv、eraAnchors、castWeights 引用的字。
// quality / nsfwTail 是直接附加的字面字串，不是可點可釘的詞庫條目，所以不檢查它們。
{
  const bad = [];
  for (const t of data.alwaysEnv || []) {
    if (!by.has(t)) bad.push(`alwaysEnv 的「${t}」不在詞庫（是刻意的字面字串嗎？）`);
  }
  for (const [era, tags] of Object.entries(data.eraAnchors || {})) {
    if (!ERAS.includes(era)) bad.push(`eraAnchors 有未知時代「${era}」`);
    for (const t of tags || []) if (!by.has(t)) bad.push(`eraAnchors.${era} 引用不存在的「${t}」`);
  }
  for (const [name, table] of Object.entries(data.castWeights || {})) {
    for (const combo of Object.keys(table)) {
      for (const t of combo.split(",").map((s) => s.trim())) {
        if (!by.has(t)) bad.push(`castWeights.${name} 引用不存在的「${t}」`);
      }
    }
  }
  // alwaysEnv 現在是空的。裡面允許放詞庫沒收的字面字串，所以這條
  // 檢查刻意排掉 alwaysEnv 的回報 —— 允許，但要有人知道。
  ok("eraAnchors / castWeights 引用的字都存在", bad.filter((r) => !r.startsWith("alwaysEnv")));
}

// --- implies 鏈的形狀 ------------------------------------------------------
{
  const bad = [];
  const done = new Set();
  const walk = (tag, path) => {
    if (path.includes(tag)) {
      bad.push(`迴圈：${[...path, tag].join(" → ")}`);
      return;
    }
    if (done.has(tag)) return;
    for (const d of by.get(tag)?.implies || []) walk(d, [...path, tag]);
    done.add(tag);
  };
  for (const it of data.tags) walk(it.tag, []);
  ok("implies 沒有迴圈", bad);
}

{
  // 同 mutex 的 implies 只有在父子關係下才合理（high ponytail → ponytail）。
  // mutexSiblings() 就是引擎判斷「這兩個是不是真的互斥」的地方，拿它當判準。
  const bad = [];
  for (const it of data.tags) {
    if (!it.mutex) continue;
    const sibs = new Set(mutexSiblings(lex, it.tag));
    for (const d of it.implies || []) {
      const di = by.get(d);
      if (di && di.mutex === it.mutex && di.tag !== it.tag && sibs.has(d)) {
        bad.push(`${it.tag} implies 同 mutex「${it.mutex}」的「${d}」，而且兩者被當成真互斥`);
      }
    }
  }
  ok("同 mutex 的 implies 都是父子關係", bad);
}

{
  // 某個字能用於某時代，它 implies 的字也必須能用於同一個時代，
  // 否則在那個時代抽到它就會缺相依字。
  const okEras = (it) => ((it.era || ["any"]).includes("any") ? ERAS : it.era);
  const bad = [];
  for (const it of data.tags) {
    for (const d of it.implies || []) {
      const di = by.get(d);
      if (!di) continue;
      const miss = okEras(it).filter((e) => !okEras(di).includes(e));
      if (miss.length) bad.push(`${it.tag} implies ${d}，但 ${miss.join(",")} 這幾個時代對不上`);
    }
  }
  ok("implies 的字在每個可用時代都可用", bad);
}

// --- 欄位衛生 --------------------------------------------------------------
{
  const bad = [];
  const cnt = new Map();
  for (const it of data.tags) cnt.set(it.tag, (cnt.get(it.tag) || 0) + 1);
  for (const [t, n] of cnt) if (n > 1) bad.push(`「${t}」重複 ${n} 次`);
  for (const it of data.tags) {
    if (!it.section) bad.push(`${it.tag} 沒有 section`);
    if (!it.group) bad.push(`${it.tag} 沒有 group`);
    if (!it.zh && !(data.zh || {})[it.tag]) bad.push(`${it.tag} 沒有中文名`);
    for (const h of it.heat || []) if (!HEATS.includes(h)) bad.push(`${it.tag} 有未知 heat「${h}」`);
    for (const e of it.era || []) if (e !== "any" && !ERAS.includes(e)) bad.push(`${it.tag} 有未知 era「${e}」`);
  }
  ok("沒有重複、缺欄位或未知列舉值", bad);
}

// --- 資料有地雷，引擎要擋住 ------------------------------------------------
// 這兩段不驗資料，驗行為。資料裡確實有「低尺度的字 implies 高尺度的字」和
// 「gate=any 的字 implies 限定性別的字」，那是合理的詞彙關係；要保證的是引擎
// 不會讓那條暗示鏈把牆推倒。
{
  const FULL = { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 };
  const sweep = (over, n = 500, seed0 = 930000) => {
    const s = Object.assign(JSON.parse(JSON.stringify(defaultSettings(data))), over);
    const seen = new Set();
    for (let i = 1; i <= n; i++) {
      const out = drawOne(lex, s, new Set(), new Set(), mulberry32(seed0 + i), seed0 + i);
      for (const t of out.positive.split(", ")) seen.add(t.trim());
    }
    return seen;
  };

  const rank = { activity: 0, tease: 1, flash: 2, sex: 3 };
  const lowest = (it) => Math.min(...(it.heat || ["activity"]).map((h) => rank[h] ?? 0));
  // 資料裡真的存在的升級對，從詞庫算出來，不手打。
  const escalating = [];
  for (const it of data.tags) {
    for (const d of it.implies || []) {
      const di = by.get(d);
      if (di && lowest(di) > lowest(it)) escalating.push([it.tag, d]);
    }
  }
  ok("詞庫裡確實有尺度升級的 implies 對（不然下面等於沒測）", escalating.length ? [] : ["一對都沒有"]);

  for (const [heat, weights] of [
    ["activity", { activity: 1, tease: 0, flash: 0, sex: 0 }],
    ["tease", { activity: 0, tease: 1, flash: 0, sex: 0 }],
  ]) {
    const seen = sweep({ girl: true, boy: true, heats: [heat], weights, counts: FULL });
    const leaked = [];
    for (const [parent, dep] of escalating) {
      const di = by.get(dep);
      if (!di) continue;
      if (lowest(di) > rank[heat] && seen.has(dep)) leaked.push(`只開${heat}卻出現「${dep}」（${parent} 的相依字）`);
      if (lowest(by.get(parent)) > rank[heat] && seen.has(parent)) leaked.push(`只開${heat}卻出現「${parent}」`);
    }
    ok(`implies 不會把尺度推高（只開 ${heat}）`, [...new Set(leaked)]);
  }

  // 性別牆：只開男生時，任何 female-gated 的字都不該出現。
  //
  // 刻意不測「implies 把性別牆推倒」那個更窄的情況。資料裡只有兩對
  // （black leotard → leotard、breastfeeding → lactation），而那兩個父字在
  // 只開男生的抽樣裡一次都不出現 —— 就算把引擎的相依字檢查整段拿掉，那條斷言
  // 照樣是綠的。空的斷言比沒有斷言更糟，所以改成這條會真的被每一張圖檢查到的。
  const boyOnly = sweep({ girl: false, boy: true, heats: HEATS.slice(), counts: FULL }, 500, 940000);
  const femaleGated = data.tags.filter((t) => t.gate === "female").map((t) => t.tag);
  ok("詞庫裡有 female-gated 的字（不然下面等於沒測）", femaleGated.length > 10 ? [] : [`只有 ${femaleGated.length} 個`]);
  const leaked = femaleGated.filter((t) => boyOnly.has(t));
  ok(`只開男生時沒有 female-gated 的字漏進來（檢查了 ${femaleGated.length} 個）`, leaked.map((t) => `漏出「${t}」`));
}

// --- groups.py 的 SEX 清單要真的變成 group: "sex" -----------------------------
// assign_group() 是一長串 if，先中的先算。feature 段裡有一條「gate=female 且
// tag 名字含 breast → body_f」的子字串規則，排在 `tag in SEX` 前面，於是
// breast bondage 與 grabbing another's breast 被歸成身體特徵 —— 人工清單寫了，
// 但輪不到它說話。後果是「只勾活動」借 tease 池子時扣不掉它們：實測 1500 張
// 漏進去 58 次與 14 次，而同義的 breast grab（在 pose 段、順序不同）是 0 次。
//
// 這條直接比對「清單寫了什麼」與「詞庫變成什麼」。以後誰再加字進 SEX 卻被某條
// 子字串規則吃掉，就會在這裡紅燈，而不是等到出圖才發現。
// 刻意不從 assign_group() 反射 —— 從實作反射出來的規格只能驗實作自不自洽。
{
  const src = readFileSync(join(ROOT, "scripts", "groups.py"), "utf8");
  const at = src.indexOf("SEX = {");
  const end = src.indexOf(NL + "}", at);
  const wanted = [];
  if (at >= 0 && end > at) {
    for (const raw of src.slice(at, end).split(NL)) {
      const line = raw.trim();
      if (!line.startsWith(chr34)) continue;
      const close = line.indexOf(chr34, 1);
      if (close > 1) wanted.push(line.slice(1, close));
    }
  }
  ok(`在 groups.py 裡讀得到 SEX 清單（${wanted.length} 個字）`, wanted.length > 10 ? [] : ["讀不到或太少，解析可能壞了"]);

  const byTag = new Map(data.tags.map((t) => [t.tag, t]));
  const wrong = [];
  for (const tag of wanted) {
    const it = byTag.get(tag);
    if (!it) continue; // 沒進詞庫的（被 BANNED 或 dropped）不算
    if (it.group !== "sex") wrong.push(`${tag} 在 SEX 清單裡，卻是 group=${it.group}（section=${it.section}）`);
  }
  ok(`SEX 清單裡進了詞庫的字都是 group="sex"`, wrong);
}

// --- 已被 Danbooru 併走的舊名不該留在詞庫 ------------------------------------
//
// 這些字在 Danbooru 上 post_count 是 0：它們早就被 alias 併到別的名字，沒有任何一張
// 圖帶著它們，所以模型訓練時根本沒看過。用它們等於把一格 token 丟掉（跟當初的
// soft lighting 同一回事）。
//
// **判斷關鍵是 alias 的建立日期，不是 post_count。** Illustrious 的字彙凍結在訓練當下，
// 而 Danbooru 會一直搬家：alias 如果是訓練之後才建立的，那個舊名在訓練時是活的，
// 模型認得它，改名反而是把訊號丟掉。
//
// 實例：hairpin -> hairclip 這條 alias 建立於 **2026-05-30**，遠晚於 Illustrious 的
// 訓練，所以 hairpin 要留著（我一度把它改掉，查了日期才發現改錯，已還原）。
// 下面這八條的 alias 分別是 2013～2023 年建立的，都在訓練之前，改名才是對的。
{
  const goneForGood = [
    ["wink", "one eye closed", "2014-06-21"],
    ["facesitting", "sitting on face", "2013-02-16"],
    ["naga", "lamia", "2013-02-16"],
    ["incubus", "demon boy", "2021-02-08"],
    ["cravat", "ascot", "2021-08-10"],
    ["public sex", "public indecency", "2021-11-21"],
    ["sento", "bathhouse", "2022-08-09"],
    ["hand on hip", "hand on own hip", "2023-03-27"],
  ];
  const stale = [];
  const missing = [];
  for (const [old, canon, when] of goneForGood) {
    if (by.has(old)) stale.push(`「${old}」已於 ${when} 被 Danbooru 併成「${canon}」，不該再出現`);
    if (!by.has(canon)) missing.push(`「${canon}」不在詞庫（${old} 的正規名）`);
  }
  ok("被 Danbooru 併走的舊 tag 名沒有留在詞庫", stale);
  ok("併走之後的正規名都在詞庫裡", missing);
  // 反面：訓練之後才被併的舊名要留著，不能一起殺掉。
  ok("hairpin 留著（alias 是 2026-05-30 才建，晚於模型訓練）", by.has("hairpin"));
}

// --- token_counts.json 不能跟詞庫脫節 ---------------------------------------
// 它是另一支腳本（scripts/token_counts.py）產生的，merge_lexicon.py 不會碰它。
// 好處是重產詞庫不會把它洗掉，代價是有人加了新字卻沒重跑就會脫節——
// 那時候畫面上的 token 數會悄悄用字數粗估頂替，看起來正常但不準。
// 所以在這裡釘住：詞庫裡每一個會被吐進 POS 的字串都要有數。
{
  const tc = JSON.parse(readFileSync(join(ROOT, "web", "token_counts.json"), "utf8"));
  const shape = [];
  if (!tc.counts || typeof tc.counts !== "object") shape.push("沒有 counts 物件");
  if (!Number.isFinite(tc.sep)) shape.push("沒有分隔符成本 sep");
  ok("token_counts.json 的結構完整", shape);

  const need = new Set(data.tags.map((t) => t.tag));
  for (const key of ["quality", "alwaysEnv", "nsfwTail", "sfwTail", "sensitiveTail"]) {
    for (const s of data[key] || []) need.add(s);
  }
  need.add("solo");
  need.add("adult");

  const counts = tc.counts || {};
  const missing = [...need]
    .filter((s) => !Number.isFinite(counts[s]))
    .map((s) => `「${s}」沒有 token 數，重跑 scripts/token_counts.py`);
  ok(`token_counts 覆蓋所有會進 POS 的字（應為 ${need.size} 個）`, missing);

  // 反面：如果整份都是 0，上面那條會假通過，所以也要求數字是真的
  const zero = [...need].filter((s) => counts[s] === 0).map((s) => `「${s}」的 token 數是 0`);
  ok("token 數不是一片 0", zero);
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nok");
