"""
Media Search Query Builder.

Builds OpenSearch queries for media search operations.
"""

from typing import Any

from .schemas import MediaSearchRequest


class MediaQueryBuilder:
    """Builds OpenSearch queries for media search."""

    # Field boost weights for relevance scoring
    FIELD_BOOSTS = {
        "title": 5.0,
        "filename": 3.0,
        "description": 2.0,
        "alt_text": 2.0,
        "creator": 1.5,
        "credit": 1.0,
        # Linked collection object fields
        "linked_object_numbers": 4.0,
        "linked_object_titles": 3.0,
        "linked_object_creators": 2.0,
        "linked_object_types": 2.0,
        "linked_object_media": 1.5,
        # Inherited metadata fields
        "inherited_subjects": 2.0,
        "inherited_materials": 1.5,
        "inherited_techniques": 1.5,
        "inherited_depicted_places": 1.5,
        # AI-detected tags
        "ai_tags": 1.5,
        # Transcript and OCR text
        "transcript": 1.0,
        "ocr_text": 1.0,
        "extracted_text": 1.0,
    }

    def build(
        self,
        request: MediaSearchRequest,
        organization_id: str,
    ) -> dict[str, Any]:
        """
        Build an OpenSearch query from a search request.

        Args:
            request: Search request parameters
            organization_id: Organization ID to filter by

        Returns:
            OpenSearch query dictionary
        """
        # Start with organization filter (required)
        must = [{"term": {"organization_id": organization_id}}]
        should = []
        filter_clauses = []

        # Add text search if query provided
        if request.query:
            should.extend(self._build_text_query(request.query))

        # Add filters
        if request.media_type:
            filter_clauses.append({"term": {"media_type": request.media_type}})

        if request.folder:
            filter_clauses.append({"term": {"folder": request.folder}})

        if request.copyright_status:
            filter_clauses.append({"term": {"copyright_status": request.copyright_status}})

        if request.creator:
            filter_clauses.append({"match": {"creator": request.creator}})

        if request.license_type:
            filter_clauses.append({"term": {"license": request.license_type}})

        if request.is_published is not None:
            filter_clauses.append({"term": {"is_published": request.is_published}})

        if request.processing_status:
            filter_clauses.append({"term": {"processing_status": request.processing_status}})

        if request.ai_processing_status:
            filter_clauses.append({"term": {"ai_processing_status": request.ai_processing_status}})

        # Date range filter
        if request.date_from or request.date_to:
            date_range = {}
            if request.date_from:
                date_range["gte"] = request.date_from
            if request.date_to:
                date_range["lte"] = request.date_to
            filter_clauses.append({"range": {"created_at": date_range}})

        # Metadata presence filters
        if request.has_exif:
            filter_clauses.append({"exists": {"field": "technical_metadata.camera_make"}})

        if request.has_iptc:
            filter_clauses.append({"exists": {"field": "iptc_metadata.headline"}})

        # Color filter — color_key is a single char (e.g. "g" for green)
        # and the indexed value is a 5-char string of the top-5 dominant
        # color buckets (e.g. "gpggb"). Wildcard matches any image where
        # the selected color is one of the top 5.
        if hasattr(request, 'color_key') and request.color_key:
            filter_clauses.append({"wildcard": {"color_key": f"*{request.color_key}*"}})

        # Structured tag filters (nested queries)
        if request.tag_filters:
            for tag_filter in request.tag_filters:
                filter_clauses.append({
                    "nested": {
                        "path": "structured_tags",
                        "query": {
                            "bool": {
                                "must": [
                                    {"term": {"structured_tags.key": tag_filter.key}},
                                    {"term": {"structured_tags.value": tag_filter.value}}
                                ]
                            }
                        }
                    }
                })

        # Build the final query
        query = {
            "bool": {
                "must": must,
                "filter": filter_clauses if filter_clauses else [],
            }
        }

        # Add should clauses for text search
        if should:
            query["bool"]["should"] = should
            query["bool"]["minimum_should_match"] = 1

        # Build the full search body
        body = {
            "query": query,
            "from": request.offset,
            "size": request.limit,
        }

        # Add sorting
        body["sort"] = self._build_sort(request)

        # Add highlighting
        if request.highlight:
            body["highlight"] = self._build_highlight()

        # Add aggregations for facets
        if request.include_facets:
            body["aggs"] = self._build_aggregations()

        return body

    def _build_text_query(self, query: str) -> list[dict]:
        """Build text search clauses with field boosting."""
        should = []

        # Multi-match across boosted fields
        fields = [f"{field}^{boost}" for field, boost in self.FIELD_BOOSTS.items()]
        should.append({
            "multi_match": {
                "query": query,
                "fields": fields,
                "type": "best_fields",
                "fuzziness": "AUTO",
            }
        })

        # Phrase match for exact phrases
        should.append({
            "multi_match": {
                "query": query,
                "fields": ["title", "description"],
                "type": "phrase",
                "boost": 2.0,
            }
        })

        return should

    def _build_sort(self, request: MediaSearchRequest) -> list[dict]:
        """Build sort clauses."""
        sort = []

        if request.sort_by == "relevance" and request.query:
            sort.append({"_score": {"order": request.sort_order}})
        elif request.sort_by == "created_at":
            sort.append({"created_at": {"order": request.sort_order}})
        elif request.sort_by == "title":
            sort.append({"title.keyword": {"order": request.sort_order}})
        elif request.sort_by == "file_size":
            sort.append({"file_size": {"order": request.sort_order}})

        # Always add a secondary sort by media_id for consistent pagination
        sort.append({"media_id": {"order": "asc"}})

        return sort

    def _build_highlight(self) -> dict:
        """Build highlight configuration."""
        return {
            "fields": {
                "title": {"number_of_fragments": 0},
                "description": {"number_of_fragments": 2},
                "filename": {"number_of_fragments": 0},
            },
            "pre_tags": ["<em>"],
            "post_tags": ["</em>"],
        }

    def _build_aggregations(self) -> dict:
        """Build aggregations for faceted search."""
        return {
            "media_types": {
                "terms": {
                    "field": "media_type",
                    "size": 10,
                }
            },
            "folders": {
                "terms": {
                    "field": "folder",
                    "size": 50,
                }
            },
            "copyright_statuses": {
                "terms": {
                    "field": "copyright_status",
                    "size": 20,
                }
            },
            "licenses": {
                "terms": {
                    "field": "license",
                    "size": 20,
                }
            },
            "processing_statuses": {
                "terms": {
                    "field": "processing_status",
                    "size": 10,
                }
            },
            "creators": {
                "terms": {
                    "field": "creator.keyword",
                    "size": 50,
                }
            },
            "camera_makes": {
                "terms": {
                    "field": "technical_metadata.camera_make",
                    "size": 20,
                }
            },
            "structured_tags": {
                "nested": {
                    "path": "structured_tags"
                },
                "aggs": {
                    "tag_keys": {
                        "terms": {
                            "field": "structured_tags.key",
                            "size": 50,
                        },
                        "aggs": {
                            "tag_values": {
                                "terms": {
                                    "field": "structured_tags.value",
                                    "size": 50,
                                }
                            }
                        }
                    }
                }
            },
        }
