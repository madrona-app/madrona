import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  getDeaccessions,
  getDeaccession,
  createDeaccession,
  updateDeaccession,
  reviewDeaccession,
  approveDeaccession,
  completeDeaccession,
  getDeaccessionAudit,
  rollbackDeaccession,
  deleteDeaccession,
} from '../../lib/api/procedure/deaccessions';

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

const validDeaccession = {
  deaccession_id: 'd-1',
  organization_id: 'org-1',
  deaccession_number: 'DEAC-001',
  object_id: 'obj-1',
  reason: 'duplicate',
  committee_review_required: false,
  board_approval_required: false,
  legal_review_required: false,
  provenance_review_required: false,
  provenance_review_complete: false,
  provenance_issues_found: false,
  donor_restrictions_exist: false,
  public_notice_required: false,
  status: 'proposed',
  created_at: '2026-01-01T00:00:00Z',
};

const validAudit = {
  audit_id: 'a-1',
  deaccession_id: 'd-1',
  organization_id: 'org-1',
  action: 'created',
  performed_at: '2026-01-01T00:00:00Z',
};

describe('api/procedure/deaccessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getDeaccessions', () => {
    it('GETs paginated list with status filter', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        items: [],
        total: 0,
        limit: 0,
        offset: 0,
      });
      await getDeaccessions('org-1', { status: 'approved' });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('status=approved');
    });
  });

  describe('getDeaccession', () => {
    it('GETs a single deaccession', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validDeaccession);
      const result = await getDeaccession('org-1', 'd-1');
      expect(result.deaccession_id).toBe('d-1');
    });
  });

  describe('createDeaccession', () => {
    it('POSTs new deaccession', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validDeaccession);
      await createDeaccession('org-1', { reason: 'duplicate' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/deaccessions',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('updateDeaccession', () => {
    it('PUTs updates', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validDeaccession);
      await updateDeaccession('org-1', 'd-1', { deaccession_note: 'x' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/deaccessions/d-1',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });

  describe('reviewDeaccession', () => {
    it('POSTs recommendation and note', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validDeaccession);
      await reviewDeaccession('org-1', 'd-1', 'approve', 'good');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/deaccessions/d-1/review',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ recommendation: 'approve', note: 'good' }),
        }),
      );
    });
  });

  describe('approveDeaccession', () => {
    it('POSTs board reference and resolution', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validDeaccession);
      await approveDeaccession('org-1', 'd-1', 'BR-1', 'res-text');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/deaccessions/d-1/approve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ board_reference: 'BR-1', resolution: 'res-text' }),
        }),
      );
    });
  });

  describe('completeDeaccession', () => {
    it('POSTs exit_id', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validDeaccession);
      await completeDeaccession('org-1', 'd-1', 'exit-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/deaccessions/d-1/complete',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ exit_id: 'exit-1' }),
        }),
      );
    });
  });

  describe('getDeaccessionAudit', () => {
    it('GETs audit trail', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce([validAudit]);
      const result = await getDeaccessionAudit('org-1', 'd-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/deaccessions/d-1/audit',
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('rollbackDeaccession', () => {
    it('POSTs target_status and reason', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validDeaccession);
      await rollbackDeaccession('org-1', 'd-1', 'proposed', 'reverted');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/deaccessions/d-1/rollback',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ target_status: 'proposed', reason: 'reverted' }),
        }),
      );
    });
  });

  describe('deleteDeaccession', () => {
    it('DELETEs', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ success: true });
      await deleteDeaccession('org-1', 'd-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/deaccessions/d-1',
        { method: 'DELETE' },
      );
    });
  });
});
