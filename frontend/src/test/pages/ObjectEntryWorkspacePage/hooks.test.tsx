import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// API mocks — must be declared via vi.hoisted before any vi.mock factory runs
// ---------------------------------------------------------------------------

const apiMocks = vi.hoisted(() => ({
  getObjectEntry: vi.fn(),
  createObjectEntry: vi.fn(),
  updateObjectEntry: vi.fn(),
  deleteObjectEntry: vi.fn(),
  getAcquisitions: vi.fn(),
  getEntryLinkedLoans: vi.fn(),
  getObjectExits: vi.fn(),
  generateDocument: vi.fn(),
  getObjectEntryAllMedia: vi.fn(),
  getContact: vi.fn(),
}));

vi.mock('../../../lib/api', () => apiMocks);

// useContactSelector returns an object the hook only forwards. Stub it.
vi.mock('../../../hooks/useContactSelector', () => ({
  useContactSelector: () => ({
    isOpen: false,
    open: vi.fn(),
    close: vi.fn(),
    createSelectHandler: (cb: (id: string) => void) => (id: string) => cb(id),
  }),
}));

// useUnifiedSectionState relies on useSectionOrder which uses AuthContext.
// Stub useSectionOrder to a deterministic empty map.
vi.mock('../../../components/record-detail', () => ({
  useSectionOrder: () => [{}, vi.fn(), vi.fn()],
}));

// fieldHighlight.navigateToSection touches the DOM. Spy on it.
const fieldHighlightMocks = vi.hoisted(() => ({
  navigateToSection: vi.fn(),
}));
vi.mock('../../../lib/fieldHighlight', () => fieldHighlightMocks);

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------

import {
  useEntryForm,
  useSectionState,
  useLinkedRecords,
  useEntryAllMedia,
  useEntryContacts,
  usePdfGeneration,
  useProcedureCompliance,
} from '../../../pages/collections/ObjectEntryWorkspacePage/hooks';
import type {
  EntryFormData,
} from '../../../pages/collections/ObjectEntryWorkspacePage/types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function wrapper(qc = createTestQueryClient()) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const ENTRY_FIXTURE = {
  entry_id: 'entry-1',
  entry_number: 'E.2024.001',
  entry_date: '2024-01-10',
  reason: 'loan_consideration',
  depositor_id: 'c-1',
  depositor_name: 'Jane Lender',
  current_owner_id: '',
  current_owner: '',
  receipt_reference: 'R-001',
  objects_description: 'Painting',
  expected_duration: '6_months',
  expected_return_date: '2024-07-10',
  conditions: '',
  insurance_value: 1500,
  insurance_currency: 'USD',
  insurance_note: '',
  entry_note: 'Note',
  entry_method: 'hand_delivery',
  authorizer_id: '',
  authorizer_name: '',
  authorization_date: '',
  authorization_note: '',
  terms_accepted: true,
  terms_accepted_date: '2024-01-10',
  terms_accepted_by_id: 'c-1',
  acceptance_method: 'signature',
  acceptance_note: '',
  status: 'pending',
  items: [],
  created_at: '2024-01-10T00:00:00Z',
  updated_at: '2024-01-10T00:00:00Z',
};

// ---------------------------------------------------------------------------
// useEntryForm
// ---------------------------------------------------------------------------

describe('useEntryForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getObjectEntry.mockResolvedValue(ENTRY_FIXTURE);
  });

  it('skips fetch in create mode and exposes default form data', () => {
    const { result } = renderHook(
      () => useEntryForm('org-1', undefined, true),
      { wrapper: wrapper() },
    );

    expect(apiMocks.getObjectEntry).not.toHaveBeenCalled();
    expect(result.current.formData.insurance_currency).toBe('USD');
    expect(result.current.formData.acceptance_method).toBe('signature');
    expect(result.current.hasUnsavedChanges).toBe(false);
    expect(result.current.saveStatus).toBe('idle');
  });

  it('fetches and populates form from existing entry', async () => {
    const { result } = renderHook(
      () => useEntryForm('org-1', 'entry-1', false),
      { wrapper: wrapper() },
    );

    await waitFor(() => {
      expect(result.current.entry?.entry_id).toBe('entry-1');
    });
    expect(apiMocks.getObjectEntry).toHaveBeenCalledWith('org-1', 'entry-1');
    expect(result.current.formData.entry_date).toBe('2024-01-10');
    expect(result.current.formData.reason).toBe('loan_consideration');
    expect(result.current.formData.insurance_value).toBe('1500');
    expect(result.current.formData.terms_accepted).toBe(true);
  });

  it('updateField marks form dirty when value differs from server', async () => {
    const { result } = renderHook(
      () => useEntryForm('org-1', 'entry-1', false),
      { wrapper: wrapper() },
    );

    await waitFor(() => {
      expect(result.current.entry).toBeDefined();
    });

    act(() => {
      result.current.updateField('entry_note', 'Changed!');
    });

    expect(result.current.hasUnsavedChanges).toBe(true);
    expect(result.current.formData.entry_note).toBe('Changed!');
  });

  it('handleCreate sends a POST payload through createObjectEntry with parsed insurance_value', async () => {
    apiMocks.createObjectEntry.mockResolvedValue({
      ...ENTRY_FIXTURE,
      entry_id: 'new-entry',
    });

    const { result } = renderHook(
      () => useEntryForm('org-1', undefined, true),
      { wrapper: wrapper() },
    );

    act(() => {
      result.current.updateField('entry_date', '2024-05-01');
      result.current.updateField('reason', 'gift_offer');
      result.current.updateField('insurance_value', '5000');
    });

    await act(async () => {
      await result.current.handleCreate();
    });

    expect(apiMocks.createObjectEntry).toHaveBeenCalledTimes(1);
    const [orgArg, payload] = apiMocks.createObjectEntry.mock.calls[0];
    expect(orgArg).toBe('org-1');
    expect(payload.entry_date).toBe('2024-05-01');
    expect(payload.reason).toBe('gift_offer');
    // Insurance value should be coerced to a number
    expect(payload.insurance_value).toBe(5000);
    // Empty FK should be normalized to null, never empty string
    expect(payload.depositor_id).toBeNull();
    // Stripped fields not in payload (denormalised display names)
    expect(payload.current_owner).toBeUndefined();
    expect(payload.depositor_name).toBeUndefined();
  });

  it('statusMutation forwards status via updateObjectEntry', async () => {
    apiMocks.updateObjectEntry.mockResolvedValue({
      ...ENTRY_FIXTURE,
      status: 'received',
    });

    const { result } = renderHook(
      () => useEntryForm('org-1', 'entry-1', false),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.entry).toBeDefined());

    await act(async () => {
      await result.current.statusMutation.mutateAsync('received');
    });

    expect(apiMocks.updateObjectEntry).toHaveBeenCalledWith(
      'org-1',
      'entry-1',
      { status: 'received' },
    );
  });

  it('deleteMutation calls deleteObjectEntry with org + entry id', async () => {
    apiMocks.deleteObjectEntry.mockResolvedValue(undefined);

    const { result } = renderHook(
      () => useEntryForm('org-1', 'entry-1', false),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.entry).toBeDefined());

    await act(async () => {
      await result.current.deleteMutation.mutateAsync();
    });

    expect(apiMocks.deleteObjectEntry).toHaveBeenCalledWith('org-1', 'entry-1');
  });

  it('triggerSave is a no-op in create mode', () => {
    const { result } = renderHook(
      () => useEntryForm('org-1', undefined, true),
      { wrapper: wrapper() },
    );

    act(() => {
      result.current.triggerSave();
    });

    expect(apiMocks.updateObjectEntry).not.toHaveBeenCalled();
  });

  it('exposes loading + error from the entry query', async () => {
    apiMocks.getObjectEntry.mockRejectedValueOnce(new Error('Not found'));

    const { result } = renderHook(
      () => useEntryForm('org-1', 'missing-entry', false),
      { wrapper: wrapper() },
    );

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });
    expect((result.current.error as Error).message).toBe('Not found');
  });
});

// ---------------------------------------------------------------------------
// useSectionState
// ---------------------------------------------------------------------------

describe('useSectionState', () => {
  it('returns the unified section-state shape with default expanded entry/depositor', () => {
    const { result } = renderHook(() => useSectionState({}), {
      wrapper: wrapper(),
    });

    // Default expanded: entry + depositor are open
    expect(result.current.expandedSections.entry).toBe(true);
    expect(result.current.expandedSections.depositor).toBe(true);
    expect(result.current.expandedSections.history).toBe(false);
    expect(typeof result.current.toggleSection).toBe('function');
    expect(typeof result.current.handleEnterEditMode).toBe('function');
    expect(typeof result.current.lowerAllSections).toBe('function');
    // raiseSection is aliased to handleEnterEditMode for index.tsx compat
    expect(result.current.raiseSection).toBe(result.current.handleEnterEditMode);
  });

  it('toggleSection collapses an open section to accordion-style (others closed)', () => {
    const { result } = renderHook(() => useSectionState({}), {
      wrapper: wrapper(),
    });

    act(() => {
      result.current.toggleSection('insurance');
    });

    // Insurance becomes the only expanded section
    expect(result.current.expandedSections.insurance).toBe(true);
    expect(result.current.expandedSections.entry).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useLinkedRecords
// ---------------------------------------------------------------------------

describe('useLinkedRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getAcquisitions.mockResolvedValue({ items: [] });
    apiMocks.getEntryLinkedLoans.mockResolvedValue({ loans_in: [] });
    apiMocks.getObjectExits.mockResolvedValue({ items: [] });
  });

  it('skips fetches in create mode', () => {
    renderHook(() => useLinkedRecords('org-1', undefined, true), {
      wrapper: wrapper(),
    });
    expect(apiMocks.getAcquisitions).not.toHaveBeenCalled();
    expect(apiMocks.getEntryLinkedLoans).not.toHaveBeenCalled();
    expect(apiMocks.getObjectExits).not.toHaveBeenCalled();
  });

  it('fetches all three linked-record types when an entry id is present', async () => {
    renderHook(() => useLinkedRecords('org-1', 'entry-1', false), {
      wrapper: wrapper(),
    });

    await waitFor(() => {
      expect(apiMocks.getAcquisitions).toHaveBeenCalledWith('org-1', {
        entry_id: 'entry-1',
        limit: 100,
      });
      expect(apiMocks.getEntryLinkedLoans).toHaveBeenCalledWith(
        'org-1',
        'entry-1',
      );
      expect(apiMocks.getObjectExits).toHaveBeenCalledWith('org-1', {
        entry_id: 'entry-1',
        limit: 1,
      });
    });
  });

  it('selects matching acquisition / first loan / first exit', async () => {
    apiMocks.getAcquisitions.mockResolvedValue({
      items: [
        { acquisition_id: 'a-other', entry_id: null },
        { acquisition_id: 'a-1', entry_id: 'entry-1' },
      ],
    });
    apiMocks.getEntryLinkedLoans.mockResolvedValue({
      loans_in: [{ loan_in_id: 'l-1', loan_in_entry_id: 'le-1' }],
    });
    apiMocks.getObjectExits.mockResolvedValue({
      items: [{ exit_id: 'x-1' }],
    });

    const { result } = renderHook(
      () => useLinkedRecords('org-1', 'entry-1', false),
      { wrapper: wrapper() },
    );

    await waitFor(() => {
      expect(result.current.linkedAcquisition?.acquisition_id).toBe('a-1');
      expect(result.current.linkedLoan?.loan_in_id).toBe('l-1');
      expect(result.current.linkedExit?.exit_id).toBe('x-1');
    });
  });
});

// ---------------------------------------------------------------------------
// useEntryAllMedia
// ---------------------------------------------------------------------------

describe('useEntryAllMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array in create mode without fetching', () => {
    const { result } = renderHook(
      () => useEntryAllMedia('org-1', undefined, true),
      { wrapper: wrapper() },
    );

    expect(apiMocks.getObjectEntryAllMedia).not.toHaveBeenCalled();
    expect(result.current.allMedia).toEqual([]);
  });

  it('fetches and surfaces media list', async () => {
    apiMocks.getObjectEntryAllMedia.mockResolvedValue({
      media: [
        { media_id: 'm-1', filename: 'a.jpg', is_primary: true },
        { media_id: 'm-2', filename: 'b.jpg', is_primary: false },
      ],
    });

    const { result } = renderHook(
      () => useEntryAllMedia('org-1', 'entry-1', false),
      { wrapper: wrapper() },
    );

    await waitFor(() => {
      expect(result.current.allMedia.length).toBe(2);
    });
    expect(apiMocks.getObjectEntryAllMedia).toHaveBeenCalledWith(
      'org-1',
      'entry-1',
    );
  });
});

// ---------------------------------------------------------------------------
// useEntryContacts
// ---------------------------------------------------------------------------

describe('useEntryContacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not fetch contacts when ids are empty', () => {
    const formData = {
      depositor_id: '',
      current_owner_id: '',
      authorizer_id: '',
    } as unknown as EntryFormData;

    renderHook(() => useEntryContacts('org-1', formData), {
      wrapper: wrapper(),
    });

    expect(apiMocks.getContact).not.toHaveBeenCalled();
  });

  it('fetches each populated contact id once', async () => {
    apiMocks.getContact.mockImplementation((_org: string, id: string) =>
      Promise.resolve({ contact_id: id, name: `Contact ${id}` }),
    );

    const formData = {
      depositor_id: 'c-1',
      current_owner_id: 'c-2',
      authorizer_id: 'c-3',
    } as unknown as EntryFormData;

    const { result } = renderHook(
      () => useEntryContacts('org-1', formData),
      { wrapper: wrapper() },
    );

    await waitFor(() => {
      expect(result.current.depositorContact?.name).toBe('Contact c-1');
      expect(result.current.currentOwnerContact?.name).toBe('Contact c-2');
      expect(result.current.authorizerContact?.name).toBe('Contact c-3');
    });

    expect(apiMocks.getContact).toHaveBeenCalledWith('org-1', 'c-1');
    expect(apiMocks.getContact).toHaveBeenCalledWith('org-1', 'c-2');
    expect(apiMocks.getContact).toHaveBeenCalledWith('org-1', 'c-3');
  });
});

// ---------------------------------------------------------------------------
// usePdfGeneration
// ---------------------------------------------------------------------------

describe('usePdfGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes a mutation that calls generateDocument with the receipt template + entry id', async () => {
    apiMocks.generateDocument.mockResolvedValue(new Blob(['pdf']));

    // Stub URL.createObjectURL / revokeObjectURL
    const createUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:fake');
    const revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const { result } = renderHook(
      () => usePdfGeneration('org-1', 'entry-1', 'E.2024.001'),
      { wrapper: wrapper() },
    );

    await act(async () => {
      await result.current.generatePdfMutation.mutateAsync();
    });

    expect(apiMocks.generateDocument).toHaveBeenCalledWith(
      'org-1',
      'object_receipt',
      { entry_id: 'entry-1' },
    );
    expect(createUrlSpy).toHaveBeenCalled();
    expect(revokeUrlSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useProcedureCompliance
// ---------------------------------------------------------------------------

describe('useProcedureCompliance', () => {
  const baseFormData = {
    entry_date: '2024-01-10',
    reason: 'loan_consideration',
    depositor_id: 'c-1',
    depositor_name: 'Jane',
    current_owner_id: '',
    current_owner: '',
    receipt_reference: '',
    objects_description: 'Painting',
    expected_duration: '',
    expected_return_date: '',
    conditions: '',
    insurance_value: '',
    insurance_currency: 'USD',
    insurance_note: '',
    entry_note: '',
    entry_method: '',
    authorizer_id: '',
    authorizer_name: '',
    authorization_date: '',
    authorization_note: '',
    terms_accepted: false,
    terms_accepted_date: '',
    terms_accepted_by_id: '',
    acceptance_method: 'signature',
    acceptance_note: '',
  } as EntryFormData;

  beforeEach(() => {
    fieldHighlightMocks.navigateToSection.mockReset();
  });

  it('returns a sectionCompletions map keyed by section id', () => {
    const { result } = renderHook(() =>
      useProcedureCompliance(
        baseFormData,
        'E.2024.001',
        'pending',
        [],
        ['pending', 'received', 'processed'],
        [],
      ),
    );

    expect(result.current.sectionCompletions).toBeDefined();
    // Every section in OBJECT_ENTRY_SECTIONS produces an entry; entry section
    // should report a section completion shape with totalCount > 0.
    expect(result.current.sectionCompletions.entry).toBeDefined();
    expect(
      result.current.sectionCompletions.entry.totalCount,
    ).toBeGreaterThan(0);
  });

  it('reports objects section as not requiredComplete when there are no items', () => {
    const { result } = renderHook(() =>
      useProcedureCompliance(
        baseFormData,
        'E.2024.001',
        'pending',
        [],
        ['pending', 'received'],
        [],
      ),
    );
    expect(result.current.sectionCompletions.objects.requiredComplete).toBe(
      false,
    );
  });

  it('reports objects section as requiredComplete when description and >=1 item', () => {
    const { result } = renderHook(() =>
      useProcedureCompliance(
        baseFormData,
        'E.2024.001',
        'pending',
        [],
        ['pending', 'received'],
        [{ entry_item_id: 'i-1', brief_description: 'A' }],
      ),
    );
    expect(result.current.sectionCompletions.objects.requiredComplete).toBe(
      true,
    );
  });

  it('validateStatusChange returns a structured result', () => {
    const { result } = renderHook(() =>
      useProcedureCompliance(
        baseFormData,
        'E.2024.001',
        'pending',
        [],
        ['pending', 'received', 'processed'],
        [],
      ),
    );
    const validation = result.current.validateStatusChange('received');
    expect(validation).toMatchObject({
      valid: expect.any(Boolean),
      errors: expect.any(Array),
      warnings: expect.any(Array),
    });
  });

  it('handleSectionNavigate expands the target section and calls navigateToSection', () => {
    const { result } = renderHook(() =>
      useProcedureCompliance(
        baseFormData,
        'E.2024.001',
        'pending',
        [],
        ['pending', 'received'],
        [],
      ),
    );

    const setExpanded = vi.fn();
    act(() => {
      result.current.handleSectionNavigate('depositor', 'depositor_id', setExpanded);
    });

    expect(setExpanded).toHaveBeenCalled();
    expect(fieldHighlightMocks.navigateToSection).toHaveBeenCalledWith(
      'depositor',
      'depositor_id',
      expect.objectContaining({
        expandSection: expect.any(Function),
      }),
    );
  });
});
