/**
 * 作品冊：收藏的成品（album-save.js 從墨池、疊印台收進來；存在伺服器 recipes.py，圖另存一份）。
 *   - 大圖牆：照每張的長寬比排（album.css 的 columns），新的在前；超出頂端分級的先收起來。
 *   - 找作品：作品名、牌的中文名、提示詞。
 *   - 點一張：大圖、你選的牌、全部的牌、尺寸／種子／底模；把牌帶回墨池、複製 POS、開原圖、從作品冊拿掉。
 *   - 網址帶 #作品編號（收藏完按「打開作品冊」過來）：直接打開那一張。
 */
import { RATING_LABEL, ratingBlocked } from "./rules/rating.js";
import { buildLibrary, ERA_ZH } from "./cards.js";
import { el, openSheet, toast } from "./ui.js";
import { initMotion, settleMotion, seat, refuse, enter, leave, reducedMotion, CURVE, DUR, css } from "./motion.js";
import { watchLink, LINK_LABEL } from "./gen.js";
import { getSfx } from "./sfx.js";
import * as S from "./store.js";
import { tagsOfPositive } from "./usage.js";
import { removeFromAlbum } from "./album-save.js";

const sfx = getSfx();
const $ = (id) => document.getElementById(id);
const RANK = { general: 0, sensitive: 1, explicit: 2 };

let lib = null;
let works = [];
let rating = "general";
let query = "";

const zh = (t) => lib?.byTag.get(t)?.zh || t;
const fileUrl = (ref) => (ref && ref.file ? `/api/recipes/files/${encodeURIComponent(ref.file)}` : null);
const cardsOf = (w) => tagsOfPositive(w.positive || "").filter((t) => lib.byTag.has(t));
const mineOf = (w) => (Array.isArray(w.pinned) ? w.pinned : []).filter((t) => lib.byTag.has(t));

function dateText(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("zh-TW", { year: "numeric", month: "numeric", day: "numeric" });
}

/* ================= 開機 ================= */

async function boot() {
  initMotion();
  try {
    const data = await fetch(document.querySelector('link[rel="preload"][href^="lexicon.json"]')?.href || "lexicon.json").then((r) => r.json());
    lib = buildLibrary(data, { ratingBlocked });
  } catch (err) {
    $("album").replaceChildren(el("p", { class: "album-hint" }, "讀不到詞庫。請用 start-web6.bat 開，而不是直接點 HTML。", el("br"), String(err)));
    return;
  }
  rating = (S.loadSettings() || {}).rating || "general";
  renderRating();
  wireSearch();
  wireSound();
  pingLoop();
  await load();
  render({ deal: true });
  settleMotion();
  openFromHash();
  addEventListener("hashchange", openFromHash);
  // 別的分頁收了新的作品：回到這一頁時重新讀一次。
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) return;
    const before = works.map((w) => w.id).join();
    await load();
    if (works.map((w) => w.id).join() !== before) render();
  });
}

async function load() {
  try {
    const r = await fetch("/api/recipes", { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    works = (j.items || []).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    for (const w of works) {
      const cards = cardsOf(w);
      w._text = [w.name, w.positive, ...cards.map(zh)].join(" ").toLowerCase();
    }
  } catch {
    works = [];
    toast("讀不到作品冊：伺服器沒開，或連不到主機");
  }
}

/* ================= 頂欄 ================= */

function renderRating() {
  const box = $("rating");
  box.replaceChildren(
    ...["general", "sensitive", "explicit"].map((r) =>
      el(
        "button",
        {
          type: "button",
          role: "radio",
          "aria-checked": rating === r ? "true" : "false",
          dataset: { v: r },
          onclick: () => {
            if (rating === r) return;
            rating = r;
            // 跟墨池同一個尺度：這裡換了，回墨池也是這一檔。
            S.saveSettings({ ...(S.loadSettings() || {}), rating: r });
            renderRating();
            seat(box.querySelector('[aria-checked="true"]'));
            render();
          },
        },
        RATING_LABEL[r]
      )
    )
  );
}

function pingLoop() {
  watchLink((st) => {
    const p = $("ping");
    const changed = p.dataset.ok !== (st === "ok" ? "1" : "0") || p.dataset.link !== st;
    p.dataset.ok = st === "ok" ? "1" : "0";
    p.dataset.link = st;
    if (changed) p.querySelector("span").textContent = LINK_LABEL[st];
  });
}

function wireSound() {
  const snd = $("sound-btn");
  const sync = () => {
    snd.setAttribute("aria-pressed", sfx.on ? "true" : "false");
    const label = sfx.on ? "聲音：開（點一下關掉）" : "聲音：關（點一下打開）";
    snd.setAttribute("aria-label", label);
    snd.title = label;
    snd.innerHTML = sfx.on
      ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>`
      : `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9.5l5 5M22 9.5l-5 5"/></svg>`;
  };
  sync();
  snd.addEventListener("click", () => {
    sfx.on = !sfx.on;
    sync();
    if (sfx.on) sfx.deal(3);
  });
}

function wireSearch() {
  const q = $("album-q");
  let timer = 0;
  q.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      query = q.value.trim().toLowerCase();
      render();
    }, 140);
  });
  q.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && q.value) {
      q.value = "";
      query = "";
      render();
    }
  });
  addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && !document.querySelector(".overlay")) {
      e.preventDefault();
      q.focus();
    }
  });
}

/* ================= 大圖牆 ================= */

const visible = (w) => (RANK[w.rating] ?? 2) <= RANK[rating];

function render({ deal = false } = {}) {
  const grid = $("album-grid");
  const shown = works.filter((w) => visible(w) && (!query || w._text.includes(query)));
  const hidden = works.filter((w) => !visible(w)).length;
  $("album-hint").hidden = works.length > 0;
  $("album-sum").textContent = works.length
    ? `${shown.length} 件作品${hidden ? `・${hidden} 件在${RATING_LABEL[rating]}看不到` : ""}`
    : "";
  const tiles = shown.map(tile);
  const swap = () => grid.replaceChildren(...(tiles.length || !works.length ? tiles : [el("p", { class: "album-empty" }, query ? `找不到「${query}」` : `這一級分級看不到任何作品`)]));
  swap();
  if (deal && !reducedMotion()) {
    tiles.slice(0, 12).forEach((t, i) =>
      t.animate([{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], {
        duration: DUR.long,
        delay: DUR.micro + i * 40,
        easing: css(CURVE.out),
        fill: "backwards",
      })
    );
  }
}

function tile(w) {
  const src = fileUrl(w.thumbnail) || fileUrl(w.image);
  const ratio = w.width && w.height ? `${w.width} / ${w.height}` : "2 / 3";
  const born = performance.now();
  const img = src
    ? el("img", {
        src,
        alt: "",
        loading: "lazy",
        decoding: "async",
        onload: (e) => {
          // 晚到的圖淡進來；本來就在快取裡的直接出現（不閃一格空白）。
          if (performance.now() - born > 80 && !reducedMotion()) e.currentTarget.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DUR.medium, easing: css(CURVE.out) });
        },
      })
    : el("span", { class: "album-noimg" }, "沒有圖");
  const node = el(
    "button",
    { class: "album-tile pressable", type: "button", role: "listitem", dataset: { id: w.id }, "aria-label": `${w.name}，${dateText(w.createdAt)}` },
    el("span", { class: "album-frame", style: `aspect-ratio: ${ratio}` }, img),
    el("span", { class: "album-cap" }, el("b", {}, w.name), el("small", {}, dateText(w.createdAt)))
  );
  node.addEventListener("click", () => openWork(w));
  return node;
}

/* ================= 一張作品 ================= */

function openFromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) return;
  const w = works.find((x) => x.id === id);
  if (!w) return toast("這件作品不在作品冊裡了");
  if (!visible(w)) {
    rating = w.rating;
    S.saveSettings({ ...(S.loadSettings() || {}), rating });
    renderRating();
    render();
  }
  $("album-grid").querySelector(`.album-tile[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "center" });
  openWork(w);
}

function chips(tags, kind) {
  return el("div", { class: `album-chips is-${kind}` }, tags.map((t) => el("span", { class: "album-chip", title: t }, zh(t))));
}

function toMochi(tags, label) {
  S.handOffPool(tags, "album");
  toast(`${label}帶去墨池…`);
  setTimeout(() => (location.href = "./"), reducedMotion() ? 0 : DUR.short);
}

function openWork(w) {
  sfx.open?.();
  const full = fileUrl(w.image) || fileUrl(w.thumbnail);
  const mine = mineOf(w);
  const all = cardsOf(w);
  const rest = all.filter((t) => !mine.includes(t));
  const ckpt = String(w.checkpoint || "").split(/[\\/]/).pop().replace(/\.safetensors$/i, "");
  const facts = [
    ["尺寸", w.width && w.height ? `${w.width}×${w.height}` : "—"],
    ["種子", String(w.seed ?? "—")],
    ["分級", RATING_LABEL[w.rating] || w.rating],
    ["時代", ERA_ZH[w.era] || w.era || "—"],
    ["底模", ckpt || "—"],
    ["LoRA", (w.loras || []).filter(Boolean).map((x) => String(x).split(/[\\/]/).pop().replace(/\.safetensors$/i, "")).join("、") || "沒有"],
    ["收藏於", dateText(w.createdAt)],
  ];
  let sheet = null;
  const del = el("button", { class: "btn btn-small album-del", type: "button" }, "從作品冊拿掉");
  let armed = 0;
  del.addEventListener("click", async () => {
    // 拿掉會連另存的那份圖一起刪：按兩次才算，第一次先說清楚。
    if (!armed) {
      del.textContent = "再按一次：連存的圖一起刪";
      del.dataset.armed = "true";
      armed = setTimeout(() => {
        armed = 0;
        del.textContent = "從作品冊拿掉";
        delete del.dataset.armed;
      }, 3500);
      return;
    }
    clearTimeout(armed);
    del.disabled = true;
    try {
      await removeFromAlbum(w.id);
    } catch (err) {
      del.disabled = false;
      refuse(del);
      return toast(`拿不掉：${err.message}`);
    }
    sheet.close();
    works = works.filter((x) => x !== w);
    const node = $("album-grid").querySelector(`.album-tile[data-id="${CSS.escape(w.id)}"]`);
    leave(node, () => render());
    toast(`「${w.name}」拿出作品冊了`);
  });
  const body = el(
    "div",
    { class: "album-detail" },
    el(
      "a",
      { class: "album-big", href: full || "#", target: "_blank", rel: "noopener", style: w.width && w.height ? `aspect-ratio: ${w.width} / ${w.height}` : "" },
      full ? el("img", { src: full, alt: w.name }) : el("span", { class: "album-noimg" }, "沒有圖")
    ),
    el(
      "div",
      { class: "album-info" },
      el("dl", { class: "album-facts" }, facts.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])),
      mine.length ? el("section", {}, el("h3", {}, `你選的牌・${mine.length}`), chips(mine, "mine")) : null,
      rest.length ? el("section", {}, el("h3", {}, `${mine.length ? "引擎補的" : "這張用到的牌"}・${rest.length}`), chips(rest, "drawn")) : null,
      el("details", { class: "album-pos" }, el("summary", {}, "提示詞"), el("pre", { class: "pos-text" }, w.positive || ""))
    )
  );
  const s = openSheet(w.name, body, {
    wide: true,
    foot: [
      mine.length
        ? el("button", { class: "btn btn-small btn-primary", type: "button", onclick: () => toMochi(mine, `你選的 ${mine.length} 張`) }, "你選的牌帶回墨池")
        : null,
      all.length
        ? el("button", { class: `btn btn-small${mine.length ? "" : " btn-primary"}`, type: "button", onclick: () => toMochi(all, `全部 ${all.length} 張`) }, "全部的牌帶回墨池")
        : null,
      el(
        "button",
        {
          class: "btn btn-small",
          type: "button",
          onclick: async (e) => {
            const b = e.currentTarget;
            try {
              await navigator.clipboard.writeText(w.positive || "");
              b.textContent = "已複製";
              setTimeout(() => (b.textContent = "複製 POS"), 1400);
            } catch {
              refuse(b);
            }
          },
        },
        "複製 POS"
      ),
      del,
    ],
  });
  sheet = s;
  if (!reducedMotion()) {
    const img = body.querySelector(".album-big img");
    img?.animate([{ opacity: 0, transform: "scale(0.97)" }, { opacity: 1, transform: "none" }], { duration: DUR.long, easing: css(CURVE.out) });
    [...body.querySelectorAll(".album-chip")].slice(0, 30).forEach((c, i) => enter(c, { delay: DUR.short + i * 14 }));
  }
  // 關掉時把 #編號 拿掉：重新整理不會又自己打開。
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

boot();
