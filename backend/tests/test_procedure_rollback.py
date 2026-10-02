"""
Tests for procedure workflow definitions and rollback logic.

Covers:
- WorkflowDefinition structural integrity
- rollback_entity() field-clearing behavior
- Edge cases (invalid statuses, terminal states, no-op rollbacks)
"""

import pytest
from types import SimpleNamespace

from app.services.workflow_definitions import (
    WORKFLOW_DEFINITIONS,
    WorkflowDefinition,
    StatusMilestone,
    LOAN_IN_WORKFLOW,
    LOAN_OUT_WORKFLOW,
    ACQUISITION_WORKFLOW,
    OBJECT_EXIT_WORKFLOW,
    DEACCESSION_WORKFLOW,
)
from app.services.status_transitions import rollback_entity, InvalidTransitionError


# ============================================================================
# Helpers
# ============================================================================


def _make_entity(**kwargs):
    """Create a mock entity with settable attributes."""
    defaults = {
        "status": "requested",
        "updated_by": None,
        "updated_at": None,
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


# ============================================================================
# WorkflowDefinition Structural Integrity
# ============================================================================


class TestWorkflowDefinitionIntegrity:
    """Verify all workflow definitions are internally consistent."""

    @pytest.mark.parametrize("entity_type", list(WORKFLOW_DEFINITIONS.keys()))
    def test_status_order_is_subset_of_valid_statuses(self, entity_type):
        """Every status in status_order must also appear in valid_statuses."""
        wf = WORKFLOW_DEFINITIONS[entity_type]
        for status in wf.status_order:
            assert status in wf.valid_statuses, (
                f"{entity_type}: status_order contains '{status}' "
                f"which is not in valid_statuses"
            )

    @pytest.mark.parametrize("entity_type", list(WORKFLOW_DEFINITIONS.keys()))
    def test_milestone_statuses_exist_in_status_order(self, entity_type):
        """Every milestone's status must exist in status_order."""
        wf = WORKFLOW_DEFINITIONS[entity_type]
        for milestone in wf.milestones:
            assert milestone.status in wf.status_order, (
                f"{entity_type}: milestone status '{milestone.status}' "
                f"not found in status_order"
            )

    @pytest.mark.parametrize("entity_type", list(WORKFLOW_DEFINITIONS.keys()))
    def test_fields_to_clear_are_strings(self, entity_type):
        """All fields_to_clear entries must be strings (attribute names)."""
        wf = WORKFLOW_DEFINITIONS[entity_type]
        for milestone in wf.milestones:
            for field_name in milestone.fields_to_clear:
                assert isinstance(field_name, str), (
                    f"{entity_type}: milestone '{milestone.status}' has "
                    f"non-string field_to_clear: {field_name!r}"
                )

    def test_all_entity_types_are_unique(self):
        """No duplicate entity_type values across definitions."""
        types = [wf.entity_type for wf in WORKFLOW_DEFINITIONS.values()]
        assert len(types) == len(set(types))

    def test_expected_workflows_exist(self):
        """All expected procedures have workflow definitions."""
        expected = {"loan_in", "loan_out", "acquisition", "object_exit", "deaccession"}
        actual = set(WORKFLOW_DEFINITIONS.keys())
        assert expected.issubset(actual), (
            f"Missing workflow definitions: {expected - actual}"
        )

    @pytest.mark.parametrize("entity_type", list(WORKFLOW_DEFINITIONS.keys()))
    def test_milestones_ordered_by_status_order(self, entity_type):
        """Milestones should appear in the same order as status_order."""
        wf = WORKFLOW_DEFINITIONS[entity_type]
        if len(wf.milestones) < 2:
            return
        indices = [wf.status_order.index(m.status) for m in wf.milestones]
        assert indices == sorted(indices), (
            f"{entity_type}: milestones are not ordered by status_order"
        )


# ============================================================================
# rollback_entity() — Core Behavior
# ============================================================================


class TestRollbackEntity:
    """Tests for the generic rollback_entity() function."""

    def test_valid_rollback_returns_old_status(self):
        """rollback_entity returns the old status string."""
        entity = _make_entity(status="approved", approval_date="2024-01-15", approved_by="user-1")
        old = rollback_entity(entity, "requested", LOAN_IN_WORKFLOW, "user-2")
        assert old == "approved"

    def test_valid_rollback_sets_new_status(self):
        """Entity's status is updated to target."""
        entity = _make_entity(status="approved")
        rollback_entity(entity, "requested", LOAN_IN_WORKFLOW, "user-2")
        assert entity.status == "requested"

    def test_valid_rollback_sets_updated_by(self):
        """Entity's updated_by is set to the acting user."""
        entity = _make_entity(status="approved")
        rollback_entity(entity, "requested", LOAN_IN_WORKFLOW, "user-2")
        assert entity.updated_by == "user-2"

    def test_valid_rollback_sets_updated_at(self):
        """Entity's updated_at is set to a datetime."""
        from datetime import datetime
        entity = _make_entity(status="approved")
        rollback_entity(entity, "requested", LOAN_IN_WORKFLOW, "user-2")
        assert isinstance(entity.updated_at, datetime)

    def test_invalid_status_raises(self):
        """Invalid target_status raises InvalidTransitionError."""
        entity = _make_entity(status="approved")
        with pytest.raises(InvalidTransitionError, match="Invalid target status"):
            rollback_entity(entity, "nonexistent", LOAN_IN_WORKFLOW, "user-2")

    def test_rollback_to_same_status_is_noop(self):
        """Rolling back to current status doesn't clear fields."""
        entity = _make_entity(
            status="approved",
            approval_date="2024-01-15",
            approved_by="user-1",
        )
        rollback_entity(entity, "approved", LOAN_IN_WORKFLOW, "user-2")
        assert entity.status == "approved"
        assert entity.approval_date == "2024-01-15"
        assert entity.approved_by == "user-1"


# ============================================================================
# rollback_entity() — Milestone Field Clearing
# ============================================================================


class TestMilestoneFieldClearing:
    """Verify correct fields are cleared when rolling back past milestones."""

    def test_loan_in_rollback_past_approved_clears_approval_fields(self):
        """Rolling back past 'approved' clears approval_date and approved_by."""
        entity = _make_entity(
            status="approved",
            approval_date="2024-01-15",
            approved_by="user-1",
        )
        rollback_entity(entity, "requested", LOAN_IN_WORKFLOW, "user-2")
        assert entity.approval_date is None
        assert entity.approved_by is None

    def test_loan_in_rollback_past_agreement_signed_clears_date(self):
        """Rolling back past 'agreement_signed' clears loan_agreement_signed_date."""
        entity = _make_entity(
            status="agreement_signed",
            approval_date="2024-01-15",
            approved_by="user-1",
            loan_agreement_signed_date="2024-02-01",
        )
        rollback_entity(entity, "requested", LOAN_IN_WORKFLOW, "user-2")
        assert entity.loan_agreement_signed_date is None

    def test_loan_in_rollback_from_closed_clears_all_milestones(self):
        """Rolling back from 'closed' to 'requested' clears all milestone fields."""
        entity = _make_entity(
            status="closed",
            approval_date="2024-01-15",
            approved_by="user-1",
            loan_agreement_signed_date="2024-02-01",
            actual_receipt_date="2024-03-01",
            actual_return_date="2024-06-01",
            conditions_met_confirmed=True,
            conditions_met_date="2024-06-15",
            conditions_met_note="All good",
            receipt_acknowledged=True,
            receipt_acknowledged_date="2024-06-20",
            receipt_acknowledged_reference="REF-001",
            closing_invoice_sent=True,
            closing_invoice_date="2024-07-01",
            closing_invoice_reference="INV-001",
            closing_invoice_amount=500.00,
            closing_note="Closed successfully",
        )
        rollback_entity(entity, "requested", LOAN_IN_WORKFLOW, "user-2")

        # All milestone fields should be cleared
        assert entity.approval_date is None
        assert entity.approved_by is None
        assert entity.loan_agreement_signed_date is None
        assert entity.actual_receipt_date is None
        assert entity.actual_return_date is None
        assert entity.conditions_met_date is None
        assert entity.closing_invoice_date is None

        # Reset fields should have their default values
        assert entity.conditions_met_confirmed is False
        assert entity.receipt_acknowledged is False
        assert entity.closing_invoice_sent is False

    def test_loan_in_rollback_to_on_loan_preserves_earlier_milestones(self):
        """Rolling back to 'on_loan' preserves approval/agreement/receipt fields."""
        entity = _make_entity(
            status="closed",
            approval_date="2024-01-15",
            approved_by="user-1",
            loan_agreement_signed_date="2024-02-01",
            actual_receipt_date="2024-03-01",
            actual_return_date="2024-06-01",
            conditions_met_confirmed=True,
        )
        rollback_entity(entity, "on_loan", LOAN_IN_WORKFLOW, "user-2")

        # Earlier milestones preserved
        assert entity.approval_date == "2024-01-15"
        assert entity.approved_by == "user-1"
        assert entity.loan_agreement_signed_date == "2024-02-01"
        assert entity.actual_receipt_date == "2024-03-01"

        # Later milestones cleared
        assert entity.actual_return_date is None
        assert entity.conditions_met_confirmed is False

    def test_acquisition_rollback_past_approved(self):
        """Acquisition rollback past 'approved' clears authorization fields."""
        entity = _make_entity(
            status="completed",
            authorization_date="2024-01-15",
            authorization_id="auth-1",
            completed_date="2024-03-01",
        )
        rollback_entity(entity, "proposed", ACQUISITION_WORKFLOW, "user-2")
        assert entity.authorization_date is None
        assert entity.authorization_id is None
        assert entity.completed_date is None

    def test_object_exit_rollback_past_acknowledged(self):
        """ObjectExit rollback past 'acknowledged' clears receipt fields."""
        entity = _make_entity(
            status="acknowledged",
            receipt_acknowledged=True,
            receipt_acknowledged_date="2024-01-15",
            receipt_acknowledged_by="user-1",
            receipt_reference="REF-001",
            receipt_note="Received",
        )
        rollback_entity(entity, "pending", OBJECT_EXIT_WORKFLOW, "user-2")
        assert entity.receipt_acknowledged is False
        assert entity.receipt_acknowledged_date is None
        assert entity.receipt_acknowledged_by is None
        assert entity.receipt_reference is None
        assert entity.receipt_note is None

    def test_deaccession_rollback_past_committee_reviewed(self):
        """Deaccession rollback past 'committee_reviewed' clears committee fields."""
        entity = _make_entity(
            status="approved",
            committee_review_date="2024-01-15",
            committee_recommendation="approved",
            committee_note="Unanimous",
            board_approval_date="2024-02-01",
            board_approval_reference="BD-001",
            board_resolution="Approved",
            board_note="Passed",
        )
        rollback_entity(entity, "proposed", DEACCESSION_WORKFLOW, "user-2")
        assert entity.committee_review_date is None
        assert entity.committee_recommendation is None
        assert entity.board_approval_date is None
        assert entity.board_resolution is None


# ============================================================================
# Edge Cases
# ============================================================================


class TestRollbackEdgeCases:
    """Edge cases and boundary conditions."""

    def test_entity_with_status_not_in_status_order(self):
        """Entity with a status not in status_order (e.g., 'cancelled') can still be rolled back."""
        entity = _make_entity(status="cancelled")
        old = rollback_entity(entity, "requested", LOAN_IN_WORKFLOW, "user-2")
        assert old == "cancelled"
        assert entity.status == "requested"

    def test_rollback_to_terminal_status(self):
        """Can roll back to 'cancelled' (valid status, even though terminal)."""
        entity = _make_entity(status="approved")
        rollback_entity(entity, "cancelled", LOAN_IN_WORKFLOW, "user-2")
        assert entity.status == "cancelled"

    def test_loan_out_workflow_exists(self):
        """LoanOut workflow exists in registry with expected status count."""
        wf = WORKFLOW_DEFINITIONS["loan_out"]
        assert wf.entity_type == "loan_out"
        assert len(wf.valid_statuses) == 12
        assert len(wf.status_order) == 10
        assert len(wf.milestones) == 5

    def test_fields_to_reset_sets_values(self):
        """fields_to_reset sets specific values (not None)."""
        entity = _make_entity(
            status="closed",
            conditions_met_confirmed=True,
            receipt_acknowledged=True,
            closing_invoice_sent=True,
            # Need all cleared fields too
            conditions_met_date="2024-01-01",
            conditions_met_note="ok",
            receipt_acknowledged_date="2024-01-01",
            receipt_acknowledged_reference="ref",
            closing_invoice_date="2024-01-01",
            closing_invoice_reference="ref",
            closing_invoice_amount=100,
            closing_note="done",
            # Earlier milestones
            actual_return_date="2024-01-01",
        )
        rollback_entity(entity, "on_loan", LOAN_IN_WORKFLOW, "user-2")

        # These should be False (reset), not None (cleared)
        assert entity.conditions_met_confirmed is False
        assert entity.receipt_acknowledged is False
        assert entity.closing_invoice_sent is False
