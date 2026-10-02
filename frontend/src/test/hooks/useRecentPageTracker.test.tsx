import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRecentPageTracker } from '../../hooks/useRecentPageTracker';

const { mockAddRecentItem, mockRemoveRecentItem, mockParseRecordRoute } = vi.hoisted(() => ({
  mockAddRecentItem: vi.fn(),
  mockRemoveRecentItem: vi.fn(),
  mockParseRecordRoute: vi.fn(),
}));

// Mock WorkContext
vi.mock('../../contexts/WorkContext', () => ({
  useWork: vi.fn().mockReturnValue({
    recentItems: [],
    addRecentItem: mockAddRecentItem,
    removeRecentItem: mockRemoveRecentItem,
  }),
}));

// Mock recentPageConfig
vi.mock('../../lib/recentPageConfig', () => ({
  parseRecordRoute: mockParseRecordRoute,
}));

function createWrapper(initialRoute: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialRoute]}>
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe('useRecentPageTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockParseRecordRoute.mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing for non-record routes', () => {
    mockParseRecordRoute.mockReturnValue(null);

    renderHook(() => useRecentPageTracker(), {
      wrapper: createWrapper('/organizations/org-1/collections/objects'),
    });

    // Advance past the initial 500ms timeout
    vi.advanceTimersByTime(500);

    expect(mockAddRecentItem).not.toHaveBeenCalled();
  });

  it('parses the current route on mount', () => {
    renderHook(() => useRecentPageTracker(), {
      wrapper: createWrapper('/organizations/org-1/collections/objects/obj-123'),
    });

    expect(mockParseRecordRoute).toHaveBeenCalledWith(
      '/organizations/org-1/collections/objects/obj-123'
    );
  });

  it('strips /edit suffix for canonical path comparison', () => {
    mockParseRecordRoute.mockReturnValue({
      orgId: 'org-1',
      recordId: 'obj-123',
      config: {
        type: 'object',
        queryKeyPrefix: 'collection-object',
        labelField: 'object_number',
        displayName: 'Object',
      },
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    // Pre-populate query cache with success state
    queryClient.setQueryData(
      ['collection-object', 'org-1', 'obj-123'],
      { object_number: 'OBJ.001', title: 'Test Object' }
    );

    function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/organizations/org-1/collections/objects/obj-123/edit']}>
            {children}
          </MemoryRouter>
        </QueryClientProvider>
      );
    }

    renderHook(() => useRecentPageTracker(), { wrapper: Wrapper });

    // Wait for the query check
    vi.advanceTimersByTime(500);

    expect(mockAddRecentItem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'obj-123',
        type: 'object',
        label: 'OBJ.001',
        path: '/organizations/org-1/collections/objects/obj-123',
      })
    );
  });

  it('calls addRecentItem when query succeeds for a record page', () => {
    mockParseRecordRoute.mockReturnValue({
      orgId: 'org-1',
      recordId: 'obj-123',
      config: {
        type: 'object',
        queryKeyPrefix: 'collection-object',
        labelField: 'object_number',
        displayName: 'Object',
      },
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    // Pre-populate query cache with success state
    queryClient.setQueryData(
      ['collection-object', 'org-1', 'obj-123'],
      { object_number: 'OBJ.001', title: 'Test Object' }
    );

    function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/organizations/org-1/collections/objects/obj-123']}>
            {children}
          </MemoryRouter>
        </QueryClientProvider>
      );
    }

    renderHook(() => useRecentPageTracker(), { wrapper: Wrapper });

    // Wait for the query check (500ms poll)
    vi.advanceTimersByTime(500);

    expect(mockAddRecentItem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'obj-123',
        type: 'object',
        label: 'OBJ.001',
      })
    );
  });
});
