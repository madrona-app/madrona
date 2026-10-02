"""
Overview preferences under enforced RLS.

Neither endpoint set RLS scope. get_db does not do it — call sites do, and
these two did not — so current_org_id() was NULL for the whole request.

The two verbs failed differently, and only one of them was loud:

  PUT  failed the policy's WITH CHECK and returned 500.
  GET  matched no rows and reported, cheerfully and with a 200, that the
       organization has no datasets at all.

The silent one is the reason this needs a test rather than an error alert.
6,852 backend tests passed with the bug present, because the ordinary
fixtures connect as the owner role, which bypasses RLS entirely. Only
`rls_client` reproduces production role behavior.

Pre-fix verification: remove the set_rls_context_for_session calls from
get_overview_preferences / set_overview_preferences in routers/auth.py and
both tests below fail — the GET on an empty dataset list, the PUT on a 500.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text as _sa_text

from app.models import Dataset, Organization, OrganizationMembership, RefreshToken, Role, User
from app.services.auth_utils import generate_refresh_token, hash_refresh_token


@pytest.fixture
def org_with_datasets(rls_db_session):
    """An organization with a member, a session cookie, and three datasets."""
    org_id = uuid.uuid4()
    rls_db_session.execute(
        _sa_text("SELECT set_config('app.current_org_id', :v, true)"), {"v": str(org_id)}
    )

    user = User(
        email=f"overview-rls-{uuid.uuid4().hex[:6]}@example.com",
        password_hash="dummy",
        status="active",
    )
    rls_db_session.add(user)
    rls_db_session.add(Organization(
        organization_id=org_id,
        name="Overview RLS Org",
        slug=f"overview-rls-{uuid.uuid4().hex[:8]}",
        status="active",
    ))
    role = Role(
        role_key=f"admin-{uuid.uuid4().hex[:6]}",
        display_name="Admin", is_system=False, organization_id=org_id,
    )
    rls_db_session.add(role)
    rls_db_session.flush()
    rls_db_session.add(OrganizationMembership(
        organization_id=org_id, user_id=user.user_id,
        role="admin", role_id=role.role_id, status="active",
    ))

    dataset_ids = []
    for n in range(3):
        d = Dataset(
            organization_id=org_id,
            name=f"Dataset {n}",
            key=f"dataset-{n}-{uuid.uuid4().hex[:6]}",
            source_type="manual",
        )
        rls_db_session.add(d)
        rls_db_session.flush()
        dataset_ids.append(str(d.dataset_id))

    raw_token = generate_refresh_token()
    rls_db_session.add(RefreshToken(
        user_id=user.user_id,
        token_hash=hash_refresh_token(raw_token),
        active_organization_id=org_id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    ))
    rls_db_session.commit()

    # Critical: clear the scope used for seeding. rls_client shares this
    # connection, so a lingering app.current_org_id would hand the endpoint
    # the very context it is supposed to establish for itself — and these
    # tests would pass with the fix removed.
    rls_db_session.execute(_sa_text("SELECT set_config('app.current_org_id', '', false)"))
    rls_db_session.execute(_sa_text("SELECT set_config('app.current_user_id', '', false)"))

    return {"org_id": org_id, "token": raw_token, "dataset_ids": dataset_ids}


class TestOverviewPreferencesUnderStrictRLS:
    def test_get_sees_the_organizations_datasets(self, rls_client, org_with_datasets):
        """
        The silent failure. Without RLS scope every org-scoped SELECT matches
        nothing, so this returned 200 with an empty list — indistinguishable
        from an organization that genuinely has no datasets.
        """
        rls_client.set_cookie("refresh_token", org_with_datasets["token"])

        resp = rls_client.get("/api/me/overview-preferences")
        assert resp.status_code == 200, resp.get_json()

        body = resp.get_json()
        assert len(body["dataset_order"]) == 3, (
            "the organization has three datasets; an empty list means the "
            "request ran with no RLS scope"
        )
        assert set(body["visible_dataset_ids"]) <= set(org_with_datasets["dataset_ids"])

    def test_put_persists_instead_of_violating_the_policy(self, rls_client, org_with_datasets):
        """The loud failure: INSERT failed the policy's WITH CHECK."""
        rls_client.set_cookie("refresh_token", org_with_datasets["token"])
        chosen = org_with_datasets["dataset_ids"][:2]

        resp = rls_client.put(
            "/api/me/overview-preferences",
            json={"visible_dataset_ids": chosen, "dataset_order": chosen},
        )
        assert resp.status_code == 200, resp.get_json()
        assert resp.get_json()["visible_dataset_ids"] == chosen

    def test_the_saved_preference_survives_a_round_trip(self, rls_client, org_with_datasets):
        """A write the next read cannot see is the same bug wearing a hat."""
        rls_client.set_cookie("refresh_token", org_with_datasets["token"])
        chosen = org_with_datasets["dataset_ids"][:1]

        rls_client.put(
            "/api/me/overview-preferences",
            json={"visible_dataset_ids": chosen, "dataset_order": chosen},
        )
        body = rls_client.get("/api/me/overview-preferences").get_json()
        assert body["visible_dataset_ids"] == chosen

    def test_a_second_save_updates_rather_than_duplicating(self, rls_client, org_with_datasets):
        rls_client.set_cookie("refresh_token", org_with_datasets["token"])
        ids = org_with_datasets["dataset_ids"]

        rls_client.put("/api/me/overview-preferences",
                       json={"visible_dataset_ids": ids[:1], "dataset_order": ids[:1]})
        resp = rls_client.put("/api/me/overview-preferences",
                              json={"visible_dataset_ids": ids[:3], "dataset_order": ids[:3]})
        assert resp.status_code == 200, resp.get_json()
        assert len(resp.get_json()["visible_dataset_ids"]) == 3
