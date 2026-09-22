#!/usr/bin/env node
/** Wired hot-path gates: candidate delta, M-reject equiv, baseline still green. */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { defaultSettings, drawOne, indexLexicon, mulberry32 } from "../web/engine.js";
import { buildMutexIndexFromLex, prefilterPoolByMutex } from "../web/m-mutex-index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web/lexicon.json"), "utf8"));
const lex = indexLexicon(data);
const idx = buildMutexIndexFromLex(lex);
const settings = defaultSettings(data);
const eng = readFileSync(join(ROOT, "web/engine.js"), "utf8");

let failed = 0;
function ok(name, cond, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? `\n  ${detail}` : ""}`);
  }
}

ok("engine imports m-mutex-index", eng.includes('from "./m-mutex-index.js"'));
ok("drawOne builds/caches mIdx", eng.includes("lex._mIdx") && eng.includes("buildMutexIndexFromLex"));
ok("fill uses mPool before allow", eng.includes("mPool(lex.bySection[section])"));
ok("takeFromPool accepts mPre", eng.includes("function takeFromPool(pool, count, rand, commit, prefer, allow, mPre)"));
ok("allowSlow not referenced by m-mutex-index", !readFileSync(join(ROOT, "web/m-mutex-index.js"), "utf8").includes("allowSlow"));

// Candidate delta + M equiv on live mutexTaken snapshots mid-draw approximation from final POS
let before = 0, after = 0, dropped = 0, mismatch = 0;
for (let i = 0; i < 40; i++) {
  const d = drawOne(lex, settings, new Set(), new Set(), mulberry32(7000 + i), 7000 + i);
  const taken = new Map();
  for (const raw of d.positive.split(",")) {
    const tag = raw.trim();
    for (const g of idx.groupsOf(tag)) if (!taken.has(g)) taken.set(g, tag);
  }
  for (const section of ["feature", "pose", "clothing", "env"]) {
    const pool = lex.bySection[section];
    const r = prefilterPoolByMutex(idx, taken, pool);
    before += pool.length;
    after += r.kept.length;
    dropped += r.dropped.length;
    let m = 0;
    for (const item of pool) if (idx.anyGroupTaken(taken, item.tag)) m += 1;
    if (m !== r.dropped.length) mismatch += 1;
  }
}
ok("M-reject count unchanged under wired index", mismatch === 0, `mismatch=${mismatch}`);
ok("candidate set shrinks", after < before && dropped > 0);
console.log(`delta: before=${before} after=${after} dropped=${dropped} (${((dropped / before) * 100).toFixed(1)}%)`);

// Timing
const times = [];
for (let i = 0; i < 50; i++) {
  const t0 = performance.now();
  drawOne(lex, settings, new Set(), new Set(), mulberry32(8000 + i), 8000 + i);
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)];
const p95 = times[Math.floor(times.length * 0.95)];
console.log(`perf wired drawOne median=${median.toFixed(2)}ms p95=${p95.toFixed(2)}ms`);
ok("median still under 80ms", median < 80);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("all ok — hot-path wired gates green");
