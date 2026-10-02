"""Tests for the per-user Guide preference layer.

Covers the service-layer resolution/rendering + cache behavior (the
regression-prone logic, runs everywhere) and a policy-shape assertion that the
RLS guarantee stays user-private (not org-visible). Functional cross-user
isolation is additionally exercised end-to-end by the strict-RLS suite via the
madrona_app role.
"""

from uuid import uuid4

import pytest
from sqlalchemy import text

from app.models import Organization
from app.models.core_users import User, GuideUserPreference
from app.services import prompt_service as ps


@pytest.fixture
def org(db_session):
    o = Organization(name="Pref Museum", slug=f"pref-{uuid4().hex[:8]}")
    db_session.add(o)
    db_session.commit()
    return o


@pytest.fixture
def user(db_session):
    u = User(email=f"pref-{uuid4().hex[:8]}@example.com", display_name="Pref User")
    db_session.add(u)
    db_session.commit()
    return u


def _set_pref(db, user, org, **kw):
    row = GuideUserPreference(
        user_id=user.user_id, organization_id=org.organization_id, **kw
    )
    db.add(row)
    db.commit()
    ps.invalidate_user_preferences(user.user_id, org.organization_id)
    return row


class TestResolution:
    def test_no_row_resolves_to_empty(self, db_session, user, org):
        ps.invalidate_user_preferences(user.user_id, org.organization_id)
        assert ps.get_user_preferences(db_session, user.user_id, org.organization_id) == ""

    def test_instructions_and_terse_render(self, db_session, user, org):
        _set_pref(db_session, user, org, instructions="Always cite procedures.", verbosity="terse")
        out = ps.get_user_preferences(db_session, user.user_id, org.organization_id)
        assert "Always cite procedures." in out
        assert "short" in out.lower()

    def test_detailed_only_renders_guidance(self, db_session, user, org):
        _set_pref(db_session, user, org, verbosity="detailed")
        out = ps.get_user_preferences(db_session, user.user_id, org.organization_id)
        assert out.strip() != ""
        assert "thorough" in out.lower()

    def test_normal_verbosity_and_empty_instructions_is_noop(self, db_session, user, org):
        _set_pref(db_session, user, org, verbosity="normal", instructions="")
        assert ps.get_user_preferences(db_session, user.user_id, org.organization_id) == ""

    def test_cache_holds_until_invalidated(self, db_session, user, org):
        row = _set_pref(db_session, user, org, instructions="first")
        assert "first" in ps.get_user_preferences(db_session, user.user_id, org.organization_id)
        # Mutate without invalidating — the cached block should still be returned.
        row.instructions = "second"
        db_session.commit()
        assert "first" in ps.get_user_preferences(db_session, user.user_id, org.organization_id)
        # After invalidation the new value is picked up.
        ps.invalidate_user_preferences(user.user_id, org.organization_id)
        assert "second" in ps.get_user_preferences(db_session, user.user_id, org.organization_id)

    def test_preferences_are_scoped_per_user(self, db_session, org):
        a = User(email=f"a-{uuid4().hex[:8]}@example.com")
        b = User(email=f"b-{uuid4().hex[:8]}@example.com")
        db_session.add_all([a, b])
        db_session.commit()
        db_session.add(GuideUserPreference(
            user_id=a.user_id, organization_id=org.organization_id, instructions="A-only",
        ))
        db_session.commit()
        ps.invalidate_user_preferences(a.user_id, org.organization_id)
        ps.invalidate_user_preferences(b.user_id, org.organization_id)
        assert "A-only" in ps.get_user_preferences(db_session, a.user_id, org.organization_id)
        assert ps.get_user_preferences(db_session, b.user_id, org.organization_id) == ""


class TestPolicyShape:
    """Lock the privacy guarantee at the policy definition level: the row is
    keyed on the user, not just the org — so a future edit can't silently make
    one user's preferences visible to the whole org.
    """

    def test_rls_policy_is_user_private(self, db_session):
        rows = db_session.execute(text(
            "SELECT policyname, qual, with_check FROM pg_policies "
            "WHERE tablename = 'guide_user_prefs'"
        )).fetchall()
        assert rows, "expected an RLS policy on guide_user_prefs"
        quals = " ".join((r[1] or "") for r in rows)
        assert "current_user_id()" in quals, "read policy must be keyed on current_user_id()"
        checks = " ".join((r[2] or "") for r in rows)
        assert "current_user_id()" in checks, "write policy must be keyed on current_user_id()"
