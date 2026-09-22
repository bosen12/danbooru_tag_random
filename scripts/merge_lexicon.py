#!/usr/bin/env python3
"""Dedupe lexicon parts, keep first occurrence, write web/lexicon.json."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from groups import GROUP_ORDER, GROUP_ZH, assign_group

ROOT = Path(__file__).resolve().parents[1]
PARTS = ROOT / "web" / "lexicon_parts"
OUT = ROOT / "web" / "lexicon.json"
HEATS = ["tease", "flash", "sex"]
# Clothes are outfits, not a heat. You can have sex in a bikini.
# These are undress / toy states, not something you "wear to a scene".
CLOTHING_STATE = {
    "nude",
    "completely nude",
    "topless female",
    "topless male",
    "bottomless",
    "panties aside",
    "no bra",
    "no panties",
    "underwear only",
    "see-through clothes",
    "open clothes",
    "open shirt",
    "open kimono",
    "clothes between breasts",
    "naked sweater",
    "naked shirt",
    "naked apron",
    "naked towel",
    "sex toy",
    "vibrator",
    "egg vibrator",
}
# Faces that *are* a heat. Everyday faces / sitting / looking are not.
POSE_CLIMAX = {
    "ahegao",
    "fucked silly",
    "rolling eyes",
    "orgasm",
    "moaning",
}
SECTIONS = {"quality", "subject", "feature", "pose", "clothing", "env"}
GATES = {"any", "female", "male"}

# 這是目前專案採用的共同基礎負面；全年齡／敏感分級會在此之外追加自己的限制。
# 順序依使用者指定，避免生成檔與 ComfyUI 後備路徑各自漂移。
NEGATIVE = (
    "worst quality, bad quality, worst detail, sketch, bad hands, extra digits, "
    "censored, bar censor, mosaic censoring, watermark, signature, english text, "
    "speech bubble, multiple views, 3d, photorealistic, cross-section, x-ray, inset"
)

# 這張表有兩個用途：norm() 用它把字擋在詞庫外，rename_custom_tag.new_tag_ok()
# 用它擋改名。兩邊都是精確比對，所以**單數和複數要各寫一次** —— 原本只有
# "children" 而沒有 "child"，於是改名工具會放行 `child`，儘管它自己的 docstring
# 和 README 都寫著擋 loli／shota／teen／child。"teen" 則是整個漏掉。
#
# 加這兩個字不會動到詞庫：現在沒有任何一個 tag 的名字是 "child" 或 "teen"
# （整字或子字串都沒有），而 norm() 只在完全相等時才丟掉。
BANNED = {
    "toddler",
    "underage",
    "kid",
    "child",
    "children",
    "teen",
    "teenage",
    "teenager",
}

UMBRELLA = {
    "chinese clothes",
    "japanese clothes",
    "ancient greek clothes",
    "armor",
    "swimsuit",
    "one-piece swimsuit",
    "dress",
    "shirt",
    "skirt",
    "pants",
    "shorts",
    "bikini",
    "bra",
    "panties",
    "kimono",
    "yukata",
    "bodysuit",
    "sweater",
    "jacket",
    "coat",
    "school uniform",
    "necktie",
    "leotard",
    "tank top",
    "cardigan",
    "socks",
    "thighhighs",
    "hat",
    "gloves",
    "earrings",
    "necklace",
    "collar",
    "bowtie",
    "sex",
    "oral",
    "threesome",
    "monster boy",
    "fat",
    "otaku",
}

# 錨點可以有替代字：抽的時候在同一組裡挑一個。chinese clothes 是泛稱，
# hanfu 是具體的形制，兩個都對，一直只用前者會讓每張古中國圖長得一樣。
ERA_ANCHOR_ALTS = {
    "chinese clothes": ["chinese clothes", "hanfu"],
}

# 現代**沒有錨**：Danbooru 上的 modern 是 artist 分類、post_count 0 ——
# 那個字不是 tag，模型沒學過。而現代本來就不需要錨，因為 Danbooru 的預設
# 就是現代；實測 2800 張現代圖有 96.8% 另外帶著現代專屬的場地或服裝
# （jacket 714、city lights 307、sneakers 294…），只靠這個錨撐的只有 3.2%。
# 對照 test_engine.mjs 的時代訊號測試也**刻意排除現代**，註解寫著
#「現代不該被硬塞（它本來就有一堆專屬場地）」。2026-09-18 專案主裁決拿掉。
ERA_ANCHORS = {
    "ancient_china": ["chinese clothes", "east asian architecture"],
    "ancient_greece": ["ancient greek clothes"],
    "medieval": ["armor", "castle"],
    "edo": ["japanese clothes"],
    "victorian": ["victorian"],
}

# Structural western / modern clothes must not leak into historical eras.
_MV = ["modern", "victorian"]
_M = ["modern"]
ERA_OF = {
    "dress": _MV,
    "wedding dress": _MV,
    "short dress": _MV,
    "shirt": _MV,
    "blouse": _MV,
    "open shirt": _MV,
    "unbuttoned shirt": _MV,
    "off shoulder": _M,
    "jacket": _M,
    "open jacket": _M,
    # 泛用父標籤只會隨具體子標籤進場；時代需涵蓋 long skirt 的全部時代，否則
    # child -> parent implication 在古中國／中世紀會被 era gate 截斷。
    "skirt": ["modern", "victorian", "medieval", "ancient_china"],
    "miniskirt": _M,
    # 窄裙是 1950 年代的辦公室服裝，維多利亞穿不到它。移走之前 victorian
    # 的 bottom 池只有它一件真衣服，所以同一批補了長裙、襯裙、裙撐。
    "pencil skirt": _M,
    # 活動也會時代錯置，而且沒人查過。菸草到 1500 年代才進歐洲，吉他是 15 世紀
    # 以後的樂器，日光浴當成休閒是 20 世紀的事，瑜伽墊那種畫面也是現代的。
    # 這四個原本是「任何時代」，於是古希臘有 3% 的圖在抽菸、4% 在做瑜伽。
    # 江戶有煙管、維多利亞有菸，所以 smoking 留給這兩個時代。
    "smoking": ["modern", "edo", "victorian"],
    "yoga": _M,
    "playing guitar": _MV,
    "sunbathing": _M,
    "long skirt": ["modern", "victorian", "medieval", "ancient_china"],
    "pleated skirt": _M,
    "microskirt": _M,
    "shorts": _M,
    "short shorts": _M,
    # 同上，讓 Victorian 的 suit pants 能合法帶出 Danbooru 父標籤 pants。
    "pants": ["modern", "victorian"],
    "bra": _M,
    "panties": _M,
    "thong": _M,
    "underwear only": _M,
    "boxers": _M,
    "briefs": _M,
    "male underwear": _M,
    "thighhighs": _MV,
    "kneehighs": _MV,
    "glasses": _MV,
    "navel piercing": _M,
    "naked sweater": _M,
    "naked shirt": _MV,
    "naked apron": _M,
    # 毛巾不是現代才有的東西，而這個限制讓歷史時代的浴場沒有 flash 等級的衣物可穿，
    # 只剩浴袍／浴衣／褌那一類 —— 而 Danbooru 說那一類洗澡時只佔 0.0～0.4%。
    # 證據：naked_towel 全站 18,421 張，其中 **33.2%（6,117）在 onsen**，
    # 另有 japanese clothes 1.3%、bathhouse 0.9%、east asian architecture 0.4%。
    # 內部也對不起來：bath／bathing／shared bathing／towel 這四個本來就是 era any，
    # 只有 naked towel 被鎖在現代，而它跟 towel 是同一條毛巾。
    "naked towel": ["any"],
    # 浴袍（dressing/bathing gown）在維多利亞時期已有；擴到 victorian 也讓男性
    # 浴場不必因 chemise 是 female-only 而被迫 100% 裸體。
    "bathrobe": _MV,
    "elbow gloves": _MV,
    "qipao": _M,
    "tangzhuang": _M,
    "china dress": _M,
    "shower (place)": _M,
    "couch": _M,
    "bar (place)": _MV,
    # 三溫暖是芬蘭浴，對江戶是時代錯置。
    "sauna": _M,
    "spotlight": _M,
    "lamp": _MV,
    "armor": ["medieval", "edo"],
    "gaming chair": _M,
    "swivel chair": _M,
    "office chair": _M,
    "living room": _MV,
    "bathroom": _MV,
    "kitchen": _MV,
    "bathtub": _MV,
    "ceiling light": _M,
    "city lights": _M,
    "pool ladder": _M,
    "beach towel": _M,
    "restaurant": _MV,
    "watch": _M,
    "hard hat": _M,
    "police hat": _M,
    "police uniform": _M,
    "vibrator": _M,
    "egg vibrator": _M,
    "sex toy": _M,
    "handbag": _M,
    "beach umbrella": _M,
    "no bra": _M,
    "no panties": _M,
    "panties aside": _M,
    "white socks": _M,
    "bra pull": _M,
    "panty pull": _M,
    "hand in panties": _M,
    "sports bra lift": _M,
    "shirt lift": _M,
    "necktie": _MV,
    "bowtie": _MV,
    "leotard": _M,
    "bodysuit": _M,
    "power armor": _M,
    "detached collar": _MV,
    "showering": _M,
    "shower head": _M,
    "innertube": _M,
    # 江戶的專屬場地本來 16 個裡有 6 個是浴場（古中國 0 個），於是三分之一的
    # 江戶圖在泡澡。ofuro 跟 bath、bathhouse 跟 onsen 畫出來幾乎是同一種場景 ——
    # 五個日式浴場各自競爭，合計機率就是單一場地的五倍。留 onsen 撐江戶的
    # 沐浴文化，這兩個回歸現代。
    #（原本還留著 open-air bath，但它在 Danbooru 是 0 張、模型沒把它當 tag 學過，
    # 已移除；露天的語意由 onsen + outdoors 承接。）
    "bathhouse": _M,
    "ofuro": _M,
    "bubble bath": _M,
    "shopping": _M,
    "karaoke": _M,
    "playing video games": _M,
    "talking on phone": _M,
    "selfie": _M,
    "driving": _M,
    "riding bicycle": _M,
    "taking picture": _MV,
    "nurse": _M,
    "doctor": _M,
    "office lady": _M,
    "salaryman": _M,
    "policewoman": _M,
    "waitress": _M,
    "barista": _M,
    "flight attendant": _M,
    "idol": _M,
    "teacher": _M,
    "nurse cap": _M,
    "idol clothes": _M,
    "blazer": _M,
    "condom": _M,
    "used condom": _M,
    "dildo": _M,
    "recording": _M,
    "chikan": _M,
    "fitness gym": _M,
    "school gym": _M,
    "locker room": _M,
    "locker": _M,
    "hospital": _M,
    "clinic": _M,
    "stethoscope": _M,
    "clipboard": _M,
    "microphone": _M,
    "sportswear": _M,
    "helmet": _M,
    "temple": ["ancient_china", "edo"],
    "pagoda": ["ancient_china", "edo"],
    "torii": ["edo"],
    "shrine": ["edo", "modern"],
    "east asian architecture": ["ancient_china"],
    "east asian architecture": ["ancient_china", "edo"],
}

# Variant → parent so they coexist (mutex siblings skip parent/child).
# 後綴規則（「X 什麼」就 implies「什麼」）對「顏色＋衣服」很準，Danbooru 也是這樣
# 定的：blue bra -> bra、white panties -> panties、track jacket -> jacket。
# 但複合名詞不一定是那個東西的一種，這裡放查證過的例外。
#
# sports bra：Danbooru 上 sports_bra 沒有任何 implication，顏色款也只 implies
# sports_bra —— 運動內衣在他們的分類裡不是 bra。我們自己補出來的 -> bra 會讓
# 「black sports bra, sports bra, bra」這種三連出現，而那個 bra 是訓練集裡沒有的。
SUFFIX_COMPOUND_EXCEPTIONS = {
    "bra": ("sports bra",),
}

SUFFIX_PARENT = (
    "shirt",
    "sweater",
    "tank top",
    "dress",
    "skirt",
    "pants",
    "shorts",
    "bikini",
    "bra",
    "panties",
    "jacket",
    "coat",
    "kimono",
    "yukata",
    "bodysuit",
    "necktie",
    "bowtie",
    "swimsuit",
    "leotard",
    "collar",
    "earrings",
    "necklace",
    "gloves",
    "socks",
    "thighhighs",
    "hat",
    "cardigan",
    "one-piece swimsuit",
    "sports bra",
    "school uniform",
)

IMPLIES = {
    "pencil skirt": ["skirt"],
    "pleated skirt": ["skirt"],
    # Danbooru 是 microskirt -> skirt，不經過 miniskirt（兩者是兄弟不是父子），
    # 而且兩個都是 mutex=bottom，硬串起來等於在同一格塞兩件下著。
    "microskirt": ["skirt"],
    "short shorts": ["shorts"],
    "jeans": ["pants"],
    "open shirt": ["shirt"],
    "unbuttoned shirt": ["shirt"],
    "collared shirt": ["shirt"],
    "wet shirt": ["shirt"],
    "shirt tucked in": ["shirt"],
    "dress shirt": ["shirt"],
    "see-through shirt": ["shirt"],
    "sleeveless shirt": ["shirt"],
    "string bikini": ["bikini"],
    "micro bikini": ["bikini"],
    "open kimono": ["kimono", "japanese clothes"],
    "bath yukata": ["yukata"],
    "open bodysuit": ["bodysuit"],
    "torn bodysuit": ["bodysuit"],
    "open coat": ["coat"],
    "open cardigan": ["cardigan"],
    "open jacket": ["jacket"],
    "competition swimsuit": ["one-piece swimsuit", "swimsuit"],
    "school swimsuit": ["one-piece swimsuit", "swimsuit"],
    "one-piece swimsuit": ["swimsuit"],
    "casual one-piece swimsuit": ["one-piece swimsuit", "swimsuit"],
    "wedding ring": ["ring"],
    "pool": ["outdoors"],
    "underwater": ["outdoors"],
    "car": ["outdoors"],
    "restaurant": ["indoors"],
    "park bench": ["outdoors"],
    "bamboo forest": ["outdoors"],
    "cherry blossoms": ["outdoors"],
    "cowgirl position": ["sex"],
    "reverse cowgirl position": ["sex"],
    "doggystyle": ["sex"],
    "standing doggystyle": ["sex"],
    "missionary": ["sex"],
    "mating press": ["sex"],
    "standing sex": ["sex"],
    "sex from behind": ["sex"],
    "girl on top": ["sex"],
    "vaginal": ["sex"],
    "anal": ["sex"],
    "fellatio": ["oral", "sex"],
    "cunnilingus": ["oral", "sex"],
    "oral": ["sex"],
    "paizuri": ["sex"],
    "handjob": ["sex"],
    "clothed sex": ["sex"],
    "public indecency": ["sex"],
    "happy sex": ["sex"],
    "threesome": ["sex"],
    "group sex": ["sex"],
    "mmf threesome": ["threesome", "sex"],
    "ffm threesome": ["threesome", "sex"],
    "squatting cowgirl position": ["cowgirl position", "sex"],
    "upright straddle": ["sex"],
    "reverse upright straddle": ["sex"],
    "reverse suspended congress": ["sex"],
    "piledriver (sex)": ["sex"],
    "boy on top": ["sex"],
    "thigh sex": ["sex"],
    "frottage": ["sex"],
    "reverse spitroast": ["sex"],
    "fat man": ["fat"],
    "obese": ["fat"],
    "coke-bottle glasses": ["glasses"],
    "high ponytail": ["ponytail"],
    "side ponytail": ["ponytail"],
    "twin braids": ["braid"],
    "single braid": ["braid"],
    "single hair bun": ["hair bun"],
    "double bun": ["hair bun"],
    "loli": ["petite", "flat chest"],
    "shota": ["short male"],
    "pov": ["looking at viewer"],
    "pov crotch": ["looking at viewer"],
    "showering": ["shower (place)", "indoors"],
    "washing hair": ["wet hair"],
    "shared bathing": ["bathing"],
    "mixed-sex bathing": ["bathing"],
    "ofuro": ["bath", "indoors"],
    "bathhouse": ["bath", "indoors"],
    "bubble bath": ["bath", "indoors"],
    "shower head": ["shower (place)"],
    "karaoke": ["singing"],
    "playing video games": ["playing games"],
    "picnic": ["outdoors", "eating"],
    "fishing": ["outdoors"],
    "camping": ["outdoors"],
    "hiking": ["outdoors"],
    "sunbathing": ["outdoors"],
    "office lady": ["pantyhose", "pencil skirt"],
    # 六件運動制服要一致：足球／棒球／網球／排球服本來就 imply sportswear，
    # 籃球服和田徑服是從 harvest 進來的，漏了這條。
    "basketball uniform": ["sportswear"],
    "track uniform": ["sportswear"],
    "basketball court": ["outdoors"],
    "tennis court": ["outdoors"],
    "soccer field": ["outdoors"],
    "baseball stadium": ["outdoors"],
    "bowling alley": ["indoors"],
    "rape": ["sex"],
    "orgy": ["group sex", "sex"],
    "nurse": ["nurse cap"],
    "doctor": ["lab coat", "stethoscope"],
    "salaryman": ["suit", "necktie"],
    "policewoman": ["police uniform"],
    "waitress": ["apron"],
    "idol": ["idol clothes"],
    "teacher": ["blazer"],
    "gangbang": ["group sex", "sex"],
    "dildo": ["sex toy"],
    "breastfeeding": ["lactation"],
    "full-length mirror": ["mirror"],
    "used condom": ["condom"],
    "object insertion": ["sex"],
    "locker room": ["indoors"],
    "fitness gym": ["indoors"],
    "school gym": ["indoors"],
    "hospital": ["indoors"],
    "clinic": ["indoors"],
    "straddling": ["sitting"],
    "sitting on lap": ["sitting"],
    "jack-o' challenge": ["all fours"],
    "standing on one leg": ["standing"],
}

# Sex act → canonical body pose. Not the same mutex: doggystyle + all fours is valid.
SEX_POSE_BODY = {
    "doggystyle": "all fours",
    "standing doggystyle": "standing",
    "standing sex": "standing",
    "full nelson": "standing",
    "suspended congress": "standing",
    "reverse suspended congress": "standing",
    "missionary": "on back",
    "mating press": "on back",
    "piledriver (sex)": "on back",
    "prone bone": "on stomach",
    "spooning": "on side",
    "cowgirl position": "sitting",
    "reverse cowgirl position": "sitting",
    "girl on top": "sitting",
    "upright straddle": "sitting",
    "reverse upright straddle": "sitting",
    "squatting cowgirl position": "squatting",
    "69": "lying",
    "sitting on face": "sitting",
}
for _act, _pose in SEX_POSE_BODY.items():
    _im = list(IMPLIES.get(_act) or ["sex"])
    if "sex" not in _im:
        _im.append("sex")
    if _pose not in _im:
        _im.append(_pose)
    IMPLIES[_act] = _im

RECLASS = {
    # 這是畫面裡的場景道具，不是穿在人物身上的配件。採集把它放進
    # clothing/accessory/mutex=None，normal/diverse 的服裝白名單因此永遠不會抽到。
    # 放在覆寫表而不是改 05-harvest.json，因為 harvest 會被重新產生。
    "beach umbrella": {"section": "env", "mutex": None, "layer": "normal"},
    "dress shirt": {"mutex": "top", "gate": "any", "section": "clothing", "layer": "garment"},
    "dress pull": {"section": "pose", "mutex": "clothes_action", "layer": "normal", "heat": ["flash", "sex"], "era": ["modern"]},
    "shirt pull": {"section": "pose", "mutex": "clothes_action", "layer": "normal", "heat": ["flash", "sex"], "era": ["modern"]},
    "sweater pull": {"section": "pose", "mutex": "clothes_action", "layer": "normal", "heat": ["flash", "sex"], "era": ["modern"]},
    "swimsuit aside": {"section": "pose", "mutex": "clothes_action", "layer": "normal", "heat": ["flash", "sex"], "era": ["modern"]},
    "bikini bottom aside": {"section": "pose", "mutex": "clothes_action", "layer": "normal", "heat": ["flash", "sex"], "era": ["modern"]},
    "leotard aside": {"section": "pose", "mutex": "clothes_action", "layer": "normal", "heat": ["flash", "sex"], "era": ["modern"]},
    "one-piece swimsuit pull": {"section": "pose", "mutex": "clothes_action", "layer": "normal", "heat": ["flash", "sex"], "era": ["modern"]},
    "hetero": {"needs": ["pair", "female", "male"]},
    "penis on ass": {"needs": ["pair", "female", "male"], "gate": "any"},
    "looking at another": {"needs": ["pair"]},
    "clothed male nude female": {"needs": ["pair", "female", "male"]},
    "clothed female nude male": {"needs": ["pair", "female", "male"]},
    "office lady": {"mutex": "job"},
    "on bed": {"section": "env", "mutex": "furniture"},
    "on chair": {"section": "env", "mutex": "furniture"},
    "on floor": {"section": "env", "mutex": "furniture"},
    "on sofa": {"section": "env", "mutex": "furniture"},
    "plump": {"mutex": "male_build"},
    "skinny": {"mutex": "male_build"},
    "muscular": {"mutex": "male_build"},
    "muscular male": {"mutex": "male_build", "gate": "male"},
    "toned male": {"mutex": "male_build"},
    "bara": {"mutex": "male_build"},
    "bald": {"mutex": "hair_length"},
    "tall female": {"mutex": "height", "gate": "female"},
    # 配件掉了互斥格就等於被判死刑 —— normal 模式（預設）的 fill("clothing") 只放行
    # outfit 白名單裡的互斥格（feet/legs/jewelry/eyewear/neckwear/underwear_*/outer/
    # hands/headwear），mutex 是空的配件一律回 false。實測：79 個配件裡 47 個 mutex
    # 是空的，其中 **34 個在預設模式下完全抽不到**；有互斥格的 32 個只有 1 個抽不到。
    #
    # 下面這些不是設計，是漏掉：同一類的手足都有格子，就它們沒有。
    #   neckwear：black collar／red collar／detached collar／choker 都有，領帶領結沒有
    #   jewelry ：ring／wedding ring／stud earrings／hoop earrings／bracelet 都有，項鍊沒有
    #   headwear：hard hat／police hat／baseball cap／circlet／hood 都有，top hat 沒有
    #
    # 父標籤（necktie／bowtie／necklace／hat／gloves）維持 mutex=None 是對的 ——
    # 那是 UMBRELLA 的設計，它們靠子標籤 implies 進場。問題是子標籤自己也沒有格子，
    # 於是整個家族一起死：bowtie 和 necklace 在預設模式下是 0。
    #
    # 補完之後（6000 張，全時代）：necklace 0 -> 440、gloves 48 -> 286、bowtie 0 -> 38，
    # 而既有手足幾乎沒被排擠（ring 441 -> 392、stud earrings 199 -> 201、choker 162 -> 151）。
    # 腰上的東西本來全是 mutex 空的配件 —— 那在 normal 模式（預設）抽不到，
    # 因為 fill("clothing") 只放行 outfit 白名單裡的互斥格。實測 obi 和 sash
    # 在江戶 3000 張裡是 **0**（weird 模式才有 82 / 69）。
    # 腰帶本來就是一次只繫一條，給它一個 waist 格既能抽得到也不會疊三條。
    # 江戶尤其吃虧：obi 是那個時代最具代表性的配件，卻完全抽不到。
    # naked coat／naked jacket 的意思是「除了這件什麼都沒穿」，也就是整套造型本身，
    # 但它們的格子是 outer —— 外套永遠排在主衣之後才被考慮，於是「身上已經有主衣
    # 就拒絕」那條規則會把它們一律擋掉（實測直接變成抽不到）。放進主衣格，
    # 它們才會在決定主要穿著的那一步就被選中。隱含的 coat／jacket 照樣佔 outer。
    "naked coat": {"mutex": "onepiece"},
    "naked jacket": {"mutex": "onepiece"},
    "obi": {"mutex": "waist"},
    "sash": {"mutex": "waist"},
    "belt": {"mutex": "waist"},
    "black belt": {"mutex": "waist"},
    "brown belt": {"mutex": "waist"},
    "blue necktie": {"mutex": "neckwear"},
    "black necktie": {"mutex": "neckwear"},
    "black bowtie": {"mutex": "neckwear"},
    "cross necklace": {"mutex": "jewelry"},
    "bead necklace": {"mutex": "jewelry"},
    "tooth necklace": {"mutex": "jewelry"},
    "watch": {"mutex": "jewelry"},
    "top hat": {"mutex": "headwear"},
    "laurel crown": {"mutex": "headwear"},
    "black gloves": {"mutex": "hands"},
    "cherry blossoms": {"mutex": "weather", "era": ["any"]},
    # 舔陰莖是動作，不是身體特徵。採集進來時被歸成 feature/body_m，於是它沒有
    # sex_act 互斥格 —— 實測 8000 張裡它出現 58 次，其中 23 次同時還有別的性行為，
    # 包括「licking penis + cowgirl position」（一邊騎乘一邊舔，畫不出來）。
    # 它的兩個同類 cunnilingus（舔陰）和 anilingus（舔肛）本來就在 pose/sex_act。
    # Danbooru 佐證：licking_penis 18150 篇，其中 100.0% 同時有 fellatio、100.0%
    # 有 penis，而 cowgirl_position 只有 1.4%。needs 照最近的同類 fellatio。
    # 放在覆寫表而不是改 05-harvest.json，因為那個檔案重跑採集會被整個重產。
    # layer 和 gate 也要一起搬：採集給的 layer="skin" 不是中性的 —— engine 的
    # wearsBodyClothes() 和「有沒有露出來」那兩個判斷都看 layer==="skin"。
    # 整組對齊最近的同類 fellatio（layer normal、gate any、needs male+pair）。
    "licking penis": {
        "section": "pose", "mutex": "sex_act", "heat": ["sex"],
        "needs": ["male", "pair"], "layer": "normal", "gate": "any",
    },
    "tall male": {"mutex": "height_m", "gate": "male"},
    "short male": {"mutex": "height_m", "gate": "male"},
    "male pubic hair": {"gate": "male", "heat": ["flash", "sex"]},
    "female pubic hair": {"gate": "female", "heat": ["flash", "sex"]},
    "arm hair": {"gate": "male"},
    "leg hair": {"gate": "male"},
    "side-tie bikini bottom": {"mutex": "bottom", "section": "clothing", "layer": "garment"},
    "shoulder armor": {"mutex": None, "layer": "accessory", "section": "clothing"},
    "holding sex toy": {"mutex": None, "needs": []},
    "after paizuri": {"mutex": None},
    "after fellatio": {"mutex": None},
    "implied sex": {"mutex": None},
    "stealth sex": {"mutex": None},
    "mixed-sex bathing": {"mutex": None},
    "threesome": {"mutex": None},
    "mmf threesome": {"mutex": None},
    "ffm threesome": {"mutex": None},
    "group sex": {"mutex": None},
}


EXPRESSION = {
    "smile",
    "seductive smile",
    "smirk",
    "grin",
    "light smile",
    "happy",
    "frown",
    "angry",
    "sad",
    "crying",
    "expressionless",
    "pout",
    "surprised",
    "scared",
    "sleepy",
    "serious",
    "smug",
    "nervous",
    "ahegao",
    "naughty face",
    "embarrassed",
    "shy",
    "come hither",
    "furrowed brow",
    "dazed",
}

HAIR_STYLE_MUTEX = {
    "ponytail",
    "high ponytail",
    "side ponytail",
    "twintails",
    "braid",
    "twin braids",
    "single braid",
    "hime cut",
    "hair bun",
    "double bun",
    "single hair bun",
    "drill hair",
}

# Engine reads stamped needs / mutex. Add new sex acts here, not in engine.js.
SEX_ACT = {
    "vaginal",
    "anal",
    "cowgirl position",
    "reverse cowgirl position",
    "doggystyle",
    "standing doggystyle",
    "missionary",
    "mating press",
    "standing sex",
    "sex from behind",
    "full nelson",
    "amazon position",
    "prone bone",
    "spooning",
    "suspended congress",
    "spitroast",
    "double penetration",
    "69",
    "paizuri",
    "paizuri under clothes",
    "fellatio",
    "deepthroat",
    "irrumatio",
    "cunnilingus",
    "anilingus",
    "handjob",
    "footjob",
    "sitting on face",
    "tribadism",
    "girl on top",
    "oral",
    "squatting cowgirl position",
    "perpendicular paizuri",
    "vaginal object insertion",
    "imminent fellatio",
    "upright straddle",
    "reverse upright straddle",
    "reverse suspended congress",
    "piledriver (sex)",
    "boy on top",
    "thigh sex",
    "frottage",
    "reverse spitroast",
    "object insertion",
}

SOLO_SEX_ACT = {
    "object insertion",
}

NEEDS_MALE = {
    "fellatio",
    "deepthroat",
    "irrumatio",
    "handjob",
    "paizuri",
    "paizuri under clothes",
    "ejaculation",
    "erection",
    "penis",
    "large penis",
    "huge penis",
    "veiny penis",
    "testicles",
    "cum in pussy",
    "cum in mouth",
    "facial",
    "guided penetration",
    "imminent penetration",
    "vaginal",
    "anal",
    "cowgirl position",
    "reverse cowgirl position",
    "doggystyle",
    "standing doggystyle",
    "missionary",
    "mating press",
    "standing sex",
    "sex from behind",
    "full nelson",
    "prone bone",
    "spitroast",
    "double penetration",
    "arm hair",
    "leg hair",
    "upright straddle",
    "reverse upright straddle",
    "reverse suspended congress",
    "piledriver (sex)",
    "boy on top",
    "thigh sex",
    "reverse spitroast",
    "mmf threesome",
    "ffm threesome",
    "salaryman",
}

NEEDS_FEMALE = {
    "vaginal",
    "paizuri",
    "paizuri under clothes",
    "cunnilingus",
    "upskirt",
    "pussy",
    "pussy focus",
    "pussy juice",
    "spread pussy",
    "cowgirl position",
    "reverse cowgirl position",
    "missionary",
    "mating press",
    "after vaginal",
    "cum in pussy",
    "female ejaculation",
    "tribadism",
    "huge breasts",
    "large breasts",
    "gigantic breasts",
    "medium breasts",
    "small breasts",
    "flat chest",
    "sagging breasts",
    "nipples",
    "mature female",
    "female pubic hair",
    "upright straddle",
    "reverse upright straddle",
    "piledriver (sex)",
    "thigh sex",
    "mmf threesome",
    "ffm threesome",
    "lactation",
    "breastfeeding",
    "nurse",
    "waitress",
    "policewoman",
    "flight attendant",
    "idol",
}

NEEDS_PAIR = {
    "sex",
    "kiss",
    "french kiss",
    "looking at another",
    "eye contact",
    "hug",
    "cuddling",
    "straddling",
    "hug from behind",
    "sitting on lap",
    "lifting person",
    "happy sex",
    "ass grab",
    "breast sucking",
    "guided penetration",
    "imminent penetration",
    "grabbing another's breast",
    "grabbing another's ass",
    "grabbing another's hair",
    "guided breast grab",
    "threesome",
    "group sex",
    "mmf threesome",
    "ffm threesome",
    "spitroast",
    "double penetration",
    "69",
    "clothed sex",
    "public indecency",
    "cowgirl position",
    "reverse cowgirl position",
    "doggystyle",
    "missionary",
    "mating press",
    "standing sex",
    "fellatio",
    "cunnilingus",
    "paizuri",
    "handjob",
    "sitting on face",
    "tribadism",
    "upright straddle",
    "reverse upright straddle",
    "reverse suspended congress",
    "piledriver (sex)",
    "boy on top",
    "thigh sex",
    "frottage",
    "reverse spitroast",
    "washing back",
    "shared bathing",
    "netorare",
    "cheating (relationship)",
    "groping",
    "chikan",
    "breastfeeding",
    "carrying",
    "size difference",
    "gangbang",
    "afterglow",
}

NEEDS_GROUP = {
    "threesome",
    "group sex",
    "mmf threesome",
    "ffm threesome",
    "spitroast",
    "reverse spitroast",
    "double penetration",
    "gangbang",
}

NEEDS_CROWD = {
    "gangbang",
}

NEEDS_2MALE = {
    "mmf threesome",
    "spitroast",
    "reverse spitroast",
    "double penetration",
}

NEEDS_2FEMALE = {
    "ffm threesome",
}

NEED_KEYS = {"female", "male", "pair", "yuri", "group", "crowd", "2male", "2female"}

YURI_ONLY = {
    "tribadism",
}


def apply_relations(tag: str, implies: list[str], bind: list[str], mutex, section, gate, layer, heat, era, needs):
    if tag in RECLASS:
        rc = RECLASS[tag]
        if "mutex" in rc:
            mutex = rc["mutex"]
        if "section" in rc:
            section = rc["section"]
        if "gate" in rc:
            gate = rc["gate"]
        if "layer" in rc:
            layer = rc["layer"]
        if "heat" in rc:
            heat = list(rc["heat"])
        if "era" in rc:
            era = list(rc["era"])
        if "needs" in rc:
            needs = list(rc["needs"])
    im = list(implies)
    if tag in IMPLIES:
        for x in IMPLIES[tag]:
            if x not in im and x != tag:
                im.append(x)
    for suf in SUFFIX_PARENT:
        if tag != suf and tag.endswith(" " + suf):
            if tag.startswith("no "):
                continue
            if section != "clothing":
                continue
            skip = SUFFIX_COMPOUND_EXCEPTIONS.get(suf) or ()
            if any(tag == c or tag.endswith(" " + c) for c in skip):
                continue
            if suf not in im:
                im.append(suf)
    if tag.endswith(" kimono") and tag != "kimono":
        if "kimono" not in im:
            im.append("kimono")
        if "japanese clothes" not in bind:
            bind = list(bind) + ["japanese clothes"]
    if tag.endswith(" yukata") and tag != "yukata":
        if "yukata" not in im:
            im.append("yukata")
        if "japanese clothes" not in bind:
            bind = list(bind) + ["japanese clothes"]
    if section == "clothing" and "one-piece swimsuit" in tag and tag != "one-piece swimsuit":
        if "one-piece swimsuit" not in im:
            im.append("one-piece swimsuit")
        if "swimsuit" not in im:
            im.append("swimsuit")
    # 運動內衣在 Danbooru 的分類裡不是 bra：sports_bra 沒有任何 implication，
    # 顏色款只 implies sports_bra。我們自己補的 -> bra 是訓練集裡沒有的組合，
    # 也是「black sports bra, sports bra, bra」這種三連的來源。
    if tag.endswith(" sports bra") and "sports bra" not in im:
        im.append("sports bra")
    if section == "env" and mutex == "day_night":
        im = [x for x in im if x not in ("indoors", "outdoors")]
    elif section == "env" and mutex not in ("place", "in_out"):
        im = [x for x in im if x not in ("indoors", "outdoors", "day", "night")]
    if tag in EXPRESSION:
        mutex = "expression"
    if tag in HAIR_STYLE_MUTEX:
        mutex = "hair_style"
    return im, bind, mutex, section, gate, layer, heat, era, needs


def widen_heat(tag: str, section: str, mutex, layer: str, heat: list[str]) -> list[str]:
    """Outfits, places, sitting, looking, and clothes-moves are not a heat."""
    heat = [h for h in heat if h in HEATS] or list(HEATS)
    if tag in {"nude", "completely nude"}:
        return list(HEATS)
    if section == "clothing" and layer != "skin" and tag not in CLOTHING_STATE:
        return list(HEATS)
    if section == "env" and tag != "cum pool":
        return list(HEATS)
    if section == "feature" and tag in {"wet hair", "wet"}:
        return list(HEATS)
    if section != "pose":
        return heat
    if mutex == "sex_act" or tag in SEX_ACT or tag in POSE_CLIMAX:
        return heat
    if mutex in {"body_pose", "camera", "gaze", "expression", "activity"}:
        if tag in {"sleeping", "dancing"}:
            return [h for h in HEATS if h != "sex"]
        return list(HEATS)
    if mutex == "clothes_action":
        keep = set(heat) | {"flash", "sex"}
        return [h for h in HEATS if h in keep]
    if "sex" not in heat:
        keep = set(heat) | {"sex"}
        if "tease" in heat:
            keep.add("flash")
        return [h for h in HEATS if h in keep]
    if set(heat) == {"tease", "sex"}:
        return list(HEATS)
    return heat


def inherit_eras(tags: list[dict]) -> None:
    """A colour variant must not be wider than its parent (blue necktie ≠ 中世紀)."""
    by = {t["tag"]: t for t in tags}
    order = [
        "modern",
        "victorian",
        "edo",
        "medieval",
        "ancient_china",
        "ancient_greece",
    ]

    def restricted(tag: str) -> list[str] | None:
        item = by.get(tag)
        if not item:
            return None
        e = item.get("era") or ["any"]
        if not e or "any" in e:
            return None
        return e

    for item in tags:
        e = item.get("era") or ["any"]
        if e and "any" not in e:
            continue
        parents: list[list[str]] = []
        for p in list(item.get("implies") or []) + list(item.get("bind") or []):
            pe = restricted(p)
            if pe:
                parents.append(pe)
        tag = item["tag"]
        for suf in SUFFIX_PARENT:
            if tag != suf and tag.endswith(" " + suf):
                pe = restricted(suf)
                if pe:
                    parents.append(pe)
        if not parents:
            continue
        acc = set(parents[0])
        for pe in parents[1:]:
            hit = acc & set(pe)
            acc = hit if hit else acc | set(pe)
        item["era"] = [x for x in order if x in acc] or sorted(acc)
        item["group"] = assign_group(item)


def norm(item: dict) -> dict | None:
    tag = str(item.get("tag") or "").strip().lower().replace("_", " ")
    if not tag or tag in BANNED:
        return None
    section = item.get("section") or "feature"
    if section not in SECTIONS:
        return None
    gate = item.get("gate") or "any"
    if gate not in GATES:
        gate = "any"
    heat = item.get("heat") or list(HEATS)
    heat = [h for h in heat if h in HEATS] or list(HEATS)
    era = item.get("era") or ["any"]
    if not isinstance(era, list):
        era = ["any"]
    mutex = item.get("mutex") or None
    if mutex in ("", "null"):
        mutex = None
    bind = [str(x).replace("_", " ") for x in (item.get("bind") or [])]
    implies = [str(x).replace("_", " ") for x in (item.get("implies") or [])]
    layer = item.get("layer") or "normal"
    needs = [str(x) for x in (item.get("needs") or []) if x in NEED_KEYS]
    implies, bind, mutex, section, gate, layer, heat, era, needs = apply_relations(
        tag, implies, bind, mutex, section, gate, layer, heat, era, needs
    )
    seen_needs = set(needs)
    needs = list(needs)
    if tag in NEEDS_MALE and "male" not in seen_needs:
        needs.append("male")
        seen_needs.add("male")
    if tag in NEEDS_FEMALE and "female" not in seen_needs:
        needs.append("female")
        seen_needs.add("female")
    if tag in NEEDS_PAIR and "pair" not in seen_needs:
        needs.append("pair")
        seen_needs.add("pair")
    if tag in SEX_ACT and tag not in SOLO_SEX_ACT and "pair" not in seen_needs:
        needs.append("pair")
        seen_needs.add("pair")
    if tag in NEEDS_GROUP and "group" not in seen_needs:
        needs.append("group")
        seen_needs.add("group")
    if tag in NEEDS_CROWD and "crowd" not in seen_needs:
        needs.append("crowd")
        seen_needs.add("crowd")
    if tag in NEEDS_2MALE and "2male" not in seen_needs:
        needs.append("2male")
        seen_needs.add("2male")
    if tag in NEEDS_2FEMALE and "2female" not in seen_needs:
        needs.append("2female")
        seen_needs.add("2female")
    if tag in YURI_ONLY and "yuri" not in seen_needs:
        needs.append("yuri")
        seen_needs.add("yuri")
    mutex_extra: list[str] = []
    if tag in SEX_ACT:
        if mutex and mutex != "sex_act":
            mutex_extra.append("sex_act")
        elif mutex != "sex_act":
            mutex = "sex_act"
    if tag in UMBRELLA:
        if mutex == "sex_act" or tag in SEX_ACT:
            if "sex_act" not in mutex_extra:
                mutex_extra.append("sex_act")
        # 服裝的傘狀父項**保留**互斥格。
        #
        # 原本一律清成 None，理由是「父項靠子項的 implies 進場，父子不該搶同一格」。
        # 那對「子項被抽到、父項跟著進來」是對的，但漏掉了另一半：**父項自己被抽到
        # 或被釘選**的時候，那一格就沒有人佔，引擎會以為主衣還空著。
        #
        # 實測（釘選，800 張）：
        #   white dress / micro bikini（有 onepiece 格）→ 不會再有上衣下身
        #   dress / bikini（被清成 None）→ shirt 261、skirt 258、pants 142、sweater 111
        # 也就是說釘「比基尼」會得到比基尼配襯衫加裙子。
        #
        # 父子不會互相驅逐：occupy() 和 implies 那條路徑都有 parentChild() 保護，
        # 所以子項照樣進得來；改變的只是「父項先佔住之後，子項不再另外加一件」——
        # 而那本來就是多餘的（子項的 implies 一定會把父項帶進來）。
        # 但時代服飾那一家例外，它們本來就是可以分層穿的：和服配袴、鎧甲配零件。
        # 讓 kimono／japanese clothes 佔住主衣格，袴就永遠配不上和服了
        # （實測 hakama 與 pelvic curtain 會直接變成抽不到）。
        # 只留真的有「佔下身格的分層夥伴」的那兩家：
        #   edo           -> hakama（mutex=bottom）
        #   ancient_china -> pelvic curtain（mutex=bottom）
        # 中世紀與古希臘查過沒有這種夥伴（armor 的同伴 tabard／cape／cloak 全是
        # outer，不衝突），所以它們照樣佔主衣格 —— 不然穿著鎧甲還會再加一件裙子，
        # 實測中世紀 skirt 因此衝到 61%，越過「沒有哪一件衣服佔掉一個時代過半」那條線。
        LAYERED_FAMILY = {
            "kimono", "yukata", "japanese clothes", "chinese clothes",
        }
        if section != "clothing" or tag in LAYERED_FAMILY:
            mutex = None
    if tag in ERA_OF:
        era = list(ERA_OF[tag])
    needs = [x for x in needs if x in NEED_KEYS]
    heat = widen_heat(tag, section, mutex, layer, heat)
    out = {
        "tag": tag,
        "section": section,
        "gate": gate,
        "heat": heat,
        "mutex": mutex,
        "bind": bind,
        "implies": implies,
        "layer": layer,
        "era": era,
        "group": assign_group(
            {
                "tag": tag,
                "section": section,
                "gate": gate,
                "heat": heat,
                "mutex": mutex,
                "layer": layer,
                "era": era,
            }
        ),
    }
    if needs:
        out["needs"] = needs
    if mutex_extra:
        out["mutexExtra"] = mutex_extra
    return out


def extra_style_tags() -> list[dict]:
    """Optional look. Pin to add; never auto-drawn.

    coloring：上色／媒材互斥。line_weight：線條粗細。era_style：年代畫風。
    drop shadow 可跟平塗／賽璐璐疊，不加 mutex。"""
    rows = [
        ("cel shading", "賽璐璐上色", "coloring"),
        ("anime coloring", "動畫上色", "coloring"),
        ("flat color", "平塗", "coloring"),
        ("watercolor (medium)", "水彩", "coloring"),
        ("screentones", "網點", "coloring"),
        ("lineart", "線稿", "coloring"),
        ("monochrome", "單色", "coloring"),
        ("thick outlines", "粗線", "line_weight"),
        ("1990s (style)", "1990s 畫風", "era_style"),
        ("2000s (style)", "2000s 畫風", "era_style"),
        ("retro artstyle", "復古畫風", "era_style"),
        ("drop shadow", "平塗陰影", None),
    ]
    return [
        {
            "tag": tag,
            "section": "quality",
            "gate": "any",
            "heat": list(HEATS),
            "mutex": mutex,
            "bind": [],
            "implies": [],
            "layer": "normal",
            "era": ["any"],
            "needs": [],
            "zh": zh,
        }
        for tag, zh, mutex in rows
    ]


def extra_quality_boost_tags() -> list[dict]:
    """Optional. WAI does not need these on every card."""
    rows = [
        ("absurdres", "超高解析", None),
        ("highres", "高解析", None),
        ("very aesthetic", "非常有美感", "aesthetic"),
        ("highly aesthetic", "極有美感", "aesthetic"),
        ("newest", "最新風", None),
    ]
    return [
        {
            "tag": tag,
            "section": "quality",
            "gate": "any",
            "heat": list(HEATS),
            "mutex": mutex,
            "bind": [],
            "implies": [],
            "layer": "normal",
            "era": ["any"],
            "needs": [],
            "zh": zh,
        }
        for tag, zh, mutex in rows
    ]


def extra_loli_tags() -> list[dict]:
    """Adult petite, small bust."""
    return [
        {
            "tag": "petite",
            "section": "feature",
            "gate": "female",
            "heat": list(HEATS),
            "mutex": "height",
            "bind": [],
            "implies": [],
            "layer": "normal",
            "era": ["any"],
            "needs": ["female"],
            "zh": "嬌小",
        },
        {
            "tag": "flat chest",
            "section": "feature",
            "gate": "female",
            "heat": list(HEATS),
            "mutex": "breast_size",
            "bind": [],
            # Danbooru 上 flat_chest 沒有任何 implication —— 平胸和小胸是同一把尺上
            # 的兩個點，不是父子。而且兩個都是 mutex=breast_size，串起來等於在同一格
            # 塞兩個互斥的值：實測 17% 的圖同時寫著「平胸」和「小胸」。
            "implies": [],
            "layer": "normal",
            "era": ["any"],
            "needs": ["female"],
            "zh": "平胸",
        },
        {
            "tag": "loli",
            "section": "feature",
            "gate": "female",
            "heat": list(HEATS),
            "mutex": "height",
            "bind": [],
            "implies": ["petite", "flat chest"],
            "layer": "normal",
            "era": ["any"],
            "needs": ["female"],
            "zh": "蘿莉",
        },
    ]


def extra_shota_tags() -> list[dict]:
    """Adult short male. Not a child tag."""
    return [
        {
            "tag": "short male",
            "section": "feature",
            "gate": "male",
            "heat": list(HEATS),
            "mutex": "height_m",
            "bind": [],
            "implies": [],
            "layer": "normal",
            "era": ["any"],
            "needs": ["male"],
            "zh": "矮個男性",
        },
        {
            "tag": "tall male",
            "section": "feature",
            "gate": "male",
            "heat": list(HEATS),
            "mutex": "height_m",
            "bind": [],
            "implies": [],
            "layer": "normal",
            "era": ["any"],
            "needs": ["male"],
            "zh": "高個男性",
        },
        {
            "tag": "shota",
            "section": "feature",
            "gate": "male",
            "heat": list(HEATS),
            "mutex": "height_m",
            "bind": [],
            "implies": ["short male"],
            "layer": "normal",
            "era": ["any"],
            "needs": ["male"],
            "zh": "正太",
        },
    ]


def extra_sex_position_tags() -> list[dict]:
    """Verified Danbooru sex positions missing from harvest parts."""
    sex = ["sex"]

    def P(tag, needs, gate="any", zh=""):
        return {
            "tag": tag,
            "section": "pose",
            "gate": gate,
            "heat": sex,
            "mutex": "sex_act",
            "bind": [],
            "implies": ["sex"],
            "layer": "normal",
            "era": ["any"],
            "needs": list(needs),
            "zh": zh,
        }

    return [
        P("upright straddle", ["pair", "male", "female"], zh="對面坐位"),
        P("reverse upright straddle", ["pair", "male", "female"], zh="背面坐位"),
        P("reverse suspended congress", ["pair", "male"], zh="背面懸空"),
        P("piledriver (sex)", ["pair", "male", "female"], zh="打樁機體位"),
        P("boy on top", ["pair", "male"], gate="male", zh="男上"),
        P("thigh sex", ["pair", "male", "female"], zh="股交"),
        P("frottage", ["pair"], zh="互相摩擦"),
        P("reverse spitroast", ["pair", "male"], zh="反向兩端夾擊"),
    ]


def extra_bath_tags() -> list[dict]:
    """Bathing, showering, swimming, onsen-side activities and places."""
    all_h = list(HEATS)
    edo_mod = ["edo", "modern"]

    def pose(tag, mutex="activity", implies=None, needs=None, era=None, zh=""):
        return {
            "tag": tag,
            "section": "pose",
            "gate": "any",
            "heat": all_h,
            "mutex": mutex,
            "bind": [],
            "implies": implies or [],
            "layer": "normal",
            "era": era or ["any"],
            "needs": needs or [],
            "zh": zh,
        }

    def env(tag, mutex="place", implies=None, era=None, zh=""):
        return {
            "tag": tag,
            "section": "env",
            "gate": "any",
            "heat": all_h,
            "mutex": mutex,
            "bind": [],
            "implies": implies or [],
            "layer": "normal",
            "era": era or ["any"],
            "zh": zh,
        }

    def cloth(tag, era=None, zh=""):
        return {
            "tag": tag,
            "section": "clothing",
            "gate": "any",
            "heat": all_h,
            "mutex": None,
            "bind": [],
            "implies": [],
            "layer": "accessory",
            "era": era or ["any"],
            "zh": zh,
        }

    return [
        pose("bathing", zh="泡澡"),
        pose("showering", implies=["shower (place)", "indoors"], era=["modern"], zh="淋浴"),
        pose("swimming", zh="游泳"),
        pose("wading", zh="涉水"),
        pose("floating", zh="漂浮"),
        pose("partially submerged", mutex=None, zh="半沒入水中"),
        pose("washing hair", mutex=None, implies=["wet hair"], zh="洗頭"),
        pose("washing back", mutex=None, needs=["pair"], zh="洗別人的背"),
        pose("splashing", mutex=None, zh="潑水"),
        pose("after bathing", mutex=None, zh="浴後"),
        pose("shared bathing", needs=["pair"], implies=["bathing"], zh="共浴"),
        env("bathhouse", implies=["bath", "indoors"], era=edo_mod, zh="錢湯"),
        env("ofuro", implies=["bath", "indoors"], era=edo_mod, zh="日式浴桶"),
        env("bubble bath", implies=["bath", "indoors"], era=["modern"], zh="泡泡浴"),
        env("shower head", mutex=None, implies=["shower (place)"], era=["modern"], zh="蓮蓬頭"),
        env("soap bubbles", mutex=None, zh="肥皂泡"),
        cloth("towel", zh="毛巾"),
        # 泳圈是水域場景道具，不是穿戴物；context 由 engine.NEEDS_CONTEXT 守。
        env("innertube", mutex=None, era=["modern"], zh="泳圈"),
    ]


def extra_activity_tags() -> list[dict]:
    """Daily Danbooru activities. Same mutex as bathing so a scene has one main act."""
    all_h = list(HEATS)
    modern = ["modern"]

    def A(tag, implies=None, era=None, zh=""):
        return {
            "tag": tag,
            "section": "pose",
            "gate": "any",
            "heat": all_h,
            "mutex": "activity",
            "bind": [],
            "implies": implies or [],
            "layer": "normal",
            "era": era or ["any"],
            "needs": [],
            "zh": zh,
        }

    return [
        A("eating", zh="吃東西"),
        A("drinking", zh="喝東西"),
        A("reading", zh="閱讀"),
        A("cooking", zh="料理"),
        A("shopping", era=modern, zh="購物"),
        A("singing", zh="唱歌"),
        A("karaoke", implies=["singing"], era=modern, zh="卡拉OK"),
        A("playing guitar", zh="彈吉他"),
        A("playing games", zh="玩遊戲"),
        A("playing video games", implies=["playing games"], era=modern, zh="打電動"),
        A("playing sports", zh="做運動"),
        A("studying", zh="讀書"),
        A("writing", zh="寫字"),
        A("drawing (action)", zh="畫畫"),
        A("painting (action)", zh="繪畫"),
        A("stretching", zh="伸展"),
        A("yoga", zh="瑜伽"),
        A("exercising", zh="鍛鍊"),
        A("training", zh="訓練"),
        A("fishing", implies=["outdoors"], zh="釣魚"),
        A("camping", implies=["outdoors"], zh="露營"),
        A("picnic", implies=["outdoors", "eating"], zh="野餐"),
        A("hiking", implies=["outdoors"], zh="健行"),
        A("sunbathing", implies=["outdoors"], zh="日光浴"),
        A("smoking", zh="吸菸"),
        A("cleaning", zh="打掃"),
        A("talking on phone", era=modern, zh="講電話"),
        A("selfie", era=modern, zh="自拍"),
        A("taking picture", era=["modern", "victorian"], zh="拍照"),
        A("driving", era=modern, zh="開車"),
        A("horseback riding", zh="騎馬"),
        A("riding bicycle", era=modern, zh="騎腳踏車"),
        # 有自己 activity tag 的運動。同一張圖只能有一個 activity（mutex），
        # 所以這些不要再疊 playing sports。全部經 Danbooru API 核實。
        A("tennis", era=modern, zh="打網球"),
        A("soccer", era=modern, zh="踢足球"),
        A("badminton", era=modern, zh="打羽球"),
        A("table tennis", era=modern, zh="打桌球"),
        A("boxing", era=modern, zh="拳擊"),
        A("track and field", era=modern, zh="田徑"),
        A("golf", era=modern, zh="打高爾夫"),
        A("archery", zh="射箭"),
    ]


def extra_job_scene_tags() -> list[dict]:
    """Jobs with signature clothes, plus remaining high-value Danbooru scene tags."""
    all_h = list(HEATS)
    modern = ["modern"]
    sex = ["sex"]

    def job(tag, implies=None, needs=None, gate="any", zh=""):
        return {
            "tag": tag,
            "section": "feature",
            "gate": gate,
            "heat": all_h,
            "mutex": "job",
            "bind": [],
            "implies": implies or [],
            "layer": "normal",
            "era": modern,
            "needs": needs or [],
            "zh": zh,
        }

    def pose(tag, mutex=None, implies=None, needs=None, heat=None, era=None, zh=""):
        return {
            "tag": tag,
            "section": "pose",
            "gate": "any",
            "heat": list(heat or all_h),
            "mutex": mutex,
            "bind": [],
            "implies": implies or [],
            "layer": "normal",
            "era": era or ["any"],
            "needs": needs or [],
            "zh": zh,
        }

    def feat(tag, mutex=None, needs=None, heat=None, zh=""):
        return {
            "tag": tag,
            "section": "feature",
            "gate": "female" if needs and "female" in needs else "any",
            "heat": list(heat or all_h),
            "mutex": mutex,
            "bind": [],
            "implies": [],
            "layer": "normal",
            "era": ["any"],
            "needs": needs or [],
            "zh": zh,
        }

    def env(tag, mutex="place", implies=None, era=None, zh=""):
        return {
            "tag": tag,
            "section": "env",
            "gate": "any",
            "heat": all_h,
            "mutex": mutex,
            "bind": [],
            "implies": implies or [],
            "layer": "normal",
            "era": era or modern,
            "zh": zh,
        }

    def cloth(tag, mutex=None, layer="accessory", implies=None, gate="any", heat=None, zh=""):
        return {
            "tag": tag,
            "section": "clothing",
            "gate": gate,
            "heat": list(heat or all_h),
            "mutex": mutex,
            "bind": [],
            "implies": implies or [],
            "layer": layer,
            "era": modern,
            "zh": zh,
        }

    return [
        job("nurse", implies=["nurse cap"], needs=["female"], gate="female", zh="護士"),
        job("doctor", implies=["lab coat", "stethoscope"], zh="醫生"),
        job("teacher", implies=["blazer"], zh="老師"),
        job("waitress", implies=["apron"], needs=["female"], gate="female", zh="女侍"),
        job("barista", zh="咖啡師"),
        job("salaryman", implies=["suit", "necktie"], needs=["male"], gate="male", zh="上班族"),
        job("policewoman", implies=["police uniform"], needs=["female"], gate="female", zh="女警"),
        job("flight attendant", needs=["female"], gate="female", zh="空服員"),
        job("idol", implies=["idol clothes"], needs=["female"], gate="female", zh="偶像"),
        cloth("nurse cap", layer="accessory", gate="female", zh="護士帽"),
        cloth("idol clothes", mutex="onepiece", layer="garment", gate="female", zh="偶像服"),
        cloth("blazer", mutex="outer", layer="garment", zh="西裝外套"),
        cloth("sportswear", layer="garment", zh="運動服"),
        cloth("helmet", zh="頭盔"),
        cloth("microphone", zh="麥克風"),
        cloth("stethoscope", zh="聽診器"),
        cloth("clipboard", zh="寫字夾板"),
        cloth("condom", heat=sex, zh="保險套"),
        cloth("used condom", implies=["condom"], heat=sex, zh="用過的保險套"),
        cloth("dildo", implies=["sex toy"], heat=sex, zh="假陽具"),
        pose("gangbang", implies=["group sex", "sex"], needs=["pair"], heat=sex, zh="輪姦"),
        pose("netorare", needs=["pair"], zh="NTR"),
        pose("cheating (relationship)", needs=["pair"], zh="外遇"),
        pose("groping", needs=["pair"], zh="亂摸"),
        pose("chikan", needs=["pair"], heat=["flash", "sex"], era=modern, zh="癡漢"),
        pose("voyeurism", zh="偷窺"),
        pose("recording", era=modern, zh="錄影"),
        pose("object insertion", mutex="sex_act", implies=["sex"], needs=["female"], heat=sex, zh="異物插入"),
        pose("breastfeeding", needs=["pair", "female"], implies=["lactation"], zh="哺乳"),
        pose("afterglow", needs=["pair"], heat=sex, zh="餘韻"),
        pose("carrying", mutex="activity", needs=["pair"], zh="抱著"),
        pose("against window", zh="靠窗"),
        pose("trembling", zh="發抖"),
        pose("looking around", mutex="gaze", zh="東張西望"),
        pose("furrowed brow", mutex="expression", zh="皺眉"),
        pose("dazed", mutex="expression", zh="恍神"),
        feat("lactation", needs=["female"], heat=["flash", "sex"], zh="泌乳"),
        feat("size difference", needs=["pair"], zh="體格差"),
        env("fitness gym", implies=["indoors"], zh="健身房"),
        env("school gym", implies=["indoors"], zh="學校體育館"),
        env("hospital", implies=["indoors"], zh="醫院"),
        env("clinic", implies=["indoors"], zh="診所"),
        env("locker", mutex=None, zh="置物櫃"),
        env("mirror", mutex=None, era=["any"], zh="鏡子"),
        env("full-length mirror", mutex=None, implies=["mirror"], era=["any"], zh="全身鏡"),
        env("tissue box", mutex=None, zh="面紙盒"),
    ]


def extra_shot_face_tags() -> list[dict]:
    """More camera framings, gaze, and expressions. Camera/gaze still one each."""
    all_h = list(HEATS)

    def P(tag, mutex=None, implies=None, heat=None, needs=None, gate="any"):
        return {
            "tag": tag,
            "section": "pose",
            "gate": gate,
            "heat": list(heat or all_h),
            "mutex": mutex,
            "bind": [],
            "implies": implies or [],
            "layer": "normal",
            "era": ["any"],
            "needs": needs or [],
        }

    return [
        P("dutch angle", mutex="camera"),
        P("fisheye", mutex="camera"),
        P("wide shot", mutex="camera"),
        P("over shoulder", mutex="camera"),
        P("from outside", mutex="camera"),
        P("lower body", mutex="camera"),
        P("straight-on", mutex="camera"),
        P("head out of frame", mutex="camera"),
        P("feet out of frame", mutex="camera"),
        P("looking ahead", mutex="gaze"),
        P("sideways glance", mutex="gaze"),
        P("looking at breasts", mutex="gaze", heat=["tease", "flash", "sex"], needs=["female"]),
        P("frown"),
        P("light smile", implies=["smile"]),
        P("expressionless"),
        P("pout"),
        P("angry"),
        P("sad"),
        P("crying", implies=["tears"]),
        P("drooling", heat=["flash", "sex"]),
        P("moaning", heat=["sex"]),
        P("clenched teeth"),
        P("sparkling eyes"),
        P("empty eyes"),
        P("sleepy"),
        P("serious"),
        P("happy", implies=["smile"]),
        P("surprised"),
        P("scared"),
        P("smug"),
        P("nervous"),
    ]


def extra_male_look_tags() -> list[dict]:
    """Ugly / fat / otaku male looks. Physique mutexes muscle; otaku and ugly can stack with fat."""
    def F(tag, mutex=None, implies=None, bind=None, era=None, section="feature", layer="normal"):
        return {
            "tag": tag,
            "section": section,
            "gate": "male",
            "heat": list(HEATS),
            "mutex": mutex,
            "bind": bind or [],
            "implies": implies or [],
            "layer": layer,
            "era": era or ["any"],
            "needs": ["male"],
        }

    return [
        F("ugly bastard"),
        F("fat"),
        F("fat man", mutex="male_build", implies=["fat"]),
        F("obese", mutex="male_build", implies=["fat"]),
        F("manboobs"),
        F("old man"),
        F("bald", mutex="hair_length"),
        F("otaku"),
        F(
            "coke-bottle glasses",
            implies=["glasses"],
            era=["modern"],
            section="clothing",
            layer="accessory",
        ),
    ]


def extra_race_tags() -> list[dict]:
    """Male-only species. One race mutex; monster boy is the umbrella parent."""
    monsters = [
        "goblin",
        "orc",
        "oni",
        "ogre",
        "troll",
        "kobold",
        "lizardman",
        "minotaur",
        "centaur",
        "satyr",
        "demon boy",
        "demon",
        "werewolf",
        "lamia",
        "slime boy",
        "zombie",
        "skeleton",
        "alien",
    ]
    others = [
        "elf",
        "dark elf",
        "dwarf",
        "vampire",
        "merman",
        "wolf boy",
        "cat boy",
        "dog boy",
        "fox boy",
        "rabbit boy",
        "horse boy",
        "bear boy",
        "tiger boy",
        "lion boy",
        "dragon boy",
        "shark boy",
        "tanuki",
    ]
    out = []
    for tag in monsters + others:
        out.append(
            {
                "tag": tag,
                "section": "feature",
                "gate": "male",
                "heat": list(HEATS),
                "mutex": "race",
                "bind": [],
                "implies": ["monster boy"] if tag in monsters else [],
                "layer": "normal",
                "era": ["any"],
                "needs": ["male"],
            }
        )
    out.append(
        {
            "tag": "monster boy",
            "section": "feature",
            "gate": "male",
            "heat": list(HEATS),
            "mutex": None,
            "bind": [],
            "implies": [],
            "layer": "normal",
            "era": ["any"],
            "needs": ["male"],
        }
    )
    return out


def extra_era_tags() -> list[dict]:
    def C(tag, section, era, mutex=None, gate="any", heat=None, layer="garment", bind=None, implies=None):
        return {
            "tag": tag,
            "section": section,
            "gate": gate,
            "heat": heat or list(HEATS),
            "mutex": mutex,
            "bind": bind or [],
            "implies": implies or [],
            "layer": layer,
            "era": era,
        }

    ac, ag, md, edo, vic, mod = (
        ["ancient_china"],
        ["ancient_greece"],
        ["medieval"],
        ["edo"],
        ["victorian"],
        ["modern"],
    )
    return [
        C("dudou", "clothing", ac, mutex="onepiece", gate="female", heat=["tease", "flash"]),
        C("sash", "clothing", ac + edo, mutex=None, layer="accessory"),
        C("hair stick", "clothing", ac + edo, mutex="headwear", layer="accessory", gate="female"),
        C("hairpin", "clothing", ac + edo, mutex="headwear", layer="accessory", gate="female"),
        C("pelvic curtain", "clothing", ac, mutex="bottom", gate="female", heat=["flash", "sex"]),
        C("chiton", "clothing", ag, mutex="onepiece", bind=["ancient greek clothes"], heat=["tease", "flash", "sex"]),
        C("peplos", "clothing", ag, mutex="onepiece", gate="female", bind=["ancient greek clothes"], heat=["tease", "flash"]),
        C("himation", "clothing", ag, mutex="outer"),
        C("tunic", "clothing", md, mutex="onepiece", heat=["tease", "flash"]),
        C("cloak", "clothing", md + vic, mutex="outer"),
        C("hood", "clothing", md, mutex="headwear", layer="accessory"),
        C("circlet", "clothing", md + ag, mutex="headwear", layer="accessory"),
        C("leather armor", "clothing", md, mutex="onepiece", bind=["armor"], heat=["tease"]),
        C("haori", "clothing", edo, mutex="outer", bind=["japanese clothes"]),
        C("kanzashi", "clothing", edo, mutex="headwear", layer="accessory", gate="female"),
        C("zouri", "clothing", edo, mutex="feet"),
        C("bonnet", "clothing", vic, mutex="headwear", layer="accessory", gate="female"),
        C("parasol", "clothing", vic + edo + ac, mutex=None, layer="accessory"),
        C("ascot", "clothing", vic, mutex="neckwear", layer="accessory"),
        C("courtyard", "env", ac + ["ancient_greece", "medieval"], mutex="place", layer="normal", implies=["outdoors"]),
        C("pavilion", "env", ac + edo, mutex="place", layer="normal", implies=["outdoors"]),
        C("colonnade", "env", ag, mutex="place", layer="normal", implies=["outdoors"]),
    ]


def extra_corpus_tags() -> list[dict]:
    """special_prompts 語料稽核挖出來的字（見 語料新詞候選.md）。

    來源是 30792 個 Grok 寫的情境檔，解析出 91926 個不重複字串，扣掉我們已有的、
    只留用過 >=5 個檔的 8746 個，再**全部打 Danbooru API 查證**。結果只有 833 個
    是真的 tag 且有圖 —— 其餘七成以上是 Grok 自己發明的攝影指導與散文
    （eye-level framing、soft daylight、close intimate framing 這類），模型沒學過。

    這裡收的是「語料常用 + Danbooru 有量 + 我們沒有」的那批，刻意不收三種東西：
      1. 非合意主題（sexual harassment、forced、molestation…）—— 要專案主自己決定。
      2. 會跟引擎打架的（solo focus 撞 solo 與卡司、4boys 要改 castWeights、
         faceless male 撞「男性要交代身體」）—— 那些不是加個詞條就好。
      3. 太籠統的（floor、wall、dynamic pose、milk）—— 加了只會稀釋。

    另外語料裡的 `cowgirl` 是陷阱：Danbooru 會把它導到 cow girl（牛娘），
    不是騎乘位。騎乘位叫 cowgirl position，而那個我們本來就有。
    """
    all_h = list(HEATS)
    hot = ["tease", "flash", "sex"]
    sex_only = ["sex"]
    modern = ["modern"]
    any_era = ["any"]

    def env(tag, mutex=None, implies=None, era=None, zh=""):
        return {
            "tag": tag, "section": "env", "gate": "any", "heat": all_h,
            "mutex": mutex, "bind": [], "implies": implies or [],
            "layer": "normal", "era": era or any_era, "zh": zh,
        }

    def pose(tag, mutex=None, implies=None, needs=None, heat=None, gate="any", era=None, zh=""):
        return {
            "tag": tag, "section": "pose", "gate": gate, "heat": list(heat or all_h),
            "mutex": mutex, "bind": [], "implies": implies or [],
            "layer": "normal", "era": era or any_era, "needs": needs or [], "zh": zh,
        }

    def feat(tag, mutex=None, gate="any", era=None, zh=""):
        return {
            "tag": tag, "section": "feature", "gate": gate, "heat": all_h,
            "mutex": mutex, "bind": [], "implies": [],
            "layer": "normal", "era": era or any_era, "zh": zh,
        }

    def cloth(tag, mutex=None, layer="accessory", heat=None, gate="any", era=None, zh=""):
        return {
            "tag": tag, "section": "clothing", "gate": gate, "heat": list(heat or all_h),
            "mutex": mutex, "bind": [], "implies": [],
            "layer": layer, "era": era or any_era, "zh": zh,
        }

    return [
        # ---- 場地 ----------------------------------------------------------
        # 新場地在寫實模式下有個限制：畫面上只要有 ACT_PLACE 列過的活動，
        # 場地就必須在那個活動的清單裡，否則會被擋掉。所以這幾個目前主要是
        # 「沒有活動時」的背景，要讓它們配得上活動得另外補 ACT_PLACE。
        env("cave", mutex="place", era=any_era, zh="洞穴"),
        env("jungle", mutex="place", implies=["outdoors"], era=any_era, zh="叢林"),
        env("rural", mutex="place", implies=["outdoors"], era=any_era, zh="鄉間"),
        env("village", mutex="place", implies=["outdoors"], era=any_era, zh="村莊"),
        env("toilet stall", mutex="place", implies=["indoors"], era=modern, zh="廁所隔間"),
        env("canopy bed", mutex="place", implies=["indoors"],
            era=["victorian", "ancient_china", "medieval"], zh="四柱床"),

        # ---- 傢俱 ----------------------------------------------------------
        # on couch 補的是一個真的洞：我們有 on bed、on chair，卻沒有沙發版，
        # 而 engine 的 SPORT_BAD_FURNITURE 一直寫著詞庫裡不存在的 "on sofa"
        # （Danbooru 的正規名是 on couch），那條防護對沙發從來沒有生效過。
        env("on couch", mutex="furniture", implies=["indoors"], era=modern, zh="在沙發上"),
        env("on desk", mutex="furniture", implies=["indoors"], era=["modern", "victorian"], zh="在桌上"),
        env("under table", mutex="furniture", implies=["indoors"], era=any_era, zh="桌子底下"),

        # ---- 光源 ----------------------------------------------------------
        env("desk lamp", mutex="lighting", era=["modern", "victorian"], zh="檯燈"),

        # ---- 手持道具 ------------------------------------------------------
        # held_prop 是互斥的（一次拿一樣），而且**只靠 ACT_PROP 被活動拉出來** ——
        # 詞庫裡 18 個 held_prop，抽得到的 11 個全部有活動對應，沒有的一個都抽不到。
        # 所以這裡只收找得到活動鉤子的兩個，並在 engine 的 ACT_PROP 補上對應。
        # katana／tarot／thermometer／remote control／whistle 都是真的 Danbooru 字，
        # 但我們沒有「拔刀」「占卜」「量體溫」「看電視」「吹哨」這些活動，
        # 硬塞進別的活動只會畫出不合理的圖，所以這一輪不收。
        # camera 抽得到是因為 cellphone 只有現代，維多利亞那一格輪到它 ——
        # 早期攝影正好也說得通。mop 沒收：cleaning 的第一順位 broom 是通用時代，
        # 永遠輪不到第二個。要讓替代道具真的輪得到，得把 stampActProps 從
        # 「取第一個可用的」改成「在可用的裡面隨機挑」，那是另一件事。
        env("camera", mutex="held_prop", era=["modern", "victorian"], zh="相機"),

        # ---- 布景道具（不互斥，可以同時出現）------------------------------
        env("desk", era=["modern", "victorian"], zh="書桌"),
        env("bench", era=any_era, zh="長椅"),
        env("wooden bench", era=any_era, zh="木長椅"),
        env("nightstand", era=["modern", "victorian"], zh="床頭櫃"),
        env("counter", era=["modern", "victorian"], zh="檯面"),
        env("sink", era=["modern", "victorian"], zh="洗手台"),
        env("whiteboard", era=modern, zh="白板"),
        env("shopping cart", era=modern, zh="購物車"),
        env("steering wheel", era=modern, zh="方向盤"),
        env("microphone stand", era=modern, zh="麥克風架"),
        env("poker table", era=["modern", "victorian"], zh="牌桌"),
        env("tea set", era=any_era, zh="茶具"),
        env("crystal ball", era=any_era, zh="水晶球"),
        env("christmas tree", era=["modern", "victorian"], zh="聖誕樹"),
        env("ofuda", era=["edo", "ancient_china", "modern"], zh="符咒"),
        env("stained glass", era=["medieval", "victorian", "modern"], zh="彩繪玻璃"),
        env("iron bars", era=any_era, zh="鐵欄杆"),
        env("railing", era=any_era, zh="欄杆"),
        env("tiles", era=any_era, zh="磁磚"),
        env("rubble", era=any_era, zh="瓦礫"),
        env("crowd", era=any_era, zh="人群"),
        env("mecha", era=modern, zh="機甲"),

        # ---- 自然與環境 ----------------------------------------------------
        # wind 刻意不給 weather 互斥格：風和雨、雪本來就會同時出現，
        # 佔了那一格反而會互相擠掉。
        env("wind", era=any_era, zh="風"),
        env("grass", implies=["outdoors"], era=any_era, zh="草地"),
        env("sand", implies=["outdoors"], era=any_era, zh="沙"),
        env("moss", era=any_era, zh="青苔"),
        env("dust", era=any_era, zh="塵埃"),
        env("smoke", era=any_era, zh="煙"),
        env("full moon", implies=["outdoors"], era=any_era, zh="滿月"),
        env("reflection", era=any_era, zh="倒影"),
        env("condensation", era=any_era, zh="水氣凝結"),

        # ---- 時節與場合 ----------------------------------------------------
        env("christmas", era=["modern", "victorian"], zh="聖誕節"),
        env("chinese new year", era=["ancient_china", "modern"], zh="過年"),
        env("winter", era=any_era, zh="冬天"),
        env("wedding", era=any_era, zh="婚禮"),
        env("fantasy", era=any_era, zh="奇幻"),
        env("surreal", era=any_era, zh="超現實"),
        env("magic", era=any_era, zh="魔法"),
        env("tribal", era=any_era, zh="部落風"),
        env("medieval", era=["medieval"], zh="中世紀風"),

        # ---- 職業 ----------------------------------------------------------
        feat("military", mutex="job", era=modern, zh="軍人"),
        feat("police", mutex="job", era=modern, zh="警察"),
        feat("pilot", mutex="job", era=modern, zh="飛行員"),
        feat("delinquent", mutex="job", era=modern, zh="不良"),

        # ---- 種族與體型 ----------------------------------------------------
        # android 和 ghost 給 race 互斥格：你不會同時是哥布林又是機器人。
        # pointy ears 刻意**不**給 race —— 精靈已經是 race 了，而尖耳朵要能單獨
        # 出現在別的角色身上，佔了那一格反而會把 elf 擠掉。
        feat("android", mutex="race", era=modern, zh="機器人"),
        feat("ghost", mutex="race", era=any_era, zh="幽靈"),
        feat("pointy ears", era=any_era, zh="尖耳朵"),
        feat("tusks", era=any_era, zh="獠牙"),
        feat("green skin", era=any_era, zh="綠皮膚"),
        feat("giant male", gate="male", era=any_era, zh="巨大男性"),

        # ---- 身體 ----------------------------------------------------------
        feat("large areolae", gate="female", era=any_era, zh="大乳暈"),
        feat("belly", era=any_era, zh="肚子"),
        feat("bruise", era=any_era, zh="瘀青"),
        feat("bruise on face", era=any_era, zh="臉上瘀青"),
        feat("heart-shaped pupils", era=any_era, zh="愛心瞳"),
        feat("saliva trail", era=any_era, zh="唾液絲"),

        # ---- 服裝 ----------------------------------------------------------
        # 每一件都必須落在 normal 模式 fill("clothing") 的 outfit 白名單格子裡
        # （feet/waist/legs/jewelry/eyewear/neckwear/underwear_top/underwear_bottom/
        # outer/hands/headwear），不然就是加一個永遠抽不到的字 —— obi 和 sash
        # 當初就是這樣躺在詞庫裡沒人發現的。
        cloth("mask", mutex="headwear", era=any_era, zh="面具"),
        cloth("veil", mutex="headwear", era=any_era, zh="面紗"),
        cloth("prayer beads", mutex="neckwear", era=["ancient_china", "edo", "medieval"], zh="念珠"),
        cloth("gold chain", mutex="jewelry", era=any_era, zh="金鏈"),
        cloth("superhero costume", mutex="onepiece", layer="garment", era=modern, zh="超級英雄裝"),
        cloth("racing suit", mutex="onepiece", layer="garment", era=modern, zh="賽車服"),
        cloth("wetsuit", mutex="onepiece", layer="garment", era=modern, zh="潛水衣"),
        cloth("jersey", mutex="top", layer="garment", era=modern, zh="球衣"),
        cloth("lace bra", mutex="underwear_top", layer="underwear", gate="female", heat=hot,
              era=modern, zh="蕾絲胸罩"),
        cloth("crotchless panties", mutex="underwear_bottom", layer="underwear", gate="female",
              heat=hot, era=modern, zh="開襠內褲"),

        # ---- 綁縛 ----------------------------------------------------------
        # mutex 刻意留空，跟詞庫裡既有的 handcuffs／leash／o-ring 一致。
        # 它們不靠 outfit 白名單被抽出來，靠的是 engine 的 NEEDS_CONTEXT（沒有
        # bondage／bdsm／restrained 的場合就刪掉）加上 CTX_PULLS_ACC（有場合就
        # 機率拉進來）。負向擋、正向拉，兩半都要有，只擋不拉的話出現率會是 0。
        # blindfold 是例外：它就是戴在眼睛上，放進既有的 eyewear 格比較誠實，
        # 而且蒙眼本來就不限於綁縛場合。
        cloth("blindfold", mutex="eyewear", heat=hot, era=any_era, zh="眼罩"),
        cloth("shibari", heat=hot, era=any_era, zh="繩縛"),
        cloth("bound wrists", heat=hot, era=any_era, zh="綁手腕"),
        cloth("ball gag", heat=hot, era=modern, zh="口球"),
        cloth("nipple clamps", heat=hot, gate="female", era=modern, zh="乳夾"),
        cloth("remote control vibrator", heat=hot, gate="female", era=modern, zh="遙控跳蛋"),

        # ---- 表情 ----------------------------------------------------------
        pose("drunk", mutex="expression", era=any_era, zh="醉"),
        pose("flustered", mutex="expression", era=any_era, zh="慌張"),
        pose("nervous smile", mutex="expression", era=any_era, zh="緊張的笑"),
        pose("exhausted", mutex="expression", era=any_era, zh="精疲力盡"),
        pose("forced smile", mutex="expression", era=any_era, zh="強顏歡笑"),

        # ---- 視線與動作 ----------------------------------------------------
        pose("looking outside", mutex="gaze", era=any_era, zh="看向外面"),
        pose("arms around neck", needs=["pair"], era=any_era, zh="環抱脖子"),
        pose("kabedon", needs=["pair"], era=any_era, zh="壁咚"),
        pose("sandwiched", needs=["group"], heat=hot, era=any_era, zh="被夾在中間"),
        pose("struggling", era=any_era, zh="掙扎"),
        pose("bouncing", heat=hot, era=any_era, zh="彈動"),
        pose("hiding", mutex="activity", era=any_era, zh="躲藏"),
        pose("fighting", mutex="activity", era=any_era, zh="打鬥"),
        pose("livestream", mutex="activity", era=modern, zh="直播"),
        pose("mirror selfie", mutex="activity", implies=["mirror"], era=modern, zh="鏡子自拍"),

        # ---- 暴露 ----------------------------------------------------------
        # **不要**給它 clothes_action 互斥格。那一格是給「針對特定衣服的動作」用的
        # （shirt pull 要有襯衫、dress pull 要有洋裝），engine 在 flash 尺度會先
        # fillSlot 那一格，成功了就不再走多樣的 flash 群。而撩衣服對任何衣服都成立，
        # 於是它每次都贏在最高層 —— 實測佔掉 flash 圖的 88.1%，種類從 52 掉到 40。
        # 放回一般的 flash 動作，跟其他五十幾個平起平坐。
        pose("lifting own clothes", heat=hot, era=any_era, zh="撩起衣服"),
        pose("wardrobe malfunction", heat=hot, era=any_era, zh="走光"),
        pose("accidental exposure", heat=hot, era=any_era, zh="不慎走光"),

        # ---- 性（只在色情尺度出現）-----------------------------------------
        pose("internal cumshot", heat=sex_only, era=any_era, zh="中出"),
        pose("cum overflow", heat=sex_only, era=any_era, zh="精液滿溢"),
        pose("deep penetration", heat=sex_only, era=any_era, zh="深插"),
        pose("cum on tongue", heat=sex_only, era=any_era, zh="舌上精液"),
    ]


def extra_expand_tags() -> list[dict]:
    """Places, jobs, sports courts/balls/uniforms, and sex-heat tags from special_prompts."""
    all_h = list(HEATS)
    modern = ["modern"]
    sex = ["sex"]

    def job(tag, implies=None, needs=None, gate="any", zh=""):
        return {
            "tag": tag,
            "section": "feature",
            "gate": gate,
            "heat": all_h,
            "mutex": "job",
            "bind": [],
            "implies": implies or [],
            "layer": "normal",
            "era": modern,
            "needs": needs or [],
            "zh": zh,
        }

    def pose(tag, mutex=None, implies=None, needs=None, heat=None, era=None, zh=""):
        return {
            "tag": tag,
            "section": "pose",
            "gate": "any",
            "heat": list(heat or all_h),
            "mutex": mutex,
            "bind": [],
            "implies": implies or [],
            "layer": "normal",
            "era": era or ["any"],
            "needs": needs or [],
            "zh": zh,
        }

    def env(tag, mutex="place", implies=None, era=None, zh=""):
        return {
            "tag": tag,
            "section": "env",
            "gate": "any",
            "heat": all_h,
            "mutex": mutex,
            "bind": [],
            "implies": implies or [],
            "layer": "normal",
            "era": era or modern,
            "zh": zh,
        }

    def cloth(tag, mutex=None, layer="accessory", implies=None, gate="any", heat=None, zh=""):
        return {
            "tag": tag,
            "section": "clothing",
            "gate": gate,
            "heat": list(heat or all_h),
            "mutex": mutex,
            "bind": [],
            "implies": implies or [],
            "layer": layer,
            "era": modern,
            "zh": zh,
        }

    def feat(tag, mutex=None, needs=None, heat=None, gate="any", zh=""):
        return {
            "tag": tag,
            "section": "feature",
            "gate": gate,
            "heat": list(heat or all_h),
            "mutex": mutex,
            "bind": [],
            "implies": [],
            "layer": "normal",
            "era": ["any"],
            "needs": needs or [],
            "zh": zh,
        }

    out = [
        env("airplane interior", implies=["indoors"], zh="機艙"),
        env("airport", implies=["outdoors"], zh="機場"),
        env("cockpit", implies=["indoors"], zh="駕駛艙"),
        env("bus interior", implies=["indoors"], zh="公車內"),
        env("movie theater", implies=["indoors"], zh="電影院"),
        env("amusement park", implies=["outdoors"], zh="遊樂園"),
        env("ferris wheel", implies=["outdoors"], zh="摩天輪"),
        env("zoo", implies=["outdoors"], zh="動物園"),
        env("convenience store", implies=["indoors"], zh="便利商店"),
        env("supermarket", implies=["indoors"], zh="超市"),
        env("internet cafe", implies=["indoors"], zh="網咖"),
        env("prison", implies=["indoors"], zh="監獄"),
        env("construction site", implies=["outdoors"], zh="工地"),
        env("casino", implies=["indoors"], zh="賭場"),
        env("nightclub", implies=["indoors"], zh="夜店"),
        env("laboratory", implies=["indoors"], zh="實驗室"),
        env("church", implies=["indoors"], zh="教堂"),
        env("dojo", implies=["indoors"], zh="道場"),
        env("farm", implies=["outdoors"], zh="農場"),
        env("barn", implies=["indoors"], zh="穀倉"),
        env("rice paddy", implies=["outdoors"], zh="稻田"),
        env("parking lot", implies=["outdoors"], zh="停車場"),
        env("mountain", implies=["outdoors"], era=["any"], zh="山"),
        env("waterfall", implies=["outdoors"], era=["any"], zh="瀑布"),
        env("stadium", implies=["outdoors"], zh="體育場"),
        env("golf course", implies=["outdoors"], zh="高爾夫球場"),
        env("izakaya", implies=["indoors"], zh="居酒屋"),
        env("tavern", implies=["indoors"], era=["any"], zh="酒館"),
        env("ryokan", implies=["indoors"], era=["edo", "modern"], zh="旅館"),
        env("tent", implies=["outdoors"], era=["modern", "ancient_china", "medieval", "ancient_greece", "edo"], zh="帳篷"),
        env("campfire", mutex=None, implies=["outdoors"], zh="營火"),
        env("karaoke box", implies=["indoors"], zh="KTV包廂"),
        env("market stall", implies=["outdoors"], zh="夜市"),
        env("apartment", implies=["indoors"], zh="公寓"),
        env("basketball court", implies=["outdoors"], zh="籃球場"),
        env("tennis court", implies=["outdoors"], zh="網球場"),
        env("soccer field", implies=["outdoors"], zh="足球場"),
        env("baseball stadium", implies=["outdoors"], zh="棒球場"),
        env("bowling alley", implies=["indoors"], zh="保齡球館"),
        env("boxing ring", implies=["indoors"], zh="拳擊台"),
        env("running track", implies=["outdoors"], zh="跑道"),
        # 綜合球場可能在室內或室外，不能單向暗示 outdoors。
        env("sports court", zh="綜合球場"),
        env("bunk bed", mutex="furniture", implies=["indoors"], zh="雙層床"),
        env("basketball (object)", mutex="sport_ball", zh="籃球"),
        env("soccer ball", mutex="sport_ball", zh="足球"),
        env("tennis ball", mutex="sport_ball", zh="網球"),
        env("volleyball (object)", mutex="sport_ball", zh="排球"),
        env("baseball (object)", mutex="sport_ball", zh="棒球"),
        env("bowling ball", mutex="sport_ball", zh="保齡球"),
        env("golf ball", mutex="sport_ball", zh="高爾夫球"),
        env("tennis racket", mutex="sport_prop", zh="網球拍"),
        env("baseball bat", mutex="sport_prop", zh="球棒"),
        env("golf club", mutex="sport_prop", zh="高爾夫球桿"),
        env("badminton racket", mutex="sport_prop", zh="羽球拍"),
        env("table tennis paddle", mutex="sport_prop", zh="桌球拍"),
        env("baseball mitt", mutex="sport_prop", zh="棒球手套"),
        env("bow (weapon)", mutex="sport_prop", era=["any"], zh="弓"),
        env("shuttlecock", mutex="sport_ball", zh="羽球"),
        env("table tennis ball", mutex="sport_ball", zh="桌球"),
        # 箭不佔「手上拿的東西」那一格，才能跟弓共存。
        env("arrow (projectile)", mutex=None, era=["any"], zh="箭"),
        env("bicycle", mutex=None, zh="腳踏車"),
        env("guitar", mutex="held_prop", era=["any"], zh="吉他"),
        env("book", mutex="held_prop", era=["any"], zh="書"),
        env("pen", mutex="held_prop", era=["modern", "victorian"], zh="筆"),
        env("cellphone", mutex="held_prop", zh="手機"),
        env("cigarette", mutex="held_prop", era=["modern", "victorian"], zh="菸"),
        env("frying pan", mutex="held_prop", era=["any"], zh="平底鍋"),
        env("shopping bag", mutex="held_prop", zh="購物袋"),
        env("broom", mutex="held_prop", era=["any"], zh="掃把"),
        env("fishing rod", mutex="held_prop", era=["any"], zh="釣竿"),
        env("game controller", mutex="held_prop", zh="手把"),
        env("paintbrush", mutex="held_prop", era=["any"], zh="畫筆"),
        # 時代對得上的道具。ACT_PROP 會在活動定下來之後蓋一個道具上去，而
        # stampActProps() 本來就會用 eraOk 過濾，所以這裡的 era 欄就等於
        # 「哪個時代拿得到這個東西」—— 江戶抽菸拿的是煙管不是香菸。
        #
        # 修之前實測（每格 700 張）：江戶抽菸 22/22 都是香菸、維多利亞 62/62 也是；
        # 古中國、古希臘、中世紀、江戶寫字 50/50 都是原子筆（維多利亞 40/40、
        # 現代 30/30）—— 每一個時代都是 100%，差別只在那個時代抽到寫字幾次。
        # 香菸與原子筆原本掛 era=["any"]，所以它們贏遍所有時代。
        #
        # Danbooru 共現數佐證這幾個配對是模型學過的：
        #   kiseru+smoking 1019、cigar+smoking 2733、smoking pipe+smoking 2163
        #   bucket+cleaning 354（跟 broom+cleaning 346 同級）、mop+cleaning 243
        #   newspaper+reading 824、ladle+cooking 1619
        #
        # **刻意不收 kitchen knife**：3059 張裡 513 張同時標 blood（16.8%）、
        # 162 張標 yandere。拿它當煮飯道具，等於有六分之一的機會畫出帶血的刀。
        # 這跟負面詞那次加 cross-section 是同一套判準 —— 看共現率，不看語意上
        # 「它應該是廚具」。
        #
        # 古希臘寫字**刻意留空**。stylus 在 Danbooru 上主要是數位繪圖筆
        # （6268 張），用在古希臘會畫出現代觸控筆，比沒有道具更糟；
        # writing brush 查無（0 張）。沒有道具是既有且誠實的行為 ——
        # 麥克風在非現代時代也是這樣（實測 singing 在五個古代時代都是 0%）。
        # book 則刻意留著 era=["any"]：各時代都有某種形式的書，
        # 古希臘的卷軸換成書遠不如原子筆那麼刺眼。
        env("kiseru", mutex="held_prop", era=["edo"], zh="煙管"),
        env("smoking pipe", mutex="held_prop", era=["victorian"], zh="菸斗"),
        env("cigar", mutex="held_prop", era=["victorian"], zh="雪茄"),
        env("calligraphy brush", mutex="held_prop", era=["ancient_china", "edo"], zh="毛筆"),
        env("quill", mutex="held_prop", era=["medieval", "victorian"], zh="羽毛筆"),
        env("pencil", mutex="held_prop", era=["modern"], zh="鉛筆"),
        env("newspaper", mutex="held_prop", era=["modern", "victorian"], zh="報紙"),
        env("mop", mutex="held_prop", era=["modern"], zh="拖把"),
        env("bucket", mutex="held_prop", era=["any"], zh="水桶"),
        env("ladle", mutex="held_prop", era=["any"], zh="湯杓"),
        job("firefighter", zh="消防員"),
        job("scientist", implies=["lab coat"], zh="科學家"),
        job("farmer", zh="農夫"),
        job("construction worker", implies=["hard hat"], zh="工人"),
        job("janitor", zh="清潔工"),
        job("race queen", needs=["female"], gate="female", zh="賽車女郎"),
        job("soldier", implies=["military uniform"], zh="士兵"),
        pose("jogging", mutex="activity", implies=["outdoors"], era=modern, zh="慢跑"),
        pose("skiing", mutex="activity", implies=["outdoors", "snow"], era=modern, zh="滑雪"),
        pose("diving", mutex="activity", zh="潛水"),
        pose("weightlifting", mutex="activity", era=modern, zh="重訓"),
        pose("rape", needs=["pair"], heat=sex, zh="強姦"),
        pose("orgy", needs=["pair"], heat=sex, implies=["group sex", "sex"], zh="狂歡雜交"),
        pose("bondage", heat=sex, zh="束縛"),
        pose("bdsm", heat=sex, zh="BDSM"),
        pose("restrained", heat=sex, zh="被拘束"),
        pose("prostitution", needs=["pair"], heat=sex, zh="賣淫"),
        pose("pet play", heat=sex, zh="寵物扮演"),
        cloth("soccer uniform", mutex="onepiece", layer="garment", implies=["sportswear"], zh="足球服"),
        cloth("baseball uniform", mutex="onepiece", layer="garment", implies=["sportswear"], zh="棒球服"),
        cloth("tennis uniform", mutex="onepiece", layer="garment", implies=["sportswear"], zh="網球服"),
        cloth("volleyball uniform", mutex="onepiece", layer="garment", implies=["sportswear"], zh="排球服"),
        cloth("buruma", mutex="bottom", layer="garment", zh="體操褲"),
        # 運動裝備。全部經 Danbooru API 核實（category 0、post_count > 0、非 deprecated）。
        cloth("cleats", mutex="feet", layer="garment", zh="釘鞋"),
        cloth("boxing shorts", mutex="bottom", layer="garment", implies=["shorts"], zh="拳擊短褲"),
        cloth("boxing gloves", mutex="hands", layer="accessory", implies=["gloves"], zh="拳擊手套"),
        cloth("baseball cap", mutex="headwear", layer="accessory", implies=["hat"], zh="棒球帽"),
        cloth("bicycle helmet", mutex="headwear", layer="accessory", implies=["helmet"], zh="自行車安全帽"),
        cloth("swim cap", mutex="headwear", layer="accessory", zh="泳帽"),
        cloth("goggles", mutex="eyewear", layer="accessory", zh="蛙鏡"),
        # 護膝不佔襪類那一格，它可以跟長襪同時出現。
        cloth("knee pads", layer="accessory", zh="護膝"),
        cloth("santa costume", mutex="onepiece", layer="garment", zh="聖誕裝"),
        cloth("handcuffs", layer="accessory", heat=sex, zh="手銬"),
        cloth("leash", layer="accessory", zh="牽繩"),
        cloth("bodypaint", layer="skin", zh="人體彩繪"),
        feat("bride", needs=["female"], gate="female", zh="新娘"),
        feat("gyaru", needs=["female"], gate="female", zh="辣妹"),
        feat("small penis", needs=["male"], gate="male", heat=sex, zh="小陰莖"),
    ]
    return out


def main() -> None:
    rows: list[dict] = []
    for path in sorted(PARTS.glob("*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(raw, dict) and "tags" in raw:
            raw = raw["tags"]
        if not isinstance(raw, list):
            continue
        rows.extend(raw)
    rows.extend(extra_era_tags())
    rows.extend(extra_race_tags())
    rows.extend(extra_male_look_tags())
    rows.extend(extra_shot_face_tags())
    rows.extend(extra_sex_position_tags())
    rows.extend(extra_bath_tags())
    rows.extend(extra_activity_tags())
    rows.extend(extra_job_scene_tags())
    rows.extend(extra_expand_tags())
    rows.extend(extra_corpus_tags())
    rows.extend(extra_loli_tags())
    rows.extend(extra_shota_tags())
    rows.extend(extra_style_tags())
    rows.extend(extra_quality_boost_tags())

    old_zh: dict[str, str] = {}
    if OUT.exists():
        try:
            prev = json.loads(OUT.read_text(encoding="utf-8"))
            old_zh.update(prev.get("zh") or {})
            for t in prev.get("tags") or []:
                if t.get("zh"):
                    old_zh[t["tag"]] = t["zh"]
        except Exception:
            pass

    seen: set[tuple[str, str]] = set()
    unique: list[dict] = []
    dropped = 0
    for item in rows:
        n = norm(item)
        if not n:
            dropped += 1
            continue
        key = (n["tag"], n["section"])
        if key in seen:
            dropped += 1
            continue
        seen.add(key)
        if item.get("zh"):
            n["zh"] = item["zh"]
        elif n["tag"] in old_zh:
            n["zh"] = old_zh[n["tag"]]
        unique.append(n)

    inherit_eras(unique)

    by_sec: dict[str, int] = {}
    for t in unique:
        by_sec[t["section"]] = by_sec.get(t["section"], 0) + 1

    data = {
        "quality": [
            "masterpiece",
            "best quality",
            "amazing quality",
        ],
        "nsfwTail": ["nsfw", "explicit"],
        "sfwTail": ["sfw", "general"],
        "sensitiveTail": ["sensitive"],
        # areolae 拿掉了：Danbooru 上它是 deprecated（17671 篇但已停用），
        # 而同一份清單裡的 nipples 有 1142587 篇，本來就把它蓋住了。
        # 想保留同樣意思又要現役的話是 large areolae(48770)，但在 nipples 旁邊是多餘的。
        "sensitiveNegative": [
            "explicit", "nude", "nipples", "pussy", "penis", "sex", "cum",
            "topless female", "bottomless", "pubic hair",
        ],
        "sfwNegative": [
            "nsfw", "explicit", "questionable", "nude", "nipples", "pussy",
            "penis", "sex", "cum", "topless female", "bottomless",
            "panties", "underwear", "cameltoe", "pubic hair",
        ],
        # 清空：soft lighting 在 Danbooru 是 0 篇、也不在 Illustrious 的訓練字彙裡，
        # 兩本字典都查不到卻每張圖硬掛。打光交給 light 群組隨機抽，那裡有 22 個
        # 有真實訊號的 tag（shadow 164778、sunlight 102678、backlighting 45718…）。
        "alwaysEnv": [],
        "negative": NEGATIVE,
        "defaults": {
            "n": 1,
            "width": 1024,
            "height": 1024,
            "counts": {
                "subject": 2,
                "feature": 8,
                "pose": 6,
                "clothing": 5,
                # 4 -> 6。這個 4 從初始 commit 就沒動過，但 drawOne() 明確填的 env
                # 格子一路加到四個（place / in_out / day_night / lighting），而
                # countSection() 連 implies 帶進來的字一起算 —— 光是 indoors／
                # outdoors 就佔掉每張圖 1.01 格（99% 的圖都有，而且幾乎都是場地
                # 免費帶進來的，不是抽的）。結果通用的 fill("env") 預算永遠是 0。
                #
                # 實測（8000 張、預設設定）：配額給 4 和給 5 完全一樣（env 每張都是
                # 5.57），要給到 6 才真的多撈得到東西（6.11）。所以「補回 lighting
                # 吃掉的那一格」不是 +1 而是 +2 —— 我原本以為 +1 就夠，量過才發現不是。
                #
                # 換來 40 個字從「永遠抽不到」變成抽得到，代價是每張圖多 0.54 個
                # env 字、6 個字元（約 2 個 token）：星空、藍天、景深、膠片顆粒、
                # 床、窗簾、鏡子、樹、營火，以及**全部的運動器材**（網球拍、高爾夫球桿、
                # 棒球手套、弓箭）—— 運動預設那一整套的道具以前在預設設定下全都抽不到。
                "env": 6,
            },
            "girl": True,
            "boy": False,
            "heats": ["tease", "flash", "sex"],
            "heatPreset": "mixed",
            "eras": ["modern"],
        },
        "heatWeights": {
            "mixed": {"tease": 0.3, "flash": 0.3, "sex": 0.4},
            "tease": {"tease": 1.0, "flash": 0.0, "sex": 0.0},
            "flash": {"tease": 0.0, "flash": 1.0, "sex": 0.0},
            "sex": {"tease": 0.0, "flash": 0.0, "sex": 1.0},
        },
        # 補三個缺口，權重照 Danbooru 的真實比例推出來，其餘等比例縮放。
        #
        # 原本 mixed 有「兩女一男」卻**沒有「一女兩男」** —— 而 Danbooru 上
        # 1girl 2boys 有 96,530 篇，是 2girls 1boy（124,384）的 78%。同一個量級
        # 卻一邊有一邊沒有，那是漏不是取捨。代價是四個姿勢直接死掉：spitroast、
        # double penetration、mmf threesome、reverse spitroast 都要 group(3人)+2male，
        # 而當時**沒有任何組合同時滿足這兩個條件**。
        #
        # 4girls（145,822）和 3boys（105,997）同理，都是有量卻不在表裡。
        #
        #   mixed  1girl,2boys = 0.08 x 96530/124384 = 0.062 -> 0.06
        #   girl   4girls      = 0.06 x 145822/328428 = 0.027 -> 0.03
        #   boy    3boys       = 0.22 x 105997/469237 = 0.050 -> 0.05
        #
        # gangbang 仍然抽不到：它要 crowd(4人)，而四人組合（2girls 2boys 只有
        # 37,463 篇）是另一件事，這次不加，維持釘選限定。
        "castWeights": {
            "girl_only": {"1girl": 0.70, "2girls": 0.21, "3girls": 0.06, "4girls": 0.03},
            "boy_only": {"1boy": 0.74, "2boys": 0.21, "3boys": 0.05},
            "mixed": {
                "1girl": 0.39,
                "1boy": 0.11,
                "1girl,1boy": 0.27,
                "2girls": 0.09,
                "2girls,1boy": 0.08,
                "1girl,2boys": 0.06,
            },
            # 只勾「性愛」時用這張，比 mixed 更偏向成對。原本這張表是**寫死在**
            # engine.js 的 chooseCast() 裡，於是同一份分佈有兩個來源 —— 補了詞庫
            # 這邊的「一女兩男」，寫死那邊照樣沒有，而那張才是勾性愛時真正在用的。
            # 搬過來只留一個來源，才不會再各改各的。
            # 權重同樣照 Danbooru 比例：0.16 x 96530/124384 = 0.124 -> 0.12。
            "sex": {
                "1girl,1boy": 0.56,
                "2girls,1boy": 0.14,
                "2girls": 0.11,
                "1girl": 0.07,
                "1girl,2boys": 0.12,
            },
        },
        "groupOrder": GROUP_ORDER,
        "groupZh": GROUP_ZH,
        "eraAnchors": ERA_ANCHORS,
        "eraAnchorAlts": ERA_ANCHOR_ALTS,
        "zh": {t: old_zh[t] for t in (
            "masterpiece", "best quality", "amazing quality",
            "absurdres", "highres", "very aesthetic", "highly aesthetic", "newest",
            "nsfw", "explicit",
        ) if t in old_zh},
        "tags": unique,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {OUT} tags={len(unique)} dropped={dropped} {by_sec}")


if __name__ == "__main__":
    main()
