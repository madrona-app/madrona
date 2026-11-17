"""Portal members: sign-in links, sessions and the email that carries a link.

Shared by the public member API (routers/discover_members.py) and the staff
member-management API (routers/collections_discover_members.py).

Identity separation
-------------------
A portal member is not a staff user. The session is a signed token in its own
cookie (``MEMBER_SESSION_COOKIE``), scoped by path to the member API of one
portal, with its own token type and audience. Staff authentication never reads
that cookie, and the member API never reads the staff bearer token or refresh
cookie.
"""

from __future__ import annotations

import html
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Organization, PortalMember, PortalMemberLoginToken
from app.services.auth_utils import (
    decode_portal_member_session,
    generate_portal_member_login_token,
    generate_portal_member_session,
    hash_portal_member_login_token,
)

logger = logging.getLogger(__name__)

MEMBER_SESSION_COOKIE = "madrona_member"

#: A sign-in link is good for this long, once.
LOGIN_TOKEN_TTL = timedelta(minutes=15)
#: Idle limit. Each authenticated request slides it forward.
SESSION_IDLE_MINUTES = 120
#: Renew the cookie once the session is this old (keeps Set-Cookie off most
#: responses while still sliding the idle window).
SESSION_RENEW_AFTER_SECONDS = 10 * 60
#: Absolute limit from the sign-in link, however active the session.
SESSION_ABSOLUTE_SECONDS = 12 * 60 * 60

MAX_COLLECTIONS_PER_MEMBER = 100
MAX_ITEMS_PER_COLLECTION = 500  # matches the public export cap

_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,63}$")


def normalize_email(value: str | None) -> str | None:
    """Lower-cased, trimmed address, or None if it is not plausibly an email."""
    if not value:
        return None
    email = value.strip().lower()
    if len(email) > 320 or not _EMAIL_RE.match(email):
        return None
    return email


def member_cookie_path(org_slug: str) -> str:
    return f"/api/discover/{org_slug}/member"


def _cookie_secure() -> bool:
    settings = get_settings()
    return not (settings.is_development or settings.is_testing)


def set_member_session_cookie(response, member: PortalMember, org_slug: str, auth_time: int | None = None) -> None:
    token = generate_portal_member_session(
        member_id=str(member.member_id),
        organization_id=str(member.organization_id),
        session_version=member.session_version,
        auth_time=auth_time if auth_time is not None else int(time.time()),
        expires_minutes=SESSION_IDLE_MINUTES,
    )
    response.set_cookie(
        key=MEMBER_SESSION_COOKIE,
        value=token,
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
        max_age=SESSION_IDLE_MINUTES * 60,
        path=member_cookie_path(org_slug),
    )


def clear_member_session_cookie(response, org_slug: str) -> None:
    response.set_cookie(
        key=MEMBER_SESSION_COOKIE,
        value="",
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
        max_age=0,
        path=member_cookie_path(org_slug),
    )


def resolve_member_session(db: Session, org: Organization, token: str | None) -> tuple[PortalMember, dict] | None:
    """The active member a session cookie belongs to, or None.

    Checks signature, expiry, token type and audience; that the session was
    issued for this organization; the absolute session limit; that the member
    still exists, belongs to this organization and is active; and that the
    session has not been ended by sign-out or suspension.
    """
    if not token:
        return None
    payload = decode_portal_member_session(token)
    if not payload:
        return None
    if payload.get("org") != str(org.organization_id):
        return None
    auth_time = payload.get("auth_time")
    if not isinstance(auth_time, int) or time.time() - auth_time > SESSION_ABSOLUTE_SECONDS:
        return None
    member = (
        db.query(PortalMember)
        .filter(
            PortalMember.member_id == payload.get("sub"),
            PortalMember.organization_id == org.organization_id,
        )
        .first()
    )
    if not member or member.status != "active":
        return None
    if payload.get("sv") != member.session_version:
        return None
    return member, payload


def issue_login_token(db: Session, member: PortalMember, created_by_user_id=None) -> tuple[str, datetime]:
    """Create a one-time sign-in token for ``member``; returns (token, expires_at).

    Earlier unused links for the member are spent, so only the newest link
    works. The caller commits.
    """
    now = datetime.now(timezone.utc)
    db.execute(
        update(PortalMemberLoginToken)
        .where(
            PortalMemberLoginToken.member_id == member.member_id,
            PortalMemberLoginToken.used_at.is_(None),
        )
        .values(used_at=now)
    )
    token = generate_portal_member_login_token()
    expires_at = now + LOGIN_TOKEN_TTL
    db.add(
        PortalMemberLoginToken(
            organization_id=member.organization_id,
            member_id=member.member_id,
            token_hash=hash_portal_member_login_token(token),
            expires_at=expires_at,
            created_by_user_id=created_by_user_id,
        )
    )
    return token, expires_at


def consume_login_token(db: Session, org: Organization, token: str) -> PortalMember | None:
    """Spend a sign-in token and return its member, or None if it is not usable.

    The token is marked used in the same UPDATE that checks it is unused and
    unexpired, so two concurrent exchanges of one link cannot both succeed.
    The caller commits.
    """
    if not token or len(token) > 200:
        return None
    now = datetime.now(timezone.utc)
    row = db.execute(
        update(PortalMemberLoginToken)
        .where(
            PortalMemberLoginToken.token_hash == hash_portal_member_login_token(token),
            PortalMemberLoginToken.organization_id == org.organization_id,
            PortalMemberLoginToken.used_at.is_(None),
            PortalMemberLoginToken.expires_at > now,
        )
        .values(used_at=now)
        .returning(PortalMemberLoginToken.member_id)
    ).first()
    if not row:
        return None
    member = (
        db.query(PortalMember)
        .filter(
            PortalMember.member_id == row[0],
            PortalMember.organization_id == org.organization_id,
        )
        .first()
    )
    if not member or member.status != "active":
        return None
    member.last_sign_in_at = now
    return member


def sign_in_url(org_slug: str, token: str) -> str:
    """Portal link that signs a member in.

    The token travels in the URL fragment, which browsers never send to a
    server, so it stays out of access logs and Referer headers. The landing
    page posts it to the exchange endpoint.
    """
    base = get_settings().app_base_url.rstrip("/")
    return f"{base}/c/{quote(org_slug, safe='')}/member/welcome#token={token}"


def send_sign_in_email(email: str, org_name: str, url: str) -> bool:
    """Email a sign-in link. Returns False if it could not be sent."""
    from app.services.email_service import get_email_service

    safe_org = html.escape(org_name)
    safe_url = html.escape(url, quote=True)
    minutes = int(LOGIN_TOKEN_TTL.total_seconds() // 60)
    html_body = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Sign in to your saved collections</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background-color:#ffffff;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <h1 style="font-size:22px;font-weight:600;color:#1C1C1A;margin:0 0 16px 0;">Sign in to {safe_org}</h1>
    <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#1C1C1A;">Use this link to sign in and see your saved collections:</p>
    <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;"><a href="{safe_url}" style="color:#8A3F2B;">Sign in to your saved collections at {safe_org}</a></p>
    <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#1C1C1A;">The link works once and expires in {minutes} minutes. If you did not ask to sign in, you can ignore this email.</p>
  </div>
</body>
</html>"""
    text_body = (
        f"Sign in to {org_name}\n\n"
        "Use this link to sign in and see your saved collections:\n\n"
        f"{url}\n\n"
        f"The link works once and expires in {minutes} minutes. "
        "If you did not ask to sign in, you can ignore this email.\n"
    )
    try:
        return get_email_service().send_email(
            channel="accounts",
            to=[email],
            subject=f"Your sign-in link for {org_name}",
            html=html_body,
            text=text_body,
            tags={"type": "portal_member_sign_in"},
        )
    except Exception:  # never let a mail failure surface to the caller
        logger.exception("Failed to send portal member sign-in email")
        return False


def end_member_sessions(member: PortalMember) -> None:
    """Invalidate every session issued to ``member`` so far."""
    member.session_version = (member.session_version or 0) + 1
