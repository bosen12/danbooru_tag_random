# 3D 工作室場景：Blender → GLB 規範

**現在這個資料夾裡沒有模型。** 程式跑的是 `scene-loader.js` 用程式碼畫出來的替代房間
（圓角方塊和圓柱拼的：桌子、椅子、螢幕、檯燈、開放層架、作品牆、窗戶與夜景、
軟木板、幾樣桌面雜物），它的用途只有一個：讓運鏡、hotspot、面板接線、效能降級與 fallback
這些**真正的功能**現在就能跑、能測、能驗收。

那不是完成品，也不打算假裝是。要換成真的場景，把 `studio.glb` 放進這個資料夾，
然後把 `scene.json` 的 `"glb"` 改成 `true`。除了這兩件事以外，程式一行都不用改 ——
`camera-controller`、`hotspots`、`studio-bridge` 都不知道場景是哪裡來的。

---

## 一、必須存在的節點

GLB 裡這八個節點名**一個都不能少、不能改**。少了哪一個，那個功能點在畫面上就是
「點了沒反應」；`studio-shell.js` 會在主控台列出對不上的節點名，但畫面上不會報錯，
所以請以這張表為準。

| 節點名 | 對應的東西 | 建議量體 |
|---|---|---|
| `HOTSPOT_DRAW_SCREEN` | 主螢幕：抽取與 POS／NEG 結果 | 桌上主顯示器 |
| `HOTSPOT_TAG_BOX` | 桌面卡片盒：釘選、關掉、組合 | 桌左側的木盒 |
| `HOTSPOT_MODEL_SHELF` | 模型展示櫃：底模與 LoRA | 右側落地層架 |
| `HOTSPOT_GALLERY` | 牆上作品：收藏與配方 | 後牆掛畫／看板 |
| `HOTSPOT_COMPARE` | 桌面比較器：A／B 實驗室 | 桌上平板或雙聯框 |
| `HOTSPOT_SETTINGS` | 控制台：ComfyUI、路徑、工作流 | 桌上小型控制盒 |
| `HOTSPOT_MESSAGING` | 通訊裝置：Telegram／Discord | 桌上手機／對講機 |
| `HOTSPOT_TRACE` | 分析儀：抽取來源與淘汰原因 | 桌上儀器 |

命名規則：可點擊的節點一律 `HOTSPOT_` 開頭、全大寫、底線分隔。
**其餘幾何一律不要用這個前綴** —— raycast 只對這些節點做，多一個就多一個誤點。

## 二、座標與單位

- 單位**公尺**，Y 軸向上（Blender 匯出時選 `+Y Up`）。
- 房間中心在原點。桌子沿 **-Z** 牆面擺，使用者站 **+Z** 側。
- 匯出前 **Apply Transform**（位置、旋轉、縮放全部歸位）。沒 apply 的話
  `hotspots.js` 裡那組鏡位全部要重算。
- 場地大小以現在的替代房間為準：約 11m × 9m、牆高 3.4m、桌面高 0.78m。
  差太多的話鏡位要重新量（見第六節）。

## 三、幾何與效能預算

預算不是通過標準，是起點；實際以量到的數字為準（見第七節）。

- 主場景 **≤ 250k triangles**（目前替代房間 19,006 tris、56 材質、1 張程式生成的貼圖）。
- 初始必要下載 **≤ 15MB**。
- 靜態家具盡量**合併**成少數幾個 mesh；只有要點的東西保持獨立節點。
- 清掉看不見的背面、房間外的幾何、攝影機永遠到不了的地方。
- 材質數量控制在合理範圍；小物件用 atlas。
- 貼圖原則上 **≤ 2K**。

## 四、燈光與陰影

- 燈光、AO 和大部分陰影**盡量烘焙**進貼圖。即時燈是這個場景最貴的東西。
- 視覺方向：**半寫實的深夜 AI 創作工作室**。暖色桌燈、冷色螢幕光、受控的暗部層次。
  不是玩具房，也不是廉價霓虹賽博龐克。
- 替代房間的燈：1 個 hemisphere（0.65）、檯燈 point（46，**唯一投影的**）、
  螢幕 point（15）、窗外 directional（1.1）、畫燈 spot（26）、層板燈 point ×2（4.5）。
  真場景烘焙完之後即時燈應該可以再減。
- **強度是物理單位。** three r155 之後燈光用 candela／lux，舊教學上的數字會暗得多。
  這組數值是配 `ACESFilmicToneMapping` ＋ `toneMappingExposure = 1.35` 調出來的，
  換場景時要一起重調，不能只換模型。
- **燈要標角色。** 每盞燈掛 `userData.role`（`essential` / `ambience` / `accent`），
  降級時才知道該關哪幾盞。沒標的一律當成 `essential`（不會被誤關）。
  換 GLB 之後新增的燈記得補標，否則低畫質模式對它們沒有作用。
- **材質數就是 draw call 數。** 替代房間一開始有 57 個材質，只因為重複的東西
  （書、層板、卡片）在迴圈裡各自 new 了一個 —— 提到迴圈外共用之後降到 38，
  畫面完全沒變。GLB 也是同一件事：能共用的材質就共用。

## 四之二、這一版替代房間是怎麼變好看的

換 GLB 的時候這幾條仍然成立，值得先知道 —— 它們跟多邊形數無關：

1. **色彩管線比幾何重要。** `ACESFilmicToneMapping` ＋ `outputColorSpace = SRGBColorSpace`
   ＋ `toneMappingExposure`。沒有這三行，亮部會削平成死白、暗部糊成一團黑，
   那是「電腦畫的」最明顯的特徵。
2. **環境反射。** `scene.environment` 給一張漸層 PMREM 就夠（`room-kit.js` 的
   `studioEnvironment`）。沒有環境貼圖的 PBR 金屬會像塑膠。
3. **圓角。** 真實世界沒有完美銳角，邊緣那條細高光是眼睛判斷材質的主要線索。
   `room-kit.js` 的 `roundedBox()` 取代 `BoxGeometry`，三角形多幾倍但完全不痛。
4. **輝光用加法貼片，不用後製 bloom。** 只有兩個光源需要暈開，`EffectComposer`
   要多載檔案、多一個全螢幕 pass，不划算。注意貼片要放在發光面**後面** ——
   擋在前面看起來永遠是一顆燈泡。
5. **霧要很淡。** 相機離桌子只有 6 公尺，`FogExp2` 密度 0.085 會把整個畫面
   蒙上一層均勻的褐色；0.022 只在牆角看得出來，那才是要的。
6. **不要做實心的櫃子。** 第一版的層架是一個實心方塊，書和層板全部被封在裡面，
   畫面上只看到一根柱子。開放式框架（背板＋側板＋層板）才看得到東西。

## 五、壓縮

支援但**非必要**，而且都是「有就用、沒有就算了」：

- **Meshopt**：已 vendor 解碼器，可直接使用。
- **Draco**：`scene-loader.js` 會去 `scene/draco/` 找解碼器。
  那個資料夾現在是空的 —— 要用 Draco 請把 `draco_decoder.wasm` / `draco_wasm_wrapper.js`
  放進去。抓不到解碼器時會退回未壓縮路徑，不會整頁卡住。
- **KTX2/Basis**：loader 已 vendor，同樣是可選。

## 六、換模型之後要做的事

1. `scene.json`：`"glb": true`。
2. 開瀏覽器主控台，看有沒有「這些 hotspot 在場景裡找不到對應節點」的警告。
3. **重新量鏡位**。`web/studio/hotspots.js` 裡每個 hotspot 的 `cameraPosition` 與
   `lookAtTarget` 是照替代房間的家具位置定的，換了模型一定要重量，否則鏡頭會停在牆裡。
   量的方法：在 Blender 裡擺一台攝影機到你要的角度，把它的世界座標填進 `cameraPosition`，
   把它對著的那個物件的中心填進 `lookAtTarget`。
4. `node scripts/test_studio.mjs` —— 設定表的完整性（缺欄位、重名、相機與注視點重合）
   由它守著。
5. 量一次第七節那些數字。

## 七、要量的數字

`studio-shell.js` 有 `shell.metrics()`，在主控台裡：

```js
// 切到 3D 之後，在主控台貼這兩行
const vc = (await import("/studio/index.js")).getViewController();
vc.metrics();   // { triangles, materials, textures, drawCalls, source, tier }
```

要記錄的是：首次可操作時間、GLB 大小、triangles、draw calls、材質數、
貼圖記憶體、以及桌面一般鏡位的穩定 FPS。

目前這一版量到的（替代房間，1280×720、dpr 1）：

| 畫質 | 燈 | 陰影 | ms/frame | 約等於 |
|---|---:|---|---:|---:|
| high | 8 | 有 | 0.53 | 1870 fps |
| medium | 5 | 無 | 0.37 | 2670 fps |
| low | 3 | 無 | 0.29 | 3500 fps |

22,648 tris、114 draw calls、8 張貼圖、9 個著色器程式。
three.js 實際下載 **168 KB**（672 KB gzip 後）、studio 模組約 45 KB。
不進 3D 的話這些一個都不會下載。

**幾何不是瓶頸。** 22.6k 面、114 draw call 只花 0.53ms，所以不必為了 draw call
去合併靜態家具 —— 真正花錢的是即時燈和陰影，那才是降級該動的地方。
（上面那組數字是在一台桌機獨顯上量的；弱機器的絕對值會差很多，但三階之間的
相對差距是同一個道理。）

## 八、授權

如果重用任何外部資產（模型、貼圖、HDRI），**必須先確認授權並在這裡保留聲明**。
目前狀態：

- **沒有使用任何第三方 3D 資產、貼圖或 HDRI。** 替代房間、夜景、環境光貼圖
  全部是這個專案自己用程式和 canvas 畫出來的。
- three.js：MIT，見 `web/vendor/three/LICENSE`。

參考過的互動方向（**只看做法，沒有取用任何內容、品牌或作品**）：
`trevsm/3D-Portfolio`、`3d.boussettah.tech`。
