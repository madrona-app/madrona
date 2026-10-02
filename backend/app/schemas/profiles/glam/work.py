"""
Work Profile

Profile for archival and library materials in GLAM contexts.
Works represent documents, publications, manuscripts, and other
textual or archival materials distinct from physical collection objects.
"""

from ..base import (
    Profile,
    PropertySchema,
    PropertyType,
    RelationshipSchema,
)
from ..registry import register_profile


WORK_PROFILE = Profile(
    name="work",
    version="1.0.0",
    description="Archival materials, documents, publications, and manuscripts",
    canonical_type="WORK",

    required_properties=[
        "title",
    ],

    recommended_properties=[
        "work_type",
        "description",
        "date_created",
        "creator",
        "language",
        "extent",
    ],

    optional_properties=[
        "subtitle",
        "alternate_titles",
        "date_display",
        "date_published",
        "publisher",
        "place_published",
        "edition",
        "volume",
        "issue",
        "pages",
        "series",
        "abstract",
        "table_of_contents",
        "subjects",
        "genre",
        "format",
        "identifier",
        "isbn",
        "issn",
        "doi",
        "call_number",
        "accession_number",
        "provenance",
        "condition",
        "restrictions",
        "rights_statement",
        "finding_aid_url",
        "digital_collection_url",
        "external_ids",
        "notes",
    ],

    property_schemas={
        "title": PropertySchema(
            type=PropertyType.STRING,
            description="Title of the work",
            min_length=1,
            max_length=1000,
            ui_label="Title",
            example="Letters from Vincent van Gogh to Theo van Gogh",
        ),
        "subtitle": PropertySchema(
            type=PropertyType.STRING,
            description="Subtitle of the work",
            max_length=500,
            ui_label="Subtitle",
        ),
        "alternate_titles": PropertySchema(
            type=PropertyType.ARRAY,
            description="Alternate or variant titles",
            array_item_type=PropertyType.STRING,
            ui_label="Alternate Titles",
        ),
        "work_type": PropertySchema(
            type=PropertyType.STRING,
            description="Type of work",
            allowed_values=[
                "book", "article", "manuscript", "letter", "diary", "journal",
                "newspaper", "periodical", "pamphlet", "thesis", "dissertation",
                "report", "map", "score", "photograph_album", "scrapbook",
                "archive_collection", "finding_aid", "catalog", "other"
            ],
            ui_label="Work Type",
            example="letter",
        ),
        "description": PropertySchema(
            type=PropertyType.STRING,
            description="Description or abstract",
            max_length=10000,
            ui_label="Description",
        ),
        "abstract": PropertySchema(
            type=PropertyType.STRING,
            description="Formal abstract",
            max_length=5000,
            ui_label="Abstract",
        ),
        "date_created": PropertySchema(
            type=PropertyType.DATE,
            description="Date the work was created",
            ui_label="Date Created",
        ),
        "date_display": PropertySchema(
            type=PropertyType.STRING,
            description="Display-formatted date",
            ui_label="Display Date",
            example="ca. 1888",
        ),
        "date_published": PropertySchema(
            type=PropertyType.DATE,
            description="Publication date",
            ui_label="Date Published",
        ),
        "creator": PropertySchema(
            type=PropertyType.STRING,
            description="Creator/author name(s)",
            ui_label="Creator",
            example="Vincent van Gogh",
        ),
        "publisher": PropertySchema(
            type=PropertyType.STRING,
            description="Publisher name",
            ui_label="Publisher",
        ),
        "place_published": PropertySchema(
            type=PropertyType.STRING,
            description="Place of publication",
            ui_label="Place Published",
            example="Amsterdam",
        ),
        "language": PropertySchema(
            type=PropertyType.STRING,
            description="Primary language (ISO 639-1 code)",
            ui_label="Language",
            example="nl",
        ),
        "edition": PropertySchema(
            type=PropertyType.STRING,
            description="Edition information",
            ui_label="Edition",
            example="First Edition",
        ),
        "volume": PropertySchema(
            type=PropertyType.STRING,
            description="Volume number or identifier",
            ui_label="Volume",
        ),
        "issue": PropertySchema(
            type=PropertyType.STRING,
            description="Issue number",
            ui_label="Issue",
        ),
        "pages": PropertySchema(
            type=PropertyType.STRING,
            description="Page range or count",
            ui_label="Pages",
            example="1-45",
        ),
        "extent": PropertySchema(
            type=PropertyType.STRING,
            description="Physical extent (e.g., '3 boxes', '150 pages')",
            ui_label="Extent",
        ),
        "series": PropertySchema(
            type=PropertyType.STRING,
            description="Series title",
            ui_label="Series",
        ),
        "table_of_contents": PropertySchema(
            type=PropertyType.STRING,
            description="Table of contents",
            ui_label="Table of Contents",
        ),
        "subjects": PropertySchema(
            type=PropertyType.ARRAY,
            description="Subject headings",
            array_item_type=PropertyType.STRING,
            ui_label="Subjects",
        ),
        "genre": PropertySchema(
            type=PropertyType.STRING,
            description="Genre or form",
            ui_label="Genre",
        ),
        "format": PropertySchema(
            type=PropertyType.STRING,
            description="Physical format",
            ui_label="Format",
            example="Handwritten letter on paper",
        ),
        "identifier": PropertySchema(
            type=PropertyType.STRING,
            description="Primary identifier",
            ui_label="Identifier",
        ),
        "isbn": PropertySchema(
            type=PropertyType.STRING,
            description="ISBN",
            ui_label="ISBN",
        ),
        "issn": PropertySchema(
            type=PropertyType.STRING,
            description="ISSN",
            ui_label="ISSN",
        ),
        "doi": PropertySchema(
            type=PropertyType.STRING,
            description="DOI",
            ui_label="DOI",
        ),
        "call_number": PropertySchema(
            type=PropertyType.STRING,
            description="Library call number",
            ui_label="Call Number",
        ),
        "accession_number": PropertySchema(
            type=PropertyType.STRING,
            description="Accession or acquisition number",
            ui_label="Accession Number",
        ),
        "provenance": PropertySchema(
            type=PropertyType.STRING,
            description="Provenance or ownership history",
            ui_label="Provenance",
        ),
        "condition": PropertySchema(
            type=PropertyType.STRING,
            description="Physical condition",
            ui_label="Condition",
        ),
        "restrictions": PropertySchema(
            type=PropertyType.STRING,
            description="Access or use restrictions",
            ui_label="Restrictions",
        ),
        "rights_statement": PropertySchema(
            type=PropertyType.STRING,
            description="Rights or copyright statement",
            ui_label="Rights Statement",
        ),
        "finding_aid_url": PropertySchema(
            type=PropertyType.URL,
            description="URL to finding aid",
            ui_label="Finding Aid URL",
        ),
        "digital_collection_url": PropertySchema(
            type=PropertyType.URL,
            description="URL to digital collection",
            ui_label="Digital Collection URL",
        ),
        "external_ids": PropertySchema(
            type=PropertyType.OBJECT,
            description="External identifiers (OCLC, LCCN, etc.)",
            ui_label="External IDs",
            example={"oclc": "123456789", "lccn": "2020123456"},
        ),
        "notes": PropertySchema(
            type=PropertyType.STRING,
            description="Additional notes",
            ui_label="Notes",
        ),
    },

    relationships=[
        RelationshipSchema(
            relationship_type="creator",
            target_profile="agent",
            description="Creator or author of the work",
        ),
        RelationshipSchema(
            relationship_type="contributor",
            target_profile="agent",
            description="Contributors (editors, translators, illustrators)",
        ),
        RelationshipSchema(
            relationship_type="publisher",
            target_profile="agent",
            description="Publishing organization",
        ),
        RelationshipSchema(
            relationship_type="subject",
            target_profile="agent",
            description="Person or organization that is the subject",
        ),
        RelationshipSchema(
            relationship_type="about",
            target_profile="collections",
            description="Collection item this work documents or describes",
        ),
        RelationshipSchema(
            relationship_type="about_place",
            target_profile="place",
            description="Place this work is about",
        ),
        RelationshipSchema(
            relationship_type="about_event",
            target_profile="event",
            description="Event this work is about",
        ),
        RelationshipSchema(
            relationship_type="held_by",
            target_profile="place",
            description="Repository or institution holding this work",
        ),
        RelationshipSchema(
            relationship_type="image",
            target_profile="media",
            description="Digital images of this work",
        ),
        RelationshipSchema(
            relationship_type="part_of",
            target_profile="work",
            description="Parent work or collection",
        ),
        RelationshipSchema(
            relationship_type="related_work",
            target_profile="work",
            description="Related works",
        ),
    ],
)

# Register on import
register_profile(WORK_PROFILE)
