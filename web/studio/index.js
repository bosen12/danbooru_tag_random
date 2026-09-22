/**
 * 3D 工作室的進入點。boot.js 用動態 import() 載這一支，所以 2D 那一側的
 * 首次可操作時間完全不受影響 —— three.js 那 670KB 只有在真的要進 3D 時才會下載。
 *
 * 這裡只做一件事：把 view-controller 叫起來。真正的 3D 在 studio-shell.js，
 * 而那一支也是等到第一次切到 3D 才會被 import 進來。
 */

import { createViewController, detectCapabilities } from "./view-controller.js";

let controller = null;

/**
 * 這個版面有沒有要 3D。
 *
 * server.py 的靜態路徑會退回 SHARED（也就是 web/），所以暗房／活字樓／抽籤棚
 * 那三套版面其實也抓得到 studio/ 與 vendor/。但它們的 index.html 沒有 studio.css、
 * 也沒有 importmap —— 真讓它們跑起來，會得到一個沒有樣式的 HUD，以及之後放進 GLB
 * 時才爆出來的 bare specifier 錯誤。
 *
 * 半個能用的東西比沒有更糟。所以規則講明白：**版面要自己表態**，
 * 掛上 studio.css 就是要，沒掛就安靜地什麼都不做。
 */
function layoutOptedIn() {
  return !!document.querySelector('link[rel="stylesheet"][href*="studio/studio.css"]');
}

export function initStudio(opts) {
  if (controller) return controller;
  if (!layoutOptedIn()) return null;
  const reducedMotion =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  controller = createViewController({
    capabilities: detectCapabilities(),
    reducedMotion,
    ...(opts || {}),
  });
  const decided = controller.start();
  if (decided.forced) {
    console.info("[studio] 這次使用平面工作台：" + decided.reason);
  }
  controller.on((name, detail) => {
    if (name === "forced-flat" || name === "fatal") {
      console.warn("[studio] " + (detail?.reason || name));
      // 失敗時不要靜靜地什麼都不說 —— 借用既有的 aria-live 區講一句。
      const live = document.getElementById("live");
      if (live) live.textContent = "3D 工作室無法使用，已留在平面工作台。";
    }
  });
  return controller;
}

export function getViewController() {
  return controller;
}
