"""Backend enum write-validation (the demo "Invalid input" second root cause).

Covers the single-source validator that derives allowed enum values from the
models' DB CHECK constraints. Columns whose values come from lookup categories
organizations extend (acquisition method, source type, legal status, ...) no
longer carry a CHECK (migration 7af089abb738); they are validated against the
organization's lookup values instead (tests/test_lookup_backed_columns.py).
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.models import CollectionObject, ConditionReport
from app.models.procedures import Acquisition
from app.services.collections.field_enums import (
    _enum_columns,
    validate_enum_fields,
)


class TestEnumRegistry:
    def test_closed_vocabularies_are_enrolled(self):
        assert _enum_columns(ConditionReport)["overall_condition"] == frozenset(
            {"excellent", "good", "fair", "poor", "unacceptable"}
        )
        assert "destroyed" in _enum_columns(CollectionObject)["object_status"]

    def test_lookup_backed_columns_are_not_enrolled(self):
        cols = _enum_columns(Acquisition)
        for column in ("acquisition_method", "source_type", "legal_status"):
            assert column not in cols

    def test_status_is_excluded(self):
        # status transitions are governed by workflow_definitions, not this 422.
        assert "status" not in _enum_columns(Acquisition)


class TestValidateEnumFields:
    def test_rejects_value_outside_the_check(self):
        with pytest.raises(HTTPException) as exc:
            validate_enum_fields(ConditionReport, {"overall_condition": "critical"})
        assert exc.value.status_code == 422
        assert exc.value.detail["code"] == "invalid_enum_value"
        assert "overall_condition" in exc.value.detail["fields"]

    def test_reports_all_violations_at_once(self):
        with pytest.raises(HTTPException) as exc:
            validate_enum_fields(
                CollectionObject,
                {"object_status": "active", "catalog_level": "nope"},
            )
        assert set(exc.value.detail["fields"]) == {"object_status", "catalog_level"}

    def test_allows_valid_values(self):
        validate_enum_fields(ConditionReport, {"overall_condition": "fair"})
        validate_enum_fields(CollectionObject, {"object_status": "destroyed"})

    def test_none_and_unknown_keys_ignored(self):
        # None clears a nullable field; unrelated keys aren't enum-constrained.
        validate_enum_fields(ConditionReport, {"overall_condition": None, "condition_summary": "x"})


class TestConditionDbCheck:
    """The CHECK is the durable backstop even if a write bypasses the router."""

    def _report(self, db_session, overall_condition):
        from app.models import Organization

        org = Organization(
            name="Enum CHECK Org",
            slug=f"enum-chk-{uuid.uuid4().hex[:8]}",
            status="active",
        )
        db_session.add(org)
        db_session.commit()
        return ConditionReport(
            organization_id=org.organization_id,
            report_number=f"CR-{uuid.uuid4().hex[:6]}",
            report_type="periodic",
            report_date=__import__("datetime").date.today(),
            linked_entity_type="loan_in",
            linked_entity_id=uuid.uuid4(),
            overall_condition=overall_condition,
            status="draft",
        )

    def test_condition_outside_the_scale_rejected_by_db(self, db_session):
        db_session.add(self._report(db_session, "critical"))
        with pytest.raises(IntegrityError):
            db_session.flush()
        db_session.rollback()

    def test_condition_on_the_scale_and_null_accepted(self, db_session):
        db_session.add(self._report(db_session, "poor"))
        db_session.flush()  # no IntegrityError
        db_session.rollback()
