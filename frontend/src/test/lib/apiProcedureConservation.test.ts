import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  getConservationTreatments,
  getConservationTreatment,
  createConservationTreatment,
  updateConservationTreatment,
  approveConservationTreatment,
  startConservationTreatment,
  completeConservationTreatment,
  deleteConservationTreatment,
} from '../../lib/api/procedure/conservation';

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

const validTreatment = {
  treatment_id: 't-1',
  organization_id: 'org-1',
  treatment_number: 'CONS-001',
  treatment_type: 'preventive',
  status: 'proposed',
  created_at: '2026-01-01T00:00:00Z',
};

describe('api/procedure/conservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getConservationTreatments', () => {
    it('hits list endpoint with query', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        items: [],
        total: 0,
        limit: 0,
        offset: 0,
      });
      await getConservationTreatments('org-1', { status: 'in_progress' });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('/organizations/org-1/collections/conservation');
      expect(url).toContain('status=in_progress');
    });
  });

  describe('getConservationTreatment', () => {
    it('GETs single treatment', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validTreatment);
      const result = await getConservationTreatment('org-1', 't-1');
      expect(result.treatment_id).toBe('t-1');
    });
  });

  describe('createConservationTreatment', () => {
    it('POSTs new treatment', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validTreatment);
      await createConservationTreatment('org-1', { treatment_type: 'preventive' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/conservation',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('updateConservationTreatment', () => {
    it('PUTs updates', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validTreatment);
      await updateConservationTreatment('org-1', 't-1', { treatment_note: 'x' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/conservation/t-1',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });

  describe('approveConservationTreatment', () => {
    it('POSTs note as body', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validTreatment);
      await approveConservationTreatment('org-1', 't-1', 'approved');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/conservation/t-1/approve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ note: 'approved' }),
        }),
      );
    });
  });

  describe('startConservationTreatment', () => {
    it('POSTs start_date in body', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validTreatment);
      await startConservationTreatment('org-1', 't-1', '2026-01-15');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/conservation/t-1/start',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ start_date: '2026-01-15' }),
        }),
      );
    });
  });

  describe('completeConservationTreatment', () => {
    it('POSTs end_date in body', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validTreatment);
      await completeConservationTreatment('org-1', 't-1', '2026-02-01');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/conservation/t-1/complete',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ end_date: '2026-02-01' }),
        }),
      );
    });
  });

  describe('deleteConservationTreatment', () => {
    it('DELETEs', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ success: true });
      await deleteConservationTreatment('org-1', 't-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/conservation/t-1',
        { method: 'DELETE' },
      );
    });
  });
});
