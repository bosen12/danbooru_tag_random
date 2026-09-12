#!/usr/bin/env node
/** r8: hands-busy arm leftovers. */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  applyPin,
  defaultSettings,
  drawOne,
  indexLexicon,
  mulberry32,
  weightsForHeats,
} from "../../web/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const data = JSON.parse(readFileSync(join(ROOT, "web/lexicon.json"), "utf8"));
const lex = indexLexicon(data);
const ARMS = ["arms behind back", "arms behind head", "crossed arms", "heart hands", "v", "reaching towards viewer"];
const BUSY = [
  "playing guitar",
  "talking on phone",
  "writing",
  "drawing (action)",
  "painting (action)",
  "cooking",
  "eating",
  "crawling",
  "all fours",
];

function settings(over) {
  const s = defaultSettings(data);
  s.counts = { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 };
  Object.assign(s, over);
  s.weights = weightsForHeats(s.heats, data.heatWeights);
  s.lockScene = s.sceneMode !== "weird";
  return s;
}
function pinTags(tags) {
  let pinned = new Set();
  for (const t of tags) {
    if (!lex.byTag.has(t)) continue;
    pinned = applyPin(lex, pinned, new Set(), t).pinned;
  }
  return pinned;
}
function tagsOf(d) {
  return d.positive.split(", ").map((t) => t.trim()).filter(Boolean);
}

const scenarios = [];
let seed = 520000;
function add(label, over, pins) {
  scenarios.push({ label, over, pins, seed: seed++ });
}
for (const tag of BUSY) {
  for (const mode of ["normal", "diverse", "weird"]) {
    add(`busy:${tag}`, { sceneMode: mode, heats: ["activity"], eras: ["modern"], girl: true, boy: false }, [tag]);
  }
}
for (let i = 0; i < 8; i++) {
  add("pose10", { sceneMode: "normal", heats: ["tease"], eras: ["modern"], girl: true, boy: false }, []);
}

const rows = [];
for (const sc of scenarios) {
  const s = settings(sc.over);
  const pinned = pinTags(sc.pins);
  const drawn = drawOne(lex, s, pinned, new Set(), mulberry32(sc.seed), sc.seed);
  const have = tagsOf(drawn);
  const arms = have.filter((t) => ARMS.includes(t));
  const busy = have.filter((t) => BUSY.includes(t));
  const issues = [];
  if (arms.length > 1) issues.push(`two arms ${arms.join("/")}`);
  if (busy.length && arms.length && !arms.every((a) => pinned.has(a))) {
    issues.push(`${busy.join("/")} + ${arms.join("/")}`);
  }
  rows.push({
    id: rows.length + 1,
    label: sc.label,
    mode: s.sceneMode,
    heats: s.heats,
    era: drawn.era,
    pinned: [...pinned],
    act: have.filter((t) => lex.byTag.get(t)?.mutex === "activity"),
    body: have.filter((t) => lex.byTag.get(t)?.mutex === "body_pose"),
    pose: drawn.sections.pose,
    clothing: drawn.sections.clothing,
    env: drawn.sections.env,
    positive: drawn.positive,
    issues,
  });
}

function fmt(r) {
  return [
    `#${r.id} ${r.label} mode=${r.mode} pin=[${r.pinned.join(", ")}]`,
    `  act=[${r.act.join(", ")}] body=[${r.body.join(", ")}] pose=[${r.pose.join(", ")}]`,
    `  POS: ${r.positive}`,
    r.issues.length ? `  MECH: ${r.issues.join(" | ")}` : "  MECH: ok",
    "",
  ].join("\n");
}
writeFileSync(join(ROOT, "scripts/prompt_audit/r8.txt"), [`r8 n=${rows.length} hands-busy\n`, ...rows.map(fmt)].join("\n"));
writeFileSync(join(ROOT, "scripts/prompt_audit/r8.json"), JSON.stringify(rows, null, 2));
const flagged = rows.filter((r) => r.issues.length);
console.log(`wrote ${rows.length}, mech=${flagged.length}`);
for (const r of flagged) console.log(`#${r.id} ${r.label} ${r.issues.join(" | ")}`);
