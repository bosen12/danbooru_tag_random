#!/usr/bin/env python3
"""Sample special_prompts .py packs and list tags missing from web/lexicon.json."""
from __future__ import annotations

import ast
import json
import random
import re
from collections import Counter
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app_config import cfg

ROOT = Path(__file__).resolve().parents[1]
PACKS = Path(str(cfg("paths.promptPacksDir", "PACKS_DIR", "")))
LEX = ROOT / "web" / "lexicon.json"
OUT = ROOT / "scripts" / "special_prompts_missing.json"

SKIP = {
    "masterpiece",
    "best quality",
    "amazing quality",
    "absurdres",
    "highres",
    "very aesthetic",
    "highly aesthetic",
    "newest",
    "nsfw",
    "explicit",
    "detailed",
    "soft lighting",
    "1girl",
    "2girls",
    "3girls",
    "4girls",
    "1boy",
    "2boys",
    "3boys",
    "solo",
    "adult",
    "hetero",
    "penis",
    "adult male",
}

WEIGHT = re.compile(r"^\((.+):[0-9.]+\)\s*$")
HAS_CJK = re.compile(r"[\u3400-\u9fff]")


def split_tags(blob: str) -> list[str]:
    out = []
    for raw in blob.split(","):
        t = raw.strip().strip('"').strip("'").lower().replace("_", " ")
        m = WEIGHT.match(t)
        if m:
            t = m.group(1).strip()
        t = re.sub(r"\s+", " ", t)
        if not t or t in SKIP or HAS_CJK.search(t):
            continue
        if len(t) > 48:
            continue
        out.append(t)
    return out


def load_positive(path: Path) -> list[str]:
    src = path.read_text(encoding="utf-8", errors="replace")
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return []
    tags: list[str] = []
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        names = [t.id for t in node.targets if isinstance(t, ast.Name)]
        if "POSITIVE" not in names:
            continue
        try:
            val = ast.literal_eval(node.value)
        except Exception:
            continue
        if isinstance(val, str):
            tags.extend(split_tags(val))
        elif isinstance(val, list):
            for item in val:
                if isinstance(item, str):
                    tags.extend(split_tags(item))
    return tags


def main() -> None:
    files = [p for p in PACKS.rglob("*.py") if p.name != "__init__.py" and "__pycache__" not in p.parts]
    rng = random.Random(20260910)
    n = min(5000, len(files))
    sample = rng.sample(files, n)

    known = {str(t.get("tag") or "").lower() for t in json.loads(LEX.read_text(encoding="utf-8")).get("tags") or []}
    known |= SKIP

    freq: Counter[str] = Counter()
    files_hit: dict[str, int] = Counter()
    parsed = 0
    empty = 0
    for path in sample:
        tags = load_positive(path)
        if not tags:
            empty += 1
            continue
        parsed += 1
        uniq = set(tags)
        for t in uniq:
            if t not in known:
                freq[t] += 1
                files_hit[t] += 1

    missing = [
        {"tag": t, "files": c}
        for t, c in freq.most_common()
    ]
    OUT.write_text(
        json.dumps(
            {
                "sampled": n,
                "parsed": parsed,
                "empty": empty,
                "lexicon": len(known),
                "missing_unique": len(missing),
                "missing": missing,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"sampled={n} parsed={parsed} empty={empty} missing_unique={len(missing)}")
    print(f"wrote {OUT}")
    for row in missing[:80]:
        print(f"{row['files']:4d}  {row['tag']}")


if __name__ == "__main__":
    main()
