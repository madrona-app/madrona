"""Documentation Planning requirements."""
from __future__ import annotations

from app.services.procedure_requirements import (
    ProcedureRequirements,
    ProcedureRequirement,
    ProcedureRequirementGroup,
    _register,
)

# doc_plan is not in WORKFLOW_DEFINITIONS — define status_order inline.
_status_order = ["draft", "approved", "in_progress", "completed"]

DOC_PLAN_REQUIREMENTS = _register(
    ProcedureRequirements(
        procedure_type="doc_plan",
        procedure_label="Documentation Plan",
        procedure="Documentation Planning",
        status_order=_status_order,
        requirement_groups=[
            ProcedureRequirementGroup(
                id="basic",
                label="Plan Information",
                section_id="basic",
                requirements=[
                    ProcedureRequirement(
                        id="title",
                        label="Plan title",
                        group_id="basic",
                        field_paths=["title"],
                        required_for_statuses=["approved", "in_progress", "completed"],
                        severity="blocking",
                        help_text="A descriptive title for the documentation plan.",
                    ),
                    ProcedureRequirement(
                        id="plan_type",
                        label="Plan type",
                        group_id="basic",
                        field_paths=["plan_type"],
                        required_for_statuses=["approved", "in_progress", "completed"],
                        severity="blocking",
                        help_text="The type of documentation plan (collection-wide, project, thematic, etc.).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="content",
                label="Objectives & Actions",
                section_id="content",
                requirements=[
                    ProcedureRequirement(
                        id="objectives",
                        label="Objectives",
                        group_id="content",
                        field_paths=["objectives"],
                        required_for_statuses=["approved", "in_progress", "completed"],
                        severity="blocking",
                        help_text="Specific, achievable objectives for the plan (minimum standard).",
                    ),
                    ProcedureRequirement(
                        id="measurable_results",
                        label="Measurable results",
                        group_id="content",
                        field_paths=["measurable_results"],
                        required_for_statuses=["approved", "in_progress", "completed"],
                        severity="recommended",
                        help_text="Measurable results to evaluate success (minimum standard).",
                        has_predicate=True,
                    ),
                    ProcedureRequirement(
                        id="actions",
                        label="Actions",
                        group_id="content",
                        field_paths=["actions"],
                        required_for_statuses=["in_progress"],
                        severity="recommended",
                        help_text="Concrete actions to achieve the objectives.",
                        has_predicate=True,
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="timeline",
                label="Timeline",
                section_id="timeline",
                requirements=[
                    ProcedureRequirement(
                        id="start_date",
                        label="Start date",
                        group_id="timeline",
                        field_paths=["start_date"],
                        required_for_statuses=["approved", "in_progress", "completed"],
                        severity="blocking",
                        help_text="Planned start date (Procedure: realistic timeframe).",
                    ),
                    ProcedureRequirement(
                        id="end_date",
                        label="End date",
                        group_id="timeline",
                        field_paths=["end_date"],
                        required_for_statuses=["approved", "in_progress", "completed"],
                        severity="blocking",
                        help_text="Planned end date (Procedure: realistic timeframe).",
                    ),
                    ProcedureRequirement(
                        id="review_frequency",
                        label="Review frequency",
                        group_id="timeline",
                        field_paths=["review_frequency"],
                        required_for_statuses=["in_progress"],
                        severity="recommended",
                        help_text="How often progress will be reviewed (Procedure: regularly review progress).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="resources",
                label="Resources",
                section_id="resources",
                requirements=[
                    ProcedureRequirement(
                        id="resources_required",
                        label="Resources required",
                        group_id="resources",
                        field_paths=["resources_required"],
                        required_for_statuses=["approved"],
                        severity="recommended",
                        help_text="Staff, funding, and other resources needed (minimum standard).",
                        has_predicate=True,
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="approval",
                label="Approval",
                section_id="basic",
                requirements=[
                    ProcedureRequirement(
                        id="approved_by",
                        label="Approved by",
                        group_id="approval",
                        field_paths=["approved_by"],
                        required_for_statuses=["in_progress", "completed"],
                        severity="blocking",
                        help_text="Who approved this plan (Procedure: get plan approved by governing body).",
                    ),
                    ProcedureRequirement(
                        id="approval_date",
                        label="Approval date",
                        group_id="approval",
                        field_paths=["approval_date"],
                        required_for_statuses=["in_progress", "completed"],
                        severity="recommended",
                        help_text="When the plan was approved.",
                    ),
                ],
            ),
        ],
    )
)
