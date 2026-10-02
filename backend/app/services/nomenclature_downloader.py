"""
Nomenclature 4.0 downloader — fetches the full vocabulary from the
Canadian Heritage Information Network's SPARQL endpoint.

Source: https://nomenclature.info (sponsored by Canadian Heritage
Information Network, CHIN). Data is SKOS-formatted and freely queryable.

The endpoint is at:
    POST https://nomenclature.info/sparql/rest/sparql/nom
    Content-Type: application/x-www-form-urlencoded
    Accept: application/sparql-results+json

Usage:
    from app.services.nomenclature_downloader import download_and_load

    download_and_load(db_session)  # Full download + populate vocabulary_terms

    # Or fetch only (returns list of dicts, doesn't write to DB):
    from app.services.nomenclature_downloader import fetch_all_concepts
    concepts = fetch_all_concepts()
"""

from __future__ import annotations

import logging
import time
from typing import Any
from uuid import uuid4

import requests
from sqlalchemy.orm import Session

from app.models.vocabulary import VocabularyTerm

logger = logging.getLogger(__name__)

SPARQL_ENDPOINT = "https://nomenclature.info/sparql/rest/sparql/nom"
URI_PREFIX = "https://nomenclature.info/nom/"
VOCABULARY_KEY = "nomenclature"
APPLICABLE_FIELDS = ["classification", "object_type", "category"]

# SPARQL rate limiting
REQUEST_DELAY_SECONDS = 0.5
PAGE_SIZE = 500


def _run_sparql(query: str, timeout: int = 60) -> list[dict[str, Any]]:
    """Execute a SPARQL query and return the bindings list."""
    response = requests.post(
        SPARQL_ENDPOINT,
        data={"query": query},
        headers={
            "Accept": "application/sparql-results+json",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout=timeout,
    )
    response.raise_for_status()
    data = response.json()
    return data.get("results", {}).get("bindings", [])


def _binding_value(binding: dict, key: str) -> str | None:
    """Extract string value from a SPARQL binding field."""
    field = binding.get(key)
    if not field:
        return None
    val = field.get("value")
    return val.strip() if val and val.strip() else None


def count_concepts() -> int:
    """Return the total number of Nomenclature concepts."""
    query = f"""
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT (COUNT(?c) AS ?total) WHERE {{
    ?c a skos:Concept .
    FILTER(REGEX(STR(?c), "{URI_PREFIX}[0-9]+$"))
}}
"""
    bindings = _run_sparql(query)
    if not bindings:
        return 0
    return int(bindings[0]["total"]["value"])


def fetch_concepts_page(offset: int, limit: int) -> list[dict[str, Any]]:
    """Fetch a page of concepts with labels, broader relation, and scope notes."""
    query = f"""
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT ?id ?label ?broader ?broaderLabel ?scopeNote WHERE {{
    ?id a skos:Concept ;
        skos:prefLabel ?label .
    OPTIONAL {{
        ?id skos:broader ?broader .
        ?broader skos:prefLabel ?broaderLabel .
        FILTER(LANG(?broaderLabel) = "en")
    }}
    OPTIONAL {{
        ?id skos:scopeNote ?scopeNote .
        FILTER(LANG(?scopeNote) = "en")
    }}
    FILTER(LANG(?label) = "en")
    FILTER(REGEX(STR(?id), "{URI_PREFIX}[0-9]+$"))
}}
ORDER BY ?id
OFFSET {offset} LIMIT {limit}
"""
    results = []
    for binding in _run_sparql(query):
        uri = _binding_value(binding, "id")
        if not uri:
            continue
        external_id = uri.rsplit("/", 1)[-1]
        results.append({
            "external_id": external_id,
            "uri": uri,
            "label": _binding_value(binding, "label"),
            "broader_uri": _binding_value(binding, "broader"),
            "broader_label": _binding_value(binding, "broaderLabel"),
            "scope_note": _binding_value(binding, "scopeNote"),
        })
    return results


def fetch_all_concepts() -> list[dict[str, Any]]:
    """
    Fetch all Nomenclature concepts (labels + broader + scope notes).

    Pages through the SPARQL endpoint with rate limiting. Returns a list
    of dicts with external_id, uri, label, broader_uri, broader_label,
    scope_note.

    Takes ~15 minutes to fetch all 15,000+ concepts at PAGE_SIZE=500.
    """
    total = count_concepts()
    logger.info("Nomenclature total concepts: %d", total)

    all_concepts: list[dict[str, Any]] = []
    offset = 0
    page_num = 0

    while offset < total:
        page_num += 1
        try:
            page = fetch_concepts_page(offset, PAGE_SIZE)
        except requests.HTTPError as e:
            logger.warning("Page %d failed (offset=%d): %s — retrying once", page_num, offset, e)
            time.sleep(5)
            page = fetch_concepts_page(offset, PAGE_SIZE)

        if not page:
            logger.info("Empty page at offset %d — stopping", offset)
            break

        all_concepts.extend(page)
        logger.info("Page %d: fetched %d concepts (total so far: %d)",
                     page_num, len(page), len(all_concepts))

        offset += PAGE_SIZE
        time.sleep(REQUEST_DELAY_SECONDS)

    logger.info("Fetched %d Nomenclature concepts", len(all_concepts))
    return all_concepts


def load_concepts(session: Session, concepts: list[dict[str, Any]]) -> dict[str, int]:
    """
    Load Nomenclature concepts into the vocabulary_terms table.

    - organization_id=NULL (global terms)
    - vocabulary='nomenclature'
    - external_id = numeric Nomenclature ID
    - external_uri = full Nomenclature URI
    - Two-pass: insert all concepts first, then link parents

    Safe to run multiple times — matches on external_id for dedup.

    Returns: {"created": N, "updated": N, "skipped": N}
    """
    stats = {"created": 0, "updated": 0, "skipped": 0}
    uri_to_term_id: dict[str, Any] = {}

    # Pre-load existing terms
    existing_terms = {
        t.external_id: t
        for t in session.query(VocabularyTerm).filter(
            VocabularyTerm.vocabulary == VOCABULARY_KEY,
            VocabularyTerm.organization_id.is_(None),
        ).all()
    }

    # Pass 1: create or update all concepts
    for concept in concepts:
        external_id = concept["external_id"]
        label = concept.get("label")
        if not external_id or not label:
            stats["skipped"] += 1
            continue

        existing = existing_terms.get(external_id)
        if existing:
            changed = False
            if existing.preferred_term != label:
                existing.preferred_term = label
                changed = True
            scope = concept.get("scope_note")
            if scope and existing.scope_note != scope:
                existing.scope_note = scope
                changed = True
            broader = concept.get("broader_label")
            if broader and existing.broader_term != broader:
                existing.broader_term = broader
                changed = True
            existing.external_uri = concept.get("uri")
            uri_to_term_id[concept["uri"]] = existing.term_id
            if changed:
                stats["updated"] += 1
            else:
                stats["skipped"] += 1
            continue

        term = VocabularyTerm(
            term_id=uuid4(),
            organization_id=None,
            vocabulary=VOCABULARY_KEY,
            external_id=external_id,
            external_uri=concept.get("uri"),
            preferred_term=label,
            scope_note=concept.get("scope_note"),
            broader_term=concept.get("broader_label"),
            applicable_fields=APPLICABLE_FIELDS,
            status="active",
            is_custom=False,
        )
        session.add(term)
        session.flush()
        uri_to_term_id[concept["uri"]] = term.term_id
        stats["created"] += 1

    # Pass 2: link parent_id
    for concept in concepts:
        broader_uri = concept.get("broader_uri")
        if not broader_uri:
            continue
        term_uuid = uri_to_term_id.get(concept["uri"])
        parent_uuid = uri_to_term_id.get(broader_uri)
        if term_uuid and parent_uuid:
            term = session.query(VocabularyTerm).filter(
                VocabularyTerm.term_id == term_uuid
            ).first()
            if term and term.parent_id != parent_uuid:
                term.parent_id = parent_uuid

    session.commit()

    # Pass 3: compute hierarchy paths (walking from root down)
    _compute_hierarchy_paths(session)

    logger.info(
        "Nomenclature load complete: created=%d updated=%d skipped=%d",
        stats["created"], stats["updated"], stats["skipped"],
    )
    return stats


def _compute_hierarchy_paths(session: Session) -> int:
    """
    Walk the parent chain for each Nomenclature term and build hierarchy_path.

    Example: "Personal Artifact | Clothing | Outerwear | Coat"
    Returns the number of terms updated.
    """
    all_terms = session.query(VocabularyTerm).filter(
        VocabularyTerm.vocabulary == VOCABULARY_KEY,
        VocabularyTerm.organization_id.is_(None),
    ).all()
    term_by_id = {t.term_id: t for t in all_terms}

    updated = 0
    for term in all_terms:
        path_parts = [term.preferred_term]
        cursor = term.parent_id
        visited = {term.term_id}
        while cursor and cursor not in visited:
            parent = term_by_id.get(cursor)
            if not parent:
                break
            path_parts.insert(0, parent.preferred_term)
            visited.add(cursor)
            cursor = parent.parent_id

        new_path = " | ".join(path_parts)
        if term.hierarchy_path != new_path:
            term.hierarchy_path = new_path
            updated += 1

    session.commit()
    logger.info("Updated hierarchy_path on %d Nomenclature terms", updated)
    return updated


def download_and_load(session: Session) -> dict[str, int]:
    """
    Download the full Nomenclature vocabulary and load into vocabulary_terms.

    This is the main entry point. Takes ~15 minutes.
    """
    concepts = fetch_all_concepts()
    return load_concepts(session, concepts)
