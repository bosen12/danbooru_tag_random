#!/usr/bin/env node
/**
 * Read-only Monte Carlo reachability probe for lexicon tags.
 *
 * This is deliberately not a correctness test: zero samples can mean a rare tag, a pin/preset-only
 * tag, or genuine bucket starvation. It makes those candidates reproducible so a human can inspect
 * the selection pipeline before changing quotas or weights.
 *
 *   node scripts/audit_tag_reachability.mjs       # 80 draws per context
 *   node scripts/audit_tag_reachability.mjs 300   # deeper probe
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  ERAS,
  defaultSettings,
  drawOne,
  indexLexicon,
  mulberry32,
} from "../web/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web", "lexicon.json"), "utf8"));
const lex = indexLexicon(data);
const samples = Math.max(1, Math.floor(Number(process.argv[2] || 80)));
const modes = ["normal", "diverse", "weird"];
const heats = ["activity", "tease", "flash", "sex"];
const casts = ["girl", "boy", "both"];
const hits = new Map(data.tags.map((item) => [item.tag, 0]));
let draws = 0;
let seed = 880000;

function tagsOf(positive) {
  return positive
    .split(",")
    .map((raw) => raw.trim().replace(/^\(/, "").replace(/:[\d.]+\)$/, ""))
    .filter(Boolean);
}

for (const mode of modes) {
  for (const era of ERAS) {
    for (const heat of heats) {
      for (const cast of casts) {
        const settings = defaultSettings(data);
        settings.sceneMode = mode;
        settings.lockScene = mode !== "weird";
        settings.eras = [era];
        settings.heats = [heat];
        settings.girl = cast !== "boy";
        settings.boy = cast !== "girl";
        settings.drawJob = true;
        settings.counts = { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 };
        for (let i = 0; i < samples; i += 1) {
          const out = drawOne(lex, settings, new Set(), new Set(), mulberry32(seed), seed);
          seed += 1;
          draws += 1;
          for (const tag of tagsOf(out.positive)) {
            if (hits.has(tag)) hits.set(tag, hits.get(tag) + 1);
          }
        }
      }
    }
  }
}

const missed = data.tags.filter((item) => hits.get(item.tag) === 0);
console.log(`tag reachability probe: ${draws} draws (${samples} per context)`);
console.log(`reached ${data.tags.length - missed.length}/${data.tags.length}; zero-hit ${missed.length}`);

for (const section of ["subject", "feature", "pose", "clothing", "env", "quality"]) {
  const rows = missed.filter((item) => item.section === section);
  if (!rows.length) continue;
  console.log(`\n[${section}] ${rows.length}`);
  const groups = new Map();
  for (const item of rows) {
    const key = item.group || "(no group)";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item.tag);
  }
  for (const [group, tags] of [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    console.log(`  ${group}: ${tags.join(", ")}`);
  }
}
