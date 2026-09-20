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

// 雨／霧／陰天是 OUTDOOR_WEATHER，卻不像雪／櫻花在 OUTDOOR_LEFTOVER 裡，
// 也不 implies outdoors。釘雨時場地還沒填，室內房間照收。實測 rain 20/40
// indoors。反向（釘臥室不抽雨）本來就有。
for (const [w, seed] of [
  ["rain", 970000],
  ["fog", 970080],
  ["overcast", 970160],
]) {
  const rows = samples({ pin: w, heat: "tease", seed });
  const indoor = rows.filter((tags) => tags.has(w) && tags.has("indoors")).length;
  ok(`pinned ${w} never auto indoors`, indoor === 0, `indoors=${indoor}/40`);
}
{
  const rows = samples({ pin: "snow", heat: "tease", seed: 970240 });
  const indoor = rows.filter((tags) => tags.has("snow") && tags.has("indoors")).length;
  ok("pinned snow still never auto indoors", indoor === 0, `indoors=${indoor}/40`);
}
{
  const s = sceneSettings("tease");
  let pin = applyPin(lex, new Set(), new Set(), "rain").pinned;
  pin = applyPin(lex, pin, new Set(), "living room").pinned;
  let kept = 0;
  for (let i = 0; i < 20; i += 1) {
    const tags = tagsOf(drawOne(lex, s, pin, new Set(), mulberry32(970320 + i), 970320 + i));
    if (tags.has("rain") && tags.has("living room")) kept += 1;
  }
  ok("dual-pin rain + living room still keeps both", kept === 20, `kept=${kept}/20`);
}
{
  const rows = samples({ pin: "riding bicycle", heat: "activity", seed: 970400 });
  const miss = rows.filter((tags) => tags.has("riding bicycle") && !tags.has("bicycle")).length;
  ok("pinned riding bicycle always has a bicycle", miss === 0, `miss=${miss}/40`);
}
{
  const rows = samples({ pin: "on couch", heat: "tease", seed: 970480 });
  const stand = rows.filter((tags) => tags.has("on couch") && tags.has("standing")).length;
  ok("pinned on couch never auto standing", stand === 0, `standing=${stand}/40`);
}
{
  const rows = samples({ pin: "standing", heat: "tease", seed: 970560 });
  const couch = rows.filter((tags) => tags.has("standing") && tags.has("on couch")).length;
  ok("pinned standing never auto on couch", couch === 0, `on couch=${couch}/40`);
}

// desk 是書桌，不在 INDOOR_PROP。釘書桌時場地後填，實測 18/40 張 outdoors
// （公園／球場）。鏡子不加進去：mirror selfie 在公園要靠 implies mirror。
{
  const rows = samples({ pin: "desk", heat: "tease", seed: 980000 });
  const out = rows.filter((tags) => tags.has("desk") && tags.has("outdoors")).length;
  ok("pinned desk never auto outdoors", out === 0, `outdoors=${out}/40`);
}
{
  const s = sceneSettings("tease");
  let pin = applyPin(lex, new Set(), new Set(), "desk").pinned;
  pin = applyPin(lex, pin, new Set(), "street").pinned;
  let kept = 0;
  for (let i = 0; i < 20; i += 1) {
    const tags = tagsOf(drawOne(lex, s, pin, new Set(), mulberry32(980080 + i), 980080 + i));
    if (tags.has("desk") && tags.has("street")) kept += 1;
  }
  ok("dual-pin desk + street still keeps both", kept === 20, `kept=${kept}/20`);
}
{
  const rows = samples({ pin: "livestream", heat: "activity", seed: 980160 });
  const miss = rows.filter((tags) => tags.has("livestream") && !tags.has("cellphone")).length;
  ok("pinned livestream always has a cellphone", miss === 0, `miss=${miss}/40`);
}
{
  const rows = samples({ pin: "karaoke", heat: "activity", seed: 980240 });
  const miss = rows.filter((tags) => tags.has("karaoke") && !tags.has("microphone")).length;
  ok("pinned karaoke still has a microphone", miss === 0, `miss=${miss}/40`);
}

// 床頭櫃／洗手台／白板／牌桌／檯燈都是搬不出去的室內物件，卻不在 INDOOR_PROP。
// 釘了之後 in_out 後填，實測 17～25/40 張自動 outdoors。鏡子／桌子／櫃子不加：
// 公園鏡自拍、野餐桌、攤位櫃檯、海灘置物櫃都是合法戶外。
for (const [prop, seed] of [
  ["nightstand", 990000],
  ["sink", 990080],
  ["whiteboard", 990160],
  ["poker table", 990240],
  ["desk lamp", 990320],
]) {
  const rows = samples({ pin: prop, heat: "tease", seed });
  const out = rows.filter((tags) => tags.has(prop) && tags.has("outdoors")).length;
  ok(`pinned ${prop} never auto outdoors`, out === 0, `outdoors=${out}/40`);
}
{
  const s = sceneSettings("tease");
  let pin = applyPin(lex, new Set(), new Set(), "nightstand").pinned;
  pin = applyPin(lex, pin, new Set(), "park").pinned;
  let kept = 0;
  for (let i = 0; i < 20; i += 1) {
    const tags = tagsOf(drawOne(lex, s, pin, new Set(), mulberry32(990400 + i), 990400 + i));
    if (tags.has("nightstand") && tags.has("park")) kept += 1;
  }
  ok("dual-pin nightstand + park still keeps both", kept === 20, `kept=${kept}/20`);
}

// on desk 是傢俱格，跟 on couch 同一類填序洞：釘了之後 outdoors 後填。
// under table 不加進 INDOOR_FURN：野餐桌底下是合法戶外。
{
  const rows = samples({ pin: "on desk", heat: "tease", seed: 990480 });
  const out = rows.filter((tags) => tags.has("on desk") && tags.has("outdoors")).length;
  ok("pinned on desk never auto outdoors", out === 0, `outdoors=${out}/40`);
}
{
  const s = sceneSettings("tease");
  let pin = applyPin(lex, new Set(), new Set(), "on desk").pinned;
  pin = applyPin(lex, pin, new Set(), "street").pinned;
  let kept = 0;
  for (let i = 0; i < 20; i += 1) {
    const tags = tagsOf(drawOne(lex, s, pin, new Set(), mulberry32(990560 + i), 990560 + i));
    if (tags.has("on desk") && tags.has("street")) kept += 1;
  }
  ok("dual-pin on desk + street still keeps both", kept === 20, `kept=${kept}/20`);
}

// 詞庫是 shouji／fusuma，INDOOR_PROP 舊鍵 shoji 是死字。江戶紙拉門／襖釘了
// 不該自動 outdoors。
for (const [prop, seed] of [
  ["shouji", 990640],
  ["fusuma", 990720],
]) {
  const rows = samples({ pin: prop, heat: "tease", era: "edo", seed });
  const out = rows.filter((tags) => tags.has(prop) && tags.has("outdoors")).length;
  ok(`pinned ${prop} never auto outdoors`, out === 0, `outdoors=${out}/40`);
}

// drawing (action) 沒有 ACT_PROP，寫字有筆、畫畫沒有。不蓋 paintbrush：那是
// painting (action) 的身份。時代篩選跟 writing 同一組。
{
  const rows = samples({ pin: "drawing (action)", heat: "activity", seed: 990800 });
  const tools = ["pencil", "pen", "calligraphy brush", "quill"];
  const miss = rows.filter(
    (tags) => tags.has("drawing (action)") && !tools.some((t) => tags.has(t))
  ).length;
  ok("pinned drawing (action) always has a writing tool", miss === 0, `miss=${miss}/40`);
}
{
  const rows = samples({ pin: "painting (action)", heat: "activity", seed: 990880 });
  const miss = rows.filter((tags) => tags.has("painting (action)") && !tags.has("paintbrush")).length;
  ok("pinned painting (action) still has a paintbrush", miss === 0, `miss=${miss}/40`);
}

// 釘室內物件／雨之後活動先填。戶外專屬活動（騎馬／足球／游泳）過關，
// 場地格被 INDOOR_PROP 擋住 outdoors，就空場。雨則擋住室內房間，煮飯／洗澡
// 過關同樣空場。實測 candle／desk／nightstand／rain 各 8～16/80 沒場地。
for (const [prop, heat, era, seed] of [
  ["nightstand", "tease", "modern", 991000],
  ["desk", "tease", "modern", 991080],
  ["candle", "tease", "modern", 991160],
  ["rain", "tease", "modern", 991240],
]) {
  const rows = samples({ pin: prop, heat, era, seed });
  const miss = rows.filter((tags) => tags.has(prop) && !placeOf(tags)).length;
  ok(`pinned ${prop} still gets a place`, miss === 0, `noPlace=${miss}/40`);
}
{
  const s = sceneSettings("tease");
  let pin = applyPin(lex, new Set(), new Set(), "nightstand").pinned;
  pin = applyPin(lex, pin, new Set(), "soccer").pinned;
  let kept = 0;
  for (let i = 0; i < 20; i += 1) {
    const tags = tagsOf(drawOne(lex, s, pin, new Set(), mulberry32(991320 + i), 991320 + i));
    if (tags.has("nightstand") && tags.has("soccer")) kept += 1;
  }
  ok("dual-pin nightstand + soccer still keeps both", kept === 20, `kept=${kept}/20`);
}

if (failed) {
  console.error(`\n${failed} scene/place contract test(s) failed`);
  process.exit(1);
}
console.log("\nok");
