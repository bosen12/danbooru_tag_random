#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyPin,
  defaultSettings,
  drawOne,
  indexLexicon,
  mulberry32,
} from "../web/engine.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(root, "web/lexicon.json"), "utf8"));
const lex = indexLexicon(data);
let failed = 0;

function ok(name, condition, detail = "") {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${name}${detail ? `\n  ${detail}` : ""}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

function pinAll(tags) {
  let pinned = new Set();
  for (const tag of tags) pinned = applyPin(lex, pinned, new Set(), tag).pinned;
  return pinned;
}

function countProne(settings, pinned, seedStart, draws = 300) {
  let count = 0;
  for (let index = 0; index < draws; index += 1) {
    const draw = drawOne(
      lex,
      settings,
      pinned,
      new Set(),
      mulberry32(seedStart + index),
      seedStart + index,
    );
    if (draw.positive.split(", ").includes("on stomach")) count += 1;
  }
  return count;
}

const normal = { ...defaultSettings(data), counts: { ...defaultSettings(data).counts, pose: 10 } };
const weird = { ...normal, sceneMode: "weird", lockScene: false };

const normalEatingProne = countProne(normal, pinAll(["1girl", "solo", "eating"]), 910000);
ok("normal single-actor eating remains non-prone", normalEatingProne === 0, `prone=${normalEatingProne}/300`);

const normalCookingProne = countProne(normal, pinAll(["1girl", "solo", "cooking"]), 910500);
ok("normal single-actor cooking remains non-prone", normalCookingProne === 0, `prone=${normalCookingProne}/300`);

const weirdEatingProne = countProne(weird, pinAll(["1girl", "solo", "eating"]), 911000);
ok("weird eating may be prone because the adjudicated rule excludes weird", weirdEatingProne > 0, `prone=${weirdEatingProne}/300`);

const weirdCookingProne = countProne(weird, pinAll(["1girl", "solo", "cooking"]), 912000);
ok("weird cooking may be prone because it is adjudicated soft", weirdCookingProne > 0, `prone=${weirdCookingProne}/300`);

const pairEatingProne = countProne(normal, pinAll(["1girl", "1boy", "eating"]), 913000);
ok("unattributed pair is not rejected by same-actor support rule", pairEatingProne > 0, `prone=${pairEatingProne}/300`);

const pinnedConflict = drawOne(
  lex,
  normal,
  pinAll(["eating", "on stomach"]),
  new Set(),
  mulberry32(914000),
  914000,
);
ok("fully pinned support conflict is preserved", pinnedConflict.positive.split(", ").includes("eating")
  && pinnedConflict.positive.split(", ").includes("on stomach"));
ok("fully pinned support conflict is reported as warning", pinnedConflict.shadowViolations.some((violation) =>
  violation.rule_id === "support:eating-prone"
  && violation.severity === "warning"
  && violation.origin === "pinned-conflict"));

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}

console.log("\nok");
