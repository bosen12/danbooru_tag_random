# Findings: 鎖定場景文意

## 2026-09-14 Codex：pose tag 深度稽核（進行中）
- 稽核基準為 `main` / `d77ca9f`；開始時另有外部未提交的 `scripts/test_engine.mjs` 修改，視為 Claude／使用者工作並保持不覆寫。
- 姿勢問題必須區分三個維度：`needs:["pair"]` 是候選資格、抽取機率是 selection weight、`(tag:1.2)` 是送給模型的 prompt emphasis；不能用同義 tag 重複同時承擔三者。
- 初步確認 `castOk()` 已正確讓 pair tag 在 `people < 2` 時不可選；可達性驗收應在標籤合法 context 內測，不要求 pair tag 在 solo 命中。
- `smart-explore` 以 Windows 絕對路徑解析 `.js/.mjs` 失敗（0 symbols／Could not parse）；下一次改用 repo-relative POSIX path，若仍失敗則依 skill 允許回退精準 `rg`。
- 相對路徑重試仍為 0 files／Could not parse，依 skill 回退精準 `rg` 與小範圍讀取。
- 外部 `scripts/test_engine.mjs` 修改已針對三個 activity child 加紅燈：Claude 註解記錄舊版 `86a3a1b` 的 600 張中 `karaoke=6`、`playing video games=2`、`picnic=1`，依賴改走 `allow()` 後全變 0；另加 unrelated busy activities 不得共存的護欄。這與獨立定向重播的根因一致，應保留並把機率式 `>0/600` 改成定向 deterministic contract，降低偶然紅燈／綠燈風險。
- 現行 `posePrefer` 仍是 hard buckets；clothing 已在同檔改為 `softTiers + weights`，因此有現成的最小參考實作，但 pose 權重屬產品分布決策，必須先 A/B 量測再落地。
- pair tag 的 `castOk()` eligibility 與 heat gate 已存在；目前沒有 lexicon-level selection weight。`applyTagWeights()` 是輸出 prompt emphasis，不可拿來代替抽取權重。
- 使用者後續明確要求本交辦文件排除 Claude 正在處理的 pair 問題；最終文件不列 pair eligibility、pair 權重或 pair 同義詞待辦。
- `audit_tag_reachability 60`：12,960 draws，1132/1198 命中、zero-hit 66；pose zero-hit 26。非 pair 的 zero-hit 主要是 `lower body`／`head out of frame`、6 個 flash 衣著動作與 `covering own mouth`／`closed mouth`。zero-hit 本身不是 bug，後續用定向候選拆因。
- 定向 200 次：flash 衣著動作在匹配服裝且只留目標候選時全部可達（jack-o 177、shirt lift 200、downblouse 200、panty pull 175、sweater lift 200、leotard aside 200）；`covering own mouth` 與 `closed mouth` 都 200/200。因此它們只是自然分布罕見／被硬桶壓低，不是結構性不可達，不應列 P0 bug。
- 定向 camera：一般 feature 流程下 `head out of frame=0/200`、`lower body=0/200`；排除 eye/face/gaze/expression 候選後分別 150/200、72/200。根因已隔離為 eye color 先選、faceless camera 後選且互斥，不是詞庫或 RNG。
- pose 355 個中有 57 個會 imply 另一個 pose；排除 pair/group/crowd/2x/yuri 後仍有 12 個。現行 `countSection("pose")` 會把 child 與 support parent 都計入 quota，這是可量測的產品語意問題，不是 hard bug。
- `test_lexicon_integrity.mjs` 與 `test_draw_contracts.mjs` fresh pass；代表 schema／implies cycle／現有 orphan contract 無紅燈，但它們沒有保證每個 pool-enabled pose 自動可達。
- Claude live WIP 已同時修改 `makeCommit()`：依賴在來源暫放 `used` 時若被 `allowDep()` 擋，移除來源再問一次，只有仍被其他標籤擋才拒絕。WIP 版本的定向活動測試已恢復 `karaoke=13/200`、`playing video games=10/200`、`picnic=5/200`；不列為 Claude 要重做的待辦，只列完成後應驗證的 scope。
- 200 張／context 的 solo modern 分布：pose quota 約 10。activity/tease 平均 face≈3、tease≈3；flash 平均 face≈4.8–4.9、flash≈1.15–1.21；sex 平均 face≈5.92–5.95、sex≈0.88–0.89。三種 sceneMode 幾乎相同。這與 `posePrefer` hard bucket（face 在 heat-specific group 之前）一致：尺度越高，反而約半數以上 pose token 被 face group 吃掉。屬分布優化候選，不是 hard contradiction；必須同 seed A/B 後再改。
- Danbooru 官方 API fresh 2026-09-14：355 pose 中 333 pass、22 fail。排除明確／實質 pair scope 後，仍有 13 個需裁決：`one knee up`、`presenting`、`presenting ass`、`hand on hip`、`hands on own breasts`、`panting`、`wink`、`breast hold`、`hand in panties`、`self fondling`、`extreme close-up`、`looking away`、`washing body`。
- 官方 active aliases：`hand on hip -> hand on own hip`、`panting -> heavy breathing`、`wink -> one eye closed`；歷史/deleted alias 記錄仍指出 `presenting -> presenting own body`、`presenting ass -> presenting own ass`。候選核實中 `presenting own body/ass`、`hand on own hip`、`grabbing own breast`、`heavy breathing`、`one eye closed`、`hand in own panties`、`close-up`、`looking to the side`、`averting eyes`、`sideways glance` 都有效。
- `one knee up` 不可直接換成 `on one knee`：語意可能不同。官方有效近似詞 `knees up`(82,157)、`knee up`(58,898)、`leg up`(112,275)、`on one knee`(18,875)；需要看原本意圖與 WAI A/B。
- `washing body` 無 exact current tag；`washing self` 也不存在。官方 inventory 有 `washing back`(365)、`washing own back`(5)、`washing arm`(5)、`washing face`(89)、`washing hands`(227)、`washing hair`(1,015)。不可猜換，應刪除／拆成可驗證具體動作或保留為 WAI legacy 實驗組。

## 2026-09-13 Codex：Claude handoff 方向性／可達性稽核
- Guard 依關係分成 A（final-set hard incompatibility）、B（有向 dependency/support）、C（quota/prefer/reconcile arbitration）、S（soft plausibility），mode／pin／phase 另列，不把它們混成關係種類。
- A 類掃描涵蓋 day/night、faceless/face、sleep/action/expression、eye/mouth/sky、in/out、body/limb/hand、sport/venue。已成對的 guard 保留；只修 final POS 可固定重播的缺口。
- A1：室內外直接反向 guard 雖已補，但 `makeCommit()` 跳過 `in_out` dependency 驗證，`futon -> indoors`／`open-air bath -> outdoors` 仍能繞過。12 個固定重播紅燈；移除 skip 後全綠。
- A2：`indian style` 先進時仍會抽到 `amazon position`（45/800），反向原本 0/800。補成雙向後 0/800 × 2。
- A3：釘 `high heels` 後仍會抽到非 fishing 水上活動（101/800），反向原本已擋。補入 WATER_ACT 反向後 0/800。
- B：`nurse/doctor/scientist/construction worker` 的配件依賴在來源尚未進 `used` 時驗證，導致四種職業與配件結構性不可達。依賴改在「來源即將存在」的虛擬上下文驗證，再 atomic commit；固定 1200 張四職業及 nurse cap/lab coat/stethoscope/hard hat 全命中。
- C：clothing prefer 原本是抽乾高順位才看下一桶，互斥服裝只有一格，顏色變體 top/bottom/onepiece 固定 1200 張皆 0。改為 12/9/6/4/2/1 軟權重、不放寬 allow；三族全恢復可達。
- clothing `fabric` 七字全部無 mutex 又無任何 parent relation，舊 filler 因此永久擋掉。fabric group 現可抽；另補 long sleeves × short sleeves 對稱 hard guard。固定樣本有五種 fabric 命中且長短袖衝突 0。
- 同一套 17,280 張廣泛設定探針：zero-hit 138 -> 62；clothing zero-hit 84 -> 8。剩餘含 19 個刻意 pin-only quality、支援／preset 情境限定與罕見字，不再為追數字放寬。
- `hat × head out of frame`、戶外桌景等語意不是無條件 final-set hard，未因單向外觀就機械補規則。

## 2026-09-13 sports preset 共識
- Claude 複核 GPT 六項發現，全數成立；共識詳見 `討論區.md` 的「【Claude】對 GPT 深度審查的回覆與共識提案」。
- `togglePresetTags` 清全部其他 preset 的 implies/bind 閉包，會刪除手動 outdoors/indoors/hat/sneakers 等。
- `SPORT_IDENTITY` 從 kit membership 反推 compatibility，造成 `playing sports+tennis court`、`sports court+tennis`、`cleats+track` 假衝突。
- `ski slope` 不存在；`sports court`/`fitness gym` 是 2026 新詞，WAI 相容性只能以可設定建立年份警告呈現，不能猜訓練截止日。
- 單女拳擊+sex 模擬顯示 boxing gloves 與自由手指動作高頻衝突；只限制穿戴手套，不把場景球拍／球棒／弓視為佔手。
- 對 Claude 提案的唯一修正：舊存檔即使完整包含 kit 也不能證明是 preset 加入；migration 一律 `presetOwned=null`，避免猜錯後刪除手動資料。

## 2026-09-13 Codex 接手：r42 裁決與 shadow 邊界
- `r42.json` / `r42_gold.json` 各 400 筆；raw→gold 的 id/seed/mode/pinned/tags mismatch=0。
- 初審 27 hard；GPT 降 4 筆 weird 品味案例，Opus-proxy 再降 7 筆可行姿勢；一致性稽核又發現 #378/#389 與已裁決 hard 的 #181 同為 normal solo `eating + on stomach`，修正後 hard 18/400 = 4.5%。
- r42 gold 已補 `review_status / reviewers / severity / modes`；正式 validator 只使用 `review_status=adjudicated`。
- 第一個維度採 support shadow：`drawOne.shadowViolations` 在 POS 完成後才計算，本身不刪 tag、不補 tag、不改 positive。
- 規則硬度落在關係，不落在單一欄位；`scope=same_actor` 在多人且無角色歸屬時不判。
- pinned 自撞保留；兩端都由 pin 強制時降為 warning，不算 auto hard conflict。
- 先量 precision、coverage 與 soft false positives；未達門檻不得接入 `admissible()`。
- 舊引擎的 eating/cooking support 判斷未區分 mode/scope，會錯擋 weird soft 與多人未歸屬案例；現改由一個 declarative candidate gate 處理，`forcePin` 不變。
- enforcement 規則：eating-prone normal/diverse；cooking-supine normal/diverse；cooking-prone normal-only；wading-planted 三模式。same_actor 在 `people > 1` 跳過。
- r42 verdict = hard 18 / ok 382；severity = hard 18 / soft 11 / empty 371；review_status 全 400 adjudicated。
- support shadow：hard IDs 35,181,340,341,378,389,393；precision 1.0；coverage 7/18（38.89%）；soft false positives 0。剩餘 11/18 是其他維度，不應誤稱 support recall 失敗。

## r41 (400, 20×20)
Agent raw 63/400. 核實 15/400 = 3.8% after skip (diverse env leftover, pinned-place+sex, adult×loli, taste).
Patched: sceneClothLocked uses used+lockScene; cooking→kitchen; breasts on table vs outdoors-imply; DRY_NO_WATER physical; hand in pocket×bikini; BOTH_ARMS×fingering; ski/dojo/prison/cabin cloth kinds; orphan ACT_PROP; sleeping vs city.

## r23 (400, 20×20)
Agent raw HARD 33 flags / 400 ≈ 8%. After skip list (taste / pin combo / weird leftover / sitting+swimming analog): ~24/400 ≈ 6% verified engine-auto.
Consensus patched: HOF/lower body vs eye tags; standing vs jogging/MOVE; sleeping vs gaze reverse; swimming vs contrapposto; on chair vs standing/suspended congress; floating vs lie; sex group vs MOVE (skiing masturbation); night market vs day; bald vs streaked hair; skinny vs fat; adult vs shota.

## UI 2026-09-11
- 選 LoRA 旁「設定」：illurtrious 雙欄底模，跳 LoRA Manager（:7861/loras）
- 權重：點數字開 popover，無滾輪

## Product
- 晶片 `鎖定場景` id=lock-scene，四套版面，預設 aria-pressed=true
- settings.lockScene；sanitize：`raw.lockScene !== false`
- 關鎖定：職業錯場、餐廳做愛可過；物理不可能仍擋

## Physical always
- sleeping vs AWAKE_ACT（含 picnic、stretching、yoga、studying、sunbathing、smoking）
- STILL_BODY / LOCKED_SIT / GROUND_BODY vs MOVE_ACT
- dancing (body_pose) vs 部分清醒活動
- FACELESS_CAM vs gaze/expression/face/closed eyes
- DAY_MARK vs NIGHT_MARK；night vs sunlight/sunbathing/blue sky/orange sky

## lockScene
- WATER_ACT → WATER_PLACE（pool ladder 不算水）
- horseback/hiking/picnic/sunbathing 不進 INDOOR_ROOM/BATH
- driving → DRIVE_PLACE；sports/exercise/training → SPORT_PLACE
- cooking → kitchen（不要車內／臥室／浴）
- karaoke 不要電梯；games/shopping 不要浴
- stampAnchors 跳過衝突 place；env 後丟不釘的錯活動
- 浴場剝不釘的 isBathBadCloth（下駄／靴／盔甲／西裝…）

## r4 root causes
- picnic 暗示 eating，GROUND 只擋 eating 不擋 picnic
- dancing 是 body_pose，衝突表漏 studying/writing/drinking/picnic
- horseback 只擋 standing/靜姿/坐姿/趴地，漏 squatting/kneeling/on one knee
- drinking / floating / bathing / showering 不在 AWAKE_ACT
- picnic 地點只擋室內／浴，不擋 underwater/ocean/pool

## Not lock bugs (previous agents)
- sitting + swimming（水裡坐著）
- sleeping + camping（營帳裡睡）
- restaurant sex、job-place
- 釘選自撞

## r12 NEW-hunt (50 agents × 20, ignore already-handled)
Verified against actual POS (not agent hallucination). Consensus leftover leaks fixed in engine (tests green, uncommitted):
- LEG_EXTRA mutex: crossed legs / legs up / one knee up / m legs vs ground/locked sit/kneel/squat/dance; legs up vs standing
- LIE vs bent over / leaning; ground vs leaning back
- bathing vs after bathing; overcast vs blue/starry sky; rain vs starry sky
- lower body vs breast-hold class; HOF vs singing/karaoke
- hiking/sports/bicycle vs kneeling; expressionless vs wink; eating vs clenched teeth; driving vs on chair
- sleep expr: surprised/embarrassed/nervous
Skipped as too rigid: standing+crossed legs, dancing+on chair, rain+blue sky, outdoors+ceiling light, adult+loli, necktie colors.

## special_prompts folders → candidate tags
See session list: only Danbooru-wiki tags missing from lexicon; jobs need JOB_PLACE; no auto-add until user picks.

## r6 consensus (post-fix remaining classes)
- 正常錯場配件：領帶／麥克風／安全帽／聽診器／泳圈／職業帽
- 頭出畫 + 讀書／洗頭／oral
- 無水洗頭、洗背
- 睡覺 + come hither／scared
- on chair + crawling／seiza／floating
- 已修：浴場服裝白名單、女僕地點、開車只坐、配件鎖定、FACE_NEED 擴大
