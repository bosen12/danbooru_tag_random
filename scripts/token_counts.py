#!/usr/bin/env python3
"""把詞庫每個字的 CLIP token 數算出來，寫成 web/token_counts.json。

為什麼要預先算：token 數是靜態的（"blue jacket" 永遠是 3 個 token），
而瀏覽器裡沒有 CLIP tokenizer。與其在前端塞一份 1.5MB 的 BPE 詞表，
不如建檔時算好，前端相加就好。

為什麼不寫進 lexicon.json：merge_lexicon.py 會整個重產 lexicon.json，
寫進去會被蓋掉。分開一個檔，merge 不碰它，改由測試確保兩者沒有脫節。

系統 python 沒有 transformers，用 ComfyUI 內嵌的那支跑：
"""
from __future__ import annotations

import json
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

try:
    from transformers import CLIPTokenizerFast
except ImportError:
    sys.exit(
        "這支需要 transformers。系統 python 沒有，請改用 ComfyUI 內嵌的那支跑，"
        "路徑是 <ComfyUI 資料夾>/python_embeded/python.exe scripts/token_counts.py"
    )


def main() -> None:
    lex = json.loads((ROOT / "web" / "lexicon.json").read_text(encoding="utf-8"))
    tok = CLIPTokenizerFast.from_pretrained("openai/clip-vit-large-patch14")

    def count(s: str) -> int:
        return len(tok(s, add_special_tokens=False)["input_ids"])

    # 引擎會吐出來的每一種字串，不只 tags[]：品質詞、三種分級尾巴、永遠都在的環境字
    strings = {t["tag"] for t in lex["tags"]}
    for key in ("quality", "alwaysEnv", "nsfwTail", "sfwTail", "sensitiveTail"):
        strings.update(lex.get(key) or [])
    strings.add("solo")                          # 骨架字，不在 tags[] 裡也會出現
    # 2026-09-18 之前這裡還有 adult。它是被無條件塞進每一張圖的，但 Danbooru 上
    # 0 張、模型沒把它當 tag 學過，已經移除（它唯一的作用「擋住 shota」改寫成
    # engine.js 裡直接的規則）。

    out = {s: count(s) for s in sorted(strings)}
    # ", " 的成本量出來而不是寫死，換 tokenizer 也不會錯
    sep = count("a, b") - count("a") - count("b")

    payload = {
        "_note": "CLIP token 數，由 scripts/token_counts.py 產生。sep 是 \", \" 的成本。",
        "sep": sep,
        "counts": out,
    }
    dest = ROOT / "web" / "token_counts.json"
    io.open(dest, "w", encoding="utf-8", newline="\n").write(
        json.dumps(payload, ensure_ascii=False, indent=1) + "\n"
    )
    print(f"寫出 {dest}：{len(out)} 個字串，分隔符 {sep} token")


if __name__ == "__main__":
    main()
