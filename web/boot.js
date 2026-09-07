import {
  applyBan,
  applyClear,
  autoBannedFromPins,
  cycleTag,
  defaultSettings,
  drawOne,
  identityPins,
  sanitizeSettings,
  ERAS,
  ERA_LABELS,
  eraMismatches,
  FEMALE_COUNT,
  indexLexicon,
  labelOf,
  MALE_COUNT,
  missingPins,
  mulberry32,
  randomSeed,
  tagState,
} from "./engine.js";

const SECTIONS = [
  { id: "quality", title: "畫質與風格", hint: "每張都帶，不能改" },
  { id: "subject", title: "人數", hint: "跟左欄走。只開女就不會看到男生的字" },
  { id: "feature", title: "長相", hint: "髮、眼、身材。有男時可抽種族，同類只一個" },
  { id: "pose", title: "姿勢", hint: "先身體和鏡頭，尺度對上才補走光／性愛" },
  { id: "clothing", title: "服裝", hint: "時代服裝分開。顏色變體靠在父類旁邊" },
  { id: "env", title: "場景", hint: "先室內外、晝夜、地點" },
];

const COUNT_LABELS = {
  subject: "主體",
  feature: "特徵",
  pose: "姿勢",
  clothing: "服裝",
  env: "場＋光",
};

const STORE = "tag-case-v1";

let lex;
let settings;
let pinned = new Set();
let userBanned = new Set();
let aborting = false;
let running = false;
let genAbort = null;
let viewMode = "all";
let eraOnly = true;
let lastPositive = "";
const btnByTag = new Map();
const userOpen = new Set(["sec-quality"]);
let paintPrev = { pin: new Set(), auto: new Set(), user: new Set() };

const $ = (id) => document.getElementById(id);

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "{}");
  } catch {
    return {};
  }
}

function saveStore() {
  localStorage.setItem(
    STORE,
    JSON.stringify({
      settings,
      pinned: [...pinned],
      userBanned: [...userBanned],
    })
  );
}

function speak(text) {
  $("live").textContent = text;
  $("status").textContent = text;
}

async function ping() {
  const el = $("ping");
  try {
    const r = await fetch("/api/ping");
    const j = await r.json();
    el.dataset.ok = j.ok ? "1" : "0";
    el.querySelector("span").textContent = j.ok
      ? `Comfy ${j.version || "ok"}`
      : "Comfy 未連上";
  } catch {
    el.dataset.ok = "0";
    el.querySelector("span").textContent = "Comfy 未連上";
  }
}

function renderCounts() {
  const box = $("counts");
  box.replaceChildren();
  for (const [key, label] of Object.entries(COUNT_LABELS)) {
    const lab = document.createElement("span");
    lab.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "20";
    input.value = String(settings.counts[key] ?? 0);
    input.addEventListener("change", () => {
      settings.counts[key] = Math.max(0, Math.min(20, Number(input.value) || 0));
      saveStore();
    });
    const off = document.createElement("button");
    off.type = "button";
    off.className = "ghost mini";
    off.textContent = "不補";
    off.setAttribute("aria-label", `${label}不補`);
    off.addEventListener("click", () => {
      settings.counts[key] = 0;
      input.value = "0";
      saveStore();
    });
    box.append(lab, input, off);
  }
}

function syncSizeButtons() {
  for (const btn of $("sizes").querySelectorAll(".seg")) {
    const on =
      Number(btn.dataset.w) === settings.width &&
      Number(btn.dataset.h) === settings.height;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  $("width").value = String(settings.width);
  $("height").value = String(settings.height);
}

function renderEras() {
  const box = $("eras");
  box.replaceChildren();
  const exclusive = settings.eras.length === 1;
  const mix = document.createElement("button");
  mix.type = "button";
  mix.className = "chip-toggle";
  mix.textContent = "混合";
  mix.setAttribute("aria-pressed", exclusive ? "false" : "true");
  mix.addEventListener("click", () => {
    settings.eras = [...ERAS];
    saveStore();
    renderEras();
    renderCats("filter");
  });
  box.append(mix);
  for (const era of ERAS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip-toggle";
    btn.dataset.era = era;
    btn.textContent = ERA_LABELS[era];
    btn.setAttribute("aria-pressed", exclusive && settings.eras[0] === era ? "true" : "false");
    btn.addEventListener("click", () => {
      settings.eras = [era];
      saveStore();
      renderEras();
      renderCats("filter");
    });
    box.append(btn);
  }
  updateEraClash();
}

function updateEraClash() {
  const note = $("era-clash");
  if (!note) return;
  const era = exclusiveEra();
  const clash = era ? eraMismatches(lex, pinned, era) : [];
  if (clash.length) {
    note.hidden = false;
    note.textContent =
      "你釘的「" +
      clash.map((t) => labelOf(lex, t)).join("、") +
      "」不是" +
      (ERA_LABELS[era] || era) +
      "的衣服。這張仍走" +
      (ERA_LABELS[era] || era) +
      "場景，釘選也會留在圖裡。";
  } else {
    note.hidden = true;
    note.textContent = "";
  }
}

function syncSamePerson() {
  const btn = $("same-person");
  if (!btn) return;
  btn.setAttribute("aria-pressed", settings.samePerson ? "true" : "false");
}

function syncHeat() {
  for (const btn of $("presets").querySelectorAll(".seg")) {
    btn.setAttribute(
      "aria-pressed",
      btn.dataset.preset === settings.heatPreset ? "true" : "false"
    );
  }
  for (const btn of $("heats").querySelectorAll(".chip-toggle")) {
    btn.setAttribute(
      "aria-pressed",
      settings.heats.includes(btn.dataset.heat) ? "true" : "false"
    );
  }
}

function applyPreset(name) {
  const table = lex.data.heatWeights[name];
  if (!table) return;
  settings.heatPreset = name;
  settings.weights = { ...table };
  settings.heats = Object.entries(table)
    .filter(([, w]) => w > 0)
    .map(([h]) => h);
  if (name === "mixed") settings.heats = ["tease", "flash", "sex"];
  if (!settings.heats.length) settings.heats = ["tease"];
  syncHeat();
  saveStore();
  renderCats("heat");
}

function toggleHeat(h) {
  const set = new Set(settings.heats);
  if (set.has(h)) {
    if (set.size === 1) return;
    set.delete(h);
  } else set.add(h);
  settings.heats = [...set];
  settings.heatPreset = "custom";
  const w = { tease: 0, flash: 0, sex: 0 };
  const share = 1 / settings.heats.length;
  for (const x of settings.heats) w[x] = share;
  settings.weights = w;
  syncHeat();
  saveStore();
  renderCats("heat");
}

function tagsBanned(tags) {
  return tags.length > 0 && tags.every((t) => userBanned.has(t));
}

function toggleBanTags(tags) {
  if (!tags.length) return;
  if (tagsBanned(tags)) {
    for (const t of tags) {
      const next = applyClear(pinned, userBanned, t);
      pinned = next.pinned;
      userBanned = next.userBanned;
    }
  } else {
    for (const t of tags) {
      const next = applyBan(lex, pinned, userBanned, t);
      pinned = next.pinned;
      userBanned = next.userBanned;
    }
  }
  afterPin();
}

function closeAllBtn(label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ghost mini";
  btn.dataset.close = "1";
  btn.textContent = "關閉全部";
  btn.setAttribute("aria-label", `關閉全部：${label}`);
  return btn;
}

function exclusiveEra() {
  return settings.eras && settings.eras.length === 1 ? settings.eras[0] : null;
}

function exclusiveCast() {
  if (settings.girl && !settings.boy) return "female";
  if (settings.boy && !settings.girl) return "male";
  return null;
}

function fitsCast(item) {
  const ex = exclusiveCast();
  if (!ex) return true;
  if (item.gate && item.gate !== "any" && item.gate !== ex) return false;
  const needs = item.needs || [];
  if (ex === "female" && needs.includes("male")) return false;
  if (ex === "male" && needs.includes("female")) return false;
  return true;
}

function syncCast() {
  const ex = exclusiveCast();
  $("girl").setAttribute("aria-pressed", ex === "female" ? "true" : "false");
  $("boy").setAttribute("aria-pressed", ex === "male" ? "true" : "false");
  const any = $("cast-any");
  if (any) any.setAttribute("aria-pressed", ex ? "false" : "true");
  const note = $("cast-clash");
  if (!note) return;
  const clash = [];
  for (const t of pinned) {
    const it = lex.byTag.get(t);
    if (!it) continue;
    if (ex === "female" && (it.gate === "male" || (it.needs || []).includes("male") || MALE_COUNT.has(t))) {
      clash.push(t);
    }
    if (ex === "male" && (it.gate === "female" || (it.needs || []).includes("female") || FEMALE_COUNT.has(t))) {
      clash.push(t);
    }
  }
  if (clash.length) {
    note.hidden = false;
    note.textContent =
      "你釘了「" +
      clash.map((t) => labelOf(lex, t)).join("、") +
      "」，左欄雖只開" +
      (ex === "female" ? "女" : "男") +
      "，這些仍會進圖。";
  } else {
    note.hidden = true;
    note.textContent = "";
  }
}

function fitsEra(item) {
  const era = exclusiveEra();
  if (!era) return true;
  const e = item.era;
  if (!e || !e.length || e.includes("any")) return true;
  return e.includes(era);
}

function fitsHeat(item) {
  const hs = item.heat;
  if (!hs || !hs.length) return true;
  return hs.some((h) => settings.heats.includes(h));
}

function sortItems(list) {
  return list.slice().sort((a, b) => {
    const wa = a.tag.split(" ").length;
    const wb = b.tag.split(" ").length;
    if (wa !== wb) return wa - wb;
    const za = a.zh || labelOf(lex, a.tag);
    const zb = b.zh || labelOf(lex, b.tag);
    return za.localeCompare(zb, "zh-Hant");
  });
}

const COLOR_WORD = new Set([
  "white",
  "black",
  "blue",
  "green",
  "red",
  "pink",
  "purple",
  "brown",
  "aqua",
  "orange",
  "yellow",
  "grey",
  "gray",
]);

function parentKey(item, inSet) {
  if (item.section !== "clothing") return null;
  const okParent = (p) => {
    const parent = lex.byTag.get(p);
    if (!parent || parent.section !== "clothing") return false;
    if (item.mutex && parent.mutex && parent.mutex === item.mutex) return false;
    return true;
  };
  const parts = String(item.tag || "").split(" ");
  if (parts.length >= 2 && COLOR_WORD.has(parts[0])) {
    const rest = parts.slice(1).join(" ");
    if (inSet.has(rest) && okParent(rest)) return rest;
  }
  const implied = (item.implies || []).filter((p) => inSet.has(p) && p !== item.tag && okParent(p));
  if (implied.length) {
    implied.sort((a, b) => b.length - a.length);
    return implied[0];
  }
  return null;
}

function clusterItems(list, auto) {
  const inSet = new Set(list.map((i) => i.tag));
  const parentOf = new Map();
  for (const item of list) {
    const p = parentKey(item, inSet);
    if (p) parentOf.set(item.tag, p);
  }
  const rootOf = (tag) => {
    let cur = tag;
    const seen = new Set();
    while (parentOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = parentOf.get(cur);
    }
    return cur;
  };
  const children = new Map();
  const roots = [];
  for (const item of list) {
    const r = rootOf(item.tag);
    if (r === item.tag) {
      roots.push(item);
      continue;
    }
    if (!children.has(r)) children.set(r, []);
    children.get(r).push(item);
  }
  for (const [p, kids] of children) children.set(p, sortItems(kids));
  return { roots, children };
}

function isFixedTag(tag) {
  if (!lex) return true;
  if ((lex.data.quality || []).includes(tag)) return true;
  if ((lex.data.alwaysEnv || []).includes(tag)) return true;
  if ((lex.data.nsfwTail || []).includes(tag)) return true;
  return !lex.byTag.has(tag);
}

function showPos(positive) {
  lastPositive = String(positive || "").trim();
  renderTray();
}

function paintTrayChip(btn, tag, auto) {
  btn.dataset.tag = tag;
  btn.dataset.en = tag;
  btn.textContent = labelOf(lex, tag);
  if (isFixedTag(tag)) {
    btn.dataset.state = "pinned";
    btn.dataset.locked = "1";
    btn.disabled = true;
    delete btn.dataset.ban;
    btn.title = tag;
    return;
  }
  btn.disabled = false;
  delete btn.dataset.locked;
  const st = tagState(tag, pinned, userBanned, auto);
  btn.dataset.state = st;
  if (st === "banned") btn.dataset.ban = auto.has(tag) && !userBanned.has(tag) ? "mutex" : "user";
  else delete btn.dataset.ban;
  btn.title = "點一下：釘選／關掉／回到池中";
}

function renderTray() {
  const tray = $("tray");
  const box = $("tray-pins");
  const count = $("tray-count");
  if (!tray || !box) return;
  const auto = lex ? autoBannedFromPins(lex, pinned) : new Set();
  const tags = lastPositive
    ? lastPositive.split(", ").map((t) => t.trim()).filter(Boolean)
    : [...pinned];
  tray.classList.toggle("is-on", tags.length > 0);
  tray.hidden = false;
  const head = tray.querySelector(".tray-head");
  const title = head && head.querySelector("strong");
  if (title) title.textContent = lastPositive ? "這張 POS" : "必進這張圖";
  if (head && lastPositive && !head.querySelector(".copy-pos")) {
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "ghost mini copy-pos";
    copy.textContent = "複製";
    copy.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!lastPositive) return;
      await navigator.clipboard.writeText(lastPositive);
      copy.textContent = "已複製";
      window.setTimeout(() => {
        copy.textContent = "複製";
      }, 1200);
    });
    head.append(copy);
  }
  if (!tags.length) {
    box.replaceChildren();
    if (count) count.textContent = "";
    return;
  }
  if (count) count.textContent = lastPositive ? `${tags.length} 個 · 點字可釘／關` : `${pinned.size} 個`;
  const prev = [...box.querySelectorAll(":scope > .tag")];
  const same = prev.length === tags.length && prev.every((el, i) => el.dataset.tag === tags[i]);
  if (same) {
    for (let i = 0; i < prev.length; i++) paintTrayChip(prev[i], tags[i], auto);
    return;
  }
  const frag = document.createDocumentFragment();
  tags.forEach((tag, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tag";
    btn.style.setProperty("--i", String(Math.min(i, 16)));
    paintTrayChip(btn, tag, auto);
    frag.append(btn);
  });
  box.replaceChildren(frag);
}

function syncViewFilters() {
  const bar = $("view-filters");
  if (!bar) return;
  for (const btn of bar.querySelectorAll("[data-view]")) {
    btn.setAttribute("aria-pressed", btn.dataset.view === viewMode ? "true" : "false");
  }
  const eraBtn = $("era-only");
  if (eraBtn) {
    eraBtn.hidden = !exclusiveEra();
    eraBtn.setAttribute("aria-pressed", eraOnly ? "true" : "false");
  }
}

function sectionItems(sec) {
  if (sec.id === "quality") {
    return lex.data.quality.map((tag) => ({
      tag,
      section: "quality",
      group: "fixed",
      zh: (lex.data.zh || {})[tag],
    }));
  }
  return lex.bySection[sec.id] || [];
}

function chipShouldShow(item, auto, q) {
  if (item.section === "quality") {
    if (viewMode === "pinned" || viewMode === "banned") return false;
    if (q) {
      const zh = (item.zh || labelOf(lex, item.tag) || "").toLowerCase();
      if (!item.tag.toLowerCase().includes(q) && !zh.includes(q)) return false;
    }
    return true;
  }
  const st = tagState(item.tag, pinned, userBanned, auto);
  if (viewMode === "pinned" && st !== "pinned") return false;
  if (viewMode === "banned" && st !== "banned") return false;
  if (eraOnly && exclusiveEra() && !fitsEra(item) && st !== "pinned") return false;
  if (!fitsCast(item) && st !== "pinned") return false;
  if (q) {
    const zh = (item.zh || labelOf(lex, item.tag) || "").toLowerCase();
    if (!item.tag.toLowerCase().includes(q) && !zh.includes(q)) return false;
  }
  return true;
}

function catalogItem(tag) {
  const item = lex.byTag.get(tag);
  if (item) return item;
  if ((lex.data.quality || []).includes(tag)) {
    return { tag, section: "quality", zh: (lex.data.zh || {})[tag] };
  }
  return null;
}

function applyCatOpen(wrap, opened) {
  wrap.classList.toggle("is-open", opened);
  const toggle = wrap.querySelector(":scope > header .cat-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", opened ? "true" : "false");
  const body = wrap.querySelector(":scope > .cat-body");
  if (body) body.inert = !opened;
}

function hintFor(sec, vis) {
  if (sec.id === "subject") {
    const ex = exclusiveCast();
    return (
      vis.length +
      " · " +
      (ex === "female" ? "只開女，男生的字已收起" : ex === "male" ? "只開男，女生的字已收起" : "男女都可能出現")
    );
  }
  return `${vis.length} · ${sec.hint}`;
}

function setData(el, key, val) {
  if (!val) {
    if (el.dataset[key]) delete el.dataset[key];
    return;
  }
  if (el.dataset[key] !== val) el.dataset[key] = val;
}

function applyTagState(btn, item, auto, secId) {
  if (secId === "quality" || btn.dataset.locked === "1") return;
  const st = tagState(item.tag, pinned, userBanned, auto);
  const zh = item.zh || labelOf(lex, item.tag);
  const mutexBan = st === "banned" && auto.has(item.tag) && !userBanned.has(item.tag);
  const ban = st === "banned" ? (mutexBan ? "mutex" : "user") : "";
  const label =
    st === "banned" ? `${zh} (${item.tag}) ${mutexBan ? "與釘選互斥" : "已關閉"}` : `${zh} (${item.tag})`;
  setData(btn, "state", st);
  setData(btn, "ban", ban);
  setData(btn, "offEra", !fitsEra(item) && st !== "pinned" ? "1" : "");
  setData(btn, "offCast", !fitsCast(item) && st !== "pinned" ? "1" : "");
  setData(btn, "offHeat", secId !== "subject" && !fitsHeat(item) && st === "pool" ? "1" : "");
  if (btn.getAttribute("aria-label") !== label) btn.setAttribute("aria-label", label);
}

function rememberBtn(tag, btn) {
  let list = btnByTag.get(tag);
  if (!list) {
    list = [];
    btnByTag.set(tag, list);
  }
  list.push(btn);
}

function paintDirty(auto, dirty) {
  for (const tag of dirty) {
    const item = lex.byTag.get(tag);
    if (!item) continue;
    for (const btn of btnByTag.get(tag) || []) applyTagState(btn, item, auto, item.section);
  }
}

function paintAll(auto) {
  for (const [tag, btns] of btnByTag) {
    const item = lex.byTag.get(tag);
    if (!item) continue;
    for (const btn of btns) applyTagState(btn, item, auto, item.section);
  }
}

function collectDirty(auto) {
  const dirty = new Set();
  const mark = (cur, prev) => {
    for (const t of cur) if (!prev.has(t)) dirty.add(t);
    for (const t of prev) if (!cur.has(t)) dirty.add(t);
  };
  mark(pinned, paintPrev.pin);
  mark(auto, paintPrev.auto);
  mark(userBanned, paintPrev.user);
  return dirty;
}

function syncVisibility(auto) {
  const root = $("cats");
  if (!root) return;
  const q = ($("q").value || "").trim().toLowerCase();
  const famShow = new Map();
  const subShow = new Map();
  const catN = new Map();
  for (const [tag, btns] of btnByTag) {
    const item = catalogItem(tag);
    if (!item) continue;
    const show = chipShouldShow(item, auto, q);
    for (const btn of btns) {
      if (btn.hidden !== !show) btn.hidden = !show;
      if (!show) continue;
      const fam = btn.closest(".family");
      const sub = btn.closest(".sub");
      const cat = btn.closest(".cat");
      if (fam) famShow.set(fam, true);
      if (sub) subShow.set(sub, true);
      if (cat) catN.set(cat, (catN.get(cat) || 0) + 1);
    }
  }
  for (const fam of root.querySelectorAll(".family")) fam.hidden = !famShow.get(fam);
  for (const sub of root.querySelectorAll(".sub")) sub.hidden = !subShow.get(sub);
  const filtering = !!q || viewMode !== "all";
  let any = false;
  for (const wrap of root.querySelectorAll(".cat")) {
    const n = catN.get(wrap) || 0;
    wrap.hidden = n === 0;
    if (n) any = true;
    const shouldOpen = filtering ? n > 0 : userOpen.has(wrap.id);
    applyCatOpen(wrap, shouldOpen);
    const sec = SECTIONS.find((s) => wrap.id === "sec-" + s.id);
    const hint = wrap.querySelector(".cat-actions > span");
    if (hint && sec) hint.textContent = hintFor(sec, { length: n });
    const closer = wrap.querySelector(":scope > header .ghost.mini");
    if (closer) {
      const tags = [];
      for (const btn of wrap.querySelectorAll(".tag[data-tag]")) {
        if (!btn.hidden) tags.push(btn.dataset.tag);
      }
      const closed = tagsBanned(tags);
      closer.textContent = closed ? "開啟全部" : "關閉全部";
    }
    for (const sub of wrap.querySelectorAll(":scope .sub")) {
      const subClose = sub.querySelector(":scope > .sub-head .ghost.mini");
      if (!subClose) continue;
      const tags = [];
      for (const btn of sub.querySelectorAll(".tag[data-tag]")) {
        if (!btn.hidden) tags.push(btn.dataset.tag);
      }
      const closed = tagsBanned(tags);
      subClose.textContent = closed ? "開啟全部" : "關閉全部";
    }
  }
  let empty = root.querySelector(":scope > .empty-filter");
  if (!any) {
    if (!empty) {
      empty = document.createElement("p");
      empty.className = "hint empty-filter";
      root.append(empty);
    }
    empty.hidden = false;
    empty.textContent = q ? "沒有符合的字。" : "這個篩選下沒有 tag。";
  } else if (empty) empty.hidden = true;
}

function renderCats(mode = "auto") {
  if (!btnByTag.size) {
    buildCats();
    return;
  }
  const auto = autoBannedFromPins(lex, pinned);
  if (mode === "heat" || mode === "filter") paintAll(auto);
  else if (mode !== "search") {
    const dirty = collectDirty(auto);
    if (dirty.size) paintDirty(auto, dirty);
  }
  paintPrev = { pin: new Set(pinned), auto, user: new Set(userBanned) };
  if (mode !== "heat") syncVisibility(auto);
  syncViewFilters();
}

function buildCats() {
  btnByTag.clear();
  const auto = autoBannedFromPins(lex, pinned);
  paintPrev = { pin: new Set(pinned), auto, user: new Set(userBanned) };
  const root = $("cats");
  const frag = document.createDocumentFragment();
  syncViewFilters();

  for (const sec of SECTIONS) {
    const wrap = document.createElement("section");
    wrap.className = "cat" + (sec.id === "quality" ? " quality" : "");
    wrap.id = "sec-" + sec.id;
    const opened = userOpen.has(wrap.id) || location.hash === "#" + wrap.id;
    if (opened) userOpen.add(wrap.id);
    const head = document.createElement("header");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "cat-toggle";
    toggle.setAttribute("aria-expanded", opened ? "true" : "false");
    const title = document.createElement("strong");
    title.textContent = sec.title;
    toggle.append(title);
    const items = sectionItems(sec);
    const hint = document.createElement("span");
    hint.textContent = hintFor(sec, { length: sec.id === "quality" ? items.length : 0 });
    const actions = document.createElement("div");
    actions.className = "cat-actions";
    actions.append(hint);
    if (sec.id !== "quality") actions.append(closeAllBtn(sec.title));
    head.append(toggle, actions);
    wrap.append(head);
    const body = document.createElement("div");
    body.className = "cat-body";
    body.id = wrap.id + "-body";
    toggle.setAttribute("aria-controls", body.id);
    wrap.append(body);
    applyCatOpen(wrap, opened);
    const order = (lex.data.groupOrder && lex.data.groupOrder[sec.id]) || ["other"];
    const zhMap = lex.data.groupZh || {};
    const buckets = new Map();
    for (const item of items) {
      const g = item.group || "other";
      if (!buckets.has(g)) buckets.set(g, []);
      buckets.get(g).push(item);
    }
    const keys = [...order.filter((g) => buckets.has(g)), ...[...buckets.keys()].filter((g) => !order.includes(g))];
    for (const g of keys) {
      const sub = document.createElement("div");
      sub.className = "sub";
      const subHead = document.createElement("div");
      subHead.className = "sub-head";
      const h = document.createElement("h3");
      h.textContent = zhMap[g] || g;
      subHead.append(h);
      if (sec.id !== "quality") subHead.append(closeAllBtn(zhMap[g] || g));
      const box = document.createElement("div");
      box.className = "tags";
      const sorted = sortItems(buckets.get(g));
      const { roots, children } = clusterItems(sorted, auto);
      for (const item of sortItems(roots)) {
        const kids = children.get(item.tag) || [];
        if (!kids.length) {
          box.append(makeTagBtn(item, sec, auto));
          continue;
        }
        const fam = document.createElement("div");
        fam.className = "family";
        fam.append(makeTagBtn(item, sec, auto));
        const nest = document.createElement("div");
        nest.className = "tags nested";
        for (const kid of kids) nest.append(makeTagBtn(kid, sec, auto));
        fam.append(nest);
        box.append(fam);
      }
      sub.append(subHead, box);
      body.append(sub);
    }
    frag.append(wrap);
  }
  root.replaceChildren(frag);
  syncVisibility(auto);
}

function tagButtons(tag) {
  return btnByTag.get(tag) || [];
}

function flashPin(tag) {
  if (reduceMotion()) return;
  for (const el of tagButtons(tag)) {
    el.classList.remove("is-pin-flash");
    requestAnimationFrame(() => {
      el.classList.add("is-pin-flash");
      window.setTimeout(() => el.classList.remove("is-pin-flash"), 560);
    });
  }
}

function afterPin() {
  saveStore();
  renderCats();
  renderTray();
  updateEraClash();
  syncCast();
  const auto = autoBannedFromPins(lex, pinned);
  for (const span of document.querySelectorAll(".pos span[data-tag]")) {
    if (span.dataset.locked === "1") continue;
    span.dataset.state = tagState(span.dataset.tag, pinned, userBanned, auto);
  }
}

function onTagClick(tag) {
  const next = cycleTag(lex, pinned, userBanned, tag);
  const becamePin = next.pinned.has(tag) && !pinned.has(tag);
  pinned = next.pinned;
  userBanned = next.userBanned;
  afterPin();
  if (becamePin) flashPin(tag);
}

function makeTagBtn(item, sec, auto) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tag";
  const zh = item.zh || labelOf(lex, item.tag);
  btn.textContent = zh;
  btn.dataset.tag = item.tag;
  btn.dataset.en = item.tag;
  btn.title = item.tag;
  btn.setAttribute("aria-label", `${zh} (${item.tag})`);
  if (sec.id === "quality") {
    btn.dataset.state = "pinned";
    btn.dataset.locked = "1";
    btn.disabled = true;
    rememberBtn(item.tag, btn);
    return btn;
  }
  applyTagState(btn, item, auto, sec.id);
  rememberBtn(item.tag, btn);
  return btn;
}

function reduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function pop(el) {
  if (!el || reduceMotion()) return;
  el.animate(
    [
      { transform: "scale(0.97)", opacity: 0.92 },
      { transform: "scale(1)", opacity: 1 },
    ],
    { duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
  );
}

function cardSkeleton(width, height) {
  const el = document.createElement("article");
  el.className = "card is-wait";
  el.style.setProperty("--shot-w", String(width || 1024));
  el.style.setProperty("--shot-h", String(height || 1024));
  el.innerHTML = `<div class="shot"><div class="skel" aria-hidden="true"></div><img class="shot-img" alt="" width="${width || 1024}" height="${height || 1024}"><div class="meter" hidden><i></i><span></span></div></div><div class="meta"><div class="bar">排隊中…</div><div class="pos"></div></div>`;
  return el;
}

function setPosLine(el, positive) {
  const pos = el.querySelector(".pos");
  if (!pos) return;
  pos.replaceChildren();
  const auto = autoBannedFromPins(lex, pinned);
  for (const tag of String(positive || "").split(", ")) {
    if (!tag) continue;
    const span = document.createElement("span");
    span.dataset.en = tag;
    span.dataset.tag = tag;
    span.title = isFixedTag(tag) ? tag : "點一下：釘選／關掉／回到池中";
    span.textContent = labelOf(lex, tag);
    if (isFixedTag(tag)) span.dataset.locked = "1";
    else span.dataset.state = tagState(tag, pinned, userBanned, auto);
    pos.append(span, document.createTextNode(" · "));
  }
  if (pos.lastChild) pos.lastChild.remove();
}

function hideMeter(el) {
  const meter = el.querySelector(".meter");
  if (meter) meter.remove();
}

function setLive(el, ev) {
  if (el.classList.contains("is-done") || el.classList.contains("is-fail")) return;
  const bar = el.querySelector(".bar");
  const meter = el.querySelector(".meter");
  const fill = meter && meter.querySelector("i");
  const label = meter && meter.querySelector("span");
  const img = el.querySelector(".shot-img");
  const skel = el.querySelector(".skel");
  if (ev.status && bar) bar.textContent = ev.status;
  if (ev.max && meter && fill && label) {
    meter.hidden = false;
    const p = Math.max(0, Math.min(1, Number(ev.value || 0) / Number(ev.max)));
    fill.style.transform = `scaleX(${p})`;
    label.textContent = `${ev.value} / ${ev.max}`;
  }
  if (ev.image && img) {
    img.src = ev.image;
    img.classList.add("is-on");
    if (skel) skel.classList.add("is-behind");
  }
}

function failCard(el, err) {
  el.classList.remove("is-wait", "is-done");
  el.classList.add("is-fail");
  hideMeter(el);
  const skel = el.querySelector(".skel");
  if (skel) skel.remove();
  const bar = el.querySelector(".bar");
  if (!bar) return;
  const bits = [err];
  if (el.dataset.seed) bits.push("seed " + el.dataset.seed);
  if (el.dataset.era && ERA_LABELS[el.dataset.era]) bits.push(ERA_LABELS[el.dataset.era]);
  const label = document.createElement("span");
  label.textContent = bits.join(" · ");
  bar.replaceChildren(label);
  if (el.dataset.positive) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost copy";
    btn.textContent = "複製 POS";
    btn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(el.dataset.positive);
      speak("已複製 POS");
      btn.textContent = "已複製";
      setTimeout(() => {
        btn.textContent = "複製 POS";
      }, 1200);
    });
    bar.append(btn);
  }
}

function fillCard(el, job, err) {
  el.classList.remove("is-wait");
  if (err) {
    failCard(el, err);
    return;
  }
  el.classList.add("is-done");
  hideMeter(el);
  const img = el.querySelector(".shot-img");
  const skel = el.querySelector(".skel");
  if (img && job.image) {
    img.alt = "";
    if (job.width && job.height) {
      el.style.setProperty("--shot-w", String(job.width));
      el.style.setProperty("--shot-h", String(job.height));
      img.width = job.width;
      img.height = job.height;
    }
    img.addEventListener(
      "error",
      () => {
        if (el.classList.contains("is-fail") || el.classList.contains("is-img-fail")) return;
        el.classList.add("is-img-fail");
        const meta = el.querySelector(".meta");
        if (meta && !meta.querySelector(".img-fail")) {
          const note = document.createElement("p");
          note.className = "warn img-fail";
          note.textContent = "圖片載入失敗，Comfy 可能已關閉或輸出被清掉。POS 仍在下面。";
          meta.append(note);
        }
      },
      { once: true }
    );
    img.src = job.image;
    img.classList.add("is-on");
    if (!String(job.image).startsWith("data:")) {
      try {
        const fn = new URL(job.image, location.href).searchParams.get("filename");
        if (fn) img.alt = fn;
      } catch {
        /* ignore */
      }
    }
  }
  if (skel) skel.remove();
  let meta = el.querySelector(".meta");
  if (!meta) {
    meta = document.createElement("div");
    meta.className = "meta";
    el.append(meta);
  }
  const bar = document.createElement("div");
  bar.className = "bar";
  bar.innerHTML = `<span>seed ${job.seed}${job.era ? " · " + (ERA_LABELS[job.era] || job.era) : ""}</span><button type="button" class="ghost copy">複製 POS</button>`;
  setPosLine(el, job.positive);
  const pos = el.querySelector(".pos");
  bar.querySelector(".copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(job.positive);
    speak("已複製 POS");
    const btn = bar.querySelector(".copy");
    btn.textContent = "已複製";
    setTimeout(() => {
      btn.textContent = "複製 POS";
    }, 1200);
  });
  meta.replaceChildren(bar, pos || document.createElement("div"));
  if (job.missing && job.missing.length) {
    const warn = document.createElement("p");
    warn.className = "warn";
    warn.textContent =
      "釘選未入：" + job.missing.map((t) => labelOf(lex, t)).join("、");
    meta.append(warn);
  }
  if (job.eraClash && job.eraClash.length) {
    const warn = document.createElement("p");
    warn.className = "warn";
    warn.textContent =
      "釘選年代不同：" +
      job.eraClash.map((t) => labelOf(lex, t)).join("、") +
      "（這張仍是" +
      (ERA_LABELS[job.era] || job.era) +
      "）";
    meta.append(warn);
  }
}

async function streamGen(body, onEvent, signal) {
  const res = await fetch("/api/gen", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal,
  });
  const ctype = res.headers.get("content-type") || "";
  if (!ctype.includes("event-stream")) {
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || "gen failed");
    onEvent("done", j);
    return;
  }
  if (!res.body) throw new Error("no stream");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    buf = buf.replace(/\r\n/g, "\n");
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      const dataLines = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      const data = JSON.parse(dataLines.join(""));
      onEvent(event, data);
      if (event === "done" || event === "error") return;
    }
  }
}

async function runBatch() {
  if (running) return;
  running = true;
  aborting = false;
  genAbort = new AbortController();
  $("go").disabled = true;
  $("go").setAttribute("aria-busy", "true");
  $("cancel").hidden = false;
  pop($("go"));
  const n = Math.max(1, Math.min(10, Number($("n").value) || 1));
  settings.n = n;
  saveStore();

  const pingNow = await fetch("/api/ping").then((r) => r.json()).catch(() => ({ ok: false }));
  if (!pingNow.ok) {
    speak("ComfyUI 連不上，先開本機 8188");
    running = false;
    $("go").disabled = false;
    $("go").removeAttribute("aria-busy");
    $("cancel").hidden = true;
    return;
  }

  $("results").replaceChildren();
  $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  const cards = [];
  for (let i = 0; i < n; i++) {
    const c = cardSkeleton(settings.width, settings.height);
    c.style.animationDelay = `${i * 50}ms`;
    cards.push(c);
    $("results").append(c);
  }

  let ident = new Set();
  for (let i = 0; i < n; i++) {
    if (aborting) {
      speak("已取消");
      for (let j = i; j < cards.length; j++) failCard(cards[j], "已取消");
      break;
    }
    speak(`生圖 ${i + 1}/${n}`);
    const seedNum = randomSeed();
    const rng = mulberry32(seedNum);
    const pinForDraw =
      settings.samePerson && ident.size ? new Set([...pinned, ...ident]) : pinned;
    const drawn = drawOne(lex, settings, pinForDraw, userBanned, rng, seedNum);
    if (settings.samePerson && ident.size === 0) ident = identityPins(lex, drawn.positive);
    const card = cards[i];
    card.dataset.seed = String(drawn.seed);
    card.dataset.era = drawn.era || "";
    card.dataset.positive = drawn.positive;
    showPos(drawn.positive);
    setPosLine(card, drawn.positive);
    setLive(card, { status: `抽好了，生圖 ${i + 1}/${n}…` });
    const extra = {
      positive: drawn.positive,
      era: drawn.era,
      missing: missingPins(drawn.positive, pinned),
      eraClash: drawn.eraClash,
    };
    try {
      let finished = false;
      await streamGen(
        {
          positive: drawn.positive,
          width: settings.width,
          height: settings.height,
          seed: seedNum,
        },
        (event, data) => {
          if (event === "queued") {
            setLive(card, { status: `排隊中 · seed ${data.seed || seedNum}` });
          } else if (event === "progress") {
            const max = data.max || 25;
            const value = data.value || 0;
            setLive(card, {
              status: `繪製 ${value}/${max}`,
              value,
              max,
            });
            speak(`生圖 ${i + 1}/${n} · ${value}/${max}`);
          } else if (event === "preview") {
            setLive(card, { image: data.image, status: "預覽…" });
          } else if (event === "done") {
            finished = true;
            fillCard(card, { ...data, ...extra });
          } else if (event === "error") {
            finished = true;
            failCard(card, String(data.error || "Comfy 報錯"));
          }
        },
        genAbort.signal
      );
      if (!finished) throw new Error("生圖中斷");
    } catch (err) {
      if (aborting || err.name === "AbortError") failCard(card, "已取消");
      else failCard(card, String(err.message || err));
    }
  }

  running = false;
  $("go").disabled = false;
  $("go").removeAttribute("aria-busy");
  $("cancel").hidden = true;
  if (!aborting) speak(`完成 ${n} 張`);
}

function bindUi() {
  $("cats").addEventListener("click", (e) => {
    const closer = e.target.closest("[data-close]");
    if (closer) {
      const scope = closer.closest(".sub") || closer.closest(".cat");
      const tags = [];
      if (scope) {
        for (const btn of scope.querySelectorAll(".tag[data-tag]")) {
          if (!btn.hidden && btn.dataset.locked !== "1") tags.push(btn.dataset.tag);
        }
      }
      toggleBanTags(tags);
      return;
    }
    const tagBtn = e.target.closest(".tag[data-tag]");
    if (tagBtn && !tagBtn.disabled && tagBtn.dataset.locked !== "1") {
      onTagClick(tagBtn.dataset.tag);
      return;
    }
    const toggle = e.target.closest(".cat-toggle");
    if (toggle) {
      const cat = toggle.closest(".cat");
      const opened = !cat.classList.contains("is-open");
      applyCatOpen(cat, opened);
      if (opened) userOpen.add(cat.id);
      else userOpen.delete(cat.id);
    }
  });
  const trayPins = $("tray-pins");
  if (trayPins) {
    trayPins.addEventListener("click", (e) => {
      const btn = e.target.closest(".tag[data-tag]");
      if (!btn || btn.disabled || btn.dataset.locked === "1") return;
      onTagClick(btn.dataset.tag);
    });
  }
  $("results").addEventListener("click", (e) => {
    const span = e.target.closest(".pos span[data-tag]");
    if (!span || span.dataset.locked === "1") return;
    onTagClick(span.dataset.tag);
  });
  $("n").addEventListener("change", () => {
    settings.n = Math.max(1, Math.min(10, Number($("n").value) || 1));
    saveStore();
  });
  const sameBtn = $("same-person");
  if (sameBtn) {
    sameBtn.addEventListener("click", () => {
      settings.samePerson = !settings.samePerson;
      syncSamePerson();
      saveStore();
    });
  }
  for (const nav of document.querySelectorAll(".jump")) {
    nav.addEventListener("click", (e) => {
      const a = e.target.closest("a[href^='#sec-']");
      if (!a) return;
      e.preventDefault();
      const wrap = document.getElementById(a.hash.slice(1));
      if (!wrap || !wrap.classList.contains("cat")) return;
      userOpen.add(wrap.id);
      applyCatOpen(wrap, true);
      if (location.hash !== a.hash) location.hash = a.hash;
      else wrap.scrollIntoView({ block: "start" });
    });
  }
  $("girl").addEventListener("click", () => {
    settings.girl = true;
    settings.boy = false;
    saveStore();
    syncCast();
    renderCats("filter");
  });
  $("boy").addEventListener("click", () => {
    settings.girl = false;
    settings.boy = true;
    saveStore();
    syncCast();
    renderCats("filter");
  });
  $("cast-any").addEventListener("click", () => {
    settings.girl = true;
    settings.boy = true;
    saveStore();
    syncCast();
    renderCats("filter");
  });
  $("sizes").addEventListener("click", (e) => {
    const btn = e.target.closest(".seg");
    if (!btn) return;
    settings.width = Number(btn.dataset.w);
    settings.height = Number(btn.dataset.h);
    syncSizeButtons();
    saveStore();
  });
  for (const id of ["width", "height"]) {
    $(id).addEventListener("change", () => {
      settings.width = Math.max(256, Math.min(2048, Number($("width").value) || 1024));
      settings.height = Math.max(256, Math.min(2048, Number($("height").value) || 1024));
      syncSizeButtons();
      saveStore();
    });
  }
  $("presets").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-preset]");
    if (btn) applyPreset(btn.dataset.preset);
  });
  $("heats").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-heat]");
    if (btn) toggleHeat(btn.dataset.heat);
  });
  let searchTimer = 0;
  window.addEventListener("hashchange", () => {
    const wrap = location.hash ? document.getElementById(location.hash.slice(1)) : null;
    if (!wrap || !wrap.classList.contains("cat")) return;
    userOpen.add(wrap.id);
    applyCatOpen(wrap, true);
  });
  $("q").addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => renderCats("search"), 120);
  });
  $("q").addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("q").value) return;
    $("q").value = "";
    renderCats("search");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
    e.preventDefault();
    $("q").focus();
  });
  $("view-filters").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (btn) {
      viewMode = btn.dataset.view;
      renderCats("search");
      return;
    }
    if (e.target.closest("#era-only")) {
      eraOnly = !eraOnly;
      renderCats("search");
    }
  });
  $("clear-pins").addEventListener("click", () => {
    pinned = new Set();
    userBanned = new Set();
    afterPin();
  });
  $("go").addEventListener("click", runBatch);
  $("cancel").addEventListener("click", async () => {
    aborting = true;
    speak("取消中…");
    try {
      genAbort?.abort();
    } catch {
      /* ignore */
    }
    try {
      await fetch("/api/interrupt", { method: "POST", body: "{}" });
    } catch {
      /* ignore */
    }
  });
}

async function main() {
  let data;
  try {
    const r = await fetch("lexicon.json");
    if (!r.ok) throw new Error("lexicon.json HTTP " + r.status);
    data = await r.json();
    if (!data || !Array.isArray(data.tags)) throw new Error("lexicon.json 格式不對");
  } catch (err) {
    const stage = $("cats") || document.body;
    const p = document.createElement("p");
    p.className = "boot-error";
    p.setAttribute("role", "alert");
    p.textContent = "詞庫載入失敗：" + (err && err.message ? err.message : String(err));
    stage.prepend(p);
    return;
  }
  lex = indexLexicon(data);
  settings = defaultSettings(data);
  const saved = loadStore();
  if (saved.settings) settings = sanitizeSettings(saved.settings, data);
  if (Array.isArray(saved.pinned)) pinned = new Set(saved.pinned.filter((t) => typeof t === "string"));
  if (Array.isArray(saved.userBanned)) userBanned = new Set(saved.userBanned.filter((t) => typeof t === "string"));

  $("n").value = String(settings.n);
  syncSamePerson();
  syncCast();
  renderCounts();
  syncSizeButtons();
  syncHeat();
  renderEras();
  renderCats();
  renderTray();
  bindUi();
  ping();
  setInterval(ping, 15000);
}

main();
