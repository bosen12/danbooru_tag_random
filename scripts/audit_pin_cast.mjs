#!/usr/bin/env node
/**
 * 釘選 vs 卡司。每張會影響人數或性別的牌單獨釘一次（走 applyPin，跟畫面上釘同一條），
 * 四種設定各抽 N 張（預設 200）：
 *   只開女 × 尺度全開、只開男 × 尺度全開、兩性都開 × 尺度全開、兩性都開 × 只有性愛。
 *
 * 看三件事：
 *   1. 釘住的牌在不在結果裡。不在的話，分級擋掉或「只穿內衣」被場景拿掉算合理。
 *   2. 結果的人數、性別跟這張牌的 needs、gate 是否一致。
 *   3. 結果自己打架時，contradictions() 有沒有點到這張牌。
 *
 *   node scripts/audit_pin_cast.mjs
 *   node scripts/audit_pin_cast.mjs --draws 20
 *   node scripts/audit_pin_cast.mjs --tags yuri,foursome
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  applyPin,
  contradictions,
  defaultSettings,
  drawOne,
  indexLexicon,
  mulberry32,
  ratingBlocked,
} from "../web/engine.js";
import {
  COUNT_NUM,
  FEMALE_COUNT,
  MALE_COUNT,
  castOk,
  gateOk,
} from "../web/rules/cast.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web", "lexicon.json"), "utf8"));
const lex = indexLexicon(data);

const CAST_TAGS = new Set([
  ...FEMALE_COUNT,
  ...MALE_COUNT,
  "solo",
  "solo focus",
  "hetero",
  "yuri",
  "no humans",
]);
const NEED_KEYS = new Set(["pair", "group", "crowd", "five", "male", "female", "2male", "2female", "yuri"]);

function affectsCast(item) {
  if (!item) return false;
  if (CAST_TAGS.has(item.tag)) return true;
  if (item.gate === "male" || item.gate === "female") return true;
  return (item.needs || []).some((k) => NEED_KEYS.has(k));
}

function parseArgs(argv) {
  let draws = 200;
  let tags = null;
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--draws") draws = Math.max(1, Number(argv[++i]) || 200);
    else if (a === "--tags") tags = new Set(String(argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean));
  }
  return { draws, tags };
}

function baseSettings() {
  const s = defaultSettings(data);
  s.eras = ["modern"];
  s.rating = "explicit";
  s.sceneMode = "normal";
  s.lockScene = true;
  return s;
}

const SETTINGS = [
  { name: "girl-all", over: { girl: true, boy: false, heats: ["tease", "flash", "sex"] } },
  { name: "boy-all", over: { girl: false, boy: true, heats: ["tease", "flash", "sex"] } },
  { name: "both-all", over: { girl: true, boy: true, heats: ["tease", "flash", "sex"] } },
  {
    name: "both-sex",
    over: {
      girl: true,
      boy: true,
      heats: ["sex"],
      weights: { tease: 0, flash: 0, sex: 1, activity: 0 },
    },
  },
];

function makeSettings(over) {
  const s = baseSettings();
  Object.assign(s, over);
  return s;
}

function tagSeed(tag) {
  let h = 2166136261;
  for (let i = 0; i < tag.length; i += 1) {
    h ^= tag.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function castOf(tags) {
  let girls = 0;
  let boys = 0;
  for (const t of tags) {
    if (FEMALE_COUNT.has(t)) girls += COUNT_NUM[t] || 0;
    if (MALE_COUNT.has(t)) boys += COUNT_NUM[t] || 0;
  }
  return { girls, boys, people: girls + boys, female: girls > 0, male: boys > 0 };
}

function problemsOf(item, tags, cast) {
  if (item.tag === "no humans") {
    const person = [...tags].some((t) => FEMALE_COUNT.has(t) || MALE_COUNT.has(t) || t === "solo" || t === "solo focus");
    if (!tags.has("no humans")) return ["missing"];
    if (person) return ["no-humans"];
    return [];
  }
  if (!tags.has(item.tag)) {
    if (ratingBlocked(item, "explicit")) return ["missing-rating"];
    if (item.tag === "underwear only") return ["missing-scene"];
    return ["missing"];
  }
  const out = [];
  if (!gateOk(item, cast.female, cast.male)) out.push("gate");
  if (!castOk(item, cast.female, cast.male, cast.people, cast.girls, cast.boys)) out.push("needs");
  if (item.tag === "yuri" && (cast.male || cast.girls < 2)) out.push("yuri");
  if (item.tag === "solo" && (cast.people !== 1 || !tags.has("solo"))) out.push("solo");
  if (item.tag === "solo focus" && tags.has("solo")) out.push("solo-focus");
  return out;
}

const HARD = new Set(["missing", "gate", "needs", "yuri", "solo", "solo-focus", "no-humans", "leak"]);

const { draws, tags: only } = parseArgs(process.argv);
const cards = data.tags.filter(affectsCast).filter((it) => !only || only.has(it.tag));
const prepared = SETTINGS.map((s) => ({ name: s.name, settings: makeSettings(s.over) }));

const byKind = new Map();
const byTag = new Map();
const examples = new Map();
let total = 0;
let hardDraws = 0;

function bump(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

console.error(`候選 ${cards.length} 張 × ${prepared.length} 設定 × ${draws} 抽`);

for (let ti = 0; ti < cards.length; ti += 1) {
  const item = cards[ti];
  const pinned = applyPin(lex, new Set(), new Set(), item.tag).pinned;
  const seed0 = tagSeed(item.tag);
  for (const prep of prepared) {
    for (let i = 0; i < draws; i += 1) {
      const seed = (seed0 + prep.name.length * 100003 + i) >>> 0;
      const drawn = drawOne(lex, prep.settings, pinned, new Set(), mulberry32(seed), seed);
      const tags = new Set(String(drawn.positive || "").split(", ").filter(Boolean));
      const cast = castOf(tags);
      const problems = problemsOf(item, tags, cast);
      total += 1;
      const hard = problems.filter((p) => p !== "missing-rating" && p !== "missing-scene");
      let leaked = false;
      if (hard.length && tags.has(item.tag)) {
        const clashes = drawn.conflicts || contradictions(lex, [...tags]);
        leaked = !clashes.some((row) => row.includes(item.tag));
        if (leaked) hard.push("leak");
      }
      if (hard.length) {
        hardDraws += 1;
        const rec = byTag.get(item.tag) || { bad: 0, kinds: new Map(), settings: new Set() };
        rec.bad += 1;
        rec.settings.add(prep.name);
        for (const k of hard) {
          bump(rec.kinds, k);
          bump(byKind, k);
          if (!examples.has(k)) examples.set(k, []);
          const bag = examples.get(k);
          if (bag.length < 4) {
            const castBits = [...tags].filter((t) => FEMALE_COUNT.has(t) || MALE_COUNT.has(t) || t === "solo" || t === "solo focus" || t === item.tag);
            bag.push(`${item.tag} @ ${prep.name} seed ${seed} people=${cast.people} [${castBits.join(", ")}]`);
          }
        }
        byTag.set(item.tag, rec);
      }
    }
  }
  if ((ti + 1) % 50 === 0) console.error(`  ${ti + 1}/${cards.length}  有問題的抽 ${hardDraws}`);
}

console.log(`候選 ${cards.length} 張 × ${prepared.length} 設定 × ${draws} 抽 = ${total}`);
console.log(`有問題的抽 ${hardDraws}/${total}`);
const kinds = [...byKind.entries()].sort((a, b) => b[1] - a[1]);
for (const [k, n] of kinds) console.log(`  ${k}  ${n}`);
console.log("--- 有問題的牌 ---");
const rows = [...byTag.entries()].sort((a, b) => b[1].bad - a[1].bad);
for (const [tag, rec] of rows) {
  const kindText = [...rec.kinds.entries()].map(([k, n]) => `${k}:${n}`).join(" ");
  console.log(`${tag}  ${rec.bad}/${prepared.length * draws}  ${[...rec.settings].join(",")}  ${kindText}`);
}
console.log("--- 例子 ---");
for (const [k, bag] of examples) {
  console.log(`# ${k}`);
  for (const line of bag) console.log(`  ${line}`);
}

if (hardDraws) process.exitCode = 1;
else console.log("ok");
