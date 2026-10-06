#!/usr/bin/env node
/** 第二輪 CSV 的分類、尺度、互斥與抽取。失敗印出並 exit 1。 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  applyPin,
  defaultSettings,
  drawOne,
  indexLexicon,
  mulberry32,
  ratingBlocked,
} from "../web/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web/lexicon.json"), "utf8"));
const lex = indexLexicon(data);
const csvText = readFileSync("C:/Users/boshe/Downloads/danbooru_missing_tags_round2.csv", "utf8");

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
const ZH_OVERRIDE = { "cocktail dress": "短晚禮服" };
const csvRows = csvText.replace(/^\uFEFF/, "").trim().split(/\r?\n/).slice(1).map((line) => {
  const [raw, zh] = line.split(",");
  const tag = raw.replace(/_/g, " ");
  return { tag, zh: ZH_OVERRIDE[tag] || zh };
});

{
  eq("round 2 csv has 149 tags", csvRows.length, 149);
  // 2026-10-06：pilot suit 被 Danbooru 停用、拆成三種衣服，詞庫改收 mecha pilot suit（見 merge_lexicon.extra_csv_round2）。
  const RETIRED = new Map([["pilot suit", "mecha pilot suit"]]);
  const missing = csvRows.filter((r) => !item(r.tag) && !(RETIRED.has(r.tag) && item(RETIRED.get(r.tag)))).map((r) => r.tag);
  eq("every csv tag is in the lexicon", missing, []);
  const zhBad = csvRows.filter((r) => item(r.tag) && item(r.tag).zh !== r.zh).map((r) => `${r.tag}:${item(r.tag)?.zh}`);
  eq("chinese names match, cocktail dress is 短晚禮服", zhBad, []);
  const bannedChild = [];
  for (const r of csvRows) {
    for (const t of chain(r.tag)) {
      if (t === "loli" || t === "shota" || t === "child") bannedChild.push(`${r.tag}->${t}`);
    }
  }
  eq("no new tag implies loli, shota, or child", bannedChild, []);
  const zh = new Map();
  const dups = [];
  for (const t of data.tags) {
    if (!t.zh) continue;
    if (zh.has(t.zh)) dups.push(`${t.zh}: ${zh.get(t.zh)} / ${t.tag}`);
    else zh.set(t.zh, t.tag);
  }
  eq("chinese names stay unique", dups, []);
  ok("looking away stays retired", !item("looking away"));
  ok("fur coat still does not imply coat", !(item("fur coat")?.implies || []).includes("coat"));
  const neg = data.negative.split(", ").map((t) => t.trim());
  eq("negative still ends with loli, child, aged down", neg.slice(-3), ["loli", "child", "aged down"]);
}

function implies(tag) {
  return item(tag)?.implies || [];
}
function needs(tag) {
  return item(tag)?.needs || [];
}

eq("pegging implies strap-on and not penis", implies("pegging"), ["strap-on"]);
eq("strap-on implies dildo and not penis", implies("strap-on"), ["dildo"]);
ok("dildo does not imply penis", !implies("dildo").includes("penis"));
eq("dildo riding is solo", { needs: needs("dildo riding"), implies: implies("dildo riding"), mutex: item("dildo riding").mutex }, {
  needs: ["female"], implies: ["dildo"], mutex: "sex_act",
});
eq("prostate milking needs both and a pair", needs("prostate milking").slice().sort(), ["female", "male", "pair"]);
eq("cum in container needs a male and implies cum", { needs: needs("cum in container"), implies: implies("cum in container") }, {
  needs: ["male"], implies: ["cum"],
});
eq("height difference needs a pair and is not a height slot", {
  needs: needs("height difference"), mutex: item("height difference").mutex,
}, { needs: ["pair"], mutex: null });
eq("cowgirl (western) is a job and not the sex position", {
  mutex: item("cowgirl (western)").mutex,
  implies: implies("cowgirl (western)"),
}, { mutex: "job", implies: [] });
eq("lolita fashion does not imply loli", implies("lolita fashion"), []);
eq("gothic lolita implies the fashion, not loli", implies("gothic lolita"), ["lolita fashion"]);
eq("furisode is edo and implies kimono", {
  era: item("furisode").era, implies: implies("furisode"), group: item("furisode").group,
}, { era: ["edo"], implies: ["kimono"], group: "era" });
eq("bikini armor implies neither bikini nor armor", implies("bikini armor"), []);
eq("swimsuit under clothes does not imply swimsuit", implies("swimsuit under clothes"), []);
eq("latex gloves imply gloves", implies("latex gloves"), ["gloves"]);
eq("sweater vest implies vest, not sweater", implies("sweater vest"), ["vest"]);
eq("thong leotard implies leotard, not thong", implies("thong leotard"), ["leotard"]);
// 2026-10-06 第六輪：詞庫有了 highleg（高衩）這個父標籤，照 Danbooru 一起帶出。重點仍是不帶出丁字褲。
eq("highleg leotard implies leotard and highleg, not thong", implies("highleg leotard"), ["leotard", "highleg"]);
ok("pant suit does not imply pants", !implies("pant suit").includes("pants"));
ok("catsuit implies neither bodysuit nor cat", !implies("catsuit").includes("bodysuit") && !implies("catsuit").some((t) => t.includes("cat")));
for (const t of ["rope", "cuffs", "shackles", "bound ankles"]) {
  ok(`${t} does not imply bondage`, !implies(t).includes("bondage"));
}
eq("tape gag and bit gag imply gag only", [implies("tape gag"), implies("bit gag")], [["gag"], ["gag"]]);
eq("ring gag implies gag and an open mouth", implies("ring gag"), ["gag", "open mouth"]);
eq("rape face stays sex-only", item("rape face").heat, ["sex"]);
eq("uncensored is a pin-only quality style", {
  section: item("uncensored").section, group: item("uncensored").group,
}, { section: "quality", group: "style" });
eq("public use needs a woman, a man, and a pair", needs("public use").slice().sort(), ["female", "male", "pair"]);
ok("public use does not need two men", !needs("public use").includes("2male"));
eq("femdom needs only a woman", needs("femdom"), ["female"]);
ok("interspecies does not imply bestiality or a man", !implies("interspecies").includes("bestiality") && !needs("interspecies").includes("male"));
eq("underwater sex implies underwater and needs a pair of women-or-more", {
  implies: implies("underwater sex"), needs: needs("underwater sex").slice().sort(),
}, { implies: ["underwater"], needs: ["female", "pair"] });
ok("fake animal ears do not imply real ears", !implies("fake animal ears").includes("animal ears"));
eq("blurry foreground is camera and stacks", { group: item("blurry foreground").group, mutex: item("blurry foreground").mutex }, {
  group: "camera", mutex: null,
});
eq("time stop is an effect, not a sex act", { section: item("time stop").section, mutex: item("time stop").mutex, group: item("time stop").group }, {
  section: "env", mutex: "effect", group: "effect",
});
eq("uterus is a body feature, not a sex act", { group: item("uterus").group, mutex: item("uterus").mutex }, {
  group: "body_f", mutex: null,
});

{
  const u = item("uncensored");
  const ass = item("ass tattoo");
  const pole = item("pole dancing");
  ok("uncensored is explicit-only", ratingBlocked(u, "general") && ratingBlocked(u, "sensitive") && !ratingBlocked(u, "explicit"));
  ok("ass tattoo is sensitive, not general", ratingBlocked(ass, "general") && !ratingBlocked(ass, "sensitive"));
  ok("tramp stamp is sensitive, not general", ratingBlocked(item("tramp stamp"), "general") && !ratingBlocked(item("tramp stamp"), "sensitive"));
  ok("pole dancing is blocked on general", ratingBlocked(pole, "general") && !ratingBlocked(pole, "explicit"));
}

function sexActsExcept(keep) {
  const banned = new Set();
  for (const t of data.tags) if (t.mutex === "sex_act" && t.tag !== keep) banned.add(t.tag);
  return banned;
}
function posesExcept(keep) {
  const banned = new Set();
  for (const t of data.tags) if (t.section === "pose" && t.tag !== keep) banned.add(t.tag);
  return banned;
}

const sex = base({ heats: ["sex"], weights: { tease: 0, flash: 0, sex: 1, activity: 0 } });
const pair = base({
  girl: true, boy: true, heats: ["sex"],
  weights: { tease: 0, flash: 0, sex: 1, activity: 0 },
  // 姿勢留 1，性愛動作才補得進去；長相和衣服關掉，避免別的字把陰莖帶進來。
  counts: { subject: 2, feature: 0, pose: 1, clothing: 0, env: 0 },
});
const bare = base({
  counts: { subject: 0, feature: 0, pose: 0, clothing: 0, env: 0 },
  heats: ["sex"],
  weights: { tease: 0, flash: 0, sex: 1, activity: 0 },
});

{
  const peg = tagSet(draw(pair, pinsOf("chastity belt"), 11, sexActsExcept("pegging")));
  ok("a chastity belt keeps pegging", peg.has("chastity belt") && peg.has("pegging") && peg.has("strap-on") && peg.has("dildo") && peg.has("1boy"));
  ok("pegging does not write the word penis", !peg.has("penis"));
  for (const act of ["hairjob", "naizuri", "prostate milking"]) {
    const have = tagSet(draw(pair, pinsOf("chastity belt"), 12, sexActsExcept(act)));
    ok(`a chastity belt keeps ${act}`, have.has("chastity belt") && have.has(act) && have.has("1boy"));
  }
  for (const act of ["buttjob", "kneepit sex"]) {
    const have = tagSet(draw(pair, pinsOf("chastity belt"), 13, sexActsExcept(act)));
    ok(`a chastity belt blocks ${act}`, have.has("chastity belt") && !have.has(act));
  }
  const rideBan = posesExcept("dildo riding");
  const rideSettings = base({
    counts: { subject: 0, feature: 0, pose: 6, clothing: 0, env: 0 },
    heats: ["sex"],
    weights: { tease: 0, flash: 0, sex: 1, activity: 0 },
  });
  const ride = tagSet(draw(rideSettings, new Set(), 14, rideBan));
  ok("dildo riding on a girl adds a dildo and no boy", ride.has("dildo riding") && ride.has("dildo") && ride.has("1girl") && !ride.has("1boy") && !ride.has("penis"));
  const rideBelt = tagSet(draw(rideSettings, pinsOf("chastity belt"), 15, rideBan));
  ok("a chastity belt blocks dildo riding", rideBelt.has("chastity belt") && !rideBelt.has("dildo riding"));
}

{
  const peg = tagSet(draw(bare, pinsOf("pegging"), 21));
  ok("pinning pegging on a girl-only setting adds the boy, the strap-on, and the dildo",
    peg.has("pegging") && peg.has("1girl") && peg.has("1boy") && peg.has("strap-on") && peg.has("dildo") && !peg.has("penis"));
  const cup = tagSet(draw(bare, pinsOf("cum in container"), 22));
  ok("pinning cum in container keeps the girl and adds the boy and the cum",
    cup.has("cum in container") && cup.has("cum") && cup.has("1girl") && cup.has("1boy"));
  const gap = tagSet(draw(base({
    heats: ["tease"],
    weights: { tease: 1, flash: 0, sex: 0, activity: 0 },
    counts: { subject: 0, feature: 0, pose: 0, clothing: 0, env: 0 },
  }), pinsOf("height difference"), 23));
  ok("height difference makes two girls and does not add a boy",
    gap.has("height difference") && gap.has("2girls") && !gap.has("1boy") && !gap.has("solo"));
  const swap = tagSet(draw(base({
    heats: ["tease"],
    weights: { tease: 1, flash: 0, sex: 0, activity: 0 },
    counts: { subject: 0, feature: 0, pose: 0, clothing: 0, env: 0 },
  }), pinsOf("genderswap"), 24));
  ok("genderswap on a girl stays female", swap.has("genderswap") && !swap.has("1boy") && !swap.has("2boys") && [...swap].some((t) => /^\d+girls?$/.test(t)));
}

{
  let ears = 0;
  for (let i = 0; i < 160; i += 1) if (tagSet(draw(base(), new Set(), 3000 + i)).has("fake animal ears")) ears += 1;
  ok("fake animal ears show up on their own roll", ears >= 8 && ears <= 70, `ears=${ears}/160`);
  const pinnedEars = tagSet(draw(bare, pinsOf("fake animal ears"), 25));
  ok("fake animal ears do not pull real animal ears", pinnedEars.has("fake animal ears") && !pinnedEars.has("animal ears"));
}

{
  let raw = 0;
  for (let i = 0; i < 80; i += 1) if (tagSet(draw(base(), new Set(), 4000 + i)).has("uncensored")) raw += 1;
  eq("uncensored is not auto-drawn", raw, 0);
  const kept = tagSet(draw(bare, pinsOf("uncensored"), 26));
  ok("explicit can keep a pinned uncensored", kept.has("uncensored"));
  const general = tagSet(draw(base({ rating: "general", heats: ["tease"], weights: { tease: 1, flash: 0, sex: 0, activity: 0 } }), pinsOf("uncensored"), 27));
  ok("general drops a pinned uncensored", !general.has("uncensored"));
  const sensitive = tagSet(draw(base({ rating: "sensitive" }), pinsOf("uncensored"), 28));
  ok("sensitive drops a pinned uncensored", !sensitive.has("uncensored"));
}

{
  const loli = tagSet(draw(base(), pinsOf("loli"), 29));
  ok("a pinned loli is still dropped", !loli.has("loli"));
  const fashion = tagSet(draw(bare, pinsOf("lolita fashion"), 30));
  ok("lolita fashion does not bring loli", fashion.has("lolita fashion") && !fashion.has("loli"));
}

{
  let open = 0;
  let otherGag = 0;
  let missing = 0;
  for (let i = 0; i < 20; i += 1) {
    const have = tagSet(draw(sex, pinsOf("tape gag"), 5000 + i));
    if (!have.has("tape gag") || !have.has("gag")) missing += 1;
    if (have.has("open mouth")) open += 1;
    if (have.has("bit gag") || have.has("ring gag")) otherGag += 1;
  }
  eq("tape gag keeps gag and blocks an open mouth", missing + open + otherGag, 0);
  let oral = 0;
  let ringMiss = 0;
  for (let i = 0; i < 20; i += 1) {
    const have = tagSet(draw(pair, pinsOf("ring gag"), 5200 + i));
    if (!have.has("ring gag") || !have.has("gag") || !have.has("open mouth")) ringMiss += 1;
    if (have.has("fellatio") || have.has("tape gag") || have.has("bit gag")) oral += 1;
  }
  eq("ring gag opens the mouth and blocks fellatio and the other gags", ringMiss + oral, 0);
}

{
  let bad = 0;
  let miss = 0;
  const flash = base({ heats: ["flash"], weights: { tease: 0, flash: 1, sex: 0, activity: 0 } });
  for (let i = 0; i < 20; i += 1) {
    const have = tagSet(draw(flash, pinsOf("bikini top only"), 5400 + i));
    if (!have.has("bikini top only") || !have.has("bottomless")) miss += 1;
    for (const t of have) {
      if (t === "bikini top only" || t === "bottomless") continue;
      const it = item(t);
      if (it && (it.mutex === "bottom" || it.mutex === "underwear_bottom" || it.mutex === "onepiece")) bad += 1;
    }
  }
  eq("bikini top only keeps the bottom bare", miss + bad, 0);
}

{
  const only = tagSet(draw(base({
    heats: ["tease"],
    weights: { tease: 1, flash: 0, sex: 0, activity: 0 },
    counts: { subject: 0, feature: 0, pose: 0, clothing: 0, env: 0 },
  }), pinsOf("swimsuit under clothes"), 31));
  ok("swimsuit under clothes is removed when nothing is worn over it", !only.has("swimsuit under clothes") && !only.has("swimsuit"));
  const layered = tagSet(draw(base({
    heats: ["tease"],
    weights: { tease: 1, flash: 0, sex: 0, activity: 0 },
    counts: { subject: 0, feature: 0, pose: 0, clothing: 0, env: 0 },
  }), pinsOf("dress", "swimsuit under clothes"), 32));
  ok("swimsuit under a dress stays, and does not become the swimsuit",
    layered.has("dress") && layered.has("swimsuit under clothes") && !layered.has("swimsuit"));
  const garter = tagSet(draw(base({
    heats: ["tease"],
    weights: { tease: 1, flash: 0, sex: 0, activity: 0 },
    counts: { subject: 0, feature: 0, pose: 0, clothing: 0, env: 0 },
  }), pinsOf("swimsuit under clothes", "garter belt"), 33));
  ok("a garter belt is not clothes over a swimsuit", garter.has("garter belt") && !garter.has("swimsuit under clothes"));
  const uw = defaultSettings(data);
  uw.girl = true;
  uw.rating = "explicit";
  for (const seed of [58, 1131, 117]) {
    const have = tagSet(draw(uw, pinsOf("underwear only"), seed));
    ok(`pinned underwear only stays at seed ${seed}`, have.has("underwear only") && !have.has("swimsuit under clothes") && !have.has("sportswear"));
  }
  // 詞庫變大之後，淋浴從 seed 87 挪到 164，第六輪（2026-10-06）再挪到 155。規則沒變：淋浴會拿掉只穿內衣
  // （1～3000 顆種子裡抽到淋浴的 4 次都拿掉了）。
  const shower = tagSet(draw(uw, pinsOf("underwear only"), 155));
  ok("a shower drops pinned underwear only, and the hidden swimsuit stays gone",
    !shower.has("underwear only") && shower.has("showering") && !shower.has("swimsuit under clothes"));
}

{
  const medieval = base({ eras: ["medieval"], heats: ["tease"], weights: { tease: 1, flash: 0, sex: 0, activity: 0 } });
  let queenMiss = 0;
  for (let i = 0; i < 8; i += 1) {
    const have = tagSet(draw(medieval, pinsOf("queen"), 6000 + i));
    if (!have.has("queen") || !have.has("palace")) queenMiss += 1;
  }
  eq("a queen is in the palace", queenMiss, 0);

  let spaceBad = 0;
  for (let i = 0; i < 8; i += 1) {
    const have = tagSet(draw(base({ heats: ["tease"], weights: { tease: 1, flash: 0, sex: 0, activity: 0 } }), pinsOf("astronaut"), 6100 + i));
    if (!have.has("astronaut") || !have.has("space") || have.has("indoors") || have.has("outdoors")) spaceBad += 1;
  }
  eq("an astronaut is in space, with no indoors or outdoors", spaceBad, 0);

  const westOk = new Set(["farm", "barn", "street"]);
  let westBad = 0;
  for (let i = 0; i < 8; i += 1) {
    const have = tagSet(draw(base({ heats: ["tease"], weights: { tease: 1, flash: 0, sex: 0, activity: 0 } }), pinsOf("cowgirl (western)"), 6200 + i));
    const place = [...have].find((t) => item(t)?.mutex === "place");
    if (!have.has("cowgirl (western)") || have.has("cowgirl position") || !westOk.has(place)) westBad += 1;
  }
  eq("a western cowgirl is on the farm, the barn, or the street", westBad, 0);

  let poleMiss = 0;
  for (let i = 0; i < 8; i += 1) {
    const have = tagSet(draw(base({ heats: ["tease"], weights: { tease: 1, flash: 0, sex: 0, activity: 0 } }), pinsOf("pole dancing"), 6300 + i));
    if (!have.has("pole dancing") || !have.has("stage")) poleMiss += 1;
  }
  eq("pole dancing is on a stage", poleMiss, 0);

  const domOk = new Set(["dungeon", "bedroom"]);
  let domBad = 0;
  for (let i = 0; i < 8; i += 1) {
    const have = tagSet(draw(sex, pinsOf("dominatrix"), 6400 + i));
    const place = [...have].find((t) => item(t)?.mutex === "place");
    if (!have.has("dominatrix") || !domOk.has(place)) domBad += 1;
  }
  eq("a dominatrix is in the dungeon or the bedroom", domBad, 0);

  let modelStage = 0;
  let modelN = 0;
  for (let i = 0; i < 16; i += 1) {
    const have = tagSet(draw(base({ heats: ["tease"], weights: { tease: 1, flash: 0, sex: 0, activity: 0 } }), pinsOf("model"), 6500 + i));
    if (!have.has("model")) continue;
    modelN += 1;
    if (have.has("stage")) modelStage += 1;
  }
  ok("a model is not locked to the stage", modelN === 16 && modelStage < 16, `stage=${modelStage}/${modelN}`);
}

{
  for (const seed of [1, 42, 100, 999, 2026]) {
    const have = tagSet(draw(base(), new Set(), seed));
    ok(`default seed ${seed} stays one girl and does not say penis`,
      have.has("1girl") && have.has("solo") && !have.has("1boy") && !have.has("2boys") && !have.has("penis"));
  }
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall round-2 checks passed");
