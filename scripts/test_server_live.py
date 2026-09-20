#!/usr/bin/env python3
"""把 server.py 真的叫起來，對著一台假 ComfyUI 跑完整條 /api/gen SSE。

單元測試驗不到的東西在這裡驗：心跳有沒有送、websocket 幀被 2 秒逾時切開之後
預覽圖還原不還原得回來、客戶端半途走人 Comfy 會不會收到 /interrupt。
不需要真的 ComfyUI，也不碰外網。
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import socket
import tempfile
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

failed = 0


def ok(name: str, cond: bool, detail: str = "") -> None:
    global failed
    if cond:
        print(f"ok   {name}")
    else:
        failed += 1
        print(f"FAIL {name}" + (f"\n  {detail}" if detail else ""))


def frame(payload: bytes, opcode: int = 2) -> bytes:
    """伺服器 → 客戶端方向不遮罩。"""
    n = len(payload)
    head = bytes([0x80 | opcode])
    if n < 126:
        head += bytes([n])
    elif n < 65536:
        head += bytes([126]) + struct.pack(">H", n)
    else:
        head += bytes([127]) + struct.pack(">Q", n)
    return head + payload


def text_frame(obj: dict) -> bytes:
    return frame(json.dumps(obj).encode("utf-8"), opcode=1)


PREVIEW = struct.pack(">II", 1, 1) + b"\xff\xd8" + b"P" * 600
PNG = b"\x89PNG\r\n\x1a\n" + b"fake"


class FakeComfy(threading.Thread):
    """一台照劇本演戲的 ComfyUI。plan 決定 websocket 那頭怎麼演。"""

    daemon = True

    def __init__(self, plan: str, save_node: str = "200"):
        super().__init__()
        self.plan = plan
        self.save_node = str(save_node)
        self.srv = socket.socket()
        self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.srv.bind(("127.0.0.1", 0))
        self.srv.listen(16)
        self.port = self.srv.getsockname()[1]
        self.interrupted = threading.Event()
        self.stopping = threading.Event()
        self.have_image = threading.Event()
        self.last_prompt = None

    def run(self) -> None:
        while not self.stopping.is_set():
            try:
                conn, _ = self.srv.accept()
            except OSError:
                return
            threading.Thread(target=self._serve, args=(conn,), daemon=True).start()

    def _serve(self, conn: socket.socket) -> None:
        conn.settimeout(40)
        try:
            head = b""
            while b"\r\n\r\n" not in head:
                chunk = conn.recv(4096)
                if not chunk:
                    return
                head += chunk
            line = head.split(b"\r\n", 1)[0].decode("latin1")
            parts = line.split(" ")
            method, path = parts[0], parts[1]
            if path.startswith("/ws?"):
                self._websocket(conn, head)
                return
            # 把 POST body 吃完再回話。留著不讀就關 socket，Windows 會回 RST，
            # 對面看到的是 WinError 10054 而不是我們的回應。
            raw = head.split(b"\r\n\r\n", 1)[1]
            need = 0
            for h in head.decode("latin1").split("\r\n"):
                if h.lower().startswith("content-length:"):
                    need = int(h.split(":", 1)[1].strip())
            while len(raw) < need:
                more = conn.recv(65536)
                if not more:
                    break
                raw += more
            if path.startswith("/interrupt"):
                self.interrupted.set()
                self._json(conn, {"ok": True})
                return
            if method == "POST":
                try:
                    self.last_prompt = json.loads(raw.decode("utf-8") or "{}")
                except Exception:
                    self.last_prompt = None
                self._json(conn, {"prompt_id": "p1"})
                return
            if path.startswith("/system_stats"):
                self._json(conn, {"system": {"comfyui_version": "fake-1.0"}})
                return
            if path.startswith("/object_info/"):
                self._json(
                    conn,
                    {
                        "CheckpointLoaderSimple": {
                            "input": {"required": {"ckpt_name": [["fake.safetensors"], {}]}}
                        },
                        "LoraLoader": {
                            "input": {"required": {"lora_name": [["style\\a.safetensors"], {}]}}
                        },
                    },
                )
                return
            if path.startswith("/history/"):
                if not self.have_image.is_set():
                    self._json(conn, {})
                    return
                self._json(
                    conn,
                    {
                        "p1": {
                            "outputs": {
                                self.save_node: {
                                    "images": [
                                        {
                                            "filename": "out.png",
                                            "subfolder": "",
                                            "type": "output",
                                        }
                                    ]
                                }
                            }
                        }
                    },
                )
                return
            if path.startswith("/view"):
                self._raw(conn, PNG, "image/png")
                return
            self._json(conn, {})
        except OSError:
            pass
        finally:
            try:
                conn.close()
            except OSError:
                pass

    def _json(self, conn: socket.socket, obj: dict) -> None:
        self._raw(conn, json.dumps(obj).encode(), "application/json")

    def _raw(self, conn: socket.socket, body: bytes, mime: str) -> None:
        head = (
            "HTTP/1.1 200 OK\r\n"
            f"Content-Type: {mime}\r\n"
            f"Content-Length: {len(body)}\r\n"
            "Connection: close\r\n\r\n"
        )
        conn.sendall(head.encode() + body)

    def _websocket(self, conn: socket.socket, head: bytes) -> None:
        key = ""
        for line in head.decode("latin1").split("\r\n"):
            if line.lower().startswith("sec-websocket-key:"):
                key = line.split(":", 1)[1].strip()
        accept = base64.b64encode(hashlib.sha1(key.encode() + GUID).digest()).decode()
        conn.sendall(
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n\r\n".encode()
        )
        getattr(self, f"_plan_{self.plan}")(conn)

    # --- 劇本 ---------------------------------------------------------------

    def _plan_happy(self, conn: socket.socket) -> None:
        conn.sendall(text_frame({"type": "progress", "data": {"value": 5, "max": 25}}))
        conn.sendall(frame(PREVIEW))
        time.sleep(0.3)
        self.have_image.set()
        conn.sendall(text_frame({"type": "executed", "data": {"node": self.save_node}}))
        time.sleep(6)

    def _plan_quiet(self, conn: socket.socket) -> None:
        # 完全不說話 —— 模擬換底模那種長時間靜默。心跳必須自己跑出來。
        time.sleep(14)
        self.have_image.set()
        conn.sendall(text_frame({"type": "executed", "data": {"node": self.save_node}}))
        time.sleep(6)

    def _plan_torn(self, conn: socket.socket) -> None:
        # 一張預覽被切成兩半，中間停 3 秒 —— 跨過 gen_via_ws 的 2 秒 socket timeout。
        # 舊的 Ws.recv() 會在這裡把已經吃掉的幀頭弄丟，之後整條串流永久錯位。
        wire = frame(PREVIEW)
        conn.sendall(wire[:10])
        time.sleep(3.0)
        conn.sendall(wire[10:])
        time.sleep(0.4)
        self.have_image.set()
        conn.sendall(text_frame({"type": "executed", "data": {"node": self.save_node}}))
        time.sleep(6)

    def _plan_hang(self, conn: socket.socket) -> None:
        time.sleep(30)

    def close(self) -> None:
        self.stopping.set()
        try:
            self.srv.close()
        except OSError:
            pass


def start_server(comfy_port: int):
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    env = dict(
        os.environ,
        PYTHONUTF8="1",
        PORT=str(port),
        COMFY_API=f"http://127.0.0.1:{comfy_port}",
        WORKFLOW_DATA_DIR=tempfile.mkdtemp(),
        APP_SETTINGS=str(Path(tempfile.mkdtemp()) / "settings.json"),
    )
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "server.py")],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    for _ in range(150):
        try:
            socket.create_connection(("127.0.0.1", port), 0.2).close()
            return proc, port
        except OSError:
            if proc.poll() is not None:
                log = proc.stdout.read() or ""
                raise RuntimeError(f"server.py 啟動後立即退出（code={proc.returncode}）\n{log}")
            time.sleep(0.1)
    proc.terminate()
    try:
        proc.wait(5)
    except subprocess.TimeoutExpired:
        proc.kill()
    log = proc.stdout.read() or ""
    raise RuntimeError(f"server.py 15 秒內沒有開始監聽\n{log}")


def sse_events(port: int, timeout: float = 45, cut_after=None, payload=None):
    """打 /api/gen 並把 SSE 拆成事件。cut_after 是讀到第幾則就把連線砍掉。"""
    body = json.dumps(
        payload or {"positive": "1girl", "seed": 7, "width": 512, "height": 512}
    ).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/gen",
        data=body,
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
    )
    out = []
    resp = urllib.request.urlopen(req, timeout=timeout)
    try:
        buf = b""
        while True:
            chunk = resp.read(1)
            if not chunk:
                break
            buf += chunk
            while b"\n\n" in buf:
                raw, buf = buf.split(b"\n\n", 1)
                ev, data = "message", "{}"
                for line in raw.decode("utf-8").split("\n"):
                    if line.startswith("event:"):
                        ev = line[6:].strip()
                    elif line.startswith("data:"):
                        data = line[5:].strip()
                out.append((ev, json.loads(data)))
                if cut_after is not None and len(out) >= cut_after:
                    return out
                if ev in ("done", "error"):
                    return out
    finally:
        resp.close()
    return out


def http_json(port: int, method: str, path: str, body=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data is not None else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw.decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            parsed = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            parsed = {"error": raw.decode("utf-8", "replace")}
        return exc.code, parsed


def run(plan: str, **kw):
    comfy = FakeComfy(plan)
    comfy.start()
    proc, port = start_server(comfy.port)
    try:
        events = sse_events(port, **kw)
    finally:
        time.sleep(1.2)  # 讓 /interrupt 有時間送到
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        log = proc.stdout.read() or ""
        comfy.close()
    return events, comfy, log


# === 1. 一切順利 =============================================================
events, comfy, log = run("happy")
kinds = [e for e, _ in events]
ok("順利時最後一則是 done", bool(kinds) and kinds[-1] == "done", str(kinds))
ok("有 queued", "queued" in kinds, str(kinds))
ok("有 progress", "progress" in kinds, str(kinds))
previews = [d for e, d in events if e == "preview"]
ok("預覽有送出來", len(previews) == 1, str(kinds))
if previews:
    got = base64.b64decode(previews[0]["image"].split(",", 1)[1])
    ok("預覽內容正確", got == PREVIEW[8:], f"{len(got)} vs {len(PREVIEW) - 8}")
done = [d for e, d in events if e == "done"]
ok(
    "done 帶得回圖片網址",
    bool(done) and str(done[0].get("image", "")).startswith("/api/image?"),
    str(done),
)
ok("順利時主控台沒有 traceback", "Traceback" not in log, log[-800:])

# === 2. Comfy 長時間靜默 → 心跳要自己跑出來 ==================================
events, comfy, log = run("quiet")
kinds = [e for e, _ in events]
beats = kinds.count("ping")
ok("靜默時有心跳", beats >= 2, f"只有 {beats} 則：{kinds}")
ok("靜默久了還是收得到 done", bool(kinds) and kinds[-1] == "done", str(kinds))
waited = [d.get("waited") for e, d in events if e == "ping" and "waited" in d]
ok(
    "心跳帶著已等待秒數",
    any(isinstance(w, (int, float)) and w > 0 for w in waited),
    str(waited),
)

# === 3. websocket 幀被逾時切成兩半（本次修掉的那個 bug）=======================
events, comfy, log = run("torn")
kinds = [e for e, _ in events]
previews = [d for e, d in events if e == "preview"]
ok("幀被切開後預覽仍然還原得回來", len(previews) == 1, str(kinds))
if previews:
    got = base64.b64decode(previews[0]["image"].split(",", 1)[1])
    ok(
        "切開的幀內容一個 byte 都沒少",
        got == PREVIEW[8:],
        f"{len(got)} vs {len(PREVIEW) - 8}",
    )
ok("幀被切開後照樣走到 done", bool(kinds) and kinds[-1] == "done", str(kinds))
ok("幀被切開時主控台沒有 traceback", "Traceback" not in log, log[-800:])

# === 4. 客戶端半途走人 → Comfy 要收到 /interrupt ==============================
events, comfy, log = run("hang", cut_after=1, timeout=25)
ok("斷線後有叫 Comfy 停手", comfy.interrupted.is_set(), "沒收到 /interrupt")
ok("斷線時主控台沒有 traceback", "Traceback" not in log, log[-800:])

# === 5. 使用者 API workflow：SaveImage 不是 200，原始節點原封不動 ========
_PROFILE = {
    "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "kept.safetensors"}},
    "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "OLD POS", "clip": ["4", 1]}},
    "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "OLD NEG", "clip": ["4", 1]}},
    "3": {
        "class_type": "KSampler",
        "inputs": {
            "seed": 1,
            "steps": 20,
            "cfg": 7,
            "sampler_name": "euler",
            "scheduler": "normal",
            "denoise": 1,
            "model": ["4", 0],
            "positive": ["6", 0],
            "negative": ["7", 0],
            "latent_image": ["5", 0],
        },
    },
    "5": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512, "batch_size": 1}},
    "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
    "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "x", "images": ["8", 0]}},
    "40": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": "keep_me.safetensors"}},
}
comfy = FakeComfy("happy", save_node="9")
comfy.start()
proc, port = start_server(comfy.port)
try:
    code, body = http_json(
        port,
        "POST",
        "/api/workflows",
        {"name": "ui", "workflow": {"nodes": [], "links": [], "version": 0.4}},
    )
    ok("live UI format is 400", code == 400 and body.get("code") == "ui_format", str((code, body)))
    code, body = http_json(
        port,
        "POST",
        "/api/workflows",
        {
            "name": "custom",
            "workflow": _PROFILE,
            "mapping": {
                "positive": {"node": "6", "input": "text", "mode": "control"},
                "checkpoint": {"node": "4", "input": "ckpt_name", "mode": "keep"},
            },
        },
    )
    ok("live API workflow imported", code == 200 and bool(body.get("id")), str(body))
    pid = body.get("id")
    events = sse_events(
        port,
        payload={
            "positive": "1girl from profile",
            "workflowId": pid,
            "seed": 7,
            "width": 512,
            "height": 512,
        },
    )
    kinds = [e for e, _ in events]
    ok("profile gen last event is done", bool(kinds) and kinds[-1] == "done", str(kinds))
    prompt = ((comfy.last_prompt or {}).get("prompt") or {})
    ok(
        "runtime positive injected",
        (prompt.get("6") or {}).get("inputs", {}).get("text") == "1girl from profile",
        str(prompt.get("6")),
    )
    ok(
        "runtime checkpoint kept",
        (prompt.get("4") or {}).get("inputs", {}).get("ckpt_name") == "kept.safetensors",
        str(prompt.get("4")),
    )
    ok("runtime keeps ControlNet", (prompt.get("40") or {}).get("class_type") == "ControlNetLoader")
    ok("runtime has SaveImage 9", (prompt.get("9") or {}).get("class_type") == "SaveImage")
    ok("runtime does not add builtin node 200", "200" not in prompt)
    code, ping_body = http_json(port, "GET", "/api/ping")
    ok("ping still reports connected", ping_body.get("ok") is True, str(ping_body))
finally:
    time.sleep(1.2)
    proc.terminate()
    try:
        proc.wait(10)
    except subprocess.TimeoutExpired:
        proc.kill()
    log = proc.stdout.read() or ""
    comfy.close()
ok("profile gen 主控台沒有 traceback", "Traceback" not in log, log[-800:])

if failed:
    print(f"\n{failed} failed")
    sys.exit(1)
print("\nok")
