/**
 * 3D 工作室的功能點設定。
 *
 * 這是一張純資料表，不是一串 if/else —— 換一份 GLB 只要改 objectName 與鏡位，
 * 不必動 camera-controller，也不必動 studio-bridge。
 *
 * panelId 指的是**現有 2D 介面裡那個面板的開關**，不是新的面板。3D 只負責把鏡頭
 * 帶到定位並把既有面板叫出來；Tag 抽取、釘選、封禁、收藏、LoRA 全部還是原本那一套。
 *
 * 座標系：Y 軸向上，單位公尺，房間中心在原點。桌子沿 -Z 牆面擺，使用者站 +Z 側。
 *
 * 這組鏡位**是量出來的，不是憑感覺填的**：拿場景裡每個 HOTSPOT_ 節點的世界
 * 包圍盒算中心與尺寸，再由視角反推「讓它佔畫面 62%」的距離。所以換了 GLB
 * 之後一定要重量 —— 家具位置一動，這些數字全部作廢，鏡頭會停在牆裡或對著空地。
 * （這件事發生過：房間從 11×9 改成 8×7、桌子從 z=-0.35 移到 z=-2.2 之後，
 * 八個鏡位全部對著空氣，而畫面上不會有任何錯誤訊息。）
 *
 * 另外兩條刻意的偏移：
 *   往右平移，讓主體落在畫面左邊 —— 右邊那 560px 是面板的位置，主體停在正中間
 *   就會被自己的面板蓋住。
 *   從被檯燈照到的那一側靠過去（不是正對著燈，正對會把立體感拍平）。
 *   少了這一條，字卡盒那一格會停在它的陰影面，畫面上是一塊黑。
 *   桌上的小東西一律從上方看。檯燈在桌子後面，所以桌面物件的正面永遠是背光的，
 *   只有頂面被照亮 —— 平視過去看到的是一塊黑，俯看才看得到東西。
 */

/** GLB 裡可點擊節點的命名規則。其餘幾何一律不參與 raycast。 */
export const HOTSPOT_PREFIX = "HOTSPOT_";

export const STUDIO_HOTSPOTS = [
  {
    id: "draw",
    objectName: "HOTSPOT_DRAW_SCREEN",
    label: "手盒",
    hint: "抽牌、POS／NEG、出圖",
    panelId: "studio-panel-draw",
    cameraPosition: { x: 0.28, y: 1.69, z: 0.97 },
    lookAtTarget: { x: 0.23, y: 0.966, z: 0.28 },
  },
  {
    id: "tags",
    objectName: "HOTSPOT_TAG_BOX",
    label: "活字架",
    hint: "釘選、關掉、組合",
    panelId: "studio-panel-tags",
    cameraPosition: { x: 0.62, y: 2.0, z: 0.95 },
    lookAtTarget: { x: 0.34, y: 1.18, z: -0.79 },
  },
  {
    id: "models",
    objectName: "HOTSPOT_MODEL_SHELF",
    label: "字模櫃",
    hint: "底模與 LoRA",
    panelId: "studio-panel-models",
    cameraPosition: { x: 0.93, y: 1.86, z: 0.91 },
    lookAtTarget: { x: 1.45, y: 1.25, z: -0.66 },
  },
  {
    id: "gallery",
    objectName: "HOTSPOT_GALLERY",
    label: "晾紙架",
    hint: "作品冊與配方",
    panelId: "studio-panel-gallery",
    cameraPosition: { x: -0.57, y: 1.85, z: 1.9 },
    lookAtTarget: { x: -0.57, y: 1.93, z: -1.12 },
  },
  {
    id: "compare",
    objectName: "HOTSPOT_COMPARE",
    label: "對照燈台",
    hint: "A／B 實驗室（尚未開放）",
    panelId: "studio-panel-compare",
    cameraPosition: { x: -0.99, y: 1.85, z: 0.98 },
    lookAtTarget: { x: -1.1, y: 0.95, z: 0.3 },
  },
  {
    id: "settings",
    objectName: "HOTSPOT_SETTINGS",
    label: "印刷機",
    hint: "ComfyUI、路徑、工作流",
    panelId: "studio-panel-settings",
    cameraPosition: { x: -0.5, y: 1.9, z: 1.1 },
    lookAtTarget: { x: -1.2, y: 1.2, z: -0.64 },
  },
  {
    id: "messaging",
    objectName: "HOTSPOT_MESSAGING",
    label: "送件籃",
    hint: "Telegram／Discord",
    panelId: "studio-panel-messaging",
    cameraPosition: { x: 0.94, y: 1.67, z: 0.82 },
    lookAtTarget: { x: 1.08, y: 0.96, z: 0.3 },
  },
  {
    id: "trace",
    objectName: "HOTSPOT_TRACE",
    label: "放大鏡",
    hint: "這個字為什麼被抽到",
    panelId: "studio-panel-trace",
    cameraPosition: { x: 0.55, y: 1.36, z: 0.52 },
    lookAtTarget: { x: 0.61, y: 1.06, z: 0.18 },
  },
];

function isVec(v) {
  return !!v && Number.isFinite(Number(v.x)) && Number.isFinite(Number(v.y)) && Number.isFinite(Number(v.z));
}

/**
 * 缺欄位要指名道姓，不要靜靜壞掉。
 * 少一個 objectName 的後果是「那個東西點了沒反應」，少一個 panelId 的後果是
 * 「鏡頭過去了卻什麼都沒出現」—— 兩者在畫面上都不會報錯，所以只能在這裡抓。
 */
export function validateHotspots(list) {
  const problems = [];
  const rows = Array.isArray(list) ? list : [];
  if (!rows.length) problems.push("hotspot 清單是空的");
  const seenId = new Set();
  const seenNode = new Set();
  for (let i = 0; i < rows.length; i += 1) {
    const h = rows[i] || {};
    const who = h.id ? `hotspot「${h.id}」` : `第 ${i + 1} 個 hotspot（連 id 都沒有）`;
    if (!h.id || typeof h.id !== "string") problems.push(`${who}：缺 id`);
    else if (seenId.has(h.id)) problems.push(`${who}：id 重複`);
    else seenId.add(h.id);

    if (!h.objectName || typeof h.objectName !== "string") {
      problems.push(`${who}：缺 objectName，GLB 裡沒有節點對得上，點了不會有反應`);
    } else {
      if (!h.objectName.startsWith(HOTSPOT_PREFIX)) {
        problems.push(`${who}：objectName「${h.objectName}」不是 ${HOTSPOT_PREFIX} 開頭`);
      }
      if (seenNode.has(h.objectName)) problems.push(`${who}：objectName 重複`);
      else seenNode.add(h.objectName);
    }

    if (!h.panelId || typeof h.panelId !== "string") {
      problems.push(`${who}：缺 panelId，鏡頭會過去但不會有面板出現`);
    }
    if (!isVec(h.cameraPosition)) problems.push(`${who}：缺 cameraPosition 或數值不合法`);
    if (!isVec(h.lookAtTarget)) problems.push(`${who}：缺 lookAtTarget 或數值不合法`);
    if (isVec(h.cameraPosition) && isVec(h.lookAtTarget)) {
      const d = Math.hypot(
        h.cameraPosition.x - h.lookAtTarget.x,
        h.cameraPosition.y - h.lookAtTarget.y,
        h.cameraPosition.z - h.lookAtTarget.z,
      );
      // 相機和注視點重合時算不出朝向，three 會給出 NaN 的矩陣，畫面直接黑掉。
      if (d < 0.05) problems.push(`${who}：cameraPosition 和 lookAtTarget 幾乎重合（${d.toFixed(3)}m），算不出朝向`);
    }
    if (h.duration != null && !(Number(h.duration) > 0)) {
      problems.push(`${who}：duration 要是正數，或乾脆不要寫（由距離決定）`);
    }
  }
  return { ok: problems.length === 0, problems };
}

export function hotspotById(list, id) {
  for (const h of Array.isArray(list) ? list : []) {
    if (h && h.id === id) return h;
  }
  return null;
}

/** GLB 換了之後拿來對帳：設定表裡有、但模型裡找不到的節點。 */
export function missingNodes(list, presentNames) {
  const have = presentNames instanceof Set ? presentNames : new Set(presentNames || []);
  return (Array.isArray(list) ? list : [])
    .filter((h) => h && h.objectName && !have.has(h.objectName))
    .map((h) => h.objectName);
}
