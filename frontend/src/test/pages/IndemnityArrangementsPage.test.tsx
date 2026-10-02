import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IndemnityArrangementsPage from '../../pages/collections/IndemnityArrangementsPage';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getIndemnityArrangements: vi.fn(),
}));

const mockGetIndemnityArrangements = vi.mocked(api.getIndemnityArrangements);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(orgId = 'org-123') {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={[`/organizations/${orgId}/collections/insurance/indemnities`]}
      >
        <Routes>
          <Route
            path="/organizations/:orgId/collections/insurance/indemnities"
            element={<IndemnityArrangementsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sampleData = {
  indemnities: [
    {
      indemnity_id: 'i-1',
      internal_reference: 'INT-001',
      reference_number: 'REF-2024',
      program: 'us_arts',
      status: 'active',
      coverage_start_date: '2024-01-01',
      coverage_end_date: '2025-01-01',
      requested_coverage: 1000000,
      awarded_coverage: 800000,
      coverage_currency: 'USD',
    },
    {
      indemnity_id: 'i-2',
      internal_reference: null,
      reference_number: null,
      program: 'uk_gis',
      status: 'submitted',
      coverage_start_date: null,
      coverage_end_date: null,
      requested_coverage: 500000,
      awarded_coverage: 0,
      coverage_currency: 'GBP',
    },
  ],
};

describe('IndemnityArrangementsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('shows loader before data arrives', () => {
    mockGetIndemnityArrangements.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(
      screen.queryByRole('heading', { name: /indemnity arrangements/i }),
    ).not.toBeInTheDocument();
  });

  it('renders heading and rows', async () => {
    mockGetIndemnityArrangements.mockResolvedValue(sampleData as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /indemnity arrangements/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('INT-001')).toBeInTheDocument();
  });

  it('renders summary stats', async () => {
    mockGetIndemnityArrangements.mockResolvedValue(sampleData as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/active \/ approved/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/pending review/i)).toBeInTheDocument();
    expect(screen.getByText(/total coverage/i)).toBeInTheDocument();
    expect(screen.getByText(/total arrangements/i)).toBeInTheDocument();
  });

  it('renders error state on failure', async () => {
    mockGetIndemnityArrangements.mockRejectedValue(new Error('boom'));
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/error loading indemnity arrangements: boom/i),
      ).toBeInTheDocument();
    });
  });

  it('renders empty state when no records', async () => {
    mockGetIndemnityArrangements.mockResolvedValue({ indemnities: [] } as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/no indemnity arrangements yet\./i),
      ).toBeInTheDocument();
    });
  });

  it('changing status filter triggers refetch', async () => {
    mockGetIndemnityArrangements.mockResolvedValue(sampleData as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('INT-001')).toBeInTheDocument();
    });
    const statusSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(statusSelect, { target: { value: 'active' } });
    await waitFor(() => {
      expect(mockGetIndemnityArrangements).toHaveBeenCalledWith(
        'org-123',
        expect.objectContaining({ status: 'active' }),
      );
    });
  });

  it('renders new arrangement link', async () => {
    mockGetIndemnityArrangements.mockResolvedValue(sampleData as any);
    renderPage();
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /new arrangement/i });
      expect(link).toHaveAttribute(
        'href',
        '/organizations/org-123/collections/insurance/indemnities/create',
      );
    });
  });
});
