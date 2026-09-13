import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  defaultSettings,
  drawOne,
  indexLexicon,
  mulberry32,
} from "../web/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web", "lexicon.json"), "utf8"));
const lex = indexLexicon(data);

function settings(heat) {
  const out = defaultSettings(data);
  out.girl = true;
  out.boy = true;
  out.heats = [heat];
  out.sceneMode = "weird";
  out.lockScene = false;
  out.counts = { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 };
  return out;
}

function drawsWith(pin, heat, n = 800) {
  const out = [];
  const s = settings(heat);
  for (let i = 0; i < n; i += 1) {
    const seed = 940000 + i;
    const draw = drawOne(lex, s, new Set([pin]), new Set(), mulberry32(seed), seed);
    out.push(new Set(draw.positive.split(",").map((raw) => raw.trim())));
  }
  return out;
}

let failed = 0;
function zero(label, count) {
  if (count === 0) console.log(`ok   ${label}`);
  else {
    failed += 1;
    console.error(`FAIL ${label}: ${count}/800`);
  }
}

// A. Final-set hard incompatibility: crossed-leg sitting pose cannot coexist with amazon position.
zero(
  "indian style first never admits amazon position",
  drawsWith("indian style", "sex").filter((tags) => tags.has("amazon position")).length
);
zero(
  "amazon position first never admits indian style",
  drawsWith("amazon position", "sex").filter((tags) => tags.has("indian style")).length
);

// A. Footwear-versus-water already rejects high heels when water is present; reverse order must too.
const WATER = new Set(["swimming", "wading", "floating", "bathing", "showering", "shared bathing", "diving"]);
zero(
  "pinned high heels never admits a non-fishing water activity",
  drawsWith("high heels", "activity").filter((tags) => [...WATER].some((tag) => tags.has(tag))).length
);

if (failed) process.exit(1);
