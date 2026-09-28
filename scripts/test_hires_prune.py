#!/usr/bin/env python3
"""danbooru_hires 只留最近幾張。只用暫存目錄，不碰本機 Comfy 的 input。"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402

failed = 0


def ok(name: str, cond: bool, detail: str = "") -> None:
    global failed
    if not cond:
        failed += 1
        print(f"FAIL {name}" + (f"\n  {detail}" if detail else ""))
    else:
        print(f"ok   {name}")


def touch(folder: Path, name: str, stamp: float) -> None:
    path = folder / name
    path.write_bytes(b"png")
    os.utime(path, (stamp, stamp))


ok("local loopback", server.comfy_is_local("http://127.0.0.1:8188"))
ok("local localhost", server.comfy_is_local("http://localhost:8188/"))
ok("local ipv6", server.comfy_is_local("http://[::1]:8188"))
ok("remote left alone", not server.comfy_is_local("http://192.168.1.20:8188"))
ok("remote name left alone", not server.comfy_is_local("http://comfy.example:8188"))
ok("blank host left alone", not server.comfy_is_local("http://"))

root = Path(os.environ.get("TEMP") or "/tmp") / "hires-prune-unit"
# 每次用新的子目錄，避免跟上一輪撞名。
here = root / str(time.time_ns())
models = here / "ComfyUI" / "models" / "checkpoints"
models.mkdir(parents=True)
got = server.hires_input_dir(models)
ok("dir is sibling of models", got == here / "ComfyUI" / "input" / "danbooru_hires", str(got))
ok("no models ancestor", server.hires_input_dir(here / "loose" / "ckpts") is None)
ok("empty checkpoint dir", server.hires_input_dir("") is None)

folder = here / "input" / "danbooru_hires"
folder.mkdir(parents=True)
base = 1_700_000_000
for i in range(5):
    touch(folder, f"hires_{i:020x}.png", base + i)
touch(folder, "notes.txt", base)
touch(folder, "other.png", base)
(folder / "nested").mkdir()
touch(folder / "nested", "hires_ffffffffffffffffffffffffffffffffffffffff.png", base)

deleted = server.prune_hires_dir(folder, keep=3)
ok("deleted the two oldest", deleted == ["hires_" + f"{0:020x}.png", "hires_" + f"{1:020x}.png"], str(deleted))
left = sorted(p.name for p in folder.iterdir() if p.is_file())
ok(
    "kept newest three and the unrelated files",
    left == ["hires_" + f"{2:020x}.png", "hires_" + f"{3:020x}.png", "hires_" + f"{4:020x}.png", "notes.txt", "other.png"],
    str(left),
)
ok("did not enter the subfolder", (folder / "nested" / "hires_ffffffffffffffffffffffffffffffffffffffff.png").is_file())

# 佇列裡的舊檔即使超過 keep 也留下。
touch(folder, "hires_" + f"{0:020x}.png", base)  # older than the three we kept
deleted = server.prune_hires_dir(folder, keep=3, protect={"danbooru_hires/hires_" + f"{0:020x}.png"})
ok("queued name is not deleted", "hires_" + f"{0:020x}.png" not in deleted and (folder / ("hires_" + f"{0:020x}.png")).is_file(), str(deleted))
ok("a queued file does not push a newer one out", deleted == [], str(deleted))

# 五張裡留三張，第 0 張受保護，所以刪的是第 2 張（第 0、3、4 最新？ 
# 現在檔案：0 (old, protected), 2, 3, 4. That's 4 files, keep 3, protect 0.
# newest 3 are 2, 3, 4. 0 is protected. Nothing deleted. Yes deleted == [].

touch(folder, "hires_" + f"{1:020x}.png", base + 0.5)  # older than 2, 3, 4; newer than 0
deleted = server.prune_hires_dir(folder, keep=3, protect={"hires_" + f"{0:020x}.png"})
ok("drops the unqueued file that falls outside the newest", deleted == ["hires_" + f"{1:020x}.png"], str(deleted))
ok("protected old file stays", (folder / ("hires_" + f"{0:020x}.png")).is_file())

queue = {
    "queue_running": [
        [0, "pid", {"50": {"class_type": "LoadImage", "inputs": {"image": "danbooru_hires/hires_aabb.png"}}, "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "x"}}}]
    ],
    "queue_pending": [
        [1, "pid2", {"50": {"class_type": "LoadImage", "inputs": {"image": "hires_ccdd.png"}}}]
    ],
}
names = server.queued_hires_names(queue)
ok("queue names are basenames", names == {"hires_aabb.png", "hires_ccdd.png"}, str(names))
ok("missing queue is empty", server.queued_hires_names(None) == set())
ok("non-png queue name ignored", server.queued_hires_names({"queue_running": [[0, "p", {"1": {"class_type": "LoadImage", "inputs": {"image": "photo.jpg"}}}]]}) == set())
ok("absent directory is a no-op", server.prune_hires_dir(here / "nope") == [])

if failed:
    print(f"\n{failed} failed")
    sys.exit(1)
print("\nok")
