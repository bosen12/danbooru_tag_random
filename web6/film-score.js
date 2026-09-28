/**
 * 三分鐘版介紹影片（film.js）的配樂：全部用 Web Audio 現場合成，沒有借來的音樂檔。
 *
 * 128 BPM、4/4，一小節 1.875 秒，96 小節＝剛好三分鐘。D 小調，和弦 Dm – B♭ – F – C（add9）。
 * 舊版（intro-audio.js）是 96 BPM：舊的一小節 2.5 秒，快 4/3 倍正好是這裡的一小節 ——
 * film.js 把舊版的場景加速 4/3 倍接進來，原本對在拍子上的東西，在這裡也對在拍子上。
 *
 * 段落（小節）：
 *   0–8    intro   鋪底、心跳一樣的大鼓，濾波慢慢打開，第 7 小節軍鼓滾奏
 *   8–10   title   標題：撞擊、低音下沉，鐘聲彈一次主旋律的開頭
 *   10–25  verse   四拍大鼓、低音八分、撥弦琶音；12 起拍手、16 起十六分 hi-hat
 *   25–46  chorus  和弦一小節換一個；29 起柔和的主旋律
 *   46–51  break   大鼓抽掉、半速拍手，最後兩小節滾奏、上升
 *   51–66  drop    全部樂器、supersaw 主旋律、sidechain 抽吸
 *   66–72  half    半速鼓組（快剪的段落）
 *   72–78  drop2   再回到四拍
 *   78–86  final   最大的一段：主旋律疊八度、鐘聲
 *   86–92  outro   鼓退掉，鐘聲、琶音收尾
 *   92–96  end     最後的和弦，淡出
 *
 * 用法跟 intro-audio.js 一樣：createScore(畫面的音效) → play(秒)／pause()／now()／render()。
 */

export const BPM = 128;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;
export const BARS = 96;
export const LENGTH = BAR * BARS;
export const bar = (n, beat = 0) => n * BAR + beat * BEAT;

const NOTE = { C: -9, "C#": -8, D: -7, Eb: -6, E: -5, F: -4, "F#": -3, G: -2, Ab: -1, A: 0, Bb: 1, B: 2 };
const hz = (name, oct) => 440 * Math.pow(2, (NOTE[name] + (oct - 4) * 12) / 12);
/** "A4"、"Bb3" → 頻率。 */
const hzOf = (s) => hz(s.slice(0, -1), +s.slice(-1));

const CHORDS = [
  { root: "D", notes: [["D", 3], ["F", 3], ["A", 3], ["E", 4]] }, // Dm(add9)
  { root: "Bb", notes: [["Bb", 2], ["D", 3], ["F", 3], ["C", 4]] }, // B♭(add9)
  { root: "F", notes: [["F", 3], ["A", 3], ["C", 4], ["G", 4]] }, // F(add9)
  { root: "C", notes: [["C", 3], ["E", 3], ["G", 3], ["D", 4]] }, // C(add9)
];

export const PLAN = [
  { from: 0, to: 8, kind: "intro" },
  { from: 8, to: 10, kind: "title" },
  { from: 10, to: 25, kind: "verse" },
  { from: 25, to: 46, kind: "chorus" },
  { from: 46, to: 51, kind: "break" },
  { from: 51, to: 66, kind: "drop" },
  { from: 66, to: 72, kind: "half" },
  { from: 72, to: 78, kind: "drop2" },
  { from: 78, to: 86, kind: "final" },
  { from: 86, to: 92, kind: "outro" },
  { from: 92, to: 96, kind: "end" },
];
export const secAt = (b) => PLAN.find((p) => b >= p.from && b < p.to) || PLAN[PLAN.length - 1];
// 和弦一小節換一個的段落（其他兩小節一個）。
const FAST = new Set(["chorus", "drop", "half", "drop2", "final"]);
const DRUMS = new Set(["verse", "chorus", "drop", "half", "drop2", "final"]);
const chordAt = (b) => {
  const s = secAt(b);
  const i = b - s.from;
  return CHORDS[(FAST.has(s.kind) ? i : Math.floor(i / 2)) % 4];
};

/**
 * 主旋律（四小節一句，跟著 Dm – B♭ – F – C）：[拍, 長度（拍）, 音]。
 * 3＋3＋2 的十六分切分，是這首的鉤子。第二句最後一小節換個收尾。
 */
const HOOK = [
  [[0, 0.75, "A4"], [0.75, 0.75, "A4"], [1.5, 0.5, "C5"], [2, 1, "D5"], [3, 0.5, "C5"], [3.5, 0.5, "A4"]],
  [[0, 0.75, "F4"], [0.75, 0.75, "F4"], [1.5, 0.5, "G4"], [2, 1.5, "A4"], [3.5, 0.5, "G4"]],
  [[0, 0.75, "A4"], [0.75, 0.75, "C5"], [1.5, 0.5, "D5"], [2, 1, "E5"], [3, 0.5, "D5"], [3.5, 0.5, "C5"]],
  [[0, 1.5, "E5"], [1.5, 0.5, "D5"], [2, 1, "C5"], [3, 1, "G4"]],
];
const HOOK_END = [[0, 0.75, "E5"], [0.75, 0.75, "F5"], [1.5, 0.5, "E5"], [2, 2, "D5"]];

const up = (s, n) => s.slice(0, -1) + (+s.slice(-1) + n);

/** 整首歌的事件表（{ t, dur, kind, ...參數 }），照時間排好。純資料，跟播放無關。 */
export function buildEvents(extraCues = []) {
  const ev = [];
  const add = (t, dur, kind, o = {}) => ev.push({ t, dur, kind, ...o });

  // ---- 和聲：鋪底、低音、琶音 ----
  for (let b = 0; b < 92; b++) {
    const s = secAt(b);
    const ch = chordAt(b);
    const fast = FAST.has(s.kind);
    const head = fast || (b - s.from) % 2 === 0;
    const bright = { intro: 0.15 + (b / 8) * 0.45, title: 0.7, verse: 0.55, chorus: 0.75, break: 0.4, drop: 0.95, half: 0.8, drop2: 0.95, final: 1, outro: 0.5 }[s.kind] ?? 0.5;
    if (head) {
      const span = fast ? 1 : Math.min(2, s.to - b);
      add(bar(b), BAR * span + 0.3, "pad", { notes: ch.notes, bright, gain: s.kind === "intro" ? 0.07 + b * 0.006 : s.kind === "break" || s.kind === "outro" ? 0.12 : 0.1, duck: DRUMS.has(s.kind) });
    }
    // 低音
    if (s.kind === "verse") {
      add(bar(b), BAR, "sub", { f: hz(ch.root, 1), gain: 0.2 });
      for (let q = 0; q < 8; q++) add(bar(b) + (q * BEAT) / 2, BEAT * 0.4, "bassPluck", { f: hz(ch.root, q % 4 === 3 ? 3 : 2), gain: q % 2 ? 0.09 : 0.12 });
    } else if (s.kind === "chorus" || s.kind === "drop" || s.kind === "drop2" || s.kind === "final" || s.kind === "half") {
      add(bar(b), BAR, "sub", { f: hz(ch.root, 1), gain: 0.24 });
      for (let q = 0; q < 8; q++) {
        const off = q % 2 === 1;
        add(bar(b) + (q * BEAT) / 2, BEAT * 0.45, "bassPluck", { f: hz(ch.root, off ? 3 : 2), gain: off ? 0.14 : 0.07, cut: s.kind === "chorus" ? 0.8 : 1.2 });
      }
    } else if (s.kind === "break" || s.kind === "title" || s.kind === "outro") {
      if (head) add(bar(b), BAR * 2, "sub", { f: hz(ch.root, 1), gain: 0.16 });
    } else if (s.kind === "intro" && b >= 4 && head) {
      add(bar(b), BAR * 2, "sub", { f: hz(ch.root, 1), gain: 0.1 + (b - 4) * 0.02 });
    }
    // 撥弦琶音：十六分，上行再下行。
    if (s.kind !== "title" && !(s.kind === "intro" && b < 2)) {
      const seq = [0, 1, 2, 3, 2, 1, 2, 3];
      const hot = s.kind === "drop" || s.kind === "drop2" || s.kind === "final";
      const step = s.kind === "outro" || s.kind === "break" ? 2 : 1;
      for (let i = 0; i < 16; i += step) {
        const n = ch.notes[seq[i % 8]];
        const oct = n[1] + 1 + (hot && i % 8 >= 4 ? 1 : 0);
        const cut = s.kind === "intro" ? 1.2 + ((b - 2) / 6) * 4 : s.kind === "outro" ? 4 - ((b - 86) / 6) * 2.5 : hot ? 7 : 5;
        add(bar(b) + (i * BEAT) / 4, BEAT * 0.5, "pluck", { f: hz(n[0], oct), gain: (hot ? 0.045 : 0.05) * (i % 4 === 0 ? 1.3 : 1), cut, pan: i % 2 ? 0.35 : -0.35, duck: DRUMS.has(s.kind) });
      }
    }
  }

  // ---- 主旋律 ----
  const phrase = (b0, bars, voice, o = {}) => {
    for (let k = 0; k < bars; k++) {
      const idx = k % 4;
      const second = Math.floor(k / 4) % 2 === 1;
      const line = idx === 3 && second ? HOOK_END : HOOK[idx];
      for (const [beat, len, note] of line) {
        add(bar(b0 + k, beat), len * BEAT, voice, { f: hzOf(note), gain: o.gain ?? 0.1, duck: o.duck });
        if (o.double) add(bar(b0 + k, beat), len * BEAT, voice, { f: hzOf(up(note, 1)), gain: (o.gain ?? 0.1) * 0.45, duck: o.duck });
      }
    }
  };
  // 標題：鐘聲彈一次開頭。
  for (const [beat, len, note] of [...HOOK[0], ...HOOK[1].map(([b, l, n]) => [b + 4, l, n])]) add(bar(8, beat), len * BEAT * 1.6, "bell", { f: hzOf(up(note, 1)), gain: 0.07 });
  phrase(29, 16, "soft", { gain: 0.07, duck: true });
  phrase(51, 15, "lead", { gain: 0.085, duck: true });
  phrase(72, 6, "lead", { gain: 0.085, duck: true });
  phrase(78, 8, "lead", { gain: 0.09, duck: true, double: true });
  for (let k = 0; k < 8; k++) {
    const [beat, , note] = HOOK[k % 4][0];
    add(bar(78 + k, beat), BAR, "bell", { f: hzOf(up(note, 1)), gain: 0.05 });
  }
  // 收尾：鐘聲慢慢彈主旋律的骨架。
  const tail = [["D5", 86], ["A4", 87], ["F5", 88], ["E5", 89], ["C5", 90], ["D5", 91]];
  for (const [n, b] of tail) add(bar(b), BAR * 2, "bell", { f: hzOf(n), gain: 0.08 });
  add(bar(92), BAR * 4, "pad", { notes: [["D", 3], ["A", 3], ["D", 4], ["E", 4], ["F", 4]], bright: 0.8, gain: 0.13 });
  add(bar(92), BAR * 4, "bell", { f: hz("D", 5), gain: 0.14 });
  add(bar(92, 2), BAR * 3.4, "bell", { f: hz("A", 5), gain: 0.08 });
  add(bar(92), BAR * 3, "sub", { f: hz("D", 1), gain: 0.2 });

  // ---- 鼓 ----
  for (let b = 0; b < 92; b++) {
    const s = secAt(b);
    const i = b - s.from;
    if (s.kind === "intro") {
      // 心跳：先一小節一下，再兩下，最後四拍。
      if (b >= 1 && b < 4) add(bar(b), 0.4, "kick", { gain: 0.5 });
      else if (b >= 4 && b < 6) for (const q of [0, 2]) add(bar(b, q), 0.4, "kick", { gain: 0.55 });
      else if (b === 6) for (let q = 0; q < 4; q++) add(bar(b, q), 0.4, "kick", { gain: 0.6, duck: 0.3 });
      continue;
    }
    if (!DRUMS.has(s.kind)) continue;
    const full = s.kind !== "verse";
    for (let q = 0; q < 4; q++) {
      const t = bar(b, q);
      if (s.kind === "half") {
        if (q === 0) add(t, 0.4, "kick", { gain: 0.72, duck: 0.6 });
        if (q === 2) add(t + BEAT / 2, 0.4, "kick", { gain: 0.6, duck: 0.5 });
        if (q === 2) add(t, 0.25, "snare", { gain: 0.2 });
      } else {
        add(t, 0.4, "kick", { gain: full ? 0.74 : 0.66, duck: s.kind === "chorus" ? 0.45 : full ? 0.65 : 0.35 });
        if ((q === 1 || q === 3) && (full || i >= 2)) add(t, 0.2, "clap", { gain: full ? 0.15 : 0.12 });
      }
      // hi-hat：反拍一下；十六分的從 verse 第 6 小節、其他段一開始就有。
      add(t + BEAT / 2, 0.06, full ? "ohat" : "hat", { gain: full ? 0.045 : 0.05, pan: 0.2 });
      if (full || i >= 6) for (const k of [1, 3]) add(t + (k * BEAT) / 4, 0.04, "hat", { gain: 0.022, pan: -0.25 });
    }
  }
  // 軍鼓滾奏（進大段落前一或兩小節）：八分 → 十六分 → 三十二分，越來越大聲。
  const roll = (b0, bars) => {
    const T0 = bar(b0);
    const T1 = bar(b0 + bars);
    let t = T0;
    while (t < T1 - 0.01) {
      const p = (t - T0) / (T1 - T0);
      add(t, 0.15, "snare", { gain: 0.05 + p * 0.16 });
      t += p < 0.5 ? BEAT / 2 : p < 0.8 ? BEAT / 4 : BEAT / 8;
    }
  };
  roll(7, 1);
  roll(24, 1);
  roll(45, 1);
  roll(49, 2);
  roll(77, 1);
  // 半速段的拍手（break）。
  for (let b = 46; b < 49; b++) add(bar(b, 2), 0.2, "clap", { gain: 0.12 });

  // ---- 轉場的聲音 ----
  const riser = (b0, bars, gain = 0.12) => add(bar(b0), BAR * bars, "riser", { gain });
  riser(6, 2, 0.13);
  riser(23, 2, 0.1);
  riser(44, 2, 0.1);
  riser(48, 3, 0.15);
  riser(64, 2, 0.1);
  riser(76, 2, 0.14);
  for (const [b, g] of [[8, 0.55], [10, 0.3], [25, 0.4], [51, 0.55], [66, 0.35], [72, 0.3], [78, 0.55], [86, 0.3]]) add(bar(b), 1.6, "impact", { gain: g });
  for (const b of [8, 51, 78]) {
    add(bar(b), 1.8, "subdrop", { gain: 0.5 });
    add(bar(b) - BEAT * 2, BEAT * 2, "swell", { gain: 0.14 });
  }
  for (const b of [10, 25, 51, 55, 59, 63, 72, 78, 82]) add(bar(b), 2.2, "crash", { gain: b === 51 || b === 78 ? 0.09 : 0.06 });
  for (const b of [46, 86]) add(bar(b), BAR * 2, "down", { gain: 0.1 });

  // 畫面給的音效（打字的喀、牌落地、碰撞…）。
  for (const c of extraCues) add(c.t, c.dur || 0.2, c.kind, c);
  ev.sort((a, b) => a.t - b.t);
  return ev;
}

export function createScore(extraCues = []) {
  const events = buildEvents(extraCues);
  const kicks = events.filter((e) => e.kind === "kick").map((e) => e.t);
  let ctx = null;
  let master = null;
  let bus = null; // 會被大鼓壓的那一條（鋪底、低音、琶音、主旋律）
  let wet = null;
  let echo = null;
  let noise = null;
  let startCtx = 0;
  let startT = 0;
  let playing = false;
  let muted = false;
  let cursor = 0;
  let timer = 0;
  const live = new Set();
  const VOL = 0.85;

  function setup(given = null) {
    if (ctx && !given) return;
    ctx = given || new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    comp.attack.value = 0.008;
    comp.release.value = 0.22;
    // 第二段當限幅器：最響的撞擊不要破。
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -4;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.002;
    lim.release.value = 0.1;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : VOL;
    master.connect(comp).connect(lim).connect(ctx.destination);
    bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(master);
    // 殘響：自己產生一段衰減的噪音當 impulse response。
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.8);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
    }
    conv.buffer = ir;
    wet = ctx.createGain();
    wet.gain.value = 0.3;
    wet.connect(conv).connect(master);
    // 附點八分的回音（主旋律用）。
    echo = ctx.createGain();
    const dl = ctx.createDelay(2);
    dl.delayTime.value = BEAT * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2600;
    echo.connect(dl).connect(tone).connect(fb).connect(dl);
    const eo = ctx.createGain();
    eo.gain.value = 0.35;
    tone.connect(eo).connect(bus);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }

  const track = (node, until) => {
    live.add(node);
    node.onended = () => live.delete(node);
    node.stop(until);
  };
  /** 接到輸出：duck＝走會被大鼓壓的那條；send＝殘響；pan＝左右；delay＝回音。 */
  const out = (g, { send = 0, duck = false, pan = 0, delay = 0 } = {}) => {
    let node = g;
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node = g.connect(p);
    }
    node.connect(duck ? bus : master);
    if (send) {
      const s = ctx.createGain();
      s.gain.value = send;
      node.connect(s).connect(wet);
    }
    if (delay) {
      const s = ctx.createGain();
      s.gain.value = delay;
      node.connect(s).connect(echo);
    }
    return g;
  };
  const env = (g, at, a, peak, hold, r) => {
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + a);
    g.gain.setValueAtTime(Math.max(0.0002, peak), at + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, at + a + hold + r);
  };
  const noiseSrc = (at) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    s.start(at, Math.random() * 1.5);
    return s;
  };
  const osc = (type, f, at) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, at);
    o.start(at);
    return o;
  };
  const filter = (type, f, q = 1) => {
    const n = ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.Q.value = q;
    return n;
  };

  const voices = {
    pad(e, at, off) {
      const dur = e.dur - off;
      if (dur < 0.3) return;
      const f = filter("lowpass", 300 + 900 * e.bright, 0.7);
      f.frequency.setValueAtTime(300 + 900 * e.bright, at);
      f.frequency.linearRampToValueAtTime(500 + 2200 * e.bright, at + dur * 0.55);
      f.frequency.linearRampToValueAtTime(300 + 1000 * e.bright, at + dur);
      const g = ctx.createGain();
      env(g, at, Math.min(0.6, dur * 0.25), e.gain, Math.max(0, dur - 1.1), 0.5);
      f.connect(g);
      out(g, { send: 0.8, duck: e.duck });
      for (const [n, o] of e.notes) {
        for (const det of [-9, 8]) {
          const v = osc("sawtooth", hz(n, o), at);
          v.detune.value = det;
          const og = ctx.createGain();
          og.gain.value = 0.16;
          v.connect(og).connect(f);
          track(v, at + dur + 0.1);
        }
      }
    },
    sub(e, at, off) {
      const dur = e.dur - off;
      if (dur < 0.15) return;
      const v = osc("sine", e.f, at);
      const g = ctx.createGain();
      env(g, at, 0.03, e.gain, Math.max(0, dur - 0.25), 0.2);
      v.connect(g);
      out(g, { duck: true });
      track(v, at + dur + 0.05);
    },
    bassPluck(e, at) {
      const v = osc("sawtooth", e.f, at);
      const f = filter("lowpass", e.f * 6 * (e.cut || 1), 4);
      f.frequency.setValueAtTime(e.f * 6 * (e.cut || 1), at);
      f.frequency.exponentialRampToValueAtTime(e.f * 1.4, at + 0.16);
      const g = ctx.createGain();
      env(g, at, 0.004, e.gain, 0.04, 0.14);
      v.connect(f).connect(g);
      out(g, { duck: true, send: 0.05 });
      track(v, at + 0.25);
    },
    pluck(e, at) {
      const v = osc("triangle", e.f, at);
      const v2 = osc("square", e.f * 2, at);
      const m2 = ctx.createGain();
      m2.gain.value = 0.18;
      const f = filter("lowpass", e.f * (e.cut || 5));
      f.frequency.setValueAtTime(e.f * (e.cut || 5), at);
      f.frequency.exponentialRampToValueAtTime(e.f * 1.3, at + 0.22);
      const g = ctx.createGain();
      env(g, at, 0.003, e.gain, 0, 0.26);
      v.connect(f);
      v2.connect(m2).connect(f);
      f.connect(g);
      out(g, { send: 0.45, duck: e.duck, pan: e.pan || 0 });
      track(v, at + 0.32);
      track(v2, at + 0.32);
    },
    /** supersaw：三把鋸齒波互相走音＋低八度的方波，濾波一開一收，長音加顫音。 */
    lead(e, at, off) {
      const dur = e.dur - off;
      if (dur < 0.05) return;
      const f = filter("lowpass", 900, 1.2);
      f.frequency.setValueAtTime(900, at);
      f.frequency.exponentialRampToValueAtTime(5200, at + 0.03);
      f.frequency.exponentialRampToValueAtTime(2400, at + 0.25);
      const g = ctx.createGain();
      const rel = 0.16;
      const hold = at + Math.max(0.12, dur - 0.02);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(e.gain, at + 0.008);
      g.gain.exponentialRampToValueAtTime(e.gain * 0.72, at + 0.12);
      g.gain.setValueAtTime(e.gain * 0.72, hold);
      g.gain.exponentialRampToValueAtTime(0.0001, hold + rel);
      f.connect(g);
      out(g, { send: 0.35, duck: e.duck, delay: 0.5 });
      const end = hold + rel + 0.05;
      let lg = null;
      if (dur > 0.4) {
        const lfo = osc("sine", 5.5, at);
        lg = ctx.createGain();
        lg.gain.setValueAtTime(0, at);
        lg.gain.linearRampToValueAtTime(9, at + 0.35);
        lfo.connect(lg);
        track(lfo, end);
      }
      for (const [type, mul, det, gm] of [["sawtooth", 1, -13, 0.33], ["sawtooth", 1, 0, 0.33], ["sawtooth", 1, 12, 0.33], ["square", 0.5, 0, 0.18]]) {
        const v = osc(type, e.f * mul, at);
        v.detune.value = det;
        if (lg) lg.connect(v.detune);
        const vg = ctx.createGain();
        vg.gain.value = gm;
        v.connect(vg).connect(f);
        track(v, end);
      }
    },
    /** 柔和的主旋律（chorus）：方波＋三角波、濾得比較暗。 */
    soft(e, at, off) {
      const dur = e.dur - off;
      if (dur < 0.05) return;
      const f = filter("lowpass", 2200);
      f.frequency.setValueAtTime(2200, at);
      f.frequency.exponentialRampToValueAtTime(1300, at + 0.3);
      const g = ctx.createGain();
      env(g, at, 0.01, e.gain, Math.max(0, dur - 0.06), 0.18);
      f.connect(g);
      out(g, { send: 0.4, duck: e.duck, delay: 0.45 });
      for (const [type, gm, det] of [["square", 0.35, -6], ["triangle", 0.8, 5]]) {
        const v = osc(type, e.f, at);
        v.detune.value = det;
        const vg = ctx.createGain();
        vg.gain.value = gm;
        v.connect(vg).connect(f);
        track(v, at + dur + 0.25);
      }
    },
    bell(e, at, off) {
      const dur = e.dur - off;
      if (dur < 0.2) return;
      for (const [mul, gm] of [[1, 1], [2.76, 0.32], [5.4, 0.15]]) {
        const v = osc("sine", e.f * mul, at);
        const g = ctx.createGain();
        env(g, at, 0.004, e.gain * gm, 0, dur);
        v.connect(g);
        out(g, { send: 0.8 });
        track(v, at + dur + 0.1);
      }
    },
    kick(e, at) {
      const v = osc("sine", 165, at);
      v.frequency.exponentialRampToValueAtTime(47, at + 0.11);
      const g = ctx.createGain();
      env(g, at, 0.002, e.gain, 0.03, 0.3);
      v.connect(g);
      out(g);
      track(v, at + 0.42);
      const s = noiseSrc(at);
      const ng = ctx.createGain();
      env(ng, at, 0.001, e.gain * 0.12, 0, 0.012);
      s.connect(filter("highpass", 2500)).connect(ng);
      out(ng);
      track(s, at + 0.03);
      // sidechain：大鼓一下，那條 bus 先壓下去再慢慢放回來。
      if (e.duck) {
        const b = bus.gain;
        b.setValueAtTime(1, at);
        b.linearRampToValueAtTime(1 - e.duck, at + 0.012);
        b.linearRampToValueAtTime(1, at + 0.3);
      }
    },
    hat(e, at) {
      const s = noiseSrc(at);
      const g = ctx.createGain();
      env(g, at, 0.001, e.gain, 0, 0.035);
      s.connect(filter("highpass", 8000)).connect(g);
      out(g, { send: 0.1, pan: e.pan || 0 });
      track(s, at + 0.06);
    },
    ohat(e, at) {
      const s = noiseSrc(at);
      const g = ctx.createGain();
      env(g, at, 0.002, e.gain, 0.02, 0.2);
      s.connect(filter("highpass", 6500)).connect(g);
      out(g, { send: 0.15, pan: e.pan || 0 });
      track(s, at + 0.3);
    },
    clap(e, at) {
      const s = noiseSrc(at);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      for (const k of [0, 0.011, 0.022]) {
        g.gain.setValueAtTime(e.gain, at + k);
        g.gain.exponentialRampToValueAtTime(e.gain * 0.2, at + k + 0.009);
      }
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.17);
      s.connect(filter("bandpass", 1500, 0.9)).connect(g);
      out(g, { send: 0.4 });
      track(s, at + 0.2);
      voices.snare({ gain: e.gain * 0.5 }, at);
    },
    snare(e, at) {
      const s = noiseSrc(at);
      const g = ctx.createGain();
      env(g, at, 0.001, e.gain, 0, 0.11);
      s.connect(filter("bandpass", 2000, 0.7)).connect(g);
      out(g, { send: 0.25 });
      track(s, at + 0.14);
      const v = osc("triangle", 230, at);
      v.frequency.exponentialRampToValueAtTime(170, at + 0.06);
      const vg = ctx.createGain();
      env(vg, at, 0.001, e.gain * 0.6, 0, 0.07);
      v.connect(vg);
      out(vg);
      track(v, at + 0.1);
    },
    crash(e, at, off) {
      const dur = e.dur - off;
      if (dur < 0.2) return;
      const s = noiseSrc(at);
      const g = ctx.createGain();
      env(g, at, 0.002, e.gain, 0, dur);
      s.connect(filter("highpass", 4500)).connect(g);
      out(g, { send: 0.5 });
      track(s, at + dur + 0.05);
    },
    tick(e, at) {
      const s = noiseSrc(at);
      const g = ctx.createGain();
      env(g, at, 0.001, e.gain || 0.07, 0, 0.03);
      s.connect(filter("bandpass", 3200 + Math.random() * 900, 4)).connect(g);
      out(g, { send: 0.15 });
      track(s, at + 0.05);
    },
    stamp(e, at) {
      const v = osc("sine", 190, at);
      v.frequency.exponentialRampToValueAtTime(70, at + 0.09);
      const g = ctx.createGain();
      env(g, at, 0.002, (e.gain || 0.3) * 0.85, 0, 0.16);
      v.connect(g);
      out(g, { send: 0.3 });
      track(v, at + 0.2);
      voices.tick({ gain: 0.05 }, at);
    },
    impact(e, at) {
      const v = osc("sine", 70, at);
      v.frequency.exponentialRampToValueAtTime(28, at + 1.2);
      const g = ctx.createGain();
      env(g, at, 0.005, e.gain, 0.05, 1.3);
      v.connect(g);
      out(g, { send: 0.6 });
      track(v, at + 1.6);
      const s = noiseSrc(at);
      const f = filter("lowpass", 3000);
      f.frequency.setValueAtTime(3000, at);
      f.frequency.exponentialRampToValueAtTime(200, at + 0.6);
      const ng = ctx.createGain();
      env(ng, at, 0.002, e.gain * 0.4, 0, 0.7);
      s.connect(f).connect(ng);
      out(ng, { send: 0.8 });
      track(s, at + 0.8);
    },
    subdrop(e, at, off) {
      const dur = e.dur - off;
      if (dur < 0.25) return;
      const v = osc("sine", 62, at);
      v.frequency.exponentialRampToValueAtTime(26, at + dur);
      const g = ctx.createGain();
      env(g, at, 0.01, e.gain, 0.2, dur - 0.2);
      v.connect(g);
      out(g);
      track(v, at + dur + 0.05);
    },
    riser(e, at, off) {
      const dur = e.dur - off;
      if (dur < 0.2) return;
      const p0 = off / e.dur;
      const s = noiseSrc(at);
      const f = filter("bandpass", 300, 3);
      f.frequency.setValueAtTime(300 * Math.pow(20, p0), at);
      f.frequency.exponentialRampToValueAtTime(6000, at + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(Math.max(0.0001, e.gain * p0 * p0), at);
      g.gain.exponentialRampToValueAtTime(e.gain, at + dur * 0.96);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      s.connect(f).connect(g);
      out(g, { send: 0.6 });
      track(s, at + dur + 0.05);
      // 一條往上滑的鋸齒波，讓上升有音高。
      const v = osc("sawtooth", 180 * Math.pow(8, p0), at);
      v.frequency.exponentialRampToValueAtTime(1440, at + dur);
      const vg = ctx.createGain();
      vg.gain.setValueAtTime(Math.max(0.0001, e.gain * 0.18 * p0), at);
      vg.gain.exponentialRampToValueAtTime(e.gain * 0.18, at + dur * 0.96);
      vg.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      v.connect(filter("lowpass", 2400)).connect(vg);
      out(vg, { send: 0.5 });
      track(v, at + dur + 0.05);
    },
    /** 反向的鈸：兩拍吸進去，吸到最大就切掉（接在撞擊前面）。 */
    swell(e, at, off) {
      const dur = e.dur - off;
      if (dur < 0.1) return;
      const s = noiseSrc(at);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(e.gain, at + dur - 0.005);
      g.gain.linearRampToValueAtTime(0.0001, at + dur);
      s.connect(filter("highpass", 3000)).connect(g);
      out(g, { send: 0.3 });
      track(s, at + dur + 0.02);
    },
    /** 往下掉的噪音（段落退場）。 */
    down(e, at, off) {
      const dur = e.dur - off;
      if (dur < 0.2) return;
      const s = noiseSrc(at);
      const f = filter("bandpass", 5000, 2);
      f.frequency.setValueAtTime(5000, at);
      f.frequency.exponentialRampToValueAtTime(180, at + dur);
      const g = ctx.createGain();
      env(g, at, 0.01, e.gain, 0, dur);
      s.connect(f).connect(g);
      out(g, { send: 0.6 });
      track(s, at + dur + 0.05);
    },
    whoosh(e, at) {
      const s = noiseSrc(at);
      const f = filter("bandpass", 400, 1.2);
      f.frequency.setValueAtTime(400, at);
      f.frequency.exponentialRampToValueAtTime(2400, at + e.dur * 0.5);
      f.frequency.exponentialRampToValueAtTime(300, at + e.dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(e.gain, at + e.dur * 0.45);
      g.gain.exponentialRampToValueAtTime(0.0001, at + e.dur);
      s.connect(f).connect(g);
      out(g, { send: 0.5 });
      track(s, at + e.dur + 0.05);
    },
    clash(e, at) {
      voices.impact({ gain: 0.25 }, at);
      const v = osc("square", 220, at);
      v.frequency.exponentialRampToValueAtTime(110, at + 0.2);
      const g = ctx.createGain();
      env(g, at, 0.002, 0.08, 0, 0.25);
      v.connect(filter("lowpass", 1200)).connect(g);
      out(g, { send: 0.3 });
      track(v, at + 0.3);
    },
    chime(e, at) {
      voices.bell({ f: e.f || hz("A", 5), gain: e.gain || 0.08, dur: 1.2 }, at, 0);
    },
    /** 數位雜訊（斷線那一下）。 */
    glitch(e, at) {
      for (let k = 0; k < 5; k++) {
        const t = at + k * 0.045;
        const v = osc("square", 180 + ((k * 397) % 900), t);
        const g = ctx.createGain();
        env(g, t, 0.001, (e.gain || 0.06) * (1 - k * 0.12), 0.02, 0.01);
        v.connect(g);
        out(g, { send: 0.1 });
        track(v, t + 0.05);
      }
    },
  };

  const LONG = new Set(["pad", "sub", "bell", "riser", "lead", "soft", "crash", "subdrop", "down"]);

  function pump() {
    if (!playing) return;
    const now = ctx.currentTime;
    const horizon = now - startCtx + startT + 1.0;
    while (cursor < events.length && events[cursor].t < horizon) {
      const e = events[cursor++];
      const at = startCtx + (e.t - startT);
      // 拖到一半的長音：從中間接上；短的錯過就算了。
      if (at < now - 0.02) {
        const off = now - at;
        if (LONG.has(e.kind) && off < e.dur) voices[e.kind](e, now + 0.02, off);
        continue;
      }
      voices[e.kind]?.(e, at, 0);
    }
  }

  function stopAll() {
    for (const n of live) {
      try {
        n.stop();
      } catch {
        /* 已經停了 */
      }
    }
    live.clear();
    if (bus) {
      bus.gain.cancelScheduledValues(0);
      bus.gain.setValueAtTime(1, ctx.currentTime);
    }
  }

  return {
    /** 大鼓的時間（畫面跟著大鼓輕輕震一下）。 */
    kicks,
    /** 整首歌離線算好（輸出影片檔用），回傳 AudioBuffer。算完原本的即時播放照常能用。 */
    async render(sampleRate = 48000) {
      const live0 = ctx;
      const off = new OfflineAudioContext(2, Math.ceil((LENGTH + 2) * sampleRate), sampleRate);
      const wasMuted = muted;
      muted = false;
      setup(off);
      // 不要一開始就把上萬個聲音節點全建好（還沒響的節點每一格也要算，會慢到十幾分鐘）：
      // 每兩秒停一下，只建接下來兩秒要響的，建好再繼續。
      const STEP = 2;
      let i = 0;
      for (let s = 0; s < LENGTH + 2; s += STEP) {
        off.suspend(s).then(() => {
          while (i < events.length && events[i].t < s + STEP) {
            const e = events[i++];
            voices[e.kind]?.(e, Math.max(s, e.t) + 0.001, 0);
          }
          off.resume();
        });
      }
      const buf = await off.startRendering();
      muted = wasMuted;
      ctx = live0;
      master = bus = wet = echo = noise = null;
      if (live0) {
        const c = live0;
        ctx = null;
        setup(c);
      }
      live.clear();
      return buf;
    },
    get ready() {
      return !!ctx;
    },
    /** 從 t 秒開始播（第一次要在使用者點擊裡呼叫，瀏覽器才准出聲）。 */
    play(t = 0) {
      setup();
      ctx.resume();
      stopAll();
      startT = t;
      startCtx = ctx.currentTime + 0.08;
      cursor = events.findIndex((e) => e.t + e.dur >= t);
      if (cursor < 0) cursor = events.length;
      playing = true;
      clearInterval(timer);
      timer = setInterval(pump, 80);
      pump();
    },
    pause() {
      if (!ctx) return;
      startT = this.now();
      playing = false;
      clearInterval(timer);
      stopAll();
    },
    now() {
      if (!ctx || !playing) return startT;
      return Math.max(0, ctx.currentTime - startCtx + startT);
    },
    get playing() {
      return playing;
    },
    setMuted(m) {
      muted = m;
      if (master) master.gain.setTargetAtTime(m ? 0 : VOL, ctx.currentTime, 0.05);
    },
    get muted() {
      return muted;
    },
  };
}
