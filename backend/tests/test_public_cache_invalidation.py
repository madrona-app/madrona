"""Regression tests for public-cache invalidation.

invalidate_org_cache_by_id is called by admin save handlers right after
db.commit(), which clears the SET LOCAL RLS context. The pre-fix
implementation looked the slug up on the request session (app role) — with
no context the organizations row is invisible, the lookup returned None,
and the public cache silently kept serving stale data for the full TTL.
That surfaced as "discover config has no impact".

The fix resolves the slug on the BYPASSRLS owner session. These tests pin
that behavior under real enforced RLS.
"""

from contextlib import contextmanager
from uuid import uuid4

import pytest
from sqlalchemy import text


@pytest.mark.postgres
def test_invalidate_by_id_resolves_slug_after_rls_context_cleared(
    rls_db_session, monkeypatch
):
    from app.models import Organization
    from app.services import public_cache

    org_id = uuid4()
    slug = f"cache-inv-{uuid4().hex[:8]}"

    rls_db_session.execute(
        text("SELECT set_config('app.current_org_id', :v, true)"), {"v": str(org_id)}
    )
    rls_db_session.add(Organization(
        organization_id=org_id,
        name="Cache Invalidation Test",
        slug=slug,
        status="active",
    ))
    rls_db_session.commit()

    # Reproduce the post-commit production state: RLS context cleared.
    rls_db_session.execute(text("SELECT set_config('app.current_org_id', '', true)"))
    rls_db_session.execute(text("SELECT set_config('app.current_user_id', '', true)"))

    # Sanity: this is the pre-fix failure mode — the app-role session can no
    # longer see the org, so a current_session()-based lookup returns None.
    assert (
        rls_db_session.query(Organization)
        .filter_by(organization_id=org_id)
        .first()
        is None
    ), "expected the org to be invisible without RLS context; harness changed?"

    # Owner-session stand-in on the same connection: RESET ROLE (test
    # superuser = BYPASSRLS), restore the app role afterwards. Mirrors the
    # conftest admin-dep override.
    connection = rls_db_session.connection()

    @contextmanager
    def _owner_session():
        connection.execute(text("RESET ROLE"))
        try:
            yield rls_db_session
        finally:
            connection.execute(text("SET ROLE madrona_app"))

    monkeypatch.setattr("app.tasks.rls_helpers.admin_db_session", _owner_session)
    monkeypatch.setattr(
        "app.services.cdn_purge.purge_cdn_for_org", lambda org_id: None, raising=False
    )

    captured = {}

    def _fake_invalidate(org_slug, section=None):
        captured["slug"] = org_slug
        captured["section"] = section
        return 3

    monkeypatch.setattr(public_cache, "invalidate_org_cache", _fake_invalidate)

    deleted = public_cache.invalidate_org_cache_by_id(str(org_id), section="info")

    assert captured.get("slug") == slug, (
        "slug lookup failed under cleared RLS context — cache invalidation "
        "is RLS-blind again (pre-fix behavior), public pages will serve "
        "stale data after every admin save"
    )
    assert captured.get("section") == "info"
    assert deleted == 3
