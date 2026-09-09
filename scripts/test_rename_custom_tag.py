#!/usr/bin/env python3
"""Tests for scripts/rename_custom_tag.py. Failures print and exit 1."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rename_custom_tag import new_tag_ok, replace_token

failed = 0


def eq(name, got, want):
    global failed
    if got != want:
        failed += 1
        print(f"FAIL {name}\n  got  {got!r}\n  want {want!r}")
    else:
        print(f"ok   {name}")


def ok(name, cond, detail=""):
    global failed
    if not cond:
        failed += 1
        print(f"FAIL {name}" + (f"\n  {detail}" if detail else ""))
    else:
        print(f"ok   {name}")


SAMPLE = '''
    "kkob": ["short male"],
    "kokod": ["petite"],
        if mx == "height_m" or tag in {"kkob", "tall male", "short male"}:
            "tag": "kkob",
            "mutex": "height_m",
            "zh": "矮小",
    "kkob": "矮小",
'''


out, n = replace_token(SAMPLE, "kkob", "zznn")
eq("replace count", n, 4)
ok("new name in quotes", '"zznn"' in out)
ok("old name gone", '"kkob"' not in out and "kkob" not in out)
ok("mutex name unchanged", "height_m" in out)
ok("implies target unchanged", '"short male"' in out)
ok("other custom tag unchanged", '"kokod"' in out)
ok("set membership updated", '{"zznn", "tall male", "short male"}' in out)

out2, n2 = replace_token('kkob\nkkoba\n"kkob"\nkkobx\ndef extra_kkob_tags()', "kkob", "zznn")
eq("skip lookalike tokens", n2, 3)
ok("lookalike kkoba kept", "kkoba" in out2)
ok("lookalike kkobx kept", "kkobx" in out2)
ok("function name follows", "extra_zznn_tags" in out2)

eq("same name is no-op count", replace_token(SAMPLE, "kkob", "kkob")[1], 0)

eq("empty new refused", new_tag_ok(""), "empty")
eq("shota refused", new_tag_ok("shota"), "banned")
eq("loli refused", new_tag_ok("loli"), "banned")
eq("child refused", new_tag_ok("child"), "banned")
eq("teen refused", new_tag_ok("teen"), "banned")
eq("shotacon refused", new_tag_ok("shotacon"), "banned")
eq("taken name refused", new_tag_ok("kokod"), "exists")
eq("taken short male refused", new_tag_ok("short male"), "exists")
eq("ok unused name", new_tag_ok("zznn"), None)
eq("underscore folds to space", new_tag_ok("short_male"), "exists")

if failed:
    print(f"\n{failed} failed")
    sys.exit(1)
print("\nok")
