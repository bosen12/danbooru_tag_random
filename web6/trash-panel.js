/**
 * 廢字簍面板（墨池）：點右下角的廢字簍，旁邊浮出一塊面板，列出封鎖了的字。
 *
 * 以前是蓋住整頁的彈窗：要封鎖十個字得開關十次。現在面板不擋畫面 ——
 * 開著的時候字盒整欄描一圈紅色虛線，點字盒的牌就丟進來（牌飛進面板），再點一次撿回去；
 * 點面板裡的牌也是撿回去。Esc、再點一次廢字簍、或按「完成」收起來。
 *
 * 房間要給的：
 *   anchor          廢字簍那顆鈕（面板貼在它上面）
 *   makeNode(t)     畫一張牌（跟字盒同一個元件）
 *   onRescue(t)     撿回一張
 *   onRescueAll()   全部撿回來
 *   onToggle(open)  開、關（房間把挑牌模式收掉、重畫字盒記號）
 *   decorate(n, t)  面板上的牌做好之後給房間掛東西（拖曳）
 */
import { flip, CURVE, DUR, css } from "./motion.js";

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createTrashPanel({ anchor, makeNode, onRescue, onRescueAll, onToggle = () => {}, decorate = () => {} }) {
  let open = false;
  const nodes = new Map();

  const el = document.createElement("section");
  el.className = "trash-panel";
  el.id = "trash-panel";
  el.hidden = true;
  el.setAttribute("aria-label", "廢字簍");
  el.innerHTML = `
    <header class="tp-head">
      <h2 class="tp-title">廢字簍<b>0</b></h2>
      <span class="tp-acts"><button class="btn btn-small btn-ghost tp-all" type="button">全部撿回來</button><button class="btn btn-small tp-done" type="button">完成</button></span>
    </header>
    <p class="tp-hint">點左邊字盒的牌就丟進來，再點一次撿回去。這裡的字不會被抽到。</p>
    <div class="tp-grid" role="list"></div>
    <p class="tp-empty">還是空的。點字盒裡不想看到的牌，或把牌拖進來。</p>`;
  document.body.append(el);
  const grid = el.querySelector(".tp-grid");
  const count = el.querySelector(".tp-title b");
  const empty = el.querySelector(".tp-empty");
  const allBtn = el.querySelector(".tp-all");
  el.querySelector(".tp-done").addEventListener("click", () => setOpen(false));
  allBtn.addEventListener("click", () => onRescueAll());

  function setOpen(v) {
    v = !!v;
    if (v === open) return;
    open = v;
    anchor.setAttribute("aria-expanded", open ? "true" : "false");
    anchor.dataset.open = open ? "true" : "false";
    document.body.dataset.trashEdit = open ? "true" : "false";
    if (open) {
      el.hidden = false;
      el.getAnimations().forEach((x) => x.cancel());
      if (!reduced()) el.animate([{ opacity: 0, transform: "translateY(14px) scale(0.97)" }, { opacity: 1, transform: "none" }], { duration: DUR.medium, easing: css(CURVE.out) });
    } else if (reduced()) el.hidden = true;
    else {
      el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(10px) scale(0.98)" }], { duration: DUR.short, easing: css(CURVE.in), fill: "forwards" });
      // 不靠 onfinish（分頁在背景時動畫可能不走）：時間到就收。
      setTimeout(() => {
        if (open) return;
        el.hidden = true;
        el.getAnimations().forEach((x) => x.cancel());
      }, DUR.short + 20);
    }
    onToggle(open);
  }

  function cardFor(tag) {
    const node = makeNode(tag);
    node.setAttribute("role", "listitem");
    node.tabIndex = 0;
    node.title = "點一下撿回去";
    node.addEventListener("click", () => onRescue(tag));
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        onRescue(tag);
      }
    });
    decorate(node, tag);
    return node;
  }

  /**
   * 跟著封鎖清單重排：新的排最前面（剛丟進來的就在眼前）；撿走的往上浮起來淡掉，旁邊的滑過來補位。
   * arriving：剛丟進來、影子還在路上的那張 —— 先藏著，影子落地（land(tag)）才亮。
   */
  function sync(tags, { arriving = null } = {}) {
    const want = new Set(tags);
    const gone = [...nodes.keys()].filter((t) => !want.has(t));
    const added = tags.filter((t) => !nodes.has(t));
    count.textContent = String(tags.length);
    empty.hidden = tags.length > 0;
    allBtn.disabled = tags.length === 0;
    if (!gone.length && !added.length) return;
    const mutate = () => {
      for (const t of gone) {
        nodes.get(t).remove();
        nodes.delete(t);
      }
      for (const t of [...added].reverse()) {
        const n = cardFor(t);
        if (t === arriving) n.style.visibility = "hidden";
        nodes.set(t, n);
        grid.prepend(n);
      }
    };
    // 撿走的先演一下浮起來（用複製的影子，原位馬上讓出來給其他牌補位）。
    if (open && !reduced()) {
      for (const t of gone) {
        const n = nodes.get(t);
        const r = n.getBoundingClientRect();
        if (!r.width) continue;
        const g = n.cloneNode(true);
        Object.assign(g.style, { position: "fixed", left: r.left + "px", top: r.top + "px", width: r.width + "px", margin: "0", zIndex: "95", pointerEvents: "none" });
        g.style.setProperty("--card-w", r.width + "px");
        document.body.append(g);
        g.animate(
          [
            { transform: "none", opacity: 1, filter: "grayscale(1)" },
            { transform: "translateY(-8px) scale(1.05)", opacity: 1, filter: "none", offset: 0.35 },
            { transform: "translateY(-30px) scale(0.9)", opacity: 0, filter: "none" },
          ],
          { duration: DUR.medium, easing: css(CURVE.inOut), fill: "forwards" }
        ).onfinish = () => g.remove();
      }
    }
    if (open) flip(grid, mutate);
    else mutate();
  }

  return {
    el,
    sync,
    toggle: () => setOpen(!open),
    open: () => setOpen(true),
    close: () => setOpen(false),
    get isOpen() {
      return open;
    },
    /** 面板上那張牌（影子飛過來的落點）。 */
    nodeOf: (tag) => nodes.get(tag) || null,
    /** 影子落地：那張亮出來，輕輕彈一下。 */
    land(tag) {
      const n = nodes.get(tag);
      if (!n) return;
      n.style.visibility = "";
      if (!reduced()) n.animate([{ transform: "scale(1.12)" }, { transform: "scale(1)" }], { duration: DUR.short, easing: css(CURVE.out) });
    },
  };
}
