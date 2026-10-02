import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MediaDerivativeSettingsPage from '../../../pages/media/MediaDerivativeSettingsPage';
import * as damApi from '../../../lib/api/media-dam';

vi.mock('../../../lib/api/media-dam', () => ({
  getDerivativeSizes: vi.fn(),
  createDerivativeSize: vi.fn(),
  deleteDerivativeSize: vi.fn(),
}));

const mockGetDerivativeSizes = vi.mocked(damApi.getDerivativeSizes);

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
        initialEntries={[`/organizations/${orgId}/media/derivative-settings`]}
      >
        <Routes>
          <Route
            path="/organizations/:orgId/media/derivative-settings"
            element={<MediaDerivativeSettingsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sampleConfigs = {
  derivative_sizes: [
    {
      config_id: 'c-1',
      name: 'web_large',
      label: 'Web Large',
      media_type: 'image',
      max_width: 1600,
      max_height: 1200,
      format: 'jpeg',
      quality: 85,
      is_default: true,
      is_system: false,
      sort_order: 1,
    },
    {
      config_id: 'c-2',
      name: 'thumbnail',
      label: 'Thumbnail',
      media_type: 'image',
      max_width: 200,
      max_height: 200,
      format: 'webp',
      quality: 80,
      is_default: false,
      is_system: true,
      sort_order: 0,
    },
    {
      config_id: 'c-3',
      name: 'video_preview',
      label: 'Video Preview',
      media_type: 'video',
      max_width: 800,
      max_height: 600,
      format: 'mp4',
      quality: null,
      is_default: false,
      is_system: false,
      sort_order: 0,
    },
  ],
};

describe('MediaDerivativeSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading skeleton initially', () => {
    mockGetDerivativeSizes.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(
      screen.queryByRole('heading', { name: /derivative sizes/i }),
    ).not.toBeInTheDocument();
  });

  it('renders heading and configs', async () => {
    mockGetDerivativeSizes.mockResolvedValue(sampleConfigs as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /derivative sizes/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Web Large')).toBeInTheDocument();
    expect(screen.getByText('Thumbnail')).toBeInTheDocument();
  });

  it('shows new size profile button', async () => {
    mockGetDerivativeSizes.mockResolvedValue(sampleConfigs as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /new size profile/i }),
      ).toBeInTheDocument();
    });
  });

  it('renders error state on failure', async () => {
    mockGetDerivativeSizes.mockRejectedValue(new Error('blew up'));
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/error loading derivative sizes/i),
      ).toBeInTheDocument();
    });
  });

  it('renders media type tabs', async () => {
    mockGetDerivativeSizes.mockResolvedValue(sampleConfigs as any);
    renderPage();
    await waitFor(() => {
      // Image tab and Video tab should both render
      expect(
        screen.getByRole('button', { name: /image/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /video/i })).toBeInTheDocument();
  });

  it('switches tab when clicking video', async () => {
    mockGetDerivativeSizes.mockResolvedValue(sampleConfigs as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Web Large')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /video/i }));
    await waitFor(() => {
      expect(screen.getByText('Video Preview')).toBeInTheDocument();
    });
  });

  it('opens create form when clicking New Size Profile', async () => {
    mockGetDerivativeSizes.mockResolvedValue(sampleConfigs as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /new size profile/i }),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /new size profile/i }));
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /new derivative size/i }),
      ).toBeInTheDocument();
    });
  });
});
