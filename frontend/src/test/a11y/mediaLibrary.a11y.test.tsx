/**
 * Automated accessibility checks for the media library page (grid and list
 * views): axe over the rendered DOM, plus role/name queries for the controls a
 * keyboard or screen-reader user depends on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MediaLibraryPage from '../../pages/media/MediaLibraryPage';
import * as api from '../../lib/api';
import type { Media, MediaListResponse } from '../../lib/schemas';
import { checkA11y, formatViolations } from '../a11y';

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  listMedia: vi.fn(),
  searchMedia: vi.fn(),
  deleteMedia: vi.fn(),
  getMediaActiveContext: vi.fn(),
}));

vi.mock('../../lib/api/media', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/media')>()),
  getMediaAIConfig: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../lib/api/media-dam', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/media-dam')>()),
  visualSearch: vi.fn(),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: () => true,
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
  }),
}));

vi.mock('../../contexts/uploadStore', () => ({
  useUpload: () => ({ addFiles: vi.fn() }),
}));

vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

// Sidebar widgets fetch their own data and have their own checks
// (mediaComponents.a11y.test.tsx); here they are stubbed out.
vi.mock('../../components/dam', () => ({
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
vi.mock('../../components/dam/ColorFilter', () => ({ ColorFilter: () => null }));
vi.mock('../../components/media-workspaces', () => ({
  AddToMediaWorkspaceDialog: () => null,
  MediaBulkActionDialog: () => null,
}));
vi.mock('../../components/workspaces/SaveMediaSearchAsWorkSetDialog', () => ({
  default: () => null,
}));

function media(media_id: string, title: string, extra: Partial<Media> = {}): Media {
  return {
    media_id,
    title,
    filename: `${media_id}.jpg`,
    media_type: 'image',
    processing_status: 'completed',
    thumbnail_url: null,
    file_size: 2048,
    ...extra,
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

async function expectNoViolations(container: Element) {
  const results = await checkA11y(container);
  expect(results.violations, formatViolations(results)).toEqual([]);
}

describe('MediaLibraryPage accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getMediaActiveContext).mockResolvedValue({ context: null } as never);
    vi.mocked(api.listMedia).mockResolvedValue(
      listResponse([
        media('m-1', 'Harbour at dusk', { thumbnail_url: 'https://cdn/m-1.jpg' }),
        media('m-2', 'Portrait of a sitter'),
      ]),
    );
  });

  it('grid view has no axe violations', async () => {
    const { container } = renderPage();
    await screen.findByText('Harbour at dusk');
    await expectNoViolations(container);
  });

  it('grid cards open through a named link and select through a named checkbox', async () => {
    renderPage();
    await screen.findByText('Harbour at dusk');

    const link = screen.getByRole('link', { name: 'Harbour at dusk' });
    expect(link).toHaveAttribute('href', '/organizations/org-1/media/m-1');
    expect(screen.getByRole('checkbox', { name: 'Select Harbour at dusk' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Delete Harbour at dusk' }).length).toBeGreaterThan(0);
  });

  it('toolbar controls have names and expose their state', async () => {
    renderPage();
    await screen.findByText('Harbour at dusk');

    expect(screen.getByRole('textbox', { name: 'Search media' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Media type' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('list view has no axe violations and a captioned table with scoped headers', async () => {
    const { container } = renderPage();
    await screen.findByText('Harbour at dusk');
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));

    const table = screen.getByRole('table', { name: 'Media items' });
    expect(table.querySelectorAll('th[scope="col"]').length).toBeGreaterThanOrEqual(7);
    expect(screen.getByRole('checkbox', { name: 'Select all media on this page' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Portrait of a sitter' }).length).toBeGreaterThan(0);

    await expectNoViolations(container);
  });
});
