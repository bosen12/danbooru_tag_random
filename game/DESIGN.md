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
- 不在 `unguessable.json` 的黑名單裡

互斥同類直接讀 `indexLexicon()` 建好的 `lex.siblings`（`mutexSiblings()` 只是它的包裝），
所以 `quiz.js` 一個 import 都不需要——這讓它在 node 測試裡能直接跑，不必處理
`game/` 靠 server fallback 拿 `engine.js` 的路徑問題。

「三個互斥同類」這條規則順帶解決了非視覺 tag：`soft lighting` 根本不是詞庫裡的 tag
（`drawOne` 直接塞進每張圖的 `env`），`modern` 這類年代 tag 的 `mutex` 是 `null`，
兩者的同類數都是 0，自動出局。所以黑名單是安全閥，不是主力——出到爛題再往裡面加。

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

圖片固定 832×1216（直幅，人物構圖好看且比 1024² 快）。預抽深度 1 題——
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

沿用 `web/tokens.css` 的暗色印刷風，不另起一套色票或字體。
圖片佔畫面主體，候選盤在下方排成格狀，三條命用印刷符號表示。

## 不做

- 關卡制、每日挑戰、難度爬升曲線
- 打字輸入作答
- 圖片相似度評分
- 排行榜或任何連外服務

連勝制先跑起來，這些之後想加再說。
