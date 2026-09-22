#!/usr/bin/env node
/** Baseline: M index ≡ engine extraMutex / siblings (via conflict graph). */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { indexLexicon } from "../web/engine.js";
import { buildMutexIndex } from "../web/m-mutex-index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web/lexicon.json"), "utf8"));
const graph = JSON.parse(
  readFileSync(join(ROOT, "docs/superpowers/specs/2026-09-22-m-conflict-graph.json"), "utf8")
);
const lex = indexLexicon(data);
const idx = buildMutexIndex(graph);

let failed = 0;
function ok(name, cond, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? `\n  ${detail}` : ""}`);
  }
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

ok("graph kind is M", graph.kind === "M");
ok("index kind is M", idx.kind === "M");

// groupsOf ≡ item._mx (extraMutex cache filled by indexLexicon)
let groupMismatches = 0;
const samples = [];
for (const item of data.tags) {
  const fromEngine = [...(item._mx || [])].sort();
  const fromIdx = [...idx.groupsOf(item.tag)].sort();
  if (fromEngine.join("\0") !== fromIdx.join("\0")) {
    groupMismatches += 1;
    if (samples.length < 5) samples.push({ tag: item.tag, engine: fromEngine, idx: fromIdx });
  }
}
ok(
  `tag→groups matches engine extraMutex for all ${data.tags.length} tags`,
  groupMismatches === 0,
  samples.map((s) => JSON.stringify(s)).join(" | ")
);

// siblings ≡ lex.siblings (engine sibling exclusion)
let sibMismatches = 0;
const sibSamples = [];
for (const item of data.tags) {
  const eng = new Set(lex.siblings.get(item.tag) || []);
  const ours = idx.siblingsOf(item.tag);
  if (!sameSet(eng, ours instanceof Set ? ours : new Set(ours))) {
    // tags with no groups may be absent from graph.tagToSiblings
    const engEmpty = eng.size === 0;
    const oursEmpty = !(ours instanceof Set ? ours.size : ours.length);
    if (engEmpty && oursEmpty) continue;
    sibMismatches += 1;
    if (sibSamples.length < 5) {
      sibSamples.push({
        tag: item.tag,
        onlyEngine: [...eng].filter((t) => !(ours instanceof Set ? ours.has(t) : ours.includes(t))).slice(0, 8),
        onlyIdx: [...(ours instanceof Set ? ours : ours)].filter((t) => !eng.has(t)).slice(0, 8),
      });
    }
  }
}
ok(
  "tag→siblings matches engine siblings map",
  sibMismatches === 0,
  sibSamples.map((s) => JSON.stringify(s)).join(" | ")
);

// isBusy / anyGroupTaken smoke vs mutexTaken simulation
{
  const taken = new Map();
  // occupy sex_act with '69' if present
  const tag = data.tags.find((t) => (t._mx || []).includes("sex_act"));
  if (tag) {
    for (const g of idx.groupsOf(tag.tag)) taken.set(g, tag.tag);
    const other = data.tags.find(
      (t) => t.tag !== tag.tag && (t._mx || []).some((g) => taken.has(g))
    );
    ok("isBusy false for occupant itself", idx.isBusy(taken, tag.tag) === false);
    if (other) {
      ok("isBusy true for sibling in same group", idx.isBusy(taken, other.tag) === true);
      ok("anyGroupTaken true for sibling", idx.anyGroupTaken(taken, other.tag) === true);
    } else {
      ok("found sibling for busy smoke", false);
    }
  } else {
    ok("found sex_act tag for busy smoke", false);
  }
}

// microbench: anyGroupTaken vs scanning extraMutex-style arrays
{
  const taken = new Map();
  for (const item of data.tags.slice(0, 40)) {
    for (const g of idx.groupsOf(item.tag)) {
      if (!taken.has(g)) taken.set(g, item.tag);
    }
  }
  const candidates = data.tags;
  const N = 200;
  let t0 = performance.now();
  for (let i = 0; i < N; i++) {
    for (const item of candidates) idx.anyGroupTaken(taken, item.tag);
  }
  const idxMs = performance.now() - t0;
  t0 = performance.now();
  for (let i = 0; i < N; i++) {
    for (const item of candidates) {
      for (const g of item._mx || []) {
        if (taken.has(g)) break;
      }
    }
  }
  const engMs = performance.now() - t0;
  console.log(
    `perf anyGroupTaken ${N}×${candidates.length}: idx=${idxMs.toFixed(1)}ms engine-loop=${engMs.toFixed(1)}ms`
  );
  ok("index path runs (smoke)", idxMs >= 0 && engMs >= 0);
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("all ok — M index baseline green");
