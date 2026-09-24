#!/usr/bin/env node
/**
 * 疊印台（web6/fuse-bed.js）的回歸測試：版上放牌、帶上、換下、拿掉、關係、校樣怎麼疊。
 * 直接用真的 engine 和詞庫跑，確認疊印台沒有自己長一套規則。秒跑完，不需要 ComfyUI。
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { indexLexicon, applyPin, contradictions, ACT_PLACE } from "../web/engine.js";
import { emptyBed, sanitizeBed, placeCard, removeCard, setLead, relationsOf, proofLayers, canLead, REGISTERS } from "../web6/fuse-bed.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web/lexicon.json"), "utf8"));
const lex = indexLexicon(data);
const manifest = JSON.parse(readFileSync(join(ROOT, "web/cards/manifest.json"), "utf8").trim() || "{}");
const deps = { lex, applyPin };
const rel = (bed) => relationsOf(bed, { lex, contradictions, actPlace: ACT_PLACE });

let failed = 0;
function ok(name, cond, detail) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL ${name}${detail ? "\n  " + detail : ""}`);
  } else console.log(`ok   ${name}`);
}

const put = (bed, ...tags) => tags.reduce((b, t) => placeCard(b, t, deps).bed, bed);

/* ---------- 放牌、同一格換下 ---------- */
{
  const a = placeCard(emptyBed(), "long hair", deps);
  ok("放上一張牌", a.bed.pins.join() === "long hair" && a.events[0].kind === "place");
  const b = placeCard(a.bed, "short hair", deps);
  ok("同一格只留一張：短髮換掉長髮", b.bed.pins.includes("short hair") && !b.bed.pins.includes("long hair"));
  const rep = b.events.find((e) => e.kind === "replace");
  ok("換下會回報是哪一張、為什麼", rep && rep.out === "long hair" && rep.by === "short hair" && rep.why === "slot", JSON.stringify(b.events));
  ok("已經在版上的牌再放一次什麼都不做", placeCard(b.bed, "short hair", deps).events.length === 0);
}

/* ---------- 附帶：帶上來、一起拿掉 ---------- */
{
  const withImply = data.tags.find((t) => (t.implies || []).length && lex.byTag.has(t.implies[0]) && t.tag === "kimono") || data.tags.find((t) => (t.implies || []).length);
  const r = placeCard(emptyBed(), withImply.tag, deps);
  const carried = r.events.filter((e) => e.kind === "carry").map((e) => e.tag);
  ok(`「${withImply.tag}」把 implies 帶上來`, carried.length > 0 && carried.every((t) => r.bed.carried[t] === withImply.tag), JSON.stringify(r.events));
  ok("帶上來的關係畫成附帶", rel(r.bed).some((x) => x.kind === "carry" && x.a === withImply.tag));
  const gone = removeCard(r.bed, withImply.tag);
  ok("拿掉它，被它帶上來的一起拿掉", gone.bed.pins.length === 0, gone.bed.pins.join());
  ok("拿掉會回報連帶拿掉了哪些", gone.events[0].tags.length === 1 + carried.length);
}

/* ---------- 時代對不上 ---------- */
{
  const eraOf = (t) => (t.era || []).filter((e) => e !== "any");
  let pair = null;
  for (const a of data.tags) {
    if (!eraOf(a).length) continue;
    const b = data.tags.find((x) => eraOf(x).length && !eraOf(x).some((e) => eraOf(a).includes(e)) && x.mutex !== a.mutex && !(a.implies || []).includes(x.tag));
    if (b) {
      pair = [a.tag, b.tag];
      break;
    }
  }
  if (pair) {
    const r = placeCard(put(emptyBed(), pair[0]), pair[1], deps);
    const rep = r.events.find((e) => e.kind === "replace" && e.out === pair[0]);
    ok(`時代不同（${pair[0]} → ${pair[1]}）會被換下並說是時代`, rep && rep.why === "era", JSON.stringify(r.events));
  } else ok("找得到兩個不同時代的字來測", false);
}

/* ---------- 關係：呼應、相剋 ---------- */
{
  const act = Object.keys(ACT_PLACE).find((a) => lex.byTag.has(a) && [...ACT_PLACE[a]].some((p) => lex.byTag.has(p)));
  const place = [...ACT_PLACE[act]].find((p) => lex.byTag.has(p));
  const bed = put(emptyBed(), act, place);
  ok(`活動配上它的地點是呼應（${act} × ${place}）`, rel(bed).some((x) => x.kind === "echo" && x.a === act && x.b === place));
  const lib = put(emptyBed(), "library", "outdoors");
  ok("圖書館（室內）配室外是相剋", rel(lib).some((x) => x.kind === "clash" && [x.a, x.b].includes("library") && [x.a, x.b].includes("outdoors")), JSON.stringify(rel(lib)));
  ok("每條關係兩端都在版上", rel(put(emptyBed(), "kimono", "library", "outdoors", "reading")).every((x) => x.a !== x.b));
}

/* ---------- 主版 ---------- */
{
  const bed = put(emptyBed(), "smile", "kimono");
  const kindOf = (t) => {
    const m = manifest[t];
    if (!m) return null;
    if (/\bno humans\b/.test(m.positive)) return /\bscenery\b/.test(m.positive) ? "ground" : /\bstill life\b/.test(m.positive) ? "prop" : null;
    return "figure";
  };
  const frameOf = (t) => {
    const p = manifest[t]?.positive || "";
    return /\bfull body\b/.test(p) ? 3 : /\bcowboy shot\b/.test(p) ? 2 : /\bupper body\b/.test(p) ? 1 : 0;
  };
  const suitOf = (t) => ({ subject: "cast", feature: "look", clothing: "wear", pose: "pose", env: "scene" })[lex.byTag.get(t)?.section] || null;
  if (manifest.kimono && manifest.smile) {
    const layers = proofLayers({ bed, extra: [], suitOf, kindOf, frameOf });
    ok("主版挑畫得完整的那張（全身的和服，不是臉部特寫的微笑）", layers.figure?.tag === "kimono", JSON.stringify(layers.figure));
    const carriedWins = proofLayers({ bed: put(emptyBed(), "kimono"), extra: [], suitOf, kindOf, frameOf });
    ok("被帶上來的牌不搶主版", carriedWins.figure?.tag === "kimono", JSON.stringify(carriedWins.figure));
    const libBed = put(emptyBed(), "library");
    if (libBed.carried.indoors && kindOf("indoors") === "ground" && kindOf("library") === "ground") {
      ok("底色用你放的（圖書館），不是它帶上來的（室內）", proofLayers({ bed: libBed, extra: [], suitOf, kindOf, frameOf }).ground?.tag === "library");
    }
    const led = setLead(bed, "smile");
    ok("指定主版就用指定的", proofLayers({ bed: led, extra: [], suitOf, kindOf, frameOf }).figure.tag === "smile");
    ok("再指定一次就交回自動", setLead(led, "smile").lead === null);
    ok("主版被拿掉就回到自動", removeCard(led, "smile").bed.lead === null);
    const engineOnly = proofLayers({ bed: emptyBed(), extra: ["kimono", "cherry blossoms"], suitOf, kindOf, frameOf });
    ok("你沒放的那一層用引擎的，並標成引擎", engineOnly.figure?.src === "engine" && engineOnly.ground?.src === "engine", JSON.stringify(engineOnly));
    ok("底色只能是風景牌、不是人", kindOf("cherry blossoms") === "ground" && canLead("kimono", { suitOf, kindOf }) && !canLead("cherry blossoms", { suitOf, kindOf }));
  } else console.log("skip 主版（web/cards 還沒烤）");
}

/* ---------- 存檔讀回來 ---------- */
{
  const clean = sanitizeBed({ pins: ["kimono", "nope-not-a-tag", "kimono"], lead: "ghost", carried: { x: "kimono", "japanese clothes": "gone" } }, (t) => lex.byTag.has(t));
  ok("讀回來的版：不認識的字、重複的字、懸空的附帶、不在版上的主版都丟掉", clean.pins.join() === "kimono" && clean.lead === null && Object.keys(clean.carried).length === 0, JSON.stringify(clean));
  ok("壞掉的存檔變成空白的版", sanitizeBed(null, () => true).pins.length === 0 && sanitizeBed({ pins: "x" }, () => true).pins.length === 0);
  ok("六個套版，罩色在上、底色在下", REGISTERS[0] === "style" && REGISTERS.at(-1) === "scene" && REGISTERS.length === 6);
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nok");
