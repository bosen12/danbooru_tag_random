/**
 * 生圖佇列：一次送一張到 /api/gen（SSE），把進度、預覽、成品回報給畫面。
 *
 * 跟主工具同一套規矩：
 *   - 伺服器每 5 秒有一則心跳；靜默超過 IDLE_MS 就當那條連線死了，這張放棄（算失敗）。
 *   - 中斷一定帶 prompt_id，只砍自己那張；不帶 prompt_id 的中斷會砍掉 Comfy 當下在跑的任何東西。
 */
import { escapeForComfy } from "./engine.js";

const IDLE_MS = 90000;

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
    current = { shot, ctrl, promptId: null };
    shot.status = "running";
    shot.progress = 0;
    shot.note = "排隊中";
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
    kick();
    try {
      const body = { ...hooks.payload(shot), positive: escapeForComfy(shot.positive), seed: shot.seed };
      const res = await fetch("/api/gen", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        let msg = "伺服器回了 " + res.status;
        try {
          const j = await res.json();
          if (j.error) msg = j.error;
        } catch {
          /* 不是 JSON */
        }
        throw new Error(msg);
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
          throw new Error(data.error || "Comfy 報錯");
        }
        hooks.update(shot);
      }
      throw new Error("連線中途斷了");
    } catch (err) {
      shot.preview = null;
      if (shot.status === "cancelled") {
        hooks.update(shot);
        return false;
      }
      shot.status = "failed";
      shot.note = stalled ? `Comfy 靜默超過 ${IDLE_MS / 1000} 秒，這張放棄` : String(err && err.message ? err.message : err);
      hooks.update(shot);
      if (stalled) interrupt(current.promptId);
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

  return {
    enqueue(shot) {
      shot.status = "queued";
      shot.note = "等前面的印完";
      queue.push(shot);
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
        interrupt(current.promptId);
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
