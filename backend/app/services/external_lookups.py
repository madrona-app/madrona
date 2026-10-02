"""
External ID Lookup Services.

Provides enrichment capabilities by looking up entities in external authority files:
- ULAN (Union List of Artist Names) - Getty
- Wikidata - Wikimedia
- GeoNames - Geographic database
- VIAF (Virtual International Authority File)
- AAT (Art & Architecture Thesaurus) - Getty

USAGE:
    from app.services.external_lookups import (
        lookup_ulan,
        lookup_wikidata,
        lookup_geonames,
        enrich_agent_identifiers,
        enrich_place_identifiers,
    )

    # Lookup an artist by name
    ulan_result = lookup_ulan("Vincent van Gogh")
    # Returns: {"ulan_id": "500115588", "name": "Gogh, Vincent van", ...}

    # Enrich an agent record with external IDs
    enriched = enrich_agent_identifiers(agent_record)

NOTE: External APIs may have rate limits and require API keys.
Configure via environment variables:
- WIKIDATA_USER_AGENT: User agent for Wikidata API (required by ToS)
- GEONAMES_USERNAME: GeoNames API username
"""

import logging
import os
import re
from functools import lru_cache
from typing import Any
from urllib.parse import quote_plus

import requests

logger = logging.getLogger(__name__)

# =============================================================================
# CONFIGURATION
# =============================================================================

# Request timeout in seconds
DEFAULT_TIMEOUT = 10

# User agent for Wikidata (required by their ToS)
def _wikidata_user_agent() -> str:
    """WIKIDATA_USER_AGENT if set, otherwise this deployment's own identity."""
    from app.services.deployment_identity import outbound_user_agent

    return os.getenv("WIKIDATA_USER_AGENT") or outbound_user_agent()

# GeoNames username
GEONAMES_USERNAME = os.getenv("GEONAMES_USERNAME", "demo")


# =============================================================================
# RESULT CLASSES
# =============================================================================

class ExternalLookupResult:
    """Base result class for external lookups."""

    def __init__(
        self,
        source: str,
        identifier: str | None = None,
        label: str | None = None,
        uri: str | None = None,
        data: dict[str, Any] | None = None,
        confidence: float = 1.0,
        error: str | None = None,
    ):
        self.source = source
        self.identifier = identifier
        self.label = label
        self.uri = uri
        self.data = data or {}
        self.confidence = confidence
        self.error = error

    @property
    def found(self) -> bool:
        return self.identifier is not None

    def to_dict(self) -> dict[str, Any]:
        result = {"source": self.source}
        if self.identifier:
            result["identifier"] = self.identifier
        if self.label:
            result["label"] = self.label
        if self.uri:
            result["uri"] = self.uri
        if self.data:
            result["data"] = self.data
        if self.confidence < 1.0:
            result["confidence"] = self.confidence
        if self.error:
            result["error"] = self.error
        return result


# =============================================================================
# ULAN (UNION LIST OF ARTIST NAMES) - GETTY
# =============================================================================

ULAN_SPARQL_ENDPOINT = "http://vocab.getty.edu/sparql"

ULAN_SEARCH_QUERY = """
PREFIX gvp: <http://vocab.getty.edu/ontology#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX schema: <http://schema.org/>

SELECT ?subject ?prefLabel ?birthDate ?deathDate ?nationality
WHERE {
  ?subject a gvp:PersonConcept ;
           skos:prefLabel ?prefLabel ;
           gvp:prefLabelGVP/gvp:term ?name .
  FILTER(LANG(?prefLabel) = "en" || LANG(?prefLabel) = "")
  FILTER(CONTAINS(LCASE(?name), LCASE("%s")))
  OPTIONAL { ?subject gvp:biographyPreferred/schema:birthDate ?birthDate }
  OPTIONAL { ?subject gvp:biographyPreferred/schema:deathDate ?deathDate }
  OPTIONAL { ?subject gvp:biographyPreferred/gvp:estStart ?nationality }
}
LIMIT 5
"""


def lookup_ulan(name: str, birth_year: int | None = None) -> ExternalLookupResult:
    """
    Look up an artist in ULAN by name.

    Args:
        name: Artist name to search for
        birth_year: Optional birth year to improve matching

    Returns:
        ExternalLookupResult with ULAN data if found
    """
    if not name or len(name) < 2:
        return ExternalLookupResult(source="ulan", error="Name too short")

    try:
        # Use SPARQL endpoint
        query = ULAN_SEARCH_QUERY % name.replace('"', '\\"')

        response = requests.get(
            ULAN_SPARQL_ENDPOINT,
            params={"query": query, "format": "json"},
            timeout=DEFAULT_TIMEOUT,
            headers={"Accept": "application/sparql-results+json"},
        )
        response.raise_for_status()

        data = response.json()
        bindings = data.get("results", {}).get("bindings", [])

        if not bindings:
            return ExternalLookupResult(source="ulan")

        # Find best match
        best_match = bindings[0]
        confidence = 0.7  # Base confidence for name match

        # If birth year provided, try to match
        if birth_year and best_match.get("birthDate"):
            match_birth = best_match["birthDate"].get("value", "")
            if str(birth_year) in match_birth:
                confidence = 0.95

        subject_uri = best_match.get("subject", {}).get("value", "")
        ulan_id = subject_uri.split("/")[-1] if subject_uri else None

        return ExternalLookupResult(
            source="ulan",
            identifier=ulan_id,
            label=best_match.get("prefLabel", {}).get("value"),
            uri=subject_uri,
            data={
                "birth_date": best_match.get("birthDate", {}).get("value"),
                "death_date": best_match.get("deathDate", {}).get("value"),
            },
            confidence=confidence,
        )

    except requests.RequestException as e:
        logger.warning(f"ULAN lookup failed for '{name}': {e}")
        return ExternalLookupResult(source="ulan", error=str(e))
    except Exception as e:
        logger.error(f"ULAN lookup error for '{name}': {e}")
        return ExternalLookupResult(source="ulan", error=str(e))


# =============================================================================
# WIKIDATA
# =============================================================================

WIKIDATA_API_URL = "https://www.wikidata.org/w/api.php"


def lookup_wikidata(
    query: str,
    entity_type: str = "item",
    language: str = "en",
) -> ExternalLookupResult:
    """
    Search Wikidata for an entity.

    Args:
        query: Search query (name, title, etc.)
        entity_type: Type filter ("item" for general, "Q5" for human)
        language: Language code for results

    Returns:
        ExternalLookupResult with Wikidata data if found
    """
    if not query or len(query) < 2:
        return ExternalLookupResult(source="wikidata", error="Query too short")

    try:
        # Use wbsearchentities API
        params = {
            "action": "wbsearchentities",
            "search": query,
            "language": language,
            "type": entity_type,
            "limit": 5,
            "format": "json",
        }

        response = requests.get(
            WIKIDATA_API_URL,
            params=params,
            timeout=DEFAULT_TIMEOUT,
            headers={"User-Agent": _wikidata_user_agent()},
        )
        response.raise_for_status()

        data = response.json()
        results = data.get("search", [])

        if not results:
            return ExternalLookupResult(source="wikidata")

        # Take first result
        best_match = results[0]
        qid = best_match.get("id")

        return ExternalLookupResult(
            source="wikidata",
            identifier=qid,
            label=best_match.get("label"),
            uri=best_match.get("concepturi"),
            data={
                "description": best_match.get("description"),
                "aliases": best_match.get("aliases", []),
            },
            confidence=0.8,  # Search results have moderate confidence
        )

    except requests.RequestException as e:
        logger.warning(f"Wikidata lookup failed for '{query}': {e}")
        return ExternalLookupResult(source="wikidata", error=str(e))
    except Exception as e:
        logger.error(f"Wikidata lookup error for '{query}': {e}")
        return ExternalLookupResult(source="wikidata", error=str(e))


def lookup_wikidata_by_id(qid: str, language: str = "en") -> ExternalLookupResult:
    """
    Get Wikidata entity by Q-ID.

    Args:
        qid: Wikidata Q-ID (e.g., "Q5582")
        language: Language code for labels

    Returns:
        ExternalLookupResult with entity data
    """
    if not qid or not qid.startswith("Q"):
        return ExternalLookupResult(source="wikidata", error="Invalid Q-ID")

    try:
        params = {
            "action": "wbgetentities",
            "ids": qid,
            "languages": language,
            "format": "json",
        }

        response = requests.get(
            WIKIDATA_API_URL,
            params=params,
            timeout=DEFAULT_TIMEOUT,
            headers={"User-Agent": _wikidata_user_agent()},
        )
        response.raise_for_status()

        data = response.json()
        entity = data.get("entities", {}).get(qid)

        if not entity or entity.get("missing"):
            return ExternalLookupResult(source="wikidata")

        labels = entity.get("labels", {})
        label = labels.get(language, {}).get("value") or list(labels.values())[0].get("value") if labels else None

        descriptions = entity.get("descriptions", {})
        description = descriptions.get(language, {}).get("value") if descriptions else None

        return ExternalLookupResult(
            source="wikidata",
            identifier=qid,
            label=label,
            uri=f"https://www.wikidata.org/wiki/{qid}",
            data={
                "description": description,
                "claims": list(entity.get("claims", {}).keys())[:10],  # First 10 property IDs
            },
            confidence=1.0,
        )

    except Exception as e:
        logger.error(f"Wikidata fetch error for '{qid}': {e}")
        return ExternalLookupResult(source="wikidata", error=str(e))


# Wikidata Q-IDs for artwork types (P31 "instance of" values)
# Includes parent classes so subclasses are also matched.
_ARTWORK_TYPE_QIDS = {
    "Q838948",    # work of art
    "Q4502142",   # visual artwork
    "Q3305213",   # painting
    "Q860861",    # sculpture
    "Q93184",     # drawing
    "Q11060274",  # print
    "Q125191",    # photograph
    "Q18573970",  # photograph (as artwork)
    "Q46337",     # mural
    "Q17514",     # watercolor painting
    "Q132137",    # icon (art)
    "Q1348059",   # relief
    "Q15328",     # tapestry
    "Q245117",    # mosaic
    "Q1278452",   # stained glass window
    "Q746549",    # engraving
    "Q18761202",  # etching (artwork)
    "Q22669857",  # pastel (artwork)
    "Q192425",    # woodcut
    "Q188451",    # lithograph
    "Q15123870",  # lithographic print
    "Q168983",    # fresco
    "Q17489160",  # triptych
    "Q1278437",   # altarpiece
    "Q2647254",   # polyptych
    "Q79218",     # installation art
}


def search_wikidata_artworks(
    query: str,
    limit: int = 10,
    language: str = "en",
) -> list[dict[str, Any]]:
    """
    Search Wikidata for artworks and return structured results with
    creator, date, and location extracted from entity claims.

    Only returns items whose P31 (instance of) matches known artwork types.

    Returns list of dicts with keys: qid, title, creator, date, location,
    description, uri.
    """
    if not query or len(query) < 2:
        return []

    try:
        # Search more candidates than requested since we'll filter by type
        search_limit = min(limit * 3, 50)

        # Step 1: search for entities
        search_resp = requests.get(
            WIKIDATA_API_URL,
            params={
                "action": "wbsearchentities",
                "search": query,
                "language": language,
                "type": "item",
                "limit": search_limit,
                "format": "json",
            },
            timeout=DEFAULT_TIMEOUT,
            headers={"User-Agent": _wikidata_user_agent()},
        )
        search_resp.raise_for_status()
        search_results = search_resp.json().get("search", [])

        if not search_results:
            return []

        # Step 2: batch-fetch entity claims for all results
        qids = [r["id"] for r in search_results if r.get("id")]
        entities_resp = requests.get(
            WIKIDATA_API_URL,
            params={
                "action": "wbgetentities",
                "ids": "|".join(qids),
                "props": "claims|labels|descriptions",
                "languages": language,
                "format": "json",
            },
            timeout=DEFAULT_TIMEOUT,
            headers={"User-Agent": _wikidata_user_agent()},
        )
        entities_resp.raise_for_status()
        entities = entities_resp.json().get("entities", {})

        # Step 3: filter to artworks only and extract structured data
        results = []
        for sr in search_results:
            if len(results) >= limit:
                break

            qid = sr.get("id")
            entity = entities.get(qid, {})
            claims = entity.get("claims", {})

            # Check P31 (instance of) — skip if not an artwork type
            if not _is_artwork(claims):
                continue

            creator = _extract_claim_label(claims, "P170", entity, language)
            location = (
                _extract_claim_label(claims, "P195", entity, language)  # collection
                or _extract_claim_label(claims, "P276", entity, language)  # location
            )
            date = _extract_claim_time(claims, "P571")  # inception
            thumbnail_url = _extract_commons_thumbnail(claims)

            results.append({
                "qid": qid,
                "title": sr.get("label", ""),
                "description": sr.get("description", ""),
                "creator": creator,
                "date": date,
                "location": location,
                "thumbnail_url": thumbnail_url,
                "uri": f"https://www.wikidata.org/wiki/{qid}",
            })

        return results

    except Exception as e:
        logger.warning(f"Wikidata artwork search failed for '{query}': {e}")
        return []


def _extract_commons_thumbnail(claims: dict, width: int = 120) -> str | None:
    """Extract a Wikimedia Commons thumbnail URL from a P18 (image) claim."""
    p18_claims = claims.get("P18", [])
    if not p18_claims:
        return None
    mainsnak = p18_claims[0].get("mainsnak", {})
    datavalue = mainsnak.get("datavalue", {})
    if datavalue.get("type") != "string":
        return None
    filename = datavalue.get("value", "")
    if not filename:
        return None
    # Wikimedia Commons Special:FilePath gives a redirect to the actual thumbnail
    safe_filename = filename.replace(" ", "_")
    return f"https://commons.wikimedia.org/wiki/Special:FilePath/{quote_plus(safe_filename)}?width={width}"


def _is_artwork(claims: dict) -> bool:
    """Check if a Wikidata entity's P31 (instance of) claims include any artwork type."""
    p31_claims = claims.get("P31", [])
    for claim in p31_claims:
        mainsnak = claim.get("mainsnak", {})
        datavalue = mainsnak.get("datavalue", {})
        if datavalue.get("type") == "wikibase-entityid":
            target_qid = datavalue.get("value", {}).get("id")
            if target_qid in _ARTWORK_TYPE_QIDS:
                return True
    return False


def _extract_claim_label(
    claims: dict, prop: str, entity: dict, language: str
) -> str | None:
    """Extract a human-readable label from a Wikidata entity claim (e.g. P170 creator)."""
    claim_list = claims.get(prop, [])
    if not claim_list:
        return None
    mainsnak = claim_list[0].get("mainsnak", {})
    datavalue = mainsnak.get("datavalue", {})
    if datavalue.get("type") == "wikibase-entityid":
        # The value is a reference to another entity — return the Q-ID
        # and we'll resolve labels below
        target_qid = datavalue.get("value", {}).get("id")
        if target_qid:
            # Try to resolve from the same batch (won't be there, different entity)
            # Fall back to a quick label lookup
            return _resolve_entity_label(target_qid, language)
    return None


def _extract_claim_time(claims: dict, prop: str) -> str | None:
    """Extract a date string from a Wikidata time claim (e.g. P571 inception)."""
    claim_list = claims.get(prop, [])
    if not claim_list:
        return None
    mainsnak = claim_list[0].get("mainsnak", {})
    datavalue = mainsnak.get("datavalue", {})
    if datavalue.get("type") == "time":
        time_str = datavalue.get("value", {}).get("time", "")
        # Wikidata format: "+1889-06-00T00:00:00Z" → extract year
        precision = datavalue.get("value", {}).get("precision", 9)
        if precision >= 9 and time_str:  # year precision or better
            year_match = re.match(r"[+-]?(\d{4})", time_str)
            if year_match:
                return year_match.group(1)
    return None


@lru_cache(maxsize=256)
def _resolve_entity_label(qid: str, language: str = "en") -> str | None:
    """Resolve a Wikidata Q-ID to its label. Cached to avoid repeated lookups."""
    try:
        resp = requests.get(
            WIKIDATA_API_URL,
            params={
                "action": "wbgetentities",
                "ids": qid,
                "props": "labels",
                "languages": language,
                "format": "json",
            },
            timeout=DEFAULT_TIMEOUT,
            headers={"User-Agent": _wikidata_user_agent()},
        )
        resp.raise_for_status()
        entity = resp.json().get("entities", {}).get(qid, {})
        labels = entity.get("labels", {})
        return labels.get(language, {}).get("value")
    except Exception:
        return None


# =============================================================================
# GEONAMES
# =============================================================================

GEONAMES_SEARCH_URL = "http://api.geonames.org/searchJSON"


def lookup_geonames(
    name: str,
    country: str | None = None,
    feature_class: str | None = None,
) -> ExternalLookupResult:
    """
    Search GeoNames for a place.

    Args:
        name: Place name to search for
        country: Optional country code (e.g., "US", "FR")
        feature_class: Optional feature class (e.g., "P" for populated place)

    Returns:
        ExternalLookupResult with GeoNames data if found
    """
    if not name or len(name) < 2:
        return ExternalLookupResult(source="geonames", error="Name too short")

    try:
        params = {
            "q": name,
            "maxRows": 5,
            "username": GEONAMES_USERNAME,
            "style": "full",
        }

        if country:
            params["country"] = country
        if feature_class:
            params["featureClass"] = feature_class

        response = requests.get(
            GEONAMES_SEARCH_URL,
            params=params,
            timeout=DEFAULT_TIMEOUT,
        )
        response.raise_for_status()

        data = response.json()
        results = data.get("geonames", [])

        if not results:
            return ExternalLookupResult(source="geonames")

        # Take first result
        best_match = results[0]
        geoname_id = str(best_match.get("geonameId"))

        return ExternalLookupResult(
            source="geonames",
            identifier=geoname_id,
            label=best_match.get("name"),
            uri=f"https://www.geonames.org/{geoname_id}",
            data={
                "country": best_match.get("countryName"),
                "country_code": best_match.get("countryCode"),
                "admin_name": best_match.get("adminName1"),
                "latitude": best_match.get("lat"),
                "longitude": best_match.get("lng"),
                "population": best_match.get("population"),
                "feature_class": best_match.get("fcl"),
                "feature_code": best_match.get("fcode"),
            },
            confidence=0.8,
        )

    except requests.RequestException as e:
        logger.warning(f"GeoNames lookup failed for '{name}': {e}")
        return ExternalLookupResult(source="geonames", error=str(e))
    except Exception as e:
        logger.error(f"GeoNames lookup error for '{name}': {e}")
        return ExternalLookupResult(source="geonames", error=str(e))


# =============================================================================
# VIAF (VIRTUAL INTERNATIONAL AUTHORITY FILE)
# =============================================================================

VIAF_SEARCH_URL = "https://viaf.org/viaf/search"
VIAF_AUTOSUGGEST_URL = "https://viaf.org/viaf/AutoSuggest"


def lookup_viaf(name: str, entity_type: str = "personal") -> ExternalLookupResult:
    """
    Search VIAF for an authority record.

    Args:
        name: Name to search for
        entity_type: Type of entity ("personal", "corporate", "geographic")

    Returns:
        ExternalLookupResult with VIAF data if found
    """
    if not name or len(name) < 2:
        return ExternalLookupResult(source="viaf", error="Name too short")

    try:
        # Use autosuggest API for simpler results
        response = requests.get(
            VIAF_AUTOSUGGEST_URL,
            params={"query": name},
            timeout=DEFAULT_TIMEOUT,
            headers={"Accept": "application/json"},
        )
        response.raise_for_status()

        data = response.json()
        results = data.get("result", [])

        if not results:
            return ExternalLookupResult(source="viaf")

        # Find best match by type
        best_match = None
        for result in results:
            name_type = result.get("nametype", "").lower()
            if entity_type == "personal" and name_type == "personal":
                best_match = result
                break
            elif entity_type == "corporate" and name_type == "corporate":
                best_match = result
                break
            elif not best_match:
                best_match = result

        if not best_match:
            best_match = results[0]

        viaf_id = best_match.get("viafid")

        return ExternalLookupResult(
            source="viaf",
            identifier=viaf_id,
            label=best_match.get("term") or best_match.get("displayForm"),
            uri=f"https://viaf.org/viaf/{viaf_id}" if viaf_id else None,
            data={
                "name_type": best_match.get("nametype"),
                "source_ids": best_match.get("sourceID", []),
            },
            confidence=0.7,
        )

    except requests.RequestException as e:
        logger.warning(f"VIAF lookup failed for '{name}': {e}")
        return ExternalLookupResult(source="viaf", error=str(e))
    except Exception as e:
        logger.error(f"VIAF lookup error for '{name}': {e}")
        return ExternalLookupResult(source="viaf", error=str(e))


# =============================================================================
# ENRICHMENT FUNCTIONS
# =============================================================================

def enrich_agent_identifiers(
    record: dict[str, Any],
    sources: list[str] | None = None,
) -> tuple[dict[str, Any], list[ExternalLookupResult]]:
    """
    Enrich an agent record with external identifiers.

    Args:
        record: Agent record with properties like name, birth_date
        sources: List of sources to query (default: ["ulan", "wikidata", "viaf"])

    Returns:
        Tuple of (enriched_record, lookup_results)
    """
    if sources is None:
        sources = ["ulan", "wikidata", "viaf"]

    properties = record.get("properties", {})
    name = properties.get("name") or properties.get("display_name") or record.get("label")

    if not name:
        return record, []

    # Extract birth year if available
    birth_year = None
    birth_date = properties.get("birth_date") or properties.get("life_dates")
    if birth_date:
        year_match = re.search(r'\b(1[0-9]{3}|20[0-2][0-9])\b', str(birth_date))
        if year_match:
            birth_year = int(year_match.group(1))

    results = []
    identifiers = record.get("identifiers", [])
    existing_schemes = {i.get("scheme") for i in identifiers if isinstance(i, dict)}

    for source in sources:
        if source in existing_schemes:
            continue  # Already has this identifier

        result = None
        if source == "ulan":
            result = lookup_ulan(name, birth_year)
        elif source == "wikidata":
            result = lookup_wikidata(name)
        elif source == "viaf":
            result = lookup_viaf(name, "personal")

        if result:
            results.append(result)
            if result.found and result.confidence >= 0.7:
                identifiers.append({
                    "scheme": source,
                    "value": result.identifier,
                    "uri": result.uri,
                    "confidence": result.confidence,
                })

    if identifiers != record.get("identifiers", []):
        enriched = dict(record)
        enriched["identifiers"] = identifiers
        return enriched, results

    return record, results


def enrich_place_identifiers(
    record: dict[str, Any],
    sources: list[str] | None = None,
) -> tuple[dict[str, Any], list[ExternalLookupResult]]:
    """
    Enrich a place record with external identifiers.

    Args:
        record: Place record with properties like name, country
        sources: List of sources to query (default: ["geonames", "wikidata"])

    Returns:
        Tuple of (enriched_record, lookup_results)
    """
    if sources is None:
        sources = ["geonames", "wikidata"]

    properties = record.get("properties", {})
    name = properties.get("name") or properties.get("place_name") or record.get("label")

    if not name:
        return record, []

    country = properties.get("country_code") or properties.get("country")

    results = []
    identifiers = record.get("identifiers", [])
    existing_schemes = {i.get("scheme") for i in identifiers if isinstance(i, dict)}

    for source in sources:
        if source in existing_schemes:
            continue

        result = None
        if source == "geonames":
            result = lookup_geonames(name, country)
        elif source == "wikidata":
            result = lookup_wikidata(name)

        if result:
            results.append(result)
            if result.found and result.confidence >= 0.7:
                identifiers.append({
                    "scheme": source,
                    "value": result.identifier,
                    "uri": result.uri,
                    "confidence": result.confidence,
                })

    if identifiers != record.get("identifiers", []):
        enriched = dict(record)
        enriched["identifiers"] = identifiers
        return enriched, results

    return record, results
