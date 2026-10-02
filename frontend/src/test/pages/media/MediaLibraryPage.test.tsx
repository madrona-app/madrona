/**
 * The media library grid reads rows out of two different envelopes.
 *
 * With no search it calls listMedia, which returns the shared paginated shape
 * ({ items, total, page, page_size, total_pages }). With a search it calls
 * searchMedia, which returns search hits ({ hits, total }). The page used to
 * read `media` or `hits`, typed by a hand-written local interface, so when the
 * list endpoint moved to `items` it still compiled — and the library showed
 * "No media yet." over 152 media in the database.
 *
 * These tests feed the page each envelope exactly as the API function returns
 * it, and assert on what a person sees.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MediaLibraryPage from '../../../pages/media/MediaLibraryPage';
import * as api from '../../../lib/api';
import type { Media, MediaListResponse, MediaSearchResponse } from '../../../lib/schemas';

vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api')>()),
  listMedia: vi.fn(),
  searchMedia: vi.fn(),
  deleteMedia: vi.fn(),
  getMediaActiveContext: vi.fn(),
}));

vi.mock('../../../lib/api/media', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api/media')>()),
  getMediaAIConfig: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../lib/api/media-dam', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api/media-dam')>()),
  visualSearch: vi.fn(),
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: () => true,
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
  }),
}));

vi.mock('../../../contexts/uploadStore', () => ({
  useUpload: () => ({ addFiles: vi.fn() }),
}));

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

// Sidebar and toolbar widgets fetch their own data; none of it is under test.
vi.mock('../../../components/dam', () => ({
  MediaTagFilter: () => null,
  formatTagFiltersForQuery: () => [],
  AddToCollectionDropdown: () => null,
  BatchMetadataPanel: () => null,
  FolderTree: () => null,
  FolderContextMenu: () => null,
  CreateFolderModal: () => null,
  MoveToFolderModal: () => null,
  UploadFromUrlModal: () => null,
}));
vi.mock('../../../components/dam/ColorFilter', () => ({ ColorFilter: () => null }));
vi.mock('../../../components/media-workspaces', () => ({
  AddToMediaWorkspaceDialog: () => null,
  MediaBulkActionDialog: () => null,
}));
vi.mock('../../../components/workspaces/SaveMediaSearchAsWorkSetDialog', () => ({
  default: () => null,
}));

const mockListMedia = vi.mocked(api.listMedia);
const mockSearchMedia = vi.mocked(api.searchMedia);
const mockDeleteMedia = vi.mocked(api.deleteMedia);

function media(media_id: string, title: string): Media {
  return {
    media_id,
    title,
    filename: `${media_id}.jpg`,
    media_type: 'image',
    processing_status: 'completed',
    thumbnail_url: null,
  } as Media;
}

function listResponse(items: Media[]): MediaListResponse {
  return { items, total: items.length, page: 1, page_size: 48, total_pages: 1 };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/organizations/org-1/media']}>
        <Routes>
          <Route path="/organizations/:orgId/media" element={<MediaLibraryPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MediaLibraryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getMediaActiveContext).mockResolvedValue({ context: null } as never);
  });

  it('renders the rows listMedia returns under `items`', async () => {
    mockListMedia.mockResolvedValue(
      listResponse([media('m-1', 'Harbour at dusk'), media('m-2', 'Portrait of a sitter')]),
    );

    renderPage();

    expect(await screen.findByText('Harbour at dusk')).toBeInTheDocument();
    expect(screen.getByText('Portrait of a sitter')).toBeInTheDocument();
    expect(screen.queryByText('No media yet.')).not.toBeInTheDocument();
  });

  it('shows the empty state only when the list really is empty', async () => {
    mockListMedia.mockResolvedValue(listResponse([]));

    renderPage();

    expect(await screen.findByText('No media yet.')).toBeInTheDocument();
  });

  it('renders the rows searchMedia returns under `hits`', async () => {
    mockListMedia.mockResolvedValue(listResponse([media('m-1', 'Harbour at dusk')]));
    mockSearchMedia.mockResolvedValue({
      hits: [media('m-9', 'Lighthouse study')],
      total: 1,
    } as unknown as MediaSearchResponse);

    renderPage();
    await screen.findByText('Harbour at dusk');

    fireEvent.change(screen.getByPlaceholderText('Search media...'), {
      target: { value: 'lighthouse' },
    });

    expect(await screen.findByText('Lighthouse study')).toBeInTheDocument();
    expect(mockSearchMedia).toHaveBeenCalledWith('org-1', expect.objectContaining({ q: 'lighthouse' }));
    expect(screen.queryByText('Harbour at dusk')).not.toBeInTheDocument();
  });

  it('removes a deleted row from the unsearched grid before the server answers', async () => {
    // The optimistic update only ever filtered `hits`, so on the list path it
    // was a no-op. A delete that never settles proves the row went from the
    // cache, not from a refetch.
    mockListMedia.mockResolvedValue(
      listResponse([media('m-1', 'Harbour at dusk'), media('m-2', 'Portrait of a sitter')]),
    );
    mockDeleteMedia.mockReturnValue(new Promise(() => {}));

    renderPage();
    await screen.findByText('Harbour at dusk');

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByText('Harbour at dusk')).not.toBeInTheDocument());
    expect(mockDeleteMedia).toHaveBeenCalledWith('org-1', 'm-1');
    expect(screen.getByText('Portrait of a sitter')).toBeInTheDocument();
    expect(mockListMedia).toHaveBeenCalledTimes(1);
  });
});
