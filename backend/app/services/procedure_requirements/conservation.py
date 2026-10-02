"""Collections Care and Conservation requirements."""
from __future__ import annotations

from app.services.procedure_requirements import (
    ProcedureRequirements,
    ProcedureRequirement,
    ProcedureRequirementGroup,
    _register,
)
from app.services.workflow_definitions import WORKFLOW_DEFINITIONS

_status_order = WORKFLOW_DEFINITIONS["conservation"].status_order

CONSERVATION_REQUIREMENTS = _register(
    ProcedureRequirements(
        procedure_type="conservation",
        procedure_label="Conservation Treatment",
        procedure="Collections Care and Conservation",
        status_order=_status_order,
        requirement_groups=[
            ProcedureRequirementGroup(
                id="object",
                label="Object",
                section_id="object",
                requirements=[
                    ProcedureRequirement(
                        id="object_id",
                        label="Object",
                        group_id="object",
                        field_paths=["object_id"],
                        required_for_statuses=["proposed", "under_review", "committee_reviewed", "pending_board", "approved", "in_progress", "completed"],
                        severity="blocking",
                        help_text="The object being treated (Procedure: Object identification information).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="proposal",
                label="Proposal",
                section_id="proposal",
                requirements=[
                    ProcedureRequirement(
                        id="treatment_type",
                        label="Treatment type",
                        group_id="proposal",
                        field_paths=["treatment_type"],
                        required_for_statuses=["proposed", "under_review", "committee_reviewed", "pending_board", "approved", "in_progress", "completed"],
                        severity="blocking",
                        help_text="Type of conservation treatment proposed (Procedure: Conservation treatment type).",
                    ),
                    ProcedureRequirement(
                        id="description",
                        label="Description",
                        group_id="proposal",
                        field_paths=["treatment_description"],
                        required_for_statuses=["approved", "in_progress", "completed"],
                        severity="blocking",
                        help_text="Detailed description of the proposed treatment (Procedure: Conservation treatment description).",
                    ),
                    ProcedureRequirement(
                        id="justification",
                        label="Justification",
                        group_id="proposal",
                        field_paths=["treatment_rationale"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Justification for the conservation treatment (Procedure: Conservation treatment justification).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="authorization",
                label="Authorization",
                section_id="authorization",
                requirements=[
                    ProcedureRequirement(
                        id="approved_by",
                        label="Approved by",
                        group_id="authorization",
                        field_paths=["approved_by"],
                        required_for_statuses=["approved", "in_progress", "completed"],
                        severity="blocking",
                        help_text="Who authorized the treatment (Procedure: Conservation treatment authorizer).",
                    ),
                    ProcedureRequirement(
                        id="approval_date",
                        label="Approval date",
                        group_id="authorization",
                        field_paths=["approval_date"],
                        required_for_statuses=["approved", "in_progress", "completed"],
                        severity="recommended",
                        help_text="When the treatment was authorized (Procedure: Conservation treatment authorization date).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="treatment",
                label="Treatment",
                section_id="treatment",
                requirements=[
                    ProcedureRequirement(
                        id="methods_used",
                        label="Methods used",
                        group_id="treatment",
                        field_paths=["methods_used"],
                        required_for_statuses=["completed"],
                        severity="recommended",
                        help_text="Methods used in treatment (Procedure: Conservation treatment method).",
                    ),
                    ProcedureRequirement(
                        id="materials_used",
                        label="Materials used",
                        group_id="treatment",
                        field_paths=["methods_used"],
                        required_for_statuses=[],
                        severity="info",
                        help_text="Materials used in treatment (Procedure: Conservation treatment materials).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="condition",
                label="Condition",
                section_id="condition",
                requirements=[
                    ProcedureRequirement(
                        id="condition_before_note",
                        label="Condition before",
                        group_id="condition",
                        field_paths=["condition_before_id"],
                        has_predicate=True,
                        required_for_statuses=["completed"],
                        severity="recommended",
                        help_text="Condition of the object before treatment (Procedure: Condition before treatment).",
                    ),
                    ProcedureRequirement(
                        id="condition_after_note",
                        label="Condition after",
                        group_id="condition",
                        field_paths=["condition_after_id"],
                        has_predicate=True,
                        required_for_statuses=["completed"],
                        severity="recommended",
                        help_text="Condition of the object after treatment (Procedure: Condition after treatment).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="cost",
                label="Cost",
                section_id="cost",
                requirements=[
                    ProcedureRequirement(
                        id="estimated_cost",
                        label="Estimated cost",
                        group_id="cost",
                        field_paths=["estimated_cost"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Estimated cost of the treatment.",
                    ),
                    ProcedureRequirement(
                        id="actual_cost",
                        label="Actual cost",
                        group_id="cost",
                        field_paths=["actual_cost"],
                        required_for_statuses=["completed"],
                        severity="recommended",
                        help_text="Actual cost of the treatment.",
                    ),
                ],
            ),
        ],
    )
)
