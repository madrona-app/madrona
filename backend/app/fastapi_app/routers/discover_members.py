"""
Public portal member API: sign-in by emailed link and saved personal collections.

Routes live under ``/api/discover/{org_slug}/member``. Like the rest of the
public Discover API (see the access-control note in discover_public.py), these
use the BYPASSRLS session and scope every query explicitly: the organization
comes from the portal slug (active organizations only), and every member
query also filters on the signed-in member.

Gates, in order, on every route:
  1. The org slug resolves to an active organization AND that organization has
     ``DiscoverConfig.member_collections_enabled`` on. Otherwise 404, the same
     response as an unknown portal, so the feature's existence is not exposed.
  2. Routes that act for a member require a valid member session cookie
     (services/portal_members.resolve_member_session). The staff bearer token
     and refresh cookie are never read here.

CSRF: unlike the rest of /api/discover/, state-changing requests here are
NOT exempt from the double-submit check (middleware/csrf.py), because a member
session is an ambient cookie credential.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_admin_db
from app.models import (
    CollectionObject,
    DiscoverConfig,
    MemberCollection,
    MemberCollectionItem,
    Organization,
    PortalMember,
)
from app.services.portal_members import (
    MAX_COLLECTIONS_PER_MEMBER,
    MAX_ITEMS_PER_COLLECTION,
    MEMBER_SESSION_COOKIE,
    SESSION_RENEW_AFTER_SECONDS,
    clear_member_session_cookie,
    consume_login_token,
    end_member_sessions,
    issue_login_token,
    normalize_email,
    resolve_member_session,
    send_sign_in_email,
    set_member_session_cookie,
    sign_in_url,
)
from app.services.rate_limiter import RateLimiter

logger = logging.getLogger(__name__)

router = APIRouter(tags=["discover-members"])

# Per caller IP, and per (portal, recipient) so one inbox cannot be flooded
# from many addresses. Both apply whether or not the address is a member, so
# the 429 itself reveals nothing.
_signin_ip_limiter = RateLimiter(max_requests=10, window_seconds=900)
_signin_email_limiter = RateLimiter(max_requests=5, window_seconds=900)
_exchange_ip_limiter = RateLimiter(max_requests=20, window_seconds=900)

SIGN_IN_REQUEST_MESSAGE = "If that address belongs to a member, a sign-in link is on its way."
_INVALID_LINK_MESSAGE = "This sign-in link is not valid. It may have been used already or expired. Request a new one."


# =============================================================================
# Schemas
# =============================================================================


class SignInRequestBody(BaseModel):
    email: str = Field(..., max_length=320)


class SignInExchangeBody(BaseModel):
    token: str = Field(..., max_length=200)


class CollectionCreateBody(BaseModel):
    name: str = Field(..., max_length=200)
    description: str | None = Field(None, max_length=2000)


class CollectionUpdateBody(BaseModel):
    name: str | None = Field(None, max_length=200)
    description: str | None = Field(None, max_length=2000)


class ItemAddBody(BaseModel):
    object_id: UUID
    note: str | None = Field(None, max_length=2000)


# =============================================================================
# Dependencies
# =============================================================================


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail={"code": "not_found", "message": "Not found", "details": {}})


def _rate_limited() -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={"error": {"code": "rate_limit_exceeded", "message": "Too many requests, please try again later", "details": {}}},
        headers={"Retry-After": "900"},
    )


def _client_ip(request: Request) -> str:
    from app.fastapi_app.routers.auth import _get_client_ip

    return _get_client_ip(request) or "unknown"


def member_portal(org_slug: str, db: Session = Depends(get_admin_db)) -> Organization:
    """The portal's organization, if it exists, is active and has the feature on."""
    org = db.query(Organization).filter(
        Organization.slug == org_slug,
        Organization.status == "active",
    ).first()
    if not org:
        raise _not_found()
    enabled = db.query(DiscoverConfig.member_collections_enabled).filter(
        DiscoverConfig.organization_id == org.organization_id,
    ).scalar()
    if not enabled:
        raise _not_found()
    return org


class MemberContext:
    def __init__(self, org: Organization, member: PortalMember):
        self.org = org
        self.member = member


def current_member(
    request: Request,
    response: Response,
    org_slug: str,
    org: Organization = Depends(member_portal),
    db: Session = Depends(get_admin_db),
) -> MemberContext:
    """The signed-in member, from the member session cookie only. 401 otherwise.

    Slides the idle window: once the session is a few minutes old, a fresh
    cookie (same absolute sign-in time) is set on the response.
    """
    resolved = resolve_member_session(db, org, request.cookies.get(MEMBER_SESSION_COOKIE))
    if not resolved:
        raise HTTPException(
            status_code=401,
            detail={"code": "unauthorized", "message": "Sign in to use saved collections", "details": {}},
        )
    member, payload = resolved
    response.headers["Cache-Control"] = "no-store"
    issued_at = payload.get("iat")
    if isinstance(issued_at, (int, float)) and datetime.now(timezone.utc).timestamp() - issued_at > SESSION_RENEW_AFTER_SECONDS:
        set_member_session_cookie(response, member, org_slug, auth_time=payload["auth_time"])
    return MemberContext(org, member)


# =============================================================================
# Serialisation helpers
# =============================================================================


def _member_out(member: PortalMember) -> dict:
    return {"display_name": member.display_name, "email": member.email}


def _visible_items_query(db: Session, org: Organization, collection_id):
    """Items whose object is still discoverable. Hidden items are kept, not deleted."""
    return (
        db.query(MemberCollectionItem)
        .join(CollectionObject, CollectionObject.object_id == MemberCollectionItem.object_id)
        .filter(
            MemberCollectionItem.collection_id == collection_id,
            MemberCollectionItem.organization_id == org.organization_id,
            CollectionObject.organization_id == org.organization_id,
            CollectionObject.is_discoverable == True,  # noqa: E712
            CollectionObject.is_deleted == False,  # noqa: E712
        )
    )


def _collection_summary(coll: MemberCollection, item_count: int, contains_object: bool | None = None) -> dict:
    out = {
        "collection_id": str(coll.collection_id),
        "name": coll.name,
        "description": coll.description,
        "item_count": item_count,
        "created_at": coll.created_at.isoformat() if coll.created_at else None,
        "updated_at": coll.updated_at.isoformat() if coll.updated_at else None,
    }
    if contains_object is not None:
        out["contains_object"] = contains_object
    return out


def _get_own_collection(db: Session, ctx: MemberContext, collection_id: UUID) -> MemberCollection:
    coll = db.query(MemberCollection).filter(
        MemberCollection.collection_id == collection_id,
        MemberCollection.member_id == ctx.member.member_id,
        MemberCollection.organization_id == ctx.org.organization_id,
    ).first()
    if not coll:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Collection not found", "details": {}})
    return coll


def _clean_name(value: str | None) -> str:
    name = (value or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Give the collection a name.",
            "details": {"field": "name"},
        })
    return name


def _visible_counts(db: Session, org: Organization, collection_ids: list) -> dict:
    if not collection_ids:
        return {}
    rows = (
        db.query(MemberCollectionItem.collection_id, func.count(MemberCollectionItem.item_id))
        .join(CollectionObject, CollectionObject.object_id == MemberCollectionItem.object_id)
        .filter(
            MemberCollectionItem.collection_id.in_(collection_ids),
            MemberCollectionItem.organization_id == org.organization_id,
            CollectionObject.organization_id == org.organization_id,
            CollectionObject.is_discoverable == True,  # noqa: E712
            CollectionObject.is_deleted == False,  # noqa: E712
        )
        .group_by(MemberCollectionItem.collection_id)
        .all()
    )
    return {cid: n for cid, n in rows}


# =============================================================================
# Session and sign-in
# =============================================================================


@router.get("/api/discover/{org_slug}/member/session", summary="Current portal member session")
def get_member_session(
    org_slug: str,
    request: Request,
    org: Organization = Depends(member_portal),
    db: Session = Depends(get_admin_db),
):
    """``{"enabled": true, "member": {...} | null}``. 404 when the feature is off."""
    resolved = resolve_member_session(db, org, request.cookies.get(MEMBER_SESSION_COOKIE))
    return {"enabled": True, "member": _member_out(resolved[0]) if resolved else None}


@router.post("/api/discover/{org_slug}/member/sign-in/request", status_code=202, summary="Email a sign-in link")
def request_sign_in_link(
    org_slug: str,
    body: SignInRequestBody,
    request: Request,
    background: BackgroundTasks,
    org: Organization = Depends(member_portal),
    db: Session = Depends(get_admin_db),
):
    """Email a one-time sign-in link to an active member.

    The response is the same whether or not the address belongs to a member,
    and the email is sent after the response, so neither the body nor the
    timing tells a caller who is a member.
    """
    if not _signin_ip_limiter.allow(_client_ip(request), "portal_member_sign_in"):
        return _rate_limited()

    ok = {"message": SIGN_IN_REQUEST_MESSAGE}
    email = normalize_email(body.email)
    if not email:
        # Malformed input is not a membership signal; answer the same way.
        return ok
    if not _signin_email_limiter.allow(f"{org.organization_id}:{email}", "portal_member_sign_in"):
        return _rate_limited()

    member = db.query(PortalMember).filter(
        PortalMember.organization_id == org.organization_id,
        PortalMember.email == email,
        PortalMember.status == "active",
    ).first()
    if not member:
        return ok

    token, _ = issue_login_token(db, member)
    db.commit()
    url = sign_in_url(org_slug, token)
    if get_settings().is_development and not get_settings().email_enabled:
        logger.info("[DEV] Portal member sign-in link for %s: %s", email, url)
    background.add_task(send_sign_in_email, email, org.name, url)
    return ok


@router.post("/api/discover/{org_slug}/member/sign-in/exchange", summary="Exchange a sign-in link for a session")
def exchange_sign_in_link(
    org_slug: str,
    body: SignInExchangeBody,
    request: Request,
    org: Organization = Depends(member_portal),
    db: Session = Depends(get_admin_db),
):
    if not _exchange_ip_limiter.allow(_client_ip(request), "portal_member_exchange"):
        return _rate_limited()

    member = consume_login_token(db, org, body.token)
    if not member:
        db.commit()  # keep the spent token spent even when the member is not usable
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "invalid_link", "message": _INVALID_LINK_MESSAGE, "details": {}}},
        )
    db.commit()
    response = JSONResponse(content={"member": _member_out(member)})
    response.headers["Cache-Control"] = "no-store"
    set_member_session_cookie(response, member, org_slug)
    return response


@router.post("/api/discover/{org_slug}/member/sign-out", summary="Sign out")
def sign_out(
    org_slug: str,
    request: Request,
    org: Organization = Depends(member_portal),
    db: Session = Depends(get_admin_db),
):
    resolved = resolve_member_session(db, org, request.cookies.get(MEMBER_SESSION_COOKIE))
    if resolved:
        end_member_sessions(resolved[0])
        db.commit()
    response = JSONResponse(content={"signed_out": True})
    clear_member_session_cookie(response, org_slug)
    return response


# =============================================================================
# Collections
# =============================================================================


@router.get("/api/discover/{org_slug}/member/collections", summary="List my collections")
def list_my_collections(
    object_id: UUID | None = Query(None, description="Also report whether each collection holds this object"),
    ctx: MemberContext = Depends(current_member),
    db: Session = Depends(get_admin_db),
):
    colls = (
        db.query(MemberCollection)
        .filter(
            MemberCollection.member_id == ctx.member.member_id,
            MemberCollection.organization_id == ctx.org.organization_id,
        )
        .order_by(func.lower(MemberCollection.name), MemberCollection.created_at)
        .all()
    )
    counts = _visible_counts(db, ctx.org, [c.collection_id for c in colls])
    holding: set = set()
    if object_id is not None and colls:
        holding = {
            row[0]
            for row in db.query(MemberCollectionItem.collection_id).filter(
                MemberCollectionItem.collection_id.in_([c.collection_id for c in colls]),
                MemberCollectionItem.object_id == object_id,
            )
        }
    return {
        "collections": [
            _collection_summary(
                c,
                counts.get(c.collection_id, 0),
                (c.collection_id in holding) if object_id is not None else None,
            )
            for c in colls
        ],
    }


@router.post("/api/discover/{org_slug}/member/collections", status_code=201, summary="Create a collection")
def create_my_collection(
    body: CollectionCreateBody,
    ctx: MemberContext = Depends(current_member),
    db: Session = Depends(get_admin_db),
):
    name = _clean_name(body.name)
    existing = db.query(func.count(MemberCollection.collection_id)).filter(
        MemberCollection.member_id == ctx.member.member_id,
    ).scalar()
    if existing >= MAX_COLLECTIONS_PER_MEMBER:
        raise HTTPException(status_code=422, detail={
            "code": "limit_reached",
            "message": f"You can keep up to {MAX_COLLECTIONS_PER_MEMBER} collections.",
            "details": {},
        })
    coll = MemberCollection(
        organization_id=ctx.org.organization_id,
        member_id=ctx.member.member_id,
        name=name,
        description=(body.description or "").strip() or None,
    )
    db.add(coll)
    db.commit()
    db.refresh(coll)
    return _collection_summary(coll, 0)


@router.get("/api/discover/{org_slug}/member/collections/{collection_id}", summary="Get one of my collections")
def get_my_collection(
    org_slug: str,
    collection_id: UUID,
    ctx: MemberContext = Depends(current_member),
    db: Session = Depends(get_admin_db),
):
    from app.fastapi_app.routers.discover_public import _load_public_objects, _public_object_fields

    coll = _get_own_collection(db, ctx, collection_id)
    items = _visible_items_query(db, ctx.org, coll.collection_id).order_by(
        MemberCollectionItem.sort_order, MemberCollectionItem.created_at,
    ).all()
    objects = {o.object_id: o for o in _load_public_objects(db, ctx.org, [i.object_id for i in items])}
    out_items = []
    for item in items:
        obj = objects.get(item.object_id)
        if obj is None:
            continue
        out_items.append({
            "object_id": str(item.object_id),
            "note": item.note,
            "added_at": item.created_at.isoformat() if item.created_at else None,
            "object": _public_object_fields(obj, org_slug),
        })
    return {**_collection_summary(coll, len(out_items)), "items": out_items}


@router.patch("/api/discover/{org_slug}/member/collections/{collection_id}", summary="Rename or describe a collection")
def update_my_collection(
    collection_id: UUID,
    body: CollectionUpdateBody,
    ctx: MemberContext = Depends(current_member),
    db: Session = Depends(get_admin_db),
):
    coll = _get_own_collection(db, ctx, collection_id)
    fields = body.model_fields_set
    if "name" in fields:
        coll.name = _clean_name(body.name)
    if "description" in fields:
        coll.description = (body.description or "").strip() or None
    coll.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(coll)
    count = _visible_counts(db, ctx.org, [coll.collection_id]).get(coll.collection_id, 0)
    return _collection_summary(coll, count)


@router.delete("/api/discover/{org_slug}/member/collections/{collection_id}", status_code=204, summary="Delete a collection")
def delete_my_collection(
    collection_id: UUID,
    ctx: MemberContext = Depends(current_member),
    db: Session = Depends(get_admin_db),
):
    coll = _get_own_collection(db, ctx, collection_id)
    db.query(MemberCollectionItem).filter(MemberCollectionItem.collection_id == coll.collection_id).delete(
        synchronize_session=False
    )
    db.delete(coll)
    db.commit()
    return None


@router.post("/api/discover/{org_slug}/member/collections/{collection_id}/items", summary="Save an object to a collection")
def add_item(
    collection_id: UUID,
    body: ItemAddBody,
    ctx: MemberContext = Depends(current_member),
    db: Session = Depends(get_admin_db),
):
    coll = _get_own_collection(db, ctx, collection_id)
    obj = db.query(CollectionObject.object_id).filter(
        CollectionObject.object_id == body.object_id,
        CollectionObject.organization_id == ctx.org.organization_id,
        CollectionObject.is_discoverable == True,  # noqa: E712
        CollectionObject.is_deleted == False,  # noqa: E712
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Object not found", "details": {}})

    existing = db.query(MemberCollectionItem).filter(
        MemberCollectionItem.collection_id == coll.collection_id,
        MemberCollectionItem.object_id == body.object_id,
    ).first()
    if existing:
        return {"object_id": str(body.object_id), "collection_id": str(coll.collection_id), "already_saved": True}

    total = db.query(func.count(MemberCollectionItem.item_id)).filter(
        MemberCollectionItem.collection_id == coll.collection_id,
    ).scalar()
    if total >= MAX_ITEMS_PER_COLLECTION:
        raise HTTPException(status_code=422, detail={
            "code": "limit_reached",
            "message": f"A collection can hold up to {MAX_ITEMS_PER_COLLECTION} objects.",
            "details": {},
        })
    max_order = db.query(func.max(MemberCollectionItem.sort_order)).filter(
        MemberCollectionItem.collection_id == coll.collection_id,
    ).scalar()
    db.add(MemberCollectionItem(
        organization_id=ctx.org.organization_id,
        collection_id=coll.collection_id,
        object_id=body.object_id,
        note=(body.note or "").strip() or None,
        sort_order=(max_order or 0) + 1,
    ))
    coll.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"object_id": str(body.object_id), "collection_id": str(coll.collection_id), "already_saved": False}


@router.delete("/api/discover/{org_slug}/member/collections/{collection_id}/items/{object_id}", status_code=204, summary="Remove an object from a collection")
def remove_item(
    collection_id: UUID,
    object_id: UUID,
    ctx: MemberContext = Depends(current_member),
    db: Session = Depends(get_admin_db),
):
    coll = _get_own_collection(db, ctx, collection_id)
    deleted = db.query(MemberCollectionItem).filter(
        MemberCollectionItem.collection_id == coll.collection_id,
        MemberCollectionItem.object_id == object_id,
    ).delete(synchronize_session=False)
    if not deleted:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Object is not in this collection", "details": {}})
    coll.updated_at = datetime.now(timezone.utc)
    db.commit()
    return None


@router.get("/api/discover/{org_slug}/member/collections/{collection_id}/export", summary="Export one of my collections")
def export_my_collection(
    org_slug: str,
    collection_id: UUID,
    request: Request,
    format: str = Query("csv", pattern="^(csv|json)$", description="csv or json"),
    ctx: MemberContext = Depends(current_member),
    db: Session = Depends(get_admin_db),
):
    """Download a collection's visible objects with the public fields only,
    in the same CSV/JSON shape as the public portal exports."""
    from app.fastapi_app.routers.discover_public import (
        _export_rate_limited,
        _export_response,
        _load_public_objects,
        _public_object_fields,
    )

    limited = _export_rate_limited(request)
    if limited:
        return limited
    coll = _get_own_collection(db, ctx, collection_id)
    object_ids = [
        i.object_id
        for i in _visible_items_query(db, ctx.org, coll.collection_id)
        .order_by(MemberCollectionItem.sort_order, MemberCollectionItem.created_at)
        .limit(MAX_ITEMS_PER_COLLECTION)
        .all()
    ]
    from app.services.public_object_fields import get_public_field_keys

    public_keys = get_public_field_keys(db, ctx.org.organization_id)
    objects = _load_public_objects(db, ctx.org, object_ids)
    rows = [_public_object_fields(o, org_slug, public_keys) for o in objects]
    response = _export_response(
        fmt=format,
        rows=rows,
        filename_stem=f"{org_slug}-{coll.name}-{date.today().isoformat()}",
        source={"type": "member_collection", "collection": ctx.org.name, "name": coll.name},
        total_matches=len(rows),
        public_keys=public_keys,
    )
    response.headers["Cache-Control"] = "private, no-store"
    return response
