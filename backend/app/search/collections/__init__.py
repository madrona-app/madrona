"""
Collections Search Module.

Provides OpenSearch-powered search for procedure-compliant collection objects.
"""

from .index_manager import CollectionsIndexManager
from .query_builder import CollectionsQueryBuilder
from .transformer import CollectionObjectTransformer
from .service import CollectionsSearchService, get_collections_search_service
from .schemas import (
    CollectionsSearchRequest,
    CollectionsSearchResponse,
    CollectionsSearchHit,
    CollectionsAutocompleteResponse,
)

__all__ = [
    "CollectionsIndexManager",
    "CollectionsQueryBuilder",
    "CollectionObjectTransformer",
    "CollectionsSearchService",
    "get_collections_search_service",
    "CollectionsSearchRequest",
    "CollectionsSearchResponse",
    "CollectionsSearchHit",
    "CollectionsAutocompleteResponse",
]
