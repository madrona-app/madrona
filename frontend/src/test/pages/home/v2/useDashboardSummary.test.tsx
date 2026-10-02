import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useDashboardSummary } from '../../../../pages/home/v2/useDashboardSummary';

const { getDashboardSummaryMock } = vi.hoisted(() => ({
  getDashboardSummaryMock: vi.fn(),
}));

vi.mock('../../../../lib/api', () => ({
  getDashboardSummary: getDashboardSummaryMock,
}));

const SUMMARY = {
  greeting: { subtitle: 'hi' },
  suggestions: { suggestions: ['a', 'b'] },
  attention: { items: [] },
  pulse: { stats: [], recent_object: null },
  workshop: {
    bridge_running: 0,
    collections_records: 1,
    guide_active_conversations: 0,
    content_drafts: 0,
    media_assets: 0,
  },
  activity: { entries: [] },
};

describe('useDashboardSummary', () => {
  beforeEach(() => {
    getDashboardSummaryMock.mockReset();
  });

  function setup(orgId: string | undefined) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    const { result } = renderHook(() => useDashboardSummary(orgId), {
      wrapper: Wrapper,
    });
    return { client, result };
  }

  it('does not fetch without an orgId', () => {
    setup(undefined);
    expect(getDashboardSummaryMock).not.toHaveBeenCalled();
  });

  it('fans out the bundled response into per-feature query cache keys', async () => {
    getDashboardSummaryMock.mockResolvedValue(SUMMARY);
    const { client } = setup('org-1');

    await waitFor(() => {
      expect(
        client.getQueryData(['dashboard', 'greeting', 'org-1']),
      ).toEqual(SUMMARY.greeting);
    });

    expect(client.getQueryData(['dashboard', 'suggestions', 'org-1'])).toEqual(
      SUMMARY.suggestions,
    );
    expect(client.getQueryData(['dashboard', 'attention-v2', 'org-1'])).toEqual(
      SUMMARY.attention,
    );
    expect(client.getQueryData(['dashboard', 'pulse', 'org-1'])).toEqual(
      SUMMARY.pulse,
    );
    expect(client.getQueryData(['dashboard', 'workshop', 'org-1'])).toEqual(
      SUMMARY.workshop,
    );
    expect(client.getQueryData(['dashboard', 'activity', 'org-1'])).toEqual(
      SUMMARY.activity,
    );
  });

  it('exposes the error via the returned error field', async () => {
    getDashboardSummaryMock.mockRejectedValue(new Error('summary failed'));
    const { result } = setup('org-1');
    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect((result.current.error as Error).message).toBe('summary failed');
  });
});
