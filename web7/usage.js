/**
 * 卡牌的使用次數（卡冊用）。一次＝這張牌進了一張圖：
 *   墨池每抽出一張（只抽牌、抽並生圖、同種子重印、照原樣再印都算），疊印台每付印一張。
 *   疊印台的試印不算（那是候選，不是成品）。
 * 另外記「你親手放的」次數和最後一次的時間，詳情頁用。
 *
 * 存在 localStorage（這台電腦、這個瀏覽器）。兩個房間可能同時開著：每次寫之前重新讀一次再加，
 * 不會互相蓋掉；卡冊聽 storage 事件，別的分頁抽完牌，這裡的數字跟著跳。
 *
 * 第一次（沒有紀錄時）從現有的成品牆、晾紙繩補算，不會從零開始。
 */

export const USAGE_KEY = "mochi.usage.v1";
const SHOTS_KEY = "mochi.shots.v1";
const PRINTS_KEY = "mochi.fuse.prints.v1";

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function blank() {
  return { v: 1, counts: {}, mine: {}, last: {}, seeded: false };
}

/** 讀出目前的紀錄（壞掉或沒有就是空的）。 */
export function loadUsage() {
  const u = read(USAGE_KEY, null);
  if (!u || typeof u !== "object" || !u.counts) return blank();
  return { v: 1, counts: u.counts || {}, mine: u.mine || {}, last: u.last || {}, seeded: !!u.seeded };
}

function save(u) {
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(u));
  } catch {
    /* 存不了就算了：下一次再記 */
  }
}

/** 成品的提示詞拆回一個個字：去掉權重括號 (tag:1.2)、去重。 */
export function tagsOfPositive(positive) {
  const out = new Set();
  for (const raw of String(positive || "").split(",")) {
    const t = raw.trim().replace(/^\(+/, "").replace(/(:[\d.]+)?\)+$/, "").trim();
    if (t) out.add(t);
  }
  return [...out];
}

function bump(u, tags, mine, at) {
  for (const t of new Set(tags)) {
    u.counts[t] = (u.counts[t] || 0) + 1;
    if (mine && mine.has(t)) u.mine[t] = (u.mine[t] || 0) + 1;
    if (!u.last[t] || u.last[t] < at) u.last[t] = at;
  }
}

/**
 * 記下一批成品用了哪些牌。entries：[{ tags, mine, at }]，tags 只放卡牌（呼叫端用字盒過濾過）。
 * 先補算舊紀錄（第一次才會做事），再加這一批。
 */
export function recordUses(entries, isCard) {
  const u = seedUsage(isCard);
  const now = Date.now();
  for (const e of entries) bump(u, e.tags, e.mine ? new Set(e.mine) : null, e.at || now);
  save(u);
  return u;
}

/**
 * 第一次（紀錄還沒補算過）：把成品牆、晾紙繩上還留著的成品算進來。只做一次。
 * isCard(tag)：這個字是不是一張牌（提示詞裡還有畫質詞、尾巴、LoRA 觸發詞）。
 */
export function seedUsage(isCard) {
  const u = loadUsage();
  if (u.seeded) return u;
  const ok = (t) => !isCard || isCard(t);
  const when = (s) => {
    const t = Date.parse(s && s.at);
    return Number.isFinite(t) ? t : 0;
  };
  const shots = read(SHOTS_KEY, []);
  for (const s of Array.isArray(shots) ? shots : []) {
    const tags = tagsOfPositive(s.positive).filter(ok);
    if (tags.length) bump(u, tags, new Set(s.mine || []), when(s));
  }
  const prints = read(PRINTS_KEY, []);
  for (const p of Array.isArray(prints) ? prints : []) {
    const tags = tagsOfPositive(p.positive).filter(ok);
    if (tags.length) bump(u, tags, new Set(p.mine || (p.bed && p.bed.pins) || []), when(p));
  }
  u.seeded = true;
  save(u);
  return u;
}
