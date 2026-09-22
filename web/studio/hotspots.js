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
    label: "抽取與結果",
    hint: "抽牌、POS／NEG、出圖",
    panelId: "studio-panel-draw",
    cameraPosition: { x: -0.63, y: 1.78, z: -0.04 },
    lookAtTarget: { x: 0.42, y: 1.17, z: -2.32 },
  },
  {
    id: "tags",
    objectName: "HOTSPOT_TAG_BOX",
    label: "字卡盒",
    hint: "釘選、關掉、組合",
    panelId: "studio-panel-tags",
    cameraPosition: { x: -0.66, y: 1.44, z: -1.33 },
    lookAtTarget: { x: -1.08, y: 0.88, z: -1.97 },
  },
  {
    id: "models",
    objectName: "HOTSPOT_MODEL_SHELF",
    label: "模型櫃",
    hint: "底模與 LoRA",
    panelId: "studio-panel-models",
    cameraPosition: { x: 1.2, y: 1.75, z: 0.5 },
    lookAtTarget: { x: 3.42, y: 0.95, z: -1.95 },
  },
  {
    id: "gallery",
    objectName: "HOTSPOT_GALLERY",
    label: "牆上作品",
    hint: "作品冊與配方",
    panelId: "studio-panel-gallery",
    cameraPosition: { x: -0.13, y: 2.42, z: -0.41 },
    lookAtTarget: { x: -0.97, y: 1.62, z: -3.61 },
  },
  {
    id: "compare",
    objectName: "HOTSPOT_COMPARE",
    label: "比較台",
    hint: "A／B 實驗室（尚未開放）",
    panelId: "studio-panel-compare",
    cameraPosition: { x: 0.65, y: 1.3, z: -1.17 },
    lookAtTarget: { x: 1.12, y: 0.79, z: -1.82 },
  },
  {
    id: "settings",
    objectName: "HOTSPOT_SETTINGS",
    label: "控制台",
    hint: "ComfyUI、路徑、工作流",
    panelId: "studio-panel-settings",
    cameraPosition: { x: 1.19, y: 1.34, z: -1.55 },
    lookAtTarget: { x: 1.66, y: 0.83, z: -2.2 },
  },
  {
    id: "messaging",
    objectName: "HOTSPOT_MESSAGING",
    label: "通訊裝置",
    hint: "Telegram／Discord",
    panelId: "studio-panel-messaging",
    cameraPosition: { x: -1.09, y: 1.46, z: -1.58 },
    lookAtTarget: { x: -1.59, y: 0.95, z: -2.2 },
  },
  {
    id: "trace",
    objectName: "HOTSPOT_TRACE",
    label: "分析儀",
    hint: "這個字為什麼被抽到",
    panelId: "studio-panel-trace",
    cameraPosition: { x: 0.35, y: 1.39, z: -1.64 },
    lookAtTarget: { x: 0.75, y: 0.88, z: -2.34 },
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
