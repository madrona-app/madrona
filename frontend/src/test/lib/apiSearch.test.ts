import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  searchEntities,
  getAutocomplete,
  findSimilarEntities,
  getSearchHealth,
} from '../../lib/api/search';

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

describe('api/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('searchEntities', () => {
    it('POSTs search request with org id in query', async () => {
      const response = { hits: [], total: 0, took_ms: 5 };
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(response);

      const result = await searchEntities('org-1', {
        query: { q: 'monet' },
        limit: 10,
      });

      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/search?organization_id=org-1',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('monet'),
        }),
      );
      expect(result).toEqual(response);
    });

    it('serializes nested filters in JSON body', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        hits: [],
        total: 0,
        took_ms: 1,
      });
      await searchEntities('org-1', {
        filters: { dataset_id: ['ds-1', 'ds-2'], on_display: true },
      });
      const call = vi.mocked(apiClient.apiFetch).mock.calls[0][1];
      const body = JSON.parse(call?.body as string);
      expect(body.filters.dataset_id).toEqual(['ds-1', 'ds-2']);
      expect(body.filters.on_display).toBe(true);
    });

    it('sends Content-Type header', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        hits: [],
        total: 0,
        took_ms: 1,
      });
      await searchEntities('org-1', {});
      const call = vi.mocked(apiClient.apiFetch).mock.calls[0][1];
      expect(call?.headers).toMatchObject({ 'Content-Type': 'application/json' });
    });
  });

  describe('getAutocomplete', () => {
    it('uses default field=title and limit=10', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ suggestions: [] });
      await getAutocomplete('org-1', 'mo');
      const call = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(call).toContain('field=title');
      expect(call).toContain('limit=10');
      expect(call).toContain('q=mo');
    });

    it('passes organization_id in query', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ suggestions: [] });
      await getAutocomplete('org-1', 'mo');
      const call = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(call).toContain('organization_id=org-1');
    });

    it('uses custom field and limit when provided', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ suggestions: [] });
      await getAutocomplete('org-1', 'foo', 'creator', 25);
      const call = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(call).toContain('field=creator');
      expect(call).toContain('limit=25');
    });
  });

  describe('findSimilarEntities', () => {
    it('encodes entity_key in URL', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ similar: [] });
      await findSimilarEntities('org-1', 'object/abc');
      const call = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(call).toContain('object%2Fabc');
    });

    it('uses default limit of 10', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ similar: [] });
      await findSimilarEntities('org-1', 'e1');
      const call = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(call).toContain('limit=10');
    });

    it('uses custom limit', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ similar: [] });
      await findSimilarEntities('org-1', 'e1', 50);
      const call = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(call).toContain('limit=50');
    });
  });

  describe('getSearchHealth', () => {
    it('fetches /health/search', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ status: 'green' });
      const result = await getSearchHealth();
      expect(apiClient.apiFetch).toHaveBeenCalledWith('/health/search');
      expect(result.status).toBe('green');
    });
  });
});
