"""Collections Review requirements."""
from __future__ import annotations

from app.services.procedure_requirements import (
    ProcedureRequirements,
    ProcedureRequirement,
    ProcedureRequirementGroup,
    _register,
)

_status_order = ["draft", "approved", "in_progress", "completed", "cancelled"]

COLLECTIONS_REVIEW_REQUIREMENTS = _register(
    ProcedureRequirements(
        procedure_type="collections_review",
        procedure_label="Collections Review",
        procedure="Collections Review",
        status_order=_status_order,
        requirement_groups=[
            ProcedureRequirementGroup(
                id="overview",
                label="Overview",
                section_id="overview",
                requirements=[
                    ProcedureRequirement(
                        id="title",
                        label="Title",
                        group_id="overview",
                        field_paths=["title"],
                        required_for_statuses=["draft", "approved", "in_progress", "completed", "cancelled"],
                        severity="blocking",
                        help_text="Title of the collections review (Procedure: Review title).",
                    ),
                    ProcedureRequirement(
                        id="review_type",
                        label="Review type",
                        group_id="overview",
                        field_paths=["review_type"],
                        required_for_statuses=["draft", "approved", "in_progress", "completed", "cancelled"],
                        severity="blocking",
                        help_text="Type of collections review (Procedure: Review type).",
                    ),
                    ProcedureRequirement(
                        id="review_reason",
                        label="Review reason",
                        group_id="overview",
                        field_paths=["review_reason"],
                        required_for_statuses=["approved", "in_progress", "completed", "cancelled"],
                        severity="blocking",
                        help_text="Reason for the collections review (Procedure: Review reason).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="scope",
                label="Scope",
                section_id="scope",
                requirements=[
                    ProcedureRequirement(
                        id="scope_description",
                        label="Scope description",
                        group_id="scope",
                        field_paths=["scope_description"],
                        required_for_statuses=["approved", "in_progress", "completed", "cancelled"],
                        severity="blocking",
                        help_text="Description of the review scope (Procedure: Review scope).",
                    ),
                    ProcedureRequirement(
                        id="methodology",
                        label="Methodology",
                        group_id="scope",
                        field_paths=["methodology"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Methodology used for the review (Procedure: Review methodology).",
                    ),
                    ProcedureRequirement(
                        id="assessment_criteria",
                        label="Assessment criteria",
                        group_id="scope",
                        field_paths=["assessment_criteria"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Criteria used for assessment (Procedure: Assessment criteria).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="team",
                label="Team",
                section_id="team",
                requirements=[
                    ProcedureRequirement(
                        id="review_lead_id",
                        label="Review lead",
                        group_id="team",
                        field_paths=["review_lead_id"],
                        required_for_statuses=["in_progress", "completed", "cancelled"],
                        severity="recommended",
                        help_text="Person leading the review (Procedure: Review lead).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="timeline",
                label="Timeline",
                section_id="timeline",
                requirements=[
                    ProcedureRequirement(
                        id="planned_start_date",
                        label="Planned start date",
                        group_id="timeline",
                        field_paths=["planned_start_date"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Planned start date of the review.",
                    ),
                    ProcedureRequirement(
                        id="planned_end_date",
                        label="Planned end date",
                        group_id="timeline",
                        field_paths=["planned_end_date"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Planned end date of the review.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="findings",
                label="Findings",
                section_id="findings",
                requirements=[
                    ProcedureRequirement(
                        id="findings_summary",
                        label="Findings summary",
                        group_id="findings",
                        field_paths=["findings_summary"],
                        required_for_statuses=["completed"],
                        severity="blocking",
                        help_text="Summary of review findings (Procedure: Review findings).",
                    ),
                    ProcedureRequirement(
                        id="recommendations",
                        label="Recommendations",
                        group_id="findings",
                        field_paths=["recommendations"],
                        required_for_statuses=["completed"],
                        severity="recommended",
                        help_text="Recommendations arising from the review (Procedure: Review recommendations).",
                    ),
                ],
            ),
        ],
    )
)
