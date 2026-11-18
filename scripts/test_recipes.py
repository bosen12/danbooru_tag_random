#!/usr/bin/env python3
"""Recipe store / schema / path safety. Failures print and exit 1."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

failed = 0


def ok(name: str, cond: bool, detail: str = "") -> None:
    global failed
    if cond:
        print(f"ok   {name}")
    else:
        failed += 1
        print(f"FAIL {name}" + (f"\n  {detail}" if detail else ""))


td = Path(tempfile.mkdtemp(prefix="recipes-test-"))
os.environ["RECIPE_DATA_DIR"] = str(td)
os.environ["APP_SETTINGS"] = str(td / "settings.json")

import recipes  # noqa: E402


def sample(**extra):
    body = {
        "name": "測試配方",
        "positive": "1girl, solo, kimono",
        "positiveWeighted": "(1girl:1.2), solo, kimono",
        "negative": "bad hands",
        "seed": 42,
        "width": 832,
        "height": 1216,
        "checkpoint": r"illurtrious\wai.safetensors",
        "loras": [{"folder": "style", "file": "a.safetensors", "strength": 0.8, "trigger": "foo"}],
        "workflowId": "",
        "sampler": "euler_ancestral",
        "scheduler": "normal",
        "steps": 25,
        "cfg": 6.5,
        "rating": "explicit",
        "heats": ["tease", "flash", "sex"],
        "era": "edo",
        "sceneMode": "normal",
        "counts": {"env": 6},
        "mustDraw": {"env:place": 1},
        "pinned": ["kimono"],
        "userBanned": ["modern"],
        "presetOwned": ["kimono"],
        "traceSummary": {"kept": [{"tag": "kimono", "status": "kept", "source": "pin", "stage": "pin"}]},
    }
    body.update(extra)
    return body


rec = recipes.save_recipe(sample())
ok("save assigns id", bool(rec["id"]))
ok("schema version 1", rec["schemaVersion"] == 1)
got = recipes.get_recipe(rec["id"])
ok("read back same positive", got["positive"] == "1girl, solo, kimono")
ok("read back lora file", got["loras"][0]["file"].endswith("a.safetensors"))

named = recipes.save_recipe(sample(name="組合所有權", presetOwned={"id": "edo-kit", "tags": ["kimono", "obi"]}))
ok(
    "named preset ownership survives save",
    isinstance(named.get("presetOwned"), dict)
    and named["presetOwned"]["id"] == "edo-kit"
    and named["presetOwned"]["tags"] == ["kimono", "obi"],
    str(named.get("presetOwned")),
)
ok(
    "reproduce keeps named preset id",
    recipes.reproduce_payload(named)["presetOwned"]["id"] == "edo-kit",
)
legacy = recipes.save_recipe(sample(name="舊陣列所有權", presetOwned=["kimono"]))
ok(
    "legacy tag list still has kimono",
    isinstance(legacy.get("presetOwned"), dict) and "kimono" in legacy["presetOwned"]["tags"],
    str(legacy.get("presetOwned")),
)

rec["name"] = "改名"
updated = recipes.save_recipe(rec, rid=rec["id"])
ok("update keeps id", updated["id"] == rec["id"] and updated["name"] == "改名")
ok("update changes updatedAt", updated["updatedAt"] >= rec["updatedAt"])

payload = recipes.reproduce_payload(updated)
ok("reproduce uses saved seed", payload["seed"] == 42)
ok("reproduce uses saved ckpt", payload["ckpt"] == r"illurtrious\wai.safetensors")
ok("reproduce empty workflow is builtin", payload["workflowId"] == "")
ok("reproduce pins match", payload["pinned"] == ["kimono"])
live_panel = {"ckpt": "other.safetensors", "seed": 1, "positive": "nope"}
ok("reproduce ignores live panel keys", payload["ckpt"] != live_panel["ckpt"])

exported = recipes.export_payload([updated["id"]])
ok("export has recipes array", len(exported["recipes"]) == 1)
imported = recipes.import_payload(exported)
ok("import creates a new id", imported[0]["id"] != updated["id"])
ok("import keeps POS", imported[0]["positive"] == updated["positive"])

ok("list has both", len(recipes.list_recipes()) >= 2)

deleted = recipes.delete_recipe(updated["id"])
ok("delete returns body", deleted and deleted["id"] == updated["id"])
ok("delete removes file", recipes.get_recipe(updated["id"]) is None)
restored = recipes.save_recipe(deleted)
ok("undo via re-save works", restored["positive"] == deleted["positive"])

try:
    recipes.migrate_recipe({"schemaVersion": 99, "positive": "x"})
    ok("future schema rejected", False)
except recipes.RecipeError as exc:
    ok("future schema rejected", exc.code == "schema")

try:
    recipes.migrate_recipe({"schemaVersion": "nope", "positive": "x"})
    ok("garbage schema rejected", False)
except recipes.RecipeError as exc:
    ok("garbage schema rejected", exc.code == "schema")
except Exception as exc:
    ok("garbage schema rejected", False, type(exc).__name__)

arr = recipes.import_payload([{"positive": "1girl, solo", "name": "array-import"}])
ok("import accepts a JSON array", arr and arr[0]["positive"] == "1girl, solo")

try:
    recipes.normalize_recipe("nope")
    ok("corrupt type rejected", False)
except recipes.RecipeError:
    ok("corrupt type rejected", True)

try:
    recipes.save_recipe({"positive": "x" * (recipes.MAX_RECIPE_BYTES)})
    ok("oversized json rejected", False)
except recipes.RecipeError as exc:
    ok("oversized json rejected", exc.code == "too_large")

try:
    recipes._safe_id("../etc")
    ok("dotdot id rejected", False)
except recipes.RecipeError:
    ok("dotdot id rejected", True)

try:
    recipes._safe_id("a/b")
    ok("slash id rejected", False)
except recipes.RecipeError:
    ok("slash id rejected", True)

ok("unicode name kept", recipes.save_recipe(sample(name="江戶 浴衣 測試"))["name"] == "江戶 浴衣 測試")
space = recipes.save_recipe(sample(name="has space", checkpoint=r"folder name\my model.safetensors"))
ok("spaces in checkpoint kept", " " in space["checkpoint"])

ok("unknown fields dropped", "evil" not in recipes.normalize_recipe({"positive": "1girl", "evil": os.path.expanduser("~")}))

png = b"\x89PNG\r\n\x1a\n" + b"x" * 32
img_rec = recipes.save_image_bytes(space["id"], png, suffix=".png")
ok("image copy stores file name only", img_rec["image"]["file"].endswith(".png") and "/" not in img_rec["image"]["file"])
ok("image path resolves inside files dir", recipes.resolve_stored_file(img_rec["image"]["file"]) is not None)
ok("path traversal image rejected", recipes.resolve_stored_file("../engine.js") is None)
src_rec = recipes.save_image_bytes(space["id"], png, suffix=".png", src="sub/ComfyUI_00012_.png#abcd")
ok("image remembers which ComfyUI output it came from (log favourites match it)", src_rec["image"].get("src") == "sub/ComfyUI_00012_.png#abcd" and recipes.get_recipe(space["id"])["image"].get("src") == "sub/ComfyUI_00012_.png#abcd")
ok("list summary carries the source", next(r for r in recipes.list_recipes() if r["id"] == space["id"])["image"].get("src") == "sub/ComfyUI_00012_.png#abcd")
ok("absolute image rejected", recipes.resolve_stored_file(str(ROOT / "web" / "engine.js")) is None)

try:
    recipes.save_image_bytes(space["id"], b"x" * (recipes.MAX_IMAGE_BYTES + 1))
    ok("huge image rejected", False)
except recipes.RecipeError as exc:
    ok("huge image rejected", exc.code == "too_large")

errors = []

def writer(i):
    try:
        recipes.save_recipe(sample(name=f"race {i}", seed=i))
    except Exception as exc:
        errors.append(exc)

threads = [threading.Thread(target=writer, args=(i,)) for i in range(12)]
for t in threads:
    t.start()
for t in threads:
    t.join()
ok("parallel writes no exception", not errors, str(errors[:2]))
for path in td.glob("*.json"):
    if path.name == "settings.json":
        continue
    try:
        json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        ok(f"json intact {path.name}", False)
        break
else:
    ok("parallel writes leave whole json files", True)

old = recipes.migrate_recipe({"positive": "1girl", "seed": 3})
ok("missing schema migrates to v1", old["schemaVersion"] == 1)

anon = recipes.save_recipe(sample(name="無 id 所有權", presetOwned={"id": "", "tags": ["kimono"]}))
ok(
    "ownership without id keeps tags as imported",
    anon.get("presetOwned") == {"id": "imported", "tags": ["kimono"]},
    str(anon.get("presetOwned")),
)
evil_folder = recipes.save_recipe(
    sample(name="壞資料夾", loras=[{"folder": "style/../other", "file": "a.safetensors", "strength": 0.8}])
)
ok(
    "lora folder with .. is dropped",
    evil_folder.get("loras") == [],
    str(evil_folder.get("loras")),
)
ok(
    "normal lora folder still saved",
    recipes.save_recipe(sample(name="正常資料夾", loras=[{"folder": "style", "file": "a.safetensors", "strength": 0.8}]))["loras"][0]["folder"]
    == "style",
)

# 作品冊：縮圖只收 webp、存好之後列表摘要帶縮圖、長寬、你選的牌。
thumb_rec = recipes.save_recipe(sample(name="縮圖", width=832, height=1216, pinned=["1girl", "solo"]))
try:
    recipes.save_thumbnail(thumb_rec["id"], b"\x89PNG not webp")
    ok("thumbnail rejects non-webp", False)
except recipes.RecipeError:
    ok("thumbnail rejects non-webp", True)
recipes.save_thumbnail(thumb_rec["id"], b"RIFF....WEBPVP8 fake")
row = next(r for r in recipes.list_recipes() if r["id"] == thumb_rec["id"])
ok("summary carries thumbnail, size, pinned", row["thumbnail"]["file"].endswith(".thumb.webp") and row["width"] == 832 and row["height"] == 1216 and row["pinned"] == ["1girl", "solo"], str(row))
ok("thumbnail file is stored", recipes.resolve_stored_file(row["thumbnail"]["file"]) is not None)

# 存圖存到一半，另一個分頁刪了這件作品：刪掉的不能被存圖寫回來（存圖整段拿著鎖）。
race_rec = recipes.save_recipe(sample(name="存圖時刪掉"))
writing = threading.Event()
go_on = threading.Event()
real_replace = recipes.os.replace


def slow_replace(src, dst):
    if str(dst).endswith(".png"):
        writing.set()
        go_on.wait(5)
    return real_replace(src, dst)


recipes.os.replace = slow_replace
saver = threading.Thread(target=lambda: recipes.save_image_bytes(race_rec["id"], b"\x89PNG fake"))
saver.start()
writing.wait(5)
deleter = threading.Thread(target=lambda: recipes.delete_recipe(race_rec["id"]))
deleter.start()
deleter.join(0.3)
go_on.set()
saver.join(5)
deleter.join(5)
recipes.os.replace = real_replace
ok("deleting while the image is being saved stays deleted", recipes.get_recipe(race_rec["id"]) is None)

# 第五輪 Astra：Hires 2× 之後的成品一邊超過 2048，存檔不能截成 2048（那是生圖的上限，不是成品的）。
big = recipes.save_recipe(sample(width=1664, height=2432))
ok("Hires sized favourite keeps its real size", (big["width"], big["height"]) == (1664, 2432) and recipes.get_recipe(big["id"])["height"] == 2432, str((big["width"], big["height"])))

if failed:
    print(f"\n{failed} failed")
    sys.exit(1)
print("all ok")
