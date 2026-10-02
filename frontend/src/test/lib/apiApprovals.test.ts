import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import { getApprovals, getApprovalsCount } from '../../lib/api/approvals';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {},
  API_BASE_URL: '/api',
}));

const apiFetchMock = vi.mocked(apiClient.apiFetch);

describe('api/approvals', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({} as never);
  });

  describe('getApprovals', () => {
    it('defaults to status=pending and no limit', async () => {
      await getApprovals('org-1');
      const url = apiFetchMock.mock.calls[0][0];
      expect(url).toBe('/organizations/org-1/approvals?status=pending');
    });

    it('passes the explicit status', async () => {
      await getApprovals('org-1', { status: 'reviewed' });
      const url = apiFetchMock.mock.calls[0][0];
      expect(url).toBe('/organizations/org-1/approvals?status=reviewed');
    });

    it('appends a limit when provided', async () => {
      await getApprovals('org-1', { status: 'pending', limit: 25 });
      const url = apiFetchMock.mock.calls[0][0];
      expect(url).toBe('/organizations/org-1/approvals?status=pending&limit=25');
    });

    it('returns the response from apiFetch', async () => {
      const response = { items: [], total: 0 };
      apiFetchMock.mockResolvedValueOnce(response);
      const result = await getApprovals('org-1');
      expect(result).toBe(response);
    });
  });

  describe('getApprovalsCount', () => {
    it('hits the count endpoint for the org', async () => {
      await getApprovalsCount('org-1');
      const url = apiFetchMock.mock.calls[0][0];
      expect(url).toBe('/organizations/org-1/approvals/count');
    });

    it('returns the response from apiFetch', async () => {
      apiFetchMock.mockResolvedValueOnce({ pending_count: 7 });
      const result = await getApprovalsCount('org-1');
      expect(result.pending_count).toBe(7);
    });
  });
});
