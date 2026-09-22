# drawOne 五段邊界 I/O 與衝突圖分類

對齊：`2026-09-19-tag-draw-optimization-design.md`、群聊契約（分級牆 > pin 權威 > mustDraw > 隨機填）。
用途：模組切開掛點、不變式單測、A 的索引輸入、J 的 yield 停點。**不改 `drawOne()` 對外簽名。**

## 0. 衝突圖兩類（給 A 量測／索引）

| 類 | 定義 | 例子 | 索引策略 |
|---|---|---|---|
| **M（mutex-indexable）** | 只看候選自身 metadata + 已佔 mutex 格；與 `used` 順序無關；`if (…) return false` 無副作用 | `extraMutex`／`mutexTaken`、heat／era／gate／rating 對單 tag | 可預建：`tag → mutex groups`、`group → occupant`；O(1) 查 |
| **S（semantic / order-sensitive）** | 依賴 `used` 現況或多 tag 關係；單向規則會隨先進誰變結果 | place↔act、faceless↔face、sport venue、supportCandidate、sex phase、clothing layer | **不准**塞進 mutex 掃描；必須留在 Candidate eval／Final validation；優化只能快，不能改語意 |

量測報告請分開記：單輪 ms 內 M 類拒絕次數／耗時、S 類拒絕次數／耗時、`allow()` 呼叫次數。

### M 衝突圖產物（給 A 建索引）

機器可讀輸出：`docs/superpowers/specs/2026-09-22-m-conflict-graph.json`

- `tagToGroups` / `groupToTags`：與 `extraMutex()` + lexicon `mutex`/`mutexExtra` 一致（含引擎硬編碼衍生組）
- `tagToSiblings`：同組衝突鄰接，已排除 bind/implies 相關與 parentChild（與 `indexLexicon` 相同）
- **不含** S 類語意 guard；索引只准吃本檔


既有 `REASONS`（`web/trace.js`）對應：
- M：`mutex`、`extra_mutex`、`heat_mismatch`、`era_mismatch`、`cast_mismatch`、`rating_mismatch`、`user_ban`
- S：`pose_activity_conflict`、`scene_activity_conflict`、`sport_place_mismatch`、`clothing_layer`、`underwear_hidden`、`missing_dependency`
- 後段仲裁（非候選過濾）：`reconcile`、`repair_remove`、`replaced`

診斷新增欄位（可選、不破壞舊呼叫端）：見 §6。

## 1. Intent normalization

**進**
```ts
{
  settings,          // rating, heats, eras, castWeights, counts, sceneMode, mustDraw, …
  pinned: Set<string>,
  userBanned: Set<string>,
  seed, rand,
  opts?: { presetOwned?, trace?, debugTrace? }
}
```

**出（不可變 Intent）**
```ts
{
  rating, sfw,                       // ratingOf；sfw ⇒ 分級牆生效
  requestedPins,                     // 原始釘選（UI 狀態保留用）
  activePins,                        // 過牆後本輪可進 POS 的 pin（sfw 下被擋的不在此）
  ratingSuppressedPins,              // requested − active；僅診斷
  banned,                            // userBanned ∪ autoBan(from activePins)
  heat, era,                         // chooseHeat / chooseEra（可受 pinContext）
  cast: { female, male, people, tags },
  mustWants: Array<{ key, section, group, want }>,
  quotas: Record<section, number>,   // QUOTA_SECTIONS
  sceneMode,
  pinConflicts: Array<{ a, b, reason }>,  // 互斥／矛盾 pin：不靜默選邊
  seed
}
```

**段邊界不變式（可單測）**
- `sfw` 時：`activePins` 內無 `ratingBlocked` tag；`ratingSuppressedPins` ⊆ `requestedPins`。
- `activePins` 內 mutex 衝突 → 必須進 `pinConflicts`，不得只留一邊。
- `banned` 含 mutex auto-ban，但 pin 權威 tag 本身不被自己 ban 掉。

**J yield**：允許停在此段結束（Intent 已凍、尚未 composition）。UI 只顯示階段進度，不暴露 POS。

## 2. Composition planning

**進**：Intent（唯讀）+ `rand`

**出（CompositionPlan）**
```ts
{
  cameraProfile: "normal" | "faceless" | null,  // 低機率；失敗可回退
  sceneSlots: {                // 高影響預約，非完整 solver
    water?: boolean,
    bath?: boolean,
    placeFamily?: string,
    activityFamily?: string,
    job?: string | null
  },
  reserved: {                  // pin／mustDraw 已佔名額
    mutexGroups: Map<string, string>,  // group → tag
    sections: Record<string, number>
  },
  fallbacks: string[]          // 例如 "cameraProfile→normal"
}
```

**不變式**
- plan 不得寫入最終 `positive`；只約束後段候選。
- 若 profile 無法滿足 heat 核心契約 → 必須回退並記 `fallbacks`，不犧牲 flash／solo-sex 等核心。
- pin／mustDraw 已佔 mutex → `reserved.mutexGroups` 已反映；後段 fill 不得覆蓋 pin。

**J yield**：允許停在此段結束（Composition 完成、Section fill 未開始）。仍無 POS 給 UI。

## 3. Candidate evaluation

**進**：Intent + CompositionPlan + 當前 `used`（fill 過程中遞增）

**出（每次詢問）**
```ts
// 正式路徑可維持 boolean；測試／診斷模式：
{ ok: boolean, reason?: ReasonCode, related?: string[] }
```

ReasonCode ⊆ 現有 `REASONS` ∪ 未來擴充；M／S 分類見 §0。

**不變式**
- M 類判斷不得讀「非 mutex 的 used 語意」。
- S 類不得被「預過濾成空池」偽裝成 M（避免分布被靜默改寫）。
- `forcePin`／mustDraw 路徑：除分級牆外，不得因 soft S 刪除合法 pin。

## 4. Section fill

**進**：Intent + CompositionPlan + `commit`／`allow`

**出（FillState）**
```ts
{
  used: Set<string>,
  tagSources: Map<string, SourceCode>,  // pin | must_draw | random | implies | bind | …
  mustLocked: Set<string>,
  mutexTaken: Map<string, string>,
  female, male, people
}
```

**不變式**
- root 選中 vs implication：`tagSources` 必須可區分；audit 不得把 implies 算成 root 可達。
- mustDraw shortfall：不跨 hard constraint 硬塞；差額進 §6 diagnostics。
- 本段可呼叫 repair，但不得把一般候選錯誤留到 reconcile 再刪補迴圈。

## 5. Final validation

**進**：FillState + Intent

**出**：現有 `drawOne` 回傳形狀（對外不變）+ 可選 diagnostics
```ts
{
  // 既有
  heat, era, female, male, people, seed,
  mustReport, sections, positive,
  shadowViolations, conflicts, eraClash, heatClash, trace?,
  // 可選擴充（呼叫端忽略即相容）
  diagnostics?: DrawDiagnostics
}
```

**不變式**
- `reconcile()` 只處理「必須看完整集合」的不變式；不得重新承擔 Candidate eval 的日常拒絕。
- 最終 `positive`：sfw 無 rating 違規；`activePins`（未被硬衝突標記者）皆在 POS 或已進 `conflicts`／警告，不得靜默消失。
- `mustReport`：`got < want` 時原因可追溯（主要 `REASONS`）。

## 6. DrawDiagnostics（給 UI／測試）

```ts
{
  ratingSuppressedPins: string[],
  pinConflicts: Array<{ a, b, reason }>,
  mustShortfalls: Array<{ key, want, got, primaryReason? }>,
  compositionFallbacks: string[],
  rejectTallies?: { M: Record<string, number>, S: Record<string, number> }  // 量測用
}
```

J：只在最終結果吃 shortfall／pin 衝突警告；階段 UI 不讀半套 `used`。

## 7. 段邊界測試掛點（給 H）

| 邊界 | 紅／綠不必比整串 POS | 建議鉤子 |
|---|---|---|
| Intent 出 | 分級牆、pinConflicts、banned 閉包 | `normalizeIntent` 純函式單測 |
| Composition 出 | reserved 含 pin mutex；非法 profile 必 fallback | plan fixture + mutation |
| Candidate | 同 used 快照下 reason 穩定；M／S 分類 | `allow` 診斷模式 |
| Fill 出 | root vs implies；mustLocked ⊆ used 或 shortfall | tagSources + mustReport |
| Final | hard invariant／shadow；reconcile 刪除數上限 | 既有 `audit_draw_invariants` + 刪補計數 |

## 8. 本輪不做

- 不引入通用 constraint solver。
- 不改 `drawOne(lex, settings, pinned, userBanned, rand, seed, opts)` 參數與既有回傳欄位語意。
- 不把 S 類 guard 合併進 mutex 索引「圖便宜」。
