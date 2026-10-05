#!/usr/bin/env node
/** 地點與第五輪缺字。失敗印出並 exit 1。 */
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
function implies(tag) {
  return item(tag)?.implies || [];
}
function needs(tag) {
  return item(tag)?.needs || [];
}
function siblings(tag) {
  return lex.siblings.get(tag) || [];
}
function promptOf(tag) {
  return artPrompt(item(tag), { byTag: lex.byTag });
}
function tagsOfPrompt(prompt) {
  return new Set(String(prompt || "").split(",").map((t) => t.trim()).filter(Boolean));
}

const ZH_OVERRIDE = {
  bookshelf: "書架",
  kotatsu: "暖桌",
  "vehicle interior": "載具內部",
  closet: "衣櫥",
  "dressing room": "後台化妝室",
  "dining room": "家中飯廳",
  purikura: "拍貼機",
  yatai: "屋台",
  "pedestrian bridge": "行人天橋",
  "clock tower": "鐘樓",
  jizou: "地藏",
  overgrown: "雜草叢生",
  wetland: "濕地",
  "science fiction": "科幻",
  "elizabeth tower": "大笨鐘",
  "blush stickers": "腮紅貼",
  "own hands together": "雙手合十",
  "eyes visible through hair": "髮間露眼",
  "polka dot": "圓點",
  "anger vein": "怒筋",
  "index finger raised": "豎食指",
  letterboxed: "上下黑邊",
  veins: "血管",
  reaching: "伸手",
  "star-shaped pupils": "星形瞳",
  aura: "氣場",
  ribs: "肋骨",
  falling: "跌倒",
  "between fingers": "指縫之間",
  perspective: "透視",
  glitch: "故障藝術",
  "diffraction spikes": "星芒",
  embers: "餘燼",
  caustics: "水面光斑",
  underlighting: "底光",
};

function loadCsv(path) {
  return readFileSync(path, "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/).slice(1).map((line) => {
    const [raw, zh] = line.split(",");
    const tag = raw.replace(/_/g, " ");
    return { tag, zh: ZH_OVERRIDE[tag] || zh };
  });
}
const csvRows = [
  ...loadCsv("C:/Users/boshe/Downloads/danbooru_location_tags.csv"),
  ...loadCsv("C:/Users/boshe/Downloads/danbooru_missing_tags_round5.csv"),
];

{
  eq("two csv files have 247 tags", csvRows.length, 247);
  const missing = csvRows.filter((r) => !item(r.tag)).map((r) => r.tag);
  eq("every location and round-5 tag is in the lexicon", missing, []);
  const zhBad = csvRows.filter((r) => item(r.tag) && item(r.tag).zh !== r.zh).map((r) => `${r.tag}:${item(r.tag)?.zh}`);
  eq("chinese names match, collisions renamed", zhBad, []);
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
  ok("sketch stays out of the drawable pool", !item("sketch"));
}

eq("a vehicle interior is not the train interior", item("vehicle interior").zh, "載具內部");
eq("a dining room is not a restaurant", item("dining room").zh, "家中飯廳");
eq("a dressing room is not a changing room", item("dressing room").zh, "後台化妝室");
eq("a pedestrian bridge does not imply the historical bridge", implies("pedestrian bridge").includes("bridge"), false);

const PLACES = [
  "shop", "bakery", "infirmary", "throne room", "boat", "tokyo", "hell", "tunnel", "shore",
];
const OVERLAYS = [
  "fence", "building", "stairs", "road", "path", "town", "sidewalk", "moon", "science fiction",
  "bookshelf", "kotatsu", "blanket", "crane game", "sword", "cake",
];
eq("rooms and landmarks take the place slot", PLACES.map((t) => item(t).mutex), PLACES.map(() => "place"));
eq("props and generic nouns do not take the place slot", OVERLAYS.map((t) => item(t).mutex), OVERLAYS.map(() => null));

eq("a bakery is a shop indoors", implies("bakery"), ["indoors", "shop"]);
eq("a laundromat does not imply a shop", implies("laundromat").includes("shop"), false);
eq("a maid cafe is a cafe", implies("maid cafe"), ["indoors", "cafe"]);
eq("a food stall does not imply a market or eating", implies("yatai"), ["outdoors"]);
eq("conveyor-belt sushi does not imply sushi or eating", implies("conveyor belt sushi"), ["indoors"]);
eq("shibuya implies tokyo and not the city", implies("shibuya (tokyo)"), ["outdoors", "tokyo"]);
eq("tokyo implies the city", implies("tokyo"), ["outdoors", "city"]);
eq("kyoto does not imply the modern city", implies("kyoto (city)").includes("city"), false);
eq("mount fuji is a mountain", implies("mount fuji"), ["outdoors", "mountain"]);
eq("an empty pool is still a pool", implies("empty pool"), ["outdoors", "pool"]);
eq("a spacecraft interior stays in space and not indoors", implies("spacecraft interior"), ["spacecraft", "space"]);
eq("the moon does not imply moonlight or night", implies("moon"), []);
eq("the milky way implies a starry sky", implies("milky way"), ["starry sky"]);
eq("a clear sky implies a blue sky", implies("clear sky"), ["blue sky"]);
eq("snowflakes imply snow", implies("snowflakes"), ["snow"]);
eq("lightning implies electricity", implies("lightning"), ["electricity"]);
eq("blue fire does not invent a fire tag", implies("blue fire"), []);
eq("a shooting star implies a starry sky", implies("shooting star"), ["starry sky"]);

eq("holding a sword brings the sword and the weapon", implies("holding sword"), ["sword", "holding weapon"]);
eq("holding a gun brings the gun and the weapon", implies("holding gun"), ["gun", "holding weapon"]);
eq("dual wielding brings a held weapon and not a random one", implies("dual wielding"), ["holding weapon"]);
eq("aiming does not imply a gun", implies("aiming"), []);
eq("a katana is a sword", implies("katana"), ["sword"]);
eq("a rifle is a gun", implies("rifle"), ["gun"]);
ok("holding a sword keeps both parents", !siblings("holding sword").includes("holding weapon") && !siblings("holding sword").includes("sword"));
ok("lightning keeps electricity", !siblings("lightning").includes("electricity"));

for (const t of ["cake", "candy", "cup", "beer", "onigiri", "bubble tea", "sword", "gun", "coffee"]) {
  ok(`${t} does not imply eating or drinking`, !implies(t).includes("eating") && !implies(t).includes("drinking"));
}

eq("playing guitar brings playing an instrument", implies("playing guitar"), ["playing instrument"]);
ok("playing guitar keeps the instrument tag", !siblings("playing guitar").includes("playing instrument"));
eq("a suspender skirt needs a woman and brings the skirt and the suspenders", {
  gate: item("suspender skirt").gate,
  needs: needs("suspender skirt"),
  implies: implies("suspender skirt"),
  mutex: item("suspender skirt").mutex,
}, { gate: "female", needs: ["female"], implies: ["skirt", "suspenders"], mutex: "bottom" });
eq("lace-up boots are boots", implies("lace-up boots"), ["boots"]);
eq("a crown takes the hat slot and does not imply a hat", { mutex: item("crown").mutex, implies: implies("crown") }, { mutex: "headwear", implies: [] });
ok("a crown conflicts with a hat", siblings("crown").includes("hat"));
eq("an anklet is jewelry, not footwear", item("anklet").mutex, "jewelry");
eq("a pendant brings a necklace", implies("pendant"), ["necklace"]);
eq("a belt buckle brings a belt", implies("belt buckle"), ["belt"]);
eq("a zipper does not imply unzipped", implies("zipper"), []);
eq("buttons are a fabric overlay", item("buttons").group, "fabric");
ok("a shoulder bag keeps the bag", !siblings("shoulder bag").includes("bag"));
ok("a suitcase takes the bag slot without implying bag", siblings("suitcase").includes("bag") && !implies("suitcase").includes("bag"));

eq("star-shaped pupils are eyes", item("star-shaped pupils").group, "eyes");
eq("narrowed eyes are not an expression", item("narrowed eyes").mutex, null);
eq("laughing takes the expression slot", item("laughing").mutex, "expression");
eq("nervous sweating is skin and brings sweat", { group: item("nervous sweating").group, implies: implies("nervous sweating") }, { group: "skin", implies: ["sweat"] });
eq("wide eyes take the expression slot", item("wide-eyed").mutex, "expression");
eq("kicking is a body pose", item("kicking").mutex, "body_pose");
eq("falling is a body pose", item("falling").mutex, "body_pose");
eq("letterboxing is a camera overlay and not the lens slot", { mutex: item("letterboxed").mutex, group: item("letterboxed").group }, { mutex: null, group: "camera" });
eq("perspective is not the foreshortening slot", { mutex: item("perspective").mutex, group: item("perspective").group }, { mutex: null, group: "camera" });
eq("foreshortening still owns the perspective slot", item("foreshortening").mutex, "perspective");
eq("a hand on someone needs two people", needs("hand on another's shoulder"), ["pair"]);
eq("clasped hands can be your own", needs("own hands together"), []);
eq("biceps stay a plain feature", item("biceps").group, "other");
eq("underlighting takes the light slot", item("underlighting").mutex, "lighting");

{
  const hands = tagsOfPrompt(promptOf("own hands together").positive);
  ok("clasped-hands card is one girl", hands.has("1girl") && !hands.has("1boy") && !hands.has("hetero"));
  const shoulder = tagsOfPrompt(promptOf("hand on another's shoulder").positive);
  ok("a hand on someone's shoulder card is a pair", shoulder.has("1girl") && shoulder.has("1boy") && shoulder.has("hetero"));
}

{
  const sword = tagSet(draw(base({ heats: ["tease"] }), pinsOf("holding sword"), 4));
  ok("pinning a held sword keeps the sword and the weapon", sword.has("holding sword") && sword.has("sword") && sword.has("holding weapon"));
  const shop = tagSet(draw(base({ heats: ["tease"] }), pinsOf("bakery"), 5));
  ok("pinning a bakery keeps the shop indoors", shop.has("bakery") && shop.has("shop") && shop.has("indoors") && !shop.has("outdoors"));
  const shibuya = tagSet(draw(base({ heats: ["tease"] }), pinsOf("shibuya (tokyo)"), 6));
  ok("pinning shibuya keeps tokyo and drops the city parent", shibuya.has("shibuya (tokyo)") && shibuya.has("tokyo") && !shibuya.has("city"));
  const tokyo = tagSet(draw(base({ heats: ["tease"] }), pinsOf("tokyo"), 11));
  ok("pinning tokyo keeps the city", tokyo.has("tokyo") && tokyo.has("city") && tokyo.has("outdoors"));
  const craft = tagSet(draw(base({ heats: ["tease"] }), pinsOf("spacecraft interior"), 7));
  ok("pinning a spacecraft interior keeps space and not indoors",
    craft.has("spacecraft interior") && craft.has("spacecraft") && craft.has("space") && !craft.has("indoors") && !craft.has("outdoors"));
  const throne = tagSet(draw(base({ heats: ["tease"], eras: ["victorian"] }), pinsOf("throne room"), 8));
  ok("pinning a throne room keeps the throne it directly names", throne.has("throne room") && throne.has("indoors") && throne.has("throne"));
  const cake = tagSet(draw(base({ heats: ["tease"] }), pinsOf("cake"), 9));
  ok("pinning cake does not start a meal", cake.has("cake") && !cake.has("eating") && !cake.has("drinking"));
  const pair = tagSet(draw(base({ girl: true, boy: false, heats: ["tease"] }), pinsOf("hand on another's shoulder"), 10));
  const girlCounts = ["2girls", "3girls", "4girls", "5girls", "6+girls"];
  ok("a hand on someone's shoulder in a girl-only draw adds girls, not a boy",
    pair.has("hand on another's shoulder") && girlCounts.some((t) => pair.has(t)) && !pair.has("1girl") && !pair.has("1boy") && !pair.has("penis"));
  const throneRaw = tagSet(draw(base({ heats: ["tease"], eras: ["victorian"] }), new Set(["throne room"]), 12));
  ok("a victorian throne room keeps the throne, because that seat exists in the era",
    throneRaw.has("throne room") && throneRaw.has("indoors") && throneRaw.has("throne"));
  let boy = 0;
  let penis = 0;
  for (const seed of [1, 42, 100, 999, 2026]) {
    const tags = tagSet(draw(base(), new Set(), seed));
    if (!tags.has("1girl") || !tags.has("solo") || tags.has("1boy") || tags.has("2boys")) boy += 1;
    if (tags.has("penis")) penis += 1;
  }
  eq("the five default seeds stay one girl, with no boy and no penis", [boy, penis], [0, 0]);
}

{
  // 這些場地進了詞庫，卻不在活動真正用的白名單上。白名單是硬閘：
  // 釘了那個活動時命中數是 0，不是池子稀。門檻只要求出現，不要求佔比。
  function countPlaces(settings, pinned, n, seed0, watch) {
    const hit = Object.fromEntries(watch.map((t) => [t, 0]));
    let empty = 0;
    let brokeParent = 0;
    const pairs = [
      ["bakery", "shop"],
      ["clothes shop", "shop"],
      ["flower shop", "shop"],
      ["bookstore", "shop"],
      ["maid cafe", "cafe"],
      ["throne room", "throne"],
    ];
    for (let i = 0; i < n; i += 1) {
      const tags = tagSet(draw(settings, pinned, seed0 + i));
      let place = false;
      for (const t of tags) {
        const it = item(t);
        if (it && (it.mutex === "place" || it.group === "place")) place = true;
        if (hit[t] !== undefined) hit[t] += 1;
      }
      if (!place) empty += 1;
      for (const [child, parent] of pairs) {
        if (tags.has(child) && !tags.has(parent)) brokeParent += 1;
      }
    }
    return { hit, empty, brokeParent };
  }
  const modern = base({ heats: ["tease"] });
  const shopHits = countPlaces(modern, pinsOf("shopping"), 160, 880000, [
    "shop", "bakery", "clothes shop", "flower shop", "bookstore", "convenience store",
  ]);
  ok("pinned shopping can land in a real shop", ["shop", "bakery", "clothes shop", "flower shop", "bookstore"].every((t) => shopHits.hit[t] > 0), JSON.stringify(shopHits));
  ok("pinned shopping still uses the old shops", shopHits.hit["convenience store"] > 0, JSON.stringify(shopHits.hit));
  const meal = ["dining room", "cafeteria", "conveyor belt sushi", "yatai", "maid cafe", "cafe"];
  const eatHits = countPlaces(modern, pinsOf("eating"), 200, 881000, meal);
  ok("pinned eating can use the new meal rooms", meal.every((t) => eatHits.hit[t] > 0), JSON.stringify(eatHits));
  const drinkHits = countPlaces(modern, pinsOf("drinking"), 160, 882000, ["maid cafe", "dining room", "cafeteria", "yatai", "cafe"]);
  ok("pinned drinking can use a maid cafe, a dining room, a cafeteria, or a stall", ["maid cafe", "dining room", "cafeteria", "yatai"].every((t) => drinkHits.hit[t] > 0), JSON.stringify(drinkHits));
  const maidEat = countPlaces(modern, pinsOf("maid", "eating"), 80, 883000, ["cafe", "maid cafe", "playing sports", "exercising", "training"]);
  ok("a maid can eat at a cafe", maidEat.hit.cafe > 0 && maidEat.hit["maid cafe"] > 0, JSON.stringify(maidEat));
  ok("letting a maid into a cafe does not send her to sports", maidEat.hit["playing sports"] + maidEat.hit.exercising + maidEat.hit.training === 0, JSON.stringify(maidEat));
  const nurseHits = countPlaces(modern, pinsOf("nurse"), 60, 884000, ["infirmary", "clinic", "hospital"]);
  ok("a nurse can be in the infirmary and still at the clinic", nurseHits.hit.infirmary > 0 && nurseHits.hit.clinic > 0, JSON.stringify(nurseHits));
  const readHits = countPlaces(modern, pinsOf("reading"), 120, 885000, ["clubroom"]);
  ok("reading can happen in a clubroom", readHits.hit.clubroom > 0, JSON.stringify(readHits));
  const driveHits = countPlaces(modern, pinsOf("driving"), 80, 886000, ["gas station"]);
  ok("driving can stop at a gas station", driveHits.hit["gas station"] > 0, JSON.stringify(driveHits));
  const waitHits = countPlaces(modern, pinsOf("waitress"), 60, 887000, ["maid cafe", "cafe"]);
  ok("a waitress can work a maid cafe", waitHits.hit["maid cafe"] > 0 && waitHits.hit.cafe > 0, JSON.stringify(waitHits));
  const throneHits = countPlaces(base({ heats: ["tease"], eras: ["victorian"] }), pinsOf("eating"), 100, 888000, ["throne room", "throne"]);
  ok("victorian eating can use the throne room", throneHits.hit["throne room"] > 0, JSON.stringify(throneHits));
  const samples = [shopHits, eatHits, drinkHits, maidEat, nurseHits, readHits, driveHits, waitHits, throneHits];
  ok("these venue pins still get a place", samples.every((s) => s.empty === 0), samples.map((s) => s.empty).join(","));
  ok("a child venue keeps the place it names", samples.every((s) => s.brokeParent === 0), String(samples.reduce((n, s) => n + s.brokeParent, 0)));
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nround 5 ok");
