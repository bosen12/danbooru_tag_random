#!/usr/bin/env python3
"""Serve the tag-case UI and proxy one-at-a-time gens to local ComfyUI."""
from __future__ import annotations

import base64
import json
import mimetypes
import os
import random
import socket
import struct
import sys
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
CKPT = os.environ.get(
    "COMFY_CKPT", r"illurtrious\waiIllustriousSDXL_v170.safetensors"
)
def _negative() -> str:
    path = WEB / "lexicon.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        n = str(data.get("negative") or "").strip()
        if n:
            return n
    except Exception:
        pass
    return (
        "bad quality, worst quality, worst detail, lowres, sketch, censor, censored, "
        "bar censor, mosaic censoring, text, watermark, signature, username, logo, "
        "speech bubble, bad anatomy, bad hands, extra fingers, fused fingers, missing "
        "fingers, extra limbs, deformed, disfigured, ugly, blurry, jpeg artifacts, "
        "3d, realistic, photorealistic, loli, shota, teen, child"
    )


NEGATIVE = _negative()
STEPS = 25
CFG = 6.5
SAMPLER = "euler_ancestral"
SCHEDULER = "normal"
SEED_MAX = 0xFFFFFFFFFFFFFFFF


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


def ping() -> dict:
    try:
        stats = api("GET", "/system_stats", timeout=8)
        ver = ""
        if isinstance(stats, dict):
            ver = str((stats.get("system") or {}).get("comfyui_version") or "")
        return {"ok": True, "base": comfy_base(), "version": ver}
    except Exception as exc:
        return {"ok": False, "base": comfy_base(), "error": str(exc)}


def build_workflow(positive: str, width: int, height: int, seed: int) -> dict:
    return {
        "13": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": CKPT},
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


def wait_done(prompt_id: str, timeout: float = 600) -> dict:
    t0 = time.time()
    while time.time() - t0 < timeout:
        hist = api("GET", f"/history/{prompt_id}", timeout=30)
        if hist and prompt_id in hist:
            return hist[prompt_id]
        time.sleep(1.0)
    raise TimeoutError(prompt_id)


def first_image_b64(history: dict) -> str | None:
    for node_out in (history.get("outputs") or {}).values():
        for img in node_out.get("images") or []:
            fname = img.get("filename")
            if not fname:
                continue
            q = urllib.parse.urlencode(
                {
                    "filename": fname,
                    "subfolder": img.get("subfolder") or "",
                    "type": img.get("type") or "output",
                }
            )
            raw = api("GET", f"/view?{q}", timeout=60)
            if isinstance(raw, (bytes, bytearray)):
                return "data:image/png;base64," + base64.b64encode(raw).decode("ascii")
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


def _job(seed: int, width: int, height: int, positive: str, image: str) -> dict:
    return {
        "ok": True,
        "image": image,
        "seed": seed,
        "ckpt": CKPT,
        "width": width,
        "height": height,
        "positive": positive,
    }


class WsUnavailable(Exception):
    pass


def gen_via_ws(payload: dict, width: int, height: int, seed: int, positive: str, wf: dict):
    cid = uuid.uuid4().hex
    try:
        ws = ws_connect(comfy_base(), cid, timeout=20)
    except Exception as exc:
        raise WsUnavailable(str(exc)) from exc
    posted = api("POST", "/prompt", {"prompt": wf, "client_id": cid}, timeout=60)
    prompt_id = posted["prompt_id"]
    yield ("queued", {"prompt_id": prompt_id, "seed": seed, "width": width, "height": height})
    t0 = time.time()
    try:
        while time.time() - t0 < 600:
            try:
                ws.sock.settimeout(2.0)
                op, data = ws.recv()
            except socket.timeout:
                hist = api("GET", f"/history/{prompt_id}", timeout=20)
                if hist and prompt_id in hist:
                    image = first_image_b64(hist[prompt_id])
                    if image:
                        yield ("done", _job(seed, width, height, positive, image))
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
                    image = first_image_b64(hist[prompt_id])
                    if image:
                        yield ("done", _job(seed, width, height, positive, image))
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
    wf = build_workflow(positive, width, height, seed)
    yield ("queued", {"seed": seed, "width": width, "height": height})
    try:
        yield from gen_via_ws(payload, width, height, seed, positive, wf)
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
    wf = build_workflow(positive, width, height, seed)
    prompt_id = api("POST", "/prompt", {"prompt": wf}, timeout=60)["prompt_id"]
    hist = wait_done(prompt_id)
    image = first_image_b64(hist)
    if not image:
        raise RuntimeError("Comfy 沒有產出圖片")
    return {
        "ok": True,
        "image": image,
        "seed": seed,
        "ckpt": CKPT,
        "width": width,
        "height": height,
        "positive": positive,
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _json(self, code: int, obj: dict) -> None:
        blob = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(blob)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(blob)

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

    def do_GET(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/ping":
            self._json(200, ping())
            return
        if path in ("/", ""):
            path = "/index.html"
        rel = urllib.parse.unquote(path).lstrip("/")
        dest = (WEB / rel).resolve()
        if not str(dest).startswith(str(WEB.resolve())) or not dest.is_file():
            self._json(404, {"ok": False, "error": "not found"})
            return
        mime = mimetypes.guess_type(dest.name)[0] or "application/octet-stream"
        data = dest.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
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
        self._json(404, {"ok": False, "error": "not found"})


def main() -> None:
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8787"))
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"排字匣  http://{host}:{port}   Comfy {comfy_base()}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
