# Connector Catalog

This document explains the connector system architecture and lists all available connectors in the Madrona platform.

## Architecture Overview

### Core Concepts

**Connectors** are Python classes that integrate external systems with Madrona's canonical data model:
- **Source Connectors**: Extract data from external systems (APIs, databases, files)
- **Target Connectors**: Publish canonical data to external systems (spreadsheets, APIs, warehouses)
- **Bidirectional Connectors**: Support both extraction and publishing (future)

**Connector Definitions** (`connector_definitions` table) define available connector types:
- **key**: Unique identifier (e.g., `"smithsonian-openaccess"`)
- **implementation_key**: Python import path (e.g., `"app.connectors.core.smithsonian_base:SmithsonianBaseConnector"`)
- **config_schema**: JSON Schema for validation (stored in database, NOT in code)
- **capabilities**: Features like `{"incremental": true, "full_refresh": true}`

**Connector Instances** (`connector_instances` table) are configured connectors for specific organizations:
- Links to a `connector_definition`
- Contains organization-specific `config` (API keys, URLs, etc.)
- Each instance can be used in multiple integration routes

### Implementation Key Format

**REQUIRED FORMAT:** `"package.module:ClassName"`

**Valid Examples:**
- `"app.connectors.core.smithsonian_base:SmithsonianBaseConnector"` (core connector)
- `"app.connectors.orgs.example_museum.smithsonian:SmithsonianConnector"` (org overlay)

**Invalid Examples (REJECTED):**
- Inline code: `"class MyConnector: ..."`
- Multi-line strings
- Code with `def`, `import`, `lambda`, `exec`, `eval`
- Anything that looks like executable Python code

**Security Policy (Prompt 7):**
> Connector code MUST NOT be stored in the database.
> All connectors must be deployed as Python modules through version control and code review.
> The system uses safe `importlib.import_module()` - never `exec()`, `eval()`, or `compile()`.
> This prevents arbitrary code execution vulnerabilities.

### Core vs Organization Overlay Structure

**Core Connectors** (`app.connectors.<name>`):
- Shared across all organizations
- General-purpose implementation
- Examples: `smithsonian`, `google_sheets`, `salesforce`

**Organization Overlays** (`app.connectors.orgs.<org_slug>.<name>`):
- Organization-specific customizations
- Override core connector behavior
- Enabled per-organization via settings

**Org Overlay Resolution:**
1. Check if `app.connectors.orgs.<org_slug>.<connector_key>:<ClassName>` exists
2. If yes and org overlay enabled → use org-specific version
3. If no or disabled → use core `app.connectors.<connector_key>:<ClassName>`

**Example:**
- Core: `app.connectors.core.smithsonian_base:SmithsonianBaseConnector`
- Example Museum Overlay: `app.connectors.orgs.example_museum.smithsonian:SmithsonianConnector`
- When Example Museum runs, org overlay loads `example_museum` version if it exists

### Adding a New Organization Connector Safely

**Option 1: Use Core Connector (Recommended)**
- Use existing core connector with org-specific config
- No code changes needed
- Just create a `connector_instance` with custom config

**Option 2: Create Organization Overlay**

1. **Create overlay module:**
   ```
   backend/app/connectors/orgs/<org_slug>/<connector_name>.py
   ```

2. **Implement connector class:**
   ```python
   from app.connectors.core.smithsonian_base import SmithsonianBaseConnector
   
   class SmithsonianConnector(SmithsonianBaseConnector):
       \"\"\"Example Museum-specific Smithsonian connector.\"\"\"
       
       def normalize(self, record: dict) -> dict:
           # Custom normalization logic
           canonical = super().normalize(record)
           canonical["custom_field"] = self._extract_custom(record)
           return canonical
   ```

3. **Deploy via version control:**
   - Commit to Git
   - Code review
   - Deploy to backend servers
   - Module becomes available at runtime

4. **Update connector_definition (optional):**
   ```sql
   UPDATE connector_definitions
   SET implementation_key = 'app.connectors.orgs.example_museum.smithsonian:SmithsonianConnector'
   WHERE key = 'smithsonian-openaccess';
   ```

5. **Or use overlay resolution:**
   - Keep core `implementation_key` in definition
   - Enable org overlay via settings: `CONNECTORS_USE_ORG_OVERLAY=true`
   - System auto-resolves to org version if it exists

**DO NOT:**
- ❌ Store Python code in database fields
- ❌ Use `exec()`, `eval()`, or dynamic code execution
- ❌ Put implementation logic in config or schema
- ❌ Create connectors without proper testing

## Source Connectors

Source connectors extract data from external systems and normalize it to Madrona's canonical format.

### Smithsonian Open Access (Production)

**Implementation:** `app.connectors.core.smithsonian_base:SmithsonianBaseConnector`  
**Direction:** Source (one-way)  
**Status:** ✅ Production-ready

Extracts cultural heritage objects from the Smithsonian Institution's Open Access API.

**Configuration:**
- `api_key` (required): Smithsonian API key
- `base_url` (optional): API endpoint (default: https://api.si.edu/openaccess/api/v1.0)
- `rows_per_page` (optional): Records per page, 1-1000 (default: 100)
- `query` (optional): Solr query filter (default: `*:*` for all records)

**Features:**
- Cursor-based pagination with `{"start": <offset>}` format
- Rate limiting with exponential backoff (3 retries for HTTP 429)
- Extracts: title, timestamps, thumbnails, full metadata
- Normalizes to: `smithsonian:<id>` entity keys

**Canonical Output:**
```json
{
  "entity_key": "smithsonian:<id>",
  "source_system": "smithsonian",
  "source_id": "<original_id>",
  "title": "<extracted_title>",
  "modified_at": "<timestamp>",
  "thumbnail_url": "<url_or_null>",
  "payload": { /* structured metadata */ },
  "raw": { /* complete original record */ }
}
```

### Stub Source (Testing Only)

**Implementation:** `app.connectors.stub:StubSourceConnector`  
**Direction:** Source (one-way)  
**Status:** 🧪 Testing/Development

Generates synthetic test data for development and testing.

**Configuration:**
- `api_key` (required): Any string value

**Features:**
- Generates sequential test records
- Supports cursor-based pagination
- Used in unit and integration tests

## Target Connectors

Target connectors receive canonical data and publish it to external systems.

### Google Sheets (Production)

**Implementation:** `app.connectors.google_sheets:GoogleSheetsTargetConnector`  
**Direction:** Target (one-way)  
**Status:** ✅ Production-ready

Publishes canonical entities and change events to Google Sheets spreadsheets.

**Configuration:**
- `service_account_json` (required): Google Cloud service account credentials as JSON string
- `spreadsheet_id` (required): Spreadsheet ID from URL (e.g., `1a2B3c4D5e6F7g8H9i0J`)
- `objects_tab_name` (optional): Tab name for objects (default: `Objects`)
- `changelog_tab_name` (optional): Tab name for changes (default: `Change_Log`)

**Features:**
- Service account authentication with gspread
- Automatic tab creation with headers
- Batch append operations for performance
- Objects tab: entity_key, source_system, title, thumbnail, timestamps
- Change_Log tab: change_id, entity_key, change_type, changed_fields, summary

**Tab Structure:**

*Objects Tab Columns:*
- entity_key, source_system, source_id, title, object_number
- modified_at, thumbnail_url, canonical_url, last_synced_at

*Change_Log Tab Columns:*
- change_id, entity_key, change_type, occurred_at
- changed_fields (comma-separated), summary, synced_at

### Stub Target (Testing Only)

**Implementation:** `app.connectors.stub:StubTargetConnector`  
**Direction:** Target (one-way)  
**Status:** 🧪 Testing/Development

Logs published data for testing without external dependencies.

**Configuration:**
- `output_path` (required): Path for test output

**Features:**
- Accepts `publish_objects()` for full entity data
- Accepts `publish_change_log()` for incremental changes
- Used in unit and integration tests

## Future: Bidirectional Connectors

Bidirectional connectors will support both extraction and publishing to enable two-way sync:

- **Salesforce** (bidirectional): Extract contacts/accounts, publish updates
- **Airtable** (bidirectional): Extract base records, publish changes
- **Custom APIs** (bidirectional): Configurable REST API connectors

Bidirectional connectors will implement both `BaseSourceConnector` and `BaseTargetConnector` interfaces.

## Adding New Connectors

To add a new connector:

1. **Implement** the connector class in `app/connectors/<name>.py`
   - Inherit from `BaseSourceConnector`, `BaseTargetConnector`, or both
   - Implement required methods: `validate_config()`, `extract()`, `normalize()`, and/or `publish_*()`
   - Add rate limiting and error handling

2. **Create seed data** in `seeds/<name>_connector_definition.py`
   - Define `connector_definition` with config schema
   - Specify capabilities and default config

3. **Write tests** in `tests/test_<name>.py`
   - Unit tests with mocked API calls
   - Integration tests with real API (optional, skipped by default)

4. **Update this catalog** with connector details

## Connector Architecture

All connectors follow these principles:

- **DB-driven configuration**: Schema stored in `connector_definitions.config_schema`
- **Validate-on-run**: Config validation happens at connector instantiation
- **Cursor-based pagination**: Cursors are JSON-serializable and opaque to callers
- **Canonical format**: All sources normalize to standard entity structure
- **Error handling**: Proper exceptions, logging, and retry logic
- **Type safety**: Full type hints and validated configs
