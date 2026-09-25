/**
 * 生圖佇列：一次送一張到 /api/gen（SSE），把進度、預覽、成品回報給畫面。
 *
 * 跟主工具同一套規矩：
 *   - 伺服器每 5 秒有一則心跳；靜默超過 IDLE_MS 就當那條連線死了，這張放棄（算失敗）。
 *   - 中斷一定帶 prompt_id，只砍自己那張；不帶 prompt_id 的中斷會砍掉 Comfy 當下在跑的任何東西。
 *
 * 可以接回去（X-Gen-Resume）：從 Mac 走 Tailscale、手機付印時網路斷一下，伺服器不會馬上砍掉這張，
 * 會留著等一陣子（server.py 的 GEN_REATTACH_SEC）。這裡斷線就用 /api/gen/attach 重接，從頭重播；
 * 頁面重新整理之後，畫到一半的那張也用 resume() 接回來。明確按停走 /api/gen/cancel。
 */
import { escapeForComfy } from "./engine.js";

const IDLE_MS = 90000;
// 斷線之後重接的間隔。加起來約 23 秒，比伺服器留著等的 30 秒短。
const REATTACH_WAITS = [800, 1500, 2500, 4000, 6000, 8000];

/** 伺服器（或 Comfy）說這張壞了：不是連線問題，重接也沒用。 */
class GenError extends Error {}

async function errorOf(res) {
  let msg = "伺服器回了 " + res.status;
  try {
    const j = await res.json();
    if (j.error) msg = j.error;
  } catch {
    /* 不是 JSON */
  }
  return new GenError(msg);
}

async function* sseEvents(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let at;
    while ((at = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, at);
      buf = buf.slice(at + 2);
      let event = "message";
      const data = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trim());
      }
      if (!data.length) continue;
      try {
        yield { event, data: JSON.parse(data.join("\n")) };
      } catch {
        /* 壞的一格跳過 */
      }
    }
  }
}

/**
 * hooks:
 *   payload(shot) → /api/gen 的 body（positive 以外的：loras、ckpt、rating、workflowId、width、height）
 *   update(shot)  shot 的狀態變了
 *   idle()        佇列清空了（無限抽用它接下一輪）
 */
export function createGenerator(hooks) {
  const queue = [];
  let current = null;
  let running = false;

  async function runOne(shot) {
    const ctrl = new AbortController();
    current = { shot, ctrl, promptId: null, job: shot.job || null };
    shot.status = "running";
    shot.progress = shot.progress || 0;
    shot.note = shot.job ? "接回剛才那張…" : "排隊中";
    hooks.update(shot);
    let watchdog = 0;
    let stalled = false;
    const kick = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        stalled = true;
        ctrl.abort();
      }, IDLE_MS);
    };
    const wait = (ms) =>
      new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        ctrl.signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
      });
    const open = () =>
      current.job
        ? fetch(`/api/gen/attach?job=${encodeURIComponent(current.job)}`, { headers: { Accept: "text/event-stream" }, signal: ctrl.signal })
        : fetch("/api/gen", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "text/event-stream", "X-Gen-Resume": "1" },
            body: JSON.stringify({ ...hooks.payload(shot), positive: escapeForComfy(shot.positive), seed: shot.seed }),
            signal: ctrl.signal,
          });
    try {
      for (let attempt = 0; ; attempt++) {
        kick();
        try {
          const res = await open();
          if (!res.ok) {
            if (res.status === 404 && current.job) throw new GenError("連線斷了太久，伺服器那邊已經停掉這張");
            throw await errorOf(res);
          }
          const job = res.headers.get("X-Gen-Job");
          if (job && job !== shot.job) {
            shot.job = job;
            current.job = job;
            hooks.update(shot);
          }
          for await (const { event, data } of sseEvents(res)) {
            kick();
            if (data && data.prompt_id) current.promptId = data.prompt_id;
            if (event === "queued") {
              shot.note = "排隊中";
            } else if (event === "progress") {
              const max = data.max || 25;
              shot.progress = Math.min(1, (data.value || 0) / max);
              shot.note = `繪製 ${data.value || 0}/${max}`;
            } else if (event === "preview" && data.image) {
              shot.preview = data.image;
              shot.note = shot.note || "預覽中";
            } else if (event === "done") {
              shot.status = "done";
              shot.image = data.image;
              shot.preview = null;
              shot.progress = 1;
              shot.note = "";
              if (data.seed !== undefined) shot.seed = data.seed;
              hooks.update(shot);
              return true;
            } else if (event === "error") {
              throw new GenError(data.error || "Comfy 報錯");
            }
            hooks.update(shot);
          }
          throw new Error("連線中途斷了");
        } catch (err) {
          // 連線斷了（不是伺服器說壞了、不是按停、也不是靜默太久）：伺服器那邊還留著這張，接回去。
          if (err instanceof GenError || shot.status === "cancelled" || stalled || !current.job || attempt >= REATTACH_WAITS.length) throw err;
          shot.note = "連線斷了，重新接上…";
          hooks.update(shot);
          await wait(REATTACH_WAITS[attempt]);
          if (shot.status === "cancelled") throw err;
        }
      }
    } catch (err) {
      shot.preview = null;
      if (shot.status === "cancelled") {
        hooks.update(shot);
        return false;
      }
      shot.status = "failed";
      shot.note = stalled ? `Comfy 靜默超過 ${IDLE_MS / 1000} 秒，這張放棄` : String(err && err.message ? err.message : err);
      hooks.update(shot);
      if (stalled) cancelJob(current.job, current.promptId);
      return false;
    } finally {
      clearTimeout(watchdog);
      current = null;
    }
  }

  async function pump() {
    if (running) return;
    running = true;
    let fails = 0;
    while (queue.length) {
      const shot = queue.shift();
      if (shot.status === "cancelled") continue;
      const ok = await runOne(shot);
      fails = ok ? 0 : shot.status === "failed" ? fails + 1 : fails;
      if (fails >= 3) {
        for (const s of queue.splice(0)) {
          s.status = "cancelled";
          s.note = "連續失敗三張，停下來了";
          hooks.update(s);
        }
        hooks.stopped && hooks.stopped("連續失敗三張，停下來了：" + (shot.note || ""));
        break;
      }
    }
    running = false;
    hooks.idle && hooks.idle();
  }

  function interrupt(promptId) {
    fetch("/api/interrupt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(promptId ? { prompt_id: promptId } : {}),
    }).catch(() => {});
  }

  /** 明確的停：伺服器那邊的工作一起收掉（排隊中的從 Comfy 佇列刪掉）。找不到工作就退回只砍 prompt。 */
  function cancelJob(job, promptId) {
    if (!job) return interrupt(promptId);
    fetch("/api/gen/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job }),
    })
      .then((r) => {
        if (!r.ok) interrupt(promptId);
      })
      .catch(() => interrupt(promptId));
  }

  return {
    enqueue(shot) {
      shot.status = "queued";
      shot.note = "等前面的印完";
      queue.push(shot);
      hooks.update(shot);
      pump();
    },
    /** 重新整理之前畫到一半的那張（shot.job 還在）：排到最前面，用 attach 接回去。 */
    resume(shot) {
      if (!shot.job) return;
      shot.status = "queued";
      shot.note = "接回剛才那張…";
      queue.unshift(shot);
      hooks.update(shot);
      pump();
    },
    /** 停：正在畫的那張也一起砍（帶 prompt_id），排隊的全部取消。 */
    stop() {
      for (const s of queue.splice(0)) {
        s.status = "cancelled";
        s.note = "取消了";
        hooks.update(s);
      }
      if (current) {
        current.shot.status = "cancelled";
        current.shot.note = "取消了";
        cancelJob(current.job, current.promptId);
        current.ctrl.abort();
      }
    },
    get busy() {
      return running || queue.length > 0;
    },
    get pending() {
      return queue.length + (current ? 1 : 0);
    },
  };
}

/**
 * 成品在畫面上顯示用的網址：跟伺服器要 webp 小檔（約原圖的 1/12，走 Tailscale 時差很多）。
 * 「開原圖」照舊用原本的網址拿 PNG；印製中的預覽幀（data: URL）不動。
 */
export function viewSrc(src) {
  if (!src || !src.startsWith("/api/image?") || /[?&]fmt=/.test(src)) return src;
  return src + "&fmt=webp";
}

export async function comfyOnline() {
  try {
    const r = await fetch("/api/ping", { cache: "no-store" });
    if (!r.ok) return false;
    const j = await r.json();
    return !!j.ok;
  } catch {
    return false;
  }
}
