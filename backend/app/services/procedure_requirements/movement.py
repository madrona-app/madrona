"""Movement and Location Control requirements."""
from __future__ import annotations

from app.services.procedure_requirements import (
    ProcedureRequirements,
    ProcedureRequirement,
    ProcedureRequirementGroup,
    _register,
)
from app.services.workflow_definitions import WORKFLOW_DEFINITIONS

_status_order = WORKFLOW_DEFINITIONS["movement"].status_order

MOVEMENT_REQUIREMENTS = _register(
    ProcedureRequirements(
        procedure_type="movement",
        procedure_label="Movement",
        procedure="Movement and Location Control",
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
                        required_for_statuses=["pending", "in_transit", "completed"],
                        severity="blocking",
                        help_text="The object being moved (Procedure: Object identification information).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="movement",
                label="Movement Details",
                section_id="movement",
                requirements=[
                    ProcedureRequirement(
                        id="reason",
                        label="Movement reason",
                        group_id="movement",
                        field_paths=["reason"],
                        required_for_statuses=["pending", "in_transit", "completed"],
                        severity="blocking",
                        help_text="Why the object is being moved (Procedure: Movement reason).",
                    ),
                    ProcedureRequirement(
                        id="to_location_id",
                        label="Destination location",
                        group_id="movement",
                        field_paths=["to_location_id"],
                        required_for_statuses=["pending", "in_transit", "completed"],
                        severity="blocking",
                        help_text="Where the object is being moved to (Procedure: Current location).",
                    ),
                    ProcedureRequirement(
                        id="movement_date",
                        label="Movement date",
                        group_id="movement",
                        field_paths=["movement_date"],
                        required_for_statuses=["in_transit", "completed"],
                        severity="blocking",
                        help_text="The date of the movement (Procedure: Removal date).",
                    ),
                    ProcedureRequirement(
                        id="from_location_id",
                        label="Previous location",
                        group_id="movement",
                        field_paths=["from_location_id"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Where the object is being moved from (Procedure: Previous location).",
                    ),
                    ProcedureRequirement(
                        id="movement_method",
                        label="Movement method",
                        group_id="movement",
                        field_paths=["movement_method"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="How the object was moved — hand-carried, cart, shipped, etc. (Procedure: Movement method).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="authorization",
                label="Authorization",
                section_id="authorization",
                requirements=[
                    ProcedureRequirement(
                        id="authorizer_id",
                        label="Authorizer",
                        group_id="authorization",
                        field_paths=["authorizer_id"],
                        required_for_statuses=["in_transit", "completed"],
                        severity="blocking",
                        help_text="Who authorized the movement (Procedure: Movement authorizer).",
                    ),
                    ProcedureRequirement(
                        id="authorization_date",
                        label="Authorization date",
                        group_id="authorization",
                        field_paths=["authorization_date"],
                        required_for_statuses=["in_transit", "completed"],
                        severity="recommended",
                        help_text="When the movement was authorized (Procedure: Movement authorization date).",
                    ),
                    ProcedureRequirement(
                        id="signed_custody_transfer",
                        label="Signed custody transfer",
                        group_id="authorization",
                        field_paths=["signed_document_types"],
                        required_for_statuses=["completed"],
                        severity="recommended",
                        help_text="Location and Movement Control requires a signature from the person accepting custody of the object.",
                        has_predicate=True,
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="handler",
                label="Handler",
                section_id="handler",
                requirements=[
                    ProcedureRequirement(
                        id="handler_id",
                        label="Handler",
                        group_id="handler",
                        field_paths=["handler_id"],
                        required_for_statuses=["completed"],
                        severity="recommended",
                        help_text="Who physically handled the object (Procedure: Movement contact).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="shipping",
                label="Shipping & Courier",
                section_id="shipping",
                requirements=[
                    ProcedureRequirement(
                        id="shipping_insurance_value",
                        label="Shipping insurance value",
                        group_id="shipping",
                        field_paths=["shipping_insurance_value"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Insurance value for transit (Procedure: Appropriate insurance/indemnity before transporting).",
                        has_predicate=True,
                    ),
                    ProcedureRequirement(
                        id="shipping_method",
                        label="Shipping method",
                        group_id="shipping",
                        field_paths=["shipping_method"],
                        required_for_statuses=[],
                        severity="info",
                        help_text="Shipping method — ground, air, or sea.",
                        has_predicate=True,
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="condition",
                label="Condition",
                section_id="condition",
                requirements=[
                    ProcedureRequirement(
                        id="condition_note",
                        label="Condition note",
                        group_id="condition",
                        field_paths=["condition_note"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Note on the condition of the object before/during movement (Procedure: Condition assessment).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="planning",
                label="Planning",
                section_id="planning",
                requirements=[
                    ProcedureRequirement(
                        id="location_fitness",
                        label="Location fitness",
                        group_id="planning",
                        field_paths=["location_fitness"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Assessment of whether the destination is suitable for the object (Procedure: Location fitness).",
                    ),
                ],
            ),
        ],
    )
)
