"""
Coverage tests for the Insurance Management API.

Complements the existing ``test_api_insurance.py`` smoke suite by exercising
the branches that the smoke tests leave cold:

- Coverage + indemnity + claims list/get/update/delete paths
- Status-transition endpoints (policy approve, coverage confirm, indemnity
  submit, claim file, claim settle) in both happy-path and wrong-status
  failure modes
- Entity-scoped coverage lookups (objects / loans-in / loans-out / shipments)
- Indemnity object link + unlink with duplicate guard
- Filter query-params for list endpoints
- Cross-org isolation on get-one endpoints
- ``viewer_auth_setup`` authorization failure on writes

Routes under ``/api/organizations/<org_id>/collections/insurance/...``.
"""

import json
from datetime import date, timedelta
from uuid import uuid4

import pytest

from app.models import (
    CollectionObject,
    IndemnityArrangement,
    IndemnityObject,
    IndemnityProgram,
    IndemnityStatus,
    InsuranceClaim,
    InsuranceCoverage,
    InsurancePolicy,
    ClaimStatus,
    CoverageStatus,
    CoveredEntityType,
    LossType,
    Organization,
    PolicyStatus,
    PolicyType,
)


# ---------------------------------------------------------------------------
# URL helpers
# ---------------------------------------------------------------------------


def _base(org):
    return f"/api/organizations/{org.organization_id}/collections/insurance"


def _policies_url(org):
    return f"{_base(org)}/policies"


def _policy_url(org, policy_id):
    return f"{_policies_url(org)}/{policy_id}"


def _coverages_url(org):
    return f"{_base(org)}/coverages"


def _coverage_url(org, coverage_id):
    return f"{_coverages_url(org)}/{coverage_id}"


def _indemnities_url(org):
    return f"{_base(org)}/indemnities"


def _indemnity_url(org, indemnity_id):
    return f"{_indemnities_url(org)}/{indemnity_id}"


def _claims_url(org):
    return f"{_base(org)}/claims"


def _claim_url(org, claim_id):
    return f"{_claims_url(org)}/{claim_id}"


def _post(auth_client, url, data):
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _patch(auth_client, url, data):
    return auth_client.patch(url, data=json.dumps(data), content_type="application/json")


# ---------------------------------------------------------------------------
# Model factories
# ---------------------------------------------------------------------------


def _make_policy(db_session, org, **overrides):
    defaults = dict(
        organization_id=org.organization_id,
        policy_number=f"POL-{uuid4().hex[:8]}",
        policy_name="Cov Test Policy",
        policy_type=PolicyType.FINE_ARTS,
        provider_name="Acme Insurance",
        effective_date=date(2025, 1, 1),
        expiration_date=date(2026, 1, 1),
        status=PolicyStatus.ACTIVE,
    )
    defaults.update(overrides)
    policy = InsurancePolicy(**defaults)
    db_session.add(policy)
    db_session.commit()
    return policy


def _make_coverage(db_session, org, policy=None, **overrides):
    defaults = dict(
        organization_id=org.organization_id,
        covered_entity_type=CoveredEntityType.COLLECTION_OBJECT,
        covered_entity_id=uuid4(),
        declared_value=10_000,
        status=CoverageStatus.PENDING,
    )
    if policy is not None:
        defaults["policy_id"] = policy.policy_id
    defaults.update(overrides)
    coverage = InsuranceCoverage(**defaults)
    db_session.add(coverage)
    db_session.commit()
    return coverage


def _make_indemnity(db_session, org, **overrides):
    defaults = dict(
        organization_id=org.organization_id,
        program=IndemnityProgram.US_ARTS,
        internal_reference=f"IND-{uuid4().hex[:6]}",
        requested_coverage=500_000,
        status=IndemnityStatus.DRAFT,
    )
    defaults.update(overrides)
    indemnity = IndemnityArrangement(**defaults)
    db_session.add(indemnity)
    db_session.commit()
    return indemnity


def _make_claim(db_session, org, coverage=None, indemnity=None, **overrides):
    defaults = dict(
        organization_id=org.organization_id,
        claim_number=f"CLM-{uuid4().hex[:8]}",
        loss_description="Minor abrasion",
        loss_type=LossType.DAMAGE,
        claimed_amount=2500,
        status=ClaimStatus.DRAFT,
    )
    if coverage is not None:
        defaults["coverage_id"] = coverage.coverage_id
    if indemnity is not None:
        defaults["indemnity_id"] = indemnity.indemnity_id
    defaults.update(overrides)
    claim = InsuranceClaim(**defaults)
    db_session.add(claim)
    db_session.commit()
    return claim


def _make_object(db_session, org, object_number=None):
    obj = CollectionObject(
        organization_id=org.organization_id,
        object_number=object_number or f"OBJ-{uuid4().hex[:6]}",
        object_name="Test Object",
    )
    db_session.add(obj)
    db_session.commit()
    return obj


def _other_org(db_session, slug="other-insurance-org"):
    org = Organization(name="Other Insurance Org", slug=slug, is_demo=False, status="active")
    db_session.add(org)
    db_session.commit()
    return org


# ===========================================================================
# Policy — list filters, update edge cases, approve
# ===========================================================================


class TestListPoliciesFilters:
    def test_filter_by_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_policy(db_session, org, policy_number="POL-A", status=PolicyStatus.ACTIVE)
        _make_policy(db_session, org, policy_number="POL-D", status=PolicyStatus.DRAFT)

        resp = auth_client.get(f"{_policies_url(org)}?status=draft")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["policy_number"] == "POL-D"

    def test_filter_by_policy_type(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_policy(db_session, org, policy_number="POL-FA", policy_type=PolicyType.FINE_ARTS)
        _make_policy(db_session, org, policy_number="POL-EX", policy_type=PolicyType.EXHIBITION)

        resp = auth_client.get(f"{_policies_url(org)}?policy_type=exhibition")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["policy_type"] == PolicyType.EXHIBITION

    def test_filter_active_only(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_policy(db_session, org, policy_number="POL-ACT", status=PolicyStatus.ACTIVE)
        _make_policy(db_session, org, policy_number="POL-EXP", status=PolicyStatus.EXPIRED)

        resp = auth_client.get(f"{_policies_url(org)}?active_only=true")
        assert resp.status_code == 200
        data = resp.get_json()
        numbers = {p["policy_number"] for p in data["items"]}
        assert "POL-ACT" in numbers
        assert "POL-EXP" not in numbers

    def test_filter_rejects_invalid_status(self, auth_setup, db_session):
        """Unknown status values are silently dropped, not 400."""
        auth_client, org, _ = auth_setup
        _make_policy(db_session, org, status=PolicyStatus.ACTIVE)
        resp = auth_client.get(f"{_policies_url(org)}?status=bogus")
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 1

    def test_pagination_limits(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        for i in range(3):
            _make_policy(db_session, org, policy_number=f"POL-PG-{i}")

        resp = auth_client.get(f"{_policies_url(org)}?limit=2&offset=0")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 3
        assert len(data["items"]) == 2
        assert data["limit"] == 2


class TestCreatePolicyExtras:
    def test_invalid_policy_type(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _post(auth_client, _policies_url(org), {
            "policy_number": "POL-BAD-TYPE",
            "provider_name": "Acme",
            "effective_date": "2025-01-01",
            "expiration_date": "2026-01-01",
            "policy_type": "not_a_real_type",
        })
        assert resp.status_code == 422

    def test_invalid_status(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _post(auth_client, _policies_url(org), {
            "policy_number": "POL-BAD-STATUS",
            "provider_name": "Acme",
            "effective_date": "2025-01-01",
            "expiration_date": "2026-01-01",
            "status": "not_a_real_status",
        })
        assert resp.status_code == 422

    def test_create_full_payload(self, auth_setup):
        auth_client, org, _ = auth_setup
        payload = {
            "policy_number": "POL-FULL",
            "policy_name": "Full Policy",
            "policy_type": PolicyType.BLANKET,
            "provider_name": "Lloyd's",
            "broker_name": "Marsh",
            "effective_date": "2025-03-15",
            "expiration_date": "2026-03-15",
            "coverage_limit": 1_000_000,
            "coverage_limit_currency": "USD",
            "per_occurrence_limit": 250_000,
            "deductible": 5_000,
            "annual_premium": 12_000,
            "status": PolicyStatus.ACTIVE,
            "notes": "Primary fine-art cover",
        }
        resp = _post(auth_client, _policies_url(org), payload)
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["policy_number"] == "POL-FULL"
        assert data["coverage_limit"] == 1_000_000
        assert data["is_active"] is True


class TestUpdatePolicyExtras:
    def test_update_all_scalar_fields(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        policy = _make_policy(db_session, org, policy_number="POL-UP")

        payload = {
            "policy_name": "Renamed",
            "policy_type": PolicyType.MARINE,
            "provider_name": "New Provider",
            "broker_name": "New Broker",
            "effective_date": "2025-06-01",
            "expiration_date": "2026-06-01",
            "coverage_limit": 2_000_000,
            "coverage_limit_currency": "EUR",
            "per_occurrence_limit": 500_000,
            "deductible": 10_000,
            "annual_premium": 20_000,
            "notes": "updated",
        }
        resp = _patch(auth_client, _policy_url(org, policy.policy_id), payload)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["policy_name"] == "Renamed"
        assert data["policy_type"] == PolicyType.MARINE
        assert data["coverage_limit_currency"] == "EUR"
        assert data["notes"] == "updated"

    def test_update_policy_number_conflict(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_policy(db_session, org, policy_number="POL-EXIST")
        other = _make_policy(db_session, org, policy_number="POL-OTHER")

        resp = _patch(auth_client, _policy_url(org, other.policy_id), {
            "policy_number": "POL-EXIST",
        })
        assert resp.status_code == 409

    def test_update_invalid_policy_type(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        policy = _make_policy(db_session, org)
        resp = _patch(auth_client, _policy_url(org, policy.policy_id), {
            "policy_type": "nope",
        })
        assert resp.status_code == 422

    def test_update_invalid_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        policy = _make_policy(db_session, org)
        resp = _patch(auth_client, _policy_url(org, policy.policy_id), {
            "status": "nope",
        })
        assert resp.status_code == 422

    def test_update_wrong_org_returns_404(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        other = _other_org(db_session)
        policy = _make_policy(db_session, other, policy_number="POL-OTHER-ORG")

        resp = _patch(auth_client, _policy_url(org, policy.policy_id), {
            "policy_name": "Hacked",
        })
        assert resp.status_code == 404


class TestApprovePolicy:
    def test_approve_from_draft(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        policy = _make_policy(db_session, org, status=PolicyStatus.DRAFT)

        resp = auth_client.post(f"{_policy_url(org, policy.policy_id)}/approve")
        assert resp.status_code == 200
        assert resp.get_json()["status"] == PolicyStatus.ACTIVE

    def test_approve_from_pending_approval(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        policy = _make_policy(
            db_session, org, status=PolicyStatus.PENDING_APPROVAL,
        )
        resp = auth_client.post(f"{_policy_url(org, policy.policy_id)}/approve")
        assert resp.status_code == 200
        assert resp.get_json()["status"] == PolicyStatus.ACTIVE

    def test_approve_rejected_from_wrong_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        policy = _make_policy(db_session, org, status=PolicyStatus.EXPIRED)
        resp = auth_client.post(f"{_policy_url(org, policy.policy_id)}/approve")
        assert resp.status_code == 400

    def test_approve_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(f"{_policy_url(org, uuid4())}/approve")
        assert resp.status_code == 404


# ===========================================================================
# Get policy — cross-org isolation
# ===========================================================================


class TestGetPolicyIsolation:
    def test_get_policy_from_other_org_returns_404(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        other = _other_org(db_session)
        stranger = _make_policy(db_session, other, policy_number="POL-STRANGE")

        resp = auth_client.get(_policy_url(org, stranger.policy_id))
        assert resp.status_code == 404


# ===========================================================================
# Coverage — list filters, get, update, confirm
# ===========================================================================


class TestListCoveragesFilters:
    def test_filter_by_policy(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        p1 = _make_policy(db_session, org, policy_number="POL-F1")
        p2 = _make_policy(db_session, org, policy_number="POL-F2")
        _make_coverage(db_session, org, policy=p1)
        _make_coverage(db_session, org, policy=p2)

        resp = auth_client.get(f"{_coverages_url(org)}?policy_id={p1.policy_id}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1

    def test_filter_by_entity_type(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_coverage(
            db_session, org,
            covered_entity_type=CoveredEntityType.COLLECTION_OBJECT,
        )
        _make_coverage(
            db_session, org,
            covered_entity_type=CoveredEntityType.SHIPMENT,
        )

        resp = auth_client.get(
            f"{_coverages_url(org)}?entity_type=collection_object",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["coverages"][0]["covered_entity_type"] == CoveredEntityType.COLLECTION_OBJECT

    def test_filter_by_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_coverage(db_session, org, status=CoverageStatus.PENDING)
        _make_coverage(db_session, org, status=CoverageStatus.CONFIRMED)

        resp = auth_client.get(f"{_coverages_url(org)}?status=confirmed")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["coverages"][0]["status"] == CoverageStatus.CONFIRMED


class TestCreateCoverageValidation:
    def test_missing_entity_id(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _post(auth_client, _coverages_url(org), {
            "covered_entity_type": CoveredEntityType.COLLECTION_OBJECT,
        })
        assert resp.status_code == 422

    def test_invalid_entity_type(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _post(auth_client, _coverages_url(org), {
            "covered_entity_type": "not_valid",
            "covered_entity_id": str(uuid4()),
        })
        assert resp.status_code == 422

    def test_invalid_status(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _post(auth_client, _coverages_url(org), {
            "covered_entity_type": CoveredEntityType.COLLECTION_OBJECT,
            "covered_entity_id": str(uuid4()),
            "status": "nope",
        })
        assert resp.status_code == 422

    def test_create_with_policy_and_full_payload(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        policy = _make_policy(db_session, org, policy_number="POL-COV")
        payload = {
            "policy_id": str(policy.policy_id),
            "covered_entity_type": CoveredEntityType.COLLECTION_OBJECT,
            "covered_entity_id": str(uuid4()),
            "coverage_start_date": "2025-06-01",
            "coverage_end_date": "2025-12-31",
            "declared_value": 75_000,
            "agreed_value": 80_000,
            "value_currency": "USD",
            "third_party_provider": "AIG",
            "third_party_policy_number": "TPP-001",
            "certificate_requested": True,
            "certificate_received": True,
            "certificate_received_date": "2025-06-10",
            "certificate_number": "CERT-001",
            "notes": "exhibition loan coverage",
        }
        resp = _post(auth_client, _coverages_url(org), payload)
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["declared_value"] == 75_000
        assert data["has_certificate"] is True
        assert data["is_third_party"] is True


class TestGetCoverage:
    def test_get_coverage_404(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_coverage_url(org, uuid4()))
        assert resp.status_code == 404

    def test_get_coverage_wrong_org(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        other = _other_org(db_session)
        stranger = _make_coverage(db_session, other)
        resp = auth_client.get(_coverage_url(org, stranger.coverage_id))
        assert resp.status_code == 404

    def test_get_coverage_includes_entity_reference(self, auth_setup, db_session):
        """When the referenced object exists, _get_covered_entity_reference
        populates url_path/title — this exercises the helper."""
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org, object_number="LINK-1")
        coverage = _make_coverage(
            db_session, org,
            covered_entity_type=CoveredEntityType.COLLECTION_OBJECT,
            covered_entity_id=obj.object_id,
        )
        resp = auth_client.get(_coverage_url(org, coverage.coverage_id))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["covered_entity"]["reference"] == "LINK-1"
        assert str(obj.object_id) in data["covered_entity"]["url_path"]


class TestUpdateCoverage:
    def test_update_all_fields(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        policy = _make_policy(db_session, org, policy_number="POL-UPC")
        coverage = _make_coverage(db_session, org)

        payload = {
            "policy_id": str(policy.policy_id),
            "coverage_start_date": "2025-07-01",
            "coverage_end_date": "2025-12-31",
            "declared_value": 42_000,
            "agreed_value": 45_000,
            "value_currency": "GBP",
            "third_party_provider": "Axa",
            "third_party_policy_number": "TP-9",
            "certificate_requested": True,
            "certificate_received": True,
            "certificate_received_date": "2025-07-15",
            "certificate_number": "CN-9",
            "status": CoverageStatus.CONFIRMED,
            "notes": "bumped value",
        }
        resp = _patch(auth_client, _coverage_url(org, coverage.coverage_id), payload)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == CoverageStatus.CONFIRMED
        assert data["agreed_value"] == 45_000
        assert data["value_currency"] == "GBP"

    def test_update_invalid_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        coverage = _make_coverage(db_session, org)
        resp = _patch(auth_client, _coverage_url(org, coverage.coverage_id), {
            "status": "nope",
        })
        assert resp.status_code == 422

    def test_update_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _patch(auth_client, _coverage_url(org, uuid4()), {"declared_value": 1})
        assert resp.status_code == 404


class TestConfirmCoverage:
    def test_confirm_from_pending(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        coverage = _make_coverage(db_session, org, status=CoverageStatus.PENDING)

        resp = auth_client.post(f"{_coverage_url(org, coverage.coverage_id)}/confirm")
        assert resp.status_code == 200
        assert resp.get_json()["status"] == CoverageStatus.CONFIRMED

    def test_confirm_from_wrong_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        coverage = _make_coverage(db_session, org, status=CoverageStatus.CONFIRMED)
        resp = auth_client.post(f"{_coverage_url(org, coverage.coverage_id)}/confirm")
        assert resp.status_code == 400

    def test_confirm_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(f"{_coverage_url(org, uuid4())}/confirm")
        assert resp.status_code == 404


# ===========================================================================
# Entity-scoped coverage lookups
# ===========================================================================


class TestEntityInsuranceLookups:
    def test_get_object_insurance(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        object_id = uuid4()
        _make_coverage(
            db_session, org,
            covered_entity_type=CoveredEntityType.COLLECTION_OBJECT,
            covered_entity_id=object_id,
        )
        _make_coverage(
            db_session, org,
            covered_entity_type=CoveredEntityType.SHIPMENT,
            covered_entity_id=uuid4(),
        )

        url = f"/api/organizations/{org.organization_id}/collections/objects/{object_id}/insurance"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["coverages"][0]["covered_entity_type"] == CoveredEntityType.COLLECTION_OBJECT

    def test_get_loan_in_insurance(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        loan_id = uuid4()
        _make_coverage(
            db_session, org,
            covered_entity_type=CoveredEntityType.LOAN_IN,
            covered_entity_id=loan_id,
        )
        url = f"/api/organizations/{org.organization_id}/collections/loans-in/{loan_id}/insurance"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 1

    def test_get_loan_out_insurance_empty(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/collections/loans-out/{uuid4()}/insurance"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 0

    def test_get_shipment_insurance(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment_id = uuid4()
        _make_coverage(
            db_session, org,
            covered_entity_type=CoveredEntityType.SHIPMENT,
            covered_entity_id=shipment_id,
        )
        url = f"/api/organizations/{org.organization_id}/collections/shipments/{shipment_id}/insurance"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 1


# ===========================================================================
# Indemnities — full lifecycle
# ===========================================================================


class TestIndemnities:
    def test_list_empty(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_indemnities_url(org))
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 0

    def test_list_with_filters(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_indemnity(db_session, org, program=IndemnityProgram.US_ARTS, status=IndemnityStatus.DRAFT)
        _make_indemnity(db_session, org, program=IndemnityProgram.UK_GIS, status=IndemnityStatus.SUBMITTED)

        resp = auth_client.get(f"{_indemnities_url(org)}?program=uk_gis")
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 1

        resp = auth_client.get(f"{_indemnities_url(org)}?status=submitted")
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 1

    def test_create_minimum(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _post(auth_client, _indemnities_url(org), {
            "program": IndemnityProgram.US_ARTS,
            "internal_reference": "IND-TEST-1",
            "requested_coverage": 250_000,
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["program"] == IndemnityProgram.US_ARTS
        assert data["status"] == IndemnityStatus.DRAFT
        assert data["object_count"] == 0

    def test_create_with_objects(self, auth_setup):
        auth_client, org, _ = auth_setup
        payload = {
            "program": IndemnityProgram.UK_GIS,
            "internal_reference": "IND-WITH-OBJS",
            "requested_coverage": 1_000_000,
            "coverage_start_date": "2025-08-01",
            "coverage_end_date": "2025-12-31",
            "commercial_gap_required": True,
            "notes": "high-value loan",
            "objects": [
                {
                    "object_id": str(uuid4()),
                    "declared_value": 500_000,
                    "object_number": "O-1",
                    "object_title": "Painting 1",
                },
                {
                    "object_id": str(uuid4()),
                    "declared_value": 500_000,
                    "object_number": "O-2",
                    "object_title": "Painting 2",
                },
            ],
        }
        resp = _post(auth_client, _indemnities_url(org), payload)
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["object_count"] == 2
        assert data["total_declared_value"] == 1_000_000
        assert data["commercial_gap_required"] is True

    def test_create_missing_program(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _post(auth_client, _indemnities_url(org), {
            "internal_reference": "IND-NO-PROG",
        })
        assert resp.status_code == 422

    def test_create_invalid_program(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _post(auth_client, _indemnities_url(org), {
            "program": "not_real",
        })
        assert resp.status_code == 422

    def test_create_invalid_status(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _post(auth_client, _indemnities_url(org), {
            "program": IndemnityProgram.US_ARTS,
            "status": "nope",
        })
        assert resp.status_code == 422

    def test_get_indemnity(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        indemnity = _make_indemnity(db_session, org)
        resp = auth_client.get(_indemnity_url(org, indemnity.indemnity_id))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["indemnity_id"] == str(indemnity.indemnity_id)

    def test_get_indemnity_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_indemnity_url(org, uuid4()))
        assert resp.status_code == 404

    def test_get_indemnity_wrong_org(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        other = _other_org(db_session, slug="ind-other-org")
        stranger = _make_indemnity(db_session, other)
        resp = auth_client.get(_indemnity_url(org, stranger.indemnity_id))
        assert resp.status_code == 404

    def test_update_indemnity_full(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        indemnity = _make_indemnity(db_session, org)

        payload = {
            "program": IndemnityProgram.UK_GIS,
            "reference_number": "AGENCY-99",
            "internal_reference": "NEW-REF",
            "application_date": "2025-04-01",
            "requested_coverage": 400_000,
            "awarded_coverage": 350_000,
            "coverage_currency": "GBP",
            "coverage_start_date": "2025-06-01",
            "coverage_end_date": "2025-12-31",
            "commercial_gap_required": True,
            "authorization_date": "2025-04-15",
            "authorization_note": "approved",
            "notes": "updated",
        }
        resp = _patch(auth_client, _indemnity_url(org, indemnity.indemnity_id), payload)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["program"] == IndemnityProgram.UK_GIS
        assert data["awarded_coverage"] == 350_000
        assert data["coverage_currency"] == "GBP"

    def test_update_indemnity_invalid_program(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        indemnity = _make_indemnity(db_session, org)
        resp = _patch(auth_client, _indemnity_url(org, indemnity.indemnity_id), {
            "program": "bogus",
        })
        assert resp.status_code == 422

    def test_update_indemnity_invalid_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        indemnity = _make_indemnity(db_session, org)
        resp = _patch(auth_client, _indemnity_url(org, indemnity.indemnity_id), {
            "status": "bogus",
        })
        assert resp.status_code == 422

    def test_update_indemnity_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _patch(auth_client, _indemnity_url(org, uuid4()), {"notes": "x"})
        assert resp.status_code == 404


class TestIndemnitySubmit:
    def test_submit_from_draft(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        indemnity = _make_indemnity(db_session, org, status=IndemnityStatus.DRAFT)
        resp = auth_client.post(f"{_indemnity_url(org, indemnity.indemnity_id)}/submit")
        assert resp.status_code == 200
        assert resp.get_json()["status"] == IndemnityStatus.SUBMITTED

    def test_submit_from_wrong_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        indemnity = _make_indemnity(db_session, org, status=IndemnityStatus.APPROVED)
        resp = auth_client.post(f"{_indemnity_url(org, indemnity.indemnity_id)}/submit")
        assert resp.status_code == 400

    def test_submit_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(f"{_indemnity_url(org, uuid4())}/submit")
        assert resp.status_code == 404


class TestIndemnityObjects:
    def test_add_object(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        indemnity = _make_indemnity(db_session, org)
        object_id = str(uuid4())

        resp = _post(auth_client, f"{_indemnity_url(org, indemnity.indemnity_id)}/objects", {
            "object_id": object_id,
            "declared_value": 10_000,
            "approved_value": 9_500,
            "value_currency": "USD",
            "object_number": "OBJ-ADD-1",
            "object_title": "Added painting",
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["object_id"] == object_id
        assert data["declared_value"] == 10_000

    def test_add_object_missing_object_id(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        indemnity = _make_indemnity(db_session, org)
        resp = _post(auth_client, f"{_indemnity_url(org, indemnity.indemnity_id)}/objects", {
            "declared_value": 10_000,
        })
        assert resp.status_code == 422

    def test_add_object_duplicate(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        indemnity = _make_indemnity(db_session, org)
        object_id = str(uuid4())

        first = _post(auth_client, f"{_indemnity_url(org, indemnity.indemnity_id)}/objects", {
            "object_id": object_id,
        })
        assert first.status_code == 201

        dup = _post(auth_client, f"{_indemnity_url(org, indemnity.indemnity_id)}/objects", {
            "object_id": object_id,
        })
        assert dup.status_code == 409

    def test_add_object_indemnity_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _post(auth_client, f"{_indemnity_url(org, uuid4())}/objects", {
            "object_id": str(uuid4()),
        })
        assert resp.status_code == 404

    def test_remove_object(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        indemnity = _make_indemnity(db_session, org)
        link = IndemnityObject(
            indemnity_id=indemnity.indemnity_id,
            object_id=uuid4(),
            declared_value=1000,
        )
        db_session.add(link)
        db_session.commit()

        url = f"{_indemnity_url(org, indemnity.indemnity_id)}/objects/{link.link_id}"
        resp = auth_client.delete(url)
        assert resp.status_code == 204

    def test_remove_object_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        indemnity = _make_indemnity(db_session, org)
        url = f"{_indemnity_url(org, indemnity.indemnity_id)}/objects/{uuid4()}"
        resp = auth_client.delete(url)
        assert resp.status_code == 404


# ===========================================================================
# Claims — list filters, get, update, file, settle
# ===========================================================================


class TestListClaims:
    def test_list_empty(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_claims_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["claims"] == []
        assert data["total"] == 0

    def test_list_with_filters(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        coverage = _make_coverage(db_session, org)
        other_coverage = _make_coverage(db_session, org)

        _make_claim(db_session, org, coverage=coverage, loss_type=LossType.DAMAGE,
                    status=ClaimStatus.DRAFT)
        _make_claim(db_session, org, coverage=other_coverage, loss_type=LossType.THEFT,
                    status=ClaimStatus.FILED)

        resp = auth_client.get(f"{_claims_url(org)}?status=filed")
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 1

        resp = auth_client.get(f"{_claims_url(org)}?loss_type=damage")
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 1

        resp = auth_client.get(f"{_claims_url(org)}?coverage_id={coverage.coverage_id}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1

    def test_list_filter_by_indemnity(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        indemnity = _make_indemnity(db_session, org)
        _make_claim(db_session, org, indemnity=indemnity)

        resp = auth_client.get(f"{_claims_url(org)}?indemnity_id={indemnity.indemnity_id}")
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 1


class TestCreateClaim:
    def test_create_with_indemnity(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        indemnity = _make_indemnity(db_session, org)
        resp = _post(auth_client, _claims_url(org), {
            "indemnity_id": str(indemnity.indemnity_id),
            "claim_number": "CLM-IND-1",
            "loss_description": "Damage in transit",
            "loss_type": LossType.DAMAGE,
            "claimed_amount": 5000,
            "amount_currency": "USD",
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["indemnity_id"] == str(indemnity.indemnity_id)
        assert data["status"] == ClaimStatus.DRAFT

    def test_invalid_loss_type(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        coverage = _make_coverage(db_session, org)
        resp = _post(auth_client, _claims_url(org), {
            "coverage_id": str(coverage.coverage_id),
            "loss_type": "not_real",
        })
        assert resp.status_code == 422

    def test_invalid_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        coverage = _make_coverage(db_session, org)
        resp = _post(auth_client, _claims_url(org), {
            "coverage_id": str(coverage.coverage_id),
            "status": "nope",
        })
        assert resp.status_code == 422


class TestGetUpdateClaim:
    def test_get_claim(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        coverage = _make_coverage(db_session, org)
        claim = _make_claim(db_session, org, coverage=coverage)
        resp = auth_client.get(_claim_url(org, claim.claim_id))
        assert resp.status_code == 200
        assert resp.get_json()["claim_id"] == str(claim.claim_id)

    def test_get_claim_wrong_org(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        other = _other_org(db_session, slug="claim-other-org")
        stranger = _make_claim(db_session, other)
        resp = auth_client.get(_claim_url(org, stranger.claim_id))
        assert resp.status_code == 404

    def test_update_claim_full(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        coverage = _make_coverage(db_session, org)
        claim = _make_claim(db_session, org, coverage=coverage)

        payload = {
            "claim_number": "CLM-UPD-1",
            "insurer_claim_number": "INS-9",
            "date_of_loss": "2025-05-01",
            "loss_description": "Updated description",
            "loss_type": LossType.THEFT,
            "claimed_amount": 10_000,
            "settlement_amount": 8_000,
            "amount_currency": "EUR",
            "adjuster_name": "J Smith",
            "adjuster_contact": "js@adj.com",
            "status": ClaimStatus.UNDER_INVESTIGATION,
            "filed_date": "2025-05-02",
            "settled_date": "2025-05-10",
            "notes": "updated",
        }
        resp = _patch(auth_client, _claim_url(org, claim.claim_id), payload)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["loss_type"] == LossType.THEFT
        assert data["claimed_amount"] == 10_000
        assert data["status"] == ClaimStatus.UNDER_INVESTIGATION

    def test_update_invalid_loss_type(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        coverage = _make_coverage(db_session, org)
        claim = _make_claim(db_session, org, coverage=coverage)
        resp = _patch(auth_client, _claim_url(org, claim.claim_id), {"loss_type": "nope"})
        assert resp.status_code == 422

    def test_update_invalid_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        coverage = _make_coverage(db_session, org)
        claim = _make_claim(db_session, org, coverage=coverage)
        resp = _patch(auth_client, _claim_url(org, claim.claim_id), {"status": "nope"})
        assert resp.status_code == 422

    def test_update_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _patch(auth_client, _claim_url(org, uuid4()), {"notes": "x"})
        assert resp.status_code == 404


class TestFileClaim:
    def test_file_from_draft(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        coverage = _make_coverage(db_session, org)
        claim = _make_claim(db_session, org, coverage=coverage, status=ClaimStatus.DRAFT)

        resp = auth_client.post(f"{_claim_url(org, claim.claim_id)}/file")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == ClaimStatus.FILED
        assert data["filed_date"] is not None

    def test_file_wrong_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        coverage = _make_coverage(db_session, org)
        claim = _make_claim(db_session, org, coverage=coverage, status=ClaimStatus.FILED)
        resp = auth_client.post(f"{_claim_url(org, claim.claim_id)}/file")
        assert resp.status_code == 400

    def test_file_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(f"{_claim_url(org, uuid4())}/file")
        assert resp.status_code == 404


class TestSettleClaim:
    def test_settle_from_filed(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        coverage = _make_coverage(db_session, org)
        claim = _make_claim(db_session, org, coverage=coverage, status=ClaimStatus.FILED)

        resp = _post(auth_client, f"{_claim_url(org, claim.claim_id)}/settle", {
            "settlement_amount": 7500,
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == ClaimStatus.SETTLED
        assert data["settlement_amount"] == 7500
        assert data["settled_date"] is not None

    def test_settle_from_approved(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        coverage = _make_coverage(db_session, org)
        claim = _make_claim(
            db_session, org, coverage=coverage, status=ClaimStatus.APPROVED,
        )
        resp = _post(auth_client, f"{_claim_url(org, claim.claim_id)}/settle", {})
        assert resp.status_code == 200
        assert resp.get_json()["status"] == ClaimStatus.SETTLED

    def test_settle_from_draft_rejected(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        coverage = _make_coverage(db_session, org)
        claim = _make_claim(db_session, org, coverage=coverage, status=ClaimStatus.DRAFT)
        resp = _post(auth_client, f"{_claim_url(org, claim.claim_id)}/settle", {})
        assert resp.status_code == 400

    def test_settle_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _post(auth_client, f"{_claim_url(org, uuid4())}/settle", {})
        assert resp.status_code == 404


# ===========================================================================
# Authorization — viewer_auth_setup should be 403 on writes, 200 on reads
# ===========================================================================


class TestViewerForbiddenWrites:
    """A viewer-role user has only view-scoped perms and no platform.admin.
    Insurance write endpoints must reject with 403.
    """

    def test_viewer_cannot_create_policy(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = _post(auth_client, _policies_url(org), {
            "policy_number": "VIEW-FAIL",
            "provider_name": "Acme",
            "effective_date": "2025-01-01",
            "expiration_date": "2026-01-01",
        })
        assert resp.status_code == 403

    def test_viewer_cannot_update_policy(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = _patch(auth_client, _policy_url(org, uuid4()), {"policy_name": "x"})
        assert resp.status_code == 403

    def test_viewer_cannot_delete_policy(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.delete(_policy_url(org, uuid4()))
        assert resp.status_code == 403

    def test_viewer_cannot_approve_policy(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.post(f"{_policy_url(org, uuid4())}/approve")
        assert resp.status_code == 403

    def test_viewer_cannot_create_coverage(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = _post(auth_client, _coverages_url(org), {
            "covered_entity_type": CoveredEntityType.COLLECTION_OBJECT,
            "covered_entity_id": str(uuid4()),
        })
        assert resp.status_code == 403

    def test_viewer_cannot_confirm_coverage(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.post(f"{_coverage_url(org, uuid4())}/confirm")
        assert resp.status_code == 403

    def test_viewer_cannot_create_indemnity(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = _post(auth_client, _indemnities_url(org), {
            "program": IndemnityProgram.US_ARTS,
        })
        assert resp.status_code == 403

    def test_viewer_cannot_submit_indemnity(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.post(f"{_indemnity_url(org, uuid4())}/submit")
        assert resp.status_code == 403

    def test_viewer_cannot_create_claim(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = _post(auth_client, _claims_url(org), {
            "coverage_id": str(uuid4()),
            "loss_description": "nope",
        })
        assert resp.status_code == 403

    def test_viewer_cannot_file_claim(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.post(f"{_claim_url(org, uuid4())}/file")
        assert resp.status_code == 403

    def test_viewer_cannot_settle_claim(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = _post(auth_client, f"{_claim_url(org, uuid4())}/settle", {})
        assert resp.status_code == 403

    def test_viewer_cannot_update_claim(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = _patch(auth_client, _claim_url(org, uuid4()), {"notes": "x"})
        assert resp.status_code == 403


class TestInsuranceUnauth:
    def test_unauth_list_coverages(self, client, auth_setup):
        _, org, _ = auth_setup
        resp = client.get(_coverages_url(org))
        assert resp.status_code == 401

    def test_unauth_list_indemnities(self, client, auth_setup):
        _, org, _ = auth_setup
        resp = client.get(_indemnities_url(org))
        assert resp.status_code == 401

    def test_unauth_list_claims(self, client, auth_setup):
        _, org, _ = auth_setup
        resp = client.get(_claims_url(org))
        assert resp.status_code == 401
