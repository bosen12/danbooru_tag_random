#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateSupportShadow } from "../../web/shadow-validator.js";

function peopleFromTags(tags) {
  if (tags.includes("solo")) return 1;
  let count = 0;
  let found = false;
  for (const tag of tags) {
    const match = /^(\d+)(girls?|boys?)$/.exec(tag);
    if (!match) continue;
    count += Number(match[1]);
    found = true;
  }
  return found ? count : undefined;
}

export function evaluateShadow(gold) {
  if (!Array.isArray(gold)) throw new TypeError("gold must be a JSON array");
  const rows = gold.filter((row) => row?.review_status === "adjudicated");
  const hardRows = rows.filter((row) => row.severity === "hard");
  const detectedHardIds = [];
  const falsePositiveIds = [];
  const softFalsePositiveIds = [];
  const perRule = {};

  for (const row of rows) {
    const violations = validateSupportShadow({
      tags: row.tags,
      pinned: row.pinned,
      mode: row.mode,
      people: peopleFromTags(row.tags),
    }).filter((violation) => violation.severity === "hard");
    if (!violations.length) continue;

    if (row.severity === "hard") detectedHardIds.push(row.id);
    else falsePositiveIds.push(row.id);
    if (row.severity === "soft") softFalsePositiveIds.push(row.id);

    for (const violation of violations) {
      const metrics = perRule[violation.rule_id] ?? {
        detectedRows: 0,
        hardRows: 0,
        falsePositiveRows: 0,
      };
      metrics.detectedRows += 1;
      if (row.severity === "hard") metrics.hardRows += 1;
      else metrics.falsePositiveRows += 1;
      perRule[violation.rule_id] = metrics;
    }
  }

  detectedHardIds.sort((a, b) => a - b);
  falsePositiveIds.sort((a, b) => a - b);
  softFalsePositiveIds.sort((a, b) => a - b);
  const detectedHard = detectedHardIds.length;
  const detectedRows = detectedHard + falsePositiveIds.length;

  return {
    adjudicatedRows: rows.length,
    hardGold: hardRows.length,
    detectedHard,
    detectedHardIds,
    falsePositiveRows: falsePositiveIds.length,
    falsePositiveIds,
    softFalsePositiveRows: softFalsePositiveIds.length,
    softFalsePositiveIds,
    precision: detectedRows ? detectedHard / detectedRows : null,
    coverage: hardRows.length ? detectedHard / hardRows.length : null,
    perRule,
  };
}

function main() {
  const [goldPath] = process.argv.slice(2);
  if (!goldPath) {
    console.error("usage: node eval_shadow.mjs <gold.json>");
    process.exitCode = 2;
    return;
  }

  try {
    const gold = JSON.parse(readFileSync(resolve(goldPath), "utf8"));
    console.log(JSON.stringify(evaluateShadow(gold), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
