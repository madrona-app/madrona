import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  getAcquisitions,
  getAcquisition,
  createAcquisition,
  updateAcquisition,
  approveAcquisition,
  completeAcquisition,
  rollbackAcquisition,
  deleteAcquisition,
  getAcquisitionObjects,
  linkAcquisitionObject,
  unlinkAcquisitionObject,
  getObjectAcquisition,
  setObjectAcquisition,
} from '../../lib/api/procedure/acquisitions';

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

const validAcquisition = {
  acquisition_id: 'acq-1',
  organization_id: 'org-1',
  acquisition_number: 'ACQ-001',
  acquisition_method: 'gift',
  provenance_verified: false,
  board_approval_required: false,
  objects_count: 0,
  status: 'proposed',
  accessioning_approved: false,
  created_at: '2026-01-01T00:00:00Z',
};

describe('api/procedure/acquisitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getAcquisitions', () => {
    it('builds query string from params', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        items: [],
        total: 0,
        limit: 0,
        offset: 0,
      });
      await getAcquisitions('org-1', { status: 'approved' });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('status=approved');
    });
  });

  describe('getAcquisition', () => {
    it('GETs single acquisition', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validAcquisition);
      const result = await getAcquisition('org-1', 'acq-1');
      expect(result.acquisition_id).toBe('acq-1');
    });
  });

  describe('createAcquisition', () => {
    it('POSTs new acquisition', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validAcquisition);
      await createAcquisition('org-1', { acquisition_method: 'gift' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/acquisitions',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('updateAcquisition', () => {
    it('PUTs updates', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validAcquisition);
      await updateAcquisition('org-1', 'acq-1', { acquisition_note: 'x' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/acquisitions/acq-1',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });

  describe('approveAcquisition', () => {
    it('POSTs note in body', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validAcquisition);
      await approveAcquisition('org-1', 'acq-1', 'looks good');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/acquisitions/acq-1/approve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ note: 'looks good' }),
        }),
      );
    });
  });

  describe('completeAcquisition', () => {
    it('POSTs to complete', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validAcquisition);
      await completeAcquisition('org-1', 'acq-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/acquisitions/acq-1/complete',
        { method: 'POST' },
      );
    });
  });

  describe('rollbackAcquisition', () => {
    it('POSTs target_status and reason', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validAcquisition);
      await rollbackAcquisition('org-1', 'acq-1', 'proposed', 'reverted');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/acquisitions/acq-1/rollback',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ target_status: 'proposed', reason: 'reverted' }),
        }),
      );
    });
  });

  describe('deleteAcquisition', () => {
    it('DELETEs', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ success: true });
      await deleteAcquisition('org-1', 'acq-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/acquisitions/acq-1',
        { method: 'DELETE' },
      );
    });
  });

  describe('getAcquisitionObjects', () => {
    it('GETs object list', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ items: [], total: 0 });
      await getAcquisitionObjects('org-1', 'acq-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/acquisitions/acq-1/objects',
      );
    });
  });

  describe('linkAcquisitionObject', () => {
    it('POSTs object_id with optional note', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await linkAcquisitionObject('org-1', 'acq-1', 'obj-1', 'memo');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/acquisitions/acq-1/objects',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ object_id: 'obj-1', note: 'memo' }),
        }),
      );
    });
  });

  describe('unlinkAcquisitionObject', () => {
    it('DELETEs the object link', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ success: true });
      await unlinkAcquisitionObject('org-1', 'acq-1', 'obj-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/acquisitions/acq-1/objects/obj-1',
        { method: 'DELETE' },
      );
    });
  });

  describe('getObjectAcquisition', () => {
    it('GETs the object-scoped acquisition', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ acquisition: null });
      await getObjectAcquisition('org-1', 'obj-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/objects/obj-1/acquisition',
      );
    });
  });

  describe('setObjectAcquisition', () => {
    it('PUTs acquisition_id and note', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ acquisition: null });
      await setObjectAcquisition('org-1', 'obj-1', 'acq-1', 'note');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/objects/obj-1/acquisition',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ acquisition_id: 'acq-1', note: 'note' }),
        }),
      );
    });
  });
});
