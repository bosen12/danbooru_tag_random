#!/usr/bin/env node
/** Quiz building tests. Failures print and exit 1. */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { defaultSettings, drawOne, indexLexicon, mulberry32 } from "../web/engine.js";
import {
  ANSWER_SECTIONS,
  DISTRACTORS_PER_ANSWER,
  banlistFrom,
  drawnTags,
  eligibleAnswers,
} from "../game/quiz.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web/lexicon.json"), "utf8"));
const unguessable = JSON.parse(readFileSync(join(ROOT, "game/unguessable.json"), "utf8"));
const lex = indexLexicon(data);
const banlist = banlistFrom(unguessable, lex);

let failed = 0;
function ok(name, cond, detail) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL ${name}${detail ? "\n  " + detail : ""}`);
  } else console.log(`ok   ${name}`);
}

function settings() {
  const s = defaultSettings(data);
  s.girl = true;
  s.boy = false;
  s.heats = ["tease", "flash", "sex"];
  return s;
}

function draws(n, seed0 = 9000) {
  const s = settings();
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(drawOne(lex, s, new Set(), new Set(), mulberry32(seed0 + i), seed0 + i));
  }
  return out;
}

const sample = draws(200);

{
  let missing = 0;
  for (const draw of sample) {
    const live = ANSWER_SECTIONS.filter(
      (sec) => eligibleAnswers(lex, draw, banlist, sec).length > 0
    );
    if (live.length < 3) missing += 1;
  }
  ok("every draw yields 3 sections with an eligible answer", missing === 0, `missing=${missing}/200`);
}

{
  let bad = 0;
  let total = 0;
  for (const draw of sample) {
    const drawn = drawnTags(draw);
    for (const sec of ANSWER_SECTIONS) {
      for (const cand of eligibleAnswers(lex, draw, banlist, sec)) {
        total += 1;
        if (!drawn.has(cand.tag)) bad += 1;
        if (cand.siblings.length < DISTRACTORS_PER_ANSWER) bad += 1;
        if (cand.siblings.some((s) => drawn.has(s))) bad += 1;
        if (banlist.has(cand.tag)) bad += 1;
      }
    }
  }
  ok("eligible answers are drawn, unbanned, 3 clean siblings", bad === 0, `bad=${bad} of ${total}`);
}

{
  ok(
    "soft lighting is in the draws at all",
    sample.filter((d) => drawnTags(d).has("soft lighting")).length > 0
  );
  let soft = 0;
  for (const draw of sample) {
    for (const sec of ANSWER_SECTIONS) {
      if (eligibleAnswers(lex, draw, banlist, sec).some((c) => c.tag === "soft lighting")) soft += 1;
    }
  }
  ok("soft lighting is never eligible", soft === 0, `soft=${soft}`);
}

{
  let dusk = 0;
  for (const draw of sample) {
    if (eligibleAnswers(lex, draw, banlist, "env").some((c) => c.tag === "dusk")) dusk += 1;
  }
  ok("a banned mutex group takes all its members out", dusk === 0, `dusk=${dusk}`);
}

{
  const bare = banlistFrom({ tags: [] }, lex);
  const banned = banlistFrom({ tags: ["kneeling"] }, lex);
  let base = 0;
  let gone = 0;
  for (const draw of sample) {
    if (eligibleAnswers(lex, draw, bare, "pose").some((c) => c.tag === "kneeling")) base += 1;
    if (eligibleAnswers(lex, draw, banned, "pose").some((c) => c.tag === "kneeling")) gone += 1;
  }
  ok("kneeling is eligible when nothing is banned", base > 0, `base=${base}/200`);
  ok("banning the tag removes it", gone === 0, `gone=${gone}`);
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nok");
