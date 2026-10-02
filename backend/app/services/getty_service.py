"""
Getty Vocabulary Service

Unified service for all Getty vocabulary API calls (AAT, ULAN, TGN).
Provides consistent interface and query patterns across all vocabularies.

Usage:
    from app.services.getty_service import search_aat, search_ulan, search_tgn

    results = search_aat("canvas", limit=10)
    results = search_ulan("Monet", limit=10)
    results = search_tgn("Paris", limit=10)
"""

import logging
import re
import time
from dataclasses import dataclass
from typing import Optional

import requests

logger = logging.getLogger(__name__)

# =============================================================================
# CONFIGURATION
# =============================================================================

# https direct — the http endpoint 301-redirects to https, so every call would
# otherwise pay an extra round-trip (more latency + failure surface).
GETTY_SPARQL_ENDPOINT = "https://vocab.getty.edu/sparql"
GETTY_TIMEOUT = 15  # seconds
GETTY_RETRIES = 2   # total attempts; Getty returns transient 499s under load

# AAT Facet/Hierarchy URIs for category-specific searches
AAT_FACETS = {
    "materials": "http://vocab.getty.edu/aat/300264091",      # Materials facet
    "techniques": "http://vocab.getty.edu/aat/300053001",     # Processes and Techniques
    "styles_periods": "http://vocab.getty.edu/aat/300264088", # Styles and Periods facet
    "object_types": "http://vocab.getty.edu/aat/300264092",   # Object Genres (for object types)
    "activities": "http://vocab.getty.edu/aat/300177000",     # Activities facet
}


# =============================================================================
# RESULT DATACLASS
# =============================================================================

@dataclass
class GettySearchResult:
    """Unified result from any Getty vocabulary search."""
    vocabulary: str  # 'aat', 'ulan', 'tgn'
    uri: str
    external_id: str
    preferred_term: str
    scope_note: Optional[str] = None
    broader_term: Optional[str] = None
    # ULAN-specific
    dates: Optional[str] = None
    nationality: Optional[str] = None
    # TGN-specific
    place_type: Optional[str] = None
    parent_place: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

    def to_dict(self) -> dict:
        return {
            "vocabulary": self.vocabulary,
            "external_id": self.external_id,
            "external_uri": self.uri,
            "preferred_term": self.preferred_term,
            "scope_note": self.scope_note,
            "broader_term": self.broader_term,
            "dates": self.dates,
            "nationality": self.nationality,
            "place_type": self.place_type,
            "parent_place": self.parent_place,
            "latitude": self.latitude,
            "longitude": self.longitude,
        }


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def _escape_query(query: str) -> str:
    """Escape special characters for SPARQL REGEX, preserving spaces."""
    # Escape regex metacharacters but restore spaces (re.escape escapes them)
    escaped = re.escape(query)
    escaped = escaped.replace("\\ ", " ")
    escaped = escaped.replace('"', '\\"').replace("'", "\\'")
    return escaped


def _execute_sparql(sparql: str) -> list[dict]:
    """Execute SPARQL query against Getty, retrying once on transient failures.

    Getty periodically times out or returns 499/5xx under load; a single retry
    with a short backoff turns most of those blips into successful lookups
    instead of silently-empty results.
    """
    last: str = "unknown"
    for attempt in range(GETTY_RETRIES):
        try:
            response = requests.get(
                GETTY_SPARQL_ENDPOINT,
                params={"query": sparql, "format": "json"},
                timeout=GETTY_TIMEOUT,
            )
            if response.status_code == 200 and response.text:
                return response.json().get("results", {}).get("bindings", [])
            last = f"status={response.status_code}"
            # 499 (client-closed under load) and 5xx are transient → retry.
            # Other 4xx won't improve on retry, so give up immediately.
            if response.status_code != 499 and response.status_code < 500:
                logger.warning(f"Getty SPARQL failed: {last}")
                return []
        except requests.Timeout:
            last = f"timeout after {GETTY_TIMEOUT}s"
        except requests.ConnectionError as e:
            last = f"connection error: {e}"
        except Exception as e:
            logger.warning(f"Getty SPARQL error: {e}")
            return []

        if attempt + 1 < GETTY_RETRIES:
            time.sleep(0.5 * (attempt + 1))

    logger.warning(f"Getty SPARQL failed after {GETTY_RETRIES} attempts ({last})")
    return []


def _get_binding_value(binding: dict, key: str) -> Optional[str]:
    """Safely extract value from SPARQL binding."""
    return binding.get(key, {}).get("value")


# =============================================================================
# AAT SEARCH (Art & Architecture Thesaurus)
# =============================================================================

def search_aat(
    query: str,
    limit: int = 20,
    facet: Optional[str] = None,
) -> list[GettySearchResult]:
    """
    Search Getty AAT for terms, optionally filtered by facet/hierarchy.

    Args:
        query: Search term
        limit: Maximum results (default 20)
        facet: Optional facet to filter by ('materials', 'techniques', 'styles_periods', 'object_types')

    Returns:
        List of GettySearchResult
    """
    safe_query = _escape_query(query)

    # Build facet filter if specified
    facet_filter = ""
    if facet and facet in AAT_FACETS:
        facet_uri = AAT_FACETS[facet]
        facet_filter = f"?uri gvp:broaderExtended <{facet_uri}> ."

    sparql = f"""PREFIX xl: <http://www.w3.org/2008/05/skos-xl#>
PREFIX gvp: <http://vocab.getty.edu/ontology#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

SELECT DISTINCT ?uri ?name ?scopeNote ?broaderName
WHERE {{
    ?uri a gvp:Subject ;
         skos:inScheme <http://vocab.getty.edu/aat/> ;
         gvp:prefLabelGVP [xl:literalForm ?name] .
    {facet_filter}
    FILTER(REGEX(?name, "(^|\\\\W){safe_query}(\\\\W|$)", "i"))

    OPTIONAL {{
        ?uri skos:scopeNote [rdf:value ?scopeNote] .
        FILTER(LANG(?scopeNote) = "en" || LANG(?scopeNote) = "")
    }}
    OPTIONAL {{
        ?uri gvp:broaderPreferred/gvp:prefLabelGVP [xl:literalForm ?broaderName] .
    }}
}}
LIMIT {limit}"""

    bindings = _execute_sparql(sparql)
    results = []
    seen_uris = set()

    for binding in bindings:
        uri = _get_binding_value(binding, "uri")
        name = _get_binding_value(binding, "name")

        if not uri or not name or uri in seen_uris:
            continue
        seen_uris.add(uri)

        external_id = uri.split("/")[-1] if "/aat/" in uri else None
        if not external_id:
            continue

        results.append(GettySearchResult(
            vocabulary="aat",
            uri=uri,
            external_id=external_id,
            preferred_term=name,
            scope_note=_get_binding_value(binding, "scopeNote"),
            broader_term=_get_binding_value(binding, "broaderName"),
        ))

    return results


def search_aat_materials(query: str, limit: int = 20) -> list[GettySearchResult]:
    """Search AAT for materials only (e.g., oil paint, canvas, bronze)."""
    return search_aat(query, limit, facet="materials")


def search_aat_techniques(query: str, limit: int = 20) -> list[GettySearchResult]:
    """Search AAT for techniques/processes only (e.g., etching, impasto, gilding)."""
    return search_aat(query, limit, facet="techniques")


def search_aat_styles_periods(query: str, limit: int = 20) -> list[GettySearchResult]:
    """Search AAT for styles and periods only (e.g., Baroque, Renaissance, Art Deco)."""
    return search_aat(query, limit, facet="styles_periods")


def search_aat_object_types(query: str, limit: int = 20) -> list[GettySearchResult]:
    """Search AAT for object types only (e.g., paintings, sculptures, furniture)."""
    return search_aat(query, limit, facet="object_types")


# =============================================================================
# ULAN SEARCH (Union List of Artist Names)
# =============================================================================

def search_ulan(query: str, limit: int = 20) -> list[GettySearchResult]:
    """
    Search Getty ULAN for person names using Lucene full-text index.

    Uses Getty's luc:term for fast indexed search instead of slow REGEX.
    Handles name order - "Claude Monet" finds "Monet, Claude".
    Post-filters to require ALL query words appear in the name.

    Args:
        query: Search term (name)
        limit: Maximum results (default 20)

    Returns:
        List of GettySearchResult
    """
    safe_query = query.strip().replace('"', '\\"').replace("'", "\\'")
    if not safe_query:
        return []

    # Split query into words for post-filtering
    query_words = [w.lower() for w in query.strip().split()]

    # Use Lucene full-text search - fetch extra for post-filtering
    fetch_limit = limit * 3  # Fetch more since we'll filter
    sparql = f"""PREFIX xl: <http://www.w3.org/2008/05/skos-xl#>
PREFIX gvp: <http://vocab.getty.edu/ontology#>
PREFIX luc: <http://www.ontotext.com/owlim/lucene#>

SELECT DISTINCT ?uri ?name ?birthYear ?deathYear ?nationality
WHERE {{
    ?uri luc:term "{safe_query}" ;
         a gvp:PersonConcept ;
         xl:prefLabel/xl:literalForm ?name .

    OPTIONAL {{ ?uri gvp:estStart ?birthYear . }}
    OPTIONAL {{ ?uri gvp:estEnd ?deathYear . }}
    OPTIONAL {{
        ?uri gvp:nationalityPreferred/xl:prefLabel/xl:literalForm ?nationality .
        FILTER(LANG(?nationality) = "en" || LANG(?nationality) = "")
    }}
}}
LIMIT {fetch_limit}"""

    logger.info(f"ULAN search: query='{safe_query}'")
    bindings = _execute_sparql(sparql)
    logger.info(f"ULAN search: got {len(bindings)} bindings")
    results = []
    seen_uris = set()

    for binding in bindings:
        uri = _get_binding_value(binding, "uri")
        name = _get_binding_value(binding, "name")

        if not uri or not name or uri in seen_uris:
            continue
        seen_uris.add(uri)

        # Post-filter: ALL query words must appear in the name
        name_lower = name.lower()
        if not all(word in name_lower for word in query_words):
            continue

        external_id = uri.split("/")[-1] if "/ulan/" in uri else None
        if not external_id:
            continue

        # Build dates string
        birth = _get_binding_value(binding, "birthYear")
        death = _get_binding_value(binding, "deathYear")
        dates = None
        if birth or death:
            birth_year = birth[:4] if birth else "?"
            death_year = death[:4] if death else ""
            dates = f"{birth_year}-{death_year}"

        results.append(GettySearchResult(
            vocabulary="ulan",
            uri=uri,
            external_id=external_id,
            preferred_term=name,
            dates=dates,
            nationality=_get_binding_value(binding, "nationality"),
        ))

        # Stop once we have enough results
        if len(results) >= limit:
            break

    return results


# =============================================================================
# TGN SEARCH (Thesaurus of Geographic Names)
# =============================================================================

def search_tgn(query: str, limit: int = 20) -> list[GettySearchResult]:
    """
    Search Getty TGN for place names using Lucene full-text index.

    Uses Getty's luc:term for fast indexed search instead of slow REGEX.
    Post-filters to require ALL query words appear in the name.

    Args:
        query: Search term (place name)
        limit: Maximum results (default 20)

    Returns:
        List of GettySearchResult
    """
    safe_query = query.strip().replace('"', '\\"').replace("'", "\\'")
    if not safe_query:
        return []

    query_words = [w.lower() for w in query.strip().split()]
    fetch_limit = limit * 3

    sparql = f"""PREFIX xl: <http://www.w3.org/2008/05/skos-xl#>
PREFIX gvp: <http://vocab.getty.edu/ontology#>
PREFIX luc: <http://www.ontotext.com/owlim/lucene#>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX wgs: <http://www.w3.org/2003/01/geo/wgs84_pos#>

SELECT DISTINCT ?uri ?name ?placeType ?parents ?lat ?long
WHERE {{
    ?uri luc:term "{safe_query}" ;
         a gvp:AdminPlaceConcept ;
         xl:prefLabel/xl:literalForm ?name .
    FILTER(LANG(?name) = "en" || LANG(?name) = "")

    OPTIONAL {{
        ?uri gvp:placeTypePreferred/xl:prefLabel/xl:literalForm ?placeType .
        FILTER(LANG(?placeType) = "en" || LANG(?placeType) = "")
    }}
    OPTIONAL {{ ?uri gvp:parentString ?parents }}
    OPTIONAL {{ ?uri foaf:focus ?place . ?place wgs:lat ?lat ; wgs:long ?long . }}
}}
LIMIT {fetch_limit}"""

    logger.info(f"TGN search: query='{safe_query}'")
    bindings = _execute_sparql(sparql)
    logger.info(f"TGN search: got {len(bindings)} bindings")
    results = []
    seen_uris = set()

    for binding in bindings:
        uri = _get_binding_value(binding, "uri")
        name = _get_binding_value(binding, "name")

        if not uri or not name or uri in seen_uris:
            continue
        seen_uris.add(uri)

        # Post-filter: ALL query words must appear in the name
        name_lower = name.lower()
        if not all(word in name_lower for word in query_words):
            continue

        external_id = uri.split("/")[-1] if "/tgn/" in uri else None
        if not external_id:
            continue

        # Full parent chain ("Williamsburg, South Carolina, United States, …")
        # — TGN has many records per name, and the immediate parent alone
        # ("Williamsburg county") isn't enough to pick the right one.
        parents = _get_binding_value(binding, "parents")
        try:
            latitude = float(_get_binding_value(binding, "lat"))
            longitude = float(_get_binding_value(binding, "long"))
        except (TypeError, ValueError):
            latitude = longitude = None
        results.append(GettySearchResult(
            vocabulary="tgn",
            uri=uri,
            external_id=external_id,
            preferred_term=name,
            place_type=_get_binding_value(binding, "placeType"),
            parent_place=parents,
            broader_term=parents.split(",")[0].strip() if parents else None,
            latitude=latitude,
            longitude=longitude,
        ))

        if len(results) >= limit:
            break

    return results


def get_tgn_coordinates(tgn_id: str) -> Optional[tuple[float, float]]:
    """Fetch (latitude, longitude) for a TGN place record.

    TGN stores coordinates on the record's foaf:focus node; nearly every
    place has them. Returns None when the record has no coordinates or the
    lookup fails — callers fall back to name-based geocoding.
    """
    safe_id = "".join(c for c in str(tgn_id) if c.isdigit())
    if not safe_id:
        return None

    sparql = f"""PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX wgs: <http://www.w3.org/2003/01/geo/wgs84_pos#>

SELECT ?lat ?long
WHERE {{
    <http://vocab.getty.edu/tgn/{safe_id}> foaf:focus ?place .
    ?place wgs:lat ?lat ; wgs:long ?long .
}}
LIMIT 1"""

    bindings = _execute_sparql(sparql)
    if not bindings:
        return None
    try:
        lat = float(_get_binding_value(bindings[0], "lat"))
        lng = float(_get_binding_value(bindings[0], "long"))
    except (TypeError, ValueError):
        return None
    return (lat, lng)


# =============================================================================
# UNIFIED SEARCH
# =============================================================================

def search_getty(
    query: str,
    vocabulary: str,
    limit: int = 20,
    facet: Optional[str] = None,
) -> list[GettySearchResult]:
    """
    Search any Getty vocabulary.

    Args:
        query: Search term
        vocabulary: 'aat', 'ulan', or 'tgn'
        limit: Maximum results
        facet: For AAT only - filter by facet ('materials', 'techniques', 'styles_periods', 'object_types')

    Returns:
        List of GettySearchResult
    """
    if vocabulary == "aat":
        return search_aat(query, limit, facet=facet)
    elif vocabulary == "ulan":
        return search_ulan(query, limit)
    elif vocabulary == "tgn":
        return search_tgn(query, limit)
    else:
        logger.warning(f"Unknown Getty vocabulary: {vocabulary}")
        return []
