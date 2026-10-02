"""Backend enum write-validation (the demo "Invalid input" second root cause).

Covers the single-source validator that derives allowed enum values from the
models' DB CHECK constraints, and the new acquisition source_type / legal_status
CHECKs added by migration bdf1c9cfaf27.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.models.procedures import Acquisition
from app.services.collections.field_enums import (
    _enum_columns,
    validate_enum_fields,
)


class TestEnumRegistry:
    def test_source_type_and_legal_status_are_enrolled(self):
        cols = _enum_columns(Acquisition)
        assert cols["source_type"] == frozenset(
            {"individual", "institution", "estate", "dealer", "other"}
        )
        assert cols["legal_status"] == frozenset(
            {"clear", "pending_provenance", "disputed", "restricted"}
        )

    def test_status_is_excluded(self):
        # status transitions are governed by workflow_definitions, not this 422.
        assert "status" not in _enum_columns(Acquisition)

    def test_acquisition_method_enrolled_from_existing_check(self):
        assert "gift" in _enum_columns(Acquisition)["acquisition_method"]


class TestValidateEnumFields:
    def test_rejects_invalid_source_type(self):
        with pytest.raises(HTTPException) as exc:
            validate_enum_fields(Acquisition, {"source_type": "Auction House"})
        assert exc.value.status_code == 422
        assert exc.value.detail["code"] == "invalid_enum_value"
        assert "source_type" in exc.value.detail["fields"]

    def test_rejects_invalid_legal_status(self):
        with pytest.raises(HTTPException) as exc:
            validate_enum_fields(Acquisition, {"legal_status": "Critical"})
        assert exc.value.status_code == 422

    def test_reports_all_violations_at_once(self):
        with pytest.raises(HTTPException) as exc:
            validate_enum_fields(
                Acquisition,
                {"source_type": "nope", "legal_status": "nope"},
            )
        assert set(exc.value.detail["fields"]) == {"source_type", "legal_status"}

    def test_allows_valid_values(self):
        validate_enum_fields(
            Acquisition,
            {"source_type": "institution", "legal_status": "clear", "acquisition_method": "gift"},
        )

    def test_none_and_unknown_keys_ignored(self):
        # None clears a nullable field; unrelated keys aren't enum-constrained.
        validate_enum_fields(Acquisition, {"source_type": None, "credit_line": "anything"})


class TestSourceTypeDbCheck:
    """The CHECK is the durable backstop even if a write bypasses the router."""

    def _org(self, db_session):
        from app.models import Organization

        org = Organization(
            name="Enum CHECK Org",
            slug=f"enum-chk-{uuid.uuid4().hex[:8]}",
            status="active",
        )
        db_session.add(org)
        db_session.commit()
        return org.organization_id

    def test_invalid_source_type_rejected_by_db(self, db_session):
        org_id = self._org(db_session)
        db_session.add(Acquisition(
            organization_id=org_id,
            acquisition_number="ACQ2026.9001",
            acquisition_method="gift",
            source_type="Auction House",  # not in the CHECK set
        ))
        with pytest.raises(IntegrityError):
            db_session.flush()
        db_session.rollback()

    def test_valid_source_type_and_null_accepted(self, db_session):
        org_id = self._org(db_session)
        db_session.add(Acquisition(
            organization_id=org_id,
            acquisition_number="ACQ2026.9002",
            acquisition_method="gift",
            source_type="institution",
            legal_status=None,
        ))
        db_session.flush()  # no IntegrityError
        db_session.rollback()
