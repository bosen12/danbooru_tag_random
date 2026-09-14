#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LoRA 清單掃描。跟 flux2klein/lora_scan.py 同一套規則（四分類／副檔名／<lora:…> 剝除／SWR）。"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent / "scripts"))
from app_config import cfg  # noqa: E402

# LoRA 收藏根目錄。原本寫死成某台機器的 E:\Comfyui\loras。
# 沒設定就是 None，不要退回 Path("")：那會變成專案根目錄，然後我們會安靜地
# 在自己的原始碼資料夾裡找 style/Character/… 並回報「資料夾不存在」，
# 使用者看不出真正的原因是根本沒設定。
_lora_root = cfg("paths.loraRoot", "LORA_ROOT", "")
LORA_ROOT = Path(str(_lora_root)) if _lora_root else None
LORA_FOLDERS = list(cfg("paths.loraFolders", "", ["style", "Character", "HENTAI", "illus"]))
LORA_PREVIEW_EXTS = (
    ".preview.png", ".preview.jpeg", ".preview.jpg", ".preview.webp",
    ".preview.mp4", ".preview.webm",
    ".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm",
)
LORA_VIDEO_EXTS = (".mp4", ".webm")
TTL = 300.0

_ANGLE_TAG_RE = re.compile(r"<[^<>]*>")
_cache = {"data": None, "at": 0.0, "refreshing": False}
_lock = threading.Lock()


def is_video_preview(name: str) -> bool:
    n = (name or "").lower()
    return n.endswith(".mp4") or n.endswith(".webm")


def strip_angle_tags(word: str) -> str:
    cleaned = _ANGLE_TAG_RE.sub("", word or "")
    parts = [p.strip() for p in cleaned.split(",")]
    parts = [p for p in parts if p]
    return ", ".join(parts)


def preview_path(folder: str, fn: str) -> Path | None:
    if not fn or "/" in fn or "\\" in fn or fn in (".", ".."):
        return None
    parts = (folder or "").split("/")
    if (not parts or parts[0] not in LORA_FOLDERS
            or any(part in ("", "..") for part in parts) or "\\" in folder):
        return None
    if LORA_ROOT is None:
        return None
    p = LORA_ROOT / folder / fn
    try:
        p.resolve().relative_to(LORA_ROOT.resolve())
    except ValueError:
        return None
    return p if p.is_file() else None


def build_lora_list() -> dict:
    items, counts, errs = [], {}, []
    if LORA_ROOT is None:
        data = {
            "items": [],
            "counts": {c: 0 for c in LORA_FOLDERS},
            "folders": list(LORA_FOLDERS),
            "error": "沒有設定 LoRA 收藏資料夾：請在 config.json 填 paths.loraRoot",
        }
        with _lock:
            _cache["data"] = data
            _cache["at"] = time.time()
            _cache["refreshing"] = False
        return data
    for category in LORA_FOLDERS:
        base = LORA_ROOT / category
        if not base.is_dir():
            errs.append(f"{category}: 資料夾不存在")
            counts[category] = 0
            continue
        try:
            paths = sorted(base.rglob("*.safetensors"),
                           key=lambda p: (p.parent.as_posix(), p.name))
        except OSError:
            counts[category] = 0
            continue
        n = 0
        for p in paths:
            fn = p.name
            d = p.parent
            folder = d.relative_to(LORA_ROOT).as_posix()
            stem = fn[: -len(".safetensors")]
            words, title, base_model = [], stem, ""
            meta = d / (stem + ".metadata.json")
            if meta.is_file():
                try:
                    md = json.loads(meta.read_text(encoding="utf-8"))
                    raw_words = (md.get("civitai") or {}).get("trainedWords") or []
                    words = [strip_angle_tags(w) for w in raw_words]
                    title = md.get("model_name") or stem
                    base_model = (md.get("base_model")
                                  or (md.get("civitai") or {}).get("baseModel")
                                  or "")
                except Exception:
                    pass
            preview = None
            for ext in LORA_PREVIEW_EXTS:
                if (d / (stem + ext)).is_file():
                    preview = stem + ext
                    break
            items.append({
                "folder": folder,
                "category": category,
                "file": fn,
                "name": stem,
                "title": title,
                "trainedWords": words,
                "preview": preview,
                "base_model": base_model,
            })
            n += 1
        counts[category] = n
    data = {"items": items, "counts": counts, "folders": list(LORA_FOLDERS)}
    if errs:
        data["error"] = "；".join(errs)
    with _lock:
        _cache["data"] = data
        _cache["at"] = time.time()
        _cache["refreshing"] = False
    return data


def list_loras() -> dict:
    with _lock:
        data = _cache["data"]
        stale = (time.time() - _cache["at"]) >= TTL
        need_bg = stale and data is not None and not _cache["refreshing"]
        if need_bg:
            _cache["refreshing"] = True
    if data is None:
        return build_lora_list()
    if need_bg:
        def work():
            try:
                build_lora_list()
            except Exception as e:
                with _lock:
                    _cache["refreshing"] = False
                print(f"[lora] 背景重掃失敗：{type(e).__name__}: {e}", flush=True)
        threading.Thread(target=work, daemon=True).start()
    return data
