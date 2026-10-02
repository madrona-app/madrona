"""Deaccessioning and Disposal requirements."""
from __future__ import annotations

from app.services.procedure_requirements import (
    ProcedureRequirements,
    ProcedureRequirement,
    ProcedureRequirementGroup,
    _register,
)
from app.services.workflow_definitions import WORKFLOW_DEFINITIONS

_status_order = WORKFLOW_DEFINITIONS["deaccession"].status_order

DEACCESSION_REQUIREMENTS = _register(
    ProcedureRequirements(
        procedure_type="deaccession",
        procedure_label="Deaccession",
        procedure="Deaccessioning and Disposal",
        status_order=_status_order,
        requirement_groups=[
            ProcedureRequirementGroup(
                id="linkedObject",
                label="Collection Object",
                section_id="linkedObject",
                requirements=[
                    ProcedureRequirement(
                        id="object_id",
                        label="Object",
                        group_id="linkedObject",
                        field_paths=["object_id"],
                        required_for_statuses=[
                            "under_review", "committee_reviewed", "pending_board",
                            "approved", "in_progress", "completed",
                        ],
                        severity="blocking",
                        help_text="The collection object being deaccessioned.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="info",
                label="Deaccession Information",
                section_id="info",
                requirements=[
                    ProcedureRequirement(
                        id="proposal_date",
                        label="Proposal date",
                        group_id="info",
                        field_paths=["proposal_date"],
                        required_for_statuses=["under_review"],
                        severity="blocking",
                        help_text="The date the deaccession was proposed.",
                    ),
                    ProcedureRequirement(
                        id="reason",
                        label="Reason",
                        group_id="info",
                        field_paths=["reason"],
                        required_for_statuses=["under_review", "committee_reviewed"],
                        severity="blocking",
                        help_text="The reason for deaccessioning the object.",
                    ),
                    ProcedureRequirement(
                        id="reason_detail",
                        label="Reason detail",
                        group_id="info",
                        field_paths=["reason_detail"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Additional detail about the deaccession reason.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="disposal",
                label="Disposal Method",
                section_id="disposal",
                requirements=[
                    ProcedureRequirement(
                        id="disposal_method",
                        label="Disposal method",
                        group_id="disposal",
                        field_paths=["disposal_method"],
                        required_for_statuses=["in_progress", "completed"],
                        severity="blocking",
                        help_text="How the object will be disposed of.",
                    ),
                    ProcedureRequirement(
                        id="recipient_name",
                        label="Recipient name",
                        group_id="disposal",
                        field_paths=["recipient_name"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="The person or organization receiving the object.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="committee",
                label="Committee Review",
                section_id="committee",
                requirements=[
                    ProcedureRequirement(
                        id="committee_review_date",
                        label="Committee review date",
                        group_id="committee",
                        field_paths=["committee_review_date"],
                        required_for_statuses=["committee_reviewed", "pending_board"],
                        severity="blocking",
                        help_text="The date of the committee review.",
                    ),
                    ProcedureRequirement(
                        id="committee_recommendation",
                        label="Committee recommendation",
                        group_id="committee",
                        field_paths=["committee_recommendation"],
                        required_for_statuses=["committee_reviewed", "pending_board"],
                        severity="blocking",
                        help_text="The committee's recommendation on the deaccession.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="board",
                label="Board Approval",
                section_id="board",
                requirements=[
                    ProcedureRequirement(
                        id="board_approval_date",
                        label="Board approval date",
                        group_id="board",
                        field_paths=["board_approval_date"],
                        required_for_statuses=["approved"],
                        severity="blocking",
                        help_text="The date of the board approval.",
                        has_predicate=True,
                    ),
                    ProcedureRequirement(
                        id="board_approval_reference",
                        label="Board approval reference",
                        group_id="board",
                        field_paths=["board_approval_reference"],
                        required_for_statuses=["approved"],
                        severity="recommended",
                        help_text="Reference number for the board approval.",
                        has_predicate=True,
                    ),
                    ProcedureRequirement(
                        id="signed_disposal_decision",
                        label="Signed disposal decision",
                        group_id="board",
                        field_paths=["signed_document_types"],
                        required_for_statuses=["approved"],
                        severity="blocking",
                        help_text="Deaccessioning requires the signature of the person with overall responsibility for the decision to dispose. Attach the signed board resolution or disposal decision.",
                        has_predicate=True,
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="legal",
                label="Legal & Provenance",
                section_id="legal",
                requirements=[
                    ProcedureRequirement(
                        id="legal_review_date",
                        label="Legal review date",
                        group_id="legal",
                        field_paths=["legal_review_date"],
                        required_for_statuses=["in_progress", "completed"],
                        severity="blocking",
                        help_text="The date of the legal review.",
                    ),
                    ProcedureRequirement(
                        id="provenance_review_complete",
                        label="Provenance review complete",
                        group_id="legal",
                        field_paths=["provenance_review_complete"],
                        required_for_statuses=["in_progress"],
                        severity="recommended",
                        help_text="Confirmation that provenance has been reviewed.",
                        has_predicate=True,
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="valuation",
                label="Valuation",
                section_id="valuation",
                requirements=[
                    ProcedureRequirement(
                        id="appraised_value",
                        label="Appraised value",
                        group_id="valuation",
                        field_paths=["appraised_value"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="The appraised value of the object.",
                    ),
                ],
            ),
        ],
    )
)
