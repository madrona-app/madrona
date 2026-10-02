"""Acquisition requirements."""
from __future__ import annotations

from app.services.procedure_requirements import (
    ProcedureRequirements,
    ProcedureRequirement,
    ProcedureRequirementGroup,
    _register,
)
from app.services.workflow_definitions import WORKFLOW_DEFINITIONS

_status_order = WORKFLOW_DEFINITIONS["acquisition"].status_order

ACQUISITION_REQUIREMENTS = _register(
    ProcedureRequirements(
        procedure_type="acquisition",
        procedure_label="Acquisition",
        procedure="Acquisition",
        status_order=_status_order,
        requirement_groups=[
            ProcedureRequirementGroup(
                id="acquisition",
                label="Acquisition Information",
                section_id="acquisition",
                requirements=[
                    ProcedureRequirement(
                        id="acquisition_method",
                        label="Acquisition method",
                        group_id="acquisition",
                        field_paths=["acquisition_method"],
                        required_for_statuses=["approved", "completed"],
                        severity="blocking",
                        help_text="How the object is being acquired (gift, purchase, bequest, etc.).",
                    ),
                    ProcedureRequirement(
                        id="acquisition_date",
                        label="Acquisition date",
                        group_id="acquisition",
                        field_paths=["acquisition_date"],
                        required_for_statuses=["completed"],
                        severity="recommended",
                        help_text="The date the acquisition was finalized.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="source",
                label="Source Information",
                section_id="source",
                requirements=[
                    ProcedureRequirement(
                        id="source_id",
                        label="Source",
                        group_id="source",
                        field_paths=["source_id"],
                        required_for_statuses=["approved", "completed"],
                        severity="blocking",
                        help_text="The person or organization from whom the object is acquired.",
                    ),
                    ProcedureRequirement(
                        id="source_type",
                        label="Source type",
                        group_id="source",
                        field_paths=["source_type"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Type of source (individual, institution, estate, etc.).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="financial",
                label="Financial Information",
                section_id="financial",
                requirements=[
                    ProcedureRequirement(
                        id="cost",
                        label="Cost/Value",
                        group_id="financial",
                        field_paths=["cost"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="The purchase price or assessed value of the acquisition.",
                    ),
                    ProcedureRequirement(
                        id="funding_source",
                        label="Funding source",
                        group_id="financial",
                        field_paths=["funding_source"],
                        required_for_statuses=[],
                        severity="info",
                        help_text="The source of funds for the acquisition.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="legal",
                label="Legal & Provenance",
                section_id="legal",
                requirements=[
                    ProcedureRequirement(
                        id="legal_status",
                        label="Legal status",
                        group_id="legal",
                        field_paths=["legal_status"],
                        required_for_statuses=["completed"],
                        severity="blocking",
                        help_text="Confirmation of clear legal title for acquisition.",
                    ),
                    ProcedureRequirement(
                        id="credit_line",
                        label="Credit line",
                        group_id="legal",
                        field_paths=["credit_line"],
                        required_for_statuses=["completed"],
                        severity="recommended",
                        help_text="The donor credit line for display and publication.",
                    ),
                    ProcedureRequirement(
                        id="provenance_verified",
                        label="Provenance verified",
                        group_id="legal",
                        field_paths=["provenance_verified"],
                        required_for_statuses=["completed"],
                        severity="recommended",
                        help_text="Confirmation that provenance research has been completed.",
                    ),
                    ProcedureRequirement(
                        id="signed_transfer_of_title",
                        label="Signed transfer of title",
                        group_id="legal",
                        field_paths=["signed_document_types"],
                        required_for_statuses=["completed"],
                        severity="blocking",
                        help_text="Acquisition requires a signature confirming transfer of title. Attach the signed deed of gift, bill of sale, or transfer document.",
                        has_predicate=True,
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="boardApproval",
                label="Board Approval",
                section_id="boardApproval",
                requirements=[
                    ProcedureRequirement(
                        id="board_approval_date",
                        label="Board approval date",
                        group_id="boardApproval",
                        field_paths=["board_approval_date"],
                        required_for_statuses=[],
                        severity="info",
                        help_text="Date the board approved this acquisition (if board approval is required).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="documentation",
                label="Documentation",
                section_id="documentation",
                requirements=[
                    ProcedureRequirement(
                        id="deed_of_gift_date",
                        label="Deed of gift date",
                        group_id="documentation",
                        field_paths=["deed_of_gift_date"],
                        required_for_statuses=["completed"],
                        severity="blocking",
                        help_text="Date the deed of gift or transfer agreement was signed.",
                    ),
                    ProcedureRequirement(
                        id="authorization_date",
                        label="Authorization date",
                        group_id="documentation",
                        field_paths=["authorization_date"],
                        required_for_statuses=["completed"],
                        severity="blocking",
                        help_text="Date the acquisition was formally authorized.",
                    ),
                    ProcedureRequirement(
                        id="deed_of_gift_reference",
                        label="Deed of gift reference",
                        group_id="documentation",
                        field_paths=["deed_of_gift_reference"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Reference number for the deed of gift document.",
                    ),
                ],
            ),
        ],
    )
)
