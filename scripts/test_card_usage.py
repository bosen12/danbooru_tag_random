"""card_usage.py：只收詞庫有的字、每張牌一個數字、merge 只加一次的累計、壞輸入不炸。"""
import json
import os
import sys
import tempfile
from pathlib import Path

tmp = Path(tempfile.mkdtemp())
os.environ["CARD_USAGE_PATH"] = str(tmp / "usage.json")
lex = tmp / "lexicon.json"
lex.write_text(json.dumps({"tags": [{"tag": "1girl"}, {"tag": "solo"}, {"tag": "cat ears"}]}), encoding="utf-8")
os.environ["CARD_USAGE_LEXICON"] = str(lex)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import card_usage  # noqa: E402

failed = 0


def ok(name, cond):
    global failed
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        failed += 1


s = card_usage.add({"entries": [{"tags": ["1girl", "solo", "solo", "not a tag", 5], "mine": ["1girl"], "at": 1000}]})
ok("每張牌一次、同一張圖重複的字不算兩次", s["counts"] == {"1girl": 1, "solo": 1})
ok("詞庫沒有的字、非字串不收", "not a tag" not in s["counts"])
ok("親手放的另外記", s["mine"] == {"1girl": 1})
s = card_usage.add({"entries": [{"tags": ["1girl"], "at": 500}], "merge": {"counts": {"cat ears": 3, "bogus": 9}, "mine": {}, "last": {"cat ears": 2000}}})
ok("merge 加進總數、最近一次取較晚的", s["counts"]["cat ears"] == 3 and s["counts"]["1girl"] == 2 and s["last"]["1girl"] == 1000 and s["last"]["cat ears"] == 2000)
ok("merge 也只收詞庫有的字", "bogus" not in s["counts"])
ok("讀回來一樣", card_usage.load()["counts"] == s["counts"])
try:
    card_usage.add({"entries": "x"})
    ok("entries 不是陣列要擋", False)
except card_usage.UsageError:
    ok("entries 不是陣列要擋", True)
size = Path(os.environ["CARD_USAGE_PATH"]).stat().st_size
for _ in range(50):
    card_usage.add({"entries": [{"tags": ["1girl", "solo"]}] * 20})
ok("檔案不會隨使用次數長大（只有數字變）", Path(os.environ["CARD_USAGE_PATH"]).stat().st_size < size + 40)
sys.exit(1 if failed else 0)
