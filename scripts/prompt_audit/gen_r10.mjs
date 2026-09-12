#!/usr/bin/env node
/** r10: simulate left-panel ops × eras × presets. HARD contradictions only. */
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

function settings(over) {
  const s = defaultSettings(data);
  s.counts = { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 };
  Object.assign(s, over);
  const heats = s.heats;
  if (heats && heats[0] === "mixed") s.heats = MIXED_HEATS.slice();
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
function tagsOf(d) {
  return d.positive.split(", ").map((t) => t.trim()).filter(Boolean);
}
function mx(t) {
  return lex.byTag.get(t)?.mutex || "";
}

const FACELESS = new Set(["head out of frame", "lower body"]);
const FACE_NEED = new Set([
  "closed eyes", "smile", "wink", "ahegao", "selfie", "kiss", "kissing", "french kiss",
  "reading", "studying", "writing", "eating", "oral", "cunnilingus", "fellatio", "69",
  "head tilt", "talking on phone", "breast sucking", "paizuri", "closed mouth",
]);
const AWAKE = new Set([
  "eating", "reading", "writing", "drawing (action)", "painting (action)", "singing",
  "shopping", "driving", "studying", "yoga", "stretching", "smoking", "drinking",
  "swimming", "bathing", "showering", "hiking", "dancing", "cooking", "playing guitar",
]);
const PLANT = new Set(["standing", "squatting", "kneeling", "on one knee"]);
const DAY = new Set(["day", "sunrise", "sunlight", "sunbathing", "blue sky", "orange sky"]);
const NIGHT = new Set(["night", "starry sky", "moonlight"]);
const ARMS = new Set(["arms behind back", "arms behind head", "crossed arms", "heart hands", "v", "reaching towards viewer"]);
const BUSY = new Set(["playing guitar", "talking on phone", "writing", "drawing (action)", "painting (action)", "cooking", "eating"]);
const GROUND = new Set(["all fours", "crawling", "top-down bottom-up"]);

function scan(have, pinned, mode) {
  const H = new Set(have);
  const issues = [];
  const bodies = have.filter((t) => mx(t) === "body_pose");
  const acts = have.filter((t) => mx(t) === "activity");
  if ((H.has("swimming") || H.has("wading")) && [...PLANT].some((t) => H.has(t))) {
    issues.push("swim+planted");
  }
  if ([...FACELESS].some((t) => H.has(t))) {
    const hit = have.filter((t) => FACE_NEED.has(t) || mx(t) === "gaze" || /^looking /.test(t));
    if (hit.length) issues.push(`faceless+${hit.join("/")}`);
  }
  if (H.has("sleeping")) {
    const hit = have.filter((t) => (AWAKE.has(t) && !pinned.has(t)) || /^looking /.test(t) || mx(t) === "gaze");
    if (hit.length) issues.push(`sleep+${hit.join("/")}`);
  }
  if (H.has("closed eyes") && have.some((t) => /^looking /.test(t) || t === "wink")) issues.push("closed-eyes+gaze");
  if ([...DAY].some((t) => H.has(t)) && [...NIGHT].some((t) => H.has(t))) issues.push("day+night");
  if ((H.has("dusk") || H.has("sunset")) && [...NIGHT].some((t) => H.has(t))) issues.push("dusk+night");
  if (H.has("driving") && bodies.some((t) => t !== "sitting")) issues.push("drive+nonsit");
  if (H.has("dancing") && acts.some((a) => a === "bathing" || a === "swimming" || a === "showering")) issues.push("dance+bath/swim");
  if (bodies.some((t) => t === "seiza" || t === "wariza") && H.has("legs up")) issues.push("sit+legsup");
  if ((H.has("nude") || H.has("completely nude")) && have.some((t) => lex.byTag.get(t)?.layer === "garment")) {
    issues.push("nude+garment");
  }
  const arms = have.filter((t) => ARMS.has(t));
  if (arms.length > 1) issues.push(`two-arms ${arms.join("/")}`);
  if (arms.length && (acts.some((a) => BUSY.has(a)) || bodies.some((t) => GROUND.has(t)))) {
    if (!arms.every((a) => pinned.has(a))) issues.push(`busy+arms ${arms.join("/")}`);
  }
  if (mode === "normal" && have.some((t) => mx(t) === "race" && !pinned.has(t))) issues.push("normal-auto-race");
  return issues;
}

const scenarios = [];
let seed = 710000;
function add(label, over, pins, banned = []) {
  scenarios.push({ label, over, pins, banned, seed: seed++ });
}

for (const era of ERAS) {
  add(`era-act:${era}`, { sceneMode: "normal", heats: ["activity"], eras: [era], girl: true, boy: false }, []);
  add(`era-sex:${era}`, { sceneMode: "normal", heats: ["sex"], eras: [era], girl: true, boy: true }, []);
  add(`era-flash:${era}`, { sceneMode: "normal", heats: ["flash"], eras: [era], girl: true, boy: false }, []);
}
for (const mode of MODES) {
  add(`mode-mix:${mode}`, { sceneMode: mode, heats: MIXED_HEATS.slice(), eras: ["modern"], girl: true, boy: false }, []);
  add(`mode-job:${mode}`, { sceneMode: mode, heats: ["tease"], eras: ["modern"], girl: true, boy: false, drawJob: true }, []);
}
add("cast-girl", { sceneMode: "normal", heats: ["tease"], eras: ["modern"], girl: true, boy: false }, []);
add("cast-boy", { sceneMode: "normal", heats: ["tease"], eras: ["edo"], girl: false, boy: true }, []);
add("cast-any", { sceneMode: "normal", heats: ["sex"], eras: ["modern"], girl: true, boy: true }, []);
add("counts-low", { sceneMode: "normal", heats: ["activity"], eras: ["modern"], girl: true, boy: false, counts: { subject: 4, feature: 4, pose: 4, clothing: 4, env: 4 } }, ["huge breasts"]);

for (const p of BUILTIN_PRESETS) {
  add(`preset:${p.id}`, { sceneMode: "normal", heats: ["activity"], eras: ["modern"], girl: true, boy: false }, ["huge breasts", ...p.tags]);
  add(`preset-sex:${p.id}`, { sceneMode: "normal", heats: ["sex"], eras: ["modern"], girl: true, boy: false }, ["huge breasts", ...p.tags]);
  add(`preset-off:${p.id}`, { sceneMode: "normal", heats: ["activity"], eras: ["modern"], girl: true, boy: false }, ["huge breasts", ...p.tags], [], "off");
}

const pins = [
  ["sleeping", { heats: ["activity"] }],
  ["head out of frame", { heats: ["tease"] }],
  ["closed eyes", { heats: ["tease"] }],
  ["driving", { heats: ["activity"] }],
  ["cooking", { heats: ["activity"] }],
  ["swimming", { heats: ["activity"] }],
  ["nude", { heats: ["sex"] }],
  ["bald", { heats: ["tease"] }],
];
for (const [tag, over] of pins) {
  add(`pin:${tag}`, { sceneMode: "normal", heats: over.heats, eras: ["modern"], girl: true, boy: false }, [tag]);
}

add("ban-bikini-flash", { sceneMode: "normal", heats: ["flash"], eras: ["modern"], girl: true, boy: false }, [], ["bikini"]);
add("preset-pool-toggle-off", { sceneMode: "normal", heats: ["activity"], eras: ["modern"], girl: true, boy: false }, ["huge breasts", "pool", "swimming"], [], "off");
add("china-picnic", { sceneMode: "normal", heats: ["activity"], eras: ["ancient_china"], girl: true, boy: false }, ["picnic"]);
add("medieval-cook", { sceneMode: "normal", heats: ["activity"], eras: ["medieval"], girl: true, boy: false }, ["cooking"]);
add("greece-swim", { sceneMode: "normal", heats: ["activity"], eras: ["ancient_greece"], girl: true, boy: false }, ["swimming"]);
add("edo-bath", { sceneMode: "normal", heats: ["activity"], eras: ["edo"], girl: true, boy: false }, ["bathing"]);
add("victorian-flash", { sceneMode: "normal", heats: ["flash"], eras: ["victorian"], girl: true, boy: false }, []);
add("diverse-park-sex", { sceneMode: "diverse", heats: ["sex"], eras: ["modern"], girl: true, boy: true }, ["park"]);
add("weird-restaurant-sex", { sceneMode: "weird", heats: ["sex"], eras: ["modern"], girl: true, boy: true }, ["restaurant"]);

const rows = [];
for (const sc of scenarios) {
  const s = settings(sc.over);
  let pinned;
  if (String(sc.label).includes("preset:") || String(sc.label).startsWith("preset-sex:")) {
    const id = sc.label.split(":")[1];
    const p = BUILTIN_PRESETS.find((x) => x.id === id);
    pinned = applyPresetTags(lex, p.tags, pinList(["huge breasts"]));
  } else if (String(sc.label).startsWith("preset-off:") || sc.label === "preset-pool-toggle-off") {
    const id = sc.label === "preset-pool-toggle-off" ? "pool" : sc.label.split(":")[1];
    const p = BUILTIN_PRESETS.find((x) => x.id === id);
    const on = applyPresetTags(lex, p.tags, pinList(["huge breasts"]));
    pinned = togglePresetTags(lex, p.tags, on);
  } else {
    pinned = pinList(sc.pins);
  }
  let banned = new Set();
  for (const t of sc.banned || []) {
    const next = applyBan(lex, pinned, banned, t);
    pinned = next.pinned;
    banned = next.userBanned;
  }
  const drawn = drawOne(lex, s, pinned, banned, mulberry32(sc.seed), sc.seed);
  const have = tagsOf(drawn);
  rows.push({
    id: rows.length + 1,
    label: sc.label,
    mode: s.sceneMode,
    heats: s.heats,
    era: drawn.era,
    cast: s.girl && s.boy ? "both" : s.boy ? "boy" : "girl",
    drawJob: !!s.drawJob,
    pinned: [...pinned],
    banned: [...banned],
    clothing: drawn.sections.clothing,
    pose: drawn.sections.pose,
    env: drawn.sections.env,
    positive: drawn.positive,
    issues: scan(have, pinned, s.sceneMode),
  });
}

function fmt(r) {
  return [
    `#${r.id} ${r.label} mode=${r.mode} heats=${r.heats.join("+")} era=${r.era} cast=${r.cast} job=${r.drawJob} pin=[${r.pinned.join(", ")}]`,
    `  env=[${r.env.join(", ")}] cloth=[${r.clothing.join(", ")}]`,
    `  pose=[${r.pose.join(", ")}]`,
    `  POS: ${r.positive}`,
    r.issues.length ? `  MECH: ${r.issues.join(" | ")}` : "  MECH: ok",
    "",
  ].join("\n");
}
writeFileSync(join(ROOT, "scripts/prompt_audit/r10.txt"), [`r10 n=${rows.length} left-panel ops\n`, ...rows.map(fmt)].join("\n"));
writeFileSync(join(ROOT, "scripts/prompt_audit/r10.json"), JSON.stringify(rows, null, 2));
const flagged = rows.filter((r) => r.issues.length);
console.log(`wrote ${rows.length} mech=${flagged.length}`);
for (const r of flagged) console.log(`#${r.id} ${r.label} [${r.mode}/${r.era}] ${r.issues.join(" | ")}`);
