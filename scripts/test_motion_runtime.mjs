#!/usr/bin/env node
/** Behavioral motion tests: exact frames, shared measurement and cleanup. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

function runtime(path = new URL("../web6/motion.js", import.meta.url), beforeSource = null) {
  let now = 0, seq = 0;
  const frames = new Map(), timers = new Map(), events = [];
  function node(rect) {
    const values = {};
    const n = {
      isConnected: true, children: [], dataset: {},
      offsetWidth: rect.width, offsetHeight: rect.height,
      style: new Proxy(values, {
        set(o, k, v) { events.push({ kind: "write", node: n, key: k }); o[k] = v; return true; },
        get(o, k) { return k === "setProperty" ? (name, value) => { o[name] = value; } : o[k]; },
      }),
      getBoundingClientRect() { events.push({ kind: "read", node: n }); return { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }; },
      getAnimations() { return []; },
      animate(keyframes, options) { events.push({ kind: "animate", node: n }); n.animation = { keyframes, options }; return {}; },
      setAttribute() {}, remove() { n.isConnected = false; },
      querySelectorAll() { return n.children; },
      classList: { add() {}, remove() {}, contains() { return false; } },
    };
    return n;
  }
  const context = {
    Map, Set, Math, console,
    matchMedia: () => ({ matches: false }),
    getSfx: () => ({}),
    document: { body: { append(n) { n.isConnected = true; } } },
    performance: { now: () => now },
    requestAnimationFrame(fn) { const id = ++seq; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(fn, delay) { const id = ++seq; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const source = (beforeSource ?? readFileSync(path, "utf8")).replace(/^import .*;\r?$/gm, "").replace(/\bexport /g, "");
  const api = vm.runInNewContext(source + "\n({ flight, flip, flipBy, CURVE, DUR, travelTime, bezier, replayDeal: typeof replayDeal === 'function' ? replayDeal : null })", context);
  return {
    ...api, node, events, timers, frames,
    step(time) { now = time; const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(now); },
  };
}

let failures = 0;
function test(name, fn) {
  try { fn(); console.log("ok  " + name); }
  catch (e) { failures++; console.error("FAIL " + name + ": " + e.message); }
}
const from = { left: 10, top: 20, width: 80, height: 117 };
const dest = { left: 250, top: 100, width: 100, height: 146 };

test("restarting a fan flushes layout once while retaining every card's deal order", () => {
  const r = runtime(), container = r.node(dest);
  const cards = Array.from({ length: 20 }, () => r.node(from));
  container.children = cards;
  let reads = 0;
  for (const n of [container, ...cards]) Object.defineProperty(n, "offsetWidth", { get() { reads++; return 80; } });
  const started = [];
  for (const [i, card] of cards.entries()) {
    card.classList.add = name => { assert.equal(name, "dealt"); started.push(i); };
  }
  assert.equal(typeof r.replayDeal, "function", "fan replay helper not implemented");
  r.replayDeal(container);
  assert.equal(reads, 1, "the fan should not force a separate layout for each card");
  assert.deepEqual(started, Array.from({ length: 20 }, (_, i) => i));
  for (const [i, card] of cards.entries()) assert.equal(card.style["--i"], String(i));
});

test("simultaneous flights read all targets before painting any ghost", () => {
  const r = runtime();
  const a = r.node({ ...dest }), b = r.node({ ...dest, left: 400 });
  r.flight(r.node(from), from, () => a, { duration: 320 });
  r.flight(r.node(from), from, () => b, { duration: 320 });
  r.events.length = 0;
  r.step(0);
  const firstWrite = r.events.findIndex(e => e.kind === "write");
  assert(firstWrite >= 0);
  assert(r.events.slice(firstWrite).every(e => e.kind !== "read"), "layout read after ghost write");
});

test("two flights sharing a destination measure that element once per frame", () => {
  const r = runtime(), target = r.node(dest);
  r.flight(r.node(from), from, () => target, { duration: 320 });
  r.flight(r.node(from), from, () => target, { duration: 320 });
  r.events.length = 0;
  r.step(0);
  assert.equal(r.events.filter(e => e.kind === "read" && e.node === target).length, 1);
});

test("finishing and cancelling flights release their fallback timers and frame work", () => {
  const r = runtime(), g = r.node(from);
  let landed = 0;
  const f = r.flight(g, from, dest, { duration: 320, onLand: () => landed++ });
  r.step(0); r.step(320);
  assert.equal(landed, 1);
  f.cancel();
  assert.equal(landed, 1);
  assert.equal(r.timers.size, 0);
  assert.equal(r.frames.size, 0);
  assert.equal(g.isConnected, false);
  const h = r.flight(r.node(from), from, dest);
  h.cancel();
  assert.equal(r.timers.size, 0);
  assert.equal(r.frames.size, 0);
});

for (const method of ["flip", "flipBy"]) test(method + " measures all final rectangles before starting animations", () => {
  const r = runtime(), rects = [{ left: 0, top: 0, width: 80, height: 117 }, { left: 90, top: 0, width: 80, height: 117 }];
  const container = r.node(dest);
  container.children = rects.map((rect, i) => { const n = r.node(rect); n.dataset.tag = String(i); return n; });
  const mutate = () => { rects[0].top += 40; rects[1].top += 40; };
  if (method === "flip") r.flip(container, mutate);
  else r.flipBy(container, ".card", n => n.dataset.tag, mutate);
  const start = r.events.findIndex(e => e.kind === "animate");
  assert(start >= 0);
  assert(r.events.slice(start).every(e => e.kind !== "read"), "layout read after animate");
  for (const n of container.children) {
    assert.equal(n.animation.keyframes[0].transform, "translate(0px, -40px)");
    assert.equal(n.animation.options.duration, r.DUR.medium);
  }
});

test("flight ends precisely at the latest moving/replaced target", () => {
  const r = runtime(), ghost = r.node(from);
  let target = r.node(dest), lands = 0;
  r.flight(ghost, from, () => target, { duration: 320, onLand: () => lands++ });
  r.step(0); r.step(160);
  target.isConnected = false;
  target = r.node({ ...dest, left: 450, top: 160, width: 120 });
  r.step(319);
  assert.equal(lands, 0);
  r.step(320);
  assert.equal(ghost.style.transform, "translate(460.00px, 154.50px) rotate(-0.00deg) scale(1.5000)");
  assert.equal(lands, 1);
});

// Use the immutable Git baseline rather than untracked local audit files.
const baselineSource = execFileSync("git", ["show", "7dda64f32f2ed66c312f019e4926a3d33609a3a5:web6/motion.js"], {
  cwd: new URL("../", import.meta.url), encoding: "utf8",
});
test("original and optimized flight styles remain byte-identical at every sampled frame", () => {
  for (const opts of [{}, { delay: 40, tilt: 8, endRotate: 20, startRotate: -8, startScale: 0.2, scaleLate: 0.7, endOpacity: 0.2 }]) {
    const old = runtime(undefined, baselineSource), next = runtime();
    const a = old.node(from), b = next.node(from);
    old.flight(a, from, dest, { duration: 320, ...opts });
    next.flight(b, from, dest, { duration: 320, ...opts });
    for (const t of [0, 16, 40, 80, 120, 160, 220, 280, 320, 360]) {
      old.step(t); next.step(t);
      for (const key of ["transform", "boxShadow", "opacity"]) assert.equal(b.style[key], a.style[key], key + " at " + t);
      assert.equal(b.isConnected, a.isConnected);
    }
  }
});

if (failures) process.exitCode = 1;
