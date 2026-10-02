"""
Media Search Document Transformer.

Transforms Media models to OpenSearch documents.
"""

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import joinedload, object_session

from app.database import current_session
from app.models import Media, MediaAITag, CollectionObjectMedia


def _get_session(media: Media):
    """Get the session for a media object, preferring the object's own session."""
    session = object_session(media)
    if session is not None:
        return session
    return current_session()


def _get_linked_objects(media: Media) -> list[dict[str, Any]]:
    """
    Get linked CollectionObject data for a media item.

    Returns list of objects with key searchable fields.
    """
    try:
        session = _get_session(media)
        links = (
            session.execute(
                select(CollectionObjectMedia)
                .options(joinedload(CollectionObjectMedia.object))
                .where(CollectionObjectMedia.media_id == media.media_id)
            )
            .scalars()
            .all()
        )

        linked_objects = []
        for link in links:
            obj = link.object
            if not obj:
                continue

            # Extract title from title_links relationship
            title = None
            if obj.title_links and len(obj.title_links) > 0:
                title = obj.title_links[0].title

            # Extract creator from creators array
            creator = None
            if obj.creators and len(obj.creators) > 0:
                creator_names = []
                for c in obj.creators:
                    if isinstance(c, dict):
                        name = c.get('name')
                        if name:
                            creator_names.append(name)
                    else:
                        creator_names.append(str(c))
                creator = "; ".join(creator_names) if creator_names else None

            linked_objects.append({
                "object_id": str(obj.object_id),
                "object_number": obj.object_number,
                "title": title,
                "object_type": getattr(obj, 'object_type', None),
                "object_name": getattr(obj, 'object_name', None),
                "medium": getattr(obj, 'medium', None),
                "creator": creator,
                "creation_date": getattr(obj, 'creation_date_display', None),
                "credit_line": getattr(obj, 'credit_line', None),
            })

        return linked_objects
    except Exception:
        # Don't fail indexing if linked objects can't be loaded
        return []


def transform_media_to_document(media: Media) -> dict[str, Any]:
    """
    Transform a Media object to an OpenSearch document.

    Args:
        media: Media model instance

    Returns:
        Dictionary ready for indexing in OpenSearch
    """
    # Build structured tags from MediaTag relationships
    structured_tags = []
    if hasattr(media, 'structured_tags') and media.structured_tags:
        for tag in media.structured_tags:
            if tag.definition and tag.definition.is_active:
                structured_tags.append({
                    "key": tag.definition.tag_key,
                    "value": tag.tag_value,
                    "value_text": tag.tag_value,  # For full-text search
                })

    doc = {
        # Identity
        "media_id": str(media.media_id),
        "organization_id": str(media.organization_id),

        # File info
        "filename": media.filename,
        "file_size": media.file_size,
        "mime_type": media.mime_type,
        "media_type": media.media_type,

        # Dimensions
        "width": media.width,
        "height": media.height,
        "duration_seconds": media.duration_seconds,

        # Descriptive metadata
        "title": media.title,
        "description": media.description,
        "alt_text": media.alt_text,

        # Attribution
        "creator": media.creator,
        "credit": media.credit,
        "source": media.source,

        # Rights
        "copyright_status": media.copyright_status,
        "license": media.license,
        "rights_statement": media.rights_statement,

        # Organization
        "folder": media.folder,
        "structured_tags": structured_tags,

        # Status
        "processing_status": media.processing_status,
        "ai_processing_status": getattr(media, 'ai_processing_status', None),
        "is_published": getattr(media, 'is_published', False),

        # Dates
        "date_created": media.date_created.isoformat() if media.date_created else None,
        "created_at": media.created_at.isoformat() if media.created_at else None,
        "updated_at": media.updated_at.isoformat() if media.updated_at else None,
        "published_at": media.published_at.isoformat() if getattr(media, 'published_at', None) else None,

        # Extended metadata
        "technical_metadata": getattr(media, 'technical_metadata', None),
        "iptc_metadata": getattr(media, 'iptc_metadata', None),
        "dublin_core": getattr(media, 'dublin_core', None),

        # Derivative info
        "has_derivatives": bool(media.thumbnail_s3_key),
        "derivative_count": len(media.derivatives) if hasattr(media, 'derivatives') and media.derivatives else 0,

        # Index timestamp
        "indexed_at": datetime.now(timezone.utc).isoformat(),

        # Transcript (Whisper)
        "transcript": getattr(media, 'transcript', None),

        # Color extraction
        "dominant_colors": getattr(media, 'dominant_colors', None),
        "color_key": getattr(media, 'color_key', None),
    }

    # Add OCR text from extra_metadata
    extra_metadata = getattr(media, 'extra_metadata', None) or {}
    if extra_metadata.get('ocr_text'):
        doc["ocr_text"] = extra_metadata['ocr_text']
    if extra_metadata.get('extracted_text'):
        doc["extracted_text"] = extra_metadata['extracted_text']

    # Add AI-detected tags for searchability
    try:
        session = _get_session(media)
        ai_tags = session.query(MediaAITag.tag_value).filter(
            MediaAITag.media_id == media.media_id,
            MediaAITag.tag_type == 'label',
        ).all()
        if ai_tags:
            doc["ai_tags"] = " ".join(tag.tag_value for tag in ai_tags)
    except Exception:
        pass  # Don't fail indexing if AI tags can't be loaded

    # Add linked collection object data for searchability
    linked_objects = _get_linked_objects(media)
    if linked_objects:
        doc["linked_objects"] = linked_objects
        # Flatten key fields for easier text search
        doc["linked_object_numbers"] = " ".join(
            obj["object_number"] for obj in linked_objects if obj.get("object_number")
        )
        doc["linked_object_titles"] = " ".join(
            obj["title"] for obj in linked_objects if obj.get("title")
        )
        doc["linked_object_creators"] = " ".join(
            obj["creator"] for obj in linked_objects if obj.get("creator")
        )
        # Object type, name, and medium for classification searches (e.g. "painting", "oil on canvas")
        type_name_parts = []
        medium_parts = []
        for obj in linked_objects:
            if obj.get("object_type"):
                type_name_parts.append(obj["object_type"])
            if obj.get("object_name"):
                type_name_parts.append(obj["object_name"])
            if obj.get("medium"):
                medium_parts.append(obj["medium"])
        if type_name_parts:
            doc["linked_object_types"] = " ".join(type_name_parts)
        if medium_parts:
            doc["linked_object_media"] = " ".join(medium_parts)

    # Add inherited metadata from linked objects (denormalized for richer search)
    inherited_metadata = getattr(media, 'inherited_metadata', None)
    if inherited_metadata:
        doc["inherited_metadata"] = inherited_metadata
        doc["inherited_metadata_updated_at"] = (
            media.inherited_metadata_updated_at.isoformat()
            if getattr(media, 'inherited_metadata_updated_at', None)
            else None
        )

        # Extract additional searchable fields from inherited metadata
        inherited_objects = inherited_metadata.get('linked_objects', [])
        if inherited_objects:
            # Collect subjects from all linked objects
            all_subjects = []
            all_materials = []
            all_techniques = []
            all_depicted_places = []

            for obj_meta in inherited_objects:
                obj_data = obj_meta.get('object', {})
                subjects_data = obj_meta.get('subjects', {})

                # Subjects
                all_subjects.extend(subjects_data.get('terms', []))

                # Materials and techniques
                for mat in obj_data.get('materials', []):
                    if isinstance(mat, dict) and mat.get('term'):
                        all_materials.append(mat['term'])
                for tech in obj_data.get('techniques', []):
                    if isinstance(tech, dict) and tech.get('term'):
                        all_techniques.append(tech['term'])

                # Depicted places
                for place in subjects_data.get('depicted_places', []):
                    if isinstance(place, dict) and place.get('name'):
                        all_depicted_places.append(place['name'])

            # Add flattened searchable fields
            if all_subjects:
                doc["inherited_subjects"] = " ".join(all_subjects)
            if all_materials:
                doc["inherited_materials"] = " ".join(all_materials)
            if all_techniques:
                doc["inherited_techniques"] = " ".join(all_techniques)
            if all_depicted_places:
                doc["inherited_depicted_places"] = " ".join(all_depicted_places)

    return doc
