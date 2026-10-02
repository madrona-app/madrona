**Madrona Mapping Engine v1 — Finalization API**

---

## Purpose

`finalizeCanonicalRecord()` enforces canonical schema invariants and fills system-managed fields at the end of the mapping pipeline. It validates required fields, fills provenance metadata, and constructs a complete, schema-compliant `CanonicalRecord`.

---

## API Signature

```typescript
function finalizeCanonicalRecord(
  canonicalDraft: Partial<CanonicalRecord>,
  sourceRecord: SourceRecord,
  mapping: Mapping,
  transformPipeline: any | undefined,
  context: EngineContext
): FinalizationResult

interface FinalizationResult {
  success: boolean;
  canonicalRecord?: CanonicalRecord;
  errors: string[];
}
```

---

## Parameters

### `canonicalDraft: Partial<CanonicalRecord>`

The draft canonical record produced by `applyMappingToCanonical()`. Must contain at minimum:
- `id` (string): Unique canonical identifier
- `type` (CanonicalRecordType): One of Object, Work, Agent, Place, Event, Media
- `label` (string): Human-readable name

Optional fields are preserved as-is: `description`, `properties`, `identifiers`, `classifications`, `relationships`, `dates`, `extensions`.

### `sourceRecord: SourceRecord`

The immutable source record snapshot containing:
- `id`: Snapshot identifier
- `source`: System descriptor (system, dataset, recordId)
- `raw`: Original source data payload
- `capturedAt`: Extraction timestamp
- `meta`: Schema version and hash

Used to fill provenance fields.

### `mapping: Mapping`

The mapping configuration that defined field transformations. Used to fill:
- `provenance.mappingId`

### `transformPipeline: any | undefined`

Optional transform pipeline that enriched the data. Used to fill:
- `provenance.transformId` (defaults to 'none' if not provided)

### `context: EngineContext`

Execution context containing:
- `pipelineId`: Pipeline route identifier
- `now`: Current timestamp (ISO 8601 string)

---

## Return Value

### Success Case (`success: true`)

```typescript
{
  success: true,
  canonicalRecord: CanonicalRecord,  // Complete, validated record
  errors: []
}
```

The `canonicalRecord` is fully populated with:
- All required fields validated
- Provenance filled from sourceRecord + mapping + context
- Meta filled with schemaVersion, createdAt, updatedAt
- Optional fields preserved from draft

### Failure Case (`success: false`)

```typescript
{
  success: false,
  canonicalRecord: undefined,
  errors: string[]  // List of invariant violations
}
```

Possible errors:
- `INVARIANT ERROR: Required field "id" is missing`
- `INVARIANT ERROR: Required field "type" is missing`
- `INVARIANT ERROR: Required field "label" is missing`
- `INVARIANT ERROR: Invalid type "XYZ". Valid types: Object, Work, Agent, Place, Event, Media`

---

## Validation Rules

### Required Fields

1. **id**: Must be present (string)
2. **type**: Must be present and one of the valid canonical types
3. **label**: Must be present (non-empty string)

### Type Validation

Valid `type` values:
- `Object`: Physical or digital objects (artworks, specimens, documents)
- `Work`: Creative or intellectual works (publications, compositions)
- `Agent`: People or organizations
- `Place`: Geographic locations
- `Event`: Temporal occurrences
- `Media`: Media assets (images, videos, audio)

Any other value will fail validation with a clear error message.

---

## System-Managed Fields

### Provenance

Automatically filled from inputs:

```typescript
provenance: {
  // Source descriptor (from sourceRecord.source)
  system: string,
  dataset?: string,
  recordId: string,
  
  // Traceability
  sourceRecordId: string,  // Same as recordId
  snapshotId: string,      // sourceRecord.id
  mappingId: string,       // mapping.id
  transformId: string,     // transformPipeline?.id || 'none'
  pipelineId?: string,        // context.pipelineId
  
  // Timestamp
  ingestedAt: string,      // context.now
  
  // Hash for determinism
  hash: string,            // Computed from snapshotId + mappingId + transformId
}
```

### Meta

Automatically filled with schema metadata:

```typescript
meta: {
  schemaVersion: '1.0.0',    // Current canonical schema version (hardcoded)
  createdAt: string,         // context.now
  updatedAt: string,         // context.now (same as createdAt on initial creation)
}
```

---

## Usage Examples

### Example 1: Basic Finalization

```typescript
import { finalizeCanonicalRecord } from './engine';

const draft: Partial<CanonicalRecord> = {
  id: 'obj_starry_night',
  type: 'Object',
  label: 'The Starry Night',
  description: 'A painting by Vincent van Gogh',
};

const result = finalizeCanonicalRecord(
  draft,
  sourceRecord,
  mapping,
  undefined,
  context
);

if (result.success) {
  console.log('✅ Record finalized:', result.canonicalRecord);
} else {
  console.error('❌ Validation errors:', result.errors);
}
```

### Example 2: With Transform Pipeline

```typescript
const transformPipeline = {
  id: 'transform_glam_v2',
  name: 'GLAM Transform v2',
};

const result = finalizeCanonicalRecord(
  draft,
  sourceRecord,
  mapping,
  transformPipeline,  // Will fill provenance.transformId
  context
);
```

### Example 3: Error Handling

```typescript
const incompleteDraft: Partial<CanonicalRecord> = {
  id: 'obj_test',
  // Missing type and label
};

const result = finalizeCanonicalRecord(
  incompleteDraft,
  sourceRecord,
  mapping,
  undefined,
  context
);

if (!result.success) {
  result.errors.forEach(error => {
    console.error(error);
    // INVARIANT ERROR: Required field "type" is missing
    // INVARIANT ERROR: Required field "label" is missing
  });
}
```

### Example 4: Type Validation

```typescript
const invalidDraft: Partial<CanonicalRecord> = {
  id: 'obj_test',
  type: 'InvalidType' as any,  // Not a valid canonical type
  label: 'Test Object',
};

const result = finalizeCanonicalRecord(
  invalidDraft,
  sourceRecord,
  mapping,
  undefined,
  context
);

// result.success === false
// result.errors[0] === "INVARIANT ERROR: Invalid type "InvalidType". Valid types: Object, Work, Agent, Place, Event, Media"
```

### Example 5: Full Pipeline

```typescript
// Step 1: Apply mapping rules
const { canonicalDraft } = applyMappingToCanonical(
  sourceRecord,
  compiledMapping,
  context
);

// Step 2: Finalize with invariant enforcement
const result = finalizeCanonicalRecord(
  canonicalDraft,
  sourceRecord,
  mapping,
  transformPipeline,
  context
);

if (result.success) {
  // Step 3: Persist to canonical store
  await canonicalStore.save(result.canonicalRecord);
}
```

---

## Design Rationale

### Why Separate Finalization?

1. **Clear Separation of Concerns**:
   - `applyMappingToCanonical()`: Executes mapping rules, transforms data
   - `finalizeCanonicalRecord()`: Validates invariants, fills system fields

2. **Explicit Validation Gate**:
   - Mapping phase can produce partial records
   - Finalization ensures only valid records pass through

3. **Testability**:
   - Each phase can be tested independently
   - Easy to test validation rules separately from mapping logic

4. **Composability**:
   - Can insert enrichment steps between mapping and finalization
   - Allows custom validation rules in future

### Why Fill Provenance Here?

Provenance is **system-managed**, not derived from source data. It captures:
- Where the data came from (source system, dataset, record)
- How it was transformed (mapping, transform pipeline, route)
- When it was ingested (timestamp)
- Reproducibility hash (for deterministic replay)

These fields are not known during rule execution and must be filled after all transformations complete.

### Why Validate Type?

The `type` field is critical for:
- Entity resolution (objects vs agents vs places)
- Schema validation (different types have different optional fields)
- Query optimization (type-specific indexes)
- UI rendering (type-specific components)

Invalid types would cause cascading failures, so we validate early.

---

## Performance Considerations

### Time Complexity

- **O(1)**: Required field checks (3 checks)
- **O(1)**: Type validation (set membership check)
- **O(n)**: Optional field preservation (linear in number of fields)
- **O(n)**: Hash computation (linear in hash input size)

Total: **O(n)** where n is the number of fields in the draft.

### Memory

- **O(n)**: Constructs new canonical record (copies all fields)
- Does not modify input draft (immutable pattern)

### Optimization Tips

1. **Batch Finalization**: If finalizing many records, reuse context object
2. **Skip Hash**: Hash is only needed for deterministic replay, can be skipped in some scenarios
3. **Lazy Provenance**: Could defer provenance filling until persistence if needed

---

## Common Patterns

### Pattern 1: Full Mapping Pipeline

```typescript
function ingestSourceRecord(
  sourceRecord: SourceRecord,
  mapping: Mapping,
  transformPipeline: any,
  context: EngineContext
): CanonicalRecord | null {
  // Step 1: Apply mapping
  const { canonicalDraft, reportDraft } = applyMappingToCanonical(
    sourceRecord,
    compileMappingDSL(mapping.dslRules),
    context
  );
  
  // Step 2: Finalize
  const result = finalizeCanonicalRecord(
    canonicalDraft,
    sourceRecord,
    mapping,
    transformPipeline,
    context
  );
  
  if (!result.success) {
    console.error('Finalization failed:', result.errors);
    return null;
  }
  
  return result.canonicalRecord;
}
```

### Pattern 2: Validation-Only Mode

```typescript
function validateDraft(draft: Partial<CanonicalRecord>): string[] {
  const mockSource: SourceRecord = {
    id: 'snap_mock',
    source: { system: 'mock', recordId: 'mock' },
    raw: {},
    capturedAt: new Date().toISOString(),
    meta: { schemaVersion: '1.0.0', hash: 'mock' },
  };
  
  const mockMapping = { id: 'map_mock' };
  const mockContext = { pipelineId: 'route_mock', now: new Date().toISOString() };
  
  const result = finalizeCanonicalRecord(
    draft,
    mockSource,
    mockMapping as any,
    undefined,
    mockContext
  );
  
  return result.errors;
}
```

### Pattern 3: Enrichment Before Finalization

```typescript
function ingestWithEnrichment(
  sourceRecord: SourceRecord,
  mapping: Mapping,
  context: EngineContext
): CanonicalRecord | null {
  // Step 1: Apply mapping
  const { canonicalDraft } = applyMappingToCanonical(
    sourceRecord,
    compiledMapping,
    context
  );
  
  // Step 2: Enrich with external data
  const enrichedDraft = await enrichWithWikidata(canonicalDraft);
  
  // Step 3: Finalize
  const result = finalizeCanonicalRecord(
    enrichedDraft,
    sourceRecord,
    mapping,
    undefined,
    context
  );
  
  return result.success ? result.canonicalRecord : null;
}
```

---

## Testing

See [finalize.demo.ts](./finalize.demo.ts) for comprehensive examples demonstrating:
- ✅ Successful finalization with all required fields
- ❌ Missing required field errors
- ❌ Invalid type errors
- ✅ Transform pipeline integration
- ✅ All valid canonical types

---

## Related Functions

- **applyMappingToCanonical()**: Produces the draft that gets finalized
- **compileMappingDSL()**: Compiles mapping rules before application
- **validateCanonicalRecordForAPI()**: Additional runtime validation (optional)

---

## Changelog

### v1.0.0 (2026-01-14)
- Initial implementation
- Validates id, type, label
- Fills provenance and meta
- Type validation against canonical union
- Hash computation for determinism
