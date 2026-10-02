"""
OpenSearch integration for Madrona entity search.

This module provides:
- Full-text search with typo tolerance
- Faceted navigation
- Autocomplete suggestions
- Similar entity recommendations
"""

from app.search.client import get_opensearch_client, is_opensearch_available

__all__ = [
    "get_opensearch_client",
    "is_opensearch_available",
]
