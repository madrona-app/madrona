import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useLoanOutForm,
  useSectionManagement,
  useSectionData,
} from '../../../pages/collections/LoanOutWorkspacePage/hooks';
import * as api from '../../../lib/api';
import { apiFetch } from '../../../lib/apiClient';
import type { ExistingLoan } from '../../../pages/collections/LoanOutWorkspacePage/types';
import { defaultFormData } from '../../../pages/collections/LoanOutWorkspacePage/constants';

vi.mock('../../../lib/api', () => ({
  getLoanOut: vi.fn(),
  createLoanOut: vi.fn(),
  updateLoanOut: vi.fn(),
  deleteLoanOut: vi.fn(),
  getContact: vi.fn(),
  // Used by LookupValues elsewhere — kept defined for safety
  getAllLookups: vi.fn(),
}));

vi.mock('../../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

// Stub useSectionOrder so we don't need a Provider/auth context
vi.mock('../../../components/record-detail', async () => {
  const actual = await vi.importActual<typeof import('../../../components/record-detail')>(
    '../../../components/record-detail'
  );
  return {
    ...actual,
    useSectionOrder: () => [{}, vi.fn(), vi.fn()] as ReturnType<typeof actual.useSectionOrder>,
  };
});

const mockGetLoanOut = vi.mocked(api.getLoanOut);
const mockCreateLoanOut = vi.mocked(api.createLoanOut);
const mockUpdateLoanOut = vi.mocked(api.updateLoanOut);
const mockDeleteLoanOut = vi.mocked(api.deleteLoanOut);
const mockGetContact = vi.mocked(api.getContact);
const mockApiFetch = vi.mocked(apiFetch);

function makeWrapper(initialPath = '/organizations/org-1/collections/loans-out/loan-1/edit') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

function makeLoan(overrides: Partial<ExistingLoan> = {}): ExistingLoan {
  return {
    loan_out_id: 'loan-1',
    loan_number: 'LO-2024-001',
    borrower_id: 'borrower-1',
    loan_purpose: 'exhibition',
    insurance_value_total: 100000,
    insurance_currency: 'EUR',
    photography_permitted: true,
    status: 'requested',
    request_date: '2024-01-01',
    venue_address: { street: '1 Main', city: 'Paris', country: 'FR' },
    objects: [],
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('useLoanOutForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContact.mockResolvedValue({ contact_id: 'borrower-1', name: 'Borrower Co' } as never);
  });

  describe('initialization', () => {
    it('starts with default form data in create mode', () => {
      const { result } = renderHook(
        () => useLoanOutForm({ orgId: 'org-1', loanId: undefined, isCreateMode: true }),
        { wrapper: makeWrapper('/organizations/org-1/collections/loans-out/create') }
      );
      expect(result.current.formData.borrower_id).toBe('');
      expect(result.current.formData.loan_purpose).toBe('exhibition');
      expect(result.current.formData.insurance_currency).toBe('USD');
      expect(result.current.hasUnsavedChanges).toBe(false);
      expect(result.current.saveStatus).toBe('idle');
    });

    it('hydrates form data when loan loads', async () => {
      mockGetLoanOut.mockResolvedValue(makeLoan() as never);

      const { result } = renderHook(
        () => useLoanOutForm({ orgId: 'org-1', loanId: 'loan-1', isCreateMode: false }),
        { wrapper: makeWrapper() }
      );

      await waitFor(() => {
        expect(result.current.formData.borrower_id).toBe('borrower-1');
      });
      expect(result.current.formData.insurance_value_total).toBe('100000');
      expect(result.current.formData.insurance_currency).toBe('EUR');
      expect(result.current.formData.venue_city).toBe('Paris');
      expect(result.current.formData.venue_country).toBe('FR');
      expect(result.current.formData.photography_permitted).toBe(true);
    });
  });

  describe('updateField', () => {
    it('marks unsavedChanges true after a change vs hydrated state', async () => {
      mockGetLoanOut.mockResolvedValue(makeLoan() as never);
      const { result } = renderHook(
        () => useLoanOutForm({ orgId: 'org-1', loanId: 'loan-1', isCreateMode: false }),
        { wrapper: makeWrapper() }
      );
      await waitFor(() => {
        expect(result.current.formData.borrower_id).toBe('borrower-1');
      });
      expect(result.current.hasUnsavedChanges).toBe(false);

      act(() => {
        result.current.updateField('insurance_currency', 'GBP');
      });
      expect(result.current.formData.insurance_currency).toBe('GBP');
      expect(result.current.hasUnsavedChanges).toBe(true);
    });
  });

  describe('performSave / preparePayload', () => {
    it('skips save when borrower_id is empty', () => {
      const { result } = renderHook(
        () => useLoanOutForm({ orgId: 'org-1', loanId: undefined, isCreateMode: true }),
        { wrapper: makeWrapper('/organizations/org-1/collections/loans-out/create') }
      );
      act(() => {
        result.current.performSave();
      });
      expect(mockCreateLoanOut).not.toHaveBeenCalled();
    });

    it('calls createLoanOut with prepared payload (creates venue_address only when fields set)', async () => {
      mockCreateLoanOut.mockResolvedValue({ loan_out_id: 'new-loan' } as never);

      const { result } = renderHook(
        () => useLoanOutForm({ orgId: 'org-1', loanId: undefined, isCreateMode: true }),
        { wrapper: makeWrapper('/organizations/org-1/collections/loans-out/create') }
      );

      act(() => {
        result.current.updateField('borrower_id', 'borrower-99');
        result.current.updateField('insurance_value_total', '25000');
      });
      act(() => {
        result.current.performSave();
      });

      await waitFor(() => {
        expect(mockCreateLoanOut).toHaveBeenCalled();
      });
      const [orgArg, payloadArg] = mockCreateLoanOut.mock.calls[0];
      expect(orgArg).toBe('org-1');
      const payload = payloadArg as Record<string, unknown>;
      expect(payload.borrower_id).toBe('borrower-99');
      expect(payload.insurance_value_total).toBe(25000);
      expect(payload.insurance_currency).toBe('USD');
      // venue_address null because no fields set
      expect(payload.venue_address).toBeNull();
    });

    it('calls updateLoanOut in edit mode', async () => {
      mockGetLoanOut.mockResolvedValue(makeLoan() as never);
      mockUpdateLoanOut.mockResolvedValue(makeLoan() as never);

      const { result } = renderHook(
        () => useLoanOutForm({ orgId: 'org-1', loanId: 'loan-1', isCreateMode: false }),
        { wrapper: makeWrapper() }
      );

      await waitFor(() => {
        expect(result.current.formData.borrower_id).toBe('borrower-1');
      });

      act(() => {
        result.current.updateField('insurance_currency', 'GBP');
      });
      act(() => {
        result.current.performSave();
      });

      await waitFor(() => {
        expect(mockUpdateLoanOut).toHaveBeenCalled();
      });
      const [orgArg, idArg, payloadArg] = mockUpdateLoanOut.mock.calls[0];
      expect(orgArg).toBe('org-1');
      expect(idArg).toBe('loan-1');
      expect((payloadArg as Record<string, unknown>).insurance_currency).toBe('GBP');
    });

    it('builds venue_address when at least one field is set', async () => {
      mockCreateLoanOut.mockResolvedValue({ loan_out_id: 'new-loan' } as never);

      const { result } = renderHook(
        () => useLoanOutForm({ orgId: 'org-1', loanId: undefined, isCreateMode: true }),
        { wrapper: makeWrapper('/organizations/org-1/collections/loans-out/create') }
      );

      act(() => {
        result.current.updateField('borrower_id', 'borrower-99');
        result.current.updateField('venue_city', 'Berlin');
      });
      act(() => {
        result.current.performSave();
      });

      await waitFor(() => {
        expect(mockCreateLoanOut).toHaveBeenCalled();
      });
      const [, payloadArg] = mockCreateLoanOut.mock.calls[0];
      const venue = (payloadArg as { venue_address: Record<string, string | null> }).venue_address;
      expect(venue).toBeTruthy();
      expect(venue.city).toBe('Berlin');
    });
  });

  describe('mutations', () => {
    it('statusMutation posts to /status endpoint with body', async () => {
      mockApiFetch.mockResolvedValue({ ok: true } as never);

      const { result } = renderHook(
        () => useLoanOutForm({ orgId: 'org-1', loanId: 'loan-1', isCreateMode: false }),
        { wrapper: makeWrapper() }
      );

      act(() => {
        result.current.statusMutation.mutate('approved');
      });

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalled();
      });
      const [path, init] = mockApiFetch.mock.calls[0];
      expect(path).toBe('/organizations/org-1/collections/loans-out/loan-1/status');
      expect((init as RequestInit)?.method).toBe('POST');
      expect((init as RequestInit)?.body).toBe(JSON.stringify({ status: 'approved' }));
    });

    it('deleteMutation calls deleteLoanOut', async () => {
      mockDeleteLoanOut.mockResolvedValue({ success: true } as never);

      const { result } = renderHook(
        () => useLoanOutForm({ orgId: 'org-1', loanId: 'loan-1', isCreateMode: false }),
        { wrapper: makeWrapper() }
      );

      act(() => {
        result.current.deleteMutation.mutate();
      });
      await waitFor(() => {
        expect(mockDeleteLoanOut).toHaveBeenCalledWith('org-1', 'loan-1');
      });
    });

    it('surfaces error message on create failure', async () => {
      mockCreateLoanOut.mockRejectedValue(new Error('create failed'));

      const { result } = renderHook(
        () => useLoanOutForm({ orgId: 'org-1', loanId: undefined, isCreateMode: true }),
        { wrapper: makeWrapper('/organizations/org-1/collections/loans-out/create') }
      );
      act(() => {
        result.current.updateField('borrower_id', 'borrower-99');
      });
      act(() => {
        result.current.performSave();
      });
      await waitFor(() => {
        expect(result.current.saveStatus).toBe('error');
      });
      expect(result.current.errorMessage).toBeTruthy();
    });
  });

  describe('handleFieldBlur', () => {
    it('saves when blurred with pending changes', async () => {
      mockGetLoanOut.mockResolvedValue(makeLoan() as never);
      mockUpdateLoanOut.mockResolvedValue(makeLoan() as never);

      const { result } = renderHook(
        () => useLoanOutForm({ orgId: 'org-1', loanId: 'loan-1', isCreateMode: false }),
        { wrapper: makeWrapper() }
      );
      await waitFor(() => {
        expect(result.current.formData.borrower_id).toBe('borrower-1');
      });
      act(() => {
        result.current.updateField('insurance_currency', 'GBP');
      });
      act(() => {
        result.current.handleFieldBlur();
      });
      await waitFor(() => {
        expect(mockUpdateLoanOut).toHaveBeenCalled();
      });
    });

    it('does not save in create mode on blur', () => {
      const { result } = renderHook(
        () => useLoanOutForm({ orgId: 'org-1', loanId: undefined, isCreateMode: true }),
        { wrapper: makeWrapper('/organizations/org-1/collections/loans-out/create') }
      );
      act(() => {
        result.current.updateField('borrower_id', 'borrower-99');
      });
      act(() => {
        result.current.handleFieldBlur();
      });
      expect(mockCreateLoanOut).not.toHaveBeenCalled();
    });
  });
});

describe('useSectionManagement', () => {
  it('initializes with overview/objects sections expanded', () => {
    const { result } = renderHook(() => useSectionManagement());
    // overview group: borrower, details (defaultExpanded; only first 2 from first group)
    expect(result.current.expandedSections.borrower).toBe(true);
    expect(result.current.expandedSections.details).toBe(true);
    // objects group is also defaultExpanded
    expect(result.current.expandedSections.objects).toBe(true);
    expect(result.current.expandedSections.dates).toBe(false);
  });

  it('toggleSection collapses an open section when already editing (returns false)', () => {
    const { result } = renderHook(() => useSectionManagement());
    let shouldEdit = true;
    act(() => {
      shouldEdit = result.current.toggleSection('borrower', true /* isEditing */, true /* canEdit */, false /* isCreateMode */, 'org-1', 'loan-1');
    });
    expect(shouldEdit).toBe(false);
    expect(result.current.expandedSections.borrower).toBe(false);
  });

  it('toggleSection on a closed section in view mode returns true (request edit mode)', () => {
    const { result } = renderHook(() => useSectionManagement());
    let shouldEdit = false;
    act(() => {
      shouldEdit = result.current.toggleSection('insurance', false, true, false, 'org-1', 'loan-1');
    });
    expect(shouldEdit).toBe(true);
    expect(result.current.expandedSections.insurance).toBe(true);
  });

  it('handleEnterEditMode focuses a section as the only expanded one', () => {
    const { result } = renderHook(() => useSectionManagement());
    act(() => {
      result.current.handleEnterEditMode('agreement', false, true, false, 'org-1', 'loan-1');
    });
    expect(result.current.expandedSections.agreement).toBe(true);
    expect(result.current.expandedSections.borrower).toBe(false);
  });
});

describe('useSectionData', () => {
  it('exposes all sections in edit mode', () => {
    const { result } = renderHook(() =>
      useSectionData(defaultFormData as never, makeLoan({ objects: [] }), false)
    );
    expect(result.current.sectionIds).toContain('renewals');
    expect(result.current.sectionIds).toContain('history');
    expect(result.current.sectionIds).toContain('discussion');
  });

  it('hides post-creation sections in create mode', () => {
    const { result } = renderHook(() =>
      useSectionData(defaultFormData as never, undefined, true)
    );
    expect(result.current.sectionIds).not.toContain('renewals');
    expect(result.current.sectionIds).not.toContain('monitoring');
    expect(result.current.sectionIds).not.toContain('closing');
    expect(result.current.sectionIds).not.toContain('discussion');
    expect(result.current.sectionIds).not.toContain('history');
    // Still includes overview/objects
    expect(result.current.sectionIds).toContain('borrower');
    expect(result.current.sectionIds).toContain('details');
  });

  it('builds sectionData reflecting form values + loan objects', () => {
    const formData = { ...defaultFormData, borrower_id: 'b-2', loan_purpose: 'research' } as never;
    const loan = makeLoan({ objects: [{ loan_object_id: 'lo-1', loan_out_id: 'loan-1', organization_id: 'org-1', object_id: 'o-1' }], renewal_count: 1, max_renewals: 3 });
    const { result } = renderHook(() => useSectionData(formData, loan, false));
    expect(result.current.sectionData.borrower.borrower_id).toBe('b-2');
    expect(result.current.sectionData.details.loan_purpose).toBe('research');
    expect(result.current.sectionData.objects.objects).toHaveLength(1);
    expect(result.current.sectionData.renewals.renewal_count).toBe(1);
    expect(result.current.sectionData.renewals.max_renewals).toBe(3);
  });
});
