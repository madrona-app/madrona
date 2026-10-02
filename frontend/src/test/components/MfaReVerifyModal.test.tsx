import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MfaReVerifyModal } from '../../components/MfaReVerifyModal';

// Mock the api client
const { apiFetchMock, ApiError } = vi.hoisted(() => {
  class ApiErrorImpl extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
      this.name = 'ApiError';
    }
  }
  return {
    apiFetchMock: vi.fn(),
    ApiError: ApiErrorImpl,
  };
});

vi.mock('../../lib/apiClient', () => ({
  apiFetch: apiFetchMock,
  ApiError,
}));

function renderModal(overrides: Partial<Parameters<typeof MfaReVerifyModal>[0]> = {}) {
  return render(
    <MfaReVerifyModal
      isOpen
      onClose={vi.fn()}
      onSuccess={vi.fn()}
      {...overrides}
    />,
  );
}

describe('MfaReVerifyModal', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('returns null when isOpen is false', () => {
    const { container } = render(
      <MfaReVerifyModal isOpen={false} onClose={vi.fn()} onSuccess={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the title and default description when open', () => {
    renderModal();
    expect(screen.getByText('Verify your identity')).toBeInTheDocument();
    expect(
      screen.getByText('This action requires multi-factor authentication.'),
    ).toBeInTheDocument();
  });

  it('renders the stale warning when isStale is true', () => {
    renderModal({ isStale: true, mfaAgeMinutes: 30 });
    expect(
      screen.getByText(/Your last verification was 30 minutes ago/),
    ).toBeInTheDocument();
  });

  it('renders an optional reason', () => {
    renderModal({ reason: 'Deleting an organization is sensitive.' });
    expect(
      screen.getByText('Deleting an organization is sensitive.'),
    ).toBeInTheDocument();
  });

  it('strips non-digit characters and limits to 6 digits', () => {
    renderModal();
    const input = screen.getByLabelText('Verification code') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc12-34d5678' } });
    expect(input.value).toBe('123456');
  });

  it('disables submit until 6 digits entered', () => {
    renderModal();
    const submit = screen.getByRole('button', { name: 'Verify', hidden: true });
    expect(submit).toBeDisabled();

    const input = screen.getByLabelText('Verification code');
    fireEvent.change(input, { target: { value: '12345' } });
    expect(submit).toBeDisabled();

    fireEvent.change(input, { target: { value: '123456' } });
    expect(submit).not.toBeDisabled();
  });

  it('calls onClose when cancel button is clicked', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', hidden: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when X button is clicked', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Close', hidden: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('submits to /auth/mfa/reverify and calls onSuccess on success', async () => {
    const onSuccess = vi.fn();
    apiFetchMock.mockResolvedValue({ access_token: 'new-token' });
    renderModal({ onSuccess });

    fireEvent.change(screen.getByLabelText('Verification code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify', hidden: true }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/auth/mfa/reverify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ code: '123456' }),
      }),
    );
  });

  it('shows the invalid-code error for a 401 response', async () => {
    apiFetchMock.mockRejectedValue(new ApiError('Invalid', 401));
    const onSuccess = vi.fn();
    renderModal({ onSuccess });

    fireEvent.change(screen.getByLabelText('Verification code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify', hidden: true }));

    await waitFor(() =>
      expect(
        screen.getByText('Invalid verification code. Please try again.'),
      ).toBeInTheDocument(),
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('shows the rate-limit error for a 429 response', async () => {
    apiFetchMock.mockRejectedValue(new ApiError('Too many', 429));
    renderModal();

    fireEvent.change(screen.getByLabelText('Verification code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify', hidden: true }));

    await waitFor(() =>
      expect(
        screen.getByText('Too many attempts. Please wait a moment and try again.'),
      ).toBeInTheDocument(),
    );
  });

  it('shows a generic message for non-ApiError failures', async () => {
    apiFetchMock.mockRejectedValue(new Error('boom'));
    renderModal();

    fireEvent.change(screen.getByLabelText('Verification code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify', hidden: true }));

    await waitFor(() =>
      expect(
        screen.getByText('An unexpected error occurred. Please try again.'),
      ).toBeInTheDocument(),
    );
  });
});
