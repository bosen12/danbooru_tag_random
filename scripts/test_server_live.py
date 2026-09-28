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
import re
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
        self.queue_deleted = None
        self.view_body = PNG
        self.uploaded = False

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
            if method == "POST" and path.split("?", 1)[0] == "/upload/image":
                self.uploaded = True
                self._json(conn, {"name": "hires_test.png", "subfolder": "danbooru_hires", "type": "input"})
                return
            if path.startswith("/interrupt"):
                self.interrupted.set()
                self._json(conn, {"ok": True})
                return
            if path.startswith("/queue") and method == "POST":
                try:
                    self.queue_deleted = json.loads(raw.decode("utf-8") or "{}").get("delete")
                except Exception:
                    self.queue_deleted = "?"
                self._json(conn, {})
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
                self._raw(conn, self.view_body, "image/png")
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

    def _plan_slow(self, conn: socket.socket) -> None:
        # 畫得慢：先回報一格進度，四秒後才出圖 —— 中間讓客戶端斷線、再接回來。
        conn.sendall(text_frame({"type": "progress", "data": {"value": 5, "max": 25}}))
        conn.sendall(frame(PREVIEW))
        time.sleep(4)
        conn.sendall(text_frame({"type": "progress", "data": {"value": 24, "max": 25}}))
        self.have_image.set()
        conn.sendall(text_frame({"type": "executed", "data": {"node": self.save_node}}))
        time.sleep(6)

    def _plan_interrupted(self, conn: socket.socket) -> None:
        # 別張被中斷的廣播不能誤判；自己這張被中斷要馬上收工，不能等到 10 分鐘逾時。
        conn.sendall(text_frame({"type": "execution_interrupted", "data": {"prompt_id": "someone-else"}}))
        conn.sendall(text_frame({"type": "progress", "data": {"value": 3, "max": 25}}))
        time.sleep(0.5)
        conn.sendall(text_frame({"type": "execution_interrupted", "data": {"prompt_id": "p1"}}))
        time.sleep(20)

    def close(self) -> None:
        self.stopping.set()
        try:
            self.srv.close()
        except OSError:
            pass


def start_server(comfy_port: int, extra_env=None):
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
        WEBP_CACHE_DIR=tempfile.mkdtemp(),
        # 測試起的伺服器不要去 GitHub 抓卡面（剛 clone 下來沒有插畫時會）。
        NO_CARD_FETCH="1",
        **(extra_env or {}),
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


def sse_stream(port: int, path: str = "/api/gen", payload=None, resume=True, cut_after=None, timeout: float = 45):
    """跟 sse_events 一樣，但可以帶 X-Gen-Resume、打 /api/gen/attach；回 (事件, job id, 狀態碼)。"""
    headers = {"Accept": "text/event-stream"}
    data = None
    if path == "/api/gen":
        data = json.dumps(payload or {"positive": "1girl", "seed": 7, "width": 512, "height": 512}).encode()
        headers["Content-Type"] = "application/json"
    if resume:
        headers["X-Gen-Resume"] = "1"
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, headers=headers)
    out = []
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as exc:
        return [], None, exc.code
    job = resp.headers.get("X-Gen-Job")
    try:
        buf = b""
        while True:
            chunk = resp.read(1)
            if not chunk:
                break
            buf += chunk
            while b"\n\n" in buf:
                raw_ev, buf = buf.split(b"\n\n", 1)
                ev, data_s = "message", None
                for line in raw_ev.decode("utf-8").split("\n"):
                    if line.startswith("event:"):
                        ev = line[6:].strip()
                    elif line.startswith("data:"):
                        data_s = line[5:].strip()
                if data_s is None:
                    continue  # 註解（keepalive）
                out.append((ev, json.loads(data_s)))
                if cut_after is not None and len(out) >= cut_after:
                    return out, job, 200
                if ev in ("done", "error"):
                    return out, job, 200
    finally:
        resp.close()
    return out, job, 200


def http_json(port: int, method: str, path: str, body=None, headers=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    request_headers = dict(headers or {})
    if data is not None and "Content-Type" not in request_headers:
        request_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=data,
        method=method,
        headers=request_headers,
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
    code, body = http_json(
        port,
        "POST",
        "/api/comfy",
        {"api": "https://attacker.example"},
        {"Content-Type": "application/json", "Origin": "https://attacker.example"},
    )
    ok("cross-site settings mutation is rejected", code == 403, str((code, body)))
    code, body = http_json(
        port,
        "POST",
        "/api/comfy",
        {"api": "https://attacker.example"},
        {"Content-Type": "text/plain", "Origin": f"http://127.0.0.1:{port}"},
    )
    ok("non-JSON settings mutation is rejected", code == 415, str((code, body)))
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

# === 6. 可以接回去的出圖（X-Gen-Resume）=======================================
# 從 Mac 走 Tailscale 付印時網路斷一下，不該把 Comfy 正在畫的那張砍掉。


def with_server(plan: str, body, extra_env=None):
    comfy = FakeComfy(plan)
    comfy.start()
    proc, port = start_server(comfy.port, dict({"GEN_REATTACH_SEC": "3"}, **(extra_env or {})))
    try:
        body(port, comfy)
    finally:
        time.sleep(0.5)
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        log = proc.stdout.read() or ""
        comfy.close()
    ok(f"{plan}：主控台沒有 traceback", "Traceback" not in log, log[-800:])


def _resume_happy(port, comfy):
    events, job, code = sse_stream(port, payload={"positive": "1girl", "seed": 7, "width": 512, "height": 512})
    kinds = [e for e, _ in events]
    ok("可接回的出圖：回應帶著 X-Gen-Job", bool(job) and len(job) >= 8, str(job))
    ok("可接回的出圖：照樣走到 done", bool(kinds) and kinds[-1] == "done", str(kinds))
    ok("可接回的出圖：預覽照樣送", "preview" in kinds, str(kinds))


with_server("happy", _resume_happy)


def _resume_reattach(port, comfy):
    first, job, _ = sse_stream(port, cut_after=1)
    ok("斷線前拿到 job id", bool(job), str(first))
    time.sleep(1.0)
    ok("斷線後、寬限時間內，Comfy 沒被中斷", not comfy.interrupted.is_set())
    events, job2, code = sse_stream(port, path=f"/api/gen/attach?job={job}", resume=False)
    kinds = [e for e, _ in events]
    ok("接回來是同一張", code == 200 and job2 == job, str((code, job2, job)))
    ok("接回來從頭重播（queued 還在）", "queued" in kinds, str(kinds))
    ok("接回來收得到 done", bool(kinds) and kinds[-1] == "done", str(kinds))
    ok("接回來那張圖沒被中斷", not comfy.interrupted.is_set())
    again, _, code = sse_stream(port, path=f"/api/gen/attach?job={job}", resume=False)
    ok("結束之後再接一次也拿得到結果", bool(again) and again[-1][0] == "done", str([e for e, _ in again]))
    tail, _, code = sse_stream(port, path=f"/api/gen/attach?job={job}&since={len(again) - 1}", resume=False)
    ok("帶 since 接回來只補沒收到的（不再從 queued 重播）", code == 200 and [e for e, _ in tail] == ["done"], str([e for e, _ in tail]))


with_server("slow", _resume_reattach)


def _resume_abandon(port, comfy):
    sse_stream(port, cut_after=1)
    t0 = time.time()
    got = comfy.interrupted.wait(15)
    ok("斷線後一直沒人接回來：寬限過後照舊叫 Comfy 停手", got, "沒收到 /interrupt")
    ok("不是一斷線就砍（有等寬限時間）", got and time.time() - t0 >= 2.0, f"{time.time() - t0:.1f}s")


with_server("hang", _resume_abandon)


def _resume_cancel(port, comfy):
    first, job, _ = sse_stream(port, cut_after=2)
    code, body = http_json(port, "POST", "/api/gen/cancel", {"job": job})
    ok("按停：/api/gen/cancel 回 200", code == 200, str((code, body)))
    ok("按停：Comfy 收到中斷", comfy.interrupted.wait(8))
    for _ in range(80):
        if comfy.queue_deleted:
            break
        time.sleep(0.1)
    ok("按停：排隊中的也從 Comfy 佇列刪掉", comfy.queue_deleted == ["p1"], str(comfy.queue_deleted))
    code, body = http_json(port, "POST", "/api/gen/cancel", {"job": "nope"})
    ok("停一張不存在的：404", code == 404, str((code, body)))
    events, _, code = sse_stream(port, path="/api/gen/attach?job=0123456789abcdef", resume=False)
    ok("接一張不存在的：404", code == 404, str(code))


with_server("hang", _resume_cancel)


def _interrupted(port, comfy):
    t0 = time.time()
    events, job, _ = sse_stream(port, resume=False, timeout=25)
    kinds = [e for e, _ in events]
    ok("Comfy 那頭中斷了這張：馬上收工，不等 10 分鐘逾時", bool(kinds) and kinds[-1] == "error" and time.time() - t0 < 10, f"{kinds} {time.time() - t0:.1f}s")
    errs = [d.get("error", "") for e, d in events if e == "error"]
    ok("錯誤訊息說是中斷", any("中斷" in e for e in errs), str(errs))
    ok("別張被中斷的廣播不算（前面照樣收到進度）", "progress" in kinds, str(kinds))


with_server("interrupted", _interrupted)

# 沒帶 X-Gen-Resume 的舊房間：斷線照舊馬上中斷（上面第 4 段），這裡再確認一次不受寬限影響。
def _legacy_cut(port, comfy):
    sse_stream(port, resume=False, cut_after=1, timeout=25)
    ok("沒說要接回來的舊房間：一斷線就中斷，不等寬限", comfy.interrupted.wait(8))


with_server("hang", _legacy_cut, {"GEN_REATTACH_SEC": "60"})

# === 7. HTML 裡的程式檔帶版本、帶版本的才整年快取 =================================
comfy = FakeComfy("happy")
comfy.start()
proc, port = start_server(comfy.port)
try:
    req = urllib.request.Request(f"http://127.0.0.1:{port}/")
    with urllib.request.urlopen(req, timeout=20) as resp:
        page = resp.read().decode("utf-8")
    ok("首頁送出去時帶著 import map", page.count('type="importmap"') == 1, page[:400])
    m = re.search(r'"/engine\.js":"/engine\.js\?v=([0-9a-f]{10})"', page)
    ok("import map 裡 engine.js 帶內容版本", bool(m), page[:600])
    if m:
        def cache_of(path):
            with urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{port}{path}"), timeout=20) as r:
                return r.headers.get("Cache-Control", "")
        ok("版本對得上：整年快取", "immutable" in cache_of(f"/engine.js?v={m.group(1)}"))
        ok("版本對不上（改檔的那一瞬間拿舊版本號來要）：不准快取", cache_of("/engine.js?v=0000000000") == "no-cache")
        ok("沒帶版本：照舊每次回來問", cache_of("/engine.js") == "no-cache")
finally:
    proc.terminate()
    try:
        proc.wait(10)
    except subprocess.TimeoutExpired:
        proc.kill()
    log = proc.stdout.read() or ""
    comfy.close()
ok("帶版本的首頁：主控台沒有 traceback", "Traceback" not in log, log[-800:])


# === 8. 請求本體：負數長度、頂層不是物件、不是 UTF-8；HEAD 不帶主體 ============
import http.client as _hc
import socket as _socket

comfy = FakeComfy("happy")
comfy.start()
proc, port = start_server(comfy.port)
try:
    def raw_post(body: bytes, length: str) -> str:
        s = _socket.create_connection(("127.0.0.1", port), timeout=5)
        s.sendall(
            b"POST /api/workflows HTTP/1.1\r\nHost: 127.0.0.1:" + str(port).encode()
            + b"\r\nContent-Type: application/json\r\nContent-Length: " + length.encode()
            + b"\r\n\r\n" + body
        )
        try:
            return s.recv(4096).decode("utf-8", "replace").split("\r\n")[0]
        except _socket.timeout:
            return "TIMEOUT"
        finally:
            s.close()

    ok("Content-Length 負數：馬上 400，不會卡住等連線關掉", " 400 " in raw_post(b"{}", "-1"))
    ok("Content-Length 不是數字：400", " 400 " in raw_post(b"{}", "abc"))
    ok("頂層是陣列：400，不是斷線", " 400 " in raw_post(b"[1]", "3"))
    ok("不是 UTF-8：400", " 400 " in raw_post(b"\xff\xfe", "2"))

    c = _hc.HTTPConnection("127.0.0.1", port, timeout=10)
    c.request("HEAD", "/api/ping")
    r = c.getresponse()
    r.read()
    ok("HEAD /api/ping 有 Content-Length", r.status == 200 and int(r.headers.get("Content-Length") or 0) > 0)
    # 同一條連線接著問：HEAD 若多寫了主體，這一次會解析錯位。
    c.request("GET", "/api/ping")
    r2 = c.getresponse()
    body2 = r2.read()
    ok("HEAD 之後同一條連線的 GET 解析正常", r2.status == 200 and body2.startswith(b"{"), repr(body2[:80]))
    c.close()
finally:
    proc.terminate()
    try:
        proc.wait(10)
    except subprocess.TimeoutExpired:
        proc.kill()
    log = proc.stdout.read() or ""
    comfy.close()
ok("壞請求本體：主控台沒有 traceback", "Traceback" not in log, log[-800:])


# === 9. 首屏兩包 JSON 走內容版本網址、/api/loras 條件式快取 ==================
comfy = FakeComfy("happy")
comfy.start()
proc, port = start_server(comfy.port, {"WEB_DIR": "web6"})
try:
    with urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{port}/"), timeout=20) as resp:
        page = resp.read().decode("utf-8")
    mv = re.search(r'href="lexicon\.json\?v=([0-9a-f]{10})"', page)
    ok("首頁的 lexicon.json preload 帶內容版本", bool(mv), page[:800])
    if mv:
        def head_of(path):
            with urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{port}{path}"), timeout=20) as r:
                return r.headers.get("Cache-Control", ""), r.status
        cc, st = head_of(f"/lexicon.json?v={mv.group(1)}")
        ok("lexicon.json 版本對得上：整年快取", st == 200 and "immutable" in cc, cc)
        cc, st = head_of("/lexicon.json?v=0000000000")
        ok("lexicon.json 版本對不上：不准快取", "immutable" not in cc, cc)
        cc, st = head_of("/lexicon.json")
        ok("lexicon.json 沒帶版本：照舊每次回來問", "immutable" not in cc, cc)
    # /api/loras：同一份清單第二次帶 ETag 問，回 304、沒有本文。
    r1 = urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{port}/api/loras"), timeout=30)
    body1 = r1.read()
    etag = r1.headers.get("ETag")
    ok("/api/loras 有 ETag、private no-cache", bool(etag) and "private" in (r1.headers.get("Cache-Control") or ""), str(dict(r1.headers)))
    if etag:
        c = _hc.HTTPConnection("127.0.0.1", port, timeout=30)
        c.request("GET", "/api/loras", headers={"If-None-Match": etag})
        r2 = c.getresponse()
        body2 = r2.read()
        ok("/api/loras 清單沒變：304、0 byte", r2.status == 304 and body2 == b"", f"{r2.status} {len(body2)}")
        c.close()
finally:
    proc.terminate()
    try:
        proc.wait(10)
    except subprocess.TimeoutExpired:
        proc.kill()
    log = proc.stdout.read() or ""
    comfy.close()
ok("快取標頭：主控台沒有 traceback", "Traceback" not in log, log[-800:])


def _ihdr_png(width: int, height: int) -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        + struct.pack(">I", 13)
        + b"IHDR"
        + struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    )


# === 10. Hires：假 Comfy 走完 quick，非數字是 400 =================================
comfy = FakeComfy("happy", save_node="62")
comfy.view_body = _ihdr_png(32, 48)
comfy.start()
proc, port = start_server(comfy.port, {"NO_UPSCALE_FETCH": "1"})
try:
    code, body = http_json(
        port,
        "POST",
        "/api/gen",
        {
            "positive": "1girl",
            "hires": {"mode": "quick", "scale": "nope", "image": "/api/image?filename=a.png"},
        },
    )
    ok("hires 非數字是 400", code == 400 and "不是數字" in str(body.get("error")), str((code, body)))
    bad_events = sse_events(
        port,
        timeout=20,
        payload={
            "positive": "1girl",
            "hires": {"mode": "quick", "scale": 1.5, "image": "http://evil.example/a.png"},
        },
    )
    ok(
        "hires 非 /api/image 是 error 事件",
        bool(bad_events) and bad_events[-1][0] == "error" and "/api/image" in str(bad_events[-1][1].get("error")),
        str(bad_events),
    )
    events = sse_events(
        port,
        timeout=30,
        payload={
            "positive": "1girl",
            "seed": 7,
            "workflowId": "no-such",
            "hires": {
                "mode": "quick",
                "scale": 1.25,
                "image": "/api/image?filename=out.png&type=output&h=abcdabcdabcdabcd",
            },
        },
    )
    done = [data for ev, data in events if ev == "done"]
    ok("hires fake 有 done", len(done) == 1, str(events))
    if done:
        ok("hires fake 尺寸", (done[0].get("width"), done[0].get("height")) == (40, 64), str(done[0]))
        ok("hires fake 帶 mode/scale", done[0].get("hires") == {"mode": "quick", "scale": 1.25}, str(done[0].get("hires")))
        ok("hires fake seed", done[0].get("seed") == 7, str(done[0].get("seed")))
    posted = (comfy.last_prompt or {}).get("prompt") or {}
    ok("hires 圖有 LatentUpscaleBy", posted.get("52", {}).get("class_type") == "LatentUpscaleBy", str(posted)[:500])
    ok(
        "LoadImage 用上傳後的檔名",
        posted.get("50", {}).get("inputs", {}).get("image") == "danbooru_hires/hires_test.png",
        str(posted.get("50")),
    )
    ok("原圖有先上傳", comfy.uploaded)
finally:
    proc.terminate()
    try:
        proc.wait(10)
    except subprocess.TimeoutExpired:
        proc.kill()
    log = proc.stdout.read() or ""
    comfy.close()
ok("hires fake：主控台沒有 traceback", "Traceback" not in log, log[-800:])


def _comfy_up(base: str) -> bool:
    try:
        with urllib.request.urlopen(base + "/system_stats", timeout=3) as resp:
            return resp.status == 200
    except (OSError, urllib.error.URLError, TimeoutError):
        return False


def _can_bind(bind_port: int) -> bool:
    sock = socket.socket()
    try:
        sock.bind(("127.0.0.1", bind_port))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def _start_real(bind_port: int, comfy_api: str):
    env = dict(
        os.environ,
        PYTHONUTF8="1",
        PORT=str(bind_port),
        HOST="127.0.0.1",
        COMFY_API=comfy_api,
        WEB_DIR="web6",
        NO_CARD_FETCH="1",
        NO_UPSCALE_FETCH="1",
        WORKFLOW_DATA_DIR=tempfile.mkdtemp(),
        APP_SETTINGS=str(Path(tempfile.mkdtemp()) / "settings.json"),
        WEBP_CACHE_DIR=tempfile.mkdtemp(),
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
            socket.create_connection(("127.0.0.1", bind_port), 0.2).close()
            return proc
        except OSError:
            if proc.poll() is not None:
                log = proc.stdout.read() or ""
                raise RuntimeError(f"server.py 退出（code={proc.returncode}）\n{log}")
            time.sleep(0.1)
    proc.terminate()
    raise RuntimeError("server.py 沒有開始監聽")


def _png_wh(blob: bytes):
    if len(blob) < 24 or blob[:8] != b"\x89PNG\r\n\x1a\n" or blob[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", blob[16:24])


# === 11. 真 Comfy 才跑：quick ×1.25。HIRES_LIVE_DEEP=1 再跑一次深度。 ==========
_REAL = os.environ.get("COMFY_API", "http://127.0.0.1:8188").rstrip("/")
if not _comfy_up(_REAL):
    print(f"skip real hires (Comfy not up at {_REAL})")
else:
    _port = 8897 if _can_bind(8897) else 0
    if _port == 0:
        _sock = socket.socket()
        _sock.bind(("127.0.0.1", 0))
        _port = _sock.getsockname()[1]
        _sock.close()
        print("note 8897 is busy; real hires is on another port")
    else:
        print("real hires server on 8897")
    _proc = _start_real(_port, _REAL)
    try:
        # 這個檔在 scripts/ 裡。Windows Python 不會把專案根目錄放進 sys.path。
        sys.path.insert(0, str(ROOT))
        import server as _app

        _base_events = sse_events(
            _port,
            timeout=600,
            payload={"positive": "1girl, solo", "seed": 12345, "width": 512, "height": 512},
        )
        _base = [data for ev, data in _base_events if ev == "done"]
        ok("real base image", len(_base) == 1, str(_base_events[-1] if _base_events else _base_events))
        if _base:
            _src = _base[0]["image"]
            _expect = _app.hires_output_size(512, 512, 1.25, "quick")
            _t0 = time.time()
            _hi = sse_events(
                _port,
                timeout=600,
                payload={
                    "positive": "1girl, solo",
                    "seed": 12345,
                    "workflowId": "ignored",
                    "hires": {"mode": "quick", "scale": 1.25, "image": _src},
                },
            )
            _quick_s = time.time() - _t0
            _done = [data for ev, data in _hi if ev == "done"]
            ok("real quick done", len(_done) == 1, str(_hi[-1] if _hi else _hi))
            if _done:
                ok(
                    "real quick size",
                    (_done[0].get("width"), _done[0].get("height")) == _expect
                    and _done[0].get("hires") == {"mode": "quick", "scale": 1.25},
                    str(_done[0]),
                )
                with urllib.request.urlopen(f"http://127.0.0.1:{_port}{_done[0]['image']}", timeout=60) as _resp:
                    _wh = _png_wh(_resp.read())
                ok("real quick file matches done", _wh == _expect, str(_wh))
                print(f"LIVE quick {_quick_s:.1f}s {_expect[0]}x{_expect[1]}")
            if os.environ.get("HIRES_LIVE_DEEP") == "1" and _done:
                _dexpect = _app.hires_output_size(512, 512, 1.5, "deep", 4)
                _t1 = time.time()
                _deep = sse_events(
                    _port,
                    timeout=900,
                    payload={
                        "positive": "1girl, solo",
                        "seed": 12345,
                        "hires": {"mode": "deep", "scale": 1.5, "image": _src},
                    },
                )
                _deep_s = time.time() - _t1
                _ddone = [data for ev, data in _deep if ev == "done"]
                ok("real deep done", len(_ddone) == 1, str(_deep[-1] if _deep else _deep))
                if _ddone:
                    ok(
                        "real deep size",
                        (_ddone[0].get("width"), _ddone[0].get("height")) == _dexpect
                        and _ddone[0].get("hires") == {"mode": "deep", "scale": 1.5},
                        str(_ddone[0]),
                    )
                    with urllib.request.urlopen(f"http://127.0.0.1:{_port}{_ddone[0]['image']}", timeout=60) as _resp:
                        _dwh = _png_wh(_resp.read())
                    ok("real deep file matches done", _dwh == _dexpect, str(_dwh))
                    print(f"LIVE deep {_deep_s:.1f}s {_dexpect[0]}x{_dexpect[1]}")
    finally:
        _proc.terminate()
        try:
            _proc.wait(10)
        except subprocess.TimeoutExpired:
            _proc.kill()
        _rlog = _proc.stdout.read() or ""
    ok("real hires：主控台沒有 traceback", "Traceback" not in _rlog, _rlog[-800:])


if failed:
    print(f"\n{failed} failed")
    sys.exit(1)
print("\nok")
