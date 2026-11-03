#!/usr/bin/env python3
"""
Tests for build_thumbnail's decoder allowlist.

build_thumbnail must only hand JPEG, PNG and WebP bytes to Pillow. Every other
format Pillow can sniff (TIFF, GIF, EPS, MSP, BMP, ...) is refused before any
decoder runs, because backfill_thumbnails.py passes raw downloaded bytes.

Run with: python -m pytest tests/test_thumbnail.py -v
"""
import io
import sys
from unittest.mock import MagicMock

import pytest

# Mock external dependencies before importing main
sys.modules['secretsFile'] = MagicMock()
sys.modules['secretsFile'].SUPABASE_URL = 'https://test.supabase.co'
sys.modules['secretsFile'].SUPABASE_KEY = 'test-key'

Image = pytest.importorskip("PIL.Image")


def _encode(fmt, mode="RGB", size=(64, 48), **save_kwargs):
    color = (200, 30, 30, 128) if mode == "RGBA" else (200, 30, 30)
    img = Image.new(mode, size, color)
    buf = io.BytesIO()
    img.save(buf, format=fmt, **save_kwargs)
    return buf.getvalue()


class TestThumbnailAllowedFormats:
    @pytest.mark.parametrize("fmt,mode", [
        ("JPEG", "RGB"),
        ("PNG", "RGB"),
        ("PNG", "RGBA"),
        ("WEBP", "RGB"),
        ("WEBP", "RGBA"),
    ])
    def test_allowed_formats_produce_webp(self, fmt, mode):
        from main import build_thumbnail

        thumb = build_thumbnail(_encode(fmt, mode))

        assert thumb is not None
        with Image.open(io.BytesIO(thumb)) as out:
            assert out.format == "WEBP"
            assert out.mode == "RGB"

    def test_transparent_png_is_composited_onto_white(self):
        from main import build_thumbnail

        clear = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        buf = io.BytesIO()
        clear.save(buf, format="PNG")

        thumb = build_thumbnail(buf.getvalue())

        with Image.open(io.BytesIO(thumb)) as out:
            r, g, b = out.convert("RGB").getpixel((16, 16))
            assert min(r, g, b) > 240


class TestThumbnailRejectedFormats:
    @pytest.mark.parametrize("fmt", ["TIFF", "GIF", "BMP", "PPM", "ICO"])
    def test_non_allowlisted_formats_are_refused(self, fmt):
        from main import build_thumbnail

        assert build_thumbnail(_encode(fmt)) is None

    def test_garbage_bytes_are_refused(self):
        from main import build_thumbnail

        assert build_thumbnail(b"not an image at all" * 100) is None

    def test_empty_bytes_are_refused(self):
        from main import build_thumbnail

        assert build_thumbnail(b"") is None

    def test_allowlist_matches_accepted_mimes(self):
        import main

        mime_formats = {m.split("/")[1].upper() for m in main.IMAGE_ALLOWED_MIMES}
        assert set(main.THUMBNAIL_SOURCE_FORMATS) == mime_formats
