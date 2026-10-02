"""
Autocomplete API — FastAPI router.

5 routes for authority-aware autocomplete:
- Search (local + external Getty/Wikidata)
- Recent values
- Popular values
- Resolve reference (stub)
- Record selection
"""

import logging
import json
import time
import concurrent.futures
from typing import Optional
from uuid import UUID

import requests as http_requests
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth
from app.fastapi_app.schemas.misc import AutocompleteSearchBody, SelectSuggestionBody
from app.services.api_security import escape_ilike, sanitize_error_message
from app.services.redis_client import get_redis_client
from app.fastapi_app.schemas.autocomplete import AutocompleteSearchResponse, AutocompleteSuggestionOut

logger = logging.getLogger(__name__)

router = APIRouter(tags=["autocomplete"])


# =============================================================================
# External Service Clients
# =============================================================================

EXTERNAL_TIMEOUT = 5.0
CACHE_TTL_SECONDS = 900


def _get_cached(cache_key: str) -> Optional[list]:
    """Get cached results from Redis."""
    try:
        redis = get_redis_client()
        if not redis.is_available():
            return None
        data = redis.client.get(f"autocomplete:{cache_key}")
        if data:
            result = json.loads(data)
            logger.debug("Cache HIT for %s: %d results", cache_key, len(result))
            return result
        logger.debug("Cache MISS for %s", cache_key)
    except Exception as e:
        logger.warning("Cache read error: %s", e)
    return None


def _set_cached(cache_key: str, results: list) -> None:
    """Store results in Redis cache."""
    try:
        redis = get_redis_client()
        if not redis.is_available():
            return
        redis.client.setex(
            f"autocomplete:{cache_key}",
            CACHE_TTL_SECONDS,
            json.dumps(results),
        )
    except Exception as e:
        logger.debug(f"Cache write failed: {e}")


def search_getty_ulan(query: str, limit: int = 5) -> list:
    """Search Getty ULAN for person names using Lucene full-text search."""
    try:
        safe_query = query.replace('"', '\\"').replace("'", "\\'")
        sparql_query = f"""PREFIX xl: <http://www.w3.org/2008/05/skos-xl#>
PREFIX gvp: <http://vocab.getty.edu/ontology#>
PREFIX luc: <http://www.ontotext.com/owlim/lucene#>

SELECT DISTINCT ?uri ?label ?nationality
WHERE {{
    ?uri luc:term "{safe_query}" ;
         a gvp:Subject ;
         xl:prefLabel/xl:literalForm ?label .
    FILTER(STRSTARTS(STR(?uri), "http://vocab.getty.edu/ulan/"))
    OPTIONAL {{
        ?uri gvp:nationalityPreferred/gvp:prefLabelGVP/xl:literalForm ?nationality .
    }}
}}
LIMIT {limit}"""

        response = http_requests.get(
            "http://vocab.getty.edu/sparql",
            params={"query": sparql_query, "format": "json"},
            timeout=EXTERNAL_TIMEOUT,
        )

        if response.status_code != 200 or not response.text:
            return []

        data = response.json()
        bindings = data.get("results", {}).get("bindings", [])

        results = []
        seen_uris = set()
        for binding in bindings:
            uri = binding.get("uri", {}).get("value", "")
            label = binding.get("label", {}).get("value", "")
            nationality = binding.get("nationality", {}).get("value", "")

            if uri and label and "/ulan/" in uri and uri not in seen_uris:
                seen_uris.add(uri)
                results.append({
                    "id": f"ulan-{uri.split('/')[-1]}",
                    "label": label,
                    "description": nationality if nationality else None,
                    "source": "getty",
                    "score": 0.9,
                    "reference": {
                        "uri": uri,
                        "source": "ULAN",
                        "label": label,
                        "match_confidence": "exact" if query.lower() == label.lower() else "probable",
                    },
                    "metadata": {"nationality": nationality},
                })
        return results
    except Exception as e:
        logger.warning(f"Getty ULAN search failed: {e}")
        return []


def search_getty_tgn(query: str, limit: int = 5) -> list:
    """Search Getty TGN for place names using Lucene full-text search."""
    try:
        safe_query = query.replace('"', '\\"').replace("'", "\\'")
        sparql_query = f"""PREFIX xl: <http://www.w3.org/2008/05/skos-xl#>
PREFIX gvp: <http://vocab.getty.edu/ontology#>
PREFIX luc: <http://www.ontotext.com/owlim/lucene#>

SELECT DISTINCT ?uri ?label ?parentLabel
WHERE {{
    ?uri luc:term "{safe_query}" ;
         a gvp:Subject ;
         xl:prefLabel/xl:literalForm ?label .
    FILTER(STRSTARTS(STR(?uri), "http://vocab.getty.edu/tgn/"))
    OPTIONAL {{
        ?uri gvp:broaderPreferred/xl:prefLabel/xl:literalForm ?parentLabel .
    }}
}}
LIMIT {limit}"""

        response = http_requests.get(
            "http://vocab.getty.edu/sparql",
            params={"query": sparql_query, "format": "json"},
            timeout=EXTERNAL_TIMEOUT,
        )

        if response.status_code != 200 or not response.text:
            return []

        data = response.json()
        bindings = data.get("results", {}).get("bindings", [])

        results = []
        seen_uris = set()
        for binding in bindings:
            uri = binding.get("uri", {}).get("value", "")
            label = binding.get("label", {}).get("value", "")
            parent = binding.get("parentLabel", {}).get("value", "")

            if uri and label and "/tgn/" in uri and uri not in seen_uris:
                seen_uris.add(uri)
                results.append({
                    "id": f"tgn-{uri.split('/')[-1]}",
                    "label": label,
                    "description": parent if parent else None,
                    "source": "getty",
                    "score": 0.9,
                    "reference": {
                        "uri": uri,
                        "source": "TGN",
                        "label": label,
                        "match_confidence": "exact" if query.lower() == label.lower() else "probable",
                    },
                    "metadata": {"parent": parent},
                })
        return results
    except Exception as e:
        logger.warning(f"Getty TGN search failed: {e}")
        return []


AAT_FACETS = {
    "material": "http://vocab.getty.edu/aat/300264091",
    "technique": "http://vocab.getty.edu/aat/300053001",
    "subject": "http://vocab.getty.edu/aat/300264086",
    "classification": "http://vocab.getty.edu/aat/300264092",
}


def search_getty_aat(query: str, limit: int = 5, field_type: str = None) -> list:
    """Search Getty AAT for terms using Lucene full-text search."""
    try:
        safe_query = query.replace('"', '\\"').replace("'", "\\'")

        hierarchy_filter = ""
        facet_uri = AAT_FACETS.get(field_type) if field_type else None
        if facet_uri:
            hierarchy_filter = f"""
    ?uri gvp:broaderExtended <{facet_uri}> ."""

        sparql_query = f"""PREFIX xl: <http://www.w3.org/2008/05/skos-xl#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX gvp: <http://vocab.getty.edu/ontology#>
PREFIX luc: <http://www.ontotext.com/owlim/lucene#>

SELECT DISTINCT ?uri ?label ?scopeNote
WHERE {{
    ?uri luc:term "{safe_query}" ;
         a gvp:Subject ;
         xl:prefLabel/xl:literalForm ?label .{hierarchy_filter}
    FILTER(STRSTARTS(STR(?uri), "http://vocab.getty.edu/aat/"))
    FILTER(LANG(?label) = "en" || LANG(?label) = "")
    OPTIONAL {{
        ?uri skos:scopeNote ?noteNode .
        ?noteNode <http://www.w3.org/1999/02/22-rdf-syntax-ns#value> ?scopeNote .
        FILTER(LANG(?scopeNote) = "en" || LANG(?scopeNote) = "")
    }}
}}
LIMIT {limit}"""

        response = http_requests.get(
            "http://vocab.getty.edu/sparql",
            params={"query": sparql_query, "format": "json"},
            timeout=EXTERNAL_TIMEOUT,
        )

        if response.status_code != 200 or not response.text:
            return []

        data = response.json()
        bindings = data.get("results", {}).get("bindings", [])

        results = []
        seen_uris = set()
        for binding in bindings:
            uri = binding.get("uri", {}).get("value", "")
            label = binding.get("label", {}).get("value", "")
            scope_note = binding.get("scopeNote", {}).get("value", "")

            if uri and label and "/aat/" in uri and uri not in seen_uris:
                seen_uris.add(uri)
                results.append({
                    "id": f"aat-{uri.split('/')[-1]}",
                    "label": label,
                    "description": scope_note[:100] if scope_note else None,
                    "source": "getty",
                    "score": 0.9,
                    "reference": {
                        "uri": uri,
                        "source": "AAT",
                        "label": label,
                        "match_confidence": "exact" if query.lower() == label.lower() else "probable",
                    },
                })
        return results
    except Exception as e:
        logger.warning(f"Getty AAT search failed: {e}")
        return []


def search_iconclass(query: str, limit: int = 5) -> list:
    """Search Iconclass for iconographic concepts."""
    try:
        # Step 1: search returns notation IDs only
        response = http_requests.get(
            "https://iconclass.org/api/search",
            params={"q": query, "lang": "en", "size": limit, "sort": "rank"},
            timeout=EXTERNAL_TIMEOUT,
        )
        if response.status_code != 200:
            return []

        data = response.json()
        notations = data.get("result", [])
        if not notations:
            return []

        # Step 2: fetch labels in bulk
        detail_response = http_requests.get(
            "https://iconclass.org/json",
            params=[("notation", n) for n in notations],
            timeout=EXTERNAL_TIMEOUT,
        )
        if detail_response.status_code != 200:
            return []

        details = detail_response.json().get("result", [])
        results = []
        for item in details:
            notation = item.get("n", "")
            texts = item.get("txt", {})
            label = texts.get("en", "")
            keywords = item.get("kw", {}).get("en", [])

            if notation and label:
                desc_parts = [notation]
                if keywords:
                    desc_parts.append(", ".join(keywords[:5]))
                results.append({
                    "id": f"ic-{notation}",
                    "label": label,
                    "description": " · ".join(desc_parts),
                    "source": "iconclass",
                    "score": 0.88,
                    "reference": {
                        "uri": f"https://iconclass.org/{notation}",
                        "source": "Iconclass",
                        "label": label,
                        "match_confidence": "probable",
                    },
                })
        return results
    except Exception as e:
        logger.warning(f"Iconclass search failed: {e}")
        return []


def search_nomenclature_external(query: str, limit: int = 5) -> list:
    """Search Nomenclature 4.0 via CHIN SPARQL for object classification terms."""
    try:
        from app.services.nomenclature_service import search_nomenclature

        remote_results = search_nomenclature(query, limit=limit)
        results = []
        for r in remote_results:
            results.append({
                "id": f"nom-{r.external_id}",
                "label": r.preferred_term,
                "description": r.broader_term or r.scope_note,
                "source": "nomenclature",
                "score": 0.85,
                "reference": {
                    "uri": r.uri,
                    "source": "Nomenclature",
                    "label": r.preferred_term,
                    "match_confidence": "exact" if query.lower() == r.preferred_term.lower() else "probable",
                },
            })
        return results
    except Exception as e:
        logger.warning(f"Nomenclature search failed: {e}")
        return []


def search_wikidata(query: str, limit: int = 5) -> list:
    """Search Wikidata for entities."""
    try:
        response = http_requests.get(
            "https://www.wikidata.org/w/api.php",
            params={
                "action": "wbsearchentities",
                "search": query,
                "language": "en",
                "format": "json",
                "limit": limit,
                "type": "item",
            },
            timeout=EXTERNAL_TIMEOUT,
        )

        if response.status_code != 200:
            return []

        data = response.json()
        results = []
        for item in data.get("search", []):
            qid = item.get("id", "")
            label = item.get("label", "")
            description = item.get("description", "")

            if qid and label:
                results.append({
                    "id": f"wd-{qid}",
                    "label": label,
                    "description": description[:100] if description else None,
                    "source": "wikidata",
                    "score": 0.85,
                    "reference": {
                        "uri": f"https://www.wikidata.org/entity/{qid}",
                        "source": "Wikidata",
                        "label": label,
                        "match_confidence": "probable",
                    },
                })
        return results
    except Exception as e:
        logger.warning(f"Wikidata search failed: {e}")
        return []


# =============================================================================
# Field Type Configuration
# =============================================================================

FIELD_TYPE_SOURCES = {
    "creator": ["ULAN", "Wikidata"],
    "material": ["AAT", "Wikidata"],
    "technique": ["AAT", "Wikidata"],
    "place": ["TGN", "Wikidata"],
    "subject": ["AAT", "Iconclass", "Wikidata"],
    "classification": ["AAT", "Nomenclature"],
    "organization": ["VIAF", "Wikidata"],
}


def search_external(query: str, field_type: str, limit: int) -> list:
    """Search external sources based on field type using thread pool."""
    sources = FIELD_TYPE_SOURCES.get(field_type, [])
    if not sources:
        return []

    cache_key = f"{field_type}:{query.lower()}"
    cached = _get_cached(cache_key)
    if cached is not None and len(cached) > 0:
        return cached[:limit]

    results = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = []

        if "ULAN" in sources:
            futures.append(("ULAN", executor.submit(search_getty_ulan, query, limit)))
        if "AAT" in sources:
            futures.append(("AAT", executor.submit(search_getty_aat, query, limit, field_type)))
        if "TGN" in sources:
            futures.append(("TGN", executor.submit(search_getty_tgn, query, limit)))
        if "Iconclass" in sources:
            futures.append(("Iconclass", executor.submit(search_iconclass, query, limit)))
        if "Nomenclature" in sources:
            futures.append(("Nomenclature", executor.submit(search_nomenclature_external, query, limit)))
        if "Wikidata" in sources:
            futures.append(("Wikidata", executor.submit(search_wikidata, query, limit)))

        for name, future in futures:
            try:
                result = future.result(timeout=EXTERNAL_TIMEOUT + 1)
                if isinstance(result, list):
                    results.extend(result)
            except concurrent.futures.TimeoutError:
                logger.warning("%s timed out", name)
            except Exception as e:
                logger.warning("%s failed: %s", name, e)

    results.sort(key=lambda x: x.get("score", 0), reverse=True)
    seen_labels = set()
    unique_results = []
    for r in results:
        label_lower = r["label"].lower()
        if label_lower not in seen_labels:
            seen_labels.add(label_lower)
            unique_results.append(r)

    if unique_results:
        _set_cached(cache_key, unique_results)

    return unique_results[:limit]


# =============================================================================
# Local Search
# =============================================================================


def search_local_person_authorities(db: Session, org_id: UUID, query: str, limit: int) -> list:
    """Search local person authority records for creator autocomplete."""
    from app.services.constituent_service import ConstituentService

    service = ConstituentService(db, org_id)
    results = service._search_local(query, limit)

    suggestions = []
    for r in results:
        suggestions.append({
            "id": r.id,
            "label": r.label,
            "description": r.description,
            "source": "organization",
            "score": 0.95,
            "reference": {
                "uri": r.uri,
                "source": "ULAN",
                "label": r.label,
            } if r.uri else None,
            "metadata": {
                "authority_id": str(r.authority_id) if r.authority_id else None,
                "dates": r.dates,
                "nationality": r.nationality,
            },
        })
    return suggestions


def search_local_vocabulary(db: Session, org_id: UUID, query: str, field_type: str, limit: int) -> list:
    """Search local vocabulary terms."""
    from sqlalchemy import or_
    from app.models import VocabularyTerm

    if field_type == "creator":
        return search_local_person_authorities(db, org_id, query, limit)

    vocab_map = {
        "material": "aat",
        "technique": "aat",
        "place": "tgn",
        "subject": "aat",
        "classification": "aat",
    }

    vocab = vocab_map.get(field_type)
    if not vocab:
        return []

    terms = db.query(VocabularyTerm).filter(
        or_(
            VocabularyTerm.organization_id == org_id,
            VocabularyTerm.organization_id.is_(None),
        ),
        VocabularyTerm.vocabulary == vocab,
        VocabularyTerm.preferred_term.ilike(f"%{escape_ilike(query)}%", escape="\\"),
        VocabularyTerm.status == "active",
    ).order_by(
        VocabularyTerm.usage_count.desc()
    ).limit(limit).all()

    suggestions = []
    for term in terms:
        ref = None
        if term.external_uri:
            ref = {
                "uri": term.external_uri,
                "source": term.vocabulary.upper(),
                "label": term.preferred_term,
            }

        suggestions.append({
            "id": f"vocab-{term.term_id}",
            "label": term.preferred_term,
            "description": term.scope_note[:100] if term.scope_note else None,
            "source": "vocabulary",
            "score": 0.95,
            "reference": ref,
            "metadata": {"usage_count": term.usage_count},
        })
    return suggestions


def search_recent_usage(db: Session, org_id: UUID, field_type: str, query: str, limit: int) -> list:
    """Search for values recently used in the organization."""
    from sqlalchemy import text

    field_map = {
        "creator": "creators",
        "material": "materials",
        "technique": "techniques",
        "place": "creation_place",
        "subject": "subjects",
        "classification": "classifications",
    }

    column_name = field_map.get(field_type)
    if not column_name:
        return []

    # JSONB array-of-objects columns (each element has 'value'/'name' and optional 'authorities')
    jsonb_object_columns = ("creators", "materials", "techniques", "classifications", "subjects")
    # JSONB array-of-strings columns
    jsonb_string_columns = ("depicted_concepts", "associated_concepts", "depicted_activities")

    if column_name in jsonb_object_columns:
        assert column_name.isidentifier(), f"Invalid column name: {column_name}"

        stmt = text(f"""
            SELECT DISTINCT
                COALESCE(elem->>'value', elem->>'name', elem->>'term') as label,
                elem->>'authorities' as authorities,
                COUNT(*) as usage_count
            FROM collections.collection_objects,
                 jsonb_array_elements({column_name}) as elem
            WHERE organization_id = :org_id
              AND COALESCE(elem->>'value', elem->>'name', elem->>'term') ILIKE :query
            GROUP BY label, authorities
            ORDER BY usage_count DESC
            LIMIT :limit
        """)

        result = db.execute(
            stmt,
            {"org_id": str(org_id), "query": f"%{query}%", "limit": limit},
        )
        rows = result.fetchall()

        suggestions = []
        for i, row in enumerate(rows):
            ref = None
            if row.authorities:
                try:
                    auths = json.loads(row.authorities)
                    if auths and len(auths) > 0:
                        ref = {
                            "uri": auths[0].get("uri", ""),
                            "source": auths[0].get("source", ""),
                        }
                except (json.JSONDecodeError, TypeError, KeyError, IndexError):
                    pass

            suggestions.append({
                "id": f"org-{i}",
                "label": row.label,
                "source": "organization",
                "score": 1.0 - (i * 0.01),
                "reference": ref,
                "metadata": {"usage_count": row.usage_count},
            })
        return suggestions

    return []


# =============================================================================
# Routes
# =============================================================================


@router.post("/api/autocomplete/search", response_model=AutocompleteSearchResponse, summary="Search autocomplete")
def search_autocomplete(
    body: AutocompleteSearchBody,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Authority-aware autocomplete (Getty/Wikidata/local)."""
    start_time = time.time()

    query = body.query
    if not query or len(query) > 200:
        raise HTTPException(status_code=400, detail="Query must be 1-200 characters")

    field_type = body.field_type
    if not field_type:
        raise HTTPException(status_code=400, detail="field_type is required")

    org_id = UUID(body.organization_id)
    limit = min(body.limit, 50)
    sources = body.sources or ["local", "recent", "external"]
    warnings = []

    all_suggestions = []
    external_searched = False

    if "local" in sources or "recent" in sources:
        try:
            org_results = search_recent_usage(db, org_id, field_type, query, limit)
            all_suggestions.extend(org_results)

            vocab_results = search_local_vocabulary(db, org_id, query, field_type, limit)
            all_suggestions.extend(vocab_results)
        except Exception as e:
            logger.warning(f"Local search failed: {e}")
            warnings.append("Local search partially failed")

    if "external" in sources and len(query) >= 2:
        try:
            external_results = search_external(query, field_type, limit)
            all_suggestions.extend(external_results)
            external_searched = True
        except Exception as e:
            logger.warning("External search failed: %s", e)

    seen_keys = set()
    unique_suggestions = []
    for s in sorted(all_suggestions, key=lambda x: x.get("score", 0), reverse=True):
        # Deduplicate by label + source so different authorities both appear
        source = s.get("reference", {}).get("source", s.get("source", "")) if isinstance(s.get("reference"), dict) else s.get("source", "")
        dedup_key = (s["label"].lower(), source)
        if dedup_key not in seen_keys:
            seen_keys.add(dedup_key)
            unique_suggestions.append(s)

    search_time_ms = int((time.time() - start_time) * 1000)

    debug = {
        "field_type": field_type,
        "sources_requested": sources,
        "sources_for_field": FIELD_TYPE_SOURCES.get(field_type, []),
        "query_length": len(query),
        "local_count": len([s for s in all_suggestions if s.get("source") in ("recent", "organization", "vocabulary")]),
        "external_count": len([s for s in all_suggestions if s.get("source") in ("getty", "wikidata")]),
    }

    return {
        "query": query,
        "suggestions": unique_suggestions[:limit],
        "external_searched": external_searched,
        "warnings": warnings if warnings else None,
        "search_time_ms": search_time_ms,
        "debug": debug,
    }


@router.get("/api/autocomplete/recent", response_model=list[AutocompleteSuggestionOut], summary="Get recent")
def get_recent(
    field_type: str = Query(...),
    limit: int = Query(5, ge=1, le=20),
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Recently used values for a field type."""
    org_id = auth.active_organization_id
    if not org_id:
        return []

    results = search_recent_usage(db, UUID(str(org_id)), field_type, "", limit)
    return results


@router.get("/api/autocomplete/popular", response_model=list[AutocompleteSuggestionOut], summary="Get popular")
def get_popular(
    field_type: str = Query(...),
    limit: int = Query(10, ge=1, le=50),
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Most-used values in the organization for a field type."""
    org_id = auth.active_organization_id
    if not org_id:
        return []

    results = search_recent_usage(db, UUID(str(org_id)), field_type, "", limit)
    return results


@router.post("/api/autocomplete/resolve", summary="Resolve reference")
def resolve_reference(
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Resolve a reference URI to get full details (stub)."""
    return None


@router.post("/api/autocomplete/select", summary="Select suggestion")
def select_suggestion(
    body: SelectSuggestionBody,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Record suggestion selection and cache term."""
    suggestion_id = body.suggestion_id
    label = body.label

    if not suggestion_id or not label:
        raise HTTPException(status_code=400, detail="suggestion_id and label required")

    org_id = UUID(body.organization_id) if body.organization_id else None

    parts = suggestion_id.split("-", 1)
    source_type = parts[0] if len(parts) > 1 else None
    external_id = parts[1] if len(parts) > 1 else None

    vocabulary = body.vocabulary
    if not vocabulary:
        if source_type in ("aat", "ulan", "tgn"):
            vocabulary = source_type
        elif source_type == "vocab":
            try:
                term_id = UUID(external_id)
                from app.services.vocabulary_service import VocabularyService
                vocab_service = VocabularyService(db, org_id)
                vocab_service.record_usage(term_id)
                db.commit()

                result = vocab_service.get_term_with_relationships(term_id)
                return result
            except (ValueError, TypeError):
                pass
        else:
            vocabulary = "local"

    from app.services.vocabulary_service import VocabularyService, VocabularyTermResult

    result = VocabularyTermResult(
        term_id=None,
        vocabulary=vocabulary,
        external_id=external_id,
        external_uri=body.external_uri or (
            f"http://vocab.getty.edu/{vocabulary}/{external_id}"
            if vocabulary in ("aat", "ulan", "tgn") and external_id else None
        ),
        preferred_term=label,
        alternate_terms=None,
        scope_note=body.description,
        broader_term=None,
        hierarchy_path=None,
        is_local=False,
        usage_count=0,
    )

    vocab_service = VocabularyService(db, org_id)
    term = vocab_service.cache_term_with_hierarchy(
        result,
        applicable_fields=body.applicable_fields,
        sync_hierarchy=vocabulary in ("aat", "ulan", "tgn"),
    )
    db.commit()

    term_data = vocab_service.get_term_with_relationships(term.term_id)
    return term_data
