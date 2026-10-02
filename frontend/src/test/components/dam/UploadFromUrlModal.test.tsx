import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UploadFromUrlModal } from '../../../components/dam/UploadFromUrlModal';

vi.mock('../../../lib/api/media-dam', () => ({
  uploadFromUrl: vi.fn(),
}));

const showToast = vi.fn();
vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast }),
}));

import { uploadFromUrl } from '../../../lib/api/media-dam';
const mockUploadFromUrl = vi.mocked(uploadFromUrl);

function renderModal(props?: Partial<Parameters<typeof UploadFromUrlModal>[0]>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <UploadFromUrlModal
        organizationId="org-1"
        onClose={vi.fn()}
        {...props}
      />
    </QueryClientProvider>
  );
}

describe('UploadFromUrlModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders title and URL input', () => {
    renderModal();
    expect(screen.getByText('Upload from URL')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('https://example.com/image.jpg')).toBeInTheDocument();
  });

  it('renders optional title input', () => {
    renderModal();
    expect(screen.getByPlaceholderText('Custom title for this media')).toBeInTheDocument();
  });

  it('disables Upload button when URL is empty', () => {
    renderModal();
    const uploadBtn = screen.getByRole('button', { name: /^Upload$/, hidden: true });
    expect(uploadBtn).toBeDisabled();
  });

  it('disables Upload button for invalid URL (no protocol)', () => {
    renderModal();
    const urlInput = screen.getByPlaceholderText('https://example.com/image.jpg');
    fireEvent.change(urlInput, { target: { value: 'example.com/image.jpg' } });
    const uploadBtn = screen.getByRole('button', { name: /^Upload$/, hidden: true });
    expect(uploadBtn).toBeDisabled();
  });

  it('enables Upload button for valid https URL', () => {
    renderModal();
    const urlInput = screen.getByPlaceholderText('https://example.com/image.jpg');
    fireEvent.change(urlInput, { target: { value: 'https://example.com/cat.jpg' } });
    const uploadBtn = screen.getByRole('button', { name: /^Upload$/, hidden: true });
    expect(uploadBtn).not.toBeDisabled();
  });

  it('calls uploadFromUrl with URL and folder when Upload clicked', async () => {
    mockUploadFromUrl.mockResolvedValue({ media_id: 'm-1' } as never);
    renderModal({ folderId: 'folder-1' });

    fireEvent.change(screen.getByPlaceholderText('https://example.com/image.jpg'), {
      target: { value: 'https://example.com/cat.jpg' },
    });
    fireEvent.change(screen.getByPlaceholderText('Custom title for this media'), {
      target: { value: 'My Cat' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Upload$/, hidden: true }));

    await waitFor(() => {
      expect(mockUploadFromUrl).toHaveBeenCalledWith('org-1', 'https://example.com/cat.jpg', 'My Cat', 'folder-1');
    });
  });

  it('shows success toast and closes on success', async () => {
    mockUploadFromUrl.mockResolvedValue({ media_id: 'm-1' } as never);
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.change(screen.getByPlaceholderText('https://example.com/image.jpg'), {
      target: { value: 'https://example.com/a.jpg' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Upload$/, hidden: true }));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith({ title: 'Upload queued from URL', type: 'success' });
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows error toast on failure', async () => {
    mockUploadFromUrl.mockRejectedValue(new Error('bad url'));
    renderModal();

    fireEvent.change(screen.getByPlaceholderText('https://example.com/image.jpg'), {
      target: { value: 'https://example.com/a.jpg' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Upload$/, hidden: true }));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith({ title: 'Upload failed: bad url', type: 'error' });
    });
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when close icon button clicked', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByLabelText('Close upload dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
