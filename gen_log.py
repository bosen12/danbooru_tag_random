"""出圖日誌（web6／web7 作品冊的「日誌」；牌的戰績、模型成績單也從這裡算）。

JSON Lines（data/gen_log.jsonl），只往後加、不改舊行——壞了一行不會連累整份：
  {"t": "gen", ...}   每次付印做完記一行：印好的、印壞的都記（按停的不記），配方、耗時、哪一頁送的。
  {"t": "mark", ...}  之後的註記：從成品牆單張拿掉（"discard"），按復原就再補一行 null 蓋掉。
讀的時候把 mark 併回那一張，新的在前。

成品牆只留 80 張、沒收藏的過一陣子就找不到了；這份讓「印過什麼」一直查得到。圖不另存
（ComfyUI 的 output 裡本來就有），這裡只記網址。
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOG_PATH = Path(os.environ.get("GEN_LOG_PATH") or ROOT / "data" / "gen_log.jsonl")

MAX_POSITIVE = 12000
MARKS = ("discard",)
PAGE_MAX = 2000

_LOCK = threading.Lock()
_cache: dict = {"key": None, "items": []}


def _path() -> Path:
    # 測試會換掉 LOG_PATH（模組屬性），每次用的時候才讀。
    return Path(LOG_PATH)


def _unescape(positive: str) -> str:
    """送進 Comfy 的提示詞把字裡的括號跳脫過（engine.js 的 escapeForComfy）；記下來的還原成牌的寫法。"""
    return str(positive or "").replace("\\(", "(").replace("\\)", ")")[:MAX_POSITIVE]


def _num(v, cast=float):
    try:
        x = cast(v)
    except (TypeError, ValueError):
        return None
    return x if x == x else None  # NaN


def _loras(raw) -> list[dict]:
    out = []
    for x in raw if isinstance(raw, list) else []:
        # 跟收藏（recipes.py）同一個形狀：從日誌補收藏時直接送過去。
        if isinstance(x, dict):
            file = str(x.get("file") or x.get("name") or "")[:300]
            if file:
                out.append({"folder": str(x.get("folder") or "")[:300], "file": file, "strength": _num(x.get("strength")) or 0})
        elif isinstance(x, str) and x:
            out.append({"folder": "", "file": x[:300], "strength": 1})
    return out[:12]


def entry_of(job_id: str, payload: dict, ok: bool, data: dict, *, origin: str, kind: str, created_at: float, started_at: float | None, finished_at: float) -> dict:
    """一張做完的工作 → 日誌的一行。payload 是 /api/gen 收到的那份，data 是最後那一則（done／error）。"""
    p = payload if isinstance(payload, dict) else {}
    d = data if isinstance(data, dict) else {}
    hires = p.get("hires") if isinstance(p.get("hires"), dict) else None
    e = {
        "t": "gen",
        "id": str(job_id),
        "at": int(finished_at * 1000),
        "ms": max(0, int((finished_at - created_at) * 1000)),
        # 真的在畫的時間（第一格進度到做完）；Comfy 前面排著別人的，ms 會比這個長很多。
        "drawMs": max(0, int((finished_at - started_at) * 1000)) if started_at else None,
        "origin": origin or "",
        "kind": kind,
        "ok": bool(ok),
        "positive": _unescape(p.get("positive")),
        "seed": _num(d.get("seed") if ok and d.get("seed") is not None else p.get("seed"), int),
        "width": _num(d.get("width") or p.get("width"), int),
        "height": _num(d.get("height") or p.get("height"), int),
        # 印好的那則帶著真的用了哪個底模（沒選＝設定檔的預設）。
        "ckpt": str((d.get("ckpt") if ok else None) or p.get("ckpt") or "")[:300],
        "loras": _loras(p.get("loras")),
        "workflowId": str(p.get("workflowId") or "")[:120],
        "rating": str(p.get("rating") or "")[:20],
        "steps": _num(p.get("steps"), int),
        "cfg": _num(p.get("cfg")),
    }
    if ok:
        e["image"] = str(d.get("image") or "")[:2000]
    else:
        e["error"] = str(d.get("error") or "")[:500]
    if hires:
        e["hires"] = {"mode": str(hires.get("mode") or "")[:20], "scale": _num(hires.get("scale")), "from": str(hires.get("image") or "")[:2000]}
    return e


def _append(row: dict) -> None:
    path = _path()
    line = json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
    with _LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(line)


def record(entry: dict) -> None:
    """記一張。寫不進去（磁碟滿、權限）不能讓出圖跟著壞：吞掉。"""
    try:
        _append(entry)
    except OSError:
        pass


def mark(job_id: str, value: str | None) -> None:
    if value is not None and value not in MARKS:
        raise ValueError("不認得的註記")
    jid = str(job_id or "").strip()
    if not jid or len(jid) > 64:
        raise ValueError("缺工作編號")
    _append({"t": "mark", "id": jid, "mark": value, "at": int(time.time() * 1000)})


def _load() -> list[dict]:
    path = _path()
    try:
        st = path.stat()
    except OSError:
        return []
    key = (str(path), st.st_mtime_ns, st.st_size)
    with _LOCK:
        if _cache["key"] == key:
            return _cache["items"]
    items: dict[str, dict] = {}
    marks: dict[str, str | None] = {}
    try:
        with path.open(encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(row, dict) or not row.get("id"):
                    continue
                if row.get("t") == "gen":
                    items[str(row["id"])] = row
                elif row.get("t") == "mark":
                    marks[str(row["id"])] = row.get("mark")
    except OSError:
        return []
    out = []
    for jid, row in items.items():
        m = marks.get(jid)
        out.append({**row, "mark": m} if m else row)
    out.sort(key=lambda r: r.get("at") or 0, reverse=True)
    with _LOCK:
        _cache["key"] = key
        _cache["items"] = out
    return out


def page(limit: int = 200, before: int | None = None) -> dict:
    """新的在前；before（毫秒）給了就從那之前接著翻。"""
    items = _load()
    limit = max(1, min(PAGE_MAX, int(limit or 200)))
    if before:
        items = [r for r in items if (r.get("at") or 0) < before]
    return {"items": items[:limit], "more": len(items) > limit, "total": len(_load())}


def all_items() -> list[dict]:
    return _load()
