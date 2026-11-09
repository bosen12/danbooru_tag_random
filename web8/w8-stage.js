/**
 * 舞台：畫布（選中的那張，印製中看它顯影）、底片（這次印的每一張）、生圖鈕。
 * 同一張圖進度更新只改進度和預覽，不重建節點（不閃）；換一張或狀態變了才重畫，印好時用墨暈開出來。
 */
import { viewSrc } from "./gen.js";
import { h, $, icon, sheet, reduced } from "./w8-dom.js";

const FAN_MAX = 7;
const STATUS_ZH = { drawn: "只抽了牌", queued: "排隊中", running: "印製中", done: "印好了", failed: "印壞了", cancelled: "取消了" };

export function mountStage(app) {
  const canvas = $("#canvas");
  const strip = $("#strip");
  const nOut = $("#cap-n");
  const drawBtn = $("#cap-draw");
  const genBtn = $("#cap-gen");
  const queueBox = $("#cap-queue");
  let shown = { id: null, mode: null };
  // 每張最後一格預覽：印好時墊在成品下面，顯影才是連續的（gen.js 印好就把 shot.preview 清掉）。
  const lastPreview = new Map();

  const artOf = (tag) => app.cardArt(tag);

  /** 一把扇開的牌（這張抽到的牌，有卡面的先）。 */
  function fan(shot, cls = "") {
    const cards = (shot.cards || []).filter((c) => c.isCard && artOf(c.tag)).slice(0, FAN_MAX);
    const n = cards.length;
    return h(
      "div",
      { class: "fan " + cls, style: { "--n": n } },
      cards.map((c, i) => h("img", { class: "fan-card", src: artOf(c.tag), alt: "", style: { "--i": i - (n - 1) / 2 }, draggable: "false" }))
    );
  }

  function modeOf(s) {
    if (!s) return "empty";
    if (s.status === "running" && s.preview) return "preview";
    return s.status;
  }

  function hero() {
    return h(
      "div",
      { class: "hero" },
      h("div", { class: "hero-ink", "aria-hidden": "true" }),
      h("h1", { class: "hero-title" }, "墨池"),
      h("p", { class: "hero-sub" }, app.core.pins.length ? "配方好了。按「生圖」，看它在這裡顯影。" : "從字盒挑幾張牌放進配方，再按「生圖」。"),
      h(
        "div",
        { class: "hero-keys" },
        h("span", {}, h("kbd", {}, "/"), " 找牌"),
        h("span", {}, h("kbd", {}, "D"), " 只抽牌"),
        h("span", {}, h("kbd", {}, "Ctrl"), h("kbd", {}, "Enter"), " 生圖")
      )
    );
  }

  function meta(s) {
    return h(
      "div",
      { class: "cv-meta" },
      h("span", { class: "cv-status", dataset: { status: s.status } }, STATUS_ZH[s.status] || s.status),
      s.eraLabel ? h("span", {}, s.eraLabel) : null,
      h("span", {}, `${s.width}×${s.height}`),
      h("span", { class: "mono" }, "seed " + s.seed)
    );
  }

  function progressBar(s) {
    return h("div", { class: "cv-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round((s.progress || 0) * 100)) }, h("i", { style: { "--p": s.progress || 0 } }));
  }

  function build(s, mode, wasRunning) {
    if (mode === "empty") return hero();
    const ratio = `${s.width} / ${s.height}`;
    if (mode === "done") {
      const reveal = wasRunning && !reduced();
      const img = h("img", { class: "cv-img" + (reveal ? " is-reveal" : ""), src: viewSrc(s.image), alt: "成品", style: { aspectRatio: ratio }, onclick: () => openLightbox(s) });
      const under = reveal && lastPreview.get(s.id) ? h("img", { class: "cv-under", src: lastPreview.get(s.id), alt: "", "aria-hidden": "true" }) : null;
      lastPreview.delete(s.id);
      return h(
        "div",
        { class: "cv cv-done" },
        h("div", { class: "cv-frame" }, under, img),
        h(
          "div",
          { class: "cv-bar" },
          meta(s),
          h(
            "div",
            { class: "cv-actions" },
            h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => app.act.reprint(s) }, icon("redo", 15), "再印一張"),
            h("a", { class: "btn btn-ghost btn-sm", href: s.image, target: "_blank", rel: "noopener" }, icon("open", 15), "開原圖")
          )
        )
      );
    }
    if (mode === "preview") {
      return h(
        "div",
        { class: "cv cv-running" },
        h("div", { class: "cv-frame" }, h("img", { class: "cv-img cv-preview", src: s.preview, alt: "印製中的預覽", style: { aspectRatio: ratio, "--p": s.progress || 0 } })),
        h("div", { class: "cv-bar" }, meta(s), h("span", { class: "cv-note" }, s.note || ""), h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => app.act.cancel(s) }, icon("stop", 14), "停這張")),
        progressBar(s)
      );
    }
    const body = [];
    if (s.status === "drawn") {
      body.push(
        fan(s),
        h("p", { class: "cv-say" }, "只抽了牌，還沒送去印"),
        h("button", { class: "btn btn-primary", type: "button", onclick: () => app.act.print(s) }, "印這張")
      );
    } else if (s.status === "queued" || s.status === "running") {
      body.push(fan(s, "is-waiting"), h("p", { class: "cv-say" }, s.note || STATUS_ZH[s.status]), h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => app.act.cancel(s) }, icon("stop", 14), s.status === "queued" ? "不印了" : "停這張"));
    } else {
      body.push(
        fan(s, "is-dim"),
        h("p", { class: "cv-say is-bad" }, s.status === "failed" ? `印壞了${s.note ? "：" + s.note : ""}` : s.note || "取消了"),
        h(
          "div",
          { class: "cv-actions" },
          h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => app.act.print(s) }, "再試一次"),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => app.act.remove(s) }, "撤下")
        )
      );
    }
    return h("div", { class: "cv cv-" + s.status }, h("div", { class: "cv-stack" }, body), h("div", { class: "cv-bar" }, meta(s)), s.status === "running" ? progressBar(s) : null);
  }

  function renderCanvas() {
    const s = app.selected();
    const mode = modeOf(s);
    if (s && s.preview) lastPreview.set(s.id, s.preview);
    const id = s ? s.id : null;
    if (id === shown.id && mode === shown.mode) {
      // 同一張、同一種畫面：只更新進度、預覽、說明。
      if (!s) return;
      const bar = canvas.querySelector(".cv-progress i");
      if (bar) bar.style.setProperty("--p", s.progress || 0);
      canvas.querySelector(".cv-progress")?.setAttribute("aria-valuenow", String(Math.round((s.progress || 0) * 100)));
      const pv = canvas.querySelector(".cv-preview");
      if (pv) {
        if (pv.getAttribute("src") !== s.preview) pv.src = s.preview;
        pv.style.setProperty("--p", s.progress || 0);
      }
      const note = canvas.querySelector(".cv-note, .cv-say");
      if (note && s.note && (s.status === "running" || s.status === "queued")) note.textContent = s.note;
      return;
    }
    const wasRunning = shown.id === id && (shown.mode === "preview" || shown.mode === "running");
    shown = { id, mode };
    const node = build(s, mode, wasRunning);
    canvas.replaceChildren(node);
    if (!reduced() && !wasRunning) node.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.7,.2,1)" });
  }

  function thumb(s) {
    const sel = s.id === app.ui.selected;
    let face;
    if (s.status === "done" && s.image) face = h("img", { src: viewSrc(s.image), alt: "", loading: "lazy", draggable: "false" });
    else if (s.preview) face = h("img", { src: s.preview, alt: "", draggable: "false", class: "is-preview" });
    else {
      const first = (s.cards || []).find((c) => c.isCard && artOf(c.tag));
      face = first ? h("img", { src: artOf(first.tag), alt: "", draggable: "false", class: "is-card" }) : h("span", { class: "st-blank" });
    }
    return h(
      "button",
      {
        class: "st",
        type: "button",
        dataset: { id: s.id, status: s.status },
        aria: { current: sel ? "true" : "false" },
        "aria-label": `${STATUS_ZH[s.status] || s.status} · seed ${s.seed}`,
        onclick: () => app.act.select(s.id),
      },
      face,
      s.status === "running" ? h("span", { class: "st-progress", style: { "--p": s.progress || 0 } }) : null,
      s.status !== "done" ? h("span", { class: "st-dot", dataset: { status: s.status } }) : null
    );
  }

  function renderStrip() {
    const shots = app.shots;
    strip.hidden = !shots.length;
    const have = new Map([...strip.children].map((n) => [n.dataset.id, n]));
    const next = shots.map((s) => {
      const old = have.get(s.id);
      // 狀態沒變的照用（印製中只改進度條）。
      if (old && old.dataset.status === s.status && !(s.status === "running" && !!s.preview !== !!old.querySelector(".is-preview"))) {
        old.setAttribute("aria-current", s.id === app.ui.selected ? "true" : "false");
        old.querySelector(".st-progress")?.style.setProperty("--p", s.progress || 0);
        const pv = old.querySelector(".is-preview");
        if (pv && s.preview && pv.getAttribute("src") !== s.preview) pv.src = s.preview;
        return old;
      }
      return thumb(s);
    });
    strip.replaceChildren(...next);
    strip.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function renderCapsule() {
    nOut.textContent = app.ui.n;
    $("#cap-minus").disabled = app.ui.n <= 1;
    $("#cap-plus").disabled = app.ui.n >= 8;
    const busy = app.pending();
    queueBox.hidden = !busy;
    if (busy) queueBox.querySelector(".n").textContent = busy;
    genBtn.querySelector(".cap-gen-n").textContent = app.ui.n > 1 ? "×" + app.ui.n : "";
    const offline = app.link === "net";
    genBtn.title = offline ? "連不到主機" : app.link === "comfy" ? "ComfyUI 沒開：先排著，開了就接著印" : "抽並生圖（Ctrl＋Enter）";
  }

  function openLightbox(s) {
    sheet(h("figure", { class: "lightbox" }, h("img", { src: s.image, alt: "成品原圖" }), h("figcaption", { class: "muted" }, `${s.width}×${s.height} · seed ${s.seed}`)), { cls: "sheet-lightbox", label: "成品大圖" });
  }

  $("#cap-minus").addEventListener("click", () => app.act.setN(app.ui.n - 1));
  $("#cap-plus").addEventListener("click", () => app.act.setN(app.ui.n + 1));
  drawBtn.addEventListener("click", () => app.act.draw(false));
  genBtn.addEventListener("click", () => app.act.draw(true));
  queueBox.querySelector("button").addEventListener("click", () => app.act.stopAll());

  app.on("shots", () => {
    renderStrip();
    renderCanvas();
    renderCapsule();
  });
  app.on("select", () => {
    renderStrip();
    renderCanvas();
  });
  // 空的畫布那句說明跟著配方變。
  app.on("pool", () => {
    if (!app.selected()) {
      shown = { id: null, mode: null };
      renderCanvas();
    }
  });
  app.on("ui", renderCapsule);
  app.on("link", renderCapsule);
  renderStrip();
  renderCanvas();
  renderCapsule();
}
