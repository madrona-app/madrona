"""Valuation Control requirements."""
from __future__ import annotations

from app.services.procedure_requirements import (
    ProcedureRequirements,
    ProcedureRequirement,
    ProcedureRequirementGroup,
    _register,
)

_status_order = ["current", "superseded"]

VALUATION_REQUIREMENTS = _register(
    ProcedureRequirements(
        procedure_type="valuation",
        procedure_label="Valuation",
        procedure="Valuation Control",
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
                        required_for_statuses=["current"],
                        severity="blocking",
                        help_text="The object being valued (Procedure: Object identification information).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="valuation",
                label="Valuation",
                section_id="valuation",
                requirements=[
                    ProcedureRequirement(
                        id="valuation_type",
                        label="Valuation type",
                        group_id="valuation",
                        field_paths=["valuation_type"],
                        required_for_statuses=["current"],
                        severity="blocking",
                        help_text="Type of valuation — insurance, market, replacement, etc. (Procedure: Valuation type).",
                    ),
                    ProcedureRequirement(
                        id="valuation_amount",
                        label="Valuation amount",
                        group_id="valuation",
                        field_paths=["valuation_amount"],
                        required_for_statuses=["current"],
                        severity="blocking",
                        help_text="The assessed value (Procedure: Value amount).",
                    ),
                    ProcedureRequirement(
                        id="valuation_currency",
                        label="Valuation currency",
                        group_id="valuation",
                        field_paths=["valuation_currency"],
                        required_for_statuses=["current"],
                        severity="blocking",
                        help_text="Currency of the valuation (Procedure: Value currency).",
                    ),
                    ProcedureRequirement(
                        id="valuation_date",
                        label="Valuation date",
                        group_id="valuation",
                        field_paths=["valuation_date"],
                        required_for_statuses=["current"],
                        severity="blocking",
                        help_text="Date the valuation was made (Procedure: Valuation date).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="valuator",
                label="Valuator",
                section_id="valuator",
                requirements=[
                    ProcedureRequirement(
                        id="valuator_id",
                        label="Valuator",
                        group_id="valuator",
                        field_paths=["valuator_id"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Person or organization that carried out the valuation (Procedure: Valuer).",
                    ),
                    ProcedureRequirement(
                        id="valuator_name",
                        label="Valuator name",
                        group_id="valuator",
                        field_paths=["valuator_name"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Name of the valuator, if not a system contact.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="method",
                label="Method",
                section_id="method",
                requirements=[
                    ProcedureRequirement(
                        id="valuation_method",
                        label="Valuation method",
                        group_id="method",
                        field_paths=["valuation_method"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Method used for the valuation (Procedure: Valuation method).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="validity",
                label="Validity",
                section_id="validity",
                requirements=[
                    ProcedureRequirement(
                        id="valid_from",
                        label="Valid from",
                        group_id="validity",
                        field_paths=["valid_from"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Date from which the valuation is valid.",
                    ),
                    ProcedureRequirement(
                        id="valid_until",
                        label="Valid until",
                        group_id="validity",
                        field_paths=["valid_until"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Date until which the valuation is valid.",
                    ),
                ],
            ),
        ],
    )
)
