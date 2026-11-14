"""Org-configurable extra required fields per procedure.

An org admin adds fields on top of a procedure's fixed baseline; the merged
set is served by /api/procedure-requirements/{type} and enforced on status
transitions while enforcement is on.
"""

from __future__ import annotations

from uuid import uuid4

from app.models import Acquisition, Constituent, Organization


def _settings_url(org_id, proc="acquisition", field=None) -> str:
    base = f"/api/organizations/{org_id}/settings/procedure-enforcement/{proc}/required-fields"
    return base if field is None else f"{base}/{field}"


def _add(client, org_id, field, proc="acquisition"):
    return client.post(_settings_url(org_id, proc), json={"field": field})


class TestAddRemove:
    def test_add_then_remove(self, auth_setup, db_session):
        client, org, _ = auth_setup
        resp = _add(client, org.organization_id, "credit_line")
        assert resp.status_code == 201, resp.text
        body = resp.json
        assert body["org_required_fields"] == [{"field": "credit_line", "label": "Credit line"}]
        assert "credit_line" not in {f["field"] for f in body["eligible_fields"]}
        # Baseline is listed and untouched
        baseline_fields = {f for r in body["baseline_required_fields"] for f in r["fields"]}
        assert {"acquisition_method", "source_id"} <= baseline_fields

        stored = db_session.get(Organization, org.organization_id)
        db_session.refresh(stored)
        assert stored.procedure_required_fields == {"acquisition": ["credit_line"]}

        resp = client.delete(_settings_url(org.organization_id, field="credit_line"))
        assert resp.status_code == 200, resp.text
        assert resp.json["org_required_fields"] == []
        assert "credit_line" in {f["field"] for f in resp.json["eligible_fields"]}

    def test_settings_get_lists_baseline_added_and_eligible(self, auth_setup):
        client, org, _ = auth_setup
        _add(client, org.organization_id, "funding_source")
        resp = client.get(f"/api/organizations/{org.organization_id}/settings/procedure-enforcement")
        assert resp.status_code == 200
        acq = resp.json["procedures"]["acquisition"]
        assert acq["supports_org_required_fields"] is True
        assert acq["org_required_fields"] == [{"field": "funding_source", "label": "Funding source"}]
        assert any(r["label"] for r in acq["baseline_required_fields"])
        # Procedures without server-side enforcement do not offer extra fields
        assert resp.json["procedures"]["movement"]["supports_org_required_fields"] is False

    def test_rejects_unknown_field(self, auth_setup):
        client, org, _ = auth_setup
        resp = _add(client, org.organization_id, "not_a_column")
        assert resp.status_code == 422
        assert resp.json["error"]["code"] == "unknown_field"

    def test_rejects_system_and_boolean_fields(self, auth_setup):
        client, org, _ = auth_setup
        for field in ("organization_id", "status", "created_at", "provenance_verified", "acquisition_id"):
            resp = _add(client, org.organization_id, field)
            assert resp.status_code == 422, field

    def test_rejects_field_from_another_procedure(self, auth_setup):
        client, org, _ = auth_setup
        # venue_name exists on loan_out, not on acquisitions
        assert _add(client, org.organization_id, "venue_name").status_code == 422
        assert _add(client, org.organization_id, "venue_name", proc="loan_out").status_code == 201

    def test_rejects_baseline_field(self, auth_setup):
        client, org, _ = auth_setup
        resp = _add(client, org.organization_id, "acquisition_method")
        assert resp.status_code == 422
        assert resp.json["error"]["code"] == "already_baseline"

    def test_cannot_remove_baseline_field(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.delete(_settings_url(org.organization_id, field="acquisition_method"))
        assert resp.status_code == 422

    def test_duplicate_add_is_conflict(self, auth_setup):
        client, org, _ = auth_setup
        assert _add(client, org.organization_id, "credit_line").status_code == 201
        assert _add(client, org.organization_id, "credit_line").status_code == 409

    def test_unknown_and_unsupported_procedure(self, auth_setup):
        client, org, _ = auth_setup
        assert _add(client, org.organization_id, "x", proc="no_such_procedure").status_code == 404
        assert _add(client, org.organization_id, "location_id", proc="movement").status_code == 422

    def test_non_admin_forbidden(self, viewer_auth_setup):
        client, org, _ = viewer_auth_setup
        assert _add(client, org.organization_id, "credit_line").status_code == 403
        assert client.delete(_settings_url(org.organization_id, field="credit_line")).status_code == 403


class TestMergedRequirements:
    def test_merged_get_marks_baseline_and_org(self, auth_setup):
        client, org, _ = auth_setup
        _add(client, org.organization_id, "credit_line")
        resp = client.get(f"/api/procedure-requirements/acquisition?organization_id={org.organization_id}")
        assert resp.status_code == 200
        groups = resp.json["requirementGroups"]
        org_group = [g for g in groups if g["id"] == "org_required"]
        assert len(org_group) == 1
        reqs = org_group[0]["requirements"]
        assert reqs[0]["fieldPaths"] == ["credit_line"]
        assert reqs[0]["source"] == "org"
        assert reqs[0]["severity"] == "blocking"
        assert reqs[0]["requiredForStatuses"] == ["approved", "completed"]
        baseline_sources = {
            r["source"] for g in groups if g["id"] != "org_required" for r in g["requirements"]
        }
        assert baseline_sources == {"baseline"}
        assert resp.json["orgRequiredFields"] == [{"field": "credit_line", "label": "Credit line"}]

    def test_without_org_returns_baseline_only(self, auth_setup):
        client, org, _ = auth_setup
        _add(client, org.organization_id, "credit_line")
        resp = client.get("/api/procedure-requirements/acquisition")
        assert all(g["id"] != "org_required" for g in resp.json["requirementGroups"])

    def test_org_isolation(self, auth_setup, db_session):
        client, org, _ = auth_setup
        _add(client, org.organization_id, "credit_line")
        other = Organization(name="Other Museum", slug=f"other-{uuid4().hex[:8]}", status="active")
        db_session.add(other)
        db_session.commit()

        resp = client.get(f"/api/procedure-requirements/acquisition?organization_id={other.organization_id}")
        assert all(g["id"] != "org_required" for g in resp.json["requirementGroups"])
        assert resp.json["orgRequiredFields"] == []
        db_session.refresh(other)
        assert not (other.procedure_required_fields or {}).get("acquisition")


class TestEnforcement:
    def _seed_acquisition(self, db_session, org_id) -> Acquisition:
        source = Constituent(organization_id=org_id, constituent_type="person", name="Donor")
        db_session.add(source)
        db_session.flush()
        acq = Acquisition(
            organization_id=org_id,
            acquisition_number=f"ACQ-{uuid4().hex[:6]}",
            acquisition_method="gift",
            source_id=source.constituent_id,
            status="proposed",
        )
        db_session.add(acq)
        db_session.commit()
        return acq

    def _enable(self, client, org_id, enabled=True):
        resp = client.put(
            f"/api/organizations/{org_id}/settings/procedure-enforcement",
            json={"acquisition": enabled},
        )
        assert resp.status_code == 200

    def _advance(self, client, org_id, acq, **fields):
        return client.put(
            f"/api/organizations/{org_id}/collections/acquisitions/{acq.acquisition_id}",
            json={"status": "approved", **fields},
        )

    def test_blocks_transition_missing_added_field(self, auth_setup, db_session):
        client, org, _ = auth_setup
        acq = self._seed_acquisition(db_session, org.organization_id)
        self._enable(client, org.organization_id)
        _add(client, org.organization_id, "credit_line")

        resp = self._advance(client, org.organization_id, acq)
        assert resp.status_code == 422, resp.text
        assert resp.json["error"]["code"] == "procedure_requirements_not_met"
        assert "Credit line" in resp.json["error"]["blocking_requirements"]

        resp = self._advance(client, org.organization_id, acq, credit_line="Gift of the Donor, 2026")
        assert resp.status_code == 200, resp.text

    def test_added_field_not_enforced_when_enforcement_off(self, auth_setup, db_session):
        client, org, _ = auth_setup
        acq = self._seed_acquisition(db_session, org.organization_id)
        self._enable(client, org.organization_id, enabled=False)
        _add(client, org.organization_id, "credit_line")
        assert self._advance(client, org.organization_id, acq).status_code == 200

    def test_removed_field_no_longer_blocks(self, auth_setup, db_session):
        client, org, _ = auth_setup
        acq = self._seed_acquisition(db_session, org.organization_id)
        self._enable(client, org.organization_id)
        _add(client, org.organization_id, "credit_line")
        client.delete(_settings_url(org.organization_id, field="credit_line"))
        assert self._advance(client, org.organization_id, acq).status_code == 200


class TestConservationEnforcement:
    """Conservation status changes were checked under the key
    "conservation_treatment", which has no requirements or toggle, so they
    were never enforced; they now use "conservation" like the settings page."""

    def test_added_field_blocks_conservation_transition(self, auth_setup, db_session):
        from app.models import CollectionObject, ConservationTreatment

        client, org, user = auth_setup
        obj = CollectionObject(organization_id=org.organization_id, object_number="CT-1")
        db_session.add(obj)
        db_session.flush()
        treatment = ConservationTreatment(
            organization_id=org.organization_id,
            treatment_number=f"CT-{uuid4().hex[:6]}",
            object_id=obj.object_id,
            treatment_type="remedial",
            treatment_description="Surface clean and consolidate",
            approved_by=user.user_id,
            status="proposed",
        )
        db_session.add(treatment)
        db_session.commit()

        client.put(
            f"/api/organizations/{org.organization_id}/settings/procedure-enforcement",
            json={"conservation": True},
        )
        assert _add(client, org.organization_id, "treatment_place", proc="conservation").status_code == 201

        url = f"/api/organizations/{org.organization_id}/collections/conservation/{treatment.treatment_id}"
        resp = client.put(url, json={"status": "approved"})
        assert resp.status_code == 422, resp.text
        assert resp.json["error"]["blocking_requirements"] == ["Treatment place"]

        resp = client.put(url, json={"status": "approved", "treatment_place": "Studio 2"})
        assert resp.status_code == 200, resp.text
