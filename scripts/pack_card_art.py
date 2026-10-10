"""把全年齡的卡面插畫打包成 GitHub Release 用的 zip（fetch_card_art.py 下載的就是這一包）。

    python scripts/pack_card_art.py OUT.zip [--previous 舊一包.zip]

只收 manifest 裡分級是全年齡、而且圖真的在的卡；敏感、色情分級的一律不放。
zip 裡的樣子跟 fetch_card_art.py 解的一樣：cards/<檔名>、cards/thumb/<檔名>、cards/manifest.json。

--previous：上一版公開的那一包。會把它每一張卡當時的提示詞記進 cards/previous.json，
下載端用它判斷「這張是上一版公開包放的、使用者沒自己重烘過」，才用新版蓋過去
（重畫過的卡，例如 v1 貼地仰視腳邊有蟲，v2 重烘了）。自己烘的卡一張都不會被蓋。

印出張數、大小、SHA-256，貼進 fetch_card_art.py 的 SIZE、SHA256、EXPECTED。只用標準函式庫。
"""
from __future__ import annotations

import hashlib
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CARDS = ROOT / "web" / "cards"


def hard_banned() -> set[str]:
    """web/card-art.js 的 HARD_BANNED（看起來未成年的字）。讀不到就不打包，不猜。"""
    import re

    # 公開包照「已經 commit 的規則」打：工作區裡還沒 commit 的改動不算數。
    # 讀不到 git（不是從 repo 跑）才退回工作區那份。
    import subprocess

    try:
        src = subprocess.run(
            ["git", "show", "HEAD:web/card-art.js"], cwd=ROOT, capture_output=True, check=True
        ).stdout.decode("utf-8")
    except (OSError, subprocess.CalledProcessError):
        src = (ROOT / "web" / "card-art.js").read_text(encoding="utf-8")
    m = re.search(r"HARD_BANNED\s*=\s*Object\.freeze\(\[([^\]]*)\]\)", src)
    if not m:
        raise SystemExit("找不到 web/card-art.js 的 HARD_BANNED，不打包")
    banned = set(re.findall(r'"([^"]+)"', m.group(1)))
    # 底線本身被改掉（例如換成亂碼）也不打包：公開包絕不能放進這兩張。
    if not {"loli", "shota"} <= banned:
        raise SystemExit("HARD_BANNED 少了 loli／shota，不打包")
    return banned


def main() -> int:
    args = sys.argv[1:]
    previous = None
    if "--previous" in args:
        i = args.index("--previous")
        previous = Path(args[i + 1])
        del args[i : i + 2]
    if len(args) != 1:
        print(__doc__)
        return 2
    out = Path(args[0])
    manifest = json.loads((CARDS / "manifest.json").read_text(encoding="utf-8"))
    banned = hard_banned()
    # 只收現在詞庫裡還有的牌（scripts/card_jobs.json）：拿掉的字本機可能還留著舊圖，不要再發出去。
    try:
        listed = [j for j in json.loads((ROOT / "scripts" / "card_jobs.json").read_text(encoding="utf-8")) if isinstance(j, dict)]
        current = {j.get("tag") for j in listed}
        characters = {j.get("tag") for j in listed if j.get("kind") == "character"}
    except (OSError, ValueError):
        current = None
        characters = set()
    # 細縮圖（mini）不放進包：那是這台照自己的圖做的，下載的人沒有那些檔，留著只會讓網頁先抓一次 404 才退回原圖。
    general = {
        k: {kk: vv for kk, vv in v.items() if kk != "mini"}
        for k, v in manifest.items()
        if isinstance(v, dict)
        and k not in banned
        # 角色牌是版權角色：不公開，每台自己烘（專案主 2026-10-10）。
        and k not in characters
        and v.get("kind") != "character"
        and (current is None or k in current)
        and v.get("rating", "general") == "general"
        and (CARDS / str(v.get("file", ""))).exists()
    }
    history = {}
    if previous:
        with zipfile.ZipFile(previous) as z:
            old = json.loads(z.read("cards/manifest.json").decode("utf-8"))
        history = {k: v.get("positive", "") for k, v in old.items() if isinstance(v, dict)}
    out.parent.mkdir(parents=True, exist_ok=True)
    # 固定時間戳與順序：同一批圖打出來的包每次都一樣，雜湊才對得起來。
    stamp = (2026, 1, 1, 0, 0, 0)
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_STORED) as z:
        for key in sorted(general):
            f = str(general[key]["file"])
            for rel in (f, f"thumb/{f}"):
                src = CARDS / rel
                if src.exists():
                    info = zipfile.ZipInfo(f"cards/{rel}", date_time=stamp)
                    z.writestr(info, src.read_bytes())
        z.writestr(zipfile.ZipInfo("cards/manifest.json", date_time=stamp), json.dumps(general, ensure_ascii=False, indent=1, sort_keys=True))
        if history:
            z.writestr(zipfile.ZipInfo("cards/previous.json", date_time=stamp), json.dumps(history, ensure_ascii=False, indent=1, sort_keys=True))
    h = hashlib.sha256(out.read_bytes()).hexdigest()
    print(f"cards   {len(general)}")
    print(f"size    {out.stat().st_size}")
    print(f"sha256  {h}")
    if history:
        changed = sum(1 for k, v in general.items() if k in history and history[k] != v.get("positive", ""))
        print(f"redrawn since previous: {changed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
