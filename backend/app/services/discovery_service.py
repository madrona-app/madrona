"""
Shared discovery/public-facing helper functions.

Extracted from discover_public router so that mcp_server and other
consumers can use them without cross-router private imports.
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from app.models import (
    CollectionObject,
    Media,
    MediaDerivative,
    Organization,
)
from app.services.uploads import get_org_media_url


def get_media_url(media_id, organization_id: UUID, db: Session) -> str | None:
    """Get a signed URL for a published media item."""
    if not media_id:
        return None
    media = db.query(Media).filter(
        Media.media_id == media_id,
        Media.is_published == True,  # noqa: E712
    ).first()
    if not media or not media.s3_key:
        return None
    try:
        return get_org_media_url(
            media.s3_key,
            organization_id=str(organization_id),
            db_session=db,
            expiry_seconds=3600,
        )
    except Exception:
        return None


def build_srcset_for_media(media_id: UUID, organization_id: UUID, db: Session) -> dict | None:
    """Build a srcset dict of derivative URLs for responsive images."""
    derivatives = (
        db.query(MediaDerivative)
        .filter(
            MediaDerivative.media_id == media_id,
            MediaDerivative.derivative_type.in_(["thumbnail", "small", "medium", "large"]),
            MediaDerivative.format.in_(["webp", "jpeg"]),
        )
        .order_by(MediaDerivative.width.asc())
        .all()
    )
    if not derivatives:
        return None

    result: dict[str, list[dict]] = {}
    org_id_str = str(organization_id)
    for d in derivatives:
        try:
            url = get_org_media_url(d.s3_key, organization_id=org_id_str, db_session=db, expiry_seconds=3600)
            result.setdefault(d.format, []).append({"url": url, "width": d.width, "height": d.height})
        except Exception:
            pass
    return result if result else None


def build_display_key_for_media(media, db: Session) -> str | None:
    """The key Discover should serve an image from — a rendition, never the master.

    Discover used to mint `Media.s3_key` directly. That is the uploaded
    original, so a public object page handed every visitor a full-resolution
    download of every image, regardless of the asset's rights or the
    organization's download settings — the same leak `_display_key_for_image`
    was introduced to close for the authenticated media routes. It also put
    multi-megabyte files into thumbnail-sized slots.

    Returns None when the media has no rendition at all, and callers then omit
    the image rather than substituting the master.
    """
    from app.serializers.media import _display_key_for_image

    return _display_key_for_image(media, db)


def get_display_title(title_links) -> str | None:
    """Extract the preferred display title from a list of title links."""
    if not title_links:
        return None
    preferred = next((t for t in title_links if t.is_preferred), None)
    if preferred:
        return preferred.title
    return title_links[0].title if title_links else None


def extract_creators_list(creators) -> list[str]:
    """Extract a flat list of creator name strings."""
    if not creators:
        return []
    result = []
    for c in creators:
        if isinstance(c, dict):
            name = c.get("value") or c.get("name")
            if name:
                result.append(name)
        elif isinstance(c, str) and c.strip():
            result.append(c.strip())
    return result


def get_primary_classification(obj) -> str | None:
    """Get the primary classification label for a collection object."""
    if hasattr(obj, 'classification_links') and obj.classification_links:
        first = obj.classification_links[0]
        if first.lookup_value:
            return first.lookup_value.label
    return None


def serialize_classifications(obj) -> list[dict]:
    """Serialize all classification links to a list of term dicts."""
    if not hasattr(obj, 'classification_links') or not obj.classification_links:
        return []
    return [
        {"term": cl.lookup_value.label if cl.lookup_value else None}
        for cl in obj.classification_links
    ]


def resolve_discover_object(db: Session, org: Organization, identifier: str) -> CollectionObject | None:
    """Look up a discoverable object by UUID or object_number."""
    try:
        obj_uuid = UUID(identifier)
        obj = db.query(CollectionObject).filter(
            CollectionObject.object_id == obj_uuid,
            CollectionObject.organization_id == org.organization_id,
            CollectionObject.is_discoverable == True,  # noqa: E712
        ).first()
        if obj:
            return obj
    except ValueError:
        pass

    return db.query(CollectionObject).filter(
        CollectionObject.organization_id == org.organization_id,
        CollectionObject.object_number == identifier,
        CollectionObject.is_discoverable == True,  # noqa: E712
    ).first()


def build_related_should_clauses(obj, relationship_type: str = "all") -> list[dict]:
    """Build OpenSearch 'should' clauses for related object queries."""
    should_clauses = []

    if relationship_type in ("all", "same_artist"):
        creator_names = extract_creators_list(obj.creators)
        for name in creator_names[:3]:
            should_clauses.append({
                "nested": {
                    "path": "creators",
                    "query": {
                        "term": {"creators.name.keyword": {"value": name, "boost": 3.0}}
                    }
                }
            })

    if relationship_type in ("all", "same_period") and obj.style_period:
        should_clauses.append({
            "term": {"style_period": {"value": obj.style_period, "boost": 2.5}}
        })

    if relationship_type in ("all",):
        primary_classification = get_primary_classification(obj)
        if primary_classification:
            should_clauses.append({
                "term": {"classification": {"value": primary_classification, "boost": 2.0}}
            })

    if relationship_type in ("all", "same_place") and obj.creation_place:
        should_clauses.append({
            "term": {"creation_place.keyword": {"value": obj.creation_place, "boost": 1.5}}
        })

    if relationship_type in ("all", "same_materials") and obj.materials:
        for mat in obj.materials[:3]:
            mat_name = mat.get("value") or mat.get("name") if isinstance(mat, dict) else str(mat)
            if mat_name:
                should_clauses.append({
                    "nested": {
                        "path": "materials",
                        "query": {
                            "term": {"materials.name.keyword": {"value": mat_name, "boost": 1.0}}
                        }
                    }
                })

    if relationship_type in ("all",) and obj.object_type:
        should_clauses.append({
            "term": {"object_type": {"value": obj.object_type, "boost": 1.0}}
        })

    return should_clauses

def get_object_card_thumbnails(
    object_ids: list, organization_id, db: Session,
) -> dict[str, str]:
    """One small public thumbnail URL per object (published media only).

    Lean variant of the Discover srcset helper for chat object cards:
    prefers a small/thumbnail derivative, falls back to the base rendition.
    Returns {object_id_str: url}; objects without published media are absent.
    """
    from app.models import CollectionObjectMedia, Media, MediaDerivative

    if not object_ids:
        return {}

    rows = (
        db.query(
            CollectionObjectMedia.object_id,
            Media.media_id,
            Media.s3_key,
        )
        .join(Media, CollectionObjectMedia.media_id == Media.media_id)
        .filter(
            CollectionObjectMedia.object_id.in_(object_ids),
            Media.is_published == True,  # noqa: E712
        )
        .order_by(
            CollectionObjectMedia.is_primary.desc(),
            CollectionObjectMedia.sort_order,
        )
        .all()
    )

    primary: dict[str, tuple] = {}
    for row in rows:
        oid = str(row.object_id)
        if oid not in primary and row.s3_key:
            primary[oid] = (row.media_id, row.s3_key)
    if not primary:
        return {}

    derivs = (
        db.query(MediaDerivative)
        .filter(
            MediaDerivative.media_id.in_([mid for mid, _ in primary.values()]),
            MediaDerivative.derivative_type.in_(["small", "thumbnail"]),
            MediaDerivative.format.in_(["webp", "jpeg"]),
        )
        .order_by(MediaDerivative.width.desc())  # prefer 'small' over tiny thumbs
        .all()
    )
    best_deriv: dict = {}
    for d in derivs:
        best_deriv.setdefault(d.media_id, d.s3_key)

    org_str = str(organization_id)
    urls: dict[str, str] = {}
    for oid, (media_id, base_key) in primary.items():
        key = best_deriv.get(media_id, base_key)
        try:
            urls[oid] = get_org_media_url(
                key, organization_id=org_str, db_session=db, expiry_seconds=3600,
            )
        except Exception:
            continue
    return urls

