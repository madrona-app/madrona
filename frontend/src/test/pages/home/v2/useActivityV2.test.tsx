import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useActivityV2 } from '../../../../pages/home/v2/useActivityV2';

const { useWorkMock, getActivityMock } = vi.hoisted(() => ({
  useWorkMock: vi.fn(),
  getActivityMock: vi.fn(),
}));

vi.mock('../../../../contexts/WorkContext', () => ({
  useWork: useWorkMock,
}));

vi.mock('../../../../lib/api', () => ({
  getActivity: getActivityMock,
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useActivityV2', () => {
  beforeEach(() => {
    useWorkMock.mockReset();
    getActivityMock.mockReset();
    getActivityMock.mockResolvedValue({ entries: [] });
  });

  it('returns empty list when no recent items', () => {
    useWorkMock.mockReturnValue({ recentItems: [] });
    const { result } = renderHook(() => useActivityV2(), { wrapper });
    expect(result.current).toEqual([]);
  });

  it('drops items without a valid /organizations/ path', () => {
    useWorkMock.mockReturnValue({
      recentItems: [
        { id: '1', type: 'object', label: 'Foo', path: '', timestamp: 1 },
        { id: '2', type: 'object', label: 'Bar', path: '/elsewhere/2', timestamp: 2 },
        {
          id: '3',
          type: 'object',
          label: 'Baz',
          path: '/organizations/o/collections/objects/3',
          timestamp: 3,
        },
      ],
    });
    const { result } = renderHook(() => useActivityV2(), { wrapper });
    expect(result.current).toHaveLength(1);
    expect(result.current[0].text).toContain('Baz');
  });

  it('applies type-specific verbs', () => {
    useWorkMock.mockReturnValue({
      recentItems: [
        {
          id: '1',
          type: 'condition_report',
          label: 'CR-001',
          path: '/organizations/o/collections/condition-reports/1',
          timestamp: 1,
        },
        {
          id: '2',
          type: 'incident',
          label: 'INC-001',
          path: '/organizations/o/collections/incidents/2',
          timestamp: 2,
        },
      ],
    });
    const { result } = renderHook(() => useActivityV2(), { wrapper });
    // Entries are sorted by timestamp desc; incident (ts=2) precedes condition (ts=1).
    expect(result.current[0].text).toBe('You opened incident INC-001');
    expect(result.current[1].text).toBe('You opened condition report CR-001');
  });

  it('marks incident kind separately from self-actions', () => {
    useWorkMock.mockReturnValue({
      recentItems: [
        {
          id: '1',
          type: 'incident',
          label: 'INC-1',
          path: '/organizations/o/collections/incidents/1',
          timestamp: 1,
        },
        {
          id: '2',
          type: 'object',
          label: 'OBJ',
          path: '/organizations/o/collections/objects/2',
          timestamp: 2,
        },
      ],
    });
    const { result } = renderHook(() => useActivityV2(), { wrapper });
    // Entries are sorted by timestamp desc; object (ts=2) is first, incident (ts=1) second.
    expect(result.current[0].kind).toBe('self');
    expect(result.current[1].kind).toBe('incident');
  });

  it('caps the list at 8 entries', () => {
    useWorkMock.mockReturnValue({
      recentItems: Array.from({ length: 20 }, (_, i) => ({
        id: String(i),
        type: 'object' as const,
        label: `OBJ-${i}`,
        path: `/organizations/o/collections/objects/${i}`,
        timestamp: i,
      })),
    });
    const { result } = renderHook(() => useActivityV2(), { wrapper });
    expect(result.current).toHaveLength(8);
  });
});
