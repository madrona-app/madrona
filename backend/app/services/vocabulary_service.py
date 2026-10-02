"""
Vocabulary service for Collections.

Provides controlled vocabulary functionality:
- Search/autocomplete for vocabulary terms
- Getty API integration (AAT, ULAN, TGN) via unified getty_service
- Local caching of frequently used terms
- Custom term management
- Migration mapping support

Getty Vocabularies:
- AAT (Art & Architecture Thesaurus): Object types, materials, techniques, styles
- ULAN (Union List of Artist Names): Artists, makers, creators
- TGN (Thesaurus of Geographic Names): Places

Usage:
    from app.services.vocabulary_service import VocabularyService

    service = VocabularyService(db.session, organization_id)
    results = service.search("painting", vocabulary="aat", limit=10)
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import requests
from sqlalchemy import func, or_, String
from sqlalchemy.orm import Session

from app.models import VocabularyTerm, VocabularyMapping
from app.services.getty_service import search_getty as getty_search, GETTY_SPARQL_ENDPOINT, GETTY_TIMEOUT

logger = logging.getLogger(__name__)

# Field mappings for vocabulary applicability
VOCABULARY_FIELD_MAPPINGS = {
    "aat": [
        "object_type", "object_name", "classification", "category",
        "materials", "techniques", "style_period", "form",
        "condition_summary", "display_requirements",
    ],
    "ulan": [
        "creators", "associated_people", "depicted_people",
    ],
    "tgn": [
        "creation_place", "associated_places", "depicted_places",
        "find_place", "field_collection_place",
    ],
}


# =============================================================================
# RESULT CLASSES
# =============================================================================

@dataclass
class VocabularyTermResult:
    """Result from vocabulary search."""
    term_id: uuid.UUID | None  # Local ID (None if from remote)
    vocabulary: str  # aat, ulan, tgn, local
    external_id: str | None
    external_uri: str | None
    preferred_term: str
    alternate_terms: list[str] | None
    scope_note: str | None
    broader_term: str | None
    hierarchy_path: str | None
    is_local: bool  # True if from local cache
    usage_count: int
    # TGN-specific
    place_type: str | None = None
    parent_place: str | None = None
    latitude: float | None = None
    longitude: float | None = None

    def to_dict(self) -> dict[str, Any]:
        d = {
            "term_id": str(self.term_id) if self.term_id else None,
            "vocabulary": self.vocabulary,
            "external_id": self.external_id,
            "external_uri": self.external_uri,
            "preferred_term": self.preferred_term,
            "alternate_terms": self.alternate_terms,
            "scope_note": self.scope_note,
            "broader_term": self.broader_term,
            "hierarchy_path": self.hierarchy_path,
            "is_local": self.is_local,
            "usage_count": self.usage_count,
        }
        if self.place_type:
            d["place_type"] = self.place_type
        if self.parent_place:
            d["parent_place"] = self.parent_place
        if self.latitude is not None and self.longitude is not None:
            d["latitude"] = self.latitude
            d["longitude"] = self.longitude
        return d


# =============================================================================
# SPARQL QUERIES (for specific term lookup - search uses getty_service)
# =============================================================================

# Get term by external ID
TERM_BY_ID_QUERY = """
PREFIX gvp: <http://vocab.getty.edu/ontology#>
PREFIX xl: <http://www.w3.org/2008/05/skos-xl#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

SELECT ?prefLabel ?scopeNote ?broader ?broaderLabel
WHERE {{
    <http://vocab.getty.edu/{vocabulary}/{external_id}>
        xl:prefLabel/xl:literalForm ?prefLabel .
    FILTER(LANG(?prefLabel) = "en" || LANG(?prefLabel) = "")

    OPTIONAL {{
        <http://vocab.getty.edu/{vocabulary}/{external_id}> skos:scopeNote ?scopeNoteNode .
        ?scopeNoteNode rdf:value ?scopeNote .
        FILTER(LANG(?scopeNote) = "en" || LANG(?scopeNote) = "")
    }}
    OPTIONAL {{
        <http://vocab.getty.edu/{vocabulary}/{external_id}> gvp:broaderPreferred ?broader .
        ?broader xl:prefLabel/xl:literalForm ?broaderLabel .
        FILTER(LANG(?broaderLabel) = "en" || LANG(?broaderLabel) = "")
    }}
}}
LIMIT 1
"""


# =============================================================================
# VOCABULARY SERVICE
# =============================================================================

class VocabularyService:
    """
    Service for working with controlled vocabularies.

    Provides:
    - Autocomplete/search for vocabulary terms
    - Getty API integration for term lookup
    - Local caching of frequently used terms
    - Custom term management
    - Migration mapping support
    """

    def __init__(self, session: Session, organization_id: uuid.UUID | None = None):
        """
        Initialize vocabulary service.

        Args:
            session: SQLAlchemy session
            organization_id: Optional org ID for org-specific terms
        """
        self.session = session
        self.organization_id = organization_id

    def search(
        self,
        query: str,
        vocabulary: str | None = None,
        applicable_field: str | None = None,
        facet: str | None = None,
        limit: int = 20,
        include_remote: bool = True,
    ) -> list[VocabularyTermResult]:
        """
        Search vocabulary terms with autocomplete.

        Priority:
        1. Local terms frequently used by this org
        2. Local terms from all orgs (global)
        3. Remote Getty API (if include_remote and local results insufficient)

        Args:
            query: Search query string
            vocabulary: Filter by vocabulary (aat, ulan, tgn, local)
            applicable_field: Filter by field applicability
            facet: For AAT, filter by facet (materials, techniques, styles_periods, object_types)
            limit: Maximum results to return
            include_remote: Whether to search Getty API if local results insufficient

        Returns:
            List of VocabularyTermResult
        """
        if not query or len(query) < 2:
            return []

        results: list[VocabularyTermResult] = []

        # Search local cache first
        local_terms = self._search_local(query, vocabulary, applicable_field, limit)
        results.extend(local_terms)

        # If we need more results, search remote APIs
        if include_remote and len(results) < limit:
            existing_ids = {r.external_id for r in results if r.external_id}
            remaining = limit - len(results)

            # When searching all vocabularies, give each source a fair share
            if vocabulary is None:
                per_source = max(remaining // 2, 3)
            else:
                per_source = remaining

            # Getty (AAT, ULAN, TGN)
            if vocabulary in ("aat", "ulan", "tgn", None):
                remote_terms = self._search_getty(
                    query,
                    vocabulary,
                    per_source,
                    exclude_ids=existing_ids,
                    facet=facet,
                )
                results.extend(remote_terms)
                existing_ids.update(r.external_id for r in remote_terms if r.external_id)

            # Nomenclature (CHIN SPARQL)
            if vocabulary in ("nomenclature", None):
                nom_limit = per_source if vocabulary is None else remaining
                remote_terms = self._search_nomenclature(
                    query,
                    nom_limit,
                    exclude_ids=existing_ids,
                )
                results.extend(remote_terms)

        return results[:limit]

    def _search_local(
        self,
        query: str,
        vocabulary: str | None,
        applicable_field: str | None,
        limit: int,
    ) -> list[VocabularyTermResult]:
        """Search local vocabulary cache."""
        query_lower = query.lower()

        # Build base query
        base_query = self.session.query(VocabularyTerm).filter(
            VocabularyTerm.status == "active",
            or_(
                func.lower(VocabularyTerm.preferred_term).contains(query_lower),
                # Search in alternate_terms JSONB array (cast to text for searching)
                func.lower(func.cast(VocabularyTerm.alternate_terms, String)).contains(query_lower),
            ),
        )

        # Filter by vocabulary type
        if vocabulary:
            base_query = base_query.filter(VocabularyTerm.vocabulary == vocabulary)

        # Filter by organization (include global terms and org-specific)
        if self.organization_id:
            base_query = base_query.filter(
                or_(
                    VocabularyTerm.organization_id == self.organization_id,
                    VocabularyTerm.organization_id.is_(None),  # Global terms
                )
            )
        else:
            # Only global terms if no org specified
            base_query = base_query.filter(VocabularyTerm.organization_id.is_(None))

        # Filter by applicable field
        if applicable_field:
            # JSONB array contains check
            base_query = base_query.filter(
                VocabularyTerm.applicable_fields.contains([applicable_field])
            )

        # Order by usage count (org-specific first, then global)
        # Org-specific terms ranked higher
        base_query = base_query.order_by(
            VocabularyTerm.organization_id.isnot(None).desc(),  # Org terms first
            VocabularyTerm.usage_count.desc(),
            VocabularyTerm.preferred_term,
        )

        terms = base_query.limit(limit).all()

        return [
            VocabularyTermResult(
                term_id=t.term_id,
                vocabulary=t.vocabulary,
                external_id=t.external_id,
                external_uri=t.external_uri,
                preferred_term=t.preferred_term,
                alternate_terms=t.alternate_terms,
                scope_note=t.scope_note,
                broader_term=t.broader_term,
                hierarchy_path=t.hierarchy_path,
                is_local=True,
                usage_count=t.usage_count,
            )
            for t in terms
        ]

    def _search_getty(
        self,
        query: str,
        vocabulary: str | None,
        limit: int,
        exclude_ids: set[str] | None = None,
        facet: str | None = None,
    ) -> list[VocabularyTermResult]:
        """
        Search Getty vocabularies using the unified getty_service.

        Args:
            query: Search query
            vocabulary: Specific vocabulary or None for all
            limit: Max results
            exclude_ids: External IDs to exclude (already in results)
            facet: For AAT, filter by facet (materials, techniques, styles_periods, object_types)

        Returns:
            List of VocabularyTermResult from Getty
        """
        results: list[VocabularyTermResult] = []
        vocabularies = [vocabulary] if vocabulary else ["aat", "ulan", "tgn"]
        exclude_ids = exclude_ids or set()

        per_vocab_limit = limit // len(vocabularies) + 1

        for vocab in vocabularies:
            if len(results) >= limit:
                break

            try:
                # Use unified getty_service for consistent search
                # Pass facet only for AAT searches
                vocab_facet = facet if vocab == "aat" else None
                getty_results = getty_search(query, vocab, per_vocab_limit, facet=vocab_facet)

                for r in getty_results:
                    if r.external_id not in exclude_ids and len(results) < limit:
                        # Convert GettySearchResult to VocabularyTermResult
                        hierarchy_path = None
                        if r.broader_term:
                            hierarchy_path = f"{r.broader_term} > {r.preferred_term}"

                        results.append(
                            VocabularyTermResult(
                                term_id=None,  # Not cached locally yet
                                vocabulary=r.vocabulary,
                                external_id=r.external_id,
                                external_uri=r.uri,
                                preferred_term=r.preferred_term,
                                alternate_terms=None,
                                scope_note=r.scope_note,
                                broader_term=r.broader_term,
                                hierarchy_path=hierarchy_path,
                                is_local=False,
                                usage_count=0,
                                place_type=r.place_type,
                                parent_place=r.parent_place,
                                latitude=r.latitude,
                                longitude=r.longitude,
                            )
                        )
            except Exception as e:
                logger.warning(f"Getty {vocab} search failed: {e}")
                continue

        return results

    def get_term_by_external_id(
        self,
        external_id: str,
        vocabulary: str,
    ) -> VocabularyTermResult | None:
        """
        Get a vocabulary term by its external ID.

        First checks local cache, then fetches from Getty if not cached.

        Args:
            external_id: Getty ID (e.g., "300033618")
            vocabulary: Vocabulary type (aat, ulan, tgn)

        Returns:
            VocabularyTermResult or None if not found
        """
        # Check local cache first
        term = self.session.query(VocabularyTerm).filter(
            VocabularyTerm.vocabulary == vocabulary,
            VocabularyTerm.external_id == external_id,
        ).first()

        if term:
            return VocabularyTermResult(
                term_id=term.term_id,
                vocabulary=term.vocabulary,
                external_id=term.external_id,
                external_uri=term.external_uri,
                preferred_term=term.preferred_term,
                alternate_terms=term.alternate_terms,
                scope_note=term.scope_note,
                broader_term=term.broader_term,
                hierarchy_path=term.hierarchy_path,
                is_local=True,
                usage_count=term.usage_count,
            )

        # Fetch from Getty
        return self._fetch_term_from_getty(external_id, vocabulary)

    def _fetch_term_from_getty(
        self,
        external_id: str,
        vocabulary: str,
    ) -> VocabularyTermResult | None:
        """Fetch a specific term from Getty by ID."""
        sparql = TERM_BY_ID_QUERY.format(
            vocabulary=vocabulary,
            external_id=external_id,
        )

        try:
            response = requests.get(
                GETTY_SPARQL_ENDPOINT,
                params={"query": sparql, "format": "json"},
                timeout=GETTY_TIMEOUT,
                headers={"Accept": "application/sparql-results+json"},
            )

            if response.status_code != 200:
                return None

            data = response.json()
            bindings = data.get("results", {}).get("bindings", [])

            if not bindings:
                return None

            binding = bindings[0]
            pref_label = binding.get("prefLabel", {}).get("value", "")
            scope_note = binding.get("scopeNote", {}).get("value")
            broader_label = binding.get("broaderLabel", {}).get("value")

            return VocabularyTermResult(
                term_id=None,
                vocabulary=vocabulary,
                external_id=external_id,
                external_uri=f"http://vocab.getty.edu/{vocabulary}/{external_id}",
                preferred_term=pref_label,
                alternate_terms=None,
                scope_note=scope_note,
                broader_term=broader_label,
                hierarchy_path=f"{broader_label} > {pref_label}" if broader_label else None,
                is_local=False,
                usage_count=0,
            )

        except Exception as e:
            logger.warning(f"Failed to fetch term {vocabulary}/{external_id}: {e}")
            return None

    def _search_nomenclature(
        self,
        query: str,
        limit: int,
        exclude_ids: set[str] | None = None,
    ) -> list[VocabularyTermResult]:
        """Search Nomenclature 4.0 via live SPARQL query."""
        from app.services.nomenclature_service import search_nomenclature

        try:
            remote_results = search_nomenclature(query, limit=limit + 5)
        except Exception as e:
            logger.warning("Nomenclature SPARQL search failed: %s", e)
            return []

        results = []
        for r in remote_results:
            if exclude_ids and r.external_id in exclude_ids:
                continue
            results.append(VocabularyTermResult(
                term_id=None,
                vocabulary="nomenclature",
                external_id=r.external_id,
                external_uri=r.uri,
                preferred_term=r.preferred_term,
                alternate_terms=None,
                scope_note=r.scope_note,
                broader_term=r.broader_term,
                hierarchy_path=r.hierarchy_path,
                is_local=False,
                usage_count=0,
            ))
            if len(results) >= limit:
                break

        return results

    def cache_term(
        self,
        result: VocabularyTermResult,
        applicable_fields: list[str] | None = None,
    ) -> VocabularyTerm:
        """
        Cache a vocabulary term locally.

        Args:
            result: Term result from search
            applicable_fields: Fields this term applies to

        Returns:
            Created or existing VocabularyTerm
        """
        # Check if already cached. Match this org's own rows first, then the
        # platform-loaded global corpus (Nomenclature, Getty hierarchy sync),
        # so a term the platform already holds is reused rather than copied.
        if result.external_id:
            existing = (
                self.session.query(VocabularyTerm)
                .filter(
                    VocabularyTerm.vocabulary == result.vocabulary,
                    VocabularyTerm.external_id == result.external_id,
                    or_(
                        VocabularyTerm.organization_id == self.organization_id,
                        VocabularyTerm.organization_id.is_(None),
                    ),
                )
                .order_by(VocabularyTerm.organization_id.isnot(None).desc())
                .first()
            )

            if existing:
                # Only bump counters on a row this org owns. The global corpus
                # is shared, and one tenant's usage is not another's.
                if existing.organization_id is not None:
                    existing.usage_count += 1
                    existing.last_used_at = datetime.now(timezone.utc)
                return existing

        # Create new cached term, scoped to the caller's organization.
        #
        # This used to write organization_id=None — a row every tenant reads —
        # from fields supplied wholesale by the client (vocabulary, external_id,
        # preferred_term, alternate_terms, scope_note, broader_term,
        # hierarchy_path) via POST .../collections/vocabulary/cache, with a
        # dedupe lookup that ignored the org. One tenant could therefore define,
        # or pre-claim, what every other institution saw for a given Getty id.
        # The platform's own loaders still write the shared corpus; content that
        # arrives from a tenant stays in that tenant's namespace.
        term = VocabularyTerm(
            organization_id=self.organization_id,
            vocabulary=result.vocabulary,
            external_id=result.external_id,
            external_uri=result.external_uri,
            preferred_term=result.preferred_term,
            alternate_terms=result.alternate_terms,
            scope_note=result.scope_note,
            broader_term=result.broader_term,
            hierarchy_path=result.hierarchy_path,
            applicable_fields=applicable_fields or VOCABULARY_FIELD_MAPPINGS.get(result.vocabulary),
            usage_count=1,
            last_used_at=datetime.now(timezone.utc),
            is_custom=False,
        )

        self.session.add(term)
        return term

    def create_custom_term(
        self,
        preferred_term: str,
        scope_note: str | None = None,
        applicable_fields: list[str] | None = None,
    ) -> VocabularyTerm:
        """
        Create a custom (local) vocabulary term.

        Args:
            preferred_term: Display term
            scope_note: Optional description
            applicable_fields: Fields this term applies to

        Returns:
            Created VocabularyTerm
        """
        term = VocabularyTerm(
            organization_id=self.organization_id,
            vocabulary="local",
            external_id=None,
            external_uri=None,
            preferred_term=preferred_term,
            scope_note=scope_note,
            applicable_fields=applicable_fields,
            usage_count=0,
            is_custom=True,
        )

        self.session.add(term)
        return term

    def record_usage(self, term_id: uuid.UUID) -> None:
        """
        Record that a term was used (for popularity ranking).

        Args:
            term_id: ID of term used
        """
        term = self.session.query(VocabularyTerm).get(term_id)
        if term:
            term.usage_count += 1
            term.last_used_at = datetime.now(timezone.utc)

    def get_mapping(
        self,
        source_term: str,
        source_field: str,
    ) -> VocabularyMapping | None:
        """
        Get vocabulary mapping for a legacy/source term.

        Args:
            source_term: Original term from source system
            source_field: Field the term came from

        Returns:
            VocabularyMapping if exists
        """
        return self.session.query(VocabularyMapping).filter(
            VocabularyMapping.organization_id == self.organization_id,
            VocabularyMapping.source_term == source_term,
            VocabularyMapping.source_field == source_field,
        ).first()

    def create_mapping(
        self,
        source_term: str,
        source_field: str,
        vocabulary_term_id: uuid.UUID | None = None,
        mapped_value: str | None = None,
        confidence: str = "manual",
        source_system: str | None = None,
    ) -> VocabularyMapping:
        """
        Create a mapping from legacy term to controlled vocabulary.

        Args:
            source_term: Original term from source
            source_field: Field the term came from
            vocabulary_term_id: Target VocabularyTerm ID
            mapped_value: Direct string mapping (if not using term ID)
            confidence: Mapping confidence (exact, probable, possible, manual)
            source_system: Source system identifier

        Returns:
            Created VocabularyMapping
        """
        mapping = VocabularyMapping(
            organization_id=self.organization_id,
            source_term=source_term,
            source_field=source_field,
            source_system=source_system,
            vocabulary_term_id=vocabulary_term_id,
            mapped_value=mapped_value,
            confidence=confidence,
        )

        self.session.add(mapping)
        return mapping

    def cache_term_with_hierarchy(
        self,
        result: VocabularyTermResult,
        applicable_fields: list[str] | None = None,
        sync_hierarchy: bool = True,
    ) -> VocabularyTerm:
        """
        Cache a vocabulary term and optionally trigger hierarchy sync.

        This is the preferred method when a user selects a term from autocomplete.
        It caches the term immediately and queues a background task to fetch
        the full hierarchy from Getty.

        Args:
            result: Term result from search
            applicable_fields: Fields this term applies to
            sync_hierarchy: Whether to queue hierarchy sync (default True)

        Returns:
            Created or existing VocabularyTerm
        """
        # Cache the term using existing method
        term = self.cache_term(result, applicable_fields)
        self.session.flush()  # Ensure term has an ID

        # Queue hierarchy sync for Getty terms
        if (
            sync_hierarchy
            and result.external_id
            and result.vocabulary in ("aat", "ulan", "tgn")
        ):
            try:
                from app.tasks.vocabulary import sync_term_hierarchy_task
                sync_term_hierarchy_task.delay(
                    external_id=result.external_id,
                    vocabulary=result.vocabulary,
                )
                logger.debug(
                    f"Queued hierarchy sync for {result.vocabulary}/{result.external_id}"
                )
            except Exception as e:
                # Don't fail the cache operation if task queue fails
                logger.warning(f"Failed to queue hierarchy sync: {e}")

        return term

    def get_term_with_relationships(
        self,
        term_id: uuid.UUID,
    ) -> dict | None:
        """
        Get a vocabulary term with its relationship data.

        Args:
            term_id: UUID of the term

        Returns:
            Dict with term data and relationships, or None if not found
        """
        term = self.session.query(VocabularyTerm).get(term_id)
        if not term:
            return None

        result = VocabularyTermResult(
            term_id=term.term_id,
            vocabulary=term.vocabulary,
            external_id=term.external_id,
            external_uri=term.external_uri,
            preferred_term=term.preferred_term,
            alternate_terms=term.alternate_terms,
            scope_note=term.scope_note,
            broader_term=term.broader_term,
            hierarchy_path=term.hierarchy_path,
            is_local=True,
            usage_count=term.usage_count,
        ).to_dict()

        # Add hierarchy metadata
        result["facet"] = term.facet
        result["hierarchy_fetched_at"] = (
            term.hierarchy_fetched_at.isoformat()
            if term.hierarchy_fetched_at else None
        )

        # Get relationship counts
        from app.models import VocabularyTermRelationship

        broader_count = self.session.query(VocabularyTermRelationship).filter(
            VocabularyTermRelationship.term_id == term_id,
            VocabularyTermRelationship.relationship_type == "broader",
        ).count()

        narrower_count = self.session.query(VocabularyTermRelationship).filter(
            VocabularyTermRelationship.term_id == term_id,
            VocabularyTermRelationship.relationship_type == "narrower",
        ).count()

        related_count = self.session.query(VocabularyTermRelationship).filter(
            VocabularyTermRelationship.term_id == term_id,
            VocabularyTermRelationship.relationship_type == "related",
        ).count()

        result["relationship_counts"] = {
            "broader": broader_count,
            "narrower": narrower_count,
            "related": related_count,
        }

        return result

    def trigger_hierarchy_sync(
        self,
        term_id: uuid.UUID,
    ) -> bool:
        """
        Trigger a background hierarchy sync for a term.

        Args:
            term_id: UUID of the term to sync

        Returns:
            True if sync was queued, False otherwise
        """
        term = self.session.query(VocabularyTerm).get(term_id)
        if not term or not term.external_id:
            return False

        if term.vocabulary not in ("aat", "ulan", "tgn"):
            return False

        try:
            from app.tasks.vocabulary import sync_term_hierarchy_task
            sync_term_hierarchy_task.delay(
                external_id=term.external_id,
                vocabulary=term.vocabulary,
            )
            return True
        except Exception as e:
            logger.warning(f"Failed to queue hierarchy sync: {e}")
            return False
