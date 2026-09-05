#!/usr/bin/env python3
"""Sample random draws and fail if mutex / nude / solo / in-out collide."""
from __future__ import annotations

import json
import random
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEX = json.loads((ROOT / "web" / "lexicon.json").read_text(encoding="utf-8"))
BY = {t["tag"]: t for t in LEX["tags"]}

SEX_ACT = {
    "sex", "vaginal", "anal", "cowgirl position", "reverse cowgirl position",
    "doggystyle", "standing doggystyle", "missionary", "mating press",
    "standing sex", "sex from behind", "full nelson", "amazon position",
    "prone bone", "spooning", "suspended congress", "spitroast",
    "double penetration", "69", "paizuri", "paizuri under clothes",
    "fellatio", "deepthroat", "irrumatio", "cunnilingus", "anilingus",
    "handjob", "footjob", "facesitting", "tribadism", "clothed sex",
    "public sex", "happy sex",
}


def groups_of(tag: str) -> list[str]:
    item = BY.get(tag) or {}
    g = []
    if item.get("mutex"):
        g.append(item["mutex"])
    if tag in SEX_ACT:
        g.append("sex_act")
    return g


def conflicts(tags: list[str]) -> list[tuple]:
    found = []
    seen: dict[str, str] = {}
    names = set(tags)
    for t in tags:
        for g in groups_of(t):
            if g in seen and seen[g] != t:
                found.append((g, seen[g], t))
            else:
                seen[g] = t
    if "solo" in names and names & {"2girls", "3girls", "4girls", "2boys", "3boys"}:
        found.append(("solo_count", "solo", "2+"))
    nude = names & {"nude", "completely nude"}
    if nude and names & {"dress", "sundress", "jeans", "kimono", "hanfu", "toga"}:
        found.append(("nude_garment", "nude", "garment"))
    if "indoors" in names and "outdoors" in names:
        found.append(("in_out", "indoors", "outdoors"))
    if "day" in names and "night" in names:
        found.append(("day_night", "day", "night"))
    return found


def pick_cast(rng: random.Random) -> list[str]:
    table = LEX["castWeights"]["girl_only"]
    k = rng.choices(list(table), weights=list(table.values()), k=1)[0]
    parts = [p.strip() for p in k.split(",")]
    n = sum(int(p[0]) for p in parts if p[:1].isdigit())
    if n == 1:
        parts.append("solo")
    parts.append("adult")
    return parts


def draw(rng: random.Random) -> list[str]:
    used: list[str] = []
    taken: dict[str, str] = {}

    def busy(tag: str) -> bool:
        for g in groups_of(tag):
            if g in taken and taken[g] != tag:
                return True
        return False

    def occupy(tag: str) -> None:
        used.append(tag)
        for g in groups_of(tag):
            taken[g] = tag

    def commit(tag: str) -> bool:
        if tag in used:
            return False
        item = BY.get(tag) or {}
        deps = list(item.get("bind") or []) + list(item.get("implies") or [])
        if busy(tag):
            return False
        for d in deps:
            if d in used:
                continue
            if busy(d):
                return False
        occupy(tag)
        for d in deps:
            if d in used or busy(d):
                continue
            occupy(d)
        return True

    for t in pick_cast(rng):
        commit(t)
    heat = rng.choice(["tease", "flash", "sex"])
    era = rng.choice(["modern", "ancient_china", "ancient_greece", "medieval", "edo", "victorian"])
    female = any("girl" in t for t in used)

    def allow(item: dict) -> bool:
        if item["tag"] in used:
            return False
        if heat not in (item.get("heat") or ["tease", "flash", "sex"]):
            return False
        er = item.get("era") or ["any"]
        if er and "any" not in er and era not in er:
            return False
        if item.get("gate") == "female" and not female:
            return False
        if item.get("gate") == "male":
            return False
        for g in groups_of(item["tag"]):
            if g in taken:
                return False
        return True

    by_sec = defaultdict(list)
    for item in LEX["tags"]:
        by_sec[item["section"]].append(item)
    for sec, n in (("feature", 8), ("clothing", 5), ("pose", 6), ("env", 4)):
        pool = [i for i in by_sec[sec] if allow(i)]
        rng.shuffle(pool)
        got = 0
        for item in pool:
            if got >= n:
                break
            if commit(item["tag"]):
                got += 1
    names = set(used)
    if names & {"nude", "completely nude"}:
        drop = {
            t
            for t in used
            if (BY.get(t) or {}).get("section") == "clothing"
            and (BY.get(t) or {}).get("layer") not in ("skin", "accessory")
        }
        used = [t for t in used if t not in drop]
    n = sum(int(t[0]) for t in used if t[:1].isdigit() and ("girl" in t or "boy" in t))
    if n > 1:
        used = [t for t in used if t != "solo"]
    return used + LEX["quality"] + LEX["nsfwTail"] + LEX["alwaysEnv"]


def main() -> None:
    rng = random.Random(20260906)
    bad = 0
    for i in range(400):
        tags = draw(rng)
        c = conflicts(tags)
        if c:
            bad += 1
            if bad <= 8:
                print("FAIL", i, c, ", ".join([t for t in tags if t in BY][:16]))
    missing_zh = [t["tag"] for t in LEX["tags"] if not t.get("zh")]
    print(f"draws_with_conflict={bad}/400 missing_zh={len(missing_zh)}")
    if missing_zh:
        print("zh missing", missing_zh[:20])
        sys.exit(1)
    if bad:
        sys.exit(1)
    print("ok")


if __name__ == "__main__":
    main()
