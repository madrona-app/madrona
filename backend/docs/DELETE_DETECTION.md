# Delete Detection Feature

## Overview

Delete Detection automatically identifies records that have been removed from source systems and propagates those deletions to destination systems. This ensures data consistency across your integration pipelines.

## Detection Methods

### 1. Full Sync Comparison (`full_sync`)

Compares extracted entities against known records. Entities not seen during a full sync are considered deleted.

**How it works:**
1. During a full sync, the pipeline tracks all entity IDs seen in the source
2. After extraction completes, entities in the canonical store not seen are marked as deleted
3. Deletions are propagated to destinations based on the configured strategy

**Best for:**
- Batch data sources
- APIs without change tracking
- Periodic full data refreshes

### 2. Incremental Markers (`incremental`)

Processes explicit delete events from the source system using CDC (Change Data Capture) or webhooks.

**How it works:**
1. Source system emits delete markers/events
2. Pipeline processes these markers in real-time
3. Deletions are immediately applied based on configured strategy

**Best for:**
- Event-driven sources
- Databases with CDC enabled
- Webhook-based integrations

## Delete Strategies

### 1. Remove (`remove`)

Soft-deletes entities from the canonical store. They won't appear in queries or be published to destinations.

**Behavior:**
- Sets `sync_status = 'DELETED'` in canonical store
- Removes rows from destination systems (e.g., deletes rows from Google Sheets)
- Entities can be restored later

### 2. Mark (`mark`)

Flags entities as deleted but keeps them visible. Useful for review workflows before final removal.

**Behavior:**
- Sets `payload.meta.deletion_status = 'marked'`
- Sets `payload.meta.deletion_marked_at` timestamp
- In Google Sheets: Updates `sync_status` column to `DELETED`
- Entities remain visible for review

### 3. Archive (`archive`)

Moves deleted entities to an archive with full metadata. Supports restoration if needed later.

**Behavior:**
- Sets `payload.meta.deletion_status = 'archived'`
- Sets `payload.meta.deletion_archived_at` timestamp
- Preserves `payload.meta.deletion_original_status`
- In Google Sheets: Moves rows to `Archive_{type}` tabs with metadata columns

## Pipeline Configuration

### Enable Delete Detection

```python
# Via API
PUT /api/delete-detection/pipelines/{pipeline_id}/settings
{
    "delete_detection_enabled": true,
    "delete_detection_method": "full_sync",
    "delete_strategy": "remove"
}
```

### Pipeline Run with Delete Detection

When delete detection is enabled, the pipeline automatically:
1. Collects entity IDs during extraction
2. Compares against known entities after extraction
3. Creates `DeleteMarker` objects for missing entities
4. Applies the configured delete strategy

## API Endpoints

### Settings Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/delete-detection/pipelines/{id}/settings` | GET | Get pipeline delete settings |
| `/api/delete-detection/pipelines/{id}/settings` | PUT | Update pipeline delete settings |

### Archived Entities

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/delete-detection/archived` | GET | List archived entities |
| `/api/delete-detection/archived/restore` | POST | Restore archived entities |

### Marked Entities

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/delete-detection/marked` | GET | List marked-as-deleted entities |
| `/api/delete-detection/marked/clear` | POST | Clear deletion marks (restore to active) |

### Statistics

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/delete-detection/stats` | GET | Get delete detection statistics |

## Google Sheets Integration

### Remove Strategy

When a record is deleted with the `remove` strategy:
- Row is deleted from the Objects tab
- Entry is added to the Change_Log tab with action `DELETE`

### Mark Strategy

When a record is marked for deletion:
- `sync_status` column is updated to `DELETED`
- Row remains visible for review

### Archive Strategy

When a record is archived:
- Row is removed from the Objects tab
- Row is added to `Archive_{type}` tab (e.g., `Archive_object`)
- Archive includes metadata columns:
  - `archived_at`: Timestamp of archival
  - `original_sync_status`: Status before archival
  - `source_entity_key`: Original entity key for restoration

## Database Schema

### Pipeline Settings (JSON in `pipelines.config`)

```json
{
    "delete_detection_enabled": true,
    "delete_detection_method": "full_sync",
    "delete_strategy": "remove"
}
```

### Entity Metadata (JSON in `entities.payload.meta`)

For marked entities:
```json
{
    "meta": {
        "deletion_status": "marked",
        "deletion_marked_at": "2026-01-21T10:30:00Z"
    }
}
```

For archived entities:
```json
{
    "meta": {
        "deletion_status": "archived",
        "deletion_archived_at": "2026-01-21T10:30:00Z",
        "deletion_original_status": "active"
    }
}
```

## Service Classes

### DeleteDetector (Abstract Base)

```python
from app.services.delete_detection import (
    FullSyncDeleteDetector,
    IncrementalDeleteDetector,
    DeleteResult
)

# For full sync comparison
detector = FullSyncDeleteDetector(db_session, pipeline)
result: DeleteResult = detector.detect_deletions(seen_entity_ids)
```

### DeleteResult

```python
@dataclass
class DeleteResult:
    deleted_count: int
    markers: List[DeleteMarker]
    strategy_applied: str
```

### DeleteMarker

```python
@dataclass
class DeleteMarker:
    entity_id: str
    entity_type: str
    source: str  # "full_sync_comparison" or "incremental"
    detected_at: datetime
    metadata: Optional[Dict] = None
```

## Example: Full Pipeline with Delete Detection

```python
from app.services.delete_detection import (
    FullSyncDeleteDetector,
    apply_delete_strategy
)

# 1. Extract and collect seen IDs
seen_ids = set()
for record in source_connector.extract():
    seen_ids.add(record['id'])
    # ... process record

# 2. Detect deletions
detector = FullSyncDeleteDetector(db_session, pipeline)
result = detector.detect_deletions(seen_ids)

# 3. Strategy is applied automatically during detection
# But can also be applied manually:
if result.markers:
    apply_delete_strategy(
        db_session,
        result.markers,
        pipeline.config.get('delete_strategy', 'remove')
    )
```

## Frontend Components

### DeleteSettingsModal

React component for configuring delete detection settings on a pipeline.

```tsx
import DeleteSettingsModal from '../components/DeleteSettingsModal';

<DeleteSettingsModal
    isOpen={showDeleteSettings}
    onClose={() => setShowDeleteSettings(false)}
    pipelineId={pipeline.id}
/>
```

Features:
- Toggle to enable/disable delete detection
- Radio buttons for detection method selection
- Radio buttons for delete strategy selection
- Save with optimistic UI feedback

## Best Practices

1. **Start with Mark strategy** for new implementations to review deletions before applying
2. **Use Full Sync** for batch sources without change tracking
3. **Use Incremental** when your source supports CDC/webhooks
4. **Monitor archive size** and implement retention policies for long-running pipelines
5. **Test restoration** to ensure archived data can be recovered

## Troubleshooting

### Deletions not detected

1. Verify `delete_detection_enabled` is `true` in pipeline config
2. Check that the detection method matches your source type
3. For full sync: ensure complete extraction (no pagination issues)
4. For incremental: verify delete markers are being emitted by source

### Archived entities not appearing in destination

This is expected behavior. Archived entities are removed from active destination tables. Check the `Archive_*` tabs in Google Sheets.

### Restoration not working

1. Ensure entity still exists in database (not hard-deleted)
2. Check `payload.meta.deletion_status` is `'archived'`
3. Verify user has appropriate permissions

## Permissions

| Permission | Actions |
|------------|---------|
| `pipelines.view` | View delete settings |
| `pipelines.edit` | Modify delete settings |
| `data.manage` | Restore archived entities, clear marks |
