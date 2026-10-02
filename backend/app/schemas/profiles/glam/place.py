"""
Place Profile

Profile for geographic locations, sites, and venues in GLAM contexts.
Places represent where items were created, discovered, or are currently located.
"""

from ..base import (
    Profile,
    PropertySchema,
    PropertyType,
    RelationshipSchema,
)
from ..registry import register_profile


PLACE_PROFILE = Profile(
    name="place",
    version="1.0.0",
    description="Geographic locations, sites, and venues",
    canonical_type="PLACE",

    required_properties=[
        "name",
    ],

    recommended_properties=[
        "place_type",
        "description",
        "coordinates",
        "address",
        "country",
    ],

    optional_properties=[
        "alternate_names",
        "city",
        "state_province",
        "postal_code",
        "continent",
        "historical_names",
        "time_period",
        "parent_place",
        "external_ids",
        "website",
        "notes",
    ],

    property_schemas={
        "name": PropertySchema(
            type=PropertyType.STRING,
            description="Primary name of the place",
            min_length=1,
            max_length=500,
            ui_label="Name",
            example="Musée d'Orsay",
        ),
        "place_type": PropertySchema(
            type=PropertyType.STRING,
            description="Type of place",
            allowed_values=[
                "museum", "gallery", "archive", "library", "historic_site",
                "city", "country", "region", "building", "archaeological_site",
                "natural_site", "venue", "studio", "workshop", "other"
            ],
            ui_label="Place Type",
            example="museum",
        ),
        "description": PropertySchema(
            type=PropertyType.STRING,
            description="Description of the place",
            max_length=5000,
            ui_label="Description",
        ),
        "coordinates": PropertySchema(
            type=PropertyType.OBJECT,
            description="Geographic coordinates (latitude, longitude)",
            ui_label="Coordinates",
            example={"latitude": 48.8600, "longitude": 2.3266},
        ),
        "address": PropertySchema(
            type=PropertyType.STRING,
            description="Full street address",
            ui_label="Address",
            example="1 Rue de la Légion d'Honneur, 75007 Paris, France",
        ),
        "city": PropertySchema(
            type=PropertyType.STRING,
            description="City or locality",
            ui_label="City",
            example="Paris",
        ),
        "state_province": PropertySchema(
            type=PropertyType.STRING,
            description="State, province, or administrative region",
            ui_label="State/Province",
        ),
        "postal_code": PropertySchema(
            type=PropertyType.STRING,
            description="Postal or ZIP code",
            ui_label="Postal Code",
            example="75007",
        ),
        "country": PropertySchema(
            type=PropertyType.STRING,
            description="Country name",
            ui_label="Country",
            example="France",
        ),
        "continent": PropertySchema(
            type=PropertyType.STRING,
            description="Continent",
            allowed_values=[
                "Africa", "Antarctica", "Asia", "Europe",
                "North America", "Oceania", "South America"
            ],
            ui_label="Continent",
            example="Europe",
        ),
        "alternate_names": PropertySchema(
            type=PropertyType.ARRAY,
            description="Other names or historical names",
            array_item_type=PropertyType.STRING,
            ui_label="Alternate Names",
        ),
        "historical_names": PropertySchema(
            type=PropertyType.ARRAY,
            description="Historical names with dates",
            array_item_type=PropertyType.OBJECT,
            ui_label="Historical Names",
            example=[{"name": "Constantinople", "period": "330-1930"}],
        ),
        "time_period": PropertySchema(
            type=PropertyType.STRING,
            description="Historical time period if place no longer exists",
            ui_label="Time Period",
        ),
        "parent_place": PropertySchema(
            type=PropertyType.STRING,
            description="Containing place (e.g., city for a museum)",
            ui_label="Parent Place",
        ),
        "external_ids": PropertySchema(
            type=PropertyType.OBJECT,
            description="External identifiers (TGN, GeoNames, Wikidata, etc.)",
            ui_label="External IDs",
            example={"tgn": "7008038", "geonames": "2988507"},
        ),
        "website": PropertySchema(
            type=PropertyType.URL,
            description="Official website",
            ui_label="Website",
        ),
        "notes": PropertySchema(
            type=PropertyType.STRING,
            description="Additional notes",
            ui_label="Notes",
        ),
    },

    relationships=[
        RelationshipSchema(
            relationship_type="part_of",
            target_profile="place",
            description="Parent place (e.g., city is part_of country)",
        ),
        RelationshipSchema(
            relationship_type="contains",
            target_profile="place",
            description="Child places within this place",
        ),
        RelationshipSchema(
            relationship_type="image",
            target_profile="media",
            description="Images of this place",
        ),
    ],
)

# Register on import
register_profile(PLACE_PROFILE)
