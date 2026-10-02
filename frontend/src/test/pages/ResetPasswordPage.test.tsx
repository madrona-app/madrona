import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ResetPasswordPage from '../../pages/auth/ResetPasswordPage';
import * as apiClient from '../../lib/apiClient';

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

function renderResetPasswordPage(token?: string) {
  const url = token ? `/reset-password?token=${token}` : '/reset-password';
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('no token', () => {
    it('redirects to forgot password when no token', () => {
      renderResetPasswordPage();
      expect(mockNavigate).toHaveBeenCalledWith('/forgot-password', { replace: true });
    });

    it('renders nothing when no token', () => {
      const { container } = renderResetPasswordPage();
      expect(container.firstChild).toBeNull();
    });
  });

  describe('with token - form rendering', () => {
    it('renders form with token', () => {
      renderResetPasswordPage('valid-token');
      expect(screen.getByText('Set new password')).toBeInTheDocument();
    });

    it('renders new password input', () => {
      renderResetPasswordPage('valid-token');
      expect(screen.getByLabelText('New password')).toBeInTheDocument();
    });

    it('renders confirm password input', () => {
      renderResetPasswordPage('valid-token');
      expect(screen.getByLabelText('Confirm new password')).toBeInTheDocument();
    });

    it('renders submit button', () => {
      renderResetPasswordPage('valid-token');
      expect(screen.getByRole('button', { name: /reset password/i })).toBeInTheDocument();
    });

    it('renders sign in link', () => {
      renderResetPasswordPage('valid-token');
      expect(screen.getByRole('link', { name: /back to sign in/i })).toBeInTheDocument();
    });
  });

  describe('form validation', () => {
    it('shows error when password is too short', async () => {
      renderResetPasswordPage('valid-token');

      const passwordInput = screen.getByLabelText('New password');
      const confirmInput = screen.getByLabelText('Confirm new password');

      fireEvent.change(passwordInput, { target: { value: 'short' } });
      fireEvent.change(confirmInput, { target: { value: 'short' } });
      fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

      await waitFor(() => {
        expect(screen.getByText(/password must be at least 8 characters/i)).toBeInTheDocument();
      });
    });

    it('shows error when passwords do not match', async () => {
      renderResetPasswordPage('valid-token');

      const passwordInput = screen.getByLabelText('New password');
      const confirmInput = screen.getByLabelText('Confirm new password');

      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'different123' } });
      fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

      await waitFor(() => {
        expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
      });
    });
  });

  describe('form submission', () => {
    it('calls API with token and password', async () => {
      mockApiFetch.mockResolvedValue({ success: true });

      renderResetPasswordPage('valid-token');

      const passwordInput = screen.getByLabelText('New password');
      const confirmInput = screen.getByLabelText('Confirm new password');

      fireEvent.change(passwordInput, { target: { value: 'newpassword123' } });
      fireEvent.change(confirmInput, { target: { value: 'newpassword123' } });
      fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/auth/password-reset/confirm',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ token: 'valid-token', password: 'newpassword123' }),
          })
        );
      });
    });

    it('shows loading state while submitting', async () => {
      mockApiFetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 100))
      );

      renderResetPasswordPage('valid-token');

      const passwordInput = screen.getByLabelText('New password');
      const confirmInput = screen.getByLabelText('Confirm new password');

      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'password123' } });
      fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

      expect(screen.getByRole('button', { name: /resetting password/i })).toBeInTheDocument();
    });

    it('shows success message after successful reset', async () => {
      mockApiFetch.mockResolvedValue({ success: true });

      renderResetPasswordPage('valid-token');

      const passwordInput = screen.getByLabelText('New password');
      const confirmInput = screen.getByLabelText('Confirm new password');

      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'password123' } });
      fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

      await waitFor(() => {
        expect(screen.getByText(/password has been successfully reset/i)).toBeInTheDocument();
      });
    });

    it('shows sign in link in success state', async () => {
      mockApiFetch.mockResolvedValue({ success: true });

      renderResetPasswordPage('valid-token');

      const passwordInput = screen.getByLabelText('New password');
      const confirmInput = screen.getByLabelText('Confirm new password');

      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'password123' } });
      fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

      await waitFor(() => {
        expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('shows error for expired token (404)', async () => {
      mockApiFetch.mockRejectedValue(new MockApiError(404, 'Not Found', 'Token not found'));

      renderResetPasswordPage('expired-token');

      const passwordInput = screen.getByLabelText('New password');
      const confirmInput = screen.getByLabelText('Confirm new password');

      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'password123' } });
      fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

      await waitFor(() => {
        expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument();
      });
    });

    it('shows error for already used token (400)', async () => {
      mockApiFetch.mockRejectedValue(
        new MockApiError(400, 'Bad Request', 'Token has already been used')
      );

      renderResetPasswordPage('used-token');

      const passwordInput = screen.getByLabelText('New password');
      const confirmInput = screen.getByLabelText('Confirm new password');

      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'password123' } });
      fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

      await waitFor(() => {
        expect(screen.getByText(/already been used/i)).toBeInTheDocument();
      });
    });

    it('shows invalid/expired error message for expired tokens', async () => {
      mockApiFetch.mockRejectedValue(new MockApiError(404, 'Not Found', 'Token not found'));

      renderResetPasswordPage('expired-token');

      const passwordInput = screen.getByLabelText('New password');
      const confirmInput = screen.getByLabelText('Confirm new password');

      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'password123' } });
      fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

      await waitFor(() => {
        expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument();
      });
    });

    it('shows generic error for server errors', async () => {
      mockApiFetch.mockRejectedValue(new MockApiError(500, 'Server Error', 'Internal error'));

      renderResetPasswordPage('valid-token');

      const passwordInput = screen.getByLabelText('New password');
      const confirmInput = screen.getByLabelText('Confirm new password');

      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'password123' } });
      fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

      await waitFor(() => {
        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
      });
    });

    it('shows generic error for network errors', async () => {
      mockApiFetch.mockRejectedValue(new Error('Network error'));

      renderResetPasswordPage('valid-token');

      const passwordInput = screen.getByLabelText('New password');
      const confirmInput = screen.getByLabelText('Confirm new password');

      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'password123' } });
      fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

      await waitFor(() => {
        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
      });
    });
  });
});
