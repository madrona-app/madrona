"""Object Exit requirements."""
from __future__ import annotations

from app.services.procedure_requirements import (
    ProcedureRequirements,
    ProcedureRequirement,
    ProcedureRequirementGroup,
    _register,
)
from app.services.workflow_definitions import WORKFLOW_DEFINITIONS

_status_order = WORKFLOW_DEFINITIONS["object_exit"].status_order

OBJECT_EXIT_REQUIREMENTS = _register(
    ProcedureRequirements(
        procedure_type="object_exit",
        procedure_label="Object Exit",
        procedure="Object Exit",
        status_order=_status_order,
        requirement_groups=[
            ProcedureRequirementGroup(
                id="exit",
                label="Exit Information",
                section_id="exit",
                requirements=[
                    ProcedureRequirement(
                        id="exit_date",
                        label="Exit date",
                        group_id="exit",
                        field_paths=["exit_date"],
                        required_for_statuses=["preparing", "dispatched", "acknowledged"],
                        severity="blocking",
                        help_text="The date the objects are expected to or did leave.",
                    ),
                    ProcedureRequirement(
                        id="exit_reason",
                        label="Exit reason",
                        group_id="exit",
                        field_paths=["exit_reason"],
                        required_for_statuses=["preparing", "dispatched", "acknowledged"],
                        severity="blocking",
                        help_text="The reason for the objects leaving.",
                    ),
                    ProcedureRequirement(
                        id="exit_method",
                        label="Exit method",
                        group_id="exit",
                        field_paths=["exit_method"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="How the objects will leave (courier, post, collection).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="recipient",
                label="Recipient",
                section_id="recipient",
                requirements=[
                    ProcedureRequirement(
                        id="recipient_name",
                        label="Recipient name",
                        group_id="recipient",
                        field_paths=["recipient_name"],
                        required_for_statuses=["preparing", "dispatched", "acknowledged"],
                        severity="blocking",
                        help_text="The person or organization receiving the objects.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="condition",
                label="Condition",
                section_id="condition",
                requirements=[
                    ProcedureRequirement(
                        id="condition_at_exit",
                        label="Condition at exit",
                        group_id="condition",
                        field_paths=["condition_at_exit"],
                        required_for_statuses=["dispatched"],
                        severity="recommended",
                        help_text="The condition of objects when they leave.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="authorization",
                label="Authorization",
                section_id="authorization",
                requirements=[
                    ProcedureRequirement(
                        id="authorization_id",
                        label="Exit authorizer",
                        group_id="authorization",
                        field_paths=["authorization_id"],
                        required_for_statuses=["dispatched", "acknowledged"],
                        severity="blocking",
                        help_text="The person authorizing the exit in your organization (Procedure: Exit authorizer).",
                    ),
                    ProcedureRequirement(
                        id="authorization_date",
                        label="Authorization date",
                        group_id="authorization",
                        field_paths=["authorization_date"],
                        required_for_statuses=["dispatched", "acknowledged"],
                        severity="blocking",
                        help_text="The date the exit was authorized.",
                    ),
                    ProcedureRequirement(
                        id="authorization_note",
                        label="Authorization note",
                        group_id="authorization",
                        field_paths=["authorization_note"],
                        required_for_statuses=[],
                        severity="info",
                        help_text="Notes about the authorization.",
                    ),
                    ProcedureRequirement(
                        id="signed_exit_form",
                        label="Signed exit form",
                        group_id="authorization",
                        field_paths=["signed_document_types"],
                        required_for_statuses=["dispatched", "acknowledged"],
                        severity="recommended",
                        help_text="Object Exit requires the signature of the person receiving the objects.",
                        has_predicate=True,
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="receipt",
                label="Receipt Acknowledgment",
                section_id="receipt",
                requirements=[
                    ProcedureRequirement(
                        id="receipt_acknowledged",
                        label="Receipt acknowledged",
                        group_id="receipt",
                        field_paths=["receipt_acknowledged"],
                        required_for_statuses=["acknowledged"],
                        severity="blocking",
                        help_text="Confirmation that safe handover of objects has been acknowledged with a signature (minimum requirement).",
                        has_predicate=True,
                    ),
                    ProcedureRequirement(
                        id="receipt_reference",
                        label="Receipt reference",
                        group_id="receipt",
                        field_paths=["receipt_reference"],
                        required_for_statuses=["acknowledged"],
                        severity="recommended",
                        help_text="Reference for the receipt acknowledgment.",
                    ),
                ],
            ),
        ],
    )
)
