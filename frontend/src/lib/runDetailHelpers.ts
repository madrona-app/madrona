/**
 * Helper functions for RunDetailPage
 * Extracted for testability and reuse
 *
 * Field Type Classification for Canonical Audit View:
 * - SCALAR: label, description, rights, status → Full Before/After
 * - STRUCTURED: properties, classifications, relationships → Key-level diffs
 * - MEDIA: media → Add/remove/changed summary
 * - METADATA: meta, provenance → Hidden by default (Technical tab only)
 */

/**
 * Field type classification for diff strategy selection.
 * Determines how each field should be rendered in the audit view.
 */
export type FieldDiffType = 'scalar' | 'structured' | 'media' | 'metadata';

/**
 * Metadata fields that should be hidden by default in the Changes tab.
 * These are only shown in the Technical tab for full transparency.
 */
export const METADATA_FIELDS = new Set(['meta', 'provenance', 'ingestedAt', 'createdAt', 'updatedAt']);

/**
 * Structured fields that use semantic key-level diffing.
 */
export const STRUCTURED_FIELDS = new Set(['properties', 'classifications', 'relationships', 'identifiers', 'extensions']);

/**
 * Media array fields that use entry-level diffing.
 */
export const MEDIA_FIELDS = new Set(['media']);

/**
 * Scalar identity fields that use full Before/After display.
 */
export const SCALAR_FIELDS = new Set(['label', 'description', 'rights', 'status', 'type', 'id']);

/**
 * Determines the diff type for a given field name.
 * This controls how the field is rendered in the audit view.
 */
export function getFieldDiffType(fieldName: string): FieldDiffType {
  if (METADATA_FIELDS.has(fieldName)) return 'metadata';
  if (MEDIA_FIELDS.has(fieldName)) return 'media';
  if (STRUCTURED_FIELDS.has(fieldName)) return 'structured';
  return 'scalar';
}

/**
 * Checks if a field should be visible in the default Changes view.
 * Metadata fields are hidden by default for cleaner audit presentation.
 */
export function isFieldVisibleByDefault(fieldName: string): boolean {
  return !METADATA_FIELDS.has(fieldName);
}

/**
 * Computes shallow key-level diffs for objects.
 * Returns arrays of added, removed, and changed keys.
 */
export function diffObjectKeys(
  beforeObj: Record<string, unknown> | null | undefined,
  afterObj: Record<string, unknown> | null | undefined
): {
  added: string[];
  removed: string[];
  changed: Array<{ key: string; oldVal: unknown; newVal: unknown }>;
} {
  const before = beforeObj ?? {};
  const after = afterObj ?? {};
  const beforeKeys = new Set(Object.keys(before));
  const afterKeys = new Set(Object.keys(after));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: Array<{ key: string; oldVal: unknown; newVal: unknown }> = [];

  // Keys only in after = added
  for (const key of afterKeys) {
    if (!beforeKeys.has(key)) {
      added.push(key);
    }
  }

  // Keys only in before = removed
  for (const key of beforeKeys) {
    if (!afterKeys.has(key)) {
      removed.push(key);
    }
  }

  // Keys in both = check if changed
  for (const key of beforeKeys) {
    if (afterKeys.has(key)) {
      const oldVal = before[key];
      const newVal = after[key];
      // Use JSON.stringify for deep comparison (simple approach for v1)
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changed.push({ key, oldVal, newVal });
      }
    }
  }

  return { added, removed, changed };
}

/**
 * Checks if a value is a non-null object (for rendering object diffs)
 */
export function isObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

/**
 * Formats a value for display in the diff view.
 * For primitives, returns the value. For objects/arrays, returns JSON.
 */
export function formatDiffValue(val: unknown): string {
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (typeof val === 'string') return `"${val}"`;
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

/**
 * Normalizes canonical type for display.
 * Converts lowercase types to title case to match canonical vocabulary.
 * Known canonical types: Object, Work, Collection, Agent, Place, Concept, Event
 */
export function normalizeCanonicalType(entityType: string | null | undefined): string {
  if (!entityType) return 'Unknown';

  // Known canonical types with their display forms
  const canonicalTypes: Record<string, string> = {
    object: 'Object',
    work: 'Work',
    collection: 'Collection',
    agent: 'Agent',
    place: 'Place',
    concept: 'Concept',
    event: 'Event',
    record: 'Record',
    asset: 'Asset',
  };

  const lowered = entityType.toLowerCase();
  if (canonicalTypes[lowered]) {
    return canonicalTypes[lowered];
  }

  // Fallback: title case the input
  return entityType.charAt(0).toUpperCase() + entityType.slice(1).toLowerCase();
}

/**
 * Resolves the change source for display based on available provenance data.
 * Priority order:
 * 1. mappingId (if present) → "Mapping rule"
 * 2. transformId (if present) → "Transformer"
 * 3. pipeline_name (pipeline context) → "Pipeline run"
 * 4. dataset_name (source context) → "Source-triggered"
 * 5. Default fallback → "System update"
 *
 * Note: mappingId and transformId are not currently returned by the API.
 * When backend adds these fields, this resolver will automatically use them.
 */
export function resolveChangeSource(
  change: {
    pipeline_name?: string | null;
    dataset_name?: string | null;
    // Future fields - uncomment when backend provides them:
    // mappingId?: string | null;
    // transformId?: string | null;
  }
): string {
  // Future: check change.mappingId, change.transformId from provenance
  // if (change.mappingId) return 'Mapping rule';
  // if (change.transformId) return 'Transformer';

  if (change.pipeline_name) {
    return 'Pipeline run';
  }
  if (change.dataset_name) {
    return 'Source-triggered';
  }
  return 'System update';
}

/**
 * Media entry interface for diff computation.
 */
interface MediaEntry {
  url?: string;
  role?: string;
  type?: string;
  [key: string]: unknown;
}

/**
 * Computes diffs for media arrays.
 * Media entries are identified by URL; changes are detected by comparing other fields.
 */
export function diffMediaArray(
  beforeArr: MediaEntry[] | null | undefined,
  afterArr: MediaEntry[] | null | undefined
): {
  added: MediaEntry[];
  removed: MediaEntry[];
  changed: Array<{ before: MediaEntry; after: MediaEntry; changedFields: string[] }>;
} {
  const before = beforeArr ?? [];
  const after = afterArr ?? [];

  // Index entries by URL for comparison
  const beforeByUrl = new Map<string, MediaEntry>();
  const afterByUrl = new Map<string, MediaEntry>();

  for (const entry of before) {
    if (entry.url) beforeByUrl.set(entry.url, entry);
  }
  for (const entry of after) {
    if (entry.url) afterByUrl.set(entry.url, entry);
  }

  const added: MediaEntry[] = [];
  const removed: MediaEntry[] = [];
  const changed: Array<{ before: MediaEntry; after: MediaEntry; changedFields: string[] }> = [];

  // Find added entries (in after but not in before)
  for (const [url, entry] of afterByUrl) {
    if (!beforeByUrl.has(url)) {
      added.push(entry);
    }
  }

  // Find removed entries (in before but not in after)
  for (const [url, entry] of beforeByUrl) {
    if (!afterByUrl.has(url)) {
      removed.push(entry);
    }
  }

  // Find changed entries (same URL but different content)
  for (const [url, beforeEntry] of beforeByUrl) {
    const afterEntry = afterByUrl.get(url);
    if (afterEntry) {
      const changedFields: string[] = [];
      const allKeys = new Set([...Object.keys(beforeEntry), ...Object.keys(afterEntry)]);
      for (const key of allKeys) {
        if (key !== 'url' && JSON.stringify(beforeEntry[key]) !== JSON.stringify(afterEntry[key])) {
          changedFields.push(key);
        }
      }
      if (changedFields.length > 0) {
        changed.push({ before: beforeEntry, after: afterEntry, changedFields });
      }
    }
  }

  return { added, removed, changed };
}

/**
 * Generates a human-readable summary for media changes.
 */
export function summarizeMediaChanges(diff: ReturnType<typeof diffMediaArray>): string {
  const parts: string[] = [];
  if (diff.added.length > 0) {
    parts.push(`+${diff.added.length} added`);
  }
  if (diff.removed.length > 0) {
    parts.push(`−${diff.removed.length} removed`);
  }
  if (diff.changed.length > 0) {
    parts.push(`~${diff.changed.length} modified`);
  }
  return parts.length > 0 ? parts.join(', ') : 'No changes';
}

/**
 * Gets a display label for a media entry (role or type or URL).
 */
export function getMediaEntryLabel(entry: MediaEntry): string {
  if (entry.role) return entry.role;
  if (entry.type) return entry.type;
  if (entry.url) {
    // Extract filename from URL
    try {
      const url = new URL(entry.url);
      const pathname = url.pathname;
      return pathname.split('/').pop() || entry.url;
    } catch {
      return entry.url.substring(0, 40) + (entry.url.length > 40 ? '...' : '');
    }
  }
  return 'media';
}
