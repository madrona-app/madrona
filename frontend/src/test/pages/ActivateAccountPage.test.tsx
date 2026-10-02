import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ActivateAccountPage from '../../pages/auth/ActivateAccountPage';
import * as apiClient from '../../lib/apiClient';
import * as useAuthModule from '../../hooks/useAuth';

// Mock the apiClient module
vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    statusText: string;
    constructor(status: number, statusText: string, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.statusText = statusText;
    }
  },
}));

// Mock useAuth
vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockApiFetch = vi.mocked(apiClient.apiFetch);
const MockApiError = apiClient.ApiError;
const mockUseAuth = vi.mocked(useAuthModule.useAuth);

function renderActivateAccountPage(token?: string) {
  const url = token ? `/activate?token=${token}` : '/activate';
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/activate" element={<ActivateAccountPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ActivateAccountPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      user: null,
      refreshMe: vi.fn(),
      signOut: vi.fn(),
    });
  });

  describe('no token', () => {
    it('shows invalid link message when no token', () => {
      renderActivateAccountPage();
      expect(screen.getByText(/invalid activation link/i)).toBeInTheDocument();
    });

    it('shows explanation when no token', () => {
      renderActivateAccountPage();
      expect(screen.getByText(/activation link is missing or invalid/i)).toBeInTheDocument();
    });

    it('shows back-to-sign-in link when no token', () => {
      renderActivateAccountPage();
      expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/sign-in');
    });
  });

  describe('with token - form rendering', () => {
    it('shows activation form with token', () => {
      renderActivateAccountPage('valid-token');
      expect(screen.getByText(/activate your account/i)).toBeInTheDocument();
    });

    it('shows password input', () => {
      renderActivateAccountPage('valid-token');
      expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    });

    it('shows confirm password input', () => {
      renderActivateAccountPage('valid-token');
      expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    });

    it('shows activate button', () => {
      renderActivateAccountPage('valid-token');
      expect(screen.getByRole('button', { name: /activate account/i })).toBeInTheDocument();
    });

    it('shows sign in link', () => {
      renderActivateAccountPage('valid-token');
      const signInLink = screen.getByRole('link', { name: /sign in/i });
      expect(signInLink).toHaveAttribute('href', '/sign-in');
    });
  });

  describe('form validation', () => {
    it('shows error when password is too short', async () => {
      renderActivateAccountPage('valid-token');

      const passwordInput = screen.getByLabelText(/^password$/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);

      fireEvent.change(passwordInput, { target: { value: 'short' } });
      fireEvent.change(confirmInput, { target: { value: 'short' } });
      fireEvent.click(screen.getByRole('button', { name: /activate account/i }));

      await waitFor(() => {
        expect(screen.getByText(/password must be at least 8 characters/i)).toBeInTheDocument();
      });
    });

    it('shows error when passwords do not match', async () => {
      renderActivateAccountPage('valid-token');

      const passwordInput = screen.getByLabelText(/^password$/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);

      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'different123' } });
      fireEvent.click(screen.getByRole('button', { name: /activate account/i }));

      await waitFor(() => {
        expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
      });
    });
  });

  describe('form submission', () => {
    it('calls API with token and password', async () => {
      mockApiFetch.mockResolvedValue({ success: true });
      const mockRefreshMe = vi.fn().mockResolvedValue(undefined);
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
        user: null,
        refreshMe: mockRefreshMe,
        signOut: vi.fn(),
      });

      renderActivateAccountPage('valid-token');

      const passwordInput = screen.getByLabelText(/^password$/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);

      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'password123' } });
      fireEvent.click(screen.getByRole('button', { name: /activate account/i }));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith('/auth/activate', expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ token: 'valid-token', password: 'password123' }),
        }));
      });
    });

    it('shows loading state while submitting', async () => {
      mockApiFetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 100))
      );
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
        user: null,
        refreshMe: vi.fn(),
        signOut: vi.fn(),
      });

      renderActivateAccountPage('valid-token');

      const passwordInput = screen.getByLabelText(/^password$/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);

      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'password123' } });
      fireEvent.click(screen.getByRole('button', { name: /activate account/i }));

      expect(screen.getByRole('button', { name: /activating/i })).toBeInTheDocument();
    });

    it('shows success message after activation', async () => {
      mockApiFetch.mockResolvedValue({ success: true });
      const mockRefreshMe = vi.fn().mockResolvedValue(undefined);
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
        user: null,
        refreshMe: mockRefreshMe,
        signOut: vi.fn(),
      });

      renderActivateAccountPage('valid-token');

      const passwordInput = screen.getByLabelText(/^password$/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);

      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'password123' } });
      fireEvent.click(screen.getByRole('button', { name: /activate account/i }));

      await waitFor(() => {
        expect(screen.getByText(/account activated!/i)).toBeInTheDocument();
      });
    });

    it('refreshes auth after successful activation', async () => {
      mockApiFetch.mockResolvedValue({ success: true });
      const mockRefreshMe = vi.fn().mockResolvedValue(undefined);
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
        user: null,
        refreshMe: mockRefreshMe,
        signOut: vi.fn(),
      });

      renderActivateAccountPage('valid-token');

      const passwordInput = screen.getByLabelText(/^password$/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);

      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'password123' } });
      fireEvent.click(screen.getByRole('button', { name: /activate account/i }));

      await waitFor(() => {
        expect(mockRefreshMe).toHaveBeenCalled();
      });
    });
  });

  describe('error handling', () => {
    it('shows API error message', async () => {
      mockApiFetch.mockRejectedValue(new MockApiError(400, 'Bad Request', 'Token expired'));

      renderActivateAccountPage('valid-token');

      const passwordInput = screen.getByLabelText(/^password$/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);

      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'password123' } });
      fireEvent.click(screen.getByRole('button', { name: /activate account/i }));

      await waitFor(() => {
        expect(screen.getByText('Token expired')).toBeInTheDocument();
      });
    });

    it('shows generic error for non-API errors', async () => {
      mockApiFetch.mockRejectedValue(new Error('Network error'));

      renderActivateAccountPage('valid-token');

      const passwordInput = screen.getByLabelText(/^password$/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);

      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'password123' } });
      fireEvent.click(screen.getByRole('button', { name: /activate account/i }));

      await waitFor(() => {
        expect(screen.getByText('An unexpected error occurred')).toBeInTheDocument();
      });
    });
  });

  describe('redirect when authenticated', () => {
    it('redirects to home if already authenticated', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        isLoading: false,
        user: { user_id: 'user-1' },
        refreshMe: vi.fn(),
        signOut: vi.fn(),
      });

      renderActivateAccountPage('valid-token');

      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    });
  });
});
