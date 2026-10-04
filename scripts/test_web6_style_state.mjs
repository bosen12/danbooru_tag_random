// The invalidation contract: state is written at its owner, never rediscovered by :has(body).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
const read = name => readFileSync(new URL('../web6/' + name, import.meta.url), 'utf8');
const app = read('app.js');
const fn = name => {
  const start = app.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' exists');
  return app.slice(start, app.indexOf('\n}', start) + 2);
};
test('wall empty lifecycle updates its own heading state', () => {
  const nodes = { 'wall-empty': {hidden: false}, 'wall-head': {dataset: {}} };
  const ctx = { $: id => nodes[id] };
  vm.createContext(ctx);
  const sync = vm.runInContext(fn('syncWallEmpty') + '\nsyncWallEmpty', ctx);
  for (const hasShots of [false, true, false, true]) {
    sync(hasShots);
    assert.equal(nodes['wall-empty'].hidden, hasShots);
    assert.equal(nodes['wall-head'].dataset.hasShots, String(hasShots));
  }
  assert.equal((app.match(/syncWallEmpty\(/g) || []).length, 5, 'draw/render/remove/restore all synchronize wall state');
});
test('float lifecycle keeps its existing show and inert states on cached button renders', () => {
  const float = { dataset: {key: 'false|0|1|1'}, childElementCount: 1, inert: true, hidden: false };
  const ctx = { $: () => float, document: { body: {dataset: {}} }, settings: {n: 1}, generator: {busy: false, pending: 0}, looping: false, drawingRounds: 0, goBarVisible: false, shots: [], pool: new Set(['x']) };
  vm.createContext(ctx);
  const render = vm.runInContext(fn('renderGoFloat') + '\nrenderGoFloat', ctx);
  render();
  assert.equal(float.dataset.show, 'true');
  assert.equal(float.inert, false);
  assert.deepEqual(Object.keys(ctx.document.body.dataset), [], 'float CSS consumes its existing sibling state; overlays own inert changes');
  ctx.goBarVisible = true;
  render();
  assert.equal(float.dataset.show, 'false');
  assert.equal(float.inert, true);
});
test('broad body/html/section relational selectors are absent; local relations remain', () => {
  for (const file of ['styles.css', 'card.css', 'fuse.css']) assert.doesNotMatch(read(file), /\b(?:body|html|section):has\(/, file);
  assert.match(read('styles.css'), /\.switch:has\(input:checked\)/);
  assert.match(read('fuse.css'), /\.trial-face:has\(img\)/);
});
