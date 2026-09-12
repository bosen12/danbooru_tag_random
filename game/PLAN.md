# 看圖猜 tag 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `game/` 做出一個看圖猜 tag 的網頁遊戲，掛在 `server.py` 上當第五個版面。

**Architecture:** `drawOne()` 抽 tag、ComfyUI 生圖、`quiz.js` 把抽牌結果變成一道三空十二選的題。`quiz.js` 是零 import 的純函式，`queue.js` 只管網路，`main.js` 只管畫面。`game/` 不放 `engine.js` / `tokens.css` / `lexicon.json`，靠 `server.py` 的 SHARED fallback 從 `web/` 拿。

**Tech Stack:** 原生 ES modules、無建置步驟、無 npm 套件。測試用 node 直接跑 `.mjs`。

完整設計在 `game/DESIGN.md`。

## Global Constraints

- **`server.py` 一行都不能改。** `game/` 靠 `WEB_DIR=game` 掛上去，API 全部沿用。
- **不准複製 `engine.js` / `tokens.css` / `lexicon.json` 到 `game/`。** 它們由 SHARED fallback 供應。
- 沒有 `package.json`，所以**不准引入任何 npm 套件**，測試也不行。
- `quiz.js` **零 import**：只吃 `indexLexicon()` 的產物。這是它能在 node 測試裡跑的前提——`game/engine.js` 在檔案系統上不存在，只有 server 跑起來時才被 fallback 出來。
- 介面中文，`<html lang="zh-Hant">`。tag 顯示中文，hover 出英文。
- 圖片固定 **1024×1024**，預抽深度 **1 題**。
- 三條命、三個答案、十二個候選：`ANSWER_COUNT = 3`、`DISTRACTORS_PER_ANSWER = 3`、`CHOICE_COUNT = 12`。
- 洗牌一律吃傳入的 `rand`，**不准用 `Math.random()`**——同一顆 seed 必須出一樣的題。
- 新測試掛進 `test.bat`，跟 `test_engine.mjs` 並列。

---

### Task 1: 出題資格

決定哪些 tag 有資格當答案。這是整個遊戲品質的地基。

**Files:**
- Create: `game/quiz.js`
- Create: `game/unguessable.json`
- Create: `scripts/test_quiz.mjs`
- Modify: `test.bat`

**Interfaces:**
- Consumes: `indexLexicon()` 的產物 `lex`（用到 `lex.siblings`、`lex.mutexOf`、`lex.byTag`）、`drawOne()` 的產物 `draw`（用到 `draw.sections`）
- Produces:
  - `ANSWER_SECTIONS: string[]`、`ANSWER_COUNT: 3`、`DISTRACTORS_PER_ANSWER: 3`、`CHOICE_COUNT: 12`
  - `banlistFrom(unguessable, lex) → Set<string>`
  - `drawnTags(draw) → Set<string>`
  - `siblingsOf(lex, tag) → string[]`
  - `eligibleAnswers(lex, draw, banlist, section) → Array<{tag, section, siblings}>`

- [ ] **Step 1: 寫 `game/unguessable.json`**

```json
{
  "note": "出不出得了題的黑名單。tags 擋單一 tag，groups 擋整個 mutex 群組。打到覺得刁難的題就往這裡加。",
  "tags": ["soft lighting"],
  "groups": ["day_night"]
}
```

`day_night` 是 白天/夜晚/傍晚/日落/日出/黃昏。後四個都是同一種暖光，人眼分不出來，所以整群擋掉。擋單一 tag 沒用——擋了黃昏，下次換傍晚當答案、黃昏當干擾項。

`soft lighting` 其實不是詞庫裡的 tag（`drawOne` 直接塞進每張圖的 `env`），同類數是 0 本來就出局，列在這裡是當這份檔案的用法範例。

- [ ] **Step 2: 寫會失敗的測試 `scripts/test_quiz.mjs`**

```js
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
```

- [ ] **Step 3: 跑測試，確認它失敗**

```bash
node scripts/test_quiz.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` — 找不到 `game/quiz.js`。

- [ ] **Step 4: 寫 `game/quiz.js`**

```js
/** 出題：把一次抽牌結果變成一道題。零 import，不碰 DOM、不碰網路。 */

export const ANSWER_SECTIONS = ["feature", "pose", "clothing", "env"];
export const ANSWER_COUNT = 3;
export const DISTRACTORS_PER_ANSWER = 3;
export const CHOICE_COUNT = ANSWER_COUNT * (DISTRACTORS_PER_ANSWER + 1);

/** 黑名單：tags 是單一 tag，groups 是整個 mutex 群，展開成 tag 一起擋。 */
export function banlistFrom(unguessable, lex) {
  const out = new Set((unguessable && unguessable.tags) || []);
  for (const group of (unguessable && unguessable.groups) || []) {
    for (const tag of lex.mutexOf.get(group) || []) out.add(tag);
  }
  return out;
}

export function drawnTags(draw) {
  const out = new Set();
  for (const list of Object.values((draw && draw.sections) || {})) {
    for (const tag of list) out.add(tag);
  }
  return out;
}

/** indexLexicon 已經把互斥同類算好了，mutexSiblings 只是它的包裝。 */
export function siblingsOf(lex, tag) {
  return (lex.siblings && lex.siblings.get(tag)) || [];
}

export function eligibleAnswers(lex, draw, banlist, section) {
  const drawn = drawnTags(draw);
  const out = [];
  for (const tag of (draw.sections && draw.sections[section]) || []) {
    if (banlist.has(tag)) continue;
    const siblings = siblingsOf(lex, tag).filter((s) => !drawn.has(s) && !banlist.has(s));
    if (siblings.length < DISTRACTORS_PER_ANSWER) continue;
    out.push({ tag, section, siblings });
  }
  return out;
}
```

- [ ] **Step 5: 跑測試，確認它過**

```bash
node scripts/test_quiz.mjs
```

Expected: 七行 `ok`，最後一行 `ok`，exit 0。

- [ ] **Step 6: 把測試掛進 `test.bat`**

在 `test.bat` 裡 `== engine ==` 那段之後、`== server ==` 之前插入：

```bat
echo == quiz ==
call node scripts\test_quiz.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
```

- [ ] **Step 7: 跑整套測試**

```bash
cmd //c test.bat
```

Expected: engine、quiz、server 三段都過，最後印 `all ok`。

- [ ] **Step 8: Commit**

```bash
git add game/quiz.js game/unguessable.json scripts/test_quiz.mjs test.bat
git commit -m "Pick which tags are fair game as answers."
```

---

### Task 2: 組題

把合格答案組成一道三空十二選的題。

**Files:**
- Modify: `game/quiz.js`（往後面加，不動 Task 1 寫的東西）
- Modify: `scripts/test_quiz.mjs`（往後面加）

**Interfaces:**
- Consumes: Task 1 的 `ANSWER_SECTIONS`、`ANSWER_COUNT`、`DISTRACTORS_PER_ANSWER`、`CHOICE_COUNT`、`eligibleAnswers`、`drawnTags`
- Produces:
  - `relativesOf(lex, tag) → Set<string>`
  - `related(lex, a, b) → boolean`
  - `makeQuestion(lex, draw, rand, banlist) → {answers, choices} | null`
    - `answers: Array<{tag: string, section: string}>`，長度 3
    - `choices: Array<{tag: string, correct: boolean}>`，長度 12，已洗牌

- [ ] **Step 1: 寫會失敗的測試**

先把 `scripts/test_quiz.mjs` 頂端從 `../game/quiz.js` 的 import 補成：

```js
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
```

再把下面這段加在 `if (failed) {` 之前：

```js
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
```

- [ ] **Step 2: 跑測試，確認它失敗**

```bash
node scripts/test_quiz.mjs
```

Expected: `SyntaxError: The requested module '../game/quiz.js' does not provide an export named 'makeQuestion'`。

- [ ] **Step 3: 把組題邏輯加到 `game/quiz.js` 後面**

```js
/** Fisher-Yates。吃傳入的 rand，所以同一顆 seed 出一樣的題。 */
function shuffle(list, rand) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** 沿 implies / bind 一路展開，拿到語意上被這個 tag 蘊含的全部 tag。 */
export function relativesOf(lex, tag) {
  const out = new Set();
  const queue = [tag];
  while (queue.length) {
    const item = lex.byTag.get(queue.pop());
    if (!item) continue;
    for (const next of [...(item.implies || []), ...(item.bind || [])]) {
      if (out.has(next)) continue;
      out.add(next);
      queue.push(next);
    }
  }
  return out;
}

export function related(lex, a, b) {
  if (a === b) return true;
  return relativesOf(lex, a).has(b) || relativesOf(lex, b).has(a);
}

export function makeQuestion(lex, draw, rand, banlist) {
  const picked = [];
  const taken = new Set();

  for (const section of shuffle(ANSWER_SECTIONS, rand)) {
    if (picked.length === ANSWER_COUNT) break;
    for (const cand of shuffle(eligibleAnswers(lex, draw, banlist, section), rand)) {
      if (taken.has(cand.tag)) continue;
      if (picked.some((p) => related(lex, p.tag, cand.tag))) continue;
      const distractors = shuffle(
        cand.siblings.filter((s) => !taken.has(s)),
        rand
      ).slice(0, DISTRACTORS_PER_ANSWER);
      if (distractors.length < DISTRACTORS_PER_ANSWER) continue;
      taken.add(cand.tag);
      for (const d of distractors) taken.add(d);
      picked.push({ tag: cand.tag, section, distractors });
      break;
    }
  }
  if (picked.length < ANSWER_COUNT) return null;

  // 互斥同類保證跟自己那個答案無關，但跨答案的碰撞要另外擋。撞到就整題作廢。
  for (const p of picked) {
    for (const d of p.distractors) {
      if (picked.some((q) => related(lex, q.tag, d))) return null;
    }
  }

  const choices = [];
  for (const p of picked) {
    choices.push({ tag: p.tag, correct: true });
    for (const d of p.distractors) choices.push({ tag: d, correct: false });
  }
  return {
    answers: picked.map((p) => ({ tag: p.tag, section: p.section })),
    choices: shuffle(choices, rand),
  };
}
```

- [ ] **Step 4: 跑測試，確認它過**

```bash
node scripts/test_quiz.mjs
```

Expected: 全部 `ok`，exit 0。`nulls` 實測是 `0/400`。

- [ ] **Step 5: Commit**

```bash
git add game/quiz.js scripts/test_quiz.mjs
git commit -m "Build a three-blank, twelve-choice question from one draw."
```

---

### Task 3: 紀錄

最高分、最長連勝、heat 偏好。算分是純函式，`localStorage` 只在最外層碰。

**Files:**
- Create: `game/store.js`
- Modify: `scripts/test_quiz.mjs`（往後面加）

**Interfaces:**
- Consumes: 無
- Produces:
  - `STORE_KEY: string`、`HEAT_PRESETS: string[]`
  - `emptyRecord() → {best, bestStreak, heatPreset}`
  - `sanitizeRecord(raw) → {best, bestStreak, heatPreset}`
  - `recordRun(prev, {score, streak}) → {best, bestStreak, heatPreset}`
  - `heatsFor(preset) → string[]`
  - `load(storage) → record`、`save(storage, record) → void`

- [ ] **Step 1: 寫會失敗的測試**

`scripts/test_quiz.mjs` 頂端加一行 import：

```js
import { emptyRecord, heatsFor, load, recordRun, sanitizeRecord, save, STORE_KEY } from "../game/store.js";
```

把下面這段加在 `if (failed) {` 之前：

```js
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
```

- [ ] **Step 2: 跑測試，確認它失敗**

```bash
node scripts/test_quiz.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` — 找不到 `game/store.js`。

- [ ] **Step 3: 寫 `game/store.js`**

```js
/** 本機紀錄。算分是純函式，localStorage 只在 load / save 碰。 */

export const STORE_KEY = "paizixia.game.v1";
export const HEAT_PRESETS = ["mixed", "tease", "flash", "sex"];

export function emptyRecord() {
  return { best: 0, bestStreak: 0, heatPreset: "mixed" };
}

export function sanitizeRecord(raw) {
  if (!raw || typeof raw !== "object") return emptyRecord();
  const best = Number(raw.best);
  const streak = Number(raw.bestStreak);
  const preset = String(raw.heatPreset || "");
  return {
    best: Number.isFinite(best) && best > 0 ? Math.floor(best) : 0,
    bestStreak: Number.isFinite(streak) && streak > 0 ? Math.floor(streak) : 0,
    heatPreset: HEAT_PRESETS.includes(preset) ? preset : "mixed",
  };
}

export function recordRun(prev, run) {
  const base = sanitizeRecord(prev);
  return {
    best: Math.max(base.best, Math.floor(Number(run && run.score) || 0)),
    bestStreak: Math.max(base.bestStreak, Math.floor(Number(run && run.streak) || 0)),
    heatPreset: base.heatPreset,
  };
}

export function heatsFor(preset) {
  return preset === "mixed" ? ["tease", "flash", "sex"] : [preset];
}

export function load(storage) {
  try {
    return sanitizeRecord(JSON.parse(storage.getItem(STORE_KEY) || "null"));
  } catch {
    return emptyRecord();
  }
}

export function save(storage, record) {
  try {
    storage.setItem(STORE_KEY, JSON.stringify(sanitizeRecord(record)));
  } catch {
    // 無痕模式、擋 site data 之類的。存不了就算了，不該讓遊戲掛掉。
  }
}
```

- [ ] **Step 4: 跑測試，確認它過**

```bash
node scripts/test_quiz.mjs
```

Expected: 全部 `ok`，exit 0。

- [ ] **Step 5: Commit**

```bash
git add game/store.js scripts/test_quiz.mjs
git commit -m "Keep the best score and streak in the browser."
```

---

### Task 4: 生圖佇列

背景永遠預先生好下一題。只管網路，不懂遊戲規則。

**Files:**
- Create: `game/queue.js`
- Modify: `scripts/test_quiz.mjs`（往後面加）

**Interfaces:**
- Consumes: 無（`makeRound` 跟 `generateImpl` 都從外面注入，所以測得動）
- Produces:
  - `GEN_WIDTH: 1024`、`GEN_HEIGHT: 1024`、`MAX_ATTEMPTS: 20`
  - `sseEvents(res) → AsyncGenerator<{event: string, data: object}>`
  - `generate(positive, {onEvent, signal, fetchImpl}) → Promise<{ok, image, seed, positive, width, height, ckpt}>`
  - `createQueue({makeRound, onEvent, generateImpl}) → {prime(), take()}`
    - `makeRound: () => round | null`，`round` 至少要有 `draw.positive`
    - `take() → Promise<round & {image, seed}>`，回傳前就會開始預抽下一題

`/api/gen` 的 SSE 事件（來自 `server.py` 的 `gen_events`）：
`queued {seed,width,height}`、`preview {image: dataURI}`、`progress {value,max}`、`done {ok,image,seed,ckpt,width,height,positive}`、`error {error}`。

- [ ] **Step 1: 寫會失敗的測試**

`scripts/test_quiz.mjs` 頂端加一行 import：

```js
import { createQueue, generate, sseEvents } from "../game/queue.js";
```

把下面這段加在 `if (failed) {` 之前：

```js
{
  function sseRes(frames, status = 200) {
    const body = new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        const all = frames
          .map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`)
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
      ["progress", { value: 3, max: 20 }],
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
        ["progress", { value: 1, max: 20 }],
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
```

- [ ] **Step 2: 跑測試，確認它失敗**

```bash
node scripts/test_quiz.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` — 找不到 `game/queue.js`。

- [ ] **Step 3: 寫 `game/queue.js`**

```js
/** 生圖佇列：背景永遠預先生好下一題。只管網路，不懂遊戲規則。 */

export const GEN_WIDTH = 1024;
export const GEN_HEIGHT = 1024;
export const MAX_ATTEMPTS = 20;

export async function* sseEvents(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let at;
    while ((at = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, at);
      buf = buf.slice(at + 2);
      let event = "message";
      const data = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trim());
      }
      if (data.length) yield { event, data: JSON.parse(data.join("\n")) };
    }
  }
}

export async function generate(positive, opts = {}) {
  const { onEvent, signal, fetchImpl = fetch } = opts;
  const res = await fetchImpl("/api/gen", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ positive, width: GEN_WIDTH, height: GEN_HEIGHT }),
    signal,
  });
  if (!res.ok) throw new Error("gen HTTP " + res.status);
  for await (const { event, data } of sseEvents(res)) {
    if (onEvent) onEvent(event, data);
    if (event === "error") throw new Error(data.error || "gen failed");
    if (event === "done") return data;
  }
  throw new Error("gen stream ended without a result");
}

export function createQueue(opts) {
  const { makeRound, onEvent, generateImpl = generate } = opts;
  let pending = null;

  async function build() {
    let lastErr = null;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const round = makeRound();
      if (!round) continue; // 組不出題，重抽。沒花到 GPU。
      try {
        const job = await generateImpl(round.draw.positive, { onEvent });
        return { ...round, image: job.image, seed: job.seed };
      } catch (err) {
        lastErr = err; // 生圖失敗不是玩家的錯，換一題再來
      }
    }
    throw lastErr || new Error(`queue: 連續 ${MAX_ATTEMPTS} 次都沒生出題目`);
  }

  function fill() {
    if (!pending) pending = build();
    return pending;
  }

  return {
    prime() {
      fill();
    },
    async take() {
      const ready = fill();
      pending = null;
      try {
        return await ready;
      } finally {
        fill(); // 拿走一題就立刻補下一題，這就是「預抽 1」
      }
    },
  };
}
```

- [ ] **Step 4: 跑測試，確認它過**

```bash
node scripts/test_quiz.mjs
```

Expected: 全部 `ok`，exit 0。

- [ ] **Step 5: Commit**

```bash
git add game/queue.js scripts/test_quiz.mjs
git commit -m "Keep one generated round waiting in the background."
```

---

### Task 5: 畫面

三個畫面（開場、遊玩、結束）的骨架跟樣式，加上啟動用的 `.bat`。這一關結束時，`game/` 已經能在瀏覽器打得開，只是還不會動。

**Files:**
- Create: `game/index.html`
- Create: `game/game.css`
- Create: `start-game.bat`

**Interfaces:**
- Consumes: `web/tokens.css`（由 server 的 SHARED fallback 供應）
- Produces: `main.js` 會抓的這些 id — `#gate`、`#heat`、`#start`、`#gate-note`、`#best`、`#best-streak`、`#play`、`#shot`、`#progress`、`#lives`、`#score`、`#streak`、`#choices`、`#skip`、`#over`、`#final-score`、`#final-streak`、`#answers`、`#positive`、`#copy`、`#again`

- [ ] **Step 1: 寫 `game/index.html`**

```html
<!DOCTYPE html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#2a1814" />
    <title>猜字棚 · 看圖猜 tag</title>
    <link rel="icon" href="logo.svg" type="image/svg+xml" />
    <link rel="preload" href="lexicon.json" as="fetch" crossorigin />
    <link rel="modulepreload" href="engine.js" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=IBM+Plex+Mono:wght@400&family=IBM+Plex+Sans:wght@400;500&display=swap"
      media="print"
      onload="this.media='all'"
    />
    <link rel="stylesheet" href="tokens.css" />
    <link rel="stylesheet" href="game.css" />
  </head>
  <body>
    <main class="stage">
      <section id="gate" class="card">
        <h1 class="title">猜字棚</h1>
        <p class="lede">抽一組 tag 生圖，蔽掉三個。從十二個候選裡挖出來。答錯扣一條命。</p>
        <fieldset class="heats">
          <legend>尺度</legend>
          <div id="heat" class="heat-row"></div>
        </fieldset>
        <button id="start" class="btn btn-go" type="button">開始</button>
        <p id="gate-note" class="note"></p>
        <p class="records">最高分 <b id="best">0</b> · 最長連勝 <b id="best-streak">0</b></p>
      </section>

      <section id="play" class="card" hidden>
        <div class="shot-wrap">
          <img id="shot" class="shot" alt="這一題的圖" />
          <div id="progress" class="progress"></div>
        </div>
        <div class="hud">
          <span id="lives" class="lives"></span>
          <span class="stat">分數 <b id="score">0</b></span>
          <span class="stat">連勝 <b id="streak">0</b></span>
          <button id="skip" class="btn btn-quiet" type="button">跳過這題</button>
        </div>
        <div id="choices" class="choices"></div>
      </section>

      <section id="over" class="card" hidden>
        <h2 class="title">結束</h2>
        <p class="records">分數 <b id="final-score">0</b> · 最長連勝 <b id="final-streak">0</b></p>
        <div id="answers" class="answers"></div>
        <pre id="positive" class="positive"></pre>
        <div class="row">
          <button id="copy" class="btn btn-quiet" type="button">複製 POS</button>
          <button id="again" class="btn btn-go" type="button">再來</button>
        </div>
      </section>
    </main>
    <script type="module" src="main.js"></script>
  </body>
</html>
```

`tokens.css`、`logo.svg`、`lexicon.json`、`engine.js` 在 `game/` 裡都不存在——它們由 `server.py` 的 SHARED fallback 從 `web/` 供應。**這是刻意的，不要去補檔案。**

- [ ] **Step 2: 寫 `game/game.css`**

```css
/* 沿用 web/tokens.css 的暗色印刷風。這裡只放遊戲特有的東西。 */

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--color-paper);
  color: var(--color-ink);
  font-family: var(--font-body);
  font-size: var(--text-base);
  line-height: 1.5;
}

.stage {
  max-width: 880px;
  margin: 0 auto;
  padding: var(--space-5) var(--space-4) var(--space-7);
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.title {
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: 800;
  margin: 0;
  letter-spacing: -0.02em;
}

.lede,
.note,
.records {
  margin: 0;
  color: var(--color-muted);
  font-size: var(--text-sm);
}

.note:empty {
  display: none;
}

.records b {
  color: var(--color-accent-2);
  font-family: var(--font-outlier);
}

.heats {
  border: var(--rule) solid var(--color-rule);
  border-radius: var(--radius);
  padding: var(--space-3);
  margin: 0;
}

.heats legend {
  color: var(--color-neutral);
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0 var(--space-2);
}

.heat-row,
.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.btn {
  font: inherit;
  color: var(--color-ink);
  background: var(--color-chip);
  border: var(--rule) solid var(--color-rule);
  border-radius: var(--radius);
  padding: var(--space-2) var(--space-4);
  min-height: 44px;
  cursor: pointer;
  transition: background var(--dur-micro) var(--ease-out),
    border-color var(--dur-micro) var(--ease-out);
}

.btn:hover {
  background: var(--color-paper-3);
}

.btn:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.btn[aria-pressed="true"] {
  border-color: var(--color-accent);
  color: var(--color-accent-2);
}

.btn-go {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: var(--color-paper);
  font-weight: 500;
  align-self: flex-start;
}

.btn-go:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn-quiet {
  background: transparent;
  color: var(--color-muted);
}

.shot-wrap {
  position: relative;
  aspect-ratio: 1 / 1;
  max-height: 62vh;
  background: var(--color-paper-2);
  border: var(--rule) solid var(--color-rule);
  border-radius: var(--radius);
  overflow: hidden;
  display: grid;
  place-items: center;
}

.shot {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.shot:not([src]) {
  visibility: hidden;
}

.progress {
  position: absolute;
  inset: auto 0 0 0;
  padding: var(--space-2) var(--space-3);
  background: color-mix(in oklch, var(--color-paper) 78%, transparent);
  color: var(--color-muted);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  text-align: center;
}

.progress:empty {
  display: none;
}

.hud {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.hud .btn-quiet {
  margin-left: auto;
}

.stat {
  color: var(--color-neutral);
  font-size: var(--text-sm);
}

.stat b {
  color: var(--color-ink);
  font-family: var(--font-outlier);
}

.lives {
  font-family: var(--font-outlier);
  color: var(--color-accent);
  letter-spacing: 0.2em;
}

.choices {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--space-2);
}

.choice[data-state="hit"] {
  border-color: var(--color-ok);
  color: var(--color-ok);
}

.choice[data-state="miss"] {
  border-color: var(--color-danger);
  color: var(--color-danger);
  text-decoration: line-through;
}

.choice[disabled] {
  cursor: default;
  opacity: 0.75;
}

.answers {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.answer {
  display: flex;
  gap: var(--space-3);
  align-items: baseline;
  border-bottom: var(--rule) solid var(--color-rule);
  padding-bottom: var(--space-2);
}

.answer .zh {
  color: var(--color-ink);
}

.answer .en {
  color: var(--color-neutral);
  font-family: var(--font-outlier);
  font-size: var(--text-sm);
}

.answer .sec {
  margin-left: auto;
  color: var(--color-neutral);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.positive {
  margin: 0;
  padding: var(--space-3);
  background: var(--color-paper-2);
  border: var(--rule) solid var(--color-rule);
  border-radius: var(--radius);
  color: var(--color-muted);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 30vh;
  overflow-y: auto;
}

@media (prefers-reduced-motion: reduce) {
  .btn {
    transition: none;
  }
}
```

- [ ] **Step 3: 寫 `start-game.bat`**

照 `start-darkroom.bat` 抄，只換 `WEB_DIR`、`PORT` 跟印出來的名字：

```bat
@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "WEB_DIR=game"
set "PORT=8791"
set "HOST=0.0.0.0"
set "PYTHONUTF8=1"
set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY where python >nul 2>&1 && set "PY=python"
if not defined PY (
  echo Python 3 not found.
  echo Install Python and tick "Add python.exe to PATH".
  pause
  exit /b 1
)
echo pai-zi-xia  guess
echo local     http://127.0.0.1:%PORT%/
set "TSIP="
if exist "%ProgramFiles%\Tailscale\tailscale.exe" for /f %%I in ('"%ProgramFiles%\Tailscale\tailscale.exe" ip -4 2^>nul') do set "TSIP=%%I"
if defined TSIP echo Tailscale http://%TSIP%:%PORT%/
echo bind      0.0.0.0:%PORT%/
start "" "http://127.0.0.1:%PORT%/"
%PY% server.py
if errorlevel 1 pause
```

- [ ] **Step 4: 開起來看骨架**

```bash
WEB_DIR=game PORT=8791 python server.py
```

在瀏覽器打開 <http://127.0.0.1:8791/>。

Expected: 看到「猜字棚」標題、尺度欄位（還是空的，Task 6 才填）、開始按鈕，背景是暗色印刷風。開發者工具的 Network 裡，`tokens.css` 是 **200 不是 404**——這就證明 SHARED fallback 有生效。Console 會有一個 `main.js` 404，正常，下一關才寫。

- [ ] **Step 5: Commit**

```bash
git add game/index.html game/game.css start-game.bat
git commit -m "Lay out the three screens and add a launcher."
```

---

### Task 6: 接起來

狀態機：開場選尺度 → 佇列生圖 → 答題翻牌 → 三條命歸零 → 結束畫面。

**Files:**
- Create: `game/main.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1–4 的 `quiz.js` / `store.js` / `queue.js`、Task 5 的那些 DOM id，以及 `engine.js` 的 `defaultSettings`、`drawOne`、`indexLexicon`、`labelOf`、`mulberry32`、`randomSeed`
- Produces: 會動的遊戲

- [ ] **Step 1: 寫 `game/main.js`**

```js
/** 狀態機與畫面。規則在 quiz.js，網路在 queue.js，這裡只把它們接起來。 */
import {
  defaultSettings,
  drawOne,
  indexLexicon,
  labelOf,
  mulberry32,
  randomSeed,
} from "./engine.js";
import { banlistFrom, makeQuestion } from "./quiz.js";
import { createQueue } from "./queue.js";
import { HEAT_PRESETS, heatsFor, load, recordRun, save } from "./store.js";

const LIVES = 3;
const HEAT_LABELS = { mixed: "混合", tease: "撩", flash: "露", sex: "性" };

const el = (id) => document.getElementById(id);
const screens = { gate: el("gate"), play: el("play"), over: el("over") };

function show(name) {
  for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
}

let lex = null;
let data = null;
let banlist = null;
let record = load(window.localStorage);
let queue = null;
let run = null;

function makeRound() {
  const settings = defaultSettings(data);
  settings.girl = true;
  settings.boy = false;
  settings.heats = heatsFor(record.heatPreset);
  const seed = randomSeed();
  const draw = drawOne(lex, settings, new Set(), new Set(), mulberry32(seed), seed);
  const question = makeQuestion(lex, draw, mulberry32(seed), banlist);
  return question ? { draw, question } : null;
}

function onGenEvent(event, payload) {
  if (!run || !run.waiting) return;
  if (event === "queued") el("progress").textContent = "排隊中…";
  if (event === "progress") el("progress").textContent = `生圖中 ${payload.value}/${payload.max}`;
  if (event === "preview") el("shot").src = payload.image;
}

function renderHud() {
  el("lives").textContent = "●".repeat(run.lives) + "○".repeat(LIVES - run.lives);
  el("score").textContent = String(run.score);
  el("streak").textContent = String(run.streak);
}

function renderChoices() {
  const box = el("choices");
  box.replaceChildren();
  for (const choice of run.round.question.choices) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn choice";
    btn.textContent = labelOf(lex, choice.tag);
    btn.title = choice.tag;
    btn.addEventListener("click", () => pick(btn, choice));
    box.append(btn);
  }
}

function pick(btn, choice) {
  if (btn.disabled || run.waiting) return;
  btn.disabled = true;
  if (choice.correct) {
    btn.dataset.state = "hit";
    run.found += 1;
    run.score += 1;
    renderHud();
    if (run.found === run.round.question.answers.length) {
      if (run.clean) run.streak += 1;
      renderHud();
      nextRound();
    }
    return;
  }
  btn.dataset.state = "miss";
  run.lives -= 1;
  run.clean = false;
  run.streak = 0;
  renderHud();
  if (run.lives <= 0) finish();
}

async function nextRound() {
  run.waiting = true;
  el("choices").replaceChildren();
  el("shot").removeAttribute("src");
  el("progress").textContent = "準備下一題…";
  let round = null;
  try {
    round = await queue.take();
  } catch (err) {
    el("progress").textContent = "生不出圖：" + err.message;
    return;
  }
  run.round = round;
  run.waiting = false;
  run.found = 0;
  run.clean = true;
  el("shot").src = round.image;
  el("progress").textContent = "";
  renderHud();
  renderChoices();
}

function finish() {
  const question = run.round && run.round.question;
  el("final-score").textContent = String(run.score);
  el("final-streak").textContent = String(run.streak);
  const box = el("answers");
  box.replaceChildren();
  for (const answer of (question && question.answers) || []) {
    const row = document.createElement("div");
    row.className = "answer";
    const zh = document.createElement("span");
    zh.className = "zh";
    zh.textContent = labelOf(lex, answer.tag);
    const en = document.createElement("span");
    en.className = "en";
    en.textContent = answer.tag;
    const sec = document.createElement("span");
    sec.className = "sec";
    sec.textContent = answer.section;
    row.append(zh, en, sec);
    box.append(row);
  }
  el("positive").textContent = (run.round && run.round.draw.positive) || "";
  record = recordRun(record, { score: run.score, streak: run.streak });
  save(window.localStorage, record);
  renderRecords();
  show("over");
}

function renderRecords() {
  el("best").textContent = String(record.best);
  el("best-streak").textContent = String(record.bestStreak);
}

function renderHeats() {
  const row = el("heat");
  row.replaceChildren();
  for (const preset of HEAT_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.textContent = HEAT_LABELS[preset];
    btn.setAttribute("aria-pressed", String(preset === record.heatPreset));
    btn.addEventListener("click", () => {
      record = { ...record, heatPreset: preset };
      save(window.localStorage, record);
      renderHeats();
    });
    row.append(btn);
  }
}

async function start() {
  run = { lives: LIVES, score: 0, streak: 0, found: 0, clean: true, round: null, waiting: true };
  // 佇列只建一次。上一局結束時背景已經生好一題了，「再來」直接接手，不浪費那張圖。
  if (!queue) queue = createQueue({ makeRound, onEvent: onGenEvent });
  show("play");
  renderHud();
  await nextRound();
}

function skip() {
  if (!run || run.waiting) return;
  run.streak = 0;
  renderHud();
  nextRound();
}

async function boot() {
  el("start").disabled = true;
  el("gate-note").textContent = "載入詞庫…";
  data = await fetch("lexicon.json").then((r) => r.json());
  lex = indexLexicon(data);
  banlist = banlistFrom(await fetch("unguessable.json").then((r) => r.json()), lex);
  renderHeats();
  renderRecords();

  const ping = await fetch("/api/ping")
    .then((r) => r.json())
    .catch(() => ({ ok: false }));
  if (!ping.ok) {
    el("gate-note").textContent = "ComfyUI 連不上。先把它開起來再重整。";
    return;
  }
  el("gate-note").textContent = "";
  el("start").disabled = false;
}

el("start").addEventListener("click", start);
el("again").addEventListener("click", start);
el("skip").addEventListener("click", skip);
el("copy").addEventListener("click", () => {
  navigator.clipboard.writeText(el("positive").textContent || "");
});
show("gate");
boot();
```

- [ ] **Step 2: 開起來真的玩一局**

```bash
WEB_DIR=game PORT=8791 python server.py
```

先確認 ComfyUI 在 <http://127.0.0.1:8188> 跑著，然後開 <http://127.0.0.1:8791/>。照順序確認：

1. 尺度那排有四顆按鈕，`混合` 是按下狀態
2. 按「開始」→ 進遊玩畫面，下方出現「生圖中 n/25」（`server.py` 的 `STEPS = 25`），圖出來前會先看到模糊的預覽
3. 圖出來後，下面排出十二個中文候選
4. 滑鼠停在候選上，tooltip 是英文 tag
5. 點對的變綠、點錯的變紅加刪除線，生命從 `●●●` 掉成 `●●○`
6. 三個全中 → 自動換下一題，而且**幾乎不用等**（上一題答題時就生好了）
7. 扣到第三條命 → 結束畫面，攤開三個正解的中英對照跟整串 POS
8. 「複製 POS」按了之後貼得出來
9. 按「再來」→ 立刻就有圖（上一局結束時背景生好的那張），不用重等
10. 重整頁面，最高分跟最長連勝還在

- [ ] **Step 3: 把遊戲加進 README 的版面表**

在 `README.md` 那張「雙擊這個 / 畫面 / 網址」的表格裡，`start_lora_manager.bat` 那列之前插入：

```markdown
| `start-game.bat` | 猜字棚：看圖猜 tag 的遊戲 | http://127.0.0.1:8791 |
```

- [ ] **Step 4: 跑整套測試，確認沒弄壞既有的東西**

```bash
cmd //c test.bat
```

Expected: engine、quiz、server 三段都過，最後印 `all ok`。

- [ ] **Step 5: Commit**

```bash
git add game/main.js README.md
git commit -m "Wire the screens to the queue and the question builder."
```

---

## 完工檢查

- [ ] `cmd //c test.bat` 全過
- [ ] 三條命打完一局，結束畫面的正解跟圖對得上
- [ ] 連續答對三題，第二、三題沒有明顯等待
- [ ] 把 ComfyUI 關掉重整，開場顯示「ComfyUI 連不上」而不是白畫面
- [ ] `git status` 乾淨，`game/` 裡沒有 `engine.js`、`tokens.css`、`lexicon.json` 的複本
- [ ] 原本四個版面（`start.bat` 等）都還能開
