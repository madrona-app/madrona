/**
 * CanonicalRecord Builder Utilities - Usage Examples
 * 
 * Demonstrates safe record construction patterns.
 */

import type { CanonicalRecord } from '../types/canonical';
import {
  setPath,
  appendPath,
  ensureArray,
  isReservedPath,
  getReservedKeys,
  safeMerge,
  CanonicalBuilderError,
} from './builder';

/**
 * Example 1: Building a complete artwork record
 */
export function buildArtworkRecord() {
  const record: Partial<CanonicalRecord> = {};
  
  // Set basic descriptive fields
  setPath(record, 'description', 'Starry Night by Vincent van Gogh');
  
  // Set structured properties
  setPath(record, 'properties.medium', 'Oil on canvas');
  setPath(record, 'properties.dimensions.width', 73.7);
  setPath(record, 'properties.dimensions.height', 92.1);
  setPath(record, 'properties.dimensions.unit', 'cm');
  
  // Add dates
  setPath(record, 'dates.created', '1889-06');
  setPath(record, 'dates.capturedAt', new Date().toISOString());
  
  // Build identifiers array
  appendPath(record, 'identifiers', {
    scheme: 'accession',
    value: '1962.116'
  });
  appendPath(record, 'identifiers', {
    scheme: 'uri',
    value: 'https://www.moma.org/collection/works/79802'
  });
  
  // Add classifications
  ensureArray(record, 'classifications');
  appendPath(record, 'classifications', {
    scheme: 'aat',
    id: '300033618',
    label: 'Paintings'
  });
  
  // Add relationships
  appendPath(record, 'relationships', {
    type: 'created_by',
    target: 'person_vangogh'
  });
  
  return record;
}

/**
 * Example 2: Safe merging with external data
 */
export function mergeExternalData(record: Partial<CanonicalRecord>, externalData: any) {
  // Merge safely - reserved fields are skipped
  const warnings = safeMerge(record, externalData);
  
  if (warnings.length > 0) {
    console.warn('Skipped reserved fields:', warnings);
  }
  
  return record;
}

/**
 * Example 3: Dynamic field updates with validation
 */
export function setDynamicField(
  record: Partial<CanonicalRecord>,
  path: string,
  value: any
): boolean {
  // Pre-validate path
  if (isReservedPath(path)) {
    console.error(`Cannot set reserved path: ${path}`);
    return false;
  }
  
  try {
    setPath(record, path, value);
    return true;
  } catch (error) {
    if (error instanceof CanonicalBuilderError) {
      console.error(`Failed to set ${error.path}: ${error.reason}`);
    }
    return false;
  }
}

/**
 * Example 4: Building relationships array
 */
export function addCreatorRelationships(
  record: Partial<CanonicalRecord>,
  creators: Array<{ id: string; role: string }>
) {
  ensureArray(record, 'relationships');
  
  for (const creator of creators) {
    appendPath(record, 'relationships', {
      type: creator.role === 'artist' ? 'created_by' : 'attributed_to',
      target: `person_${creator.id}`
    });
  }
}

/**
 * Example 5: Conditional field population
 */
export function populateOptionalFields(
  record: Partial<CanonicalRecord>,
  sourceData: any
) {
  // Always ensure arrays exist
  ensureArray(record, 'identifiers');
  ensureArray(record, 'classifications');
  
  // Conditionally add fields
  if (sourceData.title) {
    setPath(record, 'description', sourceData.title);
  }
  
  if (sourceData.medium) {
    setPath(record, 'properties.medium', sourceData.medium);
  }
  
  if (sourceData.date) {
    setPath(record, 'dates.created', sourceData.date);
  }
  
  // Add identifiers if present
  if (sourceData.accessionNumber) {
    appendPath(record, 'identifiers', {
      scheme: 'acc',
      value: sourceData.accessionNumber
    });
  }
}

/**
 * Example 6: Updating existing array elements
 */
export function updateArrayElement(
  record: Partial<CanonicalRecord>,
  arrayPath: string,
  index: number,
  fieldPath: string,
  value: any
) {
  try {
    // Update specific field in array element
    setPath(record, `${arrayPath}[${index}].${fieldPath}`, value);
  } catch (error) {
    if (error instanceof CanonicalBuilderError) {
      console.error(`Failed to update ${arrayPath}[${index}]: ${error.reason}`);
    }
  }
}

/**
 * Example 7: Guarding system fields
 */
export function attemptUnsafeWrites() {
  const record: Partial<CanonicalRecord> = {};
  
  console.log('Reserved keys:', getReservedKeys());
  
  // These will all throw errors
  try {
    setPath(record, 'id', 'obj_123');
  } catch (error) {
    console.log('✗ Cannot set id:', (error as Error).message);
  }
  
  try {
    setPath(record, 'provenance', { source: 'test' });
  } catch (error) {
    console.log('✗ Cannot set provenance:', (error as Error).message);
  }
  
  try {
    setPath(record, 'meta', { schemaVersion: '2.0' });
  } catch (error) {
    console.log('✗ Cannot set meta:', (error as Error).message);
  }
  
  // This works - not a reserved field
  setPath(record, 'description', 'Safe field');
  console.log('✓ Set description successfully');
}

/**
 * Example 8: Building extensions safely
 */
export function addExtensions(
  record: Partial<CanonicalRecord>,
  extensions: Array<{ namespace: string; data: any }>
) {
  ensureArray(record, 'extensions');
  
  for (const ext of extensions) {
    appendPath(record, 'extensions', {
      namespace: ext.namespace,
      data: ext.data
    });
  }
}

/**
 * Example 9: Nested property building
 */
export function buildDimensionsObject(
  record: Partial<CanonicalRecord>,
  dimensions: { width?: number; height?: number; depth?: number; unit: string }
) {
  if (dimensions.width) {
    setPath(record, 'properties.dimensions.width', dimensions.width);
  }
  if (dimensions.height) {
    setPath(record, 'properties.dimensions.height', dimensions.height);
  }
  if (dimensions.depth) {
    setPath(record, 'properties.dimensions.depth', dimensions.depth);
  }
  setPath(record, 'properties.dimensions.unit', dimensions.unit);
}

/**
 * Example 10: Complete integration with mapping DSL
 */
export function transformSourceRecord(sourceData: any): Partial<CanonicalRecord> {
  const record: Partial<CanonicalRecord> = {};
  
  // Use setPath for simple mappings
  if (sourceData.title) {
    setPath(record, 'description', sourceData.title);
  }
  
  // Use appendPath for array fields
  if (sourceData.creators) {
    ensureArray(record, 'relationships');
    sourceData.creators.forEach((creator: any) => {
      appendPath(record, 'relationships', {
        type: 'created_by',
        target: `person_${creator.id}`
      });
    });
  }
  
  // Use safeMerge for bulk properties
  if (sourceData.properties) {
    safeMerge(
      record.properties || {},
      sourceData.properties
    );
    if (record.properties) {
      setPath(record, 'properties', record.properties);
    }
  }
  
  return record;
}
