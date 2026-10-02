"""
Rights enforcement, end to end through the download route.

The org toggle media_rights_enforcement is the mechanism that makes the
download-request workflow mean something: with it off, the only thing that
can force a request is the role check, so only viewers ever see one and the
approval queue looks vestigial. With it on, access is decided per asset from
its rights records, which is the DAM convention — a registrar is entitled to
unrestricted images because of their role, and files a request like anyone
else for the rest.

These exercise the real endpoint rather than compute_download_access in
isolation, because the interesting part is whether the toggle, the rights
lookup, the role gate and the response envelope actually line up.
"""

from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

import pytest

from app.models.media import Media, MediaRights


def _media(db_session, org_id) -> Media:
    m = Media(
        organization_id=org_id,
        s3_key=f"orgs/{org_id}/media/re/{uuid4().hex}.jpg",
        filename="asset.jpg",
        file_size=4096,
        mime_type="image/jpeg",
        media_type="image",
        # Published: under enforcement an unpublished asset needs
        # media.view_unpublished, which would mask the rights decision
        # these tests are here to exercise.
        is_published=True,
    )
    db_session.add(m)
    db_session.commit()
    return m


def _rights(db_session, media, org_id, **kw) -> MediaRights:
    r = MediaRights(
        media_id=media.media_id,
        organization_id=org_id,
        rights_type=kw.pop("rights_type", "copyright"),
        is_active=True,
        **kw,
    )
    db_session.add(r)
    db_session.commit()
    return r


def _enforce(db_session, org, on: bool = True):
    org.media_rights_enforcement = on
    db_session.commit()


def _download(client, org, media):
    return client.get(
        f"/api/organizations/{org.organization_id}/media/{media.media_id}/download"
    )


@pytest.fixture
def registrar_setup(client, db_session):
    """
    A registrar-shaped user: can view and download originals, and is NOT a
    platform admin.

    The stock auth_setup fixture grants platform.admin, which short-circuits
    both the role gate and compute_download_access — every asset comes back
    "direct" and the rights matrix is never exercised. Testing rights needs
    a user the rules actually apply to.
    """
    from types import SimpleNamespace

    from app.models import Organization, OrganizationMembership, Role, User
    from app.services.auth_utils import generate_access_token
    from tests.conftest import (
        AuthenticatedClient, _create_permission, _create_role_permission,
    )

    org = Organization(name="Rights Test Org", slug=f"rights-{uuid4().hex[:8]}",
                       is_demo=False, status="active")
    db_session.add(org)
    db_session.flush()

    role = Role(role_key="registrar", display_name="Registrar",
                description="Collections records", is_system=True)
    db_session.add(role)
    db_session.flush()

    for key in ("media.view", "media.download_original",
                "media.download_derivatives", "download_requests.create",
                "collections.view"):
        _create_role_permission(db_session, role, _create_permission(db_session, key))

    user = User(email=f"registrar-{uuid4().hex[:8]}@example.com",
                password_hash="not_used_in_tests", status="active")
    db_session.add(user)
    db_session.flush()

    db_session.add(OrganizationMembership(
        organization_id=org.organization_id, user_id=user.user_id,
        role="member", role_id=role.role_id, status="active",
    ))
    db_session.commit()

    token = generate_access_token(
        user_id=str(user.user_id), email=user.email,
        active_organization_id=str(org.organization_id), expires_minutes=60,
    )
    return (AuthenticatedClient(client, token),
            SimpleNamespace(organization_id=org.organization_id, _row=org),
            user)


@pytest.fixture
def enforcing_org(registrar_setup, db_session):
    client, org, user = registrar_setup
    _enforce(db_session, org._row, True)
    return client, org, user


class TestRightsDecideAccess:
    def test_no_rights_records_requires_a_request(self, enforcing_org, db_session):
        """
        The conservative default. Also the flood risk: switch enforcement on
        before rights data exists and every asset lands here.
        """
        client, org, _ = enforcing_org
        media = _media(db_session, org.organization_id)

        resp = _download(client, org, media)
        assert resp.status_code == 403, resp.get_json()
        assert resp.get_json()["error"]["code"] == "download_request_required"

    def test_expired_rights_are_blocked_outright(self, enforcing_org, db_session):
        client, org, _ = enforcing_org
        media = _media(db_session, org.organization_id)
        _rights(db_session, media, org.organization_id,
                end_date=date.today() - timedelta(days=1))

        resp = _download(client, org, media)
        assert resp.status_code == 403, resp.get_json()
        assert resp.get_json()["error"]["code"] == "download_blocked"

    def test_usage_restrictions_require_a_request(self, enforcing_org, db_session):
        client, org, _ = enforcing_org
        media = _media(db_session, org.organization_id)
        _rights(db_session, media, org.organization_id,
                usage_restrictions=["no_commercial_use"])

        resp = _download(client, org, media)
        assert resp.status_code == 403, resp.get_json()
        assert resp.get_json()["error"]["code"] == "download_request_required"

    @pytest.mark.parametrize("field,value", [
        ("rights_status", "public_domain"),
        ("rights_status", "cc0"),
        ("license_type", "CC-BY"),
    ])
    def test_open_access_downloads_directly(self, enforcing_org, db_session, field, value):
        client, org, _ = enforcing_org
        media = _media(db_session, org.organization_id)
        _rights(db_session, media, org.organization_id, **{field: value})

        resp = _download(client, org, media)
        assert resp.status_code == 200, resp.get_json()
        assert resp.get_json()["download_url"].startswith("http")

    def test_in_copyright_without_a_grant_requires_a_request(self, enforcing_org, db_session):
        """Rights exist but grant nothing — not open access, so not direct."""
        client, org, _ = enforcing_org
        media = _media(db_session, org.organization_id)
        _rights(db_session, media, org.organization_id,
                rights_status="in_copyright", license_type="ARR")

        resp = _download(client, org, media)
        assert resp.status_code == 403, resp.get_json()
        assert resp.get_json()["error"]["code"] == "download_request_required"


class TestToggleIsWhatSwitchesThisOn:
    def test_same_asset_downloads_freely_with_enforcement_off(self, registrar_setup, db_session):
        """
        The whole point of the toggle: identical asset and rights, opposite
        outcome. Off, an asset with no rights records downloads directly.
        """
        client, org, _ = registrar_setup
        _enforce(db_session, org._row, False)
        media = _media(db_session, org.organization_id)

        resp = _download(client, org, media)
        assert resp.status_code == 200, resp.get_json()

        _enforce(db_session, org._row, True)
        assert _download(client, org, media).status_code == 403


class TestPayloadAgreesWithTheEndpoint:
    def test_download_access_field_matches_the_decision(self, enforcing_org, db_session):
        """
        The UI picks its button from download_access. If that disagrees with
        the endpoint the user gets a Download button that 403s, which is the
        failure this whole area keeps producing.
        """
        client, org, _ = enforcing_org
        media = _media(db_session, org.organization_id)
        _rights(db_session, media, org.organization_id,
                end_date=date.today() - timedelta(days=1))

        detail = client.get(
            f"/api/organizations/{org.organization_id}/media/{media.media_id}"
        )
        assert detail.status_code == 200, detail.get_json()
        assert detail.get_json().get("download_access") == "blocked"
        assert _download(client, org, media).status_code == 403
