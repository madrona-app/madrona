import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useStatusMutation,
  useDeleteWithNavigate,
  useInvalidatingMutation,
  useRollbackMutation,
  buildInvalidationConfig,
} from '../../hooks/useDomainMutations';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInvalidateQueries = vi.fn();
const mockSetQueryData = vi.fn();

vi.mock('@tanstack/react-query', () => {
  // Capture the config passed to useMutation so we can invoke callbacks directly.
  return {
    useMutation: (config: Record<string, unknown>) => {
      // Expose the config on the returned object so tests can call mutationFn / onSuccess.
      return {
        mutate: vi.fn(),
        mutateAsync: vi.fn(),
        isLoading: false,
        isPending: false,
        isError: false,
        isSuccess: false,
        isIdle: true,
        data: undefined,
        error: null,
        reset: vi.fn(),
        status: 'idle',
        // Expose internals for test inspection
        _config: config,
      };
    },
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
      setQueryData: mockSetQueryData,
    }),
  };
});

// Helper to extract the internal config from the hook result.
function getConfig(result: { current: unknown }): {
  mutationFn: (...args: unknown[]) => Promise<unknown>;
  onSuccess: (...args: unknown[]) => void;
  onError?: (...args: unknown[]) => void;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (result.current as any)._config;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDomainMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // useStatusMutation
  // -----------------------------------------------------------------------
  describe('useStatusMutation', () => {
    it('calls mutationFn with the new status', async () => {
      const mutationFn = vi.fn().mockResolvedValue({ status: 'approved' });

      const { result } = renderHook(() =>
        useStatusMutation<string>({
          mutationFn,
          invalidation: {
            entityKey: ['loan-in', 'org1', 'loan1'],
            collectionKey: ['loans-in', 'org1'],
          },
        }),
      );

      const config = getConfig(result);
      await config.mutationFn('approved');

      expect(mutationFn).toHaveBeenCalledWith('approved');
    });

    it('invalidates entity and collection query keys on success', () => {
      const mutationFn = vi.fn().mockResolvedValue({ id: '1' });

      const { result } = renderHook(() =>
        useStatusMutation<string>({
          mutationFn,
          invalidation: {
            entityKey: ['loan-in', 'org1', 'loan1'],
            collectionKey: ['loans-in', 'org1'],
          },
        }),
      );

      const config = getConfig(result);
      config.onSuccess({ id: '1' }, 'approved');

      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['loan-in', 'org1', 'loan1'],
      });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['loans-in', 'org1'],
      });
    });

    it('calls onSuccess callback on success', () => {
      const onSuccess = vi.fn();
      const apiResult = { id: '1', status: 'approved' };

      const { result } = renderHook(() =>
        useStatusMutation<string>({
          mutationFn: vi.fn(),
          invalidation: {
            entityKey: ['entity', 'org1', 'e1'],
            collectionKey: ['entities', 'org1'],
          },
          onSuccess,
        }),
      );

      const config = getConfig(result);
      config.onSuccess(apiResult, 'approved');

      expect(onSuccess).toHaveBeenCalledWith(apiResult, 'approved');
    });

    it('uses setQueryData when optimistic is true', () => {
      const apiResult = { id: '1', status: 'done' };

      const { result } = renderHook(() =>
        useStatusMutation<string>({
          mutationFn: vi.fn(),
          invalidation: {
            entityKey: ['entry', 'org1', 'e1'],
            collectionKey: ['entries', 'org1'],
          },
          optimistic: true,
        }),
      );

      const config = getConfig(result);
      config.onSuccess(apiResult, 'done');

      expect(mockSetQueryData).toHaveBeenCalledWith(
        ['entry', 'org1', 'e1'],
        apiResult,
      );
      // Should NOT invalidate the entity key when optimistic
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({
        queryKey: ['entry', 'org1', 'e1'],
      });
    });

    it('defers collection refetch when deferCollectionRefetch is true', () => {
      const { result } = renderHook(() =>
        useStatusMutation<string>({
          mutationFn: vi.fn(),
          invalidation: {
            entityKey: ['entry', 'org1', 'e1'],
            collectionKey: ['entries', 'org1'],
            deferCollectionRefetch: true,
          },
        }),
      );

      const config = getConfig(result);
      config.onSuccess({}, 'done');

      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['entries', 'org1'],
        refetchType: 'none',
      });
    });

    it('invalidates additional keys on success', () => {
      const { result } = renderHook(() =>
        useStatusMutation<string>({
          mutationFn: vi.fn(),
          invalidation: {
            entityKey: ['entry', 'org1', 'e1'],
            collectionKey: ['entries', 'org1'],
            additionalKeys: [['related', 'org1'], ['other']],
          },
        }),
      );

      const config = getConfig(result);
      config.onSuccess({}, 'done');

      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['related', 'org1'],
      });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['other'],
      });
    });
  });

  // -----------------------------------------------------------------------
  // useDeleteWithNavigate
  // -----------------------------------------------------------------------
  describe('useDeleteWithNavigate', () => {
    it('calls deleteFn on mutate', async () => {
      const deleteFn = vi.fn().mockResolvedValue(undefined);
      const navigate = vi.fn();

      const { result } = renderHook(() =>
        useDeleteWithNavigate({
          mutationFn: deleteFn,
          invalidation: { collectionKey: ['entries', 'org1'] },
          navigateTo: '/organizations/org1/collections/entries',
          navigate,
        }),
      );

      const config = getConfig(result);
      await config.mutationFn();

      expect(deleteFn).toHaveBeenCalled();
    });

    it('invalidates collection query key on success', () => {
      const navigate = vi.fn();

      const { result } = renderHook(() =>
        useDeleteWithNavigate({
          mutationFn: vi.fn(),
          invalidation: { collectionKey: ['entries', 'org1'] },
          navigateTo: '/organizations/org1/collections/entries',
          navigate,
        }),
      );

      const config = getConfig(result);
      config.onSuccess();

      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['entries', 'org1'],
      });
    });

    it('navigates to redirectPath on success', () => {
      const navigate = vi.fn();
      const redirectPath = '/organizations/org1/collections/entries';

      const { result } = renderHook(() =>
        useDeleteWithNavigate({
          mutationFn: vi.fn(),
          invalidation: { collectionKey: ['entries', 'org1'] },
          navigateTo: redirectPath,
          navigate,
        }),
      );

      const config = getConfig(result);
      config.onSuccess();

      expect(navigate).toHaveBeenCalledWith(redirectPath);
    });

    it('invalidates entity and additional keys on success', () => {
      const navigate = vi.fn();

      const { result } = renderHook(() =>
        useDeleteWithNavigate({
          mutationFn: vi.fn(),
          invalidation: {
            entityKey: ['entry', 'org1', 'e1'],
            collectionKey: ['entries', 'org1'],
            additionalKeys: [['related', 'org1']],
          },
          navigateTo: '/org/entries',
          navigate,
        }),
      );

      const config = getConfig(result);
      config.onSuccess();

      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['entry', 'org1', 'e1'],
      });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['entries', 'org1'],
      });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['related', 'org1'],
      });
    });
  });

  // -----------------------------------------------------------------------
  // useInvalidatingMutation
  // -----------------------------------------------------------------------
  describe('useInvalidatingMutation', () => {
    it('calls provided mutationFn with input', async () => {
      const mutationFn = vi
        .fn()
        .mockResolvedValue({ id: 'c1', name: 'Coverage A' });

      const { result } = renderHook(() =>
        useInvalidatingMutation<{ name: string }>({
          mutationFn,
          invalidation: {
            additionalKeys: [['coverages', 'org1', 'policy1']],
          },
        }),
      );

      const config = getConfig(result);
      await config.mutationFn({ name: 'Coverage A' });

      expect(mutationFn).toHaveBeenCalledWith({ name: 'Coverage A' });
    });

    it('invalidates all provided query keys on success', () => {
      const { result } = renderHook(() =>
        useInvalidatingMutation<string>({
          mutationFn: vi.fn(),
          invalidation: {
            entityKey: ['policy', 'org1', 'p1'],
            collectionKey: ['policies', 'org1'],
            additionalKeys: [
              ['coverages', 'org1', 'p1'],
              ['stats', 'org1'],
            ],
          },
        }),
      );

      const config = getConfig(result);
      config.onSuccess({ id: '1' }, 'input-data');

      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['policy', 'org1', 'p1'],
      });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['policies', 'org1'],
      });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['coverages', 'org1', 'p1'],
      });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['stats', 'org1'],
      });
    });

    it('calls optional onSuccess callback', () => {
      const onSuccess = vi.fn();
      const apiResult = { id: 'c1' };

      const { result } = renderHook(() =>
        useInvalidatingMutation<string>({
          mutationFn: vi.fn(),
          invalidation: {
            additionalKeys: [['coverages', 'org1']],
          },
          onSuccess,
        }),
      );

      const config = getConfig(result);
      config.onSuccess(apiResult, 'some-input');

      expect(onSuccess).toHaveBeenCalledWith(apiResult, 'some-input');
    });

    it('passes onError to useMutation config', () => {
      const onError = vi.fn();

      const { result } = renderHook(() =>
        useInvalidatingMutation<string>({
          mutationFn: vi.fn(),
          invalidation: {},
          onError,
        }),
      );

      const config = getConfig(result);
      expect(config.onError).toBe(onError);
    });

    it('respects deferCollectionRefetch', () => {
      const { result } = renderHook(() =>
        useInvalidatingMutation<string>({
          mutationFn: vi.fn(),
          invalidation: {
            collectionKey: ['items', 'org1'],
            deferCollectionRefetch: true,
          },
        }),
      );

      const config = getConfig(result);
      config.onSuccess({}, 'input');

      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['items', 'org1'],
        refetchType: 'none',
      });
    });
  });

  // -----------------------------------------------------------------------
  // useRollbackMutation
  // -----------------------------------------------------------------------
  describe('useRollbackMutation', () => {
    it('calls rollbackFn with targetStatus', async () => {
      const rollbackFn = vi
        .fn()
        .mockResolvedValue({ id: '1', status: 'draft' });

      const { result } = renderHook(() =>
        useRollbackMutation({
          mutationFn: rollbackFn,
          invalidation: {
            entityKey: ['loan-in', 'org1', 'loan1'],
            collectionKey: ['loans-in', 'org1'],
          },
        }),
      );

      const config = getConfig(result);
      await config.mutationFn('draft');

      expect(rollbackFn).toHaveBeenCalledWith('draft');
    });

    it('invalidates query keys on success', () => {
      const { result } = renderHook(() =>
        useRollbackMutation({
          mutationFn: vi.fn(),
          invalidation: {
            entityKey: ['loan-in', 'org1', 'loan1'],
            collectionKey: ['loans-in', 'org1'],
          },
        }),
      );

      const config = getConfig(result);
      config.onSuccess({ id: '1', status: 'draft' }, 'draft');

      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['loan-in', 'org1', 'loan1'],
      });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['loans-in', 'org1'],
      });
    });
  });

  // -----------------------------------------------------------------------
  // buildInvalidationConfig
  // -----------------------------------------------------------------------
  describe('buildInvalidationConfig', () => {
    it('builds config from entity and collection keys', () => {
      const config = buildInvalidationConfig(
        ['loan-in', 'org1', 'loan1'],
        ['loans-in', 'org1'],
      );

      expect(config).toEqual({
        entityKey: ['loan-in', 'org1', 'loan1'],
        collectionKey: ['loans-in', 'org1'],
      });
    });

    it('merges overrides', () => {
      const config = buildInvalidationConfig(
        ['loan-in', 'org1', 'loan1'],
        ['loans-in', 'org1'],
        {
          deferCollectionRefetch: true,
          additionalKeys: [['related', 'org1']],
        },
      );

      expect(config).toEqual({
        entityKey: ['loan-in', 'org1', 'loan1'],
        collectionKey: ['loans-in', 'org1'],
        deferCollectionRefetch: true,
        additionalKeys: [['related', 'org1']],
      });
    });

    it('accepts undefined keys', () => {
      const config = buildInvalidationConfig(undefined, undefined);

      expect(config).toEqual({
        entityKey: undefined,
        collectionKey: undefined,
      });
    });
  });
});
