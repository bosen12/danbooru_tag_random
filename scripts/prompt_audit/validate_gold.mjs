#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REQUIRED_GOLD_FIELDS = [
  "id",
  "seed",
  "mode",
  "pinned",
  "tags",
  "verdict",
  "why",
  "rule_id",
  "review_status",
  "reviewers",
  "severity",
  "modes",
];

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) {
    const key = String(row?.[field] ?? "");
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function duplicateCount(rows, field) {
  const seen = new Set();
  let duplicates = 0;
  for (const row of rows) {
    const value = row?.[field];
    if (seen.has(value)) duplicates += 1;
    else seen.add(value);
  }
  return duplicates;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateGold(raw, gold) {
  if (!Array.isArray(raw) || !Array.isArray(gold)) {
    throw new TypeError("raw and gold must both be JSON arrays");
  }

  let missingRequired = 0;
  for (const row of gold) {
    for (const field of REQUIRED_GOLD_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(row, field)) missingRequired += 1;
    }
  }

  let rawGoldMismatch = 0;
  const pairedRows = Math.min(raw.length, gold.length);
  for (let index = 0; index < pairedRows; index += 1) {
    const rawRow = raw[index];
    const goldRow = gold[index];
    const matches = rawRow?.id === goldRow?.id
      && rawRow?.seed === goldRow?.seed
      && rawRow?.mode === goldRow?.mode
      && sameJson(rawRow?.pinned, goldRow?.pinned)
      && rawRow?.positive === (Array.isArray(goldRow?.tags) ? goldRow.tags.join(", ") : undefined);
    if (!matches) rawGoldMismatch += 1;
  }

  const rowCountMismatch = Math.abs(raw.length - gold.length);
  const duplicateIds = duplicateCount(gold, "id");
  const duplicateSeeds = duplicateCount(gold, "seed");
  const valid = rowCountMismatch === 0
    && rawGoldMismatch === 0
    && missingRequired === 0
    && duplicateIds === 0
    && duplicateSeeds === 0;

  return {
    valid,
    rows: gold.length,
    rawRows: raw.length,
    verdicts: countBy(gold, "verdict"),
    severities: countBy(gold, "severity"),
    rawGoldMismatch,
    rowCountMismatch,
    missingRequired,
    duplicateIds,
    duplicateSeeds,
  };
}

function main() {
  const [rawPath, goldPath] = process.argv.slice(2);
  if (!rawPath || !goldPath) {
    console.error("usage: node validate_gold.mjs <raw.json> <gold.json>");
    process.exitCode = 2;
    return;
  }

  try {
    const raw = JSON.parse(readFileSync(resolve(rawPath), "utf8"));
    const gold = JSON.parse(readFileSync(resolve(goldPath), "utf8"));
    const summary = validateGold(raw, gold);
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.valid) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
