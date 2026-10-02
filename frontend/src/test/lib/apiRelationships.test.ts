import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  getRelationshipDefinitions,
  createRelationshipDefinition,
  updateRelationshipDefinition,
  deleteRelationshipDefinition,
  evaluateRelationshipDefinition,
  getEntityRelationships,
  createEntityRelationship,
  deleteEntityRelationship,
  getRelationshipTypes,
  getDeleteSettings,
  updateDeleteSettings,
  getDeleteStats,
} from '../../lib/api/relationships';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  getCsrfToken: vi.fn(),
  getFriendlyErrorMessage: vi.fn(),
  API_BASE_URL: '/api',
}));

const validDefinition = {
  definition_id: 'def-1',
  organization_id: 'org-1',
  name: 'Creator Link',
  relationship_type: 'created_by',
  source_field_path: 'creator',
  target_field_path: 'name',
  enabled: true,
  created_at: '2026-01-01T00:00:00Z',
};

const validRelationship = {
  relationship_id: 'rel-1',
  organization_id: 'org-1',
  source_entity_key: 'src-1',
  target_entity_key: 'tgt-1',
  relationship_type: 'created_by',
  created_at: '2026-01-01T00:00:00Z',
};

describe('api/relationships', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getRelationshipDefinitions', () => {
    it('fetches with no params', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        items: [],
        limit: 10,
        offset: 0,
        total: 0,
      });
      await getRelationshipDefinitions();
      expect(apiClient.apiFetch).toHaveBeenCalledWith('/relationship-definitions');
    });

    it('appends query params', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        items: [],
        limit: 10,
        offset: 0,
        total: 0,
      });
      await getRelationshipDefinitions({ enabled: true, limit: 5 });
      const call = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(call).toContain('enabled=true');
      expect(call).toContain('limit=5');
    });
  });

  describe('createRelationshipDefinition', () => {
    it('POSTs the definition body', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        definition: validDefinition,
      });
      await createRelationshipDefinition({
        name: 'Creator Link',
        relationship_type: 'created_by',
        source_field_path: 'creator',
        target_field_path: 'name',
      });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/relationship-definitions',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('updateRelationshipDefinition', () => {
    it('PUTs the update', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        definition: validDefinition,
      });
      await updateRelationshipDefinition('def-1', { name: 'New' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/relationship-definitions/def-1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ name: 'New' }),
        }),
      );
    });
  });

  describe('deleteRelationshipDefinition', () => {
    it('issues DELETE', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(undefined);
      await deleteRelationshipDefinition('def-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/relationship-definitions/def-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('evaluateRelationshipDefinition', () => {
    it('POSTs evaluate with options', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        created: 5,
        skipped: 2,
        errors: [],
      });
      const result = await evaluateRelationshipDefinition('def-1', {
        skip_existing: true,
      });
      expect(result.created).toBe(5);
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/relationship-definitions/def-1/evaluate',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ skip_existing: true }),
        }),
      );
    });

    it('uses empty body when no options provided', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        created: 0,
        skipped: 0,
        errors: [],
      });
      await evaluateRelationshipDefinition('def-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/relationship-definitions/def-1/evaluate',
        expect.objectContaining({ body: JSON.stringify({}) }),
      );
    });
  });

  describe('getEntityRelationships', () => {
    it('encodes entity key in URL', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        items: [],
        limit: 10,
        offset: 0,
        
        total: 0,
      });
      await getEntityRelationships('object/123', 'org-1');
      const call = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      // The "/" must be URL-encoded
      expect(call).toContain('object%2F123');
    });

    it('includes organization_id in query', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        items: [],
        limit: 10,
        offset: 0,
        
        total: 0,
      });
      await getEntityRelationships('e1', 'org-1');
      const call = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(call).toContain('organization_id=org-1');
    });
  });

  describe('createEntityRelationship', () => {
    it('POSTs new relationship', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        relationship: validRelationship,
      });
      await createEntityRelationship({
        source_entity_key: 's',
        target_entity_key: 't',
        relationship_type: 'r',
      });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/relationships',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('deleteEntityRelationship', () => {
    it('DELETEs relationship by id', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(undefined);
      await deleteEntityRelationship('rel-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/relationships/rel-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('getRelationshipTypes', () => {
    it('fetches with organization_id query', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        organization_id: 'org-1',
        relationship_types: [],
        total_relationships: 0,
      });
      await getRelationshipTypes('org-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/relationship-types?organization_id=org-1',
      );
    });
  });

  describe('getDeleteSettings', () => {
    it('passes organization id via header', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        delete_detection_enabled: true,
        delete_detection_method: 'full_sync',
        delete_strategy: 'remove',
      });
      await getDeleteSettings('pipe-1', 'org-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/delete-detection/pipelines/pipe-1/settings',
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Organization-Id': 'org-1' }),
        }),
      );
    });
  });

  describe('updateDeleteSettings', () => {
    it('PUTs settings update', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        delete_detection_enabled: false,
        delete_detection_method: 'incremental',
        delete_strategy: 'mark',
      });
      await updateDeleteSettings('pipe-1', 'org-1', {
        delete_detection_enabled: false,
      });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/delete-detection/pipelines/pipe-1/settings',
        expect.objectContaining({
          method: 'PUT',
        }),
      );
    });
  });

  describe('getDeleteStats', () => {
    it('appends dataset_id when provided', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        active: 0,
        soft_deleted: 0,
        archived: 0,
        marked: 0,
        total_deleted: 0,
      });
      await getDeleteStats('org-1', 'ds-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/delete-detection/stats?dataset_id=ds-1',
        expect.any(Object),
      );
    });

    it('omits query when no dataset_id', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        active: 0,
        soft_deleted: 0,
        archived: 0,
        marked: 0,
        total_deleted: 0,
      });
      await getDeleteStats('org-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/delete-detection/stats',
        expect.any(Object),
      );
    });
  });
});
