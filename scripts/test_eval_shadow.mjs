#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateShadow } from "./prompt_audit/eval_shadow.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gold = JSON.parse(readFileSync(join(root, "scripts/prompt_audit/r42_gold.json"), "utf8"));
const result = evaluateShadow(gold);
const expectedIds = [35, 181, 340, 341, 378, 389, 393];

let failed = 0;
function eq(name, got, want) {
  const actual = JSON.stringify(got);
  const expected = JSON.stringify(want);
  if (actual !== expected) {
    failed += 1;
    console.error(`FAIL ${name}\n  got  ${actual}\n  want ${expected}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

eq("r42 hard-gold count", result.hardGold, 18);
eq("support shadow detects adjudicated hard ids", result.detectedHardIds, expectedIds);
eq("support shadow detects seven hard rows", result.detectedHard, 7);
eq("support shadow has no non-hard false positives", result.falsePositiveRows, 0);
eq("support shadow has no soft false positives", result.softFalsePositiveRows, 0);
eq("support shadow precision", result.precision, 1);
eq("support shadow coverage", result.coverage, 7 / 18);

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}

console.log("\nok");
