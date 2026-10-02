# Connector Architecture: Generic & Extensible

## Core Principle

**Madrona is infrastructure** - an aggregator and integrator. It is **connector-agnostic** and **generic by design**. Connector-specific credentials and configuration belong in the `connector_instances` table, NOT in application code or environment variables.

## What Goes Where

### ✅ Application-Level Environment Variables

**AI Services (Application-wide):**
```bash
# AI classification is a core platform feature
ANTHROPIC_API_KEY=         # Optional: Claude API for classification
OLLAMA_BASE_URL=           # Ollama endpoint
AI_PROVIDER_PREFERENCE=    # Which AI to prefer
```

**OAuth Client Credentials (Application-wide):**
```bash
# OAuth CLIENT credentials for the app's OAuth flow
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=
```

These are NOT connector credentials - they're the app's OAuth client identity used to initiate user authorization flows.

**Infrastructure:**
```bash
DATABASE_URL=
REDIS_URL=
SECRET_KEY=
```

### ✅ Connector Instance Configuration

**Per-Connector Credentials (in `connector_instances.config` JSON field):**

```json
// Smithsonian source connector
{
  "api_key": "customer-provided-smithsonian-key",
  "base_url": "https://api.si.edu/openaccess/api/v1.0",
  "rows_per_page": 100,
  "query": "online_media_type:Images"
}

// Google Sheets target connector
{
  "service_account_json": "{...customer service account...}",
  "spreadsheet_id": "1abc...",
  "objects_tab_name": "Objects",
  "changelog_tab_name": "Change_Log"
}

// Hypothetical Airtable connector
{
  "api_key": "customer-airtable-key",
  "base_id": "appXYZ123",
  "table_name": "Objects"
}
```

## Why This Matters

### 1. **Scalability**
- ✅ Support unlimited connector types without code changes
- ✅ Each organization can configure their own credentials
- ✅ Same connector definition, different credentials per tenant

### 2. **Security**
- ✅ Credentials stored encrypted in database per tenant
- ✅ No shared secrets across organizations
- ✅ Proper access control via organization_id

### 3. **Maintainability**
- ✅ Adding new connectors doesn't require env var changes
- ✅ No environment file bloat
- ✅ Configuration lives with the data it affects

### 4. **Multi-tenancy**
- ✅ Organization A's Smithsonian key ≠ Organization B's key
- ✅ Each tenant manages their own connector credentials
- ✅ No cross-tenant credential leakage

## Code Pattern

**❌ Bad (connector-specific globals):**
```python
# config.py
smithsonian_api_key: str = Field(..., alias="SMITHSONIAN_API_KEY")

# connector.py
def __init__(self):
    settings = get_settings()
    self.api_key = settings.smithsonian_api_key  # ❌ Global!
```

**✅ Good (connector instance config):**
```python
# connector.py
def __init__(self, config: dict):
    self.api_key = config.get("api_key")  # ✅ From connector instance
    if not self.api_key:
        raise ValueError("api_key required in connector config")
```

## Migration Notes

**Removed from environment variables:**
- ~~`GOOGLE_SHEETS_CREDENTIALS_JSON`~~ → `connector_instances.config.service_account_json`
- ~~`GOOGLE_SHEETS_DEMO_SPREADSHEET_ID`~~ → `connector_instances.config.spreadsheet_id`
- ~~`GOOGLE_WORKSPACE_DOMAIN`~~ → Connector-level feature, not app-wide
- ~~`GOOGLE_WORKSPACE_ADMIN_EMAIL`~~ → Connector-level feature, not app-wide
- ~~`SMITHSONIAN_API_KEY`~~ → `connector_instances.config.api_key`
- ~~`SMITHSONIAN_BASE_URL`~~ → `connector_instances.config.base_url`

**Retained (application-wide):**
- `GOOGLE_OAUTH_CLIENT_ID` - OAuth client credentials for the app
- `GOOGLE_OAUTH_CLIENT_SECRET` - OAuth client credentials for the app
- `USE_FAKE_SHEETS_PROVISIONER` - Dev/test mode flag

## Demo Mode Exception

For **local development convenience only**, the demo onboarding flow:
- Reads `google-drive-service-account.json` from the backend directory
- Uses `USE_FAKE_SHEETS_PROVISIONER` to bypass real API calls
- Stores credentials in connector instance config (not env vars)

This is a developer experience shortcut, not production architecture.

## Adding New Connectors

When building a new connector (e.g., Airtable, Salesforce, etc.):

1. **Define connector schema** in `connector_definitions` table
2. **Document required config fields** in connector code comments
3. **Validate config** in connector's `validate_config()` method
4. **Never read from global settings** - always use `self.config`

Example:
```python
class AirtableSourceConnector(BaseSourceConnector):
    """
    Configuration:
        api_key: Airtable Personal Access Token (required)
        base_id: Airtable base ID (required)
        table_name: Table name to sync (required)
    """
    
    def validate_config(self) -> None:
        required = ["api_key", "base_id", "table_name"]
        for field in required:
            if field not in self.config:
                raise ValueError(f"{field} required in connector config")
```

## Summary

**Infrastructure is generic. Connectors are pluggable. Credentials are per-tenant.**

This architecture ensures Madrona scales from 1 customer with 2 connectors to 1000 customers with 50 connector types each, without touching application code or environment configuration.
