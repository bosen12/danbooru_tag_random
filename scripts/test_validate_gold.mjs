#!/usr/bin/env node
import { validateGold } from "./prompt_audit/validate_gold.mjs";

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

const raw = [{ id: 1, seed: 10, mode: "normal", pinned: [], positive: "1girl, solo" }];
const gold = [{
  id: 1,
  seed: 10,
  mode: "normal",
  pinned: [],
  tags: ["1girl", "solo"],
  verdict: "ok",
  why: "",
  rule_id: "",
  review_status: "adjudicated",
  reviewers: ["grok-4.6"],
  severity: "",
  modes: [],
}];

const valid = validateGold(raw, gold);
eq("valid fixture is accepted", valid.valid, true);
eq("valid fixture has zero mismatches", valid.rawGoldMismatch, 0);
eq("valid fixture counts verdict", valid.verdicts, { ok: 1 });
eq("valid fixture counts empty severity", valid.severities, { "": 1 });

const invalidGold = structuredClone(gold);
invalidGold[0].tags = ["1girl", "standing"];
const invalid = validateGold(raw, invalidGold);
eq("tag mismatch is rejected", invalid.valid, false);
eq("tag mismatch is counted", invalid.rawGoldMismatch, 1);

const missingGold = structuredClone(gold);
delete missingGold[0].reviewers;
const missing = validateGold(raw, missingGold);
eq("missing required field is rejected", missing.valid, false);
eq("missing required field is counted", missing.missingRequired, 1);

const duplicate = validateGold([...raw, { ...raw[0] }], [...gold, { ...gold[0] }]);
eq("duplicate id is counted", duplicate.duplicateIds, 1);
eq("duplicate seed is counted", duplicate.duplicateSeeds, 1);

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}

console.log("\nok");
