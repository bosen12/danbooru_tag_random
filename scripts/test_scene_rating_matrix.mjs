#!/usr/bin/env node
/**
 * Acceptance matrix: sceneMode × rating (G / R / Y case ids).
 * G locked order: TEST FIRST — this file only. scene-policy.js is H's job.
 *
 * Run: node scripts/test_scene_rating_matrix.mjs
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  applyPin,
  defaultSettings,
  drawOne,
  indexLexicon,
  mulberry32,
  placeFitsActs,
  sanitizeSettings,
  sceneModeOf,
} from "../web/engine.js";
import { explicitOnly, ratingBlocked } from "../web/rules/rating.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web/lexicon.json"), "utf8"));
const lex = indexLexicon(data);

/** UI / contract constant (mirrors web/boot.js). Engine may enforce via ratingBlocked. */
const RATING_BLOCKS_HEAT = { general: ["flash", "sex"], sensitive: [], explicit: [] };

let failed = 0;
function ok(id, cond, detail) {
  if (cond) console.log(`ok   ${id}`);
  else {
    failed += 1;
    console.error(`FAIL ${id}${detail ? "\n  " + detail : ""}`);
  }
}

function settingsOf(over = {}) {
  // Round-trip through sanitizeSettings (= normalize path): derives lockScene from sceneMode.
  return sanitizeSettings({ ...defaultSettings(data), ...over }, data);
}

function posTags(drawn) {
  return String(drawn.positive || "")
    .split(", ")
    .map((t) => t.trim())
    .filter(Boolean);
}

function drawPos(settings, seed, pinned = new Set()) {
  return drawOne(lex, settings, pinned, new Set(), mulberry32(seed), seed);
}

const MODES = ["normal", "diverse", "weird"];
const DRAW_N = 40;

// --- GREEN -------------------------------------------------------------------

{
  const s = settingsOf({ rating: "explicit", sceneMode: "normal" });
  ok("G1", s.sceneMode === "normal" && s.lockScene === true, `sceneMode=${s.sceneMode} lockScene=${s.lockScene}`);
  // Behavioral: place/act pairing still enforced under normal (sleeping ⊄ street).
  ok(
    "G1.place",
    placeFitsActs("street", new Set(["sleeping"]), true) === false,
    "sleeping+street must fail under realistic/normal"
  );
  const pin = applyPin(lex, new Set(), new Set(), "sleeping").pinned;
  let streetHits = 0;
  for (let i = 0; i < DRAW_N; i += 1) {
    const tags = new Set(posTags(drawPos(s, 510000 + i, pin)));
    if (["street", "city", "cityscape"].some((t) => tags.has(t))) streetHits += 1;
  }
  ok("G1.draw", streetHits === 0, `sleeping+street/city hits=${streetHits}/${DRAW_N}`);
}

{
  const s = settingsOf({ rating: "explicit", sceneMode: "diverse" });
  // diverse ≠ weird; realistic off (sceneModeOf not normal); lockScene derived true.
  ok(
    "G2",
    sceneModeOf(s) === "diverse" &&
      sceneModeOf(s) !== "weird" &&
      s.lockScene === true &&
      s.sceneMode === "diverse",
    `sceneMode=${s.sceneMode} lockScene=${s.lockScene} of=${sceneModeOf(s)}`
  );
}

{
  const s = settingsOf({ rating: "explicit", sceneMode: "weird" });
  ok(
    "G3",
    s.lockScene === false && s.sceneMode === "weird" && sceneModeOf(s) === "weird",
    `sceneMode=${s.sceneMode} lockScene=${s.lockScene}`
  );
}

{
  const leaks = [];
  for (const mode of MODES) {
    const s = settingsOf({
      rating: "general",
      sceneMode: mode,
      heats: ["tease", "flash", "sex"],
    });
    for (let i = 0; i < DRAW_N; i += 1) {
      for (const t of posTags(drawPos(s, 520000 + MODES.indexOf(mode) * 1000 + i))) {
        const it = lex.byTag.get(t);
        if (it && ratingBlocked(it, "general")) leaks.push(`${mode}:${t}`);
      }
    }
  }
  ok("G4", leaks.length === 0, leaks.slice(0, 8).join(", "));
}

{
  const leaks = [];
  for (const mode of MODES) {
    const s = settingsOf({
      rating: "sensitive",
      sceneMode: mode,
      heats: ["tease", "flash", "sex"],
    });
    for (let i = 0; i < DRAW_N; i += 1) {
      for (const t of posTags(drawPos(s, 530000 + MODES.indexOf(mode) * 1000 + i))) {
        const it = lex.byTag.get(t);
        if (it && explicitOnly(it)) leaks.push(`${mode}:${t}`);
        // tease-ok content may appear — do not fail if present
      }
    }
  }
  ok("G5", leaks.length === 0, leaks.slice(0, 8).join(", "));
}

{
  // missing sceneMode + lockScene:true → normal (never diverse)
  const raw = { lockScene: true, rating: "explicit" };
  const of = sceneModeOf(raw);
  const norm = sanitizeSettings(raw, data);
  ok(
    "G6",
    of === "normal" && norm.sceneMode === "normal" && of !== "diverse" && norm.sceneMode !== "diverse",
    `sceneModeOf=${of} sanitize=${norm.sceneMode}`
  );
}

{
  // missing sceneMode + lockScene:false → weird
  const raw = { lockScene: false, rating: "explicit" };
  const of = sceneModeOf(raw);
  const norm = sanitizeSettings(raw, data);
  ok(
    "G7",
    of === "weird" && norm.sceneMode === "weird" && norm.lockScene === false,
    `sceneModeOf=${of} sanitize=${norm.sceneMode} lock=${norm.lockScene}`
  );
}

{
  // explicit sceneMode:"diverse" round-trip via defaultSettings path unchanged
  const base = defaultSettings(data);
  const round = sanitizeSettings({ ...base, sceneMode: "diverse" }, data);
  ok(
    "G8",
    round.sceneMode === "diverse" && round.lockScene === true,
    `sceneMode=${round.sceneMode} lockScene=${round.lockScene}`
  );
}

// --- RED (assert these bad conditions do NOT hold) ---------------------------

{
  // R1: general + heats flash/sex must not emit flash/sex-group or heat-only tags
  const s = settingsOf({
    rating: "general",
    sceneMode: "normal",
    heats: ["flash", "sex", "tease"],
  });
  const bad = [];
  for (let i = 0; i < DRAW_N; i += 1) {
    for (const t of posTags(drawPos(s, 540000 + i))) {
      const it = lex.byTag.get(t);
      if (!it) continue;
      if (it.group === "flash" || it.group === "sex" || it.mutex === "sex_act") {
        bad.push(`${t}(group=${it.group},mutex=${it.mutex})`);
      }
      if (ratingBlocked(it, "general")) bad.push(`${t}:ratingBlocked`);
    }
  }
  ok("R1", bad.length === 0, bad.slice(0, 8).join(", "));
}

{
  // R2: diverse must NOT behave as weird — lockScene stays on after normalize
  const s = settingsOf({ sceneMode: "diverse", rating: "explicit" });
  const bad = !(sceneModeOf(s) === "diverse" && s.lockScene === true);
  ok("R2", !bad, `sceneMode=${s.sceneMode} lockScene=${s.lockScene} (must stay lock on)`);
}

{
  // R3: missing sceneMode never resolves to diverse
  const cases = [
    {},
    { lockScene: true },
    { lockScene: false },
    { rating: "explicit" },
  ];
  const hits = cases.filter((raw) => {
    const of = sceneModeOf(raw);
    const norm = sanitizeSettings(raw, data).sceneMode;
    return of === "diverse" || norm === "diverse";
  });
  ok("R3", hits.length === 0, `resolved diverse for ${JSON.stringify(hits)}`);
}

{
  // R4: normal keeps realistic place pairing — sleeping + street conflict
  const conflict = placeFitsActs("street", new Set(["sleeping"]), /* realistic */ true) === false;
  const s = settingsOf({ rating: "explicit", sceneMode: "normal", heats: ["tease"] });
  const pin = applyPin(lex, new Set(), new Set(), "sleeping").pinned;
  let streetHits = 0;
  for (let i = 0; i < DRAW_N; i += 1) {
    const tags = new Set(posTags(drawPos(s, 550000 + i, pin)));
    if (tags.has("street")) streetHits += 1;
  }
  ok("R4", conflict && streetHits === 0, `placeFitsActs=${conflict} drawStreet=${streetHits}`);
}

// --- YELLOW ------------------------------------------------------------------

{
  // Y1: contract RATING_BLOCKS_HEAT; engine outcome under general still rating-clean
  ok(
    "Y1.contract",
    RATING_BLOCKS_HEAT.general.join(",") === "flash,sex" &&
      Array.isArray(RATING_BLOCKS_HEAT.sensitive) &&
      RATING_BLOCKS_HEAT.sensitive.length === 0 &&
      Array.isArray(RATING_BLOCKS_HEAT.explicit) &&
      RATING_BLOCKS_HEAT.explicit.length === 0,
    JSON.stringify(RATING_BLOCKS_HEAT)
  );
  const blocked = RATING_BLOCKS_HEAT.general;
  const heats = ["flash", "sex", "tease"];
  const effectiveExcluded = heats.filter((h) => blocked.includes(h));
  ok(
    "Y1.heats",
    effectiveExcluded.includes("flash") && effectiveExcluded.includes("sex"),
    `effectiveExcluded=${effectiveExcluded}`
  );
  const s = settingsOf({
    rating: "general",
    heats: ["flash", "sex", "tease"],
    sceneMode: "normal",
  });
  const leaks = [];
  for (let i = 0; i < DRAW_N; i += 1) {
    for (const t of posTags(drawPos(s, 560000 + i))) {
      const it = lex.byTag.get(t);
      if (it && ratingBlocked(it, "general")) leaks.push(t);
    }
  }
  ok("Y1.draw", leaks.length === 0, leaks.slice(0, 8).join(", "));
}

if (failed) {
  console.error(`\n${failed} case(s) failed`);
  process.exit(1);
}
console.log("\nall scene×rating matrix cases passed");
