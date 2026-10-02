"""
IIIF Presentation API 3.0 Service.

Generates IIIF manifests for collection objects and their associated media.

IIIF Presentation API specification: https://iiif.io/api/presentation/3.0/

The service generates:
- Manifest: For a single collection object with its media
- Collection: For a group of objects (e.g., an exhibition)
"""

import os
import logging
from typing import Any, Optional

from app.models import CollectionObject, Media, CollectionObjectMedia
from app.services.iiif_image import get_iiif_image_service, IIIFImageService
from app.services.uploads import get_org_media_url

logger = logging.getLogger(__name__)

# IIIF Presentation configuration
IIIF_PRESENTATION_BASE_URL = os.environ.get(
    'IIIF_PRESENTATION_BASE_URL',
    'https://api.example.com/iiif/3/'
)


class IIIFPresentationService:
    """
    Service for generating IIIF Presentation API 3.0 manifests.

    Generates manifests that can be loaded in IIIF viewers like:
    - OpenSeadragon
    - Mirador
    - Universal Viewer
    """

    def __init__(self, base_url: str = None, image_service: IIIFImageService = None, db_session=None):
        self.base_url = base_url or IIIF_PRESENTATION_BASE_URL
        if not self.base_url.endswith('/'):
            self.base_url += '/'
        self.image_service = image_service or get_iiif_image_service()
        self.db_session = db_session
        # Cache for presigned URLs during manifest generation
        self._url_cache: dict[str, str] = {}

    @staticmethod
    def _get_display_title(obj: CollectionObject) -> str:
        """Get the preferred display title from the object's title_links."""
        try:
            if obj.title_links:
                preferred = next((t for t in obj.title_links if t.is_preferred), None)
                if preferred:
                    return preferred.title or "Untitled"
                if obj.title_links:
                    return obj.title_links[0].title or "Untitled"
            return obj.object_name or "Untitled"
        except Exception:
            return getattr(obj, 'object_name', None) or "Untitled"

    def _get_presigned_url(
        self,
        media: Media,
        use_thumbnail: bool = False,
        s3_key_override: Optional[str] = None,
    ) -> Optional[str]:
        """
        Get a presigned S3 URL for a media item.

        Uses caching to avoid generating multiple URLs for the same media.
        URLs are valid for 1 hour.

        Args:
            media: Media row.
            use_thumbnail: When True, uses the thumbnail derivative key.
            s3_key_override: Explicit S3 key to sign instead of the default
                (original or thumbnail). Used by the IIIF viewer to serve
                a display-sized derivative instead of a full original.
        """
        if not self.db_session:
            return None

        key_label = s3_key_override or ('thumb' if use_thumbnail else 'full')
        cache_key = f"{media.media_id}:{key_label}"
        if cache_key in self._url_cache:
            return self._url_cache[cache_key]

        try:
            if s3_key_override:
                s3_key = s3_key_override
            elif use_thumbnail and media.thumbnail_s3_key:
                s3_key = media.thumbnail_s3_key
            else:
                s3_key = media.s3_key
            if not s3_key:
                return None

            url = get_org_media_url(
                s3_key,
                organization_id=str(media.organization_id),
                db_session=self.db_session,
                expiry_seconds=3600
            )
            self._url_cache[cache_key] = url
            return url
        except Exception as e:
            logger.warning(f"Failed to generate presigned URL for media {media.media_id}: {e}")
            return None

    # Preference order for viewer display. access_master (4000 px JPEG) is the
    # IIIF community's standard "access master" size; large is a fallback for
    # older media that was processed before access_master existed.
    _DISPLAY_DERIVATIVE_PREFERENCE = ('access_master', 'large')

    def _pick_display_source(self, media: Media) -> tuple[Optional[str], int, int]:
        """Pick the (s3_key, width, height) to feed the IIIF viewer.

        Returns the access_master derivative when available; falls back to
        the original so pre-derivative media still renders. Canvas dimensions
        follow the chosen source so OpenSeadragon scales correctly.
        """
        derivatives = getattr(media, 'derivatives', None) or []
        for name in self._DISPLAY_DERIVATIVE_PREFERENCE:
            for d in derivatives:
                if d.derivative_type == name and d.s3_key and d.width and d.height:
                    return d.s3_key, d.width, d.height
        return media.s3_key, media.width or 1000, media.height or 1000

    def generate_manifest(
        self,
        obj: CollectionObject,
        media_items: list[CollectionObjectMedia],
        organization_name: str = None,
    ) -> dict[str, Any]:
        """
        Generate a IIIF Presentation 3.0 manifest for a collection object.

        This method is designed to be resilient — metadata and attribution failures
        must never prevent the manifest from returning with image canvases.

        Args:
            obj: CollectionObject model
            media_items: List of CollectionObjectMedia links (with media loaded)
            organization_name: Optional organization name for attribution

        Returns:
            IIIF Presentation 3.0 manifest as a dictionary
        """
        manifest_id = f"{self.base_url}{obj.object_id}/manifest.json"

        manifest = {
            "@context": "http://iiif.io/api/presentation/3/context.json",
            "id": manifest_id,
            "type": "Manifest",
            "label": self._create_language_map(self._get_display_title(obj)),
            "items": [],
        }

        # Add thumbnail from primary image
        try:
            primary_media = next(
                (m for m in media_items if m.is_primary and m.media),
                media_items[0] if media_items else None
            )
            if primary_media and primary_media.media:
                manifest["thumbnail"] = [self._create_thumbnail(primary_media.media)]
        except Exception as e:
            logger.warning(f"Failed to generate thumbnail for manifest: {e}")

        # Create canvases for each media item
        for idx, link in enumerate(media_items):
            try:
                if link.media and link.media.media_type == 'image':
                    canvas = self._create_canvas(link.media, idx + 1, link.caption_override)
                    manifest["items"].append(canvas)
            except Exception as e:
                logger.warning(f"Failed to create canvas for media {getattr(link, 'media_id', '?')}: {e}")
                continue

        return manifest

    def generate_collection_manifest(
        self,
        collection_id: str,
        objects: list[CollectionObject],
        label: str,
        description: str = None,
    ) -> dict[str, Any]:
        """
        Generate a IIIF Collection manifest for a group of objects.

        Args:
            collection_id: Unique identifier for the collection
            objects: List of CollectionObject models
            label: Collection label/title
            description: Optional description

        Returns:
            IIIF Presentation 3.0 collection manifest
        """
        collection = {
            "@context": "http://iiif.io/api/presentation/3/context.json",
            "id": f"{self.base_url}collection/{collection_id}/manifest.json",
            "type": "Collection",
            "label": self._create_language_map(label),
            "items": [],
        }

        if description:
            collection["summary"] = self._create_language_map(description)

        # Add references to object manifests
        for obj in objects:
            collection["items"].append({
                "id": f"{self.base_url}{obj.object_id}/manifest.json",
                "type": "Manifest",
                "label": self._create_language_map(self._get_display_title(obj)),
            })

        return collection

    def _create_canvas(
        self,
        media: Media,
        sequence: int,
        caption: str = None,
    ) -> dict[str, Any]:
        """Create a IIIF Canvas for a media item."""
        canvas_id = f"{self.base_url}canvas/{media.media_id}"

        # Canvas dimensions follow the image source we're actually going to
        # serve (access_master derivative by default, or original). For the
        # Cantaloupe path, dimensions still reflect the original — Cantaloupe
        # reads the original and serves tiles at any size.
        if self.image_service.is_available():
            width = media.width or 1000
            height = media.height or 1000
        else:
            _, width, height = self._pick_display_source(media)

        canvas = {
            "id": canvas_id,
            "type": "Canvas",
            "label": self._create_language_map(caption or media.title or f"Image {sequence}"),
            "width": width,
            "height": height,
            "items": [
                {
                    "id": f"{canvas_id}/annotationpage",
                    "type": "AnnotationPage",
                    "items": [
                        self._create_image_annotation(media, canvas_id, width, height)
                    ],
                }
            ],
        }

        # Add thumbnail
        canvas["thumbnail"] = [self._create_thumbnail(media)]

        return canvas

    def _create_image_annotation(
        self,
        media: Media,
        canvas_id: str,
        width: int,
        height: int,
    ) -> dict[str, Any]:
        """Create an image annotation for a canvas."""
        annotation_id = f"{canvas_id}/annotation"

        # Get IIIF image info URL
        if self.image_service.is_available():
            # TODO: when the source is a flat (non-pyramidal) TIFF or large
            # JPEG, consider pointing Cantaloupe at the access_master
            # derivative instead of the original. Gated on media.is_pyramidal_tiff.
            # Requires a Cantaloupe delegate script or a second identifier scheme.
            image_service_id = self.image_service.get_info_url(media).replace('/info.json', '')
            image_body = {
                "id": f"{image_service_id}/full/max/0/default.jpg",
                "type": "Image",
                "format": "image/jpeg",
                "width": width,
                "height": height,
                "service": [
                    {
                        "id": image_service_id,
                        "type": "ImageService3",
                        "profile": "level2",
                    }
                ],
            }
        else:
            # Fallback: presigned URL to the access_master derivative (4000 px
            # JPEG). Serving the full original here is unworkable for large
            # TIFFs — OpenSeadragon would have to download the whole file
            # before rendering. Falls back to the original only if the
            # derivative hasn't been generated yet (pre-existing media).
            display_key, _, _ = self._pick_display_source(media)
            using_derivative = display_key and display_key != media.s3_key

            image_url = self._get_presigned_url(
                media,
                use_thumbnail=False,
                s3_key_override=display_key if using_derivative else None,
            )
            if not image_url:
                # Last resort fallback
                image_url = f"{self.base_url}media/{media.media_id}/full.jpg"

            image_body = {
                "id": image_url,
                "type": "Image",
                "format": "image/jpeg" if using_derivative else (media.mime_type or "image/jpeg"),
                "width": width,
                "height": height,
            }

        return {
            "id": annotation_id,
            "type": "Annotation",
            "motivation": "painting",
            "body": image_body,
            "target": canvas_id,
        }

    def _create_thumbnail(self, media: Media) -> dict[str, Any]:
        """Create a thumbnail object."""
        if self.image_service.is_available():
            thumbnail_url = self.image_service.get_thumbnail_url(media, width=200)
        else:
            # Use presigned S3 URL for thumbnail (or main image if no thumbnail exists)
            thumbnail_url = self._get_presigned_url(media, use_thumbnail=True)
            if not thumbnail_url:
                thumbnail_url = self._get_presigned_url(media, use_thumbnail=False)
            if not thumbnail_url:
                # Last resort fallback
                thumbnail_url = f"{self.base_url}media/{media.media_id}/thumbnail.jpg"

        return {
            "id": thumbnail_url,
            "type": "Image",
            "format": "image/jpeg",
            "width": 200,
            "height": 200 if not media.width else int(200 * (media.height or 1) / (media.width or 1)),
        }

    def _create_language_map(self, text: str, lang: str = "en") -> dict[str, list[str]]:
        """Create a IIIF language map from a string."""
        return {lang: [text]}


# Module-level singleton
_iiif_presentation_service: Optional[IIIFPresentationService] = None


def get_iiif_presentation_service() -> IIIFPresentationService:
    """Get or create the IIIF presentation service singleton."""
    global _iiif_presentation_service
    if _iiif_presentation_service is None:
        _iiif_presentation_service = IIIFPresentationService()
    return _iiif_presentation_service
