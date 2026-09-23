/**
 * navigator.clipboard 只在安全環境（HTTPS、localhost）存在。start.bat 印出來的
 * Tailscale 網址是 http://100.x.x.x —— 手機從那裡開，瀏覽器根本不給 navigator.clipboard，
 * 專案裡每一個「複製」都是直接呼叫 navigator.clipboard.writeText，按下去就是 TypeError：
 * 沒複製、也沒有任何回饋。
 *
 * 這裡在最前面補一層，六個呼叫點都不用改：
 *   - 沒有 navigator.clipboard：補一個用 execCommand("copy") 的 writeText。
 *   - 有但被拒（沒權限、文件沒焦點）：改走同一條備援。
 * 備援也失敗就 reject，不假裝成功 —— 呼叫端的「已複製」只在真的複製之後才出現。
 */

function execCopy(doc, text) {
  return new Promise((resolve, reject) => {
    const ta = doc.createElement("textarea");
    ta.value = text;
    // readonly：手機上不會跳出鍵盤。16px：iOS 對小於 16px 的輸入框會放大整頁。
    ta.setAttribute("readonly", "");
    ta.setAttribute("aria-hidden", "true");
    Object.assign(ta.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "1px",
      height: "1px",
      opacity: "0",
      pointerEvents: "none",
      fontSize: "16px",
    });
    const back = doc.activeElement;
    doc.body.append(ta);
    let copied = false;
    try {
      ta.focus?.();
      ta.select();
      ta.setSelectionRange?.(0, text.length);
      copied = !!doc.execCommand("copy");
    } catch {
      copied = false;
    }
    ta.remove();
    // 焦點還給剛剛按的那顆鈕，鍵盤使用者不會被丟回頁首。
    try {
      back?.focus?.({ preventScroll: true });
    } catch {
      /* ignore */
    }
    if (copied) resolve();
    else reject(new Error("複製失敗"));
  });
}

export function installClipboardFallback(nav = globalThis.navigator, doc = globalThis.document) {
  if (!nav || !doc) return;
  const native = nav.clipboard && typeof nav.clipboard.writeText === "function" ? nav.clipboard : null;
  const fallback = (text) => execCopy(doc, String(text ?? ""));
  if (!native) {
    try {
      Object.defineProperty(nav, "clipboard", { configurable: true, value: { writeText: fallback } });
    } catch {
      /* ignore */
    }
    return;
  }
  const real = native.writeText.bind(native);
  try {
    native.writeText = (text) => real(text).catch(() => fallback(text));
  } catch {
    /* ignore */
  }
}

installClipboardFallback();
