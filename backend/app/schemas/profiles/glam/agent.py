"""
Agent Profile

Profile for people, organizations, and groups in GLAM contexts.
Agents are entities that create, own, or are associated with collection items.
"""

from ..base import (
    Profile,
    PropertySchema,
    PropertyType,
    RelationshipSchema,
)
from ..registry import register_profile


AGENT_PROFILE = Profile(
    name="agent",
    version="1.0.0",
    description="People, organizations, and groups involved with collection items",
    canonical_type="AGENT",

    required_properties=[
        "name",
    ],

    recommended_properties=[
        "agent_type",
        "description",
        "birth_date",
        "death_date",
        "nationality",
        "active_dates",
    ],

    optional_properties=[
        "alternate_names",
        "birth_place",
        "death_place",
        "gender",
        "occupation",
        "biography",
        "external_ids",
        "website",
        "email",
        "phone",
        "address",
        "notes",
    ],

    property_schemas={
        "name": PropertySchema(
            type=PropertyType.STRING,
            description="Primary name of the agent",
            min_length=1,
            max_length=500,
            ui_label="Name",
            example="Vincent van Gogh",
        ),
        "agent_type": PropertySchema(
            type=PropertyType.STRING,
            description="Type of agent",
            allowed_values=["person", "organization", "group", "family", "unknown"],
            ui_label="Agent Type",
            example="person",
        ),
        "description": PropertySchema(
            type=PropertyType.STRING,
            description="Brief description or biographical summary",
            max_length=5000,
            ui_label="Description",
        ),
        "birth_date": PropertySchema(
            type=PropertyType.DATE,
            description="Date of birth (for persons) or founding (for organizations)",
            ui_label="Birth/Founding Date",
            example="1853-03-30",
        ),
        "death_date": PropertySchema(
            type=PropertyType.DATE,
            description="Date of death (for persons) or dissolution (for organizations)",
            ui_label="Death/Dissolution Date",
            example="1890-07-29",
        ),
        "nationality": PropertySchema(
            type=PropertyType.STRING,
            description="Nationality or country of origin",
            ui_label="Nationality",
            example="Dutch",
        ),
        "active_dates": PropertySchema(
            type=PropertyType.STRING,
            description="Period when the agent was active",
            ui_label="Active Dates",
            example="1880-1890",
        ),
        "alternate_names": PropertySchema(
            type=PropertyType.ARRAY,
            description="Other names, pseudonyms, or variant spellings",
            array_item_type=PropertyType.STRING,
            ui_label="Alternate Names",
        ),
        "birth_place": PropertySchema(
            type=PropertyType.STRING,
            description="Place of birth or founding",
            ui_label="Birth Place",
            example="Groot-Zundert, Netherlands",
        ),
        "death_place": PropertySchema(
            type=PropertyType.STRING,
            description="Place of death or dissolution",
            ui_label="Death Place",
            example="Auvers-sur-Oise, France",
        ),
        "gender": PropertySchema(
            type=PropertyType.STRING,
            description="Gender identity",
            ui_label="Gender",
        ),
        "occupation": PropertySchema(
            type=PropertyType.ARRAY,
            description="Occupations or roles",
            array_item_type=PropertyType.STRING,
            ui_label="Occupation",
            example=["painter", "artist"],
        ),
        "biography": PropertySchema(
            type=PropertyType.STRING,
            description="Extended biographical text",
            ui_label="Biography",
        ),
        "external_ids": PropertySchema(
            type=PropertyType.OBJECT,
            description="External identifiers (ULAN, VIAF, Wikidata, etc.)",
            ui_label="External IDs",
            example={"ulan": "500115588", "wikidata": "Q5582"},
        ),
        "website": PropertySchema(
            type=PropertyType.URL,
            description="Official website",
            ui_label="Website",
        ),
        "email": PropertySchema(
            type=PropertyType.EMAIL,
            description="Contact email",
            ui_label="Email",
        ),
        "phone": PropertySchema(
            type=PropertyType.STRING,
            description="Contact phone number",
            ui_label="Phone",
        ),
        "address": PropertySchema(
            type=PropertyType.STRING,
            description="Physical address",
            ui_label="Address",
        ),
        "notes": PropertySchema(
            type=PropertyType.STRING,
            description="Additional notes or comments",
            ui_label="Notes",
        ),
    },

    relationships=[
        RelationshipSchema(
            relationship_type="member_of",
            target_profile="agent",
            description="Organization or group this agent belongs to",
        ),
        RelationshipSchema(
            relationship_type="related_to",
            target_profile="agent",
            description="Related agents (family, colleagues, etc.)",
        ),
        RelationshipSchema(
            relationship_type="born_at",
            target_profile="place",
            description="Place of birth",
            max_count=1,
        ),
        RelationshipSchema(
            relationship_type="died_at",
            target_profile="place",
            description="Place of death",
            max_count=1,
        ),
        RelationshipSchema(
            relationship_type="portrait",
            target_profile="media",
            description="Portrait or representative image of the agent",
        ),
    ],
)

# Register on import
register_profile(AGENT_PROFILE)
