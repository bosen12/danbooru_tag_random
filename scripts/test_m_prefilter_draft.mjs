#!/usr/bin/env node
/**
 * Hot-path draft gates (H):
 * 1) candidate set delta before/after prefilter
 * 2) M-reject count unchanged (prefilter drops ≡ anyGroupTaken M rejects)
 * 3) module stays M-only — no S/allow wiring into engine
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { defaultSettings, drawOne, indexLexicon, mulberry32 } from "../web/engine.js";
import { buildMutexIndex, prefilterPoolByMutex } from "../web/m-mutex-index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web/lexicon.json"), "utf8"));
const graph = JSON.parse(
  readFileSync(join(ROOT, "docs/superpowers/specs/2026-09-22-m-conflict-graph.json"), "utf8")
);
const lex = indexLexicon(data);
const idx = buildMutexIndex(graph);
const settings = defaultSettings(data);

let failed = 0;
function ok(name, cond, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? `\n  ${detail}` : ""}`);
  }
}

function mutexTakenFromPositive(positive) {
  const taken = new Map();
  for (const raw of positive.split(",")) {
    const tag = raw.trim();
    if (!tag) continue;
    for (const g of idx.groupsOf(tag)) {
      if (!taken.has(g)) taken.set(g, tag);
    }
  }
  return taken;
}

const pools = {
  feature: lex.bySection.feature,
  pose: lex.bySection.pose,
  clothing: lex.bySection.clothing,
  env: lex.bySection.env,
};

let totalBefore = 0;
let totalAfter = 0;
let totalDropped = 0;
let badDrop = 0;
let badKeep = 0;
let mMismatch = 0;

const N = 40;
for (let i = 0; i < N; i++) {
  const drawn = drawOne(lex, settings, new Set(), new Set(), mulberry32(5000 + i), 5000 + i);
  const taken = mutexTakenFromPositive(drawn.positive);

  for (const pool of Object.values(pools)) {
    const { kept, dropped } = prefilterPoolByMutex(idx, taken, pool);
    totalBefore += pool.length;
    totalAfter += kept.length;
    totalDropped += dropped.length;

    for (const item of dropped) {
      if (!idx.anyGroupTaken(taken, item.tag)) badDrop += 1;
    }
    for (const item of kept) {
      if (idx.anyGroupTaken(taken, item.tag)) badKeep += 1;
    }

    let mRej = 0;
    for (const item of pool) {
      if (idx.anyGroupTaken(taken, item.tag)) mRej += 1;
    }
    if (mRej !== dropped.length) mMismatch += 1;
  }
}

const poolChecks = N * Object.keys(pools).length;
ok("prefilter drops iff anyGroupTaken", badDrop === 0, `badDrop=${badDrop}`);
ok("prefilter keeps iff !anyGroupTaken", badKeep === 0, `badKeep=${badKeep}`);
ok(
  "M-reject count unchanged: dropped === full-pool M mutex rejects",
  mMismatch === 0,
  `mismatch=${mMismatch}/${poolChecks}`
);

const dropRate = totalBefore ? ((totalDropped / totalBefore) * 100).toFixed(1) : "0";
console.log(
  `delta: before=${totalBefore} after=${totalAfter} dropped=${totalDropped} (${dropRate}% · ${N} draws × 4 sections)`
);
ok("after ⊆ before", totalAfter <= totalBefore);
ok("prefilter drops candidates in practice", totalDropped > 0);

// Strip comments/strings then forbid S-path identifiers as executable refs
const src = readFileSync(join(ROOT, "web/m-mutex-index.js"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "")
  .replace(/`(?:\\.|[^`])*`/g, '""')
  .replace(/"(?:\\.|[^"])*"/g, '""')
  .replace(/'(?:\\.|[^'])*'/g, '""');
ok(
  "no S-path symbols in executable code",
  !/\ballowSlow\b/.test(src) &&
    !/\bsupportCandidateAllowed\b/.test(src) &&
    !/\breconcile\b/.test(src) &&
    !/\bsexPhaseClash\b/.test(src)
);
ok("module does not import engine.js", !src.includes("../engine") && !src.includes("./engine"));

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("all ok — prefilter draft gates green");
