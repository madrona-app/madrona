import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MoveToFolderModal } from '../../../components/dam/MoveToFolderModal';

const { listMediaFoldersMock, moveMediaToFolderMock } = vi.hoisted(() => ({
  listMediaFoldersMock: vi.fn(),
  moveMediaToFolderMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  listMediaFolders: listMediaFoldersMock,
  moveMediaToFolder: moveMediaToFolderMock,
}));

const folders = [
  { folder_id: 'f-1', name: 'Photographs', parent_folder_id: null, depth: 0, sort_order: 0 },
  { folder_id: 'f-2', name: 'Drawings', parent_folder_id: null, depth: 0, sort_order: 1 },
  { folder_id: 'f-3', name: 'B&W', parent_folder_id: 'f-1', depth: 1, sort_order: 0 },
];

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderModal(props: Partial<Parameters<typeof MoveToFolderModal>[0]> = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <MoveToFolderModal
        organizationId="org-1"
        mediaIds={['m-1']}
        currentFolderId={null}
        onClose={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('MoveToFolderModal', () => {
  beforeEach(() => {
    listMediaFoldersMock.mockReset();
    moveMediaToFolderMock.mockReset();
  });

  it('renders the singular item label', async () => {
    listMediaFoldersMock.mockResolvedValue({ folders: [] });
    renderModal({ mediaIds: ['m-1'] });
    expect(screen.getByText('Move 1 item')).toBeInTheDocument();
  });

  it('renders the plural item label', async () => {
    listMediaFoldersMock.mockResolvedValue({ folders: [] });
    renderModal({ mediaIds: ['m-1', 'm-2', 'm-3'] });
    expect(screen.getByText('Move 3 items')).toBeInTheDocument();
  });

  it('renders empty-state when there are no folders', async () => {
    listMediaFoldersMock.mockResolvedValue({ folders: [] });
    renderModal();
    await waitFor(() => expect(screen.getByText('No folders available')).toBeInTheDocument());
  });

  it('renders loaded folders', async () => {
    listMediaFoldersMock.mockResolvedValue({ folders });
    renderModal({ currentFolderId: 'f-3' });
    await waitFor(() => expect(screen.getByText('Photographs')).toBeInTheDocument());
    expect(screen.getByText('Drawings')).toBeInTheDocument();
  });

  it('calls moveMediaToFolder on submit when a folder is selected', async () => {
    listMediaFoldersMock.mockResolvedValue({ folders });
    moveMediaToFolderMock.mockResolvedValue({});
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    renderModal({ currentFolderId: 'f-3', onClose, onSuccess });
    await waitFor(() => screen.getByText('Photographs'));
    fireEvent.click(screen.getByText('Photographs'));
    fireEvent.click(screen.getByRole('button', { name: /Move Here/, hidden: true }));
    await waitFor(() =>
      expect(moveMediaToFolderMock).toHaveBeenCalledWith('org-1', 'f-1', ['m-1']),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('Cancel triggers onClose', async () => {
    listMediaFoldersMock.mockResolvedValue({ folders: [] });
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', hidden: true }));
    expect(onClose).toHaveBeenCalled();
  });

  it('disables move when no destination is chosen and currentFolderId is null', async () => {
    listMediaFoldersMock.mockResolvedValue({ folders });
    renderModal({ currentFolderId: null });
    await waitFor(() => screen.getByText('Photographs'));
    expect(screen.getByRole('button', { name: /Move Here/, hidden: true })).toBeDisabled();
  });
});
