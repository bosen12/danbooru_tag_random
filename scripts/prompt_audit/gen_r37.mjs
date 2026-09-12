#!/usr/bin/env node
/** r37: same catalog as r24, new seed after pairing/prop fixes. */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  applyBan,
  applyPin,
  BUILTIN_PRESETS,
  defaultSettings,
  drawOne,
  ERAS,
  indexLexicon,
  MIXED_HEATS,
  mulberry32,
  togglePresetTags,
  weightsForHeats,
} from "../../web/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const data = JSON.parse(readFileSync(join(ROOT, "web/lexicon.json"), "utf8"));
const lex = indexLexicon(data);
const MODES = ["normal", "diverse", "weird"];
const HEAT_SINGLES = [["activity"], ["tease"], ["flash"], ["sex"]];
const HEAT_MULTI = [
  ["activity", "tease"],
  ["tease", "flash"],
  ["flash", "sex"],
  MIXED_HEATS.slice(),
];
const CASTS = [
  { girl: true, boy: false, name: "girl" },
  { girl: false, boy: true, name: "boy" },
  { girl: true, boy: true, name: "both" },
];
const COUNT_OPTS = [
  { subject: 3, feature: 3, pose: 3, clothing: 3, env: 3 },
  { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 },
];
const CATALOG_PINS = [
  "sitting",
  "standing",
  "sleeping",
  "huge breasts",
  "school uniform",
  "nude",
  "looking at viewer",
  "head out of frame",
  "playing guitar",
  "cooking",
  "reading",
  "jogging",
];

function settings(over) {
  const s = defaultSettings(data);
  s.counts = { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 };
  Object.assign(s, over);
  s.weights = weightsForHeats(s.heats, data.heatWeights);
  s.lockScene = s.sceneMode !== "weird";
  return s;
}
function pinList(tags) {
  let pinned = new Set();
  for (const t of tags) {
    if (!lex.byTag.has(t)) continue;
    pinned = applyPin(lex, pinned, new Set(), t).pinned;
  }
  return pinned;
}

const catalog = [];
for (const era of ERAS) {
  for (const mode of MODES) {
    for (const heats of HEAT_SINGLES) {
      catalog.push({
        label: `era:${era}/${mode}/${heats[0]}`,
        over: { sceneMode: mode, heats, eras: [era], girl: true, boy: false },
      });
    }
  }
}
for (const heats of HEAT_MULTI) {
  for (const mode of MODES) {
    catalog.push({
      label: `heat:${heats.join("+")}/${mode}`,
      over: { sceneMode: mode, heats, eras: ["modern"], girl: true, boy: false },
    });
  }
}
for (const p of BUILTIN_PRESETS) {
  for (const heats of [["activity"], ["sex"], ["tease"]]) {
    for (const mode of MODES) {
      catalog.push({
        label: `preset:${p.id}/${heats[0]}/${mode}`,
        over: { sceneMode: mode, heats, eras: ["modern"], girl: true, boy: false },
        preset: p,
      });
    }
  }
}
for (const era of ERAS) {
  catalog.push({
    label: `preset+era:classroom/${era}`,
    over: { sceneMode: "normal", heats: ["activity"], eras: [era], girl: true, boy: false },
    preset: BUILTIN_PRESETS.find((p) => p.id === "classroom"),
  });
}
for (const c of CASTS) {
  catalog.push({
    label: `cast:${c.name}`,
    over: { sceneMode: "normal", heats: MIXED_HEATS.slice(), eras: ["modern"], ...c },
  });
}
for (const counts of COUNT_OPTS) {
  catalog.push({
    label: `counts:${counts.pose}`,
    over: { sceneMode: "normal", heats: ["activity"], eras: ["modern"], girl: true, boy: false, counts },
  });
}
catalog.push({
  label: "job-on/activity",
  over: { sceneMode: "normal", heats: ["activity"], eras: ["modern"], girl: true, boy: false, drawJob: true },
});
for (const tag of CATALOG_PINS) {
  catalog.push({
    label: `pin:${tag}`,
    over: { sceneMode: "normal", heats: ["activity"], eras: ["modern"], girl: true, boy: false },
    pins: [tag],
  });
  catalog.push({
    label: `pin:${tag}/sex`,
    over: { sceneMode: "normal", heats: ["sex"], eras: ["modern"], girl: true, boy: false },
    pins: [tag],
  });
}
const combos = [
  ["sitting", "classroom"],
  ["sleeping", "bedroom"],
  ["playing guitar", "smile"],
  ["cooking", "kitchen"],
  ["jogging", "standing"],
  ["head out of frame", "from behind"],
];
for (const pins of combos) {
  catalog.push({
    label: `pin2:${pins.join("+")}`,
    over: { sceneMode: "normal", heats: ["tease"], eras: ["modern"], girl: true, boy: false },
    pins,
  });
}
for (let i = 0; i < BUILTIN_PRESETS.length - 1; i += 2) {
  catalog.push({
    label: `switch:${BUILTIN_PRESETS[i].id}->${BUILTIN_PRESETS[i + 1].id}`,
    over: { sceneMode: "normal", heats: ["activity"], eras: ["modern"], girl: true, boy: false },
    presetFrom: BUILTIN_PRESETS[i],
    preset: BUILTIN_PRESETS[i + 1],
  });
}

const TARGET = 400;
const rows = [];
let seed = 2500000;
for (let i = 0; i < TARGET; i++) {
  const sc = catalog[i % catalog.length];
  const s = settings({ ...sc.over });
  let pinned = pinList(sc.pins || []);
  if (sc.presetFrom) pinned = togglePresetTags(lex, sc.presetFrom.tags, pinned);
  if (sc.preset) pinned = togglePresetTags(lex, sc.preset.tags, pinned);
  let banned = new Set();
  for (const t of sc.banned || []) {
    const next = applyBan(lex, pinned, banned, t);
    pinned = next.pinned;
    banned = next.userBanned;
  }
  const drawn = drawOne(lex, s, pinned, banned, mulberry32(seed), seed);
  seed += 1;
  rows.push({
    id: i + 1,
    label: sc.label,
    mode: s.sceneMode,
    heats: s.heats,
    era: drawn.era,
    cast: s.girl && s.boy ? "both" : s.boy ? "boy" : "girl",
    drawJob: !!s.drawJob,
    pinned: [...pinned],
    positive: drawn.positive,
  });
}

writeFileSync(join(ROOT, "scripts/prompt_audit/r37.json"), JSON.stringify(rows));
const txt = [`r37 n=${rows.length} catalog=${catalog.length}\n`].concat(
  rows.map((r) => `#${r.id} ${r.label} ${r.mode}\nPIN ${r.pinned.join(", ")}\n${r.positive}\n`)
);
writeFileSync(join(ROOT, "scripts/prompt_audit/r37.txt"), txt.join("\n"));
console.log("wrote r37", rows.length, "catalog", catalog.length);
