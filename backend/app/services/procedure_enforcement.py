"""
procedure enforcement — per-org, per-procedure gating on status transitions.

Checks whether an entity meets blocking procedure requirements before allowing
a status transition. Enforcement is opt-in per org: missing key = not enforced.
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from app.models.core_org import Organization
from app.services.procedure_requirements import PROCEDURE_REQUIREMENTS


def is_enforcement_enabled(
    organization_id: UUID,
    procedure_type: str,
    db: Session,
) -> bool:
    """Check if procedure enforcement is enabled for this org + procedure."""
    org = db.query(Organization).filter(
        Organization.organization_id == organization_id,
    ).first()
    if not org or not org.procedure_enforcement:
        return False
    return bool(org.procedure_enforcement.get(procedure_type, False))


def check_blocking_requirements(
    organization_id: UUID,
    procedure_type: str,
    entity,
    target_status: str,
    db: Session,
) -> list[str]:
    """
    Evaluate procedure blocking requirements for a status transition.

    Returns a list of human-readable labels for unmet blocking requirements.
    Empty list = transition allowed.

    If enforcement is disabled for this org + procedure, always returns [].
    """
    if not is_enforcement_enabled(organization_id, procedure_type, db):
        return []

    proc = PROCEDURE_REQUIREMENTS.get(procedure_type)
    if not proc:
        return []

    missing = []
    for group in proc.requirement_groups:
        for req in group.requirements:
            if req.severity != "blocking":
                continue
            if target_status not in req.required_for_statuses:
                continue
            # Check if entity has a non-empty value for all required fields
            if not _has_required_fields(entity, req.field_paths):
                missing.append(req.label)

    return missing


def _has_required_fields(entity, field_paths: list[str]) -> bool:
    """Check that at least one field path has a non-empty value on the entity."""
    for path in field_paths:
        value = getattr(entity, path, None)
        if value is not None and value != "" and value is not False:
            return True
    return False
