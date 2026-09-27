/**
 * 排字匣的介紹影片（約兩分鐘）。畫面、配樂都在這一頁即時產生：
 *   牌就是墨池的牌（cards.js 的 cardNode、真的插畫），提示詞是真的引擎抽的（固定種子），
 *   疊印台的層、附帶關係是 fuse-bed.js 真的算出來的。
 *
 * 做法：每個東西都有 update(t) —— 只看時間 t 決定位置、透明度、模糊，所以可以任意快轉、倒轉。
 * 播放時 t 取自配樂的時鐘（intro-audio.js），畫面永遠跟音樂對齊。鏡頭（camera）是一條關鍵格軌道，
 * 整個世界跟著轉；字幕、大標題在另一層（hud），不跟鏡頭轉。
 *
 * 段落（跟配樂的小節對齊，一小節 2.5 秒）：
 *   0:00  開場：墨滴落下、漂浮的字收成標題
 *   0:10  01 排字匣：提示詞打出來、互斥、附帶、一鍵抽整組
 *   0:32  02 墨池：一整面牌牆、合成池、生圖顯影、偏好卡牌、清空
 *   1:10  03 疊印台：六塊版在空間裡分層、牌落進自己的層、引擎的影子、四張試印、附帶的線、疊合付印、晾紙繩
 *   1:47  結尾：牌環繞、三個名字、git clone
 * 測試用：window.__intro.seek(秒) 直接畫出那一格（不出聲）；網址 ?t=秒 從那裡開始。
 */
import { createScore, bar, LENGTH } from "./intro-audio.js";
import { buildLibrary, createAssets, cardNode, eagerArt, CARD_SUIT_INFO } from "./cards.js";
import { ratingBlocked } from "./rules/rating.js";
import { indexLexicon, defaultSettings, sanitizeSettings, drawOne, mulberry32, applyPin, contradictions, ACT_PLACE } from "./engine.js";
import { emptyBed, placeCard, relationsOf, REGISTERS, REGISTER_ROLE } from "./fuse-bed.js";
import { bezier, CURVE } from "./motion.js";

/* ================= 小工具 ================= */

const EZ = Object.fromEntries(Object.entries(CURVE).map(([k, c]) => [k, bezier(c)]));
EZ.lin = (p) => p;
const cl = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const seg = (t, a, b) => cl((t - a) / (b - a));
const lerp = (a, b, p) => a + (b - a) * p;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const $ = (id) => document.getElementById(id);

function mk(tag, cls, parent, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  if (parent) parent.append(n);
  return n;
}

/** 世界裡的東西：以 (x, y, z) 為中心擺，轉角、縮放、透明、模糊。 */
function put(el, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, o = 1, blur = 0 }) {
  if (o <= 0.002) {
    if (el.style.visibility !== "hidden") el.style.visibility = "hidden";
    return;
  }
  if (el.style.visibility !== "visible") el.style.visibility = "visible";
  el.style.transform = `translate(-50%, -50%) translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, ${z.toFixed(1)}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg) scale(${s.toFixed(4)})`;
  el.style.opacity = o >= 0.999 ? "" : o.toFixed(3);
  el.style.filter = blur > 0.08 ? `blur(${blur.toFixed(2)}px)` : "";
}

/** 關鍵格軌道：[[t, {x, y, …}, 曲線?], …]，兩格之間用那一格的曲線（預設 inOut）。 */
function track(keys, ease = EZ.inOut) {
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1, e1] = keys[i];
      if (t <= t1) {
        const [t0, v0] = keys[i - 1];
        const p = (e1 || ease)(seg(t, t0, t1));
        const o = {};
        for (const k in v1) o[k] = lerp(v0[k] ?? v1[k], v1[k], p);
        return o;
      }
    }
    return keys[keys.length - 1][1];
  };
}

/** 二次貝茲（弧線飛行）。 */
const quad = (a, c, b, p) => (1 - p) * (1 - p) * a + 2 * (1 - p) * p * c + p * p * b;

/** 衰減的彈簧（晾在繩上擺盪、撞一下）。 */
const spring = (dt, amp, k = 2.4, w = 8) => (dt < 0 ? 0 : amp * Math.exp(-dt * k) * Math.cos(dt * w));

/* ================= 舞台 ================= */

const stage = $("stage");
const world = $("world");
const hud = $("hud");
const acts = []; // { win: [a, b], el?, update(t) }
const cues = []; // 給配樂的音效：{ t, kind, gain }

function act(win, update, el = null) {
  acts.push({ win, update, el });
}

function group(x = 0, y = 0) {
  const g = mk("div", "grp", world);
  g.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  return g;
}

/* ---------- 牌 ---------- */

let lib = null;
let assets = null;
let lex = null;
let settings = null;

function cardEl(tag, w, parent, { ghost = false } = {}) {
  const c = lib.byTag.get(tag);
  const holder = mk("div", "w wc" + (ghost ? " is-ghost" : ""), parent);
  if (!c) return holder;
  const node = eagerArt(cardNode(c, assets, { tagName: "div" }));
  node.style.setProperty("--card-w", w + "px");
  for (const img of node.querySelectorAll("img")) img.sizes = Math.round(w * 1.2) + "px";
  holder.append(node);
  holder.style.setProperty("--card-w", w + "px");
  return holder;
}

const suitOf = (tag) => lib.byTag.get(tag)?.suit || "look";
const zhOf = (tag) => lib.byTag.get(tag)?.zh || tag;
const hasArt = (tag) => !!(lib.byTag.get(tag) && assets.art(tag) && !ratingBlocked(lib.byTag.get(tag).item, "general"));

/** 一張「成品」：場景那張的插畫墊底、人物那張疊印上去（multiply）。 */
function printEl(bgTag, fgTag, w, h, parent, label = "") {
  const el = mk("figure", "w print", parent);
  el.style.width = w + "px";
  el.style.height = h + "px";
  el.style.margin = "0";
  const shot = mk("div", "shot", el);
  const bg = mk("img", "", shot);
  bg.src = assets.art(bgTag) || "";
  bg.decoding = "sync";
  const fg = mk("img", "fg", shot);
  fg.src = assets.art(fgTag) || "";
  fg.decoding = "sync";
  mk("figcaption", "", el, label);
  return el;
}

/* ---------- 字幕、標題（不跟鏡頭轉） ---------- */

/**
 * 會動的字：中文一個字一個字從下面翻上來（帶一點模糊），英文從左邊拉開；
 * 離場往上、淡掉。cls：k-title／k-cap／k-big／k-sec。
 */
function kinetic({ cls, zh, en = "", x, y, align = "left", inAt, outAt, st = 0.035, rule = false, drift = 0 }) {
  const box = mk("div", "k " + cls, hud);
  box.style.left = x + "px";
  box.style.top = y + "px";
  const ruleEl = rule ? mk("span", "rule", box) : null;
  const zhEl = mk("span", "zh", box);
  const chars = [...zh].map((c) => mk("span", "ch", zhEl, c === " " ? "&nbsp;" : esc(c)));
  const enEl = en ? mk("span", "en", box, esc(en)) : null;
  const anchor = align === "center" ? "translate(-50%, -50%)" : align === "right" ? "translate(-100%, -50%)" : "translate(0, -50%)";
  const n = chars.length;
  const end = outAt + n * st * 0.5 + 0.6;
  act([inAt - 0.1, end], (t) => {
    box.style.transform = `${anchor} translateX(${((t - inAt) * drift).toFixed(1)}px)`;
    chars.forEach((c, i) => {
      const pin = EZ.out(seg(t, inAt + i * st, inAt + i * st + 0.75));
      const pout = EZ.exit(seg(t, outAt + i * st * 0.5, outAt + i * st * 0.5 + 0.45));
      const o = pin * (1 - pout);
      c.style.opacity = o.toFixed(3);
      c.style.transform = `translateY(${((1 - pin) * 52 - pout * 34).toFixed(1)}px) rotateX(${((1 - pin) * -55).toFixed(1)}deg)`;
      const b = (1 - pin) * 12 + pout * 10;
      c.style.filter = b > 0.1 ? `blur(${b.toFixed(1)}px)` : "";
    });
    if (enEl) {
      const p = EZ.out(seg(t, inAt + 0.25, inAt + 1.2));
      const q = EZ.exit(seg(t, outAt, outAt + 0.4));
      enEl.style.opacity = (p * (1 - q)).toFixed(3);
      enEl.style.clipPath = `inset(0 ${((1 - p) * 100).toFixed(1)}% 0 0)`;
      enEl.style.transform = `translateX(${((1 - p) * -24).toFixed(1)}px)`;
    }
    if (ruleEl) {
      const p = EZ.out(seg(t, inAt, inAt + 0.8));
      const q = EZ.exit(seg(t, outAt, outAt + 0.4));
      ruleEl.style.transform = `scaleX(${(p * (1 - q)).toFixed(3)})`;
    }
  }, box);
  return box;
}

const caption = (zh, en, inAt, outAt, o = {}) => kinetic({ cls: "k-cap", zh, en, x: 130, y: 900, inAt, outAt, st: 0.028, rule: true, drift: 4, ...o });

function sectionTag(num, zh, en, inAt, outAt) {
  const box = mk("div", "k k-sec", hud, `<b>${num}</b>${esc(en)}<span>${esc(zh)}</span>`);
  box.style.left = "110px";
  box.style.top = "92px";
  act([inAt - 0.1, outAt + 0.6], (t) => {
    const p = EZ.out(seg(t, inAt, inAt + 0.8));
    const q = EZ.exit(seg(t, outAt, outAt + 0.5));
    box.style.opacity = (p * (1 - q)).toFixed(3);
    box.style.transform = `translate(0, -50%) translateX(${((1 - p) * -30 - q * 20).toFixed(1)}px)`;
    box.style.clipPath = `inset(0 ${((1 - p) * 100).toFixed(1)}% 0 0)`;
  }, box);
}

/* ================= 資料（真的引擎、真的牌） ================= */

// 公開展示：不讓身材、裸露、哭泣這類字出現在畫面上的摘錄裡（引擎照規則抽，展示只挑乾淨的種子、摘乾淨的字）。
// 整組不要的（抽到就換下一個種子）：裸露、內衣、泳裝、哭泣…
const DRAW_BAD = /nude|naked|pant(y|ie)|underwear|lingerie|cleavage|bikini|swimsuit|sex|blood|cry|tears|bath|wet|lying/;
// 摘錄裡不顯示的（引擎每一張都會抽身材；照實抽，但展示不秀）。
const BAD = /breast|chest|wet|nude|naked|pant(y|ie)|cleavage|underwear|bath|lingerie|\bass\b|thigh|navel|gyaru|bikini|swimsuit|cry|tears|empty eyes|blood|sweat|lying|armpit|skin|sex|kiss|size difference|flat|curvy|plump|muscular|pregnant/;

function cleanDraws(pins, count, from = 1) {
  const out = [];
  for (let seed = from; out.length < count && seed < 5000; seed++) {
    const tags = drawOne(lex, settings, new Set(pins), new Set(), mulberry32(seed), seed)
      .positive.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!tags.includes("1girl")) continue;
    if (tags.some((t) => DRAW_BAD.test(t))) continue;
    out.push({ seed, tags });
  }
  return out;
}

function pickArt(list, n) {
  return list.filter(hasArt).slice(0, n);
}

/* ================= 背景（畫布） ================= */

const bg = $("bg");
const bgc = bg.getContext("2d");
const TINT = [
  [0, [0.62, 0.19, 33]],
  [30, [0.6, 0.16, 33]],
  [34, [0.62, 0.1, 200]],
  [68, [0.62, 0.1, 200]],
  [72, [0.7, 0.12, 70]],
  [106, [0.7, 0.12, 70]],
  [110, [0.6, 0.03, 250]],
];
function tintAt(t) {
  for (let i = 1; i < TINT.length; i++) {
    if (t <= TINT[i][0]) {
      const p = EZ.inOut(seg(t, TINT[i - 1][0], TINT[i][0]));
      return TINT[i - 1][1].map((v, k) => lerp(v, TINT[i][1][k], p));
    }
  }
  return TINT[TINT.length - 1][1];
}
function drawBg(t) {
  const [l, c, h] = tintAt(t);
  bgc.fillStyle = "#07090d";
  bgc.fillRect(0, 0, 960, 540);
  const blobs = [
    [480 + Math.sin(t * 0.13) * 220, 250 + Math.cos(t * 0.11) * 90, 420, 0.22],
    [180 + Math.cos(t * 0.09) * 120, 430 + Math.sin(t * 0.17) * 60, 300, 0.12],
    [800 + Math.sin(t * 0.07 + 1) * 120, 120 + Math.cos(t * 0.12) * 70, 260, 0.1],
  ];
  for (const [x, y, r, a] of blobs) {
    const g = bgc.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `oklch(${(l * 0.45).toFixed(3)} ${(c * 0.6).toFixed(3)} ${h} / ${a})`);
    g.addColorStop(1, "oklch(0.1 0.01 250 / 0)");
    bgc.fillStyle = g;
    bgc.fillRect(0, 0, 960, 540);
  }
}

/* ================= 場景 ================= */

const X1 = 0;
const X2 = 5200;
const X3 = 10400;

function buildOpen(words) {
  // 墨滴：從上面落下，打在畫面中央散開三圈。
  const drop = mk("div", "k", hud);
  Object.assign(drop.style, { left: "960px", top: "0", width: "22px", height: "22px", borderRadius: "50%", background: "var(--color-accent)" });
  act([0, 1.6], (t) => {
    const p = EZ.in(seg(t, 0.35, 1.45));
    drop.style.opacity = t < 0.3 ? 0 : 1;
    drop.style.transform = `translate(-50%, -50%) translateY(${lerp(-40, 540, p).toFixed(1)}px) scaleY(${(1 + p * 0.8).toFixed(2)})`;
    drop.style.visibility = t > 1.46 ? "hidden" : "";
  }, drop);
  cues.push({ t: 1.45, kind: "impact", gain: 0.45 });
  for (let i = 0; i < 3; i++) {
    const r = mk("div", "k", hud);
    Object.assign(r.style, { left: "960px", top: "540px", width: "40px", height: "40px", borderRadius: "50%", border: "2px solid var(--color-accent)" });
    const a = 1.45 + i * 0.22;
    act([a, a + 2.2], (t) => {
      const p = EZ.out(seg(t, a, a + 2.1));
      r.style.opacity = ((1 - p) * 0.9).toFixed(3);
      r.style.transform = `translate(-50%, -50%) scale(${(1 + p * (18 + i * 8)).toFixed(2)}, ${(1 + p * (6 + i * 3)).toFixed(2)})`;
    }, r);
  }
  const blot = mk("div", "k", hud);
  Object.assign(blot.style, { left: "960px", top: "540px", width: "600px", height: "600px", borderRadius: "50%", background: "radial-gradient(circle, oklch(0.45 0.16 33 / 0.55), transparent 65%)" });
  act([1.4, 6], (t) => {
    const p = EZ.out(seg(t, 1.45, 5.5));
    blot.style.opacity = (Math.min(1, seg(t, 1.45, 1.7)) * (1 - p)).toFixed(3);
    blot.style.transform = `translate(-50%, -50%) scale(${(0.1 + p * 2.4).toFixed(3)}, ${(0.05 + p * 0.9).toFixed(3)})`;
  }, blot);

  // 漂浮的字：散在空間裡，鏡頭穿過去，最後被吸成標題。
  const g = group(X1, 0);
  const rnd = mulberry32(9);
  words.forEach((tag, i) => {
    const el = mk("div", "w tagword", g, `${esc(tag)}<small>${esc(zhOf(tag))}</small>`);
    el.style.setProperty("--suit", `var(--suit-${suitOf(tag)})`);
    const x0 = (rnd() - 0.5) * 2200;
    const y0 = (rnd() - 0.5) * 1100;
    const z0 = -1600 + rnd() * 1700;
    const a = 1.7 + rnd() * 1.6;
    const pull = 6.1 + rnd() * 0.9;
    act([1.5, 8.4], (t) => {
      const pin = EZ.out(seg(t, a, a + 1.2));
      const pc = EZ.in(seg(t, pull, pull + 1.1));
      put(el, {
        x: lerp(x0 + Math.sin(t * 0.4 + i) * 30, 0, pc),
        y: lerp(y0 + Math.cos(t * 0.3 + i) * 20, -40, pc),
        z: lerp(z0 + (t - 1.5) * 60, 200, pc),
        s: lerp(1, 0.15, pc),
        o: pin * (1 - pc * pc),
        blur: (1 - pin) * 8 + Math.max(0, (-z0 - 900) / 260) * (1 - pc),
      });
    }, el);
  });
  act([0, 10.2], () => {}, g);
  kinetic({ cls: "k-title", zh: "排字匣", en: "DANBOORU CASE", x: 960, y: 470, align: "center", inAt: 7.35, outAt: 9.55, st: 0.09 });
  kinetic({ cls: "k-cap", zh: "一張圖，是一組字", en: "Every image is a set of words", x: 960, y: 720, align: "center", inAt: 8.2, outAt: 9.65, st: 0.05 });
}

function buildTagCase(data) {
  const g = group(X1, 0);
  act([9.4, 33.4], () => {}, g);
  sectionTag("01", "排字匣", "TAG CASE", 10.3, 31.2);

  // 提示詞框：一個字一個字打出來。
  const pos = mk("div", "w pos", g);
  mk("span", "pos-label", pos, "POS");
  const text = mk("span", "pos-text", pos);
  const caret = mk("i", "pos-caret", pos);
  const typed = data.typed.join(", ");
  const T0 = 10.9;
  const T1 = 15.0;
  const perChar = (T1 - T0) / typed.length;
  for (let i = 0; i < typed.length; i++) if (typed[i] !== " ") cues.push({ t: T0 + i * perChar, kind: "tick", gain: 0.05 });
  const swapped = typed.replace("long hair", "short hair");
  act([10, 25.6], (t) => {
    const p = EZ.out(seg(t, 10.1, 10.9));
    const up = EZ.inOut(seg(t, 24.2, 25.2));
    put(pos, { x: 0, y: lerp(-160, -330, up) + (1 - p) * 40, z: 0, rx: (1 - p) * 30, o: p * (1 - up) });
    const k = Math.floor(seg(t, T0, T1) * typed.length);
    const s = t >= 17.55 ? swapped : typed.slice(0, k);
    if (text.textContent !== s) text.textContent = s;
    caret.style.opacity = t > T1 + 0.2 ? (Math.floor(t * 2.4) % 2 ? "0.15" : "1") : "1";
  }, pos);

  // 打完變成一張張字條。
  const chips = data.typed.map((tag) => {
    const el = mk("div", "w chip", g, `<b>${esc(CARD_SUIT_INFO[suitOf(tag)].glyph)}</b><span>${esc(zhOf(tag))}</span><small>${esc(tag)}</small>`);
    el.style.setProperty("--suit", `var(--suit-${suitOf(tag)})`);
    return { tag, el };
  });
  const short = mk("div", "w chip", g, `<b>${esc(CARD_SUIT_INFO[suitOf("short hair")].glyph)}</b><span>${esc(zhOf("short hair"))}</span><small>short hair</small>`);
  short.style.setProperty("--suit", `var(--suit-${suitOf("short hair")})`);
  const jc = mk("div", "w chip", g, `<b>${esc(CARD_SUIT_INFO[suitOf("japanese clothes")].glyph)}</b><span>${esc(zhOf("japanese clothes"))}</span><small>japanese clothes</small>`);
  jc.style.setProperty("--suit", `var(--suit-${suitOf("japanese clothes")})`);

  // 量寬度排一排（字型載好之後才量）。
  const widths = chips.map((c) => c.el.offsetWidth || 220);
  const gap = 18;
  const total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
  let cx = -total / 2;
  chips.forEach((c, i) => {
    c.x = cx + widths[i] / 2;
    cx += widths[i] + gap;
  });
  const charW = 34 * 0.6;
  let at = 0;
  chips.forEach((c) => {
    c.sx = -740 + 34 + 26 + 22 + (at + c.tag.length / 2) * charW;
    at += c.tag.length + 2;
  });
  const lh = chips.find((c) => c.tag === "long hair");
  const ki = chips.find((c) => c.tag === "kimono");
  const ROW = 20;

  chips.forEach((c, i) => {
    const a = 15.15 + i * 0.08;
    act([15, 25.6], (t) => {
      const p = EZ.out(seg(t, a, a + 0.75));
      const up = EZ.inOut(seg(t, 24.2, 25.2));
      let x = lerp(c.sx, c.x, p);
      let y = lerp(-160, ROW, p);
      let rz = 0;
      let o = p;
      if (c === lh) {
        // 被短髮撞開：轉著掉下去。
        const hit = seg(t, 17.5, 18.7);
        const e = EZ.in(hit);
        x += -hit * 120;
        y += e * 320;
        rz = -e * 38;
        o *= 1 - EZ.in(seg(t, 17.9, 18.7));
        c.el.classList.toggle("is-bad", t > 17.3 && t < 18.8);
      }
      if (c === ki) {
        const pulse = spring(t - 21.25, 0.12, 5, 14);
        put(c.el, { x, y: lerp(y, y - 150, up), s: 1 + Math.max(0, pulse), rz, o: o * (1 - up) });
        return;
      }
      put(c.el, { x, y: lerp(y, y - 150, up), rz, o: o * (1 - up) });
    }, c.el);
  });

  // 互斥：短髮從右邊飛進來，撞開長髮，站進它的位置。
  cues.push({ t: 17.5, kind: "clash" });
  act([16.2, 25.6], (t) => {
    const p = EZ.travel(seg(t, 16.35, 17.5));
    const up = EZ.inOut(seg(t, 24.2, 25.2));
    const x = quad(1100, 700, lh.x, p);
    const y = quad(ROW + 40, -260, ROW, p);
    put(short, { x, y: lerp(y, y - 150, up), rz: (1 - p) * 14, s: 1 + spring(t - 17.5, 0.06, 6, 16), o: Math.min(1, seg(t, 16.3, 16.6)) * (1 - up) });
  }, short);
  const ring = mk("div", "w ring", g);
  act([17.4, 18.6], (t) => {
    const p = EZ.out(seg(t, 17.5, 18.5));
    Object.assign(ring.style, { width: "60px", height: "60px" });
    put(ring, { x: lh.x - 60, y: ROW, s: 1 + p * 7, o: (1 - p) * 0.9 });
  }, ring);
  const lab1 = mk("div", "w rel-label", g, `同一格只留一張<small>one card per slot</small>`);
  lab1.style.setProperty("--suit-wear", "var(--color-accent)");
  act([17.4, 20.8], (t) => {
    const p = EZ.out(seg(t, 17.65, 18.3));
    const q = EZ.exit(seg(t, 20.1, 20.5));
    put(lab1, { x: lh.x, y: ROW - 120 + (1 - p) * 20, o: p * (1 - q) });
  }, lab1);

  // 附帶：和服把「和服類」帶上來，中間一條虛線。
  cues.push({ t: 21.25, kind: "chime", gain: 0.1 });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "w rel");
  svg.setAttribute("width", "10");
  svg.setAttribute("height", "10");
  g.append(svg);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "oklch(66% 0.1 305)");
  path.setAttribute("stroke-width", "3");
  path.setAttribute("stroke-dasharray", "8 8");
  svg.append(path);
  const jcTo = { x: ki.x + 60, y: ROW + 150 };
  act([21, 25.6], () => {}, jc);
  act([21, 25.6], (t) => {
    const p = EZ.out(seg(t, 21.25, 22.15));
    const up = EZ.inOut(seg(t, 24.2, 25.2));
    put(jc, { x: lerp(ki.x, jcTo.x, p), y: lerp(ROW, jcTo.y, p) - up * 150, s: lerp(0.3, 1, p), o: Math.min(1, p * 3) * (1 - up) });
    const x1 = ki.x;
    const y1 = ROW + 30;
    const x2 = lerp(ki.x, jcTo.x, p);
    const y2 = lerp(ROW, jcTo.y, p) - 30;
    svg.style.visibility = "visible";
    svg.style.transform = `translate3d(0, ${(-up * 150).toFixed(1)}px, 0)`;
    svg.style.opacity = (Math.min(1, p * 2) * (1 - up)).toFixed(3);
    path.setAttribute("d", `M ${x1} ${y1} C ${x1} ${y1 + 60}, ${x2} ${y2 - 60}, ${x2} ${y2}`);
    path.style.strokeDashoffset = String(-t * 30);
  }, svg);
  const lab2 = mk("div", "w rel-label", g, `附帶：牌會把上一層帶上來<small>a card carries its parent</small>`);
  act([21.4, 24.6], (t) => {
    const p = EZ.out(seg(t, 21.7, 22.4));
    const q = EZ.exit(seg(t, 23.9, 24.3));
    put(lab2, { x: ki.x + 60, y: ROW + 260 + (1 - p) * 20, o: p * (1 - q) });
  }, lab2);

  // 一鍵抽整組：三排拉霸，照拍子一排一排停下來（真的引擎抽的）。
  const LOCK = [bar(10, 2), bar(11), bar(11, 2)];
  const rowsY = [-150, -20, 110];
  const rnd = mulberry32(3);
  data.draws.forEach((d, r) => {
    const el = mk("div", "w slotrow", g);
    const seedEl = mk("span", "seed", el, `seed ${d.seed}`);
    const body = mk("span", "", el);
    const shown = d.tags.filter((tag) => !BAD.test(tag)).slice(0, 13);
    const finalHtml = shown.map((tag) => (data.pins.includes(tag) ? `<em>${esc(tag)}</em>` : esc(tag))).join(", ") + ", …";
    let last = "";
    cues.push({ t: LOCK[r], kind: "stamp", gain: 0.3 });
    for (let tt = 25.3 + r * 0.03; tt < LOCK[r]; tt += 0.11) cues.push({ t: tt, kind: "tick", gain: 0.025 });
    act([24.6, 32.6], (t) => {
      const p = EZ.out(seg(t, 24.8 + r * 0.12, 25.6 + r * 0.12));
      const q = EZ.exit(seg(t, 31.1, 31.7));
      const locked = t >= LOCK[r];
      el.classList.toggle("is-locked", locked);
      let html;
      if (locked) html = finalHtml;
      else {
        const f = Math.floor(t / 0.07) + r * 7;
        const pick = [];
        for (let k = 0; k < 11; k++) pick.push(data.words[Math.floor(((f * 131 + k * 71 + r * 13) % 997) / 997 * data.words.length)]);
        html = pick.map(esc).join(", ");
      }
      if (html !== last) {
        body.innerHTML = html;
        last = html;
      }
      const lp = spring(t - LOCK[r], 0.035, 7, 18);
      put(el, { x: (1 - p) * 700, y: rowsY[r], z: 0, s: 1 + (locked ? Math.max(0, lp) : 0), o: p * (1 - q), blur: locked ? 0 : 1.2 + Math.sin(t * 40 + r) * 0.4 });
      seedEl.style.opacity = locked ? "1" : "0.45";
    }, el);
  });
  void rnd;

  // 數字。
  const stats = [
    [data.count, "字 · TAGS", -560],
    [6, "花色 · SUITS", 0],
    [0, "互相打架 · CONFLICTS", 560],
  ];
  stats.forEach(([n, label, x], i) => {
    const el = mk("div", "w stat", g);
    act([29, 32.6], (t) => {
      const p = EZ.out(seg(t, 29.2 + i * 0.15, 30.1 + i * 0.15));
      const q = EZ.exit(seg(t, 31.1, 31.6));
      const v = Math.round(n * EZ.out(seg(t, 29.2, 30.4)));
      const s = `${v.toLocaleString("en-US")}<small>${esc(label)}</small>`;
      if (el.innerHTML !== s) el.innerHTML = s;
      put(el, { x, y: 300 + (1 - p) * 30, o: p * (1 - q) });
    }, el);
  });

  caption("每一個 Danbooru tag，都是一個字", "Every Danbooru tag is a word", 11.3, 15.8);
  caption("按一下，其他格子由引擎照規則抽齊", "One press — the engine fills the rest, by the rules", 25.3, 30.7);
}

function buildMochi(data) {
  const g = group(X2, 0);
  act([31.4, 71], () => {}, g);
  sectionTag("02", "墨池", "MOCHI", 33.0, 68.4);

  // 牌牆：九欄四列，斜著立在後面。
  const COLS = 9;
  const CW = 118;
  const wall = [];
  const ang = (24 * Math.PI) / 180;
  const base = { x: -200, y: -300, z: -700 };
  data.wall.forEach((tag, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const lx = (col - (COLS - 1) / 2) * 142;
    const ly = (row - 1.5) * 196;
    const pos = { x: base.x + lx * Math.cos(ang), y: base.y + ly, z: base.z - lx * Math.sin(ang), ry: 24 };
    const el = cardEl(tag, CW, g);
    const a = 32.7 + col * 0.05 + row * 0.08;
    wall.push({ tag, el, pos });
    act([32.4, 71], (t) => {
      const p = EZ.out(seg(t, a, a + 0.8));
      const gone = data.pool.includes(tag) ? seg(t, departOf(tag), departOf(tag) + 0.05) : 0;
      const back = data.pool.includes(tag) ? EZ.out(seg(t, 65.1, 65.6)) : 0;
      const fade = EZ.exit(seg(t, 68.4, 69.4));
      put(el, { x: pos.x, y: pos.y + Math.sin(t * 1.2 + i) * 3, z: pos.z, ry: pos.ry + (1 - p) * -110, o: p * Math.max(1 - gone, back) * (1 - fade) });
    }, el);
  });
  const wallOf = (tag) => wall.find((w) => w.tag === tag)?.pos || { x: 0, y: -200, z: -400, ry: 0 };

  // 合成池。
  const pool = mk("div", "w pool", g);
  mk("div", "pool-label", pool, `合成池<small>POOL</small>`);
  const PY = 250;
  act([38, 71], (t) => {
    const p = EZ.out(seg(t, 38.4, 39.4));
    const fade = EZ.exit(seg(t, 67.6, 68.6));
    put(pool, { x: 0, y: PY + (1 - p) * 60, z: 0, rx: (1 - p) * 25, o: p * (1 - fade) });
  }, pool);
  const slotX = (k) => -375 + k * 150;
  const DEP = data.pool.map((_, k) => 39.4 + k * 0.625);
  function departOf(tag) {
    return DEP[data.pool.indexOf(tag)];
  }

  // 牌從牆上一張張飛進池子（照拍子落地、壓一下、散一圈墨）。
  data.pool.forEach((tag, k) => {
    const el = cardEl(tag, CW, g);
    const from = wallOf(tag);
    const d = DEP[k];
    const land = d + 0.62;
    cues.push({ t: land, kind: "stamp", gain: 0.32 });
    const r = mk("div", "w ring", g);
    r.style.setProperty("--ring", `var(--suit-${suitOf(tag)})`);
    Object.assign(r.style, { width: "150px", height: "150px" });
    act([land - 0.05, land + 0.6], (t) => {
      const p = EZ.out(seg(t, land, land + 0.55));
      put(r, { x: slotX(k), y: PY, s: 0.6 + p * 0.9, o: (1 - p) * 0.8 });
    }, r);
    act([d - 0.05, 68.6], (t) => {
      const p = EZ.travel(seg(t, d, land));
      const bump = Math.sin(Math.PI * p);
      // 清空：先收成一疊，再飛回牆上。
      const g1 = EZ.out(seg(t, 64.0, 64.45));
      const g2 = EZ.inOut(seg(t, 64.45, 65.3));
      let x = quad(from.x, (from.x + slotX(k)) / 2, slotX(k), p);
      let y = quad(from.y, Math.min(from.y, PY) - 280, PY, p);
      let z = quad(from.z, 200, 0, p);
      x = lerp(x, (k - 2) * 4, g1);
      y = lerp(y, PY - k * 2, g1);
      x = lerp(x, from.x, g2);
      y = lerp(y, from.y, g2);
      z = lerp(z, from.z, g2);
      const s = (1 + bump * 0.12) * (1 + spring(t - land, 0.05, 7, 20)) * lerp(1, 0.9, g1);
      put(el, { x, y, z, ry: lerp(from.ry, 0, p) + g2 * 24, rz: bump * -7 + (k - 2) * 3 * g1, s, o: Math.min(1, seg(t, d, d + 0.05)) * (1 - seg(t, 65.1, 65.35)) });
    }, el);
  });

  // 抽並生圖：按下去、進度條、成品顯影。
  const go = mk("div", "w go", g, `抽並生圖 <small>DRAW &amp; RENDER ×1</small>`);
  cues.push({ t: 50.0, kind: "impact", gain: 0.28 });
  act([47.8, 58.6], (t) => {
    const p = EZ.out(seg(t, 48.2, 49.0));
    const press = t > 50 && t < 50.14 ? 0.94 : 1 + spring(t - 50.14, 0.04, 8, 20);
    const q = EZ.exit(seg(t, 57.6, 58.2));
    put(go, { x: 0, y: 405 + (1 - p) * 40, s: press, o: p * (1 - q) });
  }, go);
  const meterBox = mk("div", "w", g);
  const meter = mk("div", "meter", meterBox, "<i></i>");
  const mLabel = mk("div", "meter-label", meterBox);
  meterBox.style.display = "grid";
  meterBox.style.gap = "12px";
  meterBox.style.justifyItems = "center";
  act([50, 58.6], (t) => {
    const p = EZ.out(seg(t, 50.15, 50.6));
    const q = EZ.exit(seg(t, 57.6, 58.2));
    const f = EZ.inOut(seg(t, 50.4, 55.0));
    meter.firstChild.style.transform = `scaleX(${f.toFixed(3)})`;
    const step = Math.max(1, Math.round(f * 25));
    const s = f < 1 ? `繪製 ${step}/25 · ComfyUI` : "好了 · done";
    if (mLabel.textContent !== s) mLabel.textContent = s;
    put(meterBox, { x: 0, y: 490, o: p * (1 - q) });
  }, meterBox);
  const out = printEl(data.printBg, data.printFg, 440, 600, g, `<span>成品 · output</span><span>牌 5 · seed ${data.draws[0]?.seed ?? 204}</span>`);
  const shot = out.querySelector(".shot");
  act([54.4, 68.8], (t) => {
    const p = EZ.out(seg(t, 54.6, 55.6));
    const dev = EZ.inOut(seg(t, 55.0, 58.2));
    const q = EZ.exit(seg(t, 67.4, 68.4));
    shot.style.filter = `blur(${((1 - dev) * 26).toFixed(1)}px) saturate(${lerp(0.15, 1, dev).toFixed(2)}) brightness(${lerp(1.8, 1, dev).toFixed(2)})`;
    put(out, { x: 700, y: -40 + (1 - p) * 60, z: 40, ry: -10 + (1 - p) * -20, rz: 2, s: lerp(0.96, 1, dev), o: p * (1 - q) });
  }, out);

  // 偏好卡牌：托盤從底下浮上來，一張打進池子；清空時回到手上。
  const tray = mk("div", "w tray", g);
  mk("div", "tray-label", tray, `偏好卡牌 5/10<small>FAVORITES</small>`);
  const TY = 570;
  act([58, 71], (t) => {
    const p = EZ.out(seg(t, 58.4, 59.4));
    const q = EZ.exit(seg(t, 67.8, 68.8));
    put(tray, { x: 0, y: TY + (1 - p) * 260, z: 80, rx: 8, o: p * (1 - q) });
  }, tray);
  const PLAY = 2;
  const playOut = bar(24, 1) - 0.62; // 落在第 24 小節第二拍
  const playLand = bar(24, 1);
  const home = 63.9;
  const homeLand = home + 0.6;
  cues.push({ t: playLand, kind: "stamp", gain: 0.3 });
  cues.push({ t: homeLand, kind: "stamp", gain: 0.22 });
  cues.push({ t: 64.4, kind: "whoosh", gain: 0.12, dur: 0.8 });
  data.tray.forEach((tag, k) => {
    const el = cardEl(tag, 110, g);
    const fx = -300 + k * 150;
    const fr = (k - 2) * 4;
    act([58, 71], (t) => {
      const p = EZ.out(seg(t, 58.6 + k * 0.07, 59.5 + k * 0.07));
      const q = EZ.exit(seg(t, 67.8, 68.8));
      let x = fx;
      let y = TY + 28 + Math.abs(k - 2) * Math.abs(k - 2) * 5 + (1 - p) * 260;
      let z = 90;
      let rz = fr;
      let s = 1;
      if (k === PLAY) {
        const a = EZ.travel(seg(t, playOut, playLand));
        const b = EZ.travel(seg(t, home, homeLand));
        const px = slotX(5);
        x = quad(fx, (fx + px) / 2, px, a);
        y = quad(y, PY - 200, PY, a);
        z = lerp(90, 0, a);
        rz = fr * (1 - a);
        s = 1 + Math.sin(Math.PI * a) * 0.1 + spring(t - playLand, 0.05, 7, 20);
        if (b > 0) {
          x = quad(px, (fx + px) / 2, fx, b);
          y = quad(PY, PY - 160, TY + 28, b);
          z = lerp(0, 90, b);
          rz = fr * b;
          s = 1 + Math.sin(Math.PI * b) * 0.08 + spring(t - homeLand, 0.04, 7, 20);
        }
      }
      put(el, { x, y, z, rz, s, o: p * (1 - q) });
    }, el);
  });

  kinetic({ cls: "k-big", zh: "墨池", en: "MOCHI · THE CARD TABLE", x: 150, y: 470, inAt: 33.4, outAt: 38.2, st: 0.12, drift: -6 });
  caption("每一個字，都是一張牌", "Every word becomes a card", 34.4, 38.4);
  caption("放進合成池的，每張圖都一定有", "Whatever sits in the pool is in every image", 40.3, 46.8);
  caption("送去 ComfyUI，成品在這裡顯影", "Rendered by ComfyUI, developed right here", 50.5, 57.8);
  caption("偏好卡牌：最常用的十張，隨手打出", "Favorites — your ten, one tap away", 58.9, 63.4);
  caption("清空也有去處：偏好卡牌回到手上", "Clearing has a destination — favorites go back to your hand", 63.9, 68.6);
}

function buildOverprint(data) {
  const g = group(X3, 0);
  act([69, 111], () => {}, g);
  sectionTag("03", "疊印台", "OVERPRINT", 70.4, 107.4);
  const EN = { style: "STYLE", pose: "POSE", wear: "WEAR", look: "LOOK", cast: "CAST", scene: "SCENE" };
  const flatY = (i) => -345 + i * 138;
  const depthZ = (i) => (2.5 - i) * 230;
  const collapse = (t) => EZ.inOut(seg(t, 100.0, 102.4));
  const dim = (t) => EZ.inOut(seg(t, 102.2, 103.4));
  const plateOf = {};
  REGISTERS.forEach((suit, i) => {
    const el = mk("div", "w plate", g);
    el.style.setProperty("--suit", `var(--suit-${suit})`);
    mk("div", "plate-head", el, `<b>${CARD_SUIT_INFO[suit].glyph}</b><span>${REGISTER_ROLE[suit]}</span><small>${EN[suit]}</small>`);
    if (!data.rows[suit].length) mk("div", "plate-empty", el, suit === "style" ? "不罩色 · no overlay" : "空著：引擎會補 · the engine fills it");
    plateOf[suit] = { el, i };
    const a = 70.4 + i * 0.16;
    act([70, 111], (t) => {
      const p = EZ.out(seg(t, a, a + 1.1));
      const c = collapse(t);
      const fade = EZ.exit(seg(t, 107.6, 109.6));
      el.classList.toggle("is-glow", data.glow(suit, t));
      put(el, { x: lerp(-i * 30, 0, c), y: flatY(i), z: lerp(depthZ(i), 0, c) + (1 - p) * -700, o: p * (1 - fade) * lerp(1, 0.14, dim(t)) });
    }, el);
  });
  const rowPos = (suit, t) => {
    const i = plateOf[suit].i;
    const c = collapse(t);
    return { x: lerp(-i * 30, 0, c), y: flatY(i), z: lerp(depthZ(i), 0, c) };
  };

  // 你的牌：一張張落進自己花色的那一層。
  const UW = 92;
  const userX = (k) => -660 + 250 + k * 108;
  data.drops.forEach(({ tag, suit, k, at, carried }) => {
    const el = cardEl(tag, UW, g);
    cues.push({ t: at + (carried ? 0 : 0.42), kind: carried ? "chime" : "stamp", gain: carried ? 0.07 : 0.3 });
    act([at - 0.1, 111], (t) => {
      const r = rowPos(suit, t);
      const p = EZ.out(seg(t, at, at + 0.42));
      const fade = EZ.exit(seg(t, 107.6, 109.6));
      const lit = t > 95 && t < 99.9 && (tag === "kimono" || tag === "japanese clothes");
      el.classList.toggle("is-lit", lit);
      const from = carried ? { x: userX(k - 1), y: 0, z: 30 } : { x: userX(k) + 60, y: -420, z: 380 };
      put(el, {
        x: r.x + lerp(from.x, userX(k), p),
        y: r.y + lerp(from.y, 0, p),
        z: r.z + lerp(from.z, 12, p),
        rz: (1 - p) * (carried ? 0 : 14),
        s: (carried ? lerp(0.4, 1, p) : 1) + spring(t - at - 0.42, 0.05, 7, 20),
        o: Math.min(1, seg(t, at, at + 0.1)) * (1 - fade) * lerp(1, 0.14, dim(t)),
      });
    }, el);
  });

  // 引擎的影子：四張試印各一組，換試印時整排翻過去。
  const GW = 74;
  const TRIAL_AT = [80.4, bar(34, 2), bar(35, 2), bar(36, 2), bar(37, 2)]; // A→B→C→D→A
  const trialIdx = (t) => (t < TRIAL_AT[1] ? 0 : t < TRIAL_AT[2] ? 1 : t < TRIAL_AT[3] ? 2 : t < TRIAL_AT[4] ? 3 : 0);
  for (const t of TRIAL_AT.slice(1)) cues.push({ t, kind: "chime", gain: 0.06 });
  REGISTERS.forEach((suit) => {
    const ux = userX(data.rows[suit].length) + 20;
    data.trials.forEach((trial, j) => {
      (trial.rows[suit] || []).forEach((tag, k) => {
        const el = cardEl(tag, GW, g, { ghost: true });
        const gx = ux + k * 86;
        act([80, 111], (t) => {
          const r = rowPos(suit, t);
          const cur = trialIdx(t);
          const intro = EZ.out(seg(t, 80.6 + plateOf[suit].i * 0.12 + k * 0.05, 81.3 + plateOf[suit].i * 0.12 + k * 0.05));
          // 換到／換走這一組：前半轉走、後半轉進來。
          let flip = 0;
          let on = cur === j;
          for (let s = 1; s < TRIAL_AT.length; s++) {
            const sw = TRIAL_AT[s] + k * 0.03 + plateOf[suit].i * 0.02;
            if (t >= sw && t < sw + 0.36) {
              const prev = s - 1 === 0 ? 0 : s - 1;
              const next = s === 4 ? 0 : s;
              const half = t < sw + 0.18;
              if (half && prev === j) {
                on = true;
                flip = seg(t, sw, sw + 0.18) * 90;
              } else if (!half && next === j) {
                on = true;
                flip = (1 - seg(t, sw + 0.18, sw + 0.36)) * -90;
              } else on = false;
            }
          }
          const fade = EZ.exit(seg(t, 107.6, 109.6));
          const c = collapse(t);
          put(el, { x: r.x + gx, y: r.y + 6, z: r.z + 6, ry: flip + (1 - intro) * -80, o: on ? intro * (1 - fade) * lerp(1, 0.5, c) * lerp(1, 0.14, dim(t)) : 0 });
        }, el);
      });
    });
  });
  const trialEls = ["A", "B", "C", "D"].map((L, j) => {
    const el = mk("div", "w trial", g, `${L}<small>seed ${data.trials[j]?.seed ?? ""}</small>`);
    act([80, 111], (t) => {
      const p = EZ.out(seg(t, 80.3 + j * 0.1, 81.1 + j * 0.1));
      const fade = EZ.exit(seg(t, 99.6, 100.4));
      el.classList.toggle("is-on", trialIdx(t) === j);
      const c = collapse(t);
      put(el, { x: 780, y: -225 + j * 150, z: lerp(260, 0, c), s: trialIdx(t) === j ? 1.06 : 1, o: p * (1 - fade) });
    }, el);
    return el;
  });
  void trialEls;

  // 附帶的線：和服 → 和服類。
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "w rel");
  svg.setAttribute("width", "10");
  svg.setAttribute("height", "10");
  g.append(svg);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "oklch(70% 0.12 305)");
  path.setAttribute("stroke-width", "4");
  path.setAttribute("stroke-linecap", "round");
  svg.append(path);
  const relLab = mk("div", "w rel-label", g, `附帶<small>carries</small>`);
  act([94.8, 100.6], () => {}, relLab);
  const kimono = data.drops.find((d) => d.tag === "kimono");
  const jcd = data.drops.find((d) => d.tag === "japanese clothes");
  act([94.8, 100.6], (t) => {
    const r = rowPos("wear", t);
    const p = EZ.out(seg(t, 95.2, 96.3));
    const q = EZ.exit(seg(t, 99.6, 100.3));
    const x1 = r.x + userX(kimono.k);
    const x2 = r.x + userX(jcd.k);
    // 線畫在兩張牌的下面：分層的時候上面那幾塊版離鏡頭比較近，畫在上面會被擋住。
    const y = r.y + 75;
    path.setAttribute("d", `M ${x1} ${y} C ${x1} ${y + 90}, ${x2} ${y + 90}, ${x2} ${y}`);
    const len = 260;
    path.style.strokeDasharray = `${len}`;
    path.style.strokeDashoffset = String(len * (1 - p));
    svg.style.visibility = "visible";
    svg.style.transform = `translate3d(0, 0, ${(r.z + 14).toFixed(1)}px)`;
    svg.style.opacity = (1 - q).toFixed(3);
    put(relLab, { x: (x1 + x2) / 2, y: y + 120, z: r.z + 40, o: EZ.out(seg(t, 95.8, 96.5)) * (1 - q) });
  }, svg);

  // 疊合 → 閃一下 → 付印：成品從版上顯影，再晾到繩上。
  cues.push({ t: 102.5, kind: "impact", gain: 0.42 });
  const flash = $("flash");
  act([102, 104], (t) => {
    const p = seg(t, 102.45, 102.6);
    const q = EZ.out(seg(t, 102.6, 103.6));
    flash.style.opacity = (p * (1 - q) * 0.8).toFixed(3);
  }, flash);
  const line = mk("div", "w line", g);
  line.style.width = "1700px";
  const LINE_Y = -440;
  act([103.8, 111], (t) => {
    const p = EZ.out(seg(t, 104.2, 105.2));
    const fade = EZ.exit(seg(t, 107.8, 109.8));
    line.style.clipPath = `inset(0 ${((1 - p) * 50).toFixed(1)}% 0 ${((1 - p) * 50).toFixed(1)}%)`;
    put(line, { x: 0, y: LINE_Y, z: 0, o: 1 - fade });
  }, line);
  const hangs = data.hung.map(([bgTag, fgTag], k) => {
    const el = printEl(bgTag, fgTag, 210, 290, g, "");
    const peg = mk("i", "peg", el);
    void peg;
    const hx = k === 0 ? -520 : 520;
    act([104, 111], (t) => {
      const p = EZ.out(seg(t, 104.6 + k * 0.2, 105.4 + k * 0.2));
      const fade = EZ.exit(seg(t, 107.8, 109.8));
      put(el, { x: hx, y: LINE_Y + 150 + (1 - p) * -60, z: 0, rz: spring(t - 104.6 - k * 0.2, 5, 1.6, 5), o: p * (1 - fade) });
    }, el);
    return el;
  });
  void hangs;
  const main = printEl(data.printBg, data.printFg, 520, 720, g, `<span>付印 · printed</span><span>試印 A · seed ${data.trials[0]?.seed ?? ""}</span>`);
  mk("i", "peg", main);
  const mshot = main.querySelector(".shot");
  cues.push({ t: 106.25, kind: "stamp", gain: 0.25 });
  act([102.4, 111], (t) => {
    const dev = EZ.inOut(seg(t, 102.6, 105.0));
    const up = EZ.travel(seg(t, 105.2, 106.25));
    const fade = EZ.exit(seg(t, 107.8, 109.8));
    mshot.style.filter = `blur(${((1 - dev) * 26).toFixed(1)}px) saturate(${lerp(0.2, 1, dev).toFixed(2)}) brightness(${lerp(1.9, 1, dev).toFixed(2)})`;
    const hy = LINE_Y + 150 * 1.0 + 0;
    put(main, {
      x: 0,
      y: lerp(0, hy - 0, up),
      z: lerp(160, 10, up),
      s: lerp(lerp(0.9, 1, dev), 0.42, up),
      rz: spring(t - 106.25, 6, 1.7, 5.5),
      o: Math.min(1, seg(t, 102.5, 102.9)) * (1 - fade),
    });
  }, main);

  kinetic({ cls: "k-big", zh: "疊印台", en: "OVERPRINT", x: 1790, y: 250, align: "right", inAt: 70.9, outAt: 75.6, st: 0.12, drift: 6 });
  caption("一張牌，是一層墨", "Every card is a layer of ink", 71.8, 75.8);
  caption("牌自己落進它花色的那一層", "Each card falls into the layer of its suit", 76.4, 80.4);
  caption("灰色的影子：引擎替你補的牌", "Grey shadows — the cards the engine fills in", 80.9, 85.7);
  caption("四張試印，每疊一張就重抽", "Four proofs, redrawn with every card you add", 86.0, 93.9);
  caption("牌跟牌的關係，畫在版上", "Relations are drawn right on the plate", 95.1, 99.8);
  caption("疊好了，就付印", "Stack it. Then print.", 100.3, 104.7);
  caption("晾紙繩：每一張都能回到那一版", "The drying line — every print leads back to its plate", 105.1, 108.3);
}

function buildOutro(data) {
  // 牌環繞著標題轉，最後收成一疊。
  const orbit = mk("div", "orbit", hud);
  const N = data.orbit.length;
  const els = data.orbit.map((tag) => {
    const holder = cardEl(tag, 150, orbit);
    return holder;
  });
  act([107.6, 120], (t) => {
    const spin = (t - 108) * 16;
    const conv = EZ.inOut(seg(t, 115.6, 117.2));
    const fade = EZ.exit(seg(t, 117.0, 118.2));
    orbit.style.transform = `translate(0, 40px) rotateX(-10deg)`;
    els.forEach((el, i) => {
      const a = (i / N) * 360 + spin;
      const p = EZ.out(seg(t, 108.2 + i * 0.05, 109.2 + i * 0.05));
      const R = lerp(760, 0, conv);
      const rad = (a * Math.PI) / 180;
      const front = Math.max(0, Math.cos(rad));
      // 牌環在字的後面：整圈往後推、前面那幾張也淡一點，字永遠讀得到。
      put(el, { x: Math.sin(rad) * R, y: Math.cos(rad * 2) * 30 * (1 - conv), z: Math.cos(rad) * R - 900, ry: a, o: p * (1 - fade) * (0.35 + 0.35 * front), blur: (1 - front) * 3 });
    });
  }, orbit);
  kinetic({ cls: "k-title", zh: "排字匣", en: "DANBOORU CASE", x: 960, y: 420, align: "center", inAt: 109.0, outAt: 118.3, st: 0.1 });
  kinetic({ cls: "k-cap", zh: "排字匣　·　墨池　·　疊印台", en: "TAG CASE · MOCHI · OVERPRINT", x: 960, y: 640, align: "center", inAt: 110.4, outAt: 118.3, st: 0.04 });
  const cmd = "git clone https://github.com/bosen12/danbooru_tag_random";
  const mono = mk("div", "k k-mono", hud);
  mono.style.left = "960px";
  mono.style.top = "790px";
  const C0 = 112.0;
  const C1 = 114.6;
  for (let i = 0; i < cmd.length; i += 2) cues.push({ t: C0 + (i / cmd.length) * (C1 - C0), kind: "tick", gain: 0.04 });
  act([111.8, 120], (t) => {
    const k = Math.floor(seg(t, C0, C1) * cmd.length);
    const q = EZ.exit(seg(t, 118.2, 118.8));
    const tail = t > C1 + 0.5 ? `<br><span class="dim">start.bat · start-web6.bat → 127.0.0.1:8796</span>` : "";
    const caret = Math.floor(t * 2.4) % 2 ? "" : "▍";
    const html = `<span class="prompt">$</span> ${esc(cmd.slice(0, k))}${t < C1 + 0.3 ? caret : ""}${tail}`;
    if (mono.innerHTML !== html) mono.innerHTML = html;
    mono.style.transform = "translate(-50%, 0)";
    mono.style.opacity = (Math.min(1, seg(t, 111.8, 112.2)) * (1 - q)).toFixed(3);
    mono.style.textAlign = "center";
  }, mono);
  // 最後淡成黑。
  const black = mk("div", "k", hud);
  Object.assign(black.style, { left: "0", top: "0", width: "1920px", height: "1080px", background: "#000" });
  act([118.4, 121], (t) => {
    black.style.opacity = EZ.inOut(seg(t, 118.6, 119.9)).toFixed(3);
  }, black);
}

/* ---------- 轉場：墨從角落漫過來、再化開 ---------- */

function buildWipes() {
  const wipe = $("wipe");
  const W = [
    [31.3, 33.1, "0% 100%"],
    [68.3, 70.5, "100% 0%"],
  ];
  act([0, 121], (t) => {
    let shown = false;
    for (const [a, b, from] of W) {
      if (t < a || t > b) continue;
      shown = true;
      const m = a + (b - a) * 0.45;
      const grow = EZ.in(seg(t, a, m));
      const clear = EZ.out(seg(t, m, b));
      wipe.style.clipPath = `circle(${(grow * 150).toFixed(1)}% at ${from})`;
      wipe.style.opacity = (1 - clear).toFixed(3);
      wipe.style.filter = clear > 0.01 ? `blur(${(clear * 30).toFixed(1)}px)` : "";
    }
    if (!shown) wipe.style.clipPath = "circle(0% at 0% 100%)";
  });
}

/* ================= 鏡頭 ================= */

const V = (x, y, z, rx = 0, ry = 0, rz = 0) => ({ x, y, z, rx, ry, rz });
let camera = null;

function buildCamera(data) {
  const lhx = data.lhx;
  const kx = data.kx;
  camera = track([
    [0, V(X1, -40, -420, 4, -6, 0)],
    [6.2, V(X1, -40, 120, 0, 4, 0)],
    [9.8, V(X1, -40, 60, 0, 0, 0)],
    [10.6, V(X1, -80, -240, 10, -8, 0)],
    [15.0, V(X1, -60, -140, 6, 4, 0)],
    [16.6, V(X1 + 160, -10, -60, 4, -4, 0)],
    [17.5, V(lhx, 10, 200, 0, 0, -1), EZ.in],
    [19.6, V(lhx, 20, 110, 2, 0, 0), EZ.out],
    [21.2, V(kx + 40, 60, 120, 4, 2, 0)],
    [23.8, V(kx + 60, 90, 40, 6, -3, 0)],
    [25.2, V(X1, -20, -160, 2, 0, 0)],
    [29.2, V(X1, 40, -80, 0, 3, 0)],
    [31.3, V(X1, 60, -40, 0, 0, 0)],
    [32.6, V(X2 - 900, -80, -330, 2, 30, 0), EZ.inOut],
    [36.6, V(X2 - 520, -120, -170, 4, 20, 0)],
    [39.2, V(X2 - 200, 40, -60, 6, 10, 0)],
    [42.8, V(X2, 160, 40, 8, 0, 0)],
    [47.2, V(X2, 300, -20, 6, 0, 0)],
    [50.2, V(X2 + 220, 290, -80, 4, -4, 0)],
    [55.2, V(X2 + 380, 120, 10, 2, -9, 0)],
    [58.2, V(X2 + 300, 100, -60, 2, -4, 0)],
    [59.8, V(X2, 440, -60, 14, 0, 0)],
    [62.6, V(X2, 430, -10, 12, 0, 0)],
    [64.2, V(X2, 260, -90, 10, 0, 0)],
    [68.2, V(X2, 120, -220, 4, 0, 0)],
    [70.4, V(X3 + 240, -120, -1000, 24, 46, 0), EZ.inOut],
    [73.2, V(X3 + 80, -60, -720, 20, 36, 0)],
    [76.2, V(X3, -20, -580, 16, 28, 0)],
    [80.6, V(X3 + 60, 10, -560, 14, 24, 0)],
    [86.2, V(X3 + 160, 10, -580, 12, 20, -1)],
    [94.2, V(X3 + 100, 0, -540, 10, 16, 0)],
    [95.8, V(X3 - 260, -130, -60, 8, 10, 0)],
    [99.8, V(X3 - 220, -130, -90, 6, 8, 0)],
    [102.4, V(X3, 0, -300, 0, 0, 0)],
    [104.9, V(X3, 0, -200, 0, 0, 0)],
    [107.4, V(X3, -240, -320, -4, 0, 0)],
    [110.5, V(X3, -200, -1100, 0, 0, 0)],
    [120, V(X3, -200, -1300, 0, 0, 0)],
  ]);
}

/** 撞一下的鏡頭晃動。 */
function shake(t) {
  let x = 0;
  let y = 0;
  for (const [at, amp] of [[1.45, 6], [17.5, 12], [50.0, 5], [102.5, 14]]) {
    const d = t - at;
    if (d < 0 || d > 0.8) continue;
    x += spring(d, amp, 6, 47);
    y += spring(d, amp * 0.7, 6, 39);
  }
  return { x, y };
}

function renderCamera(t) {
  const c = camera(t);
  const sh = shake(t);
  world.style.transform = `translate3d(${sh.x.toFixed(2)}px, ${sh.y.toFixed(2)}px, ${c.z.toFixed(1)}px) rotateX(${c.rx.toFixed(2)}deg) rotateY(${c.ry.toFixed(2)}deg) rotateZ(${c.rz.toFixed(2)}deg) translate3d(${(-c.x).toFixed(1)}px, ${(-c.y).toFixed(1)}px, 0)`;
}

/* ================= 畫一格 ================= */

function render(t) {
  drawBg(t);
  renderCamera(t);
  for (const a of acts) {
    const on = t >= a.win[0] && t <= a.win[1];
    if (a.el) {
      const want = on ? "" : "none";
      if (a.el.style.display !== want) a.el.style.display = want;
    }
    if (on) a.update(t);
  }
}

/* ================= 開機 ================= */

async function boot() {
  const status = $("load-status");
  const loadBar = $("load-bar");
  const [data, manifest] = await Promise.all([
    fetch("lexicon.json").then((r) => r.json()),
    fetch("cards/manifest.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  ]);
  lib = buildLibrary(data, { ratingBlocked });
  assets = createAssets(manifest);
  lex = indexLexicon(data);
  settings = sanitizeSettings({ ...defaultSettings(data), rating: "general" }, data);
  await document.fonts.ready;

  // ---- 影片要用的資料 ----
  const words = pickArt(
    ["1girl", "long hair", "red hair", "kimono", "cherry blossoms", "sunset", "smile", "standing", "school uniform", "night", "city lights", "rain", "umbrella", "glasses", "hoodie", "ponytail", "twintails", "blue eyes", "dress", "beach", "snow", "sitting", "library", "cafe", "sparkle", "lantern", "starry sky", "bicycle", "braid", "hat", "cat", "window", "flower", "sky", "cloud", "forest", "river", "street"],
    34
  );
  const typed = ["1girl", "long hair", "red hair", "kimono", "standing", "cherry blossoms", "sunset"];
  const pins = ["red hair", "kimono"];
  const draws = cleanDraws(pins, 3, 1);
  const pool = pickArt(["1girl", "red hair", "kimono", "cherry blossoms", "sunset"], 5);
  const wallExtra = pickArt(
    ["smile", "standing", "school uniform", "night", "city lights", "rain", "umbrella", "glasses", "hoodie", "ponytail", "twintails", "blue eyes", "dress", "beach", "snow", "sitting", "library", "cafe", "sparkle", "lantern", "starry sky", "bicycle", "braid", "long hair", "hat", "forest", "river", "street", "window", "cloud", "flower", "short hair", "sky"],
    36 - pool.length
  );
  // 候選不夠（有些字還沒有插畫）：用其他有插畫的全年齡牌補滿，不要重複池子裡那幾張。
  for (const c of lib.cards) {
    if (wallExtra.length >= 36 - pool.length) break;
    if (!pool.includes(c.tag) && !wallExtra.includes(c.tag) && hasArt(c.tag)) wallExtra.push(c.tag);
  }
  const wall = [];
  // 池子要用的牌分散在牆的中間兩列，飛出去看得清楚。
  const slots = [10, 13, 16, 20, 23];
  let e = 0;
  for (let i = 0; i < 36; i++) {
    const pk = slots.indexOf(i);
    wall.push(pk >= 0 && pool[pk] ? pool[pk] : wallExtra[e++] || pool[0]);
  }
  const tray = pickArt(["smile", "night", "lantern", "sparkle", "umbrella", "starry sky"], 5);

  // 疊印台：真的 placeCard 一張張放（互斥、附帶都照引擎）。
  let bed = emptyBed();
  const placeOrder = ["1girl", "red hair", "long hair", "kimono", "standing", "cherry blossoms", "sunset"].filter((t) => lib.byTag.has(t));
  for (const t of placeOrder) bed = placeCard(bed, t, { lex, applyPin }).bed;
  const rows = Object.fromEntries(REGISTERS.map((s) => [s, []]));
  for (const t of bed.pins) rows[suitOf(t)].push(t);
  const DROP0 = bar(30, 2); // 76.25
  const drops = [];
  let n = 0;
  for (const t of placeOrder) {
    if (!bed.pins.includes(t)) continue;
    const suit = suitOf(t);
    drops.push({ tag: t, suit, k: rows[suit].indexOf(t), at: DROP0 + n * 0.625, carried: false });
    for (const [child, parent] of Object.entries(bed.carried)) {
      if (parent === t) drops.push({ tag: child, suit: suitOf(child), k: rows[suitOf(child)].indexOf(child), at: DROP0 + n * 0.625 + 0.45, carried: true });
    }
    n++;
  }
  const trialDraws = cleanDraws(bed.pins, 4, 1);
  const trials = trialDraws.map(({ seed, tags }) => {
    const r = Object.fromEntries(REGISTERS.map((s) => [s, []]));
    for (const t of tags) {
      if (bed.pins.includes(t) || !hasArt(t) || BAD.test(t)) continue;
      const s = suitOf(t);
      if (r[s].length < 5) r[s].push(t);
    }
    return { seed, rows: r };
  });
  const glowAt = drops.map((d) => [d.suit, d.at + 0.42]);
  const glow = (suit, t) => glowAt.some(([s, at]) => s === suit && t >= at && t < at + 0.5);
  void relationsOf;
  void contradictions;
  void ACT_PLACE;

  const chipsData = { typed, pins, draws, words, count: lib.cards.length };
  const printBg = hasArt("cherry blossoms") ? "cherry blossoms" : words[4];
  const printFg = hasArt("kimono") ? "kimono" : words[3];
  const hung = [
    [hasArt("night") ? "night" : printBg, hasArt("umbrella") ? "umbrella" : printFg],
    [hasArt("beach") ? "beach" : printBg, hasArt("dress") ? "dress" : printFg],
  ];
  const orbit = pickArt([...pool, ...tray, "school uniform", "rain", "library", "starry sky", "cafe", "snow", "hoodie", "bicycle"], 16);

  // ---- 搭景 ----
  buildOpen(words);
  buildTagCase(chipsData);
  const lh = document.querySelectorAll(".chip");
  void lh;
  buildMochi({ wall, pool, tray, printBg, printFg, draws });
  buildOverprint({ rows, drops, trials, glow, printBg, printFg, hung });
  buildOutro({ orbit });
  buildWipes();
  // 鏡頭要知道「長髮」「和服」那兩張字條擺在哪（字條是量了寬度才排的）。
  const chipX = (tag) => {
    const i = typed.indexOf(tag);
    const els = [...world.querySelectorAll(".chip")].slice(0, typed.length);
    const ws = els.map((x) => x.offsetWidth || 220);
    const total = ws.reduce((a, b) => a + b, 0) + 18 * (ws.length - 1);
    let x = -total / 2;
    for (let k = 0; k < i; k++) x += ws[k] + 18;
    return x + ws[i] / 2;
  };
  buildCamera({ lhx: X1 + chipX("long hair"), kx: X1 + chipX("kimono") });

  // ---- 等圖都載好（最多十五秒） ----
  const imgs = [...stage.querySelectorAll("img")];
  let done = 0;
  const tick = () => {
    done++;
    loadBar.style.transform = `scaleX(${(done / imgs.length).toFixed(3)})`;
    status.textContent = `載入插畫 ${done}/${imgs.length} · Loading art`;
  };
  await Promise.race([
    Promise.all(imgs.map((im) => (im.complete ? (tick(), null) : new Promise((r) => { im.addEventListener("load", () => (tick(), r()), { once: true }); im.addEventListener("error", () => (tick(), r()), { once: true }); })))),
    new Promise((r) => setTimeout(r, 15000)),
  ]);
  if (!assets.count()) status.textContent = "還沒有卡面插畫：牌會是字的佔位牌 · No card art yet — cards show placeholders";
  else status.textContent = "好了 · Ready";
  return cues;
}

/* ================= 播放控制 ================= */

let score = null;
let tPaused = 0;
let raf = 0;

const clock = () => (score && score.playing ? Math.min(LENGTH, score.now()) : tPaused);

function frame() {
  const t = clock();
  render(t);
  $("fill").style.transform = `scaleX(${(t / LENGTH).toFixed(4)})`;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  $("time").textContent = `${m}:${String(s).padStart(2, "0")} / 2:00`;
  if (t >= LENGTH - 0.01 && score?.playing) {
    score.pause();
    tPaused = LENGTH;
    showGate(true);
  }
  raf = requestAnimationFrame(frame);
}

function play(from = tPaused) {
  tPaused = from;
  score.play(from);
  $("pp").innerHTML = PAUSE_ICON;
}
function pause() {
  tPaused = clock();
  score.pause();
  $("pp").innerHTML = PLAY_ICON;
}
function seek(t) {
  const to = Math.max(0, Math.min(LENGTH - 0.05, t));
  if (score.playing) score.play(to);
  tPaused = to;
}

const PLAY_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor"/></svg>';

function showGate(replay) {
  const gate = $("gate");
  gate.classList.remove("is-gone");
  if (replay) {
    $("play").querySelector("span").textContent = "再播一次 Replay";
    tPaused = 0;
  }
}

function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `scale(${s})`;
}

let idle = 0;
function wake() {
  $("bar").classList.add("is-shown");
  $("frame").classList.remove("is-idle");
  clearTimeout(idle);
  idle = setTimeout(() => {
    $("bar").classList.remove("is-shown");
    $("frame").classList.add("is-idle");
  }, 2200);
}

async function main() {
  fit();
  addEventListener("resize", fit);
  const q = new URLSearchParams(location.search);
  tPaused = Math.max(0, Math.min(LENGTH - 1, parseFloat(q.get("t")) || 0));
  const extra = await boot();
  score = createScore(extra);
  render(tPaused);
  raf = requestAnimationFrame(frame);
  const btn = $("play");
  btn.disabled = false;
  btn.focus();
  btn.addEventListener("click", () => {
    $("gate").classList.add("is-gone");
    play(tPaused >= LENGTH - 0.1 ? 0 : tPaused);
    wake();
  });
  $("pp").innerHTML = PLAY_ICON;
  $("pp").addEventListener("click", () => (score.playing ? pause() : play()));
  $("track").addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * LENGTH);
  });
  addEventListener("mousemove", wake);
  addEventListener("keydown", (e) => {
    if ($("gate").classList.contains("is-gone") === false) return;
    if (e.key === " ") {
      e.preventDefault();
      score.playing ? pause() : play();
    } else if (e.key === "ArrowRight") seek(clock() + 5);
    else if (e.key === "ArrowLeft") seek(clock() - 5);
    else if (e.key === "f" || e.key === "F") {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
    } else if (e.key === "m" || e.key === "M") score.setMuted(!score.muted);
    else if (e.key === "r" || e.key === "R") seek(0);
    wake();
  });
  // 測試、錄影用：不出聲，直接畫某一格。
  window.__intro = {
    seek(t) {
      tPaused = t;
      render(t);
      return t;
    },
    /** 播放中跳到 t（跟拖時間軸一樣）。 */
    jump(t) {
      seek(t);
      return t;
    },
    get time() {
      return clock();
    },
    length: LENGTH,
  };
}

main();
