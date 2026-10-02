"""Indemnity Arrangement requirements."""
from __future__ import annotations

from app.services.procedure_requirements import (
    ProcedureRequirements,
    ProcedureRequirement,
    ProcedureRequirementGroup,
    _register,
)

_status_order = [
    "draft", "submitted", "under_review", "approved", "rejected", "active", "expired"
]

INDEMNITY_REQUIREMENTS = _register(
    ProcedureRequirements(
        procedure_type="indemnity_arrangement",
        procedure_label="Indemnity Arrangement",
        procedure="Insurance and Indemnity Management",
        status_order=_status_order,
        requirement_groups=[
            ProcedureRequirementGroup(
                id="arrangement",
                label="Arrangement",
                section_id="arrangement",
                requirements=[
                    ProcedureRequirement(
                        id="program",
                        label="Program",
                        group_id="arrangement",
                        field_paths=["program"],
                        required_for_statuses=[
                            "draft", "submitted", "under_review",
                            "approved", "rejected", "active", "expired",
                        ],
                        severity="blocking",
                        help_text="Government indemnity program (Procedure: Insurance/indemnity type).",
                    ),
                    ProcedureRequirement(
                        id="reference_number",
                        label="Reference number",
                        group_id="arrangement",
                        field_paths=["reference_number"],
                        required_for_statuses=[
                            "submitted", "under_review",
                            "approved", "rejected", "active", "expired",
                        ],
                        severity="recommended",
                        help_text="External reference number assigned by the indemnifying body.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="application",
                label="Application",
                section_id="application",
                requirements=[
                    ProcedureRequirement(
                        id="application_date",
                        label="Application date",
                        group_id="application",
                        field_paths=["application_date"],
                        required_for_statuses=[
                            "submitted", "under_review",
                            "approved", "rejected", "active", "expired",
                        ],
                        severity="blocking",
                        help_text="Date the indemnity application was submitted.",
                    ),
                    ProcedureRequirement(
                        id="requested_coverage",
                        label="Requested coverage",
                        group_id="application",
                        field_paths=["requested_coverage"],
                        required_for_statuses=[
                            "submitted", "under_review",
                            "approved", "rejected", "active", "expired",
                        ],
                        severity="blocking",
                        help_text="Total coverage amount requested from the indemnifying body.",
                    ),
                    ProcedureRequirement(
                        id="coverage_currency",
                        label="Coverage currency",
                        group_id="application",
                        field_paths=["coverage_currency"],
                        required_for_statuses=[
                            "submitted", "under_review",
                            "approved", "rejected", "active", "expired",
                        ],
                        severity="blocking",
                        help_text="Currency of coverage values.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="coverage",
                label="Coverage",
                section_id="coveragePeriod",
                requirements=[
                    ProcedureRequirement(
                        id="awarded_coverage",
                        label="Awarded coverage",
                        group_id="coverage",
                        field_paths=["awarded_coverage"],
                        required_for_statuses=[
                            "approved", "active", "expired",
                        ],
                        severity="recommended",
                        help_text="Total coverage amount awarded by the indemnifying body.",
                    ),
                    ProcedureRequirement(
                        id="coverage_start_date",
                        label="Coverage start date",
                        group_id="coverage",
                        field_paths=["coverage_start_date"],
                        required_for_statuses=["active", "expired"],
                        severity="blocking",
                        help_text="Date indemnity coverage begins.",
                    ),
                    ProcedureRequirement(
                        id="coverage_end_date",
                        label="Coverage end date",
                        group_id="coverage",
                        field_paths=["coverage_end_date"],
                        required_for_statuses=["active", "expired"],
                        severity="blocking",
                        help_text="Date indemnity coverage ends.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="objects",
                label="Objects",
                section_id="objects",
                requirements=[
                    ProcedureRequirement(
                        id="objects_linked",
                        label="Covered objects",
                        group_id="objects",
                        field_paths=[],
                        required_for_statuses=[],
                        severity="info",
                        help_text="Link objects to track per-object coverage values.",
                        has_predicate=True,
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="notes",
                label="Notes",
                section_id="notes",
                requirements=[
                    ProcedureRequirement(
                        id="notes",
                        label="Notes",
                        group_id="notes",
                        field_paths=["notes"],
                        required_for_statuses=[],
                        severity="info",
                        help_text="Additional notes about this indemnity arrangement.",
                    ),
                ],
            ),
        ],
    )
)
