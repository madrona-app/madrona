"""Audit campaign check lists: sampling, generation, recording checks."""
from __future__ import annotations

import json
from collections import Counter
from uuid import uuid4

import pytest

from app.models import (
    AuditCampaign,
    AuditResult,
    BarcodeLabel,
    CollectionObject,
    Location,
    ObjectTitle,
)
from app.services.audit_checklist_service import (
    CheckListError,
    PopulationItem,
    _largest_remainder,
    draw_sample,
    target_count,
)


# ---------------------------------------------------------------------------
# Pure sampling
# ---------------------------------------------------------------------------


def _pop(n: int, locations: int = 4) -> list[PopulationItem]:
    locs = [uuid4() for _ in range(locations)]
    return [
        PopulationItem(uuid4(), f"OBJ.{i:04d}", locs[i % locations] if locations else None)
        for i in range(n)
    ]


class TestTargetCount:
    def test_size_wins_over_percentage(self):
        assert target_count(100, 7, 50.0) == 7

    def test_percentage_rounds_up(self):
        assert target_count(101, None, 10.0) == 11

    def test_capped_at_population(self):
        assert target_count(5, 50, None) == 5

    def test_requires_size_or_percentage(self):
        with pytest.raises(CheckListError):
            target_count(10, None, None)

    @pytest.mark.parametrize("size,pct", [(0, None), (-1, None), (None, 0.0), (None, 101.0)])
    def test_rejects_bad_values(self, size, pct):
        with pytest.raises(CheckListError):
            target_count(10, size, pct)


class TestDrawSample:
    def test_random_is_deterministic_for_a_seed(self):
        pop = _pop(500)
        a, _ = draw_sample(pop, "random", seed=42, sample_size=25)
        b, _ = draw_sample(pop, "random", seed=42, sample_size=25)
        c, _ = draw_sample(pop, "random", seed=43, sample_size=25)
        assert [p.object_id for p in a] == [p.object_id for p in b]
        assert [p.object_id for p in a] != [p.object_id for p in c]
        assert len(a) == 25 and len({p.object_id for p in a}) == 25

    def test_random_percentage(self):
        sel, details = draw_sample(_pop(200), "random", seed=1, sample_percentage=12.5)
        assert len(sel) == 25
        assert details == {"population_count": 200, "target_count": 25}

    def test_systematic_every_kth_from_random_start(self):
        pop = _pop(100)
        sel, details = draw_sample(pop, "systematic", seed=9, sample_size=10)
        assert details["interval"] == 10
        start = details["start_index"]
        assert 0 <= start < 10
        idx = [pop.index(p) for p in sel]
        assert idx == [start + 10 * i for i in range(10)]
        again, _ = draw_sample(pop, "systematic", seed=9, sample_size=10)
        assert again == sel

    def test_systematic_uneven_interval_stays_in_range(self):
        pop = _pop(103)
        sel, details = draw_sample(pop, "systematic", seed=3, sample_size=10)
        assert len(sel) == 10 and details["interval"] == 10

    def test_stratified_allocates_by_location(self):
        # Locations with 50, 30, 20 objects; sample 10 -> 5, 3, 2.
        locs = [uuid4(), uuid4(), uuid4()]
        pop = (
            [PopulationItem(uuid4(), f"A.{i:03d}", locs[0]) for i in range(50)]
            + [PopulationItem(uuid4(), f"B.{i:03d}", locs[1]) for i in range(30)]
            + [PopulationItem(uuid4(), f"C.{i:03d}", locs[2]) for i in range(20)]
        )
        sel, details = draw_sample(pop, "stratified", seed=5, sample_size=10)
        per_loc = Counter(p.location_id for p in sel)
        assert per_loc == {locs[0]: 5, locs[1]: 3, locs[2]: 2}
        assert sum(s["selected"] for s in details["strata"]) == 10
        assert draw_sample(pop, "stratified", seed=5, sample_size=10)[0] == sel

    def test_stratified_includes_unlocated_stratum(self):
        loc = uuid4()
        pop = [PopulationItem(uuid4(), f"X.{i}", loc) for i in range(6)] + [
            PopulationItem(uuid4(), f"Y.{i}", None) for i in range(4)
        ]
        sel, details = draw_sample(pop, "stratified", seed=2, sample_size=5)
        assert len(sel) == 5
        assert details["strata"][-1]["location_id"] is None

    def test_largest_remainder_sums_exactly(self):
        assert sum(_largest_remainder(7, [3, 3, 3])) == 7
        assert _largest_remainder(0, [5, 5]) == [0, 0]

    @pytest.mark.parametrize("method", ["complete", "targeted"])
    def test_complete_and_targeted_take_everything(self, method):
        pop = _pop(12)
        sel, details = draw_sample(pop, method, seed=0)
        assert sel == pop and details["target_count"] == 12

    def test_unknown_method(self):
        with pytest.raises(CheckListError):
            draw_sample(_pop(3), "haphazard", seed=0)


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


def _audits(org, *parts) -> str:
    base = f"/api/organizations/{org.organization_id}/collections/audits"
    return "/".join([base, *[str(p) for p in parts]])


def _location(db, org, name, code, parent=None):
    loc = Location(
        organization_id=org.organization_id,
        name=name,
        code=code,
        location_type="room",
        path=f"{parent.path}/{code}" if parent else code,
        parent_id=parent.location_id if parent else None,
    )
    db.add(loc)
    db.flush()
    return loc


def _objects(db, org, prefix, count, location, object_type="painting"):
    out = []
    for i in range(count):
        obj = CollectionObject(
            organization_id=org.organization_id,
            object_number=f"{prefix}.{i:03d}",
            current_location_id=location.location_id if location else None,
            object_type=object_type,
        )
        db.add(obj)
        out.append(obj)
    db.flush()
    return out


def _campaign(db, org, **kw):
    camp = AuditCampaign(
        organization_id=org.organization_id,
        campaign_number=kw.pop("campaign_number", f"AUD-{uuid4().hex[:6]}"),
        title=kw.pop("title", "Spot check"),
        audit_type=kw.pop("audit_type", "spot_check"),
        status=kw.pop("status", "in_progress"),
        **kw,
    )
    db.add(camp)
    db.commit()
    return camp


@pytest.fixture
def store(db_session, auth_setup):
    client, org, user = auth_setup
    building = _location(db_session, org, "Main Building", "MAIN")
    room_a = _location(db_session, org, "Store A", "A", building)
    shelf = _location(db_session, org, "Shelf A1", "A1", room_a)
    room_b = _location(db_session, org, "Store B", "B", building)
    elsewhere = _location(db_session, org, "Offsite", "OFF")
    objs_a = _objects(db_session, org, "A", 6, room_a)
    objs_shelf = _objects(db_session, org, "S", 4, shelf, object_type="textile")
    objs_b = _objects(db_session, org, "B", 5, room_b)
    _objects(db_session, org, "O", 3, elsewhere)
    db_session.add(ObjectTitle(organization_id=org.organization_id, object_id=objs_a[0].object_id, title="Banner", is_preferred=True))
    db_session.commit()
    return {
        "client": client, "org": org, "user": user,
        "building": building, "room_a": room_a, "shelf": shelf, "room_b": room_b, "elsewhere": elsewhere,
        "objs_a": objs_a, "objs_shelf": objs_shelf, "objs_b": objs_b,
    }


def _generate(client, org, camp, **body):
    return client.post(_audits(org, camp.campaign_id, "check-list", "generate"), data=json.dumps(body), content_type="application/json")


def _record(client, org, camp, result_id, **body):
    return client.put(_audits(org, camp.campaign_id, "check-list", result_id), data=json.dumps(body), content_type="application/json")


class TestGenerate:
    def test_complete_scope_includes_child_locations(self, store, db_session):
        s = store
        camp = _campaign(db_session, s["org"], sample_method="complete",
                         target_locations=[{"location_id": str(s["room_a"].location_id)}])
        resp = _generate(s["client"], s["org"], camp)
        assert resp.status_code == 200, resp.get_json()
        body = resp.get_json()
        assert body["total"] == 10  # 6 in Store A + 4 on its shelf
        nums = [i["object_number"] for i in body["items"]]
        # Walking order: by location path (MAIN/A before MAIN/A/A1), then number.
        assert nums[:6] == [f"A.{i:03d}" for i in range(6)]
        assert [i["check_sequence"] for i in body["items"]] == list(range(1, 11))
        assert all(i["outcome"] == "pending" for i in body["items"])
        assert body["items"][0]["title"] == "Banner"
        assert body["items"][0]["expected_location_name"] == "Store A"
        assert body["seed"] is not None and body["generated_at"]
        assert body["params"]["population_count"] == 10
        db_session.refresh(camp)
        assert camp.objects_total == 10 and camp.locations_total == 2

    def test_include_children_false_and_object_type(self, store, db_session):
        s = store
        camp = _campaign(db_session, s["org"], sample_method="targeted",
                         target_locations=[{"location_id": str(s["building"].location_id), "include_children": True}],
                         target_object_types=["textile"])
        body = _generate(s["client"], s["org"], camp).get_json()
        assert {i["object_number"][0] for i in body["items"]} == {"S"}

        camp2 = _campaign(db_session, s["org"], sample_method="complete",
                          target_locations=[{"location_id": str(s["room_a"].location_id), "include_children": False}])
        assert _generate(s["client"], s["org"], camp2).get_json()["total"] == 6

    def test_random_sample_reproducible_from_seed(self, store, db_session):
        s = store
        camp = _campaign(db_session, s["org"], sample_method="random", sample_size=5)
        first = _generate(s["client"], s["org"], camp, seed=1234).get_json()
        assert first["total"] == 5 and first["seed"] == 1234
        assert first["params"]["population_count"] == 18
        again = _generate(s["client"], s["org"], camp, seed=1234, replace=True).get_json()
        assert [i["object_id"] for i in again["items"]] == [i["object_id"] for i in first["items"]]

    def test_stratified_and_systematic_via_api(self, store, db_session):
        s = store
        camp = _campaign(db_session, s["org"], sample_method="stratified", sample_percentage=50,
                         target_locations=[str(s["building"].location_id)])
        body = _generate(s["client"], s["org"], camp, seed=7).get_json()
        assert body["total"] == 8  # ceil(15 * 0.5)
        assert sum(x["selected"] for x in body["params"]["strata"]) == 8

        camp2 = _campaign(db_session, s["org"], sample_method="systematic", sample_size=6)
        body2 = _generate(s["client"], s["org"], camp2, seed=7).get_json()
        assert body2["total"] == 6 and body2["params"]["interval"] == 3

    def test_sampled_method_requires_size(self, store, db_session):
        s = store
        camp = _campaign(db_session, s["org"], sample_method="random")
        resp = _generate(s["client"], s["org"], camp)
        assert resp.status_code == 400
        assert resp.get_json()["error"]["code"] == "sample_size_required"

    def test_regenerate_needs_confirmation_then_refused_after_checks(self, store, db_session):
        s = store
        camp = _campaign(db_session, s["org"], sample_method="complete",
                         target_locations=[str(s["room_b"].location_id)])
        assert _generate(s["client"], s["org"], camp).status_code == 200

        resp = _generate(s["client"], s["org"], camp)
        assert resp.status_code == 409
        assert resp.get_json()["error"]["code"] == "check_list_exists"
        replaced = _generate(s["client"], s["org"], camp, replace=True)
        assert replaced.status_code == 200
        assert db_session.query(AuditResult).filter_by(campaign_id=camp.campaign_id).count() == 5

        rid = replaced.get_json()["items"][0]["result_id"]
        assert _record(s["client"], s["org"], camp, rid, outcome="found").status_code == 200
        resp = _generate(s["client"], s["org"], camp, replace=True)
        assert resp.status_code == 409
        assert resp.get_json()["error"]["code"] == "checks_started"

    def test_closed_campaign_refused(self, store, db_session):
        s = store
        camp = _campaign(db_session, s["org"], sample_method="complete", status="completed")
        assert _generate(s["client"], s["org"], camp).status_code == 409

    def test_put_cannot_overwrite_generation_record(self, store, db_session):
        s = store
        camp = _campaign(db_session, s["org"], sample_method="complete")
        seed = _generate(s["client"], s["org"], camp).get_json()["seed"]
        s["client"].put(_audits(s["org"], camp.campaign_id), data=json.dumps({"check_list_seed": 1}), content_type="application/json")
        db_session.refresh(camp)
        assert camp.check_list_seed == seed

    def test_other_org_campaign_404(self, store, db_session):
        s = store
        resp = _generate(s["client"], s["org"], type("C", (), {"campaign_id": uuid4()})())
        assert resp.status_code == 404


class TestRecordCheck:
    def test_outcomes_update_counters(self, store, db_session):
        s = store
        camp = _campaign(db_session, s["org"], sample_method="complete",
                         target_locations=[str(s["room_b"].location_id)])
        items = _generate(s["client"], s["org"], camp).get_json()["items"]
        c, org = s["client"], s["org"]

        r = _record(c, org, camp, items[0]["result_id"], outcome="found")
        assert r.status_code == 200 and r.get_json()["outcome"] == "found"
        r = _record(c, org, camp, items[1]["result_id"], outcome="not_found", note="Shelf empty")
        assert r.get_json()["outcome"] == "not_found" and r.get_json()["note"] == "Shelf empty"
        r = _record(c, org, camp, items[2]["result_id"], outcome="wrong_location")
        assert r.status_code == 400 and r.get_json()["error"]["code"] == "actual_location_required"
        r = _record(c, org, camp, items[2]["result_id"], outcome="wrong_location",
                    actual_location_id=str(s["elsewhere"].location_id))
        assert r.status_code == 200
        assert r.get_json()["actual_location_name"] == "Offsite"

        db_session.refresh(camp)
        assert camp.objects_audited == 3
        assert camp.objects_verified == 1
        assert camp.objects_not_found == 1
        assert camp.objects_location_discrepancy == 1
        assert camp.discrepancies_found == 2
        assert float(camp.accuracy_rate) == pytest.approx(33.33, abs=0.01)

        listing = c.get(_audits(org, camp.campaign_id, "check-list")).get_json()
        assert listing["checked"] == 3
        assert listing["counts"] == {"pending": 2, "found": 1, "not_found": 1, "wrong_location": 1, "other": 0}

        # Undo
        r = _record(c, org, camp, items[0]["result_id"], outcome="pending")
        assert r.get_json()["outcome"] == "pending"
        db_session.refresh(camp)
        assert camp.objects_audited == 2

        # The plain results listing works with check-list rows present.
        assert c.get(_audits(org, camp.campaign_id, "results")).status_code == 200

    def test_same_location_rejected_and_bad_outcome(self, store, db_session):
        s = store
        camp = _campaign(db_session, s["org"], sample_method="complete",
                         target_locations=[str(s["room_b"].location_id)])
        rid = _generate(s["client"], s["org"], camp).get_json()["items"][0]["result_id"]
        r = _record(s["client"], s["org"], camp, rid, outcome="wrong_location",
                    actual_location_id=str(s["room_b"].location_id))
        assert r.status_code == 400
        assert _record(s["client"], s["org"], camp, rid, outcome="lost").status_code == 400

    def test_barcode_scan_fills_check_list_row(self, store, db_session):
        s = store
        org = s["org"]
        camp = _campaign(db_session, org, sample_method="complete",
                         target_locations=[str(s["room_b"].location_id)])
        _generate(s["client"], org, camp)
        obj = s["objs_b"][0]
        db_session.add(BarcodeLabel(organization_id=org.organization_id, entity_type="collection_object",
                                    entity_id=obj.object_id, barcode_value="NFB-SCAN-1", label_format="code128",
                                    status="active"))
        db_session.commit()
        resp = s["client"].post(
            f"/api/organizations/{org.organization_id}/collections/barcodes/scan",
            data=json.dumps({"barcode_value": "NFB-SCAN-1", "action_type": "audit",
                             "campaign_id": str(camp.campaign_id),
                             "scan_location_id": str(s["elsewhere"].location_id)}),
            content_type="application/json",
        )
        assert resp.status_code in (200, 201), resp.get_json()
        rows = db_session.query(AuditResult).filter_by(campaign_id=camp.campaign_id, object_id=obj.object_id).all()
        assert len(rows) == 1
        assert rows[0].result_status == "discrepancy"
        assert rows[0].actual_location_id == s["elsewhere"].location_id
        db_session.refresh(camp)
        assert camp.objects_location_discrepancy == 1
