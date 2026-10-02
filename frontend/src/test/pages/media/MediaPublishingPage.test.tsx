import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MediaPublishingPage from '../../../pages/media/MediaPublishingPage';
import * as api from '../../../lib/api';

vi.mock('../../../lib/api', () => ({
  searchMedia: vi.fn(),
  publishMedia: vi.fn(),
  unpublishMedia: vi.fn(),
}));

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), dismissToast: vi.fn(), toasts: [] }),
}));

vi.mock('../../../components/dam', () => ({
  PublishMediaDialog: ({ mediaId, onClose }: { mediaId: string; onClose: () => void }) => (
    <div data-testid="publish-dialog" data-media-id={mediaId}>
      <button onClick={onClose}>Close Publish Dialog</button>
    </div>
  ),
}));

const mockSearchMedia = vi.mocked(api.searchMedia);
const mockUnpublishMedia = vi.mocked(api.unpublishMedia);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(orgId = 'org-123') {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={[`/organizations/${orgId}/media/publishing`]}
      >
        <Routes>
          <Route
            path="/organizations/:orgId/media/publishing"
            element={<MediaPublishingPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sampleHits = {
  hits: [
    {
      media_id: 'm-1',
      media_type: 'image',
      filename: 'photo.jpg',
      title: 'Vacation Photo',
      description: null,
      copyright_status: 'public_domain',
      is_published: true,
      processing_status: 'completed',
      alt_text: null,
    },
    {
      media_id: 'm-2',
      media_type: 'video',
      filename: 'clip.mp4',
      title: null,
      description: null,
      copyright_status: null,
      is_published: false,
      processing_status: 'completed',
      alt_text: null,
    },
  ],
};

describe('MediaPublishingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state', () => {
    mockSearchMedia.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(
      screen.getByRole('heading', { name: /media publishing/i }),
    ).toBeInTheDocument();
  });

  it('renders header and description', async () => {
    mockSearchMedia.mockResolvedValue(sampleHits as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /media publishing/i }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/configure and manage public access/i),
    ).toBeInTheDocument();
  });

  it('renders stat cards', async () => {
    mockSearchMedia.mockResolvedValue(sampleHits as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Published')).toBeInTheDocument();
    });
    expect(screen.getByText(/pending review/i)).toBeInTheDocument();
    expect(screen.getByText(/rights issues/i)).toBeInTheDocument();
    expect(screen.getAllByText(/all media/i).length).toBeGreaterThan(0);
  });

  it('renders rows for each media item', async () => {
    mockSearchMedia.mockResolvedValue(sampleHits as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Vacation Photo')).toBeInTheDocument();
    });
    expect(screen.getByText('clip.mp4')).toBeInTheDocument();
  });

  it('renders IIIF endpoint sections', async () => {
    mockSearchMedia.mockResolvedValue(sampleHits as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/iiif endpoints/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/image api 3\.0/i)).toBeInTheDocument();
    expect(screen.getByText(/presentation api 3\.0/i)).toBeInTheDocument();
  });

  it('shows publishing requirements', async () => {
    mockSearchMedia.mockResolvedValue(sampleHits as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/publishing requirements/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/rights verification/i)).toBeInTheDocument();
    expect(screen.getAllByText(/consent records/i).length).toBeGreaterThan(0);
  });

  it('opens publish dialog when clicking Publish on an unpublished item', async () => {
    mockSearchMedia.mockResolvedValue(sampleHits as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('clip.mp4')).toBeInTheDocument();
    });
    const publishBtn = screen.getByRole('button', { name: /^publish$/i });
    fireEvent.click(publishBtn);
    await waitFor(() => {
      expect(screen.getByTestId('publish-dialog')).toBeInTheDocument();
    });
  });

  it('filters to draft when clicking the Pending Review stat card', async () => {
    mockSearchMedia.mockResolvedValue(sampleHits as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/pending review/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/pending review/i));
    await waitFor(() => {
      expect(mockSearchMedia).toHaveBeenCalledWith(
        'org-123',
        expect.objectContaining({ is_published: false }),
      );
    });
  });

  it('opens unpublish confirm dialog when clicking Unpublish', async () => {
    mockSearchMedia.mockResolvedValue(sampleHits as any);
    mockUnpublishMedia.mockResolvedValue({ success: true } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Vacation Photo')).toBeInTheDocument();
    });
    const unpublishBtn = screen.getByRole('button', { name: /^unpublish$/i });
    fireEvent.click(unpublishBtn);
    // ConfirmDialog should now be in the DOM
    await waitFor(() => {
      expect(
        screen.getByText(/are you sure you want to unpublish/i),
      ).toBeInTheDocument();
    });
  });
});
