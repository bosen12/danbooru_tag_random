/**
 * 印刷機：把 run.prints 裡排隊的作品一張一張送去 ComfyUI。
 *
 * 只管網路。一次只印一張（Comfy 本來就一次一張），生圖途中的預覽幀只放在記憶體裡，
 * 不寫進存檔 —— base64 的中間幀很大，localStorage 放不下。成品只存 /api/image 的網址。
 * Comfy 沒開也照樣能玩：作品停在「等印刷機」，開了之後按一下就接著印。
 */
import { genSeed } from "./seed-control.js";

const WIDTH = 832;
const HEIGHT = 1216;

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
      if (data.length) {
        try {
          yield { event, data: JSON.parse(data.join("\n")) };
        } catch {
          /* 壞掉的一格就跳過 */
        }
      }
    }
  }
}

export async function comfyOnline() {
  try {
    const res = await fetch("/api/ping", { cache: "no-store" });
    if (!res.ok) return false;
    const j = await res.json();
    return !!j.ok;
  } catch {
    return false;
  }
}

/**
 * hooks：
 *   getRun()            目前這局（印刷機直接改 run.prints[i] 的 status / image）
 *   onChange(print)     某張的狀態或預覽變了
 *   onDone(print)       印好了（存作品牆、存檔）
 *   enabled()           設定裡有沒有開自動印
 */
export function createPrinter(hooks) {
  const previews = new Map();
  const progress = new Map();
  let busy = false;
  let controller = null;

  async function printOne(p) {
    p.status = "printing";
    progress.set(p.id, 0);
    hooks.onChange(p);
    controller = new AbortController();
    const res = await fetch("/api/gen", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      // 「生圖種子」固定時用固定的那顆，隨機時用這一單自己的種子（跟這一局的亂數綁在一起）。
      body: JSON.stringify({ positive: p.positive, seed: genSeed(p.seed), width: WIDTH, height: HEIGHT, rating: "general" }),
      signal: controller.signal,
    });
    if (!res.ok) {
      let msg = "印刷機回了 " + res.status;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch {
        /* 不是 JSON 就用狀態碼 */
      }
      throw new Error(msg);
    }
    let frames = 0;
    for await (const { event, data } of sseEvents(res)) {
      if (event === "preview" && data.image) {
        frames += 1;
        previews.set(p.id, data.image);
        progress.set(p.id, Math.min(0.95, frames / 25));
        hooks.onChange(p);
      } else if (event === "error") {
        throw new Error(data.error || "印壞了");
      } else if (event === "done") {
        p.status = "done";
        p.image = data.image;
        previews.delete(p.id);
        progress.set(p.id, 1);
        hooks.onChange(p);
        hooks.onDone(p);
        return;
      }
    }
    throw new Error("印刷機中途斷線");
  }

  async function pump() {
    if (busy) return;
    const run = hooks.getRun();
    if (!run || !hooks.enabled()) return;
    const next = run.prints.find((p) => p.status === "queued");
    if (!next) return;
    busy = true;
    try {
      if (!(await comfyOnline())) {
        for (const p of run.prints) if (p.status === "queued") p.status = "offline";
        hooks.onChange(next);
        return;
      }
      await printOne(next);
    } catch (err) {
      if (next.status === "printing") {
        next.status = "failed";
        next.error = String(err && err.message ? err.message : err);
        hooks.onChange(next);
      }
    } finally {
      busy = false;
      controller = null;
    }
    setTimeout(pump, 50);
  }

  return {
    kick() {
      pump();
    },
    /** 印刷機沒開、或印壞了的，全部重新排隊。 */
    retry() {
      const run = hooks.getRun();
      if (!run) return;
      for (const p of run.prints) {
        if (p.status === "offline" || p.status === "failed") {
          p.status = "queued";
          p.error = "";
        }
      }
      pump();
    },
    preview(id) {
      return previews.get(id) || null;
    },
    progress(id) {
      return progress.get(id) || 0;
    },
    stop() {
      if (controller) controller.abort();
    },
    get busy() {
      return busy;
    },
  };
}

export const PRINT_STATUS_ZH = {
  queued: "排隊等印",
  printing: "印製中",
  done: "印好了",
  offline: "印刷機沒開",
  failed: "印壞了",
};

/**
 * 畫面上顯示用的圖：伺服器轉好的 webp（約原圖的 1/10，見 server.py 的 comfy_webp）。
 * 原圖一張 1.3 MB 上下，走 Tailscale 或行動網路時很慢；「開原圖」連結照樣給 PNG。
 */
export function viewSrc(src) {
  if (!src || !String(src).startsWith("/api/image?") || /[?&]fmt=/.test(src)) return src;
  return src + "&fmt=webp";
}
