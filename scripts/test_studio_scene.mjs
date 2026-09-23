#!/usr/bin/env node
/**
 * 3D 排字台的場景契約。
 *
 * test_studio.mjs 管的是機制（鏡頭狀態機、效能分級、面板搬移）；這支管的是**場景本身**：
 * 八個功能點的器具是不是真的在、鏡頭是不是真的對著它們。
 *
 * 這一條是有前科的：房間從 11×9 改成 8×7、桌子從 z=-0.35 移到 z=-2.2 之後，八個鏡位
 * 全部對著空氣，畫面上沒有任何錯誤訊息。所以這裡在 Node 裡把整個場景建出來（canvas 用
 * 替身，貼圖不需要真的畫），拿每個 HOTSPOT_ 節點的世界包圍盒去對鏡位。
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import * as THREE from "../web/vendor/three/build/three.module.min.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8").split(String.fromCharCode(13)).join("");

let failed = 0;
function ok(name, cond, detail) {
  if (cond) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? "\n  " + detail : ""}`);
  }
}

// --- 手盒：把最近一張的 tag 排成一行鉛字 ---------------------------------------------
const { composeLine, STICK_SLOTS } = await import("../web/studio/composing.js");
{
  // 11 格：「1個女性」4＋空鉛＋「單人」2＝7，「精靈短髮」要再 5 格排不下，整個不放，其餘補空鉛。
  const line = composeLine(["1個女性", "單人", "精靈短髮"], 11);
  const text = line.map((c) => (c.space ? "_" : c.ch)).join("");
  ok("tag 依序排進手盒，字與字之間一格空鉛，排不下的整個留下", text === "1個女性_單人____", text);
  ok("一行的格數固定", line.length === 11);
  const exact = composeLine(["1個女性", "單人", "精靈短髮"], 12).map((c) => (c.space ? "_" : c.ch)).join("");
  ok("剛好排滿時全部放得進去", exact === "1個女性_單人_精靈短髮", exact);
  const nosplit = composeLine(["短髮", "非常長的頭髮"], 6).map((c) => (c.space ? "_" : c.ch)).join("");
  ok("排不下的字整個不放，不從中間切斷", nosplit === "短髮____", nosplit);
  const fill = composeLine([], 5);
  ok("沒有 tag 時整行都是空鉛", fill.length === 5 && fill.every((c) => c.space));
  const long = composeLine(["一二三四五六七八"], 5).map((c) => c.ch).join("");
  ok("第一個字就比整行長時截斷，不是整行空白", long === "一二三四五", long);
  const astral = composeLine(["𠮷野家"], 6);
  ok("罕用字（UTF-16 代理對）算一格", astral[0].ch === "𠮷" && astral[1].ch === "野");
  ok("預設格數夠排一行 POS", STICK_SLOTS >= 20);
}

// --- 場景：在 Node 裡建出整個排字台 -------------------------------------------------
function stubCanvas(w, h) {
  const ctx = new Proxy(
    { measureText: (s) => ({ width: String(s).length * 10 }), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }), getImageData: () => ({ data: new Uint8ClampedArray(4) }), createImageData: (a, b) => ({ data: new Uint8ClampedArray((a || 1) * (b || 1) * 4) }) },
    { get: (t, k) => (k in t ? t[k] : () => {}), set: () => true },
  );
  return { width: w, height: h, getContext: () => ctx };
}

const { makeTypeShop } = await import("../web/studio/type-shop.js");
const { STUDIO_HOTSPOTS } = await import("../web/studio/hotspots.js");
const { LIGHT_ROLES } = await import("../web/studio/performance-policy.js");
const shop = makeTypeShop(THREE, { makeCanvas: stubCanvas });
const root = shop.root;
root.updateMatrixWorld(true);

const nodes = new Map();
root.traverse((o) => {
  if (o.name && o.name.startsWith("HOTSPOT_")) nodes.set(o.name, o);
});
for (const h of STUDIO_HOTSPOTS) {
  ok(`「${h.label}」的器具在場景裡（${h.objectName}）`, nodes.has(h.objectName));
}

const FOV = (42 * Math.PI) / 180;
for (const h of STUDIO_HOTSPOTS) {
  const node = nodes.get(h.objectName);
  if (!node) continue;
  const box = new THREE.Box3().setFromObject(node);
  const target = new THREE.Vector3(h.lookAtTarget.x, h.lookAtTarget.y, h.lookAtTarget.z);
  const cam = new THREE.Vector3(h.cameraPosition.x, h.cameraPosition.y, h.cameraPosition.z);
  const near = box.clone().expandByScalar(0.12);
  ok(`「${h.label}」的鏡頭對準它（注視點在器具上）`, near.containsPoint(target), `注視點 ${target.toArray().map((v) => v.toFixed(2))}，器具 ${box.min.toArray().map((v) => v.toFixed(2))} ~ ${box.max.toArray().map((v) => v.toFixed(2))}`);
  ok(`「${h.label}」的相機不在器具裡面`, !box.containsPoint(cam));
  // 器具在畫面裡的大小：包圍球半徑對上半個視野高。太小是「對著遠處一顆點」，太大是「臉貼在上面」。
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const fill = radius / (cam.distanceTo(target) * Math.tan(FOV / 2));
  ok(`「${h.label}」在畫面裡的大小合理`, fill > 0.25 && fill < 1.1, `佔半個視野的 ${(fill * 100).toFixed(0)}%`);
}

// 視線不能被別的東西擋住：從相機往注視點射一條線，第一個碰到的必須是那個器具本身。
// 注視點在器具上還不夠 —— 活字架的第一版鏡位從高處往下看，視線正好穿過吊燈的燈罩，
// 畫面中間是一大塊黑色的圓錐。
{
  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh && !o.isSprite) meshes.push(o);
  });
  const ray = new THREE.Raycaster();
  for (const h of STUDIO_HOTSPOTS) {
    const node = nodes.get(h.objectName);
    if (!node) continue;
    const cam = new THREE.Vector3(h.cameraPosition.x, h.cameraPosition.y, h.cameraPosition.z);
    const target = new THREE.Vector3(h.lookAtTarget.x, h.lookAtTarget.y, h.lookAtTarget.z);
    ray.set(cam, target.clone().sub(cam).normalize());
    ray.far = cam.distanceTo(target) + 0.3;
    const hit = ray.intersectObjects(meshes, false)[0];
    let o = hit?.object;
    while (o && o !== node) o = o.parent;
    const blocker = hit ? hit.object.name || hit.object.geometry?.type || "某個物件" : "什麼都沒碰到";
    ok(`「${h.label}」的視線沒被擋住`, !!o, `第一個碰到的是 ${blocker}（距相機 ${hit ? hit.distance.toFixed(2) : "-"}m）`);
  }
}

// 面板開著時器具要整個落在面板沒蓋到的那一塊。手量的鏡位只對一個畫面比例成立：
// 1280×720 下八個器具全部有一截鑽到面板底下，手盒的右半截整個看不到。
// 驗真的幾何（每個頂點），不是包圍盒 —— 包圍盒過就代表留太多邊。
{
  const { fitPose, freeRegion } = await import("../web/studio/framing.js");
  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh) meshes.push(o);
  });
  const ray = new THREE.Raycaster();
  const SIZES = [[1280, 720], [1366, 768], [1440, 900], [1920, 1080], [390, 844]];
  const bad = { fit: [], zoom: [], sight: [] };
  for (const [W, H] of SIZES) {
    const region = freeRegion(W, H);
    for (const h of STUDIO_HOTSPOTS) {
      const node = nodes.get(h.objectName);
      if (!node) continue;
      const box = new THREE.Box3().setFromObject(node);
      const pose = fitPose(THREE, { position: h.cameraPosition, target: h.lookAtTarget }, box, { width: W, height: H, fov: 42 });
      const cam = new THREE.PerspectiveCamera(42, W / H, 0.1, 100);
      cam.position.set(pose.position.x, pose.position.y, pose.position.z);
      cam.lookAt(pose.target.x, pose.target.y, pose.target.z);
      cam.updateMatrixWorld(true);
      let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      const v = new THREE.Vector3();
      const m = new THREE.Matrix4();
      node.traverse((o) => {
        if (!o.isMesh) return;
        const pos = o.geometry.attributes.position;
        const n = o.isInstancedMesh ? o.count : 1;
        for (let k = 0; k < n; k++) {
          if (o.isInstancedMesh) m.fromArray(o.instanceMatrix.array, k * 16).premultiply(o.matrixWorld);
          else m.copy(o.matrixWorld);
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(m).project(cam);
            x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
          }
        }
      });
      const eps = 0.01;
      if (x0 < region.x0 - eps || x1 > region.x1 + eps || y0 < region.y0 - eps || y1 > region.y1 + eps)
        bad.fit.push(`${W}×${H} ${h.label} x ${x0.toFixed(2)}..${x1.toFixed(2)}（可見 ${region.x0.toFixed(2)}..${region.x1.toFixed(2)}） y ${y0.toFixed(2)}..${y1.toFixed(2)}（可見 ${region.y0.toFixed(2)}..${region.y1.toFixed(2)}）`);
      const d0 = Math.hypot(h.cameraPosition.x - h.lookAtTarget.x, h.cameraPosition.y - h.lookAtTarget.y, h.cameraPosition.z - h.lookAtTarget.z);
      const d1 = Math.hypot(pose.position.x - pose.target.x, pose.position.y - pose.target.y, pose.position.z - pose.target.z);
      if (d1 < d0 - 1e-6) bad.zoom.push(`${W}×${H} ${h.label}`);
      // 往後退之後視線可能被別的東西擋住（吊燈、隔壁的器具），要重新驗。
      const camPos = new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z);
      const aim = new THREE.Vector3(h.lookAtTarget.x, h.lookAtTarget.y, h.lookAtTarget.z);
      ray.set(camPos, aim.clone().sub(camPos).normalize());
      ray.far = camPos.distanceTo(aim) + 0.3;
      const hit = ray.intersectObjects(meshes, false)[0];
      let o = hit?.object;
      while (o && o !== node) o = o.parent;
      if (!o) bad.sight.push(`${W}×${H} ${h.label}：先碰到 ${hit ? hit.object.name || hit.object.geometry?.type : "什麼都沒有"}`);
    }
  }
  const NL = String.fromCharCode(10) + "  ";
  ok("面板開著時每個器具都整個落在可見區（五種畫面）", bad.fit.length === 0, bad.fit.join(NL));
  ok("鏡位只退不進（手量的特寫不會被放大）", bad.zoom.length === 0, bad.zoom.join("、"));
  ok("退後之後視線仍然沒被擋住", bad.sight.length === 0, bad.sight.join(NL));
  // 控制器：目的地走 resolvePose；畫面變了 reframe —— 停著的直接換位，路上的改目的地、起點不跳。
  {
    const { createCameraController } = await import("../web/studio/camera-controller.js");
    let dx = 1;
    const spot = { id: "a", panelId: "p", cameraPosition: { x: 0, y: 1, z: 2 }, lookAtTarget: { x: 0, y: 1, z: 0 } };
    const shiftBy = (h, p) => ({ position: { ...p.position, x: p.position.x + dx }, target: { ...p.target, x: p.target.x + dx } });
    const still = createCameraController({ overview: { position: { x: 0, y: 2, z: 5 }, target: { x: 0, y: 1, z: 0 } }, hotspots: [spot], reducedMotion: true, resolvePose: shiftBy });
    still.focus("a", 0);
    ok("focus 停在 resolvePose 算出來的鏡位", still.pose.position.x === 1 && still.pose.target.x === 1);
    dx = 3;
    ok("reframe 讓停著的鏡位換到新算的", still.reframe() === true && still.pose.position.x === 3);
    const moving = createCameraController({ overview: { position: { x: 0, y: 2, z: 5 }, target: { x: 0, y: 1, z: 0 } }, hotspots: [spot], resolvePose: shiftBy });
    moving.focus("a", 0);
    const mid = moving.update(200).position.x;
    dx = -2;
    moving.reframe(200);
    ok("運鏡途中 reframe 起點不跳", moving.update(200).position.x === mid);
    moving.update(5000);
    ok("運鏡途中 reframe 改的是目的地", moving.pose.position.x === -2);
    const broken = createCameraController({ overview: { position: { x: 0, y: 2, z: 5 }, target: { x: 0, y: 1, z: 0 } }, hotspots: [spot], reducedMotion: true, resolvePose: () => { throw new Error("x"); } });
    broken.focus("a", 0);
    ok("算鏡位失敗時退回手量的，器具照樣點得開", broken.pose.position.z === 2 && broken.state === "focused");
  }
  const ctl = read("web/studio/camera-controller.js");
  const sh = read("web/studio/studio-shell.js");
  ok("運鏡的目的地用算過的鏡位", /resolvePose/.test(ctl) && /resolvePose/.test(sh) && /fitPose\(/.test(sh));
  ok("視窗大小變了，停著的鏡位跟著重算", /cam\.reframe\?*\.?\(/.test(sh.slice(sh.indexOf("function resize("), sh.indexOf("let resizeTimer"))));
}

// 名稱一致：頂端麵包屑寫的是器具名（hotspot label），面板標題也要是同一個名字。
// 換成排字台之後，麵包屑寫「放大鏡」、面板卻還寫舊房間的「分析儀」—— 同一個東西兩個名字。
{
  const { PANEL_SPECS } = await import("../web/studio/studio-bridge.js");
  for (const h of STUDIO_HOTSPOTS) {
    const title = PANEL_SPECS[h.panelId]?.title;
    ok(`「${h.label}」的面板標題跟器具同名`, title === h.label, `面板寫「${title}」`);
  }
}

// 燈：每一盞都要有效能分級的角色，否則低畫質模式關不掉它；陰影只給一盞（最貴的那件事）。
const lights = [];
root.traverse((o) => {
  if (o.isLight) lights.push(o);
});
ok("每盞燈都標了效能角色", lights.length > 0 && lights.every((l) => Object.values(LIGHT_ROLES).includes(l.userData.role)), lights.map((l) => `${l.type}:${l.userData.role}`).join(", "));
ok("至少一盞必要的燈（低畫質也要看得見）", lights.some((l) => l.userData.role === LIGHT_ROLES.essential));
ok("只有一盞燈投射陰影", lights.filter((l) => l.castShadow).length === 1, `${lights.filter((l) => l.castShadow).length} 盞`);

let tris = 0;
root.traverse((o) => {
  if (!o.isMesh || !o.geometry) return;
  const g = o.geometry;
  const per = Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
  tris += o.isInstancedMesh ? per * o.count : per;
});
const budget = JSON.parse(read("web/studio/scene/scene.json")).budget.triangles;
ok("三角形在預算內", tris > 0 && tris <= budget, `${tris} / ${budget}`);

// 手盒排的字要能換：抽了新的一張，手盒跟著換。
ok("場景提供 setComposed()", typeof shop.setComposed === "function");
const cells = shop.setComposed(["1個女性", "單人"]);
ok("setComposed 回傳排好的那一行", Array.isArray(cells) && cells.length === STICK_SLOTS && cells[0].ch === "1");
// 還沒抽過（或 POS 清空）時手盒不能是一條黑槓：它是整張桌子的主角。排上店名。
const idle = shop.setComposed([]).map((c) => c.ch).join("");
ok("還沒抽牌時手盒排著店名", idle.startsWith("排字匣"), idle);
ok("抽了之後換成那一張", shop.setComposed(["單人"])[0].ch === "單");

// --- 接線：scene-loader 用排字台、外殼在抽牌後更新手盒 ---------------------------------------
const loader = read("web/studio/scene-loader.js");
ok("scene-loader 畫的是排字台，不是舊房間", /makeTypeShop\(/.test(loader) && !/function makeRoom\(/.test(loader));
ok("scene-loader 把 setComposed 交出去", /setComposed/.test(loader));
const shell = read("web/studio/studio-shell.js");
ok("外殼在「這張 POS」更新時換手盒裡的字", /setComposed\??\.?\(/.test(shell) && /tray-pins/.test(shell));
// 陰影只跟燈和幾何有關，跟相機無關；排字台沒有會動的東西。每一格都重畫陰影貼圖是
// 運鏡時多出 73 個 draw call（投影的 mesh 數）畫一張不會變的圖。只在燈或畫質變了才重畫。
{
  const body = (name) => {
    const at = shell.indexOf(`function ${name}(`);
    return at < 0 ? "" : shell.slice(at, shell.indexOf("\n  }\n", at));
  };
  ok("陰影貼圖不跟著每一格重畫", /shadowMap\.autoUpdate\s*=\s*false/.test(shell));
  ok("畫質切換（燈的開關、投影與否）後陰影重畫一次", /shadowMap\.needsUpdate\s*=\s*true/.test(body("applyTier")));
  ok("WebGL context 還原後陰影重畫一次", /shadowMap\.needsUpdate\s*=\s*true/.test(shell.slice(shell.indexOf("const onRestored"))));
}
// 滑鼠停在器具上直接移出畫布（移到面板上、移出視窗），pointermove 不會再來：
// 以前 hover 的亮光、手指游標和名字提示就一直掛著。
{
  const at = shell.indexOf("const onPointerLeave");
  const leave = at < 0 ? "" : shell.slice(at, shell.indexOf("};", at));
  const clr = shell.indexOf("function clearHover(");
  const clear = clr < 0 ? "" : shell.slice(clr, shell.indexOf("\n  }\n", clr));
  ok("指標離開畫布時收掉 hover", /clearHover\(\)/.test(leave));
  ok("收掉 hover = 熄亮光、游標復原、藏提示", /setHoverLift\(.*, false\)/.test(clear) && /hovered = null/.test(clear) && /cursor = ""/.test(clear) && /hidden = true/.test(clear));
}
// hover 的亮光要淡入淡出，不是開關一切：跟 2D 那側按鈕的 hover 同一個節奏。
// 迴圈是按需渲染的，亮光還在變就要讓 schedule() 繼續排下一格，否則停在半亮。
{
  const sched = shell.slice(shell.indexOf("function schedule("), shell.indexOf("function stopLoop("));
  const fr = shell.slice(shell.indexOf("function frame("), shell.indexOf("function schedule("));
  ok("hover 亮光有淡入淡出", /function stepLifts\(/.test(shell) && /stepLifts\(/.test(fr));
  ok("亮光還在變時迴圈不停", /liftsMoving\(\)/.test(sched));
  ok("減少動態時亮光直接到位", /reducedMotion/.test(shell.slice(shell.indexOf("function setHoverLift("), shell.indexOf("function stepLifts("))));
  // 狀態要宣告在 schedule() 會被同步呼叫之前（parallax 那次 TDZ 的教訓）。
  ok("亮光狀態宣告在渲染迴圈之前", shell.indexOf("const lifts") >= 0 && shell.indexOf("const lifts") < shell.indexOf("function schedule("));
}
ok("總覽不再叫房間", !/房間總覽/.test(shell) && !/返回房間/.test(shell));
// 外殼初始化中途同步呼叫 recompose → markDirty → schedule 會讀到還沒宣告的 parallax（TDZ），
// 整個 3D 退回平面。第一次排字要延到初始化之後。
{
  // 監看回呼裡的 recompose() 本來就在微任務裡，合法；要抓的是「開始監看後緊接著同步排一次」。
  const lines = shell.split(String.fromCharCode(10)).map((l) => l.trim());
  const at = lines.findIndex((l) => l.startsWith("trayWatch.observe("));
  const after = lines.slice(at + 1).find((l) => l && !l.startsWith("//"));
  ok("第一次排字延到外殼初始化之後", at >= 0 && after === "queueMicrotask(recompose);", `監看之後的第一行：${after}`);
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nok");
