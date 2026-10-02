import type { JsonValue } from '../../types/api';
import { formatFieldName } from './formatFieldName';
import { formatDateTime } from '../../lib/formatters';

export function toTitleCase(s: string): string {
  return s.replace(/\b\w/g, (l) => l.toUpperCase());
}

export const ENUM_DISPLAY_LABELS: Record<string, Record<string, string>> = {
  object_status: {
    accessioned: 'Accessioned',
    active: 'Active',
    on_loan: 'On Loan',
    in_conservation: 'In Conservation',
    pending: 'Pending',
    deaccessioned: 'Deaccessioned',
    missing: 'Missing',
    approved: 'Approved',
    review: 'Under Review',
    damaged: 'Damaged',
    rejected: 'Rejected',
  },
};

export function formatEnumValue(fieldName: string, rawValue: string): string {
  return ENUM_DISPLAY_LABELS[fieldName]?.[rawValue] ?? rawValue;
}

export type DiffKind = 'scalar' | 'list' | 'object';

export interface FieldDiff {
  field_name: string;
  old_value: JsonValue;
  new_value: JsonValue;
}

export interface ListDiffResult {
  added: JsonValue[];
  removed: JsonValue[];
  hasComplexItems: boolean;
}

export interface ListDiffSummary {
  /** Items to show inline (up to maxPreview) */
  previewAdded: string[];
  previewRemoved: string[];
  /** Total remaining items not shown in preview */
  remainingCount: number;
  /** Total added count */
  addedCount: number;
  /** Total removed count */
  removedCount: number;
  /** Whether any items are objects/arrays requiring "View details" */
  hasComplexItems: boolean;
}

export type ItemLabelFn = (item: JsonValue, maxLen?: number) => string;

/**
 * Classify a diff based on the types of old/new values.
 * Arrays → list, plain objects → object, everything else → scalar.
 */
export function classifyDiff(diff: FieldDiff): DiffKind {
  const { old_value, new_value } = diff;
  if (Array.isArray(old_value) || Array.isArray(new_value)) return 'list';
  if (
    (typeof old_value === 'object' && old_value !== null) ||
    (typeof new_value === 'object' && new_value !== null)
  ) {
    return 'object';
  }
  return 'scalar';
}

/**
 * Compute added/removed items between two arrays using frequency-counted maps.
 * Handles duplicates correctly (unlike a Set-based approach).
 */
export function computeListDiff(
  oldValue: JsonValue,
  newValue: JsonValue,
): ListDiffResult {
  const oldArr = Array.isArray(oldValue) ? oldValue : [];
  const newArr = Array.isArray(newValue) ? newValue : [];

  // Build frequency maps keyed by JSON.stringify
  const oldCounts = new Map<string, { count: number; value: JsonValue }>();
  for (const item of oldArr) {
    const key = JSON.stringify(item);
    const entry = oldCounts.get(key);
    if (entry) {
      entry.count++;
    } else {
      oldCounts.set(key, { count: 1, value: item });
    }
  }

  const newCounts = new Map<string, { count: number; value: JsonValue }>();
  for (const item of newArr) {
    const key = JSON.stringify(item);
    const entry = newCounts.get(key);
    if (entry) {
      entry.count++;
    } else {
      newCounts.set(key, { count: 1, value: item });
    }
  }

  const added: JsonValue[] = [];
  const removed: JsonValue[] = [];

  // Items in new but not (enough) in old → added
  for (const [key, { count: newCount, value }] of newCounts) {
    const oldCount = oldCounts.get(key)?.count || 0;
    for (let i = 0; i < newCount - oldCount; i++) {
      added.push(value);
    }
  }

  // Items in old but not (enough) in new → removed
  for (const [key, { count: oldCount, value }] of oldCounts) {
    const newCount = newCounts.get(key)?.count || 0;
    for (let i = 0; i < oldCount - newCount; i++) {
      removed.push(value);
    }
  }

  const hasComplexItems =
    added.some((v) => typeof v === 'object' && v !== null) ||
    removed.some((v) => typeof v === 'object' && v !== null);

  return { added, removed, hasComplexItems };
}

/**
 * Get a display label for an item in a list diff.
 * Returns a readable string or '' if the item has no known display keys.
 * All non-empty values are shown exactly as stored — no content filtering.
 * For objects: tries name/label/title, structured "type: value", value/id keys.
 */
export function itemLabel(item: JsonValue, maxLen = 60): string {
  if (item === null || item === undefined) return '';
  if (typeof item === 'boolean') return item ? 'true' : 'false';
  if (typeof item === 'number') return String(item);
  if (typeof item === 'string') return item !== '' ? formatScalarValue(item, maxLen) : '';
  if (Array.isArray(item)) return '';

  const obj = item as Record<string, JsonValue>;

  // 1. Direct label keys — shown as stored
  for (const k of ['name', 'label', 'title']) {
    const v = obj[k];
    if (typeof v === 'string' && v !== '') return formatScalarValue(v, maxLen);
  }

  // 2. Structured "type: value" format (e.g., "alternate: 95.PA.12")
  for (const typeKey of ['type', 'category', 'kind']) {
    const typeVal = obj[typeKey];
    if (typeof typeVal === 'string' && typeVal !== '') {
      for (const valKey of ['value', 'number', 'id', 'code']) {
        if (valKey === typeKey) continue;
        const v = obj[valKey];
        if (v != null) {
          const s = typeof v === 'string' ? v : String(v);
          if (s !== '') {
            const result = `${typeVal}: ${s}`;
            return result.length > maxLen ? result.slice(0, maxLen) + '\u2026' : result;
          }
        }
      }
      return formatScalarValue(typeVal, maxLen);
    }
  }

  // 3. Value/number/id alone
  for (const k of ['value', 'number', 'id']) {
    const v = obj[k];
    if (typeof v === 'string' && v !== '') return formatScalarValue(v, maxLen);
  }

  return '';
}

/**
 * Returns true if the item can produce a meaningful display label.
 */
export function hasReadableLabel(item: JsonValue): boolean {
  return itemLabel(item).length > 0;
}

/**
 * Title-case renderer for techniques/materials: handles strings and {name: string} objects.
 */
function titleCaseStringRenderer(item: JsonValue, maxLen = 60): string {
  if (typeof item === 'string' && item !== '') {
    return formatScalarValue(toTitleCase(item), maxLen);
  }
  if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
    const obj = item as Record<string, JsonValue>;
    if (typeof obj.name === 'string' && obj.name !== '') {
      return formatScalarValue(toTitleCase(obj.name), maxLen);
    }
  }
  return itemLabel(item, maxLen);
}

/**
 * Renderer for classifications: extracts `term` key and title-cases it.
 */
function classificationsRenderer(item: JsonValue, maxLen = 60): string {
  if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
    const obj = item as Record<string, JsonValue>;
    if (typeof obj.term === 'string' && obj.term !== '') {
      return formatScalarValue(toTitleCase(obj.term), maxLen);
    }
  }
  return itemLabel(item, maxLen);
}

/**
 * Renderer for other_numbers: title-cases the type label, value as-is.
 */
function otherNumbersRenderer(item: JsonValue, maxLen = 60): string {
  if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
    const obj = item as Record<string, JsonValue>;
    for (const kindKey of ['type', 'kind']) {
      const kindVal = obj[kindKey];
      if (typeof kindVal === 'string' && kindVal !== '') {
        const kindLabel = toTitleCase(kindVal);
        for (const valKey of ['value', 'number', 'id', 'code']) {
          if (valKey === kindKey) continue;
          const v = obj[valKey];
          if (v != null) {
            const s = typeof v === 'string' ? v : String(v);
            if (s !== '') {
              const result = `${kindLabel}: ${s}`;
              return result.length > maxLen ? result.slice(0, maxLen) + '\u2026' : result;
            }
          }
        }
        return formatScalarValue(kindLabel, maxLen);
      }
    }
  }
  return itemLabel(item, maxLen);
}

const FIELD_RENDERERS: Record<string, ItemLabelFn> = {
  techniques: titleCaseStringRenderer,
  materials: titleCaseStringRenderer,
  classifications: classificationsRenderer,
  other_numbers: otherNumbersRenderer,
};

/**
 * Look up a field-specific label function, falling back to generic itemLabel.
 */
export function getFieldLabelFn(fieldName?: string): ItemLabelFn {
  if (fieldName && FIELD_RENDERERS[fieldName]) {
    return FIELD_RENDERERS[fieldName];
  }
  return itemLabel;
}

/**
 * Summarize a list diff for preview display.
 * Returns preview items (as display strings) and a remaining count.
 * Items without known display keys are skipped in preview and counted in remaining.
 */
export function summarizeListDiff(
  added: JsonValue[],
  removed: JsonValue[],
  maxPreview = 3,
  labelFn: ItemLabelFn = itemLabel,
): ListDiffSummary {
  const hasComplexItems =
    added.some((v) => typeof v === 'object' && v !== null) ||
    removed.some((v) => typeof v === 'object' && v !== null);

  const total = added.length + removed.length;

  // For preview, show removed first then added, up to maxPreview total.
  // Only include items with display labels; unlabelable items count towards remaining.
  const previewRemoved: string[] = [];
  const previewAdded: string[] = [];
  let shown = 0;

  for (const item of removed) {
    if (shown >= maxPreview) break;
    const label = labelFn(item);
    if (label) {
      previewRemoved.push(label);
      shown++;
    }
  }
  for (const item of added) {
    if (shown >= maxPreview) break;
    const label = labelFn(item);
    if (label) {
      previewAdded.push(label);
      shown++;
    }
  }

  return {
    previewAdded,
    previewRemoved,
    remainingCount: total - shown,
    addedCount: added.length,
    removedCount: removed.length,
    hasComplexItems,
  };
}

/**
 * Format a scalar value for display.
 * - null/undefined → ""
 * - boolean → "true" / "false"
 * - ISO date strings → locale date
 * - strings → truncated at maxLen
 */
export function formatScalarValue(val: JsonValue, maxLen = 80): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(val);

  const str = String(val);

  // Detect ISO 8601 date strings
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) {
    try {
      const date = new Date(str);
      if (!isNaN(date.getTime())) {
        return formatDateTime(date);
      }
    } catch {
      // fall through to string display
    }
  }

  if (str.length > maxLen) return str.slice(0, maxLen) + '\u2026';
  return str;
}

/**
 * Format a value for empty/cleared display.
 * Returns "(empty)" for null-like values, "(cleared)" when a value was removed.
 */
export function formatEmpty(val: JsonValue, context: 'old' | 'new' = 'old'): string {
  if (isEmptyValue(val)) {
    return context === 'new' ? '(cleared)' : '(empty)';
  }
  return formatScalarValue(val);
}

/**
 * Returns true for null, undefined, empty string, or empty array.
 */
export function isEmptyValue(val: JsonValue): boolean {
  if (val === null || val === undefined) return true;
  if (val === '') return true;
  if (Array.isArray(val) && val.length === 0) return true;
  return false;
}

/**
 * Build a human-readable text summary of a list diff for clipboard copy.
 * Values shown exactly as stored; falls back to JSON for objects without display keys.
 */
export function formatListDiffAsText(
  fieldName: string,
  added: JsonValue[],
  removed: JsonValue[],
  labelFn: ItemLabelFn = itemLabel,
): string {
  const lines: string[] = [fieldName + ':'];
  for (const item of removed) {
    lines.push(`  - ${labelFn(item) || JSON.stringify(item)}`);
  }
  for (const item of added) {
    lines.push(`  + ${labelFn(item) || JSON.stringify(item)}`);
  }
  return lines.join('\n');
}

/**
 * Build a one-line summary of field changes for display in collapsed session headers.
 * E.g., "Techniques +1 • Materials +1 • Other Numbers +1/−1"
 */
export function buildFieldSummaryLine(
  diffs: Array<{ field_name: string; old_value: JsonValue; new_value: JsonValue }>,
): string {
  const parts: string[] = [];
  for (const diff of diffs) {
    const kind = classifyDiff(diff);
    const name = formatFieldName(diff.field_name);
    if (kind === 'list') {
      const { added, removed } = computeListDiff(diff.old_value, diff.new_value);
      if (added.length === 0 && removed.length === 0) continue;
      let delta: string;
      if (added.length > 0 && removed.length > 0) {
        delta = `+${added.length}/\u2212${removed.length}`;
      } else if (added.length > 0) {
        delta = `+${added.length}`;
      } else {
        delta = `\u2212${removed.length}`;
      }
      parts.push(`${name} ${delta}`);
    } else {
      parts.push(name);
    }
  }
  return parts.join(' \u2022 ');
}
