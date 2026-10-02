"""Tests for ICC profile service."""

import io

import pytest
from PIL import Image, ImageCms

from app.services.icc_profile import (
    convert_color_space,
    embed_icc_profile,
    extract_icc_profile,
)


def _make_image(with_profile=False, fmt="JPEG"):
    """Create a test image, optionally with an sRGB ICC profile."""
    img = Image.new("RGB", (50, 50), (128, 64, 32))
    buf = io.BytesIO()

    if with_profile:
        srgb = ImageCms.createProfile("sRGB")
        icc_data = ImageCms.ImageCmsProfile(srgb).tobytes()
        img.save(buf, format=fmt, icc_profile=icc_data)
    else:
        img.save(buf, format=fmt)

    return buf.getvalue()


class TestExtractIccProfile:
    """Tests for extract_icc_profile()."""

    def test_image_with_profile(self):
        image_bytes = _make_image(with_profile=True)
        result = extract_icc_profile(image_bytes)
        assert result is not None
        assert result["has_profile"] is True
        assert result.get("description") is not None or result.get("name") is not None

    def test_image_without_profile(self):
        image_bytes = _make_image(with_profile=False)
        result = extract_icc_profile(image_bytes)
        assert result is None

    def test_png_with_profile(self):
        image_bytes = _make_image(with_profile=True, fmt="PNG")
        result = extract_icc_profile(image_bytes)
        assert result is not None
        assert result["has_profile"] is True


class TestEmbedIccProfile:
    """Tests for embed_icc_profile()."""

    def test_embed_srgb(self):
        image_bytes = _make_image(with_profile=False)
        result = embed_icc_profile(image_bytes, "sRGB")
        # The result should have a profile embedded
        img = Image.open(io.BytesIO(result))
        assert img.info.get("icc_profile") is not None

    def test_graceful_fallback_on_invalid_profile(self):
        image_bytes = _make_image()
        # Should not raise even with nonsense profile name
        result = embed_icc_profile(image_bytes, "NonExistentProfile")
        assert len(result) > 0


class TestConvertColorSpace:
    """Tests for convert_color_space()."""

    def test_convert_with_profile(self):
        image_bytes = _make_image(with_profile=True)
        result = convert_color_space(image_bytes, "sRGB")
        assert len(result) > 0
        img = Image.open(io.BytesIO(result))
        assert img.size == (50, 50)

    def test_no_source_profile_returns_as_is(self):
        image_bytes = _make_image(with_profile=False)
        result = convert_color_space(image_bytes, "sRGB")
        assert len(result) > 0
