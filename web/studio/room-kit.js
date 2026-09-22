/**
 * 畫房間用的小工具。
 *
 * 這裡沒有任何「功能」，只有形狀、材質和光。拆出來是因為 scene-loader 的職責是
 * 「決定要載 GLB 還是畫替代房間」，不是「怎麼畫一張桌子」。
 *
 * 幾個刻意的決定：
 *
 * 1. **圓角。** 廉價 CG 最明顯的特徵就是刀切一樣的直角 —— 真實世界裡沒有東西是
 *    完美銳角的，而邊緣那一條細細的高光正是眼睛判斷材質的主要線索。所以這裡
 *    所有家具都走 roundedBox，不用 BoxGeometry。代價是三角形多幾倍，但這個場景
 *    本來就只有幾千面，多的部分完全不痛。
 *
 * 2. **輝光用貼片不用後製。** EffectComposer 的 bloom 要多載三四個檔案、多一個
 *    全螢幕 pass，而這個房間只有兩個光源需要暈開。用一張程式生成的徑向漸層貼片
 *    加法混合貼在光源上，便宜、可控、而且不會在低階機器上掉幀。
 *
 * 3. **貼圖全部是程式生成的。** 這個專案不引進任何美術資產（授權、體積、離線
 *    都是麻煩），所以漸層、環境光、窗景都用 canvas 畫出來再當貼圖用。
 */

/** 圓角方塊。r 是圓角半徑，會自動夾在邊長的一半以內。 */
export function roundedBox(THREE, w, h, d, r = 0.02, seg = 2) {
  const radius = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  if (!(radius > 0)) return new THREE.BoxGeometry(w, h, d);
  // 用 ExtrudeGeometry 做圓角矩形再往深度擠出去，六個邊都會有圓角。
  const shape = new THREE.Shape();
  const x = -w / 2 + radius;
  const y = -h / 2 + radius;
  const iw = w - radius * 2;
  const ih = h - radius * 2;
  shape.moveTo(x, -h / 2);
  shape.lineTo(x + iw, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, y);
  shape.lineTo(w / 2, y + ih);
  shape.quadraticCurveTo(w / 2, h / 2, x + iw, h / 2);
  shape.lineTo(x, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, y + ih);
  shape.lineTo(-w / 2, y);
  shape.quadraticCurveTo(-w / 2, -h / 2, x, -h / 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, d - radius * 2),
    bevelEnabled: true,
    bevelThickness: radius,
    bevelSize: radius,
    bevelSegments: seg,
    curveSegments: seg + 2,
    steps: 1,
  });
  geo.translate(0, 0, -(d - radius * 2) / 2);
  geo.computeVertexNormals();
  return geo;
}

/** 徑向漸層貼片，拿來當輝光和窗光。中心不透明、邊緣透明。 */
export function radialTexture(THREE, inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)", size = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.4, inner.replace(/[\d.]+\)$/, "0.5)"));
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 加法混合的輝光貼片。永遠面向相機。 */
export function glowSprite(THREE, color, size, opacity = 1) {
  const mat = new THREE.SpriteMaterial({
    map: radialTexture(THREE),
    color,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(size, size, 1);
  return s;
}

/**
 * 夜間城市的窗景。不是照片，是幾十個亮點加一層冷色漸層 ——
 * 遠處的窗戶在夜裡本來就只是這樣。
 */
export function cityTexture(THREE, w = 256, h = 256) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#0a1220");
  sky.addColorStop(0.55, "#132235");
  sky.addColorStop(1, "#1d3247");
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  // 遠景大樓：暗塊 + 零星亮窗
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 26; i += 1) {
    const bw = 10 + rnd() * 26;
    const bh = 40 + rnd() * 130;
    const bx = rnd() * w;
    const by = h - bh;
    g.fillStyle = "rgba(6,10,18,0.92)";
    g.fillRect(bx, by, bw, bh);
    for (let y = by + 6; y < h - 6; y += 9) {
      for (let x = bx + 3; x < bx + bw - 4; x += 7) {
        if (rnd() > 0.72) {
          g.fillStyle = rnd() > 0.35 ? "rgba(255,214,150,0.85)" : "rgba(150,200,255,0.7)";
          g.fillRect(x, y, 3, 4);
        }
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 環境光貼圖。給材質一點可以反射的東西 —— 沒有環境反射的 PBR 材質看起來會
 * 像塑膠，這是「簡陋」最主要的來源之一，比多邊形數重要得多。
 * 用一張上冷下暖的漸層就夠，不需要 HDRI 檔案。
 */
export function studioEnvironment(THREE, renderer) {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, "#2b3a4a");
  grad.addColorStop(0.45, "#1a1d26");
  grad.addColorStop(0.75, "#241c16");
  grad.addColorStop(1, "#0d0a08");
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return env;
}

/**
 * 螢幕上的畫面。
 *
 * 這台螢幕是房間的主角，而它原本是一塊純色的藍板子 —— 整個場景最假的地方。
 * 這裡畫的是**排字匣本身的輪廓**：左邊一排字卡、中間成品格、底下一條主要按鈕。
 *
 * 刻意不畫任何可讀的字。3D 場景裡的 UI 文字不管怎麼調都會糊成雜訊，而且一糊
 * 就會讓人盯著看「那寫什麼」，注意力反而被偷走。只給形狀就夠了 ——
 * 認得出「那是我的工具」比讀得出字重要。
 */
export function screenTexture(THREE, w = 512, h = 288) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  // LCD 的「黑」其實是亮的 —— 背光透出來的那一層。用純黑當底會讓整面螢幕
  // 看起來像關機，而不是在暗房裡發光。
  g.fillStyle = "#222a38";
  g.fillRect(0, 0, w, h);

  // 頂欄
  g.fillStyle = "#2b3444";
  g.fillRect(0, 0, w, 26);
  g.fillStyle = "#e8b06a";
  g.fillRect(14, 9, 38, 8);
  g.fillStyle = "#2c3340";
  for (let i = 0; i < 4; i += 1) g.fillRect(w - 150 + i * 36, 8, 28, 10);

  // 左側字卡欄
  g.fillStyle = "#1d2531";
  g.fillRect(0, 26, 132, h - 26);
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let row = 0; row < 11; row += 1) {
    let x = 10;
    for (let i = 0; i < 3 && x < 118; i += 1) {
      const cw = 22 + rnd() * 30;
      if (x + cw > 122) break;
      const hot = rnd() > 0.82;
      g.fillStyle = hot ? "rgba(245,190,120,0.95)" : "#394454";
      g.fillRect(x, 36 + row * 20, cw, 12);
      x += cw + 5;
    }
  }

  // 成品格
  const gx = 146;
  const gw = w - gx - 16;
  const cell = (gw - 16) / 3;
  for (let i = 0; i < 6; i += 1) {
    const cx = gx + (i % 3) * (cell + 8);
    const cy = 40 + Math.floor(i / 3) * (cell * 0.75 + 10);
    const lum = 0.42 + rnd() * 0.45;
    g.fillStyle = `rgb(${Math.round(90 * lum + 22)},${Math.round(76 * lum + 20)},${Math.round(70 * lum + 24)})`;
    g.fillRect(cx, cy, cell, cell * 0.75);
    g.fillStyle = "rgba(255,255,255,0.05)";
    g.fillRect(cx, cy, cell, 3);
  }

  // 底部主要按鈕
  g.fillStyle = "#e8b06a";
  g.fillRect(gx, h - 34, 96, 20);
  g.fillStyle = "#222833";
  g.fillRect(gx + 106, h - 34, 60, 20);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * 很淡的雜訊貼圖，拿來當 roughnessMap。
 *
 * 大面積的純色牆面和地板是整個場景第二假的地方 —— 真實的表面不會每一個點都
 * 一樣粗糙，而 roughness 一致就等於高光一致，眼睛會直接判定「這是塑膠」。
 * 只要一點點不均勻，光掃過去就會有生命。
 */
export function noiseRoughness(THREE, size = 256, base = 168, spread = 46) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  let seed = 3;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < size * size; i += 1) {
    // 兩個頻率疊起來：細顆粒 + 大塊起伏，比純白雜訊自然
    const x = i % size;
    const y = (i / size) | 0;
    const coarse = Math.sin(x * 0.045) * Math.cos(y * 0.037) * 0.5 + 0.5;
    const v = base + (rnd() - 0.5) * spread + (coarse - 0.5) * spread * 0.8;
    const p = i * 4;
    img.data[p] = img.data[p + 1] = img.data[p + 2] = Math.max(0, Math.min(255, v));
    img.data[p + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * 光束。加法混合的錐體，從燈罩往下擴散。
 *
 * 空氣裡看得見的那道光是「夜晚房間」最有感的一樣東西，而它幾乎不花成本：
 * 一個沒有底面的錐體、加法混合、不寫深度、邊緣靠頂點顏色淡出。
 * 不做體積霧 —— 那要多一個 pass，而這裡只需要「看起來有」。
 */
export function lightShaft(THREE, color, topR, bottomR, height, opacity = 0.055) {
  const geo = new THREE.CylinderGeometry(topR, bottomR, height, 24, 1, true);
  const cols = [];
  const pos = geo.attributes.position;
  const c = new THREE.Color(color);
  for (let i = 0; i < pos.count; i += 1) {
    // 越往下越淡：光束離開燈罩之後會散掉
    const t = (pos.getY(i) + height / 2) / height;
    const k = Math.pow(t, 1.5);
    cols.push(c.r * k, c.g * k, c.b * k);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  return new THREE.Mesh(geo, mat);
}
