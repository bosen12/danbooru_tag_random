/**
 * 手盒：把最近一張的 tag 排成一行鉛字。
 *
 * 排字工人左手握著手盒，右手從字架上一個一個揀字放進去 —— 這正是「組一行 POS」這件事。
 * 所以 3D 排字台的主角是手盒，裡面排的就是剛抽到的那一張（tag 的中文名）。
 *
 * 排法照真的排版：
 *   字與字之間放一格空鉛；
 *   排不下的字整個留到下一行，不從中間切斷（手盒只有一行，所以就是不放）；
 *   一行排不滿的地方用空鉛補齊 —— 鉛字要塞緊才不會散，這叫「齊行」。
 *
 * 純資料，不碰 three、不碰 DOM：type-shop.js 拿它畫貼圖，測試直接驗。
 */

export const STICK_SLOTS = 24;

/** @returns {{ch: string, space: boolean}[]} 長度恆為 slots */
export function composeLine(labels, slots = STICK_SLOTS) {
  const cells = [];
  for (const raw of labels || []) {
    const chars = [...String(raw ?? "").trim()];
    if (!chars.length) continue;
    // 第一個字就比整行長：截斷，至少排得出東西。
    if (!cells.length && chars.length > slots) {
      for (const ch of chars.slice(0, slots)) cells.push({ ch, space: false });
      break;
    }
    const need = (cells.length ? 1 : 0) + chars.length;
    if (cells.length + need > slots) break;
    if (cells.length) cells.push({ ch: "", space: true });
    for (const ch of chars) cells.push({ ch, space: false });
  }
  while (cells.length < slots) cells.push({ ch: "", space: true });
  return cells;
}
