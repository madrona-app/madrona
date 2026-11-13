"""
Portal members: emailed sign-in links and saved personal collections.

Security invariants under test:
  * the feature switch: while off, every member endpoint is a 404;
  * sign-in links: random, stored only as a keyed hash, single use, 15-minute
    expiry, bound to one organization, only for active members;
  * "send link" answers identically for members and non-members;
  * rate limits per caller IP and per recipient;
  * a member session never authenticates a staff endpoint, and a staff
    session never authenticates a member endpoint;
  * cross-organization isolation (sessions, links, collections, objects);
  * only discoverable objects can be saved; unpublished ones are hidden,
    not deleted;
  * member state-changing requests are CSRF-checked although the rest of
    /api/discover/ is exempt;
  * suspension and sign-out end existing sessions.
"""

import csv
import io
import json
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.fastapi_app.routers import discover_members
from app.models import (
    CollectionObject,
    DiscoverConfig,
    MemberCollection,
    MemberCollectionItem,
    ObjectTitle,
    Organization,
    PortalMember,
    PortalMemberLoginToken,
)
from app.services import portal_members as pm
from app.services.auth_utils import (
    decode_access_token,
    generate_access_token,
    generate_portal_member_session,
    hash_portal_member_login_token,
)
from app.services.rate_limiter import RateLimiter

# Captured at import time, before the autouse fixture patches it to always allow.
_REAL_ALLOW = RateLimiter.allow

PRIVATE_SENTINEL = "PRIVATE-SENTINEL-members-91c2"
SIGN_IN_MESSAGE = "If that address belongs to a member, a sign-in link is on its way."


# =============================================================================
# Helpers
# =============================================================================


def _org(db, slug, enabled=True):
    org = Organization(name=f"{slug} museum", slug=slug, is_demo=False, status="active")
    db.add(org)
    db.flush()
    db.add(DiscoverConfig(organization_id=org.organization_id, member_collections_enabled=enabled))
    db.flush()
    return org


def _member(db, org, email="reader@example.com", status="active"):
    m = PortalMember(organization_id=org.organization_id, email=email, status=status, display_name="Reader")
    db.add(m)
    db.flush()
    return m


def _obj(db, org, title="Braille slate", **kw):
    defaults = dict(
        organization_id=org.organization_id,
        object_number=f"MEM-{uuid.uuid4().hex[:6].upper()}",
        is_discoverable=True,
        brief_description="Public description",
        object_type="tool",
        insurance_note=PRIVATE_SENTINEL,
        acquisition_note=PRIVATE_SENTINEL,
    )
    defaults.update(kw)
    obj = CollectionObject(**defaults)
    db.add(obj)
    db.flush()
    db.add(ObjectTitle(organization_id=org.organization_id, object_id=obj.object_id, title=title, is_preferred=True))
    db.flush()
    return obj


def _base(slug):
    return f"/api/discover/{slug}/member"


def _token_from_email(mock_email):
    assert mock_email.send_email.called, "expected a sign-in email"
    text = mock_email.send_email.call_args.kwargs["text"]
    match = re.search(r"#token=([A-Za-z0-9_\-]+)", text)
    assert match, text
    return match.group(1)


def _set_cookie_value(response, name=pm.MEMBER_SESSION_COOKIE):
    """Value of ``name`` in the response's Set-Cookie header, or None."""
    for header in response.headers.get_list("set-cookie"):
        if header.startswith(f"{name}="):
            return header.split(";", 1)[0].split("=", 1)[1]
    return None


def _sign_in(client, db, org, member):
    """Sign ``member`` in through a staff-style issued token; returns the session cookie value."""
    token, _ = pm.issue_login_token(db, member)
    db.commit()
    res = client.post(f"{_base(org.slug)}/sign-in/exchange", json={"token": token})
    assert res.status_code == 200, res.json
    cookie = _set_cookie_value(res)
    assert cookie
    return cookie


@pytest.fixture
def real_rate_limits(monkeypatch):
    """Real sliding-window limits, in memory, with fresh buckets."""
    monkeypatch.setattr(RateLimiter, "allow", _REAL_ALLOW)
    monkeypatch.setattr(RateLimiter, "_allow_redis", lambda self, a, b: None)
    monkeypatch.setattr(discover_members, "_signin_ip_limiter", RateLimiter(max_requests=10, window_seconds=900))
    monkeypatch.setattr(discover_members, "_signin_email_limiter", RateLimiter(max_requests=5, window_seconds=900))
    monkeypatch.setattr(discover_members, "_exchange_ip_limiter", RateLimiter(max_requests=20, window_seconds=900))
    # The global per-IP middleware buckets must not interfere.
    from app.fastapi_app.middleware import rate_limit as rl_mw
    monkeypatch.setattr(rl_mw, "_read_limiter", RateLimiter(max_requests=10_000, window_seconds=60))
    monkeypatch.setattr(rl_mw, "_write_limiter", RateLimiter(max_requests=10_000, window_seconds=60))


# =============================================================================
# Feature switch
# =============================================================================


class TestFeatureSwitch:
    def test_every_member_endpoint_is_404_when_off(self, client, db_session):
        org = _org(db_session, "mem-off", enabled=False)
        member = _member(db_session, org)
        coll = MemberCollection(organization_id=org.organization_id, member_id=member.member_id, name="Mine")
        db_session.add(coll)
        db_session.commit()
        cookie = generate_portal_member_session(
            str(member.member_id), str(org.organization_id), 0, int(time.time()), 60,
        )
        client.cookies.set(pm.MEMBER_SESSION_COOKIE, cookie, path=_base(org.slug))
        b = _base(org.slug)
        cid = coll.collection_id
        calls = [
            ("get", f"{b}/session", None),
            ("post", f"{b}/sign-in/request", {"email": "reader@example.com"}),
            ("post", f"{b}/sign-in/exchange", {"token": "x" * 43}),
            ("post", f"{b}/sign-out", None),
            ("get", f"{b}/collections", None),
            ("post", f"{b}/collections", {"name": "New"}),
            ("get", f"{b}/collections/{cid}", None),
            ("patch", f"{b}/collections/{cid}", {"name": "Renamed"}),
            ("delete", f"{b}/collections/{cid}", None),
            ("post", f"{b}/collections/{cid}/items", {"object_id": str(uuid.uuid4())}),
            ("delete", f"{b}/collections/{cid}/items/{uuid.uuid4()}", None),
            ("get", f"{b}/collections/{cid}/export?format=csv", None),
        ]
        for method, url, body in calls:
            kwargs = {"json": body} if body is not None else {}
            res = getattr(client, method)(url, **kwargs)
            assert res.status_code == 404, (method, url, res.status_code)

    def test_no_config_row_means_off(self, client, db_session):
        org = Organization(name="bare", slug="mem-bare", is_demo=False, status="active")
        db_session.add(org)
        db_session.commit()
        assert client.get(f"{_base('mem-bare')}/session").status_code == 404

    def test_unknown_or_inactive_portal_is_404(self, client, db_session):
        org = _org(db_session, "mem-inactive")
        org.status = "suspended"
        db_session.commit()
        assert client.get(f"{_base('mem-inactive')}/session").status_code == 404
        assert client.get(f"{_base('no-such-portal')}/session").status_code == 404

    def test_session_reports_enabled_and_signed_out(self, client, db_session):
        _org(db_session, "mem-on")
        db_session.commit()
        res = client.get(f"{_base('mem-on')}/session")
        assert res.status_code == 200
        assert res.json == {"enabled": True, "member": None}


# =============================================================================
# Sign-in links
# =============================================================================


class TestSignInLinks:
    def test_request_does_not_reveal_membership(self, client, db_session, mock_email_service):
        org = _org(db_session, "mem-enum")
        _member(db_session, org, "active@example.com", "active")
        _member(db_session, org, "invited@example.com", "invited")
        _member(db_session, org, "suspended@example.com", "suspended")
        db_session.commit()

        responses = {}
        for email in ["active@example.com", "invited@example.com", "suspended@example.com",
                      "stranger@example.com", "not-an-email"]:
            mock_email_service.send_email.reset_mock()
            res = client.post(f"{_base(org.slug)}/sign-in/request", json={"email": email})
            responses[email] = (res.status_code, res.json, mock_email_service.send_email.called)

        bodies = {(code, json.dumps(body, sort_keys=True)) for code, body, _ in responses.values()}
        assert bodies == {(202, json.dumps({"message": SIGN_IN_MESSAGE}))}
        sent = {email for email, (_, _, called) in responses.items() if called}
        assert sent == {"active@example.com"}

    def test_email_is_case_insensitive(self, client, db_session, mock_email_service):
        org = _org(db_session, "mem-case")
        _member(db_session, org, "reader@example.com")
        db_session.commit()
        client.post(f"{_base(org.slug)}/sign-in/request", json={"email": "  Reader@Example.COM "})
        assert mock_email_service.send_email.call_args.kwargs["to"] == ["reader@example.com"]

    def test_token_is_stored_hashed_and_link_carries_it_in_fragment(self, client, db_session, mock_email_service):
        org = _org(db_session, "mem-hash")
        member = _member(db_session, org)
        db_session.commit()
        client.post(f"{_base(org.slug)}/sign-in/request", json={"email": member.email})
        token = _token_from_email(mock_email_service)
        assert len(token) >= 43  # token_urlsafe(32)

        rows = db_session.query(PortalMemberLoginToken).filter_by(member_id=member.member_id).all()
        assert len(rows) == 1
        row = rows[0]
        assert row.token_hash == hash_portal_member_login_token(token)
        assert row.token_hash != token and token not in row.token_hash
        assert len(row.token_hash) == 64
        ttl = row.expires_at - row.created_at
        assert timedelta(minutes=14) < ttl <= timedelta(minutes=15, seconds=5)
        text = mock_email_service.send_email.call_args.kwargs["text"]
        assert f"/c/{org.slug}/member/welcome#token={token}" in text
        assert "?token=" not in text

    def test_exchange_sets_scoped_httponly_cookie_and_is_single_use(self, client, db_session, mock_email_service):
        org = _org(db_session, "mem-once")
        member = _member(db_session, org)
        db_session.commit()
        client.post(f"{_base(org.slug)}/sign-in/request", json={"email": member.email})
        token = _token_from_email(mock_email_service)

        res = client.post(f"{_base(org.slug)}/sign-in/exchange", json={"token": token})
        assert res.status_code == 200
        assert res.json["member"]["email"] == member.email
        set_cookie = res.headers["set-cookie"]
        assert set_cookie.startswith(f"{pm.MEMBER_SESSION_COOKIE}=")
        assert "HttpOnly" in set_cookie
        assert "SameSite=lax" in set_cookie or "SameSite=Lax" in set_cookie
        assert f"Path=/api/discover/{org.slug}/member" in set_cookie
        assert "Max-Age=7200" in set_cookie
        assert client.get(f"{_base(org.slug)}/session").json["member"]["email"] == member.email

        client.cookies.clear()
        client.cookies.set("csrf_token", client._csrf_token, path="/")
        again = client.post(f"{_base(org.slug)}/sign-in/exchange", json={"token": token})
        assert again.status_code == 400
        assert again.json["error"]["code"] == "invalid_link"
        assert pm.MEMBER_SESSION_COOKIE not in again.headers.get("set-cookie", "")

    def test_a_new_link_spends_the_previous_one(self, client, db_session):
        org = _org(db_session, "mem-newest")
        member = _member(db_session, org)
        first, _ = pm.issue_login_token(db_session, member)
        db_session.commit()
        second, _ = pm.issue_login_token(db_session, member)
        db_session.commit()
        assert client.post(f"{_base(org.slug)}/sign-in/exchange", json={"token": first}).status_code == 400
        assert client.post(f"{_base(org.slug)}/sign-in/exchange", json={"token": second}).status_code == 200

    def test_expired_link_is_refused(self, client, db_session):
        org = _org(db_session, "mem-expired")
        member = _member(db_session, org)
        token, _ = pm.issue_login_token(db_session, member)
        db_session.flush()
        row = db_session.query(PortalMemberLoginToken).filter_by(member_id=member.member_id, used_at=None).one()
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db_session.commit()
        res = client.post(f"{_base(org.slug)}/sign-in/exchange", json={"token": token})
        assert res.status_code == 400
        assert _set_cookie_value(res) is None

    def test_unknown_token_is_refused(self, client, db_session):
        org = _org(db_session, "mem-unknown")
        db_session.commit()
        res = client.post(f"{_base(org.slug)}/sign-in/exchange", json={"token": "A" * 43})
        assert res.status_code == 400

    def test_link_for_suspended_member_is_refused_and_spent(self, client, db_session):
        org = _org(db_session, "mem-susp-link")
        member = _member(db_session, org)
        token, _ = pm.issue_login_token(db_session, member)
        member.status = "suspended"
        db_session.commit()
        assert client.post(f"{_base(org.slug)}/sign-in/exchange", json={"token": token}).status_code == 400
        member.status = "active"
        db_session.commit()
        # Spent by the refused attempt: reactivation does not revive it.
        assert client.post(f"{_base(org.slug)}/sign-in/exchange", json={"token": token}).status_code == 400

    def test_link_from_one_portal_does_not_work_at_another(self, client, db_session):
        org_a = _org(db_session, "mem-link-a")
        org_b = _org(db_session, "mem-link-b")
        member_a = _member(db_session, org_a)
        _member(db_session, org_b)  # same address, other org
        token, _ = pm.issue_login_token(db_session, member_a)
        db_session.commit()
        assert client.post(f"{_base(org_b.slug)}/sign-in/exchange", json={"token": token}).status_code == 400
        # and the token is still usable where it belongs
        assert client.post(f"{_base(org_a.slug)}/sign-in/exchange", json={"token": token}).status_code == 200


# =============================================================================
# Rate limits
# =============================================================================


class TestRateLimits:
    def test_per_recipient_limit_applies_to_members_and_strangers_alike(
        self, client, db_session, mock_email_service, real_rate_limits,
    ):
        org = _org(db_session, "mem-rl-email")
        _member(db_session, org, "member@example.com")
        db_session.commit()
        for email in ["member@example.com", "stranger@example.com"]:
            codes = [
                client.post(f"{_base(org.slug)}/sign-in/request", json={"email": email},
                            headers={"X-Forwarded-For": f"203.0.113.{i}", "X-CSRF-Token": client._csrf_token}).status_code
                for i in range(6)
            ]
            assert codes == [202] * 5 + [429], (email, codes)

    def test_per_ip_limit(self, client, db_session, mock_email_service, real_rate_limits):
        org = _org(db_session, "mem-rl-ip")
        db_session.commit()
        codes = [
            client.post(f"{_base(org.slug)}/sign-in/request", json={"email": f"p{i}@example.com"},
                        headers={"X-Forwarded-For": "198.51.100.7", "X-CSRF-Token": client._csrf_token}).status_code
            for i in range(11)
        ]
        assert codes == [202] * 10 + [429]

    def test_exchange_is_rate_limited_per_ip(self, client, db_session, real_rate_limits):
        org = _org(db_session, "mem-rl-x")
        db_session.commit()
        codes = [
            client.post(f"{_base(org.slug)}/sign-in/exchange", json={"token": "B" * 43},
                        headers={"X-Forwarded-For": "198.51.100.9", "X-CSRF-Token": client._csrf_token}).status_code
            for i in range(21)
        ]
        assert codes == [400] * 20 + [429]


# =============================================================================
# Identity separation
# =============================================================================


class TestIdentitySeparation:
    def test_member_session_cannot_call_staff_endpoints(self, client, db_session, auth_setup):
        _, org_proxy, _ = auth_setup
        org = db_session.get(Organization, org_proxy.organization_id)
        db_session.add(DiscoverConfig(organization_id=org.organization_id, member_collections_enabled=True))
        member = _member(db_session, org)
        db_session.commit()
        member_cookie = _sign_in(client, db_session, org, member)

        assert decode_access_token(member_cookie) is None

        staff_urls = [
            f"/api/organizations/{org.organization_id}/collections/discover/members",
            f"/api/organizations/{org.organization_id}/collections/discover-config",
        ]
        for url in staff_urls:
            # as a bearer token
            res = client.get(url, headers={"Authorization": f"Bearer {member_cookie}"})
            assert res.status_code == 401, (url, res.status_code)
            # as the member cookie on a staff path, and posing as staff cookies
            client.cookies.set(pm.MEMBER_SESSION_COOKIE, member_cookie, path="/")
            client.cookies.set("refresh_token", member_cookie, path="/")
            client.cookies.set("access_token", member_cookie, path="/")
            res = client.get(url)
            assert res.status_code == 401, (url, res.status_code)
            client.cookies.delete("refresh_token")
            client.cookies.delete("access_token")

    def test_staff_session_cannot_call_member_endpoints(self, client, db_session, auth_setup):
        auth_client, org_proxy, user = auth_setup
        org = db_session.get(Organization, org_proxy.organization_id)
        db_session.add(DiscoverConfig(organization_id=org.organization_id, member_collections_enabled=True))
        db_session.commit()
        b = _base(org.slug)

        # Staff bearer token: not read by the member API.
        assert auth_client.get(f"{b}/collections").status_code == 401
        assert auth_client.post(f"{b}/collections", json={"name": "Staff"}).status_code == 401
        assert auth_client.get(f"{b}/session").json["member"] is None

        # Staff access token placed in the member cookie: wrong type/audience.
        staff_token = generate_access_token(
            user_id=str(user.user_id), email=user.email,
            active_organization_id=str(org.organization_id), expires_minutes=60,
        )
        client.cookies.set(pm.MEMBER_SESSION_COOKIE, staff_token, path=b)
        assert client.get(f"{b}/collections").status_code == 401
        assert client.get(f"{b}/session").json["member"] is None

    def test_forged_or_tampered_session_is_refused(self, client, db_session):
        org = _org(db_session, "mem-forged")
        member = _member(db_session, org)
        db_session.commit()
        import jwt as pyjwt
        forged = pyjwt.encode(
            {"sub": str(member.member_id), "org": str(org.organization_id), "sv": 0,
             "auth_time": int(time.time()), "iat": int(time.time()), "exp": int(time.time()) + 600,
             "type": "portal_member", "aud": "madrona-portal-member"},
            "not-the-server-secret", algorithm="HS256",
        )
        client.cookies.set(pm.MEMBER_SESSION_COOKIE, forged, path=_base(org.slug))
        assert client.get(f"{_base(org.slug)}/collections").status_code == 401

    def test_absolute_session_limit(self, client, db_session):
        org = _org(db_session, "mem-absolute")
        member = _member(db_session, org)
        db_session.commit()
        old = generate_portal_member_session(
            str(member.member_id), str(org.organization_id), 0,
            int(time.time()) - pm.SESSION_ABSOLUTE_SECONDS - 5, 60,
        )
        client.cookies.set(pm.MEMBER_SESSION_COOKIE, old, path=_base(org.slug))
        assert client.get(f"{_base(org.slug)}/collections").status_code == 401

    def test_sliding_renewal_keeps_the_sign_in_time(self, client, db_session):
        org = _org(db_session, "mem-slide")
        member = _member(db_session, org)
        db_session.commit()
        auth_time = int(time.time()) - 3600
        with patch("app.services.auth_utils.datetime") as dt:
            dt.now.return_value = datetime.now(timezone.utc) - timedelta(minutes=30)
            older = generate_portal_member_session(
                str(member.member_id), str(org.organization_id), 0, auth_time, 120,
            )
        client.cookies.set(pm.MEMBER_SESSION_COOKIE, older, path=_base(org.slug))
        res = client.get(f"{_base(org.slug)}/collections")
        assert res.status_code == 200
        assert pm.MEMBER_SESSION_COOKIE in res.headers.get("set-cookie", "")
        assert res.headers["cache-control"] == "no-store"
        renewed = _set_cookie_value(res)
        assert renewed != older
        from app.services.auth_utils import decode_portal_member_session
        assert decode_portal_member_session(renewed)["auth_time"] == auth_time

    def test_sign_out_ends_the_session(self, client, db_session):
        org = _org(db_session, "mem-signout")
        member = _member(db_session, org)
        db_session.commit()
        cookie = _sign_in(client, db_session, org, member)
        assert client.post(f"{_base(org.slug)}/sign-out").status_code == 200
        client.cookies.set(pm.MEMBER_SESSION_COOKIE, cookie, path=_base(org.slug))
        assert client.get(f"{_base(org.slug)}/collections").status_code == 401

    def test_suspension_ends_sessions_and_links(self, client, db_session, auth_setup):
        auth_client, org_proxy, _ = auth_setup
        org = db_session.get(Organization, org_proxy.organization_id)
        db_session.add(DiscoverConfig(organization_id=org.organization_id, member_collections_enabled=True))
        member = _member(db_session, org)
        db_session.commit()
        cookie = _sign_in(client, db_session, org, member)
        pending, _ = pm.issue_login_token(db_session, member)
        db_session.commit()

        res = auth_client.post(
            f"/api/organizations/{org.organization_id}/collections/discover/members/{member.member_id}/suspend"
        )
        assert res.status_code == 200 and res.json["status"] == "suspended"
        client.cookies.set(pm.MEMBER_SESSION_COOKIE, cookie, path=_base(org.slug))
        assert client.get(f"{_base(org.slug)}/collections").status_code == 401
        assert client.post(f"{_base(org.slug)}/sign-in/exchange", json={"token": pending}).status_code == 400


# =============================================================================
# Cross-organization isolation
# =============================================================================


class TestCrossOrg:
    def test_session_from_one_portal_is_refused_at_another(self, client, db_session):
        org_a = _org(db_session, "mem-x-a")
        org_b = _org(db_session, "mem-x-b")
        member_a = _member(db_session, org_a)
        db_session.commit()
        cookie = _sign_in(client, db_session, org_a, member_a)
        client.cookies.set(pm.MEMBER_SESSION_COOKIE, cookie, path=_base(org_b.slug))
        assert client.get(f"{_base(org_b.slug)}/collections").status_code == 401

    def test_cookie_is_not_sent_to_another_portal(self, client, db_session):
        org_a = _org(db_session, "mem-path-a")
        org_b = _org(db_session, "mem-path-b")
        member_a = _member(db_session, org_a)
        db_session.commit()
        _sign_in(client, db_session, org_a, member_a)
        assert client.get(f"{_base(org_b.slug)}/session").json["member"] is None

    def test_member_cannot_reach_another_members_collection(self, client, db_session):
        org = _org(db_session, "mem-x-own")
        alice = _member(db_session, org, "alice@example.com")
        bob = _member(db_session, org, "bob@example.com")
        obj = _obj(db_session, org)
        bobs = MemberCollection(organization_id=org.organization_id, member_id=bob.member_id, name="Bob's")
        db_session.add(bobs)
        db_session.commit()
        _sign_in(client, db_session, org, alice)
        b = _base(org.slug)
        cid = bobs.collection_id
        assert client.get(f"{b}/collections").json["collections"] == []
        assert client.get(f"{b}/collections/{cid}").status_code == 404
        assert client.patch(f"{b}/collections/{cid}", json={"name": "Mine now"}).status_code == 404
        assert client.post(f"{b}/collections/{cid}/items", json={"object_id": str(obj.object_id)}).status_code == 404
        assert client.get(f"{b}/collections/{cid}/export?format=json").status_code == 404
        assert client.delete(f"{b}/collections/{cid}").status_code == 404
        db_session.expire_all()
        assert db_session.get(MemberCollection, cid).name == "Bob's"

    def test_object_from_another_org_cannot_be_saved(self, client, db_session):
        org = _org(db_session, "mem-x-obj")
        other = _org(db_session, "mem-x-obj-other")
        member = _member(db_session, org)
        foreign = _obj(db_session, other)
        db_session.commit()
        _sign_in(client, db_session, org, member)
        cid = client.post(f"{_base(org.slug)}/collections", json={"name": "Mine"}).json["collection_id"]
        res = client.post(f"{_base(org.slug)}/collections/{cid}/items", json={"object_id": str(foreign.object_id)})
        assert res.status_code == 404

    def test_staff_cannot_manage_another_orgs_members(self, client, db_session, auth_setup):
        auth_client, org_proxy, _ = auth_setup
        # auth_setup's role carries platform.admin (cross-org by design); take
        # it away so this is an ordinary org admin.
        from app.models.core import OrganizationMembership, Permission as PermissionModel, RolePermission
        role_id = db_session.query(OrganizationMembership.role_id).filter_by(
            organization_id=org_proxy.organization_id).scalar()
        pa = db_session.query(PermissionModel.permission_id).filter_by(permission_key="platform.admin").scalar()
        db_session.query(RolePermission).filter_by(role_id=role_id, permission_id=pa).delete()
        db_session.commit()
        other = _org(db_session, "mem-x-staff")
        victim = _member(db_session, other)
        db_session.commit()
        base = f"/api/organizations/{other.organization_id}/collections/discover/members"
        assert auth_client.get(base).status_code == 403
        assert auth_client.post(f"{base}/{victim.member_id}/sign-in-link").status_code == 403
        assert auth_client.post(f"{base}/{victim.member_id}/suspend").status_code == 403


# =============================================================================
# Collections
# =============================================================================


class TestCollections:
    def test_crud_and_item_lifecycle(self, client, db_session):
        org = _org(db_session, "mem-crud")
        member = _member(db_session, org)
        obj = _obj(db_session, org, "Perkins Brailler")
        db_session.commit()
        _sign_in(client, db_session, org, member)
        b = _base(org.slug)

        created = client.post(f"{b}/collections", json={"name": "  Writing tools ", "description": "For my paper"})
        assert created.status_code == 201
        cid = created.json["collection_id"]
        assert created.json["name"] == "Writing tools"

        assert client.post(f"{b}/collections", json={"name": "   "}).status_code == 422

        add = client.post(f"{b}/collections/{cid}/items", json={"object_id": str(obj.object_id), "note": "chapter 2"})
        assert add.status_code == 200 and add.json["already_saved"] is False
        again = client.post(f"{b}/collections/{cid}/items", json={"object_id": str(obj.object_id)})
        assert again.json["already_saved"] is True

        listing = client.get(f"{b}/collections?object_id={obj.object_id}").json["collections"]
        assert listing == [{**listing[0], "name": "Writing tools", "item_count": 1, "contains_object": True}]

        detail = client.get(f"{b}/collections/{cid}").json
        assert detail["item_count"] == 1
        item = detail["items"][0]
        assert item["note"] == "chapter 2"
        assert item["object"]["title"] == "Perkins Brailler"
        assert PRIVATE_SENTINEL not in json.dumps(detail)

        renamed = client.patch(f"{b}/collections/{cid}", json={"name": "Braillewriters"})
        assert renamed.status_code == 200 and renamed.json["name"] == "Braillewriters"

        assert client.delete(f"{b}/collections/{cid}/items/{obj.object_id}").status_code == 204
        assert client.delete(f"{b}/collections/{cid}/items/{obj.object_id}").status_code == 404
        assert client.delete(f"{b}/collections/{cid}").status_code == 204
        assert client.get(f"{b}/collections/{cid}").status_code == 404

    def test_only_discoverable_objects_can_be_saved(self, client, db_session):
        org = _org(db_session, "mem-disc")
        member = _member(db_session, org)
        private = _obj(db_session, org, is_discoverable=False)
        deleted = _obj(db_session, org, is_deleted=True)
        db_session.commit()
        _sign_in(client, db_session, org, member)
        b = _base(org.slug)
        cid = client.post(f"{b}/collections", json={"name": "Mine"}).json["collection_id"]
        for o in (private, deleted):
            assert client.post(f"{b}/collections/{cid}/items", json={"object_id": str(o.object_id)}).status_code == 404
        assert client.post(f"{b}/collections/{cid}/items", json={"object_id": str(uuid.uuid4())}).status_code == 404
        assert db_session.query(MemberCollectionItem).count() == 0

    def test_unpublished_items_are_hidden_not_deleted(self, client, db_session):
        org = _org(db_session, "mem-hide")
        member = _member(db_session, org)
        keep = _obj(db_session, org, "Stays public")
        hide = _obj(db_session, org, "Goes private")
        db_session.commit()
        _sign_in(client, db_session, org, member)
        b = _base(org.slug)
        cid = client.post(f"{b}/collections", json={"name": "Mine"}).json["collection_id"]
        for o in (keep, hide):
            client.post(f"{b}/collections/{cid}/items", json={"object_id": str(o.object_id)})

        hide.is_discoverable = False
        db_session.commit()

        detail = client.get(f"{b}/collections/{cid}").json
        assert [i["object"]["title"] for i in detail["items"]] == ["Stays public"]
        assert client.get(f"{b}/collections").json["collections"][0]["item_count"] == 1
        export = client.get(f"{b}/collections/{cid}/export?format=json").json
        assert [o["title"] for o in export["objects"]] == ["Stays public"]
        assert db_session.query(MemberCollectionItem).filter_by(object_id=hide.object_id).count() == 1

        hide.is_discoverable = True
        db_session.commit()
        assert client.get(f"{b}/collections/{cid}").json["item_count"] == 2

    def test_export_csv_and_json_public_fields_only(self, client, db_session):
        org = _org(db_session, "mem-export")
        member = _member(db_session, org)
        obj = _obj(db_session, org, "Slate and stylus")
        db_session.commit()
        _sign_in(client, db_session, org, member)
        b = _base(org.slug)
        cid = client.post(f"{b}/collections", json={"name": "Research set"}).json["collection_id"]
        client.post(f"{b}/collections/{cid}/items", json={"object_id": str(obj.object_id)})

        res = client.get(f"{b}/collections/{cid}/export?format=csv")
        assert res.status_code == 200
        assert res.headers["content-type"].startswith("text/csv")
        assert "attachment" in res.headers["content-disposition"]
        assert "no-store" in res.headers["cache-control"]
        body = res.content.decode("utf-8-sig")
        assert PRIVATE_SENTINEL not in body
        rows = list(csv.DictReader(io.StringIO(body)))
        assert rows[0]["Title"] == "Slate and stylus"

        res = client.get(f"{b}/collections/{cid}/export?format=json")
        data = res.json
        assert data["source"]["type"] == "member_collection"
        assert data["count"] == 1
        from tests.test_discover_export import EXPECTED_FIELDS
        assert set(data["objects"][0].keys()) == EXPECTED_FIELDS
        assert PRIVATE_SENTINEL not in res.text

    def test_requires_sign_in(self, client, db_session):
        org = _org(db_session, "mem-anon")
        db_session.commit()
        assert client.get(f"{_base(org.slug)}/collections").status_code == 401
        assert client.post(f"{_base(org.slug)}/collections", json={"name": "x"}).status_code == 401


# =============================================================================
# CSRF
# =============================================================================


class TestCsrf:
    def test_member_writes_require_csrf_token(self, client, db_session):
        org = _org(db_session, "mem-csrf")
        member = _member(db_session, org)
        db_session.commit()
        _sign_in(client, db_session, org, member)
        b = _base(org.slug)

        missing = client.post(f"{b}/collections", json={"name": "x"}, headers={"X-CSRF-Token": ""})
        assert missing.status_code == 403
        assert missing.json["error"]["code"] == "csrf_error"
        wrong = client.post(f"{b}/collections", json={"name": "x"}, headers={"X-CSRF-Token": "not-the-cookie"})
        assert wrong.status_code == 403
        # An API-key header does not buy an exemption on the member API.
        keyed = client.post(f"{b}/collections", json={"name": "x"},
                            headers={"X-CSRF-Token": "", "X-API-Key": "mkey_whatever"})
        assert keyed.status_code == 403
        for method, url in [("post", f"{b}/sign-in/request"), ("post", f"{b}/sign-in/exchange"),
                            ("post", f"{b}/sign-out")]:
            res = getattr(client, method)(url, json={"email": "a@example.com", "token": "x"},
                                          headers={"X-CSRF-Token": ""})
            assert res.status_code == 403, url
        assert db_session.query(MemberCollection).count() == 0
        assert client.post(f"{b}/collections", json={"name": "x"}).status_code == 201

    def test_rest_of_discover_stays_exempt(self):
        from app.fastapi_app.middleware.csrf import CSRF_REQUIRED_PATTERNS
        assert not any(p.match("/api/discover/org/search/export") for p in CSRF_REQUIRED_PATTERNS)
        assert any(p.match("/api/discover/org/member/collections") for p in CSRF_REQUIRED_PATTERNS)
        assert any(p.match("/api/discover/org/member") for p in CSRF_REQUIRED_PATTERNS)


# =============================================================================
# Staff management
# =============================================================================


class TestStaffManagement:
    def _base(self, org_id):
        return f"/api/organizations/{org_id}/collections/discover/members"

    def test_invite_approve_link_and_toggle(self, client, db_session, auth_setup):
        auth_client, org_proxy, _ = auth_setup
        org_id = org_proxy.organization_id
        base = self._base(org_id)
        org = db_session.get(Organization, org_id)

        listing = auth_client.get(base).json
        assert listing == {"member_collections_enabled": False, "members": []}

        invited = auth_client.post(base, json={"email": " New.Member@Example.com ", "display_name": "New"})
        assert invited.status_code == 201
        mid = invited.json["member_id"]
        assert invited.json["status"] == "invited"
        assert invited.json["email"] == "new.member@example.com"
        assert auth_client.post(base, json={"email": "new.member@example.com"}).status_code == 409
        assert auth_client.post(base, json={"email": "nope"}).status_code == 422

        # Invited members cannot get a link yet
        assert auth_client.post(f"{base}/{mid}/sign-in-link").status_code == 409

        approved = auth_client.post(f"{base}/{mid}/approve")
        assert approved.json["status"] == "active"
        assert approved.json["approved_at"]

        link = auth_client.post(f"{base}/{mid}/sign-in-link", json={"send_email": False})
        assert link.status_code == 200
        url = link.json["url"]
        assert f"/c/{org.slug}/member/welcome#token=" in url
        assert link.json["expires_in_minutes"] == 15
        assert link.json["feature_enabled"] is False
        token = url.split("#token=")[1]

        # Feature off: link cannot be used yet
        assert client.post(f"{_base(org.slug)}/sign-in/exchange", json={"token": token}).status_code == 404

        on = auth_client.put(f"{base}/settings", json={"member_collections_enabled": True})
        assert on.status_code == 200 and on.json == {"member_collections_enabled": True}
        assert auth_client.get(base).json["member_collections_enabled"] is True

        res = client.post(f"{_base(org.slug)}/sign-in/exchange", json={"token": token})
        assert res.status_code == 200

        row = db_session.query(PortalMemberLoginToken).filter_by(member_id=uuid.UUID(mid)).one()
        assert row.created_by_user_id is not None
        assert row.used_at is not None

    def test_sign_in_link_can_be_emailed(self, client, db_session, auth_setup, mock_email_service):
        auth_client, org_proxy, _ = auth_setup
        base = self._base(org_proxy.organization_id)
        mid = auth_client.post(base, json={"email": "mail@example.com", "approve": True}).json["member_id"]
        res = auth_client.post(f"{base}/{mid}/sign-in-link", json={"send_email": True})
        assert res.json["emailed"] is True
        assert mock_email_service.send_email.call_args.kwargs["to"] == ["mail@example.com"]

    def test_requires_permission(self, client, db_session, viewer_auth_setup):
        viewer_client, org_proxy, _ = viewer_auth_setup
        base = self._base(org_proxy.organization_id)
        assert viewer_client.get(base).status_code == 403
        assert viewer_client.post(base, json={"email": "x@example.com"}).status_code == 403
        assert viewer_client.put(f"{base}/settings", json={"member_collections_enabled": True}).status_code == 403

    def test_anonymous_is_refused(self, client, db_session):
        org = _org(db_session, "mem-staff-anon")
        db_session.commit()
        assert client.get(self._base(org.organization_id)).status_code == 401
