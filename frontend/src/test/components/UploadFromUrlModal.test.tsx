import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UploadFromUrlModal } from '../../components/dam/UploadFromUrlModal';

// Mock the API and toast context
vi.mock('../../lib/api/media-dam', () => ({
  uploadFromUrl: vi.fn(() => Promise.resolve({ id: 'media-1' })),
}));

const mockShowToast = vi.fn();
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function renderModal(props?: Partial<Parameters<typeof UploadFromUrlModal>[0]>) {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <UploadFromUrlModal
        organizationId="org-1"
        onClose={vi.fn()}
        {...props}
      />
    </QueryClientProvider>
  );
}

describe('UploadFromUrlModal', () => {
  it('renders dialog with title', () => {
    renderModal();
    expect(screen.getByText('Upload from URL')).toBeInTheDocument();
  });

  it('renders URL and Title input fields', () => {
    renderModal();
    expect(screen.getByPlaceholderText('https://example.com/image.jpg')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Custom title for this media')).toBeInTheDocument();
  });

  it('renders Cancel and Upload buttons', () => {
    renderModal();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Upload')).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when X button is clicked', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByRole('button', { name: /Close upload dialog/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables Upload button when URL is empty', () => {
    renderModal();
    const uploadBtn = screen.getByText('Upload');
    expect(uploadBtn).toBeDisabled();
  });

  it('disables Upload button when URL is not valid (no http prefix)', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('https://example.com/image.jpg'), {
      target: { value: 'not-a-url' },
    });
    expect(screen.getByText('Upload')).toBeDisabled();
  });

  it('enables Upload button when URL starts with https://', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('https://example.com/image.jpg'), {
      target: { value: 'https://example.com/photo.jpg' },
    });
    expect(screen.getByText('Upload')).not.toBeDisabled();
  });

  it('enables Upload button when URL starts with http://', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('https://example.com/image.jpg'), {
      target: { value: 'http://example.com/photo.jpg' },
    });
    expect(screen.getByText('Upload')).not.toBeDisabled();
  });

  it('renders accessible dialog structure', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', 'upload-url-title');
  });

  it('renders field labels', () => {
    renderModal();
    expect(screen.getByText('URL')).toBeInTheDocument();
    expect(screen.getByText('Title (optional)')).toBeInTheDocument();
  });
});
