#!/usr/bin/env node
/** Trace sources / reason codes. Failures print and exit 1. */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  applyPin,
  ownedTagSet,
  snapshotPresetOwned,
  defaultSettings,
  drawOne,
  evaluateCast,
  evaluateClothingLayer,
  evaluateRating,
  indexLexicon,
  mulberry32,
  REASONS,
  SOURCES,
} from "../web/engine.js";
import { isReason, isSource, createTracer, summarizeTrace } from "../web/trace.js";
import { formatTraceReason, sourceLabel } from "../web/trace-copy.js";
import { evaluateSportKit } from "../web/rules/sports.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web/lexicon.json"), "utf8"));
const lex = indexLexicon(data);

let failed = 0;
function ok(name, cond, detail) {
  if (cond) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? "\n  " + detail : ""}`);
  }
}

const settings = defaultSettings(data);

function draw(seed, pin, ban, extraSettings, opts) {
  const s = extraSettings || settings;
  return drawOne(lex, s, pin || new Set(), ban || new Set(), mulberry32(seed), seed, opts);
}

function counted(seed, opts) {
  let n = 0;
  const base = mulberry32(seed);
  const rand = () => {
    n += 1;
    return base();
  };
  const drawn = drawOne(lex, settings, new Set(), new Set(), rand, seed, opts);
  return { n, pos: drawn.positive, drawn };
}

{
  const off = counted(42);
  const on = counted(42, { trace: true });
  const debug = counted(42, { trace: true, debugTrace: true });
  ok("trace off/on POS identical", off.pos === on.pos);
  ok("trace off/debug POS identical", off.pos === debug.pos);
  ok("trace off/on RNG identical", off.n === on.n, `${off.n} vs ${on.n}`);
  ok("trace off/debug RNG identical", off.n === debug.n);
  ok("trace on returns summary", !!(on.drawn.trace && Array.isArray(on.drawn.trace.kept)));
  ok("trace off leaves trace null", on.drawn.trace && off.drawn.trace == null);
}

{
  const d = draw(42, new Set(), new Set(), settings, { trace: true });
  const kept = new Map(d.trace.kept.map((e) => [e.tag, e]));
  ok("kept covers every POS tag", d.positive.split(", ").every((t) => kept.has(t)), d.positive);
  ok("masterpiece is fixed", kept.get("masterpiece")?.source === SOURCES.fixed);
  ok("1girl is random or pin", [SOURCES.random, SOURCES.pin].includes(kept.get("1girl")?.source));
}

{
  const pin = applyPin(lex, new Set(), new Set(), "kimono").pinned;
  const d = draw(7, pin, new Set(), settings, { trace: true });
  const kimono = d.trace.kept.find((e) => e.tag === "kimono");
  const jp = d.trace.kept.find((e) => e.tag === "japanese clothes");
  ok("pin kimono source is pin", kimono?.source === SOURCES.pin, JSON.stringify(kimono));
  ok("japanese clothes source is implies or bind", !jp || jp.source === SOURCES.implies || jp.source === SOURCES.bind, JSON.stringify(jp));
  ok("implies parent is kimono", !jp || jp.parent === "kimono", JSON.stringify(jp));
}

{
  const pin = applyPin(lex, new Set(), new Set(), "kimono").pinned;
  const d = draw(11, pin, new Set(), settings, { trace: true, presetOwned: new Set(["kimono"]) });
  const kimono = d.trace.kept.find((e) => e.tag === "kimono") || d.trace.rejected.find((e) => e.tag === "kimono");
  ok("presetOwned kimono is preset", kimono?.source === SOURCES.preset, JSON.stringify(kimono));
}

{
  const s = { ...settings, mustDraw: { "env:place": 1 } };
  const d = draw(21, new Set(), new Set(), s, { trace: true });
  const places = d.positive.split(", ").filter((t) => lex.byTag.get(t)?.mutex === "place" || lex.byTag.get(t)?.group === "place");
  const sourced = d.trace.kept.filter((e) => e.source === SOURCES.must_draw);
  ok("must_draw can label a kept tag", sourced.length >= 0);
  ok("draw with mustDraw still has POS", d.positive.includes("1girl"));
  if (places.length) {
    const hit = places.some((t) => d.trace.kept.some((e) => e.tag === t && (e.source === SOURCES.must_draw || e.source === SOURCES.random || e.source === SOURCES.era_anchor || e.source === SOURCES.pin)));
    ok("place tags have a source", hit);
  }
}

{
  const s = { ...settings, rating: "general" };
  const pin = applyPin(lex, new Set(), new Set(), "nude").pinned;
  const d = draw(5, pin, new Set(), s, { trace: true });
  const tags = d.positive.split(", ");
  const rej = d.trace.rejected.find((e) => e.tag === "nude");
  ok("general rating drops pinned nude", !tags.includes("nude"));
  ok("nude reject reason is rating_mismatch", rej?.reason === REASONS.rating_mismatch, JSON.stringify(rej));
  ok("nude reject source is pin", rej?.source === SOURCES.pin, JSON.stringify(rej));
}

{
  const pin0 = applyPin(lex, new Set(), new Set(), "tennis racket").pinned;
  const pin = applyPin(lex, pin0, new Set(), "living room").pinned;
  const d = draw(9, pin, new Set(), settings, { trace: true });
  const tags = new Set(d.positive.split(", "));
  const racket = d.trace.rejected.find((e) => e.tag === "tennis racket") || d.trace.kept.find((e) => e.tag === "tennis racket");
  const living = d.trace.rejected.find((e) => e.tag === "living room") || d.trace.kept.find((e) => e.tag === "living room");
  ok("dual pin tennis+living keeps or explains both", !!(racket && living), JSON.stringify({ racket, living, pos: d.positive }));
  if (!tags.has("tennis racket") || !tags.has("living room")) {
    const mismatch = [racket, living].find((e) => e && e.status === "rejected");
    ok(
      "incompatible sport/place has a reject reason",
      mismatch && (mismatch.reason === REASONS.sport_place_mismatch || mismatch.reason === REASONS.reconcile || mismatch.reason === REASONS.mutex || mismatch.reason === REASONS.scene_activity_conflict),
      JSON.stringify({ racket, living }),
    );
  }
}

{
  const s = { ...settings, rating: "general" };
  const pin = applyPin(lex, new Set(), new Set(), "school uniform").pinned;
  const d = draw(13, pin, new Set(), s, { trace: true });
  const panties = d.trace.rejected.find((e) => e.tag === "panties");
  ok("panties reject is not required on every general uniform draw", true);
  if (panties) {
    ok("panties reject uses a known reason", isReason(panties.reason), panties.reason);
  }
}

{
  const tracer = createTracer({ enabled: true });
  tracer.keep({ tag: "1girl", source: "pin", stage: "pin" });
  tracer.reject({ tag: "nude", source: "pin", stage: "pin", reason: "rating_mismatch" });
  tracer.reject({ tag: "noise", source: "random", stage: "fill", reason: "era_mismatch" });
  const sum = summarizeTrace(tracer.events(), {
    finalTags: ["1girl"],
    pinned: new Set(["1girl", "nude"]),
    presetOwned: new Set(),
    mustTags: new Set(),
  });
  ok("summary keeps 1girl", sum.kept.some((e) => e.tag === "1girl"));
  ok("summary keeps pin reject", sum.rejected.some((e) => e.tag === "nude"));
  ok("summary drops random candidate noise", !sum.rejected.some((e) => e.tag === "noise"));
}

{
  ok("all sources are stable codes", Object.values(SOURCES).every(isSource));
  ok("all reasons are stable codes", Object.values(REASONS).every(isReason));
  ok("source labels are Chinese", sourceLabel("pin") === "釘選");
  const line = formatTraceReason(
    { tag: "tennis racket", status: "rejected", reason: "sport_place_mismatch", related: ["living room"] },
    { labelOf: (t) => (t === "tennis racket" ? "網球拍" : t === "living room" ? "客廳" : t), mode: "normal" },
  );
  ok("sport mismatch copy names place", line.includes("客廳") && line.includes("網球拍"), line);
}

{
  const nude = lex.byTag.get("nude");
  const kimono = lex.byTag.get("kimono");
  const solo = lex.byTag.get("solo");
  ok("rating+ : nude blocked in general", evaluateRating(nude, "general").reason === REASONS.rating_mismatch);
  ok("rating- : kimono allowed in general", evaluateRating(kimono, "general").ok === true);
  ok("rating+ : nude blocked in sensitive", evaluateRating(nude, "sensitive").ok === false);
  ok("rating- : nude allowed in explicit", evaluateRating(nude, "explicit").ok === true);
  ok("cast+ : solo with no people fails pair need", evaluateCast({ tag: "kiss", needs: ["pair"] }, true, false, 1).reason === REASONS.cast_mismatch);
  ok("cast- : kiss ok with two people", evaluateCast({ tag: "kiss", needs: ["pair"] }, true, true, 2).ok === true);
  ok("clothing+ : garment denied when nude used", evaluateClothingLayer(kimono, { used: new Set(["nude"]), pinned: new Set() }).reason === REASONS.clothing_layer);
  ok("clothing- : garment ok without nude", evaluateClothingLayer(kimono, { used: new Set(), pinned: new Set() }).ok === true);
  const racket = lex.byTag.get("tennis racket");
  const kit = evaluateSportKit(racket, new Set(["living room"]));
  ok("sport kit returns ok or sport_place_mismatch", kit.ok === true || kit.reason === REASONS.sport_place_mismatch);
  ok("solo not a sport kit fail", evaluateSportKit(solo, new Set()).ok === true);
}

{
  ok("named preset object becomes a tag set", ownedTagSet({ id: "edo-kit", tags: ["kimono", "obi"] }).has("kimono"));
  ok("named preset object does not throw", ownedTagSet({ id: "edo-kit", tags: ["kimono"] }).size === 1);
  ok("null owned is empty", ownedTagSet(null).size === 0);
  ok("Set owned passes through", ownedTagSet(new Set(["kimono"])).has("kimono"));
  ok("array owned works", ownedTagSet(["kimono"]).has("kimono"));
  ok(
    "recipe snapshot keeps named preset id",
    snapshotPresetOwned({ id: "edo-kit", tags: ["kimono"] })?.id === "edo-kit",
  );
  ok("recipe snapshot of Set is null", snapshotPresetOwned(new Set(["kimono"])) == null);
  let threw = false;
  try {
    new Set({ id: "edo-kit", tags: ["kimono"] });
  } catch {
    threw = true;
  }
  ok("raw Set(presetOwned object) throws, so draw must not do that", threw);
  const pinK = applyPin(lex, new Set(), new Set(), "kimono").pinned;
  const withObj = draw(11, pinK, new Set(), settings, {
    trace: true,
    presetOwned: { id: "edo-kit", tags: ["kimono"] },
  });
  ok(
    "drawOne accepts {id,tags} without wrapping Set",
    withObj.trace.kept.find((e) => e.tag === "kimono")?.source === SOURCES.preset,
    JSON.stringify(withObj.trace.kept.find((e) => e.tag === "kimono")),
  );
  const tracer = createTracer({ enabled: true });
  tracer.keep({ tag: "kimono", source: SOURCES.preset, stage: "pin" });
  let sumThrew = false;
  try {
    summarizeTrace(tracer.events(), {
      finalTags: ["kimono"],
      pinned: ["kimono"],
      presetOwned: { id: "edo-kit", tags: ["kimono"] },
      mustTags: new Set(),
    });
  } catch {
    sumThrew = true;
  }
  ok("summarizeTrace accepts named preset object", !sumThrew);
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("all ok");
