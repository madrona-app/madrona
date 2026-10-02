"""
Nomenclature for Museum Cataloging — live search service.

Queries the Canadian Heritage Information Network's SPARQL endpoint
in real time, same pattern as the Getty vocabulary service. Terms are
cached locally in vocabulary_terms only when a user selects one.

Endpoint:
    POST https://nomenclature.info/sparql/rest/sparql/nom
    Content-Type: application/x-www-form-urlencoded
    Accept: application/sparql-results+json

Usage:
    from app.services.nomenclature_service import search_nomenclature

    results = search_nomenclature("coat", limit=10)
    results = search_nomenclature("spinning wheel", limit=5)
"""

import logging
import re
from dataclasses import dataclass
from typing import Optional

import requests

logger = logging.getLogger(__name__)

NOMENCLATURE_SPARQL_ENDPOINT = "https://nomenclature.info/sparql/rest/sparql/nom"
NOMENCLATURE_TIMEOUT = 15  # seconds
URI_PREFIX = "https://nomenclature.info/nom/"


@dataclass
class NomenclatureSearchResult:
    """Result from a Nomenclature SPARQL search."""
    vocabulary: str = "nomenclature"
    uri: str = ""
    external_id: str = ""
    preferred_term: str = ""
    scope_note: Optional[str] = None
    broader_term: Optional[str] = None
    hierarchy_path: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "vocabulary": self.vocabulary,
            "external_id": self.external_id,
            "external_uri": self.uri,
            "preferred_term": self.preferred_term,
            "scope_note": self.scope_note,
            "broader_term": self.broader_term,
            "hierarchy_path": self.hierarchy_path,
        }


def _escape_query(query: str) -> str:
    """Escape special characters for SPARQL REGEX."""
    escaped = re.escape(query)
    escaped = escaped.replace("\\ ", " ")
    escaped = escaped.replace('"', '\\"').replace("'", "\\'")
    return escaped


def _execute_sparql(sparql: str) -> list[dict]:
    """Execute SPARQL query against Nomenclature endpoint."""
    try:
        response = requests.post(
            NOMENCLATURE_SPARQL_ENDPOINT,
            data={"query": sparql},
            headers={
                "Accept": "application/sparql-results+json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            timeout=NOMENCLATURE_TIMEOUT,
        )

        if response.status_code != 200 or not response.text:
            logger.warning("Nomenclature SPARQL failed: status=%d", response.status_code)
            return []

        data = response.json()
        return data.get("results", {}).get("bindings", [])

    except requests.Timeout:
        logger.warning("Nomenclature SPARQL timeout after %ds", NOMENCLATURE_TIMEOUT)
        return []
    except Exception as e:
        logger.warning("Nomenclature SPARQL error: %s", e)
        return []


def _get_value(binding: dict, key: str) -> Optional[str]:
    """Safely extract value from SPARQL binding."""
    field = binding.get(key)
    if not field:
        return None
    val = field.get("value")
    return val.strip() if val and val.strip() else None


def search_nomenclature(
    query: str,
    limit: int = 20,
) -> list[NomenclatureSearchResult]:
    """
    Search Nomenclature 4.0 for object classification terms.

    Live query against the CHIN SPARQL endpoint. Returns terms with
    their broader parent and scope note.

    Args:
        query: Search term (e.g., "coat", "spinning wheel", "spectroscope")
        limit: Maximum results (default 20)

    Returns:
        List of NomenclatureSearchResult
    """
    safe_query = _escape_query(query)

    sparql = f"""PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT DISTINCT ?id ?label ?broaderLabel ?scopeNote WHERE {{
    ?id a skos:Concept ;
        skos:prefLabel ?label .
    OPTIONAL {{
        ?id skos:broader/skos:prefLabel ?broaderLabel .
        FILTER(LANG(?broaderLabel) = "en")
    }}
    OPTIONAL {{
        ?id skos:scopeNote ?scopeNote .
        FILTER(LANG(?scopeNote) = "en")
    }}
    FILTER(LANG(?label) = "en")
    FILTER(REGEX(STR(?id), "{URI_PREFIX}[0-9]+$"))
    FILTER(REGEX(?label, "{safe_query}", "i"))
}}
ORDER BY ?label
LIMIT {limit}"""

    bindings = _execute_sparql(sparql)
    results = []
    seen_uris = set()

    for binding in bindings:
        uri = _get_value(binding, "id")
        label = _get_value(binding, "label")

        if not uri or not label or uri in seen_uris:
            continue
        seen_uris.add(uri)

        external_id = uri.rsplit("/", 1)[-1]

        results.append(NomenclatureSearchResult(
            uri=uri,
            external_id=external_id,
            preferred_term=label,
            scope_note=_get_value(binding, "scopeNote"),
            broader_term=_get_value(binding, "broaderLabel"),
        ))

    return results


def get_nomenclature_hierarchy(external_id: str) -> Optional[NomenclatureSearchResult]:
    """
    Fetch a single Nomenclature concept with its full hierarchy path.

    Used when caching a selected term — fetches the broader chain to
    build the complete path (e.g., "Category 03 | Clothing | coat | cutaway coat").

    Args:
        external_id: Nomenclature numeric ID

    Returns:
        NomenclatureSearchResult with hierarchy_path populated, or None
    """
    uri = f"{URI_PREFIX}{external_id}"

    # Get the concept with all ancestors via transitive broader
    sparql = f"""PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?label ?broaderLabel ?ancestorLabel WHERE {{
    <{uri}> skos:prefLabel ?label .
    FILTER(LANG(?label) = "en")
    OPTIONAL {{
        <{uri}> skos:broader/skos:prefLabel ?broaderLabel .
        FILTER(LANG(?broaderLabel) = "en")
    }}
    OPTIONAL {{
        <{uri}> skos:broader+ ?ancestor .
        ?ancestor skos:prefLabel ?ancestorLabel .
        FILTER(LANG(?ancestorLabel) = "en")
        FILTER(REGEX(STR(?ancestor), "{URI_PREFIX}[0-9]+$"))
    }}
}}"""

    bindings = _execute_sparql(sparql)
    if not bindings:
        return None

    label = _get_value(bindings[0], "label")
    broader = _get_value(bindings[0], "broaderLabel")

    # Collect all ancestors for hierarchy path
    ancestors = set()
    for b in bindings:
        anc = _get_value(b, "ancestorLabel")
        if anc:
            ancestors.add(anc)

    # Build hierarchy path (rough — ancestors aren't ordered, but gives context)
    hierarchy_path = None
    if ancestors:
        # Put broader first, then other ancestors, then self
        path_parts = sorted(ancestors)
        path_parts.append(label)
        hierarchy_path = " | ".join(path_parts)

    return NomenclatureSearchResult(
        uri=uri,
        external_id=external_id,
        preferred_term=label,
        broader_term=broader,
        hierarchy_path=hierarchy_path,
    )
