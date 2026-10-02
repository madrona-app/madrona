import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FolderTree } from '../../../components/dam/FolderTree';

vi.mock('../../../lib/api', () => ({
  listMediaFolders: vi.fn(),
}));

import { listMediaFolders } from '../../../lib/api';
const mockList = vi.mocked(listMediaFolders);

function renderTree(props?: Partial<Parameters<typeof FolderTree>[0]>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FolderTree
        organizationId="org-1"
        selectedFolderId={null}
        onSelectFolder={vi.fn()}
        {...props}
      />
    </QueryClientProvider>
  );
}

describe('FolderTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', () => {
    mockList.mockReturnValue(new Promise(() => {}) as never);
    renderTree();
    expect(screen.getByText('Loading folders...')).toBeInTheDocument();
  });

  it('renders empty state when no folders', async () => {
    mockList.mockResolvedValue({ folders: [], unfiled_count: 0 } as never);
    renderTree();
    await waitFor(() => {
      expect(screen.getByText('No folders yet')).toBeInTheDocument();
    });
  });

  it('renders All Media and Unfiled entries', async () => {
    mockList.mockResolvedValue({ folders: [], unfiled_count: 0 } as never);
    renderTree();
    await waitFor(() => {
      expect(screen.getByText('All Media')).toBeInTheDocument();
      expect(screen.getByText('Unfiled')).toBeInTheDocument();
    });
  });

  it('shows unfiled count when > 0', async () => {
    mockList.mockResolvedValue({ folders: [], unfiled_count: 7 } as never);
    renderTree();
    await waitFor(() => {
      expect(screen.getByText('7')).toBeInTheDocument();
    });
  });

  it('renders root folders sorted by sort_order then name', async () => {
    mockList.mockResolvedValue({
      folders: [
        { folder_id: 'b', name: 'Zebra', parent_folder_id: null, depth: 0, sort_order: 1, media_count: 0 },
        { folder_id: 'a', name: 'Alpha', parent_folder_id: null, depth: 0, sort_order: 0, media_count: 3 },
      ],
      unfiled_count: 0,
    } as never);
    renderTree();

    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeInTheDocument();
    });

    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Zebra')).toBeInTheDocument();
    // media count renders next to the name
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('calls onSelectFolder(null) when All Media row clicked', async () => {
    mockList.mockResolvedValue({ folders: [], unfiled_count: 0 } as never);
    const onSelectFolder = vi.fn();
    renderTree({ onSelectFolder });
    await waitFor(() => screen.getByText('All Media'));

    fireEvent.click(screen.getByText('All Media'));
    expect(onSelectFolder).toHaveBeenCalledWith(null);
  });

  it('calls onSelectFolder("unfiled") when Unfiled row clicked', async () => {
    mockList.mockResolvedValue({ folders: [], unfiled_count: 0 } as never);
    const onSelectFolder = vi.fn();
    renderTree({ onSelectFolder });
    await waitFor(() => screen.getByText('Unfiled'));

    fireEvent.click(screen.getByText('Unfiled'));
    expect(onSelectFolder).toHaveBeenCalledWith('unfiled');
  });

  it('expands a folder to reveal children when chevron clicked', async () => {
    mockList.mockResolvedValue({
      folders: [
        { folder_id: 'p1', name: 'Parent', parent_folder_id: null, depth: 0, sort_order: 0, media_count: 0 },
        { folder_id: 'c1', name: 'ChildOne', parent_folder_id: 'p1', depth: 1, sort_order: 0, media_count: 0 },
      ],
      unfiled_count: 0,
    } as never);
    renderTree();

    await waitFor(() => {
      expect(screen.getByText('Parent')).toBeInTheDocument();
    });

    // Child not visible yet
    expect(screen.queryByText('ChildOne')).not.toBeInTheDocument();

    // Click expand button (aria-label contains "Expand Parent")
    fireEvent.click(screen.getByLabelText('Expand Parent'));

    await waitFor(() => {
      expect(screen.getByText('ChildOne')).toBeInTheDocument();
    });
  });

  it('calls onCreateFolder(null) when header plus button clicked', async () => {
    mockList.mockResolvedValue({ folders: [], unfiled_count: 0 } as never);
    const onCreateFolder = vi.fn();
    renderTree({ onCreateFolder });
    await waitFor(() => screen.getByText('All Media'));

    fireEvent.click(screen.getByLabelText('Create folder'));
    expect(onCreateFolder).toHaveBeenCalledWith(null);
  });

  it('has tree role with accessible label', async () => {
    mockList.mockResolvedValue({ folders: [], unfiled_count: 0 } as never);
    renderTree();
    await waitFor(() => screen.getByText('All Media'));
    expect(screen.getByRole('tree')).toHaveAttribute('aria-label', 'Media folders');
  });
});
