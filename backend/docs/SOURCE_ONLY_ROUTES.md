# Source-Only Routes: Data Warehouse Ingestion

## Overview

Madrona now supports **source-only routes** that ingest data directly into the Madrona data warehouse without requiring a destination connector. This enables museums to use Madrona as a centralized data warehouse for all their collection data.

## Route Types

### 1. Data Warehouse Routes (Source-Only)
- **Target**: None (data stays in Madrona)
- **Purpose**: Centralized data storage and querying
- **Flow**: Source Connector → Madrona canonical store (entity_current)
- **Use Cases**:
  - Museum data warehouse
  - Multi-source data aggregation
  - Data exploration and analysis
  - Historical data preservation

### 2. Integration Routes (Source + Target)
- **Target**: External system (Google Sheets, etc.)
- **Purpose**: Data synchronization to external platforms
- **Flow**: Source Connector → Madrona canonical store → Target Connector
- **Use Cases**:
  - Publishing to Google Sheets
  - Syncing to external catalogs
  - Export to other museum systems

## Database Schema

The `integration_routes` table now allows `target_connector_instance_id` to be NULL:

```sql
-- Before: target was required
target_connector_instance_id UUID NOT NULL

-- After: target is optional
target_connector_instance_id UUID NULL
```

## API Changes

### Creating Routes

**Source-Only Route (Data Warehouse):**
```bash
POST /routes
{
  "organization_id": "org-uuid",
  "name": "Smithsonian → Madrona Warehouse",
  "source_connector_instance_id": "source-uuid"
  # target_connector_instance_id is omitted or null
}
```

**Integration Route (Source + Target):**
```bash
POST /routes
{
  "organization_id": "org-uuid",
  "name": "Smithsonian → Google Sheets",
  "source_connector_instance_id": "source-uuid",
  "target_connector_instance_id": "target-uuid"
}
```

### Response Format

Both route types return the same structure, with `target_connector_instance_id` being `null` for source-only routes:

```json
{
  "route_id": "route-uuid",
  "organization_id": "org-uuid",
  "name": "Smithsonian → Madrona Warehouse",
  "source_connector_instance_id": "source-uuid",
  "target_connector_instance_id": null,  // null for source-only
  "status": "active",
  "created_at": "2026-01-06T17:30:00Z"
}
```

## Pipeline Behavior

### Source-Only Routes
1. **Extract**: Pull data from source connector
2. **Normalize**: Convert to canonical format
3. **Store**: Upsert to `entity_current` table
4. **Complete**: Mark run as `completed`

No publishing phase occurs. Data remains in Madrona's canonical store.

### Integration Routes
1. **Extract**: Pull data from source connector
2. **Normalize**: Convert to canonical format
3. **Store**: Upsert to `entity_current` table
4. **Publish**: Push to target connector (Google Sheets, etc.)
5. **Complete**: Mark run as `completed`

## Frontend Changes

### Route Creation Form

The target connector field now shows:
- **Label**: "Target Connector Instance (optional - leave empty for data warehouse ingestion)"
- **Default Option**: "None (Madrona Warehouse)"

### Route List Display

Routes without a target display as:
```
Source Instance → Madrona Warehouse
```

Instead of showing a connector instance name, it displays "Madrona Warehouse" in italics.

## Republish Restrictions

Source-only routes **cannot be republished** because they have no publish phase to retry. Attempting to republish a source-only route will return:

```
PipelineError: Run {run_id} is from a source-only route (no target). 
Source-only routes don't have a publish phase to retry.
```

## Migration

The migration `20260106_1728_make_target_connector_instance_id_nullable.py` safely updates existing databases:

**Upgrade:**
```python
op.alter_column('integration_routes', 'target_connector_instance_id', nullable=True)
```

**Downgrade:**
```python
# Delete any source-only routes first
op.execute("DELETE FROM integration_routes WHERE target_connector_instance_id IS NULL")
# Make column non-nullable again
op.alter_column('integration_routes', 'target_connector_instance_id', nullable=False)
```

## Benefits

1. **Centralized Data Warehouse**: Museums can aggregate data from multiple sources into Madrona
2. **Flexible Architecture**: Choose per-route whether to keep data internal or sync externally
3. **Cost Savings**: Avoid external API costs for data you only need to query internally
4. **Data Preservation**: Historical snapshots stored in Madrona even without external targets
5. **Simplified Setup**: Don't need to configure target connectors for warehousing use cases

## Example Workflow

### Museum with Multiple Collections

```
1. Create source-only route: "Main Museum Collection → Madrona"
   - Ingests primary collection data
   - No target needed

2. Create source-only route: "Special Exhibitions → Madrona"
   - Ingests temporary exhibition data
   - No target needed

3. Create integration route: "Public Catalog → Google Sheets"
   - Filters entity_current for public records
   - Publishes to Sheets for public access

4. Query across all data in Madrona
   - Single SQL queries across main collection + exhibitions
   - No need for external tools
```

## Technical Details

### Model Changes

**IntegrationRoute (app/models.py):**
```python
target_connector_instance_id: Mapped[uuid.UUID | None] = mapped_column(
    UUID(as_uuid=True),
    ForeignKey("connector_instances.connector_instance_id"),
    nullable=True,  # Changed from False
)
```

### Pipeline Logic (app/services/pipeline.py)

```python
# Detect source-only routes
is_source_only = route.target_connector_instance_id is None

if is_source_only:
    logger.info("Executing source-only run: %s -> Madrona Warehouse")
    # Skip target connector instantiation
    # Skip publish phase
    # Complete after canonical store commit
else:
    logger.info("Executing integration run: %s -> %s")
    # Load target connector
    # Execute publish phase
    # Complete after successful publish
```

## Compatibility

- **Existing Routes**: All existing routes continue to work unchanged (they all have targets)
- **Existing Tests**: All tests pass (they create routes with targets)
- **API Backward Compatibility**: Old clients can still require target_connector_instance_id
- **New Clients**: Can omit target_connector_instance_id for source-only routes

## Future Enhancements

Possible future additions:
- Query API for entity_current data
- Export source-only data to various formats (CSV, JSON, Parquet)
- Source-only route scheduling without publish overhead
- Data retention policies for warehouse-only data
