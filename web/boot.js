import {
  applyBan,
  applyClear,
  applyPin,
  autoBannedFromPins,
  cycleTag,
  defaultSettings,
  drawOne,
  ERAS,
  ERA_LABELS,
  eraMismatches,
  indexLexicon,
  labelOf,
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
    renderCats("full");
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
      renderCats("full");
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
  renderCats();
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
  renderCats();
}

function tagsBanned(tags) {
  return tags.length > 0 && tags.every((t) => userBanned.has(t));
}

function toggleBanTags(tags) {
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

function closeAllBtn(tags, label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ghost mini";
  const closed = tagsBanned(tags);
  btn.textContent = closed ? "開啟全部" : "關閉全部";
  btn.setAttribute("aria-label", `${btn.textContent}：${label}`);
  btn.addEventListener("click", () => toggleBanTags(tags));
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
    if (ex === "female" && (it.gate === "male" || (it.needs || []).includes("male") || t.includes("boy"))) {
      clash.push(t);
    }
    if (ex === "male" && (it.gate === "female" || (it.needs || []).includes("female") || t.includes("girl"))) {
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

function renderTray() {
  const tray = $("tray");
  const box = $("tray-pins");
  const count = $("tray-count");
  if (!tray || !box) return;
  box.replaceChildren();
  tray.classList.toggle("is-on", pinned.size > 0);
  tray.hidden = false;
  if (!pinned.size) {
    if (count) count.textContent = "";
    return;
  }
  if (count) count.textContent = `${pinned.size} 個`;
  const frag = document.createDocumentFragment();
  for (const tag of pinned) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tag";
    btn.dataset.state = "pinned";
    btn.dataset.tag = tag;
    btn.dataset.en = tag;
    btn.textContent = labelOf(lex, tag);
    btn.title = "點一下取消釘選";
    frag.append(btn);
  }
  box.append(frag);
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

function visibleItems(sec, auto, q) {
  const items = sectionItems(sec);
  return items.filter((it) => {
    if (sec.id !== "quality") {
      const st = tagState(it.tag, pinned, userBanned, auto);
      if (viewMode === "pinned" && st !== "pinned") return false;
      if (viewMode === "banned" && st !== "banned") return false;
      if (eraOnly && exclusiveEra() && !fitsEra(it) && st !== "pinned") return false;
      if (!fitsCast(it) && st !== "pinned") return false;
    }
    if (!q) return true;
    const zh = (it.zh || labelOf(lex, it.tag) || "").toLowerCase();
    return it.tag.toLowerCase().includes(q) || zh.includes(q);
  });
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

function applyTagState(btn, item, auto, secId) {
  if (secId === "quality" || btn.dataset.locked === "1") return;
  const st = tagState(item.tag, pinned, userBanned, auto);
  const zh = item.zh || labelOf(lex, item.tag);
  btn.dataset.state = st;
  if (st === "banned") {
    const mutexBan = auto.has(item.tag) && !userBanned.has(item.tag);
    btn.dataset.ban = mutexBan ? "mutex" : "user";
    btn.setAttribute("aria-label", `${zh} (${item.tag}) ${mutexBan ? "與釘選互斥" : "已關閉"}`);
  } else {
    delete btn.dataset.ban;
    btn.setAttribute("aria-label", `${zh} (${item.tag})`);
  }
  if (!fitsEra(item) && st !== "pinned") btn.dataset.offEra = "1";
  else delete btn.dataset.offEra;
  if (!fitsCast(item) && st !== "pinned") btn.dataset.offCast = "1";
  else delete btn.dataset.offCast;
  if (secId !== "subject" && !fitsHeat(item) && st === "pool") btn.dataset.offHeat = "1";
  else delete btn.dataset.offHeat;
}

function paintCats() {
  const root = $("cats");
  if (!root || !root.querySelector(".cat")) {
    buildCats();
    return;
  }
  const auto = autoBannedFromPins(lex, pinned);
  const q = ($("q").value || "").trim().toLowerCase();
  for (const wrap of root.querySelectorAll(".cat")) {
    const sec = SECTIONS.find((s) => wrap.id === "sec-" + s.id);
    if (!sec) continue;
    const vis = visibleItems(sec, auto, q);
    const hint = wrap.querySelector(".cat-actions > span");
    if (hint) hint.textContent = hintFor(sec, vis);
    const closer = wrap.querySelector(":scope > header .ghost.mini");
    if (closer) {
      const closed = tagsBanned(vis.map((it) => it.tag));
      closer.textContent = closed ? "開啟全部" : "關閉全部";
    }
    for (const btn of wrap.querySelectorAll(".tag[data-tag]")) {
      const item = lex.byTag.get(btn.dataset.tag);
      if (item) applyTagState(btn, item, auto, sec.id);
    }
  }
  syncViewFilters();
}

function renderCats(mode = "auto") {
  const full = mode === "full" || viewMode !== "all" || !$("cats")?.querySelector(".cat");
  if (full) buildCats();
  else paintCats();
}

function buildCats() {
  const q = ($("q").value || "").trim().toLowerCase();
  const auto = autoBannedFromPins(lex, pinned);
  const root = $("cats");
  const open = new Set(
    [...root.querySelectorAll(".cat.is-open")].map((el) => el.id)
  );
  const frag = document.createDocumentFragment();
  syncViewFilters();

  for (const sec of SECTIONS) {
    const wrap = document.createElement("section");
    wrap.className = "cat" + (sec.id === "quality" ? " quality" : "");
    wrap.id = "sec-" + sec.id;
    const head = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = sec.title;
    const hint = document.createElement("span");
    const vis = visibleItems(sec, auto, q);
    hint.textContent = hintFor(sec, vis);
    const actions = document.createElement("div");
    actions.className = "cat-actions";
    actions.append(hint);
    if (sec.id !== "quality") {
      actions.append(closeAllBtn(vis.map((it) => it.tag), sec.title));
    }
    head.append(title, actions);
    wrap.append(head);
    const body = document.createElement("div");
    body.className = "cat-body";
    wrap.append(body);
    if (sec.id === "quality" || open.has(wrap.id)) wrap.classList.add("is-open");
    const order = (lex.data.groupOrder && lex.data.groupOrder[sec.id]) || ["other"];
    const zhMap = lex.data.groupZh || {};
    const buckets = new Map();
    for (const item of vis) {
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
      if (sec.id !== "quality") {
        subHead.append(closeAllBtn(buckets.get(g).map((it) => it.tag), zhMap[g] || g));
      }
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
    if (!body.querySelector(".sub") && sec.id !== "quality") {
      if (q) {
        const empty = document.createElement("p");
        empty.className = "hint";
        empty.textContent = "這段沒有符合的字。";
        body.append(empty);
        frag.append(wrap);
      }
      continue;
    }
    if (body.querySelector(".sub") || sec.id === "quality") frag.append(wrap);
  }
  root.replaceChildren(frag);
  if (!root.children.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = q ? "沒有符合的字。" : "這個篩選下沒有 tag。";
    root.append(empty);
  }
}

function tagButtons(tag) {
  return [...document.querySelectorAll("#cats .tag, #tray .tag")].filter((el) => el.dataset.tag === tag);
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
    return btn;
  }
  applyTagState(btn, item, auto, sec.id);
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
  for (const tag of String(positive || "").split(", ")) {
    if (!tag) continue;
    const span = document.createElement("span");
    span.dataset.en = tag;
    span.title = tag;
    span.textContent = labelOf(lex, tag);
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

function fillCard(el, job, err) {
  el.classList.remove("is-wait");
  if (err) {
    el.classList.add("is-fail");
    hideMeter(el);
    const bar = el.querySelector(".bar");
    if (bar) bar.textContent = "失敗";
    const pos = el.querySelector(".pos");
    if (pos) pos.textContent = err;
    const skel = el.querySelector(".skel");
    if (skel) skel.remove();
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
    img.src = job.image;
    img.classList.add("is-on");
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

  for (let i = 0; i < n; i++) {
    if (aborting) {
      speak("已取消");
      for (let j = i; j < cards.length; j++) fillCard(cards[j], null, "已取消");
      break;
    }
    speak(`生圖 ${i + 1}/${n}`);
    const seedNum = randomSeed();
    const rng = mulberry32(seedNum);
    const drawn = drawOne(lex, settings, pinned, userBanned, rng, seedNum);
    const card = cards[i];
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
            fillCard(card, null, String(data.error || "gen failed"));
          }
        },
        genAbort.signal
      );
      if (!finished) throw new Error("生圖中斷");
    } catch (err) {
      if (aborting || err.name === "AbortError") fillCard(card, null, "已取消");
      else fillCard(card, null, String(err.message || err));
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
    const tagBtn = e.target.closest(".tag[data-tag]");
    if (tagBtn && !tagBtn.disabled && tagBtn.dataset.locked !== "1") {
      onTagClick(tagBtn.dataset.tag);
      return;
    }
    const head = e.target.closest(".cat > header");
    if (head && !e.target.closest("button")) {
      head.parentElement.classList.toggle("is-open");
    }
  });
  const trayPins = $("tray-pins");
  if (trayPins) {
    trayPins.addEventListener("click", (e) => {
      const btn = e.target.closest(".tag[data-tag]");
      if (!btn) return;
      const next = applyClear(pinned, userBanned, btn.dataset.tag);
      pinned = next.pinned;
      userBanned = next.userBanned;
      afterPin();
    });
  }
  $("n").addEventListener("change", () => {
    settings.n = Math.max(1, Math.min(10, Number($("n").value) || 1));
    saveStore();
  });
  $("girl").addEventListener("click", () => {
    settings.girl = true;
    settings.boy = false;
    saveStore();
    syncCast();
    renderCats("full");
  });
  $("boy").addEventListener("click", () => {
    settings.girl = false;
    settings.boy = true;
    saveStore();
    syncCast();
    renderCats("full");
  });
  $("cast-any").addEventListener("click", () => {
    settings.girl = true;
    settings.boy = true;
    saveStore();
    syncCast();
    renderCats("full");
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
  $("q").addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => renderCats("full"), 120);
  });
  $("view-filters").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (btn) {
      viewMode = btn.dataset.view;
      renderCats("full");
      return;
    }
    if (e.target.closest("#era-only")) {
      eraOnly = !eraOnly;
      renderCats("full");
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
  const data = await fetch("lexicon.json").then((r) => r.json());
  lex = indexLexicon(data);
  settings = defaultSettings(data);
  const saved = loadStore();
  if (saved.settings) {
    settings = { ...settings, ...saved.settings, counts: { ...settings.counts, ...saved.settings.counts } };
  }
  if (saved.pinned) pinned = new Set(saved.pinned);
  if (saved.userBanned) userBanned = new Set(saved.userBanned);

  $("n").value = String(settings.n);
  if (!settings.girl && !settings.boy) {
    settings.girl = true;
    settings.boy = true;
  }
  syncCast();
  renderCounts();
  syncSizeButtons();
  syncHeat();
  renderEras();
  renderCats("full");
  renderTray();
  bindUi();
  ping();
  setInterval(ping, 15000);
  document.documentElement.classList.add("is-booted");
}

main();
