import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  listReportTemplates,
  uploadReportTemplate,
  deleteReportTemplate,
  getReportTemplateDownloadUrl,
  getDefaultTemplateDownloadUrl,
} from '../../lib/api/report-templates';

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

describe('api/report-templates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('listReportTemplates', () => {
    it('returns the templates field from response', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        templates: [{ name: 'a.html', size: 100, last_modified: null }],
      });
      const result = await listReportTemplates('org-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/report-templates',
      );
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('a.html');
    });
  });

  describe('uploadReportTemplate', () => {
    it('POSTs FormData with file', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      const file = new File(['<html>'], 'tmpl.html', { type: 'text/html' });
      await uploadReportTemplate('org-1', file);
      const args = vi.mocked(apiClient.apiFetch).mock.calls[0];
      expect(args[0]).toBe('/organizations/org-1/report-templates');
      const init = args[1] as RequestInit;
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);
      expect((init.body as FormData).get('file')).toBe(file);
    });
  });

  describe('deleteReportTemplate', () => {
    it('DELETEs by encoded filename', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await deleteReportTemplate('org-1', 'name with spaces.html');
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toBe('/organizations/org-1/report-templates/name%20with%20spaces.html');
    });
  });

  describe('getReportTemplateDownloadUrl', () => {
    it('builds an absolute path with encoded filename', () => {
      const url = getReportTemplateDownloadUrl('org-1', 'foo bar.html');
      expect(url).toBe('/api/organizations/org-1/report-templates/foo%20bar.html');
    });
  });

  describe('getDefaultTemplateDownloadUrl', () => {
    it('builds default-template path', () => {
      const url = getDefaultTemplateDownloadUrl('org-1', 'object_label');
      expect(url).toBe(
        '/api/organizations/org-1/report-templates/default/object_label',
      );
    });
  });
});
