import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  getConditionReports,
  getConditionReport,
  createConditionReport,
  updateConditionReport,
  completeConditionReport,
  reviewConditionReport,
  getObjectConditionReports,
  deleteConditionReport,
} from '../../lib/api/procedure/conditions';

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

const validReport = {
  report_id: 'r-1',
  organization_id: 'org-1',
  report_number: 'CR-001',
  report_type: 'intake',
  conservation_needed: false,
  status: 'draft',
  created_at: '2026-01-01T00:00:00Z',
};

describe('api/procedure/conditions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getConditionReports', () => {
    it('GETs paginated reports with query string', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        items: [],
        total: 0,
        limit: 0,
        offset: 0,
      });
      await getConditionReports('org-1', { status: 'completed' });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('status=completed');
    });
  });

  describe('getConditionReport', () => {
    it('GETs a single report', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validReport);
      const result = await getConditionReport('org-1', 'r-1');
      expect(result.report_id).toBe('r-1');
    });
  });

  describe('createConditionReport', () => {
    it('POSTs new report', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validReport);
      await createConditionReport('org-1', { report_type: 'intake' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/condition-reports',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('updateConditionReport', () => {
    it('PUTs updates', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validReport);
      await updateConditionReport('org-1', 'r-1', { report_note: 'x' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/condition-reports/r-1',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });

  describe('completeConditionReport', () => {
    it('POSTs to complete', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validReport);
      await completeConditionReport('org-1', 'r-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/condition-reports/r-1/complete',
        { method: 'POST' },
      );
    });
  });

  describe('reviewConditionReport', () => {
    it('POSTs to review', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validReport);
      await reviewConditionReport('org-1', 'r-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/condition-reports/r-1/review',
        { method: 'POST' },
      );
    });
  });

  describe('getObjectConditionReports', () => {
    it('filters by object_id', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        items: [],
        total: 0,
        limit: 0,
        offset: 0,
      });
      await getObjectConditionReports('org-1', 'obj-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/condition-reports?object_id=obj-1',
      );
    });
  });

  describe('deleteConditionReport', () => {
    it('DELETEs the report', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ success: true });
      await deleteConditionReport('org-1', 'r-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/condition-reports/r-1',
        { method: 'DELETE' },
      );
    });
  });
});
