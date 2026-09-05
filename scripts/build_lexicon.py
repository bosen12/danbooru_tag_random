#!/usr/bin/env python3
"""Build web/lexicon.json from structured lists."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "lexicon.json"


def T(
    tag: str,
    section: str,
    *,
    gate: str = "any",
    heat: list[str] | None = None,
    mutex: str | None = None,
    bind: list[str] | None = None,
    implies: list[str] | None = None,
    layer: str = "normal",
) -> dict:
    return {
        "tag": tag,
        "section": section,
        "gate": gate,
        "heat": heat or ["tease", "flash", "sex"],
        "mutex": mutex,
        "bind": bind or [],
        "implies": implies or [],
        "layer": layer,
    }


tags: list[dict] = []

# --- 2 subject ---
for tag, mutex in (
    ("1girl", "female_count"),
    ("2girls", "female_count"),
    ("3girls", "female_count"),
    ("4girls", "female_count"),
    ("1boy", "male_count"),
    ("2boys", "male_count"),
    ("3boys", "male_count"),
):
    gate = "female" if "girl" in tag else "male"
    tags.append(T(tag, "subject", gate=gate, mutex=mutex, heat=["tease", "flash", "sex"]))

tags += [
    T("solo", "subject", mutex="solo_lock"),
    T("adult", "subject"),
    T("multiple girls", "subject", gate="female", implies=["2girls"]),
    T("multiple boys", "subject", gate="male", implies=["2boys"]),
]

# --- 3 features ---
for tag, mutex in (
    ("long hair", "hair_length"),
    ("short hair", "hair_length"),
    ("medium hair", "hair_length"),
    ("very long hair", "hair_length"),
    ("bob cut", "hair_length"),
):
    tags.append(T(tag, "feature", mutex=mutex))

for tag in (
    "ponytail",
    "twintails",
    "braid",
    "single braid",
    "side ponytail",
    "messy hair",
    "hair over one eye",
    "sidelocks",
    "bangs",
    "ahoge",
    "hair between eyes",
    "wavy hair",
    "straight hair",
    "curly hair",
):
    tags.append(T(tag, "feature"))

for tag, mutex in (
    ("black hair", "hair_color"),
    ("brown hair", "hair_color"),
    ("blonde hair", "hair_color"),
    ("red hair", "hair_color"),
    ("white hair", "hair_color"),
    ("silver hair", "hair_color"),
    ("blue hair", "hair_color"),
    ("pink hair", "hair_color"),
    ("purple hair", "hair_color"),
    ("green hair", "hair_color"),
    ("auburn hair", "hair_color"),
):
    tags.append(T(tag, "feature", mutex=mutex))

for tag, mutex in (
    ("brown eyes", "eye_color"),
    ("blue eyes", "eye_color"),
    ("green eyes", "eye_color"),
    ("red eyes", "eye_color"),
    ("amber eyes", "eye_color"),
    ("grey eyes", "eye_color"),
    ("violet eyes", "eye_color"),
    ("heterochromia", "eye_color"),
):
    tags.append(T(tag, "feature", mutex=mutex))

tags += [
    T("detailed eyes", "feature"),
    T("eyelashes", "feature"),
    T("heavy eyelids", "feature"),
    T("mole", "feature"),
    T("mole under eye", "feature"),
    T("beauty mark", "feature"),
    T("freckles", "feature"),
    T("blush", "feature"),
    T("sweat", "feature"),
    T("shiny skin", "feature"),
    T("wet", "feature", heat=["flash", "sex"]),
    T("tan", "feature"),
    T("dark skin", "feature"),
    T("collarbone", "feature"),
    T("navel", "feature"),
    T("armpits", "feature"),
    T("midriff", "feature"),
]

for tag, mutex in (
    ("huge breasts", "breast_size"),
    ("large breasts", "breast_size"),
    ("medium breasts", "breast_size"),
    ("small breasts", "breast_size"),
):
    tags.append(T(tag, "feature", gate="female", mutex=mutex))

tags += [
    T("soft breasts", "feature", gate="female"),
    T("natural breasts", "feature", gate="female"),
    T("wide hips", "feature", gate="female"),
    T("thick thighs", "feature", gate="female"),
    T("narrow waist", "feature", gate="female"),
    T("curvy", "feature", gate="female"),
    T("voluptuous", "feature", gate="female"),
    T("milf", "feature", gate="female", bind=["mature female"]),
    T("mature female", "feature", gate="female", bind=["milf"]),
    T("nipples", "feature", gate="female", heat=["flash", "sex"], layer="skin"),
    T("puffy nipples", "feature", gate="female", heat=["flash", "sex"], layer="skin"),
    T("areolae", "feature", gate="female", heat=["flash", "sex"], layer="skin"),
    T("pubic hair", "feature", gate="female", heat=["sex"], layer="skin"),
    T("muscular", "feature", gate="male"),
    T("abs", "feature", gate="male"),
    T("pectorals", "feature", gate="male"),
    T("broad shoulders", "feature", gate="male"),
    T("facial hair", "feature", gate="male"),
    T("stubble", "feature", gate="male"),
    T("bara", "feature", gate="male"),
    T("chest hair", "feature", gate="male"),
    T("adam's apple", "feature", gate="male"),
    T("erection", "feature", gate="male", heat=["sex"], layer="skin"),
    T("large penis", "feature", gate="male", heat=["sex"], layer="skin"),
    T("testicles", "feature", gate="male", heat=["sex"], layer="skin"),
    T("veiny penis", "feature", gate="male", heat=["sex"], layer="skin"),
]

# --- 4 pose ---
for tag, mutex in (
    ("standing", "body_pose"),
    ("sitting", "body_pose"),
    ("kneeling", "body_pose"),
    ("lying", "body_pose"),
    ("on back", "body_pose"),
    ("on side", "body_pose"),
    ("on stomach", "body_pose"),
    ("squatting", "body_pose"),
    ("leaning forward", "body_pose"),
    ("bent over", "body_pose"),
    ("all fours", "body_pose"),
    ("wariza", "body_pose"),
    ("seiza", "body_pose"),
    ("m-legs", "body_pose"),
    ("spread legs", "body_pose"),
    ("crossed legs", "body_pose"),
    ("one knee up", "body_pose"),
    ("against wall", "body_pose"),
    ("against glass", "body_pose"),
):
    heat = ["tease", "flash", "sex"]
    if tag in ("all fours", "m-legs", "bent over", "on back", "spread legs"):
        heat = ["flash", "sex"]
    tags.append(T(tag, "pose", mutex=mutex, heat=heat))

for tag, mutex in (
    ("looking at viewer", "gaze"),
    ("looking away", "gaze"),
    ("looking back", "gaze"),
    ("looking down", "gaze"),
    ("looking up", "gaze"),
    ("eye contact", "gaze"),
    ("averted eyes", "gaze"),
):
    tags.append(T(tag, "pose", mutex=mutex))

for tag, mutex in (
    ("cowboy shot", "camera"),
    ("full body", "camera"),
    ("upper body", "camera"),
    ("portrait", "camera"),
    ("close-up", "camera"),
    ("from behind", "camera"),
    ("from below", "camera"),
    ("from above", "camera"),
    ("from side", "camera"),
    ("pov", "camera"),
    ("dutch angle", "camera"),
):
    tags.append(T(tag, "pose", mutex=mutex))

for tag, heat in (
    ("smile", ["tease", "flash", "sex"]),
    ("seductive smile", ["tease", "flash"]),
    ("smirk", ["tease", "flash", "sex"]),
    ("grin", ["tease", "flash", "sex"]),
    ("parted lips", ["tease", "flash", "sex"]),
    ("open mouth", ["tease", "flash", "sex"]),
    ("tongue out", ["flash", "sex"]),
    ("biting lip", ["tease", "flash"]),
    ("naughty face", ["tease", "flash", "sex"]),
    ("half-closed eyes", ["tease", "flash", "sex"]),
    ("bedroom eyes", ["tease", "flash"]),
    ("heavy breathing", ["flash", "sex"]),
    ("embarrassed", ["tease", "flash"]),
    ("shy", ["tease", "flash"]),
    ("aroused", ["flash", "sex"]),
    ("ahegao", ["sex"]),
    ("rolling eyes", ["sex"]),
    ("orgasm", ["sex"]),
    ("afterglow", ["sex"]),
):
    tags.append(T(tag, "pose", heat=heat))

for tag in (
    "hand on hip",
    "hands on own hips",
    "arms behind back",
    "arms behind head",
    "hand on own chest",
    "covering mouth",
    "finger to mouth",
    "contrapposto",
    "arched back",
    "head tilt",
    "leaning on elbow",
):
    tags.append(T(tag, "pose", heat=["tease", "flash"]))

for tag, gate, heat in (
    ("skirt lift", "female", ["flash"]),
    ("clothes lift", "any", ["flash"]),
    ("shirt lift", "any", ["flash"]),
    ("upskirt", "female", ["flash"]),
    ("downblouse", "female", ["flash"]),
    ("one breast out", "female", ["flash", "sex"]),
    ("breast hold", "female", ["tease", "flash", "sex"]),
    ("covering breasts", "female", ["flash"]),
    ("covering crotch", "any", ["flash"]),
    ("undressing", "any", ["flash"]),
    ("caught", "any", ["flash"]),
    ("flashing", "any", ["flash"]),
    ("exhibitionism", "any", ["flash", "sex"]),
    ("wedgie", "any", ["flash"]),
    ("pants pull", "any", ["flash"]),
    ("clothes pull", "any", ["flash"]),
    ("strap slip", "female", ["flash"]),
    ("nipple slip", "female", ["flash"]),
    ("paizuri", "female", ["sex"]),
    ("fellatio", "any", ["sex"]),
    ("cunnilingus", "female", ["sex"]),
    ("handjob", "any", ["sex"]),
    ("footjob", "any", ["sex"]),
    ("kissing", "any", ["tease", "sex"]),
    ("french kiss", "any", ["sex"]),
    ("sex", "any", ["sex"]),
    ("vaginal", "female", ["sex"]),
    ("anal", "any", ["sex"]),
    ("cowgirl position", "female", ["sex"]),
    ("reverse cowgirl position", "female", ["sex"]),
    ("doggystyle", "any", ["sex"]),
    ("missionary", "female", ["sex"]),
    ("mating press", "female", ["sex"]),
    ("standing sex", "any", ["sex"]),
    ("against wall", "any", ["flash", "sex"]),
    ("full nelson", "any", ["sex"]),
    ("amazon position", "female", ["sex"]),
    ("spooning", "any", ["sex"]),
    ("prone bone", "any", ["sex"]),
    ("legs over head", "female", ["sex"]),
    ("suspended congress", "any", ["sex"]),
    ("grabbing", "any", ["sex"]),
    ("hair grabbing", "any", ["sex"]),
    ("waist grab", "any", ["sex"]),
    ("breast grab", "female", ["flash", "sex"]),
    ("straddling", "any", ["flash", "sex"]),
    ("facesitting", "any", ["sex"]),
    ("creampie", "female", ["sex"]),
    ("cum", "any", ["sex"]),
    ("cum on body", "any", ["sex"]),
    ("facial", "any", ["sex"]),
    ("ejaculation", "male", ["sex"]),
    ("after sex", "any", ["sex"]),
    ("after vaginal", "female", ["sex"]),
    ("presenting", "any", ["flash", "sex"]),
    ("ass focus", "any", ["flash", "sex"]),
    ("pussy focus", "female", ["flash", "sex"]),
    ("penis", "male", ["flash", "sex"]),
):
    tags.append(T(tag, "pose", gate=gate, heat=heat))

# --- 5 clothing ---
for tag, mutex, heat, gate, layer in (
    ("nude", "nudity", ["sex"], "any", "skin"),
    ("completely nude", "nudity", ["sex"], "any", "skin"),
    ("naked", "nudity", ["sex"], "any", "skin"),
    ("topless", "top", ["flash", "sex"], "any", "garment"),
    ("bottomless", "bottom", ["flash", "sex"], "any", "garment"),
    ("dress", "onepiece", ["tease", "flash"], "female", "garment"),
    ("sundress", "onepiece", ["tease", "flash"], "female", "garment"),
    ("evening gown", "onepiece", ["tease"], "female", "garment"),
    ("china dress", "onepiece", ["tease", "flash"], "female", "garment"),
    ("kimono", "onepiece", ["tease", "flash"], "female", "garment"),
    ("yukata", "onepiece", ["tease", "flash"], "female", "garment"),
    ("sweater dress", "onepiece", ["tease"], "female", "garment"),
    ("shirt", "top", ["tease", "flash"], "any", "garment"),
    ("blouse", "top", ["tease", "flash"], "female", "garment"),
    ("tank top", "top", ["tease", "flash"], "any", "garment"),
    ("crop top", "top", ["tease", "flash"], "female", "garment"),
    ("sweater", "top", ["tease"], "any", "garment"),
    ("hoodie", "top", ["tease"], "any", "garment"),
    ("open shirt", "top", ["flash", "sex"], "any", "garment"),
    ("unbuttoned shirt", "top", ["flash"], "any", "garment"),
    ("off shoulder", "top", ["tease", "flash"], "female", "garment"),
    ("suit", "onepiece", ["tease"], "any", "garment"),
    ("business suit", "onepiece", ["tease"], "any", "garment"),
    ("school uniform", "onepiece", ["tease", "flash"], "any", "garment"),
    ("sailor dress", "onepiece", ["tease", "flash"], "female", "garment"),
    ("skirt", "bottom", ["tease", "flash"], "female", "garment"),
    ("miniskirt", "bottom", ["tease", "flash"], "female", "garment"),
    ("pencil skirt", "bottom", ["tease", "flash"], "female", "garment"),
    ("shorts", "bottom", ["tease", "flash"], "any", "garment"),
    ("hotpants", "bottom", ["tease", "flash"], "female", "garment"),
    ("jeans", "bottom", ["tease"], "any", "garment"),
    ("pants", "bottom", ["tease", "flash"], "any", "garment"),
    ("trousers", "bottom", ["tease"], "male", "garment"),
    ("bikini", "onepiece", ["tease", "flash"], "female", "garment"),
    ("micro bikini", "onepiece", ["flash"], "female", "garment"),
    ("slingshot swimsuit", "onepiece", ["flash"], "female", "garment"),
    ("school swimsuit", "onepiece", ["tease", "flash"], "female", "garment"),
    ("lingerie", "onepiece", ["tease", "flash", "sex"], "female", "garment"),
    ("babydoll", "onepiece", ["tease", "flash"], "female", "garment"),
    ("bra", "underwear_top", ["tease", "flash"], "female", "garment"),
    ("panties", "underwear_bottom", ["tease", "flash"], "female", "garment"),
    ("thong", "underwear_bottom", ["flash"], "female", "garment"),
    ("no bra", "underwear_top", ["flash", "sex"], "female", "garment"),
    ("no panties", "underwear_bottom", ["flash", "sex"], "female", "garment"),
    ("see-through", "fabric", ["flash", "sex"], "any", "garment"),
    ("wet clothes", "fabric", ["flash"], "any", "garment"),
    ("tight clothes", "fabric", ["tease", "flash"], "any", "garment"),
    ("open clothes", "fabric", ["flash", "sex"], "any", "garment"),
    ("clothes between breasts", "fabric", ["flash", "sex"], "female", "garment"),
    ("panties aside", "underwear_bottom", ["sex"], "female", "garment"),
    ("skirt around waist", "bottom", ["flash", "sex"], "female", "garment"),
    ("boxers", "underwear_bottom", ["tease", "flash"], "male", "garment"),
    ("briefs", "underwear_bottom", ["flash"], "male", "garment"),
    ("fundoshi", "underwear_bottom", ["tease", "flash"], "male", "garment"),
    ("necktie", "accessory", ["tease", "flash"], "any", "accessory"),
    ("choker", "accessory", ["tease", "flash", "sex"], "female", "accessory"),
    ("collar", "accessory", ["tease", "flash", "sex"], "any", "accessory"),
    ("earrings", "accessory", ["tease", "flash", "sex"], "any", "accessory"),
    ("necklace", "accessory", ["tease", "flash"], "any", "accessory"),
    ("jewelry", "accessory", ["tease", "flash"], "any", "accessory"),
    ("hair ornament", "accessory", ["tease", "flash"], "female", "accessory"),
    ("glasses", "accessory", ["tease", "flash", "sex"], "any", "accessory"),
    ("stockings", "legs", ["tease", "flash"], "female", "garment"),
    ("thighhighs", "legs", ["tease", "flash"], "female", "garment"),
    ("pantyhose", "legs", ["tease", "flash"], "female", "garment"),
    ("garter belt", "legs", ["tease", "flash"], "female", "garment"),
    ("barefoot", "feet", ["tease", "flash", "sex"], "any", "accessory"),
    ("high heels", "feet", ["tease", "flash"], "female", "garment"),
    ("sandals", "feet", ["tease"], "any", "garment"),
    ("boots", "feet", ["tease"], "any", "garment"),
    ("socks", "feet", ["tease"], "any", "garment"),
    ("naked sweater", "onepiece", ["flash", "sex"], "female", "garment"),
    ("naked shirt", "top", ["flash", "sex"], "any", "garment"),
    ("towel", "onepiece", ["flash"], "any", "garment"),
    ("bathrobe", "onepiece", ["tease", "flash"], "any", "garment"),
    ("apron", "onepiece", ["tease", "flash"], "female", "garment"),
    ("only panties", "bottom", ["flash", "sex"], "female", "garment"),
):
    tags.append(T(tag, "clothing", gate=gate, heat=heat, mutex=mutex, layer=layer))

# --- 6 env ---
place = [
    ("bedroom", "indoors", "place"),
    ("bed", "indoors", "place"),
    ("hotel", "indoors", "place"),
    ("love hotel", "indoors", "place"),
    ("onsen", "indoors", "place"),
    ("bath", "indoors", "place"),
    ("bathroom", "indoors", "place"),
    ("shower", "indoors", "place"),
    ("kitchen", "indoors", "place"),
    ("living room", "indoors", "place"),
    ("office", "indoors", "place"),
    ("classroom", "indoors", "place"),
    ("library", "indoors", "place"),
    ("changing room", "indoors", "place"),
    ("locker room", "indoors", "place"),
    ("train", "indoors", "place"),
    ("bus", "indoors", "place"),
    ("car interior", "indoors", "place"),
    ("elevator", "indoors", "place"),
    ("hallway", "indoors", "place"),
    ("window", "indoors", "place"),
    ("balcony", "outdoors", "place"),
    ("rooftop", "outdoors", "place"),
    ("beach", "outdoors", "place"),
    ("ocean", "outdoors", "place"),
    ("pool", "outdoors", "place"),
    ("street", "outdoors", "place"),
    ("alley", "outdoors", "place"),
    ("park", "outdoors", "place"),
    ("forest", "outdoors", "place"),
    ("city", "outdoors", "place"),
    ("night sky", "outdoors", "place"),
    ("public", "outdoors", "place"),
]
for tag, io, mutex in place:
    heat = ["tease", "flash", "sex"]
    if tag in ("love hotel", "bed", "shower", "onsen"):
        heat = ["flash", "sex"]
    if tag in ("classroom", "office", "train", "street", "alley", "public"):
        heat = ["tease", "flash", "sex"]
    tags.append(T(tag, "env", mutex="place", implies=[io], heat=heat))

tags += [
    T("indoors", "env", mutex="in_out"),
    T("outdoors", "env", mutex="in_out"),
    T("day", "env", mutex="day_night"),
    T("night", "env", mutex="day_night"),
    T("evening", "env", mutex="day_night"),
    T("sunset", "env", mutex="day_night", implies=["outdoors"]),
    T("overcast", "env"),
    T("rain", "env"),
    T("steam", "env", heat=["flash", "sex"]),
    T("neon lights", "env", heat=["tease", "flash", "sex"]),
    T("lamp", "env", implies=["indoors"]),
    T("window light", "env"),
    T("moonlight", "env", implies=["night"]),
    T("cinematic lighting", "env"),
    T("dim lighting", "env"),
    T("dramatic lighting", "env"),
    T("rim lighting", "env"),
    T("backlighting", "env"),
    T("sidelighting", "env"),
    T("shadows", "env"),
    T("depth of field", "env"),
    T("bokeh", "env"),
    T("chromatic aberration", "env"),
    T("film grain", "env"),
]

# dedupe by tag+section keeping first
seen: set[tuple[str, str]] = set()
unique: list[dict] = []
for item in tags:
    key = (item["tag"], item["section"])
    if key in seen:
        continue
    seen.add(key)
    unique.append(item)

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
    "tags": unique,
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"wrote {OUT} ({len(unique)} tags)")


if __name__ == "__main__":
    pass
