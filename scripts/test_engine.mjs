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
  sanitizeSettings,
  indexLexicon,
  labelOf,
  missingPins,
  pinMissLine,
  knownTags,
  mulberry32,
  mutexSiblings,
  actionGarmentKeys,
  actionFitsClothes,
  parseWeighted,
  formatWeighted,
  insertTriggerAfterCast,
  toggleHeat,
  heatPresetOf,
  weightsForHeats,
  nextTagWeight,
  stepTagWeight,
  applyTagWeights,
  FEMALE_COUNT,
  MALE_COUNT,
  hasFemale,
  hasMale,
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
  ok("nude is not a tease outfit", !has("nude", "tease"));
  ok("sex toy stays sex-only", JSON.stringify(lex.byTag.get("sex toy")?.heat) === '["sex"]');
  ok("ahegao stays sex-only", JSON.stringify(lex.byTag.get("ahegao")?.heat) === '["sex"]');
}

{
  const pinned = applyPin(lex, new Set(), new Set(), "micro bikini").pinned;
  ok("sex-only does not clash with micro bikini", !heatMismatches(lex, pinned, ["sex"]).includes("micro bikini"));
  ok("sex-only does not clash with undressing", !heatMismatches(lex, applyPin(lex, new Set(), new Set(), "undressing").pinned, ["sex"]).includes("undressing"));
  ok("tease-only clash lists fellatio", heatMismatches(lex, applyPin(lex, new Set(), new Set(), "fellatio").pinned, ["tease"]).includes("fellatio"));
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
  ok("huge pose count clamps to 20", dirty.counts.pose === 20);
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
  eq("undressing fits a hoodie", actionFitsClothes("undressing", ["hoodie"]), 1);
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
  eq("heatPresetOf one is that heat", heatPresetOf(["sex"]), "sex");
  eq("heatPresetOf two is custom", heatPresetOf(["tease", "sex"]), "custom");
  eq("heatPresetOf three is mixed", heatPresetOf(["tease", "flash", "sex"]), "mixed");
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

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nok");



