/**
 * Default projection builder.
 * 
 * Generates deterministic projections when none are configured for a dataset.
 * Uses schema analysis to identify common identity fields and select appropriate
 * display fields.
 */

import type { Projection, ProjectionScope, FieldSpec } from '../types/projection';

/**
 * Common identity field paths to try (in order of preference).
 */
const IDENTITY_PATHS = {
  title: ['spine.title', 'title', 'label', 'name'],
  type: ['spine.entity_type', 'entity_type', 'type'],
  source_system: ['source.system', 'source_system', 'system'],
  source_id: ['source.identifier', 'source_id', 'identifier', 'id'],
  updated: ['updated_at', 'modified_at', 'modified', 'last_updated']
};

/**
 * Build a default projection for a dataset when none is configured.
 * 
 * @param schemaJson The JSON Schema for the dataset
 * @param scope The projection scope (entities_list | entity_detail)
 * @param datasetId The dataset ID
 * @returns A default projection
 */
export function buildDefaultProjection(
  schemaJson: Record<string, any> | null | undefined,
  scope: ProjectionScope,
  datasetId: string
): Projection {
  const fields: FieldSpec[] = [];
  
  if (scope === 'entities_list') {
    fields.push(...buildListFields(schemaJson));
  } else {
    fields.push(...buildDetailFields(schemaJson));
  }
  
  return {
    projection_id: `default-${scope}-${datasetId}`,
    dataset_id: datasetId,
    scope,
    schema_ref: {
      schema_id: `dataset-${datasetId}`,
      schema_version: '1.0',
      schema_json: schemaJson || undefined
    },
    mode: 'hybrid',
    fields
  };
}

/**
 * Build fields for entities_list scope (4-6 identity columns max).
 */
function buildListFields(schemaJson: Record<string, any> | null | undefined): FieldSpec[] {
  const fields: FieldSpec[] = [];
  const properties = schemaJson?.properties || {};
  
  // Try to add title field (primary)
  const titlePath = findFirstExistingPath(IDENTITY_PATHS.title, properties);
  if (titlePath) {
    fields.push({
      key: 'title',
      path: titlePath,
      label: 'Title',
      kind: 'text',
      primary: true,
      visible: true,
      width: 'wide',
      allow_empty: true
    });
  }
  
  // Try to add type field
  const typePath = findFirstExistingPath(IDENTITY_PATHS.type, properties);
  if (typePath) {
    fields.push({
      key: 'type',
      path: typePath,
      label: 'Type',
      kind: 'badge',
      visible: true,
      width: 'narrow',
      allow_empty: true
    });
  }
  
  // Try to add source system
  const sourcePath = findFirstExistingPath(IDENTITY_PATHS.source_system, properties);
  if (sourcePath) {
    fields.push({
      key: 'source_system',
      path: sourcePath,
      label: 'Source',
      kind: 'text',
      visible: true,
      width: 'narrow',
      allow_empty: true
    });
  }
  
  // Try to add updated timestamp
  const updatedPath = findFirstExistingPath(IDENTITY_PATHS.updated, properties);
  if (updatedPath) {
    fields.push({
      key: 'updated',
      path: updatedPath,
      label: 'Updated',
      kind: 'datetime',
      visible: true,
      width: 'auto',
      allow_empty: true
    });
  }
  
  // If no title was found, mark first field as primary
  if (fields.length > 0 && !fields.some(f => f.primary)) {
    fields[0].primary = true;
  }
  
  // Add a few additional string fields from schema (max 2-3 more)
  const additionalFields = selectAdditionalFields(properties, fields, 2);
  fields.push(...additionalFields);
  
  return fields;
}

/**
 * Build fields for entity_detail scope (10-20 fields max).
 */
function buildDetailFields(schemaJson: Record<string, any> | null | undefined): FieldSpec[] {
  const fields: FieldSpec[] = [];
  const properties = schemaJson?.properties || {};
  
  // Start with identity fields
  const identityFields = buildListFields(schemaJson);
  fields.push(...identityFields.map(f => ({ ...f, primary: false, width: undefined })));
  
  // Add more detailed fields (up to 15 additional)
  const additionalFields = selectAdditionalFields(properties, fields, 15);
  fields.push(...additionalFields);
  
  return fields;
}

/**
 * Find the first path that exists in the schema properties.
 */
function findFirstExistingPath(
  paths: string[],
  properties: Record<string, any>
): string | null {
  for (const path of paths) {
    if (pathExistsInProperties(path, properties)) {
      return path;
    }
  }
  return null;
}

/**
 * Check if a path exists in schema properties.
 * Handles nested paths like "spine.title".
 */
function pathExistsInProperties(path: string, properties: Record<string, any>): boolean {
  const parts = path.split('.');
  let current = properties;
  
  for (const part of parts) {
    if (!current || typeof current !== 'object') {
      return false;
    }
    
    if (part in current) {
      current = current[part];
    } else if (current.properties && part in current.properties) {
      current = current.properties[part];
    } else {
      return false;
    }
  }
  
  return true;
}

/**
 * Select additional fields from schema (prefer simple types, exclude objects).
 */
function selectAdditionalFields(
  properties: Record<string, any>,
  existingFields: FieldSpec[],
  maxCount: number
): FieldSpec[] {
  const fields: FieldSpec[] = [];
  const existingPaths = new Set(existingFields.map(f => f.path));
  
  // Get all property paths
  const allPaths = extractPropertyPaths(properties);
  
  // Filter out existing paths and complex types
  const candidates = allPaths.filter(({ path, type }) => {
    if (existingPaths.has(path)) {
      return false;
    }
    
    // Prefer simple types
    return type === 'string' || type === 'number' || type === 'boolean' || type === 'date';
  });
  
  // Take first N candidates
  for (let i = 0; i < Math.min(candidates.length, maxCount); i++) {
    const { path, type } = candidates[i];
    const key = path.replace(/\./g, '_');
    const label = pathToLabel(path);
    
    fields.push({
      key,
      path,
      label,
      kind: mapTypeToKind(type),
      visible: true,
      allow_empty: true
    });
  }
  
  return fields;
}

/**
 * Extract all property paths from a JSON Schema.
 */
function extractPropertyPaths(
  properties: Record<string, any>,
  prefix: string = ''
): Array<{ path: string; type: string }> {
  const paths: Array<{ path: string; type: string }> = [];
  
  for (const [key, value] of Object.entries(properties)) {
    const path = prefix ? `${prefix}.${key}` : key;
    
    if (value && typeof value === 'object') {
      const type = value.type;
      
      if (type === 'object' && value.properties) {
        // Recurse into nested objects (but limit depth)
        if (prefix.split('.').length < 2) {
          paths.push(...extractPropertyPaths(value.properties, path));
        }
      } else {
        paths.push({ path, type: type || 'string' });
      }
    } else {
      paths.push({ path, type: 'string' });
    }
  }
  
  return paths;
}

/**
 * Convert a path to a human-readable label.
 */
function pathToLabel(path: string): string {
  const parts = path.split('.');
  const lastPart = parts[parts.length - 1];
  
  // Convert snake_case or camelCase to Title Case
  return lastPart
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Map JSON Schema type to FieldKind.
 */
function mapTypeToKind(type: string): 'text' | 'number' | 'boolean' | 'datetime' | 'json' {
  switch (type) {
    case 'string':
      return 'text';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'date':
    case 'date-time':
      return 'datetime';
    case 'object':
    case 'array':
      return 'json';
    default:
      return 'text';
  }
}
