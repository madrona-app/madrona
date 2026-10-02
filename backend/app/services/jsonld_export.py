"""
JSON-LD Export Service

Transforms Procedure/CDWA collection object records into JSON-LD
for Linked Open Data interoperability.

Design Principles:
- Export-only: No internal RDF storage or processing
- Field preservation: Uses existing Procedure/CDWA fields unchanged
- Stable URIs: Uses internal URI system for @id values
- Broad adoption: Prefers schema.org, Dublin Core Terms
- No validation: Outputs what exists, doesn't enforce ontology rules

Vocabulary Priority:
1. schema.org (most widely adopted)
2. Dublin Core Terms (dcterms)
3. Getty vocabularies (AAT, ULAN, TGN) for authorities
4. Custom namespace for Procedure-specific fields
"""

from datetime import date, datetime, timezone
from typing import Any, Optional
from uuid import UUID

from app.models import CollectionObject, PersonAuthority, Media
from app.services.uri_persistence import build_uri, BASE_URI


# ============================================================================
# JSON-LD CONTEXT
# ============================================================================

# Shared context for all exports
JSONLD_CONTEXT = {
    "@vocab": "https://schema.org/",
    "dcterms": "http://purl.org/dc/terms/",
    "aat": "http://vocab.getty.edu/aat/",
    "ulan": "http://vocab.getty.edu/ulan/",
    "tgn": "http://vocab.getty.edu/tgn/",
    "procedure": "https://collectionstrust.org.uk/procedure/",

    # Schema.org aliases
    "name": "schema:name",
    "description": "schema:description",
    "creator": "schema:creator",
    "dateCreated": "schema:dateCreated",
    "material": "schema:material",
    "artform": "schema:artform",
    "image": "schema:image",
    "thumbnail": "schema:thumbnail",

    # Dublin Core mappings
    "identifier": "dcterms:identifier",
    "created": "dcterms:created",
    "medium": "dcterms:medium",
    "extent": "dcterms:extent",
    "provenance": "dcterms:provenance",
    "rights": "dcterms:rights",
    "source": "dcterms:source",

    # procedure-specific (no standard equivalent)
    "objectNumber": "procedure:objectNumber",
    "accessionNumber": "procedure:accessionNumber",
    "creditLine": "procedure:creditLine",
    "currentLocation": "procedure:currentLocation",
    "acquisitionMethod": "procedure:acquisitionMethod",
}


# ============================================================================
# TYPE MAPPINGS
# ============================================================================

# Map internal object types to schema.org types
OBJECT_TYPE_MAP = {
    "painting": "Painting",
    "sculpture": "Sculpture",
    "drawing": "Drawing",
    "print": "VisualArtwork",
    "photograph": "Photograph",
    "textile": "CreativeWork",
    "ceramic": "CreativeWork",
    "furniture": "CreativeWork",
    "book": "Book",
    "manuscript": "Manuscript",
    "map": "Map",
    "installation": "VisualArtwork",
    "video": "VideoObject",
    "film": "Movie",
    "audio": "AudioObject",
    "mixed_media": "VisualArtwork",
    "decorative_art": "VisualArtwork",
    "archaeological": "CreativeWork",
    "ethnographic": "CreativeWork",
    "natural_specimen": "CreativeWork",
    "numismatic": "CreativeWork",
}

# Default type if not mapped
DEFAULT_OBJECT_TYPE = "VisualArtwork"


# ============================================================================
# MAPPING FUNCTIONS
# ============================================================================

def map_object_to_jsonld(
    obj: CollectionObject,
    org_slug: str,
    include_media: bool = True,
    include_context: bool = True,
    base_uri: str = BASE_URI
) -> dict:
    """
    Map a CollectionObject to JSON-LD format.

    Args:
        obj: The CollectionObject to export
        org_slug: URL slug for the organization
        include_media: Whether to include linked media
        include_context: Whether to include @context (False for embedding)
        base_uri: Base URI for identifiers

    Returns:
        JSON-LD document as Python dict
    """
    # Build stable URI for this object
    object_uri = build_uri(org_slug, "collection_object", obj.object_number, base_uri)

    # Determine schema.org type
    schema_type = OBJECT_TYPE_MAP.get(obj.object_type, DEFAULT_OBJECT_TYPE)

    # Start building the document
    doc = {
        "@type": schema_type,
        "@id": object_uri,
    }

    # Add context if requested
    if include_context:
        doc["@context"] = JSONLD_CONTEXT

    # ════════════════════════════════════════════════════════════════════════
    # IDENTIFICATION (Object Identification)
    # ════════════════════════════════════════════════════════════════════════

    # Object number as primary identifier
    doc["identifier"] = obj.object_number

    # Additional identifiers
    if obj.other_number_links:
        doc["additionalIdentifier"] = [
            {
                "@type": "PropertyValue",
                "propertyID": n.number_type or "other",
                "value": n.number_value,
            }
            for n in obj.other_number_links
            if n.number_value
        ]

    # ════════════════════════════════════════════════════════════════════════
    # TITLE (CDWA Category 3)
    # ════════════════════════════════════════════════════════════════════════

    if obj.title_links:
        # Get preferred title
        preferred = next((t for t in obj.title_links if t.is_preferred), None)
        primary_title = preferred or obj.title_links[0] if obj.title_links else None

        if primary_title:
            title_text = primary_title.title
            title_lang = primary_title.language or "en"

            doc["name"] = {
                "@value": title_text,
                "@language": title_lang
            } if title_lang else title_text

        # Alternate titles
        alt_titles = [t for t in obj.title_links if not t.is_preferred]
        if alt_titles:
            doc["alternateName"] = [
                {
                    "@value": t.title,
                    "@language": t.language or "en"
                } if t.language else t.title
                for t in alt_titles
                if t.title
            ]
    elif obj.object_name:
        doc["name"] = obj.object_name

    # ════════════════════════════════════════════════════════════════════════
    # DESCRIPTION (Object Description)
    # ════════════════════════════════════════════════════════════════════════

    if obj.brief_description:
        doc["description"] = obj.brief_description

    if obj.full_description:
        doc["abstract"] = obj.full_description

    # ════════════════════════════════════════════════════════════════════════
    # CREATOR (CDWA Category 10)
    # ════════════════════════════════════════════════════════════════════════

    if obj.creators:
        creators = []
        for c in obj.creators:
            creator = map_creator_to_jsonld(c, org_slug, base_uri)
            if creator:
                creators.append(creator)

        if len(creators) == 1:
            doc["creator"] = creators[0]
        elif creators:
            doc["creator"] = creators

    # ════════════════════════════════════════════════════════════════════════
    # OBJECT TYPE / CLASSIFICATION (CDWA Category 4)
    # ════════════════════════════════════════════════════════════════════════

    if obj.object_type:
        doc["artform"] = map_term_to_jsonld(
            {"value": obj.object_type, "authorities": []},
            term_type="object_type"
        )

    if hasattr(obj, 'classification_links') and obj.classification_links:
        doc["genre"] = [
            map_term_to_jsonld(
                {"term": cl.lookup_value.label} if cl.lookup_value else {},
                term_type="classification"
            )
            for cl in obj.classification_links
            if cl.lookup_value and cl.lookup_value.label
        ]

    # ════════════════════════════════════════════════════════════════════════
    # DATES (CDWA Category 6 / Production)
    # ════════════════════════════════════════════════════════════════════════

    if obj.creation_date_display:
        doc["dateCreated"] = obj.creation_date_display

    # Structured date if available
    if obj.creation_date_earliest or obj.creation_date_latest:
        date_range = {}
        if obj.creation_date_earliest:
            date_range["startDate"] = format_date(obj.creation_date_earliest)
        if obj.creation_date_latest:
            date_range["endDate"] = format_date(obj.creation_date_latest)

        if date_range:
            doc["temporal"] = {
                "@type": "DateTime",
                **date_range
            }

    # ════════════════════════════════════════════════════════════════════════
    # PLACES (CDWA Category 11 / Production)
    # ════════════════════════════════════════════════════════════════════════

    if obj.creation_place:
        place = {"@type": "Place", "name": obj.creation_place}

        # Add authority links if present
        if obj.creation_place_details:
            place = map_place_to_jsonld(obj.creation_place_details, org_slug, base_uri)
            if not place.get("name"):
                place["name"] = obj.creation_place

        doc["locationCreated"] = place

    # Depicted places
    if obj.depicted_places:
        doc["contentLocation"] = [
            map_place_to_jsonld(p, org_slug, base_uri)
            for p in obj.depicted_places
            if p.get("value") or p.get("name")
        ]

    # ════════════════════════════════════════════════════════════════════════
    # MATERIALS & TECHNIQUES (CDWA Categories 7-8)
    # ════════════════════════════════════════════════════════════════════════

    materials = []

    if obj.materials:
        for m in obj.materials:
            material = map_term_to_jsonld(m, term_type="material")
            if material:
                materials.append(material)

    if materials:
        doc["material"] = materials if len(materials) > 1 else materials[0]

    if obj.techniques:
        doc["technique"] = [
            map_term_to_jsonld(t, term_type="technique")
            for t in obj.techniques
            if t.get("value") or t.get("name")
        ]

    # ════════════════════════════════════════════════════════════════════════
    # DIMENSIONS (CDWA Category 5 / Measurements)
    # ════════════════════════════════════════════════════════════════════════

    if obj.measurement_links:
        doc["size"] = map_measurements_to_jsonld(obj.measurement_links)

    # ════════════════════════════════════════════════════════════════════════
    # PROVENANCE & HISTORY (Provenance)
    # ════════════════════════════════════════════════════════════════════════

    if obj.provenance:
        doc["provenance"] = obj.provenance

    if obj.credit_line:
        doc["creditText"] = obj.credit_line

    if obj.acquisition_method:
        doc["acquisitionMethod"] = obj.acquisition_method

    # ════════════════════════════════════════════════════════════════════════
    # LINKED MEDIA (Documentation)
    # ════════════════════════════════════════════════════════════════════════

    if include_media and hasattr(obj, 'media_links') and obj.media_links:
        images = []
        for link in obj.media_links:
            media = link.media if hasattr(link, 'media') else None
            if media:
                image_obj = map_media_to_jsonld(media, org_slug, link.is_primary, base_uri)
                if image_obj:
                    images.append(image_obj)

        if images:
            # Primary image
            primary = next((i for i in images if i.get("_isPrimary")), None)
            if primary:
                del primary["_isPrimary"]
                doc["image"] = primary

            # All images
            for img in images:
                img.pop("_isPrimary", None)
            if len(images) > 1:
                doc["associatedMedia"] = images

    # ════════════════════════════════════════════════════════════════════════
    # RIGHTS (Rights)
    # ════════════════════════════════════════════════════════════════════════

    copyright_status = getattr(obj, 'copyright_status', None)
    if copyright_status:
        doc["copyrightHolder"] = map_rights_to_jsonld(obj)

    # ════════════════════════════════════════════════════════════════════════
    # SUBJECTS (CDWA Category 13)
    # ════════════════════════════════════════════════════════════════════════

    if obj.subjects:
        doc["about"] = [
            map_term_to_jsonld({"value": s} if isinstance(s, str) else s, term_type="subject")
            for s in obj.subjects
        ]

    # ════════════════════════════════════════════════════════════════════════
    # INSCRIPTIONS (CDWA Category 14)
    # ════════════════════════════════════════════════════════════════════════

    if obj.inscription_links:
        doc["text"] = [
            {
                "@type": "TextObject",
                "text": i.content,
                "description": i.inscription_type,
            }
            for i in obj.inscription_links
            if i.content
        ]

    # ════════════════════════════════════════════════════════════════════════
    # METADATA
    # ════════════════════════════════════════════════════════════════════════

    if obj.created_at:
        doc["datePublished"] = obj.created_at.isoformat()

    if obj.updated_at:
        doc["dateModified"] = obj.updated_at.isoformat()

    # Remove None values
    return {k: v for k, v in doc.items() if v is not None}


# ============================================================================
# HELPER MAPPING FUNCTIONS
# ============================================================================

def map_creator_to_jsonld(
    creator: dict,
    org_slug: str,
    base_uri: str = BASE_URI
) -> Optional[dict]:
    """
    Map a creator entry to JSON-LD Person/Organization.

    Supports both legacy format (name, ulan_id) and new authority-backed format.
    """
    # Get name from either format
    name = creator.get("value") or creator.get("name")
    if not name:
        return None

    # Determine type
    person_type = "Person"
    role = creator.get("role", "creator").lower()
    if role in ("workshop", "studio", "manufacturer", "publisher"):
        person_type = "Organization"

    result = {
        "@type": person_type,
        "name": name,
    }

    # Add role as schema.org roleName
    if role and role != "creator":
        result["roleName"] = role

    # Attribution qualifier
    attribution = creator.get("attribution")
    if attribution:
        result["description"] = f"{attribution} {name}"

    # Collect sameAs URIs from authorities
    same_as = []

    # New authorities array
    if creator.get("authorities"):
        for auth in creator["authorities"]:
            uri = auth.get("uri")
            if uri:
                same_as.append(uri)

    # Legacy individual ID fields
    if creator.get("ulan_id") and not any("ulan" in u for u in same_as):
        same_as.append(f"http://vocab.getty.edu/ulan/{creator['ulan_id']}")

    if creator.get("viaf_id") and not any("viaf" in u for u in same_as):
        same_as.append(f"http://viaf.org/viaf/{creator['viaf_id']}")

    if creator.get("wikidata_id") and not any("wikidata" in u for u in same_as):
        same_as.append(f"https://www.wikidata.org/entity/{creator['wikidata_id']}")

    if same_as:
        result["sameAs"] = same_as if len(same_as) > 1 else same_as[0]

    return result


def map_term_to_jsonld(
    term: dict,
    term_type: str = "concept"
) -> Optional[dict]:
    """
    Map a vocabulary term to JSON-LD DefinedTerm.

    Works with materials, techniques, subjects, classifications.
    """
    # Get term value from either format
    value = term.get("value") or term.get("name") or term.get("term")
    if not value:
        return None

    result = {
        "@type": "DefinedTerm",
        "name": value,
    }

    # Collect sameAs URIs
    same_as = []

    # New authorities array
    if term.get("authorities"):
        for auth in term["authorities"]:
            uri = auth.get("uri")
            if uri:
                same_as.append(uri)

    # Legacy aat_id field
    if term.get("aat_id") and not any("aat" in u for u in same_as):
        same_as.append(f"http://vocab.getty.edu/aat/{term['aat_id']}")

    if same_as:
        result["sameAs"] = same_as if len(same_as) > 1 else same_as[0]

    # Add part/role for materials
    if term.get("part"):
        result["description"] = term["part"]

    return result


def map_place_to_jsonld(
    place: dict,
    org_slug: str,
    base_uri: str = BASE_URI
) -> dict:
    """
    Map a place entry to JSON-LD Place.
    """
    name = place.get("value") or place.get("name")

    result = {
        "@type": "Place",
        "name": name,
    }

    # Coordinates
    if place.get("coordinates"):
        coords = place["coordinates"]
        result["geo"] = {
            "@type": "GeoCoordinates",
            "latitude": coords.get("lat"),
            "longitude": coords.get("lon"),
        }

    # Authority links
    same_as = []

    if place.get("authorities"):
        for auth in place["authorities"]:
            uri = auth.get("uri")
            if uri:
                same_as.append(uri)

    # Legacy tgn_id
    if place.get("tgn_id") and not any("tgn" in u for u in same_as):
        same_as.append(f"http://vocab.getty.edu/tgn/{place['tgn_id']}")

    if same_as:
        result["sameAs"] = same_as if len(same_as) > 1 else same_as[0]

    return result


def map_media_to_jsonld(
    media: Media,
    org_slug: str,
    is_primary: bool = False,
    base_uri: str = BASE_URI
) -> Optional[dict]:
    """
    Map a media item to JSON-LD ImageObject/MediaObject.
    """
    if not media:
        return None

    # Determine type based on mime type
    mime = media.mime_type or ""
    if mime.startswith("image/"):
        media_type = "ImageObject"
    elif mime.startswith("video/"):
        media_type = "VideoObject"
    elif mime.startswith("audio/"):
        media_type = "AudioObject"
    else:
        media_type = "MediaObject"

    # Build stable URI for media
    media_uri = build_uri(org_slug, "media", str(media.media_id)[:8], base_uri)

    result = {
        "@type": media_type,
        "@id": media_uri,
        "name": media.title or media.original_filename,
        "encodingFormat": media.mime_type,
        "_isPrimary": is_primary,  # Internal flag, removed later
    }

    if media.description:
        result["description"] = media.description

    if media.width and media.height:
        result["width"] = {"@type": "QuantitativeValue", "value": media.width, "unitCode": "E37"}
        result["height"] = {"@type": "QuantitativeValue", "value": media.height, "unitCode": "E37"}

    # Add content URL if available
    if hasattr(media, 'public_url') and media.public_url:
        result["contentUrl"] = media.public_url

    # Add thumbnail if available
    if hasattr(media, 'thumbnail_url') and media.thumbnail_url:
        result["thumbnail"] = {
            "@type": "ImageObject",
            "contentUrl": media.thumbnail_url
        }

    return result


def map_measurements_to_jsonld(measurement_links) -> list:
    """
    Map measurement_links to JSON-LD QuantitativeValue objects.
    """
    # UN/CEFACT unit codes
    UNIT_CODES = {
        "cm": "CMT",
        "centimeter": "CMT",
        "centimeters": "CMT",
        "m": "MTR",
        "meter": "MTR",
        "meters": "MTR",
        "mm": "MMT",
        "millimeter": "MMT",
        "millimeters": "MMT",
        "in": "INH",
        "inch": "INH",
        "inches": "INH",
        "ft": "FOT",
        "foot": "FOT",
        "feet": "FOT",
        "kg": "KGM",
        "kilogram": "KGM",
        "g": "GRM",
        "gram": "GRM",
        "lb": "LBR",
        "pound": "LBR",
    }

    result = []

    for m in measurement_links:
        dim_type = (m.dimension or "").lower()
        value = float(m.value) if m.value is not None else None
        unit = (m.unit or "cm").lower()

        if value is not None:
            result.append({
                "@type": "QuantitativeValue",
                "name": dim_type,
                "value": value,
                "unitCode": UNIT_CODES.get(unit, unit.upper()),
            })

    return result


def map_rights_to_jsonld(obj: CollectionObject) -> Optional[dict]:
    """
    Map rights information to JSON-LD.
    """
    # Map common rights statuses to rightsstatements.org URIs
    RIGHTS_URI_MAP = {
        "public_domain": "https://creativecommons.org/publicdomain/mark/1.0/",
        "cc0": "https://creativecommons.org/publicdomain/zero/1.0/",
        "cc_by": "https://creativecommons.org/licenses/by/4.0/",
        "cc_by_sa": "https://creativecommons.org/licenses/by-sa/4.0/",
        "cc_by_nc": "https://creativecommons.org/licenses/by-nc/4.0/",
        "in_copyright": "https://rightsstatements.org/vocab/InC/1.0/",
        "copyright_undetermined": "https://rightsstatements.org/vocab/UND/1.0/",
        "no_known_copyright": "https://rightsstatements.org/vocab/NKC/1.0/",
    }

    status = getattr(obj, 'copyright_status', None)
    if not status:
        return None

    rights_uri = RIGHTS_URI_MAP.get(status)

    if rights_uri:
        return rights_uri

    return {"@type": "CreativeWork", "name": status}


def format_date(d: Any) -> Optional[str]:
    """Format a date for JSON-LD."""
    if d is None:
        return None
    if isinstance(d, datetime):
        return d.date().isoformat()
    if isinstance(d, date):
        return d.isoformat()
    return str(d)


# ============================================================================
# BULK EXPORT
# ============================================================================

def map_objects_to_jsonld_collection(
    objects: list[CollectionObject],
    org_slug: str,
    collection_title: str = "Collection Export",
    base_uri: str = BASE_URI
) -> dict:
    """
    Map multiple objects to a JSON-LD Collection.

    Returns a schema.org Collection containing all objects.
    """
    collection_uri = f"{base_uri}/org/{org_slug}/collection"

    items = [
        map_object_to_jsonld(obj, org_slug, include_context=False, base_uri=base_uri)
        for obj in objects
    ]

    return {
        "@context": JSONLD_CONTEXT,
        "@type": "Collection",
        "@id": collection_uri,
        "name": collection_title,
        "numberOfItems": len(items),
        "hasPart": items,
        "dateModified": datetime.now(timezone.utc).isoformat(),
    }
