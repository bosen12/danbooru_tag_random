# Tag 抽取邏輯深度優化設計

## 背景

目前 `drawOne()` 已有大量有價值的領域規則，但選取、情境限制、補救與最終清理分散在同一條約 6,500 行的流程中。許多規則依賴「哪個 tag 先進入 `used`」，因此局部修正可能讓另一群合法候選失去機率。既有測試善於抓最終矛盾，卻沒有完整守住左側面板組合、pin/mustDraw 權威、root 可達性及分布多樣性。

本輪採「受控演進」，允許必要的 RNG 消耗與 POS 改變；品質由可重播的不變式、合法情境可達性、釘選契約與多樣性指標判定，不要求相同 seed 的 POS 字串完全不變。

## 目標

- 左側 cast、heat、era、drawJob、sceneMode、section counts、mustDraw、pin、ban、weights 與 preset 的合法組合都能產生語意一致且有變化的 POS。
- 明確 pin 是使用者權威；除了分級安全牆，合法 pin 不得被靜默刪除。
- 讓合法的低頻 tag 保有可測的非零機率，並區分自動可抽、只供釘選與只由相依關係帶入的 tag。
- 先修正已證實的死 tag／錯誤分類，再針對 camera、活動、服裝、場景的順序耦合做小步結構改善。
- 讓新增 tag 必須通過 Danbooru 身分、模型時代相容性、中文標籤、生成流程及合法情境可達性驗證。

## 非目標

- 不全面重寫成通用 constraint solver。
- 不改變前端儲存格式、既有 preset 格式或 `drawOne()` 公開介面。
- 不以增加 tag 數量本身當成成功；沒有可靠模型相容性證據的 tag 不加入。
- 不承諾邏輯上互相矛盾的多重 pin 能同時形成合理畫面；這類組合必須保留使用者輸入並回報衝突。

## 核心契約

### Pin 與分級

- explicit 模式下，單一合法 pin 在所有 sceneMode 中必須保留。
- general／sensitive 的分級安全牆高於 explicit pin；被分級擋下的 pin 保留在 UI 狀態中，但不得送進該次 POS。
- 互相矛盾的 explicit pins 不偷偷選邊；輸出診斷交由既有警告區呈現。
- mustDraw 低於 pin、高於一般隨機 fill；若因 hard constraints 無法達標，回報 shortfall 與原因，不塞入不相容 tag。

### 多樣性

- 每個可自動選取的 tag 必須在至少一個合法、可重播情境中被 root-selected，而不只是被 implication 帶入。
- `pin_only` 與 `dependency_only` 不列入自然可達性失敗，但必須有各自契約測試。
- 固定基線矩陣中，各 section 的 unique-tag count 與 Shannon entropy 不得無說明下降超過 10%；任何 family 歸零都直接失敗。
- soft weighting 可以調整分布，但不能把合法候選變成實質零機率。

## 架構

保留 `drawOne()` 對外介面，內部逐步整理成五個可單獨測試的階段：

1. **Intent normalization**：將 settings、pin、ban、mustDraw 與 preset 正規化成不可變的抽取意圖，決定 cast、heat、era 與使用者硬需求。
2. **Composition planning**：在大量 feature/pose fill 之前，先決定會強烈改變可用候選的構圖與情境，例如 faceless camera、水域、浴場、職業場所及主要活動。這不是完整 solver，只保留少數高影響決策與 slot reservation。
3. **Candidate evaluation**：候選判斷除了布林結果，能在測試／診斷模式回傳拒絕原因。先抽出本輪會碰到的 camera、活動、服裝、場景規則；不為重構而搬動所有既有條件。
4. **Section fill**：pin 與 mustDraw 先保留名額，依 composition 與 soft weights 填入 feature、clothing、pose、env。抽取仍使用相同 seeded RNG，結果可重播，但允許與舊版不同。
5. **Final validation**：`reconcile()` 僅處理必須看完整集合才能判斷的不變式。一般候選錯誤應在前段拒絕，不再依賴後段反覆刪除／重補。

## 第一批實際改善

### 已證實分類洞

- `beach umbrella` 與 `innertube` 從無 slot 的 clothing accessory 移到 env prop，並加入水域／岸邊 context。
- 定向測試必須先在舊分類下紅燈，再在合法 beach／pool 情境中達到非零命中；非水域情境必須為零。

### Camera profile

- `lower body`、`head out of frame` 保持可 pin。
- 自動抽取不直接把 camera fill 整段前移；composition planning 先以低機率選擇 faceless profile，再禁止需要臉、胸口或上肢的候選，最後填入對應 camera。
- 若 profile 無法滿足該 heat 的核心契約，例如 flash 無可用衣著動作或 solo-sex 無可用動作，取消 profile 並回退一般 camera，不犧牲核心內容。

### 可達性分類

- audit 明確區分 `auto`、`pin_only`、`dependency_only` 與 quality/tail，避免把刻意不可自然抽的 `shota`、cast umbrella 或 rating tail 報成引擎缺陷。
- root selection 與 final POS emission 分開統計；implication 命中不能冒充 root 可達。

### MustDraw 與診斷

- 記錄每個 mustDraw key 的要求數、實際數及主要拒絕原因。
- 不改既有存檔格式；診斷是 draw result 的可選欄位，前端只在 shortfall 或 pin 衝突時顯示簡短警告。

## Tag 新增原則

候選新 tag 必須同時符合：

1. 由 Danbooru 官方 API 確認現行 canonical tag、alias/deprecation 與非零使用量。
2. 能在專案目標模型的訓練時代成立；現行 Danbooru 新名稱若晚於模型訓練，保留模型較熟悉的舊名稱或不加入。
3. 有明確 section、group、mutex、era、heat、gate、context 與 selection policy。
4. 有繁中名稱，並能經 `merge_lexicon.py → add_zh.py → token_counts.py` 重建而不漂移。
5. 至少一個定向可達性測試，且刻意破壞分類或 context 時會失敗。

本輪不預設一定新增 tag；先修復現有詞庫與抽取機制。只有驗證後能填補明確語意缺口的詞才加入。

## 驗證設計

### 左側面板矩陣

固定 seed 掃描：

- sceneMode：normal／diverse／weird
- era：全部六個時代
- heat：activity／tease／flash／sex，以及 mixed
- cast：girl／boy／both
- drawJob：on／off
- counts：zero／default／max 三種 profile

矩陣檢查例外、空輸出、section shortfall、hard invariant、唯一 POS 比率、section unique count 與 entropy。zero counts 仍允許必要骨架，不把骨架誤判成 quota 失效。

### Pin 與 MustDraw

- 每個詞至少做單 pin 生存測試；依 tag metadata 選擇合法 rating、era、heat 與 cast。
- 對不同 section、context dependency、mutex、場景／活動與衣著／動作生成 pairwise pin cases。
- 明確測試 pin×sceneMode、pin×era、pin×heat、pin×mustDraw、presetOwned×手動 pin。
- 每個可見的 `section:group` mustDraw key 都必須在至少一個合法 context 被真正觸發；覆蓋不到即失敗。

### Mutation verification

重要測試要能證明不是假綠：

- 將 `beach umbrella` 暫時改回 clothing/mutex-null，定向可達性測試必須失敗。
- 暫時移除 camera profile 的 face/arm guard，hard invariant 測試必須失敗。
- 暫時繞過 pin protection，pin matrix 必須失敗。
- 暫時把一個 soft tier 權重設成零，family reachability／entropy gate 必須失敗。

mutation 在臨時副本或測試注入點執行，不污染工作樹。

### 完整驗證

- 先跑新增 deterministic tests，再跑現有 targeted tests、audit、完整 suite。
- 任何失敗先定位根因，不降低樣本數、閾值或規則強度來求綠燈。
- 生成檔依序使用 ComfyUI embedded Python 執行 `merge_lexicon.py`、`add_zh.py`、`token_counts.py`，之後確認生成檔 deterministic。
- 最終檢查 tracked diff、未追蹤使用者資料、完整測試結果與 commit SHA。

## 錯誤與回退策略

- composition profile 找不到合法組合：回退到一般 profile，保留核心 heat/cast/pin 契約。
- mustDraw 無法達標：保留合法結果並回報 shortfall，不跨越 hard constraint。
- pin 衝突：保留明確 pins 並回報；rating 安全牆是唯一可在該次輸出抑制 pin 的全域例外。
- 新增候選使任何 section 多樣性下降超過門檻：先撤回該候選或權重調整，再重新找根因。
- 結構調整若不能以 deterministic red/green 證明價值，就不合併該調整。

## 完成條件

- 已證實的死 tag／分類洞修復，且有正反向契約。
- faceless camera 至少在合法 profile 中非零可達，不破壞活動、flash、solo-sex 與 pin 契約。
- 左側面板矩陣、pin/mustDraw pairwise、mutation verification、現有完整 suite 全綠。
- 多樣性指標達標，沒有 family 歸零或無說明超過 10% 的 section 退化。
- 生成檔依指定順序重建並通過 deterministic diff 檢查。
- 不修改或提交 `.claude/`、其他 `.planning/`、`24h-review.md` 等使用者資料。
