"""
Per-user Guide preferences API.

A user's own personalization for the Guide assistant — a freeform "things to
keep in mind" note plus a verbosity preference. These are PRIVATE to the user
(RLS keyed on user_id = current_user_id()); there is no admin/cross-user view.
They are injected below the org system prompt as subordinate stylistic guidance
(see prompt_service.get_user_preferences + agent_service._build_ollama_messages).

Endpoints operate on the *current* user in their active org — no ids in the
path — so a user can only ever read/write their own row.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth
from app.models.core_users import GuideUserPreference
from app.services.prompt_service import invalidate_user_preferences

logger = logging.getLogger(__name__)

router = APIRouter(tags=["guide"])

_VERBOSITY_VALUES = {"terse", "normal", "detailed"}
_MAX_INSTRUCTIONS = 2000


class GuidePreferencesResponse(BaseModel):
    instructions: str = ""
    verbosity: str | None = None


class GuidePreferencesUpdate(BaseModel):
    instructions: str = Field(default="", max_length=_MAX_INSTRUCTIONS)
    verbosity: str | None = None


def _require_org(auth: AuthContext):
    if not auth.active_organization_id:
        raise HTTPException(
            status_code=403,
            detail={"code": "no_organization", "message": "No active organization"},
        )
    return auth.active_organization_id


@router.get(
    "/api/guide/preferences",
    response_model=GuidePreferencesResponse,
    summary="Get the current user's Guide preferences",
)
def get_guide_preferences(
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    org_id = _require_org(auth)
    row = (
        db.query(GuideUserPreference)
        .filter(
            GuideUserPreference.user_id == auth.user_id,
            GuideUserPreference.organization_id == org_id,
        )
        .first()
    )
    if not row:
        return GuidePreferencesResponse()
    return GuidePreferencesResponse(
        instructions=row.instructions or "",
        verbosity=row.verbosity,
    )


@router.put(
    "/api/guide/preferences",
    response_model=GuidePreferencesResponse,
    summary="Update the current user's Guide preferences",
)
def update_guide_preferences(
    body: GuidePreferencesUpdate,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    org_id = _require_org(auth)

    verbosity = body.verbosity or None
    if verbosity is not None and verbosity not in _VERBOSITY_VALUES:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "invalid_verbosity",
                "message": f"verbosity must be one of {sorted(_VERBOSITY_VALUES)} or null",
            },
        )

    instructions = (body.instructions or "").strip()

    row = (
        db.query(GuideUserPreference)
        .filter(
            GuideUserPreference.user_id == auth.user_id,
            GuideUserPreference.organization_id == org_id,
        )
        .first()
    )
    if row:
        row.instructions = instructions
        row.verbosity = verbosity
    else:
        row = GuideUserPreference(
            user_id=auth.user_id,
            organization_id=org_id,
            instructions=instructions,
            verbosity=verbosity,
        )
        db.add(row)
    db.commit()

    # Drop the cached prompt block so the next turn picks up the change.
    invalidate_user_preferences(auth.user_id, org_id)

    return GuidePreferencesResponse(
        instructions=row.instructions or "",
        verbosity=row.verbosity,
    )
