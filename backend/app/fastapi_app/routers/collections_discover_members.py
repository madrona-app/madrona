"""
Staff management of portal members (Discover settings > Members).

Staff with ``discover.publish`` or ``org.manage_settings`` can invite a person
by email, approve them (only active members can sign in), suspend them (ends
their sessions and spends their outstanding links), generate a sign-in link
for them when email is not available, and switch the feature on or off.

These are ordinary authenticated staff routes: RLS-scoped ``get_db`` session,
CSRF-checked, organization taken from the path and checked by
``require_permission``.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, update
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    DiscoverConfig,
    MemberCollection,
    Organization,
    PortalMember,
    PortalMemberLoginToken,
)
from app.permissions import Permission
from app.services.portal_members import (
    LOGIN_TOKEN_TTL,
    end_member_sessions,
    issue_login_token,
    normalize_email,
    send_sign_in_email,
    sign_in_url,
)
from app.services.public_cache import invalidate_org_cache_by_id

logger = logging.getLogger(__name__)

router = APIRouter(tags=["discover-members-admin"])

_MANAGE = require_permission(Permission.DISCOVER_PUBLISH, Permission.ORG_MANAGE_SETTINGS)
_BASE = "/api/organizations/{organization_id}/collections/discover/members"


class MemberInviteBody(BaseModel):
    email: str = Field(..., max_length=320)
    display_name: str | None = Field(None, max_length=255)
    approve: bool = False


class MemberSettingsBody(BaseModel):
    member_collections_enabled: bool


class SignInLinkBody(BaseModel):
    send_email: bool = False


def _member_out(m: PortalMember, collection_count: int = 0) -> dict:
    return {
        "member_id": str(m.member_id),
        "email": m.email,
        "display_name": m.display_name,
        "status": m.status,
        "approved_at": m.approved_at.isoformat() if m.approved_at else None,
        "last_sign_in_at": m.last_sign_in_at.isoformat() if m.last_sign_in_at else None,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "collection_count": collection_count,
    }


def _get_member(db: Session, organization_id: UUID, member_id: UUID) -> PortalMember:
    m = db.query(PortalMember).filter(
        PortalMember.member_id == member_id,
        PortalMember.organization_id == organization_id,
    ).first()
    if not m:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Member not found"})
    return m


def _enabled(db: Session, organization_id: UUID) -> bool:
    return bool(db.query(DiscoverConfig.member_collections_enabled).filter(
        DiscoverConfig.organization_id == organization_id,
    ).scalar())


@router.get(_BASE, summary="List portal members")
def list_members(
    organization_id: UUID,
    auth: AuthContext = Depends(_MANAGE),
    db: Session = Depends(get_db),
):
    members = (
        db.query(PortalMember)
        .filter(PortalMember.organization_id == organization_id)
        .order_by(func.lower(PortalMember.email))
        .all()
    )
    counts = dict(
        db.query(MemberCollection.member_id, func.count(MemberCollection.collection_id))
        .filter(MemberCollection.organization_id == organization_id)
        .group_by(MemberCollection.member_id)
        .all()
    )
    return {
        "member_collections_enabled": _enabled(db, organization_id),
        "members": [_member_out(m, counts.get(m.member_id, 0)) for m in members],
    }


@router.put(f"{_BASE}/settings", summary="Switch saved member collections on or off")
def update_member_settings(
    organization_id: UUID,
    body: MemberSettingsBody,
    auth: AuthContext = Depends(_MANAGE),
    db: Session = Depends(get_db),
):
    config = db.query(DiscoverConfig).filter(DiscoverConfig.organization_id == organization_id).first()
    if not config:
        config = DiscoverConfig(organization_id=organization_id)
        db.add(config)
    config.member_collections_enabled = body.member_collections_enabled
    db.commit()
    invalidate_org_cache_by_id(str(organization_id))
    return {"member_collections_enabled": config.member_collections_enabled}


@router.post(_BASE, status_code=201, summary="Invite a portal member")
def invite_member(
    organization_id: UUID,
    body: MemberInviteBody,
    auth: AuthContext = Depends(_MANAGE),
    db: Session = Depends(get_db),
):
    email = normalize_email(body.email)
    if not email:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Enter a valid email address.",
            "details": {"field": "email"},
        })
    if db.query(PortalMember.member_id).filter(
        PortalMember.organization_id == organization_id,
        PortalMember.email == email,
    ).first():
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": f"{email} is already on the member list.",
            "details": {"field": "email"},
        })
    now = datetime.now(timezone.utc)
    member = PortalMember(
        organization_id=organization_id,
        email=email,
        display_name=(body.display_name or "").strip() or None,
        status="active" if body.approve else "invited",
        invited_by_user_id=auth.user_id,
        approved_by_user_id=auth.user_id if body.approve else None,
        approved_at=now if body.approve else None,
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return _member_out(member)


@router.post(f"{_BASE}/{{member_id}}/approve", summary="Approve a portal member")
def approve_member(
    organization_id: UUID,
    member_id: UUID,
    auth: AuthContext = Depends(_MANAGE),
    db: Session = Depends(get_db),
):
    member = _get_member(db, organization_id, member_id)
    member.status = "active"
    member.approved_by_user_id = auth.user_id
    member.approved_at = datetime.now(timezone.utc)
    member.updated_at = member.approved_at
    db.commit()
    db.refresh(member)
    return _member_out(member)


@router.post(f"{_BASE}/{{member_id}}/suspend", summary="Suspend a portal member")
def suspend_member(
    organization_id: UUID,
    member_id: UUID,
    auth: AuthContext = Depends(_MANAGE),
    db: Session = Depends(get_db),
):
    """Suspend: the member cannot sign in, current sessions end, and any
    outstanding sign-in links stop working. Their collections are kept."""
    member = _get_member(db, organization_id, member_id)
    now = datetime.now(timezone.utc)
    member.status = "suspended"
    member.updated_at = now
    end_member_sessions(member)
    db.execute(
        update(PortalMemberLoginToken)
        .where(
            PortalMemberLoginToken.member_id == member.member_id,
            PortalMemberLoginToken.used_at.is_(None),
        )
        .values(used_at=now)
    )
    db.commit()
    db.refresh(member)
    return _member_out(member)


@router.post(f"{_BASE}/{{member_id}}/sign-in-link", summary="Generate a sign-in link for a member")
def generate_sign_in_link(
    organization_id: UUID,
    member_id: UUID,
    body: SignInLinkBody | None = None,
    auth: AuthContext = Depends(_MANAGE),
    db: Session = Depends(get_db),
):
    """A one-time, 15-minute sign-in link for an active member.

    The fallback when the deployment cannot send email: staff copy the link
    and give it to the member. With ``send_email`` it is also emailed.
    """
    member = _get_member(db, organization_id, member_id)
    if member.status != "active":
        raise HTTPException(status_code=409, detail={
            "code": "member_not_active",
            "message": "Approve this member before generating a sign-in link.",
        })
    org = db.query(Organization).filter(Organization.organization_id == organization_id).first()
    if not org or not org.slug:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})
    token, expires_at = issue_login_token(db, member, created_by_user_id=auth.user_id)
    db.commit()
    url = sign_in_url(org.slug, token)
    emailed = False
    if body and body.send_email:
        emailed = send_sign_in_email(member.email, org.name, url)
    return {
        "url": url,
        "expires_at": expires_at.isoformat(),
        "expires_in_minutes": int(LOGIN_TOKEN_TTL.total_seconds() // 60),
        "emailed": emailed,
        "feature_enabled": _enabled(db, organization_id),
    }
