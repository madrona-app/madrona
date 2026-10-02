"""Insurance and Indemnity Management requirements."""
from __future__ import annotations

from app.services.procedure_requirements import (
    ProcedureRequirements,
    ProcedureRequirement,
    ProcedureRequirementGroup,
    _register,
)

_status_order = ["draft", "pending_approval", "active", "expired", "cancelled", "renewed"]

INSURANCE_REQUIREMENTS = _register(
    ProcedureRequirements(
        procedure_type="insurance_policy",
        procedure_label="Insurance Policy",
        procedure="Insurance and Indemnity Management",
        status_order=_status_order,
        requirement_groups=[
            ProcedureRequirementGroup(
                id="policy",
                label="Policy",
                section_id="policy",
                requirements=[
                    ProcedureRequirement(
                        id="policy_number",
                        label="Policy number",
                        group_id="policy",
                        field_paths=["policy_number"],
                        required_for_statuses=["active", "expired", "cancelled", "renewed"],
                        severity="blocking",
                        help_text="The policy number (Procedure: Insurance/indemnity reference number).",
                    ),
                    ProcedureRequirement(
                        id="policy_name",
                        label="Policy name",
                        group_id="policy",
                        field_paths=["policy_name"],
                        required_for_statuses=["draft", "pending_approval", "active", "expired", "cancelled", "renewed"],
                        severity="blocking",
                        help_text="Name or title of the policy (Procedure: Insurance/indemnity policy note).",
                    ),
                    ProcedureRequirement(
                        id="policy_type",
                        label="Policy type",
                        group_id="policy",
                        field_paths=["policy_type"],
                        required_for_statuses=["draft", "pending_approval", "active", "expired", "cancelled", "renewed"],
                        severity="blocking",
                        help_text="Type of insurance or indemnity (Procedure: Insurance/indemnity type).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="provider",
                label="Provider",
                section_id="provider",
                requirements=[
                    ProcedureRequirement(
                        id="provider_name",
                        label="Provider name",
                        group_id="provider",
                        field_paths=["provider_name"],
                        required_for_statuses=["active", "expired", "cancelled", "renewed"],
                        severity="blocking",
                        help_text="Insurance provider or indemnifier (Procedure: Insurer/indemnifier).",
                    ),
                    ProcedureRequirement(
                        id="broker_name",
                        label="Broker name",
                        group_id="provider",
                        field_paths=["broker_name"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Insurance broker, if applicable.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="dates",
                label="Dates",
                section_id="dates",
                requirements=[
                    ProcedureRequirement(
                        id="effective_date",
                        label="Effective date",
                        group_id="dates",
                        field_paths=["effective_date"],
                        required_for_statuses=["active", "expired", "cancelled", "renewed"],
                        severity="blocking",
                        help_text="When the policy takes effect (Procedure: Insurance/indemnity start date).",
                    ),
                    ProcedureRequirement(
                        id="expiration_date",
                        label="Expiration date",
                        group_id="dates",
                        field_paths=["expiration_date"],
                        required_for_statuses=["active", "expired", "cancelled", "renewed"],
                        severity="blocking",
                        help_text="When the policy expires (Procedure: Insurance/indemnity end date).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="coverage",
                label="Coverage",
                section_id="coverage",
                requirements=[
                    ProcedureRequirement(
                        id="coverage_limit",
                        label="Coverage limit",
                        group_id="coverage",
                        field_paths=["coverage_limit"],
                        required_for_statuses=["active", "expired", "cancelled", "renewed"],
                        severity="blocking",
                        help_text="Maximum coverage amount (Procedure: Insurance/indemnity value).",
                    ),
                    ProcedureRequirement(
                        id="per_occurrence_limit",
                        label="Per-occurrence limit",
                        group_id="coverage",
                        field_paths=["per_occurrence_limit"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Maximum payout per occurrence.",
                    ),
                    ProcedureRequirement(
                        id="deductible",
                        label="Deductible",
                        group_id="coverage",
                        field_paths=["deductible"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Policy deductible amount.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="premium",
                label="Premium",
                section_id="premium",
                requirements=[
                    ProcedureRequirement(
                        id="annual_premium",
                        label="Annual premium",
                        group_id="premium",
                        field_paths=["annual_premium"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Annual premium cost.",
                    ),
                ],
            ),
        ],
    )
)
