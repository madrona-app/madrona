"""
ICC Color Profile Management service.

Extracts, embeds, and converts ICC profiles for images
using Pillow's ImageCms module.
"""

import io
import logging
from typing import Any

from PIL import Image, ImageCms

logger = logging.getLogger(__name__)


def extract_icc_profile(image_bytes: bytes) -> dict[str, Any] | None:
    """
    Extract ICC profile information from an image.

    Returns:
        Dict with profile info or None if no profile embedded
    """
    image = Image.open(io.BytesIO(image_bytes))
    icc_data = image.info.get("icc_profile")

    if not icc_data:
        return None

    try:
        profile = ImageCms.ImageCmsProfile(io.BytesIO(icc_data))
        desc = ImageCms.getProfileDescription(profile)
        name = ImageCms.getProfileName(profile)
        info = ImageCms.getProfileInfo(profile)

        return {
            "description": desc.strip() if desc else None,
            "name": name.strip() if name else None,
            "info": info.strip() if info else None,
            "color_space": str(profile.profile.xcolor_space).strip() if hasattr(profile.profile, "xcolor_space") else None,
            "has_profile": True,
        }
    except Exception as e:
        logger.debug("Failed to parse ICC profile: %s", e)
        return {"has_profile": True, "error": str(e)}


def convert_color_space(
    image_bytes: bytes,
    target_profile: str = "sRGB",
) -> bytes:
    """
    Convert image to a target color space.

    Args:
        image_bytes: Raw image bytes
        target_profile: Target profile name (sRGB)

    Returns:
        Converted image bytes
    """
    image = Image.open(io.BytesIO(image_bytes))
    icc_data = image.info.get("icc_profile")

    if not icc_data:
        # No source profile, return as-is
        output = io.BytesIO()
        image.save(output, format=image.format or "JPEG")
        return output.getvalue()

    try:
        source_profile = ImageCms.ImageCmsProfile(io.BytesIO(icc_data))
        target = ImageCms.createProfile(target_profile)

        converted = ImageCms.profileToProfile(
            image, source_profile, target,
            renderingIntent=ImageCms.Intent.PERCEPTUAL,
        )

        output = io.BytesIO()
        # Embed the target profile in the output
        target_icc = ImageCms.ImageCmsProfile(target).tobytes()
        converted.save(output, format=image.format or "JPEG", icc_profile=target_icc)
        return output.getvalue()

    except Exception as e:
        logger.warning("ICC conversion failed: %s", e)
        output = io.BytesIO()
        image.save(output, format=image.format or "JPEG")
        return output.getvalue()


def embed_icc_profile(
    image_bytes: bytes,
    profile_name: str = "sRGB",
) -> bytes:
    """
    Embed an ICC profile into an image.

    Args:
        image_bytes: Raw image bytes
        profile_name: Profile to embed (sRGB)

    Returns:
        Image bytes with embedded profile
    """
    image = Image.open(io.BytesIO(image_bytes))

    try:
        profile = ImageCms.createProfile(profile_name)
        icc_data = ImageCms.ImageCmsProfile(profile).tobytes()

        output = io.BytesIO()
        image.save(output, format=image.format or "JPEG", icc_profile=icc_data)
        return output.getvalue()

    except Exception as e:
        logger.warning("Failed to embed ICC profile: %s", e)
        output = io.BytesIO()
        image.save(output, format=image.format or "JPEG")
        return output.getvalue()
