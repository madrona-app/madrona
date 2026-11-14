"""
Entity Audit Service - SQLAlchemy session event listener for tracking entity changes.

Captures all field-level changes to tracked entities (Collections and Media) using
SQLAlchemy's before_flush event. This ensures:
- Zero changes to 100+ API endpoints
- Audit records are added to the same transaction (rollback = no audit)
- All creates, updates, and deletes are captured automatically

Also tracks junction/link table changes (e.g., adding an object to a loan) and
creates audit events on the parent entity with link_added/link_removed/link_updated
change types.

Platform admin feature for answering "what happened to this data?"
"""

import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app import context as ctx
from app.database import Base
from app.models import EntityAuditEvent, EntityAuditFieldDiff, User

logger = logging.getLogger(__name__)


# ============================================================================
# Tracked Entity Configuration
# ============================================================================

# Map of SQLAlchemy model class names to their audit configuration
# display_key: attribute name used for human-readable identification
# entity_type: string identifier stored in audit records
TRACKED_ENTITIES: dict[str, dict[str, str]] = {
    # Collections entities
    "CollectionObject": {"display_key": "object_number", "entity_type": "collection_object"},
    "Location": {"display_key": "code", "entity_type": "location"},
    "Movement": {"display_key": "movement_reference_number", "entity_type": "movement"},
    "Constituent": {"display_key": "display_name", "entity_type": "constituent"},
    "ConditionReport": {"display_key": "report_number", "entity_type": "condition_report"},
    "ObjectEntry": {"display_key": "entry_number", "entity_type": "object_entry"},
    "Acquisition": {"display_key": "acquisition_number", "entity_type": "acquisition"},
    "LoanIn": {"display_key": "loan_number", "entity_type": "loan_in"},
    "LoanOut": {"display_key": "loan_number", "entity_type": "loan_out"},
    "ConservationTreatment": {"display_key": "treatment_number", "entity_type": "conservation_treatment"},
    "ObjectExit": {"display_key": "exit_number", "entity_type": "object_exit"},
    "Deaccession": {"display_key": "deaccession_number", "entity_type": "deaccession"},
    "DocumentationPlan": {"display_key": "plan_number", "entity_type": "documentation_plan"},
    "EmergencyPlan": {"display_key": "plan_number", "entity_type": "emergency_plan"},
    "IncidentReport": {"display_key": "report_number", "entity_type": "incident_report"},
    "CollectionsReview": {"display_key": "review_number", "entity_type": "collections_review"},
    "AuditCampaign": {"display_key": "campaign_number", "entity_type": "audit_campaign"},
    "ObjectRight": {"display_key": "rights_reference", "entity_type": "object_right"},
    "UseRequest": {"display_key": "request_number", "entity_type": "use_request"},
    "Valuation": {"display_key": "valuation_reference", "entity_type": "valuation"},
    "ReproductionRequest": {"display_key": "request_number", "entity_type": "reproduction_request"},
    "Citation": {"display_key": "brief_citation", "entity_type": "citation"},
    "ResearchVisit": {"display_key": "researcher_name", "entity_type": "research_visit"},
    # Library catalogue
    "BibRecord": {"display_key": "title", "entity_type": "bib_record"},
    # Insurance and indemnity ("insurance" matches the staff workspace route)
    "InsurancePolicy": {"display_key": "policy_number", "entity_type": "insurance"},
    "IndemnityArrangement": {"display_key": "reference_number", "entity_type": "indemnity_arrangement"},
    "InsuranceClaim": {"display_key": "claim_number", "entity_type": "insurance_claim"},
    # Exhibitions and logistics
    "Exhibition": {"display_key": "title", "entity_type": "exhibition"},
    "Crate": {"display_key": "crate_number", "entity_type": "crate"},
    # Media entities
    "Media": {"display_key": "filename", "entity_type": "media"},
    "MediaCollection": {"display_key": "name", "entity_type": "media_collection"},
    "MediaRights": {"display_key": "rights_statement", "entity_type": "media_rights"},
    "MediaConsent": {"display_key": "consent_type", "entity_type": "media_consent"},
    "WatermarkTemplate": {"display_key": "name", "entity_type": "watermark_template"},
    "MediaTagDefinition": {"display_key": "name", "entity_type": "media_tag_definition"},
    "MediaFolder": {"display_key": "name", "entity_type": "media_folder"},
}


# ============================================================================
# Tracked Link (Junction Table) Configuration
# ============================================================================

# Map junction model class names → how to create an audit event on the parent entity.
#
# parent_fk:        FK column on the junction that points to the parent entity
# parent_type:      entity_type string for the parent (must be in TRACKED_ENTITIES)
# parent_model:     class name of the parent entity (for session.get lookups)
# link_label:       human-readable label for summaries ("Added loan object: ...")
# display_field:    (optional) field on junction itself for display name
# linked_fk:        (optional) FK column pointing to the "other" entity
# linked_model:     (optional) class name of the linked entity
# linked_display:   (optional) field on linked entity used for display name fallback
# child_type:       (optional) entity type of the child row itself, stored on the
#                   event as child_entity_type so the row can be identified later
# child_id_field:   (optional) column holding the child's identity when the
#                   primary key is composite (defaults to the first PK column)
# parent_via_model: (optional) for grandchildren: parent_fk points at this model,
# parent_via_fk:    whose parent_via_fk column holds the real parent id
#                   (a BibItem's holding -> the holding's bib record)
# composite:        (optional) "name=part1,part2": report these columns as one
#                   readable value ("10 cm" rather than value 10, unit cm)
# exclude_fields:   (optional) comma-separated columns left out of diffs
TRACKED_LINKS: dict[str, dict[str, str]] = {
    "LoanInObject": {
        "parent_fk": "loan_in_id",
        "parent_type": "loan_in",
        "parent_model": "LoanIn",
        "link_label": "loan object",
        "display_field": "object_title",
        "linked_fk": "object_id",
        "linked_model": "CollectionObject",
        "linked_display": "object_number",
    },
    "LoanInEntry": {
        "parent_fk": "loan_in_id",
        "parent_type": "loan_in",
        "parent_model": "LoanIn",
        "link_label": "linked entry",
        "linked_fk": "entry_id",
        "linked_model": "ObjectEntry",
        "linked_display": "entry_number",
    },
    "LoanOutObject": {
        "parent_fk": "loan_out_id",
        "parent_type": "loan_out",
        "parent_model": "LoanOut",
        "link_label": "loan object",
        "linked_fk": "object_id",
        "linked_model": "CollectionObject",
        "linked_display": "object_number",
    },
    "AcquisitionObject": {
        "parent_fk": "acquisition_id",
        "parent_type": "acquisition",
        "parent_model": "Acquisition",
        "link_label": "acquisition object",
        "linked_fk": "object_id",
        "linked_model": "CollectionObject",
        "linked_display": "object_number",
    },
    "ObjectEntryItem": {
        "parent_fk": "entry_id",
        "parent_type": "object_entry",
        "parent_model": "ObjectEntry",
        "link_label": "entry item",
        "display_field": "brief_description",
        "linked_fk": "object_id",
        "linked_model": "CollectionObject",
        "linked_display": "object_number",
    },
    "ObjectExitItem": {
        "parent_fk": "exit_id",
        "parent_type": "object_exit",
        "parent_model": "ObjectExit",
        "link_label": "exit item",
        "display_field": "brief_description",
        "linked_fk": "object_id",
        "linked_model": "CollectionObject",
        "linked_display": "object_number",
    },
    "IncidentReportObject": {
        "parent_fk": "report_id",
        "parent_type": "incident_report",
        "parent_model": "IncidentReport",
        "link_label": "affected object",
        "display_field": "damage_description",
        "linked_fk": "object_id",
        "linked_model": "CollectionObject",
        "linked_display": "object_number",
    },
    "UseRequestObject": {
        "parent_fk": "request_id",
        "parent_type": "use_request",
        "parent_model": "UseRequest",
        "link_label": "requested object",
        "display_field": "object_note",
        "linked_fk": "object_id",
        "linked_model": "CollectionObject",
        "linked_display": "object_number",
    },
    "ObjectReviewAssessment": {
        "parent_fk": "review_id",
        "parent_type": "collections_review",
        "parent_model": "CollectionsReview",
        "link_label": "object assessment",
        "display_field": "assessment_note",
        "linked_fk": "object_id",
        "linked_model": "CollectionObject",
        "linked_display": "object_number",
    },
    "ObjectCitation": {
        "parent_fk": "object_id",
        "parent_type": "collection_object",
        "parent_model": "CollectionObject",
        "link_label": "citation",
        "display_field": "page_reference",
        "linked_fk": "citation_id",
        "linked_model": "Citation",
        "linked_display": "brief_citation",
    },
    "ObjectPlaceAuthority": {
        "parent_fk": "object_id",
        "parent_type": "collection_object",
        "parent_model": "CollectionObject",
        "link_label": "place",
        "display_field": "role",
        "linked_fk": "place_authority_id",
        "linked_model": "PlaceAuthority",
        "linked_display": "display_name",
    },
    "ObjectRelationship": {
        "parent_fk": "source_object_id",
        "parent_type": "collection_object",
        "parent_model": "CollectionObject",
        "link_label": "related work",
        "display_field": "related_work_title",
        "linked_fk": "related_object_id",
        "linked_model": "CollectionObject",
        "linked_display": "object_number",
    },
    "ObjectMaterial": {
        "parent_fk": "object_id",
        "parent_type": "collection_object",
        "parent_model": "CollectionObject",
        "link_label": "material",
        "display_field": "part",
    },
    "ObjectTechnique": {
        "parent_fk": "object_id",
        "parent_type": "collection_object",
        "parent_model": "CollectionObject",
        "link_label": "technique",
        "display_field": "part",
    },
    "ObjectSubject": {
        "parent_fk": "object_id",
        "parent_type": "collection_object",
        "parent_model": "CollectionObject",
        "link_label": "subject",
        "display_field": "subject_extent",
    },
    "ObjectStylePeriod": {
        "parent_fk": "object_id",
        "parent_type": "collection_object",
        "parent_model": "CollectionObject",
        "link_label": "style/period",
        "display_field": "assignment_note",
    },
    "ObjectContext": {
        "parent_fk": "object_id",
        "parent_type": "collection_object",
        "parent_model": "CollectionObject",
        "link_label": "context",
        "display_field": "context_type",
    },
    "ObjectPart": {
        "parent_fk": "object_id",
        "parent_type": "collection_object",
        "parent_model": "CollectionObject",
        "link_label": "object part",
        "display_field": "name",
    },
    # ---- Object child rows (cataloguing detail) ----
    "ObjectTitle": {
        "parent_fk": "object_id",
        "parent_type": "collection_object",
        "parent_model": "CollectionObject",
        "link_label": "title",
        "display_field": "title",
        "child_type": "object_title",
    },
    "ObjectOtherNumber": {
        "parent_fk": "object_id",
        "parent_type": "collection_object",
        "parent_model": "CollectionObject",
        "link_label": "other number",
        "display_field": "number_type",
        "child_type": "object_other_number",
    },
    "ObjectMeasurement": {
        "parent_fk": "object_id",
        "parent_type": "collection_object",
        "parent_model": "CollectionObject",
        "link_label": "measurement",
        "display_field": "dimension",
        "child_type": "object_measurement",
        "composite": "measurement=value,unit",
    },
    "ObjectInscription": {
        "parent_fk": "object_id",
        "parent_type": "collection_object",
        "parent_model": "CollectionObject",
        "link_label": "inscription",
        "display_field": "content",
        "child_type": "object_inscription",
    },
    "CollectionObjectMedia": {
        "parent_fk": "object_id",
        "parent_type": "collection_object",
        "parent_model": "CollectionObject",
        "link_label": "media",
        "linked_fk": "media_id",
        "linked_model": "Media",
        "linked_display": "filename",
        "child_type": "collection_object_media",
        "child_id_field": "media_id",
    },
    "ObjectFlag": {
        "parent_fk": "object_id",
        "parent_type": "collection_object",
        "parent_model": "CollectionObject",
        "link_label": "flag",
        "linked_fk": "flag_id",
        "linked_model": "RecordFlagDefinition",
        "linked_display": "label",
        "child_type": "object_flag",
        "child_id_field": "flag_id",
        "exclude_fields": "set_at",
    },
    "ObjectClassification": {
        "parent_fk": "object_id",
        "parent_type": "collection_object",
        "parent_model": "CollectionObject",
        "link_label": "classification",
        "linked_fk": "value_id",
        "linked_model": "LookupValue",
        "linked_display": "label",
        "child_type": "object_classification",
    },
    # ---- Library catalogue ----
    "BibHolding": {
        "parent_fk": "bib_record_id",
        "parent_type": "bib_record",
        "parent_model": "BibRecord",
        "link_label": "holding",
        "display_field": "call_number",
        "child_type": "bib_holding",
    },
    "BibItem": {
        "parent_fk": "holding_id",
        "parent_type": "bib_record",
        "parent_model": "BibRecord",
        "parent_via_model": "BibHolding",
        "parent_via_fk": "bib_record_id",
        "link_label": "item",
        "display_field": "barcode",
        "child_type": "bib_item",
    },
    # ---- Research visits ----
    "ResearchVisitObject": {
        "parent_fk": "visit_id",
        "parent_type": "research_visit",
        "parent_model": "ResearchVisit",
        "link_label": "object",
        "linked_fk": "object_id",
        "linked_model": "CollectionObject",
        "linked_display": "object_number",
        "child_type": "research_visit_object",
    },
    # ---- Insurance and indemnity ----
    "InsuranceCoverage": {
        "parent_fk": "policy_id",
        "parent_type": "insurance",
        "parent_model": "InsurancePolicy",
        "link_label": "coverage",
        "display_field": "covered_entity_type",
        "child_type": "insurance_coverage",
    },
    "IndemnityObject": {
        "parent_fk": "indemnity_id",
        "parent_type": "indemnity_arrangement",
        "parent_model": "IndemnityArrangement",
        "link_label": "indemnified object",
        "display_field": "object_number",
        "linked_fk": "object_id",
        "linked_model": "CollectionObject",
        "linked_display": "object_number",
        "child_type": "indemnity_object",
    },
    # ---- Exhibitions ----
    "ExhibitionObject": {
        "parent_fk": "exhibition_id",
        "parent_type": "exhibition",
        "parent_model": "Exhibition",
        "link_label": "object",
        "linked_fk": "object_id",
        "linked_model": "CollectionObject",
        "linked_display": "object_number",
        "child_type": "exhibition_object",
    },
    "ExhibitionVenue": {
        "parent_fk": "exhibition_id",
        "parent_type": "exhibition",
        "parent_model": "Exhibition",
        "link_label": "venue",
        "display_field": "external_venue_name",
        "linked_fk": "venue_id",
        "linked_model": "Venue",
        "linked_display": "name",
        "child_type": "exhibition_venue",
        "exclude_fields": "geom",
    },
    # ConstituentXref is polymorphic — handled specially via _resolve_constituent_xref_parent
}

# ConstituentXref entity_type → (parent_model class name, parent entity_type)
_CONSTITUENT_XREF_PARENT_TYPES: dict[str, tuple[str, str]] = {
    "collection_object": ("CollectionObject", "collection_object"),
    "valuation": ("Valuation", "valuation"),
    "movement": ("Movement", "movement"),
    "loan_in": ("LoanIn", "loan_in"),
    "loan_out": ("LoanOut", "loan_out"),
    "object_entry": ("ObjectEntry", "object_entry"),
    "object_exit": ("ObjectExit", "object_exit"),
    "conservation_treatment": ("ConservationTreatment", "conservation_treatment"),
    "condition_report": ("ConditionReport", "condition_report"),
    "acquisition": ("Acquisition", "acquisition"),
    "deaccession": ("Deaccession", "deaccession"),
    "exhibition": ("Exhibition", "exhibition"),
    "event": ("Event", "event"),
}


# Fields to exclude from audit logging (metadata fields managed by the system)
EXCLUDED_FIELDS: set[str] = {
    "updated_at",
    "updated_by",
    "created_at",
    "created_by",
    "created_by_id",
    "updated_by_id",
}

# Also exclude these FK/org fields from link diffs (they're redundant context)
_LINK_EXCLUDED_FIELDS: set[str] = EXCLUDED_FIELDS | {
    "organization_id",
    # ConstituentXref internal fields (redundant with link context)
    "entity_type",
    "entity_id",
    "constituent_id",
    "display_order",
    "is_primary",
}

# FK columns that should be tracked in audit history.
# Maps column name → (related model class name, display field on that model).
# When these FKs change, the audit resolves the UUID to a human-readable name.
_TRACKED_FK_COLUMNS: dict[str, tuple[str, str]] = {
    "depositor_id": ("Constituent", "name"),
    "current_owner_id": ("Constituent", "name"),
    "terms_accepted_by_id": ("Constituent", "name"),
    "source_id": ("Constituent", "name"),
    "lender_id": ("Constituent", "name"),
    "lender_authorizer_id": ("Constituent", "name"),
    "borrower_id": ("Constituent", "name"),
    "conservator_id": ("Constituent", "name"),
    "recipient_id": ("Constituent", "name"),
    "courier_id": ("Constituent", "name"),
    "ship_from_contact_id": ("Constituent", "name"),
    "ship_to_contact_id": ("Constituent", "name"),
    "carrier_id": ("Constituent", "name"),
    "appraiser_id": ("Constituent", "name"),
    "rights_holder_contact_id": ("Constituent", "name"),
    "rights_holder_agent_contact_id": ("Constituent", "name"),
    "valuator_id": ("Constituent", "name"),
    "handler_id": ("Constituent", "name"),
    "instructor_id": ("Constituent", "name"),
    "home_location_id": ("Location", "code"),
    "current_location_id": ("Location", "code"),
    "normal_location_id": ("Location", "code"),
    # Who an object was last inventoried by (set by bulk "mark inventoried").
    "last_inventoried_by": ("User", "display_name|email"),
}

# Per-model FK columns, for names that mean different things on different
# models (authorizer_id is a person on most procedures but a staff user on an
# exhibition; venue_id is a venue on an exhibition but a constituent on a
# loan out). Checked before _TRACKED_FK_COLUMNS.
_ENTITY_FK_COLUMNS: dict[str, dict[str, tuple[str, str]]] = {
    "Exhibition": {
        "venue_id": ("Venue", "name"),
        "organizer_id": ("User", "display_name|email"),
        "authorizer_id": ("User", "display_name|email"),
        "department_id": ("Department", "name"),
    },
    "Crate": {
        "location_id": ("Location", "code"),
    },
}

# Column names whose meaning depends on the model: only tracked where a model
# lists them in _ENTITY_FK_COLUMNS.
_AMBIGUOUS_FK_NAMES: set[str] = {"authorizer_id", "venue_id", "organizer_id", "location_id", "department_id"}


# ============================================================================
# Helper Functions
# ============================================================================


def _get_entity_pk(obj: Any) -> UUID | None:
    """Get the primary key UUID from an entity object."""
    mapper = inspect(obj.__class__)
    pk_columns = mapper.primary_key
    if pk_columns:
        pk_attr = pk_columns[0].name
        return getattr(obj, pk_attr, None)
    return None


def _get_organization_id(obj: Any) -> UUID | None:
    """Get the organization_id from an entity object."""
    return getattr(obj, "organization_id", None)


def _get_display_key(obj: Any, config: dict[str, str]) -> str | None:
    """Get the human-readable display key for an entity."""
    display_key_attr = config.get("display_key")
    if display_key_attr:
        value = getattr(obj, display_key_attr, None)
        if value is not None:
            return str(value)[:500]  # Truncate to fit column
    return None


def _get_request_context() -> dict[str, str | None]:
    """Get request context if available."""
    path = ctx.request_path.get()
    return {
        "request_path": path[:500] if path else None,
        "request_method": ctx.request_method.get(),
        "ip_address": ctx.request_remote_addr.get(),
        "user_agent": (ctx.request_user_agent.get() or "")[:500] or None,
    }


def _get_current_user(session: Session) -> tuple[UUID | None, str | None, str | None]:
    """
    Get current user ID and denormalized name/email.

    Returns (user_id, display_name, email) tuple.
    """
    raw_user_id = ctx.request_user_id.get()
    if raw_user_id:
        try:
            user_id = UUID(str(raw_user_id))
            # Query for user details (use the provided session)
            user = session.get(User, user_id)
            if user:
                return user_id, user.display_name or user.email, user.email
            return user_id, None, None
        except (ValueError, TypeError):
            pass
    return None, None, None


def _serialize_value(value: Any) -> Any:
    """Serialize a value for JSONB storage."""
    if value is None:
        return None
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "isoformat"):  # date, time
        return value.isoformat()
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, dict)):
        # Recursively serialize
        if isinstance(value, list):
            return [_serialize_value(v) for v in value]
        return {k: _serialize_value(v) for k, v in value.items()}
    # For SQLAlchemy models or other objects, convert to string
    return str(value)


def _normalize_empty(value: Any) -> Any:
    """Normalize empty-ish values to None so spurious diffs are suppressed.

    Treats "", [], {}, and None as equivalent empty values.
    """
    if value is None:
        return None
    if value == "":
        return None
    if value == [] or value == {}:
        return None
    return value


def _fk_config(class_name: str | None, field_name: str) -> tuple[str, str] | None:
    """(model, display field) for a tracked FK column, per model first."""
    per_model = _ENTITY_FK_COLUMNS.get(class_name or "", {})
    if field_name in per_model:
        return per_model[field_name]
    if class_name in _ENTITY_FK_COLUMNS and field_name in _AMBIGUOUS_FK_NAMES:
        return None
    return _TRACKED_FK_COLUMNS.get(field_name)


def _resolve_fk_display(session: Session, field_name: str, fk_value: Any, class_name: str | None = None) -> str | None:
    """Resolve a tracked FK UUID to a human-readable display name."""
    if fk_value is None:
        return None
    fk_config = _fk_config(class_name, field_name)
    if not fk_config:
        return str(fk_value)
    model_name, display_field = fk_config
    try:
        model_class = _resolve_model_class(session, model_name)
        if model_class is None:
            return str(fk_value)
        pk_col = inspect(model_class).primary_key[0]
        related = session.get(model_class, fk_value)
        if related:
            # "a|b": the first of these attributes that has a value.
            for attr in display_field.split("|"):
                value = getattr(related, attr, None)
                if value:
                    return value
            return str(fk_value)
    except Exception:
        pass
    return str(fk_value)


def _get_field_changes(obj: Any, session: Session | None = None) -> list[tuple[str, Any, Any]]:
    """
    Get list of changed fields with old and new values.

    Returns list of (field_name, old_value, new_value) tuples.
    Uses SQLAlchemy's attribute history to determine changes.
    """
    changes = []
    mapper = inspect(obj.__class__)
    state = inspect(obj)
    class_name = obj.__class__.__name__

    for attr in mapper.column_attrs:
        field_name = attr.key
        if field_name in EXCLUDED_FIELDS:
            continue
        col = attr.columns[0]
        if col.primary_key:
            continue
        # Skip FKs unless they are in the tracked list
        if col.foreign_keys and _fk_config(class_name, field_name) is None:
            continue

        history = state.attrs[field_name].history
        if history.has_changes():
            # history.deleted contains old values, history.added contains new values
            old_val = history.deleted[0] if history.deleted else None
            new_val = history.added[0] if history.added else None

            # Only record if there's an actual change
            # Normalize empty-ish values so "" vs None, [] vs None, etc. aren't spurious diffs
            old_ser = _normalize_empty(_serialize_value(old_val))
            new_ser = _normalize_empty(_serialize_value(new_val))
            if old_ser != new_ser:
                # For tracked FK columns, resolve UUIDs to display names
                if col.foreign_keys and session is not None:
                    old_val = _resolve_fk_display(session, field_name, old_val, class_name)
                    new_val = _resolve_fk_display(session, field_name, new_val, class_name)
                changes.append((field_name, old_val, new_val))

    return changes


def _get_all_fields(obj: Any, session: Session | None = None) -> list[tuple[str, Any]]:
    """Get all field values for a new entity (for creates)."""
    fields = []
    mapper = inspect(obj.__class__)
    class_name = obj.__class__.__name__

    for attr in mapper.column_attrs:
        field_name = attr.key
        if field_name in EXCLUDED_FIELDS:
            continue
        col = attr.columns[0]
        if col.primary_key:
            continue
        if col.foreign_keys and _fk_config(class_name, field_name) is None:
            continue

        value = getattr(obj, field_name, None)
        if value is not None:
            # For tracked FK columns, resolve UUIDs to display names
            if col.foreign_keys and session is not None:
                value = _resolve_fk_display(session, field_name, value, class_name) or value
            fields.append((field_name, value))

    return fields


def _generate_summary(change_type: str, entity_type: str, changed_fields: list[str] | None) -> str:
    """Generate a human-readable summary of the change."""
    if change_type == "created":
        return f"Created {entity_type.replace('_', ' ')}"
    elif change_type == "deleted":
        return f"Deleted {entity_type.replace('_', ' ')}"
    elif change_type == "updated" and changed_fields:
        field_count = len(changed_fields)
        if field_count == 1:
            return f"Updated {changed_fields[0]}"
        elif field_count <= 3:
            return f"Updated {', '.join(changed_fields)}"
        else:
            return f"Updated {field_count} fields"
    return f"Updated {entity_type.replace('_', ' ')}"


# ============================================================================
# Linked Record (Junction Table) Helpers
# ============================================================================


def _resolve_model_class(session: Session, class_name: str) -> Any:
    """Resolve a model class from its name via the SQLAlchemy registry."""
    for mapper in session.identity_map.values():
        # Check if any object in the session matches
        pass
    # Use the registry from the db metadata
    for mapper_obj in Base.registry.mappers:
        if mapper_obj.class_.__name__ == class_name:
            return mapper_obj.class_
    return None


def _get_link_display_name(session: Session, obj: Any, link_config: dict[str, str]) -> str | None:
    """
    Resolve a human-readable display name for a link event.

    Priority:
    1. display_field on the junction record itself
    2. linked_display on the linked entity (via FK lookup)
    3. None
    """
    # Try display_field on junction
    display_field = link_config.get("display_field")
    if display_field:
        value = getattr(obj, display_field, None)
        if value is not None:
            return str(value)[:200]

    # Try looking up the linked entity
    linked_fk = link_config.get("linked_fk")
    linked_model_name = link_config.get("linked_model")
    linked_display_attr = link_config.get("linked_display")

    if linked_fk and linked_model_name and linked_display_attr:
        linked_id = getattr(obj, linked_fk, None)
        if linked_id:
            linked_class = _resolve_model_class(session, linked_model_name)
            if linked_class:
                try:
                    linked_obj = session.get(linked_class, linked_id)
                    if linked_obj:
                        value = getattr(linked_obj, linked_display_attr, None)
                        if value is not None:
                            return str(value)[:200]
                except Exception:
                    pass

    return None


def _resolve_linked_entity_name(
    session: Session, obj: Any, link_config: dict[str, str]
) -> str | None:
    """Resolve the display name of the linked entity (not the junction record itself)."""
    linked_fk = link_config.get("linked_fk")
    linked_model_name = link_config.get("linked_model")
    linked_display_attr = link_config.get("linked_display")

    if linked_fk and linked_model_name and linked_display_attr:
        linked_id = getattr(obj, linked_fk, None)
        if linked_id:
            linked_class = _resolve_model_class(session, linked_model_name)
            if linked_class:
                try:
                    linked_obj = session.get(linked_class, linked_id)
                    if linked_obj:
                        value = getattr(linked_obj, linked_display_attr, None)
                        if value is not None:
                            return str(value)[:200]
                except Exception:
                    pass
    return None


def _get_link_fields(obj: Any, excluded: set[str] | None = None) -> list[tuple[str, Any]]:
    """Get all non-null field values from a junction record for diffs."""
    excluded = excluded or _LINK_EXCLUDED_FIELDS
    fields = []
    mapper = inspect(obj.__class__)
    for attr in mapper.column_attrs:
        field_name = attr.key
        if field_name in excluded:
            continue
        col = attr.columns[0]
        if col.primary_key or col.foreign_keys:
            continue
        value = getattr(obj, field_name, None)
        if value is not None:
            fields.append((field_name, value))
    return fields


def _resolve_constituent_xref_parent(
    obj: Any,
) -> tuple[str | None, str | None, UUID | None]:
    """
    Resolve the polymorphic parent for a ConstituentXref.

    Returns (parent_model_name, parent_entity_type, parent_id) or (None, None, None).
    """
    entity_type = getattr(obj, "entity_type", None)
    entity_id = getattr(obj, "entity_id", None)
    if entity_type and entity_id and entity_type in _CONSTITUENT_XREF_PARENT_TYPES:
        model_name, parent_type = _CONSTITUENT_XREF_PARENT_TYPES[entity_type]
        return model_name, parent_type, entity_id
    return None, None, None


def _xref_constituent_change(session: Session, obj: Any) -> tuple[str, Any, Any] | None:
    """("constituent", old name, new name) when a ConstituentXref was re-pointed
    to another person (a merge); constituent_id is an FK, so the generic diff
    skips it."""
    try:
        history = inspect(obj).attrs["constituent_id"].history
    except Exception:
        return None
    if not history.has_changes() or not history.deleted or not history.added:
        return None
    old_id, new_id = history.deleted[0], history.added[0]
    if old_id == new_id:
        return None
    cls = _resolve_model_class(session, "Constituent")

    def name(cid):
        row = session.get(cls, cid) if cls is not None and cid else None
        return (getattr(row, "display_name", None) or getattr(row, "name", None) or str(cid)) if row else str(cid)

    return ("constituent", name(old_id), name(new_id))


def _resolve_link_parent_id(session: Session, obj: Any, link_config: dict[str, str]) -> UUID | None:
    """Resolve the parent id for a tracked child row, following parent_via_* for grandchildren."""
    p_fk = link_config.get("parent_fk")
    p_id = getattr(obj, p_fk, None) if p_fk else None
    via_model = link_config.get("parent_via_model")
    if p_id and via_model:
        via_class = _resolve_model_class(session, via_model)
        via_obj = None
        if via_class is not None:
            try:
                via_obj = session.get(via_class, p_id)
            except Exception:
                via_obj = None
        p_id = getattr(via_obj, link_config["parent_via_fk"], None) if via_obj is not None else None
    return p_id


def _resolve_link_org(
    session: Session, obj: Any, link_config: dict[str, str], parent_id: UUID | None
) -> UUID | None:
    """organization_id of a child row, falling back to its parent's (some link tables have none)."""
    org_id = _get_organization_id(obj)
    if org_id or not parent_id:
        return org_id
    parent_class = _resolve_model_class(session, link_config.get("parent_model", ""))
    if parent_class is None:
        return None
    try:
        parent_obj = session.get(parent_class, parent_id)
    except Exception:
        return None
    return _get_organization_id(parent_obj) if parent_obj is not None else None


def _format_composite_part(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, Decimal):
        text = format(value.normalize(), "f")
        return text
    return str(value)


def _composite_value(values: list[Any]) -> str | None:
    parts = [p for p in (_format_composite_part(v) for v in values) if p]
    return " ".join(parts) or None


def _parse_composite(link_config: dict[str, str]) -> tuple[str, list[str]] | None:
    spec = link_config.get("composite")
    if not spec:
        return None
    name, _, parts = spec.partition("=")
    return name, [p.strip() for p in parts.split(",") if p.strip()]


def _link_excluded(link_config: dict[str, str]) -> set[str]:
    raw = link_config.get("exclude_fields") or ""
    return {f.strip() for f in raw.split(",") if f.strip()}


def _shape_link_fields(obj: Any, link_config: dict[str, str]) -> list[tuple[str, Any]]:
    """Fields of a child row for link_added/link_removed diffs, with composites folded in."""
    excluded = _link_excluded(link_config)
    fields = [(f, v) for f, v in _get_link_fields(obj) if f not in excluded]
    composite = _parse_composite(link_config)
    if composite:
        name, parts = composite
        value = _composite_value([getattr(obj, p, None) for p in parts])
        fields = [(f, v) for f, v in fields if f not in parts]
        if value is not None:
            fields.insert(0, (name, value))
    return fields


def _shape_link_changes(
    obj: Any, link_config: dict[str, str], changes: list[tuple[str, Any, Any]]
) -> list[tuple[str, Any, Any]]:
    """Field changes of a child row for link_updated diffs.

    Drops ordering-only columns and folds composite parts into one
    before/after pair, so "value 10 -> 12" (unit cm) reads "10 cm -> 12 cm".
    """
    excluded = _link_excluded(link_config) | {"display_order"}
    changes = [c for c in changes if c[0] not in excluded]
    composite = _parse_composite(link_config)
    if not composite:
        return changes
    name, parts = composite
    changed = {f: (old, new) for f, old, new in changes}
    if not any(p in changed for p in parts):
        return changes
    old_vals = [changed[p][0] if p in changed else getattr(obj, p, None) for p in parts]
    new_vals = [changed[p][1] if p in changed else getattr(obj, p, None) for p in parts]
    rest = [c for c in changes if c[0] not in parts]
    old_c, new_c = _composite_value(old_vals), _composite_value(new_vals)
    if old_c == new_c:
        return rest
    return [(name, old_c, new_c)] + rest


def _child_identity(
    session: Session, obj: Any, link_config: dict[str, str]
) -> tuple[str | None, UUID | None, str | None]:
    """(child_entity_type, child_entity_id, child_display_key) for a tracked child row."""
    child_type = link_config.get("child_type")
    if not child_type:
        return None, None, None
    id_field = link_config.get("child_id_field")
    child_id = getattr(obj, id_field, None) if id_field else _get_entity_pk(obj)
    display = None
    display_field = link_config.get("display_field")
    if display_field:
        value = getattr(obj, display_field, None)
        if value is not None and value != "":
            display = str(value)[:500]
    if display is None:
        display = _resolve_linked_entity_name(session, obj, link_config)
    return child_type, child_id, display


def _create_link_audit_event(
    session: Session,
    link_obj: Any,
    link_config: dict[str, str],
    change_type: str,
    parent_id: UUID | None = None,
    parent_type: str | None = None,
    parent_model_name: str | None = None,
    organization_id: UUID | None = None,
    field_diffs_data: list[tuple[str, Any, Any]] | None = None,
) -> EntityAuditEvent | None:
    """
    Create an audit event on the parent entity for a junction table change.

    For link_added: fields as (name, None, value)
    For link_removed: fields as (name, value, None)
    For link_updated: fields as (name, old, new)
    """
    # Resolve parent info
    p_type = parent_type or link_config["parent_type"]
    p_model = parent_model_name or link_config["parent_model"]
    p_id = parent_id or _resolve_link_parent_id(session, link_obj, link_config)

    if not p_id:
        return None

    org_id = organization_id or _resolve_link_org(session, link_obj, link_config, p_id)
    if not org_id:
        return None

    child_type, child_id, child_display = _child_identity(session, link_obj, link_config)

    # Get parent display key
    parent_display_key = None
    parent_config = TRACKED_ENTITIES.get(p_model)
    if parent_config:
        parent_class = _resolve_model_class(session, p_model)
        if parent_class:
            try:
                parent_obj = session.get(parent_class, p_id)
                if parent_obj:
                    parent_display_key = _get_display_key(parent_obj, parent_config)
            except Exception:
                pass

    # Resolve linked entity display name and add as field diff
    link_label = link_config.get("link_label", "linked record")
    linked_entity_name = _resolve_linked_entity_name(session, link_obj, link_config)

    if linked_entity_name and field_diffs_data is not None and change_type == "link_added":
        field_diffs_data.insert(0, (link_label, None, linked_entity_name))

    # Build display name — prefer linked entity name over junction display_field
    display_name = linked_entity_name
    if not display_name and change_type != "link_removed":
        display_name = _get_link_display_name(session, link_obj, link_config)

    # Build summary
    if change_type == "link_added":
        summary = f"Added {link_label}"
        if display_name:
            summary += f": {display_name}"
    elif change_type == "link_removed":
        summary = f"Removed {link_label}"
        if display_name:
            summary += f": {display_name}"
    elif change_type == "link_updated":
        summary = f"Updated {link_label}"
        if display_name:
            summary += f": {display_name}"
    else:
        summary = f"Changed {link_label}"

    # Get user/request context
    user_id, user_name, user_email = _get_current_user(session)
    req_context = _get_request_context()

    changed_field_names = [f[0] for f in field_diffs_data] if field_diffs_data else None

    audit_event = EntityAuditEvent(
        organization_id=org_id,
        entity_type=p_type,
        entity_id=p_id,
        entity_display_key=parent_display_key,
        change_type=change_type,
        changed_at=datetime.now(timezone.utc),
        changed_by=user_id,
        changed_by_name=user_name,
        changed_by_email=user_email,
        request_path=req_context["request_path"],
        request_method=req_context["request_method"],
        ip_address=req_context["ip_address"],
        user_agent=req_context["user_agent"],
        changed_fields=changed_field_names,
        summary=summary[:500],
        child_entity_type=child_type,
        child_entity_id=child_id,
        child_display_key=child_display,
    )
    session.add(audit_event)

    # Add field diffs
    if field_diffs_data:
        for field_name, old_val, new_val in field_diffs_data:
            diff = EntityAuditFieldDiff(
                event=audit_event,
                organization_id=org_id,
                field_name=field_name,
                old_value=_serialize_value(old_val),
                new_value=_serialize_value(new_val),
            )
            session.add(diff)

    return audit_event


# ============================================================================
# Audit Event Creation
# ============================================================================


def _create_audit_event(
    session: Session,
    obj: Any,
    config: dict[str, str],
    change_type: str,
    field_changes: list[tuple[str, Any, Any]] | None = None,
) -> EntityAuditEvent | None:
    """Create an audit event record for an entity change."""
    organization_id = _get_organization_id(obj)
    if not organization_id:
        logger.debug(f"Skipping audit for {obj.__class__.__name__}: no organization_id")
        return None

    entity_id = _get_entity_pk(obj)
    if not entity_id:
        logger.debug(f"Skipping audit for {obj.__class__.__name__}: no primary key")
        return None

    # Get user info
    user_id, user_name, user_email = _get_current_user(session)

    # Get request context
    req_context = _get_request_context()

    # Build changed_fields list
    changed_field_names = [f[0] for f in field_changes] if field_changes else None

    # Create audit event
    event = EntityAuditEvent(
        organization_id=organization_id,
        entity_type=config["entity_type"],
        entity_id=entity_id,
        entity_display_key=_get_display_key(obj, config),
        change_type=change_type,
        changed_at=datetime.now(timezone.utc),
        changed_by=user_id,
        changed_by_name=user_name,
        changed_by_email=user_email,
        request_path=req_context["request_path"],
        request_method=req_context["request_method"],
        ip_address=req_context["ip_address"],
        user_agent=req_context["user_agent"],
        changed_fields=changed_field_names,
        summary=_generate_summary(change_type, config["entity_type"], changed_field_names),
    )
    session.add(event)

    # Create field diff records for updates
    if field_changes and change_type == "updated":
        for field_name, old_val, new_val in field_changes:
            diff = EntityAuditFieldDiff(
                event=event,
                organization_id=organization_id,
                field_name=field_name,
                old_value=_serialize_value(old_val),
                new_value=_serialize_value(new_val),
            )
            session.add(diff)

    # For creates, record all non-null fields as new values
    elif change_type == "created":
        all_fields = _get_all_fields(obj, session)
        for field_name, value in all_fields:
            diff = EntityAuditFieldDiff(
                event=event,
                organization_id=organization_id,
                field_name=field_name,
                old_value=None,
                new_value=_serialize_value(value),
            )
            session.add(diff)

    # For deletes, record current values as old values
    elif change_type == "deleted":
        all_fields = _get_all_fields(obj, session)
        for field_name, value in all_fields:
            diff = EntityAuditFieldDiff(
                event=event,
                organization_id=organization_id,
                field_name=field_name,
                old_value=_serialize_value(value),
                new_value=None,
            )
            session.add(diff)

    return event


# ============================================================================
# SQLAlchemy Event Listener
# ============================================================================


def _capture_changes_before_flush(session: Session, flush_context: Any, instances: Any) -> None:
    """
    SQLAlchemy before_flush event listener.

    Captures updates and deletes for tracked entities. Creates are handled
    in after_flush because PKs aren't assigned until flush.

    Also captures junction table changes for link tracking.

    We store pending deletes in session.info because the objects won't be
    available after flush.
    """
    # Track entities we've already audited in this flush to avoid duplicates
    audited: set[tuple[str, UUID]] = set()

    # ---- Tracked entity deletes (capture before flush) ----
    pending_deletes = []
    for obj in session.deleted:
        class_name = obj.__class__.__name__
        if class_name in TRACKED_ENTITIES:
            config = TRACKED_ENTITIES[class_name]
            entity_id = _get_entity_pk(obj)
            org_id = _get_organization_id(obj)
            if entity_id and org_id:
                # Capture all field values now before the object is gone
                all_fields = _get_all_fields(obj, session)
                pending_deletes.append({
                    "class_name": class_name,
                    "config": config,
                    "entity_id": entity_id,
                    "organization_id": org_id,
                    "display_key": _get_display_key(obj, config),
                    "fields": all_fields,
                })

    session.info["_audit_pending_deletes"] = pending_deletes

    # ---- Junction table deletes (capture before flush) ----
    pending_link_deletes = []
    for obj in session.deleted:
        class_name = obj.__class__.__name__
        link_config = TRACKED_LINKS.get(class_name)

        # Handle ConstituentXref specially (polymorphic parent)
        if class_name == "ConstituentXref":
            p_model, p_type, p_id = _resolve_constituent_xref_parent(obj)
            if p_model and p_type and p_id:
                link_cfg = {
                    "parent_fk": "entity_id",
                    "parent_type": p_type,
                    "parent_model": p_model,
                    "link_label": "constituent",
                    "linked_fk": "constituent_id",
                    "linked_model": "Constituent",
                    "linked_display": "display_name",
                }
                org_id = _get_organization_id(obj)
                fields = _get_link_fields(obj)
                linked_entity_name = _resolve_linked_entity_name(session, obj, link_cfg)
                if linked_entity_name:
                    fields.insert(0, (link_cfg.get("link_label", "linked record"), linked_entity_name))
                display_name = linked_entity_name or _get_link_display_name(session, obj, link_cfg)
                pending_link_deletes.append({
                    "link_config": link_cfg,
                    "parent_id": p_id,
                    "parent_type": p_type,
                    "parent_model": p_model,
                    "organization_id": org_id,
                    "fields": fields,
                    "display_name": display_name,
                })
            continue

        if link_config:
            parent_id = _resolve_link_parent_id(session, obj, link_config)
            org_id = _resolve_link_org(session, obj, link_config, parent_id)
            if org_id and parent_id:
                fields = _shape_link_fields(obj, link_config)
                linked_entity_name = _resolve_linked_entity_name(session, obj, link_config)
                if linked_entity_name:
                    fields.insert(0, (link_config.get("link_label", "linked record"), linked_entity_name))
                display_name = linked_entity_name or _get_link_display_name(session, obj, link_config)
                child_type, child_id, child_display = _child_identity(session, obj, link_config)
                pending_link_deletes.append({
                    "link_config": link_config,
                    "parent_id": parent_id,
                    "parent_type": link_config["parent_type"],
                    "parent_model": link_config["parent_model"],
                    "organization_id": org_id,
                    "fields": fields,
                    "display_name": display_name,
                    "child_type": child_type,
                    "child_id": child_id,
                    "child_display": child_display,
                })

    session.info["_audit_pending_link_deletes"] = pending_link_deletes

    # ---- Tracked entity updates ----
    for obj in session.dirty:
        if not session.is_modified(obj, include_collections=False):
            continue

        class_name = obj.__class__.__name__
        if class_name in TRACKED_ENTITIES:
            config = TRACKED_ENTITIES[class_name]
            entity_id = _get_entity_pk(obj)
            if entity_id and (class_name, entity_id) not in audited:
                try:
                    field_changes = _get_field_changes(obj, session)
                    if field_changes:  # Only audit if there are actual changes
                        _create_audit_event(session, obj, config, "updated", field_changes)
                        audited.add((class_name, entity_id))
                except Exception as e:
                    logger.error(f"Failed to audit update for {class_name}: {e}")

    # ---- Junction table updates ----
    for obj in session.dirty:
        if not session.is_modified(obj, include_collections=False):
            continue

        class_name = obj.__class__.__name__
        link_config = TRACKED_LINKS.get(class_name)

        # Handle ConstituentXref specially (polymorphic parent)
        if class_name == "ConstituentXref":
            p_model, p_type, p_id = _resolve_constituent_xref_parent(obj)
            if p_model and p_type and p_id:
                try:
                    field_changes = _get_field_changes(obj, session)
                    repointed = _xref_constituent_change(session, obj)
                    if repointed:
                        field_changes.insert(0, repointed)
                    if field_changes:
                        link_cfg = {
                            "parent_fk": "entity_id",
                            "parent_type": p_type,
                            "parent_model": p_model,
                            "link_label": "constituent",
                            "linked_fk": "constituent_id",
                            "linked_model": "Constituent",
                            "linked_display": "display_name",
                        }
                        _create_link_audit_event(
                            session, obj, link_cfg, "link_updated",
                            parent_id=p_id, parent_type=p_type,
                            parent_model_name=p_model,
                            field_diffs_data=field_changes,
                        )
                except Exception as e:
                    logger.error(f"Failed to audit link update for ConstituentXref: {e}")
            continue

        if link_config:
            try:
                field_changes = _shape_link_changes(obj, link_config, _get_field_changes(obj, session))
                if field_changes:
                    _create_link_audit_event(
                        session, obj, link_config, "link_updated",
                        field_diffs_data=field_changes,
                    )
            except Exception as e:
                logger.error(f"Failed to audit link update for {class_name}: {e}")

    # ---- Store new objects for after_flush ----
    pending_creates = []
    pending_link_creates = []
    for obj in session.new:
        class_name = obj.__class__.__name__
        if class_name in TRACKED_ENTITIES:
            pending_creates.append(obj)
        elif class_name in TRACKED_LINKS or class_name == "ConstituentXref":
            pending_link_creates.append(obj)

    session.info["_audit_pending_creates"] = pending_creates
    session.info["_audit_pending_link_creates"] = pending_link_creates


def _capture_creates_after_flush(session: Session, flush_context: Any) -> None:
    """
    SQLAlchemy after_flush event listener.

    Captures creates after flush when PKs are assigned.
    Also processes deletes that were captured before flush.
    """
    # ---- Process tracked entity creates ----
    pending_creates = session.info.pop("_audit_pending_creates", [])
    for obj in pending_creates:
        class_name = obj.__class__.__name__
        if class_name in TRACKED_ENTITIES:
            config = TRACKED_ENTITIES[class_name]
            entity_id = _get_entity_pk(obj)
            if entity_id:
                try:
                    _create_audit_event(session, obj, config, "created")
                except Exception as e:
                    logger.error(f"Failed to audit create for {class_name}: {e}")

    # ---- Process junction table creates ----
    pending_link_creates = session.info.pop("_audit_pending_link_creates", [])
    for obj in pending_link_creates:
        class_name = obj.__class__.__name__

        # Handle ConstituentXref specially (polymorphic parent)
        if class_name == "ConstituentXref":
            p_model, p_type, p_id = _resolve_constituent_xref_parent(obj)
            if p_model and p_type and p_id:
                try:
                    link_cfg = {
                        "parent_fk": "entity_id",
                        "parent_type": p_type,
                        "parent_model": p_model,
                        "link_label": "constituent",
                        "linked_fk": "constituent_id",
                        "linked_model": "Constituent",
                        "linked_display": "display_name",
                    }
                    fields = _get_link_fields(obj)
                    diffs = [(f, None, v) for f, v in fields]
                    _create_link_audit_event(
                        session, obj, link_cfg, "link_added",
                        parent_id=p_id, parent_type=p_type,
                        parent_model_name=p_model,
                        field_diffs_data=diffs,
                    )
                except Exception as e:
                    logger.error(f"Failed to audit link create for ConstituentXref: {e}")
            continue

        link_config = TRACKED_LINKS.get(class_name)
        if link_config:
            try:
                fields = _shape_link_fields(obj, link_config)
                diffs = [(f, None, v) for f, v in fields]
                _create_link_audit_event(
                    session, obj, link_config, "link_added",
                    field_diffs_data=diffs,
                )
            except Exception as e:
                logger.error(f"Failed to audit link create for {class_name}: {e}")

    # ---- Process tracked entity deletes ----
    pending_deletes = session.info.pop("_audit_pending_deletes", [])
    user_id, user_name, user_email = _get_current_user(session)
    req_context = _get_request_context()

    for delete_info in pending_deletes:
        try:
            event = EntityAuditEvent(
                organization_id=delete_info["organization_id"],
                entity_type=delete_info["config"]["entity_type"],
                entity_id=delete_info["entity_id"],
                entity_display_key=delete_info["display_key"],
                change_type="deleted",
                changed_at=datetime.now(timezone.utc),
                changed_by=user_id,
                changed_by_name=user_name,
                changed_by_email=user_email,
                request_path=req_context["request_path"],
                request_method=req_context["request_method"],
                ip_address=req_context["ip_address"],
                user_agent=req_context["user_agent"],
                changed_fields=[f[0] for f in delete_info["fields"]],
                summary=_generate_summary("deleted", delete_info["config"]["entity_type"], None),
            )
            session.add(event)

            # Add field diffs for deleted values
            for field_name, value in delete_info["fields"]:
                diff = EntityAuditFieldDiff(
                    event=event,
                    organization_id=delete_info["organization_id"],
                    field_name=field_name,
                    old_value=_serialize_value(value),
                    new_value=None,
                )
                session.add(diff)
        except Exception as e:
            logger.error(f"Failed to audit delete for {delete_info['class_name']}: {e}")

    # ---- Process junction table deletes ----
    pending_link_deletes = session.info.pop("_audit_pending_link_deletes", [])
    if not pending_link_deletes:
        return

    # Reuse user/request context from above
    if user_id is None:
        user_id, user_name, user_email = _get_current_user(session)
    if not req_context:
        req_context = _get_request_context()

    for link_del in pending_link_deletes:
        try:
            link_config = link_del["link_config"]
            link_label = link_config.get("link_label", "linked record")
            display_name = link_del.get("display_name")
            summary = f"Removed {link_label}"
            if display_name:
                summary += f": {display_name}"

            # Get parent display key
            parent_display_key = None
            parent_config = TRACKED_ENTITIES.get(link_del["parent_model"])
            if parent_config:
                parent_class = _resolve_model_class(session, link_del["parent_model"])
                if parent_class:
                    try:
                        parent_obj = session.get(parent_class, link_del["parent_id"])
                        if parent_obj:
                            parent_display_key = _get_display_key(parent_obj, parent_config)
                    except Exception:
                        pass

            changed_field_names = [f for f, _ in link_del["fields"]] if link_del["fields"] else None

            audit_event = EntityAuditEvent(
                organization_id=link_del["organization_id"],
                entity_type=link_del["parent_type"],
                entity_id=link_del["parent_id"],
                entity_display_key=parent_display_key,
                change_type="link_removed",
                changed_at=datetime.now(timezone.utc),
                changed_by=user_id,
                changed_by_name=user_name,
                changed_by_email=user_email,
                request_path=req_context["request_path"],
                request_method=req_context["request_method"],
                ip_address=req_context["ip_address"],
                user_agent=req_context["user_agent"],
                changed_fields=changed_field_names,
                summary=summary[:500],
                child_entity_type=link_del.get("child_type"),
                child_entity_id=link_del.get("child_id"),
                child_display_key=link_del.get("child_display"),
            )
            session.add(audit_event)

            # Add field diffs (old=value, new=null for removed links)
            for field_name, value in link_del["fields"]:
                diff = EntityAuditFieldDiff(
                    event=audit_event,
                    organization_id=link_del["organization_id"],
                    field_name=field_name,
                    old_value=_serialize_value(value),
                    new_value=None,
                )
                session.add(diff)
        except Exception as e:
            logger.error(f"Failed to audit link delete: {e}")


_listener_registered = False


def register_audit_listeners() -> None:
    """
    Register the SQLAlchemy event listeners for entity auditing.

    Call this function once during application startup, after db.init_app(app).
    """
    global _listener_registered
    if _listener_registered:
        logger.debug("Entity audit listener already registered, skipping")
        return

    # Listen on the Session class to capture all session events
    # before_flush: capture updates and prepare delete info
    # after_flush: capture creates (PKs now assigned) and process deletes
    event.listen(Session, "before_flush", _capture_changes_before_flush)
    event.listen(Session, "after_flush", _capture_creates_after_flush)
    _listener_registered = True
    logger.info("Entity audit listener registered")


def unregister_audit_listeners() -> None:
    """
    Unregister the SQLAlchemy event listeners.

    Useful for testing or temporarily disabling auditing.
    """
    global _listener_registered
    event.remove(Session, "before_flush", _capture_changes_before_flush)
    event.remove(Session, "after_flush", _capture_creates_after_flush)
    _listener_registered = False
    logger.info("Entity audit listener unregistered")
