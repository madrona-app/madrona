/**
 * Accessibility checks for the public portal: the search results view, an
 * object record page, and the breadcrumb / permalink / export controls on
 * both. Real page components are rendered; only the network layer and the
 * site shell (nav, footer, chat widget — not under test here) are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { DiscoverPage } from '../../../pages/discover/DiscoverPage';
import { DiscoverObjectPage } from '../../../pages/discover/DiscoverObjectPage';
import * as api from '../../../lib/api';
import { checkA11y } from '../../a11y';

vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>();
  return {
    ...actual,
    getDiscoverInfo: vi.fn(),
    searchDiscoverObjects: vi.fn(),
    getDiscoverObject: vi.fn(),
    getFeaturedObjects: vi.fn().mockResolvedValue({ hits: [] }),
    getRelatedObjects: vi.fn().mockResolvedValue({ hits: [] }),
  };
});

vi.mock('../../../lib/api/content', () => ({
  getPublishedPageById: vi.fn(),
}));

vi.mock('../../../pages/discover/components/CollectionSiteShell', () => ({
  CollectionSiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock('../../../pages/discover/components/RelatedObjects', () => ({
  RelatedObjects: () => null,
}));

const hits = [
  {
    object_id: 'o1',
    object_number: 'OBJ-1',
    title: 'Blue vase',
    brief_description: null,
    creators: ['Jane Potter'],
    creation_date_display: '1850',
    classification: 'Ceramic',
    object_type: 'vessel',
    thumbnail_url: null,
    thumbnail_srcset: null,
    has_image: false,
  },
  {
    object_id: 'o2',
    object_number: 'OBJ-2',
    title: 'Green vase',
    brief_description: null,
    creators: [],
    creation_date_display: null,
    classification: null,
    object_type: 'vessel',
    thumbnail_url: null,
    thumbnail_srcset: null,
    has_image: false,
  },
];

const objectDetail = {
  object_id: 'o1',
  object_number: 'OBJ-1',
  canonical_url: '/c/museum/objects/OBJ-1',
  title: 'Blue vase',
  titles: [],
  brief_description: 'A blue vase',
  full_description: null,
  object_type: 'vessel',
  classification: 'Ceramic',
  classifications: [],
  creators: ['Jane Potter'],
  creation_date_display: '1850',
  materials: [],
  techniques: [],
  measurements: [],
  inscriptions: [],
  external_links: [],
  media: [],
  has_image: false,
};

function renderAt(entry: string | { pathname: string; search?: string; state?: unknown }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/c/:orgSlug" element={<DiscoverPage />} />
            <Route path="/c/:orgSlug/objects/:objectId" element={<DiscoverObjectPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

describe('Discover accessibility', () => {
  beforeEach(() => {
    vi.mocked(api.getDiscoverInfo).mockResolvedValue({
      organization_name: 'Museum',
      page_title: 'Explore',
      homepage_page_id: null,
      total_discoverable: 2,
    } as never);
    vi.mocked(api.searchDiscoverObjects).mockResolvedValue({ hits, total: 42, facets: [] } as never);
    vi.mocked(api.getDiscoverObject).mockResolvedValue(objectDetail as never);
  });

  describe('search results view', () => {
    const url = '/c/museum?object_type=vessel&q=vase&sort=title_asc';

    it('shows a breadcrumb trail for the query and facets', async () => {
      renderAt(url);
      const nav = await screen.findByRole('navigation', { name: 'Breadcrumb' });
      expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/c/museum');
      expect(within(nav).getByRole('link', { name: 'Search: “vase”' })).toHaveAttribute(
        'href',
        '/c/museum?q=vase&sort=title_asc',
      );
      expect(within(nav).getByText('Filtered by Type: vessel')).toHaveAttribute('aria-current', 'page');
    });

    it('offers a canonical permalink and named exports of the results', async () => {
      renderAt(url);
      const csv = await screen.findByRole('link', { name: 'Download these 42 results as CSV' });
      expect(csv.getAttribute('href')).toBe(
        '/api/discover/museum/search/export?q=vase&object_type=vessel&sort=title_asc&format=csv',
      );
      expect(screen.getByRole('link', { name: 'Download these 42 results as JSON' })).toBeInTheDocument();

      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      await userEvent.click(screen.getByRole('button', { name: 'Copy link to these results' }));
      // Canonical order (q first), not the order of the incoming URL.
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/c/museum?q=vase&object_type=vessel&sort=title_asc`,
      );
      await waitFor(() => expect(screen.getByText('Link copied to clipboard.')).toBeInTheDocument());
    });

    it('result links carry the results context, not extra URL params', async () => {
      renderAt(url);
      const link = await screen.findByRole('link', { name: /Blue vase/ });
      expect(link).toHaveAttribute('href', '/c/museum/objects/OBJ-1');
    });

    it('has no axe violations', async () => {
      const { container } = renderAt(url);
      await screen.findByRole('link', { name: 'Download these 42 results as CSV' });
      const results = await checkA11y(container);
      expect(results.violations).toEqual([]);
    });

    it('keeps the closed filter panel out of the tab order, and it is a labelled dialog when open', async () => {
      vi.mocked(api.searchDiscoverObjects).mockResolvedValue({
        hits,
        total: 42,
        facets: [{ field: 'object_type', buckets: [{ key: 'vessel', count: 2 }, { key: 'print', count: 1 }] }],
      } as never);
      const { container } = renderAt(url);
      await screen.findByRole('link', { name: 'Download these 42 results as CSV' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByRole('combobox', { name: 'Sort by' })).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: 'Filters and sort' }));
      const dialog = await screen.findByRole('dialog', { name: 'Filters' });
      expect(within(dialog).getByRole('combobox', { name: 'Sort by' })).toBeInTheDocument();
      expect(within(dialog).getByRole('textbox', { name: 'From year' })).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed');
      await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
      const results = await checkA11y(container);
      expect(results.violations).toEqual([]);
    });

    it('has no breadcrumb when nothing is searched', async () => {
      renderAt('/c/museum');
      await screen.findByRole('button', { name: 'Copy link to these results' });
      expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
    });
  });

  describe('object page', () => {
    it('links the breadcrumb back to the exact results it came from', async () => {
      renderAt({
        pathname: '/c/museum/objects/OBJ-1',
        state: { discoverResults: '?q=vase&object_type=vessel&page=2' },
      });
      const nav = await screen.findByRole('navigation', { name: 'Breadcrumb' });
      expect(
        within(nav).getByRole('link', { name: 'Search results for “vase”, Type: vessel' }),
      ).toHaveAttribute('href', '/c/museum?q=vase&object_type=vessel&page=2');
      expect(within(nav).getByText('Blue vase')).toHaveAttribute('aria-current', 'page');
    });

    it('falls back to Home > title for a shared record link', async () => {
      renderAt('/c/museum/objects/OBJ-1');
      const nav = await screen.findByRole('navigation', { name: 'Breadcrumb' });
      expect(within(nav).getAllByRole('listitem')).toHaveLength(2);
      expect(within(nav).getByRole('link', { name: 'Home' })).toBeInTheDocument();
    });

    it('has no axe violations', async () => {
      const { container } = renderAt({
        pathname: '/c/museum/objects/OBJ-1',
        state: { discoverResults: '?q=vase' },
      });
      await screen.findByRole('heading', { name: 'Blue vase' });
      const results = await checkA11y(container);
      expect(results.violations).toEqual([]);
    });
  });
});
