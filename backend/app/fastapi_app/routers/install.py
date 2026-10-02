"""First-run install: the one route that has to work before anyone can log in.

`docker compose up` leaves you with a running system and no account. The CLI
(`python -m seeds.bootstrap_admin`) has always been able to fix that; this is
the same operation in a browser, so an evaluator's first five minutes are a
form rather than a shell incantation with a password in their history.

Unauthenticated, necessarily — there is nobody to authenticate as. The guard is
that it refuses once an organization exists, which for a first-run install is a
real boundary and not a token one: the window closes the moment the form is
submitted, on a system that until then holds no data.

Not under /api/platform/*: everything there requires platform-admin, and
putting an unauthenticated route under the same prefix invites someone to
"fix" it by adding the guard that would make it useless.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.fastapi_app.dependencies.admin_db import admin_db_dep
from app.services.install_service import bootstrap_first_admin, install_is_required
from app.services.rate_limiter import RateLimiter

logger = logging.getLogger(__name__)

router = APIRouter(tags=["install"])

# Generous, because a legitimate operator may mistype and retry, and tight
# enough that the endpoint is not a free org-creation loop if it is ever
# reachable when it should not be.
_install_limiter = RateLimiter(max_requests=5, window_seconds=300)


class InstallStatusResponse(BaseModel):
    install_required: bool


class InstallBody(BaseModel):
    email: EmailStr
    # 8 is what /api/auth/activate and the password-change routes enforce;
    # matching them keeps one rule rather than a stricter one here that
    # surprises the same person at their next password change.
    password: str = Field(..., min_length=8)
    organization_name: str = Field(..., min_length=1, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)
    # Sample objects, loans, exhibitions and condition reports, from
    # checked-in fixtures. Off by default: a real museum wants its own
    # catalogue, an evaluator wants something to look at.
    with_demo_data: bool = False


class InstallResponse(BaseModel):
    organization_id: str
    organization_name: str
    organization_slug: str
    email: str
    role: str
    applications_enabled: int
    # False when search could not be provisioned — the account is usable but
    # collection and media lists will be empty until someone reindexes.
    search_ready: bool
    demo_data_seeded: bool


@router.get("/api/install/status", response_model=InstallStatusResponse, summary="Is this install unconfigured?")
def install_status(db: Session = Depends(admin_db_dep)):
    """Whether this instance still needs its first organization.

    Safe to call unauthenticated: it answers one boolean about the instance and
    says nothing about who or what is in it.
    """
    return {"install_required": install_is_required(db)}


@router.post("/api/install", response_model=InstallResponse, status_code=201, summary="Create the first organization and administrator")
def install(
    body: InstallBody,
    request: Request,
    db: Session = Depends(admin_db_dep),
):
    """Create the first organization and its administrator.

    Grants platform-admin: whoever stands up a self-hosted instance is its
    operator, and an install whose only account cannot reach platform settings
    is an install that needs the CLI anyway.
    """
    client = request.client.host if request.client else "unknown"
    if not _install_limiter.allow(organization_id=client, endpoint="install"):
        raise HTTPException(status_code=429, detail="Too many attempts. Try again shortly.")

    # Re-checked inside the request rather than trusted from the client's
    # earlier /status call: two people opening the wizard at once would both
    # have been told install_required=true.
    if not install_is_required(db):
        raise HTTPException(
            status_code=409,
            detail="This instance is already installed. Use the sign-in page, "
                   "or `python -m seeds.bootstrap_admin` to recover an account.",
        )

    try:
        result = bootstrap_first_admin(
            db,
            email=body.email,
            password=body.password,
            display_name=body.display_name,
            org_name=body.organization_name,
            platform_admin=True,
            with_demo_data=body.with_demo_data,
        )
    except LookupError as exc:
        # Roles missing — the boot seeds have not run. Worth saying plainly
        # rather than as a 500: it means the backend started abnormally.
        logger.error("Install failed: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    db.commit()
    logger.info("Instance installed: org %s, admin %s", result["organization_slug"], result["email"])
    return result
