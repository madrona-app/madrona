import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  getAvailableReports,
  generateReport,
  getReportRuns,
  getReportRun,
  getReportDownloadUrl,
  cancelReportRun,
  dismissReportRun,
  downloadReport,
} from '../../lib/api/on-demand-reports';

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

describe('api/on-demand-reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getAvailableReports', () => {
    it('passes context_type and record_type as query', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ items: [], total: 0 });
      await getAvailableReports('org-1', 'workspace', 'objects');
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('/organizations/org-1/on-demand-reports/available');
      expect(url).toContain('context_type=workspace');
      expect(url).toContain('record_type=objects');
    });

    it('omits record_type when undefined', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ items: [], total: 0 });
      await getAvailableReports('org-1', 'search');
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('context_type=search');
      expect(url).not.toContain('record_type');
    });
  });

  describe('generateReport', () => {
    it('POSTs the request body to /generate', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        run_id: 'r-1',
        status: 'pending',
        report_key: 'k',
        export_format: 'csv',
      });
      const req = {
        report_key: 'k',
        context_type: 'record' as const,
        context_params: { id: 'x' },
        export_format: 'csv' as const,
      };
      await generateReport('org-1', req);
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/on-demand-reports/generate',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(req),
        }),
      );
    });
  });

  describe('getReportRuns', () => {
    it('GETs runs without query when no params', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        items: [],
        total: 0,
        limit: 0,
        offset: 0,
      });
      await getReportRuns('org-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/on-demand-reports/runs',
      );
    });

    it('serializes status/limit/offset', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        items: [],
        total: 0,
        limit: 0,
        offset: 0,
      });
      await getReportRuns('org-1', { status: 'completed', limit: 10, offset: 5 });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('status=completed');
      expect(url).toContain('limit=10');
      expect(url).toContain('offset=5');
    });
  });

  describe('getReportRun', () => {
    it('GETs a single run', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await getReportRun('org-1', 'run-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/on-demand-reports/runs/run-1',
      );
    });
  });

  describe('getReportDownloadUrl', () => {
    it('GETs download URL', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ download_url: 'http://x' });
      const result = await getReportDownloadUrl('org-1', 'run-1');
      expect(result.download_url).toBe('http://x');
    });
  });

  describe('cancelReportRun', () => {
    it('POSTs to cancel', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await cancelReportRun('org-1', 'run-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/on-demand-reports/runs/run-1/cancel',
        { method: 'POST' },
      );
    });
  });

  describe('dismissReportRun', () => {
    it('POSTs to dismiss', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await dismissReportRun('org-1', 'run-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/on-demand-reports/runs/run-1/dismiss',
        { method: 'POST' },
      );
    });
  });

  describe('downloadReport', () => {
    it('opens a new window when window.open succeeds', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ download_url: 'http://x/file' });
      const fakeWin = {} as Window;
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWin);
      await downloadReport('org-1', 'run-1');
      expect(openSpy).toHaveBeenCalledWith('http://x/file', '_blank');
      openSpy.mockRestore();
    });

    it('falls back to anchor click when window.open returns null', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ download_url: 'http://x/file' });
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
      const clickSpy = vi.fn();
      const origCreate = document.createElement.bind(document);
      const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = origCreate(tag);
        if (tag === 'a') {
          (el as HTMLAnchorElement).click = clickSpy;
        }
        return el;
      });
      await downloadReport('org-1', 'run-1');
      expect(clickSpy).toHaveBeenCalled();
      openSpy.mockRestore();
      createSpy.mockRestore();
    });
  });
});
