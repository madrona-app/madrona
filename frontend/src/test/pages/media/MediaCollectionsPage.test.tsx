import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MediaCollectionsPage from '../../../pages/media/MediaCollectionsPage';
import * as api from '../../../lib/api';
import * as usePermissionsHook from '../../../hooks/usePermissions';

vi.mock('../../../lib/api', () => ({
  listMediaCollections: vi.fn(),
  deleteMediaCollection: vi.fn(),
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

// Dialog components pulled from components/dam
vi.mock('../../../components/dam', () => ({
  CreateCollectionModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Create Collection">
      <button onClick={onClose}>Close</button>
      Create Modal
    </div>
  ),
  ShareCollectionModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Share Collection">
      <button onClick={onClose}>Close Share</button>
      Share Modal
    </div>
  ),
}));

const mockListMediaCollections = vi.mocked(api.listMediaCollections);
const _mockDeleteMediaCollection = vi.mocked(api.deleteMediaCollection);
const mockUsePermissions = vi.mocked(usePermissionsHook.usePermissions);

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPage(orgId = 'org-123') {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/media/collections`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/media/collections"
            element={<MediaCollectionsPage />}
          />
          <Route
            path="/organizations/:orgId/media/collections/:collectionId"
            element={<div>Collection Detail</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function grantAllPermissions() {
  mockUsePermissions.mockReturnValue({
    hasPermission: vi.fn().mockReturnValue(true),
    hasAnyPermission: vi.fn().mockReturnValue(true),
    hasAllPermissions: vi.fn().mockReturnValue(true),
  });
}

describe('MediaCollectionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grantAllPermissions();
  });

  it('shows loading skeleton while fetching', () => {
    mockListMediaCollections.mockImplementation(() => new Promise(() => {}));
    renderPage();
    // Loading state uses animate-pulse skeleton divs — no text but no heading either
    expect(screen.queryByRole('heading', { name: /lightboxes/i })).not.toBeInTheDocument();
  });

  it('renders error state on API failure', async () => {
    mockListMediaCollections.mockRejectedValue(new Error('network'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/failed to load collections/i)).toBeInTheDocument();
    });
  });

  it('renders empty state with create CTA when no collections', async () => {
    mockListMediaCollections.mockResolvedValue({ items: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no lightboxes yet/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /create lightbox/i })).toBeInTheDocument();
  });

  it('hides empty-state create button when user lacks edit permission', async () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
      hasAnyPermission: vi.fn().mockReturnValue(false),
      hasAllPermissions: vi.fn().mockReturnValue(false),
    });
    mockListMediaCollections.mockResolvedValue({ items: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no lightboxes yet/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /create lightbox/i })).not.toBeInTheDocument();
  });

  it('renders collection grid with items', async () => {
    mockListMediaCollections.mockResolvedValue({
      items: [
        {
          collection_id: 'col-1',
          name: 'Summer Exhibit',
          description: 'Warm photos',
          visibility: 'org',
          item_count: 12,
          cover_url: null,
        } as any,
        {
          collection_id: 'col-2',
          name: 'Private Studies',
          visibility: 'private',
          item_count: 3,
          cover_url: null,
        } as any,
      ],
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Summer Exhibit')).toBeInTheDocument();
    });
    expect(screen.getByText('Private Studies')).toBeInTheDocument();
    expect(screen.getByText('12 items')).toBeInTheDocument();
    expect(screen.getByText('3 items')).toBeInTheDocument();
  });

  it('opens create modal when "New Lightbox" is clicked', async () => {
    mockListMediaCollections.mockResolvedValue({ items: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no lightboxes yet/i)).toBeInTheDocument();
    });
    const newBtns = screen.getAllByRole('button', { name: /new lightbox|create lightbox/i });
    fireEvent.click(newBtns[0]);
    expect(screen.getByRole('dialog', { name: /create collection/i })).toBeInTheDocument();
  });

  it('switches between grid and list view', async () => {
    mockListMediaCollections.mockResolvedValue({
      items: [
        {
          collection_id: 'col-1',
          name: 'One',
          visibility: 'public',
          item_count: 5,
          cover_url: null,
          description: 'desc',
        } as any,
      ],
    });
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByText('One')).toBeInTheDocument());

    // Grid view: contains the grid container class
    expect(container.querySelector('.grid.grid-cols-1.md\\:grid-cols-2')).toBeTruthy();

    // Click the "List" toggle (the second toggle button; distinguished by lucide icon order)
    const buttons = container.querySelectorAll('.flex.items-center.border button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(buttons[1]);
    // After switching to list, the divide-y "card divide-y" wrapper should render
    await waitFor(() => {
      expect(container.querySelector('.card.divide-y')).toBeTruthy();
    });
  });

});
