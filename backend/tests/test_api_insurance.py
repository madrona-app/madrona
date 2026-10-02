"""
Smoke tests for the Insurance Management API (Procedure 14).

Covers CRUD operations for policies, coverages, claims, and auth checks.
Routes under /api/organizations/<org_id>/collections/insurance/...
"""

import json
from datetime import date
from uuid import uuid4

import pytest

from app.models import (
    InsurancePolicy, InsuranceCoverage, InsuranceClaim, IndemnityArrangement,
    PolicyType, PolicyStatus, CoveredEntityType, CoverageStatus,
    IndemnityProgram, IndemnityStatus, LossType, ClaimStatus,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _policies_url(org):
    return f"/api/organizations/{org.organization_id}/collections/insurance/policies"


def _policy_url(org, policy_id):
    return f"{_policies_url(org)}/{policy_id}"


def _coverages_url(org):
    return f"/api/organizations/{org.organization_id}/collections/insurance/coverages"


def _coverage_url(org, coverage_id):
    return f"{_coverages_url(org)}/{coverage_id}"


def _claims_url(org):
    return f"/api/organizations/{org.organization_id}/collections/insurance/claims"


def _claim_url(org, claim_id):
    return f"{_claims_url(org)}/{claim_id}"


def _post_json(auth_client, url, data):
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _patch_json(auth_client, url, data):
    return auth_client.patch(url, data=json.dumps(data), content_type="application/json")


def _make_policy(db_session, org, **overrides):
    """Insert an InsurancePolicy row directly and return it."""
    defaults = dict(
        organization_id=org.organization_id,
        policy_number=f"POL-{uuid4().hex[:8]}",
        policy_name="Test Policy",
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


def _make_coverage(db_session, org, **overrides):
    """Insert an InsuranceCoverage row directly and return it."""
    defaults = dict(
        organization_id=org.organization_id,
        covered_entity_type=CoveredEntityType.COLLECTION_OBJECT,
        covered_entity_id=uuid4(),
        status=CoverageStatus.PENDING,
    )
    defaults.update(overrides)
    coverage = InsuranceCoverage(**defaults)
    db_session.add(coverage)
    db_session.commit()
    return coverage


def _make_claim(db_session, org, coverage=None, **overrides):
    """Insert an InsuranceClaim row directly and return it."""
    defaults = dict(
        organization_id=org.organization_id,
        claim_number=f"CLM-{uuid4().hex[:8]}",
        loss_description="Test loss",
        status=ClaimStatus.DRAFT,
    )
    if coverage:
        defaults["coverage_id"] = coverage.coverage_id
    defaults.update(overrides)
    claim = InsuranceClaim(**defaults)
    db_session.add(claim)
    db_session.commit()
    return claim


# ============================================================================
# Policy CRUD
# ============================================================================


class TestListPolicies:
    def test_list_policies_empty(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_policies_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_policies_returns_data(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_policy(db_session, org, policy_number="POL-001")
        _make_policy(db_session, org, policy_number="POL-002")

        resp = auth_client.get(_policies_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 2
        assert len(data["items"]) == 2


class TestCreatePolicy:
    def test_create_policy_validates_required_fields(self, auth_setup):
        """The create endpoint validates required fields before DB insertion."""
        auth_client, org, _ = auth_setup
        # Missing policy_number
        resp = _post_json(auth_client, _policies_url(org), {
            "provider_name": "Acme",
            "effective_date": "2025-01-01",
            "expiration_date": "2026-01-01",
        })
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert ("policy_number" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)) or "Policy number" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)))

    def test_create_policy_missing_provider(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, _policies_url(org), {
            "policy_number": "POL-001",
            "effective_date": "2025-01-01",
            "expiration_date": "2026-01-01",
        })
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert ("provider_name" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)) or "Provider" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)))

    def test_create_policy_missing_dates(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, _policies_url(org), {
            "policy_number": "POL-001",
            "provider_name": "Acme",
        })
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert ("effective_date" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)) or "effective" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower())

    def test_create_policy_duplicate_number(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_policy(db_session, org, policy_number="DUP-001")

        resp = _post_json(auth_client, _policies_url(org), {
            "policy_number": "DUP-001",
            "provider_name": "Acme",
            "effective_date": "2025-01-01",
            "expiration_date": "2026-01-01",
        })
        assert resp.status_code in (400, 409, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "already exists" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))


class TestGetPolicy:
    def test_get_policy_success(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        policy = _make_policy(db_session, org)

        resp = auth_client.get(_policy_url(org, policy.policy_id))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["policy_id"] == str(policy.policy_id)
        assert "coverages" in data  # get_policy includes coverages

    def test_get_policy_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_policy_url(org, uuid4()))
        assert resp.status_code == 404


class TestUpdatePolicy:
    def test_update_policy_success(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        policy = _make_policy(db_session, org)

        resp = _patch_json(auth_client, _policy_url(org, policy.policy_id), {
            "policy_name": "Updated Name",
            "broker_name": "New Broker",
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["policy_name"] == "Updated Name"
        assert data["broker_name"] == "New Broker"

    def test_update_policy_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _patch_json(auth_client, _policy_url(org, uuid4()), {
            "policy_name": "Nope",
        })
        assert resp.status_code == 404


class TestDeletePolicy:
    def test_delete_policy_success(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        policy = _make_policy(db_session, org)

        resp = auth_client.delete(_policy_url(org, policy.policy_id))
        assert resp.status_code == 204

        # Confirm it's gone
        resp = auth_client.get(_policy_url(org, policy.policy_id))
        assert resp.status_code == 404

    def test_delete_policy_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.delete(_policy_url(org, uuid4()))
        assert resp.status_code == 404


# ============================================================================
# Coverage CRUD
# ============================================================================


class TestListCoverages:
    def test_list_coverages_empty(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_coverages_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["coverages"] == []
        assert data["total"] == 0


class TestCreateCoverage:
    def test_create_coverage_success(self, auth_setup):
        auth_client, org, _ = auth_setup
        entity_id = str(uuid4())
        payload = {
            "covered_entity_type": CoveredEntityType.COLLECTION_OBJECT,
            "covered_entity_id": entity_id,
            "declared_value": 50000,
        }
        resp = _post_json(auth_client, _coverages_url(org), payload)
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["covered_entity_type"] == CoveredEntityType.COLLECTION_OBJECT
        assert data["covered_entity_id"] == entity_id
        assert data["status"] == CoverageStatus.PENDING

    def test_create_coverage_missing_entity_type(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, _coverages_url(org), {
            "covered_entity_id": str(uuid4()),
        })
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert ("covered_entity_type" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)) or "entity type" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower())


# ============================================================================
# Claims CRUD
# ============================================================================


class TestCreateClaim:
    def test_create_claim_with_coverage(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        coverage = _make_coverage(db_session, org)

        payload = {
            "coverage_id": str(coverage.coverage_id),
            "claim_number": "CLM-001",
            "loss_description": "Water damage to painting",
            "loss_type": LossType.DAMAGE,
        }
        resp = _post_json(auth_client, _claims_url(org), payload)
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["claim_number"] == "CLM-001"
        assert data["status"] == ClaimStatus.DRAFT

    def test_create_claim_missing_coverage_and_indemnity(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, _claims_url(org), {
            "claim_number": "CLM-FAIL",
            "loss_description": "No coverage link",
        })
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        msg = (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower()
        assert (
            "coverage_id" in msg
            or "indemnity_id" in msg
            or "coverage or indemnity" in msg
        )


class TestGetClaim:
    def test_get_claim_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_claim_url(org, uuid4()))
        assert resp.status_code == 404


# ============================================================================
# Enums endpoint
# ============================================================================


class TestInsuranceEnums:
    def test_get_enums(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/collections/insurance/enums"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert "policy_types" in data
        assert "policy_statuses" in data
        assert "covered_entity_types" in data
        assert "loss_types" in data
        assert len(data["policy_types"]) == len(PolicyType.ALL)


# ============================================================================
# Authorization
# ============================================================================


class TestInsuranceAuth:
    def test_list_policies_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        resp = client.get(_policies_url(org))
        assert resp.status_code == 401

    def test_create_policy_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        resp = client.post(
            _policies_url(org),
            data=json.dumps({"policy_number": "X"}),
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_list_coverages_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        resp = client.get(_coverages_url(org))
        assert resp.status_code == 401
