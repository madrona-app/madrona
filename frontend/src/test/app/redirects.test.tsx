import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import {
  getWorkProductSegment,
  RedirectGlobalWork,
  RedirectGlobalWorkWorkspaces,
  RedirectGlobalWorkWorkspaceDetail,
  RedirectGlobalWorkWorkspaceEdit,
  OrgDefaultRedirect,
} from '../../app/redirects';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

import * as useAuthModule from '../../hooks/useAuth';

const mockUseAuth = vi.mocked(useAuthModule.useAuth);

describe('getWorkProductSegment', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to "collections" when no last-used product', () => {
    expect(getWorkProductSegment()).toBe('collections');
  });

  it('returns "media" when last-used is media', () => {
    localStorage.setItem('madrona_last_active_product', 'media');
    expect(getWorkProductSegment()).toBe('media');
  });

  it('returns "collections" for any other last-used product', () => {
    localStorage.setItem('madrona_last_active_product', 'bridge');
    expect(getWorkProductSegment()).toBe('collections');
  });
});

describe('RedirectGlobalWork', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('redirects to collections/work by default', () => {
    render(
      <MemoryRouter initialEntries={['/organizations/org-1/work']}>
        <Routes>
          <Route path="/organizations/:orgId/work" element={<RedirectGlobalWork />} />
          <Route
            path="/organizations/:orgId/collections/work"
            element={<div>collections work</div>}
          />
          <Route path="/organizations/:orgId/media/work" element={<div>media work</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('collections work')).toBeInTheDocument();
  });

  it('redirects to media/work when last-used is media', () => {
    localStorage.setItem('madrona_last_active_product', 'media');
    render(
      <MemoryRouter initialEntries={['/organizations/org-1/work']}>
        <Routes>
          <Route path="/organizations/:orgId/work" element={<RedirectGlobalWork />} />
          <Route
            path="/organizations/:orgId/collections/work"
            element={<div>collections work</div>}
          />
          <Route path="/organizations/:orgId/media/work" element={<div>media work</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('media work')).toBeInTheDocument();
  });
});

describe('RedirectGlobalWorkWorkspaces', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('redirects to product-scoped workspaces list', () => {
    render(
      <MemoryRouter initialEntries={['/organizations/org-1/work/workspaces']}>
        <Routes>
          <Route
            path="/organizations/:orgId/work/workspaces"
            element={<RedirectGlobalWorkWorkspaces />}
          />
          <Route
            path="/organizations/:orgId/collections/work/workspaces"
            element={<div>workspaces list</div>}
          />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('workspaces list')).toBeInTheDocument();
  });
});

describe('RedirectGlobalWorkWorkspaceDetail', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('preserves the workspace id in the redirect', () => {
    render(
      <MemoryRouter initialEntries={['/organizations/org-1/work/workspaces/ws-7']}>
        <Routes>
          <Route
            path="/organizations/:orgId/work/workspaces/:workspaceId"
            element={<RedirectGlobalWorkWorkspaceDetail />}
          />
          <Route
            path="/organizations/:orgId/collections/work/workspaces/:workspaceId"
            element={<div data-testid="ws">workspace</div>}
          />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('ws')).toBeInTheDocument();
  });
});

describe('RedirectGlobalWorkWorkspaceEdit', () => {
  it('redirects to the edit page for the same workspace', () => {
    localStorage.clear();
    render(
      <MemoryRouter initialEntries={['/organizations/org-1/work/workspaces/ws-7/edit']}>
        <Routes>
          <Route
            path="/organizations/:orgId/work/workspaces/:workspaceId/edit"
            element={<RedirectGlobalWorkWorkspaceEdit />}
          />
          <Route
            path="/organizations/:orgId/collections/work/workspaces/:workspaceId/edit"
            element={<div data-testid="edit">edit page</div>}
          />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('edit')).toBeInTheDocument();
  });
});

describe('OrgDefaultRedirect', () => {
  it('navigates to the default landing path for the org', () => {
    mockUseAuth.mockReturnValue({
      applications: [
        { key: 'collections', enabled: true, status: 'active' },
      ],
    } as never);

    render(
      <MemoryRouter initialEntries={['/organizations/org-1']}>
        <Routes>
          <Route path="/organizations/:orgId" element={<OrgDefaultRedirect />} />
          <Route
            path="/organizations/:orgId/collections/objects"
            element={<div data-testid="collections">collections home</div>}
          />
        </Routes>
      </MemoryRouter>
    );
    // Collections is enabled — should land on collections/objects
    expect(screen.getByTestId('collections')).toBeInTheDocument();
  });
});
