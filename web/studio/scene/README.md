# 3D 排字台場景：Blender → GLB 規範

**現在這個資料夾裡沒有模型。** 程式跑的是 `type-shop.js` 用程式碼畫出來的排字台：
一張浮在黑暗裡的活版排字台，一盞吊燈照亮桌面，八個功能點是排版工坊裡的器具。
它不只是佔位 —— 運鏡、hotspot、面板接線、效能降級、fallback 都在它上面跑、測、驗收，
而且手盒會跟著「這張 POS」即時排字。

要換成美術做的場景，把 `studio.glb` 放進這個資料夾，然後把 `scene.json` 的 `"glb"`
改成 `true`。`camera-controller`、`hotspots`、`studio-bridge` 都不知道場景是哪裡來的。
（GLB 沒有手盒排字的功能：`setComposed` 在 GLB 路徑上什麼都不做。）

---

## 一、必須存在的節點

GLB 裡這八個節點名**一個都不能少、不能改**。少了哪一個，那個功能點在畫面上就是
「點了沒反應」；`studio-shell.js` 會在主控台列出對不上的節點名，但畫面上不會報錯，
所以請以這張表為準。節點名沿用第一版（房間）的命名，所以手盒還叫 `DRAW_SCREEN`。

| 節點名 | 排字台上的器具 | 功能 |
|---|---|---|
| `HOTSPOT_DRAW_SCREEN` | 手盒（桌子正中央，主角） | 抽牌、POS／NEG、出圖 |
| `HOTSPOT_TAG_BOX` | 活字架（斜放在架上的字盒，招牌） | 釘選、關掉、組合 |
| `HOTSPOT_MODEL_SHELF` | 字模櫃（右後方的銅模抽屜櫃） | 底模與 LoRA |
| `HOTSPOT_GALLERY` | 晾紙架（桌子上方掛著的校樣） | 作品冊與配方 |
| `HOTSPOT_COMPARE` | 對照燈台（左前方的燈箱） | A／B 實驗室 |
| `HOTSPOT_SETTINGS` | 印刷機（左後方，朱紅墨盤） | ComfyUI、路徑、工作流 |
| `HOTSPOT_MESSAGING` | 送件籃（右前方） | Telegram／Discord |
| `HOTSPOT_TRACE` | 放大鏡（手盒右邊） | 這個字為什麼被抽到 |

命名規則：可點擊的節點一律 `HOTSPOT_` 開頭、全大寫、底線分隔。
**其餘幾何一律不要用這個前綴** —— raycast 只對這些節點做，多一個就多一個誤點。

## 二、座標與單位

- 單位**公尺**，Y 軸向上（Blender 匯出時選 `+Y Up`）。
- 桌子中心在原點附近（x 往右、使用者站 **+Z** 側），桌面高 **0.92m**、約 3.8 × 2.0m。
- 匯出前 **Apply Transform**（位置、旋轉、縮放全部歸位）。沒 apply 的話
  `hotspots.js` 裡那組鏡位全部要重算。

## 三、幾何與效能預算

- 主場景 **≤ 250k triangles**、初始必要下載 **≤ 15MB**、貼圖原則上 **≤ 2K**。
- 重複的小東西（鉛字、隔板、抽屜、拉手）用 **InstancedMesh**：活字架一百多片隔板、
  手盒 24 顆鉛字、字模櫃 24 個抽屜各只花一個 draw call。
- 清掉看不見的背面、攝影機永遠到不了的地方。

## 四、燈光與陰影

- 視覺方向：**深夜的活版排字台**。一盞吊燈的暖光圈是整個畫面的情緒中心，
  四周沒入黑暗；材質壓低彩度，顏色交給光。朱紅只出現在墨盤、墨滾和綁繩上。
- 排字台的燈：hemisphere 0.55（essential）、吊燈 SpotLight 38（essential，**唯一投影的**）、
  後上方輪廓光 directional 0.7（ambience）、晾紙架與字模櫃補光 point ×2（ambience）、
  對照燈台內的小燈 point 0.9（accent）。
- **投影的燈用 SpotLight。** 一張陰影貼圖；PointLight 投影要畫六張。
- **陰影貼圖只畫一次。** 排字台上沒有會動的東西，外殼關掉 `shadowMap.autoUpdate`，只在畫質切換、
  WebGL context 還原時重畫。GLB 場景如果有會動的投影物件，要在它動的那一格設 `needsUpdate`。
- **強度是物理單位。** 這組數值配 `ACESFilmicToneMapping` ＋ `toneMappingExposure = 1.35`，
  換場景時要一起重調。
- **燈要標角色。** 每盞燈掛 `userData.role`（`essential` / `ambience` / `accent`），
  降級時才知道該關哪幾盞。沒標的一律當成 `essential`（不會被誤關）。

## 五、做這一版時踩過的坑（換 GLB 時仍然成立）

1. **手量的鏡位只對一個畫面比例成立。** 面板固定 560px 寬：1920 寬時蓋掉 29%，1280 寬時 44%。
   第一版在 1280×720 下八個器具全部有一截鑽到面板底下（手盒的右半截整個看不到）。
   `test_studio_scene.mjs` 在五種畫面下投影每個器具的每個頂點，必須整個落在可見區。
2. **鏡頭會被別的東西擋住。** 活字架第一版的鏡位從高處往下看，視線正好穿過吊燈的燈罩，
   畫面中間是一大塊黑色圓錐。`test_studio_scene.mjs` 會從每個相機往注視點射一條線，
   第一個碰到的必須是那個器具。
3. **注視點落在空隙裡。** 晾紙架的注視點第一版在兩張紙之間，視線什麼都沒碰到。
4. **貼在同一個高度會 z-fighting。** 活字架的鉛字平面第一版跟盒底木板同高，格子看起來全是空的。
5. **同一種東西在不同光線下要不同顏色。** 字架的鉛字在隔板陰影裡，底色要亮；手盒在吊燈
   正下方，同樣的顏色會被洗成白方塊 —— 深底亮字才讀得到。
6. **色彩管線與環境反射比幾何重要。** ACES ＋ sRGB 輸出，`scene.environment` 給一張漸層 PMREM
   （`room-kit.js` 的 `studioEnvironment`）。沒有環境貼圖的 PBR 金屬會像塑膠。

## 六、壓縮

支援但**非必要**，而且都是「有就用、沒有就算了」：

- **Meshopt**：已 vendor 解碼器，可直接使用。
- **Draco**：`scene-loader.js` 會去 `scene/draco/` 找解碼器（現在是空的）。
  抓不到解碼器時會退回未壓縮路徑，不會整頁卡住。
- **KTX2/Basis**：loader 已 vendor，同樣是可選。

## 七、換模型之後要做的事

1. `scene.json`：`"glb": true`。
2. 開瀏覽器主控台，看有沒有「這些 hotspot 在場景裡找不到對應節點」的警告。
3. **重新量鏡位**。`web/studio/hotspots.js` 的 `cameraPosition` 與 `lookAtTarget` 是照排字台
   的器具位置量出來的（包圍盒中心、器具佔半個視野 70–100%）。只要量「從哪個角度看」：
   面板會蓋掉右邊 560px（手機上是底下 62%），實際停的位置由 `framing.js` 依畫面算 ——
   器具太大就沿視線往後退、再平移到面板沒蓋到的那一塊中間。
4. `node scripts/test_studio.mjs`、`node scripts/test_studio_scene.mjs`。後者目前是對排字台驗的
   （在 Node 裡建出場景、對每個鏡位量包圍盒與視線）；換 GLB 之後要改成載入 GLB 再驗。
5. 量一次第八節那些數字。

## 八、要量的數字

```js
// 切到 3D 之後，在主控台貼這兩行
const vc = (await import("/studio/index.js")).getViewController();
await vc.metrics();   // { triangles, materials, textures, drawCalls, source, tier }
```

目前這一版（排字台，1280×720、high）：**46 draw calls**（舊房間 114）、44 個材質、10 張貼圖、
23,502 tris（InstancedMesh 的每份複本都算；`metrics()` 回報的 14,184 沒乘複本數）。
不進 3D 的話 three.js 和這些模組一個都不會下載。

## 九、授權

如果重用任何外部資產（模型、貼圖、HDRI），**必須先確認授權並在這裡保留聲明**。
目前狀態：

- **沒有使用任何第三方 3D 資產、貼圖或 HDRI。** 排字台、鉛字貼圖、校樣、環境光貼圖
  全部是這個專案自己用程式和 canvas 畫出來的。鉛字上的字用的是頁面已載入的字體
  （Chiron Sung HK，SIL OFL；抓不到時退回系統宋體）。
- three.js：MIT，見 `web/vendor/three/LICENSE`。
