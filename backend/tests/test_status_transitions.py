"""
Tests for run status transition validation.

Tests the state machine that prevents invalid status transitions
(e.g., cannot go from "failed" to "running", terminal states are immutable).
"""

import pytest

from app.services.pipeline import validate_transition, ALLOWED_TRANSITIONS


class TestValidateTransition:
    """Tests for validate_transition() function."""

    def test_valid_transition_queued_to_running(self):
        """Test valid transition from queued to running."""
        is_valid, error_msg = validate_transition("queued", "running")
        assert is_valid is True
        assert error_msg is None

    def test_valid_transition_running_to_publishing(self):
        """Test valid transition from running to publishing."""
        is_valid, error_msg = validate_transition("running", "publishing")
        assert is_valid is True
        assert error_msg is None

    def test_valid_transition_publishing_to_success(self):
        """Test valid transition from publishing to success."""
        is_valid, error_msg = validate_transition("publishing", "success")
        assert is_valid is True
        assert error_msg is None

    def test_valid_transition_running_to_failed(self):
        """Test valid transition from running to failed."""
        is_valid, error_msg = validate_transition("running", "failed")
        assert is_valid is True
        assert error_msg is None

    def test_valid_transition_publishing_to_failed_publish(self):
        """Test valid transition from publishing to failed_publish."""
        is_valid, error_msg = validate_transition("publishing", "failed_publish")
        assert is_valid is True
        assert error_msg is None

    def test_self_transition_is_allowed(self):
        """Test that self-transitions (idempotent updates) are allowed."""
        is_valid, error_msg = validate_transition("running", "running")
        assert is_valid is True
        assert error_msg is None

        is_valid, error_msg = validate_transition("success", "success")
        assert is_valid is True
        assert error_msg is None

    def test_invalid_transition_from_terminal_failed(self):
        """Test that failed (terminal state) cannot transition."""
        is_valid, error_msg = validate_transition("failed", "running")
        assert is_valid is False
        assert "terminal state" in error_msg

    def test_invalid_transition_from_terminal_canceled(self):
        """Test that canceled (terminal state) cannot transition."""
        is_valid, error_msg = validate_transition("canceled", "running")
        assert is_valid is False
        assert "terminal state" in error_msg

    def test_invalid_transition_running_to_queued(self):
        """Test that running cannot go back to queued."""
        is_valid, error_msg = validate_transition("running", "queued")
        assert is_valid is False
        assert "Invalid transition" in error_msg
        assert "running" in error_msg
        assert "queued" in error_msg

    def test_invalid_transition_publishing_to_running(self):
        """Test that publishing cannot go back to running."""
        is_valid, error_msg = validate_transition("publishing", "running")
        assert is_valid is False
        assert "Invalid transition" in error_msg

    def test_success_cannot_transition_to_failed(self):
        """Test that success can only transition to rolled_back, not failed."""
        is_valid, error_msg = validate_transition("success", "failed")
        assert is_valid is False
        # success has ["rolled_back"] so it's not terminal; error says "Invalid transition"
        assert "Invalid transition" in error_msg

    def test_success_cannot_transition_to_running(self):
        """Test that success cannot transition back to running."""
        is_valid, error_msg = validate_transition("success", "running")
        assert is_valid is False
        assert "Invalid transition" in error_msg

    def test_unknown_old_status(self):
        """Test that unknown old_status returns error."""
        is_valid, error_msg = validate_transition("unknown_status", "running")
        assert is_valid is False
        assert "Unknown status" in error_msg
        assert "unknown_status" in error_msg


class TestTransitionMatrix:
    """Comprehensive tests for all allowed/disallowed transitions."""

    def test_true_terminal_states_have_no_allowed_transitions(self):
        """Verify that true terminal states have empty transition lists."""
        terminal_states = ["failed", "failed_publish", "failed_finalize", "canceled", "rolled_back"]

        for status in terminal_states:
            assert status in ALLOWED_TRANSITIONS, (
                f"Terminal state '{status}' missing from ALLOWED_TRANSITIONS"
            )
            assert ALLOWED_TRANSITIONS[status] == [], (
                f"Terminal state '{status}' should have no allowed transitions"
            )

    def test_success_and_warning_can_be_rolled_back(self):
        """success and warning are not fully terminal; they can be rolled back."""
        assert ALLOWED_TRANSITIONS["success"] == ["rolled_back"]
        assert ALLOWED_TRANSITIONS["warning"] == ["rolled_back"]

    def test_queued_allowed_transitions(self):
        """Test that queued can only transition to specific states."""
        expected = {"pending", "running", "canceled"}
        actual = set(ALLOWED_TRANSITIONS["queued"])
        assert actual == expected

    def test_pending_allowed_transitions(self):
        """Test that pending can only transition to specific states."""
        expected = {"running", "canceled"}
        actual = set(ALLOWED_TRANSITIONS["pending"])
        assert actual == expected

    def test_running_allowed_transitions(self):
        """Test that running can transition to publishing, success, warning, failed, or canceled."""
        expected = {"publishing", "success", "warning", "failed", "canceled"}
        actual = set(ALLOWED_TRANSITIONS["running"])
        assert actual == expected

    def test_publishing_allowed_transitions(self):
        """Test that publishing can transition to success, warning, failed_publish, or canceled."""
        expected = {"success", "warning", "failed_publish", "canceled"}
        actual = set(ALLOWED_TRANSITIONS["publishing"])
        assert actual == expected

    def test_no_reverse_transitions(self):
        """Test that no status can transition backward in the pipeline."""
        pipeline_order = ["queued", "pending", "running", "publishing"]

        for i, current in enumerate(pipeline_order):
            for previous in pipeline_order[:i]:
                is_valid, _ = validate_transition(current, previous)
                assert is_valid is False, (
                    f"Should not allow {current} -> {previous} (backward transition)"
                )

    def test_all_states_defined_in_transition_map(self):
        """Test that all known statuses are defined in ALLOWED_TRANSITIONS."""
        all_statuses = {
            "queued", "pending", "running", "publishing",
            "success", "warning", "failed", "failed_publish",
            "failed_finalize", "canceled", "rolled_back",
        }

        defined_statuses = set(ALLOWED_TRANSITIONS.keys())
        assert defined_statuses == all_statuses, (
            f"Missing or extra statuses: {defined_statuses ^ all_statuses}"
        )


class TestRollbackTransitions:
    """Tests for rollback transitions (success/warning -> rolled_back)."""

    def test_success_can_be_rolled_back(self):
        """Test that successful runs can be rolled back."""
        is_valid, error_msg = validate_transition("success", "rolled_back")
        assert is_valid is True
        assert error_msg is None

    def test_warning_can_be_rolled_back(self):
        """Test that warning runs can be rolled back."""
        is_valid, error_msg = validate_transition("warning", "rolled_back")
        assert is_valid is True
        assert error_msg is None

    def test_rolled_back_is_terminal(self):
        """Test that rolled_back is a true terminal state."""
        is_valid, error_msg = validate_transition("rolled_back", "running")
        assert is_valid is False
        assert "terminal state" in error_msg

    def test_failed_cannot_be_rolled_back(self):
        """Test that failed runs cannot be rolled back (terminal)."""
        is_valid, error_msg = validate_transition("failed", "rolled_back")
        assert is_valid is False
        assert "terminal state" in error_msg


class TestRepublishConstraints:
    """Tests specific to republish operation constraints."""

    def test_failed_publish_cannot_transition_to_running(self):
        """Test that failed_publish cannot go back to running."""
        is_valid, error_msg = validate_transition("failed_publish", "running")
        assert is_valid is False
        assert "terminal state" in error_msg

    def test_failed_publish_cannot_transition_to_publishing(self):
        """Test that failed_publish is terminal and cannot transition to publishing."""
        is_valid, error_msg = validate_transition("failed_publish", "publishing")
        assert is_valid is False
        assert "terminal state" in error_msg

    def test_success_cannot_be_republished(self):
        """Test that successful runs cannot go to publishing."""
        is_valid, error_msg = validate_transition("success", "publishing")
        assert is_valid is False
        assert "Invalid transition" in error_msg


class TestCancellationTransitions:
    """Tests for cancellation transitions."""

    def test_queued_can_be_canceled(self):
        """Test that queued runs can be canceled."""
        is_valid, error_msg = validate_transition("queued", "canceled")
        assert is_valid is True
        assert error_msg is None

    def test_pending_can_be_canceled(self):
        """Test that pending runs can be canceled."""
        is_valid, error_msg = validate_transition("pending", "canceled")
        assert is_valid is True
        assert error_msg is None

    def test_running_can_be_canceled(self):
        """Test that running runs can be canceled."""
        is_valid, error_msg = validate_transition("running", "canceled")
        assert is_valid is True
        assert error_msg is None

    def test_publishing_can_be_canceled(self):
        """Test that publishing runs can be canceled."""
        is_valid, error_msg = validate_transition("publishing", "canceled")
        assert is_valid is True
        assert error_msg is None

    def test_canceled_is_terminal(self):
        """Test that canceled runs cannot transition to any other state."""
        is_valid, error_msg = validate_transition("canceled", "running")
        assert is_valid is False
        assert "terminal state" in error_msg


class TestWarningState:
    """Tests for warning state transitions."""

    def test_running_can_transition_to_warning(self):
        """Test that running can transition to warning."""
        is_valid, error_msg = validate_transition("running", "warning")
        assert is_valid is True
        assert error_msg is None

    def test_publishing_can_transition_to_warning(self):
        """Test that publishing can transition to warning."""
        is_valid, error_msg = validate_transition("publishing", "warning")
        assert is_valid is True
        assert error_msg is None

    def test_warning_can_only_be_rolled_back(self):
        """Test that warning can only transition to rolled_back."""
        is_valid, error_msg = validate_transition("warning", "success")
        assert is_valid is False
        assert "Invalid transition" in error_msg

        is_valid, error_msg = validate_transition("warning", "rolled_back")
        assert is_valid is True
        assert error_msg is None
