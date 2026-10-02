import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { UseAutoSaveFormOptions } from '../../hooks/useAutoSaveForm';

// --- Mocks ---

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// We'll capture mutation configs so we can invoke onSuccess/onError manually
let mutationConfigs: Record<string, { mutationFn: (...args: unknown[]) => Promise<unknown>; onSuccess?: (result?: unknown) => void; onError?: (error: Error) => void }> = {};
let mutationCallIndex = 0;
const mutationOrder = ['update', 'create', 'delete'];

const mockInvalidateQueries = vi.fn();
const mockQueryClient = { invalidateQueries: mockInvalidateQueries };

vi.mock('@tanstack/react-query', () => ({
  useMutation: (config: { mutationFn: (...args: unknown[]) => Promise<unknown>; onSuccess?: (result?: unknown) => void; onError?: (error: Error) => void }) => {
    const key = mutationOrder[mutationCallIndex % mutationOrder.length];
    mutationConfigs[key] = config;
    mutationCallIndex++;
    return {
      mutate: (...args: unknown[]) => {
        config
          .mutationFn(...args)
          .then((result: unknown) => config.onSuccess?.(result))
          .catch((err: Error) => config.onError?.(err));
      },
    };
  },
  useQueryClient: () => mockQueryClient,
}));

vi.mock('../../lib/formErrors', () => ({
  formatErrorMessage: (message: string, label?: string) =>
    `${label || 'record'}: ${message}`,
}));

// --- Helpers ---

interface TestForm {
  title: string;
  status: string;
}

interface TestServer {
  title: string;
  status: string;
  id: string;
}

function defaultOptions(
  overrides: Partial<UseAutoSaveFormOptions<TestForm, TestServer>> = {},
): UseAutoSaveFormOptions<TestForm, TestServer> {
  return {
    defaultFormData: { title: '', status: 'draft' },
    hydrate: (s) => ({ title: s.title || '', status: s.status || 'draft' }),
    buildPayload: (fd) => ({ title: fd.title || null, status: fd.status }),
    serverData: undefined,
    api: {
      create: vi.fn().mockResolvedValue({ id: 'new-1' }),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    orgId: 'org-1',
    entityId: 'entity-1',
    isCreateMode: false,
    queryKeys: {
      entity: ['test', 'org-1', 'entity-1'],
      collection: ['tests', 'org-1'],
    },
    paths: {
      afterCreate: (r) => `/orgs/org-1/tests/${(r as { id: string }).id}`,
      afterDelete: '/orgs/org-1/tests',
    },
    ...overrides,
  };
}

// Lazy-import hook so mocks are applied first
async function importHook() {
  return (await import('../../hooks/useAutoSaveForm')).useAutoSaveForm;
}

// --- Tests ---

describe('useAutoSaveForm', () => {
  let useAutoSaveForm: Awaited<ReturnType<typeof importHook>>;

  beforeEach(async () => {
    vi.useFakeTimers();
    mutationConfigs = {};
    mutationCallIndex = 0;
    mockNavigate.mockReset();
    mockInvalidateQueries.mockReset();
    useAutoSaveForm = await importHook();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes with defaultFormData in create mode', () => {
    const { result } = renderHook(() =>
      useAutoSaveForm(defaultOptions({ isCreateMode: true })),
    );

    expect(result.current.formData).toEqual({ title: '', status: 'draft' });
    expect(result.current.hasUnsavedChanges).toBe(false);
    expect(result.current.saveStatus).toBe('idle');
  });

  it('hydrates form data from serverData', () => {
    const serverData: TestServer = { title: 'Test', status: 'active', id: '1' };
    const { result } = renderHook(() =>
      useAutoSaveForm(defaultOptions({ serverData })),
    );

    expect(result.current.formData).toEqual({ title: 'Test', status: 'active' });
    expect(result.current.hasUnsavedChanges).toBe(false);
  });

  it('updateField triggers dirty detection (hasUnsavedChanges becomes true)', () => {
    const serverData: TestServer = { title: 'Test', status: 'active', id: '1' };
    const { result } = renderHook(() =>
      useAutoSaveForm(defaultOptions({ serverData })),
    );

    act(() => {
      result.current.updateField('title', 'Changed');
    });

    expect(result.current.formData.title).toBe('Changed');
    expect(result.current.hasUnsavedChanges).toBe(true);
  });

  it('updateField schedules debounced autosave (not in create mode)', () => {
    const api = {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };
    const serverData: TestServer = { title: 'Test', status: 'active', id: '1' };

    const { result } = renderHook(() =>
      useAutoSaveForm(
        defaultOptions({ serverData, api, debounceMs: 500 }),
      ),
    );

    act(() => {
      result.current.updateField('title', 'Changed');
    });

    // Should not have called update yet
    expect(api.update).not.toHaveBeenCalled();

    // Advance past debounce
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(api.update).toHaveBeenCalledWith('org-1', 'entity-1', {
      title: 'Changed',
      status: 'active',
    });
  });

  it('updateField does NOT schedule autosave in create mode', () => {
    const api = {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };

    const { result } = renderHook(() =>
      useAutoSaveForm(
        defaultOptions({ isCreateMode: true, api, debounceMs: 500 }),
      ),
    );

    act(() => {
      result.current.updateField('title', 'New Title');
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(api.update).not.toHaveBeenCalled();
  });

  it('updateFieldSilent updates without triggering autosave', () => {
    const api = {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };
    const serverData: TestServer = { title: 'Test', status: 'active', id: '1' };

    const { result } = renderHook(() =>
      useAutoSaveForm(defaultOptions({ serverData, api })),
    );

    act(() => {
      result.current.updateFieldSilent('title', 'Silent Change');
    });

    expect(result.current.formData.title).toBe('Silent Change');
    expect(result.current.hasUnsavedChanges).toBe(true);

    // Advance well past any debounce
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(api.update).not.toHaveBeenCalled();
  });

  it('performSave calls update API with buildPayload result', () => {
    const api = {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };
    const serverData: TestServer = { title: 'Test', status: 'active', id: '1' };

    const { result } = renderHook(() =>
      useAutoSaveForm(defaultOptions({ serverData, api })),
    );

    // Make a change first so there's something dirty
    act(() => {
      result.current.updateFieldSilent('title', 'Manual Save');
    });

    act(() => {
      result.current.performSave();
    });

    expect(api.update).toHaveBeenCalledWith('org-1', 'entity-1', {
      title: 'Manual Save',
      status: 'active',
    });
  });

  it('handleCreate calls create API and navigates on success', async () => {
    const api = {
      create: vi.fn().mockResolvedValue({ id: 'new-42' }),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };

    const { result } = renderHook(() =>
      useAutoSaveForm(defaultOptions({ isCreateMode: true, api })),
    );

    act(() => {
      result.current.updateFieldSilent('title', 'New Record');
    });

    await act(async () => {
      result.current.handleCreate();
      // Let the promise resolve
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(api.create).toHaveBeenCalledWith('org-1', {
      title: 'New Record',
      status: 'draft',
    });
    expect(mockNavigate).toHaveBeenCalledWith('/orgs/org-1/tests/new-42');
    expect(mockInvalidateQueries).toHaveBeenCalled();
  });

  it('handleCreate validates before creating (when validateCreate provided)', () => {
    const api = {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };
    const validateCreate = vi.fn().mockReturnValue(null);

    const { result } = renderHook(() =>
      useAutoSaveForm(
        defaultOptions({ isCreateMode: true, api, validateCreate }),
      ),
    );

    act(() => {
      result.current.updateFieldSilent('title', 'Valid');
    });

    act(() => {
      result.current.handleCreate();
    });

    expect(validateCreate).toHaveBeenCalled();
    expect(api.create).toHaveBeenCalled();
  });

  it('handleCreate sets errorMessage on validation failure', () => {
    const api = {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };
    const validateCreate = vi.fn().mockReturnValue('Title is required');

    const { result } = renderHook(() =>
      useAutoSaveForm(
        defaultOptions({ isCreateMode: true, api, validateCreate }),
      ),
    );

    act(() => {
      result.current.handleCreate();
    });

    expect(result.current.errorMessage).toBe('Title is required');
    expect(api.create).not.toHaveBeenCalled();
  });

  it('handleDelete calls delete API and navigates on success', async () => {
    const api = {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };

    const { result } = renderHook(() =>
      useAutoSaveForm(defaultOptions({ api })),
    );

    await act(async () => {
      result.current.handleDelete();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(api.delete).toHaveBeenCalledWith('org-1', 'entity-1');
    expect(mockNavigate).toHaveBeenCalledWith('/orgs/org-1/tests');
    expect(mockInvalidateQueries).toHaveBeenCalled();
  });

  it('handleFieldBlur triggers save for blur strategy', () => {
    const api = {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };
    const serverData: TestServer = { title: 'Test', status: 'active', id: '1' };

    const { result } = renderHook(() =>
      useAutoSaveForm(
        defaultOptions({ serverData, api, saveStrategy: 'blur' }),
      ),
    );

    // Make a change (silent, so no debounce scheduled)
    act(() => {
      result.current.updateFieldSilent('title', 'Blurred');
    });

    act(() => {
      result.current.handleFieldBlur();
    });

    expect(api.update).toHaveBeenCalledWith('org-1', 'entity-1', {
      title: 'Blurred',
      status: 'active',
    });
  });

  it('handleFieldBlur does NOT trigger save for debounce strategy', () => {
    const api = {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };
    const serverData: TestServer = { title: 'Test', status: 'active', id: '1' };

    const { result } = renderHook(() =>
      useAutoSaveForm(
        defaultOptions({ serverData, api, saveStrategy: 'debounce' }),
      ),
    );

    act(() => {
      result.current.updateFieldSilent('title', 'Changed');
    });

    act(() => {
      result.current.handleFieldBlur();
    });

    expect(api.update).not.toHaveBeenCalled();
  });

  it('beforeunload listener warns when hasUnsavedChanges is true', () => {
    const serverData: TestServer = { title: 'Test', status: 'active', id: '1' };

    const { result } = renderHook(() =>
      useAutoSaveForm(defaultOptions({ serverData })),
    );

    // Make dirty
    act(() => {
      result.current.updateFieldSilent('title', 'Dirty');
    });

    expect(result.current.hasUnsavedChanges).toBe(true);

    const event = new Event('beforeunload') as BeforeUnloadEvent;
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    window.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('beforeunload listener does NOT warn when no unsaved changes', () => {
    const serverData: TestServer = { title: 'Test', status: 'active', id: '1' };

    renderHook(() => useAutoSaveForm(defaultOptions({ serverData })));

    const event = new Event('beforeunload') as BeforeUnloadEvent;
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    window.dispatchEvent(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it('saveStatus transitions: idle -> saving -> saved -> idle (auto-reset after 2s)', async () => {
    const api = {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };
    const serverData: TestServer = { title: 'Test', status: 'active', id: '1' };

    const { result } = renderHook(() =>
      useAutoSaveForm(defaultOptions({ serverData, api })),
    );

    expect(result.current.saveStatus).toBe('idle');

    // Make dirty and trigger save
    act(() => {
      result.current.updateFieldSilent('title', 'Changed');
    });

    await act(async () => {
      result.current.performSave();
      // Let mutation promise resolve
      await vi.advanceTimersByTimeAsync(0);
    });

    // After successful save, status should be 'saved'
    expect(result.current.saveStatus).toBe('saved');

    // After 2 seconds, should reset to idle
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.saveStatus).toBe('idle');
  });

  it('sets errorMessage and saveStatus to error on API failure', async () => {
    const api = {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockRejectedValue(new Error('Network error')),
      delete: vi.fn().mockResolvedValue({}),
    };
    const serverData: TestServer = { title: 'Test', status: 'active', id: '1' };

    const { result } = renderHook(() =>
      useAutoSaveForm(
        defaultOptions({ serverData, api, entityLabel: 'test item' }),
      ),
    );

    act(() => {
      result.current.updateFieldSilent('title', 'Will fail');
    });

    await act(async () => {
      result.current.performSave();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.saveStatus).toBe('error');
    expect(result.current.errorMessage).toBe('test item: Network error');
  });

  it('create mutation error sets errorMessage', async () => {
    const api = {
      create: vi.fn().mockRejectedValue(new Error('Server error')),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };

    const { result } = renderHook(() =>
      useAutoSaveForm(
        defaultOptions({ isCreateMode: true, api, entityLabel: 'widget' }),
      ),
    );

    await act(async () => {
      result.current.handleCreate();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.saveStatus).toBe('error');
    expect(result.current.errorMessage).toBe('widget: Server error');
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
