import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  getObjectExits,
  getObjectExit,
  createObjectExit,
  updateObjectExit,
  dispatchObjectExit,
  acknowledgeObjectExit,
  rollbackObjectExit,
  deleteObjectExit,
} from '../../lib/api/procedure/exits';

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

const validExit = {
  exit_id: 'exit-1',
  organization_id: 'org-1',
  exit_number: 'EXIT-001',
  exit_reason: 'loan_return',
  receipt_acknowledged: false,
  status: 'pending',
  created_at: '2026-01-01T00:00:00Z',
};

describe('api/procedure/exits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getObjectExits', () => {
    it('GETs paginated exits with empty params', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        items: [],
        total: 0,
        limit: 0,
        offset: 0,
      });
      await getObjectExits('org-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/exits',
      );
    });

    it('serializes filter params into query string', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        items: [],
        total: 0,
        limit: 0,
        offset: 0,
      });
      await getObjectExits('org-1', { status: 'dispatched', limit: 10 });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('status=dispatched');
      expect(url).toContain('limit=10');
    });
  });

  describe('getObjectExit', () => {
    it('GETs single exit', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validExit);
      const result = await getObjectExit('org-1', 'exit-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/exits/exit-1',
      );
      expect(result.exit_id).toBe('exit-1');
    });

    it('rejects when response is malformed', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ wrong: 'shape' });
      await expect(getObjectExit('org-1', 'exit-1')).rejects.toThrow();
    });
  });

  describe('createObjectExit', () => {
    it('POSTs new exit', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validExit);
      await createObjectExit('org-1', { exit_reason: 'loan_return' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/exits',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ exit_reason: 'loan_return' }),
        }),
      );
    });
  });

  describe('updateObjectExit', () => {
    it('PUTs updates', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validExit);
      await updateObjectExit('org-1', 'exit-1', { exit_note: 'late' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/exits/exit-1',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });

  describe('dispatchObjectExit', () => {
    it('POSTs to dispatch endpoint', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validExit);
      await dispatchObjectExit('org-1', 'exit-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/exits/exit-1/dispatch',
        { method: 'POST' },
      );
    });
  });

  describe('acknowledgeObjectExit', () => {
    it('POSTs acknowledged_by/reference body', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validExit);
      await acknowledgeObjectExit('org-1', 'exit-1', 'Alice', 'REF-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/exits/exit-1/acknowledge',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ acknowledged_by: 'Alice', reference: 'REF-1' }),
        }),
      );
    });
  });

  describe('rollbackObjectExit', () => {
    it('POSTs target_status and reason', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validExit);
      await rollbackObjectExit('org-1', 'exit-1', 'pending', 'mistake');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/exits/exit-1/rollback',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ target_status: 'pending', reason: 'mistake' }),
        }),
      );
    });
  });

  describe('deleteObjectExit', () => {
    it('DELETEs the exit', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ success: true });
      await deleteObjectExit('org-1', 'exit-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/exits/exit-1',
        { method: 'DELETE' },
      );
    });
  });
});
