"""card_decks.py：只收詞庫有的字、要有名字、帶 id 覆寫（改名、刪掉後復原）、刪除、壞輸入不炸。"""
import json
import os
import sys
import tempfile
from pathlib import Path

tmp = Path(tempfile.mkdtemp())
os.environ["CARD_DECKS_PATH"] = str(tmp / "decks.json")
lex = tmp / "lexicon.json"
lex.write_text(json.dumps({"tags": [{"tag": "1girl"}, {"tag": "solo"}, {"tag": "cat ears"}]}), encoding="utf-8")
os.environ["CARD_USAGE_LEXICON"] = str(lex)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import card_decks  # noqa: E402

failed = 0


def ok(name, cond):
    global failed
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        failed += 1


def raises(name, fn):
    try:
        fn()
        ok(name, False)
    except card_decks.DeckError:
        ok(name, True)


r = card_decks.save({"name": "  貓耳   單人 ", "tags": ["1girl", "cat ears", "cat ears", "not a tag", 5]})
d = r["deck"]
ok("新的一組有 id、名字收空白", d["id"].startswith("d-") and d["name"] == "貓耳 單人")
ok("只收詞庫有的字、去重、照原本順序", d["tags"] == ["1girl", "cat ears"])
ok("讀回來一樣", card_decks.load() == [d])

r2 = card_decks.save({"id": d["id"], "name": "改名", "tags": ["solo"]})
ok("帶 id 是覆寫，不是多一組", len(r2["decks"]) == 1 and r2["deck"]["name"] == "改名" and r2["deck"]["tags"] == ["solo"])
ok("覆寫保留建立時間", r2["deck"]["createdAt"] == d["createdAt"])

r3 = card_decks.save({"name": "第二組", "tags": ["1girl"]})
ok("新的排在前面（最近改過的先）", r3["decks"][0]["id"] == r3["deck"]["id"])

gone = card_decks.delete(d["id"])
ok("刪掉回傳被刪的那組、剩下的", gone["deck"]["id"] == d["id"] and len(gone["decks"]) == 1)
back = card_decks.save(gone["deck"])
ok("刪掉後原樣送回去 = 復原（同一個 id）", back["deck"]["id"] == d["id"] and len(back["decks"]) == 2)

raises("沒有名字要擋", lambda: card_decks.save({"name": "  ", "tags": ["1girl"]}))
raises("tags 不是陣列要擋", lambda: card_decks.save({"name": "x", "tags": "1girl"}))
raises("一張詞庫的牌都沒有要擋", lambda: card_decks.save({"name": "x", "tags": ["nope"]}))
raises("刪不存在的要擋", lambda: card_decks.delete("d-000000000000"))
raises("payload 不是物件要擋", lambda: card_decks.save(["x"]))

many = card_decks.save({"name": "很多", "tags": ["1girl"] + [f"t{i}" for i in range(100)]})
ok("名字、牌數有上限", len(many["deck"]["name"]) <= card_decks.MAX_NAME and len(many["deck"]["tags"]) <= card_decks.MAX_TAGS)

w = card_decks.save({"name": "有份量", "tags": ["1girl", "solo"], "weights": {"1girl": 1.2, "solo": 1, "cat ears": 0.7, "bogus": 1.4}})["deck"]
ok("份量：只留牌組裡有的、不是 1 的", w["weights"] == {"1girl": 1.2})
w2 = card_decks.save({"name": "份量怪值", "tags": ["1girl", "solo"], "weights": {"1girl": 9, "solo": "x"}})["deck"]
ok("份量：超出 0.5～1.5、不是數字的不收", w2["weights"] == {})
ok("讀回來份量還在", next(d for d in card_decks.load() if d["id"] == w["id"])["weights"] == {"1girl": 1.2})

Path(os.environ["CARD_DECKS_PATH"]).write_text("{壞掉的 json", encoding="utf-8")
ok("檔案壞掉讀成空的，不炸", card_decks.load() == [])

print("all ok" if not failed else f"{failed} failed")
sys.exit(1 if failed else 0)
