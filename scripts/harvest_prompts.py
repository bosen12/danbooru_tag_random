#!/usr/bin/env python3
"""Sample special_prompts packs, keep Danbooru-confirmed tags missing from the lexicon."""
from __future__ import annotations

import json
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from groups import assign_group
from merge_lexicon import BANNED, HEATS

ROOT = Path(__file__).resolve().parents[1]
# Optional: a directory of prompt-pack JSON to mine for new tags. Not part of this repo.
PACKS = Path(os.environ.get("PACKS_DIR", "/mnt/c/projects/special_prompts"))
LEX = ROOT / "web" / "lexicon.json"
OUT_PART = ROOT / "web" / "lexicon_parts" / "05-harvest.json"
REPORT = ROOT / "scripts" / "harvest_report.json"
CACHE = ROOT / "scripts" / ".cache_danbooru_tags.json"

SAMPLE = 5000
SEED = 20260906
MIN_CONF = 0.5
MIN_PACKS = 8
MIN_POSTS = 80
WORKERS = 4
UA = "danbooru-tag-random-harvest/1.0 (local lexicon builder)"

SKIP_CAT = {1, 3, 4, 5}  # artist, copyright, character, meta
SKIP_TAGS = {
    "english text",
    "speech bubble",
    "watermark",
    "signature",
    "artist name",
    "twitter username",
    "username",
    "commentary",
    "commentary request",
    "translation request",
    "translated",
    "check translation",
    "official art",
    "web address",
    "qr code",
    "barcode",
    "mosaic censoring",
    "bar censor",
    "censored",
    "uncensored",
    "ai-generated",
    "ai-assisted",
    "realistic",
    "photorealistic",
    "3d",
    "sketch",
    "greyscale",
    "monochrome",
    "comic",
    "manga",
    "multiple views",
    "reference sheet",
    "character name",
    "copyright name",
    "dated",
    "patreon username",
    "patreon logo",
    "simple background",
    "white background",
    "grey background",
    "gradient background",
    "abstract background",
    "blurry background",
    "blurry",
    "depth of field",
    "bokeh",
    "chromatic aberration",
    "film grain",
    "solo focus",
    "veins",
    "tiles",
    "monitor",
    "card",
    "id card",
    "playing card",
    "cardboard box",
    "abuse",
    "faceless",
    "faceless male",
    "faceless female",
    "english commentary",
    "heart",
    "spoken heart",
    "masterpiece",
    "best quality",
    "amazing quality",
    "absurdres",
    "highres",
    "very aesthetic",
    "nsfw",
    "explicit",
    "questionable",
    "sensitive",
    "general",
    "score",
}

BANNED_SUB = (
    "loli",
    "shota",
    "child",
    "toddler",
    "underage",
    "kid",
    "teen",
    "young boy",
    "young girl",
    "preteen",
    "kindergarten",
    "elementary",
)

HAIR_COLORS = {
    "blonde", "brown", "black", "white", "silver", "grey", "gray", "red",
    "blue", "green", "purple", "pink", "orange", "aqua", "teal", "violet",
    "light brown", "dark brown", "light blue", "dark blue", "light purple",
    "multicolored", "gradient", "streaked", "two-tone", "rainbow",
}
EYE_COLORS = HAIR_COLORS | {"amber", "hazel", "yellow", "gold", "heterochromia"}
BREAST = {
    "small breasts": ("small breasts", "breast_size"),
    "medium breasts": ("medium breasts", "breast_size"),
    "large breasts": ("large breasts", "breast_size"),
    "huge breasts": ("huge breasts", "breast_size"),
    "gigantic breasts": ("gigantic breasts", "breast_size"),
    "flat chest": ("small breasts", "breast_size"),
    "sagging breasts": ("sagging breasts", "breast_size"),
}
HAIR_LEN = {
    "short hair", "medium hair", "long hair", "very long hair",
    "absurdly long hair", "bob cut", "pixie cut",
}

SEX_POS = {
    "girl on top", "boy on top", "cowgirl", "reverse cowgirl", "doggystyle",
    "missionary", "mating press", "prone bone", "spooning", "full nelson",
    "amazon position", "standing sex", "sex from behind", "suspended congress",
    "spitroast", "double penetration", "lotus position", "folded",
    "legs up", "mating press", "piledriver", "reverse piledriver",
    "reverse standing", "sideways", "x-ray",
    "upright straddle", "reverse upright straddle",
    "reverse suspended congress", "piledriver (sex)", "boy on top",
    "thigh sex", "frottage", "reverse spitroast",
}
SEX_ACT = {
    "sex", "vaginal", "anal", "oral", "fellatio", "cunnilingus", "paizuri",
    "handjob", "footjob", "thighjob", "anilingus", "irrumatio", "deepthroat",
    "facesitting", "tribadism", "frottage", "grinding", "clothed sex",
    "public sex", "happy sex", "group sex", "threesome", "mmf threesome",
    "ffm threesome", "orgy",
}
PAIRISH = {
    "kiss", "kissing", "french kiss", "hug", "hug from behind", "holding hands",
    "eye contact", "face to face", "forehead-to-forehead", "sitting on lap",
    "princess carry", "carry", "embrace", "girl on top", "sex", "hetero",
}

CLOTH_ONE = (
    "dress", "kimono", "yukata", "hanfu", "qipao", "cheongsam", "bikini",
    "swimsuit", "uniform", "bodysuit", "leotard", "jumpsuit", "romper",
    "overalls", "gown", "sundress", "nightgown", "bathrobe", "serafuku",
    "china dress", "qipao", "toga", "armor", "maid", "nun",
)
CLOTH_TOP = (
    "shirt", "blouse", "sweater", "hoodie", "tank top", "crop top", "camisole",
    "jacket", "coat", "vest", "cardigan", "t-shirt", "tube top", "bandeau",
    "off-shoulder", "off shoulder",
)
CLOTH_BOT = (
    "skirt", "pants", "shorts", "jeans", "trousers", "hotpants", "leggings",
    "hakama", "bloomers",
)
CLOTH_UW = ("panties", "bra", "thong", "boxers", "briefs", "lingerie", "underwear")
CLOTH_LEG = ("thighhighs", "pantyhose", "stockings", "kneehighs", "fishnets", "socks")
CLOTH_FEET = ("shoes", "boots", "heels", "sandals", "sneakers", "loafers", "geta", "zouri")
CLOTH_ACC = (
    "glasses", "earrings", "necklace", "bracelet", "ring", "choker", "collar",
    "hat", "hairband", "hair ribbon", "hair bow", "gloves", "necktie", "bowtie",
    "bag", "handbag", "umbrella", "parasol", "watch", "belt",
)

ENV_PLACE = (
    "bedroom", "bathroom", "kitchen", "classroom", "office", "beach", "pool",
    "ocean", "forest", "park", "street", "alley", "rooftop", "balcony",
    "onsen", "hot spring", "train", "bus", "car", "hotel", "library", "cafe",
    "restaurant", "shrine", "temple", "castle", "bridge", "rooftop",
)
ENV_TIME = ("day", "night", "evening", "sunset", "sunrise", "dusk", "morning")
ENV_WEATHER = ("rain", "snow", "fog", "overcast", "storm", "wind")

MODERN_HINT = (
    "phone", "smartphone", "car", "train", "bus", "jeans", "t-shirt", "hoodie",
    "sneakers", "bikini", "office", "classroom", "elevator", "computer",
    "laptop", "camera", "selfie", "neon", "skyscraper",
)

ZH = {
    "hetero": "異性",
    "girl on top": "女上",
    "straddling": "跨坐",
    "on bed": "在床上",
    "on back": "仰躺",
    "lying": "躺著",
    "sheet grab": "抓床單",
    "bed sheet": "床單",
    "pillow": "枕頭",
    "candle": "蠟燭",
    "ring": "戒指",
    "wedding ring": "婚戒",
    "netorare": "NTR",
    "cheating (relationship)": "出軌",
    "male pubic hair": "男性陰毛",
    "pubic hair": "陰毛",
    "breasts": "胸部",
    "thighs": "大腿",
    "thick thighs": "粗大腿",
    "navel": "肚臍",
    "collarbone": "鎖骨",
    "shoulders": "肩",
    "armpits": "腋下",
    "bare shoulders": "露肩",
    "cleavage": "乳溝",
    "sidelocks": "側髮",
    "bangs": "瀏海",
    "parted bangs": "分瀏海",
    "sweatdrop": "汗滴",
    "steam": "蒸氣",
    "wet": "濕",
    "shiny skin": "油光皮膚",
    "looking at viewer": "看向觀眾",
    "looking to the side": "看向一側",
    "from above": "俯視",
    "from below": "仰視",
    "from behind": "從後方",
    "from side": "側面",
    "cowboy shot": "膝上構圖",
    "upper body": "上半身",
    "lower body": "下半身",
    "full body": "全身",
    "close-up": "特寫",
    "portrait": "胸像",
    "sitting": "坐",
    "standing": "站",
    "kneeling": "跪",
    "all fours": "趴跪",
    "on side": "側躺",
    "on stomach": "趴著",
    "leaning forward": "前傾",
    "arms up": "舉手",
    "arms behind back": "手背後",
    "hand on own chest": "手按胸",
    "covering breasts": "遮胸",
    "clothes lift": "掀衣",
    "skirt lift": "掀裙",
    "shirt lift": "掀上衣",
    "undressing": "脫衣中",
    "open clothes": "衣服敞開",
    "topless": "上空",
    "bottomless": "下空",
    "after sex": "事後",
    "after vaginal": "插入事後",
    "cum": "精液",
    "cumdrip": "精液滴落",
    "ahegao": "阿嘿顏",
    "tongue": "舌頭",
    "tongue out": "吐舌",
    "saliva": "唾液",
    "heavy breathing": "喘氣",
    "naughty face": "下流臉",
    "smile": "微笑",
    "open mouth": "張嘴",
    "closed eyes": "閉眼",
    "half-closed eyes": "半閉眼",
    "blush": "臉紅",
    "sweat": "汗",
}


def norm_tag(name: str) -> str:
    return str(name or "").strip().lower().replace("_", " ")


def banned(tag: str) -> bool:
    if tag in BANNED or tag in SKIP_TAGS:
        return True
    return any(s in tag for s in BANNED_SUB)


def load_lexicon_tags() -> set[str]:
    data = json.loads(LEX.read_text(encoding="utf-8"))
    out = {norm_tag(t["tag"]) for t in data.get("tags") or []}
    for key in ("quality", "nsfwTail", "alwaysEnv"):
        for t in data.get(key) or []:
            out.add(norm_tag(t))
    return out


def iter_pack_files() -> list[Path]:
    return [p for p in PACKS.rglob("*.json") if p.is_file()]


def read_pack_tags(path: Path) -> list[tuple[str, float, str]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    rows = data.get("tags") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return []
    out = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        name = norm_tag(item.get("name") or item.get("tag") or "")
        if not name:
            continue
        conf = float(item.get("conf") or item.get("confidence") or 0)
        cat = str(item.get("category") or "general").lower()
        out.append((name, conf, cat))
    return out


def load_cache() -> dict:
    if CACHE.exists():
        try:
            return json.loads(CACHE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_cache(cache: dict) -> None:
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def danbooru_lookup(tag: str) -> dict | None:
    api_name = tag.replace(" ", "_")
    q = urllib.parse.urlencode({"search[name]": api_name, "limit": 1})
    url = "https://danbooru.donmai.us/tags.json?" + q
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            rows = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            time.sleep(1.5)
            return danbooru_lookup(tag)
        return None
    except Exception:
        return None
    if not rows:
        return {"found": False}
    row = rows[0]
    return {
        "found": True,
        "name": str(row.get("name") or "").replace("_", " "),
        "category": int(row.get("category") or 0),
        "post_count": int(row.get("post_count") or 0),
        "is_deprecated": bool(row.get("is_deprecated")),
    }


_TOKEN_RE = re.compile(r"[a-z0-9']+")


def toks(tag: str) -> set[str]:
    return set(_TOKEN_RE.findall(tag))


def has_tok(tag: str, word: str) -> bool:
    w = word.lower()
    if " " in w:
        return w in tag
    words = toks(tag)
    return w in words or (w + "s") in words


def has_any_tok(tag: str, words) -> bool:
    return any(has_tok(tag, w) for w in words)


def heat_for(tag: str) -> list[str]:
    if has_any_tok(tag, SEX_ACT | SEX_POS | {"nipple", "pussy", "penis", "cum", "ejaculation", "orgasm", "ahegao"}):
        if has_any_tok(tag, ("sex", "vaginal", "anal", "fellatio", "paizuri", "cowgirl", "doggystyle", "missionary")):
            return ["sex"]
        return ["flash", "sex"]
    if has_any_tok(tag, ("upskirt", "flashing", "undressing", "topless", "bottomless", "nude")) or "clothes lift" in tag or "one breast" in tag:
        return ["flash", "sex"]
    if has_any_tok(tag, ("bikini", "lingerie", "panties", "bra", "cleavage", "wet", "sweat")):
        return list(HEATS)
    return list(HEATS)


def era_for(tag: str) -> list[str]:
    if has_any_tok(tag, ("kimono", "yukata", "obi", "geta", "kanzashi", "haori", "fundoshi")):
        return ["edo"]
    if has_any_tok(tag, ("hanfu", "ruqun")) or "chinese clothes" in tag:
        return ["ancient_china"]
    if has_any_tok(tag, ("toga", "chiton", "peplos")) or "laurel" in tag:
        return ["ancient_greece"]
    if has_any_tok(tag, ("armor", "chainmail", "cloak", "castle")):
        return ["medieval", "edo"] if has_any_tok(tag, ("japan", "japanese", "samurai")) else ["medieval"]
    if has_any_tok(tag, ("victorian", "corset", "waistcoat")) or "top hat" in tag:
        return ["victorian"]
    if has_any_tok(tag, MODERN_HINT) or has_any_tok(tag, ("bikini", "swimsuit", "jeans", "hoodie", "sneakers")):
        return ["modern"]
    if tag.endswith("shirt") or tag.endswith("skirt") or tag.endswith("dress") or "t-shirt" in tag:
        return ["modern"]
    return ["any"]


def classify(tag: str) -> dict | None:
    if banned(tag):
        return None
    if tag in {"1girl", "2girls", "3girls", "4girls", "multiple girls", "1boy", "2boys", "3boys", "multiple boys", "solo", "adult"}:
        return None
    heat = heat_for(tag)
    era = era_for(tag)
    gate = "any"
    mutex = None
    layer = "normal"
    section = None
    bind: list[str] = []
    implies: list[str] = []
    needs: list[str] = []

    if tag == "hetero":
        section = "subject"
        needs = ["pair"]
    elif tag == "yuri":
        section = "subject"
        gate = "female"
        needs = ["pair", "female"]
    elif tag == "yaoi":
        section = "subject"
        gate = "male"
        needs = ["pair", "male"]
    elif tag in HAIR_LEN:
        section = "feature"
        mutex = "hair_length"
    elif tag.endswith(" hair") and any(tag.startswith(c + " ") or tag == c + " hair" for c in HAIR_COLORS):
        section = "feature"
        mutex = "hair_color"
    elif has_tok(tag, "hair") or tag.endswith(" bangs") or "bangs" in tag:
        section = "feature"
    elif tag.endswith(" eyes") or tag in {"heterochromia", "eyelashes", "eyeshadow", "closed eyes"}:
        section = "feature"
        mutex = "eye_color" if tag.endswith(" eyes") and tag != "closed eyes" else None
    elif tag in BREAST:
        section = "feature"
        gate = "female"
        mutex = "breast_size"
        needs = ["female"]
    elif tag in {"sex toy", "vibrator", "egg vibrator"}:
        section = "clothing"
        layer = "accessory"
        heat = ["sex"]
    elif tag in {"office lady"}:
        section = "feature"
        gate = "female"
        needs = ["female"]
        era = ["modern"]
    elif has_any_tok(tag, ("breast", "nipple", "areola", "pussy", "clitoris", "vulva", "navel", "cleavage", "thigh", "thighs", "hip", "hips", "waist", "milf", "ass")) and not has_any_tok(tag, ("skirt", "shirt", "dress", "pants", "jacket")) or tag in {"mature female"}:
        section = "feature"
        gate = "female"
        needs = ["female"]
        if has_any_tok(tag, ("nipple", "areola", "pussy", "clitoris")):
            heat = ["flash", "sex"]
            layer = "skin"
    elif has_any_tok(tag, ("penis", "testicles", "erection", "bara", "abs", "pectorals", "beard", "stubble")) or tag in {"facial hair", "adam's apple", "male pubic hair"}:
        section = "feature"
        gate = "male"
        needs = ["male"]
        if has_any_tok(tag, ("penis", "testicles", "erection")):
            heat = ["flash", "sex"]
            layer = "skin"
    elif tag in {"female pubic hair", "pubic hair"}:
        section = "feature"
        heat = ["flash", "sex"]
        layer = "skin"
    elif tag in {"blush", "sweat", "wet", "shiny skin", "tan", "dark skin", "pale skin", "mole", "freckles", "tattoo", "scar", "pregnant", "collarbone", "tongue", "teeth", "saliva", "tears", "navel piercing", "pink nails"}:
        section = "feature"
        if tag == "pregnant":
            gate = "female"
            needs = ["female"]
    elif has_any_tok(tag, SEX_ACT) or has_any_tok(tag, ("cowgirl", "doggystyle", "missionary", "paizuri", "fellatio", "vaginal", "threesome", "oral")):
        section = "pose"
        mutex = "sex_act"
        heat = ["sex"]
        needs = ["pair"]
        if has_any_tok(tag, ("fellatio", "paizuri", "handjob", "vaginal", "anal", "cowgirl", "doggystyle", "missionary")):
            needs += ["male", "female"]
            gate = "female"
    elif tag in {"girl on top", "straddling", "sitting on lap"}:
        section = "pose"
        needs = ["pair"]
        if tag == "girl on top":
            mutex = "sex_act"
            heat = ["sex"]
            needs = ["pair", "female"]
            gate = "female"
    elif has_any_tok(tag, ("kiss", "hug")) or tag in {"holding hands", "eye contact", "face to face"}:
        section = "pose"
        needs = ["pair"]
    elif tag.startswith("looking ") or tag in {"eye contact"}:
        section = "pose"
        mutex = "gaze"
    elif tag in {"from above", "from below", "from behind", "from side", "cowboy shot", "upper body", "lower body", "full body", "close-up", "portrait", "profile", "pov crotch"}:
        section = "pose"
        mutex = "camera"
    elif tag in {"sitting", "standing", "lying", "kneeling", "on back", "on side", "on stomach", "all fours", "squatting", "walking", "running", "on bed", "straddling"} or tag.startswith("leaning"):
        section = "pose"
        mutex = "body_pose"
    elif tag in {"smile", "open mouth", "closed mouth", "ahegao", "tongue out", "naughty face", "heavy breathing"}:
        section = "pose"
    elif has_any_tok(tag, ("upskirt", "flashing", "undressing")) or "lift" in tag or tag in {"clothed male nude female", "clothed female nude male", "breasts out"}:
        section = "pose"
        heat = ["flash", "sex"]
        gate = "female"
        needs = ["female"]
    elif tag in {"nude", "completely nude"}:
        section = "clothing"
        mutex = "nudity"
        layer = "skin"
        heat = ["sex"]
    elif tag.endswith(" dress") or tag.endswith(" swimsuit") or tag.endswith(" uniform") or has_any_tok(tag, CLOTH_ONE):
        section = "clothing"
        mutex = "onepiece"
        layer = "garment"
        if has_any_tok(tag, ("bikini", "swimsuit", "dress", "maid", "qipao", "sundress")):
            gate = "female"
        era = ["modern"] if has_any_tok(tag, ("bikini", "swimsuit", "dress", "uniform")) else era
    elif tag.endswith(" shirt") or tag.endswith(" jacket") or tag.endswith(" coat") or tag.endswith(" sweater") or has_any_tok(tag, CLOTH_TOP) or "sleeves" in tag:
        section = "clothing"
        mutex = "outer" if has_any_tok(tag, ("jacket", "coat", "cardigan")) else "top"
        layer = "garment"
        if "sleeves" in tag:
            mutex = None
            layer = "garment"
        era = ["modern"] if mutex in {"top", "outer"} else era
    elif tag.endswith(" skirt") or tag.endswith(" pants") or tag.endswith(" shorts") or has_any_tok(tag, CLOTH_BOT):
        section = "clothing"
        mutex = "bottom"
        layer = "garment"
        if "skirt" in tag:
            gate = "female"
        era = ["modern"]
    elif has_any_tok(tag, CLOTH_UW) or tag == "underwear":
        section = "clothing"
        mutex = "underwear_bottom" if has_any_tok(tag, ("panties", "thong", "boxers", "briefs")) else "underwear_top"
        layer = "garment"
        if has_any_tok(tag, ("panties", "bra", "thong", "lingerie")):
            gate = "female"
        heat = list(HEATS)
        era = ["modern"]
    elif has_any_tok(tag, CLOTH_LEG):
        section = "clothing"
        mutex = "legs"
        layer = "garment"
        gate = "female"
    elif has_any_tok(tag, CLOTH_FEET) or tag.endswith(" shoes") or tag.endswith(" boots"):
        section = "clothing"
        mutex = "feet"
        layer = "garment"
    elif tag in {"sex toy", "vibrator", "egg vibrator"}:
        section = "clothing"
        layer = "accessory"
        heat = ["sex"]
    elif has_any_tok(tag, CLOTH_ACC) or tag in {"jewelry", "wedding ring", "ring", "belt", "bag", "bare shoulders"}:
        section = "clothing"
        layer = "accessory"
        if tag in {"ring", "wedding ring", "necklace", "earrings", "bracelet", "jewelry"} or "earrings" in tag:
            mutex = "jewelry"
        elif tag in {"necktie", "bowtie", "choker", "collar"} or tag.endswith(" collar"):
            mutex = "neckwear"
        elif tag == "glasses":
            mutex = "eyewear"
        elif "hat" in tag:
            mutex = "headwear"
    elif tag in {"indoors", "outdoors"}:
        section = "env"
        mutex = "in_out"
    elif tag in ENV_TIME or tag.endswith(" sky"):
        section = "env"
        mutex = "day_night" if tag in ENV_TIME else None
        if tag in {"sunset", "sunrise"}:
            implies = ["outdoors"]
    elif has_any_tok(tag, ENV_WEATHER):
        section = "env"
        mutex = "weather"
    elif has_tok(tag, "light") or tag in {"lamp", "candle", "moonlight", "sunlight", "spotlight", "backlighting", "city lights"}:
        section = "env"
        mutex = "lighting"
    elif tag in {"on bed", "on chair", "on floor", "on sofa"}:
        section = "pose"
        mutex = "body_pose"
    elif has_tok(tag, "chair"):
        section = "env"
    elif has_any_tok(tag, ENV_PLACE) or tag in {"pillow", "bed sheet", "curtains", "window", "carpet", "tree", "water", "sky", "blue sky", "orange sky", "bush", "bamboo forest", "park bench", "restaurant"}:
        section = "env"
        mutex = "place" if has_any_tok(tag, ENV_PLACE) or tag in {"bamboo forest", "park bench", "restaurant"} else None
        if tag in {"pillow", "bed sheet", "curtains", "sky", "blue sky", "orange sky", "water", "tree", "bush"}:
            mutex = None
    else:
        return None

    if gate == "female" and "female" not in needs:
        needs.append("female")
    if gate == "male" and "male" not in needs:
        needs.append("male")

    item = {
        "tag": tag,
        "section": section,
        "gate": gate,
        "heat": heat,
        "mutex": mutex,
        "bind": bind,
        "implies": implies,
        "layer": layer,
        "era": era,
        "zh": ZH.get(tag),
        "needs": needs,
    }
    if not item["zh"]:
        item.pop("zh")
    if not item["needs"]:
        item.pop("needs")
    item["group"] = assign_group(item)
    return item


def main() -> None:
    if not PACKS.is_dir():
        raise SystemExit(
            f"missing packs dir: {PACKS}\n"
            "This script mines an external corpus of prompt packs that ships separately. "
            "Point PACKS_DIR at a folder of .json prompt packs, or skip it — "
            "web/lexicon.json is already built."
        )
    have = load_lexicon_tags()
    files = iter_pack_files()
    print(f"packs on disk: {len(files)}")
    if not files:
        # Writing an empty harvest would blank a real lexicon part. Stop instead.
        raise SystemExit(f"no .json packs under {PACKS} — refusing to overwrite {OUT_PART.name}")
    rng = random.Random(SEED)
    n = min(SAMPLE, len(files))
    sample = rng.sample(files, n)
    print(f"sampled {n} packs  seed={SEED}")

    freq: Counter[str] = Counter()
    conf_sum: dict[str, float] = defaultdict(float)
    cat_seen: dict[str, Counter] = defaultdict(Counter)
    used_packs = 0
    for i, path in enumerate(sample, 1):
        rows = read_pack_tags(path)
        if not rows:
            continue
        used_packs += 1
        seen_here = set()
        for name, conf, cat in rows:
            if conf < MIN_CONF:
                continue
            if name in seen_here:
                continue
            seen_here.add(name)
            freq[name] += 1
            conf_sum[name] += conf
            cat_seen[name][cat] += 1
        if i % 500 == 0:
            print(f"  read {i}/{n}")

    missing = []
    for tag, c in freq.most_common():
        if tag in have or banned(tag) or c < MIN_PACKS:
            continue
        missing.append(tag)
    print(f"unique tags in sample: {len(freq)}")
    print(f"missing from lexicon (>= {MIN_PACKS} packs, conf>={MIN_CONF}): {len(missing)}")

    cache = load_cache()
    todo = [t for t in missing if t not in cache]
    print(f"danbooru lookup {len(todo)} (cached {len(missing) - len(todo)})")

    def fetch(tag: str):
        info = danbooru_lookup(tag)
        return tag, info

    done = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futs = [pool.submit(fetch, t) for t in todo]
        for fut in as_completed(futs):
            tag, info = fut.result()
            cache[tag] = info or {"found": False}
            done += 1
            if done % 25 == 0:
                print(f"  danbooru {done}/{len(todo)}")
                save_cache(cache)
    save_cache(cache)

    accepted = []
    skipped = []
    for tag in missing:
        info = cache.get(tag) or {}
        if not info.get("found"):
            skipped.append({"tag": tag, "reason": "not_on_danbooru", "packs": freq[tag]})
            continue
        if info.get("is_deprecated"):
            skipped.append({"tag": tag, "reason": "deprecated", "packs": freq[tag]})
            continue
        if int(info.get("category") or 0) in SKIP_CAT:
            skipped.append({"tag": tag, "reason": f"category_{info.get('category')}", "packs": freq[tag]})
            continue
        if int(info.get("post_count") or 0) < MIN_POSTS:
            skipped.append({"tag": tag, "reason": "low_post_count", "posts": info.get("post_count"), "packs": freq[tag]})
            continue
        item = classify(tag)
        if not item:
            skipped.append({"tag": tag, "reason": "classified_skip", "packs": freq[tag]})
            continue
        item["harvest"] = {
            "packs": freq[tag],
            "avg_conf": round(conf_sum[tag] / max(freq[tag], 1), 4),
            "post_count": info.get("post_count"),
        }
        accepted.append(item)

    clean = [{k: v for k, v in item.items() if k != "harvest"} for item in accepted]
    if not clean and OUT_PART.is_file():
        # A run that harvests nothing must not blank the last good harvest.
        raise SystemExit(
            f"harvested 0 tags from {PACKS} — keeping the existing {OUT_PART.name}. "
            "Check that PACKS_DIR holds readable prompt packs."
        )
    OUT_PART.write_text(json.dumps(clean, ensure_ascii=False, indent=2), encoding="utf-8")
    REPORT.write_text(
        json.dumps(
            {
                "sampled_packs": n,
                "readable_packs": used_packs,
                "unique_tags": len(freq),
                "missing_candidates": len(missing),
                "accepted": len(accepted),
                "skipped": skipped[:400],
                "skipped_n": len(skipped),
                "top_accepted": [
                    {"tag": i["tag"], "section": i["section"], "packs": i["harvest"]["packs"], "posts": i["harvest"]["post_count"]}
                    for i in sorted(accepted, key=lambda x: -x["harvest"]["packs"])[:40]
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    by_sec: Counter[str] = Counter(i["section"] for i in accepted)
    print(f"accepted {len(accepted)}  skipped {len(skipped)}  by section {dict(by_sec)}")
    print(f"wrote {OUT_PART}")
    print(f"wrote {REPORT}")
    print("top:")
    for row in sorted(accepted, key=lambda x: -x["harvest"]["packs"])[:25]:
        print(f"  {row['harvest']['packs']:4d}  {row['section']:8s}  {row['tag']}")


if __name__ == "__main__":
    main()
