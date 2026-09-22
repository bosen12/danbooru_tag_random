/**
 * 場景載入。這是唯一一個知道 three.js 存在的「資產」層。
 *
 * 兩條路徑、一個介面：
 *   1. scene/studio.glb 存在 → 載它。
 *   2. 不存在（現在就是這樣）→ 用程式畫一個輕量的替代房間。
 *
 * 替代房間**不是**最終視覺，它的存在只是為了讓運鏡、hotspot、面板、效能與
 * fallback 這些真正的功能現在就能跑、能測、能驗收。它刻意用和 GLB 一樣的節點命名
 * （HOTSPOT_*），所以美術把 studio.glb 放進來之後，這個檔案以外的程式一行都不用改。
 *
 * Draco / KTX2 / Meshopt 都是延後載入而且包在 try 裡：解碼器抓不到時就當作沒有，
 * 照樣用沒壓縮的資料把場景開起來，而不是整頁卡在 loading。
 */

import * as THREE from "../vendor/three/build/three.module.min.js";
import { HOTSPOT_PREFIX } from "./hotspots.js";
import { LIGHT_ROLES } from "./performance-policy.js";
import {
  roundedBox,
  glowSprite,
  cityTexture,
  studioEnvironment,
  screenTexture,
  noiseRoughness,
  lightShaft,
} from "./room-kit.js";

const SCENE_DIR = new URL("./scene/", import.meta.url).href;
const MANIFEST_URL = SCENE_DIR + "scene.json";
const LOAD_TIMEOUT_MS = 15000;

/**
 * 深夜工作室的色票。
 *
 * 整個房間只有三種光：暖色檯燈（主光，也是情緒中心）、冷色螢幕（工作光）、
 * 窗外城市（輪廓光與深度）。所有材質顏色都壓得很低彩度 —— 夜裡的房間本來
 * 就沒有顏色，顏色全部來自光。這是「半寫實」和「霓虹賽博龐克」的分界線。
 */
const PALETTE = {
  floor: 0x1c1613,
  wall: 0x231d19,
  ceiling: 0x17120f,
  desk: 0x4a3626,
  deskDark: 0x2c2018,
  metal: 0x3d4149,
  darkMetal: 0x1b1d22,
  paper: 0xd8c9ad,
  wood: 0x6b4a2f,
};

const WARM = 0xffb570;
const COOL = 0x7fb4e8;
const CITY = 0x9ec4f0;

function makeRoom(THREE_) {
  const root = new THREE_.Group();
  root.name = "STUDIO_ROOM_PLACEHOLDER";

  const mat = (color, rough = 0.8, metal = 0.0, emissive = 0x000000, eInt = 0) =>
    new THREE_.MeshStandardMaterial({
      color,
      roughness: rough,
      metalness: metal,
      emissive,
      emissiveIntensity: eInt,
    });

  // 所有家具都走圓角。邊緣那一條高光是眼睛判斷「這是實體」的主要線索。
  const rbox = (w, h, d, m, x, y, z, r = 0.015, name) => {
    const mesh = new THREE_.Mesh(roundedBox(THREE_, w, h, d, r), m);
    mesh.position.set(x, y, z);
    if (name) mesh.name = name;
    return mesh;
  };

  // --- 房間外殼 -----------------------------------------------------------
  // 比第一版小：8×7、天花板 2.8。空曠的大房間讀起來像「還沒做完」，
  // 緊湊的小房間才讀得出「有人在這裡工作」。
  const RW = 8;
  const RD = 7;
  const RH = 2.8;

  // 一張共用的雜訊當 roughnessMap。真實表面不會每一點都一樣粗糙，
  // roughness 均勻就等於高光均勻，眼睛會直接判定「塑膠」。
  const grain = noiseRoughness(THREE_);
  const grainFor = (rx, ry) => {
    const t = grain.clone();
    t.needsUpdate = true;
    t.repeat.set(rx, ry);
    return t;
  };

  const floorMat = mat(PALETTE.floor, 0.42, 0.06);
  floorMat.roughnessMap = grainFor(6, 5);
  const floor = new THREE_.Mesh(new THREE_.PlaneGeometry(RW, RD), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.name = "FLOOR";
  floor.receiveShadow = true;
  root.add(floor);

  const ceil = new THREE_.Mesh(new THREE_.PlaneGeometry(RW, RD), mat(PALETTE.ceiling, 0.98));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = RH;
  root.add(ceil);

  const wallMat = mat(PALETTE.wall, 0.94);
  wallMat.roughnessMap = grainFor(4, 2);
  const mkWall = (w, h, x, y, z, ry) => {
    const m = new THREE_.Mesh(new THREE_.PlaneGeometry(w, h), wallMat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    return m;
  };
  root.add(mkWall(RW, RH, 0, RH / 2, -RD / 2, 0));           // 後牆
  root.add(mkWall(RD, RH, -RW / 2, RH / 2, 0, Math.PI / 2)); // 左牆（開窗）
  root.add(mkWall(RD, RH, RW / 2, RH / 2, 0, -Math.PI / 2)); // 右牆

  // 踢腳線：牆和地板之間那一條，房間立刻有了「蓋出來」的感覺
  const skirt = mat(PALETTE.deskDark, 0.85);
  root.add(rbox(RW, 0.1, 0.03, skirt, 0, 0.05, -RD / 2 + 0.02, 0.008));
  root.add(rbox(0.03, 0.1, RD, skirt, -RW / 2 + 0.02, 0.05, 0, 0.008));
  root.add(rbox(0.03, 0.1, RD, skirt, RW / 2 - 0.02, 0.05, 0, 0.008));

  // --- 窗：房間唯一的「外面」 ---------------------------------------------
  // 夜景是程式畫的（幾十個亮點＋冷色漸層），不是照片。有沒有窗，決定這個空間
  // 是「一個房間」還是「一個盒子」。
  const cityTex = cityTexture(THREE_);
  const winW = 2.1;
  const winH = 1.35;
  const winY = 1.5;
  const winX = -RW / 2 + 0.06;
  const city = new THREE_.Mesh(
    new THREE_.PlaneGeometry(winW, winH),
    new THREE_.MeshBasicMaterial({ map: cityTex, toneMapped: true }),
  );
  city.position.set(winX, winY, -0.6);
  city.rotation.y = Math.PI / 2;
  root.add(city);
  // 窗框
  const frameMat = mat(PALETTE.darkMetal, 0.55, 0.45);
  for (const [w, h, dy, dz] of [
    [winH + 0.14, 0.07, winH / 2 + 0.04, 0],
    [winH + 0.14, 0.07, -winH / 2 - 0.04, 0],
  ]) {
    const bar = rbox(0.07, w, 0.09, frameMat, winX - 0.01, winY + dy - dy, -0.6, 0.01);
    bar.rotation.z = Math.PI / 2;
    bar.position.y = winY + dy;
    root.add(bar);
  }
  root.add(rbox(0.09, winH + 0.14, 0.07, frameMat, winX - 0.01, winY, -0.6 - winW / 2 - 0.04, 0.01));
  root.add(rbox(0.09, winH + 0.14, 0.07, frameMat, winX - 0.01, winY, -0.6 + winW / 2 + 0.04, 0.01));
  root.add(rbox(0.05, winH, 0.04, frameMat, winX - 0.015, winY, -0.6, 0.008)); // 中挺

  // 窗光：一片加法貼片模擬光暈，加一盞冷色平行光從窗外打進來
  const winGlow = glowSprite(THREE_, CITY, 3.4, 0.16);
  winGlow.position.set(winX + 0.5, winY, -0.6);
  root.add(winGlow);
  const moon = new THREE_.DirectionalLight(CITY, 1.1);
  moon.userData.role = LIGHT_ROLES.ambience;
  moon.position.set(-6, 3.2, -1.2);
  moon.target.position.set(0.5, 0.8, -0.6);
  root.add(moon, moon.target);

  // --- 桌 -----------------------------------------------------------------
  const deskMat = mat(PALETTE.desk, 0.52, 0.02);
  deskMat.roughnessMap = grainFor(3, 1);
  const DESK_Y = 0.75;
  const desk = rbox(3.6, 0.06, 1.1, deskMat, 0, DESK_Y, -2.2, 0.02, "DESK_TOP");
  desk.castShadow = desk.receiveShadow = true;
  root.add(desk);
  // 桌腳：兩片側板，比四根柱子安靜
  const legMat = mat(PALETTE.deskDark, 0.7);
  for (const x of [-1.68, 1.68]) {
    const leg = rbox(0.05, DESK_Y - 0.02, 1.0, legMat, x, (DESK_Y - 0.02) / 2, -2.2, 0.012);
    leg.castShadow = true;
    root.add(leg);
  }
  root.add(rbox(3.3, 0.04, 0.05, legMat, 0, 0.12, -2.2, 0.01));

  // --- 螢幕（HOTSPOT_DRAW_SCREEN） ---------------------------------------
  const SCR_Y = 1.17;
  const SCR_Z = -2.52;
  const bezel = rbox(1.62, 0.98, 0.045, mat(PALETTE.darkMetal, 0.42, 0.55), 0, SCR_Y, SCR_Z, 0.012);
  root.add(bezel);
  // 螢幕上畫的是排字匣自己的輪廓。把它當自發光貼圖用 —— 螢幕是自己會亮的，
  // 靠打光照出來的螢幕永遠像一塊反光的板子。
  const scrTex = screenTexture(THREE_);
  const screenMat = new THREE_.MeshStandardMaterial({
    color: 0x0b1018,
    // 0.26 等於把螢幕做成鏡子：反射光在面板上燒出一塊蓋住三分之一畫面的白斑。
    // 霧面面板大約在 0.5～0.6，這樣才看得到上面畫的東西。
    roughness: 0.55,
    metalness: 0.0,
    map: scrTex,
    emissive: 0xffffff,
    emissiveMap: scrTex,
    // 深色 UI 的螢幕在暗房裡仍然很亮 —— 背光是開著的。0.95 的時候整面暗下去，
    // 房間就少了一個光源，構圖也塌了。
    emissiveIntensity: 3.0,
  });
  const screen = rbox(1.5, 0.86, 0.05, screenMat, 0, SCR_Y, SCR_Z + 0.012, 0.006, HOTSPOT_PREFIX + "DRAW_SCREEN");
  root.add(screen);
  // 螢幕的光暈：兩片貼片，一大一小，讓亮面「溢」出邊框
  const scrGlow = glowSprite(THREE_, COOL, 2.9, 0.22);
  scrGlow.position.set(0, SCR_Y, SCR_Z - 0.06);
  root.add(scrGlow);
  // 腳架
  root.add(rbox(0.16, 0.3, 0.1, mat(PALETTE.darkMetal, 0.4, 0.6), 0, 0.92, SCR_Z + 0.02, 0.02));
  root.add(rbox(0.5, 0.025, 0.2, mat(PALETTE.darkMetal, 0.4, 0.6), 0, DESK_Y + 0.045, SCR_Z + 0.06, 0.012));

  // --- 桌面雜物 -----------------------------------------------------------
  const kbMat = mat(0x1a1c21, 0.62, 0.15);
  root.add(rbox(0.66, 0.018, 0.22, kbMat, -0.06, DESK_Y + 0.04, -1.98, 0.006));
  const mouse = new THREE_.Mesh(new THREE_.SphereGeometry(0.045, 12, 8), kbMat);
  mouse.scale.set(1, 0.55, 1.45);
  mouse.position.set(0.48, DESK_Y + 0.05, -1.97);
  root.add(mouse);

  const mug = new THREE_.Mesh(new THREE_.CylinderGeometry(0.048, 0.044, 0.1, 18), mat(0x8a7362, 0.72));
  mug.position.set(-0.78, DESK_Y + 0.08, -1.9);
  mug.castShadow = true;
  root.add(mug);
  const coffee = new THREE_.Mesh(new THREE_.CylinderGeometry(0.042, 0.042, 0.005, 16), mat(0x241611, 0.3, 0.1));
  coffee.position.set(-0.78, DESK_Y + 0.126, -1.9);
  root.add(coffee);

  // --- 檯燈：主光，也是整個房間的情緒中心 --------------------------------
  //
  // 燈臂要伸到桌面上方、往使用者這一側探出去 —— 真的檯燈就是這樣擺的。
  // 第一版把燈頭留在靠牆那側，結果桌上每一樣東西都是背光的：字卡盒、控制台、
  // 分析儀從正面看全部是一塊黑，運鏡貼近之後特別明顯。
  // 燈頭往前挪 0.45m，桌面物件的頂面和正面就都吃得到光。
  const lampMat = mat(0x2e2823, 0.5, 0.4);
  const LX = -1.45;
  const LZ = -2.42;
  const HEAD = { x: LX + 0.12, y: DESK_Y + 0.66, z: LZ + 0.46 };
  const lampBase = new THREE_.Mesh(new THREE_.CylinderGeometry(0.11, 0.12, 0.022, 20), lampMat);
  lampBase.position.set(LX, DESK_Y + 0.05, LZ);
  root.add(lampBase);
  const pole = new THREE_.Mesh(new THREE_.CylinderGeometry(0.012, 0.012, 0.66, 10), lampMat);
  pole.position.set(LX, DESK_Y + 0.38, LZ);
  root.add(pole);
  // 燈臂：沿著 Z 往前伸
  const arm = new THREE_.Mesh(new THREE_.CylinderGeometry(0.011, 0.011, 0.5, 10), lampMat);
  arm.position.set(LX + 0.06, DESK_Y + 0.7, LZ + 0.23);
  arm.rotation.set(Math.PI / 2, 0, -0.22);
  root.add(arm);
  const shade = new THREE_.Mesh(
    new THREE_.ConeGeometry(0.115, 0.17, 20, 1, true),
    new THREE_.MeshStandardMaterial({ color: 0x33291f, roughness: 0.6, metalness: 0.35, side: THREE_.DoubleSide }),
  );
  shade.position.set(HEAD.x, HEAD.y, HEAD.z);
  // 不要轉 180°：ConeGeometry 預設寬口就朝下，轉了會變成一只高腳杯。
  // 只留一點點前傾，燈罩才像是朝桌面照的。
  shade.rotation.set(0.26, 0, 0);
  root.add(shade);
  const bulb = new THREE_.Mesh(new THREE_.SphereGeometry(0.03, 12, 10), mat(0x000000, 1, 0, WARM, 3.0));
  bulb.position.set(HEAD.x, HEAD.y - 0.06, HEAD.z + 0.02);
  root.add(bulb);
  const lampGlow = glowSprite(THREE_, WARM, 0.8, 0.62);
  lampGlow.position.copy(bulb.position);
  root.add(lampGlow);
  // 空氣裡看得見的那道光。「夜晚房間」最有感的一樣東西，而它幾乎不花成本。
  const shaft = lightShaft(THREE_, WARM, 0.1, 0.52, HEAD.y - DESK_Y - 0.04, 0.05);
  shaft.position.set(HEAD.x, DESK_Y + (HEAD.y - DESK_Y) / 2, HEAD.z);
  root.add(shaft);

  // --- 字卡盒（HOTSPOT_TAG_BOX） -----------------------------------------
  const boxMat = mat(PALETTE.wood, 0.58, 0.02);
  const tagBox = rbox(0.44, 0.2, 0.3, boxMat, -1.22, DESK_Y + 0.13, -1.88, 0.02, HOTSPOT_PREFIX + "TAG_BOX");
  tagBox.castShadow = true;
  root.add(tagBox);
  const cardMat = mat(PALETTE.paper, 0.92);
  for (let i = 0; i < 5; i += 1) {
    const card = rbox(0.36, 0.13, 0.008, cardMat, -1.22, DESK_Y + 0.27, -1.96 + i * 0.033, 0.004);
    card.rotation.x = -0.06 + i * 0.012;
    root.add(card);
  }

  // --- 模型櫃（HOTSPOT_MODEL_SHELF） -------------------------------------
  const SHX = 2.62;
  const shelfMat = mat(PALETTE.deskDark, 0.78);
  // 開放式層架，不是一個實心方塊。第一版是實心的，於是書和層板全部被封在
  // 盒子裡面 —— 畫面上只看到一根柱子，而那正是「簡陋」的樣子。
  // 整個做成 Group 並把名字掛在 Group 上：raycast 會遞迴到子節點，
  // 再往上找回這個名字，所以點架上任何一個地方都算點到模型櫃。
  const shelf = new THREE_.Group();
  shelf.name = HOTSPOT_PREFIX + "MODEL_SHELF";
  // 深度 0.42：書架就是這個深度。第一版做了 1.15m，書全部縮在最前面一小段，
  // 後面是一大塊看不到底的黑洞。
  shelf.add(rbox(0.9, 1.9, 0.03, shelfMat, 0, 0, -0.2, 0.008));    // 背板
  shelf.add(rbox(0.03, 1.9, 0.42, shelfMat, -0.44, 0, 0, 0.008));  // 左側板
  shelf.add(rbox(0.03, 1.9, 0.42, shelfMat, 0.44, 0, 0, 0.008));   // 右側板
  shelf.add(rbox(0.9, 0.03, 0.42, shelfMat, 0, 0.94, 0, 0.008));   // 頂板
  const plank = mat(0x54463a, 0.72);
  for (let i = 0; i < 3; i += 1) {
    shelf.add(rbox(0.86, 0.022, 0.4, plank, 0, -0.62 + i * 0.44, 0, 0.006));
  }
  shelf.position.set(SHX + 0.35, 0.95, -2.35);
  shelf.rotation.y = -0.16;
  shelf.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  root.add(shelf);
  // 書背要朝開口（+Z），所以薄的那一邊是 X、深的那一邊是 Z。
  // 一排沿著 X 並列，這才是書架上的書該有的樣子。
  const bookMats = [0x6b5a74, 0x4d6258, 0x7a5a3e, 0x46536a, 0x5e4a4a].map((c) => mat(c, 0.86));
  for (let r = 0; r < 3; r += 1) {
    for (let i = 0; i < 11; i += 1) {
      const hh = 0.24 + ((i * 5 + r * 3) % 4) * 0.022;
      const bw = 0.045 + ((i * 3 + r) % 3) * 0.012;
      const b = rbox(bw, hh, 0.3, bookMats[(i + r * 2) % 5], -0.4 + i * 0.075, -0.6 + r * 0.44 + hh / 2, 0.02, 0.004);
      // 最後一本靠著前一本斜放 —— 整排都立得筆直反而不像有人在用
      if (i === 9) b.rotation.z = 0.16;
      b.castShadow = true;
      shelf.add(b);
    }
  }
  // 層板燈。右側原本整個埋在暗部，書和層架完全讀不出來 —— 而模型櫃是一個
  // 可以點的功能點，看不見的東西沒有人會去點。
  for (let i = 0; i < 2; i += 1) {
    const strip = new THREE_.PointLight(0xffd9b0, 5.5, 1.7, 2);
    strip.userData.role = LIGHT_ROLES.accent;
    strip.position.set(SHX + 0.3, 0.74 + i * 0.86, -2.02);
    root.add(strip);
  }

  // 最上層放兩個會呼吸的指示燈，像外接硬碟
  for (let i = 0; i < 2; i += 1) {
    shelf.add(rbox(0.26, 0.08, 0.17, mat(PALETTE.darkMetal, 0.45, 0.5), -0.24 + i * 0.5, 0.76, 0.02, 0.012));
    shelf.add(rbox(0.012, 0.01, 0.012, mat(0x000000, 1, 0, i ? 0x4fd0a0 : 0x4fa0d0, 4), -0.24 + i * 0.5, 0.76, 0.11, 0.003));
  }

  // --- 作品牆（HOTSPOT_GALLERY） -----------------------------------------
  const GZ = -RD / 2 + 0.04;
  const artFrame = mat(0x14110e, 0.8);
  const mkArt = (w, h, x, y, tint, ei) => {
    const g = new THREE_.Group();
    g.add(rbox(w + 0.06, h + 0.06, 0.03, artFrame, 0, 0, 0, 0.008));
    g.add(rbox(w, h, 0.032, mat(tint, 0.62, 0.02, tint, ei), 0, 0, 0.004, 0.004));
    g.position.set(x, y, GZ);
    return g;
  };
  const gallery = mkArt(0.82, 1.08, -1.55, 1.62, 0x3b3350, 0.85);
  gallery.name = HOTSPOT_PREFIX + "GALLERY";
  root.add(gallery);
  root.add(mkArt(0.5, 0.38, -2.42, 1.92, 0x37414f, 0.5));
  root.add(mkArt(0.5, 0.5, -2.42, 1.38, 0x4a3f4e, 0.45));
  // 畫燈：一盞很窄的暖光打在作品牆上，房間的第二個視覺落點
  // SpotLight 是這裡最貴的一盞（多一組錐形衰減計算），所以歸在純裝飾那一階。
  const artLight = new THREE_.SpotLight(0xffd7a8, 26, 3.6, 0.6, 0.65, 1.4);
  artLight.userData.role = LIGHT_ROLES.accent;
  artLight.position.set(-1.75, 2.62, GZ + 0.85);
  artLight.target.position.set(-1.75, 1.6, GZ);
  root.add(artLight, artLight.target);

  // 右牆掛一塊軟木板。右半邊原本只有一面空牆，重量整個偏到左邊去。
  const cork = rbox(0.9, 0.62, 0.03, mat(0x4a3b2a, 0.95), RW / 2 - 0.05, 1.6, -1.5, 0.01);
  cork.rotation.y = -Math.PI / 2;
  root.add(cork);
  const noteCols = [0xd8c9ad, 0xc9b98f, 0xbfae95];
  for (let i = 0; i < 5; i += 1) {
    const n = rbox(0.16, 0.16, 0.006, mat(noteCols[i % 3], 0.95), RW / 2 - 0.07, 1.78 - (i % 2) * 0.3, -1.76 + i * 0.13, 0.003);
    n.rotation.y = -Math.PI / 2;
    n.rotation.x = (i % 3) * 0.05 - 0.05;
    root.add(n);
  }

  // --- 比較台（HOTSPOT_COMPARE） -----------------------------------------
  const compare = rbox(0.5, 0.022, 0.34, mat(PALETTE.metal, 0.35, 0.65), 0.98, DESK_Y + 0.04, -1.92, 0.01, HOTSPOT_PREFIX + "COMPARE");
  compare.rotation.x = -0.14;
  compare.castShadow = true;
  root.add(compare);
  const cmpScreen = rbox(0.45, 0.012, 0.29, mat(0x0c1016, 0.3, 0.05, 0x1b3350, 0.75), 0.98, DESK_Y + 0.052, -1.925, 0.006);
  cmpScreen.rotation.x = -0.14;
  root.add(cmpScreen);

  // --- 控制台（HOTSPOT_SETTINGS） ----------------------------------------
  const console_ = rbox(0.42, 0.1, 0.24, mat(PALETTE.metal, 0.48, 0.55), 1.52, DESK_Y + 0.08, -2.3, 0.016, HOTSPOT_PREFIX + "SETTINGS");
  console_.castShadow = true;
  root.add(console_);
  const ledCols = [0x5fd08a, 0xd9b45c, 0x5f9fd0];
  for (let i = 0; i < 3; i += 1) {
    root.add(rbox(0.032, 0.014, 0.032, mat(0x000000, 1, 0, ledCols[i], 2.6), 1.42 + i * 0.1, DESK_Y + 0.132, -2.3, 0.006));
  }
  const knob = new THREE_.Mesh(new THREE_.CylinderGeometry(0.03, 0.03, 0.022, 14), mat(0x2a2d33, 0.4, 0.7));
  knob.position.set(1.66, DESK_Y + 0.14, -2.3);
  root.add(knob);

  // --- 通訊裝置（HOTSPOT_MESSAGING） -------------------------------------
  const dock = rbox(0.17, 0.035, 0.12, mat(PALETTE.darkMetal, 0.5, 0.4), -1.72, DESK_Y + 0.05, -2.06, 0.01);
  root.add(dock);
  const phone = rbox(0.14, 0.27, 0.014, mat(0x0d1119, 0.3, 0.3, 0x2a4a72, 1.0), -1.72, DESK_Y + 0.2, -2.09, 0.012, HOTSPOT_PREFIX + "MESSAGING");
  phone.rotation.x = -0.22;
  root.add(phone);

  // --- 分析儀（HOTSPOT_TRACE） -------------------------------------------
  const trace = rbox(0.32, 0.2, 0.2, mat(0x252a26, 0.55, 0.3), 0.6, DESK_Y + 0.13, -2.42, 0.018, HOTSPOT_PREFIX + "TRACE");
  root.add(trace);
  const traceFace = rbox(0.24, 0.12, 0.012, mat(0x0a120c, 0.3, 0.05, 0x3f8f5f, 1.1), 0.6, DESK_Y + 0.15, -2.315, 0.005);
  root.add(traceFace);

  // --- 椅子 ---------------------------------------------------------------
  // 偏左、轉角、推開。擺正中間會擋住桌面中央，而那裡是所有可點的東西。
  const chair = new THREE_.Group();
  const chairMat = mat(0x24262c, 0.66, 0.12);
  chair.add(rbox(0.46, 0.06, 0.44, chairMat, 0, 0.44, 0, 0.02));
  const back = rbox(0.44, 0.46, 0.055, chairMat, 0, 0.7, 0.2, 0.025);
  back.rotation.x = -0.14;
  chair.add(back);
  chair.add(rbox(0.06, 0.4, 0.06, mat(0x191b20, 0.5, 0.5), 0, 0.22, 0, 0.02));
  const cbase = new THREE_.Mesh(new THREE_.CylinderGeometry(0.24, 0.26, 0.03, 16), mat(0x191b20, 0.5, 0.5));
  cbase.position.set(0, 0.025, 0);
  chair.add(cbase);
  chair.position.set(-0.86, 0, -1.02);
  chair.rotation.y = 0.42;
  chair.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  root.add(chair);

  // --- 地毯 ---------------------------------------------------------------
  const rug = new THREE_.Mesh(new THREE_.PlaneGeometry(3.4, 2.0), mat(0x2a211c, 0.99));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-0.1, 0.004, -1.5);
  rug.receiveShadow = true;
  root.add(rug);

  // --- 燈光 ---------------------------------------------------------------
  // 環境光壓得很低。夜裡房間的層次全在「暗部還看得見形狀」，
  // 但暗部不該是純黑 —— 純黑是資訊遺失，不是氣氛。
  // three r155 之後燈光用物理單位，同樣的數字比舊版暗得多；這裡的強度是
  // 配 ACES ＋ exposure 1.35 調出來的，不是憑印象填的。
  const amb = new THREE_.HemisphereLight(0x35405a, 0x120e0b, 0.65);
  amb.userData.role = LIGHT_ROLES.essential;
  root.add(amb);

  // 主光：檯燈。唯一投影的燈，陰影是這個房間立體感的主要來源。
  // 燈頭往前挪之後離桌面近很多，強度要跟著收 —— 不收會把桌面整片燒白。
  const key = new THREE_.PointLight(WARM, 26, 6.0, 2);
  key.userData.role = LIGHT_ROLES.essential;
  key.position.set(HEAD.x, HEAD.y - 0.07, HEAD.z + 0.02);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0022;
  key.shadow.radius = 3;
  root.add(key);

  // 補光：螢幕灑出來的光。不投影，只負責把鍵盤和使用者側的桌面托起來。
  //
  // 位置要離螢幕夠遠。擺在螢幕前方 0.45m 時，它會把螢幕自己照出一塊過曝的
  // 白斑 —— 總覽時距離遠看不出來，運鏡貼到螢幕前面就整片死白。
  // 螢幕自己的亮度交給 emissive，這盞燈照的是房間。
  const fill = new THREE_.PointLight(COOL, 9, 3.4, 2);
  fill.userData.role = LIGHT_ROLES.essential;
  fill.position.set(0, 1.28, SCR_Z + 1.25);
  root.add(fill);

  // 反射光。檯燈在桌面正上方，所以桌上每一樣東西**面向使用者的那一面**都是
  // 背光的 —— 運鏡貼近時看到的就是一塊黑（字卡盒、控制台、分析儀都中過）。
  // 真實世界裡那一面是靠桌面和人身上反彈回來的光撐起來的，這盞就是那個角色：
  // 很弱、很暖、從使用者這一側來，只負責把暗面從純黑拉到看得見形狀。
  const bounce = new THREE_.PointLight(0xffc89a, 7, 3.2, 2);
  bounce.userData.role = LIGHT_ROLES.ambience;
  bounce.position.set(-0.55, 1.22, -1.12);
  root.add(bounce);

  return root;
}

function collectMetrics(THREE_, scene, renderer) {
  let triangles = 0;
  const materials = new Set();
  const textures = new Set();
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const idx = g.index ? g.index.count : g.attributes.position?.count || 0;
    triangles += Math.floor(idx / 3);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m) continue;
      materials.add(m.uuid);
      for (const k of Object.keys(m)) {
        const v = m[k];
        if (v && v.isTexture) textures.add(v.uuid);
      }
    }
  });
  return {
    triangles,
    materials: materials.size,
    textures: textures.size,
    drawCalls: renderer?.info?.render?.calls ?? null,
  };
}

/**
 * @returns {Promise<{root, hotspotNodes: Map<string, object>, source: string, metrics: object, dispose: Function}>}
 */
export async function loadStudioScene({ signal } = {}) {
  let root = null;
  let source = "placeholder";

  // 先問清單，不要直接對 GLB 發探測 —— 那會在主控台留下一條 404 紅字，
  // 而「還沒有模型」是這個專案現在的正常狀態，不該長得像壞掉。
  let manifest = null;
  try {
    const r = await fetch(MANIFEST_URL, { signal });
    if (r.ok) manifest = await r.json();
  } catch {
    manifest = null;
  }
  const hasGlb = !!manifest?.glb;
  const glbUrl = SCENE_DIR + (manifest?.file || "studio.glb");

  if (hasGlb) {
    const { GLTFLoader } = await import("../vendor/three/examples/jsm/loaders/GLTFLoader.js");
    const loader = new GLTFLoader();
    await tryAttachDecoders(loader);
    const gltf = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("GLB 載入逾時")), LOAD_TIMEOUT_MS);
      loader.load(
        glbUrl,
        (g) => {
          clearTimeout(timer);
          resolve(g);
        },
        undefined,
        (err) => {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error("GLB 載入失敗"));
        },
      );
    });
    root = gltf.scene;
    source = "glb";
  } else {
    root = makeRoom(THREE);
  }

  const hotspotNodes = new Map();
  root.traverse((o) => {
    if (o.name && o.name.startsWith(HOTSPOT_PREFIX)) hotspotNodes.set(o.name, o);
  });

  return {
    root,
    hotspotNodes,
    source,
    metricsFor: (renderer) => collectMetrics(THREE, root, renderer),
    dispose() {
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose?.();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m) continue;
          for (const k of Object.keys(m)) {
            const v = m[k];
            if (v && v.isTexture) v.dispose?.();
          }
          m.dispose?.();
        }
      });
    },
  };
}

export { THREE, studioEnvironment };
