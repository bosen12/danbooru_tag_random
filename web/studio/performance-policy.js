/**
 * 效能決策，抽成純函式。
 *
 * 「什麼時候該畫一格」「畫多大」「什麼時候該降級」這三件事寫在 render loop 裡面
 * 就沒辦法測，而它們正是「網頁會不會卡死」的全部內容。這裡只算數字，
 * 真正去改 renderer 的是 performance-controller。
 */

export const QUALITY_TIERS = {
  high: "high",
  medium: "medium",
  low: "low",
};

const ORDER = [QUALITY_TIERS.high, QUALITY_TIERS.medium, QUALITY_TIERS.low];

// 4K 螢幕的 devicePixelRatio 可能是 3，照單全收等於要畫九倍的像素 ——
// 這是筆電風扇狂轉最常見的單一原因，而畫面上幾乎看不出差別。
const DPR_CAP = {
  [QUALITY_TIERS.high]: 2,
  [QUALITY_TIERS.medium]: 1.5,
  [QUALITY_TIERS.low]: 1,
};

export function clampPixelRatio(dpr, tier) {
  const cap = DPR_CAP[tier] || DPR_CAP[QUALITY_TIERS.medium];
  const raw = Number(dpr);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(raw, cap);
}

/**
 * 按需渲染：沒有動畫、也沒有任何狀態變髒的時候，一格都不要畫。
 * 一個靜止的房間每秒畫六十次，是把使用者的電池燒在一張不會變的圖上。
 */
export function shouldRender({ visible, animating, dirty } = {}) {
  if (!visible) return false;
  return !!animating || !!dirty;
}

/** fps 撐不住就降一級；已經在最低就維持，不要無限降下去。 */
export function degradeTier(tier, fps) {
  const at = ORDER.indexOf(tier);
  const cur = at < 0 ? 0 : at;
  if (!Number.isFinite(fps) || fps >= 30) return ORDER[cur];
  return ORDER[Math.min(cur + 1, ORDER.length - 1)];
}

export function tierBelow(tier) {
  const at = ORDER.indexOf(tier);
  return ORDER[Math.min((at < 0 ? 0 : at) + 1, ORDER.length - 1)];
}

/**
 * 低階模式關掉的東西。畫面會變樸素，但仍然可操作 —— 那才是重點。
 *
 * `lights` 是「這一階要留下哪些燈」。即時燈是這個場景在弱機器上最貴的東西：
 * 每多一盞，每一個像素就多算一次，而且每一種燈數組合都會讓 three 重編一次著色器。
 * 幾何反而不是問題 —— 實測 22.6k 面、114 draw call 只花 0.54ms。
 *
 * 分級的原則是「先關掉裝飾性的，留下講故事的」：
 *   essential  檯燈（主光）、螢幕（補光）、環境光。少了任何一盞房間就讀不出來。
 *   ambience   反射光、窗外月光。暗面會變死黑，但東西還看得見。
 *   accent     畫燈（spot，最貴）、層板燈。純粹是好看。
 */
export const LIGHT_ROLES = {
  essential: "essential",
  ambience: "ambience",
  accent: "accent",
};

const TIER_LIGHTS = {
  [QUALITY_TIERS.high]: [LIGHT_ROLES.essential, LIGHT_ROLES.ambience, LIGHT_ROLES.accent],
  [QUALITY_TIERS.medium]: [LIGHT_ROLES.essential, LIGHT_ROLES.ambience],
  [QUALITY_TIERS.low]: [LIGHT_ROLES.essential],
};

export function tierSettings(tier) {
  const lights = TIER_LIGHTS[tier] || TIER_LIGHTS[QUALITY_TIERS.medium];
  switch (tier) {
    case QUALITY_TIERS.low:
      return { shadows: false, antialias: false, lights, dprCap: DPR_CAP.low };
    case QUALITY_TIERS.medium:
      return { shadows: false, antialias: true, lights, dprCap: DPR_CAP.medium };
    default:
      return { shadows: true, antialias: true, lights, dprCap: DPR_CAP.high };
  }
}

/** 這一階要不要點亮這個角色的燈。 */
export function lightOnAt(tier, role) {
  return tierSettings(tier).lights.includes(role || LIGHT_ROLES.essential);
}
