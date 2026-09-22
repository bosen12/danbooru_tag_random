/**
 * 兩個 shell 的生命週期。
 *
 * 最重要的一條規則：**2D 的 DOM 從頭到尾都活著**。切到 3D 只是把它隱藏起來，
 * 不是拆掉重建。因為 Tag 引擎、釘選集合、生成佇列、SSE 連線、LoRA 輪詢全部掛在
 * 那份 DOM 和 boot.js 的模組狀態上 —— 重建等於重來一次，而那正是規格裡
 * 「切換模式不得重新建立 Tag 引擎或改變 RNG 狀態」在講的事。
 *
 * 所以這裡沒有 location.reload，也沒有任何「重新初始化」的路徑。
 *
 * 捲動位置要自己存：把 .shell 之類的容器設成 display:none 之後頁面高度會塌，
 * 瀏覽器會把 scrollY 歸零，切回來就跳到最上面。
 */

import { VIEW_MODES, resolveViewMode } from "./mode-policy.js";

const STORE_KEY = "tag-case-view";
// 2D 那一側要藏起來的東西。彈窗（.lora-modal / #album-modal / …）刻意不在這張表裡：
// 它們正是 3D 要叫出來的「真正的操作介面」，藏掉就什麼都不剩了。
const FLAT_SELECTORS = [".mast", ".shell", ".dock", ".jump", ".skip"];

function readStored() {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

function writeStored(mode) {
  try {
    localStorage.setItem(STORE_KEY, mode);
  } catch {
    /* 無痕模式或封鎖 storage：記不住就算了，不該因此壞掉 */
  }
}

export function detectCapabilities() {
  let webgl = false;
  try {
    const canvas = document.createElement("canvas");
    webgl = !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    webgl = false;
  }
  let reducedData = false;
  try {
    reducedData = !!window.matchMedia?.("(prefers-reduced-data: reduce)")?.matches;
  } catch {
    reducedData = false;
  }
  return { webgl, reducedData, forcedTwoD: false };
}

export function createViewController(opts) {
  const options = opts || {};
  const doc = document;
  const root = doc.documentElement;
  // 這次開啟是否已經被燒掉。3D 失敗過就不要在同一次 session 裡一試再試 ——
  // 那會變成「失敗→回 2D→又進 3D→又失敗」的迴圈。
  let forcedTwoD = false;
  let mode = VIEW_MODES.flat;
  let studio = null;         // 延後建立，而且只建立一次
  let studioBooting = null;  // 同一個 promise，避免連點時開出兩個 renderer
  let savedScrollY = 0;
  let destroyed = false;

  const listeners = new Set();
  const emit = (name, detail) => {
    for (const fn of listeners) {
      try {
        fn(name, detail);
      } catch {
        /* 一個聽眾炸掉不該拖垮切換 */
      }
    }
  };

  function flatNodes() {
    const out = [];
    for (const sel of FLAT_SELECTORS) {
      for (const el of doc.querySelectorAll(sel)) out.push(el);
    }
    return out;
  }

  function showFlat(show) {
    for (const el of flatNodes()) {
      if (show) el.removeAttribute("data-studio-hidden");
      else el.setAttribute("data-studio-hidden", "1");
      // inert 一起下，免得藏起來的那一側還留在 tab 序裡
      if ("inert" in el) el.inert = !show;
    }
    root.classList.toggle("studio-on", !show);
  }

  async function ensureStudio() {
    if (studio) return studio;
    if (studioBooting) return studioBooting;
    studioBooting = (async () => {
      const mod = await import("./studio-shell.js");
      const made = await mod.createStudioShell({
        onExit: () => setMode(VIEW_MODES.flat, { reason: "使用者離開 3D" }),
        onFatal: (reason) => {
          // 載入超時、WebGL 不可用、連續 context lost：這次開啟不再進 3D。
          forcedTwoD = true;
          setMode(VIEW_MODES.flat, { reason, forced: true });
        },
        reducedMotion: !!options.reducedMotion,
      });
      studio = made;
      return made;
    })();
    try {
      return await studioBooting;
    } finally {
      studioBooting = null;
    }
  }

  async function enterStudio() {
    let shell;
    try {
      shell = await ensureStudio();
    } catch (err) {
      forcedTwoD = true;
      emit("fatal", { reason: "3D 模組載入失敗：" + (err?.message || err) });
      applyFlat();
      return;
    }
    if (destroyed || mode !== VIEW_MODES.studio) {
      // 使用者在載入途中又切回去了 —— 不要硬把畫面搶回來
      shell?.hide?.();
      return;
    }
    savedScrollY = window.scrollY || 0;
    showFlat(false);
    shell.show();
    emit("mode", { mode: VIEW_MODES.studio });
  }

  function applyFlat() {
    mode = VIEW_MODES.flat;
    // 先停掉 render loop 再顯示 2D：反過來的話會有一兩格同時在畫兩邊。
    studio?.hide?.();
    showFlat(true);
    // 版面回來了才還原捲動位置，否則還沒有可捲的高度。
    // display 一改，版面是同步重算的，所以這裡馬上就捲得動；再補一次 rAF 是為了
    // 網頁字體或圖片晚到而改變高度的情況。只靠 rAF 不行 —— 分頁在背景或被節流時
    // 那個 callback 可能很久才來，使用者會先看到畫面停在最上面。
    const restore = () => {
      if (savedScrollY > 0) window.scrollTo(0, savedScrollY);
    };
    restore();
    requestAnimationFrame(restore);
    emit("mode", { mode: VIEW_MODES.flat });
  }

  function setMode(next, meta) {
    if (destroyed) return mode;
    const want = next === VIEW_MODES.studio ? VIEW_MODES.studio : VIEW_MODES.flat;
    const decided = resolveViewMode({
      urlParam: want,
      capabilities: { ...(options.capabilities || detectCapabilities()), forcedTwoD },
    });
    if (decided.mode === VIEW_MODES.studio) {
      mode = VIEW_MODES.studio;
      writeStored(VIEW_MODES.studio);
      syncToggle();
      enterStudio();
    } else {
      // 被強制回 2D 時不要把「使用者想要 3D」這件事洗掉 —— 下次換台機器還是該進 3D。
      if (!decided.forced) writeStored(VIEW_MODES.flat);
      applyFlat();
      syncToggle();
      if (meta?.forced || decided.forced) {
        emit("forced-flat", { reason: meta?.reason || decided.reason });
      }
    }
    return mode;
  }

  // --- 切換按鈕 -------------------------------------------------------------
  let toggle = null;
  function syncToggle() {
    if (!toggle) return;
    const on = mode === VIEW_MODES.studio;
    toggle.setAttribute("aria-pressed", on ? "true" : "false");
    toggle.setAttribute("aria-label", on ? "切換到平面工作台" : "切換到 3D 工作室");
    toggle.title = on ? "平面工作台" : "3D 工作室";
    const label = toggle.querySelector(".studio-toggle-label");
    if (label) label.textContent = on ? "平面" : "3D";
  }

  function mountToggle() {
    const tools = doc.getElementById("mast-tools");
    if (!tools || doc.getElementById("studio-toggle")) return;
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.id = "studio-toggle";
    btn.className = "ghost studio-toggle";
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 3 3 7.5v9L12 21l9-4.5v-9Z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/></svg>' +
      '<span class="studio-toggle-label">3D</span>';
    btn.addEventListener("click", () => {
      setMode(mode === VIEW_MODES.studio ? VIEW_MODES.flat : VIEW_MODES.studio);
    });
    const ping = doc.getElementById("ping");
    if (ping && ping.parentNode === tools) tools.insertBefore(btn, ping);
    else tools.appendChild(btn);
    toggle = btn;
    syncToggle();
  }

  const api = {
    get mode() {
      return mode;
    },
    get isStudioLoaded() {
      return !!studio;
    },
    setMode,
    /** 場景規模與目前畫質。scene/README.md 叫美術來看的就是這個。 */
    metrics() {
      return studio?.metrics?.() || null;
    },
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    destroy() {
      destroyed = true;
      listeners.clear();
      studio?.destroy?.();
      studio = null;
    },
  };

  api.start = () => {
    mountToggle();
    let urlParam = null;
    try {
      urlParam = new URLSearchParams(location.search).get("view");
    } catch {
      urlParam = null;
    }
    const decided = resolveViewMode({
      urlParam,
      stored: readStored(),
      capabilities: { ...(options.capabilities || detectCapabilities()), forcedTwoD },
    });
    if (decided.forced) forcedTwoD = true;
    if (decided.mode === VIEW_MODES.studio) setMode(VIEW_MODES.studio);
    else {
      mode = VIEW_MODES.flat;
      syncToggle();
    }
    return decided;
  };

  return api;
}
