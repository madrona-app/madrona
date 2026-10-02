"""Damage and Loss requirements."""
from __future__ import annotations

from app.services.procedure_requirements import (
    ProcedureRequirements,
    ProcedureRequirement,
    ProcedureRequirementGroup,
    _register,
)

_status_order = ["draft", "submitted", "under_investigation", "resolved", "closed"]

DAMAGE_LOSS_REQUIREMENTS = _register(
    ProcedureRequirements(
        procedure_type="incident_report",
        procedure_label="Incident Report",
        procedure="Damage and Loss",
        status_order=_status_order,
        requirement_groups=[
            ProcedureRequirementGroup(
                id="incident",
                label="Incident",
                section_id="incident",
                requirements=[
                    ProcedureRequirement(
                        id="incident_type",
                        label="Incident type",
                        group_id="incident",
                        field_paths=["incident_type"],
                        required_for_statuses=["draft", "submitted", "under_investigation", "resolved", "closed"],
                        severity="blocking",
                        help_text="Type of incident — damage, loss, theft, etc. (Procedure: Damage/loss type).",
                    ),
                    ProcedureRequirement(
                        id="incident_date",
                        label="Incident date",
                        group_id="incident",
                        field_paths=["incident_date"],
                        required_for_statuses=["submitted", "under_investigation", "resolved", "closed"],
                        severity="blocking",
                        help_text="Date the incident occurred (Procedure: Damage/loss date).",
                    ),
                    ProcedureRequirement(
                        id="incident_location",
                        label="Incident location",
                        group_id="incident",
                        field_paths=["incident_location"],
                        required_for_statuses=["submitted", "under_investigation", "resolved", "closed"],
                        severity="blocking",
                        help_text="Where the incident occurred (Procedure: Damage/loss location).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="reporter",
                label="Reporter",
                section_id="reporter",
                requirements=[
                    ProcedureRequirement(
                        id="reporter_name",
                        label="Reporter name",
                        group_id="reporter",
                        field_paths=["discovered_by_name"],
                        required_for_statuses=["submitted", "under_investigation", "resolved", "closed"],
                        severity="blocking",
                        help_text="Person who reported the incident (Procedure: Damage/loss reporter).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="investigation",
                label="Investigation",
                section_id="investigation",
                requirements=[
                    ProcedureRequirement(
                        id="investigator_id",
                        label="Investigator",
                        group_id="investigation",
                        field_paths=["investigation_lead"],
                        required_for_statuses=["under_investigation", "resolved", "closed"],
                        severity="recommended",
                        help_text="Person investigating the incident (Procedure: Damage/loss investigator).",
                    ),
                    ProcedureRequirement(
                        id="investigation_date",
                        label="Investigation date",
                        group_id="investigation",
                        field_paths=["investigation_completed_date"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Date the investigation was conducted.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="notification",
                label="Notification",
                section_id="notification",
                requirements=[
                    ProcedureRequirement(
                        id="police_notified",
                        label="Police notified",
                        group_id="notification",
                        field_paths=["police_notified"],
                        required_for_statuses=["submitted", "under_investigation", "resolved", "closed"],
                        severity="recommended",
                        help_text="Whether police were notified (Procedure: Police notification).",
                    ),
                    ProcedureRequirement(
                        id="director_notified",
                        label="Director notified",
                        group_id="notification",
                        field_paths=["director_notified"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Whether the director was notified.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="resolution",
                label="Resolution",
                section_id="resolution",
                requirements=[
                    ProcedureRequirement(
                        id="resolution_summary",
                        label="Resolution summary",
                        group_id="resolution",
                        field_paths=["resolution_summary"],
                        required_for_statuses=["resolved", "closed"],
                        severity="blocking",
                        help_text="Summary of how the incident was resolved (Procedure: Damage/loss resolution).",
                    ),
                    ProcedureRequirement(
                        id="lessons_learned",
                        label="Lessons learned",
                        group_id="resolution",
                        field_paths=["lessons_learned"],
                        required_for_statuses=["closed"],
                        severity="recommended",
                        help_text="Lessons learned from the incident.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="insurance",
                label="Insurance",
                section_id="insurance",
                requirements=[
                    ProcedureRequirement(
                        id="insurance_claim_status",
                        label="Insurance claim status",
                        group_id="insurance",
                        field_paths=["insurance_claim_status"],
                        required_for_statuses=["resolved", "closed"],
                        severity="recommended",
                        help_text="Status of any insurance claim (Procedure: Insurance claim).",
                    ),
                ],
            ),
        ],
    )
)
