#!/usr/bin/env node
/**
 * 第六輪（danbooru_worth_adding.csv，2026-10-06）。失敗印出並 exit 1。
 *
 * 守的是「加進來的字不讓畫面自相矛盾」，用大量抽樣與釘選驗行為，不只看欄位：
 *   動物種類（kind）不混、獸耳只有一種、袖長／瀏海／指甲色／翅膀種類各只有一種、
 *   裸臂不配長袖、裸腿不配過膝襪、嘴叼物不配口塞與口交、兜帽放下不配戴著兜帽、
 *   內褲走光不進誘惑、只穿內衣不配無袖、四肢截斷不配舉手與臂鎧。
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  applyPin,
  defaultSettings,
  drawOne,
  indexLexicon,
  mulberry32,
} from "../web/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web/lexicon.json"), "utf8"));
const lex = indexLexicon(data);

let failed = 0;
function ok(name, cond, detail) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL ${name}${detail ? "\n  " + detail : ""}`);
  } else console.log(`ok   ${name}`);
}
const item = (tag) => lex.byTag.get(tag);
function pinsOf(...tags) {
  let pinned = new Set();
  for (const tag of tags) pinned = applyPin(lex, pinned, new Set(), tag).pinned;
  return pinned;
}
function base(over = {}) {
  const s = defaultSettings(data);
  s.girl = true;
  s.boy = false;
  s.heats = ["tease", "flash", "sex"];
  s.sceneMode = "normal";
  return Object.assign(s, over);
}
const tagSet = (d) => new Set(String(d.positive).split(", ").map((t) => t.trim()).filter(Boolean));
function* sweep(s, pinned, n, seed0) {
  for (let i = 0; i < n; i++) yield tagSet(drawOne(lex, s, pinned, new Set(), mulberry32(seed0 + i), seed0 + i));
}
const related = (a, b) =>
  (item(a)?.implies || []).includes(b) || (item(b)?.implies || []).includes(a) ||
  (item(a)?.bind || []).includes(b) || (item(b)?.bind || []).includes(a);
/** 同一組裡、彼此不是父子的字，同一張出現兩個以上就算撞。 */
function clash(have, group) {
  const hit = [...have].filter((t) => group.has(t));
  for (let i = 0; i < hit.length; i++) {
    for (let j = i + 1; j < hit.length; j++) if (!related(hit[i], hit[j])) return `${hit[i]} + ${hit[j]}`;
  }
  return null;
}

const NEW = [
  "two side up", "one side up", "double-parted bangs", "crossed bangs", "spiked hair", "short twintails",
  "side braid", "twin drills", "hair rings", "hair behind ear", "black eyes", "bright pupils", "white pupils",
  "multicolored eyes", "v-shaped eyebrows", "upper teeth only", "flying sweatdrops", "light blush", "skin fang",
  "wavy mouth", "shaded face", "one eye covered", "fingernails", "black nails", "blue nails", "stomach",
  "hand up", "hands up", "bare arms", "bare legs", "mouth hold", "outstretched arms", "clenched hand",
  "arm behind head", "colored skin", "cat ears", "animal ear fluff", "rabbit ears", "horse ears", "horse girl",
  "cat tail", "fox ears", "fox tail", "horse tail", "wolf ears", "feathered wings", "head wings", "dog ears",
  "demon tail", "rabbit tail", "claws", "dragon horns", "bat wings", "multiple tails", "fairy wings",
  "mechanical arms", "fairy", "cyborg", "sleeveless", "striped clothes", "clothing cutout", "puffy short sleeves",
  "strapless", "sleeves past wrists", "plaid clothes", "floral print", "frilled sleeves", "juliet sleeves",
  "puffy long sleeves", "ribbon trim", "lace trim", "high collar", "layered sleeves", "frilled dress",
  "formal clothes", "frilled skirt", "hood down", "hooded jacket", "robe", "fur collar", "highleg",
  "single thighhigh", "high heel boots", "ankle boots", "armored boots", "bow", "ribbon", "hair bow",
  "neckerchief", "headband", "scrunchie", "tassel", "hat bow", "hat ribbon", "wristband", "gauntlets",
  "hair bobbles", "star hair ornament", "pauldrons", "santa hat", "hair bell", "mask on head",
  "feather hair ornament", "fox mask", "frilled collar", "holding cup", "holding phone", "holding umbrella",
  "holding fan", "pantyshot", "wind lift", "green background", "purple background", "star (symbol)", "summer",
  "flower", "chain", "leaf", "feathers",
];

// ---- 欄位：都在、中文唯一、帶出的字存在而且時代與性別接得上（接不上的話抽到就整筆被拒）。
{
  ok(`CSV 的 ${NEW.length} 個字都進了詞庫`, NEW.length === 119 && NEW.every((t) => item(t)), NEW.filter((t) => !item(t)).join("、"));
  const zh = new Map();
  for (const t of data.tags) zh.set(t.zh, [...(zh.get(t.zh) || []), t.tag]);
  const dup = NEW.filter((t) => (zh.get(item(t).zh) || []).length > 1);
  ok("新字的中文不跟別的字撞", !dup.length, dup.map((t) => `${t}：${zh.get(item(t).zh).join("、")}`).join("；"));
  const bad = [];
  for (const t of NEW) {
    const it = item(t);
    for (const p of it.implies) {
      const pi = item(p);
      if (!pi) { bad.push(`${t} 帶出不存在的 ${p}`); continue; }
      const eras = it.era.includes("any") ? null : it.era;
      if (eras && !pi.era.includes("any") && eras.some((e) => !pi.era.includes(e))) bad.push(`${t} 的時代 ${eras} 超出 ${p} 的 ${pi.era}`);
      if (pi.gate !== "any" && it.gate !== pi.gate) bad.push(`${t}（${it.gate}）帶出限 ${pi.gate} 的 ${p}`);
    }
  }
  ok("新字帶出的字都存在，時代、性別接得上", !bad.length, bad.join("；"));
  ok("沒有字落在「其他」細分類", NEW.every((t) => !["other", "extra"].includes(item(t).sub)));
}

// ---- 動物種類：同種可以疊，不同種不混。
const KIND_TAGS = data.tags.filter((t) => t.kind);
const kindsIn = (have) => new Set([...have].map((t) => item(t)?.kind).filter(Boolean));
{
  let mixed = null;
  let seen = 0;
  for (const mode of ["diverse", "bizarre"]) {
    for (const have of sweep(base({ sceneMode: mode, counts: { subject: 2, feature: 10, pose: 6, clothing: 5, env: 4 } }), new Set(), 500, 61000)) {
      const ks = kindsIn(have);
      if (ks.size) seen += 1;
      if (ks.size > 1 && !mixed) mixed = [...have].filter((t) => item(t)?.kind).join("、");
    }
  }
  ok(`隨機抽不會把兩種動物的零件湊在一起（有種類的圖 ${seen} 張）`, !mixed && seen > 50, mixed || `只有 ${seen} 張有種類，樣本不夠`);

  for (const pin of ["fox girl", "cat ears", "dragon horns", "rabbit tail"]) {
    const k = item(pin).kind;
    let other = null;
    for (const have of sweep(base({ sceneMode: "diverse", counts: { subject: 2, feature: 10, pose: 6, clothing: 5, env: 4 } }), pinsOf(pin), 200, 62000)) {
      const bad = [...have].find((t) => item(t)?.kind && item(t).kind !== k);
      if (bad && !other) other = bad;
    }
    ok(`釘「${pin}」不會補別種動物的零件`, !other, other);
  }
  const cat = tagSet(drawOne(lex, base(), pinsOf("cat girl", "cat tail", "cat ears"), new Set(), mulberry32(7), 7));
  ok("貓娘、貓耳、貓尾可以一起", cat.has("cat girl") && cat.has("cat tail") && cat.has("cat ears") && cat.has("animal ears") && cat.has("tail"));
  const horse = tagSet(drawOne(lex, base({ sceneMode: "diverse" }), pinsOf("horse girl"), new Set(), mulberry32(9), 9));
  ok("馬娘帶出馬耳、馬尾和獸耳、尾巴", ["horse girl", "horse ears", "horse tail", "animal ears", "tail"].every((t) => horse.has(t)), [...horse].join(", "));
  ok("有種類的字都在 merge_lexicon.py 的 KIND 裡（含既有種族）", KIND_TAGS.length >= 40, `${KIND_TAGS.length} 個`);
}

// ---- 各種「只會有一種」：廣泛隨機掃，數量開大。
{
  const GROUPS = {
    獸耳: new Set(data.tags.filter((t) => t.mutex === "animal_ear").map((t) => t.tag)),
    袖長: new Set(data.tags.filter((t) => (t.mutexExtra || []).includes("sleeve_len")).map((t) => t.tag)),
    瀏海: new Set(data.tags.filter((t) => (t.mutexExtra || []).includes("bangs")).map((t) => t.tag)),
    指甲色: new Set(data.tags.filter((t) => (t.mutexExtra || []).includes("nail_color")).map((t) => t.tag)),
    翅膀: new Set(data.tags.filter((t) => (t.mutexExtra || []).includes("wing_type")).map((t) => t.tag)),
    瞳孔明暗: new Set(["bright pupils", "white pupils"]),
    手臂: new Set(["hand up", "hands up", "outstretched arms", "arm behind head", "arms up", "arm up", "arms behind head", "crossed arms"]),
    季節: new Set(["summer", "winter"]),
  };
  const PAIRS = [
    ["裸臂", ["bare arms"], ["long sleeves", "elbow gloves", "detached sleeves", "sleeves past wrists", "puffy long sleeves", "juliet sleeves"]],
    ["裸腿", ["bare legs"], ["thighhighs", "pantyhose", "kneehighs", "single thighhigh", "leggings"]],
    ["嘴叼物", ["mouth hold"], ["gag", "ball gag", "fellatio", "kiss", "french kiss", "deepthroat", "licking penis"]],
    ["兜帽放下", ["hood down"], ["hood up", "hood"]],
    ["只穿內衣", ["underwear only"], ["sleeveless", "puffy short sleeves", "sleeves past wrists", "juliet sleeves"]],
    ["無肩帶", ["strapless"], ["halterneck"]],
  ];
  const hits = Object.fromEntries(Object.keys(GROUPS).map((k) => [k, 0]));
  const bad = [];
  let n = 0;
  const settings = [
    base({ counts: { subject: 2, feature: 10, pose: 10, clothing: 10, env: 6 } }),
    base({ sceneMode: "diverse", counts: { subject: 2, feature: 10, pose: 10, clothing: 10, env: 6 } }),
    base({ heats: ["sex"], counts: { subject: 2, feature: 10, pose: 10, clothing: 6, env: 4 } }),
  ];
  for (const s of settings) {
    for (const have of sweep(s, new Set(), 400, 63000)) {
      n += 1;
      for (const [k, g] of Object.entries(GROUPS)) {
        if ([...have].some((t) => g.has(t))) hits[k] += 1;
        const c = clash(have, g);
        if (c) bad.push(`${k}：${c}`);
      }
      for (const [k, a, b] of PAIRS) {
        if (a.some((t) => have.has(t)) && b.some((t) => have.has(t))) bad.push(`${k}：${[...have].filter((t) => a.includes(t) || b.includes(t)).join(" + ")}`);
      }
    }
  }
  ok(`${n} 張裡沒有一種「只會有一種」的格子塞了兩個，也沒有互相矛盾的組合`, !bad.length, [...new Set(bad)].slice(0, 8).join("；"));
  const thin = Object.entries(hits).filter(([, c]) => c < 5).map(([k, c]) => `${k}(${c})`);
  ok("上面每一組都真的被抽到過（≥5 張），不是空話", !thin.length, thin.join("、"));
}

// ---- 釘選：矛盾的那一邊由引擎讓路，使用者釘的照留。
{
  const pairs = [
    ["mouth hold", ["gag", "ball gag", "fellatio", "kiss"], base({ heats: ["sex"] })],
    ["bare arms", ["long sleeves", "elbow gloves", "detached sleeves"], base({ counts: { subject: 2, feature: 8, pose: 6, clothing: 10, env: 4 } })],
    ["sleeveless", ["long sleeves", "short sleeves", "sleeves past wrists"], base({ counts: { subject: 2, feature: 8, pose: 6, clothing: 10, env: 4 } })],
    ["hood down", ["hood up", "hood"], base({ eras: ["medieval"], counts: { subject: 2, feature: 8, pose: 6, clothing: 10, env: 4 } })],
  ];
  for (const [pin, never, s] of pairs) {
    let kept = 0;
    let bad = null;
    for (const have of sweep(s, pinsOf(pin), 150, 64000)) {
      if (have.has(pin)) kept += 1;
      const b = never.find((t) => have.has(t));
      if (b && !bad) bad = b;
    }
    ok(`釘「${pin}」時留著它，不補 ${never.join("／")}`, kept === 150 && !bad, `留住 ${kept}/150；撞到 ${bad}`);
  }
  const both = tagSet(drawOne(lex, base({ eras: ["medieval"] }), pinsOf("hood up", "hood"), new Set(), mulberry32(3), 3));
  ok("戴上兜帽和兜帽是同一個狀態，可以一起", both.has("hood up") && both.has("hood"));
}

// ---- 走光與手上拿著。
{
  let teaseShot = 0;
  for (const have of sweep(base({ heats: ["tease"], weights: { tease: 1, flash: 0, sex: 0 } }), new Set(), 400, 65000)) {
    if (have.has("pantyshot") || have.has("wind lift")) teaseShot += 1;
  }
  ok("只開誘惑時不會出現內褲走光、風掀起衣服", teaseShot === 0, `${teaseShot} 張`);
  const shot = tagSet(drawOne(lex, base({ heats: ["flash"] }), pinsOf("pantyshot"), new Set(), mulberry32(5), 5));
  ok("內褲走光帶出內褲", shot.has("pantyshot") && shot.has("panties"));
  const phone = tagSet(drawOne(lex, base(), pinsOf("holding phone"), new Set(), mulberry32(11), 11));
  ok("拿著手機帶出手機", phone.has("holding phone") && phone.has("phone"));
  let twoHands = null;
  const HOLD = ["holding cup", "holding phone", "holding umbrella", "holding fan", "holding weapon", "holding sword", "clenched hand", "v", "thumbs up"];
  for (const have of sweep(base(), pinsOf("holding cup"), 200, 66000)) {
    const h = HOLD.filter((t) => have.has(t) && t !== "holding cup");
    if (h.length && !twoHands) twoHands = h.join("、");
  }
  ok("拿著杯子佔住手勢格，不再補別的手勢", !twoHands, twoHands);
}

// ---- 四肢截斷：沒有手臂就沒有舉手、臂鎧、裸臂、袖子。
{
  let bad = null;
  const s = base({ sceneMode: "bizarre", counts: { subject: 2, feature: 8, pose: 10, clothing: 10, env: 4 } });
  for (const have of sweep(s, pinsOf("quadruple amputee"), 200, 67000)) {
    const b = ["hand up", "hands up", "outstretched arms", "arm behind head", "gauntlets", "bare arms", "puffy short sleeves", "holding cup", "clenched hand"].find((t) => have.has(t));
    if (b && !bad) bad = b;
  }
  ok("四肢截斷不補舉手、臂鎧、裸臂、袖子、手上拿東西", !bad, bad);
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nok");
