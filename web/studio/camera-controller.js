/**
 * 運鏡狀態機。
 *
 * 這個檔案刻意不 import three.js，也不碰 document / window —— 它只在純資料上
 * 運算姿態（position + lookAt target），這樣才能在 node 裡逐格推進時間，量出
 * 「運鏡到一半被打斷會不會瞬移」這種只有在時間軸上才看得見的行為。
 * 三維的部分由 hotspot-controller / scene-loader 把這裡算出來的姿態套到相機上。
 *
 * 為什麼是插值 position + target，而不是插值旋轉：
 * 對 Euler angles 做 lerp 會在跨越 ±180° 時走遠路（整個場景會繞一圈），而 slerp
 * 雖然正確卻需要先把「看向某點」轉成四元數、動完再轉回來。這個房間的所有鏡位都是
 * 「站在某處、看著某個東西」，直接插值那兩個點天生就不會有跨越問題，而且相反方向
 * 切換（draw 在左、shelf 在右）也只是兩條直線，沒有角度環繞可言。
 */

export const CAMERA_STATES = {
  overview: "overview",
  transitioning: "transitioning",
  focused: "focused",
  returning: "returning",
  fallback: "fallback",
};

const MIN_MS = 700;
const MAX_MS = 1100;
// 面板在鏡頭「快到位」時才淡入。太早會看到面板浮在還在移動的背景上，
// 太晚則會讓人覺得點了沒反應。0.72 是鏡頭已經幾乎停住、但還在收尾的位置。
const PANEL_IN_AT = 0.72;

export function easeInOutCubic(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** 距離越遠給越多時間，但夾在 700～1100ms：短到看不清楚在動、長到讓人等，都不行。 */
export function durationFor(distance) {
  const d = Number.isFinite(distance) ? Math.abs(distance) : 0;
  const t = Math.min(1, d / 12);
  return Math.round(MIN_MS + (MAX_MS - MIN_MS) * t);
}

const vec = (v) => ({ x: Number(v?.x) || 0, y: Number(v?.y) || 0, z: Number(v?.z) || 0 });
const copy = (v) => ({ x: v.x, y: v.y, z: v.z });
const lerp = (a, b, t) => a + (b - a) * t;
const lerpVec = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function createCameraController(opts) {
  const options = opts || {};
  const overview = {
    position: vec(options.overview?.position),
    target: vec(options.overview?.target),
  };
  const hotspots = Array.isArray(options.hotspots) ? options.hotspots.slice() : [];
  const reducedMotion = !!options.reducedMotion;
  const onPanelShow = typeof options.onPanelShow === "function" ? options.onPanelShow : null;
  const onPanelHide = typeof options.onPanelHide === "function" ? options.onPanelHide : null;
  const onStateChange = typeof options.onStateChange === "function" ? options.onStateChange : null;

  let state = CAMERA_STATES.overview;
  let activeId = null;
  let fallbackReason = null;
  let destroyed = false;
  // 姿態永遠只有這一份。被打斷時新動畫的起點就是「現在這一份」，
  // 所以畫面不可能跳 —— 這是第 3 條測試在守的東西。
  let pose = { position: copy(overview.position), target: copy(overview.target) };
  // 同一時間最多一條。不是陣列，是因為「累積多條動畫」正是要避免的失敗方式。
  let anim = null;
  let panelShownFor = null;

  const api = {
    onError: null,
  };

  function fail(message) {
    const err = new Error(message);
    if (typeof api.onError === "function") api.onError(err);
    else if (typeof options.onError === "function") options.onError(err);
    return err;
  }

  function setState(next) {
    if (state === next) return;
    state = next;
    if (onStateChange) onStateChange(state, activeId);
  }

  function hotspot(id) {
    for (const h of hotspots) if (h && h.id === id) return h;
    return null;
  }

  function showPanel(panelId) {
    if (!panelId || panelShownFor === panelId) return;
    panelShownFor = panelId;
    if (onPanelShow) onPanelShow(panelId);
  }

  function hidePanel() {
    if (!panelShownFor) return;
    const id = panelShownFor;
    panelShownFor = null;
    if (onPanelHide) onPanelHide(id);
  }

  /** 終點直接指派，不用 lerp 的結果 —— 這樣進出五十次也不會累積浮點漂移。 */
  function settle(to) {
    pose = { position: copy(to.position), target: copy(to.target) };
  }

  function begin(to, nowMs, nextState, panelId) {
    const from = { position: copy(pose.position), target: copy(pose.target) };
    const ms = reducedMotion ? 0 : durationFor(distance(from.position, to.position));
    if (ms <= 0) {
      anim = null;
      settle(to);
      setState(nextState === CAMERA_STATES.transitioning ? CAMERA_STATES.focused : CAMERA_STATES.overview);
      if (nextState === CAMERA_STATES.transitioning) showPanel(panelId);
      else activeId = null;
      return;
    }
    // 直接覆寫。舊的那條就此不存在，不會有兩條動畫同時跑。
    anim = { from, to, start: Number(nowMs) || 0, ms, panelId, kind: nextState };
    setState(nextState);
  }

  function finish() {
    if (!anim) return;
    const done = anim;
    anim = null;
    settle(done.to);
    if (done.kind === CAMERA_STATES.transitioning) {
      setState(CAMERA_STATES.focused);
      showPanel(done.panelId);
    } else {
      activeId = null;
      setState(CAMERA_STATES.overview);
    }
  }

  Object.defineProperties(api, {
    state: { get: () => state },
    activeHotspotId: { get: () => activeId },
    fallbackReason: { get: () => fallbackReason },
    pose: { get: () => ({ position: copy(pose.position), target: copy(pose.target) }) },
    isBusy: {
      get: () => state === CAMERA_STATES.transitioning || state === CAMERA_STATES.returning,
    },
    activeAnimationCount: { get: () => (anim ? 1 : 0) },
    activeDuration: { get: () => (anim ? anim.ms : 0) },
    overviewPose: { get: () => ({ position: copy(overview.position), target: copy(overview.target) }) },
  });

  /** 運鏡期間不接受手動相機控制，否則使用者會跟動畫搶同一個相機。 */
  api.acceptsPointerInput = () => !api.isBusy && state !== CAMERA_STATES.fallback;

  api.focus = (id, nowMs) => {
    if (destroyed || state === CAMERA_STATES.fallback) return false;
    // 已經停在那裡、或正往那裡去：連點不該重來，也不該再開一次面板。
    if (activeId === id && (state === CAMERA_STATES.focused || state === CAMERA_STATES.transitioning)) {
      return false;
    }
    const h = hotspot(id);
    if (!h) {
      fail(`找不到 hotspot：${id}`);
      return false;
    }
    activeId = id;
    begin(
      { position: vec(h.cameraPosition), target: vec(h.lookAtTarget) },
      nowMs,
      CAMERA_STATES.transitioning,
      h.panelId,
    );
    return true;
  };

  api.back = (nowMs) => {
    if (destroyed || state === CAMERA_STATES.fallback) return false;
    if (state === CAMERA_STATES.overview) return false;
    // 面板先走，鏡頭後退 —— 反過來會看到面板懸在移動中的畫面上。
    hidePanel();
    begin(overview, nowMs, CAMERA_STATES.returning, null);
    if (!anim) activeId = null;
    return true;
  };

  api.update = (nowMs) => {
    if (!anim) return api.pose;
    const t = anim.ms <= 0 ? 1 : ((Number(nowMs) || 0) - anim.start) / anim.ms;
    if (t >= 1) {
      finish();
      return api.pose;
    }
    const e = easeInOutCubic(Math.max(0, t));
    pose = {
      position: lerpVec(anim.from.position, anim.to.position, e),
      target: lerpVec(anim.from.target, anim.to.target, e),
    };
    if (anim.kind === CAMERA_STATES.transitioning && e >= PANEL_IN_AT) showPanel(anim.panelId);
    return api.pose;
  };

  api.setFallback = (reason) => {
    fallbackReason = reason || "unknown";
    anim = null;
    hidePanel();
    activeId = null;
    setState(CAMERA_STATES.fallback);
  };

  api.destroy = () => {
    destroyed = true;
    anim = null;
    hidePanel();
    activeId = null;
    api.onError = null;
  };

  return api;
}
