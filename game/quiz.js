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
