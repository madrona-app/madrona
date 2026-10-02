import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import AccountSecurityPage from '../../pages/auth/AccountSecurityPage';
import type { User } from '../../contexts/AuthContext';
import * as apiClient from '../../lib/apiClient';

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
    details?: Record<string, unknown>;
    constructor(message: string, status: number, details?: Record<string, unknown>) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.details = details;
    }
  },
}));

// Stub useAuth so the page renders without a full AuthProvider tree.
const refreshMe = vi.fn().mockResolvedValue(undefined);

let mockUser: User | null = null;
let mockIsAuthenticated = true;
let mockIsLoading = false;

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: mockUser,
    isAuthenticated: mockIsAuthenticated,
    isLoading: mockIsLoading,
    activeOrganizationId: null,
    applications: [],
    memberships: [],
    isPlatformAdmin: false,
    error: null,
    roleOverride: null,
    setRoleOverride: vi.fn(),
    hasAppAccess: () => false,
    refreshMe,
    setActiveOrganization: vi.fn(),
    logout: vi.fn(),
  }),
}));

const baseUser: User = {
  user_id: 'user-1',
  email: 'alice@madrona.test',
  name: 'Alice',
  active_organization_id: null,
  permissions: [],
  role_label: null,
  applications: [],
  organizations: [],
  mfa_factors: { totp: false, sms: false, email: false, preferred: null },
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/account/security']}>
      <Routes>
        <Route path="/account/security" element={<AccountSecurityPage />} />
        <Route path="/sign-in" element={<div>sign-in placeholder</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  refreshMe.mockClear();
  mockUser = { ...baseUser, mfa_factors: { ...baseUser.mfa_factors! } };
  mockIsAuthenticated = true;
  mockIsLoading = false;
});

describe('AccountSecurityPage', () => {
  it('renders all three factor rows with current state', () => {
    mockUser = {
      ...baseUser,
      mfa_factors: { totp: true, sms: false, email: false, preferred: 'totp' },
    };

    renderPage();

    expect(screen.getByRole('heading', { name: /account security/i })).toBeInTheDocument();
    expect(screen.getByText(/authenticator app/i)).toBeInTheDocument();
    expect(screen.getByText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByText(/^sms$/i)).toBeInTheDocument();
    // TOTP is marked preferred + enrolled
    expect(screen.getAllByText(/preferred/i).length).toBeGreaterThanOrEqual(1);
  });

  it('enrolling email two-factor walks start -> verify -> refresh', async () => {
    const user = userEvent.setup();
    const apiFetch = vi.mocked(apiClient.apiFetch);
    apiFetch.mockResolvedValue({ ok: true });

    renderPage();

    await user.click(screen.getByRole('button', { name: /set up email two-factor/i }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/auth/mfa/email/setup/start',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    const codeInput = await screen.findByLabelText(/6-digit code/i);
    await user.type(codeInput, '654321');
    await user.click(screen.getByRole('button', { name: /verify and enable/i }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/auth/mfa/email/setup/verify',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('654321'),
        }),
      );
    });
    await waitFor(() => {
      expect(refreshMe).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText(/email two-factor authentication is enabled/i),
    ).toBeInTheDocument();
  });

  it('disabling email two-factor calls DELETE and refreshes /me', async () => {
    mockUser = {
      ...baseUser,
      mfa_factors: { totp: true, sms: false, email: true, preferred: 'totp' },
    };
    const user = userEvent.setup();
    const apiFetch = vi.mocked(apiClient.apiFetch);
    apiFetch.mockResolvedValue({ ok: true });

    renderPage();

    await user.click(screen.getByRole('button', { name: /^disable$/i }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/auth/mfa/email',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
    await waitFor(() => {
      expect(refreshMe).toHaveBeenCalled();
    });
  });

  it('switching preferred factor PUTs the new preference', async () => {
    mockUser = {
      ...baseUser,
      mfa_factors: { totp: true, sms: false, email: true, preferred: 'totp' },
    };
    const user = userEvent.setup();
    const apiFetch = vi.mocked(apiClient.apiFetch);
    apiFetch.mockResolvedValue({ ok: true });

    renderPage();

    // Email row has a "Make preferred" button because TOTP is currently
    // preferred. Click it and confirm the PUT payload.
    const makePreferredButtons = screen.getAllByRole('button', { name: /make preferred/i });
    // The first one is the email row (email comes before totp in row order)
    await user.click(makePreferredButtons[0]);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/me/mfa-preferences',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"preferred"'),
        }),
      );
    });
  });
});
