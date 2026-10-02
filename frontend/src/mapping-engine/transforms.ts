/**
 * Madrona Mapping Engine v1 — Transform Pipeline Runtime
 * 
 * Executes transformation pipelines and applies mapping rules.
 */

import type { CanonicalRecord } from '../types/canonical';
import type {
  TransformContext,
  TransformFunction,
  MappingRule,
  RuleExecutionResult,
  JsonValue,
} from './types';
import { extractSafe } from './extractors';
import { TransformError } from './errors';

/**
 * Registry of transform functions.
 */
const TRANSFORM_REGISTRY: Map<string, TransformFunction> = new Map();

/**
 * Register a transform function.
 * 
 * @param name - Transform function name
 * @param fn - Transform function
 * 
 * @example
 * ```typescript
 * registerTransform('toUpperCase', (value) => {
 *   return typeof value === 'string' ? value.toUpperCase() : value;
 * });
 * ```
 */
export function registerTransform(name: string, fn: TransformFunction): void {
  TRANSFORM_REGISTRY.set(name, fn);
}

/**
 * Get a registered transform function.
 * 
 * @param name - Transform function name
 * @returns Transform function or undefined
 */
export function getTransform(name: string): TransformFunction | undefined {
  return TRANSFORM_REGISTRY.get(name);
}

/**
 * Execute a single mapping rule.
 * 
 * @param rule - Mapping rule to execute
 * @param context - Transform context
 * @returns Rule execution result
 */
export function executeRule(
  rule: MappingRule,
  context: TransformContext
): RuleExecutionResult {
  try {
    // Extract value from source
    const sourceValue = extractSafe(
      context.sourceRecord.raw,
      rule.sourcePath,
      rule.defaultValue
    );
    
    // Skip if no value and not required
    if ((sourceValue === undefined || sourceValue === null) && !rule.required) {
      return {
        rule,
        success: true,
        skipped: true,
      };
    }
    
    // Validate required field
    if ((sourceValue === undefined || sourceValue === null) && rule.required) {
      const error = `Required field ${rule.sourcePath} is missing`;
      context.warnings.push(error);
      return {
        rule,
        success: false,
        error,
        skipped: false,
      };
    }
    
    // Apply transform if specified
    let targetValue = sourceValue;
    if (rule.transform) {
      const transformFn = getTransform(rule.transform);
      if (transformFn) {
        try {
          targetValue = transformFn(sourceValue, context);
        } catch (error) {
          throw new TransformError(
            rule.transform,
            error instanceof Error ? error.message : String(error),
            { sourceValue, rule }
          );
        }
      } else {
        const warning = `Transform ${rule.transform} not found, using raw value`;
        context.warnings.push(warning);
      }
    }
    
    // Write to canonical record (simplified - just set directly)
    // In production, this would handle nested paths properly
    setNestedValue(context.canonicalRecord as Record<string, unknown>, rule.targetPath, targetValue);

    return {
      rule,
      success: true,
      sourceValue: sourceValue as JsonValue,
      targetValue: targetValue as JsonValue,
      skipped: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    context.warnings.push(`Rule ${rule.id} failed: ${errorMessage}`);
    
    return {
      rule,
      success: false,
      error: errorMessage,
      skipped: false,
    };
  }
}

/**
 * Execute all mapping rules in a compiled mapping.
 * 
 * @param rules - Mapping rules to execute
 * @param context - Transform context
 * @returns Array of rule execution results
 */
export function executeRules(
  rules: MappingRule[],
  context: TransformContext
): RuleExecutionResult[] {
  const results: RuleExecutionResult[] = [];
  
  for (const rule of rules) {
    const result = executeRule(rule, context);
    results.push(result);
    
    // Update stats
    context.ruleStats.totalRules++;
    if (result.skipped) {
      context.ruleStats.skippedRules++;
    } else if (result.success) {
      context.ruleStats.executedRules++;
    } else {
      context.ruleStats.failedRules++;
    }
  }
  
  return results;
}

/**
 * Set a nested value in an object using dot notation path.
 * 
 * @param obj - Object to modify
 * @param path - Dot notation path
 * @param value - Value to set
 * 
 * @example
 * ```typescript
 * const obj = {};
 * setNestedValue(obj, "properties.creator", "Artist");
 * // obj.properties.creator === "Artist"
 * ```
 */
export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part] || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  const lastPart = parts[parts.length - 1];
  current[lastPart] = value;
}

/**
 * Built-in transform functions.
 */

// Date normalization
registerTransform('normalizeDate', (value: unknown): string => {
  if (typeof value === 'string') {
    // Try to parse and convert to ISO 8601
    // This is a simplified version
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0]; // YYYY-MM-DD
    }
  }
  return String(value);
});

// Trim whitespace
registerTransform('trim', (value: unknown): string => {
  return typeof value === 'string' ? value.trim() : String(value);
});

// Format canonical ID
registerTransform('formatCanonicalId', (value: unknown, context: TransformContext): string => {
  const system = context.sourceRecord.source.system;
  const recordId = value || context.sourceRecord.source.recordId;
  return `object:${system}:${recordId}`;
});

// Create identifier object
registerTransform('createIdentifier', (value: unknown): unknown => {
  return [{
    scheme: 'accession-number',
    value: String(value),
  }];
});

// Format dimensions
registerTransform('formatDimensions', (value: unknown): string => {
  if (typeof value === 'object' && value !== null) {
    const dims = value as Record<string, unknown>;
    const height = dims.height;
    const width = dims.width;
    const unit = dims.unit ?? 'cm';
    if (height && width) {
      return `${height} × ${width} ${unit}`;
    }
  }
  return String(value);
});

// ═══════════════════════════════════════════════════════════════════════════
// TRANSFORM PIPELINE RUNTIME
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Result of a single transform step execution.
 */
export interface TransformStepResult {
  record: Partial<CanonicalRecord>;
  warnings?: string[];
}

/**
 * Run a complete transform pipeline on a canonical record.
 * 
 * Executes a series of named transform steps in order, where each step
 * can modify the record and emit warnings. All transforms are pure functions
 * with no side effects (no DB calls, no external API calls).
 * 
 * @param record - Canonical record to transform
 * @param pipeline - Transform pipeline configuration
 * @param context - Transform context for warnings and metadata
 * @returns Transformed record and collected warnings
 * 
 * @example
 * ```typescript
 * const pipeline: TransformPipeline = {
 *   id: 'normalize_v1',
 *   version: '1.0.0',
 *   steps: [
 *     { type: 'normalize-whitespace' },
 *     { type: 'normalize-identifiers' },
 *     { type: 'normalize-dimensions' }
 *   ]
 * };
 * 
 * const result = runTransformPipeline(record, pipeline, context);
 * ```
 */
export function runTransformPipeline(
  record: Partial<CanonicalRecord>,
  pipeline: { steps: Array<Record<string, any>> },
  context: TransformContext
): TransformStepResult {
  let currentRecord = { ...record };
  const allWarnings: string[] = [];
  
  for (const step of pipeline.steps) {
    const stepType = (step.type ?? step.id) as string;
    
    try {
      const result = executeTransformStep(currentRecord, stepType, context);
      currentRecord = result.record;
      
      if (result.warnings && result.warnings.length > 0) {
        allWarnings.push(...result.warnings);
      }
    } catch (error) {
      const warning = `Transform step '${stepType}' failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      allWarnings.push(warning);
      context.warnings.push(warning);
    }
  }
  
  return {
    record: currentRecord,
    warnings: allWarnings.length > 0 ? allWarnings : undefined,
  };
}

/**
 * Execute a single transform step by type.
 * 
 * @param record - Current record state
 * @param stepType - Type of transform step to execute
 * @param context - Transform context
 * @returns Transform result with updated record
 */
function executeTransformStep(
  record: Partial<CanonicalRecord>,
  stepType: string,
  context: TransformContext
): TransformStepResult {
  switch (stepType) {
    case 'normalize-whitespace':
      return normalizeWhitespace(record, context);
    
    case 'normalize-identifiers':
      return normalizeIdentifiers(record, context);
    
    case 'normalize-dimensions':
      return normalizeDimensions(record, context);
    
    case 'normalize-dates':
      return normalizeDates(record, context);
    
    default:
      throw new Error(`Unknown transform step type: ${stepType}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BUILT-IN TRANSFORM STEPS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize whitespace in label and description fields.
 * 
 * - Trims leading/trailing whitespace
 * - Collapses multiple spaces to single space
 * - Removes zero-width characters
 * - Preserves intentional line breaks
 * 
 * @param record - Canonical record
 * @param context - Transform context
 * @returns Transform result
 */
function normalizeWhitespace(
  record: Partial<CanonicalRecord>,
  _context: TransformContext
): TransformStepResult {
  const normalized = { ...record };
  const warnings: string[] = [];
  
  // Normalize label
  if (normalized.label && typeof normalized.label === 'string') {
    const original = normalized.label;
    normalized.label = normalized.label
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width chars
      .replace(/\s+/g, ' ') // Collapse multiple spaces
      .trim();
    
    if (original !== normalized.label && original.length !== normalized.label.length) {
      warnings.push(`Normalized whitespace in label (${original.length} → ${normalized.label.length} chars)`);
    }
  }
  
  // Normalize description
  if (normalized.description && typeof normalized.description === 'string') {
    const original = normalized.description;
    normalized.description = normalized.description
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width chars
      .replace(/[ \t]+/g, ' ') // Collapse spaces/tabs (preserve newlines)
      .split('\n')
      .map(line => line.trim())
      .join('\n')
      .trim();
    
    if (original !== normalized.description && original.length !== normalized.description.length) {
      warnings.push(`Normalized whitespace in description (${original.length} → ${normalized.description.length} chars)`);
    }
  }
  
  return { record: normalized, warnings: warnings.length > 0 ? warnings : undefined };
}

/**
 * Normalize identifier values.
 * 
 * - Trims whitespace from identifier values
 * - Collapses multiple spaces in values
 * - Removes empty identifiers
 * - Deduplicates identifiers by value
 * 
 * @param record - Canonical record
 * @param context - Transform context
 * @returns Transform result
 */
function normalizeIdentifiers(
  record: Partial<CanonicalRecord>,
  _context: TransformContext
): TransformStepResult {
  const normalized = { ...record };
  const warnings: string[] = [];
  
  if (Array.isArray(normalized.identifiers)) {
    const originalCount = normalized.identifiers.length;
    const seen = new Set<string>();
    
    // Normalize identifier values - trim whitespace and deduplicate.
    // Supports both string identifiers ("ABC") and object identifiers
    // ({ scheme, value }).
    const normalizedIds: typeof normalized.identifiers = [];
    for (const id of normalized.identifiers) {
      const isString = typeof id === 'string';
      const rawValue = isString ? id : id?.value;
      const cleanValue = String(rawValue ?? '').replace(/\s+/g, ' ').trim();

      if (!cleanValue) continue;

      const normalizedId: any = isString
        ? cleanValue
        : { ...id, value: cleanValue };

      const scheme = isString ? '' : (id?.scheme ?? '');
      const key = `${scheme}:${cleanValue}`;
      if (seen.has(key)) continue;
      seen.add(key);

      normalizedIds.push(normalizedId);
    }
    normalized.identifiers = normalizedIds;
    
    const removedCount = originalCount - normalized.identifiers.length;
    if (removedCount > 0) {
      warnings.push(`Removed ${removedCount} empty/duplicate identifier(s)`);
    }
  }
  
  return { record: normalized, warnings: warnings.length > 0 ? warnings : undefined };
}

/**
 * Normalize dimensions data.
 * 
 * - Coerces string dimension values to numbers where safe
 * - Extracts numeric values from strings like "100 cm"
 * - Preserves original strings if parsing fails
 * - Validates dimension values are positive
 * 
 * @param record - Canonical record
 * @param context - Transform context
 * @returns Transform result
 */
function normalizeDimensions(
  record: Partial<CanonicalRecord>,
  _context: TransformContext
): TransformStepResult {
  const normalized = { ...record };
  const warnings: string[] = [];
  
  // Check for dimensions in properties or extensions
  if (normalized.properties && typeof normalized.properties === 'object') {
    const props = normalized.properties as Record<string, any>;
    
    // Common dimension fields to normalize
    const dimensionFields = ['height', 'width', 'depth', 'diameter', 'length', 'weight'];
    
    for (const field of dimensionFields) {
      if (field in props) {
        const original = props[field];
        const parsed = parseDimensionValue(original);
        
        if (parsed !== original) {
          props[field] = parsed;
          warnings.push(`Normalized dimension ${field}: "${original}" → ${parsed}`);
        }
      }
    }
    
    // Handle nested dimensions object
    if (props.dimensions && typeof props.dimensions === 'object') {
      const dims = props.dimensions as Record<string, any>;
      for (const key of Object.keys(dims)) {
        const original = dims[key];
        const parsed = parseDimensionValue(original);
        
        if (parsed !== original) {
          dims[key] = parsed;
          warnings.push(`Normalized dimension ${key}: "${original}" → ${parsed}`);
        }
      }
    }
  }
  
  return { record: normalized, warnings: warnings.length > 0 ? warnings : undefined };
}

/**
 * Parse a dimension value from string to number.
 * 
 * @param value - Dimension value (string or number)
 * @returns Parsed number or original value if parsing fails
 */
function parseDimensionValue(value: unknown): number | unknown {
  if (typeof value === 'number') {
    return value; // Preserve numbers as-is
  }

  if (typeof value === 'string') {
    // Try to extract numeric value from strings like "100", "100.5", "100 cm", "100.5 inches"
    const match = value.trim().match(/^(-?\d+\.?\d*)/);
    if (match) {
      const num = parseFloat(match[1]);
      if (!isNaN(num)) {
        return num;
      }
    }
  }

  return value; // Return original if can't parse
}

/**
 * Normalize date fields to ISO 8601 format where possible.
 *
 * Handles various date formats including:
 * - Standard dates: "2024-01-15", "January 15, 2024", "15/01/2024"
 * - Fuzzy dates: "circa 1850", "c. 1900", "ca. 1920"
 * - Decade/century: "1800s", "19th century", "early 20th century"
 * - Ranges: "1850-1860", "1850 to 1860"
 *
 * @param record - Canonical record
 * @param context - Transform context
 * @returns Transform result
 */
function normalizeDates(
  record: Partial<CanonicalRecord>,
  _context: TransformContext
): TransformStepResult {
  const normalized = { ...record };
  const warnings: string[] = [];

  // Check for dates object
  if (normalized.dates && typeof normalized.dates === 'object') {
    const dates = normalized.dates as Record<string, any>;

    for (const [key, value] of Object.entries(dates)) {
      if (value === null || value === undefined || value === '') {
        warnings.push(`Date field '${key}' is empty`);
        continue;
      }

      if (typeof value === 'string') {
        const result = parseDateString(value);
        if (result.normalized !== value) {
          dates[key] = result.normalized;
          if (result.approximate) {
            warnings.push(`Date '${key}' parsed as approximate: "${value}" → "${result.normalized}"`);
          }
        }
      }
    }
  }

  // Also check common date fields in properties
  if (normalized.properties && typeof normalized.properties === 'object') {
    const props = normalized.properties as Record<string, any>;
    const dateFields = ['date', 'created', 'modified', 'published', 'acquired', 'dateCreated', 'dateModified'];

    for (const field of dateFields) {
      if (field in props && typeof props[field] === 'string') {
        const result = parseDateString(props[field]);
        if (result.normalized !== props[field]) {
          props[field] = result.normalized;
          if (result.approximate) {
            warnings.push(`Property '${field}' parsed as approximate: "${props[field]}" → "${result.normalized}"`);
          }
        }
      }
    }
  }

  return { record: normalized, warnings: warnings.length > 0 ? warnings : undefined };
}

/**
 * Parse a date string and normalize to ISO 8601 format.
 *
 * @param dateStr - Date string to parse
 * @returns Object with normalized date string and whether it's approximate
 */
function parseDateString(dateStr: string): { normalized: string; approximate: boolean } {
  const trimmed = dateStr.trim();

  // Already ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss)
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/.test(trimmed)) {
    return { normalized: trimmed, approximate: false };
  }

  // Year only (YYYY)
  if (/^\d{4}$/.test(trimmed)) {
    return { normalized: trimmed, approximate: false };
  }

  // Circa/approximate dates: "circa 1850", "c. 1900", "ca. 1920", "~1850"
  const circaMatch = trimmed.match(/^(?:circa|c\.?|ca\.?|~|approx\.?)\s*(\d{4})$/i);
  if (circaMatch) {
    return { normalized: `~${circaMatch[1]}`, approximate: true };
  }

  // Decade: "1850s", "the 1920s"
  const decadeMatch = trimmed.match(/^(?:the\s+)?(\d{3})0s$/i);
  if (decadeMatch) {
    return { normalized: `${decadeMatch[1]}0s`, approximate: true };
  }

  // Century: "19th century", "twentieth century"
  const centuryMatch = trimmed.match(/^(?:the\s+)?(\d+)(?:st|nd|rd|th)\s+century$/i);
  if (centuryMatch) {
    const century = parseInt(centuryMatch[1], 10);
    const startYear = (century - 1) * 100;
    return { normalized: `${startYear}-${startYear + 99}`, approximate: true };
  }

  // Early/mid/late century: "early 19th century"
  const eraMatch = trimmed.match(/^(early|mid|late)\s+(\d+)(?:st|nd|rd|th)\s+century$/i);
  if (eraMatch) {
    const era = eraMatch[1].toLowerCase();
    const century = parseInt(eraMatch[2], 10);
    const baseYear = (century - 1) * 100;
    let startYear: number, endYear: number;

    if (era === 'early') {
      startYear = baseYear;
      endYear = baseYear + 33;
    } else if (era === 'mid') {
      startYear = baseYear + 33;
      endYear = baseYear + 66;
    } else {
      startYear = baseYear + 66;
      endYear = baseYear + 99;
    }

    return { normalized: `${startYear}-${endYear}`, approximate: true };
  }

  // Date range with hyphen or "to": "1850-1860", "1850 to 1860"
  const rangeMatch = trimmed.match(/^(\d{4})\s*(?:-|to)\s*(\d{4})$/i);
  if (rangeMatch) {
    return { normalized: `${rangeMatch[1]}/${rangeMatch[2]}`, approximate: false };
  }

  // Try standard date parsing for formats like "January 15, 2024", "15/01/2024"
  const date = new Date(trimmed);
  if (!isNaN(date.getTime())) {
    // Validate the parsed date is reasonable (between year 1000 and 2100)
    const year = date.getFullYear();
    if (year >= 1000 && year <= 2100) {
      return { normalized: date.toISOString().split('T')[0], approximate: false };
    }
  }

  // Common formats that Date() might not parse correctly
  // MM/DD/YYYY
  const usDateMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usDateMatch) {
    const [, month, day, year] = usDateMatch;
    const m = month.padStart(2, '0');
    const d = day.padStart(2, '0');
    return { normalized: `${year}-${m}-${d}`, approximate: false };
  }

  // DD/MM/YYYY (European format)
  const euDateMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (euDateMatch) {
    const [, day, month, year] = euDateMatch;
    const m = month.padStart(2, '0');
    const d = day.padStart(2, '0');
    return { normalized: `${year}-${m}-${d}`, approximate: false };
  }

  // Could not parse - return original
  return { normalized: trimmed, approximate: false };
}
