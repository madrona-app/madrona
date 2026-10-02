# Org Overlay Resolution for Connectors

## Overview

The org overlay resolution feature allows organizations to create custom implementations of connectors that take precedence over shared core implementations.

## How It Works

When enabled, the connector loader follows this resolution path:

1. **Try org-specific implementation first**:
   - Path: `app.connectors.orgs.<org_key>.<connector_type>:<ClassName>`
   - Example: `app.connectors.orgs.example_museum.smithsonian:SmithsonianConnector`

2. **Fall back to default implementation** (if org-specific not found):
   - Uses the `implementation_key` from `connector_definitions` table
   - Example: `app.connectors.core.smithsonian:SmithsonianConnector`

## Configuration

### Feature Flag

Enable org overlay resolution via environment variable:

```bash
CONNECTORS_USE_ORG_OVERLAY=true
```

**Default**: `false` (disabled)

**When disabled**: Always uses the default `implementation_key` from connector definitions.

### Organization Key Mapping

The system uses the organization's `slug` field as the org key:

- Database field: `organizations.slug`
- Normalized for filesystem: lowercase, hyphens converted to underscores
- Example: `"my-org-name"` → `"my_org_name"`

## Creating Org-Specific Connectors

### 1. Directory Structure

Create a package for your organization:

```
app/connectors/orgs/
├── __init__.py
└── <org_key>/
    ├── __init__.py
    ├── smithsonian.py
    └── google_sheets.py
```

### 2. Implement Connector

Inherit from the appropriate base class:

```python
# app/connectors/orgs/example_museum/smithsonian.py
from app.connectors.base import BaseSourceConnector

class SmithsonianBaseConnector(BaseSourceConnector):
    """Example Museum-specific Smithsonian connector."""
    
    direction = "source"
    
    def validate_config(self) -> None:
        # Custom validation for this org
        pass
    
    def fetch_records(self, cursor=None, limit=None):
        # Custom implementation
        pass
```

### 3. Class Name Must Match

The class name in your org-specific implementation **must match** the class name in the default `implementation_key`:

- Default: `app.connectors.core.smithsonian_base:SmithsonianBaseConnector`
- Org overlay: `app.connectors.orgs.example_museum.smithsonian:SmithsonianConnector`
- ✅ Class name: `SmithsonianBaseConnector` (same in both)

### 4. No Database Changes Required

The connector definition in the database stays the same:

```sql
SELECT key, implementation_key 
FROM connector_definitions 
WHERE key = 'smithsonian-openaccess';

-- key: smithsonian-openaccess
-- implementation_key: app.connectors.core.smithsonian_base:SmithsonianBaseConnector
```

The overlay resolution happens **at runtime** when loading the connector.

## Logging

The system logs which implementation path was chosen:

### Org-specific implementation found:
```
[INFO] ✓ Org overlay found for org='example_museum', connector='smithsonian-openaccess': 
       using app.connectors.orgs.example_museum.smithsonian:SmithsonianConnector
```

### No org-specific implementation (fallback to default):
```
[INFO] ○ No org overlay for org='example_museum', connector='airtable': 
       falling back to default app.connectors.core.airtable:AirtableConnector 
       (reason: Module not found...)
```

### Feature disabled:
```
[DEBUG] Org overlay resolution disabled, using default implementation: 
        app.connectors.core.smithsonian:SmithsonianConnector
```

## API Integration

When using `load_connector_from_db_record`, pass the org_slug to enable resolution:

```python
from app.connectors.loader import load_connector_from_db_record
from app.models import Organization, ConnectorInstance, ConnectorDefinition

# Fetch records from database
org = db.query(Organization).filter_by(organization_id=org_id).first()
instance = db.query(ConnectorInstance).filter_by(connector_instance_id=instance_id).first()
definition = db.query(ConnectorDefinition).filter_by(
    connector_definition_id=instance.connector_definition_id
).first()

# Load connector with org overlay support
connector = load_connector_from_db_record(
    connector_instance=instance.__dict__,
    connector_definition=definition.__dict__,
    organization_id=org.organization_id,
    org_slug=org.slug,  # ← Pass org slug for overlay resolution
    enable_org_overlay=True  # ← Optional: override feature flag
)
```

## Use Cases

### 1. Custom Business Logic

An organization needs special handling for data from a source:

```python
# app/connectors/orgs/art_museum/smithsonian.py
class SmithsonianBaseConnector(BaseSourceConnector):
    def fetch_records(self, cursor=None, limit=None):
        # Add museum-specific filtering
        records = super().fetch_records(cursor, limit)
        return filter_by_artwork_type(records, self.config.get('artwork_types'))
```

### 2. Custom Authentication

An organization has special API credentials or OAuth flow:

```python
# app/connectors/orgs/enterprise_client/salesforce.py
class SalesforceSourceConnector(BaseSourceConnector):
    def validate_config(self) -> None:
        # Use enterprise-specific OAuth endpoints
        pass
```

### 3. Data Transformation

An organization needs custom field mappings:

```python
# app/connectors/orgs/library/marc.py
class MARCSourceConnector(BaseSourceConnector):
    def normalize(self, record):
        # Library-specific MARC field mappings
        return custom_marc_to_canonical(record, self.organization_id)
```

## Testing

Tests are provided in `tests/test_connectors.py::TestOrgOverlayResolution`:

```bash
# Run org overlay tests
pytest tests/test_connectors.py::TestOrgOverlayResolution -v

# Test with feature enabled
CONNECTORS_USE_ORG_OVERLAY=true pytest tests/test_connectors.py -v
```

## Migration Strategy

### Enable for Specific Organizations

Start with feature disabled globally, enable per-organization in code:

```python
# When loading connector for specific orgs
enable_overlay = org.slug in ['example_museum', 'pilot_org']

connector = load_connector_from_db_record(
    instance, definition, org_id,
    org_slug=org.slug,
    enable_org_overlay=enable_overlay
)
```

### Gradual Rollout

1. **Phase 1**: Create org-specific implementations, feature disabled
2. **Phase 2**: Enable for pilot organizations, monitor logs
3. **Phase 3**: Enable globally via `CONNECTORS_USE_ORG_OVERLAY=true`

## Safety & Fallback

- ✅ **Safe by default**: Feature disabled unless explicitly enabled
- ✅ **Automatic fallback**: If org-specific implementation fails to load, uses default
- ✅ **No breaking changes**: Existing connector instances continue working
- ✅ **Logging**: All resolution decisions are logged for debugging
- ✅ **Testable**: Comprehensive test suite included

## Performance

- **LRU Cache**: Loaded connector classes are cached (256 entries)
- **Fast fallback**: Module import failure is caught immediately
- **No database changes**: Resolution happens in-memory at load time
