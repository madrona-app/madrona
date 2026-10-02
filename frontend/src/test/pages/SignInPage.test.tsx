import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SignInPage from '../../pages/auth/SignInPage';
import * as apiClient from '../../lib/apiClient';
import * as useAuthModule from '../../hooks/useAuth';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockApiFetch = vi.mocked(apiClient.apiFetch);
const MockApiError = apiClient.ApiError as unknown as new (message: string, status: number) => Error & { status: number };
const mockUseAuth = vi.mocked(useAuthModule.useAuth);

function renderSignInPage() {
  return render(
    <MemoryRouter initialEntries={['/sign-in']}>
      <SignInPage />
    </MemoryRouter>
  );
}

describe('SignInPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      user: null,
      activeOrganizationId: null,
      refreshMe: vi.fn().mockResolvedValue(undefined),
      signOut: vi.fn(),
    } as never);
  });

  describe('rendering', () => {
    it('renders the welcome heading', () => {
      renderSignInPage();
      expect(screen.getByText('Welcome back')).toBeInTheDocument();
    });

    it('renders email and password inputs', () => {
      renderSignInPage();
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    });

    it('renders sign in submit button', () => {
      renderSignInPage();
      expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
    });

    it('renders forgot-password link', () => {
      renderSignInPage();
      const link = screen.getByRole('link', { name: /forgot password/i });
      expect(link).toHaveAttribute('href', '/forgot-password');
    });
  });

  describe('happy path', () => {
    it('posts email and password to /auth/login', async () => {
      mockApiFetch.mockResolvedValue({});
      renderSignInPage();

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'user@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: 'secret123' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/auth/login',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ email: 'user@example.com', password: 'secret123' }),
          }),
        );
      });
    });

    it('navigates to active org after login when no redirect target', async () => {
      mockApiFetch.mockResolvedValue({});
      const refreshMe = vi.fn().mockResolvedValue(undefined);
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
        user: null,
        activeOrganizationId: 'org-42',
        refreshMe,
        signOut: vi.fn(),
      } as never);

      renderSignInPage();

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'a@b.com' },
      });
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: 'pwpwpwpw' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

      await waitFor(() => {
        expect(refreshMe).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/organizations/org-42', { replace: true });
      });
    });
  });

  describe('error states', () => {
    it('shows invalid-credentials error on 401', async () => {
      mockApiFetch.mockRejectedValue(new MockApiError('bad creds', 401));
      renderSignInPage();

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'user@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: 'wrongpass' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

      await waitFor(() => {
        expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
      });
    });

    it('shows no-account error on 404', async () => {
      mockApiFetch.mockRejectedValue(new MockApiError('not found', 404));
      renderSignInPage();

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'noone@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: 'whatever1' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

      await waitFor(() => {
        expect(screen.getByText(/no account found/i)).toBeInTheDocument();
      });
    });

    it('shows generic error for non-API errors', async () => {
      mockApiFetch.mockRejectedValue(new Error('boom'));
      renderSignInPage();

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'user@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: 'pwpwpwpw' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

      await waitFor(() => {
        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
      });
    });
  });

  describe('MFA flow', () => {
    it('shows MFA verify form when mfaRequired', async () => {
      mockApiFetch.mockResolvedValue({
        mfaRequired: true,
        session: 'sess-token',
        challengeType: 'SOFTWARE_TOKEN_MFA',
      });
      renderSignInPage();

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'user@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: 'pwpwpwpw' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

      // After MFA challenge, the regular sign-in form heading should be gone
      await waitFor(() => {
        expect(screen.queryByText('Welcome back')).not.toBeInTheDocument();
      });
    });
  });

  describe('loading state', () => {
    it('shows "Signing in..." while submitting', () => {
      mockApiFetch.mockImplementation(() => new Promise(() => {}));
      renderSignInPage();

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'user@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: 'pwpwpwpw' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

      expect(screen.getByRole('button', { name: /signing in/i })).toBeInTheDocument();
    });
  });

  describe('already authenticated', () => {
    it('renders nothing when already authenticated', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        isLoading: false,
        user: { user_id: 'u-1' },
        activeOrganizationId: 'org-1',
        refreshMe: vi.fn(),
        signOut: vi.fn(),
      } as never);
      renderSignInPage();

      expect(screen.queryByText('Welcome back')).not.toBeInTheDocument();
    });

    it('redirects to / when authenticated', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        isLoading: false,
        user: { user_id: 'u-1' },
        activeOrganizationId: null,
        refreshMe: vi.fn(),
        signOut: vi.fn(),
      } as never);
      renderSignInPage();

      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    });
  });
});
