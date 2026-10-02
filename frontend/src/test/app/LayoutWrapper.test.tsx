import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { LayoutWrapper } from '../../app/LayoutWrapper';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

// AppShell pulls in the entire authed shell — sidebar, chat, etc. Stub it.
vi.mock('../../components/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

// QueryBoundary just renders children when there's no error.
vi.mock('../../components/QueryBoundary', () => ({
  QueryBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../components/dam/UploadProgressDrawer', () => ({
  UploadProgressDrawer: () => <div data-testid="upload-drawer" />,
}));

import * as useAuthModule from '../../hooks/useAuth';

const mockUseAuth = vi.mocked(useAuthModule.useAuth);

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/x']}>
      <Routes>
        <Route element={<LayoutWrapper />}>
          <Route path="/x" element={<div data-testid="page">page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('LayoutWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing while auth is loading', () => {
    mockUseAuth.mockReturnValue({
      isLoading: true,
      isAuthenticated: false,
    } as never);
    const { container } = renderLayout();
    expect(container.querySelector('[data-testid="app-shell"]')).toBeNull();
  });

  it('renders nothing when not authenticated', () => {
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
    } as never);
    const { container } = renderLayout();
    expect(container.querySelector('[data-testid="app-shell"]')).toBeNull();
  });

  it('renders AppShell + nested route when authenticated', async () => {
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    } as never);
    renderLayout();
    await waitFor(() => {
      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    });
    expect(screen.getByTestId('page')).toBeInTheDocument();
  });

  it('redirects to /sign-in when not authenticated', () => {
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
    } as never);
    renderLayout();
    expect(mockNavigate).toHaveBeenCalledWith('/sign-in', { replace: true });
  });

  it('does not redirect while loading', () => {
    mockUseAuth.mockReturnValue({
      isLoading: true,
      isAuthenticated: false,
    } as never);
    renderLayout();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not show the upload drawer when no uploads', () => {
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    } as never);
    renderLayout();
    expect(screen.queryByTestId('upload-drawer')).not.toBeInTheDocument();
  });
});
