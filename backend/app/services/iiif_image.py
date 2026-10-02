"""
IIIF Image API 3.0 Service.

Provides URL generation for IIIF-compliant image server (Cantaloupe).

IIIF Image API specification: https://iiif.io/api/image/3.0/

The service generates URLs for:
- info.json: Image information (dimensions, tiles, etc.)
- Image requests: With region, size, rotation, quality, and format parameters
"""

import os
import logging
from typing import Optional
from urllib.parse import quote, urljoin

from app.models import Media

logger = logging.getLogger(__name__)

# IIIF Image Server configuration
# Can be overridden via environment variables
IIIF_IMAGE_SERVER_URL = os.environ.get(
    'IIIF_IMAGE_SERVER_URL',
    'https://iiif.example.com/iiif/3/'  # Cantaloupe endpoint
)
IIIF_IMAGE_SERVER_ENABLED = os.environ.get('IIIF_IMAGE_SERVER_ENABLED', 'false').lower() == 'true'


class IIIFImageService:
    """
    Service for generating IIIF Image API 3.0 compliant URLs.

    Works with Cantaloupe or any IIIF 3.0 image server.
    """

    def __init__(self, server_url: str = None):
        self.server_url = server_url or IIIF_IMAGE_SERVER_URL
        if not self.server_url.endswith('/'):
            self.server_url += '/'

    @staticmethod
    def is_available() -> bool:
        """Check if IIIF image server is enabled."""
        return IIIF_IMAGE_SERVER_ENABLED

    def get_image_identifier(self, media: Media) -> str:
        """
        Generate the IIIF image identifier for a media item.

        The identifier is URL-encoded and used as the base for all IIIF requests.
        Format: org_id/media_id

        For Cantaloupe with S3 resolver, this maps to the S3 key.
        """
        # Use a format that maps to S3 storage
        identifier = f"{media.organization_id}/{media.media_id}"
        return quote(identifier, safe='')

    def get_info_url(self, media: Media) -> str:
        """
        Generate the info.json URL for a media item.

        Returns the Image Information request URL per IIIF Image API 3.0.
        Example: https://iiif.example.com/iiif/3/{identifier}/info.json
        """
        identifier = self.get_image_identifier(media)
        return urljoin(self.server_url, f"{identifier}/info.json")

    def get_image_url(
        self,
        media: Media,
        region: str = "full",
        size: str = "max",
        rotation: str = "0",
        quality: str = "default",
        format: str = "jpg",
    ) -> str:
        """
        Generate an image request URL with IIIF parameters.

        IIIF Image API 3.0 URL format:
        {scheme}://{server}{/prefix}/{identifier}/{region}/{size}/{rotation}/{quality}.{format}

        Args:
            media: Media object
            region: Region parameter (full, square, x,y,w,h, pct:x,y,w,h)
            size: Size parameter (max, ^max, w,, ,h, pct:n, w,h, ^w,h, etc.)
            rotation: Rotation parameter (degrees, with optional ! for mirroring)
            quality: Quality parameter (color, gray, bitonal, default)
            format: Format parameter (jpg, png, webp, etc.)

        Returns:
            Complete IIIF image request URL
        """
        identifier = self.get_image_identifier(media)
        return urljoin(
            self.server_url,
            f"{identifier}/{region}/{size}/{rotation}/{quality}.{format}"
        )

    def get_thumbnail_url(
        self,
        media: Media,
        width: int = 200,
        height: Optional[int] = None,
    ) -> str:
        """
        Generate a thumbnail URL using IIIF parameters.

        Args:
            media: Media object
            width: Desired width
            height: Desired height (optional, maintains aspect ratio if omitted)

        Returns:
            IIIF image URL for thumbnail
        """
        if height:
            size = f"{width},{height}"
        else:
            size = f"{width},"

        return self.get_image_url(
            media=media,
            region="full",
            size=size,
            rotation="0",
            quality="default",
            format="jpg",
        )

    def get_preview_url(
        self,
        media: Media,
        max_dimension: int = 800,
    ) -> str:
        """
        Generate a preview URL (fits within max dimension).

        Args:
            media: Media object
            max_dimension: Maximum width or height

        Returns:
            IIIF image URL for preview
        """
        return self.get_image_url(
            media=media,
            region="full",
            size=f"!{max_dimension},{max_dimension}",
            rotation="0",
            quality="default",
            format="jpg",
        )

    def get_tile_url(
        self,
        media: Media,
        x: int,
        y: int,
        width: int,
        height: int,
        scale: float = 1.0,
    ) -> str:
        """
        Generate a tile URL for deep zoom viewing.

        Args:
            media: Media object
            x: X offset of tile
            y: Y offset of tile
            width: Width of tile region
            height: Height of tile region
            scale: Scale factor for output size

        Returns:
            IIIF image URL for tile
        """
        region = f"{x},{y},{width},{height}"
        if scale == 1.0:
            size = "full"
        else:
            output_width = int(width * scale)
            size = f"{output_width},"

        return self.get_image_url(
            media=media,
            region=region,
            size=size,
            rotation="0",
            quality="default",
            format="jpg",
        )


# Module-level singleton
_iiif_image_service: Optional[IIIFImageService] = None


def get_iiif_image_service() -> IIIFImageService:
    """Get or create the IIIF image service singleton."""
    global _iiif_image_service
    if _iiif_image_service is None:
        _iiif_image_service = IIIFImageService()
    return _iiif_image_service
