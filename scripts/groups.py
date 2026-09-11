"""Assign a display subgroup to each tag. One source of truth for merge + UI order."""

GROUP_ORDER = {
    "quality": ["fixed", "style", "boost"],
    "subject": ["count_f", "count_m", "extra"],
    "feature": [
        "hair_len",
        "hair_color",
        "hair_style",
        "eyes",
        "body_f",
        "body_m",
        "race",
        "skin",
        "makeup",
        "job",
        "other",
    ],
    "pose": ["body", "camera", "gaze", "face", "tease", "flash", "sex", "activity", "other"],
    "clothing": [
        "nude",
        "era",
        "onepiece",
        "top",
        "bottom",
        "underwear",
        "legs",
        "feet",
        "outer",
        "fabric",
        "acc",
    ],
    "env": ["inout", "place", "furniture", "time", "weather", "sky", "light", "other"],
}

GROUP_ZH = {
    "fixed": "固定",
    "style": "風格",
    "boost": "解析／美感",
    "count_f": "人數・女",
    "count_m": "人數・男",
    "extra": "其他",
    "hair_len": "髮長",
    "hair_color": "髮色",
    "hair_style": "髮型",
    "eyes": "眼睛",
    "body_f": "體型・女",
    "body_m": "體型・男",
    "race": "種族・男",
    "skin": "膚質／標記",
    "body": "身體姿勢",
    "camera": "鏡頭",
    "gaze": "視線",
    "face": "表情",
    "tease": "誘惑",
    "flash": "走光",
    "sex": "性愛",
    "activity": "活動",
    "makeup": "妝容",
    "job": "職業",
    "nude": "裸身",
    "era": "時代服裝",
    "onepiece": "連身／套裝",
    "top": "上衣",
    "bottom": "下身",
    "underwear": "內衣",
    "legs": "腿襪",
    "feet": "鞋履",
    "outer": "外套",
    "fabric": "袖口／材質",
    "acc": "飾品",
    "inout": "室內外",
    "place": "地點",
    "furniture": "坐臥面",
    "time": "晝夜",
    "weather": "天氣",
    "sky": "天空",
    "light": "光線",
    "other": "其他",
}

# Parent garments whose mutex is cleared (umbrella). Keep them next to children.
UMBRELLA_GROUP = {
    "dress": "onepiece",
    "school uniform": "onepiece",
    "leotard": "onepiece",
    "bodysuit": "onepiece",
    "swimsuit": "onepiece",
    "bikini": "onepiece",
    "one-piece swimsuit": "onepiece",
    "kimono": "era",
    "yukata": "era",
    "chinese clothes": "era",
    "japanese clothes": "era",
    "ancient greek clothes": "era",
    "armor": "era",
    "chainmail": "era",
    "shirt": "top",
    "tank top": "top",
    "sweater": "top",
    "skirt": "bottom",
    "shorts": "bottom",
    "pants": "bottom",
    "bra": "underwear",
    "panties": "underwear",
    "underwear": "underwear",
    "jacket": "outer",
    "coat": "outer",
    "cardigan": "outer",
    "thighhighs": "legs",
    "socks": "legs",
}

FABRIC = {
    "wide sleeves",
    "frills",
    "long sleeves",
    "short sleeves",
    "sleeves rolled up",
    "detached sleeves",
    "puffy sleeves",
}

MAKEUP = {
    "makeup",
    "lipstick",
    "nail polish",
    "red nails",
    "pink nails",
}

BODY_ANY = {
    "collarbone",
    "navel",
    "armpits",
    "midriff",
    "toned",
    "plump",
    "skinny",
    "long legs",
}

SKY = {
    "sky",
    "blue sky",
    "orange sky",
    "starry sky",
}

HAIR_STYLE = {
    "ponytail",
    "high ponytail",
    "side ponytail",
    "twintails",
    "braid",
    "twin braids",
    "single braid",
    "messy hair",
    "ahoge",
    "bangs",
    "blunt bangs",
    "swept bangs",
    "sidelocks",
    "hime cut",
    "hair bun",
    "double bun",
    "single hair bun",
    "drill hair",
    "wavy hair",
    "straight hair",
    "curly hair",
    "parted hair",
    "hair over one eye",
    "hair between eyes",
    "hair over shoulder",
}

HAIR_COLOR_LOOK = {
    "gradient hair",
    "streaked hair",
    "two-tone hair",
    "colored inner hair",
}

BODY_HAIR = {
    "pubic hair": "body_f",
    "female pubic hair": "body_f",
    "male pubic hair": "body_m",
    "leg hair": "body_m",
    "arm hair": "body_m",
    "chest hair": "body_m",
    "facial hair": "body_m",
}

FACE = {
    "smile",
    "seductive smile",
    "smirk",
    "grin",
    "open mouth",
    "parted lips",
    "tongue out",
    "biting own lip",
    "naughty face",
    "half-closed eyes",
    "embarrassed",
    "shy",
    "aroused",
    "ahegao",
    "rolling eyes",
    "orgasm",
    "wink",
    "heavy breathing",
    "panting",
    "fucked silly",
    "come hither",
    "licking lips",
    "frown",
    "light smile",
    "expressionless",
    "pout",
    "angry",
    "sad",
    "crying",
    "drooling",
    "moaning",
    "clenched teeth",
    "sparkling eyes",
    "empty eyes",
    "sleepy",
    "serious",
    "happy",
    "surprised",
    "scared",
    "smug",
    "nervous",
}

SKIN = {
    "blush",
    "body blush",
    "sweat",
    "shiny skin",
    "wet",
    "tan",
    "tanlines",
    "dark skin",
    "very dark skin",
    "pale skin",
    "mole",
    "mole under eye",
    "freckles",
    "body freckles",
    "scar",
    "tattoo",
    "steaming body",
    "wet hair",
}

SEX = {
    "sex",
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
    "clothed sex",
    "public sex",
    "happy sex",
    "creampie",
    "cum",
    "facial",
    "ejaculation",
    "after sex",
    "after vaginal",
    "upright straddle",
    "reverse upright straddle",
    "reverse suspended congress",
    "piledriver (sex)",
    "boy on top",
    "thigh sex",
    "frottage",
    "reverse spitroast",
    "rape",
    "orgy",
    "bondage",
    "bdsm",
    "restrained",
    "free use",
    "prostitution",
    "pet play",
}


def assign_group(item: dict) -> str:
    sec = item.get("section") or ""
    mx = item.get("mutex") or ""
    layer = item.get("layer") or ""
    tag = item.get("tag") or ""
    heat = item.get("heat") or []
    gate = item.get("gate") or "any"

    if sec == "quality":
        if tag in {"absurdres", "highres", "very aesthetic", "highly aesthetic", "newest"}:
            return "boost"
        return "style"

    if sec == "subject":
        if mx == "female_count":
            return "count_f"
        if mx == "male_count":
            return "count_m"
        return "extra"

    if sec == "feature":
        if mx == "job":
            return "job"
        if mx == "race" or tag == "monster boy":
            return "race"
        if mx == "male_build" or tag in {
            "ugly bastard",
            "fat",
            "fat man",
            "obese",
            "manboobs",
            "old man",
            "otaku",
            "nerd",
        }:
            return "body_m"
        if mx == "hair_length":
            return "hair_len"
        if mx == "hair_color" or tag in HAIR_COLOR_LOOK:
            return "hair_color"
        if mx == "eye_color" or "eye" in tag or tag in {"eyelashes", "eyeshadow", "heterochromia", "tareme", "tsurime"}:
            return "eyes"
        if tag in BODY_HAIR:
            return BODY_HAIR[tag]
        if mx == "hair_style" or tag in HAIR_STYLE or tag.endswith(" bangs") or tag.endswith(" ponytail"):
            return "hair_style"
        if tag in MAKEUP:
            return "makeup"
        if mx == "height" or tag in {"loli", "tall female", "petite"}:
            return "body_f"
        if mx == "height_m" or tag in {"shota", "tall male", "short male"}:
            return "body_m"
        if mx == "breast_size" or gate == "female" and any(
            k in tag
            for k in (
                "breast",
                "hip",
                "thigh",
                "waist",
                "milf",
                "mature female",
                "nipple",
                "areola",
                "pussy",
                "ass",
                "cleavage",
                "curvy",
                "pregnant",
                "clitoris",
            )
        ):
            return "body_f"
        if tag in BODY_ANY:
            return "body_f" if gate != "male" else "body_m"
        if gate == "male" or tag in {
            "muscular",
            "abs",
            "pectorals",
            "bara",
            "facial hair",
            "stubble",
            "beard",
            "penis",
            "erection",
            "testicles",
        }:
            return "body_m"
        if tag in SKIN:
            return "skin"
        return "other"

    if sec == "pose":
        if mx == "body_pose":
            return "body"
        if mx == "camera":
            return "camera"
        if mx == "gaze":
            return "gaze"
        if mx == "expression" or tag in FACE:
            return "face"
        if mx == "clothes_action":
            return "flash"
        if mx == "activity":
            return "activity"
        if mx == "sex_act" or tag in SEX or heat == ["sex"]:
            return "sex"
        if "flash" in heat and "tease" not in heat:
            return "flash"
        if tag in {
            "flashing",
            "upskirt",
            "downblouse",
            "one breast out",
            "undressing",
            "skirt lift",
            "clothes lift",
            "exhibitionism",
        }:
            return "flash"
        if "tease" in heat:
            return "tease"
        return "other"

    if sec == "clothing":
        eras = item.get("era") or []
        era_only = bool(eras) and "any" not in eras and "modern" not in eras
        if mx == "nudity" or layer == "skin":
            return "nude"
        if tag in FABRIC or mx == "fabric":
            return "fabric"
        if era_only and layer == "garment":
            return "era"
        if tag in UMBRELLA_GROUP:
            return UMBRELLA_GROUP[tag]
        if mx == "onepiece":
            return "onepiece"
        if mx == "top":
            return "top"
        if mx == "bottom":
            return "bottom"
        if mx in {"underwear_top", "underwear_bottom"}:
            return "underwear"
        if mx == "legs":
            return "legs"
        if mx == "feet":
            return "feet"
        if mx == "outer":
            return "outer"
        if layer == "accessory" or mx in {
            "jewelry",
            "neckwear",
            "headwear",
            "eyewear",
            "hands",
        }:
            return "acc"
        return "acc"

    if sec == "env":
        if mx == "in_out":
            return "inout"
        if mx == "place":
            return "place"
        if mx == "furniture":
            return "furniture"
        if mx == "day_night":
            return "time"
        if mx == "weather" or tag in {"cherry blossoms"}:
            return "weather"
        if tag in SKY:
            return "sky"
        if mx == "lighting" or "light" in tag:
            return "light"
        return "other"

    return "other"
