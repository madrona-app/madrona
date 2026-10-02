import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RevokeConsentModal } from '../../../components/dam/RevokeConsentModal';

const { revokeMediaConsentMock } = vi.hoisted(() => ({
  revokeMediaConsentMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  revokeMediaConsent: revokeMediaConsentMock,
}));

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

const baseConsent = {
  consent_id: 'c-1',
  subject_name: 'Jane Doe',
} as any;

function renderModal(props: Partial<Parameters<typeof RevokeConsentModal>[0]> = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <RevokeConsentModal
        isOpen
        organizationId="org-1"
        mediaId="m-1"
        consent={baseConsent}
        onClose={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('RevokeConsentModal', () => {
  beforeEach(() => {
    revokeMediaConsentMock.mockReset();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = renderModal({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it('renders the subject name in the warning message', () => {
    renderModal();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('renders the Revocation Reason textarea', () => {
    renderModal();
    expect(screen.getByPlaceholderText(/Optional: Enter reason/)).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('submits with no reason when textarea is empty', async () => {
    revokeMediaConsentMock.mockResolvedValue({});
    const onClose = vi.fn();
    renderModal({ onClose });
    // The footer "Revoke Consent" button (h2 has same text)
    const buttons = screen.getAllByText('Revoke Consent');
    const submitButton = buttons.find((el) => el.tagName === 'BUTTON');
    fireEvent.click(submitButton!);
    await waitFor(() =>
      expect(revokeMediaConsentMock).toHaveBeenCalledWith('org-1', 'm-1', 'c-1', undefined),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('passes the entered reason to revokeMediaConsent', async () => {
    revokeMediaConsentMock.mockResolvedValue({});
    renderModal();
    fireEvent.change(screen.getByPlaceholderText(/Optional: Enter reason/), {
      target: { value: 'Subject withdrew consent' },
    });
    const submitButton = screen.getAllByText('Revoke Consent').find((el) => el.tagName === 'BUTTON');
    fireEvent.click(submitButton!);
    await waitFor(() =>
      expect(revokeMediaConsentMock).toHaveBeenCalledWith(
        'org-1',
        'm-1',
        'c-1',
        'Subject withdrew consent',
      ),
    );
  });

  it('renders an inline error if the API rejects', async () => {
    revokeMediaConsentMock.mockRejectedValue(new Error('Network error'));
    renderModal();
    const submitButton = screen.getAllByText('Revoke Consent').find((el) => el.tagName === 'BUTTON');
    fireEvent.click(submitButton!);
    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument());
  });
});
