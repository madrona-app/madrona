"""
Semantic Role Export Utilities

Demonstrates how semantic roles are used in IIIF and JSON-LD exports.

These utilities translate role-tagged values to appropriate output formats
without enforcing ontological constraints.
"""

from typing import Any, Dict, List, Optional

from app.schemas.semantic_roles import (
    SemanticRole,
    RoleTaggedValue,
    FieldRoleConfig,
    DEFAULT_FIELD_CONFIGS,
    normalize_value_with_role,
    group_values_by_role,
)


# ============================================================================
# IIIF EXPORT UTILITIES
# ============================================================================

def to_iiif_metadata(
    field_name: str,
    values: List[Any],
    lang: str = "en"
) -> List[Dict[str, Any]]:
    """
    Convert role-tagged values to IIIF metadata format.

    Uses semantic roles to determine:
    - Metadata label (from field config or role)
    - Whether to include seeAlso for authorities
    - Value formatting

    Args:
        field_name: Field name for configuration lookup
        values: List of values (any format)
        lang: Language code for labels

    Returns:
        List of IIIF metadata entries

    Example output:
        [
            {
                "label": {"en": ["Creator"]},
                "value": {"en": ["Claude Monet"]},
                "seeAlso": [
                    {"id": "http://vocab.getty.edu/ulan/500019484", "type": "Dataset"}
                ]
            }
        ]
    """
    config = DEFAULT_FIELD_CONFIGS.get(field_name)
    result = []

    for value in values:
        normalized = normalize_value_with_role(value, field_name)

        # Determine label from config or role
        if config and config.export_mappings and "iiif" in config.export_mappings:
            label = config.export_mappings["iiif"].get("label", field_name.replace("_", " ").title())
        elif normalized.role:
            label = normalized.role.replace("_", " ").title()
        else:
            label = config.display_label if config else field_name.replace("_", " ").title()

        entry = {
            "label": {lang: [label]},
            "value": {lang: [normalized.get_display()]}
        }

        # Add seeAlso for authority links
        if normalized.authorities:
            entry["seeAlso"] = [
                {
                    "id": auth["uri"],
                    "type": "Dataset",
                    "label": {lang: [auth.get("source", "Authority")]},
                    "format": "application/ld+json"
                }
                for auth in normalized.authorities
                if auth.get("uri")
            ]

        result.append(entry)

    return result


def to_iiif_metadata_grouped(
    field_name: str,
    values: List[Any],
    lang: str = "en"
) -> Dict[str, Any]:
    """
    Convert role-tagged values to a single IIIF metadata entry with grouped values.

    Combines multiple values of the same role into a single entry.

    Args:
        field_name: Field name for configuration lookup
        values: List of values (any format)
        lang: Language code for labels

    Returns:
        Single IIIF metadata entry with combined values

    Example output:
        {
            "label": {"en": ["Materials"]},
            "value": {"en": ["Oil paint", "Canvas"]}
        }
    """
    config = DEFAULT_FIELD_CONFIGS.get(field_name)
    normalized = [normalize_value_with_role(v, field_name) for v in values]

    if not normalized:
        return None

    # Determine label
    if config and config.export_mappings and "iiif" in config.export_mappings:
        label = config.export_mappings["iiif"].get("label", field_name.replace("_", " ").title())
    else:
        label = config.display_label if config else field_name.replace("_", " ").title()

    # Combine values
    display_values = [n.get_display() for n in normalized]

    entry = {
        "label": {lang: [label]},
        "value": {lang: display_values}
    }

    # Collect all authority links
    all_authorities = []
    for n in normalized:
        if n.authorities:
            all_authorities.extend([
                {
                    "id": auth["uri"],
                    "type": "Dataset",
                    "label": {lang: [auth.get("source", "Authority")]},
                    "format": "application/ld+json"
                }
                for auth in n.authorities
                if auth.get("uri")
            ])

    if all_authorities:
        entry["seeAlso"] = all_authorities

    return entry


def role_to_iiif_label(role: str) -> str:
    """Map a semantic role to an appropriate IIIF metadata label."""
    label_map = {
        "creator": "Creator",
        "contributor": "Contributor",
        "title": "Title",
        "alternate_title": "Alternate Title",
        "description": "Description",
        "subject": "Subject",
        "material": "Materials",
        "technique": "Techniques",
        "place_created": "Place of Creation",
        "place_depicted": "Depicted Place",
        "date_created": "Date",
        "period": "Period",
        "style": "Style",
        "classification": "Classification",
        "type": "Type",
        "provenance": "Provenance",
        "inscription": "Inscriptions",
        "dimensions": "Dimensions",
        "rights": "Rights",
        "credit_line": "Credit Line",
        "owner": "Owner",
        "current_location": "Current Location",
    }
    return label_map.get(role, role.replace("_", " ").title())


# ============================================================================
# JSON-LD / SCHEMA.ORG EXPORT UTILITIES
# ============================================================================

def to_schema_org_property(
    field_name: str,
    values: List[Any]
) -> Dict[str, Any]:
    """
    Convert role-tagged values to schema.org properties.

    Uses semantic roles to determine:
    - Appropriate schema.org property name
    - Type annotation (@type)
    - sameAs links from authorities

    Args:
        field_name: Field name for configuration lookup
        values: List of values (any format)

    Returns:
        Dict suitable for JSON-LD schema.org output

    Example output:
        {
            "creator": [
                {
                    "@type": "Person",
                    "name": "Claude Monet",
                    "sameAs": ["http://vocab.getty.edu/ulan/500019484"]
                }
            ]
        }
    """
    config = DEFAULT_FIELD_CONFIGS.get(field_name)
    normalized = [normalize_value_with_role(v, field_name) for v in values]

    if not normalized:
        return {}

    # Determine schema.org property name
    if config and config.export_mappings and "schema_org" in config.export_mappings:
        mapping = config.export_mappings["schema_org"]
        property_name = mapping.get("property", field_name)
        entity_type = mapping.get("type")
    else:
        property_name = role_to_schema_property(normalized[0].role or field_name)
        entity_type = None

    # Build property value(s)
    property_values = []
    for n in normalized:
        if entity_type:
            # Structured value with type
            value = {
                "@type": entity_type,
                "name": n.get_display()
            }
            # Add sameAs from authorities
            if n.authorities:
                same_as = [a["uri"] for a in n.authorities if a.get("uri")]
                if same_as:
                    value["sameAs"] = same_as if len(same_as) > 1 else same_as[0]
        else:
            # Simple string value
            value = n.get_display()

        property_values.append(value)

    # Return single value or array
    if len(property_values) == 1:
        return {property_name: property_values[0]}
    return {property_name: property_values}


def role_to_schema_property(role: str) -> str:
    """Map a semantic role to a schema.org property name."""
    property_map = {
        "creator": "creator",
        "contributor": "contributor",
        "publisher": "publisher",
        "title": "name",
        "description": "description",
        "subject": "about",
        "material": "material",
        "technique": "artform",
        "place_created": "locationCreated",
        "place_depicted": "contentLocation",
        "date_created": "dateCreated",
        "date_published": "datePublished",
        "period": "temporalCoverage",
        "style": "artMedium",
        "classification": "genre",
        "type": "additionalType",
        "provenance": "acquiredFrom",
        "inscription": "text",
        "dimensions": "size",
        "rights": "license",
        "copyright": "copyrightHolder",
        "credit_line": "creditText",
        "owner": "maintainer",
        "current_location": "contentLocation",
        "identifier": "identifier",
    }
    return property_map.get(role, role)


def to_jsonld_object(
    data: Dict[str, Any],
    context: Dict[str, str] = None,
    base_type: str = "CreativeWork"
) -> Dict[str, Any]:
    """
    Convert an object with role-tagged fields to full JSON-LD.

    Args:
        data: Object data with role-tagged fields
        context: JSON-LD @context (default: schema.org)
        base_type: Base @type (default: CreativeWork)

    Returns:
        Complete JSON-LD document

    Example output:
        {
            "@context": "https://schema.org/",
            "@type": "VisualArtwork",
            "name": "Water Lilies",
            "creator": {
                "@type": "Person",
                "name": "Claude Monet",
                "sameAs": "http://vocab.getty.edu/ulan/500019484"
            },
            "material": ["Oil paint", "Canvas"],
            "dateCreated": "1906"
        }
    """
    jsonld = {
        "@context": context or "https://schema.org/",
        "@type": base_type,
    }

    # Process each configured field
    for field_name, config in DEFAULT_FIELD_CONFIGS.items():
        if field_name not in data:
            continue

        value = data[field_name]

        # Skip if no schema.org mapping
        if not config.export_mappings or "schema_org" not in config.export_mappings:
            continue

        mapping = config.export_mappings["schema_org"]
        property_name = mapping.get("property")
        if not property_name:
            continue

        # Normalize values
        if isinstance(value, list):
            normalized = [normalize_value_with_role(v, field_name) for v in value]
        else:
            normalized = [normalize_value_with_role(value, field_name)]

        # Build property value(s)
        entity_type = mapping.get("type")
        property_values = []

        for n in normalized:
            if entity_type:
                prop_value = {
                    "@type": entity_type,
                    "name": n.get_display()
                }
                if n.authorities:
                    same_as = [a["uri"] for a in n.authorities if a.get("uri")]
                    if same_as:
                        prop_value["sameAs"] = same_as if len(same_as) > 1 else same_as[0]
                property_values.append(prop_value)
            else:
                property_values.append(n.get_display())

        # Add to JSON-LD
        if property_values:
            if len(property_values) == 1 and not config.is_repeatable:
                jsonld[property_name] = property_values[0]
            else:
                jsonld[property_name] = property_values

    return jsonld


# ============================================================================
# DUBLIN CORE EXPORT UTILITIES
# ============================================================================

def to_dublin_core(
    field_name: str,
    values: List[Any]
) -> List[Dict[str, str]]:
    """
    Convert role-tagged values to Dublin Core elements.

    Args:
        field_name: Field name for configuration lookup
        values: List of values (any format)

    Returns:
        List of DC element dicts

    Example output:
        [
            {"element": "creator", "value": "Claude Monet"},
            {"element": "creator", "value": "Pierre-Auguste Renoir"}
        ]
    """
    config = DEFAULT_FIELD_CONFIGS.get(field_name)
    normalized = [normalize_value_with_role(v, field_name) for v in values]

    if not normalized:
        return []

    # Determine DC element
    if config and config.export_mappings and "dc" in config.export_mappings:
        element = config.export_mappings["dc"].get("element", field_name)
    else:
        element = role_to_dc_element(normalized[0].role or field_name)

    return [
        {"element": element, "value": n.get_display()}
        for n in normalized
    ]


def role_to_dc_element(role: str) -> str:
    """Map a semantic role to a Dublin Core element."""
    dc_map = {
        "creator": "creator",
        "contributor": "contributor",
        "publisher": "publisher",
        "title": "title",
        "description": "description",
        "subject": "subject",
        "material": "medium",
        "technique": "medium",
        "place_created": "spatial",
        "date_created": "created",
        "date_published": "issued",
        "period": "temporal",
        "type": "type",
        "classification": "type",
        "provenance": "provenance",
        "rights": "rights",
        "copyright": "rights",
        "identifier": "identifier",
        "current_location": "spatial",
    }
    return dc_map.get(role, "description")


# ============================================================================
# EXAMPLE USAGE
# ============================================================================

def example_usage():
    """
    Demonstrates how semantic roles flow through exports.

    This example shows the same data exported to IIIF, schema.org, and DC.
    """
    # Input data with role-tagged values
    object_data = {
        "object_number": "2024.1.1",
        "titles": [
            {
                "value": "Water Lilies",
                "role": "title",
                "role_qualifier": "preferred",
                "language": "en"
            },
            {
                "value": "Nymphéas",
                "role": "title",
                "role_qualifier": "translated",
                "language": "fr"
            }
        ],
        "creators": [
            {
                "value": "Claude Monet",
                "role": "creator",
                "role_qualifier": "artist",
                "authorities": [
                    {"uri": "http://vocab.getty.edu/ulan/500019484", "source": "ULAN"},
                    {"uri": "https://www.wikidata.org/entity/Q296", "source": "Wikidata"}
                ]
            }
        ],
        "materials": [
            {
                "value": "Oil paint",
                "role": "material",
                "role_qualifier": "medium",
                "authorities": [
                    {"uri": "http://vocab.getty.edu/aat/300015050", "source": "AAT"}
                ]
            },
            {
                "value": "Canvas",
                "role": "material",
                "role_qualifier": "support",
                "authorities": [
                    {"uri": "http://vocab.getty.edu/aat/300014078", "source": "AAT"}
                ]
            }
        ],
        "creation_place": {
            "value": "Giverny, France",
            "role": "place_created",
            "authorities": [
                {"uri": "http://vocab.getty.edu/tgn/7008038", "source": "TGN"}
            ]
        },
        "brief_description": "One of Monet's famous water lily paintings from his garden at Giverny."
    }

    # Export to IIIF metadata
    iiif_metadata = []
    for field_name in ["creators", "materials"]:
        if field_name in object_data:
            iiif_metadata.extend(to_iiif_metadata(field_name, object_data[field_name]))

    print("IIIF Metadata:")
    print(iiif_metadata)

    # Export to schema.org JSON-LD
    jsonld = to_jsonld_object(object_data, base_type="VisualArtwork")
    print("\nJSON-LD (schema.org):")
    print(jsonld)

    # Export to Dublin Core
    dc_elements = []
    for field_name in ["creators", "materials", "brief_description"]:
        if field_name in object_data:
            values = object_data[field_name]
            if not isinstance(values, list):
                values = [values]
            dc_elements.extend(to_dublin_core(field_name, values))

    print("\nDublin Core:")
    print(dc_elements)


if __name__ == "__main__":
    example_usage()
