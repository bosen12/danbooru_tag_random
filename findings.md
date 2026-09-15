# Findings: 鎖定場景文意

## 2026-09-14 Codex：時代服裝覆蓋與多樣性續查
- 接手時 dirty worktree 僅有 `merge_lexicon.py`、`test_engine.mjs`、`engine.js`、`lexicon.json`、`04-era.json`，均屬 Claude 未完成 WIP。
- 原先「古希臘 88% 下半身空白」是探針分類錯誤：漏算 mutex=null 的整套服裝。修正分類後古中國／古希臘／江戶為 0，真正缺口是 medieval 浴場與 victorian 浴場／上衣無下著。
- Claude 已先建立會失敗的浴場身體描述、上衣配下著測試，再實作浴場補救池與 late lower-body repair；這段保留 TDD 證據。
- 新增 `loincloth` 為 any gate 後，女性古希臘抽取約 74% 被它佔據；這是修復過程引入的過度集中，不是原始需求。應限制在男性情境或移出自動池，再用相同種子複測。
- `coat` 不能視為下半身覆蓋；已從 lower-cover 判定移除，並以 `bodyGarmentSlot()` / `coversLowerBody()` 共用分類，避免各修補流程再次分歧。
- 最終 12,960 張（female/male/mixed × 6 era × 4 heat）矩陣：每格 body blank=0、bath blank=0、非水上 top-only=0。水上 top-only 只剩 Victorian swimming/diving/wading/fishing，沒有為過測試強塞 suit pants。
- `loincloth` 修成 medieval + male + underwear_bottom，且自動只在浴場出現；男性 medieval 全圖 83% -> 14%，古希臘與純女性皆 0，手動釘選不受限。
- Victorian 新增 `suit pants` 後，男性一般 top-only 122/640 -> 0；浴場加入既有 `bathrobe` 的 Victorian era，男性非 sex 浴場由 240/240 裸降到約 26%。
- 浴場 repair 的第二個同形 bug：loincloth 已進 used，但舊 `hasBodyGarment()` 不認 underwear_bottom，隨後補 nude 並由 reconcile 刪除 garment。改用共用 body/lower helper 後不再自我覆寫。
- 廣泛 draw contract 因 RNG 位移暴露 seed 84：splashing 先靠 floating 過 gate，floating 可留作空中漂浮，最終沒有水源。WATER_SOURCE_ACT 明確排除 floating，allow 與 reconcile 共用。
- 官方 Danbooru API（2026-09-14）：suit pants 3,912、bathrobe 1,711、pants 709,033；trousers/slacks 是 pants active alias；breeches 僅 57，未採用。

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

## 這一輪：時代庫存的洞（Opus 5，接在 Codex 1d027b9 之後）

Codex 的 `1d027b9` 把我當時工作區未提交的改動一起收進去了，我先驗過：它的重構是對的，
而且抓到我兩個真錯誤 ——

1. `skirt` / `pants` 是 Danbooru 的父標籤。我把 `long skirt` 的時代開到 medieval /
   ancient_china，卻沒同步放寬父標籤，child → parent 的 implication 會在那兩個時代被
   era gate 截斷。Codex 補上了。
2. `chemise` 是 `gate: female`，所以中世紀／維多利亞的**男性**浴場還是會被迫全裸。
   Codex 把 `bathrobe` 開到 victorian 補這個缺口。

### 這一輪找到並修掉的（同一種形狀：白名單／庫存只填了一部分時代）

| 位置 | 症狀 | 修法 |
|---|---|---|
| `isBathOkGarment()` | 白名單逐個時代填，medieval 和 victorian 一條都沒有 → 浴缸裡只剩一頂軟帽，身體完全沒交代（medieval 51/500、victorian 30/500） | 補 `chemise`；**另外**把補救池從「只收 onepiece/top/bottom」放寬到含裸標與整套服裝，這樣以後漏掉的時代也不會空手 |
| `hasBodyGarment()` | 看到一件 top 就放行，沒有任何一步會去補下著；victorian 六件上衣只配得到一條 `pencil skirt`（1950 年代的衣服） | 加後置條件；`pencil skirt` 降回 modern；補 `long skirt` / `petticoat` / `hoop skirt` |
| 外衣庫存 | modern 有 13 件外衣，每個歷史時代**剛好一件** → 那件就是該時代的制服：`himation` 佔古希臘 78%、`cloak` 佔中世紀 72% | 補 cape / capelet / hooded cloak / tabard / shawl / tailcoat / uchikake。現在最高 30% |
| `garmentOkForSwim()` | `if (era === "modern") return false; return true;` —— 歷史時代一件泳裝都沒有，於是整套外衣跟著下水，古希臘 97% 的游泳畫面裹著 himation | 外衣一律不能下水 |
| `wide sleeves` | 古中國唯一的時代專屬布料細節，`clothingPrefer` 時代層每次只有它一個候選 → 76% | 補 `mandarin collar` / `side slit` / `layered clothes`（要加進 `groups.py` 的 `FABRIC`，放 `04-era.json` 會被 merge 改成 `group: "era"` 而永遠抽不到）。現在 49%，每張多 0.3 個 tag |

### 兩個自己踩到又收回來的

- 我第一次量「下半身有沒有東西遮」時，分類器只認 `mutex: onepiece|bottom`，把 `kimono`、
  `ancient greek clothes`、`chinese clothes` 這 36 個 `mutex: null` 的整套服裝全算成沒穿，
  得出「古希臘 88% 沒有下半身」這種假數字。真實數字是 medieval 10%、victorian 16%。
  **量之前先確認分類器認得詞庫的實際形狀。**
- 補 `loincloth` 給 ancient_greece 之後，它立刻佔掉 74% 的希臘畫面（希臘女性穿的是
  chiton，不是腰布）。補 `layered clothes` 給 medieval 之後同樣立刻衝到 65%。
  **往一個只有 0～1 個選項的槽補東西，補進去的那個會馬上變成新的制服。**

### 一個留著沒動的判斷

`wide sleeves` 現在 49%，還是古中國最常見的單一服裝細節。它是對的時代訊號（漢服本來就是
寬袖），要再壓下去就得動 `clothingPrefer` 的權重，而那組權重是為了「看得出時代」調出來的。
我停在這裡，沒有為了讓數字好看去動它。

—— Opus 5

## 2026-09-15 Codex：Opus 5 implication 報告獨立驗證

- HEAD `bfc21b1`、工作樹起始乾淨；`dantaggen-vs-engine.md` 已在該 commit。
- 用相同設定重算 200 抽，精確重現：平均 37.77 tags、1074 個直接父子共存（5.37/張）、200/200 至少一對、52/200 有三層鏈、`contradictions()` 回報 0。
- 完整 `node scripts/test_engine.mjs` 基線 exit 0。
- implication 圖只有 28 條三層路徑、27 個 child；其中 22/28 的 grandparent 已被 child 明確列為直接 `implies`，只限制 BFS 深度不會消掉主要案例。
- 其餘 6 條傳遞鏈包含 `office lady → pencil skirt → skirt`、`doctor/scientist → lab coat → coat`、`construction worker → hard hat → hat`、`shower head → shower (place) → indoors` 等功能性 closure；不能無條件截斷。
- 現行 `pinned` 會包含 implication closure，`missingPins()` 與多條測試把 implied parent 留在 POS 視為契約；輸出端單獨刪祖先會讓 pin/sections/POS 不一致。
- 報告的統計可靠，但「三個相關 tag 等於 CLIP 三倍權重」未經同 seed 出圖 A/B 證明；`contradictions()=0` 也只證明檢查器沒有命中，不能外推成語意絕對零矛盾。

## 性愛模式的場地白名單（Opus 5，2026-09-15）

使用者回報「江戶還是很容易抽到溫泉」，接著補「基本上每張都是」、「我發現不只江戶
其他時代會」、「好像是性愛模式」。三句都對，而我第一次量的數字是錯的 —— 我把
`activity` heat 也算進去，稀釋成 25%。**照實際預設（mixed = tease/flash/sex）是 43%，
只開 sex heat 是 96%。**

根因在 `engine.js` 的 `PRIVATE_SEX_PLACE`：`heat === "sex"` 時場地必須在這張表裡，
而這張表是照現代想像手寫的 16 個詞，其中 12 個是浴室或臥室的變體，一個歷史時代的
場地都沒有。於是各時代只剩剛好通過時代篩選的那兩三個：

| 時代 | 修正前（sex heat） | 修正後 |
|---|---|---|
| ancient_china | 2 種：bedroom 52% / bath 48% | 7 種，最高 17% |
| ancient_greece | 2 種：bedroom 53% / bath 47% | 7 種，最高 27% |
| medieval | 2 種：bedroom 51% / bath 49% | 6 種，最高 22% |
| edo | 3 種：onsen 48% / open-air bath 48% | 7 種，浴場合計 25% |
| victorian | 4 種 | 11 種，最高 12% |
| modern | 15 種 | 20 種 |

和 `isBathOkGarment()` 是同一種形狀：**照現代情境手寫的白名單，沒有人回頭補歷史時代。**
其他三種 heat 這些時代都抽得到 14~26 種場地，落差全出在這一條分支。

補的是已經在詞庫裡、只是被這張表擋住的場地（bed / futon / ryokan / 中庭 / 涼亭 /
廢墟 / 列柱 / 大廳 / 酒館 / 馬車 / 溫室 / 舞廳…）。收錄標準是「能不被打擾」，所以
market / festival / street / shrine / temple 這些公共場所仍然不在裡面。另外補了
`fountain`，並把 `courtyard` 開給古希臘和中世紀（古希臘原本只有 ruins + colonnade
兩個時代專屬場地）。

### 過程中踩到、收回來的三件事

- **把 `castle` 放進表裡，中世紀立刻變成 94% 城堡。** castle 是 medieval 的 env 錨點，
  `stampAnchors()` 會無條件蓋上去；其他 heat 沒事是因為 market/bridge/river 先供應了
  時代訊號。把 castle 拿掉，中世紀就散成 great hall 22% / tavern 20% / ruins 20% /
  throne 20% / palace 18%。**往白名單加東西之前，先確認那個詞不是該時代的錨點。**
- **把 `temple` 開給古希臘被既有測試擋下來**（`temple is not a greek place`）。詞庫裡的
  `temple` 指的是東亞寺廟，這條不變式是人寫的、有意義的，我撤回了。
- 金標 seed 42 因為候選池變大而位移，已依既有慣例重產並註明原因。

—— Opus 5

## 參考 Grok 的古中國 pack，補道具與光源（Opus 5，2026-09-15）

使用者指出 `special_prompts` 的 `156_古中國戰爭系列`、`151_中國神明系列`、`51_古中國系列`
（Grok 寫的，共 495 個 .py）出來的圖比我們的古中國更像古中國。挖了那 495 個檔，
抽出 2001 種片語，比對詞庫。

### 先講一個負面結論：不是輸在表情和動作

Grok 用得最兇的那些表情／身體片語，**大部分根本不是 Danbooru tag**：

| 片語 | 出現次數 | Danbooru post_count |
|---|---|---|
| `pleasure` | 306 | **0** |
| `teary eyes` | 46 | **0** |
| `flushed cheeks` | 41 | **0** |
| `disheveled hair` | 33 | **0** |
| `doggy style` | 34 | **0** |
| `glistening skin` | 41 | **0** |

它們是自然語言敘述，不是 tag。而真正對應的 tag（`trembling`、`messy hair`、
`arched back`、`tears`、`seductive smile`、`sweat`）我們本來就有。
**所以不要照抄它們的片語。**

### 真正的差別：時代道具和時代光源

| group | 古中國可用 | 其中時代專屬（修正前） |
|---|---|---|
| place | 33 | 17 |
| **other（道具）** | 29 | **4** — wooden floor / koi / paper lantern / bamboo |
| **light（光源）** | 10 | **0** |
| furniture | 2 | 0 |

Grok 的每一張都同時有「場景」和「東西」：軍帳＋戰旗＋篝火、神廟＋香爐＋油燈。
我們只有場景。

而且**光源那一格是死的**：env 明確填的是 place / in_out / day_night，
lighting 只能在剩下的 `fill("env")` 裡跟道具、天氣、天空搶名額，
14 個光源 tag 加起來只有約 3% 的機率出現（modern 是 0%）——
同時每張圖都被無條件加上同一句 `soft lighting`。所以每張圖的光其實都一樣。

### 做了什麼

1. **補 38 個 tag**，全部先用 Danbooru API 查過 post_count：
   - 時代光源：lantern / oil lamp / torch / bonfire / firelight / fireplace / chandelier / candelabra / lamppost
   - 古中國道具：incense burner / incense / folding fan / hand fan / scroll / calligraphy / guqin / erhu / teapot / teacup / folding screen / lotus / chrysanthemum / willow / pine tree / dragon / phoenix / silk / beads
   - 戰爭道具：banner / spear / polearm / shield / drum / horse
   - 場地：battlefield / pond / altar，並把 `tent` 從 modern-only 放寬（軍帳）
2. **`fillSlot("env", "lighting")`** —— 讓光源那一格真的會填。
3. **時代道具格** —— 歷史時代一定帶一件那個年代的東西（仿照既有的時代風味格）。

### 結果

| | 修正前 | 修正後 |
|---|---|---|
| 光源出現率 | 3%（modern 0%） | **100%**，每個時代 5–15 種可選 |
| 古中國道具 | 4 種，各約 1% | **30 種，最高 6%** |
| 江戶道具 | — | 31 種，最高 6% |
| 每張 tag 數 | 35.1 | **36.1**（只多一個） |

### 過程中自己弄出來又修掉的兩個

- **把光源填起來之後，28% 的圖變成「大白天配篝火／街燈」。** 光源不能只看時代，
  還要看日夜。加了 `DARK_LIGHT` 與既有日夜守門對稱的那一條，現在 0/2400。
  這正是「要考慮 tag 邏輯」—— 補庫存不能只看時代欄位。
- **維多利亞的 `lamp` 一度佔 60%**（它的時代光源只有三個）。補了 fireplace /
  chandelier / candelabra / lamppost，降到 46%。
- **室內出現馬 73 次。** `horse`、`bonfire`、`pine tree`、`willow`、`rice paddy`
  加進 `OUTDOOR_LEFTOVER`，現在 0/3000。戰旗、長矛留著沒擋 —— 大廳掛兵器是合理的。

—— Opus 5

## 各時代的多樣性與職業（Opus 5，2026-09-15 深夜）

接續古中國那一輪，把同一套做法套到其他時代，並補上職業。

### 職業：原本歷史時代是 0

17 個職業**全部**是 `era:["modern"]`，連 `soldier` 也是。所以歷史時代打開「抽職業」
等於沒有東西可抽。補完之後：

| 時代 | 修正前 | 修正後 |
|---|---|---|
| modern | 17 | 19（+butler, detective） |
| ancient_china | **0** | 5（monk, priestess, blacksmith, princess, dancer） |
| ancient_greece | **0** | 5（+gladiator, priest） |
| medieval | **0** | 10（+knight, viking, witch, barmaid） |
| edo | **0** | 9（+samurai, ninja, oiran, onmyouji） |
| victorian | **0** | 6（+witch, butler, detective, barmaid） |

職業靠 `implies` 帶出身上的衣服（`soldier` → `military uniform`），所以
`samurai` → `japanese armor`、`knight` → `armor`。古中國沒有可用的士兵 tag
（general / archer 在 Danbooru 都是 0 篇），改走服裝：新增 `chinese armor`，
配上 spear / banner / battlefield。pack 裡寫的 `hanfu armor` 不是真 tag。

`knight` 本來是 `feature/other` 的普通描述詞，不在職業槽裡 —— 改成 `mutex: "job"`。

### 光源那一格本來是死的

env 明確填的是 place / in_out / day_night，lighting 只能在剩下的 `fill("env")`
裡跟道具、天氣、天空搶名額：14 個光源加起來只有約 3% 的機率出現（modern 是 0%），
而每張圖都被無條件加上同一句 `soft lighting`。加了 `fillSlot("env", "lighting")`
之後 100%，每個時代 5–15 種可選。

### 道具

古中國 4 種時代專屬道具 → 33 種；古希臘 9 → 16；維多利亞 8 → 17。
每張圖多約 1 個 tag（35.1 → 36.2）。

### 自己弄出來又修掉的四個

1. **光源填起來之後，28% 的圖變成大白天配篝火／街燈。** 加了 `DARK_LIGHT`，
   和既有的日夜守門對稱。現在 0/5760。
2. **硬排序把中性光源餓死。** `fillSlot` 的 env 預設偏好是硬桶（時代專屬抽完才
   輪到中性），歷史時代有 5–9 個時代光源之後，`window light`、`sidelighting`
   就再也抽不到了 —— 既有測試 `era:[any] 燈光抽得到（不再被硬排序餓死）`
   當場抓到。改成軟權重 4:1。
3. **室內出現馬 73 次。** `horse` / `bonfire` / `pine tree` / `willow` /
   `rice paddy` 加進 `OUTDOOR_LEFTOVER`。現在 0/5760。
4. **`butler` / `detective` 沒有給 JOB_PLACE**，於是它們不受場地限制，在釘了
   廚房的場景也會佔掉職業格，把 `maid` 擠掉 —— 既有測試
   `pinned kitchen can still draw maid` 抓到。那張表裡每個現代職業都有工作地點，
   我漏了自己加的那兩個。

### 一個既有的、不是我造成的問題（但要記著）

`mustDraw` 的保證會在浴場／泳池場景漏掉：場景篩選把衣服全刪掉之後，
必抽沒有被重新滿足。拿 HEAD 比對過：**HEAD 1496/1500，我這版 1493/1500** ——
所以是既有的邊緣情況（約 0.3–0.5%），我的改動讓它稍微常見一點點。
既有測試 `must beats era` 用的那組 seed 仍然全過。值得之後單獨修。

### 使用者直接指定的兩件

- `chinese clothes` 與 `hanfu` 各半：錨點改成可以有「替代字」，每次隨機挑一個。
  1000 張古中國 → 445 張只有 `chinese clothes`，471 張是 `chinese clothes + hanfu`。
  `hanfu` 不可能單獨出現，因為它 `bind` 了 `chinese clothes`，而 Danbooru 上
  `hanfu → chinese_clothes` 本來就是 active implication。
- 拿掉 `dragon`（以及同理的 `phoenix`）：在 WAI 裡它們會直接畫出一條龍／一隻鳳凰，
  而不是衣服上的紋樣。

—— Opus 5

## Loop 1：時代組合按鈕，以及一個我自己推翻的改動（Opus 5）

### 先說我做錯又收回來的那一個

要加「武士」「騎士」這類組合之前，先量了一下：**釘 samurai，時代還是 modern，
60/60。** 畫出來是「現代廚房裡穿運動外套的武士」。

看 `chooseEra()` 發現它是先 `if (pool.length === 1) return pool[0]` 才去讀 pinned，
而預設設定就是單一時代（`data.defaults.eras = ["modern"]`）。看起來像明顯的 bug，
我就把讀 pin 移到早退前面，六個時代標籤全部 0/60 通過，看起來很漂亮。

**然後既有測試打臉：** `exclusive medieval beats bikini pin for era` ——
使用者只選中世紀、釘了比基尼時，**時代要贏過釘選**。那是刻意的契約，
我那個「修正」正好把它拆了。已還原。

正確的做法是組合按鈕自己帶時代：`BUILTIN_PRESETS` 加 `era` 欄位，
按下去時由 UI 一起套進 `settings.eras`。這樣既不動契約，按鈕也真的有用。

**教訓：看起來像 bug 的東西，先找有沒有測試在守著它。**

### 新增 10 組時代組合

武士（samurai+dojo，江戶）、忍者（ninja+竹林）、花魁（oiran+旅館）、
騎士（knight+城堡，中世紀）、角鬥士（gladiator+列柱廊，古希臘）、
戰場（battlefield+戰旗，漢/中世紀/江戶）、漢服庭園（hanfu+中庭）、
宮廷（princess+宮殿）、維多利亞舞會（ballroom+晚禮服）、女巫（witch+森林）。

每一組實測：宣告的時代下 100/100 抽對時代，釘選的字 0/100 掉字。

### 連帶修掉的兩件

1. **`miko` 標成 `era:["edo"]` 是詞庫的錯。** 巫女服在 Danbooru 上壓倒性地
   出現在當代場景。以前沒被發現，是因為 `chooseEra()` 根本不讀 pin；一旦組合
   會帶時代，「神社巫女」就會被鎖死在江戶。改成 `["edo","modern"]`。
   修完再量：五組既有組合（溫泉／女僕／神社巫女／婚禮／道場）全部維持 modern:100，
   也就是**既有行為完全沒變**。
2. **四個新組合在 activity heat 下抽不到活動**（花魁/角鬥士/戰場/舞會）——
   釘的場地不在任何活動的 `ACT_PLACE` 裡。既有的自動測試抓到的。
   補了 ryokan / colonnade / battlefield / ballroom / great hall / tavern 到
   吃、喝、唱、跳舞、操練、健行底下。現在十組都是 0/40。

—— Opus 5

## Loop 1b：朋友看到「之前生成過的圖」

回報：預覽／輸出顯示的是先前生成過的舊圖。使用者自己沒遇到。

`/api/image` 送的是 `Cache-Control: private, max-age=86400`，而網址的鑰匙只有
`filename` / `subfolder` / `type`。ComfyUI 的 SaveImage 是**看輸出資料夾現有檔案**
來編號（`prefix_00001_.png`），所以只要那個資料夾被清空、或換機器重裝，
編號就從頭開始、檔名跟著重複 —— 瀏覽器在 24 小時內連問都不問，
直接把同檔名的舊圖畫上去。

**這解釋了為什麼只有他遇到**：輸出資料夾一直長大的人檔名永遠不重複；
清過（或重裝過）的人每次都重複。

改成 `no-cache` ＋ 內容 sha1 的 `ETag`：每次回來驗證，內容一樣才回 304。
拿假的 ComfyUI 實測過同檔名不同內容：

| 情況 | 修正後 |
|---|---|
| 同檔名、不同內容 | HTTP 200，拿到新的那張 |
| 同檔名、內容真的一樣 | HTTP 304，照樣省頻寬 |

回歸測試加在 `test_server.py`，並做過紅燈驗證（把 header 改回 max-age 會 FAIL）。
過程中自己踩到兩個：測試一度是 `def test_...` 但那個檔沒有 test 探索機制，
等於定義了卻從來沒跑（假綠）；改寫成該檔的 `ok(...)` 風格後又一度插在總結之後，
失敗不會影響結束碼。兩個都修了。

—— Opus 5

## Loop 2：色情模式開關（Opus 5）

左欄最上方新增「色情模式」開關。關掉之後：正面的 `nsfw, explicit` 換成
`sfw, general`，伺服器把 `nsfw/explicit/nude/nipples/…` 共 16 個字加進負面，
而且情色的字**根本抽不出來**。

### 分類器：heat 欄位完全幫不上忙

1304 個字裡有 1092 個的 heat 都是 `["tease","flash","sex"]`，從 `blue sky` 到
`bra` 全擠在同一格。所以另外定了一套 `sfwBlocked()`：
layer=skin／mutex=sex_act／group=flash／脫衣動作／內衣 mutex／heat 不含 tease／
情色字眼 regex／對胸部的動作（但 `mutex=breast_size` 是體型，留著）。

擋掉 242 個，留下 1062 個；實抽 4320 張後仍有 808 種不同的字可用。

### 三個實測抓到、規則沒抓到的洞

1. **釘選會繞過 allow()。** `forcePin` 本來就是「使用者說了算」，所以關掉色情模式
   之前釘的 `nude`、`sex` 會原封不動留在圖上 —— 實測 **60/60**。改成關閉時直接
   把這些釘選視為不存在（使用者的釘選沒被改掉，重新打開就回來）。
   反向也測了：色情模式開著時釘選照常 60/60 生效。
2. **`see-through shirt`、`micro bikini`、`slingshot swimsuit`、`revealing clothes`、
   `unbuttoned shirt`、`wet clothes`、臀部特寫、`naughty face`／`seductive smile`／
   `licking lips`** 都通過了規則。這些是抽 4320 張、把出現過的 822 種字全部
   列出來人工看過才發現的 —— **「規則寫對了」和「畫面乾淨」是兩件事。**
3. **`wet clothes` 一度被我放進「別誤擋」白名單**，理由是「淋濕不是情色」。
   但濕衣服就是透的。拿掉了。

### 實際生圖驗證（ComfyUI）

`sfw` 在 Danbooru 上 post_count 是 0，不是真的 tag —— Illustrious 系列拿 rating
當 token 訓練，所以它「可能」有效，但那是猜測，得看圖。生了兩張：

- seed 11：Polo 衫＋外套＋百褶裙＋球鞋，蹲在黃昏的運動場。完全乾淨。
- seed 42：短洋裝＋網襪，在更衣室蹲姿背向。**沒有裸露、沒有性**，但確實偏性感。

**這是個判斷題，我留給使用者決定**：目前的保證是「沒有性、沒有露點」，
字面上做到了。若要更保守，下一個該擋的是網襪、極短洋裝、以及背向臀部視角。

### 我自己改出來的 bug，被生圖抓到

**兩張圖裡都有一根蠟燭**，一根立在運動場草地上、一根在更衣室地板上。
原因是光源那一格裝的多半是「東西」而不是「光的性質」——`candle`、`chandelier`、
`fireplace`、`candelabra`，WAI 會照著畫出實體。以前光源幾乎抽不到（3%）所以沒人
發現，我把它改成每張都填之後就露餡了，實測 **2%** 的圖會有一根莫名其妙的蠟燭。
把這四個加進 `INDOOR_PROP`，現在戶外 0/2400，光源槽仍然 400/400 每張都填。

**這正是「改一個地方在別處生出新問題」——而且只有真的把圖生出來才看得到。**

—— Opus 5

## Loop 3：先收回我自己的一個錯誤指控（Opus 5）

### mustDraw 沒有「靜默失敗」的 bug —— 是我看錯

我先前寫「mustDraw 在浴場／泳池會漏掉，是既有 bug」。把 35 組必抽對象全部量過之後，
真正的情況是：

| 必抽的組 | 沒做到 | **有回報給使用者的** |
|---|---|---|
| `clothing:era` | 3/600 | **3** |
| `clothing:feet` | 12/600 | **12** |
| `pose:sex` | 378/600 | **378** |
| `feature:race` | 600/600 | **600** |

**每一次沒做到都會回報**（卡片上寫「互斥或尺度擋住了，沒有硬湊」）。
而沒做到的原因都是某條正確的規則擋住了：泳池裡不能穿鞋、誘惑尺度抽不到性愛姿勢、
只開女生時 race 標籤全是男性限定。`quality:*` 則在 `sanitizeMustDraw()` 就被擋掉，
UI 根本設不出來 —— 我那次測到 600/600，是我自己繞過清洗硬塞進去的。

**這個機制是好的，我不該動它。** 這條從待辦拿掉。

### 光源那一格裝的是「東西」不是「光的性質」（續）

上一輪修了 candle/chandelier/fireplace/candelabra。把剩下的也量了一遍：

| 組合 | 修正前 | 判斷 |
|---|---|---|
| `lamppost + indoors` | 40 | 路燈在室內 —— 錯 |
| `window light + outdoors` | 75 | 人在戶外卻打著窗光 —— 錯 |
| `ceiling light + outdoors` | 23 | 天花板燈在戶外 —— 錯 |
| `sunlight + indoors` | 48 | 對：陽光透進房間 |
| `torch + indoors` | 28 | 對：城堡牆上的火把 |
| `city lights + indoors` | 23 | 對：窗外的城市燈火 |

`ceiling light` 和 `window light` 是**舊有的問題**，不是我造成的 —— 但光源以前只有
3% 機率抽到，看不出來；我把它改成每張都填之後，絕對數量就浮上檯面了。
**「我沒有造成它」和「我讓它變得顯眼」是兩件事，兩件都要算在這次改動頭上。**

三個都修好，現在各 0/2400，光源槽仍然 2400/2400 每張都填。

—— Opus 5

## Loop 4：把「東西擺錯地方」這條掃完

光源只是其中一群。把所有非場地的 env 字都對著室內／室外量了一遍（2880 張）。

大部分兩邊都出現是對的（時間、光的性質、搬得動的道具）。真正搭不起來的：

| 組合 | 修正前 | |
|---|---|---|
| `lamp` 在戶外 | **115** | 桌燈／立燈搬到戶外（路燈是另一個字 lamppost） |
| `birdcage` 在戶外 | 31 | 鳥籠 |
| `folding screen` 在戶外 | 28 | 屏風是室內隔間 |
| `clock` 在戶外 | 22 | |
| `piano` 在戶外 | 19 | |

**同時有三個是我猜錯的**，量完才發現它們沒問題，所以沒有動：

- `statue` 在室內 27 次 —— 宮殿大廳的雕像，合理
- `arch` 在室內 27 次 —— 廳堂的拱門，合理
- `stone wall` 在室內 16 次 —— 城堡內側的石牆，合理

**如果照我一開始的直覺批次套用，會白白砍掉三個正確的組合。**

修完：室內物件跑到戶外 0/2880，刻意保留的那三個仍然出現 68 次，
光源槽仍然 2880/2880 每張都填。

`lamp` 改成室內限定之後，維多利亞的 `lamp` 從 46% 掉到室內 20%、戶外不出現；
每個時代室內外各有 11–17 種光源可選，最高佔比 30%。**沒有把任何一邊餓死。**

### 生圖驗證

江戶 seed 7：白無垢＋綿帽子＋打掛＋草履，配團扇與蓮花髮飾，黃昏海邊。時代讀得出來，
沒有亂入的東西。維多利亞 seed 23：公園裡的路燈**在戶外**（正是這次修的）、小提琴、
鋪紅布的桌子 —— 場景是連貫的。

—— Opus 5

## Loop 5：活動也會時代錯置，而且沒人查過

前幾輪查的都是「東西」（衣服、道具、光源、場地）。活動那一欄一直沒人對著時代看過。

起點是上一輪生圖時看到的怪組合：角鬥士在畫畫、忍者在海邊做日光浴。先量了
「職業 × 活動」的實際配對（3000 張、正常模式、開抽職業）：

- **現代職業被綁得很緊**：farmer 只配到 1 種活動、scientist 1 種、護士 4 種。
  因為 `JOB_PLACE` 把地點釘死，`ACT_PLACE` 再把活動限制在那個地點做得到的事。
  這是既有設計在正常運作。
- **我新加的時代職業完全沒有限制**：princess 33 種、samurai 28 種。
  因為我刻意沒給它們 `JOB_PLACE`（武士是身分不是工作地點）。

追下去才發現真正的問題不在職業，在**活動本身沒有時代把關**：

| 活動 | 古中國／古希臘／中世紀 | 事實 |
|---|---|---|
| `smoking` | 3% | 菸草 1500 年代才進歐洲 |
| `yoga` | 4% | 瑜伽墊那種畫面是現代的 |
| `playing guitar` | 3% | 吉他是 15 世紀以後的樂器 |
| `sunbathing` | 4% | 日光浴當休閒是 20 世紀的事 |

51 個活動裡有 18 個已經標成僅限現代（手機、自拍、開車、現代球類），
但這四個漏掉了，被當成「任何時代」。

修正：`smoking` → 現代／江戶／維多利亞（江戶有煙管），`playing guitar` → 現代／維多利亞，
`yoga` 與 `sunbathing` → 僅限現代。四個在古代時代都變成 0%。

**回頭確認沒有把活動池弄薄**：古代時代從 32 種降到 28 種，前三名佔比從 14% 到 17%，
沒有任何活動變成制服。職業×活動的組合從 613 種降到 578 種，而且剩下的都讀得通 ——
武士讀書／露營／游泳、角鬥士操練／沐浴、女祭司煮飯／唱歌。

### 一個刻意不動的地方

時代職業仍然可以做 25~31 種活動。那是設計如此：公主可以健行、可以讀書、可以釣魚。
不打算像現代職業那樣用地點把它們鎖死 —— 那會讓這些新身分變得死板。

—— Opus 5

## Loop 6：正常模式說「不抽男人人種」，但有一個從旁邊溜過去

掃 feature/pose 各組的集中度時看到一個離譜的數字：
**`feature/race` 詞庫 37 個，實際只抽到 1 個，`monster boy` 佔 100%。**

追下去發現兩件事，只有一件是 bug：

### 不是 bug 的那件

`monster boy` 在多元模式佔 64%，是因為 `goblin` 等 36 個具體人種都 **implies**
它 —— 它是傘狀父標籤。207 次出現裡有 183 次是跟著具體人種一起來的。
**這是 implication 正常運作，不是集中。** 多元模式下 37 種全部抽得到。

### 是 bug 的那件

正常模式的規則寫成 `item.mutex === "race"`，而 `monster boy` 是
`group: "race"` 但 `mutex: null`（傘狀標籤不佔互斥格）。於是它從規則旁邊溜過去：
**正常模式每 800 張會冒出 41 個光禿禿的「怪物男」**，而畫面上說好的是「不抽男人人種」。

而且因為具體人種被擋住，它只能單獨出現 —— 沒有 goblin、沒有 oni，就一個「怪物男」。

改成看 `group === "race"`，兩個判斷點都改（`allow()` 與一般補牌）。

| | 修正前 | 修正後 |
|---|---|---|
| 正常模式抽到人種 | 41/800 | **0/800** |
| 多元模式種數 | 37 | 37（不變） |
| 正常模式釘 goblin | 60/60 | 60/60（`!pinned` 例外沒被動到） |

**教訓：規則寫在 mutex 上，傘狀標籤就會從旁邊走過去。** 這和先前
「釘選繞過 SFW 過濾」是同一種形狀 —— 規則掛錯了層級。

—— Opus 5

## Loop 7：把上一個 bug 的形狀拿去掃全部，結果是乾淨的

上一輪學到「規則寫在 mutex 上，傘狀標籤就會從旁邊走過去」。這輪把它變成系統性的檢查：
engine.js 有 **22 種** `item.mutex === "X"` 的判斷，對每一種找出「group 是 X、
但 mutex 不是 X」的成員 —— 那些就是潛在的漏網者。

找到 6 組有落差，但**逐一量過之後，只有上一輪修掉的 `monster boy` 是真的 bug**：

| 傘狀標籤 | 量出來的結果 | 判斷 |
|---|---|---|
| `dress`/`swimsuit`/`bikini`（group onepiece, mutex null） | 單獨出現又配上下身 **0/2880** | 只會跟著具體款式一起來，正常 |
| `two-tone hair`/`gradient hair`（group hair_color） | 沒有底色 **0/2880** | 正常 |
| 眼睛細節（group eyes, mutex null） | 沒有瞳色 **0/2880** | 正常 |
| `blunt bangs`/`wavy hair`（group hair_style, mutex null） | 「沒有髮型」1634/2880 | **不是 bug**：有 mutex 的是綁髮（馬尾／辮子／丸子），mutex null 的是瀏海與髮質，而**每張圖都有髮長 0/2400 缺**，頭髮本來就描述完整了 |
| `skirt`/`shorts`/`pants`、`jacket`/`coat` | 有 `bodyGarmentSlot()` 已經 fallback 到 group | Codex 當初就處理掉了 |

**那個 1634/2880 差點被我當成 bug。** 先去看 mutex 的成員是什麼、再確認髮長永遠都在，
才確定它是對的。如果照數字大小排優先序，這會是這輪最「嚴重」的發現。

### 順帶驗證的三件，也都乾淨

- **多人畫面**：solo 配上需要兩人的字 0/2880、solo 與多人同時出現 0/2880。
  多人圖沒有互動字的有 38%，但兩個人同框各做各的本來就是合理構圖，不動。
- **天氣**：室內出現天氣字 0/2880。
- **Token 預算**（使用者說「不要管 75，不要超過太多」）：拿 ComfyUI 自己的 CLIP
  tokenizer 實際量 288 張 —— 平均 **98**、最小 77、最大 112，
  **288 張全部剛好用 2 個 75-token chunk，沒有一張需要第 3 個**。
  第二個 chunk 只裝了三分之一。這一輪加的道具、光源、職業沒有把預算吃掉。
  （我自己那個粗估法算出 115，比實際多 17% —— 估算法不可靠，該用真的 tokenizer。）

### 這輪沒有改任何程式碼

連續六輪每輪都找到一個 bug 之後，這輪的系統性掃描是乾淨的。**沒有為了交差去改東西。**
這類「規則掛錯層級」的 bug 看起來已經收斂了；下一輪該換一個角度找，
而不是把同一把尺再量一次。

—— Opus 5

## Loop 8：「同一個人」只鎖了一半

換角度找，挑了一個從來沒量過的使用者承諾：面板上那個「同一個人」開關，
說明寫著「多張鎖髮瞳胸，衣場照抽」。

照 `boot.js` 的批次流程重現（第一張自由抽，抽完把身分特徵取出來當釘選，
之後每張都帶著），跑 960 批、每批 5 張：

```
第一張抽不出身分特徵的批次： 0
身分在批次中途變掉的批次：   685/960
```

**七成的批次會漂移。** 但方向很一致 —— **第一張的特徵一次都沒掉（0 次），
全部都是「多出來」**：

| 多出來的組 | 次數 | 最常見 |
|---|---|---|
| hair_style | 1004 | ahoge、bangs、parted bangs、straight hair、messy hair、sidelocks |
| body_m | 316 | muscular、skinny、plump |

根因：`identityPins()` 只把**第一張抽到的**釘起來。第一張**沒有**的欄位在後面幾張
仍然是空的、可以自由補 —— 而 `ahoge`、`bangs` 這些 `mutex: null`，永遠補得進去。
於是同一個人在第三張突然長出一撮呆毛，或整個人變得肌肉發達。

**這和 `monster boy` 是同一種形狀**：鎖的機制只認「有的東西」，
沒有處理「沒有的東西」。

修法：新增 `identityBans()` —— 同一個人就是同一個人，身分特徵要**剛好等於**
第一張那一組，多的一律不准。被釘選連帶帶出來的父標籤已經在 pins 裡，不會誤禁。

| | 修正前 | 修正後 |
|---|---|---|
| 身分漂移的批次 | 685/960 | **0/960** |
| 第一張特徵掉了 | 0 | 0（沒有破壞） |
| 衣服仍有變化 | — | **600/600** |
| 場景仍有變化 | — | **600/600** |
| 每張 tag 數 | 36.5 / 36.1 | 幾乎不變，沒有餓死任何一段 |

**回頭確認「衣場照抽」那半句仍然成立**是這次最重要的檢查 —— 一口氣禁掉 110 個
身分 tag 之中的一百來個，很容易把後面幾張鎖死。量完確定衣服和場景每一批都還在變。

—— Opus 5

## Loop 9：查「禁掉的東西會不會從旁邊回來」，順手抓到自己種下的一個

延續上一輪的角度（規則只認「有的東西」，不認「沒有的東西」），這輪查兩個機制。

### 禁用是乾淨的

使用者禁掉一個父標籤之後，子標籤會不會把它拉回來？拿 8 個子標籤最多的父標籤
各跑 1200 張：

| 父標籤 | 子標籤數 | 父標籤仍出現 | 子標籤仍出現 |
|---|---|---|---|
| indoors / outdoors | 各 67 | 0/1200 | 0/1200 |
| sex | 42 | 0/1200 | 0/1200 |
| shirt / dress / skirt | 16/15/11 | 0/1200 | 0/1200 |

禁用會連同整條 implies 鏈一起擋掉。**這個機制沒問題。**

### 但「只勾活動」的承諾破了 —— 而且是我弄的

面板上寫「只勾活動＝日常（購物、煮飯、游泳），**沒有走光或做愛**」。
只勾活動跑 3000 張，漏出 **2 張全裸**。

追回去是我自己的改動：浴場補救那一段（服裝先於場地決定，場地選到浴場之後
衣服被掃掉，這裡再補一件）的池子裡含裸標。我當初把裸標放進去，是為了修
「medieval/victorian 浴場什麼都沒交代」那個 bug —— 於是那一格從「什麼都沒有」
變成了「可能是全裸」。在性愛尺度那沒問題，在日常尺度就違背了畫面上的承諾。

修法：只勾活動時，**有衣服可穿就穿衣服，真的一件都沒有才退回裸標**
（直接把裸標拿掉的話，浴場會退回「什麼都沒交代」的老 bug）。

| | 修正前 | 修正後 |
|---|---|---|
| 只勾活動的裸標 | 2/3000 | **0/3000** |
| 只勾活動的浴場身體沒交代 | 0 | **0**（老 bug 沒有回來） |
| 走光尺度的裸標 | 397/1800 | 397/1800（沒被誤傷） |
| 性愛尺度的裸標 | 805/1800 | 805/1800（沒被誤傷） |

**這是「修好一個問題、同時種下另一個」的實例**，而且中間隔了好幾輪才被抓到。
抓到的方法不是回頭看自己的 diff，是去驗一句畫面上寫給使用者看的承諾。

—— Opus 5

## Loop 10：把畫面上每一句承諾都當成不變式來驗

上一輪的教訓（bug 是靠「驗一句寫給使用者看的承諾」抓到的，不是靠看自己的 diff）
變成這輪的方法：把 `index.html` 裡每一句說明都當成一條可以量的規則。

### 三句驗過、成立的

| 承諾 | 量法 | 結果 |
|---|---|---|
| 「點女＝只有女生，男生的字也不會抽到」 | 只開女生 2880 張找 male-gated；只開男生 2880 張找 female-gated | **各 0 種** |
| 「釘選的衣服一定進圖」 | **全部 255 件** 穿在身上的衣服逐件釘，每件 72 張 | **0/255 會掉**（共 18360 張） |
| 「設成 0＝不做額外隨機補牌，必要骨架仍保留」 | 四段各在 0／預設／10 下量 | 四段都會動，0 時骨架 100% 還在 |

`muscular` / `skinny` / `plump` 一度看起來像漏出來的男性標籤（它們在 `body_m` 組），
查了 gate 才發現是 `gate: "any"` —— 刻意的中性體型，只是分組名字容易誤會。**不是漏洞。**

### 一句被我自己弄鈍的

環境那段在 `counts=0` 和預設值 4 之下**都是 5.4 個字** —— 滑桿在 0~5 之間完全沒效果。
原因是我這幾輪替環境加了兩格（光源、年代道具），把骨架從 4 撐到 5.4，
於是預設的 4 再也擋不住。

場地、室內外、日夜、光源是骨架（每張圖都得有），但**一件年代道具是裝飾**。
把道具那一格改成跟著 `counts.env` 走：

| counts.env | 修正前 env 字數 | 修正後 |
|---|---|---|
| 0 | 5.4 | **4.6** |
| 4（預設） | 5.4 | 5.4 |
| 10 | 10.1 | 10.1 |

1~5 之間仍然是平的，因為骨架本身就那麼大 —— 這一點畫面上本來就寫了
「實際數量可能超過目標」，不算違背。

**記一筆：我前面加的每一格都會把骨架墊高一點，而骨架墊高就會讓使用者的滑桿變鈍。
加格子的時候要問一句「這是骨架還是裝飾」。**

—— Opus 5

## Loop 11：宮廷的平底鍋 —— 以及它背後 130 個場地的問題

使用者回報：選「宮廷」組合會一直抽到平底鍋。**實測 52%。**

### 追下去不是宮廷的問題，是整張表的問題

正常模式（realistic）下 `placeFitsActs()` 走的是嚴格分支：
**「有 ACT_PLACE 表的活動，必須把該場地明確列進去」**，沒列到就等於在那裡做不了那件事。
而只有 `cooking` 把 `palace` 列了進去 —— 於是宮殿裡唯一做得了的事就是煮飯，
`stampActProps()` 再補上平底鍋。

量了全部 130 個場地：

| 能配的活動數 | 修正前 | 修正後 |
|---|---|---|
| **只有 1 個** | **39 個場地** | 31 |
| 2–3 個 | 34 | 28 |
| 4–6 個 | 38 | 43 |
| 7 個以上 | 19 | 28 |

**超過一半的場地（73/130）活動格幾乎是鎖死的。**

### 根因和前面每一次都一樣

`MEAL_PLACE`（8 個）、`DESK_PLACE`（10 個）、`HOME_PLACE`（4 個）這三組類別
只列了現代的房間。吃飯、讀書、寫字、玩遊戲全都靠它們，所以宮殿、城堡、旅館、
公寓、宿舍、涼亭、陽台、帳篷…一律做不了這些事。

修法是補這三組類別，而不是逐個活動去補 —— 一次修好所有用到它們的活動。

| 組合 | 平底鍋（修正前 → 後） | 活動種數 |
|---|---|---|
| 宮廷 | **52% → 10%** | 2 → 7 |
| 騎士 | **28% → 9%** | 3 → 8 |
| 其餘八組 | 0% | 3~12 |

### 一個我差點誤判的

「維多利亞舞會抽不到跳舞」看起來像 bug —— 查了才發現 `dancing` 是
`mutex: "body_pose"`（姿勢）不是 `mutex: "activity"`（活動），而且
`heat: ["tease","flash"]`。它在另一個格子裡，我的統計只看了活動格。**不是漏掉。**

### 教訓（第七次同一個形狀）

這是「表只為常見情況填好，其他情況沒人回頭補」的第七次：
浴場服裝白名單 → 性愛場地 → 時代光源 → 時代道具 → 時代職業 → 時代活動 → **場地×活動**。

差別在這次是**使用者先看到的**。我前面十輪都在自己找角度，
而「選宮廷一直出現平底鍋」是一句具體的觀察，五分鐘就定位到根因。
**下次該更早去問：實際用起來哪裡怪？**

—— Opus 5

### 補記：兩條既有契約當場擋下我的改法

第一版我把 `castle` 也加進 `DESK_PLACE`，跑測試立刻紅兩條：

- **`normal studying never castle/beach/onsen`** —— 明講不要在城堡唸書。
  那是有意的內容契約，我一加 castle 就撞掉了。撤回。
- **`normal reading always has a reading place`** —— 那條測試裡有一份人工維護的
  「可以看書的地方」清單，我加進 `DESK_PLACE` 的新場地不在上面。

第二條我判斷是清單該更新（在公寓、宿舍、旅館房間、宮殿裡看書都很正常），
但**只補我自己也同意的那些**，而不是把清單改成照抄 `DESK_PLACE` ——
那樣等於把尺自己改短。城堡、大廳、酒館、舞廳、神殿一律沒有列進去。

`castle` 留在 `MEAL_PLACE` 和 `HOME_PLACE`（在城堡裡吃飯、玩牌是合理的），
只是不在 `DESK_PLACE`。騎士組合的平底鍋因此從 9% 回到 16%（原本 28%）—— 
比第一版差一點，但沒有為了數字去撞契約。

**這是這個 session 第三次「看起來像 bug、其實有測試在守著」。**

## Loop 12：兩段改三段（使用者提議的 sensitive）

使用者問要不要加一個「敏感」檔位。**要，而且它正好解掉我自己先前留下的那個判斷題** ——
我在做色情模式時說過「保證是沒有性、沒有露點，但不等於不性感」，並把界線留給使用者決定。
兩段制的問題在於「關掉色情」那一檔同時要負責「乾淨」和「不色情」，兩件事做不好。

### 先查事實再建議

- `general` / `sensitive` / `questionable` / `explicit` 是 **Danbooru 自己的 rating 階梯**。
- 但這六個字在 Danbooru 上 **post_count 全是 0** —— 它們是 rating metadata 不是 tag。
  Illustrious 系列拿 rating 當 token 訓練，所以模型吃這一套（現在的 `nsfw, explicit` 有效就是這個道理）。
- 中間層有沒有料？目前被擋的 242 個字裡，大約 117 個是硬性（性行為、裸露），
  其餘是軟性（乳溝、彎腰、張腿、跪趴、挑逗表情、網襪）。**夠撐起一個檔位。**

使用者選：三段、UI 改成三點滑桿、敏感**不含內衣與走光**。

### group="flash" 混了兩種東西

這一組 61 個字裡同時有：

- **掀裙、拉衣、走光、滑落** —— 那是脫衣，只有 explicit 能有
- **彎腰、張腿、跪趴、跨坐** —— 穿著衣服擺姿勢，**正是 sensitive 的內容**

整組擋掉的話 sensitive 會被掏空。改用「動作字根」分：
`lift|pull|aside|slip|undress|flashing|wedgie|grab|tweak` → explicit，其餘留給 sensitive。
**又一次驗證「group 不等於概念」。**

### 第一版錯了兩處，都是量出來的

1. **拿 heat 當鑰匙會掏空 sensitive。** flash 檔的姿勢 heat 裡本來就沒有 tease，
   `!heat.includes("tease")` 一條就把 bent over / spread legs / straddling 全擋掉了。拿掉。
2. **沿用 general 的 regex 太寬** —— 那條連 `cleavage`、`crotch` 都擋。
   explicit 另寫一條窄的。

### 修完之後又抓到兩個漏

- **`nipple` 配不到 `nipples`**（字尾 s 破壞了 word boundary），
  於是 `pink nipples` 漏進**全年齡**。`cum` 也配不到 `cumdrip`。字根改成吃複數。
- **`ejaculation`、`cumdrip`、`masturbation` 是 `group:"sex"` 但 `mutex:null`** ——
  規則寫成 `mutex === "sex_act"`，它們整批從旁邊走進 sensitive。
  **這是這個 session 第四次踩到「規則掛錯層級」**，而且是我自己剛寫下那條教訓之後又踩的。

### 結果

| 檔位 | 擋掉 | 可用字 | 實抽 1440 張的漏出 |
|---|---|---|---|
| 全年齡 | 304 | 1000 | **0** |
| 敏感 | 216 | 1088 | **0** |
| 色情 | 0 | 1304 | **0** |

同一個 seed 的三張：全年齡是浴袍＋大小姐姿勢；敏感是緊身衣＋網襪＋蹲姿；色情維持原樣。

順帶把全年齡收得更嚴（網襪、極短洋裝、吊襪帶、露肩），因為現在它們有 sensitive 可以去 ——
這正是我先前留給使用者的那個判斷題的答案。

舊存檔的布林 `sfw` 會對應到全年齡，伺服器的 `negative_for()` 也保留布林相容。

—— Opus 5

## Loop 13：溫泉裡的拳擊手套、棒球帽、項圈 —— 以及 Codex 那個提案的裁決

### 一、使用者回報的配件 bug

「正常模式 + 溫泉」會抽到拳擊手套、棒球帽、項圈。實測比回報的還嚴重：
600 張溫泉圖裡 **collar 428 次（71%）、gloves 275、goggles 195、baseball cap 147**，
還有 elbow gloves、animal collar、swim cap。泡湯戴著手套、棒球帽和寵物項圈。

根因：`SCENE_BAD_ACC.bath` 是一份**只有 13 樣的黑名單**。配件有 79 個，
「下水時會脫掉什麼」是開放集合 —— 黑名單註定有洞。**這是這個 session 第八次
同一個形狀。**

改成白名單（封閉集合）：只留真的會戴著下水的東西 —— 盤頭髮的髮飾、戒指耳環、
眼鏡、毛巾、赤腳；游泳另外加蛙鏡、泳帽、泳圈。

#### 但我第一版把它修壞了

改成白名單之後，**hair ornament / glasses / barefoot 變成 600/600 每張都有**。
從「71% 項圈」換成「100% 髮飾」，一樣不對。

再量才看懂真正的問題：**溫泉圖平均 4.6 件配件、0.8 件衣服；一般場景是
0.7 件配件、5.4 件衣服。** 服裝段的目標數不知道浴場沒什麼好穿的，衣服被場景掃掉
之後，那個額度**整批轉去補配件**。以前填的是項圈手套，改白名單之後填的變成髮飾眼鏡
—— **問題從來不是「填什麼」，是「不該填那麼多」。**

修法：水上場景的服裝目標數上限設為 3。結果：配件 4.6 → **2.6**，
沒有任何一樣是 100%（散在 35~46%），一般場景完全不變（0.6 件配件、5.4 件衣服）。

**過程中還踩了一個坑**：我第一版把上限寫在 `fill()` 的過濾函式裡數已用配件 ——
那個函式是**先把整池篩完才開始 commit**，計數在裡面永遠是 0，完全沒有作用。
用 debug 印出來才發現（`{"n":0,"cap":2,"ok":true}` × 7）。上限必須下在 `want`。

#### 順手掃了全部 20 種場景

`SCENE_BAD_ACC` 只替 8 種場景寫了黑名單，`sceneClothKind()` 認得 20 種 ——
其餘 12 種完全不過濾配件，造成各場景都有 3% 左右的蛙鏡／手套／護目鏡。
把「需要場合才成立的配件」寫成資料表 `ACC_NEEDS_CONTEXT`（蛙鏡要有游泳或實驗室、
麥克風要有唱歌、拳擊手套要有拳擊、寵物項圈與牽繩要有 pet play）。
辦公室的蛙鏡、睡覺的泳帽都清掉了。

`collar` 7% 保留：實測它**從來不會單獨出現**（0/2400），都是跟著具體項圈
（black/red/detached/mandarin collar）一起來的 —— 那是 implication 正常運作，
而那些是正常的頸飾。

### 二、Codex 的 implication 壓縮提案：不採用，但問題是真的

Codex 說輸出有太多父子 tag（1074 組 / 200 張），建議在序列化前把三層服裝鏈的
**祖父**拿掉。我拿 Danbooru API 逐條查證之後，**這個提案的方向是反的**。

關鍵事實：**Danbooru 會把 implication 自動套用到每一張圖**。所以
`one-piece_swimsuit -> swimsuit` 是 active 的話，訓練集裡每一張 competition swimsuit
的圖都同時帶著三個字 —— **三個字一起寫才是訓練時的樣子**，拿掉祖父反而離開分布。

而 Codex 舉的例子裡：

| pair | Danbooru |
|---|---|
| `sports_bra -> bra` | **不存在** |
| `microskirt -> miniskirt` | **不存在**（是 microskirt -> skirt） |
| `flat_chest -> small_breasts` | **不存在** |
| `competition_swimsuit` 的閉包 | **= 我們的，完全一樣** |

也就是說：Codex 的規則會刪掉**正確**的 `swimsuit`，而留下**錯誤**的 `bra` 和
`miniskirt` —— 在它自己舉的例子上剛好弄反。

真正的問題不在輸出階段，在**資料**：我們的詞庫寫了 Danbooru 沒有的分類主張。

#### 全庫查證（443 條逐條打 API）

| | |
|---|---|
| 對得上 Danbooru | 167 |
| 我們有、Danbooru 沒有 | 276 |
| Danbooru 有、我們漏掉 | 27 |

**但「Danbooru 沒有」不等於「錯」**：276 條裡有 128 條是 env
（`bedroom -> indoors`），那是我們自己的場景機制，室內外一致性全靠它；
還有 job -> 服裝（`nurse -> nurse cap`、`samurai -> japanese armor`）、
race -> monster boy、性愛動作 -> sex。這些都是刻意的、承重的。

**真正的缺陷訊號更窄：Danbooru 對同一個 child 指向「不同的」parent** ——
那才是我們做了假的分類主張，而且當兩者還共用同一個 mutex 時會實際造成傷害。

#### 動的四條

1. `sports bra -> bra`（含三個顏色款）—— 運動內衣在 Danbooru 分類裡不是 bra。
   來源是 `SUFFIX_PARENT` 這條泛用規則（「X 什麼」就 implies「什麼」）。
   那條規則對「顏色＋衣服」很準（blue bra、track jacket、white panties 都真的有），
   但**複合名詞不一定是那個東西的一種**。加了查證過的例外表而不是拆掉規則。
2. `microskirt -> miniskirt` —— Danbooru 是 microskirt -> skirt，兩者是兄弟；
   而且**兩個都是 mutex=bottom**，硬串等於在同一格塞兩件下著。
3. `flat chest -> small breasts` —— Danbooru 沒有，兩個都是 `mutex=breast_size`。
   平胸和小胸是同一把尺上的兩個點，不是父子。**實測 17% 的圖同時寫著兩個。**
4. `loli -> small breasts` —— 同上。

#### 結果（用 Codex 自己的設定與 seed 重量）

| | Codex 量到 | 修正後 |
|---|---|---|
| 父子 pair | 1074（每張 5.37） | **923（每張 4.62）** |
| 三層鏈 | 52/200 張 | **13 次** |
| 平胸＋小胸同時出現 | 35 | **0** |
| 平均 tag | 37.77 | 37.27 |

**達成了 Codex 想要的效果的大部分，但是改資料而不是改輸出** —— 所以內部語意
狀態也一起修好了（mutex、相容性判斷看到的是同一份正確資料），而且**沒有動到
任何一條真的存在的 implication**。`competition swimsuit` 仍然是三層，因為那是對的。

#### 對自己的反方論證

- 我原本沒有做 A/B 出圖，所以「改善畫面」一度**沒有實證**。我主張的是
  「資料與 Danbooru 一致」和「移除同一互斥格內的矛盾」，這兩點不需要出圖就成立。
  後來補做了（見下節），結論是「沒有變差」，不是「變好」—— 這個區別要講清楚。
- `contradictions()` 回報 0，卻有 17% 的圖同時寫著平胸和小胸 ——
  **Codex 提醒「0 只代表檢查器沒找到」是對的**，這次正好被它說中。
- 若之後出圖顯示 `sports bra` 少了 `bra` 會畫歪，這四條都可以單獨回退，
  改動是資料層的六行。

#### 補做的 A/B 出圖（Codex 的驗收條件）

Codex 要求「A/B 過才算改善」，所以四條各自出圖對照。用他指定的 seed 7001/7003/7009，
其餘提示詞逐字相同，只差被拿掉的那個字。

| 條目 | 舊（有那個字） | 新（拿掉） | 判讀 |
| --- | --- | --- | --- |
| `sports bra -> bra` | 黑色運動內衣＋短褲 | 同樣的運動內衣＋短褲 | 衣服沒掉，構圖僅微幅位移 |
| `microskirt -> miniskirt` | 白 T＋深色超短百褶裙 | 白 T＋深色超短裙（更短、帶荷葉邊） | 仍是超短裙，沒有變長 |
| `flat chest -> small breasts` | 明確女性 | 明確女性、無中性化 | 原本假設的「怕畫成中性」不成立 |

`loli` 那條是前三條的組合，沒有獨立的視覺變數，不另外出圖。

**這組圖能證明的**：拿掉那四個字不會讓對應的衣服或體型消失。
**這組圖不能證明的**：畫面變好。它們幾乎一模一樣 —— 這正是預期結果，
因為那四個字本來就是訓練集裡沒有的雜訊，SDXL 對雜訊字的反應本來就該接近無視。
真正的收益在提示詞預算（37.77 -> 37.27 字）與三連鎖 52/200 -> 13，不在單張畫質。

#### 順手清掉自己剛寫的重複守門

`ACC_NEEDS_CONTEXT` 這張表寫完之後，`helmet` 和 `microphone` 兩項底下
**還留著舊的手寫規則**，而舊規則比表裡寫的窄：

- 表寫 helmet 可配 `stadium / playing sports / armor / plate armor / knight`，
  舊規則只准 `riding bicycle / construction worker / construction site / skiing`。
- 表寫 microphone 可配 `karaoke box / idol / stage / bar (place) / festival`，
  舊規則只准 `singing / karaoke`。

兩道閘串聯，實際行為是交集，也就是舊規則。多寫的那些字一個都沒有作用 ——
但讀表的人會以為准。這正是 Codex 那份 brief 想解的「同一條規則散在兩個地方」，
只是這次是我自己剛製造的。

處理方式：把表改成舊規則的原集合，刪掉手寫的那兩條，讓守門只有一個地方。
**行為不變是量測出來的，不是推論**：拿去重前後兩個版本，
3 種人物 × 3 個分級 × 700 seed = 6300 張逐字比對，**不一樣 0 張**。

順帶量到一件事：6300 張裡 `helmet` 只出現 1 張。這個窄是舊規則本來就有的，
不是這次改出來的，先記著不動 —— 騎士戴頭盔講得通，但那是擴大行為，
跟修這個 bug 是兩件事。

#### 六套測試

`test_engine` / `test_lexicon_integrity` / `test_draw_contracts` /
`audit_draw_invariants` / `test_server` / `test_server_live` 全綠。
`test_engine` 裡有 7 條是在斷言被拿掉的那四條 implication ——
逐條讀過、確認沒有寫下任何理由，其中 `flat chest` 那條我還特地假設了
「是為了出圖品質」並出圖驗證，假設不成立，才改寫成修正後的資料快照。
seed 42 金標同步重生，差異只有 `sports bra` 後面少一個 `bra`，其餘 byte-identical。

—— Opus 5

## Loop 14：我上一輪的修法自己就是個 bug

使用者要求「再次深度檢查，你改的不一定對」。所以這一輪從懷疑自己開始 ——
上一輪剛加的 `ACC_NEEDS_CONTEXT` 是一張**用來擋**的表，而擋東西的規則一定會擋過頭，
問題只在擋掉了誰。

### 一、我把五個字擋到永遠抽不到，而六套測試全綠

拿 HEAD~2 跟當時的 HEAD 各抽 4320 張逐字比可達性：

| tag | 改之前 | 我改完 |
| --- | --- | --- |
| `animal collar` | 86 | **0** |
| `leash` | 19 | **0** |
| `clipboard` | 15 | **0** |
| `handcuffs` | 14 | **0** |
| `knee pads` | 13 | **0** |

原因是**順序**：`fill("clothing")` 在第 4512 行就把衣服填完了，而
`fillSlot("env","place")` 在 4625、`fillSlot("pose","activity")` 在 4598 ——
都在那之後。`allow()` 看到的 `used` 裡根本還沒有場地和活動，
所以「沒有場合」這個條件對這些配件**永遠成立**。

更難看的是我為什麼會這樣寫：我照抄了旁邊的 `police hat` 要 `policewoman`、
`nurse cap` 要 `nurse`。那兩條之所以能用，純粹因為職業在
`fillSlot("feature","job")` 就定了，剛好排在衣服前面。
**我抄到的是一個依賴排序的巧合，不是一條規則。**

修法：把檢查搬到全部填完、`reconcile()` 之前 —— 旁邊的 `ACT_PROP` 收尾
用的就是同一個位置。guard 用 `mustPins()` 而不是 `pinned`，必抽的字也保得住。

### 二、擋完之後還缺正向的一半

搬對位置之後那五個字回來了，但只有個位數。原因是配件只能靠「瞎抽剛好碰上場合」
存活 —— 釘住 `pet play` 抽 400 張，`leash` 出現 **0** 次；釘 `boxing`，
拳擊手套 4 次；釘 `armor`，肩甲 0 次。

對照組講得很清楚：`microphone` 釘 `singing` 是 **400/400**，
因為 `stampActProps()` 會在活動定下來之後把麥克風**拉進來**。
負向擋、正向拉，我只做了一半。

補上 `CTX_PULLS_ACC` 之後（擲骰子不是必定 —— 無條件蓋章正是宮廷 52% 拿平底鍋的原因）：

| 釘住場合 | 配件 | 修之前 | 現在 |
| --- | --- | --- | --- |
| boxing | boxing gloves | 4/400 | 218/400 |
| pet play | animal collar | 7/400 | 164/400 |
| pet play | leash | 0/400 | 99/400 |
| bondage | handcuffs | 0/400 | 113/400 |
| playing sports | knee pads | 0/400 | 117/400 |
| riding bicycle | bicycle helmet | 5/400 | 168/400 |
| armor（限中世紀） | shoulder armor | 0/400 | 178/400 |

最後一列是舊版也做不到的 —— 肩甲在改之前就是 0，不是我弄壞的，是順便修好的。

沒有收進去的：`clipboard` 和 `o-ring`。辦公室不代表有寫字板，比基尼不代表有 O 環，
那是我自己想出來的關聯。硬收進來只是為了讓數字不是 0，那是替指標作答。

### 三、三條新測試，兩種紅燈都驗過

測試從 `engine.js` **import** 那兩張表，不抄第二份 —— 抄一份就會各走各的。

對著「有 bug 的版本」實跑驗紅燈：

- 把檢查搬回 `allow()`（我的第二版）→ **「釘住場合之後配對的配件抽得到」紅**，
  一次抓出 7 個字。而「沒有場合就不該出現」是綠的 —— 過度阻擋本來就不違反那條。
- 對著 HEAD~2 的黑名單版 → **「配件沒有場合就不該出現」紅**，9 種配件、144 次，
  正是使用者回報的那個 bug。

兩條測試各守一邊，缺一邊就會漏掉另一種壞法。

### 四、追一個 6 -> 0 追出一個更大的洞

可達性比對裡有兩個小數字：`ocean` 6→0、`underwater` 5→0（18000 張）。
小到可以當雜訊，但兩個同時剛好歸零不太像巧合，所以追了下去。

同 seed 逐字 diff 顯示每一次都是 `ocean` 換成 `pool`，而且舊圖裡都帶著
被我拿掉的 `boxing gloves, gloves` —— 少了兩個字，RNG 往後移，位置就換人。
也就是說**不是被擋死，是機率太小被擠掉**。

驗證方法：把競爭者禁掉。禁 `pool` → ocean 8、beach 7；再禁 `poolside` →
ocean 21、beach 24。結構上通的，是被餓死的。

而那一查才看到真正的問題：**`beach` 在新舊兩版都是 0 / 18000。**

`fillSlot("env","place")` 的 env 預設偏好是**硬桶**：時代專屬的抽乾了才輪到
`era:["any"]`。場地只有一格，所以「輪到」幾乎不會發生：

| era | 詞庫 時代專屬 / 中性 | 中性實際佔比 |
| --- | --- | --- |
| modern | 86 / 16 | **5%** |
| ancient_china | 21 / 16 | **2%** |
| edo | 23 / 16 | **5%** |
| victorian | 19 / 16 | **4%** |

這個檔案自己早就想通過一次 —— `fill(section)` 那裡的註解寫著
「`era:["any"]` 的意思是每個時代都能用，不是次等候選」，所以 `fill("env")`
早就拿掉了 prefer。燈光那一格也是同一個病，用 4:1 軟權重修好的。
**漏掉的就是場地這一格。**

改成同樣的 4:1 之後：

| | 修之前 | 現在 |
| --- | --- | --- |
| beach | 0 | 139 |
| ocean | 0（舊版 6） | 127 |
| underwater | 0（舊版 5） | 96 |
| pool | 560 | 406 |
| poolside | 389 | 324 |

中性場地從 2–5% 拉到 9–26%，而 pool 只是讓出份額、沒有被餓死。

要講清楚的是**這一改沒有動到** `castle` 70%、`chinese architecture` 67%。
那兩個來自 `stampAnchors("env")` 的無條件蓋章，是另一套機制、有自己的測試在守
（「medieval + bikini pin still stamps armor/castle」），不在這次範圍裡。

### 五、這一輪學到的

1. **加一條「擋」的規則，要同時量「還抽得到嗎」。** 我只量了「壞東西不見了」，
   沒量「好東西還在不在」，於是五個字歸零而六套測試全綠。
2. **抄旁邊那條規則之前，先問它為什麼能動。** `police hat` 能用是因為排序巧合。
3. **小到像雜訊的數字值得追一次。** 6→0 追下去才看到 beach 在兩版都是 0。
4. **同一個病會在不同的格子復發。** 硬桶餓死中性字，燈光修過一次，場地又來一次；
   下次看到 `prefer` 是硬排序就該直接懷疑。

—— Opus 5

## Loop 15：左側面板的組合掃描

使用者問的是「不同組合搭起來會不會奇怪、矛盾、或太死板」。所以不猜，直接把面板的
交叉組合掃過一遍：分級 × 尺度 × 人物 × 場景模式 × 時代 = 540 組，每組 80 張。
量四件事：分級尾巴跟畫面對不對得上、單一 tag 佔掉某一格多少、抽得出幾種字、有沒有整段空掉。

沒有任何一組會丟例外。但抓到四件事，其中兩件是**我自己造成的**。

### 一、太死板：奇葩模式反而最單調

| 場景模式 | medieval 抽到 castle 的比例 |
| --- | --- |
| 正常 | 19% |
| 多元 | 62%（性愛 100%） |
| 奇葩 | **100%** |

面板寫「多元＝只鎖場景配對與物理，奇葩＝只鎖物理」—— 越往右規則越鬆。
實際上越往右畫面越單調，整個反過來。

原因：`stampAnchors` 無條件蓋章，而 `castle` 佔住 `place` 這一格，接著
`fillSlot("env","place")` 看到 `mutexTaken` 有 place 就直接 return ——
那一格等於不存在。正常模式之所以最鬆，只是因為 `allow()` 會用 `placeFitsActs`
擋掉不合活動的城堡，**剛好**把格子讓回來。

六個時代裡只有兩個錨是場地（`castle`、`chinese architecture`），
其他四個錨在服裝或環境，那些時代的場地本來就很散（edo dojo 10%、victorian park 9%）——
這反過來證明問題出在「佔格子」，不在「錨」。

改成 35% 機率蓋章。castle 從 40%（平均）降到 17%，跟 greece courtyard 17%、
edo dojo 10% 同一個量級，沒有哪個時代再被單一場地壟斷。

**先試過軟權重，不行**：`takeFromPool` 的權重是**逐個字**算的，不是逐層。
castle 一個字權重 6，要跟十幾個中世紀場地（各 3）和十六個中性場地（各 1）比，
算出來 9%。要調到想要的比例就得把權重寫成 37 這種數字，而那個數字會隨詞庫長大失準——
那是對著池子大小調參，不是表達意圖。機率直接就是意圖。

**時代還看得出來嗎**：用嚴格判準（屬於該時代、而且現代不會有）量，
改前改後都是 100%。armor、era-prop 那一格、時代專屬場地都還在扛。

### 二、矛盾：分級尾巴不看畫面

`nsfw, explicit` 以前只看滑桿。滑桿放色情、尺度選「活動」，一張穿好衣服在超市買東西的圖
照樣被寫上 explicit —— 那個組合在訓練集裡不存在，模型只能往色情硬拉。

實測：尺度=活動 或 誘惑 → **100%** 的圖沒有情色內容卻標著 explicit；預設尺度 → 29%。

改成照畫面推一級，滑桿當上限（Danbooru 的 rating 本來就是從內容推出來的）。

**這一段我做錯三次，全部靠量測抓回來：**

1. 一開始拿 `explicitOnly()` 當內容判準 —— 那是**閘**不是**分類器**，
   只要一個字的 heat 沒有 tease 就回 true，連 `shopping` 都被算成情色內容。
2. 改成看結構欄位（layer/mutex/group），結果
   「`masturbation through clothes` + `fucked silly`」那張被標成 **`sfw, general`** ——
   比原本的問題還糟。那兩個字一個是 `group=flash`、一個是 `group=face`，
   結構欄位根本抓不到。又是「規則掛錯層級」。
3. 補上字面規則之後**完全沒作用**：heredoc 把反斜線吃掉，
   `new RegExp("\b(...)")` 寫進檔案變成 `"(...)"` —— 在 JS 字串裡那是退格字元，
   不是詞界。`bottomless` 判成 general，`bikini` 判成 general。
   這個坑這次任務踩到第四次了，最後用 `chr(92)` 組出來才對。

驗證方式刻意不用 engine 自己的判準（拿被驗的東西驗自己等於沒驗），
改用一份手寫的「這絕對是情色」清單掃 5400 張：
**明確情色卻沒標 explicit：0 次；明確敏感卻標成 general：0 次。**

另外要講清楚：**負面提示詞不跟著改**。`negative_for()` 的註解本來就寫了它是
「第二道保險」—— 它守的是使用者選的**上限**，正面描述的是**這張圖**，兩者分工不同。

### 三、矛盾：只勾「活動」照樣抽得到 netorare

面板寫「只勾活動＝日常（購物、煮飯、游泳），沒有走光或做愛」。實測只勾活動抽 1200 張：

`naked coat` 90、`naked jacket` 74、`pink nipples` 25、`voyeurism` 23、
`see-through shirt` 23、`slingshot swimsuit` 18、`micro bikini` 12、
`cheating (relationship)` 6、`groping` 6、`netorare` 5、`paizuri gesture` 4。

原因在 `itemFitsHeats`：

```js
if (h === "activity") return hs.includes("tease") || hs.includes("activity");
```

**詞庫裡沒有任何一個字的 heat 含 "activity"**（337 件衣服、355 個姿勢、295 個特徵，
全都沒有）。所以「活動」這一檔本來就只能借 tease 的池子 —— 那不是最佳化，
是它唯一能運作的方式。整池照收，面板那句話就變成假的。

改成：池子照借，情色內容扣掉。短裙去買菜沒問題，裸身外套去買菜不是日常。
**但裸體要放行** —— 我第一版連 `layer=skin` 一起擋，結果「溫泉 + 活動」變成 0/80 永遠不裸，
被既有測試抓到。泡溫泉沒穿衣服是場景決定的，不是尺度決定的。
放行之後：溫泉 27/80 會裸，而沒釘任何東西的日常場景 1600 張裡裸體 **0** 張。

變化沒有被犧牲：活動尺度不重複字數 685 → 686，衣服款式 173 → 168
（少掉的正好是那五件情色衣服），每張字數 37.0 → 36.2，沒有一張空衣服。

這是**既有 bug**，HEAD 是 286 次、我動之前也是。

### 四、面板沒告訴你這個組合等於沒作用

全年齡 + 走光 → 情色內容 0%；全年齡 + 性愛 → 0%。使用者勾了卻一張都抽不到，
而且完全沒有提示。這是我加三段滑桿時漏掉的一塊（舊的布林開關也有，只是三段後更容易踩）。
`updateHeatClash()` 補上分級 × 尺度那一條。

### 五、一條差點被我改錯的測試

`activity-only does not clash with nude` 在我第一版改完之後變紅了，我就把它翻面，
還寫好了理由。結果是**我錯**：翻面反映的是中途那個「連 layer=skin 一起擋」的錯誤版本。
把裸體放行之後，nude 跟「只勾活動」本來就不衝突，原本那條斷言一直是對的，
已經原樣改回去。

這件事值得記著：**測試變紅的時候，「它過時了」跟「我改錯了」長得一模一樣。**
這次分辨出來靠的是先去量那條測試真正在守的東西（溫泉還裸不裸），
而不是先讀測試再決定它有沒有道理。

留下來的是三條新的：
- 釘 `naked coat` 會提示尺度對不上（那才是真的不日常）
- 提示歸提示，**釘選照樣進圖**（60/60）
- 沒釘的時候日常場景不會自己冒出 `naked coat` / `netorare` / `groping`（200 張 0 次）

### 這一輪的教訓

1. **「規則越鬆、結果越單調」是一種味道。** 聞到就去找是不是有人無條件佔了格子。
2. **判準要看清楚是閘還是分類器。** `explicitOnly()` 兩個都像，拿錯就全錯。
3. **驗證不能用被驗的東西當尺。** 手寫一份獨立清單，麻煩但有效。
4. **heredoc 會吃反斜線 —— 第四次了。** 正規表示式一律 `chr(92)` 組。

—— Opus 5

## Loop 16：使用者回報「軍服配藍外套」，往下挖出五個問題

### 起點：整套服裝沒有「一套」的概念

釘軍服卻跑出「military uniform, blue jacket, jacket」。量過之後不是個案：

| 釘選 | 疊外套 | 其他 |
| --- | --- | --- |
| 女僕裝 | **92%** | panties 43%、sports bra 37% |
| 軍服／警服／西裝 | 75% | panties 33% |
| 婚紗 | 66% | |
| 和服 | 35% | **shirt 32%、skirt 26%** |

`military uniform` 是 `mutex=onepiece`，`blue jacket` 是 `mutex=outer` —— 不同格，
所以互不相斥。那個設計對「洋裝＋大衣」是對的，對「制服」是錯的：制服本身就含外衣。

和服那一列是另一回事：`kimono` 的 mutex 是 None，根本沒佔身體那一格。

修法分兩條：
- `OUTFIT_HAS_OUTER`：16 件本來就含外衣的整套服裝，不再接受第二件外套。
  洋裝、比基尼**不收** —— 洋裝配大衣、比基尼配罩衫是正常搭配，那一格要留著。
- `ERA_OUTFIT_ERA`：整套的時代服裝底下不塞別的時代的上下身衣服。
  對應時代寫在值裡，所以和服配袴、漢服配襦裙照樣成立。

結果：制服疊外套 75% -> 0%，和服配襯衫 32% -> 0%，
而 serafuku（水手服配開襟衫）和婚紗（配小外套）**刻意保留** 66%。

### 順手量到更糟的：看不見的內衣

整套制服底下 30% 帶著內衣，而且連一個脫衣動作都沒有（女僕裝 100% 有內衣，
其中 31% 是這種）。Danbooru 上標 `panties` 的意思是「畫面上看得見」——
全套軍服底下看得見內褲，在訓練集裡不存在。

放在收尾階段而不是 `allow()`：脫衣動作是在服裝之後才決定的。0% 之後照樣通過
「只穿內衣的造型」反面測試。

### 這一條差點造成新的 bug

既有測試「只勾活動時浴場仍然交代得出身體」紅了一張。追下去是
`loincloth`（兜襠布）**把自己刪掉了**：

- `mutex = underwear_bottom` -> 我的規則認定它是該刪的內衣
- `group = era`（不是 underwear）-> 同一段的「遮蔽物」判斷又放它過關

於是它既是遮蔽物又是被遮的內衣，中世紀浴場只剩它當身體交代時，整張圖就沒有
任何身體資訊了。兩邊改用同一個判準修好。

**這正是使用者說的「解決一個問題卻創造另一個」。** 抓到它的不是我，是既有測試。

### 分級階梯根本沒有被保證

逐字對 Danbooru 查證時發現：**敏感擋掉的字，全年齡竟然放行**。
`netorare`、`voyeurism`、`breastfeeding` 三個字在全年齡模式實抽得到
（2800 張裡 netorare 47 次、voyeurism 72 次）。

原因是兩層各用各的判準：敏感看 `explicitOnly()` 的名單，全年齡看 `sfwBlocked()`
的字面 regex，而那三個字裡沒有任何一個 regex 認得的詞。沒有任何東西保證這是階梯。

修法不是把三個字補進名單，是讓階梯成立：`全年齡 = sfwBlocked || explicitOnly`。

### 癡漢為什麼在走光

`groups.py` 的 `assign_group()`：

```python
if "flash" in heat and "tease" not in heat:
    return "flash"
```

**拿 heat（什麼時候抽得到）決定 group（這是什麼東西）。** 癡漢的 heat 是
`["flash","sex"]`，於是被歸成走光，沒有人判斷過它的意思。同一條規則把 54 個字
掃進走光，裡面混了三種東西：真的走光、性接觸、純姿勢。

把性接觸那 9 個移到 `sex`。**姿勢那一類刻意不動** —— 它們是「敏感＋走光」
唯一還抽得到的內容，移走那個組合就空了。

順帶修正一個尺度：`self fondling` 原本在敏感層，因為它剛好沒對到任何特例。

### 對 Danbooru 查證時，我自己差點被基準騙

第一版直接看百分比，把 `v`（比 YA）、`head tilt`（歪頭）判成敏感。
**全站有 20.2% 的圖是 q+e** —— 一個字帶 20% 成人圖只代表它很普通。
改用「相對基準的倍率」之後那些全部掉出名單。據此把 12 個字從敏感移到色情。

### 我自己的改動，回頭驗了一遍

使用者要求「質疑你的改動」，所以拿 HEAD 跟改完各抽 4320 張逐字比可達性：

- **抓到一個我製造的過度阻擋**：`topless female`、`topless male`、`bottomless`
  的 era 是 `["any"]`，卻在和服／漢服／托加在場時被擋掉。
  但「和服褪到腰間」是正常畫法 —— `era:["any"]` 是「每個時代都能用」，
  不是「哪個時代都不屬於」。已修，並補上反面測試。
- 掉最多的是內衣（panties 646->288）、cleats（486->97）—— 都是刻意的。
- 11 個「歸零」的字加大樣本重測，全部是雜訊。
- 唯一真的變動的是三個 `needs:["pair"]` 的字（`breast grab` 等）變稀有。
  查了 sex 群的整體健康度：92/99 個字抽得到、密度 1.87->1.91 沒變，
  雙人字 64/70 種出現過 —— 不是結構性餓死。
- 敏感層從 91 個字掉到 80 個：實抽 3600 張，仍有 **89%** 的圖至少帶一個敏感字
  （跟改之前一樣），用到 70 種。這一層沒有被掏空。

### 結構上的一件事

這一輪又多了一個「收尾階段」的規則，加起來已經三個。它們存在的理由完全相同：
**規則要看的東西，在 allow() 被呼叫的當下還沒決定。**

所以在那一段前面補上了階段標題，寫清楚判斷方法：
規則要看的東西在這個字被抽的當下就定了（互斥格、性別、時代、熱度）-> `allow()`；
要等別的格子（場地、活動、姿勢、脫衣）-> 收尾階段。

下次要加規則的人（包括我）不用再踩一次。

—— Opus 5
