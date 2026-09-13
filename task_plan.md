# Task Plan: 鎖定場景搭配 + 文意稽核迴圈

## Goal
抽取邏輯盡量完美：引擎自動抽的活動／地點／姿勢／衣著不互相打架。釘選可自相衝突。正常＝現實高機率；多元＝場景＋物理；奇葩＝只物理。

## Next Step
Phase 17：重跑完整測試、live Danbooru verifier、UI smoke，再做 pre-push review 與 commit/push。

## Current Phase
Phase 17

### Phase 17: 運動 preset 一致性與無矛盾修正
- [x] 無效／過新場地與完整 Danbooru inventory
- [x] 顯式 sport scope 與同源 venue compatibility
- [x] presetOwned 無損狀態流與舊存檔保守 migration
- [x] boxing gloves 手部佔用規則與 warning
- [x] 運動 activity 必進開關（預設關）
- [ ] 全套 Node/Python/live verifier 驗證
- **Status:** in_progress

### Phase 16: r42 金標驗證 + support shadow validator
- [x] 核對 r42 raw/gold：400 筆、POS 未改；一致性稽核將漏標的 #378/#389 對齊 #181，hard 18/400 = 4.5%
- [x] 寫 implementation plan（獨立 validator、無副作用、TDD）
- [x] 基線 `node scripts/test_engine.mjs` 通過（exit 0）
- [x] TDD 建 support shadow rules 與 pinned/mode/scope 行為
- [x] 接到 drawOne 回傳 diagnostics，seed 42 positive byte-identical
- [x] 用 r42_gold 評估：precision 1.0、coverage 7/18、soft FP 0
- [x] 用單一 candidate gate 取代舊 eating/cooking 無條件判斷；mode/scope/pinned 控制通過
- [x] 完整 `test_engine`、新增 Node audit tests 與 bundled Python 3.12.14 的 `test_server.py` 通過
- **Status:** done

### Phase 15: 最完美抽取邏輯（r40 後）
- [ ] TDD：水中鎧甲／西裝、煮飯必廚房（古中國／sex heat）、多元浴場錯衣、釘選服裝保留
- [ ] sceneClothLocked 改看 used、lockScene（正常＋多元）；釘選衝突衣則不剝
- [ ] cooking 強制 kitchen（換掉未釘的 place）；kitchen 進 PRIVATE_SEX_PLACE
- [ ] water / reconcile 剝 armor/suit；剝完可補場景合身衣服
- [ ] test_engine 綠後 r41 20×20
- **Status:** in_progress

### Phase 14: 底模設定 + 權重 UI + r23 稽核
- [x] 選 LoRA 旁「設定」開底模面板（illurtrious 資料夾、可跳 LoRA Manager）
- [x] 權重改 popover，拿掉滾輪誤觸
- [x] test_engine / test_server 綠
- [x] r23 20 agent × 20；共識已修
- **Status:** in_progress；下一輪 r24 再稽核

### Phase 13

### Phase 13: special_prompts 擴充 + 球場 + rape 約束 + agent 稽核
- [x] 詞庫：新地點／職業／活動／球場＋球＋球衣／rape 等
- [x] 引擎：JOB_PLACE、球場配球衣、rape 不進教室／家庭日常（正常）
- [x] 左側新釘選組合
- [x] test_engine 綠
- [x] r13 30×20 agent；共識修 diving／營火／雙層床／球場配球
- [x] r14 第二輪：額度不足，機械掃描補慢跑／滑雪／重訓／跳舞購物
- **Status:** done pending commit

### Phase 12: 鎖定場景按鈕 + 文意迴圈

### Phase 12: 鎖定場景按鈕 + 文意迴圈
- [x] 引擎 lockScene（預設 true）+ 四套 HTML 晶片「鎖定場景」
- [x] 物理規則：睡覺 vs 清醒活動、靜姿 vs 移動、頭出畫 vs 臉、日夜
- [x] r1 seed 980000：泡澡無水、浴＋盔甲鞋、睡覺＋泡澡、跳舞＋遊戲、夜＋橙空
- [x] r2 seed 990000：睡覺＋伸展／瑜珈／讀書／日光浴、浴室西裝、頭出畫＋閉眼
- [x] r3 seed 991000：睡覺＋抽菸
- [x] r4 seed 992000：爬行＋野餐、跳舞＋讀書、騎馬＋蹲、野餐水下、睡覺喝酒／漂浮
- [ ] r5 seed 993000：修完再稽核
- [ ] 共識問題 TDD 修完再派，直到 SUMMARY 0 為多數且無重複共識洞
- **Status:** in_progress

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| lockScene 預設開 | 使用者要場景不矛盾；關掉才走寬鬆 NSFW／錯場 |
| 物理規則不跟鎖定走 | 睡覺跑步、頭出畫＋臉永遠不合理 |
| 釘選可自撞 | 使用者明確釘的組合保留 |
| 餐廳做愛、職業錯場 | 鎖定關時允許；鎖定開只擋活動↔地點↔姿勢↔浴衣 |
| 10 agent × 同一 50 抽 | 共識投票，單 agent 誤報不修 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| stampAnchors 把城堡蓋上泡澡 | r1 | 衝突 place 不 stamp，env 後丟掉不配活動 |
| 衣服先於場景，浴＋盔甲／下駄 | r1 | reconcile 浴場剝不釘的壞衣 |
| picnic 暗示 eating 讓睡覺＋吃漏過 | r1 | picnic 進 AWAKE_ACT |
| 睡覺＋抽菸 r3 漏網 | r3 | smoking 進 AWAKE_ACT |
| planning session-catchup 無法以一般命令啟動 | 2026-09-13 | `python` 不在 PATH，`py -3` 也沒有登錄 runtime；之後由 workspace dependencies 找到 bundled Python 3.12.14，完整路徑可正常執行 |
