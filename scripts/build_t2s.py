#!/usr/bin/env python3
"""產生 web6/t2s.js：字盒搜尋用的「繁體 → 簡體」單字對照表。

搜尋時搜尋字和牌名都先轉成簡體再比，打「红发」「紅髮」都找得到「紅髮」。
往簡體轉（不是往繁體轉）：簡體一個字常常對到好幾個繁體字（发＝發／髮），反過來轉會猜錯；
往簡體轉是一對一的。

資料來源：OpenCC 的 dictionary/TSCharacters.txt（Apache License 2.0，授權在 web/vendor/opencc/）。
整份收進來（約 4100 個字），以後詞庫加了新的牌也不必重做這張表。

用法：python scripts/build_t2s.py 路徑/TSCharacters.txt
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web6" / "t2s.js"


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("用法：python scripts/build_t2s.py 路徑/TSCharacters.txt")
    pairs: dict[str, str] = {}
    for line in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        t, s = parts[0], parts[1].split(" ")[0]
        if len(t) == 1 and len(s) == 1 and t != s:
            pairs[t] = s
    trad = "".join(pairs)
    simp = "".join(pairs[t] for t in pairs)
    body = (
        "/**\n"
        " * 繁體 → 簡體的單字對照（字盒搜尋用，cards.js 的 searchKey）。由 scripts/build_t2s.py 產生，不要手改。\n"
        " * 資料來源：OpenCC dictionary/TSCharacters.txt，Apache License 2.0（見 web/vendor/opencc/LICENSE、NOTICE）。\n"
        " */\n"
        f'const TRAD = "{trad}";\n'
        f'const SIMP = "{simp}";\n'
        "const MAP = new Map();\n"
        "{\n"
        "  const t = [...TRAD];\n"
        "  const s = [...SIMP];\n"
        "  for (let i = 0; i < t.length; i++) MAP.set(t[i], s[i]);\n"
        "}\n"
        "\n"
        "/** 一串字裡的繁體字換成簡體（其他字原樣）。 */\n"
        "export function toSimplified(text) {\n"
        "  let out = \"\";\n"
        "  for (const ch of String(text)) out += MAP.get(ch) || ch;\n"
        "  return out;\n"
        "}\n"
    )
    OUT.write_bytes(body.encode("utf-8"))
    print(f"wrote {OUT} ({len(pairs)} pairs, {len(body.encode('utf-8'))} bytes)")


if __name__ == "__main__":
    main()
