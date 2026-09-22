# drawOne 階段進度／可取消 — UI 掛點草稿（web only）

對齊：`2026-09-22-draw-stage-boundaries.md` §1／§2／§6；群聊契約（中間 POS 不進畫面、`drawOne` 殼不動、只動 `web`）。

**狀態**：草稿。等 A 索引基線綠、引擎在段邊界露出回呼後，再改 `web/boot.js`。**本檔不改 `engine.js`。**

## 目標

單輪 `drawOne` 目前 median ~12 ms，批次 `n>1` 時主執行緒仍會連卡。UI 需要：

1. 階段進度（不暴露半套 POS／`used`）
2. 可取消（與現有 `aborting`／Comfy 取消銜接）
3. 最終才吃 `diagnostics` 警告（pin 衝突、mustDraw shortfall）

## 允許的 yield 停點

| 停點 | 引擎狀態 | UI 可顯示 | UI 禁止 |
|---|---|---|---|
| §1 結束 | Intent 已凍 | `stage: "intent"` + 可選 cast／heat／era 標籤（來自 Intent，非 POS） | 任何 tag 列表、`positive`、半套 `used` |
| §2 結束 | Composition 完成、fill 未開始 | `stage: "composition"` + 可選粗粒度 slot（water／bath／faceless 布林） | camera／place／activity 的具體 tag、任何 POS 片段 |
| §3–§5 | fill／validate 進行中 | 不 yield；或僅 `stage: "fill"` 無 payload | 同上 |
| 回傳後 | 完整結果 | 既有卡片 POS + §6 diagnostics 警告 | — |

取消：使用者按「取消」→ 設 `aborting`。若引擎在 §1／§2 之間協作檢查 `signal.aborted`（或回呼回傳 `{ cancel: true }`），本輪可不進入 fill，**不**產生卡片。已送 Comfy 的張數仍走現有 `genAbort` 路徑。

## 建議回呼形狀（加在既有 `opts`，不改位置參數）

```ts
// drawOne(..., opts?: {
//   trace?, presetOwned?,
//   signal?: AbortSignal,           // 可選；§1／§2 邊界檢查
//   onStage?: (e: DrawStageEvent) => void | { cancel?: boolean }
// })

type DrawStageEvent =
  | { stage: "intent"; intent: Pick<Intent, "rating" | "heat" | "era" | "cast" | "pinConflicts"> }
  | { stage: "composition"; plan: Pick<CompositionPlan, "cameraProfile" | "sceneSlots" | "fallbacks"> }
  | { stage: "done" };  // 可選；boot 也可用回傳值本身當 done
```

約束：

- `onStage` **不得**帶 `used`／`positive`／候選列表。
- 回呼若同步丟例外，引擎應視同取消並清理，不留下半張卡。
- 無 `onStage`／無 `signal` 時行為與今日同步 `drawOne` 相同（相容測試與 CLI）。

## boot.js 接法（預計）

現況：`runBatch` 內同步呼叫 `drawOne`，再 `placeCard`。改動限定 `web/boot.js`：

1. `speak`／status：在 §1／§2 回呼更新「整理規則…／安排構圖…／抽詞中…」，**不**改 results DOM。
2. `aborting === true` 時，`onStage` 回 `{ cancel: true }`；本輪不 `placeCard`。
3. 最終結果才 `paintCardWarn`／mustDraw shortfall（吃 `diagnostics`，缺欄則維持舊 `mustReport`／`conflicts`）。
4. 不改 `web1`／`web2`／`web3`。

## 非目標

- 不把 `drawOne` 改成必選 async。
- 不在 UI 預覽 Composition 選定的具體 tag。
- 不在此稿實作 M 索引或動語意。

## 對齊檢查（給 H）

- [ ] yield 只出現在 §1／§2 結束
- [ ] 事件 payload 無 `used`／`positive`
- [ ] 無 opts 時金標／既有測試位元相容
- [ ] 取消不留下半成品卡；`running`／`aria-busy` 仍由 `finishBatch` 收尾
