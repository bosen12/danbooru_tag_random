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
  const bar = { dataset: {}, children: [], querySelector() { return null; }, querySelectorAll() { return []; }, get childElementCount() { return this.children.length; }, replaceChildren(...children) { this.children = children; } };
  const wallHead = { dataset: {} }, wallEmpty = { hidden: false };
  // 「成品」那列右邊的「印製中…／停」（app.js renderWallBusy）。
  const wallBusy = { dataset: {}, isConnected: true, children: [], querySelector(sel) { return sel === ".go-stop" ? this.children.find((c) => c.attrs?.class?.includes("go-stop")) || null : null; }, replaceChildren(...children) { this.children = children; } };
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
    makeShot(drawn, seed, pins, snapshot) { return { id: "s" + seed, positive: drawn.positive, seed, width: snapshot?.width ?? ctx.settings.width, pins: [...pins], mine: [...pins], drawn: [] }; },
    currentTriggerText: () => "trigger", currentLorasPayload: () => [], currentCkpt: () => "model", currentWorkflowId: () => "wf", currentSampling: () => ({ steps: 19, cfg: 4 }),
    // 後來加的：姿勢參考、偏好角色、實際尺度、背景執行緒抽牌（這裡回 null，照舊在這邊抽，才數得到每一張）。
    currentPose: () => null, withFavChars: s => s, withEffectiveHeats: s => s, drawInWorker: async () => null, hasDrawWorker: () => false, renderOverreach() {}, syncHandBtn() {}, afterPaint: fn => fn(), matchMedia: () => ({ matches: false }), innerHeight: 800, flip: (n, f) => f(),
    $: id => id === "wall" ? wall : id === "go-bar" ? bar : id === "wall-head" ? wallHead : id === "wall-empty" ? wallEmpty : {},
    refuse() {}, toast() {}, sfx: { deal() {}, roll() {} }, recordUses() {}, tagsOfPositive: () => [],
    shotNode: shot => ({ id: shot.id, querySelector: () => null }), enter() {}, trimWall() {},
    S: { saveShots() {} }, generator: { busy: false, pending: 0, enqueue: shot => sent.push(shot.id), stop() {} }, renderGoBar() {}, reducedMotion: () => false, DUR: { micro: 120, short: 220 }, CURVE: {}, css: () => "ease",
    looping: false, infinite: false, hand: null, seedNode: null, discord: null, weights: new Map(), wallBusy,
    // 無限抽「印幾張停」（ui.loopMax，0＝不限）：這裡不限。
    ui: { loopMax: 0 }, loopSent: 0, loopMaxPicker: () => ({}),
    stepper: () => ({}), switchBox: () => ({}), mountSeedControl: () => ({}), renderGoFloat() {},
    el: (tag, attrs, ...children) => ({ tag, attrs, children: children.flat().filter(x => x && typeof x === "object"), text: children.filter(x => typeof x === "string").join(""), animate() {} }),
    handleLoraKeys: () => false, wfHandleKeys: () => false, anyOverlay: () => false, trashPanel: null,
    // 自製牌（custom-cards.js）：池子裡沒有自製牌，詞庫外的字是空的；觸發字照 lora.js 的接法。
    isCustomTag: (t) => typeof t === "string" && t.startsWith("custom:"), poolExtras: () => "",
    joinTriggerParts: (parts) => parts.filter(Boolean).join(", "),
  };
  vm.createContext(ctx);
  const syncStart = text.indexOf("function syncWallEmpty(");
  vm.runInContext(text.slice(syncStart, text.indexOf("\n}", syncStart) + 2), ctx);
  vm.runInContext(declarations + text.slice(begin, end) + "\nthis.drawBatch = drawBatch", ctx);
  return {
    ctx, records, frames, timers, sent, nodes, bar, wallBusy,
    wireControls() { for (const name of ["goStatusText", "renderGoStatus", "renderGoBar", "renderWallBusy", "stopAll", "onKey"]) { /* 只抓最外層那一支（詳情視窗裡也有一支同名的 onKey） */ const start = text.indexOf("\nfunction " + name + "(") + 1; const finish = text.indexOf("\n}", start); vm.runInContext(text.slice(start, finish + 2), ctx); } },
    async drain() { for (let i = 0; i < 200; i++) { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(clock); await Promise.resolve(); } },
  };
}

// 抽牌列的按鈕不一定在最外層（「停」放在 go-actions 那一小段裡）：往下層找。
const findText = (nodes, text) => { for (const n of nodes || []) { if (n && n.text === text) return n; const c = n && findText(n.children, text); if (c) return c; } return null; };
// 按下去到真的開始抽之間有幾個非同步的步（排進抽牌佇列、等按下的樣子畫出來 afterPaint）：
// 等到第一張抽出來為止，不寫死只等一拍。
const settle = async (h) => { for (let i = 0; i < 20 && !h.records.length; i++) await Promise.resolve(); };

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

test("continuous generation with a count limit: a manual press starts the count and the last round only draws what is left", async () => {
  const h = harness();
  h.ctx.infinite = true;
  h.ctx.ui.loopMax = 10;
  h.ctx.loopSent = 7; // 上一趟剩下的數字：自己按的那一下從 0 算起
  let pending = h.ctx.drawBatch(true);
  await h.drain(); await pending;
  assert.equal(h.sent.length, 10, "12 per round is capped to the 10 that were set");
  assert.equal(h.ctx.loopSent, 10);
  h.ctx.ui.loopMax = 20;
  h.ctx.loopSent = 16;
  pending = h.ctx.drawBatch(true, { auto: true });
  await h.drain(); await pending;
  assert.equal(h.sent.length, 14, "an automatic round draws only the 4 left");
  assert.equal(h.ctx.loopSent, 20);
  h.ctx.infinite = false;
  pending = h.ctx.drawBatch(true);
  await h.drain(); await pending;
  assert.equal(h.sent.length, 26, "without continuous generation the limit does not apply");
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
  await settle(h);
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
  await settle(h);
  assert(h.records.length > 0 && h.records.length < 12);
  vm.runInContext("drawEpoch++", h.ctx);
  await h.drain(); await Promise.all([a, b]);
  assert.equal(h.sent.length, 0);
  assert(h.records.length < 12);
});

test("the actual idle-page Stop button cancels preparation before generation", async () => {
  const h = harness(); h.wireControls();
  h.ctx.renderGoBar();
  assert(!!!findText(h.wallBusy.children, "停"));
  const pending = h.ctx.drawBatch(true);
  await settle(h);
  // 「停」在「成品」那列（renderWallBusy），不在抽牌那排：那排印的時候一顆都不多，按鈕不會被擠到下一行。
  assert(!!!findText(h.bar.children, "停"), "The draw bar must not grow a Stop button while printing");
  const stop = findText(h.wallBusy.children, "停");
  assert(stop, "Stop must be available while draws are being prepared");
  stop.attrs.onclick();
  await h.drain(); await pending;
  assert.equal(h.sent.length, 0);
  assert(!!!findText(h.wallBusy.children, "停"));
});

test("the actual Escape handler cancels an idle-page draw round", async () => {
  const h = harness(); h.wireControls();
  const pending = h.ctx.drawBatch(true);
  await settle(h);
  h.ctx.onKey({ key: "Escape", target: { tagName: "BUTTON" } });
  await h.drain(); await pending;
  assert.equal(h.sent.length, 0);
  assert(h.records.length < 12);
});
