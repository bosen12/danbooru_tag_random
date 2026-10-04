"""Real upstream HTTP tests: revalidation must retain identity without rereading PNGs."""
import io
import json
import os
import sys
import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class Upstream(BaseHTTPRequestHandler):
    def do_GET(self):
        state = self.server.state
        state["requests"].append(self.headers.get("If-None-Match"))
        if state["status"] != 200:
            self.send_response(state["status"])
            self.end_headers()
            return
        if state.get("conditional", True) and state["etag"] and self.headers.get("If-None-Match") == state["etag"]:
            self.send_response(304)
            self.send_header("ETag", state.get("reply_etag", state["etag"]))
            self.end_headers()
            if state.get("replace_after_304"):
                state.update(body=state.get("replacement_body", b"replacement after validation"), etag='"version-two"')
                state.pop("replace_after_304")
            return
        body = state["body"]
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(body)))
        if state["etag"]:
            self.send_header("ETag", state["etag"])
        self.end_headers()
        self.wfile.write(body)
        state["bytes"] += len(body)

    def log_message(self, *args):
        pass


class Request:
    def __init__(self, *, digest="", conditional=None, webp=False, filename="same.png"):
        query = {"filename": filename, "type": "output"}
        if digest:
            query["h"] = digest
        if webp:
            query["fmt"] = "webp"
        self.path = "/api/image?" + urllib.parse.urlencode(query)
        self.headers = {} if conditional is None else {"If-None-Match": conditional}
        self.wfile = io.BytesIO()
        self.response_headers = {}
        self.status = None

    def send_response(self, status):
        self.status = status

    def send_header(self, key, value):
        self.response_headers[key] = value

    def end_headers(self):
        pass

    def _json(self, status, obj):
        self.status = status
        self.wfile.write(json.dumps(obj).encode())


class RevalidationTests(unittest.TestCase):
    def setUp(self):
        self.state = {"body": b"\x89PNG\r\n\x1a\n" + b"p" * 1_300_000,
                      "etag": '"version-one"', "status": 200, "requests": [], "bytes": 0}
        self.upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
        self.upstream.state = self.state
        self.thread = threading.Thread(target=lambda: self.upstream.serve_forever(poll_interval=.01), daemon=True)
        self.thread.start()
        self.env = patch.dict(os.environ, {"COMFY_API": f"http://127.0.0.1:{self.upstream.server_port}"})
        self.env.start()
        if hasattr(server, "_IMAGE_VALIDATORS"):
            server._IMAGE_VALIDATORS.clear()

    def tearDown(self):
        self.env.stop()
        self.upstream.shutdown()
        self.upstream.server_close()
        self.thread.join()

    def request(self, **kw):
        req = Request(**kw)
        server.Handler._serve_comfy_image(req)
        return req

    def prime(self):
        req = self.request()
        self.assertEqual(req.status, 200)
        self.assertEqual(req.wfile.getvalue(), self.state["body"])
        self.assertEqual(req.response_headers["ETag"], '"' + server.image_digest(self.state["body"]) + '"')
        return req.response_headers["ETag"]

    def test_warm_revalidation_transfers_png_once_and_rechecks_every_time(self):
        etag = self.prime()
        initial = self.state["bytes"]
        for _ in range(4):
            req = self.request(conditional=etag)
            self.assertEqual(req.status, 304)
            self.assertEqual(req.wfile.getvalue(), b"")
        self.assertEqual(self.state["bytes"], initial, "304 checks reread the original PNG")
        self.assertEqual(self.state["requests"], [None] + ['"version-one"'] * 4)

    def test_missing_source_does_not_return_cached_304(self):
        etag = self.prime()
        self.state["status"] = 404
        self.assertEqual(self.request(conditional=etag).status, 404)

    def test_replaced_filename_invalidates_content_hash(self):
        etag = self.prime()
        old_hash = server.image_digest(self.state["body"])[:16]
        self.state.update(body=b"new image", etag='"version-two"')
        req = self.request(digest=old_hash, conditional=etag)
        self.assertEqual(req.status, 404)
        self.assertNotEqual(req.wfile.getvalue(), b"new image")

    def test_replaced_legacy_url_returns_new_body_and_digest(self):
        etag = self.prime()
        self.state.update(body=b"new image", etag='"version-two"')
        req = self.request(conditional=etag)
        self.assertEqual(req.status, 200)
        self.assertEqual(req.wfile.getvalue(), b"new image")
        self.assertEqual(req.response_headers["ETag"], '"' + server.image_digest(b"new image") + '"')

    def test_unconditional_request_still_has_full_body(self):
        self.prime()
        req = self.request()
        self.assertEqual(req.status, 200)
        self.assertEqual(req.wfile.getvalue(), self.state["body"])

    def test_stale_browser_validator_still_has_full_body(self):
        self.prime()
        req = self.request(conditional='"unrelated-old-digest"')
        self.assertEqual(req.status, 200)
        self.assertEqual(req.wfile.getvalue(), self.state["body"])

    def test_no_upstream_validator_keeps_full_digest_verification(self):
        self.state["etag"] = None
        etag = self.prime()
        req = self.request(conditional=etag)
        self.assertEqual(req.status, 304)
        self.assertEqual(self.state["bytes"], 2 * len(self.state["body"]))

    def test_weak_upstream_validator_cannot_prove_exact_bytes(self):
        self.state["etag"] = 'W/"semantic-version"'
        self.prime()
        self.state["body"] = b"same semantics but different bytes"
        req = self.request()
        self.assertEqual(req.wfile.getvalue(), self.state["body"])
        self.assertTrue(all(tag is None for tag in self.state["requests"]))

    def test_upstream_errors_do_not_serve_cached_success(self):
        etag = self.prime()
        self.state["status"] = 503
        self.assertEqual(self.request(conditional=etag).status, 502)

    def test_webp_revalidation_uses_original_identity_without_png_download(self):
        blob = b"RIFF....WEBPfake"
        with patch.object(server, "comfy_webp", return_value=blob):
            first = self.request(webp=True)
            self.assertEqual(first.status, 200)
            initial = self.state["bytes"]
            req = self.request(webp=True, conditional=first.response_headers["ETag"])
            self.assertEqual(req.status, 304)
            self.assertEqual(self.state["bytes"], initial)

    def test_failed_webp_conversion_preserves_original_fallback(self):
        etag = self.prime()
        with patch.object(server, "comfy_webp", return_value=None):
            req = self.request(webp=True, conditional=etag)
            self.assertEqual(req.status, 304)
            req = self.request(webp=True)
            self.assertEqual(req.wfile.getvalue(), self.state["body"])

    def test_identical_etag_on_another_comfy_does_not_reuse_digest(self):
        self.prime()
        other = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
        other.state = {**self.state, "body": b"other server", "requests": [], "bytes": 0}
        thread = threading.Thread(target=lambda: other.serve_forever(poll_interval=.01), daemon=True)
        thread.start()
        try:
            with patch.dict(os.environ, {"COMFY_API": f"http://127.0.0.1:{other.server_port}"}):
                req = self.request()
            self.assertEqual(req.wfile.getvalue(), b"other server")
            self.assertEqual(other.state["requests"], [None])
        finally:
            other.shutdown()
            other.server_close()
            thread.join()

    def test_upstream_ignoring_conditional_request_still_hashes_full_response(self):
        etag = self.prime()
        self.state["conditional"] = False
        self.assertEqual(self.request(conditional=etag).status, 304)
        self.assertEqual(self.state["bytes"], 2 * len(self.state["body"]))

    def test_server_restart_rebuilds_mapping_from_source_bytes(self):
        etag = self.prime()
        server._IMAGE_VALIDATORS.clear()
        self.assertEqual(self.request(conditional=etag).status, 304)
        self.assertEqual(self.state["requests"], [None, None])

    def test_identical_etag_on_another_filename_does_not_reuse_mapping(self):
        self.prime()
        self.state["body"] = b"another filename"
        self.assertEqual(self.request(filename="other.png").wfile.getvalue(), b"another filename")
        self.assertEqual(self.state["requests"], [None, None])

    def test_validator_cache_is_bounded_and_eviction_is_safe(self):
        with patch.object(server, "_IMAGE_VALIDATORS_MAX", 3):
            for i in range(5):
                self.request(filename=f"{i}.png")
            self.assertEqual(len(server._IMAGE_VALIDATORS), 3)
            etag = '"' + server.image_digest(self.state["body"]) + '"'
            self.assertEqual(self.request(filename="0.png", conditional=etag).status, 304)
            self.assertIsNone(self.state["requests"][-1])

    def test_inconsistent_304_retries_without_trusting_wrong_identity(self):
        etag = self.prime()
        self.state["reply_etag"] = '"different-validator"'
        self.assertEqual(self.request(conditional=etag).status, 304)
        self.assertEqual(self.state["requests"], [None, '"version-one"', None])

    def test_body_fallback_rechecks_replacement_after_conditional_validation(self):
        self.prime()
        old_hash = server.image_digest(self.state["body"])[:16]
        self.state["replace_after_304"] = True
        req = self.request(digest=old_hash, conditional='"older-browser-cache"')
        self.assertEqual(req.status, 404)
        self.assertNotEqual(req.wfile.getvalue(), b"replacement after validation")

    def test_body_fallback_rechecks_browser_validator_after_source_changes(self):
        self.prime()
        older = b"a version already cached by the browser"
        self.state.update(replace_after_304=True, replacement_body=older)
        req = self.request(conditional='"' + server.image_digest(older) + '"')
        self.assertEqual(req.status, 304)
        self.assertEqual(req.wfile.getvalue(), b"")


if __name__ == "__main__":
    unittest.main()
