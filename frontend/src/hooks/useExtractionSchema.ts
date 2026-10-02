/**
 * Hook for fetching extraction configuration schemas.
 *
 * This hook provides access to the JSON Schema definitions that describe
 * how to configure data extraction from database connectors. The schema
 * is used to render dynamic forms for PipelineSource.parameters configuration.
 *
 * Usage:
 *   const { schema, isLoading } = useExtractionSchema('db-sqlserver');
 *   // schema.extractionSchema - Main extraction config schema
 *   // schema.objectSchema - Schema for individual extraction objects
 *   // schema.columnMappingSchema - Schema for column mappings
 */

import { useQuery } from '@tanstack/react-query';
import { getExtractionSchema, listExtractionSchemas, type ExtractionSchema } from '../lib/api';

interface UseExtractionSchemaResult {
  /** The extraction schema for the connector */
  schema: ExtractionSchema | null;
  /** Whether the schema is loading */
  isLoading: boolean;
  /** Any error that occurred */
  error: Error | null;
  /** Whether this connector supports extraction configuration */
  hasExtractionSchema: boolean;
}

/**
 * Fetch the extraction schema for a specific connector definition.
 *
 * @param definitionKey - The connector definition key (e.g., 'db-sqlserver')
 * @returns Extraction schema and loading state
 */
export function useExtractionSchema(definitionKey: string | null): UseExtractionSchemaResult {
  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['extraction-schema', definitionKey],
    queryFn: () => getExtractionSchema(definitionKey!),
    enabled: !!definitionKey,
    // Cache for 30 minutes - schemas rarely change
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });

  if (!definitionKey || isLoading || error || !data) {
    return {
      schema: null,
      isLoading: isLoading && !!definitionKey,
      error: error as Error | null,
      hasExtractionSchema: false,
    };
  }

  return {
    schema: data,
    isLoading: false,
    error: null,
    hasExtractionSchema: !!data.extractionSchema,
  };
}

interface UseExtractionSchemasResult {
  /** All available extraction schemas */
  schemas: ExtractionSchema[];
  /** Whether schemas are loading */
  isLoading: boolean;
  /** Any error that occurred */
  error: Error | null;
}

/**
 * Fetch all available extraction schemas, optionally filtered by direction.
 *
 * @param direction - Filter by connector direction ('source', 'target', 'both')
 * @returns List of extraction schemas and loading state
 */
export function useExtractionSchemas(direction?: 'source' | 'target' | 'both'): UseExtractionSchemasResult {
  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['extraction-schemas', direction],
    queryFn: () => listExtractionSchemas(direction),
    // Cache for 30 minutes
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });

  return {
    schemas: data?.schemas || [],
    isLoading,
    error: error as Error | null,
  };
}
