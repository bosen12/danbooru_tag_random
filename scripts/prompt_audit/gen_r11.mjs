#!/usr/bin/env node
/** r11: 1000 draws — left panel × eras × presets × pins. */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  applyBan,
  applyPin,
  applyPresetTags,
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
const HEAT_OPTS = [["activity"], ["tease"], ["flash"], ["sex"], MIXED_HEATS.slice()];
const CASTS = [
  { girl: true, boy: false, name: "girl" },
  { girl: false, boy: true, name: "boy" },
  { girl: true, boy: true, name: "both" },
];
const PINS = [
  "sleeping",
  "head out of frame",
  "closed eyes",
  "driving",
  "cooking",
  "swimming",
  "bathing",
  "nude",
  "huge breasts",
  "on back",
  "on stomach",
  "on side",
  "lying",
  "playing guitar",
  "talking on phone",
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
    for (const heats of HEAT_OPTS) {
      catalog.push({ label: `era:${era}/${mode}/${heats[0]}`, over: { sceneMode: mode, heats, eras: [era], girl: true, boy: false }, pins: [] });
    }
  }
}
for (const p of BUILTIN_PRESETS) {
  for (const mode of MODES) {
    for (const heats of [["activity"], ["tease"], ["sex"]]) {
      catalog.push({
        label: `preset:${p.id}/${mode}/${heats[0]}`,
        over: { sceneMode: mode, heats, eras: ["modern"], girl: true, boy: false },
        pins: ["huge breasts", ...p.tags],
        preset: p,
      });
    }
  }
  catalog.push({
    label: `preset-off:${p.id}`,
    over: { sceneMode: "normal", heats: ["activity"], eras: ["modern"], girl: true, boy: false },
    pins: ["huge breasts", ...p.tags],
    preset: p,
    off: true,
  });
}
for (const c of CASTS) {
  for (const heats of HEAT_OPTS) {
    catalog.push({
      label: `cast:${c.name}/${heats[0]}`,
      over: { sceneMode: "normal", heats, eras: ["modern"], ...c },
      pins: [],
    });
  }
}
for (const tag of PINS) {
  for (const mode of MODES) {
    catalog.push({
      label: `pin:${tag}/${mode}`,
      over: { sceneMode: mode, heats: tag === "nude" ? ["sex"] : ["activity"], eras: ["modern"], girl: true, boy: false },
      pins: [tag],
    });
  }
}
catalog.push({
  label: "job-on",
  over: { sceneMode: "normal", heats: ["tease"], eras: ["modern"], girl: true, boy: false, drawJob: true },
  pins: [],
});
catalog.push({
  label: "ban-bikini",
  over: { sceneMode: "normal", heats: ["flash"], eras: ["modern"], girl: true, boy: false },
  pins: [],
  banned: ["bikini"],
});
catalog.push({
  label: "counts-low",
  over: { sceneMode: "normal", heats: ["activity"], eras: ["modern"], girl: true, boy: false, counts: { subject: 3, feature: 3, pose: 3, clothing: 3, env: 3 } },
  pins: ["huge breasts"],
});

const TARGET = 1000;
const rows = [];
let seed = 810000;
for (let i = 0; i < TARGET; i++) {
  const sc = catalog[i % catalog.length];
  const s = settings({ ...sc.over });
  let pinned;
  if (sc.preset && sc.off) {
    const on = applyPresetTags(lex, sc.preset.tags, pinList(["huge breasts"]));
    pinned = togglePresetTags(lex, sc.preset.tags, on);
  } else if (sc.preset) {
    pinned = applyPresetTags(lex, sc.preset.tags, pinList(sc.pins.filter((t) => t === "huge breasts")));
  } else {
    pinned = pinList(sc.pins || []);
  }
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
    clothing: drawn.sections.clothing,
    pose: drawn.sections.pose,
    env: drawn.sections.env,
    positive: drawn.positive,
  });
}

writeFileSync(join(ROOT, "scripts/prompt_audit/r11.json"), JSON.stringify(rows));
const txt = [`r11 n=${rows.length}\n`].concat(
  rows.map(
    (r) =>
      `#${r.id} ${r.label} mode=${r.mode} heats=${r.heats.join("+")} era=${r.era} cast=${r.cast} pin=[${r.pinned.join(", ")}]\n  cloth=[${r.clothing.join(", ")}]\n  pose=[${r.pose.join(", ")}]\n  env=[${r.env.join(", ")}]\n  POS: ${r.positive}\n`
  )
);
writeFileSync(join(ROOT, "scripts/prompt_audit/r11.txt"), txt.join("\n"));
console.log(`wrote ${rows.length}`);
