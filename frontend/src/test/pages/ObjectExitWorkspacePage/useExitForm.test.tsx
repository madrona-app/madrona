import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useExitForm } from '../../../pages/collections/ObjectExitWorkspacePage/hooks';
import * as api from '../../../lib/api';

vi.mock('../../../lib/api', () => ({
  getObjectExit: vi.fn(),
  createObjectExit: vi.fn(),
  updateObjectExit: vi.fn(),
  deleteObjectExit: vi.fn(),
  rollbackObjectExit: vi.fn(),
  getObjectEntry: vi.fn(),
  generateDocument: vi.fn(),
  getContact: vi.fn(),
}));

const mockGetObjectExit = vi.mocked(api.getObjectExit);
const mockCreateObjectExit = vi.mocked(api.createObjectExit);
const mockUpdateObjectExit = vi.mocked(api.updateObjectExit);
const mockDeleteObjectExit = vi.mocked(api.deleteObjectExit);
const mockRollbackObjectExit = vi.mocked(api.rollbackObjectExit);
const mockGetObjectEntry = vi.mocked(api.getObjectEntry);
const mockGenerateDocument = vi.mocked(api.generateDocument);
const mockGetContact = vi.mocked(api.getContact);

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

describe('useExitForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastLocationPath = '';
    mockGetObjectEntry.mockResolvedValue({} as never);
    mockGetContact.mockResolvedValue({} as never);
  });

  describe('create mode', () => {
    it('initializes with default form data when no exit id', () => {
      const { result } = renderHook(
        () => useExitForm('org-1', undefined, true),
        { wrapper: createWrapper() }
      );
      expect(result.current.formData.exit_reason).toBe('other');
      expect(result.current.formData.exit_date).toBe('');
      expect(result.current.hasUnsavedChanges).toBe(false);
      expect(result.current.saveStatus).toBe('idle');
      expect(result.current.exit).toBeUndefined();
    });

    it('does not auto-save in create mode when fields update', async () => {
      const { result } = renderHook(
        () => useExitForm('org-1', undefined, true),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.updateField('recipient_name', 'Acme Museum');
      });

      // No auto-save - mutation never triggered
      await waitFor(() => {
        expect(result.current.formData.recipient_name).toBe('Acme Museum');
      });
      expect(mockUpdateObjectExit).not.toHaveBeenCalled();
    });

    it('handleCreate calls createObjectExit with payload (nulls for empties)', async () => {
      mockCreateObjectExit.mockResolvedValue({ exit_id: 'exit-new' } as never);
      const { result } = renderHook(
        () => useExitForm('org-1', undefined, true),
        { wrapper: createWrapper('/organizations/org-1/collections/exits/create') }
      );

      act(() => {
        result.current.updateField('recipient_name', 'Test Recipient');
        result.current.updateField('exit_date', '2026-04-01');
      });

      act(() => {
        result.current.handleCreate();
      });

      await waitFor(() => {
        expect(mockCreateObjectExit).toHaveBeenCalledTimes(1);
      });

      const [orgIdArg, payload] = mockCreateObjectExit.mock.calls[0];
      expect(orgIdArg).toBe('org-1');
      expect((payload as Record<string, unknown>).recipient_name).toBe('Test Recipient');
      expect((payload as Record<string, unknown>).exit_date).toBe('2026-04-01');
      // Empty strings turn into nulls in build payload
      expect((payload as Record<string, unknown>).tracking_number).toBeNull();
      expect((payload as Record<string, unknown>).exit_note).toBeNull();
    });

    it('navigates to detail page after successful create', async () => {
      mockCreateObjectExit.mockResolvedValue({ exit_id: 'exit-99' } as never);
      const { result } = renderHook(
        () => useExitForm('org-1', undefined, true),
        { wrapper: createWrapper('/organizations/org-1/collections/exits/create') }
      );

      act(() => {
        result.current.handleCreate();
      });

      await waitFor(() => {
        expect(lastLocationPath).toBe('/organizations/org-1/collections/exits/exit-99');
      });
    });

    it('sets saveStatus to error when create fails', async () => {
      mockCreateObjectExit.mockRejectedValue(new Error('boom'));
      const { result } = renderHook(
        () => useExitForm('org-1', undefined, true),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.handleCreate();
      });

      await waitFor(() => {
        expect(result.current.saveStatus).toBe('error');
      });
    });
  });

  describe('edit mode — load and update', () => {
    const exitFixture = {
      exit_id: 'exit-1',
      exit_number: 'EXIT-001',
      status: 'pending',
      exit_date: '2026-04-01',
      exit_reason: 'loan',
      exit_method: 'shipped',
      recipient_name: 'Test Recipient',
      packing_method: 'crate',
      shipping_method: 'truck',
      shipping_company: 'Acme',
      tracking_number: '1Z999',
      courier_id: '',
      condition_at_exit: 'good',
      authorization_date: '2026-03-30',
      authorization_note: 'authorized',
      receipt_reference: '',
      receipt_note: '',
      exit_note: '',
      internal_note: '',
      receipt_acknowledged: false,
      entry_id: null,
    };

    it('loads exit data and populates formData', async () => {
      mockGetObjectExit.mockResolvedValue(exitFixture as never);
      const { result } = renderHook(
        () => useExitForm('org-1', 'exit-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.exit).toBeDefined();
      });

      expect(result.current.formData.exit_number ?? '').toBeDefined();
      expect(result.current.formData.recipient_name).toBe('Test Recipient');
      expect(result.current.formData.exit_reason).toBe('loan');
      expect(result.current.isLoading).toBe(false);
    });

    it('returns error when getObjectExit rejects', async () => {
      mockGetObjectExit.mockRejectedValue(new Error('not found'));
      const { result } = renderHook(
        () => useExitForm('org-1', 'exit-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });
    });

    it('updateField sets hasUnsavedChanges and schedules auto-save', async () => {
      mockGetObjectExit.mockResolvedValue(exitFixture as never);
      mockUpdateObjectExit.mockResolvedValue({ ...exitFixture } as never);

      const { result } = renderHook(
        () => useExitForm('org-1', 'exit-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.exit).toBeDefined();
      });

      act(() => {
        result.current.updateField('exit_note', 'updated note');
      });

      expect(result.current.hasUnsavedChanges).toBe(true);
      expect(result.current.formData.exit_note).toBe('updated note');

      // Eventually the 1s debounce fires and update is called
      await waitFor(() => {
        expect(mockUpdateObjectExit).toHaveBeenCalled();
      }, { timeout: 2000 });

      const [, , payload] = mockUpdateObjectExit.mock.calls[0];
      expect((payload as Record<string, unknown>).exit_note).toBe('updated note');
    });

    it('triggerSave is no-op when no unsaved changes', async () => {
      mockGetObjectExit.mockResolvedValue(exitFixture as never);
      const { result } = renderHook(
        () => useExitForm('org-1', 'exit-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.exit).toBeDefined();
      });

      act(() => {
        result.current.triggerSave();
      });

      expect(mockUpdateObjectExit).not.toHaveBeenCalled();
    });

    it('marks saved on successful update', async () => {
      mockGetObjectExit.mockResolvedValue(exitFixture as never);
      mockUpdateObjectExit.mockResolvedValue({ ...exitFixture } as never);

      const { result } = renderHook(
        () => useExitForm('org-1', 'exit-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.exit).toBeDefined();
      });

      act(() => {
        result.current.updateField('exit_note', 'changed');
      });

      // direct trigger
      act(() => {
        result.current.triggerSave();
      });

      await waitFor(() => {
        expect(result.current.saveStatus).toBe('saved');
      });
      expect(result.current.hasUnsavedChanges).toBe(false);
      expect(result.current.lastSaved).toBeInstanceOf(Date);
    });

    it('sets saveStatus to error when update fails', async () => {
      mockGetObjectExit.mockResolvedValue(exitFixture as never);
      mockUpdateObjectExit.mockRejectedValue(new Error('save fail'));

      const { result } = renderHook(
        () => useExitForm('org-1', 'exit-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.exit).toBeDefined();
      });

      act(() => {
        result.current.updateField('exit_note', 'will fail');
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
    const exitFixture = {
      exit_id: 'exit-1',
      exit_number: 'EXIT-001',
      status: 'pending',
      exit_date: '',
      exit_reason: 'loan',
      exit_method: '',
      recipient_name: '',
      packing_method: '',
      shipping_method: '',
      shipping_company: '',
      tracking_number: '',
      courier_id: '',
      condition_at_exit: '',
      authorization_date: '',
      authorization_note: '',
      receipt_reference: '',
      receipt_note: '',
      exit_note: '',
      internal_note: '',
      receipt_acknowledged: false,
    };

    it('forward transition pending -> preparing calls updateObjectExit with status', async () => {
      mockGetObjectExit.mockResolvedValue(exitFixture as never);
      mockUpdateObjectExit.mockResolvedValue({ ...exitFixture, status: 'preparing' } as never);

      const { result } = renderHook(
        () => useExitForm('org-1', 'exit-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.exit).toBeDefined();
      });

      act(() => {
        result.current.statusMutation.mutate('preparing');
      });

      await waitFor(() => {
        expect(mockUpdateObjectExit).toHaveBeenCalled();
      });
      const [, , payload] = mockUpdateObjectExit.mock.calls[0];
      expect(payload).toEqual({ status: 'preparing' });
    });

    it('rollback mutation calls rollbackObjectExit with reason', async () => {
      mockGetObjectExit.mockResolvedValue({ ...exitFixture, status: 'dispatched' } as never);
      mockRollbackObjectExit.mockResolvedValue({ ...exitFixture, status: 'pending' } as never);

      const { result } = renderHook(
        () => useExitForm('org-1', 'exit-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.exit).toBeDefined();
      });

      act(() => {
        result.current.rollbackMutation.mutate({ targetStatus: 'pending', reason: 'Mistake' });
      });

      await waitFor(() => {
        expect(mockRollbackObjectExit).toHaveBeenCalledWith(
          'org-1', 'exit-1', 'pending', 'Mistake'
        );
      });
    });

    it('delete mutation navigates back to list on success', async () => {
      mockGetObjectExit.mockResolvedValue(exitFixture as never);
      mockDeleteObjectExit.mockResolvedValue({} as never);

      const { result } = renderHook(
        () => useExitForm('org-1', 'exit-1', false),
        { wrapper: createWrapper('/organizations/org-1/collections/exits/exit-1') }
      );

      await waitFor(() => {
        expect(result.current.exit).toBeDefined();
      });

      act(() => {
        result.current.deleteMutation.mutate();
      });

      await waitFor(() => {
        expect(mockDeleteObjectExit).toHaveBeenCalledWith('org-1', 'exit-1');
      });
      await waitFor(() => {
        expect(lastLocationPath).toBe('/organizations/org-1/collections/exits');
      });
    });

    it('generatePdfMutation calls generateDocument with packing_list', async () => {
      mockGetObjectExit.mockResolvedValue(exitFixture as never);
      const fakeBlob = new Blob(['pdf'], { type: 'application/pdf' });
      mockGenerateDocument.mockResolvedValue(fakeBlob as never);

      // Mock URL.createObjectURL
      const origCreate = URL.createObjectURL;
      const origRevoke = URL.revokeObjectURL;
      URL.createObjectURL = vi.fn(() => 'blob:fake');
      URL.revokeObjectURL = vi.fn();

      try {
        const { result } = renderHook(
          () => useExitForm('org-1', 'exit-1', false),
          { wrapper: createWrapper() }
        );

        await waitFor(() => {
          expect(result.current.exit).toBeDefined();
        });

        act(() => {
          result.current.generatePdfMutation.mutate();
        });

        await waitFor(() => {
          expect(mockGenerateDocument).toHaveBeenCalledWith(
            'org-1',
            'packing_list',
            { exit_id: 'exit-1' }
          );
        });
      } finally {
        URL.createObjectURL = origCreate;
        URL.revokeObjectURL = origRevoke;
      }
    });
  });

  describe('linkedEntry', () => {
    it('fetches linked entry when exit has entry_id', async () => {
      mockGetObjectExit.mockResolvedValue({
        exit_id: 'exit-1',
        exit_number: 'E1',
        status: 'pending',
        entry_id: 'entry-9',
      } as never);
      mockGetObjectEntry.mockResolvedValue({
        entry_id: 'entry-9',
        entry_number: 'ENT-9',
      } as never);

      const { result } = renderHook(
        () => useExitForm('org-1', 'exit-1', false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(mockGetObjectEntry).toHaveBeenCalledWith('org-1', 'entry-9');
      });
      await waitFor(() => {
        expect(result.current.linkedEntry).toBeDefined();
      });
    });
  });
});
