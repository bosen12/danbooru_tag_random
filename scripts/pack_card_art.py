"""把全年齡的卡面插畫打包成 GitHub Release 用的兩個 zip（fetch_card_art.py 下載的就是這兩包）。

    python scripts/pack_card_art.py OUT_DIR [--previous 上一版的縮圖包或單一包.zip]

在 OUT_DIR 寫 card-art-thumbs.zip（cards/thumb/<檔名>、cards/manifest.json、cards/previous.json）
和 card-art-full.zip（cards/<檔名>）。縮圖包先下載：約 30 MB，字盒馬上有圖；原圖包背景接著抓（v7 起）。
只收 manifest 裡分級是全年齡、而且圖真的在的卡；敏感、色情分級的一律不放。

--previous：上一版公開的那一包（v6 以前的單一包、v7 以後的縮圖包都行，要的是裡面的 manifest）。會把它每一張卡當時的提示詞記進 cards/previous.json，
下載端用它判斷「這張是上一版公開包放的、使用者沒自己重烘過」，才用新版蓋過去
（重畫過的卡，例如 v1 貼地仰視腳邊有蟲，v2 重烘了）。自己烘的卡一張都不會被蓋。

給了 --previous 還會多打一包 card-art-update.zip（v13 起）：只放比上一版新增或重畫的卡（縮圖、原圖、它們的 manifest）。
已經有上一版的人只抓這一包；v11 升 v12 整包重抓 318 MB，只抓新的是 131 MB。

打包前先跑 scan_card_art.py：有整張空白的卡（v12 的融合畫面、未戴單眼罩就是這樣發出去的）就不打包，
真的要發加 --allow-blank。掃描要 Pillow；其餘只用標準函式庫。

印出張數、各包的大小、SHA-256，貼進 fetch_card_art.py 的 THUMBS、FULL、UPDATE、EXPECTED（BASE 換成新的 tag）。
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
    # 底線本身被改掉（例如換成亂碼）也不打包：公開包絕不能放進這些字。
    need = {
        "loli",
        "shota",
        "aged down",
        "onee-shota",
        "oppai loli",
        "baby",
        "kodomo doushi",
        "toddlercon",
        "toddlersex",
        "mother and child",
        "father and child",
        "carrying baby",
        "kindergarten uniform",
        "tomoeda elementary school uniform",
        "tokyo-3 middle school uniform",
        "mitakihara school uniform",
        "tokiwadai school uniform",
        "nanamori school uniform",
        "sakugawa school uniform",
        "nanairogaoka middle school uniform",
        "raimon",
        "pacifier",
        "diaper",
        "bib",
        "onesie",
        "training bra",
        "age progression",
        "age comparison",
        "parent and child",
        "father and son",
        "children",
        "child carry",
        "child",
    }
    if not need <= banned:
        raise SystemExit("HARD_BANNED 少了 " + "、".join(sorted(need - banned)) + "，不打包")
    return banned


def main() -> int:
    args = sys.argv[1:]
    allow_blank = "--allow-blank" in args
    args = [a for a in args if a != "--allow-blank"]
    previous = None
    if "--previous" in args:
        i = args.index("--previous")
        previous = Path(args[i + 1])
        del args[i : i + 2]
    if len(args) != 1:
        print(__doc__)
        return 2
    out_dir = Path(args[0])
    if out_dir.suffix == ".zip":
        print("v7 起打成兩包：給一個資料夾，不是 .zip 檔名")
        return 2
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
    try:
        import scan_card_art

        blank = scan_card_art.scan(manifest, general.keys())
    except ImportError:
        blank = None
    if blank is None:
        print("沒裝 Pillow，掃不了空白的卡：pip install pillow（真的要打包加 --allow-blank）")
        if not allow_blank:
            return 1
    elif blank:
        for tag, ink, std in blank:
            print(f"blank  {tag}  (ink {ink:.4f}, std {std:.1f})")
        print(f"{len(blank)} 張整張空白：改 web/card-art.js 的提示詞重烤（真的要照發加 --allow-blank）")
        if not allow_blank:
            return 1
    history = {}
    old = {}
    if previous:
        with zipfile.ZipFile(previous) as z:
            old = json.loads(z.read("cards/manifest.json").decode("utf-8"))
        history = {k: v.get("positive", "") for k, v in old.items() if isinstance(v, dict)}
    out_dir.mkdir(parents=True, exist_ok=True)
    thumbs_zip, full_zip, update_zip = out_dir / "card-art-thumbs.zip", out_dir / "card-art-full.zip", out_dir / "card-art-update.zip"
    # 比上一版新增或重畫的：增量包只放這些。
    delta = sorted(k for k, v in general.items() if k not in history or history[k] != v.get("positive", "")) if previous else []
    # 固定時間戳與順序：同一批圖打出來的包每次都一樣，雜湊才對得起來。
    stamp = (2026, 1, 1, 0, 0, 0)

    def put(z: zipfile.ZipFile, name: str, data: bytes) -> None:
        z.writestr(zipfile.ZipInfo(name, date_time=stamp), data)

    def put_json(z: zipfile.ZipFile, name: str, obj: dict) -> None:
        put(z, name, json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True).encode("utf-8"))

    with zipfile.ZipFile(thumbs_zip, "w", compression=zipfile.ZIP_STORED) as zt, zipfile.ZipFile(full_zip, "w", compression=zipfile.ZIP_STORED) as zf:
        for key in sorted(general):
            f = str(general[key]["file"])
            for rel, z in ((f, zf), (f"thumb/{f}", zt)):
                src = CARDS / rel
                if src.exists():
                    put(z, f"cards/{rel}", src.read_bytes())
        put_json(zt, "cards/manifest.json", general)
        if history:
            put_json(zt, "cards/previous.json", history)
    if delta:
        # 縮圖在前、原圖在後：解的時候字盒先有縮圖。manifest 只放這幾張，previous.json 只放其中重畫的。
        with zipfile.ZipFile(update_zip, "w", compression=zipfile.ZIP_STORED) as zu:
            for prefix in ("thumb/", ""):
                for key in delta:
                    rel = prefix + str(general[key]["file"])
                    if (CARDS / rel).exists():
                        put(zu, f"cards/{rel}", (CARDS / rel).read_bytes())
            put_json(zu, "cards/manifest.json", {k: general[k] for k in delta})
            redrawn = {k: history[k] for k in delta if k in history}
            if redrawn:
                put_json(zu, "cards/previous.json", redrawn)
    else:
        update_zip.unlink(missing_ok=True)
    # 包裡有哪些卡、各是哪一版提示詞：fetch_card_art.py 用它判斷「缺的那些包裡補得到嗎」，
    # 補不到（詞庫比包新）就不下載，直接交給烘焙。跟 URL、SIZE、SHA256 一起 commit。
    listing = {k: v.get("positive", "") for k, v in sorted(general.items())}
    (ROOT / "scripts" / "card_art_pack.json").write_text(json.dumps(listing, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("list    scripts/card_art_pack.json")
    print(f"cards   {len(general)}")
    for z in (thumbs_zip, full_zip, update_zip):
        if z.exists():
            print(f"{z.name:20s} size {z.stat().st_size}  sha256 {hashlib.sha256(z.read_bytes()).hexdigest()}")
    if history:
        changed = sum(1 for k, v in general.items() if k in history and history[k] != v.get("positive", ""))
        print(f"redrawn since previous: {changed}")
        print(f"update pack: {len(delta)} cards (new {len(delta) - changed}, redrawn {changed})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
