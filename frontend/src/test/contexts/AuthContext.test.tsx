import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider, type User } from '../../contexts/AuthContext';
import { useAuth, useRequireAuth } from '../../hooks/useAuth';
import * as apiClient from '../../lib/apiClient';

// Mock the apiClient module
vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
  fetchCsrfToken: vi.fn(),
  setRoleOverride: vi.fn(),
  getRoleOverride: vi.fn(() => null),
  setCsrfToken: vi.fn(),
  getCsrfToken: vi.fn(() => null),
  onApiError: vi.fn(() => () => {}),
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  },
}));

// Suppress console logs during tests
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

beforeEach(() => {
  console.log = vi.fn();
  console.warn = vi.fn();
  console.error = vi.fn();
  vi.clearAllMocks();
});

afterEach(() => {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
  vi.resetAllMocks();
});

// Valid mock user data
const mockUser: User = {
  user_id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  timezone: 'America/New_York',
  active_organization_id: 'org-1',
  permissions: ['data.view', 'runs.execute'],
  role_label: 'Data Engineer',
  organizations: [
    {
      organization_id: 'org-1',
      name: 'Test Org',
      slug: 'test-org',
      timezone: 'America/New_York',
      role: 'member',
      role_label: 'Data Engineer',
    },
    {
      organization_id: 'org-2',
      name: 'Another Org',
      slug: 'another-org',
      timezone: 'UTC',
      role: 'admin',
      role_label: 'Admin',
    },
  ],
};

// Helper component to access auth context
function AuthConsumer() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="loading">{auth.isLoading.toString()}</span>
      <span data-testid="authenticated">{auth.isAuthenticated.toString()}</span>
      <span data-testid="user-email">{auth.user?.email || 'none'}</span>
      <span data-testid="active-org">{auth.activeOrganizationId || 'none'}</span>
      <span data-testid="memberships-count">{auth.memberships.length}</span>
      <span data-testid="error">{auth.error?.message || 'none'}</span>
      <button onClick={() => auth.logout()}>Logout</button>
      <button onClick={() => auth.setActiveOrganization('org-2')}>Switch Org</button>
      <button onClick={() => auth.refreshMe()}>Refresh</button>
    </div>
  );
}

// Helper component to test useRequireAuth
function RequireAuthConsumer() {
  const { user, isLoading, isAuthenticated } = useRequireAuth();
  return (
    <div>
      <span data-testid="require-loading">{isLoading.toString()}</span>
      <span data-testid="require-authenticated">{isAuthenticated.toString()}</span>
      <span data-testid="require-user">{user?.email || (user === null ? 'null' : 'undefined')}</span>
    </div>
  );
}

describe('AuthContext', () => {
  describe('AuthProvider', () => {
    describe('initial state and user fetch', () => {
      it('shows loading state initially and transitions to loaded', async () => {
        // Use a never-resolving promise to test loading state
        vi.mocked(apiClient.fetchCsrfToken).mockImplementation(() => new Promise(() => {}));

        render(
          <AuthProvider>
            <AuthConsumer />
          </AuthProvider>
        );

        // Should be in loading state
        expect(screen.getByTestId('loading')).toHaveTextContent('true');
        expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
      });

      it('fetches CSRF token and user data on mount', async () => {
        vi.mocked(apiClient.fetchCsrfToken).mockResolvedValueOnce('csrf-token');
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockUser);

        render(
          <AuthProvider>
            <AuthConsumer />
          </AuthProvider>
        );

        await waitFor(() => {
          expect(screen.getByTestId('loading')).toHaveTextContent('false');
        });

        expect(apiClient.fetchCsrfToken).toHaveBeenCalledTimes(1);
        expect(apiClient.apiFetch).toHaveBeenCalledWith('/me');
        expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
        expect(screen.getByTestId('user-email')).toHaveTextContent('test@example.com');
        expect(screen.getByTestId('active-org')).toHaveTextContent('org-1');
        expect(screen.getByTestId('memberships-count')).toHaveTextContent('2');
      });

      it('handles 401 response (not authenticated) gracefully', async () => {
        vi.mocked(apiClient.fetchCsrfToken).mockResolvedValueOnce('csrf-token');
        vi.mocked(apiClient.apiFetch).mockRejectedValueOnce(
          new apiClient.ApiError('Unauthorized', 401)
        );

        render(
          <AuthProvider>
            <AuthConsumer />
          </AuthProvider>
        );

        await waitFor(() => {
          expect(screen.getByTestId('loading')).toHaveTextContent('false');
        });

        // Should not be authenticated but also not show an error
        expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
        expect(screen.getByTestId('user-email')).toHaveTextContent('none');
        expect(screen.getByTestId('error')).toHaveTextContent('none');
      });

      it('handles network errors', async () => {
        vi.mocked(apiClient.fetchCsrfToken).mockResolvedValueOnce('csrf-token');
        vi.mocked(apiClient.apiFetch).mockRejectedValueOnce(new Error('Network error'));

        render(
          <AuthProvider>
            <AuthConsumer />
          </AuthProvider>
        );

        await waitFor(() => {
          expect(screen.getByTestId('loading')).toHaveTextContent('false');
        });

        expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
        expect(screen.getByTestId('error')).toHaveTextContent('Network error');
      });

      it('continues even if CSRF fetch fails', async () => {
        vi.mocked(apiClient.fetchCsrfToken).mockRejectedValueOnce(new Error('CSRF failed'));
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockUser);

        render(
          <AuthProvider>
            <AuthConsumer />
          </AuthProvider>
        );

        await waitFor(() => {
          expect(screen.getByTestId('loading')).toHaveTextContent('false');
        });

        // Should still fetch user and be authenticated
        expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
        expect(screen.getByTestId('user-email')).toHaveTextContent('test@example.com');
      });
    });

    describe('logout', () => {
      it('calls logout API and clears user', async () => {
        vi.mocked(apiClient.fetchCsrfToken).mockResolvedValueOnce('csrf-token');
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockUser);

        render(
          <AuthProvider>
            <AuthConsumer />
          </AuthProvider>
        );

        await waitFor(() => {
          expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
        });

        // Mock logout endpoint
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(undefined);

        // Click logout
        await act(async () => {
          screen.getByText('Logout').click();
        });

        await waitFor(() => {
          expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
        });

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/auth/logout', { method: 'POST' });
        expect(screen.getByTestId('user-email')).toHaveTextContent('none');
      });

      it('clears user even if logout request fails', async () => {
        vi.mocked(apiClient.fetchCsrfToken).mockResolvedValueOnce('csrf-token');
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockUser);

        render(
          <AuthProvider>
            <AuthConsumer />
          </AuthProvider>
        );

        await waitFor(() => {
          expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
        });

        // Mock logout endpoint failure
        vi.mocked(apiClient.apiFetch).mockRejectedValueOnce(new Error('Logout failed'));

        // Click logout
        await act(async () => {
          screen.getByText('Logout').click();
        });

        await waitFor(() => {
          expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
        });
      });
    });

    describe('setActiveOrganization', () => {
      it('sets active organization and refreshes user', async () => {
        vi.mocked(apiClient.fetchCsrfToken).mockResolvedValue('csrf-token');
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockUser);

        render(
          <AuthProvider>
            <AuthConsumer />
          </AuthProvider>
        );

        await waitFor(() => {
          expect(screen.getByTestId('active-org')).toHaveTextContent('org-1');
        });

        // Mock the setActiveOrganization endpoint and subsequent refreshMe
        vi.mocked(apiClient.apiFetch)
          .mockResolvedValueOnce(undefined) // POST /me/active-organization
          .mockResolvedValueOnce({ ...mockUser, active_organization_id: 'org-2' }); // GET /me refresh

        // Click switch org
        await act(async () => {
          screen.getByText('Switch Org').click();
        });

        await waitFor(() => {
          expect(screen.getByTestId('active-org')).toHaveTextContent('org-2');
        });

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/me/active-organization', {
          method: 'POST',
          body: JSON.stringify({ organization_id: 'org-2' }),
        });
      });
    });

    describe('refreshMe', () => {
      it('can manually refresh user data', async () => {
        vi.mocked(apiClient.fetchCsrfToken).mockResolvedValue('csrf-token');
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockUser);

        render(
          <AuthProvider>
            <AuthConsumer />
          </AuthProvider>
        );

        await waitFor(() => {
          expect(screen.getByTestId('user-email')).toHaveTextContent('test@example.com');
        });

        // Update mock for refresh
        const updatedUser = { ...mockUser, name: 'Updated User' };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(updatedUser);

        // Click refresh
        await act(async () => {
          screen.getByText('Refresh').click();
        });

        await waitFor(() => {
          expect(apiClient.apiFetch).toHaveBeenLastCalledWith('/me');
        });
      });
    });
  });
});

describe('useAuth hook', () => {
  it('returns context when used inside AuthProvider', async () => {
    vi.mocked(apiClient.fetchCsrfToken).mockResolvedValueOnce('csrf-token');
    vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockUser);

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
  });

  it('throws error when used outside AuthProvider', () => {
    // Suppress error boundary warnings
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<AuthConsumer />);
    }).toThrow('useAuth must be used within an AuthProvider');

    spy.mockRestore();
  });
});

describe('useRequireAuth hook', () => {
  it('returns loading state when auth is loading', async () => {
    // Use a never-resolving promise to test loading state
    vi.mocked(apiClient.fetchCsrfToken).mockImplementation(() => new Promise(() => {}));

    render(
      <AuthProvider>
        <RequireAuthConsumer />
      </AuthProvider>
    );

    // While loading
    expect(screen.getByTestId('require-loading')).toHaveTextContent('true');
    expect(screen.getByTestId('require-authenticated')).toHaveTextContent('false');
    expect(screen.getByTestId('require-user')).toHaveTextContent('undefined');
  });

  it('returns null user when not authenticated', async () => {
    vi.mocked(apiClient.fetchCsrfToken).mockResolvedValueOnce('csrf-token');
    vi.mocked(apiClient.apiFetch).mockRejectedValueOnce(
      new apiClient.ApiError('Unauthorized', 401)
    );

    render(
      <AuthProvider>
        <RequireAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('require-loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('require-authenticated')).toHaveTextContent('false');
    expect(screen.getByTestId('require-user')).toHaveTextContent('null');
  });

  it('returns user when authenticated', async () => {
    vi.mocked(apiClient.fetchCsrfToken).mockResolvedValueOnce('csrf-token');
    vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockUser);

    render(
      <AuthProvider>
        <RequireAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('require-loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('require-authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('require-user')).toHaveTextContent('test@example.com');
  });
});
