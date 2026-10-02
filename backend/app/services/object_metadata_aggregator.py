"""
Object Metadata Aggregator Service.

Aggregates metadata from CollectionObject and related records into a comprehensive
JSON document for embedding in media files and search indexing.
"""

import logging
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.database import current_session
from app.models import (
    CollectionObject,
    Constituent,
    ConstituentXref,
    Location,
)

logger = logging.getLogger(__name__)


def _serialize_date(d: date | datetime | None) -> str | None:
    """Serialize a date or datetime to ISO string."""
    if d is None:
        return None
    if isinstance(d, datetime):
        return d.date().isoformat()
    return d.isoformat()


def _serialize_decimal(d: Decimal | None) -> float | None:
    """Serialize a Decimal to float."""
    if d is None:
        return None
    return float(d)


def _get_primary_title(title_links) -> str | None:
    """Extract the primary or first title from title_links relationship."""
    if not title_links:
        return None
    for t in title_links:
        if t.is_preferred or t.title_type == 'primary':
            return t.title
    # Fall back to first title
    return title_links[0].title if title_links else None


def _build_creator_from_xref(
    xref: ConstituentXref,
    constituent: Constituent,
) -> dict[str, Any]:
    """Build creator metadata from ConstituentXref link."""
    display_name = xref.display_name_override or constituent.display_name or constituent.name

    return {
        "name": constituent.name,
        "display_name": display_name,
        "role": xref.role,
        "role_qualifier": xref.role_qualifier,
        "attribution_certainty": xref.attribution_certainty,
        "ulan_id": constituent.ulan_id,
        "viaf_id": constituent.viaf_id,
        "wikidata_id": constituent.wikidata_id,
        "loc_id": constituent.loc_id,
        "nationality": constituent.nationality,
        "birth_date": constituent.birth_date_display,
        "death_date": constituent.death_date_display,
    }


def _build_location_display(location: Location | None) -> dict[str, Any] | None:
    """Build safe location display info (no security-sensitive details)."""
    if not location:
        return None

    # Build hierarchy path
    path_parts = location.path.split('/') if location.path else []

    return {
        "name": location.name,
        "code": location.code,
        "path": location.path,
        "location_type": location.location_type,
        "is_on_display": location.location_type in ('gallery', 'exhibition', 'public_area'),
    }


def aggregate_object_metadata(
    object_id: str | UUID,
    org_id: str | UUID,
) -> dict[str, Any]:
    """
    Aggregate comprehensive metadata from a CollectionObject and related records.

    This function builds a JSON document containing all object metadata suitable
    for embedding in media files and search indexing. Sensitive data (valuations,
    detailed provenance, internal notes) is excluded from the result.

    Args:
        object_id: CollectionObject UUID
        org_id: Organization UUID

    Returns:
        Comprehensive metadata dictionary with structure:
        {
            "object": { ... core object data ... },
            "creators": [ ... creator records ... ],
            "dates": { ... creation dates ... },
            "subjects": { ... subject/content info ... },
            "rights": { ... public-safe rights info ... },
            "provenance": { ... public-safe provenance ... },
            "repository": { ... institution info ... },
            "aggregated_at": "ISO timestamp"
        }
    """
    obj_uuid = UUID(str(object_id)) if isinstance(object_id, str) else object_id
    org_uuid = UUID(str(org_id)) if isinstance(org_id, str) else org_id

    # Load CollectionObject with relationships
    obj = (
        current_session().execute(
            select(CollectionObject)
            .options(
                joinedload(CollectionObject.current_location),
                joinedload(CollectionObject.organization),
            )
            .where(
                CollectionObject.object_id == obj_uuid,
                CollectionObject.organization_id == org_uuid,
            )
        )
        .unique()
        .scalar_one_or_none()
    )

    if not obj:
        logger.warning("CollectionObject not found: %s", object_id)
        return {}

    # Load creator relationships via ConstituentXref
    creator_xrefs = (
        current_session().execute(
            select(ConstituentXref)
            .options(joinedload(ConstituentXref.constituent))
            .where(
                ConstituentXref.entity_type == 'collection_object',
                ConstituentXref.entity_id == obj_uuid,
                ConstituentXref.role.in_(['creator', 'maker', 'manufacturer', 'designer', 'author', 'artist']),
            )
            .order_by(ConstituentXref.display_order)
        )
        .unique()
        .scalars()
        .all()
    )

    # Build creators list from xrefs
    creators = []
    for xref in creator_xrefs:
        if xref.constituent:
            creators.append(_build_creator_from_xref(xref, xref.constituent))

    # Fall back to JSONB creators field if no links
    if not creators and obj.creators:
        for c in obj.creators:
            if isinstance(c, dict):
                creators.append({
                    "name": c.get('name'),
                    "display_name": c.get('display_name') or c.get('name'),
                    "role": c.get('role', 'creator'),
                    "role_qualifier": c.get('role_qualifier'),
                    "attribution_certainty": c.get('attribution_certainty'),
                    "ulan_id": c.get('ulan_id'),
                    "viaf_id": c.get('viaf_id'),
                    "wikidata_id": c.get('wikidata_id'),
                    "loc_id": c.get('loc_id'),
                    "nationality": c.get('nationality'),
                    "birth_date": c.get('birth_date'),
                    "death_date": c.get('death_date'),
                })

    # Build location info
    location_info = _build_location_display(obj.current_location)
    repository_name = obj.organization.name if obj.organization else None

    # Build the aggregated metadata structure
    metadata = {
        # Core object information
        "object": {
            "object_id": str(obj.object_id),
            "object_number": obj.object_number,
            "titles": [
                {"title": t.title, "title_type": t.title_type, "language": t.language, "is_preferred": t.is_preferred}
                for t in (obj.title_links or [])
            ],
            "primary_title": _get_primary_title(obj.title_links),
            "object_name": obj.object_name,
            "object_type": obj.object_type,
            "classifications": [
                {"term": cl.lookup_value.label if cl.lookup_value else None}
                for cl in (obj.classification_links or [])
            ] if hasattr(obj, 'classification_links') else [],
            "category": obj.category,
            "brief_description": obj.brief_description,
            "physical_description": obj.physical_description,
            "materials": obj.materials or [],
            "techniques": obj.techniques or [],
            "measurements": [
                {"dimension": m.dimension, "value": float(m.value), "unit": m.unit, "part": m.part}
                for m in (obj.measurement_links or [])
            ],
            "inscriptions": [i.content for i in (obj.inscription_links or [])],
            "edition": obj.edition,
            "copy_number": obj.copy_number,
            "style_period": obj.style_period,
        },

        # Creator information (with external authority IDs)
        "creators": creators,

        # Date information
        "dates": {
            "display": obj.creation_date_display,
            "earliest": _serialize_date(obj.creation_date_earliest),
            "latest": _serialize_date(obj.creation_date_latest),
            "creation_place": obj.creation_place,
        },

        # Subject and content
        "subjects": {
            "terms": obj.subjects or [],
            "content_description": obj.content_description,
            "depicted_people": obj.depicted_people or [],
            "depicted_places": obj.depicted_places or [],
            "depicted_events": obj.depicted_events or [],
            "depicted_objects": obj.depicted_objects or [],
            "depicted_activities": obj.depicted_activities or [],
            "depicted_concepts": obj.depicted_concepts or [],
            "style_period": obj.style_period,
        },

        # Rights (public-safe only - no detailed notes)
        "rights": {
            "copyright_status": obj.copyright_status,
            "copyright_holder": obj.copyright_holder,
            "credit_line": obj.credit_line,
            "reproduction_rights": obj.reproduction_rights,
            # Note: copyright_note excluded as may contain internal details
        },

        # Provenance (public-safe summary only)
        "provenance": {
            # Note: Full provenance text excluded - may contain private sale info
            "acquisition_method": obj.acquisition_method,
            "acquisition_date": _serialize_date(obj.acquisition_date),
            # Note: acquisition_source, acquisition_cost excluded for privacy
        },

        # Repository information
        "repository": {
            "name": repository_name,
            "location": location_info,
        },

        # Metadata timestamp
        "aggregated_at": datetime.now(timezone.utc).isoformat(),
    }

    return metadata


def get_safe_metadata_for_embedding(metadata: dict[str, Any]) -> dict[str, Any]:
    """
    Extract only the fields safe for embedding in image files.

    This is a subset of the full aggregated metadata, excluding any potentially
    sensitive information that should not be publicly distributed with image files.

    Args:
        metadata: Full aggregated metadata from aggregate_object_metadata()

    Returns:
        Filtered metadata containing only public-safe fields
    """
    if not metadata:
        return {}

    obj = metadata.get('object', {})
    creators = metadata.get('creators', [])
    dates = metadata.get('dates', {})
    subjects = metadata.get('subjects', {})
    rights = metadata.get('rights', {})
    repository = metadata.get('repository', {})

    # Build safe creator names list
    creator_names = []
    for c in creators:
        name = c.get('display_name') or c.get('name')
        if name:
            creator_names.append(name)

    # Build safe subject terms list
    subject_terms = list(subjects.get('terms', []))
    for cls in obj.get('classifications', []):
        if isinstance(cls, dict) and cls.get('term'):
            subject_terms.append(cls['term'])
        elif isinstance(cls, str):
            subject_terms.append(cls)

    return {
        # Identification
        "object_number": obj.get('object_number'),
        "title": obj.get('primary_title'),
        "titles": obj.get('titles', []),

        # Creators
        "creators": creator_names,

        # Description
        "description": obj.get('brief_description'),
        "object_type": obj.get('object_type'),
        "materials": [m.get('term') for m in obj.get('materials', []) if isinstance(m, dict) and m.get('term')],
        "techniques": [t.get('term') for t in obj.get('techniques', []) if isinstance(t, dict) and t.get('term')],

        # Dates
        "date_display": dates.get('display'),
        "creation_place": dates.get('creation_place'),

        # Subjects
        "subjects": subject_terms,

        # Rights (all public-safe)
        "copyright_status": rights.get('copyright_status'),
        "credit_line": rights.get('credit_line'),
        "reproduction_rights": rights.get('reproduction_rights'),

        # Repository
        "repository_name": repository.get('name'),

        # Timestamp
        "metadata_date": metadata.get('aggregated_at'),
    }
