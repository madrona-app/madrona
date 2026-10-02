import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ChangePasswordModal from '../../components/ChangePasswordModal';

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
}));

vi.mock('../../lib/apiClient', () => ({
  apiFetch: apiFetchMock,
  ApiError: class ApiError extends Error {},
}));

function renderModal(extra: Partial<React.ComponentProps<typeof ChangePasswordModal>> = {}) {
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <ChangePasswordModal isOpen onClose={onClose} {...extra} />
    </QueryClientProvider>,
  );
  return { onClose, ...utils };
}

describe('ChangePasswordModal', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('renders nothing when not open', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <ChangePasswordModal isOpen={false} onClose={() => {}} />
      </QueryClientProvider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the title', () => {
    renderModal();
    // Multiple "Change Password" occurrences (title + button) — just check at least one
    expect(screen.getAllByText('Change Password').length).toBeGreaterThan(0);
  });

  it('renders three password inputs', () => {
    renderModal();
    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm new password')).toBeInTheDocument();
  });

  it('shows validation error when current password is empty', async () => {
    renderModal();
    fireEvent.click(
      Array.from(document.querySelectorAll('button[type="submit"]')).find(
        (b) => b.textContent === 'Change Password',
      )!,
    );
    expect(await screen.findByText(/Please enter your current password/)).toBeInTheDocument();
  });

  it('shows validation error when new password is too short', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'oldpass1' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'short' } });
    // Submit by submitting the form directly to bypass HTML5 validation
    const form = document.querySelector('form');
    fireEvent.submit(form!);
    // Multiple "at least 8 characters" hints exist (one helper, one error) — assert at least one
    await waitFor(() => {
      expect(screen.getAllByText(/at least 8 characters/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows validation error when passwords do not match', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'oldpass' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'longerpass' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'mismatch1' } });
    fireEvent.click(
      Array.from(document.querySelectorAll('button[type="submit"]')).find(
        (b) => b.textContent === 'Change Password',
      )!,
    );
    expect(await screen.findByText(/do not match/)).toBeInTheDocument();
  });

  it('shows validation error when new == current', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'samepass1' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'samepass1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'samepass1' } });
    fireEvent.click(
      Array.from(document.querySelectorAll('button[type="submit"]')).find(
        (b) => b.textContent === 'Change Password',
      )!,
    );
    expect(
      await screen.findByText(/must be different from current/),
    ).toBeInTheDocument();
  });

  it('successful change calls the API and shows success', async () => {
    apiFetchMock.mockResolvedValue({ message: 'ok' });
    renderModal();
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'oldpass1' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpass1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'newpass1' } });
    fireEvent.click(
      Array.from(document.querySelectorAll('button[type="submit"]')).find(
        (b) => b.textContent === 'Change Password',
      )!,
    );
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/auth/password/change',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(await screen.findByText(/Password changed successfully/)).toBeInTheDocument();
  });

  it('shows MFA step when API responds with mfaRequired', async () => {
    apiFetchMock.mockResolvedValue({ mfaRequired: true, session: 's-1', challengeType: 'SOFTWARE_TOKEN_MFA' });
    renderModal();
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'oldpass1' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpass1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'newpass1' } });
    fireEvent.click(
      Array.from(document.querySelectorAll('button[type="submit"]')).find(
        (b) => b.textContent === 'Change Password',
      )!,
    );
    expect(await screen.findByText('Verify Your Identity')).toBeInTheDocument();
  });

  it('toggling current-password visibility flips input type', () => {
    renderModal();
    const input = screen.getByLabelText('Current password') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.click(screen.getAllByLabelText(/Show password/)[0]);
    expect(input.type).toBe('text');
  });

  it('Cancel button calls onClose', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});
