"""Audit campaign lifecycle: approve, start, complete, delete; and cross-org isolation.

An inventory campaign must run end to end: draft -> approved (by someone
other than its creator) -> in progress -> completed (signed off, only once
every listed object is checked). Campaigns that ran are audit evidence and
can be cancelled, never deleted.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import text

from tests.conftest import AuthenticatedClient, _RLS_TEST_ROLE, _create_permission, _create_role_permission
from tests.test_record_workflow import _member

_PERMS = ["audits.view", "audits.create", "audits.edit", "collections.view"]


def _base(org_id):
    return f"/api/organizations/{org_id}/collections/audits"


def _j(r):
    return r.get_json()


@pytest.fixture
def people(client, db_session, auth_setup):
    _, org, _ = auth_setup
    creator, creator_id = _member(client, db_session, org.organization_id, _PERMS, "registrar@example.com")
    approver, _ = _member(client, db_session, org.organization_id, _PERMS + ["audits.approve"], "head@example.com")
    clerk, _ = _member(client, db_session, org.organization_id, ["audits.view"], "clerk@example.com")
    return SimpleNamespace(org=org, creator=creator, creator_id=creator_id, approver=approver, clerk=clerk)


def _create(p, **extra):
    r = p.creator.post(_base(p.org.organization_id), data=json.dumps({
        "title": "Annual spot check", "audit_type": "spot_check", **extra}), content_type="application/json")
    assert r.status_code == 201, _j(r)
    return _j(r)


def _add_result(db_session, p, campaign_id, status):
    from app.models import AuditResult, CollectionObject
    obj = CollectionObject(organization_id=p.org.organization_id, object_number=f"A-{uuid4().hex[:6]}", object_name="o")
    db_session.add(obj)
    db_session.flush()
    db_session.add(AuditResult(campaign_id=campaign_id, organization_id=p.org.organization_id,
                               object_id=obj.object_id, result_status=status))
    db_session.commit()


def _post(c, url):
    return c.post(url, data="{}", content_type="application/json")


def test_full_lifecycle(people, db_session):
    p = people
    camp = _create(p)
    cid = camp.get("audit_id") or camp.get("campaign_id")
    url = f"{_base(p.org.organization_id)}/{cid}"

    # The creator cannot approve their own campaign; someone without approve rights cannot either.
    assert _post(p.creator, f"{url}/approve").status_code == 403
    assert _post(p.clerk, f"{url}/approve").status_code == 403
    # Cannot start before approval.
    assert _post(p.creator, f"{url}/start").status_code == 409

    r = _post(p.approver, f"{url}/approve")
    assert r.status_code == 200, _j(r)
    assert _j(r)["status"] == "approved"
    assert _post(p.approver, f"{url}/approve").status_code == 409

    r = _post(p.creator, f"{url}/start")
    assert r.status_code == 200 and _j(r)["status"] == "in_progress"

    from uuid import UUID
    _add_result(db_session, p, UUID(cid), "pending")
    r = _post(p.creator, f"{url}/complete")
    assert r.status_code == 409 and _j(r)["error"]["pending"] == 1

    from app.models import AuditResult
    db_session.query(AuditResult).filter(AuditResult.campaign_id == UUID(cid)).update({"result_status": "verified"})
    db_session.commit()
    r = _post(p.creator, f"{url}/complete")
    assert r.status_code == 200, _j(r)
    assert _j(r)["status"] == "completed"

    # Completed campaigns are evidence: not deletable, not cancellable.
    assert p.creator.delete(url).status_code == 409
    assert p.creator.put(url, data=json.dumps({"status": "cancelled"}), content_type="application/json").status_code == 409


def test_status_cannot_be_jumped_by_update(people):
    p = people
    cid = _create(p).get("audit_id")
    url = f"{_base(p.org.organization_id)}/{cid}"
    r = p.creator.put(url, data=json.dumps({"status": "completed"}), content_type="application/json")
    assert r.status_code == 422
    r = p.creator.put(url, data=json.dumps({"status": "cancelled"}), content_type="application/json")
    assert r.status_code == 200 and _j(r)["status"] == "cancelled"


def test_delete_rules(people, db_session):
    from uuid import UUID
    p = people
    draft = _create(p)["audit_id"]
    assert p.creator.delete(f"{_base(p.org.organization_id)}/{draft}").status_code == 200
    assert p.creator.get(f"{_base(p.org.organization_id)}/{draft}").status_code == 404

    cancelled = _create(p)["audit_id"]
    _add_result(db_session, p, UUID(cancelled), "not_found")
    p.creator.put(f"{_base(p.org.organization_id)}/{cancelled}", data=json.dumps({"status": "cancelled"}),
                  content_type="application/json")
    r = p.creator.delete(f"{_base(p.org.organization_id)}/{cancelled}")
    assert r.status_code == 409 and "audit evidence" in json.dumps(_j(r))

    assert p.clerk.delete(f"{_base(p.org.organization_id)}/{_create(p)['audit_id']}").status_code == 403


# ── Cross-organization isolation under enforced RLS ────────────────────────

def _seed(session, slug):
    from app.models import AuditCampaign, Organization, OrganizationMembership, Role, User
    from app.services.auth_utils import generate_access_token
    org = Organization(name=slug, slug=slug, is_demo=False, status="active")
    session.add(org)
    session.flush()
    role = Role(role_key=f"aud-{slug}", display_name="Registrar", description="", is_system=False)
    session.add(role)
    session.flush()
    for key in _PERMS + ["audits.approve"]:
        _create_role_permission(session, role, _create_permission(session, key))
    user = User(email=f"r@{slug}.example.com", password_hash="x", status="active",
                email_verified_at=datetime.now(timezone.utc))
    session.add(user)
    session.flush()
    session.add(OrganizationMembership(organization_id=org.organization_id, user_id=user.user_id,
                                       role="member", role_id=role.role_id, status="active"))
    camp = AuditCampaign(organization_id=org.organization_id, campaign_number=f"AUD-{slug}", title=f"{slug} audit",
                         audit_type="spot_check", status="approved")
    session.add(camp)
    session.flush()
    return SimpleNamespace(org_id=org.organization_id, campaign_id=camp.campaign_id, title=camp.title,
                           token=generate_access_token(user_id=str(user.user_id), email=user.email,
                                                       active_organization_id=str(org.organization_id),
                                                       expires_minutes=60))


@pytest.fixture
def tenants(rls_db_session):
    conn = rls_db_session.connection()
    conn.execute(text("RESET ROLE"))
    try:
        a = _seed(rls_db_session, f"alpha-{uuid4().hex[:8]}")
        b = _seed(rls_db_session, f"beta-{uuid4().hex[:8]}")
        rls_db_session.commit()
    finally:
        conn.execute(text(f"SET ROLE {_RLS_TEST_ROLE}"))
    return a, b


@pytest.mark.parametrize("action", ["approve", "start", "complete"])
def test_other_orgs_campaign_cannot_be_moved(rls_client, rls_db_session, tenants, action):
    alpha, beta = tenants
    as_alpha = AuthenticatedClient(rls_client, alpha.token)
    r = as_alpha.post(f"{_base(alpha.org_id)}/{beta.campaign_id}/{action}", json={})
    assert r.status_code == 404
    assert beta.title not in r.text
    rls_db_session.execute(text("RESET ROLE"))
    try:
        status = rls_db_session.execute(text("SELECT status FROM collections.audit_campaigns WHERE campaign_id = :id"),
                                        {"id": str(beta.campaign_id)}).scalar()
    finally:
        rls_db_session.execute(text(f"SET ROLE {_RLS_TEST_ROLE}"))
    assert status == "approved"


def test_other_orgs_campaign_cannot_be_deleted(rls_client, rls_db_session, tenants):
    alpha, beta = tenants
    as_alpha = AuthenticatedClient(rls_client, alpha.token)
    assert as_alpha.delete(f"{_base(alpha.org_id)}/{beta.campaign_id}").status_code == 404
    rls_db_session.execute(text("RESET ROLE"))
    try:
        n = rls_db_session.execute(text("SELECT count(*) FROM collections.audit_campaigns WHERE campaign_id = :id"),
                                   {"id": str(beta.campaign_id)}).scalar()
    finally:
        rls_db_session.execute(text(f"SET ROLE {_RLS_TEST_ROLE}"))
    assert n == 1


def test_own_lifecycle_works_as_the_app_role(rls_client, tenants):
    alpha, _ = tenants
    as_alpha = AuthenticatedClient(rls_client, alpha.token)
    r = as_alpha.post(f"{_base(alpha.org_id)}/{alpha.campaign_id}/start", json={})
    assert r.status_code == 200, r.text[:300]
    assert r.get_json()["status"] == "in_progress"
