"""
Color extraction service.

Extracts dominant colors from images using KMeans clustering,
maps to named color buckets, generates a 5-char color key
for bucket filtering.
"""

import io
import logging
from typing import Any
from uuid import UUID

import numpy as np

from app.database import current_session

logger = logging.getLogger(__name__)

# 12 named color buckets (matching ResourceSpace pattern)
COLOR_BUCKETS = {
    "red": (255, 0, 0),
    "orange": (255, 165, 0),
    "yellow": (255, 255, 0),
    "green": (0, 128, 0),
    "teal": (0, 128, 128),
    "blue": (0, 0, 255),
    "purple": (128, 0, 128),
    "pink": (255, 192, 203),
    "brown": (139, 69, 19),
    "black": (0, 0, 0),
    "gray": (128, 128, 128),
    "white": (255, 255, 255),
}


def _closest_color_name(rgb: tuple[int, int, int]) -> str:
    """Map an RGB color to the closest named color bucket."""
    min_dist = float("inf")
    closest = "gray"

    for name, bucket_rgb in COLOR_BUCKETS.items():
        dist = sum((a - b) ** 2 for a, b in zip(rgb, bucket_rgb))
        if dist < min_dist:
            min_dist = dist
            closest = name

    return closest


def _rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    """Convert RGB tuple to hex string."""
    return "#{:02x}{:02x}{:02x}".format(*rgb)


# Unique single-char key per color bucket — matches the frontend ColorFilter.
# Using first-letter-of-name would collide (green/gray → g, blue/brown/black → b).
_COLOR_CHAR: dict[str, str] = {
    "red": "r",
    "orange": "o",
    "yellow": "y",
    "green": "g",
    "teal": "t",
    "blue": "b",
    "purple": "p",
    "pink": "i",
    "brown": "n",
    "black": "k",
    "gray": "a",
    "white": "w",
}


def _generate_color_key(dominant_colors: list[dict]) -> str:
    """
    Generate a 5-char color key from dominant colors.

    Each char is the unique bucket key for that position's closest named
    color. E.g., "brgwk" for blue, red, green, white, black. The key
    letters match the frontend's ColorFilter component so a wildcard
    search for '*g*' finds every image where green is one of the top 5
    colors.
    """
    chars = [_COLOR_CHAR.get(c["name"], "x") for c in dominant_colors[:5]]
    while len(chars) < 5:
        chars.append("x")
    return "".join(chars)


def extract_dominant_colors(
    image_bytes: bytes,
    n_colors: int = 5,
    sample_size: int = 1000,
) -> list[dict[str, Any]]:
    """
    Extract dominant colors from an image.

    Uses KMeans clustering on sampled pixels.

    Args:
        image_bytes: Raw image file bytes
        n_colors: Number of dominant colors to extract
        sample_size: Number of pixels to sample

    Returns:
        List of color dicts with hex, rgb, percentage, name
    """
    from PIL import Image
    from sklearn.cluster import KMeans

    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    # Resize for faster processing
    image.thumbnail((200, 200))
    pixels = np.array(image).reshape(-1, 3)

    # Sample pixels if too many
    if len(pixels) > sample_size:
        indices = np.random.choice(len(pixels), sample_size, replace=False)
        pixels = pixels[indices]

    # Cluster colors
    n_colors = min(n_colors, len(pixels))
    kmeans = KMeans(n_clusters=n_colors, n_init=10, random_state=42)
    kmeans.fit(pixels)

    # Get cluster sizes
    labels, counts = np.unique(kmeans.labels_, return_counts=True)
    total = len(kmeans.labels_)

    # Build result
    colors = []
    for center, count in sorted(zip(kmeans.cluster_centers_, counts), key=lambda x: -x[1]):
        rgb = tuple(int(c) for c in center)
        colors.append({
            "hex": _rgb_to_hex(rgb),
            "rgb": list(rgb),
            "percentage": round(count / total * 100, 1),
            "name": _closest_color_name(rgb),
        })

    return colors


def process_media_colors(
    media_id: UUID,
    organization_id: UUID,
) -> dict[str, Any]:
    """
    Extract and store dominant colors for a media item.

    Args:
        media_id: Media UUID
        organization_id: Organization UUID

    Returns:
        Dict with color extraction results
    """
    from app.models import Media
    from app.services.storage import get_storage_backend

    media = current_session().query(Media).filter_by(
        media_id=media_id,
        organization_id=organization_id,
    ).first()

    if not media:
        raise ValueError(f"Media not found: {media_id}")

    if media.media_type != "image":
        return {"success": False, "reason": "Not an image"}

    storage = get_storage_backend(str(organization_id), current_session())
    data, _ = storage.get_object_sync(media.s3_key)

    colors = extract_dominant_colors(data)
    color_key = _generate_color_key(colors)

    media.dominant_colors = colors
    media.color_key = color_key
    current_session().commit()

    return {
        "success": True,
        "media_id": str(media_id),
        "dominant_colors": colors,
        "color_key": color_key,
    }
