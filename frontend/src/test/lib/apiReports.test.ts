import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  getReportsSummary,
  getDailyRuns,
  getDatasetsSummary,
  getEntityHistory,
  getRecordAuditHistory,
  getEntityAuditEvents,
  getEntityAuditEventDetail,
} from '../../lib/api/reports';

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

describe('api/reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getReportsSummary', () => {
    it('passes default days=30', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await getReportsSummary('org-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/reports/summary?days=30',
      );
    });

    it('respects custom days param', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await getReportsSummary('org-1', 7);
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/reports/summary?days=7',
      );
    });
  });

  describe('getDailyRuns', () => {
    it('passes days param', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ days: [] });
      await getDailyRuns('org-1', 14);
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/reports/runs/daily?days=14',
      );
    });
  });

  describe('getDatasetsSummary', () => {
    it('GETs datasets summary', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ datasets: [] });
      await getDatasetsSummary('org-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/reports/datasets/summary',
      );
    });
  });

  describe('getEntityHistory', () => {
    it('encodes entity key and includes organization_id', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await getEntityHistory('foo/bar', 'org-1', { limit: 10 });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('/entities/foo%2Fbar/history');
      expect(url).toContain('organization_id=org-1');
      expect(url).toContain('limit=10');
    });
  });

  describe('getRecordAuditHistory', () => {
    it('GETs scoped audit history', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await getRecordAuditHistory('org-1', 'collection_object', 'obj-1', { limit: 25 });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('/entity-history/collection_object/obj-1');
      expect(url).toContain('limit=25');
    });
  });

  describe('getEntityAuditEvents', () => {
    it('passes filter params', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await getEntityAuditEvents('org-1', { entity_type: 'loan_in', limit: 5 });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('entity_type=loan_in');
      expect(url).toContain('limit=5');
    });
  });

  describe('getEntityAuditEventDetail', () => {
    it('GETs event detail', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await getEntityAuditEventDetail('org-1', 'evt-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/entity-audit-events/evt-1',
      );
    });
  });









});
