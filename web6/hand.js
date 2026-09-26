/**
 * 偏好卡牌（手牌）：墨池、疊印台共用。每個房間自己一份（key 不同），最多十張。
 *
 * 樣子：視窗底部一條托盤，牌就是左邊字盒那一張 —— 同一個元件、量字盒上那張的寬度和字級，
 * 看起來一模一樣。整張攤開排成一道很淺的弧；指到的那張浮起來。擺不下才疊，疊的時候指到的
 * 那張兩旁讓開。托盤可以收起來，只剩一顆「偏好卡牌 7/10」的小標籤。
 * 已經在卡池裡的不擺：手牌十張、卡池已經有其中三張，托盤只擺七張；那張從卡池拿下來，
 * 它飛回托盤（不是回字盒）。托盤佔多高寫在 --fav-h，房間的捲動區底下墊這麼多，不會被蓋住。
 *
 * 用法（越少步驟越好）：
 *   加牌：把左邊的牌拖到托盤；或按托盤上的「＋ 挑牌」，再點左邊的牌（再點一次是拿掉）。
 *   出牌：點托盤上的牌，或拖進卡池。
 *   拿掉：指到牌，右上角的 ×（隨時都有）；或拖回字盒；鍵盤 Delete。
 *
 * 房間要給的：
 *   key            localStorage 的鑰匙（兩個房間分開）
 *   makeNode(t)    畫一張牌（cards.js 的 cardNode，跟字盒同一個）
 *   sample()       字盒上隨便一張牌（量它的寬度、字級；托盤的牌跟它一樣大）
 *   inPool(t)      這張現在在卡池裡嗎
 *   onPlay(t, r)   出牌（r：托盤上那張的位置，讓房間從這裡飛進卡池）
 *   onChange()     手牌變了（房間重畫字盒上的「手」記號、按鈕上的數字）
 *   known(t)       這張牌還在不在字盒（詞庫改了、被封鎖了就不要）
 *   onRemoved(t, undo)  用手拿掉了一張（×、Delete、選單）：房間跳一個帶「復原」的提示，undo() 放回原位
 *   decorate(n,t)  托盤上的牌做好之後給房間掛東西（拖曳）
 */
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="8" height="12" rx="1.5" transform="rotate(-14 7 13)"/><rect x="8" y="5" width="8" height="12" rx="1.5"/><rect x="13" y="7" width="8" height="12" rx="1.5" transform="rotate(14 17 13)"/></svg>';
const CHEVRON =
  '<svg class="fav-chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
const GAP = 10;

export function createHand({
  key,
  max = 10,
  makeNode,
  sample = () => null,
  inPool,
  onPlay,
  onChange = () => {},
  known = () => true,
  onFull = () => {},
  onRemoved = () => {},
  decorate = () => {},
}) {
  let tags = read(key, []).filter(known).slice(0, max);
  // 第一次來、手牌是空的：托盤不出來，等按了「偏好卡牌」或加了第一張。
  let open = read(key + ".open", tags.length > 0) === true;
  let editing = false;
  let hot = -1;
  // 拖牌經過托盤：在要插進去的地方空出一格（at：第幾格；skip：拖的就是托盤上的這張，它先讓出位置）。
  let gap = null;
  let size = { w: 84, fs: 10 };
  const slots = new Map();
  const pendingArrive = new Set();

  const el = document.createElement("section");
  el.className = "fav-hand";
  el.setAttribute("aria-label", "偏好卡牌");
  const head = document.createElement("div");
  head.className = "fav-head";
  const tab = document.createElement("button");
  tab.type = "button";
  tab.className = "fav-tab";
  const hint = document.createElement("span");
  hint.className = "fav-hint";
  hint.setAttribute("aria-live", "polite");
  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "fav-pick";
  head.append(tab, hint, pick);
  const body = document.createElement("div");
  body.className = "fav-body";
  const fan = document.createElement("div");
  fan.className = "fav-fan";
  // 指到托盤的牌：放大卡開在上面（card-peek.js）。
  fan.dataset.peek = "above";
  const empty = document.createElement("p");
  empty.className = "fav-emptytext";
  body.append(fan);
  el.append(head, body);
  document.body.append(el);

  tab.addEventListener("click", () => setOpen(!open));
  pick.addEventListener("click", () => toggleEdit());
  fan.addEventListener("pointerleave", () => setHot(-1));
  fan.addEventListener("focusout", (e) => {
    if (!fan.contains(e.relatedTarget)) setHot(-1);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && editing) {
      e.preventDefault();
      toggleEdit(false);
    }
  });

  // 托盤佔多高，房間的捲動區底下就墊多高（CSS 讀 --fav-h）。
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(syncSpace) : null;
  ro?.observe(el);
  // 量的是托盤頂端到視窗底邊（墨池的浮動按鈕列出來時托盤會墊高）：角落的按鈕要讓到這麼高。
  el.addEventListener("transitionend", (e) => {
    if (e.target === el && e.propertyName === "bottom") syncSpace();
  });
  function syncSpace() {
    const r = el.getBoundingClientRect();
    const h = el.dataset.hidden === "true" || !r.height ? 0 : Math.ceil(innerHeight - r.top) + 12;
    document.documentElement.style.setProperty("--fav-h", h + "px");
  }

  function read(k, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(k));
      if (v === null || v === undefined) return fallback;
      if (Array.isArray(fallback)) return Array.isArray(v) ? v.filter((t) => typeof t === "string") : fallback;
      return v;
    } catch {
      return fallback;
    }
  }
  function write(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* 存不了就只活在這一頁 */
    }
  }

  const shownTags = () => tags.filter((t) => !inPool(t));

  /** 量字盒上那張牌：托盤的牌跟它一樣寬、一樣的字級。字盒還沒畫出來就沿用上一次。 */
  // 字盒變寬變窄（視窗拉動、捲軸出現、字型載完），它的牌跟著變：托盤重量一次。
  let watched = null;
  let measured = false;
  let retry = 0;
  let tries = 0;
  let reflow = 0;
  const gridRo =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          cancelAnimationFrame(reflow);
          reflow = requestAnimationFrame(() => {
            const w = size.w;
            measure();
            if (Math.abs(size.w - w) > 0.5) layout(false);
          });
        })
      : null;
  function measure() {
    const n = sample();
    const grid = n?.parentElement;
    if (gridRo && grid && grid !== watched) {
      if (watched) gridRo.unobserve(watched);
      gridRo.observe((watched = grid));
    }
    // 量 offsetWidth（沒轉過的寬度）；字盒還沒畫出來就等一下再量（最多十秒）。
    const w = n?.offsetWidth || 0;
    if (w > 30) {
      size = { ...size, w, fs: parseFloat(getComputedStyle(n).fontSize) || size.fs };
      measured = true;
    } else if (!measured && !retry && tries < 40) {
      tries += 1;
      retry = setTimeout(() => {
        retry = 0;
        layout(false);
      }, 250);
    }
    return size;
  }

  /** 擺得下就整齊排開（間距 GAP），擺不下就疊（step 變小）。 */
  function geometry(n, i, w, room) {
    const step = n > 1 ? Math.min(w + GAP, (room - w) / (n - 1)) : 0;
    const off = i - (n - 1) / 2;
    // 很淺的弧：兩端微微往下、往外轉。張數越多每張轉得越少，整排不會歪成扇子。
    const tilt = n > 1 ? Math.min(1.2, 6 / (n - 1)) : 0;
    return { x: off * step, y: off * off * 0.9, r: off * tilt, step };
  }

  function position(slot, i, n, w, room, animate, hot) {
    let { x, y, r, step } = geometry(n, i, w, room);
    let lift = 0;
    if (hot >= 0 && hot < n) {
      if (i === hot) {
        lift = -12;
        r = 0;
      } else if (step < w) {
        // 疊著的時候：指到的那張兩旁往外讓，露出整張。
        const d = i - hot;
        x += Math.sign(d) * Math.max(0, (w - step) * 0.55 - (Math.abs(d) - 1) * 5);
      }
    }
    // 剛做好的牌第一次擺：直接到位，不要從中間滑出來。
    slot.style.transition = animate && slot._placed && !reduced() ? "" : "none";
    slot._placed = true;
    slot.style.transform = `translate(calc(-50% + ${x.toFixed(1)}px), ${(y + lift).toFixed(1)}px) rotate(${r.toFixed(2)}deg)`;
    slot.style.zIndex = String(i === hot ? 50 : 10 + i);
    slot.classList.toggle("is-hot", i === hot);
  }

  function setHot(i) {
    if (i === hot) return;
    hot = i;
    placeAll(true);
  }

  function slotFor(tag) {
    let s = slots.get(tag);
    if (s) return s;
    s = document.createElement("div");
    s.className = "fav-slot";
    s.dataset.tag = tag;
    const node = makeNode(tag);
    node.classList.add("fav-card");
    node.tabIndex = -1;
    // 托盤一打開就要看得到圖：不等捲動才載。
    for (const img of node.querySelectorAll("img")) img.loading = "eager";
    node.title = "點一下放進卡池";
    decorate(node, tag);
    node.addEventListener("click", (e) => {
      e.preventDefault();
      play(tag);
    });
    node.setAttribute("aria-keyshortcuts", "Delete ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight");
    node.addEventListener("keydown", (e) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        const i = cardsNow().indexOf(node);
        remove(tag);
        refocus(i);
        return;
      }
      const cards = cardsNow();
      const i = cards.indexOf(node);
      const to = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: cards.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      const j = Math.max(0, Math.min(cards.length - 1, to));
      // Shift＋方向鍵：這張往左／往右挪一格（排順序）。
      if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        if (j === i) return;
        insertAt(tag, j);
        write(key, tags);
        layout(true);
        onChange();
        focusCard(node);
        return;
      }
      focusCard(cards[j]);
    });
    const idx = () => [...fan.querySelectorAll(".fav-slot")].indexOf(s);
    node.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse") setHot(idx());
    });
    node.addEventListener("focus", () => setHot(idx()));
    const x = document.createElement("button");
    x.type = "button";
    x.className = "fav-x";
    x.setAttribute("aria-label", "從偏好卡牌拿掉");
    x.title = "從偏好卡牌拿掉";
    // 鍵盤用 Delete 拿掉，Tab 不用一張一張停在 × 上。
    x.tabIndex = -1;
    x.innerHTML =
      '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      remove(tag);
    });
    x.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse") setHot(idx());
    });
    s.append(node, x);
    slots.set(tag, s);
    return s;
  }

  function paintHead() {
    const placed = tags.length - shownTags().length;
    tab.innerHTML = `${ICON}<span class="fav-title">偏好卡牌</span><b class="fav-count">${tags.length}/${max}</b>${CHEVRON}`;
    tab.setAttribute("aria-expanded", open ? "true" : "false");
    tab.title = open ? "收起偏好卡牌" : "打開偏好卡牌";
    pick.textContent = editing ? "完成" : "＋ 挑牌";
    pick.setAttribute("aria-pressed", editing ? "true" : "false");
    pick.title = editing ? "挑好了（Esc）" : "點字盒裡的牌加進來，再點一次拿掉";
    hint.textContent = editing ? "點字盒裡的牌加進來，再點一次拿掉" : placed ? `${placed} 張在卡池裡` : "";
  }

  /** 只重排位置（指到別張、視窗變寬窄），不動節點。 */
  function placeAll(animate) {
    const kids = [...fan.querySelectorAll(".fav-slot")];
    const w = size.shown || size.w;
    const list = gap ? kids.filter((k) => k.dataset.tag !== gap.skip) : kids;
    const m = gap ? list.length + 1 : list.length;
    const room = roomFor(m);
    setWant(m);
    for (const k of kids) k.classList.toggle("is-out", !!gap && k.dataset.tag === gap.skip);
    list.forEach((k, j) => position(k, gap && j >= gap.at ? j + 1 : j, m, w, room, animate, gap ? -1 : hot));
  }

  /** 托盤要多寬（照張數長，夾在視窗裡）；跟 CSS 的算法一樣，才不用等寬度轉場跑完才知道擺不擺得下。 */
  function trayWidth(m) {
    const w = size.shown || size.w;
    // 跟 CSS 一樣：手機兩邊各 8、寬螢幕兩邊各留 100 給角落的廢字簍。
    const edge = innerWidth < 640 ? 16 : innerWidth >= 1100 ? 200 : 20;
    return Math.min(innerWidth - edge, Math.max(Math.max(m, 1) * (w + GAP) - GAP + 40, 360));
  }
  function roomFor(m) {
    const pad = innerWidth < 640 ? 16 : 20;
    return Math.max(size.shown || size.w, trayWidth(m) - pad - 2 - 8);
  }
  function setWant(m) {
    const w = size.shown || size.w;
    el.style.setProperty("--fav-want", Math.max(m, 1) * (w + GAP) - GAP + 40 + "px");
  }

  /** 指標在 x：插進去會是第幾格（skip：托盤上被拖著的那張不算）。 */
  function gapIndex(x, skip) {
    const list = shownTags().filter((t) => t !== skip);
    const m = list.length + 1;
    if (m < 2) return 0;
    const w = size.shown || size.w;
    const room = roomFor(m);
    const step = Math.min(w + GAP, (room - w) / (m - 1));
    const r = fan.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    return Math.max(0, Math.min(m - 1, Math.round((x - cx) / step + (m - 1) / 2)));
  }

  /** 把 tag 放進 tags，讓它在托盤上排第 at 格（at 算的是擺出來的牌；卡池裡的不佔格）。 */
  function insertAt(tag, at) {
    const list = shownTags().filter((t) => t !== tag);
    const rest = tags.filter((t) => t !== tag);
    let i = rest.length;
    if (at != null && at < list.length) i = rest.indexOf(list[at]);
    else if (at != null && list.length) i = rest.indexOf(list[list.length - 1]) + 1;
    rest.splice(i, 0, tag);
    tags = rest;
  }

  /**
   * 拖著經過托盤（x：指標位置；null＝離開了）。插進去的那一格先空出來，兩旁的牌滑開。
   * 滿十張又不是托盤上的牌：不空格，標頭說滿了。
   */
  function hover(x, tag) {
    const full = !tags.includes(tag) && tags.length >= max;
    if (x == null || !open || full) {
      const was = gap || el.dataset.full === "true";
      gap = null;
      if (full && x != null) {
        el.dataset.full = "true";
        hint.textContent = `滿 ${max} 張了，先拿掉一張`;
        return;
      }
      delete el.dataset.full;
      if (was) {
        paintHead();
        placeAll(true);
      }
      return;
    }
    const skip = shownTags().includes(tag) ? tag : null;
    const at = gapIndex(x, skip);
    if (gap && gap.at === at && gap.skip === skip) return;
    gap = { at, skip };
    hot = -1;
    placeAll(true);
  }

  /**
   * 牌放在托盤上（拖曳）。已經在手牌裡：換到放下的位置；不在：插在放下的位置。
   * 回傳 false＝收不下（滿了），房間讓影子彈回原位。
   */
  function drop(tag, x) {
    const skip = shownTags().includes(tag) ? tag : null;
    const at = open && x != null ? gapIndex(x, skip) : null;
    gap = null;
    delete el.dataset.full;
    if (tags.includes(tag)) {
      if (at != null) insertAt(tag, at);
      write(key, tags);
      layout(true);
      snap(tag);
      onChange();
      return true;
    }
    return add(tag, null, { at, quiet: true });
  }

  /** 這張直接到位（不走轉場）：拖曳的影子要量它最後的位置落下去。 */
  function snap(tag) {
    const s = slots.get(tag);
    if (s) s.style.transition = "none";
  }

  /** 重擺托盤。animate：位置變化用轉場滑過去（加牌、出牌）。 */
  function layout(animate = true) {
    const m = measure();
    // 手機上字盒的牌很大（一排三張），托盤照原樣會吃掉半個螢幕：整張等比例縮到 76px，長相不變。
    const k = innerWidth < 640 ? Math.min(1, 76 / m.w) : 1;
    const w = Math.round(m.w * k * 10) / 10;
    const fs = Math.round(m.fs * k * 100) / 100;
    size.shown = w;
    const show = shownTags();
    const n = show.length;
    el.style.setProperty("--fav-card-w", w + "px");
    el.style.setProperty("--fav-card-fs", fs + "px");
    const kids = show.map(slotFor);
    const keep = new Set(kids);
    for (const c of [...fan.children]) if (!keep.has(c)) c.remove();
    kids.forEach((k, i) => {
      if (fan.children[i] !== k) fan.insertBefore(k, fan.children[i] || null);
    });
    if (!n) {
      empty.textContent = tags.length
        ? "偏好卡牌都在卡池裡了，從卡池拿下來就回到這裡。"
        : editing
          ? "點字盒裡的牌加進來，最多十張。"
          : "把字盒的牌拖到這裡，或按「＋ 挑牌」。";
      if (!empty.isConnected) fan.append(empty);
    } else empty.remove();
    if (hot >= n) hot = -1;
    // 只留一張在 Tab 順序裡：剛剛那張還在就是它，不然第一張。
    const cards = kids.map((k) => k.querySelector(".fav-card"));
    const keep0 = cards.find((c) => c.tabIndex === 0) || cards[0];
    for (const c of cards) c.tabIndex = c === keep0 ? 0 : -1;
    for (const t of show) slots.get(t).classList.toggle("is-arriving", pendingArrive.has(t));
    el.dataset.open = open ? "true" : "false";
    el.dataset.editing = editing ? "true" : "false";
    el.dataset.count = String(n);
    el.dataset.hidden = !tags.length && !editing && !open ? "true" : "false";
    paintHead();
    placeAll(animate);
    syncSpace();
  }

  function setOpen(v) {
    const was = open;
    open = !!v;
    write(key + ".open", open);
    if (!open && editing) {
      editing = false;
      document.body.dataset.handEdit = "false";
    }
    layout(false);
    if (open && !was && !reduced()) {
      body.animate([{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], { duration: 280, easing: EASE });
    }
    onChange();
  }

  /** 工具列上的「偏好卡牌」：沒牌就直接進挑牌；有牌就打開／收起托盤。 */
  function fromButton() {
    if (open && el.dataset.hidden !== "true") return setOpen(false);
    if (!tags.length) return toggleEdit(true);
    setOpen(true);
  }

  function play(tag) {
    const node = slots.get(tag)?.querySelector(".fav-card");
    const r = node?.getBoundingClientRect();
    const i = node && node === document.activeElement ? cardsNow().indexOf(node) : -1;
    hot = -1;
    onPlay(tag, r || null);
    // 用鍵盤出牌：焦點留在托盤，落到旁邊那張（不要掉回頁面最上面）。
    if (i >= 0) refocus(i);
  }

  const cardsNow = () => [...fan.querySelectorAll(".fav-slot:not(.is-out) .fav-card")];

  /** 托盤只有一張牌在 Tab 順序裡（跟字盒一樣），方向鍵在牌之間移動。 */
  function focusCard(card) {
    if (!card) return;
    for (const c of fan.querySelectorAll(".fav-card")) c.tabIndex = c === card ? 0 : -1;
    card.focus({ preventScroll: true });
  }
  function refocus(i) {
    setTimeout(() => {
      const cards = cardsNow().filter((c) => c.isConnected && !c.closest(".fav-slot").style.pointerEvents);
      if (cards.length) focusCard(cards[Math.min(i, cards.length - 1)]);
      else tab.focus({ preventScroll: true });
    }, 0);
  }

  /** 加一張。from：來源的位置（字盒上那張），牌從那裡飛進托盤。 */
  function add(tag, from = null, { at = null, quiet = false } = {}) {
    if (!open) setOpen(true);
    if (tags.includes(tag)) {
      const c = slots.get(tag)?.querySelector(".fav-card");
      if (c?.isConnected && !reduced()) c.animate([{ translate: "0 0" }, { translate: "0 -8px" }, { translate: "0 0" }], { duration: 300, easing: EASE });
      return false;
    }
    if (tags.length >= max) {
      if (!reduced()) tab.animate([{ translate: "0 0" }, { translate: "-6px 0" }, { translate: "6px 0" }, { translate: "-3px 0" }, { translate: "0 0" }], { duration: 340, easing: "ease-out" });
      onFull();
      return false;
    }
    insertAt(tag, at);
    write(key, tags);
    layout(true);
    if (quiet) snap(tag);
    onChange();
    const s = slots.get(tag);
    if (s?.isConnected && !reduced() && !quiet) {
      if (from) flyInto(s, from);
      else s.querySelector(".fav-card").animate([{ translate: "0 18px", opacity: 0 }, { translate: "0 0", opacity: 1 }], { duration: 300, easing: EASE });
    }
    if (!reduced()) el.querySelector(".fav-count")?.animate([{ scale: "1" }, { scale: "1.35" }, { scale: "1" }], { duration: 300, easing: EASE });
    return true;
  }

  /** 挑牌模式：點一下加、再點一下拿掉。 */
  function toggle(tag, from = null) {
    if (tags.includes(tag)) remove(tag);
    else add(tag, from);
  }

  function flyInto(slot, from) {
    const card = slot.querySelector(".fav-card");
    // 量最後的落點：先關掉轉場讓 slot 直接到目標位置，量完再開回來。
    const tr = slot.style.transition;
    slot.style.transition = "none";
    const to = card.getBoundingClientRect();
    slot.style.transition = tr;
    if (!to.width) return;
    const f = card.cloneNode(true);
    f.classList.remove("fav-card");
    Object.assign(f.style, {
      position: "fixed",
      left: from.left + "px",
      top: from.top + "px",
      width: from.width + "px",
      margin: "0",
      zIndex: "90",
      pointerEvents: "none",
      // 起飛時跟字盒那張一樣大：字級照寬度比例放回去（手機上托盤的牌是縮過的）。
      fontSize: (parseFloat(getComputedStyle(card).fontSize) * from.width) / (card.offsetWidth || from.width) + "px",
    });
    f.style.setProperty("--card-w", from.width + "px");
    document.body.append(f);
    card.style.visibility = "hidden";
    const dx = to.left - from.left;
    const dy = to.top - from.top;
    const sc = to.width / from.width;
    const a = f.animate(
      [
        { transform: "none", boxShadow: "var(--shadow-card)" },
        { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 36}px) scale(${(1 + sc) / 2 + 0.06}) rotate(-3deg)`, boxShadow: "0 18px 30px var(--color-shade)", offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(${sc})`, boxShadow: "var(--shadow-card)" },
      ],
      { duration: 460, easing: "cubic-bezier(0.45, 0, 0.25, 1)", fill: "forwards" }
    );
    const land = () => {
      if (!f.isConnected) return;
      f.remove();
      card.style.visibility = "";
      card.animate([{ translate: "0 3px" }, { translate: "0 -2px" }, { translate: "0 0" }], { duration: 240, easing: EASE });
    };
    a.onfinish = land;
    setTimeout(land, 640);
  }

  /** 從手牌拿掉（×、Delete、拖回字盒、被封鎖、挑牌時再點一次）。 */
  function remove(tag, { quiet = false } = {}) {
    if (!tags.includes(tag)) return;
    const s = slots.get(tag);
    const was = tags.indexOf(tag);
    // × 很小、就在要點的牌旁邊，手滑很常見：給一次反悔的機會（挑牌模式是故意點掉的，不問）。
    if (!quiet && !editing) onRemoved(tag, () => restore(tag, was));
    tags = tags.filter((t) => t !== tag);
    write(key, tags);
    slots.delete(tag);
    pendingArrive.delete(tag);
    hot = -1;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      s?.remove();
      layout(true);
      onChange();
    };
    if (s?.isConnected && !quiet && !reduced()) {
      s.style.pointerEvents = "none";
      const a = s.querySelector(".fav-card").animate(
        [
          { opacity: 1, translate: "0 0", scale: "1" },
          { opacity: 0, translate: "0 22px", scale: "0.92" },
        ],
        { duration: 180, easing: "cubic-bezier(0.55, 0, 1, 0.45)", fill: "forwards" }
      );
      a.onfinish = finish;
      setTimeout(finish, 320);
    } else finish();
  }

  /** 復原：放回原本的位置，從底下浮上來。 */
  function restore(tag, at) {
    if (tags.includes(tag) || tags.length >= max || !known(tag)) return;
    if (!open) setOpen(true);
    tags.splice(Math.min(at, tags.length), 0, tag);
    write(key, tags);
    layout(true);
    onChange();
    const c = slots.get(tag)?.querySelector(".fav-card");
    if (c?.isConnected && !reduced()) c.animate([{ translate: "0 22px", opacity: 0 }, { translate: "0 0", opacity: 1 }], { duration: 320, easing: EASE });
  }

  function toggleEdit(force) {
    editing = force === undefined ? !editing : !!force;
    if (editing && !open) {
      open = true;
      write(key + ".open", true);
    }
    document.body.dataset.handEdit = editing ? "true" : "false";
    hot = -1;
    layout(true);
    onChange();
  }

  /**
   * 一張牌要從卡池回到托盤：先把位置擺好、藏著，影子落地（delay 毫秒後）才亮出來。
   * 房間的「飛回去」拿 nodeOf(tag) 的位置當落點。
   */
  function arriveAt(tag, delay = 480) {
    pendingArrive.add(tag);
    slots.get(tag)?.classList.add("is-arriving");
    setTimeout(() => {
      if (!pendingArrive.delete(tag)) return;
      const s = slots.get(tag);
      if (!s) return;
      s.classList.remove("is-arriving");
      if (!reduced()) s.querySelector(".fav-card").animate([{ translate: "0 4px" }, { translate: "0 -2px" }, { translate: "0 0" }], { duration: 260, easing: EASE });
    }, delay);
  }

  /** 字盒上標出哪幾張在手牌裡（root 底下的 .card[data-tag]）。 */
  function mark(root) {
    if (!root) return;
    const set = new Set(tags);
    for (const n of root.querySelectorAll(".card[data-tag]")) {
      if (set.has(n.dataset.tag)) n.dataset.inHand = "true";
      else delete n.dataset.inHand;
    }
  }

  let resizeRaf = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => layout(false));
  });
  layout(false);

  return {
    el,
    fan,
    get editing() {
      return editing;
    },
    get open() {
      return open && el.dataset.hidden !== "true";
    },
    get count() {
      return tags.length;
    },
    max,
    has: (t) => tags.includes(t),
    tags: () => [...tags],
    add,
    toggle,
    hover,
    drop,
    remove,
    toggleEdit,
    setOpen,
    toggleOpen: () => setOpen(!open),
    fromButton,
    update: () => layout(true),
    arriveAt,
    mark,
    /** 托盤上那張牌（收起來、沒擺出來就 null）：房間拿它當飛回來的落點。 */
    nodeOf: (t) => (open && slots.get(t)?.isConnected ? slots.get(t).querySelector(".fav-card") : null),
  };
}
