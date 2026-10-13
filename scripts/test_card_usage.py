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

# 同一筆送兩次只算一次（回應掉了重送、兩個分頁同時送）；沒帶編號的舊版照舊每次算。
base = card_usage.load()["counts"].get("cat ears", 0)
card_usage.add({"entries": [{"id": "e-1", "tags": ["cat ears"], "at": 3000}]})
card_usage.add({"entries": [{"id": "e-1", "tags": ["cat ears"], "at": 3000}, {"id": "e-2", "tags": ["cat ears"], "at": 3001}]})
ok("帶編號的同一筆送兩次只算一次", card_usage.load()["counts"]["cat ears"] == base + 2)
card_usage.add({"entries": [{"tags": ["cat ears"]}]})
card_usage.add({"entries": [{"tags": ["cat ears"]}]})
ok("沒帶編號的（舊版網頁）照舊每次都算", card_usage.load()["counts"]["cat ears"] == base + 4)
m = {"counts": {"solo": 5}, "mine": {}, "last": {}}
solo0 = card_usage.load()["counts"].get("solo", 0)
card_usage.add({"entries": [], "merge": m, "mergeId": "m-1"})
card_usage.add({"entries": [], "merge": m, "mergeId": "m-1"})
ok("同一份 merge 送兩次只加一次", card_usage.load()["counts"]["solo"] == solo0 + 5)
ok("收過的編號不跟著回應送出去", "seen" not in card_usage.load() and "seen" not in card_usage.add({"entries": []}))
big = [{"id": f"x-{i}", "tags": ["1girl"]} for i in range(400)]
for k in range(0, card_usage.SEEN_MAX + 400, 400):
    card_usage.add({"entries": [{**e, "id": f"{e['id']}-{k}"} for e in big]})
ok("收過的編號有上限（檔案不會一直長大）", len(json.loads(Path(os.environ["CARD_USAGE_PATH"]).read_text(encoding="utf-8"))["seen"]) == card_usage.SEEN_MAX)

# 兩個伺服器（不同程序、同一個 data/）同時寫：次數精確相加、牌組一組都不少（file_lock）。
import subprocess  # noqa: E402
import textwrap  # noqa: E402
import time as _time  # noqa: E402

race = tmp / "race"
race.mkdir()
env = {**os.environ, "CARD_USAGE_PATH": str(race / "usage.json"), "CARD_DECKS_PATH": str(race / "decks.json"), "CARD_USAGE_LEXICON": str(lex)}
start_at = _time.time() + 1.5
worker = textwrap.dedent(f"""
    import sys, time
    sys.path.insert(0, {str(Path(__file__).resolve().parent.parent)!r})
    import card_usage, card_decks
    who = sys.argv[1]
    while time.time() < {start_at}:
        time.sleep(0.001)
    for i in range(60):
        card_usage.add({{"entries": [{{"id": who + str(i), "tags": ["1girl"]}}]}})
        card_decks.save({{"name": who + str(i), "tags": ["solo"]}})
""")
procs = [subprocess.Popen([sys.executable, "-c", worker, w], env=env) for w in ("a", "b")]
codes = [p.wait(120) for p in procs]
usage_after = json.loads((race / "usage.json").read_text(encoding="utf-8"))
decks_after = json.loads((race / "decks.json").read_text(encoding="utf-8"))["decks"]
ok("兩個程序同時寫：都沒出錯", codes == [0, 0])
ok("兩個程序同時寫：次數精確相加（60＋60）", usage_after["counts"].get("1girl") == 120)
ok("兩個程序同時寫：牌組一組都不少（60＋60）", len(decks_after) == 120)
ok("兩個程序同時寫：沒有留下暫存檔", not list(race.glob("*.tmp")))

sys.exit(1 if failed else 0)
