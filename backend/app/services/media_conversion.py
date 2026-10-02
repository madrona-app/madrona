"""
Media format conversion service.

Converts between image formats (TIFF, JPEG, PNG, WebP) on download.
"""

import io
import logging
from typing import Any

from PIL import Image

logger = logging.getLogger(__name__)

SUPPORTED_FORMATS = {
    "jpeg": {"ext": "jpg", "mime": "image/jpeg", "pil_format": "JPEG"},
    "jpg": {"ext": "jpg", "mime": "image/jpeg", "pil_format": "JPEG"},
    "png": {"ext": "png", "mime": "image/png", "pil_format": "PNG"},
    "webp": {"ext": "webp", "mime": "image/webp", "pil_format": "WebP"},
    "tiff": {"ext": "tiff", "mime": "image/tiff", "pil_format": "TIFF"},
    "tif": {"ext": "tiff", "mime": "image/tiff", "pil_format": "TIFF"},
    "avif": {"ext": "avif", "mime": "image/avif", "pil_format": "AVIF"},
}


def convert_image(
    image_bytes: bytes,
    target_format: str,
    quality: int = 85,
) -> dict[str, Any]:
    """
    Convert an image to a different format.

    Args:
        image_bytes: Raw image file bytes
        target_format: Target format (jpeg, png, webp, tiff, avif)
        quality: JPEG/WebP quality (1-100)

    Returns:
        Dict with converted_bytes, mime_type, extension
    """
    format_info = SUPPORTED_FORMATS.get(target_format.lower())
    if not format_info:
        raise ValueError(f"Unsupported format: {target_format}")

    image = Image.open(io.BytesIO(image_bytes))

    # Convert RGBA to RGB for formats that don't support transparency
    if image.mode == "RGBA" and format_info["pil_format"] in ("JPEG", "TIFF"):
        background = Image.new("RGB", image.size, (255, 255, 255))
        background.paste(image, mask=image.split()[3])
        image = background
    elif image.mode not in ("RGB", "RGBA", "L"):
        image = image.convert("RGB")

    output = io.BytesIO()
    save_kwargs = {"format": format_info["pil_format"]}

    if format_info["pil_format"] in ("JPEG", "WebP", "AVIF"):
        save_kwargs["quality"] = quality
    if format_info["pil_format"] == "JPEG":
        save_kwargs["progressive"] = True
    if format_info["pil_format"] == "PNG":
        save_kwargs["optimize"] = True

    image.save(output, **save_kwargs)
    converted_bytes = output.getvalue()

    return {
        "converted_bytes": converted_bytes,
        "mime_type": format_info["mime"],
        "extension": format_info["ext"],
        "file_size": len(converted_bytes),
    }
