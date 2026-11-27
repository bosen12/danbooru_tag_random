"""永遠不抽的字（hardban）：唯一的一份在 web/rules/hardban.js。

伺服器（server.py）、腳本（相關的牌、打包卡面）都從這裡讀，不再各自抄一份
（以前伺服器那份少了 10 個字，2026-11-28 合併）。

讀不到、格式不對、數量少得不合理：一律停下來（SystemExit）。寧可不啟動、不產檔，
也不要在沒有封鎖的情況下跑。
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HARD_BAN_FILE = ROOT / "web" / "rules" / "hardban.js"
# 名單少於這個數就當成讀壞了（現在 50 個）。
MIN_WORDS = 10
_PATTERN = re.compile(r"export const HARD_BAN = Object\.freeze\(\[(.*?)\]\);", re.S)


def parse_hard_ban(src: str) -> list[str]:
    """從 hardban.js 的文字讀出名單（照檔案裡的順序）。格式不對丟 ValueError。"""
    m = _PATTERN.search(src or "")
    if not m:
        raise ValueError("找不到 export const HARD_BAN = Object.freeze([...]);")
    body = re.sub(r"//[^\n]*", "", m.group(1))
    words = re.findall(r'"([^"\\]*)"', body)
    if len(words) < MIN_WORDS:
        raise ValueError(f"只讀到 {len(words)} 個字，跟預期不合")
    return words


def load_hard_ban(path: Path | str = HARD_BAN_FILE) -> frozenset[str]:
    """名單（小寫、空白分隔，跟 tag 的寫法一樣）。讀不到或格式不對就停。"""
    p = Path(path)
    try:
        src = p.read_text(encoding="utf-8")
    except OSError as e:
        raise SystemExit(f"讀不到永遠不抽的字 {p}：{e}。未成年保護對不上，不啟動。")
    try:
        return frozenset(w.strip().lower() for w in parse_hard_ban(src))
    except ValueError as e:
        raise SystemExit(f"{p} 讀壞了（{e}）。未成年保護對不上，不啟動。")
