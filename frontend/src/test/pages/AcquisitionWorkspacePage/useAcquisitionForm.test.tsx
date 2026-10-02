import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAcquisitionForm } from '../../../pages/collections/AcquisitionWorkspacePage/hooks';
import * as api from '../../../lib/api';

vi.mock('../../../lib/api', () => ({
  getAcquisition: vi.fn(),
  createAcquisition: vi.fn(),
  updateAcquisition: vi.fn(),
  deleteAcquisition: vi.fn(),
  rollbackAcquisition: vi.fn(),
  approveAcquisition: vi.fn(),
  completeAcquisition: vi.fn(),
  getObjectEntry: vi.fn(),
}));

const mockGetAcquisition = vi.mocked(api.getAcquisition);
const mockCreateAcquisition = vi.mocked(api.createAcquisition);
const mockUpdateAcquisition = vi.mocked(api.updateAcquisition);
const mockDeleteAcquisition = vi.mocked(api.deleteAcquisition);
const mockRollbackAcquisition = vi.mocked(api.rollbackAcquisition);
const mockApproveAcquisition = vi.mocked(api.approveAcquisition);
const mockCompleteAcquisition = vi.mocked(api.completeAcquisition);
const mockGetObjectEntry = vi.mocked(api.getObjectEntry);

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

const acquisitionFixture = {
  acquisition_id: 'acq-1',
  acquisition_number: 'ACQ-001',
  status: 'proposed',
  acquisition_method: 'gift',
  acquisition_date: '2026-04-01',
  source_id: '',
  source_type: '',
  authorization_date: '',
  authorization_note: '',
  funding_source: '',
  funding_account: '',
  funding_note: '',
  cost: 1000,
  cost_currency: 'USD',
  appraised_value: 1500,
  appraised_value_currency: 'USD',
  appraised_date: '',
  appraiser_name: '',
  legal_status: 'clear',
  legal_note: '',
  provenance_verified: false,
  provenance_note: '',
  provisos: '',
  donor_restrictions: '',
  acquisition_reason: '',
  acknowledgement_date: '',
  acknowledgement_reference: '',
  transfer_of_title_number: '',
  credit_line: '',
  deed_of_gift_date: '',
  deed_of_gift_reference: '',
  board_approval_required: false,
  board_approval_date: '',
  board_approval_reference: '',
  board_note: '',
  objects_count: 2,
  acquisition_note: '',
  internal_note: '',
  accession_number: '',
  accession_date: '',
  accessioning_approved: false,
  accessioning_approved_date: '',
  accessioning_resolution: '',
  accessioning_note: '',
  created_by: 'user-1',
  created_at: '2026-04-01T00:00:00Z',
};

describe('useAcquisitionForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastLocationPath = '';
    mockGetObjectEntry.mockResolvedValue({} as never);
  });

  describe('create mode', () => {
    it('initializes default formData when no acquisitionId', () => {
      const { result } = renderHook(
        () => useAcquisitionForm('org-1', undefined, true),
        { wrapper: createWrapper() }
      );

      expect(result.current.formData.acquisition_method).toBe('gift');
      expect(result.current.formData.cost_currency).toBe('USD');
      expect(result.current.formData.legal_status).toBe('clear');
      expect(result.current.formData.objects_count).toBe(1);
      expect(result.current.acquisition).toBeUndefined();
    });

    it('handleCreate without title produces validation error', async () => {
      const { result } = renderHook(
        () => useAcquisitionForm('org-1', undefined, true),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.handleCreate();
      });

      await waitFor(() => {
        expect(result.current.errorMessage).toBeTruthy();
      });
      expect(mockCreateAcquisition).not.toHaveBeenCalled();
    });

    it('handleCreate succeeds when title field is set', async () => {
      mockCreateAcquisition.mockResolvedValue({ acquisition_id: 'new-acq' } as never);

      const { result } = renderHook(
        () => useAcquisitionForm('org-1', undefined, true),
        { wrapper: createWrapper('/organizations/org-1/collections/acquisitions/create') }
      );

      // Set title (validation rule references 'title')
      act(() => {
        result.current.updateField('title', 'My Acquisition');
        result.current.updateField('acquisition_method', 'purchase');
        result.current.updateField('cost', '100');
      });

      act(() => {
        result.current.handleCreate();
      });

      await waitFor(() => {
        expect(mockCreateAcquisition).toHaveBeenCalledTimes(1);
      });

      const [orgId, payload] = mockCreateAcquisition.mock.calls[0] as [
        string,
        Record<string, unknown>
      ];
      expect(orgId).toBe('org-1');
      expect(payload.acquisition_method).toBe('purchase');
      // build payload converts strings to numbers
      expect(payload.cost).toBe(100);
      expect(payload.objects_count).toBe(1);
      // Empty optional dates serialized as null
      expect(payload.acquisition_date).toBeNull();
    });

    it('navigates to detail after successful create', async () => {
      mockCreateAcquisition.mockResolvedValue({ acquisition_id: 'acq-77' } as never);
      const { result } = renderHook(
        () => useAcquisitionForm('org-1', undefined, true),
        { wrapper: createWrapper('/organizations/org-1/collections/acquisitions/create') }
      );

      act(() => {
        result.current.updateField('title', 'OK');
      });
      act(() => {
        result.current.handleCreate();
      });

      await waitFor(() => {
        expect(lastLocationPath).toBe('/organizations/org-1/collections/acquisitions/acq-77');
      });
    });

    it('does not auto-save when fields update in create mode', async () => {
      const { result } = renderHook(
        () => useAcquisitionForm('org-1', undefined, true),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.updateField('cost', '500');
      });

      // Wait a bit to ensure debounce would have fired
      await waitFor(() => {
        expect(result.current.formData.cost).toBe('500');
      });
      expect(mockUpdateAcquisition).not.toHaveBeenCalled();
    });
  });

  describe('edit mode — load and update', () => {
    it('loads acquisition data into formData', async () => {
      mockGetAcquisition.mockResolvedValue(acquisitionFixture as never);

      const { result } = renderHook(
        () => useAcquisitionForm('org-1', 'acq-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.acquisition).toBeDefined();
      });

      expect(result.current.formData.acquisition_method).toBe('gift');
      expect(result.current.formData.cost).toBe('1000');
      expect(result.current.formData.appraised_value).toBe('1500');
      expect(result.current.formData.objects_count).toBe(2);
    });

    it('returns error when getAcquisition fails', async () => {
      mockGetAcquisition.mockRejectedValue(new Error('boom'));

      const { result } = renderHook(
        () => useAcquisitionForm('org-1', 'acq-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });
    });

    it('triggerSave saves with parsed numeric payload', async () => {
      mockGetAcquisition.mockResolvedValue(acquisitionFixture as never);
      mockUpdateAcquisition.mockResolvedValue({ ...acquisitionFixture } as never);

      const { result } = renderHook(
        () => useAcquisitionForm('org-1', 'acq-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.acquisition).toBeDefined();
      });

      act(() => {
        result.current.updateField('cost', '2500');
      });

      act(() => {
        result.current.triggerSave();
      });

      await waitFor(() => {
        expect(mockUpdateAcquisition).toHaveBeenCalled();
      });
      const [, , payload] = mockUpdateAcquisition.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>
      ];
      expect(payload.cost).toBe(2500);
      expect(payload.objects_count).toBe(2);
    });

    it('triggerSave is no-op when no unsaved changes', async () => {
      mockGetAcquisition.mockResolvedValue(acquisitionFixture as never);

      const { result } = renderHook(
        () => useAcquisitionForm('org-1', 'acq-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.acquisition).toBeDefined();
      });

      act(() => {
        result.current.triggerSave();
      });

      expect(mockUpdateAcquisition).not.toHaveBeenCalled();
    });

    it('marks saved on successful update', async () => {
      mockGetAcquisition.mockResolvedValue(acquisitionFixture as never);
      mockUpdateAcquisition.mockResolvedValue({ ...acquisitionFixture } as never);

      const { result } = renderHook(
        () => useAcquisitionForm('org-1', 'acq-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.acquisition).toBeDefined();
      });

      act(() => {
        result.current.updateField('acquisition_note', 'updated');
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

    it('sets saveStatus to error on update failure', async () => {
      mockGetAcquisition.mockResolvedValue(acquisitionFixture as never);
      mockUpdateAcquisition.mockRejectedValue(new Error('save fail'));

      const { result } = renderHook(
        () => useAcquisitionForm('org-1', 'acq-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.acquisition).toBeDefined();
      });

      act(() => {
        result.current.updateField('acquisition_note', 'oops');
      });
      act(() => {
        result.current.triggerSave();
      });

      await waitFor(() => {
        expect(result.current.saveStatus).toBe('error');
      });
    });
  });

  describe('status transitions', () => {
    it('proposed -> approved calls approveAcquisition', async () => {
      mockGetAcquisition.mockResolvedValue(acquisitionFixture as never);
      mockApproveAcquisition.mockResolvedValue({ ...acquisitionFixture, status: 'approved' } as never);

      const { result } = renderHook(
        () => useAcquisitionForm('org-1', 'acq-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.acquisition).toBeDefined();
      });

      act(() => {
        result.current.statusMutation.mutate('approved');
      });

      await waitFor(() => {
        expect(mockApproveAcquisition).toHaveBeenCalledWith('org-1', 'acq-1');
      });
    });

    it('approved -> completed calls completeAcquisition', async () => {
      mockGetAcquisition.mockResolvedValue({ ...acquisitionFixture, status: 'approved' } as never);
      mockCompleteAcquisition.mockResolvedValue({
        ...acquisitionFixture,
        status: 'completed',
      } as never);

      const { result } = renderHook(
        () => useAcquisitionForm('org-1', 'acq-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.acquisition).toBeDefined();
      });

      act(() => {
        result.current.statusMutation.mutate('completed');
      });

      await waitFor(() => {
        expect(mockCompleteAcquisition).toHaveBeenCalledWith('org-1', 'acq-1');
      });
    });

    it('rollback target proposed calls rollbackAcquisition', async () => {
      mockGetAcquisition.mockResolvedValue({ ...acquisitionFixture, status: 'approved' } as never);
      mockRollbackAcquisition.mockResolvedValue({
        ...acquisitionFixture,
        status: 'proposed',
      } as never);

      const { result } = renderHook(
        () => useAcquisitionForm('org-1', 'acq-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.acquisition).toBeDefined();
      });

      // statusMutation for backward goes through rollback per the hook
      act(() => {
        result.current.statusMutation.mutate('proposed');
      });

      await waitFor(() => {
        expect(mockRollbackAcquisition).toHaveBeenCalledWith(
          'org-1',
          'acq-1',
          'proposed',
          'Status change'
        );
      });
    });

    it('rollbackMutation sends custom reason', async () => {
      mockGetAcquisition.mockResolvedValue({ ...acquisitionFixture, status: 'approved' } as never);
      mockRollbackAcquisition.mockResolvedValue({
        ...acquisitionFixture,
        status: 'proposed',
      } as never);

      const { result } = renderHook(
        () => useAcquisitionForm('org-1', 'acq-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.acquisition).toBeDefined();
      });

      act(() => {
        result.current.rollbackMutation.mutate({
          targetStatus: 'proposed',
          reason: 'Donor pulled out',
        });
      });

      await waitFor(() => {
        expect(mockRollbackAcquisition).toHaveBeenCalledWith(
          'org-1',
          'acq-1',
          'proposed',
          'Donor pulled out'
        );
      });
    });

    it('delete mutation navigates back to list', async () => {
      mockGetAcquisition.mockResolvedValue(acquisitionFixture as never);
      mockDeleteAcquisition.mockResolvedValue({} as never);

      const { result } = renderHook(
        () => useAcquisitionForm('org-1', 'acq-1', false),
        {
          wrapper: createWrapper(
            '/organizations/org-1/collections/acquisitions/acq-1'
          ),
        }
      );

      await waitFor(() => {
        expect(result.current.acquisition).toBeDefined();
      });

      act(() => {
        result.current.deleteMutation.mutate();
      });

      await waitFor(() => {
        expect(mockDeleteAcquisition).toHaveBeenCalledWith('org-1', 'acq-1');
      });
      await waitFor(() => {
        expect(lastLocationPath).toBe('/organizations/org-1/collections/acquisitions');
      });
    });
  });

  describe('linkedEntry', () => {
    it('fetches linked entry when entry_id present', async () => {
      mockGetAcquisition.mockResolvedValue({
        ...acquisitionFixture,
        entry_id: 'entry-7',
      } as never);
      mockGetObjectEntry.mockResolvedValue({
        entry_id: 'entry-7',
        entry_number: 'E-7',
      } as never);

      const { result } = renderHook(
        () => useAcquisitionForm('org-1', 'acq-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(mockGetObjectEntry).toHaveBeenCalledWith('org-1', 'entry-7');
      });
      await waitFor(() => {
        expect(result.current.linkedEntry).toBeDefined();
      });
    });

    it('does not fetch entry when entry_id is missing', async () => {
      mockGetAcquisition.mockResolvedValue(acquisitionFixture as never);

      const { result } = renderHook(
        () => useAcquisitionForm('org-1', 'acq-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.acquisition).toBeDefined();
      });

      // Allow microtasks to flush
      await new Promise(r => setTimeout(r, 50));
      expect(mockGetObjectEntry).not.toHaveBeenCalled();
    });
  });
});
