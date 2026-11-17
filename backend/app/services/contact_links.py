"""Validate contact (constituent) links supplied in request bodies."""

from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Constituent
from app.services.validation_utils import parse_uuid_or_raise


def contact_display_name(contact) -> str | None:
    if contact is None:
        return None
    return getattr(contact, "display_name", None) or contact.name


def validate_org_contact_id(db: Session, org_id: UUID, value, field: str) -> UUID | None:
    """Parse a contact id and confirm it is a contact in ``org_id``.

    None or "" clears the link. A malformed id is a 400 (parse_uuid_or_raise);
    an id that is not a contact of this organization is a 422.
    """
    if value in (None, ""):
        return None
    contact_id = value if isinstance(value, UUID) else parse_uuid_or_raise(str(value), field)
    exists = db.query(Constituent.constituent_id).filter(
        Constituent.constituent_id == contact_id,
        Constituent.organization_id == org_id,
    ).first()
    if not exists:
        raise HTTPException(
            status_code=422,
            detail=f"{field}: contact not found in this organization",
        )
    return contact_id
