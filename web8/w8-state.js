/**
 * web8 的存讀。讀寫失敗就當沒有；讀回來的形狀不對也當沒有（舊版、外掛亂寫）。
 *
 * 跟墨池（web6）共用：
 *   mochi.settings.v1   規則（分級是全站的：卡冊、作品冊看的也是這份）
 *   mochi.bans.v1       廢字簍
 *   mochi.pool.handoff.v1  卡冊、作品冊「送去墨池」留的交接便條（拿一次就刪，30 分鐘內有效；web6 store.js 的 takePool 同一套）
 * web8 自己的：
 *   mochi8.pool.v1（sessionStorage，跟著分頁）  配方：放進來的牌、份量
 *   mochi8.shots.v1   底片（印過的；只抽牌沒印的不存）
 *   mochi8.ui.v1      一次幾張、字盒花色、檢視停在哪一頁
 *   mochi8.models.v1  底模、LoRA
 */
const K = {
  settings: "mochi.settings.v1",
  bans: "mochi.bans.v1",
  handoff: "mochi.pool.handoff.v1",
  pool: "mochi8.pool.v1",
  shots: "mochi8.shots.v1",
  ui: "mochi8.ui.v1",
  models: "mochi8.models.v1",
};
export const SHOT_KEEP = 60;
const HANDOFF_MS = 30 * 60 * 1000;
// 還排著、沒送出去的：重新整理後多久之內回來還接著印（跟墨池一樣 20 分鐘）。
const WAIT_KEEP_MS = 20 * 60 * 1000;

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

function read(store, key, fallback) {
  try {
    const raw = store.getItem(key);
    if (raw == null) return fallback;
    const v = JSON.parse(raw);
    if (Array.isArray(fallback) ? !Array.isArray(v) : isObj(fallback) ? !isObj(v) : false) return fallback;
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function write(store, key, value) {
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
const local = () => globalThis.localStorage;
const session = () => globalThis.sessionStorage;

/** 抽牌的狀態（mobile-bridge.js 的 state）：規則、配方、廢字簍、份量。 */
export function loadCore() {
  const settings = read(local(), K.settings, null);
  const bans = read(local(), K.bans, []).filter((x) => typeof x === "string");
  const pool = read(session(), K.pool, {});
  const pins = Array.isArray(pool.pins) ? pool.pins.filter((x) => typeof x === "string") : [];
  const weights = isObj(pool.weights) ? Object.fromEntries(Object.entries(pool.weights).filter(([, w]) => typeof w === "number")) : {};
  return { settings, pins, bans, weights };
}

export function saveCore(core) {
  write(local(), K.settings, core.settings);
  write(local(), K.bans, core.bans);
  write(session(), K.pool, { pins: core.pins, weights: core.weights });
}

/** 卡冊、作品冊交過來的牌：拿走就刪；太舊的不算。 */
export function takeHandoff() {
  const note = read(local(), K.handoff, null);
  try {
    local().removeItem(K.handoff);
  } catch {
    /* 刪不了：下次還會再拿到，頂多重放一次 */
  }
  if (!isObj(note) || !Array.isArray(note.tags) || !(Date.now() - Number(note.at) < HANDOFF_MS)) return null;
  return {
    tags: note.tags.filter((x) => typeof x === "string"),
    weights: isObj(note.weights) ? note.weights : {},
    from: typeof note.from === "string" ? note.from : "",
  };
}

export const loadUi = () => ({ n: 1, suit: "", panel: "rules", view: "stage", ...read(local(), K.ui, {}) });
export const saveUi = (ui) => write(local(), K.ui, { n: ui.n, suit: ui.suit, panel: ui.panel, view: ui.view });

export const loadModels = () => {
  const m = read(local(), K.models, {});
  return {
    ckpt: typeof m.ckpt === "string" ? m.ckpt : "",
    loras: Array.isArray(m.loras) ? m.loras.filter((l) => isObj(l) && typeof l.file === "string") : [],
  };
};
export const saveModels = (m) => write(local(), K.models, { ckpt: m.ckpt, loras: m.loras });

/** 一張底片存檔時留的欄位：預覽幀（base64，很大）不存。 */
function serShot(s) {
  const waiting = !s.job && (s.status === "queued" || s.status === "running");
  return {
    id: s.id,
    at: s.at,
    seed: s.seed,
    positive: s.positive,
    era: s.era,
    eraLabel: s.eraLabel,
    heat: s.heat,
    rating: s.rating,
    width: s.width,
    height: s.height,
    cards: s.cards,
    missing: s.missing,
    removed: s.removed,
    pins: s.pins,
    weights: s.weights,
    ckpt: s.ckpt,
    loras: s.loras,
    image: s.image || null,
    status: s.status,
    note: s.status === "failed" ? s.note : "",
    job: s.job || null,
    waiting,
    waitedAt: waiting ? Date.now() : 0,
  };
}

export function saveShots(shots) {
  const keep = shots.filter((s) => s.status !== "drawn").slice(0, SHOT_KEEP).map(serShot);
  write(local(), K.shots, keep);
}

/**
 * 讀回底片：畫到一半的（有工作編號）交給生圖佇列接回去；還排著的、離開不久的照排；
 * 太久以前排的就算取消（不要明天打開頁面自己印起來）。
 */
export function loadShots() {
  const now = Date.now();
  return read(local(), K.shots, [])
    .filter((s) => isObj(s) && typeof s.id === "string" && typeof s.positive === "string")
    .map((s) => {
      if (s.status === "running" || s.status === "queued") {
        if (s.job) return { ...s, resume: true };
        if (s.waiting && now - (Number(s.waitedAt) || 0) < WAIT_KEEP_MS) return { ...s, requeue: true };
        return { ...s, status: "cancelled", note: "重新整理前還沒送出去" };
      }
      return s;
    });
}
