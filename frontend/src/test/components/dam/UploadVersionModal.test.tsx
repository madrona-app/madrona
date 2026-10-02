import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UploadVersionModal } from '../../../components/dam/UploadVersionModal';

const { uploadMediaVersionMock } = vi.hoisted(() => ({
  uploadMediaVersionMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  uploadMediaVersion: uploadMediaVersionMock,
}));

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderModal(props: Partial<Parameters<typeof UploadVersionModal>[0]> = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <UploadVersionModal organizationId="org-1" mediaId="m-1" onClose={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

describe('UploadVersionModal', () => {
  beforeEach(() => {
    uploadMediaVersionMock.mockReset();
  });

  it('renders the title', () => {
    renderModal();
    expect(screen.getByText('Upload New Version')).toBeInTheDocument();
  });

  it('renders the drop zone with default copy when no file is selected', () => {
    renderModal();
    expect(screen.getByText('Drop file here or click to browse')).toBeInTheDocument();
  });

  it('disables Upload Version button when no file is selected', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /Upload Version/, hidden: true })).toBeDisabled();
  });

  it('shows the file metadata once a file is selected', () => {
    renderModal();
    const file = new File(['hello'], 'replacement.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText('replacement.jpg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload Version/, hidden: true })).not.toBeDisabled();
  });

  it('clears the file when "Remove" is clicked', () => {
    renderModal();
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText('x.png')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Remove'));
    expect(screen.queryByText('x.png')).not.toBeInTheDocument();
  });

  it('calls uploadMediaVersion with the file and change note on submit', async () => {
    uploadMediaVersionMock.mockResolvedValue({ version_id: 'v-2' });
    const onClose = vi.fn();
    renderModal({ onClose });
    const file = new File(['payload'], 'cover.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('Change Note (optional)'), {
      target: { value: 'Updated cover image' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Upload Version/, hidden: true }));

    await waitFor(() =>
      expect(uploadMediaVersionMock).toHaveBeenCalledWith(
        'org-1',
        'm-1',
        file,
        'Updated cover image',
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('renders inline error when API fails', async () => {
    uploadMediaVersionMock.mockRejectedValue(new Error('Disk full'));
    renderModal();
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: /Upload Version/, hidden: true }));
    await waitFor(() => expect(screen.getByText('Disk full')).toBeInTheDocument());
  });

  it('Cancel triggers onClose', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', hidden: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
