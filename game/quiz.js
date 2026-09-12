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
