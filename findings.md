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
