"""
Centralized workflow status definitions for procedures.

Single source of truth for valid statuses, status ordering, and
milestone-based field-clearing rules used by rollback operations.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class StatusMilestone:
    """A milestone in a workflow that gates certain fields.

    When rolling back past this milestone, all fields in `fields_to_clear`
    are set to None and all fields in `fields_to_reset` are set to their
    specified default values.
    """
    status: str
    fields_to_clear: list[str] = field(default_factory=list)
    fields_to_reset: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class WorkflowDefinition:
    """Defines the status lifecycle for a procedure type."""
    entity_type: str
    valid_statuses: list[str]
    status_order: list[str]
    milestones: list[StatusMilestone] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Workflow definitions — one per procedure type
# ---------------------------------------------------------------------------

LOAN_IN_WORKFLOW = WorkflowDefinition(
    entity_type="loan_in",
    valid_statuses=[
        "requested", "pending_approval", "approved", "agreement_sent",
        "agreement_signed", "in_transit", "received", "on_loan",
        "return_initiated", "returned", "closed", "cancelled", "overdue",
    ],
    status_order=[
        "requested", "pending_approval", "approved", "agreement_sent",
        "agreement_signed", "in_transit", "received", "on_loan",
        "returned", "closed",
    ],
    milestones=[
        StatusMilestone(
            status="approved",
            fields_to_clear=["approval_date", "approved_by"],
        ),
        StatusMilestone(
            status="agreement_signed",
            fields_to_clear=["loan_agreement_signed_date"],
        ),
        StatusMilestone(
            status="received",
            fields_to_clear=["actual_receipt_date"],
        ),
        StatusMilestone(
            status="returned",
            fields_to_clear=["actual_return_date"],
        ),
        StatusMilestone(
            status="closed",
            fields_to_clear=[
                "conditions_met_date", "conditions_met_note",
                "receipt_acknowledged_date", "receipt_acknowledged_reference",
                "closing_invoice_date", "closing_invoice_reference",
                "closing_invoice_amount", "closing_note",
            ],
            fields_to_reset={
                "conditions_met_confirmed": False,
                "receipt_acknowledged": False,
                "closing_invoice_sent": False,
            },
        ),
    ],
)

LOAN_OUT_WORKFLOW = WorkflowDefinition(
    entity_type="loan_out",
    valid_statuses=[
        "requested", "pending_approval", "approved", "agreement_sent",
        "agreement_signed", "in_transit", "on_loan", "return_scheduled",
        "returned", "closed", "declined", "cancelled",
    ],
    status_order=[
        "requested", "pending_approval", "approved", "agreement_sent",
        "agreement_signed", "in_transit", "on_loan", "return_scheduled",
        "returned", "closed",
    ],
    milestones=[
        StatusMilestone(
            status="approved",
            fields_to_clear=["approval_date", "approved_by"],
        ),
        StatusMilestone(
            status="agreement_signed",
            fields_to_clear=["loan_agreement_signed_date"],
        ),
        StatusMilestone(
            status="in_transit",
            fields_to_clear=["actual_dispatch_date"],
        ),
        StatusMilestone(
            status="returned",
            fields_to_clear=["actual_return_date"],
        ),
        StatusMilestone(
            status="closed",
            fields_to_clear=[
                "conditions_met_date", "conditions_met_note",
                "receipt_acknowledged_date", "receipt_acknowledged_reference",
                "closing_invoice_date", "closing_invoice_reference",
                "closing_invoice_amount", "closing_note",
            ],
            fields_to_reset={
                "conditions_met_confirmed": False,
                "receipt_acknowledged": False,
                "closing_invoice_sent": False,
            },
        ),
    ],
)

ACQUISITION_WORKFLOW = WorkflowDefinition(
    entity_type="acquisition",
    valid_statuses=["proposed", "approved", "completed", "cancelled"],
    status_order=["proposed", "approved", "completed"],
    milestones=[
        StatusMilestone(
            status="approved",
            fields_to_clear=["authorization_date", "authorization_id"],
        ),
        StatusMilestone(
            status="completed",
            fields_to_clear=["completed_date"],
        ),
    ],
)

OBJECT_EXIT_WORKFLOW = WorkflowDefinition(
    entity_type="object_exit",
    valid_statuses=[
        "pending", "preparing", "dispatched", "in_transit",
        "acknowledged", "cancelled",
    ],
    status_order=[
        "pending", "preparing", "dispatched", "in_transit", "acknowledged",
    ],
    milestones=[
        StatusMilestone(
            status="acknowledged",
            fields_to_clear=[
                "receipt_acknowledged_date", "receipt_acknowledged_by",
                "receipt_reference", "receipt_note",
            ],
            fields_to_reset={
                "receipt_acknowledged": False,
            },
        ),
    ],
)

DEACCESSION_WORKFLOW = WorkflowDefinition(
    entity_type="deaccession",
    valid_statuses=[
        "proposed", "under_review", "committee_reviewed", "pending_board",
        "approved", "in_progress", "completed", "cancelled", "rejected",
    ],
    status_order=[
        "proposed", "under_review", "committee_reviewed", "pending_board",
        "approved", "in_progress", "completed",
    ],
    milestones=[
        StatusMilestone(
            status="committee_reviewed",
            fields_to_clear=[
                "committee_review_date", "committee_recommendation",
                "committee_note",
            ],
        ),
        StatusMilestone(
            status="approved",
            fields_to_clear=[
                "board_approval_date", "board_approval_reference",
                "board_resolution", "board_note",
            ],
        ),
        StatusMilestone(
            status="completed",
            fields_to_clear=["completion_date", "deaccession_date"],
        ),
    ],
)


# ---------------------------------------------------------------------------
# Status-only definitions (no rollback milestones — status ordering only)
# ---------------------------------------------------------------------------

OBJECT_ENTRY_WORKFLOW = WorkflowDefinition(
    entity_type="object_entry",
    valid_statuses=[
        "pending", "received", "processing", "processed",
        "returned", "acquired",
    ],
    status_order=[
        "pending", "received", "processing", "processed",
    ],
)

CONSERVATION_WORKFLOW = WorkflowDefinition(
    entity_type="conservation",
    valid_statuses=[
        "proposed", "under_review", "committee_reviewed", "pending_board",
        "approved", "in_progress", "completed", "cancelled", "rejected",
    ],
    status_order=[
        "proposed", "under_review", "committee_reviewed", "pending_board",
        "approved", "in_progress", "completed",
    ],
)

MOVEMENT_WORKFLOW = WorkflowDefinition(
    entity_type="movement",
    valid_statuses=["pending", "in_transit", "completed", "cancelled"],
    status_order=["pending", "in_transit", "completed"],
)


# ---------------------------------------------------------------------------
# Registry — look up by entity_type string
# ---------------------------------------------------------------------------

WORKFLOW_DEFINITIONS: dict[str, WorkflowDefinition] = {
    wf.entity_type: wf
    for wf in [
        LOAN_IN_WORKFLOW,
        LOAN_OUT_WORKFLOW,
        ACQUISITION_WORKFLOW,
        OBJECT_EXIT_WORKFLOW,
        DEACCESSION_WORKFLOW,
        OBJECT_ENTRY_WORKFLOW,
        CONSERVATION_WORKFLOW,
        MOVEMENT_WORKFLOW,
    ]
}
