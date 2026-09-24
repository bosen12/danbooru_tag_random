/**
 * 拖曳：卡牌拖進合成池、拖進廢字簍、從池裡拖回字盒。
 *
 * 用 pointer events 自己做，不用 HTML5 drag-and-drop —— 後者在手機上不能用，
 * 拖著走的那張也沒辦法自己畫。規則：
 *   滑鼠：按下後移動超過 5px 才算拖，沒移動就是點一下。
 *   觸控：長按 280ms 才開始拖；在那之前手指一動就讓給捲動（字盒要能滑）。
 *   拖曳中按 Esc 取消。拖完之後緊接著的那個 click 會被吃掉，不會又當成點一下。
 */

const MOUSE_SLOP = 5;
const TOUCH_HOLD = 280;
const TOUCH_SLOP = 8;

/**
 * zones: () => [{ id, el, accepts(payload) }]
 * onDrop(payload, zoneId)
 */
export function createDrag({ zones, onDrop }) {
  let active = null;

  // 長按開始拖之後，手指一動瀏覽器就會想捲動頁面（然後送 pointercancel 把拖曳砍掉）。
  // 拖曳中攔下 touchmove，捲動就不會開始。
  document.addEventListener(
    "touchmove",
    (e) => {
      if (active && active.dragging) e.preventDefault();
    },
    { passive: false }
  );

  function zoneAt(x, y, payload) {
    for (const z of zones()) {
      if (!z.el || !z.el.isConnected || !z.accepts(payload)) continue;
      const r = z.el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return z;
    }
    return null;
  }

  function markZones(payload, over) {
    for (const z of zones()) {
      if (!z.el) continue;
      const ok = z.accepts(payload);
      z.el.dataset.droppable = ok ? "true" : "false";
      z.el.dataset.over = over && over.id === z.id ? "true" : "false";
      if (z.id === "trash") z.el.dataset.armed = ok ? "true" : "false";
    }
  }

  function clearZones() {
    for (const z of zones()) {
      if (!z.el) continue;
      delete z.el.dataset.droppable;
      delete z.el.dataset.over;
      delete z.el.dataset.armed;
    }
  }

  function begin(state, x, y) {
    const r = state.node.getBoundingClientRect();
    const ghost = state.node.cloneNode(true);
    ghost.classList.add("drag-ghost");
    ghost.removeAttribute("id");
    ghost.style.width = r.width + "px";
    ghost.style.setProperty("--card-w", r.width + "px");
    ghost.style.fontSize = getComputedStyle(state.node).fontSize;
    document.body.append(ghost);
    state.ghost = ghost;
    state.dx = x - r.left;
    state.dy = y - r.top;
    state.dragging = true;
    state.node.dataset.dragging = "true";
    document.body.dataset.dragging = "true";
    move(state, x, y);
  }

  function move(state, x, y) {
    state.ghost.style.transform = `translate(${x - state.dx}px, ${y - state.dy}px)`;
    state.over = zoneAt(x, y, state.payload);
    markZones(state.payload, state.over);
  }

  function end(state, cancelled) {
    clearTimeout(state.hold);
    window.removeEventListener("pointermove", state.onMove);
    window.removeEventListener("pointerup", state.onUp);
    window.removeEventListener("pointercancel", state.onCancel);
    window.removeEventListener("keydown", state.onKey, true);
    if (state.dragging) {
      state.ghost.remove();
      delete state.node.dataset.dragging;
      document.body.dataset.dragging = "false";
      clearZones();
      // 吃掉緊接著的 click
      const eat = (e) => {
        e.stopPropagation();
        e.preventDefault();
      };
      state.node.addEventListener("click", eat, { capture: true, once: true });
      setTimeout(() => state.node.removeEventListener("click", eat, { capture: true }), 60);
      if (!cancelled && state.over) onDrop(state.payload, state.over.id);
    }
    active = null;
  }

  function attach(node, payload) {
    node.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || active) return;
      const touch = e.pointerType === "touch";
      const state = { node, payload: typeof payload === "function" ? payload() : payload, x0: e.clientX, y0: e.clientY, dragging: false };
      active = state;
      state.onMove = (ev) => {
        if (state.dragging) {
          ev.preventDefault();
          move(state, ev.clientX, ev.clientY);
          return;
        }
        const dist = Math.hypot(ev.clientX - state.x0, ev.clientY - state.y0);
        if (touch) {
          if (dist > TOUCH_SLOP) end(state, true); // 手指先動了：是捲動，不是拖
        } else if (dist > MOUSE_SLOP) {
          begin(state, ev.clientX, ev.clientY);
        }
      };
      state.onUp = () => end(state, false);
      state.onCancel = () => end(state, true);
      state.onKey = (ev) => {
        if (ev.key === "Escape" && state.dragging) {
          ev.stopPropagation();
          end(state, true);
        }
      };
      window.addEventListener("pointermove", state.onMove, { passive: false });
      window.addEventListener("pointerup", state.onUp);
      window.addEventListener("pointercancel", state.onCancel);
      window.addEventListener("keydown", state.onKey, true);
      if (touch) {
        state.hold = setTimeout(() => {
          if (active !== state) return;
          if (navigator.vibrate) navigator.vibrate(12);
          begin(state, state.x0, state.y0);
        }, TOUCH_HOLD);
      }
    });
    // 觸控長按時不要跳出系統選單
    node.addEventListener("contextmenu", (e) => {
      if (active && active.node === node) e.preventDefault();
    });
  }

  return {
    attach,
    get dragging() {
      return !!(active && active.dragging);
    },
  };
}
