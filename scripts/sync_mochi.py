#!/usr/bin/env python3
"""把墨池（web6）同步到獨立開源的 danbooru_tag_mochi。

    python scripts/sync_mochi.py              # 同步到 ../danbooru_tag_mochi
    python scripts/sync_mochi.py --check      # 只列出會變的檔，不寫
    python scripts/sync_mochi.py --to D:\\x    # 別的位置

開源版的結構：本專案的 web6/ 和它用到的 web/ 共用檔合成一個 web/（伺服器本來就是先找
WEB_DIR、找不到再找 web，所以路徑一個都不用改）。用到哪些 web/ 檔不是寫死的清單：每次從
web6/*.html 沿著 <script>/<link>、import、CSS url() 和字串裡的本機檔名一路追。

搬過去之後再換掉開源版不一樣的幾處（啟動檔叫 start.bat、預設埠 8796、卡面從自己的 Release
下載、影片裡的 clone 網址）。換不到的會印 WARN：多半是這邊改了那幾行，要來改 REWRITES。

不碰開源版自己的檔：README.md、CLAUDE.md、start.bat、start.sh、.gitignore、.gitattributes、
LICENSE。也不 commit：同步完到那邊跑測試、看 git diff 再自己 commit。
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
W6 = ROOT / "web6"
WEB = ROOT / "web"

# 伺服器與它 import 的模組（根目錄）。
ROOT_FILES = ["server.py", "card_usage.py", "card_decks.py", "gen_log.py", "lora_scan.py", "recipes.py", "workflows.py", "config.example.json"]
# 啟動檔與伺服器會叫到的腳本（卡面下載與烘焙、放大模型、姿勢參考、ComfyUI 的 LoRA Manager）。
SCRIPT_FILES = [
    "app_config.py", "bake_card_art.py", "card_thumbnails.py", "fetch_card_art.py", "fetch_pose_assets.py",
    "fetch_upscale_model.py", "card_art.mjs", "card_jobs.json", "card-art-check.bat", "bake-cards-window.bat",
    "fetch-cards-window.bat", "upscale-model-check.bat", "fetch-upscale-window.bat", "pose-assets-check.bat",
    "fetch-pose-window.bat", "fetch_lora_manager.py", "lora-manager-check.bat", "fetch-lora-manager-window.bat",
]
# 開源版自己的檔：不覆蓋、也不當成「上游已刪」清掉。
MOCHI_OWN = {"README.md", "CLAUDE.md", "start.bat", "start.sh", ".gitignore", ".gitattributes", "LICENSE"}
# three.js 的授權跟著 build 一起帶。
EXTRA_WEB = ["vendor/three/LICENSE"]

# (開源版的路徑, 原字串, 換成) —— 原字串找不到就印 WARN。
REWRITES = [
    *[(f"web/{f}", "start-web6.bat", "start.bat") for f in ("album.js", "app.js", "book.js", "fuse.js", "film.js", "locales/en.js")],
    ("web/locales/en.js", "Start or restart the web6 server.", "Start or restart the server."),
    ("web/i18n.js", "Changes apply to all web6 pages.", "Changes apply to every page."),
    ("web/i18n.js", "切換會套用到 web6 所有頁面。", "切換會套用到所有頁面。"),
    ("web/language.js", "every web6 route", "every page"),
    ("web/locale.css", "UI changes are scoped to web6 and to the active document language.", "UI changes are scoped to the active document language."),
    ("web/film.js", '"git clone https://github.com/bosen12/danbooru_tag_random"', '"git clone https://github.com/bosen12/danbooru_tag_mochi"'),
    ("web/film.js", '"GitHub · danbooru_tag_random"', '"GitHub · danbooru_tag_mochi"'),
    ("server.py", 'port = int(cfg("server.port", "PORT", 8787))', 'port = int(cfg("server.port", "PORT", 8796))'),
    ("server.py", '"DanbooruTagRandom (https://github.com/bosen12/danbooru_tag_random, 1.0)"', '"DanbooruTagMochi (https://github.com/bosen12/danbooru_tag_mochi, 1.0)"'),
    ("config.example.json", '"port": 8787,', '"port": 8796,'),
    ("scripts/fetch_card_art.py", "github.com/bosen12/danbooru_tag_random/releases/download/", "github.com/bosen12/danbooru_tag_mochi/releases/download/"),
    ("scripts/card-art-check.bat", "(start.bat, start-web6.bat, start-zipu.bat)", "(start.bat)"),
    ("scripts/pose-assets-check.bat", "called by start-web6.bat and start-web7.bat.", "called by start.bat."),
    ("scripts/upscale-model-check.bat", "called by start-web6.bat and start-test.bat.", "called by start.bat."),
    ("tests/test_i18n.mjs", "'web6/language.js'", "'web/language.js'"),
    ("tests/test_i18n.mjs", "'web6 must provide", "'web must provide"),
    ("tests/test_i18n.mjs", "'web6/i18n.js'", "'web/i18n.js'"),
    ("tests/test_i18n.mjs", "console.log('web6 language", "console.log('language"),
]

LOCAL_EXT = r"js|mjs|css|json|html|svg|png|webp|woff2|wasm|bin|glb|jpg|mp3|ogg|wav"
TEXT_EXT = {".js", ".mjs", ".css", ".json", ".html", ".svg", ".py", ".bat", ".md", ".txt"}


def tracked(prefix: str) -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z", prefix], cwd=ROOT, capture_output=True, check=True).stdout
    return [p for p in out.decode("utf-8").split("\0") if p]


def shared_web_files() -> list[str]:
    """web6 頁面實際載入、web6 裡沒有而由 web/ 補上的檔（相對 web/ 的路徑）。"""
    def locate(served: str) -> Path | None:
        served = served.lstrip("/").split("?")[0].split("#")[0]
        for base in (W6, WEB):
            p = (base / served).resolve()
            if served and p.is_file() and (p.is_relative_to(W6) or p.is_relative_to(WEB)):
                return p
        return None

    def served_of(p: Path) -> str:
        return (p.relative_to(W6) if p.is_relative_to(W6) else p.relative_to(WEB)).as_posix()

    queue = sorted(W6.glob("*.html"))
    seen = set(queue)
    while queue:
        f = queue.pop()
        if f.suffix not in (".html", ".js", ".mjs", ".css"):
            continue
        src = f.read_text(encoding="utf-8", errors="replace")
        specs = set()
        if f.suffix == ".html":
            specs |= set(re.findall(r"""(?:src|href)=["']([^"']+)["']""", src))
        if f.suffix in (".html", ".js", ".mjs"):
            specs |= set(re.findall(r"""(?:import|export)[^"'`;]*?from\s*["']([^"']+)["']""", src))
            specs |= set(re.findall(r"""import\s*\(\s*["']([^"']+)["']\s*\)""", src))
            specs |= set(re.findall(r"""import\s+["']([^"']+)["']""", src))
            specs |= set(re.findall(rf"""["'`](\.{{0,2}}/?[\w./-]+\.(?:{LOCAL_EXT}))["'`]""", src))
        if f.suffix == ".css":
            specs |= set(re.findall(r"""url\(\s*["']?([^"')]+)["']?\s*\)""", src))
        base = Path(served_of(f)).parent.as_posix()
        for spec in specs:
            if re.match(r"(https?:|data:|blob:|#|mailto:|javascript:)", spec) or spec.startswith("/api/") or re.search(r"[${}]", spec):
                continue
            served = spec if spec.startswith("/") else str(Path(base, spec).as_posix())
            served = re.sub(r"(^|/)\./", r"\1", served)
            while "/../" in served or served.startswith("../"):
                served = re.sub(r"[^/]+/\.\./", "", served, count=1) if "/../" in served else served[3:]
            p = locate(served)
            if p and p not in seen:
                seen.add(p)
                queue.append(p)
    # web/cards/ 是下載或自己烘的卡面（不進版控），不同步。
    return sorted({r for p in seen if p.is_relative_to(WEB) for r in [p.relative_to(WEB).as_posix()] if not r.startswith("cards/")} | set(EXTRA_WEB))


def plan() -> dict[str, Path]:
    """開源版路徑 → 這邊的來源檔。"""
    files: dict[str, Path] = {}
    for rel in tracked("web6"):
        files["web/" + rel[len("web6/"):]] = ROOT / rel
    for rel in shared_web_files():
        files.setdefault("web/" + rel, WEB / rel)
    for f in ROOT_FILES:
        files[f] = ROOT / f
    for f in SCRIPT_FILES:
        files["scripts/" + f] = ROOT / "scripts" / f
    files["tests/test_i18n.mjs"] = ROOT / "scripts" / "test_web6_i18n.mjs"
    return files


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--to", default=str(ROOT.parent / "danbooru_tag_mochi"))
    ap.add_argument("--check", action="store_true", help="只列出會變的檔，不寫")
    args = ap.parse_args()
    dest = Path(args.to)
    if not (dest / ".git").is_dir():
        print(f"{dest} 不是 git repo（先 clone https://github.com/bosen12/danbooru_tag_mochi）")
        return 2

    files = plan()
    rewrites: dict[str, list[tuple[str, str]]] = {}
    for path, old, new in REWRITES:
        rewrites.setdefault(path, []).append((old, new))

    changed, warns = [], []
    for rel, src in sorted(files.items()):
        if rel in MOCHI_OWN:
            continue
        data = src.read_bytes()
        if Path(rel).suffix in TEXT_EXT:
            # 開源版的 .gitattributes：.bat 是 CRLF（cmd 的 goto 才不會出錯），其他文字檔 LF。
            data = data.replace(b"\r\n", b"\n")
            if rel.endswith(".bat"):
                data = data.replace(b"\n", b"\r\n")
        if rel in rewrites:
            text = data.decode("utf-8")
            for old, new in rewrites[rel]:
                if old in text:
                    text = text.replace(old, new)
                elif new not in text:
                    warns.append(f"WARN {rel}: 找不到要換的「{old}」")
            data = text.encode("utf-8")
        out = dest / rel
        have = out.read_bytes() if out.is_file() else None
        if have is not None and Path(rel).suffix in TEXT_EXT and not rel.endswith(".bat"):
            have = have.replace(b"\r\n", b"\n")  # 工作目錄可能是 CRLF：git 看起來一樣就不算變
        if have != data:
            changed.append(rel)
            if not args.check:
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(data)

    # 上游刪掉的：開源版 web/ 底下有、這次計畫裡沒有的（卡面圖不算）。
    stale = sorted(
        p.relative_to(dest).as_posix()
        for p in (dest / "web").rglob("*")
        if p.is_file() and not p.relative_to(dest / "web").as_posix().startswith("cards/") and p.relative_to(dest).as_posix() not in files
    )
    for rel in stale:
        if not args.check:
            (dest / rel).unlink()

    verb = "會更新" if args.check else "更新"
    print(f"{verb} {len(changed)} 個檔" + ("：" if changed else ""))
    for rel in changed:
        print("  " + rel)
    if stale:
        print(f"{'會刪掉' if args.check else '刪掉'}上游已經沒有的 {len(stale)} 個檔：")
        for rel in stale:
            print("  " + rel)
    for w in warns:
        print(w)
    if changed or stale:
        print(f"\n下一步：cd {dest} → node tests/test_i18n.mjs → git diff → commit、push")
    return 1 if warns else 0


if __name__ == "__main__":
    sys.exit(main())
