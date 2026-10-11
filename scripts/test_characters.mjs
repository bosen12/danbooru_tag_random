#!/usr/bin/env node
/**
 * 角色類別的快測（幾秒）：抽角色勾選、照人數性別抽、釘的角色補人數、有角色就不抽長相、系列名、只抽同系列、characterBan。
 * 內容跟 scripts/test_engine.mjs 結尾「角色類別（2026-10-10）」那一塊一樣（完整測試照跑那份，約 16 分鐘）；
 * 改角色規則時先跑這支，兩邊的斷言要一起改。Failures print and exit 1.
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { applyPin, defaultSettings, drawOne, indexLexicon, isCharacter, mulberry32, CHARACTER_MAX } from "../web/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web/lexicon.json"), "utf8"));
const lex = indexLexicon(data);

let failed = 0;
function eq(name, got, want) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) {
    failed += 1;
    console.error(`FAIL ${name}\n  got  ${a}\n  want ${b}`);
  } else console.log(`ok   ${name}`);
}
function ok(name, cond, detail) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL ${name}${detail ? "\n  " + detail : ""}`);
  } else console.log(`ok   ${name}`);
}

function settings() {
  const s = defaultSettings(data);
  s.girl = true;
  s.boy = true;
  s.heats = ["tease", "flash", "sex"];
  return s;
}

function tagsOf(drawn) {
  return new Set(drawn.positive.split(", ").map((t) => t.trim()));
}

const s = settings();
const charsOf = (p) => p.split(", ").filter((t) => isCharacter(lex.byTag.get(t)));
let leak = 0;
for (let i = 0; i < 400; i++) if (charsOf(drawOne(lex, s, new Set(), new Set(), mulberry32(930000 + i), 930000 + i).positive).length) leak += 1;
eq("角色：抽角色關著（預設）不會隨機抽到角色", leak, 0);
ok("角色：抽角色、加入系列名預設都關", s.drawCharacter === false && s.characterSeries === false);

const on = { ...s, drawCharacter: true };
const pin2g = applyPin(lex, new Set(), new Set(), "2girls").pinned;
let rightCount = 0;
let female = 0;
for (let i = 0; i < 60; i++) {
  const d = drawOne(lex, on, pin2g, new Set(), mulberry32(931000 + i), 931000 + i);
  const cs = charsOf(d.positive);
  if (cs.length === 2) rightCount += 1;
  if (cs.every((t) => lex.byTag.get(t).gate === "female")) female += 1;
}
eq("角色：釘 2girls、抽角色打開：每張都是兩個角色", rightCount, 60);
eq("角色：兩個女生抽到的都是女角色", female, 60);
const pinBoy = applyPin(lex, new Set(), new Set(), "1boy").pinned;
const sBoy = { ...on, girl: false, boy: true };
const boyChars = charsOf(drawOne(lex, sBoy, pinBoy, new Set(), mulberry32(931500), 931500).positive);
ok("角色：只有一個男生就抽一個男角色", boyChars.length === 1 && lex.byTag.get(boyChars[0]).gate === "male", boyChars.join());
const pin5 = applyPin(lex, new Set(), new Set(), "5girls").pinned;
const many = charsOf(drawOne(lex, on, pin5, new Set(), mulberry32(931600), 931600).positive);
ok(`角色：五個女生最多抽 ${CHARACTER_MAX} 個角色`, many.length === CHARACTER_MAX, many.join(" + "));

let pinC = applyPin(lex, new Set(), new Set(), "yor briar").pinned;
pinC = applyPin(lex, pinC, new Set(), "makima (chainsaw man)").pinned;
ok("角色：兩個女角色可以同時釘（角色之間不互斥）", pinC.has("yor briar") && pinC.has("makima (chainsaw man)"));
let castOkN = 0;
let lookLeak = 0;
const LOOK = new Set(["hair_len", "hair_color", "hair_style", "eyes", "race"]);
for (let i = 0; i < 80; i++) {
  const d = drawOne(lex, s, pinC, new Set(), mulberry32(932000 + i), 932000 + i);
  const tags = d.positive.split(", ");
  // 至少兩個女生（4% 的「五人圖」升級會變成 4girls 1boy，照樣成立）。
  const girls = ["2girls", "3girls", "4girls", "5girls", "6+girls"].some((t) => tags.includes(t));
  if (girls && tags.includes("yor briar") && tags.includes("makima (chainsaw man)")) castOkN += 1;
  if (tags.some((t) => { const it = lex.byTag.get(t); return it && (LOOK.has(it.group) || it.mutex === "breast_size" || it.sub === "nonhuman"); })) lookLeak += 1;
}
eq("角色：釘了約兒和瑪奇瑪（沒釘人數）：至少兩個女生、兩個都在", castOkN, 80);
eq("角色：有角色就不再抽髮長、髮色、髮型、瞳色、人種、胸部大小、獸耳翅膀", lookLeak, 0);
const pinRed = applyPin(lex, applyPin(lex, new Set(), new Set(), "yor briar").pinned, new Set(), "red hair").pinned;
ok("角色：釘的髮色照留（使用者明講要換）", tagsOf(drawOne(lex, s, pinRed, new Set(), mulberry32(932500), 932500)).has("red hair"));

const pinYor = applyPin(lex, new Set(), new Set(), "yor briar").pinned;
const plain = drawOne(lex, s, pinYor, new Set(), mulberry32(933000), 933000).positive.split(", ");
const withSeries = drawOne(lex, { ...s, characterSeries: true }, pinYor, new Set(), mulberry32(933000), 933000).positive.split(", ");
ok("角色：加入系列名關著不送作品名", !plain.includes("spy x family"));
ok("角色：加入系列名打開，作品名緊接在角色後面", withSeries[withSeries.indexOf("yor briar") + 1] === "spy x family", withSeries.slice(0, 6).join(", "));
const pinTwo = applyPin(lex, pinYor, new Set(), "twilight (spy x family)").pinned;
const twoSeries = drawOne(lex, { ...s, characterSeries: true }, pinTwo, new Set(), mulberry32(933100), 933100).positive.split(", ");
eq("角色：同作品兩個角色，作品名只寫一次", twoSeries.filter((t) => t === "spy x family").length, 1);

// 只抽同系列：釘了約兒＋2girls 1boy → 另外兩個都是間諜家家酒；沒開就不挑作品。
let pinS = applyPin(lex, new Set(), new Set(), "yor briar").pinned;
pinS = applyPin(lex, pinS, new Set(), "2girls").pinned;
pinS = applyPin(lex, pinS, new Set(), "1boy").pinned;
let sameAll = 0;
let mixed = 0;
for (let i = 0; i < 40; i++) {
  const seed = 934000 + i;
  const cs = charsOf(drawOne(lex, { ...on, characterSameSeries: true }, pinS, new Set(), mulberry32(seed), seed).positive);
  if (cs.length === 3 && cs.every((t) => lex.byTag.get(t).series === "spy x family")) sameAll += 1;
  const free = charsOf(drawOne(lex, on, pinS, new Set(), mulberry32(seed), seed).positive);
  if (free.some((t) => lex.byTag.get(t).series !== "spy x family")) mixed += 1;
}
eq("角色：只抽同系列＋釘約兒（2 女 1 男）：另外兩個都是同作品、性別對", sameAll, 40);
ok("角色：沒開只抽同系列就不挑作品（不會一直抽到間諜家家酒）", mixed > 30, `${mixed}/40`);
const pin3 = applyPin(lex, new Set(), new Set(), "3girls").pinned;
let oneSeries = 0;
for (let i = 0; i < 30; i++) {
  const cs = charsOf(drawOne(lex, { ...on, characterSameSeries: true }, pin3, new Set(), mulberry32(934500 + i), 934500 + i).positive);
  if (cs.length === 3 && new Set(cs.map((t) => lex.byTag.get(t).series)).size === 1) oneSeries += 1;
}
eq("角色：只抽同系列、沒釘角色、3girls：先挑湊得齊三個女角色的作品", oneSeries, 30);

const ban = new Set(data.characterBan || []);
ok("角色：characterBan 有清單（未成年、學生、童顏、真人、非人形）", ban.size > 1000 && ban.has("anya (spy x family)"), String(ban.size));
eq("角色：被 ban 的角色不是詞庫的牌", data.tags.filter((t) => ban.has(t.tag)).length, 0);
const pinBan = applyPin(lex, new Set(), new Set(), "anya (spy x family)").pinned;
ok("角色：被 ban 的角色釘不上去", !tagsOf(drawOne(lex, s, pinBan, new Set(), mulberry32(933200), 933200)).has("anya (spy x family)"));

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nok");
