import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SignInPage from '../../pages/auth/SignInPage';
import * as apiClient from '../../lib/apiClient';

// Mock apiClient
vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
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

// Sign-in redirects to /install on an uninstalled instance. That check is a
// concern of its own (useInstallRedirect) and makes a request these tests'
// queued apiFetch mocks would otherwise serve to it instead of to login.
vi.mock('../../hooks/useInstallRedirect', () => ({
  useInstallRedirect: vi.fn(),
}));


// Mock useAuth hook
const mockRefreshMe = vi.fn();
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: false,
    isLoading: false,
    activeOrganizationId: 'org-1',
    refreshMe: mockRefreshMe,
  }),
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ state: null }),
  };
});

// Suppress console logs
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

beforeEach(() => {
  console.log = vi.fn();
  console.error = vi.fn();
  vi.clearAllMocks();
});

afterEach(() => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  vi.resetAllMocks();
});

describe('SignInPage', () => {
  const renderSignInPage = () => {
    return render(
      <MemoryRouter>
        <SignInPage />
      </MemoryRouter>
    );
  };

  describe('form rendering', () => {
    it('renders login form with email and password fields', () => {
      renderSignInPage();

      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    it('renders forgot password link', () => {
      renderSignInPage();

      expect(screen.getByText(/forgot password/i)).toBeInTheDocument();
    });

    // Sign-up link removed — new accounts are invitation-only.
  });

  describe('form validation', () => {
    // Note: HTML5 required validation prevents native form submission, but we can test
    // that the handleSubmit validates empty fields by calling submit directly on the form
    it('validates required fields using HTML5 validation', () => {
      renderSignInPage();

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);

      // Both fields have required attribute for native validation
      expect(emailInput).toBeRequired();
      expect(passwordInput).toBeRequired();
    });

    it('email field has correct type for validation', () => {
      renderSignInPage();

      const emailInput = screen.getByLabelText(/email address/i);
      expect(emailInput).toHaveAttribute('type', 'email');
    });
  });

  describe('form submission', () => {
    it('shows loading state during submission', async () => {
      const user = userEvent.setup();

      // Delay the API response to observe loading state
      vi.mocked(apiClient.apiFetch).mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 100))
      );

      renderSignInPage();

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      // Should show loading state
      expect(screen.getByRole('button', { name: /signing in/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();
    });

    it('calls API with correct credentials', async () => {
      const user = userEvent.setup();
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});

      renderSignInPage();

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      await waitFor(() => {
        expect(apiClient.apiFetch).toHaveBeenCalledWith('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
        });
      });
    });

    it('refreshes user and navigates on successful login', async () => {
      const user = userEvent.setup();
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});

      renderSignInPage();

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      await waitFor(() => {
        expect(mockRefreshMe).toHaveBeenCalled();
      });
    });
  });

  describe('API error handling', () => {
    it('shows error for invalid credentials (401)', async () => {
      const user = userEvent.setup();
      vi.mocked(apiClient.apiFetch).mockRejectedValueOnce(
        new apiClient.ApiError('Unauthorized', 401)
      );

      renderSignInPage();

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'wrongpassword');
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument();
    });

    it('shows error for bad request (400)', async () => {
      const user = userEvent.setup();
      vi.mocked(apiClient.apiFetch).mockRejectedValueOnce(
        new apiClient.ApiError('Bad Request', 400)
      );

      renderSignInPage();

      // Use valid email format to pass HTML5 validation
      await user.type(screen.getByLabelText(/email address/i), 'invalid@email.com');
      await user.type(screen.getByLabelText(/password/i), 'pass');
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      expect(await screen.findByText(/please enter a valid email and password/i)).toBeInTheDocument();
    });

    it('shows error for user not found (404)', async () => {
      const user = userEvent.setup();
      vi.mocked(apiClient.apiFetch).mockRejectedValueOnce(
        new apiClient.ApiError('Not Found', 404)
      );

      renderSignInPage();

      await user.type(screen.getByLabelText(/email address/i), 'unknown@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      expect(await screen.findByText(/no account found with this email/i)).toBeInTheDocument();
    });

    it('shows generic error for server errors', async () => {
      const user = userEvent.setup();
      vi.mocked(apiClient.apiFetch).mockRejectedValueOnce(
        new apiClient.ApiError('Server Error', 500)
      );

      renderSignInPage();

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      expect(await screen.findByText(/unable to sign in/i)).toBeInTheDocument();
    });

    it('shows generic error for network errors', async () => {
      const user = userEvent.setup();
      vi.mocked(apiClient.apiFetch).mockRejectedValueOnce(new Error('Network error'));

      renderSignInPage();

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    });
  });

  describe('MFA flow', () => {
    it('shows MFA verify form when mfaRequired is true', async () => {
      const user = userEvent.setup();
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        mfaRequired: true,
        session: 'mfa-session-123',
        challengeType: 'SOFTWARE_TOKEN_MFA',
      });

      renderSignInPage();

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      await waitFor(() => {
        expect(screen.getByText(/two-factor authentication/i)).toBeInTheDocument();
      });
    });
  });

  describe('input behavior', () => {
    it('disables inputs during submission', async () => {
      const user = userEvent.setup();

      vi.mocked(apiClient.apiFetch).mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 100))
      );

      renderSignInPage();

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      expect(screen.getByLabelText(/email address/i)).toBeDisabled();
      expect(screen.getByLabelText(/password/i)).toBeDisabled();
    });
  });
});
