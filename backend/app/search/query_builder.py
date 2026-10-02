"""
Build OpenSearch queries from search requests.

Translates API search requests into OpenSearch query DSL.
"""

from typing import Any, Optional
from app.search.schemas import SearchRequest, SearchQuery, SearchFilters, SearchSort, AdvancedCriterion


class SearchQueryBuilder:
    """Builds OpenSearch queries from API requests."""

    DEFAULT_SEARCH_FIELDS = [
        "title^3",
        "object_number^2",
        "description",
        "creators.name^2",
        "classifications.label",
        "dynamic_fields",
    ]

    def build(self, request: SearchRequest, organization_id: str) -> dict:
        """Build complete OpenSearch query."""
        query = {
            "query": self._build_query(
                request.query,
                request.filters,
                organization_id,
                request.advanced_criteria,
                request.advanced_operator
            ),
            "from": request.offset,
            "size": request.limit,
        }

        # Add sorting
        if request.sort:
            query["sort"] = self._build_sort(request.sort)

        # Add facets/aggregations
        if request.include_facets:
            query["aggs"] = self._build_aggregations(request.facet_size)

        # Add highlighting - also highlight for advanced search
        has_text_search = (request.query and request.query.q) or request.advanced_criteria
        if request.highlight and has_text_search:
            query["highlight"] = self._build_highlight()

        # Add explanation
        if request.explain:
            query["explain"] = True

        return query

    def _build_query(
        self,
        search_query: Optional[SearchQuery],
        filters: Optional[SearchFilters],
        organization_id: str,
        advanced_criteria: Optional[list[AdvancedCriterion]] = None,
        advanced_operator: str = "and"
    ) -> dict:
        """Build the query clause with filters."""
        must = []
        must_not = []
        should = []
        filter_clauses = [
            {"term": {"organization_id": organization_id}}
        ]

        # Full-text search (simple search box)
        # Uses exact matching with stemming (no fuzzy guessing)
        # The glam_text_analyzer handles stemming so "dog" matches "dogs"
        if search_query and search_query.q:
            fields = search_query.fields or self.DEFAULT_SEARCH_FIELDS
            must.append({
                "multi_match": {
                    "query": search_query.q,
                    "fields": fields,
                    "type": "best_fields",
                    "operator": "or",
                    "minimum_should_match": "2<75%"
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

            # Combine criteria based on operator (AND/OR)
            if criteria_clauses:
                if advanced_operator == "or":
                    should.extend(criteria_clauses)
                else:
                    must.extend(criteria_clauses)

        # Apply filters
        if filters:
            filter_clauses.extend(self._build_filters(filters))

        # Build the bool query
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

    def _build_criterion_clause(self, criterion: AdvancedCriterion) -> Optional[dict]:
        """Build a query clause for a single advanced criterion."""
        field = criterion.field
        operator = criterion.operator
        value = criterion.value

        if not value:
            return None

        # Map field names to OpenSearch fields
        field_mapping = {
            "title": "title",
            "object_number": "object_number",
            "description": "description",
            "creator": "creators.name",
            "classification": "classifications.label",
            "any": None,  # Will use multi_match
        }

        os_field = field_mapping.get(field)

        # Handle "any" field - search across all fields
        if field == "any":
            if operator == "equals":
                return {
                    "multi_match": {
                        "query": value,
                        "fields": self.DEFAULT_SEARCH_FIELDS,
                        "type": "phrase"
                    }
                }
            elif operator == "starts_with":
                return {
                    "multi_match": {
                        "query": value,
                        "fields": self.DEFAULT_SEARCH_FIELDS,
                        "type": "phrase_prefix"
                    }
                }
            else:  # contains or not_contains
                return {
                    "multi_match": {
                        "query": value,
                        "fields": self.DEFAULT_SEARCH_FIELDS,
                        "type": "best_fields"
                    }
                }

        # Handle nested fields (creators, classifications)
        if field == "creator":
            inner_query = self._build_field_query("creators.name", operator, value)
            return {
                "nested": {
                    "path": "creators",
                    "query": inner_query
                }
            }
        elif field == "classification":
            inner_query = self._build_field_query("classifications.label", operator, value)
            return {
                "nested": {
                    "path": "classifications",
                    "query": inner_query
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

    def _build_filters(self, filters: SearchFilters) -> list[dict]:
        """Build filter clauses."""
        clauses = []

        if filters.dataset_id:
            clauses.append({"terms": {"dataset_id": filters.dataset_id}})

        if filters.entity_type:
            clauses.append({"terms": {"entity_type": filters.entity_type}})

        if filters.creator_name:
            clauses.append({
                "nested": {
                    "path": "creators",
                    "query": {
                        "match": {"creators.name": filters.creator_name}
                    }
                }
            })

        if filters.date_from or filters.date_to:
            date_range = {}
            if filters.date_from:
                date_range["gte"] = filters.date_from
            if filters.date_to:
                date_range["lte"] = filters.date_to
            clauses.append({
                "range": {"dates.created_earliest": date_range}
            })

        if filters.on_display is not None:
            clauses.append({"term": {"location.on_display": filters.on_display}})

        if filters.classification_scheme and filters.classification_term:
            clauses.append({
                "nested": {
                    "path": "classifications",
                    "query": {
                        "bool": {
                            "must": [
                                {"term": {"classifications.scheme": filters.classification_scheme}},
                                {"term": {"classifications.term_id": filters.classification_term}}
                            ]
                        }
                    }
                }
            })

        return clauses

    def _build_sort(self, sort: SearchSort) -> list[dict]:
        """Build sort clause."""
        if sort.field == "_score":
            return [{"_score": {"order": sort.order}}]

        return [{sort.field: {"order": sort.order}}]

    def _build_aggregations(self, size: int) -> dict:
        """Build facet aggregations."""
        return {
            "entity_types": {
                "terms": {"field": "entity_type", "size": size}
            },
            "datasets": {
                "terms": {"field": "dataset_id", "size": size}
            },
            "creators": {
                "nested": {"path": "creators"},
                "aggs": {
                    "names": {
                        "terms": {"field": "creators.name.keyword", "size": size}
                    }
                }
            },
            "classifications": {
                "nested": {"path": "classifications"},
                "aggs": {
                    "schemes": {
                        "terms": {"field": "classifications.scheme", "size": 10},
                        "aggs": {
                            "terms": {
                                "terms": {"field": "classifications.label.keyword", "size": size}
                            }
                        }
                    }
                }
            },
            "date_range": {
                "date_histogram": {
                    "field": "dates.created_earliest",
                    "interval": "year",
                    "min_doc_count": 1
                }
            },
            "on_display": {
                "terms": {"field": "location.on_display", "size": 2}
            }
        }

    def _build_highlight(self) -> dict:
        """Build highlight configuration."""
        return {
            "pre_tags": ["<mark>"],
            "post_tags": ["</mark>"],
            "fields": {
                "title": {"number_of_fragments": 0},
                "description": {"number_of_fragments": 3, "fragment_size": 150},
                "object_number": {"number_of_fragments": 0},
                "creators.name": {"number_of_fragments": 0},
            }
        }

    def build_autocomplete_query(
        self,
        query: str,
        field: str,
        organization_id: str,
        limit: int = 10
    ) -> dict:
        """Build autocomplete query."""
        return {
            "query": {
                "bool": {
                    "must": [
                        {"match": {f"{field}.autocomplete": {"query": query, "operator": "and"}}}
                    ],
                    "filter": [
                        {"term": {"organization_id": organization_id}}
                    ]
                }
            },
            "size": limit,
            "_source": [field, "entity_key"],
            "highlight": {
                "fields": {f"{field}.autocomplete": {}}
            }
        }

    def build_similar_query(
        self,
        entity_key: str,
        organization_id: str,
        limit: int = 10
    ) -> dict:
        """Build more-like-this query for similar entities."""
        return {
            "query": {
                "bool": {
                    "must": [
                        {
                            "more_like_this": {
                                "fields": ["title", "description", "classifications.label"],
                                "like": [{"_index": "madrona-entities-read", "_id": entity_key}],
                                "min_term_freq": 1,
                                "min_doc_freq": 1,
                                "max_query_terms": 25,
                            }
                        }
                    ],
                    "filter": [
                        {"term": {"organization_id": organization_id}}
                    ],
                    "must_not": [
                        {"term": {"entity_key": entity_key}}
                    ]
                }
            },
            "size": limit,
        }
