/**
 * web8 墨池工作台：開機、狀態、動作、生圖佇列、頂欄、快捷鍵、手機分頁。
 * 規則全部交給 web6 的 mobile-bridge.js（跟墨池網頁、iPhone App 同一套），生圖交給 web6 的 gen.js。
 * 版面說明見 README.md。
 */
import * as B from "./mobile-bridge.js";
import { createGenerator, tabTitle, watchLink, LINK_LABEL } from "./gen.js";
import { randomSeed } from "./engine.js";
import { h, $, $$, icon, toast, popover, closePopover, popoverOpen, sheet, fly } from "./w8-dom.js";
import * as P from "./w8-state.js";
import { createModels } from "./w8-models.js";
import { mountLibrary } from "./w8-library.js";
import { mountRecipe } from "./w8-recipe.js";
import { mountRules } from "./w8-rules.js";
import { mountStage } from "./w8-stage.js";
import { mountDetail } from "./w8-detail.js";

const ROOMS = [
  ["fuse.html", "疊印台", "比較四組提示詞再印"],
  ["book.html", "卡冊", "每張牌的戰績、偏好、自製牌"],
  ["album.html", "作品冊", "印過的圖、出圖日誌、模型成績"],
  ["parse.html", "解析池", "丟一張圖進來，認出裡面的牌"],
  ["tutorial.html", "教學", ""],
  ["arch.html", "原理", ""],
];
// 跟 w8.css 的手機版同一個寬度。
const PHONE = "(max-width: 899px)";

const listeners = new Map();
const app = {
  meta: null,
  core: null,
  ui: P.loadUi(),
  shots: [],
  link: "ok",
  follow: false,
  on(kind, fn) {
    if (!listeners.has(kind)) listeners.set(kind, new Set());
    listeners.get(kind).add(fn);
  },
  emit(kind, arg) {
    for (const fn of listeners.get(kind) || []) {
      try {
        fn(arg);
      } catch (e) {
        console.error(`[web8] ${kind}`, e);
      }
    }
  },
  saveUi: () => P.saveUi(app.ui),
  isPhone: () => matchMedia(PHONE).matches,
  selected: () => app.shots.find((s) => s.id === app.ui.selected) || null,
  pending: () => app.shots.filter((s) => s.status === "queued" || s.status === "running").length,
};

// ---------- 小工具 ----------
const uid = () => "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const artCache = new Map();
app.cardArt = (tag) => {
  if (!artCache.has(tag)) artCache.set(tag, B.cards([tag])[0]?.art?.thumb || null);
  return artCache.get(tag);
};
const nameOf = (tag) => B.cards([tag])[0]?.zh || tag;
app.hiddenByRating = (card) => {
  const order = app.meta.ratings.map((r) => r.id);
  const cur = order.indexOf(app.core.settings?.rating || "general");
  const need = order.indexOf(card.rating);
  return need > cur;
};

// ---------- 狀態 ----------
function setCore(next, kind = "pool") {
  const settingsChanged = JSON.stringify(next.settings) !== JSON.stringify(app.core.settings);
  app.core = next;
  P.saveCore(next);
  if (settingsChanged) {
    app.emit("settings");
    renderRating();
  }
  if (kind === "pool" || settingsChanged) app.emit("pool");
}

function persistShots() {
  P.saveShots(app.shots);
}

function addShots(list) {
  app.shots.unshift(...list);
  if (app.shots.length > P.SHOT_KEEP) {
    const gone = app.shots.splice(P.SHOT_KEEP);
    gen.drop(new Set(gone.map((s) => s.id)));
  }
}

function newShot(d) {
  const { comfy, ...rest } = d;
  return {
    ...rest,
    id: uid(),
    at: Date.now(),
    status: "drawn",
    progress: 0,
    note: "",
    preview: null,
    image: null,
    pins: [...app.core.pins],
    weights: { ...app.core.weights },
    ckpt: models.ckpt(),
    loras: models.payload(),
  };
}

// ---------- 動作 ----------
const act = {
  togglePin(tag, fromNode) {
    if (app.core.pins.includes(tag)) return act.unpin(tag);
    return act.pin(tag, fromNode);
  },
  pin(tag, fromNode) {
    const r = B.pin(app.core, tag);
    if (r.refused) return toast(r.refused, { key: "pin", tone: "warn" });
    const img = fromNode?.querySelector?.("img");
    const from = img?.getBoundingClientRect();
    setCore(r.state);
    if (r.note) toast(r.note, { key: "pin" });
    else if (r.carried?.length) toast(`跟著放進來：${r.carried.map((t) => `「${nameOf(t)}」`).join("")}`, { key: "pin" });
    if (img && !app.isPhone()) requestAnimationFrame(() => fly(img.currentSrc || img.src, from, recipe.slotRect(tag)));
    else if (app.isPhone()) toast(`「${nameOf(tag)}」放進配方了`, { key: "pin", ms: 1600 });
  },
  unpin(tag) {
    setCore(B.clear(app.core, tag).state);
  },
  toggleBan(tag) {
    if (app.core.bans.includes(tag)) return act.unban(tag);
    const prev = app.core;
    setCore(B.ban(app.core, tag).state);
    toast(`「${nameOf(tag)}」丟進廢字簍了：之後不會被抽到`, { key: "ban", action: "復原", onAction: () => setCore(prev) });
  },
  unban(tag) {
    setCore(B.clear(app.core, tag).state);
  },
  weigh(tag, dir) {
    setCore(B.weigh(app.core, tag, dir).state);
  },
  configure(patch) {
    const r = B.configure(app.core, patch);
    if (r.refused) toast(r.refused, { key: "rule", tone: "warn" });
    setCore(r.state, "settings");
  },
  clearPool() {
    const prev = app.core;
    setCore({ ...app.core, pins: [], weights: {} });
    toast("配方清空了", { key: "clear", action: "復原", onAction: () => setCore(prev) });
  },
  /** 一組牌照順序放（互斥的後放的贏），份量一起帶上。 */
  useTags(tags, weights = {}, note = "") {
    let cur = { ...app.core, pins: [], weights: {} };
    let skipped = 0;
    for (const tag of tags) {
      const r = B.pin(cur, tag);
      if (r.refused) skipped++;
      else cur = r.state;
    }
    cur = { ...cur, weights: Object.fromEntries(Object.entries(weights || {}).filter(([t]) => cur.pins.includes(t))) };
    const prev = app.core;
    setCore(cur);
    toast([note, skipped ? `${skipped} 張這個分級用不了，沒放` : ""].filter(Boolean).join("；") || "配方換好了", { key: "use", action: "復原", onAction: () => setCore(prev) });
    if (app.isPhone()) setView("stage");
  },
  useShot(s) {
    act.useTags((s.cards || []).filter((c) => c.isCard).map((c) => c.tag), s.weights || {}, "這張的牌放回配方了");
  },
  setN(n) {
    app.ui.n = Math.max(1, Math.min(8, n));
    app.saveUi();
    app.emit("ui");
  },
  draw(print) {
    let res;
    try {
      res = B.draw(app.core, { n: app.ui.n, trigger: models.trigger() });
    } catch (e) {
      return toast(String(e.message || e), { tone: "bad", ms: 6000 });
    }
    if (!res.shots.length) return toast("這組規則抽不出牌：放寬尺度、或從配方拿掉幾張再試", { tone: "warn" });
    const shots = res.shots.map(newShot);
    addShots(shots);
    app.ui.selected = shots[0].id;
    app.follow = print;
    if (print) for (const s of shots) gen.enqueue(s);
    persistShots();
    app.emit("shots");
    app.emit("select");
    if (app.isPhone()) setView("stage");
  },
  print(s) {
    app.ui.selected = s.id;
    app.follow = true;
    gen.enqueue(s);
    persistShots();
    app.emit("select");
  },
  reprint(s) {
    const copy = { ...s, id: uid(), at: Date.now(), seed: randomSeed(), status: "drawn", image: null, preview: null, job: null, progress: 0, note: "" };
    delete copy.result;
    addShots([copy]);
    act.print(copy);
    app.emit("shots");
  },
  cancel(s) {
    gen.cancelOne(s);
    persistShots();
    app.emit("shots", s);
  },
  remove(s) {
    if (gen.holds(s)) gen.cancelOne(s);
    const i = app.shots.indexOf(s);
    if (i < 0) return;
    app.shots.splice(i, 1);
    if (app.ui.selected === s.id) app.ui.selected = (app.shots[i] || app.shots[i - 1] || {}).id || null;
    persistShots();
    app.emit("shots");
    app.emit("select");
  },
  stopAll() {
    gen.stop();
    persistShots();
    app.emit("shots");
  },
  select(id) {
    app.follow = false;
    app.ui.selected = id;
    app.emit("select");
    setPanel("detail");
  },
  selectRel(d) {
    if (!app.shots.length) return;
    const i = app.shots.findIndex((s) => s.id === app.ui.selected);
    const next = app.shots[Math.max(0, Math.min(app.shots.length - 1, (i < 0 ? 0 : i) + d))];
    if (next) act.select(next.id);
  },
};
app.act = act;

// ---------- 生圖佇列（web6 gen.js：斷線重接、伺服器重開後找回成品都在裡面） ----------
const tab = tabTitle("墨池");
const gen = createGenerator({
  origin: "mochi",
  payload: (s) => ({ width: s.width, height: s.height, loras: s.loras || [], ckpt: s.ckpt || "", rating: s.rating, era: s.era }),
  update: (s) => {
    tab.shot(s, gen.pending);
    if (app.follow && s.status === "running" && app.ui.selected !== s.id) {
      const cur = app.selected();
      if (!cur || cur.status === "done" || cur.status === "drawn") {
        app.ui.selected = s.id;
        app.emit("select");
      }
    }
    if (s.status === "done" && s.id !== app.ui.selected && document.visibilityState === "visible") {
      toast("印好一張", { key: "done", action: "看", onAction: () => act.select(s.id), ms: 2400 });
    }
    const terminal = s.status === "done" || s.status === "failed" || s.status === "cancelled";
    if (terminal || (s.job && s._w8job !== s.job)) {
      s._w8job = s.job;
      persistShots();
    }
    app.emit("shots", s);
  },
  idle: () => app.emit("shots"),
  stopped: (why) => toast(why, { tone: "warn" }),
  waiting: (on) => toast(on ? "連不到主機，網路回來就接著印…" : "網路回來了，接著印", { key: "net" }),
  comfyWaiting: (on) => toast(on ? "ComfyUI 連不上，等它開好就接著印…" : "ComfyUI 回來了，接著印", { key: "comfy" }),
});
app.pending = () => gen.pending;

// ---------- 頂欄 ----------
function renderRating() {
  const box = $("#rating");
  const cur = app.core.settings?.rating || "general";
  box.replaceChildren(
    ...app.meta.ratings.map((r) =>
      h("button", { class: "seg-btn", type: "button", role: "radio", "aria-checked": String(r.id === cur), dataset: { rating: r.id }, onclick: () => act.configure({ rating: r.id }) }, r.label)
    )
  );
}

function renderLink() {
  const pill = $("#link");
  pill.dataset.state = app.link;
  pill.querySelector(".link-text").textContent = LINK_LABEL[app.link] || app.link;
  pill.title = app.link === "ok" ? "ComfyUI 連上了，可以生圖" : app.link === "comfy" ? "伺服器在，ComfyUI 沒開：可以先抽牌、排著，開了就接著印" : "連不到墨池的伺服器";
}

function openRooms(btn) {
  popover(
    btn,
    h(
      "nav",
      { class: "rooms", "aria-label": "其他房間" },
      ROOMS.map(([href, name, sub]) => h("a", { class: "room", href }, h("span", { class: "room-name" }, name), sub ? h("span", { class: "room-sub" }, sub) : null))
    ),
    { align: "end", cls: "pop-rooms" }
  );
}

function openHelp() {
  const row = (keys, what) => h("tr", {}, h("td", {}, keys.map((k) => h("kbd", {}, k))), h("td", {}, what));
  sheet(
    h(
      "div",
      { class: "help" },
      h("h2", { class: "help-title" }, "怎麼用"),
      h(
        "ol",
        { class: "help-steps" },
        h("li", {}, "左邊字盒點牌，放進中間的配方：放進來的每一張圖都一定有。"),
        h("li", {}, "右邊調規則：尺度、時代、尺寸、每段抽幾張、模型。"),
        h("li", {}, "按「生圖」，畫布上看它顯影；底片列著這次印的每一張。"),
        h("li", {}, "點底片看「這張」：用了哪些牌、哪些沒抽到、為什麼；點牌可以放進配方或丟廢字簍，再印。")
      ),
      h(
        "table",
        { class: "help-keys" },
        h(
          "tbody",
          {},
          row(["/"], "找牌"),
          row(["Enter"], "（找牌框裡）放第一張"),
          row(["右鍵"], "牌丟廢字簍／撿回來"),
          row(["D"], "只抽牌，不印"),
          row(["Ctrl", "Enter"], "抽並生圖"),
          row(["←", "→"], "底片上一張、下一張"),
          row(["Esc"], "關掉彈出來的東西")
        )
      )
    ),
    { label: "怎麼用" }
  );
}

// ---------- 檢視欄分頁、手機分頁 ----------
function setPanel(p) {
  app.ui.panel = p;
  app.saveUi();
  for (const b of $$("#insp-tabs [data-panel]")) b.setAttribute("aria-selected", String(b.dataset.panel === p));
  $("#rules").hidden = p !== "rules";
  $("#detail").hidden = p !== "detail";
  // 手機底下那顆分頁跟著寫現在是哪一頁。
  const label = $("#tabs [data-view='insp'] .tab-label");
  if (label) label.textContent = p === "detail" ? "這張" : "規則";
}
function setView(v) {
  app.ui.view = v;
  app.saveUi();
  document.documentElement.dataset.view = v;
  for (const b of $$("#tabs [data-view]")) b.setAttribute("aria-current", b.dataset.view === v ? "page" : "false");
}
app.setView = setView;

// ---------- 快捷鍵 ----------
function typing(e) {
  const t = e.target;
  return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    act.draw(true);
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
  if (e.key === "/") {
    e.preventDefault();
    library.focusSearch();
  } else if (e.key === "d" || e.key === "D") {
    e.preventDefault();
    act.draw(false);
  } else if (e.key === "?") {
    e.preventDefault();
    openHelp();
  } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.target.closest?.("#lib-grid") && !popoverOpen()) {
    e.preventDefault();
    act.selectRel(e.key === "ArrowLeft" ? -1 : 1);
  }
});

// ---------- 開機 ----------
let models;
let library;
let recipe;

async function start() {
  const root = document.documentElement;
  try {
    await B.boot({ base: "./" });
  } catch (e) {
    root.dataset.boot = "failed";
    $("#boot-msg").textContent = `讀不到詞庫：${e.message || e}。確認墨池的伺服器開著，再重新整理。`;
    return;
  }
  app.meta = B.meta();
  const saved = P.loadCore();
  app.core = B.configure(saved, {}).state;
  app.shots = P.loadShots();
  if (!app.shots.some((s) => s.id === app.ui.selected)) app.ui.selected = app.shots[0]?.id || null;

  models = createModels(() => {});
  renderRating();
  library = mountLibrary(app);
  recipe = mountRecipe(app);
  mountRules(app, models);
  mountStage(app);
  mountDetail(app);

  // 卡冊、作品冊「送去墨池」的牌。
  const hand = P.takeHandoff();
  if (hand && hand.tags.length) act.useTags(hand.tags, hand.weights, `從${hand.from === "parse" ? "解析池" : "其他房間"}帶來 ${hand.tags.length} 張牌`);

  // 重新整理之前沒印完的：接回去或照排。
  for (const s of app.shots) {
    if (s.resume) {
      delete s.resume;
      gen.resume(s);
    } else if (s.requeue) {
      delete s.requeue;
      gen.enqueue(s);
    }
  }

  $("#rooms").addEventListener("click", (e) => openRooms(e.currentTarget));
  $("#help").addEventListener("click", openHelp);
  for (const b of $$("#insp-tabs [data-panel]")) b.addEventListener("click", () => setPanel(b.dataset.panel));
  for (const b of $$("#tabs [data-view]")) b.addEventListener("click", () => setView(b.dataset.view));
  setPanel(app.ui.panel === "detail" ? "detail" : "rules");
  setView(["lib", "stage", "insp"].includes(app.ui.view) ? app.ui.view : "stage");

  watchLink((st) => {
    app.link = st;
    renderLink();
    app.emit("link");
  });
  root.dataset.boot = "ready";
}

start();
