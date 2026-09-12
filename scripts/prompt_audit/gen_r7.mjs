#!/usr/bin/env node
/** r7: every mode × builtin combo × era, plus era pins. */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  applyPin,
  applyPresetTags,
  BUILTIN_PRESETS,
  defaultSettings,
  drawOne,
  ERAS,
  indexLexicon,
  mulberry32,
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

function tagsOf(drawn) {
  return drawn.positive.split(", ").map((t) => t.trim()).filter(Boolean);
}
function mutexOf(tag) {
  return lex.byTag.get(tag)?.mutex || "";
}
function groupOf(tag) {
  return lex.byTag.get(tag)?.group || "";
}
function sectionOf(tag) {
  return lex.byTag.get(tag)?.section || "";
}
function layerOf(tag) {
  return lex.byTag.get(tag)?.layer || "";
}

const FACELESS = new Set(["head out of frame", "lower body"]);
const FACE_NEED = new Set([
  "closed eyes", "facial", "cum in mouth", "cum on face", "licking penis",
  "covering own mouth", "french kiss", "finger to mouth", "eating", "drinking",
  "selfie", "taking picture", "69", "kissing", "reading", "studying", "writing",
  "washing hair", "adjusting hair", "cunnilingus", "oral", "fellatio", "irrumatio",
  "head tilt", "after fellatio", "after paizuri",
]);
const AWAKE = new Set([
  "eating", "reading", "drawing (action)", "painting (action)", "singing", "karaoke",
  "shopping", "driving", "writing", "picnic", "playing games", "playing video games",
  "playing guitar", "selfie", "talking on phone", "taking picture", "stretching",
  "yoga", "studying", "sunbathing", "smoking", "drinking", "floating", "bathing",
  "showering", "shared bathing", "swimming", "wading", "hiking", "horseback riding",
  "riding bicycle", "playing sports", "exercising", "training", "dancing", "carrying",
  "cooking", "cleaning", "fishing",
]);
const PLANT = new Set(["standing", "squatting", "kneeling", "on one knee"]);
const STILL = new Set(["sleeping", "lying", "on back", "on stomach", "on side", "reclining"]);
const GROUND = new Set(["all fours", "crawling", "top-down bottom-up"]);
const LOCKED_SIT = new Set(["seiza", "wariza", "indian style"]);
const MOVE = new Set(["swimming", "wading", "hiking", "horseback riding", "riding bicycle", "playing sports", "exercising", "training", "dancing", "carrying", "cooking", "cleaning", "fishing"]);
const DAY = new Set(["day", "sunrise", "sunlight", "sunbathing", "blue sky", "orange sky"]);
const NIGHT = new Set(["night", "starry sky", "moonlight"]);
const EYE = new Set(["wink", "empty eyes", "sparkling eyes", "half-closed eyes", "rolling eyes"]);
const MOUTH = new Set(["open mouth", "clenched teeth", "biting own lip", "tongue out", "parted lips", "licking lips", "drooling", "panting", "moaning"]);
const WATER_PLACE = new Set(["pool", "poolside", "beach", "ocean", "underwater", "lotus pond", "onsen", "bath", "bathroom", "bathtub", "shower (place)", "sento", "ofuro", "open-air bath", "bubble bath"]);
const BATH_PLACE = new Set(["onsen", "bath", "bathroom", "bathtub", "shower (place)", "sento", "ofuro", "open-air bath", "bubble bath", "sauna"]);
const INDOOR_PROP = new Set(["shoji", "carpet", "curtains", "bed sheet", "window", "tatami", "office chair", "gaming chair", "swivel chair"]);
const OUTDOOR_LEFTOVER = new Set(["tree", "bush", "sky", "blue sky", "orange sky", "starry sky", "snow", "water", "cherry blossoms"]);
const INDOOR_FURN = new Set(["on bed", "on chair", "office chair", "gaming chair", "swivel chair"]);
const JOB_PLACE = {
  "office lady": new Set(["office"]),
  salaryman: new Set(["office"]),
  nurse: new Set(["clinic", "hospital"]),
  doctor: new Set(["clinic", "hospital"]),
  teacher: new Set(["classroom", "library", "school gym"]),
  waitress: new Set(["restaurant", "cafe", "bar (place)"]),
  barista: new Set(["cafe", "restaurant"]),
  policewoman: new Set(["street", "city", "cityscape", "alley", "office"]),
  maid: new Set(["mansion", "kitchen", "living room", "bedroom", "hotel room", "palace"]),
};
const MODERN_LEAK = /\b(sneakers|watch|smartphone|cellphone| copier| copier| copier)\b|office lady|policewoman|school uniform|serafuku|latex|fishnets|lab coat|clipboard|microphone/;
const ERA_CLOTH = /\b(toga|himation|hanfu|kimono|yukata|hakama|haori|tunic|cloak|armor|ancient greek|chinese clothes|japanese clothes)\b/;

function pinKind(pinned) {
  const P = pinned;
  if (P.has("pool") || P.has("beach") || P.has("swimming") || P.has("ocean")) return "swim";
  if ([...BATH_PLACE].some((t) => P.has(t)) || P.has("bathing")) return "bath";
  if (P.has("office lady") || P.has("office")) return "office";
  if (P.has("nurse")) return "nurse";
  if (P.has("maid")) return "maid";
  if (P.has("policewoman")) return "police";
  if (P.has("classroom") || P.has("school uniform")) return "school";
  if (P.has("kitchen") || P.has("cooking")) return "kitchen";
  return null;
}

function scan(have, pinned, mode, heats, era) {
  const H = new Set(have);
  const issues = [];
  const jobs = have.filter((t) => mutexOf(t) === "job");
  const acts = have.filter((t) => mutexOf(t) === "activity");
  const places = have.filter((t) => mutexOf(t) === "place" || groupOf(t) === "place");
  const bodies = have.filter((t) => mutexOf(t) === "body_pose");
  const garments = have.filter((t) => sectionOf(t) === "clothing" && layerOf(t) === "garment" && !pinned.has(t));

  if (H.has("swimming") || H.has("wading")) {
    const bad = [...PLANT].filter((t) => H.has(t));
    if (bad.length) issues.push(`swimming/wading + planted ${bad.join("/")}`);
  }
  if ([...FACELESS].some((t) => H.has(t))) {
    const face = have.filter(
      (t) =>
        FACE_NEED.has(t) ||
        mutexOf(t) === "gaze" ||
        mutexOf(t) === "expression" ||
        groupOf(t) === "face" ||
        /^looking /.test(t)
    );
    if (face.length) issues.push(`faceless + ${face.join("/")}`);
  }
  if (H.has("sleeping")) {
    const bad = have.filter(
      (t) =>
        (AWAKE.has(t) && !pinned.has(t)) ||
        /^looking /.test(t) ||
        t === "kissing" ||
        mutexOf(t) === "gaze" ||
        EYE.has(t) ||
        MOUTH.has(t)
    );
    if (bad.length) issues.push(`sleeping + ${bad.join("/")}`);
  }
  if (H.has("closed eyes")) {
    const bad = have.filter((t) => EYE.has(t) || mutexOf(t) === "gaze" || /^looking /.test(t));
    if (bad.length) issues.push(`closed eyes + ${bad.join("/")}`);
  }
  if ([...DAY].some((t) => H.has(t)) && [...NIGHT].some((t) => H.has(t))) {
    issues.push(`day vs night`);
  }
  if ((H.has("dusk") || H.has("sunset")) && [...NIGHT].some((t) => H.has(t))) issues.push("dusk vs night");
  if (H.has("floating") && [...bodies].some((t) => PLANT.has(t) || GROUND.has(t) || LOCKED_SIT.has(t))) {
    issues.push("floating + planted");
  }
  if (H.has("driving") && [...bodies].some((t) => t !== "sitting")) issues.push(`driving + ${bodies.join("/")}`);
  if ([...bodies].some((t) => LOCKED_SIT.has(t)) && H.has("legs up")) issues.push("locked sit + legs up");
  if (mode !== "weird") {
    if (H.has("outdoors") && have.some((t) => INDOOR_PROP.has(t))) {
      issues.push(`outdoors + ${have.filter((t) => INDOOR_PROP.has(t)).join("/")}`);
    }
    if (H.has("indoors") && have.some((t) => OUTDOOR_LEFTOVER.has(t))) {
      issues.push(`indoors + ${have.filter((t) => OUTDOOR_LEFTOVER.has(t)).join("/")}`);
    }
  }
  if (era !== "modern" && mode === "normal") {
    const leak = have.filter((t) => !pinned.has(t) && (t === "sneakers" || t === "watch" || t === "office lady" || t === "policewoman" || t === "school uniform" || t === "serafuku" || t === "latex" || t === "clipboard" || t === "microphone" || t === "hard hat"));
    if (leak.length) issues.push(`historical modern leak ${leak.join("/")}`);
  }
  if (mode === "normal") {
    if (have.some((t) => mutexOf(t) === "race" && !pinned.has(t))) {
      issues.push(`normal auto race`);
    }
    if (H.has("dark-skinned male") && !pinned.has("dark-skinned male")) issues.push("normal auto dark-skinned male");
    for (const j of jobs) {
      const ok = JOB_PLACE[j];
      if (ok && places.length && !places.some((p) => ok.has(p))) issues.push(`job ${j} at ${places.join("/")}`);
    }
    const kind = pinKind(pinned);
    if (kind === "swim") {
      const modernBad = garments.filter((t) => {
        if (t === "wet clothes") return false;
        if (/\b(swimsuit|bikini)\b/.test(t)) return false;
        if ((lex.byTag.get(t)?.implies || []).some((d) => /\b(swimsuit|bikini)\b/.test(d))) return false;
        if (era !== "modern" && ERA_CLOTH.test(t)) return false;
        return true;
      });
      if (era === "modern" && modernBad.length) issues.push(`swimwear leak ${modernBad.join("/")}`);
    } else if (kind === "bath") {
      const ok = new Set(["wet clothes", "naked towel", "bathrobe", "yukata", "bath yukata", "fundoshi", "japanese clothes"]);
      const bad = garments.filter((t) => !ok.has(t));
      if (bad.length) issues.push(`bath cloth leak ${bad.join("/")}`);
    }
  }
  return issues;
}

function fmt(rec) {
  return [
    `#${rec.id} ${rec.label} mode=${rec.mode} heats=${rec.heats.join("+")} era=${rec.era} cast=${rec.cast} pin=[${rec.pinned.join(", ")}]`,
    `  job=[${rec.job.join(", ")}] act=[${rec.act.join(", ")}] sex=[${rec.sex.join(", ")}] body=[${rec.body.join(", ")}] cam=[${rec.cam.join(", ")}]`,
    `  env=[${rec.env.join(", ")}] cloth=[${rec.clothing.join(", ")}]`,
    `  pose=[${rec.pose.join(", ")}]`,
    `  POS: ${rec.positive}`,
    rec.issues.length ? `  MECH: ${rec.issues.join(" | ")}` : "  MECH: ok",
    "",
  ].join("\n");
}

const scenarios = [];
let seed = 410000;
function add(label, over, pins) {
  scenarios.push({ label, over, pins, seed: seed++ });
}

for (const era of ERAS) {
  for (const mode of MODES) {
    add(`era:${era}`, { sceneMode: mode, heats: ["activity"], eras: [era], girl: true, boy: false }, []);
    add(`era-sex:${era}`, { sceneMode: mode, heats: ["sex"], eras: [era], girl: true, boy: true }, []);
  }
}

for (const p of BUILTIN_PRESETS) {
  for (const mode of MODES) {
    add(`preset:${p.id}`, { sceneMode: mode, heats: ["activity"], eras: ["modern"], girl: true, boy: false }, ["huge breasts", ...p.tags]);
  }
  add(`preset-sex:${p.id}`, { sceneMode: "normal", heats: ["sex"], eras: ["modern"], girl: true, boy: false }, ["huge breasts", ...p.tags]);
}

for (const era of ERAS.filter((e) => e !== "modern")) {
  add(`preset-era:onsen@${era}`, { sceneMode: "normal", heats: ["activity"], eras: [era], girl: true, boy: false }, ["huge breasts", "onsen", "bathing"]);
  add(`preset-era:maid@${era}`, { sceneMode: "normal", heats: ["tease"], eras: [era], girl: true, boy: false }, ["huge breasts", "maid"]);
  add(`preset-era:pool@${era}`, { sceneMode: "normal", heats: ["activity"], eras: [era], girl: true, boy: false }, ["huge breasts", "pool", "swimming"]);
}

for (const era of ERAS) {
  add(`pin-bathing@${era}`, { sceneMode: "normal", heats: ["activity"], eras: [era], girl: true, boy: false }, ["bathing"]);
  add(`pin-sleeping@${era}`, { sceneMode: "normal", heats: ["activity"], eras: [era], girl: true, boy: false }, ["sleeping"]);
  add(`pin-hof@${era}`, { sceneMode: "normal", heats: ["tease"], eras: [era], girl: true, boy: false }, ["head out of frame"]);
}

const extra = [
  ["pin swimming modern", { sceneMode: "normal", heats: ["activity"], eras: ["modern"], girl: true, boy: false }, ["swimming"]],
  ["pin driving", { sceneMode: "normal", heats: ["activity"], eras: ["modern"], girl: true, boy: false }, ["driving"]],
  ["pin cooking medieval", { sceneMode: "normal", heats: ["activity"], eras: ["medieval"], girl: true, boy: false }, ["cooking"]],
  ["pin picnic china", { sceneMode: "normal", heats: ["activity"], eras: ["ancient_china"], girl: true, boy: false }, ["picnic"]],
  ["pin horseback medieval", { sceneMode: "normal", heats: ["activity"], eras: ["medieval"], girl: true, boy: false }, ["horseback riding"]],
  ["boy edo tease", { sceneMode: "normal", heats: ["tease"], eras: ["edo"], girl: false, boy: true }, []],
  ["boy greece sex", { sceneMode: "normal", heats: ["sex"], eras: ["ancient_greece"], girl: false, boy: true }, []],
  ["flash victorian", { sceneMode: "normal", heats: ["flash"], eras: ["victorian"], girl: true, boy: false }, []],
  ["flash edo", { sceneMode: "diverse", heats: ["flash"], eras: ["edo"], girl: true, boy: false }, []],
  ["pair china sex", { sceneMode: "diverse", heats: ["sex"], eras: ["ancient_china"], girl: true, boy: true }, []],
  ["weird greece sex", { sceneMode: "weird", heats: ["sex"], eras: ["ancient_greece"], girl: true, boy: true }, []],
  ["OL victorian", { sceneMode: "normal", heats: ["tease"], eras: ["victorian"], girl: true, boy: false }, ["office lady"]],
  ["classroom edo", { sceneMode: "normal", heats: ["activity"], eras: ["edo"], girl: true, boy: false }, ["classroom", "school uniform"]],
];
for (const [label, over, pins] of extra) add(label, over, pins);

const rows = [];
for (const sc of scenarios) {
  const s = settings(sc.over);
  let pinned;
  if (sc.label.startsWith("preset:") || sc.label.startsWith("preset-sex:")) {
    const id = sc.label.split(":")[1];
    const p = BUILTIN_PRESETS.find((x) => x.id === id);
    pinned = applyPresetTags(lex, p.tags, pinTags(["huge breasts"]));
  } else if (sc.label.startsWith("preset-era:")) {
    pinned = pinTags(sc.pins);
  } else {
    pinned = pinTags(sc.pins);
  }
  const drawn = drawOne(lex, s, pinned, new Set(), mulberry32(sc.seed), sc.seed);
  const have = tagsOf(drawn);
  const rec = {
    id: rows.length + 1,
    label: sc.label,
    mode: s.sceneMode,
    heats: s.heats,
    era: drawn.era,
    wantedEra: (sc.over.eras || [])[0] || "",
    cast: s.girl && s.boy ? "both" : s.boy ? "boy" : "girl",
    drawJob: !!s.drawJob,
    pinned: [...pinned],
    job: have.filter((t) => mutexOf(t) === "job"),
    act: have.filter((t) => mutexOf(t) === "activity"),
    sex: have.filter((t) => mutexOf(t) === "sex_act"),
    body: have.filter((t) => mutexOf(t) === "body_pose"),
    cam: have.filter((t) => mutexOf(t) === "camera"),
    env: drawn.sections.env,
    clothing: drawn.sections.clothing,
    pose: drawn.sections.pose,
    positive: drawn.positive,
    issues: scan(have, pinned, s.sceneMode, s.heats, drawn.era),
  };
  rows.push(rec);
}

const txt = [`r7 n=${rows.length} counts=10 modes×combos×eras\n`, ...rows.map(fmt)].join("\n");
writeFileSync(join(ROOT, "scripts/prompt_audit/r7.txt"), txt);
writeFileSync(join(ROOT, "scripts/prompt_audit/r7.json"), JSON.stringify(rows, null, 2));
const flagged = rows.filter((r) => r.issues.length);
console.log(`wrote ${rows.length} samples, mechanical flags=${flagged.length}`);
const byEra = {};
for (const r of rows) {
  byEra[r.era] = (byEra[r.era] || 0) + 1;
}
console.log("by era", byEra);
for (const r of flagged) {
  console.log(`#${r.id} ${r.label} [${r.mode}/${r.era}/${r.heats.join("+")}] ${r.issues.join(" | ")}`);
}
