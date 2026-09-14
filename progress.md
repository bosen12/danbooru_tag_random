# Progress Log

## Session: 2026-09-14 (時代看不出來：服裝權重 + 環境時代訊號)

- 使用者回報「以前看得出時代，現在有點看不出來」。量測分成兩件事。
- **迴歸（已修）**：clothingPrefer 從硬桶改軟權重後，時代專屬衣服掉 12–24%（中世紀 2.18→1.66）。環境完全沒掉，一度誤以為是自己移除 env prefer 造成的。時代層權重 12/9 → 40/30，中世紀回到 1.91、古中國與維多利亞超過原值，色彩變體仍有 24 種可達。加了每時代下限測試。
- **長期問題（已修）**：古代時代的環境有 95–97% 是時代中性字，而 park/bedroom 在 WAI 裡預設畫成現代 —— 江戶場景配電線桿和公園長椅。
- 根因：場地必須配合先抽的活動，活動幾乎全是時代中性的現代動作，中性場地每次都贏；連 eraAnchors 的 castle 都只有 15/400。
- 補詞庫只把中世紀從 0.10 拉到 0.19，不夠。關鍵觀察：**景物（mutex null）不是場地，不受 placeFitsActs 約束**，可以繞過整個順序問題，不必大改順序。
- 新增「時代風味槽」：非現代時代且環境還看不出年代時，補一個時代專屬字，優先挑不佔互斥格的景物。六個時代全部 300/300 有時代訊號。
- 詞庫 1198 → 1208：7 個景物（arch、stone wall、greco-roman architecture、tower、windmill、paper lantern、bamboo）＋ 3 個場地（ballroom、carriage、greenhouse），全部通過 Danbooru API 核實。
- 修正既有時代標註：park／alley/park bench → modern+victorian（公共公園是 19 世紀以後的概念）、tavern → medieval+victorian、rice paddy／bamboo forest → 古中國+江戶+現代、dojo → 江戶+現代。改 `web/lexicon_parts/*` 來源檔再重建，沒有手改產物。
- **自我檢查抓到自己的錯**：新加的 15 個字有 7 個是死的（全是 mutex=place 的）—— 正好印證診斷。依證據砍掉三種模式都接近零的 5 個，留下多元/奇葩可達的 3 個。
- 採納 Codex 的批評：`karaoke` 等三個字用 `>0/600` 斷言太脆（picnic 只有 1/600），改成三者總和 ≥5、樣本 2000。紅燈驗證確認鑑別力沒變。
- 探針第五次抓到我自己的規格錯：水源清單漏了 `wading`。
- 生圖驗證：同 seed 的江戶圖從「現代公園＋電線桿」變成「白羽織＋藏青腰帶＋草履＋竹林」。
- 驗收：十二支測試套件 + 20000 張深度稽核 + Danbooru API 核實全綠。

## Session: 2026-09-14 (姿勢 tag：迴歸、同義詞、舊詞 A/B)

- Codex 的 `docs/pose-tag-deep-review.md` 逐條驗過，兩條採用、一條推翻、三條暫緩。
- **迴歸（Codex 自己造成的）**：`karaoke`／`playing video games`／`picnic` 在 86a3a1b 分別是 6／2／1 次，把相依字改走 `allow()` 之後全變 0。肇因是驗證相依字時會先把父字放進 `used`，而父子同屬 `HANDS_BUSY_ACT` 就會自撞。修法：相依字被拒時再問一次「把父字拿掉還是不合法嗎」。
- **同義詞**：Codex 列的 8 組裡 4 組第二個字不在詞庫（那是 Danbooru 正規名不是重複），1 組是父子關係。真正要修的 2 組（panting/heavy breathing 114 次、kissing/kiss 16 次）改用互斥，保留加權不刪字。
- **推翻 §2**：把 camera 槽移到臉部特徵之前確實讓兩個無臉鏡頭各約 4.5% 可達，但同時打破四條既有承諾（lower body 擋掉手臂與忙手活動 → 活動尺度沒活動、全裸單人性愛沒自慰、flash 沒衣服）。這兩個構圖和工具的多數保證天生不相容，留給釘選。量測與理由寫在 engine.js 的 camera 槽註解。
- 過程中一度把測試寫成 `=== 0 || true` 的恆真斷言，自己抓掉了。寫「抽得到」會紅、寫「抽不到」是把未必想留的現況釘成契約，所以刻意不寫斷言只留註解。
- **舊詞 A/B 生圖**（ComfyUI 實跑 20 張，`docs/compare-posetags/`）：五組「官方 deprecated」的舊詞，WAI **全部畫得出正確結果**，一組都不該改名。Danbooru 2026 的 tag 狀態不預測模型認不認得。
- `wink` vs `one eye closed` 是唯一有實質差異的：前者是俏皮眨眼（咧嘴笑），後者是慵懶半闔眼。alias 是資料庫去重，不代表模型向量空間相同。
- 方法教訓：`close-up` 在 seed 101 是一團皮膚、seed 202 是漂亮眼部特寫。單 seed 會給出完全錯誤的結論。
- §4（posePrefer 軟分層）／§6（quota root/support 分離）未做，兩者都需要先建 baseline/candidate 統計並通過 Codex 訂的門檻。
- 驗收：十支測試套件全綠。

## Session: 2026-09-14 (姿勢 tag 深度稽核)

- 使用者要求深度檢查、驗證姿勢 tag，整理為 Claude 可直接執行的 `.md`；本輪不直接修改引擎。
- 已恢復既有 planning files，開始盤點 pose schema、抽取管線、pair 權重、可達性與 Danbooru 官方標籤狀態。
- 稽核基準 HEAD=`d77ca9f`；發現既有外部修改 `scripts/test_engine.mjs`，不覆寫。smart-explore 絕對路徑解析失敗，記錄後改用相對路徑重試。
- 相對路徑也無法使用 smart-explore，已回退精準搜尋。讀到 Claude 新增的三個 parent/child busy activity 紅燈，尚未修改 production；將驗證測試穩定性與更精準的 directed contract。
- 跑 fresh local probes：lexicon integrity、draw contracts 通過；12,960-draw reachability 找到 pose 26 個 zero-hit。定向拆因後，flash／mouth 候選都可達，真正非 pair 結構性不可達剩 faceless camera 兩字。
- Claude 在探針期間 live 修改 `makeCommit()`；新進程確認三個 activity children 恢復非零，舊的長跑進程屬修改前快照，不拿來作最終驗收。
- 完成 12 個 mode×heat 的 solo 分布量測：hard `posePrefer` 造成 flash/sex 場景 face group 平均約 4.8/5.9 個、真正 flash/sex group 約 1.2/0.9 個；列為需 A/B 的分布優化。
- 完成 Danbooru 官方 tags/aliases fresh 驗證：355 中 333 有效、22 不通過；最終 handoff 只收非 pair 的 13 個裁決項，且標記 WAI legacy 相容性不能只看網站現況。
- 產出 `docs/pose-tag-deep-review.md`：P1 camera 普通 filler 不可達與不可見 feature 浪費；P2 pose hard bucket 分布、非 pair 舊詞、support quota；P3 測試工具護欄。依使用者指示不交辦 pair 工作。
- 臨時 `.tmp_pose_audit.mjs` 已刪除；未修改 Claude live WIP 的 `scripts/test_engine.mjs`。

## Session: 2026-09-13 (深度審核收尾：reconcile／quota／weights)

- 三方分工出事：Codex 與 Claude 同時改 `web/engine.js` 與 `scripts/test_engine.mjs`，一棵沒 commit 的樹。室內外那個洞需要兩半（Codex 的 `makeCommit` 讓 imply 鏈走 `allow()`、Claude 的反向 guard 在 `allow()` 裡擋下來），Claude 因為「單獨加沒用」把自己那半退掉，Codex 以為還在 —— `findings.md` 寫「全綠」，實際 12 條紅。停手時把測試 park 起來、事後獨立重跑才抓到。
- 教訓：並行時先講好檔案邊界，或每完成一小段就 commit 當安全點。
- reconcile() 孤兒檢查：7200 張 × 14 條前提規則，**零孤兒**（負面結果）。已收成 `scripts/test_draw_contracts.mjs`。
- 權重／設定邊界：全零、NaN、負數、Infinity、字串、null、陣列、缺鍵全部健壯；`sanitizeSettings()` 是有效護欄。`heats: null` / `counts: null` 會讓 drawOne 丟 TypeError，但查過所有呼叫端（boot.js、game/main.js）都走得到 sanitize，**不可達**，不修。
- quota 結構乾淨：各 section 只補一次（兩個 `fill("clothing")` 在 gotNude 的互斥分支），`fillSlot("pose","activity")` 三次呼叫都有 mutexTaken 早退。暗示字計入 quota 造成的超額（feature +21%、clothing +23%）已在 README 講明。
- `counts.env` 修正在合併後的程式碼確認有效：4.31 → 6.04 → 8.12 → 10.19。
- **未解**：`counts.subject` 從 0 到 10 一律 2.90，完全無作用 —— 和先前的 env 同一個形狀，屬產品語意問題，留給 Codex 裁決。
- 第三次驗證「人工規格」的價值：孤兒檢查第一版自己錯三條（幫 pool ladder／beach towel 發明了 production 從未宣告的契約、水源漏掉 lotus pond）。若規格從原始碼反射就永遠發現不了。
- 清掉 `.tmp_baseline_86a3a1b`（46MB，617 檔逐一比對與 86a3a1b 完全相同），並加 `.gitignore` 規則防止再被 `git add -A` 掃進去。
- 驗收：十三支測試套件全綠。

## Session: 2026-09-13 (Codex 完成 Claude handoff：方向性與可達性)

- normal/diverse 的明確 pin 場地＋運動器材衝突現在會提示但完整保留；weird 不提示。candidate gate 與 warning 共用 `sportIdsFitPlaces()`，並把既有 cross-sport warning 接到 UI。
- 完成 A/B/C/S＋context/authority/phase 掃描；修正 in/out dependency bypass、indian style×amazon position、high heels×水上活動三個確定的單向 hard 漏洞。
- `makeCommit()` 的依賴改用虛擬來源上下文驗證，恢復 nurse／doctor／scientist／construction worker 及其配件的自動可達性。
- clothing prefer 從硬桶改為軟權重；fabric group 可自動抽，long sleeves×short sleeves 保持硬互斥。
- 新增 `audit_tag_reachability.mjs`、`test_clothing_reachability.mjs`、`test_directional_rules.mjs` 並納入 `test.bat`。
- 17,280 張同設定 A/B：zero-hit 138 -> 62（-76）；clothing 84 -> 8（-76）。探針只做診斷，不把 zero-hit 本身當失敗。
- 2000 張 invariant audit：12 hard 全綠；soft 暮光夜景 36，僅統計。
- 完整 engine（含新 12 個 in/out 重播）、2000 張 invariant、clothing reachability、directional rules、Node 其餘六套、Python server/live（含真 HTTP + fake Comfy websocket）全綠；本機 UI 的全部 module 回 200 並正常渲染。刻意改 RNG 分布後 seed-42 金標已更新且重跑通過。
- 最終提交訊息：`Harden generation invariants and restore tag reachability`。

## Session: 2026-09-13 (tag 抽取稽核：暮光／環境／燈光)

- 三方流程：Opus 提案 → Codex 裁決 → Opus TDD 實作，三輪。全部寫在 `docs/review-request-tag-draw.md`。
- 暮光：`sunset`/`dusk` 以前被當白天側硬擋卻只補了 dusk 的反向規則。Codex 裁定暮光是日夜過渡、兩側相容，刪掉額外硬擋。紅 5 條 → 19 條全綠。
- 環境：`fill("env")` 以前只在非正常模式跑，而正常模式是預設 → 左欄「環境」2/4/10 給出一模一樣的結果，是死的控制項。改成無條件執行。
- 燈光：`fill()` 給 env 的 prefer 是 `(eraSpecific && mutex)`，而 takeFromPool 是「抽乾桶 0 才輪到桶 1」，lighting 只有一格 → 10 個 `era:["any"]` 的字機率恆為 0。採 Codex 的丙案，只移除 env 的 prefer，不動通用 takeFromPool 與 clothing/pose 排序。
- 打開 env filler 後既有測試 `normal living room never leftover water/sport env` 紅：`tennis uniform` 先進場給了運動身分，`tennis racket` 跟著合法進來。根因是 `sportPlaceOk()` 只在「候選是場地」時擋，反向不存在。新增對稱的 `sportGearPlaceOk()`（只看器材不看服裝，與既有註解語意一致）。
- 新增 `scripts/audit_draw_invariants.mjs`：12 條 hard + 2 條 soft，規格人工維護不從原始碼 regex 反射，失敗訊息可一行重播。2000 張進 test.bat，20000 張手動深度模式。
- 探針第一次跑出兩條 hard 紅燈，兩條都是規格寫錯不是 production 錯（sky+starry sky 是贅詞不是矛盾；水源清單漏了 underwater/open-air bath/bathing）。這正是 Codex 堅持人工規格的理由。
- 更正：先前報的「40.7% tag 抽不到」是在預設設定下量的，過度歸因。修正後放寬設定重量為 151/1198 (12.6%)，未歸因 74。
- `mustReport` 誠實性：4440 次對帳 0 錯誤，Codex 的第一順位風險不成立，但測試保留。
- 觀察：今天三個 bug 形狀相同 —— 規則只寫單向，靠抽取順序碰巧補上。已向 Codex 提議做一輪「順序對調」專項掃描。
- 驗收：十支測試套件 + 八支 module 逐支 import() 解析 + `git diff --check` 全綠。

## Session: 2026-09-13 (無限抽卡死：三個缺陷)

- 使用者回報無限抽整晚跑到一半自己停，「抽並生圖」按鈕在轉但不生圖。
- 找到三個各自都能造成該症狀的缺陷：`runBatch()` 沒有 try/finally、`Ws.recv()` 逾時落在幀中間會永久錯位、前端 SSE 沒有任何逾時上限。
- 三個都修並各自做過修正前／修正後的瀏覽器 A/B：舊版崩潰後永久轉圈零提示、舊版對死掉的伺服器 138 秒仍在等；新版按鈕放開、原因寫在狀態列、90 秒開槍算失敗。
- 舊版 Ws 對切開的幀吐 `Python int too large to convert to C ssize_t` —— 長度欄位從 payload 讀出來的鐵證，已用整合測試固定住。
- 順手：續跑不再靜默放棄、`POST /prompt` 失敗不再洩漏 websocket、Windows 的 `ConnectionAbortedError` 現在接得到（會送 `/interrupt`）、traceback 不再洗版、Telegram 佇列加上限、跳過鍵的競態。
- 新增全域錯誤兜底（`window.onerror` / `unhandledrejection`），以前沒接住的例外完全無聲。
- 新增 `scripts/test_server_live.py`：真的起 server.py + 假 ComfyUI（含 websocket handshake）跑完整 SSE，16 項；已進 `test.bat`。
- 錯誤：用 heredoc 傳含反斜線的字串給 Python 會被吃掉一層，寫進 JS 的換行跳脫序列變成字串裡夾真換行。改用檔案 splice 或 Edit 工具。
- 錯誤：`node --check` 對 ES module 靠不住 —— 上面那個語法錯誤它 exit 0，瀏覽器卻整支 module 不載入。改用 `node --experimental-vm-modules` 走真的 `import()`。
- 驗證：九支測試 + 八支 module 逐支解析 + `git diff --check` 全綠。

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
