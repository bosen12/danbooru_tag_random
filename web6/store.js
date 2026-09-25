/**
 * 墨池的 localStorage：廢字簍、規則、成品、字盒的篩選。讀寫失敗就當沒有。
 * 合成池不存：重新整理就是空的池子。唯一的例外是疊印台「把這一版放進墨池的合成池」——
 * 那是一次性的交接，墨池下一次打開時拿走就刪掉，放太久（30 分鐘）也不算數。
 */

const KEY = {
  pool: "mochi.pool.v1", // 舊版一直存著的合成池：讀到就刪
  handoff: "mochi.pool.handoff.v1",
  bans: "mochi.bans.v1",
  settings: "mochi.settings.v1",
  shots: "mochi.shots.v1",
  ui: "mochi.ui.v1",
};
const SHOT_MAX = 60;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 存不了就算了 */
  }
}

const HANDOFF_MS = 30 * 60 * 1000;

/** 疊印台把一版牌交給墨池：寫一張便條，墨池下次打開時拿走。 */
export const handOffPool = (tags) => write(KEY.handoff, { tags: [...tags], at: Date.now() });

/** 墨池開機時呼叫：拿走交接的牌（沒有就是空的池子），順手清掉舊版一直存著的合成池。 */
export function takePool() {
  const note = read(KEY.handoff, null);
  try {
    localStorage.removeItem(KEY.handoff);
    localStorage.removeItem(KEY.pool);
  } catch {
    /* 刪不了就算了：下一次還會再試 */
  }
  if (!note || !Array.isArray(note.tags) || !(Date.now() - note.at < HANDOFF_MS)) return [];
  return note.tags.filter((t) => typeof t === "string");
}
export const loadBans = () => read(KEY.bans, []);
export const saveBans = (tags) => write(KEY.bans, [...tags]);
export const loadSettings = () => read(KEY.settings, null);
export const saveSettings = (s) => write(KEY.settings, s);
export const loadUi = () => read(KEY.ui, {});
export const saveUi = (u) => write(KEY.ui, u);

/** 成品只存得下的欄位：預覽幀（base64）很大，不存。 */
export function saveShots(shots) {
  write(
    KEY.shots,
    shots.slice(0, SHOT_MAX).map((s) => ({
      id: s.id,
      seed: s.seed,
      positive: s.positive,
      mine: s.mine,
      drawn: s.drawn,
      missing: s.missing,
      era: s.era,
      heat: s.heat,
      width: s.width,
      height: s.height,
      rating: s.rating,
      loras: s.loras,
      ckpt: s.ckpt,
      workflowId: s.workflowId,
      image: s.image || null,
      // 伺服器那邊的出圖工作。畫到一半就重新整理的話，下次打開用它接回去（gen.js 的 resume）。
      job: s.job || null,
      live: !!s.job && (s.status === "running" || s.status === "queued"),
      status: s.status === "done" ? "done" : s.status === "drawn" ? "drawn" : s.status === "failed" ? "failed" : "stopped",
      note: s.status === "done" || s.status === "drawn" ? "" : s.note || "",
      at: s.at,
    }))
  );
}

export function loadShots() {
  const list = read(KEY.shots, []);
  return Array.isArray(list) ? list : [];
}
