"""
API endpoint for procedure requirements.

Two shapes:

* ``/api/procedure-requirements[/{type}]`` — the fixed baseline every
  organization shares. Any signed-in user may read it.
* ``/api/organizations/{organization_id}/procedure-requirements/{type}`` —
  the baseline merged with the fields that organization added, plus its
  enforcement flag. Members of that organization only.

The baseline route used to take ``?organization_id=`` with no
authentication at all, so anyone could read any organization's added
required-field names and enforcement settings by guessing its id. The query
parameter is gone; the org-scoped route is the only way to get org data.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import (
    AuthContext,
    OrgContext,
    require_auth,
    require_org_role,
)
from app.services.procedure_requirements import (
    PROCEDURE_REQUIREMENTS,
    group_to_dict,
    procedure_to_dict,
)

router = APIRouter(tags=["procedure-requirements"])

# The baseline is the same for everyone, but it is now behind sign-in, so a
# shared cache must not hold it.
CACHE_CONTROL = "private, max-age=3600"
NO_CACHE = "private, no-cache"


def _baseline(procedure_type: str) -> dict:
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
    return result


@router.get("/api/procedure-requirements", summary="List all requirements")
def list_all_requirements(
    response: Response,
    auth: AuthContext = Depends(require_auth),
):
    """Return the baseline requirements for all procedures."""
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
    auth: AuthContext = Depends(require_auth),
):
    """Return the baseline requirements for a single procedure.

    Every requirement carries ``source: "baseline"``. For an organization's
    added fields use the org-scoped route.
    """
    result = _baseline(procedure_type)
    response.headers["Cache-Control"] = CACHE_CONTROL
    return result


@router.get(
    "/api/organizations/{organization_id}/procedure-requirements/{procedure_type}",
    summary="Get procedure requirements for an organization",
)
def get_org_procedure_requirements(
    organization_id: UUID,
    procedure_type: str,
    response: Response,
    org_ctx: OrgContext = Depends(require_org_role("member")),
    db: Session = Depends(get_db),
):
    """Baseline requirements merged with the organization's added fields.

    The org-added fields come as an extra group (``org_required``) whose
    requirements carry ``source: "org"``; the response also includes
    ``enforcementEnabled`` and ``orgRequiredFields``.
    """
    from app.models.core_org import Organization
    from app.services.procedure_enforcement import is_enforcement_enabled
    from app.services.procedure_required_fields import org_added_fields, org_requirement_group

    result = _baseline(procedure_type)
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
    return result
