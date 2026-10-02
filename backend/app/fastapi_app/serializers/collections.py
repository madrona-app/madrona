"""
Serializer functions for collections API models.

All _serialize_* functions are collected here to avoid circular imports
and provide a single location for JSON serialization logic.

Functions that need DB queries accept an optional db_session (or session) parameter.
"""
import logging
from datetime import date, datetime

from sqlalchemy.orm import joinedload, Session


def _count_relationships(obj, db_session) -> int:
    """Count outgoing object relationships."""
    if not db_session:
        return 0
    from app.models import ObjectRelationship
    return db_session.query(ObjectRelationship).filter(
        ObjectRelationship.organization_id == obj.organization_id,
        ObjectRelationship.source_object_id == obj.object_id,
    ).count()


def _count_citations(obj, db_session) -> int:
    """Count citations linked to an object."""
    if not db_session:
        return 0
    from app.models import ObjectCitation
    return db_session.query(ObjectCitation).filter(
        ObjectCitation.object_id == obj.object_id,
        ObjectCitation.organization_id == obj.organization_id,
    ).count()


def _count_events(obj, db_session) -> int:
    """Count events linked to an object."""
    if not db_session:
        return 0
    from app.models.events import EventObjectLink
    return db_session.query(EventObjectLink).filter(
        EventObjectLink.object_id == obj.object_id,
        EventObjectLink.organization_id == obj.organization_id,
    ).count()


def _iso(val) -> str | None:
    """Safely serialize a date/datetime value to ISO format string.

    Handles the case where pipeline-imported data stored a date as a plain
    string instead of a proper date/datetime object.  Returns None for falsy
    values and passes strings through unchanged.
    """
    if not val:
        return None
    if isinstance(val, (date, datetime)):
        return val.isoformat()
    if isinstance(val, str):
        return val  # already a string — pass through
    return str(val)


def _signed_document_types(entity) -> list[str]:
    """
    Return distinct signed-document document_type values for a procedure.

    Reads the polymorphic `signed_documents` relationship defined on each
    procedure model and returns the set of unique document_type strings
    currently attached. Used by procedure requirement predicates to answer
    questions like "does this acquisition have a signed deed of gift?".
    """
    docs = getattr(entity, "signed_documents", None) or []
    return sorted({doc.document_type for doc in docs if doc.document_type})

from app.models import (
    CollectionObject,
    CollectionObjectMedia,
    Location,
    Media,
    Movement,
    Constituent,
    ConstituentXref,
    ObjectPart,
    VocabularyTerm,
    OtherNumberType,
    ConditionReport,
    ObjectEntry,
    ObjectEntryItem,
    Acquisition,
    AcquisitionObject,
    LoanIn,
    LoanInObject,
    LoanInEntry,
    LoanOut,
    LoanOutObject,
    ConservationTreatment,
    ObjectExit,
    ObjectExitItem,
    Deaccession,
    DeaccessionAudit,
)
from app.models.nagpra import NagpraAction, NagpraConsultationEvent
from app.services.uploads import get_org_media_url

logger = logging.getLogger(__name__)


def _serialize_media(media: Media, include_url: bool = True, session=None, user_id: str | None = None) -> dict:
    """Delegate to the shared media serializer.

    For full media serialization with derivatives, presigned URLs, etc.,
    use the dedicated media serializer from the FastAPI media routers.
    """
    from app.serializers.media import _serialize_media as _media_serialize_media
    return _media_serialize_media(media, include_url=include_url, session=session, user_id=user_id)


def _serialize_department(dept) -> dict:
    """Serialize a Department to JSON."""
    return {
        "department_id": str(dept.department_id),
        "organization_id": str(dept.organization_id),
        "name": dept.name,
        "code": dept.code,
        "description": dept.description,
        "parent_id": str(dept.parent_id) if dept.parent_id else None,
        "path": dept.path,
        "depth": dept.depth,
        "head_user_id": str(dept.head_user_id) if dept.head_user_id else None,
        "color": dept.color,
        "sort_order": dept.sort_order,
        "is_active": dept.is_active,
        "member_count": len(dept.members) if dept.members else 0,
        "created_at": _iso(dept.created_at),
    }


def _latest_condition(obj: CollectionObject) -> tuple[str | None, str | None]:
    """Derive condition_rating and condition_date from the latest condition report."""
    reports = getattr(obj, "condition_reports", None)
    if not reports:
        return None, None
    latest = reports[0]  # already ordered by report_date desc
    return latest.overall_condition, _iso(latest.report_date)


def _serialize_collection_object(
    obj: CollectionObject,
    include_location: bool = False,
    include_primary_image: bool = False,
    primary_image_url: str | None = None,
    db_session: Session | None = None,
    session: Session | None = None,
) -> dict:
    """Serialize a CollectionObject to JSON.

    Args:
        obj: The CollectionObject to serialize
        include_location: Whether to include location details
        include_primary_image: Whether to include primary image URL
        primary_image_url: Pre-fetched primary image URL (use with _get_primary_images_bulk
                          to avoid N+1 queries in list views)
        db_session: SQLAlchemy session for querying primary images
        session: Alias for db_session (backward compatibility)
    """
    if db_session is None and session is not None:
        db_session = session
    # Get primary image URL if requested and not pre-fetched
    if include_primary_image and primary_image_url is None and db_session is not None:
        primary_link = db_session.query(CollectionObjectMedia).options(
            joinedload(CollectionObjectMedia.media)
        ).filter(
            CollectionObjectMedia.object_id == obj.object_id,
            CollectionObjectMedia.is_primary == True
        ).first()

        # Fallback: if no primary set, use first media by sort order
        if not primary_link:
            primary_link = db_session.query(CollectionObjectMedia).options(
                joinedload(CollectionObjectMedia.media)
            ).filter(
                CollectionObjectMedia.object_id == obj.object_id
            ).order_by(CollectionObjectMedia.sort_order).first()

        if primary_link and primary_link.media:
            # Prefer 'medium' derivative (1200px) for hero display,
            # falling back to original if no derivatives exist
            image_key = primary_link.media.s3_key
            from app.models.media import MediaDerivative
            medium_deriv = db_session.query(MediaDerivative.s3_key).filter(
                MediaDerivative.media_id == primary_link.media.media_id,
                MediaDerivative.derivative_type == "medium",
                MediaDerivative.format.in_(["webp", "jpeg"]),
            ).first()
            if medium_deriv:
                image_key = medium_deriv.s3_key

            primary_image_url = get_org_media_url(
                image_key,
                organization_id=str(obj.organization_id),
                db_session=db_session,
                expiry_seconds=3600
            )

    # Get display title from title_links relationship
    display_title = None
    if obj.title_links:
        preferred = next((t for t in obj.title_links if t.is_preferred), None)
        display_title = preferred.title if preferred else obj.title_links[0].title

    # Count linked constituents (via ConstituentXref)
    constituent_count = 0
    if hasattr(obj, 'constituent_xrefs') and obj.constituent_xrefs is not None:
        constituent_count = len(obj.constituent_xrefs)

    # Count linked relationships
    relationship_count = _count_relationships(obj, db_session)

    # Count linked materials and techniques
    material_count = 0
    if hasattr(obj, 'material_links') and obj.material_links is not None:
        material_count = len(obj.material_links)
    technique_count = 0
    if hasattr(obj, 'technique_links') and obj.technique_links is not None:
        technique_count = len(obj.technique_links)

    result = {
        "object_id": str(obj.object_id),
        "organization_id": str(obj.organization_id),
        "department_id": str(obj.department_id) if obj.department_id else None,
        "department_name": obj.department.name if obj.department_id and hasattr(obj, 'department') and obj.department else None,
        "object_number": obj.object_number,
        "titles": [
            {"title": t.title, "title_type": t.title_type, "language": t.language, "is_preferred": t.is_preferred}
            for t in (obj.title_links or [])
        ],
        "object_name": obj.object_name,
        "object_type": obj.object_type,
        "classifications": [
            {
                "link_id": str(cl.link_id),
                "value_id": str(cl.value_id),
                "term": cl.lookup_value.label if cl.lookup_value else None,
                "value_key": cl.lookup_value.value_key if cl.lookup_value else None,
            }
            for cl in (obj.classification_links or [])
        ],
        "brief_description": obj.brief_description,
        "object_status": obj.object_status,
        "is_discoverable": obj.is_discoverable,
        "condition_rating": _latest_condition(obj)[0],
        "current_location_id": str(obj.current_location_id) if obj.current_location_id else None,
        "home_location_id": str(obj.home_location_id) if obj.home_location_id else None,
        "creation_date_display": obj.creation_date_display,
        "materials": obj.materials,
        "measurements": [
            {"dimension": m.dimension, "value": float(m.value), "unit": m.unit, "part": m.part}
            for m in (obj.measurement_links or [])
        ],
        "acquisition_method": obj.acquisition_method,
        "acquisition_date": _iso(obj.acquisition_date),
        "credit_line": obj.credit_line,
        "barcode": obj.barcode,
        "last_inventoried_date": _iso(obj.last_inventoried_date),
        "last_inventoried_by": str(obj.last_inventoried_by) if obj.last_inventoried_by else None,
        "primary_image_url": primary_image_url,
        "constituent_count": constituent_count,
        "person_authority_count": constituent_count,
        "material_count": material_count,
        "technique_count": technique_count,
        "relationship_count": relationship_count,
        "created_at": _iso(obj.created_at),
        "updated_at": _iso(obj.updated_at),
    }

    if include_location and obj.current_location:
        result["current_location"] = _serialize_location(obj.current_location, include_children=False)

    return result


def _serialize_collection_object_full(
    obj: CollectionObject,
    include_constituents: bool = False,
    db_session: Session | None = None,
    session: Session | None = None,
) -> dict:
    """Serialize a CollectionObject with all procedure fields.

    Args:
        obj: The CollectionObject to serialize
        include_constituents: Whether to include constituent xrefs
        db_session: SQLAlchemy session for querying primary images
        session: Alias for db_session (backward compatibility)
    """
    if db_session is None and session is not None:
        db_session = session
    # Get primary image URL if available
    primary_image_url = None
    if db_session is not None:
        primary_link = db_session.query(CollectionObjectMedia).options(
            joinedload(CollectionObjectMedia.media)
        ).filter(
            CollectionObjectMedia.object_id == obj.object_id,
            CollectionObjectMedia.is_primary == True
        ).first()

        # Fallback: if no primary set, use first media by sort order
        if not primary_link:
            primary_link = db_session.query(CollectionObjectMedia).options(
                joinedload(CollectionObjectMedia.media)
            ).filter(
                CollectionObjectMedia.object_id == obj.object_id
            ).order_by(CollectionObjectMedia.sort_order).first()

        if primary_link and primary_link.media:
            image_key = primary_link.media.s3_key
            from app.models.media import MediaDerivative
            medium_deriv = db_session.query(MediaDerivative.s3_key).filter(
                MediaDerivative.media_id == primary_link.media.media_id,
                MediaDerivative.derivative_type == "medium",
                MediaDerivative.format.in_(["webp", "jpeg"]),
            ).first()
            if medium_deriv:
                image_key = medium_deriv.s3_key

            primary_image_url = get_org_media_url(
                image_key,
                organization_id=str(obj.organization_id),
                db_session=db_session,
                expiry_seconds=3600
            )

    result = {
        "object_id": str(obj.object_id),
        "organization_id": str(obj.organization_id),
        "department_id": str(obj.department_id) if obj.department_id else None,
        "department_name": obj.department.name if obj.department_id and hasattr(obj, 'department') and obj.department else None,
        "primary_image_url": primary_image_url,

        # Identification
        "object_number": obj.object_number,
        "other_numbers": [
            {"type": n.number_type, "value": n.number_value}
            for n in (obj.other_number_links or [])
        ],
        "number_of_objects": obj.number_of_objects,
        "object_name": obj.object_name,
        "object_name_type": obj.object_name_type,
        "object_name_language": obj.object_name_language,
        "titles": [
            {"title": t.title, "title_type": t.title_type, "language": t.language, "is_preferred": t.is_preferred}
            for t in (obj.title_links or [])
        ],
        "brief_description": obj.brief_description,
        "full_description": obj.full_description,
        "comments": obj.comments,
        "distinguishing_features": obj.distinguishing_features,

        # Description
        "object_type": obj.object_type,
        "classifications": [
            {
                "link_id": str(cl.link_id),
                "value_id": str(cl.value_id),
                "term": cl.lookup_value.label if cl.lookup_value else None,
                "value_key": cl.lookup_value.value_key if cl.lookup_value else None,
            }
            for cl in (obj.classification_links or [])
        ],
        "category": obj.category,
        "physical_description": obj.physical_description,
        "color": obj.color,
        "form": obj.form,
        "materials": obj.materials,
        "techniques": obj.techniques,
        "measurements": [
            {"dimension": m.dimension, "value": float(m.value), "unit": m.unit, "part": m.part}
            for m in (obj.measurement_links or [])
        ],
        "parts_count": obj.parts_count,
        "components": obj.components,
        "edition": obj.edition,
        "copy_number": obj.copy_number,
        "edition_size": obj.edition_size,
        "edition_note": obj.edition_note,
        "state_number": obj.state_number,
        "total_states": obj.total_states,
        "state_description": obj.state_description,
        "catalog_level": obj.catalog_level,
        "orientation": obj.orientation,
        "arrangement": obj.arrangement,
        "installation_instructions": obj.installation_instructions,
        "age": obj.age,
        "age_qualifier": obj.age_qualifier,
        "age_unit": obj.age_unit,
        "style_period": obj.style_period,
        "technical_attributes": obj.technical_attributes,
        "inscriptions": [i.content for i in (obj.inscription_links or [])],

        # Subject & Content
        "subjects": obj.subjects,
        "content_description": obj.content_description,
        "depicted_people": obj.depicted_people,
        "depicted_organizations": obj.depicted_organizations,
        "depicted_places": obj.depicted_places,
        "depicted_events": obj.depicted_events,
        "depicted_objects": obj.depicted_objects,
        "depicted_activities": obj.depicted_activities,
        "depicted_concepts": obj.depicted_concepts,

        # Production
        "creators": obj.creators,
        "creation_date_display": obj.creation_date_display,
        "creation_date_earliest": _iso(obj.creation_date_earliest),
        "creation_date_latest": _iso(obj.creation_date_latest),
        "creation_place": obj.creation_place,
        "creation_place_details": obj.creation_place_details,
        "production_reason": obj.production_reason,
        "production_note": obj.production_note,

        # History
        "provenance": obj.provenance,
        "provenance_structured": obj.provenance_structured,
        "exhibition_history": obj.exhibition_history,
        "publication_history": obj.publication_history,
        "object_history_note": obj.object_history_note,
        "usage": obj.usage,
        "usage_note": obj.usage_note,
        "associated_events": obj.associated_events,
        "associated_organizations": obj.associated_organizations,
        "associated_places": obj.associated_places,
        "associated_concepts": obj.associated_concepts,
        "associated_people": obj.associated_people,
        "associated_cultural_affinity": obj.associated_cultural_affinity,
        "association_note": obj.association_note,

        # Archaeological context
        "excavation_site": obj.excavation_site,
        "excavation_date": obj.excavation_date,
        "archaeological_context": obj.archaeological_context,
        "field_collection_number": obj.field_collection_number,

        # Acquisition
        "acquisition_method": obj.acquisition_method,
        "acquisition_date": _iso(obj.acquisition_date),
        "acquisition_source": obj.acquisition_source,
        "acquisition_source_type": obj.acquisition_source_type,
        "acquisition_cost": float(obj.acquisition_cost) if obj.acquisition_cost else None,
        "acquisition_currency": obj.acquisition_currency,
        "acquisition_funding_source": obj.acquisition_funding_source,
        "acquisition_provisos": obj.acquisition_provisos,
        "acquisition_reason": obj.acquisition_reason,
        "acquisition_note": obj.acquisition_note,
        "credit_line": obj.credit_line,
        "accession_date": _iso(obj.accession_date),

        # Location
        "current_location_id": str(obj.current_location_id) if obj.current_location_id else None,
        "current_location_fitness": obj.current_location_fitness,
        "current_location_note": obj.current_location_note,
        "current_location_date": _iso(obj.current_location_date),
        "home_location_id": str(obj.home_location_id) if obj.home_location_id else None,
        "object_status": obj.object_status,
        "is_discoverable": obj.is_discoverable,
        "discoverable_at": _iso(obj.discoverable_at),

        # Barcode & Inventory
        "barcode": obj.barcode,
        "last_inventoried_date": _iso(obj.last_inventoried_date),
        "last_inventoried_by": str(obj.last_inventoried_by) if obj.last_inventoried_by else None,

        # Condition (rating/date derived from latest condition report)
        "condition_rating": (cr := _latest_condition(obj))[0],
        "condition_date": cr[1],
        "condition_note": obj.condition_note,
        "completeness": obj.completeness,
        "completeness_note": obj.completeness_note,
        "conservation_priority": obj.conservation_priority,
        "next_condition_check_date": _iso(obj.next_condition_check_date),
        "hazards": obj.hazards,
        "environmental_requirements": obj.environmental_requirements,
        "salvage_priority": obj.salvage_priority,
        "handling_requirements": obj.handling_requirements,

        # CDWA extended
        "facture_description": obj.facture_description,
        "watermarks": obj.watermarks,
        # Written by the workspace bulk actions (cataloging status, loan
        # availability, status-change notes). Exposed under its own name
        # rather than "metadata" — that word is what collided with
        # SQLAlchemy's reserved attribute and hid the bug in the first
        # place, so it is not reintroduced at the API boundary.
        "extra_metadata": obj.extra_metadata,

        # Rights - managed via ObjectRight records (see /objects/{id}/rights)

        # Valuation
        "current_value": float(obj.current_value) if obj.current_value else None,
        "current_value_currency": obj.current_value_currency,
        "current_value_date": _iso(obj.current_value_date),
        "insurance_value": float(obj.insurance_value) if obj.insurance_value else None,
        "insurance_value_currency": obj.insurance_value_currency,
        "insurance_note": obj.insurance_note,
        "valuation_history": obj.valuation_history,

        # Audit
        "created_at": _iso(obj.created_at),
        "created_by": str(obj.created_by) if obj.created_by else None,
        "updated_at": _iso(obj.updated_at),
        "updated_by": str(obj.updated_by) if obj.updated_by else None,

        # Constituent count (for People indicator)
        "constituent_count": len(obj.constituent_xrefs) if hasattr(obj, 'constituent_xrefs') and obj.constituent_xrefs else 0,
        "person_authority_count": len(obj.constituent_xrefs) if hasattr(obj, 'constituent_xrefs') and obj.constituent_xrefs else 0,

        # Material and technique counts (for indicators)
        "material_count": len(obj.material_links) if hasattr(obj, 'material_links') and obj.material_links else 0,
        "technique_count": len(obj.technique_links) if hasattr(obj, 'technique_links') and obj.technique_links else 0,

        # Linked record counts (for badges)
        "relationship_count": _count_relationships(obj, db_session),
        "citation_count": _count_citations(obj, db_session),
        "event_count": _count_events(obj, db_session),

        # Included relations
        "current_location": _serialize_location(obj.current_location, include_children=False) if obj.current_location else None,
        "home_location": _serialize_location(obj.home_location, include_children=False) if obj.home_location else None,
    }

    # Include constituent xrefs if requested
    if include_constituents and hasattr(obj, 'constituent_xrefs') and obj.constituent_xrefs:
        result["constituents"] = [
            _serialize_constituent_xref(xref)
            for xref in sorted(obj.constituent_xrefs, key=lambda x: x.display_order)
        ]
    else:
        result["constituents"] = []

    # Include linked acquisition record if available
    if hasattr(obj, 'acquisitions') and obj.acquisitions:
        # Get the first (and typically only) acquisition link
        acq_link = obj.acquisitions[0]
        if acq_link.acquisition:
            result["acquisition"] = _serialize_acquisition(acq_link.acquisition)
        else:
            result["acquisition"] = None
    else:
        result["acquisition"] = None

    # Include object parts
    if hasattr(obj, 'parts') and obj.parts:
        result["parts"] = [
            _serialize_object_part(p)
            for p in sorted(obj.parts, key=lambda x: x.display_order)
        ]
        result["parts_count"] = len(obj.parts)
    else:
        result["parts"] = []
        # Note: parts_count might already be set from the DB column, only override if parts loaded
        if "parts_count" not in result or result["parts_count"] is None:
            result["parts_count"] = 0

    return result


def _serialize_location(loc: Location, include_children: bool = False) -> dict:
    """Serialize a Location to JSON."""
    result = {
        "location_id": str(loc.location_id),
        "organization_id": str(loc.organization_id),
        "parent_id": str(loc.parent_id) if loc.parent_id else None,
        "path": loc.path,
        "depth": loc.depth,
        "name": loc.name,
        "code": loc.code,
        "barcode": loc.barcode,
        "location_type": loc.location_type,
        "is_external": loc.is_external,
        "capacity": loc.capacity,
        "current_count": loc.current_count,
        "climate_controlled": loc.climate_controlled,
        "default_fitness": loc.default_fitness,
        "condition": loc.condition,
        "security_level": loc.security_level,
        "status": loc.status,
        "on_display": loc.on_display,
        "created_at": _iso(loc.created_at),
        "updated_at": _iso(loc.updated_at),
    }

    if include_children and hasattr(loc, 'children') and loc.children:
        result["children"] = [_serialize_location(c, include_children=True) for c in loc.children]

    return result


def _serialize_location_full(loc: Location) -> dict:
    """Serialize a Location with all fields."""
    return {
        "location_id": str(loc.location_id),
        "organization_id": str(loc.organization_id),
        "parent_id": str(loc.parent_id) if loc.parent_id else None,
        "path": loc.path,
        "depth": loc.depth,
        "name": loc.name,
        "code": loc.code,
        "barcode": loc.barcode,
        "alternate_names": loc.alternate_names,
        "location_type": loc.location_type,
        "is_external": loc.is_external,
        "address": loc.address,
        "contact_name": loc.contact_name,
        "contact_email": loc.contact_email,
        "contact_phone": loc.contact_phone,
        "coordinates": loc.coordinates,
        "grid_reference": loc.grid_reference,
        "floor_plan_coordinates": loc.floor_plan_coordinates,
        "capacity": loc.capacity,
        "current_count": loc.current_count,
        "capacity_note": loc.capacity_note,
        "climate_controlled": loc.climate_controlled,
        "temperature_min": float(loc.temperature_min) if loc.temperature_min else None,
        "temperature_max": float(loc.temperature_max) if loc.temperature_max else None,
        "humidity_min": float(loc.humidity_min) if loc.humidity_min else None,
        "humidity_max": float(loc.humidity_max) if loc.humidity_max else None,
        "light_level": loc.light_level,
        "light_level_lux": loc.light_level_lux,
        "uv_filtered": loc.uv_filtered,
        "environment_note": loc.environment_note,
        "default_fitness": loc.default_fitness,
        "condition": loc.condition,
        "condition_note": loc.condition_note,
        "condition_date": _iso(loc.condition_date),
        "pest_control_date": _iso(loc.pest_control_date),
        "security_level": loc.security_level,
        "security_note": loc.security_note,
        "access_restricted": loc.access_restricted,
        "access_requirements": loc.access_requirements,
        "access_note": loc.access_note,
        "accessibility": loc.accessibility,
        "description": loc.description,
        "note": loc.note,
        "status": loc.status,
        "on_display": loc.on_display,
        "established_date": _iso(loc.established_date),
        "decommissioned_date": _iso(loc.decommissioned_date),
        "created_at": _iso(loc.created_at),
        "created_by": str(loc.created_by) if loc.created_by else None,
        "updated_at": _iso(loc.updated_at),
        "updated_by": str(loc.updated_by) if loc.updated_by else None,
    }


def _serialize_object_part(part: ObjectPart) -> dict:
    """Serialize an ObjectPart to JSON."""
    result = {
        "part_id": str(part.part_id),
        "organization_id": str(part.organization_id),
        "object_id": str(part.object_id),
        "part_number": part.part_number,
        "name": part.name,
        "description": part.description,
        "current_location_id": str(part.current_location_id) if part.current_location_id else None,
        "current_location_fitness": part.current_location_fitness,
        "current_location_note": part.current_location_note,
        "current_location_date": _iso(part.current_location_date),
        "home_location_id": str(part.home_location_id) if part.home_location_id else None,
        "barcode": part.barcode,
        "display_order": part.display_order,
        "created_at": _iso(part.created_at),
        "created_by": str(part.created_by) if part.created_by else None,
        "updated_at": _iso(part.updated_at),
        "updated_by": str(part.updated_by) if part.updated_by else None,
    }

    # Include location details if loaded
    if part.current_location:
        result["current_location_name"] = part.current_location.name
        result["current_location_path"] = part.current_location.path
        result["current_location_on_display"] = part.current_location.on_display

    if part.home_location:
        result["home_location_name"] = part.home_location.name
        result["home_location_path"] = part.home_location.path

    return result


def _serialize_movement(mov: Movement) -> dict:
    """Serialize a Movement to JSON."""
    # Get object info for display
    object_number = None
    object_title = None
    if mov.object:
        object_number = mov.object.object_number
        # Get preferred title or first title
        if mov.object.title_links:
            preferred = next((t for t in mov.object.title_links if t.is_preferred), None)
            object_title = preferred.title if preferred else (mov.object.title_links[0].title if mov.object.title_links else None)
        if not object_title:
            object_title = mov.object.object_name

    # Get part info for multi-part objects
    part_id = None
    part_number = None
    part_name = None
    if mov.part:
        part_id = str(mov.part_id)
        part_number = mov.part.part_number
        part_name = mov.part.name

    return {
        "movement_id": str(mov.movement_id),
        "organization_id": str(mov.organization_id),
        "movement_reference_number": mov.movement_reference_number,
        "object_id": str(mov.object_id),
        "object_number": object_number,
        "object_title": object_title,
        "part_id": part_id,
        "part_number": part_number,
        "part_name": part_name,
        "from_location_id": str(mov.from_location_id) if mov.from_location_id else None,
        "from_location_name": mov.from_location.name if mov.from_location else None,
        "from_location_path": mov.from_location.path if mov.from_location else None,
        "to_location_id": str(mov.to_location_id),
        "to_location_name": mov.to_location.name if mov.to_location else None,
        "to_location_path": mov.to_location.path if mov.to_location else None,
        "location_fitness": mov.location_fitness,
        "movement_date": _iso(mov.movement_date),
        "planned_removal_date": _iso(mov.planned_removal_date),
        "removal_date": _iso(mov.removal_date),
        "planned_return_date": _iso(mov.planned_return_date),
        "reason": mov.reason,
        "movement_note": mov.movement_note,
        "reference_type": mov.reference_type,
        "reference_id": str(mov.reference_id) if mov.reference_id else None,
        "authorized_by": str(mov.authorized_by) if mov.authorized_by else None,
        "authorization_date": _iso(mov.authorization_date),
        "movement_contact": mov.movement_contact,
        "movement_method": mov.movement_method,
        "moved_by": str(mov.moved_by) if mov.moved_by else None,
        "moved_by_name": mov.moved_by_name,
        "handler_id": str(mov.handler_id) if mov.handler_id else None,
        "handler_name": mov.handler_name or (mov.handler.name if mov.handler else None),
        "status": mov.status,
        "signed_document_types": _signed_document_types(mov),
        "created_at": _iso(mov.created_at),
        "created_by": str(mov.created_by) if mov.created_by else None,
    }


def _serialize_vocabulary_term(term: VocabularyTerm) -> dict:
    """Serialize a VocabularyTerm to JSON."""
    return {
        "term_id": str(term.term_id),
        "organization_id": str(term.organization_id) if term.organization_id else None,
        "vocabulary": term.vocabulary,
        "external_id": term.external_id,
        "external_uri": term.external_uri,
        "preferred_term": term.preferred_term,
        "alternate_terms": term.alternate_terms,
        "scope_note": term.scope_note,
        "term_type": term.term_type,
        "hierarchy_path": term.hierarchy_path,
        "broader_term": term.broader_term,
        "applicable_fields": term.applicable_fields,
        "usage_count": term.usage_count,
        "status": term.status,
        "is_custom": term.is_custom,
        "facet": term.facet,
        "hierarchy_fetched_at": _iso(term.hierarchy_fetched_at),
        "getty_modified_at": _iso(term.getty_modified_at),
    }


def _serialize_constituent(c: Constituent) -> dict:
    """Serialize a Constituent to JSON."""
    return {
        "constituent_id": str(c.constituent_id),
        "organization_id": str(c.organization_id),
        "constituent_type": c.constituent_type,
        "name": c.name,
        "display_name": c.display_name,
        "title": c.title,
        "role": c.role,
        "organization_name": c.organization_name,
        "department": c.department,
        "email": c.email,
        "phone": c.phone,
        "address": c.address,
        "nationality": c.nationality,
        "birth_date_display": c.birth_date_display,
        "death_date_display": c.death_date_display,
        "ulan_id": c.ulan_id,
        "is_verified": c.is_verified,
        "notes": c.notes,
        "is_active": c.is_active,
        "status": c.status,
        "created_at": _iso(c.created_at),
        "updated_at": _iso(c.updated_at),
    }


def _serialize_constituent_xref(xref: ConstituentXref) -> dict:
    """Serialize a ConstituentXref to JSON, including constituent data."""
    result = {
        "xref_id": str(xref.xref_id),
        "organization_id": str(xref.organization_id),
        "constituent_id": str(xref.constituent_id),
        "entity_type": xref.entity_type,
        "entity_id": str(xref.entity_id),
        "role": xref.role,
        "role_qualifier": xref.role_qualifier,
        "attribution_certainty": xref.attribution_certainty,
        "attribution_note": xref.attribution_note,
        "display_order": xref.display_order,
        "display_name_override": xref.display_name_override,
        "is_primary": xref.is_primary,
        "start_date": xref.start_date,
        "end_date": xref.end_date,
        "location": xref.location,
        "notes": xref.notes,
        "created_at": _iso(xref.created_at),
    }
    if xref.constituent:
        result["constituent"] = _serialize_constituent(xref.constituent)
    return result


def _serialize_condition_report(report: ConditionReport) -> dict:
    """Serialize a ConditionReport to JSON."""
    return {
        "report_id": str(report.report_id),
        "organization_id": str(report.organization_id),
        "report_number": report.report_number,
        "report_type": report.report_type,
        "check_reason": report.check_reason,
        "report_date": _iso(report.report_date),
        "completeness": report.completeness,
        "completeness_date": _iso(report.completeness_date),
        "next_check_date": _iso(report.next_check_date),
        "examiner_id": str(report.examiner_id) if report.examiner_id else None,
        "examiner_name": report.examiner_name,
        "object_id": str(report.object_id) if report.object_id else None,
        "linked_entity_type": report.linked_entity_type,
        "linked_entity_id": str(report.linked_entity_id) if report.linked_entity_id else None,
        "overall_condition": report.overall_condition,
        "condition_summary": report.condition_summary,
        "detailed_findings": report.detailed_findings,
        "hazards": report.hazards,
        "recommendations": report.recommendations,
        "conservation_needed": report.conservation_needed,
        "conservation_priority": report.conservation_priority,
        "handling_requirements": report.handling_requirements,
        "packing_requirements": report.packing_requirements,
        "display_restrictions": report.display_restrictions,
        "image_references": report.image_references,
        "previous_report_id": str(report.previous_report_id) if report.previous_report_id else None,
        "status": report.status,
        "reviewed_by": str(report.reviewed_by) if report.reviewed_by else None,
        "reviewed_date": _iso(report.reviewed_date),
        "authorizer_id": str(report.authorizer_id) if report.authorizer_id else None,
        "authorization_date": _iso(report.authorization_date),
        "authorization_note": report.authorization_note,
        "report_note": report.report_note,
        "created_at": _iso(report.created_at),
        "updated_at": _iso(report.updated_at),
    }


def _serialize_object_entry(entry: ObjectEntry) -> dict:
    """Serialize an ObjectEntry to JSON."""
    return {
        "entry_id": str(entry.entry_id),
        "organization_id": str(entry.organization_id),
        "entry_number": entry.entry_number,
        "entry_date": _iso(entry.entry_date),
        "depositor_id": str(entry.depositor_id) if entry.depositor_id else None,
        "depositor_name": entry.depositor_name,
        "current_owner_id": str(entry.current_owner_id) if entry.current_owner_id else None,
        "current_owner": entry.current_owner,
        "reason": entry.entry_reason,
        "entry_method": entry.entry_method,
        "expected_duration": entry.expected_duration,
        "expected_return_date": _iso(entry.expected_return_date),
        "receipt_reference": entry.receipt_reference,
        "entry_note": entry.entry_note,
        # Authorization
        "authorizer_id": str(entry.authorizer_id) if entry.authorizer_id else None,
        "authorizer_name": entry.authorizer.name if entry.authorizer_id and entry.authorizer else None,
        "authorization_date": _iso(entry.authorization_date),
        "authorization_note": entry.authorization_note,
        "objects_description": entry.objects_description,
        # Insurance
        "insurance_value": float(entry.insurance_value) if entry.insurance_value else None,
        "insurance_currency": entry.insurance_currency,
        "insurance_note": entry.insurance_note,
        "conditions": entry.conditions,
        # Terms acceptance (procedure compliance)
        "terms_accepted": entry.terms_accepted,
        "terms_accepted_date": _iso(entry.terms_accepted_date),
        "terms_accepted_by_id": str(entry.terms_accepted_by_id) if entry.terms_accepted_by_id else None,
        "terms_accepted_by": entry.terms_accepted_by,  # Deprecated
        "acceptance_method": entry.acceptance_method,
        "acceptance_note": entry.acceptance_note,
        "signature_reference": entry.signature_reference,  # Deprecated
        # Status
        "status": entry.status,
        "processed_date": _iso(entry.processed_date),
        "processed_by": str(entry.processed_by) if entry.processed_by else None,
        "outcome": entry.outcome,
        "outcome_note": entry.outcome_note,
        "outcome_reference_id": str(entry.outcome_reference_id) if entry.outcome_reference_id else None,
        "return_date": _iso(entry.return_date),
        "returned_to": entry.returned_to,
        "exit_id": str(entry.exit_id) if entry.exit_id else None,
        # Object count — number of entry items
        "objects_count": len(entry.items or []),
        # Media count — sum across all items (media now lives on ObjectEntryItem)
        "media_count": sum(
            len(getattr(item, "media_links", []) or []) for item in (entry.items or [])
        ),
        "signed_document_types": _signed_document_types(entry),
        "created_at": _iso(entry.created_at),
        "updated_at": _iso(entry.updated_at),
    }


def _serialize_object_entry_item(item: ObjectEntryItem) -> dict:
    """Serialize an ObjectEntryItem to JSON."""
    # Embed media links so the item detail panel can render photos without a
    # second round trip.
    from app.services.uploads import get_org_media_url

    media_links: list[dict] = []
    for link in getattr(item, "media_links", []) or []:
        media = link.media
        if media is None:
            continue
        thumbnail_url = None
        if media.s3_key:
            thumbnail_url = get_org_media_url(
                media.s3_key, organization_id=str(media.organization_id)
            )
        media_links.append({
            "media_id": str(media.media_id),
            "filename": media.filename,
            "media_type": media.media_type,
            "mime_type": media.mime_type,
            "thumbnail_url": thumbnail_url,
            "is_primary": link.is_primary,
            "sort_order": link.sort_order,
            "caption": link.caption,
            "usage_type": link.usage_type,
        })

    return {
        "entry_item_id": str(item.entry_item_id),
        "entry_id": str(item.entry_id),
        "organization_id": str(item.organization_id),
        "item_number": item.item_number,
        "brief_description": item.brief_description,
        "detailed_description": item.detailed_description,
        "lender_object_number": item.lender_object_number,
        "object_id": str(item.object_id) if item.object_id else None,
        "acquisition_id": str(item.acquisition_id) if item.acquisition_id else None,
        "declared_value": float(item.declared_value) if item.declared_value is not None else None,
        "declared_value_currency": item.declared_value_currency,
        "condition_note": item.condition_note,
        "condition_report_id": str(item.condition_report_id) if item.condition_report_id else None,
        "condition_report_number": item.condition_report.report_number if item.condition_report_id and item.condition_report else None,
        "location_id": str(item.location_id) if item.location_id else None,
        "location_name": item.location.name if item.location_id and item.location else None,
        "location_path": item.location.path if item.location_id and item.location else None,
        "item_status": item.item_status,
        "item_outcome": item.item_outcome,
        "item_outcome_note": item.item_outcome_note,
        "media": media_links,
        "created_at": _iso(item.created_at),
    }


def _serialize_acquisition(acq: Acquisition) -> dict:
    """Serialize an Acquisition to JSON."""
    return {
        "acquisition_id": str(acq.acquisition_id),
        "organization_id": str(acq.organization_id),
        "acquisition_number": acq.acquisition_number,
        "acquisition_method": acq.acquisition_method,
        "acquisition_date": _iso(acq.acquisition_date),
        "source_id": str(acq.source_id) if acq.source_id else None,
        "source_name": acq.source_name,
        "source_type": acq.source_type,
        "authorization_id": str(acq.authorization_id) if acq.authorization_id else None,
        "authorization_date": _iso(acq.authorization_date),
        "authorization_note": acq.authorization_note,
        "funding_source": acq.funding_source,
        "funding_account": acq.funding_account,
        "cost": float(acq.cost) if acq.cost else None,
        "cost_currency": acq.cost_currency,
        "legal_status": acq.legal_status,
        "provisos": acq.provisos,
        "acquisition_reason": acq.acquisition_reason,
        "acknowledgement_date": _iso(acq.acknowledgement_date),
        "acknowledgement_reference": acq.acknowledgement_reference,
        "credit_line": acq.credit_line,
        "deed_of_gift_date": _iso(acq.deed_of_gift_date),
        "deed_of_gift_reference": acq.deed_of_gift_reference,
        "entry_id": str(acq.entry_id) if acq.entry_id else None,
        "objects_count": acq.objects_count,
        "acquisition_note": acq.acquisition_note,
        "internal_note": acq.internal_note,
        "status": acq.status,
        "completed_date": _iso(acq.completed_date),
        # Board approval
        "board_approval_required": acq.board_approval_required,
        "board_approval_date": _iso(acq.board_approval_date),
        "board_approval_reference": acq.board_approval_reference,
        "board_note": acq.board_note,
        # Appraisal
        "appraised_value": float(acq.appraised_value) if acq.appraised_value else None,
        "appraised_value_currency": acq.appraised_value_currency,
        "appraised_date": _iso(acq.appraised_date),
        "appraiser_name": acq.appraiser_name,
        # Legal extras
        "legal_note": acq.legal_note,
        "provenance_verified": acq.provenance_verified,
        "provenance_note": acq.provenance_note,
        "donor_restrictions": acq.donor_restrictions,
        "transfer_of_title_number": acq.transfer_of_title_number,
        # Financial extras
        "funding_note": acq.funding_note,
        # Accessioning fields
        "accession_number": acq.accession_number,
        "accession_date": _iso(acq.accession_date),
        "accessioning_approved": acq.accessioning_approved,
        "accessioning_approved_by": str(acq.accessioning_approved_by) if acq.accessioning_approved_by else None,
        "accessioning_approved_date": _iso(acq.accessioning_approved_date),
        "accessioning_resolution": acq.accessioning_resolution,
        "accessioning_note": acq.accessioning_note,
        "signed_document_types": _signed_document_types(acq),
        "created_at": _iso(acq.created_at),
        "updated_at": _iso(acq.updated_at),
    }


def _serialize_loan_in(loan: LoanIn) -> dict:
    """Serialize a LoanIn to JSON."""
    return {
        "loan_in_id": str(loan.loan_in_id),
        "organization_id": str(loan.organization_id),
        "loan_number": loan.loan_number,
        "lender_id": str(loan.lender_id) if loan.lender_id else None,
        "lender_name": loan.lender_name,
        "lender_contact_id": str(loan.lender_contact_id) if loan.lender_contact_id else None,
        "lender_contact_name": loan.lender_contact_name,
        "lender_contact": None,  # Removed: use lender relationship
        "loan_purpose": loan.loan_purpose,
        "exhibition_id": str(loan.exhibition_id) if loan.exhibition_id else None,
        "exhibition_name": loan.exhibition_name,
        "exhibition_venue": loan.exhibition_venue,
        "request_date": _iso(loan.request_date),
        "approval_date": _iso(loan.approval_date),
        "approved_by": str(loan.approved_by) if loan.approved_by else None,
        "loan_start_date": _iso(loan.loan_start_date),
        "loan_end_date": _iso(loan.loan_end_date),
        "actual_receipt_date": _iso(loan.actual_receipt_date),
        "actual_return_date": _iso(loan.actual_return_date),
        "renewal_count": loan.renewal_count,
        "renewal_history": [
            {
                "renewal_id": str(r.renewal_id),
                "renewal_number": r.renewal_number,
                "previous_end_date": _iso(r.previous_end_date),
                "new_end_date": _iso(r.new_end_date),
                "approval_date": _iso(r.approval_date),
                "reason": r.reason,
                "note": r.note,
            }
            for r in (loan.renewals or [])
        ],
        "loan_conditions": loan.loan_conditions,
        "special_requirements": loan.special_requirements,
        "display_requirements": loan.display_requirements,
        "photography_restrictions": loan.photography_restrictions,
        "max_renewals": loan.max_renewals,
        "insurance_value": float(loan.insurance_value) if loan.insurance_value else None,
        "insurance_currency": loan.insurance_currency,
        "insurance_policy": loan.insurance_policy,
        "insurance_provider": loan.insurance_provider,
        "indemnity": loan.indemnity,
        "indemnity_reference": loan.indemnity_reference,
        "facility_report_sent": loan.facility_report_sent,
        "facility_report_date": _iso(loan.facility_report_date),
        "facility_report_approved": loan.facility_report_approved,
        "facility_report_approved_date": _iso(loan.facility_report_approved_date),
        "facility_report_note": loan.facility_report_note,
        "condition_report_in_id": str(loan.condition_report_in_id) if loan.condition_report_in_id else None,
        "condition_report_out_id": str(loan.condition_report_out_id) if loan.condition_report_out_id else None,
        "entry_id": str(loan.entry_id) if loan.entry_id else None,
        "loan_agreement_reference": loan.loan_agreement_reference,
        "loan_agreement_date": _iso(loan.loan_agreement_date),
        "loan_agreement_signed_date": _iso(loan.loan_agreement_signed_date),
        # Lender's authorizer (procedure compliance)
        "lender_authorizer_id": str(loan.lender_authorizer_id) if loan.lender_authorizer_id else None,
        "lender_authorizer_name": loan.lender_authorizer_name,
        "lender_authorizer_title": loan.lender_authorizer_title,
        "lender_authorization_date": _iso(loan.lender_authorization_date),
        # Document location (procedure compliance)
        "document_location": loan.document_location,
        "document_location_note": loan.document_location_note,
        # Loan contact (procedure compliance)
        "loan_contact_name": loan.loan_contact_name,
        "loan_contact_email": loan.loan_contact_email,
        "loan_contact_phone": loan.loan_contact_phone,
        # Status
        "status": loan.status,
        "loan_note": loan.loan_note,
        "internal_note": loan.internal_note,
        # Closing (procedure compliance)
        "closing_invoice_sent": loan.closing_invoice_sent,
        "closing_invoice_date": _iso(loan.closing_invoice_date),
        "closing_invoice_reference": loan.closing_invoice_reference,
        "closing_invoice_amount": float(loan.closing_invoice_amount) if loan.closing_invoice_amount else None,
        "closing_invoice_currency": loan.closing_invoice_currency,
        "receipt_acknowledged": loan.receipt_acknowledged,
        "receipt_acknowledged_date": _iso(loan.receipt_acknowledged_date),
        "receipt_acknowledged_reference": loan.receipt_acknowledged_reference,
        "conditions_met_confirmed": loan.conditions_met_confirmed,
        "conditions_met_date": _iso(loan.conditions_met_date),
        "conditions_met_note": loan.conditions_met_note,
        "closing_note": loan.closing_note,
        "signed_document_types": _signed_document_types(loan),
        "created_at": _iso(loan.created_at),
        "updated_at": _iso(loan.updated_at),
    }


def _serialize_loan_in_object(obj: LoanInObject, include_object: bool = False) -> dict:
    """Serialize a LoanInObject to JSON."""
    result = {
        "loan_object_id": str(obj.loan_object_id),
        "loan_in_id": str(obj.loan_in_id),
        "organization_id": str(obj.organization_id),
        "object_id": str(obj.object_id) if obj.object_id else None,
        "object_number_lender": obj.object_number_lender,
        "object_title": obj.object_title,
        "object_description": obj.object_description,
        "artist_maker": obj.artist_maker,
        "date_description": obj.date_description,
        "insurance_value": float(obj.insurance_value) if obj.insurance_value else None,
        "insurance_currency": obj.insurance_currency,
        "dimensions": obj.dimensions,
        "medium": obj.medium,
        "special_requirements": obj.special_requirements,
        "display_requirements": obj.display_requirements,
        "condition_report_in_id": str(obj.condition_report_in_id) if obj.condition_report_in_id else None,
        "condition_report_out_id": str(obj.condition_report_out_id) if obj.condition_report_out_id else None,
        "current_location_id": str(obj.current_location_id) if obj.current_location_id else None,
        "item_status": obj.item_status,
        "received_date": _iso(obj.received_date),
        "returned_date": _iso(obj.returned_date),
        "created_at": _iso(obj.created_at),
    }
    # Include linked collection object summary if exists and requested
    if include_object and obj.object_id and obj.object:
        # Get display title from title_links relationship
        display_title = None
        if obj.object.title_links:
            preferred = next((t for t in obj.object.title_links if t.is_preferred), None)
            display_title = preferred.title if preferred else (obj.object.title_links[0].title if obj.object.title_links else None)
        result["object"] = {
            "object_id": str(obj.object.object_id),
            "object_number": obj.object.object_number,
            "title": display_title,
            "titles": [
                {"title": t.title, "title_type": t.title_type, "language": t.language, "is_preferred": t.is_preferred}
                for t in (obj.object.title_links or [])
            ],
            "object_name": obj.object.object_name,
            "primary_image_url": None,
        }
    return result


def _serialize_loan_out(loan: LoanOut) -> dict:
    """Serialize a LoanOut to JSON."""
    return {
        "loan_out_id": str(loan.loan_out_id),
        "organization_id": str(loan.organization_id),
        "loan_number": loan.loan_number,
        # Borrower
        "borrower_id": str(loan.borrower_id) if loan.borrower_id else None,
        "borrower_name": loan.borrower_name,
        "borrower_status": loan.borrower_status,
        "borrower_contact_id": str(loan.borrower_contact_id) if loan.borrower_contact_id else None,
        "borrower_contact_name": loan.borrower_contact_name,
        # Venue
        "venue_name": loan.venue_name,
        "venue_address": loan.venue_address,
        # Purpose
        "loan_purpose": loan.loan_purpose,
        "exhibition_title": loan.exhibition_title,
        # Dates
        "request_date": _iso(loan.request_date),
        "approval_date": _iso(loan.approval_date),
        "approved_by": str(loan.approved_by) if loan.approved_by else None,
        "board_approval_date": _iso(loan.board_approval_date),
        "board_approval_reference": loan.board_approval_reference,
        "loan_start_date": _iso(loan.loan_start_date),
        "loan_end_date": _iso(loan.loan_end_date),
        "actual_dispatch_date": _iso(loan.actual_dispatch_date),
        "actual_return_date": _iso(loan.actual_return_date),
        # Renewals
        "renewal_count": loan.renewal_count,
        "max_renewals": loan.max_renewals,
        "renewal_history": [
            {
                "renewal_id": str(r.renewal_id),
                "renewal_number": r.renewal_number,
                "previous_end_date": _iso(r.previous_end_date),
                "new_end_date": _iso(r.new_end_date),
                "approval_date": _iso(r.approval_date),
                "reason": r.reason,
                "note": r.note,
            }
            for r in (loan.renewals or [])
        ],
        # Conditions
        "loan_conditions": loan.loan_conditions,
        "special_conditions": loan.special_conditions,
        # Insurance
        "insurance_requirements": loan.insurance_requirements,
        "insurance_value_total": float(loan.insurance_value_total) if loan.insurance_value_total else None,
        "insurance_currency": loan.insurance_currency,
        "insurance_coverage_type": loan.insurance_coverage_type,
        "certificate_of_insurance_received": loan.certificate_of_insurance_received,
        "certificate_of_insurance_date": _iso(loan.certificate_of_insurance_date),
        # Facility report
        "facility_report_received": loan.facility_report_received,
        "facility_report_date": _iso(loan.facility_report_date),
        "facility_report_approved": loan.facility_report_approved,
        "facility_report_approved_by": str(loan.facility_report_approved_by) if loan.facility_report_approved_by else None,
        "security_conditions_confirmed": loan.security_conditions_confirmed,
        # Condition reports
        "condition_report_out_id": str(loan.condition_report_out_id) if loan.condition_report_out_id else None,
        "condition_report_return_id": str(loan.condition_report_return_id) if loan.condition_report_return_id else None,
        # Agreement
        "loan_agreement_reference": loan.loan_agreement_reference,
        "loan_agreement_signed_date": _iso(loan.loan_agreement_signed_date),
        "document_location": loan.document_location,
        # Authorization
        "authorizer_id": str(loan.authorizer_id) if loan.authorizer_id else None,
        "authorization_date": _iso(loan.authorization_date),
        "authorization_note": loan.authorization_note,
        # Photography / reproduction rights
        "photography_permitted": loan.photography_permitted,
        "photography_conditions": loan.photography_conditions,
        "reproduction_rights_note": loan.reproduction_rights_note,
        # Closing
        "closing_invoice_sent": loan.closing_invoice_sent,
        "closing_invoice_date": _iso(loan.closing_invoice_date),
        "closing_invoice_reference": loan.closing_invoice_reference,
        "closing_invoice_amount": float(loan.closing_invoice_amount) if loan.closing_invoice_amount else None,
        "closing_invoice_currency": loan.closing_invoice_currency,
        "receipt_acknowledged": loan.receipt_acknowledged,
        "receipt_acknowledged_date": _iso(loan.receipt_acknowledged_date),
        "receipt_acknowledged_reference": loan.receipt_acknowledged_reference,
        "conditions_met_confirmed": loan.conditions_met_confirmed,
        "conditions_met_date": _iso(loan.conditions_met_date),
        "conditions_met_note": loan.conditions_met_note,
        "closing_note": loan.closing_note,
        # Status & audit
        "status": loan.status,
        "loan_note": loan.loan_note,
        "signed_document_types": _signed_document_types(loan),
        "created_at": _iso(loan.created_at),
        "updated_at": _iso(loan.updated_at),
    }


def _serialize_loan_out_object(obj: LoanOutObject, include_object: bool = False) -> dict:
    """Serialize a LoanOutObject to JSON."""
    result = {
        "loan_object_id": str(obj.loan_object_id),
        "loan_out_id": str(obj.loan_out_id),
        "organization_id": str(obj.organization_id),
        "object_id": str(obj.object_id),
        "insurance_value": float(obj.insurance_value) if obj.insurance_value else None,
        "insurance_currency": obj.insurance_currency,
        "display_credit_line": obj.display_credit_line,
        "display_label": obj.display_label,
        "display_requirements": obj.display_requirements,
        "installation_requirements": obj.installation_requirements,
        "special_conditions": obj.special_conditions,
        "handling_requirements": obj.handling_requirements,
        "environmental_requirements": obj.environmental_requirements,
        "condition_report_out_id": str(obj.condition_report_out_id) if obj.condition_report_out_id else None,
        "condition_report_out_number": obj.condition_report_out.report_number if obj.condition_report_out_id and obj.condition_report_out else None,
        "condition_report_return_id": str(obj.condition_report_return_id) if obj.condition_report_return_id else None,
        "condition_report_return_number": obj.condition_report_return.report_number if obj.condition_report_return_id and obj.condition_report_return else None,
        "exit_id": str(obj.exit_id) if obj.exit_id else None,
        "exit_number": obj.exit.exit_number if obj.exit_id and obj.exit else None,
        "photography_restrictions": obj.photography_restrictions,
        "item_status": obj.item_status,
        "dispatched_date": _iso(obj.dispatched_date),
        "returned_date": _iso(obj.returned_date),
        "damage_reported": obj.damage_reported,
        "damage_note": obj.damage_note,
        # Per-object procedure fields
        "valuation": float(obj.valuation) if obj.valuation else None,
        "valuation_currency": obj.valuation_currency,
        "valuation_date": _iso(obj.valuation_date),
        "dimensions_note": obj.dimensions_note,
        "ip_rights_note": obj.ip_rights_note,
        "estimated_costs": float(obj.estimated_costs) if obj.estimated_costs else None,
        "estimated_costs_currency": obj.estimated_costs_currency,
        "estimated_costs_note": obj.estimated_costs_note,
        "photography_permitted": obj.photography_permitted,
        "reproduction_rights_note": obj.reproduction_rights_note,
        "created_at": _iso(obj.created_at),
    }
    # Include object summary if requested
    if include_object and obj.object:
        # Get display title from title_links relationship
        display_title = None
        if obj.object.title_links:
            preferred = next((t for t in obj.object.title_links if t.is_preferred), None)
            display_title = preferred.title if preferred else (obj.object.title_links[0].title if obj.object.title_links else None)
        result["object"] = {
            "object_id": str(obj.object.object_id),
            "object_number": obj.object.object_number,
            "title": display_title,
            "titles": [
                {"title": t.title, "title_type": t.title_type, "language": t.language, "is_preferred": t.is_preferred}
                for t in (obj.object.title_links or [])
            ],
            "object_name": obj.object.object_name,
            "primary_image_url": None,
        }
    return result


def _serialize_conservation_treatment(treatment: ConservationTreatment) -> dict:
    """Serialize a ConservationTreatment to JSON."""
    return {
        "treatment_id": str(treatment.treatment_id),
        "organization_id": str(treatment.organization_id),
        "treatment_number": treatment.treatment_number,
        "object_id": str(treatment.object_id) if treatment.object_id else None,
        "conservator_id": str(treatment.conservator_id) if treatment.conservator_id else None,
        "conservator_name": treatment.conservator_name,
        "conservator_institution": treatment.conservator_institution,
        "treatment_type": treatment.treatment_type,
        "proposal_date": _iso(treatment.proposal_date),
        "proposal_summary": treatment.proposal_summary,
        "proposal_document_ref": treatment.proposal_document_ref,
        "estimated_duration_days": treatment.estimated_duration_days,
        "estimated_cost": float(treatment.estimated_cost) if treatment.estimated_cost else None,
        "estimated_cost_currency": treatment.estimated_cost_currency,
        "approval_date": _iso(treatment.approval_date),
        "approved_by": str(treatment.approved_by) if treatment.approved_by else None,
        "approval_note": treatment.approval_note,
        "start_date": _iso(treatment.start_date),
        "end_date": _iso(treatment.end_date),
        "actual_duration_days": treatment.actual_duration_days,
        "actual_cost": float(treatment.actual_cost) if treatment.actual_cost else None,
        "actual_cost_currency": treatment.actual_cost_currency,
        "treatment_description": treatment.treatment_description,
        "materials_used": [
            {"material_name": m.material_name, "manufacturer": m.manufacturer,
             "quantity": m.quantity, "purpose": m.purpose}
            for m in (treatment.materials or [])
        ],
        "cost_breakdown": [
            {"category": c.cost_category, "amount": float(c.amount) if c.amount else None,
             "currency": c.currency, "vendor": c.vendor}
            for c in (treatment.costs or [])
        ],
        "techniques_used": [
            {"name": t.technique_name, "description": t.description,
             "duration_hours": float(t.duration_hours) if t.duration_hours else None}
            for t in (treatment.techniques or [])
        ],
        "methods_used": treatment.methods_used,
        "condition_before_id": str(treatment.condition_before_id) if treatment.condition_before_id else None,
        "condition_after_id": str(treatment.condition_after_id) if treatment.condition_after_id else None,
        "before_images": [
            {"media_id": str(i.media_id) if i.media_id else None, "notes": i.caption}
            for i in (treatment.images or []) if i.image_phase == 'before'
        ],
        "after_images": [
            {"media_id": str(i.media_id) if i.media_id else None, "notes": i.caption}
            for i in (treatment.images or []) if i.image_phase == 'after'
        ],
        "documentation_images": [
            {"media_id": str(i.media_id) if i.media_id else None, "notes": i.caption}
            for i in (treatment.images or []) if i.image_phase == 'documentation'
        ],
        "recommendations": treatment.recommendations,
        "restrictions": treatment.restrictions,
        "status": treatment.status,
        "treatment_note": treatment.treatment_note,
        "created_at": _iso(treatment.created_at),
        "updated_at": _iso(treatment.updated_at),
    }


def _serialize_object_exit(exit_rec: ObjectExit) -> dict:
    """Serialize an ObjectExit to JSON."""
    return {
        "exit_id": str(exit_rec.exit_id),
        "organization_id": str(exit_rec.organization_id),
        "exit_number": exit_rec.exit_number,
        "exit_date": _iso(exit_rec.exit_date),
        "entry_id": str(exit_rec.entry_id) if exit_rec.entry_id else None,
        "recipient_id": str(exit_rec.recipient_id) if exit_rec.recipient_id else None,
        "recipient_name": exit_rec.recipient_name,
        "recipient_address": exit_rec.recipient_address,
        "recipient_contact": None,  # Removed: use recipient relationship
        "exit_reason": exit_rec.exit_reason,
        "reference_type": exit_rec.reference_type or None,
        "reference_id": str(exit_rec.reference_id) if exit_rec.reference_id else None,
        "authorization_id": str(exit_rec.authorization_id) if exit_rec.authorization_id else None,
        "authorization_date": _iso(exit_rec.authorization_date),
        "authorization_note": exit_rec.authorization_note,
        "exit_method": exit_rec.exit_method or None,
        "courier_contact": None,  # Removed: use courier relationship
        "insurance_value": float(exit_rec.insurance_value) if exit_rec.insurance_value else None,
        "insurance_currency": exit_rec.insurance_currency,
        "insurance_note": exit_rec.insurance_note,
        "condition_at_exit": exit_rec.condition_at_exit or None,
        "condition_report_id": str(exit_rec.condition_report_id) if exit_rec.condition_report_id else None,
        "receipt_acknowledged": exit_rec.receipt_acknowledged,
        "receipt_acknowledged_date": _iso(exit_rec.receipt_acknowledged_date),
        "receipt_acknowledged_by": exit_rec.receipt_acknowledged_by,
        "receipt_reference": exit_rec.receipt_reference,
        "receipt_note": exit_rec.receipt_note,
        "expected_return_date": _iso(exit_rec.expected_return_date),
        "expected_return_method": exit_rec.expected_return_method,
        "status": exit_rec.status,
        "exit_note": exit_rec.exit_note,
        "internal_note": exit_rec.internal_note,
        "signed_document_types": _signed_document_types(exit_rec),
        "created_at": _iso(exit_rec.created_at),
        "updated_at": _iso(exit_rec.updated_at),
    }


def _serialize_object_exit_item(item: ObjectExitItem) -> dict:
    """Serialize an ObjectExitItem to JSON."""
    return {
        "exit_item_id": str(item.exit_item_id),
        "exit_id": str(item.exit_id),
        "organization_id": str(item.organization_id),
        "object_id": str(item.object_id) if item.object_id else None,
        "item_number": item.item_number,
        "brief_description": item.brief_description,
        "condition_note": item.condition_note,
        "condition_report_id": str(item.condition_report_id) if item.condition_report_id else None,
        "insurance_value": float(item.insurance_value) if item.insurance_value else None,
        "insurance_currency": item.insurance_currency,
        "item_status": item.item_status,
        "dispatched_date": _iso(item.dispatched_date),
        "acknowledged_date": _iso(item.acknowledged_date),
        "created_at": _iso(item.created_at),
    }


def _serialize_deaccession(deacc: Deaccession) -> dict:
    """Serialize a Deaccession to JSON."""
    return {
        "deaccession_id": str(deacc.deaccession_id),
        "organization_id": str(deacc.organization_id),
        "deaccession_number": deacc.deaccession_number,
        "object_id": str(deacc.object_id),
        "proposal_date": _iso(deacc.proposal_date),
        "proposed_by": str(deacc.proposed_by) if deacc.proposed_by else None,
        "reason": deacc.reason,
        "reason_detail": deacc.reason_detail,
        "justification": deacc.justification,
        "disposal_method": deacc.disposal_method,
        "disposal_method_detail": deacc.disposal_method_detail,
        "recipient_id": str(deacc.recipient_id) if deacc.recipient_id else None,
        "recipient_name": deacc.recipient_name,
        "recipient_contact": None,  # Removed: use recipient relationship
        "committee_review_required": deacc.committee_review_required,
        "committee_review_date": _iso(deacc.committee_review_date),
        "committee_members": [
            {"member_name": v.voter_name, "role": v.voter_title,
             "vote": v.vote, "vote_date": _iso(v.vote_date)}
            for v in (deacc.votes or [])
        ],
        "committee_recommendation": deacc.committee_recommendation,
        "committee_note": deacc.committee_note,
        "board_approval_required": deacc.board_approval_required,
        "board_approval_date": _iso(deacc.board_approval_date),
        "board_approval_reference": deacc.board_approval_reference,
        "board_resolution": deacc.board_resolution,
        "board_note": deacc.board_note,
        "legal_review_required": deacc.legal_review_required,
        "legal_review_date": _iso(deacc.legal_review_date),
        "legal_review_note": deacc.legal_review_note,
        "legal_cleared": deacc.legal_cleared,
        "provenance_review_required": deacc.provenance_review_required,
        "provenance_review_complete": deacc.provenance_review_complete,
        "provenance_review_date": _iso(deacc.provenance_review_date),
        "provenance_review_note": deacc.provenance_review_note,
        "provenance_issues_found": deacc.provenance_issues_found,
        "donor_restrictions_exist": deacc.donor_restrictions_exist,
        "donor_restrictions_note": deacc.donor_restrictions_note,
        "donor_notified": deacc.donor_notified,
        "donor_notified_date": _iso(deacc.donor_notified_date),
        "appraised_value": float(deacc.appraised_value) if deacc.appraised_value else None,
        "appraised_value_currency": deacc.appraised_value_currency,
        "appraised_date": _iso(deacc.appraised_date),
        "appraiser_name": deacc.appraiser_name,
        "sale_method": deacc.sale_method,
        "sale_price": float(deacc.sale_price) if deacc.sale_price else None,
        "sale_currency": deacc.sale_currency,
        "sale_date": _iso(deacc.sale_date),
        "sale_reference": deacc.sale_reference,
        "buyer_name": deacc.buyer_name,
        "proceeds_usage": deacc.proceeds_usage,
        "public_notice_required": deacc.public_notice_required,
        "public_notice_date": _iso(deacc.public_notice_date),
        "public_notice_publication": deacc.public_notice_publication,
        "public_notice_reference": deacc.public_notice_reference,
        "public_notice_period_end": _iso(deacc.public_notice_period_end),
        "exit_id": str(deacc.exit_id) if deacc.exit_id else None,
        "deaccession_date": _iso(deacc.deaccession_date),
        "status": deacc.status,
        "completion_date": _iso(deacc.completion_date),
        "deaccession_note": deacc.deaccession_note,
        "internal_note": deacc.internal_note,
        "signed_document_types": _signed_document_types(deacc),
        "created_at": _iso(deacc.created_at),
        "updated_at": _iso(deacc.updated_at),
    }


def _serialize_deaccession_audit(audit: DeaccessionAudit) -> dict:
    """Serialize a DeaccessionAudit to JSON."""
    return {
        "audit_id": str(audit.audit_id),
        "deaccession_id": str(audit.deaccession_id),
        "organization_id": str(audit.organization_id),
        "action": audit.action,
        "field_name": audit.field_name,
        "old_value": audit.old_value,
        "new_value": audit.new_value,
        "performed_by": str(audit.performed_by) if audit.performed_by else None,
        "performed_by_name": audit.performed_by_name,
        "performed_at": _iso(audit.performed_at),
        "ip_address": audit.ip_address,
        "user_agent": audit.user_agent,
        "session_id": audit.session_id,
        "note": audit.note,
    }


def _serialize_other_number_type(t: OtherNumberType) -> dict:
    """Serialize an OtherNumberType to JSON."""
    return {
        "type_id": str(t.type_id),
        "organization_id": str(t.organization_id),
        "name": t.name,
        "code": t.code,
        "description": t.description,
        "sort_order": t.sort_order,
        "is_active": t.is_active,
        "is_system": t.is_system,
        "created_at": _iso(t.created_at),
    }


def _serialize_collection_object_media(link: CollectionObjectMedia, include_media: bool = True, session=None, user_id: str | None = None) -> dict:
    """Serialize a CollectionObjectMedia link to JSON."""
    result = {
        "object_id": str(link.object_id),
        "media_id": str(link.media_id),
        "is_primary": link.is_primary,
        "sort_order": link.sort_order,
        "caption_override": link.caption_override,
        "usage_type": link.usage_type,
        "created_at": _iso(link.created_at),
    }

    if include_media and link.media:
        result["media"] = _serialize_media(link.media, session=session, user_id=user_id)

    return result


def _serialize_nagpra_action(action: NagpraAction) -> dict:
    """Serialize a NagpraAction to JSON."""
    return {
        "action_id": str(action.action_id),
        "organization_id": str(action.organization_id),
        "object_id": str(action.object_id),
        "action_number": action.action_number,
        "group_reference": action.group_reference,
        "origin_type": action.origin_type,
        # Categorization
        "nagpra_category": action.nagpra_category,
        "funerary_association": action.funerary_association,
        "category_basis": action.category_basis,
        "category_determined_date": _iso(action.category_determined_date),
        "category_determined_by": str(action.category_determined_by) if action.category_determined_by else None,
        # Geographic / cultural context
        "geographic_origin": action.geographic_origin,
        "site_name": action.site_name,
        "state": action.state,
        "county": action.county,
        # Cultural affiliation
        "affiliation_status": action.affiliation_status,
        "affiliated_party_id": str(action.affiliated_party_id) if action.affiliated_party_id else None,
        "affiliation_basis": action.affiliation_basis,
        "affiliation_evidence_types": action.affiliation_evidence_types,
        "affiliation_determined_date": _iso(action.affiliation_determined_date),
        # Duty of care
        "display_consent": action.display_consent,
        "display_consent_date": _iso(action.display_consent_date),
        "access_consent": action.access_consent,
        "access_consent_date": _iso(action.access_consent_date),
        "research_consent": action.research_consent,
        "research_consent_date": _iso(action.research_consent_date),
        "handling_preferences": action.handling_preferences,
        "storage_preferences": action.storage_preferences,
        # Hold
        "hold_active": action.hold_active,
        # Federal Register notice
        "notice_type": action.notice_type,
        "notice_submitted_date": _iso(action.notice_submitted_date),
        "notice_published_date": _iso(action.notice_published_date),
        "notice_fr_citation": action.notice_fr_citation,
        "waiting_period_end_date": _iso(action.waiting_period_end_date),
        # Transfer / repatriation
        "transfer_date": _iso(action.transfer_date),
        "transfer_recipient_id": str(action.transfer_recipient_id) if action.transfer_recipient_id else None,
        "transfer_method": action.transfer_method,
        "transfer_note": action.transfer_note,
        "deaccession_id": str(action.deaccession_id) if action.deaccession_id else None,
        # Coordinator
        "coordinator_id": str(action.coordinator_id) if action.coordinator_id else None,
        # Key dates
        "identified_date": _iso(action.identified_date),
        "consultation_initiated_date": _iso(action.consultation_initiated_date),
        "closed_date": _iso(action.closed_date),
        "inventory_deadline": _iso(action.inventory_deadline),
        # Status
        "status": action.status,
        "action_note": action.action_note,
        "internal_note": action.internal_note,
        # Audit
        "created_at": _iso(action.created_at),
        "created_by": str(action.created_by) if action.created_by else None,
        "updated_at": _iso(action.updated_at),
        "updated_by": str(action.updated_by) if action.updated_by else None,
    }


def _serialize_nagpra_consultation_event(event: NagpraConsultationEvent) -> dict:
    """Serialize a NagpraConsultationEvent to JSON."""
    return {
        "event_id": str(event.event_id),
        "action_id": str(event.action_id),
        "organization_id": str(event.organization_id),
        "consulting_party_id": str(event.consulting_party_id) if event.consulting_party_id else None,
        "consulting_party_name": event.consulting_party_name,
        "event_date": _iso(event.event_date),
        "event_type": event.event_type,
        "direction": event.direction,
        "subject": event.subject,
        "description": event.description,
        "participants": event.participants,
        "outcomes": event.outcomes,
        "follow_up_required": event.follow_up_required,
        "follow_up_date": _iso(event.follow_up_date),
        "follow_up_note": event.follow_up_note,
        "document_references": event.document_references,
        "recorded_by": str(event.recorded_by) if event.recorded_by else None,
        "created_at": _iso(event.created_at),
    }
