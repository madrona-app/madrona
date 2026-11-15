"""Audit campaign fields the staff form edits survive a save.

Verification procedures and recommendations have columns and form controls
but were never returned, so each save from the form blanked them; remedial
actions came back as records, were edited as text, and the update dropped
whatever the form sent.
"""
import json
from uuid import UUID

from app.models.compliance import ComplianceAction


def _url(org, aid=None):
    base = f"/api/organizations/{org.organization_id}/collections/audits"
    return base if aid is None else f"{base}/{aid}"


def _create(client, org, **extra):
    resp = client.post(
        _url(org),
        data=json.dumps({"title": "Annual inventory", "audit_type": "location", **extra}),
        content_type="application/json",
    )
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()


def test_text_fields_round_trip(auth_setup):
    client, org, _ = auth_setup
    created = _create(client, org, verification_procedures="Two-person check", recommendations="Rehouse")
    assert created["verification_procedures"] == "Two-person check"
    assert created["recommendations"] == "Rehouse"

    resp = client.put(
        _url(org, created["audit_id"]),
        data=json.dumps({"verification_procedures": "Barcode scan", "recommendations": "Relabel"}),
        content_type="application/json",
    )
    assert resp.status_code == 200
    got = client.get(_url(org, created["audit_id"])).get_json()
    assert got["verification_procedures"] == "Barcode scan"
    assert got["recommendations"] == "Relabel"


def test_remedial_actions_one_per_line(auth_setup, db_session):
    client, org, _ = auth_setup
    created = _create(client, org, remedial_actions="Update locations\nReport missing items\n\n")
    assert [a["title"] for a in created["remedial_actions"]] == ["Update locations", "Report missing items"]
    keep_id = created["remedial_actions"][1]["action_id"]

    resp = client.put(
        _url(org, created["audit_id"]),
        data=json.dumps({"remedial_actions": "Report missing items\nRecheck shelf B"}),
        content_type="application/json",
    )
    assert resp.status_code == 200, resp.get_json()
    actions = resp.get_json()["remedial_actions"]
    assert [a["title"] for a in actions] == ["Report missing items", "Recheck shelf B"]
    assert actions[0]["action_id"] == keep_id
    rows = db_session.query(ComplianceAction).filter(
        ComplianceAction.entity_id == UUID(created["audit_id"]),
        ComplianceAction.action_type == "remedial",
    ).count()
    assert rows == 2

    # Records sent back as the API returned them are accepted too.
    resp = client.put(
        _url(org, created["audit_id"]),
        data=json.dumps({"remedial_actions": actions}),
        content_type="application/json",
    )
    assert [a["action_id"] for a in resp.get_json()["remedial_actions"]] == [a["action_id"] for a in actions]

    # Clearing the text clears the actions; omitting the key leaves them.
    client.put(_url(org, created["audit_id"]), data=json.dumps({"title": "Renamed"}), content_type="application/json")
    assert len(client.get(_url(org, created["audit_id"])).get_json()["remedial_actions"]) == 2
    resp = client.put(_url(org, created["audit_id"]), data=json.dumps({"remedial_actions": ""}), content_type="application/json")
    assert resp.get_json()["remedial_actions"] == []
