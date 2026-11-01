"""掃出畫壞的卡面：整張幾乎是空白、或只有一條線（v12 卡面包的融合畫面、未戴單眼罩、細繩都是這樣發出去的）。

    python scripts/scan_card_art.py                  # 掃 web/cards 裡全部烤好的卡
    python scripts/scan_card_art.py --general        # 只掃會放進公開包的全年齡卡
    python scripts/scan_card_art.py --only a,b       # 只掃這幾張（tag）

看的是縮圖（cards/thumb/，沒有就看原圖）：取四邊的中位數當背景色，跟背景差超過 24 的像素算「有畫東西」。
有畫東西的不到 0.5%，或不到 1% 而且整張亮度幾乎沒有起伏（標準差 < 10），就算空白。
2026-11-02 量全部 10591 張：空白的四張落在 0～0.0082；最空的正常牌（箭頭符號、一串小旗子）在 0.009 以上、標準差 > 8.8。

名字是好幾個人、提示詞卻寫 solo 的牌，scripts/test_card_art.mjs 從提示詞就擋得住，不用看圖。

退出碼：0 沒有空白的卡、1 有（列出來）、2 沒裝 Pillow。pack_card_art.py 打包前會跑 --general，有空白的就不打包。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CARDS = ROOT / "web" / "cards"
INK = 24
BLANK = 0.005
FAINT = 0.01
FLAT = 10.0


def measure(path: Path) -> tuple[float, float]:
    """（有畫東西的比例, 亮度標準差）。"""
    from PIL import Image, ImageStat

    with Image.open(path) as im:
        g = im.convert("L")
        if g.width > 320:
            g = g.resize((200, round(200 * g.height / g.width)))
    w, h = g.size
    px = g.load()
    edge = [px[x, 0] for x in range(w)] + [px[x, h - 1] for x in range(w)] + [px[0, y] for y in range(h)] + [px[w - 1, y] for y in range(h)]
    edge.sort()
    bg = edge[len(edge) // 2]
    hist = g.histogram()
    ink = sum(n for v, n in enumerate(hist) if abs(v - bg) > INK) / (w * h)
    return ink, ImageStat.Stat(g).stddev[0]


def is_blank(ink: float, std: float) -> bool:
    return ink < BLANK or (ink < FAINT and std < FLAT)


def scan(manifest: dict, keys=None, cards: Path = CARDS) -> list[tuple[str, float, float]]:
    """回傳空白的卡：[(tag, 有畫東西的比例, 標準差)]。"""
    bad = []
    for tag in sorted(keys if keys is not None else manifest):
        rec = manifest.get(tag)
        if not isinstance(rec, dict) or not rec.get("file"):
            continue
        path = cards / "thumb" / str(rec["file"])
        if not path.exists():
            path = cards / str(rec["file"])
        if not path.exists():
            continue
        ink, std = measure(path)
        if is_blank(ink, std):
            bad.append((tag, ink, std))
    return bad


def main() -> int:
    try:
        import PIL  # noqa: F401
    except ImportError:
        print("scan_card_art needs Pillow: pip install pillow")
        return 2
    args = sys.argv[1:]
    manifest = json.loads((CARDS / "manifest.json").read_text(encoding="utf-8"))
    keys = None
    if "--only" in args:
        keys = [s.strip() for s in args[args.index("--only") + 1].split(",") if s.strip()]
    elif "--general" in args:
        keys = [k for k, v in manifest.items() if isinstance(v, dict) and v.get("rating", "general") == "general" and v.get("kind") != "character"]
    bad = scan(manifest, keys)
    for tag, ink, std in bad:
        print(f"blank  {tag}  (ink {ink:.4f}, std {std:.1f})")
    print(f"scanned {len(keys) if keys is not None else len(manifest)}, blank {len(bad)}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
