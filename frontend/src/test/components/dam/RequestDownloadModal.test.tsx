import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RequestDownloadModal } from '../../../components/dam/RequestDownloadModal';

const { createDownloadRequestMock, showToastMock } = vi.hoisted(() => ({
  createDownloadRequestMock: vi.fn(),
  showToastMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  createDownloadRequest: createDownloadRequestMock,
}));

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

const mediaItems = [
  { media_id: 'm-1', filename: 'photo1.jpg', title: 'Photo One' },
  { media_id: 'm-2', filename: 'photo2.jpg', title: null },
];

function renderModal(props: Partial<Parameters<typeof RequestDownloadModal>[0]> = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <RequestDownloadModal
        organizationId="org-1"
        mediaItems={mediaItems}
        onClose={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('RequestDownloadModal', () => {
  beforeEach(() => {
    createDownloadRequestMock.mockReset();
    showToastMock.mockReset();
  });

  it('renders the title and item count', () => {
    renderModal();
    expect(screen.getByText('Request Download')).toBeInTheDocument();
    expect(screen.getByText('2 items selected')).toBeInTheDocument();
  });

  it('shows singular form for one item', () => {
    renderModal({ mediaItems: [mediaItems[0]] });
    expect(screen.getByText('1 item selected')).toBeInTheDocument();
  });

  it('shows the collection name when provided', () => {
    renderModal({ collectionName: 'Spring Show' });
    expect(screen.getByText(/from "Spring Show"/)).toBeInTheDocument();
  });

  it('lists item titles when there are 5 or fewer items', () => {
    renderModal();
    expect(screen.getByText('Photo One')).toBeInTheDocument();
    expect(screen.getByText('photo2.jpg')).toBeInTheDocument();
  });

  it('disables submit button when intended use is empty', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /Submit Request/, hidden: true })).toBeDisabled();
  });

  it('enables submit once intended use is filled', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText(/How will you use these images/), {
      target: { value: 'For research' },
    });
    expect(screen.getByRole('button', { name: /Submit Request/, hidden: true })).not.toBeDisabled();
  });

  it('submits with the gathered form data and shows success toast', async () => {
    createDownloadRequestMock.mockResolvedValue({});
    const onClose = vi.fn();
    renderModal({ onClose, collectionId: 'col-1' });
    fireEvent.change(screen.getByPlaceholderText(/How will you use these images/), {
      target: { value: 'For research' },
    });
    fireEvent.change(screen.getByPlaceholderText(/University, museum, company/), {
      target: { value: 'My Inst' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Submit Request/, hidden: true }));

    await waitFor(() =>
      expect(createDownloadRequestMock).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({
          media_ids: ['m-1', 'm-2'],
          purpose: 'research',
          intended_use: 'For research',
          collection_id: 'col-1',
          requester_institution: 'My Inst',
          derivative_type_requested: 'access_master',
        }),
      ),
    );
    await waitFor(() => expect(showToastMock).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows an inline error if creation fails', async () => {
    createDownloadRequestMock.mockRejectedValue(new Error('boom'));
    renderModal();
    fireEvent.change(screen.getByPlaceholderText(/How will you use these images/), {
      target: { value: 'X' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Submit Request/, hidden: true }));
    await waitFor(() =>
      expect(screen.getByText(/Failed to submit request/)).toBeInTheDocument(),
    );
  });

  it('Cancel triggers onClose', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', hidden: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
