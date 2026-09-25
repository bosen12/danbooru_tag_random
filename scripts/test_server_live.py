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


if failed:
    print(f"\n{failed} failed")
    sys.exit(1)
print("\nok")
