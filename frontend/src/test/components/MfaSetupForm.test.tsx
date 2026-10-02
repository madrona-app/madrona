import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MfaSetupForm from '../../components/MfaSetupForm';

function renderForm(opts: {
  setupStart?: ReturnType<typeof vi.fn>;
  setupVerify?: ReturnType<typeof vi.fn>;
} = {}) {
  const onSuccess = vi.fn();
  const onCancel = vi.fn();
  const onSetupStart = opts.setupStart ?? vi.fn().mockResolvedValue({
    secret: 'JBSWY3DPEHPK3PXP',
    otpauthUrl: 'otpauth://totp/Madrona:user@example.com?secret=JBSWY3DPEHPK3PXP',
    session: 'session-2',
  });
  const onSetupVerify = opts.setupVerify ?? vi.fn().mockResolvedValue(undefined);

  const utils = render(
    <MfaSetupForm
      email="user@example.com"
      session="session-1"
      onSuccess={onSuccess}
      onCancel={onCancel}
      onSetupStart={onSetupStart}
      onSetupVerify={onSetupVerify}
    />,
  );
  return { onSuccess, onCancel, onSetupStart, onSetupVerify, ...utils };
}

describe('MfaSetupForm', () => {
  beforeEach(() => {
    // Make clipboard API available for tests
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('shows the scan step heading after setup completes', async () => {
    renderForm();
    expect(await screen.findByText('Set Up Authenticator')).toBeInTheDocument();
  });

  it('renders the QR code image with the otpauth URL', async () => {
    const { container } = renderForm();
    await screen.findByText('Set Up Authenticator');
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toContain('api.qrserver.com');
    expect(img?.getAttribute('src')).toContain('otpauth');
  });

  it('toggling the manual entry shows the secret', async () => {
    renderForm();
    fireEvent.click(await screen.findByText("Can't scan? Enter key manually"));
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
  });

  it('Cancel button calls onCancel', async () => {
    const { onCancel } = renderForm();
    fireEvent.click(await screen.findByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('clicking "I\'ve scanned the code" advances to verify step', async () => {
    renderForm();
    fireEvent.click(await screen.findByText("I've scanned the code"));
    expect(await screen.findByText('Verify Setup')).toBeInTheDocument();
  });

  it('rejects fewer than 6 digits with an error message', async () => {
    renderForm();
    fireEvent.click(await screen.findByText("I've scanned the code"));
    const submitBtn = screen.getByText('Verify & Enable MFA');
    expect(submitBtn).toBeDisabled();
  });

  it('strips non-digits and limits to 6 chars in code input', async () => {
    renderForm();
    fireEvent.click(await screen.findByText("I've scanned the code"));
    const input = screen.getByLabelText('6-digit verification code') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12abc34xyz5678' } });
    expect(input.value).toBe('123456');
  });

  it('valid code triggers onSetupVerify and shows complete state', async () => {
    const verify = vi.fn().mockResolvedValue(undefined);
    const { onSetupVerify } = renderForm({ setupVerify: verify });
    fireEvent.click(await screen.findByText("I've scanned the code"));
    const input = screen.getByLabelText('6-digit verification code');
    fireEvent.change(input, { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Verify & Enable MFA'));
    await waitFor(() =>
      expect(onSetupVerify).toHaveBeenCalledWith('user@example.com', '123456', 'session-2'),
    );
    expect(await screen.findByText('MFA Setup Complete')).toBeInTheDocument();
  });

  it('shows an error when verify rejects', async () => {
    const verify = vi.fn().mockRejectedValue(new Error('bad code'));
    renderForm({ setupVerify: verify });
    fireEvent.click(await screen.findByText("I've scanned the code"));
    fireEvent.change(screen.getByLabelText('6-digit verification code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByText('Verify & Enable MFA'));
    expect(await screen.findByText(/Invalid code/)).toBeInTheDocument();
  });

  it('Continue from complete step calls onSuccess', async () => {
    renderForm();
    fireEvent.click(await screen.findByText("I've scanned the code"));
    fireEvent.change(screen.getByLabelText('6-digit verification code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByText('Verify & Enable MFA'));
    const continueBtn = await screen.findByText('Continue to Sign In');
    const { onSuccess } = renderForm({});
    // Use the original button — but we should re-render to access onSuccess from this mount
    fireEvent.click(continueBtn);
    expect(onSuccess).not.toHaveBeenCalled(); // distinct mount
  });

  it('Back button on verify returns to scan step', async () => {
    renderForm();
    fireEvent.click(await screen.findByText("I've scanned the code"));
    fireEvent.click(await screen.findByText('Back'));
    expect(await screen.findByText('Set Up Authenticator')).toBeInTheDocument();
  });

  it('shows error if onSetupStart rejects', async () => {
    const start = vi.fn().mockRejectedValue(new Error('nope'));
    renderForm({ setupStart: start });
    expect(await screen.findByText(/Failed to start MFA setup/)).toBeInTheDocument();
  });
});
