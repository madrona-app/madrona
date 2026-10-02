import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MediaCollectionDetailPage from '../../../pages/media/MediaCollectionDetailPage';
import * as api from '../../../lib/api';
import * as usePermissionsHook from '../../../hooks/usePermissions';

vi.mock('../../../lib/api', () => ({
  getMediaCollection: vi.fn(),
  updateMediaCollection: vi.fn(),
  deleteMediaCollection: vi.fn(),
  listCollectionItems: vi.fn(),
  removeCollectionItem: vi.fn(),
  reorderCollectionItems: vi.fn(),
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), dismissToast: vi.fn(), toasts: [] }),
}));

vi.mock('../../../hooks/useUnsavedGuard', () => ({
  useUnsavedGuard: vi.fn(),
}));

vi.mock('../../../components/dam', () => ({
  ShareCollectionModal: () => <div data-testid="share-modal" />,
  RequestDownloadModal: () => <div data-testid="request-download-modal" />,
  ContactSheetGenerator: () => <div data-testid="contact-sheet" />,
}));

const mockGetMediaCollection = vi.mocked(api.getMediaCollection);
const mockListCollectionItems = vi.mocked(api.listCollectionItems);
const mockUsePermissions = vi.mocked(usePermissionsHook.usePermissions);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(orgId = 'org-123', collectionId = 'col-1') {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={[`/organizations/${orgId}/media/collections/${collectionId}`]}
      >
        <Routes>
          <Route
            path="/organizations/:orgId/media/collections/:collectionId"
            element={<MediaCollectionDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sampleCollection = {
  collection_id: 'col-1',
  name: 'My Lightbox',
  description: 'A great collection',
  visibility: 'org',
  item_count: 2,
  cover_media_id: null,
  consent_clearance_required: false,
  created_at: '2024-01-01T00:00:00Z',
};

const sampleItems = {
  items: [
    {
      media_id: 'm-1',
      media_type: 'image',
      filename: 'photo.jpg',
      title: 'Photo One',
      sort_order: 0,
    },
    {
      media_id: 'm-2',
      media_type: 'video',
      filename: 'clip.mp4',
      title: 'Video Clip',
      sort_order: 1,
    },
  ],
};

describe('MediaCollectionDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(true),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
    });
  });

  it('shows loading skeleton initially', () => {
    mockGetMediaCollection.mockImplementation(() => new Promise(() => {}));
    mockListCollectionItems.mockResolvedValue({ items: [] } as any);
    renderPage();
    expect(
      screen.queryByRole('heading', { name: /my lightbox/i }),
    ).not.toBeInTheDocument();
  });

  it('renders the collection name and description', async () => {
    mockGetMediaCollection.mockResolvedValue(sampleCollection as any);
    mockListCollectionItems.mockResolvedValue(sampleItems as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /my lightbox/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/a great collection/i)).toBeInTheDocument();
  });

  it('shows item count', async () => {
    mockGetMediaCollection.mockResolvedValue(sampleCollection as any);
    mockListCollectionItems.mockResolvedValue(sampleItems as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/2 items/i)).toBeInTheDocument();
    });
  });

  it('renders error state when load fails', async () => {
    mockGetMediaCollection.mockRejectedValue(new Error('not found'));
    mockListCollectionItems.mockResolvedValue({ items: [] } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error: not found/i)).toBeInTheDocument();
    });
  });

  it('shows lightbox not found when no collection returned', async () => {
    mockGetMediaCollection.mockResolvedValue(null as any);
    mockListCollectionItems.mockResolvedValue({ items: [] } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/lightbox not found/i)).toBeInTheDocument();
    });
  });

  it('enters edit mode when Edit clicked', async () => {
    mockGetMediaCollection.mockResolvedValue(sampleCollection as any);
    mockListCollectionItems.mockResolvedValue(sampleItems as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: /cancel/i }),
    ).toBeInTheDocument();
  });

  it('disables edit button when user lacks permission', async () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
      hasAnyPermission: vi.fn().mockReturnValue(false),
      hasAllPermissions: vi.fn().mockReturnValue(false),
    });
    mockGetMediaCollection.mockResolvedValue(sampleCollection as any);
    mockListCollectionItems.mockResolvedValue(sampleItems as any);
    renderPage();
    await waitFor(() => {
      const editBtn = screen.getByRole('button', { name: /edit/i });
      expect(editBtn).toBeDisabled();
    });
  });

  it('renders share button', async () => {
    mockGetMediaCollection.mockResolvedValue(sampleCollection as any);
    mockListCollectionItems.mockResolvedValue(sampleItems as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /share/i })).toBeInTheDocument();
    });
  });
});
