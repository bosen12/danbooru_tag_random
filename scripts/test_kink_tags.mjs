#!/usr/bin/env node
/** 56 個新詞的分類、尺度、互斥與抽取。失敗印出並 exit 1。 */
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

const ALL = ["tease", "flash", "sex"];
const SEX = ["sex"];
const FLASH = ["flash", "sex"];

/** 生成後應有的形狀。空陣列表示 implies／needs 沒有。mutex null 表示不佔格。 */
const EXPECT = {
  "multiple views": { section: "pose", group: "camera", mutex: "camera", heat: ALL, gate: "any", layer: "normal", implies: [], needs: [], zh: "多視角" },
  "split screen": { section: "pose", group: "camera", mutex: "camera", heat: ALL, gate: "any", layer: "normal", implies: [], needs: [], zh: "分割畫面" },
  "pov hands": { section: "pose", group: "camera", mutex: "camera", heat: ALL, gate: "any", layer: "normal", implies: ["pov"], needs: [], zh: "第一人稱手" },
  "cross-section": { section: "pose", group: "sex", mutex: null, heat: SEX, gate: "any", layer: "normal", implies: [], needs: [], zh: "剖面圖" },
  "x-ray": { section: "pose", group: "sex", mutex: null, heat: SEX, gate: "any", layer: "normal", implies: [], needs: [], zh: "透視圖" },
  "crying with eyes open": { section: "pose", group: "face", mutex: "expression", heat: ALL, gate: "any", layer: "normal", implies: ["crying"], needs: [], zh: "睜眼流淚" },
  "monster girl": { section: "feature", group: "race", mutex: null, heat: ALL, gate: "female", layer: "normal", implies: [], needs: ["female"], zh: "魔物娘" },
  "demon girl": { section: "feature", group: "race", mutex: "race", heat: ALL, gate: "female", layer: "normal", implies: ["monster girl"], needs: ["female"], zh: "惡魔娘" },
  "slime girl": { section: "feature", group: "race", mutex: "race", heat: ALL, gate: "female", layer: "normal", implies: ["monster girl"], needs: ["female"], zh: "史萊姆娘" },
  "cow girl": { section: "feature", group: "race", mutex: "race", heat: ALL, gate: "female", layer: "normal", implies: [], needs: ["female"], zh: "乳牛娘" },
  "futanari": { section: "feature", group: "body_f", mutex: null, heat: ALL, gate: "female", layer: "normal", implies: [], needs: ["female"], zh: "扶他" },
  "faceless male": { section: "feature", group: "body_m", mutex: null, heat: ALL, gate: "male", layer: "normal", implies: [], needs: ["male"], zh: "無臉男" },
  "quadruple amputee": { section: "feature", group: "body_f", mutex: null, heat: SEX, gate: "female", layer: "normal", implies: [], needs: ["female"], zh: "四肢截斷" },
  "breast expansion": { section: "feature", group: "body_f", mutex: null, heat: SEX, gate: "female", layer: "normal", implies: ["large breasts"], needs: ["female"], zh: "乳房膨脹" },
  "pubic tattoo": { section: "feature", group: "skin", mutex: null, heat: SEX, gate: "female", layer: "normal", implies: [], needs: ["female"], zh: "淫紋" },
  "heart tattoo": { section: "feature", group: "skin", mutex: null, heat: ALL, gate: "any", layer: "normal", implies: [], needs: [], zh: "愛心刺青" },
  "body writing": { section: "feature", group: "skin", mutex: null, heat: ALL, gate: "any", layer: "normal", implies: [], needs: [], zh: "身體塗鴉" },
  "tally": { section: "feature", group: "skin", mutex: null, heat: SEX, gate: "female", layer: "normal", implies: [], needs: ["female"], zh: "正字記號" },
  "torn clothes": { section: "clothing", group: "fabric", mutex: null, heat: ALL, gate: "any", layer: "garment", implies: [], needs: [], zh: "破衣" },
  "cleavage cutout": { section: "clothing", group: "top", mutex: "top", heat: ALL, gate: "female", layer: "garment", implies: ["clothing cutout"], needs: ["female"], zh: "胸口挖洞" }, // 第六輪：帶出衣物挖空
  "virgin killer sweater": { section: "clothing", group: "top", mutex: "top", heat: ALL, gate: "female", layer: "garment", implies: ["sweater"], needs: ["female"], zh: "處男殺手毛衣" },
  "backless outfit": { section: "clothing", group: "onepiece", mutex: "onepiece", heat: ALL, gate: "female", layer: "garment", implies: [], needs: ["female"], zh: "露背裝" },
  "o-ring bikini": { section: "clothing", group: "onepiece", mutex: "onepiece", heat: ALL, gate: "female", layer: "garment", implies: ["bikini"], needs: ["female"], zh: "O環比基尼" },
  "reverse bunnysuit": { section: "clothing", group: "onepiece", mutex: "onepiece", heat: ALL, gate: "female", layer: "garment", implies: [], needs: ["female"], zh: "逆兔女郎" },
  "harem outfit": { section: "clothing", group: "onepiece", mutex: "onepiece", heat: ALL, gate: "female", layer: "garment", implies: [], needs: ["female"], zh: "後宮舞孃裝" },
  "crotchless": { section: "clothing", group: "underwear", mutex: "underwear_bottom", heat: FLASH, gate: "female", layer: "garment", implies: [], needs: ["female"], zh: "開襠" },
  "chastity belt": { section: "clothing", group: "underwear", mutex: "underwear_bottom", heat: SEX, gate: "female", layer: "garment", implies: [], needs: ["female"], zh: "貞操帶" },
  "gag": { section: "clothing", group: "acc", mutex: null, heat: SEX, gate: "any", layer: "accessory", implies: [], needs: [], zh: "口塞" },
  "spreader bar": { section: "clothing", group: "acc", mutex: null, heat: SEX, gate: "any", layer: "accessory", implies: [], needs: [], zh: "分腿棍" },
  "nipple tassels": { section: "clothing", group: "acc", mutex: null, heat: FLASH, gate: "female", layer: "accessory", implies: [], needs: ["female"], zh: "乳貼流蘇" },
  "public vibrator": { section: "clothing", group: "acc", mutex: null, heat: SEX, gate: "female", layer: "accessory", implies: ["vibrator"], needs: ["female"], zh: "公共跳蛋" },
  "public nudity": { section: "pose", group: "flash", mutex: null, heat: FLASH, gate: "any", layer: "normal", implies: ["nude"], needs: [], zh: "公開裸體" },
  "mind control": { section: "pose", group: "sex", mutex: null, heat: SEX, gate: "any", layer: "normal", implies: [], needs: [], zh: "洗腦" },
  "hypnosis": { section: "pose", group: "sex", mutex: null, heat: SEX, gate: "any", layer: "normal", implies: ["mind control"], needs: [], zh: "催眠" },
  "corruption": { section: "pose", group: "sex", mutex: null, heat: SEX, gate: "any", layer: "normal", implies: [], needs: [], zh: "惡墮" },
  "humiliation": { section: "pose", group: "sex", mutex: null, heat: SEX, gate: "any", layer: "normal", implies: [], needs: [], zh: "羞辱" },
  "slave": { section: "pose", group: "sex", mutex: null, heat: SEX, gate: "any", layer: "normal", implies: [], needs: [], zh: "奴隸" },
  "guro": { section: "pose", group: "sex", mutex: null, heat: SEX, gate: "any", layer: "normal", implies: [], needs: [], zh: "獵奇" },
  "inflation": { section: "pose", group: "sex", mutex: null, heat: SEX, gate: "female", layer: "normal", implies: [], needs: ["female"], zh: "肚子膨脹" },
  "cum inflation": { section: "pose", group: "sex", mutex: null, heat: SEX, gate: "female", layer: "normal", implies: ["cum", "inflation"], needs: ["female", "male"], zh: "灌精鼓肚" },
  "prolapse": { section: "pose", group: "sex", mutex: null, heat: SEX, gate: "female", layer: "normal", implies: [], needs: ["female"], zh: "脫垂" },
  "anal prolapse": { section: "pose", group: "sex", mutex: null, heat: SEX, gate: "female", layer: "normal", implies: ["prolapse"], needs: ["female"], zh: "肛門脫垂" },
  "sex machine": { section: "pose", group: "sex", mutex: "sex_act", heat: SEX, gate: "female", layer: "normal", implies: [], needs: ["female"], zh: "性愛機器" },
  "large insertion": { section: "pose", group: "sex", mutex: "sex_act", heat: SEX, gate: "female", layer: "normal", implies: ["object insertion"], needs: ["female"], zh: "巨大插入" },
  "urethral insertion": { section: "pose", group: "sex", mutex: "sex_act", heat: SEX, gate: "female", layer: "normal", implies: [], needs: ["female"], zh: "尿道插入" },
  "egg laying": { section: "pose", group: "sex", mutex: "sex_act", heat: SEX, gate: "female", layer: "normal", implies: [], needs: ["female"], zh: "產卵" },
  "nipple penetration": { section: "pose", group: "sex", mutex: "sex_act", heat: SEX, gate: "female", layer: "normal", implies: [], needs: ["female"], zh: "乳頭插入" },
  "fisting": { section: "pose", group: "sex", mutex: "sex_act", heat: SEX, gate: "female", layer: "normal", implies: [], needs: ["female"], zh: "拳交" },
  "vore": { section: "pose", group: "sex", mutex: "sex_act", heat: SEX, gate: "any", layer: "normal", implies: [], needs: ["pair"], zh: "吞食" },
  "armpit sex": { section: "pose", group: "sex", mutex: "sex_act", heat: SEX, gate: "female", layer: "normal", implies: [], needs: ["female", "male", "pair"], zh: "腋交" },
  "cervical penetration": { section: "pose", group: "sex", mutex: "sex_act", heat: SEX, gate: "female", layer: "normal", implies: ["vaginal"], needs: ["female", "male", "pair"], zh: "子宮姦" },
  "triple penetration": { section: "pose", group: "sex", mutex: "sex_act", heat: SEX, gate: "female", layer: "normal", implies: [], needs: ["female", "male", "pair", "group", "2male"], zh: "三穴同插" },
  "dungeon": { section: "env", group: "place", mutex: "place", heat: ALL, gate: "any", layer: "normal", implies: ["indoors"], needs: [], zh: "地牢" },
  "prison cell": { section: "env", group: "place", mutex: "place", heat: ALL, gate: "any", layer: "normal", implies: ["indoors"], needs: [], zh: "牢房" },
  "glory hole": { section: "env", group: "place", mutex: "place", heat: SEX, gate: "any", layer: "normal", implies: ["indoors"], needs: [], zh: "牆洞" },
  "wooden horse": { section: "env", group: "furniture", mutex: "furniture", heat: SEX, gate: "any", layer: "normal", implies: [], needs: [], zh: "木馬刑具" },
};

const THEMES = [
  "cross-section", "x-ray", "mind control", "hypnosis", "corruption", "humiliation",
  "slave", "guro", "inflation", "cum inflation", "prolapse", "anal prolapse",
];
const ACTS = [
  "sex machine", "large insertion", "urethral insertion", "egg laying",
  "nipple penetration", "fisting", "vore", "armpit sex", "cervical penetration",
  "triple penetration",
];
const SOLO_ACTS = ["sex machine", "large insertion", "urethral insertion", "egg laying", "nipple penetration", "fisting"];
const MALE_FACE = ["facial hair", "stubble", "beard", "goatee", "mustache"];
const PRIVATE = ["bedroom", "hotel room", "love hotel", "bathroom", "shower", "bathtub", "on bed", "bed"];
const ORAL = ["fellatio", "deepthroat", "irrumatio", "cunnilingus", "anilingus", "kiss", "french kiss", "kissing neck", "licking penis", "imminent fellatio", "reverse fellatio", "throat bulge"];
const LIMB = ["handjob", "walking", "running", "jumping", "tiptoes", "footjob", "thigh sex", "leg lock", "hugging own legs", "fetal position", "curled up"];
const AMPUTEE_WORN = [
  "wide sleeves", "long sleeves", "short sleeves", "sleeves rolled up",
  "detached sleeves", "puffy sleeves", "wrist cuffs", "spreader bar",
  "pillory", "stocks",
  "cuffs", "straitjacket", "bound ankles", "frogtie", "hogtie",
  "bandaged arm", "bandaged leg",
];
const BELT_OK = new Set([
  "paizuri", "paizuri under clothes", "perpendicular paizuri", "straddling paizuri",
  "fellatio", "deepthroat", "irrumatio", "imminent fellatio", "licking penis", "oral",
  "handjob", "double handjob", "two-handed handjob", "cooperative handjob", "nursing handjob",
  "footjob", "armpit sex", "nipple penetration", "69", "vore",
  "male masturbation", "testicle sucking", "testicle grab",
  // 帶子在她身上。髮交、平胸摩擦、女攻、前列腺按摩都不開她的帶子。
  "hairjob", "naizuri", "pegging", "prostate milking", "reverse fellatio",
]);
const BELT_CROTCH = new Set([
  "masturbation", "female masturbation", "fingering", "anal fingering",
  "hand in panties", "grinding",
  "guided penetration", "imminent penetration", "deep penetration",
  "clothed sex", "stealth sex", "spread pussy", "spread ass",
  "after vaginal", "after anal", "cum in pussy", "cum on pussy", "cum in ass",
  "prolapse", "anal prolapse", "butt plug", "anal beads", "crotch rope", "stomach bulge",
  "pussy peek", "penetration through clothes", "knotting", "peeing", "excessive pussy juice",
  "bestiality", "necrophilia", "scat", "unbirthing",
  "interspecies", "gaping", "speculum", "pussy piercing",
  "public use", "crotch grab", "crotch kick", "underwater sex",
  "bandaid on pussy",
]);
function beltClash(tag, have) {
  if (BELT_OK.has(tag)) return false;
  if (tag === "sex") return ![...have].some((t) => BELT_OK.has(t));
  const it = lex.byTag.get(tag);
  if (!it || tag === "chastity belt") return false;
  if (it.mutex === "sex_act") return true;
  return BELT_CROTCH.has(tag);
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
function draw(s, pinned, seed) {
  return drawOne(lex, s, pinned, new Set(), mulberry32(seed), seed);
}
function tagSet(drawn) {
  return new Set(drawn.positive.split(", ").map((t) => t.trim()).filter(Boolean));
}
function sweep(s, pinned, n, seed0) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(draw(s, pinned, seed0 + i));
  return out;
}

{
  const neg = data.negative.split(", ").map((t) => t.trim());
  eq("negative keeps loli, child, aged down and drops the three diagrams", neg.slice(-3), ["loli", "child", "aged down"]);
  ok("negative no longer contains multiple views", !neg.includes("multiple views"));
  ok("negative no longer contains cross-section", !neg.includes("cross-section"));
  ok("negative no longer contains x-ray", !neg.includes("x-ray"));
  eq("negative length", neg.length, 19);
}

for (const [tag, want] of Object.entries(EXPECT)) {
  const it = item(tag);
  ok(`${tag} exists`, !!it);
  if (!it) continue;
  eq(`${tag} section/group/mutex/gate/layer/zh`, {
    section: it.section,
    group: it.group,
    mutex: it.mutex,
    gate: it.gate,
    layer: it.layer,
    zh: it.zh,
  }, {
    section: want.section,
    group: want.group,
    mutex: want.mutex,
    gate: want.gate,
    layer: want.layer,
    zh: want.zh,
  });
  eq(`${tag} heat`, it.heat, want.heat);
  eq(`${tag} implies`, it.implies || [], want.implies);
  eq(`${tag} needs`, it.needs || [], want.needs);
}

for (const tag of THEMES) ok(`${tag} does not take the sex act slot`, item(tag).mutex !== "sex_act");
for (const tag of ACTS) ok(`${tag} takes the sex act slot`, item(tag).mutex === "sex_act");
for (const tag of SOLO_ACTS) ok(`${tag} does not require a partner`, !(item(tag).needs || []).includes("pair"));
ok("vore can be two people of either sex", item("vore").needs.includes("pair") && !item("vore").needs.includes("male"));
ok("gag does not imply bondage", !(item("gag").implies || []).includes("bondage"));
ok("spreader bar does not imply bondage", !(item("spreader bar").implies || []).includes("bondage"));
ok("public vibrator implies vibrator only", (item("public vibrator").implies || []).join(",") === "vibrator");
ok("futanari does not imply penis", !(item("futanari").implies || []).includes("penis"));
ok("cow girl does not imply monster girl", !(item("cow girl").implies || []).includes("monster girl"));
ok("nipple tassels do not imply pasties", !(item("nipple tassels").implies || []).includes("pasties"));

function blocked(tag, rating) {
  return ratingBlocked(item(tag), rating);
}
eq("multiple views is allowed at general", blocked("multiple views", "general"), false);
eq("torn clothes is blocked at general", blocked("torn clothes", "general"), true);
eq("torn clothes is allowed at sensitive", blocked("torn clothes", "sensitive"), false);
eq("cleavage cutout is blocked at general", blocked("cleavage cutout", "general"), true);
eq("cleavage cutout is allowed at sensitive", blocked("cleavage cutout", "sensitive"), false);
eq("body writing is sensitive, not explicit-only", blocked("body writing", "general") && !blocked("body writing", "sensitive"), true);
eq("heart tattoo is allowed at general", blocked("heart tattoo", "general"), false);
eq("guro is explicit-only", blocked("guro", "sensitive"), true);
eq("futanari is explicit-only", blocked("futanari", "sensitive"), true);
eq("public nudity is explicit-only", blocked("public nudity", "sensitive"), true);
eq("glory hole is explicit-only", blocked("glory hole", "sensitive"), true);
eq("wooden horse is explicit-only", blocked("wooden horse", "sensitive"), true);
eq("dungeon is allowed at general", blocked("dungeon", "general"), false);
eq("explicit does not block guro", blocked("guro", "explicit"), false);

{
  const sex = base({ heats: ["sex"], weights: { tease: 0, flash: 0, sex: 1, activity: 0 } });
  const tease = base({ heats: ["tease"], weights: { tease: 1, flash: 0, sex: 0, activity: 0 } });
  const general = base({ rating: "general", heats: ["tease"], weights: { tease: 1, flash: 0, sex: 0, activity: 0 } });
  const sensitive = base({ rating: "sensitive" });

  const keptViews = tagSet(draw(general, pinsOf("multiple views"), 11));
  ok("pinned multiple views survives general", keptViews.has("multiple views"));
  const droppedTorn = tagSet(draw(general, pinsOf("torn clothes"), 12));
  ok("pinned torn clothes is dropped at general", !droppedTorn.has("torn clothes"));
  const keptTorn = tagSet(draw(sensitive, pinsOf("torn clothes"), 13));
  ok("pinned torn clothes survives sensitive", keptTorn.has("torn clothes"));
  const droppedGuro = tagSet(draw(sensitive, pinsOf("guro"), 14));
  ok("pinned guro is dropped at sensitive", !droppedGuro.has("guro"));
  const keptGuro = tagSet(draw(base({ heats: ["sex"], weights: { tease: 0, flash: 0, sex: 1, activity: 0 } }), pinsOf("guro"), 15));
  ok("pinned guro survives explicit", keptGuro.has("guro"));

  let teaseKink = 0;
  for (const d of sweep(tease, new Set(), 40, 2000)) {
    const have = tagSet(d);
    for (const t of ["glory hole", "wooden horse", "guro", "gag", "futanari"]) {
      if (have.has(t) && t !== "futanari") teaseKink += 1;
    }
  }
  eq("tease draws do not emit sex-only kink places or guro or gag", teaseKink, 0);

  let normalRace = 0;
  let girlMale = 0;
  for (const d of sweep(base(), new Set(), 60, 3000)) {
    const have = tagSet(d);
    for (const t of ["demon girl", "slime girl", "cow girl", "monster girl"]) {
      if (have.has(t)) normalRace += 1;
    }
    if (have.has("faceless male") || have.has("1boy")) girlMale += 1;
  }
  eq("normal girl-only does not draw female races", normalRace, 0);
  eq("normal girl-only does not draw faceless male", girlMale, 0);

  const diverse = base({ sceneMode: "diverse" });
  const raceHits = { "demon girl": 0, "slime girl": 0, "cow girl": 0 };
  // 第六輪多了馬娘、妖精、改造人三個種族，種族格擲到的那 6 成分給 18 個：160 張時惡魔娘的期望值只剩 1 次左右，
  // 量到 0 是抽樣不夠，不是抽不到（800 張量到 9 次）。樣本放大到 400。
  for (const d of sweep(diverse, new Set(), 400, 4000)) {
    const have = tagSet(d);
    for (const t of Object.keys(raceHits)) if (have.has(t)) raceHits[t] += 1;
  }
  ok(
    "diverse girl-only sometimes draws demon, slime, and cow girl",
    raceHits["demon girl"] > 0 && raceHits["slime girl"] > 0 && raceHits["cow girl"] > 0,
    JSON.stringify(raceHits),
  );

  const pinDemon = tagSet(draw(base(), pinsOf("demon girl"), 21));
  ok("pinned demon girl keeps monster girl in normal mode", pinDemon.has("demon girl") && pinDemon.has("monster girl"));
  const pinCow = tagSet(draw(base(), pinsOf("cow girl"), 22));
  ok("pinned cow girl does not pull monster girl", pinCow.has("cow girl") && !pinCow.has("monster girl"));

  const pinFuta = tagSet(draw(sex, pinsOf("futanari"), 23));
  ok(
    "pinned futanari stays a girl and does not add penis",
    pinFuta.has("futanari") && pinFuta.has("1girl") && !pinFuta.has("1boy") && !pinFuta.has("penis"),
  );

  let cryClosed = 0;
  let crySleep = 0;
  let cryMissing = 0;
  for (const d of sweep(base(), pinsOf("crying with eyes open"), 20, 5000)) {
    const have = tagSet(d);
    if (!have.has("crying with eyes open") || !have.has("crying")) cryMissing += 1;
    if (have.has("closed eyes")) cryClosed += 1;
    if (have.has("sleeping")) crySleep += 1;
  }
  eq("pinned open-eyed crying keeps crying", cryMissing, 0);
  eq("pinned open-eyed crying never closes the eyes", cryClosed, 0);
  eq("pinned open-eyed crying never sleeps", crySleep, 0);

  let closedCry = 0;
  for (const d of sweep(base(), pinsOf("closed eyes"), 40, 5200)) {
    if (tagSet(d).has("crying with eyes open")) closedCry += 1;
  }
  eq("pinned closed eyes never draws open-eyed crying", closedCry, 0);

  const pair = base({
    girl: true,
    boy: true,
    heats: ["sex"],
    weights: { tease: 0, flash: 0, sex: 1, activity: 0 },
  });
  let pairN = 0;
  let pairPovHands = 0;
  for (const d of sweep(pair, new Set(), 40, 6000)) {
    if (d.people < 2) continue;
    pairN += 1;
    if (tagSet(d).has("pov hands")) pairPovHands += 1;
  }
  ok("mixed sex usually draws a pair", pairN >= 20, `pairs=${pairN}`);
  eq("a pair does not auto-draw pov hands", pairPovHands, 0);

  const pinPov = tagSet(draw(base(), pinsOf("pov hands"), 31));
  ok("pinned pov hands keeps pov", pinPov.has("pov hands") && pinPov.has("pov"));

  let gagOral = 0;
  let gagMiss = 0;
  for (const d of sweep(pair, pinsOf("gag"), 30, 7000)) {
    const have = tagSet(d);
    if (!have.has("gag")) gagMiss += 1;
    if (ORAL.some((t) => have.has(t))) gagOral += 1;
  }
  eq("pinned gag survives a sex draw", gagMiss, 0);
  eq("pinned gag blocks oral and kissing", gagOral, 0);

  let fellatioGag = 0;
  for (const d of sweep(pair, pinsOf("fellatio"), 40, 7200)) {
    if (tagSet(d).has("gag")) fellatioGag += 1;
  }
  eq("pinned fellatio blocks the gag roll", fellatioGag, 0);

  let limbBad = 0;
  let ampMiss = 0;
  for (const d of sweep(pair, pinsOf("quadruple amputee"), 20, 8000)) {
    const have = tagSet(d);
    if (!have.has("quadruple amputee")) ampMiss += 1;
    for (const t of have) {
      const it = lex.byTag.get(t);
      if (!it) continue;
      if (it.mutex === "feet" || it.mutex === "legs" || it.mutex === "hands" || LIMB.includes(t) || AMPUTEE_WORN.includes(t)) limbBad += 1;
      if (t === "fisting" && d.people < 2) limbBad += 1;
    }
  }
  eq("pinned quadruple amputee survives", ampMiss, 0);
  eq("pinned quadruple amputee blocks limbs, shoes, gloves, sleeves, and handjobs", limbBad, 0);

  let soloFist = 0;
  let soloAmpMiss = 0;
  for (const d of sweep(sex, pinsOf("quadruple amputee"), 40, 8100)) {
    const have = tagSet(d);
    if (!have.has("quadruple amputee")) soloAmpMiss += 1;
    if (d.people < 2 && have.has("fisting")) soloFist += 1;
    for (const t of have) {
      const it = lex.byTag.get(t);
      if (it && (it.mutex === "hands" || AMPUTEE_WORN.includes(t))) soloFist += 1;
    }
  }
  eq("pinned quadruple amputee survives a girl-only sex draw", soloAmpMiss, 0);
  eq("a solo quadruple amputee has no gloves, sleeves, or fisting", soloFist, 0);

  const HANDLESS = [
    "object insertion", "tentacle sex", "sex machine", "large insertion",
    "urethral insertion", "egg laying", "nipple penetration",
    // 灌腸、植卵、騎假陽具不用她的手。補牌清單不自動塞這些，通用姿勢抽到了也算。
    "enema", "egg implantation", "dildo riding",
  ];
  let ampNoAct = 0;
  for (const d of sweep(sex, pinsOf("quadruple amputee"), 40, 8100)) {
    const have = tagSet(d);
    if (d.people >= 2 || have.has("chastity belt")) continue;
    if (!HANDLESS.some((t) => have.has(t)) && !have.has("vore")) ampNoAct += 1;
  }
  eq("a solo quadruple amputee without a chastity belt still gets an act that does not need her hands", ampNoAct, 0);

  const ampPov = tagSet(draw(sex, pinsOf("quadruple amputee", "pov hands"), 41));
  ok("pov hands still belong to the viewer", ampPov.has("quadruple amputee") && ampPov.has("pov hands"));

  let faceHair = 0;
  const boy = base({
    girl: false,
    boy: true,
    heats: ["tease"],
    weights: { tease: 1, flash: 0, sex: 0, activity: 0 },
  });
  for (const d of sweep(boy, pinsOf("faceless male"), 20, 9000)) {
    const have = tagSet(d);
    if (!have.has("faceless male")) faceHair += 1;
    if (MALE_FACE.some((t) => have.has(t))) faceHair += 1;
  }
  eq("pinned faceless male has no beard", faceHair, 0);

  let publicPrivate = 0;
  let publicMiss = 0;
  for (const d of sweep(sex, pinsOf("public nudity"), 20, 10000)) {
    const have = tagSet(d);
    if (!have.has("public nudity") || !have.has("nude")) publicMiss += 1;
    if (PRIVATE.some((t) => have.has(t))) publicPrivate += 1;
  }
  eq("pinned public nudity keeps nude", publicMiss, 0);
  eq("pinned public nudity leaves the bedroom", publicPrivate, 0);

  let bedroomPublic = 0;
  for (const d of sweep(sex, pinsOf("bedroom"), 30, 10200)) {
    const have = tagSet(d);
    if (have.has("public nudity") || have.has("public vibrator")) bedroomPublic += 1;
  }
  eq("a bedroom does not draw public nudity or a public vibrator", bedroomPublic, 0);

  let beltMiss = 0;
  let beltBad = 0;
  let beltOral = 0;
  for (const d of sweep(pair, pinsOf("chastity belt"), 40, 10400)) {
    const have = tagSet(d);
    if (!have.has("chastity belt")) beltMiss += 1;
    for (const t of have) if (beltClash(t, have)) beltBad += 1;
    if (["fellatio", "paizuri", "handjob", "footjob", "nipple penetration"].some((t) => have.has(t))) beltOral += 1;
  }
  eq("pinned chastity belt survives a pair sex draw", beltMiss, 0);
  eq("pinned chastity belt blocks crotch acts", beltBad, 0);
  ok("a chastity belt can still leave an act that does not open it", beltOral > 0, `open=${beltOral}`);

  let fellatioMiss = 0;
  for (const d of sweep(pair, pinsOf("fellatio"), 20, 10500)) {
    const have = tagSet(d);
    if (!have.has("fellatio") || !have.has("sex")) fellatioMiss += 1;
  }
  eq("pinned fellatio still keeps the sex imply", fellatioMiss, 0);

  const beltAndOral = tagSet(draw(pair, pinsOf("chastity belt", "fellatio"), 71));
  ok(
    "pinning both the belt and fellatio keeps both",
    beltAndOral.has("chastity belt") && beltAndOral.has("fellatio") && beltAndOral.has("sex"),
  );

  const pinVibe = tagSet(draw(sex, pinsOf("public vibrator"), 51));
  ok("pinned public vibrator keeps vibrator", pinVibe.has("public vibrator") && pinVibe.has("vibrator"));
  ok("pinned public vibrator does not imply public indecency by itself", !(item("public vibrator").implies || []).includes("public indecency"));

  let topClash = 0;
  for (const d of sweep(base(), pinsOf("cleavage cutout"), 12, 11000)) {
    const have = tagSet(d);
    if (!have.has("cleavage cutout")) topClash += 1;
    for (const t of have) {
      const it = lex.byTag.get(t);
      if (it && it.mutex === "top" && t !== "cleavage cutout") topClash += 1;
    }
  }
  eq("cleavage cutout occupies the top slot", topClash, 0);

  const pinSweater = tagSet(draw(base(), pinsOf("virgin killer sweater"), 61));
  ok("virgin killer sweater keeps sweater", pinSweater.has("virgin killer sweater") && pinSweater.has("sweater"));
  const pinRing = tagSet(draw(base(), pinsOf("o-ring bikini"), 62));
  ok("o-ring bikini keeps bikini", pinRing.has("o-ring bikini") && pinRing.has("bikini"));

  let outdoorsHorse = 0;
  let outdoorsHole = 0;
  for (const d of sweep(sex, pinsOf("wooden horse"), 15, 12000)) {
    const have = tagSet(d);
    if (!have.has("wooden horse") || have.has("outdoors")) outdoorsHorse += 1;
  }
  for (const d of sweep(sex, pinsOf("glory hole"), 15, 12100)) {
    const have = tagSet(d);
    if (!have.has("glory hole") || !have.has("indoors") || have.has("outdoors")) outdoorsHole += 1;
  }
  eq("wooden horse stays indoors", outdoorsHorse, 0);
  eq("glory hole is an indoor place", outdoorsHole, 0);

  const pinDungeon = tagSet(draw(base(), pinsOf("dungeon"), 71));
  ok("dungeon implies indoors", pinDungeon.has("dungeon") && pinDungeon.has("indoors") && !pinDungeon.has("outdoors"));
}

const CSV_NEW = [
  "halo", "piercing", "ear piercing", "bandaid", "armband", "tongue piercing", "needle",
  "milking machine", "pillory", "stocks", "breast pump", "restraints", "phone",
  "knees up", "minigirl", "giantess", "long nipples", "bike shorts", "denim shorts",
  "hakama skirt", "dolphin shorts", "upside-down", "sideways", "vanishing point",
  "heart", "motion lines", "spoken heart", "slime (substance)", "symbol-shaped pupils",
  "slit pupils", "jitome", "ringed eyes", "denim", "shiny clothes", "leather", "satin",
  "smirk", "evil smile", "annoyed", "yandere", "crazy smile", "soles", "no shoes",
  "slippers", "stiletto heels", "pussy peek", "floor", "vacuum bed",
  "split-color hair", "white thighhighs", "zettai ryouiki", "torn pantyhose",
  "fishnet pantyhose", "loose socks", "over-kneehighs", "eyeliner", "red lips", "mascara",
  "living clothes", "leather jacket", "trench coat", "fur coat", "space", "stage",
  "school", "tentacle pit", "train station", "animal ears", "tail", "horns", "wings",
  "cat girl", "fox girl", "demon horns", "demon wings", "dragon girl", "rabbit girl",
  "wolf girl", "angel wings", "dog girl", "kitsune", "mermaid", "robot joints", "harpy",
  "peeing", "bestiality", "animal penis", "transformation", "suspension", "ovum",
  "fertilization", "horse penis", "penis size difference", "sperm cell", "slapping",
  "lactation through clothes", "objectification", "cum in nose", "nipple pull",
  "human furniture", "cumdump", "cum through clothes", "excessive pussy juice", "cum bubble",
  "crucifixion", "enema", "petrification", "scat", "double anal", "orgasm denial",
  "stomach punch", "parasite", "knotting", "penetration through clothes", "necrophilia",
  "double vaginal", "whipping", "electrostimulation", "anal fisting", "encasement",
  "wax play", "egg implantation", "sex doll", "stomach (organ)", "unbirthing",
  "urethral fingering", "forniphilia", "navel penetration", "digestion", "injury",
  "whip marks", "cloud", "aurora", "realistic", "1980s (style)", "v arms",
  "hands on own thighs", "twilight", "sailor collar", "halterneck", "tube top",
  "striped panties", "side-tie panties", "highleg panties", "string panties",
  "lace-trimmed panties", "negligee", "g-string", "strapless bra",
];
{
  const missing = CSV_NEW.filter((tag) => !item(tag));
  eq("csv tags are in the lexicon", missing, []);
  const themes = [
    "peeing", "bestiality", "transformation", "suspension", "orgasm denial", "knotting",
    "penetration through clothes", "navel penetration", "forniphilia", "human furniture",
    "pussy peek", "slapping", "whipping",
  ];
  const themeSlot = themes.filter((tag) => item(tag).mutex === "sex_act");
  eq("sex themes do not take the sex act slot", themeSlot, []);
  eq("double anal takes the act slot and needs two men", {
    mutex: item("double anal").mutex,
    needs: item("double anal").needs,
    implies: item("double anal").implies,
  }, {
    mutex: "sex_act",
    needs: ["female", "male", "pair", "group", "2male"],
    implies: ["anal"],
  });
  eq("double vaginal matches double anal", {
    mutex: item("double vaginal").mutex,
    needs: item("double vaginal").needs,
    implies: item("double vaginal").implies,
  }, {
    mutex: "sex_act",
    needs: ["female", "male", "pair", "group", "2male"],
    implies: ["vaginal"],
  });
  for (const tag of ["animal penis", "horse penis", "bestiality", "knotting"]) {
    ok(`${tag} does not imply a human penis`, !(item(tag).implies || []).includes("penis"));
    ok(`${tag} does not require a boy`, !(item(tag).needs || []).includes("male"));
  }
  eq("horse penis implies animal penis", item("horse penis").implies, ["animal penis"]);
  eq("sailor collar does not imply a pet collar", item("sailor collar").implies || [], []);
  eq("sailor collar is a fabric detail", item("sailor collar").mutex, null);
  eq("hakama skirt implies skirt and not hakama", item("hakama skirt").implies, ["skirt"]);
  eq("tube top occupies the top slot", item("tube top").mutex, "top");
  eq("phone shares the held prop slot", item("phone").mutex, "held_prop");
  ok("looking away stays retired in favor of averting eyes", !item("looking away") && !!item("averting eyes"));
  eq("fur coat does not pull the modern-only coat", item("fur coat").implies || [], []);
  eq("g-string implies thong", item("g-string").implies, ["thong"]);
  eq("cat girl implies animal ears and not monster girl", item("cat girl").implies, ["animal ears"]);
  eq("kitsune does not imply fox girl", item("kitsune").implies, ["animal ears"]);
  eq("yandere does not take the expression slot", item("yandere").mutex, null);
  eq("tentacle pit stays sex-only and indoors", {
    heat: item("tentacle pit").heat,
    implies: item("tentacle pit").implies,
  }, { heat: SEX, implies: ["indoors"] });
  eq("vacuum bed stays sex-only", item("vacuum bed").heat, SEX);
  eq("space is neither indoors nor outdoors", item("space").implies || [], []);
  eq("cloud can sit with a sky", item("cloud").mutex, null);
  eq("heart takes the effect slot", item("heart").mutex, "effect");
  eq("slime substance does not imply slime girl", item("slime (substance)").implies || [], []);
  eq("realistic is a pin-only style", item("realistic").section, "quality");
  ok("negative still says photorealistic", data.negative.includes("photorealistic"));
  ok("negative does not ban the tag realistic", !data.negative.split(", ").map((t) => t.trim()).includes("realistic"));

  eq("striped panties are explicit like other panties", blocked("striped panties", "sensitive"), true);
  eq("negligee is sensitive, not explicit-only", blocked("negligee", "general") && !blocked("negligee", "sensitive"), true);
  eq("fishnet pantyhose is sensitive, not explicit-only", blocked("fishnet pantyhose", "general") && !blocked("fishnet pantyhose", "sensitive"), true);
  eq("injury is allowed at general", blocked("injury", "general"), false);
  eq("whip marks are explicit-only", blocked("whip marks", "sensitive"), true);
  eq("bestiality is explicit-only", blocked("bestiality", "sensitive"), true);
  eq("tentacle pit is explicit-only", blocked("tentacle pit", "sensitive"), true);
  eq("long nipples are explicit-only", blocked("long nipples", "sensitive"), true);

  const sex = base({ heats: ["sex"], weights: { tease: 0, flash: 0, sex: 1, activity: 0 } });
  const pair = base({
    girl: true,
    boy: true,
    heats: ["sex"],
    weights: { tease: 0, flash: 0, sex: 1, activity: 0 },
  });
  const tease = base({ heats: ["tease"], weights: { tease: 1, flash: 0, sex: 0, activity: 0 } });
  let teaseLeak = 0;
  for (const d of sweep(tease, new Set(), 30, 13000)) {
    const have = tagSet(d);
    for (const t of ["tentacle pit", "vacuum bed", "pillory", "bestiality", "enema"]) {
      if (have.has(t)) teaseLeak += 1;
    }
  }
  eq("tease does not draw the new sex-only places or gear", teaseLeak, 0);

  let race = 0;
  for (const d of sweep(base(), new Set(), 40, 13100)) {
    if (tagSet(d).has("cat girl") || tagSet(d).has("mermaid") || tagSet(d).has("kitsune")) race += 1;
  }
  eq("normal mode does not auto-draw the new races", race, 0);

  const pinCat = tagSet(draw(base(), pinsOf("cat girl"), 81));
  ok("pinned cat girl keeps animal ears and not monster girl", pinCat.has("cat girl") && pinCat.has("animal ears") && !pinCat.has("monster girl"));

  const castKey = (set) =>
    ["1girl", "2girls", "3girls", "4girls", "5girls", "1boy", "2boys", "3boys"].filter((t) => set.has(t)).join(",");
  let horseBad = 0;
  for (let i = 0; i < 20; i += 1) {
    const seed = 16000 + i;
    const pinned = tagSet(draw(sex, pinsOf("horse penis"), seed));
    const bare = tagSet(draw(sex, new Set(), seed));
    if (!pinned.has("horse penis") || !pinned.has("animal penis")) horseBad += 1;
    if (pinned.has("1boy") || pinned.has("2boys") || pinned.has("3boys") || pinned.has("penis")) horseBad += 1;
    if (castKey(pinned) !== castKey(bare)) horseBad += 1;
  }
  eq("pinned horse penis keeps the girl cast and does not add a human penis", horseBad, 0);

  const pinCollar = tagSet(draw(base(), pinsOf("sailor collar"), 83));
  ok("pinned sailor collar does not add a pet collar", pinCollar.has("sailor collar") && !pinCollar.has("collar"));

  let giant = 0;
  for (const d of sweep(base(), pinsOf("minigirl"), 20, 14000)) {
    const have = tagSet(d);
    if (!have.has("minigirl") || have.has("giantess")) giant += 1;
  }
  eq("pinned minigirl never draws giantess", giant, 0);

  let pupils = 0;
  for (const d of sweep(base(), pinsOf("slit pupils"), 20, 14100)) {
    const have = tagSet(d);
    if (!have.has("slit pupils")) pupils += 1;
    if (have.has("symbol-shaped pupils") || have.has("ringed eyes")) pupils += 1;
  }
  eq("pinned slit pupils do not stack with other pupil shapes", pupils, 0);

  let cloth = 0;
  for (const d of sweep(base(), pinsOf("denim"), 20, 14200)) {
    const have = tagSet(d);
    if (!have.has("denim")) cloth += 1;
    for (const t of ["leather", "satin", "shiny clothes", "latex"]) if (have.has(t)) cloth += 1;
  }
  eq("pinned denim does not stack with another material", cloth, 0);

  const pinSpace = tagSet(draw(base(), pinsOf("space"), 84));
  ok("pinned space is not indoors or outdoors", pinSpace.has("space") && !pinSpace.has("indoors") && !pinSpace.has("outdoors"));

  let bedOut = 0;
  for (const d of sweep(sex, pinsOf("vacuum bed"), 12, 15000)) {
    const have = tagSet(d);
    if (!have.has("vacuum bed") || !have.has("indoors") || have.has("outdoors")) bedOut += 1;
  }
  eq("vacuum bed stays indoors", bedOut, 0);

  let pit = 0;
  for (const d of sweep(sex, pinsOf("tentacle pit"), 12, 15100)) {
    const have = tagSet(d);
    if (!have.has("tentacle pit") || !have.has("indoors") || have.has("outdoors")) pit += 1;
  }
  eq("tentacle pit is an indoor place", pit, 0);

  let denial = 0;
  for (const d of sweep(pair, pinsOf("chastity belt", "orgasm denial"), 12, 15200)) {
    const have = tagSet(d);
    if (!have.has("chastity belt") || !have.has("orgasm denial")) denial += 1;
  }
  eq("a chastity belt can keep orgasm denial", denial, 0);

  let peek = 0;
  for (const d of sweep(sex, pinsOf("chastity belt"), 20, 15300)) {
    const have = tagSet(d);
    for (const t of ["pussy peek", "peeing", "knotting", "bestiality", "scat", "unbirthing", "necrophilia"]) {
      if (have.has(t)) peek += 1;
    }
  }
  eq("a chastity belt does not auto-draw crotch exposure", peek, 0);

  const pinNavel = tagSet(draw(sex, pinsOf("chastity belt", "navel penetration"), 85));
  ok("navel penetration does not need the belt opened", pinNavel.has("chastity belt") && pinNavel.has("navel penetration"));

  let ampHand = 0;
  for (const d of sweep(sex, pinsOf("quadruple amputee"), 20, 15400)) {
    const have = tagSet(d);
    if (d.people >= 2) continue;
    for (const t of ["anal fisting", "urethral fingering", "slapping", "nipple pull", "v arms", "pillory", "stocks", "hands on own thighs"]) {
      if (have.has(t)) ampHand += 1;
    }
  }
  eq("a solo quadruple amputee does not get partner-hand acts or arm binds", ampHand, 0);
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("all ok");
