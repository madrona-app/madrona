import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MediaAnalyticsPage from '../../../pages/media/MediaAnalyticsPage';
import * as api from '../../../lib/api';

vi.mock('../../../lib/api', () => ({
  getMediaUsageReport: vi.fn(),
}));

const mockGetMediaUsageReport = vi.mocked(api.getMediaUsageReport);

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
      <MemoryRouter initialEntries={[`/organizations/${orgId}/media/analytics`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/media/analytics"
            element={<MediaAnalyticsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('MediaAnalyticsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading skeleton initially', () => {
    mockGetMediaUsageReport.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.queryByRole('heading', { name: /media analytics/i })).not.toBeInTheDocument();
  });

  it('shows error state when fetch fails', async () => {
    mockGetMediaUsageReport.mockRejectedValue(new Error('Analytics offline'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error loading analytics/i)).toBeInTheDocument();
      expect(screen.getByText(/analytics offline/i)).toBeInTheDocument();
    });
  });

  it('renders title and description', async () => {
    mockGetMediaUsageReport.mockResolvedValue({
      by_event_type: { views: 0, downloads: 0, embeds: 0, api_accesses: 0 },
      total_events: 0,
      top_media: [],
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /media analytics/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/track usage and engagement/i)).toBeInTheDocument();
  });

  it('renders period selector buttons', async () => {
    mockGetMediaUsageReport.mockResolvedValue({
      by_event_type: { views: 0, downloads: 0, embeds: 0, api_accesses: 0 },
      total_events: 0,
      top_media: [],
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /media analytics/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: '7 days' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '30 days' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '90 days' })).toBeInTheDocument();
  });

  it('renders stat cards with formatted values', async () => {
    mockGetMediaUsageReport.mockResolvedValue({
      by_event_type: { views: 1234, downloads: 10, embeds: 5, api_accesses: 99 },
      total_events: 1348,
      top_media: [],
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/total events/i)).toBeInTheDocument();
    });
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('1,348')).toBeInTheDocument();
    expect(screen.getByText('99')).toBeInTheDocument();
  });

  it('shows empty top-media state when none available', async () => {
    mockGetMediaUsageReport.mockResolvedValue({
      by_event_type: { views: 0, downloads: 0, embeds: 0, api_accesses: 0 },
      total_events: 0,
      top_media: [],
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no data yet/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/usage statistics will appear here/i)
    ).toBeInTheDocument();
  });

  it('renders top media rows with counts', async () => {
    mockGetMediaUsageReport.mockResolvedValue({
      by_event_type: { views: 50, downloads: 10, embeds: 2, api_accesses: 1 },
      total_events: 63,
      top_media: [
        {
          media_id: 'm-1',
          filename: 'photo.jpg',
          title: 'Cover Photo',
          thumbnail_url: null,
          views: 40,
          downloads: 8,
          embeds: 1,
          api_accesses: 0,
          total_events: 49,
        },
      ],
    } as any);

    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Cover Photo')).toBeInTheDocument();
    });
    expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    expect(screen.getByText('49')).toBeInTheDocument();
  });
});
