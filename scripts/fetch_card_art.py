"""卡面插畫：沒有就從 GitHub Release 下載（全年齡那一包），啟動檔會先叫這支。

    python scripts/fetch_card_art.py            # 缺圖才下載；已經有就什麼都不做
    python scripts/fetch_card_art.py --force    # 不管有沒有都再下載一次（一樣不覆蓋已經有的圖）
    python scripts/fetch_card_art.py --check    # 只看要不要下載：0 夠了、3 缺

插畫是用 ComfyUI 烘焙出來的（scripts/bake_card_art.py），不進 git（一包 50MB 以上，每次重烘都會讓歷史變大）。
git clone 下來的人第一次開墨池、疊印台、排字匣的卡牌模式時，這支把全年齡的那一包抓下來：
驗大小和 SHA-256、解壓到 web/cards/。已經有的圖（自己烘的）一張都不覆蓋，manifest 只補沒有的條目。
唯一的例外：上一版公開包放的、之後重畫過的卡（包裡的 cards/previous.json 記著上一版的提示詞），
本機那張的提示詞跟上一版一模一樣時才換成新的 —— 那張是公開包放的、沒被自己重烘過。
打包用 scripts/pack_card_art.py。
敏感、色情分級的卡面不公開，要的話用自己的 ComfyUI 烘：python scripts/bake_card_art.py

退出碼：0 好了（或本來就有）、1 下載失敗（沒網路、GitHub 連不上）、2 檔案對不上（大小或雜湊錯）、3 缺圖（--check）。
輸出只用英文：cmd 的主控台字碼頁不是 UTF-8，中文會變亂碼。設 NO_CARD_FETCH=1 可以整個跳過。
只用標準函式庫。
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CARDS = ROOT / "web" / "cards"
# 換版時標記跟著換：有 v1 標記、沒有 v2 標記的人，下次啟動會去補 v2 多的那些。
MARKER = CARDS / ".card-art-v2"

# v2（2026-09-28）：1161 張，比 v1 多 49 張新卡，另外 crowd、witch 兩張重畫。v1 留在 GitHub 給舊版本用。
# CARD_ART_URL 可以換來源（測試時指向本機的 file:// 包）；大小、雜湊照樣要對。
URL = os.environ.get("CARD_ART_URL") or "https://github.com/bosen12/danbooru_tag_random/releases/download/card-art-v2/card-art-general.zip"
SIZE = 55230586
SHA256 = "27dd32e4844719822a0c00c210a14a87abcb821b1597a59d2a100c82d2681f2c"
EXPECTED = 1161  # 這一包裡全年齡的張數


def have_enough() -> bool:
    """這一包已經解過，或 manifest 裡全年齡、圖也在的已經夠了（自己烘好的也算）。"""
    if MARKER.exists():
        return True
    try:
        manifest = json.loads((CARDS / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    ready = sum(
        1
        for v in manifest.values()
        if isinstance(v, dict) and v.get("rating", "general") == "general" and (CARDS / str(v.get("file", ""))).exists()
    )
    return ready >= EXPECTED


def download(dest: Path) -> None:
    last: Exception | None = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(URL, headers={"User-Agent": "danbooru-tag-random/card-art"})
            with urllib.request.urlopen(req, timeout=60) as r, dest.open("wb") as f:
                total = int(r.headers.get("Content-Length") or SIZE)
                got = 0
                shown = -1
                t0 = time.time()
                while True:
                    chunk = r.read(1 << 16)
                    if not chunk:
                        break
                    f.write(chunk)
                    got += len(chunk)
                    pct = got * 100 // max(1, total)
                    if pct // 10 != shown:
                        shown = pct // 10
                        speed = got / max(0.1, time.time() - t0) / 1e6
                        print(f"  {pct:3d}%  {got / 1e6:5.1f}/{total / 1e6:.1f} MB  {speed:.1f} MB/s", flush=True)
            # 連線提早關掉時 read() 會回空字串，不會丟例外。短檔若直接當成功，
            # 後面的大小檢查失敗就結束，三次重試根本不會跑。
            if got != SIZE:
                raise OSError(f"incomplete download ({got} bytes, want {SIZE})")
            return
        except (urllib.error.URLError, OSError, TimeoutError) as err:
            last = err
            print(f"  download failed ({err}); retrying...", flush=True)
            time.sleep(2 + attempt * 3)
    raise last or RuntimeError("download failed")


def verify(path: Path) -> bool:
    if path.stat().st_size != SIZE:
        print(f"  size mismatch: {path.stat().st_size} != {SIZE}")
        return False
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    if h.hexdigest() != SHA256:
        print("  sha256 mismatch")
        return False
    return True


def unpack(path: Path) -> tuple[int, int]:
    """解到 web/cards/：只放沒有的檔；manifest 只補沒有的條目。回傳（新放的圖、補的條目）。"""
    CARDS.mkdir(parents=True, exist_ok=True)
    added = 0
    mpath = CARDS / "manifest.json"
    try:
        manifest = json.loads(mpath.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict):
            manifest = {}
    except (OSError, ValueError):
        manifest = {}
    with zipfile.ZipFile(path) as z:
        incoming = json.loads(z.read("cards/manifest.json").decode("utf-8"))
        try:
            previous = json.loads(z.read("cards/previous.json").decode("utf-8"))
        except KeyError:
            previous = {}
        # 可以換新的：上一版公開包放的（本機提示詞 = 上一版的），而且這一版重畫了。
        upgrade = {
            k
            for k, v in incoming.items()
            if k in previous
            and isinstance(manifest.get(k), dict)
            and manifest[k].get("positive") == previous[k]
            and v.get("positive") != previous[k]
        }
        replace_files = set()
        for k in upgrade:
            f = str(incoming[k].get("file", ""))
            replace_files.update({f, f"thumb/{f}"})
        for name in z.namelist():
            if not name.startswith("cards/") or name.endswith("/") or name in ("cards/manifest.json", "cards/previous.json"):
                continue
            rel = name[len("cards/"):]
            dest = (CARDS / rel).resolve()
            # 壓縮檔裡的路徑不能跑出 web/cards/（zip slip）。
            if not dest.is_relative_to(CARDS.resolve()):
                continue
            if dest.exists() and rel not in replace_files:
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp = dest.with_suffix(dest.suffix + ".part")
            tmp.write_bytes(z.read(name))
            os.replace(tmp, dest)
            added += 1
    fresh = {k: v for k, v in incoming.items() if k not in manifest or k in upgrade}
    if fresh:
        manifest.update(fresh)
        tmp = mpath.with_suffix(".json.part")
        tmp.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, mpath)
    return added, len(fresh)


def main() -> int:
    if os.environ.get("NO_CARD_FETCH"):
        return 0
    force = "--force" in sys.argv
    if "--check" in sys.argv:
        # 啟動檔用：只看要不要下載，不下載。0 夠了、3 缺（啟動檔另開一個視窗去抓，網頁不用等）。
        return 0 if have_enough() else 3
    if not force and have_enough():
        return 0
    print("Card illustrations are missing. Downloading the all-ages set (about 55 MB) from GitHub...")
    with tempfile.TemporaryDirectory() as tmpdir:
        zpath = Path(tmpdir) / "card-art.zip"
        try:
            download(zpath)
        except Exception as err:  # noqa: BLE001 —— 沒網路就退回佔位牌，不要讓啟動檔停下來
            print(f"Could not download card art ({err}). Cards show a placeholder glyph for now.")
            return 1
        if not verify(zpath):
            print("The downloaded file does not match. Not unpacking it; cards show a placeholder glyph for now.")
            return 2
        added, entries = unpack(zpath)
    MARKER.write_text(URL + "\n", encoding="utf-8")
    print(f"Card art ready: {added} images added, {entries} manifest entries added (existing files kept).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
