# Progress Log

## Session: 2026-09-13 (sports consistency consensus)

- 讀取 Claude 對 `ab56d84` 的完整複核；六項技術問題取得共識。
- 接受 P1 與 P2 範圍，但否決從舊完整 kit 推定 preset ownership；改採不刪資料的 null migration。
- 新增 design 與 TDD implementation plan；Phase 17 開始，尚未改 production code。
- Task 1 紅燈確認：新增三個 ski slope 回歸測試，實際為 176/300 洩漏。
- 錯誤：PowerShell 直接以引號包 Python 完整路徑會被當成字串；改用 call operator `&` 執行。
- 清除不存在的 `ski slope`；滑雪改用 `mountain`，重新生成 1198-tag lexicon。
- 顯式 `SPORT_TAG_SCOPE`／`SPORT_VENUES`，一般活動與通用裝備保持 neutral；場地相容表同源產生 `SPORT_ACT_PLACE`。
- 新增 `presetOwned`：只刪本次 preset 真正新增的 tag；舊存檔不猜來源，避免誤刪手動釘選。
- 拳擊手套會擋需要裸手／手指的自動動作，器材道具不算佔手；明確衝突 pin 保留並顯示警告。
- 排球／羽球／桌球固定 `school gym`；`sports court` 不再 implies outdoors，`fitness gym` 不再自動當運動場地。
- 新增儲存式「動作也必進」開關（預設關），README 同步更新。
- Claude 完成 verifier 純函式與 73 項測試；`allSportTags()` 覆蓋完整 inventory，`--max-created` 僅警告。
- 錯誤：同一個 `apply_patch` 內重複指定 `web/boot.js` 會被拒絕；合併成單一 Update File 後套用。
- 第一次完整 engine 測試：新運動／ownership／hand-use 測試皆過；發現非釘選拳擊手套會讓既有單人 sex 保證失效，已限制它不在 sex 場景自動抽入。拳擊 preset 的 sex 頻率門檻依新手部限制調整，待重跑。

## Session: 2026-09-13 (Codex handoff: validate + optimize)

- 使用者將後續驗證與優化交給 Codex。
- 已恢復 task_plan/findings/progress 與檢查 dirty worktree；保留既有 Grok／使用者變更。
- session-catchup 初次嘗試：`python` 不在 PATH，`py -3` 亦未登錄 runtime；後續由 workspace dependencies 找到 bundled Python 3.12.14。
- 最新三方方向：r42 裁決 hard 16/400（4.0%）；下一步 support shadow validator，通過量測才 enforcement。
- 尚未改 production code。

## Session: 2026-09-13 (support shadow completed)

- 新增 `validate_gold.mjs`：驗 raw/gold 對齊、必填欄位、重複 id/seed；r42 結果 400 rows、mismatch 0。
- gold 一致性修正：#378/#389 對齊 #181 的 normal solo eating-prone hard；最終 hard 18/400（4.5%）、soft 11。
- 新增純 `shadow-validator.js` 與 `eval_shadow.mjs`；support precision 1.0、coverage 7/18、soft FP 0。
- `drawOne()` 新增 `shadowViolations`，固定 seed 42 的 positive byte-identical。
- 用共享 candidate gate 取代舊 eating/cooking 無條件封鎖；normal 單人 hard、weird soft、多人 same_actor skip、fully pinned warning 都有測試。
- 驗證：`test_engine.mjs`、三個新增 Node test、gold validator/evaluator、`node --check`、`git diff --check` 全部通過。
- bundled Python 路徑：`C:\Users\boshe\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe`（3.12.14）；`scripts/test_server.py` 已執行並以 exit 0、最終 `ok` 通過。

## Session: 2026-09-11 (ckpt settings + weight popover)

- Phase 14: 選 LoRA 旁「設定」開 illurtrious 底模雙欄面板，可跳 LoRA Manager
- 權重：拿掉滾輪／hover ±；點數字開 popover（±、0.6–1.5、恢復 1.0）
- clampTagWeight TDD 綠；swimming 暗示 standing 的 leftover 已擋
- test_engine / test_server 綠
- /api/checkpoints 列出 7 顆；preview 200
- 無瀏覽器 MCP：用 curl 驗靜態 JS／API
- 生圖中 hover 預覽右上叉叉可跳過這張並接著下一張（不取消整批）
- r23 400 抽 seed 1020000，20 agent × 20 完成；raw ~8%，核實 ~6%
- 共識已 TDD 修（HOF 眼睛、jogging×standing、sleeping×gaze、ski×sex group…）test_engine 綠

## Session: 2026-09-11 (sceneMode + r5)

- r5: floating vs planted, games vs all fours, dancing vs yoga
- sceneMode: normal / diverse / weird (default normal)
- 正常：不抽男人人種、職業對地點、性愛偏私密
- 多元：場景＋物理
- 奇葩：只物理
- r1 三模式稽核：夜＋日光浴、陽光＋星空、開車＋TDBU、睡覺洗身體、煮飯無廚房
- 已修並重抽 r2 18 agent

## Test Results
| Test | Status |
|------|--------|
| test_engine.mjs | pass |
| test_server.py | pass |
| UI chips in web/index.html | served 200 |

## Session: 2026-09-12 (perfect draw logic)

- User: 最完美的抽取 tag 邏輯；r40 停點作廢，繼續修剩餘 ~5%
- Root: clothing fill 在 place 之前；sceneClothLocked 只看 pinned 且只在正常模式
- Plan: used 場景剝錯衣（釘選衣服保留）、煮飯強制 kitchen、水中剝鎧甲／西裝、sex heat 允許廚房
- Next: TDD 紅燈 → 改引擎 → r41 稽核

## Session: 2026-09-12 (perfect draw logic)

- sceneClothLocked 改看 used、lockScene（正常＋多元）；釘選衝突衣不剝
- 水中／浴場剝鎧甲西裝；剝完可補合身衣；錯的 clothes_action 會丟掉並補 flash／solo sex
- cooking：未釘 place 可換成 kitchen（kitchen 仍 modern/victorian）；sex heat 廚房算私密
- breasts on table：擋 imply outdoors 的活動；無室內則強制 indoors
- test_engine 全綠
- 已抽 r41 seed 2900000；20 agent × 20 審核中

## r41
- Agent HARD 63/400（灌水：多元 leftover 家具、釘選公共場所＋sex）
- 核實 HARD 15/400 = 3.8%
- 已修：DRY_NO_WATER 物理（飛機／教堂／球場）、騎馬室內、比基尼插手袋、BOTH_ARMS×fingering、skiing→sport 剝女僕、dojo 剝球衣、prison 剝兔／偶像、cabin 剝啦啦隊、orphan frying pan、睡覺不進城市
- test_engine 全綠

## Deep inspect 2026-09-12
- 釣魚被當成 WATER_ACT 剝靴：已排除 fishing
- 睡覺是 body_pose 不是 activity：正常模式限制 SLEEP_PLACE
- 開車無 scene kind：drive 剝泳裝
- 煮飯×坐腿上（imply sitting 繞 allow）
- 釘選衝突不再關掉整段場景鎖；implied 衣（micro bikini→bikini）不剝
- 活動 refill 後再 stampActProps；水中剝衣清 mutexTaken
- test_engine 全綠

## Next
可選 r42 稽核。
