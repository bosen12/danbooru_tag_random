/**
 * 疊印台的聲音：全部用 WebAudio 現場合成，不載音檔。
 * 每個聲音對應一個實體動作 —— 蓋印的悶響、紙被掀起的沙沙聲、印壓滾筒、撞版的鈍響。
 * 很小聲，可以關（設定記在這台瀏覽器）。AudioContext 等第一次手勢才建立。
 */

const KEY = "mochi.fuse.sound.v1";

export function createSfx() {
  let ctx = null;
  let on = true;
  try {
    on = localStorage.getItem(KEY) !== "off";
  } catch {
    /* 讀不到就開著 */
  }

  function ac() {
    if (!on) return null;
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  function noise(a, dur) {
    const len = Math.max(1, Math.floor(a.sampleRate * dur));
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource();
    src.buffer = buf;
    return src;
  }

  function env(a, gain, t0, attack, decay) {
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    g.connect(a.destination);
    return g;
  }

  function tone(a, { freq, to, type = "sine", gain = 0.1, at = 0, attack = 0.004, decay = 0.12 }) {
    const t0 = a.currentTime + at;
    const o = a.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + attack + decay);
    o.connect(env(a, gain, t0, attack, decay));
    o.start(t0);
    o.stop(t0 + attack + decay + 0.02);
  }

  function hiss(a, { f = 1200, q = 0.8, type = "bandpass", gain = 0.05, at = 0, attack = 0.01, decay = 0.14, sweep }) {
    const t0 = a.currentTime + at;
    const src = noise(a, attack + decay + 0.05);
    const filt = a.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(f, t0);
    if (sweep) filt.frequency.exponentialRampToValueAtTime(sweep, t0 + attack + decay);
    filt.Q.value = q;
    src.connect(filt).connect(env(a, gain, t0, attack, decay));
    src.start(t0);
  }

  const sounds = {
    // 牌壓上版：低沉的一下，帶一點紙面的擦聲。
    stamp() {
      const a = ac();
      if (!a) return;
      tone(a, { freq: 150, to: 58, gain: 0.16, decay: 0.11 });
      hiss(a, { f: 700, type: "lowpass", gain: 0.05, decay: 0.05 });
    },
    // 被帶上來的牌：很輕的一聲，跟在蓋印後面。
    carry() {
      const a = ac();
      if (!a) return;
      tone(a, { freq: 1180, gain: 0.025, at: 0.05, decay: 0.05 });
    },
    // 掀起、拿掉、被擠下去：紙沙一聲往下滑。
    lift() {
      const a = ac();
      if (!a) return;
      hiss(a, { f: 2600, sweep: 900, q: 0.9, gain: 0.045, decay: 0.16 });
    },
    // 相剋：兩個略為走音的鈍響。
    clash() {
      const a = ac();
      if (!a) return;
      tone(a, { freq: 176, type: "triangle", gain: 0.06, decay: 0.12 });
      tone(a, { freq: 187, type: "triangle", gain: 0.05, at: 0.07, decay: 0.12 });
    },
    // 換一批試印：像翻過一疊樣張。
    shuffle() {
      const a = ac();
      if (!a) return;
      for (let i = 0; i < 4; i++) hiss(a, { f: 1800 + i * 300, q: 1.2, gain: 0.02, at: i * 0.045, decay: 0.05 });
    },
    // 付印：滾筒壓過去。
    roll() {
      const a = ac();
      if (!a) return;
      hiss(a, { f: 380, type: "lowpass", gain: 0.06, attack: 0.08, decay: 0.5 });
      tone(a, { freq: 72, gain: 0.05, attack: 0.06, decay: 0.45 });
    },
    // 印好了：兩個輕輕的音。
    done() {
      const a = ac();
      if (!a) return;
      tone(a, { freq: 660, gain: 0.05, decay: 0.28 });
      tone(a, { freq: 990, gain: 0.04, at: 0.11, decay: 0.34 });
    },
    // 印壞了：往下掉的一聲。
    fail() {
      const a = ac();
      if (!a) return;
      tone(a, { freq: 300, to: 140, type: "triangle", gain: 0.05, decay: 0.3 });
    },
  };

  return {
    ...sounds,
    get on() {
      return on;
    },
    set on(v) {
      on = !!v;
      try {
        localStorage.setItem(KEY, on ? "on" : "off");
      } catch {
        /* 存不了就這次有效 */
      }
    },
  };
}
