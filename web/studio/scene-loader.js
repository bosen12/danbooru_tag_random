/**
 * 場景載入。這是唯一一個知道 three.js 存在的「資產」層。
 *
 * 兩條路徑、一個介面：
 *   1. scene/studio.glb 存在 → 載它。
 *   2. 不存在（現在就是這樣）→ 用程式畫排字台（type-shop.js）。
 *
 * 替代房間**不是**最終視覺，它的存在只是為了讓運鏡、hotspot、面板、效能與
 * fallback 這些真正的功能現在就能跑、能測、能驗收。它刻意用和 GLB 一樣的節點命名
 * （HOTSPOT_*），所以美術把 studio.glb 放進來之後，這個檔案以外的程式一行都不用改。
 *
 * Draco / KTX2 / Meshopt 都是延後載入而且包在 try 裡：解碼器抓不到時就當作沒有，
 * 照樣用沒壓縮的資料把場景開起來，而不是整頁卡在 loading。
 */

import * as THREE from "../vendor/three/build/three.module.min.js";
import { HOTSPOT_PREFIX } from "./hotspots.js";
import { studioEnvironment } from "./room-kit.js";
import { makeTypeShop } from "./type-shop.js";

const SCENE_DIR = new URL("./scene/", import.meta.url).href;
const MANIFEST_URL = SCENE_DIR + "scene.json";
const LOAD_TIMEOUT_MS = 15000;

function collectMetrics(THREE_, scene, renderer) {
  let triangles = 0;
  const materials = new Set();
  const textures = new Set();
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const idx = g.index ? g.index.count : g.attributes.position?.count || 0;
    triangles += Math.floor(idx / 3);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m) continue;
      materials.add(m.uuid);
      for (const k of Object.keys(m)) {
        const v = m[k];
        if (v && v.isTexture) textures.add(v.uuid);
      }
    }
  });
  return {
    triangles,
    materials: materials.size,
    textures: textures.size,
    drawCalls: renderer?.info?.render?.calls ?? null,
  };
}

/**
 * @returns {Promise<{root, hotspotNodes: Map<string, object>, source: string, metrics: object, dispose: Function}>}
 */
export async function loadStudioScene({ signal } = {}) {
  let root = null;
  let source = "placeholder";
  // 手盒裡排的字（排字台才有；GLB 沒有手盒就什麼都不做）。
  let setComposed = () => null;

  // 先問清單，不要直接對 GLB 發探測 —— 那會在主控台留下一條 404 紅字，
  // 而「還沒有模型」是這個專案現在的正常狀態，不該長得像壞掉。
  let manifest = null;
  try {
    const r = await fetch(MANIFEST_URL, { signal });
    if (r.ok) manifest = await r.json();
  } catch {
    manifest = null;
  }
  const hasGlb = !!manifest?.glb;
  const glbUrl = SCENE_DIR + (manifest?.file || "studio.glb");

  if (hasGlb) {
    const { GLTFLoader } = await import("../vendor/three/examples/jsm/loaders/GLTFLoader.js");
    const loader = new GLTFLoader();
    await tryAttachDecoders(loader);
    const gltf = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("GLB 載入逾時")), LOAD_TIMEOUT_MS);
      loader.load(
        glbUrl,
        (g) => {
          clearTimeout(timer);
          resolve(g);
        },
        undefined,
        (err) => {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error("GLB 載入失敗"));
        },
      );
    });
    root = gltf.scene;
    source = "glb";
  } else {
    const shop = makeTypeShop(THREE);
    root = shop.root;
    setComposed = shop.setComposed;
  }

  const hotspotNodes = new Map();
  root.traverse((o) => {
    if (o.name && o.name.startsWith(HOTSPOT_PREFIX)) hotspotNodes.set(o.name, o);
  });

  return {
    root,
    hotspotNodes,
    source,
    setComposed: (labels) => setComposed(labels),
    metricsFor: (renderer) => collectMetrics(THREE, root, renderer),
    dispose() {
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose?.();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m) continue;
          for (const k of Object.keys(m)) {
            const v = m[k];
            if (v && v.isTexture) v.dispose?.();
          }
          m.dispose?.();
        }
      });
    },
  };
}

export { THREE, studioEnvironment };
