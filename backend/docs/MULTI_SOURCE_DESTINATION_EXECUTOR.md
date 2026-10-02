# Multi-Source + Multi-Destination Executor Refactoring

**Date:** January 13, 2026

## Overview

Refactored the run executor to support multi-source + multi-destination as the **only** execution model. No legacy assumptions remain.

## Execution Rules

### 1. Run Initialization
- Load the route and all enabled `route_sources` (ordered by `ordering`)
- Load all enabled `route_destinations` (ordered by `ordering`)
- Create `run_source_steps` and `run_destination_steps` rows (handled by `create_run_steps()`)

### 2. Canonical Phase (Phase 1)
For each source in order:
- **Extract** → connector.extract()
- **Transform** → connector.normalize()
- **Upsert** → batch_upsert_entities()
  - Store raw payload in `entity_current.sources` keyed by `connector_instance_id`
  - Apply **deterministic merge**: later sources win for field conflicts (based on `ordering`)
  - Canonical `payload` field contains merged data
- **Track status** → update `run_source_steps` (running → success/failed)

Key implementation:
```python
# Earlier in execution
if source_connector_instance_id and raw_payload:
    entity.sources[str(source_connector_instance_id)] = {
        "raw_payload": raw_payload,
        "last_seen_at": extracted_at.isoformat(),
        "run_id": str(run_id),
    }
```

### 3. Publish Phase (Phase 2)
For each destination in order:
- **Publish records** → Only the change set for this run (created+updated entity keys)
- **Publish change log** → ChangeEvents from this run
- **Continue-on-failure** → If one destination fails, continue to next
- **Track status** → update `run_destination_steps` (running → success/failed)

Key implementation:
```python
# Continue-on-failure loop
for route_destination in route_destinations:
    try:
        target_connector.publish_records(entity_payloads)
        target_connector.publish_change_log(change_log)
        success_count += 1
    except Exception as dest_error:
        # Log and continue to next destination
        failed_count += 1
```

### 4. Final Run Status
- **success**: All destinations succeeded
- **warning**: Some destinations succeeded, some failed (partial)
- **failed_publish**: All destinations failed (canonical phase succeeded)
- **failed**: Canonical phase failed

## Database Schema

### entity_current.sources (JSONB)
```json
{
  "connector_instance_id_1": {
    "raw_payload": {...},
    "last_seen_at": "2026-01-13T10:00:00Z",
    "run_id": "uuid"
  },
  "connector_instance_id_2": {
    "raw_payload": {...},
    "last_seen_at": "2026-01-13T10:05:00Z",
    "run_id": "uuid"
  }
}
```

### run_source_steps
- `step_id` (PK)
- `run_id` (FK)
- `route_source_id` (FK)
- `status` (pending|running|success|failed|skipped)
- `counts` (JSONB: processed, created, updated, skipped)
- `error` (TEXT, nullable)
- `started_at`, `finished_at`, `created_at`, `updated_at`

### run_destination_steps
- `step_id` (PK)
- `run_id` (FK)
- `route_destination_id` (FK)
- `status` (pending|running|success|failed|skipped)
- `counts` (JSONB: records_published, changes_published)
- `error` (TEXT, nullable)
- `started_at`, `finished_at`, `created_at`, `updated_at`

## Code Changes

### Modified Files

#### app/services/pipeline.py
- **phase_extract_and_canonicalize()**: Already supports multi-source with deterministic merge
- **phase_publish_destinations()**: 
  - Refactored to loop through all enabled destinations
  - Added continue-on-failure logic
  - Track success/failed counts
  - Create/update `run_destination_steps` for each destination
  - Return `{success_count, failed_count, partial, sheet_url, published_at}`
- **execute_run()**:
  - Updated to handle partial status
  - Set run.status based on destination results:
    - All succeeded → "success"
    - Partial → "warning"
    - All failed → "failed_publish"

### New Files

#### tests/test_executor_multi_source_dest.py
Comprehensive test suite covering:
1. **test_two_sources_produce_combined_canonical()**: 
   - 2 sources with overlapping entity
   - Later source wins for conflicts (title field)
   - Both raw payloads stored in entity.sources
   - run_source_steps tracking verified
   
2. **test_two_destinations_one_fails_partial_status()**:
   - 1 source, 2 destinations
   - Destination 1 succeeds, Destination 2 fails
   - Run status = "warning" (partial)
   - run_destination_steps reflect individual statuses
   
3. **test_all_destinations_fail_run_failed_publish()**:
   - All destinations fail
   - Run status = "failed_publish"
   
4. **test_all_destinations_succeed_run_success()**:
   - All destinations succeed
   - Run status = "success"

## Migration Status

✅ **No migration needed** - Database schema already exists:
- `entity_current.sources` field: Added in previous migration
- `run_source_steps` table: Migration 20260113_1252
- `run_destination_steps` table: Migration 20260113_1252

## Testing

Run tests:
```bash
cd backend
source venv/bin/activate
pytest tests/test_executor_multi_source_dest.py -v
```

Expected output:
- ✅ test_two_sources_produce_combined_canonical
- ✅ test_two_destinations_one_fails_partial_status
- ✅ test_all_destinations_fail_run_failed_publish
- ✅ test_all_destinations_succeed_run_success

## Backward Compatibility

⚠️ **Breaking changes** (by design):
- No fallback to legacy `source_connector_instance_id`/`target_connector_instance_id`
- Routes **must** have `route_sources` and `route_destinations` records
- API responses already updated to return only `sources[]` and `destinations[]`

## Next Steps

1. ✅ Run full test suite to verify no regressions
2. ✅ Update API documentation to reflect multi-source/destination behavior
3. ✅ Add monitoring/alerting for partial run statuses
4. Future: Consider removing legacy columns from `integration_routes` table

## Example Use Cases

### Use Case 1: Museum with Multiple Collection Databases
- Route with 3 sources: Main CMS, Acquisitions DB, Research Archive
- Deterministic merge ensures latest data from each system
- Single canonical view in entity_current
- Publish to Google Sheets + Airtable

### Use Case 2: Redundant Publishing
- Route with 1 source, 3 destinations
- Publish to: Production Sheets, Backup Sheets, Archive
- Continue-on-failure ensures partial success if one destination fails
- Individual step status enables targeted retry

### Use Case 3: Data Federation
- Route with N sources from partner institutions
- Each source contributes unique entities or overlapping records
- Later sources (higher ordering) win conflicts
- All raw payloads preserved in entity.sources for provenance
