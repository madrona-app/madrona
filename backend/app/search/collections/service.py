"""
Collections Search Service.

High-level service for searching collection objects via OpenSearch.
"""

import logging
from typing import Optional
from uuid import UUID

from app.config import get_settings
from app.search.client import get_opensearch_client, is_opensearch_available

from .index_manager import CollectionsIndexManager
from .query_builder import CollectionsQueryBuilder
from .schemas import (
    CollectionsSearchRequest,
    CollectionsSearchResponse,
    CollectionsSearchHit,
    CollectionsAutocompleteResponse,
    CollectionsAutocompleteSuggestion,
    Facet,
    FacetBucket,
)

logger = logging.getLogger(__name__)


class CollectionsSearchService:
    """
    Service for searching collection objects.

    Provides:
    - Full-text search with procedure-aware field boosting
    - Advanced search with field-specific operators
    - Faceted filtering
    - Autocomplete
    """

    def __init__(self):
        self.client = get_opensearch_client()
        self.index_manager = CollectionsIndexManager(self.client)
        self.query_builder = CollectionsQueryBuilder()

    @staticmethod
    def is_available() -> bool:
        """Check if Collections search is available."""
        settings = get_settings()
        return settings.opensearch_enabled and is_opensearch_available()

    def setup_index(self) -> str:
        """Initialize the Collections search index."""
        return self.index_manager.setup()

    def search(
        self,
        request: CollectionsSearchRequest,
        organization_id: UUID,
        db_session=None,
    ) -> CollectionsSearchResponse:
        """
        Search collection objects with optional hybrid (BM25 + semantic) search.

        If semantic search is enabled and a text query is provided, runs both
        a BM25 query and a KNN query, then merges results via Reciprocal Rank
        Fusion. Falls back to BM25-only on any failure.

        Args:
            request: Search request with query, filters, and options
            organization_id: Organization to search within
            db_session: Optional SQLAlchemy session for vocabulary expansion

        Returns:
            Search response with hits, facets, and metadata
        """
        org_str = str(organization_id)

        # 1. Always run BM25 query
        query = self.query_builder.build(request, org_str, db_session=db_session)
        bm25_response = self.index_manager.search(query, org_str)

        # 2. Attempt semantic search if enabled and text query provided
        used_semantic = False
        text_query = request.query.q if request.query else None

        if text_query and self._should_use_semantic_search():
            try:
                used_semantic = self._apply_hybrid_search(
                    bm25_response, text_query, org_str, request,
                )
            except Exception as e:
                logger.warning("Semantic search failed, using BM25 only: %s", e)

        response = self._parse_response(bm25_response, request)
        response.used_semantic_search = used_semantic

        # Enrich hits with primary image URLs from the database
        self._enrich_with_images(response.hits, organization_id, session=db_session)

        return response

    def _should_use_semantic_search(self) -> bool:
        """Check if semantic search is enabled and available."""
        from app.config import get_settings
        from app.services.embedding_service import is_embedding_service_available
        settings = get_settings()
        return settings.semantic_search_enabled and is_embedding_service_available()

    def _apply_hybrid_search(
        self,
        bm25_response: dict,
        text_query: str,
        organization_id: str,
        request: CollectionsSearchRequest,
    ) -> bool:
        """
        Run KNN search and merge with BM25 results via RRF.

        Mutates bm25_response hits ordering in place.
        Returns True if semantic search was actually applied.
        """
        from app.services.embedding_service import get_embedding

        query_embedding = get_embedding(text_query, task="search_query")
        if not query_embedding:
            return False

        # Build and run KNN query
        knn_query = self.query_builder.build_knn_query(
            embedding=query_embedding,
            organization_id=organization_id,
            filters=request.filters,
            k=request.limit * 2,
        )
        knn_response = self.index_manager.search(knn_query, organization_id)

        knn_hits_raw = knn_response.get("hits", {}).get("hits", [])
        if not knn_hits_raw:
            return False

        # Filter KNN results by relative score — drop results that score
        # significantly below the top hit. Natural-language embeddings create
        # good score differentiation, so 5% headroom captures relevant results
        # while filtering noise.
        top_knn_score = knn_hits_raw[0].get("_score", 0)
        score_threshold = top_knn_score * 0.95  # within 5% of top score
        knn_hits_raw = [h for h in knn_hits_raw if h.get("_score", 0) >= score_threshold]

        # Extract object_ids from both result sets
        bm25_hits = [
            {"object_id": h["_source"].get("object_id")}
            for h in bm25_response.get("hits", {}).get("hits", [])
        ]
        knn_hits = [
            {"object_id": h["_source"].get("object_id")}
            for h in knn_hits_raw
        ]

        has_bm25 = len(bm25_hits) > 0

        # RRF merge
        merged_order = self.query_builder.rrf_merge(bm25_hits, knn_hits)

        # Build lookup of existing BM25 hits by object_id
        bm25_hit_map = {
            h["_source"].get("object_id"): h
            for h in bm25_response.get("hits", {}).get("hits", [])
        }

        # For KNN-only hits, fetch their full documents.
        # When BM25 returned nothing, cap KNN-only results to avoid flooding
        # with low-confidence matches from a semantically homogeneous corpus.
        knn_only_ids = [oid for oid in merged_order if oid not in bm25_hit_map]
        if not has_bm25 and len(knn_only_ids) > 5:
            knn_only_ids = knn_only_ids[:5]
            merged_order = [oid for oid in merged_order if oid in bm25_hit_map or oid in knn_only_ids]
        if knn_only_ids:
            fetched = self._fetch_documents(knn_only_ids, organization_id)
            bm25_hit_map.update(fetched)

        # Reorder hits according to RRF ranking
        reordered = []
        for oid in merged_order:
            if oid in bm25_hit_map:
                reordered.append(bm25_hit_map[oid])

        # Apply pagination window
        offset = request.offset
        limit = request.limit
        paginated = reordered[offset:offset + limit]

        # Update the response in place
        bm25_response["hits"]["hits"] = paginated
        bm25_response["hits"]["total"] = {"value": len(reordered), "relation": "eq"}

        return True

    def _fetch_documents(self, object_ids: list[str], organization_id: str) -> dict:
        """
        Fetch full documents for object IDs not in the BM25 result set.

        Returns dict mapping object_id -> hit dict (in OpenSearch hit format).
        """
        if not object_ids:
            return {}

        query = {
            "query": {
                "bool": {
                    "filter": [
                        {"terms": {"object_id": object_ids}},
                        {"term": {"organization_id": organization_id}},
                    ]
                }
            },
            "size": len(object_ids),
        }

        response = self.index_manager.search(query, organization_id)
        result = {}
        for hit in response.get("hits", {}).get("hits", []):
            oid = hit["_source"].get("object_id")
            if oid:
                result[oid] = hit
        return result

    def _parse_response(
        self,
        response: dict,
        request: CollectionsSearchRequest,
    ) -> CollectionsSearchResponse:
        """Parse OpenSearch response into our schema."""
        hits = []
        for hit in response.get("hits", {}).get("hits", []):
            source = hit.get("_source", {})
            highlights = hit.get("highlight", {})

            hits.append(CollectionsSearchHit(
                object_id=source.get("object_id"),
                object_number=source.get("object_number"),
                title=source.get("title"),
                object_name=source.get("object_name"),
                brief_description=source.get("brief_description"),
                object_type=source.get("object_type"),
                classification=source.get("classification"),
                object_status=source.get("object_status"),
                is_discoverable=source.get("is_discoverable"),
                creators=source.get("creators"),
                materials=source.get("materials"),
                creation_date=source.get("creation_date"),
                condition=source.get("condition"),
                current_location=source.get("current_location"),
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

        return CollectionsSearchResponse(
            hits=hits,
            total=total,
            facets=facets,
            took_ms=response.get("took", 0),
            next_offset=next_offset,
        )

    @staticmethod
    def _enrich_with_images(hits: list[CollectionsSearchHit], organization_id: UUID, session=None) -> None:
        """Populate primary_image_url on search hits from the database."""
        if not hits:
            return
        try:
            from app.fastapi_app.serializers.collections_helpers import _get_primary_images_bulk
            object_ids = [UUID(h.object_id) for h in hits if h.object_id]
            image_map = _get_primary_images_bulk(object_ids, organization_id, session=session)
            for hit in hits:
                if hit.object_id and hit.object_id in image_map:
                    hit.primary_image_url = image_map[hit.object_id]
        except Exception as e:
            logger.warning("Failed to enrich search hits with images: %s", e)

    def _parse_facets(self, aggregations: dict) -> list[Facet]:
        """Parse OpenSearch aggregations into facets."""
        facets = []

        # Simple term aggregations
        simple_aggs = [
            ("object_types", "object_type"),
            ("classifications", "classification"),
            ("object_status", "object_status"),
            ("style_periods", "style_period"),
            ("creation_places", "creation_place"),
            ("locations", "location"),
            ("on_display", "on_display"),
            ("condition_ratings", "condition"),
            ("acquisition_methods", "acquisition_method"),
        ]

        for agg_name, facet_field in simple_aggs:
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

        # Nested aggregations (creators, materials, techniques)
        nested_aggs = [
            ("creators", "names", "creator"),
            ("materials", "names", "material"),
            ("techniques", "names", "technique"),
            ("subjects", "terms", "subject"),
        ]

        for agg_name, sub_agg, facet_field in nested_aggs:
            if agg_name in aggregations:
                sub = aggregations[agg_name].get(sub_agg, {})
                buckets = [
                    FacetBucket(
                        key=b.get("key"),
                        doc_count=b.get("doc_count", 0),
                    )
                    for b in sub.get("buckets", [])
                ]
                if buckets:
                    facets.append(Facet(field=facet_field, buckets=buckets))

        # Date histogram
        if "creation_date_range" in aggregations:
            buckets = [
                FacetBucket(
                    key=b.get("key_as_string", str(b.get("key"))),
                    doc_count=b.get("doc_count", 0),
                )
                for b in aggregations["creation_date_range"].get("buckets", [])
            ]
            if buckets:
                facets.append(Facet(field="creation_date", buckets=buckets))

        return facets

    def autocomplete(
        self,
        query: str,
        field: str,
        organization_id: UUID,
        limit: int = 10,
    ) -> CollectionsAutocompleteResponse:
        """
        Get autocomplete suggestions.

        Args:
            query: Partial query string
            field: Field to autocomplete (title, object_number)
            organization_id: Organization to search within
            limit: Max suggestions

        Returns:
            Autocomplete suggestions
        """
        os_query = self.query_builder.build_autocomplete_query(
            query, field, str(organization_id), limit
        )

        response = self.index_manager.search(os_query, str(organization_id))

        suggestions = []
        for hit in response.get("hits", {}).get("hits", []):
            source = hit.get("_source", {})
            highlights = hit.get("highlight", {})

            value = source.get(field)
            if value:
                highlight = None
                if highlights and f"{field}.autocomplete" in highlights:
                    highlight = highlights[f"{field}.autocomplete"][0]

                suggestions.append(CollectionsAutocompleteSuggestion(
                    value=value,
                    object_id=source.get("object_id"),
                    object_number=source.get("object_number"),
                    highlight=highlight,
                ))

        return CollectionsAutocompleteResponse(suggestions=suggestions)

    def index_object(self, obj) -> None:
        """
        Index a single collection object.

        If semantic search is enabled, attempts to generate an embedding inline.
        If that fails, dispatches a Celery task to backfill it async.

        Args:
            obj: CollectionObject model instance
        """
        from .transformer import CollectionObjectTransformer
        from app.config import get_settings

        settings = get_settings()
        include_embedding = settings.semantic_search_enabled

        transformer = CollectionObjectTransformer()
        doc = transformer.transform(obj, include_embedding=include_embedding)
        self.index_manager.index_document(doc)

        # If embedding was requested but missing, dispatch async backfill
        if include_embedding and "semantic_embedding" not in doc:
            try:
                from app.tasks.semantic_search import generate_object_embedding
                generate_object_embedding.delay(
                    object_id=str(obj.object_id),
                    organization_id=str(obj.organization_id),
                )
            except Exception as e:
                logger.debug("Could not dispatch embedding backfill: %s", e)

    def delete_object(self, object_id: UUID, organization_id: UUID) -> None:
        """
        Delete a collection object from the index.

        Args:
            object_id: Object to delete
            organization_id: Organization the object belongs to
        """
        self.index_manager.delete_document(str(object_id), str(organization_id))

    def reindex_organization(self, session, organization_id: UUID) -> dict:
        """
        Reindex all collection objects for an organization.

        Args:
            session: SQLAlchemy session
            organization_id: Organization to reindex

        Returns:
            Stats about the reindex operation
        """
        return self.index_manager.reindex_all(session, str(organization_id))


# Singleton instance
_service: Optional[CollectionsSearchService] = None


def get_collections_search_service() -> CollectionsSearchService:
    """Get the Collections search service singleton."""
    global _service
    if _service is None:
        _service = CollectionsSearchService()
    return _service
