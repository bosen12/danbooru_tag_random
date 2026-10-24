#!/usr/bin/env python3
"""從 git 記錄寫出每張卡的加入日：web/tag_dates.json。

日期是這個字第一次出現的作者日（YYYY-MM-DD）。看這些檔裡的 tag 字串：
web/lexicon.json（含 characterBan）、web/lexicon_parts、scripts/characters.json、
以及 merge／建議池腳本裡的 row()。改過名的字（lexicon 的 renamed）沿用舊名更早的那天。

禁用角色一併寫進 banned，卡冊才列得出來。不寫 cardPositive，也不把 loli／shota 做成牌。

    python scripts/tag_dates.py
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "tag_dates.json"
PATHS = [
    "web/lexicon.json",
    "web/lexicon_parts",
    "scripts/characters.json",
    "scripts/merge_lexicon.py",
    "scripts/suggestion_tags.py",
    "scripts/more_tags.py",
    "scripts/focus_tags.py",
]
# 底線封鎖的字永遠不做牌（web/card-art.js 的 HARD_BANNED）。
HARD = {"loli", "shota"}
FAM = {"char_anime": "動漫", "char_game": "遊戲", "char_other": "其他"}

TAG_RE = re.compile(rb'"tag"\s*:\s*"([^"\\]+)"')
BAN_RE = re.compile(rb'"characterBan"\s*:\s*\[(.*?)\]', re.S)
QUOTED_RE = re.compile(rb'"([^"\\]*)"')
ROW_RE = re.compile(rb"""row\(\s*['"]([^'"]+)['"]""")


def norm(tag: str) -> str:
    return tag.replace("_", " ").strip().lower()


def wanted_now() -> tuple[dict, set[str], dict]:
    lex = json.loads((ROOT / "web" / "lexicon.json").read_text(encoding="utf-8"))
    tags = {norm(t["tag"]) for t in lex["tags"] if t.get("tag")}
    banned = {norm(t) for t in lex.get("characterBan") or [] if t}
    renamed = {}
    for old, new in (lex.get("renamed") or {}).items():
        old_n, new_n = norm(str(old)), norm(str(new))
        if old_n and new_n:
            renamed.setdefault(new_n, set()).add(old_n)
    watch = tags | banned | {old for olds in renamed.values() for old in olds}
    return lex, watch, renamed


def commits() -> list[tuple[str, str, list[str]]]:
    raw = subprocess.check_output(
        ["git", "log", "--reverse", "--pretty=format:%H %as", "--name-only", "--", *PATHS],
        cwd=ROOT,
    ).decode("utf-8", "replace")
    out: list[tuple[str, str, list[str]]] = []
    sha = date = None
    names: list[str] = []
    for line in raw.splitlines():
        if not line.strip():
            if sha and names:
                out.append((sha, date, names))
            sha = date = None
            names = []
            continue
        if sha is None:
            sha, _, date = line.partition(" ")
            continue
        if line.startswith(tuple(p.split("/")[0] + "/" for p in PATHS)) or line in PATHS:
            names.append(line.strip())
    if sha and names:
        out.append((sha, date, names))
    return out


def strings_of(path: str, blob: bytes) -> set[str]:
    found = {norm(m.decode("utf-8", "replace")) for m in TAG_RE.findall(blob)}
    if path.endswith(".py"):
        found.update(norm(m.decode("utf-8", "replace")) for m in ROW_RE.findall(blob))
    if path.endswith("lexicon.json"):
        ban = BAN_RE.search(blob)
        if ban:
            found.update(norm(m.decode("utf-8", "replace")) for m in QUOTED_RE.findall(ban.group(1)))
    found.discard("")
    return found


def first_dates(watch: set[str]) -> dict[str, str]:
    first: dict[str, str] = {}
    pending = set(watch)
    proc = subprocess.Popen(
        ["git", "cat-file", "--batch"],
        cwd=ROOT,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
    )
    assert proc.stdin and proc.stdout
    try:
        for sha, date, names in commits():
            if not pending:
                break
            for path in names:
                proc.stdin.write(f"{sha}:{path}\n".encode())
                proc.stdin.flush()
                header = proc.stdout.readline()
                if header.endswith(b" missing\n") or b" missing" in header:
                    continue
                try:
                    size = int(header.split()[2])
                except (IndexError, ValueError):
                    continue
                blob = proc.stdout.read(size)
                proc.stdout.read(1)  # trailing newline
                if not pending:
                    continue
                for tag in strings_of(path, blob):
                    if tag in pending:
                        first[tag] = date
                        pending.discard(tag)
    finally:
        proc.stdin.close()
        proc.wait()
    return first


def fold_renames(first: dict[str, str], renamed: dict[str, set[str]]) -> None:
    for new, olds in renamed.items():
        dates = [first[n] for n in olds | {new} if n in first]
        if dates:
            first[new] = min(dates)


def banned_cards(lex: dict, first: dict[str, str]) -> list[dict]:
    sys.path.insert(0, str(ROOT / "scripts"))
    from subgroups import character_sub_id

    series_names = json.loads((ROOT / "scripts" / "character_series.json").read_text(encoding="utf-8"))
    by_tag = {}
    for c in json.loads((ROOT / "scripts" / "characters.json").read_text(encoding="utf-8")):
        tag = norm(str(c.get("tag") or ""))
        if tag:
            by_tag[tag] = c
    group_zh = lex.get("groupZh") or {}
    rows = []
    for tag in sorted(norm(t) for t in lex.get("characterBan") or [] if t):
        if tag in HARD:
            continue
        c = by_tag.get(tag) or {}
        series = str(c.get("series") or "")
        group = character_sub_id(series) if series else "character"
        fam = FAM.get(c.get("sub") or "", "其他")
        short = (series_names.get(series) or [series or "角色"])[0]
        gate = c.get("gender") if c.get("gender") in ("female", "male") else "any"
        rows.append({
            "tag": tag,
            "zh": c.get("zh") or tag,
            "series": series,
            "group": group,
            "groupZh": group_zh.get(group) or (f"{fam}・{short}" if series else "角色"),
            "gate": gate,
            "reason": c.get("ban_reason") or "",
            "added": first.get(tag, ""),
        })
    return rows


def main() -> int:
    lex, watch, renamed = wanted_now()
    tags = [norm(t["tag"]) for t in lex["tags"]]
    bans = [norm(t) for t in lex.get("characterBan") or []]
    print(f"walk {len(watch)} names …", flush=True)
    first = first_dates(watch)
    fold_renames(first, renamed)
    keep = set(tags) | set(bans)
    added = {tag: first[tag] for tag in sorted(keep) if tag in first}
    missing = sorted(keep - set(added))
    banned = banned_cards(lex, first)
    OUT.write_text(json.dumps({"added": added, "banned": banned}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    dated_bans = sum(1 for b in banned if b["added"])
    print(f"wrote {OUT.relative_to(ROOT)}: tags {len(tags)}, dated {len(added)}, banned cards {len(banned)} ({dated_bans} dated)")
    if missing:
        print(f"MISSING {len(missing)}")
        for tag in missing[:40]:
            print(" ", tag)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
