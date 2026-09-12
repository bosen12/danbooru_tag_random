# 看圖猜 tag · 設計

排字匣的第五個版面，但不是工作臺，是遊戲。`drawOne()` 抽一組 tag 丟給 ComfyUI 生圖，
蔽掉其中三個 tag，玩家從十二個中文候選裡挖出來。三條命，答錯扣命，連勝記錄存在瀏覽器。

跟另外四個版面一樣掛在 `server.py` 上，只是換 `WEB_DIR` 跟 `PORT`。server 一行都不改。

## 為什麼是這個玩法

生圖延遲（本機 SDXL 約 5–20 秒）是這個遊戲最硬的限制，玩法必須繞著它設計。
「看圖猜 tag」能把延遲藏在答題時間裡——玩家在答第 N 題時，第 N+1 題已經在 Comfy 跑。
選它還有第二個理由：詞庫的 `mutex` 關係本來就是「互斥＝不可能同時成立」，
拿來當干擾項是現成的、保證正確的錯誤答案來源。出題品質的核心零件專案裡已經有了。

## 架構

```
game/
  index.html        畫面骨架
  game.css          只放遊戲特有樣式
  main.js           進入點：狀態機、DOM 綁定
  quiz.js           出題純函式
  queue.js          生圖佇列
  store.js          localStorage 存取
  unguessable.json  非視覺 tag 黑名單
start-game.bat      WEB_DIR=game  PORT=8791
```

`server.py` 的 `_static_dest()` 找不到 `WEB/rel` 時會退回 `SHARED/rel`（也就是 `web/`）。
所以 `game/` 不放 `engine.js`、`tokens.css`、`lexicon.json`，它們會自動從 `web/` 供應。
**不複製任何一份資料或邏輯**——詞庫跟抽牌規則之後改，遊戲跟著改。

三個模組各自有一件事，能單獨讀懂、單獨換掉：

| 模組 | 做什麼 | 介面 | 依賴 |
|---|---|---|---|
| `quiz.js` | 把一次抽牌結果變成一道題 | `makeQuestion(lex, draw, rand, banlist) → {answers, choices} \| null` | **零 import**。只吃 `indexLexicon()` 的產物，不碰 DOM、不碰網路 |
| `queue.js` | 維持背景有一題生好等著 | `start(settings)` / `next() → Promise<{draw, image}>` / `abort()` | 只有 `fetch`，不懂遊戲規則 |
| `main.js` | 狀態機與畫面 | — | 前兩者 |

## 一題的生命週期

1. `drawOne(lex, settings, pinned, banned, rand, seed)` → `{sections, positive, heat, era, seed}`
2. `makeQuestion()` 從 `sections` 挑三個答案 tag，各配三個干擾項，洗牌成十二個候選
3. 回 `null` 就**立刻重抽**，回到第 1 步。出題失敗必須在生圖前發現，否則白燒一次 GPU
4. `POST /api/gen`（`Accept: text/event-stream`），拿生成中的預覽圖當進度
5. 中文顯示（`labelOf()`），hover 出英文，跟主工具一致

### 答案資格

只從 `feature` / `pose` / `clothing` / `env` 四個 section 挑，三個答案落在三個不同 section。

`subject` 不當答案——它只有 13 個 tag，而且幾乎每張圖都是 `1girl` + `solo`，猜了是送分。
`quality` / `style` / `nsfwTail` 同樣不當答案，它們不是畫面內容。

一個 tag 要有資格當答案，必須：

- **至少有三個互斥同類**，且那些同類都不在這張圖抽中的 tag 裡
- 不在 `unguessable.json` 的黑名單裡。黑名單有兩層：`tags` 擋單一 tag，
  `groups` 擋整個 mutex 群組（用 `lex.mutexOf` 展開成 tag，所以其餘程式碼不用改）

互斥同類直接讀 `indexLexicon()` 建好的 `lex.siblings`（`mutexSiblings()` 只是它的包裝），
所以 `quiz.js` 一個 import 都不需要——這讓它在 node 測試裡能直接跑，不必處理
`game/` 靠 server fallback 拿 `engine.js` 的路徑問題。

「三個互斥同類」這條規則順帶解決了非視覺 tag：`soft lighting` 根本不是詞庫裡的 tag
（`drawOne` 直接塞進每張圖的 `env`），`modern` 這類年代 tag 的 `mutex` 是 `null`，
兩者的同類數都是 0，自動出局。

**為什麼黑名單要能擋群組。** 干擾項全部來自同一個 mutex 群，所以群組裡要是塞了一堆
近義詞，出來的題就是刁難而不是考驗。`day_night` 就是這種：六個成員裡
傍晚／日落／日出／黃昏都是同一種暖光，人眼分不出來。擋掉整個群組一行解決，
擋單一 tag 沒用——擋掉黃昏，下次就換傍晚當答案、黃昏當干擾項。

其他常出題的群組實測都很健康：`hair_color`、`eye_color`、`body_pose`、`place`、
`camera`、`top` / `bottom` / `onepiece` 的成員視覺上都分得開。`expression`、
`breast_size`、`hair_length` 是漸層型（微笑 vs 淺笑），先留著，打到覺得煩再加進 `groups`。

三個答案彼此不能有 `implies` / `bind` 關係，否則等於送分或重複。

### 干擾項

三個干擾項**全部**取自該答案的 `mutexSiblings`。互斥代表不可能跟答案同時成立，
所以每一個都是保證錯的，不需要「同 section 隨機補」這條後備路徑。

實測 300 次真實抽牌，每一次都有至少三個 section 湊得出合格答案
（平均可選數：`feature` 4.7、`pose` 4.9、`clothing` 3.6、`env` 2.2）。
所以 `null` 是安全閥而不是常態。真的湊不滿就回 `null`，佇列丟掉重抽，玩家不會察覺。

最後一道檢查：任何干擾項都不能跟**任一個**答案有關聯。
`mutexSiblings` 已經保證它跟自己那個答案無關，但跨答案的碰撞要另外擋，
撞到就整題作廢回 `null`。

## 判定與計分

即時翻牌：點一個候選馬上判定。對的變綠釘住，錯的變紅並扣一條命。
三個全中 → 進下一題。三條命歸零 → 結束。

兩個數字：**分數**是本局答對的 tag 總數（每格 +1），**連勝**是連續零失誤的圖數。
按「跳過這題」會把連勝歸零，但不扣命也不扣分。

結束畫面攤開完整正解（中英對照）與整串 `positive`，可一鍵複製丟回排字匣。
最高分、最長連勝、heat 偏好存 `localStorage`。

## 設定

開場一排按鈕選 heat（`tease` / `flash` / `sex` / `mixed`），預設 `mixed`，跟主工具的
`heatPreset` 同一套語彙。其餘抽牌設定用 `defaultSettings()`，不另開介面。

圖片固定 **1024×1024**。方形是 SDXL 的原生尺寸，也是 `lexicon.json` 的 `defaults`。
而且在寬螢幕上 `object-fit: cover` 露得比直幅多——832×1216 只看得到 43%，方形是 62.5%，
像素量卻幾乎一樣（101 萬 vs 105 萬），不會變慢。預抽深度 1 題——
Comfy 負擔最低，同時開排字匣生圖也不會互相搶。

## 錯誤處理

| 狀況 | 行為 |
|---|---|
| ComfyUI 沒開 | 開場 `/api/ping` 擋下，顯示連不上的網址，不進遊戲 |
| 生圖失敗或逾時 | 該題丟掉重抽，**不扣命**——不是玩家的錯 |
| `makeQuestion` 回 `null` | 生圖前就發生，佇列靜默重抽，玩家完全無感 |
| 圖生得比答題慢 | 顯示 SSE 預覽圖當進度，可按「跳過這題」：不扣命不扣分，但連勝歸零 |

## 測試

新增 `scripts/test_quiz.mjs`，掛進 `test.bat` 的 node 段。餵真實 lexicon 跑幾百次出題，斷言：

- 正解恰三個、候選恰十二個
- 每個正解都在該圖實際抽中的 tag 裡，且分屬三個不同 section
- 沒有任何干擾項出現在該圖抽中的 tag 裡（那會變成第二個正解）
- 沒有任何干擾項跟任一正解有 `implies` / `bind` 關聯
- 正解彼此無 `implies` / `bind` 關聯
- 正解都不在黑名單裡，且 `soft lighting` 永遠不會被選為正解或干擾項
- 同一顆 seed 出的題完全一樣（洗牌吃 `rand`，不吃 `Math.random`）

純函式不碰 Comfy，秒跑完。Comfy 整合、SSE 預覽、佇列時序靠手動開一局確認。

## 視覺

**這是暗房，不是工作臺。** 所以它不沿用 `web/tokens.css` 的**值**——沿用就等於長得跟另外四間一樣，
而這是第五間，是遊戲。`game/tokens.css` 自己定一套，但**沿用 `--color-*` / `--font-*` /
`--space-*` / `--text-*` 的命名慣例**，這樣同一個 repo 只有一套命名法。

色票從暗房的物理推出來：安全燈是琥珀色（`--color-accent: oklch(64% 0.17 48)`），
相紙基底是冷的（`--color-paper: oklch(9% 0.01 40)`）。安全燈當成真的光源畫在牆上，
不只是拿來描邊。

每個顏色的對比度都實測過（canvas 取 sRGB，白對黑 21:1 校準）並註在 token 旁邊：
`--color-neutral` 5.71:1、`--color-muted` 8.35:1、`--color-ink` 18.99:1、
`--color-accent` 5.76:1、focus ring 5.76:1。小字與控件全部 ≥ 4.5:1。

Hallmark 章在 `game.css` 第一行：macrostructure **Photographic**（單一大圖主宰畫面、
文字是小註記、先說看再說讀），genre **atmospheric**。Genre 要宣告出來才有意義——
安全燈光暈佔畫布約 20–25%，這在 editorial 預設下超標，在 atmospheric 是明文允許的。

**對錯不用紅綠燈。** 答對是「定影」：字燒到純白、變銳，飛到照片邊上成為釘住的註記。
答錯是「起霧」：字糊掉、灰掉、退場。紅綠燈是電玩語彙，顯影跟起霧是這間房自己的。
命也不是愛心，是**三張相紙**——印壞一張就少一張。

### 招牌

「猜字棚」直排，靠左，琥珀色細線收邊。另外四間叫暗房、活字樓、抽籤棚，這裡也是一間店。
中文標題沒有網頁字型可用（不為本機工具載幾 MB 的中文字），所以個性要靠排法給，不是靠字體。

Bodoni Moda 只出現在兩個時刻：結束畫面的大分數，跟答案列的英文 tag。
高反差的 didone 對應的是相紙本身的高反差。DM Mono 管所有數字與標籤。

### 簽名動作：顯影

ComfyUI 的 SSE `preview` 事件送的是逐步去噪的中間幀——那就是相紙在顯影盤裡浮現。
一個 `--dev` 變數（0 = 霧，1 = 定影）同時驅動 `blur`、`saturate`、`contrast`、
`brightness`、`opacity` 跟一點點 `scale`。現生的那張跟著真實生成進度走，
預抽好的重播一次同樣的補間，所以每一張的登場方式都一致。

補間由 `main.js` 的 rAF 驅動，不是 CSS transition——Chromium 不會替自訂屬性建立
transition，宣告了也不會跑（實測 `getAnimations()` 回空陣列）。

rAF 在沒發畫格的分頁裡會被餓死，相紙就會永遠停在霧裡、那一局報廢，
所以 `rampDev` 帶一條保險絲：`ms + 140` 之後無論如何直接定影。寧可沒有補間，不能卡住。

### 台面式版面：整張圖，而且不遮

`object-fit: contain`，**整張相紙都看得到，不裁**。相紙是 1024² 的正方形，
所以它在畫面上也是正方形：邊長 `min(100dvh - gut*2, 56vw)`，擺在左邊。
右邊那片被安全燈照到的牆就是記事欄——HUD、已定影的答案、候選字全寫在牆上。

這件事有前後因果：一旦決定「整張圖」，候選字就不能再浮在相紙下緣，
因為正方形相紙會填滿整個高度，字一定壓到圖。所以字得搬到相紙外面去。
搬出去之後，原本用來讓字站得住的**離焦帶就整層刪掉了**——
`backdrop-filter` 是在解決「字壓在亮部上」的問題，而那個問題已經不存在。

好處不只是看得到全圖：相紙有了自己的邊（一條髮絲線加一點落影），
它變成一張擺在檯面上的紙，而不是一個滿版的網頁背景。結束畫面也跟著變好——
答案列在還看得見的照片旁邊，你能一邊看圖一邊讀自己漏掉了什麼。

窄螢幕（≤900px）改成上下堆疊：相紙置頂置中，記事欄在下面。

### 候選字不是按鈕

沒有框、沒有底色，就是寫在牆上的字。答對的留在原位、只剩一道琥珀底線，
本體升到上面的記事欄——所以你看得出哪個字去了哪裡。

英文 tag 原本只掛在 `title` 上，**觸控裝置永遠拿不到**。現在中英都進 `aria-label`，
粗指標裝置（`@media (pointer: coarse)`）直接把英文寫在中文下面一行。

答錯的**離焦但仍讀得出來**（`blur(1.6px)`）。一開始糊到 3.5px，
結果玩家不知道自己排除過什麼——那是把氣氛做在玩家需求前面。

動態預算只花在顯影一個地方。放大機掃光、Ken Burns 推鏡都砍掉了——
尤其是推鏡：這遊戲的核心是把照片看仔細，畫面就必須靜止。

進場一律**只有淡入，沒有位移**。atmospheric 明文規定 fade-in only，
而原本 `choice-in` 跟 `rise` 都帶 `translateY`——宣告 genre 之後才抓到。
每個動態都有 `prefers-reduced-motion` 退路，包含相紙圖示的傾倒跟曝光鈕的底線延展。

### 一個回合只准有一件排定中的事

`pick()` 會排定後續動作：答對第三個排 `nextRound`，答錯第三次排 `finish`。
兩者都用 `setTimeout` 的話，快手玩家能讓它們**同時排定**——
結束畫面先出現（560ms），接著 `nextRound`（900ms）才跑，
把 `is-spent` 拿掉並開始顯影下一張，結束畫面背後的照片就換了。

所以排定動作統一走 `later()`，只有一個計時器槽位，後到的覆蓋先到的（死亡優先）；
`run.done` 再把 `pick` / `skip` / `nextRound` 一起關掉。

## 不做

- 關卡制、每日挑戰、難度爬升曲線
- 打字輸入作答
- 圖片相似度評分
- 排行榜或任何連外服務

連勝制先跑起來，這些之後想加再說。
