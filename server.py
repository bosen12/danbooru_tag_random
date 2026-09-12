#!/usr/bin/env python3
"""Serve the tag-case UI and proxy one-at-a-time gens to local ComfyUI."""
from __future__ import annotations

import base64
import gzip
import ipaddress
import json
import mimetypes
import os
import queue
import random
import socket
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

import lora_scan

ROOT = Path(__file__).resolve().parent
WEB = (ROOT / os.environ.get("WEB_DIR", "web")).resolve()
SHARED = (ROOT / "web").resolve()
CKPT = os.environ.get(
    "COMFY_CKPT", r"illurtrious\waiIllustriousSDXL_v170.safetensors"
)
CKPT_DIR = Path(
    os.environ.get(
        "COMFY_CKPT_DIR",
        r"C:\ComfyUI\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable\ComfyUI\models\checkpoints\illurtrious",
    )
)
CKPT_PREFIX = os.environ.get("COMFY_CKPT_PREFIX", "illurtrious")
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
    # Last resort if lexicon.json is missing. Source of truth: merge_lexicon.NEGATIVE.
    return (
        "bad quality, worst quality, worst detail, lowres, sketch, censor, censored, "
        "bar censor, mosaic censoring, text, watermark, signature, username, logo, "
        "speech bubble, bad anatomy, bad hands, extra fingers, fused fingers, missing "
        "fingers, extra limbs, deformed, disfigured, ugly, blurry, jpeg artifacts, "
        "3d, realistic, photorealistic, loli, shota, teen, child"
    )


NEGATIVE = _negative()
_DEFAULT_ALLOW_NET = "127.0.0.0/8,100.64.0.0/10"


def parse_allow_nets(raw: str | None = None):
    if raw is None:
        raw = os.environ.get("ALLOW_NET", "")
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


STEPS = 25
CFG = 6.5
SAMPLER = "euler_ancestral"
SCHEDULER = "normal"
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
    return "http://127.0.0.1:8188"


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


def ping() -> dict:
    now = time.time()
    if _PING["val"] is not None and now - _PING["t"] < 2:
        return _PING["val"]
    try:
        stats = api("GET", "/system_stats", timeout=8)
        ver = ""
        if isinstance(stats, dict):
            ver = str((stats.get("system") or {}).get("comfyui_version") or "")
        val = {"ok": True, "base": comfy_base(), "version": ver}
    except Exception as exc:
        val = {"ok": False, "base": comfy_base(), "error": str(exc)}
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


def build_workflow(positive: str, width: int, height: int, seed: int, loras=None, ckpt=None) -> dict:
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
            "inputs": {"text": NEGATIVE, "clip": ["13", 1]},
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


def first_image_src(history: dict) -> str | None:
    for node_out in (history.get("outputs") or {}).values():
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


class Ws:
    def __init__(self, sock: socket.socket, buf: bytes = b""):
        self.sock = sock
        self.buf = buf

    def _read(self, n: int) -> bytes:
        while len(self.buf) < n:
            chunk = self.sock.recv(max(4096, n - len(self.buf)))
            if not chunk:
                raise ConnectionError("ws closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv(self) -> tuple[int, bytes]:
        b0 = self._read(1)[0]
        b1 = self._read(1)[0]
        opcode = b0 & 0x0F
        n = b1 & 0x7F
        if n == 126:
            n = struct.unpack(">H", self._read(2))[0]
        elif n == 127:
            n = struct.unpack(">Q", self._read(8))[0]
        if b1 & 0x80:
            key = self._read(4)
            data = bytes(c ^ key[i % 4] for i, c in enumerate(self._read(n)))
        else:
            data = self._read(n)
        return opcode, data

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
    path = "/ws?clientId=" + urllib.parse.quote(client_id)
    sock = socket.create_connection((host, port), timeout=timeout)
    sock.settimeout(timeout)
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    req = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
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
        "image": image,
        "seed": seed,
        "ckpt": ckpt or CKPT,
        "width": width,
        "height": height,
        "positive": positive,
    }


class WsUnavailable(Exception):
    pass


def gen_via_ws(width: int, height: int, seed: int, positive: str, wf: dict):
    cid = uuid.uuid4().hex
    try:
        ws = ws_connect(comfy_base(), cid, timeout=20)
    except Exception as exc:
        raise WsUnavailable(str(exc)) from exc
    posted = api("POST", "/prompt", {"prompt": wf, "client_id": cid}, timeout=60)
    prompt_id = posted["prompt_id"]
    t0 = time.time()
    try:
        while time.time() - t0 < 600:
            try:
                ws.sock.settimeout(2.0)
                op, data = ws.recv()
            except socket.timeout:
                hist = api("GET", f"/history/{prompt_id}", timeout=20)
                if hist and prompt_id in hist:
                    image = first_image_src(hist[prompt_id])
                    if image:
                        yield ("done", _job(seed, width, height, positive, image, wf["13"]["inputs"].get("ckpt_name")))
                        return
                continue
            if op == 8:
                break
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
            msg = json.loads(data.decode("utf-8"))
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
            elif typ in ("execution_success", "executed"):
                if typ == "executed" and d.get("node") not in (None, "200"):
                    continue
                hist = api("GET", f"/history/{prompt_id}", timeout=30)
                if hist and prompt_id in hist:
                    image = first_image_src(hist[prompt_id])
                    if image:
                        yield ("done", _job(seed, width, height, positive, image, wf["13"]["inputs"].get("ckpt_name")))
                        return
        raise TimeoutError(prompt_id)
    finally:
        ws.close()


def gen_events(payload: dict):
    positive = str(payload.get("positive") or "").strip()
    if not positive:
        yield ("error", {"error": "missing positive"})
        return
    width = max(256, min(int(payload.get("width") or 1024), 2048))
    height = max(256, min(int(payload.get("height") or 1024), 2048))
    seed = payload.get("seed")
    if seed is None or seed == "":
        seed = random.randint(0, SEED_MAX)
    seed = int(seed) & SEED_MAX
    wf = build_workflow(positive, width, height, seed, payload.get("loras"), payload.get("ckpt"))
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
    positive = str(payload.get("positive") or "").strip()
    if not positive:
        raise ValueError("missing positive")
    width = int(payload.get("width") or 1024)
    height = int(payload.get("height") or 1024)
    width = max(256, min(width, 2048))
    height = max(256, min(height, 2048))
    seed = payload.get("seed")
    if seed is None or seed == "":
        seed = random.randint(0, SEED_MAX)
    seed = int(seed) & SEED_MAX
    wf = build_workflow(positive, width, height, seed, payload.get("loras"), payload.get("ckpt"))
    prompt_id = api("POST", "/prompt", {"prompt": wf}, timeout=60)["prompt_id"]
    hist = wait_done(prompt_id)
    image = first_image_src(hist)
    if not image:
        raise RuntimeError("Comfy 沒有產出圖片")
    return {
        "ok": True,
        "image": image,
        "seed": seed,
        "ckpt": wf["13"]["inputs"].get("ckpt_name") or CKPT,
        "width": width,
        "height": height,
        "positive": positive,
    }


# --- Telegram: 把成圖投到頻道 ---------------------------------------------
# token 只活在這支程式的記憶體和 .secrets/telegram.json 裡。/api/telegram/config
# 的 GET 只回末四碼，前端拿不到 token 本體。上傳跑在背景執行緒，抽圖不等它。

TG_API = os.environ.get("TELEGRAM_API", "https://api.telegram.org")
TG_SECRETS = ROOT / ".secrets" / "telegram.json"
TG_CAPTION_MAX = 1024
TG_TEXT_MAX = 4096
TG_GAP = 1.0  # 頻道大約 20 則/分鐘，每則之間隔一秒
TG_RETRY_WAIT = 5.0

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


def tg_multipart(fields: dict, filename: str, blob: bytes, mime: str) -> tuple[bytes, str]:
    boundary = "----paiziCase" + uuid.uuid4().hex
    sep = ("--" + boundary).encode("utf-8")
    out = bytearray()
    for key, val in fields.items():
        out += sep + b"\r\n"
        out += f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode("utf-8")
        out += str(val).encode("utf-8") + b"\r\n"
    out += sep + b"\r\n"
    out += (
        f'Content-Disposition: form-data; name="photo"; filename="{filename}"\r\n'
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


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _json(self, code: int, obj: dict, extra=None) -> None:
        blob = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(blob)))
        self.send_header("Cache-Control", "no-store")
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
        items = list_ckpts()
        self._json(
            200,
            {
                "ok": True,
                "dir": str(CKPT_DIR),
                "current": resolve_ckpt(None, items),
                "items": items,
            },
        )

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

    def _sse(self, events) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        try:
            for event, data in events:
                self.wfile.write(sse(event, data))
                self.wfile.flush()
                if event in ("done", "error"):
                    break
        except (BrokenPipeError, ConnectionResetError):
            try:
                api("POST", "/interrupt", {}, timeout=8)
            except Exception:
                pass

    def _serve_comfy_image(self) -> None:
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)

        def one(key: str, default: str = "") -> str:
            vals = qs.get(key) or [default]
            return vals[0] if vals else default

        q = comfy_view_query(one("filename"), one("subfolder"), one("type") or "output")
        if not q:
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
        mime = "image/png"
        if raw[:3] == b"\xff\xd8\xff":
            mime = "image/jpeg"
        elif raw[:4] == b"RIFF":
            mime = "image/webp"
        safe = one("filename").replace('"', "")
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "private, max-age=86400")
        self.send_header("Content-Disposition", f'inline; filename="{safe}"')
        self.end_headers()
        self.wfile.write(raw)

    def _static_dest(self):
        path = urllib.parse.urlparse(self.path).path
        if path in ("/", ""):
            path = "/index.html"
        rel = urllib.parse.unquote(path).lstrip("/")
        dest = (WEB / rel).resolve()
        if dest.is_relative_to(WEB) and dest.is_file():
            return dest
        shared = (SHARED / rel).resolve()
        if shared.is_relative_to(SHARED) and shared.is_file():
            return shared
        return None

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

    def _serve_static(self, body: bool) -> None:
        dest = self._static_dest()
        if dest is None:
            self._json(404, {"ok": False, "error": "not found"})
            return
        rec = self._cached_file(dest)
        mime = rec["mime"]
        if mime.split(";")[0] in _GZIP_TYPES:
            mime = f"{mime}; charset=utf-8"
        etag = f'"{rec["mtime"]:x}-{rec["size"]:x}"'
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "no-cache")
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
        self.send_header("Cache-Control", "no-cache")
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
        if path == "/api/image":
            self._serve_comfy_image()
            return
        if path == "/api/loras":
            self._serve_loras()
            return
        if path == "/api/checkpoints":
            self._serve_checkpoints()
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
        self._serve_static(True)

    def do_POST(self) -> None:
        if not self._allowed():
            return
        path = urllib.parse.urlparse(self.path).path
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._json(400, {"ok": False, "error": "bad json"})
            return
        if path == "/api/gen":
            if not ping().get("ok"):
                self._json(503, {"ok": False, "error": "ComfyUI 連不上 " + comfy_base()})
                return
            accept = self.headers.get("Accept") or ""
            if "text/event-stream" in accept:
                self._sse(gen_events(payload))
                return
            try:
                self._json(200, gen(payload))
            except Exception as exc:
                self._json(500, {"ok": False, "error": str(exc)})
            return
        if path == "/api/interrupt":
            try:
                api("POST", "/interrupt", {}, timeout=8)
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
        self._json(404, {"ok": False, "error": "not found"})

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
    if not folder.is_dir():
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


def resolve_ckpt(name: str | None, items: list | None = None) -> str:
    """Only allow files from the Illustrious folder. Unknown names fall back to default."""
    pool = items if items is not None else list_ckpts()
    allowed = {}
    for it in pool:
        key = str(it.get("ckpt_name") or "").replace("/", "\\")
        fn = str(it.get("file") or "")
        if key:
            allowed[key] = key
        if fn:
            allowed[fn] = key or fn
    fallback = str(CKPT).replace("/", "\\")
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
    return allowed.get(fallback, fallback)


def ckpt_preview_path(fn: str, root: Path | None = None) -> Path | None:
    if not fn or "/" in fn or "\\" in fn or fn in (".", "..") or ".." in fn:
        return None
    folder = (Path(root) if root is not None else CKPT_DIR).resolve()
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
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8787"))
    tg_load()
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"排字匣  http://{host}:{port}   畫面 {WEB.name}   Comfy {comfy_base()}")
    print("allow    " + ",".join(str(n) for n in ALLOW_NETS))
    print(f"ckpt     {CKPT}")
    print(f"loras    {lora_scan.LORA_ROOT}")
    st = tg_status()
    if st["configured"]:
        print(f"telegram {st['chatId']}  token {st['tokenTail']}  自動送 {'開' if st['enabled'] else '關'}")
    check_ckpt()
    httpd.serve_forever()


if __name__ == "__main__":
    main()
