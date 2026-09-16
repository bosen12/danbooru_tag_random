#!/usr/bin/env node
/** Quiz building tests. Failures print and exit 1. */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { defaultSettings, drawOne, indexLexicon, mulberry32 } from "../web/engine.js";
import { createQueue, generate, sseEvents } from "../game/queue.js";
import { emptyRecord, heatsFor, load, recordRun, sanitizeRecord, save, STORE_KEY } from "../game/store.js";
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
  // 原本測的是「soft lighting 每張圖都有，所以不能拿來當答案」。soft lighting 已經
  // 移除（Danbooru 0 篇，也不在 Illustrious 的訓練字彙裡），但那條不變式仍然成立且
  // 該守住：alwaysEnv 裡的東西每張圖都有，拿來當題目等於送分，而且湊不出干擾項。
  const always = lex.data.alwaysEnv || [];
  let alwaysEligible = 0;
  for (const draw of sample) {
    for (const sec of ANSWER_SECTIONS) {
      for (const cand of eligibleAnswers(lex, draw, banlist, sec)) {
        if (always.includes(cand.tag)) alwaysEligible += 1;
      }
    }
  }
  ok("alwaysEnv tags are never eligible answers", alwaysEligible === 0, `hits=${alwaysEligible}`);
  ok("the retired soft lighting tag is gone from the lexicon", !lex.byTag.has("soft lighting"));
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

{
  ok("a fresh record is all zeroes on mixed",
    JSON.stringify(emptyRecord()) === JSON.stringify({ best: 0, bestStreak: 0, heatPreset: "mixed" }));

  const junk = sanitizeRecord({ best: "abc", bestStreak: -4, heatPreset: "banana" });
  ok("garbage sanitizes to a usable record",
    JSON.stringify(junk) === JSON.stringify({ best: 0, bestStreak: 0, heatPreset: "mixed" }), JSON.stringify(junk));
  ok("null sanitizes too", JSON.stringify(sanitizeRecord(null)) === JSON.stringify(emptyRecord()));

  const kept = sanitizeRecord({ best: 12.7, bestStreak: 3, heatPreset: "sex" });
  ok("real values survive and floor",
    JSON.stringify(kept) === JSON.stringify({ best: 12, bestStreak: 3, heatPreset: "sex" }), JSON.stringify(kept));

  const one = recordRun(emptyRecord(), { score: 9, streak: 2 });
  ok("a first run sets both records", one.best === 9 && one.bestStreak === 2, JSON.stringify(one));
  const worse = recordRun(one, { score: 3, streak: 5 });
  ok("only the better half of a run moves", worse.best === 9 && worse.bestStreak === 5, JSON.stringify(worse));
  ok("recordRun keeps the heat preference",
    recordRun({ ...one, heatPreset: "tease" }, { score: 1, streak: 1 }).heatPreset === "tease");

  ok("mixed means three heats", JSON.stringify(heatsFor("mixed")) === JSON.stringify(["tease", "flash", "sex"]));
  ok("a single preset means one heat", JSON.stringify(heatsFor("tease")) === JSON.stringify(["tease"]));

  const mem = new Map();
  const fake = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v),
  };
  ok("loading empty storage gives a fresh record",
    JSON.stringify(load(fake)) === JSON.stringify(emptyRecord()));
  save(fake, { best: 5, bestStreak: 2, heatPreset: "flash" });
  ok("what was saved comes back",
    JSON.stringify(load(fake)) === JSON.stringify({ best: 5, bestStreak: 2, heatPreset: "flash" }), mem.get(STORE_KEY));
  mem.set(STORE_KEY, "{not json");
  ok("corrupt storage does not throw", JSON.stringify(load(fake)) === JSON.stringify(emptyRecord()));

  const dead = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  ok("storage that throws does not take the game down",
    JSON.stringify(load(dead)) === JSON.stringify(emptyRecord()));
  save(dead, emptyRecord());
  ok("saving into blocked storage is silent", true);
}

{
  function sseRes(frames, status = 200) {
    const body = new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        const all = frames
          .map(([e, d]) => `event: ${e}
data: ${JSON.stringify(d)}

`)
          .join("");
        // 故意切在奇怪的位置，確認跨 chunk 的解析
        for (let i = 0; i < all.length; i += 7) c.enqueue(enc.encode(all.slice(i, i + 7)));
        c.close();
      },
    });
    return { ok: status === 200, status, body };
  }

  const got = [];
  for await (const ev of sseEvents(
    sseRes([
      ["queued", { seed: 5 }],
      ["progress", { value: 3, max: 25 }],
      ["done", { ok: true, image: "/api/image?x=1", seed: 5 }],
    ])
  )) {
    got.push(ev.event);
  }
  ok("parses events split across chunk boundaries",
    JSON.stringify(got) === JSON.stringify(["queued", "progress", "done"]), JSON.stringify(got));

  const seen = [];
  const job = await generate("1girl", {
    fetchImpl: async () =>
      sseRes([
        ["progress", { value: 1, max: 25 }],
        ["done", { ok: true, image: "/api/image?x=2", seed: 9 }],
      ]),
    onEvent: (e) => seen.push(e),
  });
  ok("generate resolves with the done payload", job.image === "/api/image?x=2" && job.seed === 9, JSON.stringify(job));
  ok("generate reports progress on the way", seen.includes("progress"), JSON.stringify(seen));

  let threw = null;
  try {
    await generate("1girl", { fetchImpl: async () => sseRes([["error", { error: "Comfy boom" }]]) });
  } catch (err) {
    threw = err;
  }
  ok("an error event rejects", threw !== null && /Comfy boom/.test(threw.message), String(threw));

  let made = 0;
  let gen = 0;
  const q = createQueue({
    makeRound: () => {
      made += 1;
      return made === 1 ? null : { draw: { positive: "t" + made }, n: made };
    },
    generateImpl: async () => {
      gen += 1;
      return { image: "/img" + gen, seed: gen };
    },
  });
  const first = await q.take();
  ok("a null round costs a makeRound call but no generation",
    first.n === 2 && made === 3 && gen === 2, `n=${first.n} made=${made} gen=${gen}`);
  const second = await q.take();
  ok("the primed round comes back without a fresh wait", second.n === 3, `n=${second.n}`);

  let tries = 0;
  const flaky = createQueue({
    makeRound: () => ({ draw: { positive: "x" } }),
    generateImpl: async () => {
      tries += 1;
      if (tries < 3) throw new Error("comfy down");
      return { image: "/ok", seed: 1 };
    },
  });
  const round = await flaky.take();
  ok("a failed generation retries instead of surfacing", round.image === "/ok" && tries >= 3, `tries=${tries}`);
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nok");
