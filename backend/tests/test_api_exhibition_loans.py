"""
Smoke tests for the Exhibition Loans API module.

Covers CRUD operations for exhibition loan links under:
    /api/organizations/<org_id>/exhibit/exhibitions/<exhibition_id>/loans

Uses SQLite in-memory database via the conftest fixtures.
"""

import json
from uuid import uuid4

import pytest

from app.models import (
    Exhibition,
    ExhibitionLoan,
    LoanType,
    LoanStatus,
)


def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _patch_json(auth_client, url, data):
    """Helper for PATCH with JSON body."""
    return auth_client.patch(url, data=json.dumps(data), content_type="application/json")


def _loans_url(org, exhibition_id, suffix=""):
    """Build a URL under the exhibition loans blueprint."""
    return (
        f"/api/organizations/{org.organization_id}"
        f"/exhibit/exhibitions/{exhibition_id}/loans{suffix}"
    )


def _create_exhibition(db_session, org):
    """Insert a minimal Exhibition row and return its ID.

    Explicit status and exhibition_type are required because SQLite does
    not evaluate PostgreSQL-style server_default expressions correctly.
    """
    exhibition = Exhibition(
        organization_id=org.organization_id,
        title="Test Exhibition",
        status="proposed",
        exhibition_type="temporary",
    )
    db_session.add(exhibition)
    db_session.commit()
    return str(exhibition.exhibition_id)


# ============================================================================
# List loans
# ============================================================================


class TestListExhibitionLoans:
    def test_list_empty(self, auth_setup, db_session):
        """GET returns empty list when no loans exist for the exhibition."""
        auth_client, org, _ = auth_setup
        exh_id = _create_exhibition(db_session, org)

        resp = auth_client.get(_loans_url(org, exh_id))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["loans"] == []
        assert data["summary"]["total"] == 0

    def test_list_returns_created_loan(self, auth_setup, db_session):
        """After creating a loan, the list endpoint includes it.

        NOTE: inserts the ExhibitionLoan row directly via db_session because the
        POST /loans endpoint currently crashes with NotNullViolation on
        organization_id (app/fastapi_app/routers/exhibition_loans.py:255-277 does
        not set organization_id on the ExhibitionLoan it constructs). This test
        focuses on the GET list behavior, not the POST path.
        """
        auth_client, org, _ = auth_setup
        exh_id = _create_exhibition(db_session, org)

        # NOTE: object_count is stored as String(50) in the model (loans.py:162)
        # but the response_model declares it as `int | None` in
        # app/fastapi_app/schemas/exhibition_loans.py:39, which is a separate
        # prod drift. Leave it unset so response validation doesn't trip.
        loan = ExhibitionLoan(
            organization_id=org.organization_id,
            exhibition_id=exh_id,
            party_name="Example Museum",
            loan_type=LoanType.LOAN_IN,
            loan_id=uuid4(),  # loan_type set → loan_id must also be set per ck constraint
            status=LoanStatus.REQUESTED,
        )
        db_session.add(loan)
        db_session.commit()

        resp = auth_client.get(_loans_url(org, exh_id))
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["loans"]) == 1
        assert data["loans"][0]["party_name"] == "Example Museum"
        assert data["summary"]["total"] == 1

    def test_list_exhibition_not_found(self, auth_setup):
        """GET with non-existent exhibition ID returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        resp = auth_client.get(_loans_url(org, fake_id))
        assert resp.status_code == 404


# ============================================================================
# Create loan
# ============================================================================


class TestCreateExhibitionLoan:
    def test_create_planning_loan(self, auth_setup, db_session):
        """POST creates a planning-phase loan (no loan_id) and returns 201."""
        auth_client, org, _ = auth_setup
        exh_id = _create_exhibition(db_session, org)

        resp = _post_json(auth_client, _loans_url(org, exh_id), {
            "party_name": "National Gallery",
            "object_count": "5 objects",
            "notes": "Initial discussion",
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["party_name"] == "National Gallery"
        assert data["is_linked"] is False
        assert data["status"] == LoanStatus.REQUESTED
        assert "link_id" in data

    def test_create_linked_loan(self, auth_setup, db_session):
        """POST with loan_id and loan_type creates a linked loan."""
        auth_client, org, _ = auth_setup
        exh_id = _create_exhibition(db_session, org)
        fake_loan_id = str(uuid4())

        resp = _post_json(auth_client, _loans_url(org, exh_id), {
            "loan_id": fake_loan_id,
            "loan_type": "loan_in",
            "party_name": "Louvre",
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["is_linked"] is True
        assert data["loan_type"] == "loan_in"

    def test_create_loan_missing_type_when_linked(self, auth_setup, db_session):
        """POST with loan_id but missing loan_type returns 400.

        Validation fires BEFORE the organization_id omission bug in the router,
        so this test still exercises the real validation path. The router
        returns detail={code, message, field} — we check both message and field
        because the message is human-friendly ("Loan type is required ...")
        while the snake_case token "loan_type" lives in field.
        """
        auth_client, org, _ = auth_setup
        exh_id = _create_exhibition(db_session, org)

        resp = _post_json(auth_client, _loans_url(org, exh_id), {
            "loan_id": str(uuid4()),
            "party_name": "Tate",
        })
        assert resp.status_code in (400, 422)
        body = resp.get_json()
        _e = body.get("error") or body.get("detail", "")
        if isinstance(_e, dict):
            haystack = f"{_e.get('message', '')} {_e.get('field', '')}".lower()
        else:
            haystack = str(_e).lower()
        assert "loan_type" in haystack or "loan type" in haystack

    def test_create_loan_invalid_status(self, auth_setup, db_session):
        """POST with an invalid status value returns 400."""
        auth_client, org, _ = auth_setup
        exh_id = _create_exhibition(db_session, org)

        resp = _post_json(auth_client, _loans_url(org, exh_id), {
            "party_name": "Smithsonian",
            "status": "totally_bogus",
        })
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "status" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower()


# ============================================================================
# Get by ID / Not found
# ============================================================================


class TestGetExhibitionLoan:
    def test_get_by_id(self, auth_setup, db_session):
        """GET /<link_id> returns the loan with objects list.

        Inserts directly via db_session to sidestep the POST /loans
        NotNullViolation bug (see app/fastapi_app/routers/exhibition_loans.py:255).
        The assertions still cover the real GET /loans/{link_id} path.
        """
        auth_client, org, _ = auth_setup
        exh_id = _create_exhibition(db_session, org)

        loan = ExhibitionLoan(
            organization_id=org.organization_id,
            exhibition_id=exh_id,
            party_name="V&A",
            loan_type=LoanType.LOAN_OUT,
            loan_id=uuid4(),  # ck_exhibition_loans_loan_consistency: loan_type set → loan_id set
            status=LoanStatus.REQUESTED,
        )
        db_session.add(loan)
        db_session.commit()
        link_id = str(loan.link_id)

        resp = auth_client.get(_loans_url(org, exh_id, f"/{link_id}"))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["link_id"] == link_id
        assert data["party_name"] == "V&A"
        assert "objects" in data

    def test_get_not_found(self, auth_setup, db_session):
        """GET /<link_id> with non-existent ID returns 404."""
        auth_client, org, _ = auth_setup
        exh_id = _create_exhibition(db_session, org)
        fake_id = str(uuid4())

        resp = auth_client.get(_loans_url(org, exh_id, f"/{fake_id}"))
        assert resp.status_code == 404


# ============================================================================
# Update loan
# ============================================================================


class TestUpdateExhibitionLoan:
    def test_update_loan(self, auth_setup, db_session):
        """PATCH /<link_id> updates fields and returns updated data.

        Inserts directly via db_session to sidestep the POST /loans
        NotNullViolation bug (see app/fastapi_app/routers/exhibition_loans.py:255).
        The assertions still cover the real PATCH /loans/{link_id} path.
        """
        auth_client, org, _ = auth_setup
        exh_id = _create_exhibition(db_session, org)

        loan = ExhibitionLoan(
            organization_id=org.organization_id,
            exhibition_id=exh_id,
            party_name="Rijksmuseum",
            status=LoanStatus.REQUESTED,
            # planning-phase: loan_id and loan_type both NULL (ck constraint)
        )
        db_session.add(loan)
        db_session.commit()
        link_id = str(loan.link_id)

        resp = _patch_json(auth_client, _loans_url(org, exh_id, f"/{link_id}"), {
            "party_name": "Rijksmuseum (updated)",
            "status": LoanStatus.APPROVED,
            "insurance_confirmed": True,
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["party_name"] == "Rijksmuseum (updated)"
        assert data["status"] == LoanStatus.APPROVED
        assert data["insurance_confirmed"] is True

    def test_update_not_found(self, auth_setup, db_session):
        """PATCH on a non-existent link_id returns 404."""
        auth_client, org, _ = auth_setup
        exh_id = _create_exhibition(db_session, org)
        fake_id = str(uuid4())

        resp = _patch_json(auth_client, _loans_url(org, exh_id, f"/{fake_id}"), {
            "party_name": "Nobody",
        })
        assert resp.status_code == 404


# ============================================================================
# Delete loan
# ============================================================================


class TestDeleteExhibitionLoan:
    def test_delete_loan(self, auth_setup, db_session):
        """DELETE /<link_id> removes the loan and returns 204.

        Inserts directly via db_session to sidestep the POST /loans
        NotNullViolation bug (see app/fastapi_app/routers/exhibition_loans.py:255).
        The assertions still cover the real DELETE /loans/{link_id} path and
        verify the subsequent GET returns 404.
        """
        auth_client, org, _ = auth_setup
        exh_id = _create_exhibition(db_session, org)

        loan = ExhibitionLoan(
            organization_id=org.organization_id,
            exhibition_id=exh_id,
            party_name="British Museum",
            status=LoanStatus.REQUESTED,
        )
        db_session.add(loan)
        db_session.commit()
        link_id = str(loan.link_id)

        resp = auth_client.delete(_loans_url(org, exh_id, f"/{link_id}"))
        assert resp.status_code == 204

        # Confirm it's gone
        get_resp = auth_client.get(_loans_url(org, exh_id, f"/{link_id}"))
        assert get_resp.status_code == 404

    def test_delete_not_found(self, auth_setup, db_session):
        """DELETE on a non-existent link_id returns 404."""
        auth_client, org, _ = auth_setup
        exh_id = _create_exhibition(db_session, org)
        fake_id = str(uuid4())

        resp = auth_client.delete(_loans_url(org, exh_id, f"/{fake_id}"))
        assert resp.status_code == 404


# ============================================================================
# Auth required (401)
# ============================================================================


class TestExhibitionLoansAuth:
    def test_list_requires_auth(self, client, db_session, auth_setup):
        """GET without auth token returns 401."""
        _, org, _ = auth_setup
        exh_id = _create_exhibition(db_session, org)
        resp = client.get(_loans_url(org, exh_id))
        assert resp.status_code == 401

    def test_create_requires_auth(self, client, db_session, auth_setup):
        """POST without auth token returns 401."""
        _, org, _ = auth_setup
        exh_id = _create_exhibition(db_session, org)
        resp = client.post(
            _loans_url(org, exh_id),
            data=json.dumps({"party_name": "Test"}),
            content_type="application/json",
        )
        assert resp.status_code == 401
