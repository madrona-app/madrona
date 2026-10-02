/**
 * Projection service for fetching and caching dataset projections.
 * 
 * Handles:
 * - Fetching projections from the API
 * - Building default projections when none exist
 * - Caching projections per dataset
 */

import type { Projection, ProjectionScope } from '../types/projection';
import { getDatasetProjections, getDatasetSchema } from './api';
import { buildDefaultProjection } from './projectionBuilder';
import { logger } from './logger';

/**
 * Cache for projections by dataset ID.
 */
const projectionsCache = new Map<string, {
  entities_list?: Projection;
  entity_detail?: Projection;
  schemaJson?: Record<string, any>;
}>();

/**
 * Get a projection for a dataset, fetching from API or building a default.
 * 
 * @param datasetId The dataset ID
 * @param scope The projection scope
 * @returns The projection
 */
export async function getProjection(
  datasetId: string,
  scope: ProjectionScope
): Promise<Projection> {
  // Check cache first
  const cached = projectionsCache.get(datasetId);
  if (cached && cached[scope]) {
    return cached[scope]!;
  }
  
  // Fetch from API
  try {
    const projections = await getDatasetProjections(datasetId);
    
    // Fetch schema if needed for default projection
    let schemaJson: Record<string, any> | undefined;
    if (!projections[scope]) {
      try {
        const schemaData = await getDatasetSchema(datasetId);
        schemaJson = schemaData.schema_ref.schema_json;
      } catch (e) {
        logger.warn(`Failed to fetch schema for dataset ${datasetId}:`, e);
        schemaJson = undefined;
      }
    }
    
    // Cache the results
    projectionsCache.set(datasetId, {
      entities_list: projections.entities_list || undefined,
      entity_detail: projections.entity_detail || undefined,
      schemaJson
    });
    
    // Return projection or build default
    if (projections[scope]) {
      return projections[scope]!;
    }
    
    // Build default projection
    const defaultProjection = buildDefaultProjection(schemaJson, scope, datasetId);
    
    // Cache the default
    const cacheEntry = projectionsCache.get(datasetId)!;
    cacheEntry[scope] = defaultProjection;
    
    return defaultProjection;
    
  } catch (error) {
    logger.error(`Failed to fetch projections for dataset ${datasetId}:`, error);
    
    // Attempt to fetch schema and build default
    try {
      const schemaData = await getDatasetSchema(datasetId);
      const schemaJson = schemaData.schema_ref.schema_json;
      
      const defaultProjection = buildDefaultProjection(schemaJson, scope, datasetId);
      
      // Cache it
      projectionsCache.set(datasetId, {
        [scope]: defaultProjection,
        schemaJson
      });
      
      return defaultProjection;
    } catch (schemaError) {
      logger.error(`Failed to fetch schema for dataset ${datasetId}:`, schemaError);
      
      // Return minimal default with no schema
      return buildDefaultProjection(undefined, scope, datasetId);
    }
  }
}

/**
 * Clear the projections cache for a dataset.
 */
export function clearProjectionCache(datasetId?: string): void {
  if (datasetId) {
    projectionsCache.delete(datasetId);
  } else {
    projectionsCache.clear();
  }
}

/**
 * Preload projections for a dataset (useful for prefetching).
 */
export async function preloadProjections(datasetId: string): Promise<void> {
  await Promise.all([
    getProjection(datasetId, 'entities_list'),
    getProjection(datasetId, 'entity_detail')
  ]);
}
