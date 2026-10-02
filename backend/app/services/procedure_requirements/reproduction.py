"""Reproduction requirements."""
from __future__ import annotations

from app.services.procedure_requirements import (
    ProcedureRequirements,
    ProcedureRequirement,
    ProcedureRequirementGroup,
    _register,
)

_status_order = ["submitted", "rights_review", "approved", "denied", "in_production", "delivered", "completed", "cancelled"]

REPRODUCTION_REQUIREMENTS = _register(
    ProcedureRequirements(
        procedure_type="reproduction_request",
        procedure_label="Reproduction Request",
        procedure="Reproduction",
        status_order=_status_order,
        requirement_groups=[
            ProcedureRequirementGroup(
                id="request",
                label="Request",
                section_id="request",
                requirements=[
                    ProcedureRequirement(
                        id="requester_name",
                        label="Requester name",
                        group_id="request",
                        field_paths=["requester_name"],
                        required_for_statuses=["submitted", "rights_review", "approved", "denied", "in_production", "delivered", "completed", "cancelled"],
                        severity="blocking",
                        help_text="Person requesting the reproduction (Procedure: Reproduction requester).",
                    ),
                    ProcedureRequirement(
                        id="request_date",
                        label="Request date",
                        group_id="request",
                        field_paths=["created_at"],
                        required_for_statuses=["submitted", "rights_review", "approved", "denied", "in_production", "delivered", "completed", "cancelled"],
                        severity="blocking",
                        help_text="Date the request was made (Procedure: Reproduction request date).",
                    ),
                    ProcedureRequirement(
                        id="use_purpose",
                        label="Use purpose",
                        group_id="request",
                        field_paths=["reproduction_purpose"],
                        required_for_statuses=["submitted", "rights_review", "approved", "denied", "in_production", "delivered", "completed", "cancelled"],
                        severity="blocking",
                        help_text="Intended use of the reproduction (Procedure: Reproduction purpose).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="reproduction",
                label="Reproduction",
                section_id="reproduction",
                requirements=[
                    ProcedureRequirement(
                        id="reproduction_type",
                        label="Reproduction type",
                        group_id="reproduction",
                        field_paths=["reproduction_type"],
                        required_for_statuses=["approved", "denied", "in_production", "delivered", "completed", "cancelled"],
                        severity="blocking",
                        help_text="Type of reproduction — photograph, scan, cast, etc. (Procedure: Reproduction type).",
                    ),
                    ProcedureRequirement(
                        id="reproduction_format",
                        label="Reproduction format",
                        group_id="reproduction",
                        field_paths=["format_requested"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Format of the reproduction (Procedure: Reproduction format).",
                    ),
                    ProcedureRequirement(
                        id="reproduction_quantity",
                        label="Reproduction quantity",
                        group_id="reproduction",
                        field_paths=["quantity"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Number of reproductions requested.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="rights",
                label="Rights",
                section_id="rights",
                requirements=[
                    ProcedureRequirement(
                        id="rights_info",
                        label="Rights information",
                        group_id="rights",
                        field_paths=[],
                        required_for_statuses=[],
                        severity="info",
                        help_text="Rights cleared via linked object rights.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="fulfillment",
                label="Fulfillment",
                section_id="fulfillment",
                requirements=[
                    ProcedureRequirement(
                        id="fulfilled_by_id",
                        label="Fulfilled by",
                        group_id="fulfillment",
                        field_paths=["fulfilled_by_id"],
                        has_predicate=True,
                        required_for_statuses=["delivered", "completed", "cancelled"],
                        severity="recommended",
                        help_text="Person who fulfilled the reproduction request.",
                    ),
                    ProcedureRequirement(
                        id="fulfillment_date",
                        label="Fulfillment date",
                        group_id="fulfillment",
                        field_paths=["delivery_date"],
                        required_for_statuses=["delivered", "completed", "cancelled"],
                        severity="recommended",
                        help_text="Date the reproduction was delivered.",
                    ),
                ],
            ),
        ],
    )
)
