import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { usePulse } from '../../../../pages/home/v2/usePulse';

const { getPulseMock } = vi.hoisted(() => ({ getPulseMock: vi.fn() }));

vi.mock('../../../../lib/api', () => ({
  getPulse: getPulseMock,
}));

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('usePulse', () => {
  beforeEach(() => {
    getPulseMock.mockReset();
  });

  it('returns an empty PulseData while loading', () => {
    getPulseMock.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => usePulse('org-1'), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toEqual({ stats: [], recentObject: null });
  });

  it('returns empty data when orgId is missing and never fetches', () => {
    const { result } = renderHook(() => usePulse(undefined), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toEqual({ stats: [], recentObject: null });
    expect(getPulseMock).not.toHaveBeenCalled();
  });

  it('passes through stats unchanged', async () => {
    getPulseMock.mockResolvedValue({
      stats: [
        { value: 4, label: 'Loans active' },
        { value: 9, label: 'Open conditions' },
      ],
      recent_object: null,
    });
    const { result } = renderHook(() => usePulse('org-1'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.stats).toHaveLength(2);
    });
    expect(result.current.stats[0]).toEqual({ value: 4, label: 'Loans active' });
  });

  it('prefixes recent_object.href with the org path and renames updated_ago', async () => {
    getPulseMock.mockResolvedValue({
      stats: [],
      recent_object: {
        name: 'Starry Night',
        href: '/collections/objects/sn-1',
        updated_ago: '3 hours ago',
      },
    });
    const { result } = renderHook(() => usePulse('org-1'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.recentObject).not.toBeNull();
    });
    expect(result.current.recentObject).toEqual({
      name: 'Starry Night',
      href: '/organizations/org-1/collections/objects/sn-1',
      updatedAgo: '3 hours ago',
    });
  });

  it('returns recentObject as null when server returns null', async () => {
    getPulseMock.mockResolvedValue({ stats: [], recent_object: null });
    const { result } = renderHook(() => usePulse('org-1'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(getPulseMock).toHaveBeenCalled();
    });
    expect(result.current.recentObject).toBeNull();
  });
});
