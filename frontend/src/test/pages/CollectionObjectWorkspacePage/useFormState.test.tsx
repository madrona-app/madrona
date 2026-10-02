/**
 * Tests for useFormState — the autosave / form-state hook.
 *
 * useFormState is a stateful hook that wraps create/update mutations,
 * tracks dirty state, and exposes performSave + updateField + handleFieldBlur.
 * It depends on react-query (useMutation) and react-router (navigate), so
 * tests render the hook through a small wrapper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as api from '../../../lib/api';
import { useFormState } from '../../../pages/collections/CollectionObjectWorkspacePage/hooks';
import { makeCollectionObject } from './fixtures';

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>(
    '../../../lib/api',
  );
  return {
    ...actual,
    createCollectionObject: vi.fn(),
    updateCollectionObject: vi.fn(),
    getCollectionObject: vi.fn(),
  };
});

vi.mock('../../../lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockCreate = vi.mocked(api.createCollectionObject);
const mockUpdate = vi.mocked(api.updateCollectionObject);

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return { Wrapper, queryClient };
}

describe('useFormState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create mode', () => {
    it('initializes formData with empty defaults', () => {
      const { Wrapper } = makeWrapper();
      const navigate = vi.fn();
      const { result } = renderHook(
        () => useFormState(undefined, true, true, 'org-1', undefined, navigate),
        { wrapper: Wrapper },
      );
      expect(result.current.formData).not.toBeNull();
      expect(result.current.formData?.object_number).toBe('');
      expect(result.current.formData?.object_status).toBe('pending');
      expect(result.current.formData?.number_of_objects).toBe(1);
    });

    it('starts with hasUnsavedChanges=false and idle save status', () => {
      const { Wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useFormState(undefined, true, true, 'org-1', undefined, vi.fn()),
        { wrapper: Wrapper },
      );
      expect(result.current.hasUnsavedChanges).toBe(false);
      expect(result.current.saveStatus).toBe('idle');
      expect(result.current.lastSaved).toBeNull();
    });

    it('marks hasUnsavedChanges=true when updateField is called with new data', async () => {
      const { Wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useFormState(undefined, true, true, 'org-1', undefined, vi.fn()),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(result.current.formData).not.toBeNull());

      act(() => {
        result.current.updateField('object_number', '2024.999');
      });

      expect(result.current.hasUnsavedChanges).toBe(true);
      expect(result.current.formData?.object_number).toBe('2024.999');
    });

    it('does not mark dirty when updateFieldSilent is called with the same value', async () => {
      const { Wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useFormState(undefined, true, true, 'org-1', undefined, vi.fn()),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(result.current.formData).not.toBeNull());

      act(() => {
        // Silent update should still update form, but here it's the same value
        result.current.updateFieldSilent('object_number', '');
      });

      expect(result.current.hasUnsavedChanges).toBe(false);
    });

    it('calls createCollectionObject when performSave runs and object_number is set', async () => {
      mockCreate.mockResolvedValue(
        makeCollectionObject({ object_id: 'new-obj-1', object_number: '2024.999' }),
      );

      const { Wrapper } = makeWrapper();
      const navigate = vi.fn();
      const { result } = renderHook(
        () => useFormState(undefined, true, true, 'org-1', undefined, navigate),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(result.current.formData).not.toBeNull());

      act(() => {
        result.current.updateField('object_number', '2024.999');
      });

      act(() => {
        result.current.performSave();
      });

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith(
          'org-1',
          expect.objectContaining({ object_number: '2024.999' }),
        );
      });
    });

    it('navigates to the new record on successful create', async () => {
      mockCreate.mockResolvedValue(
        makeCollectionObject({ object_id: 'new-obj-2', object_number: '2024.998' }),
      );

      const { Wrapper } = makeWrapper();
      const navigate = vi.fn();
      const { result } = renderHook(
        () => useFormState(undefined, true, true, 'org-1', undefined, navigate),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(result.current.formData).not.toBeNull());

      act(() => {
        result.current.updateField('object_number', '2024.998');
      });
      act(() => {
        result.current.performSave();
      });

      await waitFor(() => {
        expect(navigate).toHaveBeenCalledWith(
          '/organizations/org-1/collections/objects/new-obj-2',
          { replace: true },
        );
      });
    });

    it('does not save when object_number is empty/whitespace', () => {
      const { Wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useFormState(undefined, true, true, 'org-1', undefined, vi.fn()),
        { wrapper: Wrapper },
      );
      act(() => {
        result.current.performSave();
      });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('surfaces a friendly duplicate-error message on create conflict', async () => {
      mockCreate.mockRejectedValue(new Error('DUPLICATE: object number already exists'));

      const { Wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useFormState(undefined, true, true, 'org-1', undefined, vi.fn()),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(result.current.formData).not.toBeNull());

      act(() => {
        result.current.updateField('object_number', '2024.dup');
      });
      act(() => {
        result.current.performSave();
      });

      await waitFor(() => {
        expect(result.current.saveStatus).toBe('error');
        expect(result.current.errorMessage).toMatch(/already exists/i);
      });
    });
  });

  describe('edit mode', () => {
    it('hydrates formData from object when isEditing becomes true', async () => {
      const { Wrapper } = makeWrapper();
      const obj = makeCollectionObject({
        object_number: '2024.001',
        object_name: 'Vase',
      });
      const { result } = renderHook(
        () => useFormState(obj, false, true, 'org-1', 'obj-123', vi.fn()),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(result.current.formData).not.toBeNull());
      expect(result.current.formData?.object_number).toBe('2024.001');
      expect(result.current.formData?.object_name).toBe('Vase');
    });

    it('calls updateCollectionObject when performSave runs in edit mode', async () => {
      mockUpdate.mockResolvedValue(
        makeCollectionObject({ object_id: 'obj-123', object_number: '2024.001' }),
      );

      const { Wrapper } = makeWrapper();
      const obj = makeCollectionObject({
        object_id: 'obj-123',
        object_number: '2024.001',
      });
      const { result } = renderHook(
        () => useFormState(obj, false, true, 'org-1', 'obj-123', vi.fn()),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(result.current.formData).not.toBeNull());

      act(() => {
        result.current.updateField('brief_description', 'Updated description');
      });
      act(() => {
        result.current.performSave();
      });

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith(
          'org-1',
          'obj-123',
          expect.objectContaining({
            brief_description: 'Updated description',
            object_number: '2024.001',
          }),
        );
      });
    });

    it('triggers performSave from handleFieldBlur when the form is dirty', async () => {
      mockUpdate.mockResolvedValue(
        makeCollectionObject({ object_id: 'obj-123', object_number: '2024.001' }),
      );

      const { Wrapper } = makeWrapper();
      const obj = makeCollectionObject({
        object_id: 'obj-123',
        object_number: '2024.001',
      });
      const { result } = renderHook(
        () => useFormState(obj, false, true, 'org-1', 'obj-123', vi.fn()),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(result.current.formData).not.toBeNull());

      act(() => {
        result.current.updateField('object_name', 'Renamed Vase');
      });
      act(() => {
        result.current.handleFieldBlur();
      });

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
      });
    });

    it('updates saveStatus to "saved" on successful update', async () => {
      mockUpdate.mockResolvedValue(
        makeCollectionObject({
          object_id: 'obj-123',
          object_number: '2024.001',
          updated_at: '2024-04-15T13:00:00Z',
        }),
      );

      const { Wrapper } = makeWrapper();
      const obj = makeCollectionObject({
        object_id: 'obj-123',
        object_number: '2024.001',
      });
      const { result } = renderHook(
        () => useFormState(obj, false, true, 'org-1', 'obj-123', vi.fn()),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(result.current.formData).not.toBeNull());

      act(() => {
        result.current.updateField('comments', 'Some comment');
      });
      act(() => {
        result.current.performSave();
      });

      await waitFor(() => {
        expect(result.current.saveStatus).toBe('saved');
        expect(result.current.lastSaved).not.toBeNull();
        expect(result.current.hasUnsavedChanges).toBe(false);
      });
    });

    it('sets saveStatus="error" with errorMessage on a generic update failure', async () => {
      mockUpdate.mockRejectedValue(new Error('Boom'));

      const { Wrapper } = makeWrapper();
      const obj = makeCollectionObject({
        object_id: 'obj-123',
        object_number: '2024.001',
      });
      const { result } = renderHook(
        () => useFormState(obj, false, true, 'org-1', 'obj-123', vi.fn()),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(result.current.formData).not.toBeNull());

      act(() => {
        result.current.updateField('object_name', 'Fail');
      });
      act(() => {
        result.current.performSave();
      });

      await waitFor(() => {
        expect(result.current.saveStatus).toBe('error');
        expect(result.current.errorMessage).toBe('Boom');
      });
    });
  });

  describe('mode toggling', () => {
    it('clears formData when isEditing becomes false', async () => {
      const { Wrapper } = makeWrapper();
      const obj = makeCollectionObject({
        object_id: 'obj-123',
        object_number: '2024.001',
      });

      const { result, rerender } = renderHook(
        ({ isEditing }: { isEditing: boolean }) =>
          useFormState(obj, false, isEditing, 'org-1', 'obj-123', vi.fn()),
        {
          wrapper: Wrapper,
          initialProps: { isEditing: true },
        },
      );

      await waitFor(() => expect(result.current.formData).not.toBeNull());

      rerender({ isEditing: false });

      await waitFor(() => {
        expect(result.current.formData).toBeNull();
        expect(result.current.hasUnsavedChanges).toBe(false);
      });
    });
  });
});
