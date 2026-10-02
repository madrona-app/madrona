import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import ExhibitionListPage from '../../pages/discover/ExhibitionListPage';
import * as discoverApi from '../../lib/api/discover';
import * as contentApi from '../../lib/api/content';

vi.mock('../../lib/api/discover', () => ({
  getDiscoverInfo: vi.fn(),
}));

vi.mock('../../lib/api/content', () => ({
  getPublicMenu: vi.fn(),
}));

const mockGetDiscoverInfo = vi.mocked(discoverApi.getDiscoverInfo);
const mockGetPublicMenu = vi.mocked(contentApi.getPublicMenu);

function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(orgSlug = 'test-museum') {
  const client = createTestQueryClient();
  return render(
    <HelmetProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/c/${orgSlug}/exhibitions`]}>
          <Routes>
            <Route path="/c/:orgSlug/exhibitions" element={<ExhibitionListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

const originalFetch = globalThis.fetch;

describe('ExhibitionListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDiscoverInfo.mockResolvedValue({ organization_name: 'Test Museum' } as never);
    mockGetPublicMenu.mockResolvedValue({ items: [] } as never);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('shows the Exhibitions tab list', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/exhibitions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [], total: 0 }) });
      }
      if (url.includes('/venues')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      }
      return Promise.reject(new Error('unexpected url'));
    }) as never;

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /now on view/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: /coming soon/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /past/i })).toBeInTheDocument();
  });

  it('shows empty state when there are no exhibitions in the active tab', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/exhibitions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [], total: 0 }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    }) as never;

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/no exhibitions found/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/no exhibitions currently on view/i)).toBeInTheDocument();
  });

  it('renders exhibition cards from the API', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/exhibitions')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                {
                  exhibition_id: 'e-1',
                  public_url_slug: 'modern-art',
                  title: 'Modern Art Survey',
                  short_description: 'Survey show',
                  thumbnail_url: null,
                  planned_start_date: '2026-01-01',
                  planned_end_date: '2026-06-01',
                  actual_start_date: null,
                  actual_end_date: null,
                  is_featured: false,
                  venue_name: 'Main Gallery',
                  status: 'open',
                  ticketing_url: null,
                  tags: [],
                },
              ],
              total: 1,
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    }) as never;

    renderPage('amundsen');

    await waitFor(() => {
      expect(screen.getByText('Modern Art Survey')).toBeInTheDocument();
    });
    expect(screen.getByText('Modern Art Survey').closest('a')).toHaveAttribute(
      'href',
      '/c/amundsen/exhibitions/modern-art',
    );
  });

  it('does not crash when the exhibitions fetch fails', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/exhibitions')) {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    }) as never;

    renderPage();

    // Page header should still render (tabs from Tabs config) — error boundary handled
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /now on view/i })).toBeInTheDocument();
    });
  });
});
