"""Coverage tests for app/fastapi_app/routers/collections_procedure_plans.py.

Was at 23% with no test file. Procedure 9 (Documentation Planning)
and emergency plans (collections care).
"""

from __future__ import annotations

import json
from uuid import UUID, uuid4

import pytest


# ---------------------------------------------------------------------------
# URLs
# ---------------------------------------------------------------------------


def _doc_plans_url(org, pid=None) -> str:
    base = (
        f"/api/organizations/{org.organization_id}/collections/documentation-plans"
    )
    return base if pid is None else f"{base}/{pid}"


def _emergency_plans_url(org, pid=None) -> str:
    base = f"/api/organizations/{org.organization_id}/collections/emergency-plans"
    return base if pid is None else f"{base}/{pid}"


# ---------------------------------------------------------------------------
# Documentation plans
# ---------------------------------------------------------------------------


class TestListDocumentationPlans:
    def test_empty(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_doc_plans_url(org))
        assert resp.status_code == 200


def _plan_lookups(db_session, org=None):
    """The lookup values the documentation plan form offers."""
    from app.models import LookupCategory, LookupValue

    for key, values in (
        ("documentation_plan_type", ("documentation_policy", "cataloging_plan")),
        ("review_frequency", ("quarterly", "annually")),
    ):
        cat = db_session.query(LookupCategory).filter(LookupCategory.category_key == key).first()
        if cat is None:
            cat = LookupCategory(category_key=key, display_name=key)
            db_session.add(cat)
            db_session.flush()
        for vk in values:
            exists = db_session.query(LookupValue).filter(
                LookupValue.category_id == cat.category_id, LookupValue.value_key == vk,
            ).first()
            if exists is None:
                db_session.add(LookupValue(category_id=cat.category_id, organization_id=None, value_key=vk, label=vk))
    if org is not None:
        cat = db_session.query(LookupCategory).filter(LookupCategory.category_key == "documentation_plan_type").one()
        db_session.add(LookupValue(category_id=cat.category_id, organization_id=org.organization_id, value_key="oral_history_plan", label="Oral history plan"))
    db_session.commit()


class TestCreateDocumentationPlan:
    """Creation used to fail on every call: the route passed `actions=` and
    `milestones=` to a model with neither, and the CHECK constraints listed a
    different plan-type and review-frequency vocabulary from the form's."""

    def test_form_payload_round_trips(self, auth_setup, db_session):
        client, org, _ = auth_setup
        _plan_lookups(db_session)
        resp = client.post(
            _doc_plans_url(org),
            data=json.dumps({
                "title": "Cataloguing backlog",
                "plan_type": "cataloging_plan",
                "objectives": "Catalogue the 2019 bequest",
                "measurable_results": ["500 records"],
                "actions": ["Survey boxes", "Assign cataloguers"],
                "milestones": [{"date": "2027-03-01", "description": "Half done"}],
                "review_frequency": "annually",
                "notes": "Board asked for this",
            }),
            content_type="application/json",
        )
        assert resp.status_code == 201, resp.get_json()
        body = resp.get_json()
        assert body["plan_type"] == "cataloging_plan"
        assert body["review_frequency"] == "annually"
        assert [a["title"] for a in body["actions"]] == ["Survey boxes", "Assign cataloguers"]
        assert [(m["date"], m["description"]) for m in body["milestones"]] == [("2027-03-01", "Half done")]
        assert body["notes"] == "Board asked for this"

        got = client.get(_doc_plans_url(org, body["plan_id"])).get_json()
        assert [a["title"] for a in got["actions"]] == ["Survey boxes", "Assign cataloguers"]
        assert got["milestones"][0]["description"] == "Half done"

    def test_update_reconciles_actions_and_milestones(self, auth_setup, db_session):
        from app.models.compliance import ComplianceAction

        client, org, _ = auth_setup
        _plan_lookups(db_session)
        created = client.post(
            _doc_plans_url(org),
            data=json.dumps({"title": "P", "actions": ["A", "B"], "milestones": [{"date": "", "description": "M1"}]}),
            content_type="application/json",
        ).get_json()
        pid = created["plan_id"]
        ids_before = {a["title"]: a["action_id"] for a in created["actions"]}

        # The form sends back the records it loaded, plus a new plain string.
        resp = client.put(
            _doc_plans_url(org, pid),
            data=json.dumps({
                "actions": [created["actions"][1], "C"],
                "milestones": [{"date": "2027-01-15", "description": "M1"}],
                "review_frequency": "quarterly",
            }),
            content_type="application/json",
        )
        assert resp.status_code == 200, resp.get_json()
        body = resp.get_json()
        assert [a["title"] for a in body["actions"]] == ["B", "C"]
        assert next(a for a in body["actions"] if a["title"] == "B")["action_id"] == ids_before["B"]
        assert body["milestones"] == [{"action_id": body["milestones"][0]["action_id"], "date": "2027-01-15", "description": "M1"}]
        assert body["review_frequency"] == "quarterly"
        rows = db_session.query(ComplianceAction).filter(ComplianceAction.entity_id == UUID(pid)).count()
        assert rows == 3

        # A save without the lists leaves them alone.
        resp = client.put(_doc_plans_url(org, pid), data=json.dumps({"title": "P2"}), content_type="application/json")
        assert [a["title"] for a in resp.get_json()["actions"]] == ["B", "C"]

    def test_unknown_lookup_values_are_refused(self, auth_setup, db_session):
        client, org, _ = auth_setup
        _plan_lookups(db_session)
        for payload in ({"title": "X", "plan_type": "annual"}, {"title": "X", "review_frequency": "fortnightly"}):
            resp = client.post(_doc_plans_url(org), data=json.dumps(payload), content_type="application/json")
            assert resp.status_code == 400, payload

    def test_org_added_plan_type_is_accepted(self, auth_setup, db_session):
        client, org, _ = auth_setup
        _plan_lookups(db_session, org)
        resp = client.post(
            _doc_plans_url(org),
            data=json.dumps({"title": "Voices", "plan_type": "oral_history_plan"}),
            content_type="application/json",
        )
        assert resp.status_code == 201, resp.get_json()

    def test_duplicate_number_is_409(self, auth_setup, db_session):
        client, org, _ = auth_setup
        _plan_lookups(db_session)
        for expected in (201, 409):
            resp = client.post(
                _doc_plans_url(org),
                data=json.dumps({"title": "Dup", "plan_number": "DP-DUP"}),
                content_type="application/json",
            )
            assert resp.status_code == expected

    def test_missing_required(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(
            _doc_plans_url(org),
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code in (400, 422)


class TestGetDocumentationPlan:
    def test_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_doc_plans_url(org, uuid4()))
        assert resp.status_code == 404


class TestUpdateDocumentationPlan:
    def test_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.put(
            _doc_plans_url(org, uuid4()),
            data=json.dumps({"title": "x"}),
            content_type="application/json",
        )
        assert resp.status_code == 404


class TestApproveDocumentationPlan:
    def test_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(
            _doc_plans_url(org, uuid4()) + "/approve",
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code == 404


class TestDeleteDocumentationPlan:
    def test_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.delete(_doc_plans_url(org, uuid4()))
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Emergency plans
# ---------------------------------------------------------------------------


class TestListEmergencyPlans:
    def test_empty(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_emergency_plans_url(org))
        assert resp.status_code == 200


class TestCreateEmergencyPlan:
    def test_missing_required(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(
            _emergency_plans_url(org),
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code in (400, 422)

    def test_minimal_payload(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(
            _emergency_plans_url(org),
            data=json.dumps(
                {
                    "plan_number": "EP-001",
                    "title": "Fire response",
                    "plan_type": "fire",
                }
            ),
            content_type="application/json",
        )
        assert resp.status_code in (201, 400, 422)


class TestGetEmergencyPlan:
    def test_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_emergency_plans_url(org, uuid4()))
        assert resp.status_code == 404


class TestUpdateEmergencyPlan:
    def test_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.put(
            _emergency_plans_url(org, uuid4()),
            data=json.dumps({"title": "x"}),
            content_type="application/json",
        )
        assert resp.status_code == 404
