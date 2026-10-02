"""
Event Profile

Profile for events in GLAM contexts.
Events include exhibitions, historical events, activities, and occurrences
related to collection items, places, or agents.
"""

from ..base import (
    Profile,
    PropertySchema,
    PropertyType,
    RelationshipSchema,
    ValidationRule,
    ValidationSeverity,
)
from ..registry import register_profile


def _validate_date_range(record: dict) -> tuple[bool, str]:
    """Validate that end_date is not before start_date."""
    props = record.get("properties", {})
    start_date = props.get("start_date")
    end_date = props.get("end_date")

    if start_date and end_date:
        # Simple string comparison works for ISO dates
        if end_date < start_date:
            return False, f"End date ({end_date}) cannot be before start date ({start_date})"

    return True, ""


EVENT_PROFILE = Profile(
    name="event",
    version="1.0.0",
    description="Exhibitions, historical events, activities, and occurrences",
    canonical_type="EVENT",

    required_properties=[
        "title",
    ],

    recommended_properties=[
        "event_type",
        "description",
        "start_date",
        "end_date",
        "location",
    ],

    optional_properties=[
        "date_display",
        "status",
        "organizer",
        "participants",
        "admission",
        "website",
        "registration_url",
        "capacity",
        "attendance",
        "is_recurring",
        "recurrence_pattern",
        "parent_event",
        "external_ids",
        "tags",
        "notes",
    ],

    property_schemas={
        "title": PropertySchema(
            type=PropertyType.STRING,
            description="Title of the event",
            min_length=1,
            max_length=500,
            ui_label="Title",
            example="Van Gogh: The Immersive Experience",
        ),
        "event_type": PropertySchema(
            type=PropertyType.STRING,
            description="Type of event",
            allowed_values=[
                "exhibition", "lecture", "workshop", "tour", "concert",
                "performance", "opening", "ceremony", "conference", "symposium",
                "historical_event", "acquisition", "conservation", "loan", "other"
            ],
            ui_label="Event Type",
            example="exhibition",
        ),
        "description": PropertySchema(
            type=PropertyType.STRING,
            description="Description of the event",
            max_length=10000,
            ui_label="Description",
        ),
        "start_date": PropertySchema(
            type=PropertyType.DATE,
            description="Start date of the event",
            ui_label="Start Date",
            example="2024-03-01",
        ),
        "end_date": PropertySchema(
            type=PropertyType.DATE,
            description="End date of the event",
            ui_label="End Date",
            example="2024-09-30",
        ),
        "date_display": PropertySchema(
            type=PropertyType.STRING,
            description="Display-formatted date range",
            ui_label="Display Date",
            example="March 1 - September 30, 2024",
        ),
        "location": PropertySchema(
            type=PropertyType.STRING,
            description="Location description",
            ui_label="Location",
            example="Main Gallery, West Wing",
        ),
        "status": PropertySchema(
            type=PropertyType.STRING,
            description="Current status of the event",
            allowed_values=[
                "planned", "upcoming", "ongoing", "completed", "cancelled", "postponed"
            ],
            ui_label="Status",
            example="upcoming",
        ),
        "organizer": PropertySchema(
            type=PropertyType.STRING,
            description="Name of organizing entity",
            ui_label="Organizer",
        ),
        "participants": PropertySchema(
            type=PropertyType.ARRAY,
            description="List of participant names",
            array_item_type=PropertyType.STRING,
            ui_label="Participants",
        ),
        "admission": PropertySchema(
            type=PropertyType.OBJECT,
            description="Admission information (price, free, members only, etc.)",
            ui_label="Admission",
            example={"type": "paid", "adult_price": 25.00, "member_free": True},
        ),
        "website": PropertySchema(
            type=PropertyType.URL,
            description="Event website or landing page",
            ui_label="Website",
        ),
        "registration_url": PropertySchema(
            type=PropertyType.URL,
            description="URL for event registration or tickets",
            ui_label="Registration URL",
        ),
        "capacity": PropertySchema(
            type=PropertyType.INTEGER,
            description="Maximum capacity",
            min_value=0,
            ui_label="Capacity",
        ),
        "attendance": PropertySchema(
            type=PropertyType.INTEGER,
            description="Actual or expected attendance",
            min_value=0,
            ui_label="Attendance",
        ),
        "is_recurring": PropertySchema(
            type=PropertyType.BOOLEAN,
            description="Whether this is a recurring event",
            ui_label="Is Recurring",
        ),
        "recurrence_pattern": PropertySchema(
            type=PropertyType.STRING,
            description="Description of recurrence pattern",
            ui_label="Recurrence Pattern",
            example="Every Saturday at 2pm",
        ),
        "parent_event": PropertySchema(
            type=PropertyType.STRING,
            description="Parent event if this is part of a series",
            ui_label="Parent Event",
        ),
        "external_ids": PropertySchema(
            type=PropertyType.OBJECT,
            description="External identifiers",
            ui_label="External IDs",
        ),
        "tags": PropertySchema(
            type=PropertyType.ARRAY,
            description="Tags or keywords",
            array_item_type=PropertyType.STRING,
            ui_label="Tags",
        ),
        "notes": PropertySchema(
            type=PropertyType.STRING,
            description="Additional notes",
            ui_label="Notes",
        ),
    },

    relationships=[
        RelationshipSchema(
            relationship_type="held_at",
            target_profile="place",
            description="Venue or location where the event takes place",
        ),
        RelationshipSchema(
            relationship_type="organized_by",
            target_profile="agent",
            description="Organizer of the event",
        ),
        RelationshipSchema(
            relationship_type="features",
            target_profile="collections",
            description="Collection items featured in this event",
        ),
        RelationshipSchema(
            relationship_type="participant",
            target_profile="agent",
            description="People or organizations participating",
        ),
        RelationshipSchema(
            relationship_type="image",
            target_profile="media",
            description="Images or media for this event",
        ),
        RelationshipSchema(
            relationship_type="part_of",
            target_profile="event",
            description="Parent event in a series",
        ),
        RelationshipSchema(
            relationship_type="related_event",
            target_profile="event",
            description="Related events",
        ),
    ],

    validation_rules=[
        ValidationRule(
            name="valid_date_range",
            description="End date must not be before start date",
            check=_validate_date_range,
            severity=ValidationSeverity.ERROR,
        ),
    ],
)

# Register on import
register_profile(EVENT_PROFILE)
