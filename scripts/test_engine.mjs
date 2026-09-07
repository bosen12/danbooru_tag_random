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
  missingPins,
  mulberry32,
  mutexSiblings,
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

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nok");



