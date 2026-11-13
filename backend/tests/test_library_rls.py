"""Library catalog under enforced row-level security.

Runs as the NOBYPASSRLS application role (rls_db_session / rls_client), the
same way tests/test_rls_cross_org_isolation.py does, with two organizations
that each hold a record with a holding, an item, a subject and a name.
Nothing here grants platform.admin, which reads across organizations by
design.
"""

from __future__ import annotations

from datetime import datetime, timezone
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

_PERMISSIONS = ("collections.view", "collections.create", "collections.edit", "collections.delete")

_TABLES = [
    ("collections.bib_records", "bib_record_id", "record_id"),
    ("collections.bib_holdings", "holding_id", "holding_id"),
    ("collections.bib_items", "item_id", "item_id"),
    ("collections.bib_record_subjects", "bib_record_id", "record_id"),
    ("collections.bib_record_constituents", "bib_record_id", "record_id"),
]


def _seed(session, *, name, slug):
    from app.models import (
        BibHolding,
        BibItem,
        BibRecord,
        BibRecordConstituent,
        BibRecordSubject,
        CollectionObject,
        Constituent,
        Organization,
        OrganizationMembership,
        Role,
        SubjectAuthority,
        User,
    )
    from app.services.auth_utils import generate_access_token

    org = Organization(name=name, slug=slug, is_demo=False, status="active")
    session.add(org)
    session.flush()
    role = Role(role_key=f"lib-{slug}", display_name="Librarian", description="", is_system=False)
    session.add(role)
    session.flush()
    for key in _PERMISSIONS:
        _create_role_permission(session, role, _create_permission(session, key))
    user = User(
        email=f"librarian@{slug}.example.com", password_hash="x", status="active",
        email_verified_at=datetime.now(timezone.utc),
    )
    session.add(user)
    session.flush()
    session.add(OrganizationMembership(
        organization_id=org.organization_id, user_id=user.user_id,
        role="admin", role_id=role.role_id, status="active",
    ))
    obj = CollectionObject(organization_id=org.organization_id, object_number=f"{slug}-OBJ", object_name="Object")
    subject = SubjectAuthority(organization_id=org.organization_id, preferred_term=f"{name} subject")
    person = Constituent(organization_id=org.organization_id, constituent_type="person", name=f"{name} author")
    session.add_all([obj, subject, person])
    session.flush()
    record = BibRecord(organization_id=org.organization_id, title=f"{name} book", record_type="braille")
    session.add(record)
    session.flush()
    holding = BibHolding(organization_id=org.organization_id, bib_record_id=record.bib_record_id, call_number=f"{name}-CALL")
    session.add(holding)
    session.flush()
    item = BibItem(organization_id=org.organization_id, holding_id=holding.holding_id, barcode="SHARED-BARCODE")
    session.add(item)
    session.add(BibRecordSubject(
        organization_id=org.organization_id, bib_record_id=record.bib_record_id,
        subject_authority_id=subject.authority_id,
    ))
    session.add(BibRecordConstituent(
        organization_id=org.organization_id, bib_record_id=record.bib_record_id,
        constituent_id=person.constituent_id, role="author",
    ))
    session.flush()
    return SimpleNamespace(
        org_id=org.organization_id,
        record_id=record.bib_record_id,
        holding_id=holding.holding_id,
        item_id=item.item_id,
        object_id=obj.object_id,
        subject_id=subject.authority_id,
        person_id=person.constituent_id,
        title=record.title,
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
    return f"/api/organizations/{org_id}/collections/library/records"


class TestPoliciesAtTheSqlLevel:
    @pytest.mark.parametrize("table", [t for t, _, _ in _TABLES])
    def test_rls_is_enabled_forced_and_has_a_policy(self, rls_db_session, table):
        schema, name = table.split(".")
        row = rls_db_session.execute(text("""
            SELECT c.relrowsecurity, c.relforcerowsecurity,
                   (SELECT count(*) FROM pg_policies p WHERE p.schemaname = :s AND p.tablename = :t)
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = :s AND c.relname = :t
        """), {"s": schema, "t": name}).one()
        assert row[0] and row[1] and row[2] >= 1, f"{table}: rls={row[0]} forced={row[1]} policies={row[2]}"

    @pytest.mark.parametrize("table,column,attr", _TABLES)
    def test_lookup_by_id_alone_cannot_cross_orgs(self, rls_db_session, tenants, table, column, attr):
        alpha, beta = tenants
        rls_db_session.execute(text("RESET ROLE"))
        try:
            assert rls_db_session.execute(
                text(f"SELECT count(*) FROM {table} WHERE {column} = :id"), {"id": str(getattr(beta, attr))}
            ).scalar() == 1
        finally:
            rls_db_session.execute(text(f"SET ROLE {_RLS_TEST_ROLE}"))
        rls_db_session.execute(text("SELECT set_config('app.current_org_id', :o, true)"), {"o": str(alpha.org_id)})
        assert rls_db_session.execute(
            text(f"SELECT count(*) FROM {table} WHERE {column} = :id"), {"id": str(getattr(beta, attr))}
        ).scalar() == 0
        assert rls_db_session.execute(
            text(f"SELECT count(*) FROM {table} WHERE {column} = :id"), {"id": str(getattr(alpha, attr))}
        ).scalar() == 1

    def test_cannot_insert_into_another_org(self, rls_db_session, tenants):
        alpha, beta = tenants
        rls_db_session.execute(text("SELECT set_config('app.current_org_id', :o, true)"), {"o": str(alpha.org_id)})
        nested = rls_db_session.begin_nested()
        with pytest.raises(Exception):
            rls_db_session.execute(text("""
                INSERT INTO collections.bib_records (organization_id, title, record_type)
                VALUES (:o, 'planted', 'book')
            """), {"o": str(beta.org_id)})
        nested.rollback()


class TestApiUnderRls:
    def test_list_returns_only_own_org(self, rls_client, tenants):
        alpha, beta = tenants
        as_alpha = AuthenticatedClient(rls_client, alpha.token)
        r = as_alpha.get(_base(alpha.org_id))
        assert r.status_code == 200, r.text[:300]
        titles = [v["title"] for v in r.get_json()["items"]]
        assert titles == [alpha.title]
        # Searching by the other tenant's call number or the shared barcode
        # finds only this tenant's record.
        assert as_alpha.get(f"{_base(alpha.org_id)}?q=Beta-CALL").get_json()["total"] == 0
        assert [v["title"] for v in as_alpha.get(f"{_base(alpha.org_id)}?q=SHARED-BARCODE").get_json()["items"]] == [alpha.title]

    def test_other_orgs_record_not_reachable(self, rls_client, tenants):
        alpha, beta = tenants
        as_alpha = AuthenticatedClient(rls_client, alpha.token)
        r = as_alpha.get(f"{_base(alpha.org_id)}/{beta.record_id}")
        assert r.status_code == 404
        assert beta.title not in r.text
        r = as_alpha.get(f"{_base(beta.org_id)}/{beta.record_id}")
        assert r.status_code in (403, 404)
        assert beta.title not in r.text

    def test_own_record_detail_shows_only_own_links(self, rls_client, tenants):
        alpha, _ = tenants
        as_alpha = AuthenticatedClient(rls_client, alpha.token)
        got = as_alpha.get(f"{_base(alpha.org_id)}/{alpha.record_id}").get_json()
        assert [s["preferred_term"] for s in got["subjects"]] == ["Alpha subject"]
        assert [n["name"] for n in got["names"]] == ["Alpha author"]
        assert [i["barcode"] for i in got["holdings"][0]["items"]] == ["SHARED-BARCODE"]

    def test_other_orgs_rows_cannot_be_changed_or_deleted(self, rls_client, rls_db_session, tenants):
        alpha, beta = tenants
        as_alpha = AuthenticatedClient(rls_client, alpha.token)
        b = _base(alpha.org_id)
        assert as_alpha.patch(f"{b}/{beta.record_id}", json={"edition": "hijacked"}).status_code == 404
        assert as_alpha.delete(f"{b}/{beta.record_id}").status_code == 404
        assert as_alpha.post(f"{b}/{beta.record_id}/holdings", json={}).status_code == 404
        assert as_alpha.patch(f"{b}/{beta.record_id}/holdings/{beta.holding_id}", json={"staff_note": "x"}).status_code == 404
        assert as_alpha.delete(f"{b}/{beta.record_id}/holdings/{beta.holding_id}").status_code == 404
        assert as_alpha.patch(
            f"{b}/{beta.record_id}/holdings/{beta.holding_id}/items/{beta.item_id}", json={"status": "missing"}
        ).status_code == 404
        # Mixing own record with the other tenant's holding is refused too.
        assert as_alpha.post(f"{b}/{alpha.record_id}/holdings/{beta.holding_id}/items", json={}).status_code == 404

        rls_db_session.execute(text("RESET ROLE"))
        try:
            row = rls_db_session.execute(text(
                "SELECT r.edition, h.staff_note, i.status FROM collections.bib_records r "
                "JOIN collections.bib_holdings h ON h.bib_record_id = r.bib_record_id "
                "JOIN collections.bib_items i ON i.holding_id = h.holding_id WHERE r.bib_record_id = :id"
            ), {"id": str(beta.record_id)}).one()
        finally:
            rls_db_session.execute(text(f"SET ROLE {_RLS_TEST_ROLE}"))
        assert row == (None, None, "available")

    def test_cannot_link_another_orgs_authorities_location_or_object(self, rls_client, tenants):
        alpha, beta = tenants
        as_alpha = AuthenticatedClient(rls_client, alpha.token)
        b = f"{_base(alpha.org_id)}/{alpha.record_id}"
        assert as_alpha.post(f"{b}/subjects", json={"subject_authority_id": str(beta.subject_id)}).status_code == 404
        assert as_alpha.post(f"{b}/names", json={"constituent_id": str(beta.person_id)}).status_code == 404
        assert as_alpha.post(
            f"{b}/holdings/{alpha.holding_id}/items", json={"collection_object_id": str(beta.object_id)}
        ).status_code == 400

    def test_barcode_is_unique_per_org_not_globally(self, rls_client, tenants):
        """Both tenants hold SHARED-BARCODE; within one org it is still unique."""
        alpha, _ = tenants
        as_alpha = AuthenticatedClient(rls_client, alpha.token)
        url = f"{_base(alpha.org_id)}/{alpha.record_id}/holdings/{alpha.holding_id}/items"
        assert as_alpha.post(url, json={"barcode": "SHARED-BARCODE"}).status_code == 409
        r = as_alpha.post(url, json={"barcode": "ALPHA-2"})
        assert r.status_code == 201, r.text[:300]

    def test_own_org_writes_work_as_the_app_role(self, rls_client, tenants):
        alpha, _ = tenants
        as_alpha = AuthenticatedClient(rls_client, alpha.token)
        r = as_alpha.post(_base(alpha.org_id), json={"title": "New record", "record_type": "audio"})
        assert r.status_code == 201, r.text[:300]
        rid = r.get_json()["bib_record_id"]
        r = as_alpha.post(f"{_base(alpha.org_id)}/{rid}/holdings", json={"holdings_statement": "1 cassette"})
        assert r.status_code == 201, r.text[:300]
        hid = r.get_json()["holding_id"]
        r = as_alpha.post(f"{_base(alpha.org_id)}/{rid}/holdings/{hid}/items", json={"barcode": "NEW-1"})
        assert r.status_code == 201, r.text[:300]
        assert as_alpha.post(f"{_base(alpha.org_id)}/{rid}/subjects", json={"subject_authority_id": str(alpha.subject_id)}).status_code == 201
        assert as_alpha.post(f"{_base(alpha.org_id)}/{rid}/names", json={"constituent_id": str(alpha.person_id), "role": "narrator"}).status_code == 201
        assert as_alpha.get(f"{_base(alpha.org_id)}/{rid}").get_json()["item_count"] == 1
        assert as_alpha.delete(f"{_base(alpha.org_id)}/{rid}").status_code == 200
