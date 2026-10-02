"""
Build OpenSearch queries for Collections search.

Supports procedure-aware searching with field-specific operators
and GLAM sector faceting conventions.

Vocabulary term expansion:
When expand_vocabulary_terms is True and vocabulary term filters are used,
the query builder will expand the term IDs to include narrower (more specific)
terms. For example, filtering by "paint" will also match "oil paint",
"acrylic paint", "watercolor", etc.
"""

import logging
from typing import Any, Optional
from uuid import UUID

from .schemas import (
    CollectionsSearchRequest,
    CollectionsSearchQuery,
    CollectionsSearchFilters,
    CollectionsAdvancedCriterion,
    SearchSort,
)

logger = logging.getLogger(__name__)


class CollectionsQueryBuilder:
    """Builds OpenSearch queries for Collections search."""

    # Default fields for simple search, with boosting
    DEFAULT_SEARCH_FIELDS = [
        "title^3",
        "object_number^3",
        "object_name^2",
        "brief_description",
        "full_description",
        "creators.name^2",
        "materials.name",
        "techniques.name",
        "subjects.term",
        "inscriptions",
        "provenance",
        "creation_place",
    ]

    def build(self, request: CollectionsSearchRequest, organization_id: str, db_session=None) -> dict:
        """Build complete OpenSearch query.

        Args:
            request: The search request with filters and options
            organization_id: Organization UUID string
            db_session: Optional SQLAlchemy session for vocabulary expansion
        """
        query = {
            "query": self._build_query(
                request.query,
                request.filters,
                organization_id,
                request.advanced_criteria,
                request.advanced_operator,
                expand_vocabulary=request.expand_vocabulary_terms,
                expansion_depth=request.vocabulary_expansion_depth,
                db_session=db_session,
            ),
            "from": request.offset,
            "size": request.limit,
        }

        if request.sort:
            query["sort"] = self._build_sort(request.sort)

        if request.include_facets:
            query["aggs"] = self._build_aggregations(request.facet_size)

        has_text_search = (request.query and request.query.q) or request.advanced_criteria
        if request.highlight and has_text_search:
            query["highlight"] = self._build_highlight()

        return query

    def _build_query(
        self,
        search_query: Optional[CollectionsSearchQuery],
        filters: Optional[CollectionsSearchFilters],
        organization_id: str,
        advanced_criteria: Optional[list[CollectionsAdvancedCriterion]] = None,
        advanced_operator: str = "and",
        expand_vocabulary: bool = False,
        expansion_depth: int = 2,
        db_session=None,
    ) -> dict:
        """Build the query clause with filters."""
        must = []
        must_not = []
        should = []
        filter_clauses = [
            {"term": {"organization_id": organization_id}}
        ]

        # Simple full-text search
        if search_query and search_query.q:
            fields = search_query.fields or self.DEFAULT_SEARCH_FIELDS
            must.append({
                "multi_match": {
                    "query": search_query.q,
                    "fields": fields,
                    "type": "best_fields",
                    "operator": "or",
                    "minimum_should_match": "2<75%",
                }
            })

        # Advanced search criteria
        if advanced_criteria:
            criteria_clauses = []
            for criterion in advanced_criteria:
                clause = self._build_criterion_clause(criterion)
                if clause:
                    if criterion.operator == "not_contains":
                        must_not.append(clause)
                    else:
                        criteria_clauses.append(clause)

            if criteria_clauses:
                if advanced_operator == "or":
                    should.extend(criteria_clauses)
                else:
                    must.extend(criteria_clauses)

        # Apply filters
        if filters:
            filter_clauses.extend(self._build_filters(
                filters,
                expand_vocabulary=expand_vocabulary,
                expansion_depth=expansion_depth,
                db_session=db_session,
            ))

        # Build bool query
        bool_query = {"filter": filter_clauses}

        if must:
            bool_query["must"] = must
        elif not should:
            bool_query["must"] = [{"match_all": {}}]

        if must_not:
            bool_query["must_not"] = must_not

        if should:
            bool_query["should"] = should
            if not must:
                bool_query["minimum_should_match"] = 1

        return {"bool": bool_query}

    def _build_criterion_clause(
        self, criterion: CollectionsAdvancedCriterion
    ) -> Optional[dict]:
        """Build a query clause for a single advanced criterion."""
        field = criterion.field
        operator = criterion.operator
        value = criterion.value

        if not value:
            return None

        # Field mapping for Collections procedure fields
        field_mapping = {
            "title": "title",
            "object_number": "object_number",
            "object_name": "object_name",
            "description": "full_description",
            "creator": "creators.name",
            "material": "materials.name",
            "technique": "techniques.name",
            "subject": "subjects.term",
            "place": "creation_place",
            "inscription": "inscriptions",
            "provenance": "provenance",
            "credit_line": "credit_line",
            "classification": "classifications.term",
            "any": None,
        }

        os_field = field_mapping.get(field)

        # Handle "any" field
        if field == "any":
            if operator == "equals":
                return {
                    "multi_match": {
                        "query": value,
                        "fields": self.DEFAULT_SEARCH_FIELDS,
                        "type": "phrase",
                    }
                }
            elif operator == "starts_with":
                return {
                    "multi_match": {
                        "query": value,
                        "fields": self.DEFAULT_SEARCH_FIELDS,
                        "type": "phrase_prefix",
                    }
                }
            else:
                return {
                    "multi_match": {
                        "query": value,
                        "fields": self.DEFAULT_SEARCH_FIELDS,
                        "type": "best_fields",
                    }
                }

        # Handle nested fields
        if field == "creator":
            return {
                "nested": {
                    "path": "creators",
                    "query": self._build_field_query("creators.name", operator, value),
                }
            }
        elif field == "material":
            return {
                "nested": {
                    "path": "materials",
                    "query": self._build_field_query("materials.name", operator, value),
                }
            }
        elif field == "technique":
            return {
                "nested": {
                    "path": "techniques",
                    "query": self._build_field_query("techniques.name", operator, value),
                }
            }
        elif field == "subject":
            return {
                "nested": {
                    "path": "subjects",
                    "query": self._build_field_query("subjects.term", operator, value),
                }
            }
        elif field == "classification":
            return {
                "nested": {
                    "path": "classifications",
                    "query": self._build_field_query("classifications.term", operator, value),
                }
            }

        # Regular fields
        return self._build_field_query(os_field, operator, value)

    def _build_field_query(self, field: str, operator: str, value: str) -> dict:
        """Build a query for a specific field with operator."""
        if operator == "equals":
            return {"match_phrase": {field: value}}
        elif operator == "starts_with":
            return {"prefix": {field: value.lower()}}
        else:  # contains or not_contains
            return {"match": {field: value}}

    def _build_filters(
        self,
        filters: CollectionsSearchFilters,
        expand_vocabulary: bool = False,
        expansion_depth: int = 2,
        db_session=None,
    ) -> list[dict]:
        """Build filter clauses from procedure-aware filters.

        Args:
            filters: Search filters
            expand_vocabulary: Whether to expand vocabulary term filters
            expansion_depth: How deep to traverse for vocabulary expansion
            db_session: SQLAlchemy session for vocabulary expansion queries
        """
        clauses = []

        if filters.object_type:
            clauses.append({"terms": {"object_type": filters.object_type}})

        if filters.classification:
            # Filter by classification terms within the classifications array
            clauses.append({"nested": {
                "path": "classifications",
                "query": {"terms": {"classifications.term": filters.classification}}
            }})

        if filters.object_status:
            clauses.append({"terms": {"object_status": filters.object_status}})

        if filters.location_id:
            clauses.append({"terms": {"current_location.location_id": filters.location_id}})

        if filters.on_display is not None:
            clauses.append({"term": {"current_location.on_display": filters.on_display}})

        if filters.creator_name:
            clauses.append({
                "nested": {
                    "path": "creators",
                    "query": {"match": {"creators.name": filters.creator_name}},
                }
            })

        if filters.material:
            clauses.append({
                "nested": {
                    "path": "materials",
                    "query": {"match": {"materials.name": filters.material}},
                }
            })

        if filters.technique:
            clauses.append({
                "nested": {
                    "path": "techniques",
                    "query": {"match": {"techniques.name": filters.technique}},
                }
            })

        if filters.date_from or filters.date_to:
            date_range = {}
            if filters.date_from:
                date_range["gte"] = filters.date_from
            if filters.date_to:
                date_range["lte"] = filters.date_to
            clauses.append({"range": {"creation_date.earliest": date_range}})

        if filters.acquisition_method:
            clauses.append({"term": {"acquisition_method": filters.acquisition_method}})

        if filters.condition_rating:
            clauses.append({"terms": {"condition.rating": filters.condition_rating}})

        if filters.is_discoverable is not None:
            clauses.append({"term": {"is_discoverable": filters.is_discoverable}})

        if filters.subject:
            clauses.append({
                "nested": {
                    "path": "subjects",
                    "query": {"match": {"subjects.term": filters.subject}},
                }
            })

        if filters.style_period:
            clauses.append({"terms": {"style_period": filters.style_period}})

        if filters.creation_place:
            clauses.append({"match": {"creation_place": filters.creation_place}})

        if filters.has_image is not None:
            clauses.append({"term": {"has_primary_image": filters.has_image}})

        # Vocabulary term filters with expansion support
        if filters.material_term_ids:
            term_ids = self._expand_vocabulary_terms(
                filters.material_term_ids,
                expand_vocabulary,
                expansion_depth,
                db_session,
            )
            clauses.append({
                "nested": {
                    "path": "materials",
                    "query": {"terms": {"materials.vocabulary_term_id": term_ids}},
                }
            })

        if filters.technique_term_ids:
            term_ids = self._expand_vocabulary_terms(
                filters.technique_term_ids,
                expand_vocabulary,
                expansion_depth,
                db_session,
            )
            clauses.append({
                "nested": {
                    "path": "techniques",
                    "query": {"terms": {"techniques.vocabulary_term_id": term_ids}},
                }
            })

        if filters.classification_term_ids:
            term_ids = self._expand_vocabulary_terms(
                filters.classification_term_ids,
                expand_vocabulary,
                expansion_depth,
                db_session,
            )
            clauses.append({
                "nested": {
                    "path": "classifications",
                    "query": {"terms": {"classifications.vocabulary_term_id": term_ids}},
                }
            })

        return clauses

    def _expand_vocabulary_terms(
        self,
        term_ids: list[str],
        expand: bool,
        depth: int,
        db_session,
    ) -> list[str]:
        """Expand vocabulary term IDs to include narrower terms.

        Args:
            term_ids: List of term UUID strings
            expand: Whether to perform expansion
            depth: How deep to traverse
            db_session: SQLAlchemy session

        Returns:
            List of term ID strings (expanded if enabled)
        """
        if not expand or not db_session:
            return term_ids

        try:
            from app.services.vocabulary_hierarchy_service import VocabularyHierarchyService

            service = VocabularyHierarchyService(db_session)
            uuids = [UUID(tid) for tid in term_ids]
            expanded = service.expand_search_terms(
                uuids,
                include_narrower=True,
                max_depth=depth,
            )

            expanded_ids = [str(tid) for tid in expanded]
            if len(expanded_ids) > len(term_ids):
                logger.debug(
                    f"Expanded {len(term_ids)} vocabulary terms to {len(expanded_ids)} "
                    f"(depth={depth})"
                )
            return expanded_ids

        except Exception as e:
            logger.warning(f"Failed to expand vocabulary terms: {e}")
            return term_ids

    def _build_sort(self, sort: SearchSort) -> list[dict]:
        """Build sort clause."""
        if sort.field == "_score":
            return [{"_score": {"order": sort.order}}]

        # Handle nested sort for creation_date
        if sort.field == "creation_date":
            return [{"creation_date.earliest": {"order": sort.order}}]

        return [{sort.field: {"order": sort.order}}]

    def _build_aggregations(self, size: int) -> dict:
        """Build procedure-aware facet aggregations."""
        return {
            "object_types": {
                "terms": {"field": "object_type", "size": size}
            },
            "classifications": {
                "terms": {"field": "classification", "size": size}
            },
            "object_status": {
                "terms": {"field": "object_status", "size": size}
            },
            "creators": {
                "nested": {"path": "creators"},
                "aggs": {
                    "names": {
                        "terms": {"field": "creators.name.keyword", "size": size}
                    }
                }
            },
            "materials": {
                "nested": {"path": "materials"},
                "aggs": {
                    "names": {
                        "terms": {"field": "materials.name.keyword", "size": size}
                    }
                }
            },
            "techniques": {
                "nested": {"path": "techniques"},
                "aggs": {
                    "names": {
                        "terms": {"field": "techniques.name.keyword", "size": size}
                    }
                }
            },
            "subjects": {
                "nested": {"path": "subjects"},
                "aggs": {
                    "terms": {
                        "terms": {"field": "subjects.term.keyword", "size": size}
                    }
                }
            },
            "style_periods": {
                "terms": {"field": "style_period", "size": size}
            },
            "creation_places": {
                "terms": {"field": "creation_place.keyword", "size": size}
            },
            "creation_date_range": {
                "date_histogram": {
                    "field": "creation_date.earliest",
                    "calendar_interval": "year",
                    "min_doc_count": 1,
                }
            },
            "locations": {
                "terms": {"field": "current_location.name", "size": size}
            },
            "on_display": {
                "terms": {"field": "current_location.on_display", "size": 2}
            },
            "condition_ratings": {
                "terms": {"field": "condition.rating", "size": size}
            },
            "acquisition_methods": {
                "terms": {"field": "acquisition_method", "size": size}
            },
        }

    def _build_highlight(self) -> dict:
        """Build highlight configuration."""
        return {
            "pre_tags": ["<mark>"],
            "post_tags": ["</mark>"],
            "fields": {
                "title": {"number_of_fragments": 0},
                "object_name": {"number_of_fragments": 0},
                "brief_description": {"number_of_fragments": 3, "fragment_size": 150},
                "full_description": {"number_of_fragments": 3, "fragment_size": 150},
                "object_number": {"number_of_fragments": 0},
                "inscriptions": {"number_of_fragments": 2, "fragment_size": 100},
                "provenance": {"number_of_fragments": 2, "fragment_size": 150},
            }
        }

    def build_knn_query(
        self,
        embedding: list[float],
        organization_id: str,
        filters: Optional[CollectionsSearchFilters] = None,
        k: int = 20,
    ) -> dict:
        """
        Build a KNN (vector similarity) query with post-filtering.

        Uses a bool wrapper with the KNN in must and org filter in filter.
        Routing on organization_id already constrains to the correct shard.

        Args:
            embedding: Query embedding vector
            organization_id: Organization scope
            filters: Optional structured filters
            k: Number of nearest neighbors
        """
        filter_clauses = [{"term": {"organization_id": organization_id}}]
        if filters:
            filter_clauses.extend(self._build_filters(filters))

        return {
            "size": k,
            "min_score": 0.72,
            "query": {
                "bool": {
                    "must": [
                        {
                            "knn": {
                                "semantic_embedding": {
                                    "vector": embedding,
                                    "k": k,
                                }
                            }
                        }
                    ],
                    "filter": filter_clauses,
                }
            },
            "_source": ["object_id", "organization_id"],
        }

    @staticmethod
    def rrf_merge(
        bm25_hits: list[dict],
        knn_hits: list[dict],
        bm25_weight: float = 0.7,
        knn_weight: float = 0.3,
        k: int = 60,
    ) -> list[str]:
        """
        Reciprocal Rank Fusion merge of BM25 and KNN result lists.

        Args:
            bm25_hits: BM25 search hits (dicts with 'object_id')
            knn_hits: KNN search hits (dicts with 'object_id')
            bm25_weight: Weight for BM25 ranking
            knn_weight: Weight for KNN ranking
            k: RRF constant (default 60)

        Returns:
            Ordered list of object_id strings
        """
        rrf_scores: dict[str, float] = {}

        for rank, hit in enumerate(bm25_hits):
            oid = hit.get("object_id", "")
            rrf_scores[oid] = rrf_scores.get(oid, 0) + bm25_weight / (k + rank + 1)

        for rank, hit in enumerate(knn_hits):
            oid = hit.get("object_id", "")
            rrf_scores[oid] = rrf_scores.get(oid, 0) + knn_weight / (k + rank + 1)

        # Sort by descending RRF score
        sorted_ids = sorted(rrf_scores.keys(), key=lambda oid: rrf_scores[oid], reverse=True)
        return sorted_ids

    def build_autocomplete_query(
        self,
        query: str,
        field: str,
        organization_id: str,
        limit: int = 10,
    ) -> dict:
        """Build autocomplete query for Collections."""
        return {
            "query": {
                "bool": {
                    "must": [
                        {
                            "match": {
                                f"{field}.autocomplete": {
                                    "query": query,
                                    "operator": "and",
                                }
                            }
                        }
                    ],
                    "filter": [{"term": {"organization_id": organization_id}}],
                }
            },
            "size": limit,
            "_source": [field, "object_id", "object_number"],
            "highlight": {"fields": {f"{field}.autocomplete": {}}},
        }
