#!/usr/bin/env node
/** Quiz building tests. Failures print and exit 1. */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { defaultSettings, drawOne, indexLexicon, mulberry32 } from "../web/engine.js";
import {
  ANSWER_COUNT,
  ANSWER_SECTIONS,
  CHOICE_COUNT,
  DISTRACTORS_PER_ANSWER,
  banlistFrom,
  drawnTags,
  eligibleAnswers,
  makeQuestion,
  related,
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

{
  const s = settings();
  const N = 400;
  let nulls = 0;
  let badCount = 0;
  let badSection = 0;
  let dupTag = 0;
  let notDrawn = 0;
  let distractorDrawn = 0;
  let distractorRelated = 0;
  let answerRelated = 0;

  for (let i = 0; i < N; i++) {
    const seed = 20000 + i;
    const draw = drawOne(lex, s, new Set(), new Set(), mulberry32(seed), seed);
    const q = makeQuestion(lex, draw, mulberry32(seed), banlist);
    if (!q) {
      nulls += 1;
      continue;
    }
    const drawn = drawnTags(draw);
    if (q.answers.length !== ANSWER_COUNT || q.choices.length !== CHOICE_COUNT) badCount += 1;
    if (q.choices.filter((c) => c.correct).length !== ANSWER_COUNT) badCount += 1;
    if (new Set(q.answers.map((a) => a.section)).size !== ANSWER_COUNT) badSection += 1;
    if (new Set(q.choices.map((c) => c.tag)).size !== CHOICE_COUNT) dupTag += 1;
    for (const a of q.answers) if (!drawn.has(a.tag)) notDrawn += 1;
    for (const c of q.choices.filter((c) => !c.correct)) {
      if (drawn.has(c.tag)) distractorDrawn += 1;
      if (q.answers.some((a) => related(lex, a.tag, c.tag))) distractorRelated += 1;
    }
    for (const a of q.answers) {
      for (const b of q.answers) {
        if (a.tag !== b.tag && related(lex, a.tag, b.tag)) answerRelated += 1;
      }
    }
  }

  ok("null is a safety valve, not the norm", nulls / N < 0.02, `nulls=${nulls}/${N}`);
  ok("3 answers, 12 choices, 3 of them correct", badCount === 0, `bad=${badCount}`);
  ok("answers span 3 distinct sections", badSection === 0, `bad=${badSection}`);
  ok("no tag appears twice among the 12 choices", dupTag === 0, `bad=${dupTag}`);
  ok("answers are tags the image actually drew", notDrawn === 0, `bad=${notDrawn}`);
  ok("no distractor was drawn in the image", distractorDrawn === 0, `bad=${distractorDrawn}`);
  ok("no distractor relates to any answer", distractorRelated === 0, `bad=${distractorRelated}`);
  ok("answers do not relate to each other", answerRelated === 0, `bad=${answerRelated}`);

  const draw = drawOne(lex, s, new Set(), new Set(), mulberry32(77), 77);
  const a = makeQuestion(lex, draw, mulberry32(77), banlist);
  const b = makeQuestion(lex, draw, mulberry32(77), banlist);
  ok("the same seed gives the identical question", JSON.stringify(a) === JSON.stringify(b));
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nok");
