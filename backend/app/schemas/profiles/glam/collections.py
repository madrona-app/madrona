"""
Collections Profile

Profile for museum and gallery collection items in GLAM contexts.
This is the primary profile for physical objects, artworks, artifacts,
and specimens in a collection.
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


def _validate_has_identifier(record: dict) -> tuple[bool, str]:
    """Validate that the record has at least one identifier."""
    props = record.get("properties", {})

    identifiers = [
        props.get("accession_number"),
        props.get("object_number"),
        props.get("inventory_number"),
    ]

    if not any(identifiers):
        return False, "Collection item should have at least one identifier (accession_number, object_number, or inventory_number)"

    return True, ""


COLLECTIONS_PROFILE = Profile(
    name="collections",
    version="1.0.0",
    description="Museum and gallery collection items including artworks, artifacts, and specimens",
    canonical_type="OBJECT",

    required_properties=[
        "title",
    ],

    recommended_properties=[
        "accession_number",
        "object_type",
        "description",
        "date_created",
        "date_display",
        "creator",
        "medium",
        "dimensions",
        "credit_line",
    ],

    optional_properties=[
        "object_number",
        "inventory_number",
        "alternate_titles",
        "classification",
        "department",
        "culture",
        "period",
        "dynasty",
        "style",
        "technique",
        "materials",
        "inscription",
        "markings",
        "signed",
        "dated",
        "edition",
        "state",
        "provenance",
        "exhibition_history",
        "publication_history",
        "condition",
        "condition_notes",
        "location",
        "on_display",
        "gallery",
        "rights_statement",
        "copyright",
        "public_domain",
        "iiif_manifest",
        "external_ids",
        "tags",
        "notes",
    ],

    property_schemas={
        "title": PropertySchema(
            type=PropertyType.STRING,
            description="Primary title of the object",
            min_length=1,
            max_length=1000,
            ui_label="Title",
            example="The Starry Night",
        ),
        "alternate_titles": PropertySchema(
            type=PropertyType.ARRAY,
            description="Alternate or variant titles",
            array_item_type=PropertyType.STRING,
            ui_label="Alternate Titles",
        ),
        "accession_number": PropertySchema(
            type=PropertyType.STRING,
            description="Accession or acquisition number",
            max_length=100,
            ui_label="Accession Number",
            example="1941.4.1",
        ),
        "object_number": PropertySchema(
            type=PropertyType.STRING,
            description="Object or catalog number",
            max_length=100,
            ui_label="Object Number",
        ),
        "inventory_number": PropertySchema(
            type=PropertyType.STRING,
            description="Inventory number",
            max_length=100,
            ui_label="Inventory Number",
        ),
        "object_type": PropertySchema(
            type=PropertyType.STRING,
            description="Type of object",
            allowed_values=[
                "painting", "sculpture", "drawing", "print", "photograph",
                "textile", "ceramic", "glass", "metal", "furniture",
                "decorative_art", "installation", "video", "performance",
                "mixed_media", "natural_specimen", "archaeological",
                "ethnographic", "numismatic", "document", "book", "other"
            ],
            ui_label="Object Type",
            example="painting",
        ),
        "classification": PropertySchema(
            type=PropertyType.STRING,
            description="Classification or category",
            ui_label="Classification",
            example="Paintings",
        ),
        "department": PropertySchema(
            type=PropertyType.STRING,
            description="Museum department",
            ui_label="Department",
            example="European Paintings",
        ),
        "description": PropertySchema(
            type=PropertyType.STRING,
            description="Description of the object",
            max_length=10000,
            ui_label="Description",
        ),
        "date_created": PropertySchema(
            type=PropertyType.DATE,
            description="Date the object was created",
            ui_label="Date Created",
            example="1889-06",
        ),
        "date_display": PropertySchema(
            type=PropertyType.STRING,
            description="Display-formatted date",
            max_length=200,
            ui_label="Date",
            example="June 1889",
        ),
        "creator": PropertySchema(
            type=PropertyType.STRING,
            description="Creator/artist name(s)",
            ui_label="Artist/Maker",
            example="Vincent van Gogh",
        ),
        "culture": PropertySchema(
            type=PropertyType.STRING,
            description="Culture or cultural group",
            ui_label="Culture",
            example="Dutch",
        ),
        "period": PropertySchema(
            type=PropertyType.STRING,
            description="Historical period",
            ui_label="Period",
            example="Post-Impressionism",
        ),
        "dynasty": PropertySchema(
            type=PropertyType.STRING,
            description="Dynasty (for applicable cultures)",
            ui_label="Dynasty",
        ),
        "style": PropertySchema(
            type=PropertyType.STRING,
            description="Artistic style or movement",
            ui_label="Style",
            example="Post-Impressionist",
        ),
        "medium": PropertySchema(
            type=PropertyType.STRING,
            description="Medium and support",
            max_length=500,
            ui_label="Medium",
            example="Oil on canvas",
        ),
        "technique": PropertySchema(
            type=PropertyType.STRING,
            description="Technique used to create the object",
            ui_label="Technique",
        ),
        "materials": PropertySchema(
            type=PropertyType.ARRAY,
            description="Materials used",
            array_item_type=PropertyType.STRING,
            ui_label="Materials",
        ),
        "dimensions": PropertySchema(
            type=PropertyType.STRING,
            description="Dimensions (height x width x depth)",
            max_length=500,
            ui_label="Dimensions",
            example="73.7 cm × 92.1 cm (29 in × 36.3 in)",
        ),
        "inscription": PropertySchema(
            type=PropertyType.STRING,
            description="Inscriptions on the object",
            ui_label="Inscription",
        ),
        "markings": PropertySchema(
            type=PropertyType.STRING,
            description="Marks, stamps, or labels",
            ui_label="Markings",
        ),
        "signed": PropertySchema(
            type=PropertyType.STRING,
            description="Signature information",
            ui_label="Signed",
        ),
        "dated": PropertySchema(
            type=PropertyType.STRING,
            description="Date inscribed on the object",
            ui_label="Dated",
        ),
        "edition": PropertySchema(
            type=PropertyType.STRING,
            description="Edition information (for prints, multiples)",
            ui_label="Edition",
        ),
        "state": PropertySchema(
            type=PropertyType.STRING,
            description="State (for prints)",
            ui_label="State",
        ),
        "provenance": PropertySchema(
            type=PropertyType.STRING,
            description="Ownership history",
            max_length=10000,
            ui_label="Provenance",
        ),
        "exhibition_history": PropertySchema(
            type=PropertyType.STRING,
            description="Exhibition history",
            max_length=10000,
            ui_label="Exhibition History",
        ),
        "publication_history": PropertySchema(
            type=PropertyType.STRING,
            description="Publication/bibliography",
            max_length=10000,
            ui_label="Bibliography",
        ),
        "credit_line": PropertySchema(
            type=PropertyType.STRING,
            description="Credit line for display",
            max_length=500,
            ui_label="Credit Line",
            example="Gift of John D. Rockefeller Jr., 1941",
        ),
        "condition": PropertySchema(
            type=PropertyType.STRING,
            description="Current condition",
            allowed_values=["excellent", "good", "fair", "poor", "unknown"],
            ui_label="Condition",
        ),
        "condition_notes": PropertySchema(
            type=PropertyType.STRING,
            description="Detailed condition notes",
            ui_label="Condition Notes",
        ),
        "location": PropertySchema(
            type=PropertyType.STRING,
            description="Current storage location",
            ui_label="Location",
        ),
        "on_display": PropertySchema(
            type=PropertyType.BOOLEAN,
            description="Whether the object is currently on display",
            ui_label="On Display",
        ),
        "gallery": PropertySchema(
            type=PropertyType.STRING,
            description="Gallery where displayed",
            ui_label="Gallery",
            example="Gallery 19",
        ),
        "rights_statement": PropertySchema(
            type=PropertyType.STRING,
            description="Rights statement",
            ui_label="Rights",
        ),
        "copyright": PropertySchema(
            type=PropertyType.STRING,
            description="Copyright information",
            ui_label="Copyright",
        ),
        "public_domain": PropertySchema(
            type=PropertyType.BOOLEAN,
            description="Whether the object is in the public domain",
            ui_label="Public Domain",
        ),
        "iiif_manifest": PropertySchema(
            type=PropertyType.URL,
            description="IIIF manifest URL",
            ui_label="IIIF Manifest",
        ),
        "external_ids": PropertySchema(
            type=PropertyType.OBJECT,
            description="External identifiers (Wikidata, Getty ULAN, etc.)",
            ui_label="External IDs",
            example={"wikidata": "Q45585"},
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
        # Agent relationships
        RelationshipSchema(
            relationship_type="creator",
            target_profile="agent",
            description="Creator or artist of the object",
        ),
        RelationshipSchema(
            relationship_type="attributed_to",
            target_profile="agent",
            description="Agent to whom the work is attributed",
        ),
        RelationshipSchema(
            relationship_type="workshop_of",
            target_profile="agent",
            description="Workshop that produced the object",
        ),
        RelationshipSchema(
            relationship_type="after",
            target_profile="agent",
            description="Agent whose work this is after/copied from",
        ),
        RelationshipSchema(
            relationship_type="donor",
            target_profile="agent",
            description="Donor of the object",
        ),
        RelationshipSchema(
            relationship_type="former_owner",
            target_profile="agent",
            description="Previous owner",
        ),

        # Media relationships
        RelationshipSchema(
            relationship_type="primary_image",
            target_profile="media",
            description="Primary/representative image",
            max_count=1,
        ),
        RelationshipSchema(
            relationship_type="image",
            target_profile="media",
            description="Additional images",
        ),
        RelationshipSchema(
            relationship_type="documentation",
            target_profile="media",
            description="Documentation files (PDFs, videos, etc.)",
        ),

        # Place relationships
        RelationshipSchema(
            relationship_type="created_at",
            target_profile="place",
            description="Place where the object was created",
        ),
        RelationshipSchema(
            relationship_type="found_at",
            target_profile="place",
            description="Place where the object was found/discovered",
        ),
        RelationshipSchema(
            relationship_type="depicts_place",
            target_profile="place",
            description="Place depicted in the object",
        ),
        RelationshipSchema(
            relationship_type="current_location",
            target_profile="place",
            description="Current repository/museum",
            max_count=1,
        ),

        # Event relationships
        RelationshipSchema(
            relationship_type="exhibited_at",
            target_profile="event",
            description="Exhibitions where this object was shown",
        ),
        RelationshipSchema(
            relationship_type="acquired_through",
            target_profile="event",
            description="Acquisition event",
            max_count=1,
        ),

        # Work relationships
        RelationshipSchema(
            relationship_type="documented_in",
            target_profile="work",
            description="Publications documenting this object",
        ),

        # Self-relationships
        RelationshipSchema(
            relationship_type="related_to",
            target_profile="collections",
            description="Related collection items",
        ),
        RelationshipSchema(
            relationship_type="part_of",
            target_profile="collections",
            description="Parent object (for components)",
        ),
        RelationshipSchema(
            relationship_type="pendant_to",
            target_profile="collections",
            description="Companion or pendant piece",
        ),
    ],

    validation_rules=[
        ValidationRule(
            name="has_identifier",
            description="Collection items should have at least one identifier",
            check=_validate_has_identifier,
            severity=ValidationSeverity.WARNING,
        ),
    ],
)

# Register on import
register_profile(COLLECTIONS_PROFILE)
