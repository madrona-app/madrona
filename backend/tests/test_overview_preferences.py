"""
Tests for overview preferences API endpoints.

Tests GET/PUT /api/me/overview-preferences which use refresh_token cookie
authentication (not Bearer token) for browser-based access.

Uses db_session and client fixtures from conftest.py.
"""

import json
from datetime import datetime, timedelta, timezone

import pytest

from app.services.auth_utils import generate_refresh_token, hash_refresh_token
from app.models import (
    User,
    Organization,
    Dataset,
    RefreshToken,
    UserOverviewPreference,
    OrganizationMembership,
    Role,
)


def make_datetime(days_offset=0):
    return datetime.now(timezone.utc) + timedelta(days=days_offset)


@pytest.fixture
def prefs_setup(db_session):
    """Set up user, org, datasets, and refresh token for preferences tests.

    Returns dict with user, org, ds1, ds2, token_plain.
    """
    org = Organization(
        name="Prefs Test Org",
        slug="prefs-test-org",
        status="active",
    )
    db_session.add(org)
    db_session.flush()

    user = User(
        email="prefs-tester@example.com",
        password_hash="testhash",
        status="active",
    )
    db_session.add(user)
    db_session.flush()

    # Create a role and membership so RLS context works
    role = Role(
        role_key="prefs_admin",
        display_name="Prefs Admin",
        description="Admin for prefs tests",
    )
    db_session.add(role)
    db_session.flush()

    membership = OrganizationMembership(
        user_id=user.user_id,
        organization_id=org.organization_id,
        role_id=role.role_id,
        role="admin",
        status="active",
    )
    db_session.add(membership)
    db_session.flush()

    # Create datasets
    ds1 = Dataset(
        organization_id=org.organization_id,
        name="DS1",
        key="ds1-prefs",
    )
    ds2 = Dataset(
        organization_id=org.organization_id,
        name="DS2",
        key="ds2-prefs",
    )
    db_session.add_all([ds1, ds2])
    db_session.flush()

    # Create refresh token
    token_plain = generate_refresh_token()
    token_hash = hash_refresh_token(token_plain)
    rt = RefreshToken(
        user_id=user.user_id,
        token_hash=token_hash,
        active_organization_id=org.organization_id,
        expires_at=make_datetime(days_offset=1),
    )
    db_session.add(rt)
    db_session.commit()

    return {
        "user": user,
        "org": org,
        "ds1": ds1,
        "ds2": ds2,
        "token_plain": token_plain,
    }


class TestOverviewPreferences:
    """Tests for GET/PUT /api/me/overview-preferences."""

    def test_get_preferences_with_existing_pref(self, client, db_session, prefs_setup):
        """Test GET returns saved preferences when they exist."""
        setup = prefs_setup

        # Create an existing preference
        pref = UserOverviewPreference(
            user_id=setup["user"].user_id,
            organization_id=setup["org"].organization_id,
            visible_dataset_ids=[
                str(setup["ds1"].dataset_id),
                str(setup["ds2"].dataset_id),
            ],
            dataset_order=[
                str(setup["ds2"].dataset_id),
                str(setup["ds1"].dataset_id),
            ],
        )
        db_session.add(pref)
        db_session.commit()

        # Set refresh_token cookie
        client.set_cookie("refresh_token", setup["token_plain"])

        resp = client.get("/api/me/overview-preferences")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "visible_dataset_ids" in data
        assert data["dataset_order"] == [
            str(setup["ds2"].dataset_id),
            str(setup["ds1"].dataset_id),
        ]

    def test_get_preferences_returns_defaults_when_none(
        self, client, db_session, prefs_setup
    ):
        """Test GET returns computed defaults when no saved preferences exist."""
        setup = prefs_setup

        # Set refresh_token cookie
        client.set_cookie("refresh_token", setup["token_plain"])

        resp = client.get("/api/me/overview-preferences")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "visible_dataset_ids" in data

    def test_put_preferences(self, client, db_session, prefs_setup):
        """Test PUT saves preferences and returns updated values."""
        setup = prefs_setup

        # Set refresh_token cookie
        client.set_cookie("refresh_token", setup["token_plain"])

        new_order = [str(setup["ds1"].dataset_id), str(setup["ds2"].dataset_id)]
        put_resp = client.put(
            "/api/me/overview-preferences",
            data=json.dumps(
                {
                    "visible_dataset_ids": [
                        str(setup["ds1"].dataset_id),
                        str(setup["ds2"].dataset_id),
                    ],
                    "dataset_order": new_order,
                }
            ),
            content_type="application/json",
        )
        assert put_resp.status_code == 200
        updated = put_resp.get_json()
        assert updated["dataset_order"] == new_order

        # Verify DB updated
        pref_db = (
            db_session.query(UserOverviewPreference)
            .filter_by(
                user_id=setup["user"].user_id,
                organization_id=setup["org"].organization_id,
            )
            .first()
        )
        assert pref_db is not None
        assert pref_db.dataset_order == new_order

    def test_get_and_put_roundtrip(self, client, db_session, prefs_setup):
        """Test full GET-PUT-GET roundtrip for overview preferences."""
        setup = prefs_setup

        # Create initial preference
        pref = UserOverviewPreference(
            user_id=setup["user"].user_id,
            organization_id=setup["org"].organization_id,
            visible_dataset_ids=[
                str(setup["ds1"].dataset_id),
                str(setup["ds2"].dataset_id),
            ],
            dataset_order=[
                str(setup["ds2"].dataset_id),
                str(setup["ds1"].dataset_id),
            ],
        )
        db_session.add(pref)
        db_session.commit()

        client.set_cookie("refresh_token", setup["token_plain"])

        # GET original
        resp = client.get("/api/me/overview-preferences")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["dataset_order"] == [
            str(setup["ds2"].dataset_id),
            str(setup["ds1"].dataset_id),
        ]

        # PUT swap order
        new_order = [str(setup["ds1"].dataset_id), str(setup["ds2"].dataset_id)]
        put_resp = client.put(
            "/api/me/overview-preferences",
            data=json.dumps(
                {
                    "visible_dataset_ids": [
                        str(setup["ds1"].dataset_id),
                        str(setup["ds2"].dataset_id),
                    ],
                    "dataset_order": new_order,
                }
            ),
            content_type="application/json",
        )
        assert put_resp.status_code == 200
        updated = put_resp.get_json()
        assert updated["dataset_order"] == new_order

        # GET updated
        resp2 = client.get("/api/me/overview-preferences")
        assert resp2.status_code == 200
        data2 = resp2.get_json()
        assert data2["dataset_order"] == new_order

    def test_put_filters_stale_dataset_ids(self, client, db_session, prefs_setup):
        """A saved ID whose dataset no longer exists must not poison the save.

        The PUT filters unknown/foreign IDs and stores the survivors, rather
        than rejecting the whole payload with a 400.
        """
        import uuid as uuid_mod

        setup = prefs_setup
        client.set_cookie("refresh_token", setup["token_plain"])

        stale_id = str(uuid_mod.uuid4())  # never existed / deleted / other org
        put_resp = client.put(
            "/api/me/overview-preferences",
            data=json.dumps(
                {
                    "visible_dataset_ids": [str(setup["ds1"].dataset_id), stale_id],
                    "dataset_order": [stale_id, str(setup["ds1"].dataset_id)],
                }
            ),
            content_type="application/json",
        )
        assert put_resp.status_code == 200
        updated = put_resp.get_json()
        assert updated["visible_dataset_ids"] == [str(setup["ds1"].dataset_id)]
        assert updated["dataset_order"] == [str(setup["ds1"].dataset_id)]

        # The stored row is healed, not poisoned
        pref_db = (
            db_session.query(UserOverviewPreference)
            .filter_by(
                user_id=setup["user"].user_id,
                organization_id=setup["org"].organization_id,
            )
            .first()
        )
        assert pref_db is not None
        assert stale_id not in pref_db.visible_dataset_ids
        assert stale_id not in (pref_db.dataset_order or [])

    def test_put_rejects_malformed_ids(self, client, db_session, prefs_setup):
        """Malformed UUIDs are still a 400 — filtering applies only to valid IDs."""
        setup = prefs_setup
        client.set_cookie("refresh_token", setup["token_plain"])

        put_resp = client.put(
            "/api/me/overview-preferences",
            data=json.dumps({"visible_dataset_ids": ["not-a-uuid"], "dataset_order": []}),
            content_type="application/json",
        )
        assert put_resp.status_code == 400

    def test_requires_auth_cookie(self, client, db_session):
        """Test that endpoints require refresh_token cookie."""
        resp = client.get("/api/me/overview-preferences")
        assert resp.status_code == 401

        resp = client.put(
            "/api/me/overview-preferences",
            data=json.dumps({"visible_dataset_ids": [], "dataset_order": []}),
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_expired_token_returns_401(self, client, db_session, prefs_setup):
        """Test that an expired refresh token returns 401."""
        setup = prefs_setup

        # Create an expired refresh token
        expired_token_plain = generate_refresh_token()
        expired_token_hash = hash_refresh_token(expired_token_plain)
        expired_rt = RefreshToken(
            user_id=setup["user"].user_id,
            token_hash=expired_token_hash,
            active_organization_id=setup["org"].organization_id,
            expires_at=make_datetime(days_offset=-1),  # Expired yesterday
        )
        db_session.add(expired_rt)
        db_session.commit()

        client.set_cookie("refresh_token", expired_token_plain)

        resp = client.get("/api/me/overview-preferences")
        assert resp.status_code == 401
