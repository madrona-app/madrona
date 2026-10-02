import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ForgotPasswordPage from '../../pages/auth/ForgotPasswordPage';
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

const mockApiFetch = vi.mocked(apiClient.apiFetch);
const MockApiError = apiClient.ApiError;

function renderForgotPasswordPage() {
  return render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>
  );
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('basic rendering', () => {
    it('renders forgot password form', () => {
      renderForgotPasswordPage();
      expect(screen.getByText('Forgot password?')).toBeInTheDocument();
    });

    it('renders email input', () => {
      renderForgotPasswordPage();
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    });

    it('renders submit button', () => {
      renderForgotPasswordPage();
      expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
    });

    it('renders sign in link', () => {
      renderForgotPasswordPage();
      expect(screen.getByText(/back to sign in/i)).toBeInTheDocument();
    });

    it('renders description text', () => {
      renderForgotPasswordPage();
      expect(screen.getByText(/enter your email and we'll send you a link/i)).toBeInTheDocument();
    });

    it('has email type on input', () => {
      renderForgotPasswordPage();
      const emailInput = screen.getByLabelText(/email address/i);
      expect(emailInput).toHaveAttribute('type', 'email');
    });
  });

  describe('form submission', () => {
    it('calls API with email on submit', async () => {
      mockApiFetch.mockResolvedValue({ message: 'Success' });

      renderForgotPasswordPage();

      const emailInput = screen.getByLabelText(/email address/i);
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

      const submitButton = screen.getByRole('button', { name: /send reset link/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith('/auth/password-reset/request', expect.anything());
      });
    });

    it('shows success state after submission', async () => {
      mockApiFetch.mockResolvedValue({ message: 'Success' });

      renderForgotPasswordPage();

      const emailInput = screen.getByLabelText(/email address/i);
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

      const submitButton = screen.getByRole('button', { name: /send reset link/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Check your email')).toBeInTheDocument();
      });
    });

    it('shows email in success message', async () => {
      mockApiFetch.mockResolvedValue({ message: 'Success' });

      renderForgotPasswordPage();

      const emailInput = screen.getByLabelText(/email address/i);
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

      fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

      await waitFor(() => {
        expect(screen.getByText('test@example.com')).toBeInTheDocument();
      });
    });

    it('shows link expiry info in success state', async () => {
      mockApiFetch.mockResolvedValue({ message: 'Success' });

      renderForgotPasswordPage();

      const emailInput = screen.getByLabelText(/email address/i);
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

      fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

      await waitFor(() => {
        expect(screen.getByText(/link will expire in 1 hour/i)).toBeInTheDocument();
      });
    });
  });

  describe('loading state', () => {
    it('shows loading text while submitting', async () => {
      mockApiFetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ message: 'ok' }), 100))
      );

      renderForgotPasswordPage();

      const emailInput = screen.getByLabelText(/email address/i);
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

      fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

      expect(screen.getByRole('button', { name: /sending/i })).toBeInTheDocument();
    });

    it('disables button while submitting', async () => {
      mockApiFetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ message: 'ok' }), 100))
      );

      renderForgotPasswordPage();

      const emailInput = screen.getByLabelText(/email address/i);
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

      fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

      expect(screen.getByRole('button', { name: /sending/i })).toBeDisabled();
    });
  });

  describe('error handling', () => {
    it('shows error for invalid email (400)', async () => {
      mockApiFetch.mockRejectedValue(new MockApiError(400, 'Bad Request', 'Invalid email'));

      renderForgotPasswordPage();

      const emailInput = screen.getByLabelText(/email address/i);
      // Use a valid email format to bypass HTML5 validation, API returns 400
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

      fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

      await waitFor(() => {
        expect(screen.getByText(/please enter a valid email address/i)).toBeInTheDocument();
      });
    });

    it('shows generic error for server errors', async () => {
      mockApiFetch.mockRejectedValue(new MockApiError(500, 'Server Error', 'Internal error'));

      renderForgotPasswordPage();

      const emailInput = screen.getByLabelText(/email address/i);
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

      fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

      await waitFor(() => {
        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
      });
    });

    it('shows generic error for network errors', async () => {
      mockApiFetch.mockRejectedValue(new Error('Network error'));

      renderForgotPasswordPage();

      const emailInput = screen.getByLabelText(/email address/i);
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

      fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

      await waitFor(() => {
        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
      });
    });
  });

  describe('styling', () => {
    it('has centered layout', () => {
      const { container } = renderForgotPasswordPage();
      expect(container.firstChild).toHaveClass('min-h-screen');
    });

    it('has white card background', () => {
      renderForgotPasswordPage();
      const card = screen.getByText('Forgot password?').closest('div.bg-parchment');
      expect(card).toBeInTheDocument();
    });
  });
});
