"""
Vocabulary Hierarchy Service for Getty Vocabulary Management.

Provides hierarchical relationship support for Getty vocabularies (AAT, ULAN, TGN):
- Fetches full term hierarchy from Getty SPARQL endpoint
- Stores broader/narrower/related relationships
- Enables search expansion using narrower terms
- Caches hierarchy data in PostgreSQL and Redis

Usage:
    from app.services.vocabulary_hierarchy_service import VocabularyHierarchyService

    service = VocabularyHierarchyService(db.session)
    await service.fetch_term_with_hierarchy("300015050", "aat")
    broader_terms = service.get_broader_terms(term_id)
    expanded = service.expand_search_terms([term_id1, term_id2])
"""

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.models import VocabularyTerm, VocabularyTermRelationship
from app.services.redis_client import get_redis_client
from app.services.getty_service import (
    GETTY_SPARQL_ENDPOINT,
    GETTY_TIMEOUT,
    _execute_sparql,
)

logger = logging.getLogger(__name__)

# =============================================================================
# CONFIGURATION
# =============================================================================

# Uses GETTY_SPARQL_ENDPOINT and GETTY_TIMEOUT from getty_service
HIERARCHY_CACHE_TTL = 3600  # 1 hour Redis cache TTL
HIERARCHY_STALE_DAYS = 30  # Re-fetch hierarchy if older than 30 days
MAX_NARROWER_DEPTH = 3  # Max depth when fetching narrower terms
MAX_NARROWER_COUNT = 50  # Max narrower terms to fetch per term


def _serialize_traversal_term(
    term: VocabularyTerm, depth: int | None = None
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "term_id": str(term.term_id),
        "vocabulary": term.vocabulary,
        "external_id": term.external_id,
        "preferred_term": term.preferred_term,
    }
    if depth is not None:
        payload["depth"] = depth
    return payload


# =============================================================================
# SPARQL QUERIES
# =============================================================================

# Fetch full term with immediate hierarchy
TERM_WITH_HIERARCHY_QUERY = """
PREFIX gvp: <http://vocab.getty.edu/ontology#>
PREFIX xl: <http://www.w3.org/2008/05/skos-xl#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX dct: <http://purl.org/dc/terms/>

SELECT DISTINCT ?prefLabel ?scopeNote ?altLabel ?broader ?broaderLabel ?broaderId
                ?narrower ?narrowerLabel ?narrowerId ?related ?relatedLabel ?relatedId
                ?facet ?facetLabel ?modified
WHERE {{
    <http://vocab.getty.edu/{vocabulary}/{external_id}> xl:prefLabel/xl:literalForm ?prefLabel .
    FILTER(LANG(?prefLabel) = "en" || LANG(?prefLabel) = "")

    # Scope note (definition)
    OPTIONAL {{
        <http://vocab.getty.edu/{vocabulary}/{external_id}> skos:scopeNote/rdf:value ?scopeNote .
        FILTER(LANG(?scopeNote) = "en" || LANG(?scopeNote) = "")
    }}

    # Alternate labels
    OPTIONAL {{
        <http://vocab.getty.edu/{vocabulary}/{external_id}> xl:altLabel/xl:literalForm ?altLabel .
        FILTER(LANG(?altLabel) = "en" || LANG(?altLabel) = "")
    }}

    # Broader terms (immediate parents)
    OPTIONAL {{
        <http://vocab.getty.edu/{vocabulary}/{external_id}> gvp:broaderPreferred ?broader .
        ?broader xl:prefLabel/xl:literalForm ?broaderLabel .
        BIND(REPLACE(STR(?broader), "http://vocab.getty.edu/{vocabulary}/", "") AS ?broaderId)
        FILTER(LANG(?broaderLabel) = "en" || LANG(?broaderLabel) = "")
    }}

    # Narrower terms (immediate children) - limited
    OPTIONAL {{
        ?narrower gvp:broaderPreferred <http://vocab.getty.edu/{vocabulary}/{external_id}> .
        ?narrower xl:prefLabel/xl:literalForm ?narrowerLabel .
        BIND(REPLACE(STR(?narrower), "http://vocab.getty.edu/{vocabulary}/", "") AS ?narrowerId)
        FILTER(LANG(?narrowerLabel) = "en" || LANG(?narrowerLabel) = "")
    }}

    # Related terms
    OPTIONAL {{
        <http://vocab.getty.edu/{vocabulary}/{external_id}> skos:related ?related .
        ?related xl:prefLabel/xl:literalForm ?relatedLabel .
        BIND(REPLACE(STR(?related), "http://vocab.getty.edu/{vocabulary}/", "") AS ?relatedId)
        FILTER(LANG(?relatedLabel) = "en" || LANG(?relatedLabel) = "")
    }}

    # AAT Facet (top-level category) - only for AAT
    OPTIONAL {{
        <http://vocab.getty.edu/{vocabulary}/{external_id}> gvp:broaderPreferred+ ?facet .
        ?facet rdf:type gvp:Facet ;
               xl:prefLabel/xl:literalForm ?facetLabel .
        FILTER(LANG(?facetLabel) = "en" || LANG(?facetLabel) = "")
    }}

    # Modified date
    OPTIONAL {{
        <http://vocab.getty.edu/{vocabulary}/{external_id}> dct:modified ?modified .
    }}
}}
LIMIT 500
"""

# Get all ancestors (for hierarchy path)
ANCESTORS_QUERY = """
PREFIX gvp: <http://vocab.getty.edu/ontology#>
PREFIX xl: <http://www.w3.org/2008/05/skos-xl#>

SELECT ?ancestor ?ancestorLabel ?ancestorId
WHERE {{
    <http://vocab.getty.edu/{vocabulary}/{external_id}> gvp:broaderPreferred+ ?ancestor .
    ?ancestor xl:prefLabel/xl:literalForm ?ancestorLabel .
    BIND(REPLACE(STR(?ancestor), "http://vocab.getty.edu/{vocabulary}/", "") AS ?ancestorId)
    FILTER(LANG(?ancestorLabel) = "en" || LANG(?ancestorLabel) = "")
}}
"""


# =============================================================================
# VOCABULARY HIERARCHY SERVICE
# =============================================================================

class VocabularyHierarchyService:
    """
    Service for managing vocabulary term hierarchies.

    Provides:
    - Full hierarchy fetching from Getty SPARQL
    - Relationship storage and retrieval
    - Search term expansion
    - Hierarchy browsing
    """

    def __init__(self, session: Session):
        """Initialize with database session."""
        self.session = session

    def fetch_term_with_hierarchy(
        self,
        external_id: str,
        vocabulary: str,
    ) -> VocabularyTerm | None:
        """
        Fetch a term with its full hierarchy from Getty and store locally.

        Args:
            external_id: Getty ID (e.g., "300015050")
            vocabulary: Vocabulary type (aat, ulan, tgn)

        Returns:
            The vocabulary term with hierarchy populated, or None if not found
        """
        if vocabulary not in ("aat", "ulan", "tgn"):
            logger.warning(f"Invalid vocabulary: {vocabulary}")
            return None

        logger.info(f"Fetching hierarchy for {vocabulary}/{external_id}")

        # Check if we already have this term with recent hierarchy
        existing_term = self.session.query(VocabularyTerm).filter(
            VocabularyTerm.vocabulary == vocabulary,
            VocabularyTerm.external_id == external_id,
        ).first()

        if existing_term and existing_term.hierarchy_fetched_at:
            stale_threshold = datetime.now(timezone.utc) - timedelta(days=HIERARCHY_STALE_DAYS)
            if existing_term.hierarchy_fetched_at > stale_threshold:
                logger.debug(f"Term {vocabulary}/{external_id} hierarchy is fresh, skipping fetch")
                return existing_term

        # Execute SPARQL query using shared helper from getty_service
        sparql = TERM_WITH_HIERARCHY_QUERY.format(
            vocabulary=vocabulary,
            external_id=external_id,
        )

        try:
            bindings = _execute_sparql(sparql)

            if not bindings:
                logger.warning(f"No results for {vocabulary}/{external_id}")
                return existing_term

            # Parse the results
            term_data = self._parse_hierarchy_response(bindings, vocabulary, external_id)

            # Upsert the term
            term = self._upsert_term(term_data, vocabulary, external_id, existing_term)

            # Store relationships
            self._store_relationships(term, term_data, vocabulary)

            # Update hierarchy_fetched_at
            term.hierarchy_fetched_at = datetime.now(timezone.utc)
            self.session.commit()

            # Cache in Redis
            self._cache_hierarchy(term)

            logger.info(f"Successfully fetched hierarchy for {vocabulary}/{external_id}")
            return term

        except Exception as e:
            logger.error(f"Error fetching hierarchy for {vocabulary}/{external_id}: {e}")
            self.session.rollback()
            return existing_term

    def _parse_hierarchy_response(
        self,
        bindings: list[dict],
        vocabulary: str,
        external_id: str,
    ) -> dict[str, Any]:
        """Parse SPARQL results into structured term data."""
        result = {
            "preferred_term": None,
            "scope_note": None,
            "alternate_terms": set(),
            "broader_terms": {},  # id -> label
            "narrower_terms": {},
            "related_terms": {},
            "facet": None,
            "getty_modified_at": None,
        }

        for binding in bindings:
            # Primary term info (take first valid value)
            if not result["preferred_term"]:
                result["preferred_term"] = binding.get("prefLabel", {}).get("value")

            if not result["scope_note"]:
                result["scope_note"] = binding.get("scopeNote", {}).get("value")

            if not result["facet"]:
                result["facet"] = binding.get("facetLabel", {}).get("value")

            if not result["getty_modified_at"]:
                modified = binding.get("modified", {}).get("value")
                if modified:
                    try:
                        result["getty_modified_at"] = datetime.fromisoformat(
                            modified.replace("Z", "+00:00")
                        )
                    except (ValueError, AttributeError):
                        pass

            # Collect alternate labels
            alt_label = binding.get("altLabel", {}).get("value")
            if alt_label:
                result["alternate_terms"].add(alt_label)

            # Collect broader terms
            broader_id = binding.get("broaderId", {}).get("value")
            broader_label = binding.get("broaderLabel", {}).get("value")
            if broader_id and broader_label:
                result["broader_terms"][broader_id] = broader_label

            # Collect narrower terms (limited)
            narrower_id = binding.get("narrowerId", {}).get("value")
            narrower_label = binding.get("narrowerLabel", {}).get("value")
            if narrower_id and narrower_label:
                if len(result["narrower_terms"]) < MAX_NARROWER_COUNT:
                    result["narrower_terms"][narrower_id] = narrower_label

            # Collect related terms
            related_id = binding.get("relatedId", {}).get("value")
            related_label = binding.get("relatedLabel", {}).get("value")
            if related_id and related_label:
                result["related_terms"][related_id] = related_label

        # Convert sets to lists
        result["alternate_terms"] = list(result["alternate_terms"])

        return result

    def _upsert_term(
        self,
        term_data: dict[str, Any],
        vocabulary: str,
        external_id: str,
        existing_term: VocabularyTerm | None,
    ) -> VocabularyTerm:
        """Create or update a vocabulary term."""
        if existing_term:
            term = existing_term
        else:
            term = VocabularyTerm(
                vocabulary=vocabulary,
                external_id=external_id,
                external_uri=f"http://vocab.getty.edu/{vocabulary}/{external_id}",
                organization_id=None,  # Global term
                is_custom=False,
            )
            self.session.add(term)

        # Update fields
        if term_data["preferred_term"]:
            term.preferred_term = term_data["preferred_term"]

        if term_data["scope_note"]:
            term.scope_note = term_data["scope_note"]

        if term_data["alternate_terms"]:
            term.alternate_terms = term_data["alternate_terms"]

        if term_data["facet"]:
            term.facet = term_data["facet"]

        if term_data["getty_modified_at"]:
            term.getty_modified_at = term_data["getty_modified_at"]

        # Build hierarchy path from broader terms
        if term_data["broader_terms"]:
            broader_labels = list(term_data["broader_terms"].values())
            if term_data["preferred_term"]:
                term.hierarchy_path = " > ".join(broader_labels[::-1]) + " > " + term_data["preferred_term"]
                term.broader_term = broader_labels[0] if broader_labels else None

        self.session.flush()  # Get the term_id
        return term

    def _store_relationships(
        self,
        term: VocabularyTerm,
        term_data: dict[str, Any],
        vocabulary: str,
    ) -> None:
        """Store broader/narrower/related relationships."""
        # Clear existing relationships for this term
        self.session.query(VocabularyTermRelationship).filter(
            VocabularyTermRelationship.term_id == term.term_id
        ).delete()

        # Store broader relationships
        for broader_id, broader_label in term_data["broader_terms"].items():
            related_term = self._ensure_term_exists(broader_id, broader_label, vocabulary)
            if related_term:
                self._add_relationship(term.term_id, related_term.term_id, "broader")

        # Store narrower relationships
        for narrower_id, narrower_label in term_data["narrower_terms"].items():
            related_term = self._ensure_term_exists(narrower_id, narrower_label, vocabulary)
            if related_term:
                self._add_relationship(term.term_id, related_term.term_id, "narrower")

        # Store related relationships
        for related_id, related_label in term_data["related_terms"].items():
            related_term = self._ensure_term_exists(related_id, related_label, vocabulary)
            if related_term:
                self._add_relationship(term.term_id, related_term.term_id, "related")

    def _ensure_term_exists(
        self,
        external_id: str,
        preferred_term: str,
        vocabulary: str,
    ) -> VocabularyTerm | None:
        """Ensure a related term exists in the database (stub if needed)."""
        existing = self.session.query(VocabularyTerm).filter(
            VocabularyTerm.vocabulary == vocabulary,
            VocabularyTerm.external_id == external_id,
        ).first()

        if existing:
            return existing

        # Create a stub term (will be fully fetched if user selects it)
        stub = VocabularyTerm(
            vocabulary=vocabulary,
            external_id=external_id,
            external_uri=f"http://vocab.getty.edu/{vocabulary}/{external_id}",
            preferred_term=preferred_term,
            organization_id=None,
            is_custom=False,
            status="active",
        )
        self.session.add(stub)
        self.session.flush()
        return stub

    def _add_relationship(
        self,
        term_id: uuid.UUID,
        related_term_id: uuid.UUID,
        relationship_type: str,
    ) -> None:
        """Add a relationship if it doesn't exist."""
        existing = self.session.query(VocabularyTermRelationship).filter(
            VocabularyTermRelationship.term_id == term_id,
            VocabularyTermRelationship.related_term_id == related_term_id,
            VocabularyTermRelationship.relationship_type == relationship_type,
        ).first()

        if not existing:
            rel = VocabularyTermRelationship(
                term_id=term_id,
                related_term_id=related_term_id,
                relationship_type=relationship_type,
                source="getty",
            )
            self.session.add(rel)

    def _cache_hierarchy(self, term: VocabularyTerm) -> None:
        """Cache term hierarchy data in Redis."""
        try:
            redis = get_redis_client()
            if not redis.is_available():
                return

            cache_key = f"vocab_hierarchy:{term.vocabulary}:{term.external_id}"
            cache_data = {
                "term_id": str(term.term_id),
                "preferred_term": term.preferred_term,
                "scope_note": term.scope_note,
                "facet": term.facet,
                "hierarchy_path": term.hierarchy_path,
                "fetched_at": term.hierarchy_fetched_at.isoformat() if term.hierarchy_fetched_at else None,
            }
            redis.client.setex(cache_key, HIERARCHY_CACHE_TTL, json.dumps(cache_data))
        except Exception as e:
            logger.debug(f"Failed to cache hierarchy: {e}")

    def _traverse(
        self,
        term_id: uuid.UUID,
        relationship_type: str,
        max_depth: int,
        include_self: bool = False,
    ) -> list[dict[str, Any]]:
        """BFS over `relationship_type` edges, batching one term query per level."""
        results: list[dict[str, Any]] = []
        visited: set[uuid.UUID] = set()

        if include_self:
            term = self.session.query(VocabularyTerm).get(term_id)
            if term:
                results.append(_serialize_traversal_term(term, depth=0))
            visited.add(term_id)
        else:
            visited.add(term_id)

        current_ids: list[uuid.UUID] = [term_id]
        depth = 0

        while current_ids and depth < max_depth:
            edges = self.session.query(
                VocabularyTermRelationship.related_term_id,
            ).filter(
                VocabularyTermRelationship.term_id.in_(current_ids),
                VocabularyTermRelationship.relationship_type == relationship_type,
            ).all()

            next_ids: list[uuid.UUID] = []
            for (related_term_id,) in edges:
                if related_term_id not in visited:
                    visited.add(related_term_id)
                    next_ids.append(related_term_id)

            if next_ids:
                terms = self.session.query(VocabularyTerm).filter(
                    VocabularyTerm.term_id.in_(next_ids),
                ).all()
                next_depth = depth + 1
                for term in terms:
                    results.append(_serialize_traversal_term(term, depth=next_depth))

            current_ids = next_ids
            depth += 1

        return results

    def get_broader_terms(
        self,
        term_id: uuid.UUID,
        max_depth: int = 10,
    ) -> list[dict[str, Any]]:
        """
        Get all broader (ancestor) terms for a given term.

        Returns terms ordered by depth, immediate parents first.
        """
        return self._traverse(term_id, "broader", max_depth=max_depth)

    def get_narrower_terms(
        self,
        term_id: uuid.UUID,
        max_depth: int = MAX_NARROWER_DEPTH,
        include_self: bool = False,
    ) -> list[dict[str, Any]]:
        """
        Get all narrower (descendant) terms for a given term.

        Args:
            include_self: Whether to include the starting term as depth 0
        """
        return self._traverse(
            term_id,
            "narrower",
            max_depth=max_depth,
            include_self=include_self,
        )

    def get_related_terms(self, term_id: uuid.UUID) -> list[dict[str, Any]]:
        """Get all related (associative) terms for a given term."""
        edges = self.session.query(
            VocabularyTermRelationship.related_term_id,
        ).filter(
            VocabularyTermRelationship.term_id == term_id,
            VocabularyTermRelationship.relationship_type == "related",
        ).all()

        related_ids = [rid for (rid,) in edges]
        if not related_ids:
            return []

        terms = self.session.query(VocabularyTerm).filter(
            VocabularyTerm.term_id.in_(related_ids),
        ).all()
        return [_serialize_traversal_term(t) for t in terms]

    def expand_search_terms(
        self,
        term_ids: list[uuid.UUID],
        include_narrower: bool = True,
        max_depth: int = 2,
    ) -> list[uuid.UUID]:
        """
        Expand a list of term IDs to include narrower terms for search.

        Args:
            term_ids: List of term UUIDs to expand
            include_narrower: Whether to include narrower terms
            max_depth: How deep to go when getting narrower terms

        Returns:
            Expanded list of term UUIDs (original + narrower)
        """
        expanded = set(term_ids)

        if include_narrower:
            for term_id in term_ids:
                narrower = self.get_narrower_terms(term_id, max_depth=max_depth)
                for n in narrower:
                    expanded.add(uuid.UUID(n["term_id"]))

        return list(expanded)

    def get_term_hierarchy(
        self,
        term_id: uuid.UUID,
    ) -> dict[str, Any]:
        """
        Get the full hierarchy for a term (ancestors, descendants, related).

        Args:
            term_id: The term to get hierarchy for

        Returns:
            Dict with term info and relationships
        """
        term = self.session.query(VocabularyTerm).get(term_id)
        if not term:
            return {}

        return {
            "term": {
                "term_id": str(term.term_id),
                "vocabulary": term.vocabulary,
                "external_id": term.external_id,
                "external_uri": term.external_uri,
                "preferred_term": term.preferred_term,
                "alternate_terms": term.alternate_terms,
                "scope_note": term.scope_note,
                "facet": term.facet,
                "hierarchy_path": term.hierarchy_path,
                "hierarchy_fetched_at": term.hierarchy_fetched_at.isoformat() if term.hierarchy_fetched_at else None,
            },
            "broader_terms": self.get_broader_terms(term_id),
            "narrower_terms": self.get_narrower_terms(term_id),
            "related_terms": self.get_related_terms(term_id),
        }

    def get_top_level_facets(self, vocabulary: str = "aat") -> list[dict[str, Any]]:
        """
        Get top-level facets for browsing.

        Args:
            vocabulary: Which vocabulary (default AAT)

        Returns:
            List of facet terms
        """
        # Get distinct facets from terms
        facets = self.session.query(
            VocabularyTerm.facet,
        ).filter(
            VocabularyTerm.vocabulary == vocabulary,
            VocabularyTerm.facet.isnot(None),
        ).distinct().all()

        return [{"facet": f[0]} for f in facets if f[0]]

    def is_hierarchy_stale(self, term: VocabularyTerm) -> bool:
        """Check if a term's hierarchy data is stale and needs refresh."""
        if not term.hierarchy_fetched_at:
            return True

        stale_threshold = datetime.now(timezone.utc) - timedelta(days=HIERARCHY_STALE_DAYS)
        return term.hierarchy_fetched_at < stale_threshold

    def get_stale_terms(self, limit: int = 100) -> list[VocabularyTerm]:
        """Get terms with stale or missing hierarchy data."""
        stale_threshold = datetime.now(timezone.utc) - timedelta(days=HIERARCHY_STALE_DAYS)

        return self.session.query(VocabularyTerm).filter(
            VocabularyTerm.vocabulary.in_(["aat", "ulan", "tgn"]),
            VocabularyTerm.external_id.isnot(None),
            or_(
                VocabularyTerm.hierarchy_fetched_at.is_(None),
                VocabularyTerm.hierarchy_fetched_at < stale_threshold,
            ),
        ).order_by(
            VocabularyTerm.usage_count.desc(),  # Prioritize frequently used terms
        ).limit(limit).all()
