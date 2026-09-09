#!/usr/bin/env python3
"""Rename a custom look tag. Mutex / implies / gate stay; only the name changes.

  python scripts/rename_custom_tag.py kkob newname
  python scripts/rename_custom_tag.py kkob newname --zh 新中文
  python scripts/rename_custom_tag.py kkob newname --dry-run

Then lexicon.json is rebuilt. Banned child tags (loli/shota/teen/child/…) are refused.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from merge_lexicon import BANNED, OUT, ROOT

TEXT_FILES = [
    ROOT / "scripts" / "merge_lexicon.py",
    ROOT / "scripts" / "groups.py",
    ROOT / "scripts" / "add_zh.py",
    ROOT / "scripts" / "test_engine.mjs",
]


def norm_tag(tag: str) -> str:
    return str(tag or "").strip().lower().replace("_", " ")


def token_re(tag: str) -> re.Pattern[str]:
    return re.compile(rf"(?<![A-Za-z0-9]){re.escape(tag)}(?![A-Za-z0-9])")


def replace_token(text: str, old: str, new: str) -> tuple[str, int]:
    old = norm_tag(old)
    new = norm_tag(new)
    if not old or old == new:
        return text, 0
    out, n = token_re(old).subn(new, text)
    return out, n


def lexicon_tags() -> set[str]:
    if not OUT.is_file():
        return set()
    data = json.loads(OUT.read_text(encoding="utf-8"))
    return {str(t.get("tag") or "") for t in data.get("tags") or []}


def new_tag_ok(tag: str) -> str | None:
    name = norm_tag(tag)
    if not name:
        return "empty"
    if name in BANNED or any(part in BANNED for part in name.split()):
        return "banned"
    if "loli" in name or "shota" in name:
        return "banned"
    if name in lexicon_tags():
        return "exists"
    return None


def patch_zh_value(text: str, tag: str, zh: str) -> str:
    pat = re.compile(rf'("{re.escape(tag)}":\s*")([^"]*)(")')
    return pat.sub(rf"\g<1>{zh}\3", text, count=1)


def patch_extra_zh(text: str, tag: str, zh: str) -> str:
    pat = re.compile(
        rf'("tag":\s*"{re.escape(tag)}",(?:.|\n){{0,500}}?"zh":\s*")([^"]*)(")'
    )
    return pat.sub(rf"\g<1>{zh}\3", text, count=1)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("old")
    p.add_argument("new")
    p.add_argument("--zh", default="", help="optional new Chinese label")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args(argv)
    old = norm_tag(args.old)
    new = norm_tag(args.new)
    if old == new:
        print("old and new are the same")
        return 1
    tags = lexicon_tags()
    if old not in tags:
        print(f"old tag not in lexicon: {old}")
        return 1
    err = new_tag_ok(new)
    if err == "banned":
        print(f"refused banned tag: {new}")
        return 1
    if err == "empty":
        print("new tag is empty")
        return 1
    if err == "exists":
        print(f"new tag already exists: {new}")
        return 1
    total = 0
    planned: list[tuple[Path, str, int]] = []
    for path in TEXT_FILES:
        raw = path.read_text(encoding="utf-8")
        out, n = replace_token(raw, old, new)
        if args.zh:
            if path.name == "add_zh.py":
                out = patch_zh_value(out, new, args.zh)
            elif path.name == "merge_lexicon.py":
                out = patch_extra_zh(out, new, args.zh)
        if n or out != raw:
            planned.append((path, out, n))
            total += n
    if total == 0:
        print("no occurrences to replace")
        return 1
    for path, _out, n in planned:
        print(f"{n:4}  {path.relative_to(ROOT)}")
    if args.dry_run:
        print("dry-run, lexicon not rebuilt")
        return 0
    for path, out, _n in planned:
        path.write_text(out, encoding="utf-8")
    subprocess.check_call([sys.executable, str(ROOT / "scripts" / "merge_lexicon.py")])
    subprocess.check_call([sys.executable, str(ROOT / "scripts" / "add_zh.py")])
    print(f"renamed {old} -> {new}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
