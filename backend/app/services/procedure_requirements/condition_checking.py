"""Condition Checking and Technical Assessment requirements."""
from __future__ import annotations

from app.services.procedure_requirements import (
    ProcedureRequirements,
    ProcedureRequirement,
    ProcedureRequirementGroup,
    _register,
)

_status_order = ["draft", "completed", "reviewed", "superseded"]

CONDITION_CHECKING_REQUIREMENTS = _register(
    ProcedureRequirements(
        procedure_type="condition_report",
        procedure_label="Condition Report",
        procedure="Condition Checking and Technical Assessment",
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
                        required_for_statuses=["draft", "completed", "reviewed", "superseded"],
                        severity="blocking",
                        help_text="The object being assessed (Procedure: Object identification information).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="check_details",
                label="Check Details",
                section_id="check_details",
                requirements=[
                    ProcedureRequirement(
                        id="report_type",
                        label="Report type",
                        group_id="check_details",
                        field_paths=["report_type"],
                        required_for_statuses=["draft", "completed", "reviewed", "superseded"],
                        severity="blocking",
                        help_text="The type of condition report (Procedure: Technical assessment type).",
                    ),
                    ProcedureRequirement(
                        id="check_reason",
                        label="Check reason",
                        group_id="check_details",
                        field_paths=["check_reason"],
                        required_for_statuses=["completed", "reviewed", "superseded"],
                        severity="blocking",
                        help_text="Why the condition check was carried out (Procedure: Condition check reason).",
                    ),
                    ProcedureRequirement(
                        id="report_date",
                        label="Report date",
                        group_id="check_details",
                        field_paths=["report_date"],
                        required_for_statuses=["completed", "reviewed", "superseded"],
                        severity="blocking",
                        help_text="Date of the condition report (Procedure: Condition check date).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="condition",
                label="Condition",
                section_id="condition",
                requirements=[
                    ProcedureRequirement(
                        id="overall_condition",
                        label="Overall condition",
                        group_id="condition",
                        field_paths=["overall_condition"],
                        required_for_statuses=["completed", "reviewed", "superseded"],
                        severity="blocking",
                        help_text="Overall condition assessment (Procedure: Completeness/condition description).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="completeness",
                label="Completeness",
                section_id="completeness",
                requirements=[
                    ProcedureRequirement(
                        id="completeness",
                        label="Completeness",
                        group_id="completeness",
                        field_paths=["completeness"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Completeness assessment of the object (Procedure: Completeness description).",
                    ),
                    ProcedureRequirement(
                        id="completeness_date",
                        label="Completeness date",
                        group_id="completeness",
                        field_paths=["completeness_date"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Date of the completeness assessment (Procedure: Completeness date).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="examiner",
                label="Examiner",
                section_id="examiner",
                requirements=[
                    ProcedureRequirement(
                        id="examiner_id",
                        label="Examiner",
                        group_id="examiner",
                        field_paths=["examiner_id"],
                        required_for_statuses=["completed", "reviewed", "superseded"],
                        severity="recommended",
                        help_text="Who carried out the condition check (Procedure: Condition checker).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="follow_up",
                label="Follow-up",
                section_id="follow_up",
                requirements=[
                    ProcedureRequirement(
                        id="next_check_date",
                        label="Next check date",
                        group_id="follow_up",
                        field_paths=["next_check_date"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="When the next condition check is due (Procedure: Next condition check date).",
                    ),
                    ProcedureRequirement(
                        id="recommendations",
                        label="Recommendations",
                        group_id="follow_up",
                        field_paths=["recommendations"],
                        required_for_statuses=[],
                        severity="info",
                        help_text="Recommendations arising from the condition check.",
                    ),
                ],
            ),
        ],
    )
)
