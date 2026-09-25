#!/usr/bin/env python3
"""Serve the tag-case UI and proxy one-at-a-time gens to local ComfyUI."""
from __future__ import annotations

import base64
import gzip
import hashlib
import ipaddress
import json
import mimetypes

# Windows 的 mimetypes 讀登錄檔，常常沒有 webp（卡面插畫全是 webp），
# 不補的話會送 application/octet-stream，靠瀏覽器自己猜才顯示得出來。
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("image/svg+xml", ".svg")
import os
import queue
import random
import re
import socket
import ssl
import struct
import sys
import threading
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# ComfyUI 的 embedded Python 透過 ._pth 隔離匯入路徑，直接執行本檔時不一定會
# 把腳本目錄放進 sys.path。先固定本地模組根目錄，否則第一個 import 就會因
# 找不到 lora_scan 而退出；一般 Python 下此操作是冪等的。
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import lora_scan
import recipes
import workflows

# 這支程式原本把機器專屬的路徑寫死在原始碼裡（checkpoint 目錄、ComfyUI 位址…），
# 別人要跑就得改 server.py。全部搬到 config.json，優先序是：
#   環境變數  >  config.json  >  這裡的預設值
# 環境變數擺第一是為了不打斷既有的啟動腳本。config.json 不進版控，
# config.example.json 才是給人抄的範本。
CONFIG_PATH = Path(os.environ.get("APP_CONFIG", ROOT / "config.json"))


def _load_config() -> dict:
    try:
        raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as exc:
        # 設定檔壞掉要吵，不要安靜地套預設值 —— 不然使用者會以為自己改的有生效。
        print(f"[config] 讀不到 {CONFIG_PATH}：{exc}", flush=True)
        return {}
    return raw if isinstance(raw, dict) else {}


CONFIG = _load_config()


def cfg(path: str, env: str = "", default=None):
    """依序看環境變數、config.json 的 "a.b.c" 路徑、預設值。"""
    if env:
        got = os.environ.get(env, "").strip()
        if got:
            return got
    node = CONFIG
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            return default
        node = node[part]
    return default if node is None or node == "" else node


WEB = (ROOT / str(cfg("paths.webDir", "WEB_DIR", "web"))).resolve()
SHARED = (ROOT / "web").resolve()
CKPT = str(cfg("comfy.ckpt", "COMFY_CKPT", r"illurtrious\waiIllustriousSDXL_v170.safetensors"))
# 沒設定就是 None，不要退回 Path("")：那會變成專案根目錄，然後被當成
# checkpoint 資料夾掃一遍。沒設定時 /api/checkpoints 就回空清單。
_ckpt_dir = cfg("comfy.checkpointDir", "COMFY_CKPT_DIR", "")


def _existing_dir(raw) -> Path | None:
    text = str(raw or "").strip().strip('"')
    if not text:
        return None
    cands = [Path(text)]
    # WSL 讀 Windows 路徑：C:\foo → /mnt/c/foo
    if len(text) >= 3 and text[1] == ":" and text[0].isalpha() and text[2] in "\\/":
        cands.append(Path("/mnt") / text[0].lower() / text[3:].replace("\\", "/"))
    for p in cands:
        try:
            if p.is_dir():
                return p
        except OSError:
            continue
    return cands[0]


CKPT_DIR = _existing_dir(_ckpt_dir)
CKPT_PREFIX = str(cfg("comfy.checkpointPrefix", "COMFY_CKPT_PREFIX", "illurtrious"))
CKPT_EXTS = {".safetensors", ".ckpt", ".pt"}
CKPT_PREVIEW_EXTS = (
    ".preview.png",
    ".preview.jpeg",
    ".preview.jpg",
    ".preview.webp",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
)
def _negative() -> str:
    path = SHARED / "lexicon.json"
    if not path.is_file():
        path = WEB / "lexicon.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        n = str(data.get("negative") or "").strip()
        if n:
            return n
    except Exception:
        pass
    # Last resort if lexicon.json is missing. Source of truth: merge_lexicon.NEGATIVE
    # —— test_server.py 會比對兩者，避免正式詞庫與備援路徑漂移。
    return (
        "worst quality, bad quality, worst detail, sketch, bad hands, extra digits, censored, bar censor, mosaic censoring, watermark, signature, english text, speech bubble, multiple views, 3d, photorealistic, cross-section, x-ray, inset"
    )


NEGATIVE = _negative()


def _rating_negative(key: str, fallback: list) -> list:
    path = SHARED / "lexicon.json"
    if not path.is_file():
        path = WEB / "lexicon.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        got = data.get(key)
        if isinstance(got, list) and got:
            return [str(x) for x in got if str(x).strip()]
    except Exception:
        pass
    return list(fallback)


def _sfw_negative() -> list:
    path = SHARED / "lexicon.json"
    if not path.is_file():
        path = WEB / "lexicon.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        got = data.get("sfwNegative")
        if isinstance(got, list) and got:
            return [str(x) for x in got if str(x).strip()]
    except Exception:
        pass
    return ["nsfw", "explicit", "nude", "nipples", "pussy", "penis", "sex"]


SFW_NEGATIVE = _sfw_negative()


SENSITIVE_NEGATIVE = _rating_negative(
    "sensitiveNegative",
    ["explicit", "nude", "nipples", "pussy", "penis", "sex", "cum"],
)


def negative_for(rating) -> str:
    """依分級決定負面詞。

    正面那邊由 engine.js 換掉尾巴，而且該級不能出現的字根本抽不出來；
    這裡是第二道保險 —— 模型就算自己想畫，負面也會把它拉回來。

    為了相容舊的呼叫方式，傳 True/False 仍然當成 general／explicit。
    """
    if rating is True:
        rating = "general"
    elif rating is False or rating is None:
        rating = "explicit"
    if rating == "explicit":
        return NEGATIVE
    extra = SFW_NEGATIVE if rating == "general" else SENSITIVE_NEGATIVE
    add = [t for t in extra if t not in NEGATIVE]
    return NEGATIVE + (", " + ", ".join(add) if add else "")
_DEFAULT_ALLOW_NET = "127.0.0.0/8,100.64.0.0/10"


def parse_allow_nets(raw: str | None = None):
    if raw is None:
        raw = str(cfg("server.allowNet", "ALLOW_NET", ""))
    text = raw.strip() or _DEFAULT_ALLOW_NET
    return [ipaddress.ip_network(part.strip(), strict=False) for part in text.split(",") if part.strip()]


ALLOW_NETS = parse_allow_nets()


def allowed_client(addr: str, nets=None) -> bool:
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return False
    if ip.version == 6 and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return any(ip in net for net in (ALLOW_NETS if nets is None else nets))


def mutation_request_error(origin: str, host: str, content_type: str, require_json: bool = True):
    """Return an HTTP error for browser cross-site/non-JSON mutations."""
    if origin:
        parsed = urllib.parse.urlparse(origin)
        if not parsed.netloc or parsed.netloc.casefold() != str(host or "").casefold():
            return 403, "跨站寫入已拒絕。"
    media_type = str(content_type or "").split(";", 1)[0].strip().casefold()
    if require_json and media_type != "application/json":
        return 415, "寫入 API 只接受 application/json。"
    return None


STEPS = int(cfg("comfy.steps", "", 25))
CFG = float(cfg("comfy.cfg", "", 6.5))
SAMPLER = str(cfg("comfy.sampler", "", "euler_ancestral"))
SCHEDULER = str(cfg("comfy.scheduler", "", "normal"))
SEED_MAX = 0xFFFFFFFFFFFFFFFF

# LoRA Manager（獨立埠 7861）點「送到 workflow」時 POST /api/lora-push。
# 單一格、版本號遞增、最新覆蓋前一個。epoch 每次啟動都換，避免瀏覽器記住的舊 ver
# 在伺服器重啟後把新推送當成已看過。跟 flux2klein/darkroom/preview_ui.py 同一套。
_LORA_PUSH = {"ver": 0, "data": None}
_LORA_PUSH_LOCK = threading.Lock()
_LORA_PUSH_EPOCH = uuid.uuid4().hex
_LORA_CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


def comfy_base() -> str:
    env = os.environ.get("COMFY_API", "").strip()
    if env:
        return env.rstrip("/")
    saved = workflows.saved_comfy_api()
    if saved:
        return saved
    return str(cfg("comfy.api", "", "http://127.0.0.1:8188")).rstrip("/")


def api(method: str, path: str, data=None, timeout: float = 60):
    url = comfy_base() + path
    body = None if data is None else json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={"Content-Type": "application/json"} if body else {},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        if not raw:
            return None
        ctype = resp.headers.get("Content-Type", "")
        if "json" in ctype or raw[:1] in (b"{", b"["):
            return json.loads(raw.decode("utf-8"))
        return raw


_PING = {"t": 0.0, "val": None}
_STATIC: dict[str, dict] = {}
_GZIP_TYPES = {
    "text/html",
    "text/css",
    "text/javascript",
    "application/javascript",
    "application/json",
    "image/svg+xml",
}


# === 網頁裡自己的程式檔、樣式表帶上內容指紋 ===================================
# 走 Tailscale 的時候，每次重新整理都要把二十幾個 .js 逐一回來問「改了沒」（no-cache）；
# HTTP/1.1 一次只開 6 條連線，排成五批，光這段就要半秒。送出 HTML 時把自己的 .js／.css
# 換成帶內容雜湊的網址（?v=，這種網址整年快取），模組之間的 `import "./engine.js"`
# 交給 import map 對到同一個帶版本的網址 —— 重新整理時瀏覽器連問都不必問。
# 檔案一改雜湊就換；HTML 本身是 no-cache，下一次重新整理就拿到新的對照表，不會跑到舊程式。
_ASSET_SKIP_DIRS = {"vendor", "node_modules", "cards", "art", "data", "__pycache__"}
_ASSET_SCAN: dict = {"t": 0.0, "files": []}
_HTML_OUT: dict[str, dict] = {}
_IMPORTMAP_RE = re.compile(r'<script\s+type="importmap"\s*>(.*?)</script>\s*', re.S | re.I)
_TAG_RE = re.compile(r"<(?:script|link)\b[^>]*>", re.I)
_URL_ATTR_RE = re.compile(r'\b(src|href)="([^"]+)"', re.I)


def static_path(rel: str) -> Path | None:
    """網站上的相對路徑 → 磁碟上的檔：先找這個房間（WEB），找不到再退回共用的 web/。"""
    dest = (WEB / rel).resolve()
    if dest.is_relative_to(WEB) and dest.is_file():
        return dest
    shared = (SHARED / rel).resolve()
    if shared.is_relative_to(SHARED) and shared.is_file():
        return shared
    return None


def own_js_files() -> list[str]:
    """WEB、SHARED 底下自己寫的 .js（相對路徑，/ 分隔）。第三方（vendor）不收。兩秒內不重掃。"""
    now = time.time()
    if _ASSET_SCAN["files"] and now - _ASSET_SCAN["t"] < 2:
        return _ASSET_SCAN["files"]
    seen: set[str] = set()
    for base in {WEB, SHARED}:
        for root, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in _ASSET_SKIP_DIRS and not d.startswith(".")]
            for name in files:
                if name.endswith(".js"):
                    seen.add(Path(root, name).relative_to(base).as_posix())
    _ASSET_SCAN.update(t=now, files=sorted(seen))
    return _ASSET_SCAN["files"]


def _local_rel(url: str) -> str | None:
    """頁面上寫的相對網址 → 網站根目錄底下的相對路徑。外部網址、已經帶參數的都不動。"""
    if not url or "?" in url or "#" in url or ":" in url or url.startswith("//"):
        return None
    rel = url[2:] if url.startswith("./") else url.lstrip("/")
    if not rel or ".." in rel.split("/"):
        return None
    return rel


def versioned_html(html: str, version_of, module_files) -> str:
    """HTML 裡自己的程式檔、樣式表換成帶版本的網址，並在所有 <link>／<script> 前面放 import map。

    version_of(rel) → 短雜湊（找不到就 None，那個檔照舊）。
    module_files：放進 import map 的 .js（模組彼此 import 的時候用）。
    頁面原本就有 import map（排字匣的 three.js）就合併，並整張移到最前面 —— 放在 modulepreload
    後面的話，預載的模組會在對照表生效以前用舊網址載進來，同一支模組變成兩份。
    """
    imports: dict[str, str] = {}
    for rel in module_files:
        v = version_of(rel)
        if v:
            imports["/" + rel] = f"/{rel}?v={v}"
    old = _IMPORTMAP_RE.search(html)
    extra: dict = {}
    if old:
        try:
            extra = json.loads(old.group(1))
        except ValueError:
            return html  # 看不懂原本的 import map：整頁照舊，不冒險
        if not isinstance(extra, dict):
            return html
        html = html[: old.start()] + html[old.end():]
    merged = dict(extra)
    merged["imports"] = {**imports, **(extra.get("imports") or {})}

    def swap(m: re.Match) -> str:
        tag = m.group(0)
        low = tag.lower()
        if low.startswith("<script"):
            if 'type="module"' not in low:
                return tag
        elif 'rel="modulepreload"' not in low and 'rel="stylesheet"' not in low:
            return tag

        def one(a: re.Match) -> str:
            rel = _local_rel(a.group(2))
            v = version_of(rel) if rel else None
            return f'{a.group(1)}="{a.group(2)}?v={v}"' if v else a.group(0)

        return _URL_ATTR_RE.sub(one, tag)

    html = _TAG_RE.sub(swap, html)
    low = html.lower()
    spots = [i for i in (low.find("<link"), low.find("<script")) if i >= 0]
    if not spots:
        head = low.find("</head>")
        if head < 0:
            return html
        spots = [head]
    at = min(spots)
    block = '<script type="importmap">' + json.dumps(merged, ensure_ascii=False, separators=(",", ":")) + "</script>\n    "
    return html[:at] + block + html[at:]


def ping() -> dict:
    now = time.time()
    if _PING["val"] is not None and now - _PING["t"] < 2:
        return _PING["val"]
    try:
        stats = api("GET", "/system_stats", timeout=8)
        ver = ""
        if isinstance(stats, dict):
            ver = str((stats.get("system") or {}).get("comfyui_version") or "")
        val = {
            "ok": True,
            "base": comfy_base(),
            "version": ver,
            # 慢顯卡（AMD ROCm 載模型／搬顯存）可能安靜很久，前端的放棄門檻
            # 得跟著機器走，所以由 config.json 決定而不是寫死在 boot.js。
            "streamIdleMs": int(cfg("client.streamIdleMs", "", 90000)),
            "sampler": SAMPLER,
            "scheduler": SCHEDULER,
            "steps": STEPS,
            "cfg": CFG,
        }
    except Exception as exc:
        val = {
            "ok": False,
            "base": comfy_base(),
            "error": str(exc),
            "streamIdleMs": int(cfg("client.streamIdleMs", "", 90000)),
            "sampler": SAMPLER,
            "scheduler": SCHEDULER,
            "steps": STEPS,
            "cfg": CFG,
        }
    _PING["t"] = now
    _PING["val"] = val
    return val


def convert_loras(loras_in) -> list:
    """前端 [{folder, file, strength}] → [(lora_name, strength), …]，最多兩筆。

    ComfyUI 的 lora_name 是全部用反斜線的相對路徑。folder 可能是 Character/other
    這種 POSIX 路徑，混用正反斜線會整批 400。"""
    if not isinstance(loras_in, list):
        return []
    out = []
    for lora in loras_in[:2]:
        lora = lora or {}
        if not lora.get("file"):
            continue
        folder = (lora.get("folder") or "").replace("/", "\\")
        lname = (folder + "\\" + lora["file"]) if folder else lora["file"]
        try:
            strength = float(lora.get("strength", 0.8))
        except (TypeError, ValueError):
            strength = 0.8
        out.append((lname, strength))
    return out


def inject_lora(wf: dict, lora_name: str, strength: float) -> None:
    """插入一個 LoraLoader：把吃 checkpoint model([_,0])/clip([_,1]) 的節點改接到它。

    VAE([_,2]) 不動。連呼叫兩次會自動疊成 ckpt → LoRA2 → LoRA1 → 其餘。"""
    ckpt = None
    for nid, n in wf.items():
        if isinstance(n, dict) and n.get("class_type") == "CheckpointLoaderSimple":
            ckpt = str(nid)
            break
    if ckpt is None:
        return
    lid = "201"
    while lid in wf:
        lid = str(int(lid) + 1)
    wf[lid] = {
        "class_type": "LoraLoader",
        "inputs": {
            "lora_name": lora_name,
            "strength_model": float(strength),
            "strength_clip": float(strength),
            "model": [ckpt, 0],
            "clip": [ckpt, 1],
        },
    }
    for nid, n in wf.items():
        if nid == lid or not isinstance(n, dict):
            continue
        for k, v in (n.get("inputs") or {}).items():
            if isinstance(v, list) and len(v) == 2 and str(v[0]) == ckpt:
                if v[1] == 0:
                    n["inputs"][k] = [lid, 0]
                elif v[1] == 1:
                    n["inputs"][k] = [lid, 1]


def build_workflow(positive: str, width: int, height: int, seed: int, loras=None,
                   ckpt=None, sfw: bool = False, rating=None) -> dict:
    ckpt_name = resolve_ckpt(ckpt)
    wf = {
        "13": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": ckpt_name},
        },
        "36": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": positive, "clip": ["13", 1]},
        },
        "37": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": negative_for(rating if rating is not None else sfw), "clip": ["13", 1]},
        },
        "119": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": int(width), "height": int(height), "batch_size": 1},
        },
        "35": {
            "class_type": "KSampler",
            "inputs": {
                "seed": int(seed),
                "steps": STEPS,
                "cfg": CFG,
                "sampler_name": SAMPLER,
                "scheduler": SCHEDULER,
                "denoise": 1.0,
                "model": ["13", 0],
                "positive": ["36", 0],
                "negative": ["37", 0],
                "latent_image": ["119", 0],
            },
        },
        "85": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["35", 0], "vae": ["13", 2]},
        },
        "200": {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": "danbooru_case/case",
                "images": ["85", 0],
            },
        },
    }
    for lora_name, strength in convert_loras(loras):
        inject_lora(wf, lora_name, strength)
    return wf


_MODEL_CACHE = {"t": 0.0, "data": {}}


def models_from_comfy(kind: str) -> list[str]:
    table = {
        "checkpoints": ("CheckpointLoaderSimple", "ckpt_name"),
        "loras": ("LoraLoader", "lora_name"),
        "vae": ("VAELoader", "vae_name"),
    }
    if kind not in table:
        return []
    now = time.time()
    hit = _MODEL_CACHE["data"].get(kind)
    if hit is not None and now - _MODEL_CACHE["t"] < 30:
        return hit
    class_type, field = table[kind]
    info = api("GET", f"/object_info/{class_type}", timeout=8)
    names = workflows.combo_list(info, class_type, field)
    if now - _MODEL_CACHE["t"] >= 30:
        _MODEL_CACHE["data"] = {}
        _MODEL_CACHE["t"] = now
    _MODEL_CACHE["data"][kind] = names
    return names


def checkpoints_for_ui() -> tuple[list[dict], str]:
    """Use Comfy as the model source and attach local preview metadata when available."""
    local = list_ckpts()
    by_file = {it["file"]: it for it in local}
    by_name = {str(it.get("ckpt_name") or "").replace("/", "\\"): it for it in local}
    try:
        names = [str(n).replace("/", "\\") for n in models_from_comfy("checkpoints")]
    except Exception:
        names = []
    if not names:
        return local, "local" if local else "none"
    items = []
    for raw in names:
        fn = raw.split("\\")[-1]
        loc = by_name.get(raw) or by_file.get(fn) or {}
        items.append(
            {
                "file": fn,
                "ckpt_name": raw,
                "title": loc.get("title") or Path(fn).stem,
                "preview": loc.get("preview") or "",
            }
        )
    return items, "comfy"


def prepare_workflow(payload: dict):
    """Builtin graph, or deepcopy of a stored API workflow with mapping applied."""
    payload = payload or {}
    positive = str(payload.get("positive") or "").strip()
    if not positive:
        raise ValueError("missing positive")
    width = max(256, min(int(payload.get("width") or 1024), 2048))
    height = max(256, min(int(payload.get("height") or 1024), 2048))
    seed = payload.get("seed")
    if seed is None or seed == "":
        seed = random.randint(0, SEED_MAX)
    seed = int(seed) & SEED_MAX
    meta = {
        "kind": "builtin",
        "seed": seed,
        "width": width,
        "height": height,
        "positive": positive,
    }
    wid = str(payload.get("workflowId") or "").strip()
    if not wid:
        wf = build_workflow(
            positive,
            width,
            height,
            seed,
            payload.get("loras"),
            payload.get("ckpt"),
            sfw=bool(payload.get("sfw")),
            rating=payload.get("rating"),
        )
        return wf, meta
    prof = workflows.get_profile(wid)
    if prof is None:
        raise workflows.WorkflowError("找不到這個 workflow profile。", "missing_profile")
    if not workflows.mapping_ready(prof["mapping"]):
        raise workflows.WorkflowError("先指定 Positive Prompt 要寫進哪個節點。", "need_mapping")
    mapping = prof["mapping"]
    values = {"positive": positive}
    neg_spec = mapping.get("negative") if isinstance(mapping.get("negative"), dict) else {}
    if (neg_spec.get("mode") or "keep") == "control":
        values["negative"] = negative_for(
            payload.get("rating") if payload.get("rating") is not None else bool(payload.get("sfw"))
        )
    seed_spec = mapping.get("seed") if isinstance(mapping.get("seed"), dict) else {}
    if (seed_spec.get("mode") or "keep") == "control":
        values["seed"] = seed
    w_spec = mapping.get("width") if isinstance(mapping.get("width"), dict) else {}
    if (w_spec.get("mode") or "keep") == "control":
        values["width"] = width
    h_spec = mapping.get("height") if isinstance(mapping.get("height"), dict) else {}
    if (h_spec.get("mode") or "keep") == "control":
        values["height"] = height
    ckpt_spec = mapping.get("checkpoint") if isinstance(mapping.get("checkpoint"), dict) else {}
    if (ckpt_spec.get("mode") or "keep") == "control":
        try:
            pool, _ = checkpoints_for_ui()
        except Exception:
            pool = list_ckpts()
        values["checkpoint"] = resolve_ckpt(payload.get("ckpt"), pool)
    lora_specs = mapping.get("loras") if isinstance(mapping.get("loras"), list) else []
    if any(isinstance(s, dict) and (s.get("mode") or "keep") == "control" for s in lora_specs):
        values["loras"] = convert_loras(payload.get("loras"))
    wf = workflows.apply_mapping(prof["workflow"], mapping, values)
    meta["kind"] = "profile"
    meta["id"] = wid
    meta["name"] = prof.get("name") or wid
    return wf, meta


def comfy_interrupt(prompt_id=None) -> None:
    """中斷生圖。給了 prompt_id 就只砍那一張。

    不給的話 Comfy 走的是全域中斷（後台會印 "Global interrupt (no prompt_id
    specified)"），砍掉的是它當下正在跑的任何東西。舊版一律送空的 {}，於是一張
    圖逾時或瀏覽器斷線之後補送的中斷，會落在使用者已經開始的下一張上 —— 畫面看
    起來就是「跑到一半自己停了」。
    """
    body = {"prompt_id": prompt_id} if prompt_id else {}
    api("POST", "/interrupt", body, timeout=8)


def wait_done(prompt_id: str, timeout: float = 600) -> dict:
    t0 = time.time()
    while time.time() - t0 < timeout:
        hist = api("GET", f"/history/{prompt_id}", timeout=30)
        if hist and prompt_id in hist:
            return hist[prompt_id]
        time.sleep(1.0)
    raise TimeoutError(prompt_id)


_VIEW_TYPES = {"output", "temp", "input"}


def comfy_view_query(filename: str, subfolder: str = "", type_: str = "output") -> str | None:
    if type_ not in _VIEW_TYPES:
        return None
    name = str(filename or "")
    if not name or name in {".", ".."} or "/" in name or "\\" in name:
        return None
    sub = str(subfolder or "").replace("\\", "/")
    if any(ord(c) < 0x20 or ord(c) == 0x7F for c in name + sub):
        return None
    parts = [p for p in sub.split("/") if p]
    if any(p in {".", ".."} for p in parts):
        return None
    return urllib.parse.urlencode({"filename": name, "subfolder": "/".join(parts), "type": type_})


def image_error_code(exc: BaseException) -> int:
    return 404 if getattr(exc, "code", None) == 404 else 502


# 成品網址上的內容指紋（h=）：原圖 sha1 的前 16 個字。
# 網址帶著它，就等於「這個網址永遠是這一張圖」—— 瀏覽器可以整年快取、重新整理時連問都不必問。
# ComfyUI 輸出資料夾清過、檔名重複時，指紋對不上，伺服器回 404，絕不拿別張圖頂替。
IMAGE_HASH_LEN = 16


def image_digest(raw: bytes) -> str:
    return hashlib.sha1(bytes(raw)).hexdigest()


def valid_image_hash(h: str) -> bool:
    return 8 <= len(h) <= 40 and all(c in "0123456789abcdef" for c in h)


def image_cache_policy(want: str, digest: str) -> tuple[int, str]:
    """回 (狀態碼, Cache-Control)。

    沒帶指紋（舊的網址）：no-cache，每次回來問，ETag 是內容雜湊，內容一樣才回 304。
    帶了指紋而且對得上：整年快取 —— 內容一換，網址上的指紋就不一樣，不會拿到舊圖。
    帶了指紋但對不上：那個檔名現在是另一張圖了，回 404。
    """
    if not want:
        return 200, "private, no-cache"
    if not digest.startswith(want):
        return 404, "no-store"
    return 200, "private, max-age=31536000, immutable"


def with_content_hash(src: str) -> str:
    """成品網址加上內容指紋。拿不到圖（Comfy 忙、斷線）就照舊回原本的網址，不擋住出圖。"""
    if not src or not src.startswith("/api/image?") or "&h=" in src:
        return src
    try:
        raw = api("GET", "/view?" + src.split("?", 1)[1], timeout=30)
    except Exception:
        return src
    if not isinstance(raw, (bytes, bytearray)):
        return src
    return src + "&h=" + image_digest(raw)[:IMAGE_HASH_LEN]


# 成品轉成 webp 的快取。鑰匙是原圖的 sha1：同一張圖不管幾台裝置、幾個分頁來要都只轉一次。
# ComfyUI 轉一張 832×1216 約 0.1 秒，而且是在它自己的事件迴圈裡轉 —— 晾紙繩一次幾十張
# 全靠它現轉的話，正在跑的那張圖的進度回報會跟著卡。一張約 100 KB，留 200 張約 20 MB。
_WEBP_CACHE: dict[str, bytes] = {}
_WEBP_MAX = 200
_WEBP_LOCK = threading.Lock()
# 轉好的也存一份到硬碟（data/ 不進版控）：伺服器重開之後晾紙繩不必再請 ComfyUI 全部重轉一次。
# 檔名就是原圖的 sha1，內容不會變；超過上限就從最舊的刪（約 100 KB 一張，1500 張約 150 MB）。
WEBP_DIR = Path(os.environ.get("WEBP_CACHE_DIR") or ROOT / "data" / "webp-cache")
_WEBP_DISK_MAX = 1500
_WEBP_WRITES = {"n": 0}


def _webp_remember(digest: str, blob: bytes) -> None:
    with _WEBP_LOCK:
        _WEBP_CACHE[digest] = blob
        while len(_WEBP_CACHE) > _WEBP_MAX:
            _WEBP_CACHE.pop(next(iter(_WEBP_CACHE)))


def _webp_disk_put(digest: str, blob: bytes) -> None:
    try:
        WEBP_DIR.mkdir(parents=True, exist_ok=True)
        tmp = WEBP_DIR / f"{digest}.{os.getpid()}.{threading.get_ident()}.tmp"
        tmp.write_bytes(blob)
        os.replace(tmp, WEBP_DIR / f"{digest}.webp")
    except OSError:
        return
    _WEBP_WRITES["n"] += 1
    if _WEBP_WRITES["n"] % 50:
        return
    try:
        files = sorted(WEBP_DIR.glob("*.webp"), key=lambda f: f.stat().st_mtime)
        for f in files[: max(0, len(files) - _WEBP_DISK_MAX)]:
            f.unlink(missing_ok=True)
    except OSError:
        pass


def comfy_webp(q: str, digest: str) -> bytes | None:
    with _WEBP_LOCK:
        hit = _WEBP_CACHE.pop(digest, None)
        if hit is not None:
            _WEBP_CACHE[digest] = hit  # 放回最後面：最近用過的最晚被擠掉
            return hit
    try:
        blob = (WEBP_DIR / f"{digest}.webp").read_bytes()
    except OSError:
        blob = None
    if blob and blob[:4] == b"RIFF":
        _webp_remember(digest, blob)
        return blob
    try:
        blob = api("GET", f"/view?{q}&preview=" + urllib.parse.quote("webp;85"), timeout=60)
    except Exception:
        return None
    if not isinstance(blob, (bytes, bytearray)) or blob[:4] != b"RIFF":
        return None
    blob = bytes(blob)
    _webp_remember(digest, blob)
    _webp_disk_put(digest, blob)
    return blob


def first_image_src(history: dict, preferred_nodes=None) -> str | None:
    outputs = history.get("outputs") or {}
    node_ids = list(outputs)
    if preferred_nodes:
        preferred = {str(n) for n in preferred_nodes}
        node_ids = [nid for nid in node_ids if str(nid) in preferred]
    for nid in node_ids:
        node_out = outputs.get(nid) or {}
        for img in node_out.get("images") or []:
            q = comfy_view_query(
                img.get("filename") or "",
                img.get("subfolder") or "",
                img.get("type") or "output",
            )
            if q:
                return "/api/image?" + q
    return None


def sse(event: str, data: dict) -> bytes:
    return (
        f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
    ).encode("utf-8")


def parse_comfy_binary(buf: bytes):
    if len(buf) < 8:
        return None
    event_type, image_type = struct.unpack(">II", buf[:8])
    if event_type != 1:
        return None
    mime = {1: "image/jpeg", 2: "image/png"}.get(image_type)
    if not mime:
        return None
    return mime, buf[8:]


def ws_frame(payload: bytes, opcode: int = 1) -> bytes:
    n = len(payload)
    head = bytes([0x80 | opcode])
    if n < 126:
        head += bytes([0x80 | n])
    elif n < 65536:
        head += bytes([0x80 | 126]) + struct.pack(">H", n)
    else:
        head += bytes([0x80 | 127]) + struct.pack(">Q", n)
    key = os.urandom(4)
    masked = bytes(b ^ key[i % 4] for i, b in enumerate(payload))
    return head + key + masked


def mask_ws(frame: bytes) -> tuple[int, bytes]:
    opcode = frame[0] & 0x0F
    masked = frame[1] & 0x80
    n = frame[1] & 0x7F
    i = 2
    if n == 126:
        n = struct.unpack(">H", frame[i : i + 2])[0]
        i += 2
    elif n == 127:
        n = struct.unpack(">Q", frame[i : i + 8])[0]
        i += 8
    if masked:
        key = frame[i : i + 4]
        i += 4
        data = bytes(frame[i + j] ^ key[j % 4] for j in range(n))
    else:
        data = frame[i : i + n]
    return opcode, data


# 一張 1024 預覽 JPEG 大概幾百 KB。上限只是防呆：幀頭被讀錯位的時候，長度欄位
# 會解出天文數字，沒有這道閘就會一路吞資料把記憶體吃光。
WS_FRAME_MAX = 64 * 1024 * 1024


class Ws:
    def __init__(self, sock: socket.socket, buf: bytes = b""):
        self.sock = sock
        self.buf = buf

    def _fill(self, n: int) -> None:
        """把 buf 補到至少 n bytes。中途丟例外時 buf 原封不動，收到的那些照樣留著。"""
        while len(self.buf) < n:
            chunk = self.sock.recv(max(4096, n - len(self.buf)))
            if not chunk:
                raise ConnectionError("ws closed")
            self.buf += chunk

    def recv(self) -> tuple[int, bytes]:
        # 整幀到齊才動 buf。舊版是一個 byte 一個 byte 從 buf 吃掉，socket.timeout
        # 只要落在幀中間（大張預覽會跨好幾個 TCP segment，取樣時卡兩秒很常見），
        # 已經吃掉的頭就永遠消失，之後每一幀都錯位解讀 —— 呼叫端接住逾時重來一次
        # 也救不回來。現在逾時丟出去 buf 還是完整的，下次進來從同一個邊界再解一次。
        self._fill(2)
        b0, b1 = self.buf[0], self.buf[1]
        n = b1 & 0x7F
        head = 2
        if n == 126:
            self._fill(4)
            n = struct.unpack(">H", self.buf[2:4])[0]
            head = 4
        elif n == 127:
            self._fill(10)
            n = struct.unpack(">Q", self.buf[2:10])[0]
            head = 10
        if n > WS_FRAME_MAX:
            raise ConnectionError(f"ws frame too big: {n}")
        masked = bool(b1 & 0x80)
        if masked:
            head += 4
        self._fill(head + n)
        frame, self.buf = self.buf[: head + n], self.buf[head + n :]
        data = frame[head:]
        if masked:
            key = frame[head - 4 : head]
            data = bytes(c ^ key[i % 4] for i, c in enumerate(data))
        return b0 & 0x0F, data

    def send(self, data: bytes, opcode: int = 1) -> None:
        self.sock.sendall(ws_frame(data, opcode))

    def close(self) -> None:
        try:
            self.send(b"", 8)
        except Exception:
            pass
        try:
            self.sock.close()
        except Exception:
            pass


def ws_connect(http_base: str, client_id: str, timeout: float = 30) -> Ws:
    u = urllib.parse.urlparse(http_base)
    host = u.hostname or "127.0.0.1"
    port = u.port or (443 if u.scheme == "https" else 80)
    base_path = (u.path or "").rstrip("/")
    path = base_path + "/ws?clientId=" + urllib.parse.quote(client_id)
    sock = socket.create_connection((host, port), timeout=timeout)
    if u.scheme == "https":
        sock = ssl.create_default_context().wrap_socket(sock, server_hostname=host)
    sock.settimeout(timeout)
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    host_header = f"[{host}]" if ":" in host else host
    req = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host_header}:{port}\r\n"
        f"Upgrade: websocket\r\n"
        f"Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        f"Sec-WebSocket-Version: 13\r\n"
        f"\r\n"
    )
    sock.sendall(req.encode("ascii"))
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = sock.recv(4096)
        if not chunk:
            raise ConnectionError("ws handshake")
        buf += chunk
    head, rest = buf.split(b"\r\n\r\n", 1)
    if b" 101 " not in head.split(b"\r\n", 1)[0] and not head.startswith(b"HTTP/1.1 101"):
        raise ConnectionError(head.decode("latin1", "replace")[:200])
    return Ws(sock, rest)


def _job(seed: int, width: int, height: int, positive: str, image: str, ckpt: str | None = None) -> dict:
    return {
        "ok": True,
        "image": with_content_hash(image),
        "seed": seed,
        "ckpt": ckpt or CKPT,
        "width": width,
        "height": height,
        "positive": positive,
    }


# 單張圖的上限。超過就報錯收工，免得 Comfy 卡住的時候無限抽整晚空轉。
GEN_TIMEOUT = float(cfg("comfy.genTimeoutSec", "COMFY_GEN_TIMEOUT", 600))


class WsUnavailable(Exception):
    pass


def gen_via_ws(width: int, height: int, seed: int, positive: str, wf: dict):
    cid = uuid.uuid4().hex
    ckpt = workflows.ckpt_name_of(wf) or CKPT
    save_ids = set(workflows.image_output_nodes(wf))
    try:
        ws = ws_connect(comfy_base(), cid, timeout=20)
    except Exception as exc:
        raise WsUnavailable(str(exc)) from exc
    # POST /prompt 以前落在 try 外面：它一丟例外（Comfy 忙、顯存不夠、工作流被退件），
    # 剛開好的 websocket 就沒人關，跑一整晚會把 socket 和 Comfy 的 client 一起積爆。
    try:
        yield ("ping", {"stage": "connected"})
        posted = api("POST", "/prompt", {"prompt": wf, "client_id": cid}, timeout=60)
        prompt_id = (posted or {}).get("prompt_id")
        if not prompt_id:
            raise RuntimeError(f"Comfy 沒有回 prompt_id：{posted!r}"[:200])
        yield ("ping", {"stage": "queued", "prompt_id": prompt_id})
        t0 = time.time()
        beat = t0
        while time.time() - t0 < GEN_TIMEOUT:
            try:
                ws.sock.settimeout(2.0)
                op, data = ws.recv()
            except socket.timeout:
                hist = api("GET", f"/history/{prompt_id}", timeout=20)
                if hist and prompt_id in hist:
                    image = first_image_src(hist[prompt_id], save_ids)
                    if image:
                        yield ("done", _job(seed, width, height, positive, image, ckpt))
                        return
                # 心跳：載模型的時候 Comfy 可以安靜一分鐘以上。沒有這一下，前端分不出
                # 「還在載」和「伺服器這條執行緒卡死了」，寫也寫不出去的斷線也發現不了。
                now = time.time()
                if now - beat >= 5:
                    beat = now
                    yield ("ping", {"waited": round(now - t0, 1)})
                continue
            if op == 8:
                # 對面收線。先撈一次 history —— 圖可能已經存好了，只是收線比 executed 快。
                hist = api("GET", f"/history/{prompt_id}", timeout=20)
                image = first_image_src(hist[prompt_id], save_ids) if hist and prompt_id in hist else None
                if image:
                    yield ("done", _job(seed, width, height, positive, image, ckpt))
                    return
                raise ConnectionError("Comfy 關掉了 websocket")
            if op == 9:
                ws.send(data, 10)
                continue
            if op == 2:
                parsed = parse_comfy_binary(data)
                if parsed:
                    mime, blob = parsed
                    b64 = base64.b64encode(blob).decode("ascii")
                    yield ("preview", {"image": f"data:{mime};base64,{b64}"})
                continue
            if op != 1:
                continue
            try:
                msg = json.loads(data.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                # 單一壞幀不值得賠掉整張圖：跳過，讓 history 輪詢去撿結果。
                continue
            typ = msg.get("type")
            d = msg.get("data") or {}
            if typ == "progress":
                yield (
                    "progress",
                    {
                        "value": int(d.get("value") or 0),
                        "max": int(d.get("max") or STEPS),
                    },
                )
            elif typ == "execution_error":
                raise RuntimeError(str(d.get("exception_message") or d or "Comfy error"))
            elif typ == "execution_interrupted" and d.get("prompt_id") == prompt_id:
                # 這則是廣播給所有連線的：只認自己那張的 prompt_id，別張被中斷不關我的事。
                raise RuntimeError("ComfyUI 中斷了這張")
            elif typ in ("execution_success", "executed"):
                nid = str(d.get("node") or "")
                if typ == "executed" and save_ids and nid not in save_ids:
                    continue
                hist = api("GET", f"/history/{prompt_id}", timeout=30)
                if hist and prompt_id in hist:
                    image = first_image_src(hist[prompt_id], save_ids)
                    if image:
                        yield ("done", _job(seed, width, height, positive, image, ckpt))
                        return
        raise TimeoutError(f"Comfy 超過 {GEN_TIMEOUT} 秒沒有產出（prompt {prompt_id}）")
    finally:
        ws.close()


# === 可以接回去的出圖工作 =====================================================
# 從別台裝置付印（Mac 走 Tailscale、手機）時，網路只要斷一下，舊流程就把 Comfy 正在畫的
# 那張中斷掉。網頁在請求上帶 `X-Gen-Resume: 1`（「我會接回來」）時改成：
#   - 出圖在自己的執行緒跑，事件記在 GenJob 裡（預覽只留最新一張）；
#   - 連線斷了先不砍：GEN_REATTACH_SEC 秒內用 GET /api/gen/attach?job= 接回來，從頭重播、接著收；
#   - 沒人接回來才照舊送 /interrupt（只砍自己那張）；
#   - POST /api/gen/cancel {job} 是明確的「停」：排隊中的從 Comfy 佇列刪掉，畫到一半的中斷。
# 沒帶這個 header 的房間，/api/gen 的行為一點都沒變（斷線就中斷）。
GEN_REATTACH_SEC = float(cfg("comfy.reattachSec", "GEN_REATTACH_SEC", 30))
GEN_KEEP_DONE_SEC = 300.0
_JOBS: dict[str, "GenJob"] = {}
_JOBS_LOCK = threading.Lock()


class GenJob:
    def __init__(self, events):
        self.id = uuid.uuid4().hex[:16]
        self.cond = threading.Condition()
        self.log: list[tuple[str, dict]] = []  # 預覽以外的每一則；接回來的人從頭重播
        self.preview: tuple[int, dict] | None = None  # 預覽一張幾十 KB，只留最新的
        self.pv_seq = 0
        self.finished = False
        self.finished_at = 0.0
        self.prompt_id: str | None = None
        self.watchers = 0
        self.left_at = time.time()
        self.cancelled = False
        self._events = events

    def start(self) -> "GenJob":
        with _JOBS_LOCK:
            now = time.time()
            for jid, job in list(_JOBS.items()):
                if job.finished and now - job.finished_at > GEN_KEEP_DONE_SEC:
                    del _JOBS[jid]
            _JOBS[self.id] = self
        threading.Thread(target=self._run, name=f"gen-{self.id}", daemon=True).start()
        return self

    def push(self, event: str, data: dict) -> None:
        with self.cond:
            if self.finished:
                return
            if isinstance(data, dict) and data.get("prompt_id"):
                self.prompt_id = data["prompt_id"]
            if event == "preview":
                self.pv_seq += 1
                self.preview = (self.pv_seq, data)
            else:
                self.log.append((event, data))
            if event in ("done", "error"):
                self.finished = True
                self.finished_at = time.time()
            self.cond.notify_all()

    def abandoned(self) -> bool:
        with self.cond:
            return self.cancelled or (self.watchers == 0 and time.time() - self.left_at > GEN_REATTACH_SEC)

    def _run(self) -> None:
        gave_up = False
        try:
            # gen_via_ws 在等的時候每 5 秒有一則心跳，所以「沒人接回來」最慢 5 秒內會被發現。
            for event, data in self._events:
                self.push(event, data)
                if event in ("done", "error"):
                    return
                if self.abandoned():
                    gave_up = True
                    return
        except Exception as exc:
            self.push("error", {"error": str(exc)})
        finally:
            try:
                self._events.close()
            except Exception:
                pass
            if gave_up and self.prompt_id:
                # 按停的時候 prompt_id 可能還沒回來（cancel() 那時什麼都做不了）：在這裡補做。
                if self.cancelled:
                    try:
                        api("POST", "/queue", {"delete": [self.prompt_id]}, timeout=8)
                    except Exception:
                        pass
                try:
                    comfy_interrupt(self.prompt_id)
                except Exception:
                    pass
            if gave_up:
                self.push("error", {"error": "已取消" if self.cancelled else "連線斷了太久沒接回來，這張已經停掉"})
            self.push("error", {"error": "出圖流程中途結束"})  # 已經結束的不會再記

    def cancel(self) -> None:
        with self.cond:
            self.cancelled = True
            pid = self.prompt_id
            done = self.finished
        if done or not pid:
            return
        # 還在排隊的：從 Comfy 的佇列拿掉（/interrupt 只砍正在畫的那張）。畫到一半的：中斷。
        try:
            api("POST", "/queue", {"delete": [pid]}, timeout=8)
        except Exception:
            pass
        try:
            comfy_interrupt(pid)
        except Exception:
            pass


def find_job(jid: str) -> "GenJob | None":
    with _JOBS_LOCK:
        return _JOBS.get(str(jid or ""))


def gen_events(payload: dict):
    try:
        wf, meta = prepare_workflow(payload)
    except workflows.WorkflowError as exc:
        yield ("error", {"error": str(exc), "code": exc.code})
        return
    except (ValueError, TypeError) as exc:
        yield ("error", {"error": str(exc)})
        return
    seed, width, height, positive = meta["seed"], meta["width"], meta["height"], meta["positive"]
    yield ("queued", {"seed": seed, "width": width, "height": height})
    try:
        yield from gen_via_ws(width, height, seed, positive, wf)
        return
    except WsUnavailable:
        pass
    except Exception as exc:
        yield ("error", {"error": str(exc)})
        return
    try:
        yield ("done", gen(payload))
    except Exception as exc:
        yield ("error", {"error": str(exc)})


def gen(payload: dict) -> dict:
    wf, meta = prepare_workflow(payload)
    seed, width, height, positive = meta["seed"], meta["width"], meta["height"], meta["positive"]
    prompt_id = api("POST", "/prompt", {"prompt": wf}, timeout=60)["prompt_id"]
    hist = wait_done(prompt_id)
    image = first_image_src(hist)
    if not image:
        raise RuntimeError("Comfy 沒有產出圖片")
    return {
        "ok": True,
        "image": image,
        "seed": seed,
        "ckpt": workflows.ckpt_name_of(wf) or CKPT,
        "width": width,
        "height": height,
        "positive": positive,
    }


# --- Telegram: 把成圖投到頻道 ---------------------------------------------
# token 只活在這支程式的記憶體和 .secrets/telegram.json 裡。/api/telegram/config
# 的 GET 只回末四碼，前端拿不到 token 本體。上傳跑在背景執行緒，抽圖不等它。

TG_API = str(cfg("telegram.api", "TELEGRAM_API", "https://api.telegram.org"))
TG_SECRETS = ROOT / ".secrets" / "telegram.json"
TG_CAPTION_MAX = 1024
TG_TEXT_MAX = 4096
TG_GAP = 1.0  # 頻道大約 20 則/分鐘，每則之間隔一秒
TG_RETRY_WAIT = 5.0
# 佇列上限。Telegram 連不上的時候每一張要等 60 秒才失敗，而無限抽十秒就出一張 ——
# 沒有上限就會一路積到記憶體爆掉，而且你按停之後它還要吐好幾個小時。
TG_QUEUE_MAX = int(cfg("telegram.queueMax", "", 200))

_tg_lock = threading.Lock()
_tg_queue: "queue.Queue[dict]" = queue.Queue()
_tg_worker: threading.Thread | None = None
_tg = {
    "token": "",
    "chatId": "",
    "enabled": False,
    "sent": 0,
    "failed": 0,
    "lastError": "",
}


def tg_load() -> None:
    try:
        raw = json.loads(TG_SECRETS.read_text(encoding="utf-8"))
    except Exception:
        return
    if not isinstance(raw, dict):
        return
    with _tg_lock:
        _tg["token"] = str(raw.get("token") or "")
        _tg["chatId"] = str(raw.get("chatId") or "")
        _tg["enabled"] = bool(raw.get("enabled"))


def tg_save() -> None:
    with _tg_lock:
        body = {
            "token": _tg["token"],
            "chatId": _tg["chatId"],
            "enabled": _tg["enabled"],
        }
    TG_SECRETS.parent.mkdir(parents=True, exist_ok=True)
    TG_SECRETS.write_text(json.dumps(body, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        os.chmod(TG_SECRETS, 0o600)
    except OSError:
        pass  # Windows 上沒什麼效果，靠 .gitignore 擋 git


def tg_tail(token: str) -> str:
    t = str(token or "")
    return ("…" + t[-4:]) if len(t) >= 4 else ("…" if t else "")


def tg_scrub(text: str) -> str:
    """別讓 urllib 的例外把含 token 的 URL 帶回前端。"""
    out = str(text)
    with _tg_lock:
        token = _tg["token"]
    if token:
        out = out.replace(token, "***")
    return out


def tg_status() -> dict:
    with _tg_lock:
        return {
            "ok": True,
            "configured": bool(_tg["token"] and _tg["chatId"]),
            "tokenTail": tg_tail(_tg["token"]),
            "chatId": _tg["chatId"],
            "enabled": bool(_tg["enabled"]),
            "sent": _tg["sent"],
            "failed": _tg["failed"],
            "lastError": _tg["lastError"],
            "queued": _tg_queue.qsize(),
        }


def tg_caption(job: dict) -> tuple[str, str]:
    """回 (caption, 補發的文字)。caption 塞不下英文 POS 時，英文另發一則接在圖下面。"""
    head_bits = []
    if job.get("seed") is not None:
        head_bits.append(f"seed {job['seed']}")
    if job.get("width") and job.get("height"):
        head_bits.append(f"{job['width']}x{job['height']}")
    head = " · ".join(head_bits)
    zh = str(job.get("zh") or "").strip()
    en = str(job.get("en") or "").strip()

    full = "\n".join([p for p in (head, zh, en) if p])
    if len(full) <= TG_CAPTION_MAX:
        return full, ""

    short = "\n".join([p for p in (head, zh) if p])
    if len(short) > TG_CAPTION_MAX:
        short = short[: TG_CAPTION_MAX - 1] + "…"
    return short, en


def tg_multipart(fields: dict, filename: str, blob: bytes, mime: str,
                 field: str = "photo") -> tuple[bytes, str]:
    """Telegram 的檔案欄位叫 photo，Discord 要的是 files[0]，其餘完全一樣。"""
    boundary = "----paiziCase" + uuid.uuid4().hex
    sep = ("--" + boundary).encode("utf-8")
    out = bytearray()
    for key, val in fields.items():
        out += sep + b"\r\n"
        out += f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode("utf-8")
        out += str(val).encode("utf-8") + b"\r\n"
    out += sep + b"\r\n"
    out += (
        f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'
        f"Content-Type: {mime}\r\n\r\n"
    ).encode("utf-8")
    out += blob + b"\r\n"
    out += sep + b"--\r\n"
    return bytes(out), boundary


def tg_call(method: str, body: bytes, ctype: str, timeout: float = 60) -> dict:
    with _tg_lock:
        token = _tg["token"]
    if not token:
        raise RuntimeError("沒有 bot token")
    req = urllib.request.Request(
        f"{TG_API}/bot{token}/{method}",
        data=body,
        headers={"Content-Type": ctype},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        try:
            got = json.loads(exc.read().decode("utf-8") or "{}")
        except Exception:
            got = {}
        desc = got.get("description") or f"HTTP {exc.code}"
        err = RuntimeError(f"{exc.code} {desc}")
        err.tg_code = exc.code  # type: ignore[attr-defined]
        raise err from None
    except Exception as exc:
        raise RuntimeError(tg_scrub(str(exc))) from None


def tg_form(method: str, fields: dict, timeout: float = 30) -> dict:
    body = urllib.parse.urlencode(fields).encode("utf-8")
    return tg_call(method, body, "application/x-www-form-urlencoded", timeout)


def tg_send_text(text: str, reply_to: int | None = None) -> dict:
    with _tg_lock:
        chat = _tg["chatId"]
    fields = {"chat_id": chat, "text": text[:TG_TEXT_MAX], "disable_web_page_preview": "true"}
    if reply_to:
        fields["reply_to_message_id"] = str(reply_to)
        fields["allow_sending_without_reply"] = "true"
    return tg_form("sendMessage", fields)


def tg_send_photo(job: dict) -> None:
    q = comfy_view_query(
        job.get("filename") or "",
        job.get("subfolder") or "",
        job.get("type") or "output",
    )
    if not q:
        raise RuntimeError("bad image query")
    blob = api("GET", f"/view?{q}", timeout=60)
    if not isinstance(blob, (bytes, bytearray)):
        raise RuntimeError("Comfy 沒給圖")
    mime = "image/png"
    if blob[:3] == b"\xff\xd8\xff":
        mime = "image/jpeg"
    elif blob[:4] == b"RIFF":
        mime = "image/webp"
    caption, tail = tg_caption(job)
    with _tg_lock:
        chat = _tg["chatId"]
    body, boundary = tg_multipart(
        {"chat_id": chat, "caption": caption},
        str(job.get("filename") or "shot.png"),
        bytes(blob),
        mime,
    )
    got = tg_call("sendPhoto", body, f"multipart/form-data; boundary={boundary}")
    if tail:
        mid = ((got.get("result") or {}).get("message_id")) if isinstance(got, dict) else None
        for i in range(0, len(tail), TG_TEXT_MAX):
            tg_send_text(tail[i : i + TG_TEXT_MAX], mid)
            mid = None


def tg_pump() -> None:
    while True:
        job = _tg_queue.get()
        try:
            try:
                tg_send_photo(job)
            except RuntimeError as exc:
                if getattr(exc, "tg_code", None) == 429:
                    time.sleep(TG_RETRY_WAIT)
                    tg_send_photo(job)
                else:
                    raise
            with _tg_lock:
                _tg["sent"] += 1
                _tg["lastError"] = ""
        except Exception as exc:  # worker 絕不能死
            with _tg_lock:
                _tg["failed"] += 1
                _tg["lastError"] = tg_scrub(str(exc))[:300]
        finally:
            _tg_queue.task_done()
        time.sleep(TG_GAP)


def tg_start() -> None:
    global _tg_worker
    if _tg_worker and _tg_worker.is_alive():
        return
    _tg_worker = threading.Thread(target=tg_pump, name="telegram", daemon=True)
    _tg_worker.start()


def tg_enqueue(job: dict) -> dict:
    with _tg_lock:
        ready = bool(_tg["token"] and _tg["chatId"] and _tg["enabled"])
    if not ready:
        return {"ok": False, "error": "Telegram 還沒設定或沒開"}
    if not comfy_view_query(
        job.get("filename") or "", job.get("subfolder") or "", job.get("type") or "output"
    ):
        return {"ok": False, "error": "bad image query"}
    deep = _tg_queue.qsize()
    if deep >= TG_QUEUE_MAX:
        return {"ok": False, "error": f"Telegram 佇列塞住了（{deep} 張待送），這張不排"}
    tg_start()
    _tg_queue.put(job)
    return {"ok": True, "queued": _tg_queue.qsize()}


def tg_apply_config(payload: dict) -> dict:
    token = str(payload.get("token") or "").strip()
    chat = str(payload.get("chatId") or "").strip()
    with _tg_lock:
        if token:
            _tg["token"] = token
        _tg["chatId"] = chat
        if "enabled" in payload:
            _tg["enabled"] = bool(payload.get("enabled"))
    try:
        tg_save()
    except Exception as exc:
        return {"ok": False, "error": tg_scrub(str(exc))}
    return tg_status()


# ---------------------------------------------------------------- Discord
# 和 Telegram 同一套形狀：設定存在 .secrets/、背景 worker 一張一張送、佇列有上限、
# worker 絕不能死。差別只有三處：認證放 header 不放 URL、頻道 ID 在路徑上、
# 訊息上限 2000 字（Telegram 的 caption 是 1024）。
DC_API = str(cfg("discord.api", "DISCORD_API", "https://discord.com/api/v10"))
DC_SECRETS = ROOT / ".secrets" / "discord.json"
DC_CONTENT_MAX = 2000
# Discord embed 的上限（官方文件）：標題 256、說明 4096、單一欄位值 1024。
DC_TITLE_MAX = 256
DC_DESC_MAX = 4096
# 左側色條。跟介面的 --color-accent 同一個硃砂調。
DC_COLOR = 0xE0563C
DC_GAP = 1.0
DC_RETRY_WAIT = 5.0
DC_QUEUE_MAX = int(cfg("discord.queueMax", "", 200))
# Webhook 模式。Discord 的 webhook 不需要 bot：在頻道設定 → 整合 → 建立 Webhook
# 就拿得到一個網址，POST 上去就好，官方文件對那個端點的說法是
# "does not require authentication"。對「只是單向貼圖」的我們來說，它省掉建
# application、邀 bot 進伺服器、開開發者模式抓頻道 ID 那幾步；而且萬一外洩，
# 它能做的事只有「往那一個頻道貼文」，不像 bot token 是整包權限。
#
# 代價是**網址本身就是憑證**，所以一定要驗證它真的指向 Discord —— 使用者貼錯
# 一行的後果不是「送不出去」，是成圖被 POST 到別人的主機上。
DC_WEBHOOK_HOSTS = ("discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com")

_dc_lock = threading.Lock()
_dc_queue: "queue.Queue[dict]" = queue.Queue()
_dc_worker: threading.Thread | None = None
_dc = {
    "mode": "bot",
    "token": "",
    "channelId": "",
    "webhook": "",
    "enabled": False,
    "sent": 0,
    "failed": 0,
    "lastError": "",
}


def dc_load() -> None:
    try:
        raw = json.loads(DC_SECRETS.read_text(encoding="utf-8"))
    except Exception:
        return
    if not isinstance(raw, dict):
        return
    with _dc_lock:
        _dc["token"] = str(raw.get("token") or "")
        _dc["channelId"] = str(raw.get("channelId") or "")
        _dc["webhook"] = str(raw.get("webhook") or "")
        # 舊的設定檔沒有 mode，那時只有 bot 一條路 —— 預設回 bot，現有設定照舊能用。
        mode = str(raw.get("mode") or "bot")
        _dc["mode"] = mode if mode in ("bot", "webhook") else "bot"
        _dc["enabled"] = bool(raw.get("enabled"))


def dc_save() -> None:
    with _dc_lock:
        body = {
            "mode": _dc["mode"],
            "token": _dc["token"],
            "channelId": _dc["channelId"],
            "webhook": _dc["webhook"],
            "enabled": _dc["enabled"],
        }
    DC_SECRETS.parent.mkdir(parents=True, exist_ok=True)
    DC_SECRETS.write_text(json.dumps(body, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        os.chmod(DC_SECRETS, 0o600)
    except OSError:
        pass  # Windows 上沒什麼效果，靠 .gitignore 擋 git


def dc_scrub(text: str) -> str:
    """別讓例外訊息把憑證帶回前端。

    webhook 網址整條都是憑證（token 就在路徑最後一段），而且它會出現在
    urllib 的錯誤訊息裡，所以兩種模式都要遮。
    """
    out = str(text)
    with _dc_lock:
        token = _dc["token"]
        hook = _dc["webhook"]
    if token:
        out = out.replace(token, "***")
    if hook:
        out = out.replace(hook, "***")
        tail = hook.rstrip("/").rsplit("/", 1)[-1]
        if len(tail) >= 8:
            out = out.replace(tail, "***")
    return out


def _dc_configured_locked() -> bool:
    """設定齊不齊 —— 兩種模式條件不同，所以只寫這一份。

    呼叫者必須已經持有 _dc_lock（它不是可重入鎖）。分成兩份寫過一次就出事：
    面板用模式判斷、佇列卻寫死 bot 的條件，於是 webhook 模式下面板顯示「已設定」，
    每一張圖卻被擋在佇列外，而且錯誤訊息還說「還沒設定」。
    """
    if _dc["mode"] == "webhook":
        return bool(_dc["webhook"])
    return bool(_dc["token"] and _dc["channelId"])


def dc_status() -> dict:
    with _dc_lock:
        mode = _dc["mode"]
        configured = _dc_configured_locked()
        return {
            "ok": True,
            "mode": mode,
            "configured": configured,
            "tokenTail": tg_tail(_dc["token"]),
            "webhookTail": tg_tail(_dc["webhook"]),
            "channelId": _dc["channelId"],
            "enabled": bool(_dc["enabled"]),
            "sent": _dc["sent"],
            "failed": _dc["failed"],
            "lastError": _dc["lastError"],
            "queued": _dc_queue.qsize(),
        }


def dc_safe_filename(name: str) -> str:
    """embed 的 attachment:// 必須和上傳的檔名一字不差，先把奇怪字元濾掉。"""
    keep = "".join(c for c in str(name or "") if c.isalnum() or c in "._-")
    return keep[-100:] or "shot.png"


def dc_fence(text: str, limit: int) -> str:
    """包成 code block，並保證連圍籬一起不超過 limit。"""
    nl = chr(10)
    fence = "```"
    cost = len(fence) * 2 + 2  # 兩道圍籬加兩個換行
    room = max(0, limit - cost)
    body = text if len(text) <= room else text[: max(0, room - 1)] + "…"
    return fence + nl + body + nl + fence


def dc_embed(job: dict, filename: str) -> dict:
    """一張成品的 embed：標題放 seed 和尺寸，說明放中文 POS，圖嵌在裡面。"""
    bits = []
    if job.get("seed") is not None:
        bits.append(f"seed {job['seed']}")
    if job.get("width") and job.get("height"):
        bits.append(f"{job['width']}×{job['height']}")
    embed = {
        "color": DC_COLOR,
        "title": (" · ".join(bits) or "排字匣")[:DC_TITLE_MAX],
        "image": {"url": f"attachment://{filename}"},
    }
    zh = str(job.get("zh") or "").strip()
    if zh:
        embed["description"] = zh if len(zh) <= DC_DESC_MAX else zh[: DC_DESC_MAX - 1] + "…"
    return embed


def dc_content(job: dict) -> str:
    """和 Telegram 同樣的「seed · 尺寸 / 中文 / 英文」，只是上限不同。

    Discord 的 2000 字比 Telegram 的 1024 寬，所以多數情況下英文 POS 塞得進
    同一則，不必像 Telegram 那樣再補一則接在圖下面。
    """
    head_bits = []
    if job.get("seed") is not None:
        head_bits.append(f"seed {job['seed']}")
    if job.get("width") and job.get("height"):
        head_bits.append(f"{job['width']}x{job['height']}")
    head = " · ".join(head_bits)
    zh = str(job.get("zh") or "").strip()
    en = str(job.get("en") or "").strip()
    nl = chr(10)
    full = nl.join([p for p in (head, zh, en) if p])
    if len(full) <= DC_CONTENT_MAX:
        return full
    short = nl.join([p for p in (head, zh) if p])
    if len(short) > DC_CONTENT_MAX:
        short = short[: DC_CONTENT_MAX - 1] + "…"
    return short


def dc_webhook_ok(url: str) -> str:
    """把使用者貼進來的 webhook 網址驗過再收。

    這裡寧可嚴格：網址就是憑證，貼錯一行的後果是成圖被 POST 到別人的主機，
    不是「送不出去」而已。所以只收 https、只收 Discord 的網域、路徑必須是
    /api/webhooks/<id>/<token>。回傳正規化後的網址（去掉查詢字串和結尾斜線）。
    """
    raw = str(url or "").strip()
    if not raw:
        return ""
    try:
        u = urllib.parse.urlsplit(raw)
    except ValueError:
        raise RuntimeError("webhook 網址看不懂") from None
    if u.scheme != "https":
        raise RuntimeError("webhook 網址必須是 https")
    if (u.hostname or "").lower() not in DC_WEBHOOK_HOSTS:
        raise RuntimeError(f"webhook 網址的網域不是 Discord：{u.hostname or '(空)'}")
    path = u.path.rstrip("/")
    if not path.startswith("/api/webhooks/"):
        raise RuntimeError("webhook 網址的路徑不是 /api/webhooks/…")
    bits = [x for x in path.split("/") if x]
    if len(bits) < 4 or not bits[2] or not bits[3]:
        raise RuntimeError("webhook 網址少了 id 或 token")
    return urllib.parse.urlunsplit((u.scheme, u.netloc, path, "", ""))


def dc_endpoint() -> "tuple[str, dict]":
    """要往哪送、要不要帶認證 —— 兩種模式只差這裡，其餘的組版與佇列完全共用。"""
    with _dc_lock:
        mode = _dc["mode"]
        token = _dc["token"]
        channel = _dc["channelId"]
        hook = _dc["webhook"]
    headers = {
        # Discord 會擋掉沒有 User-Agent 的請求。
        "User-Agent": "DanbooruTagRandom (https://github.com/bosen12/danbooru_tag_random, 1.0)",
    }
    if mode == "webhook":
        if not hook:
            raise RuntimeError("沒有 webhook 網址")
        # webhook 不帶 Authorization：token 已經在網址裡，官方文件說這個端點
        # 不需要認證。多送一個 Authorization 反而會被 Discord 當成壞請求。
        return hook, headers
    if not token:
        raise RuntimeError("沒有 bot token")
    if not channel:
        raise RuntimeError("沒有頻道 ID")
    headers["Authorization"] = f"Bot {token}"
    return f"{DC_API}/channels/{urllib.parse.quote(channel)}/messages", headers


def dc_call(body: bytes, ctype: str, timeout: float = 60) -> dict:
    url, headers = dc_endpoint()
    req = urllib.request.Request(
        url,
        data=body,
        headers={**headers, "Content-Type": ctype},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        try:
            got = json.loads(exc.read().decode("utf-8") or "{}")
        except Exception:
            got = {}
        desc = got.get("message") or f"HTTP {exc.code}"
        err = RuntimeError(f"{exc.code} {desc}")
        err.dc_code = exc.code  # type: ignore[attr-defined]
        # 429 要等多久 Discord 自己會講，照它說的等，不要拿固定值猜。
        try:
            err.dc_retry = float(got.get("retry_after") or DC_RETRY_WAIT)  # type: ignore[attr-defined]
        except (TypeError, ValueError):
            err.dc_retry = DC_RETRY_WAIT  # type: ignore[attr-defined]
        raise err from None
    except Exception as exc:
        raise RuntimeError(dc_scrub(str(exc))) from None


def dc_send_text(text: str) -> dict:
    body = json.dumps({"content": text[:DC_CONTENT_MAX]}, ensure_ascii=False).encode("utf-8")
    return dc_call(body, "application/json")


def dc_send_photo(job: dict) -> None:
    q = comfy_view_query(
        job.get("filename") or "",
        job.get("subfolder") or "",
        job.get("type") or "output",
    )
    if not q:
        raise RuntimeError("bad image query")
    blob = api("GET", f"/view?{q}", timeout=60)
    if not isinstance(blob, (bytes, bytearray)):
        raise RuntimeError("Comfy 沒給圖")
    mime = "image/png"
    if blob[:3] == b"\xff\xd8\xff":
        mime = "image/jpeg"
    elif blob[:4] == b"RIFF":
        mime = "image/webp"
    fname = dc_safe_filename(job.get("filename") or "shot.png")
    # 版面：embed 負責好看（色條、標題、中文說明、圖），英文 POS 放在訊息本體的
    # code block —— 那裡有 2000 字可用（embed 欄位只有 1024），而且使用者可以直接複製。
    payload = {"embeds": [dc_embed(job, fname)]}
    en = str(job.get("en") or "").strip()
    if en:
        payload["content"] = dc_fence(en, DC_CONTENT_MAX)
    body, boundary = tg_multipart(
        {"payload_json": json.dumps(payload, ensure_ascii=False)},
        fname,
        bytes(blob),
        mime,
        field="files[0]",
    )
    dc_call(body, f"multipart/form-data; boundary={boundary}")


def dc_pump() -> None:
    while True:
        job = _dc_queue.get()
        try:
            try:
                dc_send_photo(job)
            except RuntimeError as exc:
                if getattr(exc, "dc_code", None) == 429:
                    time.sleep(min(getattr(exc, "dc_retry", DC_RETRY_WAIT), 60))
                    dc_send_photo(job)
                else:
                    raise
            with _dc_lock:
                _dc["sent"] += 1
                _dc["lastError"] = ""
        except Exception as exc:  # worker 絕不能死
            with _dc_lock:
                _dc["failed"] += 1
                _dc["lastError"] = dc_scrub(str(exc))[:300]
        finally:
            _dc_queue.task_done()
        time.sleep(DC_GAP)


def dc_start() -> None:
    global _dc_worker
    if _dc_worker and _dc_worker.is_alive():
        return
    _dc_worker = threading.Thread(target=dc_pump, name="discord", daemon=True)
    _dc_worker.start()


def dc_enqueue(job: dict) -> dict:
    with _dc_lock:
        ready = _dc_configured_locked() and bool(_dc["enabled"])
    if not ready:
        return {"ok": False, "error": "Discord 還沒設定或沒開"}
    if not comfy_view_query(
        job.get("filename") or "", job.get("subfolder") or "", job.get("type") or "output"
    ):
        return {"ok": False, "error": "bad image query"}
    deep = _dc_queue.qsize()
    if deep >= DC_QUEUE_MAX:
        return {"ok": False, "error": f"Discord 佇列塞住了（{deep} 張待送），這張不排"}
    dc_start()
    _dc_queue.put(job)
    return {"ok": True, "queued": _dc_queue.qsize()}


def dc_apply_config(payload: dict) -> dict:
    token = str(payload.get("token") or "").strip()
    channel = str(payload.get("channelId") or "").strip()
    mode = str(payload.get("mode") or "").strip().lower()
    try:
        # 和 token 同一個規矩：留空＝沿用已存的，不是清掉。
        hook = dc_webhook_ok(payload.get("webhook"))
    except Exception as exc:
        return {"ok": False, "error": dc_scrub(str(exc))}
    with _dc_lock:
        if token:
            _dc["token"] = token
        _dc["channelId"] = channel
        if hook:
            _dc["webhook"] = hook
        if mode in ("bot", "webhook"):
            _dc["mode"] = mode
        if "enabled" in payload:
            _dc["enabled"] = bool(payload.get("enabled"))
    try:
        dc_save()
    except Exception as exc:
        return {"ok": False, "error": dc_scrub(str(exc))}
    return dc_status()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        # Windows Console 的 QuickEdit／文字選取會阻塞同步 WriteConsole。
        # BaseHTTPRequestHandler 又會在送 response headers 前記 access log，於是只要
        # 黑窗被選到，每個新請求都卡在這裡，連重新整理 HTML 都載不回來。一般 access
        # log 沒有診斷價值；真正未處理的例外仍由 socketserver 印出 traceback。
        return

    def handle_one_request(self) -> None:
        try:
            super().handle_one_request()
        except (ConnectionError, TimeoutError):
            # 瀏覽器取消還沒載完的圖是常態：八格牆換格、按停、關分頁都會。
            # 不擋的話 socketserver 會為每一次噴一整篇 traceback，跑一整晚就把
            # 真正該看的錯誤淹掉了。
            self.close_connection = True

    def _json(self, code: int, obj: dict, extra=None) -> None:
        blob = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        # 跟靜態檔同一條規則：過 1 KB、客戶端收 gzip、壓完真的比較小才壓。
        # /api/loras 518 KB → 96 KB，手機開 LoRA 選單等的就是這一包。
        packed = None
        if len(blob) > 1024 and "gzip" in (self.headers.get("Accept-Encoding") or ""):
            packed = gzip.compress(blob, 5)
            if len(packed) >= len(blob):
                packed = None
        if packed is not None:
            blob = packed
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(blob)))
        self.send_header("Cache-Control", "no-store")
        if packed is not None:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(blob)

    def _bytes(self, code: int, body: bytes, mime: str, extra=None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _serve_loras(self) -> None:
        self._json(200, lora_scan.list_loras())

    def _serve_checkpoints(self) -> None:
        try:
            items, source = checkpoints_for_ui()
        except Exception:
            items, source = list_ckpts(), "local"
        self._json(
            200,
            {
                "ok": True,
                "dir": str(CKPT_DIR) if CKPT_DIR else "",
                "source": source,
                "current": resolve_ckpt(None, items),
                "items": items,
            },
        )

    def _serve_models(self) -> None:
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        kind = ((qs.get("kind") or ["checkpoints"])[0] or "checkpoints").strip()
        try:
            names = models_from_comfy(kind)
            self._json(200, {"ok": True, "kind": kind, "items": names, "count": len(names)})
        except Exception as exc:
            self._json(502, {"ok": False, "kind": kind, "error": str(exc), "items": [], "count": 0})

    def _serve_comfy_config(self) -> None:
        env = os.environ.get("COMFY_API", "").strip()
        self._json(
            200,
            {
                "ok": True,
                "api": comfy_base(),
                "saved": workflows.saved_comfy_api(),
                "fromEnv": bool(env),
                "default": workflows.DEFAULT_COMFY_API,
            },
        )

    def _apply_comfy_config(self, payload: dict) -> None:
        try:
            saved = workflows.set_comfy_api((payload or {}).get("api"))
        except workflows.WorkflowError as exc:
            self._json(400, {"ok": False, "error": str(exc), "code": exc.code})
            return
        _PING["val"] = None
        _MODEL_CACHE["t"] = 0
        _MODEL_CACHE["data"] = {}
        lora_scan.reset_cache()
        env = os.environ.get("COMFY_API", "").strip()
        self._json(
            200,
            {
                "ok": True,
                "api": comfy_base(),
                "saved": saved,
                "fromEnv": bool(env),
                "note": "目前被環境變數 COMFY_API 鎖定，畫面存的值下次沒設環境變數才會生效。" if env else "",
            },
        )

    def _workflow_pid(self, path: str):
        prefix = "/api/workflows/"
        if not path.startswith(prefix):
            return None
        rest = path[len(prefix) :].strip("/")
        if not rest or "/" in rest or rest in {".", ".."}:
            return None
        return urllib.parse.unquote(rest)

    def _serve_workflow_get(self, path: str) -> None:
        if path == "/api/workflows":
            self._json(200, {"ok": True, "items": workflows.list_profiles()})
            return
        pid = self._workflow_pid(path)
        if not pid:
            self._json(404, {"ok": False, "error": "not found"})
            return
        prof = workflows.get_profile(pid)
        if prof is None:
            self._json(404, {"ok": False, "error": "找不到這個 workflow profile。", "code": "missing_profile"})
            return
        self._json(200, workflows.profile_view(prof))

    def _serve_workflow_save(self, payload: dict) -> None:
        name = str((payload or {}).get("name") or "").strip() or "Workflow"
        wf = (payload or {}).get("workflow")
        mapping = (payload or {}).get("mapping")
        try:
            prof = workflows.save_profile(name, wf, mapping)
        except workflows.WorkflowError as exc:
            self._json(400, {"ok": False, "error": str(exc), "code": exc.code})
            return
        loaded = workflows.get_profile(prof["id"])
        self._json(200, workflows.profile_view(loaded or prof))

    def _serve_workflow_put(self, pid: str, payload: dict) -> None:
        try:
            if "mapping" in (payload or {}):
                workflows.update_mapping(pid, payload.get("mapping"))
            if payload.get("name"):
                prof = workflows.get_profile(pid)
                if prof is None:
                    raise workflows.WorkflowError("找不到這個 workflow profile。", "missing_profile")
                workflows.save_profile(str(payload.get("name")), prof["workflow"], payload.get("mapping") or prof["mapping"], pid=pid)
            loaded = workflows.get_profile(pid)
            if loaded is None:
                raise workflows.WorkflowError("找不到這個 workflow profile。", "missing_profile")
        except workflows.WorkflowError as exc:
            self._json(400, {"ok": False, "error": str(exc), "code": exc.code})
            return
        self._json(200, workflows.profile_view(loaded))

    def _recipe_pid(self, path: str):
        prefix = "/api/recipes/"
        if not path.startswith(prefix):
            return None
        rest = path[len(prefix) :].strip("/")
        if not rest or rest in {"export", "import"}:
            return None
        if rest.startswith("files/"):
            return None
        if "/image" in rest:
            return urllib.parse.unquote(rest.split("/image", 1)[0])
        if "/" in rest or rest in {".", ".."}:
            return None
        return urllib.parse.unquote(rest)

    def _recipe_missing(self, rec: dict) -> dict:
        miss = {"checkpoint": False, "loras": [], "workflow": False}
        ckpt = str(rec.get("checkpoint") or "").replace("/", "\\")
        names = set()
        try:
            items, _ = checkpoints_for_ui()
            for it in items:
                names.add(str(it.get("ckpt_name") or "").replace("/", "\\"))
                names.add(str(it.get("file") or ""))
        except Exception:
            names = set()
        if ckpt and names and ckpt not in names and ckpt.split("\\")[-1] not in names:
            miss["checkpoint"] = True
        have_lora = set()
        try:
            for it in lora_scan.list_loras().get("items") or []:
                have_lora.add(str(it.get("file") or it.get("name") or ""))
                have_lora.add(str(it.get("name") or ""))
        except Exception:
            have_lora = set()
        for lora in rec.get("loras") or []:
            fn = str(lora.get("file") or lora.get("name") or "")
            if fn and have_lora and fn not in have_lora and Path(fn).name not in have_lora:
                miss["loras"].append(fn)
        wid = str(rec.get("workflowId") or "")
        if wid:
            if workflows.get_profile(wid) is None:
                miss["workflow"] = True
        return miss

    def _serve_recipe_get(self, path: str) -> None:
        if path == "/api/recipes":
            self._json(200, {"ok": True, "items": recipes.list_recipes()})
            return
        if path == "/api/recipes/export":
            self._json(200, {"ok": True, "payload": recipes.export_payload()})
            return
        if path.startswith("/api/recipes/files/"):
            name = urllib.parse.unquote(path.split("/api/recipes/files/", 1)[-1])
            stored = recipes.resolve_stored_file(name)
            if stored is None:
                self._json(404, {"ok": False, "error": "not found", "code": "path"})
                return
            raw = stored.read_bytes()
            mime = mimetypes.guess_type(stored.name)[0] or "application/octet-stream"
            self._bytes(200, raw, mime)
            return
        pid = self._recipe_pid(path)
        if not pid:
            self._json(404, {"ok": False, "error": "not found"})
            return
        try:
            rec = recipes.get_recipe(pid)
        except recipes.RecipeError as exc:
            self._json(400, {"ok": False, "error": str(exc), "code": exc.code})
            return
        if rec is None:
            self._json(404, {"ok": False, "error": "找不到這個配方。", "code": "missing"})
            return
        self._json(200, {"ok": True, "recipe": rec, "missing": self._recipe_missing(rec), "reproduce": recipes.reproduce_payload(rec)})

    def _serve_recipe_write(self, path: str, payload: dict) -> None:
        try:
            if path == "/api/recipes/import":
                saved = recipes.import_payload(payload)
                self._json(200, {"ok": True, "items": saved})
                return
            if path == "/api/recipes":
                rec = recipes.save_recipe(payload)
                self._json(200, {"ok": True, "recipe": rec})
                return
            if path.endswith("/image"):
                pid = self._recipe_pid(path)
                if not pid:
                    self._json(404, {"ok": False, "error": "not found"})
                    return
                fn = str((payload or {}).get("filename") or "")
                q = comfy_view_query(fn, (payload or {}).get("subfolder"), (payload or {}).get("type") or "output")
                if not q:
                    self._json(400, {"ok": False, "error": "圖片路徑不合法。", "code": "path"})
                    return
                raw = api("GET", f"/view?{q}", timeout=60)
                if not isinstance(raw, (bytes, bytearray)):
                    self._json(502, {"ok": False, "error": "not an image"})
                    return
                ext = Path(fn).suffix.lower() or ".png"
                rec = recipes.save_image_bytes(pid, bytes(raw), suffix=ext)
                self._json(200, {"ok": True, "recipe": rec})
                return
            pid = self._recipe_pid(path)
            if not pid:
                self._json(404, {"ok": False, "error": "not found"})
                return
            rec = recipes.save_recipe(payload, rid=pid)
            self._json(200, {"ok": True, "recipe": rec})
        except recipes.RecipeError as exc:
            self._json(400, {"ok": False, "error": str(exc), "code": exc.code})
        except Exception as exc:
            self._json(502, {"ok": False, "error": str(exc)})

    def _serve_recipe_delete(self, path: str) -> None:
        pid = self._recipe_pid(path)
        if not pid:
            self._json(404, {"ok": False, "error": "not found"})
            return
        try:
            rec = recipes.delete_recipe(pid)
        except recipes.RecipeError as exc:
            self._json(400, {"ok": False, "error": str(exc), "code": exc.code})
            return
        if rec is None:
            self._json(404, {"ok": False, "error": "找不到這個配方。", "code": "missing"})
            return
        self._json(200, {"ok": True, "recipe": rec})

    def _serve_ckpt_preview(self) -> None:
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        fn = ((qs.get("file") or [""])[0] or "")
        p = ckpt_preview_path(fn)
        if p is None:
            self._json(404, {"ok": False, "error": "not found"})
            return
        low = p.name.lower()
        if low.endswith(".webp"):
            mime = "image/webp"
        elif low.endswith(".png"):
            mime = "image/png"
        elif low.endswith(".jpg") or low.endswith(".jpeg"):
            mime = "image/jpeg"
        else:
            mime = "application/octet-stream"
        try:
            raw = p.read_bytes()
        except OSError as exc:
            self._json(502, {"ok": False, "error": str(exc)})
            return
        self._bytes(200, raw, mime, {"Cache-Control": "private, max-age=86400"})

    def _serve_lora_preview(self) -> None:
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)

        def one(key: str, default: str = "") -> str:
            vals = qs.get(key) or [default]
            return vals[0] if vals else default

        p = lora_scan.preview_path(one("folder"), one("file"))
        if p is None:
            self._json(404, {"ok": False, "error": "not found"})
            return
        fn = p.name.lower()
        if fn.endswith(".mp4"):
            mime = "video/mp4"
        elif fn.endswith(".webm"):
            mime = "video/webm"
        elif fn.endswith(".webp"):
            mime = "image/webp"
        elif fn.endswith(".png"):
            mime = "image/png"
        elif fn.endswith(".jpg") or fn.endswith(".jpeg"):
            mime = "image/jpeg"
        else:
            mime = "application/octet-stream"
        try:
            raw = p.read_bytes()
        except OSError as exc:
            self._json(502, {"ok": False, "error": str(exc)})
            return
        extra = {"Cache-Control": "private, max-age=86400"}
        if lora_scan.is_video_preview(p.name):
            extra["Accept-Ranges"] = "bytes"
        self._bytes(200, raw, mime, extra)

    def _serve_lora_push_get(self) -> None:
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        try:
            since = int((qs.get("since") or ["0"])[0] or 0)
        except ValueError:
            since = 0
        with _LORA_PUSH_LOCK:
            ver, data = _LORA_PUSH["ver"], _LORA_PUSH["data"]
        out = {"ver": ver, "epoch": _LORA_PUSH_EPOCH}
        if ver > since:
            out["data"] = data
        self._json(200, out, _LORA_CORS)

    def _serve_lora_push_post(self, payload: dict) -> None:
        folder = str(payload.get("folder") or "").strip()
        name = str(payload.get("name") or "").strip()
        if not name:
            self._json(400, {"error": "缺少 name"}, _LORA_CORS)
            return
        with _LORA_PUSH_LOCK:
            _LORA_PUSH["ver"] += 1
            _LORA_PUSH["data"] = {"folder": folder, "name": name}
            ver = _LORA_PUSH["ver"]
        print(f"[lora-push] {folder}/{name} (ver={ver})", flush=True)
        self._json(200, {"ok": True, "ver": ver}, _LORA_CORS)

    def _allowed(self) -> bool:
        if allowed_client(self.client_address[0]):
            return True
        self.close_connection = True
        self._json(403, {"ok": False, "error": "forbidden"})
        return False

    def _mutation_allowed(self, path: str, require_json: bool = True) -> bool:
        # LoRA manager runs on another local port and intentionally uses CORS.
        if path == "/api/lora-push":
            return True
        error = mutation_request_error(
            self.headers.get("Origin") or "",
            self.headers.get("Host") or "",
            self.headers.get("Content-Type") or "",
            require_json,
        )
        if error is None:
            return True
        code, message = error
        self.close_connection = True
        self._json(code, {"ok": False, "error": message, "code": "forbidden" if code == 403 else "content_type"})
        return False

    def _sse_job(self, job: GenJob, since: int = 0) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("X-Gen-Job", job.id)
        self.end_headers()
        with job.cond:
            job.watchers += 1
            # 接回來的網頁說它已經收過幾則：只補後面的（重新整理後接回來的給 0，整段重播）。
            sent = max(0, min(int(since), len(job.log)))
        seen_pv = 0
        try:
            while True:
                with job.cond:
                    while (
                        sent >= len(job.log)
                        and not (job.preview and job.preview[0] > seen_pv)
                        and not job.finished
                    ):
                        if not job.cond.wait(timeout=10):
                            break
                    batch = job.log[sent:]
                    sent = len(job.log)
                    pv = job.preview if job.preview and job.preview[0] > seen_pv else None
                    fin = job.finished
                out = b""
                if pv and not fin:
                    seen_pv = pv[0]
                    out += sse("preview", pv[1])
                for event, data in batch:
                    out += sse(event, data)
                # 十秒沒有新東西也寫一行註解：斷掉的連線才會在這裡被發現，不會一直占著。
                self.wfile.write(out or b": keepalive\n\n")
                self.wfile.flush()
                if fin:
                    break
        except OSError:
            pass  # 斷線：工作留著，等網頁接回來（或 GEN_REATTACH_SEC 後自己停）
        finally:
            with job.cond:
                job.watchers -= 1
                if job.watchers <= 0:
                    job.watchers = 0
                    job.left_at = time.time()

    def _sse(self, events) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        gone = False
        # 記下這條串流正在等哪一張。不記的話下面只能送「全域中斷」，那會砍掉
        # Comfy 當下正在跑的任何東西 —— 包含這張早就結束、而使用者已經開始的
        # 下一張。A 卡跑得慢、事件之間空窗大，特別容易踩到。
        prompt_id = None
        try:
            for event, data in events:
                if isinstance(data, dict) and data.get("prompt_id"):
                    prompt_id = data["prompt_id"]
                try:
                    self.wfile.write(sse(event, data))
                    self.wfile.flush()
                except OSError:
                    # 客戶端斷線。Windows 丟的是 ConnectionAbortedError(WinError 10053)，
                    # 它和 BrokenPipeError／ConnectionResetError 是兄弟不是子類 —— 舊寫法
                    # 接不到，於是 /interrupt 不會送，Comfy 繼續把沒人要的圖算完，
                    # 佇列一路積起來，後面每一張都卡在「排隊中」。
                    gone = True
                    break
                if event in ("done", "error"):
                    break
        finally:
            # 明確關掉產生器，讓 gen_via_ws 的 finally 立刻把 websocket 收掉，
            # 而不是等 GC 幫忙。
            try:
                events.close()
            except Exception:
                pass
        if gone:
            try:
                comfy_interrupt(prompt_id)
            except Exception:
                pass

    def _serve_comfy_image(self) -> None:
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)

        def one(key: str, default: str = "") -> str:
            vals = qs.get(key) or [default]
            return vals[0] if vals else default

        q = comfy_view_query(one("filename"), one("subfolder"), one("type") or "output")
        want = one("h").lower()
        if not q or (want and not valid_image_hash(want)):
            self._json(400, {"ok": False, "error": "bad image query"})
            return
        try:
            raw = api("GET", f"/view?{q}", timeout=60)
        except Exception as exc:
            self._json(image_error_code(exc), {"ok": False, "error": str(exc)})
            return
        if not isinstance(raw, (bytes, bytearray)):
            self._json(502, {"ok": False, "error": "not an image"})
            return
        # 快取要用內容當鑰匙，不能用檔名。
        #
        # 以前這裡是 `max-age=86400`，而網址只有 filename/subfolder/type。ComfyUI 的
        # SaveImage 是看輸出資料夾現有的檔案來編號（prefix_00001_.png），所以只要那個
        # 資料夾被清空、或換了一台機器重裝，編號就從頭開始、檔名跟著重複 —— 瀏覽器
        # 於是拿 24 小時前的舊圖來顯示，畫面上看到的是「之前生成過的圖」。
        #
        # 所以 ETag 一律是內容雜湊；整年快取只給網址上帶著內容指紋（h=）、而且對得上的，
        # 規則在 image_cache_policy()。
        digest = image_digest(raw)
        status, cache = image_cache_policy(want, digest)
        if status != 200:
            self._json(status, {"ok": False, "error": "這張圖在 ComfyUI 的輸出資料夾裡已經不在了（檔名被別張圖用掉）"})
            return
        # fmt=webp：晾紙繩、試印、成品預覽用的小檔（約原圖的 1/12）。「開原圖」不帶，拿原本的 PNG。
        webp = comfy_webp(q, digest) if one("fmt") == "webp" else None
        etag = '"' + digest + ("-webp" if webp else "") + '"'
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", cache)
            self.end_headers()
            return
        body = webp or raw
        mime = "image/png"
        if body[:3] == b"\xff\xd8\xff":
            mime = "image/jpeg"
        elif body[:4] == b"RIFF":
            mime = "image/webp"
        safe = one("filename").replace('"', "")
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("ETag", etag)
        self.send_header("Content-Disposition", f'inline; filename="{safe}"')
        self.end_headers()
        try:
            self.wfile.write(body)
        except OSError:
            self.close_connection = True

    def _static_dest(self):
        path = urllib.parse.urlparse(self.path).path
        if path in ("/", ""):
            path = "/index.html"
        return static_path(urllib.parse.unquote(path).lstrip("/"))

    def _cached_file(self, dest: Path) -> dict:
        st = dest.stat()
        key = str(dest)
        hit = _STATIC.get(key)
        if hit and hit["mtime"] == st.st_mtime_ns and hit["size"] == st.st_size:
            return hit
        raw = dest.read_bytes()
        mime = mimetypes.guess_type(dest.name)[0] or "application/octet-stream"
        base = mime.split(";")[0]
        gz = None
        if base in _GZIP_TYPES and len(raw) > 1024:
            packed = gzip.compress(raw, 5)
            if len(packed) < len(raw):
                gz = packed
        rec = {
            "mtime": st.st_mtime_ns,
            "size": st.st_size,
            "raw": raw,
            "gz": gz,
            "mime": mime,
        }
        _STATIC[key] = rec
        return rec

    def _asset_version(self, rel: str) -> str | None:
        """網站上某個檔（相對路徑）的內容指紋：sha1 前 10 字。找不到就 None。"""
        dest = static_path(rel)
        if dest is None:
            return None
        rec = self._cached_file(dest)
        if "v" not in rec:
            rec["v"] = hashlib.sha1(rec["raw"]).hexdigest()[:10]
        return rec["v"]

    def _html_record(self, dest: Path, rec: dict) -> dict:
        """HTML 送出去之前換上帶版本的網址和 import map（見 versioned_html）。結果照內容快取。"""
        try:
            text = rec["raw"].decode("utf-8")
        except UnicodeDecodeError:
            return rec
        out = versioned_html(text, self._asset_version, own_js_files()).encode("utf-8")
        digest = hashlib.sha1(out).hexdigest()[:16]
        hit = _HTML_OUT.get(str(dest))
        if hit and hit["digest"] == digest:
            return hit
        gz = gzip.compress(out, 5) if len(out) > 1024 else None
        new = {
            "raw": out,
            "gz": gz if gz is not None and len(gz) < len(out) else None,
            "mime": rec["mime"],
            "size": len(out),
            "etag": f'"h{digest}"',
            "digest": digest,
        }
        _HTML_OUT[str(dest)] = new
        return new

    def _serve_static(self, body: bool) -> None:
        dest = self._static_dest()
        if dest is None:
            self._json(404, {"ok": False, "error": "not found"})
            return
        rec = self._cached_file(dest)
        if dest.suffix.lower() == ".html":
            rec = self._html_record(dest, rec)
        mime = rec["mime"]
        if mime.split(";")[0] in _GZIP_TYPES:
            mime = f"{mime}; charset=utf-8"
        etag = rec.get("etag") or f'"{rec["mtime"]:x}-{rec["size"]:x}"'
        # 網址帶 ?v=（內容雜湊，卡面 manifest 給的）就是「這個版本永遠不會變」：
        # 內容一換網址就換，所以可以放心整年快取，不必每次回來驗證。
        # 字盒一捲就是幾百張縮圖，手機走 Tailscale 時每張一個 304 來回很有感。
        # 沒帶版本的照舊 no-cache（每次回來問，內容一樣才回 304）。
        # 自己的 .js／.css 的版本是這裡算的，要對得上現在的內容才給整年快取：改檔的那一瞬間
        # 拿著舊版本號來要的，拿到的是新內容 —— 不能讓新內容被記成舊版本號（之後改回去就會拿錯）。
        # 卡面縮圖的 v 是原圖的雜湊（不是縮圖自己的），所以只驗 .js／.css。
        vq = (urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("v") or [""])[0]
        if vq and dest.suffix.lower() in (".js", ".css"):
            if "v" not in rec:
                rec["v"] = hashlib.sha1(rec["raw"]).hexdigest()[:10]
            versioned = vq == rec["v"]
        else:
            versioned = bool(vq)
        cache = "public, max-age=31536000, immutable" if versioned else "no-cache"
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", cache)
            self.end_headers()
            return
        use_gz = (
            body
            and rec["gz"] is not None
            and "gzip" in (self.headers.get("Accept-Encoding") or "")
        )
        data = rec["gz"] if use_gz else rec["raw"]
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data) if body else rec["size"]))
        self.send_header("ETag", etag)
        self.send_header("Cache-Control", cache)
        self.send_header("Vary", "Accept-Encoding")
        if use_gz:
            self.send_header("Content-Encoding", "gzip")
        self.end_headers()
        if body:
            self.wfile.write(data)

    def do_HEAD(self) -> None:
        if not self._allowed():
            return
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/ping":
            self._json(200, ping())
            return
        self._serve_static(False)

    def do_GET(self) -> None:
        if not self._allowed():
            return
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/ping":
            self._json(200, ping())
            return
        if path == "/api/gen/attach":
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            job = find_job((qs.get("job") or [""])[0])
            if job is None:
                self._json(404, {"ok": False, "error": "找不到這張（伺服器重開過，或已經結束太久）"})
                return
            try:
                since = int((qs.get("since") or ["0"])[0])
            except ValueError:
                since = 0
            self._sse_job(job, since)
            return
        if path == "/api/image":
            self._serve_comfy_image()
            return
        if path == "/api/loras":
            self._serve_loras()
            return
        if path == "/api/checkpoints":
            self._serve_checkpoints()
            return
        if path == "/api/models":
            self._serve_models()
            return
        if path == "/api/comfy":
            self._serve_comfy_config()
            return
        if path == "/api/workflows" or path.startswith("/api/workflows/"):
            self._serve_workflow_get(path)
            return
        if path == "/api/ckpt-preview":
            self._serve_ckpt_preview()
            return
        if path == "/api/lora-preview":
            self._serve_lora_preview()
            return
        if path == "/api/lora-push":
            self._serve_lora_push_get()
            return
        if path == "/api/telegram/config":
            self._json(200, tg_status())
            return
        if path == "/api/discord/config":
            self._json(200, dc_status())
            return
        if path == "/api/recipes" or path.startswith("/api/recipes/"):
            self._serve_recipe_get(path)
            return
        self._serve_static(True)

    def do_POST(self) -> None:
        if not self._allowed():
            return
        path = urllib.parse.urlparse(self.path).path
        if not self._mutation_allowed(path):
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length > workflows.MAX_WORKFLOW_BYTES:
            self._json(413, {"ok": False, "error": "JSON 太大（上限 5MB）", "code": "too_large"})
            return
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._json(400, {"ok": False, "error": "不是有效的 JSON。", "code": "invalid"})
            return
        if path == "/api/comfy":
            self._apply_comfy_config(payload)
            return
        if path == "/api/workflows":
            self._serve_workflow_save(payload)
            return
        pid = self._workflow_pid(path)
        if pid:
            self._serve_workflow_put(pid, payload)
            return
        if path == "/api/gen":
            if not ping().get("ok"):
                self._json(503, {"ok": False, "error": "ComfyUI 連不上 " + comfy_base()})
                return
            accept = self.headers.get("Accept") or ""
            if "text/event-stream" in accept:
                if self.headers.get("X-Gen-Resume") == "1":
                    self._sse_job(GenJob(gen_events(payload)).start())
                else:
                    self._sse(gen_events(payload))
                return
            try:
                self._json(200, gen(payload))
            except Exception as exc:
                self._json(500, {"ok": False, "error": str(exc)})
            return
        if path == "/api/gen/cancel":
            job = find_job((payload or {}).get("job"))
            if job is None:
                self._json(404, {"ok": False, "error": "找不到這張（伺服器重開過，或已經結束太久）"})
                return
            job.cancel()
            self._json(200, {"ok": True})
            return
        if path == "/api/interrupt":
            try:
                comfy_interrupt((payload or {}).get("prompt_id"))
                self._json(200, {"ok": True})
            except Exception as exc:
                self._json(500, {"ok": False, "error": str(exc)})
            return
        if path == "/api/lora-push":
            self._serve_lora_push_post(payload)
            return
        if path == "/api/telegram/config":
            self._json(200, tg_apply_config(payload))
            return
        if path == "/api/telegram":
            if payload.get("test"):
                # 測試是同步的：面板要當場看到 Telegram 回什麼。
                try:
                    tg_send_text("排字匣測試訊息。看得到這行就代表 token 和 chat id 都對了。")
                    self._json(200, {"ok": True})
                except Exception as exc:
                    self._json(200, {"ok": False, "error": tg_scrub(str(exc))})
                return
            self._json(200, tg_enqueue(payload))
            return
        if path == "/api/discord/config":
            self._json(200, dc_apply_config(payload))
            return
        if path == "/api/recipes" or path.startswith("/api/recipes/"):
            self._serve_recipe_write(path, payload)
            return
        if path == "/api/discord":
            if payload.get("test"):
                # 測試是同步的：面板要當場看到 Discord 回什麼。
                try:
                    dc_send_text(
                        "排字匣測試訊息。看得到這行就代表 bot token 和頻道 ID 都對了。"
                    )
                    self._json(200, {"ok": True})
                except Exception as exc:
                    self._json(200, {"ok": False, "error": dc_scrub(str(exc))})
                return
            self._json(200, dc_enqueue(payload))
            return
        self._json(404, {"ok": False, "error": "not found"})

    def do_PUT(self) -> None:
        self.do_POST()

    def do_DELETE(self) -> None:
        if not self._allowed():
            return
        path = urllib.parse.urlparse(self.path).path
        if not self._mutation_allowed(path, require_json=False):
            return
        if path.startswith("/api/recipes/"):
            self._serve_recipe_delete(path)
            return
        pid = self._workflow_pid(path)
        if not pid:
            self._json(404, {"ok": False, "error": "not found"})
            return
        ok = workflows.delete_profile(pid)
        if not ok:
            self._json(404, {"ok": False, "error": "找不到這個 workflow profile。", "code": "missing_profile"})
            return
        self._json(200, {"ok": True})

    def do_OPTIONS(self) -> None:
        if not self._allowed():
            return
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/lora-push":
            self.send_response(204)
            for k, v in _LORA_CORS.items():
                self.send_header(k, v)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()


def list_ckpts(root: Path | None = None, prefix: str | None = None) -> list[dict]:
    """Scan the Illustrious checkpoint folder. Comfy ckpt_name is prefix\\file."""
    folder = Path(root) if root is not None else CKPT_DIR
    pre = CKPT_PREFIX if prefix is None else prefix
    items = []
    if folder is None or not folder.is_dir():
        return items
    try:
        names = list(folder.iterdir())
    except OSError:
        return items
    for p in sorted(names, key=lambda x: x.name.lower()):
        if not p.is_file() or p.suffix.lower() not in CKPT_EXTS:
            continue
        if p.name.startswith("."):
            continue
        stem = p.stem
        preview = ""
        for ext in CKPT_PREVIEW_EXTS:
            cand = folder / (stem + ext)
            if cand.is_file():
                preview = cand.name
                break
        items.append(
            {
                "file": p.name,
                "ckpt_name": f"{pre}\\{p.name}",
                "title": stem,
                "preview": preview,
            }
        )
    return items


def pick_default_ckpt(names: list) -> str | None:
    """沒指定底模時用哪個。清單是空的就回 None（交給呼叫端退回 CKPT）。

    CKPT 是作者自己機器上的檔名。別台電腦從 GitHub 拉下來，ComfyUI 裡多半沒有它：
    網頁第一次生圖沒選過底模，就會送這個不存在的名字，每張都被 ComfyUI 退件（HTTP 400）。
    所以預設的在清單裡才用它；不在就挑一個看起來是 Illustrious／動漫 SDXL 的，都不像就第一個。
    """
    names = [str(n).replace("/", "\\") for n in names if n]
    if not names:
        return None
    default = str(CKPT).replace("/", "\\")
    for n in names:
        if n == default or n.split("\\")[-1] == default.split("\\")[-1]:
            return n
    anime = [n for n in names if re.search(r"illustrious|illu|noob|animagine|pony|anime", n, re.I)]
    xl = [n for n in names if re.search(r"xl", n, re.I)]
    return (anime or xl or names)[0]


def resolve_ckpt(name: str | None, items: list | None = None) -> str:
    """Allow names from the provided list (local folder or Comfy object_info).

    空清單代表「沒有白名單、但檔名仍要安全」——遠端 Comfy 的 extra_model_paths
    不會出現在本機 checkpointDir 裡，不能因此退回作者機器的預設檔名。
    """
    if items is None:
        try:
            items, _ = checkpoints_for_ui()
        except Exception:
            items = list_ckpts()
    pool = items
    allowed = {}
    for it in pool:
        key = str(it.get("ckpt_name") or "").replace("/", "\\")
        fn = str(it.get("file") or "")
        if key:
            allowed[key] = key
        if fn:
            allowed[fn] = key or fn
    # 沒指定（或指定的已經不在）時退回哪個：清單裡有預設的就是它，沒有就挑一個清單裡有的。
    fallback = pick_default_ckpt([it.get("ckpt_name") or it.get("file") for it in pool]) or str(CKPT).replace("/", "\\")
    if not name:
        return allowed.get(fallback, fallback)
    raw = str(name).replace("/", "\\").strip()
    parts = [p for p in raw.split("\\") if p]
    if not parts or any(p in (".", "..") for p in parts) or raw.startswith("\\"):
        return allowed.get(fallback, fallback)
    if raw in allowed:
        return allowed[raw]
    if parts[-1] in allowed:
        return allowed[parts[-1]]
    if not allowed:
        return raw
    return allowed.get(fallback, fallback)


def ckpt_preview_path(fn: str, root: Path | None = None) -> Path | None:
    if not fn or "/" in fn or "\\" in fn or fn in (".", "..") or ".." in fn:
        return None
    base = Path(root) if root is not None else CKPT_DIR
    if base is None:
        return None
    folder = base.resolve()
    p = (folder / fn).resolve()
    try:
        p.relative_to(folder)
    except ValueError:
        return None
    if not p.is_file():
        return None
    return p


def checkpoints() -> list[str]:
    info = api("GET", "/object_info/CheckpointLoaderSimple", timeout=15)
    node = (info or {}).get("CheckpointLoaderSimple") or {}
    names = ((node.get("input") or {}).get("required") or {}).get("ckpt_name") or []
    return [str(n) for n in (names[0] if names and isinstance(names[0], list) else [])]


def check_ckpt() -> None:
    """A fresh clone will not have the author's checkpoint. Say so before the first gen fails."""
    try:
        have = checkpoints()
    except Exception:
        return
    if not have or CKPT in have:
        return
    print(f"warn     找不到 checkpoint {CKPT}")
    print("         Comfy 現有的：")
    for name in have[:20]:
        print("           " + name)
    if len(have) > 20:
        print(f"           …還有 {len(have) - 20} 個")
    print("         用 COMFY_CKPT 環境變數指定，或改 start*.bat 裡的 COMFY_CKPT。")


def main() -> None:
    host = str(cfg("server.host", "HOST", "127.0.0.1"))
    port = int(cfg("server.port", "PORT", 8787))
    tg_load()
    dc_load()
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"排字匣  http://{host}:{port}   畫面 {WEB.name}   Comfy {comfy_base()}")
    print("allow    " + ",".join(str(n) for n in ALLOW_NETS))
    print(f"設定檔  {CONFIG_PATH}" + ("" if CONFIG else "（沒有，全部用預設值）"))
    print(f"ckpt     {CKPT}")
    # 第一次 clone 下來最常見的兩個「怎麼是空的」就是這兩項沒設定。
    # 與其讓使用者從空清單反推，開機就講清楚。
    print(
        f"loras    {lora_scan.LORA_ROOT}"
        if lora_scan.LORA_ROOT
        else "loras    （未設定 config.json 的 paths.loraRoot，LoRA 面板會是空的）"
    )
    if not _ckpt_dir:
        print("ckptdir  （未設定 config.json 的 comfy.checkpointDir，換底模清單改問 Comfy）")
    elif CKPT_DIR is not None and CKPT_DIR.is_dir():
        print(f"ckptdir  {CKPT_DIR}")
    else:
        print(f"ckptdir  {_ckpt_dir}（路徑不存在，換底模清單改問 Comfy）")
    st = tg_status()
    if st["configured"]:
        print(f"telegram {st['chatId']}  token {st['tokenTail']}  自動送 {'開' if st['enabled'] else '關'}")
    ds = dc_status()
    if ds["configured"]:
        where = (
            f"webhook {ds['webhookTail']}"
            if ds["mode"] == "webhook"
            else f"{ds['channelId']}  token {ds['tokenTail']}"
        )
        print(f"discord  {where}  自動送 {'開' if ds['enabled'] else '關'}")
    check_ckpt()
    httpd.serve_forever()


if __name__ == "__main__":
    main()
