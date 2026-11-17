import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import ExhibitionDetailPage from '../../../pages/discover/ExhibitionDetailPage';
import { checkA11y } from '../../a11y';

vi.mock('../../../lib/api/discover', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api/discover')>();
  return { ...actual, getDiscoverInfo: vi.fn().mockResolvedValue({ organization_name: 'Museum' }) };
});

vi.mock('../../../pages/discover/components/CollectionSiteShell', () => ({
  CollectionSiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

const exhibition = {
  exhibition_id: 'e1',
  title: 'Spring Show',
  subtitle: 'New acquisitions',
  public_url_slug: 'spring-show',
  exhibition_type: 'temporary',
  status: 'open',
  planned_start_date: null,
  planned_end_date: null,
  actual_start_date: null,
  actual_end_date: null,
  short_description: null,
  description: 'Works from the collection.',
  venue_name: null,
  venue_slug: null,
  is_featured: false,
  ticketing_url: null,
  thumbnail_url: null,
  hero_image_url: null,
  tags: null,
  public_object_count: 12,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/c/museum/exhibitions/spring-show']}>
          <Routes>
            <Route path="/c/:orgSlug/exhibitions/:slug" element={<ExhibitionDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

describe('ExhibitionDetailPage export', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: exhibition }) }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers CSV and JSON downloads of the exhibition objects', async () => {
    renderPage();
    const section = await screen.findByRole('region', { name: 'Objects in this exhibition' });
    const csv = within(section).getByRole('link', { name: 'Download these 12 objects as CSV' });
    expect(csv).toHaveAttribute('href', '/api/discover/museum/exhibitions/spring-show/export?format=csv');
    expect(within(section).getByRole('link', { name: 'Download these 12 objects as JSON' })).toHaveAttribute(
      'href',
      '/api/discover/museum/exhibitions/spring-show/export?format=json',
    );
    expect(within(section).queryByRole('button', { name: /copy link/i })).toBeNull();
  });

  it('has no axe violations in the export section', async () => {
    renderPage();
    const section = await screen.findByRole('region', { name: 'Objects in this exhibition' });
    const results = await checkA11y(section);
    expect(results.violations).toEqual([]);
  });

  it('omits the section when no objects are public', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { ...exhibition, public_object_count: 0 } }) }),
    );
    renderPage();
    await screen.findByRole('heading', { name: 'Spring Show' });
    expect(screen.queryByRole('region', { name: 'Objects in this exhibition' })).toBeNull();
  });
});
