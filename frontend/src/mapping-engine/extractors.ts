/**
 * Madrona Mapping Engine v1 — Source Data Extractors
 * 
 * Helper functions for extracting data from various source formats.
 */

import { ExtractionError } from './errors';
import type { ExtractorFunction } from './types';

/**
 * Extract value from object using dot notation path.
 * 
 * Supports:
 * - Simple paths: "title"
 * - Nested paths: "fields.title"
 * - Array access: "authors[0].name"
 * 
 * @param source - Source object
 * @param path - Dot notation path
 * @returns Extracted value or undefined
 * 
 * @example
 * ```typescript
 * const data = { fields: { title: "Test" } };
 * extractDotPath(data, "fields.title") // "Test"
 * ```
 */
export function extractDotPath(source: unknown, path: string): unknown {
  if (!path) return source;

  const parts = path.split('.');
  let current: unknown = source;

  for (const part of parts) {
    if (current === undefined || current === null) {
      return undefined;
    }

    // Handle array access: "items[0]"
    const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      const [, key, index] = arrayMatch;
      const obj = current as Record<string, unknown>;
      const arr = obj[key];
      current = Array.isArray(arr) ? arr[parseInt(index, 10)] : undefined;
    } else {
      const obj = current as Record<string, unknown>;
      current = obj[part];
    }
  }

  return current;
}

/**
 * Extract value using JSONPath expression.
 * 
 * Basic JSONPath support (not full spec):
 * - Root: "$"
 * - Child: "$.field" or "field"
 * - Nested: "$.parent.child"
 * - Array: "$.items[0]"
 * 
 * @param source - Source object
 * @param path - JSONPath expression
 * @returns Extracted value or undefined
 * 
 * @example
 * ```typescript
 * const data = { items: [{ name: "Test" }] };
 * extractJSONPath(data, "$.items[0].name") // "Test"
 * ```
 */
export function extractJSONPath(source: unknown, path: string): unknown {
  // Strip leading $. if present
  const normalizedPath = path.replace(/^\$\.?/, '');

  if (!normalizedPath) return source;

  return extractDotPath(source, normalizedPath);
}

/**
 * Extract value from CSV-style row by column name.
 * 
 * @param row - CSV row object (column name → value)
 * @param columnName - Column name
 * @returns Column value or undefined
 * 
 * @example
 * ```typescript
 * const row = { "Title": "Test", "Artist": "Unknown" };
 * extractCSVColumn(row, "Title") // "Test"
 * ```
 */
export function extractCSVColumn(row: Record<string, unknown>, columnName: string): unknown {
  return row[columnName];
}

/**
 * Extract value from database row bundle.
 * 
 * Database row bundles may include:
 * - Primary table row
 * - Related rows (joins)
 * - Computed fields
 * 
 * @param bundle - Database row bundle
 * @param path - Path with optional table prefix: "table.column" or "column"
 * @returns Extracted value or undefined
 * 
 * @example
 * ```typescript
 * const bundle = { 
 *   objects: { title: "Test" },
 *   artists: { name: "Artist" }
 * };
 * extractDBRow(bundle, "objects.title") // "Test"
 * extractDBRow(bundle, "artists.name") // "Artist"
 * ```
 */
export function extractDBRow(bundle: Record<string, unknown>, path: string): unknown {
  return extractDotPath(bundle, path);
}

/**
 * Smart extractor that auto-detects source format and uses appropriate extraction.
 * 
 * Detection rules:
 * - JSONPath: Starts with "$"
 * - Dot notation: Contains "."
 * - Direct access: Single word
 * 
 * @param source - Source data
 * @param path - Extraction path
 * @returns Extracted value or undefined
 * 
 * @example
 * ```typescript
 * extract({ fields: { title: "Test" } }, "fields.title") // "Test"
 * extract({ data: { title: "Test" } }, "$.data.title") // "Test"
 * extract({ title: "Test" }, "title") // "Test"
 * ```
 */
export function extract(source: unknown, path: string): unknown {
  if (path.startsWith('$')) {
    return extractJSONPath(source, path);
  }

  return extractDotPath(source, path);
}

/**
 * Safe extractor that returns default value on failure.
 * 
 * @param source - Source data
 * @param path - Extraction path
 * @param defaultValue - Value to return if extraction fails
 * @returns Extracted value or default
 * 
 * @example
 * ```typescript
 * extractSafe({ title: "Test" }, "title", "Untitled") // "Test"
 * extractSafe({}, "missing", "Untitled") // "Untitled"
 * ```
 */
export function extractSafe(source: unknown, path: string, defaultValue: unknown = undefined): unknown {
  try {
    const value = extract(source, path);
    return value !== undefined ? value : defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Extract with required validation.
 * 
 * Throws ExtractionError if value is missing or null.
 * 
 * @param source - Source data
 * @param path - Extraction path
 * @returns Extracted value (never undefined/null)
 * @throws {ExtractionError} If value is missing
 * 
 * @example
 * ```typescript
 * extractRequired({ title: "Test" }, "title") // "Test"
 * extractRequired({}, "title") // throws ExtractionError
 * ```
 */
export function extractRequired(source: unknown, path: string): unknown {
  const value = extract(source, path);

  if (value === undefined || value === null) {
    throw new ExtractionError(
      path,
      'Required field is missing or null',
      { source }
    );
  }

  return value;
}

/**
 * Create a custom extractor function.
 * 
 * @param extractorFn - Custom extraction logic
 * @returns Extractor function compatible with mapping engine
 */
export function createExtractor(extractorFn: ExtractorFunction): ExtractorFunction {
  return extractorFn;
}
