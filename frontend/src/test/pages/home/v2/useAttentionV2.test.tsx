import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAttentionV2 } from '../../../../pages/home/v2/useAttentionV2';

const { getAttentionV2Mock } = vi.hoisted(() => ({
  getAttentionV2Mock: vi.fn(),
}));

vi.mock('../../../../lib/api', () => ({
  getAttentionV2: getAttentionV2Mock,
}));

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useAttentionV2', () => {
  beforeEach(() => {
    getAttentionV2Mock.mockReset();
  });

  it('returns an empty list while loading', () => {
    getAttentionV2Mock.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useAttentionV2('org-1'), {
      wrapper: makeWrapper(),
    });
    expect(result.current.items).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('does not fetch when orgId is missing', () => {
    const { result } = renderHook(() => useAttentionV2(undefined), {
      wrapper: makeWrapper(),
    });
    expect(result.current.items).toEqual([]);
    expect(getAttentionV2Mock).not.toHaveBeenCalled();
  });

  it('maps server items into AttentionItem and prefixes href with org path', async () => {
    getAttentionV2Mock.mockResolvedValue({
      items: [
        {
          id: 'i-1',
          type: 'incident',
          severity: 'urgent',
          ref_number: 'INC-001',
          title: 'Title',
          context: 'Context',
          href: '/collections/incidents/i-1',
        },
      ],
    });
    const { result } = renderHook(() => useAttentionV2('org-1'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });
    expect(result.current.items[0]).toEqual({
      id: 'i-1',
      type: 'incident',
      severity: 'urgent',
      refNumber: 'INC-001',
      title: 'Title',
      context: 'Context',
      href: '/organizations/org-1/collections/incidents/i-1',
    });
  });

  it('falls back to "#" href when the server returns no href', async () => {
    getAttentionV2Mock.mockResolvedValue({
      items: [
        {
          id: 'i-2',
          type: 'loan',
          severity: 'this_week',
          ref_number: 'LO-001',
          title: 't',
          context: 'c',
          href: '',
        },
      ],
    });
    const { result } = renderHook(() => useAttentionV2('org-1'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });
    expect(result.current.items[0].href).toBe('#');
  });

  it('exposes errors via the error field', async () => {
    getAttentionV2Mock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useAttentionV2('org-1'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect((result.current.error as Error).message).toBe('boom');
  });
});
