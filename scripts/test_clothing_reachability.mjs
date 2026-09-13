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
const settings = defaultSettings(data);
settings.girl = true;
settings.boy = true;
settings.heats = ["tease"];
settings.eras = ["modern"];
settings.sceneMode = "weird";
settings.lockScene = false;
settings.drawJob = true;
settings.counts = { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 };

const families = {
  top: new Set(["white shirt", "blue shirt", "black shirt", "green shirt", "pink shirt", "red shirt"]),
  bottom: new Set(["black skirt", "blue skirt", "brown skirt", "white skirt", "blue pants", "black pants"]),
  onepiece: new Set(["white dress", "blue dress", "red dress", "green dress", "pink dress", "purple dress"]),
};
const seen = new Map(Object.keys(families).map((key) => [key, new Set()]));
const fabrics = new Set(["wide sleeves", "frills", "long sleeves", "short sleeves", "sleeves rolled up", "detached sleeves", "puffy sleeves"]);
const jobs = new Set(["nurse", "doctor", "scientist", "construction worker"]);
const jobGear = new Set(["nurse cap", "lab coat", "stethoscope", "hard hat"]);
const seenFabric = new Set();
const seenJobs = new Set();
const seenJobGear = new Set();
let sleeveClashes = 0;

for (let i = 0; i < 1200; i += 1) {
  const seed = 920000 + i;
  const out = drawOne(lex, settings, new Set(), new Set(), mulberry32(seed), seed);
  const tags = new Set(out.positive.split(",").map((raw) => raw.trim()));
  for (const [family, wanted] of Object.entries(families)) {
    for (const tag of wanted) if (tags.has(tag)) seen.get(family).add(tag);
  }
  for (const tag of fabrics) if (tags.has(tag)) seenFabric.add(tag);
  for (const tag of jobs) if (tags.has(tag)) seenJobs.add(tag);
  for (const tag of jobGear) if (tags.has(tag)) seenJobGear.add(tag);
  if (tags.has("long sleeves") && tags.has("short sleeves")) sleeveClashes += 1;
}

let failed = 0;
for (const [family, tags] of seen) {
  if (tags.size) {
    console.log(`ok   clothing ${family} color variants are reachable: ${[...tags].join(", ")}`);
  } else {
    failed += 1;
    console.error(`FAIL clothing ${family} color variants are structurally starved`);
  }
}

if (seenFabric.size) console.log(`ok   fabric details are reachable: ${[...seenFabric].join(", ")}`);
else {
  failed += 1;
  console.error("FAIL clothing fabric details are structurally starved");
}
if (sleeveClashes === 0) console.log("ok   long sleeves and short sleeves never coexist");
else {
  failed += 1;
  console.error(`FAIL long sleeves and short sleeves coexist: ${sleeveClashes}/1200`);
}
if (seenJobs.size === jobs.size) console.log(`ok   jobs with implied gear are reachable: ${[...seenJobs].join(", ")}`);
else {
  failed += 1;
  console.error(`FAIL jobs with implied gear are blocked: missing ${[...jobs].filter((tag) => !seenJobs.has(tag)).join(", ")}`);
}
if (seenJobGear.size === jobGear.size) console.log(`ok   implied job gear lands: ${[...seenJobGear].join(", ")}`);
else {
  failed += 1;
  console.error(`FAIL implied job gear is missing: ${[...jobGear].filter((tag) => !seenJobGear.has(tag)).join(", ")}`);
}

if (failed) process.exit(1);
