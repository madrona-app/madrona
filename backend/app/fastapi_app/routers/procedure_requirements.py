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

    When organization_id is provided, includes enforcement_enabled flag.
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

    if organization_id is not None:
        from app.services.procedure_enforcement import is_enforcement_enabled
        result["enforcementEnabled"] = is_enforcement_enabled(organization_id, procedure_type, db)
        response.headers["Cache-Control"] = NO_CACHE
    else:
        response.headers["Cache-Control"] = CACHE_CONTROL

    return result
