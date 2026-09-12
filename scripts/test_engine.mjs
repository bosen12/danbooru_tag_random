#!/usr/bin/env node
/** Engine pin / imply tests. Failures print and exit 1. */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  applyBan,
  applyClear,
  applyPin,
  cycleTag,
  defaultSettings,
  drawOne,
  ERAS,
  identityPins,
  isIdentityItem,
  heatMismatches,
  itemFitsHeats,
  sanitizeSettings,
  sanitizeMustDraw,
  MUST_MAX,
  SCENE_MODES,
  sceneModeOf,
  indexLexicon,
  labelOf,
  missingPins,
  pinMissLine,
  knownTags,
  mulberry32,
  mutexSiblings,
  actionGarmentKeys,
  actionFitsClothes,
  placeFitsActs,
  parseWeighted,
  formatWeighted,
  insertTriggerAfterCast,
  toggleHeat,
  heatPresetOf,
  weightsForHeats,
  nextTagWeight,
  stepTagWeight,
  clampTagWeight,
  applyTagWeights,
  settleGenCard,
  FEMALE_COUNT,
  MALE_COUNT,
  hasFemale,
  hasMale,
  applyPresetTags,
  BUILTIN_PRESETS,
  sanitizePinPresets,
  presetActive,
  presetState,
  sportPinWarnings,
  clearPresetTags,
  togglePresetTags,
} from "../web/engine.js";
import {
  SPORT_BUTTONS,
  SPORT_BY_ID,
  SPORT_IDENTITY,
  SPORT_PRESETS,
  sportOwnedTags,
  sportPresetTags,
} from "../web/sports.js";
import {
  supportCandidateAllowed,
  validateSupportShadow,
} from "../web/shadow-validator.js";

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

function drawN(pinned, banned, n, seed0 = 1000) {
  const s = settings();
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(drawOne(lex, s, pinned, banned, mulberry32(seed0 + i), seed0 + i));
  }
  return out;
}

{
  const sibs = new Set(mutexSiblings(lex, "goblin"));
  ok("cached siblings: goblin mutexes orc", sibs.has("orc"));
  ok("cached siblings: goblin keeps monster boy", !sibs.has("monster boy"));
  const pool = lex.byMutex.get("feature:race") || [];
  ok("byMutex race pool has goblin", pool.some((it) => it.tag === "goblin"));
}

{
  const next = applyPin(lex, new Set(), new Set(["bikini"]), "micro bikini");
  ok(
    "pin micro after ban bikini unbans bikini",
    next.pinned.has("micro bikini") && next.pinned.has("bikini") && !next.userBanned.has("bikini"),
    `pinned=${[...next.pinned]} banned=${[...next.userBanned]}`
  );
}

{
  let pinned = new Set();
  let userBanned = new Set();
  ({ pinned, userBanned } = cycleTag(lex, pinned, userBanned, "bikini"));
  ({ pinned, userBanned } = cycleTag(lex, pinned, userBanned, "bikini"));
  ({ pinned, userBanned } = cycleTag(lex, pinned, userBanned, "micro bikini"));
  const draws = drawN(pinned, userBanned, 40);
  const miss = draws.filter((d) => missingPins(d.positive, pinned).includes("bikini"));
  const without = draws.filter((d) => !tagsOf(d).has("bikini") || !tagsOf(d).has("micro bikini"));
  eq("ban bikini then pin micro: missing bikini count", miss.length, 0);
  eq("ban bikini then pin micro: both in POS", without.length, 0);
}

{
  const pinned = new Set(["micro bikini"]);
  const draws = drawN(pinned, new Set(), 40, 2000);
  const without = draws.filter((d) => !tagsOf(d).has("bikini") || !tagsOf(d).has("micro bikini"));
  eq("pin micro only: implied bikini still in POS", without.length, 0);
}

{
  const pinned = new Set(["micro bikini", "bikini"]);
  const draws = drawN(pinned, new Set(), 20, 3000);
  const miss = draws.filter((d) => missingPins(d.positive, pinned).length);
  eq("pin both: no missing", miss.length, 0);
}

{
  const item = lex.byTag.get("sundress");
  if (item && (item.implies || []).includes("dress")) {
    const next = applyPin(lex, new Set(), new Set(["dress"]), "sundress");
    ok(
      "pin sundress after ban dress unbans dress",
      next.pinned.has("dress") && !next.userBanned.has("dress"),
      `pinned=${[...next.pinned]} banned=${[...next.userBanned]}`
    );
    const draws = drawN(next.pinned, next.userBanned, 20, 4000);
    const without = draws.filter((d) => !tagsOf(d).has("sundress") || !tagsOf(d).has("dress"));
    eq("pin sundress: dress in POS", without.length, 0);
  } else {
    console.log("skip sundress/dress (lexicon has no imply)");
  }
}

const WESTERN_CLOTHES = [
  "dress",
  "sundress",
  "wedding dress",
  "short dress",
  "shirt",
  "blouse",
  "jeans",
  "hoodie",
  "t-shirt",
  "bikini",
  "micro bikini",
  "miniskirt",
  "pants",
  "shorts",
  "school uniform",
  "sweater",
  "tank top",
  "necktie",
  "high heels",
  "lingerie",
  "bra",
  "panties",
  "evening gown",
  "lab coat",
  "sneakers",
  "yoga pants",
];
const MODERN_PLACES = [
  "pool",
  "office",
  "classroom",
  "train",
  "car interior",
  "elevator",
  "skyscraper",
  "neon lights",
  "cityscape",
  "love hotel",
];

function eraDraws(era, n = 60, seed0 = 9000) {
  const s = settings();
  s.eras = [era];
  s.girl = true;
  s.boy = false;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(drawOne(lex, s, new Set(), new Set(), mulberry32(seed0 + i), seed0 + i));
  }
  return out;
}

{
  const draws = eraDraws("ancient_china", 80, 9100);
  const hits = [];
  for (const d of draws) {
    const tags = tagsOf(d);
    if (d.era !== "ancient_china") hits.push("era=" + d.era);
    for (const t of WESTERN_CLOTHES) if (tags.has(t)) hits.push(t);
    for (const t of MODERN_PLACES) if (tags.has(t)) hits.push(t);
  }
  eq("ancient_china: no western clothes or modern places", [...new Set(hits)], []);
  const missingClothes = draws.filter((d) => {
    const t = tagsOf(d);
    const nude = t.has("nude") || t.has("completely nude");
    if (nude) return false;
    return !(t.has("chinese clothes") || t.has("hanfu") || t.has("ruqun"));
  });
  eq("ancient_china: era clothes when not nude", missingClothes.length, 0);
}

{
  const draws = eraDraws("edo", 40, 9200);
  const hits = [];
  for (const d of draws) {
    const tags = tagsOf(d);
    for (const t of ["dress", "bikini", "jeans", "hoodie", "school uniform"]) {
      if (tags.has(t)) hits.push(t);
    }
  }
  eq("edo: no western street clothes", [...new Set(hits)], []);
}

{
  const item = lex.byTag.get("cherry blossoms");
  eq("cherry blossoms mutex is weather", item?.mutex, "weather");
  ok("cherry blossoms is any-era", (item?.era || []).includes("any"));
  ok("cherry blossoms mutexes snow", mutexSiblings(lex, "cherry blossoms").includes("snow"));
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["edo"];
  s.heats = ["tease"];
  s.weights = { tease: 1, flash: 0, sex: 0 };
  let cherry = 0;
  let both = 0;
  for (let i = 0; i < 80; i++) {
    const h = tagsOf(drawOne(lex, s, new Set(), new Set(), mulberry32(94000 + i), 94000 + i));
    if (h.has("cherry blossoms")) cherry += 1;
    if (h.has("cherry blossoms") && h.has("snow")) both += 1;
  }
  ok("edo does not stamp cherry blossoms every draw", cherry < 20, `cherry=${cherry}/80`);
  eq("cherry blossoms never stacks with snow", both, 0);
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.heats = ["tease"];
  s.weights = { tease: 1, flash: 0, sex: 0 };
  s.eras = ["edo"];
  let shoji = 0;
  let tatami = 0;
  for (let i = 0; i < 80; i++) {
    const h = tagsOf(drawOne(lex, s, new Set(), new Set(), mulberry32(94100 + i), 94100 + i));
    if (h.has("shoji")) shoji += 1;
    if (h.has("tatami")) tatami += 1;
  }
  ok("edo does not stamp shoji every leftover slot", shoji < 20, `shoji=${shoji}/80`);
  ok("edo does not stamp tatami every leftover slot", tatami < 20, `tatami=${tatami}/80`);
  s.eras = ["ancient_greece"];
  let pillar = 0;
  let marble = 0;
  for (let i = 0; i < 80; i++) {
    const h = tagsOf(drawOne(lex, s, new Set(), new Set(), mulberry32(94200 + i), 94200 + i));
    if (h.has("pillar")) pillar += 1;
    if (h.has("marble")) marble += 1;
  }
  ok("greece does not stamp pillar every leftover slot", pillar < 20, `pillar=${pillar}/80`);
  ok("greece does not stamp marble every leftover slot", marble < 20, `marble=${marble}/80`);
}

{
  const temple = lex.byTag.get("temple");
  ok("temple is not a greek place", !((temple?.era || []).includes("ancient_greece")));
  ok("temple is chinese-era", (temple?.era || []).includes("ancient_china"));
  ok("temple is edo-era", (temple?.era || []).includes("edo"));
  const ASIAN_PLACE = [
    "temple",
    "shrine",
    "pagoda",
    "torii",
    "chinese architecture",
    "east asian architecture",
  ];
  const hits = [];
  for (const d of eraDraws("ancient_greece", 80, 94300)) {
    const h = tagsOf(d);
    for (const t of ASIAN_PLACE) if (h.has(t)) hits.push(t);
  }
  eq("ancient_greece: no east asian temples", [...new Set(hits)], []);
}

{
  let pinned = new Set(["bikini"]);
  let userBanned = new Set();
  const group = ["bikini", "dress", "shirt"];
  for (const t of group) {
    ({ pinned, userBanned } = applyBan(lex, pinned, userBanned, t));
  }
  ok(
    "ban group: all banned, pins cleared",
    group.every((t) => userBanned.has(t)) && !pinned.has("bikini"),
    `pinned=${[...pinned]} banned=${[...userBanned]}`
  );
  for (const t of group) {
    ({ pinned, userBanned } = applyClear(pinned, userBanned, t));
  }
  ok(
    "clear group: bans lifted",
    group.every((t) => !userBanned.has(t)),
    `banned=${[...userBanned]}`
  );
}

{
  const s = settings();
  s.girl = false;
  s.boy = false;
  s.eras = ["modern"];
  let boys = 0;
  for (let i = 0; i < 80; i++) {
    const d = drawOne(lex, s, new Set(), new Set(), mulberry32(9300 + i), 9300 + i);
    if (hasMale([...tagsOf(d)])) boys += 1;
  }
  ok("both genders off still draws mixed (some boys)", boys > 0, `boys=${boys}/80`);
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["modern"];
  let femFlag = 0;
  let femCloth = 0;
  let femFeat = 0;
  let breasts = 0;
  let soft = 0;
  let natural = 0;
  for (let i = 0; i < 50; i++) {
    const d = drawOne(lex, s, new Set(), new Set(), mulberry32(12000 + i), 12000 + i);
    const have = tagsOf(d);
    if (d.female) femFlag += 1;
    if (have.has("soft breasts")) soft += 1;
    if (have.has("natural breasts")) natural += 1;
    for (const t of have) {
      const it = lex.byTag.get(t);
      if (it?.gate === "female" && it.section === "clothing") femCloth += 1;
      if (it?.gate === "female" && it.section === "feature") femFeat += 1;
      if (t.includes("breast")) breasts += 1;
    }
  }
  eq("girl-only sets female flag", femFlag, 50);
  ok("girl-only draws female clothing", femCloth > 0, `femCloth=${femCloth}`);
  ok("girl-only draws female features", femFeat > 0, `femFeat=${femFeat}`);
  ok("girl-only can draw breasts", breasts > 0, `breasts=${breasts}`);
  eq("girl-only always has soft breasts", soft, 50);
  eq("girl-only always has natural breasts", natural, 50);
}

{
  const s = settings();
  s.girl = false;
  s.boy = true;
  s.eras = ["modern"];
  let maleFlag = 0;
  let maleFeat = 0;
  let breastFeel = 0;
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, s, new Set(), new Set(), mulberry32(13000 + i), 13000 + i);
    const have = tagsOf(d);
    if (d.male) maleFlag += 1;
    if (have.has("soft breasts") || have.has("natural breasts")) breastFeel += 1;
    for (const t of have) {
      const it = lex.byTag.get(t);
      if (it?.gate === "male" && it.section === "feature") maleFeat += 1;
    }
  }
  eq("boy-only sets male flag", maleFlag, 40);
  ok("boy-only draws male features", maleFeat > 0, `maleFeat=${maleFeat}`);
  eq("boy-only has no breast feel tags", breastFeel, 0);
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["modern"];
  const d = drawOne(lex, s, new Set(), new Set(["soft breasts"]), mulberry32(14000), 14000);
  const have = tagsOf(d);
  ok("ban soft breasts is respected", !have.has("soft breasts") && have.has("natural breasts"));
  const parts = d.positive.split(", ").map((t) => t.trim());
  const sizeAt = parts.findIndex((t) => lex.byTag.get(t)?.mutex === "breast_size");
  const softAt = parts.indexOf("soft breasts");
  const natAt = parts.indexOf("natural breasts");
  ok(
    "breast feel sits after breast size",
    sizeAt < 0 || (natAt > sizeAt && (softAt < 0 || softAt > sizeAt)),
    `size@${sizeAt} soft@${softAt} natural@${natAt}`
  );
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["edo"];
  const hits = [];
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, s, new Set(), new Set(), mulberry32(14000 + i), 14000 + i);
    const tags = tagsOf(d);
    if (tags.has("armor")) {
      const era = lex.byTag.get("armor")?.era || [];
      if (!era.includes("edo") && !era.includes("any")) hits.push("armor");
    }
  }
  eq("edo does not pull medieval-only armor", hits.length, 0);
}

{
  ok(
    "white shirt does not mutex shirt",
    !mutexSiblings(lex, "white shirt").includes("shirt"),
    "siblings=" + mutexSiblings(lex, "white shirt").filter((t) => t.includes("shirt")).join(",")
  );
  ok(
    "white dress does not mutex dress",
    !mutexSiblings(lex, "white dress").includes("dress")
  );
  const pinShirt = applyPin(lex, new Set(), new Set(), "white shirt");
  ok("pin white shirt also pins shirt", pinShirt.pinned.has("shirt") && pinShirt.pinned.has("white shirt"));
  const dShirt = drawOne(
    lex,
    Object.assign(settings(), { eras: ["modern"], girl: true, boy: false }),
    pinShirt.pinned,
    new Set(),
    mulberry32(77),
    77
  );
  const have = tagsOf(dShirt);
  ok("white shirt draw keeps shirt", have.has("white shirt") && have.has("shirt"));
}

{
  ok(
    "cowgirl does not mutex umbrella sex",
    !mutexSiblings(lex, "cowgirl position").includes("sex")
  );
  const pin = applyPin(lex, new Set(), new Set(), "cowgirl position");
  ok("pin cowgirl also pins sex", pin.pinned.has("sex") && pin.pinned.has("cowgirl position"));
  const s = settings();
  s.girl = true;
  s.boy = true;
  s.heats = ["sex"];
  s.weights = { tease: 0, flash: 0, sex: 1 };
  s.eras = ["modern"];
  const d = drawOne(lex, s, pin.pinned, new Set(), mulberry32(88), 88);
  const have = tagsOf(d);
  ok("cowgirl draw keeps sex", have.has("cowgirl position") && have.has("sex"));
}

{
  const BODY = {
    "doggystyle": "all fours",
    "standing doggystyle": "standing",
    "standing sex": "standing",
    "full nelson": "standing",
    "suspended congress": "standing",
    "reverse suspended congress": "standing",
    "missionary": "on back",
    "mating press": "on back",
    "piledriver (sex)": "on back",
    "prone bone": "on stomach",
    "spooning": "on side",
    "cowgirl position": "sitting",
    "reverse cowgirl position": "sitting",
    "girl on top": "sitting",
    "upright straddle": "sitting",
    "reverse upright straddle": "sitting",
    "squatting cowgirl position": "squatting",
    "69": "lying",
    "facesitting": "sitting",
  };
  for (const [act, pose] of Object.entries(BODY)) {
    ok(`${act} implies ${pose}`, (lex.byTag.get(act)?.implies || []).includes(pose));
  }
  ok(
    "fellatio does not imply a body pose",
    !(lex.byTag.get("fellatio")?.implies || []).some((t) => lex.byTag.get(t)?.mutex === "body_pose")
  );
  ok("sleeping heat has no sex", !(lex.byTag.get("sleeping")?.heat || []).includes("sex"));
  ok("dancing heat has no sex", !(lex.byTag.get("dancing")?.heat || []).includes("sex"));

  const pinDs = applyPin(lex, new Set(["standing"]), new Set(), "doggystyle");
  ok("pin doggystyle drops standing", !pinDs.pinned.has("standing"));
  ok("pin doggystyle pins all fours", pinDs.pinned.has("all fours"));

  const s = settings();
  s.girl = true;
  s.boy = true;
  s.heats = ["sex"];
  s.weights = { tease: 0, flash: 0, sex: 1 };
  s.eras = ["modern"];
  let clash = 0;
  let rest = 0;
  for (let i = 0; i < 80; i++) {
    const h = tagsOf(drawOne(lex, s, new Set(), new Set(), mulberry32(41000 + i), 41000 + i));
    const present = Object.keys(BODY).filter((act) => h.has(act));
    const primary = present.filter(
      (act) => !present.some((o) => o !== act && (lex.byTag.get(o)?.implies || []).includes(act))
    );
    for (const act of primary) {
      if (!h.has(BODY[act])) clash += 1;
    }
    if (h.has("standing") && h.has("missionary")) clash += 1;
    if (h.has("sleeping") || h.has("dancing")) rest += 1;
  }
  eq("sex act keeps its body pose", clash, 0);
  eq("sex heat never sleeping or dancing", rest, 0);
}

{
  ok("pov implies looking at viewer", (lex.byTag.get("pov")?.implies || []).includes("looking at viewer"));
  ok(
    "pov crotch implies looking at viewer",
    (lex.byTag.get("pov crotch")?.implies || []).includes("looking at viewer")
  );
  const pinPov = applyPin(lex, new Set(["looking at another"]), new Set(), "pov");
  ok("pin pov pins looking at viewer", pinPov.pinned.has("looking at viewer"));
  ok("pin pov drops looking at another", !pinPov.pinned.has("looking at another"));

  const s = settings();
  s.girl = true;
  s.boy = true;
  s.heats = ["sex"];
  s.weights = { tease: 0, flash: 0, sex: 1 };
  s.eras = ["modern"];
  let pairPov = 0;
  for (let i = 0; i < 80; i++) {
    const d = drawOne(lex, s, new Set(), new Set(), mulberry32(43000 + i), 43000 + i);
    const h = tagsOf(d);
    if (d.people >= 2 && (h.has("pov") || h.has("pov crotch"))) pairPov += 1;
  }
  eq("unpinned pair sex never auto-draws pov", pairPov, 0);

  const pinOnly = applyPin(lex, new Set(), new Set(), "pov").pinned;
  let extraBoy = 0;
  let missLook = 0;
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, s, pinOnly, new Set(), mulberry32(43100 + i), 43100 + i);
    const h = tagsOf(d);
    if (h.has("1boy") || d.people >= 2) extraBoy += 1;
    if (!h.has("looking at viewer")) missLook += 1;
  }
  eq("pinned pov mixed sex stays one visible person", extraBoy, 0);
  eq("pinned pov keeps looking at viewer", missLook, 0);

  const both = applyPin(lex, new Set(["1girl", "1boy"]), new Set(), "pov").pinned;
  const dBoth = drawOne(lex, s, both, new Set(), mulberry32(43200), 43200);
  const hBoth = tagsOf(dBoth);
  ok("explicit 1girl+1boy+pov keeps both", hBoth.has("1girl") && hBoth.has("1boy") && hBoth.has("pov"));

  const cgPov = applyPin(lex, applyPin(lex, new Set(), new Set(), "cowgirl position").pinned, new Set(), "pov").pinned;
  const dCg = drawOne(lex, s, cgPov, new Set(), mulberry32(43300), 43300);
  const hCg = tagsOf(dCg);
  ok("cowgirl+pov keeps cowgirl", hCg.has("cowgirl position"));
  ok("cowgirl+pov has no visible boy", !hCg.has("1boy"));
  ok("cowgirl+pov is solo", hCg.has("solo"));
  ok("cowgirl+pov looks at viewer", hCg.has("looking at viewer"));
}

{
  const pull = lex.byTag.get("dress pull");
  ok(
    "dress pull is pose not onepiece",
    pull && pull.section === "pose" && pull.mutex !== "onepiece",
    JSON.stringify({ section: pull?.section, mutex: pull?.mutex })
  );
  const ds = lex.byTag.get("dress shirt");
  ok(
    "dress shirt is a shirt (top)",
    ds && ds.mutex === "top" && (ds.implies || []).includes("shirt"),
    JSON.stringify({ mutex: ds?.mutex, implies: ds?.implies })
  );
}

{
  const s = settings();
  s.girl = true;
  s.boy = true;
  s.heats = ["sex"];
  s.weights = { tease: 0, flash: 0, sex: 1 };
  s.eras = ["modern"];
  let pinned = applyPin(lex, new Set(), new Set(), "1girl").pinned;
  pinned = applyPin(lex, pinned, new Set(), "1boy").pinned;
  let both = 0;
  let onepieceClash = 0;
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, s, pinned, new Set(), mulberry32(16000 + i), 16000 + i);
    const have = tagsOf(d);
    if (have.has("sex") && (have.has("cowgirl position") || have.has("girl on top") || have.has("vaginal") || have.has("oral") || have.has("doggystyle"))) {
      both += 1;
    }
    if (have.has("competition swimsuit") && have.has("one-piece swimsuit") && have.has("blue one-piece swimsuit")) {
      onepieceClash += 1;
    }
    if (d.conflicts.some((c) => c[0] === "onepiece")) onepieceClash += 1;
  }
  ok("pair+sex heat can draw sex with a position", both > 0, `both=${both}/40`);
  eq("no onepiece child-child clash", onepieceClash, 0);
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["medieval"];
  s.lockScene = false;
  s.sceneMode = "weird";
  const pinned = applyPin(lex, new Set(), new Set(), "bikini").pinned;
  let modern = 0;
  let missingAnchor = 0;
  let missingBikini = 0;
  for (let i = 0; i < 30; i++) {
    const d = drawOne(lex, s, pinned, new Set(), mulberry32(17000 + i), 17000 + i);
    if (d.era !== "medieval") modern += 1;
    const have = tagsOf(d);
    if (!have.has("bikini")) missingBikini += 1;
    if (!have.has("armor") && !have.has("castle")) missingAnchor += 1;
  }
  eq("exclusive medieval beats bikini pin for era", modern, 0);
  eq("medieval + bikini pin still has bikini", missingBikini, 0);
  eq("medieval + bikini pin still stamps armor/castle", missingAnchor, 0);
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["modern"];
  s.heats = ["tease"];
  s.weights = { tease: 1, flash: 0, sex: 0 };
  let hair = 0;
  let eyes = 0;
  let breasts = 0;
  let body = 0;
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, s, new Set(), new Set(), mulberry32(18000 + i), 18000 + i);
    const have = tagsOf(d);
    if ([...have].some((t) => lex.byTag.get(t)?.mutex === "hair_color")) hair += 1;
    if ([...have].some((t) => lex.byTag.get(t)?.mutex === "eye_color")) eyes += 1;
    if ([...have].some((t) => lex.byTag.get(t)?.mutex === "breast_size")) breasts += 1;
    if (
      [...have].some((t) => {
        const it = lex.byTag.get(t);
        return it && it.layer === "garment" && (it.mutex === "onepiece" || it.mutex === "top" || it.mutex === "bottom");
      })
    ) {
      body += 1;
    }
  }
  ok("modern girl usually has hair color", hair >= 36, `hair=${hair}/40`);
  ok("modern girl usually has eye color", eyes >= 36, `eyes=${eyes}/40`);
  ok("modern girl usually has breast size", breasts >= 36, `breasts=${breasts}/40`);
  ok("modern tease usually has a body garment", body >= 36, `body=${body}/40`);
}

{
  const s = settings();
  s.girl = true;
  s.boy = true;
  s.eras = ["modern"];
  s.heats = ["sex"];
  s.weights = { tease: 0, flash: 0, sex: 1 };
  let pinned = applyPin(lex, new Set(), new Set(), "1girl").pinned;
  pinned = applyPin(lex, pinned, new Set(), "1boy").pinned;
  let acts = 0;
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, s, pinned, new Set(), mulberry32(18100 + i), 18100 + i);
    const have = tagsOf(d);
    if (
      [...have].some((t) => {
        const it = lex.byTag.get(t);
        return t === "sex" || it?.mutex === "sex_act";
      })
    ) {
      acts += 1;
    }
  }
  ok("pair sex heat usually has a sex act", acts >= 32, `acts=${acts}/40`);
}

{
  const s = settings();
  s.girl = true;
  s.boy = true;
  s.eras = ["modern"];
  s.heats = ["sex"];
  s.weights = { tease: 0, flash: 0, sex: 1 };
  let pinned = applyPin(lex, new Set(), new Set(), "micro bikini").pinned;
  pinned = applyPin(lex, pinned, new Set(), "1girl").pinned;
  pinned = applyPin(lex, pinned, new Set(), "1boy").pinned;
  let sexHeat = 0;
  let acts = 0;
  let keptBikini = 0;
  for (let i = 0; i < 20; i++) {
    const d = drawOne(lex, s, pinned, new Set(), mulberry32(19100 + i), 19100 + i);
    if (d.heat === "sex") sexHeat += 1;
    const have = tagsOf(d);
    if (have.has("micro bikini")) keptBikini += 1;
    if ([...have].some((t) => t === "sex" || lex.byTag.get(t)?.mutex === "sex_act")) acts += 1;
  }
  ok("sex-only heat stays sex when micro bikini is pinned", sexHeat === 20, `sexHeat=${sexHeat}/20`);
  ok("pinned micro bikini still enters sex draws", keptBikini === 20, `bikini=${keptBikini}/20`);
  ok("sex-only + pair + bikini pin still gets a sex act", acts >= 16, `acts=${acts}/20`);
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.heats = ["tease", "flash"];
  s.weights = { tease: 0.5, flash: 0.5, sex: 0 };
  const pinned = applyPin(lex, new Set(), new Set(), "flashing").pinned;
  let flash = 0;
  for (let i = 0; i < 20; i++) {
    const d = drawOne(lex, s, pinned, new Set(), mulberry32(19200 + i), 19200 + i);
    if (d.heat === "flash") flash += 1;
  }
  ok("tease+flash allowlist + flashing pin still rolls flash", flash === 20, `flash=${flash}/20`);
}

{
  const has = (tag, h) => (lex.byTag.get(tag)?.heat || []).includes(h);
  ok("micro bikini allows sex", has("micro bikini", "sex"));
  ok("bikini allows sex", has("bikini", "sex"));
  ok("dress allows sex", has("dress", "sex"));
  ok("undressing allows sex", has("undressing", "sex"));
  ok("flashing allows sex", has("flashing", "sex"));
  ok("wink allows sex", has("wink", "sex"));
  ok("indian style allows sex", has("indian style", "sex"));
  ok("bed allows tease", has("bed", "tease"));
  ok("torii allows sex", has("torii", "sex"));
  ok("wet hair allows sex", has("wet hair", "sex"));
  ok("nude allows tease", has("nude", "tease"));
  ok("nude allows flash", has("nude", "flash"));
  ok("nude allows sex", has("nude", "sex"));
  ok("completely nude allows tease", has("completely nude", "tease"));
  ok("sex toy stays sex-only", JSON.stringify(lex.byTag.get("sex toy")?.heat) === '["sex"]');
  ok("ahegao stays sex-only", JSON.stringify(lex.byTag.get("ahegao")?.heat) === '["sex"]');
}

{
  const pinned = applyPin(lex, new Set(), new Set(), "micro bikini").pinned;
  ok("sex-only does not clash with micro bikini", !heatMismatches(lex, pinned, ["sex"]).includes("micro bikini"));
  ok("sex-only does not clash with undressing", !heatMismatches(lex, applyPin(lex, new Set(), new Set(), "undressing").pinned, ["sex"]).includes("undressing"));
  ok("tease-only clash lists fellatio", heatMismatches(lex, applyPin(lex, new Set(), new Set(), "fellatio").pinned, ["tease"]).includes("fellatio"));
  ok("tease-only does not clash with nude", !heatMismatches(lex, applyPin(lex, new Set(), new Set(), "nude").pinned, ["tease"]).includes("nude"));
  ok("activity-only does not clash with nude", !heatMismatches(lex, applyPin(lex, new Set(), new Set(), "nude").pinned, ["activity"]).includes("nude"));
  ok("shopping is available in activity-only", itemFitsHeats(lex.byTag.get("shopping"), ["activity"]));
  ok("bathing is available in activity-only", itemFitsHeats(lex.byTag.get("bathing"), ["activity"]));
  ok("cowgirl is not available in activity-only", !itemFitsHeats(lex.byTag.get("cowgirl position"), ["activity"]));
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["edo"];
  let day = 0;
  let maleHair = 0;
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, s, new Set(), new Set(), mulberry32(18200 + i), 18200 + i);
    const have = tagsOf(d);
    if ([...have].some((t) => lex.byTag.get(t)?.mutex === "day_night")) day += 1;
    if (have.has("male pubic hair")) maleHair += 1;
  }
  ok("edo usually has day or night", day >= 36, `day=${day}/40`);
  eq("girl-only does not draw male pubic hair", maleHair, 0);
}

{
  const kinds = [];
  const combos = [
    { girl: true, boy: false, eras: ["modern"], heats: ["tease", "flash", "sex"] },
    { girl: true, boy: false, eras: ["ancient_china"], heats: ["sex"] },
    { girl: false, boy: true, eras: ["edo"], heats: ["tease", "flash"] },
    { girl: true, boy: true, eras: ["medieval"], heats: ["flash"] },
    { girl: true, boy: false, eras: ["victorian"], heats: ["tease"] },
    { girl: true, boy: true, eras: ["ancient_greece"], heats: ["tease", "flash", "sex"] },
  ];
  for (const combo of combos) {
    const s = settings();
    Object.assign(s, combo);
    for (let i = 0; i < 25; i++) {
      const d = drawOne(lex, s, new Set(), new Set(), mulberry32(15000 + i), 15000 + i);
      if (d.conflicts.length) kinds.push("conflict:" + JSON.stringify(d.conflicts[0]));
      const set = tagsOf(d);
      if (set.has("solo") && (set.has("2girls") || set.has("2boys") || set.has("3girls"))) {
        kinds.push("solo_multi");
      }
      if (set.has("indoors") && set.has("outdoors")) kinds.push("in_out");
      if (set.has("day") && set.has("night")) kinds.push("day_night");
      const hasGirl = [...set].some((t) => FEMALE_COUNT.has(t));
      const hasBoy = [...set].some((t) => MALE_COUNT.has(t));
      for (const t of set) {
        const it = lex.byTag.get(t);
        if (!it) continue;
        if (it.gate === "female" && !hasGirl) kinds.push("fem_gate:" + t);
        if (it.gate === "male" && !hasBoy) kinds.push("male_gate:" + t);
        const er = it.era;
        if (er && er.length && !er.includes("any") && !er.includes(d.era)) {
          kinds.push("era:" + t + "@" + d.era);
        }
      }
    }
  }
  eq("scan: no contradictions across eras/heats", [...new Set(kinds)], []);
}

const PRE_MODERN = ["ancient_china", "ancient_greece", "medieval", "edo"];
const MODERN_ONLY = [
  "gaming chair",
  "swivel chair",
  "office chair",
  "living room",
  "bathroom",
  "kitchen",
  "bathtub",
  "ceiling light",
  "city lights",
  "pool ladder",
  "beach towel",
  "restaurant",
  "watch",
  "hard hat",
  "police hat",
  "vibrator",
  "egg vibrator",
  "handbag",
  "beach umbrella",
  "no bra",
  "no panties",
  "panties aside",
  "bra pull",
  "panty pull",
  "hand in panties",
  "sports bra lift",
  "shirt lift",
  "blue necktie",
  "black necktie",
  "black bowtie",
  "blue bodysuit",
  "black leotard",
  "power armor",
  "detached collar",
];

{
  for (const tag of MODERN_ONLY) {
    const item = lex.byTag.get(tag);
    const era = item?.era || [];
    ok(
      `${tag} is not any-era`,
      item && era.length && !era.includes("any"),
      `${tag} era=${JSON.stringify(era)}`
    );
    ok(
      `${tag} does not leak into pre-modern`,
      era.every((e) => !PRE_MODERN.includes(e)),
      `${tag} era=${JSON.stringify(era)}`
    );
  }
}

{
  const leaks = [];
  for (const era of PRE_MODERN) {
    const s = settings();
    s.girl = true;
    s.boy = true;
    s.eras = [era];
    s.heats = ["tease", "flash", "sex"];
    for (let i = 0; i < 50; i++) {
      const d = drawOne(lex, s, new Set(), new Set(), mulberry32(21000 + i), 21000 + i);
      const have = tagsOf(d);
      for (const tag of MODERN_ONLY) {
        if (have.has(tag)) leaks.push(era + ":" + tag);
      }
    }
  }
  eq("pre-modern draws never pick modern furniture/clothes/poses", [...new Set(leaks)], []);
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["medieval"];
  s.lockScene = false;
  s.sceneMode = "weird";
  const pinned = applyPin(lex, new Set(), new Set(), "sports bra").pinned;
  let chair = 0;
  let missingBra = 0;
  let missingCastle = 0;
  for (let i = 0; i < 30; i++) {
    const d = drawOne(lex, s, pinned, new Set(), mulberry32(22000 + i), 22000 + i);
    const have = tagsOf(d);
    if (have.has("gaming chair") || have.has("swivel chair")) chair += 1;
    if (!have.has("sports bra") || !have.has("bra")) missingBra += 1;
    if (!have.has("castle") && !have.has("armor")) missingCastle += 1;
    if (d.era !== "medieval") chair += 1;
  }
  eq("medieval + sports bra pin still medieval", chair, 0);
  eq("medieval + sports bra pin keeps bra", missingBra, 0);
  eq("medieval + sports bra pin still stamps castle/armor", missingCastle, 0);
}

{
  eq("shirt sits with tops, not accessories", lex.byTag.get("shirt")?.group, "top");
  eq("bikini sits with one-piece", lex.byTag.get("bikini")?.group, "onepiece");
  eq("hanfu sits in era clothes", lex.byTag.get("hanfu")?.group, "era");
  eq("kimono sits in era clothes", lex.byTag.get("kimono")?.group, "era");
  eq("chinese clothes sits in era clothes", lex.byTag.get("chinese clothes")?.group, "era");
  eq("earrings stay accessories", lex.byTag.get("earrings")?.group, "acc");
  eq("white shirt stays top", lex.byTag.get("white shirt")?.group, "top");
  eq("ponytail is hair style", lex.byTag.get("ponytail")?.group, "hair_style");
  eq("wavy hair is hair style", lex.byTag.get("wavy hair")?.group, "hair_style");
  eq("pubic hair is not a hair style", lex.byTag.get("pubic hair")?.group, "body_f");
  eq("female pubic hair is not a hair style", lex.byTag.get("female pubic hair")?.group, "body_f");
  eq("male pubic hair is not a hair style", lex.byTag.get("male pubic hair")?.group, "body_m");
  eq("leg hair is not a hair style", lex.byTag.get("leg hair")?.group, "body_m");
  eq("facial hair is not a hair style", lex.byTag.get("facial hair")?.group, "body_m");
  eq("grabbing another's hair is not a hair style", lex.byTag.get("grabbing another's hair")?.group, "other");
  eq("hair flower is not a hair style", lex.byTag.get("hair flower")?.group, "other");
  eq("wet hair is not a hair style", lex.byTag.get("wet hair")?.group, "skin");
  eq("two-tone hair sits with hair color", lex.byTag.get("two-tone hair")?.group, "hair_color");
  ok("pubic hair is not identity", !isIdentityItem(lex.byTag.get("pubic hair")));
  ok("ponytail is identity", isIdentityItem(lex.byTag.get("ponytail")));
  ok(
    "sex preset is sex-only",
    data.heatWeights.sex.sex === 1 && data.heatWeights.sex.tease === 0 && data.heatWeights.sex.flash === 0
  );
  ok("flash preset exists", data.heatWeights.flash && data.heatWeights.flash.flash === 1);
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["modern"];
  s.heats = ["tease"];
  s.weights = { tease: 1, flash: 0, sex: 0 };
  let garments = 0;
  let accessories = 0;
  let styles = 0;
  let poses = 0;
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, s, new Set(), new Set(), mulberry32(19000 + i), 19000 + i);
    const have = tagsOf(d);
    if ([...have].some((t) => lex.byTag.get(t)?.group === "hair_style")) styles += 1;
    if ([...have].some((t) => lex.byTag.get(t)?.mutex === "body_pose")) poses += 1;
    for (const t of have) {
      const it = lex.byTag.get(t);
      if (!it || it.section !== "clothing") continue;
      if (it.layer === "skin") continue;
      if (it.layer === "accessory") accessories += 1;
      else if (it.layer === "garment") garments += 1;
    }
  }
  ok("modern tease draws more garments than accessories", garments > accessories, `garments=${garments} acc=${accessories}`);
  ok("modern tease usually has a hair style", styles >= 32, `styles=${styles}/40`);
  ok("modern tease usually has a body pose", poses >= 32, `poses=${poses}/40`);
}

function indoorOutdoorClash(have) {
  const names = have;
  const indoor = names.has("indoors");
  const outdoor = names.has("outdoors");
  if (indoor && outdoor) return "both in_out";
  for (const t of names) {
    const it = lex.byTag.get(t);
    const impl = it?.implies || [];
    if (impl.includes("indoors") && outdoor) return t + "+outdoors";
    if (impl.includes("outdoors") && indoor) return t + "+indoors";
  }
  return null;
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["modern"];
  s.heats = ["tease"];
  s.weights = { tease: 1, flash: 0, sex: 0 };
  const hits = [];
  const extraBodies = [];
  for (let i = 0; i < 50; i++) {
    const d = drawOne(lex, s, new Set(), new Set(), mulberry32(23000 + i), 23000 + i);
    const have = tagsOf(d);
    const clash = indoorOutdoorClash(have);
    if (clash) hits.push(clash);
    const one = [...have].find((t) => lex.byTag.get(t)?.mutex === "onepiece");
    if (one) {
      for (const extra of ["leotard", "pants", "skirt", "shirt"]) {
        if (have.has(extra) && !(lex.byTag.get(one)?.implies || []).includes(extra)) {
          extraBodies.push(one + "+" + extra);
        }
      }
    }
  }
  eq("modern tease: no indoor place with outdoors", [...new Set(hits)], []);
  eq("modern tease: onepiece does not stack unrelated umbrellas", [...new Set(extraBodies)], []);
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["edo"];
  s.heats = ["flash"];
  s.weights = { tease: 0, flash: 1, sex: 0 };
  let penis = 0;
  let lookOther = 0;
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, s, new Set(), new Set(), mulberry32(23100 + i), 23100 + i);
    const have = tagsOf(d);
    if (have.has("penis on ass")) penis += 1;
    if (have.has("looking at another") && have.has("solo")) lookOther += 1;
  }
  eq("girl-only flash does not draw penis on ass", penis, 0);
  eq("solo does not look at another", lookOther, 0);
}

{
  const s = settings();
  s.girl = true;
  s.boy = true;
  s.eras = ["modern"];
  s.heats = ["sex"];
  s.weights = { tease: 0, flash: 0, sex: 1 };
  let pairs = 0;
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, s, new Set(), new Set(), mulberry32(23200 + i), 23200 + i);
    if (d.people >= 2) pairs += 1;
  }
  ok("sex heat with both genders usually draws a pair", pairs >= 28, `pairs=${pairs}/40`);
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["modern"];
  s.heats = ["tease", "flash", "sex"];
  const hits = [];
  for (let i = 0; i < 50; i++) {
    const d = drawOne(lex, s, new Set(), new Set(), mulberry32(24000 + i), 24000 + i);
    const have = tagsOf(d);
    if ([...have].some((t) => MALE_COUNT.has(t))) {
      hits.push("cast:" + [...have].filter((t) => MALE_COUNT.has(t)).join(","));
    }
    for (const t of have) {
      const it = lex.byTag.get(t);
      if (it?.gate === "male") hits.push("gate:" + t);
    }
    if (have.has("clothed male nude female") || have.has("clothed female nude male")) hits.push("clothed-cross");
  }
  eq("girl-only never draws a boy or male-gated tag", [...new Set(hits)], []);
}

{
  ok("goblin mutexes orc", mutexSiblings(lex, "goblin").includes("orc"));
  ok("goblin does not mutex monster boy", !mutexSiblings(lex, "goblin").includes("monster boy"));
  const pin = applyPin(lex, new Set(), new Set(), "goblin");
  ok("pin goblin also pins monster boy", pin.pinned.has("goblin") && pin.pinned.has("monster boy"));
  const s = settings();
  s.girl = false;
  s.boy = true;
  s.eras = ["modern"];
  s.heats = ["tease"];
  s.weights = { tease: 1, flash: 0, sex: 0 };
  s.sceneMode = "diverse";
  let races = 0;
  let clash = 0;
  let girlGob = 0;
  for (let i = 0; i < 80; i++) {
    const d = drawOne(lex, s, new Set(), new Set(), mulberry32(25000 + i), 25000 + i);
    const have = tagsOf(d);
    const got = [...have].filter((t) => lex.byTag.get(t)?.mutex === "race");
    if (got.length) races += 1;
    if (got.length > 1) clash += 1;
  }
  const sg = settings();
  sg.girl = true;
  sg.boy = false;
  sg.eras = ["modern"];
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, sg, new Set(), new Set(), mulberry32(25100 + i), 25100 + i);
    if (tagsOf(d).has("goblin") || tagsOf(d).has("orc") || tagsOf(d).has("wolf boy")) girlGob += 1;
  }
  const pinnedDraw = drawOne(
    lex,
    s,
    applyPin(lex, new Set(), new Set(), "orc").pinned,
    new Set(),
    mulberry32(99),
    99
  );
  const ph = tagsOf(pinnedDraw);
  ok("boy-only sometimes draws a race", races >= 8 && races <= 55, `races=${races}/80`);
  eq("never two race tags at once", clash, 0);
  eq("girl-only does not draw male races", girlGob, 0);
  ok("pin orc stays orc not goblin", ph.has("orc") && !ph.has("goblin"), [...ph].filter((t) => lex.byTag.get(t)?.mutex === "race").join(","));
}

{
  ok("fat man mutexes muscular male", mutexSiblings(lex, "fat man").includes("muscular male"));
  ok("fat man mutexes plump", mutexSiblings(lex, "fat man").includes("plump"));
  ok("fat man does not mutex otaku", !mutexSiblings(lex, "fat man").includes("otaku"));
  ok("fat man does not mutex ugly bastard", !mutexSiblings(lex, "fat man").includes("ugly bastard"));
  ok("nerd does not mutex otaku", !mutexSiblings(lex, "nerd").includes("otaku"));
  const pinNerd = applyPin(lex, new Set(), new Set(), "nerd");
  ok("pin nerd also pins otaku", pinNerd.pinned.has("nerd") && pinNerd.pinned.has("otaku"));
  const pinFat = applyPin(lex, new Set(), new Set(), "fat man");
  ok("pin fat man also pins fat", pinFat.pinned.has("fat") && pinFat.pinned.has("fat man"));
  const s = settings();
  s.girl = false;
  s.boy = true;
  s.eras = ["modern"];
  s.heats = ["tease"];
  s.weights = { tease: 1, flash: 0, sex: 0 };
  const dFat = drawOne(lex, s, pinFat.pinned, new Set(), mulberry32(101), 101);
  const haveFat = tagsOf(dFat);
  ok("pin fat man keeps fat man", haveFat.has("fat man") && haveFat.has("fat"));
  ok("pin fat man drops muscle", !haveFat.has("muscular male") && !haveFat.has("bara") && !haveFat.has("toned male"));
  let girlUgly = 0;
  const sg = settings();
  sg.girl = true;
  sg.boy = false;
  sg.eras = ["modern"];
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, sg, new Set(), new Set(), mulberry32(25200 + i), 25200 + i);
    const h = tagsOf(d);
    if (h.has("ugly bastard") || h.has("fat man") || h.has("otaku") || h.has("nerd")) girlUgly += 1;
  }
  eq("girl-only does not draw ugly/fat/otaku men", girlUgly, 0);
}

{
  ok("cowboy shot is not a female count", !FEMALE_COUNT.has("cowboy shot") && !hasFemale(["cowboy shot"]));
  ok("cowboy shot is not a male count", !MALE_COUNT.has("cowboy shot") && !hasMale(["cowboy shot"]));
  ok("1boy counts as male", hasMale(["1boy"]) && !hasMale(["girl on top"]));
}

{
  ok("dutch angle is in lexicon", lex.byTag.has("dutch angle"));
  ok("light smile is in lexicon", lex.byTag.has("light smile"));
  eq("dutch angle mutex", lex.byTag.get("dutch angle")?.mutex, "camera");
  eq("looking away mutex", lex.byTag.get("looking away")?.mutex, "gaze");
  ok("dutch angle mutexes cowboy shot", mutexSiblings(lex, "dutch angle").includes("cowboy shot"));
  eq("smile mutex", lex.byTag.get("smile")?.mutex, "expression");
  ok("smile mutexes frown", mutexSiblings(lex, "smile").includes("frown"));
  ok("smile does not mutex wink", !mutexSiblings(lex, "smile").includes("wink"));
  const pinSmile = applyPin(lex, new Set(), new Set(), "light smile");
  ok("light smile keeps smile", pinSmile.pinned.has("light smile") && pinSmile.pinned.has("smile"));
  const pinXcu = applyPin(lex, new Set(), new Set(), "extreme close-up");
  ok("pin extreme close-up also pins close-up", pinXcu.pinned.has("extreme close-up") && pinXcu.pinned.has("close-up"));
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["modern"];
  s.heats = ["tease"];
  s.weights = { tease: 1, flash: 0, sex: 0 };
  let faces = 0;
  let twoCam = 0;
  let twoMood = 0;
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, s, new Set(), new Set(), mulberry32(27000 + i), 27000 + i);
    const h = tagsOf(d);
    const cams = [...h].filter((t) => lex.byTag.get(t)?.mutex === "camera");
    if (cams.length > 1) {
      const keep = cams.filter((t) => !cams.some((o) => o !== t && (lex.byTag.get(t)?.implies || []).includes(o)));
      if (keep.length > 1) twoCam += 1;
    }
    const moods = [...h].filter((t) => lex.byTag.get(t)?.mutex === "expression");
    const moodRoots = moods.filter(
      (t) => !moods.some((o) => o !== t && (lex.byTag.get(o)?.implies || []).includes(t))
    );
    if (moodRoots.length > 1) twoMood += 1;
    if ([...h].some((t) => lex.byTag.get(t)?.group === "face")) faces += 1;
  }
  eq("tease never two camera frames", twoCam, 0);
  eq("tease never two mood expressions", twoMood, 0);
  ok("modern tease usually has an expression", faces >= 28, `faces=${faces}/40`);
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["modern"];
  s.heats = ["tease"];
  s.weights = { tease: 1, flash: 0, sex: 0 };
  const nude = [];
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, s, new Set(), new Set(), mulberry32(26000 + i), 26000 + i);
    const h = tagsOf(d);
    if (h.has("nude") || h.has("completely nude")) nude.push(i);
  }
  eq("tease never force-nudes", nude.length, 0);
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["modern"];
  s.heats = ["flash"];
  s.weights = { tease: 0, flash: 1, sex: 0 };
  s.lockScene = false;
  s.sceneMode = "weird";
  const nude = [];
  const noGarment = [];
  const noAct = [];
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, s, new Set(), new Set(), mulberry32(26100 + i), 26100 + i);
    const h = tagsOf(d);
    if (h.has("nude") || h.has("completely nude")) nude.push(i);
    const garment = [...h].some((t) => {
      const it = lex.byTag.get(t);
      if (!it || it.section !== "clothing") return false;
      return it.layer === "garment" && (it.mutex === "onepiece" || it.mutex === "top" || it.mutex === "bottom");
    });
    if (!garment) noGarment.push(i);
    const act = [...h].some((t) => {
      const it = lex.byTag.get(t);
      return it && (it.mutex === "clothes_action" || it.group === "flash");
    });
    if (!act) noAct.push(i);
  }
  eq("flash never force-nudes", nude.length, 0);
  eq("flash always has a body garment", noGarment.length, 0);
  eq("flash always has a clothes action", noAct.length, 0);
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["modern"];
  s.heats = ["sex"];
  s.weights = { tease: 0, flash: 0, sex: 1 };
  let nude = 0;
  let clothed = 0;
  for (let i = 0; i < 50; i++) {
    const d = drawOne(lex, s, new Set(), new Set(), mulberry32(26200 + i), 26200 + i);
    const h = tagsOf(d);
    if (h.has("nude") || h.has("completely nude")) nude += 1;
    else clothed += 1;
  }
  ok("sex heat is not always nude", clothed >= 8, `clothed=${clothed} nude=${nude}`);
}

{
  const cg = lex.byTag.get("cowgirl position");
  ok("cowgirl mutex is sex_act", cg && cg.mutex === "sex_act");
  ok("cowgirl needs pair", (cg?.needs || []).includes("pair"));
  ok("cowgirl needs male", (cg?.needs || []).includes("male"));
  ok("cowgirl needs female", (cg?.needs || []).includes("female"));
  const fell = lex.byTag.get("fellatio");
  ok("fellatio needs male", (fell?.needs || []).includes("male"));
  ok("fellatio needs pair", (fell?.needs || []).includes("pair"));
  const oral = lex.byTag.get("oral");
  ok("oral umbrella has no mutex", oral && !oral.mutex);
  ok("oral mutexExtra sex_act", (oral?.mutexExtra || []).includes("sex_act"));
  ok("oral still mutexes cowgirl", mutexSiblings(lex, "oral").includes("cowgirl position"));
  const breasts = lex.byTag.get("huge breasts");
  ok("huge breasts needs female", (breasts?.needs || []).includes("female"));
  const kiss = lex.byTag.get("kiss");
  ok("kiss needs pair", (kiss?.needs || []).includes("pair"));
}

{
  const s = settings();
  s.counts.feature = "x";
  const dump = drawOne(lex, s, new Set(), new Set(), mulberry32(1), 1);
  const feats = [...tagsOf(dump)].filter((t) => lex.byTag.get(t)?.section === "feature");
  ok("NaN feature count does not dump the pool", feats.length <= 20, `feature=${feats.length}`);
  s.counts.feature = 1e9;
  const huge = drawOne(lex, s, new Set(), new Set(), mulberry32(2), 2);
  const feats2 = [...tagsOf(huge)].filter((t) => lex.byTag.get(t)?.section === "feature");
  ok("huge feature count is capped", feats2.length <= 50, `feature=${feats2.length}`);
}

{
  const dirty = sanitizeSettings(
    {
      n: "",
      width: "",
      height: -5,
      counts: { feature: "x", pose: 1e9 },
      heats: ["nope"],
      eras: ["future"],
      girl: "yes",
      boy: 0,
    },
    data
  );
  ok("junk n falls back", dirty.n >= 1 && dirty.n <= 10);
  ok("junk width falls back", dirty.width === 1024);
  ok("negative height clamps to 256", dirty.height === 256);
  eq("junk feature count is 0", dirty.counts.feature, 0);
  ok("huge pose count clamps to 10", dirty.counts.pose === 10);
  eq("missing count keys keep defaults", dirty.counts.subject, data.defaults.counts.subject);
  ok("junk heats fall back", dirty.heats.length > 0 && dirty.heats.every((h) => ["tease", "flash", "sex"].includes(h)));
  ok("junk eras fall back", dirty.eras.length > 0 && dirty.eras.every((e) => ERAS.includes(e)));
}

{
  const custom = sanitizeSettings(
    {
      heatPreset: "custom",
      heats: ["tease", "sex"],
      weights: { flash: 0, sex: 0.5, tease: 0.5 },
    },
    data
  );
  eq("custom heatPreset is kept", custom.heatPreset, "custom");
  ok("custom keeps flash off", custom.heats.includes("tease") && custom.heats.includes("sex") && !custom.heats.includes("flash"));
  const partial = sanitizeSettings({ n: 2, counts: { feature: 3 } }, data);
  eq("n-only keeps default feature-adjacent counts", partial.counts.subject, data.defaults.counts.subject);
  eq("partial feature count is kept", partial.counts.feature, 3);
  eq("n-only keeps default pose count", partial.counts.pose, data.defaults.counts.pose);
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["modern"];
  s.heats = ["tease"];
  s.weights = { tease: 1, flash: 0, sex: 0 };
  const d = drawOne(lex, s, new Set(), new Set(), mulberry32(42), 42);
  const parts = d.positive.split(", ").map((t) => t.trim()).filter(Boolean);
  const firstCloth = parts.findIndex((t) => lex.byTag.get(t)?.section === "clothing");
  const firstPose = parts.findIndex((t) => lex.byTag.get(t)?.section === "pose");
  ok(
    "clothing comes before pose in POS",
    firstCloth >= 0 && firstPose >= 0 && firstCloth < firstPose,
    `cloth@${firstCloth} pose@${firstPose} pos=${d.positive}`
  );
  const qAt = parts.indexOf("masterpiece");
  const nsfwAt = Math.max(parts.lastIndexOf("nsfw"), parts.lastIndexOf("explicit"));
  const girlAt = parts.indexOf("1girl");
  ok("quality sits after subject", qAt > girlAt && girlAt >= 0, `girl@${girlAt} quality@${qAt}`);
  ok("quality sits after nsfw tail", qAt > nsfwAt && nsfwAt >= 0, `nsfw@${nsfwAt} quality@${qAt}`);
  ok("default draw has no cel shading", !parts.includes("cel shading"));
  ok("default draw has no absurdres", !parts.includes("absurdres"));
  ok("default draw has no highres", !parts.includes("highres"));
  ok("default draw has no very aesthetic", !parts.includes("very aesthetic"));
  ok("default draw keeps masterpiece", parts.includes("masterpiece"));
  ok("default draw keeps best quality", parts.includes("best quality"));
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["modern"];
  s.heats = ["tease"];
  s.weights = { tease: 1, flash: 0, sex: 0 };
  const pinned = applyPin(lex, new Set(), new Set(), "cel shading").pinned;
  const d = drawOne(lex, s, pinned, new Set(), mulberry32(43), 43);
  const parts = d.positive.split(", ").map((t) => t.trim()).filter(Boolean);
  ok("pinned cel shading enters POS", parts.includes("cel shading"));
  ok(
    "style sits before quality",
    parts.indexOf("cel shading") >= 0 && parts.indexOf("cel shading") < parts.indexOf("masterpiece"),
    `style@${parts.indexOf("cel shading")} quality@${parts.indexOf("masterpiece")}`
  );
  eq("cel shading is optional quality", lex.byTag.get("cel shading")?.section, "quality");
  eq("cel shading is style group", lex.byTag.get("cel shading")?.group, "style");
  eq("absurdres is optional boost", lex.byTag.get("absurdres")?.group, "boost");
}

{
  const styleTags = [
    "lineart",
    "screentones",
    "watercolor (medium)",
    "monochrome",
    "1990s (style)",
    "2000s (style)",
    "retro artstyle",
    "thick outlines",
    "drop shadow",
    "webtoon",
  ];
  const boostTags = ["newest", "highly aesthetic"];
  for (const tag of styleTags) {
    eq(`${tag} is optional quality`, lex.byTag.get(tag)?.section, "quality");
    eq(`${tag} is style group`, lex.byTag.get(tag)?.group, "style");
  }
  for (const tag of boostTags) {
    eq(`${tag} is optional quality`, lex.byTag.get(tag)?.section, "quality");
    eq(`${tag} is boost group`, lex.byTag.get(tag)?.group, "boost");
  }
  eq("lineart zh", lex.byTag.get("lineart")?.zh, "線稿");
  eq("screentones zh", lex.byTag.get("screentones")?.zh, "網點");
  eq("watercolor zh", lex.byTag.get("watercolor (medium)")?.zh, "水彩");
  eq("1990s zh", lex.byTag.get("1990s (style)")?.zh, "1990s 畫風");

  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["modern"];
  s.heats = ["tease"];
  s.weights = { tease: 1, flash: 0, sex: 0 };
  const d = drawOne(lex, s, new Set(), new Set(), mulberry32(44), 44);
  const parts = d.positive.split(", ").map((t) => t.trim()).filter(Boolean);
  for (const tag of [...styleTags, ...boostTags]) {
    ok(`default draw has no ${tag}`, !parts.includes(tag));
  }

  const pinWater = applyPin(lex, new Set(["cel shading"]), new Set(), "watercolor (medium)");
  ok("watercolor pin drops cel shading", !pinWater.pinned.has("cel shading"));
  ok("watercolor pin keeps watercolor", pinWater.pinned.has("watercolor (medium)"));

  const pinEra = applyPin(lex, new Set(["1990s (style)"]), new Set(), "retro artstyle");
  ok("retro pin drops 1990s", !pinEra.pinned.has("1990s (style)"));

  const pinLine = applyPin(lex, new Set(["clean lines"]), new Set(), "thick outlines");
  ok("thick outlines pin drops clean lines", !pinLine.pinned.has("clean lines"));

  const pinAes = applyPin(lex, new Set(["very aesthetic"]), new Set(), "highly aesthetic");
  ok("highly aesthetic pin drops very aesthetic", !pinAes.pinned.has("very aesthetic"));

  const pinDrop = applyPin(lex, new Set(["cel shading"]), new Set(), "drop shadow");
  ok("drop shadow stacks with cel shading", pinDrop.pinned.has("cel shading") && pinDrop.pinned.has("drop shadow"));

  const pinnedNew = applyPin(lex, new Set(), new Set(), "newest").pinned;
  const dNew = drawOne(lex, s, pinnedNew, new Set(), mulberry32(45), 45);
  ok("pinned newest enters POS", dNew.positive.split(", ").includes("newest"));
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["modern"];
  s.heats = ["tease"];
  s.weights = { tease: 1, flash: 0, sex: 0 };
  const first = drawOne(lex, s, new Set(), new Set(), mulberry32(9001), 9001);
  const ident = identityPins(lex, first.positive);
  ok("identity harvest has hair color", [...ident].some((t) => lex.byTag.get(t)?.mutex === "hair_color"));
  ok("identity harvest skips clothing", ![...ident].some((t) => lex.byTag.get(t)?.section === "clothing"));
  ok("identity harvest skips pose", ![...ident].some((t) => lex.byTag.get(t)?.section === "pose"));
  const hair = [...ident].find((t) => lex.byTag.get(t)?.mutex === "hair_color");
  const eyes = [...ident].find((t) => lex.byTag.get(t)?.mutex === "eye_color");
  let sameHair = 0;
  let sameEyes = 0;
  let clothChanged = 0;
  const firstCloth = [...tagsOf(first)].filter((t) => lex.byTag.get(t)?.section === "clothing").sort().join("|");
  for (let i = 0; i < 8; i++) {
    const pin = new Set(ident);
    const d = drawOne(lex, s, pin, new Set(), mulberry32(9100 + i), 9100 + i);
    const have = tagsOf(d);
    if (hair && have.has(hair)) sameHair += 1;
    if (eyes && have.has(eyes)) sameEyes += 1;
    const cloth = [...have].filter((t) => lex.byTag.get(t)?.section === "clothing").sort().join("|");
    if (cloth !== firstCloth) clothChanged += 1;
  }
  ok("later draws keep harvested hair color", !hair || sameHair === 8, `hair=${hair} kept=${sameHair}/8`);
  ok("later draws keep harvested eye color", !eyes || sameEyes === 8, `eyes=${eyes} kept=${sameEyes}/8`);
  ok("later draws can still change clothes", clothChanged >= 1, `changed=${clothChanged}/8`);
  eq("samePerson defaults off", defaultSettings(data).samePerson, false);
}

{
  ok(
    "no panties does not imply panties",
    !((lex.byTag.get("no panties")?.implies || []).includes("panties"))
  );
  ok("no bra does not imply bra", !((lex.byTag.get("no bra")?.implies || []).includes("bra")));
  ok(
    "open shirt still implies shirt",
    (lex.byTag.get("open shirt")?.implies || []).includes("shirt")
  );
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["modern"];
  s.heats = ["flash"];
  s.weights = { tease: 0, flash: 1, sex: 0 };
  let bothPanties = 0;
  let bothBra = 0;
  for (let i = 0; i < 50; i++) {
    const h = tagsOf(drawOne(lex, s, new Set(), new Set(), mulberry32(30000 + i), 30000 + i));
    if (h.has("no panties") && h.has("panties")) bothPanties += 1;
    if (h.has("no bra") && h.has("bra")) bothBra += 1;
  }
  eq("flash never stacks no panties with panties", bothPanties, 0);
  eq("flash never stacks no bra with bra", bothBra, 0);
  const pinNone = applyPin(lex, new Set(), new Set(), "no panties");
  ok("pin no panties does not pin panties", pinNone.pinned.has("no panties") && !pinNone.pinned.has("panties"));
  let handInNone = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinNone.pinned, new Set(), mulberry32(30900 + i), 30900 + i));
    if (h.has("hand in panties")) handInNone += 1;
  }
  eq("no panties flash does not pick hand in panties", handInNone, 0);
}

{
  const s = settings();
  s.girl = false;
  s.boy = true;
  s.eras = ["modern"];
  s.heats = ["tease"];
  s.weights = { tease: 1, flash: 0, sex: 0 };
  const pinBald = applyPin(lex, new Set(), new Set(), "bald").pinned;
  let hairColor = 0;
  let hairStyle = 0;
  let lostBald = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinBald, new Set(), mulberry32(30100 + i), 30100 + i));
    if (!h.has("bald")) lostBald += 1;
    if ([...h].some((t) => t !== "bald" && lex.byTag.get(t)?.mutex === "hair_color")) hairColor += 1;
    if (
      [...h].some((t) => {
        const it = lex.byTag.get(t);
        return it && it.group === "hair_style";
      })
    ) {
      hairStyle += 1;
    }
  }
  eq("pin bald stays bald", lostBald, 0);
  eq("bald pin never draws a hair color", hairColor, 0);
  eq("bald pin never draws a hair style", hairStyle, 0);
}

{
  const eye = lex.byTag.get("eye contact");
  ok("eye contact needs pair", (eye?.needs || []).includes("pair"));
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["modern"];
  s.heats = ["tease"];
  s.weights = { tease: 1, flash: 0, sex: 0 };
  const pinned = applyPin(lex, new Set(), new Set(), "1girl").pinned;
  let soloEye = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinned, new Set(), mulberry32(30200 + i), 30200 + i));
    if (h.has("solo") && h.has("eye contact")) soloEye += 1;
  }
  eq("solo 1girl never draws eye contact", soloEye, 0);
}

{
  ok("ponytail mutexes twintails", mutexSiblings(lex, "ponytail").includes("twintails"));
  ok("ponytail mutexes hair bun", mutexSiblings(lex, "ponytail").includes("hair bun"));
  ok(
    "side ponytail does not mutex ponytail",
    !mutexSiblings(lex, "side ponytail").includes("ponytail")
  );
  const pinSide = applyPin(lex, new Set(), new Set(), "side ponytail");
  ok(
    "pin side ponytail also pins ponytail",
    pinSide.pinned.has("side ponytail") && pinSide.pinned.has("ponytail")
  );
  ok("bangs is not a hair_style mutex", !lex.byTag.get("bangs")?.mutex);
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["modern"];
  s.heats = ["tease"];
  s.weights = { tease: 1, flash: 0, sex: 0 };
  const EXCLUSIVE = new Set([
    "ponytail",
    "high ponytail",
    "side ponytail",
    "twintails",
    "braid",
    "twin braids",
    "single braid",
    "hime cut",
    "hair bun",
    "double bun",
    "single hair bun",
    "drill hair",
  ]);
  let clash = 0;
  for (let i = 0; i < 50; i++) {
    const h = tagsOf(drawOne(lex, s, new Set(), new Set(), mulberry32(30300 + i), 30300 + i));
    const got = [...h].filter((t) => EXCLUSIVE.has(t));
    const roots = got.filter(
      (t) => !got.some((o) => o !== t && (lex.byTag.get(o)?.implies || []).includes(t))
    );
    if (roots.length > 1) clash += 1;
  }
  eq("tease never two exclusive hair styles", clash, 0);
}

{
  eq("female pubic hair gate", lex.byTag.get("female pubic hair")?.gate, "female");
  ok(
    "female pubic hair is flash/sex",
    JSON.stringify(lex.byTag.get("female pubic hair")?.heat) === '["flash","sex"]'
  );
  eq("arm hair gate", lex.byTag.get("arm hair")?.gate, "male");
  eq("leg hair gate", lex.byTag.get("leg hair")?.gate, "male");
  const sg = settings();
  sg.girl = true;
  sg.boy = false;
  sg.eras = ["modern"];
  let girlMaleHair = 0;
  for (let i = 0; i < 50; i++) {
    const h = tagsOf(drawOne(lex, sg, new Set(), new Set(), mulberry32(30400 + i), 30400 + i));
    if (h.has("arm hair") || h.has("leg hair") || h.has("chest hair")) girlMaleHair += 1;
  }
  eq("girl-only does not draw male body hair", girlMaleHair, 0);
  const sb = settings();
  sb.girl = false;
  sb.boy = true;
  sb.eras = ["modern"];
  let boyFemPubic = 0;
  for (let i = 0; i < 50; i++) {
    const h = tagsOf(drawOne(lex, sb, new Set(), new Set(), mulberry32(30500 + i), 30500 + i));
    if (h.has("female pubic hair")) boyFemPubic += 1;
  }
  eq("boy-only does not draw female pubic hair", boyFemPubic, 0);
}

{
  const pull = lex.byTag.get("one-piece swimsuit pull");
  ok(
    "swimsuit pull does not imply a swimsuit",
    pull &&
      !(pull.implies || []).includes("swimsuit") &&
      !(pull.implies || []).includes("one-piece swimsuit"),
    JSON.stringify(pull?.implies)
  );
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["modern"];
  s.heats = ["flash"];
  s.weights = { tease: 0, flash: 1, sex: 0 };
  const pinned = applyPin(lex, new Set(), new Set(), "sundress").pinned;
  let swimOnDress = 0;
  let swimActOnDress = 0;
  let lostDress = 0;
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, s, pinned, new Set(), mulberry32(30600 + i), 30600 + i);
    const h = tagsOf(d);
    if (!h.has("sundress")) lostDress += 1;
    if (h.has("sundress") && (h.has("one-piece swimsuit") || h.has("swimsuit"))) swimOnDress += 1;
    if (
      h.has("sundress") &&
      (h.has("one-piece swimsuit pull") || h.has("swimsuit aside") || h.has("bikini bottom aside"))
    ) {
      swimActOnDress += 1;
    }
  }
  eq("sundress pin stays", lostDress, 0);
  eq("sundress flash never also has a swimsuit", swimOnDress, 0);
  eq("sundress flash never picks a swimsuit action", swimActOnDress, 0);
}

{
  const SOLO_SEX = new Set([
    "masturbation",
    "female masturbation",
    "male masturbation",
    "fingering",
    "masturbation through clothes",
  ]);
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["modern"];
  s.heats = ["sex"];
  s.weights = { tease: 0, flash: 0, sex: 1 };
  const pinned = applyPin(lex, new Set(), new Set(), "1girl").pinned;
  let miss = 0;
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, s, pinned, new Set(), mulberry32(30700 + i), 30700 + i);
    const h = tagsOf(d);
    if (d.people !== 1) miss += 1;
    else if (![...h].some((t) => SOLO_SEX.has(t))) miss += 1;
  }
  eq("girl-only solo sex always has a masturbation tag", miss, 0);
  const sb = settings();
  sb.girl = false;
  sb.boy = true;
  sb.eras = ["modern"];
  sb.heats = ["sex"];
  sb.weights = { tease: 0, flash: 0, sex: 1 };
  const pinBoy = applyPin(lex, new Set(), new Set(), "1boy").pinned;
  let missB = 0;
  for (let i = 0; i < 30; i++) {
    const d = drawOne(lex, sb, pinBoy, new Set(), mulberry32(30800 + i), 30800 + i);
    const h = tagsOf(d);
    if (d.people !== 1) missB += 1;
    else if (![...h].some((t) => SOLO_SEX.has(t))) missB += 1;
  }
  eq("boy-only solo sex always has a masturbation tag", missB, 0);
}

{
  eq("undressing is not a dress action", actionGarmentKeys("undressing"), []);
  ok("pants pull names pants", actionGarmentKeys("pants pull").includes("pants"));
  ok("panty pull names panty", actionGarmentKeys("panty pull").includes("panty"));
  ok("dress pull names dress", actionGarmentKeys("dress pull").includes("dress"));
  ok("downblouse names blouse", actionGarmentKeys("downblouse").includes("blouse"));
  eq("undressing fits a hoodie", actionFitsClothes("undressing", ["hoodie"]), 2);
  eq("dress pull does not fit a hoodie", actionFitsClothes("dress pull", ["hoodie"]), 0);
  eq("dress pull fits sundress", actionFitsClothes("dress pull", ["sundress"]), 2);
  eq("pants pull does not fit cheerleader", actionFitsClothes("pants pull", ["cheerleader"]), 0);
  eq("pants pull fits jeans", actionFitsClothes("pants pull", ["jeans"]), 2);
  eq("pants pull fits yoga pants", actionFitsClothes("pants pull", ["yoga pants"]), 2);
  eq("panty pull fits thong", actionFitsClothes("panty pull", ["thong"]), 2);
  eq("panty pull does not fit cheerleader", actionFitsClothes("panty pull", ["cheerleader"]), 0);
  eq("hand in panties does not fit no panties", actionFitsClothes("hand in panties", ["no panties"]), 0);
  eq("shirt lift fits white shirt", actionFitsClothes("shirt lift", ["white shirt"]), 2);
  eq("downblouse does not fit cheerleader", actionFitsClothes("downblouse", ["cheerleader"]), 0);
  eq("through clothes does not fit nude", actionFitsClothes("masturbation through clothes", ["nude"]), 0);
  eq("through clothes does not fit empty", actionFitsClothes("masturbation through clothes", []), 0);
  eq("through clothes does not fit towel only", actionFitsClothes("masturbation through clothes", ["towel"]), 0);
  eq("through clothes fits a shirt", actionFitsClothes("masturbation through clothes", ["white shirt"]), 2);
  eq("upskirt does not fit nude", actionFitsClothes("upskirt", ["nude"]), 0);
  eq("upskirt fits a skirt", actionFitsClothes("upskirt", ["miniskirt"]), 2);
  eq("undressing does not fit nude", actionFitsClothes("undressing", ["nude"]), 0);
  eq("clothes lift does not fit nude", actionFitsClothes("clothes lift", ["nude"]), 0);
  eq("clothes lift fits a shirt", actionFitsClothes("clothes lift", ["white shirt"]), 2);
  eq("flashing does not fit nude", actionFitsClothes("flashing", ["nude"]), 0);
  eq("cameltoe does not fit nude", actionFitsClothes("cameltoe", ["nude"]), 0);
  eq("clothed sex does not fit nude", actionFitsClothes("clothed sex", ["nude"]), 0);
  eq("covering breasts still fits nude", actionFitsClothes("covering breasts", ["nude"]), 1);
  eq("adjusting clothes does not fit nude", actionFitsClothes("adjusting clothes", ["nude"]), 0);
  eq("clothes tug does not fit nude", actionFitsClothes("clothes tug", ["nude"]), 0);
  eq("adjusting clothes fits a shirt", actionFitsClothes("adjusting clothes", ["white shirt"]), 2);
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["modern"];
  s.heats = ["flash"];
  s.weights = { tease: 0, flash: 1, sex: 0 };
  let mismatch = 0;
  let noAct = 0;
  for (let i = 0; i < 50; i++) {
    const d = drawOne(lex, s, new Set(), new Set(), mulberry32(31000 + i), 31000 + i);
    const h = tagsOf(d);
    const cloth = [...h].filter((t) => lex.byTag.get(t)?.section === "clothing");
    const acts = [...h].filter((t) => {
      const it = lex.byTag.get(t);
      return it && (it.mutex === "clothes_action" || it.group === "flash");
    });
    if (!acts.length) noAct += 1;
    for (const a of acts) {
      if (actionFitsClothes(a, cloth) === 0) mismatch += 1;
    }
  }
  eq("flash named clothes action matches a worn garment", mismatch, 0);
  eq("flash still has a clothes action", noAct, 0);
  const pinCheer = applyPin(lex, new Set(), new Set(), "cheerleader").pinned;
  let cheerMismatch = 0;
  let cheerNoAct = 0;
  let cheerPants = 0;
  for (let i = 0; i < 80; i++) {
    const d = drawOne(lex, s, pinCheer, new Set(), mulberry32(31100 + i), 31100 + i);
    const h = tagsOf(d);
    if (!h.has("cheerleader")) cheerMismatch += 1;
    const cloth = [...h].filter((t) => lex.byTag.get(t)?.section === "clothing");
    const acts = [...h].filter((t) => {
      const it = lex.byTag.get(t);
      return it && (it.mutex === "clothes_action" || it.group === "flash");
    });
    if (!acts.length) cheerNoAct += 1;
    for (const a of acts) {
      if (actionFitsClothes(a, cloth) === 0) cheerMismatch += 1;
    }
    if (h.has("pants pull") && actionFitsClothes("pants pull", cloth) === 0) cheerPants += 1;
  }
  eq("cheerleader flash never picks a mismatched named action", cheerMismatch, 0);
  eq("cheerleader flash still has a flash action", cheerNoAct, 0);
  eq("cheerleader flash never pants-pulls without pants", cheerPants, 0);
  const pinHood = applyPin(lex, new Set(), new Set(), "hoodie").pinned;
  let hoodDressAct = 0;
  for (let i = 0; i < 80; i++) {
    const d = drawOne(lex, s, pinHood, new Set(), mulberry32(31400 + i), 31400 + i);
    const h = tagsOf(d);
    const cloth = [...h].filter((t) => lex.byTag.get(t)?.section === "clothing");
    if (h.has("dress pull") && actionFitsClothes("dress pull", cloth) === 0) hoodDressAct += 1;
  }
  eq("hoodie flash never dress-pulls without a dress", hoodDressAct, 0);
}

{
  const trib = lex.byTag.get("tribadism");
  ok("tribadism needs yuri", (trib?.needs || []).includes("yuri"));
  const s = settings();
  s.girl = true;
  s.boy = true;
  s.eras = ["modern"];
  s.heats = ["sex"];
  s.weights = { tease: 0, flash: 0, sex: 1 };
  let pinned = applyPin(lex, new Set(), new Set(), "1girl").pinned;
  pinned = applyPin(lex, pinned, new Set(), "1boy").pinned;
  let withBoy = 0;
  for (let i = 0; i < 50; i++) {
    const h = tagsOf(drawOne(lex, s, pinned, new Set(), mulberry32(31200 + i), 31200 + i));
    if (h.has("tribadism")) withBoy += 1;
  }
  eq("1girl+1boy sex never draws tribadism", withBoy, 0);
}

{
  const NEW_POS = [
    "upright straddle",
    "reverse upright straddle",
    "reverse suspended congress",
    "piledriver (sex)",
    "boy on top",
    "thigh sex",
    "frottage",
    "reverse spitroast",
  ];
  for (const tag of NEW_POS) {
    const it = lex.byTag.get(tag);
    ok(`${tag} is in the lexicon`, !!it);
    eq(`${tag} is a pose`, it?.section, "pose");
    eq(`${tag} mutex is sex_act`, it?.mutex, "sex_act");
    ok(`${tag} is sex-only heat`, JSON.stringify(it?.heat) === '["sex"]');
    ok(`${tag} implies sex`, (it?.implies || []).includes("sex"));
    ok(`${tag} needs pair`, (it?.needs || []).includes("pair"));
  }
  ok("upright straddle mutexes cowgirl", mutexSiblings(lex, "upright straddle").includes("cowgirl position"));
  ok("piledriver (sex) mutexes missionary", mutexSiblings(lex, "piledriver (sex)").includes("missionary"));
  ok("boy on top mutexes girl on top", mutexSiblings(lex, "boy on top").includes("girl on top"));
  ok("reverse spitroast mutexes spitroast", mutexSiblings(lex, "reverse spitroast").includes("spitroast"));
  eq("parse piledriver (sex)", parseWeighted("piledriver (sex)"), { tag: "piledriver (sex)", weight: 1 });
  eq("parse weighted piledriver (sex)", parseWeighted("(piledriver (sex):1.2)"), { tag: "piledriver (sex)", weight: 1.2 });
  const pin = applyPin(lex, new Set(), new Set(), "piledriver (sex)");
  ok(
    "pin piledriver (sex) also pins sex",
    pin.pinned.has("piledriver (sex)") && pin.pinned.has("sex")
  );
  const s = settings();
  s.girl = true;
  s.boy = true;
  s.eras = ["modern"];
  s.heats = ["sex"];
  s.weights = { tease: 0, flash: 0, sex: 1 };
  let cowgirl = 0;
  for (let i = 0; i < 20; i++) {
    const h = tagsOf(drawOne(lex, s, pin.pinned, new Set(), mulberry32(32100 + i), 32100 + i));
    if (h.has("cowgirl position") || h.has("missionary")) cowgirl += 1;
    if (!h.has("piledriver (sex)") || !h.has("sex")) cowgirl += 1;
  }
  eq("pin piledriver (sex) keeps it and never a rival position", cowgirl, 0);
  const sg = settings();
  sg.girl = true;
  sg.boy = false;
  sg.eras = ["modern"];
  sg.heats = ["sex"];
  sg.weights = { tease: 0, flash: 0, sex: 1 };
  let girlBoyTop = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sg, new Set(), new Set(), mulberry32(32200 + i), 32200 + i));
    if (h.has("boy on top")) girlBoyTop += 1;
  }
  eq("girl-only never draws boy on top", girlBoyTop, 0);
  const sb = settings();
  sb.girl = false;
  sb.boy = true;
  sb.eras = ["modern"];
  sb.heats = ["sex"];
  sb.weights = { tease: 0, flash: 0, sex: 1 };
  let boyStraddle = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sb, new Set(), new Set(), mulberry32(32300 + i), 32300 + i));
    if (h.has("upright straddle") || h.has("reverse upright straddle")) boyStraddle += 1;
  }
  eq("boy-only never draws upright straddle", boyStraddle, 0);
}

{
  const k = lex.byTag.get("loli");
  ok("loli is in the lexicon", !!k);
  eq("loli is a female feature", k?.section, "feature");
  eq("loli gate is female", k?.gate, "female");
  ok("loli implies small breasts", (k?.implies || []).includes("small breasts"));
  ok("loli implies flat chest", (k?.implies || []).includes("flat chest"));
  ok("loli implies petite", (k?.implies || []).includes("petite"));
  ok("flat chest implies small breasts", (lex.byTag.get("flat chest")?.implies || []).includes("small breasts"));
  eq("flat chest mutex is breast_size", lex.byTag.get("flat chest")?.mutex, "breast_size");
  eq("petite mutex is height", lex.byTag.get("petite")?.mutex, "height");
  ok("loli mutexes tall female", mutexSiblings(lex, "loli").includes("tall female"));
  ok("petite mutexes tall female", mutexSiblings(lex, "petite").includes("tall female"));
  ok("petite does not mutex loli", !mutexSiblings(lex, "petite").includes("loli"));
  ok("flat chest mutexes huge breasts", mutexSiblings(lex, "flat chest").includes("huge breasts"));
  ok("flat chest does not mutex small breasts", !mutexSiblings(lex, "flat chest").includes("small breasts"));
  ok("loli does not mutex milf", !mutexSiblings(lex, "loli").includes("milf"));
  ok("loli does not mutex mature female", !mutexSiblings(lex, "loli").includes("mature female"));
  const pin = applyPin(lex, new Set(), new Set(), "loli");
  ok(
    "pin loli also pins petite, flat chest and small breasts",
    pin.pinned.has("loli") &&
      pin.pinned.has("petite") &&
      pin.pinned.has("flat chest") &&
      pin.pinned.has("small breasts")
  );
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.eras = ["modern"];
  s.heats = ["tease"];
  s.weights = { tease: 1, flash: 0, sex: 0 };
  let miss = 0;
  let tall = 0;
  let big = 0;
  for (let i = 0; i < 30; i++) {
    const d = drawOne(lex, s, pin.pinned, new Set(), mulberry32(31500 + i), 31500 + i);
    const h = tagsOf(d);
    if (
      !h.has("loli") ||
      !h.has("petite") ||
      !h.has("flat chest") ||
      !h.has("small breasts") ||
      !h.has("adult")
    ) {
      miss += 1;
    }
    if (h.has("tall female")) tall += 1;
    if (h.has("huge breasts") || h.has("large breasts") || h.has("gigantic breasts") || h.has("medium breasts")) {
      big += 1;
    }
  }
  eq("pin loli keeps adult petite small breasts", miss, 0);
  eq("pin loli never draws tall female", tall, 0);
  eq("pin loli never draws a larger bust", big, 0);
  const sb = settings();
  sb.girl = false;
  sb.boy = true;
  sb.eras = ["modern"];
  let boyKokod = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sb, new Set(), new Set(), mulberry32(31600 + i), 31600 + i));
    if (h.has("loli")) boyKokod += 1;
  }
  eq("boy-only never draws loli", boyKokod, 0);
}

{
  const k = lex.byTag.get("shota");
  ok("shota is in the lexicon", !!k);
  eq("shota is a male feature", k?.section, "feature");
  eq("shota gate is male", k?.gate, "male");
  ok("shota implies short male", (k?.implies || []).includes("short male"));
  eq("shota mutex is height_m", k?.mutex, "height_m");
  eq("short male mutex is height_m", lex.byTag.get("short male")?.mutex, "height_m");
  eq("tall male mutex is height_m", lex.byTag.get("tall male")?.mutex, "height_m");
  ok("shota mutexes tall male", mutexSiblings(lex, "shota").includes("tall male"));
  ok("short male mutexes tall male", mutexSiblings(lex, "short male").includes("tall male"));
  ok("short male does not mutex shota", !mutexSiblings(lex, "short male").includes("shota"));
  ok("shota does not mutex loli", !mutexSiblings(lex, "shota").includes("loli"));
  ok("shota does not mutex petite", !mutexSiblings(lex, "shota").includes("petite"));
  ok("shota does not mutex tall female", !mutexSiblings(lex, "shota").includes("tall female"));
  ok("shota does not mutex muscular male", !mutexSiblings(lex, "shota").includes("muscular male"));
  ok("shota does not mutex old man", !mutexSiblings(lex, "shota").includes("old man"));
  ok("shota does not mutex dwarf", !mutexSiblings(lex, "shota").includes("dwarf"));
  const pin = applyPin(lex, new Set(), new Set(), "shota");
  ok(
    "pin shota also pins short male",
    pin.pinned.has("shota") && pin.pinned.has("short male")
  );
  const s = settings();
  s.girl = false;
  s.boy = true;
  s.eras = ["modern"];
  s.heats = ["tease"];
  s.weights = { tease: 1, flash: 0, sex: 0 };
  let miss = 0;
  let tall = 0;
  for (let i = 0; i < 30; i++) {
    const d = drawOne(lex, s, pin.pinned, new Set(), mulberry32(31700 + i), 31700 + i);
    const h = tagsOf(d);
    if (!h.has("shota") || !h.has("short male") || !h.has("adult")) miss += 1;
    if (h.has("tall male")) tall += 1;
  }
  eq("pin shota keeps adult short male", miss, 0);
  eq("pin shota never draws tall male", tall, 0);
  const sg = settings();
  sg.girl = true;
  sg.boy = false;
  sg.eras = ["modern"];
  let girlKkob = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sg, new Set(), new Set(), mulberry32(31800 + i), 31800 + i));
    if (h.has("shota")) girlKkob += 1;
  }
  eq("girl-only never draws shota", girlKkob, 0);
}

{
  eq(
    "trigger after 1girl solo adult",
    insertTriggerAfterCast("1girl, solo, adult, long hair, masterpiece", "char"),
    "1girl, solo, adult, char, long hair, masterpiece"
  );
  eq(
    "empty trigger leaves pos",
    insertTriggerAfterCast("1girl, solo, adult, long hair", ""),
    "1girl, solo, adult, long hair"
  );
  eq("empty pos is just trigger", insertTriggerAfterCast("", "char"), "char");
  eq(
    "trigger after mixed counts and adult",
    insertTriggerAfterCast("1girl, 1boy, adult, nsfw", "foo, bar"),
    "1girl, 1boy, adult, foo, bar, nsfw"
  );
  eq(
    "trigger respects weighted count",
    insertTriggerAfterCast("(1girl:1.1), solo, adult, long hair", "char"),
    "(1girl:1.1), solo, adult, char, long hair"
  );
  eq(
    "no prefix puts trigger first",
    insertTriggerAfterCast("long hair, masterpiece", "char"),
    "char, long hair, masterpiece"
  );

  eq("parse plain tag", parseWeighted("petite"), { tag: "petite", weight: 1 });
  eq("parse weighted tag", parseWeighted("(petite:1.2)"), { tag: "petite", weight: 1.2 });
  eq("parse weighted place tag", parseWeighted("(bar (place):0.8)"), { tag: "bar (place)", weight: 0.8 });
  eq("format default weight is bare", formatWeighted("petite", 1), "petite");
  eq("format upweight", formatWeighted("petite", 1.2), "(petite:1.2)");
  eq("format integer weight", formatWeighted("loli", 1.0), "loli");
  eq("next weight from 1 is 1.1", nextTagWeight(1), 1.1);
  eq("next weight from 1.5 wraps to 0.6", nextTagWeight(1.5), 0.6);
  eq("next weight from 0.9 wraps to 1", nextTagWeight(0.9), 1);
  eq("step up from 1 is 1.1", stepTagWeight(1, 1), 1.1);
  eq("step down from 1 is 0.9", stepTagWeight(1, -1), 0.9);
  eq("step up clamps at 1.5", stepTagWeight(1.5, 1), 1.5);
  eq("step down clamps at 0.6", stepTagWeight(0.6, -1), 0.6);
  eq("clamp 1.2 stays", clampTagWeight(1.2), 1.2);
  eq("clamp 2 down to 1.5", clampTagWeight(2), 1.5);
  eq("clamp 0.1 up to 0.6", clampTagWeight(0.1), 0.6);
  eq("clamp NaN to 1", clampTagWeight(NaN), 1);
  eq("clamp 1.23 rounds to 1.2", clampTagWeight(1.23), 1.2);
  eq("clamp empty to 1", clampTagWeight(), 1);
  eq(
    "apply weights wraps only changed tags",
    applyTagWeights("1girl, petite, flat chest", new Map([["petite", 1.2], ["loli", 1.4]])),
    "1girl, (petite:1.2), flat chest"
  );
  eq(
    "apply weights keeps existing wrap if map empty",
    applyTagWeights("1girl, (petite:1.3)", new Map()),
    "1girl, (petite:1.3)"
  );
}

{
  eq("skip current card continues batch", settleGenCard({ skipping: true, aborting: false, errName: "AbortError", finished: false }), "skip");
  eq("skip wins over batch cancel", settleGenCard({ skipping: true, aborting: true, errName: "AbortError", finished: false }), "skip");
  eq("skip wins over late done", settleGenCard({ skipping: true, aborting: false, finished: true }), "skip");
  eq("batch cancel marks cancel", settleGenCard({ skipping: false, aborting: true, errName: "AbortError", finished: false }), "cancel");
  eq("abort error without skip is cancel", settleGenCard({ skipping: false, aborting: false, errName: "AbortError", finished: false }), "cancel");
  eq("finished without skip is ok", settleGenCard({ skipping: false, aborting: false, finished: true }), "ok");
  eq("comfy error is error", settleGenCard({ skipping: false, aborting: false, finished: true, hadError: true }), "error");
  eq("unfinished stream is interrupt", settleGenCard({ skipping: false, aborting: false, finished: false }), "interrupt");
}

{
  const pos = "1girl, solo";
  eq("pin miss line empty with no pins", pinMissLine(lex, pos, new Set()), "");
  const withPin = pinMissLine(lex, pos, new Set(["bikini"]));
  ok("pin miss line lists current miss", withPin.startsWith("釘選未入：") && withPin.includes(labelOf(lex, "bikini")));
  eq("pin miss line clears after unpin", pinMissLine(lex, pos, new Set()), "");
  ok(
    "pin miss line ignores tags already in POS",
    pinMissLine(lex, "1girl, bikini", new Set(["bikini"])) === ""
  );
  const atDraw = new Set(["bikini"]);
  const later = new Set(["bikini", "1boy", "milf", "huge breasts"]);
  const scoped = pinMissLine(lex, pos, later, atDraw);
  ok(
    "later extra pins not dumped into miss line",
    scoped.startsWith("釘選未入：") &&
      scoped.includes(labelOf(lex, "bikini")) &&
      !scoped.includes(labelOf(lex, "1boy")) &&
      !scoped.includes(labelOf(lex, "milf"))
  );
  eq("unpin after draw clears scoped miss", pinMissLine(lex, pos, new Set(), atDraw), "");
  eq("empty draw snapshot shows no miss", pinMissLine(lex, pos, later, new Set()), "");
}

{
  const kept = knownTags(lex, ["1girl", "not-a-tag", 3, ""]);
  ok("knownTags keeps 1girl", kept.includes("1girl"));
  ok("knownTags drops unknown", !kept.includes("not-a-tag"));
  eq("knownTags length", kept.length, 1);
}

{
  const bed = lex.byTag.get("on bed");
  const chair = lex.byTag.get("on chair");
  eq("on bed is env", bed?.section, "env");
  eq("on chair is env", chair?.section, "env");
  eq("on bed mutex is furniture", bed?.mutex, "furniture");
  eq("on chair mutex is furniture", chair?.mutex, "furniture");
  ok("on bed does not mutex sitting", !mutexSiblings(lex, "on bed").includes("sitting"));
  const pinBed = applyPin(lex, new Set(["sitting"]), new Set(), "on bed");
  ok("pin on bed keeps sitting", pinBed.pinned.has("sitting") && pinBed.pinned.has("on bed"));
  const pinLie = applyPin(lex, new Set(["lying"]), new Set(), "on bed");
  ok("pin on bed keeps lying", pinLie.pinned.has("lying") && pinLie.pinned.has("on bed"));
}

{
  ok("straddling implies sitting", (lex.byTag.get("straddling")?.implies || []).includes("sitting"));
  ok("straddling needs pair", (lex.byTag.get("straddling")?.needs || []).includes("pair"));
  ok("sitting on lap implies sitting", (lex.byTag.get("sitting on lap")?.implies || []).includes("sitting"));
  const pinStr = applyPin(lex, new Set(["all fours"]), new Set(), "straddling");
  ok("pin straddling drops all fours", !pinStr.pinned.has("all fours"));
  ok("pin straddling pins sitting", pinStr.pinned.has("sitting") && pinStr.pinned.has("straddling"));
}

{
  for (const tag of ["hug", "cuddling", "hug from behind", "sitting on lap", "holding hands"]) {
    ok(`${tag} needs pair`, (lex.byTag.get(tag)?.needs || []).includes("pair"));
  }
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.heats = ["tease"];
  s.weights = { tease: 1, flash: 0, sex: 0 };
  s.eras = ["modern"];
  const pinHug = applyPin(lex, new Set(), new Set(), "hug").pinned;
  let hugSolo = 0;
  let hugBoy = 0;
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, s, pinHug, new Set(), mulberry32(96000 + i), 96000 + i);
    const h = tagsOf(d);
    if (!h.has("hug") || d.people < 2) hugSolo += 1;
    if (h.has("1boy") || h.has("2boys")) hugBoy += 1;
  }
  eq("girl-only pin hug is a pair of girls", hugSolo, 0);
  eq("girl-only pin hug never adds a boy", hugBoy, 0);
}

{
  const three = lex.byTag.get("threesome");
  const group = lex.byTag.get("group sex");
  const mmf = lex.byTag.get("mmf threesome");
  const ffm = lex.byTag.get("ffm threesome");
  ok("threesome needs group", (three?.needs || []).includes("group"));
  ok("group sex needs group", (group?.needs || []).includes("group"));
  ok("mmf threesome needs group", (mmf?.needs || []).includes("group"));
  ok("mmf threesome needs 2male", (mmf?.needs || []).includes("2male"));
  ok("mmf threesome needs female", (mmf?.needs || []).includes("female"));
  ok("ffm threesome needs group", (ffm?.needs || []).includes("group"));
  ok("ffm threesome needs 2female", (ffm?.needs || []).includes("2female"));
  ok("ffm threesome needs male", (ffm?.needs || []).includes("male"));
  ok("spitroast needs group", (lex.byTag.get("spitroast")?.needs || []).includes("group"));
  ok("spitroast needs 2male", (lex.byTag.get("spitroast")?.needs || []).includes("2male"));

  const s = settings();
  s.girl = true;
  s.boy = true;
  s.heats = ["sex"];
  s.weights = { tease: 0, flash: 0, sex: 1 };
  s.eras = ["modern"];
  const pin3 = applyPin(lex, new Set(), new Set(), "threesome").pinned;
  let under3 = 0;
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, s, pin3, new Set(), mulberry32(96100 + i), 96100 + i);
    const h = tagsOf(d);
    if (!h.has("threesome") || d.people < 3) under3 += 1;
  }
  eq("pin threesome always has 3+ people", under3, 0);

  const pinMmf = applyPin(lex, new Set(), new Set(), "mmf threesome").pinned;
  let mmfBad = 0;
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, s, pinMmf, new Set(), mulberry32(96200 + i), 96200 + i);
    const h = tagsOf(d);
    const boys = (h.has("3boys") ? 3 : 0) || (h.has("2boys") ? 2 : 0) || (h.has("1boy") ? 1 : 0);
    if (!h.has("mmf threesome") || d.people < 3 || boys < 2 || !(h.has("1girl") || h.has("2girls") || h.has("3girls"))) {
      mmfBad += 1;
    }
  }
  eq("pin mmf threesome is 2+ boys and a girl", mmfBad, 0);

  const pinFfm = applyPin(lex, new Set(), new Set(), "ffm threesome").pinned;
  let ffmBad = 0;
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, s, pinFfm, new Set(), mulberry32(96300 + i), 96300 + i);
    const h = tagsOf(d);
    const girls = (h.has("4girls") ? 4 : 0) || (h.has("3girls") ? 3 : 0) || (h.has("2girls") ? 2 : 0) || (h.has("1girl") ? 1 : 0);
    if (!h.has("ffm threesome") || d.people < 3 || girls < 2 || !(h.has("1boy") || h.has("2boys"))) {
      ffmBad += 1;
    }
  }
  eq("pin ffm threesome is 2+ girls and a boy", ffmBad, 0);

  let locked = applyPin(lex, new Set(), new Set(), "1girl").pinned;
  locked = applyPin(lex, locked, new Set(), "1boy").pinned;
  let leftover3 = 0;
  for (let i = 0; i < 60; i++) {
    const h = tagsOf(drawOne(lex, s, locked, new Set(), mulberry32(96400 + i), 96400 + i));
    if (h.has("threesome") || h.has("group sex") || h.has("mmf threesome") || h.has("ffm threesome")) leftover3 += 1;
  }
  eq("1girl+1boy never leftover 3P", leftover3, 0);
}

{
  ok("holding sex toy does not need pair", !((lex.byTag.get("holding sex toy")?.needs || []).includes("pair")));
  for (const tag of ["pinned down", "lifting person", "happy sex", "breast grab", "ass grab", "breast sucking"]) {
    ok(`${tag} needs pair`, (lex.byTag.get(tag)?.needs || []).includes("pair"));
  }
  ok("jack-o' challenge implies all fours", (lex.byTag.get("jack-o' challenge")?.implies || []).includes("all fours"));
  ok("standing on one leg implies standing", (lex.byTag.get("standing on one leg")?.implies || []).includes("standing"));
  const pinJack = applyPin(lex, new Set(["sitting"]), new Set(), "jack-o' challenge");
  ok("pin jack-o' challenge drops sitting", !pinJack.pinned.has("sitting"));
  ok("pin jack-o' challenge pins all fours", pinJack.pinned.has("all fours"));
}

{
  const ACT = ["bathing", "showering", "swimming", "wading", "floating"];
  for (const tag of ACT) {
    const it = lex.byTag.get(tag);
    ok(`${tag} is in the lexicon`, !!it);
    eq(`${tag} is a pose`, it?.section, "pose");
    eq(`${tag} mutex is activity`, it?.mutex, "activity");
  }
  ok("bathing mutexes swimming", mutexSiblings(lex, "bathing").includes("swimming"));
  ok("showering mutexes bathing", mutexSiblings(lex, "showering").includes("bathing"));
  ok("showering implies shower (place)", (lex.byTag.get("showering")?.implies || []).includes("shower (place)"));
  ok("showering is modern-only", JSON.stringify(lex.byTag.get("showering")?.era) === '["modern"]');
  ok("washing hair implies wet hair", (lex.byTag.get("washing hair")?.implies || []).includes("wet hair"));
  ok("washing another's back needs pair", (lex.byTag.get("washing another's back")?.needs || []).includes("pair"));
  ok("shared bathing needs pair", (lex.byTag.get("shared bathing")?.needs || []).includes("pair"));
  ok("shared bathing implies bathing", (lex.byTag.get("shared bathing")?.implies || []).includes("bathing"));
  ok("mixed-sex bathing implies bathing", (lex.byTag.get("mixed-sex bathing")?.implies || []).includes("bathing"));
  eq("ofuro is env", lex.byTag.get("ofuro")?.section, "env");
  eq("sento is env", lex.byTag.get("sento")?.section, "env");
  eq("open-air bath is env", lex.byTag.get("open-air bath")?.section, "env");
  ok("ofuro implies bath", (lex.byTag.get("ofuro")?.implies || []).includes("bath"));
  ok("open-air bath implies outdoors", (lex.byTag.get("open-air bath")?.implies || []).includes("outdoors"));
  const pinShower = applyPin(lex, new Set(), new Set(), "showering");
  ok("pin showering pins shower (place)", pinShower.pinned.has("showering") && pinShower.pinned.has("shower (place)"));
  const pinBath = applyPin(lex, new Set(["swimming"]), new Set(), "bathing");
  ok("pin bathing drops swimming", !pinBath.pinned.has("swimming") && pinBath.pinned.has("bathing"));
  const greeceHits = [];
  for (const d of eraDraws("ancient_greece", 60, 97000)) {
    const h = tagsOf(d);
    if (h.has("showering") || h.has("shower (place)") || h.has("onsen") || h.has("sento") || h.has("ofuro")) {
      greeceHits.push([...h].filter((t) => ["showering", "shower (place)", "onsen", "sento", "ofuro"].includes(t)).join(","));
    }
  }
  eq("ancient_greece: no modern shower or japanese bathhouse", greeceHits, []);
}

{
  const DAILY = [
    "eating",
    "drinking",
    "reading",
    "cooking",
    "shopping",
    "singing",
    "karaoke",
    "playing guitar",
    "playing games",
    "playing video games",
    "playing sports",
    "studying",
    "writing",
    "drawing (action)",
    "painting (action)",
    "stretching",
    "yoga",
    "exercising",
    "training",
    "fishing",
    "camping",
    "picnic",
    "hiking",
    "sunbathing",
    "smoking",
    "cleaning",
    "talking on phone",
    "selfie",
    "taking picture",
    "driving",
    "horseback riding",
    "riding bicycle",
  ];
  for (const tag of DAILY) {
    const it = lex.byTag.get(tag);
    ok(`${tag} is in the lexicon`, !!it);
    eq(`${tag} is a pose`, it?.section, "pose");
    eq(`${tag} mutex is activity`, it?.mutex, "activity");
  }
  ok("eating mutexes swimming", mutexSiblings(lex, "eating").includes("swimming"));
  ok("reading mutexes cooking", mutexSiblings(lex, "reading").includes("cooking"));
  ok("karaoke implies singing", (lex.byTag.get("karaoke")?.implies || []).includes("singing"));
  ok("playing video games implies playing games", (lex.byTag.get("playing video games")?.implies || []).includes("playing games"));
  ok("picnic implies outdoors", (lex.byTag.get("picnic")?.implies || []).includes("outdoors"));
  ok("picnic implies eating", (lex.byTag.get("picnic")?.implies || []).includes("eating"));
  ok("fishing implies outdoors", (lex.byTag.get("fishing")?.implies || []).includes("outdoors"));
  ok("camping implies outdoors", (lex.byTag.get("camping")?.implies || []).includes("outdoors"));
  ok("hiking implies outdoors", (lex.byTag.get("hiking")?.implies || []).includes("outdoors"));
  ok("sunbathing implies outdoors", (lex.byTag.get("sunbathing")?.implies || []).includes("outdoors"));
  ok("shopping is modern-only", JSON.stringify(lex.byTag.get("shopping")?.era) === '["modern"]');
  ok("talking on phone is modern-only", JSON.stringify(lex.byTag.get("talking on phone")?.era) === '["modern"]');
  const pinKara = applyPin(lex, new Set(["swimming"]), new Set(), "karaoke");
  ok("pin karaoke drops swimming", !pinKara.pinned.has("swimming"));
  ok("pin karaoke pins singing", pinKara.pinned.has("karaoke") && pinKara.pinned.has("singing"));
  const pinPic = applyPin(lex, new Set(), new Set(), "picnic");
  ok("pin picnic pins outdoors and eating", pinPic.pinned.has("outdoors") && pinPic.pinned.has("eating"));
  const MODERN_ACT = [
    "shopping",
    "karaoke",
    "playing video games",
    "talking on phone",
    "selfie",
    "driving",
    "riding bicycle",
  ];
  const greeceMod = [];
  for (const d of eraDraws("ancient_greece", 50, 97100)) {
    const h = tagsOf(d);
    for (const t of MODERN_ACT) if (h.has(t)) greeceMod.push(t);
  }
  eq("ancient_greece: no modern daily activities", [...new Set(greeceMod)], []);
}

{
  for (const tag of [
    "netorare",
    "cheating (relationship)",
    "groping",
    "chikan",
    "breastfeeding",
    "carrying",
    "size difference",
  ]) {
    ok(`${tag} needs pair`, (lex.byTag.get(tag)?.needs || []).includes("pair"));
  }
  ok("voyeurism does not need pair", !((lex.byTag.get("voyeurism")?.needs || []).includes("pair")));
  ok("gangbang needs group", (lex.byTag.get("gangbang")?.needs || []).includes("group"));
  ok("gangbang needs crowd", (lex.byTag.get("gangbang")?.needs || []).includes("crowd"));
  ok("gangbang implies group sex", (lex.byTag.get("gangbang")?.implies || []).includes("group sex"));
  ok("object insertion mutex is sex_act", lex.byTag.get("object insertion")?.mutex === "sex_act");
  ok("dildo implies sex toy", (lex.byTag.get("dildo")?.implies || []).includes("sex toy"));
  ok("breastfeeding implies lactation", (lex.byTag.get("breastfeeding")?.implies || []).includes("lactation"));
  ok("pink nipples needs female", (lex.byTag.get("pink nipples")?.needs || []).includes("female"));
  ok("furrowed brow mutex is expression", lex.byTag.get("furrowed brow")?.mutex === "expression");
  ok("looking around mutex is gaze", lex.byTag.get("looking around")?.mutex === "gaze");
  eq("office lady mutex is job", lex.byTag.get("office lady")?.mutex, "job");
  ok("office lady implies pantyhose", (lex.byTag.get("office lady")?.implies || []).includes("pantyhose"));
  ok("office lady implies pencil skirt", (lex.byTag.get("office lady")?.implies || []).includes("pencil skirt"));
  ok("nurse implies nurse cap", (lex.byTag.get("nurse")?.implies || []).includes("nurse cap"));
  ok("doctor implies lab coat", (lex.byTag.get("doctor")?.implies || []).includes("lab coat"));
  ok("salaryman implies suit", (lex.byTag.get("salaryman")?.implies || []).includes("suit"));
  ok("salaryman needs male", (lex.byTag.get("salaryman")?.needs || []).includes("male"));
  ok("policewoman implies police uniform", (lex.byTag.get("policewoman")?.implies || []).includes("police uniform"));
  ok("waitress implies apron", (lex.byTag.get("waitress")?.implies || []).includes("apron"));
  ok("idol implies idol clothes", (lex.byTag.get("idol")?.implies || []).includes("idol clothes"));
  eq("fitness gym is env", lex.byTag.get("fitness gym")?.section, "env");
  eq("hospital is env", lex.byTag.get("hospital")?.section, "env");
  eq("locker room is env", lex.byTag.get("locker room")?.section, "env");
  const pinOl = applyPin(lex, new Set(["nurse"]), new Set(), "office lady");
  ok("pin office lady drops nurse", !pinOl.pinned.has("nurse"));
  ok(
    "pin office lady pins skirt clothes",
    pinOl.pinned.has("office lady") && pinOl.pinned.has("pantyhose") && pinOl.pinned.has("pencil skirt")
  );
  const pinGb = applyPin(lex, new Set(), new Set(), "gangbang").pinned;
  const s = settings();
  s.girl = true;
  s.boy = true;
  s.heats = ["sex"];
  s.weights = { tease: 0, flash: 0, sex: 1 };
  s.eras = ["modern"];
  let gbShort = 0;
  for (let i = 0; i < 30; i++) {
    const d = drawOne(lex, s, pinGb, new Set(), mulberry32(97200 + i), 97200 + i);
    if (!tagsOf(d).has("gangbang") || d.people < 4) gbShort += 1;
  }
  eq("pin gangbang always has 4+ people", gbShort, 0);
  const pinNtr = applyPin(lex, new Set(), new Set(), "netorare").pinned;
  let ntrSolo = 0;
  for (let i = 0; i < 20; i++) {
    const d = drawOne(lex, s, pinNtr, new Set(), mulberry32(97300 + i), 97300 + i);
    if (!tagsOf(d).has("netorare") || d.people < 2) ntrSolo += 1;
  }
  eq("pin netorare is a pair", ntrSolo, 0);
  const greeceJob = [];
  for (const d of eraDraws("ancient_greece", 40, 97400)) {
    const h = tagsOf(d);
    for (const t of ["nurse", "office lady", "condom", "fitness gym", "hospital", "locker room"]) {
      if (h.has(t)) greeceJob.push(t);
    }
  }
  eq("ancient_greece: no modern jobs or clinics", [...new Set(greeceJob)], []);
}

{
  const s = settings();
  s.girl = true;
  s.boy = true;
  s.heats = ["sex"];
  s.weights = { tease: 0, flash: 0, sex: 1 };
  s.eras = ["modern"];
  s.counts.pose = 20;
  const DAILY = [
    "shopping",
    "driving",
    "cooking",
    "karaoke",
    "playing video games",
    "studying",
    "riding bicycle",
    "hiking",
    "camping",
    "fishing",
  ];
  let daily = 0;
  for (let i = 0; i < 80; i++) {
    const h = tagsOf(drawOne(lex, s, new Set(), new Set(), mulberry32(140000 + i), 140000 + i));
    if (DAILY.some((t) => h.has(t))) daily += 1;
  }
  eq("sex heat does not auto-draw daily activities", daily, 0);
  const pinShop = applyPin(lex, new Set(), new Set(), "shopping").pinned;
  const dShop = drawOne(lex, s, pinShop, new Set(), mulberry32(141000), 141000);
  ok("pin shopping still wins on sex heat", tagsOf(dShop).has("shopping"));
}

{
  eq("toggleHeat adds a second scale", toggleHeat(["tease"], "flash"), ["tease", "flash"]);
  eq("toggleHeat cannot drop the last scale", toggleHeat(["tease"], "tease"), ["tease"]);
  eq("toggleHeat drops one of three", toggleHeat(["tease", "flash", "sex"], "sex"), ["tease", "flash"]);
  eq("toggleHeat mixed selects all", toggleHeat(["tease"], "mixed"), ["tease", "flash", "sex"]);
  eq("toggleHeat adds activity", toggleHeat(["tease"], "activity"), ["activity", "tease"]);
  eq("toggleHeat mixed drops activity", toggleHeat(["activity"], "mixed"), ["tease", "flash", "sex"]);
  eq("heatPresetOf one is that heat", heatPresetOf(["sex"]), "sex");
  eq("heatPresetOf activity is activity", heatPresetOf(["activity"]), "activity");
  eq("heatPresetOf two is custom", heatPresetOf(["tease", "sex"]), "custom");
  eq("heatPresetOf three is mixed", heatPresetOf(["tease", "flash", "sex"]), "mixed");
  eq("heatPresetOf all four is custom", heatPresetOf(["activity", "tease", "flash", "sex"]), "custom");
  const pairW = weightsForHeats(["tease", "flash"]);
  eq("two heats split weight", pairW.tease, 0.5);
  eq("two heats leave the third at 0", pairW.sex, 0);
  const mixedW = weightsForHeats(["tease", "flash", "sex"], { mixed: { tease: 0.3, flash: 0.3, sex: 0.4 } });
  eq("all three keep mixed sex weight", mixedW.sex, 0.4);
  const pair = sanitizeSettings({ heats: ["tease", "flash"] }, data);
  eq("sanitize two heats is custom", pair.heatPreset, "custom");
  ok("sanitize two heats keeps flash", pair.heats.includes("flash") && !pair.heats.includes("sex"));
  eq("sanitize two heats zeros sex weight", pair.weights.sex, 0);
  const s = settings();
  s.heats = ["tease", "flash"];
  s.heatPreset = "custom";
  s.weights = { tease: 0.5, flash: 0.5, sex: 0 };
  s.girl = true;
  s.boy = true;
  s.eras = ["modern"];
  let sexAct = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, new Set(), new Set(), mulberry32(143000 + i), 143000 + i));
    if ([...h].some((t) => lex.byTag.get(t)?.mutex === "sex_act")) sexAct += 1;
  }
  eq("tease+flash never rolls a sex act", sexAct, 0);
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.heats = ["tease"];
  s.weights = { tease: 1, flash: 0, sex: 0 };
  s.eras = ["modern"];
  let withAct = 0;
  let withSexAct = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, new Set(), new Set(), mulberry32(142000 + i), 142000 + i));
    const act = [...h].some((t) => lex.byTag.get(t)?.mutex === "activity");
    const sex = [...h].some((t) => lex.byTag.get(t)?.mutex === "sex_act");
    if (act) withAct += 1;
    if (sex) withSexAct += 1;
  }
  ok("tease heat usually draws one activity", withAct >= 32, `activity=${withAct}/40`);
  eq("tease heat does not draw a sex act", withSexAct, 0);
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.heats = ["activity"];
  s.heatPreset = "activity";
  s.weights = { activity: 1, tease: 0, flash: 0, sex: 0 };
  s.eras = ["modern"];
  let withAct = 0;
  let withSexAct = 0;
  let withFlash = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, new Set(), new Set(), mulberry32(144000 + i), 144000 + i));
    if ([...h].some((t) => lex.byTag.get(t)?.mutex === "activity")) withAct += 1;
    if ([...h].some((t) => lex.byTag.get(t)?.mutex === "sex_act")) withSexAct += 1;
    if ([...h].some((t) => lex.byTag.get(t)?.mutex === "clothes_action")) withFlash += 1;
  }
  ok("activity heat usually draws one activity", withAct >= 32, `activity=${withAct}/40`);
  eq("activity heat does not draw a sex act", withSexAct, 0);
  eq("activity heat does not draw clothes-off", withFlash, 0);
  ok(
    "cowgirl clashes with activity-only",
    heatMismatches(lex, new Set(["cowgirl position"]), ["activity"]).includes("cowgirl position")
  );
}

{
  for (const tag of [
    "amazon position",
    "spooning",
    "footjob",
    "anilingus",
    "suspended congress",
    "sex from behind",
    "grabbing another's breast",
    "grabbing another's ass",
    "grabbing another's hair",
    "guided breast grab",
  ]) {
    ok(`${tag} needs pair`, (lex.byTag.get(tag)?.needs || []).includes("pair"));
  }
  ok("object insertion stays solo-ok", !((lex.byTag.get("object insertion")?.needs || []).includes("pair")));
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.heats = ["sex"];
  s.weights = { activity: 0, tease: 0, flash: 0, sex: 1 };
  s.eras = ["modern"];
  s.counts.pose = 12;
  const TWO_PERSON = [
    "amazon position",
    "spooning",
    "footjob",
    "anilingus",
    "grabbing another's breast",
    "grabbing another's ass",
    "grabbing another's hair",
    "guided breast grab",
    "groping",
    "kiss",
    "hug",
  ];
  let coupleOnSolo = 0;
  for (let i = 0; i < 50; i++) {
    const d = drawOne(lex, s, new Set(), new Set(), mulberry32(145000 + i), 145000 + i);
    const h = tagsOf(d);
    if (d.people === 1 && TWO_PERSON.some((t) => h.has(t))) coupleOnSolo += 1;
  }
  eq("girl-only sex never leftover two-person acts", coupleOnSolo, 0);
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.heats = ["sex"];
  s.weights = { activity: 0, tease: 0, flash: 0, sex: 1 };
  s.eras = ["modern"];
  s.counts.pose = 12;
  let pin = applyPin(lex, new Set(), new Set(), "1girl").pinned;
  pin = applyPin(lex, pin, new Set(), "nude").pinned;
  let through = 0;
  let noSolo = 0;
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, s, pin, new Set(), mulberry32(148000 + i), 148000 + i);
    const h = tagsOf(d);
    if (h.has("masturbation through clothes")) through += 1;
    if (
      !h.has("masturbation") &&
      !h.has("female masturbation") &&
      !h.has("fingering")
    ) {
      noSolo += 1;
    }
  }
  eq("nude solo sex never through-clothes", through, 0);
  eq("nude solo sex still has a masturbation tag", noSolo, 0);
  const CLOTHES_ONLY = [
    "masturbation through clothes",
    "clothes lift",
    "clothes pull",
    "clothing aside",
    "undressing",
    "upskirt",
    "cameltoe",
    "wedgie",
    "flashing",
    "strap slip",
    "areola slip",
    "nipple slip",
    "one breast out",
    "erection under clothes",
    "bulge",
    "clothed sex",
    "paizuri under clothes",
    "clothed female nude male",
    "adjusting clothes",
    "clothes tug",
  ];
  let clothesOnNude = 0;
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, s, pin, new Set(), mulberry32(149000 + i), 149000 + i);
    const h = tagsOf(d);
    if (CLOTHES_ONLY.some((t) => h.has(t))) clothesOnNude += 1;
  }
  eq("nude solo sex never clothes-only acts", clothesOnNude, 0);
  const flash = settings();
  flash.girl = true;
  flash.boy = false;
  flash.heats = ["flash"];
  flash.weights = { activity: 0, tease: 0, flash: 1, sex: 0 };
  flash.eras = ["modern"];
  let flashBad = 0;
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, flash, pin, new Set(), mulberry32(150000 + i), 150000 + i);
    const h = tagsOf(d);
    if (CLOTHES_ONLY.some((t) => h.has(t))) flashBad += 1;
  }
  eq("nude flash never clothes-only acts", flashBad, 0);
  const tease = settings();
  tease.girl = true;
  tease.boy = false;
  tease.heats = ["tease"];
  tease.weights = { activity: 0, tease: 1, flash: 0, sex: 0 };
  tease.eras = ["modern"];
  tease.counts.pose = 12;
  let teaseBad = 0;
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, tease, pin, new Set(), mulberry32(151000 + i), 151000 + i);
    const h = tagsOf(d);
    if (CLOTHES_ONLY.some((t) => h.has(t))) teaseBad += 1;
  }
  eq("nude tease never clothes-only acts", teaseBad, 0);
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.heats = ["activity"];
  s.weights = { activity: 1, tease: 0, flash: 0, sex: 0 };
  s.eras = ["modern"];
  s.counts.pose = 10;
  s.counts.env = 6;
  const pinOut = applyPin(lex, new Set(), new Set(), "outdoors").pinned;
  const indoorPlace = ["living room", "bathroom", "bedroom", "office", "classroom", "kitchen"];
  let indoorOnOut = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinOut, new Set(), mulberry32(152000 + i), 152000 + i));
    if (indoorPlace.some((t) => h.has(t))) indoorOnOut += 1;
  }
  eq("pin outdoors never auto indoor places", indoorOnOut, 0);
  const pinIn = applyPin(lex, new Set(), new Set(), "indoors").pinned;
  const outdoorAct = ["camping", "picnic", "hiking", "sunbathing", "open-air bath", "beach"];
  let outOnIn = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinIn, new Set(), mulberry32(153000 + i), 153000 + i));
    if (outdoorAct.some((t) => h.has(t))) outOnIn += 1;
  }
  eq("pin indoors never auto outdoor activities/places", outOnIn, 0);
  const sex = settings();
  sex.girl = true;
  sex.boy = true;
  sex.heats = ["tease"];
  sex.weights = { activity: 0, tease: 1, flash: 0, sex: 0 };
  sex.eras = ["modern"];
  const pinSex = applyPin(lex, new Set(), new Set(), "cowgirl position").pinned;
  const DAILY = ["shopping", "driving", "cooking", "studying", "karaoke", "hiking", "camping"];
  let dailyOnSex = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sex, pinSex, new Set(), mulberry32(154000 + i), 154000 + i));
    if (DAILY.some((t) => h.has(t))) dailyOnSex += 1;
  }
  eq("pinned sex act does not auto daily activity", dailyOnSex, 0);
}

{
  const pinHead = applyPin(lex, new Set(), new Set(), "shower head");
  ok("shower head pin walks to shower place", pinHead.pinned.has("shower (place)"));
  ok("shower head pin walks to indoors", pinHead.pinned.has("indoors"));
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.heats = ["tease"];
  s.weights = { activity: 0, tease: 1, flash: 0, sex: 0 };
  s.eras = ["modern"];
  s.counts.env = 6;
  let out = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinHead.pinned, new Set(), mulberry32(155000 + i), 155000 + i));
    if (h.has("outdoors")) out += 1;
  }
  eq("pin shower head never auto outdoors", out, 0);
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.heats = ["activity"];
  s.weights = { activity: 1, tease: 0, flash: 0, sex: 0 };
  s.eras = ["modern"];
  const pinSleep = applyPin(lex, new Set(), new Set(), "sleeping").pinned;
  const AWAKE = [
    "eating",
    "hiking",
    "swimming",
    "cooking",
    "reading",
    "dancing",
    "picnic",
    "stretching",
    "yoga",
    "studying",
    "sunbathing",
    "smoking",
    "drinking",
    "floating",
    "bathing",
    "showering",
  ];
  let awake = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinSleep, new Set(), mulberry32(156000 + i), 156000 + i));
    if (AWAKE.some((t) => h.has(t))) awake += 1;
  }
  eq("sleeping never auto awake activities", awake, 0);
  const pinSeiza = applyPin(lex, new Set(), new Set(), "seiza").pinned;
  const MOVE = ["swimming", "horseback riding", "riding bicycle", "hiking", "wading"];
  let move = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinSeiza, new Set(), mulberry32(157000 + i), 157000 + i));
    if (MOVE.some((t) => h.has(t))) move += 1;
  }
  eq("seiza never auto moving activities", move, 0);
  const pinHof = applyPin(lex, new Set(), new Set(), "head out of frame").pinned;
  const FACE = ["looking at viewer", "smile", "wink", "ahegao", "closed eyes", "facial", "cum in mouth"];
  let face = 0;
  const tease = settings();
  tease.girl = true;
  tease.boy = false;
  tease.heats = ["tease"];
  tease.weights = { activity: 0, tease: 1, flash: 0, sex: 0 };
  tease.eras = ["modern"];
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, tease, pinHof, new Set(), mulberry32(158000 + i), 158000 + i));
    if (FACE.some((t) => h.has(t))) face += 1;
  }
  eq("head out of frame never auto face tags", face, 0);
  const sexS = settings();
  sexS.girl = true;
  sexS.boy = true;
  sexS.heats = ["sex"];
  sexS.weights = { activity: 0, tease: 0, flash: 0, sex: 1 };
  sexS.eras = ["modern"];
  sexS.sceneMode = "diverse";
  let sexFace = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sexS, pinHof, new Set(), mulberry32(180000 + i), 180000 + i));
    if (["facial", "cum in mouth", "closed eyes", "looking at penis"].some((t) => h.has(t))) sexFace += 1;
  }
  eq("head out of frame never auto facial/cum in mouth", sexFace, 0);
  let lookPenis = 0;
  const boyHof = { ...sexS, girl: false, boy: true };
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, boyHof, pinHof, new Set(), mulberry32(245000 + i), 245000 + i));
    if ([...h].some((t) => t === "looking at penis" || /^looking /.test(t))) lookPenis += 1;
  }
  eq("head out of frame never auto looking at penis", lookPenis, 0);
  const pinClosed = applyPin(lex, new Set(), new Set(), "closed eyes").pinned;
  let hofAfter = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, tease, pinClosed, new Set(), mulberry32(181000 + i), 181000 + i));
    if (h.has("head out of frame") || h.has("lower body")) hofAfter += 1;
  }
  eq("closed eyes never auto faceless camera", hofAfter, 0);
}

{
  const fat = settings();
  fat.girl = true;
  fat.boy = false;
  fat.heats = ["tease"];
  fat.weights = { activity: 0, tease: 1, flash: 0, sex: 0 };
  fat.eras = ["modern"];
  fat.sceneMode = "normal";
  fat.counts = { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 };
  const EYE = ["wink", "empty eyes", "sparkling eyes", "half-closed eyes", "rolling eyes"];
  const MOUTH = ["open mouth", "clenched teeth", "biting own lip", "tongue out", "parted lips", "licking lips", "drooling"];
  let twoEye = 0;
  let twoMouth = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, fat, new Set(), new Set(), mulberry32(190000 + i), 190000 + i));
    if (EYE.filter((t) => h.has(t)).length > 1) twoEye += 1;
    if (MOUTH.filter((t) => h.has(t)).length > 1) twoMouth += 1;
  }
  eq("pose10 never two leftover eye extras", twoEye, 0);
  eq("pose10 never two leftover mouth extras", twoMouth, 0);
  const pinSleepFat = applyPin(lex, new Set(), new Set(), "sleeping").pinned;
  fat.heats = ["activity"];
  fat.weights = { activity: 1, tease: 0, flash: 0, sex: 0 };
  let sleepFace = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, fat, pinSleepFat, new Set(), mulberry32(191000 + i), 191000 + i));
    if ([...EYE, ...MOUTH].some((t) => h.has(t))) sleepFace += 1;
  }
  eq("sleeping pose10 never leftover eye/mouth extras", sleepFace, 0);
  const pinLivFat = applyPin(lex, new Set(), new Set(), "living room").pinned;
  let skyIn = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, fat, pinLivFat, new Set(), mulberry32(192000 + i), 192000 + i));
    if (["tree", "bush", "sky", "blue sky", "orange sky", "snow", "cherry blossoms"].some((t) => h.has(t))) {
      skyIn += 1;
    }
  }
  eq("indoors env10 never outdoor leftover sky/tree", skyIn, 0);
  const weird = { ...fat, sceneMode: "weird", lockScene: false, heats: ["tease"], weights: { activity: 0, tease: 1, flash: 0, sex: 0 } };
  let weirdSky = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, weird, pinLivFat, new Set(), mulberry32(193000 + i), 193000 + i));
    if (["tree", "bush", "sky", "blue sky", "orange sky", "starry sky", "cherry blossoms"].some((t) => h.has(t))) {
      weirdSky += 1;
    }
  }
  eq("weird indoors env10 never outdoor leftover", weirdSky, 0);
  const pinKit = applyPin(lex, new Set(), new Set(), "kitchen").pinned;
  let bedKit = 0;
  let wetKit = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, fat, pinKit, new Set(), mulberry32(194000 + i), 194000 + i));
    if (h.has("on bed") || h.has("bed sheet")) bedKit += 1;
    if (h.has("partially submerged") || h.has("splashing") || h.has("washing body")) wetKit += 1;
  }
  eq("kitchen pose10 never on bed leftover", bedKit, 0);
  eq("kitchen pose10 never water leftovers", wetKit, 0);
  const pinClosed2 = applyPin(lex, new Set(), new Set(), "closed eyes").pinned;
  let spark = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, fat, pinClosed2, new Set(), mulberry32(195000 + i), 195000 + i));
    if (["sparkling eyes", "wink", "empty eyes", "looking at viewer", "looking ahead"].some((t) => h.has(t))) spark += 1;
  }
  eq("closed eyes never leftover sparkle/wink/gaze", spark, 0);
  const pinOl = applyPin(lex, new Set(), new Set(), "office lady").pinned;
  const ol = { ...fat, heats: ["tease"], weights: { activity: 0, tease: 1, flash: 0, sex: 0 }, eras: ["modern"], drawJob: true };
  let olOut = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, ol, pinOl, new Set(), mulberry32(196000 + i), 196000 + i));
    if (h.has("outdoors")) olOut += 1;
  }
  eq("normal office lady never auto outdoors", olOut, 0);
  const pinSwimSex = applyPin(lex, new Set(), new Set(), "swimming").pinned;
  const swimSex = settings();
  swimSex.girl = true;
  swimSex.boy = false;
  swimSex.heats = ["sex"];
  swimSex.weights = { activity: 0, tease: 0, flash: 0, sex: 1 };
  swimSex.eras = ["victorian"];
  swimSex.sceneMode = "normal";
  swimSex.counts = { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 };
  const WATER2 = ["pool", "beach", "ocean", "underwater", "poolside"];
  let drySwim = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, swimSex, pinSwimSex, new Set(), mulberry32(197000 + i), 197000 + i));
    if (!WATER2.some((t) => h.has(t))) drySwim += 1;
  }
  eq("normal sex+pin swimming still has water place", drySwim, 0);
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.heats = ["activity"];
  s.weights = { activity: 1, tease: 0, flash: 0, sex: 0 };
  s.eras = ["modern"];
  s.sceneMode = "normal";
  s.counts = { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 };
  const pinSwim = applyPin(lex, new Set(), new Set(), "swimming").pinned;
  let plant = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinSwim, new Set(), mulberry32(206000 + i), 206000 + i));
    if (["standing", "squatting", "kneeling", "on one knee"].some((t) => h.has(t))) plant += 1;
  }
  eq("swimming never auto standing/squatting/kneeling", plant, 0);
  const pinHofEyes = applyPin(lex, new Set(), new Set(), "head out of frame").pinned;
  let hofEyes = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinHofEyes, new Set(), mulberry32(301000 + i), 301000 + i));
    if (
      [...h].some((t) => {
        const it = lex.byTag.get(t);
        return it && (it.mutex === "eye_color" || it.group === "eyes");
      })
    ) {
      hofEyes += 1;
    }
  }
  eq("head out of frame never auto eye tags", hofEyes, 0);
  const pinJog = applyPin(lex, new Set(), new Set(), "jogging").pinned;
  let jogStand = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinJog, new Set(), mulberry32(302000 + i), 302000 + i));
    if (h.has("standing")) jogStand += 1;
  }
  eq("jogging never auto standing", jogStand, 0);
  const pinLook = applyPin(lex, new Set(), new Set(), "looking at viewer").pinned;
  let lookSleep = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinLook, new Set(), mulberry32(303000 + i), 303000 + i));
    if (h.has("sleeping")) lookSleep += 1;
  }
  eq("looking at viewer never auto sleeping", lookSleep, 0);
  {
    const actOnly = {
      ...s,
      heats: ["activity"],
      weights: { activity: 1, tease: 0, flash: 0, sex: 0 },
      sceneMode: "normal",
    };
    for (const p of BUILTIN_PRESETS) {
      let miss = 0;
      for (let i = 0; i < 12; i++) {
        const pinned = togglePresetTags(lex, p.tags, new Set());
        const h = tagsOf(drawOne(lex, actOnly, pinned, new Set(), mulberry32(410000 + i), 410000 + i));
        if (![...h].some((t) => lex.byTag.get(t)?.mutex === "activity")) miss += 1;
      }
      eq(`activity heat + ${p.id} always has activity`, miss, 0);
    }
    const pinGuitar = applyPin(lex, new Set(), new Set(), "playing guitar").pinned;
    let noGuitar = 0;
    for (let i = 0; i < 16; i++) {
      const h = tagsOf(drawOne(lex, actOnly, pinGuitar, new Set(), mulberry32(411000 + i), 411000 + i));
      if (!h.has("guitar")) noGuitar += 1;
    }
    eq("playing guitar brings guitar prop", noGuitar, 0);
    const pinFloat = applyPin(lex, new Set(), new Set(), "floating").pinned;
    let floatSit = 0;
    for (let i = 0; i < 24; i++) {
      const h = tagsOf(drawOne(lex, actOnly, pinFloat, new Set(), mulberry32(413000 + i), 413000 + i));
      if (h.has("sitting")) floatSit += 1;
    }
    eq("floating never auto sitting", floatSit, 0);
    const pinAmz = applyPin(lex, new Set(), new Set(), "amazon position").pinned;
    const sexS = {
      ...s,
      heats: ["sex"],
      weights: { activity: 0, tease: 0, flash: 0, sex: 1 },
      girl: true,
      boy: true,
    };
    let amzTd = 0;
    for (let i = 0; i < 24; i++) {
      const h = tagsOf(drawOne(lex, sexS, pinAmz, new Set(), mulberry32(414000 + i), 414000 + i));
      if (h.has("top-down bottom-up")) amzTd += 1;
    }
    eq("amazon position never auto top-down bottom-up", amzTd, 0);
    const pinPixie = applyPin(lex, new Set(), new Set(), "pixie cut").pinned;
    let pixieBun = 0;
    for (let i = 0; i < 24; i++) {
      const h = tagsOf(drawOne(lex, actOnly, pinPixie, new Set(), mulberry32(415000 + i), 415000 + i));
      if (h.has("double bun") || h.has("hair bun") || h.has("single hair bun")) pixieBun += 1;
    }
    eq("pixie cut never auto hair bun/double bun", pixieBun, 0);
    const pinDrive = applyPin(lex, new Set(), new Set(), "driving").pinned;
    let driveGlass = 0;
    for (let i = 0; i < 24; i++) {
      const h = tagsOf(drawOne(lex, actOnly, pinDrive, new Set(), mulberry32(416000 + i), 416000 + i));
      if (h.has("breasts on glass") || h.has("against glass") || h.has("breasts on table")) driveGlass += 1;
    }
    eq("driving never auto breasts on glass/table", driveGlass, 0);
    const pinCook = applyPin(lex, new Set(), new Set(), "cooking").pinned;
    let noPan = 0;
    for (let i = 0; i < 16; i++) {
      const h = tagsOf(drawOne(lex, actOnly, pinCook, new Set(), mulberry32(412000 + i), 412000 + i));
      if (!h.has("frying pan")) noPan += 1;
    }
    eq("cooking brings frying pan", noPan, 0);
    const sNorm = {
      ...s,
      heats: ["activity"],
      weights: { activity: 1, tease: 0, flash: 0, sex: 0 },
      sceneMode: "normal",
      lockScene: true,
      counts: { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 },
    };
    const pinLivN = applyPin(lex, new Set(), new Set(), "living room").pinned;
    let envJunk = 0;
    const envBad = [
      "beach umbrella",
      "innertube",
      "ocean",
      "pool",
      "golf club",
      "tennis racket",
      "basketball (object)",
      "ski slope",
    ];
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, sNorm, pinLivN, new Set(), mulberry32(417000 + i), 417000 + i));
      if (envBad.some((t) => h.has(t))) envJunk += 1;
    }
    eq("normal living room never leftover water/sport env", envJunk, 0);
    const pinPoolN = applyPresetTags(lex, BUILTIN_PRESETS.find((p) => p.id === "pool").tags, new Set());
    let clothJunk = 0;
    const clothBad = ["clipboard", "necktie", "bowtie", "stethoscope", "nurse cap", "hard hat", "police hat", "lab coat"];
    for (let i = 0; i < 40; i++) {
      const d = drawOne(lex, sNorm, pinPoolN, new Set(), mulberry32(418000 + i), 418000 + i);
      if (d.sections.clothing.some((t) => clothBad.includes(t))) clothJunk += 1;
    }
    eq("normal pool never leftover job/office accessories", clothJunk, 0);
    let shoeSock = 0;
    for (let i = 0; i < 80; i++) {
      const h = tagsOf(drawOne(lex, sNorm, new Set(), new Set(), mulberry32(419000 + i), 419000 + i));
      if (
        ["sandals", "boots", "sneakers", "geta", "shoes", "zouri", "pantyhose", "kneehighs", "white socks"].some((t) =>
          h.has(t)
        )
      ) {
        shoeSock += 1;
      }
    }
    ok("normal still draws shoes or socks", shoeSock > 0, `shoeSock=${shoeSock}/80`);
    const pinSwimN = applyPin(lex, new Set(), new Set(), "swimming").pinned;
    let swimBoots = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, sNorm, pinSwimN, new Set(), mulberry32(421000 + i), 421000 + i));
      if (h.has("boots") || h.has("sneakers") || h.has("high heels")) swimBoots += 1;
    }
    eq("pinned swimming never leftover boots/sneakers/heels", swimBoots, 0);
  }
  const pinHof2 = applyPin(lex, new Set(), new Set(), "head out of frame").pinned;
  const tease = { ...s, heats: ["tease"], weights: { activity: 0, tease: 1, flash: 0, sex: 0 } };
  let hofMouth = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, tease, pinHof2, new Set(), mulberry32(207000 + i), 207000 + i));
    if (["french kiss", "finger to mouth", "eating", "covering own mouth"].some((t) => h.has(t))) hofMouth += 1;
  }
  eq("head out of frame never auto mouth acts", hofMouth, 0);
  const pinSleep3 = applyPin(lex, new Set(), new Set(), "sleeping").pinned;
  let sleepLook = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinSleep3, new Set(), mulberry32(208000 + i), 208000 + i));
    if ([...h].some((t) => t.startsWith("looking ") || t === "kissing")) sleepLook += 1;
  }
  eq("sleeping never auto looking/kissing leftovers", sleepLook, 0);
  const boyN = { ...s, girl: false, boy: true, heats: ["tease"], weights: { activity: 0, tease: 1, flash: 0, sex: 0 } };
  let raceMale = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, boyN, new Set(), new Set(), mulberry32(209000 + i), 209000 + i));
    if (h.has("dark-skinned male")) raceMale += 1;
  }
  eq("normal mode never auto dark-skinned male", raceMale, 0);
}

{
  const tease = settings();
  tease.girl = true;
  tease.boy = false;
  tease.heats = ["tease"];
  tease.weights = { activity: 0, tease: 1, flash: 0, sex: 0 };
  tease.eras = ["modern"];
  const pinDay = applyPin(lex, new Set(), new Set(), "day").pinned;
  let stars = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, tease, pinDay, new Set(), mulberry32(159000 + i), 159000 + i));
    if (h.has("starry sky") || h.has("moonlight")) stars += 1;
  }
  eq("day never auto starry sky or moonlight", stars, 0);
  const pinSun = applyPin(lex, new Set(), new Set(), "sunbathing").pinned;
  let nightSun = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, tease, pinSun, new Set(), mulberry32(175000 + i), 175000 + i));
    if (h.has("night") || h.has("starry sky") || h.has("moonlight")) nightSun += 1;
  }
  eq("sunbathing never auto night/starry/moonlight", nightSun, 0);
  const pinNight = applyPin(lex, new Set(), new Set(), "night").pinned;
  let dayNight = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, tease, pinNight, new Set(), mulberry32(176000 + i), 176000 + i));
    if (h.has("sunlight") || h.has("sunbathing") || h.has("blue sky")) dayNight += 1;
  }
  eq("night never auto sunlight/sunbathing/blue sky", dayNight, 0);
  const pinBlue = applyPin(lex, new Set(), new Set(), "blue sky").pinned;
  let blueStars = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, tease, pinBlue, new Set(), mulberry32(182000 + i), 182000 + i));
    if (h.has("starry sky") || h.has("moonlight") || h.has("night")) blueStars += 1;
  }
  eq("blue sky never auto starry/moonlight/night", blueStars, 0);
  const pinMoon = applyPin(lex, new Set(), new Set(), "moonlight").pinned;
  let moonDay = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, tease, pinMoon, new Set(), mulberry32(183000 + i), 183000 + i));
    if (h.has("orange sky") || h.has("blue sky") || h.has("sunlight")) moonDay += 1;
  }
  eq("moonlight never auto orange/blue sky or sunlight", moonDay, 0);
  const pinDrive = applyPin(lex, new Set(), new Set(), "driving").pinned;
  const actS = settings();
  actS.girl = true;
  actS.boy = false;
  actS.heats = ["activity"];
  actS.weights = { activity: 1, tease: 0, flash: 0, sex: 0 };
  actS.eras = ["modern"];
  actS.sceneMode = "diverse";
  let groundDrive = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, actS, pinDrive, new Set(), mulberry32(177000 + i), 177000 + i));
    if (["all fours", "crawling", "top-down bottom-up"].some((t) => h.has(t))) groundDrive += 1;
  }
  eq("driving never auto ground body", groundDrive, 0);
  let lieDrive = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, actS, pinDrive, new Set(), mulberry32(184000 + i), 184000 + i));
    if (["on stomach", "on back", "on side", "sleeping"].some((t) => h.has(t))) lieDrive += 1;
  }
  eq("driving never auto lying/sleeping body", lieDrive, 0);
  const pinSleep2 = applyPin(lex, new Set(), new Set(), "sleeping").pinned;
  let wash = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, actS, pinSleep2, new Set(), mulberry32(178000 + i), 178000 + i));
    if (h.has("washing body") || h.has("partially submerged")) wash += 1;
  }
  eq("sleeping never auto washing body", wash, 0);
}

{
  eq("sanitize clamps counts to 10", sanitizeSettings({ counts: { pose: 99, env: 15 } }, data).counts.pose, 10);
  eq("sanitize clamps env count to 10", sanitizeSettings({ counts: { env: 15 } }, data).counts.env, 10);
}

{
  eq("sceneMode defaults normal", defaultSettings(data).sceneMode, "normal");
  eq("lockScene defaults on", defaultSettings(data).lockScene, true);
  eq("sanitize lockScene false becomes weird", sanitizeSettings({ lockScene: false }, data).sceneMode, "weird");
  eq("sanitize sceneMode diverse", sanitizeSettings({ sceneMode: "diverse" }, data).sceneMode, "diverse");
  eq("sceneModeOf weird", sceneModeOf({ sceneMode: "weird" }), "weird");
  ok("SCENE_MODES has three", SCENE_MODES.length === 3);
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.heats = ["activity"];
  s.weights = { activity: 1, tease: 0, flash: 0, sex: 0 };
  s.eras = ["modern"];
  s.lockScene = true;
  s.counts.env = 6;
  const pinSwim = applyPin(lex, new Set(), new Set(), "swimming").pinned;
  const WATER = ["pool", "poolside", "pool ladder", "beach", "ocean", "underwater", "bathtub", "bathroom", "shower (place)", "onsen", "ofuro", "sento", "open-air bath", "bubble bath", "bath"];
  let dry = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinSwim, new Set(), mulberry32(160000 + i), 160000 + i));
    if (!WATER.some((t) => h.has(t))) dry += 1;
  }
  eq("lockScene swimming always has water place", dry, 0);
  const pinLiv = applyPin(lex, new Set(), new Set(), "living room").pinned;
  let wet = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinLiv, new Set(), mulberry32(161000 + i), 161000 + i));
    if (["swimming", "wading", "horseback riding", "hiking"].some((t) => h.has(t))) wet += 1;
  }
  eq("lockScene living room never swim/horse/hike", wet, 0);
  const pinOfuro = applyPin(lex, new Set(), new Set(), "ofuro").pinned;
  let shoes = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinOfuro, new Set(), mulberry32(162000 + i), 162000 + i));
    if (["geta", "zouri", "boots", "sneakers"].some((t) => h.has(t))) shoes += 1;
  }
  eq("lockScene ofuro never outdoor shoes", shoes, 0);
  const pinBath = applyPin(lex, new Set(), new Set(), "bathing").pinned;
  let castle = 0;
  const med = { ...s, eras: ["medieval"] };
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, med, pinBath, new Set(), mulberry32(163000 + i), 163000 + i));
    if (h.has("castle")) castle += 1;
  }
  eq("lockScene bathing never castle", castle, 0);
  const pinPicnic = applyPin(lex, new Set(), new Set(), "picnic").pinned;
  let under = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinPicnic, new Set(), mulberry32(164000 + i), 164000 + i));
    if (h.has("underwater") || h.has("ocean") || h.has("pool")) under += 1;
  }
  eq("lockScene picnic never underwater/ocean/pool", under, 0);
  const pinPark = applyPin(lex, new Set(), new Set(), "park").pinned;
  let indoorLeftover = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinPark, new Set(), mulberry32(189000 + i), 189000 + i));
    if (["tatami", "office chair", "gaming chair", "swivel chair", "shoji", "carpet"].some((t) => h.has(t))) {
      indoorLeftover += 1;
    }
  }
  eq("lockScene park never indoor floor/office chair", indoorLeftover, 0);
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.heats = ["activity"];
  s.weights = { activity: 1, tease: 0, flash: 0, sex: 0 };
  s.eras = ["modern"];
  s.lockScene = true;
  const pinCrawl = applyPin(lex, new Set(), new Set(), "crawling").pinned;
  let picnic = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinCrawl, new Set(), mulberry32(165000 + i), 165000 + i));
    if (h.has("picnic") || h.has("eating")) picnic += 1;
  }
  eq("crawling never auto picnic/eating", picnic, 0);
  const pinDance = applyPin(lex, new Set(), new Set(), "dancing").pinned;
  let study = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinDance, new Set(), mulberry32(166000 + i), 166000 + i));
    if (h.has("studying") || h.has("writing") || h.has("reading")) study += 1;
  }
  eq("dancing never auto studying/writing/reading", study, 0);
  const pinSquat = applyPin(lex, new Set(), new Set(), "squatting").pinned;
  let horse = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinSquat, new Set(), mulberry32(167000 + i), 167000 + i));
    if (h.has("horseback riding")) horse += 1;
  }
  eq("squatting never auto horseback riding", horse, 0);
  const pinFloat = applyPin(lex, new Set(), new Set(), "floating").pinned;
  const PLANTED = ["crawling", "all fours", "squatting", "standing", "kneeling", "on one knee", "seiza", "wariza", "indian style", "dancing"];
  let planted = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinFloat, new Set(), mulberry32(168000 + i), 168000 + i));
    if (PLANTED.some((t) => h.has(t))) planted += 1;
  }
  eq("floating never auto planted body poses", planted, 0);
  const pinGames = applyPin(lex, new Set(), new Set(), "playing games").pinned;
  let fours = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinGames, new Set(), mulberry32(170000 + i), 170000 + i));
    if (h.has("all fours") || h.has("crawling") || h.has("top-down bottom-up")) fours += 1;
  }
  eq("playing games never auto ground body", fours, 0);
  const pinDance2 = applyPin(lex, new Set(), new Set(), "dancing").pinned;
  let yoga = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinDance2, new Set(), mulberry32(171000 + i), 171000 + i));
    if (h.has("yoga") || h.has("stretching")) yoga += 1;
  }
  eq("dancing never auto yoga/stretching", yoga, 0);
}

{
  const s = settings();
  s.girl = false;
  s.boy = true;
  s.heats = ["tease"];
  s.weights = { activity: 0, tease: 1, flash: 0, sex: 0 };
  s.eras = ["modern"];
  s.sceneMode = "normal";
  s.lockScene = true;
  let race = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, new Set(), new Set(), mulberry32(172000 + i), 172000 + i));
    if ([...h].some((t) => lex.byTag.get(t)?.mutex === "race")) race += 1;
  }
  eq("normal mode never auto male race", race, 0);
  const pinDoc = applyPin(lex, new Set(), new Set(), "doctor").pinned;
  s.drawJob = true;
  let bath = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinDoc, new Set(), mulberry32(173000 + i), 173000 + i));
    if (["sento", "ofuro", "onsen", "bathroom", "bathtub"].some((t) => h.has(t))) bath += 1;
  }
  eq("normal doctor never auto bath place", bath, 0);
  const pinGuitar = applyPin(lex, new Set(), new Set(), "playing guitar").pinned;
  const lock = settings();
  lock.girl = true;
  lock.boy = false;
  lock.heats = ["activity"];
  lock.weights = { activity: 1, tease: 0, flash: 0, sex: 0 };
  lock.eras = ["modern"];
  lock.sceneMode = "diverse";
  lock.lockScene = true;
  lock.counts.env = 6;
  let guitarBath = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, lock, pinGuitar, new Set(), mulberry32(174000 + i), 174000 + i));
    if (["bathtub", "ofuro", "sento", "bathroom", "shower (place)"].some((t) => h.has(t))) guitarBath += 1;
  }
  eq("lockScene guitar never bath place", guitarBath, 0);
  const pinCook = applyPin(lex, new Set(), new Set(), "cooking").pinned;
  let dryCook = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, lock, pinCook, new Set(), mulberry32(179000 + i), 179000 + i));
    if (h.has("cooking") && !h.has("kitchen")) dryCook += 1;
  }
  eq("lockScene cooking always has kitchen", dryCook, 0);
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.heats = ["activity"];
  s.weights = { activity: 1, tease: 0, flash: 0, sex: 0 };
  s.sceneMode = "normal";
  s.lockScene = true;
  s.counts.env = 6;
  const pinStudy = applyPin(lex, new Set(), new Set(), "studying").pinned;
  const med = { ...s, eras: ["medieval"] };
  let studyCastle = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, med, pinStudy, new Set(), mulberry32(185000 + i), 185000 + i));
    if (["castle", "beach", "onsen", "ocean", "underwater"].some((t) => h.has(t))) studyCastle += 1;
  }
  eq("normal studying never castle/beach/onsen", studyCastle, 0);
  const pinVg = applyPin(lex, new Set(), new Set(), "playing video games").pinned;
  const mod = { ...s, eras: ["modern"] };
  let vgOut = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, mod, pinVg, new Set(), mulberry32(186000 + i), 186000 + i));
    if (["beach", "castle", "onsen", "street", "forest", "ocean"].some((t) => h.has(t))) vgOut += 1;
  }
  eq("normal video games never outdoor/bath places", vgOut, 0);
  const pinEat = applyPin(lex, new Set(), new Set(), "eating").pinned;
  let eatWet = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, mod, pinEat, new Set(), mulberry32(187000 + i), 187000 + i));
    if (["shower (place)", "underwater", "ocean", "pool"].some((t) => h.has(t))) eatWet += 1;
  }
  eq("normal eating never shower/underwater/pool", eatWet, 0);
  const pinRead = applyPin(lex, new Set(), new Set(), "reading").pinned;
  const READ_OK = [
    "library",
    "bedroom",
    "living room",
    "cafe",
    "classroom",
    "park bench",
    "garden",
    "shrine",
    "pavilion",
    "office",
    "train",
    "train interior",
  ];
  let readMiss = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, mod, pinRead, new Set(), mulberry32(188000 + i), 188000 + i));
    if (!READ_OK.some((t) => h.has(t))) readMiss += 1;
  }
  eq("normal reading always has a reading place", readMiss, 0);
}

{
  eq("drawJob defaults off", defaultSettings(data).drawJob, false);
  eq("sanitize keeps drawJob on", sanitizeSettings({ drawJob: true }, data).drawJob, true);
  const off = settings();
  off.girl = true;
  off.boy = false;
  off.heats = ["tease"];
  off.weights = { activity: 0, tease: 1, flash: 0, sex: 0 };
  off.eras = ["modern"];
  off.drawJob = false;
  let jobsOff = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, off, new Set(), new Set(), mulberry32(146000 + i), 146000 + i));
    if ([...h].some((t) => lex.byTag.get(t)?.mutex === "job")) jobsOff += 1;
  }
  eq("drawJob off does not auto-draw a job", jobsOff, 0);
  const on = { ...off, drawJob: true };
  let jobsOn = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, on, new Set(), new Set(), mulberry32(147000 + i), 147000 + i));
    if ([...h].some((t) => lex.byTag.get(t)?.mutex === "job")) jobsOn += 1;
  }
  ok("drawJob on usually draws a job", jobsOn >= 32, `jobs=${jobsOn}/40`);
}

{
  ok("builtin presets exist", BUILTIN_PRESETS.length >= 4);
  const ol = BUILTIN_PRESETS.find((p) => p.id === "ol-office");
  const haveBoobs = applyPin(lex, new Set(), new Set(), "huge breasts").pinned;
  ok("huge breasts pin sticks", haveBoobs.has("huge breasts"));
  const pool = BUILTIN_PRESETS.find((p) => p.id === "pool");
  const merged = applyPresetTags(lex, pool.tags, haveBoobs);
  ok("pool preset keeps huge breasts", merged.has("huge breasts"));
  ok("pool preset pins pool", merged.has("pool"));
  ok("pool preset pins swimming", merged.has("swimming"));
  const haveRoom = applyPin(lex, haveBoobs, new Set(), "living room").pinned;
  const merged2 = applyPresetTags(lex, pool.tags, haveRoom);
  ok("pool preset drops living room", !merged2.has("living room") && merged2.has("huge breasts"));
  const haveDress = applyPin(lex, haveBoobs, new Set(), "evening gown").pinned;
  const merged3 = applyPresetTags(lex, pool.tags, haveDress);
  ok("pool preset drops evening gown", !merged3.has("evening gown") && merged3.has("huge breasts"));
  ok("pool preset starts active", presetActive(lex, pool.tags, merged));
  ok("huge breasts only is not pool-active", !presetActive(lex, pool.tags, haveBoobs));
  const cleared = clearPresetTags(lex, pool.tags, merged);
  ok("clear pool keeps huge breasts", cleared.has("huge breasts"));
  ok("clear pool drops pool", !cleared.has("pool"));
  ok("clear pool drops swimming", !cleared.has("swimming"));
  ok("cleared pool is not active", !presetActive(lex, pool.tags, cleared));
  const togOn = togglePresetTags(lex, pool.tags, haveBoobs);
  ok("toggle on pins pool", togOn.has("pool") && togOn.has("huge breasts"));
  const togOff = togglePresetTags(lex, pool.tags, togOn);
  ok("toggle off drops pool keeps boobs", !togOff.has("pool") && !togOff.has("swimming") && togOff.has("huge breasts"));
  {
    const cabin = BUILTIN_PRESETS.find((p) => p.id === "cabin");
    const xmas = BUILTIN_PRESETS.find((p) => p.id === "xmas");
    const hoops = BUILTIN_PRESETS.find((p) => p.id === "hoops");
    const cabinOn = togglePresetTags(lex, cabin.tags, haveBoobs);
    const xmasOn = togglePresetTags(lex, xmas.tags, cabinOn);
    ok("switching preset drops previous combo", !xmasOn.has("flight attendant") && !xmasOn.has("airplane interior"));
    ok("switching preset keeps identity", xmasOn.has("huge breasts") && xmasOn.has("santa costume"));
    ok("only new preset is active", !presetActive(lex, cabin.tags, xmasOn) && presetActive(lex, xmas.tags, xmasOn));
    const cabinOn2 = togglePresetTags(lex, cabin.tags, haveBoobs);
    const hoopsOn = togglePresetTags(lex, hoops.tags, cabinOn2);
    ok("court preset drops cabin from POS", !hoopsOn.has("flight attendant") && !hoopsOn.has("airplane interior") && hoopsOn.has("basketball court") && hoopsOn.has("huge breasts"));
    ok("only court preset is active", !presetActive(lex, cabin.tags, hoopsOn) && presetActive(lex, hoops.tags, hoopsOn));
    const hoopsOff = togglePresetTags(lex, hoops.tags, hoopsOn);
    ok("second click drops the only preset", !hoopsOff.has("basketball court") && hoopsOff.has("huge breasts") && !presetActive(lex, hoops.tags, hoopsOff));
  }
  {
    const sClear = settings();
    sClear.girl = true;
    sClear.boy = false;
    sClear.heats = ["activity"];
    sClear.weights = { activity: 1, tease: 0, flash: 0, sex: 0 };
    sClear.eras = ["modern"];
    sClear.sceneMode = "normal";
    let forced = 0;
    for (let i = 0; i < 20; i++) {
      const h = tagsOf(drawOne(lex, sClear, togOff, new Set(), mulberry32(275000 + i), 275000 + i));
      if (h.has("pool") && h.has("swimming")) forced += 1;
    }
    ok("cleared pool combo is not forced into every POS", forced < 16, `both=${forced}/20`);
  }
  const olPins = applyPresetTags(lex, ol.tags);
  ok("OL preset pins office lady", olPins.has("office lady"));
  ok("OL preset pins pantyhose", olPins.has("pantyhose"));
  ok("OL preset pins office", olPins.has("office"));
  const onsen = BUILTIN_PRESETS.find((p) => p.id === "onsen");
  const onsenPins = applyPresetTags(lex, onsen.tags);
  ok("onsen preset pins onsen", onsenPins.has("onsen"));
  ok("onsen preset pins bathing", onsenPins.has("bathing"));
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.heats = ["activity"];
  s.weights = { activity: 1, tease: 0, flash: 0, sex: 0 };
  s.eras = ["modern"];
  s.sceneMode = "normal";
  s.lockScene = true;
  s.counts = { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 };
  const pinPool = applyPresetTags(lex, pool.tags, new Set());
  let badCloth = 0;
  for (let i = 0; i < 40; i++) {
    const d = drawOne(lex, s, pinPool, new Set(), mulberry32(198000 + i), 198000 + i);
    const cloth = d.sections.clothing.filter((t) => {
      const it = lex.byTag.get(t);
      if (!it || it.section !== "clothing" || it.layer !== "garment") return false;
      if (it.tag === "wet clothes") return false;
      if (/\b(swimsuit|bikini)\b/.test(it.tag)) return false;
      if ((it.implies || []).some((x) => /\b(swimsuit|bikini)\b/.test(x))) return false;
      return true;
    });
    if (cloth.length) badCloth += 1;
  }
  eq("normal pool preset never auto office/armor garments", badCloth, 0);

  function presetBad(id, seed, isBad) {
    const p = BUILTIN_PRESETS.find((x) => x.id === id);
    const pin = applyPresetTags(lex, p.tags, new Set());
    let n = 0;
    for (let i = 0; i < 40; i++) {
      const d = drawOne(lex, s, pin, new Set(), mulberry32(seed + i), seed + i);
      const cloth = d.sections.clothing.filter((t) => {
        const it = lex.byTag.get(t);
        if (!it || it.layer !== "garment") return false;
        return isBad(it.tag);
      });
      if (cloth.length) n += 1;
    }
    return n;
  }
  eq(
    "normal onsen never auto armor/suit/sneakers",
    presetBad("onsen", 199000, (t) => /\b(armor|suit|sneakers|boots|geta|idol clothes|latex)\b/.test(t)),
    0
  );
  eq(
    "normal classroom never auto swimsuit/armor/maid",
    presetBad("classroom", 200000, (t) => /\b(swimsuit|bikini|armor|maid)\b/.test(t)),
    0
  );
  eq(
    "normal OL never auto swimsuit/armor/maid",
    presetBad("ol-office", 201000, (t) => /\b(swimsuit|bikini|armor|maid|hakama)\b/.test(t)),
    0
  );
  eq(
    "normal nurse never auto swimsuit/armor/maid",
    presetBad("nurse", 202000, (t) => /\b(swimsuit|bikini|armor|maid|hakama|serafuku)\b/.test(t)),
    0
  );
  eq(
    "normal maid never auto swimsuit/armor/school uniform",
    presetBad("maid", 203000, (t) => /\b(swimsuit|bikini|armor|school uniform|police)\b/.test(t)),
    0
  );
  eq(
    "normal police never auto swimsuit/maid/hakama",
    presetBad("police", 204000, (t) => /\b(swimsuit|bikini|maid|hakama|armor)\b/.test(t)),
    0
  );
  eq(
    "normal beach never auto armor/suit",
    presetBad("beach", 205000, (t) => /\b(armor|suit|hakama)\b/.test(t) && !/\b(swimsuit|bikini)\b/.test(t)),
    0
  );
  eq(
    "normal onsen never auto gym/swimsuit/coat/sportswear",
    presetBad("onsen", 220000, (t) =>
      /\b(gym uniform|swimsuit|bikini|lab coat|sports bra|evening gown|necktie|hoodie|shirt)\b/.test(t) ||
      /fishnet/.test(t) ||
      /\bcoat\b/.test(t)
    ),
    0
  );
  eq(
    "normal classroom never auto wedding dress/hard hat",
    presetBad("classroom", 221000, (t) => /\b(wedding dress|hard hat)\b/.test(t)),
    0
  );
  eq(
    "normal nurse never auto wedding dress",
    presetBad("nurse", 223000, (t) => /\b(wedding dress)\b/.test(t)),
    0
  );
  {
    const pinMaid = applyPresetTags(lex, BUILTIN_PRESETS.find((p) => p.id === "maid").tags, new Set());
    let maidPlace = 0;
    const MAID_OK = ["mansion", "kitchen", "living room", "bedroom", "hotel room", "palace"];
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, s, pinMaid, new Set(), mulberry32(225000 + i), 225000 + i));
      const places = [...h].filter((t) => lex.byTag.get(t)?.mutex === "place" || lex.byTag.get(t)?.group === "place");
      if (places.length && !places.some((p) => MAID_OK.includes(p))) maidPlace += 1;
    }
    eq("normal maid preset stays in maid places", maidPlace, 0);
    const jobOn = { ...s, drawJob: true, heats: ["tease"], weights: { activity: 0, tease: 1, flash: 0, sex: 0 } };
    let otherJob = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, jobOn, pinMaid, new Set(), mulberry32(226000 + i), 226000 + i));
      if ([...h].some((t) => lex.byTag.get(t)?.mutex === "job")) otherJob += 1;
    }
    eq("pin maid never auto another job", otherJob, 0);
    const pinOnsen = applyPresetTags(lex, BUILTIN_PRESETS.find((p) => p.id === "onsen").tags, new Set());
    let bathChair = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, s, pinOnsen, new Set(), mulberry32(227000 + i), 227000 + i));
      if (["gaming chair", "office chair", "swivel chair"].some((t) => h.has(t))) bathChair += 1;
    }
    eq("normal onsen never auto office/gaming chairs", bathChair, 0);
    const pinDrive = applyPin(lex, new Set(), new Set(), "driving").pinned;
    let driveBody = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, s, pinDrive, new Set(), mulberry32(228000 + i), 228000 + i));
      if (["standing", "squatting", "kneeling", "on one knee", "sleeping", "all fours"].some((t) => h.has(t))) {
        driveBody += 1;
      }
    }
    eq("driving never auto planted/ground body", driveBody, 0);
    const pinHof3 = applyPin(lex, new Set(), new Set(), "head out of frame").pinned;
    const teaseHof = { ...s, heats: ["tease"], weights: { activity: 0, tease: 1, flash: 0, sex: 0 } };
    let hofSelfie = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, teaseHof, pinHof3, new Set(), mulberry32(229000 + i), 229000 + i));
      if (h.has("selfie") || h.has("taking picture")) hofSelfie += 1;
    }
    eq("head out of frame never auto selfie/taking picture", hofSelfie, 0);
    const sexHof = { ...s, girl: true, boy: true, heats: ["sex"], weights: { activity: 0, tease: 0, flash: 0, sex: 1 } };
    let hof69 = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, sexHof, pinHof3, new Set(), mulberry32(230000 + i), 230000 + i));
      if (["69", "kissing", "french kiss"].some((t) => h.has(t))) hof69 += 1;
    }
    eq("head out of frame never auto 69/kissing", hof69, 0);
    const pinSleep4 = applyPin(lex, new Set(), new Set(), "sleeping").pinned;
    let sleepGest = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, s, pinSleep4, new Set(), mulberry32(231000 + i), 231000 + i));
      if (
        ["ojou-sama pose", "paizuri gesture", "reaching towards viewer", "heart hands", "v", "recording"].some((t) =>
          h.has(t)
        )
      ) {
        sleepGest += 1;
      }
    }
    eq("sleeping never auto awake leftover gestures", sleepGest, 0);
    const pinPolice = applyPresetTags(lex, BUILTIN_PRESETS.find((p) => p.id === "police").tags, new Set());
    const policeSex = {
      ...s,
      heats: ["sex"],
      weights: { activity: 0, tease: 0, flash: 0, sex: 1 },
    };
    let policePublic = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, policeSex, pinPolice, new Set(), mulberry32(232000 + i), 232000 + i));
      if (["street", "city", "cityscape", "alley", "park", "beach"].some((t) => h.has(t))) policePublic += 1;
    }
    eq("normal police sex never auto public outdoor place", policePublic, 0);
    function presetAcc(id, seed, isBad) {
      const p = BUILTIN_PRESETS.find((x) => x.id === id);
      const pin = applyPresetTags(lex, p.tags, new Set());
      let n = 0;
      for (let i = 0; i < 40; i++) {
        const d = drawOne(lex, s, pin, new Set(), mulberry32(seed + i), seed + i);
        if (d.sections.clothing.some((t) => isBad(t))) n += 1;
      }
      return n;
    }
    eq(
      "normal onsen never auto police/nurse hat or beach umbrella",
      presetAcc("onsen", 233000, (t) => /\b(police hat|nurse cap|beach umbrella|helmet|innertube|umbrella)\b/.test(t)),
      0
    );
    eq(
      "normal pool never auto necktie/microphone/clipboard",
      presetAcc("pool", 234000, (t) => /\b(necktie|microphone|clipboard|hard hat|helmet)\b/.test(t)),
      0
    );
    eq(
      "normal beach never auto necktie/hard hat/microphone",
      presetAcc("beach", 235000, (t) => /\b(necktie|hard hat|microphone|helmet)\b/.test(t)),
      0
    );
    eq(
      "normal police never auto innertube/stethoscope/nurse cap",
      presetAcc("police", 236000, (t) => /\b(innertube|stethoscope|nurse cap|hard hat|helmet)\b/.test(t)),
      0
    );
    const pinHofRead = applyPin(lex, new Set(), new Set(), "head out of frame").pinned;
    let hofRead = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, s, pinHofRead, new Set(), mulberry32(237000 + i), 237000 + i));
      if (["reading", "studying", "writing", "washing hair", "adjusting hair", "cunnilingus", "oral"].some((t) => h.has(t))) hofRead += 1;
    }
    eq("head out of frame never auto reading/washing hair/oral", hofRead, 0);
    const pinOffice = applyPin(lex, new Set(), new Set(), "office").pinned;
    let washOffice = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, s, pinOffice, new Set(), mulberry32(238000 + i), 238000 + i));
      if (h.has("washing hair") || h.has("washing another's back") || h.has("washing body")) washOffice += 1;
    }
    eq("office never auto washing hair/body without water", washOffice, 0);
    const pinSleep5 = applyPin(lex, new Set(), new Set(), "sleeping").pinned;
    let sleepExpr = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, s, pinSleep5, new Set(), mulberry32(239000 + i), 239000 + i));
      if (["come hither", "scared", "angry", "naughty face", "ahegao"].some((t) => h.has(t))) sleepExpr += 1;
    }
    eq("sleeping never auto awake expressions", sleepExpr, 0);
    const pinCrawl = applyPin(lex, new Set(), new Set(), "crawling").pinned;
    let crawlChair = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, s, pinCrawl, new Set(), mulberry32(240000 + i), 240000 + i));
      if (h.has("on chair")) crawlChair += 1;
    }
    eq("crawling never auto on chair", crawlChair, 0);
    const pinSit = applyPin(lex, new Set(), new Set(), "sitting").pinned;
    let sitContra = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, s, pinSit, new Set(), mulberry32(241000 + i), 241000 + i));
      if (h.has("contrapposto")) sitContra += 1;
    }
    eq("sitting never auto contrapposto", sitContra, 0);
    let hofHead = 0;
    const sexHof2 = { ...s, girl: true, boy: true, heats: ["sex"], weights: { activity: 0, tease: 0, flash: 0, sex: 1 } };
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, sexHof2, pinHofRead, new Set(), mulberry32(242000 + i), 242000 + i));
      if (h.has("head tilt") || h.has("after fellatio") || h.has("after paizuri")) hofHead += 1;
    }
    eq("head out of frame never auto head tilt/after fellatio", hofHead, 0);
    const pinSeiza2 = applyPin(lex, new Set(), new Set(), "seiza").pinned;
    let seizaLegs = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, s, pinSeiza2, new Set(), mulberry32(243000 + i), 243000 + i));
      if (h.has("legs up")) seizaLegs += 1;
    }
    eq("seiza never auto legs up", seizaLegs, 0);
    eq(
      "normal onsen never auto high heels",
      presetAcc("onsen", 244000, (t) => t === "high heels"),
      0
    );

    let hofKiss = 0;
    const teaseHof2 = { ...s, heats: ["tease"], weights: { activity: 0, tease: 1, flash: 0, sex: 0 }, eras: ["medieval"] };
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, teaseHof2, pinHofRead, new Set(), mulberry32(248000 + i), 248000 + i));
      if (["closed mouth", "kiss", "breast focus"].some((t) => h.has(t))) hofKiss += 1;
    }
    eq("head out of frame never auto kiss/closed mouth/breast focus", hofKiss, 0);
    const pinCookMed = applyPin(lex, new Set(), new Set(), "cooking").pinned;
    const medCook = { ...s, eras: ["medieval"] };
    const COOK_OK = ["kitchen", "great hall", "castle", "palace"];
    let cookOut = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, medCook, pinCookMed, new Set(), mulberry32(249000 + i), 249000 + i));
      if (h.has("cooking") && !COOK_OK.some((t) => h.has(t))) cookOut += 1;
    }
    eq("medieval cooking always has an indoor cook place", cookOut, 0);
    const flashS = { ...s, heats: ["flash"], weights: { activity: 0, tease: 0, flash: 1, sex: 0 }, eras: ["victorian"] };
    let flashSleep = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, flashS, new Set(), new Set(), mulberry32(250000 + i), 250000 + i));
      if (h.has("sleeping")) flashSleep += 1;
    }
    eq("flash never auto sleeping", flashSleep, 0);
    let hofPhone = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, s, pinHofRead, new Set(), mulberry32(252000 + i), 252000 + i));
      if (h.has("talking on phone") || h.has("breast sucking")) hofPhone += 1;
    }
    eq("head out of frame never auto phone/breast sucking", hofPhone, 0);
    const pinKneel = applyPin(lex, new Set(), new Set(), "kneeling").pinned;
    let kneelChair = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, s, pinKneel, new Set(), mulberry32(253000 + i), 253000 + i));
      if (h.has("on chair")) kneelChair += 1;
    }
    eq("kneeling never auto on chair", kneelChair, 0);
    for (const lie of ["on back", "on stomach", "on side", "lying"]) {
      const pinLie = applyPin(lex, new Set(), new Set(), lie).pinned;
      let n = 0;
      for (let i = 0; i < 40; i++) {
        const h = tagsOf(drawOne(lex, s, pinLie, new Set(), mulberry32(282000 + i), 282000 + i));
        if (h.has("on chair")) n += 1;
      }
      eq(`${lie} never auto on chair`, n, 0);
    }
    const pinBathDance = applyPin(lex, new Set(), new Set(), "bathing").pinned;
    let bathDance = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, s, pinBathDance, new Set(), mulberry32(276000 + i), 276000 + i));
      if (h.has("dancing")) bathDance += 1;
    }
    eq("bathing never auto dancing", bathDance, 0);
    {
      function bodyGarments(h) {
        return [...h].filter((t) => {
          const it = lex.byTag.get(t);
          return it && it.section === "clothing" && it.layer === "garment";
        });
      }
      const pinOnsenNude = applyPresetTags(lex, onsen.tags, new Set());
      const onsenSex = {
        ...s,
        heats: ["sex"],
        weights: { activity: 0, tease: 0, flash: 0, sex: 1 },
      };
      let onsenNude = 0;
      let onsenClash = 0;
      for (let i = 0; i < 80; i++) {
        const h = tagsOf(drawOne(lex, onsenSex, pinOnsenNude, new Set(), mulberry32(271000 + i), 271000 + i));
        if (h.has("nude") || h.has("completely nude")) {
          onsenNude += 1;
          if (bodyGarments(h).length) onsenClash += 1;
        }
      }
      ok("normal onsen sex sometimes nudes", onsenNude >= 8, `nudes=${onsenNude}/80`);
      eq("onsen nude never stacks garments", onsenClash, 0);
      let onsenActNude = 0;
      for (let i = 0; i < 80; i++) {
        const h = tagsOf(drawOne(lex, s, pinOnsenNude, new Set(), mulberry32(272000 + i), 272000 + i));
        if (h.has("nude") || h.has("completely nude")) onsenActNude += 1;
      }
      ok("normal onsen activity sometimes nudes", onsenActNude >= 8, `nudes=${onsenActNude}/80`);
      const pinPoolNude = applyPresetTags(lex, pool.tags, new Set());
      let poolNude = 0;
      let poolClash = 0;
      for (let i = 0; i < 80; i++) {
        const h = tagsOf(drawOne(lex, onsenSex, pinPoolNude, new Set(), mulberry32(273000 + i), 273000 + i));
        if (h.has("nude") || h.has("completely nude")) {
          poolNude += 1;
          if (bodyGarments(h).length) poolClash += 1;
        }
      }
      ok("normal pool sex sometimes nudes", poolNude >= 5, `nudes=${poolNude}/80`);
      eq("pool nude never stacks garments", poolClash, 0);
      const pinOlNude = applyPresetTags(lex, ol.tags, new Set());
      let olNude = 0;
      for (let i = 0; i < 40; i++) {
        const h = tagsOf(drawOne(lex, onsenSex, pinOlNude, new Set(), mulberry32(274000 + i), 274000 + i));
        if (h.has("nude") || h.has("completely nude")) olNude += 1;
      }
      eq("normal OL preset never auto nude over pinned clothes", olNude, 0);
    }
    const ARMS = [
      "arms behind back",
      "arms behind head",
      "crossed arms",
      "heart hands",
      "v",
      "reaching towards viewer",
      "hands on own hips",
      "hands on own breasts",
      "hand in pocket",
      "index fingers together",
      "beckoning",
    ];
    let twoArms = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, s, new Set(), new Set(), mulberry32(254000 + i), 254000 + i));
      if (ARMS.filter((t) => h.has(t)).length > 1) twoArms += 1;
    }
    eq("pose10 never two leftover arm extras", twoArms, 0);
    function busyArms(pinTag, seed) {
      const pin = applyPin(lex, new Set(), new Set(), pinTag).pinned;
      let n = 0;
      for (let i = 0; i < 40; i++) {
        const h = tagsOf(drawOne(lex, s, pin, new Set(), mulberry32(seed + i), seed + i));
        if (ARMS.some((t) => h.has(t))) n += 1;
      }
      return n;
    }
    eq("playing guitar never auto busy-arm leftovers", busyArms("playing guitar", 255000), 0);
    eq("talking on phone never auto busy-arm leftovers", busyArms("talking on phone", 256000), 0);
    eq("writing never auto busy-arm leftovers", busyArms("writing", 257000), 0);
    eq("cooking never auto busy-arm leftovers", busyArms("cooking", 258000), 0);
    eq("eating never auto busy-arm leftovers", busyArms("eating", 259000), 0);
    eq("drawing never auto busy-arm leftovers", busyArms("drawing (action)", 260000), 0);
    eq("crawling never auto busy-arm leftovers", busyArms("crawling", 261000), 0);
    const sTease = { ...s, heats: ["tease"], weights: { activity: 0, tease: 1, flash: 0, sex: 0 } };
    const sFlash = { ...s, heats: ["flash"], weights: { activity: 0, tease: 0, flash: 1, sex: 0 } };
    function neverAuto(set, pinTag, bad, seed) {
      const pin = applyPin(lex, new Set(), new Set(), pinTag).pinned;
      let n = 0;
      for (let i = 0; i < 40; i++) {
        const h = tagsOf(drawOne(lex, set, pin, new Set(), mulberry32(seed + i), seed + i));
        if (bad.some((t) => h.has(t))) n += 1;
      }
      return n;
    }
    const LEGS = ["crossed legs", "legs up", "one knee up", "m legs"];
    let twoLegs = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, sTease, new Set(), new Set(), mulberry32(286000 + i), 286000 + i));
      if (LEGS.filter((t) => h.has(t)).length > 1) twoLegs += 1;
    }
    eq("pose10 never two leftover leg extras", twoLegs, 0);
    eq("crawling never auto crossed legs", neverAuto(sTease, "crawling", ["crossed legs"], 286040), 0);
    eq("all fours never auto crossed legs", neverAuto(sTease, "all fours", ["crossed legs"], 286080), 0);
    eq("top-down bottom-up never auto crossed legs", neverAuto(sTease, "top-down bottom-up", ["crossed legs"], 286120), 0);
    eq("crawling never auto legs up", neverAuto(sTease, "crawling", ["legs up"], 286160), 0);
    eq("kneeling never auto crossed legs", neverAuto(sTease, "kneeling", ["crossed legs"], 286200), 0);
    eq("on one knee never auto crossed legs", neverAuto(sTease, "on one knee", ["crossed legs"], 286240), 0);
    eq("squatting never auto legs up", neverAuto(sTease, "squatting", ["legs up"], 286280), 0);
    eq("seiza never auto crossed legs", neverAuto(sTease, "seiza", ["crossed legs"], 286320), 0);
    eq("indian style never auto one knee up", neverAuto(sTease, "indian style", ["one knee up"], 286360), 0);
    eq("dancing never auto crossed legs", neverAuto(sTease, "dancing", ["crossed legs"], 286400), 0);
    eq("dancing never auto legs up", neverAuto(sTease, "dancing", ["legs up"], 286440), 0);
    eq("standing never auto legs up", neverAuto(sTease, "standing", ["legs up", "m legs"], 286480), 0);
    eq("on back never auto leaning forward", neverAuto(sTease, "on back", ["leaning forward"], 286520), 0);
    eq("on stomach never auto leaning back", neverAuto(sTease, "on stomach", ["leaning back"], 286560), 0);
    eq("all fours never auto leaning back", neverAuto(sTease, "all fours", ["leaning back"], 286600), 0);
    eq("bathing never auto after bathing", neverAuto(sTease, "bathing", ["after bathing"], 286640), 0);
    eq("lower body never auto breast hold", neverAuto(sTease, "lower body", ["breast hold", "breastfeeding", "spread cleavage"], 286680), 0);
    eq("expressionless never auto wink", neverAuto(sTease, "expressionless", ["wink"], 286720), 0);
    eq("on back never auto bent over", neverAuto(sFlash, "on back", ["bent over"], 286760), 0);
    eq("overcast never auto blue sky", neverAuto(s, "overcast", ["blue sky"], 286800), 0);
    eq("overcast never auto starry sky", neverAuto(s, "overcast", ["starry sky"], 286840), 0);
    eq("rain never auto starry sky", neverAuto(s, "rain", ["starry sky"], 286880), 0);
    eq("head out of frame never auto singing", neverAuto(s, "head out of frame", ["singing", "karaoke"], 286920), 0);
    eq("hiking never auto kneeling", neverAuto(s, "hiking", ["kneeling", "on one knee"], 286960), 0);
    eq("eating never auto clenched teeth", neverAuto(s, "eating", ["clenched teeth"], 287000), 0);
    eq("driving never auto on chair", neverAuto(s, "driving", ["on chair"], 287040), 0);
    const pinSleepNew = applyPin(lex, new Set(), new Set(), "sleeping").pinned;
    let sleepExpr2 = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, sTease, pinSleepNew, new Set(), mulberry32(287080 + i), 287080 + i));
      if (["surprised", "embarrassed", "nervous"].some((t) => h.has(t))) sleepExpr2 += 1;
    }
    eq("sleeping never auto surprised/embarrassed/nervous", sleepExpr2, 0);
  }
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.heats = ["tease", "flash", "sex"];
  s.weights = { activity: 0, tease: 0.34, flash: 0.33, sex: 0.33 };
  s.eras = ["modern"];
  s.sceneMode = "weird";
  s.counts = { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 };
  let bothHair = 0;
  for (let i = 0; i < 80; i++) {
    const h = tagsOf(drawOne(lex, s, new Set(), new Set(), mulberry32(278000 + i), 278000 + i));
    const tex = ["straight hair", "wavy hair", "curly hair"].filter((t) => h.has(t));
    if (tex.length > 1) bothHair += 1;
  }
  eq("never two hair textures", bothHair, 0);
  const boyS = { ...s, girl: false, boy: true, sceneMode: "normal", heats: ["tease"], weights: { activity: 0, tease: 1, flash: 0, sex: 0 }, eras: ["edo"] };
  let ageClash = 0;
  for (let i = 0; i < 80; i++) {
    const h = tagsOf(drawOne(lex, boyS, new Set(), new Set(), mulberry32(279000 + i), 279000 + i));
    if (h.has("shota") && (h.has("mature male") || h.has("old man"))) ageClash += 1;
  }
  eq("never shota with mature/old man", ageClash, 0);
  const mixS = { ...s, girl: true, boy: true, sceneMode: "normal", heats: ["sex"], weights: { activity: 0, tease: 0, flash: 0, sex: 1 }, eras: ["edo"] };
  let mixNoBoy = 0;
  for (let i = 0; i < 80; i++) {
    const h = tagsOf(drawOne(lex, mixS, new Set(), new Set(), mulberry32(280000 + i), 280000 + i));
    if (h.has("mixed-sex bathing") && !h.has("1boy") && !h.has("2boys") && !h.has("multiple boys")) mixNoBoy += 1;
  }
  eq("mixed-sex bathing never without a boy", mixNoBoy, 0);
  {
    const h = tagsOf(drawOne(lex, mixS, new Set(), new Set(), mulberry32(710013), 710013));
    const bad = h.has("mixed-sex bathing") && !h.has("1boy") && !h.has("2boys") && !h.has("multiple boys");
    eq("seed 710013 mixed-sex bathing has a boy", bad, false);
  }
  const pinG = applyPin(lex, new Set(), new Set(), "playing guitar").pinned;
  const actS = { ...s, heats: ["activity"], weights: { activity: 1, tease: 0, flash: 0, sex: 0 }, sceneMode: "normal", eras: ["ancient_china"] };
  let hips = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, actS, pinG, new Set(), mulberry32(281000 + i), 281000 + i));
    if (h.has("hands on own hips")) hips += 1;
  }
  eq("playing guitar never auto hands on own hips", hips, 0);
  const cleaned = sanitizePinPresets(
    [
      { name: "  我的OL  ", tags: ["office lady", "not-a-tag"] },
      { name: "", tags: ["nurse"] },
      { tags: ["maid"] },
    ],
    lex
  );
  eq("sanitize preset name trimmed", cleaned[0].name, "我的OL");
  ok("sanitize drops unknown tags", cleaned[0].tags.includes("office lady") && !cleaned[0].tags.includes("not-a-tag"));
  eq("sanitize drops nameless presets", cleaned.length, 1);
}

{
  const need = [
    "airplane interior",
    "airport",
    "basketball court",
    "tennis court",
    "soccer field",
    "baseball stadium",
    "running track",
    "soccer ball",
    "basketball (object)",
    "tennis ball",
    "soccer uniform",
    "tennis uniform",
    "baseball uniform",
    "volleyball uniform",
    "buruma",
    "firefighter",
    "scientist",
    "construction worker",
    "rape",
    "small penis",
    "jogging",
    "skiing",
    "karaoke box",
    "convenience store",
    "movie theater",
    "church",
    "prison",
    "handcuffs",
  ];
  for (const t of need) eq(`lex has ${t}`, lex.byTag.has(t), true);
  const rapeIt = lex.byTag.get("rape");
  ok("rape is sex-heat only", !!(rapeIt && (rapeIt.heat || []).includes("sex") && !(rapeIt.heat || []).includes("activity")));
  eq("rape is not an activity mutex", rapeIt && rapeIt.mutex, null);
  // 場地不再 imply 球具：Danbooru 是「畫面看得到什麼才標什麼」，有球場不代表有球。
  // 這條 implies 會害使用者從必進 POS 移掉球之後又被自動加回來。
  const bb = applyPin(lex, new Set(), new Set(), "basketball court").pinned;
  ok("basketball court does not imply the ball", !bb.has("basketball (object)"));
  ok("basketball court still implies outdoors", bb.has("outdoors"));
  const sN = settings();
  sN.girl = true;
  sN.boy = true;
  sN.heats = ["sex"];
  sN.weights = { activity: 0, tease: 0, flash: 0, sex: 1 };
  sN.eras = ["modern"];
  sN.sceneMode = "normal";
  sN.counts = { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 };
  const pinRape = applyPin(lex, new Set(), new Set(), "rape").pinned;
  let rapeHome = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sN, pinRape, new Set(), mulberry32(310000 + i), 310000 + i));
    if (["classroom", "bedroom", "living room", "kitchen"].some((t) => h.has(t))) rapeHome += 1;
  }
  eq("normal rape never auto classroom/home daily", rapeHome, 0);
  const pinClass = applyPin(lex, new Set(), new Set(), "classroom").pinned;
  let classRape = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sN, pinClass, new Set(), mulberry32(310040 + i), 310040 + i));
    if (h.has("rape")) classRape += 1;
  }
  eq("normal classroom never auto rape", classRape, 0);
  const sAct = { ...sN, heats: ["activity"], weights: { activity: 1, tease: 0, flash: 0, sex: 0 } };
  let actRape = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sAct, new Set(), new Set(), mulberry32(310080 + i), 310080 + i));
    if (h.has("rape")) actRape += 1;
  }
  eq("activity heat never auto rape", actRape, 0);
  const pinCourt = applyPin(lex, new Set(), new Set(), "basketball court").pinned;
  let wrongBall = 0;
  let wrongWear = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sAct, pinCourt, new Set(), mulberry32(310120 + i), 310120 + i));
    if (["soccer ball", "tennis ball", "baseball (object)", "bowling ball"].some((t) => h.has(t))) wrongBall += 1;
    if (["soccer uniform", "tennis uniform", "baseball uniform"].some((t) => h.has(t))) wrongWear += 1;
  }
  eq("normal basketball court never auto other balls", wrongBall, 0);
  eq("normal basketball court never auto other sport uniforms", wrongWear, 0);
  const pinFa = applyPin(lex, new Set(), new Set(), "flight attendant").pinned;
  let faWrong = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sAct, pinFa, new Set(), mulberry32(310160 + i), 310160 + i));
    if (["classroom", "onsen", "kitchen", "pool"].some((t) => h.has(t))) faWrong += 1;
  }
  eq("normal flight attendant never auto classroom/onsen/kitchen/pool", faWrong, 0);
  {
    const cabin = BUILTIN_PRESETS.find((p) => p.id === "cabin");
    const pinCabin = applyPresetTags(lex, cabin.tags, new Set());
    const sSex = { ...sAct, heats: ["sex"], weights: { activity: 0, tease: 0, flash: 0, sex: 1 } };
    let cabinGolf = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, sSex, pinCabin, new Set(), mulberry32(311200 + i), 311200 + i));
      if (["golf course", "golf ball", "golf club"].some((t) => h.has(t))) cabinGolf += 1;
    }
    eq("normal sex cabin never auto golf", cabinGolf, 0);
  }
  eq("skiing never auto tennis kit", neverAuto2(sAct, "skiing", ["tennis uniform", "tennis ball", "tennis racket"], 311240), 0);
  {
    const nurse = BUILTIN_PRESETS.find((p) => p.id === "nurse");
    const pinN = applyPresetTags(lex, nurse.tags, new Set());
    let n = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, sAct, pinN, new Set(), mulberry32(311280 + i), 311280 + i));
      if (["baseball uniform", "soccer uniform", "tennis uniform", "cheerleader"].some((t) => h.has(t))) n += 1;
    }
    eq("normal nurse never auto sport uniforms", n, 0);
  }
  const pinJog = applyPin(lex, new Set(), new Set(), "jogging").pinned;
  let jogSleep = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sAct, pinJog, new Set(), mulberry32(310200 + i), 310200 + i));
    if (h.has("sleeping")) jogSleep += 1;
  }
  eq("jogging never auto sleeping", jogSleep, 0);
  const pinSmall = applyPin(lex, new Set(["huge penis"]), new Set(), "small penis").pinned;
  ok("small penis mutex huge penis", pinSmall.has("small penis") && !pinSmall.has("huge penis"));
  function neverAuto2(set, pinTag, bad, seed) {
    const pin = applyPin(lex, new Set(), new Set(), pinTag).pinned;
    let n = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, set, pin, new Set(), mulberry32(seed + i), seed + i));
      if (bad.some((t) => h.has(t))) n += 1;
    }
    return n;
  }
  eq("diving never auto seiza", neverAuto2(sAct, "diving", ["seiza", "wariza", "indian style"], 310240), 0);
  eq("after bathing never auto diving", neverAuto2(sN, "after bathing", ["diving"], 310280), 0);
  eq("indoors never auto campfire", neverAuto2(sAct, "office", ["campfire"], 310320), 0);
  eq("outdoors never auto bunk bed", neverAuto2(sAct, "shrine", ["bunk bed"], 310360), 0);
  eq("jogging never auto kneeling", neverAuto2(sAct, "jogging", ["kneeling", "on one knee"], 310400), 0);
  eq("jogging never auto sitting", neverAuto2(sAct, "jogging", ["sitting", "squatting", "on chair"], 310480), 0);
  eq("skiing never auto sitting", neverAuto2(sAct, "skiing", ["sitting", "kneeling", "on chair"], 310520), 0);
  eq("weightlifting never auto lying", neverAuto2(sAct, "weightlifting", ["lying", "on back", "on stomach", "on side"], 310560), 0);
  eq("dancing never auto shopping", neverAuto2(sAct, "dancing", ["shopping"], 310600), 0);
  eq("dancing never auto weightlifting", neverAuto2(sAct, "dancing", ["weightlifting"], 310640), 0);
  eq("head out of frame never auto smoking", neverAuto2(sAct, "head out of frame", ["smoking"], 310680), 0);
  eq("hiking never auto sitting", neverAuto2(sAct, "hiking", ["sitting", "squatting", "on chair"], 310720), 0);
  eq("crawling never auto talking on phone", neverAuto2(sAct, "crawling", ["talking on phone"], 310760), 0);
  eq("drinking never auto busy-arm leftovers", neverAuto2(sAct, "drinking", ["arms behind head", "arms behind back", "crossed arms"], 310800), 0);
  eq("closed eyes never auto reading", neverAuto2(sAct, "closed eyes", ["reading", "studying"], 310840), 0);
  eq("after bathing never auto washing body", neverAuto2(sN, "after bathing", ["washing body", "splashing"], 310880), 0);
  eq("heart hands never auto clothes tug", neverAuto2(sAct, "heart hands", ["clothes tug", "paizuri gesture", "breast hold"], 310920), 0);
  eq("taking picture never auto arms behind back", neverAuto2(sAct, "taking picture", ["arms behind back", "crossed arms"], 310960), 0);
  const sTease2 = { ...sAct, heats: ["tease"], weights: { activity: 0, tease: 1, flash: 0, sex: 0 } };
  eq("lower body never auto nipple slip", neverAuto2(sTease2, "lower body", ["nipple slip", "areola slip", "breast suppress"], 311000), 0);
  eq("closed eyes never auto writing", neverAuto2(sAct, "closed eyes", ["writing", "drawing (action)", "playing games"], 311040), 0);
  eq("playing games never auto heart hands", neverAuto2(sAct, "playing games", ["heart hands", "hands on own hips", "arms behind back"], 311080), 0);
  eq("horseback riding never auto on chair", neverAuto2(sAct, "horseback riding", ["on chair"], 311120), 0);
  eq("on stomach never auto m legs", neverAuto2(sTease2, "on stomach", ["m legs"], 311160), 0);
  eq("all fours never auto breasts on table", neverAuto2(sTease2, "all fours", ["breasts on table", "breasts on glass"], 311320), 0);
  eq("sleeping never auto breasts on table", neverAuto2(sTease2, "sleeping", ["breasts on table"], 311360), 0);
  eq("smoking never auto crossed arms", neverAuto2(sAct, "smoking", ["crossed arms", "arms behind back"], 311400), 0);
  eq("lying never auto shopping", neverAuto2(sAct, "lying", ["shopping"], 311440), 0);
  eq("on stomach never auto playing guitar", neverAuto2(sAct, "on stomach", ["playing guitar"], 311480), 0);
  eq("expressionless never auto rolling eyes", neverAuto2(sTease2, "expressionless", ["rolling eyes"], 311520), 0);
  eq("driving never auto legs up", neverAuto2(sAct, "driving", ["legs up"], 311560), 0);
  eq("seiza never auto shopping", neverAuto2(sAct, "seiza", ["shopping"], 311600), 0);
  eq("riding bicycle never auto hands on own hips", neverAuto2(sAct, "riding bicycle", ["hands on own hips"], 311640), 0);
  {
    const sSex2 = { ...sAct, heats: ["sex"], weights: { activity: 0, tease: 0, flash: 0, sex: 1 } };
    eq("skiing never auto amazon position", neverAuto2(sSex2, "skiing", ["amazon position", "masturbation"], 311680), 0);
  }
  const pinUni = applyPin(lex, new Set(), new Set(), "basketball uniform").pinned;
  let uniBall = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sAct, pinUni, new Set(), mulberry32(310440 + i), 310440 + i));
    if (["soccer ball", "bowling ball", "tennis ball", "baseball (object)"].some((t) => h.has(t))) uniBall += 1;
  }
  eq("normal basketball uniform never auto other balls", uniBall, 0);
  for (const id of ["cabin", "cinema", "conveni", "church-nun", "hoops", "tennis", "soccer", "baseball", "fire", "prison"]) {
    const p = BUILTIN_PRESETS.find((x) => x.id === id);
    ok(`preset ${id} exists`, !!p);
    if (p) {
      const pins = applyPresetTags(lex, p.tags);
      ok(`preset ${id} pins its tags`, p.tags.every((t) => pins.has(t)));
    }
  }
}

{
  const s = settings();
  s.girl = true;
  s.boy = false;
  s.heats = ["activity"];
  s.weights = { activity: 1, tease: 0, flash: 0, sex: 0 };
  s.eras = ["modern"];
  s.sceneMode = "normal";
  s.lockScene = true;
  s.counts = { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 };
  const waterOffice = (t) =>
    /\b(armor|suit|blazer|lab coat|hakama|cheerleader)\b/.test(t) && !/\b(swimsuit|bikini)\b/.test(t);
  const pinSwim = applyPin(lex, new Set(), new Set(), "swimming").pinned;
  let swimArmor = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinSwim, new Set(), mulberry32(430000 + i), 430000 + i));
    if ([...h].some(waterOffice)) swimArmor += 1;
  }
  eq("pinned swimming never leftover armor/suit/cheerleader", swimArmor, 0);
  const sDiv = { ...s, sceneMode: "diverse" };
  let divArmor = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sDiv, pinSwim, new Set(), mulberry32(430040 + i), 430040 + i));
    if ([...h].some(waterOffice)) divArmor += 1;
  }
  eq("diverse swimming never leftover armor/suit/cheerleader", divArmor, 0);
  const pinCook = applyPin(lex, new Set(), new Set(), "cooking").pinned;
  const sChina = { ...s, eras: ["ancient_china"] };
  const COOK_PLACE = ["kitchen", "great hall", "castle", "palace"];
  let dryChina = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sChina, pinCook, new Set(), mulberry32(430080 + i), 430080 + i));
    if (h.has("cooking") && !COOK_PLACE.some((t) => h.has(t))) dryChina += 1;
  }
  eq("ancient_china cooking always has a cook place", dryChina, 0);
  const sSex = { ...s, heats: ["sex"], weights: { activity: 0, tease: 0, flash: 0, sex: 1 } };
  let drySex = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sSex, pinCook, new Set(), mulberry32(430120 + i), 430120 + i));
    if (h.has("cooking") && !h.has("kitchen")) drySex += 1;
  }
  eq("sex heat cooking always has kitchen", drySex, 0);
  const pinBath = applyPin(lex, new Set(), new Set(), "bathing").pinned;
  let bathSuit = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sDiv, pinBath, new Set(), mulberry32(430160 + i), 430160 + i));
    if ([...h].some((t) => /\b(suit|armor|blazer|sneakers|boots)\b/.test(t))) bathSuit += 1;
  }
  eq("diverse bathing never leftover suit/armor/shoes", bathSuit, 0);
  let cheerPin = applyPin(lex, new Set(), new Set(), "cheerleader").pinned;
  cheerPin = applyPin(lex, cheerPin, new Set(), "pool").pinned;
  let keptCheer = 0;
  for (let i = 0; i < 20; i++) {
    const h = tagsOf(drawOne(lex, s, cheerPin, new Set(), mulberry32(430200 + i), 430200 + i));
    if (h.has("cheerleader")) keptCheer += 1;
  }
  eq("pinned cheerleader at pool stays", keptCheer, 20);
  const pinPool = applyPresetTags(lex, BUILTIN_PRESETS.find((p) => p.id === "pool").tags, new Set());
  let autoCheer = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinPool, new Set(), mulberry32(430220 + i), 430220 + i));
    if (h.has("cheerleader")) autoCheer += 1;
  }
  eq("pool preset never auto cheerleader", autoCheer, 0);
  const pinTable = applyPin(lex, new Set(), new Set(), "breasts on table").pinned;
  let tableOut = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sDiv, pinTable, new Set(), mulberry32(430260 + i), 430260 + i));
    if (h.has("outdoors") && !h.has("indoors")) tableOut += 1;
  }
  eq("breasts on table never leftover outdoors without indoors", tableOut, 0);
  const sWeird = { ...s, sceneMode: "weird", lockScene: false, heats: ["tease"], weights: { activity: 0, tease: 1, flash: 0, sex: 0 } };
  const pinPlane = applyPin(lex, new Set(), new Set(), "airplane interior").pinned;
  let divePlane = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sWeird, pinPlane, new Set(), mulberry32(431000 + i), 431000 + i));
    if (["swimming", "diving", "wading"].some((t) => h.has(t))) divePlane += 1;
  }
  eq("weird airplane never auto swim/dive/wade", divePlane, 0);
  const pinCinema = applyPin(lex, new Set(), new Set(), "movie theater").pinned;
  const sWeirdAct = { ...sWeird, heats: ["activity"], weights: { activity: 1, tease: 0, flash: 0, sex: 0 } };
  let horseCinema = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sWeirdAct, pinCinema, new Set(), mulberry32(431040 + i), 431040 + i));
    if (h.has("horseback riding")) horseCinema += 1;
  }
  eq("weird movie theater never auto horseback", horseCinema, 0);
  const pinSki = applyPin(lex, new Set(), new Set(), "skiing").pinned;
  let maidSki = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinSki, new Set(), mulberry32(431080 + i), 431080 + i));
    if (h.has("maid")) maidSki += 1;
  }
  eq("normal skiing never auto maid", maidSki, 0);
  const pinDojo = applyPin(lex, new Set(), new Set(), "dojo").pinned;
  let ballDojo = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinDojo, new Set(), mulberry32(431120 + i), 431120 + i));
    if (["basketball uniform", "tennis uniform", "soccer uniform"].some((t) => h.has(t))) ballDojo += 1;
  }
  eq("normal dojo never auto ball uniforms", ballDojo, 0);
  const pinPrison = applyPin(lex, new Set(), new Set(), "prison").pinned;
  let bunnyPrison = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinPrison, new Set(), mulberry32(431160 + i), 431160 + i));
    if (["playboy bunny", "idol clothes", "cheerleader"].some((t) => h.has(t))) bunnyPrison += 1;
  }
  eq("normal prison never auto bunny/idol/cheerleader", bunnyPrison, 0);
  const pinSleep = applyPin(lex, new Set(), new Set(), "sleeping").pinned;
  let sleepCity = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinSleep, new Set(), mulberry32(431200 + i), 431200 + i));
    if (["city", "cityscape", "street"].some((t) => h.has(t))) sleepCity += 1;
  }
  eq("normal sleeping never auto city/street", sleepCity, 0);
  const pinBiki = applyPin(lex, new Set(), new Set(), "bikini").pinned;
  const sTease = { ...s, heats: ["tease"], weights: { activity: 0, tease: 1, flash: 0, sex: 0 } };
  let pocketBiki = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sTease, pinBiki, new Set(), mulberry32(431240 + i), 431240 + i));
    if (h.has("hand in pocket")) pocketBiki += 1;
  }
  eq("bikini never auto hand in pocket", pocketBiki, 0);
  const pinFinger = applyPin(lex, new Set(), new Set(), "fingering").pinned;
  const sSexWeird = { ...s, heats: ["sex"], weights: { activity: 0, tease: 0, flash: 0, sex: 1 }, sceneMode: "weird", lockScene: false };
  let armsFinger = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sSexWeird, pinFinger, new Set(), mulberry32(431280 + i), 431280 + i));
    if (h.has("arms under breasts") || h.has("arms behind back") || h.has("heart hands")) armsFinger += 1;
  }
  eq("fingering never auto both-arms poses", armsFinger, 0);
  let panNoCook = 0;
  for (let i = 0; i < 80; i++) {
    const h = tagsOf(drawOne(lex, s, new Set(), new Set(), mulberry32(431320 + i), 431320 + i));
    if (h.has("frying pan") && !h.has("cooking")) panNoCook += 1;
  }
  eq("frying pan never without cooking", panNoCook, 0);
  const pinFish = applyPin(lex, new Set(), new Set(), "fishing").pinned;
  let fishFeet = 0;
  for (let i = 0; i < 80; i++) {
    const h = tagsOf(drawOne(lex, s, pinFish, new Set(), mulberry32(440000 + i), 440000 + i));
    if (["boots", "sandals", "shoes", "sneakers"].some((t) => h.has(t))) fishFeet += 1;
  }
  ok("pinned fishing can still draw boots/sandals/shoes", fishFeet > 0, `feet=${fishFeet}/80`);
  const pinSleep2 = applyPin(lex, new Set(), new Set(), "sleeping").pinned;
  const SLEEP_BAD = [
    "tennis court",
    "soccer field",
    "pool",
    "classroom",
    "office",
    "running track",
    "boxing ring",
    "skyscraper",
    "golf course",
    "rice paddy",
    "basketball court",
  ];
  let sleepBad = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinSleep2, new Set(), mulberry32(440080 + i), 440080 + i));
    if (SLEEP_BAD.some((t) => h.has(t))) sleepBad += 1;
  }
  eq("normal sleeping never auto sport/work places", sleepBad, 0);
  const pinDrive2 = applyPin(lex, new Set(), new Set(), "driving").pinned;
  let driveSwim = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinDrive2, new Set(), mulberry32(440120 + i), 440120 + i));
    if ([...h].some((t) => /\b(bikini|swimsuit)\b/.test(t))) driveSwim += 1;
  }
  eq("normal driving never leftover swimsuit", driveSwim, 0);
  const pinCookLap = applyPin(lex, new Set(), new Set(), "cooking").pinned;
  let cookLap = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinCookLap, new Set(), mulberry32(440160 + i), 440160 + i));
    if (h.has("sitting on lap") || h.has("straddling")) cookLap += 1;
  }
  eq("cooking never auto sitting on lap/straddling", cookLap, 0);
  function leftoverSwim(pinTag, seed) {
    const p = applyPin(lex, new Set(), new Set(), pinTag).pinned;
    let n = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, s, p, new Set(), mulberry32(seed + i), seed + i));
      if ([...h].some((t) => /\b(bikini|swimsuit)\b/.test(t))) n += 1;
    }
    return n;
  }
  eq("normal karaoke never leftover swimsuit", leftoverSwim("karaoke", 440200), 0);
  eq("normal cafe never leftover swimsuit", leftoverSwim("cafe", 440240), 0);
  eq("normal restaurant never leftover swimsuit", leftoverSwim("restaurant", 440280), 0);
  eq("normal shopping never leftover swimsuit", leftoverSwim("shopping", 440320), 0);
  const sTeaseN = { ...s, heats: ["tease"], weights: { activity: 0, tease: 1, flash: 0, sex: 0 } };
  const pinSleep3 = applyPin(lex, new Set(), new Set(), "sleeping").pinned;
  let sleepSwim = 0;
  let sleepSuit = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sTeaseN, pinSleep3, new Set(), mulberry32(440360 + i), 440360 + i));
    if ([...h].some((t) => /\b(bikini|swimsuit)\b/.test(t))) sleepSwim += 1;
    if ([...h].some((t) => /\b(wedding dress|evening gown|power armor)\b/.test(t))) sleepSuit += 1;
  }
  eq("normal sleeping never leftover swimsuit", sleepSwim, 0);
  eq("normal sleeping never leftover wedding dress/evening gown", sleepSuit, 0);
  const pinFish2 = applyPin(lex, new Set(), new Set(), "fishing").pinned;
  let fishStand = 0;
  let fishFeet2 = 0;
  for (let i = 0; i < 80; i++) {
    const h = tagsOf(drawOne(lex, s, pinFish2, new Set(), mulberry32(440400 + i), 440400 + i));
    if (h.has("standing")) fishStand += 1;
    if (["boots", "sandals", "shoes", "sneakers"].some((t) => h.has(t))) fishFeet2 += 1;
  }
  ok("pinned fishing can stand", fishStand > 0, `stand=${fishStand}/80`);
  ok("pinned fishing can draw boots/sandals/shoes after swim-unlock", fishFeet2 > 0, `feet=${fishFeet2}/80`);
  const pinCamp = applyPin(lex, new Set(), new Set(), "camping").pinned;
  let campTent = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinCamp, new Set(), mulberry32(440480 + i), 440480 + i));
    if (h.has("tent")) campTent += 1;
  }
  ok("pinned camping can draw tent", campTent > 0, `tent=${campTent}/40`);
  const sMed = { ...s, eras: ["medieval"] };
  const pinPal = applyPin(lex, new Set(), new Set(), "palace").pinned;
  let palArmor = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sMed, pinPal, new Set(), mulberry32(440520 + i), 440520 + i));
    if ([...h].some((t) => /\barmor\b/.test(t))) palArmor += 1;
  }
  ok("medieval palace can still have armor", palArmor > 0, `armor=${palArmor}/40`);
  const pinLock = applyPin(lex, new Set(), new Set(), "locker room").pinned;
  let lockSwim = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinLock, new Set(), mulberry32(440560 + i), 440560 + i));
    if ([...h].some((t) => /\b(bikini|swimsuit)\b/.test(t))) lockSwim += 1;
  }
  ok("locker room can draw swimsuit", lockSwim > 0, `swim=${lockSwim}/40`);
  const pinBeach = applyPin(lex, new Set(), new Set(), "beach").pinned;
  let beachCasual = 0;
  let beachSuit = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinBeach, new Set(), mulberry32(440600 + i), 440600 + i));
    if (["sundress", "shirt", "white shirt", "school uniform"].some((t) => h.has(t))) beachCasual += 1;
    if ([...h].some((t) => /\b(armor|suit)\b/.test(t) && !/swimsuit/.test(t))) beachSuit += 1;
  }
  ok("beach can draw sundress/shirt/school uniform", beachCasual > 0, `casual=${beachCasual}/40`);
  eq("beach never leftover armor/suit", beachSuit, 0);
  const pinWade = applyPin(lex, new Set(), new Set(), "wading").pinned;
  let wadeStand = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinWade, new Set(), mulberry32(440640 + i), 440640 + i));
    if (h.has("standing")) wadeStand += 1;
  }
  ok("pinned wading can stand", wadeStand > 0, `stand=${wadeStand}/40`);
  const pinBathLie = applyPin(lex, new Set(), new Set(), "bathing").pinned;
  const sTeaseB = { ...s, heats: ["tease"], weights: { activity: 0, tease: 1, flash: 0, sex: 0 } };
  let bathLie = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sTeaseB, pinBathLie, new Set(), mulberry32(440680 + i), 440680 + i));
    if (["lying", "on back", "reclining"].some((t) => h.has(t))) bathLie += 1;
  }
  ok("pinned bathing can lie/recline", bathLie > 0, `lie=${bathLie}/40`);
  const pinCookStand = applyPin(lex, new Set(), new Set(), "cooking").pinned;
  let cookStand = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinCookStand, new Set(), mulberry32(440720 + i), 440720 + i));
    if (h.has("standing")) cookStand += 1;
  }
  ok("pinned cooking can stand", cookStand > 0, `stand=${cookStand}/40`);
  const pinClean = applyPin(lex, new Set(), new Set(), "cleaning").pinned;
  let cleanStand = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinClean, new Set(), mulberry32(440760 + i), 440760 + i));
    if (h.has("standing")) cleanStand += 1;
  }
  ok("pinned cleaning can stand", cleanStand > 0, `stand=${cleanStand}/40`);
  const pinCarry = applyPin(lex, new Set(), new Set(), "carrying").pinned;
  let carryStand = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinCarry, new Set(), mulberry32(440800 + i), 440800 + i));
    if (h.has("standing")) carryStand += 1;
  }
  ok("pinned carrying can stand", carryStand > 0, `stand=${carryStand}/40`);
  const sJob = { ...s, drawJob: true };
  const pinKit = applyPin(lex, new Set(), new Set(), "kitchen").pinned;
  let kitMaid = 0;
  // maid 在這組設定下本來就稀有（約 0.9%），80 個 seed 的窗口太容易整段落空。
  for (let i = 0; i < 400; i++) {
    const h = tagsOf(drawOne(lex, sJob, pinKit, new Set(), mulberry32(440840 + i), 440840 + i));
    if (h.has("maid")) kitMaid += 1;
  }
  ok("pinned kitchen can still draw maid", kitMaid > 0, `maid=${kitMaid}/400`);
  eq("diverse eating fits classroom", placeFitsActs("classroom", new Set(["eating"]), false), true);
  eq("normal eating does not fit classroom", placeFitsActs("classroom", new Set(["eating"]), true), false);
  const pinEat = applyPin(lex, new Set(), new Set(), "eating").pinned;
  const sNormEat = { ...s, sceneMode: "normal", lockScene: true };
  let normClass = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sNormEat, pinEat, new Set(), mulberry32(441000 + i), 441000 + i));
    if (h.has("classroom")) normClass += 1;
  }
  eq("normal eating never auto classroom", normClass, 0);
  const pinFit = applyPin(lex, new Set(), new Set(), "fitting room").pinned;
  let fitSwim = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinFit, new Set(), mulberry32(441040 + i), 441040 + i));
    if ([...h].some((t) => /\b(bikini|swimsuit)\b/.test(t))) fitSwim += 1;
  }
  ok("fitting room can draw swimsuit", fitSwim > 0, `swim=${fitSwim}/40`);
  const pinUw = applyPin(lex, new Set(), new Set(), "underwater").pinned;
  let uwSwim = 0;
  let uwStreet = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinUw, new Set(), mulberry32(441080 + i), 441080 + i));
    if ([...h].some((t) => /\b(bikini|swimsuit)\b/.test(t))) uwSwim += 1;
    if (["sundress", "school uniform", "maid", "shirt", "white shirt"].some((t) => h.has(t))) uwStreet += 1;
  }
  ok("underwater can draw swimsuit", uwSwim > 0, `swim=${uwSwim}/40`);
  eq("underwater never leftover street clothes", uwStreet, 0);
  const pinBikeSit = applyPin(lex, new Set(), new Set(), "riding bicycle").pinned;
  let bikeSit = 0;
  let bikeChair = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinBikeSit, new Set(), mulberry32(441120 + i), 441120 + i));
    if (h.has("sitting")) bikeSit += 1;
    if (h.has("on chair")) bikeChair += 1;
  }
  ok("pinned riding bicycle can sit", bikeSit > 0, `sit=${bikeSit}/40`);
  eq("riding bicycle never auto on chair", bikeChair, 0);
  const pinEx = applyPin(lex, new Set(), new Set(), "exercising").pinned;
  let exStand = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinEx, new Set(), mulberry32(441160 + i), 441160 + i));
    if (h.has("standing")) exStand += 1;
  }
  ok("pinned exercising can stand", exStand > 0, `stand=${exStand}/40`);
  const pinLift = applyPin(lex, new Set(), new Set(), "weightlifting").pinned;
  let liftStand = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinLift, new Set(), mulberry32(441200 + i), 441200 + i));
    if (h.has("standing")) liftStand += 1;
  }
  ok("pinned weightlifting can stand", liftStand > 0, `stand=${liftStand}/40`);
  const pinSport = applyPin(lex, new Set(), new Set(), "playing sports").pinned;
  let sportStand = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinSport, new Set(), mulberry32(441240 + i), 441240 + i));
    if (h.has("standing")) sportStand += 1;
  }
  ok("pinned playing sports can stand", sportStand > 0, `stand=${sportStand}/40`);
  const pinDrink = applyPin(lex, new Set(), new Set(), "drinking").pinned;
  let iza = 0;
  for (let i = 0; i < 80; i++) {
    const h = tagsOf(drawOne(lex, s, pinDrink, new Set(), mulberry32(441280 + i), 441280 + i));
    if (h.has("izakaya")) iza += 1;
  }
  ok("normal drinking can be at izakaya", iza > 0, `izakaya=${iza}/80`);
  const pinGames = applyPin(lex, new Set(), new Set(), "playing video games").pinned;
  let cafeNet = 0;
  for (let i = 0; i < 80; i++) {
    const h = tagsOf(drawOne(lex, s, pinGames, new Set(), mulberry32(441360 + i), 441360 + i));
    if (h.has("internet cafe")) cafeNet += 1;
  }
  ok("normal video games can be at internet cafe", cafeNet > 0, `netcafe=${cafeNet}/80`);
  const pinPhone = applyPin(lex, new Set(), new Set(), "talking on phone").pinned;
  let carPhone = 0;
  for (let i = 0; i < 80; i++) {
    const h = tagsOf(drawOne(lex, s, pinPhone, new Set(), mulberry32(441440 + i), 441440 + i));
    if (h.has("car interior")) carPhone += 1;
  }
  ok("normal phone can be in car interior", carPhone > 0, `car=${carPhone}/80`);
  const pinSleepAir = applyPin(lex, new Set(), new Set(), "sleeping").pinned;
  const sTeaseAir = { ...s, heats: ["tease"], weights: { activity: 0, tease: 1, flash: 0, sex: 0 } };
  let sleepAir = 0;
  for (let i = 0; i < 80; i++) {
    const h = tagsOf(drawOne(lex, sTeaseAir, pinSleepAir, new Set(), mulberry32(441520 + i), 441520 + i));
    if (h.has("airplane interior")) sleepAir += 1;
  }
  ok("normal sleeping can be on an airplane", sleepAir > 0, `plane=${sleepAir}/80`);
  const pinJog = applyPin(lex, new Set(), new Set(), "jogging").pinned;
  const sFlash = { ...s, heats: ["flash"], weights: { activity: 0, tease: 0, flash: 1, sex: 0 } };
  let jogSpread = 0;
  for (let i = 0; i < 80; i++) {
    const h = tagsOf(drawOne(lex, sFlash, pinJog, new Set(), mulberry32(441600 + i), 441600 + i));
    if (h.has("spread legs") || h.has("m legs")) jogSpread += 1;
  }
  eq("jogging never leftover m legs/spread legs", jogSpread, 0);
  let pinJogM = applyPin(lex, new Set(), new Set(), "jogging").pinned;
  pinJogM = applyPin(lex, pinJogM, new Set(), "m legs").pinned;
  let kept = 0;
  for (let i = 0; i < 20; i++) {
    const h = tagsOf(drawOne(lex, sFlash, pinJogM, new Set(), mulberry32(441680 + i), 441680 + i));
    if (h.has("jogging") && h.has("m legs")) kept += 1;
  }
  eq("pinned jogging + m legs stays", kept, 20);
  const pinRead = applyPin(lex, new Set(), new Set(), "reading").pinned;
  let readBook = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinRead, new Set(), mulberry32(441720 + i), 441720 + i));
    if (h.has("book")) readBook += 1;
  }
  eq("pinned reading always keeps book", readBook, 40);
  const pinSelfie = applyPin(lex, new Set(), new Set(), "selfie").pinned;
  let selfiePhone = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinSelfie, new Set(), mulberry32(441760 + i), 441760 + i));
    if (h.has("cellphone")) selfiePhone += 1;
  }
  eq("pinned selfie always keeps cellphone", selfiePhone, 40);
  const pinBathRoom = applyPin(lex, new Set(), new Set(), "bathroom").pinned;
  let bathCasual = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinBathRoom, new Set(), mulberry32(441800 + i), 441800 + i));
    if (["shirt", "white shirt", "pajamas", "school uniform", "sundress"].some((t) => h.has(t))) bathCasual += 1;
  }
  ok("bathroom without bathing can draw casual clothes", bathCasual > 0, `casual=${bathCasual}/40`);
  const pinBeachShoes = applyPin(lex, new Set(), new Set(), "beach").pinned;
  let beachShoes = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinBeachShoes, new Set(), mulberry32(441840 + i), 441840 + i));
    if (["sneakers", "shoes", "sandals"].some((t) => h.has(t))) beachShoes += 1;
  }
  ok("beach without swimming can draw sneakers/sandals", beachShoes > 0, `shoes=${beachShoes}/40`);
  const pinHike = applyPin(lex, new Set(), new Set(), "hiking").pinned;
  let hikeStand = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinHike, new Set(), mulberry32(441880 + i), 441880 + i));
    if (h.has("standing")) hikeStand += 1;
  }
  ok("pinned hiking can stand", hikeStand > 0, `stand=${hikeStand}/40`);
  const pinSkiStand = applyPin(lex, new Set(), new Set(), "skiing").pinned;
  let skiStand = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinSkiStand, new Set(), mulberry32(441920 + i), 441920 + i));
    if (h.has("standing")) skiStand += 1;
  }
  ok("pinned skiing can stand", skiStand > 0, `stand=${skiStand}/40`);
  const pinReadTrain = applyPin(lex, new Set(), new Set(), "reading").pinned;
  let readTrain = 0;
  for (let i = 0; i < 80; i++) {
    const h = tagsOf(drawOne(lex, s, pinReadTrain, new Set(), mulberry32(441960 + i), 441960 + i));
    if (h.has("train") || h.has("train interior")) readTrain += 1;
  }
  ok("normal reading can be on a train", readTrain > 0, `train=${readTrain}/80`);
  const pinEatIza = applyPin(lex, new Set(), new Set(), "eating").pinned;
  let eatIza = 0;
  for (let i = 0; i < 80; i++) {
    const h = tagsOf(drawOne(lex, s, pinEatIza, new Set(), mulberry32(442040 + i), 442040 + i));
    if (h.has("izakaya")) eatIza += 1;
  }
  ok("normal eating can be at izakaya", eatIza > 0, `izakaya=${eatIza}/80`);
  const pinSmoke = applyPin(lex, new Set(), new Set(), "smoking").pinned;
  let smokeIza = 0;
  for (let i = 0; i < 80; i++) {
    const h = tagsOf(drawOne(lex, s, pinSmoke, new Set(), mulberry32(442120 + i), 442120 + i));
    if (h.has("izakaya")) smokeIza += 1;
  }
  ok("normal smoking can be at izakaya", smokeIza > 0, `izakaya=${smokeIza}/80`);
  const pinSelfieCar = applyPin(lex, new Set(), new Set(), "selfie").pinned;
  let selfieCar = 0;
  for (let i = 0; i < 80; i++) {
    const h = tagsOf(drawOne(lex, s, pinSelfieCar, new Set(), mulberry32(442200 + i), 442200 + i));
    if (h.has("car interior")) selfieCar += 1;
  }
  ok("normal selfie can be in a car", selfieCar > 0, `car=${selfieCar}/80`);
  const pinPicnic = applyPin(lex, new Set(), new Set(), "picnic").pinned;
  let picnicArms = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinPicnic, new Set(), mulberry32(442280 + i), 442280 + i));
    if (h.has("arms under breasts") || h.has("heart hands") || h.has("crossed arms")) picnicArms += 1;
  }
  eq("picnic never leftover both-arms poses", picnicArms, 0);
  const pinTrack = applyPin(lex, new Set(), new Set(), "running track").pinned;
  for (const mode of ["normal", "diverse", "weird"]) {
    const sm = { ...s, sceneMode: mode, lockScene: mode !== "weird" };
    let bedOnTrack = 0;
    for (let i = 0; i < 40; i++) {
      const h = tagsOf(drawOne(lex, sm, pinTrack, new Set(), mulberry32(442320 + mode.length * 40 + i), 442320 + mode.length * 40 + i));
      if (h.has("on bed") || h.has("bed sheet")) bedOnTrack += 1;
    }
    eq(`${mode} running track never leftover on bed/bed sheet`, bedOnTrack, 0);
  }
  let pinTrackBed = applyPin(lex, new Set(), new Set(), "running track").pinned;
  pinTrackBed = applyPin(lex, pinTrackBed, new Set(), "on bed").pinned;
  let keptBed = 0;
  for (let i = 0; i < 20; i++) {
    const h = tagsOf(drawOne(lex, s, pinTrackBed, new Set(), mulberry32(442480 + i), 442480 + i));
    if (h.has("running track") && h.has("on bed")) keptBed += 1;
  }
  eq("pinned running track + on bed stays", keptBed, 20);
  let pinTrackSheet = applyPin(lex, new Set(), new Set(), "running track").pinned;
  pinTrackSheet = applyPin(lex, pinTrackSheet, new Set(), "bed sheet").pinned;
  let keptSheet = 0;
  for (let i = 0; i < 20; i++) {
    const h = tagsOf(drawOne(lex, s, pinTrackSheet, new Set(), mulberry32(442500 + i), 442500 + i));
    if (h.has("running track") && h.has("bed sheet")) keptSheet += 1;
  }
  eq("pinned running track + bed sheet stays", keptSheet, 20);
  const pinBedroom = applyPin(lex, new Set(), new Set(), "bedroom").pinned;
  const sDivBed = { ...s, sceneMode: "diverse", lockScene: true };
  let bedKept = 0;
  for (let i = 0; i < 80; i++) {
    const h = tagsOf(drawOne(lex, sDivBed, pinBedroom, new Set(), mulberry32(442520 + i), 442520 + i));
    if (h.has("on bed") || h.has("bed sheet")) bedKept += 1;
  }
  ok("diverse bedroom leftover can keep on bed/bed sheet", bedKept > 0, `bed=${bedKept}/80`);
  const sWeird2 = { ...s, sceneMode: "weird", lockScene: false };
  const pinWade2 = applyPin(lex, new Set(), new Set(), "wading").pinned;
  let wadeLie = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sWeird2, pinWade2, new Set(), mulberry32(442600 + i), 442600 + i));
    if (["crawling", "on back", "lying", "on stomach"].some((t) => h.has(t))) wadeLie += 1;
  }
  eq("wading never leftover crawl/lie", wadeLie, 0);
  const pinDive = applyPin(lex, new Set(), new Set(), "diving").pinned;
  let diveDry = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sWeird2, pinDive, new Set(), mulberry32(442640 + i), 442640 + i));
    if (["bathroom", "prison", "colonnade", "classroom"].some((t) => h.has(t))) diveDry += 1;
  }
  eq("weird diving never leftover dry indoor", diveDry, 0);
  let pinCookLie = applyPin(lex, new Set(), new Set(), "1girl").pinned;
  pinCookLie = applyPin(lex, pinCookLie, new Set(), "solo").pinned;
  pinCookLie = applyPin(lex, pinCookLie, new Set(), "cooking").pinned;
  let cookLie = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinCookLie, new Set(), mulberry32(442680 + i), 442680 + i));
    if (["lying", "on back", "on stomach"].some((t) => h.has(t))) cookLie += 1;
  }
  eq("cooking never leftover lie/on back/on stomach", cookLie, 0);
  let pinEatProne = applyPin(lex, new Set(), new Set(), "1girl").pinned;
  pinEatProne = applyPin(lex, pinEatProne, new Set(), "solo").pinned;
  pinEatProne = applyPin(lex, pinEatProne, new Set(), "eating").pinned;
  let eatProne = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinEatProne, new Set(), mulberry32(442720 + i), 442720 + i));
    if (h.has("on stomach")) eatProne += 1;
  }
  eq("eating never leftover on stomach", eatProne, 0);
  const pinBike = applyPin(lex, new Set(), new Set(), "riding bicycle").pinned;
  let bikeIn = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sWeird2, pinBike, new Set(), mulberry32(442760 + i), 442760 + i));
    if (["train interior", "movie theater", "classroom"].some((t) => h.has(t))) bikeIn += 1;
  }
  eq("bicycle never leftover indoor rooms", bikeIn, 0);
  const pinGuit = applyPin(lex, new Set(), new Set(), "playing guitar").pinned;
  const sSexG = { ...s, heats: ["sex"], weights: { activity: 0, tease: 0, flash: 0, sex: 1 } };
  let gitMast = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, sSexG, pinGuit, new Set(), mulberry32(442800 + i), 442800 + i));
    if (h.has("masturbation") || h.has("female masturbation")) gitMast += 1;
  }
  eq("guitar never leftover masturbation", gitMast, 0);
  const pinFishDance = applyPin(lex, new Set(), new Set(), "fishing").pinned;
  let fishDance = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinFishDance, new Set(), mulberry32(442840 + i), 442840 + i));
    if (h.has("dancing")) fishDance += 1;
  }
  eq("fishing never leftover dancing", fishDance, 0);
  const pinFlat = applyPin(lex, new Set(), new Set(), "flat chest").pinned;
  let hang = 0;
  for (let i = 0; i < 40; i++) {
    const h = tagsOf(drawOne(lex, s, pinFlat, new Set(), mulberry32(442880 + i), 442880 + i));
    if (h.has("hanging breasts")) hang += 1;
  }
  eq("flat chest never leftover hanging breasts", hang, 0);

  const shadowIntegrationDraw = drawOne(
    lex,
    defaultSettings(data),
    new Set(),
    new Set(),
    mulberry32(42),
    42,
  );
  eq("shadow integration keeps seed 42 POS byte-identical", shadowIntegrationDraw.positive,
    // 詞庫新增 24 個運動 tag 之後抽牌序列必然改變，這份金標是 2026-09-13 重新產生的。
    "1girl, solo, adult, very short hair, grey eyes, grey hair, bangs, large breasts, soft breasts, natural breasts, wet, thigh strap, hanging breasts, serafuku, school uniform, track jacket, jacket, cleats, pantyhose, female masturbation, sitting, wide shot, looking at viewer, come hither, licking lips, soft lighting, modern, living room, indoors, night, nsfw, explicit, masterpiece, best quality, amazing quality");
  ok("drawOne exposes shadow diagnostics", Array.isArray(shadowIntegrationDraw.shadowViolations));

  const eatProneShadow = validateSupportShadow({
    tags: ["eating", "on stomach", "1girl", "solo"],
    pinned: new Set(),
    mode: "normal",
    people: 1,
  });
  eq("shadow detects normal eating prone", eatProneShadow.map((v) => v.rule_id), ["support:eating-prone"]);
  eq("shadow eating prone is hard auto conflict", [eatProneShadow[0]?.severity, eatProneShadow[0]?.origin], ["hard", "auto-conflict"]);

  const cookSupineShadow = validateSupportShadow({
    tags: ["cooking", "on back", "1girl", "solo"],
    pinned: [],
    mode: "normal",
    people: 1,
  });
  eq("shadow detects normal cooking supine", cookSupineShadow.map((v) => v.rule_id), ["support:cooking-supine"]);
  eq("shadow detects normal cooking prone as normal-only", validateSupportShadow({
    tags: ["cooking", "on stomach", "1girl", "solo"], mode: "normal", people: 1,
  }).map((v) => v.rule_id), ["support:cooking-prone-normal"]);

  const wadeCrawlShadow = validateSupportShadow({
    tags: ["wading", "crawling", "1girl", "solo"],
    pinned: [],
    mode: "weird",
    people: 1,
  });
  eq("shadow detects weird wading crawl", wadeCrawlShadow.map((v) => v.rule_id), ["support:wading-planted"]);

  const wadeBackShadow = validateSupportShadow({
    tags: ["wading", "on back", "1girl", "solo"],
    pinned: [],
    mode: "diverse",
    people: 1,
  });
  eq("shadow detects diverse wading supine", wadeBackShadow.map((v) => v.rule_id), ["support:wading-planted"]);

  eq("shadow allows weird eating prone", validateSupportShadow({
    tags: ["eating", "on stomach", "1girl", "solo"], mode: "weird", people: 1,
  }), []);
  eq("shadow allows weird cooking prone", validateSupportShadow({
    tags: ["cooking", "on stomach", "1girl", "solo"], mode: "weird", people: 1,
  }), []);
  eq("shadow ignores adjudicated-soft cleaning side", validateSupportShadow({
    tags: ["cleaning", "on side", "1girl", "solo"], mode: "normal", people: 1,
  }), []);
  eq("shadow skips same-actor rules for unattributed pairs", validateSupportShadow({
    tags: ["eating", "on stomach", "1girl", "1boy"], mode: "normal", people: 2,
  }), []);

  const pinnedSupportShadow = validateSupportShadow({
    tags: ["eating", "on stomach", "1girl", "solo"],
    pinned: new Set(["eating", "on stomach"]),
    mode: "normal",
    people: 1,
  });
  eq("shadow preserves two-sided pinned conflict as warning", {
    severity: pinnedSupportShadow[0]?.severity,
    declared: pinnedSupportShadow[0]?.declared_severity,
    origin: pinnedSupportShadow[0]?.origin,
  }, { severity: "warning", declared: "hard", origin: "pinned-conflict" });
  eq("candidate gate allows fully pinned conflict", supportCandidateAllowed({
    used: new Set(["eating"]),
    candidate: "on stomach",
    pinned: new Set(["eating", "on stomach"]),
    mode: "normal",
    people: 1,
  }), true);
  eq("candidate gate rejects automatic conflict", supportCandidateAllowed({
    used: new Set(["eating"]),
    candidate: "on stomach",
    pinned: new Set(["eating"]),
    mode: "normal",
    people: 1,
  }), false);
}


// --- 必抽 ------------------------------------------------------------------
{
  const groupCount = (drawn, section, group) => {
    let n = 0;
    for (const t of drawn.positive.split(", ")) {
      const it = lex.byTag.get(t.trim());
      if (it && it.section === section && it.group === group) n += 1;
    }
    return n;
  };
  const mutexCount = (drawn, name) => {
    let n = 0;
    for (const t of drawn.positive.split(", ")) {
      const it = lex.byTag.get(t.trim());
      if (it && it.mutex === name) n += 1;
    }
    return n;
  };
  const draw = (tweak, seed) => {
    const s = settings();
    tweak(s);
    return drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed);
  };

  // 沒設必抽就什麼都沒變。
  const plain = draw(() => {}, 90001);
  eq("no mustDraw means empty report", plain.mustReport, []);

  // 必抽 3 個誘惑：tease 池子有 57 個又不互斥，只開誘惑時每一張都該抽滿。
  let teaseShort = 0;
  for (let i = 0; i < 40; i++) {
    const d = draw((s) => {
      s.heats = ["tease"];
      s.mustDraw = { "pose:tease": 3 };
    }, 90100 + i);
    if (groupCount(d, "pose", "tease") < 3) teaseShort += 1;
  }
  eq("must 3 tease always lands 3", teaseShort, 0);

  const teaseOne = draw((s) => {
    s.heats = ["tease"];
    s.mustDraw = { "pose:tease": 3 };
  }, 90100);
  eq("must report counts what landed", teaseOne.mustReport, [
    { key: "pose:tease", section: "pose", group: "tease", want: 3, got: 3 },
  ]);

  // 身體對不上時必抽要讓步，而且如實回報 —— 不硬湊出手在兩個地方的圖。
  let honestWhenShort = 0;
  let sawShort = 0;
  for (let i = 0; i < 60; i++) {
    const d = draw((s) => {
      s.mustDraw = { "pose:tease": 3 };
    }, 90100 + i);
    const got = groupCount(d, "pose", "tease");
    if (got < 3) sawShort += 1;
    if (d.mustReport[0].got === got) honestWhenShort += 1;
  }
  eq("must report never lies", honestWhenShort, 60);
  ok("sex acts really can crowd out a must pose", sawShort > 0, `sawShort=${sawShort}`);

  // 互斥絕不破：髮色槽再怎麼必抽也只能有一個。
  let hairClash = 0;
  for (let i = 0; i < 40; i++) {
    const d = draw((s) => {
      s.mustDraw = { "feature:hair_color": 5 };
    }, 90200 + i);
    if (mutexCount(d, "hair_color") > 1) hairClash += 1;
  }
  eq("must never doubles a mutex slot", hairClash, 0);

  // 必抽的權限大於時代：clothing:era 全是非現代衣，現代場也要抽得出來。
  let eraGot = 0;
  for (let i = 0; i < 40; i++) {
    const d = draw((s) => {
      s.eras = ["modern"];
      s.mustDraw = { "clothing:era": 1 };
    }, 90300 + i);
    if (groupCount(d, "clothing", "era") >= 1) eraGot += 1;
  }
  eq("must beats era", eraGot, 40);

  // 對照組：沒設必抽時，現代場不該冒出古裝。
  let eraLeak = 0;
  for (let i = 0; i < 40; i++) {
    const d = draw((s) => {
      s.eras = ["modern"];
    }, 90300 + i);
    if (groupCount(d, "clothing", "era") > 0) eraLeak += 1;
  }
  eq("era still walls off without must", eraLeak, 0);

  // 尺度是硬牆：必抽不准繞過 heat 閘。只開誘惑時，只有 lexicon 自己標成誘惑也能用的
  // 性愛字（例如 spooning）可以出現，heat 只寫 sex 的一律不准。
  let heatLeak = 0;
  let honest = 0;
  for (let i = 0; i < 30; i++) {
    const d = draw((s) => {
      s.heats = ["tease"];
      s.mustDraw = { "pose:sex": 2 };
    }, 90400 + i);
    for (const t of d.positive.split(", ")) {
      const it = lex.byTag.get(t.trim());
      if (!it || it.group !== "sex") continue;
      const h = it.heat;
      if (Array.isArray(h) && h.length && !h.includes(d.heat)) heatLeak += 1;
    }
    const r = d.mustReport[0];
    if (r && r.got === groupCount(d, "pose", "sex")) honest += 1;
  }
  eq("must never bypasses the heat gate", heatLeak, 0);
  eq("must report matches what actually landed", honest, 30);

  // 女／男是硬牆：只開女時，必抽男體型拿不到任何 gate=male 的字。
  // （muscular／plump／skinny 在 lexicon 裡是 gate=any，男女通用，不算漏。）
  let maleLeak = 0;
  for (let i = 0; i < 30; i++) {
    const d = draw((s) => {
      s.girl = true;
      s.boy = false;
      s.mustDraw = { "feature:body_m": 3 };
    }, 90500 + i);
    for (const t of d.positive.split(", ")) {
      const it = lex.byTag.get(t.trim());
      if (it && it.gate === "male") maleLeak += 1;
    }
  }
  eq("must never bypasses the cast gate", maleLeak, 0);

  // 已封鎖的字不會被必抽撿回來。
  const banned = new Set(
    lex.bySection.pose.filter((it) => it.group === "tease").map((it) => it.tag)
  );
  const allBanned = drawOne(
    lex,
    Object.assign(settings(), { mustDraw: { "pose:tease": 2 } }),
    new Set(),
    banned,
    mulberry32(90600),
    90600
  );
  eq("must respects user bans", groupCount(allBanned, "pose", "tease"), 0);

  // 設定值清洗
  eq("mustDraw drops quality", sanitizeMustDraw({ "quality:style": 2 }), {});
  eq("mustDraw drops zero and negatives", sanitizeMustDraw({ "pose:tease": 0, "pose:sex": -3 }), {});
  eq("mustDraw drops malformed keys", sanitizeMustDraw({ tease: 2, ":x": 1, "pose:": 1 }), {});
  eq("mustDraw caps at MUST_MAX", sanitizeMustDraw({ "pose:tease": 999 }), { "pose:tease": MUST_MAX });
  eq("mustDraw floors floats", sanitizeMustDraw({ "pose:tease": 2.9 }), { "pose:tease": 2 });
  eq(
    "sanitizeSettings keeps mustDraw",
    sanitizeSettings({ mustDraw: { "pose:tease": 3 } }, data).mustDraw,
    { "pose:tease": 3 }
  );

  // 一次幾張解除上限（無限抽會用到）
  eq("n is no longer capped at 10", sanitizeSettings({ n: 50 }, data).n, 50);
  eq("n still floors at 1", sanitizeSettings({ n: 0 }, data).n, defaultSettings(data).n);
  eq("n rejects negatives", sanitizeSettings({ n: -4 }, data).n, 1);
}


// --- 運動釘選組合 ---------------------------------------------------------
{
  const byId = (id) => BUILTIN_PRESETS.find((p) => p.id === id);
  const tagsOfPreset = (id) => sportPresetTags(SPORT_BY_ID.get(id));
  const pinSet = (tags) => applyPresetTags(lex, tags, new Set());
  const drawWith = (pins, seed) => {
    const s = settings();
    return drawOne(lex, s, pins, new Set(), mulberry32(seed), seed);
  };

  // 1) 按鈕顯示運動名稱，不是場地名稱
  eq("hoops preset is named 籃球", byId("hoops")?.name, "籃球");
  eq("tennis preset is named 網球", byId("tennis")?.name, "網球");
  eq("soccer preset is named 足球", byId("soccer")?.name, "足球");
  eq("baseball preset is named 棒球", byId("baseball")?.name, "棒球");
  eq("track preset is named 田徑", byId("track")?.name, "田徑");
  ok("no preset is still named after a venue",
    !BUILTIN_PRESETS.some((p) => /球場$|田徑場$/.test(p.name)),
    BUILTIN_PRESETS.filter((p) => /球場$|田徑場$/.test(p.name)).map((p) => p.name).join(","));

  // 2) 每個運動：tag 都在 lexicon、整套進得去、再點一次整套出來、不動無關釘選
  for (const p of SPORT_BUTTONS) {
    const tags = sportPresetTags(p);
    const missing = tags.filter((t) => !lex.byTag.has(t));
    eq(`${p.name} tags all exist in lexicon`, missing, []);

    const preset = byId(p.id);
    ok(`${p.name} has a builtin preset button`, !!preset, `id=${p.id}`);
    if (!preset) continue;
    eq(`${p.name} preset tags come from SPORT_PRESETS`, preset.tags, tags);

    const base = new Set(["huge breasts", "blue eyes", "long hair"]);
    const on = togglePresetTags(lex, tags, base);
    const notPinned = tags.filter((t) => !on.has(t));
    eq(`${p.name} pins its whole kit`, notPinned, []);
    ok(`${p.name} keeps identity pins`,
      on.has("huge breasts") && on.has("blue eyes") && on.has("long hair"));
    eq(`${p.name} reads as fully on`, presetState(lex, tags, on), "on");

    const off = togglePresetTags(lex, tags, on);
    const stillThere = tags.filter((t) => off.has(t));
    eq(`${p.name} second click drops its whole kit`, stillThere, []);
    ok(`${p.name} second click keeps identity pins`,
      off.has("huge breasts") && off.has("blue eyes") && off.has("long hair"));
    eq(`${p.name} reads as off`, presetState(lex, tags, off), "off");
  }

  // 3) partial：單獨拿掉一項，不能被任何東西自動加回來
  {
    const tags = tagsOfPreset("hoops");
    let pins = togglePresetTags(lex, tags, new Set(["huge breasts"]));
    ok("basketball kit starts complete", presetState(lex, tags, pins) === "on");

    pins = applyClear(pins, new Set(), "basketball uniform").pinned;
    ok("removed uniform is gone", !pins.has("basketball uniform"));
    ok("removing uniform keeps the court", pins.has("basketball court"));
    ok("removing uniform keeps the ball", pins.has("basketball (object)"));
    eq("partial kit reads as mixed", presetState(lex, tags, pins), "mixed");

    // 重新整理 / 存讀檔都不可以把它加回來
    const resynced = knownTags(lex, [...pins]);
    ok("sanitising pins does not resurrect the uniform", !resynced.includes("basketball uniform"));
    const reloaded = applyPresetTags(lex, [...pins], new Set());
    ok("rebuilding pins does not resurrect the uniform", !reloaded.has("basketball uniform"));
    ok("rebuilding pins keeps the court", reloaded.has("basketball court"));

    // regression：場地不可以靠 implies 把球和制服拖回來
    const courtOnly = applyPresetTags(lex, ["basketball court"], new Set());
    ok("court alone does not imply the ball", !courtOnly.has("basketball (object)"));
    ok("court alone does not imply the uniform", !courtOnly.has("basketball uniform"));
    const tennisCourtOnly = applyPresetTags(lex, ["tennis court"], new Set());
    ok("tennis court alone does not imply the ball", !tennisCourtOnly.has("tennis ball"));
    const fieldOnly = applyPresetTags(lex, ["soccer field"], new Set());
    ok("soccer field alone does not imply the ball", !fieldOnly.has("soccer ball"));
    const stadiumOnly = applyPresetTags(lex, ["baseball stadium"], new Set());
    ok("baseball stadium alone does not imply the ball", !stadiumOnly.has("baseball (object)"));
    const alleyOnly = applyPresetTags(lex, ["bowling alley"], new Set());
    ok("bowling alley alone does not imply the ball", !alleyOnly.has("bowling ball"));

    // 再點一次才補回來
    const refilled = togglePresetTags(lex, tags, pins);
    ok("clicking the partial preset restores the uniform", refilled.has("basketball uniform"));
    eq("restored kit reads as on", presetState(lex, tags, refilled), "on");
    ok("restoring keeps the unrelated pin", refilled.has("huge breasts"));

    // 移除必進 POS 不等於 ban
    ok("removing from the kit does not ban the tag",
      !applyClear(pins, new Set(), "basketball uniform").userBanned.has("basketball uniform"));
  }

  // 4) 換運動：清掉上一個運動的場地／制服／球具，保留身份
  {
    const hoops = tagsOfPreset("hoops");
    const tennis = tagsOfPreset("tennis");
    const all = BUILTIN_PRESETS.map((p) => p.tags);
    let pins = togglePresetTags(lex, hoops, new Set(["huge breasts", "blue eyes"]), all);
    pins = togglePresetTags(lex, tennis, pins, all);
    ok("switching sports drops the old court", !pins.has("basketball court"));
    ok("switching sports drops the old ball", !pins.has("basketball (object)"));
    ok("switching sports drops the old uniform", !pins.has("basketball uniform"));
    const missing = tennis.filter((t) => !pins.has(t));
    eq("switching sports pins the new kit", missing, []);
    ok("switching sports keeps identity", pins.has("huge breasts") && pins.has("blue eyes"));

    // 共用裝備（球鞋）不該讓舊運動一直顯示半亮：識別性成員一個都不在就是 off。
    const hoopsBtn = BUILTIN_PRESETS.find((x) => x.id === "hoops");
    ok("shared sneakers alone does not keep basketball half-lit",
      pins.has("sneakers") && presetState(lex, hoops, pins, hoopsBtn.core) === "off",
      `state=${presetState(lex, hoops, pins, hoopsBtn.core)} sneakers=${pins.has("sneakers")}`);
    // 但真的少一件的時候還是要是 mixed
    let partial = togglePresetTags(lex, hoops, new Set(), all);
    partial = applyClear(partial, new Set(), "sneakers").pinned;
    eq("dropping one kit member still reads as mixed",
      presetState(lex, hoops, partial, hoopsBtn.core), "mixed");
    ok("core excludes shared gear", !hoopsBtn.core.includes("sneakers") && hoopsBtn.core.includes("basketball court"));
  }

  // 5) 抽牌互斥：釘一個運動，跑固定 seed，不可以混進別的運動
  {
    const foreignOf = (id) => {
      const mine = sportOwnedTags(SPORT_BY_ID.get(id));
      const out = new Set();
      for (const [tag, ids] of SPORT_IDENTITY) {
        if (mine.has(tag)) continue;
        if (ids.has(id)) continue;
        out.add(tag);
      }
      return out;
    };
    for (const p of SPORT_BUTTONS) {
      const tags = sportPresetTags(p);
      const pins = pinSet(tags);
      const foreign = foreignOf(p.id);
      const leaks = new Map();
      for (let i = 0; i < 120; i++) {
        const seed = 770000 + i;
        const d = drawWith(pins, seed);
        for (const t of d.positive.split(", ")) {
          const tag = t.trim();
          if (foreign.has(tag)) leaks.set(tag, (leaks.get(tag) || 0) + 1);
        }
      }
      eq(`${p.name} never mixes in another sport`, [...leaks.keys()].sort(), []);
    }
  }

  // 6) 點名案例
  {
    const has = (id, tag, n = 120) => {
      const pins = pinSet(tagsOfPreset(id));
      for (let i = 0; i < n; i++) {
        const d = drawWith(pins, 781000 + i);
        if (d.positive.split(", ").some((t) => t.trim() === tag)) return true;
      }
      return false;
    };
    ok("basketball never draws a soccer ball", !has("hoops", "soccer ball"));
    ok("basketball never draws a tennis ball", !has("hoops", "tennis ball"));
    ok("tennis never draws a badminton racket", !has("tennis", "badminton racket"));
    ok("tennis never draws a basketball", !has("tennis", "basketball (object)"));
    ok("table tennis never draws a tennis racket", !has("tabletennis", "tennis racket"));
    ok("swimming never draws sneakers", !has("swim", "sneakers"));
    ok("swimming never draws boots", !has("swim", "boots"));
    ok("swimming never draws high heels", !has("swim", "high heels"));
    ok("cycling never lands in a bedroom", !has("cycling", "bedroom"));
    ok("cycling never lands in a bathroom", !has("cycling", "bathroom"));
    ok("cycling never lands on a bed", !has("cycling", "on bed"));

    const baseballKit = sportPresetTags(SPORT_BY_ID.get("baseball"));
    ok("baseball does not force both bat and mitt",
      baseballKit.includes("baseball bat") && !baseballKit.includes("baseball mitt"));
    ok("baseball mitt is only an optional extra",
      (SPORT_BY_ID.get("baseball").optionalEquipment || []).includes("baseball mitt"));
    ok("volleyball does not use volleyball court",
      !sportPresetTags(SPORT_BY_ID.get("volleyball")).includes("volleyball court"));
    const bad = sportPresetTags(SPORT_BY_ID.get("badminton"));
    ok("badminton always has racket and shuttlecock",
      bad.includes("badminton racket") && bad.includes("shuttlecock"));
    const tt = sportPresetTags(SPORT_BY_ID.get("tabletennis"));
    ok("table tennis uses the paddle, not a tennis racket",
      tt.includes("table tennis paddle") && !tt.includes("tennis racket"));
    const arc = sportPresetTags(SPORT_BY_ID.get("archery"));
    ok("archery uses arrow (projectile), not the deprecated arrow",
      arc.includes("arrow (projectile)") && !arc.includes("arrow"));
    ok("archery does not use yumi", !arc.includes("yumi"));

    // 沒有任何 preset 用到禁用清單上的 tag
    const banned = new Set(["basketball", "baseball", "volleyball", "volleyball court",
      "baseball glove", "cycling", "golf uniform", "tennis shoes", "archery range",
      "ice rink", "arrow", "yumi"]);
    const used = new Set();
    for (const p of SPORT_PRESETS) {
      for (const t of [...sportPresetTags(p), ...(p.optionalEquipment || [])]) {
        if (banned.has(t)) used.add(t);
      }
    }
    eq("no preset uses a deprecated or empty tag", [...used], []);
  }

  // 7) 使用者自己釘兩個互斥運動：保留，並且回報 warning，不靜默刪除
  {
    let pins = new Set();
    for (const t of ["basketball court", "tennis racket"]) {
      pins = applyPin(lex, pins, new Set(), t).pinned;
    }
    ok("explicit cross-sport pins are both kept",
      pins.has("basketball court") && pins.has("tennis racket"));
    const d = drawWith(pins, 790001);
    const got = new Set(d.positive.split(", ").map((t) => t.trim()));
    ok("explicit cross-sport pins survive the draw",
      got.has("basketball court") && got.has("tennis racket"));
    ok("cross-sport pins are reported", sportPinWarnings(lex, pins).length > 0);
  }
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nok");



