/** localStorage 存取：一局的存檔、設定、作品牆、紀錄。讀寫失敗（無痕、被擋）就當沒有，遊戲照玩。 */

const KEYS = {
  run: "zipu.run.v1",
  settings: "zipu.settings.v1",
  gallery: "zipu.gallery.v1",
  records: "zipu.records.v1",
};
const GALLERY_MAX = 160;

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
    return true;
  } catch {
    return false;
  }
}

export function loadRun() {
  const run = read(KEYS.run, null);
  return run && run.v === 1 ? run : null;
}

export function saveRun(run) {
  if (!run) return;
  write(KEYS.run, run);
}

export function clearRun() {
  try {
    localStorage.removeItem(KEYS.run);
  } catch {
    /* 沒得清就算了 */
  }
}

export const DEFAULT_SETTINGS = { sound: true, fast: false, autoPrint: true };

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
}

export function saveSettings(s) {
  write(KEYS.settings, s);
}

export function loadGallery() {
  const list = read(KEYS.gallery, []);
  return Array.isArray(list) ? list : [];
}

/** 印好的作品進作品牆。同一張（同一局同一個委託）只留一筆。 */
export function addToGallery(print, runSeed) {
  const list = loadGallery().filter((p) => p.id !== print.id);
  list.unshift({
    id: print.id,
    image: print.image,
    who: print.who,
    type: print.type,
    total: print.total,
    tags: print.tags,
    positive: print.positive,
    ante: print.ante,
    runSeed,
    date: new Date().toISOString().slice(0, 10),
  });
  write(KEYS.gallery, list.slice(0, GALLERY_MAX));
}

export function loadRecords() {
  return { runs: 0, wins: 0, bestAnte: 0, bestHand: 0, prints: 0, ...read(KEYS.records, {}) };
}

export function saveRecords(r) {
  write(KEYS.records, r);
}
