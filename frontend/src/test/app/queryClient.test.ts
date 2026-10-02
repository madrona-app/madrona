import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryClient } from '../../app/queryClient';
import { ApiError } from '../../lib/apiClient';
import * as toastModule from '../../contexts/ToastContext';

describe('queryClient', () => {
  it('exports a configured QueryClient instance', () => {
    expect(queryClient).toBeDefined();
    expect(typeof queryClient.getQueryCache).toBe('function');
    expect(typeof queryClient.getMutationCache).toBe('function');
  });

  it('uses a 2-minute staleTime for queries', () => {
    const opts = queryClient.getDefaultOptions();
    expect(opts.queries?.staleTime).toBe(2 * 60 * 1000);
  });

  it('disables refetchOnWindowFocus by default', () => {
    const opts = queryClient.getDefaultOptions();
    expect(opts.queries?.refetchOnWindowFocus).toBe(false);
  });

  it('retries queries once', () => {
    const opts = queryClient.getDefaultOptions();
    expect(opts.queries?.retry).toBe(1);
  });

  describe('mutationCache onError', () => {
    let toastFn: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.clearAllMocks();
      toastFn = vi.fn();
      toastModule.registerGlobalShowToast(toastFn);
    });

    it('shows a generic toast for unknown errors', async () => {
      const cache = queryClient.getMutationCache();
      // Build a fake mutation that calls onError directly
      const mutation = {
        options: {},
        state: { variables: undefined },
        reset: vi.fn(),
        mutate: vi.fn(),
      } as unknown as Parameters<NonNullable<typeof cache.config.onError>>[3];

      cache.config.onError?.(new Error('boom'), undefined, undefined, mutation);

      expect(toastFn).toHaveBeenCalled();
      const call = toastFn.mock.calls[0][0];
      expect(call.type).toBe('error');
      expect(call.message).toMatch(/something went wrong/i);
    });

    it('uses the ApiError message when available', () => {
      const cache = queryClient.getMutationCache();
      const mutation = {
        options: {},
        state: { variables: undefined },
        reset: vi.fn(),
        mutate: vi.fn(),
      } as unknown as Parameters<NonNullable<typeof cache.config.onError>>[3];

      cache.config.onError?.(
        new ApiError('detailed problem', 400),
        undefined,
        undefined,
        mutation,
      );

      expect(toastFn).toHaveBeenCalled();
      expect(toastFn.mock.calls[0][0].message).toBe('detailed problem');
    });

    it('uses a network message for "Failed to fetch"', () => {
      const cache = queryClient.getMutationCache();
      const mutation = {
        options: {},
        state: { variables: undefined },
        reset: vi.fn(),
        mutate: vi.fn(),
      } as unknown as Parameters<NonNullable<typeof cache.config.onError>>[3];

      cache.config.onError?.(
        new TypeError('Failed to fetch'),
        undefined,
        undefined,
        mutation,
      );

      expect(toastFn).toHaveBeenCalled();
      expect(toastFn.mock.calls[0][0].message).toMatch(/network error/i);
    });

    it('skips toast when mutation has its own onError', () => {
      const cache = queryClient.getMutationCache();
      const mutation = {
        options: { onError: vi.fn() },
        state: { variables: undefined },
        reset: vi.fn(),
        mutate: vi.fn(),
      } as unknown as Parameters<NonNullable<typeof cache.config.onError>>[3];

      cache.config.onError?.(new Error('x'), undefined, undefined, mutation);
      expect(toastFn).not.toHaveBeenCalled();
    });

    it('attaches a Retry action that re-executes the mutation', () => {
      const cache = queryClient.getMutationCache();
      const execute = vi.fn().mockResolvedValue(undefined);
      const mutation = {
        options: {},
        state: { variables: { foo: 'bar' } },
        execute,
      } as unknown as Parameters<NonNullable<typeof cache.config.onError>>[3];

      cache.config.onError?.(new Error('x'), undefined, undefined, mutation);

      const action = toastFn.mock.calls[0][0].action;
      expect(action).toBeDefined();
      expect(action.label).toMatch(/retry/i);

      action.onClick();
      expect(execute).toHaveBeenCalledWith({ foo: 'bar' });
    });
  });
});
