"""
Coverage tests for app/fastapi_app/routers/exhibit_exhibitions.py.

The router exposes 30 routes under /api/organizations/{org_id}/exhibit/exhibitions/...
covering exhibitions, exhibition objects, labels, content blocks, touring venues,
floor-plan associations, placements, and PDF exports. The existing
tests/test_api_exhibit.py covers the exhibition CRUD happy paths; this module
fills the remaining surface (objects, labels, content blocks, venues, floor
plans, placements, status history, exports, wrong-org isolation, viewer 403).

auth_setup grants platform.admin, so require_permission() bypasses the
specific permission key checks (see dependencies/auth.py:622). viewer_auth_setup
has no platform.admin and no exhibit permissions, so it surfaces 403 on
state-changing endpoints.
"""

from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest

from app.models import (
    Exhibition,
    ExhibitionContentBlock,
    ExhibitionFloorPlan,
    ExhibitionLabel,
    ExhibitionObject,
    ExhibitionStatusHistory,
    ExhibitionVenue,
    FloorPlan,
    Placement,
    Venue,
)


# ============================================================================
# URL helpers
# ============================================================================


def _base_url(org, exhibition_id: UUID | str = "") -> str:
    if exhibition_id == "":
        return f"/api/organizations/{org.organization_id}/exhibit/exhibitions"
    return (
        f"/api/organizations/{org.organization_id}"
        f"/exhibit/exhibitions/{exhibition_id}"
    )


# ============================================================================
# Fixture helpers (inline — not pytest fixtures to keep tests explicit)
# ============================================================================


def _make_exhibition(
    db_session,
    org,
    *,
    title: str = "Test Show",
    status: str = "proposed",
    exhibition_type: str = "temporary",
    is_public: bool = False,
    **overrides,
) -> Exhibition:
    exhibition = Exhibition(
        organization_id=org.organization_id,
        title=title,
        status=status,
        exhibition_type=exhibition_type,
        is_public=is_public,
        **overrides,
    )
    db_session.add(exhibition)
    db_session.commit()
    db_session.refresh(exhibition)
    return exhibition


def _make_venue_with_floor_plan(
    db_session,
    org,
    *,
    venue_name: str = "Main Gallery",
    floor_plan_name: str = "Room A",
) -> tuple[Venue, FloorPlan]:
    venue = Venue(
        organization_id=org.organization_id,
        name=venue_name,
        default_ceiling_height_cm=300,
        default_wall_color="#FFFFFF",
    )
    db_session.add(venue)
    db_session.flush()

    floor_plan = FloorPlan(
        venue_id=venue.venue_id,
        name=floor_plan_name,
        floor_number=1,
        geometry={"type": "rectangular", "width_cm": 800, "depth_cm": 600},
    )
    db_session.add(floor_plan)
    db_session.commit()
    db_session.refresh(floor_plan)
    return venue, floor_plan


def _make_exhibition_object(
    db_session,
    org,
    exhibition: Exhibition,
    *,
    entity_key: str | None = None,
    display_order: int = 0,
    section: str | None = None,
    object_status: str = "planned",
) -> ExhibitionObject:
    # Use entity_key path so we don't need a full collection_objects row.
    # The chk_exhibition_objects_source constraint requires exactly one of
    # (object_id, entity_key) to be set.
    obj = ExhibitionObject(
        exhibition_id=exhibition.exhibition_id,
        organization_id=org.organization_id,
        entity_key=entity_key or f"bridge:{uuid4().hex[:8]}",
        display_order=display_order,
        section=section,
        object_status=object_status,
    )
    db_session.add(obj)
    db_session.commit()
    db_session.refresh(obj)
    return obj


def _make_foreign_org(db_session):
    """Build a second organization so we can exercise wrong-org isolation.

    Returns a SimpleNamespace with organization_id so the _base_url helper
    accepts it the same way as the auth_setup's org proxy.
    """
    from app.models import Organization

    other = Organization(
        name=f"Other Org {uuid4().hex[:6]}",
        slug=f"other-{uuid4().hex[:6]}",
        is_demo=False,
        status="active",
    )
    db_session.add(other)
    db_session.commit()
    db_session.refresh(other)
    return SimpleNamespace(organization_id=other.organization_id)


# ============================================================================
# List exhibitions — filter branches
# ============================================================================


class TestListExhibitionsFilters:
    def test_filter_by_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_exhibition(db_session, org, title="Open Show", status="open")
        _make_exhibition(db_session, org, title="Closed Show", status="closed")
        _make_exhibition(db_session, org, title="Another Open", status="open")

        resp = auth_client.get(_base_url(org), params={"status": "open"})
        assert resp.status_code == 200
        data = resp.get_json()
        titles = sorted(e["title"] for e in data["exhibitions"])
        assert titles == ["Another Open", "Open Show"]

    def test_filter_by_exhibition_type(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_exhibition(db_session, org, title="Perm", exhibition_type="permanent")
        _make_exhibition(db_session, org, title="Temp", exhibition_type="temporary")

        resp = auth_client.get(_base_url(org), params={"exhibition_type": "permanent"})
        assert resp.status_code == 200
        titles = [e["title"] for e in resp.get_json()["exhibitions"]]
        assert titles == ["Perm"]

    def test_list_excludes_other_org_rows(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_exhibition(db_session, org, title="Mine")
        other = _make_foreign_org(db_session)
        _make_exhibition(db_session, other, title="Theirs")

        resp = auth_client.get(_base_url(org))
        assert resp.status_code == 200
        titles = [e["title"] for e in resp.get_json()["exhibitions"]]
        assert titles == ["Mine"]

    def test_list_payload_shape(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        venue, _ = _make_venue_with_floor_plan(db_session, org)
        _make_exhibition(
            db_session,
            org,
            title="With Venue",
            is_public=True,
            public_url_slug="with-venue",
            venue_id=venue.venue_id,
        )

        resp = auth_client.get(_base_url(org))
        assert resp.status_code == 200
        row = resp.get_json()["exhibitions"][0]
        assert row["venue_name"] == "Main Gallery"
        assert row["is_public"] is True
        assert row["public_url_slug"] == "with-venue"
        assert row["placement_count"] == 0


# ============================================================================
# Get exhibition — full detail payload + status history + placements
# ============================================================================


class TestGetExhibitionDetail:
    def test_get_returns_status_history_and_floor_plans(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org, title="Detailed")
        venue, fp = _make_venue_with_floor_plan(db_session, org)

        # Wire an exhibition floor plan + status history row.
        db_session.add(
            ExhibitionFloorPlan(
                exhibition_id=exh.exhibition_id,
                floor_plan_id=fp.floor_plan_id,
                visit_order=1,
            )
        )
        db_session.add(
            ExhibitionStatusHistory(
                exhibition_id=exh.exhibition_id,
                status="proposed",
                notes="initial proposal",
            )
        )
        db_session.commit()

        resp = auth_client.get(_base_url(org, exh.exhibition_id))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["exhibition_id"] == str(exh.exhibition_id)
        assert len(data["floor_plans"]) == 1
        assert data["floor_plans"][0]["name"] == "Room A"
        assert data["floor_plans"][0]["visit_order"] == 1
        assert len(data["status_history"]) == 1
        assert data["status_history"][0]["status"] == "proposed"
        assert data["status_history"][0]["notes"] == "initial proposal"
        assert data["placements"] == []

    def test_get_wrong_org_returns_404(self, auth_setup, db_session):
        """Exhibition owned by a different org must not be reachable."""
        auth_client, org, _ = auth_setup
        other = _make_foreign_org(db_session)
        foreign_exh = _make_exhibition(db_session, other, title="Not Yours")

        resp = auth_client.get(_base_url(org, foreign_exh.exhibition_id))
        assert resp.status_code == 404
        error = resp.get_json().get("error", {})
        message = error.get("message") if isinstance(error, dict) else str(error)
        assert "not found" in (message or "").lower()

    def test_get_exhibition_with_placement(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org, title="With Placement")
        _venue, fp = _make_venue_with_floor_plan(db_session, org)

        db_session.add(
            ExhibitionFloorPlan(
                exhibition_id=exh.exhibition_id,
                floor_plan_id=fp.floor_plan_id,
                visit_order=1,
            )
        )
        placement = Placement(
            exhibition_id=exh.exhibition_id,
            floor_plan_id=fp.floor_plan_id,
            source_type="external",
            external_url="https://example.com/art.jpg",
            display_title="Untitled 1",
            display_artist="Test Artist",
            width_cm=Decimal("50"),
            height_cm=Decimal("70"),
            wall_id="north",
            position_x=Decimal("100"),
            position_y=Decimal("150"),
            placement_status="draft",
        )
        db_session.add(placement)
        db_session.commit()

        resp = auth_client.get(_base_url(org, exh.exhibition_id))
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["placements"]) == 1
        p = data["placements"][0]
        assert p["display_title"] == "Untitled 1"
        assert p["wall_id"] == "north"
        assert p["width_cm"] == 50
        assert p["height_cm"] == 70
        assert p["placement_status"] == "draft"


# ============================================================================
# Create exhibition — validation + type / status defaults + venue_id
# ============================================================================


class TestCreateExhibitionExtra:
    def test_create_sets_defaults(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(_base_url(org), json={"title": "Defaults"})
        assert resp.status_code == 201
        ex_id = resp.get_json()["exhibition_id"]

        row = db_session.get(Exhibition, UUID(ex_id))
        assert row is not None
        assert row.status == "proposed"
        assert row.exhibition_type == "temporary"
        assert row.is_public is False

    def test_create_respects_supplied_fields(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        venue, _ = _make_venue_with_floor_plan(db_session, org)
        resp = auth_client.post(
            _base_url(org),
            json={
                "title": "Full",
                "description": "Big show",
                "exhibition_type": "permanent",
                "status": "authorized",
                "venue_id": str(venue.venue_id),
                "planned_start_date": "2026-05-01",
                "planned_end_date": "2026-09-30",
                "is_public": True,
                "public_url_slug": "full-show-2026",
            },
        )
        assert resp.status_code == 201
        row = db_session.get(Exhibition, UUID(resp.get_json()["exhibition_id"]))
        assert row.exhibition_type == "permanent"
        assert row.status == "authorized"
        assert row.venue_id == venue.venue_id
        assert row.is_public is True
        assert row.public_url_slug == "full-show-2026"

    def test_create_invalid_status_returns_400(self, auth_setup):
        """Bogus status violates the CHECK constraint → IntegrityError → 400."""
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _base_url(org),
            json={"title": "Bad", "status": "not_a_status"},
        )
        assert resp.status_code == 400
        detail = resp.get_json()["error"]
        assert detail["code"] == "constraint_violation"

    def test_create_duplicate_slug_returns_409(self, auth_setup, db_session):
        """public_url_slug has a UNIQUE index → second insert 409."""
        auth_client, org, _ = auth_setup
        _make_exhibition(
            db_session, org, title="First", public_url_slug="duplicate-slug"
        )
        resp = auth_client.post(
            _base_url(org),
            json={"title": "Second", "public_url_slug": "duplicate-slug"},
        )
        assert resp.status_code == 409
        assert resp.get_json()["error"]["code"] == "duplicate"


# ============================================================================
# Update / delete — status transitions, wrong-org, allowed-fields
# ============================================================================


class TestUpdateExhibitionExtra:
    def test_patch_status_transition_to_authorized(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org, status="proposed")

        resp = auth_client.patch(
            _base_url(org, exh.exhibition_id),
            json={"status": "authorized"},
        )
        assert resp.status_code == 200
        db_session.expire_all()
        refreshed = db_session.get(Exhibition, exh.exhibition_id)
        assert refreshed.status == "authorized"

    def test_patch_invalid_status_rejected(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org, status="proposed")

        resp = auth_client.patch(
            _base_url(org, exh.exhibition_id),
            json={"status": "totally-bogus"},
        )
        # CHECK constraint violation flushes as IntegrityError → 400.
        assert resp.status_code == 400
        assert resp.get_json()["error"]["code"] == "constraint_violation"

    def test_patch_allows_partial_fields(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(
            db_session, org, title="Original", description="initial"
        )

        # Only patching description — title should remain untouched.
        resp = auth_client.patch(
            _base_url(org, exh.exhibition_id),
            json={"description": "updated", "curator_notes": "note!"},
        )
        assert resp.status_code == 200

        db_session.expire_all()
        refreshed = db_session.get(Exhibition, exh.exhibition_id)
        assert refreshed.title == "Original"
        assert refreshed.description == "updated"
        assert refreshed.curator_notes == "note!"

    def test_patch_ignores_unknown_fields(self, auth_setup, db_session):
        """Unknown keys must not be setattr'd (prevents arbitrary column writes)."""
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org, title="Keep")

        resp = auth_client.patch(
            _base_url(org, exh.exhibition_id),
            json={"title": "Renamed", "organization_id": str(uuid4())},
        )
        assert resp.status_code == 200
        db_session.expire_all()
        refreshed = db_session.get(Exhibition, exh.exhibition_id)
        assert refreshed.title == "Renamed"
        assert refreshed.organization_id == org.organization_id  # untouched

    def test_patch_wrong_org_returns_404(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        other = _make_foreign_org(db_session)
        foreign = _make_exhibition(db_session, other, title="Theirs")

        resp = auth_client.patch(
            _base_url(org, foreign.exhibition_id),
            json={"title": "Hijack"},
        )
        assert resp.status_code == 404


class TestDeleteExhibitionExtra:
    def test_delete_cascades_exhibition_objects(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        eo = _make_exhibition_object(db_session, org, exh)
        eo_id = eo.exhibition_object_id
        exh_id = exh.exhibition_id

        resp = auth_client.delete(_base_url(org, exh_id))
        assert resp.status_code == 200

        db_session.expire_all()
        assert db_session.get(Exhibition, exh_id) is None
        assert db_session.get(ExhibitionObject, eo_id) is None

    def test_delete_wrong_org_returns_404(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        other = _make_foreign_org(db_session)
        foreign = _make_exhibition(db_session, other)

        resp = auth_client.delete(_base_url(org, foreign.exhibition_id))
        assert resp.status_code == 404


# ============================================================================
# Exhibition objects — list / add / update / delete
# ============================================================================


class TestExhibitionObjects:
    def test_list_objects_empty(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        resp = auth_client.get(_base_url(org, exh.exhibition_id) + "/objects")
        assert resp.status_code == 200
        assert resp.get_json() == {"exhibition_objects": []}

    def test_list_objects_returns_rows_in_display_order(
        self, auth_setup, db_session
    ):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        # Insert out of order to verify ORDER BY display_order is respected.
        _make_exhibition_object(
            db_session, org, exh, entity_key="bridge-z", display_order=2
        )
        _make_exhibition_object(
            db_session, org, exh, entity_key="bridge-a", display_order=1
        )

        resp = auth_client.get(_base_url(org, exh.exhibition_id) + "/objects")
        assert resp.status_code == 200
        rows = resp.get_json()["exhibition_objects"]
        assert [r["entity_key"] for r in rows] == ["bridge-a", "bridge-z"]
        assert rows[0]["source_type"] == "bridge"
        assert rows[0]["object_status"] == "planned"

    def test_add_object_by_entity_key(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/objects",
            json={
                "entity_key": "bridge:abc123",
                "section": "Gallery A",
                "object_status": "planned",
                "installation_notes": "Mount at eye level",
            },
        )
        assert resp.status_code == 201
        body = resp.get_json()
        assert body["source_type"] == "bridge"

        # Auto-assigned display_order = max + 1 (max was 0, so 1).
        row = db_session.get(ExhibitionObject, UUID(body["exhibition_object_id"]))
        assert row is not None
        assert row.display_order == 1
        assert row.section == "Gallery A"
        assert row.installation_notes == "Mount at eye level"

    def test_add_object_auto_increments_display_order(
        self, auth_setup, db_session
    ):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        _make_exhibition_object(
            db_session, org, exh, entity_key="first", display_order=5
        )

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/objects",
            json={"entity_key": "second"},
        )
        assert resp.status_code == 201
        body = resp.get_json()
        row = db_session.get(ExhibitionObject, UUID(body["exhibition_object_id"]))
        assert row.display_order == 6

    def test_add_object_missing_source_returns_400(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/objects",
            json={"section": "Gallery A"},  # no object_id/entity_key
        )
        assert resp.status_code == 400
        detail = resp.get_json()["error"]
        assert detail["code"] == "bad_request"
        assert "object_id" in detail["message"] or "entity_key" in detail["message"]

    def test_add_object_both_sources_returns_400(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/objects",
            json={"object_id": str(uuid4()), "entity_key": "mixed"},
        )
        assert resp.status_code == 400
        assert "both" in resp.get_json()["error"]["message"].lower()

    def test_add_object_missing_exhibition_returns_404(self, auth_setup):
        auth_client, org, _ = auth_setup
        fake_id = uuid4()
        resp = auth_client.post(
            _base_url(org, fake_id) + "/objects",
            json={"entity_key": "bridge:x"},
        )
        assert resp.status_code == 404

    def test_update_object(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        eo = _make_exhibition_object(db_session, org, exh)

        resp = auth_client.patch(
            _base_url(org, exh.exhibition_id) + f"/objects/{eo.exhibition_object_id}",
            json={
                "section": "Gallery B",
                "object_status": "confirmed",
                "special_requirements": "Climate control",
            },
        )
        assert resp.status_code == 200

        db_session.expire_all()
        refreshed = db_session.get(ExhibitionObject, eo.exhibition_object_id)
        assert refreshed.section == "Gallery B"
        assert refreshed.object_status == "confirmed"
        assert refreshed.special_requirements == "Climate control"

    def test_update_object_invalid_status_400(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        eo = _make_exhibition_object(db_session, org, exh)

        resp = auth_client.patch(
            _base_url(org, exh.exhibition_id) + f"/objects/{eo.exhibition_object_id}",
            json={"object_status": "bogus"},
        )
        assert resp.status_code == 400

    def test_update_object_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        fake = uuid4()

        resp = auth_client.patch(
            _base_url(org, exh.exhibition_id) + f"/objects/{fake}",
            json={"section": "Nowhere"},
        )
        assert resp.status_code == 404

    def test_delete_object(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        eo = _make_exhibition_object(db_session, org, exh)
        eo_id = eo.exhibition_object_id

        resp = auth_client.delete(
            _base_url(org, exh.exhibition_id) + f"/objects/{eo_id}"
        )
        assert resp.status_code == 200

        db_session.expire_all()
        assert db_session.get(ExhibitionObject, eo_id) is None

    def test_delete_object_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)

        resp = auth_client.delete(
            _base_url(org, exh.exhibition_id) + f"/objects/{uuid4()}"
        )
        assert resp.status_code == 404


class TestExhibitionObjectsEditor:
    def test_editor_list_returns_dimension_payload(
        self, auth_setup, db_session
    ):
        """Bridge payload path: width_cm/height_cm pulled from entity payload.

        The /objects/for-editor endpoint walks service.get_object_data(). For a
        bridge entity with no underlying entity_current row, payload comes back
        None and width/height default to None — still a valid branch to cover.
        """
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        _make_exhibition_object(
            db_session, org, exh, entity_key="bridge:editor-1", section="Intro"
        )

        resp = auth_client.get(
            _base_url(org, exh.exhibition_id) + "/objects/for-editor"
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["total"] == 1
        obj = body["objects"][0]
        assert obj["entity_key"] == "bridge:editor-1"
        assert obj["section"] == "Intro"
        assert obj["source_type"] == "bridge"


# ============================================================================
# Labels — list / generate / approve
# ============================================================================


class TestExhibitionLabels:
    def test_list_labels_empty(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)

        resp = auth_client.get(_base_url(org, exh.exhibition_id) + "/labels")
        assert resp.status_code == 200
        assert resp.get_json() == {"exhibition_labels": []}

    def test_generate_labels_creates_one_per_object(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        _make_exhibition_object(db_session, org, exh, entity_key="a")
        _make_exhibition_object(db_session, org, exh, entity_key="b")

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/labels/generate",
            json={"label_type": "tombstone"},
        )
        assert resp.status_code == 201
        body = resp.get_json()
        assert body["labels_created"] == 2

        # Follow-up list returns the generated rows.
        list_resp = auth_client.get(_base_url(org, exh.exhibition_id) + "/labels")
        assert list_resp.status_code == 200
        labels = list_resp.get_json()["exhibition_labels"]
        assert len(labels) == 2
        assert all(lbl["status"] == "draft" for lbl in labels)
        assert all(lbl["label_type"] == "tombstone" for lbl in labels)

    def test_generate_labels_empty_body_defaults_to_tombstone(
        self, auth_setup, db_session
    ):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        _make_exhibition_object(db_session, org, exh, entity_key="only")

        # Empty JSON body hits the `if not data: data = {}` branch.
        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/labels/generate",
            json={},
        )
        assert resp.status_code == 201
        body = resp.get_json()
        assert body["labels_created"] == 1

    def test_approve_label(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        exh = _make_exhibition(db_session, org)
        eo = _make_exhibition_object(db_session, org, exh)

        label = ExhibitionLabel(
            exhibition_id=exh.exhibition_id,
            exhibition_object_id=eo.exhibition_object_id,
            label_type="tombstone",
            generated_text="Test label",
            status="draft",
        )
        db_session.add(label)
        db_session.commit()
        db_session.refresh(label)

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + f"/labels/{label.label_id}/approve"
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["status"] == "approved"

        db_session.expire_all()
        refreshed = db_session.get(ExhibitionLabel, label.label_id)
        assert refreshed.status == "approved"
        assert refreshed.approved_by == user.user_id

    def test_approve_label_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + f"/labels/{uuid4()}/approve"
        )
        assert resp.status_code == 404


# ============================================================================
# Content blocks — list / create / update / delete
# ============================================================================


class TestContentBlocks:
    def test_list_content_blocks_empty(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        resp = auth_client.get(
            _base_url(org, exh.exhibition_id) + "/content-blocks"
        )
        assert resp.status_code == 200
        assert resp.get_json() == {"content_blocks": []}

    def test_create_content_block_defaults(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/content-blocks",
            json={"title": "Welcome", "content": "Hello museum goer."},
        )
        assert resp.status_code == 201
        block_id = resp.get_json()["block_id"]

        block = db_session.get(ExhibitionContentBlock, UUID(block_id))
        assert block is not None
        assert block.block_type == "theme_narrative"  # default
        assert block.status == "draft"  # default
        assert block.content_format == "markdown"  # default
        assert block.is_public is False  # default
        assert block.display_order == 1  # max(0) + 1

    def test_create_content_block_auto_order(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)

        first = ExhibitionContentBlock(
            exhibition_id=exh.exhibition_id,
            block_type="intro_text",
            content="First",
            content_format="markdown",
            status="draft",
            display_order=3,
        )
        db_session.add(first)
        db_session.commit()

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/content-blocks",
            json={"block_type": "quote", "content": "'Art is art'"},
        )
        assert resp.status_code == 201
        second = db_session.get(
            ExhibitionContentBlock, UUID(resp.get_json()["block_id"])
        )
        assert second.display_order == 4

    def test_create_content_block_invalid_type(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/content-blocks",
            json={"block_type": "not_allowed", "content": "..."},
        )
        assert resp.status_code == 400
        assert resp.get_json()["error"]["code"] == "constraint_violation"

    def test_update_content_block(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        block = ExhibitionContentBlock(
            exhibition_id=exh.exhibition_id,
            block_type="intro_text",
            content="Original",
            content_format="markdown",
            status="draft",
        )
        db_session.add(block)
        db_session.commit()

        resp = auth_client.patch(
            _base_url(org, exh.exhibition_id) + f"/content-blocks/{block.block_id}",
            json={"title": "Updated", "content": "Rewritten", "status": "published"},
        )
        assert resp.status_code == 200

        db_session.expire_all()
        refreshed = db_session.get(ExhibitionContentBlock, block.block_id)
        assert refreshed.title == "Updated"
        assert refreshed.content == "Rewritten"
        assert refreshed.status == "published"

    def test_update_content_block_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        resp = auth_client.patch(
            _base_url(org, exh.exhibition_id) + f"/content-blocks/{uuid4()}",
            json={"title": "x"},
        )
        assert resp.status_code == 404

    def test_delete_content_block(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        block = ExhibitionContentBlock(
            exhibition_id=exh.exhibition_id,
            block_type="quote",
            content="'To be deleted'",
            content_format="markdown",
            status="draft",
        )
        db_session.add(block)
        db_session.commit()
        block_id = block.block_id

        resp = auth_client.delete(
            _base_url(org, exh.exhibition_id) + f"/content-blocks/{block_id}"
        )
        assert resp.status_code == 200

        db_session.expire_all()
        assert db_session.get(ExhibitionContentBlock, block_id) is None

    def test_delete_content_block_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)

        resp = auth_client.delete(
            _base_url(org, exh.exhibition_id) + f"/content-blocks/{uuid4()}"
        )
        assert resp.status_code == 404


# ============================================================================
# Touring venues — list / add / update / delete
# ============================================================================


class TestTouringVenues:
    def test_list_empty(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        resp = auth_client.get(_base_url(org, exh.exhibition_id) + "/venues")
        assert resp.status_code == 200
        assert resp.get_json() == {"exhibition_venues": []}

    def test_create_external_venue(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org, exhibition_type="touring")

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/venues",
            json={
                "external_venue_name": "Partner Museum",
                "external_venue_address": "123 Art St",
                "planned_start_date": "2026-06-01",
                "planned_end_date": "2026-09-30",
                "status": "proposed",
                "fee_amount": "5000.00",
                "fee_currency": "USD",
                "special_requirements": "Climate-controlled transport",
            },
        )
        assert resp.status_code == 201
        body = resp.get_json()
        venue = db_session.get(
            ExhibitionVenue, UUID(body["exhibition_venue_id"])
        )
        assert venue.external_venue_name == "Partner Museum"
        assert venue.tour_order == 1  # max(0) + 1
        assert venue.status == "proposed"

    def test_create_internal_venue(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org, exhibition_type="touring")
        venue, _ = _make_venue_with_floor_plan(db_session, org)

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/venues",
            json={"venue_id": str(venue.venue_id), "tour_order": 1},
        )
        assert resp.status_code == 201

    def test_create_venue_auto_increments_tour_order(
        self, auth_setup, db_session
    ):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        db_session.add(
            ExhibitionVenue(
                exhibition_id=exh.exhibition_id,
                external_venue_name="First",
                tour_order=7,
                status="proposed",
            )
        )
        db_session.commit()

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/venues",
            json={"external_venue_name": "Second"},
        )
        assert resp.status_code == 201
        body = resp.get_json()
        created = db_session.get(
            ExhibitionVenue, UUID(body["exhibition_venue_id"])
        )
        assert created.tour_order == 8

    def test_create_venue_invalid_status_rejected(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/venues",
            json={"external_venue_name": "Bad", "status": "nope"},
        )
        assert resp.status_code == 400
        assert resp.get_json()["error"]["code"] == "constraint_violation"

    def test_update_venue(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        v = ExhibitionVenue(
            exhibition_id=exh.exhibition_id,
            external_venue_name="Old Name",
            tour_order=1,
            status="proposed",
        )
        db_session.add(v)
        db_session.commit()
        db_session.refresh(v)

        resp = auth_client.patch(
            _base_url(org, exh.exhibition_id)
            + f"/venues/{v.exhibition_venue_id}",
            json={"external_venue_name": "Renamed", "status": "confirmed"},
        )
        assert resp.status_code == 200

        db_session.expire_all()
        refreshed = db_session.get(ExhibitionVenue, v.exhibition_venue_id)
        assert refreshed.external_venue_name == "Renamed"
        assert refreshed.status == "confirmed"

    def test_update_venue_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        resp = auth_client.patch(
            _base_url(org, exh.exhibition_id) + f"/venues/{uuid4()}",
            json={"external_venue_name": "x"},
        )
        assert resp.status_code == 404

    def test_delete_venue(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        v = ExhibitionVenue(
            exhibition_id=exh.exhibition_id,
            external_venue_name="Bye",
            tour_order=1,
            status="proposed",
        )
        db_session.add(v)
        db_session.commit()
        venue_pk = v.exhibition_venue_id

        resp = auth_client.delete(
            _base_url(org, exh.exhibition_id) + f"/venues/{venue_pk}"
        )
        assert resp.status_code == 200

        db_session.expire_all()
        assert db_session.get(ExhibitionVenue, venue_pk) is None

    def test_delete_venue_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        resp = auth_client.delete(
            _base_url(org, exh.exhibition_id) + f"/venues/{uuid4()}"
        )
        assert resp.status_code == 404


# ============================================================================
# Floor plans — add / remove (exhibition-level association)
# ============================================================================


class TestExhibitionFloorPlans:
    def test_add_floor_plan(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        _venue, fp = _make_venue_with_floor_plan(db_session, org)

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/floor-plans",
            json={"floor_plan_id": str(fp.floor_plan_id)},
        )
        assert resp.status_code == 201
        body = resp.get_json()
        assert body["floor_plan_id"] == str(fp.floor_plan_id)
        assert body["visit_order"] == 1

    def test_add_floor_plan_missing_id(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/floor-plans",
            json={},
        )
        assert resp.status_code == 400
        assert "floor_plan_id" in resp.get_json()["error"]["message"]

    def test_add_floor_plan_exhibition_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _venue, fp = _make_venue_with_floor_plan(db_session, org)

        resp = auth_client.post(
            _base_url(org, uuid4()) + "/floor-plans",
            json={"floor_plan_id": str(fp.floor_plan_id)},
        )
        assert resp.status_code == 404

    def test_add_floor_plan_wrong_org_rejected(self, auth_setup, db_session):
        """Floor plan owned by a different org must 404 even if exhibition exists."""
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        other = _make_foreign_org(db_session)
        _venue, foreign_fp = _make_venue_with_floor_plan(db_session, other)

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/floor-plans",
            json={"floor_plan_id": str(foreign_fp.floor_plan_id)},
        )
        assert resp.status_code == 404

    def test_add_floor_plan_duplicate_returns_400(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        _venue, fp = _make_venue_with_floor_plan(db_session, org)

        db_session.add(
            ExhibitionFloorPlan(
                exhibition_id=exh.exhibition_id,
                floor_plan_id=fp.floor_plan_id,
                visit_order=1,
            )
        )
        db_session.commit()

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/floor-plans",
            json={"floor_plan_id": str(fp.floor_plan_id)},
        )
        assert resp.status_code == 400
        assert "already" in resp.get_json()["error"]["message"].lower()

    def test_add_floor_plan_auto_visit_order(self, auth_setup, db_session):
        """Second floor plan gets max_order + 1."""
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        venue, fp1 = _make_venue_with_floor_plan(
            db_session, org, floor_plan_name="Room 1"
        )
        # Add a second floor plan in the same venue.
        fp2 = FloorPlan(
            venue_id=venue.venue_id,
            name="Room 2",
            floor_number=1,
            geometry={"type": "rectangular", "width_cm": 800, "depth_cm": 600},
        )
        db_session.add(fp2)
        db_session.commit()

        db_session.add(
            ExhibitionFloorPlan(
                exhibition_id=exh.exhibition_id,
                floor_plan_id=fp1.floor_plan_id,
                visit_order=5,
            )
        )
        db_session.commit()

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/floor-plans",
            json={"floor_plan_id": str(fp2.floor_plan_id)},
        )
        assert resp.status_code == 201
        assert resp.get_json()["visit_order"] == 6

    def test_remove_floor_plan(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        _venue, fp = _make_venue_with_floor_plan(db_session, org)
        db_session.add(
            ExhibitionFloorPlan(
                exhibition_id=exh.exhibition_id,
                floor_plan_id=fp.floor_plan_id,
                visit_order=1,
            )
        )
        db_session.commit()

        resp = auth_client.delete(
            _base_url(org, exh.exhibition_id)
            + f"/floor-plans/{fp.floor_plan_id}"
        )
        assert resp.status_code == 200

        db_session.expire_all()
        assoc = (
            db_session.query(ExhibitionFloorPlan)
            .filter_by(
                exhibition_id=exh.exhibition_id, floor_plan_id=fp.floor_plan_id
            )
            .first()
        )
        assert assoc is None

    def test_remove_floor_plan_cascades_placements(
        self, auth_setup, db_session
    ):
        """Removing a floor plan from an exhibition deletes its placements too."""
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        _venue, fp = _make_venue_with_floor_plan(db_session, org)
        db_session.add(
            ExhibitionFloorPlan(
                exhibition_id=exh.exhibition_id,
                floor_plan_id=fp.floor_plan_id,
                visit_order=1,
            )
        )
        placement = Placement(
            exhibition_id=exh.exhibition_id,
            floor_plan_id=fp.floor_plan_id,
            source_type="external",
            external_url="https://example.com/a.jpg",
            width_cm=Decimal("30"),
            height_cm=Decimal("40"),
            wall_id="north",
            position_x=Decimal("100"),
            position_y=Decimal("150"),
        )
        db_session.add(placement)
        db_session.commit()
        placement_id = placement.placement_id

        resp = auth_client.delete(
            _base_url(org, exh.exhibition_id)
            + f"/floor-plans/{fp.floor_plan_id}"
        )
        assert resp.status_code == 200

        db_session.expire_all()
        assert db_session.get(Placement, placement_id) is None

    def test_remove_floor_plan_not_associated(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        _venue, fp = _make_venue_with_floor_plan(db_session, org)

        resp = auth_client.delete(
            _base_url(org, exh.exhibition_id)
            + f"/floor-plans/{fp.floor_plan_id}"
        )
        assert resp.status_code == 404


# ============================================================================
# Placements — create / update / delete
# ============================================================================


def _setup_exhibition_with_floorplan(db_session, org) -> tuple[Exhibition, FloorPlan]:
    exh = _make_exhibition(db_session, org)
    _venue, fp = _make_venue_with_floor_plan(db_session, org)
    db_session.add(
        ExhibitionFloorPlan(
            exhibition_id=exh.exhibition_id,
            floor_plan_id=fp.floor_plan_id,
            visit_order=1,
        )
    )
    db_session.commit()
    return exh, fp


class TestPlacements:
    def test_create_placement_external(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh, fp = _setup_exhibition_with_floorplan(db_session, org)

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/placements",
            json={
                "floor_plan_id": str(fp.floor_plan_id),
                "source_type": "external",
                "external_url": "https://example.com/art.jpg",
                "display_title": "Painting 1",
                "width_cm": 50,
                "height_cm": 70,
                "wall_id": "north",
                "position_x": 200,
                "position_y": 150,
                "placement_status": "draft",
            },
        )
        assert resp.status_code == 201
        body = resp.get_json()
        placement = db_session.get(Placement, UUID(body["placement_id"]))
        assert placement.source_type == "external"
        assert placement.display_title == "Painting 1"
        assert placement.wall_id == "north"
        assert placement.width_cm == Decimal("50")
        assert placement.mount_type == "wall"  # default

    def test_create_placement_missing_required(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh, fp = _setup_exhibition_with_floorplan(db_session, org)

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/placements",
            json={
                "floor_plan_id": str(fp.floor_plan_id),
                "source_type": "external",
                # Missing width_cm / height_cm / wall_id / position_x / position_y.
            },
        )
        assert resp.status_code == 400
        detail = resp.get_json()["error"]
        assert detail["code"] == "validation_error"

    def test_create_placement_floor_plan_not_in_exhibition(
        self, auth_setup, db_session
    ):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        _venue, fp = _make_venue_with_floor_plan(db_session, org)
        # Intentionally not associated with the exhibition.

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/placements",
            json={
                "floor_plan_id": str(fp.floor_plan_id),
                "source_type": "external",
                "width_cm": 50,
                "height_cm": 70,
                "wall_id": "north",
                "position_x": 100,
                "position_y": 150,
            },
        )
        assert resp.status_code == 400
        assert (
            "not in exhibition"
            in resp.get_json()["error"]["message"].lower()
        )

    def test_create_placement_collections_without_object_link(
        self, auth_setup, db_session
    ):
        """Collection-object placements require the object be linked to the
        exhibition first. Hitting this path without the link yields 400.
        """
        auth_client, org, _ = auth_setup
        exh, fp = _setup_exhibition_with_floorplan(db_session, org)

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/placements",
            json={
                "floor_plan_id": str(fp.floor_plan_id),
                "source_type": "collections",
                "source_id": str(uuid4()),
                "width_cm": 50,
                "height_cm": 70,
                "wall_id": "north",
                "position_x": 100,
                "position_y": 150,
            },
        )
        assert resp.status_code == 400
        assert (
            "linked to this exhibition"
            in resp.get_json()["error"]["message"].lower()
        )

    def test_create_placement_exhibition_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _base_url(org, uuid4()) + "/placements",
            json={
                "floor_plan_id": str(uuid4()),
                "source_type": "external",
                "width_cm": 50,
                "height_cm": 70,
                "wall_id": "north",
                "position_x": 100,
                "position_y": 150,
            },
        )
        assert resp.status_code == 404

    def test_update_placement_decimal_and_string_fields(
        self, auth_setup, db_session
    ):
        auth_client, org, _ = auth_setup
        exh, fp = _setup_exhibition_with_floorplan(db_session, org)
        placement = Placement(
            exhibition_id=exh.exhibition_id,
            floor_plan_id=fp.floor_plan_id,
            source_type="external",
            external_url="https://example.com/a.jpg",
            width_cm=Decimal("10"),
            height_cm=Decimal("10"),
            wall_id="north",
            position_x=Decimal("0"),
            position_y=Decimal("0"),
            placement_status="draft",
        )
        db_session.add(placement)
        db_session.commit()
        db_session.refresh(placement)

        resp = auth_client.patch(
            _base_url(org, exh.exhibition_id)
            + f"/placements/{placement.placement_id}",
            json={
                "width_cm": 60,
                "height_cm": 80,
                "position_x": 300,
                "position_y": 180,
                "wall_id": "south",
                "display_title": "Renamed",
                "placement_status": "proposed",
            },
        )
        assert resp.status_code == 200

        db_session.expire_all()
        refreshed = db_session.get(Placement, placement.placement_id)
        assert refreshed.width_cm == Decimal("60")
        assert refreshed.height_cm == Decimal("80")
        assert refreshed.position_x == Decimal("300")
        assert refreshed.wall_id == "south"
        assert refreshed.display_title == "Renamed"
        assert refreshed.placement_status == "proposed"

    def test_update_placement_nullable_floor_position(
        self, auth_setup, db_session
    ):
        auth_client, org, _ = auth_setup
        exh, fp = _setup_exhibition_with_floorplan(db_session, org)
        placement = Placement(
            exhibition_id=exh.exhibition_id,
            floor_plan_id=fp.floor_plan_id,
            source_type="external",
            external_url="https://example.com/a.jpg",
            width_cm=Decimal("10"),
            height_cm=Decimal("10"),
            wall_id="floor",
            position_x=Decimal("0"),
            position_y=Decimal("0"),
            floor_position_x=Decimal("50"),
            floor_position_y=Decimal("50"),
        )
        db_session.add(placement)
        db_session.commit()
        db_session.refresh(placement)

        # Set back to None — exercises the None branch.
        resp = auth_client.patch(
            _base_url(org, exh.exhibition_id)
            + f"/placements/{placement.placement_id}",
            json={"floor_position_x": None, "floor_position_y": None},
        )
        assert resp.status_code == 200
        db_session.expire_all()
        refreshed = db_session.get(Placement, placement.placement_id)
        assert refreshed.floor_position_x is None
        assert refreshed.floor_position_y is None

    def test_update_placement_invalid_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh, fp = _setup_exhibition_with_floorplan(db_session, org)
        placement = Placement(
            exhibition_id=exh.exhibition_id,
            floor_plan_id=fp.floor_plan_id,
            source_type="external",
            external_url="https://example.com/a.jpg",
            width_cm=Decimal("10"),
            height_cm=Decimal("10"),
            wall_id="north",
            position_x=Decimal("0"),
            position_y=Decimal("0"),
        )
        db_session.add(placement)
        db_session.commit()

        resp = auth_client.patch(
            _base_url(org, exh.exhibition_id)
            + f"/placements/{placement.placement_id}",
            json={"placement_status": "installed"},  # not an allowed value
        )
        assert resp.status_code == 400
        assert (
            "invalid placement_status"
            in resp.get_json()["error"]["message"].lower()
        )

    def test_update_placement_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        resp = auth_client.patch(
            _base_url(org, exh.exhibition_id) + f"/placements/{uuid4()}",
            json={"width_cm": 10},
        )
        assert resp.status_code == 404

    def test_update_placement_wrong_org(self, auth_setup, db_session):
        """Placement on an exhibition in a different org must 404."""
        auth_client, org, _ = auth_setup
        other = _make_foreign_org(db_session)
        foreign_exh, foreign_fp = _setup_exhibition_with_floorplan(
            db_session, other
        )
        foreign_placement = Placement(
            exhibition_id=foreign_exh.exhibition_id,
            floor_plan_id=foreign_fp.floor_plan_id,
            source_type="external",
            external_url="https://example.com/f.jpg",
            width_cm=Decimal("10"),
            height_cm=Decimal("10"),
            wall_id="north",
            position_x=Decimal("0"),
            position_y=Decimal("0"),
        )
        db_session.add(foreign_placement)
        db_session.commit()

        resp = auth_client.patch(
            _base_url(org, foreign_exh.exhibition_id)
            + f"/placements/{foreign_placement.placement_id}",
            json={"display_title": "Hijacked"},
        )
        assert resp.status_code == 404

    def test_delete_placement(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh, fp = _setup_exhibition_with_floorplan(db_session, org)
        placement = Placement(
            exhibition_id=exh.exhibition_id,
            floor_plan_id=fp.floor_plan_id,
            source_type="external",
            external_url="https://example.com/a.jpg",
            width_cm=Decimal("10"),
            height_cm=Decimal("10"),
            wall_id="north",
            position_x=Decimal("0"),
            position_y=Decimal("0"),
        )
        db_session.add(placement)
        db_session.commit()
        pid = placement.placement_id

        resp = auth_client.delete(
            _base_url(org, exh.exhibition_id) + f"/placements/{pid}"
        )
        assert resp.status_code == 200

        db_session.expire_all()
        assert db_session.get(Placement, pid) is None

    def test_delete_placement_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)

        resp = auth_client.delete(
            _base_url(org, exh.exhibition_id) + f"/placements/{uuid4()}"
        )
        assert resp.status_code == 404


# ============================================================================
# PDF exports — checklist, installation spec, elevation drawing
# ============================================================================


def _seed_exhibition_with_placement(db_session, org) -> Exhibition:
    exh, fp = _setup_exhibition_with_floorplan(db_session, org)
    placement = Placement(
        exhibition_id=exh.exhibition_id,
        floor_plan_id=fp.floor_plan_id,
        source_type="external",
        external_url="https://example.com/a.jpg",
        display_title="Sample Artwork",
        display_artist="Test Artist",
        width_cm=Decimal("50"),
        height_cm=Decimal("70"),
        wall_id="north",
        position_x=Decimal("200"),
        position_y=Decimal("150"),
        placement_status="proposed",
        frame_width_cm=Decimal("3"),
        notes="Handle carefully",
    )
    db_session.add(placement)
    db_session.commit()
    return exh


class TestPdfExports:
    def test_export_object_checklist_returns_pdf(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _seed_exhibition_with_placement(db_session, org)

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/exports/object-checklist",
            json={"include_images": False},
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("application/pdf")
        assert resp.content.startswith(b"%PDF")

    def test_export_object_checklist_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _base_url(org, uuid4()) + "/exports/object-checklist",
            json={},
        )
        assert resp.status_code == 404

    def test_export_installation_spec_returns_pdf(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _seed_exhibition_with_placement(db_session, org)

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/exports/installation-spec",
            json={},
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("application/pdf")
        assert resp.content.startswith(b"%PDF")

    def test_export_installation_spec_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _base_url(org, uuid4()) + "/exports/installation-spec",
            json={},
        )
        assert resp.status_code == 404

    def test_export_elevation_pdf(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _seed_exhibition_with_placement(db_session, org)

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/exports/elevation-pdf",
            json={"scale": 50, "include_dimensions": True},
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("application/pdf")
        assert resp.content.startswith(b"%PDF")

    def test_export_elevation_pdf_filtered_by_wall(self, auth_setup, db_session):
        """wall_id filter path — exercises the list-comprehension filter."""
        auth_client, org, _ = auth_setup
        exh = _seed_exhibition_with_placement(db_session, org)

        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/exports/elevation-pdf",
            json={"wall_id": "north"},
        )
        assert resp.status_code == 200

    def test_export_elevation_pdf_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _base_url(org, uuid4()) + "/exports/elevation-pdf",
            json={},
        )
        assert resp.status_code == 404


# ============================================================================
# Viewer role (read-only) — edit endpoints must 403
# ============================================================================


class TestViewerForbidden:
    """viewer_auth_setup's org has no exhibit permissions, so non-GET routes
    (which call require_permission(EXHIBIT_EDIT / CREATE / DELETE)) return 403.
    """

    def test_viewer_cannot_create_exhibition(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.post(_base_url(org), json={"title": "Denied"})
        assert resp.status_code == 403

    def test_viewer_cannot_delete_exhibition(self, viewer_auth_setup, db_session):
        auth_client, org, _ = viewer_auth_setup
        exh = _make_exhibition(db_session, org)
        resp = auth_client.delete(_base_url(org, exh.exhibition_id))
        assert resp.status_code == 403

    def test_viewer_cannot_patch_exhibition(self, viewer_auth_setup, db_session):
        auth_client, org, _ = viewer_auth_setup
        exh = _make_exhibition(db_session, org)
        resp = auth_client.patch(
            _base_url(org, exh.exhibition_id),
            json={"title": "Denied"},
        )
        assert resp.status_code == 403

    def test_viewer_cannot_add_exhibition_object(
        self, viewer_auth_setup, db_session
    ):
        auth_client, org, _ = viewer_auth_setup
        exh = _make_exhibition(db_session, org)
        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/objects",
            json={"entity_key": "nope"},
        )
        assert resp.status_code == 403

    def test_viewer_cannot_create_placement(self, viewer_auth_setup, db_session):
        auth_client, org, _ = viewer_auth_setup
        exh, fp = _setup_exhibition_with_floorplan(db_session, org)
        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/placements",
            json={
                "floor_plan_id": str(fp.floor_plan_id),
                "source_type": "external",
                "width_cm": 10,
                "height_cm": 10,
                "wall_id": "north",
                "position_x": 0,
                "position_y": 0,
            },
        )
        assert resp.status_code == 403

    def test_viewer_cannot_add_floor_plan(self, viewer_auth_setup, db_session):
        auth_client, org, _ = viewer_auth_setup
        exh = _make_exhibition(db_session, org)
        _venue, fp = _make_venue_with_floor_plan(db_session, org)
        resp = auth_client.post(
            _base_url(org, exh.exhibition_id) + "/floor-plans",
            json={"floor_plan_id": str(fp.floor_plan_id)},
        )
        assert resp.status_code == 403


# ============================================================================
# Unauthenticated access — 401 across verbs
# ============================================================================


class TestUnauthenticated:
    def test_get_list_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        resp = client.get(_base_url(org))
        assert resp.status_code == 401

    def test_get_detail_requires_auth(self, client, auth_setup, db_session):
        _, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        resp = client.get(_base_url(org, exh.exhibition_id))
        assert resp.status_code == 401

    def test_objects_list_requires_auth(self, client, auth_setup, db_session):
        _, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        resp = client.get(_base_url(org, exh.exhibition_id) + "/objects")
        assert resp.status_code == 401

    def test_export_requires_auth(self, client, auth_setup, db_session):
        _, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        resp = client.post(
            _base_url(org, exh.exhibition_id) + "/exports/object-checklist",
            json={},
        )
        assert resp.status_code == 401


# ============================================================================
# Cache invalidation — make sure the create/update/delete wiring calls the
# org cache invalidator (important for public gallery staleness).
# ============================================================================


class TestCacheInvalidation:
    def test_create_invalidates_cache(self, auth_setup):
        auth_client, org, _ = auth_setup
        with patch(
            "app.fastapi_app.routers.exhibit_exhibitions.invalidate_org_cache_by_id"
        ) as mock_invalidate:
            resp = auth_client.post(_base_url(org), json={"title": "Cached"})
            assert resp.status_code == 201
            mock_invalidate.assert_called_once()
            args, kwargs = mock_invalidate.call_args
            assert args[0] == org.organization_id
            assert kwargs.get("section") == "exhibition"

    def test_update_invalidates_cache(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        with patch(
            "app.fastapi_app.routers.exhibit_exhibitions.invalidate_org_cache_by_id"
        ) as mock_invalidate:
            resp = auth_client.patch(
                _base_url(org, exh.exhibition_id),
                json={"title": "Renamed"},
            )
            assert resp.status_code == 200
            mock_invalidate.assert_called_once()

    def test_delete_invalidates_cache(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exh = _make_exhibition(db_session, org)
        with patch(
            "app.fastapi_app.routers.exhibit_exhibitions.invalidate_org_cache_by_id"
        ) as mock_invalidate:
            resp = auth_client.delete(_base_url(org, exh.exhibition_id))
            assert resp.status_code == 200
            mock_invalidate.assert_called_once()
