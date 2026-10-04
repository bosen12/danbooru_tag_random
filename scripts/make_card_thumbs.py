#!/usr/bin/env python3
"""卡面縮圖：web/cards/thumb/ 放 200px 寬的小圖，字盒、牌堆這些格子用它。

一格牌大概 90px 寬，手機雙倍像素也只要 180px；原圖 480px、平均 36KB，
整個字盒捲下去要載 30～50MB。縮圖約 8KB，差四倍多。
網頁用 srcset 讓瀏覽器自己挑：格子小就拿縮圖，放大牌、校樣拿原圖。
manifest.json 裡 "thumb": true 的才有縮圖，沒有的照樣用原圖，不會壞。

新烤的卡（bake_card_art.py）會直接從 ComfyUI 一起存縮圖，不需要這支。
這支是給「縮圖出現之前就烤好的卡」補的，要有 ffmpeg；沒有就什麼都不做。

墨池（web6）另外用一排「細縮圖」（mini，見 card_thumbnails.py）照牌實際大小 × DPR 挑，
線條比較不會出鋸齒。這支也會補：只讀原圖，原圖、舊縮圖都不動；全部做好驗過才寫進 manifest。

    python scripts/make_card_thumbs.py              # 補沒有縮圖的、沒有（或過期）細縮圖的
    python scripts/make_card_thumbs.py --mini-only  # 只補細縮圖（舊縮圖、v 一概不碰）
    python scripts/make_card_thumbs.py --no-mini    # 只做舊的 200px 縮圖
    python scripts/make_card_thumbs.py --force      # 全部重做
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from bake_card_art import CARD_DIR, THUMB_DIR_NAME, THUMB_SMALL_W, lock_state, save_manifest  # noqa: E402
import card_thumbnails  # noqa: E402


def make_one(ffmpeg: str, src: Path, dst: Path) -> bool:
    r = subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
         "-vf", f"scale={THUMB_SMALL_W}:-2:flags=lanczos", "-c:v", "libwebp", "-quality", "82", "-compression_level", "6", str(dst)],
        capture_output=True,
    )
    return r.returncode == 0 and dst.exists() and dst.stat().st_size > 0


def make_minis(card_dir: Path, manifest_path: Path, force: bool) -> int:
    """補細縮圖。做的這段時間 manifest 若被改過（又烤了一張），只更新原圖沒變的那幾筆。"""
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        print("ffmpeg/ffprobe not found; skipping mini thumbnails (web6 keeps the old thumbnails)")
        return 0
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    todo = [
        (tag, dict(m)) for tag, m in manifest.items()
        if m.get("v") and (card_dir / m["file"]).is_file() and (force or not card_thumbnails.entry_is_current(card_dir, m))
    ]
    if not todo:
        removed = card_thumbnails.prune(card_dir, manifest)
        print(f"mini thumbnails already up to date; pruned {removed}")
        return 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=max(2, (os.cpu_count() or 4) // 2)) as pool:
        built = list(pool.map(lambda job: card_thumbnails.build_entry(ffmpeg, ffprobe, card_dir, job[1]), todo))
    fresh = json.loads(manifest_path.read_text(encoding="utf-8"))
    done = 0
    for (tag, m), mini in zip(todo, built):
        cur = fresh.get(tag)
        if mini and cur and cur.get("file") == m["file"] and cur.get("v") == mini["src"]:
            cur["mini"] = mini
            done += 1
    if done:
        save_manifest(manifest_path, fresh)
    removed = card_thumbnails.prune(card_dir, fresh)
    print(f"mini thumbnails: {done}/{len(todo)} in {time.time() - t0:.0f}s; pruned {removed}")
    return 0 if done == len(todo) else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--mini-only", action="store_true")
    ap.add_argument("--no-mini", action="store_true")
    args = ap.parse_args()

    ffmpeg = shutil.which("ffmpeg")
    manifest_path = CARD_DIR / "manifest.json"
    if not manifest_path.exists():
        print("no card art yet")
        return 0
    if lock_state(CARD_DIR):
        print("a bake is running (web/cards/.baking); run this again when it finishes")
        return 0
    if args.mini_only:
        return make_minis(CARD_DIR, manifest_path, args.force)
    rc = legacy_thumbs(ffmpeg, manifest_path, args.force)
    if not args.no_mini:
        rc = make_minis(CARD_DIR, manifest_path, args.force) or rc
    return rc


def legacy_thumbs(ffmpeg, manifest_path: Path, force: bool) -> int:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    thumb_dir = CARD_DIR / THUMB_DIR_NAME
    thumb_dir.mkdir(exist_ok=True)

    # 順手補上內容雜湊（v）：網頁把它接在網址後面，伺服器看到就整年快取。
    versioned = 0
    for m in manifest.values():
        src = CARD_DIR / m["file"]
        if src.exists() and (force or not m.get("v")):
            m["v"] = hashlib.sha1(src.read_bytes()).hexdigest()[:10]
            versioned += 1

    todo = []
    for tag, m in manifest.items():
        src = CARD_DIR / m["file"]
        dst = thumb_dir / m["file"]
        if not src.exists():
            continue
        if not force and m.get("thumb") and dst.exists():
            continue
        todo.append((tag, src, dst))
    if todo and not ffmpeg:
        todo = []
        print("ffmpeg not found; skipping thumbnails (pages fall back to the full images)")
    if not todo:
        if versioned:
            save_manifest(manifest_path, manifest)
        print(f"thumbnails already up to date; versioned {versioned}")
        return 0

    t0 = time.time()
    done = 0
    with ThreadPoolExecutor(max_workers=max(2, (os.cpu_count() or 4) // 2)) as pool:
        for (tag, _src, _dst), ok in zip(todo, pool.map(lambda job: make_one(ffmpeg, job[1], job[2]), todo)):
            if ok:
                manifest[tag]["thumb"] = True
                done += 1
    save_manifest(manifest_path, manifest)
    print(f"thumbnails: {done}/{len(todo)} in {time.time() - t0:.0f}s")
    return 0 if done == len(todo) else 1


if __name__ == "__main__":
    raise SystemExit(main())
