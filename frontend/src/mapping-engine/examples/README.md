# Mapping Engine Examples

This directory contains example mapping configurations demonstrating the full capabilities of the Madrona Mapping Engine v1.

> **📋 Important**: See [DSL_CONVENTIONS.md](../DSL_CONVENTIONS.md) for canonical conventions that MUST be followed when creating mappings.

## Available Examples

### 1. TMS to Canonical (`tms_objects_to_canonical_object.json`)

Maps **The Museum System (TMS)** object records to canonical `Object` entities.

**Demonstrates:**
- Multiple identifier types (accession numbers, catalog numbers)
- Complex classifications (object types, materials)
- Entity relationships (creators, collections)
- Date normalization
- Properties preservation (medium, dimensions, credit line)
- Domain-specific extensions (TMS metadata, conservation data)
- Comprehensive validation warnings

**Use Case:** Museum collections management systems exporting object data.

---

### 2. CSV to Canonical (`csv_row_to_canonical_object.json`)

Maps generic **CSV spreadsheet rows** to canonical `Object` entities.

**Demonstrates:**
- Flexible column name fallbacks
- Field coalescing for variant schemas
- Tag/keyword parsing from delimited strings
- Date parsing with multiple formats
- Simple relationship creation
- Validation for missing critical fields
- Data quality warnings (encoding issues, empty rows)

**Use Case:** Bulk imports from Excel/Google Sheets exports or legacy databases.

---

### 3. Canonical to Orange DAM (`canonical_object_to_destination_orangedam.json`)

Projects canonical `Object` entities to **Orange Logic DAM** API format.

**Demonstrates:**
- Canonical → destination projection (reverse mapping)
- Field renaming and restructuring
- Array transformations (classifications → keywords/categories)
- Custom field mapping
- Metadata preservation
- Relationship extraction
- Quality warnings for incomplete data

**Use Case:** Syncing canonical records to external DAM systems for asset management.

---

## Rule Types Reference

### SetField
Maps scalar fields from source to destination.

```json
{
  "id": "set_label",
  "type": "SetField",
  "toPath": "label",
  "from": "Title",
  "coalesce": ["ObjectName", "DisplayTitle"],
  "default": "Untitled",
  "transform": "trim"
}
```

### MapArray
Transforms array fields with templating.

```json
{
  "id": "map_identifiers",
  "type": "MapArray",
  "toPath": "identifiers",
  "fromMany": "AccessionNumbers",
  "itemTemplate": {
    "type": "accession",
    "value": "{{item}}",
    "system": "tms"
  }
}
```

### EmitRelationship
Creates entity relationships.

```json
{
  "id": "emit_creator",
  "type": "EmitRelationship",
  "relationshipType": "created_by",
  "targetFrom": "ArtistID",
  "roleFrom": "Role",
  "whenFrom": "DateCreated"
}
```

### EmitWarning
Validates data quality and emits warnings.

```json
{
  "id": "warn_missing_title",
  "type": "EmitWarning",
  "whenMissing": ["Title"],
  "message": "Object missing title field",
  "severity": "warning"
}
```

### SetExtension
Preserves domain-specific metadata.

```json
{
  "id": "set_tms_extension",
  "type": "SetExtension",
  "namespace": "org.tms",
  "extensionType": "provenance",
  "dataFrom": "TMSData"
}
```

---

## Field Selectors

### Path Notation
```json
"from": "fields.Title"              // Dot notation
"from": "rows[0].description"       // Array indexing
```

### JSONPath
```json
"from": "$.data.artwork.name"       // JSONPath expression
```

### Templates
```json
"from": "{{fields.Title}} ({{fields.Year}})"  // Template strings
```

### Coalescing
```json
"coalesce": ["Title", "ObjectName", "DisplayTitle"]  // Try in order
```

---

## Transform Functions

Common transforms referenced in examples:

- `trim` / `trimWhitespace` - Remove leading/trailing whitespace
- `normalizeDate` - Parse dates to ISO 8601
- `parseFlexibleDate` - Handle multiple date formats
- `slugify` - Convert to URL-safe slug
- `prefixWithObj` - Add ID prefix
- `removePrefix` - Strip ID prefix
- `mapToOrangeType` - Custom type mapping
- `formatISO8601` - Ensure ISO date format

---

## Validation Severities

Warnings can have three severity levels:

- `"error"` - Critical issues that should block ingestion
- `"warning"` - Issues that should be reviewed but don't block ingestion  
- `"info"` - Informational notices for data quality tracking

---

## Usage in Code

### Loading a Mapping

```typescript
import tmsMapping from './examples/tms_objects_to_canonical_object.json';
import { compileMappingDSL } from './mapping';

const compiled = compileMappingDSL(
  tmsMapping.mapping,
  tmsMapping.rules
);
```

### Applying a Mapping

```typescript
import { ingest } from './engine';

const result = await ingest({
  sourceRecord: myTMSRecord,
  mapping: tmsMapping.mapping,
  context: {
    pipelineId: 'route_tms_import',
    now: new Date().toISOString(),
  },
});

console.log('Canonical record:', result.canonicalRecord);
console.log('Mapping report:', result.mappingReport);
```

### Projection

```typescript
import { project } from './engine';
import orangeMapping from './examples/canonical_object_to_destination_orangedam.json';

const result = await project({
  canonicalRecord: myCanonicalRecord,
  mapping: orangeMapping.mapping,
  snapshotId: 'snap_001',
  mode: 'destination',
});

console.log('Orange DAM payload:', result.projectionPayload);
```

---

## Best Practices

1. **Always include warnings** for missing critical fields
2. **Use coalesce** for flexible source schemas
3. **Add defaults** for required canonical fields
4. **Document transforms** in mapping metadata
5. **Test with real data** samples (included in each example)
6. **Version mappings** explicitly (use semantic versioning)
7. **Preserve provenance** in extensions for auditability

---

## Extending Examples

To create your own mapping:

1. Copy an example that matches your use case
2. Update the `mapping.id` and `mapping.source`/`target`
3. Modify rules to match your source schema
4. Add validation warnings for your data quality requirements
5. Test with sample data in the `metadata.sampleSource` section
6. Document expected fields and usage notes

---

## Support

For questions about mapping configurations:
- Review the [Type Definitions](../types.ts)
- Check the [Compilation Tests](../compilation.test.ts)
- See the [Integration Tests](../fixtures.test.ts)

---

**Version:** 1.0.0  
**Last Updated:** January 14, 2026  
**Madrona Mapping Engine v1**
