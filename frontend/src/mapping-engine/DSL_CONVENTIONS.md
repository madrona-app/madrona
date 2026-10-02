# Mapping DSL Conventions

**Version**: 1.0  
**Date**: January 14, 2026  
**Status**: Canonical Reference

This document defines the canonical conventions for the Madrona Mapping Engine DSL. **All implementations, examples, and AI-generated code MUST follow these conventions.**

---

## Overview

The Mapping DSL uses a declarative rule-based approach where:
- Rules execute **in order** (top to bottom)
- Each rule reads from source data and writes to output
- Later rules may **append** to arrays created by earlier rules
- Path syntax differs between **read** (source) and **write** (output) operations

---

## 1. Write Path Syntax (Output)

### Convention: Limited JSONPath-like Format

**All write paths** (fields being set in output) use a **limited JSONPath-like syntax** with `$.` prefix:

```typescript
// Correct ✓
"toPath": "$.label"
"toPath": "$.identifiers"
"toPath": "$.identifiers[0].value"
"toPath": "$.metadata.creator.name"
"toPath": "$.relationships[0].targetId"

// Incorrect ✗
"toPath": "label"              // Missing $. prefix
"toPath": "identifiers.value"  // Missing $. prefix
"toPath": "$identifiers"       // Missing dot after $
```

### Syntax Rules

1. **Root Prefix**: Always start with `$.`
2. **Dot Notation**: Use dots for object property access: `$.foo.bar.baz`
3. **Array Access**: Use brackets with numeric index: `$.items[0]`, `$.data[5].value`
4. **No Wildcards**: Write paths do NOT support wildcards (`*`) - must be specific
5. **No Complex Expressions**: Write paths are simple property paths only

### Valid Write Path Examples

```typescript
// Simple properties
"$.id"
"$.type"
"$.label"
"$.description"

// Nested objects
"$.metadata.source"
"$.metadata.creator.name"
"$.provenance.pipelineId"

// Array elements (specific index)
"$.identifiers[0]"
"$.identifiers[0].type"
"$.identifiers[0].value"
"$.classifications[0].type"
"$.relationships[0].targetId"

// Deep nesting
"$.extensions[0].data.conservation.condition"
"$.media[0].metadata.dimensions.width"
```

### Why Limited JSONPath?

- **Clarity**: Explicit about what is being written
- **Safety**: No ambiguity about write targets
- **Simplicity**: Easy to parse and validate
- **Append-friendly**: Later rules can append to `$.identifiers`, `$.relationships`, etc.

---

## 2. Read Selector Syntax (Source)

### Convention: Multiple Selector Types

**Source data selectors** support multiple formats for flexibility in reading from various source structures:

### 2.1 JSONPath Selector (Complex Queries)

Use for complex queries, wildcards, and filtering:

```typescript
{
  "jsonPath": "$.Measurements[*].Value"
}

{
  "jsonPath": "$.Artists[?(@.Role == 'creator')].Name"
}

{
  "jsonPath": "$..Title"  // Recursive search
}
```

**Capabilities**:
- Wildcards: `$.items[*]`
- Filters: `$[?(@.type == 'image')]`
- Recursive descent: `$..fieldName`
- Full JSONPath specification support

**Use when**: You need complex querying, filtering, or multiple values

### 2.2 Simple Path Selector (Dot Notation)

Use for straightforward property access:

```typescript
{
  "path": "ObjectID"
}

{
  "path": "Measurements.0.Value"
}

{
  "path": "Artist.Name"
}
```

**Capabilities**:
- Dot notation: `foo.bar.baz`
- Array indexing: `items.0`, `data.5.value`
- Simple and readable

**Use when**: You need simple property access without complex querying

### 2.3 Constant Selector (Literal Values)

Use for hard-coded values:

```typescript
{
  "const": "Object"
}

{
  "const": 42
}

{
  "const": true
}

{
  "const": null
}
```

**Capabilities**:
- Any JSON value type
- No source data lookup

**Use when**: You need a literal default or fixed value

### 2.4 Template Selector (String Interpolation)

Use for constructing strings from multiple source fields:

```typescript
{
  "template": "{Title} ({AccessionNumber})",
  "vars": {
    "Title": { "path": "ObjectTitle" },
    "AccessionNumber": { "path": "AccessionNumber" }
  }
}

{
  "template": "{firstName} {lastName}",
  "vars": {
    "firstName": { "path": "Artist.FirstName" },
    "lastName": { "path": "Artist.LastName" }
  }
}

{
  "template": "Created by {artist} in {year}",
  "vars": {
    "artist": { "jsonPath": "$.Artists[0].Name" },
    "year": { "path": "DateCreated" }
  }
}
```

**Capabilities**:
- String interpolation with `{varName}` placeholders
- Each var can use any selector type (path, jsonPath, const, template)
- Nested templates supported

**Use when**: You need to combine multiple fields into a single string

---

## 3. Selector Coalescing (Fallbacks)

### Convention: First-Found-Wins

Multiple selectors can be provided to try in order:

```typescript
{
  "id": "set_label",
  "type": "SetField",
  "from": { "path": "Title" },
  "coalesce": [
    { "path": "ObjectName" },
    { "path": "Label" },
    { "const": "Untitled" }
  ],
  "toPath": "$.label"
}
```

**Behavior**:
1. Try `from` selector first
2. If null/undefined, try each `coalesce` selector in order
3. Use first non-null result
4. If all fail, use `default` value (if provided)
5. If no default, field is not set

**Use when**: Source data has inconsistent field names or missing data

---

## 4. Rule Execution Order

### Convention: Sequential Execution with Append Semantics

**Rules execute in order from top to bottom.** This is critical for:

1. **Dependency**: Later rules can reference fields set by earlier rules
2. **Append**: Later rules can append to arrays created by earlier rules
3. **Override**: Later rules can override values set by earlier rules

### Example: Building Arrays Incrementally

```typescript
[
  // Rule 1: Create first identifier
  {
    "id": "id_accession",
    "type": "SetField",
    "from": { "path": "AccessionNumber" },
    "toPath": "$.identifiers[0]",
    "transform": "toIdentifier",
    "transformArgs": { "type": "accession" }
  },
  
  // Rule 2: Append second identifier
  {
    "id": "id_catalog",
    "type": "SetField",
    "from": { "path": "CatalogNumber" },
    "toPath": "$.identifiers[1]",  // Appends after [0]
    "transform": "toIdentifier",
    "transformArgs": { "type": "catalog" }
  },
  
  // Rule 3: Use MapArray to append multiple
  {
    "id": "id_other",
    "type": "MapArray",
    "fromMany": { "path": "OtherNumbers" },
    "toPath": "$.identifiers",  // Appends to existing array
    "itemTemplate": {
      "type": "other",
      "value": "{{item}}"
    }
  }
]
```

**Result**: All three rules contribute to `$.identifiers` array in order.

### Example: Relationship Building

```typescript
[
  // Rule 1: Add creator relationship
  {
    "id": "rel_creator",
    "type": "EmitRelationship",
    "relationshipType": "created_by",
    "targetFrom": { "path": "Artist.ID" }
  },
  
  // Rule 2: Add collection relationship
  {
    "id": "rel_collection",
    "type": "EmitRelationship",
    "relationshipType": "part_of",
    "targetFrom": { "path": "Collection.ID" }
  }
]
```

**Result**: Both relationships are added to output in order.

---

## 5. Array Handling

### Convention: Explicit Indexing vs Append

**Two patterns for array fields:**

### Pattern A: Explicit Indexing

Specify exact array position:

```typescript
{
  "toPath": "$.identifiers[0]",  // First position
  "toPath": "$.identifiers[1]",  // Second position
  "toPath": "$.identifiers[2]",  // Third position
}
```

**Use when**: You know the exact position and want deterministic ordering

### Pattern B: Array Append (MapArray)

Let the engine append items:

```typescript
{
  "type": "MapArray",
  "fromMany": { "path": "items" },
  "toPath": "$.identifiers",  // No index - appends all items
}
```

**Use when**: You want to map an entire array or add multiple items

### Mixed Pattern (Common)

Combine both approaches:

```typescript
[
  // Set known items at specific positions
  { "toPath": "$.identifiers[0]", "from": { "path": "AccessionNumber" } },
  { "toPath": "$.identifiers[1]", "from": { "path": "CatalogNumber" } },
  
  // Then append any additional items
  {
    "type": "MapArray",
    "fromMany": { "path": "OtherIdentifiers" },
    "toPath": "$.identifiers"  // Appends after [0] and [1]
  }
]
```

---

## 6. Reserved Paths

### Convention: Never Write to Meta/Provenance

**These paths are RESERVED and managed by the engine:**

```typescript
// Reserved - DO NOT write to these ✗
"$.meta"
"$.meta.createdAt"
"$.meta.updatedAt"
"$.meta.hash"
"$.provenance"
"$.provenance.sourceId"
"$.provenance.pipelineId"
"$.provenance.hash"
```

**Why**: The engine automatically populates these fields for consistency and integrity.

**Allowed paths** (user-controlled):
```typescript
// User fields - write freely ✓
"$.id"
"$.type"
"$.label"
"$.description"
"$.identifiers"
"$.classifications"
"$.properties"
"$.relationships"
"$.media"
"$.dates"
"$.extensions"
```

---

## 7. Rule Naming Conventions

### Convention: Descriptive IDs and Names

**Rule IDs** should be:
- Lowercase with underscores
- Descriptive of purpose
- Prefixed by type: `set_`, `map_`, `emit_`, `ext_`

```typescript
// Good ✓
"id": "set_label_from_title"
"id": "map_identifiers"
"id": "emit_creator_relationship"
"id": "ext_tms_metadata"
"id": "warn_missing_title"

// Bad ✗
"id": "rule1"
"id": "mapping"
"id": "test"
"id": "SetLabel"  // Use snake_case, not PascalCase
```

**Rule Names** should be:
- Human-readable sentences
- Start with verb
- Describe what the rule does

```typescript
// Good ✓
"name": "Set label from title with fallback"
"name": "Map array of identifiers"
"name": "Emit creator relationship"
"name": "Store TMS metadata in extension"
"name": "Warn if title is missing"

// Bad ✗
"name": "Label"
"name": "rule"
"name": "mapping"
```

---

## 8. Transform Functions

### Convention: Named Transforms with Args

Transforms should be:
- Registered with descriptive names
- Configurable via `transformArgs`
- Idempotent when possible

```typescript
{
  "transform": "toIdentifier",
  "transformArgs": { "type": "accession" }
}

{
  "transform": "parseDate",
  "transformArgs": { "format": "YYYY-MM-DD" }
}

{
  "transform": "normalizeString",
  "transformArgs": { "case": "upper", "trim": true }
}
```

**Common transforms**:
- `toIdentifier` - Convert to identifier object
- `toClassification` - Convert to classification object
- `parseDate` - Parse date string
- `normalizeString` - Normalize string (trim, case, etc.)
- `splitString` - Split delimited string to array
- `extractNumber` - Extract numeric value
- `coalesceEmpty` - Replace empty string with null

---

## 9. Extension Namespacing

### Convention: Reverse Domain Notation

Extension namespaces should use reverse domain notation:

```typescript
// Good ✓
"namespace": "org.madrona.tms"
"namespace": "org.madrona.csv"
"namespace": "org.madrona.google-drive"
"namespace": "com.company.system"

// Bad ✗
"namespace": "tms"           // Too generic
"namespace": "metadata"      // Too generic
"namespace": "custom"        // Too generic
```

Extension types should be descriptive:

```typescript
// Good ✓
"extensionType": "conservation_data"
"extensionType": "import_metadata"
"extensionType": "source_record"

// Bad ✗
"extensionType": "data"
"extensionType": "info"
```

---

## 10. Warning Messages

### Convention: Actionable Messages with Context

Warnings should:
- Be actionable (tell user what to fix)
- Include context (what field, what record)
- Use consistent severity levels

```typescript
// Good ✓
{
  "type": "EmitWarning",
  "whenMissing": ["Title"],
  "message": "Title is required for proper cataloging",
  "severity": "error"
}

{
  "type": "EmitWarning",
  "whenMissing": ["Artist.Name"],
  "message": "Creator name is missing - relationship may be incomplete",
  "severity": "warning"
}

// Bad ✗
{
  "message": "Missing field"  // Which field?
}

{
  "message": "Error"  // What error?
}
```

**Severity levels**:
- `"error"` - Critical issue, record may be invalid
- `"warning"` - Non-critical issue, record is usable
- `"info"` - Informational message, no action needed

---

## 11. Complete Rule Template

### Convention: Standard Rule Structure

Every rule should follow this structure:

```typescript
{
  // Required fields
  "id": "rule_id_snake_case",
  "name": "Human readable rule name",
  "type": "SetField|MapArray|EmitRelationship|EmitWarning|SetExtension",
  
  // Type-specific fields
  "from": { /* selector */ },      // SetField: source selector
  "toPath": "$.output.path",       // SetField, MapArray: output path
  "fromMany": { /* selector */ },  // MapArray: array source
  "itemTemplate": { /* object */ }, // MapArray: item transformation
  
  // Optional fields
  "enabled": true,                 // Default: true
  "coalesce": [/* selectors */],   // Fallback selectors
  "default": "value",              // Default if all selectors fail
  "transform": "functionName",     // Transform function
  "transformArgs": { /* args */ }, // Transform arguments
  
  // Documentation
  "description": "Detailed explanation of what this rule does"
}
```

---

## 12. AI Assistant Guidelines

**When generating mapping rules, ALWAYS:**

1. ✓ Use `$.` prefix for all write paths (`toPath`)
2. ✓ Provide multiple selector options (path, jsonPath, const, template)
3. ✓ Order rules intentionally (dependencies first, appends after)
4. ✓ Use descriptive rule IDs with prefixes (`set_`, `map_`, etc.)
5. ✓ Include `coalesce` for fields with inconsistent naming
6. ✓ Add `default` values for optional fields
7. ✓ Use proper namespacing for extensions
8. ✓ Write actionable warning messages
9. ✓ Document complex rules with `description` field
10. ✓ Never write to reserved paths (`$.meta`, `$.provenance`)

**When reviewing mapping rules, CHECK:**

1. ✓ All write paths have `$.` prefix
2. ✓ Rule execution order makes sense
3. ✓ Array append logic is correct
4. ✓ Selectors use appropriate type (path vs jsonPath)
5. ✓ Rule IDs are unique and descriptive
6. ✓ Extensions use proper namespacing
7. ✓ Warnings have severity levels
8. ✓ No writes to reserved paths

---

## Examples

See complete examples in:
- [`examples/tms_objects_to_canonical_object.json`](./examples/tms_objects_to_canonical_object.json)
- [`examples/csv_row_to_canonical_object.json`](./examples/csv_row_to_canonical_object.json)
- [`examples/canonical_object_to_destination_orangedam.json`](./examples/canonical_object_to_destination_orangedam.json)

---

## Reference

- [Mapping DSL Rule Types](./examples/README.md)
- [Developer Helpers](./HELPERS_README.md)
- [Implementation Guide](./README.md)

---

**Last Updated**: January 14, 2026  
**Maintainer**: Madrona Engineering Team
