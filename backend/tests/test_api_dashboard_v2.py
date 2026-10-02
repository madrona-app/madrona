"""
Integration tests for V2 dashboard endpoints (attention-v2, pulse, workshop).
"""

from datetime import date, datetime, timedelta, timezone
from uuid import uuid4


# ── Helpers ──────────────────────────────────────────────────────────────


def _make_acquisition(db_session, org_id, **overrides):
    from app.models.procedures import Acquisition

    defaults = dict(
        organization_id=org_id,
        acquisition_number=f"ACQ-{uuid4().hex[:6]}",
        acquisition_method="gift",
        acquisition_date=date.today(),
        objects_count=2,
        status="pending_approval",
    )
    defaults.update(overrides)
    a = Acquisition(**defaults)
    db_session.add(a)
    db_session.flush()
    return a


def _make_incident(db_session, org_id, **overrides):
    from app.models.compliance import IncidentReport

    defaults = dict(
        organization_id=org_id,
        report_number=f"INC-{uuid4().hex[:6]}",
        report_date=date.today(),
        incident_type="environmental",
        discovered_date=datetime.now(timezone.utc),
        discovered_by_name="N. Vasquez",
        incident_description="Climate excursion in Gallery 4 awaiting your sign-off",
        status="submitted",
    )
    defaults.update(overrides)
    r = IncidentReport(**defaults)
    db_session.add(r)
    db_session.flush()
    return r


def _make_collection_object(db_session, org_id, **overrides):
    from app.models.objects import CollectionObject

    defaults = dict(
        organization_id=org_id,
        object_number=f"OBJ-{uuid4().hex[:6]}",
        object_name="Test object",
    )
    defaults.update(overrides)
    o = CollectionObject(**defaults)
    db_session.add(o)
    db_session.flush()
    return o


# ── Attention V2 ─────────────────────────────────────────────────────────


class TestAttentionV2:
    def test_returns_empty_items_when_nothing(self, auth_setup):
        client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/dashboard/attention-v2"
        resp = client.get(url)
        assert resp.status_code == 200
        assert resp.get_json() == {"items": []}

    def test_includes_pending_accession(self, auth_setup, db_session):
        client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org.organization_id)
        db_session.commit()

        data = client.get(
            f"/api/organizations/{org.organization_id}/dashboard/attention-v2"
        ).get_json()
        items = data["items"]
        assert len(items) == 1
        assert items[0]["type"] == "accession"
        assert items[0]["ref_number"] == acq.acquisition_number
        assert items[0]["severity"] == "this_week"
        assert items[0]["href"] == f"/collections/acquisitions/{acq.acquisition_id}"

    def test_includes_open_incident(self, auth_setup, db_session):
        client, org, _ = auth_setup
        inc = _make_incident(db_session, org.organization_id)
        db_session.commit()

        data = client.get(
            f"/api/organizations/{org.organization_id}/dashboard/attention-v2"
        ).get_json()
        items = data["items"]
        assert any(i["type"] == "incident" for i in items)
        sample = next(i for i in items if i["type"] == "incident")
        assert sample["ref_number"] == inc.report_number
        assert "N. Vasquez" in sample["context"]

    def test_excludes_resolved_incidents(self, auth_setup, db_session):
        client, org, _ = auth_setup
        _make_incident(db_session, org.organization_id, status="resolved")
        db_session.commit()
        data = client.get(
            f"/api/organizations/{org.organization_id}/dashboard/attention-v2"
        ).get_json()
        assert data["items"] == []

    def test_caps_total_items(self, auth_setup, db_session):
        client, org, _ = auth_setup
        for _ in range(8):
            _make_acquisition(db_session, org.organization_id)
        for _ in range(8):
            _make_incident(db_session, org.organization_id)
        db_session.commit()
        data = client.get(
            f"/api/organizations/{org.organization_id}/dashboard/attention-v2"
        ).get_json()
        assert len(data["items"]) <= 10

    def test_severity_sorted_first(self, auth_setup, db_session):
        client, org, _ = auth_setup
        # Acquisitions return severity=this_week; new incidents discovered today
        # return severity=urgent. Urgent must sort first.
        _make_acquisition(db_session, org.organization_id)
        _make_incident(db_session, org.organization_id)
        db_session.commit()
        data = client.get(
            f"/api/organizations/{org.organization_id}/dashboard/attention-v2"
        ).get_json()
        severities = [i["severity"] for i in data["items"]]
        assert severities[0] == "urgent"


# ── Pulse ────────────────────────────────────────────────────────────────


class TestPulse:
    def test_returns_zeros_for_empty_org(self, auth_setup):
        client, org, _ = auth_setup
        data = client.get(
            f"/api/organizations/{org.organization_id}/dashboard/pulse"
        ).get_json()
        assert len(data["stats"]) == 3
        assert all(s["value"] == 0 for s in data["stats"])
        assert data["recent_object"] is None

    def test_counts_recent_accessions(self, auth_setup, db_session):
        client, org, _ = auth_setup
        # Within the last 7 days
        _make_collection_object(
            db_session,
            org.organization_id,
            accession_date=date.today() - timedelta(days=2),
        )
        # Older than 7 days — should not count
        _make_collection_object(
            db_session,
            org.organization_id,
            accession_date=date.today() - timedelta(days=30),
        )
        db_session.commit()
        data = client.get(
            f"/api/organizations/{org.organization_id}/dashboard/pulse"
        ).get_json()
        accessions = next(s for s in data["stats"] if "Accessioned" in s["label"])
        assert accessions["value"] == 1

    def test_returns_recent_object(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _make_collection_object(
            db_session,
            org.organization_id,
            object_name="The Siesta",
        )
        db_session.commit()
        data = client.get(
            f"/api/organizations/{org.organization_id}/dashboard/pulse"
        ).get_json()
        assert data["recent_object"] is not None
        assert data["recent_object"]["name"] == "The Siesta"
        assert str(obj.object_id) in data["recent_object"]["href"]


# ── Workshop ─────────────────────────────────────────────────────────────


class TestWorkshop:
    def test_returns_zero_counts_for_empty_org(self, auth_setup):
        client, org, _ = auth_setup
        data = client.get(
            f"/api/organizations/{org.organization_id}/dashboard/workshop"
        ).get_json()
        assert data == {
            "bridge_running": 0,
            "collections_records": 0,
            "guide_active_conversations": 0,
            "content_drafts": 0,
            "media_assets": 0,
        }

    def test_counts_collection_records(self, auth_setup, db_session):
        client, org, _ = auth_setup
        for _ in range(3):
            _make_collection_object(db_session, org.organization_id)
        db_session.commit()
        data = client.get(
            f"/api/organizations/{org.organization_id}/dashboard/workshop"
        ).get_json()
        assert data["collections_records"] == 3
