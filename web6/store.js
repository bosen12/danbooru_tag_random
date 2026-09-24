/** 墨池的 localStorage：合成池、廢字簍、規則、成品、字盒的篩選。讀寫失敗就當沒有。 */

const KEY = {
  pool: "mochi.pool.v1",
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

export const loadPool = () => read(KEY.pool, []);
export const savePool = (tags) => write(KEY.pool, [...tags]);
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
