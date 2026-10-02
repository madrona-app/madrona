"""
Test-support endpoints — ONLY active when APP_ENV == "testing".

Exists so the Playwright e2e suite can obtain an authenticated session
without driving the Cognito login UI (which has no CI/mock mode and is
MFA-gated for admin). See GitHub issue #37.

SECURITY: the gate is an allowlist — `app_env == "testing"` and nothing
else — and the router is not even registered outside that env. It was
previously a denylist ("not production"), which answers under every other
environment name, including "development" — the value a self-hoster gets
by copying backend/.env.example. An allowlist cannot fail that way.

Run the e2e suite with APP_ENV=testing (CI already does; see
.github/workflows/e2e-tests.yml). Handlers still return 404 rather than
403 so the route is indistinguishable from one that does not exist.

Do NOT add anything here that would be harmful if the gate ever failed
open: minting a session still requires the target user to already exist
and be active, so the blast radius even within a testing env is limited
to seeded test users.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_admin_db
from app.fastapi_app.routers.auth import _set_refresh_cookie
from app.services.auth_utils import generate_refresh_token, hash_refresh_token

logger = logging.getLogger(__name__)

router = APIRouter(tags=["test-support"])


class MintSessionBody(BaseModel):
    email: EmailStr


def test_support_enabled() -> bool:
    """True only under APP_ENV=testing. Allowlist, never a denylist."""
    return get_settings().app_env == "testing"


def _require_testing_env() -> None:
    """Hard gate. 404 (not 403) everywhere but testing, so the route is
    indistinguishable from one that does not exist."""
    if not test_support_enabled():
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Not found"})


@router.post("/api/test-support/mint-session", summary="[testing-only] Mint an authenticated session")
def mint_session(
    body: MintSessionBody,
    request: Request,
    db: Session = Depends(get_admin_db),
):
    """Mint a fully-authenticated refresh-token session for an existing
    active user, bypassing Cognito + MFA. Test-only (APP_ENV=testing).

    The session is the `refresh_token` HttpOnly cookie — `require_auth`
    falls back to it when no Bearer header is present, which is exactly
    how the SPA authenticates (it stores no tokens client-side). Mirrors
    the RefreshToken row the real login creates, with mfa_verified=True
    so MFA-gated routes work for the e2e admin user.
    """
    _require_testing_env()

    from app.models import User, OrganizationMembership

    user = db.query(User).filter_by(email=body.email).first()
    if not user or user.status != "active":
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "No active user with that email"},
        )

    membership = (
        db.query(OrganizationMembership)
        .filter_by(user_id=user.user_id, status="active")
        .first()
    )
    active_org_id = membership.organization_id if membership else None

    refresh_token = generate_refresh_token()
    from app.models import RefreshToken

    db.add(RefreshToken(
        user_id=user.user_id,
        token_hash=hash_refresh_token(refresh_token),
        active_organization_id=active_org_id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
        mfa_verified=True,
        mfa_at=datetime.now(timezone.utc),
    ))
    db.commit()

    logger.info("test-support mint-session issued for %s (testing env)", body.email)

    response = JSONResponse(content={
        "user_id": str(user.user_id),
        "email": user.email,
        "active_organization_id": str(active_org_id) if active_org_id else None,
    })
    return _set_refresh_cookie(response, refresh_token)
