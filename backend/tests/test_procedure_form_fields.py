"""Org-requirable fields are limited to fields the procedure's form can edit.

procedure_form_fields.json lists, per procedure, the record fields that have a
control on its staff form; the frontend test ProcedureFormFields.test.ts keeps
it equal to the forms. Only those fields can be added as required. A stored
requirement for a field that is no longer eligible is not enforced and is
reported to the settings page so an admin can remove it.
"""
from __future__ import annotations

from uuid import uuid4

import sqlalchemy as sa

from app.models import Acquisition, Constituent, Organization
from app.services import procedure_required_fields as prf


def _settings(client, org_id):
    resp = client.get(f"/api/organizations/{org_id}/settings/procedure-enforcement")
    assert resp.status_code == 200, resp.text
    return resp.json["procedures"]


def test_every_supported_procedure_has_a_form_field_list():
    lists = prf.form_fields()
    for proc in prf._entity_models():
        assert proc in lists, proc
        assert lists[proc], proc


def test_eligible_fields_all_have_a_form_control():
    lists = prf.form_fields()
    for proc in prf._entity_models():
        eligible = {f["field"] for f in prf.eligible_fields(proc)}
        assert eligible <= lists[proc], (proc, sorted(eligible - lists[proc]))
        assert eligible, proc


def test_form_columns_that_qualify_are_offered():
    """Every form field that is a plain, non-baseline column is offered, so
    a new control is requirable without touching the backend."""
    lists = prf.form_fields()
    for proc, model in prf._entity_models().items():
        mapper = sa.inspect(model)
        columns = {a.key: a.columns[0] for a in mapper.column_attrs}
        baseline = prf._baseline_field_set(proc)
        expected = {
            name for name in lists[proc]
            if name in columns
            and name not in baseline
            and name not in prf._EXCLUDED_FIELDS
            and not isinstance(columns[name].type, prf._EXCLUDED_TYPES)
            and not columns[name].primary_key
        }
        eligible = {f["field"] for f in prf.eligible_fields(proc)}
        assert eligible == expected, (proc, sorted(expected ^ eligible))


def test_fields_without_a_control_are_not_offered(auth_setup):
    client, org, _ = auth_setup
    # Workflow-set and system-linked columns with no form control.
    for proc, field in [
        ("acquisition", "completed_date"),
        ("loan_out", "loan_number"),
        ("conservation", "treatment_number"),
        ("object_exit", "reference_id"),
    ]:
        assert field not in {f["field"] for f in prf.eligible_fields(proc)}
        resp = client.post(
            f"/api/organizations/{org.organization_id}/settings/procedure-enforcement/{proc}/required-fields",
            json={"field": field},
        )
        assert resp.status_code == 422, (proc, field, resp.text)


def test_core_fields_with_new_controls_are_offered():
    offered = {proc: {f["field"] for f in prf.eligible_fields(proc)} for proc in prf._entity_models()}
    assert {"justification", "sale_date", "buyer_name"} <= offered["deaccession"]
    assert {"venue_id", "venue_name", "facility_report_note"} <= offered["loan_out"]
    assert {"expected_return_date", "insurance_value"} <= offered["object_exit"]
    assert {"treatment_place", "treatment_rationale"} <= offered["conservation"]
    assert {"authorization_id"} <= offered["acquisition"]


def test_stored_ineligible_field_is_ignored_and_listed(auth_setup, db_session):
    client, org, _ = auth_setup
    stored = db_session.get(Organization, org.organization_id)
    stored.procedure_required_fields = {"acquisition": ["credit_line", "completed_date"]}
    db_session.commit()

    acq = _settings(client, org.organization_id)["acquisition"]
    assert acq["org_required_fields"] == [{"field": "credit_line", "label": "Credit line"}]
    assert acq["ignored_required_fields"] == [{"field": "completed_date", "label": "Completed date"}]

    # Not enforced: only the eligible field blocks a status change.
    client.put(
        f"/api/organizations/{org.organization_id}/settings/procedure-enforcement",
        json={"acquisition": True},
    )
    source = Constituent(organization_id=org.organization_id, constituent_type="person", name="Donor")
    db_session.add(source)
    db_session.flush()
    rec = Acquisition(
        organization_id=org.organization_id, acquisition_number=f"ACQ-{uuid4().hex[:6]}",
        acquisition_method="gift", source_id=source.constituent_id, status="proposed",
    )
    db_session.add(rec)
    db_session.commit()
    url = f"/api/organizations/{org.organization_id}/collections/acquisitions/{rec.acquisition_id}"
    resp = client.put(url, json={"status": "approved"})
    assert resp.status_code == 422
    assert resp.json["error"]["details"]["missing_fields"].count("completed_date") == 0
    assert "credit_line" in resp.json["error"]["details"]["missing_fields"]

    # The admin can remove it.
    resp = client.delete(
        f"/api/organizations/{org.organization_id}/settings/procedure-enforcement/acquisition/required-fields/completed_date"
    )
    assert resp.status_code == 200, resp.text
    assert resp.json["ignored_required_fields"] == []


def test_new_form_fields_round_trip(auth_setup, db_session):
    """Fields that gained a control are saved and returned to the form."""
    from datetime import date

    from app.models import CollectionObject, ConservationTreatment, Deaccession, LoanOut, ObjectEntry

    client, org, _ = auth_setup
    oid = org.organization_id
    venue = Constituent(organization_id=oid, constituent_type="organization", name="Hall")
    obj = CollectionObject(organization_id=oid, object_number="RT-1", object_name="Jar")
    db_session.add_all([venue, obj])
    db_session.flush()
    loan = LoanOut(organization_id=oid, loan_number="LO-RT", loan_purpose="exhibition",
                   status="requested", request_date=date.today())
    entry = ObjectEntry(organization_id=oid, entry_number="EN-RT", entry_date=date.today(),
                        entry_reason="loan_consideration", status="pending")
    treat = ConservationTreatment(organization_id=oid, treatment_number="CT-RT", object_id=obj.object_id,
                                  treatment_type="remedial", status="proposed")
    deacc = Deaccession(organization_id=oid, deaccession_number="DE-RT", object_id=obj.object_id,
                        proposal_date=date.today(), reason="outside_scope", status="proposed")
    db_session.add_all([loan, entry, treat, deacc])
    db_session.commit()

    cases = [
        (f"/api/organizations/{oid}/collections/loans-out/{loan.loan_out_id}", {
            "venue_id": str(venue.constituent_id), "facility_report_note": "Checked",
            "display_requirements": "Low light", "loan_agreement_date": "2026-11-01",
        }),
        (f"/api/organizations/{oid}/collections/entries/{entry.entry_id}", {
            "insurance_policy": "POL-1", "packing_note": "Crate", "special_conditions": "None",
            "depositor_requirements": "Return by May",
        }),
        (f"/api/organizations/{oid}/collections/conservation/{treat.treatment_id}", {
            "treatment_place": "Studio 2", "treatment_rationale": "Flaking", "future_care_instructions": "Dark",
            "insurance_value": 1200.0,
        }),
        (f"/api/organizations/{oid}/collections/deaccessions/{deacc.deaccession_id}", {
            "appraiser_id": str(venue.constituent_id), "justification": "Duplicate",
        }),
    ]
    for url, payload in cases:
        resp = client.put(url, json=payload)
        assert resp.status_code == 200, (url, resp.text)
        got = client.get(url).json
        for key, value in payload.items():
            assert got[key] == value, (url, key, got.get(key))
