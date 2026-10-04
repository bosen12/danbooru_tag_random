import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

function harness() {
  const text = readFileSync(new URL("../web6/app.js", import.meta.url), "utf8");
  const begin = text.indexOf("function drawBatch(");
  const end = text.indexOf("\nfunction makeShot(", begin);
  // Keep the batch's private state with its actual function, independently of page boot.
  const declarations = text.slice(text.lastIndexOf("let shotSeq", begin), begin);
  const frames = new Map(), timers = new Map(), records = [], nodes = [], sent = [], wall = { prepend(n) { nodes.unshift(n); } };
  const bar = { dataset: {}, children: [], get childElementCount() { return this.children.length; }, replaceChildren(...children) { this.children = children; } };
  let clock = 0, seed = 0, sequence = 0;
  const ctx = {
    console, Date, Math, Promise, Set, Map, structuredClone,
    performance: { now: () => clock },
    requestAnimationFrame: fn => { const id = ++sequence; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: fn => { const id = ++sequence; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
    document: { hidden: false, activeElement: null, getElementById: () => ({ scrollIntoView() {} }) },
    settings: { n: 12, samePerson: true, width: 832 }, pool: new Set(["pinned"]), bans: new Set(["blocked"]),
    lex: {}, HARD_BANNED: [], stopAsked: false, shots: [],
    haptic() {}, randomSeed: () => ++seed, genSeed: value => value,
    identityPins: () => new Set(["identity"]), identityBans: () => new Set(["other"]),
    drawWithSeed(lex, settings, pins, banned, seed) {
      clock += 5;
      records.push({ settings: structuredClone(settings), pins: [...pins], banned: [...banned], seed });
      return { positive: "draw" + seed };
    },
    makeShot(drawn, seed, pins, snapshot) { return { id: "s" + seed, positive: drawn.positive, seed, width: snapshot?.width ?? ctx.settings.width, pins: [...pins] }; },
    currentTriggerText: () => "trigger", currentLorasPayload: () => [], currentCkpt: () => "model", currentWorkflowId: () => "wf", currentSampling: () => ({ steps: 19, cfg: 4 }),
    $: id => id === "wall" ? wall : id === "go-bar" ? bar : {},
    refuse() {}, toast() {}, sfx: { deal() {}, roll() {} },
    shotNode: shot => ({ id: shot.id }), enter() {}, trimWall() {},
    S: { saveShots() {} }, generator: { busy: false, pending: 0, enqueue: shot => sent.push(shot.id), stop() {} }, renderGoBar() {}, reducedMotion: () => false, DUR: { micro: 120 },
    looping: false, infinite: false, hand: null, seedNode: null,
    stepper: () => ({}), switchBox: () => ({}), mountSeedControl: () => ({}), renderGoFloat() {},
    el: (tag, attrs, ...children) => ({ tag, attrs, text: children.filter(x => typeof x === "string").join("") }),
    handleLoraKeys: () => false, wfHandleKeys: () => false, anyOverlay: () => false, trashPanel: null,
  };
  vm.createContext(ctx);
  vm.runInContext(declarations + text.slice(begin, end) + "\nthis.drawBatch = drawBatch", ctx);
  return {
    ctx, records, frames, timers, sent, nodes, bar,
    wireControls() { for (const name of ["renderGoBar", "stopAll", "onKey"]) { const start = text.indexOf("function " + name + "("); const finish = text.indexOf("\n}", start); vm.runInContext(text.slice(start, finish + 2), ctx); } },
    async drain() { for (let i = 0; i < 200; i++) { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(clock); await Promise.resolve(); } },
  };
}

test("large batches yield to the next painted frame instead of blocking the whole round", async () => {
  const h = harness();
  const pending = h.ctx.drawBatch(false);
  assert(h.records.length < 12, "all draws ran synchronously before returning");
  await h.drain(); await pending;
  assert.equal(h.records.length, 12);
});

test("a yielded batch freezes its intent, model fields and pinned identity", async () => {
  const h = harness();
  const pending = h.ctx.drawBatch(true);
  h.ctx.settings.width = 1216;
  h.ctx.pool.add("late-pin"); h.ctx.bans.add("late-ban");
  await h.drain(); await pending;
  assert(h.records.every(r => r.settings.width === 832));
  assert(h.records.every(r => !r.pins.includes("late-pin") && !r.banned.includes("late-ban")));
  assert(h.ctx.shots.every(s => s.width === 832));
  assert(h.records.slice(1).every(r => r.pins.includes("identity") && r.banned.includes("other")));
  assert.deepEqual(h.sent, Array.from({ length: 12 }, (_, i) => "s" + (i + 1)));
  assert.deepEqual(h.nodes.map(n => n.id), Array.from({ length: 12 }, (_, i) => "s" + (i + 1)));
});

test("rapid round requests run in order without interleaving seeded draws", async () => {
  const h = harness();
  h.ctx.settings.n = 8;
  const first = h.ctx.drawBatch(false);
  h.ctx.pool = new Set(["second-round"]);
  const second = h.ctx.drawBatch(false);
  await h.drain(); await Promise.all([first, second]);
  assert.equal(h.records.length, 16);
  assert(h.records.slice(0, 8).every(r => r.pins.includes("pinned") && !r.pins.includes("second-round")));
  assert(h.records.slice(8).every(r => r.pins.includes("second-round") && !r.pins.includes("pinned")));
});

test("a frame wait has a task fallback if the tab becomes hidden", async () => {
  const h = harness();
  const pending = h.ctx.drawBatch(false);
  await Promise.resolve();
  assert(h.frames.size > 0);
  h.ctx.document.hidden = true;
  assert(h.timers.size > 0, "rAF alone can stall when the tab is hidden during its wait");
  for (let i = 0; i < 100; i++) {
    const timers = [...h.timers.values()]; h.timers.clear();
    for (const fn of timers) fn();
    await Promise.resolve();
  }
  await pending;
  assert.equal(h.records.length, 12);
  assert.equal(h.frames.size, 0);
});

test("stop during an unfinished round does not submit jobs or start queued rounds", async () => {
  const h = harness();
  const a = h.ctx.drawBatch(true), b = h.ctx.drawBatch(true);
  await Promise.resolve();
  assert(h.records.length > 0 && h.records.length < 12);
  vm.runInContext("drawEpoch++", h.ctx);
  await h.drain(); await Promise.all([a, b]);
  assert.equal(h.sent.length, 0);
  assert(h.records.length < 12);
});

test("the actual idle-page Stop button cancels preparation before generation", async () => {
  const h = harness(); h.wireControls();
  h.ctx.renderGoBar();
  assert(!h.bar.children.some(n => n.text === "停"));
  const pending = h.ctx.drawBatch(true);
  await Promise.resolve();
  const stop = h.bar.children.find(n => n.text === "停");
  assert(stop, "Stop must be available while draws are being prepared");
  stop.attrs.onclick();
  await h.drain(); await pending;
  assert.equal(h.sent.length, 0);
  assert(!h.bar.children.some(n => n.text === "停"));
});

test("the actual Escape handler cancels an idle-page draw round", async () => {
  const h = harness(); h.wireControls();
  const pending = h.ctx.drawBatch(true);
  await Promise.resolve();
  h.ctx.onKey({ key: "Escape", target: { tagName: "BUTTON" } });
  await h.drain(); await pending;
  assert.equal(h.sent.length, 0);
  assert(h.records.length < 12);
});
