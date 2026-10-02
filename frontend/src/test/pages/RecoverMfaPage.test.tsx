import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import RecoverMfaPage from '../../pages/auth/RecoverMfaPage';
import * as apiClient from '../../lib/apiClient';

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

function renderPage(token?: string) {
  const url = token ? `/recover-mfa?token=${token}` : '/recover-mfa';
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/recover-mfa" element={<RecoverMfaPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('RecoverMfaPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('request mode (no token)', () => {
    it('renders the email request form', () => {
      renderPage();
      expect(screen.getByText('Lost your authenticator?')).toBeInTheDocument();
      expect(screen.getByLabelText('Email address')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /send recovery link/i })).toBeInTheDocument();
    });

    it('posts to the recovery request endpoint and shows confirmation', async () => {
      mockApiFetch.mockResolvedValue({});
      renderPage();

      fireEvent.change(screen.getByLabelText('Email address'), {
        target: { value: 'user@example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: /send recovery link/i }));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/auth/mfa/recovery/request',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ email: 'user@example.com' }),
          })
        );
      });
      expect(await screen.findByText('Check your email')).toBeInTheDocument();
    });

    it('still shows success on error (no enumeration)', async () => {
      mockApiFetch.mockRejectedValue(new MockApiError(400, 'Bad Request', 'bad'));
      renderPage();
      fireEvent.change(screen.getByLabelText('Email address'), {
        target: { value: 'x@example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: /send recovery link/i }));
      // generic error shown, no crash
      await waitFor(() => {
        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
      });
    });
  });

  describe('confirm mode (with token)', () => {
    it('renders the password form', () => {
      renderPage('tok123');
      expect(screen.getByText('Recover account access')).toBeInTheDocument();
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /remove authenticator/i })).toBeInTheDocument();
    });

    it('posts token + password and shows success', async () => {
      mockApiFetch.mockResolvedValue({});
      renderPage('tok123');

      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
      fireEvent.click(screen.getByRole('button', { name: /remove authenticator/i }));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/auth/mfa/recovery/confirm',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ token: 'tok123', password: 'pw' }),
          })
        );
      });
      expect(await screen.findByText('Authenticator removed')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument();
    });

    it('shows incorrect-password error on 401', async () => {
      mockApiFetch.mockRejectedValue(new MockApiError(401, 'Unauthorized', 'Incorrect password'));
      renderPage('tok123');
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
      fireEvent.click(screen.getByRole('button', { name: /remove authenticator/i }));
      await waitFor(() => {
        expect(screen.getByText(/incorrect password/i)).toBeInTheDocument();
      });
    });

    it('shows invalid-link error on 404', async () => {
      mockApiFetch.mockRejectedValue(new MockApiError(404, 'Not Found', 'nope'));
      renderPage('badtok');
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
      fireEvent.click(screen.getByRole('button', { name: /remove authenticator/i }));
      await waitFor(() => {
        expect(screen.getByText(/recovery link is invalid/i)).toBeInTheDocument();
      });
    });

    it('shows expired error on 400 expired', async () => {
      mockApiFetch.mockRejectedValue(new MockApiError(400, 'Bad Request', 'This recovery link has expired'));
      renderPage('exptok');
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
      fireEvent.click(screen.getByRole('button', { name: /remove authenticator/i }));
      await waitFor(() => {
        expect(screen.getByText(/has expired/i)).toBeInTheDocument();
      });
    });
  });
});
