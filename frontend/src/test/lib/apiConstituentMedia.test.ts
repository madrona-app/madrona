import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  listConstituentMedia,
  addConstituentMedia,
  removeConstituentMedia,
  setConstituentPrimaryMedia,
} from '../../lib/api/constituent-media';

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

describe('api/constituent-media', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('listConstituentMedia', () => {
    it('GETs from constituent media endpoint', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ items: [], });
      await listConstituentMedia('org-1', 'c-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/constituents/c-1/media',
      );
    });
  });

  describe('addConstituentMedia', () => {
    it('POSTs media link with body', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await addConstituentMedia('org-1', 'c-1', { media_id: 'm-1', is_primary: true });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/constituents/c-1/media',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ media_id: 'm-1', is_primary: true }),
        }),
      );
    });
  });

  describe('removeConstituentMedia', () => {
    it('DELETEs the media link', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await removeConstituentMedia('org-1', 'c-1', 'm-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/constituents/c-1/media/m-1',
        { method: 'DELETE' },
      );
    });
  });

  describe('setConstituentPrimaryMedia', () => {
    it('PUTs to primary endpoint', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await setConstituentPrimaryMedia('org-1', 'c-1', 'm-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/constituents/c-1/media/m-1/primary',
        { method: 'PUT' },
      );
    });
  });
});
