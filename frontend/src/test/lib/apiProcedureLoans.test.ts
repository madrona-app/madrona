import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  getLoansIn,
  getLoanIn,
  createLoanIn,
  updateLoanIn,
  approveLoanIn,
  receiveLoanIn,
  returnLoanIn,
  renewLoanIn,
  rollbackLoanIn,
  deleteLoanIn,
  getLoanInObjectEntries,
  addLoanInObjectEntry,
  removeLoanInObjectEntry,
  getLoansOut,
  getLoanOut,
  createLoanOut,
  updateLoanOut,
  approveLoanOut,
  dispatchLoanOut,
  deleteLoanOut,
} from '../../lib/api/procedure/loans';

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

const validLoanIn = {
  loan_in_id: 'l-1',
  organization_id: 'org-1',
  loan_number: 'LIN-001',
  loan_purpose: 'exhibition',
  renewal_count: 0,
  indemnity: false,
  facility_report_sent: false,
  status: 'requested',
  created_at: '2026-01-01T00:00:00Z',
};

const validLoanOut = {
  loan_out_id: 'lo-1',
  organization_id: 'org-1',
  loan_number: 'LOUT-001',
  loan_purpose: 'exhibition',
  renewal_count: 0,
  certificate_of_insurance_received: false,
  facility_report_received: false,
  status: 'requested',
  created_at: '2026-01-01T00:00:00Z',
};

describe('api/procedure/loans (Loans In)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getLoansIn', () => {
    it('GETs paginated list', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        items: [],
        total: 0,
        limit: 0,
        offset: 0,
      });
      await getLoansIn('org-1', { status: 'on_loan' });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('status=on_loan');
    });
  });

  describe('getLoanIn', () => {
    it('GETs single loan', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validLoanIn);
      const result = await getLoanIn('org-1', 'l-1');
      expect(result.loan_in_id).toBe('l-1');
    });
  });

  describe('createLoanIn', () => {
    it('POSTs new loan', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validLoanIn);
      await createLoanIn('org-1', { loan_purpose: 'exhibition' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/loans-in',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('updateLoanIn', () => {
    it('PUTs updates', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validLoanIn);
      await updateLoanIn('org-1', 'l-1', { loan_note: 'x' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/loans-in/l-1',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });

  describe('approveLoanIn', () => {
    it('POSTs to approve', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validLoanIn);
      await approveLoanIn('org-1', 'l-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/loans-in/l-1/approve',
        { method: 'POST' },
      );
    });
  });

  describe('receiveLoanIn', () => {
    it('POSTs receipt_date', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validLoanIn);
      await receiveLoanIn('org-1', 'l-1', '2026-01-15');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/loans-in/l-1/receive',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ receipt_date: '2026-01-15' }),
        }),
      );
    });
  });

  describe('returnLoanIn', () => {
    it('POSTs return_date', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validLoanIn);
      await returnLoanIn('org-1', 'l-1', '2026-02-01');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/loans-in/l-1/return',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ return_date: '2026-02-01' }),
        }),
      );
    });
  });

  describe('renewLoanIn', () => {
    it('POSTs new_end_date', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validLoanIn);
      await renewLoanIn('org-1', 'l-1', '2026-12-31');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/loans-in/l-1/renew',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ new_end_date: '2026-12-31' }),
        }),
      );
    });
  });

  describe('rollbackLoanIn', () => {
    it('POSTs target_status and reason', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validLoanIn);
      await rollbackLoanIn('org-1', 'l-1', 'requested', 'reverted');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/loans-in/l-1/rollback',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ target_status: 'requested', reason: 'reverted' }),
        }),
      );
    });
  });

  describe('deleteLoanIn', () => {
    it('DELETEs', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ success: true });
      await deleteLoanIn('org-1', 'l-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/loans-in/l-1',
        { method: 'DELETE' },
      );
    });
  });

  describe('Loan In - Object Entries', () => {
    it('GETs entries passthrough', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ entries: [] });
      await getLoanInObjectEntries('org-1', 'l-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/loans-in/l-1/object-entries',
      );
    });

    it('POSTs new entry link', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await addLoanInObjectEntry('org-1', 'l-1', { entry_id: 'e-1', notes: 'n' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/loans-in/l-1/object-entries',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('DELETEs entry link', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(undefined);
      await removeLoanInObjectEntry('org-1', 'l-1', 'lie-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/loans-in/l-1/object-entries/lie-1',
        { method: 'DELETE' },
      );
    });
  });
});

describe('api/procedure/loans (Loans Out)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getLoansOut', () => {
    it('GETs paginated list', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        items: [],
        total: 0,
        limit: 0,
        offset: 0,
      });
      await getLoansOut('org-1', { status: 'in_transit' });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('status=in_transit');
    });
  });

  describe('getLoanOut', () => {
    it('GETs single loan', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validLoanOut);
      const result = await getLoanOut('org-1', 'lo-1');
      expect(result.loan_out_id).toBe('lo-1');
    });
  });

  describe('createLoanOut', () => {
    it('POSTs new loan', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validLoanOut);
      await createLoanOut('org-1', { loan_purpose: 'exhibition' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/loans-out',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('updateLoanOut', () => {
    it('PUTs updates', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validLoanOut);
      await updateLoanOut('org-1', 'lo-1', { loan_note: 'x' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/loans-out/lo-1',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });

  describe('approveLoanOut', () => {
    it('POSTs board_approval_required body', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validLoanOut);
      await approveLoanOut('org-1', 'lo-1', true);
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/loans-out/lo-1/approve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ board_approval_required: true }),
        }),
      );
    });
  });

  describe('dispatchLoanOut', () => {
    it('POSTs dispatch_date body', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validLoanOut);
      await dispatchLoanOut('org-1', 'lo-1', '2026-03-01');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/loans-out/lo-1/dispatch',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ dispatch_date: '2026-03-01' }),
        }),
      );
    });
  });

  describe('deleteLoanOut', () => {
    it('DELETEs', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ success: true });
      await deleteLoanOut('org-1', 'lo-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/loans-out/lo-1',
        { method: 'DELETE' },
      );
    });
  });
});
