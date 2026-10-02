# Semantic Role Tagging for Descriptive Fields

Lightweight semantic hints for field values without enforcing ontologies.

## Design Principles

1. **Roles are HINTS, not schema constraints** - They inform export mapping but don't constrain input
2. **No CIDOC CRM** - No ontology classes or properties
3. **All roles are optional** - Fields work perfectly without them
4. **Non-breaking** - Existing data continues to work unchanged
5. **Gradual adoption** - Add roles incrementally as needed

## Quick Start

### Basic Usage

```python
# Field values can optionally include role hints
creator = {
    "value": "Claude Monet",
    "role": "creator",                    # Optional semantic hint
    "role_qualifier": "artist",           # Optional sub-role
    "authorities": [                      # Optional authority links
        {"uri": "http://vocab.getty.edu/ulan/500019484", "source": "ULAN"}
    ]
}

# Or just use a simple string (no role)
creator = "Claude Monet"  # Still works!
```

### Role-Tagged Value Format

```python
{
    "value": "Claude Monet",           # Required: the actual value
    "role": "creator",                 # Optional: semantic role hint
    "role_qualifier": "artist",        # Optional: role sub-category
    "display_value": "Monet, Claude",  # Optional: formatted display
    "authorities": [...],              # Optional: authority links
    "note": "Signed lower right",      # Optional: additional note
    "certainty": "certain",            # Optional: certainty indicator
    "language": "en"                   # Optional: language code
}
```

## Available Roles

### Identification
- `title` - Primary name/title
- `alternate_title` - Alternative names
- `identifier` - Accession number, catalog number

### Agents
- `creator` - Maker, artist, author
- `contributor` - Secondary contributor
- `publisher` - Publishing entity
- `owner` - Current or former owner
- `donor` - Gift source
- `commissioner` - Who commissioned the work

### Description
- `description` - General description
- `physical_description` - Physical characteristics
- `inscription` - Text on object
- `mark` - Maker's mark, stamp

### Subject/Content
- `subject` - What the work depicts/is about
- `genre` - Artistic genre
- `style` - Artistic style/movement
- `iconography` - Iconographic subject

### Classification
- `type` - Object type/work type
- `classification` - Classification term
- `category` - Categorical grouping
- `medium` - Artistic medium

### Materials & Techniques
- `material` - Physical material
- `technique` - Production technique
- `support` - Support material

### Temporal
- `date_created` - Creation date
- `date_published` - Publication date
- `period` - Historical period

### Spatial
- `place` - General place reference
- `place_created` - Where created
- `place_depicted` - Place shown in work
- `current_location` - Where currently held

## Role Qualifiers

Qualifiers provide sub-categorization:

| Role | Example Qualifiers |
|------|-------------------|
| `creator` | artist, maker, attributed_to, workshop_of, circle_of |
| `title` | preferred, descriptive, former, translated |
| `material` | primary, secondary, support, medium |
| `date_created` | exact, circa, before, after, between |
| `inscription` | signature, date, dedication, label |

## Field Configuration

Each field has a default configuration:

```python
{
    "field_name": "creators",
    "default_role": "creator",
    "suggested_qualifiers": ["artist", "attributed_to"],
    "supports_authorities": True,
    "suggested_authority_sources": ["ULAN", "VIAF", "Wikidata"],
    "export_mappings": {
        "iiif": {"label": "Creator"},
        "schema_org": {"property": "creator", "type": "Person"},
        "dc": {"element": "creator"}
    }
}
```

## Export Examples

### IIIF Metadata

```python
from app.schemas import to_iiif_metadata

creators = [
    {"value": "Claude Monet", "role": "creator",
     "authorities": [{"uri": "http://vocab.getty.edu/ulan/500019484", "source": "ULAN"}]}
]

iiif_metadata = to_iiif_metadata("creators", creators)
# Output:
# [
#     {
#         "label": {"en": ["Creator"]},
#         "value": {"en": ["Claude Monet"]},
#         "seeAlso": [
#             {"id": "http://vocab.getty.edu/ulan/500019484", "type": "Dataset"}
#         ]
#     }
# ]
```

### JSON-LD (schema.org)

```python
from app.schemas import to_jsonld_object

object_data = {
    "creators": [{"value": "Claude Monet", "role": "creator", ...}],
    "materials": [{"value": "Oil paint", "role": "material", ...}],
    "brief_description": "A beautiful water lily painting."
}

jsonld = to_jsonld_object(object_data, base_type="VisualArtwork")
# Output:
# {
#     "@context": "https://schema.org/",
#     "@type": "VisualArtwork",
#     "creator": {
#         "@type": "Person",
#         "name": "Claude Monet",
#         "sameAs": "http://vocab.getty.edu/ulan/500019484"
#     },
#     "material": ["Oil paint"],
#     "description": "A beautiful water lily painting."
# }
```

### Dublin Core

```python
from app.schemas import to_dublin_core

dc_elements = to_dublin_core("creators", creators)
# Output:
# [{"element": "creator", "value": "Claude Monet"}]
```

## Validation

Validation is **soft** - it produces warnings but never rejects data:

```python
from app.schemas import validate_value_roles

result = validate_value_roles(
    {"value": "Monet", "role": "creattor"},  # Typo in role
    field_name="creators"
)

print(result.valid)      # True (always!)
print(result.warnings)   # ["Unknown role 'creattor' (suggestion: creator)"]
```

## Normalization

Convert various formats to consistent structure:

```python
from app.schemas import normalize_value_with_role

# Legacy format
legacy = {"name": "Claude Monet", "ulan_id": "500019484"}

# Normalized
normalized = normalize_value_with_role(legacy, "creators")
# Output:
# RoleTaggedValue(
#     value="Claude Monet",
#     role="creator",  # Applied from field default
#     ...
# )
```

## Migration Path

### Existing Data (No Roles)
```python
# This continues to work exactly as before
creators = ["Claude Monet", "Pierre-Auguste Renoir"]
```

### Gradual Adoption
```python
# Add roles to some values, not others
creators = [
    {"value": "Claude Monet", "role": "creator"},  # With role
    "Pierre-Auguste Renoir"                         # Without role
]
```

### Full Role Tagging
```python
# Complete role information
creators = [
    {
        "value": "Claude Monet",
        "role": "creator",
        "role_qualifier": "artist",
        "authorities": [{"uri": "...", "source": "ULAN"}]
    }
]
```

## Files

| File | Purpose |
|------|---------|
| `semantic_roles.py` | Role definitions and core schemas |
| `semantic_role_validation.py` | Soft validation utilities |
| `semantic_role_exports.py` | IIIF, JSON-LD, DC export utilities |

## Integration with LOD Infrastructure

Semantic roles enable:

1. **IIIF Manifests** - Correct metadata labels and seeAlso links
2. **JSON-LD Export** - Appropriate schema.org property mapping
3. **Authority Links** - Understanding which authority sources apply
4. **Search Facets** - Grouping values by semantic meaning

They do NOT:
- Enforce ontological constraints
- Require CIDOC CRM knowledge
- Break existing workflows
- Add mandatory fields
