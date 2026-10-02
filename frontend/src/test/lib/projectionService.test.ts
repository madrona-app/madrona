import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getProjection,
  clearProjectionCache,
  preloadProjections,
} from '../../lib/projectionService';
import * as api from '../../lib/api';
import type { Projection } from '../../types/projection';

// Mock the API functions
vi.mock('../../lib/api', () => ({
  getDatasetProjections: vi.fn(),
  getDatasetSchema: vi.fn(),
}));

// Mock the projection builder
vi.mock('../../lib/projectionBuilder', () => ({
  buildDefaultProjection: vi.fn((_schema, scope, datasetId) => ({
    projection_id: `default-${scope}-${datasetId}`,
    scope,
    dataset_id: datasetId,
    fields: [],
    is_default: true,
  })),
}));

const mockGetDatasetProjections = vi.mocked(api.getDatasetProjections);
const mockGetDatasetSchema = vi.mocked(api.getDatasetSchema);

// Helper to create a valid mock projection
function createMockProjection(overrides: Partial<Projection> = {}): Projection {
  return {
    projection_id: 'proj-1',
    dataset_id: 'dataset-123',
    scope: 'entities_list',
    fields: [],
    ...overrides,
  };
}

// Helper to create a mock schema response
function createMockSchemaResponse() {
  return {
    schema_id: 'schema-1',
    schema_version: '1.0',
    schema_json: { properties: {} },
  };
}

describe('projectionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear cache before each test
    clearProjectionCache();
  });

  describe('getProjection', () => {
    it('fetches projection from API', async () => {
      const mockProjection = createMockProjection({
        fields: [{ path: 'name', label: 'Name' }],
      });
      mockGetDatasetProjections.mockResolvedValue({
        entities_list: mockProjection,
        entity_detail: undefined,
      });

      const result = await getProjection('dataset-123', 'entities_list');

      expect(mockGetDatasetProjections).toHaveBeenCalledWith('dataset-123');
      expect(result).toEqual(mockProjection);
    });

    it('returns cached projection on subsequent calls', async () => {
      const mockProjection = createMockProjection();
      mockGetDatasetProjections.mockResolvedValue({
        entities_list: mockProjection,
        entity_detail: undefined,
      });

      // First call
      await getProjection('dataset-123', 'entities_list');
      // Second call
      await getProjection('dataset-123', 'entities_list');

      expect(mockGetDatasetProjections).toHaveBeenCalledTimes(1);
    });

    it('builds default projection when scope not in API response', async () => {
      mockGetDatasetProjections.mockResolvedValue({
        entities_list: undefined,
        entity_detail: undefined,
      });
      mockGetDatasetSchema.mockResolvedValue({
        schema_ref: createMockSchemaResponse(),
      });

      const result = await getProjection('dataset-123', 'entities_list');

      expect(result.is_default).toBe(true);
      expect(result.scope).toBe('entities_list');
    });

    it('fetches schema for default projection', async () => {
      mockGetDatasetProjections.mockResolvedValue({
        entities_list: undefined,
        entity_detail: undefined,
      });
      mockGetDatasetSchema.mockResolvedValue({
        schema_ref: createMockSchemaResponse(),
      });

      await getProjection('dataset-123', 'entities_list');

      expect(mockGetDatasetSchema).toHaveBeenCalledWith('dataset-123');
    });

    it('handles schema fetch error gracefully', async () => {
      mockGetDatasetProjections.mockResolvedValue({
        entities_list: undefined,
        entity_detail: undefined,
      });
      mockGetDatasetSchema.mockRejectedValue(new Error('Schema not found'));

      const result = await getProjection('dataset-123', 'entities_list');

      // Should still return a default projection
      expect(result.is_default).toBe(true);
    });

    it('handles projection API error by building default', async () => {
      mockGetDatasetProjections.mockRejectedValue(new Error('API error'));
      mockGetDatasetSchema.mockResolvedValue({
        schema_ref: createMockSchemaResponse(),
      });

      const result = await getProjection('dataset-123', 'entities_list');

      expect(result.is_default).toBe(true);
    });

    it('handles both API and schema errors', async () => {
      mockGetDatasetProjections.mockRejectedValue(new Error('API error'));
      mockGetDatasetSchema.mockRejectedValue(new Error('Schema error'));

      const result = await getProjection('dataset-123', 'entities_list');

      // Should still return a minimal default projection
      expect(result.is_default).toBe(true);
    });

    it('caches default projection after building', async () => {
      mockGetDatasetProjections.mockResolvedValue({
        entities_list: undefined,
        entity_detail: undefined,
      });
      mockGetDatasetSchema.mockResolvedValue({
        schema_ref: createMockSchemaResponse(),
      });

      // First call
      await getProjection('dataset-123', 'entities_list');
      // Second call
      await getProjection('dataset-123', 'entities_list');

      // API should only be called once
      expect(mockGetDatasetProjections).toHaveBeenCalledTimes(1);
      expect(mockGetDatasetSchema).toHaveBeenCalledTimes(1);
    });

    it('fetches different scopes independently', async () => {
      const listProjection = createMockProjection({
        projection_id: 'proj-list',
        scope: 'entities_list',
      });
      const detailProjection = createMockProjection({
        projection_id: 'proj-detail',
        scope: 'entity_detail',
      });

      mockGetDatasetProjections.mockResolvedValue({
        entities_list: listProjection,
        entity_detail: detailProjection,
      });

      const listResult = await getProjection('dataset-123', 'entities_list');
      const detailResult = await getProjection('dataset-123', 'entity_detail');

      expect(listResult).toEqual(listProjection);
      expect(detailResult).toEqual(detailProjection);
    });
  });

  describe('clearProjectionCache', () => {
    it('clears cache for specific dataset', async () => {
      mockGetDatasetProjections.mockResolvedValue({
        entities_list: createMockProjection(),
        entity_detail: undefined,
      });

      // Populate cache
      await getProjection('dataset-123', 'entities_list');
      expect(mockGetDatasetProjections).toHaveBeenCalledTimes(1);

      // Clear cache for this dataset
      clearProjectionCache('dataset-123');

      // Next call should fetch again
      await getProjection('dataset-123', 'entities_list');
      expect(mockGetDatasetProjections).toHaveBeenCalledTimes(2);
    });

    it('clears entire cache when no datasetId provided', async () => {
      mockGetDatasetProjections.mockResolvedValue({
        entities_list: createMockProjection(),
        entity_detail: undefined,
      });

      // Populate cache for multiple datasets
      await getProjection('dataset-1', 'entities_list');
      await getProjection('dataset-2', 'entities_list');
      expect(mockGetDatasetProjections).toHaveBeenCalledTimes(2);

      // Clear all cache
      clearProjectionCache();

      // Next calls should fetch again
      await getProjection('dataset-1', 'entities_list');
      await getProjection('dataset-2', 'entities_list');
      expect(mockGetDatasetProjections).toHaveBeenCalledTimes(4);
    });

    it('does not affect other datasets when clearing specific one', async () => {
      mockGetDatasetProjections.mockResolvedValue({
        entities_list: createMockProjection(),
        entity_detail: undefined,
      });

      // Populate cache for multiple datasets
      await getProjection('dataset-1', 'entities_list');
      await getProjection('dataset-2', 'entities_list');
      expect(mockGetDatasetProjections).toHaveBeenCalledTimes(2);

      // Clear only dataset-1
      clearProjectionCache('dataset-1');

      // dataset-1 should fetch again, dataset-2 should use cache
      await getProjection('dataset-1', 'entities_list');
      await getProjection('dataset-2', 'entities_list');
      expect(mockGetDatasetProjections).toHaveBeenCalledTimes(3);
    });
  });

  describe('preloadProjections', () => {
    it('fetches both scopes', async () => {
      mockGetDatasetProjections.mockResolvedValue({
        entities_list: createMockProjection({ projection_id: 'proj-list', scope: 'entities_list' }),
        entity_detail: createMockProjection({ projection_id: 'proj-detail', scope: 'entity_detail' }),
      });

      await preloadProjections('dataset-123');

      // Should be called once for each scope (but API is called once per dataset)
      expect(mockGetDatasetProjections).toHaveBeenCalledWith('dataset-123');
    });

    it('populates cache for both scopes', async () => {
      mockGetDatasetProjections.mockResolvedValue({
        entities_list: createMockProjection({ projection_id: 'proj-list', scope: 'entities_list' }),
        entity_detail: createMockProjection({ projection_id: 'proj-detail', scope: 'entity_detail' }),
      });

      await preloadProjections('dataset-123');

      // Clear the mock count
      mockGetDatasetProjections.mockClear();

      // Both scopes should now be cached
      await getProjection('dataset-123', 'entities_list');
      await getProjection('dataset-123', 'entity_detail');

      expect(mockGetDatasetProjections).toHaveBeenCalledTimes(0);
    });
  });
});
