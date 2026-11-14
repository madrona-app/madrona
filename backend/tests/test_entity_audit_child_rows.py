"""Audit trail for child rows and the newly tracked record types.

Child rows (an object's titles, measurements, other numbers, inscriptions,
media links and flags; a bib record's holdings and items; a research visit's
objects; an indemnity's objects; a policy's coverages) are recorded as
link_added / link_removed / link_updated events on the parent record, with
child_entity_type / child_entity_id identifying the row. Bib records, research
visits, insurance policies, indemnity arrangements and claims are tracked as
records in their own right (created / updated / deleted).
"""
import json
import uuid
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest

from app import context as ctx
from app.models import (
    BibHolding,
    BibItem,
    BibRecord,
    CollectionObject,
    CollectionObjectMedia,
    EntityAuditEvent,
    IndemnityArrangement,
    IndemnityObject,
    InsuranceClaim,
    InsuranceCoverage,
    InsurancePolicy,
    Media,
    ObjectFlag,
    RecordFlagDefinition,
    ResearchVisit,
    ResearchVisitObject,
)


def _objects_url(org):
    return f"/api/organizations/{org.organization_id}/collections/objects"


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


@pytest.fixture()
def acting_user(auth_setup):
    """Set the request actor for direct ORM writes (the API sets it from the token)."""
    _, org, user = auth_setup
    token = ctx.request_user_id.set(str(user.user_id))
    try:
        yield org, user
    finally:
        ctx.request_user_id.reset(token)


@pytest.fixture()
def obj(db_session, auth_setup):
    _, org, _ = auth_setup
    o = CollectionObject(organization_id=org.organization_id, object_number="AUD.1", object_name="Braille slate")
    db_session.add(o)
    db_session.commit()
    return o


# ---------------------------------------------------------------------------
# Object child rows through the object API (titles, measurements, numbers,
# inscriptions) — the path staff actually use.
# ---------------------------------------------------------------------------


@patch("app.fastapi_app.routers.collections_objects._index_collection_object")
class TestObjectChildRowsViaApi:
    def _create(self, client, org, **extra):
        payload = {"object_number": "AUD.API", "object_name": "Slate", **extra}
        resp = client.post(_objects_url(org), data=json.dumps(payload), content_type="application/json")
        assert resp.status_code == 201, resp.get_json()
        return uuid.UUID(resp.get_json()["object_id"])

    def _put(self, client, org, oid, payload):
        resp = client.put(f"{_objects_url(org)}/{oid}", data=json.dumps(payload), content_type="application/json")
        assert resp.status_code == 200, resp.get_json()

    def test_measurement_create_update_delete(self, _idx, auth_setup, db_session):
        client, org, user = auth_setup
        oid = self._create(client, org, measurements=[{"dimension": "height", "value": 10, "unit": "cm"}])

        added = _events(db_session, org.organization_id, "collection_object", oid, "link_added", "object_measurement")
        assert len(added) == 1
        assert added[0].child_display_key == "height"
        assert added[0].child_entity_id is not None
        assert _diffs(added[0])["measurement"] == (None, "10 cm")
        assert added[0].changed_by == user.user_id
        assert added[0].changed_by_email == user.email

        self._put(client, org, oid, {"measurements": [{"dimension": "height", "value": 12, "unit": "cm"}]})
        updated = _events(db_session, org.organization_id, "collection_object", oid, "link_updated", "object_measurement")
        assert len(updated) == 1
        ev = updated[0]
        assert ev.child_entity_id == added[0].child_entity_id  # same row, edited in place
        assert _diffs(ev) == {"measurement": ("10 cm", "12 cm")}
        assert ev.summary == "Updated measurement: height"
        assert ev.changed_by == user.user_id
        # No remove/add churn for an in-place edit.
        assert _events(db_session, org.organization_id, "collection_object", oid, "link_removed") == []

        self._put(client, org, oid, {"measurements": []})
        removed = _events(db_session, org.organization_id, "collection_object", oid, "link_removed", "object_measurement")
        assert len(removed) == 1
        assert _diffs(removed[0])["measurement"] == ("12 cm", None)
        assert removed[0].child_display_key == "height"

    def test_unchanged_save_records_nothing(self, _idx, auth_setup, db_session):
        client, org, _ = auth_setup
        rows = {
            "titles": [{"title": "Slate and stylus", "title_type": "primary"}],
            "measurements": [{"dimension": "width", "value": 5.5, "unit": "cm"}],
            "other_numbers": [{"type": "accession", "value": "1990.4"}],
            "inscriptions": [{"content": "Made in Louisville"}],
        }
        oid = self._create(client, org, **rows)
        before = len(_events(db_session, org.organization_id, "collection_object", oid))
        self._put(client, org, oid, rows)
        after = _events(db_session, org.organization_id, "collection_object", oid)
        assert len(after) == before

    def test_title_number_inscription_round_trip(self, _idx, auth_setup, db_session):
        client, org, user = auth_setup
        oid = self._create(
            client, org,
            titles=[{"title": "Slate", "title_type": "primary"}],
            other_numbers=[{"type": "accession", "value": "1990.4"}],
            inscriptions=[{"content": "APH", "location_on_object": "back"}],
        )
        org_id = org.organization_id
        for child in ("object_title", "object_other_number", "object_inscription"):
            assert len(_events(db_session, org_id, "collection_object", oid, "link_added", child)) == 1

        self._put(client, org, oid, {
            "titles": [{"title": "Slate and stylus", "title_type": "primary"}],
            "other_numbers": [{"type": "accession", "value": "1990.4.1"}],
            "inscriptions": [{"content": "APH 1923", "location_on_object": "back"}],
        })
        t = _events(db_session, org_id, "collection_object", oid, "link_updated", "object_title")
        assert len(t) == 1 and _diffs(t[0]) == {"title": ("Slate", "Slate and stylus")}
        n = _events(db_session, org_id, "collection_object", oid, "link_updated", "object_other_number")
        assert len(n) == 1 and _diffs(n[0]) == {"number_value": ("1990.4", "1990.4.1")}
        assert n[0].child_display_key == "accession"
        i = _events(db_session, org_id, "collection_object", oid, "link_updated", "object_inscription")
        assert len(i) == 1 and _diffs(i[0]) == {"content": ("APH", "APH 1923")}
        assert all(e.changed_by == user.user_id for e in t + n + i)

        self._put(client, org, oid, {"titles": [], "other_numbers": [], "inscriptions": []})
        for child in ("object_title", "object_other_number", "object_inscription"):
            assert len(_events(db_session, org_id, "collection_object", oid, "link_removed", child)) == 1

    def test_history_endpoint_returns_child_fields(self, _idx, auth_setup, db_session):
        client, org, _ = auth_setup
        oid = self._create(client, org, measurements=[{"dimension": "height", "value": 10, "unit": "cm"}])
        self._put(client, org, oid, {"measurements": [{"dimension": "height", "value": 12, "unit": "cm"}]})
        resp = client.get(f"/api/organizations/{org.organization_id}/entity-history/collection_object/{oid}")
        assert resp.status_code == 200, resp.get_json()
        items = resp.get_json()["items"]
        upd = [e for e in items if e["change_type"] == "link_updated" and e["child_entity_type"] == "object_measurement"]
        assert len(upd) == 1
        assert upd[0]["child_entity_type"] == "object_measurement"
        assert upd[0]["child_display_key"] == "height"
        assert upd[0]["field_diffs"] == [{"field_name": "measurement", "old_value": "10 cm", "new_value": "12 cm"}]


# ---------------------------------------------------------------------------
# Object media links and flags (ORM writes; the routers use the same ORM path)
# ---------------------------------------------------------------------------


class TestObjectMediaAndFlags:
    def test_media_link_create_update_delete(self, db_session, acting_user, obj):
        org, user = acting_user
        media = Media(organization_id=org.organization_id, s3_key=f"orgs/{org.organization_id}/media/{uuid.uuid4().hex}.png",
                      filename="slate-front.png", file_size=10, mime_type="image/png", media_type="image")
        db_session.add(media)
        db_session.commit()

        link = CollectionObjectMedia(object_id=obj.object_id, media_id=media.media_id, usage_type="main")
        db_session.add(link)
        db_session.commit()
        # The link table has no organization_id: the org comes from the parent object.
        added = _events(db_session, org.organization_id, "collection_object", obj.object_id, "link_added", "collection_object_media")
        assert len(added) == 1
        assert added[0].child_entity_id == media.media_id
        assert added[0].child_display_key == "slate-front.png"
        assert added[0].summary == "Added media: slate-front.png"
        assert added[0].changed_by == user.user_id

        link.caption_override = "Front"
        db_session.commit()
        upd = _events(db_session, org.organization_id, "collection_object", obj.object_id, "link_updated", "collection_object_media")
        assert len(upd) == 1 and _diffs(upd[0]) == {"caption_override": (None, "Front")}

        db_session.delete(link)
        db_session.commit()
        rem = _events(db_session, org.organization_id, "collection_object", obj.object_id, "link_removed", "collection_object_media")
        assert len(rem) == 1
        assert _diffs(rem[0])["caption_override"] == ("Front", None)

    def test_flag_set_update_clear(self, db_session, acting_user, obj):
        org, user = acting_user
        flag = RecordFlagDefinition(organization_id=org.organization_id, key="needs_review", label="Needs review")
        db_session.add(flag)
        db_session.commit()

        row = ObjectFlag(object_id=obj.object_id, flag_id=flag.flag_id, organization_id=org.organization_id, source="manual")
        db_session.add(row)
        db_session.commit()
        added = _events(db_session, org.organization_id, "collection_object", obj.object_id, "link_added", "object_flag")
        assert len(added) == 1
        assert added[0].child_entity_id == flag.flag_id
        assert added[0].summary == "Added flag: Needs review"
        assert _diffs(added[0])["flag"] == (None, "Needs review")
        assert "set_at" not in _diffs(added[0])
        assert added[0].changed_by == user.user_id

        row.note = "Check the date"
        db_session.commit()
        upd = _events(db_session, org.organization_id, "collection_object", obj.object_id, "link_updated", "object_flag")
        assert len(upd) == 1 and _diffs(upd[0]) == {"note": (None, "Check the date")}

        db_session.delete(row)
        db_session.commit()
        rem = _events(db_session, org.organization_id, "collection_object", obj.object_id, "link_removed", "object_flag")
        assert len(rem) == 1
        assert _diffs(rem[0])["note"] == ("Check the date", None)
        assert rem[0].changed_fields and "note" in rem[0].changed_fields


# ---------------------------------------------------------------------------
# Library catalogue
# ---------------------------------------------------------------------------


class TestBibRecords:
    def test_record_holding_item_lifecycle(self, db_session, acting_user):
        org, user = acting_user
        org_id = org.organization_id
        rec = BibRecord(organization_id=org_id, title="Braille Monitor 1960")
        db_session.add(rec)
        db_session.commit()
        created = _events(db_session, org_id, "bib_record", rec.bib_record_id, "created")
        assert len(created) == 1 and created[0].changed_by == user.user_id
        assert _diffs(created[0])["title"] == (None, "Braille Monitor 1960")

        rec.publisher = "NFB"
        db_session.commit()
        upd = _events(db_session, org_id, "bib_record", rec.bib_record_id, "updated")
        assert len(upd) == 1 and _diffs(upd[0]) == {"publisher": (None, "NFB")}

        holding = BibHolding(organization_id=org_id, bib_record_id=rec.bib_record_id, call_number="HV1701 .B7")
        db_session.add(holding)
        db_session.commit()
        h_added = _events(db_session, org_id, "bib_record", rec.bib_record_id, "link_added", "bib_holding")
        assert len(h_added) == 1 and h_added[0].child_display_key == "HV1701 .B7"

        item = BibItem(organization_id=org_id, holding_id=holding.holding_id, barcode="B0001", copy_number="1")
        db_session.add(item)
        db_session.commit()
        # A holding's item is attributed to the bib record (grandparent).
        i_added = _events(db_session, org_id, "bib_record", rec.bib_record_id, "link_added", "bib_item")
        assert len(i_added) == 1
        assert i_added[0].child_entity_id == item.item_id
        assert _diffs(i_added[0])["barcode"] == (None, "B0001")

        item.status = "missing"
        db_session.commit()
        i_upd = _events(db_session, org_id, "bib_record", rec.bib_record_id, "link_updated", "bib_item")
        assert len(i_upd) == 1 and _diffs(i_upd[0]) == {"status": ("available", "missing")}

        db_session.delete(item)
        db_session.commit()
        i_rem = _events(db_session, org_id, "bib_record", rec.bib_record_id, "link_removed", "bib_item")
        assert len(i_rem) == 1 and _diffs(i_rem[0])["barcode"] == ("B0001", None)

        db_session.refresh(holding)
        holding.call_number = "HV1701 .B72"
        db_session.commit()
        h_upd = _events(db_session, org_id, "bib_record", rec.bib_record_id, "link_updated", "bib_holding")
        assert len(h_upd) == 1 and _diffs(h_upd[0]) == {"call_number": ("HV1701 .B7", "HV1701 .B72")}

        db_session.delete(holding)
        db_session.commit()
        assert len(_events(db_session, org_id, "bib_record", rec.bib_record_id, "link_removed", "bib_holding")) == 1

        rid = rec.bib_record_id
        db_session.delete(rec)
        db_session.commit()
        deleted = _events(db_session, org_id, "bib_record", rid, "deleted")
        assert len(deleted) == 1 and _diffs(deleted[0])["publisher"] == ("NFB", None)


# ---------------------------------------------------------------------------
# Research visits
# ---------------------------------------------------------------------------


class TestResearchVisits:
    def test_visit_and_visit_objects(self, db_session, acting_user, obj):
        org, user = acting_user
        org_id = org.organization_id
        visit = ResearchVisit(organization_id=org_id, researcher_name="Ada Reader", visit_date=date(2026, 11, 1))
        db_session.add(visit)
        db_session.commit()
        created = _events(db_session, org_id, "research_visit", visit.visit_id, "created")
        assert len(created) == 1 and created[0].entity_display_key == "Ada Reader"
        assert created[0].changed_by == user.user_id

        visit.research_topic = "Early braille periodicals"
        db_session.commit()
        upd = _events(db_session, org_id, "research_visit", visit.visit_id, "updated")
        assert len(upd) == 1 and _diffs(upd[0]) == {"research_topic": (None, "Early braille periodicals")}

        vo = ResearchVisitObject(visit_id=visit.visit_id, organization_id=org_id, object_id=obj.object_id)
        db_session.add(vo)
        db_session.commit()
        added = _events(db_session, org_id, "research_visit", visit.visit_id, "link_added", "research_visit_object")
        assert len(added) == 1 and added[0].summary == "Added object: AUD.1"

        vo.condition_on_return = "Good"
        db_session.commit()
        lu = _events(db_session, org_id, "research_visit", visit.visit_id, "link_updated", "research_visit_object")
        assert len(lu) == 1 and _diffs(lu[0]) == {"condition_on_return": (None, "Good")}

        db_session.delete(vo)
        db_session.commit()
        assert len(_events(db_session, org_id, "research_visit", visit.visit_id, "link_removed", "research_visit_object")) == 1

        vid = visit.visit_id
        db_session.delete(visit)
        db_session.commit()
        assert len(_events(db_session, org_id, "research_visit", vid, "deleted")) == 1


# ---------------------------------------------------------------------------
# Insurance and indemnity
# ---------------------------------------------------------------------------


class TestInsuranceRecords:
    def test_policy_and_coverage(self, db_session, acting_user, obj):
        org, user = acting_user
        org_id = org.organization_id
        policy = InsurancePolicy(organization_id=org_id, policy_number="FA-100",
                                 effective_date=date(2026, 1, 1), expiration_date=date(2026, 12, 31))
        db_session.add(policy)
        db_session.commit()
        created = _events(db_session, org_id, "insurance", policy.policy_id, "created")
        assert len(created) == 1 and created[0].entity_display_key == "FA-100"
        assert created[0].changed_by == user.user_id

        policy.provider_name = "Lloyd's"
        db_session.commit()
        upd = _events(db_session, org_id, "insurance", policy.policy_id, "updated")
        assert len(upd) == 1 and _diffs(upd[0]) == {"provider_name": (None, "Lloyd's")}

        cov = InsuranceCoverage(organization_id=org_id, policy_id=policy.policy_id,
                                covered_entity_type="collection_object", covered_entity_id=obj.object_id)
        db_session.add(cov)
        db_session.commit()
        assert len(_events(db_session, org_id, "insurance", policy.policy_id, "link_added", "insurance_coverage")) == 1

        cov.declared_value = Decimal("5000.00")
        db_session.commit()
        cu = _events(db_session, org_id, "insurance", policy.policy_id, "link_updated", "insurance_coverage")
        assert len(cu) == 1 and _diffs(cu[0])["declared_value"][1] == "5000.00"

        db_session.delete(cov)
        db_session.commit()
        assert len(_events(db_session, org_id, "insurance", policy.policy_id, "link_removed", "insurance_coverage")) == 1

        pid = policy.policy_id
        db_session.delete(policy)
        db_session.commit()
        assert len(_events(db_session, org_id, "insurance", pid, "deleted")) == 1

    def test_indemnity_and_objects(self, db_session, acting_user, obj):
        org, user = acting_user
        org_id = org.organization_id
        ind = IndemnityArrangement(organization_id=org_id, program="us_arts", reference_number="AAI-7")
        db_session.add(ind)
        db_session.commit()
        created = _events(db_session, org_id, "indemnity_arrangement", ind.indemnity_id, "created")
        assert len(created) == 1 and created[0].changed_by == user.user_id

        db_session.refresh(ind)
        ind.reference_number = "AAI-8"
        db_session.commit()
        upd = _events(db_session, org_id, "indemnity_arrangement", ind.indemnity_id, "updated")
        assert len(upd) == 1 and _diffs(upd[0]) == {"reference_number": ("AAI-7", "AAI-8")}

        # indemnity_objects has no organization_id: the org comes from the arrangement.
        io = IndemnityObject(indemnity_id=ind.indemnity_id, object_id=obj.object_id, object_number="AUD.1")
        db_session.add(io)
        db_session.commit()
        added = _events(db_session, org_id, "indemnity_arrangement", ind.indemnity_id, "link_added", "indemnity_object")
        assert len(added) == 1 and added[0].child_entity_id == io.link_id

        io.approved_value = Decimal("2500.00")
        db_session.commit()
        lu = _events(db_session, org_id, "indemnity_arrangement", ind.indemnity_id, "link_updated", "indemnity_object")
        assert len(lu) == 1 and _diffs(lu[0])["approved_value"] == (None, "2500.00")

        db_session.delete(io)
        db_session.commit()
        assert len(_events(db_session, org_id, "indemnity_arrangement", ind.indemnity_id, "link_removed", "indemnity_object")) == 1

    def test_claim_lifecycle(self, db_session, acting_user):
        org, user = acting_user
        org_id = org.organization_id
        claim = InsuranceClaim(organization_id=org_id, claim_number="CL-1")
        db_session.add(claim)
        db_session.commit()
        assert len(_events(db_session, org_id, "insurance_claim", claim.claim_id, "created")) == 1

        claim.loss_description = "Water damage"
        db_session.commit()
        upd = _events(db_session, org_id, "insurance_claim", claim.claim_id, "updated")
        assert len(upd) == 1 and _diffs(upd[0]) == {"loss_description": (None, "Water damage")}
        assert upd[0].changed_by == user.user_id

        cid = claim.claim_id
        db_session.delete(claim)
        db_session.commit()
        assert len(_events(db_session, org_id, "insurance_claim", cid, "deleted")) == 1


# ---------------------------------------------------------------------------
# Org scoping of the history endpoint
# ---------------------------------------------------------------------------


@patch("app.fastapi_app.routers.collections_objects._index_collection_object")
class TestHistoryScoping:
    def test_new_entity_types_accepted(self, _idx, auth_setup, db_session):
        from app.models import Role
        from tests.conftest import _create_permission, _create_role_permission

        client, org, _ = auth_setup
        role = db_session.query(Role).filter(Role.role_key == "admin").first()
        for key in ("insurance.view", "use_requests.view"):
            _create_role_permission(db_session, role, _create_permission(db_session, key))
        db_session.commit()
        for et in ("bib_record", "research_visit", "insurance", "indemnity_arrangement", "insurance_claim"):
            resp = client.get(f"/api/organizations/{org.organization_id}/entity-history/{et}/{uuid.uuid4()}")
            assert resp.status_code == 200, (et, resp.status_code, resp.get_json())
            assert resp.get_json()["items"] == []

    def test_history_needs_the_area_permission(self, _idx, auth_setup):
        client, org, _ = auth_setup
        # The test admin role has no insurance.view permission.
        resp = client.get(f"/api/organizations/{org.organization_id}/entity-history/insurance/{uuid.uuid4()}")
        assert resp.status_code == 403

    def test_child_events_stay_in_their_org(self, _idx, auth_setup, db_session):
        client, org, _ = auth_setup
        resp = client.post(_objects_url(org), data=json.dumps({
            "object_number": "AUD.ORG", "object_name": "x",
            "measurements": [{"dimension": "height", "value": 1, "unit": "cm"}],
        }), content_type="application/json")
        oid = resp.get_json()["object_id"]
        other_org = uuid.uuid4()
        rows = db_session.query(EntityAuditEvent).filter(EntityAuditEvent.entity_id == uuid.UUID(oid)).all()
        assert rows and all(r.organization_id == org.organization_id for r in rows)
        assert all(d.organization_id == org.organization_id for r in rows for d in r.field_diffs)
        resp = client.get(f"/api/organizations/{other_org}/entity-history/collection_object/{oid}")
        assert resp.status_code in (403, 404) or resp.get_json()["items"] == []


# ---------------------------------------------------------------------------
# Under enforced RLS (NOBYPASSRLS app role): audit rows written by a real
# request pass the org policy, and stay invisible to another organization.
# ---------------------------------------------------------------------------


class TestAuditUnderRls:
    @pytest.fixture
    def tenants(self, rls_db_session):
        from sqlalchemy import text

        from app.models import Role
        from tests.conftest import _RLS_TEST_ROLE, _create_permission, _create_role_permission
        from tests.test_research_visits_rls import _seed

        connection = rls_db_session.connection()
        connection.execute(text("RESET ROLE"))
        try:
            out = []
            for name in ("Alpha", "Beta"):
                slug = f"{name.lower()}-{uuid.uuid4().hex[:8]}"
                out.append(_seed(rls_db_session, name=name, slug=slug))
                # The history endpoint also requires data.view.
                role = rls_db_session.query(Role).filter(Role.role_key == f"rv-{slug}").one()
                _create_role_permission(rls_db_session, role, _create_permission(rls_db_session, "data.view"))
            alpha, beta = out
            rls_db_session.commit()
        finally:
            connection.execute(text(f"SET ROLE {_RLS_TEST_ROLE}"))
        return alpha, beta

    def test_visit_and_child_events_written_and_isolated(self, rls_client, rls_db_session, tenants):
        from sqlalchemy import text

        from tests.conftest import _RLS_TEST_ROLE, AuthenticatedClient

        alpha, beta = tenants
        as_alpha = AuthenticatedClient(rls_client, alpha.token)
        as_beta = AuthenticatedClient(rls_client, beta.token)
        base = f"/api/organizations/{alpha.org_id}/collections/research-visits/{alpha.visit_id}"
        r = as_alpha.patch(base, json={"location": "Reading room 2"})
        assert r.status_code == 200, r.text[:300]
        r = as_alpha.delete(f"{base}/objects/{alpha.object_id}")
        assert r.status_code in (200, 204), r.text[:300]

        hist = as_alpha.get(f"/api/organizations/{alpha.org_id}/entity-history/research_visit/{alpha.visit_id}")
        assert hist.status_code == 200, hist.text[:300]
        items = hist.get_json()["items"]
        kinds = {(e["change_type"], e["child_entity_type"]) for e in items}
        assert ("updated", None) in kinds
        assert ("link_removed", "research_visit_object") in kinds
        upd = next(e for e in items if e["change_type"] == "updated")
        assert upd["changed_by_email"].startswith("registrar@alpha-")

        # Beta cannot read Alpha's history, through its own org or Alpha's.
        r = as_beta.get(f"/api/organizations/{beta.org_id}/entity-history/research_visit/{alpha.visit_id}")
        assert r.status_code == 200 and r.get_json()["items"] == []
        r = as_beta.get(f"/api/organizations/{alpha.org_id}/entity-history/research_visit/{alpha.visit_id}")
        assert r.status_code in (403, 404)

        # At the SQL level the app role scoped to Beta sees none of Alpha's rows.
        rls_db_session.execute(text("SELECT set_config('app.current_org_id', :o, true)"), {"o": str(beta.org_id)})
        assert rls_db_session.execute(
            text("SELECT count(*) FROM entity_audit_events WHERE entity_id = :id"), {"id": str(alpha.visit_id)}
        ).scalar() == 0
        rls_db_session.execute(text("RESET ROLE"))
        try:
            assert rls_db_session.execute(
                text("SELECT count(*) FROM entity_audit_events WHERE entity_id = :id AND organization_id = :o"),
                {"id": str(alpha.visit_id), "o": str(alpha.org_id)},
            ).scalar() >= 2
        finally:
            rls_db_session.execute(text(f"SET ROLE {_RLS_TEST_ROLE}"))
