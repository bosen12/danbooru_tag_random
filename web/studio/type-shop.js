/**
 * 3D 排字台：排字匣的 3D 空間。
 *
 * 排字匣這個名字就是鉛字排版的字盒，所以這裡不是一個房間，而是一張浮在黑暗裡的
 * 活版排字台 —— 一盞工作燈照亮桌面，四周沒入黑。八個功能點全是排版工坊裡真實存在的器具，
 * 而且隱喻對得上功能：
 *
 *   手盒      抽取與結果   排字工握在手上的金屬盒，一個一個揀字進去 —— 就是「組一行 POS」
 *   活字架    字卡盒       上百格的字盒，就是詞庫本身
 *   字模櫃    底模與 LoRA  一櫃子的銅模抽屜 —— 底模就是「字體」
 *   晾紙架    作品冊       印好的校樣掛起來晾
 *   對照燈台  A／B 比較    兩張校樣並排在燈箱上
 *   印刷機    ComfyUI 設定  真正把東西「印」出來的那台機器
 *   送件籃    通訊         印好的東西送出去
 *   放大鏡    為什麼抽到    湊近看一個字
 *
 * 招牌細節：手盒裡排的是**最近一次抽到的 tag 中文名**，而且跟真的鉛字一樣左右反轉
 * （setComposed，外殼在「這張 POS」更新時呼叫）。
 *
 * 節點名稱沿用 scene.json 的 HOTSPOT_* 契約（給之後做 GLB 的美術用），所以手盒還叫
 * HOTSPOT_DRAW_SCREEN —— 換名字要動的東西比它帶來的清楚多。
 *
 * 所有 canvas 都經過 makeCanvas，Node 測試裡用替身就能把整個場景建出來、量每個鏡位。
 */

import { roundedBox } from "./room-kit.js";
import { LIGHT_ROLES } from "./performance-policy.js";
import { composeLine, STICK_SLOTS } from "./composing.js";

/* 色票：跟 2D 排字匣同一套（暖黑底、奶油紙、朱紅是唯一的強調色）。
   材質本身壓低彩度，顏色交給光 —— 工作燈下的木頭、鉛、紙。 */
const C = {
  void: 0x0b0806,
  bench: 0x2f2116,
  benchEdge: 0x1c130d,
  oak: 0x7a5434,
  oakDark: 0x4a321f,
  lead: 0x8b8e93,
  leadDark: 0x3a3c41,
  iron: 0x2a2b2e,
  brass: 0xb08a3e,
  paper: 0xe8ddc5,
  ink: 0xc8452f,
  glass: 0xcfe3f0,
};

/** 字架格子裡的字：tag 中文名裡最常出現的字，一格一個字、每格放好幾顆同一個字。 */
const CASE_GLYPHS = [
  ..."人女男髮眼服裙衣褲鞋帽手腳坐站躺跪抱看笑哭紅藍綠白黑金銀長短大小海山城街房床窗雨雪夜晨光影花貓狗劍書琴酒茶杯傘車船燈胸腰腿背臉唇耳頸肩臂指膝裸濕汗淚乳臀制校泳袍甲巾帶環襪靴領袖扣鍊耳戴拿舉跳跑游睡吃喝唱讀寫畫抽排字匣版印",
];

const defaultCanvas = (w, h) => {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

const GLYPH_FONT = '700 {px}px "Chiron Sung HK", "Noto Serif TC", "Songti TC", serif';

export function makeTypeShop(THREE, { makeCanvas = defaultCanvas } = {}) {
  const root = new THREE.Group();
  root.name = "TYPE_SHOP";

  const mat = (color, rough = 0.7, metal = 0, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  const box = (w, h, d, m, r = 0.006) => new THREE.Mesh(roundedBox(THREE, w, h, d, r), m);
  const place = (o, x, y, z, ry = 0) => {
    o.position.set(x, y, z);
    o.rotation.y = ry;
    return o;
  };
  const shadowy = (o) => {
    o.traverse((n) => {
      if (n.isMesh) {
        n.castShadow = true;
        n.receiveShadow = true;
      }
    });
    return o;
  };
  const texOf = (canvas) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };

  // --- 貼圖 ---------------------------------------------------------------------
  // 木紋粗糙度：roughness 均勻就是塑膠。
  function grainTexture(size = 256) {
    const c = makeCanvas(size, size);
    const g = c.getContext("2d");
    g.fillStyle = "rgb(150,150,150)";
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < 90; i += 1) {
      const y = (i * 37) % size;
      g.strokeStyle = `rgba(${i % 2 ? 90 : 210},${i % 2 ? 90 : 210},${i % 2 ? 90 : 210},0.18)`;
      g.lineWidth = 1 + (i % 3);
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(size * 0.3, y + 6, size * 0.6, y - 5, size, y + 2);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  /* 鉛字頂面的兩組顏色。字架的格子落在隔板陰影裡，底色要亮一點才看得出一顆顆；
     手盒在工作燈正下方，底色一亮字面就被洗成白方塊 —— 深底亮字，對比才夠。 */
  const SORT_IN_CASE = { body: "#5b5e65", edge: "#3a3c41", face: "#eef0f3" };
  const SORT_IN_LIGHT = { body: "#2a2c31", edge: "#1c1d21", face: "#f4f1ea" };

  /** 一顆鉛字的頂面：金屬、字面凸起、左右反轉（鉛字本來就是反的）。 */
  function drawSort(g, x, y, s, ch, tone = SORT_IN_CASE) {
    g.fillStyle = tone.body;
    g.fillRect(x, y, s, s);
    g.fillStyle = tone.edge;
    g.fillRect(x, y + s - s * 0.08, s, s * 0.08);
    g.fillRect(x + s - s * 0.08, y, s * 0.08, s);
    if (!ch) return;
    g.save();
    g.translate(x + s / 2, y + s / 2);
    g.scale(-1, 1);
    g.font = GLYPH_FONT.replace("{px}", String(Math.round(s * 0.74)));
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = tone.face;
    g.fillText(ch, 0, s * 0.04);
    g.restore();
  }

  // 字架格子底：每格 3×2 顆同一個字，格與格之間是木頭。
  const CASE_COLS = 16;
  const CASE_ROWS = 9;
  function caseTexture() {
    const cw = 72;
    const ch = 56;
    const c = makeCanvas(CASE_COLS * cw, CASE_ROWS * ch);
    const g = c.getContext("2d");
    g.fillStyle = "#5a3d25";
    g.fillRect(0, 0, CASE_COLS * cw, CASE_ROWS * ch);
    let k = 0;
    for (let r = 0; r < CASE_ROWS; r += 1) {
      for (let q = 0; q < CASE_COLS; q += 1) {
        const glyph = CASE_GLYPHS[k % CASE_GLYPHS.length];
        k += 7; // 跳著取，相鄰的格子不會是字典順序
        const s = 22;
        const ox = q * cw + (cw - s * 3 - 4) / 2;
        const oy = r * ch + (ch - s * 2 - 2) / 2;
        // 有些格子快用完了 —— 真的字架不會每格都滿。
        const fill = 6 - ((q * 5 + r * 3) % 4 === 0 ? 3 : 0);
        for (let i = 0; i < fill; i += 1) drawSort(g, ox + (i % 3) * (s + 2), oy + Math.floor(i / 3) * (s + 2), s, glyph);
      }
    }
    return texOf(c);
  }

  // 手盒那一行：動態的，setComposed 重畫。
  const STICK_CELL = 64;
  const stickCanvas = makeCanvas(STICK_SLOTS * STICK_CELL, STICK_CELL);
  const stickTex = texOf(stickCanvas);
  function paintStick(cells) {
    const g = stickCanvas.getContext("2d");
    g.fillStyle = "#1e2023";
    g.fillRect(0, 0, STICK_SLOTS * STICK_CELL, STICK_CELL);
    cells.forEach((cell, i) => {
      // 空鉛比字矮，頂面看起來是更深的一格。
      if (cell.space) {
        g.fillStyle = "#191a1d";
        g.fillRect(i * STICK_CELL + 2, 2, STICK_CELL - 4, STICK_CELL - 4);
      } else drawSort(g, i * STICK_CELL + 1, 1, STICK_CELL - 2, cell.ch, SORT_IN_LIGHT);
    });
    stickTex.needsUpdate = true;
  }

  // 校樣：米白紙、幾行字、一塊方形的圖版。每張不一樣。
  function proofTexture(seed) {
    const c = makeCanvas(256, 352);
    const g = c.getContext("2d");
    g.fillStyle = "#ece2cb";
    g.fillRect(0, 0, 256, 352);
    g.fillStyle = "rgba(60,40,30,0.85)";
    const imgH = 120 + (seed % 3) * 30;
    g.fillRect(28, 32, 200, imgH);
    g.fillStyle = "#c8452f";
    g.fillRect(28, 44 + imgH, 36 + (seed % 4) * 10, 6);
    g.fillStyle = "rgba(40,30,25,0.7)";
    for (let i = 0; i < 9; i += 1) g.fillRect(28, 64 + imgH + i * 16, 200 - ((i * 37 + seed * 11) % 70), 5);
    return texOf(c);
  }

  function glowTexture() {
    const c = makeCanvas(128, 128);
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,230,190,1)");
    grad.addColorStop(0.35, "rgba(255,190,120,0.35)");
    grad.addColorStop(1, "rgba(255,160,90,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return texOf(c);
  }

  const grain = grainTexture();
  const TOP = 0.92; // 桌面高度

  // --- 排字台本身 -----------------------------------------------------------------
  const benchMat = mat(C.bench, 0.62, 0, { roughnessMap: grain });
  const bench = box(3.8, 0.07, 2.0, benchMat, 0.02);
  place(bench, 0, TOP - 0.035, -0.25);
  bench.receiveShadow = true;
  root.add(bench);
  // 桌腳往下沒入黑暗，不畫地板 —— 桌子浮在工作燈的光圈裡。
  const legMat = mat(C.benchEdge, 0.8);
  for (const [x, z] of [[-1.8, 0.62], [1.8, 0.62], [-1.8, -1.12], [1.8, -1.12]]) {
    root.add(place(box(0.08, 0.9, 0.08, legMat, 0.01), x, TOP - 0.52, z));
  }

  // --- 活字架（HOTSPOT_TAG_BOX）：招牌 ------------------------------------------------
  {
    const frame = new THREE.Group();
    frame.name = "HOTSPOT_TAG_BOX";
    const oak = mat(C.oak, 0.55, 0, { roughnessMap: grain });
    const W = 1.24;
    const D = 0.74;
    const H = 0.06;
    const tray = new THREE.Group();
    // 盒底：格子裡那一片鉛字頂面。
    // 金屬度壓低：0.55 時整片反射環境光，近看格子裡的字被洗成一片白。
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.04, D - 0.04), mat(0xffffff, 0.6, 0.25, { map: caseTexture() }));
    floor.rotation.x = -Math.PI / 2;
    // 鉛字頂面的高度：真的字架裡鉛字一顆顆直立堆在格子裡，頂面離隔板上緣只有一兩公分。
    // 第一版貼在盒底（0.012）—— 跟木板同高 z-fighting，而且整片落在 4.8 公分高的隔板
    // 陰影裡，格子看起來全是空的。抬到 0.035，頂面才在工作燈照得到的地方。
    floor.position.y = 0.035;
    tray.add(floor);
    tray.add(place(box(W, 0.012, D, oak, 0.004), 0, 0.006, 0));
    // 外框四邊
    tray.add(place(box(W, H, 0.024, oak, 0.006), 0, H / 2, -D / 2 + 0.012));
    tray.add(place(box(W, H, 0.024, oak, 0.006), 0, H / 2, D / 2 - 0.012));
    tray.add(place(box(0.024, H, D, oak, 0.006), -W / 2 + 0.012, H / 2, 0));
    tray.add(place(box(0.024, H, D, oak, 0.006), W / 2 - 0.012, H / 2, 0));
    // 隔板：一百多片薄木條，用兩組 InstancedMesh 畫。
    const inner = { w: W - 0.048, d: D - 0.048 };
    const colGeo = new THREE.BoxGeometry(0.006, H * 0.8, inner.d);
    const rowGeo = new THREE.BoxGeometry(inner.w, H * 0.8, 0.006);
    const cols = new THREE.InstancedMesh(colGeo, oak, CASE_COLS - 1);
    const rows = new THREE.InstancedMesh(rowGeo, oak, CASE_ROWS - 1);
    const m4 = new THREE.Matrix4();
    for (let i = 1; i < CASE_COLS; i += 1) cols.setMatrixAt(i - 1, m4.makeTranslation(-inner.w / 2 + (inner.w * i) / CASE_COLS, H * 0.4 + 0.012, 0));
    for (let i = 1; i < CASE_ROWS; i += 1) rows.setMatrixAt(i - 1, m4.makeTranslation(0, H * 0.4 + 0.012, -inner.d / 2 + (inner.d * i) / CASE_ROWS));
    tray.add(cols, rows);
    // 字架斜放在架子上，朝排字工傾斜 —— 真的字架就是這樣擺，揀字時手不用抬高。
    tray.rotation.x = 0.42;
    tray.position.set(0, 0.32, 0);
    frame.add(tray);
    // 支架
    const legs = mat(C.oakDark, 0.7);
    // 支架頂端要剛好頂到傾斜的盒底：前緣底部 y≈0.23、後緣 y≈0.40。
    frame.add(place(box(0.05, 0.22, 0.05, legs, 0.008), -0.55, 0.11, 0.22));
    frame.add(place(box(0.05, 0.22, 0.05, legs, 0.008), 0.55, 0.11, 0.22));
    frame.add(place(box(0.05, 0.39, 0.05, legs, 0.008), -0.55, 0.195, -0.2));
    frame.add(place(box(0.05, 0.39, 0.05, legs, 0.008), 0.55, 0.195, -0.2));
    place(frame, -0.05, TOP, -0.8);
    root.add(shadowy(frame));
  }

  // --- 手盒（HOTSPOT_DRAW_SCREEN）：主角 --------------------------------------------
  const stickGroup = new THREE.Group();
  {
    stickGroup.name = "HOTSPOT_DRAW_SCREEN";
    const steel = mat(0x9a9ea5, 0.28, 0.9);
    const L = STICK_SLOTS * 0.021 + 0.05;
    stickGroup.add(place(box(L, 0.01, 0.075, steel, 0.003), 0, 0.005, 0));
    stickGroup.add(place(box(L, 0.05, 0.006, steel, 0.002), 0, 0.03, -0.035));
    stickGroup.add(place(box(0.008, 0.05, 0.075, steel, 0.002), -L / 2, 0.03, 0));
    // 可調的活動擋板（knee）與螺絲
    stickGroup.add(place(box(0.012, 0.045, 0.07, mat(0x7c8087, 0.35, 0.85), 0.003), L / 2 - 0.02, 0.03, 0));
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.02, 12), mat(C.brass, 0.3, 0.9));
    screw.rotation.z = Math.PI / 2;
    stickGroup.add(place(screw, L / 2, 0.035, 0.02));
    // 24 顆鉛字的身體（InstancedMesh）＋一張畫著字面的頂面。
    const sortGeo = new THREE.BoxGeometry(0.0195, 0.024, 0.02);
    const sorts = new THREE.InstancedMesh(sortGeo, mat(C.lead, 0.38, 0.8), STICK_SLOTS);
    const m4 = new THREE.Matrix4();
    const x0 = -L / 2 + 0.015;
    for (let i = 0; i < STICK_SLOTS; i += 1) sorts.setMatrixAt(i, m4.makeTranslation(x0 + i * 0.021, 0.022, 0.0));
    stickGroup.add(sorts);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(STICK_SLOTS * 0.021, 0.02), mat(0xffffff, 0.35, 0.6, { map: stickTex }));
    face.rotation.x = -Math.PI / 2;
    face.position.set(x0 - 0.0105 + (STICK_SLOTS * 0.021) / 2, 0.0342, 0);
    stickGroup.add(face);
    // 放大 1.35 倍：真的手盒約 30 公分，照實際比例在總覽裡只是桌上一條細線 —— 主角要一眼找得到。
    stickGroup.scale.setScalar(1.35);
    place(stickGroup, 0.05, TOP, 0.26, -0.14);
    root.add(shadowy(stickGroup));
  }
  // 手盒底下墊一張紙：讓主角從深色桌面上分出來。
  {
    const under = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.3), mat(C.paper, 0.9));
    under.receiveShadow = true;
    under.rotation.set(-Math.PI / 2, 0, 0.1);
    under.position.set(0.05, TOP + 0.001, 0.28);
    root.add(under);
  }

  // --- 放大鏡（HOTSPOT_TRACE） --------------------------------------------------------
  {
    const g = new THREE.Group();
    g.name = "HOTSPOT_TRACE";
    const brass = mat(C.brass, 0.3, 0.9);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.012, 24), brass);
    g.add(place(base, 0, 0.006, 0));
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 8), brass);
    g.add(place(rod, -0.03, 0.08, 0));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, 10, 32), brass);
    ring.rotation.x = -Math.PI / 2 + 0.35;
    g.add(place(ring, 0.01, 0.15, 0));
    const lens = new THREE.Mesh(
      new THREE.CircleGeometry(0.048, 32),
      new THREE.MeshStandardMaterial({ color: C.glass, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, envMapIntensity: 1.6 }),
    );
    lens.rotation.x = -Math.PI / 2 + 0.35;
    g.add(place(lens, 0.01, 0.15, 0));
    // 鏡片底下被看的那一顆字
    const one = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.024, 0.02), mat(C.lead, 0.38, 0.8));
    g.add(place(one, 0.012, 0.012, 0.02));
    place(g, 0.6, TOP, 0.18);
    root.add(shadowy(g));
  }

  // --- 印刷機（HOTSPOT_SETTINGS） -----------------------------------------------------
  {
    const g = new THREE.Group();
    g.name = "HOTSPOT_SETTINGS";
    const iron = mat(C.iron, 0.45, 0.75);
    g.add(place(box(0.5, 0.12, 0.38, iron, 0.02), 0, 0.06, 0));
    g.add(place(box(0.4, 0.36, 0.06, iron, 0.02), 0, 0.3, -0.12));
    g.add(place(box(0.34, 0.26, 0.02, mat(0x3a3b3f, 0.5, 0.6), 0.008), 0, 0.3, -0.08));
    // 圓形墨盤：這台機器上唯一的顏色（朱紅），也是整張桌子的強調色。
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 10), iron);
    g.add(place(post, 0, 0.57, -0.14));
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.014, 40), mat(C.ink, 0.22, 0.05, { emissive: C.ink, emissiveIntensity: 0.05 }));
    g.add(place(disc, 0, 0.68, -0.14));
    // 飛輪與拉桿
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.012, 10, 40), iron);
    wheel.rotation.y = Math.PI / 2;
    g.add(place(wheel, 0.27, 0.3, -0.05));
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 6), iron);
    spoke.rotation.x = Math.PI / 2;
    g.add(place(spoke, 0.27, 0.3, -0.05));
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.42, 8), mat(C.oakDark, 0.6));
    lever.rotation.z = -0.9;
    g.add(place(lever, -0.3, 0.36, 0.05));
    place(g, -1.28, TOP, -0.62, 0.35);
    root.add(shadowy(g));
    // 墨滾：擺在印刷機前面，滾輪上沾著朱紅。
    const brayer = new THREE.Group();
    const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.14, 20), mat(C.ink, 0.3));
    roller.rotation.z = Math.PI / 2;
    brayer.add(roller);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.16, 10), mat(C.oak, 0.5));
    handle.rotation.x = Math.PI / 2 - 0.4;
    brayer.add(place(handle, 0, 0.04, 0.09));
    root.add(shadowy(place(brayer, -0.85, TOP + 0.028, -0.18, 0.6)));
  }

  // --- 對照燈台（HOTSPOT_COMPARE） ----------------------------------------------------
  {
    const g = new THREE.Group();
    g.name = "HOTSPOT_COMPARE";
    g.add(place(box(0.52, 0.05, 0.34, mat(0x2b2c30, 0.5, 0.4), 0.012), 0, 0.025, 0));
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.28), mat(0xfff3dd, 0.6, 0, { emissive: 0xfff0d6, emissiveIntensity: 0.5 }));
    glow.rotation.x = -Math.PI / 2;
    g.add(place(glow, 0, 0.051, 0));
    for (const [x, rz, seed] of [[-0.11, 0.05, 1], [0.12, -0.04, 2]]) {
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.235), mat(0xffffff, 0.85, 0, { map: proofTexture(seed), transparent: true, opacity: 0.93 }));
      sheet.rotation.set(-Math.PI / 2, 0, rz);
      g.add(place(sheet, x, 0.053, 0));
    }
    const light = new THREE.PointLight(0xfff1dc, 0.9, 0.9, 2);
    light.userData.role = LIGHT_ROLES.accent;
    g.add(place(light, 0, 0.16, 0));
    place(g, -1.2, TOP, 0.3, 0.18);
    root.add(shadowy(g));
  }

  // --- 送件籃（HOTSPOT_MESSAGING） ----------------------------------------------------
  {
    const g = new THREE.Group();
    g.name = "HOTSPOT_MESSAGING";
    const oak = mat(C.oak, 0.6, 0, { roughnessMap: grain });
    g.add(place(box(0.38, 0.012, 0.27, oak, 0.004), 0, 0.006, 0));
    g.add(place(box(0.38, 0.06, 0.014, oak, 0.004), 0, 0.03, -0.13));
    g.add(place(box(0.38, 0.06, 0.014, oak, 0.004), 0, 0.03, 0.13));
    g.add(place(box(0.014, 0.06, 0.27, oak, 0.004), -0.183, 0.03, 0));
    g.add(place(box(0.014, 0.06, 0.27, oak, 0.004), 0.183, 0.03, 0));
    // 一疊摺好的校樣，用朱紅繩綁著。
    const paper = mat(C.paper, 0.9);
    for (let i = 0; i < 5; i += 1) g.add(place(box(0.28, 0.008, 0.19, paper, 0.002), (i % 2) * 0.01 - 0.005, 0.018 + i * 0.009, (i % 3) * 0.006, (i - 2) * 0.03));
    g.add(place(box(0.012, 0.052, 0.2, mat(C.ink, 0.5), 0.004), 0.02, 0.038, 0));
    g.add(place(box(0.29, 0.052, 0.012, mat(C.ink, 0.5), 0.004), 0, 0.038, 0.01));
    place(g, 1.02, TOP, 0.3, -0.22);
    root.add(shadowy(g));
  }

  // --- 字模櫃（HOTSPOT_MODEL_SHELF） --------------------------------------------------
  {
    const g = new THREE.Group();
    g.name = "HOTSPOT_MODEL_SHELF";
    const oak = mat(C.oakDark, 0.6, 0, { roughnessMap: grain });
    const W = 0.58;
    const H = 0.66;
    const D = 0.36;
    g.add(place(box(W, H, D, oak, 0.012), 0, H / 2, 0));
    // 4×6 個抽屜面，每個一顆銅拉手、一張字體名的小卡。
    const front = mat(C.oak, 0.55, 0, { roughnessMap: grain });
    const drawerGeo = roundedBox(THREE, W / 4 - 0.016, H / 6 - 0.016, 0.018, 0.004);
    const drawers = new THREE.InstancedMesh(drawerGeo, front, 24);
    const pulls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.009, 10, 8), mat(C.brass, 0.3, 0.9), 24);
    const cards = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.06, 0.022), mat(C.paper, 0.9), 24);
    const m4 = new THREE.Matrix4();
    let k = 0;
    for (let r = 0; r < 6; r += 1) {
      for (let q = 0; q < 4; q += 1) {
        const x = -W / 2 + (W / 4) * (q + 0.5);
        const y = (H / 6) * (r + 0.5);
        drawers.setMatrixAt(k, m4.makeTranslation(x, y, D / 2 + 0.006));
        pulls.setMatrixAt(k, m4.makeTranslation(x, y - 0.022, D / 2 + 0.02));
        cards.setMatrixAt(k, m4.makeTranslation(x, y + 0.016, D / 2 + 0.0155));
        k += 1;
      }
    }
    g.add(drawers, pulls, cards);
    // 最上面那格拉出來一半 —— 有人剛在找字體。
    const open = new THREE.Mesh(drawerGeo, front);
    g.add(place(open, -W / 2 + (W / 4) * 1.5, (H / 6) * 5.5, D / 2 + 0.07));
    place(g, 1.4, TOP, -0.66, -0.3);
    root.add(shadowy(g));
  }

  // --- 晾紙架（HOTSPOT_GALLERY） ------------------------------------------------------
  {
    const g = new THREE.Group();
    g.name = "HOTSPOT_GALLERY";
    const lineY = 1.2;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 2.3, 6), mat(0x8a7a66, 0.8));
    cord.rotation.z = Math.PI / 2;
    g.add(place(cord, 0, lineY, 0));
    const peg = mat(C.oak, 0.6);
    [-0.9, -0.46, -0.02, 0.42, 0.86].forEach((x, i) => {
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.36), mat(0xffffff, 0.85, 0, { map: proofTexture(i + 3), side: THREE.DoubleSide }));
      sheet.rotation.z = (i - 2) * 0.025;
      g.add(place(sheet, x, lineY - 0.19, 0, (i % 2 ? 1 : -1) * 0.12));
      g.add(place(box(0.012, 0.04, 0.014, peg, 0.003), x, lineY - 0.005, 0.004));
    });
    place(g, -0.55, TOP, -1.12);
    root.add(shadowy(g));
  }

  // --- 散落的東西：讓桌子看起來有人在用 ------------------------------------------------
  {
    const loose = new THREE.InstancedMesh(new THREE.BoxGeometry(0.0195, 0.024, 0.02), mat(C.lead, 0.38, 0.8), 9);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const spots = [[-0.42, 0.05], [-0.38, 0.12], [-0.46, 0.16], [0.44, -0.3], [0.52, -0.26], [-0.66, 0.4], [0.32, 0.46], [0.36, 0.5], [-0.2, 0.52]];
    spots.forEach(([x, z], i) => {
      q.setFromEuler(new THREE.Euler(i % 3 === 0 ? Math.PI / 2 : 0, i * 0.9, 0));
      loose.setMatrixAt(i, m4.compose(new THREE.Vector3(x, TOP + (i % 3 === 0 ? 0.01 : 0.012), z), q, new THREE.Vector3(1, 1, 1)));
    });
    loose.castShadow = true;
    root.add(loose);
    // 一疊白紙，放在字模櫃前面。（第一版跟放大鏡疊在同一個位置，底座插在紙堆裡。）
    const stack = mat(C.paper, 0.92);
    for (let i = 0; i < 6; i += 1) root.add(shadowy(place(box(0.3, 0.004, 0.42, stack, 0.001), 0.92, TOP + 0.002 + i * 0.004, -0.2, 0.35 + i * 0.01)));
  }

  // --- 工作燈：一盞吊燈，整張桌子唯一的主光 --------------------------------------------
  {
    const lamp = new THREE.Group();
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.2, 40, 1, true), mat(0x1d1f22, 0.4, 0.6, { side: THREE.DoubleSide }));
    lamp.add(place(shade, 0, 0.1, 0));
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1.2, 6), mat(0x111111, 0.8));
    lamp.add(place(wire, 0, 0.8, 0));
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 20, 14), mat(0xfff0d8, 0.3, 0, { emissive: 0xffd9a0, emissiveIntensity: 3 }));
    lamp.add(place(bulb, 0, 0.02, 0));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc98a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
    halo.scale.set(0.9, 0.9, 1);
    lamp.add(place(halo, 0, 0.0, 0));
    // 光圈中心對準手盒（主角），字架在光圈後半 —— 最亮的地方就是正在排的那一行。
    place(lamp, 0.05, 2.25, 0.02);
    root.add(lamp);

    const key = new THREE.SpotLight(0xffd6ab, 38, 6, 0.8, 0.6, 2);
    key.position.set(0.05, 2.2, 0.02);
    key.target.position.set(0.05, TOP, 0.0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0008;
    key.shadow.radius = 4;
    key.userData.role = LIGHT_ROLES.essential;
    root.add(key, key.target);
  }

  // 兩盞很弱的暖色補光：晾紙架在吊燈光錐外面、字模櫃的正面背對主光，
  // 沒有它們這兩個功能點在總覽裡是兩塊黑 —— 看不見的東西等於不存在。
  // 歸在 ambience：低畫質關掉時東西還在，只是暗一點。
  const galleryFill = new THREE.PointLight(0xffd9b0, 5, 2.6, 2);
  galleryFill.position.set(-0.55, 2.0, -0.35);
  galleryFill.userData.role = LIGHT_ROLES.ambience;
  const cabinetFill = new THREE.PointLight(0xffd9b0, 4, 2.2, 2);
  cabinetFill.position.set(1.05, 1.55, 0.35);
  cabinetFill.userData.role = LIGHT_ROLES.ambience;
  root.add(galleryFill, cabinetFill);

  // 環境光：暗部要看得見形狀，但不能把光圈外的黑拉亮。
  const hemi = new THREE.HemisphereLight(0x3a4252, 0x1a120c, 0.55);
  hemi.userData.role = LIGHT_ROLES.essential;
  root.add(hemi);
  // 輪廓光：冷色，從後上方來，把字架、印刷機的邊勾出來，桌子才從黑裡分得出來。
  const rim = new THREE.DirectionalLight(0x8fb2e0, 0.7);
  rim.position.set(-2.2, 3.2, -3.4);
  rim.userData.role = LIGHT_ROLES.ambience;
  root.add(rim);

  // 還沒抽過（或 POS 清空了）時手盒排著店名：它是整張桌子的主角，一條空的黑槓看起來像壞掉。
  // 排字工收工前也是這樣 —— 手盒裡留一行，不會是空的。
  const IDLE_LINE = ["排字匣"];
  paintStick(composeLine(IDLE_LINE));

  return {
    root,
    /** 抽了新的一張：把 tag 中文名排進手盒。回傳排好的那一行。 */
    setComposed(labels) {
      const cells = composeLine(labels?.length ? labels : IDLE_LINE);
      paintStick(cells);
      return cells;
    },
  };
}
