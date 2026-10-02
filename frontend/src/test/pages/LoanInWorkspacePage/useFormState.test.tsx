import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFormState } from '../../../pages/collections/LoanInWorkspacePage/useFormState';
import * as api from '../../../lib/api';
import type { LoanIn } from '../../../lib/schemas';

vi.mock('../../../lib/api', () => ({
  createLoanIn: vi.fn(),
  updateLoanIn: vi.fn(),
  deleteLoanIn: vi.fn(),
  rollbackLoanIn: vi.fn(),
}));

const mockCreate = vi.mocked(api.createLoanIn);
const mockUpdate = vi.mocked(api.updateLoanIn);
const mockDelete = vi.mocked(api.deleteLoanIn);
const mockRollback = vi.mocked(api.rollbackLoanIn);

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/organizations/org-1/collections/loans-in/loan-1/edit']}>
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

function makeLoan(overrides: Partial<LoanIn> = {}): LoanIn {
  return {
    loan_in_id: 'loan-1',
    organization_id: 'org-1',
    loan_number: 'LI-2024-001',
    status: 'requested',
    lender_id: 'lender-1',
    loan_purpose: 'exhibition',
    insurance_value: 50000,
    insurance_currency: 'EUR',
    indemnity: true,
    max_renewals: 3,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  } as LoanIn;
}

describe('useFormState (LoanIn)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('starts with default form data when no loan is provided', () => {
      const { result } = renderHook(
        () => useFormState({ orgId: 'org-1', loanId: undefined, isCreateMode: true, entryId: null, loan: undefined }),
        { wrapper: makeWrapper() }
      );

      expect(result.current.formData.lender_id).toBe('');
      expect(result.current.formData.loan_purpose).toBe('exhibition');
      expect(result.current.formData.insurance_currency).toBe('USD');
      expect(result.current.hasUnsavedChanges).toBe(false);
      expect(result.current.saveStatus).toBe('idle');
    });

    it('hydrates form data from a loaded loan', async () => {
      const { result, rerender } = renderHook(
        ({ loan }: { loan?: LoanIn }) => useFormState({
          orgId: 'org-1', loanId: 'loan-1', isCreateMode: false, entryId: null, loan,
        }),
        {
          wrapper: makeWrapper(),
          initialProps: { loan: undefined as LoanIn | undefined },
        }
      );

      rerender({ loan: makeLoan() });

      await waitFor(() => {
        expect(result.current.formData.lender_id).toBe('lender-1');
      });
      expect(result.current.formData.insurance_currency).toBe('EUR');
      expect(result.current.formData.insurance_value).toBe('50000');
      expect(result.current.formData.indemnity).toBe(true);
      expect(result.current.formData.max_renewals).toBe('3');
    });
  });

  describe('updateField', () => {
    it('updates a single form field', () => {
      const { result } = renderHook(
        () => useFormState({ orgId: 'org-1', loanId: undefined, isCreateMode: true, entryId: null, loan: undefined }),
        { wrapper: makeWrapper() }
      );

      act(() => {
        result.current.updateField('lender_id', 'lender-99');
      });
      expect(result.current.formData.lender_id).toBe('lender-99');
    });

    it('flips hasUnsavedChanges when changing values from initialized loan', async () => {
      const { result, rerender } = renderHook(
        ({ loan }: { loan?: LoanIn }) => useFormState({
          orgId: 'org-1', loanId: 'loan-1', isCreateMode: false, entryId: null, loan,
        }),
        {
          wrapper: makeWrapper(),
          initialProps: { loan: undefined as LoanIn | undefined },
        }
      );

      rerender({ loan: makeLoan() });
      await waitFor(() => {
        expect(result.current.formData.lender_id).toBe('lender-1');
      });
      expect(result.current.hasUnsavedChanges).toBe(false);

      act(() => {
        result.current.updateField('insurance_currency', 'GBP');
      });
      expect(result.current.hasUnsavedChanges).toBe(true);
    });
  });

  describe('handleCreateSave', () => {
    it('blocks save when lender_id missing and surfaces error', () => {
      const { result } = renderHook(
        () => useFormState({ orgId: 'org-1', loanId: undefined, isCreateMode: true, entryId: null, loan: undefined }),
        { wrapper: makeWrapper() }
      );

      act(() => {
        result.current.handleCreateSave();
      });
      expect(result.current.errorMessage).toBe('Lender is required');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('calls createLoanIn with prepared payload when lender is set', async () => {
      mockCreate.mockResolvedValue({ loan_in_id: 'new-loan' } as never);

      const { result } = renderHook(
        () => useFormState({ orgId: 'org-1', loanId: undefined, isCreateMode: true, entryId: null, loan: undefined }),
        { wrapper: makeWrapper() }
      );

      act(() => {
        result.current.updateField('lender_id', 'lender-99');
        result.current.updateField('insurance_value', '75000');
      });

      act(() => {
        result.current.handleCreateSave();
      });

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledTimes(1);
      });

      const [orgArg, payloadArg] = mockCreate.mock.calls[0];
      expect(orgArg).toBe('org-1');
      expect((payloadArg as Record<string, unknown>).lender_id).toBe('lender-99');
      // Numeric coercion: insurance_value -> number
      expect((payloadArg as Record<string, unknown>).insurance_value).toBe(75000);
      // Empty strings -> null
      expect((payloadArg as Record<string, unknown>).exhibition_id).toBeNull();
      expect((payloadArg as Record<string, unknown>).loan_purpose).toBe('exhibition');
    });

    it('passes entry_id when creating from object entry', async () => {
      mockCreate.mockResolvedValue({ loan_in_id: 'new-loan' } as never);

      const { result } = renderHook(
        () => useFormState({ orgId: 'org-1', loanId: undefined, isCreateMode: true, entryId: 'entry-42', loan: undefined }),
        { wrapper: makeWrapper() }
      );

      act(() => {
        result.current.updateField('lender_id', 'lender-99');
      });

      act(() => {
        result.current.handleCreateSave();
      });

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalled();
      });
      const [, payload] = mockCreate.mock.calls[0];
      expect((payload as Record<string, unknown>).entry_id).toBe('entry-42');
    });
  });

  describe('mutations', () => {
    it('updateMutation calls updateLoanIn with id args', async () => {
      mockUpdate.mockResolvedValue(makeLoan() as never);

      const { result } = renderHook(
        () => useFormState({ orgId: 'org-1', loanId: 'loan-1', isCreateMode: false, entryId: null, loan: undefined }),
        { wrapper: makeWrapper() }
      );

      act(() => {
        result.current.updateMutation.mutate({ status: 'approved' });
      });
      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith('org-1', 'loan-1', { status: 'approved' });
      });
    });

    it('statusMutation requests a status transition with status payload', async () => {
      mockUpdate.mockResolvedValue(makeLoan({ status: 'approved' }) as never);

      const { result } = renderHook(
        () => useFormState({ orgId: 'org-1', loanId: 'loan-1', isCreateMode: false, entryId: null, loan: undefined }),
        { wrapper: makeWrapper() }
      );

      act(() => {
        result.current.statusMutation.mutate('approved');
      });
      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith('org-1', 'loan-1', { status: 'approved' });
      });
    });

    it('rollbackMutation passes targetStatus and reason', async () => {
      mockRollback.mockResolvedValue(makeLoan({ status: 'requested' }) as never);

      const { result } = renderHook(
        () => useFormState({ orgId: 'org-1', loanId: 'loan-1', isCreateMode: false, entryId: null, loan: undefined }),
        { wrapper: makeWrapper() }
      );

      act(() => {
        result.current.rollbackMutation.mutate({ targetStatus: 'requested', reason: 'undo' });
      });
      await waitFor(() => {
        expect(mockRollback).toHaveBeenCalledWith('org-1', 'loan-1', 'requested', 'undo');
      });
    });

    it('deleteMutation calls deleteLoanIn', async () => {
      mockDelete.mockResolvedValue({ success: true } as never);

      const { result } = renderHook(
        () => useFormState({ orgId: 'org-1', loanId: 'loan-1', isCreateMode: false, entryId: null, loan: undefined }),
        { wrapper: makeWrapper() }
      );

      act(() => {
        result.current.deleteMutation.mutate();
      });
      await waitFor(() => {
        expect(mockDelete).toHaveBeenCalledWith('org-1', 'loan-1');
      });
    });

    it('sets saveStatus = error when create fails', async () => {
      mockCreate.mockRejectedValue(new Error('boom'));

      const { result } = renderHook(
        () => useFormState({ orgId: 'org-1', loanId: undefined, isCreateMode: true, entryId: null, loan: undefined }),
        { wrapper: makeWrapper() }
      );

      act(() => {
        result.current.updateField('lender_id', 'lender-99');
      });
      act(() => {
        result.current.handleCreateSave();
      });

      await waitFor(() => {
        expect(result.current.saveStatus).toBe('error');
      });
    });
  });

  describe('errorMessage', () => {
    it('clears error message when set to null', () => {
      const { result } = renderHook(
        () => useFormState({ orgId: 'org-1', loanId: undefined, isCreateMode: true, entryId: null, loan: undefined }),
        { wrapper: makeWrapper() }
      );

      act(() => {
        result.current.handleCreateSave();
      });
      expect(result.current.errorMessage).toBeTruthy();

      act(() => {
        result.current.setErrorMessage(null);
      });
      expect(result.current.errorMessage).toBeNull();
    });
  });
});
