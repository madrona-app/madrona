"""
Tests for the document generation endpoints.

Routes under:
- POST /api/organizations/<org_id>/documents/generate
- POST /api/organizations/<org_id>/documents/preview

Tests cover:
- Object receipt generation (from entry_id)
- Loan agreement out generation (from loan_id)
- Loan agreement in generation (from loan_id)
- Validation (missing fields, invalid document types)
- Data resolution (_resolve_document_data)
"""

import json
from datetime import date
from decimal import Decimal
from unittest.mock import patch, MagicMock
from uuid import uuid4

import pytest

from app.database import current_session
from app.models import (
    Constituent,
    ObjectEntry,
    ObjectEntryItem,
    LoanOut,
    LoanOutObject,
    LoanIn,
    LoanInObject,
    CollectionObject,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _generate_url(org):
    return f"/api/organizations/{org.organization_id}/documents/generate"


def _preview_url(org):
    return f"/api/organizations/{org.organization_id}/documents/preview"


def _post_json(auth_client, url, data):
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def csrf_auth_setup(auth_setup):
    """Alias for auth_setup (CSRF is now handled in AuthenticatedClient)."""
    return auth_setup


@pytest.fixture
def constituent(auth_setup, db_session):
    """Create a test constituent."""
    _, org, _ = auth_setup
    c = Constituent(
        organization_id=org.organization_id,
        constituent_type="person",
        name="Jane Doe",
        email="jane@example.com",
        phone="555-0100",
        organization_name="Test Gallery",
    )
    db_session.add(c)
    db_session.commit()
    return c


@pytest.fixture
def object_entry_with_items(auth_setup, db_session, constituent):
    """Create a test object entry with items and a depositor."""
    _, org, _ = auth_setup
    entry = ObjectEntry(
        organization_id=org.organization_id,
        entry_number="ENT-2026-001",
        entry_date=date(2026, 2, 21),
        depositor_id=constituent.constituent_id,
        depositor_name="Jane Doe",
        entry_reason="purchase_consideration",
        entry_method="hand_delivery",
    )
    db_session.add(entry)
    db_session.flush()

    item1 = ObjectEntryItem(
        entry_id=entry.entry_id,
        organization_id=org.organization_id,
        item_number=1,
        brief_description="Oil painting on canvas",
        condition_note="Good condition, minor frame damage",
    )
    item2 = ObjectEntryItem(
        entry_id=entry.entry_id,
        organization_id=org.organization_id,
        item_number=2,
        brief_description="Bronze sculpture",
        condition_note="Excellent",
    )
    db_session.add_all([item1, item2])
    db_session.commit()
    return entry


@pytest.fixture
def collection_object(auth_setup, db_session):
    """Create a test collection object."""
    _, org, _ = auth_setup
    obj = CollectionObject(
        organization_id=org.organization_id,
        object_number="OBJ-001",
        titles=[{"title": "Test Artwork", "title_type": "current", "is_preferred": True}],
    )
    db_session.add(obj)
    db_session.commit()
    return obj


@pytest.fixture
def loan_out_with_objects(auth_setup, db_session, constituent, collection_object):
    """Create a test loan out with objects and a borrower."""
    _, org, _ = auth_setup
    loan = LoanOut(
        organization_id=org.organization_id,
        loan_number="LO-2026-001",
        borrower_id=constituent.constituent_id,
        borrower_name="Jane Doe",
        loan_purpose="exhibition",
        exhibition_title="Test Exhibition",
        loan_start_date=date(2026, 3, 1),
        loan_end_date=date(2026, 6, 1),
        status="approved",
    )
    db_session.add(loan)
    db_session.flush()

    loan_obj = LoanOutObject(
        loan_out_id=loan.loan_out_id,
        organization_id=org.organization_id,
        object_id=collection_object.object_id,
        insurance_value=Decimal("50000.00"),
        display_credit_line="Test Artwork, 2025",
    )
    db_session.add(loan_obj)
    db_session.commit()
    return loan


@pytest.fixture
def loan_in_with_objects(auth_setup, db_session, constituent):
    """Create a test loan in with objects and a lender."""
    _, org, _ = auth_setup
    loan = LoanIn(
        organization_id=org.organization_id,
        loan_number="LI-2026-001",
        lender_id=constituent.constituent_id,
        lender_name="Jane Doe",
        loan_purpose="exhibition",
        loan_start_date=date(2026, 3, 1),
        loan_end_date=date(2026, 6, 1),
        status="approved",
    )
    db_session.add(loan)
    db_session.flush()

    loan_obj = LoanInObject(
        loan_in_id=loan.loan_in_id,
        organization_id=org.organization_id,
        object_title="Borrowed Masterpiece",
        insurance_value=Decimal("100000.00"),
    )
    db_session.add(loan_obj)
    db_session.commit()
    return loan


# ============================================================================
# Validation Tests
# ============================================================================

class TestDocumentGenerationValidation:
    def test_missing_document_type(self, csrf_auth_setup):
        """Request without document_type returns 400."""
        auth_client, org, _ = csrf_auth_setup
        resp = _post_json(auth_client, _generate_url(org), {"data": {}})
        assert resp.status_code in (400, 422)

    def test_invalid_document_type(self, csrf_auth_setup):
        """Invalid document_type returns 400."""
        auth_client, org, _ = csrf_auth_setup
        resp = _post_json(auth_client, _generate_url(org), {
            "document_type": "invalid_type",
            "data": {},
        })
        assert resp.status_code in (400, 422)
        body = resp.get_json()
        err = body.get("error")
        if isinstance(err, dict):
            err = err.get("message", "")
        msg = (err or "") + (body.get("message") or "")
        assert "invalid" in msg.lower()

    def test_requires_auth(self, client, auth_setup):
        """Unauthenticated request is rejected (403 CSRF or 401 auth)."""
        _, org, _ = auth_setup
        resp = client.post(
            _generate_url(org),
            data=json.dumps({"document_type": "object_receipt", "data": {}}),
            content_type="application/json",
        )
        assert resp.status_code in (401, 403)

