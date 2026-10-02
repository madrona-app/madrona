"""Tests for media conversion service."""

import io

import pytest
from PIL import Image

from app.services.media_conversion import convert_image, SUPPORTED_FORMATS


def _make_image(width=100, height=100, mode="RGB", color=(128, 128, 128), fmt="PNG"):
    """Create a test image as bytes."""
    img = Image.new(mode, (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


class TestConvertImage:
    """Tests for convert_image()."""

    def test_png_to_jpeg(self):
        image_bytes = _make_image(fmt="PNG")
        result = convert_image(image_bytes, "jpeg")
        assert result["mime_type"] == "image/jpeg"
        assert result["extension"] == "jpg"

    def test_jpeg_to_png(self):
        image_bytes = _make_image(fmt="JPEG")
        result = convert_image(image_bytes, "png")
        assert result["mime_type"] == "image/png"
        assert result["extension"] == "png"

    def test_png_to_webp(self):
        image_bytes = _make_image(fmt="PNG")
        result = convert_image(image_bytes, "webp")
        assert result["mime_type"] == "image/webp"
        assert result["extension"] == "webp"

    def test_rgba_composited_for_jpeg(self):
        image_bytes = _make_image(mode="RGBA", color=(255, 0, 0, 128))
        result = convert_image(image_bytes, "jpeg")
        assert result["mime_type"] == "image/jpeg"
        # Verify it's a valid JPEG
        img = Image.open(io.BytesIO(result["converted_bytes"]))
        assert img.mode == "RGB"

    def test_dimensions_preserved(self):
        image_bytes = _make_image(width=200, height=150)
        result = convert_image(image_bytes, "png")
        img = Image.open(io.BytesIO(result["converted_bytes"]))
        assert img.size == (200, 150)

    def test_quality_affects_file_size(self):
        """Higher quality should produce larger JPEG files on a noisy image."""
        import numpy as np
        from PIL import Image as PILImage
        # Create a noisy image so JPEG compression has something to work with
        rng = np.random.RandomState(42)
        arr = rng.randint(0, 256, (200, 200, 3), dtype=np.uint8)
        img = PILImage.fromarray(arr, "RGB")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        image_bytes = buf.getvalue()

        high_q = convert_image(image_bytes, "jpeg", quality=95)
        low_q = convert_image(image_bytes, "jpeg", quality=10)
        assert high_q["file_size"] > low_q["file_size"]

    def test_unsupported_format_raises(self):
        image_bytes = _make_image()
        with pytest.raises(ValueError, match="Unsupported format"):
            convert_image(image_bytes, "bmp")

    def test_palette_mode_auto_converted(self):
        """Palette (P) mode images should be auto-converted to RGB."""
        img = Image.new("P", (50, 50))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        image_bytes = buf.getvalue()
        result = convert_image(image_bytes, "jpeg")
        assert result["mime_type"] == "image/jpeg"

    def test_file_size_matches_bytes(self):
        image_bytes = _make_image()
        result = convert_image(image_bytes, "png")
        assert result["file_size"] == len(result["converted_bytes"])
