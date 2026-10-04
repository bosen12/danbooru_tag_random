import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexLexicon, sanitizeSettings, drawOne, mulberry32, actionFitsClothes, applyPin } from '../web/engine.js';

const data = JSON.parse(readFileSync(new URL('../web/lexicon.json', import.meta.url), 'utf8'));
const lex = indexLexicon(data);
const settings = sanitizeSettings({ girl: true, boy: false, heats: ['sex'], eras: ['modern'], counts: { pose: 10 } }, data);
const tags = (out) => new Set(out.positive.split(',').map(t => t.trim()));
const pins = (...items) => items.reduce((p, t) => applyPin(lex, p, new Set(), t).pinned, new Set());
let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
}
check('normal UI seed 148038 nude excludes unpinned hand in panties', () => {
  const out = drawOne(lex, settings, pins('1girl', 'nude'), new Set(), mulberry32(148038), 148038);
  assert(tags(out).has('nude'));
  assert(!tags(out).has('hand in panties'), out.positive);
});
check('panties action requires bottom underwear, not arbitrary clothes', () => {
  for (const clothes of [[], ['nude'], ['no panties'], ['white shirt'], ['bra']]) {
    assert.equal(actionFitsClothes('hand in panties', clothes), 0);
  }
  for (const underwear of ['panties', 'thong', 'pink panties']) {
    assert.equal(actionFitsClothes('hand in panties', [underwear]), 2);
  }
});
check('unpinned hand in panties remains reachable with pinned underwear', () => {
  let found = false;
  for (let seed = 148000; seed < 149000 && !found; seed++) {
    const out = drawOne(lex, settings, pins('1girl', 'panties'), new Set(), mulberry32(seed), seed);
    found = tags(out).has('hand in panties');
  }
  assert(found, '1000 underwear draws never reached hand in panties');
});
check('nude and missing-bottom-underwear draws exclude the panties action', () => {
  for (const outfit of ['nude', 'no panties']) {
    const pinned = pins('1girl', outfit);
    for (let seed = 148000; seed < 148200; seed++) {
      const out = drawOne(lex, settings, pinned, new Set(), mulberry32(seed), seed);
      assert(!tags(out).has('hand in panties'), `${outfit} seed ${seed}: ${out.positive}`);
    }
  }
});
check('explicit conflicting action pin retains current pin priority', () => {
  const out = drawOne(lex, settings, pins('1girl', 'nude', 'hand in panties'), new Set(), mulberry32(148038), 148038);
  assert(tags(out).has('hand in panties'));
  assert(tags(out).has('nude'));
});
process.exitCode = failures ? 1 : 0;
