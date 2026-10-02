import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GuideAnalyticsPage from '../../pages/admin/GuideAnalyticsPage';
import * as apiClient from '../../lib/apiClient';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

const mockApiFetch = vi.mocked(apiClient.apiFetch);

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GuideAnalyticsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const mockData = {
  period_days: 30,
  summary: {
    total_requests: 1000,
    total_errors: 5,
    error_rate: 0.005,
    total_input_tokens: 50000,
    total_output_tokens: 25000,
    total_tokens: 75000,
    estimated_cost_usd: 12.34,
    avg_latency_ms: 1200,
    satisfaction_positive: 80,
    satisfaction_negative: 5,
  },
  by_org: [
    {
      organization_id: 'org-1',
      organization_name: 'Test Org',
      requests: 500,
      input_tokens: 25000,
      output_tokens: 12500,
      total_tokens: 37500,
      estimated_cost_usd: 6.17,
      tool_calls: 100,
      avg_latency_ms: 1100,
    },
  ],
  by_tool: [{ tool: 'search_collection', calls: 200 }],
  by_provider: { anthropic: 1000 },
  daily: [
    { date: '2026-04-01', requests: 30, tokens: 2000, estimated_cost_usd: 0.4 },
    { date: '2026-04-02', requests: 40, tokens: 2500, estimated_cost_usd: 0.5 },
  ],
  top_questions: [{ question: 'How do I add an object?', count: 50 }],
  retrieval_misses: [],
  top_pages: [{ route: '/objects', count: 25 }],
};

describe('GuideAnalyticsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('shows loading message', () => {
      mockApiFetch.mockImplementation(() => new Promise(() => {}));
      renderPage();
      expect(screen.getByText(/Loading\.\.\./i)).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error message when API fails', async () => {
      mockApiFetch.mockRejectedValue(new Error('failed'));

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Failed to load analytics/i)).toBeInTheDocument();
      });
    });
  });

  describe('with data', () => {

    it('renders period selector buttons', async () => {
      mockApiFetch.mockResolvedValue(mockData);

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '7d' })).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: '30d' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '90d' })).toBeInTheDocument();
    });

    it('changes period when button clicked', async () => {
      mockApiFetch.mockResolvedValue(mockData);

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '7d' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: '7d' }));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('days=7'));
      });
    });

    it('renders by-org section', async () => {
      mockApiFetch.mockResolvedValue(mockData);

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Usage by Organization/i)).toBeInTheDocument();
      });
      expect(screen.getByText('Test Org')).toBeInTheDocument();
    });

    it('renders top questions', async () => {
      mockApiFetch.mockResolvedValue(mockData);

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('How do I add an object?')).toBeInTheDocument();
      });
    });
  });
});
