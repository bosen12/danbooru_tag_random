#!/usr/bin/env python3
"""SSE / Comfy binary preview helpers. Failures print and exit 1."""
from __future__ import annotations

import inspect
import json
import re
import socket
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import (  # noqa: E402
    CKPT,
    Handler,
    allowed_client,
    build_workflow,
    ckpt_preview_path,
    comfy_view_query,
    convert_loras,
    first_image_src,
    image_error_code,
    inject_lora,
    list_ckpts,
    mask_ws,
    parse_allow_nets,
    parse_comfy_binary,
    resolve_ckpt,
    sse,
    ws_frame,
)
from lora_scan import preview_path, strip_angle_tags  # noqa: E402
import shutil  # noqa: E402
import server  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]

failed = 0


def ok(name: str, cond: bool, detail: str = "") -> None:
    global failed
    if not cond:
        failed += 1
        print(f"FAIL {name}" + (f"\n  {detail}" if detail else ""))
    else:
        print(f"ok   {name}")


blob = sse("progress", {"value": 3, "max": 25})
ok("sse is bytes", isinstance(blob, bytes))
text = blob.decode("utf-8")
ok("sse has event line", "event: progress\n" in text)
ok("sse has blank terminator", text.endswith("\n\n"))
payload = json.loads(text.split("data: ", 1)[1].strip())
ok("sse data json", payload == {"value": 3, "max": 25})

raw = struct.pack(">II", 1, 1) + b"\xff\xd8fakejpeg"
parsed = parse_comfy_binary(raw)
ok("jpeg preview parsed", parsed == ("image/jpeg", b"\xff\xd8fakejpeg"), str(parsed))

png = struct.pack(">II", 1, 2) + b"\x89PNG"
ok("png preview parsed", parse_comfy_binary(png) == ("image/png", b"\x89PNG"))
ok("short buffer ignored", parse_comfy_binary(b"xxxx") is None)
ok("unknown event ignored", parse_comfy_binary(struct.pack(">II", 9, 1) + b"x") is None)

frame = ws_frame(b"hello", opcode=1)
ok("client frame is masked", frame[1] & 0x80 == 0x80)
ok("unmask roundtrip", mask_ws(frame) == (1, b"hello"), str(mask_ws(frame)))


class _Req:
    def __init__(self, path: str) -> None:
        self.path = path


ok("static allows styles.css", Handler._static_dest(_Req("/styles.css")) is not None)
ok("static allows rules/rating.js", Handler._static_dest(_Req("/rules/rating.js")) is not None)
ok("static allows trace.js", Handler._static_dest(_Req("/trace.js")) is not None)
ok("static blocks ../web2", Handler._static_dest(_Req("/../web2/styles.css")) is None)
ok("static blocks encoded ..", Handler._static_dest(_Req("/%2e%2e/web2/styles.css")) is None)

ok("view query ok", comfy_view_query("ComfyUI_1.png") == "filename=ComfyUI_1.png&subfolder=&type=output")
ok("view query keeps subfolder", comfy_view_query("a.png", "batch/out") == "filename=a.png&subfolder=batch%2Fout&type=output")
ok("view query rejects slash in name", comfy_view_query("a/b.png") is None)
ok("view query rejects .. name", comfy_view_query("..") is None)
ok("view query rejects .. subfolder", comfy_view_query("a.png", "../x") is None)
ok("view query rejects type", comfy_view_query("a.png", type_="etc") is None)
ok("view query rejects CR in name", comfy_view_query("a.png\r\nX-Injected: yes") is None)
ok("view query rejects NUL in subfolder", comfy_view_query("a.png", "out\x00") is None)
ok("http/1.1", Handler.protocol_version == "HTTP/1.1")
ok(
    "history becomes /api/image url",
    first_image_src({"outputs": {"9": {"images": [{"filename": "x.png", "type": "output"}]}}})
    == "/api/image?filename=x.png&subfolder=&type=output",
)
ok("empty history has no image", first_image_src({"outputs": {}}) is None)


class _Http:
    def __init__(self, code: int) -> None:
        self.code = code


ok("missing image is 404", image_error_code(_Http(404)) == 404)
ok("comfy down is 502", image_error_code(OSError("refused")) == 502)

nets = parse_allow_nets("")
ok("loopback allowed", allowed_client("127.0.0.1", nets))
ok("loopback net allowed", allowed_client("127.0.0.2", nets))
ok("tailscale allowed", allowed_client("100.79.212.103", nets))
ok("cgnat low allowed", allowed_client("100.64.0.1", nets))
ok("cgnat high allowed", allowed_client("100.127.255.254", nets))
ok("wifi blocked", not allowed_client("192.168.1.101", nets))
ok("hotspot blocked", not allowed_client("192.168.137.1", nets))
ok("wsl blocked", not allowed_client("172.17.64.1", nets))

ok("convert empty", convert_loras(None) == [])
ok("convert skips blank file", convert_loras([{"folder": "style", "file": ""}]) == [])
ok(
    "convert max two",
    len(convert_loras([
        {"folder": "style", "file": "a.safetensors"},
        {"folder": "Character", "file": "b.safetensors"},
        {"folder": "illus", "file": "c.safetensors"},
    ])) == 2,
)
ok(
    "convert subfolder uses backslash",
    convert_loras([{"folder": "Character/other", "file": "x.safetensors", "strength": 0.5}])
    == [(r"Character\other\x.safetensors", 0.5)],
)
ok("strip angle tags", strip_angle_tags("foo, <lora:bar:1>, baz") == "foo, baz")
ok("preview rejects slash in file", preview_path("style", "a/b.png") is None)
ok("preview rejects dotdot folder", preview_path("style/../Character", "a.png") is None)
ok("preview rejects unknown category", preview_path("not-a-folder", "a.png") is None)

wf = build_workflow("1girl", 1024, 1024, 1, [{"folder": "style", "file": "a.safetensors", "strength": 0.8}])
loaders = [n for n in wf.values() if n.get("class_type") == "LoraLoader"]
ok("workflow injects one lora", len(loaders) == 1)
ok("lora name has backslash", loaders[0]["inputs"]["lora_name"] == r"style\a.safetensors")
ok("sampler model is lora not ckpt", wf["35"]["inputs"]["model"][0] != "13")
ok("vae still ckpt", wf["85"]["inputs"]["vae"] == ["13", 2])
ok("clip encode uses lora", wf["36"]["inputs"]["clip"][0] != "13")

wf2 = {"13": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "x"}}}
wf2["36"] = {"class_type": "CLIPTextEncode", "inputs": {"text": "a", "clip": ["13", 1]}}
inject_lora(wf2, r"style\a.safetensors", 0.8)
inject_lora(wf2, r"Character\b.safetensors", 0.6)
lora_ids = [nid for nid, n in wf2.items() if n.get("class_type") == "LoraLoader"]
ok("two loras chained", len(lora_ids) == 2)
first, second = lora_ids
ok("second lora eats ckpt", wf2[second]["inputs"]["model"] == ["13", 0])
ok("first lora eats second", wf2[first]["inputs"]["model"] == [second, 0])
ok("cgnat below blocked", not allowed_client("100.63.255.255", nets))
ok("mapped tailscale allowed", allowed_client("::ffff:100.79.212.103", nets))
ok("mapped wifi blocked", not allowed_client("::ffff:192.168.1.101", nets))
ok("garbage blocked", not allowed_client("not-an-ip", nets))
ok("allow-all env", allowed_client("192.168.1.101", parse_allow_nets("0.0.0.0/0")))


class _BlockedConsole:
    def write(self, _text):
        raise AssertionError("HTTP access log touched the blocking console")


_handler = Handler.__new__(Handler)
_handler.address_string = lambda: "client"
_old_stderr = server.sys.stderr
try:
    server.sys.stderr = _BlockedConsole()
    try:
        _handler.log_message('"%s" %s', "GET /", "200")
    except AssertionError as exc:
        ok("HTTP requests never write to the Windows console", False, str(exc))
    else:
        ok("HTTP requests never write to the Windows console", True)
finally:
    server.sys.stderr = _old_stderr

import tempfile

td = Path(tempfile.mkdtemp())
(td / "alpha.safetensors").write_bytes(b"x")
(td / "beta.safetensors").write_bytes(b"x")
(td / "alpha.png").write_bytes(b"png")
(td / "notes.txt").write_text("no")
found = list_ckpts(td, "illurtrious")
ok("list skips non-ckpt", [x["file"] for x in found] == ["alpha.safetensors", "beta.safetensors"])
ok("list ckpt_name prefix", found[0]["ckpt_name"] == r"illurtrious\alpha.safetensors")
ok("list preview next to weights", found[0]["preview"] == "alpha.png")

_old_list_ckpts = server.list_ckpts
_old_models_from_comfy = server.models_from_comfy
try:
    server.list_ckpts = lambda: [
        {
            "file": "alpha.safetensors",
            "ckpt_name": r"illurtrious\alpha.safetensors",
            "title": "Alpha local title",
            "preview": "alpha.png",
        }
    ]
    server.models_from_comfy = lambda kind: [
        r"illurtrious\alpha.safetensors",
        r"extra\remote.safetensors",
    ]
    merged_ckpts, merged_source = server.checkpoints_for_ui()
    ok(
        "local previews do not hide Comfy extra_model_paths",
        [x["ckpt_name"] for x in merged_ckpts]
        == [r"illurtrious\alpha.safetensors", r"extra\remote.safetensors"],
        str(merged_ckpts),
    )
    ok("Comfy checkpoint source is reported", merged_source == "comfy", merged_source)
    ok("local checkpoint preview is attached", merged_ckpts[0]["preview"] == "alpha.png", str(merged_ckpts[0]))
finally:
    server.list_ckpts = _old_list_ckpts
    server.models_from_comfy = _old_models_from_comfy

ok("resolve by file", resolve_ckpt("beta.safetensors", found) == r"illurtrious\beta.safetensors")
ok("resolve by full name", resolve_ckpt(r"illurtrious\beta.safetensors", found) == r"illurtrious\beta.safetensors")
ok("resolve rejects parent", resolve_ckpt(r"..\evil.safetensors", found) == resolve_ckpt(None, found))
ok("preview rejects slash", ckpt_preview_path("a/b.png", td) is None)
ok("preview rejects dotdot", ckpt_preview_path("..", td) is None)
ok("preview allows sibling png", ckpt_preview_path("alpha.png", td) is not None)


class _Client:
    def __init__(self, ip: str) -> None:
        self.client_address = (ip, 9)
        self.close_connection = False
        self.dumped = None

    def _json(self, code, obj):
        self.dumped = (code, obj)


wifi = _Client("192.168.1.101")
ok(
    "wifi handler 403",
    Handler._allowed(wifi) is False
    and wifi.close_connection
    and wifi.dumped == (403, {"ok": False, "error": "forbidden"}),
)
loop = _Client("127.0.0.1")
ok("loopback handler ok", Handler._allowed(loop) is True and loop.dumped is None)



# --- Telegram -------------------------------------------------------------

tg_dir = Path(tempfile.mkdtemp())
server._tg.update({"token": "", "chatId": "", "enabled": False, "sent": 0, "failed": 0, "lastError": ""})
server.TG_SECRETS = tg_dir / ".secrets" / "telegram.json"

st = server.tg_apply_config({"token": "123456:SECRET-TOKEN", "chatId": "@chan", "enabled": True})
ok("config saves", st["ok"] and st["configured"] and st["chatId"] == "@chan")
ok("config hides token", "token" not in st and st["tokenTail"] == "…OKEN")
ok("config never returns token body", "SECRET-TOKEN" not in json.dumps(st))
ok("secrets file written", server.TG_SECRETS.is_file())
ok(
    "secrets file holds token",
    json.loads(server.TG_SECRETS.read_text(encoding="utf-8"))["token"] == "123456:SECRET-TOKEN",
)

# 留空的 token 代表「沿用已存的」，不是「清掉」。
st = server.tg_apply_config({"token": "", "chatId": "@other", "enabled": False})
ok("blank token keeps old", server._tg["token"] == "123456:SECRET-TOKEN")
ok("blank token updates rest", st["chatId"] == "@other" and st["enabled"] is False)

ok("scrub hides token", server.tg_scrub("boom https://x/bot123456:SECRET-TOKEN/send") ==
   "boom https://x/bot***/send")

# 重讀檔案要拿回一樣的東西。
server._tg.update({"token": "", "chatId": "", "enabled": False})
server.tg_load()
ok("reload restores", server._tg["token"] == "123456:SECRET-TOKEN" and server._tg["chatId"] == "@other")

# caption：短的一則解決，長的把英文 POS 切出去。
short = server.tg_caption({"seed": 7, "width": 1024, "height": 1024, "zh": "藍髮", "en": "blue hair"})
ok("short caption one message", short == ("seed 7 · 1024x1024\n藍髮\nblue hair", ""))

long_en = ", ".join(["long english tag"] * 120)
cap, tail = server.tg_caption({"seed": 7, "width": 1024, "height": 1024, "zh": "藍髮", "en": long_en})
ok("long caption splits", tail == long_en and len(cap) <= server.TG_CAPTION_MAX)
ok("long caption keeps zh", cap == "seed 7 · 1024x1024\n藍髮")

# 中文 POS 自己就爆掉時要截斷，不能超過上限。
huge_zh = "字" * 3000
cap, tail = server.tg_caption({"seed": 1, "zh": huge_zh, "en": "x"})
ok("huge zh truncated", len(cap) <= server.TG_CAPTION_MAX and cap.endswith("…"))
ok("huge zh still tails en", tail == "x")

body, boundary = server.tg_multipart({"chat_id": "@chan", "caption": "hi"}, "a.png", b"\x89PNG", "image/png")
ok("multipart boundary used", body.startswith(("--" + boundary).encode()))
ok("multipart has chat_id", b'name="chat_id"' in body and b"@chan" in body)
ok("multipart has caption", b'name="caption"' in body and b"hi" in body)
ok("multipart has photo part", b'name="photo"; filename="a.png"' in body and b"\x89PNG" in body)
ok("multipart closes", body.endswith(("--" + boundary + "--\r\n").encode()))

# 路徑白名單：../ 這種進不了佇列。
server._tg.update({"token": "t", "chatId": "@c", "enabled": True})
ok("enqueue rejects bad name", server.tg_enqueue({"filename": "../etc/passwd"})["ok"] is False)
ok("enqueue rejects empty name", server.tg_enqueue({"filename": ""})["ok"] is False)

server._tg["enabled"] = False
ok("enqueue refuses when off", server.tg_enqueue({"filename": "a.png"})["ok"] is False)
server._tg.update({"token": "", "chatId": "", "enabled": True})
ok("enqueue refuses unconfigured", server.tg_enqueue({"filename": "a.png"})["ok"] is False)

server._tg.update({"token": "", "chatId": "", "enabled": False, "sent": 0, "failed": 0, "lastError": ""})
shutil.rmtree(tg_dir, ignore_errors=True)

# --- websocket 幀解析：逾時落在幀中間也不能掉格 ---------------------------
# Comfy 的預覽是幾百 KB 的二進位幀，會跨好幾個 TCP segment。取樣忙起來時
# gen_via_ws 的 2 秒 socket timeout 很容易剛好落在幀中間；舊的 _read() 是一個
# byte 一個 byte 從 buf 吃掉，逾時丟出去時已經吃掉的幀頭就永遠消失，之後每一幀
# 都錯位解讀 —— 那張圖不是超時十分鐘就是整條串流無聲卡死。


class ScriptedSock:
    """照劇本吐資料。bytes 就送出去，None 代表這一刻卡住（socket.timeout）。"""

    def __init__(self, script):
        self.script = list(script)

    def recv(self, _n):
        if not self.script:
            return b""
        item = self.script.pop(0)
        if item is None:
            raise socket.timeout()
        return item

    def settimeout(self, _t):
        pass


def server_frame(payload: bytes, opcode: int = 2) -> bytes:
    """Comfy → 我們的方向不遮罩，所以不能用 ws_frame()（那支是我們送出去用的）。"""
    n = len(payload)
    head = bytes([0x80 | opcode])
    if n < 126:
        head += bytes([n])
    elif n < 65536:
        head += bytes([126]) + struct.pack(">H", n)
    else:
        head += bytes([127]) + struct.pack(">Q", n)
    return head + payload


def drain(ws, tries: int = 200):
    """像 gen_via_ws 那樣：逾時就接住重來。"""
    for _ in range(tries):
        try:
            return ws.recv()
        except socket.timeout:
            continue
    raise AssertionError("recv 一直逾時")


preview = struct.pack(">II", 1, 1) + (b"\xff\xd8" + b"J" * 400)
wire = server_frame(preview)

ok("ws frame in one piece", drain(server.Ws(ScriptedSock([wire]))) == (2, preview))

# 每一個 byte 之間都卡一次 —— 幀頭、126 長度欄位、payload 全都被逾時切開。
split = []
for b in wire[:8]:
    split += [bytes([b]), None]
split += [wire[8:200], None, wire[200:]]
ok(
    "ws frame survives mid-frame timeouts",
    drain(server.Ws(ScriptedSock(split))) == (2, preview),
    "逾時落在幀中間時幀頭被吃掉了",
)

# 兩幀擠在同一個 TCP 段裡：第二幀要留在 buf 等下一次 recv。
two = server.Ws(ScriptedSock([server_frame(b"AA", 1) + server_frame(b"BBB", 1)]))
ok("ws two frames one chunk #1", drain(two) == (1, b"AA"))
ok("ws two frames one chunk #2", drain(two) == (1, b"BBB"))

# 長度欄位被讀成天文數字時要當場報錯，不能一路吞資料把記憶體吃光。
huge = bytes([0x82, 127]) + struct.pack(">Q", server.WS_FRAME_MAX + 1)
try:
    server.Ws(ScriptedSock([huge])).recv()
    ok("ws rejects absurd frame length", False, "沒有擋下來")
except ConnectionError as exc:
    ok("ws rejects absurd frame length", "too big" in str(exc), str(exc))

# 遮罩過的幀（我們自己送出去的格式）照樣解得開。
masked = ws_frame(b"hello", opcode=1)
ok("ws parses masked frame", drain(server.Ws(ScriptedSock([masked]))) == (1, b"hello"))

# 對面收線：讀不到東西要報 ws closed，不是安靜地回空幀。
try:
    server.Ws(ScriptedSock([])).recv()
    ok("ws closed raises", False, "沒有報錯")
except ConnectionError as exc:
    ok("ws closed raises", "closed" in str(exc), str(exc))


class HandshakeSock:
    def __init__(self):
        self.sent = []
        self.replied = False

    def settimeout(self, _t):
        pass

    def sendall(self, data):
        self.sent.append(data)

    def recv(self, _n):
        if self.replied:
            return b""
        self.replied = True
        return b"HTTP/1.1 101 Switching Protocols\r\n\r\n"


_raw_tls_sock = HandshakeSock()
_tls_wrapped = []


class FakeSslContext:
    def wrap_socket(self, sock, server_hostname=None):
        _tls_wrapped.append((sock, server_hostname))
        return sock


class FakeSslModule:
    @staticmethod
    def create_default_context():
        return FakeSslContext()


_old_create_connection = server.socket.create_connection
_had_ssl = hasattr(server, "ssl")
_old_ssl = getattr(server, "ssl", None)
try:
    server.socket.create_connection = lambda *_a, **_k: _raw_tls_sock
    server.ssl = FakeSslModule()
    server.ws_connect("https://gpu.example:8188", "client", timeout=1)
    ok(
        "https Comfy websocket is wrapped in TLS",
        _tls_wrapped == [(_raw_tls_sock, "gpu.example")],
        str(_tls_wrapped),
    )
finally:
    server.socket.create_connection = _old_create_connection
    if _had_ssl:
        server.ssl = _old_ssl
    else:
        del server.ssl

_proxy_sock = HandshakeSock()
try:
    server.socket.create_connection = lambda *_a, **_k: _proxy_sock
    server.ws_connect("http://[::1]:8188/comfy", "client id", timeout=1)
    request = b"".join(_proxy_sock.sent).decode("ascii")
    ok("websocket keeps reverse-proxy base path", request.startswith("GET /comfy/ws?clientId=client%20id HTTP/1.1"), request)
    ok("IPv6 websocket Host header is bracketed", "Host: [::1]:8188\r\n" in request, request)
finally:
    server.socket.create_connection = _old_create_connection

multi_history = {
    "outputs": {
        "2": {"images": [{"filename": "preview.png", "subfolder": "", "type": "temp"}]},
        "9": {"images": [{"filename": "final.png", "subfolder": "", "type": "output"}]},
    }
}
ok(
    "preferred output node returns the final image",
    "filename=final.png" in (first_image_src(multi_history, {"9"}) or ""),
    str(first_image_src(multi_history, {"9"})),
)

# === /api/image 的快取：鑰匙必須是內容，不能是檔名 =============================
# ComfyUI 的 SaveImage 依輸出資料夾現有檔案編號，資料夾清空後編號從頭開始，
# 檔名就會重複。舊版送的是一天份的 max-age，於是瀏覽器連問都不問，直接拿同檔名
# 的舊圖顯示 —— 使用者看到的是「之前生成過的圖」。
# 現在的規則：ETag 一律是內容雜湊；整年快取只給網址上帶著內容指紋（h=）而且對得上的
# —— 內容一換網址就換，不會再拿到舊圖；指紋對不上（檔名被別張圖用掉）回 404，不拿別張頂替。
_img_src = inspect.getsource(server.Handler._serve_comfy_image)
_img_headers = [
    ln for ln in _img_src.splitlines()
    if "send_header" in ln and not ln.lstrip().startswith("#")
]
_img_joined = chr(10).join(_img_headers)
ok("handler 裡不另寫 max-age：快取規則只走 image_cache_policy()", "max-age" not in _img_joined, _img_joined)
ok("有回 ETag", "ETag" in _img_joined)
ok("有處理 If-None-Match", "If-None-Match" in _img_src)
ok("ETag 算在內容上而不是檔名上", "image_digest(raw)" in _img_src and "image_cache_policy(want, digest)" in _img_src)

_d = server.image_digest(b"same bytes")
ok("沒帶指紋的舊網址：每次回來驗證", server.image_cache_policy("", _d) == (200, "private, no-cache"))
_st, _cc = server.image_cache_policy(_d[: server.IMAGE_HASH_LEN], _d)
ok("帶著對得上的指紋：整年快取", _st == 200 and "immutable" in _cc and "max-age=31536000" in _cc, _cc)
ok(
    "指紋對不上（輸出資料夾清過、檔名換成別張）：404，不拿別張頂替",
    server.image_cache_policy(server.image_digest(b"other")[: server.IMAGE_HASH_LEN], _d)[0] == 404,
)
ok(
    "指紋只收 8～40 個十六進位字",
    server.valid_image_hash(_d[:16]) and not server.valid_image_hash("zz" * 8) and not server.valid_image_hash("abc123"),
)

_real_api = server.api
_real_webp_dir = server.WEBP_DIR
import tempfile as _tempfile  # noqa: E402

server.WEBP_DIR = Path(_tempfile.mkdtemp(prefix="webp-cache-test-"))
try:
    server.api = lambda method, path, data=None, timeout=60: b"PNG BYTES" if path.startswith("/view?") else None
    _src = "/api/image?filename=x.png&subfolder=&type=output"
    _got = server.with_content_hash(_src)
    ok("出圖完成的網址帶上內容指紋", _got == _src + "&h=" + server.image_digest(b"PNG BYTES")[:16], _got)
    ok("已經帶指紋的不再加一次", server.with_content_hash(_got) == _got)
    ok("_job 送出去的網址就是帶指紋的", server._job(1, 64, 64, "p", _src)["image"] == _got)

    def _down(*a, **k):
        raise OSError("comfy down")

    server.api = _down
    ok("拿不到圖就照舊回原本的網址，不擋住出圖", server.with_content_hash(_src) == _src)
    ok("webp 轉不出來就回 None（改送原圖）", server.comfy_webp("filename=x.png&subfolder=&type=output", "f" * 40) is None)

    _calls = []

    def _webp(method, path, data=None, timeout=60):
        _calls.append(path)
        return b"RIFF....WEBPVP8 "

    server.api = _webp
    _q = "filename=y.png&subfolder=&type=output"
    _a = server.comfy_webp(_q, "a" * 40)
    _b = server.comfy_webp(_q, "a" * 40)
    ok("webp 用 ComfyUI 的 preview 轉", _a == b"RIFF....WEBPVP8 " and "preview=webp%3B85" in _calls[0], str(_calls))
    ok("同一張圖只轉一次（快取鑰匙是內容雜湊）", _a == _b and len(_calls) == 1, str(_calls))
    ok("轉好的存到硬碟", (server.WEBP_DIR / ("a" * 40 + ".webp")).read_bytes() == _a)
    server._WEBP_CACHE.clear()  # 當作伺服器重開：記憶體裡的沒了
    _c = server.comfy_webp(_q, "a" * 40)
    ok("伺服器重開後從硬碟拿，不再請 ComfyUI 轉", _c == _a and len(_calls) == 1, str(_calls))
finally:
    server.api = _real_api
    server._WEBP_CACHE.clear()
    shutil.rmtree(server.WEBP_DIR, ignore_errors=True)
    server.WEBP_DIR = _real_webp_dir


# === HTML 裡自己的程式檔帶版本（versioned_html）==================================
# 走 Tailscale 時每次重新整理要把二十幾個 .js 逐一回來問；換成帶內容雜湊的網址就整年快取。
_V = {"boot.js": "aaaaaaaaaa", "engine.js": "bbbbbbbbbb", "app.js": "cccccccccc", "styles.css": "dddddddddd"}
_html = (
    '<!doctype html><html><head><meta charset="utf-8" />'
    '<link rel="icon" href="logo.svg" />'
    '<link rel="modulepreload" href="boot.js" />'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X" />'
    '<link rel="stylesheet" href="styles.css" />'
    '<link rel="stylesheet" href="missing.css" />'
    '<script type="importmap">{"imports": {"three": "./vendor/three.js"}}</script>'
    '</head><body><script type="module" src="app.js"></script></body></html>'
)
_out = server.versioned_html(_html, lambda rel: _V.get(rel), ["boot.js", "engine.js", "app.js"])
_maps = re.findall(r'<script type="importmap">(.*?)</script>', _out)
ok("import map 只有一份（原本的合併進來）", len(_maps) == 1, _out)
_m = json.loads(_maps[0]) if _maps else {}
ok("模組彼此 import 的網址對到帶版本的", _m.get("imports", {}).get("/engine.js") == "/engine.js?v=bbbbbbbbbb", str(_m))
ok("原本的 three.js 對照保留", _m.get("imports", {}).get("three") == "./vendor/three.js", str(_m))
ok(
    "import map 在所有 <link>／<script> 前面（預載的模組才不會先用舊網址載一份）",
    _out.find('type="importmap"') < _out.find("<link") and _out.find('type="importmap"') < _out.find('rel="modulepreload"'),
    _out,
)
ok("modulepreload、入口模組、樣式表都換成帶版本的網址",
   'href="boot.js?v=aaaaaaaaaa"' in _out and 'src="app.js?v=cccccccccc"' in _out and 'href="styles.css?v=dddddddddd"' in _out, _out)
ok("外部網址、找不到的檔、icon 都不動",
   'href="https://fonts.googleapis.com/css2?family=X"' in _out and 'href="missing.css"' in _out and 'href="logo.svg"' in _out, _out)
ok("看不懂原本的 import map 就整頁照舊", server.versioned_html('<head><script type="importmap">{bad</script></head>', lambda r: "x", ["a.js"]) == '<head><script type="importmap">{bad</script></head>')
ok("第三方的 vendor 不收進 import map", not any(f.startswith("vendor/") or "/vendor/" in f for f in server.own_js_files()), str([f for f in server.own_js_files() if "vendor" in f][:3]))

# --- Discord embed ---------------------------------------------------------

NL = chr(10)
FENCE = "```"

dc_job = {
    "filename": "ComfyUI_00042_.png",
    "seed": 786465539,
    "width": 1024,
    "height": 1216,
    "zh": "1個女性、單人、長髮、排球服",
    "en": "1girl, solo, long hair, volleyball uniform, masterpiece",
}

# 檔名清洗：attachment:// 必須和上傳的檔名一字不差
ok("safe filename keeps a normal comfy name", server.dc_safe_filename("ComfyUI_00042_.png") == "ComfyUI_00042_.png")
ok("safe filename drops spaces and punctuation", " " not in server.dc_safe_filename("a b!c.png"))
ok("safe filename falls back when empty", server.dc_safe_filename("") == "shot.png")
ok("safe filename falls back when all stripped", server.dc_safe_filename("!!!") == "shot.png")

# code block 圍籬
fenced = server.dc_fence("abc", 100)
ok("fence wraps in a code block", fenced.startswith(FENCE + NL) and fenced.endswith(NL + FENCE))
ok("fence keeps short text intact", "abc" in fenced)
tight = server.dc_fence("x" * 500, 40)
ok("fence never exceeds the limit", len(tight) <= 40, f"len={len(tight)}")
ok("fence marks truncation", "…" in tight)
ok("fence still closed when truncated", tight.startswith(FENCE + NL) and tight.endswith(NL + FENCE))

# embed 本體
emb = server.dc_embed(dc_job, server.dc_safe_filename(dc_job["filename"]))
ok("embed carries the accent colour", emb["color"] == server.DC_COLOR)
ok("embed title has seed and size", emb["title"] == "seed 786465539 · 1024×1216", emb["title"])
ok("embed shows the image inline", emb["image"]["url"] == "attachment://ComfyUI_00042_.png", emb["image"]["url"])
ok("embed description is the chinese pos", emb["description"] == dc_job["zh"])
ok("embed does not duplicate the english pos", "fields" not in emb)

# attachment:// 一定要對得上實際上傳的檔名
dirty = dict(dc_job, filename="a b!c.png")
fn = server.dc_safe_filename(dirty["filename"])
ok("attachment url matches the uploaded name", server.dc_embed(dirty, fn)["image"]["url"] == "attachment://" + fn)

# 沒有 seed / 尺寸時的退路
bare = server.dc_embed({"filename": "x.png"}, "x.png")
ok("embed falls back to a plain title", bare["title"] == "排字匣", bare["title"])
ok("embed omits description when there is no chinese", "description" not in bare)

# 只有 seed、只有尺寸
ok("embed title with seed only", server.dc_embed({"seed": 7}, "x.png")["title"] == "seed 7")
ok("embed title with size only", server.dc_embed({"width": 832, "height": 1216}, "x.png")["title"] == "832×1216")

# 上限
long_zh = "字" * 9000
ok("embed truncates a huge chinese pos", len(server.dc_embed({"zh": long_zh}, "x.png")["description"]) <= server.DC_DESC_MAX)
ok("embed truncation is marked", server.dc_embed({"zh": long_zh}, "x.png")["description"].endswith("…"))
long_title = server.dc_embed({"seed": "S" * 900, "width": 1, "height": 1}, "x.png")["title"]
ok("embed truncates a huge title", len(long_title) <= server.DC_TITLE_MAX)

# 英文 POS 放訊息本體，2000 字上限
long_en = ", ".join(["some very long danbooru tag"] * 200)
body = server.dc_fence(long_en, server.DC_CONTENT_MAX)
ok("english pos stays under the content limit", len(body) <= server.DC_CONTENT_MAX, f"len={len(body)}")
ok("english pos is copy-friendly in a code block", body.startswith(FENCE + NL))

# multipart 仍然用 Discord 要的欄位名
dc_body, dc_boundary = server.tg_multipart(
    {"payload_json": "{}"}, "ComfyUI_00042_.png", b"\x89PNG", "image/png", field="files[0]"
)
ok("discord multipart uses files[0]", b'name="files[0]"' in dc_body)
ok("discord multipart carries payload_json", b'name="payload_json"' in dc_body)
ok("discord multipart keeps the filename", b'filename="ComfyUI_00042_.png"' in dc_body)
ok("discord multipart closes", dc_body.endswith(("--" + dc_boundary + "--" + chr(13) + NL).encode()))


# --- Discord webhook 模式 ------------------------------------------------
# 先把設定檔導去暫存目錄，跟上面 Telegram 同一個做法。這一段會改 server._dc，
# 而 dc_apply_config() 會寫檔 —— 現在的測試沒呼叫它，但只要有人補一條就會直接
# 蓋掉使用者真正的 .secrets/discord.json。這條防線要在那之前就先架好。
dc_dir = Path(tempfile.mkdtemp())
server.DC_SECRETS = dc_dir / ".secrets" / "discord.json"

# webhook 網址整條都是憑證，而且它決定圖送去哪台主機，所以驗證那一關是安全問題
# 不是體驗問題：貼錯一行的後果是成圖被 POST 到別人家。
GOOD_HOOK = "https://discord.com/api/webhooks/1234567890/abcdefghijklmnopqrstuvwxyz"
ok("webhook 收下正常的網址", server.dc_webhook_ok(GOOD_HOOK) == GOOD_HOOK)
ok("webhook 砍掉查詢字串與結尾斜線", server.dc_webhook_ok(GOOD_HOOK + "/?wait=true") == GOOD_HOOK)
ok("webhook 接受 discordapp.com", server.dc_webhook_ok(GOOD_HOOK.replace("discord.com", "discordapp.com")).endswith("uvwxyz"))
ok("webhook 空字串當作沒填", server.dc_webhook_ok("") == "")


def dc_rejects(url: str) -> bool:
    try:
        server.dc_webhook_ok(url)
        return False
    except RuntimeError:
        return True


ok("webhook 擋掉 http", dc_rejects(GOOD_HOOK.replace("https://", "http://")))
ok("webhook 擋掉別人的網域", dc_rejects(GOOD_HOOK.replace("discord.com", "evil.example")))
ok("webhook 擋掉相似網域", dc_rejects(GOOD_HOOK.replace("discord.com", "discord.com.evil.example")))
ok("webhook 擋掉不是 webhook 的路徑", dc_rejects("https://discord.com/api/v10/channels/1/messages"))
ok("webhook 擋掉少了 token 的網址", dc_rejects("https://discord.com/api/webhooks/1234567890"))

_dc_backup = dict(server._dc)
try:
    # webhook 模式：送到那個網址，而且**不可以**帶 Authorization。
    server._dc.update({"mode": "webhook", "webhook": GOOD_HOOK, "token": "botsecret", "channelId": "999"})
    url, headers = server.dc_endpoint()
    ok("webhook 模式送到 webhook 網址", url == GOOD_HOOK, url)
    ok("webhook 模式不帶 Authorization", "Authorization" not in headers, str(sorted(headers)))
    ok("webhook 模式仍帶 User-Agent", "User-Agent" in headers)
    ok("webhook 模式算設定好了", server.dc_status()["configured"] is True)

    # 佇列的「設定好了沒」必須和面板同一份。分兩份寫過一次就出事：面板用模式判斷、
    # 佇列寫死 bot 的條件，於是 webhook 模式下面板說「已設定」，每張圖卻被擋在
    # 佇列外，錯誤訊息還說「還沒設定」。這裡用空的 job：過得了設定這一關就會
    # 倒在「bad image query」，不會真的啟動背景執行緒。
    # 必須把 bot 的欄位清空才隔離得出 webhook 模式 —— 第一版沒清，
    # 舊的 bot 條件照樣成立，於是把判斷改回寫死也還是綠的（假綠）。
    server._dc.update({"token": "", "channelId": "", "enabled": True})
    queued = server.dc_enqueue({})
    ok(
        "webhook 模式的圖排得進佇列",
        queued.get("error") != "Discord 還沒設定或沒開",
        str(queued),
    )
    server._dc.update({"token": "botsecret", "channelId": "999", "enabled": False})

    # bot 模式：走 API 路徑，帶 Bot 認證。
    server._dc.update({"mode": "bot"})
    url, headers = server.dc_endpoint()
    ok("bot 模式走 channels 路徑", url == f"{server.DC_API}/channels/999/messages", url)
    ok("bot 模式帶 Bot 認證", headers.get("Authorization") == "Bot botsecret")

    # 設定不全時要講得出是缺什麼，而不是送出去才錯。
    server._dc.update({"mode": "webhook", "webhook": ""})
    ok("webhook 模式沒網址就不算設定好", server.dc_status()["configured"] is False)
    try:
        server.dc_endpoint()
        ok("webhook 模式沒網址會擋下來", False)
    except RuntimeError:
        ok("webhook 模式沒網址會擋下來", True)

    # 憑證不可以從錯誤訊息漏回前端 —— webhook 的 token 就在網址最後一段。
    server._dc.update({"mode": "webhook", "webhook": GOOD_HOOK})
    scrubbed = server.dc_scrub(f"HTTP 401 from {GOOD_HOOK}")
    ok("dc_scrub 遮掉整條 webhook 網址", GOOD_HOOK not in scrubbed, scrubbed)
    ok("dc_scrub 遮掉 webhook 的 token 段", "abcdefghijklmnopqrstuvwxyz" not in scrubbed, scrubbed)
    ok("dc_scrub 仍遮掉 bot token", "botsecret" not in server.dc_scrub("boom botsecret"))
finally:
    server._dc.clear()
    server._dc.update(_dc_backup)
# 這一段**必須排在下面的 sys.exit(1) 之前**。它原本寫在檔尾，也就是腳本已經
# 印完 ok、決定通過之後才跑 —— 印了 FAIL 也不會讓測試失敗。實際踩到了：
# 負向詞加了 cross-section／x-ray／uterus／inset 之後備援脫節，這條印了紅字，
# 整支卻還是 exit 0。它自己的註解說「沒有人會自然發現它壞掉」，
# 而它本身就待在沒有人會發現它壞掉的位置。
# --- 備援負面字串不能跟 lexicon.json 脫節 -------------------------------------
# server._negative() 讀不到 lexicon.json 時會退回一個寫死的字串，而它的註解一直
#宣稱 merge_lexicon.NEGATIVE 是唯一來源。實際上它脫節了：正式那份已經把
# censor / extra fingers / fused fingers / missing fingers / extra limbs /
# disfigured / ugly 換成 Danbooru 的正名，備援還留著舊的，還多塞了
# loli / shota / teen / child —— 備援比正式嚴格，是最難查的那種不一致。
#
# 這條直接比對兩者。只有在檔案真的不見時才會用到備援，所以沒有人會自然發現它壞掉。
def _fallback_negative() -> str:
    src = (ROOT / "server.py").read_text(encoding="utf-8")
    at = src.index("# Last resort if lexicon.json is missing")
    ret = src.index("return (", at)
    end = src.index(chr(10) + "    )", ret)
    q = chr(34)
    return "".join(re.findall(q + "([^" + q + "]*)" + q, src[ret:end]))


_fb = [t.strip() for t in _fallback_negative().split(",") if t.strip()]
_live = [t.strip() for t in server.NEGATIVE.split(",") if t.strip()]
_requested_base_negative = [
    "worst quality", "bad quality", "worst detail", "sketch", "bad hands", "extra digits",
    "censored", "bar censor", "mosaic censoring", "watermark", "signature", "english text",
    "speech bubble", "multiple views", "3d", "photorealistic", "cross-section", "x-ray", "inset",
]
ok(
    "基礎 negative prompt 使用指定的 19 個 tag 且順序一致",
    _live == _requested_base_negative,
    f"實際為 {_live}",
)
ok(
    "server.py 的備援負面字串跟 lexicon.json 一致",
    _fb == _live,
    f"備援多了 {[t for t in _fb if t not in _live]}，少了 {[t for t in _live if t not in _fb]}",
)

# --- user workflow profiles -----------------------------------------------
import workflows as wfmod

wf_td = Path(tempfile.mkdtemp())
wfmod.DATA_DIR = wf_td / "workflows"
wfmod.SETTINGS_PATH = wf_td / "settings.json"

# LoRA discovery must use the same saved Comfy URL as ping/checkpoints/generation.
import os as _os  # noqa: E402
import urllib.request as _urllib_request  # noqa: E402

_old_comfy_env = _os.environ.pop("COMFY_API", None)
_old_urlopen = _urllib_request.urlopen
_lora_urls = []

class _LoraResponse:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps({"LoraLoader": {"input": {"required": {"lora_name": [["style\\saved.safetensors"], {}]}}}}).encode()

def _lora_urlopen(req, timeout=0):
    _lora_urls.append((req.full_url, timeout))
    return _LoraResponse()

try:
    wfmod.set_comfy_api("http://saved.example:9191/base")
    _urllib_request.urlopen = _lora_urlopen
    names = server.lora_scan.lora_names_from_comfy()
    ok("LoRA discovery uses saved Comfy URL", _lora_urls == [("http://saved.example:9191/base/object_info/LoraLoader", 10)], str(_lora_urls))
    ok("LoRA discovery still parses names", names == ["style\\saved.safetensors"], str(names))
finally:
    _urllib_request.urlopen = _old_urlopen
    if _old_comfy_env is not None:
        _os.environ["COMFY_API"] = _old_comfy_env

_PROFILE_WF = {
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

builtin_wf, builtin_meta = server.prepare_workflow(
    {"positive": "1girl", "width": 512, "height": 512, "seed": 7}
)
ok("no workflowId uses builtin SaveImage 200", builtin_wf.get("200", {}).get("class_type") == "SaveImage")
ok("no workflowId uses builtin ckpt node 13", builtin_wf.get("13", {}).get("class_type") == "CheckpointLoaderSimple")
ok("builtin meta kind", builtin_meta.get("kind") == "builtin", str(builtin_meta))
ok("blank workflowId still builtin", server.prepare_workflow({"positive": "1girl", "workflowId": ""})[1].get("kind") == "builtin")

_prof = wfmod.save_profile(
    "case",
    _PROFILE_WF,
    {
        "positive": {"node": "6", "input": "text", "mode": "control"},
        "negative": {"node": "7", "input": "text", "mode": "keep"},
        "seed": {"node": "3", "input": "seed", "mode": "keep"},
        "checkpoint": {"node": "4", "input": "ckpt_name", "mode": "keep"},
    },
)
user_wf, user_meta = server.prepare_workflow(
    {
        "positive": "1girl, from profile",
        "negative": "SHOULD NOT",
        "seed": 99,
        "ckpt": "other.safetensors",
        "workflowId": _prof["id"],
        "width": 1024,
        "height": 1024,
    }
)
ok("profile kind", user_meta.get("kind") == "profile", str(user_meta))
ok("profile injects positive", user_wf["6"]["inputs"]["text"] == "1girl, from profile")
ok("profile keeps negative", user_wf["7"]["inputs"]["text"] == "OLD NEG")
ok("profile keeps seed", user_wf["3"]["inputs"]["seed"] == 1)
ok("profile keeps checkpoint", user_wf["4"]["inputs"]["ckpt_name"] == "kept.safetensors")
ok("profile keeps ControlNet", user_wf["40"]["inputs"]["control_net_name"] == "keep_me.safetensors")
ok("profile does not grow builtin node 200", "200" not in user_wf)
ok(
    "on-disk original still OLD POS",
    json.loads((wfmod.DATA_DIR / _prof["id"] / "workflow.json").read_text(encoding="utf-8"))["6"]["inputs"]["text"]
    == "OLD POS",
)

_bare = wfmod.save_profile("bare", _PROFILE_WF, {})
ok("import without mapping auto-detects positive", wfmod.mapping_ready(wfmod.get_profile(_bare["id"])["mapping"]))
wfmod.update_mapping(_bare["id"], {})
try:
    server.prepare_workflow({"positive": "1girl", "workflowId": _bare["id"]})
    ok("unmapped profile refused", False)
except Exception as exc:
    ok("unmapped profile refused", "Positive" in str(exc) or "positive" in str(exc).lower() or "節點" in str(exc), str(exc))

try:
    server.prepare_workflow({"positive": "1girl", "workflowId": "no-such"})
    ok("missing profile refused", False)
except Exception as exc:
    ok("missing profile refused", True, str(exc))

ok(
    "empty ckpt pool accepts a Comfy-style name",
    server.resolve_ckpt(r"extra\remote.safetensors", []) == r"extra\remote.safetensors",
)
ok(
    "empty ckpt pool still rejects parent",
    server.resolve_ckpt(r"..\evil.safetensors", []) == str(server.CKPT).replace("/", "\\"),
)

# === 沒選底模時：預設的不在這台 ComfyUI 就挑一個有的 ==============================
# 別台電腦從 GitHub 拉下來，ComfyUI 裡沒有作者的底模檔名，網頁第一次生圖沒選過底模就會被退件。
_pool = [
    {"ckpt_name": r"sd15\dreamshaper_8.safetensors", "file": "dreamshaper_8.safetensors"},
    {"ckpt_name": r"SDXL\animagineXL40_v4.safetensors", "file": "animagineXL40_v4.safetensors"},
]
ok("預設的底模不在：沒選時挑動漫 XL 的那個", server.resolve_ckpt(None, _pool) == r"SDXL\animagineXL40_v4.safetensors", server.resolve_ckpt(None, _pool))
ok("指定的底模已經不在：也退回挑出來的那個", server.resolve_ckpt(r"gone\old.safetensors", _pool) == r"SDXL\animagineXL40_v4.safetensors")
_withdef = _pool + [{"ckpt_name": str(server.CKPT).replace("/", "\\"), "file": str(server.CKPT).replace("/", "\\").split("\\")[-1]}]
ok("預設的底模在清單裡就用預設的", server.resolve_ckpt(None, _withdef) == str(server.CKPT).replace("/", "\\"))
ok("都不像動漫底模就用第一個", server.pick_default_ckpt([r"a\x.safetensors", r"b\y.safetensors"]) == r"a\x.safetensors")
ok("清單是空的回 None（呼叫端退回預設）", server.pick_default_ckpt([]) is None)

src = (ROOT / "server.py").read_text(encoding="utf-8")
ok(
    "gen no longer waits only on node 200",
    'd.get("node") not in (None, "200")' not in src,
)

# --- JSON API 也要 gzip -------------------------------------------------------
# 靜態檔早就有 gzip + ETag，JSON 這條路漏了：/api/loras 實測 518 KB（938 顆 LoRA，
# trainedWords 佔一半），gzip 5 級壓到 96 KB，花 5 ms。手機走 Tailscale 開 LoRA 選單
# 等的就是這 518 KB。小回應不壓（標頭比省下的還多），沒說收 gzip 的客戶端照原樣給。
import gzip as _gzip
import io as _io


class _JsonProbe:
    def __init__(self, accept):
        self.headers = {"Accept-Encoding": accept} if accept else {}
        self.sent = {}
        self.code = None
        self.wfile = _io.BytesIO()

    def send_response(self, code):
        self.code = code

    def send_header(self, k, v):
        self.sent[k] = v

    def end_headers(self):
        pass


def _json_via(accept, obj):
    probe = _JsonProbe(accept)
    Handler._json(probe, 200, obj)
    return probe, probe.wfile.getvalue()


_big = {"items": [{"file": f"lora_{i}.safetensors", "trainedWords": ["alpha beta gamma"] * 6} for i in range(400)]}
_probe, _body = _json_via("gzip, deflate, br", _big)
_gz = _probe.sent.get("Content-Encoding") == "gzip"
ok("大的 JSON 回應在客戶端收 gzip 時壓縮", _gz, str(_probe.sent))
if _gz:
    _plain = _gzip.decompress(_body)
    ok("壓縮後解開跟原本一模一樣", json.loads(_plain) == _big)
    ok("Content-Length 是壓縮後的長度", _probe.sent.get("Content-Length") == str(len(_body)))
    ok("壓縮後的回應標明 Vary: Accept-Encoding", _probe.sent.get("Vary") == "Accept-Encoding")
    ok("壓縮真的有省", len(_body) < len(_plain) / 3, f"{len(_body)} vs {len(_plain)}")

_probe, _body = _json_via(None, _big)
ok("客戶端沒說收 gzip 就不壓", "Content-Encoding" not in _probe.sent and json.loads(_body) == _big)

_probe, _body = _json_via("gzip", {"ok": True})
ok("小回應不壓", "Content-Encoding" not in _probe.sent and json.loads(_body) == {"ok": True})
ok("JSON 仍然不准快取", _probe.sent.get("Cache-Control") == "no-store")

if failed:
    print(f"\n{failed} failed")
    sys.exit(1)
print("\nok")
