import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GuideVisitorInsightsPage from '../../pages/guide/GuideVisitorInsightsPage';
import * as api from '../../lib/api/visitorInsights';
import type { VisitorInsights } from '../../lib/api/visitorInsights';

vi.mock('../../lib/api/visitorInsights', () => ({
  getVisitorInsights: vi.fn(),
}));

const mockGet = vi.mocked(api.getVisitorInsights);

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GuideVisitorInsightsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const mockData: VisitorInsights = {
  period_days: 30,
  summary: {
    total_questions: 120,
    satisfaction: { positive: 30, negative: 5 },
    answered_rate: 0.85,
    visitors: 44,
    visits: 60,
    qr_scan_share: 0.5,
  },
  daily: [
    { date: '2026-06-01', questions: 10 },
    { date: '2026-06-02', questions: 20 },
  ],
  top_objects: [
    { entity_id: 'obj-1', title: 'Starry Field', questions: 12, views: 30 },
    { entity_id: 'obj-2', title: null, questions: 4, views: 2 },
  ],
  top_questions: [{ question: 'Who painted this?', count: 9 }],
  unanswered: [{ question: 'Is there a cafe?', count: 7 }],
  languages: [
    { locale: 'en', visitors: 30 },
    { locale: 'fr', visitors: 14 },
  ],
};

const emptyData: VisitorInsights = {
  period_days: 30,
  summary: {
    total_questions: 0,
    satisfaction: { positive: 0, negative: 0 },
    answered_rate: null,
    visitors: 0,
    visits: 0,
    qr_scan_share: null,
  },
  daily: [],
  top_objects: [],
  top_questions: [],
  unanswered: [],
  languages: [],
};

describe('GuideVisitorInsightsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state', () => {
    mockGet.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('shows error state when the API fails', async () => {
    mockGet.mockRejectedValue(new Error('boom'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Failed to load visitor insights/i)).toBeInTheDocument();
    });
  });

  it('renders summary cards and sections with data', async () => {
    mockGet.mockResolvedValue(mockData);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Visitors')).toBeInTheDocument();
    });
    // stat values
    expect(screen.getByText('120')).toBeInTheDocument(); // questions
    expect(screen.getByText('44')).toBeInTheDocument(); // visitors
    // object join
    expect(screen.getByText('Starry Field')).toBeInTheDocument();
    expect(screen.getByText('Untitled object')).toBeInTheDocument();
    // questions + unanswered
    expect(screen.getByText('Who painted this?')).toBeInTheDocument();
    expect(screen.getByText('Is there a cafe?')).toBeInTheDocument();
    // languages
    expect(screen.getByText('en')).toBeInTheDocument();
    expect(screen.getByText('fr')).toBeInTheDocument();
  });

  it('renders an empty state when there is no visitor activity', async () => {
    mockGet.mockResolvedValue(emptyData);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/No visitor activity in this period/i)).toBeInTheDocument();
    });
  });

  it('refetches when the period changes', async () => {
    mockGet.mockResolvedValue(mockData);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '7d' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: '7d' }));

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(7);
    });
  });
});
