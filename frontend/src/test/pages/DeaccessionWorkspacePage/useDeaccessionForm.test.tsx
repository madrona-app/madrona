import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useDeaccessionForm } from '../../../pages/collections/DeaccessionWorkspacePage/hooks';
import * as api from '../../../lib/api';

vi.mock('../../../lib/api', () => ({
  getDeaccession: vi.fn(),
  createDeaccession: vi.fn(),
  updateDeaccession: vi.fn(),
  deleteDeaccession: vi.fn(),
  rollbackDeaccession: vi.fn(),
  getContact: vi.fn(),
  getAllLookups: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../hooks/useLookupValues', () => ({
  useLookupValues: () => ({
    getLookup: () => [],
    getLabel: (_k: string, v: string) => v,
    categories: [],
    isLoading: false,
    error: null,
    refetch: () => {},
  }),
}));

const mockGetDeaccession = vi.mocked(api.getDeaccession);
const mockCreateDeaccession = vi.mocked(api.createDeaccession);
const mockUpdateDeaccession = vi.mocked(api.updateDeaccession);
const mockDeleteDeaccession = vi.mocked(api.deleteDeaccession);
const mockRollbackDeaccession = vi.mocked(api.rollbackDeaccession);
const mockGetContact = vi.mocked(api.getContact);

let lastLocationPath = '';
function LocationSink() {
  const location = useLocation();
  // Test-only sink: capture the current pathname for an outer assertion.
  // Reassigning a module-level let from render is a React-purity rule
  // violation in source code, but here it's a deliberate harness for
  // observing route navigation in tests.
  // eslint-disable-next-line react-hooks/globals
  lastLocationPath = location.pathname;
  return null;
}

function createWrapper(initialPath = '/x') {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="*" element={<>{children}<LocationSink /></>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  return Wrapper;
}

const deaccessionFixture = {
  deaccession_id: 'deacc-1',
  deaccession_number: 'DEACC-001',
  status: 'proposed',
  object_id: 'obj-1',
  proposal_date: '2026-04-01',
  reason: 'outside_scope',
  reason_detail: '',
  disposal_method: '',
  disposal_method_detail: '',
  recipient_name: '',
  committee_review_date: '',
  committee_recommendation: '',
  committee_note: '',
  board_approval_required: true,
  board_approval_date: '',
  board_approval_reference: '',
  board_note: '',
  legal_review_date: '',
  legal_review_note: '',
  provenance_review_complete: false,
  provenance_review_note: '',
  appraised_value: 5000,
  appraised_value_currency: 'USD',
  appraised_date: '',
  appraiser_id: '',
  sale_price: null,
  sale_currency: 'USD',
  proceeds_usage: '',
  public_notice_required: false,
  public_notice_date: '',
  public_notice_reference: '',
  deaccession_note: '',
  created_by: 'user-1',
  created_at: '2026-04-01T00:00:00Z',
};

describe('useDeaccessionForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastLocationPath = '';
    mockGetContact.mockResolvedValue({} as never);
  });

  describe('create mode', () => {
    it('initializes default formData with sane defaults', () => {
      const { result } = renderHook(
        () => useDeaccessionForm('org-1', undefined, true),
        { wrapper: createWrapper() }
      );

      expect(result.current.formData.reason).toBe('outside_scope');
      expect(result.current.formData.appraised_value_currency).toBe('USD');
      expect(result.current.formData.board_approval_required).toBe(true);
      expect(result.current.formData.proposal_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.current.deaccession).toBeUndefined();
    });

    it('handleCreate without object_id produces validation error', async () => {
      const { result } = renderHook(
        () => useDeaccessionForm('org-1', undefined, true),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.handleCreate();
      });

      await waitFor(() => {
        expect(result.current.errorMessage).toBeTruthy();
      });
      expect(mockCreateDeaccession).not.toHaveBeenCalled();
    });

    it('handleCreate calls createDeaccession with normalized payload', async () => {
      mockCreateDeaccession.mockResolvedValue({ deaccession_id: 'deacc-new' } as never);
      const { result } = renderHook(
        () => useDeaccessionForm('org-1', undefined, true),
        { wrapper: createWrapper('/organizations/org-1/collections/deaccessions/create') }
      );

      act(() => {
        result.current.updateField('object_id', 'obj-42');
        result.current.updateField('appraised_value', '12345.67');
      });

      act(() => {
        result.current.handleCreate();
      });

      await waitFor(() => {
        expect(mockCreateDeaccession).toHaveBeenCalledTimes(1);
      });

      const [orgId, payload] = mockCreateDeaccession.mock.calls[0] as [
        string,
        Record<string, unknown>
      ];
      expect(orgId).toBe('org-1');
      expect(payload.object_id).toBe('obj-42');
      expect(payload.appraised_value).toBe(12345.67);
      expect(payload.reason).toBe('outside_scope');
      expect(payload.board_approval_required).toBe(true);
      // Empty optional fields become null
      expect(payload.disposal_method).toBeNull();
      expect(payload.recipient_name).toBeNull();
      expect(payload.sale_price).toBeNull();
    });

    it('navigates to detail after successful create', async () => {
      mockCreateDeaccession.mockResolvedValue({ deaccession_id: 'd-9' } as never);
      const { result } = renderHook(
        () => useDeaccessionForm('org-1', undefined, true),
        { wrapper: createWrapper('/organizations/org-1/collections/deaccessions/create') }
      );

      act(() => {
        result.current.updateField('object_id', 'obj-1');
      });
      act(() => {
        result.current.handleCreate();
      });

      await waitFor(() => {
        expect(lastLocationPath).toBe('/organizations/org-1/collections/deaccessions/d-9');
      });
    });

    it('formats error message and sets saveStatus on create failure', async () => {
      mockCreateDeaccession.mockRejectedValue(new Error('400: bad request'));

      const { result } = renderHook(
        () => useDeaccessionForm('org-1', undefined, true),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.updateField('object_id', 'obj-1');
      });
      act(() => {
        result.current.handleCreate();
      });

      await waitFor(() => {
        expect(result.current.saveStatus).toBe('error');
      });
      expect(result.current.errorMessage).toBeTruthy();
    });
  });

  describe('edit mode — load and update', () => {
    it('loads deaccession data into formData', async () => {
      mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);

      const { result } = renderHook(
        () => useDeaccessionForm('org-1', 'deacc-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.deaccession).toBeDefined();
      });

      expect(result.current.formData.object_id).toBe('obj-1');
      expect(result.current.formData.reason).toBe('outside_scope');
      expect(result.current.formData.appraised_value).toBe('5000');
      expect(result.current.formData.board_approval_required).toBe(true);
    });

    it('returns error when getDeaccession fails', async () => {
      mockGetDeaccession.mockRejectedValue(new Error('not found'));

      const { result } = renderHook(
        () => useDeaccessionForm('org-1', 'deacc-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });
    });

    it('triggerSave is no-op when no unsaved changes', async () => {
      mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);
      const { result } = renderHook(
        () => useDeaccessionForm('org-1', 'deacc-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.deaccession).toBeDefined();
      });

      act(() => {
        result.current.triggerSave();
      });

      expect(mockUpdateDeaccession).not.toHaveBeenCalled();
    });

    it('updateField then triggerSave sends parsed payload', async () => {
      mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);
      mockUpdateDeaccession.mockResolvedValue({ ...deaccessionFixture } as never);

      const { result } = renderHook(
        () => useDeaccessionForm('org-1', 'deacc-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.deaccession).toBeDefined();
      });

      act(() => {
        result.current.updateField('appraised_value', '7777');
        result.current.updateField('disposal_method', 'sale');
      });

      act(() => {
        result.current.triggerSave();
      });

      await waitFor(() => {
        expect(mockUpdateDeaccession).toHaveBeenCalled();
      });
      const [, , payload] = mockUpdateDeaccession.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>
      ];
      expect(payload.appraised_value).toBe(7777);
      expect(payload.disposal_method).toBe('sale');
    });

    it('marks saved on successful update', async () => {
      mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);
      mockUpdateDeaccession.mockResolvedValue({ ...deaccessionFixture } as never);

      const { result } = renderHook(
        () => useDeaccessionForm('org-1', 'deacc-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.deaccession).toBeDefined();
      });

      act(() => {
        result.current.updateField('deaccession_note', 'changed');
      });
      act(() => {
        result.current.triggerSave();
      });

      await waitFor(() => {
        expect(result.current.saveStatus).toBe('saved');
      });
      expect(result.current.hasUnsavedChanges).toBe(false);
      expect(result.current.lastSaved).toBeInstanceOf(Date);
    });

    it('sets saveStatus and errorMessage on update failure', async () => {
      mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);
      mockUpdateDeaccession.mockRejectedValue(new Error('save fail'));

      const { result } = renderHook(
        () => useDeaccessionForm('org-1', 'deacc-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.deaccession).toBeDefined();
      });

      act(() => {
        result.current.updateField('deaccession_note', 'oops');
      });
      act(() => {
        result.current.triggerSave();
      });

      await waitFor(() => {
        expect(result.current.saveStatus).toBe('error');
      });
      expect(result.current.errorMessage).toBeTruthy();
    });

    it('boolean updates flow through to payload', async () => {
      mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);
      mockUpdateDeaccession.mockResolvedValue({ ...deaccessionFixture } as never);

      const { result } = renderHook(
        () => useDeaccessionForm('org-1', 'deacc-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.deaccession).toBeDefined();
      });

      act(() => {
        result.current.updateField('provenance_review_complete', true);
        result.current.updateField('board_approval_required', false);
      });
      act(() => {
        result.current.triggerSave();
      });

      await waitFor(() => {
        expect(mockUpdateDeaccession).toHaveBeenCalled();
      });
      const [, , payload] = mockUpdateDeaccession.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>
      ];
      expect(payload.provenance_review_complete).toBe(true);
      expect(payload.board_approval_required).toBe(false);
    });
  });

  describe('status transitions', () => {
    it('forward proposed -> under_review calls updateDeaccession with status', async () => {
      mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);
      mockUpdateDeaccession.mockResolvedValue({
        ...deaccessionFixture,
        status: 'under_review',
      } as never);

      const { result } = renderHook(
        () => useDeaccessionForm('org-1', 'deacc-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.deaccession).toBeDefined();
      });

      act(() => {
        result.current.statusMutation.mutate('under_review');
      });

      await waitFor(() => {
        expect(mockUpdateDeaccession).toHaveBeenCalledWith(
          'org-1',
          'deacc-1',
          { status: 'under_review' }
        );
      });
    });

    it('forward approved -> completed calls updateDeaccession with status', async () => {
      mockGetDeaccession.mockResolvedValue({
        ...deaccessionFixture,
        status: 'approved',
      } as never);
      mockUpdateDeaccession.mockResolvedValue({
        ...deaccessionFixture,
        status: 'completed',
      } as never);

      const { result } = renderHook(
        () => useDeaccessionForm('org-1', 'deacc-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.deaccession).toBeDefined();
      });

      act(() => {
        result.current.statusMutation.mutate('completed');
      });

      await waitFor(() => {
        expect(mockUpdateDeaccession).toHaveBeenCalledWith(
          'org-1',
          'deacc-1',
          { status: 'completed' }
        );
      });
    });

    it('rollback mutation calls rollbackDeaccession with reason', async () => {
      mockGetDeaccession.mockResolvedValue({
        ...deaccessionFixture,
        status: 'approved',
      } as never);
      mockRollbackDeaccession.mockResolvedValue({
        ...deaccessionFixture,
        status: 'pending_board',
      } as never);

      const { result } = renderHook(
        () => useDeaccessionForm('org-1', 'deacc-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.deaccession).toBeDefined();
      });

      act(() => {
        result.current.rollbackMutation.mutate({
          targetStatus: 'pending_board',
          reason: 'Need re-review',
        });
      });

      await waitFor(() => {
        expect(mockRollbackDeaccession).toHaveBeenCalledWith(
          'org-1',
          'deacc-1',
          'pending_board',
          'Need re-review'
        );
      });
    });

    it('delete mutation navigates back to list', async () => {
      mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);
      mockDeleteDeaccession.mockResolvedValue({} as never);

      const { result } = renderHook(
        () => useDeaccessionForm('org-1', 'deacc-1', false),
        {
          wrapper: createWrapper(
            '/organizations/org-1/collections/deaccessions/deacc-1'
          ),
        }
      );

      await waitFor(() => {
        expect(result.current.deaccession).toBeDefined();
      });

      act(() => {
        result.current.deleteMutation.mutate();
      });

      await waitFor(() => {
        expect(mockDeleteDeaccession).toHaveBeenCalledWith('org-1', 'deacc-1');
      });
      await waitFor(() => {
        expect(lastLocationPath).toBe(
          '/organizations/org-1/collections/deaccessions'
        );
      });
    });
  });

  describe('appraiser contact', () => {
    it('fetches appraiser contact when appraiser_id is set', async () => {
      mockGetDeaccession.mockResolvedValue({
        ...deaccessionFixture,
        appraiser_id: 'contact-7',
      } as never);
      mockGetContact.mockResolvedValue({
        contact_id: 'contact-7',
        name: 'Jane Appraiser',
      } as never);

      const { result } = renderHook(
        () => useDeaccessionForm('org-1', 'deacc-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(mockGetContact).toHaveBeenCalledWith('org-1', 'contact-7');
      });
      await waitFor(() => {
        expect(result.current.appraiserContact).toBeDefined();
      });
    });

    it('does not fetch contact when appraiser_id is empty', async () => {
      mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);

      const { result } = renderHook(
        () => useDeaccessionForm('org-1', 'deacc-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.deaccession).toBeDefined();
      });

      await new Promise(r => setTimeout(r, 50));
      expect(mockGetContact).not.toHaveBeenCalled();
    });
  });
});
