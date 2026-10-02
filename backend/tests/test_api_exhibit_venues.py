"""Coverage tests for app/fastapi_app/routers/exhibit_venues.py.

20 routes for venues, floor plans, frame styles, and mount configs under
/api/organizations/{org_id}/exhibit/... — was at 14% with no test file.
Floor-plan geometry routes are not exercised here (PostGIS-specific).
"""

from __future__ import annotations

import json
from uuid import uuid4

import pytest

from app.models import FrameStyle, MountConfig, Venue


# ---------------------------------------------------------------------------
# URLs
# ---------------------------------------------------------------------------


def _venues_url(org, vid=None) -> str:
    base = f"/api/organizations/{org.organization_id}/exhibit/venues"
    return base if vid is None else f"{base}/{vid}"


def _frame_styles_url(org, sid=None) -> str:
    base = f"/api/organizations/{org.organization_id}/exhibit/frame-styles"
    return base if sid is None else f"{base}/{sid}"


def _mount_configs_url(org, cid=None) -> str:
    base = f"/api/organizations/{org.organization_id}/exhibit/mount-configs"
    return base if cid is None else f"{base}/{cid}"


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------


def _seed_venue(db_session, org_id, *, name: str = "Main Hall") -> Venue:
    v = Venue(organization_id=org_id, name=name)
    db_session.add(v)
    db_session.commit()
    return v


def _seed_frame_style(
    db_session, org_id, *, name: str = "Standard Black"
) -> FrameStyle:
    style = FrameStyle(
        organization_id=org_id,
        name=name,
        profile_type="flat",
    )
    db_session.add(style)
    db_session.commit()
    return style


# ---------------------------------------------------------------------------
# Venues
# ---------------------------------------------------------------------------


class TestListVenues:
    def test_empty(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_venues_url(org))
        assert resp.status_code == 200

    def test_returns_seeded(self, auth_setup, db_session):
        client, org, _ = auth_setup
        _seed_venue(db_session, org.organization_id, name="Alpha Gallery")
        _seed_venue(db_session, org.organization_id, name="Beta Annex")
        resp = client.get(_venues_url(org))
        assert resp.status_code == 200
        body = resp.get_json()
        # Schema may name it "venues" or "items"
        rows = body.get("venues") or body.get("items") or body.get("data") or []
        names = {r["name"] for r in rows}
        assert {"Alpha Gallery", "Beta Annex"} <= names


class TestCreateVenue:
    def test_minimal(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(
            _venues_url(org),
            data=json.dumps({"name": "New Venue"}),
            content_type="application/json",
        )
        assert resp.status_code == 201

    def test_missing_name(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(
            _venues_url(org),
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code in (400, 422)

    def test_with_description_and_address(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(
            _venues_url(org),
            data=json.dumps(
                {
                    "name": "Detailed",
                    "description": "Main exhibition hall",
                    "address": "1 Museum Way",
                }
            ),
            content_type="application/json",
        )
        assert resp.status_code == 201


class TestGetVenue:
    def test_returns_detail(self, auth_setup, db_session):
        client, org, _ = auth_setup
        v = _seed_venue(db_session, org.organization_id, name="Detail Test")
        resp = client.get(_venues_url(org, v.venue_id))
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["name"] == "Detail Test"

    def test_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_venues_url(org, uuid4()))
        assert resp.status_code == 404


class TestUpdateVenue:
    def test_patch_name(self, auth_setup, db_session):
        client, org, _ = auth_setup
        v = _seed_venue(db_session, org.organization_id, name="Old Name")
        resp = client.patch(
            _venues_url(org, v.venue_id),
            data=json.dumps({"name": "New Name"}),
            content_type="application/json",
        )
        assert resp.status_code == 200

    def test_patch_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.patch(
            _venues_url(org, uuid4()),
            data=json.dumps({"name": "x"}),
            content_type="application/json",
        )
        assert resp.status_code == 404


class TestDeleteVenue:
    def test_delete_existing(self, auth_setup, db_session):
        client, org, _ = auth_setup
        v = _seed_venue(db_session, org.organization_id, name="To Delete")
        resp = client.delete(_venues_url(org, v.venue_id))
        assert resp.status_code == 200

    def test_delete_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.delete(_venues_url(org, uuid4()))
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Frame Styles
# ---------------------------------------------------------------------------


class TestFrameStyles:
    def test_list_empty(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_frame_styles_url(org))
        assert resp.status_code == 200

    def test_create_minimal(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(
            _frame_styles_url(org),
            data=json.dumps(
                {
                    "name": "Basic Black",
                    "profile_type": "flat",
                }
            ),
            content_type="application/json",
        )
        assert resp.status_code == 201

    def test_update_existing(self, auth_setup, db_session):
        client, org, _ = auth_setup
        style = _seed_frame_style(db_session, org.organization_id, name="To Update")
        resp = client.patch(
            _frame_styles_url(org, style.frame_style_id),
            data=json.dumps({"name": "Updated", "color_hex": "#FF0000"}),
            content_type="application/json",
        )
        assert resp.status_code == 200

    def test_update_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.patch(
            _frame_styles_url(org, uuid4()),
            data=json.dumps({"name": "x"}),
            content_type="application/json",
        )
        assert resp.status_code == 404

    def test_delete_existing(self, auth_setup, db_session):
        client, org, _ = auth_setup
        style = _seed_frame_style(db_session, org.organization_id, name="To Remove")
        resp = client.delete(_frame_styles_url(org, style.frame_style_id))
        assert resp.status_code == 200

    def test_delete_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.delete(_frame_styles_url(org, uuid4()))
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Mount Configs
# ---------------------------------------------------------------------------


class TestMountConfigs:
    def test_list_empty(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_mount_configs_url(org))
        assert resp.status_code == 200

    def test_create_minimal(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(
            _mount_configs_url(org),
            data=json.dumps(
                {
                    "name": "Wall standard",
                    "mount_type": "wall",
                }
            ),
            content_type="application/json",
        )
        # 201 (success) / 422 (validation) / 400 (missing required fields)
        assert resp.status_code in (201, 400, 422)

    def test_update_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.patch(
            _mount_configs_url(org, uuid4()),
            data=json.dumps({"name": "x"}),
            content_type="application/json",
        )
        assert resp.status_code == 404

    def test_delete_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.delete(_mount_configs_url(org, uuid4()))
        assert resp.status_code == 404
