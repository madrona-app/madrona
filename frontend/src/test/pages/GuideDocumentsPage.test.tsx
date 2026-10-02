import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GuideDocumentsPage from '../../pages/guide/GuideDocumentsPage';
import * as apiClient from '../../lib/apiClient';
import * as guideInsights from '../../lib/api/guideInsights';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

// GuideDocumentsPage embeds CorpusGapsPanel, which fetches GET /guide/insights
// via getGuideInsights. Stub it with an empty (well-shaped) result so the panel
// renders quietly and doesn't pollute this page's test with insights queries.
vi.mock('../../lib/api/guideInsights');

const mockApiFetch = vi.mocked(apiClient.apiFetch);
const mockGetGuideInsights = vi.mocked(guideInsights.getGuideInsights);

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GuideDocumentsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('GuideDocumentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGuideInsights.mockResolvedValue({
      period_days: 30,
      summary: { total_requests: 0, answered_rate: null, gap_count: 0, satisfaction_positive: 0, satisfaction_negative: 0 },
      corpus_gaps: [], top_questions: [], top_pages: [], daily: [],
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the heading', async () => {
    mockApiFetch.mockResolvedValue({ documents: [] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /guide documents/i })).toBeInTheDocument();
    });
  });

  it('shows the empty state when there are no documents', async () => {
    mockApiFetch.mockResolvedValue({ documents: [] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/no documents yet/i)).toBeInTheDocument();
    });
  });

  it('renders one row per uploaded document', async () => {
    mockApiFetch.mockResolvedValue({
      documents: [
        {
          document_id: 'd-1',
          filename: 'collection-policy.pdf',
          file_size_bytes: 4096,
          mime_type: 'application/pdf',
          status: 'ready',
          visibility: 'internal',
          chunk_count: 14,
          error_message: null,
          created_at: '2026-04-01T00:00:00Z',
        },
        {
          document_id: 'd-2',
          filename: 'visitor-faq.md',
          file_size_bytes: 1024,
          mime_type: 'text/markdown',
          status: 'processing',
          visibility: 'public',
          chunk_count: 0,
          error_message: null,
          created_at: '2026-04-15T00:00:00Z',
        },
      ],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('collection-policy.pdf')).toBeInTheDocument();
    });
    expect(screen.getByText('visitor-faq.md')).toBeInTheDocument();
    expect(screen.getByText(/14 chunks/)).toBeInTheDocument();
  });

  it('renders the upload-as-internal/public selector', async () => {
    mockApiFetch.mockResolvedValue({ documents: [] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue(/upload as internal/i)).toBeInTheDocument();
    });
  });

  it('renders the Upload button', async () => {
    mockApiFetch.mockResolvedValue({ documents: [] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /upload document/i })).toBeInTheDocument();
    });
  });
});
