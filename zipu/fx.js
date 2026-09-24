/**
 * 聲音與小動畫。聲音全部用 WebAudio 現場合成（鉛字碰撞、蓋印、銅板），不載任何音檔。
 *
 * 動畫只做「看得到的效果」，遊戲流程從不等動畫的 finished —— 流程靠 sleep() 計時。
 * 分頁在背景、或 rAF 被暫停時，WAAPI 的 finished 可能永遠不 resolve，流程不能卡在那裡。
 */

let ctx = null;
let master = null;
let soundOn = true;
let speed = 1;
let hurry = false;
const REDUCED = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function setSound(on) {
  soundOn = !!on;
}

/** 1 = 正常，0.55 = 快速。 */
export function setSpeed(fast) {
  speed = fast ? 0.55 : 1;
}

/** 計分途中點一下：剩下的步驟用很短的間隔跑完。 */
export function setHurry(on) {
  hurry = !!on;
}

export function sleep(ms) {
  const t = hurry ? Math.min(ms, 40) : ms * speed;
  return new Promise((resolve) => setTimeout(resolve, t));
}

export const reduced = REDUCED;

function audio() {
  if (!soundOn) return null;
  if (!ctx) {
    const C = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!C) return null;
    try {
      ctx = new C();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

let noise = null;
function noiseBuffer(ac) {
  if (noise) return noise;
  const len = Math.floor(ac.sampleRate * 0.4);
  noise = ac.createBuffer(1, len, ac.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noise;
}

function tone(ac, { freq, type = "sine", at = 0, dur = 0.08, gain = 0.5, slide = 0 }) {
  const t = ac.currentTime + at;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function hiss(ac, { at = 0, dur = 0.05, gain = 0.4, freq = 2400, q = 3, sweep = 0 }) {
  const t = ac.currentTime + at;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  const f = ac.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, freq + sweep), t + dur);
  f.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

export const sfx = {
  /** 一顆鉛字碰到另一顆。 */
  clack() {
    const ac = audio();
    if (!ac) return;
    hiss(ac, { dur: 0.035, gain: 0.5, freq: 3200, q: 6 });
    tone(ac, { freq: 1900, type: "triangle", dur: 0.03, gain: 0.12 });
  },
  deal() {
    const ac = audio();
    if (!ac) return;
    hiss(ac, { dur: 0.05, gain: 0.25, freq: 1800, q: 1.2 });
  },
  chip(step = 0) {
    const ac = audio();
    if (!ac) return;
    tone(ac, { freq: 520 + Math.min(step, 14) * 38, type: "sine", dur: 0.07, gain: 0.3 });
  },
  mult() {
    const ac = audio();
    if (!ac) return;
    tone(ac, { freq: 330, type: "triangle", dur: 0.11, gain: 0.35, slide: 120 });
  },
  xmult() {
    const ac = audio();
    if (!ac) return;
    tone(ac, { freq: 392, type: "triangle", dur: 0.09, gain: 0.35 });
    tone(ac, { freq: 587, type: "triangle", at: 0.07, dur: 0.14, gain: 0.35 });
  },
  burn() {
    const ac = audio();
    if (!ac) return;
    hiss(ac, { dur: 0.28, gain: 0.35, freq: 1400, q: 0.8, sweep: -1200 });
  },
  /** 蓋印：一聲悶響。 */
  stamp() {
    const ac = audio();
    if (!ac) return;
    tone(ac, { freq: 120, type: "sine", dur: 0.22, gain: 0.8, slide: -60 });
    hiss(ac, { dur: 0.08, gain: 0.35, freq: 700, q: 0.7 });
  },
  coin() {
    const ac = audio();
    if (!ac) return;
    tone(ac, { freq: 1320, dur: 0.07, gain: 0.25 });
    tone(ac, { freq: 1760, at: 0.06, dur: 0.12, gain: 0.25 });
  },
  win() {
    const ac = audio();
    if (!ac) return;
    [523, 659, 784, 1047].forEach((f, i) => tone(ac, { freq: f, type: "triangle", at: i * 0.08, dur: 0.24, gain: 0.3 }));
  },
  lose() {
    const ac = audio();
    if (!ac) return;
    [392, 330, 262].forEach((f, i) => tone(ac, { freq: f, type: "triangle", at: i * 0.14, dur: 0.3, gain: 0.3 }));
  },
  error() {
    const ac = audio();
    if (!ac) return;
    tone(ac, { freq: 180, type: "square", dur: 0.08, gain: 0.08 });
  },
};

/* ---------- 看得到的效果 ---------- */

let layer = null;
function fxLayer() {
  if (layer && layer.isConnected) return layer;
  layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:45;";
  document.body.append(layer);
  return layer;
}

/** 在某個元素頭上冒一個「+9」「×2」。 */
export function pop(target, text, kind = "chips") {
  if (!target || !target.isConnected) return;
  const r = target.getBoundingClientRect();
  const el = document.createElement("span");
  el.className = "pop";
  el.dataset.kind = kind;
  el.textContent = text;
  el.style.position = "fixed";
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${r.top + 2}px`;
  el.style.setProperty("--card-w", `${Math.max(60, r.width)}px`);
  fxLayer().append(el);
  if (!REDUCED) {
    el.animate(
      [
        { opacity: 0, transform: "translateY(8px) scale(0.8)" },
        { opacity: 1, transform: "translateY(0) scale(1.06)", offset: 0.45 },
        { opacity: 1, transform: "translateY(0) scale(1)" },
      ],
      { duration: 260, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
    );
  }
  setTimeout(() => {
    if (!REDUCED) el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: "forwards" });
    setTimeout(() => el.remove(), 200);
  }, 700 * speed);
}

/** 牌被計分時彈一下。 */
export function bump(el, scale = 1.08) {
  if (!el || REDUCED) return;
  el.animate(
    [{ scale: "1" }, { scale: String(scale), offset: 0.4 }, { scale: "1" }],
    { duration: 200, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
  );
}

export function wiggle(el) {
  if (!el || REDUCED) return;
  el.animate(
    [{ rotate: "0deg" }, { rotate: "-5deg" }, { rotate: "4deg" }, { rotate: "0deg" }],
    { duration: 260, easing: "cubic-bezier(0.65, 0, 0.35, 1)" }
  );
}

export function shake(el) {
  if (!el || REDUCED) return;
  el.animate(
    [{ translate: "0 0" }, { translate: "-5px 0" }, { translate: "4px 0" }, { translate: "-2px 0" }, { translate: "0 0" }],
    { duration: 240, easing: "cubic-bezier(0.65, 0, 0.35, 1)" }
  );
}

/** FLIP：元素從 from 的位置滑到它現在的位置。 */
export function flipFrom(el, from, duration = 320) {
  if (!el || !from || REDUCED) return;
  const to = el.getBoundingClientRect();
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const s = from.width / Math.max(1, to.width);
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${s})` },
      { transform: "translate(0, 0) scale(1)" },
    ],
    { duration: duration * speed, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
  );
}

export function dealIn(el, i = 0) {
  if (!el || REDUCED) return;
  el.animate(
    [
      { opacity: 0, transform: "translateY(40px) rotate(4deg)" },
      { opacity: 1, transform: "translateY(0) rotate(0deg)" },
    ],
    { duration: 300 * speed, delay: i * 45 * speed, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "backwards" }
  );
}

export function fadeAway(el, dy = 30) {
  if (!el) return;
  if (REDUCED) {
    el.style.opacity = "0";
    return;
  }
  el.animate(
    [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: `translateY(${dy}px)` }],
    { duration: 220 * speed, easing: "cubic-bezier(0.7, 0, 0.84, 0)", fill: "forwards" }
  );
}

/** 數字跑上去。每一格用 setTimeout 推進，不靠 rAF。 */
export function countTo(el, from, to, ms = 420) {
  if (!el) return;
  const steps = REDUCED ? 1 : Math.max(1, Math.round((ms * speed) / 30));
  let i = 0;
  const tick = () => {
    i += 1;
    const v = i >= steps ? to : Math.round(from + ((to - from) * i) / steps);
    el.textContent = fmt(v);
    if (i < steps) setTimeout(tick, 30);
  };
  tick();
}

export function fmt(n) {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) >= 1e7) return n.toExponential(2).replace("+", "");
  return Math.round(n).toLocaleString("en-US");
}

export function fmtMult(n) {
  if (!Number.isFinite(n)) return String(n);
  return Number.isInteger(n) ? String(n) : n.toFixed(n < 10 ? 2 : 1).replace(/\.?0+$/, "");
}
