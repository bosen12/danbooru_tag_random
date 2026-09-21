#!/usr/bin/env node
/** Fixed-seed POS / RNG / draw timing baselines. Failures print and exit 1. */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { defaultSettings, drawOne, indexLexicon, mulberry32 } from "../web/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web/lexicon.json"), "utf8"));
const lex = indexLexicon(data);
const settings = defaultSettings(data);

let failed = 0;
function ok(name, cond, detail) {
  if (cond) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? "\n  " + detail : ""}`);
  }
}

const GOLD = {
  1: {
    rng: 260,
    pos: "1girl, solo, pixie cut, purple eyes, green hair, wavy hair, small breasts, tusks, hair between eyes, skinny, completely nude, female masturbation, seiza, over shoulder, looking up, nervous smile, cum overflow, bathhouse, bath, indoors, steam, dusk, window light, nsfw, explicit, masterpiece, best quality, amazing quality",
  },
  42: {
    rng: 315,
    pos: "1girl, solo, very short hair, aqua eyes, blue hair, straight hair, huge breasts, mature female, hair between eyes, blush, bathrobe, masturbation, standing, cowboy shot, looking around, sad, rolling eyes, onsen, indoors, steam, sunrise, backlighting, stained glass, nsfw, explicit, masterpiece, best quality, amazing quality",
  },
  100: {
    rng: 365,
    pos: "1girl, solo, medium hair, purple eyes, red hair, ahoge, flat chest, two-tone hair, toned, armpits, qipao, fishnet thighhighs, thighhighs, sneakers, eating, indian style, profile, sideways glance, surprised, against window, izakaya, indoors, sunrise, spotlight, film grain, nsfw, explicit, masterpiece, best quality, amazing quality",
  },
  999: {
    rng: 349,
    pos: "1girl, solo, long hair, grey eyes, orange hair, parted bangs, medium breasts, breast bondage, body freckles, curvy, nude, masturbation, on one knee, over shoulder, looking to the side, flustered, sparkling eyes, ofuro, bath, indoors, night, nsfw, explicit, masterpiece, best quality, amazing quality",
  },
  2026: {
    rng: 383,
    pos: "1girl, solo, bob cut, grey eyes, black hair, straight hair, medium breasts, hair flower, hair scrunchie, hair over one eye, nightgown, coat, thong, fishnet thighhighs, thighhighs, blue bra, bra, drinking, reclining, wide shot, averting eyes, naughty face, exhibitionism, restaurant, indoors, day, sunlight, winter, nsfw, explicit, masterpiece, best quality, amazing quality",
  },
};

function drawCounted(seed, opts) {
  let n = 0;
  const base = mulberry32(seed);
  const rand = () => {
    n += 1;
    return base();
  };
  const drawn = drawOne(lex, settings, new Set(), new Set(), rand, seed, opts);
  return { n, pos: drawn.positive, drawn };
}

for (const seed of Object.keys(GOLD).map(Number)) {
  const a = drawCounted(seed);
  const b = drawCounted(seed);
  ok(`seed ${seed} POS matches baseline`, a.pos === GOLD[seed].pos, a.pos);
  ok(`seed ${seed} RNG count matches baseline`, a.n === GOLD[seed].rng, String(a.n));
  ok(`seed ${seed} is deterministic`, a.pos === b.pos && a.n === b.n);
}

{
  const times = [];
  for (let i = 0; i < 30; i += 1) {
    const t0 = performance.now();
    drawOne(lex, settings, new Set(), new Set(), mulberry32(i), i);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  ok("drawOne median under 80ms", median < 80, `median=${median.toFixed(2)} p95=${p95.toFixed(2)}`);
  const t0 = performance.now();
  for (let i = 0; i < 100; i += 1) {
    drawOne(lex, settings, new Set(), new Set(), mulberry32(1000 + i), 1000 + i);
  }
  const batch = performance.now() - t0;
  ok("100 draws under 8s", batch < 8000, `batch100=${batch.toFixed(1)}ms`);
  console.log(`perf drawOne median=${median.toFixed(2)}ms p95=${p95.toFixed(2)}ms batch100=${batch.toFixed(1)}ms`);
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("all ok");
