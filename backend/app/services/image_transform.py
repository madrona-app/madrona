"""
Image transform service.

Applies crop, rotate, flip, gamma, resize, and ICC profile
transforms to images on download.
"""

import io
import logging
from dataclasses import dataclass
from typing import Any

from PIL import Image, ImageEnhance

logger = logging.getLogger(__name__)


@dataclass
class TransformSpec:
    """Specification for image transforms."""
    # Crop (percentages 0-100 or pixels)
    crop_x: float | None = None
    crop_y: float | None = None
    crop_width: float | None = None
    crop_height: float | None = None
    crop_unit: str = "percent"  # percent or pixels

    # Rotate
    rotate: int | None = None  # 0, 90, 180, 270

    # Flip
    flip_horizontal: bool = False
    flip_vertical: bool = False

    # Gamma/brightness
    gamma: float | None = None  # 0.1 to 3.0

    # Resize
    max_width: int | None = None
    max_height: int | None = None

    # Output
    format: str = "jpeg"  # jpeg, png, webp
    quality: int = 85


def apply_transforms(
    image_bytes: bytes,
    spec: TransformSpec,
) -> dict[str, Any]:
    """
    Apply transforms to an image.

    Args:
        image_bytes: Raw image file bytes
        spec: Transform specification

    Returns:
        Dict with transformed_bytes, width, height, mime_type
    """
    from app.services.media_conversion import SUPPORTED_FORMATS

    image = Image.open(io.BytesIO(image_bytes))

    # Convert to RGB if needed for JPEG output
    if spec.format in ("jpeg", "jpg") and image.mode == "RGBA":
        background = Image.new("RGB", image.size, (255, 255, 255))
        background.paste(image, mask=image.split()[3])
        image = background
    elif image.mode not in ("RGB", "RGBA", "L"):
        image = image.convert("RGB")

    # Crop
    if all(v is not None for v in [spec.crop_x, spec.crop_y, spec.crop_width, spec.crop_height]):
        w, h = image.size
        if spec.crop_unit == "percent":
            left = int(w * spec.crop_x / 100)
            top = int(h * spec.crop_y / 100)
            right = left + int(w * spec.crop_width / 100)
            bottom = top + int(h * spec.crop_height / 100)
        else:
            left = int(spec.crop_x)
            top = int(spec.crop_y)
            right = left + int(spec.crop_width)
            bottom = top + int(spec.crop_height)

        # Clamp to image bounds
        left = max(0, min(left, w))
        top = max(0, min(top, h))
        right = max(left + 1, min(right, w))
        bottom = max(top + 1, min(bottom, h))

        image = image.crop((left, top, right, bottom))

    # Rotate
    if spec.rotate and spec.rotate in (90, 180, 270):
        image = image.rotate(-spec.rotate, expand=True)

    # Flip
    if spec.flip_horizontal:
        image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if spec.flip_vertical:
        image = image.transpose(Image.Transpose.FLIP_TOP_BOTTOM)

    # Gamma
    if spec.gamma and spec.gamma != 1.0:
        enhancer = ImageEnhance.Brightness(image)
        image = enhancer.enhance(spec.gamma)

    # Resize
    if spec.max_width or spec.max_height:
        w, h = image.size
        max_w = spec.max_width or w
        max_h = spec.max_height or h

        ratio = min(max_w / w, max_h / h)
        if ratio < 1.0:
            new_w = int(w * ratio)
            new_h = int(h * ratio)
            image = image.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # Save to target format
    format_info = SUPPORTED_FORMATS.get(spec.format.lower(), SUPPORTED_FORMATS["jpeg"])
    output = io.BytesIO()

    save_kwargs = {"format": format_info["pil_format"]}
    if format_info["pil_format"] in ("JPEG", "WebP", "AVIF"):
        save_kwargs["quality"] = spec.quality
    if format_info["pil_format"] == "JPEG":
        save_kwargs["progressive"] = True

    image.save(output, **save_kwargs)
    result_bytes = output.getvalue()

    return {
        "transformed_bytes": result_bytes,
        "width": image.size[0],
        "height": image.size[1],
        "mime_type": format_info["mime"],
        "extension": format_info["ext"],
        "file_size": len(result_bytes),
    }
