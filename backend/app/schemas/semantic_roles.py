"""
Semantic Role Tagging for Descriptive Fields

Provides lightweight semantic hints for field values without enforcing ontologies.

Design Principles:
1. Roles are HINTS, not schema constraints
2. No CIDOC CRM classes or properties
3. All roles are optional - fields work without them
4. Roles inform export mapping (IIIF, JSON-LD) but don't constrain input
5. Multiple roles can apply to a single field value

This is NOT an ontology - it's a vocabulary of semantic hints that help
export services understand the intended meaning of field values.

Usage:
    # Field values can optionally include role hints
    {
        "value": "Claude Monet",
        "role": "creator",           # Optional semantic hint
        "role_qualifier": "artist",  # Optional sub-role
        "authorities": [...]         # Optional authority links
    }

    # Export services use roles to map to appropriate output
    if value.get("role") == "creator":
        # Map to schema:creator, dc:creator, IIIF metadata label "Creator"
"""

from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


# ============================================================================
# SEMANTIC ROLE DEFINITIONS
# ============================================================================

class SemanticRole(str, Enum):
    """
    Semantic roles for descriptive field values.

    These are hints that inform export mapping. They are:
    - Optional (fields work without roles)
    - Non-exclusive (a value can have multiple applicable roles)
    - Non-constraining (no validation enforced)

    Roles are grouped by semantic category but this grouping
    is informational only.
    """

    # ── Identification ──────────────────────────────────────────────────────
    TITLE = "title"                     # Primary name/title
    ALTERNATE_TITLE = "alternate_title" # Alternative names
    IDENTIFIER = "identifier"           # Accession number, catalog number

    # ── Agents ──────────────────────────────────────────────────────────────
    CREATOR = "creator"                 # Maker, artist, author
    CONTRIBUTOR = "contributor"         # Secondary contributor
    PUBLISHER = "publisher"             # Publishing entity
    OWNER = "owner"                     # Current or former owner
    DONOR = "donor"                     # Gift source
    COMMISSIONER = "commissioner"       # Who commissioned the work

    # ── Description ─────────────────────────────────────────────────────────
    DESCRIPTION = "description"         # General description
    PHYSICAL_DESCRIPTION = "physical_description"  # Physical characteristics
    INSCRIPTION = "inscription"         # Text on object
    MARK = "mark"                       # Maker's mark, stamp

    # ── Subject/Content ─────────────────────────────────────────────────────
    SUBJECT = "subject"                 # What the work depicts/is about
    GENRE = "genre"                     # Artistic genre
    STYLE = "style"                     # Artistic style/movement
    ICONOGRAPHY = "iconography"         # Iconographic subject

    # ── Classification ──────────────────────────────────────────────────────
    TYPE = "type"                       # Object type/work type
    CLASSIFICATION = "classification"   # Classification term
    CATEGORY = "category"               # Categorical grouping
    MEDIUM = "medium"                   # Artistic medium

    # ── Materials & Techniques ──────────────────────────────────────────────
    MATERIAL = "material"               # Physical material
    TECHNIQUE = "technique"             # Production technique
    SUPPORT = "support"                 # Support material (canvas, paper)

    # ── Temporal ────────────────────────────────────────────────────────────
    DATE_CREATED = "date_created"       # Creation date
    DATE_PUBLISHED = "date_published"   # Publication date
    DATE_MODIFIED = "date_modified"     # Modification date
    PERIOD = "period"                   # Historical period

    # ── Spatial ─────────────────────────────────────────────────────────────
    PLACE = "place"                     # General place reference
    PLACE_CREATED = "place_created"     # Where created
    PLACE_PUBLISHED = "place_published" # Where published
    PLACE_DEPICTED = "place_depicted"   # Place shown in work
    PLACE_FOUND = "place_found"         # Archaeological find spot
    CURRENT_LOCATION = "current_location"  # Where currently held

    # ── Measurements ────────────────────────────────────────────────────────
    DIMENSIONS = "dimensions"           # Size/dimensions
    WEIGHT = "weight"                   # Physical weight
    DURATION = "duration"               # Time-based media duration

    # ── Rights & Legal ──────────────────────────────────────────────────────
    RIGHTS = "rights"                   # Rights statement
    LICENSE = "license"                 # License terms
    COPYRIGHT = "copyright"             # Copyright holder

    # ── Provenance ──────────────────────────────────────────────────────────
    PROVENANCE = "provenance"           # Ownership history
    EXHIBITION = "exhibition"           # Exhibition history
    PUBLICATION = "publication"         # Publication reference

    # ── Related ─────────────────────────────────────────────────────────────
    RELATED_WORK = "related_work"       # Related artwork
    PART_OF = "part_of"                 # Parent work/collection
    HAS_PART = "has_part"               # Component parts

    # ── Notes ───────────────────────────────────────────────────────────────
    NOTE = "note"                       # General note
    CONDITION_NOTE = "condition_note"   # Condition information
    CONSERVATION_NOTE = "conservation_note"  # Conservation history


# Role qualifiers provide sub-categorization without creating new roles
ROLE_QUALIFIERS = {
    SemanticRole.CREATOR: [
        "artist", "maker", "author", "architect", "designer",
        "photographer", "sculptor", "printmaker", "attributed_to",
        "workshop_of", "circle_of", "follower_of", "after",
        "manner_of", "school_of", "studio_of"
    ],
    SemanticRole.CONTRIBUTOR: [
        "editor", "translator", "printer", "foundry", "fabricator",
        "restorer", "framer"
    ],
    SemanticRole.TITLE: [
        "preferred", "descriptive", "former", "translated",
        "inscribed", "popular", "series"
    ],
    SemanticRole.MATERIAL: [
        "primary", "secondary", "support", "medium", "pigment",
        "binder", "ground"
    ],
    SemanticRole.PLACE: [
        "country", "region", "city", "site", "coordinates"
    ],
    SemanticRole.DATE_CREATED: [
        "exact", "circa", "before", "after", "between"
    ],
    SemanticRole.INSCRIPTION: [
        "signature", "date", "dedication", "label", "stamp", "watermark"
    ],
}


# ============================================================================
# ROLE-TAGGED VALUE SCHEMA
# ============================================================================

class RoleTaggedValue(BaseModel):
    """
    A field value with optional semantic role tagging.

    The role and qualifier are hints for export mapping.
    They do not constrain the value in any way.

    Example:
        {
            "value": "Claude Monet",
            "role": "creator",
            "role_qualifier": "artist",
            "display_value": "Claude Monet (French, 1840-1926)",
            "authorities": [
                {"uri": "http://vocab.getty.edu/ulan/500019484", "source": "ULAN"}
            ],
            "note": "Signed lower right"
        }
    """
    # The actual value (required)
    value: str = Field(..., description="The field value")

    # Semantic role hint (optional)
    role: Optional[str] = Field(
        None,
        description="Semantic role hint (e.g., 'creator', 'subject'). Optional."
    )

    # Role qualifier for sub-categorization (optional)
    role_qualifier: Optional[str] = Field(
        None,
        description="Qualifier for the role (e.g., 'artist' for creator role). Optional."
    )

    # Display value (optional, for formatted output)
    display_value: Optional[str] = Field(
        None,
        description="Formatted display value. If not provided, use 'value'."
    )

    # Authority links (optional)
    authorities: Optional[List[Dict[str, str]]] = Field(
        None,
        description="Authority URI references (ULAN, AAT, etc.). Optional."
    )

    # Additional note (optional)
    note: Optional[str] = Field(
        None,
        description="Additional note about this value. Optional."
    )

    # Confidence/certainty indicator (optional)
    certainty: Optional[str] = Field(
        None,
        description="Certainty indicator (certain, probable, possible, uncertain). Optional."
    )

    # Language code (optional)
    language: Optional[str] = Field(
        None,
        description="Language code (e.g., 'en', 'fr'). Optional."
    )

    class Config:
        extra = "allow"  # Allow additional fields without validation

    def get_display(self) -> str:
        """Get the display value, falling back to value."""
        return self.display_value or self.value

    def has_role(self, role: str) -> bool:
        """Check if this value has a specific role."""
        return self.role == role if self.role else False

    def get_authority_uri(self, source: str = None) -> Optional[str]:
        """Get the first authority URI, optionally filtered by source."""
        if not self.authorities:
            return None
        for auth in self.authorities:
            if source is None or auth.get("source") == source:
                return auth.get("uri")
        return None


# ============================================================================
# FIELD CONFIGURATION
# ============================================================================

class FieldRoleConfig(BaseModel):
    """
    Configuration for a field's semantic role behavior.

    This is stored at the organization or system level to define
    how fields should be handled during export.

    Example:
        {
            "field_name": "creators",
            "default_role": "creator",
            "suggested_qualifiers": ["artist", "attributed_to"],
            "export_mappings": {
                "iiif": {"label": "Creator"},
                "schema_org": {"property": "creator"},
                "dc": {"element": "creator"}
            }
        }
    """
    # Field identifier
    field_name: str = Field(..., description="Internal field name")

    # Default role if not specified in value
    default_role: Optional[str] = Field(
        None,
        description="Default semantic role for this field. Optional."
    )

    # Suggested qualifiers (informational only)
    suggested_qualifiers: Optional[List[str]] = Field(
        None,
        description="Suggested role qualifiers for this field. Optional."
    )

    # Whether this field typically contains multiple values
    is_repeatable: bool = Field(
        True,
        description="Whether this field can have multiple values."
    )

    # Export mappings (informational, used by export services)
    export_mappings: Optional[Dict[str, Dict[str, str]]] = Field(
        None,
        description="Mapping hints for export formats. Optional."
    )

    # Human-readable label
    display_label: Optional[str] = Field(
        None,
        description="Human-readable label for display."
    )

    # Whether values should include authority links
    supports_authorities: bool = Field(
        True,
        description="Whether values in this field can have authority links."
    )

    # Authority sources that make sense for this field
    suggested_authority_sources: Optional[List[str]] = Field(
        None,
        description="Suggested authority sources (ULAN, AAT, etc.). Optional."
    )


# ============================================================================
# DEFAULT FIELD CONFIGURATIONS
# ============================================================================

# Standard CDWA/procedure field configurations
# These are defaults that can be overridden per organization
DEFAULT_FIELD_CONFIGS: Dict[str, FieldRoleConfig] = {
    "creators": FieldRoleConfig(
        field_name="creators",
        default_role="creator",
        suggested_qualifiers=["artist", "maker", "attributed_to", "workshop_of"],
        is_repeatable=True,
        supports_authorities=True,
        suggested_authority_sources=["ULAN", "VIAF", "Wikidata"],
        display_label="Creator/Maker",
        export_mappings={
            "iiif": {"label": "Creator"},
            "schema_org": {"property": "creator", "type": "Person"},
            "dc": {"element": "creator"},
        }
    ),
    "titles": FieldRoleConfig(
        field_name="titles",
        default_role="title",
        suggested_qualifiers=["preferred", "descriptive", "former"],
        is_repeatable=True,
        supports_authorities=False,
        display_label="Title",
        export_mappings={
            "iiif": {"label": "Title", "use_as_label": "true"},
            "schema_org": {"property": "name"},
            "dc": {"element": "title"},
        }
    ),
    "materials": FieldRoleConfig(
        field_name="materials",
        default_role="material",
        suggested_qualifiers=["primary", "support", "medium"],
        is_repeatable=True,
        supports_authorities=True,
        suggested_authority_sources=["AAT"],
        display_label="Materials",
        export_mappings={
            "iiif": {"label": "Materials"},
            "schema_org": {"property": "material"},
            "dc": {"element": "medium"},
        }
    ),
    "techniques": FieldRoleConfig(
        field_name="techniques",
        default_role="technique",
        is_repeatable=True,
        supports_authorities=True,
        suggested_authority_sources=["AAT"],
        display_label="Techniques",
        export_mappings={
            "iiif": {"label": "Techniques"},
            "schema_org": {"property": "artform"},
            "dc": {"element": "medium"},
        }
    ),
    "subjects": FieldRoleConfig(
        field_name="subjects",
        default_role="subject",
        suggested_qualifiers=["depicted", "about", "iconography"],
        is_repeatable=True,
        supports_authorities=True,
        suggested_authority_sources=["AAT", "LCSH", "Iconclass"],
        display_label="Subject",
        export_mappings={
            "iiif": {"label": "Subject"},
            "schema_org": {"property": "about"},
            "dc": {"element": "subject"},
        }
    ),
    "classifications": FieldRoleConfig(
        field_name="classifications",
        default_role="classification",
        is_repeatable=True,
        supports_authorities=True,
        suggested_authority_sources=["AAT"],
        display_label="Classification",
        export_mappings={
            "iiif": {"label": "Classification"},
            "schema_org": {"property": "genre"},
            "dc": {"element": "type"},
        }
    ),
    "creation_place": FieldRoleConfig(
        field_name="creation_place",
        default_role="place_created",
        suggested_qualifiers=["country", "region", "city"],
        is_repeatable=False,
        supports_authorities=True,
        suggested_authority_sources=["TGN", "GeoNames"],
        display_label="Place of Creation",
        export_mappings={
            "iiif": {"label": "Place of Creation"},
            "schema_org": {"property": "locationCreated", "type": "Place"},
            "dc": {"element": "spatial"},
        }
    ),
    "depicted_places": FieldRoleConfig(
        field_name="depicted_places",
        default_role="place_depicted",
        is_repeatable=True,
        supports_authorities=True,
        suggested_authority_sources=["TGN", "GeoNames"],
        display_label="Depicted Place",
        export_mappings={
            "iiif": {"label": "Depicted Place"},
            "schema_org": {"property": "contentLocation", "type": "Place"},
        }
    ),
    "depicted_people": FieldRoleConfig(
        field_name="depicted_people",
        default_role="subject",
        suggested_qualifiers=["portrait_of", "depicted"],
        is_repeatable=True,
        supports_authorities=True,
        suggested_authority_sources=["ULAN", "VIAF"],
        display_label="Depicted Person",
        export_mappings={
            "iiif": {"label": "Depicted Person"},
            "schema_org": {"property": "about", "type": "Person"},
        }
    ),
    "inscriptions": FieldRoleConfig(
        field_name="inscriptions",
        default_role="inscription",
        suggested_qualifiers=["signature", "date", "dedication", "label"],
        is_repeatable=True,
        supports_authorities=False,
        display_label="Inscriptions",
        export_mappings={
            "iiif": {"label": "Inscriptions"},
            "schema_org": {"property": "text"},
        }
    ),
    "provenance": FieldRoleConfig(
        field_name="provenance",
        default_role="provenance",
        is_repeatable=False,
        supports_authorities=True,
        suggested_authority_sources=["ULAN", "VIAF"],
        display_label="Provenance",
        export_mappings={
            "iiif": {"label": "Provenance"},
            "dc": {"element": "provenance"},
        }
    ),
    "brief_description": FieldRoleConfig(
        field_name="brief_description",
        default_role="description",
        is_repeatable=False,
        supports_authorities=False,
        display_label="Description",
        export_mappings={
            "iiif": {"label": "Description", "use_as_summary": "true"},
            "schema_org": {"property": "description"},
            "dc": {"element": "description"},
        }
    ),
    "style_period": FieldRoleConfig(
        field_name="style_period",
        default_role="style",
        is_repeatable=False,
        supports_authorities=True,
        suggested_authority_sources=["AAT"],
        display_label="Style/Period",
        export_mappings={
            "iiif": {"label": "Style/Period"},
            "schema_org": {"property": "artMedium"},
        }
    ),
    "object_type": FieldRoleConfig(
        field_name="object_type",
        default_role="type",
        is_repeatable=False,
        supports_authorities=True,
        suggested_authority_sources=["AAT"],
        display_label="Object Type",
        export_mappings={
            "iiif": {"label": "Type"},
            "schema_org": {"property": "@type"},
            "dc": {"element": "type"},
        }
    ),
    "credit_line": FieldRoleConfig(
        field_name="credit_line",
        default_role="rights",
        is_repeatable=False,
        supports_authorities=False,
        display_label="Credit Line",
        export_mappings={
            "iiif": {"use_as_attribution": "true"},
            "schema_org": {"property": "creditText"},
        }
    ),
    # copyright_status removed - rights managed via ObjectRight records
}


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def get_field_config(field_name: str) -> Optional[FieldRoleConfig]:
    """Get the configuration for a field, or None if not configured."""
    return DEFAULT_FIELD_CONFIGS.get(field_name)


def get_default_role(field_name: str) -> Optional[str]:
    """Get the default semantic role for a field."""
    config = get_field_config(field_name)
    return config.default_role if config else None


def normalize_value_with_role(
    value: Any,
    field_name: str = None,
    default_role: str = None
) -> RoleTaggedValue:
    """
    Normalize a field value to RoleTaggedValue format.

    Handles various input formats:
    - String: "Claude Monet"
    - Dict with value: {"value": "Claude Monet", "role": "creator"}
    - Dict with name (legacy): {"name": "Claude Monet"}
    - Dict with term (legacy): {"term": "Oil paint"}

    Args:
        value: The value to normalize
        field_name: Optional field name for default role lookup
        default_role: Optional default role to apply

    Returns:
        RoleTaggedValue with optional role hint
    """
    # Determine default role
    if default_role is None and field_name:
        default_role = get_default_role(field_name)

    # Handle string input
    if isinstance(value, str):
        return RoleTaggedValue(
            value=value,
            role=default_role
        )

    # Handle dict input
    if isinstance(value, dict):
        # Extract the actual value from various keys
        val = (
            value.get("value") or
            value.get("name") or
            value.get("term") or
            value.get("title") or
            str(value)
        )

        # Extract role (explicit or default)
        role = value.get("role") or default_role

        return RoleTaggedValue(
            value=val,
            role=role,
            role_qualifier=value.get("role_qualifier") or value.get("qualifier"),
            display_value=value.get("display_value") or value.get("display"),
            authorities=value.get("authorities"),
            note=value.get("note"),
            certainty=value.get("certainty") or value.get("attribution"),
            language=value.get("language") or value.get("lang"),
        )

    # Fallback for other types
    return RoleTaggedValue(
        value=str(value),
        role=default_role
    )


def extract_values_by_role(
    values: List[Any],
    role: str,
    field_name: str = None
) -> List[RoleTaggedValue]:
    """
    Extract values that have a specific semantic role.

    Args:
        values: List of values (can be mixed formats)
        role: The semantic role to filter by
        field_name: Optional field name for normalization

    Returns:
        List of RoleTaggedValue objects with the specified role
    """
    result = []
    for v in values:
        normalized = normalize_value_with_role(v, field_name)
        if normalized.has_role(role):
            result.append(normalized)
    return result


def group_values_by_role(
    values: List[Any],
    field_name: str = None
) -> Dict[str, List[RoleTaggedValue]]:
    """
    Group values by their semantic role.

    Args:
        values: List of values (can be mixed formats)
        field_name: Optional field name for normalization

    Returns:
        Dict mapping role names to lists of values
    """
    groups: Dict[str, List[RoleTaggedValue]] = {}

    for v in values:
        normalized = normalize_value_with_role(v, field_name)
        role = normalized.role or "unspecified"

        if role not in groups:
            groups[role] = []
        groups[role].append(normalized)

    return groups
