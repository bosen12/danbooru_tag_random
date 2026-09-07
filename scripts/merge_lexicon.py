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
SECTIONS = {"subject", "feature", "pose", "clothing", "env"}
GATES = {"any", "female", "male"}

NEGATIVE = (
    "bad quality, worst quality, worst detail, lowres, sketch, censor, censored, "
    "bar censor, mosaic censoring, text, watermark, signature, username, logo, "
    "speech bubble, bad anatomy, bad hands, extra fingers, fused fingers, missing "
    "fingers, extra limbs, deformed, disfigured, ugly, blurry, jpeg artifacts, "
    "3d, realistic, photorealistic, loli, shota, teen, child"
)

BANNED = {
    "loli",
    "shota",
    "child",
    "teen",
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
    "skirt": _MV,
    "miniskirt": _M,
    "pencil skirt": _MV,
    "pleated skirt": _M,
    "microskirt": _M,
    "shorts": _M,
    "short shorts": _M,
    "pants": _M,
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
    "bathrobe": _M,
    "elbow gloves": _MV,
    "qipao": _M,
    "tangzhuang": _M,
    "china dress": _M,
    "shower (place)": _M,
    "couch": _M,
    "bar (place)": _MV,
    "sauna": ["modern", "edo"],
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
}

# Variant → parent so they coexist (mutex siblings skip parent/child).
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
    "microskirt": ["miniskirt", "skirt"],
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
    "sports bra": ["bra"],
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
    "fat man": ["fat"],
    "obese": ["fat"],
    "nerd": ["otaku"],
    "coke-bottle glasses": ["glasses"],
}

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
    "mmf threesome": {"needs": ["pair", "female", "male"]},
    "ffm threesome": {"needs": ["pair", "female", "male"]},
    "plump": {"mutex": "male_build"},
    "skinny": {"mutex": "male_build"},
    "muscular": {"mutex": "male_build"},
    "muscular male": {"mutex": "male_build", "gate": "male"},
    "toned male": {"mutex": "male_build"},
    "bara": {"mutex": "male_build"},
    "bald": {"mutex": "hair_length"},
    "male pubic hair": {"gate": "male", "heat": ["flash", "sex"]},
    "side-tie bikini bottom": {"mutex": "bottom", "section": "clothing", "layer": "garment"},
    "shoulder armor": {"mutex": None, "layer": "accessory", "section": "clothing"},
    "underwear": {"mutex": None},
    "holding sex toy": {"mutex": None},
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
    "sagging breasts",
    "nipples",
    "areolae",
    "milf",
    "mature female",
}

NEEDS_PAIR = {
    "sex",
    "kiss",
    "kissing",
    "french kiss",
    "looking at another",
    "hug from behind",
    "sitting on lap",
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
    if "one-piece swimsuit" in tag and tag != "one-piece swimsuit":
        if "one-piece swimsuit" not in im:
            im.append("one-piece swimsuit")
        if "swimsuit" not in im:
            im.append("swimsuit")
    if tag.endswith(" sports bra") or tag == "sports bra":
        if "bra" not in im:
            im.append("bra")
    if section == "env" and mutex == "day_night":
        im = [x for x in im if x not in ("indoors", "outdoors")]
    elif section == "env" and mutex not in ("place", "in_out"):
        im = [x for x in im if x not in ("indoors", "outdoors", "day", "night")]
    if tag in EXPRESSION:
        mutex = "expression"
    return im, bind, mutex, section, gate, layer, heat, era, needs


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
    needs = [str(x) for x in (item.get("needs") or []) if x in {"female", "male", "pair"}]
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
    needs = [x for x in needs if x in {"female", "male", "pair"}]
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
        C("courtyard", "env", ac, mutex="place", layer="normal", implies=["outdoors"]),
        C("pavilion", "env", ac + edo, mutex="place", layer="normal", implies=["outdoors"]),
        C("lotus pond", "env", ac, mutex="place", layer="normal", implies=["outdoors"]),
        C("colonnade", "env", ag, mutex="place", layer="normal", implies=["outdoors"]),
        C("great hall", "env", md + vic, mutex="place", layer="normal", implies=["indoors"]),
    ]


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
    rows.extend(extra_breast_feel_tags())

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
            "absurdres",
            "highres",
            "very aesthetic",
        ],
        "nsfwTail": ["nsfw", "explicit"],
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
            "tease": {"tease": 0.7, "flash": 0.3, "sex": 0.0},
            "sex": {"tease": 0.1, "flash": 0.2, "sex": 0.7},
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
        "zh": {t: old_zh[t] for t in (
            "masterpiece", "best quality", "amazing quality",
            "absurdres", "highres", "very aesthetic",
            "nsfw", "explicit", "soft lighting",
        ) if t in old_zh},
        "tags": unique,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {OUT} tags={len(unique)} dropped={dropped} {by_sec}")


if __name__ == "__main__":
    main()
