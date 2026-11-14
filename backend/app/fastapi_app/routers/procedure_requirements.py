"""
API endpoint for procedure requirements.

Serves static config with optional per-org enforcement flag.
Requirements are aggressively cached; the enforcement flag is
fetched per-request when organization_id is provided.
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.procedure_requirements import (
    PROCEDURE_REQUIREMENTS,
    group_to_dict,
    procedure_to_dict,
)

router = APIRouter(tags=["procedure-requirements"])

CACHE_CONTROL = "public, max-age=3600"
NO_CACHE = "private, no-cache"


@router.get("/api/procedure-requirements", summary="List all requirements")
def list_all_requirements(response: Response):
    """Return requirements for all procedures."""
    response.headers["Cache-Control"] = CACHE_CONTROL
    return {
        "procedures": {
            key: procedure_to_dict(proc)
            for key, proc in PROCEDURE_REQUIREMENTS.items()
        }
    }


@router.get("/api/procedure-requirements/{procedure_type}", summary="Get procedure requirements")
def get_procedure_requirements(
    procedure_type: str,
    response: Response,
    organization_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """Return requirements for a single procedure.

    Every requirement carries ``source``: "baseline" for the fixed set, "org"
    for fields the organization added. When organization_id is provided, the
    org-added fields are merged in as an extra group (``org_required``) and the
    response includes ``enforcementEnabled`` and ``orgRequiredFields``.
    """
    proc = PROCEDURE_REQUIREMENTS.get(procedure_type)
    if proc is None:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "not_found",
                "message": f"Unknown procedure type: '{procedure_type}'. "
                f"Valid types: {', '.join(sorted(PROCEDURE_REQUIREMENTS.keys()))}",
            },
        )

    result = procedure_to_dict(proc)
    for group in result["requirementGroups"]:
        for req in group["requirements"]:
            req["source"] = "baseline"

    if organization_id is not None:
        from app.models.core_org import Organization
        from app.services.procedure_enforcement import is_enforcement_enabled
        from app.services.procedure_required_fields import org_added_fields, org_requirement_group

        result["enforcementEnabled"] = is_enforcement_enabled(organization_id, procedure_type, db)
        org = db.query(Organization).filter(Organization.organization_id == organization_id).first()
        org_group = org_requirement_group(org, procedure_type) if org else None
        if org_group is not None:
            group_dict = group_to_dict(org_group)
            for req in group_dict["requirements"]:
                req["source"] = "org"
            result["requirementGroups"].append(group_dict)
        result["orgRequiredFields"] = org_added_fields(org, procedure_type) if org else []
        response.headers["Cache-Control"] = NO_CACHE
    else:
        response.headers["Cache-Control"] = CACHE_CONTROL

    return result
