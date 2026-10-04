#!/usr/bin/env python3
"""墨池細縮圖（card_thumbnails.py、make_card_thumbs.py --mini-only）。只用暫存目錄，不碰 web/cards。
要 ffmpeg／ffprobe；沒有就跳過（回 0）。"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import card_thumbnails as ct  # noqa: E402

failed = 0


def ok(name: str, cond: bool, detail: str = "") -> None:
    global failed
    if not cond:
        failed += 1
        print(f"FAIL {name}" + (f"\n  {detail}" if detail else ""))
    else:
        print(f"ok   {name}")


def sha(p: Path) -> str:
    return hashlib.sha1(p.read_bytes()).hexdigest()


def make_card(ffmpeg: str, dst: Path, hue: int) -> None:
    """480×702 的假牌：漸層加細線，夠讓縮圖有內容。"""
    subprocess.run(
        [ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=s=480x702:d=1,hue=h={hue}", "-frames:v", "1",
         "-c:v", "libwebp", "-quality", "80", str(dst)],
        check=True,
    )


def run_cli(card_dir: Path, *args: str) -> subprocess.CompletedProcess:
    """跑 make_card_thumbs.py，但 CARD_DIR 換成暫存目錄（不 import server 以外的東西也不碰真的卡）。"""
    code = (
        "import sys, runpy; sys.argv=['make_card_thumbs.py', *sys.argv[1:]];"
        f"sys.path.insert(0, r'{ROOT / 'scripts'}');"
        "import bake_card_art; from pathlib import Path;"
        f"bake_card_art.CARD_DIR = Path(r'{card_dir}');"
        f"runpy.run_path(r'{ROOT / 'scripts' / 'make_card_thumbs.py'}', run_name='__main__')"
    )
    return subprocess.run([sys.executable, "-c", code, *args], capture_output=True, text=True, encoding="utf-8")


def main() -> int:
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        print("skip: ffmpeg/ffprobe not found")
        return 0

    ok("牌階都是遞增、比原圖小", list(ct.MINI_WIDTHS) == sorted(ct.MINI_WIDTHS) and ct.MINI_WIDTHS[-1] < ct.SRC_W)
    ok("長寬比都跟原圖一模一樣（高是整數）", all(w * ct.SRC_H % ct.SRC_W == 0 for w in ct.MINI_WIDTHS))

    with tempfile.TemporaryDirectory() as tmp:
        cards = Path(tmp) / "cards"
        (cards / "thumb").mkdir(parents=True)
        make_card(ffmpeg, cards / "a_b.webp", 0)
        make_card(ffmpeg, cards / "c.webp", 120)
        shutil.copy(cards / "c.webp", cards / "thumb" / "c.webp")
        v = {n: hashlib.sha1((cards / n).read_bytes()).hexdigest()[:10] for n in ("a_b.webp", "c.webp")}
        manifest = {
            "a b": {"file": "a_b.webp", "seed": 1, "thumb": False, "v": v["a_b.webp"]},
            "c": {"file": "c.webp", "seed": 1, "thumb": True, "v": v["c.webp"]},
        }
        (cards / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        before = {p.name: sha(p) for p in [cards / "a_b.webp", cards / "c.webp", cards / "thumb" / "c.webp"]}

        # 直接呼叫：尺寸、內容雜湊檔名、原圖不動
        entry = ct.build_entry(ffmpeg, ffprobe, cards, manifest["a b"])
        ok("build_entry 做出整排", entry is not None and sorted(map(int, entry["w"])) == list(ct.MINI_WIDTHS), str(entry))
        ok("src 是原圖的 v", entry and entry["src"] == v["a_b.webp"])
        sizes = {w: ct.probe_size(ffprobe, cards / "mini" / w / ct.mini_name("a_b.webp", h)) for w, h in (entry or {"w": {}})["w"].items()}
        ok("每張的尺寸對（寬、照比例的高）", all(sizes[str(w)] == (w, ct.mini_height(w)) for w in ct.MINI_WIDTHS), str(sizes))
        ok("檔名帶自己內容的雜湊", all(
            ct.content_hash((cards / "mini" / w / ct.mini_name("a_b.webp", h)).read_bytes()) == h for w, h in entry["w"].items()))
        again = ct.build_entry(ffmpeg, ffprobe, cards, manifest["a b"])
        ok("同一張原圖再做一次，結果一樣（可重跑）", again == entry)
        ok("暫存檔都收乾淨", not list((cards / "mini").rglob("*.tmp")))

        # 動畫 webp：不做
        anim = bytearray(b"RIFF\0\0\0\0WEBPVP8X\x0a\0\0\0\x02\0\0\0")
        ok("認得出動畫 webp", ct.is_animated_webp(bytes(anim)) and not ct.is_animated_webp((cards / "c.webp").read_bytes()))
        (cards / "anim.webp").write_bytes(bytes(anim) + b"\0" * 32)
        ok("動畫 webp 不做（回 None）", ct.build_entry(ffmpeg, ffprobe, cards, {"file": "anim.webp", "v": "0" * 10}) is None)
        ok("壞掉的原圖不做（回 None）", ct.build_entry(ffmpeg, ffprobe, cards, {"file": "nope.webp", "v": "0" * 10}) is None)

        # CLI --mini-only：補齊、寫 manifest、舊欄位一個不動
        r = run_cli(cards, "--mini-only")
        ok("--mini-only 跑完", r.returncode == 0, r.stdout + r.stderr)
        m1 = json.loads((cards / "manifest.json").read_text(encoding="utf-8"))
        ok("兩張都寫進 mini，而且對得上", all(ct.entry_is_current(cards, m1[k]) for k in m1), json.dumps(m1)[:400])
        ok("舊欄位（thumb、v、seed、file）原封不動", all({k: x for k, x in m1[t].items() if k != "mini"} == manifest[t] for t in manifest))
        ok("原圖、舊縮圖一個 byte 都沒變", before == {p.name: sha(p) for p in [cards / "a_b.webp", cards / "c.webp", cards / "thumb" / "c.webp"]})
        ok("剛剛多做的動畫測試檔不留 mini", not list((cards / "mini").rglob("anim-*")))

        r2 = run_cli(cards, "--mini-only")
        ok("再跑一次什麼都不用做", r2.returncode == 0 and "already up to date" in r2.stdout, r2.stdout)
        ok("再跑一次 manifest 不變", json.loads((cards / "manifest.json").read_text(encoding="utf-8")) == m1)

        # 原圖重烤：manifest 的 v 換了，舊 mini 失效，重做之後舊檔清掉
        old_files = sorted(p.name for p in (cards / "mini").rglob("c-*.webp"))
        make_card(ffmpeg, cards / "c.webp", 240)
        m1["c"]["v"] = hashlib.sha1((cards / "c.webp").read_bytes()).hexdigest()[:10]
        (cards / "manifest.json").write_text(json.dumps(m1), encoding="utf-8")
        ok("原圖換了，舊的 mini 算過期", not ct.entry_is_current(cards, m1["c"]))
        r3 = run_cli(cards, "--mini-only")
        m3 = json.loads((cards / "manifest.json").read_text(encoding="utf-8"))
        new_files = sorted(p.name for p in (cards / "mini").rglob("c-*.webp"))
        ok("重做之後是新的 mini、src 跟上", r3.returncode == 0 and ct.entry_is_current(cards, m3["c"]) and m3["c"]["mini"]["src"] == m3["c"]["v"], r3.stdout + r3.stderr)
        ok("舊的 mini 檔清掉、新的換上（網址跟著換）", new_files and not set(old_files) & set(new_files) and len(new_files) == len(ct.MINI_WIDTHS), f"{old_files} {new_files}")
        ok("另一張沒被牽連", m3["a b"]["mini"] == m1["a b"]["mini"])

        # 檔案少一張：算不完整，網頁不用；重跑補回
        h = m3["a b"]["mini"]["w"]["160"]
        (cards / "mini" / "160" / ct.mini_name("a_b.webp", h)).unlink()
        ok("少一張就算不完整", not ct.entry_is_current(cards, m3["a b"]))
        r4 = run_cli(cards, "--mini-only")
        m4 = json.loads((cards / "manifest.json").read_text(encoding="utf-8"))
        ok("重跑補回來", r4.returncode == 0 and ct.entry_is_current(cards, m4["a b"]), r4.stdout + r4.stderr)

        # 有人在烤：什麼都不做
        (cards / ".baking").write_text("1", encoding="utf-8")
        snap = (cards / "manifest.json").read_bytes()
        r5 = run_cli(cards, "--mini-only", "--force")
        ok("烘焙中不動 manifest", r5.returncode == 0 and (cards / "manifest.json").read_bytes() == snap and "bake is running" in r5.stdout, r5.stdout)
        (cards / ".baking").unlink()

        # 做到一半失敗（ffmpeg 編不出來）：manifest 不寫半套
        orig = ct.encode
        calls = {"n": 0}

        def flaky(ffmpeg_, src, dst, w):
            calls["n"] += 1
            return orig(ffmpeg_, src, dst, w) if w != ct.MINI_WIDTHS[-1] else False

        ct.encode = flaky
        try:
            half = ct.build_entry(ffmpeg, ffprobe, cards, m4["c"])
        finally:
            ct.encode = orig
        ok("有一張做不出來就整筆不給（不發佈半套）", half is None and calls["n"] == len(ct.MINI_WIDTHS))
        ok("失敗的暫存檔也收乾淨", not list((cards / "mini").rglob("*.tmp")))

        # 牌階換過（manifest 裡有現在不做的寬）：算過期
        extra = json.loads(json.dumps(m4["a b"]))
        extra["mini"]["w"]["120"] = "0123456789"
        ok("牌階換過就算過期", not ct.entry_is_current(cards, extra))

        # prune 只動 mini/ 底下合規矩的檔名；不在現在牌階裡的舊寬度資料夾也清
        old_w = cards / "mini" / "120"
        old_w.mkdir()
        (old_w / "a_b-0123456789.webp").write_bytes(b"x")
        stray = cards / "mini" / "160" / "keep-me.txt"
        stray.write_text("x", encoding="utf-8")
        orphan = cards / "mini" / "160" / "zzz-0123456789.webp"
        orphan.write_bytes(b"x")
        n = ct.prune(cards, m4)
        ok("prune 清掉沒人指的 mini（含舊寬度）、別的檔不碰", n == 2 and not (old_w / "a_b-0123456789.webp").exists() and not orphan.exists() and stray.exists() and (cards / "thumb" / "c.webp").exists())

    print("all ok" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
