#!/usr/bin/env node
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { defaultSettings, drawOne, indexLexicon, mulberry32 } from "../web/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web/lexicon.json"), "utf8"));
const lex = indexLexicon(data);
const settings = defaultSettings(data);

let failed = 0;
function ok(name, cond, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? `\n  ${detail}` : ""}`);
  }
}

function forbiddenKeys(obj, bad) {
  const hit = [];
  const walk = (v, path) => {
    if (!v || typeof v !== "object") return;
    for (const [k, child] of Object.entries(v)) {
      if (bad.has(k)) hit.push(`${path}.${k}`);
      walk(child, `${path}.${k}`);
    }
  };
  walk(obj, "event");
  return hit;
}

{
  const stages = [];
  const drawn = drawOne(lex, settings, new Set(), new Set(), mulberry32(42), 42, {
    onStage(e) {
      stages.push(e.stage);
      const bad = forbiddenKeys(e, new Set(["used", "positive"]));
      if (bad.length) throw new Error(`forbidden ${bad.join(",")}`);
    },
  });
  ok("emits intent then composition", stages.join(",") === "intent,composition", stages.join(","));
  ok("no opts still returns positive", !drawn.cancelled && drawn.positive.length > 0);
}

{
  const a = drawOne(lex, settings, new Set(), new Set(), mulberry32(42), 42);
  const b = drawOne(lex, settings, new Set(), new Set(), mulberry32(42), 42, {
    onStage() {},
  });
  ok("empty onStage keeps same POS as no opts", a.positive === b.positive, `${a.positive}\nvs\n${b.positive}`);
}

{
  const drawn = drawOne(lex, settings, new Set(), new Set(), mulberry32(7), 7, {
    onStage(e) {
      if (e.stage === "intent") return { cancel: true };
    },
  });
  ok("cancel at intent returns cancelled", drawn.cancelled === true);
  ok("cancel at intent has empty positive", drawn.positive === "");
}

{
  const drawn = drawOne(lex, settings, new Set(), new Set(), mulberry32(9), 9, {
    onStage(e) {
      if (e.stage === "composition") return { cancel: true };
    },
  });
  ok("cancel at composition returns cancelled", drawn.cancelled === true);
}

{
  const ac = new AbortController();
  ac.abort();
  const drawn = drawOne(lex, settings, new Set(), new Set(), mulberry32(11), 11, {
    signal: ac.signal,
    onStage() {},
  });
  ok("aborted signal cancels at intent", drawn.cancelled === true);
}

{
  const drawn = drawOne(lex, settings, new Set(), new Set(), mulberry32(13), 13, {
    onStage() {
      throw new Error("boom");
    },
  });
  ok("onStage throw treated as cancel", drawn.cancelled === true);
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("all ok — stage hooks");
