"""Tests for image transform service."""

import io

import pytest
from PIL import Image

from app.services.image_transform import TransformSpec, apply_transforms


def _make_image(width=100, height=100, mode="RGB", color=(128, 128, 128)):
    """Create a test image as bytes."""
    img = Image.new(mode, (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


class TestCrop:
    """Tests for crop transforms."""

    def test_crop_percent(self):
        image_bytes = _make_image(100, 100)
        spec = TransformSpec(
            crop_x=10, crop_y=10, crop_width=50, crop_height=50, crop_unit="percent"
        )
        result = apply_transforms(image_bytes, spec)
        assert result["width"] == 50
        assert result["height"] == 50

    def test_crop_pixels(self):
        image_bytes = _make_image(100, 100)
        spec = TransformSpec(
            crop_x=10, crop_y=10, crop_width=40, crop_height=30, crop_unit="pixels"
        )
        result = apply_transforms(image_bytes, spec)
        assert result["width"] == 40
        assert result["height"] == 30

    def test_crop_clamped_to_bounds(self):
        image_bytes = _make_image(100, 100)
        spec = TransformSpec(
            crop_x=80, crop_y=80, crop_width=50, crop_height=50, crop_unit="pixels"
        )
        result = apply_transforms(image_bytes, spec)
        assert result["width"] == 20
        assert result["height"] == 20


class TestRotate:
    """Tests for rotation."""

    def test_rotate_90(self):
        image_bytes = _make_image(100, 50)
        spec = TransformSpec(rotate=90)
        result = apply_transforms(image_bytes, spec)
        assert result["width"] == 50
        assert result["height"] == 100

    def test_rotate_180(self):
        image_bytes = _make_image(100, 50)
        spec = TransformSpec(rotate=180)
        result = apply_transforms(image_bytes, spec)
        assert result["width"] == 100
        assert result["height"] == 50

    def test_rotate_0_no_change(self):
        image_bytes = _make_image(100, 50)
        spec = TransformSpec(rotate=0)
        result = apply_transforms(image_bytes, spec)
        assert result["width"] == 100
        assert result["height"] == 50


class TestFlip:
    """Tests for flip transforms."""

    def test_flip_horizontal(self):
        image_bytes = _make_image(100, 100)
        spec = TransformSpec(flip_horizontal=True)
        result = apply_transforms(image_bytes, spec)
        assert result["width"] == 100
        assert result["height"] == 100

    def test_flip_vertical(self):
        image_bytes = _make_image(100, 100)
        spec = TransformSpec(flip_vertical=True)
        result = apply_transforms(image_bytes, spec)
        assert result["width"] == 100
        assert result["height"] == 100


class TestResize:
    """Tests for resize transforms."""

    def test_resize_downscale(self):
        image_bytes = _make_image(200, 200)
        spec = TransformSpec(max_width=100, max_height=100)
        result = apply_transforms(image_bytes, spec)
        assert result["width"] == 100
        assert result["height"] == 100

    def test_no_upscale(self):
        image_bytes = _make_image(50, 50)
        spec = TransformSpec(max_width=200, max_height=200)
        result = apply_transforms(image_bytes, spec)
        assert result["width"] == 50
        assert result["height"] == 50


class TestFormatOutput:
    """Tests for output format."""

    def test_output_jpeg(self):
        image_bytes = _make_image()
        spec = TransformSpec(format="jpeg")
        result = apply_transforms(image_bytes, spec)
        assert result["mime_type"] == "image/jpeg"
        assert result["extension"] == "jpg"

    def test_output_png(self):
        image_bytes = _make_image()
        spec = TransformSpec(format="png")
        result = apply_transforms(image_bytes, spec)
        assert result["mime_type"] == "image/png"
        assert result["extension"] == "png"

    def test_output_webp(self):
        image_bytes = _make_image()
        spec = TransformSpec(format="webp")
        result = apply_transforms(image_bytes, spec)
        assert result["mime_type"] == "image/webp"
        assert result["extension"] == "webp"

    def test_rgba_to_jpeg_composites_on_white(self):
        image_bytes = _make_image(mode="RGBA", color=(255, 0, 0, 128))
        spec = TransformSpec(format="jpeg")
        result = apply_transforms(image_bytes, spec)
        assert result["mime_type"] == "image/jpeg"
        # Should not raise — RGBA was composited to RGB

    def test_file_size_returned(self):
        image_bytes = _make_image()
        spec = TransformSpec(format="jpeg")
        result = apply_transforms(image_bytes, spec)
        assert result["file_size"] > 0
        assert result["file_size"] == len(result["transformed_bytes"])
