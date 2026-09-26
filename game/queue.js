/** 生圖佇列：背景永遠預先生好下一題。只管網路，不懂遊戲規則。 */

export const GEN_WIDTH = 1024;
export const GEN_HEIGHT = 1024;
export const MAX_ATTEMPTS = 20;

export async function* sseEvents(res) {
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
      if (data.length) yield { event, data: JSON.parse(data.join("\n")) };
    }
  }
}

export async function generate(positive, opts = {}) {
  const { onEvent, signal, fetchImpl = fetch, seed } = opts;
  // 沒給種子就讓伺服器自己挑（隨機）；給了就是玩家在「生圖種子」固定的那顆。
  const body = { positive, width: GEN_WIDTH, height: GEN_HEIGHT };
  if (seed !== undefined && seed !== null) body.seed = seed;
  const res = await fetchImpl("/api/gen", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error("gen HTTP " + res.status);
  for await (const { event, data } of sseEvents(res)) {
    if (onEvent) onEvent(event, data);
    if (event === "error") throw new Error(data.error || "gen failed");
    if (event === "done") return data;
  }
  throw new Error("gen stream ended without a result");
}

export function createQueue(opts) {
  const { makeRound, onEvent, generateImpl = generate, seed } = opts;
  let pending = null;

  async function build() {
    let lastErr = null;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const round = makeRound();
      if (!round) continue; // 組不出題，重抽。沒花到 GPU。
      try {
        const job = await generateImpl(round.draw.positive, { onEvent, seed: typeof seed === "function" ? seed() : undefined });
        return { ...round, image: job.image, seed: job.seed };
      } catch (err) {
        lastErr = err; // 生圖失敗不是玩家的錯，換一題再來
      }
    }
    throw lastErr || new Error(`queue: 連續 ${MAX_ATTEMPTS} 次都沒生出題目`);
  }

  function fill() {
    if (!pending) pending = build();
    return pending;
  }

  return {
    prime() {
      fill();
    },
    async take() {
      const ready = fill();
      pending = null;
      try {
        return await ready;
      } finally {
        fill(); // 拿走一題就立刻補下一題，這就是「預抽 1」
      }
    },
  };
}

/**
 * 畫面上顯示用的圖：伺服器轉好的 webp（約原圖的 1/10，見 server.py 的 comfy_webp）。
 * 原圖一張 1.3 MB 上下，走 Tailscale 或行動網路時很慢；「開原圖」連結照樣給 PNG。
 */
export function viewSrc(src) {
  if (!src || !String(src).startsWith("/api/image?") || /[?&]fmt=/.test(src)) return src;
  return src + "&fmt=webp";
}
