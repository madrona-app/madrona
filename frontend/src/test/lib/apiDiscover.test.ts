import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  toggleObjectDiscoverable,
  bulkToggleDiscoverable,
  cancelPublishSchedule,
  publishByCriteria,
} from '../../lib/api/discover';

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

describe('api/discover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('toggleObjectDiscoverable', () => {
    it('PATCHes object discoverable flag', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        object_id: 'o-1',
        is_discoverable: true,
        discoverable_at: '2026-01-01T00:00:00Z',
      });
      await toggleObjectDiscoverable('org-1', 'o-1', true);
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/objects/o-1/discoverable',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ is_discoverable: true }),
        }),
      );
    });

    it('returns parsed response', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        object_id: 'o-1',
        is_discoverable: false,
        discoverable_at: null,
      });
      const result = await toggleObjectDiscoverable('org-1', 'o-1', false);
      expect(result.is_discoverable).toBe(false);
      expect(result.discoverable_at).toBeNull();
    });
  });

  describe('bulkToggleDiscoverable', () => {
    it('POSTs bulk toggle with object IDs', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        updated: 3,
        is_discoverable: true,
      });
      const result = await bulkToggleDiscoverable('org-1', ['a', 'b', 'c'], true);
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/objects/bulk-discoverable',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            object_ids: ['a', 'b', 'c'],
            is_discoverable: true,
          }),
        }),
      );
      expect(result.updated).toBe(3);
    });
  });

  describe('cancelPublishSchedule', () => {
    it('issues DELETE on schedule', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(undefined);
      await cancelPublishSchedule('org-1', 'sched-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/discover/schedules/sched-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('publishByCriteria', () => {
    it('POSTs criteria with dry_run flag', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        matched_count: 12,
      });
      await publishByCriteria('org-1', { object_type: 'painting' }, true, true);
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/discover/publish-by-criteria',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            criteria: { object_type: 'painting' },
            is_discoverable: true,
            dry_run: true,
          }),
        }),
      );
    });

    it('defaults dry_run to false when not provided', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await publishByCriteria('org-1', {}, false);
      const call = vi.mocked(apiClient.apiFetch).mock.calls[0][1];
      const body = JSON.parse(call?.body as string);
      expect(body.dry_run).toBe(false);
    });
  });
});
