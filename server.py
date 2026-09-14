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
CKPT_DIR = Path(str(_ckpt_dir)) if _ckpt_dir else None
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
    return str(cfg("comfy.api", "COMFY_API", "http://127.0.0.1:8188")).rstrip("/")


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
        val = {
            "ok": True,
            "base": comfy_base(),
            "version": ver,
            # 慢顯卡（AMD ROCm 載模型／搬顯存）可能安靜很久，前端的放棄門檻
            # 得跟著機器走，所以由 config.json 決定而不是寫死在 boot.js。
            "streamIdleMs": int(cfg("client.streamIdleMs", "", 90000)),
        }
    except Exception as exc:
        val = {
            "ok": False,
            "base": comfy_base(),
            "error": str(exc),
            "streamIdleMs": int(cfg("client.streamIdleMs", "", 90000)),
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


# 單張圖的上限。超過就報錯收工，免得 Comfy 卡住的時候無限抽整晚空轉。
GEN_TIMEOUT = float(cfg("comfy.genTimeoutSec", "COMFY_GEN_TIMEOUT", 600))


class WsUnavailable(Exception):
    pass


def gen_via_ws(width: int, height: int, seed: int, positive: str, wf: dict):
    cid = uuid.uuid4().hex
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
                    image = first_image_src(hist[prompt_id])
                    if image:
                        yield ("done", _job(seed, width, height, positive, image, wf["13"]["inputs"].get("ckpt_name")))
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
                image = first_image_src(hist[prompt_id]) if hist and prompt_id in hist else None
                if image:
                    yield ("done", _job(seed, width, height, positive, image, wf["13"]["inputs"].get("ckpt_name")))
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
            elif typ in ("execution_success", "executed"):
                if typ == "executed" and d.get("node") not in (None, "200"):
                    continue
                hist = api("GET", f"/history/{prompt_id}", timeout=30)
                if hist and prompt_id in hist:
                    image = first_image_src(hist[prompt_id])
                    if image:
                        yield ("done", _job(seed, width, height, positive, image, wf["13"]["inputs"].get("ckpt_name")))
                        return
        raise TimeoutError(f"Comfy 超過 {GEN_TIMEOUT} 秒沒有產出（prompt {prompt_id}）")
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
DC_GAP = 1.0
DC_RETRY_WAIT = 5.0
DC_QUEUE_MAX = int(cfg("discord.queueMax", "", 200))

_dc_lock = threading.Lock()
_dc_queue: "queue.Queue[dict]" = queue.Queue()
_dc_worker: threading.Thread | None = None
_dc = {
    "token": "",
    "channelId": "",
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
        _dc["enabled"] = bool(raw.get("enabled"))


def dc_save() -> None:
    with _dc_lock:
        body = {
            "token": _dc["token"],
            "channelId": _dc["channelId"],
            "enabled": _dc["enabled"],
        }
    DC_SECRETS.parent.mkdir(parents=True, exist_ok=True)
    DC_SECRETS.write_text(json.dumps(body, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        os.chmod(DC_SECRETS, 0o600)
    except OSError:
        pass  # Windows 上沒什麼效果，靠 .gitignore 擋 git


def dc_scrub(text: str) -> str:
    """別讓例外訊息把 bot token 帶回前端。"""
    out = str(text)
    with _dc_lock:
        token = _dc["token"]
    if token:
        out = out.replace(token, "***")
    return out


def dc_status() -> dict:
    with _dc_lock:
        return {
            "ok": True,
            "configured": bool(_dc["token"] and _dc["channelId"]),
            "tokenTail": tg_tail(_dc["token"]),
            "channelId": _dc["channelId"],
            "enabled": bool(_dc["enabled"]),
            "sent": _dc["sent"],
            "failed": _dc["failed"],
            "lastError": _dc["lastError"],
            "queued": _dc_queue.qsize(),
        }


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


def dc_call(path: str, body: bytes, ctype: str, timeout: float = 60) -> dict:
    with _dc_lock:
        token = _dc["token"]
    if not token:
        raise RuntimeError("沒有 bot token")
    req = urllib.request.Request(
        f"{DC_API}{path}",
        data=body,
        headers={
            "Content-Type": ctype,
            "Authorization": f"Bot {token}",
            # Discord 會擋掉沒有 User-Agent 的請求。
            "User-Agent": "DanbooruTagRandom (https://github.com/bosen12/danbooru_tag_random, 1.0)",
        },
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
    with _dc_lock:
        channel = _dc["channelId"]
    if not channel:
        raise RuntimeError("沒有頻道 ID")
    body = json.dumps({"content": text[:DC_CONTENT_MAX]}, ensure_ascii=False).encode("utf-8")
    return dc_call(
        f"/channels/{urllib.parse.quote(channel)}/messages",
        body,
        "application/json",
    )


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
    with _dc_lock:
        channel = _dc["channelId"]
    body, boundary = tg_multipart(
        {"payload_json": json.dumps({"content": dc_content(job)}, ensure_ascii=False)},
        str(job.get("filename") or "shot.png"),
        bytes(blob),
        mime,
        field="files[0]",
    )
    dc_call(
        f"/channels/{urllib.parse.quote(channel)}/messages",
        body,
        f"multipart/form-data; boundary={boundary}",
    )


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
        ready = bool(_dc["token"] and _dc["channelId"] and _dc["enabled"])
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
    with _dc_lock:
        if token:
            _dc["token"] = token
        _dc["channelId"] = channel
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
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

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
                "dir": str(CKPT_DIR) if CKPT_DIR else "",
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
        try:
            self.wfile.write(raw)
        except OSError:
            self.close_connection = True

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
        if path == "/api/discord/config":
            self._json(200, dc_status())
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
    if CKPT_DIR is None:
        print("ckptdir  （未設定 config.json 的 comfy.checkpointDir，換底模清單會是空的）")
    st = tg_status()
    if st["configured"]:
        print(f"telegram {st['chatId']}  token {st['tokenTail']}  自動送 {'開' if st['enabled'] else '關'}")
    ds = dc_status()
    if ds["configured"]:
        print(f"discord  {ds['channelId']}  token {ds['tokenTail']}  自動送 {'開' if ds['enabled'] else '關'}")
    check_ckpt()
    httpd.serve_forever()


if __name__ == "__main__":
    main()
