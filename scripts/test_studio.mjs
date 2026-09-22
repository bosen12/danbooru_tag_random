#!/usr/bin/env node
/**
 * 3D 工作室的契約。
 *
 * 這支測試不碰 WebGL，也不需要瀏覽器 —— 那是刻意的架構決定，不是取巧。
 * 運鏡狀態機、hotspot 設定、模式優先順序、效能降級與 fallback 判斷，全部是純資料
 * 運算；把它們寫成不依賴 three.js 的模組，才可能在 node 裡逐格推進時間、量出
 * 「運鏡途中被打斷會不會瞬移」這種只有時間軸上才看得見的行為。
 *
 * 只有 scene-loader / hotspot-controller 會 import three.js，它們不在這裡測。
 *
 * 專案沒有 package.json 也沒有 node_modules，這支同樣不引進任何依賴。
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NL = String.fromCharCode(10);

const {
  createCameraController,
  CAMERA_STATES,
  easeInOutCubic,
  durationFor,
} = await import("../web/studio/camera-controller.js");
const {
  STUDIO_HOTSPOTS,
  validateHotspots,
  hotspotById,
} = await import("../web/studio/hotspots.js");
const { resolveViewMode, VIEW_MODES } = await import("../web/studio/mode-policy.js");
const {
  clampPixelRatio,
  shouldRender,
  degradeTier,
  tierSettings,
  lightOnAt,
  LIGHT_ROLES,
  QUALITY_TIERS,
} = await import("../web/studio/performance-policy.js");

let failed = 0;
function ok(name, cond, detail) {
  if (cond) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}` + (detail ? NL + "  " + detail : ""));
  }
}

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const poseNear = (p, q, eps = 1e-6) =>
  near(p.position.x, q.position.x, eps) &&
  near(p.position.y, q.position.y, eps) &&
  near(p.position.z, q.position.z, eps) &&
  near(p.target.x, q.target.x, eps) &&
  near(p.target.y, q.target.y, eps) &&
  near(p.target.z, q.target.z, eps);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const OVERVIEW = { position: { x: 0, y: 3, z: 9 }, target: { x: 0, y: 1.2, z: 0 } };
const FIXTURE = [
  { id: "draw", objectName: "HOTSPOT_DRAW_SCREEN", panelId: "p-draw", cameraPosition: { x: 0, y: 1.6, z: 2.4 }, lookAtTarget: { x: 0, y: 1.5, z: 0 } },
  { id: "tags", objectName: "HOTSPOT_TAG_BOX", panelId: "p-tags", cameraPosition: { x: -3, y: 1.4, z: 1.2 }, lookAtTarget: { x: -3.4, y: 1, z: 0.2 } },
  { id: "shelf", objectName: "HOTSPOT_MODEL_SHELF", panelId: "p-shelf", cameraPosition: { x: 4, y: 1.7, z: 1 }, lookAtTarget: { x: 4.6, y: 1.5, z: 0 } },
];

function makeController(over = {}) {
  return createCameraController({
    overview: OVERVIEW,
    hotspots: FIXTURE,
    ...over,
  });
}

// --- 1. 基本狀態轉換 --------------------------------------------------------
{
  const c = makeController();
  ok("一開始在 overview", c.state === CAMERA_STATES.overview, c.state);
  ok("一開始沒有 active hotspot", c.activeHotspotId === null, String(c.activeHotspotId));
  ok("一開始的姿態就是 overview", poseNear(c.pose, { position: OVERVIEW.position, target: OVERVIEW.target }));

  c.focus("draw", 0);
  ok("focus 之後進入 transitioning", c.state === CAMERA_STATES.transitioning, c.state);
  ok("transitioning 期間 isBusy", c.isBusy === true);

  const d = c.activeDuration;
  c.update(d);
  ok("到期之後進入 focused", c.state === CAMERA_STATES.focused, c.state);
  ok("focused 時 activeHotspotId 正確", c.activeHotspotId === "draw", String(c.activeHotspotId));
  ok("focused 時不再 busy", c.isBusy === false);
  ok(
    "最終位置就是設定的鏡位（容許誤差內）",
    poseNear(c.pose, { position: FIXTURE[0].cameraPosition, target: FIXTURE[0].lookAtTarget }, 1e-9),
    JSON.stringify(c.pose),
  );

  c.back(d);
  ok("back 之後進入 returning", c.state === CAMERA_STATES.returning, c.state);
  c.update(d + c.activeDuration);
  ok("回到 overview", c.state === CAMERA_STATES.overview, c.state);
  ok("回到 overview 後沒有 active hotspot", c.activeHotspotId === null);
}

// --- 2. 重複進出不能累積浮點漂移 --------------------------------------------
// lerp 到 t=1 如果是用「持續逼近」而不是「直接指派終點」，進出五十次之後
// overview 會離原位越來越遠。這條就是在守那件事。
{
  const c = makeController();
  let t = 0;
  for (let i = 0; i < 50; i += 1) {
    c.focus("tags", t);
    t += c.activeDuration;
    c.update(t);
    c.back(t);
    t += c.activeDuration;
    c.update(t);
  }
  ok(
    "進出 50 次之後 overview 鏡位一個 bit 都沒漂",
    poseNear(c.pose, { position: OVERVIEW.position, target: OVERVIEW.target }, 0),
    JSON.stringify(c.pose),
  );
  ok("進出 50 次之後仍在 overview", c.state === CAMERA_STATES.overview, c.state);
}

// --- 3. 運鏡途中切到另一個 hotspot：不瞬移、不留舊動畫 ----------------------
// 這是整個控制器最容易寫壞的一條。天真的實作會直接把 from 設成「上一個 hotspot
// 的鏡位」，於是畫面會先跳回去再走 —— 或是同時跑兩條動畫互相打架。
{
  const c = makeController();
  c.focus("draw", 0);
  const mid = c.activeDuration * 0.4;
  c.update(mid);
  const poseAtInterrupt = { position: { ...c.pose.position }, target: { ...c.pose.target } };

  c.focus("shelf", mid);
  ok("被打斷時仍然是 transitioning", c.state === CAMERA_STATES.transitioning, c.state);
  ok("被打斷時目標換成新的 hotspot", c.activeHotspotId === "shelf", String(c.activeHotspotId));
  // 要在「下一格」量，不是在 focus() 的當下：begin() 只是排好動畫，pose 要等
  // update() 才會動。在 focus() 之後馬上量，不管起點設成什麼都看不出差別 ——
  // 第一版的守衛就是這樣寫的，把 from 改成舊目標它照樣是綠的。
  c.update(mid);
  ok(
    "接續播放的第一格就是被打斷時的姿態，沒有跳回舊目標",
    poseNear(c.pose, poseAtInterrupt, 1e-9),
    `打斷時 ${JSON.stringify(poseAtInterrupt)} 下一格 ${JSON.stringify(c.pose)}`,
  );

  // 再往前推一點點，位置必須朝新目標走，而不是朝舊目標
  const before = dist(c.pose.position, FIXTURE[2].cameraPosition);
  c.update(mid + 16);
  const after = dist(c.pose.position, FIXTURE[2].cameraPosition);
  ok("打斷後是朝新目標移動", after < before, `${before} -> ${after}`);

  ok("同一時間只有一條動畫", c.activeAnimationCount === 1, String(c.activeAnimationCount));

  c.update(mid + c.activeDuration);
  ok("打斷後仍能正常抵達新目標", c.state === CAMERA_STATES.focused && c.activeHotspotId === "shelf", c.state);
  ok(
    "抵達的是新目標的鏡位",
    poseNear(c.pose, { position: FIXTURE[2].cameraPosition, target: FIXTURE[2].lookAtTarget }, 1e-9),
  );
}

// --- 4. 快速連點同一個 hotspot 不能重開面板 ---------------------------------
{
  const shown = [];
  const c = makeController({
    onPanelShow: (id) => shown.push(id),
  });
  c.focus("draw", 0);
  c.focus("draw", 1);
  c.focus("draw", 2);
  c.focus("draw", 3);
  ok("連點四次只算一次運鏡", c.activeAnimationCount === 1, String(c.activeAnimationCount));
  // 要逐格推過「面板淡入」那個門檻再跑完，才會走到「update() 開一次、finish()
  // 又開一次」那條路。直接跳到 t=1 只會經過 finish()，去重拿掉也看不出來。
  const dur = c.activeDuration;
  for (let t = 0; t <= dur; t += dur / 12) c.update(t);
  c.update(dur);
  ok("連點四次只開一次面板", shown.length === 1, JSON.stringify(shown));
  ok("開的是對的面板", shown[0] === "p-draw", String(shown[0]));

  // 已經 focused 之後再點同一個，也不該重來
  c.focus("draw", 500);
  ok("已經停在那裡時再點同一個不會重新運鏡", c.state === CAMERA_STATES.focused, c.state);
  ok("也不會再開一次面板", shown.length === 1, JSON.stringify(shown));
}

// --- 5. 面板在鏡頭快到位時才淡入，返回時先淡出 ------------------------------
{
  const events = [];
  const c = makeController({
    onPanelShow: (id) => events.push(["show", id]),
    onPanelHide: (id) => events.push(["hide", id]),
  });
  c.focus("tags", 0);
  c.update(c.activeDuration * 0.2);
  ok("運鏡才剛開始時面板還沒出現", events.length === 0, JSON.stringify(events));
  c.update(c.activeDuration * 0.9);
  ok("鏡頭快到位時面板淡入", events.length === 1 && events[0][0] === "show", JSON.stringify(events));

  c.back(c.activeDuration);
  ok(
    "按返回的當下面板就先淡出，不等鏡頭動完",
    events.length === 2 && events[1][0] === "hide" && events[1][1] === "p-tags",
    JSON.stringify(events),
  );
}

// --- 6. 運鏡期間鎖定輸入 ----------------------------------------------------
{
  const c = makeController();
  ok("overview 時接受輸入", c.acceptsPointerInput() === true);
  c.focus("draw", 0);
  ok("運鏡期間不接受手動相機控制", c.acceptsPointerInput() === false);
  c.update(c.activeDuration);
  ok("停穩之後恢復接受輸入", c.acceptsPointerInput() === true);
}

// --- 7. 運鏡時間依距離調整，但夾在合理區間 ----------------------------------
{
  ok("很近的距離不會短到看不見", durationFor(0.01) >= 700, String(durationFor(0.01)));
  ok("很遠的距離不會長到讓人等", durationFor(9999) <= 1100, String(durationFor(9999)));
  ok("距離越遠時間越長（或至少不變短）", durationFor(2) <= durationFor(8), `${durationFor(2)} / ${durationFor(8)}`);
  ok("easing 不是線性", !near(easeInOutCubic(0.25), 0.25, 0.02), String(easeInOutCubic(0.25)));
  ok("easing 端點正確", easeInOutCubic(0) === 0 && easeInOutCubic(1) === 1);
  ok("easing 中點是 0.5（對稱）", near(easeInOutCubic(0.5), 0.5, 1e-12), String(easeInOutCubic(0.5)));
}

// --- 8. reduced motion：不做位移動畫，直接到位 ------------------------------
{
  const events = [];
  const c = makeController({
    reducedMotion: true,
    onPanelShow: (id) => events.push(["show", id]),
  });
  c.focus("draw", 0);
  ok("reduced motion 下運鏡時間是 0", c.activeDuration === 0, String(c.activeDuration));
  ok("reduced motion 下直接就是 focused，不經過 transitioning", c.state === CAMERA_STATES.focused, c.state);
  ok(
    "reduced motion 下姿態直接到位",
    poseNear(c.pose, { position: FIXTURE[0].cameraPosition, target: FIXTURE[0].lookAtTarget }, 0),
  );
  ok("reduced motion 下面板照樣出現", events.length === 1, JSON.stringify(events));
}

// --- 9. fallback 狀態 -------------------------------------------------------
{
  const c = makeController();
  c.focus("draw", 0);
  c.setFallback("webgl-lost");
  ok("進入 fallback", c.state === CAMERA_STATES.fallback, c.state);
  ok("fallback 記得原因", c.fallbackReason === "webgl-lost", String(c.fallbackReason));
  ok("fallback 之後沒有進行中的動畫", c.activeAnimationCount === 0, String(c.activeAnimationCount));
  c.focus("tags", 10);
  ok("fallback 之後 focus 不再有作用", c.state === CAMERA_STATES.fallback, c.state);
}

// --- 10. 重複進出不累積監聽器／動畫 -----------------------------------------
{
  const c = makeController();
  let t = 0;
  for (let i = 0; i < 30; i += 1) {
    c.focus(FIXTURE[i % 3].id, t);
    t += 10;
  }
  ok("連續切換 30 次仍然只有一條動畫", c.activeAnimationCount === 1, String(c.activeAnimationCount));
  c.destroy();
  ok("destroy 之後沒有動畫", c.activeAnimationCount === 0, String(c.activeAnimationCount));
  ok("destroy 之後 focus 不再有作用", (c.focus("draw", 0), c.state === CAMERA_STATES.fallback || c.activeAnimationCount === 0));
}

// --- 11. 未知 hotspot 要講清楚，不要靜靜不動 --------------------------------
{
  const c = makeController();
  let err = null;
  c.onError = (e) => {
    err = e;
  };
  c.focus("沒有這個", 0);
  ok("未知 id 不會改變狀態", c.state === CAMERA_STATES.overview, c.state);
  ok("未知 id 會回報錯誤", !!err && /沒有這個/.test(err.message), err ? err.message : "(沒有回報)");
}

// --- 12. hotspot 設定檔的完整性 ---------------------------------------------
{
  const report = validateHotspots(STUDIO_HOTSPOTS);
  ok(
    `內建 ${STUDIO_HOTSPOTS.length} 個 hotspot 全部合法`,
    report.ok,
    report.problems.join("; "),
  );
  ok("id 不重複", new Set(STUDIO_HOTSPOTS.map((h) => h.id)).size === STUDIO_HOTSPOTS.length);
  ok("objectName 不重複", new Set(STUDIO_HOTSPOTS.map((h) => h.objectName)).size === STUDIO_HOTSPOTS.length);
  ok(
    "objectName 一律是 HOTSPOT_ 開頭的大寫節點名",
    STUDIO_HOTSPOTS.every((h) => /^HOTSPOT_[A-Z0-9_]+$/.test(h.objectName)),
    STUDIO_HOTSPOTS.map((h) => h.objectName).join(", "),
  );
  ok("hotspotById 找得到", hotspotById(STUDIO_HOTSPOTS, "draw")?.id === "draw");
  ok("hotspotById 找不到時回 null", hotspotById(STUDIO_HOTSPOTS, "nope") === null);

  // 缺欄位要有明確診斷，不是靜靜壞掉
  const bad = validateHotspots([
    { id: "a", panelId: "p", cameraPosition: { x: 0, y: 0, z: 0 }, lookAtTarget: { x: 0, y: 0, z: 1 } },
    { id: "b", objectName: "HOTSPOT_B", cameraPosition: { x: 0, y: 0, z: 0 }, lookAtTarget: { x: 0, y: 0, z: 1 } },
    { id: "c", objectName: "HOTSPOT_C", panelId: "p2", lookAtTarget: { x: 0, y: 0, z: 1 } },
  ]);
  ok("缺 objectName 會被指名", bad.problems.some((p) => /a/.test(p) && /objectName/.test(p)), bad.problems.join("; "));
  ok("缺 panelId 會被指名", bad.problems.some((p) => /b/.test(p) && /panelId/.test(p)), bad.problems.join("; "));
  ok("缺鏡位會被指名", bad.problems.some((p) => /c/.test(p) && /cameraPosition/.test(p)), bad.problems.join("; "));
  ok("相機位置與注視點重合要被擋下（算不出朝向）",
    validateHotspots([{ id: "d", objectName: "HOTSPOT_D", panelId: "p", cameraPosition: { x: 1, y: 1, z: 1 }, lookAtTarget: { x: 1, y: 1, z: 1 } }])
      .problems.some((p) => /d/.test(p)),
  );
}

// --- 13. 模式優先順序：URL > localStorage > 預設 2D -------------------------
{
  const caps = { webgl: true, reducedData: false, forcedTwoD: false };
  ok("什麼都沒有時預設 2D", resolveViewMode({ capabilities: caps }).mode === VIEW_MODES.flat);
  ok(
    "localStorage 記得 studio 就進 studio",
    resolveViewMode({ stored: "studio", capabilities: caps }).mode === VIEW_MODES.studio,
  );
  ok(
    "URL 指定 2d 時蓋過 localStorage 的 studio",
    resolveViewMode({ urlParam: "2d", stored: "studio", capabilities: caps }).mode === VIEW_MODES.flat,
  );
  ok(
    "URL 指定 studio 時蓋過 localStorage 的 2d",
    resolveViewMode({ urlParam: "studio", stored: "2d", capabilities: caps }).mode === VIEW_MODES.studio,
  );
  ok(
    "無法辨識的 URL 參數就當作沒給，退回 localStorage",
    resolveViewMode({ urlParam: "3dd", stored: "studio", capabilities: caps }).mode === VIEW_MODES.studio,
  );

  // 裝置不行時一律 2D，而且說得出原因 —— 否則會陷入「載入失敗→重試→再失敗」的迴圈
  const noGl = resolveViewMode({ urlParam: "studio", stored: "studio", capabilities: { webgl: false } });
  ok("沒有 WebGL 時強制 2D", noGl.mode === VIEW_MODES.flat, noGl.mode);
  ok("沒有 WebGL 時說得出原因", noGl.forced === true && /webgl/i.test(noGl.reason), noGl.reason);

  const lowData = resolveViewMode({ urlParam: "studio", capabilities: { webgl: true, reducedData: true } });
  ok("使用者要求省流量時強制 2D", lowData.mode === VIEW_MODES.flat && lowData.forced === true, lowData.reason);

  const burned = resolveViewMode({ urlParam: "studio", capabilities: { webgl: true, forcedTwoD: true } });
  ok("本次 session 已被標記強制 2D 時不再嘗試", burned.mode === VIEW_MODES.flat && burned.forced === true, burned.reason);
}

// --- 14. 效能策略 -----------------------------------------------------------
{
  ok("devicePixelRatio 有上限", clampPixelRatio(3, QUALITY_TIERS.high) <= 2, String(clampPixelRatio(3, QUALITY_TIERS.high)));
  ok("低畫質模式上限更低", clampPixelRatio(3, QUALITY_TIERS.low) < clampPixelRatio(3, QUALITY_TIERS.high));
  ok("不會把低 dpr 硬拉高", near(clampPixelRatio(1, QUALITY_TIERS.high), 1));
  ok("dpr 壞值有安全下限", clampPixelRatio(0, QUALITY_TIERS.high) >= 1 && clampPixelRatio(NaN, QUALITY_TIERS.high) >= 1);

  ok("分頁在背景時不畫", shouldRender({ visible: false, animating: true, dirty: true }) === false);
  ok("沒動畫也沒髒就不畫（按需渲染）", shouldRender({ visible: true, animating: false, dirty: false }) === false);
  ok("有動畫就要畫", shouldRender({ visible: true, animating: true, dirty: false }) === true);
  ok("狀態變髒就要畫", shouldRender({ visible: true, animating: false, dirty: true }) === true);

  ok("fps 掉下去會降級", degradeTier(QUALITY_TIERS.high, 20) === QUALITY_TIERS.medium, degradeTier(QUALITY_TIERS.high, 20));
  ok("再掉繼續降", degradeTier(QUALITY_TIERS.medium, 20) === QUALITY_TIERS.low, degradeTier(QUALITY_TIERS.medium, 20));
  ok("降到底就不再降", degradeTier(QUALITY_TIERS.low, 5) === QUALITY_TIERS.low);
  ok("fps 正常時不降級", degradeTier(QUALITY_TIERS.high, 58) === QUALITY_TIERS.high);

  // 降級要真的少做事。即時燈是弱機器上最貴的東西，而這件事以前只寫在設定物件裡
  // （maxLights），沒有任何一行程式讀它 —— 也就是「低畫質模式」根本沒有變低。
  ok(
    "高階三種角色的燈都點",
    tierSettings(QUALITY_TIERS.high).lights.length === 3,
    JSON.stringify(tierSettings(QUALITY_TIERS.high).lights),
  );
  ok("中階關掉純裝飾的燈", !lightOnAt(QUALITY_TIERS.medium, LIGHT_ROLES.accent));
  ok("中階保留氣氛光", lightOnAt(QUALITY_TIERS.medium, LIGHT_ROLES.ambience));
  ok("低階只剩必要的燈", !lightOnAt(QUALITY_TIERS.low, LIGHT_ROLES.ambience));
  ok(
    "必要的燈在每一階都點著 —— 全關掉的房間不叫低畫質，叫壞掉",
    [QUALITY_TIERS.high, QUALITY_TIERS.medium, QUALITY_TIERS.low].every((t) =>
      lightOnAt(t, LIGHT_ROLES.essential),
    ),
  );
  ok("沒標角色的燈當成必要的，不會被誤關", lightOnAt(QUALITY_TIERS.low, undefined) === true);
  ok("只有高階開陰影", tierSettings(QUALITY_TIERS.high).shadows && !tierSettings(QUALITY_TIERS.low).shadows);
  ok(
    "maxLights 這個沒人讀的死設定已經拿掉",
    !/maxLights/.test(readFileSync(join(ROOT, "web/studio/performance-policy.js"), "utf8")),
    "留著一個沒有任何程式讀的設定，等於謊稱低畫質模式有作用",
  );
}

// --- 15. 原始碼層面的守衛 ---------------------------------------------------
// 這幾條守的是「別把架構搬回去」，不是行為。
{
  const CR = String.fromCharCode(13);
  const read = (p) => readFileSync(join(ROOT, p), "utf8").split(CR).join("");

  for (const f of ["camera-controller.js", "hotspots.js", "mode-policy.js", "performance-policy.js"]) {
    const src = read("web/studio/" + f);
    ok(
      `${f} 不 import three.js（否則就沒辦法在 node 裡測）`,
      !/from\s+["'][^"']*three/.test(src),
      f,
    );
    ok(`${f} 不碰 document／window`, !/\bdocument\.|\bwindow\./.test(src), f);
  }

  const boot = read("web/boot.js");
  ok(
    "3D 是延後載入的，不會拖慢 2D 首次可操作",
    /import\(\s*["']\.\/studio\/index\.js["']\s*\)/.test(boot),
    "boot.js 應該用動態 import() 載入 studio，而不是靜態 import",
  );

  const html = read("web/index.html");
  ok("有 importmap 把 three 指到 vendor（離線可用）", /"three":\s*"\.\/vendor\/three\//.test(html));
  ok("2D 的 DOM 仍然原封不動留在 index.html", /id="stage"/.test(html) && /id="sec-rules"/.test(html));

  const view = read("web/studio/view-controller.js");
  // 找的是真的呼叫（帶括號），不是註解裡提到這個字 —— 第一版的守衛就是被自己的
  // 註解「這裡沒有 location.reload」比中的，那種守衛只會製造假紅燈。
  ok(
    "切換模式不重新整理頁面",
    !/location\.reload\s*\(/.test(view) && !/location\.href\s*=[^=]/.test(view),
    "view-controller 不該用重新整理來切換模式",
  );
  ok(
    "切回 2D 時會把 3D 外殼收起來（render loop 才停得掉）",
    /studio\??\.?\.hide\?\.\(\)|studio\?\.hide\?\.\(\)/.test(view) || /\.hide\?\.\(\)/.test(view),
    "applyFlat() 必須叫 studio.hide()",
  );
  const shellSrc = read("web/studio/studio-shell.js");
  ok(
    "3D 外殼收起來時真的取消 rAF",
    /cancelAnimationFrame\(/.test(shellSrc) && /stopLoop\(\)/.test(shellSrc),
    "studio-shell 的 hide()/stopLoop() 必須 cancelAnimationFrame",
  );
  ok(
    "分頁切到背景會停掉 render loop",
    /visibilitychange/.test(shellSrc) && /document\.hidden/.test(shellSrc),
    "看不到的時候不該繼續畫",
  );
  ok(
    "只對 hotspot 節點做 raycast，不是整個場景",
    /intersectObjects\(\s*pickTargets/.test(shellSrc),
    "對整個場景 raycast 會把牆壁和地板也算進去",
  );
  ok(
    "raycast 只在指標事件裡做，不是每一格",
    !/function frame[\s\S]{0,800}?intersectObjects/.test(shellSrc),
    "每一格都 raycast 是沒必要的固定成本",
  );

  // .dock 同時是「2D 要藏的東西」和「抽取面板要借的東西」。借進來時如果不把
  // data-studio-hidden 拿掉，面板裡的「抽並生圖」就是 display:none —— 實測踩過。
  const bridgeSrc = read("web/studio/studio-bridge.js");
  ok(
    "借進面板的元素會先解除「被藏起來」的狀態",
    /data-studio-hidden/.test(bridgeSrc) && /removeAttribute\("data-studio-hidden"\)/.test(bridgeSrc),
    "adoptNode 必須處理 data-studio-hidden，否則 .dock 借進來還是看不見",
  );
  ok(
    "還回去的時候要把那個狀態原樣裝回去",
    /setAttribute\("data-studio-hidden"/.test(bridgeSrc),
    "不還原的話切回 2D 會多出一塊本來該藏的東西",
  );
  ok(
    "借走之前會埋錨，關閉時放回原位而不是接在最後面",
    /createComment\("studio-anchor/.test(bridgeSrc),
    "",
  );
  ok(
    "3D 面板不自己實作抽取，只借既有 DOM 或按既有按鈕",
    !/indexLexicon|drawOne|mulberry32/.test(bridgeSrc),
    "studio-bridge 一旦碰引擎就會出現第二份狀態",
  );

  // 按需渲染最容易漏的就是「改了狀態卻忘了排下一格」。實測從鍵盤那排功能點
  // 按下去時整個畫面不動，就是這個原因。
  ok(
    "markDirty 會順便把 render loop 叫起來",
    /const markDirty = \(\) => \{[\s\S]{0,160}?schedule\(\);/.test(shellSrc),
    "否則每個改狀態的呼叫端都要自己記得 schedule()，遲早漏掉",
  );

  // 進得去就一定要出得來。桅杆上那顆切換鈕在 .mast 裡，而 .mast 在 3D 模式下是
  // 藏起來的 —— 第一版就是這樣把人關在房間裡，畫面上一個離開 3D 的入口都沒有。
  ok(
    "HUD 裡有離開 3D 的按鈕",
    /id="studio-exit"/.test(shellSrc),
    "桅杆的切換鈕在 3D 模式下是藏起來的，HUD 不給出口就等於關人",
  );
  ok(
    "那顆按鈕真的會呼叫 onExit",
    /#studio-exit[\s\S]{0,120}?onExit\(\)/.test(shellSrc),
    "",
  );
  ok(
    "離開 3D 和返回房間是兩顆不同的鈕",
    /id="studio-back"/.test(shellSrc) && /id="studio-exit"/.test(shellSrc),
    "返回房間只回到總覽，還在 3D 裡；兩件事混成一顆就沒有人找得到出口",
  );
  ok(
    "Esc 在總覽時會整個離開 3D（逐層往外退）",
    /CAMERA_STATES\.overview\)[\s\S]{0,40}?onExit\(\);/.test(shellSrc),
    "Esc 按到底卻還在房間裡，就會覺得被關住",
  );
  ok(
    "離開 3D 的按鈕有 aria-label",
    /id="studio-exit"[^>]*aria-label=/.test(shellSrc),
    "",
  );

  // 視差：只在總覽時做、reduced-motion 下整個關掉、幅度有上限。
  ok(
    "總覽時的視差存在",
    /PARALLAX_MAX/.test(shellSrc) && /stepParallax/.test(shellSrc),
    "完全靜止的 3D 畫面看起來像截圖",
  );
  ok(
    "reduced-motion 下不做視差",
    /function stepParallax\(\)[\s\S]{0,120}?if \(reducedMotion\) return false;/.test(shellSrc),
    "位移動畫在 reduced-motion 下要關掉",
  );
  ok(
    "視差只在總覽時生效，不跟運鏡打架",
    /cam\.state === CAMERA_STATES\.overview && !cam\.isBusy/.test(shellSrc),
    "運鏡中再疊一層偏移會抖",
  );
  ok("視差幅度有上限", /PARALLAX_MAX = 0\.\d+/.test(shellSrc), "");

  // 面板進場用 transform，不是會改版面的屬性 —— 裡面借來的 2D 元素不能被重新量。
  const cssSrc = read("web/studio/studio.css");
  ok(
    "面板進場用 transform 位移",
    /@keyframes studio-panel-in[\s\S]{0,200}?translate3d/.test(cssSrc),
    "",
  );
  ok(
    "面板進場不碰 left／width／height 這類會改版面的屬性",
    !/@keyframes studio-panel-in[\s\S]{0,260}?(left|width|height):/.test(cssSrc),
    "那會讓借進來的 2D 面板重新量一次版面",
  );

  // 色彩管線。沒有這三行，一個再好的場景也會看起來像「電腦畫的」。
  ok(
    "有 ACES tone mapping 與正確的輸出色彩空間",
    /ACESFilmicToneMapping/.test(shellSrc) && /outputColorSpace/.test(shellSrc),
    "",
  );
  ok("有環境反射貼圖（否則 PBR 材質會像塑膠）", /scene\.environment = envMap/.test(shellSrc), "");
  ok(
    "envMap 在 renderer 之後才建（PMREM 需要 renderer）",
    shellSrc.indexOf("new THREE.WebGLRenderer") < shellSrc.indexOf("studioEnvironment(THREE, renderer)"),
    "順序反了會是 TDZ 錯誤，整個 3D 開不起來 —— 踩過一次",
  );

  ok(
    "面板開著時 HUD 整排往左讓，離開 3D 的出口不會被蓋住",
    /has-panel \.studio-hud-top/.test(read("web/studio/studio.css")),
    "面板 z-index 比 HUD 高，不讓開就等於又把出口藏起來",
  );

  // 鍵盤焦點要在房間裡看得見。canvas 進不了 tab 序，所以用鍵盤的人原本
  // 完全看不出自己選的是房間裡的哪一樣東西 —— 滑鼠有 hover，鍵盤什麼都沒有。
  ok(
    "功能點按鈕拿到鍵盤焦點時，房間裡對應的物件會亮起來",
    /addEventListener\("focus"[\s\S]{0,200}?setKeyboardLift/.test(shellSrc),
    "鍵盤使用者看不到自己選到哪一個",
  );
  ok(
    "焦點離開整排功能點才熄掉，在按鈕之間移動不會閃",
    /addEventListener\("blur"[\s\S]{0,260}?studio-key/.test(shellSrc),
    "",
  );
  ok(
    "滑鼠 hover 和鍵盤高亮互不干擾",
    /hovered !== kbLit/.test(shellSrc),
    "一個關掉時會把另一個也熄掉",
  );

  // 螢幕是房間的主角。原本是一塊純色板子，那是整個場景最假的地方。
  ok("螢幕上有畫東西", /screenTexture/.test(read("web/studio/scene-loader.js")), "");
  ok(
    "螢幕靠自發光，不是靠打光照亮",
    /emissiveMap: scrTex/.test(read("web/studio/scene-loader.js")),
    "靠打光照出來的螢幕永遠像一塊反光的板子",
  );
  ok(
    "螢幕不是鏡面（否則反射光會燒掉畫面）",
    /roughness: 0\.5\d/.test(read("web/studio/scene-loader.js")),
    "roughness 太低時反射會在面板上燒出一塊白斑",
  );
  ok("大面積表面有雜訊 roughnessMap", /noiseRoughness/.test(read("web/studio/scene-loader.js")), "純色大面積會看起來像塑膠");

  // 場景裡的燈要標角色，降級才知道關哪幾盞。
  const sceneSrc = read("web/studio/scene-loader.js");
  ok(
    "場景的燈有標角色",
    /userData\.role = LIGHT_ROLES\./.test(sceneSrc),
    "沒標就全部被當成必要的，降級等於沒降",
  );
  ok(
    "最貴的 SpotLight 歸在純裝飾那一階",
    /SpotLight[\s\S]{0,200}?userData\.role = LIGHT_ROLES\.accent/.test(sceneSrc),
    "",
  );
  ok(
    "降級時真的去改燈的 visible",
    /lightOnAt\(tier, light\.userData\.role\)/.test(shellSrc),
    "applyTier 要真的關燈，不是只改 shadowMap",
  );

  const viewSrc2 = read("web/studio/view-controller.js");
  ok(
    "onExit 真的接到「切回平面」",
    /onExit:\s*\(\)\s*=>\s*setMode\(VIEW_MODES\.flat/.test(viewSrc2),
    "shell 喊了 onExit 卻沒人接，按鈕就是裝飾",
  );

  // 暗房／活字樓／抽籤棚共用 web/ 的靜態檔，但沒有 studio.css 也沒有 importmap。
  // 讓它們半吊子地跑起來，比不跑更糟。
  const idxSrc = read("web/studio/index.js");
  ok(
    "版面要自己掛 studio.css 才會啟用 3D",
    /layoutOptedIn/.test(idxSrc) && /studio\/studio\.css/.test(idxSrc),
    "否則另外三套版面會拿到一個沒有樣式的 3D 外殼",
  );
  for (const alt of ["web1", "web2", "web3"]) {
    const altHtml = read(alt + "/index.html");
    ok(
      `${alt} 沒有被動到（仍然沒有 studio.css，維持純 2D）`,
      !/studio\/studio\.css/.test(altHtml),
      alt + " 不該被這次改動牽連",
    );
  }

  const lic = read("web/vendor/three/LICENSE");
  ok("three.js 的 MIT 授權聲明有保留", /MIT License/i.test(lic) && /three\.js authors/i.test(lic));
}

if (failed) {
  console.error(NL + failed + " failed");
  process.exit(1);
}
console.log(NL + "ok");
