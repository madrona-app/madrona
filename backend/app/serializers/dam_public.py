"""
Public DAM serialization functions.

Extracted from app/api/dam_public.py for use by FastAPI routers
without pulling in Flask route dependencies.
"""
from __future__ import annotations

import logging

from app.database import current_session
from app.models import (
    CollectionObject,
    CollectionObjectMedia,
    Media,
    MediaDerivative,
    MediaRights,
)
from app.services.object_metadata_aggregator import (
    aggregate_object_metadata,
    get_safe_metadata_for_embedding,
)

logger = logging.getLogger(__name__)


def serialize_public_media(
    media: Media,
    include_derivatives: bool = True,
    include_object_metadata: bool = False,
    session=None,
) -> dict:
    """
    Serialize media for public API response.

    Only includes published media with appropriate access controls.
    """
    session = current_session()

    result = {
        "id": str(media.media_id),
        "title": media.title,
        "description": media.description,
        "media_type": media.media_type,
        "mime_type": media.mime_type,
        "width": media.width,
        "height": media.height,
        "duration": media.duration_seconds,
        "file_size": media.file_size,
        "alt_text": media.alt_text,
        "attribution": media.credit,
        "created_at": media.created_at.isoformat() if media.created_at else None,
    }

    if media.dublin_core:
        result["dublin_core"] = media.dublin_core

    if media.published_url:
        result["url"] = media.published_url

    if include_derivatives:
        derivatives = session.query(MediaDerivative).filter(
            MediaDerivative.media_id == media.media_id
        ).all()

        result["derivatives"] = {
            d.derivative_type: {
                "width": d.width,
                "height": d.height,
                "format": d.format,
                "url": d.public_url if hasattr(d, 'public_url') and d.public_url else None
            }
            for d in derivatives
        }

    rights = session.query(MediaRights).filter(
        MediaRights.media_id == media.media_id,
        MediaRights.is_active == True  # noqa: E712
    ).first()

    if rights:
        result["rights"] = {
            "type": rights.rights_type,
            "holder": rights.rights_holder,
            "license": rights.license_type,
            "statement": rights.rights_statement,
        }

    if include_object_metadata:
        object_links = session.query(CollectionObjectMedia).filter(
            CollectionObjectMedia.media_id == media.media_id
        ).all()

        if object_links:
            objects_metadata = []
            for link in object_links:
                try:
                    full_metadata = aggregate_object_metadata(
                        link.object_id, media.organization_id
                    )
                    if full_metadata:
                        safe = get_safe_metadata_for_embedding(full_metadata)
                        safe["object_id"] = str(link.object_id)
                        safe["is_primary"] = link.is_primary
                        safe["caption"] = link.caption
                        safe["creators_detail"] = full_metadata.get("creators", [])
                        objects_metadata.append(safe)
                except Exception as e:
                    logger.warning("Failed to aggregate metadata for object %s: %s", link.object_id, e)

            if objects_metadata:
                result["object_metadata"] = objects_metadata

    return result


def serialize_public_object(
    obj: CollectionObject,
    include_media: bool = True,
    include_aggregated_metadata: bool = False,
    session=None,
) -> dict:
    """Serialize collection object for public API response."""
    session = current_session()

    display_title = None
    if obj.title_links:
        preferred = next((t for t in obj.title_links if t.is_preferred), None)
        display_title = preferred.title if preferred else obj.title_links[0].title

    display_classification = None
    if hasattr(obj, 'classification_links') and obj.classification_links:
        first = obj.classification_links[0]
        if first.lookup_value:
            display_classification = first.lookup_value.label

    classifications_list = [
        {"term": cl.lookup_value.label if cl.lookup_value else None}
        for cl in (obj.classification_links or [])
    ] if hasattr(obj, 'classification_links') else []

    result = {
        "id": str(obj.object_id),
        "object_number": obj.object_number,
        "title": display_title,
        "titles": [
            {"title": t.title, "title_type": t.title_type, "language": t.language, "is_preferred": t.is_preferred}
            for t in (obj.title_links or [])
        ],
        "description": obj.brief_description,
        "date_created": obj.creation_date_earliest.isoformat() if obj.creation_date_earliest else None,
        "date_created_display": obj.creation_date_display,
        "creator": (obj.creators[0].get("value") or obj.creators[0].get("name")) if obj.creators else None,
        "medium": (obj.materials[0].get("value") or obj.materials[0].get("name")) if obj.materials else None,
        "dimensions": [
            {"dimension": m.dimension, "value": float(m.value), "unit": m.unit, "part": m.part}
            for m in (obj.measurement_links or [])
        ],
        "credit_line": obj.credit_line,
        "classification": display_classification,
        "classifications": classifications_list,
        "created_at": obj.created_at.isoformat() if obj.created_at else None,
    }

    if include_media:
        media_links = session.query(CollectionObjectMedia).filter(
            CollectionObjectMedia.object_id == obj.object_id
        ).order_by(
            CollectionObjectMedia.is_primary.desc(),
            CollectionObjectMedia.sort_order
        ).all()

        published_media = []
        for link in media_links:
            media = session.query(Media).filter(
                Media.media_id == link.media_id,
                Media.is_published == True  # noqa: E712
            ).first()
            if media:
                published_media.append({
                    "media": serialize_public_media(media),
                    "is_primary": link.is_primary,
                    "caption": link.caption,
                })

        result["media"] = published_media

    if include_aggregated_metadata:
        try:
            full_metadata = aggregate_object_metadata(obj.object_id, obj.organization_id)
            if full_metadata:
                result["metadata"] = full_metadata
        except Exception as e:
            logger.warning("Failed to aggregate metadata for object %s: %s", obj.object_id, e)

    return result
