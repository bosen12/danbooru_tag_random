#!/usr/bin/env node
/** r23: 400 draws — left panel + right-side tag pins. */
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
const CASTS = [
  { girl: true, boy: false, name: "girl" },
  { girl: false, boy: true, name: "boy" },
  { girl: true, boy: true, name: "both" },
];
const RIGHT_PINS = [
  "sitting",
  "standing",
  "lying",
  "on back",
  "on stomach",
  "kneeling",
  "sleeping",
  "looking at viewer",
  "from behind",
  "cowboy shot",
  "upper body",
  "lower body",
  "head out of frame",
  "closed eyes",
  "smile",
  "eating",
  "reading",
  "dancing",
  "playing guitar",
  "talking on phone",
  "cooking",
  "driving",
  "swimming",
  "bathing",
  "jogging",
  "school uniform",
  "bikini",
  "nude",
  "classroom",
  "bedroom",
  "office",
  "rain",
  "night",
  "huge breasts",
  "twintails",
  "cat ears",
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
    for (const heats of [["activity"], ["sex"]]) {
      catalog.push({
        label: `era:${era}/${mode}/${heats[0]}`,
        over: { sceneMode: mode, heats, eras: [era], girl: true, boy: false },
        pins: [],
      });
    }
  }
}
for (const p of BUILTIN_PRESETS) {
  for (const mode of ["normal", "diverse"]) {
    catalog.push({
      label: `preset:${p.id}/${mode}`,
      over: { sceneMode: mode, heats: ["sex"], eras: ["modern"], girl: true, boy: false },
      pins: [],
      preset: p,
    });
  }
}
for (let i = 0; i < BUILTIN_PRESETS.length - 1; i += 2) {
  catalog.push({
    label: `switch:${BUILTIN_PRESETS[i].id}->${BUILTIN_PRESETS[i + 1].id}`,
    over: { sceneMode: "normal", heats: ["tease"], eras: ["modern"], girl: true, boy: false },
    pins: [],
    presetFrom: BUILTIN_PRESETS[i],
    preset: BUILTIN_PRESETS[i + 1],
  });
}
for (const c of CASTS) {
  catalog.push({
    label: `cast:${c.name}`,
    over: { sceneMode: "normal", heats: MIXED_HEATS.slice(), eras: ["modern"], ...c },
    pins: [],
  });
}
for (const tag of RIGHT_PINS) {
  for (const mode of MODES) {
    catalog.push({
      label: `rpin:${tag}/${mode}`,
      over: { sceneMode: mode, heats: ["activity"], eras: ["modern"], girl: true, boy: true },
      pins: [tag],
    });
  }
}
const combos = [
  ["sitting", "classroom"],
  ["sleeping", "bedroom"],
  ["swimming", "pool"],
  ["eating", "restaurant"],
  ["nude", "onsen"],
  ["school uniform", "looking at viewer"],
  ["driving", "sitting"],
  ["lower body", "standing"],
  ["head out of frame", "from behind"],
  ["playing guitar", "smile"],
  ["huge breasts", "bikini"],
  ["night", "bedroom"],
];
for (const pins of combos) {
  catalog.push({
    label: `rpin2:${pins.join("+")}`,
    over: { sceneMode: "normal", heats: ["tease"], eras: ["modern"], girl: true, boy: false },
    pins,
  });
}
catalog.push({
  label: "job-on",
  over: { sceneMode: "normal", heats: ["tease"], eras: ["modern"], girl: true, boy: false, drawJob: true },
  pins: [],
});
catalog.push({
  label: "preset+rpin:cabin+closed-eyes",
  over: { sceneMode: "normal", heats: ["sex"], eras: ["modern"], girl: true, boy: false },
  pins: ["closed eyes"],
  preset: BUILTIN_PRESETS.find((p) => p.id === "cabin"),
});
catalog.push({
  label: "preset+rpin:hoops+sitting",
  over: { sceneMode: "normal", heats: ["activity"], eras: ["modern"], girl: true, boy: false },
  pins: ["sitting"],
  preset: BUILTIN_PRESETS.find((p) => p.id === "hoops"),
});

const TARGET = 400;
const rows = [];
let seed = 1020000;
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

writeFileSync(join(ROOT, "scripts/prompt_audit/r23.json"), JSON.stringify(rows));
const txt = [`r23 n=${rows.length}\n`].concat(
  rows.map((r) => `#${r.id} ${r.label} ${r.mode}\nPIN ${r.pinned.join(", ")}\n${r.positive}\n`)
);
writeFileSync(join(ROOT, "scripts/prompt_audit/r23.txt"), txt.join("\n"));
console.log("wrote r23", rows.length, "catalog", catalog.length);
