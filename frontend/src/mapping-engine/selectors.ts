/**
 * Madrona Mapping Engine v1 — Source Selectors
 * 
 * Abstractions for safely extracting values from SourceRecord.raw data.
 * 
 * DESIGN PRINCIPLES:
 * - Safe failure: Return undefined/[] instead of throwing
 * - Multiple selector types: JSONPath, dot notation, constants, templates
 * - Composable: Templates can use other selectors
 * - Type-safe: Strong typing with JsonValue
 */

import type { JsonValue } from './types';

/**
 * Source selector types.
 * 
 * Defines the strategy for extracting values from source data.
 */
export type SelectorType = 'jsonpath' | 'path' | 'constant' | 'template';

/**
 * Source selector configuration.
 * 
 * Describes how to extract a value from SourceRecord.raw.
 * 
 * @example
 * ```typescript
 * // JSONPath selector
 * const selector: SourceSelector = {
 *   type: 'jsonpath',
 *   expression: '$.fields.Title',
 * };
 * 
 * // Path selector
 * const selector: SourceSelector = {
 *   type: 'path',
 *   path: 'fields.Title',
 * };
 * 
 * // Constant selector
 * const selector: SourceSelector = {
 *   type: 'constant',
 *   value: 'Untitled',
 * };
 * 
 * // Template selector
 * const selector: SourceSelector = {
 *   type: 'template',
 *   template: '{{fields.Title}} ({{fields.AccessionNumber}})',
 * };
 * ```
 */
export type SourceSelector = 
  | { type: 'jsonpath'; expression: string }
  | { type: 'path'; path: string }
  | { type: 'constant'; value: JsonValue }
  | { type: 'template'; template: string };

/**
 * Select a single value from source data.
 * 
 * Returns undefined if the selector cannot extract a value.
 * 
 * @param source - Source data object (SourceRecord.raw)
 * @param selector - Selector configuration or string path
 * @returns Extracted value or undefined
 * 
 * @example
 * ```typescript
 * const source = {
 *   fields: {
 *     Title: 'The Starry Night',
 *     Artist: 'Vincent van Gogh',
 *   },
 * };
 * 
 * // String path shorthand
 * const title = selectOne(source, 'fields.Title');
 * // => 'The Starry Night'
 * 
 * // Selector object
 * const title = selectOne(source, {
 *   type: 'path',
 *   path: 'fields.Title',
 * });
 * 
 * // Missing value
 * const missing = selectOne(source, 'fields.Missing');
 * // => undefined
 * ```
 */
export function selectOne(
  source: Record<string, any>,
  selector: SourceSelector | string
): JsonValue | undefined {
  try {
    // String shorthand → path selector
    if (typeof selector === 'string') {
      return selectByPath(source, selector);
    }
    
    // Dispatch by selector type
    switch (selector.type) {
      case 'jsonpath':
        return selectByJSONPath(source, selector.expression);
      
      case 'path':
        return selectByPath(source, selector.path);
      
      case 'constant':
        return selector.value;
      
      case 'template':
        return selectByTemplate(source, selector.template);
      
      default:
        return undefined;
    }
  } catch {
    // Safe failure: return undefined instead of throwing
    return undefined;
  }
}

/**
 * Select multiple values from source data.
 * 
 * Returns empty array if the selector cannot extract values.
 * 
 * @param source - Source data object (SourceRecord.raw)
 * @param selector - Selector configuration or string path
 * @returns Array of extracted values (empty if none found)
 * 
 * @example
 * ```typescript
 * const source = {
 *   fields: {
 *     AccessionNumbers: ['2001.123', '2001.124', '2001.125'],
 *     Keywords: ['landscape', 'night', 'stars'],
 *   },
 * };
 * 
 * // String path shorthand
 * const ids = selectMany(source, 'fields.AccessionNumbers');
 * // => ['2001.123', '2001.124', '2001.125']
 * 
 * // Missing value
 * const missing = selectMany(source, 'fields.Missing');
 * // => []
 * 
 * // Non-array value (wrapped in array)
 * const single = selectMany(source, 'fields.Title');
 * // => ['The Starry Night'] (if Title exists)
 * ```
 */
export function selectMany(
  source: Record<string, any>,
  selector: SourceSelector | string
): JsonValue[] {
  try {
    const value = selectOne(source, selector);
    
    if (value === undefined || value === null) {
      return [];
    }
    
    // Already an array
    if (Array.isArray(value)) {
      return value;
    }
    
    // Wrap single value in array
    return [value];
  } catch {
    // Safe failure: return empty array instead of throwing
    return [];
  }
}

/**
 * Select value using dot/bracket notation path.
 * 
 * Supports:
 * - Dot notation: "fields.Title"
 * - Bracket notation: "fields['Title']" or "fields[0]"
 * - Mixed: "fields.Items[0].name"
 * 
 * @param source - Source data object
 * @param path - Dot/bracket notation path
 * @returns Extracted value or undefined
 * 
 * @example
 * ```typescript
 * const source = {
 *   fields: { Title: 'Artwork' },
 *   items: [{ name: 'Item 1' }, { name: 'Item 2' }],
 * };
 * 
 * selectByPath(source, 'fields.Title');        // => 'Artwork'
 * selectByPath(source, 'items[0].name');       // => 'Item 1'
 * selectByPath(source, 'fields.Missing');      // => undefined
 * ```
 */
export function selectByPath(
  source: Record<string, any>,
  path: string
): JsonValue | undefined {
  if (!path || !source) {
    return undefined;
  }
  
  // Split path by dots and brackets
  // "fields.Items[0].name" → ["fields", "Items", "0", "name"]
  const parts = path
    .replace(/\[(\w+)\]/g, '.$1')  // Convert brackets to dots: [0] → .0
    .replace(/^\./, '')             // Remove leading dot
    .split('.');

  let current: unknown = source;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    // Handle quoted keys: "fields['My Key']" → "My Key"
    const key = part.replace(/^['"](.*)['"]$/, '$1');
    const obj = current as Record<string, unknown>;
    current = obj[key];
  }

  return current as JsonValue | undefined;
}

/**
 * Select value using JSONPath expression.
 * 
 * Simple JSONPath subset:
 * - Root: $ or $.field
 * - Dot notation: $.field.nested
 * - Array index: $.items[0]
 * - Array wildcard: $.items[*] (returns array)
 * 
 * Does NOT support:
 * - Recursive descent: $..field
 * - Filters: $.items[?(@.price < 10)]
 * - Complex expressions
 * 
 * @param source - Source data object
 * @param expression - JSONPath expression
 * @returns Extracted value or undefined
 * 
 * @example
 * ```typescript
 * const source = {
 *   data: {
 *     artwork: { title: 'Painting' },
 *     items: [{ id: 1 }, { id: 2 }],
 *   },
 * };
 * 
 * selectByJSONPath(source, '$.data.artwork.title');  // => 'Painting'
 * selectByJSONPath(source, '$.data.items[0].id');    // => 1
 * selectByJSONPath(source, '$.data.items[*].id');    // => [1, 2]
 * ```
 */
export function selectByJSONPath(
  source: Record<string, any>,
  expression: string
): JsonValue | undefined {
  if (!expression || !source) {
    return undefined;
  }
  
  // Remove leading $ and convert to path notation
  const path = expression.replace(/^\$\.?/, '');
  
  // Handle array wildcard: $.items[*] → get all items
  if (path.includes('[*]')) {
    const arrayPath = path.replace(/\[\*\].*$/, '');
    const array = selectByPath(source, arrayPath);
    
    if (!Array.isArray(array)) {
      return undefined;
    }
    
    // Extract remaining path after [*]
    const remainingPath = path.replace(/^[^[]*\[\*\]\.?/, '');
    
    if (!remainingPath) {
      return array;
    }
    
    // Map over array items with remaining path
    return array
      .map(item => {
        if (typeof item === 'object' && item !== null) {
          return selectByPath(item as Record<string, any>, remainingPath);
        }
        return undefined;
      })
      .filter(v => v !== undefined);
  }
  
  // Regular path
  return selectByPath(source, path);
}

/**
 * Select value using template string interpolation.
 * 
 * Templates support {{selector}} placeholders that are replaced
 * with values extracted from the source.
 * 
 * @param source - Source data object
 * @param template - Template string with {{path}} placeholders
 * @returns Interpolated string or undefined if any selector fails
 * 
 * @example
 * ```typescript
 * const source = {
 *   fields: {
 *     Title: 'The Starry Night',
 *     Artist: 'Vincent van Gogh',
 *     Year: 1889,
 *   },
 * };
 * 
 * selectByTemplate(source, '{{fields.Title}} by {{fields.Artist}}');
 * // => 'The Starry Night by Vincent van Gogh'
 * 
 * selectByTemplate(source, 'Created in {{fields.Year}}');
 * // => 'Created in 1889'
 * 
 * selectByTemplate(source, '{{fields.Missing}} value');
 * // => undefined (any missing selector fails the template)
 * ```
 */
export function selectByTemplate(
  source: Record<string, any>,
  template: string
): string | undefined {
  if (!template) {
    return undefined;
  }
  
  // Find all {{path}} placeholders
  const placeholderRegex = /\{\{([^}]+)\}\}/g;
  const placeholders = Array.from(template.matchAll(placeholderRegex));
  
  if (placeholders.length === 0) {
    // No placeholders, return template as-is
    return template;
  }
  
  let result = template;
  
  for (const match of placeholders) {
    const fullMatch = match[0];      // "{{fields.Title}}"
    const path = match[1].trim();    // "fields.Title"
    
    // Extract value using path selector
    const value = selectByPath(source, path);
    
    // If any selector fails, template fails
    if (value === undefined || value === null) {
      return undefined;
    }
    
    // Replace placeholder with value
    result = result.replace(fullMatch, String(value));
  }
  
  return result;
}

/**
 * Create a selector from a string or object.
 * 
 * Convenience function for creating selector configurations.
 * 
 * @param input - String path or selector configuration
 * @returns Normalized selector configuration
 * 
 * @example
 * ```typescript
 * // String → path selector
 * createSelector('fields.Title');
 * // => { type: 'path', path: 'fields.Title' }
 * 
 * // JSONPath detection
 * createSelector('$.data.title');
 * // => { type: 'jsonpath', expression: '$.data.title' }
 * 
 * // Template detection
 * createSelector('{{fields.Title}} - {{fields.Year}}');
 * // => { type: 'template', template: '{{fields.Title}} - {{fields.Year}}' }
 * 
 * // Already a selector
 * createSelector({ type: 'constant', value: 'test' });
 * // => { type: 'constant', value: 'test' }
 * ```
 */
export function createSelector(
  input: string | SourceSelector
): SourceSelector {
  if (typeof input === 'object') {
    return input;
  }
  
  // Detect selector type from string
  if (input.startsWith('$')) {
    return { type: 'jsonpath', expression: input };
  }
  
  if (input.includes('{{')) {
    return { type: 'template', template: input };
  }
  
  return { type: 'path', path: input };
}

/**
 * Select with fallback values (coalesce).
 * 
 * Tries selectors in order until one returns a non-undefined value.
 * 
 * @param source - Source data object
 * @param selectors - Array of selectors to try
 * @returns First non-undefined value or undefined
 * 
 * @example
 * ```typescript
 * const source = {
 *   fields: {
 *     Title: null,
 *     ObjectName: 'Painting',
 *     DisplayName: 'Artwork',
 *   },
 * };
 * 
 * selectWithFallback(source, [
 *   'fields.Title',
 *   'fields.ObjectName',
 *   'fields.DisplayName',
 * ]);
 * // => 'Painting' (first non-null value)
 * ```
 */
export function selectWithFallback(
  source: Record<string, any>,
  selectors: (SourceSelector | string)[]
): JsonValue | undefined {
  for (const selector of selectors) {
    const value = selectOne(source, selector);
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}
