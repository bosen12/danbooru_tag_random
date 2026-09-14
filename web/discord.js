// 送到 Discord 頻道。和 telegram.js 同一套形狀：桅杆列一顆按鈕、一個面板、
// 填 bot token 與頻道 ID，成圖排進伺服器的背景佇列。
//
// token 只走伺服器：POST 上去存進 .secrets/discord.json，GET 回來只有末四碼。
// 送圖是 fire-and-forget —— 伺服器收下就回，實際上傳在它的背景執行緒，抽圖不等它。
//
// 樣式沿用 telegram.js 那一套 tg-* class（同樣的面板、同樣的開關），只有 id 是 dc-*，
// 這樣不用再寫一份 CSS，兩邊的外觀也一定一致。

const $ = (id) => document.getElementById(id);

let status = { configured: false, enabled: false, channelId: "", tokenTail: "" };
let poll = 0;

function reduceMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

async function getJson(url, init) {
  const r = await fetch(url, init);
  return r.json();
}

function mastTools() {
  return $("mast-tools");
}

const LOGO = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.27 5.33A16.2 16.2 0 0 0 15.23 4c-.2.35-.42.82-.58 1.2a15 15 0 0 0-4.3 0A11 11 0 0 0 9.76 4a16.2 16.2 0 0 0-4.04 1.33C3.16 9.15 2.46 12.87 2.8 16.54a16.3 16.3 0 0 0 5 2.54c.4-.55.76-1.14 1.07-1.76-.59-.22-1.15-.49-1.68-.8.14-.11.28-.22.41-.34 3.24 1.5 6.75 1.5 9.95 0 .14.12.28.23.42.34-.53.31-1.1.58-1.69.8.31.62.67 1.21 1.07 1.76a16.2 16.2 0 0 0 5-2.54c.4-4.26-.71-7.95-2.99-11.21ZM9.35 14.3c-.97 0-1.77-.9-1.77-2s.78-2 1.77-2 1.79.9 1.77 2c0 1.1-.78 2-1.77 2Zm5.3 0c-.97 0-1.77-.9-1.77-2s.78-2 1.77-2 1.79.9 1.77 2c0 1.1-.78 2-1.77 2Z"/></svg>`;

function ensureDom() {
  const tools = mastTools();
  if (!$("dc-btn") && tools) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost tg-btn dc-btn";
    btn.id = "dc-btn";
    btn.title = "設定：送到 Discord";
    btn.setAttribute("aria-label", "設定：送到 Discord");
    btn.innerHTML = `${LOGO}<span class="tg-dot" aria-hidden="true"></span>`;
    tools.insertBefore(btn, tools.firstChild);
  }
  if ($("dc-modal")) return;
  const wrap = document.createElement("div");
  wrap.className = "tg-modal";
  wrap.id = "dc-modal";
  wrap.innerHTML = `
    <div class="tg-inner" role="dialog" aria-modal="true" aria-labelledby="dc-title">
      <header class="tg-head">
        <div>
          <h2 id="dc-title">送到 Discord</h2>
          <p class="tg-state" id="dc-state">讀取中…</p>
        </div>
        <button type="button" class="ghost tg-close" id="dc-close" aria-label="關閉">✕</button>
      </header>
      <div class="tg-body">
        <label class="tg-field">
          <span>Bot token</span>
          <input id="dc-token" type="password" autocomplete="off" spellcheck="false" placeholder="MTA1…" />
          <em>Discord Developer Portal → 你的 application → Bot → Reset Token。存在伺服器的 <code>.secrets/discord.json</code>，不進 git、不會回傳瀏覽器。留空＝沿用已存的。</em>
        </label>
        <label class="tg-field">
          <span>頻道 ID</span>
          <input id="dc-channel" type="text" autocomplete="off" spellcheck="false" placeholder="1234567890123456789" />
          <em>在 Discord 開「開發者模式」後右鍵頻道 →「複製頻道 ID」。bot 要先邀進該伺服器，並且在那個頻道有<strong>發送訊息</strong>和<strong>附加檔案</strong>權限。</em>
        </label>
        <button type="button" class="same-switch tg-switch" id="dc-enabled" role="switch" aria-checked="false" aria-describedby="dc-enabled-hint">
          <span class="same-knob" aria-hidden="true"><i></i></span>
          <span class="same-copy">
            <strong>每張成圖自動送</strong>
            <em id="dc-enabled-hint">一般抽、無限抽都送。送失敗不會中斷抽圖</em>
          </span>
        </button>
        <div class="tg-actions">
          <button type="button" class="primary" id="dc-save"><span>存設定</span></button>
          <button type="button" class="ghost" id="dc-test">送一則測試</button>
        </div>
        <p class="tg-msg" id="dc-msg" role="status"></p>
        <dl class="tg-stats" id="dc-stats"></dl>
      </div>
    </div>`;
  document.body.append(wrap);
}

function paint() {
  const st = $("dc-state");
  if (st) {
    st.dataset.ok = status.configured ? "1" : "0";
    st.textContent = status.configured
      ? `已設定 · token ${status.tokenTail} · ${status.channelId || "沒填頻道 ID"}`
      : "尚未設定。填好下面兩格再按存設定。";
  }
  const dot = document.querySelector("#dc-btn .tg-dot");
  if (dot) dot.dataset.on = status.configured && status.enabled ? "1" : "0";
  const btn = $("dc-btn");
  if (btn) {
    btn.title =
      status.configured && status.enabled ? "送到 Discord：開著" : "設定：送到 Discord";
  }
  const sw = $("dc-enabled");
  if (sw) {
    sw.classList.toggle("is-on", !!status.enabled);
    sw.setAttribute("aria-checked", status.enabled ? "true" : "false");
  }
  const stats = $("dc-stats");
  if (stats) {
    const bits = [
      ["送出", String(status.sent || 0)],
      ["失敗", String(status.failed || 0)],
      ["排隊中", String(status.queued || 0)],
    ];
    stats.replaceChildren();
    for (const [k, v] of bits) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      stats.append(dt, dd);
    }
    if (status.lastError) {
      const dt = document.createElement("dt");
      dt.textContent = "最後錯誤";
      const dd = document.createElement("dd");
      dd.className = "tg-err";
      dd.textContent = status.lastError;
      stats.append(dt, dd);
    }
  }
}

async function refresh() {
  try {
    const j = await getJson("/api/discord/config");
    if (j && j.ok) status = j;
  } catch {
    /* 伺服器沒回就維持上一次的狀態，不吵 */
  }
  paint();
}

function say(text, kind) {
  const el = $("dc-msg");
  if (!el) return;
  el.textContent = text || "";
  el.dataset.kind = kind || "";
}

function isOpen() {
  const el = $("dc-modal");
  return !!(el && el.classList.contains("open") && el.dataset.closing !== "1");
}

function open() {
  const el = $("dc-modal");
  if (!el) return;
  delete el.dataset.closing;
  el.classList.remove("is-closing");
  el.classList.add("open");
  el.inert = false;
  document.body.style.overflow = "hidden";
  say("");
  const chan = $("dc-channel");
  refresh().then(() => {
    if (chan) chan.value = status.channelId || "";
    const token = $("dc-token");
    if (token) {
      token.value = "";
      token.placeholder = status.configured ? `已存 · ${status.tokenTail}` : "MTA1…";
    }
    (status.configured ? chan : $("dc-token"))?.focus();
  });
  window.clearInterval(poll);
  poll = window.setInterval(() => {
    if (isOpen()) refresh();
  }, 3000);
}

function close() {
  const el = $("dc-modal");
  if (!el || !isOpen()) return;
  window.clearInterval(poll);
  poll = 0;
  el.dataset.closing = "1";
  el.classList.add("is-closing");
  el.inert = true;
  const ms = reduceMotion() ? 0 : 180;
  window.setTimeout(() => {
    delete el.dataset.closing;
    el.classList.remove("open", "is-closing");
    if (!document.querySelector(".lora-modal.open, .shot-viewer.open, .tg-modal.open")) {
      document.body.style.overflow = "";
    }
    $("dc-btn")?.focus();
  }, ms);
}

async function save() {
  const btn = $("dc-save");
  if (btn) btn.disabled = true;
  say("存檔中…");
  try {
    const j = await getJson("/api/discord/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: $("dc-token")?.value || "",
        channelId: $("dc-channel")?.value || "",
        enabled: !!status.enabled,
      }),
    });
    if (j && j.ok) {
      status = j;
      const token = $("dc-token");
      if (token) {
        token.value = "";
        token.placeholder = status.configured ? `已存 · ${status.tokenTail}` : "MTA1…";
      }
      say("已存。", "ok");
    } else {
      say(String((j && j.error) || "存不進去"), "err");
    }
  } catch (err) {
    say(String(err.message || err), "err");
  }
  paint();
  if (btn) btn.disabled = false;
}

async function test() {
  const btn = $("dc-test");
  if (btn) btn.disabled = true;
  say("送出中…");
  try {
    const j = await getJson("/api/discord", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test: true }),
    });
    if (j && j.ok) say("送到了。去頻道看一下。", "ok");
    else say(String((j && j.error) || "Discord 沒收"), "err");
  } catch (err) {
    say(String(err.message || err), "err");
  }
  await refresh();
  if (btn) btn.disabled = false;
}

export function dcReady() {
  return !!(status.configured && status.enabled);
}

// 把一張成品排進伺服器的送圖佇列。不 await，送圖再慢也不拖抽圖。
export function dcSendCard(card, job, zh) {
  if (!dcReady() || !job || !job.image) return;
  let q;
  try {
    q = new URL(job.image, location.href).searchParams;
  } catch {
    return;
  }
  const filename = q.get("filename");
  if (!filename) return;
  fetch("/api/discord", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename,
      subfolder: q.get("subfolder") || "",
      type: q.get("type") || "output",
      seed: job.seed,
      width: job.width,
      height: job.height,
      zh: zh || "",
      en: job.positive || "",
    }),
  })
    .then((r) => r.json())
    .then((j) => {
      if (j && j.ok) markCard(card);
    })
    .catch(() => {
      /* 送圖失敗不吵抽圖，面板的失敗計數會記 */
    });
}

function markCard(card) {
  if (!card || card.querySelector(".dc-mark")) return;
  const shot = card.querySelector(".shot");
  if (!shot) return;
  const mark = document.createElement("span");
  mark.className = "tg-mark dc-mark";
  mark.title = "已排進 Discord 佇列";
  mark.innerHTML = LOGO;
  shot.append(mark);
}

export function initDiscord() {
  ensureDom();
  $("dc-btn")?.addEventListener("click", () => (isOpen() ? close() : open()));
  $("dc-close")?.addEventListener("click", close);
  $("dc-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "dc-modal") close();
  });
  $("dc-save")?.addEventListener("click", save);
  $("dc-test")?.addEventListener("click", test);
  $("dc-enabled")?.addEventListener("click", () => {
    status.enabled = !status.enabled;
    paint();
    save();
  });
  for (const id of ["dc-token", "dc-channel"]) {
    $(id)?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save();
      }
    });
  }
  refresh();
}

export function dcHandleKeys(e) {
  if (!isOpen()) return false;
  if (e.key === "Escape") {
    e.preventDefault();
    close();
    return true;
  }
  return true;
}

export function dcUiOpen() {
  return isOpen();
}
