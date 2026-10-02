"""
Cross-organization isolation, under enforced row-level security.

Madrona is multi-tenant, and the mechanism that stops one museum reading
another's records is RLS in Postgres, not a WHERE clause in a handler. Almost
none of the suite tests it. At the time this file was written:

    rls_db_session (NOBYPASSRLS)   10 test functions
    rls_client     (NOBYPASSRLS)    8 test functions
    db_session     (owner, BYPASSRLS)   2428
    client         (routed through db_session)   723

Every one of those 723 API tests runs as the table owner, which is BYPASSRLS.
So a handler that filters by primary key and forgets the organization — the
single most likely way to leak a tenant's data — passes the entire suite. The
policies are real and they are tested by `test_rls_enforcement.py` at the SQL
level, but almost nothing drives them through an HTTP request the way a
customer would.

These tests do. Two organizations, one object and one location each, and a
token belonging to the first. Every assertion is about the second
organization's data not coming back, whatever the status code.

Deliberately NOT granted here: `platform.admin`. A platform administrator is
*supposed* to read across organizations, and the ordinary `auth_setup` fixture
grants it to 2133 tests. Granting it in this file would make every assertion
below pass for entirely the wrong reason.
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

# Enough to reach the collections endpoints and nothing more. No platform.admin
# — see the module docstring.
_TENANT_PERMISSIONS = (
    "collections.view",
    "collections.create",
    "collections.edit",
    "collections.delete",
    "locations.view",
    "locations.create",
    "locations.edit",
    "media.view",
)


def _seed_tenant(session, *, name, slug, object_number, location_code):
    """One organization with an admin user, a scoped role, and two records."""
    from app.models import (
        CollectionObject,
        Location,
        Organization,
        OrganizationMembership,
        Role,
        User,
    )
    from app.services.auth_utils import generate_access_token

    org = Organization(name=name, slug=slug, is_demo=False, status="active")
    session.add(org)
    session.flush()

    role = Role(
        role_key=f"tenant-admin-{slug}",
        display_name="Tenant Admin",
        description="Collections access, scoped to one organization",
        is_system=False,
    )
    session.add(role)
    session.flush()
    for key in _TENANT_PERMISSIONS:
        _create_role_permission(session, role, _create_permission(session, key))

    user = User(
        email=f"admin@{slug}.example.com",
        password_hash="not_used_in_tests",
        status="active",
        email_verified_at=datetime.now(timezone.utc),
    )
    session.add(user)
    session.flush()

    session.add(
        OrganizationMembership(
            organization_id=org.organization_id,
            user_id=user.user_id,
            role="admin",
            role_id=role.role_id,
            status="active",
        )
    )

    obj = CollectionObject(
        organization_id=org.organization_id,
        object_number=object_number,
        object_name=f"{name} object",
    )
    session.add(obj)

    location = Location(
        organization_id=org.organization_id,
        name=f"{name} store",
        code=location_code,
        location_type="room",
        path=f"/{name} store",
        status="active",
    )
    session.add(location)
    session.flush()

    return SimpleNamespace(
        org_id=org.organization_id,
        user_id=user.user_id,
        object_id=obj.object_id,
        object_number=object_number,
        location_id=location.location_id,
        location_code=location_code,
        token=generate_access_token(
            user_id=str(user.user_id),
            email=user.email,
            active_organization_id=str(org.organization_id),
            expires_minutes=60,
        ),
    )


@pytest.fixture
def two_tenants(rls_db_session):
    """Two organizations that must never see each other.

    Seeded with the role reset to the owner, because inserting rows into two
    organizations is precisely what RLS forbids — the fixture builds the
    situation these tests then prove the application role cannot escape. This
    is the same RESET/SET pairing the `rls_client` fixture uses for its
    admin_db dependency, on the same connection.
    """
    connection = rls_db_session.connection()
    connection.execute(text("RESET ROLE"))
    try:
        alpha = _seed_tenant(
            rls_db_session,
            name="Alpha Museum",
            slug=f"alpha-{uuid4().hex[:8]}",
            object_number="ALPHA-0001",
            location_code="ALPHA-STORE",
        )
        beta = _seed_tenant(
            rls_db_session,
            name="Beta Museum",
            slug=f"beta-{uuid4().hex[:8]}",
            object_number="BETA-0001",
            location_code="BETA-STORE",
        )
        rls_db_session.commit()
    finally:
        connection.execute(text(f"SET ROLE {_RLS_TEST_ROLE}"))
    return alpha, beta


def _row_id(tenant, pk_column: str):
    """The seeded id for a table's primary key, so the parametrised cases stay
    readable instead of carrying ids through the parameter list."""
    return {"object_id": tenant.object_id, "location_id": tenant.location_id}[pk_column]


def _body(response) -> str:
    """Response text, for asserting an identifier is absent from it."""
    return response.get_data(as_text=True) if hasattr(response, "get_data") else response.text


class TestTheHarnessActuallyEnforcesRLS:
    """
    If the role wiring breaks, every test below would pass trivially — the
    owner role sees both organizations, so "no leak" assertions succeed while
    proving nothing. This asserts enforcement directly, so that failure mode
    shows up here as a clear message rather than as silent green elsewhere.
    """

    def test_the_app_role_sees_only_its_own_org_with_the_guc_set(self, rls_db_session, two_tenants):
        alpha, beta = two_tenants
        rls_db_session.execute(
            text("SELECT set_config('app.current_org_id', :org, true)"),
            {"org": str(alpha.org_id)},
        )
        visible = rls_db_session.execute(
            text("SELECT object_number FROM collections.collection_objects")
        ).scalars().all()

        assert alpha.object_number in visible, (
            "the app role cannot see its own organization's object — the grants or "
            "the policy are wrong, and the isolation tests below would be vacuous"
        )
        assert beta.object_number not in visible, (
            f"RLS is not being enforced in this harness: the app role scoped to "
            f"{alpha.org_id} can read {beta.object_number}. Every other test in "
            f"this file is meaningless until that is fixed."
        )


# The tables behind the endpoints exercised further down. Parametrising over
# them matters: a backstop test proven on one table says nothing about the
# others, and each of these is reachable by primary key from a handler that
# forgets its organization predicate.
#
# Each entry needs a row that genuinely exists in the other tenant — a query
# returning nothing because the row was never there would prove nothing at all.
_BACKSTOP_TABLES = (
    ("collections.collection_objects", "object_id", "object_number", "object_name"),
    ("collections.locations", "location_id", "code", "name"),
)


class TestRLSIsTheBackstopWhenAHandlerForgetsTheOrgFilter:
    """
    The endpoint tests below all pass even with RLS bypassed, because today's
    handlers scope their own queries by organization. That is good, and it also
    means those tests do not show that RLS protects anything — they would keep
    passing if every policy were dropped tomorrow.

    These do. They issue the query a careless handler writes — lookup by primary
    key, no organization predicate — and assert the database refuses it anyway.
    That is the guarantee RLS exists to provide, and the reason a forgotten
    `.filter(organization_id == ...)` is a bug rather than a breach.

    Parametrised over every table the endpoints below expose, because proving it
    for one table proves nothing about the rest.
    """

    @staticmethod
    def _scope_to(session, org_id):
        session.execute(
            text("SELECT set_config('app.current_org_id', :org, true)"),
            {"org": str(org_id)},
        )

    @pytest.mark.parametrize("table,pk,identifying,_writable", _BACKSTOP_TABLES)
    def test_the_other_tenants_row_exists_before_we_claim_it_is_hidden(
        self, rls_db_session, two_tenants, table, pk, identifying, _writable
    ):
        """
        Guards the guard. Every assertion below is "this query returned nothing",
        which is also what you get from a typo in a table name or a row that was
        never seeded. Confirm the row is really there, as the owner, first.
        """
        alpha, beta = two_tenants
        rls_db_session.execute(text("RESET ROLE"))
        try:
            found = rls_db_session.execute(
                text(f"SELECT {identifying} FROM {table} WHERE {pk} = :oid"),
                {"oid": str(_row_id(beta, pk))},
            ).scalar()
        finally:
            rls_db_session.execute(text(f"SET ROLE {_RLS_TEST_ROLE}"))

        assert found is not None, (
            f"{table} has no row for the second tenant, so the isolation "
            f"assertions against it are vacuous"
        )

    @pytest.mark.parametrize("table,pk,identifying,_writable", _BACKSTOP_TABLES)
    def test_a_lookup_by_primary_key_alone_cannot_cross_orgs(
        self, rls_db_session, two_tenants, table, pk, identifying, _writable
    ):
        alpha, beta = two_tenants
        self._scope_to(rls_db_session, alpha.org_id)

        leaked = rls_db_session.execute(
            text(f"SELECT {identifying} FROM {table} WHERE {pk} = :oid"),
            {"oid": str(_row_id(beta, pk))},
        ).scalar()

        assert leaked is None, (
            f"a primary-key lookup on {table} with no organization predicate "
            f"returned {leaked!r} from another tenant. RLS is the only thing "
            f"between a forgotten filter and a data breach, and it did not hold."
        )

    @pytest.mark.parametrize("table,pk,identifying,writable", _BACKSTOP_TABLES)
    def test_an_update_by_primary_key_alone_cannot_cross_orgs(
        self, rls_db_session, two_tenants, table, pk, identifying, writable
    ):
        """Reads are the obvious risk; writes are the expensive one."""
        alpha, beta = two_tenants
        self._scope_to(rls_db_session, alpha.org_id)

        result = rls_db_session.execute(
            text(f"UPDATE {table} SET {writable} = 'overwritten' WHERE {pk} = :oid"),
            {"oid": str(_row_id(beta, pk))},
        )

        assert result.rowcount == 0, (
            f"an UPDATE on {table} scoped only by primary key modified "
            f"another tenant's row"
        )

    @pytest.mark.parametrize("table,pk,identifying,_writable", _BACKSTOP_TABLES)
    def test_a_delete_by_primary_key_alone_cannot_cross_orgs(
        self, rls_db_session, two_tenants, table, pk, identifying, _writable
    ):
        alpha, beta = two_tenants
        self._scope_to(rls_db_session, alpha.org_id)

        result = rls_db_session.execute(
            text(f"DELETE FROM {table} WHERE {pk} = :oid"),
            {"oid": str(_row_id(beta, pk))},
        )

        assert result.rowcount == 0, (
            f"a DELETE on {table} scoped only by primary key removed "
            f"another tenant's row"
        )


class TestObjectsAreNotReadableAcrossOrgs:
    def test_the_list_endpoint_returns_only_the_callers_org(self, rls_client, two_tenants):
        alpha, beta = two_tenants
        as_alpha = AuthenticatedClient(rls_client, alpha.token)

        response = as_alpha.get(
            f"/api/organizations/{alpha.org_id}/collections/objects?limit=100"
        )

        assert response.status_code == 200, _body(response)[:400]
        numbers = [item.get("object_number") for item in response.get_json()["items"]]
        assert alpha.object_number in numbers
        assert beta.object_number not in numbers, (
            "the object list leaked another organization's record"
        )

    def test_detail_cannot_be_reached_by_id_under_the_callers_own_org(
        self, rls_client, two_tenants
    ):
        """
        The leak shape that matters. The caller is legitimately authenticated
        for their own organization and simply supplies someone else's object id
        — so the org check in the path passes, and only the query's own scoping
        (and RLS behind it) stands between them and the row.
        """
        alpha, beta = two_tenants
        as_alpha = AuthenticatedClient(rls_client, alpha.token)

        response = as_alpha.get(
            f"/api/organizations/{alpha.org_id}/collections/objects/{beta.object_id}"
        )

        assert response.status_code in (403, 404), (
            f"expected a refusal, got {response.status_code}: {_body(response)[:300]}"
        )
        assert beta.object_number not in _body(response)

    def test_detail_under_the_other_orgs_path_is_refused(self, rls_client, two_tenants):
        """Alpha's token, Beta's organization in the path. The authorization
        layer should stop this before RLS is even consulted — but assert on the
        data, not the layer, so the test still means something if the check
        moves."""
        alpha, beta = two_tenants
        as_alpha = AuthenticatedClient(rls_client, alpha.token)

        response = as_alpha.get(
            f"/api/organizations/{beta.org_id}/collections/objects/{beta.object_id}"
        )

        assert response.status_code in (403, 404), (
            f"expected a refusal, got {response.status_code}: {_body(response)[:300]}"
        )
        assert beta.object_number not in _body(response)

    def test_another_orgs_object_cannot_be_deleted(self, rls_client, rls_db_session, two_tenants):
        alpha, beta = two_tenants
        as_alpha = AuthenticatedClient(rls_client, alpha.token)

        response = as_alpha.delete(
            f"/api/organizations/{alpha.org_id}/collections/objects/{beta.object_id}"
        )
        assert response.status_code in (403, 404), (
            f"expected a refusal, got {response.status_code}: {_body(response)[:300]}"
        )

        # A 404 that soft-deleted the row anyway would be the worst outcome, so
        # check the row itself rather than trusting the status code.
        rls_db_session.execute(text("RESET ROLE"))
        try:
            still_there = rls_db_session.execute(
                text(
                    "SELECT is_deleted FROM collections.collection_objects "
                    "WHERE object_id = :oid"
                ),
                {"oid": str(beta.object_id)},
            ).scalar()
        finally:
            rls_db_session.execute(text(f"SET ROLE {_RLS_TEST_ROLE}"))
        assert still_there is False, "another organization's object was deleted"


class TestLocationsAreNotReadableAcrossOrgs:
    def test_the_list_endpoint_returns_only_the_callers_org(self, rls_client, two_tenants):
        alpha, beta = two_tenants
        as_alpha = AuthenticatedClient(rls_client, alpha.token)

        response = as_alpha.get(
            f"/api/organizations/{alpha.org_id}/collections/locations?limit=100"
        )

        assert response.status_code == 200, _body(response)[:400]
        codes = [item.get("code") for item in response.get_json()["items"]]
        assert alpha.location_code in codes
        assert beta.location_code not in codes, (
            "the location list leaked another organization's record"
        )


class TestEveryOrgScopedTableIsCovered:
    """
    The policies come from `seeds/seed_rls_policies.py`, and the tables they
    apply to are a hand-maintained list (`RLS_TABLES`). Nothing checks that list
    against the schema, so a new table with an `organization_id` column that
    nobody remembers to add gets no policy and no complaint — the same
    two-lists-must-agree drift that took Postgres down on a cold boot earlier in
    this release, one layer up.

    A table in that state is not a subtle problem. Every tenant's rows in it are
    readable by every other tenant the moment a handler forgets its filter, and
    the isolation tests above would not notice, because they only cover the
    tables they name.

    Exemptions are listed explicitly and each needs a reason. "It is failing and
    I want green" is not one.
    """

    # organization_id on these is not an access-scope column.
    _EXEMPT = {
        # The target of provisioning, often NULL until the saga creates the org.
        # `organization_id = current_org_id()` fails every INSERT and broke
        # /api/platform/provision when it was applied. Migration f1a2b3c4d5e6
        # disables RLS on both.
        ("public", "org_provisioning_jobs"),
        ("public", "provisioning_audit_logs"),
        # The organization row itself: scoping it to current_org_id() would make
        # an org invisible before its first request establishes context.
        ("public", "organizations"),
    }

    def test_no_org_scoped_table_is_missing_rls(self, rls_db_session):
        rows = rls_db_session.execute(
            text(
                """
                SELECT n.nspname                      AS schema,
                       c.relname                      AS table,
                       c.relrowsecurity               AS rls_enabled,
                       (SELECT count(*) FROM pg_policies p
                         WHERE p.schemaname = n.nspname
                           AND p.tablename  = c.relname) AS policies
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                JOIN pg_attribute a ON a.attrelid = c.oid
                WHERE c.relkind = 'r'
                  AND a.attname = 'organization_id'
                  AND a.attisdropped = false
                  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                ORDER BY 1, 2
                """
            )
        ).mappings().all()

        assert rows, "found no tables with an organization_id column — the query is wrong"

        unprotected = [
            f"{r['schema']}.{r['table']}"
            f" (rls_enabled={r['rls_enabled']}, policies={r['policies']})"
            for r in rows
            if (r["schema"], r["table"]) not in self._EXEMPT
            and (not r["rls_enabled"] or r["policies"] == 0)
        ]

        assert not unprotected, (
            f"{len(unprotected)} of {len(rows)} tables carry an organization_id but "
            f"have RLS disabled or no policy, so one tenant's rows are reachable "
            f"from another's session as soon as a query forgets its filter:\n  "
            + "\n  ".join(unprotected)
            + "\n\nAdd them to RLS_TABLES/RLS_POLICIES in seeds/seed_rls_policies.py, "
            "or to _EXEMPT above with a reason."
        )
