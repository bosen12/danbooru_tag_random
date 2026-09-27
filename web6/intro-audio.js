/**
 * 介紹影片的配樂：全部用 Web Audio 現場合成（沒有借來的音樂檔）。
 *
 * 96 BPM、4/4，一小節 2.5 秒，48 小節＝兩分鐘。和弦 Dm – B♭ – F – C 每兩小節換一個。
 * 段落跟畫面同一張時間表（intro.js 的 CUES 也從這裡的小節換算）：
 *   0–4 小節   開場：只有鋪底的 pad，墨滴落下那一下有低音的撞擊
 *   4–13      排字匣：加上撥弦琶音、低音；打字時每個字一聲很輕的喀
 *   13–28     墨池：大鼓進來；17 小節起加 hi-hat，21 起加拍手
 *   28–43     疊印台：四拍大鼓、全部樂器
 *   43–48     結尾：鼓退掉，最後一個和弦加鐘聲，淡出
 * 轉場前有噪音的上升（riser），鏡頭甩過去有呼的一聲（whoosh），牌落地有悶的一下（stamp）。
 *
 * 用法：const a = createScore(); a.play(fromSeconds); a.pause(); a.now() → 目前秒數。
 * 排程器只往前看 1.2 秒才真的建聲音節點：拖時間軸、暫停都準、也不會一次建幾千個節點。
 */

export const BPM = 96;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;
export const LENGTH = BAR * 48;
export const bar = (n, beat = 0) => n * BAR + beat * BEAT;

// 音名 → 頻率（A4 = 440）。
const NOTE = { C: -9, "C#": -8, D: -7, Eb: -6, E: -5, F: -4, "F#": -3, G: -2, Ab: -1, A: 0, Bb: 1, B: 2 };
const hz = (name, oct) => 440 * Math.pow(2, (NOTE[name] + (oct - 4) * 12) / 12);

const CHORDS = [
  { root: "D", notes: [["D", 3], ["F", 3], ["A", 3], ["E", 4]] }, // Dm(add9)
  { root: "Bb", notes: [["Bb", 2], ["D", 3], ["F", 3], ["C", 4]] }, // B♭(add9)
  { root: "F", notes: [["F", 3], ["A", 3], ["C", 4], ["G", 4]] }, // F(add9)
  { root: "C", notes: [["C", 3], ["E", 3], ["G", 3], ["D", 4]] }, // C(add9)
];
const chordAt = (barIndex) => CHORDS[Math.floor(barIndex / 2) % 4];

/**
 * 段落表：每一段 { from, to（小節）, kind, hat?, clap? }。kind：
 *   open  只有鋪底；light 加上低音、稀的撥弦（沒有鼓）；mid 大鼓兩拍一下，進段 hat 小節後加 hi-hat、clap 小節後加拍手；
 *   full  四拍大鼓、全部樂器、撥弦高八度；outro 鼓退掉，最後的和弦加鐘聲。
 * 每一段開頭有撞擊、前一小節有噪音的上升；進入 light／mid／full 前還有呼的一聲。
 */
export const PLAN_FULL = [
  { from: 0, to: 4, kind: "open" },
  { from: 4, to: 13, kind: "light" },
  { from: 13, to: 28, kind: "mid", hat: 4, clap: 8 },
  { from: 28, to: 43, kind: "full" },
  { from: 43, to: 48, kind: "outro" },
];
/** 只有墨池和疊印台的版本：墨池 4–19、找牌與拖曳 19–24、疊印台 24–39、撤回 39–43。 */
export const PLAN_CARDS = [
  { from: 0, to: 4, kind: "open" },
  { from: 4, to: 19, kind: "mid", hat: 4, clap: 8 },
  { from: 19, to: 24, kind: "mid", hat: 0, clap: 0 },
  { from: 24, to: 39, kind: "full" },
  { from: 39, to: 43, kind: "mid", hat: 0, clap: 0 },
  { from: 43, to: 48, kind: "outro" },
];

/** 整首歌的事件表（每個都是 { t, dur, kind, ...參數 }），照時間排好。純資料，跟播放無關。 */
export function buildEvents(extraCues = [], plan = PLAN_FULL) {
  const ev = [];
  const add = (t, dur, kind, o = {}) => ev.push({ t, dur, kind, ...o });
  const secAt = (b) => plan.find((p) => b >= p.from && b < p.to) || plan[plan.length - 1];
  const BRIGHT = { open: 0.35, light: 0.55, mid: 0.7, full: 0.9, outro: 0.6 };
  for (let b = 0; b < 48; b += 2) {
    const ch = chordAt(b);
    const sec = secAt(b);
    const end = b >= 42;
    // 鋪底：開場很薄、段落越後面越亮；結尾那個和弦拉長。
    if (b < 46) add(bar(b), BAR * 2 + (end ? 0 : 0.4), "pad", { notes: ch.notes, bright: BRIGHT[sec.kind], gain: sec.kind === "open" ? 0.1 : 0.13 });
    // 低音、撥弦跟著和弦走（兩小節一塊），密度看這一塊開頭是哪一段。
    if (sec.kind !== "open" && sec.kind !== "outro") {
      add(bar(b), BAR * 2, "bass", { f: hz(ch.root, 1), gain: sec.kind === "light" ? 0.22 : 0.3 });
      // 撥弦琶音：十六分音符，上行再下行；light 比較稀（八分）。
      const step = sec.kind === "light" ? 2 : 1;
      const seq = [0, 1, 2, 3, 2, 1, 2, 3];
      for (let i = 0; i < 32; i += step) {
        const n = ch.notes[seq[i % 8]];
        const oct = n[1] + 1 + (i % 16 >= 8 && sec.kind === "full" ? 1 : 0);
        add(bar(b) + (i * BEAT) / 4, BEAT * 0.9, "pluck", { f: hz(n[0], oct), gain: (sec.kind === "light" ? 0.05 : 0.06) * (i % 4 === 0 ? 1.25 : 1) });
      }
    }
  }
  // 結尾：最後的和弦＋鐘聲。
  add(bar(44), BAR * 4, "pad", { notes: [["D", 3], ["A", 3], ["D", 4], ["E", 4], ["F", 4]], bright: 0.8, gain: 0.14 });
  add(bar(44), BAR * 4, "bell", { f: hz("D", 5), gain: 0.18 });
  add(bar(44, 2), BAR * 3, "bell", { f: hz("A", 5), gain: 0.1 });
  add(bar(44), BAR * 3, "bass", { f: hz("D", 1), gain: 0.3 });
  // 鼓。
  for (let b = 0; b < 48; b++) {
    const sec = secAt(b);
    if (sec.kind !== "mid" && sec.kind !== "full") continue;
    const into = b - sec.from;
    const full = sec.kind === "full";
    for (let q = 0; q < 4; q++) {
      const t = bar(b, q);
      if (full || q === 0 || q === 2) add(t, 0.4, "kick", { gain: full ? 0.7 : 0.55 });
      if (full || into >= (sec.hat ?? 4)) add(t + BEAT / 2, 0.06, "hat", { gain: full ? 0.07 : 0.05 });
      if ((full || into >= (sec.clap ?? 8)) && (q === 1 || q === 3)) add(t, 0.2, "clap", { gain: full ? 0.16 : 0.12 });
    }
  }
  // 轉場。
  const RISE = { light: 0.14, mid: 0.14, full: 0.16, outro: 0.14, open: 0.1 };
  for (const sec of plan) {
    if (sec.from === 0) continue;
    add(bar(sec.from - 1), BAR, "riser", { gain: sec.from === 4 ? 0.1 : RISE[sec.kind] });
    add(bar(sec.from), 1.6, "impact", { gain: 0.5 });
    if (sec.from !== 4 && sec.kind !== "outro") add(bar(sec.from - 1, 3.2), 0.9, "whoosh", { gain: 0.18 });
  }
  // 畫面給的音效（打字的喀、牌落地、碰撞…）。
  for (const c of extraCues) add(c.t, c.dur || 0.2, c.kind, c);
  ev.sort((a, b) => a.t - b.t);
  return ev;
}

export function createScore(extraCues = [], plan = PLAN_FULL) {
  const events = buildEvents(extraCues, plan);
  let ctx = null;
  let master = null;
  let wet = null;
  let noise = null;
  let startCtx = 0;
  let startT = 0;
  let playing = false;
  let muted = false;
  let cursor = 0;
  let timer = 0;
  const live = new Set();

  function setup(given = null) {
    if (ctx && !given) return;
    ctx = given || new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(comp).connect(ctx.destination);
    // 殘響：自己產生一段衰減的噪音當 impulse response。
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    conv.buffer = ir;
    wet = ctx.createGain();
    wet.gain.value = 0.32;
    wet.connect(conv).connect(master);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }

  const track = (node, until) => {
    live.add(node);
    node.onended = () => live.delete(node);
    node.stop(until);
  };
  const out = (g, send = 0) => {
    g.connect(master);
    if (send) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(wet);
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

  // 每一種聲音：at 是 AudioContext 的時間，off 是這個事件已經過了多久（拖時間軸時接在中間）。
  const voices = {
    pad(e, at, off) {
      const dur = e.dur - off;
      if (dur < 0.3) return;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.Q.value = 0.6;
      f.frequency.setValueAtTime(300 + 900 * e.bright, at);
      f.frequency.linearRampToValueAtTime(500 + 1800 * e.bright, at + dur * 0.6);
      f.frequency.linearRampToValueAtTime(300 + 900 * e.bright, at + dur);
      const g = ctx.createGain();
      env(g, at, Math.min(1.4, dur * 0.3), e.gain, Math.max(0, dur - 2.6), 1.2);
      f.connect(g);
      out(g, 0.9);
      for (const [n, o] of e.notes) {
        for (const det of [-7, 6]) {
          const osc = ctx.createOscillator();
          osc.type = "sawtooth";
          osc.frequency.value = hz(n, o);
          osc.detune.value = det;
          const og = ctx.createGain();
          og.gain.value = 0.18;
          osc.connect(og).connect(f);
          osc.start(at);
          track(osc, at + dur + 0.2);
        }
      }
    },
    bass(e, at, off) {
      const dur = e.dur - off;
      if (dur < 0.2) return;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = e.f;
      const g = ctx.createGain();
      env(g, at, 0.05, e.gain, Math.max(0, dur - 0.5), 0.4);
      osc.connect(g);
      out(g);
      osc.start(at);
      track(osc, at + dur + 0.1);
    },
    pluck(e, at) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = e.f;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(e.f * 6, at);
      f.frequency.exponentialRampToValueAtTime(e.f * 1.5, at + 0.25);
      const g = ctx.createGain();
      env(g, at, 0.004, e.gain, 0, 0.32);
      osc.connect(f).connect(g);
      out(g, 0.5);
      osc.start(at);
      track(osc, at + 0.4);
    },
    bell(e, at, off) {
      const dur = e.dur - off;
      if (dur < 0.3) return;
      for (const [mul, gm] of [[1, 1], [2.76, 0.35], [5.4, 0.18]]) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = e.f * mul;
        const g = ctx.createGain();
        env(g, at, 0.005, e.gain * gm, 0, dur);
        osc.connect(g);
        out(g, 0.8);
        osc.start(at);
        track(osc, at + dur + 0.1);
      }
    },
    kick(e, at) {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(130, at);
      osc.frequency.exponentialRampToValueAtTime(42, at + 0.14);
      const g = ctx.createGain();
      env(g, at, 0.003, e.gain, 0.02, 0.32);
      osc.connect(g);
      out(g);
      osc.start(at);
      track(osc, at + 0.45);
    },
    hat(e, at) {
      const s = noiseSrc(at);
      const f = ctx.createBiquadFilter();
      f.type = "highpass";
      f.frequency.value = 7500;
      const g = ctx.createGain();
      env(g, at, 0.002, e.gain, 0, 0.05);
      s.connect(f).connect(g);
      out(g, 0.2);
      track(s, at + 0.08);
    },
    clap(e, at) {
      const s = noiseSrc(at);
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 1600;
      f.Q.value = 0.9;
      const g = ctx.createGain();
      // 拍手是好幾下很密的：三個小尖峰再一個尾巴。
      g.gain.setValueAtTime(0.0001, at);
      for (const k of [0, 0.012, 0.024]) {
        g.gain.setValueAtTime(e.gain, at + k);
        g.gain.exponentialRampToValueAtTime(e.gain * 0.2, at + k + 0.01);
      }
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      s.connect(f).connect(g);
      out(g, 0.45);
      track(s, at + 0.2);
    },
    tick(e, at) {
      const s = noiseSrc(at);
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 3200 + Math.random() * 900;
      f.Q.value = 4;
      const g = ctx.createGain();
      env(g, at, 0.001, e.gain || 0.07, 0, 0.03);
      s.connect(f).connect(g);
      out(g, 0.15);
      track(s, at + 0.05);
    },
    stamp(e, at) {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(190, at);
      osc.frequency.exponentialRampToValueAtTime(70, at + 0.09);
      const g = ctx.createGain();
      env(g, at, 0.002, e.gain || 0.3, 0, 0.16);
      osc.connect(g);
      out(g, 0.3);
      osc.start(at);
      track(osc, at + 0.2);
      voices.tick({ gain: 0.05 }, at);
    },
    impact(e, at) {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(70, at);
      osc.frequency.exponentialRampToValueAtTime(28, at + 1.2);
      const g = ctx.createGain();
      env(g, at, 0.005, e.gain, 0.05, 1.3);
      osc.connect(g);
      out(g, 0.6);
      osc.start(at);
      track(osc, at + 1.6);
      const s = noiseSrc(at);
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(3000, at);
      f.frequency.exponentialRampToValueAtTime(200, at + 0.6);
      const ng = ctx.createGain();
      env(ng, at, 0.002, e.gain * 0.4, 0, 0.7);
      s.connect(f).connect(ng);
      out(ng, 0.8);
      track(s, at + 0.8);
    },
    riser(e, at, off) {
      const dur = e.dur - off;
      if (dur < 0.2) return;
      const s = noiseSrc(at);
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 3;
      f.frequency.setValueAtTime(300, at);
      f.frequency.exponentialRampToValueAtTime(6000, at + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(e.gain, at + dur * 0.95);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      s.connect(f).connect(g);
      out(g, 0.6);
      track(s, at + dur + 0.05);
    },
    whoosh(e, at) {
      const s = noiseSrc(at);
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 1.2;
      f.frequency.setValueAtTime(400, at);
      f.frequency.exponentialRampToValueAtTime(2400, at + e.dur * 0.5);
      f.frequency.exponentialRampToValueAtTime(300, at + e.dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(e.gain, at + e.dur * 0.45);
      g.gain.exponentialRampToValueAtTime(0.0001, at + e.dur);
      s.connect(f).connect(g);
      out(g, 0.5);
      track(s, at + e.dur + 0.05);
    },
    clash(e, at) {
      voices.impact({ gain: 0.25 }, at);
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(220, at);
      osc.frequency.exponentialRampToValueAtTime(110, at + 0.2);
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 1200;
      const g = ctx.createGain();
      env(g, at, 0.002, 0.08, 0, 0.25);
      osc.connect(f).connect(g);
      out(g, 0.3);
      osc.start(at);
      track(osc, at + 0.3);
    },
    chime(e, at) {
      voices.bell({ f: e.f || hz("A", 5), gain: e.gain || 0.08, dur: 1.2 }, at, 0);
    },
  };

  function pump() {
    if (!playing) return;
    const now = ctx.currentTime;
    const horizon = now - startCtx + startT + 1.2;
    while (cursor < events.length && events[cursor].t < horizon) {
      const e = events[cursor++];
      const at = startCtx + (e.t - startT);
      // 拖到一半的長音（pad、bass、riser）：從中間接上；短的錯過就算了。
      if (at < now - 0.02) {
        const off = now - at;
        if ((e.kind === "pad" || e.kind === "bass" || e.kind === "bell" || e.kind === "riser") && off < e.dur) voices[e.kind](e, now + 0.02, off);
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
  }

  return {
    /**
     * 整首歌離線算好（輸出影片檔用）：同一組聲音、同一張事件表，排在準確的時間上，
     * 回傳 AudioBuffer（立體聲、sampleRate）。算完原本的即時播放照常能用。
     */
    async render(sampleRate = 48000) {
      const live0 = ctx;
      const off = new OfflineAudioContext(2, Math.ceil((LENGTH + 2) * sampleRate), sampleRate);
      const wasMuted = muted;
      muted = false;
      setup(off);
      for (const e of events) voices[e.kind]?.(e, e.t + 0.001, 0);
      const buf = await off.startRendering();
      muted = wasMuted;
      ctx = live0;
      master = wet = noise = null;
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
      // 還在響的長音從中間接上；還沒到的照常排。
      playing = true;
      clearInterval(timer);
      timer = setInterval(pump, 100);
      pump();
    },
    pause() {
      if (!ctx) return;
      startT = this.now();
      playing = false;
      clearInterval(timer);
      stopAll();
    },
    /** 目前播到第幾秒（播放中以聲音的時鐘為準，畫面跟著它走，永遠不會跟音樂錯開）。 */
    now() {
      if (!ctx || !playing) return startT;
      return Math.max(0, ctx.currentTime - startCtx + startT);
    },
    get playing() {
      return playing;
    },
    setMuted(m) {
      muted = m;
      if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05);
    },
    get muted() {
      return muted;
    },
  };
}
