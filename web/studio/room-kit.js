/**
 * 3D 場景共用的兩個小工具：圓角方塊、環境反射。
 *
 * 場景本身在 type-shop.js（排字台）。舊房間專用的工具（窗景、螢幕畫面、光束、輝光貼片、
 * 牆面雜訊）隨房間一起拿掉了 —— 排字台的貼圖都在 type-shop.js 裡經 makeCanvas 畫，
 * Node 測試才建得出整個場景。
 *
 * 1. **圓角。** 廉價 CG 最明顯的特徵就是刀切一樣的直角 —— 真實世界裡沒有東西是
 *    完美銳角的，而邊緣那一條細細的高光正是眼睛判斷材質的主要線索。所以排字台上
 *    的器具都走 roundedBox，不用 BoxGeometry。
 *
 * 2. **環境反射不用 HDRI。** 這個專案不引進美術資產（授權、體積、離線都是麻煩），
 *    一張上冷下暖的漸層就足夠讓金屬、黃銅、鏡片有東西可以反射。
 */

/** 圓角方塊。r 是圓角半徑，會自動夾在邊長的一半以內。 */
export function roundedBox(THREE, w, h, d, r = 0.02, seg = 2) {
  const radius = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  if (!(radius > 0)) return new THREE.BoxGeometry(w, h, d);
  // 用 ExtrudeGeometry 做圓角矩形再往深度擠出去，六個邊都會有圓角。
  const shape = new THREE.Shape();
  const x = -w / 2 + radius;
  const y = -h / 2 + radius;
  const iw = w - radius * 2;
  const ih = h - radius * 2;
  shape.moveTo(x, -h / 2);
  shape.lineTo(x + iw, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, y);
  shape.lineTo(w / 2, y + ih);
  shape.quadraticCurveTo(w / 2, h / 2, x + iw, h / 2);
  shape.lineTo(x, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, y + ih);
  shape.lineTo(-w / 2, y);
  shape.quadraticCurveTo(-w / 2, -h / 2, x, -h / 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, d - radius * 2),
    bevelEnabled: true,
    bevelThickness: radius,
    bevelSize: radius,
    bevelSegments: seg,
    curveSegments: seg + 2,
    steps: 1,
  });
  geo.translate(0, 0, -(d - radius * 2) / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 環境光貼圖。給材質一點可以反射的東西 —— 沒有環境反射的 PBR 材質看起來會
 * 像塑膠，這是「簡陋」最主要的來源之一，比多邊形數重要得多。
 * 用一張上冷下暖的漸層就夠，不需要 HDRI 檔案。
 */
export function studioEnvironment(THREE, renderer) {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, "#2b3a4a");
  grad.addColorStop(0.45, "#1a1d26");
  grad.addColorStop(0.75, "#241c16");
  grad.addColorStop(1, "#0d0a08");
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return env;
}
