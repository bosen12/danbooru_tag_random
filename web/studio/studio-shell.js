/**
 * 3D 外殼的組裝與生命週期。
 *
 * 這裡把幾個各自負責一件事的模組接起來：
 *   camera-controller   運鏡狀態機（純的，可在 node 測）
 *   hotspots            功能點設定（純資料）
 *   scene-loader        three.js 場景
 *   studio-bridge       hotspot → 既有 2D 面板
 *   performance-policy  什麼時候畫、畫多大、什麼時候降級（純的）
 *
 * 這個檔案自己只做三件事：建 renderer、跑 render loop、把事件接到上面那些模組。
 * 它刻意不含任何「規則」—— 規則都在可測的純模組裡。
 */

import { createCameraController, CAMERA_STATES } from "./camera-controller.js";
import { STUDIO_HOTSPOTS, validateHotspots, missingNodes } from "./hotspots.js";
import { loadStudioScene, THREE, studioEnvironment } from "./scene-loader.js";
import { createBridge, anyOverlayOpen } from "./studio-bridge.js";
import { fitPose } from "./framing.js";
import {
  QUALITY_TIERS,
  clampPixelRatio,
  degradeTier,
  lightOnAt,
  shouldRender,
  tierSettings,
} from "./performance-policy.js";

const BOOT_TIMEOUT_MS = 20000;
const CONTEXT_LOST_LIMIT = 2;

export async function createStudioShell(opts) {
  const options = opts || {};
  const onExit = typeof options.onExit === "function" ? options.onExit : () => {};
  const onFatal = typeof options.onFatal === "function" ? options.onFatal : () => {};
  const reducedMotion =
    !!options.reducedMotion ||
    (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);

  // --- DOM 外框 -----------------------------------------------------------
  let rootEl = document.getElementById("studio-root");
  if (!rootEl) {
    rootEl = document.createElement("div");
    rootEl.id = "studio-root";
    rootEl.className = "studio-root";
    rootEl.hidden = true;
    document.body.appendChild(rootEl);
  }
  const canvas = document.createElement("canvas");
  canvas.className = "studio-canvas";
  // canvas 不進 tab 序；鍵盤操作走下面那一排 hotspot 按鈕，那才有可見的 focus。
  canvas.setAttribute("aria-hidden", "true");
  rootEl.appendChild(canvas);

  const hud = document.createElement("div");
  hud.className = "studio-hud";
  // 「離開 3D」一定要長在 HUD 裡。桅杆上那顆切換鈕在 .mast 裡，而 .mast 在 3D
  // 模式下是藏起來的 —— 第一版就是這樣，進了房間之後畫面上一個出口都沒有，
  // 只剩改網址。這是兩個不同層次的「回去」，要分清楚：
  //   返回排字台  離開某個功能點，回到排字台總覽（還在 3D 裡）
  //   平面工作台  整個離開 3D
  hud.innerHTML =
    '<div class="studio-hud-top">' +
    '<span class="studio-crumb" id="studio-crumb">排字台總覽</span>' +
    '<button type="button" class="studio-back" id="studio-back" hidden>返回排字台 (Esc)</button>' +
    '<button type="button" class="studio-exit" id="studio-exit" aria-label="離開 3D，回到平面工作台">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>' +
    "<span>平面工作台</span></button>" +
    "</div>" +
    '<nav class="studio-keys" id="studio-keys" aria-label="工作室功能點"></nav>' +
    '<p class="studio-tip" id="studio-tip" hidden></p>';
  rootEl.appendChild(hud);

  const bridge = createBridge();

  // --- 設定檢查。缺欄位要當場講清楚，不要等到點了沒反應才猜 ----------------
  const report = validateHotspots(STUDIO_HOTSPOTS);
  if (!report.ok) console.warn("[studio] hotspot 設定有問題：\n  " + report.problems.join("\n  "));

  // --- 場景 ---------------------------------------------------------------
  let scene;
  let sceneData;
  let renderer;
  let camera;
  try {
    sceneData = await Promise.race([
      loadStudioScene({}),
      new Promise((_, rej) => setTimeout(() => rej(new Error("場景載入逾時")), BOOT_TIMEOUT_MS)),
    ]);
  } catch (err) {
    onFatal("3D 場景載入失敗：" + (err?.message || err));
    throw err;
  }

  const absent = missingNodes(STUDIO_HOTSPOTS, new Set(sceneData.hotspotNodes.keys()));
  if (absent.length) {
    console.warn(
      "[studio] 這些 hotspot 在場景裡找不到對應節點，點了不會有反應：\n  " + absent.join("\n  "),
    );
  }

  camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 100);

  let tier = QUALITY_TIERS.high;
  // 收集場景裡所有的燈一次，降級時才不用每次重新走一遍整棵樹。
  const sceneLights = [];
  sceneData.root.traverse((o) => {
    if (o.isLight) {
      o.userData.wantsShadow = o.castShadow === true;
      sceneLights.push(o);
    }
  });
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: tierSettings(tier).antialias,
      powerPreference: "high-performance",
    });
  } catch (err) {
    onFatal("WebGL 建立失敗：" + (err?.message || err));
    throw err;
  }
  renderer.shadowMap.enabled = tierSettings(tier).shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // 陰影只跟燈和幾何有關，跟相機無關，而排字台上沒有會動的東西。預設每一格都重畫
  // 陰影貼圖，運鏡時等於每格多畫一遍所有投影的 mesh。改成畫一次，燈變了才重畫。
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  // 色彩管線。這三行對觀感的影響比任何幾何細節都大：
  // 沒有 tone mapping 時，亮部會硬生生削平成一片死白，暗部則糊成一團黑 ——
  // 那正是「電腦畫的」最明顯的特徵。ACES 把高光滾下來、把暗部拉開，
  // 一個只有幾千面的房間也會開始像被「拍」出來的。
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;

  // 環境反射。沒有環境貼圖的 PBR 材質會像塑膠 —— 金屬邊、螢幕外框、旋鈕
  // 全部沒有東西可以反射。這裡用一張上冷下暖的漸層當環境，不需要 HDRI 檔案。
  let envMap = null;
  try {
    envMap = studioEnvironment(THREE, renderer);
  } catch {
    envMap = null;
  }

  // 場景要等 renderer 和 envMap 都好了才建 —— PMREM 需要 renderer，
  // 而 scene.environment 需要 PMREM 的結果。
  scene = new THREE.Scene();
  // 排字台浮在黑暗裡：背景就是工作燈照不到的地方，跟 2D 排字匣同一個暖黑。
  scene.background = new THREE.Color(0x0b0806);
  // 指數霧：遠處的牆角自然暗下去，房間才有深度。
  // 密度要很小心 —— 相機離桌子只有 6 公尺，0.085 的時候整個畫面會蒙上一層
  // 均勻的褐色，把光影層次全部抹平。0.022 只在牆角看得出來，那才是要的。
  // 桌子兩端與桌腳往下慢慢沒入黑暗 —— 沒有牆，深度全靠霧和光圈。
  scene.fog = new THREE.FogExp2(0x0b0806, 0.06);
  if (envMap) scene.environment = envMap;
  scene.add(sceneData.root);

  // 總覽鏡位。往後退到整組家具都進得來為止：右邊的模型櫃到 x=3.4，
  // 左後方的作品牆到 z=-3.1，兩個都不能被畫面邊緣切掉 ——
  // 看不見的東西等於不存在，使用者不會去點一個他沒看到的架子。
  // 總覽：站在排字台前，微微俯看整張桌子。3.8 米寬的桌面兩端、上方的晾紙架都要在畫面裡 ——
  // 看不見的器具等於不存在，使用者不會去點一個沒看到的東西。
  const OVERVIEW = {
    position: { x: 0, y: 2.45, z: 3.1 },
    target: { x: 0, y: 1.08, z: -0.35 },
  };

  // 器具的包圍盒：場景是靜的，量一次就好。
  const nodeBoxes = new Map();
  const cam = createCameraController({
    overview: OVERVIEW,
    hotspots: STUDIO_HOTSPOTS,
    reducedMotion,
    // 面板會蓋掉右邊 560px（手機上是底下 62%）：鏡位依現在的畫面修成器具整個落在可見區。
    resolvePose: (h, authored) => {
      const node = sceneData.hotspotNodes.get(h.objectName);
      if (!node) return authored;
      let box = nodeBoxes.get(node);
      if (!box) nodeBoxes.set(node, (box = new THREE.Box3().setFromObject(node)));
      return fitPose(THREE, authored, box, {
        width: rootEl.clientWidth || window.innerWidth,
        height: rootEl.clientHeight || window.innerHeight,
        fov: camera.fov,
      });
    },
    onPanelShow: (panelId) => {
      bridge.open(panelId);
      rootEl.classList.add("has-panel");
      markDirty();
    },
    onPanelHide: (panelId) => {
      bridge.close(panelId);
      rootEl.classList.remove("has-panel");
      markDirty();
    },
    onStateChange: (state, id) => {
      const crumb = document.getElementById("studio-crumb");
      const back = document.getElementById("studio-back");
      const spot = STUDIO_HOTSPOTS.find((h) => h.id === id);
      if (crumb) crumb.textContent = spot ? spot.label : "排字台總覽";
      if (back) back.hidden = state === CAMERA_STATES.overview;
      for (const btn of keyButtons) {
        btn.setAttribute("aria-current", btn.dataset.hotspot === id ? "true" : "false");
      }
      markDirty();
    },
  });
  cam.onError = (err) => console.warn("[studio] " + err.message);

  // --- 鍵盤可達的功能點清單。canvas 本身沒有語意，這一排才是無障礙入口 ----
  const keys = document.getElementById("studio-keys");
  const keyButtons = [];
  for (const h of STUDIO_HOTSPOTS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "studio-key";
    b.dataset.hotspot = h.id;
    b.setAttribute("aria-current", "false");
    b.innerHTML = `<strong>${h.label}</strong><small>${h.hint || ""}</small>`;
    b.addEventListener("click", () => cam.focus(h.id, performance.now()));
    // 鍵盤走到哪，房間裡就亮到哪。canvas 進不了 tab 序，所以用鍵盤的人本來
    // 完全看不出「我現在選的是房間裡的哪一樣東西」—— 焦點只在下面那排按鈕上，
    // 3D 那側毫無回應。滑鼠有 hover，鍵盤也該有對等的東西。
    b.addEventListener("focus", () => {
      if (!cam.acceptsPointerInput()) return;
      setKeyboardLift(h.id);
    });
    b.addEventListener("blur", () => {
      // 焦點移到另一顆功能點鈕時，那顆的 focus 會接手；移開整排就熄掉。
      window.setTimeout(() => {
        const at = document.activeElement;
        if (!at || !at.classList?.contains("studio-key")) setKeyboardLift(null);
      }, 0);
    });
    keys.appendChild(b);
    keyButtons.push(b);
  }

  // --- 效能 ---------------------------------------------------------------
  let dirty = true;
  let visible = false;
  let rafId = 0;
  let lastFrame = 0;
  let fpsAcc = 0;
  let fpsN = 0;
  let contextLost = 0;
  // hover 亮光：每個器具一個 0..1 的量，朝目標淡過去（setHoverLift 設目標、stepLifts 走一格）。
  // 宣告在這裡而不是 setHoverLift 旁邊：schedule() 在初始化中途就會被同步呼叫。
  const lifts = new Map();
  let liftPrev = 0;
  const LIFT_MS = 140;
  // 「有東西變了」就一定要把迴圈叫起來。按需渲染最容易出的錯就是改了狀態卻忘了
  // 排下一格 —— 實測從鍵盤那排功能點按下去時，focus() 動了狀態機，但迴圈已經
  // 停在 overview，畫面完全沒反應。把 schedule() 併進來，就不會有哪個呼叫端漏掉。
  const markDirty = () => {
    dirty = true;
    schedule();
  };

  // --- 手盒裡排的字：跟著「這張 POS」 ---------------------------------------------
  // 2D 那邊每抽一張就重畫 #tray-pins（這張 POS 的每個 tag）。把它們的中文名排進手盒，
  // 3D 排字台上看得到的就是剛抽出來的那一行。沒抽過時托盤列的是釘選，也照排。
  const trayPins = document.getElementById("tray-pins");
  let trayWatch = null;
  const recompose = () => {
    const labels = [...(trayPins?.querySelectorAll(".tag .label") || [])].map((el) => el.textContent.trim()).filter(Boolean);
    sceneData.setComposed?.(labels);
    markDirty();
  };
  if (trayPins && typeof MutationObserver === "function") {
    let queued = false;
    trayWatch = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        recompose();
      });
    });
    trayWatch.observe(trayPins, { childList: true, subtree: true, characterData: true });
    // 第一次排字要等外殼初始化完：recompose → markDirty → schedule 會讀到後面才宣告的
    // parallax，同步呼叫會在 TDZ 丟例外，整個 3D 退回平面（實測過）。
    queueMicrotask(recompose);
  }

  // --- 總覽時的視差 --------------------------------------------------------
  // 房間會跟著滑鼠非常輕微地移動。幅度小到說不出來，但「完全靜止的 3D 畫面」
  // 和「會呼吸的 3D 畫面」是兩種東西 —— 參考的那幾個作品集網站全都有這一層。
  //
  // 三條規則：只在總覽時做（運鏡中再加偏移會打架）、幅度上限 0.16m、
  // reduced-motion 下完全關掉。
  const PARALLAX_MAX = 0.16;
  const parallax = { x: 0, y: 0 };
  const parallaxTo = { x: 0, y: 0 };
  function stepParallax() {
    if (reducedMotion) return false;
    const want = cam.state === CAMERA_STATES.overview && !cam.isBusy;
    const tx = want ? parallaxTo.x : 0;
    const ty = want ? parallaxTo.y : 0;
    const dx = tx - parallax.x;
    const dy = ty - parallax.y;
    if (Math.abs(dx) < 0.0004 && Math.abs(dy) < 0.0004) {
      parallax.x = tx;
      parallax.y = ty;
      return false;
    }
    // 指數逼近：滑鼠停住之後鏡頭會自己滑到定位，不是硬綁在游標上。
    parallax.x += dx * 0.06;
    parallax.y += dy * 0.06;
    return true;
  }

  function applyTier() {
    const s = tierSettings(tier);
    renderer.shadowMap.enabled = s.shadows;
    renderer.setPixelRatio(clampPixelRatio(window.devicePixelRatio || 1, tier));
    // 降級時真的把裝飾性的燈關掉。即時燈是弱機器上最貴的東西：每多一盞，
    // 每個像素就多算一次。這件事以前只寫在設定物件裡（maxLights），
    // 沒有任何一行程式讀它 —— 也就是「低畫質模式」根本沒有變低。
    for (const light of sceneLights) {
      const on = lightOnAt(tier, light.userData.role);
      if (light.visible !== on) light.visible = on;
      if (!s.shadows && light.castShadow) light.castShadow = false;
      else if (s.shadows && light.userData.role === "essential") light.castShadow = light.userData.wantsShadow === true;
    }
    renderer.shadowMap.needsUpdate = true;
    markDirty();
  }

  function resize() {
    const w = rootEl.clientWidth || window.innerWidth;
    const h = rootEl.clientHeight || window.innerHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(clampPixelRatio(window.devicePixelRatio || 1, tier));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // 面板寬度是固定的 px，畫面一變，器具在可見區裡的位置就變了。
    cam.reframe?.(performance.now());
    markDirty();
  }

  let resizeTimer = 0;
  const onResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, 120);
  };
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
  ro?.observe(rootEl);
  window.addEventListener("resize", onResize);

  function frame(now) {
    rafId = 0;
    if (!visible) return;
    const animating = cam.isBusy;
    cam.update(now);
    const moved = stepParallax();
    const lifting = stepLifts(now);
    if (animating || dirty || moved || lifting) {
      const p = cam.pose;
      camera.position.set(
        p.position.x + parallax.x,
        p.position.y + parallax.y,
        p.position.z,
      );
      // 注視點跟著動一點點，但比相機少 —— 兩者等量移動只是平移，
      // 會看不出視差；差值才是深度感的來源。
      camera.lookAt(p.target.x + parallax.x * 0.25, p.target.y + parallax.y * 0.25, p.target.z);
      renderer.render(scene, camera);
      dirty = false;
    }
    if (lastFrame && animating) {
      const dt = now - lastFrame;
      if (dt > 0) {
        fpsAcc += 1000 / dt;
        fpsN += 1;
        if (fpsN >= 60) {
          const avg = fpsAcc / fpsN;
          fpsAcc = 0;
          fpsN = 0;
          const next = degradeTier(tier, avg);
          if (next !== tier) {
            tier = next;
            applyTier();
            console.info("[studio] 畫質降到 " + tier + "（實測 " + Math.round(avg) + " fps）");
          }
        }
      }
    }
    lastFrame = now;
    // 還在運鏡就繼續；停穩了 schedule() 會自己判斷不再排下一格。
    schedule();
  }

  // 按需渲染：沒有動畫、也沒有任何東西變髒，就完全不排下一格。
  // 一個靜止的房間每秒畫六十次，是把電池燒在一張不會變的圖上。
  // 之後任何狀態變化都會走 markDirty() + schedule() 把迴圈重新叫起來。
  function schedule() {
    if (rafId) return;
    const drifting = !reducedMotion && (parallax.x !== parallaxTo.x || parallax.y !== parallaxTo.y);
    if (!shouldRender({ visible, animating: cam.isBusy || drifting || liftsMoving(), dirty })) return;
    rafId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  // 分頁切到背景就完全停掉。規格要的「background tab 停止或降頻」在這裡。
  const onVisibility = () => {
    if (document.hidden) stopLoop();
    else if (visible) {
      markDirty();
      schedule();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  // --- WebGL context lost --------------------------------------------------
  const onLost = (e) => {
    e.preventDefault();
    stopLoop();
    contextLost += 1;
    if (contextLost >= CONTEXT_LOST_LIMIT) {
      cam.setFallback("webgl-context-lost");
      onFatal("WebGL 連續中斷，這次改用平面工作台");
    }
  };
  const onRestored = () => {
    // context 掉了之後 GPU 上的陰影貼圖也沒了，要重畫一次。
    renderer.shadowMap.needsUpdate = true;
    resize();
    markDirty();
    schedule();
  };
  canvas.addEventListener("webglcontextlost", onLost, false);
  canvas.addEventListener("webglcontextrestored", onRestored, false);

  // --- 指標與鍵盤 ---------------------------------------------------------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pickTargets = [...sceneData.hotspotNodes.values()];

  function pick(ev) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    // 只對 hotspot 節點做 raycast，不是整個場景 —— 牆壁和地板沒有必要參與。
    const hit = ray.intersectObjects(pickTargets, true)[0];
    if (!hit) return null;
    let o = hit.object;
    while (o && !sceneData.hotspotNodes.has(o.name)) o = o.parent;
    if (!o) return null;
    return STUDIO_HOTSPOTS.find((h) => h.objectName === o.name) || null;
  }

  // 滑過去的回饋：把那個物件的自發光稍微提起來，不放大、不描粗邊。
  // 放大會讓家具「跳」，在一個半寫實的房間裡那看起來像壞掉而不是可以點。
  // 材質先 clone 再改 —— GLB 的材質常常是好幾個節點共用的，直接改會連帶
  // 把旁邊沒滑到的東西一起點亮。
  //
  // 亮起與熄掉都淡過去（140ms，跟 2D 那側按鈕的 hover 同一個節奏），不是開關一切。
  const hoverBase = new WeakMap();
  const LIFT_TINT = new THREE.Color(0xeaad57);
  function setHoverLift(node, on) {
    if (!node) return;
    node.traverse((o) => {
      if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
      if (!hoverBase.has(o)) {
        o.material = o.material.clone();
        hoverBase.set(o, {
          e: o.material.emissive ? o.material.emissive.clone() : null,
          i: o.material.emissiveIntensity ?? 1,
        });
      }
    });
    let lift = lifts.get(node);
    if (!lift) lifts.set(node, (lift = { t: 0, to: 0 }));
    // 從靜止開始動：計時從現在算，不是從上一次停下來的那一格。
    if (!liftsMoving()) liftPrev = performance.now();
    lift.to = on ? 1 : 0;
    if (reducedMotion) {
      lift.t = lift.to;
      applyLift(node, lift.t);
    }
  }
  function applyLift(node, t) {
    const k = t * t * (3 - 2 * t);
    node.traverse((o) => {
      const base = o.isMesh ? hoverBase.get(o) : null;
      if (!base || !base.e) return;
      // 亮光要淡：一層均勻的自發光會把有紋路的器具（活字架的格子、字模櫃的抽屜）
      // 洗成一塊平的亮色，看起來像被選取框蓋住，而不是被燈照到。
      o.material.emissive.copy(base.e).lerp(LIFT_TINT, 0.2 * k);
      o.material.emissiveIntensity = base.i + (Math.max(base.i, 0.3) * 1.25 - base.i) * k;
    });
  }
  function liftsMoving() {
    for (const lift of lifts.values()) if (lift.t !== lift.to) return true;
    return false;
  }
  /** 所有還在變的亮光走一格；有東西變了就回 true（這一格要畫）。 */
  function stepLifts(now) {
    if (!liftsMoving()) return false;
    // 分頁切走再回來時 now 會跳很大一段，夾住，免得一格就跳到底看不到淡入。
    const step = Math.min(Math.max(now - liftPrev, 0), 50) / LIFT_MS;
    liftPrev = now;
    for (const [node, lift] of lifts) {
      if (lift.t === lift.to) continue;
      lift.t = lift.to > lift.t ? Math.min(lift.to, lift.t + step) : Math.max(lift.to, lift.t - step);
      applyLift(node, lift.t);
    }
    return true;
  }

  // 鍵盤焦點的高亮跟滑鼠 hover 共用同一套材質提升，但各自記各自的，
  // 免得一個關掉時把另一個也熄了。
  let kbLit = null;
  function setKeyboardLift(id) {
    if (kbLit === id) return;
    if (kbLit && kbLit !== hovered) setHoverLift(sceneData.hotspotNodes.get(hotspotNodeName(kbLit)), false);
    kbLit = id;
    if (id) setHoverLift(sceneData.hotspotNodes.get(hotspotNodeName(id)), true);
    const tip = document.getElementById("studio-tip");
    if (tip) {
      const spot = STUDIO_HOTSPOTS.find((x) => x.id === id);
      tip.hidden = !spot;
      if (spot) tip.textContent = spot.label;
    }
    markDirty();
  }

  let hovered = null;
  const onPointerMove = (ev) => {
    if (!reducedMotion) {
      const rect = canvas.getBoundingClientRect();
      const nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      parallaxTo.x = nx * PARALLAX_MAX;
      parallaxTo.y = ny * PARALLAX_MAX * 0.5;
      schedule();
    }
    if (!cam.acceptsPointerInput()) return;
    const h = pick(ev);
    const id = h ? h.id : null;
    if (id === hovered) return;
    if (hovered && hovered !== kbLit) setHoverLift(sceneData.hotspotNodes.get(hotspotNodeName(hovered)), false);
    hovered = id;
    if (id) setHoverLift(sceneData.hotspotNodes.get(h.objectName), true);
    canvas.style.cursor = id ? "pointer" : "";
    const tip = document.getElementById("studio-tip");
    if (tip) {
      tip.hidden = !h;
      tip.textContent = h ? h.label : "";
    }
    markDirty();
  };
  function hotspotNodeName(id) {
    return STUDIO_HOTSPOTS.find((x) => x.id === id)?.objectName || "";
  }
  // 滑鼠不在任何器具上了：熄亮光、游標復原、藏提示。鍵盤焦點點亮的那個不動。
  function clearHover() {
    if (hovered && hovered !== kbLit) setHoverLift(sceneData.hotspotNodes.get(hotspotNodeName(hovered)), false);
    hovered = null;
    canvas.style.cursor = "";
    const tip = document.getElementById("studio-tip");
    if (tip && !kbLit) tip.hidden = true;
    markDirty();
  }
  const onClick = (ev) => {
    if (!cam.acceptsPointerInput()) return;
    const h = pick(ev);
    if (h) {
      // 鏡頭要走了，hover 的亮度先收掉，不然它會一路亮著跟過去。
      clearHover();
      setKeyboardLift(null);
      cam.focus(h.id, performance.now());
      schedule();
      return;
    }
    // 點空白處回總覽，但面板開著時不要 —— 那會變成點到面板旁邊就被彈回去。
    if (cam.state === CAMERA_STATES.focused && !rootEl.classList.contains("has-panel")) {
      cam.back(performance.now());
      schedule();
    }
  };
  const onPointerLeave = () => {
    // 停在器具上直接移出畫布（到面板上、出視窗）不會再有 pointermove，這裡要自己收。
    clearHover();
    parallaxTo.x = 0;
    parallaxTo.y = 0;
    schedule();
  };
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("click", onClick);

  const onKey = (e) => {
    if (rootEl.hidden) return;
    if (e.key !== "Escape") return;
    // 疊層開著時 Escape 是它們的。
    if (anyOverlayOpen()) return;
    e.preventDefault();
    // Esc 是逐層往外退：停在某個功能點就先回排字台總覽，已經在總覽就整個離開 3D。
    // 「再按一次就出得去」是使用者對 Esc 的預設期待，沒有這一層就會覺得被關住。
    if (cam.state === CAMERA_STATES.overview) {
      onExit();
      return;
    }
    cam.back(performance.now());
    schedule();
  };
  document.addEventListener("keydown", onKey);

  rootEl.addEventListener("click", (e) => {
    if (e.target.closest("#studio-exit")) {
      onExit();
      return;
    }
    if (e.target.closest("[data-studio-back], #studio-back")) {
      cam.back(performance.now());
      schedule();
    }
  });

  // 第一次進來給一句話就好。規格要的是「非常短的導覽提示，之後不重複干擾」，
  // 所以記在 localStorage，看過一次就不再出現。記不住（無痕模式）也不該壞掉。
  function maybeFirstRunHint() {
    let seen = false;
    try {
      seen = localStorage.getItem("tag-case-studio-seen") === "1";
    } catch {
      seen = true;
    }
    if (seen) return;
    try {
      localStorage.setItem("tag-case-studio-seen", "1");
    } catch {
      /* 記不住就算了，最多多看一次 */
    }
    const tip = document.getElementById("studio-tip");
    if (!tip) return;
    tip.textContent = "點桌上的東西就會走過去，Esc 退回來。";
    tip.hidden = false;
    window.setTimeout(() => {
      if (tip.textContent.startsWith("點桌上")) tip.hidden = true;
    }, 5200);
  }

  applyTier();
  resize();

  const shell = {
    get element() {
      return rootEl;
    },
    get cameraController() {
      return cam;
    },
    metrics() {
      return { ...sceneData.metricsFor(renderer), source: sceneData.source, tier };
    },
    show() {
      rootEl.hidden = false;
      visible = true;
      resize();
      markDirty();
      schedule();
      maybeFirstRunHint();
    },
    hide() {
      visible = false;
      stopLoop();
      // 面板裡「借走」的 2D 元素一定要還回去，否則切回平面會少半個畫面。
      cam.back(performance.now());
      cam.update(performance.now() + 5000);
      bridge.closeAll();
      rootEl.classList.remove("has-panel");
      rootEl.hidden = true;
    },
    destroy() {
      shell.hide();
      stopLoop();
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      window.clearTimeout(resizeTimer);
      ro?.disconnect();
      trayWatch?.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      cam.destroy();
      sceneData.dispose();
      envMap?.dispose?.();
      renderer.dispose();
      rootEl.remove();
    },
  };

  return shell;
}
