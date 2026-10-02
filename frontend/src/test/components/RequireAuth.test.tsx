import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RequireAuth } from '../../components/RequireAuth';

// Mock auth state
const mockAuth = {
  isAuthenticated: true,
  isLoading: false,
};

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => mockAuth,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.isAuthenticated = true;
  mockAuth.isLoading = false;
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('RequireAuth', () => {
  const ProtectedComponent = () => <div>Protected Content</div>;
  const SignInPage = () => <div>Sign In Page</div>;

  const renderWithRouter = (initialEntries = ['/protected']) => {
    return render(
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route
            path="/protected"
            element={
              <RequireAuth>
                <ProtectedComponent />
              </RequireAuth>
            }
          />
          <Route path="/sign-in" element={<SignInPage />} />
        </Routes>
      </MemoryRouter>
    );
  };

  describe('when loading', () => {
    it('shows loading spinner', () => {
      mockAuth.isLoading = true;
      mockAuth.isAuthenticated = false;

      renderWithRouter();

      expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });
  });

  describe('when authenticated', () => {
    it('renders children', () => {
      mockAuth.isAuthenticated = true;
      mockAuth.isLoading = false;

      renderWithRouter();

      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });

    it('does not redirect to sign-in', () => {
      mockAuth.isAuthenticated = true;
      mockAuth.isLoading = false;

      renderWithRouter();

      expect(screen.queryByText('Sign In Page')).not.toBeInTheDocument();
    });
  });

  describe('when not authenticated', () => {
    it('redirects to sign-in page', () => {
      mockAuth.isAuthenticated = false;
      mockAuth.isLoading = false;

      renderWithRouter();

      expect(screen.getByText('Sign In Page')).toBeInTheDocument();
      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });

    it('does not render children', () => {
      mockAuth.isAuthenticated = false;
      mockAuth.isLoading = false;

      renderWithRouter();

      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });
  });

  describe('nested routes', () => {
    it('protects nested content', () => {
      mockAuth.isAuthenticated = true;

      render(
        <MemoryRouter initialEntries={['/dashboard/settings']}>
          <Routes>
            <Route
              path="/dashboard/*"
              element={
                <RequireAuth>
                  <div>Dashboard Content</div>
                </RequireAuth>
              }
            />
            <Route path="/sign-in" element={<SignInPage />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Dashboard Content')).toBeInTheDocument();
    });
  });
});
