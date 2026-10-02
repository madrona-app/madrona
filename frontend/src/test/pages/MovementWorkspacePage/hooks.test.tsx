import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import * as api from '../../../lib/api';

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api');
  return {
    ...actual,
    getMovement: vi.fn(),
    createMovement: vi.fn(),
    updateMovement: vi.fn(),
    deleteMovement: vi.fn(),
    getCollectionObject: vi.fn(),
    getContact: vi.fn(),
  };
});

const mockCreateMovement = vi.mocked(api.createMovement);
const mockUpdateMovement = vi.mocked(api.updateMovement);
const mockGetMovement = vi.mocked(api.getMovement);
const mockGetCollectionObject = vi.mocked(api.getCollectionObject);
const mockGetContact = vi.mocked(api.getContact);

import { useMovementForm } from '../../../pages/collections/MovementWorkspacePage/hooks';

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  };
}

describe('MovementWorkspacePage hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMovement.mockReset();
    mockGetCollectionObject.mockReset();
    mockGetContact.mockReset();
  });

  describe('useMovementForm', () => {
    it('seeds the form data with the URL params in create mode', () => {
      const { result } = renderHook(
        () => useMovementForm('org-1', undefined, true, 'obj-1', 'loc-1'),
        { wrapper: createWrapper() }
      );
      expect(result.current.formData.object_id).toBe('obj-1');
      expect(result.current.formData.to_location_id).toBe('loc-1');
      expect(result.current.hasUnsavedChanges).toBe(false);
      expect(result.current.saveStatus).toBe('idle');
    });

    it('blocks create when required fields are missing', () => {
      const { result } = renderHook(
        () => useMovementForm('org-1', undefined, true, '', ''),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.handleCreateSave();
      });

      expect(result.current.errorMessage).toBe(
        'Object and destination location are required'
      );
      expect(mockCreateMovement).not.toHaveBeenCalled();
    });

    it('marks the form dirty after updateField in create mode', () => {
      const { result } = renderHook(
        () => useMovementForm('org-1', undefined, true, 'obj-1', 'loc-1'),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.updateField('reason', 'storage');
      });

      expect(result.current.formData.reason).toBe('storage');
      expect(result.current.hasUnsavedChanges).toBe(true);
    });

    it('calls createMovement with the expected payload shape', async () => {
      mockCreateMovement.mockResolvedValue({ movement_id: 'new-1' } as never);

      const { result } = renderHook(
        () => useMovementForm('org-1', undefined, true, 'obj-1', 'loc-2'),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.handleCreateSave();
      });

      await waitFor(() => {
        expect(mockCreateMovement).toHaveBeenCalledWith(
          'org-1',
          expect.objectContaining({
            object_id: 'obj-1',
            to_location_id: 'loc-2',
          })
        );
      });
      const payload = mockCreateMovement.mock.calls[0][1];
      // optional fields default to null when empty.
      expect(payload.from_location_id).toBeNull();
      expect(payload.movement_method).toBeNull();
      expect(payload.organization_courier).toBe(false);
    });

    it('does not trigger update when nothing has changed', async () => {
      const { result } = renderHook(
        () => useMovementForm('org-1', 'mov-1', false, '', ''),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.triggerSave();
      });
      // Should not invoke the update mutation.
      expect(mockUpdateMovement).not.toHaveBeenCalled();
    });
  });
});
