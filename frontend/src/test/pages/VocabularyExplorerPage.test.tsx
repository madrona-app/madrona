import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import VocabularyExplorerPage from '../../pages/collections/VocabularyExplorerPage';
import * as api from '../../lib/api';
import { ToastProvider } from '../../contexts/ToastContext';

vi.mock('../../lib/api', () => ({
  searchVocabulary: vi.fn(),
  importGettyTerm: vi.fn(),
  getVocabularyTermHierarchy: vi.fn(),
}));

const mockSearchVocabulary = vi.mocked(api.searchVocabulary);
const mockImportGettyTerm = vi.mocked(api.importGettyTerm);
const mockGetVocabularyTermHierarchy = vi.mocked(api.getVocabularyTermHierarchy);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(orgId = 'org-123') {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter
          initialEntries={[`/organizations/${orgId}/collections/vocabulary`]}
        >
          <Routes>
            <Route
              path="/organizations/:orgId/collections/vocabulary"
              element={<VocabularyExplorerPage />}
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('VocabularyExplorerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchVocabulary.mockResolvedValue({ terms: [] } as any);
  });

  it('renders the page heading', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /controlled vocabularies/i }),
    ).toBeInTheDocument();
  });

  it('renders all three vocabulary tabs', () => {
    renderPage();
    expect(
      screen.getByRole('button', { name: /art & architecture thesaurus|aat/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /union list of artist names|ulan/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /thesaurus of geographic names|tgn/i }),
    ).toBeInTheDocument();
  });

  it('renders AAT facet filters by default', () => {
    renderPage();
    expect(
      screen.getByRole('button', { name: /all categories/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /materials/i }),
    ).toBeInTheDocument();
  });

  it('shows search prompt when no query', () => {
    renderPage();
    expect(
      screen.getByText(/enter a search term to explore vocabularies/i),
    ).toBeInTheDocument();
  });

  it('switches vocabulary tab when clicked', () => {
    renderPage();
    const ulanTab = screen.getByRole('button', {
      name: /union list of artist names|ulan/i,
    });
    fireEvent.click(ulanTab);
    // After switching to ULAN, AAT facets should be hidden
    expect(
      screen.queryByRole('button', { name: /all categories/i }),
    ).not.toBeInTheDocument();
  });

  it('renders search input', () => {
    renderPage();
    expect(
      screen.getByPlaceholderText(/search aat terms/i),
    ).toBeInTheDocument();
  });

  it('shows search hint about minimum 2 characters', () => {
    renderPage();
    expect(
      screen.getByText(/type at least 2 characters/i),
    ).toBeInTheDocument();
  });

  it('renders results when search returns terms', async () => {
    mockSearchVocabulary.mockResolvedValue({
      terms: [
        {
          external_id: '300010353',
          preferred_term: 'oil paint',
          vocabulary: 'aat',
          scope_note: 'A pigment-binder mixture',
        },
      ],
    } as any);
    renderPage();
    const input = screen.getByPlaceholderText(/search aat terms/i);
    fireEvent.change(input, { target: { value: 'oil paint' } });
    // Wait for results — debounce + async
    await waitFor(
      () => {
        expect(screen.getByText('oil paint')).toBeInTheDocument();
      },
      { timeout: 1000 },
    );
  });

  describe('import button', () => {
    const uncachedTerm = {
      external_id: '300010353',
      preferred_term: 'oil paint',
      vocabulary: 'aat',
      scope_note: 'A pigment-binder mixture',
      external_uri: 'https://vocab.getty.edu/aat/300010353',
    };

    async function searchAndFindImportButton() {
      mockSearchVocabulary.mockResolvedValue({ terms: [uncachedTerm] } as any);
      renderPage();
      const input = screen.getByPlaceholderText(/search aat terms/i);
      fireEvent.change(input, { target: { value: 'oil paint' } });
      await waitFor(() => expect(screen.getByText('oil paint')).toBeInTheDocument(), {
        timeout: 1000,
      });
      return screen.getByRole('button', { name: /import/i });
    }

    it('calls importGettyTerm with the term payload when clicked', async () => {
      mockImportGettyTerm.mockResolvedValue({
        status: 'queued',
        task_id: 'task-1',
        vocabulary: 'aat',
        external_id: '300010353',
        preferred_term: 'oil paint',
      } as any);

      const button = await searchAndFindImportButton();
      fireEvent.click(button);

      await waitFor(() => expect(mockImportGettyTerm).toHaveBeenCalledTimes(1));
      const [orgId, payload] = mockImportGettyTerm.mock.calls[0];
      expect(orgId).toBe('org-123');
      expect(payload).toMatchObject({
        vocabulary: 'aat',
        external_id: '300010353',
        preferred_term: 'oil paint',
        external_uri: 'https://vocab.getty.edu/aat/300010353',
        scope_note: 'A pigment-binder mixture',
      });
    });

    it('shows a queued toast on a queued response', async () => {
      mockImportGettyTerm.mockResolvedValue({
        status: 'queued',
        task_id: 'task-1',
        vocabulary: 'aat',
        external_id: '300010353',
        preferred_term: 'oil paint',
      } as any);

      const button = await searchAndFindImportButton();
      fireEvent.click(button);

      await waitFor(() =>
        expect(screen.getByText(/import queued/i)).toBeInTheDocument(),
      );
      expect(
        screen.getByText(/will appear once the background sync completes/i),
      ).toBeInTheDocument();
    });

    it('shows an info toast when the term already exists', async () => {
      mockImportGettyTerm.mockResolvedValue({
        status: 'already_exists',
        term_id: 'term-uuid-1',
        vocabulary: 'aat',
        external_id: '300010353',
        preferred_term: 'oil paint',
      } as any);

      const button = await searchAndFindImportButton();
      fireEvent.click(button);

      await waitFor(() =>
        expect(screen.getByText(/already imported/i)).toBeInTheDocument(),
      );
    });

    it('hides Import and shows a guide-term marker for bracketed AAT terms', async () => {
      const guideTerm = {
        external_id: '300010354',
        preferred_term: '<materials by composition>',
        vocabulary: 'aat',
        scope_note: 'Hierarchy guide.',
      };
      mockSearchVocabulary.mockResolvedValue({ terms: [guideTerm] } as any);
      renderPage();
      const input = screen.getByPlaceholderText(/search aat terms/i);
      fireEvent.change(input, { target: { value: 'materials' } });
      await waitFor(
        () =>
          expect(
            screen.getByText('<materials by composition>'),
          ).toBeInTheDocument(),
        { timeout: 1000 },
      );

      // Guide-term badge is visible in the row
      expect(screen.getByText(/guide term/i)).toBeInTheDocument();
      // Import button is suppressed
      expect(screen.queryByRole('button', { name: /import/i })).not.toBeInTheDocument();
    });

    it('shows an error toast when the import fails', async () => {
      mockImportGettyTerm.mockRejectedValue(new Error('Network error'));

      const button = await searchAndFindImportButton();
      fireEvent.click(button);

      await waitFor(() =>
        expect(screen.getByText(/import failed/i)).toBeInTheDocument(),
      );
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });

  describe('hierarchy panel', () => {
    const cachedTerm = {
      term_id: 'term-uuid-1',
      external_id: '300010353',
      preferred_term: 'oil paint',
      vocabulary: 'aat',
    };

    async function openPanel() {
      mockSearchVocabulary.mockResolvedValue({ terms: [cachedTerm] } as any);
      renderPage();
      const input = screen.getByPlaceholderText(/search aat terms/i);
      fireEvent.change(input, { target: { value: 'oil paint' } });
      await waitFor(() => expect(screen.getByText('oil paint')).toBeInTheDocument(), {
        timeout: 1000,
      });
      fireEvent.click(screen.getByRole('button', { name: /hierarchy/i }));
    }

    it('calls getVocabularyTermHierarchy without throwing on no opts', async () => {
      mockGetVocabularyTermHierarchy.mockResolvedValue({
        term: {
          term_id: 'term-uuid-1',
          vocabulary: 'aat',
          external_id: '300010353',
          preferred_term: 'oil paint',
          hierarchy_path: 'Materials > Oil paint',
        },
        broader_terms: [],
        narrower_terms: [],
        related_terms: [],
      } as any);

      await openPanel();

      await waitFor(() =>
        expect(mockGetVocabularyTermHierarchy).toHaveBeenCalledWith(
          'org-123',
          'term-uuid-1',
          { sync: true },
        ),
      );
      // No "Failed to load hierarchy" error rendered
      expect(screen.queryByText(/failed to load hierarchy/i)).not.toBeInTheDocument();
    });

    it('marks guide terms in narrower section without breaking navigation', async () => {
      mockGetVocabularyTermHierarchy.mockResolvedValue({
        term: {
          term_id: 'term-uuid-1',
          vocabulary: 'aat',
          external_id: '300010353',
          preferred_term: 'oil paint',
        },
        broader_terms: [],
        narrower_terms: [
          {
            term_id: 't-guide',
            preferred_term: '<oil paint by composition>',
            vocabulary: 'aat',
            depth: 1,
          },
        ],
        related_terms: [],
      } as any);

      await openPanel();

      await waitFor(() =>
        expect(screen.getByText('<oil paint by composition>')).toBeInTheDocument(),
      );
      // Guide marker visible
      expect(screen.getByText(/^guide$/i)).toBeInTheDocument();
      // Still clickable for navigation
      const button = screen.getByRole('button', {
        name: /<oil paint by composition>/,
      });
      expect(button).toBeEnabled();
    });

    it('renders broader, narrower, and related sections', async () => {
      mockGetVocabularyTermHierarchy.mockResolvedValue({
        term: {
          term_id: 'term-uuid-1',
          vocabulary: 'aat',
          external_id: '300010353',
          preferred_term: 'oil paint',
        },
        broader_terms: [
          { term_id: 't-b1', preferred_term: 'paint', vocabulary: 'aat', depth: 1 },
        ],
        narrower_terms: [
          { term_id: 't-n1', preferred_term: 'linseed oil paint', vocabulary: 'aat', depth: 1 },
        ],
        related_terms: [
          { term_id: 't-r1', preferred_term: 'pigment', vocabulary: 'aat' },
        ],
      } as any);

      await openPanel();

      await waitFor(() => expect(screen.getByText('paint')).toBeInTheDocument());
      expect(screen.getByText('linseed oil paint')).toBeInTheDocument();
      expect(screen.getByText('pigment')).toBeInTheDocument();
    });
  });
});
