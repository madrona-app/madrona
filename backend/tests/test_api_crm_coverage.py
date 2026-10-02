"""
Coverage tests for the CRM / Customer / Visitor API router.

cold — specifically the Customer (datasets / entities / changes / runs)
and interaction logging.

Router source: ``app/fastapi_app/routers/crm.py``

Route families covered:
- Customer: ``/api/v1/datasets``, ``/api/v1/entities``, ``/api/v1/changes``,
  ``/api/v1/runs``, ``/api/v1/runs/{run_id}/execute``
  activities, conversion guards, interaction logging)
- Visitor: ``/api/guide/{org_slug}/visitor/…`` (identify, profile, interaction)

All endpoints require auth except the visitor ones (public, slug-scoped).
"""

import json
from datetime import datetime, timezone
from unittest.mock import patch
from uuid import uuid4

import pytest

from app.models import (
    ChangeEvent,
    Dataset,
    EntityCurrent,
    Organization,
    Run,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _post(auth_client, url, data):
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _patch(auth_client, url, data):
    return auth_client.patch(url, data=json.dumps(data), content_type="application/json")


def _make_dataset(db_session, org, key=None, name="Collection"):
    ds = Dataset(
        organization_id=org.organization_id,
        name=name,
        key=key or f"ds-{uuid4().hex[:6]}",
        description="test dataset",
    )
    db_session.add(ds)
    db_session.commit()
    return ds


def _make_entity(db_session, org, dataset, source_id=None, entity_type="record"):
    now = datetime.now(timezone.utc)
    source_system = "test-source"
    sid = source_id or uuid4().hex[:6]
    entity_key = f"{source_system}::{sid}"
    entity = EntityCurrent(
        organization_id=org.organization_id,
        entity_key=entity_key,
        dataset_id=dataset.dataset_id,
        entity_type=entity_type,
        source_system=source_system,
        source_id=sid,
        payload={"name": f"row-{sid}"},
        payload_hash=f"hash-{sid}",
        sources={},
        extracted_at=now,
        last_seen_at=now,
    )
    db_session.add(entity)
    db_session.commit()
    return entity


def _make_run(db_session, org, dataset, status="pending"):
    run = Run(
        organization_id=org.organization_id,
        dataset_id=dataset.dataset_id,
        status=status,
        triggered_by="test",
        parameters={},
        processed_count=0,
        created_count=0,
        updated_count=0,
        skipped_count=0,
        failed_count=0,
    )
    db_session.add(run)
    db_session.commit()
    return run


def _make_change(db_session, org, dataset, run, change_type="created"):
    now = datetime.now(timezone.utc)
    event = ChangeEvent(
        organization_id=org.organization_id,
        run_id=run.run_id,
        dataset_id=dataset.dataset_id,
        occurred_at=now,
        entity_key=f"test::{uuid4().hex[:6]}",
        entity_type="record",
        change_type=change_type,
        changed_fields=["name"],
        summary="created row",
    )
    db_session.add(event)
    db_session.commit()
    return event


class TestListDatasets:
    def test_empty(self, auth_setup):
        auth_client, _, _ = auth_setup
        resp = auth_client.get("/api/v1/datasets")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0
        assert data["limit"] == 100
        assert data["offset"] == 0

    def test_returns_org_datasets(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_dataset(db_session, org, key="ds1", name="Objects")
        _make_dataset(db_session, org, key="ds2", name="Donors")

        resp = auth_client.get("/api/v1/datasets")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 2
        names = {d["name"] for d in data["items"]}
        assert names == {"Objects", "Donors"}

    def test_pagination_params(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        for i in range(3):
            _make_dataset(db_session, org, key=f"ds-pag-{i}", name=f"DS{i}")

        resp = auth_client.get("/api/v1/datasets?limit=2&offset=1")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 3
        assert len(data["items"]) == 2
        assert data["limit"] == 2
        assert data["offset"] == 1

    def test_cross_org_isolation(self, auth_setup, db_session):
        """Datasets belonging to another org must not appear."""
        auth_client, org, _ = auth_setup
        other = Organization(name="Other CRM Org", slug="other-crm", is_demo=False, status="active")
        db_session.add(other)
        db_session.commit()
        _make_dataset(db_session, other, key="stranger", name="Stranger")

        resp = auth_client.get("/api/v1/datasets")
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 0


class TestGetDataset:
    def test_get_existing(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        ds = _make_dataset(db_session, org, name="Main")

        resp = auth_client.get(f"/api/v1/datasets/{ds.dataset_id}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["dataset_id"] == str(ds.dataset_id)
        assert data["name"] == "Main"
        assert data["entity_count"] == 0

    def test_get_not_found(self, auth_setup):
        auth_client, _, _ = auth_setup
        resp = auth_client.get(f"/api/v1/datasets/{uuid4()}")
        assert resp.status_code == 404

    def test_get_other_org_dataset_404(self, auth_setup, db_session):
        auth_client, _, _ = auth_setup
        other = Organization(name="Another Org", slug="another-crm", is_demo=False, status="active")
        db_session.add(other)
        db_session.commit()
        ds = _make_dataset(db_session, other, name="Stranger")

        resp = auth_client.get(f"/api/v1/datasets/{ds.dataset_id}")
        assert resp.status_code == 404


# ===========================================================================
# Customer — /api/v1/entities
# ===========================================================================


class TestListEntities:
    def test_empty(self, auth_setup):
        auth_client, _, _ = auth_setup
        resp = auth_client.get("/api/v1/entities")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_returns_entities(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        ds = _make_dataset(db_session, org)
        _make_entity(db_session, org, ds, source_id="e1")
        _make_entity(db_session, org, ds, source_id="e2")

        resp = auth_client.get("/api/v1/entities")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 2
        assert {e["source_id"] for e in data["items"]} == {"e1", "e2"}

    def test_filter_by_dataset(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        ds1 = _make_dataset(db_session, org, key="a")
        ds2 = _make_dataset(db_session, org, key="b")
        _make_entity(db_session, org, ds1, source_id="x1")
        _make_entity(db_session, org, ds2, source_id="y1")

        resp = auth_client.get(f"/api/v1/entities?dataset_id={ds1.dataset_id}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["source_id"] == "x1"

    def test_soft_deleted_hidden(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        ds = _make_dataset(db_session, org)
        entity = _make_entity(db_session, org, ds, source_id="gone")
        entity.is_deleted = True
        db_session.commit()

        resp = auth_client.get("/api/v1/entities")
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 0


# ===========================================================================
# Customer — /api/v1/changes
# ===========================================================================


class TestListChanges:
    def test_empty(self, auth_setup):
        auth_client, _, _ = auth_setup
        resp = auth_client.get("/api/v1/changes")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_filter_by_run(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        ds = _make_dataset(db_session, org)
        run1 = _make_run(db_session, org, ds, status="success")
        run2 = _make_run(db_session, org, ds, status="success")
        _make_change(db_session, org, ds, run1, change_type="created")
        _make_change(db_session, org, ds, run2, change_type="updated")

        resp = auth_client.get(f"/api/v1/changes?run_id={run1.run_id}")
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 1

    def test_filter_by_dataset(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        ds_a = _make_dataset(db_session, org, key="ca")
        ds_b = _make_dataset(db_session, org, key="cb")
        run_a = _make_run(db_session, org, ds_a, status="success")
        run_b = _make_run(db_session, org, ds_b, status="success")
        _make_change(db_session, org, ds_a, run_a)
        _make_change(db_session, org, ds_b, run_b)

        resp = auth_client.get(f"/api/v1/changes?dataset_id={ds_a.dataset_id}")
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 1


# ===========================================================================
# Customer — /api/v1/runs
# ===========================================================================


class TestListRuns:
    def test_empty(self, auth_setup):
        auth_client, _, _ = auth_setup
        resp = auth_client.get("/api/v1/runs")
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 0

    def test_returns_runs(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        ds = _make_dataset(db_session, org)
        _make_run(db_session, org, ds, status="success")
        _make_run(db_session, org, ds, status="failed")

        resp = auth_client.get("/api/v1/runs")
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 2

    def test_filter_by_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        ds = _make_dataset(db_session, org)
        _make_run(db_session, org, ds, status="success")
        _make_run(db_session, org, ds, status="failed")

        resp = auth_client.get("/api/v1/runs?status=failed")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["status"] == "failed"

    def test_filter_by_dataset(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        ds_a = _make_dataset(db_session, org, key="run-a")
        ds_b = _make_dataset(db_session, org, key="run-b")
        _make_run(db_session, org, ds_a, status="success")
        _make_run(db_session, org, ds_a, status="success")
        _make_run(db_session, org, ds_b, status="success")

        resp = auth_client.get(f"/api/v1/runs?dataset_id={ds_a.dataset_id}")
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 2


class TestExecuteRun:
    def test_run_not_found(self, auth_setup):
        auth_client, _, _ = auth_setup
        resp = auth_client.post(f"/api/v1/runs/{uuid4()}/execute")
        assert resp.status_code == 404

    def test_run_already_running(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        ds = _make_dataset(db_session, org)
        run = _make_run(db_session, org, ds, status="running")
        resp = auth_client.post(f"/api/v1/runs/{run.run_id}/execute")
        assert resp.status_code == 400

    def test_run_in_terminal_state(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        ds = _make_dataset(db_session, org)
        run = _make_run(db_session, org, ds, status="success")
        resp = auth_client.post(f"/api/v1/runs/{run.run_id}/execute")
        assert resp.status_code == 400
        assert "terminal" in (
            resp.get_json().get("error", {}).get("message", "")
            if isinstance(resp.get_json().get("error"), dict)
            else str(resp.get_json().get("detail", ""))
        ).lower()


# ===========================================================================
# ===========================================================================


class TestVisitorEndpoints:
    def test_identify_org_not_found(self, client):
        resp = client.post(
            "/api/guide/not-a-real-slug/visitor/identify",
            data=json.dumps({"session_id": "sess-123"}),
            content_type="application/json",
        )
        assert resp.status_code == 404

    def test_identify_missing_session(self, client, db_session):
        org = Organization(
            name="Guide Org", slug="guide-identify-org", is_demo=False, status="active",
        )
        db_session.add(org)
        db_session.commit()

        resp = client.post(
            f"/api/guide/{org.slug}/visitor/identify",
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_identify_invalid_email(self, client, db_session):
        org = Organization(
            name="Guide Org 2", slug="guide-identify-org-2", is_demo=False, status="active",
        )
        db_session.add(org)
        db_session.commit()

        resp = client.post(
            f"/api/guide/{org.slug}/visitor/identify",
            data=json.dumps({"session_id": "sess-abc", "email": "not-an-email"}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_identify_invalid_session_chars(self, client, db_session):
        org = Organization(
            name="Guide Org 3", slug="guide-identify-org-3", is_demo=False, status="active",
        )
        db_session.add(org)
        db_session.commit()

        resp = client.post(
            f"/api/guide/{org.slug}/visitor/identify",
            data=json.dumps({"session_id": "has spaces!!"}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_profile_missing_visitor_returns_404(self, client, db_session):
        org = Organization(
            name="Guide Org 4", slug="guide-profile-org", is_demo=False, status="active",
        )
        db_session.add(org)
        db_session.commit()

        # Have to patch the service so we don't actually hit visitor tables.
        with patch("app.services.visitor_service.get_visitor_service") as mocked:
            mocked.return_value.get_visitor_profile.return_value = None
            resp = client.get(
                f"/api/guide/{org.slug}/visitor/profile?session_id=sess-abc",
            )
        assert resp.status_code == 404

    def test_profile_org_not_found(self, client):
        resp = client.get(
            "/api/guide/definitely-missing/visitor/profile?session_id=sess-abc",
        )
        assert resp.status_code == 404

    def test_interaction_invalid_type(self, client, db_session):
        org = Organization(
            name="Guide Org 5", slug="guide-interaction-org", is_demo=False, status="active",
        )
        db_session.add(org)
        db_session.commit()

        resp = client.post(
            f"/api/guide/{org.slug}/visitor/interaction",
            data=json.dumps({
                "session_id": "sess-xyz",
                "interaction_type": "not_valid",
            }),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_interaction_missing_type(self, client, db_session):
        org = Organization(
            name="Guide Org 6", slug="guide-interaction-org-2", is_demo=False, status="active",
        )
        db_session.add(org)
        db_session.commit()

        resp = client.post(
            f"/api/guide/{org.slug}/visitor/interaction",
            data=json.dumps({"session_id": "sess-m"}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_interaction_invalid_source(self, client, db_session):
        org = Organization(
            name="Guide Org 7", slug="guide-interaction-org-3", is_demo=False, status="active",
        )
        db_session.add(org)
        db_session.commit()

        resp = client.post(
            f"/api/guide/{org.slug}/visitor/interaction",
            data=json.dumps({
                "session_id": "sess-s",
                "interaction_type": "object_view",
                "source": "mars",
            }),
            content_type="application/json",
        )
        assert resp.status_code == 400


# ===========================================================================
# Authorization — viewer can't hit CRM / customer endpoints
# ===========================================================================


class TestCrmAuthorization:
    def test_viewer_cannot_execute_run(self, viewer_auth_setup):
        """Viewer has data.view but not data.manage — execute requires manage."""
        auth_client, _, _ = viewer_auth_setup
        resp = auth_client.post(f"/api/v1/runs/{uuid4()}/execute")
        assert resp.status_code == 403

    def test_viewer_can_list_datasets(self, viewer_auth_setup):
        """data.view is in the viewer role — list should succeed (empty)."""
        auth_client, _, _ = viewer_auth_setup
        resp = auth_client.get("/api/v1/datasets")
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 0


class TestCrmUnauth:
    def test_unauth_list_datasets(self, client):
        resp = client.get("/api/v1/datasets")
        assert resp.status_code == 401

    def test_unauth_list_entities(self, client):
        resp = client.get("/api/v1/entities")
        assert resp.status_code == 401

    def test_unauth_list_changes(self, client):
        resp = client.get("/api/v1/changes")
        assert resp.status_code == 401

    def test_unauth_list_runs(self, client):
        resp = client.get("/api/v1/runs")
        assert resp.status_code == 401

    def test_unauth_execute_run(self, client):
        resp = client.post(f"/api/v1/runs/{uuid4()}/execute")
        assert resp.status_code == 401
