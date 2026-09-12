#!/usr/bin/env node
/** Simulate human ops, dump POS samples, mechanically flag 文意 clashes. */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  applyPin,
  applyPresetTags,
  BUILTIN_PRESETS,
  defaultSettings,
  drawOne,
  indexLexicon,
  mulberry32,
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
  "closed eyes",
  "facial",
  "cum in mouth",
  "cum on face",
  "licking penis",
  "covering own mouth",
  "french kiss",
  "finger to mouth",
  "eating",
  "drinking",
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
const SCENE_BAD = {
  office: /\b(swimsuit|bikini|armor|hakama|maid|kimono|yukata|cheerleader|sneakers|sports bra|fishnets|thong|latex|lab coat|idol)\b/,
  school: /\b(swimsuit|bikini|armor|maid|evening gown|police uniform|latex|wedding dress|hard hat|thong)\b/,
  nurse: /\b(swimsuit|bikini|armor|maid|school uniform|serafuku|evening gown|hakama|police|sneakers|fishnets)\b/,
  maid: /\b(swimsuit|bikini|armor|school uniform|police|evening gown|hakama|lab coat|latex|sports bra)\b/,
  police: /\b(swimsuit|bikini|maid|school swimsuit|evening gown|hakama|armor|sneakers|sports bra|thong|fishnets|latex)\b/,
  kitchen: /\b(swimsuit|bikini|armor|evening gown|hakama|maid|police)\b/,
};

function scan(have, pinned, mode, heats) {
  const H = new Set(have);
  const issues = [];
  const jobs = have.filter((t) => mutexOf(t) === "job");
  const acts = have.filter((t) => mutexOf(t) === "activity");
  const places = have.filter((t) => mutexOf(t) === "place" || groupOf(t) === "place");
  const bodies = have.filter((t) => mutexOf(t) === "body_pose");
  const cams = have.filter((t) => mutexOf(t) === "camera");
  const garments = have.filter((t) => sectionOf(t) === "clothing" && layerOf(t) === "garment" && !pinned.has(t));

  if (H.has("swimming") || H.has("wading")) {
    const bad = [...PLANT].filter((t) => H.has(t));
    if (bad.length) issues.push(`swimming/wading + planted body ${bad.join("/")}`);
  }
  if ([...FACELESS].some((t) => H.has(t))) {
    const face = have.filter(
      (t) =>
        FACE_NEED.has(t) ||
        mutexOf(t) === "gaze" ||
        mutexOf(t) === "expression" ||
        groupOf(t) === "face" ||
        t === "kissing" ||
        t === "smile" ||
        t === "wink" ||
        /^looking /.test(t)
    );
    if (face.length) issues.push(`faceless cam + face/mouth ${face.join("/")}`);
  }
  if (H.has("sleeping")) {
    const bad = have.filter(
      (t) =>
        AWAKE.has(t) ||
        /^looking /.test(t) ||
        t === "kissing" ||
        mutexOf(t) === "gaze" ||
        EYE.has(t) ||
        MOUTH.has(t)
    );
    if (bad.length) issues.push(`sleeping + awake/gaze/face ${bad.join("/")}`);
  }
  if (H.has("closed eyes")) {
    const bad = have.filter((t) => EYE.has(t) || mutexOf(t) === "gaze" || /^looking /.test(t));
    if (bad.length) issues.push(`closed eyes + gaze/looking ${bad.join("/")}`);
  }
  if ([...DAY].some((t) => H.has(t)) && [...NIGHT].some((t) => H.has(t))) {
    issues.push(`day/sun vs night ${[...have.filter((t) => DAY.has(t) || NIGHT.has(t))].join("/")}`);
  }
  if ((H.has("dusk") || H.has("sunset")) && [...NIGHT].some((t) => H.has(t))) {
    issues.push(`dusk/sunset vs night ${[...have.filter((t) => t === "dusk" || t === "sunset" || NIGHT.has(t))].join("/")}`);
  }
  const eyes = have.filter((t) => EYE.has(t));
  if (eyes.length > 1) issues.push(`two eye extras ${eyes.join("/")}`);
  const mouths = have.filter((t) => MOUTH.has(t));
  if (mouths.length > 1) issues.push(`two mouth extras ${mouths.join("/")}`);
  if (H.has("floating") && [...bodies, ...have].some((t) => PLANT.has(t) || GROUND.has(t) || LOCKED_SIT.has(t) || t === "dancing")) {
    issues.push(`floating + planted ${bodies.join("/")}`);
  }
  if (H.has("driving") && [...bodies].some((t) => STILL.has(t) || GROUND.has(t))) {
    issues.push(`driving + still/ground ${bodies.join("/")}`);
  }
  if ([...bodies].some((t) => GROUND.has(t)) && acts.some((a) => MOVE.has(a) || a === "picnic" || a === "eating" || a === "playing games")) {
    issues.push(`ground body + act ${acts.join("/")} ${bodies.join("/")}`);
  }
  if (H.has("dancing") && acts.some((a) => a !== "dancing" && (MOVE.has(a) || ["studying", "yoga", "stretching", "playing games", "playing guitar", "reading", "writing"].includes(a)))) {
    issues.push(`dancing + conflicting act ${acts.join("/")}`);
  }
  if (H.has("outdoors") && have.some((t) => INDOOR_PROP.has(t) || INDOOR_FURN.has(t))) {
    issues.push(`outdoors + indoor leftover ${have.filter((t) => INDOOR_PROP.has(t) || INDOOR_FURN.has(t)).join("/")}`);
  }
  if (H.has("indoors") && have.some((t) => OUTDOOR_LEFTOVER.has(t))) {
    issues.push(`indoors + outdoor leftover ${have.filter((t) => OUTDOOR_LEFTOVER.has(t)).join("/")}`);
  }
  if ([...H].some((t) => t === "pool" || t === "ocean" || t === "underwater") && have.some((t) => INDOOR_FURN.has(t))) {
    issues.push(`water place + indoor furniture ${have.filter((t) => INDOOR_FURN.has(t)).join("/")}`);
  }
  if ((H.has("on bed") || H.has("bed sheet")) && !["bedroom", "bed", "hotel room", "love hotel", "futon"].some((p) => H.has(p))) {
    issues.push("on bed without bedroom-like place");
  }
  if (mode === "normal") {
    if (H.has("dark-skinned male") && !pinned.has("dark-skinned male")) issues.push("normal auto dark-skinned male");
    if (have.some((t) => mutexOf(t) === "race" && !pinned.has(t))) {
      issues.push(`normal auto race ${have.filter((t) => mutexOf(t) === "race").join("/")}`);
    }
    for (const j of jobs) {
      const ok = JOB_PLACE[j];
      if (ok && places.length && !places.some((p) => ok.has(p))) {
        issues.push(`job ${j} at ${places.join("/")}`);
      }
    }
    let kind = null;
    if (H.has("pool") || H.has("beach") || H.has("swimming") || H.has("ocean")) kind = "swim";
    else if ([...BATH_PLACE].some((t) => H.has(t)) || H.has("bathing")) kind = "bath";
    else if (H.has("office lady") || H.has("office")) kind = "office";
    else if (H.has("nurse")) kind = "nurse";
    else if (H.has("maid")) kind = "maid";
    else if (H.has("policewoman")) kind = "police";
    else if (H.has("classroom") || H.has("school uniform")) kind = "school";
    else if (H.has("kitchen") || H.has("cooking")) kind = "kitchen";
    if (kind === "swim") {
      const bad = garments.filter((t) => !/\b(swimsuit|bikini)\b/.test(t) && t !== "wet clothes" && (/\barmor\b/.test(t) || /\bsuit\b/.test(t) || true) && !/\b(swimsuit|bikini)\b/.test(t) && t !== "wet clothes");
      const modernBad = garments.filter((t) => t !== "wet clothes" && !/\b(swimsuit|bikini)\b/.test(t) && !(lex.byTag.get(t)?.implies || []).some((d) => /\b(swimsuit|bikini)\b/.test(d)));
      if (modernBad.length) issues.push(`normal swimwear leak ${modernBad.join("/")}`);
    } else if (kind === "bath") {
      const bad = garments.filter((t) => /\b(armor|suit|sneakers|boots|geta|idol clothes|latex|sweater|fishnets|pantyhose|jacket|thong)\b/.test(t));
      if (bad.length) issues.push(`normal bath cloth leak ${bad.join("/")}`);
    } else if (kind && SCENE_BAD[kind]) {
      const bad = garments.filter((t) => SCENE_BAD[kind].test(t));
      if (bad.length) issues.push(`normal ${kind} cloth leak ${bad.join("/")}`);
    }
  }
  if (heats.includes("activity") && !heats.includes("sex") && have.some((t) => mutexOf(t) === "sex_act")) {
    issues.push(`activity heat leftover sex_act ${have.filter((t) => mutexOf(t) === "sex_act").join("/")}`);
  }
  return issues;
}

function fmt(rec) {
  return [
    `#${rec.id} ${rec.label} mode=${rec.mode} heats=${rec.heats.join("+")} era=${rec.era} cast=${rec.cast} jobDraw=${rec.drawJob} pin=[${rec.pinned.join(", ")}]`,
    `  job=[${rec.job.join(", ")}] act=[${rec.act.join(", ")}] sex=[${rec.sex.join(", ")}] body=[${rec.body.join(", ")}] cam=[${rec.cam.join(", ")}]`,
    `  env=[${rec.env.join(", ")}] cloth=[${rec.clothing.join(", ")}]`,
    `  pose=[${rec.pose.join(", ")}]`,
    `  POS: ${rec.positive}`,
    rec.issues.length ? `  MECH: ${rec.issues.join(" | ")}` : "  MECH: ok",
    "",
  ].join("\n");
}

const scenarios = [];
let seed = 310000;

function add(label, over, pins) {
  scenarios.push({ label, over, pins, seed: seed++ });
}

for (const p of BUILTIN_PRESETS) {
  for (const mode of ["normal", "diverse", "weird"]) {
    for (const heat of ["activity", "tease", "sex"]) {
      add(`preset:${p.id}`, { sceneMode: mode, heats: [heat], eras: ["modern"], girl: true, boy: false, drawJob: false }, ["huge breasts", ...p.tags]);
    }
  }
}

const extra = [
  ["pin sleeping", { sceneMode: "normal", heats: ["activity"], eras: ["modern"], girl: true, boy: false }, ["sleeping"]],
  ["pin HOF tease", { sceneMode: "normal", heats: ["tease"], eras: ["modern"], girl: true, boy: false }, ["head out of frame"]],
  ["pin HOF sex", { sceneMode: "normal", heats: ["sex"], eras: ["modern"], girl: true, boy: true }, ["head out of frame"]],
  ["pin closed eyes", { sceneMode: "normal", heats: ["tease"], eras: ["modern"], girl: true, boy: false }, ["closed eyes"]],
  ["pin swimming", { sceneMode: "normal", heats: ["activity"], eras: ["modern"], girl: true, boy: false }, ["swimming"]],
  ["pin driving", { sceneMode: "normal", heats: ["activity"], eras: ["modern"], girl: true, boy: false }, ["driving"]],
  ["pin cooking", { sceneMode: "normal", heats: ["activity"], eras: ["modern"], girl: true, boy: false }, ["cooking"]],
  ["pin nude sex", { sceneMode: "normal", heats: ["sex"], eras: ["modern"], girl: true, boy: false }, ["nude"]],
  ["boy tease", { sceneMode: "normal", heats: ["tease"], eras: ["modern"], girl: false, boy: true }, []],
  ["pair sex diverse", { sceneMode: "diverse", heats: ["sex"], eras: ["modern"], girl: true, boy: true }, []],
  ["edo bathing", { sceneMode: "normal", heats: ["activity"], eras: ["edo"], girl: true, boy: false }, ["bathing"]],
  ["greece swimming", { sceneMode: "normal", heats: ["activity"], eras: ["ancient_greece"], girl: true, boy: false }, ["swimming"]],
  ["china picnic", { sceneMode: "normal", heats: ["activity"], eras: ["ancient_china"], girl: true, boy: false }, ["picnic"]],
  ["medieval kitchen", { sceneMode: "normal", heats: ["activity"], eras: ["medieval"], girl: true, boy: false }, ["kitchen"]],
  ["flash modern", { sceneMode: "normal", heats: ["flash"], eras: ["modern"], girl: true, boy: false }, []],
  ["job nurse", { sceneMode: "normal", heats: ["tease"], eras: ["modern"], girl: true, boy: false, drawJob: true }, ["nurse"]],
  ["job maid", { sceneMode: "normal", heats: ["activity"], eras: ["modern"], girl: true, boy: false, drawJob: true }, ["maid"]],
  ["job OL", { sceneMode: "normal", heats: ["tease"], eras: ["modern"], girl: true, boy: false, drawJob: true }, ["office lady"]],
  ["pool+sleeping merge", { sceneMode: "normal", heats: ["activity"], eras: ["modern"], girl: true, boy: false }, ["huge breasts", "sleeping", "pool", "swimming"]],
  ["classroom+HOF", { sceneMode: "normal", heats: ["tease"], eras: ["modern"], girl: true, boy: false }, ["huge breasts", "classroom", "school uniform", "head out of frame"]],
  ["onsen+closed", { sceneMode: "normal", heats: ["tease"], eras: ["modern"], girl: true, boy: false }, ["onsen", "bathing", "closed eyes"]],
  ["weird restaurant sex", { sceneMode: "weird", heats: ["sex"], eras: ["modern"], girl: true, boy: true }, ["restaurant"]],
  ["diverse public sex", { sceneMode: "diverse", heats: ["sex"], eras: ["modern"], girl: true, boy: true }, ["park"]],
  ["pin looking at penis + closed", { sceneMode: "normal", heats: ["sex"], eras: ["modern"], girl: true, boy: true }, ["closed eyes"]],
];
for (const [label, over, pins] of extra) add(label, over, pins);

const rows = [];
for (const sc of scenarios) {
  const s = settings(sc.over);
  let pinned;
  if (sc.pins.includes("huge breasts") && sc.label.startsWith("preset:")) {
    const id = sc.label.slice("preset:".length);
    const p = BUILTIN_PRESETS.find((x) => x.id === id);
    pinned = applyPresetTags(lex, p.tags, pinTags(["huge breasts"]));
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
    issues: scan(have, pinned, s.sceneMode, s.heats),
  };
  rows.push(rec);
}

const txt = [`r6 n=${rows.length} counts=10\n`, ...rows.map(fmt)].join("\n");
writeFileSync(join(ROOT, "scripts/prompt_audit/r6.txt"), txt);
writeFileSync(join(ROOT, "scripts/prompt_audit/r6.json"), JSON.stringify(rows, null, 2));
const flagged = rows.filter((r) => r.issues.length);
console.log(`wrote ${rows.length} samples, mechanical flags=${flagged.length}`);
for (const r of flagged) {
  console.log(`#${r.id} ${r.label} [${r.mode}/${r.heats.join("+")}] ${r.issues.join(" | ")}`);
}
