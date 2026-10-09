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
        self.assertIn("outside the local subset and use the system font", output.getvalue())

    def test_unusual_dynamic_characters_keep_system_fallback(self):
        current, files = fonts.corpus()
        output = io.StringIO()
        with patch.object(fonts, "corpus", return_value=(current | {0x1f9ea}, files)), redirect_stdout(output):
            fonts.check(self.metadata)
        self.assertIn("system fallback chain draws them", output.getvalue())

    def test_font_css_is_local_only(self):
        css = fonts.CSS.read_text(encoding="utf-8")
        self.assertIn(f"?v={self.manifest['sha256'][:10]}", css)
        self.assertIn("font-weight: 200 900;", css)
        self.assertNotIn("gstatic", css)
        self.assertNotIn("googleapis", css)
        self.assertIn('font-family: "Noto Serif TC";', css)
        self.assertTrue(fonts.SERIF.is_file())
        for name, _ in fonts.PLEX:
            self.assertTrue((fonts.FONT.parent / name).is_file(), name)
            self.assertIn(f"fonts/{name}?v=", css)

    def test_pages_make_no_google_font_requests(self):
        for filename in ("index.html", "fuse.html", "book.html", "album.html", "intro.html", "tutorial.html"):
            html = (fonts.ROOT / "web6" / filename).read_text(encoding="utf-8")
            self.assertIn('href="fonts.css"', html)
            self.assertNotIn("fonts.googleapis.com", html)
            self.assertNotIn("fonts.gstatic.com", html)


if __name__ == "__main__":
    unittest.main()
