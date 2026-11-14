"""Bulk write paths are recorded on each record's history.

SQL-level UPDATE/DELETE statements bypass the ORM audit listener. Every bulk
path that changes an audited record either works row by row through the ORM
or writes the audit events itself (app.services.entity_audit_bulk). These
tests check each path produces events with the right before/after values and
actor, and that they come back from the history API staff use.
"""
import json
import uuid
from datetime import date, datetime, timezone
from unittest.mock import patch

import pytest

from app import context as ctx
from app.models import (
    AuditCampaign,
    CollectionObject,
    CollectionObjectMedia,
    Constituent,
    ConstituentXref,
    EntityAuditEvent,
    Location,
    LoanOut,
    LoanOutObject,
    Media,
    Movement,
    ObjectEntry,
    ObjectFlag,
    ObjectOtherNumber,
    ObjectTitle,
    RecordFlagDefinition,
    Workspace,
    WorkspaceItem,
)

_INDEX = "app.fastapi_app.routers.collections_objects._index_collection_object"


def _base(org):
    return f"/api/organizations/{org.organization_id}/collections"


def _post(c, url, body):
    return c.post(url, data=json.dumps(body), content_type="application/json")


def _put(c, url, body):
    return c.put(url, data=json.dumps(body), content_type="application/json")


def _events(db, org_id, entity_type, entity_id, change_type=None, child_type=None):
    db.expire_all()
    q = db.query(EntityAuditEvent).filter(
        EntityAuditEvent.organization_id == org_id,
        EntityAuditEvent.entity_type == entity_type,
        EntityAuditEvent.entity_id == entity_id,
    )
    if change_type:
        q = q.filter(EntityAuditEvent.change_type == change_type)
    if child_type:
        q = q.filter(EntityAuditEvent.child_entity_type == child_type)
    return q.order_by(EntityAuditEvent.changed_at).all()


def _diffs(event):
    return {d.field_name: (d.old_value, d.new_value) for d in event.field_diffs}


def _history(client, org, entity_type, entity_id):
    resp = client.get(f"/api/organizations/{org.organization_id}/entity-history/{entity_type}/{entity_id}")
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()["items"]


@pytest.fixture()
def acting_user(auth_setup):
    """Set the request actor for direct service calls (the API sets it from the token)."""
    _, org, user = auth_setup
    token = ctx.request_user_id.set(str(user.user_id))
    try:
        yield org, user
    finally:
        ctx.request_user_id.reset(token)


# ---------------------------------------------------------------------------
# Completeness-rule flags: deleting a rule, and recompute after deactivating
# ---------------------------------------------------------------------------


@patch(_INDEX)
class TestRuleFlagCleanup:
    RULE = {"name": "Has description", "requirements": [{"field": "brief_description", "check": "present"}]}

    def _flagged_objects(self, client, org, n=3):
        rule = _post(client, f"{_base(org)}/settings/completeness-rules", self.RULE).get_json()
        oids = []
        for i in range(n):
            resp = _post(client, f"{_base(org)}/objects",
                         {"object_number": f"RF.{i}", "object_name": "Slate", "brief_description": "Brass"})
            assert resp.status_code == 201, resp.get_json()
            oids.append(uuid.UUID(resp.get_json()["object_id"]))
        return rule, oids

    def test_deleting_rule_records_each_flag_removal(self, _idx, auth_setup, db_session):
        client, org, user = auth_setup
        rule, oids = self._flagged_objects(client, org)
        assert db_session.query(ObjectFlag).filter_by(source="rule").count() == 3

        resp = client.delete(f"{_base(org)}/settings/completeness-rules/{rule['rule_id']}")
        assert resp.status_code == 200, resp.get_json()
        assert db_session.query(ObjectFlag).filter_by(source="rule").count() == 0

        for oid in oids:
            removed = _events(db_session, org.organization_id, "collection_object", oid, "link_removed", "object_flag")
            assert len(removed) == 1
            ev = removed[0]
            assert ev.changed_by == user.user_id
            assert ev.changed_by_email == user.email
            assert ev.child_display_key == "Has description"
            assert ev.child_entity_id == uuid.UUID(rule["flag_id"])
            assert ev.summary == "Removed flag: Has description"
            assert _diffs(ev)["flag"] == ("Has description", None)
            assert _diffs(ev)["source"] == ("rule", None)

        items = _history(client, org, "collection_object", oids[0])
        flag_events = [e for e in items if e["child_entity_type"] == "object_flag" and e["change_type"] == "link_removed"]
        assert len(flag_events) == 1
        assert flag_events[0]["changed_by_email"] == user.email
        assert {"field_name": "flag", "old_value": "Has description", "new_value": None} in flag_events[0]["field_diffs"]

    def test_recompute_after_deactivating_rule_records_removals(self, _idx, auth_setup, db_session):
        client, org, user = auth_setup
        rule, oids = self._flagged_objects(client, org, n=2)
        assert _put(client, f"{_base(org)}/settings/completeness-rules/{rule['rule_id']}", {"is_active": False}).status_code == 200
        assert client.post(f"{_base(org)}/settings/completeness-rules/recompute").status_code == 200
        assert db_session.query(ObjectFlag).filter_by(source="rule").count() == 0
        for oid in oids:
            removed = _events(db_session, org.organization_id, "collection_object", oid, "link_removed", "object_flag")
            assert len(removed) == 1
            assert removed[0].changed_by == user.user_id

    def test_cleanup_works_in_chunks(self, _idx, acting_user, db_session):
        from app.services.record_workflow import delete_flags_audited
        org, user = acting_user
        flag = RecordFlagDefinition(organization_id=org.organization_id, key="heavy", label="Heavy")
        db_session.add(flag)
        objs = [CollectionObject(organization_id=org.organization_id, object_number=f"CH.{i}") for i in range(5)]
        db_session.add_all(objs)
        db_session.flush()
        db_session.add_all([ObjectFlag(object_id=o.object_id, flag_id=flag.flag_id, organization_id=org.organization_id,
                                       source="rule") for o in objs])
        db_session.commit()

        deleted = delete_flags_audited(db_session, db_session.query(ObjectFlag).filter(ObjectFlag.flag_id == flag.flag_id),
                                       chunk_size=2)
        db_session.commit()
        assert deleted == 5
        assert db_session.query(ObjectFlag).count() == 0
        for o in objs:
            ev = _events(db_session, org.organization_id, "collection_object", o.object_id, "link_removed", "object_flag")
            assert len(ev) == 1
            assert ev[0].entity_display_key == o.object_number
            assert ev[0].changed_by == user.user_id


# ---------------------------------------------------------------------------
# Media primary flag
# ---------------------------------------------------------------------------


class TestPrimaryMedia:
    def test_setting_primary_records_the_previous_primary_cleared(self, auth_setup, db_session):
        client, org, user = auth_setup
        obj = CollectionObject(organization_id=org.organization_id, object_number="PM.1")
        media = [
            Media(organization_id=org.organization_id, s3_key=f"orgs/{org.organization_id}/media/{uuid.uuid4().hex}.png",
                  filename=f"side-{i}.png", file_size=10, mime_type="image/png", media_type="image")
            for i in range(2)
        ]
        db_session.add_all([obj, *media])
        db_session.flush()
        db_session.add_all([
            CollectionObjectMedia(object_id=obj.object_id, media_id=media[0].media_id, is_primary=True),
            CollectionObjectMedia(object_id=obj.object_id, media_id=media[1].media_id, is_primary=False),
        ])
        db_session.commit()

        resp = client.put(f"{_base(org)}/objects/{obj.object_id}/media/{media[1].media_id}/primary")
        assert resp.status_code == 200, resp.get_json()

        updated = _events(db_session, org.organization_id, "collection_object", obj.object_id,
                          "link_updated", "collection_object_media")
        by_media = {e.child_entity_id: e for e in updated}
        assert _diffs(by_media[media[0].media_id]) == {"is_primary": (True, False)}
        assert _diffs(by_media[media[1].media_id]) == {"is_primary": (False, True)}
        assert all(e.changed_by == user.user_id for e in updated)

        # Setting the same primary again changes nothing and records nothing.
        assert client.put(f"{_base(org)}/objects/{obj.object_id}/media/{media[1].media_id}/primary").status_code == 200
        assert len(_events(db_session, org.organization_id, "collection_object", obj.object_id,
                           "link_updated", "collection_object_media")) == 2


# ---------------------------------------------------------------------------
# Loan return completes the outbound movements
# ---------------------------------------------------------------------------


class TestLoanReturnMovements:
    def test_outbound_movement_completion_is_recorded(self, acting_user, db_session):
        from app.services.collections.loan_lifecycle import return_loan_out_effects
        org, user = acting_user
        store = Location(organization_id=org.organization_id, name="Store", code="ST", path="ST", location_type="room")
        obj = CollectionObject(organization_id=org.organization_id, object_number="LR.1")
        loan = LoanOut(organization_id=org.organization_id, loan_number="LO-1", borrower_name="Museum",
                       loan_purpose="exhibition", status="on_loan", request_date=date.today())
        db_session.add_all([store, obj, loan])
        db_session.flush()
        db_session.add(LoanOutObject(loan_out_id=loan.loan_out_id, organization_id=org.organization_id,
                                     object_id=obj.object_id))
        out = Movement(organization_id=org.organization_id, movement_reference_number="M.OUT.1",
                       object_id=obj.object_id, from_location_id=store.location_id, to_location_id=store.location_id,
                       movement_date=datetime.now(timezone.utc), reason="loan", status="in_transit",
                       reference_type="loan_out", reference_id=loan.loan_out_id)
        db_session.add(out)
        db_session.commit()
        db_session.refresh(loan)

        return_loan_out_effects(db_session, org.organization_id, loan, user.user_id, datetime.now(timezone.utc),
                                store.location_id)
        db_session.commit()

        updated = _events(db_session, org.organization_id, "movement", out.movement_id, "updated")
        assert len(updated) == 1
        assert _diffs(updated[0])["status"] == ("in_transit", "completed")
        assert updated[0].changed_by == user.user_id
        assert updated[0].entity_display_key == "M.OUT.1"


# ---------------------------------------------------------------------------
# Merging people
# ---------------------------------------------------------------------------


class TestConstituentMerge:
    def _people(self, db, org):
        keep = Constituent(organization_id=org.organization_id, name="Jacobus tenBroek", display_name="Jacobus tenBroek",
                           constituent_type="person")
        dup = Constituent(organization_id=org.organization_id, name="J. tenBroek", display_name="J. tenBroek",
                          constituent_type="person")
        db.add_all([keep, dup])
        db.flush()
        return keep, dup

    def test_service_merge_records_repointed_procedure_fields(self, acting_user, db_session):
        from app.services.constituent_service import ConstituentService
        org, user = acting_user
        keep, dup = self._people(db_session, org)
        entries = [ObjectEntry(organization_id=org.organization_id, entry_number=f"OE-{i}", entry_date=date.today(),
                               entry_reason="loan_consideration", depositor_id=dup.constituent_id) for i in range(2)]
        db_session.add_all(entries)
        db_session.commit()

        ConstituentService(db_session, org.organization_id).merge(keep.constituent_id, dup.constituent_id, merged_by=user.user_id)
        db_session.commit()

        for entry in entries:
            db_session.refresh(entry)
            assert entry.depositor_id == keep.constituent_id
            ev = [e for e in _events(db_session, org.organization_id, "object_entry", entry.entry_id, "updated")
                  if "depositor_id" in (e.changed_fields or [])]
            assert len(ev) == 1
            assert _diffs(ev[0]) == {"depositor_id": ("J. tenBroek", "Jacobus tenBroek")}
            assert ev[0].changed_by == user.user_id
            assert ev[0].entity_display_key == entry.entry_number

    def test_api_merge_records_repointed_object_credit(self, auth_setup, db_session):
        client, org, user = auth_setup
        keep, dup = self._people(db_session, org)
        obj = CollectionObject(organization_id=org.organization_id, object_number="MG.1")
        db_session.add(obj)
        db_session.flush()
        db_session.add(ConstituentXref(organization_id=org.organization_id, entity_type="collection_object",
                                       entity_id=obj.object_id, constituent_id=dup.constituent_id, role="maker"))
        db_session.commit()

        resp = _post(client, f"{_base(org)}/constituents/{keep.constituent_id}/merge",
                     {"secondary_id": str(dup.constituent_id)})
        assert resp.status_code == 200, resp.get_json()

        ev = _events(db_session, org.organization_id, "collection_object", obj.object_id, "link_updated")
        assert len(ev) == 1
        assert _diffs(ev[0])["constituent"] == ("J. tenBroek", "Jacobus tenBroek")
        assert ev[0].changed_by == user.user_id
        items = _history(client, org, "collection_object", obj.object_id)
        assert any(e["change_type"] == "link_updated" and e["changed_by_email"] == user.email for e in items)


# ---------------------------------------------------------------------------
# Import connector re-import
# ---------------------------------------------------------------------------


class TestConnectorReimport:
    def _import(self, db, org, props):
        from app.connectors.core.collections_destination import _import_one
        stats = {"created": 0, "updated": 0, "skipped": 0, "errors": 0}
        with patch("app.connectors.core.collections_destination._incomplete_for_publication", return_value=False):
            _import_one(db, org.organization_id, {"payload": {"properties": props}}, stats, datetime.now(timezone.utc))
        db.commit()
        return db.query(CollectionObject).filter_by(organization_id=org.organization_id,
                                                    object_number=props["object_number"]).one()

    def test_reimport_records_only_what_changed(self, acting_user, db_session):
        org, _ = acting_user
        props = {
            "object_number": "TMS.1", "object_name": "Slate",
            "titles": [{"title": "Braille slate", "title_type": "Primary"}],
            "alt_numbers": [{"number": "OLD-1", "description": "Previous Number"},
                            {"number": "LOT 7", "description": "Lot"}],
        }
        obj = self._import(db_session, org, props)
        oid = obj.object_id
        assert len(_events(db_session, org.organization_id, "collection_object", oid, "link_added", "object_title")) == 1

        # Same data again: nothing removed or re-added.
        self._import(db_session, org, props)
        assert _events(db_session, org.organization_id, "collection_object", oid, "link_removed") == []
        assert len(_events(db_session, org.organization_id, "collection_object", oid, "link_added", "object_title")) == 1

        # Title edited, one number dropped.
        props2 = {**props, "titles": [{"title": "Braille slate and stylus", "title_type": "Primary"}],
                  "alt_numbers": [{"number": "OLD-1", "description": "Previous Number"}]}
        self._import(db_session, org, props2)
        titles = _events(db_session, org.organization_id, "collection_object", oid, "link_updated", "object_title")
        assert len(titles) == 1
        assert _diffs(titles[0]) == {"title": ("Braille slate", "Braille slate and stylus")}
        removed = _events(db_session, org.organization_id, "collection_object", oid, "link_removed", "object_other_number")
        assert len(removed) == 1
        assert _diffs(removed[0])["number_value"] == ("LOT 7", None)
        assert db_session.query(ObjectTitle).filter_by(object_id=oid).count() == 1
        assert db_session.query(ObjectOtherNumber).filter_by(object_id=oid).count() == 1


# ---------------------------------------------------------------------------
# Workspace bulk field edits and audit-results bulk update
# ---------------------------------------------------------------------------


def _workspace(db, org, user, objs):
    ws = Workspace(organization_id=org.organization_id, owner_user_id=user.user_id, name="Batch", visibility="private")
    db.add(ws)
    db.flush()
    for i, o in enumerate(objs):
        db.add(WorkspaceItem(workspace_id=ws.workspace_id, object_id=o.object_id, added_by_user_id=user.user_id,
                             sort_order=i))
    db.commit()
    return ws


@patch("app.fastapi_app.serializers.collections_helpers._index_collection_object")
class TestWorkspaceBulkEdits:
    def test_set_object_status_records_each_object(self, _idx, auth_setup, db_session):
        client, org, user = auth_setup
        objs = [CollectionObject(organization_id=org.organization_id, object_number=f"WS.{i}", object_status="accessioned",
                                 extra_metadata={"source": "survey"}) for i in range(3)]
        db_session.add_all(objs)
        db_session.commit()
        ws = _workspace(db_session, org, user, objs)

        resp = _post(client, f"/api/organizations/{org.organization_id}/workspaces/{ws.workspace_id}/actions/set_object_status/execute",
                     {"action_params": {"object_status": "on_loan", "status_notes": "Gallery 2"}})
        assert resp.status_code == 200, resp.get_json()

        for o in objs:
            db_session.refresh(o)
            assert o.object_status == "on_loan"
            # The notes are saved (the metadata dict used to be edited in place and silently dropped).
            assert o.extra_metadata["status_change_notes"] == "Gallery 2"
            assert o.extra_metadata["source"] == "survey"
            ev = _events(db_session, org.organization_id, "collection_object", o.object_id, "updated")
            assert len(ev) == 1
            d = _diffs(ev[0])
            assert d["object_status"] == ("accessioned", "on_loan")
            assert d["extra_metadata"][0] == {"source": "survey"}
            assert d["extra_metadata"][1]["status_change_notes"] == "Gallery 2"
            assert ev[0].changed_by == user.user_id

    def test_set_loan_availability_records_metadata_change(self, _idx, auth_setup, db_session):
        client, org, user = auth_setup
        obj = CollectionObject(organization_id=org.organization_id, object_number="WS.LA", extra_metadata={"k": "v"})
        db_session.add(obj)
        db_session.commit()
        ws = _workspace(db_session, org, user, [obj])
        resp = _post(client, f"/api/organizations/{org.organization_id}/workspaces/{ws.workspace_id}/actions/set_loan_availability/execute",
                     {"action_params": {"loan_availability": "not_available"}})
        assert resp.status_code == 200, resp.get_json()
        db_session.refresh(obj)
        assert obj.extra_metadata == {"k": "v", "loan_availability": "not_available"}
        ev = _events(db_session, org.organization_id, "collection_object", obj.object_id, "updated")
        assert len(ev) == 1
        assert _diffs(ev[0])["extra_metadata"] == ({"k": "v"}, {"k": "v", "loan_availability": "not_available"})

    def test_bulk_movement_records_location_change(self, _idx, auth_setup, db_session):
        client, org, user = auth_setup
        a = Location(organization_id=org.organization_id, name="Store A", code="A", path="A", location_type="room", current_count=2)
        b = Location(organization_id=org.organization_id, name="Store B", code="B", path="B", location_type="room", current_count=0)
        db_session.add_all([a, b])
        db_session.flush()
        objs = [CollectionObject(organization_id=org.organization_id, object_number=f"MV.{i}",
                                 current_location_id=a.location_id) for i in range(2)]
        db_session.add_all(objs)
        db_session.commit()
        ws = _workspace(db_session, org, user, objs)
        resp = _post(client, f"/api/organizations/{org.organization_id}/workspaces/{ws.workspace_id}/actions/record_movement/execute",
                     {"action_params": {"to_location_id": str(b.location_id), "reason": "rearrangement"}})
        assert resp.status_code == 200, resp.get_json()
        for o in objs:
            ev = [e for e in _events(db_session, org.organization_id, "collection_object", o.object_id, "updated")
                  if "current_location_id" in (e.changed_fields or [])]
            assert len(ev) == 1
            assert _diffs(ev[0])["current_location_id"] == ("A", "B")
            assert ev[0].changed_by == user.user_id
            items = _history(client, org, "collection_object", o.object_id)
            assert any("current_location_id" in e["changed_fields"] for e in items)


@patch("app.fastapi_app.serializers.collections_helpers._index_collection_object")
class TestAuditResultsBulkUpdate:
    def test_execute_records_location_and_inventoried_on_history(self, _idx, auth_setup, db_session):
        client, org, user = auth_setup
        store = Location(organization_id=org.organization_id, name="Store B", code="B", path="B", location_type="room", current_count=2)
        offsite = Location(organization_id=org.organization_id, name="Offsite", code="OFF", path="OFF", location_type="room")
        db_session.add_all([store, offsite])
        db_session.flush()
        objs = [CollectionObject(organization_id=org.organization_id, object_number=f"AB.{i}",
                                 current_location_id=store.location_id) for i in range(2)]
        db_session.add_all(objs)
        camp = AuditCampaign(organization_id=org.organization_id, campaign_number="AUD-X", title="Check",
                             audit_type="location", status="in_progress", sample_method="complete",
                             target_locations=[str(store.location_id)])
        db_session.add(camp)
        db_session.commit()
        audits = f"{_base(org)}/audits/{camp.campaign_id}/check-list"
        items = _post(client, f"{audits}/generate", {}).get_json()["items"]
        by_num = {i["object_number"]: i for i in items}
        assert _put(client, f"{audits}/{by_num['AB.0']['result_id']}", {"outcome": "found"}).status_code == 200
        assert _put(client, f"{audits}/{by_num['AB.1']['result_id']}",
                    {"outcome": "wrong_location", "actual_location_id": str(offsite.location_id)}).status_code == 200

        resp = _post(client, f"{audits}/bulk-update/execute",
                     {"result_ids": [i["result_id"] for i in items], "update_location": True, "mark_inventoried": True})
        assert resp.status_code == 200, resp.get_json()

        found, moved = objs
        diffs_found = {}
        for e in _events(db_session, org.organization_id, "collection_object", found.object_id, "updated"):
            diffs_found.update(_diffs(e))
        assert diffs_found["last_inventoried_date"] == (None, date.today().isoformat())
        assert diffs_found["last_inventoried_by"][0] is None
        from app.models import User
        me = db_session.get(User, user.user_id)
        assert diffs_found["last_inventoried_by"][1] == (me.display_name or me.email)

        diffs_moved = {}
        for e in _events(db_session, org.organization_id, "collection_object", moved.object_id, "updated"):
            assert e.changed_by == user.user_id
            diffs_moved.update(_diffs(e))
        assert diffs_moved["current_location_id"] == ("B", "OFF")
        assert "last_inventoried_date" in diffs_moved
