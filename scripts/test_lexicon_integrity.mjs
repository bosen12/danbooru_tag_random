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
    // 這四個的正規名詞庫裡本來就有，舊名等於重複競爭同一個格子。實測（全時代
    // 男女 8000 張）舊名／正規名分別是 kissing 68 對 kiss 64、panting 14 對
    // heavy breathing 17、breast grab 2 對 grabbing another's breast 40，
    // 兩邊都在抽 —— 舊名那一半是 0 篇的死字，白佔名額。
    ["kissing", "kiss", "2013-02-16"],
    ["panting", "heavy breathing", "2013-02-16"],
    ["breast grab", "grabbing another's breast", "2023-04-11"],
    // chinese architecture 比較特別：它是古中國的**時代錨**，所以不能只是拿掉，
    // ERA_ANCHORS 要一起換成正規名，否則古中國會沒有錨。換完之後
    // east asian architecture 從 0 變成抽得到，古中國 1500 張有 1391 張帶著錨。
    ["chinese architecture", "east asian architecture", "2022-04-19"],
  ];
  const stale = [];
  const missing = [];
  for (const [old, canon, when] of goneForGood) {
    if (by.has(old)) stale.push(`「${old}」已於 ${when} 被 Danbooru 併成「${canon}」，不該再出現`);
    if (!by.has(canon)) missing.push(`「${canon}」不在詞庫（${old} 的正規名）`);
  }
  ok("被 Danbooru 併走的舊 tag 名沒有留在詞庫", stale);
  ok("併走之後的正規名都在詞庫裡", missing);

  // 2026-09-18：跑 verify_danbooru_tags.mjs --all 查完整個詞庫（1450 個字）之後
  // 移除的十四個。它們跟上面那批不一樣 —— **沒有 alias 紀錄**，就是單純
  // post_count 0：Danbooru 上一張圖都沒有用過，模型沒把它們當 tag 學過。
  //
  // 每一個的概念都已經有活著的字在詞庫裡承接（右欄），所以移除不會少掉功能。
  // 刪之前實測 8400 張：死字拿到的機會跟正規名幾乎對半分，例如
  // milf 286 對 mature female 242、violet eyes 396 對 purple eyes 498 ——
  // 也就是有一半的圖，那個概念是用模型沒學過的字寫的。
  const zeroPostGone = [
    ["milf", "mature female", 49915],
    ["violet eyes", "purple eyes", 1204091],
    ["pink nipples", "nipples", 1143509],
    ["presenting ass", "top-down bottom-up", 28886],
    ["one knee up", "legs up", 47696],
    ["pinned down", "restrained", 70854],
    ["self fondling", "grabbing own breast", 25489],
    ["open-air bath", "onsen", 24909],
    ["dormitory", "bedroom", 20863],
    ["food stall", "festival", 3588],
    ["nerd", "otaku", 1591],
    ["hobgoblin", "goblin", 4670],
    ["webtoon", "lineart", 16665],
    ["clean lines", "lineart", 16665],
  ];

  // 第二批（同一天）：這六個**曾經是真的 tag**，有過大量圖，是 2022～2023 年
  // 被 Danbooru 停用並改標的 —— 也就是模型 2024 年的訓練快照裡它們已經是 0 張，
  // 學到的是右欄那些替代字。判準是**停用時間 vs 訓練截止**，不是現在幾張：
  // 停用晚於 2024 的七個（presenting、hand in panties、inset…）反而要留著，
  // 那些在 verify_danbooru_tags.mjs 的 MODEL_VOCAB 裡各自記著日期。
  //
  // 移除前實測 8400 張：bangs 10.8%、amber eyes 9.9%、looking away 7.1%、
  // silver hair 6.5% —— 四個高頻的舊名合計佔掉三分之一的圖，而它們的替代字
  // 全部已經在詞庫裡跟它們搶同一個互斥格。
  const deprecatedGone = [
    ["bangs", "blunt bangs", "2023-03"],
    ["amber eyes", "yellow eyes", "2022-07"],
    ["silver hair", "grey hair", "2022-05"],
    ["looking away", "averting eyes", "2023-06"],
    ["creampie", "cum in pussy", "2022-06"],
    ["areolae", "large areolae", "2022-05"],
  ];
  const depZombie = [];
  const depNoHeir = [];
  for (const [dead, heir, when] of deprecatedGone) {
    if (by.has(dead)) depZombie.push(`「${dead}」已於 ${when} 被 Danbooru 停用改標，模型學到的是「${heir}」`);
    if (!by.has(heir)) depNoHeir.push(`「${heir}」不在詞庫（${dead} 移除後由它承接）`);
  }
  ok("2024 之前就停用的舊 tag 沒有留在詞庫", depZombie);
  ok("停用之後的替代字都在詞庫裡", depNoHeir);

  // 現代沒有時代錨：modern 在 Danbooru 是 artist 分類、post_count 0。
  // adult 也是 Danbooru 0 張。它唯一的作用是被無條件塞進每一張圖、藉著
  // 「shota 與 adult 互斥」讓 shota 抽不到 —— 也就是用一個模型沒學過的字繞一圈。
  // 那條規則已改寫成 engine.js 裡直接的「shota 不進自動抽牌」，這裡守住字別回來。
  ok("adult 沒有回到詞庫（0 張的字，作用已改寫成直接規則）", !by.has("adult"));

  // 中文標籤要能分辨。面板上的晶片只顯示中文（英文在 title 與 aria-label 裡），
  // 兩個字給同一個中文，使用者要一個一個滑過去才知道差別。
  // 2026-09-18 查出十三組：抬腿（legs up／leg lift）、外套（jacket／coat）、
  // 腰帶（belt／sash）、口交（fellatio／oral）…依 Danbooru wiki 的語意分開。
  {
    const seen = new Map();
    for (const t of data.tags) {
      const z = (t.zh || "").trim();
      if (!z) continue;
      if (!seen.has(z)) seen.set(z, []);
      seen.get(z).push(t.tag);
    }
    const dup = [...seen.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([z, list]) => `「${z}」同時給了 ${list.join("、")}`);
    ok("沒有兩個 tag 共用同一個中文", dup);
  }

  // add_zh.py 的 ZH 與 ITEMS 兩張表對同一個字給不同中文的問題，檢查放在
  // add_zh.py 自己的 check_tables() 裡 —— 那是那個檔案的資料完整性，
  // 產生的時候就該擋，不是等到這裡才發現。
  //
  // 這裡本來寫過一條「顏色複合字的中文要以底字結尾」的啟發式，但中文會做慣用
  // 縮寫（藍褲 vs 長褲、黑裙 vs 裙子），那條會抓出十七件假陽性。
  // 假陽性比漏抓更糟：它會訓練人忽略這條測試。

  ok("現代沒有時代錨（modern 不是 Danbooru tag）", !(data.eraAnchors || {}).modern?.length);
  ok("五個歷史時代的錨都還在", ["ancient_china", "ancient_greece", "medieval", "edo", "victorian"]
    .filter((e) => !((data.eraAnchors || {})[e] || []).length));
  const zombie = [];
  const noHeir = [];
  for (const [dead, heir] of zeroPostGone) {
    if (by.has(dead)) zombie.push(`「${dead}」在 Danbooru 是 0 張，模型沒學過，不該回到詞庫`);
    if (!by.has(heir)) noHeir.push(`「${heir}」不在詞庫（${dead} 移除後由它承接那個概念）`);
  }
  ok("Danbooru 0 張的字沒有留在詞庫", zombie);
  ok("移除之後承接概念的字都還在", noHeir);
  // 反面：訓練之後才被併的舊名要留著，不能一起殺掉。
  ok("hairpin 留著（alias 是 2026-05-30 才建，晚於模型訓練）", by.has("hairpin"));
  // 時代錨換名之後要真的指到活著的字，不然古中國會沒有年代訊號。
  {
    const anchors = (data.eraAnchors || {}).ancient_china || [];
    ok("古中國的時代錨指向詞庫裡存在的字", anchors.filter((t) => !by.has(t)));
    ok("古中國的時代錨沒有留著被併走的舊名", anchors.filter((t) => t === "chinese architecture"));
  }
}

// --- Danbooru 查無的自創字不該留在詞庫 --------------------------------------
//
// 這幾個不是「被併走的舊名」（那種在上面那條），而是**Danbooru 根本沒有這個 tag**。
// 模型沒學過的字放進 prompt 就是在稀釋注意力，跟當初的 soft lighting 同一回事。
// 每一個都確認過詞庫裡已經有真的替代品，不是砍掉就沒了：
//
//   lotus pond       -> pond(3,948)，而且 pond 的 era 本來就含 ancient_china
//   great hall       -> 中世紀室內還有 throne / palace / tavern / altar
//   extreme close-up -> close-up(63,844)，它原本就 implies close-up
//   washing body     -> bathing(18,182)、showering 都在詞庫裡
//   free use         -> Danbooru 沒有對應的字，也沒有近義的真 tag
//
// 另外兩個是**改名**不是移除：Danbooru 有真的字，只是我們拼錯了
//   washing another's back -> washing back(365)
//   night market           -> market stall(1,246)
{
  const invented = ["lotus pond", "great hall", "extreme close-up", "washing body", "free use"];
  const renamed = [["washing another's back", "washing back"], ["night market", "market stall"]];
  const stale = invented.filter((t) => by.has(t)).map((t) => `自創字「${t}」Danbooru 查無，不該在詞庫`);
  for (const [old, real] of renamed) {
    if (by.has(old)) stale.push(`「${old}」Danbooru 查無，正確拼法是「${real}」`);
    if (!by.has(real)) stale.push(`「${real}」不在詞庫（${old} 的正確拼法）`);
  }
  ok("Danbooru 查無的自創 tag 沒有留在詞庫", stale);
  // 反面：替代品要真的還在，不能連同被砍掉
  const gone = ["pond", "close-up", "bathing", "throne"].filter((t) => !by.has(t));
  ok("被拿來頂替的真 tag 都還在", gone.map((t) => `替代品「${t}」不見了`));
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
  // adult 曾經也在這裡（每張圖都有的骨架字）。2026-09-18 移除之後它不再進 POS，
  // 所以也不該再要求它有 token 數 —— 上面那條「adult 沒有回到詞庫」守著它不回來。

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
