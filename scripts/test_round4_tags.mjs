#!/usr/bin/env node
/** 多元文化與姿勢／風格／場景兩份 CSV。失敗印出並 exit 1。 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { artPrompt } from "../web/card-art.js";
import {
  applyPin,
  defaultSettings,
  drawOne,
  indexLexicon,
  mulberry32,
  NEEDS_CONTEXT,
} from "../web/engine.js";

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

function item(tag) {
  return lex.byTag.get(tag);
}
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
  s.eras = ["modern"];
  s.sceneMode = "normal";
  return Object.assign(s, over);
}
function draw(s, pinned, seed, banned = new Set()) {
  return drawOne(lex, s, pinned, banned, mulberry32(seed), seed);
}
function tagSet(drawn) {
  return new Set(String(drawn.positive).split(", ").map((t) => t.trim()).filter(Boolean));
}
function chain(tag, seen = new Set()) {
  if (seen.has(tag)) return seen;
  seen.add(tag);
  const it = item(tag);
  for (const d of [...(it?.implies || []), ...(it?.bind || [])]) chain(d, seen);
  return seen;
}
function implies(tag) {
  return item(tag)?.implies || [];
}
function needs(tag) {
  return item(tag)?.needs || [];
}
function promptOf(tag) {
  return artPrompt(item(tag), { byTag: lex.byTag });
}
function tagsOfPrompt(prompt) {
  return new Set(String(prompt || "").split(",").map((t) => t.trim()).filter(Boolean));
}

const ZH_OVERRIDE = {
  armor: "鎧甲",
  "ancient greek clothes": "古希臘服",
  toga: "托加",
  "chinese armor": "中式甲冑",
  viking: "維京人",
  peplos: "佩普洛斯",
  cityscape: "都市風景",
  veranda: "緣側",
  "chinese new year": "過年",
  pagoda: "塔",
  landscape: "地景",
  "hand on own thigh": "單手摸大腿",
  "arm support": "手臂撐著",
  shushing: "食指噓聲",
  bored: "無聊",
  dock: "船塢",
  savannah: "稀樹草原",
  poncho: "墨西哥披肩",
  "hands in pockets": "雙手插口袋",
  comic: "漫畫分格",
};
const SKIP = new Set([
  "sketch",
  "photorealistic",
  // 2026-10-06：Danbooru 停用，沒有後繼標籤。花紋改由碎花、圓點、格紋、條紋各自表示。
  "patterned clothing",
]);

function loadCsv(path) {
  return readFileSync(path, "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/).slice(1).map((line) => {
    const [raw, zh] = line.split(",");
    const tag = raw.replace(/_/g, " ");
    return { tag, zh: ZH_OVERRIDE[tag] || zh };
  });
}
const csvRows = [
  ...loadCsv("C:/Users/boshe/Downloads/danbooru_multicultural_all.csv"),
  ...loadCsv("C:/Users/boshe/Downloads/danbooru_pose_style_scene.csv"),
];

{
  eq("two csv files have 205 tags", csvRows.length, 205);
  const missing = csvRows.filter((r) => !SKIP.has(r.tag) && !item(r.tag)).map((r) => r.tag);
  eq("every csv tag except sketch and photorealistic is in the lexicon", missing, []);
  ok("sketch stays out of the drawable pool", !item("sketch"));
  ok("photorealistic stays out of the drawable pool", !item("photorealistic"));
  const zhBad = csvRows.filter((r) => item(r.tag) && item(r.tag).zh !== r.zh).map((r) => `${r.tag}:${item(r.tag)?.zh}`);
  eq("chinese names match, collisions renamed", zhBad, []);
  const bannedChild = [];
  for (const r of csvRows) {
    if (!item(r.tag)) continue;
    for (const t of chain(r.tag)) {
      if (t === "loli" || t === "shota" || t === "child" || t === "aged down") bannedChild.push(`${r.tag}->${t}`);
    }
  }
  eq("no csv tag implies loli, shota, child, or aged down", bannedChild, []);
  const zh = new Map();
  const dups = [];
  for (const t of data.tags) {
    if (!t.zh) continue;
    if (zh.has(t.zh)) dups.push(`${t.zh}: ${zh.get(t.zh)} / ${t.tag}`);
    else zh.set(t.zh, t.tag);
  }
  eq("chinese names stay unique", dups, []);
  const neg = data.negative.split(", ").map((t) => t.trim());
  eq("negative still ends with loli, child, aged down", neg.slice(-3), ["loli", "child", "aged down"]);
  ok("negative still contains sketch", neg.includes("sketch"));
  ok("negative still contains photorealistic", neg.includes("photorealistic"));
}

eq("hand fan is 扇子 and uchiwa is 團扇", [item("hand fan").zh, item("uchiwa").zh], ["扇子", "團扇"]);
eq("savannah is not the meadow, dock is not the pier", [item("savannah").zh, item("dock").zh], ["稀樹草原", "船塢"]);
eq("landscape is not scenery", item("landscape").zh, "地景");

eq("sunflower field is outdoors with sunflowers and not the historical field", implies("sunflower field"), ["outdoors", "sunflower"]);
eq("skyline does not imply cityscape", implies("skyline").includes("cityscape"), false);
eq("igloo implies snow", implies("igloo"), ["outdoors", "snow"]);
eq("oasis implies the desert", implies("oasis"), ["outdoors", "desert"]);
eq("lava and the volcano do not imply each other", [implies("lava").includes("volcano"), implies("volcano").includes("lava")], [false, false]);
eq("earth implies the planet and space", implies("earth (planet)"), ["planet", "space"]);
eq("a planet implies space", implies("planet"), ["space"]);
eq("an asteroid implies space and not a planet", implies("asteroid"), ["space"]);
eq("european architecture is not a place", item("european architecture").mutex, null);

eq("hanbok brings out korean clothes", implies("hanbok").includes("korean clothes"), true);
eq("ao dai brings out vietnamese clothes", implies("ao dai").includes("vietnamese clothes"), true);
eq("dirndl brings out german clothes", implies("dirndl").includes("german clothes"), true);
eq("toga brings out roman clothes", implies("toga").includes("roman clothes"), true);
eq("peplos brings out ancient greek clothes", implies("peplos").includes("ancient greek clothes"), true);
eq("hanfu brings out chinese clothes", implies("hanfu").includes("chinese clothes"), true);
eq("qipao does not bring out ancient chinese clothes", implies("qipao").includes("chinese clothes"), false);
eq("tangzhuang does not bring out ancient chinese clothes", implies("tangzhuang").includes("chinese clothes"), false);
eq("korean clothes display with the era clothes", item("korean clothes").group, "era");
eq("a poncho is outerwear and does not imply a coat", {
  mutex: item("poncho").mutex, implies: implies("poncho"), zh: item("poncho").zh,
}, { mutex: "outer", implies: [], zh: "墨西哥披肩" });
eq("floral print kimono brings out the print and the kimono", {
  implies: implies("floral print kimono"), bind: item("floral print kimono").bind,
  // 2026-10-06 第六輪：詞庫有了 floral print（碎花圖案），照 Danbooru 一起帶出。
}, { implies: ["print kimono", "floral print", "kimono"], bind: ["japanese clothes"] });
eq("print kimono is edo", item("print kimono").era, ["edo"]);
eq("patterned clothing left: Danbooru deprecated it with no successor", item("patterned clothing"), undefined);
eq("pilot suit left: it split into three different clothes", item("pilot suit"), undefined);
eq("mecha pilot suit takes the old pilot-suit slot", {
  mutex: item("mecha pilot suit").mutex, group: item("mecha pilot suit").group,
  era: item("mecha pilot suit").era, zh: item("mecha pilot suit").zh,
}, { mutex: "onepiece", group: "onepiece", era: ["modern"], zh: "機甲駕駛服" });

for (const t of ["wine", "sake", "pizza", "sushi", "ramen", "curry", "pasta", "champagne", "mooncake", "taco", "rice bowl"]) {
  ok(`${t} does not imply eating or drinking`, !implies(t).includes("eating") && !implies(t).includes("drinking"));
}
ok("chopsticks are not a meal", !implies("chopsticks").includes("eating"));

eq("black skin brings out dark skin", implies("black skin"), ["dark skin"]);
ok("black skin conflicts with pale skin", (lex.siblings.get("black skin") || []).includes("pale skin"));
ok("black skin keeps dark skin", !(lex.siblings.get("black skin") || []).includes("dark skin"));
eq("a cheek mole brings out the mole", implies("mole on cheek"), ["mole"]);
eq("a facial scar brings out the scar", implies("scar on face"), ["scar"]);
eq("cornrows take the hairstyle slot", item("cornrows").mutex, "hair_style");

eq("walking away is walking, seen from behind", implies("walking away"), ["walking"]);
ok("walking away does not fight the walking tag", !(lex.siblings.get("walking away") || []).includes("walking"));
eq("walking away is a body pose", item("walking away").mutex, "body_pose");
eq("sitting on stairs is sitting", implies("sitting on stairs"), ["sitting"]);
eq("sitting on an object is sitting", implies("sitting on object"), ["sitting"]);
eq("a handstand does not imply upside-down", implies("handstand").includes("upside-down"), false);
eq("facing the viewer is not a gaze", { mutex: item("facing viewer").mutex, implies: implies("facing viewer") }, { mutex: null, implies: [] });
eq("one arm up does not imply both arms up", implies("arm up").includes("arms up"), false);
ok("one arm up conflicts with both arms up", (lex.siblings.get("arm up") || []).includes("arms up"));
eq("hands in pockets do not imply one hand in a pocket", implies("hands in pockets").includes("hand in pocket"), false);
ok("hands in pockets conflict with one hand in a pocket", (lex.siblings.get("hands in pockets") || []).includes("hand in pocket"));
eq("holding one's own wrist does not imply holding someone else's", implies("holding own wrist").includes("holding another's wrist"), false);
eq("shushing brings the finger to the mouth", implies("shushing"), ["finger to mouth"]);
ok("shushing keeps the finger-to-mouth tag", !(lex.siblings.get("shushing") || []).includes("finger to mouth"));
eq("flying and praying take the activity slot", [item("flying").mutex, item("praying").mutex], ["activity", "activity"]);
eq("spinning does not take the activity slot", item("spinning").mutex, null);
eq("adjusting eyewear is not an activity", item("adjusting eyewear").mutex, null);
ok("adjusting eyewear needs glasses or the like", ["glasses", "coke-bottle glasses", "goggles", "sunglasses"].every((t) => NEEDS_CONTEXT["adjusting eyewear"].has(t)));
ok("adjusting gloves needs gloves", ["gloves", "elbow gloves", "black gloves", "fingerless gloves", "latex gloves"].every((t) => NEEDS_CONTEXT["adjusting gloves"].has(t)));

eq("6+girls does not imply 5girls", implies("6+girls"), []);
eq("6+girls is a female count", { mutex: item("6+girls").mutex, group: item("6+girls").group }, { mutex: "female_count", group: "count_f" });
eq("4boys and 6+boys are male counts", [item("4boys").mutex, item("6+boys").group], ["male_count", "count_m"]);
eq("yaoi needs two men and no girl theme mixed in", {
  gate: item("yaoi").gate, needs: needs("yaoi"), group: item("yaoi").group,
}, { gate: "male", needs: ["yaoi", "male", "2male", "pair"], group: "other" });
eq("brothers need two men and are not yaoi", {
  needs: needs("brothers"), group: item("brothers").group, implies: implies("brothers"),
}, { needs: ["male", "2male", "pair"], group: "other", implies: [] });
eq("sisters need two women and are not yuri", {
  needs: needs("sisters"), implies: implies("sisters"),
}, { needs: ["female", "2female", "pair"], implies: [] });
eq("a mother and daughter are two women", needs("mother and daughter"), ["female", "2female", "pair"]);
eq("a couple only needs a pair", needs("couple"), ["pair"]);
eq("age difference only needs a pair", needs("age difference"), ["pair"]);
eq("family needs a group", needs("family"), ["group"]);
eq("trap is a man", { gate: item("trap").gate, needs: needs("trap"), group: item("trap").group }, { gate: "male", needs: ["male"], group: "body_m" });
eq("an old woman and a tomboy are female bodies", [item("old woman").group, item("tomboy").group], ["body_f", "body_f"]);
eq("comic is a pin-only style", { section: item("comic").section, group: item("comic").group }, { section: "quality", group: "style" });

{
  const yaoi = tagsOfPrompt(promptOf("yaoi").positive);
  ok("yaoi card is two men", yaoi.has("2boys") && yaoi.has("yaoi") && yaoi.has("adult male") && !yaoi.has("1girl"));
  const sisters = tagsOfPrompt(promptOf("sisters").positive);
  ok("sisters card is two women and not yuri", sisters.has("2girls") && sisters.has("sisters") && sisters.has("mature female") && !sisters.has("yuri") && !sisters.has("1boy"));
  const motherPrompt = promptOf("mother and daughter");
  const mother = tagsOfPrompt(motherPrompt.positive);
  const motherNeg = tagsOfPrompt(motherPrompt.negative);
  ok("mother and daughter card is two adult women",
    mother.has("2girls") && mother.has("mature female") && !mother.has("yuri") && motherNeg.has("loli") && motherNeg.has("child"));
  const brothers = tagsOfPrompt(promptOf("brothers").positive);
  ok("brothers card is two men and not a girl", brothers.has("2boys") && brothers.has("brothers") && !brothers.has("1girl") && !brothers.has("yaoi"));
  const many = tagsOfPrompt(promptOf("6+girls").positive);
  ok("6+girls card keeps the count and stays adult", many.has("6+girls") && many.has("adult") && many.has("mature female") && !many.has("1girl") && !many.has("5girls"));
  const family = promptOf("family");
  const familyPos = tagsOfPrompt(family.positive);
  const familyNeg = tagsOfPrompt(family.negative);
  ok("family card is adults", familyPos.has("1girl") && familyPos.has("1boy") && familyPos.has("family") && familyPos.has("mature female") && familyPos.has("adult"));
  ok("family card still blocks minors", familyNeg.has("loli") && familyNeg.has("child") && familyNeg.has("aged down") && !familyNeg.has("family"));
}

{
  const yaoiPins = pinsOf("yaoi");
  const got = tagSet(draw(base({ girl: true, boy: false, heats: ["tease"] }), yaoiPins, 7));
  ok("pinning yaoi from a girl-only setting still draws two boys and no girl",
    got.has("yaoi") && got.has("2boys") && !got.has("1girl") && !got.has("2girls") && !got.has("5girls") && !got.has("6+girls"));
  const sisterPins = pinsOf("sisters");
  const girlCounts = ["2girls", "3girls", "4girls", "5girls", "6+girls"];
  let clean = 0;
  let badCast = 0;
  for (let i = 1; i <= 20; i += 1) {
    const tags = tagSet(draw(base({ girl: true, boy: false }), sisterPins, i));
    const girls = girlCounts.filter((t) => tags.has(t));
    if (!tags.has("sisters") || girls.length !== 1 || tags.has("1girl") || tags.has("1boy") || tags.has("yaoi")) badCast += 1;
    if (!tags.has("yuri")) clean += 1;
  }
  eq("pinning sisters draws at least two girls and no boy", badCast, 0);
  ok("sisters do not force yuri", clean > 0, `clean=${clean}/20`);
  const crowd = pinsOf("6+girls");
  let replaced = 0;
  for (let i = 1; i <= 20; i += 1) {
    const tags = tagSet(draw(base({ girl: true, boy: true, heats: ["sex"] }), crowd, 8000 + i));
    if (!tags.has("6+girls") || tags.has("1girl") || tags.has("5girls") || tags.has("2girls") || tags.has("4girls")) replaced += 1;
  }
  eq("pinning 6+girls is not rewritten into a smaller cast", replaced, 0);
  const boys = tagSet(draw(base({ girl: true, boy: false, heats: ["tease"] }), pinsOf("4boys"), 11));
  ok("pinning 4boys draws four boys and no girl", boys.has("4boys") && !boys.has("1girl") && !boys.has("1boy") && !boys.has("3boys"));
}

{
  const pinned = pinsOf("walking away");
  const got = tagSet(draw(base({ heats: ["tease"] }), pinned, 4));
  ok("pinning walking away keeps walking", got.has("walking away") && got.has("walking"));
  let sexAway = 0;
  const sex = base({ heats: ["sex"] });
  for (let i = 1; i <= 240; i += 1) {
    if (tagSet(draw(sex, new Set(), i)).has("walking away")) sexAway += 1;
  }
  eq("unpinned walking away stays out of sex, like walking", sexAway, 0);
  const stairs = tagSet(draw(base({ heats: ["tease"] }), pinsOf("sitting on stairs"), 5));
  ok("pinning sitting on stairs keeps sitting", stairs.has("sitting on stairs") && stairs.has("sitting"));
}

{
  let boy = 0;
  let penis = 0;
  let comic = 0;
  for (const seed of [1, 42, 100, 999, 2026]) {
    const tags = tagSet(draw(base(), new Set(), seed));
    if (!tags.has("1girl") || !tags.has("solo") || tags.has("1boy") || tags.has("2boys") || tags.has("yaoi")) boy += 1;
    if (tags.has("penis")) penis += 1;
    if (tags.has("comic") || tags.has("sketch") || tags.has("photorealistic")) comic += 1;
  }
  eq("the five default seeds stay one girl, with no boy and no penis", [boy, penis, comic], [0, 0, 0]);
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nround 4 ok");
