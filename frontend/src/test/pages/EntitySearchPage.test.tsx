import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EntitySearchPage from '../../pages/shared/EntitySearchPage';
import * as api from '../../lib/api';
import * as useOrganizationHook from '../../contexts/useOrganization';
import * as useSearchHook from '../../hooks/useSearch';
import * as useGeoHook from '../../hooks/useGeo';

vi.mock('../../lib/api', () => ({
  getDatasets: vi.fn(),
}));

vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(),
}));

vi.mock('../../hooks/useSearch', () => ({
  useSearch: vi.fn(),
}));

vi.mock('../../hooks/useGeo', () => ({
  default: vi.fn(),
}));

vi.mock('../../components/AdvancedSearchBuilder', () => ({
  default: () => <div data-testid="advanced-search-builder" />,
}));

vi.mock('../../components/RelationshipFilter', () => ({
  RelationshipFilter: () => <div data-testid="relationship-filter" />,
}));

vi.mock('../../components/maps/MapSearch', () => ({
  default: () => <div data-testid="map-search">map</div>,
}));

const mockGetDatasets = vi.mocked(api.getDatasets);
const mockUseOrganization = vi.mocked(useOrganizationHook.useOrganization);
const mockUseSearch = vi.mocked(useSearchHook.useSearch);
const mockUseGeo = vi.mocked(useGeoHook.default);

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={['/organizations/org-1/search']}>
        <Routes>
          <Route path="/organizations/:orgId/search" element={<EntitySearchPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function defaultSearchHook(overrides: Partial<ReturnType<typeof useSearchHook.useSearch>> = {}) {
  return {
    query: '',
    setQuery: vi.fn(),
    filters: {},
    toggleFilterValue: vi.fn(),
    clearFilters: vi.fn(),
    results: [],
    facets: [],
    total: 0,
    tookMs: 0,
    isLoading: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    advancedCriteria: [],
    advancedOperator: 'AND' as const,
    updateAdvancedSearch: vi.fn(),
    ...overrides,
  };
}

describe('EntitySearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseOrganization.mockReturnValue({ activeOrganizationId: 'org-1' } as never);
    mockGetDatasets.mockResolvedValue([]);
    mockUseGeo.mockReturnValue({
      searchObjectsInPolygon: { mutateAsync: vi.fn().mockResolvedValue({ objects: [], count: 0 }) },
    } as never);
    mockUseSearch.mockReturnValue(defaultSearchHook() as never);
  });

  it('renders the page heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /entity search/i })).toBeInTheDocument();
  });

  it('renders text/map mode toggle buttons', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /text search/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /map search/i })).toBeInTheDocument();
  });

  it('shows text search input with label', () => {
    renderPage();
    expect(screen.getByLabelText(/^search$/i)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/search by title, description/i)
    ).toBeInTheDocument();
  });

  it('shows empty state when no search has been entered', () => {
    renderPage();
    // The "Search for entities" heading appears in the empty-state card
    expect(screen.getByRole('heading', { name: /search for entities/i })).toBeInTheDocument();
  });

  it('switches to map mode and renders map search', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /map search/i }));
    await waitFor(() => {
      expect(screen.getByTestId('map-search')).toBeInTheDocument();
    });
    expect(screen.getByText(/geographic search/i)).toBeInTheDocument();
  });

  it('shows search input value in input', () => {
    mockUseSearch.mockReturnValue(
      defaultSearchHook({ query: 'vase' }) as never,
    );
    renderPage();
    const input = screen.getByLabelText(/^search$/i) as HTMLInputElement;
    expect(input.value).toBe('vase');
  });

  it('renders search results', async () => {
    mockUseSearch.mockReturnValue(
      defaultSearchHook({
        query: 'vase',
        total: 1,
        tookMs: 5,
        results: [
          {
            entity_key: 'ent-1',
            title: 'Sample Vase',
            description: 'a beautiful vase',
            object_number: '2024.001',
            entity_type: 'object',
            dataset_id: 'ds-1',
            highlights: {},
          },
        ],
      }) as never,
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Sample Vase')).toBeInTheDocument();
    });
    expect(screen.getByText('2024.001')).toBeInTheDocument();
  });

  it('renders error banner when search errors', () => {
    mockUseSearch.mockReturnValue(
      defaultSearchHook({
        query: 'oops',
        error: new Error('search broke'),
      }) as never,
    );
    renderPage();
    expect(screen.getByText(/search error/i)).toBeInTheDocument();
    expect(screen.getByText('search broke')).toBeInTheDocument();
  });

  it('renders no-results message when query has no results', () => {
    mockUseSearch.mockReturnValue(
      defaultSearchHook({
        query: 'nothing',
        total: 0,
        results: [],
      }) as never,
    );
    renderPage();
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('shows Load more button when hasNextPage', () => {
    mockUseSearch.mockReturnValue(
      defaultSearchHook({
        query: 'a',
        total: 50,
        results: [
          {
            entity_key: 'e-1',
            title: 'Hit',
            entity_type: 'object',
            highlights: {},
          },
        ],
        hasNextPage: true,
      }) as never,
    );
    renderPage();
    expect(screen.getByRole('button', { name: /^load more$/i })).toBeInTheDocument();
  });
});
