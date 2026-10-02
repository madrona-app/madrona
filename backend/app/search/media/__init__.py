"""
Media Search Module.

Provides OpenSearch-based full-text search for the DAM media library.
"""

from .service import MediaSearchService, get_media_search_service
from .schemas import (
    MediaSearchRequest,
    MediaSearchResponse,
    MediaSearchHit,
)

__all__ = [
    "MediaSearchService",
    "get_media_search_service",
    "MediaSearchRequest",
    "MediaSearchResponse",
    "MediaSearchHit",
]
