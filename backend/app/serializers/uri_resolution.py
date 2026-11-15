"""
URI resolution entity loaders and formatters.

Extracted from app/api/uri_resolution.py for use by FastAPI routers
without pulling in Flask route dependencies.
"""
from __future__ import annotations

from uuid import UUID

from app.database import current_session
from app.models import CollectionObject, Media
from app.services.uri_persistence import build_uri


# ============================================================================
# ENTITY LOADERS
# ============================================================================

def load_collection_object(
    entity_id: UUID, content_type: str, org_slug: str, *, db=None, organization_id=None,
) -> dict | None:
    """Load collection object and format based on content type.

    Anonymous: the Discover gates, and the URL's organization when given.
    """
    from app.services.discover_media import is_public_object

    db = db or current_session()
    query = db.query(CollectionObject).filter(
        CollectionObject.object_id == entity_id,
        CollectionObject.is_discoverable == True,  # noqa: E712
    )
    if organization_id is not None:
        query = query.filter(CollectionObject.organization_id == organization_id)
    obj = query.first()

    # Discover gates: also not deleted and not hidden as deaccessioned.
    if not is_public_object(obj, db, organization_id=organization_id):
        return None

    if content_type == "application/ld+json":
        return format_object_jsonld(obj, org_slug)

    return format_object_json(obj)


def load_person_authority(
    entity_id: UUID, content_type: str, org_slug: str, *, db=None, organization_id=None,
) -> dict | None:
    """A person authority, only when it is the creator of a public object.

    A constituent is any person or organization the institution deals with —
    donors, lenders, private collectors, NAGPRA contacts — and has no publish
    flag of its own. This loader used to return any constituent's biography
    and nationality to anyone holding its URI (harmless only because the
    resolver ran under the app role with no org context and found nothing).

    The public rule: an active constituent of the URL's organization, linked
    with a creator role to an object that passes the Discover gates, in an
    organization whose public field set includes creators. A donor or lender
    linked to the same object is not a creator and stays private.
    """
    if organization_id is None:
        return None
    from app.models import PersonAuthority
    from app.models.contacts import ConstituentXref
    from app.services import public_object_fields as pof
    from app.services.discover_media import public_object_clauses

    db = db or current_session()
    if not pof.is_public("creators", pof.get_public_field_keys(db, organization_id)):
        return None

    public_objects = db.query(CollectionObject.object_id).filter(
        CollectionObject.organization_id == organization_id,
        *public_object_clauses(db, organization_id),
    )
    credited = db.query(ConstituentXref.constituent_id).filter(
        ConstituentXref.organization_id == organization_id,
        ConstituentXref.entity_type == "collection_object",
        ConstituentXref.role.in_(PUBLIC_CREATOR_ROLES),
        ConstituentXref.entity_id.in_(public_objects),
    )
    # PersonAuthority is now an alias for Constituent; PK is constituent_id.
    person = db.query(PersonAuthority).filter(
        PersonAuthority.constituent_id == entity_id,
        PersonAuthority.organization_id == organization_id,
        PersonAuthority.is_active.is_(True),
        PersonAuthority.constituent_id.in_(credited),
    ).first()

    if not person:
        return None

    if content_type == "application/ld+json":
        return format_person_jsonld(person, org_slug)

    return format_person_json(person)


# Xref roles that credit a constituent as the maker of an object.
PUBLIC_CREATOR_ROLES = ("creator", "artist", "maker", "author", "photographer")


def load_media(
    entity_id: UUID, content_type: str, org_slug: str, *, db=None, organization_id=None,
) -> dict | None:
    """Load media and format based on content type.

    Anonymous: published, and linked to a public object of the organization
    (the Discover rule); without an organization, published only.
    """
    db = db or current_session()
    if organization_id is not None:
        from app.models import Organization
        from app.services.discover_media import get_public_media

        org = db.query(Organization).filter(Organization.organization_id == organization_id).first()
        media = get_public_media(db, org, entity_id) if org else None
    else:
        media = db.query(Media).filter(
            Media.media_id == entity_id,
            Media.is_published == True,  # noqa: E712
        ).first()

    if not media:
        return None

    if content_type == "application/ld+json":
        return format_media_jsonld(media, org_slug)

    return format_media_json(media)


ENTITY_LOADERS = {
    "collection_object": load_collection_object,
    "person_authority": load_person_authority,
    "media": load_media,
}


# ============================================================================
# JSON FORMATTERS
# ============================================================================

def format_object_json(obj: CollectionObject) -> dict:
    """Format collection object as JSON (public fields only)."""
    from app.services import public_object_fields as pof

    return pof.redact({
        "id": str(obj.object_id),
        "object_number": obj.object_number,
        "title": obj.title_links[0].title if obj.title_links else obj.object_name,
        "object_type": obj.object_type,
        "creators": obj.creators,
        "materials": obj.materials,
        "creation_date_display": obj.creation_date_display,
        "creation_place": obj.creation_place,
        "brief_description": obj.brief_description,
        "credit_line": obj.credit_line,
        "created_at": obj.created_at.isoformat() if obj.created_at else None,
        "updated_at": obj.updated_at.isoformat() if obj.updated_at else None,
    }, pof.keys_for_object(obj))


def format_person_json(person) -> dict:
    """Format person authority (now Constituent) as JSON."""
    return {
        "id": str(person.constituent_id),
        # preferred_name was the old field on PersonAuthority; Constituent uses `name`.
        "preferred_name": person.name,
        "display_name": person.display_name,
        "authority_type": getattr(person, "authority_type", None),
        "nationality": person.nationality,
        "birth_date_display": person.birth_date_display,
        "death_date_display": person.death_date_display,
        "biography": person.biography,
        "ulan_id": person.ulan_id,
        "viaf_id": getattr(person, "viaf_id", None),
        "wikidata_id": getattr(person, "wikidata_id", None),
    }


def format_media_json(media: Media) -> dict:
    """Format media as JSON."""
    return {
        "id": str(media.media_id),
        "filename": media.filename,
        "title": media.title,
        "description": media.description,
        "mime_type": media.mime_type,
        "width": media.width,
        "height": media.height,
        "created_at": media.created_at.isoformat() if media.created_at else None,
    }


# ============================================================================
# JSON-LD FORMATTERS
# ============================================================================

def format_object_jsonld(obj: CollectionObject, org_slug: str) -> dict:
    """Format collection object as JSON-LD (public fields only)."""
    from app.services import public_object_fields as pof

    keys = pof.keys_for_object(obj)
    title = obj.title_links[0].title if obj.title_links else obj.object_name

    creators = []
    if obj.creators and "creators" in keys:
        for c in obj.creators:
            creator = {
                "@type": "Person",
                "name": c.get("value") or c.get("name"),
            }
            if c.get("authorities"):
                creator["sameAs"] = [a.get("uri") for a in c["authorities"] if a.get("uri")]
            creators.append(creator)

    materials = []
    if obj.materials and "materials" in keys:
        for m in obj.materials:
            material = {
                "@type": "DefinedTerm",
                "name": m.get("value") or m.get("name"),
            }
            if m.get("authorities"):
                material["sameAs"] = [a.get("uri") for a in m["authorities"] if a.get("uri")]
            materials.append(material)

    return {
        "@context": {
            "@vocab": "https://schema.org/",
            "aat": "http://vocab.getty.edu/aat/",
            "ulan": "http://vocab.getty.edu/ulan/",
        },
        "@type": "VisualArtwork",
        "@id": build_uri(org_slug, "collection_object", obj.object_number),
        "identifier": obj.object_number,
        "name": title,
        "description": obj.brief_description if "brief_description" in keys else None,
        "creator": creators if len(creators) > 1 else (creators[0] if creators else None),
        "material": materials if materials else None,
        "dateCreated": obj.creation_date_display if "creation_date" in keys else None,
        "locationCreated": obj.creation_place if "creation_place" in keys else None,
        "creditText": obj.credit_line if "credit_line" in keys else None,
    }


def format_person_jsonld(person, org_slug: str) -> dict:
    """Format person authority (now Constituent) as JSON-LD."""
    same_as = []
    if person.ulan_id:
        same_as.append(f"http://vocab.getty.edu/ulan/{person.ulan_id}")
    viaf_id = getattr(person, "viaf_id", None)
    if viaf_id:
        same_as.append(f"http://viaf.org/viaf/{viaf_id}")
    wikidata_id = getattr(person, "wikidata_id", None)
    if wikidata_id:
        same_as.append(f"https://www.wikidata.org/entity/{wikidata_id}")

    return {
        "@context": "https://schema.org/",
        "@type": "Person",
        "@id": build_uri(org_slug, "person_authority", person.name),
        "name": person.display_name or person.name,
        "birthDate": person.birth_date_display,
        "deathDate": person.death_date_display,
        "nationality": person.nationality,
        "description": person.biography,
        "sameAs": same_as if same_as else None,
    }


def format_media_jsonld(media: Media, org_slug: str) -> dict:
    """Format media as JSON-LD."""
    return {
        "@context": "https://schema.org/",
        "@type": "ImageObject",
        "@id": build_uri(org_slug, "media", str(media.media_id)[:8]),
        "name": media.title or media.filename,
        "description": media.description,
        "encodingFormat": media.mime_type,
        "width": media.width,
        "height": media.height,
    }
