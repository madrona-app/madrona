"""
Media Search Service.

High-level service for searching media library via OpenSearch.
"""

import logging
from typing import Optional
from uuid import UUID

from app.config import get_settings
from app.search.client import get_opensearch_client, is_opensearch_available

from .index_manager import MediaIndexManager
from .query_builder import MediaQueryBuilder
from .transformer import transform_media_to_document
from .schemas import (
    MediaSearchRequest,
    MediaSearchResponse,
    MediaSearchHit,
    StructuredTag,
    Facet,
    FacetBucket,
)

logger = logging.getLogger(__name__)

# Module-level singleton
_media_search_service: Optional["MediaSearchService"] = None


def get_media_search_service() -> "MediaSearchService":
    """Get or create the media search service singleton."""
    global _media_search_service
    if _media_search_service is None:
        _media_search_service = MediaSearchService()
    return _media_search_service


class MediaSearchService:
    """
    Service for searching media library.

    Provides:
    - Full-text search with field boosting
    - Faceted filtering by type, folder, creator, etc.
    - Metadata-aware search (EXIF, IPTC, Dublin Core)
    - Processing status filtering
    """

    def __init__(self):
        self.client = get_opensearch_client()
        self.index_manager = MediaIndexManager(self.client)
        self.query_builder = MediaQueryBuilder()

    @staticmethod
    def is_available() -> bool:
        """Check if media search is available."""
        settings = get_settings()
        return settings.opensearch_enabled and is_opensearch_available()

    def setup_index(self) -> str:
        """Initialize the media search index."""
        return self.index_manager.setup()

    def search(
        self,
        request: MediaSearchRequest,
        organization_id: UUID,
    ) -> MediaSearchResponse:
        """
        Search media library.

        Args:
            request: Search request with query, filters, and options
            organization_id: Organization to search within

        Returns:
            Search response with hits, facets, and metadata
        """
        query = self.query_builder.build(request, str(organization_id))
        response = self.index_manager.search(query, str(organization_id))
        return self._parse_response(response, request)

    def _parse_response(
        self,
        response: dict,
        request: MediaSearchRequest,
    ) -> MediaSearchResponse:
        """Parse OpenSearch response into our schema."""
        hits = []
        for hit in response.get("hits", {}).get("hits", []):
            source = hit.get("_source", {})
            highlights = hit.get("highlight", {})

            # Parse structured tags
            structured_tags = None
            raw_structured_tags = source.get("structured_tags")
            if raw_structured_tags:
                structured_tags = [
                    StructuredTag(key=t.get("key", ""), value=t.get("value", ""))
                    for t in raw_structured_tags
                ]

            hits.append(MediaSearchHit(
                media_id=source.get("media_id"),
                filename=source.get("filename"),
                title=source.get("title"),
                description=source.get("description"),
                media_type=source.get("media_type"),
                mime_type=source.get("mime_type"),
                file_size=source.get("file_size", 0),
                width=source.get("width"),
                height=source.get("height"),
                creator=source.get("creator"),
                copyright_status=source.get("copyright_status"),
                folder=source.get("folder"),
                structured_tags=structured_tags,
                processing_status=source.get("processing_status", "unknown"),
                is_published=source.get("is_published", False),
                created_at=source.get("created_at"),
                score=hit.get("_score", 0),
                highlights=highlights if highlights else None,
            ))

        total = response.get("hits", {}).get("total", {})
        if isinstance(total, dict):
            total = total.get("value", 0)

        facets = None
        if request.include_facets:
            facets = self._parse_facets(response.get("aggregations", {}))

        next_offset = None
        if request.offset + request.limit < total:
            next_offset = request.offset + request.limit

        return MediaSearchResponse(
            hits=hits,
            total=total,
            facets=facets,
            took_ms=response.get("took", 0),
            next_offset=next_offset,
        )

    def _parse_facets(self, aggregations: dict) -> list[Facet]:
        """Parse OpenSearch aggregations into facets."""
        facets = []

        facet_mappings = [
            ("media_types", "media_type"),
            ("folders", "folder"),
            ("copyright_statuses", "copyright_status"),
            ("licenses", "license"),
            ("processing_statuses", "processing_status"),
            ("creators", "creator"),
            ("camera_makes", "camera_make"),
        ]

        for agg_name, facet_field in facet_mappings:
            if agg_name in aggregations:
                buckets = [
                    FacetBucket(
                        key=str(b.get("key")),
                        doc_count=b.get("doc_count", 0),
                    )
                    for b in aggregations[agg_name].get("buckets", [])
                ]
                if buckets:
                    facets.append(Facet(field=facet_field, buckets=buckets))

        return facets

    def index_media(self, media) -> None:
        """
        Index a single media item.

        Args:
            media: Media model instance
        """
        if not self.is_available():
            return

        try:
            doc = transform_media_to_document(media)
            self.index_manager.index_document(doc, str(media.media_id))
            logger.debug(f"Indexed media {media.media_id}")
        except Exception as e:
            logger.warning(f"Failed to index media {media.media_id}: {e}")

    def delete_media(
        self,
        media_id: UUID,
        organization_id: UUID,
    ) -> None:
        """
        Delete a media item from the index.

        Args:
            media_id: Media ID
            organization_id: Organization ID
        """
        if not self.is_available():
            return

        try:
            self.index_manager.delete_document(str(media_id), str(organization_id))
            logger.debug(f"Deleted media {media_id} from index")
        except Exception as e:
            logger.warning(f"Failed to delete media {media_id} from index: {e}")

    def reindex_organization(
        self,
        session,
        organization_id: UUID,
    ) -> dict:
        """
        Reindex all media for an organization.

        Args:
            session: SQLAlchemy session
            organization_id: Organization ID

        Returns:
            Dict with indexed and failed counts
        """
        from app.models import Media

        if not self.is_available():
            return {"indexed": 0, "failed": 0, "skipped": True}

        # Bootstrap before writing. bulk_index() targets the write alias, and
        # OpenSearch auto-creates a concrete index for a name that does not
        # exist — leaving a real index called "madrona-media-write" that reads
        # never touch, because search asks for the read alias and 404s.
        # setup_index() already detects that state and says so; running it here
        # is what stops it being reached. Same fix as the collections manager.
        self.setup_index()

        media_items = session.query(Media).filter(
            Media.organization_id == organization_id
        ).all()

        documents = []
        for media in media_items:
            doc = transform_media_to_document(media)
            documents.append((str(media.media_id), doc))

        result = self.index_manager.bulk_index(documents)
        self.index_manager.refresh()

        logger.info(
            f"Reindexed {result['indexed']} media for org {organization_id}, "
            f"{result['failed']} failed"
        )

        return result
