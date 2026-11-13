"""Bulk updates applied from audit check-list results."""
from __future__ import annotations

import json
from datetime import date
from unittest.mock import patch
from uuid import uuid4

import pytest

from app.models import AuditCampaign, AuditResult, CollectionObject, Location, Movement, Workspace, WorkspaceItem


def _audits(org, *parts) -> str:
    base = f"/api/organizations/{org.organization_id}/collections/audits"
    return "/".join([base, *[str(p) for p in parts]])


def _post(client, url, body):
    return client.post(url, data=json.dumps(body), content_type="application/json")


@pytest.fixture
def checked(db_session, auth_setup):
    """A generated list of five objects: found, not found, two wrong, one pending."""
    client, org, user = auth_setup
    store = Location(organization_id=org.organization_id, name="Store B", code="B", path="B", location_type="room", current_count=5)
    offsite = Location(organization_id=org.organization_id, name="Offsite", code="OFF", path="OFF", location_type="room", current_count=0)
    db_session.add_all([store, offsite])
    db_session.flush()
    objs = [
        CollectionObject(organization_id=org.organization_id, object_number=f"B.{i:03d}", current_location_id=store.location_id)
        for i in range(5)
    ]
    db_session.add_all(objs)
    camp = AuditCampaign(
        organization_id=org.organization_id, campaign_number="AUD-B", title="Store B check",
        audit_type="location", status="in_progress", sample_method="complete",
        target_locations=[str(store.location_id)],
    )
    db_session.add(camp)
    db_session.commit()

    items = _post(client, _audits(org, camp.campaign_id, "check-list", "generate"), {}).get_json()["items"]
    put = lambda rid, **b: client.put(_audits(org, camp.campaign_id, "check-list", rid), data=json.dumps(b), content_type="application/json")
    assert put(items[0]["result_id"], outcome="found").status_code == 200
    assert put(items[1]["result_id"], outcome="not_found").status_code == 200
    for i in (2, 3):
        assert put(items[i]["result_id"], outcome="wrong_location", actual_location_id=str(offsite.location_id)).status_code == 200
    return {"client": client, "org": org, "user": user, "camp": camp, "items": items,
            "store": store, "offsite": offsite, "objs": objs}


@patch("app.fastapi_app.serializers.collections_helpers._index_collection_object")
class TestAuditBulkUpdate:
    def test_preview_describes_each_row(self, _idx, checked, db_session):
        c, org, camp, items = checked["client"], checked["org"], checked["camp"], checked["items"]
        resp = _post(c, _audits(org, camp.campaign_id, "check-list", "bulk-update", "preview"), {
            "result_ids": [i["result_id"] for i in items], "update_location": True, "mark_inventoried": True,
        })
        assert resp.status_code == 200, resp.get_json()
        body = resp.get_json()
        assert body["executed"] is False
        assert body["location_update_count"] == 2
        assert body["inventoried_count"] == 3
        assert body["skipped_count"] == 2  # not found + pending
        by_num = {r["object_number"]: r for r in body["rows"]}
        assert by_num["B.002"]["changes"][0] == "Record a movement from Store B to Offsite."
        assert any("wasn't seen" in s for s in by_num["B.001"]["skipped"])
        # Nothing changed yet.
        assert db_session.query(Movement).count() == 0

    def test_execute_moves_records_and_marks_inventoried(self, _idx, checked, db_session):
        c, org, camp, items, user = checked["client"], checked["org"], checked["camp"], checked["items"], checked["user"]
        resp = _post(c, _audits(org, camp.campaign_id, "check-list", "bulk-update", "execute"), {
            "result_ids": [i["result_id"] for i in items], "update_location": True, "mark_inventoried": True,
        })
        assert resp.status_code == 200, resp.get_json()
        body = resp.get_json()
        assert body["executed"] is True
        moved = [r for r in body["rows"] if r.get("movement_reference")]
        assert len(moved) == 2

        movements = db_session.query(Movement).all()
        assert len(movements) == 2
        assert {m.to_location_id for m in movements} == {checked["offsite"].location_id}
        assert all(m.from_location_id == checked["store"].location_id and m.reason == "inventory" for m in movements)
        assert len({m.movement_reference_number for m in movements}) == 2

        objs = {o.object_number: o for o in db_session.query(CollectionObject).all()}
        for o in objs.values():
            db_session.refresh(o)
        assert objs["B.002"].current_location_id == checked["offsite"].location_id
        assert objs["B.000"].current_location_id == checked["store"].location_id
        assert objs["B.000"].last_inventoried_date == date.today()
        assert objs["B.000"].last_inventoried_by == user.user_id
        assert objs["B.002"].last_inventoried_date == date.today()
        assert objs["B.001"].last_inventoried_date is None  # not found
        assert objs["B.004"].last_inventoried_date is None  # not checked

        db_session.refresh(checked["offsite"])
        db_session.refresh(checked["store"])
        assert checked["offsite"].current_count == 2
        assert checked["store"].current_count == 3

        results = {r.object_id: r for r in db_session.query(AuditResult).filter_by(campaign_id=camp.campaign_id)}
        assert results[objs["B.002"].object_id].follow_up_action == "location_updated"
        assert results[objs["B.002"].object_id].follow_up_completed is True

        # Applying again records no second movement.
        again = _post(c, _audits(org, camp.campaign_id, "check-list", "bulk-update", "execute"), {
            "result_ids": [items[2]["result_id"]], "update_location": True,
        }).get_json()
        assert again["location_update_count"] == 0
        assert db_session.query(Movement).count() == 2

        listing = c.get(_audits(org, camp.campaign_id, "check-list")).get_json()
        row = next(i for i in listing["items"] if i["object_number"] == "B.002")
        assert row["follow_up_action"] == "location_updated"

    def test_validation(self, _idx, checked, db_session):
        c, org, camp, items = checked["client"], checked["org"], checked["camp"], checked["items"]
        url = _audits(org, camp.campaign_id, "check-list", "bulk-update", "preview")
        assert _post(c, url, {"result_ids": [], "update_location": True}).status_code == 400
        assert _post(c, url, {"result_ids": [items[0]["result_id"]]}).status_code == 400
        resp = _post(c, url, {"result_ids": [str(uuid4())], "update_location": True})
        assert resp.status_code == 404
        assert resp.get_json()["error"]["code"] == "result_not_found"

    def test_field_restriction_blocks(self, _idx, checked, db_session):
        c, org, camp, items = checked["client"], checked["org"], checked["camp"], checked["items"]
        with patch(
            "app.services.field_access_service.get_write_restricted_fields",
            return_value={"current_location_id"},
        ):
            resp = _post(c, _audits(org, camp.campaign_id, "check-list", "bulk-update", "execute"), {
                "result_ids": [items[2]["result_id"]], "update_location": True,
            })
        assert resp.status_code == 403
        assert resp.get_json()["error"]["code"] == "field_restricted"
        assert db_session.query(Movement).count() == 0


class TestWorkspaceMarkInventoried:
    def test_set_last_inventoried_bulk_action(self, auth_setup, db_session):
        client, org, user = auth_setup
        obj = CollectionObject(organization_id=org.organization_id, object_number="W.1")
        db_session.add(obj)
        ws = Workspace(organization_id=org.organization_id, owner_user_id=user.user_id, workspace_type="collections", name="Inv")
        db_session.add(ws)
        db_session.flush()
        db_session.add(WorkspaceItem(workspace_id=ws.workspace_id, object_id=obj.object_id))
        db_session.commit()

        base = f"/api/organizations/{org.organization_id}/workspaces/{ws.workspace_id}/actions"
        keys = [a["key"] for a in client.get(base).get_json()["actions"]]
        assert "set_last_inventoried" in keys
        resp = _post(client, f"{base}/set_last_inventoried/execute", {"action_params": {"inventoried_date": "2026-11-01"}})
        assert resp.status_code == 200, resp.get_json()
        assert resp.get_json()["success_count"] == 1
        db_session.refresh(obj)
        assert obj.last_inventoried_date == date(2026, 11, 1)
        assert obj.last_inventoried_by == user.user_id
