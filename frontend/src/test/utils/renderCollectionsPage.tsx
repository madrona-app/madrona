import React, { type ReactElement } from 'react';
import { vi } from 'vitest';
import { render, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/**
 * Build a QueryClient tuned for tests (no retries).
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderCollectionsPageOptions {
  /** The org slug/id used in the URL params. Defaults to 'org-1'. */
  orgId?: string;
  /**
   * The URL path that MemoryRouter will start at. If omitted, a generic
   * "/organizations/:orgId/collections" route is used. Must include orgId.
   */
  path?: string;
  /**
   * Route pattern that the page is mounted under. Defaults to
   * "/organizations/:orgId/collections/*" which is forgiving enough for
   * list pages that only read `orgId`.
   */
  routePattern?: string;
  /** Optional pre-built QueryClient (e.g. to share between re-renders). */
  queryClient?: QueryClient;
}

/**
 * Render a collections list/workspace page with the minimum provider set
 * those pages depend on: QueryClientProvider + MemoryRouter (with the
 * :orgId param wired up).
 *
 * The helper does NOT supply AuthContext — tests that need different
 * permissions should mock the `usePermissions` hook directly, which is
 * the boundary the pages actually call.
 */
export function renderCollectionsPage(
  ui: ReactElement,
  options: RenderCollectionsPageOptions = {}
): RenderResult & { queryClient: QueryClient } {
  const {
    orgId = 'org-1',
    path = `/organizations/${orgId}/collections`,
    routePattern = '/organizations/:orgId/collections/*',
    queryClient = createTestQueryClient(),
  } = options;

  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePattern} element={ui} />
          <Route
            path="/organizations/:orgId/collections/*"
            element={ui}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  return { ...result, queryClient };
}

/**
 * Return value of `usePermissions` with the three callable checks mocked.
 * Accepts a list of permission strings the mocked user "has".
 */
export function mockPermissionSet(permissions: string[] = []) {
  const has = (p: string) => permissions.includes(p);
  return {
    hasPermission: vi.fn(has),
    hasAnyPermission: vi.fn((perms: string[]) => perms.some(has)),
    hasAllPermissions: vi.fn((perms: string[]) => perms.every(has)),
    permissions,
  };
}
