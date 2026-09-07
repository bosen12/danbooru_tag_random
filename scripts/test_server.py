#!/usr/bin/env python3
"""SSE / Comfy binary preview helpers. Failures print and exit 1."""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import (  # noqa: E402
    Handler,
    allowed_client,
    comfy_view_query,
    first_image_src,
    image_error_code,
    mask_ws,
    parse_allow_nets,
    parse_comfy_binary,
    sse,
    ws_frame,
)

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
ok("cgnat below blocked", not allowed_client("100.63.255.255", nets))
ok("mapped tailscale allowed", allowed_client("::ffff:100.79.212.103", nets))
ok("mapped wifi blocked", not allowed_client("::ffff:192.168.1.101", nets))
ok("garbage blocked", not allowed_client("not-an-ip", nets))
ok("allow-all env", allowed_client("192.168.1.101", parse_allow_nets("0.0.0.0/0")))


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

if failed:
    print(f"\n{failed} failed")
    sys.exit(1)
print("\nok")
