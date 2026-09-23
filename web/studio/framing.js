/**
 * 鏡位要讓器具落在「面板沒蓋到的那一塊」裡。
 *
 * hotspots.js 的鏡位是手量的，量的時候只能對一個畫面比例。可是面板寬度是固定的 560px：
 * 1920 寬時只蓋掉 29%，1280 寬時蓋掉 44%，手機上變成底下 62% 的抽屜。同一組數字在
 * 1280×720 下八個器具全部有一截鑽到面板底下（手盒的右半截整個看不到）。
 *
 * 所以手量的鏡位當「角度」，實際停在哪裡由這裡依畫面算：
 *   1. 器具太大塞不進那一塊 → 沿著視線往後退（只退不進，手量的特寫不會被放大）；
 *   2. 把器具的中心平移到那一塊的中心 —— 相機和注視點一起平移，角度不變。
 *
 * 純數學：不碰 DOM。THREE 由呼叫端傳進來，Node 測試直接驗投影。
 */

/** 跟 studio.css 對齊：桌面版面板在右邊 min(560px, 100%)；760px 以下是底部 62% 的抽屜。 */
export const PANEL_MAX_PX = 560;
export const SHEET_BREAKPOINT_PX = 760;
export const SHEET_HEIGHT = 0.62;
/** 上面的麵包屑佔掉的高度（px）。 */
const HUD_TOP_PX = 60;
/** 下面那排八個功能點按鈕：一排約 950px 寬，可見區窄時折成兩排（1440 寬開著面板就是兩排）。 */
const KEYS_ROW_PX = 52;
const KEYS_WIDTH_PX = 950;
const KEYS_PAD_PX = 24;
/** 器具邊緣離可見區邊界留多少（NDC）。 */
const MARGIN = 0.06;

/** 可見區在 NDC 裡的範圍（x、y 都是 -1..1，y 向上）。 */
export function freeRegion(width, height) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const top = 1 - (2 * HUD_TOP_PX) / h;
  if (w <= SHEET_BREAKPOINT_PX) {
    // 抽屜模式：功能點那排在面板開著時藏起來（studio.css），下緣就是抽屜頂端。
    return { x0: -1 + MARGIN, x1: 1 - MARGIN, y0: -1 + 2 * SHEET_HEIGHT + MARGIN, y1: top - MARGIN };
  }
  const panel = Math.min(PANEL_MAX_PX, w);
  const rows = Math.max(1, Math.ceil(KEYS_WIDTH_PX / Math.max(1, w - panel)));
  const bottom = KEYS_PAD_PX + rows * KEYS_ROW_PX;
  return {
    x0: -1 + MARGIN,
    x1: 2 * ((w - panel) / w) - 1 - MARGIN,
    y0: -1 + (2 * bottom) / h + MARGIN,
    y1: top - MARGIN,
  };
}

function corners(box) {
  const out = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push({ x, y, z });
  return out;
}

/**
 * @param THREE three 模組
 * @param pose {position, target} 手量的鏡位
 * @param box THREE.Box3 器具的世界包圍盒
 * @param view {width, height, fov}
 * @returns {{position, target}} 新的鏡位（純物件，可以直接給 camera-controller）
 */
export function fitPose(THREE, pose, box, { width, height, fov = 42 }) {
  const region = freeRegion(width, height);
  const aspect = Math.max(1, width) / Math.max(1, height);
  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.01, 100);
  const P = new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z);
  const T = new THREE.Vector3(pose.target.x, pose.target.y, pose.target.z);
  const pts = corners(box).map((c) => new THREE.Vector3(c.x, c.y, c.z));
  const v = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const tanV = Math.tan(((fov * Math.PI) / 180) / 2);
  const regionW = region.x1 - region.x0;
  const regionH = region.y1 - region.y0;

  for (let i = 0; i < 8; i++) {
    cam.position.copy(P);
    cam.lookAt(T);
    cam.updateMatrixWorld(true);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      v.copy(p).project(cam);
      x0 = Math.min(x0, v.x);
      x1 = Math.max(x1, v.x);
      y0 = Math.min(y0, v.y);
      y1 = Math.max(y1, v.y);
    }
    const scale = Math.max((x1 - x0) / regionW, (y1 - y0) / regionH);
    if (scale > 1.002) {
      // 投影大小大約跟距離成反比：退到 scale 倍遠。
      P.sub(T).multiplyScalar(scale).add(T);
      continue;
    }
    const dx = (x0 + x1) / 2 - (region.x0 + region.x1) / 2;
    const dy = (y0 + y1) / 2 - (region.y0 + region.y1) / 2;
    if (Math.abs(dx) < 0.004 && Math.abs(dy) < 0.004) break;
    const dist = P.distanceTo(T);
    right.setFromMatrixColumn(cam.matrixWorld, 0);
    up.setFromMatrixColumn(cam.matrixWorld, 1);
    // 相機往右移 → 東西在畫面上往左。
    const shift = right
      .multiplyScalar(dx * dist * tanV * aspect)
      .add(up.multiplyScalar(dy * dist * tanV));
    P.add(shift);
    T.add(shift);
  }
  return {
    position: { x: P.x, y: P.y, z: P.z },
    target: { x: T.x, y: T.y, z: T.z },
  };
}
