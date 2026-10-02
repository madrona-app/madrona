import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useGreeting } from '../../../../pages/home/v2/useGreeting';

const { getGreetingMock } = vi.hoisted(() => ({ getGreetingMock: vi.fn() }));

vi.mock('../../../../lib/api', () => ({
  getGreeting: getGreetingMock,
}));

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useGreeting', () => {
  beforeEach(() => {
    getGreetingMock.mockReset();
  });

  it('returns the fallback subtitle while loading', () => {
    getGreetingMock.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useGreeting('org-1'), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toBe("Welcome back. Here's where things stand.");
  });

  it('returns the fallback when no orgId is provided (query disabled)', () => {
    const { result } = renderHook(() => useGreeting(undefined), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toBe("Welcome back. Here's where things stand.");
    expect(getGreetingMock).not.toHaveBeenCalled();
  });

  it('returns the server subtitle when the query resolves', async () => {
    getGreetingMock.mockResolvedValue({ subtitle: 'A bespoke greeting.' });
    const { result } = renderHook(() => useGreeting('org-1'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current).toBe('A bespoke greeting.');
    });
  });

  it('falls back when the server response has no subtitle', async () => {
    getGreetingMock.mockResolvedValue({ subtitle: undefined } as never);
    const { result } = renderHook(() => useGreeting('org-1'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(getGreetingMock).toHaveBeenCalled();
    });
    expect(result.current).toBe("Welcome back. Here's where things stand.");
  });
});
