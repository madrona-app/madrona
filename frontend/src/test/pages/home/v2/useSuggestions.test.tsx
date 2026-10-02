import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSuggestions } from '../../../../pages/home/v2/useSuggestions';

const { getSuggestionsMock } = vi.hoisted(() => ({
  getSuggestionsMock: vi.fn(),
}));

vi.mock('../../../../lib/api', () => ({
  getSuggestions: getSuggestionsMock,
}));

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useSuggestions', () => {
  beforeEach(() => {
    getSuggestionsMock.mockReset();
  });

  it('returns an empty array while loading', () => {
    getSuggestionsMock.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useSuggestions('org-1'), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toEqual([]);
  });

  it('does not fetch when orgId is missing', () => {
    const { result } = renderHook(() => useSuggestions(undefined), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toEqual([]);
    expect(getSuggestionsMock).not.toHaveBeenCalled();
  });

  it('returns the server suggestions when the query resolves', async () => {
    getSuggestionsMock.mockResolvedValue({
      suggestions: ['Show me recent loans', 'How many objects?', 'Filter by date'],
    });
    const { result } = renderHook(() => useSuggestions('org-1'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current).toEqual([
        'Show me recent loans',
        'How many objects?',
        'Filter by date',
      ]);
    });
  });

  it('returns an empty array when the response has no suggestions field', async () => {
    getSuggestionsMock.mockResolvedValue({} as never);
    const { result } = renderHook(() => useSuggestions('org-1'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(getSuggestionsMock).toHaveBeenCalled();
    });
    expect(result.current).toEqual([]);
  });
});
