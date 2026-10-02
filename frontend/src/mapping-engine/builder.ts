/**
 * Madrona Mapping Engine v1 — CanonicalRecord Builder Utilities
 * 
 * Safe utilities for writing values into CanonicalRecord structures.
 * 
 * SAFETY RULES:
 * 1. Never allow writes outside the CanonicalRecord envelope
 * 2. Disallow overwriting reserved top-level keys (id, type, label, provenance, meta)
 * 3. Prevent extensions from overwriting canonical keys
 * 4. Validate paths before modification
 * 
 * @example
 * ```typescript
 * const record: Partial<CanonicalRecord> = {};
 * 
 * // Safe writes
 * setPath(record, 'properties.medium', 'Oil on canvas');  // ✓
 * setPath(record, 'dates.created', '1889-06-01');         // ✓
 * appendPath(record, 'identifiers', { type: 'acc', value: '123' }); // ✓
 * 
 * // Protected writes (throw errors)
 * setPath(record, 'id', 'obj_123');           // ✗ Reserved key
 * setPath(record, 'provenance', {});          // ✗ Reserved key
 * setPath(record, 'meta.schemaVersion', '2'); // ✗ System-managed
 * ```
 */

import type { CanonicalRecord } from '../types/canonical';

/**
 * Reserved top-level keys that cannot be overwritten by mapping rules.
 * 
 * These fields are system-managed and should only be set by
 * the ingestion engine, not by user-defined mapping rules.
 */
const RESERVED_TOP_LEVEL_KEYS = new Set([
  'id',
  'type',
  'label',
  'provenance',
  'meta',
]);

/**
 * System-managed meta fields that cannot be modified.
 * 
 * These are set by the engine and should never be overwritten.
 */
const RESERVED_META_KEYS = new Set([
  'meta.schemaVersion',
  'meta.createdAt',
  'meta.updatedAt',
]);

/**
 * Error thrown when attempting unsafe writes to CanonicalRecord.
 */
export class CanonicalBuilderError extends Error {
  public readonly path: string;
  public readonly reason: string;
  
  constructor(
    message: string,
    path: string,
    reason: string
  ) {
    super(`${message}: ${reason}`);
    this.name = 'CanonicalBuilderError';
    this.path = path;
    this.reason = reason;
  }
}

/**
 * Set a value at a path in a CanonicalRecord.
 * 
 * Safely writes values with validation to prevent overwriting
 * reserved fields or system-managed data.
 * 
 * Supports simple path notation:
 * - Dot notation: "properties.medium"
 * - Nested objects: "dates.created"
 * - Array indexing: "identifiers[0].value"
 * 
 * Does NOT support:
 * - JSONPath expressions ($.path)
 * - Complex expressions
 * 
 * @param obj - Partial canonical record to modify
 * @param path - Path to set (dot notation)
 * @param value - Value to set at path
 * @param options - Write options
 * @throws {CanonicalBuilderError} If path is reserved or invalid
 * 
 * @example
 * ```typescript
 * const record: Partial<CanonicalRecord> = {};
 * 
 * // Set simple field
 * setPath(record, 'description', 'A beautiful painting');
 * 
 * // Set nested field
 * setPath(record, 'properties.medium', 'Oil on canvas');
 * 
 * // Set array element
 * setPath(record, 'alternativeLabels[0]', 'Starry Night');
 * 
 * // Allow overwriting with force flag
 * setPath(record, 'id', 'obj_123', { force: true });
 * ```
 */
export function setPath(
  obj: Partial<CanonicalRecord>,
  path: string,
  value: unknown,
  options: { force?: boolean } = {}
): void {
  // Normalize path (remove leading $. if present)
  const normalizedPath = path.startsWith('$.') ? path.slice(2) : path;

  // Validate path safety
  validatePathSafety(normalizedPath, options.force);

  // Parse path into segments
  const segments = parsePath(normalizedPath);

  if (segments.length === 0) {
    throw new CanonicalBuilderError(
      'Invalid path',
      path,
      'Path cannot be empty'
    );
  }

  // Navigate to parent and set value
  let current: Record<string, unknown> = obj as Record<string, unknown>;
  
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    
    if (segment.type === 'property') {
      if (!(segment.key in current)) {
        current[segment.key] = {};
      }
      current = current[segment.key] as Record<string, unknown>;
    } else if (segment.type === 'index') {
      if (!Array.isArray(current)) {
        throw new CanonicalBuilderError(
          'Invalid path',
          path,
          `Expected array at ${segments.slice(0, i + 1).map(s => s.type === 'property' ? s.key : `[${s.index}]`).join('.')}`
        );
      }
      if (segment.index < 0 || segment.index >= current.length) {
        throw new CanonicalBuilderError(
          'Invalid path',
          path,
          `Array index ${segment.index} out of bounds (array length: ${current.length})`
        );
      }
      current = current[segment.index] as Record<string, unknown>;
    }
  }
  
  // Set final value
  const lastSegment = segments[segments.length - 1];
  if (lastSegment.type === 'property') {
    current[lastSegment.key] = value;
  } else if (lastSegment.type === 'index') {
    if (!Array.isArray(current)) {
      throw new CanonicalBuilderError(
        'Invalid path',
        path,
        'Cannot use array index on non-array value'
      );
    }
    if (lastSegment.index < 0 || lastSegment.index >= current.length) {
      throw new CanonicalBuilderError(
        'Invalid path',
        path,
        `Array index ${lastSegment.index} out of bounds (array length: ${current.length})`
      );
    }
    current[lastSegment.index] = value;
  }
}

/**
 * Append an item to an array at a path in a CanonicalRecord.
 * 
 * Creates the array if it doesn't exist. If the path exists but
 * is not an array, throws an error.
 * 
 * @param obj - Partial canonical record to modify
 * @param path - Path to array (dot notation)
 * @param item - Item to append
 * @throws {CanonicalBuilderError} If path is reserved or not an array
 * 
 * @example
 * ```typescript
 * const record: Partial<CanonicalRecord> = {};
 * 
 * // Append to array (creates if missing)
 * appendPath(record, 'identifiers', { type: 'acc', value: '2024.001' });
 * appendPath(record, 'identifiers', { type: 'acc', value: '2024.002' });
 * 
 * // Append to nested array
 * appendPath(record, 'properties.keywords', 'landscape');
 * appendPath(record, 'properties.keywords', 'night');
 * 
 * // Error: cannot append to reserved top-level keys
 * appendPath(record, 'provenance', {}); // ✗ Throws error
 * ```
 */
export function appendPath(
  obj: Partial<CanonicalRecord>,
  path: string,
  item: unknown
): void {
  // Normalize path
  const normalizedPath = path.startsWith('$.') ? path.slice(2) : path;

  // Validate path safety
  validatePathSafety(normalizedPath, false);

  // Parse path
  const segments = parsePath(normalizedPath);

  if (segments.length === 0) {
    throw new CanonicalBuilderError(
      'Invalid path',
      path,
      'Path cannot be empty'
    );
  }

  // Navigate to target
  let current: Record<string, unknown> = obj as Record<string, unknown>;
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLast = i === segments.length - 1;
    
    if (segment.type === 'property') {
      if (isLast) {
        // Create array if doesn't exist
        if (!(segment.key in current)) {
          current[segment.key] = [];
        }
        
        // Verify it's an array
        if (!Array.isArray(current[segment.key])) {
          throw new CanonicalBuilderError(
            'Invalid path',
            path,
            `Path "${normalizedPath}" exists but is not an array`
          );
        }

        // Append item
        (current[segment.key] as unknown[]).push(item);
      } else {
        // Navigate deeper
        if (!(segment.key in current)) {
          current[segment.key] = {};
        }
        current = current[segment.key] as Record<string, unknown>;
      }
    } else if (segment.type === 'index') {
      throw new CanonicalBuilderError(
        'Invalid path',
        path,
        'Cannot append using array index notation'
      );
    }
  }
}

/**
 * Ensure a path points to an array in a CanonicalRecord.
 * 
 * Creates an empty array if the path doesn't exist.
 * Throws error if path exists but is not an array.
 * 
 * @param obj - Partial canonical record to modify
 * @param path - Path to ensure is an array
 * @returns The array at the path
 * @throws {CanonicalBuilderError} If path exists but is not an array
 * 
 * @example
 * ```typescript
 * const record: Partial<CanonicalRecord> = {};
 * 
 * // Ensure array exists
 * ensureArray(record, 'identifiers');
 * console.log(record.identifiers); // []
 * 
 * // Idempotent - doesn't change existing arrays
 * record.identifiers = [{ type: 'acc', value: '123' }];
 * ensureArray(record, 'identifiers');
 * console.log(record.identifiers); // [{ type: 'acc', value: '123' }]
 * 
 * // Error: path exists but is not an array
 * record.description = 'A painting';
 * ensureArray(record, 'description'); // ✗ Throws error
 * ```
 */
export function ensureArray<T = unknown>(
  obj: Partial<CanonicalRecord>,
  path: string
): T[] {
  // Normalize path
  const normalizedPath = path.startsWith('$.') ? path.slice(2) : path;

  // Validate path safety
  validatePathSafety(normalizedPath, false);

  // Parse path
  const segments = parsePath(normalizedPath);

  if (segments.length === 0) {
    throw new CanonicalBuilderError(
      'Invalid path',
      path,
      'Path cannot be empty'
    );
  }

  // Navigate to target
  let current: Record<string, unknown> = obj as Record<string, unknown>;
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLast = i === segments.length - 1;
    
    if (segment.type === 'property') {
      if (isLast) {
        // Create array if doesn't exist
        if (!(segment.key in current)) {
          current[segment.key] = [];
        }
        
        // Verify it's an array
        if (!Array.isArray(current[segment.key])) {
          throw new CanonicalBuilderError(
            'Invalid path',
            path,
            `Path "${normalizedPath}" exists but is not an array`
          );
        }

        return current[segment.key] as T[];
      } else {
        // Navigate deeper
        if (!(segment.key in current)) {
          current[segment.key] = {};
        }
        current = current[segment.key] as Record<string, unknown>;
      }
    } else if (segment.type === 'index') {
      throw new CanonicalBuilderError(
        'Invalid path',
        path,
        'Cannot use array index notation in ensureArray'
      );
    }
  }
  
  throw new CanonicalBuilderError(
    'Invalid path',
    path,
    'Failed to navigate path'
  );
}

/**
 * Validate that a path is safe to write.
 * 
 * @param path - Normalized path (no leading $.)
 * @param force - Whether to allow writes to reserved keys
 * @throws {CanonicalBuilderError} If path is unsafe
 */
function validatePathSafety(path: string, force: boolean = false): void {
  // Extract top-level key
  const topLevelKey = path.split('.')[0].split('[')[0];
  
  // Check reserved top-level keys
  if (!force && RESERVED_TOP_LEVEL_KEYS.has(topLevelKey)) {
    throw new CanonicalBuilderError(
      'Reserved key',
      path,
      `Cannot modify reserved top-level key "${topLevelKey}". ` +
      `Reserved keys: ${Array.from(RESERVED_TOP_LEVEL_KEYS).join(', ')}`
    );
  }
  
  // Check reserved meta keys
  if (!force && RESERVED_META_KEYS.has(path)) {
    throw new CanonicalBuilderError(
      'System-managed key',
      path,
      `Cannot modify system-managed field "${path}". ` +
      `System-managed keys: ${Array.from(RESERVED_META_KEYS).join(', ')}`
    );
  }
  
  // Disallow writes to extensions namespace that could conflict
  if (path.startsWith('extensions.')) {
    // This is tricky - extensions is an array, not an object
    // Users should use appendPath for extensions
    throw new CanonicalBuilderError(
      'Invalid path',
      path,
      'Use appendPath() to add extensions, not setPath(). ' +
      'Extensions is an array, not an object.'
    );
  }
}

/**
 * Path segment types.
 */
type PathSegment =
  | { type: 'property'; key: string }
  | { type: 'index'; index: number; key: string };

/**
 * Parse a path string into segments.
 * 
 * Supports:
 * - Dot notation: "properties.medium"
 * - Array indexing: "identifiers[0]" or "items[2].name"
 * 
 * @param path - Path string to parse
 * @returns Array of path segments
 */
function parsePath(path: string): PathSegment[] {
  // Handle empty path
  if (!path || path.trim() === '') {
    return [];
  }
  
  const segments: PathSegment[] = [];
  
  // Split by dots, but preserve array brackets
  const parts = path.split('.');
  
  for (const part of parts) {
    // Skip empty parts
    if (!part) continue;
    
    // Check for array indexing: "identifiers[0]"
    const arrayMatch = part.match(/^([^[]+)\[(\d+)\]$/);
    
    if (arrayMatch) {
      const [, key, indexStr] = arrayMatch;
      // First add the property segment
      segments.push({ type: 'property', key });
      // Then add the index segment
      segments.push({ type: 'index', index: parseInt(indexStr, 10), key: indexStr });
    } else {
      segments.push({ type: 'property', key: part });
    }
  }
  
  return segments;
}

/**
 * Check if a path is reserved.
 * 
 * Useful for pre-validation before attempting writes.
 * 
 * @param path - Path to check
 * @returns True if path is reserved
 * 
 * @example
 * ```typescript
 * isReservedPath('id');           // true
 * isReservedPath('provenance');   // true
 * isReservedPath('description');  // false
 * isReservedPath('properties.medium'); // false
 * ```
 */
export function isReservedPath(path: string): boolean {
  const normalizedPath = path.startsWith('$.') ? path.slice(2) : path;
  const topLevelKey = normalizedPath.split('.')[0].split('[')[0];
  
  return RESERVED_TOP_LEVEL_KEYS.has(topLevelKey) || 
         RESERVED_META_KEYS.has(normalizedPath);
}

/**
 * Get list of reserved top-level keys.
 * 
 * @returns Array of reserved key names
 */
export function getReservedKeys(): string[] {
  return Array.from(RESERVED_TOP_LEVEL_KEYS);
}

/**
 * Safely merge properties into a CanonicalRecord.
 * 
 * Only merges non-reserved fields. Reserved fields are skipped with warnings.
 * 
 * @param target - Target canonical record
 * @param source - Source object with properties to merge
 * @param options - Merge options
 * @returns Array of warnings for skipped fields
 * 
 * @example
 * ```typescript
 * const record: Partial<CanonicalRecord> = {};
 * const data = {
 *   description: 'A painting',
 *   properties: { medium: 'Oil' },
 *   id: 'obj_123', // Reserved - will be skipped
 * };
 * 
 * const warnings = safeMerge(record, data);
 * console.log(warnings); // ['Skipped reserved field: id']
 * ```
 */
export function safeMerge(
  target: Partial<CanonicalRecord>,
  source: Record<string, any>,
  options: { force?: boolean } = {}
): string[] {
  const warnings: string[] = [];
  
  for (const [key, value] of Object.entries(source)) {
    if (!options.force && RESERVED_TOP_LEVEL_KEYS.has(key)) {
      warnings.push(`Skipped reserved field: ${key}`);
      continue;
    }
    
    target[key as keyof CanonicalRecord] = value;
  }
  
  return warnings;
}
