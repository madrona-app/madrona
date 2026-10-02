import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { DiscoverObjectPage } from '../../../pages/discover/DiscoverObjectPage';
import * as api from '../../../lib/api';

vi.mock('../../../lib/api', () => ({
  getDiscoverInfo: vi.fn(),
  getDiscoverObject: vi.fn(),
}));

vi.mock('../../../pages/discover/components/CollectionSiteShell', () => ({
  CollectionSiteShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="site-shell">{children}</div>
  ),
}));

vi.mock('../../../pages/discover/components/RelatedObjects', () => ({
  RelatedObjects: () => <div data-testid="related-objects" />,
}));

vi.mock('../../../pages/discover/components/ShareToolbar', () => ({
  ShareToolbar: () => <div data-testid="share-toolbar" />,
}));

vi.mock('../../../components/ui/ResponsiveImage', () => ({
  ResponsiveImage: ({ alt }: { alt: string }) => (
    <img alt={alt} data-testid="responsive-image" />
  ),
}));

const mockGetDiscoverInfo = vi.mocked(api.getDiscoverInfo);
const mockGetDiscoverObject = vi.mocked(api.getDiscoverObject);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(orgSlug = 'museum-org', objectId = 'obj-1') {
  const qc = createQueryClient();
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/c/${orgSlug}/objects/${objectId}`]}>
          <Routes>
            <Route
              path="/c/:orgSlug/objects/:objectId"
              element={<DiscoverObjectPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

const sampleObj = {
  object_id: 'obj-1',
  object_number: 'OBJ-001',
  title: 'A Beautiful Vase',
  brief_description: 'A historic vase',
  creators: ['Jane Artist'],
  creation_date_display: '1850',
  materials: [{ name: 'ceramic', label: 'Ceramic' }],
  techniques: [],
  measurements: [],
  inscriptions: [],
  media: [
    { url: 'https://example.com/img.jpg', alt_text: 'Vase image' },
  ],
};

describe('DiscoverObjectPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDiscoverInfo.mockResolvedValue({
      organization_name: 'Museum Org',
    } as any);
  });

  it('renders site shell', () => {
    mockGetDiscoverObject.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('site-shell')).toBeInTheDocument();
  });

  it('renders not-found state on error', async () => {
    mockGetDiscoverObject.mockRejectedValue(new Error('not found'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/object not found/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/this object is not available/i),
    ).toBeInTheDocument();
  });

  it('renders object title when loaded', async () => {
    mockGetDiscoverObject.mockResolvedValue(sampleObj as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /a beautiful vase/i }),
      ).toBeInTheDocument();
    });
  });

  it('renders creator name', async () => {
    mockGetDiscoverObject.mockResolvedValue(sampleObj as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/jane artist/i)).toBeInTheDocument();
    });
  });

  it('renders related objects component', async () => {
    mockGetDiscoverObject.mockResolvedValue(sampleObj as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('related-objects')).toBeInTheDocument();
    });
  });

  it('renders share toolbar', async () => {
    mockGetDiscoverObject.mockResolvedValue(sampleObj as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('share-toolbar')).toBeInTheDocument();
    });
  });

  it('queries with the object id', async () => {
    mockGetDiscoverObject.mockResolvedValue(sampleObj as any);
    renderPage('my-museum', 'abc-123');
    await waitFor(() => {
      expect(mockGetDiscoverObject).toHaveBeenCalledWith('my-museum', 'abc-123');
    });
  });

  it('renders Back to collection link in error state', async () => {
    mockGetDiscoverObject.mockRejectedValue(new Error('not found'));
    renderPage();
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /back to collection/i });
      expect(link).toHaveAttribute('href', '/c/museum-org');
    });
  });
});
