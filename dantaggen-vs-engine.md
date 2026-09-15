# DanTagGen 對照排字匣引擎：三組實測與同義詞問題的判斷

測於 2026-09-15。目的是回答兩件事：**提示詞誰做得好**，以及**父子 tag 同時輸出要不要修**。

## 怎麼測的

- 引擎側：`drawOne(lex, settings, …)`，`girl=true`、`heats=["tease"]`、seed 7000 起算。
- DanTagGen 側：`DanTagGen-delta-rev2`、`target=long`、`rating="nsfw, explicit"`、長寬比 832/1216、temperature 1.35。
- 兩邊都用 `web/engine.js` 的 `contradictions()` 與 `lexicon.json` 的 `implies` 欄位量測，標準一致。
- DanTagGen 的輸出有 48–60 個 tag，其中詞庫認得 30–37 個，矛盾數只在認得的子集上計算，**實際矛盾只會更多，不會更少**。

## 三組實測

### 引擎（seed 7000 / 7001 / 7002）

**1.** `1girl, solo, adult, bob cut, red eyes, black hair, parted hair, flat chest, small breasts, soft breasts, natural breasts, thigh strap, mature female, milf, off-shoulder dress, dress, open jacket, jacket, pantyhose, sports bra, bra, writing, sitting, pov crotch, looking at viewer, pout, against wall, soft lighting, pen, modern, tent, outdoors, sunset, sunlight, …`

**2.** `1girl, solo, adult, bob cut, aqua eyes, green hair, curly hair, huge breasts, soft breasts, natural breasts, dark skin, hair over one eye, streaked hair, sleeveless shirt, shirt, microskirt, miniskirt, skirt, blue sports bra, bra, sports bra, open jacket, jacket, taking picture, indian style, over shoulder, sideways glance, smug, sparkling eyes, soft lighting, cellphone, modern, park, outdoors, sunrise, spotlight, …`

**3.** `2girls, adult, very short hair, pink eyes, pink hair, straight hair, flat chest, small breasts, soft breasts, natural breasts, plump, parted hair, bodypaint, floating, portrait, looking back, furrowed brow, hand in pocket, clenched teeth, soft lighting, modern, onsen, indoors, sunset, dim lighting, …`

### DanTagGen（輸入取自上面三組的骨架）

**A** ← `1girl, bob cut, black hair, off-shoulder dress, sitting, sunset, outdoors`
> `flower, looking to the side, from behind, capelet, peeing self, hairband, pink dress, off shoulder, thighhighs, bare shoulders, lolita hairband, lace sleeves, black hairband, dress, brown eyes, looking at viewer, legs, looking back, black thighhighs, medium hair, fluffy, rabbit, lolita fashion, closed eyes, stairs, hime cut, peeing, bare back, hair ornament, thighs, underwear, gothic lolita, pink bloomers, sunlight, yellow dress, handrail, backless outfit, squatting, frills, frilled dress, backless dress, solo, bloomers, :s, animal`

**B** ← `1girl, green hair, sports bra, taking picture, park, sunrise`
> `tribal tattoo, blue sports bra, tree shade, wide hips, large breasts, mouth mask, tattoo, curvy, shoulder tattoo, looking at phone, underboob, holding, armpits, selfie, holding beachball, palm tree, phone, stomach, sportswear, ball, mole, dark skin, outdoors, mole under eye, sidelocks, tree, cleavage, breasts, covered mouth, tire, navel, thick thighs, beachball, mask, thighs, sky, sweatdrop, holding phone, swimsuit, cloud, arms up, sweat, ponytail, dark-skinned female, long hair, wet, dusk, solo, yellow eyes`

**C** ← `2girls, onsen, indoors, night, bodypaint`
> `lens flare, looking to the side, pussy peek, wet hair, convenient censoring, tail censor, nipples, pussy, animal ears, jingle bell, neck bell, sitting, blue eyes, collarbone, blue hair, closed mouth, hanging breasts, looking away, brown hair, :o, tail, blunt bangs, shy, ass, breasts, cat tail, night sky, medium breasts, completely nude, sky, light blue hair, long hair, wet, cat ears, nude, animal ear fluff, bell, ahoge`

## 量化對照

| | tag 數 | 父子同時出現 | `contradictions()` |
|---|---:|---:|---:|
| 引擎 1 | 39 | 6 | **0** |
| 引擎 2 | 41 | 9 | **0** |
| 引擎 3 | 30 | 2 | **0** |
| DanTagGen A | 57 | 3 | 5 |
| DanTagGen B | 60 | 3 | 2 |
| DanTagGen C | 48 | 1 | 3 |

引擎跑 200 次的整體數字：平均 **37.8** 個 tag、父子重複平均 **5.4 對**、`contradictions()` **0/200**。

**這是一個乾淨的對調：引擎零矛盾但重複多，DanTagGen 重複少但有矛盾。**

DanTagGen 的矛盾明細（用引擎自己的檢查器跑出來的）：

- A：`off-shoulder dress` vs `pink dress`（同 onepiece 槽）、`looking to the side` vs `looking at viewer` vs `looking back`（視線三選一卻全上）、`bob cut` vs `medium hair`、`sitting` vs `squatting`
- B：`taking picture` vs `selfie`、`sunrise` vs `dusk`
- C：`blue hair` vs `brown hair`、`completely nude` vs `nude`、`looking to the side` vs `looking away`

另外 A 從「坐著看夕陽」漂移到 `peeing self, peeing, rabbit, stairs, handrail`，B 從「公園自拍」漂移到 `beachball, palm tree, tire`。**這就是統計式生成的代價：它保證局部共現自然，不保證整體是同一個場景。**

## 同義詞問題：要不要改

### 先修正一個我原本的說法

我先前說引擎輸出「有矛盾」，那是錯的。`contradictions()` 200/200 全過。真正的現象只有一個：**父子 tag 同時出現**，而那跟矛盾是兩回事。

### 而且父子同時出現，本來就是 danbooru 的慣例

danbooru 會自動把被 imply 的母 tag 補上去，所以真實 post 上 `off-shoulder dress` 跟 `dress` 本來就同時存在。**DanTagGen 自己也照做**：A 組輸出了 `off-shoulder dress` 又輸出 `dress`，B 組輸出 `blue sports bra` 又輸出 `sports bra` 和 `breasts`。連訓練在 720 萬筆真實資料上的模型都這樣產，代表這不是缺陷，是這個語料的原生寫法。`engine.js` 的 `contradictions()` 也早就用 `parentChild()` 把父子關係排除在矛盾之外——**這個設計本來就是刻意的**。

### 我模擬了「砍掉冗餘父 tag」的效果

規則：鏈只留兩層，且同一個父被兩個以上在場子 tag 指到就砍父。跑 200 次：

```
平均 tag 數   37.8 → 37.3
父子重複對數  5.4 → 4.5
最常被砍掉的  bra(37), outdoors(30), skirt(7), swimsuit(6), indoors(6)
```

**收益極小（少 0.5 個 tag），而且代價不小。** 被砍最多的第二名是 `outdoors`——那是場景錨點，SDXL 很吃這個詞，為了消一個「重複」把它拿掉是虧的。

### 但有一個窄得多的問題值得修

三層以上同時在場：**52/200 = 26%**。而且高度集中：

```
 19×  black sports bra → sports bra → bra
 10×  blue sports bra → sports bra → bra
  8×  pink sports bra → sports bra → bra
  7×  microskirt → miniskirt → skirt
  5×  showering → shower (place) → indoors
```

`black sports bra, sports bra, bra` 是**同一件內衣寫三次**。對 CLIP 來說那是三倍權重，會排擠掉同一段裡的場景和動作詞。`microskirt, miniskirt, skirt` 同理。這跟「父子並存」不同——並存是兩層，這是三層。

### 結論

**不要做全面的父 tag 去重，要做的是限制鏈深。**

具體建議：同一條 `implies` 鏈最多輸出兩層（最具體的子 + 它的直接父），第三層以上不輸出。影響面只有 26% 的抽籤、集中在 sports bra 家族與 microskirt，`outdoors` / `indoors` 這種場景錨點因為通常只有兩層，不會被誤傷。

優先度：**中低**。這會讓服裝描述更乾淨，但不是目前最傷出圖品質的東西——比起它，`2girls` 只描述一個人的髮色身材（三組樣本裡出現一次，DanTagGen 的 C 組也犯同樣錯）影響更大。

## 兩者優劣

### 引擎（排字匣）

**優**

- **零矛盾。** 200/200 通過自家檢查器。視線、髮色、日夜、內外、姿勢互斥全都守住。
- **欄位保證。** 每抽都有髮型／眼／髮色／身材／服裝／動作／表情／光線／場景／時代／天氣。DanTagGen 三組沒有一組自己補上 lighting。
- **可複現。** seed 決定一切，同一顆種子永遠同一張。
- **可控。** 釘選、禁用、SFW 開關、heat 分級、era 鎖定，全部是硬保證，不是傾向。
- **不漂移。** 不會從公園跑到沙灘。

**劣**

- 同一件衣服的三層鏈，26% 的抽籤會發生。
- 規則要自己養，新概念不會自己長出來。
- 組合多樣性受限於詞庫與規則交集，不會有「我沒想過但合理」的驚喜。

### DanTagGen

**優**

- **局部共現自然。** `bikini → swimsuit → bikini top only → covered nipples`、`animal ears → cat ears → cat tail → animal ear fluff → bell`，整組是同一件事的不同精度，這種密度規則很難列舉。
- **角色特徵自動對齊。** 給 `hatsune miku` 就自己補 `green hair, green eyes, headset, necktie`，不用維護角色表。
- **廣度。** 720 萬筆的共現統計，會拿出 `tree shade`、`lens flare`、`convenient censoring` 這種沒人會手寫進詞庫的詞。
- **成本低。** 400M 參數，實測單次 3–6 秒，顯存 1 GB 以內。

**劣**

- **會自相矛盾。** 三組各 2–5 個，視線與髮色是重災區。
- **會漂移。** 「坐著看夕陽」變成 `peeing self, rabbit, stairs`。
- **沒有欄位保證。** 要什麼有什麼是運氣，不是設計。
- **不可複現。** temperature 取樣，同輸入每次不同。
- **黑名單只是事後字串比對**，不支援 regex（ComfyUI 節點版），也不是模型層的 negative conditioning。
- **無法下抽象指令。** 只能給 tag，不能說「江戶時代的」。

## 建議

兩者的強弱是互補的，不是競爭的：

1. **引擎出骨架** —— 欄位齊全、零矛盾、可複現的那 30 幾個 tag。
2. **DanTagGen 用 `short` 補細節** —— 讓它在既有骨架上加密度，因為骨架已經夠具體，它的漂移空間會大幅縮小（對照 C 組只給 4 個詞就漂到貓耳，A 組給 7 個詞仍漂到兔子）。
3. **補完後再過一次引擎的 `contradictions()` 與黑名單** —— 把它帶進來的矛盾擋掉。

這樣三層下來，引擎守住「不會錯」，模型負責「會更豐富」，而 DanTagGen 最大的弱點（矛盾與漂移）剛好是引擎最強的地方。
