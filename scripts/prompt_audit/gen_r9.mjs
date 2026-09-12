#!/usr/bin/env node
/** r9: preset toggle + relaxed clothing + nude. */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  applyPresetTags,
  BUILTIN_PRESETS,
  defaultSettings,
  drawOne,
  indexLexicon,
  mulberry32,
  togglePresetTags,
  weightsForHeats,
} from "../../web/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const data = JSON.parse(readFileSync(join(ROOT, "web/lexicon.json"), "utf8"));
const lex = indexLexicon(data);

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
    pinned = applyPresetTags(lex, [t], pinned);
  }
  return pinned;
}
function tagsOf(d) {
  return d.positive.split(", ").map((t) => t.trim()).filter(Boolean);
}

const FACELESS = new Set(["head out of frame", "lower body"]);
const rows = [];
let seed = 610000;
function add(label, over, pinned) {
  const s = settings(over);
  const drawn = drawOne(lex, s, pinned, new Set(), mulberry32(seed), seed);
  seed += 1;
  const have = tagsOf(drawn);
  const H = new Set(have);
  const issues = [];
  if (H.has("nude") || H.has("completely nude")) {
    const g = have.filter((t) => {
      const it = lex.byTag.get(t);
      return it && it.section === "clothing" && it.layer === "garment";
    });
    if (g.length) issues.push(`nude+garment ${g.join("/")}`);
  }
  if ([...FACELESS].some((t) => H.has(t))) {
    const face = have.filter((t) => t === "smile" || t.startsWith("looking ") || lex.byTag.get(t)?.mutex === "gaze");
    if (face.length) issues.push(`faceless+${face.join("/")}`);
  }
  rows.push({
    id: rows.length + 1,
    label,
    mode: s.sceneMode,
    heats: s.heats,
    era: drawn.era,
    pinned: [...pinned],
    clothing: drawn.sections.clothing,
    pose: drawn.sections.pose,
    env: drawn.sections.env,
    positive: drawn.positive,
    issues,
  });
}

for (const p of BUILTIN_PRESETS) {
  for (const heat of ["activity", "tease", "sex"]) {
    const pin = applyPresetTags(lex, p.tags, pinTags(["huge breasts"]));
    add(`on:${p.id}`, { sceneMode: "normal", heats: [heat], eras: ["modern"], girl: true, boy: false }, pin);
  }
  const on = applyPresetTags(lex, p.tags, pinTags(["huge breasts"]));
  const off = togglePresetTags(lex, p.tags, on);
  add(`off:${p.id}`, { sceneMode: "normal", heats: ["activity"], eras: ["modern"], girl: true, boy: false }, off);
}
for (let i = 0; i < 8; i++) {
  add("pool-sex", { sceneMode: "normal", heats: ["sex"], eras: ["modern"], girl: true, boy: false }, applyPresetTags(lex, ["pool", "swimming"], new Set()));
  add("onsen-act", { sceneMode: "normal", heats: ["activity"], eras: ["modern"], girl: true, boy: false }, applyPresetTags(lex, ["onsen", "bathing"], new Set()));
}

const txt = [
  `r9 n=${rows.length} preset toggle + nude\n`,
  ...rows.map((r) =>
    [
      `#${r.id} ${r.label} mode=${r.mode} heats=${r.heats.join("+")} era=${r.era} pin=[${r.pinned.join(", ")}]`,
      `  env=[${r.env.join(", ")}] cloth=[${r.clothing.join(", ")}]`,
      `  pose=[${r.pose.join(", ")}]`,
      `  POS: ${r.positive}`,
      r.issues.length ? `  MECH: ${r.issues.join(" | ")}` : "  MECH: ok",
      "",
    ].join("\n")
  ),
].join("\n");
writeFileSync(join(ROOT, "scripts/prompt_audit/r9.txt"), txt);
writeFileSync(join(ROOT, "scripts/prompt_audit/r9.json"), JSON.stringify(rows, null, 2));
const flagged = rows.filter((r) => r.issues.length);
console.log(`wrote ${rows.length} mech=${flagged.length}`);
for (const r of flagged) console.log(`#${r.id} ${r.label} ${r.issues.join(" | ")}`);
const nudes = rows.filter((r) => r.positive.includes("nude"));
console.log("nude samples", nudes.length, nudes.map((r) => `#${r.id}:${r.label}`).join(" "));
const offs = rows.filter((r) => r.label.startsWith("off:"));
let stillForced = 0;
for (const r of offs) {
  const p = BUILTIN_PRESETS.find((x) => r.label === `off:${x.id}`);
  if (p && p.tags.every((t) => r.pinned.includes(t))) stillForced += 1;
}
console.log("off still pinning combo", stillForced);
