/**
 * 偏好卡牌（手牌）：墨池、疊印台共用。每個房間自己一份（key 不同），最多十張。
 *
 * 樣子：視窗底部中間一把扇形的牌，平常只露出上半截；滑鼠靠近整把升起來，指到的那張浮起放大、
 * 兩旁的讓開。點一下（或拖進卡池）就出牌 —— 牌從扇形飛進卡池，剩下的重新攤開。
 * 已經在卡池裡的不顯示：手牌十張、卡池已經有其中三張，扇形只攤七張；那張從卡池拿下來，
 * 它飛回扇形（不是回字盒）。
 *
 * 挑牌：按「偏好卡牌」進入挑選模式 —— 字盒整欄亮起，點一下（或拖到底下）就加進手牌，
 * 牌從字盒飛進扇形；扇形上每張有 ×，空的位置畫成虛線框；「完成」或 Esc 離開。
 *
 * 房間要給的：
 *   key          localStorage 的鑰匙（兩個房間分開）
 *   makeNode(t)  畫一張牌（cards.js 的 cardNode）
 *   inPool(t)    這張現在在卡池裡嗎
 *   onPlay(t, r) 出牌（r：扇形上那張的位置，讓房間從這裡飛進卡池）
 *   onChange()   手牌變了（房間重畫字盒上的「手牌」記號、按鈕上的數字）
 *   known(t)     這張牌還在不在字盒（詞庫改了、被封鎖了就不要）
 *   decorate(n,t) 扇形上的牌做好之後給房間掛東西（拖曳）
 */
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createHand({ key, max = 10, makeNode, inPool, onPlay, onChange = () => {}, known = () => true, onFull = () => {}, decorate = () => {} }) {
  let tags = read().filter(known).slice(0, max);
  let editing = false;
  let hot = -1;
  let lastShown = new Set();
  let upTimer = 0;
  const slots = new Map();

  const el = document.createElement("div");
  el.className = "fav-hand";
  el.setAttribute("role", "region");
  el.setAttribute("aria-label", "偏好卡牌");
  const bar = document.createElement("div");
  bar.className = "fav-bar";
  const barText = document.createElement("span");
  barText.className = "fav-bar-text";
  const done = document.createElement("button");
  done.type = "button";
  done.className = "fav-done";
  done.textContent = "完成";
  done.addEventListener("click", () => toggleEdit(false));
  bar.append(barText, done);
  const fan = document.createElement("div");
  fan.className = "fav-fan";
  el.append(bar, fan);
  document.body.append(el);

  // 滑鼠靠近整把升起來；離開等一下才收（在牌跟牌之間移動不要一直升降）。
  el.addEventListener("pointerenter", (e) => {
    if (e.pointerType !== "mouse") return;
    clearTimeout(upTimer);
    el.classList.add("is-up");
  });
  el.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "mouse") return;
    clearTimeout(upTimer);
    upTimer = setTimeout(() => {
      el.classList.remove("is-up");
      setHot(-1);
    }, 160);
  });
  el.addEventListener("focusin", () => el.classList.add("is-up"));
  el.addEventListener("focusout", (e) => {
    if (!el.contains(e.relatedTarget)) el.classList.remove("is-up");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && editing) {
      e.preventDefault();
      toggleEdit(false);
    }
  });

  function read() {
    try {
      const v = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(v) ? v.filter((t) => typeof t === "string") : [];
    } catch {
      return [];
    }
  }
  function save() {
    try {
      localStorage.setItem(key, JSON.stringify(tags));
    } catch {
      /* 存不了就只活在這一頁 */
    }
  }

  /** 扇形要攤哪幾張：平常只攤不在卡池裡的；挑牌時全部攤（在卡池的淡一點），加上空位。 */
  function shownTags() {
    return editing ? tags : tags.filter((t) => !inPool(t));
  }

  function geometry(n, i, cardW) {
    // 窄螢幕：展開寬度扣掉旋轉後多出來的角，角度也收小一點，最外面那張不會被切掉。
    const narrow = innerWidth < 640;
    const room = Math.min(innerWidth - 40, 620) - cardW * (narrow ? 0.6 : 0.3);
    const step = n > 1 ? Math.min(cardW * 0.66, (room - cardW) / (n - 1)) : 0;
    const ang = n > 1 ? Math.min(6, (narrow ? 24 : 44) / (n - 1)) : 0;
    const off = i - (n - 1) / 2;
    return { x: off * step, y: off * off * 2.4, r: off * ang };
  }

  function place(slot, i, n, cardW, animate) {
    const g = geometry(n, i, cardW);
    let { x, y, r } = g;
    let s = 1;
    if (hot >= 0 && hot < n) {
      if (i === hot) {
        y -= 38;
        r = 0;
        s = 1.14;
      } else {
        const d = i - hot;
        x += Math.sign(d) * Math.max(0, 22 - (Math.abs(d) - 1) * 8);
      }
    }
    slot.style.transition = animate && !reduced() ? "" : "none";
    slot.style.transform = `translate(calc(-50% + ${x}px), ${y}px) rotate(${r}deg) scale(${s})`;
    slot.style.zIndex = String(i === hot ? 50 : 10 + i);
  }

  function cardW() {
    return innerWidth < 640 ? 62 : 84;
  }

  function setHot(i) {
    if (i === hot) return;
    hot = i;
    layout(true);
  }

  function slotFor(tag) {
    let s = slots.get(tag);
    if (s) return s;
    s = document.createElement("div");
    s.className = "fav-slot";
    s.dataset.tag = tag;
    const node = makeNode(tag);
    node.classList.add("fav-card");
    node.style.setProperty("--card-w", cardW() + "px");
    decorate(node, tag);
    node.addEventListener("click", (e) => {
      if (s.dataset.dragged === "true") return;
      if (editing) return;
      e.preventDefault();
      play(tag);
    });
    node.addEventListener("keydown", (e) => {
      if ((e.key === "Delete" || e.key === "Backspace") && editing) {
        e.preventDefault();
        remove(tag);
      }
    });
    node.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse") setHot([...fan.querySelectorAll(".fav-slot:not(.fav-empty)")].indexOf(s));
    });
    node.addEventListener("focus", () => setHot([...fan.querySelectorAll(".fav-slot:not(.fav-empty)")].indexOf(s)));
    const x = document.createElement("button");
    x.type = "button";
    x.className = "fav-x";
    x.setAttribute("aria-label", "從偏好卡牌拿掉");
    x.textContent = "×";
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      remove(tag);
    });
    s.append(node, x);
    slots.set(tag, s);
    return s;
  }

  /** 重新攤牌。animate：位置變化用轉場滑過去（加牌、出牌、指到別張）。 */
  function layout(animate = true) {
    const show = shownTags();
    const empties = editing ? Math.max(0, max - tags.length) : 0;
    const n = show.length + empties;
    const w = cardW();
    const kids = [];
    show.forEach((t) => {
      const s = slotFor(t);
      s.classList.toggle("is-in-pool", editing && inPool(t));
      s.querySelector(".fav-card").style.setProperty("--card-w", w + "px");
      kids.push(s);
    });
    for (let i = 0; i < empties; i++) {
      const e = document.createElement("div");
      e.className = "fav-slot fav-empty";
      e.setAttribute("aria-hidden", "true");
      e.style.setProperty("--card-w", w + "px");
      kids.push(e);
    }
    // 保留已經在的節點（位置才滑得過去），只換掉順序與空位。
    const keep = new Set(kids);
    for (const c of [...fan.children]) if (!keep.has(c)) c.remove();
    kids.forEach((k, i) => {
      if (fan.children[i] !== k) fan.insertBefore(k, fan.children[i] || null);
    });
    kids.forEach((k, i) => place(k, i, n, w, animate && k.isConnected));
    el.dataset.empty = n ? "false" : "true";
    el.dataset.editing = editing ? "true" : "false";
    el.style.setProperty("--card-w", w + "px");
    barText.textContent = `偏好卡牌 ${tags.length}/${max}・從左邊字盒點一下或拖到這裡`;
    const now = new Set(show);
    // 剛回到扇形的（從卡池拿下來）：等它飛回來的影子落地才出現（見 arriveAt）。
    for (const t of now) if (!lastShown.has(t) && !editing && pendingArrive.has(t)) slots.get(t)?.classList.add("is-arriving");
    lastShown = now;
  }

  const pendingArrive = new Set();

  function play(tag) {
    const s = slots.get(tag);
    const r = s?.querySelector(".fav-card")?.getBoundingClientRect();
    setHot(-1);
    onPlay(tag, r || null);
  }

  /** 從外面（字盒、卡池）加一張。from：來源的位置，牌從那裡飛進扇形。 */
  function add(tag, from = null) {
    if (tags.includes(tag)) {
      const s = slots.get(tag);
      if (s && !reduced()) s.querySelector(".fav-card").animate([{ transform: "none" }, { transform: "translateY(-10px)" }, { transform: "none" }], { duration: 320, easing: EASE });
      return false;
    }
    if (tags.length >= max) {
      if (!reduced()) fan.animate([{ transform: "none" }, { transform: "translateX(-8px)" }, { transform: "translateX(8px)" }, { transform: "translateX(-4px)" }, { transform: "none" }], { duration: 360, easing: "ease-out" });
      onFull();
      return false;
    }
    tags.push(tag);
    save();
    layout(true);
    onChange();
    const s = slots.get(tag);
    if (s && from && !reduced()) flyInto(s, from);
    else if (s && !reduced()) s.querySelector(".fav-card").animate([{ transform: "translateY(30px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 360, easing: EASE });
    return true;
  }

  function flyInto(slot, from) {
    const card = slot.querySelector(".fav-card");
    const to = card.getBoundingClientRect();
    if (!to.width) return;
    const f = card.cloneNode(true);
    Object.assign(f.style, { position: "fixed", left: from.left + "px", top: from.top + "px", width: from.width + "px", margin: "0", zIndex: "90", pointerEvents: "none" });
    f.style.setProperty("--card-w", from.width + "px");
    document.body.append(f);
    card.style.visibility = "hidden";
    const dx = to.left - from.left;
    const dy = to.top - from.top;
    const sc = to.width / from.width;
    const a = f.animate(
      [
        { transform: "none" },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 60}px) scale(${(1 + sc) / 2}) rotate(-8deg)`, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(${sc})` },
      ],
      { duration: 520, easing: "cubic-bezier(0.45, 0, 0.25, 1)", fill: "forwards" }
    );
    const land = () => {
      if (!f.isConnected) return;
      f.remove();
      card.style.visibility = "";
      card.animate([{ transform: "translateY(4px) scale(0.96)" }, { transform: "translateY(-3px) scale(1.03)" }, { transform: "none" }], { duration: 300, easing: EASE });
    };
    a.onfinish = land;
    setTimeout(land, 700);
  }

  /** 從手牌拿掉（挑牌時按 ×、拖回字盒、被封鎖）。 */
  function remove(tag, { quiet = false } = {}) {
    if (!tags.includes(tag)) return;
    const s = slots.get(tag);
    tags = tags.filter((t) => t !== tag);
    save();
    slots.delete(tag);
    const finish = () => {
      s?.remove();
      layout(true);
      onChange();
    };
    if (s && !quiet && !reduced()) {
      s.style.pointerEvents = "none";
      const a = s.animate([{ opacity: 1, translate: "0 0" }, { opacity: 0, translate: "0 40px" }], { duration: 220, easing: "cubic-bezier(0.55, 0, 1, 0.45)", fill: "forwards" });
      a.onfinish = finish;
      setTimeout(() => s.isConnected && finish(), 400);
    } else finish();
  }

  function toggleEdit(force) {
    editing = force === undefined ? !editing : !!force;
    document.body.dataset.handEdit = editing ? "true" : "false";
    el.classList.toggle("is-up", editing);
    setHot(-1);
    layout(true);
    onChange();
    if (editing) done.focus({ preventScroll: true });
  }

  /**
   * 一張牌要從卡池回到手牌：先把它在扇形上的位置算好、藏著，影子落地（delay 毫秒後）才亮出來。
   * 房間的「飛回去」會拿 nodeOf(tag) 的位置當落點。
   */
  function arriveAt(tag, delay = 480) {
    pendingArrive.add(tag);
    setTimeout(() => {
      pendingArrive.delete(tag);
      const s = slots.get(tag);
      if (!s) return;
      s.classList.remove("is-arriving");
      if (!reduced()) s.querySelector(".fav-card").animate([{ transform: "translateY(6px) scale(0.94)" }, { transform: "translateY(-4px) scale(1.04)" }, { transform: "none" }], { duration: 320, easing: EASE });
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

  window.addEventListener("resize", () => layout(false));
  layout(false);

  return {
    el,
    fan,
    get editing() {
      return editing;
    },
    get count() {
      return tags.length;
    },
    max,
    has: (t) => tags.includes(t),
    tags: () => [...tags],
    add,
    remove,
    toggleEdit,
    update: () => layout(true),
    arriveAt,
    mark,
    /** 扇形上那張牌的節點（沒有就 null）：房間拿它當飛回來的落點。 */
    nodeOf: (t) => slots.get(t)?.querySelector(".fav-card") || null,
    slotOf: (t) => slots.get(t) || null,
  };
}
