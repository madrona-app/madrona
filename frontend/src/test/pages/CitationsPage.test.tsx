import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CitationsPage from '../../pages/collections/CitationsPage';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getCitations: vi.fn(),
  deleteCitation: vi.fn(),
}));

const mockGetCitations = vi.mocked(api.getCitations);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(orgId = 'org-123') {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/citations`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/citations"
            element={<CitationsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sampleCitations = {
  total: 2,
  items: [
    {
      citation_id: 'c-1',
      brief_citation: 'Smith 2020',
      citation_type: 'book',
      author: 'Jane Smith',
      publication_year: 2020,
      title: 'A Long Title',
      works_cited: true,
      works_illustrated: false,
    },
    {
      citation_id: 'c-2',
      brief_citation: 'Doe 2019',
      citation_type: 'article',
      author: null,
      publication_year: null,
    },
  ],
};

describe('CitationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('shows loading state on first render', () => {
    mockGetCitations.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(
      screen.queryByRole('heading', { name: /^citations$/i }),
    ).not.toBeInTheDocument();
  });

  it('renders heading and rows after loading', async () => {
    mockGetCitations.mockResolvedValue(sampleCitations as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /^citations$/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Smith 2020')).toBeInTheDocument();
    expect(screen.getByText('Doe 2019')).toBeInTheDocument();
  });

  it('shows total count text', async () => {
    mockGetCitations.mockResolvedValue(sampleCitations as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/2 citations/i)).toBeInTheDocument();
    });
  });

  it('renders error banner on query failure', async () => {
    mockGetCitations.mockRejectedValue(new Error('db down'));
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/error loading citations: db down/i),
      ).toBeInTheDocument();
    });
  });

  it('shows empty state when no citations', async () => {
    mockGetCitations.mockResolvedValue({ total: 0, items: [] } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no citations yet\./i)).toBeInTheDocument();
    });
  });

  it('renders Add Citation link', async () => {
    mockGetCitations.mockResolvedValue(sampleCitations as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /add citation/i })).toHaveAttribute(
        'href',
        '/organizations/org-123/collections/citations/create',
      );
    });
  });

  it('changing type filter triggers re-query', async () => {
    mockGetCitations.mockResolvedValue(sampleCitations as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Smith 2020')).toBeInTheDocument();
    });
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'book' } });
    await waitFor(() => {
      expect(mockGetCitations).toHaveBeenCalledWith(
        'org-123',
        expect.objectContaining({ citation_type: 'book' }),
      );
    });
  });
});
