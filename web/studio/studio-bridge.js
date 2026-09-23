/**
 * hotspot ←→ 既有 2D 面板的對應。
 *
 * 這一層是整個 3D 外殼裡唯一知道「排字匣長什麼樣」的地方，而它知道的方式刻意很淺：
 * 只認得 DOM 選擇器和按鈕 id，完全不碰 engine.js、不碰釘選集合、不碰生成佇列。
 * 因為只要 3D 這側動到任何一份狀態，就會有兩份狀態開始漂移 —— 規格裡
 * 「不得維護兩套互相漂移的狀態」講的就是這件事。
 *
 * 面板有三種：
 *   adopt    把既有元素「搬」進 3D 的面板容器，關閉時原位放回去。
 *            搬動 DOM 節點會保留它身上所有的事件監聽器與子節點，所以釘選、搜尋、
 *            展開狀態全部原封不動 —— 這比複製一份 UI 出來安全得多。
 *   trigger  那個面板本來就是彈窗，直接按原本那顆按鈕就好。
 *   note     還沒有東西可以接（例如 A／B 對照燈台），老實說沒有，不要假裝。
 */

const $ = (id) => document.getElementById(id);

/** 搬走之前先埋一個錨，關閉時才知道要放回哪裡（而不是 append 到最後面）。
 *
 *  還要把 view-controller 蓋在它身上的「藏起來」狀態拿掉再放進面板：
 *  .dock 同時出現在兩邊 —— 它是 2D 要藏的東西之一，也是抽取面板要借的東西之一。
 *  少了這一段，借進來的 .dock 仍然是 display:none，於是抽取面板裡看不到
 *  「抽並生圖」那顆鈕。關閉時要原樣還回去，否則切回 2D 會多出一塊。 */
function adoptNode(selector, into) {
  const el = document.querySelector(selector);
  if (!el || !into) return null;
  const anchor = document.createComment("studio-anchor:" + selector);
  el.parentNode.insertBefore(anchor, el);
  const wasHidden = el.hasAttribute("data-studio-hidden");
  const wasInert = "inert" in el ? el.inert : false;
  if (wasHidden) el.removeAttribute("data-studio-hidden");
  if ("inert" in el) el.inert = false;
  into.appendChild(el);
  el.setAttribute("data-studio-adopted", "1");
  return () => {
    if (anchor.parentNode) anchor.parentNode.insertBefore(el, anchor);
    anchor.remove();
    el.removeAttribute("data-studio-adopted");
    if (wasHidden) el.setAttribute("data-studio-hidden", "1");
    if ("inert" in el) el.inert = wasInert;
  };
}

export const PANEL_SPECS = {
  "studio-panel-draw": {
    title: "手盒",
    sub: "抽牌、POS／NEG、出圖。這就是平面工作台上的同一塊，不是複製品。",
    adopt: ["#results", ".dock"],
  },
  "studio-panel-tags": {
    title: "活字架",
    sub: "釘選、關掉、組合、詞庫。",
    adopt: ["#sec-rules", "#filter-bar", "#cats"],
  },
  "studio-panel-models": {
    title: "字模櫃",
    sub: "底模與 LoRA。",
    trigger: [
      { sel: "#lora-pick-btn", label: "選 LoRA" },
      { sel: "#ckpt-pick-btn", label: "選底模" },
    ],
  },
  "studio-panel-gallery": {
    title: "晾紙架",
    sub: "收藏的配方與成品。",
    trigger: [{ sel: "#album-btn", label: "打開作品冊" }],
  },
  "studio-panel-settings": {
    title: "印刷機",
    sub: "ComfyUI 連線、路徑與工作流。",
    trigger: [{ sel: "#wf-pick-btn", label: "工作流" }],
  },
  "studio-panel-messaging": {
    title: "送件籃",
    sub: "成圖之後送到哪裡。",
    trigger: [{ sel: "#service-settings-btn", label: "通知設定" }],
  },
  "studio-panel-trace": {
    title: "放大鏡",
    sub: "每一張成品卡片上的「為什麼」會列出這一張的每個字從哪來、哪些被淘汰。",
    note: "抽一張圖之後，到「手盒」點卡片上的「為什麼」。這裡不另外複製一份。",
  },
  "studio-panel-compare": {
    title: "對照燈台",
    sub: "A／B 生圖實驗室。",
    note: "還沒有東西可以接。這個位置先留著，不假裝它能用。",
  },
};

/** 有任何疊層開著時，Escape 是它們的，不是相機的。 */
export function anyOverlayOpen() {
  return !!document.querySelector(
    "#shot-viewer.open, .lora-modal.open, #album-modal.open, .tg-modal.open, .shortcuts-overlay.open",
  );
}

export function createBridge() {
  const released = new Map();

  function buildPanel(panelId) {
    const spec = PANEL_SPECS[panelId];
    if (!spec) return null;
    let panel = $(panelId);
    if (panel) return panel;
    panel = document.createElement("section");
    panel.id = panelId;
    panel.className = "studio-panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", spec.title);
    const head = document.createElement("header");
    head.className = "studio-panel-head";
    const h = document.createElement("h2");
    h.textContent = spec.title;
    const p = document.createElement("p");
    p.textContent = spec.sub || "";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "studio-panel-close";
    close.setAttribute("aria-label", "返回房間 (Esc)");
    close.title = "返回房間 (Esc)";
    close.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
    close.dataset.studioBack = "1";
    head.append(h, p, close);
    const body = document.createElement("div");
    body.className = "studio-panel-body";
    panel.append(head, body);
    document.getElementById("studio-root")?.appendChild(panel);
    return panel;
  }

  function open(panelId) {
    const spec = PANEL_SPECS[panelId];
    if (!spec) return false;

    // 彈窗類：本來就有一套完整的開關、焦點與捲動鎖，直接按原本那顆鈕最不容易錯。
    if (spec.trigger && !spec.adopt) {
      const panel = buildPanel(panelId);
      const body = panel.querySelector(".studio-panel-body");
      body.replaceChildren();
      for (const t of spec.trigger) {
        const src = document.querySelector(t.sel);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "studio-jump";
        btn.textContent = t.label;
        btn.disabled = !src;
        if (!src) btn.title = "這個版面沒有這個功能";
        btn.addEventListener("click", () => document.querySelector(t.sel)?.click());
        body.appendChild(btn);
      }
      panel.hidden = false;
      return true;
    }

    const panel = buildPanel(panelId);
    const body = panel.querySelector(".studio-panel-body");
    if (spec.note) {
      body.replaceChildren();
      const note = document.createElement("p");
      note.className = "studio-note";
      note.textContent = spec.note;
      body.appendChild(note);
    }
    if (spec.adopt) {
      const undo = [];
      for (const sel of spec.adopt) {
        const release = adoptNode(sel, body);
        if (release) undo.push(release);
      }
      released.set(panelId, undo);
    }
    panel.hidden = false;
    return true;
  }

  function close(panelId) {
    const panel = $(panelId);
    if (panel) panel.hidden = true;
    const undo = released.get(panelId);
    if (undo) {
      // 倒著放回去，順序才會跟搬走之前一樣
      for (let i = undo.length - 1; i >= 0; i -= 1) undo[i]();
      released.delete(panelId);
    }
  }

  function closeAll() {
    for (const id of Object.keys(PANEL_SPECS)) close(id);
  }

  /** 3D 物件上要顯示的狀態，全部從既有 DOM 讀，不另外算一份。 */
  function readStatus() {
    const pinned = document.querySelectorAll('#cats .tag[data-state="pinned"]').length;
    const banned = document.querySelectorAll('#cats .tag[data-state="banned"][data-ban="user"]').length;
    const cards = document.querySelectorAll("#results .card").length;
    const done = document.querySelectorAll("#results .card.is-done").length;
    const running = !$("cancel")?.hidden;
    const comfy = $("ping")?.dataset.ok === "1";
    return { pinned, banned, cards, done, running, comfy };
  }

  return { open, close, closeAll, readStatus, buildPanel };
}
