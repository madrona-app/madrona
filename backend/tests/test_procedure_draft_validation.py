"""Pre-approval procedure validation for Studio drafts (§7 trust ribbon)."""

from app.services.procedure_requirements.draft_validation import (
    ENTITY_TO_PROCEDURE,
    validate_draft_against_procedure,
)


def test_entity_without_procedure_returns_none():
    # location / constituent / use_request / media_* have no procedure.
    assert validate_draft_against_procedure("location", {"name": "A1"}) is None
    assert validate_draft_against_procedure("use_request", {"use_type": "research"}) is None
    assert validate_draft_against_procedure("media_rights", {"media_id": "x"}) is None


def test_proposal_stage_with_no_blocking_reports_zero_checks():
    # Acquisition has no blocking requirement at its proposal status. The
    # validator reports that honestly (blocking_total == 0) — it does NOT invent
    # a validation; the UI renders this as a neutral "follows the procedure",
    # never a green "validated".
    res = validate_draft_against_procedure("acquisition", {"acquisition_method": "gift"})
    assert res is not None
    assert res["procedure_type"] == "acquisition"
    assert res["blocking_total"] == 0
    assert res["missing"] == []


def test_proposal_stage_blocking_fields_are_checked():
    # Valuation requires its core fields at the proposal ('current') stage.
    partial = validate_draft_against_procedure("valuation", {"object_id": "x"})
    assert partial["blocking_total"] == 5
    assert partial["passed"] is False
    assert partial["blocking_met"] < partial["blocking_total"]
    assert any(m["id"] == "valuation_amount" for m in partial["missing"])

    full = validate_draft_against_procedure("valuation", {
        "object_id": "x", "valuation_type": "insurance", "valuation_amount": 100,
        "valuation_date": "2026-01-01", "valuation_currency": "USD",
    })
    assert full["passed"] is True
    assert full["blocking_met"] == full["blocking_total"] == 5
    assert full["missing"] == []


def test_every_mapped_procedure_resolves():
    # Every entry in the map must point at a real registered procedure, so the
    # ribbon never references a procedure that doesn't exist.
    for entity in ENTITY_TO_PROCEDURE:
        res = validate_draft_against_procedure(entity, {})
        assert res is not None, entity
        assert res["procedure"]
        assert "passed" in res
