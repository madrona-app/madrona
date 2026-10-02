# CanonicalRecord Builder Utilities

Safe utilities for writing values into `CanonicalRecord` structures.

## Overview

The builder utilities provide a safe, validated way to construct and modify canonical records. They enforce Madrona's design principles by preventing accidental overwrites of system-managed fields and ensuring data integrity.

## Safety Rules

1. **Never allow writes outside the CanonicalRecord envelope** - All paths must be valid canonical fields
2. **Disallow overwriting reserved top-level keys** - System fields (`id`, `type`, `label`, `provenance`, `meta`) are protected
3. **Prevent extensions from overwriting canonical keys** - Extensions must use `appendPath()` instead of `setPath()`

## Reserved Keys

The following top-level keys are reserved and cannot be modified by mapping rules:

- `id` - System-generated identifier
- `type` - Record type (Object, Person, Event, etc.)
- `label` - Primary display label
- `provenance` - Source system tracking
- `meta` - System metadata (schemaVersion, timestamps)

System-managed meta fields are also protected:
- `meta.schemaVersion`
- `meta.createdAt`
- `meta.updatedAt`

## API Reference

### `setPath(obj, path, value, options?)`

Set a value at a path in a CanonicalRecord.

**Parameters:**
- `obj` - Partial canonical record to modify
- `path` - Path to set (dot notation, supports `$.` prefix)
- `value` - Value to set at path
- `options.force` - Allow writes to reserved keys (default: `false`)

**Supported Path Notation:**
- Dot notation: `"properties.medium"`
- Nested objects: `"dates.created"`
- Array indexing: `"identifiers[0].value"` (for existing arrays)

**Does NOT support:**
- JSONPath expressions (`$.path`)
- Complex expressions

**Example:**
```typescript
import { setPath } from './mapping-engine';

const record: Partial<CanonicalRecord> = {};

// Set simple field
setPath(record, 'description', 'A beautiful painting');

// Set nested field
setPath(record, 'properties.medium', 'Oil on canvas');

// Set deeply nested field
setPath(record, 'properties.dimensions.height', 100);

// Update array element
setPath(record, 'identifiers[0].value', 'updated-123');

// Allow overwriting with force flag
setPath(record, 'id', 'obj_123', { force: true });
```

**Throws:**
- `CanonicalBuilderError` if path is reserved (without `force: true`)
- `CanonicalBuilderError` if path is invalid or empty
- `CanonicalBuilderError` if array index is out of bounds

---

### `appendPath(obj, path, item)`

Append an item to an array at a path in a CanonicalRecord.

Creates the array if it doesn't exist. If the path exists but is not an array, throws an error.

**Parameters:**
- `obj` - Partial canonical record to modify
- `path` - Path to array (dot notation, supports `$.` prefix)
- `item` - Item to append

**Example:**
```typescript
import { appendPath } from './mapping-engine';

const record: Partial<CanonicalRecord> = {};

// Append to array (creates if missing)
appendPath(record, 'identifiers', { scheme: 'acc', value: '2024.001' });
appendPath(record, 'identifiers', { scheme: 'uri', value: 'https://example.org/1' });

// Append to nested array
appendPath(record, 'properties.keywords', 'landscape');
appendPath(record, 'properties.keywords', 'impressionism');

console.log(record);
// {
//   identifiers: [
//     { scheme: 'acc', value: '2024.001' },
//     { scheme: 'uri', value: 'https://example.org/1' }
//   ],
//   properties: {
//     keywords: ['landscape', 'impressionism']
//   }
// }
```

**Throws:**
- `CanonicalBuilderError` if path is reserved
- `CanonicalBuilderError` if path exists but is not an array
- `CanonicalBuilderError` if array index notation is used

---

### `ensureArray(obj, path)`

Ensure a path points to an array in a CanonicalRecord.

Creates an empty array if the path doesn't exist. Throws error if path exists but is not an array.

**Parameters:**
- `obj` - Partial canonical record to modify
- `path` - Path to ensure is an array (dot notation, supports `$.` prefix)

**Returns:** The array at the path

**Example:**
```typescript
import { ensureArray } from './mapping-engine';

const record: Partial<CanonicalRecord> = {};

// Ensure array exists
const ids = ensureArray(record, 'identifiers');
console.log(ids); // []

// Idempotent - doesn't change existing arrays
record.identifiers = [{ scheme: 'acc', value: '123' }];
ensureArray(record, 'identifiers');
console.log(record.identifiers); // [{ scheme: 'acc', value: '123' }]
```

**Throws:**
- `CanonicalBuilderError` if path is reserved
- `CanonicalBuilderError` if path exists but is not an array

---

### `isReservedPath(path)`

Check if a path is reserved.

Useful for pre-validation before attempting writes.

**Parameters:**
- `path` - Path to check

**Returns:** `true` if path is reserved

**Example:**
```typescript
import { isReservedPath } from './mapping-engine';

isReservedPath('id');           // true
isReservedPath('provenance');   // true
isReservedPath('description');  // false
isReservedPath('properties.medium'); // false
```

---

### `getReservedKeys()`

Get list of reserved top-level keys.

**Returns:** Array of reserved key names

**Example:**
```typescript
import { getReservedKeys } from './mapping-engine';

const reserved = getReservedKeys();
console.log(reserved); // ['id', 'type', 'label', 'provenance', 'meta']
```

---

### `safeMerge(target, source, options?)`

Safely merge properties into a CanonicalRecord.

Only merges non-reserved fields. Reserved fields are skipped with warnings.

**Parameters:**
- `target` - Target canonical record
- `source` - Source object with properties to merge
- `options.force` - Allow merging reserved fields (default: `false`)

**Returns:** Array of warnings for skipped fields

**Example:**
```typescript
import { safeMerge } from './mapping-engine';

const record: Partial<CanonicalRecord> = {};
const data = {
  description: 'A painting',
  properties: { medium: 'Oil' },
  id: 'obj_123', // Reserved - will be skipped
};

const warnings = safeMerge(record, data);
console.log(warnings); // ['Skipped reserved field: id']

console.log(record);
// {
//   description: 'A painting',
//   properties: { medium: 'Oil' }
// }
```

---

## Error Handling

All builder utilities throw `CanonicalBuilderError` for validation failures.

```typescript
import { CanonicalBuilderError } from './mapping-engine';

try {
  setPath(record, 'id', 'obj_123');
} catch (error) {
  if (error instanceof CanonicalBuilderError) {
    console.log(error.path);    // 'id'
    console.log(error.reason);  // 'Cannot modify reserved top-level key...'
    console.log(error.message); // 'Reserved key: Cannot modify reserved top-level key...'
  }
}
```

## Integration with Mapping DSL

The builder utilities are designed to be used within mapping rules:

```typescript
import { compileMappingDSL, setPath, appendPath, ensureArray } from './mapping-engine';

const mapping: MappingDSLRule[] = [
  {
    ruleType: 'SetField',
    targetField: 'description',
    sourceSelector: { type: 'path', path: 'title' },
  },
  {
    ruleType: 'MapArray',
    sourceSelector: { type: 'path', path: 'creators' },
    targetField: 'relationships',
    itemRules: [
      {
        ruleType: 'EmitRelationship',
        relationshipType: 'created_by',
        targetSelector: { type: 'template', template: 'person_{{item.id}}' },
      },
    ],
  },
];

// Compile mapping
const compiled = compileMappingDSL(mapping);

// Execute mapping
const source = {
  title: 'Starry Night',
  creators: [
    { id: '123', name: 'Van Gogh' }
  ],
};

const result = compiled.apply(source);

// Manually add additional fields using builder utilities
setPath(result, 'properties.period', 'Post-Impressionism');
appendPath(result, 'identifiers', { scheme: 'acc', value: '1962.116' });
ensureArray(result, 'classifications');
```

## Best Practices

### 1. Use `appendPath()` for arrays, not `setPath()`

```typescript
// ✅ Good
appendPath(record, 'identifiers', { scheme: 'acc', value: '123' });

// ✗ Bad - overwrites existing array
setPath(record, 'identifiers', [{ scheme: 'acc', value: '123' }]);
```

### 2. Use `ensureArray()` before conditionally appending

```typescript
// ✅ Good - idempotent
ensureArray(record, 'classifications');
if (hasClassification) {
  appendPath(record, 'classifications', classification);
}

// ✗ Bad - might fail if array doesn't exist
if (hasClassification) {
  appendPath(record, 'classifications', classification);
}
```

### 3. Check `isReservedPath()` for dynamic paths

```typescript
// ✅ Good - pre-validate
const userPath = getUserInput();
if (!isReservedPath(userPath)) {
  setPath(record, userPath, value);
} else {
  console.warn(`Cannot set reserved path: ${userPath}`);
}

// ✗ Bad - catch after the fact
try {
  setPath(record, getUserInput(), value);
} catch (error) {
  // Error handling after validation
}
```

### 4. Use `safeMerge()` for bulk updates

```typescript
// ✅ Good - safe bulk merge with warnings
const warnings = safeMerge(record, userData);
warnings.forEach(w => console.warn(w));

// ✗ Bad - manual field-by-field with no protection
Object.assign(record, userData); // Might overwrite reserved fields!
```

### 5. Always handle `CanonicalBuilderError`

```typescript
// ✅ Good - explicit error handling
try {
  setPath(record, dynamicPath, value);
} catch (error) {
  if (error instanceof CanonicalBuilderError) {
    logger.warn(`Failed to set ${error.path}: ${error.reason}`);
    // Continue with alternative strategy
  }
}

// ✗ Bad - let errors propagate without context
setPath(record, dynamicPath, value); // Might crash entire mapping
```

## Testing

All builder utilities have comprehensive test coverage (41 tests).

Run tests:
```bash
npm test -- builder.test.ts
```

See [builder.test.ts](./builder.test.ts) for usage examples.

## See Also

- [Canonical Schema Documentation](../types/canonical.ts)
- [Mapping DSL Rules](./types.ts)
- [Mapping Compilation](./mapping.ts)
- [Source Selectors](./selectors.ts)
