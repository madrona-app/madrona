/**
 * Projection Resolver - Display Field Resolution
 *
 * This module implements the projection resolution algorithm that resolves
 * canonical field paths to display values for entity rendering.
 *
 * ALGORITHM:
 *   For each role (title, subtitle, thumbnail, snippet):
 *   1. Try dataset-level paths (if present and valid)
 *   2. Fall back to org profile paths
 *   3. Fall back to system defaults
 *
 *   Title must NEVER be blank - ultimate fallback is record.id
 *
 * PATH SYNTAX:
 *   - Simple: "label", "description", "type", "id"
 *   - Nested: "properties.title", "properties.creator.name"
 *   - Array index: "media[0].url", "identifiers[1].value"
 *   - Predicate: "media[role=thumbnail].url", "identifiers[scheme=doi].value"
 */

import type { ScopeProfile, ProjectionConfig, ProjectionProfileScope } from './api';

// =============================================================================
// CONSTANTS - Match backend exactly
// =============================================================================

export const CURRENT_VERSION = '1.0';

export const VALID_SCOPES: readonly ProjectionProfileScope[] = [
  'entity_detail',
  'entities_list',
  'search',
] as const;

export type SemanticRole = 'title' | 'subtitle' | 'thumbnail' | 'snippet';

/**
 * System default fallback chains based on canonical model.
 * These paths are tried in order until a non-empty value is found.
 *
 * Canonical model top-level fields: id, type, label, description, status,
 * canonical_url, identifiers[], classifications[], properties{}, dates{},
 * relationships[], media[], rights{}, extensions[], provenance{}, meta{}
 */
export const DEFAULT_FALLBACKS: Record<SemanticRole, string[]> = {
  // Title: Primary identifier - canonical 'label' is required in canonical schema
  title: [
    'label',                              // Canonical primary label (required field)
    'properties.title',                   // Domain-specific title
    'id',                                 // Ultimate fallback to composite ID
  ],

  // Subtitle: Entity type is most reliable, always present in canonical records
  subtitle: [
    'type',                               // Entity classification (required in canonical)
    'properties.creator',                 // Creator/artist/author
    'description',                        // Description can serve as subtitle
  ],

  // Thumbnail: Media with role preference
  thumbnail: [
    'media[role=thumbnail].url',          // Explicitly marked thumbnail
    'media[0].url',                       // First media item
  ],

  // Snippet: Extended description for search results
  snippet: [
    'description',                        // Canonical description field
    'properties.summary',                 // Summary field
  ],
};

/**
 * System default projection configuration.
 *
 * Note: Pre-extracted entity-level fields (title, thumbnail_url, entity_type)
 * take priority. These payload paths are used as enrichment/overrides when
 * org-level config is set up.
 */
export function getDefaultProjectionConfig(): ProjectionConfig {
  return {
    version: CURRENT_VERSION,
    profiles: {
      entity_detail: {
        title: [...DEFAULT_FALLBACKS.title],
        subtitle: [...DEFAULT_FALLBACKS.subtitle],
        thumbnail: [...DEFAULT_FALLBACKS.thumbnail],
      },
      entities_list: {
        title: [...DEFAULT_FALLBACKS.title],
        subtitle: ['type'],  // Just entity type for compact list view
        thumbnail: [...DEFAULT_FALLBACKS.thumbnail],
      },
      search: {
        title: [...DEFAULT_FALLBACKS.title],
        subtitle: [...DEFAULT_FALLBACKS.subtitle],
        snippet: [...DEFAULT_FALLBACKS.snippet],
        thumbnail: [...DEFAULT_FALLBACKS.thumbnail],
      },
    },
  };
}

// =============================================================================
// PATH RESOLUTION
// =============================================================================

// Regex patterns for path parsing - matches backend
const ARRAY_INDEX_PATTERN = /^(\w+)\[(\d+)\]$/; // media[0]
const PREDICATE_PATTERN = /^(\w+)\[(\w+)=([^\]]+)\]$/; // media[role=thumbnail]

/**
 * Resolve a single path segment against an object.
 *
 * Handles:
 * - Simple property: "label" -> obj["label"]
 * - Array index: "media[0]" -> obj["media"][0]
 * - Predicate: "media[role=thumbnail]" -> first media where role=="thumbnail"
 */
function resolvePathSegment(obj: unknown, segment: string): unknown {
  if (obj === null || obj === undefined) {
    return undefined;
  }

  // Check for array index: fieldName[0]
  const indexMatch = segment.match(ARRAY_INDEX_PATTERN);
  if (indexMatch) {
    const [, fieldName, indexStr] = indexMatch;
    const record = obj as Record<string, unknown>;
    if (typeof record === 'object' && fieldName in record) {
      const arr = record[fieldName];
      if (Array.isArray(arr)) {
        const index = parseInt(indexStr, 10);
        if (index >= 0 && index < arr.length) {
          return arr[index];
        }
      }
    }
    return undefined;
  }

  // Check for predicate: fieldName[key=value]
  const predicateMatch = segment.match(PREDICATE_PATTERN);
  if (predicateMatch) {
    const [, fieldName, predKey, predValue] = predicateMatch;
    const record = obj as Record<string, unknown>;
    if (typeof record === 'object' && fieldName in record) {
      const arr = record[fieldName];
      if (Array.isArray(arr)) {
        // Find first item matching predicate
        for (const item of arr) {
          if (typeof item === 'object' && item !== null) {
            const itemRecord = item as Record<string, unknown>;
            if (itemRecord[predKey] === predValue) {
              return item;
            }
          }
        }
      }
    }
    return undefined;
  }

  // Check for numeric segment (array index via dot notation: arr.0)
  if (/^\d+$/.test(segment)) {
    if (Array.isArray(obj)) {
      const index = parseInt(segment, 10);
      if (index >= 0 && index < obj.length) {
        return obj[index];
      }
    }
    return undefined;
  }

  // Simple property access
  if (typeof obj === 'object') {
    return (obj as Record<string, unknown>)[segment];
  }

  return undefined;
}

/**
 * Resolve a dot-notation path against a canonical record.
 *
 * Examples:
 *   "label" -> record["label"]
 *   "properties.title" -> record["properties"]["title"]
 *   "media[0].url" -> record["media"][0]["url"]
 *   "media[role=thumbnail].url" -> first media where role=="thumbnail", then .url
 */
export function resolvePath(record: Record<string, unknown>, path: string): unknown {
  if (!path || typeof path !== 'string') {
    return undefined;
  }

  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return undefined;
  }

  // Split path and resolve each segment
  const segments = trimmedPath.split('.');
  let current: unknown = record;

  for (const segment of segments) {
    current = resolvePathSegment(current, segment);
    if (current === undefined) {
      return undefined;
    }
  }

  return current;
}

/**
 * Resolve a value from a record using fallback paths.
 *
 * Tries each path in order, returning the first non-empty value.
 * Arrays are joined with ", ".
 */
export function resolveValue(
  record: Record<string, unknown>,
  paths: string[]
): string | undefined {
  for (const path of paths) {
    try {
      const value = resolvePath(record, path);

      if (DEBUG_PROJECTION) {
        console.log(`[Projection Debug] Path "${path}" resolved to:`, value, `(type: ${typeof value})`);
      }

      if (value === null || value === undefined) {
        continue;
      }

      // Handle different value types
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
          if (DEBUG_PROJECTION) {
            console.log(`[Projection Debug] Returning string value from "${path}":`, trimmed);
          }
          return trimmed;
        }
      } else if (Array.isArray(value)) {
        // Join array values with ", "
        const stringValues: string[] = [];
        for (const item of value) {
          if (typeof item === 'string' && item.trim()) {
            stringValues.push(item.trim());
          } else if (typeof item === 'object' && item !== null) {
            // Try to extract a label or value from dict items
            const itemRecord = item as Record<string, unknown>;
            const label =
              itemRecord.label || itemRecord.value || itemRecord.name;
            if (label && typeof label === 'string') {
              stringValues.push(label.trim());
            }
          }
        }
        if (stringValues.length > 0) {
          return stringValues.join(', ');
        }
      } else if (typeof value === 'number') {
        return String(value);
      } else if (typeof value === 'object' && value !== null) {
        // Try to extract label/value from dict
        const objRecord = value as Record<string, unknown>;
        const label = objRecord.label || objRecord.value || objRecord.name;
        if (label && typeof label === 'string') {
          return label.trim();
        }
      }
    } catch {
      // Continue to next path on error
      continue;
    }
  }

  return undefined;
}

// =============================================================================
// MAIN RESOLVER
// =============================================================================

/**
 * Get paths for a role with precedence: dataset -> org -> defaults.
 */
export function getPathsForRoleWithPrecedence(
  role: SemanticRole,
  scope: ProjectionProfileScope,
  datasetProjection?: ScopeProfile | null,
  orgConfig?: ProjectionConfig | null
): string[] {
  // 1. Dataset-level paths (highest precedence)
  if (datasetProjection) {
    const paths = datasetProjection[role];
    if (paths && Array.isArray(paths) && paths.length > 0) {
      return paths;
    }
  }

  // 2. Org-level paths
  if (orgConfig?.profiles?.[scope]) {
    const profile = orgConfig.profiles[scope];
    const paths = profile[role];
    if (paths && Array.isArray(paths) && paths.length > 0) {
      return paths;
    }
  }

  // 3. System defaults
  const defaults = getDefaultProjectionConfig();
  const defaultProfile = defaults.profiles[scope];
  if (defaultProfile) {
    const paths = defaultProfile[role];
    if (paths && Array.isArray(paths)) {
      return paths;
    }
  }

  // Ultimate fallback to DEFAULT_FALLBACKS
  return DEFAULT_FALLBACKS[role] || [];
}

/**
 * Display fields result type.
 */
export interface DisplayFields {
  title: string;
  subtitle?: string;
  thumbnailUrl?: string;
  snippet?: string;
}

/**
 * Resolve display fields for a canonical record.
 *
 * Applies projection configuration with precedence:
 * 1. Dataset-level paths (if present and valid)
 * 2. Org profile paths
 * 3. System defaults
 *
 * Title is guaranteed to never be blank - falls back to record.id.
 *
 * @param record - Canonical record dict (entity.payload)
 * @param scope - Scope name (entity_detail, entities_list, search)
 * @param datasetProjection - Optional dataset-level projection config
 * @param orgConfig - Optional org-level projection config
 * @returns Display fields object
 */
export function resolveDisplayFields(
  record: Record<string, unknown> | null | undefined,
  scope: ProjectionProfileScope,
  datasetProjection?: ScopeProfile | null,
  orgConfig?: ProjectionConfig | null
): DisplayFields {
  // Handle null/undefined record
  if (!record || typeof record !== 'object') {
    return { title: 'Unknown' };
  }

  // Validate scope - default to entity_detail if invalid
  if (!VALID_SCOPES.includes(scope)) {
    console.warn(`Invalid scope '${scope}', using 'entity_detail'`);
    scope = 'entity_detail';
  }

  const result: DisplayFields = { title: '' };

  // Resolve title (required, never blank)
  const titlePaths = getPathsForRoleWithPrecedence(
    'title',
    scope,
    datasetProjection,
    orgConfig
  );
  if (DEBUG_PROJECTION) {
    console.log('[Projection Debug] Title paths:', titlePaths);
  }
  let title = resolveValue(record, titlePaths);
  if (DEBUG_PROJECTION) {
    console.log('[Projection Debug] Title resolved to:', title);
  }

  // Title fallback: record.id
  if (!title) {
    title = record.id as string | undefined;
    if (DEBUG_PROJECTION && title) {
      console.log('[Projection Debug] Title fell back to record.id:', title);
    }
  }

  // Ultimate fallback
  if (!title) {
    title = 'Untitled';
    if (DEBUG_PROJECTION) {
      console.log('[Projection Debug] Title fell back to "Untitled"');
    }
  }

  result.title = title;

  // Resolve subtitle (optional)
  const subtitlePaths = getPathsForRoleWithPrecedence(
    'subtitle',
    scope,
    datasetProjection,
    orgConfig
  );
  if (DEBUG_PROJECTION) {
    console.log('[Projection Debug] Subtitle paths:', subtitlePaths);
  }
  const subtitle = resolveValue(record, subtitlePaths);
  if (DEBUG_PROJECTION) {
    console.log('[Projection Debug] Subtitle resolved to:', subtitle);
  }
  if (subtitle) {
    result.subtitle = subtitle;
  }

  // Resolve thumbnail (optional)
  const thumbnailPaths = getPathsForRoleWithPrecedence(
    'thumbnail',
    scope,
    datasetProjection,
    orgConfig
  );
  if (DEBUG_PROJECTION) {
    console.log('[Projection Debug] Thumbnail paths:', thumbnailPaths);
  }
  const thumbnailUrl = resolveValue(record, thumbnailPaths);
  if (DEBUG_PROJECTION) {
    console.log('[Projection Debug] Thumbnail resolved to:', thumbnailUrl);
  }
  if (thumbnailUrl) {
    result.thumbnailUrl = thumbnailUrl;
  }

  // Resolve snippet (optional, typically only for search scope)
  const snippetPaths = getPathsForRoleWithPrecedence(
    'snippet',
    scope,
    datasetProjection,
    orgConfig
  );
  const snippet = resolveValue(record, snippetPaths);
  if (snippet) {
    result.snippet = snippet;
  }

  return result;
}

/**
 * Helper to resolve display fields for an entity object.
 *
 * Automatically extracts payload from entity and applies fallbacks
 * using entity-level fields when payload resolution fails.
 *
 * Handles both Entity (list) and EntityDetail (detail) shapes:
 * - Entity: title, thumbnail_url at top level
 * - EntityDetail: title, thumbnail_url in nested fields object
 */
// Debug flag - set to true to enable console logging during development
const DEBUG_PROJECTION = false;

export function resolveEntityDisplayFields(
  entity: {
    payload?: Record<string, unknown>;
    entity_key?: string;
    entity_type?: string;
    // Top-level fields (Entity from list endpoints)
    title?: string | null;
    thumbnail_url?: string | null;
    // Nested fields (EntityDetail from detail endpoint)
    fields?: {
      title?: string | null;
      thumbnail_url?: string | null;
      object_number?: string | null;
      modified_at?: string | null;
    };
  } | null | undefined,
  scope: ProjectionProfileScope,
  datasetProjection?: ScopeProfile | null,
  orgConfig?: ProjectionConfig | null
): DisplayFields {
  if (!entity) {
    return { title: 'Unknown' };
  }

  // Extract pre-extracted fields from either top-level (Entity) or nested (EntityDetail)
  const preExtractedTitle = entity.title ?? entity.fields?.title;
  const preExtractedThumbnail = entity.thumbnail_url ?? entity.fields?.thumbnail_url;

  if (DEBUG_PROJECTION) {
    console.log('[Projection Debug] Entity:', entity.entity_key);
    console.log('[Projection Debug] Scope:', scope);
    console.log('[Projection Debug] Pre-extracted title:', preExtractedTitle);
    console.log('[Projection Debug] Pre-extracted thumbnail:', preExtractedThumbnail);
    console.log('[Projection Debug] entity.entity_type:', entity.entity_type);
    console.log('[Projection Debug] Payload keys:', entity.payload ? Object.keys(entity.payload) : 'no payload');
    console.log('[Projection Debug] Payload.label:', entity.payload?.label);
    console.log('[Projection Debug] Payload.type:', entity.payload?.type);
    console.log('[Projection Debug] Org config:', orgConfig ? 'custom' : 'defaults');
  }

  // PRIORITY 1: Use pre-extracted entity-level fields (from backend EntityField table)
  // These are reliable and already computed by the backend during ingestion
  const result: DisplayFields = {
    title: preExtractedTitle || entity.entity_key || 'Untitled',
  };

  if (preExtractedThumbnail) {
    result.thumbnailUrl = preExtractedThumbnail;
  }

  if (entity.entity_type) {
    result.subtitle = entity.entity_type;
  }

  if (DEBUG_PROJECTION) {
    console.log('[Projection Debug] Initial result (before payload resolution):', { ...result });
  }

  // PRIORITY 2: Try to enrich from payload using configured paths
  // This allows org-level config to override/enhance display fields
  if (entity.payload && Object.keys(entity.payload).length > 0) {
    const payloadResolved = resolveDisplayFields(
      entity.payload,
      scope,
      datasetProjection,
      orgConfig
    );

    if (DEBUG_PROJECTION) {
      console.log('[Projection Debug] Payload resolved:', payloadResolved);
    }

    // Only override if payload resolution found actual values (not fallbacks)
    if (payloadResolved.title && payloadResolved.title !== 'Untitled' && payloadResolved.title !== 'Unknown') {
      result.title = payloadResolved.title;
    }

    if (payloadResolved.subtitle) {
      result.subtitle = payloadResolved.subtitle;
    }

    if (payloadResolved.thumbnailUrl) {
      result.thumbnailUrl = payloadResolved.thumbnailUrl;
    }

    if (payloadResolved.snippet) {
      result.snippet = payloadResolved.snippet;
    }
  }

  if (DEBUG_PROJECTION) {
    console.log('[Projection Debug] FINAL result:', result);
    console.log('[Projection Debug] ---');
  }

  return result;
}
