/**
 * 「這次該顯示哪一個 shell」的決策，抽成純函式。
 *
 * 會影響答案的東西有四個來源：URL 參數、localStorage、裝置能力、以及本次 session
 * 是否已經被燒掉（載入超時或連續 context lost）。把它們混在 DOM 程式碼裡寫，
 * 結果就是沒有人講得清楚優先順序，而且沒辦法測。
 *
 * 優先順序（由高到低）：
 *   1. 裝置不行 → 一律平面。這一條最高，否則會陷入「進 3D → 失敗 → 回 2D →
 *      下次開又讀到 studio → 再失敗」的迴圈。
 *   2. URL 明確指定。網址是當下、明確的意圖，蓋過上次的選擇。
 *   3. localStorage 記得的上次選擇。
 *   4. 預設平面工作台。
 */

export const VIEW_MODES = {
  flat: "2d",
  studio: "studio",
};

const VALID = new Set([VIEW_MODES.flat, VIEW_MODES.studio]);

function normalize(raw) {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (VALID.has(v)) return v;
  // 常見的別名，寫錯一個字不該整個被忽略
  if (v === "flat" || v === "2" || v === "plain") return VIEW_MODES.flat;
  if (v === "3d" || v === "three" || v === "room") return VIEW_MODES.studio;
  return null;
}

/**
 * @param {object} input
 * @param {string} [input.urlParam]      ?view= 的值
 * @param {string} [input.stored]        localStorage 記得的值
 * @param {object} [input.capabilities]  { webgl, reducedData, forcedTwoD }
 * @returns {{mode: string, reason: string, forced: boolean}}
 */
export function resolveViewMode(input) {
  const opts = input || {};
  const caps = opts.capabilities || {};

  if (caps.webgl === false) {
    return { mode: VIEW_MODES.flat, reason: "這台機器沒有可用的 WebGL", forced: true };
  }
  if (caps.reducedData === true) {
    return { mode: VIEW_MODES.flat, reason: "系統要求節省流量（prefers-reduced-data）", forced: true };
  }
  if (caps.forcedTwoD === true) {
    return { mode: VIEW_MODES.flat, reason: "這次開啟已經因為 3D 載入失敗而改用平面", forced: true };
  }

  const fromUrl = normalize(opts.urlParam);
  if (fromUrl) return { mode: fromUrl, reason: "網址指定", forced: false };

  const fromStore = normalize(opts.stored);
  if (fromStore) return { mode: fromStore, reason: "沿用上次的選擇", forced: false };

  return { mode: VIEW_MODES.flat, reason: "預設是平面工作台", forced: false };
}

export function isStudio(mode) {
  return normalize(mode) === VIEW_MODES.studio;
}
