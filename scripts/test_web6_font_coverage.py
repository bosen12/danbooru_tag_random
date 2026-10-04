"""Offline contracts for font coverage, dynamic text, and page wiring."""
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import build_web6_fonts as fonts


class FontCoverage(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.metadata = json.loads(fonts.META.read_text(encoding="utf-8"))
        cls.manifest = json.loads(fonts.MANIFEST.read_text(encoding="utf-8"))

    def test_current_sources_and_asset_integrity(self):
        fonts.check(self.metadata)

    def test_new_vocabulary_is_supported_without_rebuild(self):
        included = set(self.manifest["unicodes"])
        available = set().union(*(fonts.points(face["unicode_range"]) for face in self.metadata["fallback_faces"]))
        new = next(c for c in available - included if 0x4e00 <= c <= 0x9fff)
        current, files = fonts.corpus()
        output = io.StringIO()
        with patch.object(fonts, "corpus", return_value=(current | {new}, files)), redirect_stdout(output):
            fonts.check(self.metadata)
        self.assertIn("newly introduced characters use matching upstream faces", output.getvalue())

    def test_unusual_dynamic_characters_keep_system_fallback(self):
        current, files = fonts.corpus()
        output = io.StringIO()
        with patch.object(fonts, "corpus", return_value=(current | {0x1f9ea}, files)), redirect_stdout(output):
            fonts.check(self.metadata)
        self.assertIn("existing system/body fallbacks still apply", output.getvalue())

    def test_local_and_upstream_ranges_are_disjoint(self):
        included = set(self.manifest["unicodes"])
        css = fonts.CSS.read_text(encoding="utf-8")
        seen = included.copy()
        for face in self.metadata["fallback_faces"]:
            original = fonts.points(face["unicode_range"])
            remaining = original - included
            self.assertFalse(seen & remaining)
            seen.update(remaining)
        self.assertIn(f"?v={self.manifest['sha256'][:10]}", css)

    def test_four_pages_request_local_chiron_only(self):
        for filename in ("index.html", "fuse.html", "intro.html", "tutorial.html"):
            html = (fonts.ROOT / "web6" / filename).read_text(encoding="utf-8")
            self.assertIn('href="fonts.css"', html)
            self.assertNotIn("family=Chiron+Hei+HK", html)
            self.assertIn("family=IBM+Plex+Mono", html)
            self.assertIn("family=Noto+Sans+TC", html)


if __name__ == "__main__":
    unittest.main()
