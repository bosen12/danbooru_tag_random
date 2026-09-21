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

if failed:
    print(f"\n{failed} failed")
    sys.exit(1)
print("all ok")
