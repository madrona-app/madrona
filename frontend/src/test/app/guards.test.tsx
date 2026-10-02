import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import {
  PageLoadingFallback,
  RouteGroupBoundary,
  AppAccessGuard,
  NotFoundPage,
  hideInitialLoader,
} from '../../app/guards';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

import * as useAuthModule from '../../hooks/useAuth';
const mockUseAuth = vi.mocked(useAuthModule.useAuth);

describe('PageLoadingFallback', () => {
  it('renders a loading indicator', () => {
    render(<PageLoadingFallback />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});

describe('RouteGroupBoundary', () => {
  it('renders nested routes via Outlet', () => {
    render(
      <MemoryRouter initialEntries={['/x/y']}>
        <Routes>
          <Route path="/x" element={<RouteGroupBoundary name="test" />}>
            <Route path="y" element={<div data-testid="child">nested</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('child')).toHaveTextContent('nested');
  });
});

describe('AppAccessGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nested routes when user has app access', () => {
    mockUseAuth.mockReturnValue({
      hasAppAccess: () => true,
      activeOrganizationId: 'org-1',
    } as never);

    render(
      <MemoryRouter initialEntries={['/collections']}>
        <Routes>
          <Route
            path="/collections"
            element={<AppAccessGuard name="Collections" appKey="collections" />}
          >
            <Route index element={<div data-testid="content">collections content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('renders the blocked dialog when user lacks access', () => {
    mockUseAuth.mockReturnValue({
      hasAppAccess: () => false,
      activeOrganizationId: 'org-1',
    } as never);

    render(
      <MemoryRouter initialEntries={['/collections']}>
        <Routes>
          <Route
            path="/collections"
            element={<AppAccessGuard name="Collections" appKey="collections" />}
          >
            <Route index element={<div>collections content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/Collections is not available/i)).toBeInTheDocument();
    expect(
      screen.getByText(/turned off for your organization/i)
    ).toBeInTheDocument();
    // Points at the self-service fix rather than a sales conversation.
    expect(screen.getByText(/Admin . Applications/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /go home/i, hidden: true }),
    ).toBeInTheDocument();
  });

  it('Go home navigates to org home when user has org', () => {
    mockUseAuth.mockReturnValue({
      hasAppAccess: () => false,
      activeOrganizationId: 'org-42',
    } as never);

    render(
      <MemoryRouter initialEntries={['/collections']}>
        <Routes>
          <Route
            path="/collections"
            element={<AppAccessGuard name="Collections" appKey="collections" />}
          />
          <Route
            path="/organizations/:orgId/home"
            element={<div data-testid="home">home</div>}
          />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(
      screen.getByRole('button', { name: /go home/i, hidden: true }),
    );
    expect(screen.getByTestId('home')).toBeInTheDocument();
  });
});

describe('NotFoundPage', () => {
  it('shows page-not-found message', () => {
    render(
      <MemoryRouter initialEntries={['/whatever']}>
        <NotFoundPage />
      </MemoryRouter>
    );
    expect(screen.getByText(/page not found/i)).toBeInTheDocument();
    expect(
      screen.getByText(/doesn't exist or has been moved/i)
    ).toBeInTheDocument();
  });

  it('home link points to org home when orgId in URL', () => {
    render(
      <MemoryRouter initialEntries={['/organizations/org-1/oops']}>
        <Routes>
          <Route path="/organizations/:orgId/*" element={<NotFoundPage />} />
        </Routes>
      </MemoryRouter>
    );
    const link = screen.getByRole('link', { name: /go home/i });
    expect(link).toHaveAttribute('href', '/organizations/org-1/home');
  });

  it('home link points to / when no orgId', () => {
    render(
      <MemoryRouter initialEntries={['/oops']}>
        <NotFoundPage />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: /go home/i })).toHaveAttribute('href', '/');
  });

  it('Go back button has correct label', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: /go back/i })).toBeInTheDocument();
  });
});

describe('hideInitialLoader', () => {
  it('removes the initial-loader element after fade', async () => {
    vi.useFakeTimers();
    const div = document.createElement('div');
    div.id = 'initial-loader';
    document.body.appendChild(div);

    hideInitialLoader();
    expect(div.classList.contains('fade-out')).toBe(true);

    vi.advanceTimersByTime(400);
    expect(document.getElementById('initial-loader')).toBeNull();
    vi.useRealTimers();
  });

  it('does nothing when loader is absent', () => {
    expect(() => hideInitialLoader()).not.toThrow();
  });
});
