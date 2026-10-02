"""Inventory and Cataloging requirements."""
from __future__ import annotations

from app.services.procedure_requirements import (
    ProcedureRequirements,
    ProcedureRequirement,
    ProcedureRequirementGroup,
    _register,
)

# Neither inventory nor cataloging are in WORKFLOW_DEFINITIONS —
# define status_order inline.

# ---------------------------------------------------------------------------
# Inventory — Core accountability (5 required fields)
# ---------------------------------------------------------------------------

INVENTORY_REQUIREMENTS = _register(
    ProcedureRequirements(
        procedure_type="inventory",
        procedure_label="Inventory",
        procedure="Inventory",
        status_order=["current", "inventory_complete"],
        requirement_groups=[
            ProcedureRequirementGroup(
                id="identification",
                label="Identification",
                section_id="identification",
                requirements=[
                    ProcedureRequirement(
                        id="object_number",
                        label="Object number",
                        group_id="identification",
                        field_paths=["object_number"],
                        required_for_statuses=["inventory_complete"],
                        severity="blocking",
                        help_text="A unique number securely associated with the object.",
                    ),
                    ProcedureRequirement(
                        id="object_name",
                        label="Object name",
                        group_id="identification",
                        field_paths=["object_name"],
                        required_for_statuses=["inventory_complete"],
                        severity="blocking",
                        help_text="What the object is -- e.g. painting, vase, photograph.",
                    ),
                    ProcedureRequirement(
                        id="object_status",
                        label="Object status",
                        group_id="identification",
                        field_paths=["object_status"],
                        required_for_statuses=["inventory_complete"],
                        severity="blocking",
                        help_text="Current status in the collection -- accessioned, on loan, etc.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="description",
                label="Description",
                section_id="description",
                requirements=[
                    ProcedureRequirement(
                        id="brief_description",
                        label="Brief description",
                        group_id="description",
                        field_paths=["brief_description"],
                        required_for_statuses=["inventory_complete"],
                        severity="blocking",
                        help_text="A brief description sufficient to identify the object. An image can substitute.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="location",
                label="Location",
                section_id="location",
                requirements=[
                    ProcedureRequirement(
                        id="current_location_id",
                        label="Current location",
                        group_id="location",
                        field_paths=["current_location_id"],
                        required_for_statuses=["inventory_complete"],
                        severity="blocking",
                        help_text="Where the object is right now.",
                    ),
                ],
            ),
        ],
    )
)

# ---------------------------------------------------------------------------
# Cataloging — Full scholarly documentation (10 fields)
# ---------------------------------------------------------------------------

CATALOGING_REQUIREMENTS = _register(
    ProcedureRequirements(
        procedure_type="cataloging",
        procedure_label="Cataloging",
        procedure="Cataloging",
        status_order=["current", "cataloging_complete"],
        requirement_groups=[
            ProcedureRequirementGroup(
                id="identification",
                label="Identification",
                section_id="identification",
                requirements=[
                    ProcedureRequirement(
                        id="title",
                        label="Title",
                        group_id="identification",
                        field_paths=["titles"],
                        required_for_statuses=["cataloging_complete"],
                        severity="blocking",
                        help_text="The title of the object, if applicable (CDWA 1).",
                    ),
                    ProcedureRequirement(
                        id="object_type",
                        label="Object type",
                        group_id="identification",
                        field_paths=["object_type"],
                        required_for_statuses=["cataloging_complete"],
                        severity="blocking",
                        help_text="Classification or type of work -- e.g. oil painting, lithograph (CDWA 9).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="production",
                label="Production",
                section_id="people",
                requirements=[
                    ProcedureRequirement(
                        id="creator",
                        label="Creator / maker",
                        group_id="production",
                        field_paths=["constituents"],
                        required_for_statuses=["cataloging_complete"],
                        severity="blocking",
                        help_text="Who created or produced the object (CDWA 5).",
                    ),
                    ProcedureRequirement(
                        id="creation_date",
                        label="Date of production",
                        group_id="production",
                        field_paths=["creation_date_display"],
                        required_for_statuses=["cataloging_complete"],
                        severity="blocking",
                        help_text="When the object was created -- e.g. c. 1890, 19th century (CDWA 6).",
                    ),
                    ProcedureRequirement(
                        id="creation_place",
                        label="Place of creation",
                        group_id="production",
                        field_paths=["creation_place"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Where the object was created or found (CDWA 7).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="physical",
                label="Physical Characteristics",
                section_id="physical",
                requirements=[
                    ProcedureRequirement(
                        id="materials",
                        label="Materials",
                        group_id="physical",
                        field_paths=["material_count"],
                        required_for_statuses=["cataloging_complete"],
                        severity="blocking",
                        help_text="What the object is made of (CDWA 12).",
                    ),
                    ProcedureRequirement(
                        id="measurements",
                        label="Dimensions",
                        group_id="physical",
                        field_paths=["measurements"],
                        required_for_statuses=["cataloging_complete"],
                        severity="blocking",
                        help_text="Height, width, depth, weight, or other measurements (CDWA 13).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="acquisition",
                label="Acquisition",
                section_id="acquisition",
                requirements=[
                    ProcedureRequirement(
                        id="credit_line",
                        label="Credit line",
                        group_id="acquisition",
                        field_paths=["credit_line"],
                        required_for_statuses=["cataloging_complete"],
                        severity="blocking",
                        help_text="Acknowledgment of the source -- e.g. Gift of John Smith, 2024.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="condition",
                label="Condition",
                section_id="condition",
                requirements=[
                    ProcedureRequirement(
                        id="condition_rating",
                        label="Condition rating",
                        group_id="condition",
                        field_paths=["condition_rating"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Current condition assessment -- excellent, good, fair, poor.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="media",
                label="Image",
                section_id="media",
                requirements=[
                    ProcedureRequirement(
                        id="has_image",
                        label="Object image",
                        group_id="media",
                        field_paths=["primary_image_url"],
                        required_for_statuses=["cataloging_complete"],
                        severity="blocking",
                        help_text="A photograph of the object.",
                    ),
                ],
            ),
        ],
    )
)
