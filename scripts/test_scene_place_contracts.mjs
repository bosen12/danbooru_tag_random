#!/usr/bin/env node
/** Focused regression tests for activity/job place arbitration and sleep guards. */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  ACT_PLACE,
  applyPin,
  defaultSettings,
  drawOne,
  indexLexicon,
  mulberry32,
} from "../web/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web", "lexicon.json"), "utf8"));
const lex = indexLexicon(data);
const PUBLIC_SEX_PLACE = new Set([
  "street",
  "city",
  "cityscape",
  "alley",
  "park",
  "beach",
  "ocean",
  "rooftop",
]);

let failed = 0;
function ok(name, condition, detail = "") {
  if (condition) {
    console.log(`ok   ${name}`);
    return;
  }
  failed += 1;
  console.error(`FAIL ${name}${detail ? `\n  ${detail}` : ""}`);
}

function tagsOf(drawn) {
  return new Set(drawn.positive.split(", ").map((tag) => tag.trim()));
}

function placeOf(tags) {
  for (const tag of tags) {
    const item = lex.byTag.get(tag);
    if (item && (item.mutex === "place" || item.group === "place")) return tag;
  }
  return null;
}

function sceneSettings(heat, era = "modern") {
  const s = defaultSettings(data);
  s.girl = true;
  s.boy = true;
  s.eras = [era];
  s.heats = [heat];
  s.weights = { activity: 0, tease: 0, flash: 0, sex: 0, [heat]: 1 };
  return s;
}

function samples({ pin, heat, era = "modern", seed, count = 40 }) {
  const s = sceneSettings(heat, era);
  const pinned = pin ? applyPin(lex, new Set(), new Set(), pin).pinned : new Set();
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(tagsOf(drawOne(lex, s, pinned, new Set(), mulberry32(seed + i), seed + i)));
  }
  return out;
}

{
  const rows = samples({ pin: "cooking", heat: "sex", era: "edo", seed: 910000, count: 80 });
  const bad = rows.filter((tags) => !tags.has("cooking") || placeOf(tags) !== "ryokan").length;
  ok("edo sex cooking always lands at the era-valid private cook place", bad === 0, `bad=${bad}/80`);
}

for (const [activity, era, seed] of [
  ["shopping", "modern", 920000],
  ["driving", "modern", 920080],
  ["tennis", "modern", 920160],
  ["playing sports", "victorian", 920240],
]) {
  const rows = samples({ pin: activity, heat: "sex", era, seed });
  const bad = rows.filter((tags) => {
    const place = placeOf(tags);
    return !tags.has(activity) || !place || !ACT_PLACE[activity]?.has(place);
  }).length;
  ok(`sex + pinned ${activity} keeps a compatible place`, bad === 0, `bad=${bad}/40`);
}

{
  const rows = samples({ pin: "shopping", heat: "sex", seed: 920000 });
  const wrong = rows.filter((tags) => placeOf(tags) !== "changing room").length;
  ok("sex + pinned shopping uses the existing private changing room", wrong === 0, `wrong=${wrong}/40`);
}

{
  const rows = samples({ pin: "firefighter", heat: "sex", seed: 930000 });
  const streets = new Set(["street", "city", "cityscape"]);
  const bad = rows.filter((tags) => !tags.has("firefighter") || !streets.has(placeOf(tags))).length;
  const indoorPose = rows.filter((tags) => tags.has("breasts on table") || tags.has("breasts on glass")).length;
  ok("sex + pinned firefighter keeps one of its public job places", bad === 0, `bad=${bad}/40`);
  ok("outdoor-only firefighter never auto-draws an indoor-only breast pose", indoorPose === 0, `bad=${indoorPose}/40`);
}

{
  const rows = samples({ pin: "detective", heat: "sex", seed: 930080 });
  const bad = rows.filter((tags) => !placeOf(tags) || PUBLIC_SEX_PLACE.has(placeOf(tags))).length;
  ok("sex + pinned detective stays at a non-public job place", bad === 0, `bad=${bad}/40`);
}

{
  const rows = samples({ heat: "sex", seed: 930160, count: 80 });
  const publicRows = rows.filter((tags) => PUBLIC_SEX_PLACE.has(placeOf(tags))).length;
  ok("unpinned modern sex never leaks onto a public place", publicRows === 0, `bad=${publicRows}/80`);
}

for (const [job, seed] of [
  ["detective", 940000],
  ["policewoman", 940080],
]) {
  const rows = samples({ pin: job, heat: "tease", seed });
  const missing = rows.filter((tags) => !placeOf(tags)).length;
  ok(`tease + pinned ${job} keeps a place`, missing === 0, `missing=${missing}/40`);
}

for (const job of ["office lady", "detective"]) {
  const rows = samples({ pin: job, heat: "tease", seed: 850000 });
  const sleeping = rows.filter((tags) => tags.has("sleeping")).length;
  ok(`${job} never auto-sleeps where none of its job places allow sleep`, sleeping === 0, `sleeping=${sleeping}/40`);
}

{
  const rows = samples({ pin: "kiss", heat: "tease", seed: 218000, count: 400 });
  const sleeping = rows.filter((tags) => tags.has("sleeping")).length;
  ok("pinned kiss never auto-draws sleeping", sleeping === 0, `sleeping=${sleeping}/400`);
}

// 釘室內傢俱時，in_out 還在後面才填。outdoors → on bed／bunk bed 已擋，
// 反向沒擋，實測釘 on bed／on chair／on couch 各有 20～28/80 張自動 outdoors。
for (const [furn, seed] of [
  ["on bed", 960000],
  ["on chair", 960080],
  ["on couch", 960160],
  ["bunk bed", 960240],
]) {
  const rows = samples({ pin: furn, heat: "tease", seed });
  const out = rows.filter((tags) => tags.has(furn) && tags.has("outdoors")).length;
  ok(`pinned ${furn} never auto outdoors`, out === 0, `outdoors=${out}/40`);
}
{
  const s = sceneSettings("tease");
  let pin = applyPin(lex, new Set(), new Set(), "on bed").pinned;
  pin = applyPin(lex, pin, new Set(), "street").pinned;
  let kept = 0;
  for (let i = 0; i < 20; i += 1) {
    const tags = tagsOf(drawOne(lex, s, pin, new Set(), mulberry32(960320 + i), 960320 + i));
    if (tags.has("on bed") && tags.has("street")) kept += 1;
  }
  ok("dual-pin on bed + street still keeps both", kept === 20, `kept=${kept}/20`);
}
{
  const rows = samples({ pin: "driving", heat: "activity", seed: 960400 });
  const miss = rows.filter((tags) => tags.has("driving") && !tags.has("steering wheel")).length;
  ok("pinned driving always has a steering wheel", miss === 0, `miss=${miss}/40`);
}

if (failed) {
  console.error(`\n${failed} scene/place contract test(s) failed`);
  process.exit(1);
}
console.log("\nok");
