// Exercise the real fuse retrial functions and engine with a deterministic event loop.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { indexLexicon, sanitizeSettings } from '../web/engine.js';
import { drawWithSeed, withEffectiveHeats } from '../web/draw-with-seed.js';
import { HARD_BANNED, isCard } from '../web/card-art.js';

const source = readFileSync(new URL('../web6/fuse.js', import.meta.url), 'utf8');
const retrialSource = source.slice(source.indexOf('function retrial('), source.indexOf('function missReason('));
const data = JSON.parse(readFileSync(new URL('../web/lexicon.json', import.meta.url), 'utf8'));
const lex = indexLexicon(data);
const lib = { byTag: new Map(data.tags.filter(isCard).map(t => [t.tag, t])) };
const copy = value => JSON.parse(JSON.stringify(value));

function fixture(picked = 0, { worker = null } = {}) {
  let next = 0;
  let task = 0;
  const timers = new Map();
  const frames = new Map();
  const draws = [];
  const paints = [];
  const document = { hidden: false, flight: null, querySelector() { return this.flight; } };
  const context = vm.createContext({
    lex, lib, HARD_BANNED, document,
    // 偏好角色（fav-chars.js）、實際尺度（draw-with-seed.js）：retrial 抽之前套上；這裡沒有偏好角色。
    withFavChars: s => s, withEffectiveHeats,
    LETTERS: ['A', 'B', 'C', 'D'],
    SECTION_ORDER: ['subject', 'feature', 'clothing', 'pose', 'env', 'style', 'quality'],
    settings: sanitizeSettings({ rating: 'general' }, data),
    bed: { pins: ['kimono', 'library'], carried: {} },
    bans: new Set(), seeds: [112233, 223344, 334455, 445566], picked, trials: [], caseTab: 'match',
    drawWithSeed(...args) {
      const result = drawWithSeed(...args);
      draws.push({ seed: args[4], task });
      return result;
    },
    requestAnimationFrame(fn) { const id = ++next; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    refreshInk() { paints.push('ink'); },
    renderTrials() { paints.push('trials'); },
    renderCase() { paints.push('case'); },
    // 背景執行緒（draw-pool.js）：worker 給的話剩下的試印丟給它抽；沒給就是開不了 worker，全在這邊抽。
    hasDrawWorker: () => !!worker,
    drawInWorker: req => (worker ? worker(req) : Promise.resolve(null)),
  });
  vm.runInContext(retrialSource + '\nthis.api = { retrial, retrialPicked, finishTrials, settleTrials, get pending() { return trialsPending && [...trialsPending]; }, get known() { return knownTrials(); } };', context);
  const run = fn => { task++; fn(); };
  const frame = () => {
    const callbacks = [...frames.values()]; frames.clear();
    run(() => callbacks.forEach(fn => fn(task * 16)));
  };
  const timer = delay => {
    const entry = [...timers].find(([, t]) => t.delay === delay);
    assert.ok(entry, `Expected a ${delay}ms timer`);
    timers.delete(entry[0]); run(entry[1].fn);
  };
  context.api.retrial();
  draws.length = 0; paints.length = 0;
  return { context, api: context.api, draws, paints, timers, frames, frame, timer, run, document };
}

test('selected trial stays synchronous; each remaining draw gets a separate painted frame/task', () => {
  for (const selected of [0, 2, 3]) {
    const f = fixture(selected);
    const expected = copy(f.context.trials);
    f.api.retrialPicked();
    assert.deepEqual(f.draws.map(d => d.seed), [f.context.seeds[selected]]);
    assert.equal(f.api.known, 1);
    const remaining = f.context.seeds.filter((_, i) => i !== selected);
    remaining.forEach((seed, index) => {
      const before = f.draws.length;
      f.frame();
      assert.equal(f.draws.length, before, 'Frame itself must stay available for motion');
      f.timer(0);
      assert.equal(f.draws.length, before + 1, 'Deferred task may draw only one trial');
      assert.equal(f.draws.at(-1).seed, seed, 'Original trial order is preserved');
      assert.equal(f.api.known, index + 2);
      if (index < 2) assert.deepEqual(f.paints, [], 'Keep existing final ink/trial publication');
    });
    assert.deepEqual(copy(f.context.trials), expected, 'All real engine results/seeds stay identical');
    assert.deepEqual(f.paints, ['ink', 'trials', 'case']);
    assert.equal(f.api.pending, null);
    assert.equal(f.frames.size + f.timers.size, 0);
    assert.equal(new Set(f.draws.map(d => d.task)).size, 4);
  }
});

test('background fallback completes one trial per task without any animation frames', () => {
  const f = fixture();
  f.api.retrialPicked();
  for (let i = 0; i < 3; i++) {
    const before = f.draws.length;
    f.timer(250);
    assert.equal(f.draws.length, before + 1);
  }
  assert.equal(f.api.pending, null);
  assert.deepEqual(f.paints, ['ink', 'trials', 'case']);
  assert.equal(f.frames.size + f.timers.size, 0);
});

test('callbacks from a replaced bed cannot draw or publish the newer round', () => {
  const f = fixture();
  f.api.retrialPicked();
  const oldFrame = [...f.frames.values()][0];
  const oldFallback = [...f.timers.values()][0].fn;
  f.frame();
  const oldAfterPaint = [...f.timers.values()][0].fn;
  f.context.bed = { pins: ['umbrella', 'rain'], carried: {} };
  f.api.retrialPicked();
  const before = f.draws.length;
  for (const callback of [oldFrame, oldFallback, oldAfterPaint]) f.run(callback);
  assert.equal(f.draws.length, before, 'Superseded callbacks must be inert');
  assert.deepEqual(f.paints, []);
  assert.equal(f.frames.size, 1);
  assert.equal(f.timers.size, 1);
  f.api.finishTrials();
  const results = copy(f.context.trials);
  f.api.retrial();
  assert.deepEqual(copy(f.context.trials), results);
});

test('all-trial readers finish synchronously and invalidate queued callbacks', () => {
  for (const complete of ['finishTrials', 'retrial', 'settleTrials']) {
    const f = fixture();
    f.api.retrialPicked();
    f.frame(); f.timer(0);
    const callbacks = [...f.frames.values(), ...[...f.timers.values()].map(t => t.fn)];
    f.api[complete]();
    const before = f.draws.length;
    for (const callback of callbacks) f.run(callback);
    assert.equal(f.draws.length, before);
    assert.equal(f.api.pending, null);
    assert.equal(f.frames.size + f.timers.size, 0);
    if (complete === 'finishTrials') assert.deepEqual(f.paints, ['ink', 'trials', 'case']);
  }
});

test('a fallback that wins the paint race cancels its animation-frame route', () => {
  const f = fixture();
  f.api.retrialPicked();
  const frame = [...f.frames.values()][0];
  f.timer(250);
  const before = f.draws.length;
  f.run(frame);
  assert.equal(f.draws.length, before);
  assert.equal(f.timers.size, 1, 'A delivered old frame may not create a duplicate after-paint task');
  f.api.finishTrials();
});

test('foreground flight keeps deferred draws pending until its marker is removed', () => {
  const f = fixture();
  const expected = copy(f.context.trials);
  f.api.retrialPicked();
  f.document.flight = { getBoundingClientRect() { throw new Error('Waiting must not measure geometry'); } };
  for (let i = 0; i < 6; i++) {
    f.frame(); f.timer(0);
    assert.equal(f.draws.length, 1, 'Only the urgent chosen trial may draw during foreground flight');
  }
  f.timer(250);
  assert.equal(f.draws.length, 1, 'Only the urgent chosen trial may draw during foreground flight');
  assert.equal(f.api.known, 1);
  assert.deepEqual(f.paints, []);
  // Landing and cancellation both remove the existing ghost marker.
  f.document.flight = null;
  for (let i = 0; i < 3; i++) { f.frame(); f.timer(0); }
  assert.deepEqual(copy(f.context.trials), expected);
  assert.deepEqual(f.paints, ['ink', 'trials', 'case']);
});

test('hidden-page fallback finishes even if its flight marker remains until motion resumes', () => {
  const f = fixture();
  f.document.hidden = true;
  f.document.flight = {};
  f.api.retrialPicked();
  for (let i = 0; i < 3; i++) f.timer(250);
  assert.equal(f.draws.length, 4);
  assert.equal(f.api.pending, null);
  assert.equal(f.frames.size + f.timers.size, 0);
});

test('new flights pause a partly drawn round; synchronous readers can still finish during flight', () => {
  const f = fixture();
  f.api.retrialPicked();
  f.frame(); f.timer(0);
  f.document.flight = {};
  f.frame(); f.timer(0);
  assert.equal(f.draws.length, 2);
  f.api.finishTrials();
  assert.equal(f.draws.length, 4);
  assert.equal(f.api.pending, null);
  assert.equal(f.frames.size + f.timers.size, 0);
});

test('replacement while waiting for a flight ignores the older waiting callbacks', () => {
  const f = fixture();
  f.api.retrialPicked();
  f.document.flight = {};
  f.frame(); f.timer(0);
  const oldCallbacks = [...f.frames.values(), ...[...f.timers.values()].map(t => t.fn)];
  f.context.bed = { pins: ['umbrella', 'rain'], carried: {} };
  f.api.retrialPicked();
  const before = f.draws.length;
  f.document.flight = null;
  for (const callback of oldCallbacks) f.run(callback);
  assert.equal(f.draws.length, before);
  for (let i = 0; i < 3; i++) { f.frame(); f.timer(0); }
  const results = copy(f.context.trials);
  f.api.retrial();
  assert.deepEqual(copy(f.context.trials), results);
});

/** 假的背景執行緒：收到的請求先排著，測試決定什麼時候、回什麼。抽法跟 draw-worker.js 一樣（同一支引擎）。 */
function fakeWorker() {
  const asked = [];
  const worker = req => new Promise(resolve => asked.push({ req, resolve }));
  const answer = (k = 0, override) => {
    const { req, resolve } = asked[k];
    resolve(override !== undefined ? override : req.seeds.map(seed => {
      const d = drawWithSeed(lex, req.settings, new Set(req.pins), new Set(req.banned), seed);
      return { positive: d.positive, era: d.era, heat: d.heat, sections: d.sections, eraClash: d.eraClash || [] };
    }));
  };
  return { worker, asked, answer };
}
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test('with a draw worker the remaining trials go there in one batch and match the main-thread result', async () => {
  for (const selected of [0, 2]) {
    const w = fakeWorker();
    const f = fixture(selected, { worker: w.worker });
    const expected = copy(f.context.trials);
    f.api.retrialPicked();
    assert.deepEqual(f.draws.map(d => d.seed), [f.context.seeds[selected]], 'Only the selected trial is drawn here');
    assert.equal(w.asked.length, 0, 'The worker is asked only after the click frame is out');
    f.frame(); f.timer(0);
    assert.equal(w.asked.length, 1);
    assert.deepEqual(copy(w.asked[0].req.seeds), copy(f.context.seeds.filter((_, i) => i !== selected)));
    assert.equal(f.frames.size + f.timers.size, 0, 'No main-thread draw tasks are queued');
    w.answer();
    await settle();
    assert.equal(f.draws.length, 1, 'Main thread drew nothing else');
    assert.deepEqual(copy(f.context.trials), expected, 'Worker results are the same trials');
    assert.deepEqual(f.paints, ['ink', 'trials', 'case']);
    assert.equal(f.api.pending, null);
  }
});

test('a worker answer for a replaced bed is dropped; a failed worker falls back to drawing here', async () => {
  const w = fakeWorker();
  const f = fixture(0, { worker: w.worker });
  f.api.retrialPicked();
  f.frame(); f.timer(0);
  f.context.bed = { pins: ['umbrella', 'rain'], carried: {} };
  f.api.retrialPicked();
  f.timer(250);
  assert.equal(w.asked.length, 2, 'Background tab still asks via the fallback timer');
  w.answer(0);
  await settle();
  assert.deepEqual(f.paints, [], 'Stale answer must not publish');
  assert.equal(f.api.pending.length, 3);
  w.answer(1, null);
  await settle();
  for (let i = 0; i < 3; i++) { f.frame(); f.timer(0); }
  assert.equal(f.api.pending, null);
  const results = copy(f.context.trials);
  f.api.retrial();
  assert.deepEqual(copy(f.context.trials), results, 'Fallback draws equal a full redraw');
});

test('rules changed by another path while the worker drew: its answer is not used', async () => {
  const w = fakeWorker();
  const f = fixture(1, { worker: w.worker });
  f.api.retrialPicked();
  f.frame(); f.timer(0);
  f.context.bans = new Set(['umbrella']);
  w.answer(0);
  await settle();
  assert.equal(f.api.pending.length, 3, 'Answer drawn with the old bans is ignored');
  for (let i = 0; i < 3; i++) { f.frame(); f.timer(0); }
  assert.equal(f.api.pending, null);
});

if (process.argv.includes('--browser')) {
  test('Chromium at 4x CPU defers remaining draws until the real card flight lands', async () => {
    const { createServer } = await import('node:http');
    const { readFile } = await import('node:fs/promises');
    const { resolve, extname, sep } = await import('node:path');
    const { createRequire } = await import('node:module');
    const { execFileSync } = await import('node:child_process');
    const require = createRequire(import.meta.url);
    let pw;
    for (const module of [process.env.PLAYWRIGHT_MODULE, 'playwright', 'C:/Users/boshe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)) {
      try { pw = require(module); break; } catch {}
    }
    assert.ok(pw, 'Set PLAYWRIGHT_MODULE to an installed Playwright module');
    const root = resolve(import.meta.dirname, '..');
    // The pre-fix commit retained the same synchronous readers and motion parameters.
    const baseline = execFileSync('git', ['show', '61b62b8:web6/fuse.js'], { cwd: root, maxBuffer: 2 ** 22 }).toString();
    const instrument = text => text.replace('seeds = freshSeeds();', 'seeds = [112233, 223344, 334455, 445566];').replace(
      'const d = drawWithSeed(lex, settings, pins, banned, seed);',
      'const started = performance.now(); const flying = !!document.querySelector(\'.flying, .drag-ghost, body > .card[aria-hidden="true"]\'); const d = drawWithSeed(lex, settings, pins, banned, seed); window.__draws.push({ i, seed, start: started, duration: performance.now() - started, flying });'
    );
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(url.pathname === '/api/ping' ? { ok: true } : [])); return;
      }
      const version = url.pathname.startsWith('/baseline/') ? 'baseline' : 'current';
      const name = decodeURIComponent(url.pathname.replace(/^\/(?:baseline|current)\//, ''));
      if (name === 'fuse.js') {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(instrument(version === 'baseline' ? baseline : source)); return;
      }
      let file = resolve(root, 'web6', name);
      if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      let bytes;
      try { bytes = await readFile(file); }
      catch { file = resolve(root, 'web', name); try { bytes = await readFile(file); } catch { res.writeHead(404).end(); return; } }
      res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.css': 'text/css', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png' })[extname(file)] || 'application/octet-stream');
      res.end(bytes);
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    let browser;
    const reports = [];
    try {
      browser = await pw.chromium.launch({ headless: true });
      for (const version of ['baseline', 'current']) {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        await page.addInitScript(() => { window.__draws = []; });
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await page.goto(`http://127.0.0.1:${server.address().port}/${version}/fuse.html?debug`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.fuse?.trials.length === 4);
        await page.evaluate(() => document.fonts.ready);
        const report = await page.evaluate(async () => {
          const source = document.querySelector('#case-grid .card[data-tag]');
          source.scrollIntoView({ block: 'center' });
          await new Promise(requestAnimationFrame);
          await new Promise(r => setTimeout(r, 300));
          window.__draws = [];
          const longTasks = [];
          const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration }))));
          observer.observe({ type: 'longtask' });
          const frames = [];
          let done = false;
          const tick = time => { frames.push({ time, draws: window.__draws.length, flying: !!document.querySelector('.flying') }); if (!done) requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
          const started = performance.now();
          window.fuse.place(source.dataset.tag, source);
          await new Promise(r => setTimeout(r, 1000));
          done = true; observer.disconnect();
          return { tag: source.dataset.tag, started, draws: window.__draws, frames, longTasks, trials: window.fuse.trials, bed: window.fuse.bed };
        });
        reports.push({ version, ...report });
        await page.close();
      }
      const [before, after] = reports;
      assert.deepEqual(after.trials, before.trials, 'Real browser trial results/seeds/positions must remain identical');
      assert.deepEqual(after.bed, before.bed);
      assert.equal(after.draws.length, 4);
      assert.deepEqual(after.draws.map(d => d.i), before.draws.map(d => d.i));
      for (const completed of [1, 2, 3]) assert.ok(after.frames.some(f => f.draws === completed), `A rendering opportunity must exist after draw ${completed}`);
      assert.ok(after.frames.some(f => f.draws === 1 && f.flying), 'Original card flight must still run');
      assert.ok(after.draws.slice(1).every(d => !d.flying), 'Remaining draws must begin only after existing flight ghosts are removed');
      assert.ok(before.draws.slice(1).some(d => d.flying), 'Baseline must reproduce deferred engine work during flight');
      assert.ok(!before.frames.some(f => f.draws === 2 || f.draws === 3), 'Baseline must reproduce the three-draw task');
      const drawTasks = r => r.longTasks.map(t => ({ start: +(t.start - r.started).toFixed(1), duration: +t.duration.toFixed(1), trials: r.draws.filter(d => d.start >= t.start && d.start < t.start + t.duration).map(d => d.i) }));
      assert.ok(drawTasks(before).some(t => t.trials.length === 3), 'Baseline long task must contain three remaining draws');
      assert.ok(drawTasks(after).every(t => t.trials.length <= 1), 'Each updated long task may contain at most one draw');
      const frameGroups = r => [1, 2, 3].map(draws => ({ draws, frames: r.frames.filter(f => f.draws === draws).length, flyingFrames: r.frames.filter(f => f.draws === draws && f.flying).length }));
      console.log(JSON.stringify(reports.map(r => ({ version: r.version, tag: r.tag, drawDurations: r.draws.map(d => +d.duration.toFixed(1)), drawingDuringFlight: r.draws.map(d => d.flying), frameGroups: frameGroups(r), longTasks: drawTasks(r) })), null, 2));
    } finally {
      await browser?.close();
      await new Promise(r => server.close(r));
    }
  });
}
