"""Guards against model/service drift on FieldAccessPolicy.

field_access_service reads attributes off FieldAccessPolicy rows. When the
service moved from `minimum_role` to `minimum_permission` (Scalable RBAC,
phases 4-5), the model was never updated to match — and because the rename
lived only in migrations that the consolidated schema later dropped off the
chain, `Base.metadata.create_all` kept emitting the old column.

The result was AttributeError inside can_view_field, surfacing as a 500 on
GET /collections/objects/{id} for every organization with seeded policies.
The whole test suite passed throughout: nothing exercised this path.

Two guards, deliberately different in kind:
  - a contract test that every attribute the service reads off a policy is
    actually mapped on the model, which catches the entire drift class
    statically; and
  - a behavioral test that the real entry point runs against real rows.
"""

import ast
from pathlib import Path

import pytest
from sqlalchemy import inspect as sa_inspect

from app.models.core_org import FieldAccessPolicy

SERVICE_PATH = (
    Path(__file__).resolve().parent.parent
    / "app" / "services" / "field_access_service.py"
)


def _attributes_read_off_policies() -> set[str]:
    """Attribute names the service reads from a variable named like a policy.

    Deliberately syntactic: it needs no database and no import of the service,
    so it still reports the drift when the service cannot even be imported.
    """
    tree = ast.parse(SERVICE_PATH.read_text())
    names = set()
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id in {"policy", "p"}
        ):
            names.add(node.attr)
    return names


def test_service_only_reads_mapped_policy_attributes():
    mapped = {a.key for a in sa_inspect(FieldAccessPolicy).attrs}
    read = _attributes_read_off_policies()
    assert read, "found no policy attribute reads — has the service moved?"

    unmapped = sorted(read - mapped)
    assert not unmapped, (
        "field_access_service reads attribute(s) that FieldAccessPolicy does "
        f"not define: {unmapped}. Either the model is behind the service (add "
        "the column and a migration) or the service is behind the model."
    )


def test_minimum_permission_is_the_mapped_name():
    """The specific regression: the permission column, under its new name."""
    mapped = {a.key for a in sa_inspect(FieldAccessPolicy).attrs}
    assert "minimum_permission" in mapped
    assert "minimum_role" not in mapped, (
        "minimum_role is gone from the service and the schema; a model still "
        "declaring it will recreate the drift on the next create_all."
    )


def test_get_restricted_fields_runs_against_real_policies(db_session, demo_tenant):
    """The path that 500'd: policy rows -> can_view_field -> attribute read."""
    from app.models.core_org import Application
    from app.services.field_access_service import get_restricted_fields

    app_row = Application(key="collections", display_name="Collections")
    db_session.add(app_row)
    db_session.flush()

    db_session.add(FieldAccessPolicy(
        application_id=app_row.application_id,
        entity_type="collection_object",
        field_path="acquisition_cost",
        policy_type="sensitive",
        display_name="Acquisition Cost",
        default_visible=False,
        minimum_permission="org.manage_settings",
    ))
    db_session.flush()

    restricted = get_restricted_fields(
        db_session,
        demo_tenant.organization_id,
        None,
        "collection_object",
        "collections",
        role_override="curator",
    )

    # default_visible=False and the curator lacks org.manage_settings, so the
    # field is withheld. The assertion that matters is that we got here at all.
    assert "acquisition_cost" in restricted


class TestRestrictedFieldsCaching:
    """get_restricted_fields is memoized on the session.

    The win is real — it was re-running a role lookup, a policy query and one
    can_view_field() query PER POLICY, for every row of every list response. The
    risk is equally real: a cache in the wrong place hands one user's field
    restrictions to the next request. These tests are mostly about the risk.
    """

    def _seed_policy(self, db_session, *, field_path="acquisition_cost"):
        from app.models.core_org import Application

        app_row = db_session.query(Application).filter_by(key="collections").one_or_none()
        if app_row is None:
            app_row = Application(key="collections", display_name="Collections")
            db_session.add(app_row)
            db_session.flush()
        db_session.add(FieldAccessPolicy(
            application_id=app_row.application_id,
            entity_type="collection_object",
            field_path=field_path,
            policy_type="sensitive",
            display_name=field_path,
            default_visible=False,
            minimum_permission="org.manage_settings",
        ))
        db_session.flush()
        return app_row

    def test_second_call_issues_no_further_queries(self, db_session, demo_tenant):
        from sqlalchemy import event
        from app.services.field_access_service import get_restricted_fields

        self._seed_policy(db_session)
        args = (db_session, demo_tenant.organization_id, None, "collection_object", "collections")

        first = get_restricted_fields(*args, role_override="curator")

        counter = {"n": 0}

        def _count(conn, cursor, statement, params, context, executemany):
            counter["n"] += 1

        event.listen(db_session.get_bind(), "before_cursor_execute", _count)
        try:
            second = get_restricted_fields(*args, role_override="curator")
        finally:
            event.remove(db_session.get_bind(), "before_cursor_execute", _count)

        assert second == first
        assert counter["n"] == 0, (
            f"the cached call still issued {counter['n']} queries — this is the N+1 "
            "that made a 50-row page cost thousands of statements"
        )

    def test_cache_does_not_leak_between_users(self, db_session, demo_tenant):
        """The failure mode that would matter: user B seeing user A's answer."""
        import uuid
        from app.services.field_access_service import get_restricted_fields

        self._seed_policy(db_session)
        org = demo_tenant.organization_id
        user_a, user_b = uuid.uuid4(), uuid.uuid4()

        a = get_restricted_fields(db_session, org, user_a, "collection_object",
                                  "collections", role_override="curator")
        b = get_restricted_fields(db_session, org, user_b, "collection_object",
                                  "collections", role_override="admin")

        # curator is withheld the field; admin short-circuits and sees everything
        assert "acquisition_cost" in a
        assert b == set(), "an admin got the curator's cached restrictions"

    def test_cache_is_keyed_on_entity_type_and_role_override(self, db_session, demo_tenant):
        from app.services.field_access_service import get_restricted_fields

        self._seed_policy(db_session)
        org = demo_tenant.organization_id

        curator = get_restricted_fields(db_session, org, None, "collection_object",
                                        "collections", role_override="curator")
        other_entity = get_restricted_fields(db_session, org, None, "media",
                                             "collections", role_override="curator")
        admin = get_restricted_fields(db_session, org, None, "collection_object",
                                      "collections", role_override="admin")

        assert "acquisition_cost" in curator
        assert other_entity == set(), "a different entity_type reused the cached answer"
        assert admin == set(), "a different role_override reused the cached answer"

    def test_mutating_the_result_cannot_poison_the_cache(self, db_session, demo_tenant):
        from app.services.field_access_service import get_restricted_fields

        self._seed_policy(db_session)
        args = (db_session, demo_tenant.organization_id, None, "collection_object", "collections")

        first = get_restricted_fields(*args, role_override="curator")
        first.add("something_a_caller_invented")
        second = get_restricted_fields(*args, role_override="curator")

        assert "something_a_caller_invented" not in second
