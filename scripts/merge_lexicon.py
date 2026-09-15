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

NEGATIVE = (
    "bad quality, worst quality, worst detail, lowres, sketch, censor, censored, "
    "bar censor, mosaic censoring, text, watermark, signature, username, logo, "
    "speech bubble, bad anatomy, bad hands, extra fingers, fused fingers, missing "
    "fingers, extra limbs, deformed, disfigured, ugly, blurry, jpeg artifacts, "
    "3d, realistic, photorealistic"
)

BANNED = {
    "toddler",
    "underage",
    "kid",
    "children",
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

ERA_ANCHORS = {
    "modern": ["modern"],
    "ancient_china": ["chinese clothes", "chinese architecture"],
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
    "naked towel": _M,
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
    # 江戶圖在泡澡。ofuro 跟 bath、sento 跟 onsen 畫出來幾乎是同一種場景 ——
    # 五個日式浴場各自競爭，合計機率就是單一場地的五倍。留 onsen 和
    # open-air bath 撐江戶的沐浴文化，這兩個回歸現代。
    "sento": _M,
    "ofuro": _M,
    "open-air bath": ["edo", "modern"],
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
    "chinese architecture": ["ancient_china"],
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
    "public sex": ["sex"],
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
    "nerd": ["otaku"],
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
    "sento": ["bath", "indoors"],
    "bubble bath": ["bath", "indoors"],
    "open-air bath": ["outdoors"],
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
    "facesitting": "sitting",
}
for _act, _pose in SEX_POSE_BODY.items():
    _im = list(IMPLIES.get(_act) or ["sex"])
    if "sex" not in _im:
        _im.append("sex")
    if _pose not in _im:
        _im.append(_pose)
    IMPLIES[_act] = _im

RECLASS = {
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
    "cherry blossoms": {"mutex": "weather", "era": ["any"]},
    "tall male": {"mutex": "height_m", "gate": "male"},
    "short male": {"mutex": "height_m", "gate": "male"},
    "male pubic hair": {"gate": "male", "heat": ["flash", "sex"]},
    "female pubic hair": {"gate": "female", "heat": ["flash", "sex"]},
    "arm hair": {"gate": "male"},
    "leg hair": {"gate": "male"},
    "side-tie bikini bottom": {"mutex": "bottom", "section": "clothing", "layer": "garment"},
    "shoulder armor": {"mutex": None, "layer": "accessory", "section": "clothing"},
    "underwear": {"mutex": None},
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
    "facesitting",
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
    "creampie",
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
    "areolae",
    "milf",
    "mature female",
    "female pubic hair",
    "upright straddle",
    "reverse upright straddle",
    "piledriver (sex)",
    "thigh sex",
    "mmf threesome",
    "ffm threesome",
    "lactation",
    "pink nipples",
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
    "kissing",
    "french kiss",
    "looking at another",
    "eye contact",
    "hug",
    "cuddling",
    "straddling",
    "hug from behind",
    "sitting on lap",
    "pinned down",
    "lifting person",
    "happy sex",
    "breast grab",
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
    "public sex",
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
    "facesitting",
    "tribadism",
    "upright straddle",
    "reverse upright straddle",
    "reverse suspended congress",
    "piledriver (sex)",
    "boy on top",
    "thigh sex",
    "frottage",
    "reverse spitroast",
    "washing another's back",
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
        ("webtoon", "條漫", "coloring"),
        ("lineart", "線稿", "coloring"),
        ("monochrome", "單色", "coloring"),
        ("clean lines", "乾淨線條", "line_weight"),
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
        pose("washing body", mutex=None, zh="洗身體"),
        pose("washing another's back", mutex=None, needs=["pair"], zh="洗別人的背"),
        pose("splashing", mutex=None, zh="潑水"),
        pose("after bathing", mutex=None, zh="浴後"),
        pose("shared bathing", needs=["pair"], implies=["bathing"], zh="共浴"),
        env("sento", implies=["bath", "indoors"], era=edo_mod, zh="錢湯"),
        env("ofuro", implies=["bath", "indoors"], era=edo_mod, zh="日式浴桶"),
        env("open-air bath", implies=["outdoors"], era=edo_mod, zh="露天風呂"),
        env("bubble bath", implies=["bath", "indoors"], era=["modern"], zh="泡泡浴"),
        env("shower head", mutex=None, implies=["shower (place)"], era=["modern"], zh="蓮蓬頭"),
        env("soap bubbles", mutex=None, zh="肥皂泡"),
        cloth("towel", zh="毛巾"),
        cloth("innertube", era=["modern"], zh="泳圈"),
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
        feat("pink nipples", needs=["female"], zh="粉紅乳頭"),
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


def extra_breast_feel_tags() -> list[dict]:
    """Always-on breast feel. No mutex so they sit beside breast_size."""
    return [
        {
            "tag": tag,
            "section": "feature",
            "gate": "female",
            "heat": list(HEATS),
            "mutex": None,
            "bind": [],
            "implies": [],
            "layer": "normal",
            "era": ["any"],
            "needs": ["female"],
        }
        for tag in ("soft breasts", "natural breasts")
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
        P("extreme close-up", mutex="camera", implies=["close-up"]),
        P("over shoulder", mutex="camera"),
        P("from outside", mutex="camera"),
        P("lower body", mutex="camera"),
        P("straight-on", mutex="camera"),
        P("head out of frame", mutex="camera"),
        P("feet out of frame", mutex="camera"),
        P("looking away", mutex="gaze"),
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
        F("nerd", implies=["otaku"]),
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
        "hobgoblin",
        "oni",
        "ogre",
        "troll",
        "kobold",
        "lizardman",
        "minotaur",
        "centaur",
        "satyr",
        "incubus",
        "demon",
        "werewolf",
        "naga",
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
        C("cravat", "clothing", vic, mutex="neckwear", layer="accessory"),
        C("courtyard", "env", ac + ["ancient_greece", "medieval"], mutex="place", layer="normal", implies=["outdoors"]),
        C("pavilion", "env", ac + edo, mutex="place", layer="normal", implies=["outdoors"]),
        C("lotus pond", "env", ac, mutex="place", layer="normal", implies=["outdoors"]),
        C("colonnade", "env", ag, mutex="place", layer="normal", implies=["outdoors"]),
        C("great hall", "env", md + vic, mutex="place", layer="normal", implies=["indoors"]),
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
        env("dormitory", implies=["indoors"], zh="宿舍"),
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
        env("night market", implies=["outdoors"], zh="夜市"),
        env("food stall", implies=["outdoors"], zh="小吃攤"),
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
        env("pen", mutex="held_prop", era=["any"], zh="筆"),
        env("cellphone", mutex="held_prop", zh="手機"),
        env("cigarette", mutex="held_prop", era=["any"], zh="菸"),
        env("frying pan", mutex="held_prop", era=["any"], zh="平底鍋"),
        env("shopping bag", mutex="held_prop", zh="購物袋"),
        env("broom", mutex="held_prop", era=["any"], zh="掃把"),
        env("fishing rod", mutex="held_prop", era=["any"], zh="釣竿"),
        env("game controller", mutex="held_prop", zh="手把"),
        env("paintbrush", mutex="held_prop", era=["any"], zh="畫筆"),
        job("firefighter", zh="消防員"),
        job("scientist", implies=["lab coat"], zh="科學家"),
        job("farmer", zh="農夫"),
        job("construction worker", implies=["hard hat"], zh="工人"),
        job("janitor", zh="清潔工"),
        job("race queen", needs=["female"], gate="female", zh="賽車女郎"),
        job("soldier", implies=["military uniform"], zh="軍人"),
        pose("jogging", mutex="activity", implies=["outdoors"], era=modern, zh="慢跑"),
        pose("skiing", mutex="activity", implies=["outdoors", "snow"], era=modern, zh="滑雪"),
        pose("diving", mutex="activity", zh="潛水"),
        pose("weightlifting", mutex="activity", era=modern, zh="重訓"),
        pose("rape", needs=["pair"], heat=sex, zh="強姦"),
        pose("orgy", needs=["pair"], heat=sex, implies=["group sex", "sex"], zh="群交"),
        pose("bondage", heat=sex, zh="束縛"),
        pose("bdsm", heat=sex, zh="BDSM"),
        pose("restrained", heat=sex, zh="被拘束"),
        pose("free use", needs=["pair"], heat=sex, zh="自由使用"),
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
    rows.extend(extra_loli_tags())
    rows.extend(extra_shota_tags())
    rows.extend(extra_breast_feel_tags())
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
        "sensitiveNegative": [
            "explicit", "nude", "nipples", "pussy", "penis", "sex", "cum",
            "areolae", "topless", "bottomless", "pubic hair",
        ],
        "sfwNegative": [
            "nsfw", "explicit", "questionable", "nude", "nipples", "pussy",
            "penis", "sex", "cum", "areolae", "topless", "bottomless",
            "panties", "underwear", "cameltoe", "pubic hair",
        ],
        "alwaysEnv": ["soft lighting"],
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
                "env": 4,
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
        "castWeights": {
            "girl_only": {"1girl": 0.72, "2girls": 0.22, "3girls": 0.06},
            "boy_only": {"1boy": 0.78, "2boys": 0.22},
            "mixed": {
                "1girl": 0.42,
                "1boy": 0.12,
                "1girl,1boy": 0.28,
                "2girls": 0.1,
                "2girls,1boy": 0.08,
            },
        },
        "groupOrder": GROUP_ORDER,
        "groupZh": GROUP_ZH,
        "eraAnchors": ERA_ANCHORS,
        "eraAnchorAlts": ERA_ANCHOR_ALTS,
        "zh": {t: old_zh[t] for t in (
            "masterpiece", "best quality", "amazing quality",
            "absurdres", "highres", "very aesthetic", "highly aesthetic", "newest",
            "nsfw", "explicit", "soft lighting",
        ) if t in old_zh},
        "tags": unique,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {OUT} tags={len(unique)} dropped={dropped} {by_sec}")


if __name__ == "__main__":
    main()
