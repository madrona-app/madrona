"""
Constituent role resolution service.

Maps entity types to their appropriate lookup category and provides
role validation and label resolution for ConstituentXref records.
"""
import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import current_session
from app.models import LookupCategory, LookupValue

logger = logging.getLogger(__name__)


# Maps entity_type values (from ConstituentXref) to their role lookup category key
ENTITY_TYPE_TO_ROLE_CATEGORY = {
    "collection_object": "constituent_role_object",
    "acquisition": "constituent_role_acquisition",
    "exhibition": "constituent_role_exhibition",
    "event": "constituent_role_event",
    "shipment": "constituent_role_shipment",
    "conservation_treatment": "constituent_role_conservation",
    "loan_in": "constituent_role_loan_in",
    "loan_out": "constituent_role_loan_out",
    "right": "constituent_role_right",
    # Generic fallback for other entity types
    "valuation": "constituent_role_generic",
    "movement": "constituent_role_generic",
    "use_request": "constituent_role_generic",
    "reproduction_request": "constituent_role_generic",
    "documentation_plan": "constituent_role_generic",
    "audit": "constituent_role_generic",
    "deaccession": "constituent_role_generic",
}

# Human-readable labels for entity types (for error messages)
ENTITY_TYPE_LABELS = {
    "collection_object": "collection objects",
    "acquisition": "acquisitions",
    "exhibition": "exhibitions",
    "event": "events",
    "shipment": "shipments",
    "conservation_treatment": "conservation treatments",
    "loan_in": "incoming loans",
    "loan_out": "outgoing loans",
    "right": "rights",
    "valuation": "valuations",
    "movement": "movements",
}


def _get_session(db: Session | None) -> Session:
    """Use the provided session or fall back to current_session()."""
    return db if db is not None else current_session()


def get_role_category_key(entity_type: str) -> str | None:
    """Get the lookup category key for an entity type's roles."""
    return ENTITY_TYPE_TO_ROLE_CATEGORY.get(entity_type)


def get_valid_roles(org_id: UUID, entity_type: str, db: Session | None = None) -> list[dict]:
    """
    Get valid roles for an entity type.

    Returns list of {value, label} dicts from LookupValue.
    Returns empty list if category not found (graceful degradation).
    """
    session = _get_session(db)
    category_key = get_role_category_key(entity_type)
    if not category_key:
        return []

    category = session.execute(
        select(LookupCategory).where(LookupCategory.category_key == category_key)
    ).scalar_one_or_none()

    if not category:
        return []

    values = session.execute(
        select(LookupValue)
        .where(
            LookupValue.category_id == category.category_id,
            LookupValue.is_active == True,
            LookupValue.is_hidden == False,
            # System values (org_id IS NULL) or org-specific
            (LookupValue.organization_id == None) | (LookupValue.organization_id == org_id),
        )
        .order_by(LookupValue.sort_order)
    ).scalars().all()

    return [{"value": v.value_key, "label": v.label} for v in values]


def validate_role(org_id: UUID, entity_type: str, role_key: str, db: Session | None = None) -> bool:
    """
    Check whether a role is valid for the given entity type.

    Returns True if:
    - The role exists in the category's lookup values
    - The category doesn't exist (graceful degradation)
    - The entity type has no mapped category (unmapped types are unrestricted)
    """
    session = _get_session(db)
    category_key = get_role_category_key(entity_type)
    if not category_key:
        return True  # No category mapped = unrestricted

    category = session.execute(
        select(LookupCategory).where(LookupCategory.category_key == category_key)
    ).scalar_one_or_none()

    if not category:
        return True  # Category not seeded yet = graceful degradation

    exists = session.execute(
        select(LookupValue.value_id)
        .where(
            LookupValue.category_id == category.category_id,
            LookupValue.value_key == role_key,
            LookupValue.is_active == True,
            (LookupValue.organization_id == None) | (LookupValue.organization_id == org_id),
        )
    ).scalar_one_or_none()

    return exists is not None


def get_role_label(org_id: UUID, entity_type: str, role_key: str, db: Session | None = None) -> str:
    """
    Get the display label for a role, or fallback to the key itself.
    Used for building user-friendly error messages.
    """
    session = _get_session(db)
    category_key = get_role_category_key(entity_type)
    if not category_key:
        return role_key

    category = session.execute(
        select(LookupCategory).where(LookupCategory.category_key == category_key)
    ).scalar_one_or_none()

    if not category:
        return role_key

    value = session.execute(
        select(LookupValue)
        .where(
            LookupValue.category_id == category.category_id,
            LookupValue.value_key == role_key,
            (LookupValue.organization_id == None) | (LookupValue.organization_id == org_id),
        )
    ).scalar_one_or_none()

    return value.label if value else role_key
