/**
 * Accessibility checks for sign-in, the MFA steps, the auth pages and
 * ConfirmDialog. Automated checks only (axe + role/name queries).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { checkA11y, formatViolations } from '../a11y';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  onApiError: () => () => {},
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: false,
    isLoading: false,
    user: null,
    activeOrganizationId: null,
    refreshMe: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn(),
  }),
}));

vi.mock('../../hooks/useInstallRedirect', () => ({ useInstallRedirect: () => {} }));

import SignInPage from '../../pages/auth/SignInPage';
import ForgotPasswordPage from '../../pages/auth/ForgotPasswordPage';
import MfaVerifyForm from '../../components/MfaVerifyForm';
import MfaSetupForm from '../../components/MfaSetupForm';
import ConfirmDialog from '../../components/ConfirmDialog';
import { AuthError } from '../../components/AuthLayout';

async function expectNoViolations(el: Element) {
  const results = await checkA11y(el);
  expect(results.violations, formatViolations(results)).toEqual([]);
}

describe('Sign-in and auth pages', () => {
  it('sign-in page has no axe violations and labelled fields in a main landmark', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/sign-in']}>
        <SignInPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Madrona' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it('forgot-password page does not steal focus on load', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/forgot-password']}>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('Email address')).not.toHaveFocus();
    await expectNoViolations(container);
  });

  it('auth errors are announced as alerts', () => {
    render(<AuthError message="Incorrect email or password" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Incorrect email or password');
  });
});

describe('MFA steps', () => {
  it('verify step has no axe violations, a page heading, and focuses the code field', async () => {
    const { container } = render(
      <main>
        <MfaVerifyForm
          email="user@example.com"
          session="s1"
          mfaType="totp"
          onSuccess={vi.fn()}
          onCancel={vi.fn()}
          onVerify={vi.fn()}
        />
      </main>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Two-factor authentication' })).toBeInTheDocument();
    const code = screen.getByRole('textbox', { name: '6-digit verification code' });
    await waitFor(() => expect(code).toHaveFocus());
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    await expectNoViolations(container);
  });

  it('verify step announces a wrong code as an alert', async () => {
    const onVerify = vi.fn().mockRejectedValue(new Error('bad'));
    render(
      <MfaVerifyForm
        email="user@example.com"
        session="s1"
        mfaType="totp"
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        onVerify={onVerify}
      />,
    );
    const code = screen.getByRole('textbox', { name: '6-digit verification code' });
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid code');
  });

  it('setup step has no axe violations', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const { container } = render(
      <main>
        <MfaSetupForm
          email="user@example.com"
          session="s1"
          onSuccess={vi.fn()}
          onCancel={vi.fn()}
          onSetupStart={vi.fn().mockResolvedValue({
            secret: 'JBSWY3DPEHPK3PXP',
            otpauthUrl: 'otpauth://totp/Madrona:user@example.com?secret=JBSWY3DPEHPK3PXP',
            session: 's2',
          })}
          onSetupVerify={vi.fn()}
        />
      </main>,
    );
    await screen.findByRole('heading', { level: 1 });
    await screen.findByAltText(/QR Code/);
    await expectNoViolations(container);
  });
});

describe('ConfirmDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('is a labelled, described modal dialog with no axe violations', async () => {
    render(
      <ConfirmDialog
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Delete record"
        message="This cannot be undone."
        confirmText="Delete"
        confirmStyle="danger"
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete record' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveAttribute('type', 'button');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    await expectNoViolations(document.body);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog isOpen onClose={onClose} onConfirm={vi.fn()} title="Delete record" message="Sure?" />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
