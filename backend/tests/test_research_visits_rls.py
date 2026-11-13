"""Research visits under enforced row-level security.

Runs as the NOBYPASSRLS application role (rls_db_session / rls_client), the
same way tests/test_rls_cross_org_isolation.py does, with two organizations
that each hold a visit with one object. Nothing here grants platform.admin,
which reads across organizations by design.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import text

from tests.conftest import (
    AuthenticatedClient,
    _RLS_TEST_ROLE,
    _create_permission,
    _create_role_permission,
)

_PERMISSIONS = (
    "collections.view",
    "use_requests.view",
    "use_requests.create",
    "use_requests.edit",
)


def _seed(session, *, name, slug):
    from app.models import (
        CollectionObject,
        Organization,
        OrganizationMembership,
        ResearchVisit,
        ResearchVisitObject,
        Role,
        User,
    )
    from app.services.auth_utils import generate_access_token

    org = Organization(name=name, slug=slug, is_demo=False, status="active")
    session.add(org)
    session.flush()
    role = Role(role_key=f"rv-{slug}", display_name="Registrar", description="", is_system=False)
    session.add(role)
    session.flush()
    for key in _PERMISSIONS:
        _create_role_permission(session, role, _create_permission(session, key))
    user = User(
        email=f"registrar@{slug}.example.com", password_hash="x", status="active",
        email_verified_at=datetime.now(timezone.utc),
    )
    session.add(user)
    session.flush()
    session.add(OrganizationMembership(
        organization_id=org.organization_id, user_id=user.user_id,
        role="admin", role_id=role.role_id, status="active",
    ))
    obj = CollectionObject(organization_id=org.organization_id, object_number=f"{slug}-OBJ", object_name="Object")
    session.add(obj)
    session.flush()
    visit = ResearchVisit(
        organization_id=org.organization_id,
        researcher_name=f"{name} researcher",
        visit_date=date(2026, 11, 10),
    )
    session.add(visit)
    session.flush()
    session.add(ResearchVisitObject(
        visit_id=visit.visit_id, organization_id=org.organization_id, object_id=obj.object_id,
        handling_note=f"{name} handling note",
    ))
    session.flush()
    return SimpleNamespace(
        org_id=org.organization_id,
        object_id=obj.object_id,
        visit_id=visit.visit_id,
        researcher=visit.researcher_name,
        token=generate_access_token(
            user_id=str(user.user_id), email=user.email,
            active_organization_id=str(org.organization_id), expires_minutes=60,
        ),
    )


@pytest.fixture
def tenants(rls_db_session):
    connection = rls_db_session.connection()
    connection.execute(text("RESET ROLE"))
    try:
        alpha = _seed(rls_db_session, name="Alpha", slug=f"alpha-{uuid4().hex[:8]}")
        beta = _seed(rls_db_session, name="Beta", slug=f"beta-{uuid4().hex[:8]}")
        rls_db_session.commit()
    finally:
        connection.execute(text(f"SET ROLE {_RLS_TEST_ROLE}"))
    return alpha, beta


def _base(org_id):
    return f"/api/organizations/{org_id}/collections/research-visits"


class TestPoliciesAtTheSqlLevel:
    @pytest.mark.parametrize("table", ["collections.research_visits", "collections.research_visit_objects"])
    def test_rls_is_enabled_forced_and_has_a_policy(self, rls_db_session, table):
        schema, name = table.split(".")
        row = rls_db_session.execute(text("""
            SELECT c.relrowsecurity, c.relforcerowsecurity,
                   (SELECT count(*) FROM pg_policies p WHERE p.schemaname = :s AND p.tablename = :t)
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = :s AND c.relname = :t
        """), {"s": schema, "t": name}).one()
        assert row[0] and row[1] and row[2] >= 1, f"{table}: rls={row[0]} forced={row[1]} policies={row[2]}"

    @pytest.mark.parametrize("table,pk", [
        ("collections.research_visits", "visit_id"),
        ("collections.research_visit_objects", "visit_id"),
    ])
    def test_lookup_by_id_alone_cannot_cross_orgs(self, rls_db_session, tenants, table, pk):
        alpha, beta = tenants
        # The other tenant's row is really there (as owner) ...
        rls_db_session.execute(text("RESET ROLE"))
        try:
            assert rls_db_session.execute(
                text(f"SELECT count(*) FROM {table} WHERE {pk} = :id"), {"id": str(beta.visit_id)}
            ).scalar() == 1
        finally:
            rls_db_session.execute(text(f"SET ROLE {_RLS_TEST_ROLE}"))
        # ... and invisible to the app role scoped to the first tenant.
        rls_db_session.execute(text("SELECT set_config('app.current_org_id', :o, true)"), {"o": str(alpha.org_id)})
        assert rls_db_session.execute(
            text(f"SELECT count(*) FROM {table} WHERE {pk} = :id"), {"id": str(beta.visit_id)}
        ).scalar() == 0
        assert rls_db_session.execute(
            text(f"SELECT count(*) FROM {table} WHERE {pk} = :id"), {"id": str(alpha.visit_id)}
        ).scalar() == 1

    def test_cannot_insert_into_another_org(self, rls_db_session, tenants):
        alpha, beta = tenants
        rls_db_session.execute(text("SELECT set_config('app.current_org_id', :o, true)"), {"o": str(alpha.org_id)})
        nested = rls_db_session.begin_nested()
        with pytest.raises(Exception):
            rls_db_session.execute(text("""
                INSERT INTO collections.research_visits (organization_id, researcher_name, visit_date)
                VALUES (:o, 'planted', '2026-11-10')
            """), {"o": str(beta.org_id)})
        nested.rollback()


class TestApiUnderRls:
    def test_list_returns_only_own_org(self, rls_client, tenants):
        alpha, beta = tenants
        as_alpha = AuthenticatedClient(rls_client, alpha.token)
        r = as_alpha.get(_base(alpha.org_id))
        assert r.status_code == 200, r.text[:300]
        names = [v["researcher_name"] for v in r.get_json()["items"]]
        assert alpha.researcher in names
        assert beta.researcher not in names

    def test_other_orgs_visit_not_reachable_by_id(self, rls_client, tenants):
        alpha, beta = tenants
        as_alpha = AuthenticatedClient(rls_client, alpha.token)
        r = as_alpha.get(f"{_base(alpha.org_id)}/{beta.visit_id}")
        assert r.status_code == 404
        assert beta.researcher not in r.text
        r = as_alpha.get(f"{_base(beta.org_id)}/{beta.visit_id}")
        assert r.status_code in (403, 404)
        assert beta.researcher not in r.text

    def test_other_orgs_visit_cannot_be_changed_or_deleted(self, rls_client, rls_db_session, tenants):
        alpha, beta = tenants
        as_alpha = AuthenticatedClient(rls_client, alpha.token)
        assert as_alpha.patch(
            f"{_base(alpha.org_id)}/{beta.visit_id}", json={"location": "hijacked"}
        ).status_code == 404
        assert as_alpha.delete(f"{_base(alpha.org_id)}/{beta.visit_id}").status_code == 404
        assert as_alpha.delete(
            f"{_base(alpha.org_id)}/{beta.visit_id}/objects/{beta.object_id}"
        ).status_code == 404

        rls_db_session.execute(text("RESET ROLE"))
        try:
            row = rls_db_session.execute(text(
                "SELECT location, (SELECT count(*) FROM collections.research_visit_objects o WHERE o.visit_id = v.visit_id) "
                "FROM collections.research_visits v WHERE visit_id = :id"
            ), {"id": str(beta.visit_id)}).one()
        finally:
            rls_db_session.execute(text(f"SET ROLE {_RLS_TEST_ROLE}"))
        assert row[0] is None and row[1] == 1

    def test_cannot_attach_another_orgs_object(self, rls_client, tenants):
        alpha, beta = tenants
        as_alpha = AuthenticatedClient(rls_client, alpha.token)
        r = as_alpha.post(f"{_base(alpha.org_id)}/{alpha.visit_id}/objects", json={"object_id": str(beta.object_id)})
        assert r.status_code == 404

    def test_object_visit_listing_does_not_leak(self, rls_client, tenants):
        alpha, beta = tenants
        as_alpha = AuthenticatedClient(rls_client, alpha.token)
        own = as_alpha.get(f"/api/organizations/{alpha.org_id}/collections/objects/{alpha.object_id}/research-visits")
        assert own.status_code == 200
        assert [v["researcher_name"] for v in own.get_json()["items"]] == [alpha.researcher]

        other = as_alpha.get(f"/api/organizations/{alpha.org_id}/collections/objects/{beta.object_id}/research-visits")
        assert other.status_code == 200
        assert other.get_json()["items"] == []

    def test_own_org_create_and_add_object_work_as_the_app_role(self, rls_client, tenants):
        """Proves the policies admit legitimate writes, so the refusals above
        are about the other tenant and not a blanket denial."""
        alpha, _ = tenants
        as_alpha = AuthenticatedClient(rls_client, alpha.token)
        r = as_alpha.post(_base(alpha.org_id), json={"researcher_name": "New", "visit_date": "2026-11-12"})
        assert r.status_code == 201, r.text[:300]
        vid = r.get_json()["visit_id"]
        r = as_alpha.post(f"{_base(alpha.org_id)}/{vid}/objects", json={"object_id": str(alpha.object_id)})
        assert r.status_code == 201, r.text[:300]
        assert as_alpha.get(f"{_base(alpha.org_id)}/{vid}").get_json()["object_count"] == 1
