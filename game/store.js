/** 本機紀錄。算分是純函式，localStorage 只在 load / save 碰。 */

export const STORE_KEY = "paizixia.game.v1";
export const HEAT_PRESETS = ["mixed", "tease", "flash", "sex"];

export function emptyRecord() {
  return { best: 0, bestStreak: 0, heatPreset: "mixed" };
}

export function sanitizeRecord(raw) {
  if (!raw || typeof raw !== "object") return emptyRecord();
  const best = Number(raw.best);
  const streak = Number(raw.bestStreak);
  const preset = String(raw.heatPreset || "");
  return {
    best: Number.isFinite(best) && best > 0 ? Math.floor(best) : 0,
    bestStreak: Number.isFinite(streak) && streak > 0 ? Math.floor(streak) : 0,
    heatPreset: HEAT_PRESETS.includes(preset) ? preset : "mixed",
  };
}

export function recordRun(prev, run) {
  const base = sanitizeRecord(prev);
  return {
    best: Math.max(base.best, Math.floor(Number(run && run.score) || 0)),
    bestStreak: Math.max(base.bestStreak, Math.floor(Number(run && run.streak) || 0)),
    heatPreset: base.heatPreset,
  };
}

export function heatsFor(preset) {
  return preset === "mixed" ? ["tease", "flash", "sex"] : [preset];
}

export function load(storage) {
  try {
    return sanitizeRecord(JSON.parse(storage.getItem(STORE_KEY) || "null"));
  } catch {
    return emptyRecord();
  }
}

export function save(storage, record) {
  try {
    storage.setItem(STORE_KEY, JSON.stringify(sanitizeRecord(record)));
  } catch {
    // 無痕模式、擋 site data 之類的。存不了就算了，不該讓遊戲掛掉。
  }
}
